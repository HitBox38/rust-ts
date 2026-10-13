// Port of pulldown-cmark-0.11.3/src/parse.rs.
// Copyright 2017 Google Inc. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

//! Tree-based two pass parser.
//!
//! PORT (see lib.ts for the crate-wide representation):
//! - `Item` is `Copy` upstream; here it is a mutable object owned by its tree node. Code that keeps a
//!   copy of an item while the tree changes uses `clone_Item`. `ItemBody` values are immutable (unit
//!   variants are shared singletons on the companion); a body is changed by assigning a new value.
//! - `CowIndex`/`LinkIndex`/`AlignmentIndex` are plain indices; `HeadingIndex(NonZeroUsize)` is the
//!   1-based number.
//! - `HashMap<LinkLabel, LinkDef>` (RefDefs/FootnoteDefs) are JS `Map`s keyed by `UniCase_key(label)`
//!   holding `[label, value]`, so the first inserted label is kept as upstream's `HashMap` does.
//! - `F: BrokenLinkCallback` is a function `(link: BrokenLink) => [CowStr, CowStr] | undefined`.
//! - `Parser` implements `Iterator` as `next()`; `[Symbol.iterator]` drives it for `for..of`.

import type { MutRef } from "../../std/mut_ref.ts";
import { panic } from "../../std/panic.ts";
import { from_utf8, type Str, utf8_len } from "../../std/str.ts";
import { UniCase, UniCase_key } from "../unicase/lib.ts";
import { run_first_pass } from "./firstpass.ts";
import {
  type Alignment,
  type BlockQuoteKind,
  CodeBlockKind,
  type Event,
  type HeadingLevel,
  LinkType,
  type MetadataBlockKind,
  Options,
  type Tag,
  type TagEnd,
} from "./lib.ts";
import { type FootnoteLabel, type LinkLabel, type ReferenceLabel, scan_link_label_rest } from "./linklabel.ts";
import {
  is_ascii_punctuation,
  is_ascii_whitespace_no_nl,
  LineStart,
  scan_autolink,
  scan_ch,
  scan_entity,
  scan_eol,
  scan_html_block_inner,
  scan_inline_html_comment,
  scan_inline_html_processing,
  scan_link_dest,
  scan_while,
  unescape,
} from "./scanners.ts";
import type { CowStr } from "./strings.ts";
import { Tree, TreeIndex } from "./tree.ts";

// Allowing arbitrary depth nested parentheses inside link destinations
// can create denial of service vulnerabilities if we're not careful.
// The simplest countermeasure is to limit their depth, which is
// explicitly allowed by the spec as long as the limit is at least 3:
// https://spec.commonmark.org/0.29/#link-destination
export const LINK_MAX_NESTED_PARENS = 32;

export interface Item {
  start: number;
  end: number;
  body: ItemBody;
}

/** `Item: Copy`: an independent copy (bodies are immutable values, so they are shared). */
export function clone_Item(v: Item): Item {
  return { start: v.start, end: v.end, body: v.body };
}

/** `Item::default()` */
export function Item_default(): Item {
  return { start: 0, end: 0, body: ItemBody.Root };
}

export type ItemBody =
  | { readonly $: "Paragraph" }
  | { readonly $: "Text"; readonly backslash_escaped: boolean }
  | { readonly $: "SoftBreak" }
  // true = is backlash
  | { readonly $: "HardBreak"; readonly _0: boolean }

  // These are possible inline items, need to be resolved in second pass.

  // repeats, can_open, can_close
  | { readonly $: "MaybeEmphasis"; readonly _0: number; readonly _1: boolean; readonly _2: boolean }
  // can_open, can_close, brace context
  | { readonly $: "MaybeMath"; readonly _0: boolean; readonly _1: boolean; readonly _2: number }
  // quote byte, can_open, can_close
  | { readonly $: "MaybeSmartQuote"; readonly _0: number; readonly _1: boolean; readonly _2: boolean }
  | { readonly $: "MaybeCode"; readonly _0: number; readonly _1: boolean } // number of backticks, preceded by backslash
  | { readonly $: "MaybeHtml" }
  | { readonly $: "MaybeLinkOpen" }
  // bool indicates whether or not the preceding section could be a reference
  | { readonly $: "MaybeLinkClose"; readonly _0: boolean }
  | { readonly $: "MaybeImage" }

  // These are inline items after resolution.
  | { readonly $: "Emphasis" }
  | { readonly $: "Strong" }
  | { readonly $: "Strikethrough" }
  | { readonly $: "Math"; readonly _0: CowIndex; readonly _1: boolean } // true for display math
  | { readonly $: "Code"; readonly _0: CowIndex }
  | { readonly $: "Link"; readonly _0: LinkIndex }
  | { readonly $: "Image"; readonly _0: LinkIndex }
  | { readonly $: "FootnoteReference"; readonly _0: CowIndex }
  | { readonly $: "TaskListMarker"; readonly _0: boolean } // true for checked
  | { readonly $: "Rule" }
  | { readonly $: "Heading"; readonly _0: HeadingLevel; readonly _1: HeadingIndex | undefined } // heading level
  | { readonly $: "FencedCodeBlock"; readonly _0: CowIndex }
  | { readonly $: "IndentCodeBlock" }
  | { readonly $: "HtmlBlock" }
  | { readonly $: "InlineHtml" }
  | { readonly $: "Html" }
  | { readonly $: "OwnedHtml"; readonly _0: CowIndex }
  | { readonly $: "BlockQuote"; readonly _0: BlockQuoteKind | undefined }
  // PORT: list start index `u64`: a `number` (`scan_listitem` caps it at 9 digits).
  | { readonly $: "List"; readonly _0: boolean; readonly _1: number; readonly _2: number } // is_tight, list character, list start index
  | { readonly $: "ListItem"; readonly _0: number } // indent level
  | { readonly $: "SynthesizeText"; readonly _0: CowIndex }
  | { readonly $: "SynthesizeChar"; readonly _0: number }
  | { readonly $: "FootnoteDefinition"; readonly _0: CowIndex }
  | { readonly $: "MetadataBlock"; readonly _0: MetadataBlockKind }

  // Tables
  | { readonly $: "Table"; readonly _0: AlignmentIndex }
  | { readonly $: "TableHead" }
  | { readonly $: "TableRow" }
  | { readonly $: "TableCell" }

  // Dummy node at the top of the tree - should not be used otherwise!
  | { readonly $: "Root" };

const unit = <K extends string>($: K) => Object.freeze({ $ }) as ItemBody;

export const ItemBody = {
  Paragraph: unit("Paragraph"),
  SoftBreak: unit("SoftBreak"),
  MaybeHtml: unit("MaybeHtml"),
  MaybeLinkOpen: unit("MaybeLinkOpen"),
  MaybeImage: unit("MaybeImage"),
  Emphasis: unit("Emphasis"),
  Strong: unit("Strong"),
  Strikethrough: unit("Strikethrough"),
  Rule: unit("Rule"),
  IndentCodeBlock: unit("IndentCodeBlock"),
  HtmlBlock: unit("HtmlBlock"),
  InlineHtml: unit("InlineHtml"),
  Html: unit("Html"),
  TableHead: unit("TableHead"),
  TableRow: unit("TableRow"),
  TableCell: unit("TableCell"),
  Root: unit("Root"),

  // crate: pulldown-cmark-0.11.3/src/parse.rs:119 is_inline
  is_inline(self: ItemBody): boolean {
    switch (self.$) {
      case "MaybeEmphasis":
      case "MaybeMath":
      case "MaybeSmartQuote":
      case "MaybeHtml":
      case "MaybeCode":
      case "MaybeLinkOpen":
      case "MaybeLinkClose":
      case "MaybeImage":
        return true;
      default:
        return false;
    }
  },

  // crate: pulldown-cmark-0.11.3/src/parse.rs:132 is_block
  is_block(self: ItemBody): boolean {
    switch (self.$) {
      case "Paragraph":
      case "BlockQuote":
      case "List":
      case "ListItem":
      case "HtmlBlock":
      case "Table":
      case "TableHead":
      case "TableRow":
      case "TableCell":
      case "Heading":
      case "Rule":
        return true;
      default:
        return false;
    }
  },
};

/** `#[derive(PartialEq)] ItemBody` */
export function ItemBody_eq(a: ItemBody, b: ItemBody): boolean {
  if (a.$ !== b.$) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(ra)) if (ra[k] !== rb[k]) return false;
  return true;
}

export class BrokenLink {
  constructor(
    public span: [number, number],
    public link_type: LinkType,
    public reference: CowStr,
  ) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:207 into_static
  /// Moves the link into version with a static lifetime.
  ///
  /// The `reference` member is cloned to a Boxed or Inline version.
  into_static(): BrokenLink {
    return new BrokenLink([this.span[0], this.span[1]], this.link_type, this.reference);
  }
}

/// Trait for broken link callbacks.
///
/// See [Parser::new_with_broken_link_callback].
/// Automatically implemented for closures with the appropriate signature.
// PORT: the trait is the closure type; `handle_broken_link` is calling it (parse.rs:1946, 1955, 1968).
export type BrokenLinkCallback = (link: BrokenLink) => [CowStr, CowStr] | undefined;

/// Broken link callback that does nothing.
// crate: pulldown-cmark-0.11.3/src/parse.rs:1968 handle_broken_link
export const DefaultBrokenLinkCallback: BrokenLinkCallback = (_link) => undefined;

/// Markdown event iterator.
export class Parser {
  constructor(
    public text: Str,
    public options: Options,
    public tree: Tree<Item>,
    public allocs: Allocations,
    public broken_link_callback: BrokenLinkCallback | undefined,
    public html_scan_guard: HtmlScanGuard,
    // https://github.com/pulldown-cmark/pulldown-cmark/issues/844
    // Consider this example:
    //
    //     [x]: xxx...
    //     [x]
    //     [x]
    //     [x]
    //
    // Which expands to this HTML:
    //
    //     <a href="xxx...">x</a>
    //     <a href="xxx...">x</a>
    //     <a href="xxx...">x</a>
    //
    // This is quadratic growth, because it's filling in the area of a square.
    // To prevent this, track how much it's expanded and limit it.
    public link_ref_expansion_limit: number,
    // used by inline passes. store them here for reuse
    public inline_stack: InlineStack,
    public link_stack: LinkStack,
  ) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:218 new
  /// Creates a new event iterator for a markdown string without any options enabled.
  static new(text: Str): Parser {
    return Parser.new_ext(text, 0);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:223 new_ext
  /// Creates a new event iterator for a markdown string with given options.
  static new_ext(text: Str, options: Options): Parser {
    return Parser.new_with_broken_link_callback(text, options, undefined);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:234 new_with_broken_link_callback
  /// In case the parser encounters any potential links that have a broken
  /// reference (e.g `[foo]` when there is no `[foo]: ` entry at the bottom)
  /// the provided callback will be called with the reference name,
  /// and the returned pair will be used as the link URL and title if it is not
  /// `None`.
  static new_with_broken_link_callback(text: Str, options: Options, broken_link_callback: BrokenLinkCallback | undefined): Parser {
    const [tree, allocs] = run_first_pass(text, options);
    tree.reset();
    const inline_stack = InlineStack.default_();
    const link_stack = LinkStack.default_();
    const html_scan_guard = HtmlScanGuard.default_();
    return new Parser(
      text,
      options,
      tree,
      allocs,
      broken_link_callback,
      html_scan_guard,
      // always allow 100KiB
      Math.max(text.len(), 100_000),
      inline_stack,
      link_stack,
    );
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:260 reference_definitions
  /// Returns a reference to the internal `RefDefs` object, which provides access
  /// to the internal map of reference definitions.
  reference_definitions(): RefDefs {
    return this.allocs.refdefs;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:283 fetch_link_type_url_title
  /// Use a link label to fetch a type, url, and title.
  ///
  /// This function enforces the [`link_ref_expansion_limit`].
  /// If it returns Some, it also consumes some of the fuel.
  /// If we're out of fuel, it immediately returns None.
  ///
  /// The URL and title are found in the [`RefDefs`] map.
  /// If they're not there, and a callback was provided by the user,
  /// the [`broken_link_callback`] will be invoked and given the opportunity
  /// to provide a fallback.
  ///
  /// The link type (that's "link" or "image") depends on the usage site, and
  /// is provided by the caller of this function.
  /// This function returns a new one because, if it has to invoke a callback
  /// to find the information, the link type is [mapped to an unknown type].
  ///
  /// [mapped to an unknown type]: crate::LinkType::to_unknown
  /// [`link_ref_expansion_limit`]: Self::link_ref_expansion_limit
  /// [`broken_link_callback`]: Self::broken_link_callback
  fetch_link_type_url_title(link_label: CowStr, span: [number, number], link_type: LinkType): [LinkType, CowStr, CowStr] | undefined {
    if (this.link_ref_expansion_limit === 0) {
      return undefined;
    }

    let found: [LinkType, CowStr, CowStr] | undefined;
    const matching_def = this.allocs.refdefs.get(link_label);
    if (matching_def !== undefined) {
      // found a matching definition!
      const title = matching_def.title ?? "";
      const url = matching_def.dest;
      found = [link_type, url, title];
    } else {
      const callback = this.broken_link_callback;
      if (callback !== undefined) {
        // Construct a BrokenLink struct, which will be passed to the callback
        const broken_link = new BrokenLink(span, link_type, link_label);

        const r = callback(broken_link);
        found = r === undefined ? undefined : [LinkType.to_unknown(link_type), r[0], r[1]];
      } else {
        found = undefined;
      }
    }
    if (found === undefined) return undefined;
    const [link_type2, url, title] = found;

    // Limit expansion from link references.
    // This isn't a problem for footnotes, because multiple references to the same one
    // reuse the same node, but links/images get their HREF/SRC copied.
    this.link_ref_expansion_limit = Math.max(0, this.link_ref_expansion_limit - (utf8_len(url) + utf8_len(title)));

    return [link_type2, url, title];
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:341 handle_inline
  /// Handle inline markup.
  ///
  /// When the parser encounters any item indicating potential inline markup, all
  /// inline markup passes are run on the remainder of the chain.
  ///
  /// Note: there's some potential for optimization here, but that's future work.
  handle_inline(): void {
    this.handle_inline_pass1();
    this.handle_emphasis_and_hard_break();
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:351 handle_inline_pass1
  /// Handle inline HTML, code spans, and links.
  ///
  /// This function handles both inline HTML and code spans, because they have
  /// the same precedence. It also handles links, even though they have lower
  /// precedence, because the URL of links must not be processed.
  handle_inline_pass1(): void {
    const code_delims = CodeDelims.new();
    const math_delims = MathDelims.new();
    let cur = this.tree.cur();
    let prev: TreeIndex | undefined = undefined;

    const up = this.tree.peek_up();
    if (up === undefined) panic("called `Option::unwrap()` on a `None` value");
    const block_end = this.tree.at(up).item.end;
    const block_text = this.text.slice(0, block_end);

    while (cur !== undefined) {
      let cur_ix: TreeIndex = cur;
      const body = this.tree.at(cur_ix).item.body;
      switch (body.$) {
        case "MaybeHtml": {
          const next = this.tree.at(cur_ix).next;
          let autolink: [number, CowStr, LinkType] | undefined;
          if (next !== undefined) {
            const next_ix = next;
            autolink = scan_autolink(block_text, this.tree.at(next_ix).item.start);
          } else {
            autolink = undefined;
          }

          if (autolink !== undefined) {
            const [ix, uri, link_type] = autolink;
            const node = scan_nodes_to_ix(this.tree, next, ix);
            const text_node = this.tree.create_node({
              start: this.tree.at(cur_ix).item.start + 1,
              end: ix - 1,
              body: { $: "Text", backslash_escaped: false },
            });
            const link_ix = this.allocs.allocate_link(link_type, uri, "", "");
            this.tree.at(cur_ix).item.body = { $: "Link", _0: link_ix };
            this.tree.at(cur_ix).item.end = ix;
            this.tree.at(cur_ix).next = node;
            this.tree.at(cur_ix).child = text_node;
            prev = cur;
            cur = node;
            if (cur !== undefined) {
              const node_ix = cur;
              this.tree.at(node_ix).item.start = Math.max(this.tree.at(node_ix).item.start, ix);
            }
            continue;
          } else {
            const inline_html =
              next === undefined ? undefined : this.scan_inline_html(block_text.b.subarray(block_text.lo, block_text.hi), this.tree.at(next).item.start);
            if (inline_html !== undefined) {
              const [span, ix] = inline_html;
              const node = scan_nodes_to_ix(this.tree, next, ix);
              let new_body: ItemBody;
              if (span.length !== 0) {
                // `String::from_utf8(span).expect("invalid utf8")`
                const converted = from_utf8(Uint8Array.from(span));
                if (converted.$ === "Err") panic("invalid utf8");
                const converted_string = converted._0;
                new_body = { $: "OwnedHtml", _0: this.allocs.allocate_cow(converted_string) };
              } else {
                new_body = ItemBody.InlineHtml;
              }
              this.tree.at(cur_ix).item.body = new_body;
              this.tree.at(cur_ix).item.end = ix;
              this.tree.at(cur_ix).next = node;
              prev = cur;
              cur = node;
              if (cur !== undefined) {
                const node_ix = cur;
                this.tree.at(node_ix).item.start = Math.max(this.tree.at(node_ix).item.start, ix);
              }
              continue;
            }
          }
          this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
          break;
        }
        case "MaybeMath": {
          const can_open = body._0;
          const brace_context = body._2;
          if (!can_open) {
            this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
            prev = cur;
            cur = this.tree.at(cur_ix).next;
            continue;
          }
          const n0 = this.tree.at(cur_ix).next;
          const is_display = n0 === undefined ? false : this.tree.at(n0).item.body.$ === "MaybeMath";
          let result: TreeIndex | undefined;
          if (math_delims.is_populated()) {
            // we have previously scanned all math environment delimiters,
            // so we can reuse that work
            result = math_delims.find(this.tree, cur_ix, is_display, brace_context);
          } else {
            // we haven't previously scanned all math delimiters,
            // so walk the AST
            let scan = this.tree.at(cur_ix).next;
            if (is_display) {
              // a display delimiter, `$$`, is actually two delimiters
              // skip the second one
              if (scan === undefined) panic("called `Option::unwrap()` on a `None` value");
              scan = this.tree.at(scan).next;
            }
            let invalid = false;
            while (scan !== undefined) {
              const scan_ix: TreeIndex = scan;
              const sb = this.tree.at(scan_ix).item.body;
              if (sb.$ === "MaybeMath") {
                const can_close = sb._1;
                const delim_brace_context = sb._2;
                const n1 = this.tree.at(scan_ix).next;
                const delim_is_display = n1 === undefined ? false : this.tree.at(n1).item.body.$ === "MaybeMath";
                if (!invalid && delim_brace_context === brace_context) {
                  if ((!is_display && can_close) || (is_display && delim_is_display)) {
                    // This will skip ahead past everything we
                    // just inserted. Needed for correctness to
                    // ensure that a new scan is done after this item.
                    math_delims.clear();
                    break;
                  } else {
                    // Math cannot contain $, so the current item
                    // is invalid. Keep scanning to fill math_delims.
                    invalid = true;
                  }
                }
                math_delims.insert(delim_is_display, delim_brace_context, scan_ix, can_close);
              }
              if (ItemBody.is_block(this.tree.at(scan_ix).item.body)) {
                // If this is a tight list, blocks and inlines might be
                // siblings. Inlines can't cross the boundary like that.
                scan = undefined;
                break;
              }
              scan = this.tree.at(scan_ix).next;
            }
            result = scan;
          }

          if (result !== undefined) {
            const scan_ix = result;
            this.make_math_span(cur_ix, scan_ix);
          } else {
            this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
          }
          break;
        }
        case "MaybeCode": {
          let search_count = body._0;
          const preceded_by_backslash = body._1;
          if (preceded_by_backslash) {
            search_count -= 1;
            if (search_count === 0) {
              this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
              prev = cur;
              cur = this.tree.at(cur_ix).next;
              continue;
            }
          }

          if (code_delims.is_populated()) {
            // we have previously scanned all codeblock delimiters,
            // so we can reuse that work
            const scan_ix = code_delims.find(cur_ix, search_count);
            if (scan_ix !== undefined) {
              this.make_code_span(cur_ix, scan_ix, preceded_by_backslash);
            } else {
              this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
            }
          } else {
            // we haven't previously scanned all codeblock delimiters,
            // so walk the AST
            let scan = search_count > 0 ? this.tree.at(cur_ix).next : undefined;
            while (scan !== undefined) {
              const scan_ix: TreeIndex = scan;
              const sb = this.tree.at(scan_ix).item.body;
              if (sb.$ === "MaybeCode") {
                const delim_count = sb._0;
                if (search_count === delim_count) {
                  this.make_code_span(cur_ix, scan_ix, preceded_by_backslash);
                  code_delims.clear();
                  break;
                } else {
                  code_delims.insert(delim_count, scan_ix);
                }
              }
              if (ItemBody.is_block(this.tree.at(scan_ix).item.body)) {
                // If this is a tight list, blocks and inlines might be
                // siblings. Inlines can't cross the boundary like that.
                scan = undefined;
                break;
              }
              scan = this.tree.at(scan_ix).next;
            }
            if (scan === undefined) {
              this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
            }
          }
          break;
        }
        case "MaybeLinkOpen": {
          this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
          this.link_stack.push({ node: cur_ix, ty: "Link" });
          break;
        }
        case "MaybeImage": {
          this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
          this.link_stack.push({ node: cur_ix, ty: "Image" });
          break;
        }
        case "MaybeLinkClose": {
          const could_be_ref = body._0;
          this.tree.at(cur_ix).item.body = { $: "Text", backslash_escaped: false };
          const tos = this.link_stack.pop();
          if (tos !== undefined) {
            if (tos.ty === "Disabled") {
              continue;
            }
            const next = this.tree.at(cur_ix).next;
            const inline_link = this.scan_inline_link(block_text, this.tree.at(cur_ix).item.end, next);
            if (inline_link !== undefined) {
              const [next_ix, url, title] = inline_link;
              const next_node = scan_nodes_to_ix(this.tree, next, next_ix);
              if (prev !== undefined) {
                const prev_ix = prev;
                this.tree.at(prev_ix).next = undefined;
              }
              cur = tos.node;
              cur_ix = tos.node;
              const link_ix = this.allocs.allocate_link("Inline", url, title, "");
              this.tree.at(cur_ix).item.body = tos.ty === "Image" ? { $: "Image", _0: link_ix } : { $: "Link", _0: link_ix };
              this.tree.at(cur_ix).child = this.tree.at(cur_ix).next;
              this.tree.at(cur_ix).next = next_node;
              this.tree.at(cur_ix).item.end = next_ix;
              if (next_node !== undefined) {
                const next_node_ix = next_node;
                this.tree.at(next_node_ix).item.start = Math.max(this.tree.at(next_node_ix).item.start, next_ix);
              }

              if (tos.ty === "Link") {
                this.link_stack.disable_all_links();
              }
            } else {
              // ok, so its not an inline link. maybe it is a reference
              // to a defined link?
              const scan_result = scan_reference(
                this.tree,
                block_text,
                next,
                Options.contains(this.options, Options.ENABLE_FOOTNOTES),
                Options.has_gfm_footnotes(this.options),
              );
              let node_after_link: TreeIndex | undefined;
              let link_type: LinkType;
              switch (scan_result.$) {
                // [label][reference]
                case "LinkLabel": {
                  const end_ix = scan_result._1;
                  // Toggle reference viability of the last closing bracket,
                  // so that we can skip it on future iterations in case
                  // it fails in this one. In particular, we won't call
                  // the broken link callback twice on one reference.
                  const reference_close_node = scan_nodes_to_ix(this.tree, next, end_ix - 1);
                  if (reference_close_node === undefined) {
                    continue;
                  }
                  this.tree.at(reference_close_node).item.body = { $: "MaybeLinkClose", _0: false };
                  const next_node = this.tree.at(reference_close_node).next;

                  [node_after_link, link_type] = [next_node, "Reference"];
                  break;
                }
                // [reference][]
                case "Collapsed": {
                  const next_node = scan_result._0;
                  // This reference has already been tried, and it's not
                  // valid. Skip it.
                  if (!could_be_ref) {
                    continue;
                  }
                  [node_after_link, link_type] = [next_node, "Collapsed"];
                  break;
                }
                // [shortcut]
                //
                // [shortcut]: /blah
                case "Failed":
                case "UnexpectedFootnote": {
                  if (!could_be_ref) {
                    continue;
                  }
                  [node_after_link, link_type] = [next, "Shortcut"];
                  break;
                }
              }

              // FIXME: references and labels are mixed in the naming of variables
              // below. Disambiguate!

              // (label, source_ix end)
              let label: [ReferenceLabel, number] | undefined;
              switch (scan_result.$) {
                case "LinkLabel": {
                  label = [{ $: "Link", _0: scan_result._0 }, scan_result._1];
                  break;
                }
                case "Collapsed":
                case "Failed":
                case "UnexpectedFootnote": {
                  // No label? maybe it is a shortcut reference
                  const label_start = this.tree.at(tos.node).item.end - 1;
                  const label_end = this.tree.at(cur_ix).item.end;
                  const r = scan_link_label(
                    this.tree,
                    this.text.slice(label_start, label_end),
                    Options.contains(this.options, Options.ENABLE_FOOTNOTES),
                    Options.has_gfm_footnotes(this.options),
                  );
                  const m: [ReferenceLabel, number] | undefined = r === undefined ? undefined : [r[1], label_start + r[0]];
                  label = m !== undefined && m[1] === label_end ? m : undefined;
                  break;
                }
              }

              const id = label !== undefined ? label[0]._0 : "";

              // see if it's a footnote reference
              if (label !== undefined && label[0].$ === "Footnote") {
                const [l0, end] = label;
                const l = l0._0;
                const footref = this.allocs.allocate_cow(l);
                const def = this.allocs.footdefs.get_mut(this.allocs.cows[footref]!);
                if (def !== undefined) {
                  def.use_count += 1;
                }
                if (!Options.has_gfm_footnotes(this.options) || this.allocs.footdefs.contains(this.allocs.cows[footref]!)) {
                  // If this came from a MaybeImage, then the `!` prefix
                  // isn't part of the footnote reference.
                  let footnote_ix: TreeIndex;
                  if (tos.ty === "Image") {
                    this.tree.at(tos.node).next = cur_ix;
                    this.tree.at(tos.node).child = undefined;
                    this.tree.at(tos.node).item.body = { $: "SynthesizeChar", _0: 0x21 /* ! */ };
                    this.tree.at(cur_ix).item.start = this.tree.at(tos.node).item.start + 1;
                    this.tree.at(tos.node).item.end = this.tree.at(tos.node).item.start + 1;
                    footnote_ix = cur_ix;
                  } else {
                    footnote_ix = tos.node;
                  }
                  // use `next` instead of `node_after_link` because
                  // node_after_link is calculated for a [collapsed][] link,
                  // which footnotes don't support.
                  this.tree.at(footnote_ix).next = next;
                  this.tree.at(footnote_ix).child = undefined;
                  this.tree.at(footnote_ix).item.body = { $: "FootnoteReference", _0: footref };
                  this.tree.at(footnote_ix).item.end = end;
                  prev = footnote_ix;
                  cur = next;
                  this.link_stack.clear();
                  continue;
                }
              } else if (label !== undefined && label[0].$ === "Link") {
                const [l0, end] = label;
                const link_label = l0._0;
                const fetched = this.fetch_link_type_url_title(link_label, [this.tree.at(tos.node).item.start, end], link_type);
                if (fetched !== undefined) {
                  const [def_link_type, url, title] = fetched;
                  const link_ix = this.allocs.allocate_link(def_link_type, url, title, id);
                  this.tree.at(tos.node).item.body = tos.ty === "Image" ? { $: "Image", _0: link_ix } : { $: "Link", _0: link_ix };
                  const label_node = this.tree.at(tos.node).next;

                  // lets do some tree surgery to add the link to the tree
                  // 1st: skip the label node and close node
                  this.tree.at(tos.node).next = node_after_link;

                  // then, if it exists, add the label node as a child to the link node
                  if (label_node !== cur) {
                    this.tree.at(tos.node).child = label_node;

                    // finally: disconnect list of children
                    if (prev !== undefined) {
                      const prev_ix = prev;
                      this.tree.at(prev_ix).next = undefined;
                    }
                  }

                  this.tree.at(tos.node).item.end = end;

                  // set up cur so next node will be node_after_link
                  cur = tos.node;
                  cur_ix = tos.node;

                  if (tos.ty === "Link") {
                    this.link_stack.disable_all_links();
                  }
                }
              }
            }
          }
          break;
        }
        default: {
          // If this is a tight list, blocks and inlines might be
          // siblings. Inlines can't cross the boundary like that.
          if (cur !== undefined) {
            const cur_ix = cur;
            if (ItemBody.is_block(this.tree.at(cur_ix).item.body)) {
              this.link_stack.clear();
            }
          }
          break;
        }
      }
      prev = cur;
      cur = this.tree.at(cur_ix).next;
    }
    this.link_stack.clear();
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:808 handle_emphasis_and_hard_break
  handle_emphasis_and_hard_break(): void {
    let prev: TreeIndex | undefined = undefined;
    let prev_ix: TreeIndex;
    let cur = this.tree.cur();

    let single_quote_open: TreeIndex | undefined = undefined;
    let double_quote_open = false;

    while (cur !== undefined) {
      let cur_ix: TreeIndex = cur;
      const body = this.tree.at(cur_ix).item.body;
      if (body.$ === "MaybeEmphasis") {
        let count = body._0;
        const can_open = body._1;
        const can_close = body._2;
        const run_length = count;
        const c = this.text.byte(this.tree.at(cur_ix).item.start);
        const both = can_open && can_close;
        if (can_close) {
          for (;;) {
            const el = this.inline_stack.find_match(this.tree, c, run_length, both);
            if (el === undefined) break;
            // have a match!
            if (prev !== undefined) {
              const prev_ix = prev;
              this.tree.at(prev_ix).next = undefined;
            }
            const match_count = Math.min(count, el.count);
            // start, end are tree node indices
            let end = TreeIndex.sub(cur_ix, 1);
            let start = TreeIndex.add(el.start, el.count);

            // work from the inside out
            while (start > el.start + el.count - match_count) {
              const inc = start > el.start + el.count - match_count + 1 ? 2 : 1;
              const ty = c === 0x7e /* ~ */ ? ItemBody.Strikethrough : inc === 2 ? ItemBody.Strong : ItemBody.Emphasis;

              const root = TreeIndex.sub(start, inc);
              end = TreeIndex.add(end, inc);
              this.tree.at(root).item.body = ty;
              this.tree.at(root).item.end = this.tree.at(end).item.end;
              this.tree.at(root).child = start;
              this.tree.at(root).next = undefined;
              start = root;
            }

            // set next for top most emph level
            prev_ix = TreeIndex.sub(TreeIndex.add(el.start, el.count), match_count);
            prev = prev_ix;
            cur = this.tree.at(TreeIndex.sub(TreeIndex.add(cur_ix, match_count), 1)).next;
            this.tree.at(prev_ix).next = cur;

            if (el.count > match_count) {
              this.inline_stack.push({
                start: el.start,
                count: el.count - match_count,
                run_length: el.run_length,
                c: el.c,
                both: el.both,
              });
            }
            count -= match_count;
            if (count > 0) {
              if (cur === undefined) panic("called `Option::unwrap()` on a `None` value");
              cur_ix = cur;
            } else {
              break;
            }
          }
        }
        if (count > 0) {
          if (can_open) {
            this.inline_stack.push({
              start: cur_ix,
              run_length,
              count,
              c,
              both,
            });
          } else {
            for (let i = 0; i < count; i++) {
              this.tree.at(TreeIndex.add(cur_ix, i)).item.body = { $: "Text", backslash_escaped: false };
            }
          }
          prev_ix = TreeIndex.sub(TreeIndex.add(cur_ix, count), 1);
          prev = prev_ix;
          cur = this.tree.at(prev_ix).next;
        }
      } else if (body.$ === "MaybeSmartQuote") {
        const c = body._0;
        const can_open = body._1;
        const can_close = body._2;
        let new_body: ItemBody;
        if (c === 0x27 /* ' */) {
          if (single_quote_open !== undefined && can_close) {
            const open_ix = single_quote_open;
            this.tree.at(open_ix).item.body = { $: "SynthesizeChar", _0: 0x2018 /* ‘ */ };
            single_quote_open = undefined;
          } else if (can_open) {
            single_quote_open = cur_ix;
          }
          new_body = { $: "SynthesizeChar", _0: 0x2019 /* ’ */ };
        } else {
          /* double quote */
          if (can_close && double_quote_open) {
            double_quote_open = false;
            new_body = { $: "SynthesizeChar", _0: 0x201d /* ” */ };
          } else {
            if (can_open && !double_quote_open) {
              double_quote_open = true;
            }
            new_body = { $: "SynthesizeChar", _0: 0x201c /* “ */ };
          }
        }
        this.tree.at(cur_ix).item.body = new_body;
        prev = cur;
        cur = this.tree.at(cur_ix).next;
      } else if (body.$ === "HardBreak" && body._0 === true) {
        if (this.tree.at(cur_ix).next === undefined) {
          this.tree.at(cur_ix).item.body = { $: "SynthesizeChar", _0: 0x5c /* \ */ };
        }
        prev = cur;
        cur = this.tree.at(cur_ix).next;
      } else {
        prev = cur;
        // If this is a tight list, blocks and inlines might be
        // siblings. Inlines can't cross the boundary like that.
        if (cur !== undefined) {
          const cur_ix = cur;
          if (ItemBody.is_block(this.tree.at(cur_ix).item.body)) {
            this.inline_stack.pop_all(this.tree);
          }
        }
        cur = this.tree.at(cur_ix).next;
      }
    }
    this.inline_stack.pop_all(this.tree);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:954 scan_inline_link
  /// Returns next byte index, url and title.
  scan_inline_link(underlying: Str, ix: number, node: TreeIndex | undefined): [number, CowStr, CowStr] | undefined {
    const ubytes = underlying.b.subarray(underlying.lo, underlying.hi);
    if (scan_ch(ubytes.subarray(ix), 0x28 /* ( */) === 0) {
      return undefined;
    }
    ix += 1;

    const scan_separator = (ix: MutRef<number>): void => {
      ix.value += scan_while(ubytes.subarray(ix.value), is_ascii_whitespace_no_nl);
      const bl = scan_eol(ubytes.subarray(ix.value));
      if (bl !== undefined) {
        ix.value += bl;
        const line_start = LineStart.new(ubytes.subarray(ix.value));
        scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
        ix.value += line_start.bytes_scanned();
      }
      ix.value += scan_while(ubytes.subarray(ix.value), is_ascii_whitespace_no_nl);
    };

    const ixr: MutRef<number> = { value: ix };
    scan_separator(ixr);

    const d = scan_link_dest(underlying, ixr.value, LINK_MAX_NESTED_PARENS);
    if (d === undefined) return undefined;
    const [dest_length, dest0] = d;
    const dest = unescape(dest0, this.tree.is_in_table());
    ixr.value += dest_length;

    scan_separator(ixr);

    let title: CowStr;
    const t = this.scan_link_title(underlying, ixr.value, node);
    if (t !== undefined) {
      const [bytes_scanned, t_] = t;
      ixr.value += bytes_scanned;
      scan_separator(ixr);
      title = t_;
    } else {
      title = "";
    }
    if (scan_ch(ubytes.subarray(ixr.value), 0x29 /* ) */) === 0) {
      return undefined;
    }
    ixr.value += 1;

    return [ixr.value, dest, title];
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1004 scan_link_title
  // returns (bytes scanned, title cow)
  scan_link_title(text: Str, start_ix: number, node: TreeIndex | undefined): [number, CowStr] | undefined {
    const bytes = text.b.subarray(text.lo, text.hi);
    const b = bytes[start_ix];
    let open: number;
    if (b === 0x27 /* ' */ || b === 0x22 /* " */ || b === 0x28 /* ( */) {
      open = b;
    } else {
      return undefined;
    }
    const close = open === 0x28 /* ( */ ? 0x29 /* ) */ : open;

    let title = "";
    let mark = start_ix + 1;
    let i = start_ix + 1;

    while (i < bytes.length) {
      const c = bytes[i]!;

      if (c === close) {
        let cow: [number, CowStr];
        if (mark === 1) {
          cow = [i - start_ix + 1, text.slice(mark, i).toString()];
        } else {
          title += text.slice(mark, i).toString();
          cow = [i - start_ix + 1, title];
        }

        return cow;
      }
      if (c === open) {
        return undefined;
      }

      if (c === 0x0a /* \n */ || c === 0x0d /* \r */) {
        const node_ix = scan_nodes_to_ix(this.tree, node, i + 1);
        if (node_ix !== undefined) {
          if (this.tree.at(node_ix).item.start > i) {
            title += text.slice(mark, i).toString();
            title += "\n";
            i = this.tree.at(node_ix).item.start;
            mark = i;
            continue;
          }
        }
      }
      if (c === 0x26 /* & */) {
        const [n, value] = scan_entity(bytes.subarray(i));
        if (value !== undefined) {
          title += text.slice(mark, i).toString();
          title += value;
          i += n;
          mark = i;
          continue;
        }
      }
      if (this.tree.is_in_table() && c === 0x5c /* \ */ && i + 2 < bytes.length && bytes[i + 1] === 0x5c /* \ */ && bytes[i + 2] === 0x7c /* | */) {
        // this runs if there are an even number of pipes in a table
        // if it's odd, then it gets parsed as normal
        title += text.slice(mark, i).toString();
        i += 2;
        mark = i;
      }
      if (c === 0x5c /* \ */ && i + 1 < bytes.length && is_ascii_punctuation(bytes[i + 1]!)) {
        title += text.slice(mark, i).toString();
        i += 1;
        mark = i;
      }

      i += 1;
    }

    return undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1082 make_math_span
  make_math_span(open: TreeIndex, close: TreeIndex): void {
    const n0 = this.tree.at(open).next;
    const start_is_display = n0 !== undefined && n0 !== close && this.tree.at(n0).item.body.$ === "MaybeMath" ? n0 : undefined;
    const n1 = this.tree.at(close).next;
    const end_is_display = n1 !== undefined && this.tree.at(n1).item.body.$ === "MaybeMath" ? n1 : undefined;
    const is_display = start_is_display !== undefined && end_is_display !== undefined;
    if (is_display) {
      // This unwrap() can't panic, because if the next variable were None, end_is_display would be None
      close = this.tree.at(close).next!;
      this.tree.at(open).next = close;
      this.tree.at(open).item.end += 1;
      this.tree.at(close).item.start -= 1;
    } else {
      if (this.tree.at(open).item.end === this.tree.at(close).item.start) {
        // inline math spans cannot be empty
        this.tree.at(open).item.body = { $: "Text", backslash_escaped: false };
        return;
      }
      this.tree.at(open).next = close;
    }
    const span_start = this.tree.at(open).item.end;
    const span_end = this.tree.at(close).item.start;

    const bytes = this.text.b.subarray(this.text.lo, this.text.hi);
    let buf: string | undefined = undefined;

    let start_ix = span_start;
    let ix = span_start;
    while (ix < span_end) {
      const c = bytes[ix]!;
      if (c === 0x0d /* \r */ || c === 0x0a /* \n */) {
        ix += 1;
        buf ??= "";
        buf += this.text.slice(start_ix, ix).toString();
        const line_start = LineStart.new(bytes.subarray(ix));
        scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
        ix += line_start.bytes_scanned();
        start_ix = ix;
      } else if (c === 0x5c /* \ */ && bytes[ix + 1] === 0x7c /* | */ && this.tree.is_in_table()) {
        buf ??= "";
        buf += this.text.slice(start_ix, ix).toString();
        buf += "|";
        ix += 2;
        start_ix = ix;
      } else {
        ix += 1;
      }
    }

    let cow: CowStr;
    if (buf !== undefined) {
      buf += this.text.slice(start_ix, span_end).toString();
      cow = buf;
    } else {
      cow = this.text.slice(span_start, span_end).toString();
    }

    this.tree.at(open).item.body = { $: "Math", _0: this.allocs.allocate_cow(cow), _1: is_display };
    this.tree.at(open).item.end = this.tree.at(close).item.end;
    this.tree.at(open).next = this.tree.at(close).next;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1161 make_code_span
  /// Make a code span.
  ///
  /// Both `open` and `close` are matching MaybeCode items.
  make_code_span(open: TreeIndex, close: TreeIndex, preceding_backslash: boolean): void {
    const bytes = this.text.b.subarray(this.text.lo, this.text.hi);
    const span_start = this.tree.at(open).item.end;
    const span_end = this.tree.at(close).item.start;
    let buf: string | undefined = undefined;

    let start_ix = span_start;
    let ix = span_start;
    while (ix < span_end) {
      const c = bytes[ix]!;
      if (c === 0x0d /* \r */ || c === 0x0a /* \n */) {
        buf ??= "";
        buf += this.text.slice(start_ix, ix).toString();
        buf += " ";
        ix += 1;
        const line_start = LineStart.new(bytes.subarray(ix));
        scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
        ix += line_start.bytes_scanned();
        start_ix = ix;
      } else if (c === 0x5c /* \ */ && bytes[ix + 1] === 0x7c /* | */ && this.tree.is_in_table()) {
        buf ??= "";
        buf += this.text.slice(start_ix, ix).toString();
        buf += "|";
        ix += 2;
        start_ix = ix;
      } else {
        ix += 1;
      }
    }

    let opening: boolean;
    let closing: boolean;
    let all_spaces: boolean;
    {
      let s: string;
      if (buf !== undefined) {
        buf += this.text.slice(start_ix, span_end).toString();
        s = buf;
      } else {
        s = this.text.slice(span_start, span_end).toString();
      }
      // PORT: first/last/all bytes are ASCII-space tests, so the JS code units give the same answer.
      opening = s.length > 0 && s.charCodeAt(0) === 0x20;
      closing = s.length > 0 && s.charCodeAt(s.length - 1) === 0x20;
      all_spaces = /^ *$/.test(s);
    }

    let cow: CowStr;
    if (!all_spaces && opening && closing) {
      if (buf !== undefined) {
        // `buf.remove(0); buf.pop();` (both are ASCII spaces)
        cow = buf.slice(1, buf.length - 1);
      } else {
        const lo = span_start + 1;
        const hi = Math.max(span_end - 1, lo);
        cow = this.text.slice(lo, hi).toString();
      }
    } else if (buf !== undefined) {
      cow = buf;
    } else {
      cow = this.text.slice(span_start, span_end).toString();
    }

    if (preceding_backslash) {
      this.tree.at(open).item.body = { $: "Text", backslash_escaped: true };
      this.tree.at(open).item.end = this.tree.at(open).item.start + 1;
      this.tree.at(open).next = close;
      this.tree.at(close).item.body = { $: "Code", _0: this.allocs.allocate_cow(cow) };
      this.tree.at(close).item.start = this.tree.at(open).item.start + 1;
    } else {
      this.tree.at(open).item.body = { $: "Code", _0: this.allocs.allocate_cow(cow) };
      this.tree.at(open).item.end = this.tree.at(close).item.end;
      this.tree.at(open).next = this.tree.at(close).next;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1243 scan_inline_html
  /// On success, returns a buffer containing the inline html and byte offset.
  /// When no bytes were skipped, the buffer will be empty and the html can be
  /// represented as a subslice of the input string.
  scan_inline_html(bytes: Uint8Array, ix: number): [ArrayLike<number>, number] | undefined {
    const c = bytes[ix];
    if (c === undefined) return undefined;
    if (c === 0x21 /* ! */) {
      const r = scan_inline_html_comment(bytes, ix + 1, this.html_scan_guard);
      if (r === undefined) return undefined;
      return [[], r];
    } else if (c === 0x3f /* ? */) {
      const r = scan_inline_html_processing(bytes, ix + 1, this.html_scan_guard);
      if (r === undefined) return undefined;
      return [[], r];
    } else {
      const r = scan_html_block_inner(
        // Subtract 1 to include the < character
        bytes.subarray(ix - 1),
        (bytes: Uint8Array): number => {
          const line_start = LineStart.new(bytes);
          scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
          return line_start.bytes_scanned();
        },
      );
      if (r === undefined) return undefined;
      const [span, i] = r;
      return [span, i + ix - 1];
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1276 into_offset_iter
  /// Consumes the event iterator and produces an iterator that produces
  /// `(Event, Range)` pairs, where the `Range` value maps to the corresponding
  /// range in the markdown source.
  into_offset_iter(): OffsetIter {
    return new OffsetIter(this);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:2144 next
  next(): Event | undefined {
    const cur_ix = this.tree.cur();
    if (cur_ix === undefined) {
      const ix = this.tree.pop();
      if (ix === undefined) return undefined;
      const tag_end = body_to_tag_end(this.tree.at(ix).item.body);
      this.tree.next_sibling(ix);
      return { $: "End", _0: tag_end };
    } else {
      if (ItemBody.is_inline(this.tree.at(cur_ix).item.body)) {
        this.handle_inline();
      }

      const node = this.tree.at(cur_ix);
      const item = clone_Item(node.item);
      const event = item_to_event(item, this.text, this.allocs);
      if (event.$ === "Start") {
        this.tree.push();
      } else {
        this.tree.next_sibling(cur_ix);
      }
      return event;
    }
  }

  *[Symbol.iterator](): Generator<Event> {
    for (let e = this.next(); e !== undefined; e = this.next()) yield e;
  }
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:1282 scan_containers
export function scan_containers(tree: Tree<Item>, line_start: LineStart, gfm_footnotes: boolean): number {
  let i = 0;
  for (const node_ix of tree.walk_spine()) {
    const body = tree.at(node_ix).item.body;
    if (body.$ === "BlockQuote") {
      // `scan_blockquote_marker` saves & restores internally
      if (!line_start.scan_blockquote_marker()) {
        break;
      }
    } else if (body.$ === "ListItem") {
      const indent = body._0;
      const save = line_start.clone();
      if (!line_start.scan_space(indent) && !line_start.is_at_eol()) {
        line_start.assign(save);
        break;
      }
    } else if (body.$ === "FootnoteDefinition" && gfm_footnotes) {
      const save = line_start.clone();
      if (!line_start.scan_space(4) && !line_start.is_at_eol()) {
        line_start.assign(save);
        break;
      }
    }
    i += 1;
  }
  return i;
}

declare module "./tree.ts" {
  interface Tree<T> {
    append_text(this: Tree<Item>, start: number, end: number, backslash_escaped: boolean): void;
    is_in_table(this: Tree<Item>): boolean;
  }
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:1318 append_text
Tree.prototype.append_text = function (this: Tree<Item>, start: number, end: number, backslash_escaped: boolean): void {
  if (end > start) {
    const ix = this.cur();
    if (ix !== undefined) {
      if (this.at(ix).item.body.$ === "Text" && this.at(ix).item.end === start) {
        this.at(ix).item.end = end;
        return;
      }
    }
    this.append({
      start,
      end,
      body: { $: "Text", backslash_escaped },
    });
  }
};

// crate: pulldown-cmark-0.11.3/src/parse.rs:1341 might_be_in_table
function might_be_in_table(item: Item): boolean {
  return ItemBody.is_inline(item.body) || item.body.$ === "TableHead" || item.body.$ === "TableRow" || item.body.$ === "TableCell";
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:1340 is_in_table
/// Returns true if the current node is inside a table.
///
/// If `cur` is an ItemBody::Table, it would return false,
/// but since the `TableRow` and `TableHead` and `TableCell`
/// are children of the table, anything doing inline parsing
/// doesn't need to care about that.
Tree.prototype.is_in_table = function (this: Tree<Item>): boolean {
  const spine = this.walk_spine();
  for (let k = spine.length - 1; k >= 0; k--) {
    const ix = spine[k]!;
    if (this.at(ix).item.body.$ === "Table") {
      return true;
    }
    if (!might_be_in_table(this.at(ix).item)) {
      return false;
    }
  }
  return false;
};

interface InlineEl {
  /// offset of tree node
  start: TreeIndex;
  /// number of delimiters available for matching
  count: number;
  /// length of the run that these delimiters came from
  run_length: number;
  /// b'*', b'_', or b'~'
  c: number;
  /// can both open and close
  both: boolean;
}

class InlineStack {
  constructor(
    public stack: InlineEl[],
    // Lower bounds for matching indices in the stack. For example
    // a strikethrough delimiter will never match with any element
    // in the stack with index smaller than
    // `lower_bounds[InlineStack::TILDES]`.
    public lower_bounds: number[],
  ) {}

  static default_(): InlineStack {
    return new InlineStack([], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }

  /// These are indices into the lower bounds array.
  /// Not both refers to the property that the delimiter can not both
  /// be opener as a closer.
  static readonly UNDERSCORE_NOT_BOTH = 0;
  static readonly ASTERISK_NOT_BOTH = 1;
  static readonly ASTERISK_BASE = 2;
  static readonly TILDES = 5;
  static readonly UNDERSCORE_BASE = 6;

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1392 pop_all
  pop_all(tree: Tree<Item>): void {
    for (const el of this.stack.splice(0)) {
      for (let i = 0; i < el.count; i++) {
        tree.at(TreeIndex.add(el.start, i)).item.body = { $: "Text", backslash_escaped: false };
      }
    }
    this.lower_bounds = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1403 get_lowerbound
  get_lowerbound(c: number, count: number, both: boolean): number {
    if (c === 0x5f /* _ */) {
      const mod3_lower = this.lower_bounds[InlineStack.UNDERSCORE_BASE + (count % 3)]!;
      if (both) {
        return mod3_lower;
      } else {
        return Math.min(mod3_lower, this.lower_bounds[InlineStack.UNDERSCORE_NOT_BOTH]!);
      }
    } else if (c === 0x2a /* * */) {
      const mod3_lower = this.lower_bounds[InlineStack.ASTERISK_BASE + (count % 3)]!;
      if (both) {
        return mod3_lower;
      } else {
        return Math.min(mod3_lower, this.lower_bounds[InlineStack.ASTERISK_NOT_BOTH]!);
      }
    } else {
      return this.lower_bounds[InlineStack.TILDES]!;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1429 set_lowerbound
  set_lowerbound(c: number, count: number, both: boolean, new_bound: number): void {
    if (c === 0x5f /* _ */) {
      if (both) {
        this.lower_bounds[InlineStack.UNDERSCORE_BASE + (count % 3)] = new_bound;
      } else {
        this.lower_bounds[InlineStack.UNDERSCORE_NOT_BOTH] = new_bound;
      }
    } else if (c === 0x2a /* * */) {
      this.lower_bounds[InlineStack.ASTERISK_BASE + (count % 3)] = new_bound;
      if (!both) {
        this.lower_bounds[InlineStack.ASTERISK_NOT_BOTH] = new_bound;
      }
    } else {
      this.lower_bounds[InlineStack.TILDES] = new_bound;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1446 truncate
  truncate(new_bound: number): void {
    if (this.stack.length > new_bound) this.stack.length = new_bound;
    for (let k = 0; k < this.lower_bounds.length; k++) {
      if (this.lower_bounds[k]! > new_bound) {
        this.lower_bounds[k] = new_bound;
      }
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1455 find_match
  find_match(tree: Tree<Item>, c: number, run_length: number, both: boolean): InlineEl | undefined {
    const lowerbound = Math.min(this.stack.length, this.get_lowerbound(c, run_length, both));
    // `self.stack[lowerbound..].iter().cloned().enumerate().rfind(..)`
    let res: [number, InlineEl] | undefined = undefined;
    for (let k = this.stack.length - 1; k >= lowerbound; k--) {
      const el = { ...this.stack[k]! };
      const hit = (() => {
        if (c === 0x7e /* ~ */ && run_length !== el.run_length) {
          return false;
        }
        return el.c === c && ((!both && !el.both) || (run_length + el.run_length) % 3 !== 0 || run_length % 3 === 0);
      })();
      if (hit) {
        res = [k - lowerbound, el];
        break;
      }
    }

    if (res !== undefined) {
      const [matching_ix0, matching_el] = res;
      const matching_ix = matching_ix0 + lowerbound;
      for (const el of this.stack.slice(matching_ix + 1)) {
        for (let i = 0; i < el.count; i++) {
          tree.at(TreeIndex.add(el.start, i)).item.body = { $: "Text", backslash_escaped: false };
        }
      }
      this.truncate(matching_ix);
      return matching_el;
    } else {
      this.set_lowerbound(c, run_length, both, this.stack.length);
      return undefined;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1494 trim_lower_bound
  trim_lower_bound(ix: number): void {
    this.lower_bounds[ix] = Math.min(this.lower_bounds[ix]!, this.stack.length);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1498 push
  push(el: InlineEl): void {
    if (el.c === 0x7e /* ~ */) {
      this.trim_lower_bound(InlineStack.TILDES);
    }
    this.stack.push(el);
  }
}

type RefScan =
  // label, source ix of label end
  | { $: "LinkLabel"; _0: CowStr; _1: number }
  // contains next node index
  | { $: "Collapsed"; _0: TreeIndex | undefined }
  | { $: "UnexpectedFootnote" }
  | { $: "Failed" };

// crate: pulldown-cmark-0.11.3/src/parse.rs:1518 scan_nodes_to_ix
/// Skips forward within a block to a node which spans (ends inclusive) the given
/// index into the source.
function scan_nodes_to_ix(tree: Tree<Item>, node: TreeIndex | undefined, ix: number): TreeIndex | undefined {
  while (node !== undefined) {
    const node_ix: TreeIndex = node;
    if (tree.at(node_ix).item.end <= ix) {
      node = tree.at(node_ix).next;
    } else {
      break;
    }
  }
  return node;
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:1535 scan_link_label
/// Scans an inline link label, which cannot be interrupted.
/// Returns number of bytes (including brackets) and label on success.
function scan_link_label(tree: Tree<Item>, text: Str, allow_footnote_refs: boolean, gfm_footnotes: boolean): [number, ReferenceLabel] | undefined {
  const bytes = text.b.subarray(text.lo, text.hi);
  if (bytes.length < 2 || bytes[0] !== 0x5b /* [ */) {
    return undefined;
  }
  const linebreak_handler = (bytes: Uint8Array): number | undefined => {
    const line_start = LineStart.new(bytes);
    scan_containers(tree, line_start, gfm_footnotes);
    return line_start.bytes_scanned();
  };
  if (allow_footnote_refs && 0x5e /* ^ */ === bytes[1] && bytes[2] !== 0x5d /* ] */) {
    const linebreak_handler2: (bytes: Uint8Array) => number | undefined = gfm_footnotes ? (_) => undefined : linebreak_handler;
    const r = scan_link_label_rest(text.slice(2), linebreak_handler2, tree.is_in_table());
    if (r !== undefined) {
      const [byte_index, cow] = r;
      return [byte_index + 2, { $: "Footnote", _0: cow }];
    }
  }
  const r = scan_link_label_rest(text.slice(1), linebreak_handler, tree.is_in_table());
  if (r === undefined) return undefined;
  const [byte_index, cow] = r;
  return [byte_index + 1, { $: "Link", _0: cow }];
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:1567 scan_reference
function scan_reference(tree: Tree<Item>, text: Str, cur: TreeIndex | undefined, allow_footnote_refs: boolean, gfm_footnotes: boolean): RefScan {
  if (cur === undefined) return { $: "Failed" };
  const cur_ix = cur;
  const start = tree.at(cur_ix).item.start;
  const tail = text.b.subarray(text.lo + start, text.hi);

  if (tail.length >= 2 && tail[0] === 0x5b /* [ */ && tail[1] === 0x5d /* ] */) {
    // TODO: this unwrap is sus and should be looked at closer
    const closing_node = tree.at(cur_ix).next!;
    if (closing_node === undefined) panic("called `Option::unwrap()` on a `None` value");
    return { $: "Collapsed", _0: tree.at(closing_node).next };
  } else {
    const label = scan_link_label(tree, text.slice(start), allow_footnote_refs, gfm_footnotes);
    if (label === undefined) return { $: "Failed" };
    const [ix, l] = label;
    switch (l.$) {
      case "Link":
        return { $: "LinkLabel", _0: l._0, _1: start + ix };
      case "Footnote":
        return { $: "UnexpectedFootnote" };
    }
  }
}

class LinkStack {
  constructor(
    public inner: LinkStackEl[],
    public disabled_ix: number,
  ) {}

  static default_(): LinkStack {
    return new LinkStack([], 0);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1602 push
  push(el: LinkStackEl): void {
    this.inner.push(el);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1606 pop
  pop(): LinkStackEl | undefined {
    const el = this.inner.pop();
    this.disabled_ix = Math.min(this.disabled_ix, this.inner.length);
    return el;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1612 clear
  clear(): void {
    this.inner.length = 0;
    this.disabled_ix = 0;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1617 disable_all_links
  disable_all_links(): void {
    for (let k = this.disabled_ix; k < this.inner.length; k++) {
      const el = this.inner[k]!;
      if (el.ty === "Link") {
        el.ty = "Disabled";
      }
    }
    this.disabled_ix = this.inner.length;
  }
}

interface LinkStackEl {
  node: TreeIndex;
  ty: LinkStackTy;
}

type LinkStackTy = "Link" | "Image" | "Disabled";

/// Contains the destination URL, title and source span of a reference definition.
export interface LinkDef {
  dest: CowStr;
  title: CowStr | undefined;
  span: [number, number];
}

/// Contains the destination URL, title and source span of a reference definition.
export interface FootnoteDef {
  use_count: number;
}

/// Tracks tree indices of code span delimiters of each length. It should prevent
/// quadratic scanning behaviours by providing (amortized) constant time lookups.
class CodeDelims {
  constructor(
    public inner: Map<number, TreeIndex[]>,
    public seen_first: boolean,
  ) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1662 new
  static new(): CodeDelims {
    return new CodeDelims(new Map(), false);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1669 insert
  insert(count: number, ix: TreeIndex): void {
    if (this.seen_first) {
      let q = this.inner.get(count);
      if (q === undefined) this.inner.set(count, (q = []));
      q.push(ix);
    } else {
      // Skip the first insert, since that delimiter will always
      // be an opener and not a closer.
      this.seen_first = true;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1679 is_populated
  is_populated(): boolean {
    return this.inner.size !== 0;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1683 find
  find(open_ix: TreeIndex, count: number): TreeIndex | undefined {
    for (;;) {
      const q = this.inner.get(count);
      if (q === undefined) return undefined;
      const ix = q.shift();
      if (ix === undefined) break;
      if (ix > open_ix) {
        return ix;
      }
    }
    return undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1692 clear
  clear(): void {
    this.inner.clear();
    this.seen_first = false;
  }
}

/// Tracks brace contexts and delimiter length for math delimiters.
/// Provides amortized constant-time lookups.
class MathDelims {
  constructor(public inner: Map<number, [TreeIndex, boolean, boolean][]>) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1705 new
  static new(): MathDelims {
    return new MathDelims(new Map());
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1711 insert
  insert(delim_is_display: boolean, brace_context: number, ix: TreeIndex, can_close: boolean): void {
    let q = this.inner.get(brace_context);
    if (q === undefined) this.inner.set(brace_context, (q = []));
    q.push([ix, can_close, delim_is_display]);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1724 is_populated
  is_populated(): boolean {
    return this.inner.size !== 0;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1728 find
  find(tree: Tree<Item>, open_ix: TreeIndex, is_display: boolean, brace_context: number): TreeIndex | undefined {
    for (;;) {
      const q0 = this.inner.get(brace_context);
      if (q0 === undefined) return undefined;
      const e = q0.shift();
      if (e === undefined) break;
      const [ix, can_close0, delim_is_display] = e;
      if (ix <= open_ix || (is_display && tree.at(open_ix).next === ix)) {
        continue;
      }
      const can_close = can_close0 && tree.at(open_ix).item.end !== tree.at(ix).item.start;
      if ((!is_display && can_close) || (is_display && delim_is_display)) {
        return ix;
      }
      // if we can't use it, leave it in the queue as a tombstone for the next
      // thing that tries to match it
      const q = this.inner.get(brace_context);
      if (q === undefined) return undefined;
      q.unshift([ix, can_close, delim_is_display]);
      break;
    }
    return undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1755 clear
  clear(): void {
    this.inner.clear();
  }
}

export type LinkIndex = number;

export type CowIndex = number;

export type AlignmentIndex = number;

/** `HeadingIndex(NonZeroUsize)`: the 1-based index. */
export type HeadingIndex = number;

/// Used by the heading attributes extension.
export interface HeadingAttributes {
  id: CowStr | undefined;
  classes: CowStr[];
  attrs: [CowStr, CowStr | undefined][];
}

/// Keeps track of the reference definitions defined in the document.
// PORT: `HashMap<LinkLabel, LinkDef>`; see the header.
export class RefDefs {
  constructor(public _0: Map<string, [LinkLabel, LinkDef]>) {}

  static default_(): RefDefs {
    return new RefDefs(new Map());
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1802 get
  /// Performs a lookup on reference label using unicode case folding.
  get(key: string): LinkDef | undefined {
    return this._0.get(UniCase_key(UniCase.new(key)))?.[1];
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1808 iter
  /// Provides an iterator over all the document's reference definitions.
  /// PORT: the pairs in insertion order; upstream's `HashMap` order is unspecified (callers sort).
  iter(): [string, LinkDef][] {
    return [...this._0.values()].map(([k, v]) => [k.as_ref(), v]);
  }

  /** `self.0.entry(label).or_insert(def)` */
  entry_or_insert(label: LinkLabel, def: LinkDef): LinkDef {
    const key = UniCase_key(label);
    const e = this._0.get(key);
    if (e !== undefined) return e[1];
    this._0.set(key, [label, def]);
    return def;
  }

  /** `self.0.contains_key(&label)` */
  contains_key(label: LinkLabel): boolean {
    return this._0.has(UniCase_key(label));
  }
}

/// Keeps track of the footnote definitions defined in the document.
export class FootnoteDefs {
  constructor(public _0: Map<string, [FootnoteLabel, FootnoteDef]>) {}

  static default_(): FootnoteDefs {
    return new FootnoteDefs(new Map());
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1818 contains
  /// Performs a lookup on reference label using unicode case folding.
  contains(key: string): boolean {
    return this._0.has(UniCase_key(UniCase.new(key)));
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1822 get_mut
  /// Performs a lookup on reference label using unicode case folding.
  get_mut(key: CowStr): FootnoteDef | undefined {
    return this._0.get(UniCase_key(UniCase.new(key)))?.[1];
  }

  /** `self.0.insert(label, def)`: an existing equal key keeps its original label, as `HashMap::insert` does. */
  insert(label: FootnoteLabel, def: FootnoteDef): FootnoteDef | undefined {
    const key = UniCase_key(label);
    const e = this._0.get(key);
    if (e !== undefined) {
      const old = e[1];
      e[1] = def;
      return old;
    }
    this._0.set(key, [label, def]);
    return undefined;
  }
}

export class Allocations {
  constructor(
    public refdefs: RefDefs,
    public footdefs: FootnoteDefs,
    public links: [LinkType, CowStr, CowStr, CowStr][],
    public cows: CowStr[],
    public alignments: Alignment[][],
    public headings: HeadingAttributes[],
  ) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1828 new
  static new(): Allocations {
    return new Allocations(RefDefs.default_(), FootnoteDefs.default_(), [], [], [], []);
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1839 allocate_cow
  allocate_cow(cow: CowStr): CowIndex {
    const ix = this.cows.length;
    this.cows.push(cow);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1845 allocate_link
  allocate_link(ty: LinkType, url: CowStr, title: CowStr, id: CowStr): LinkIndex {
    const ix = this.links.length;
    this.links.push([ty, url, title, id]);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1857 allocate_alignment
  allocate_alignment(alignment: Alignment[]): AlignmentIndex {
    const ix = this.alignments.length;
    this.alignments.push(alignment);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1863 allocate_heading
  allocate_heading(attrs: HeadingAttributes): HeadingIndex {
    const ix = this.headings.length;
    this.headings.push(attrs);
    // This won't panic. `self.headings.len()` can't be `usize::MAX` since
    // such a long Vec cannot fit in memory.
    const ix_nonzero = ix + 1;
    return ix_nonzero;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1872 take_cow
  take_cow(ix: CowIndex): CowStr {
    const v = this.cows[ix]!;
    this.cows[ix] = "";
    return v;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1876 take_link
  take_link(ix: LinkIndex): [LinkType, CowStr, CowStr, CowStr] {
    const default_link: [LinkType, CowStr, CowStr, CowStr] = ["ShortcutUnknown", "", "", ""];
    const v = this.links[ix]!;
    this.links[ix] = default_link;
    return v;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1881 take_alignment
  take_alignment(ix: AlignmentIndex): Alignment[] {
    const v = this.alignments[ix]!;
    this.alignments[ix] = [];
    return v;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1889 index
  /** `allocs[CowIndex]` */
  index_cow(ix: CowIndex): CowStr {
    return this.cows[ix]!;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1897 index
  /** `allocs[LinkIndex]` */
  index_link(ix: LinkIndex): [LinkType, CowStr, CowStr, CowStr] {
    return this.links[ix]!;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1905 index
  /** `allocs[AlignmentIndex]` */
  index_alignment(ix: AlignmentIndex): Alignment[] {
    return this.alignments[ix]!;
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1913 index
  /** `allocs[HeadingIndex]` */
  index_heading(ix: HeadingIndex): HeadingAttributes {
    return this.headings[ix - 1]!;
  }
}

/// A struct containing information on the reachability of certain inline HTML
/// elements. In particular, for cdata elements (`<![CDATA[`), processing
/// elements (`<?`) and declarations (`<!DECLARATION`). The respectives usizes
/// represent the indices before which a scan will always fail and can hence
/// be skipped.
export class HtmlScanGuard {
  constructor(
    public cdata: number,
    public processing: number,
    public declaration: number,
    public comment: number,
  ) {}

  static default_(): HtmlScanGuard {
    return new HtmlScanGuard(0, 0, 0, 0);
  }
}

/// Markdown event and source range iterator.
///
/// Generates tuples where the first element is the markdown event and the second
/// is a the corresponding range in the source string.
///
/// Constructed from a `Parser` using its
/// [`into_offset_iter`](struct.Parser.html#method.into_offset_iter) method.
export class OffsetIter {
  constructor(public inner: Parser) {}

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1990 reference_definitions
  /// Returns a reference to the internal reference definition tracker.
  reference_definitions(): RefDefs {
    return this.inner.reference_definitions();
  }

  // crate: pulldown-cmark-0.11.3/src/parse.rs:1998 next
  next(): [Event, [number, number]] | undefined {
    const cur_ix = this.inner.tree.cur();
    if (cur_ix === undefined) {
      const ix = this.inner.tree.pop();
      if (ix === undefined) return undefined;
      const tag_end = body_to_tag_end(this.inner.tree.at(ix).item.body);
      this.inner.tree.next_sibling(ix);
      const span: [number, number] = [this.inner.tree.at(ix).item.start, this.inner.tree.at(ix).item.end];
      // debug_assert!(span.start <= span.end);
      return [{ $: "End", _0: tag_end }, span];
    } else {
      if (ItemBody.is_inline(this.inner.tree.at(cur_ix).item.body)) {
        this.inner.handle_inline();
      }

      const node = this.inner.tree.at(cur_ix);
      const item = clone_Item(node.item);
      const event = item_to_event(item, this.inner.text, this.inner.allocs);
      if (event.$ === "Start") {
        this.inner.tree.push();
      } else {
        this.inner.tree.next_sibling(cur_ix);
      }
      // debug_assert!(item.start <= item.end);
      return [event, [item.start, item.end]];
    }
  }
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:2028 body_to_tag_end
function body_to_tag_end(body: ItemBody): TagEnd {
  switch (body.$) {
    case "Paragraph":
      return { $: "Paragraph" };
    case "Emphasis":
      return { $: "Emphasis" };
    case "Strong":
      return { $: "Strong" };
    case "Strikethrough":
      return { $: "Strikethrough" };
    case "Link":
      return { $: "Link" };
    case "Image":
      return { $: "Image" };
    case "Heading":
      return { $: "Heading", _0: body._0 };
    case "IndentCodeBlock":
    case "FencedCodeBlock":
      return { $: "CodeBlock" };
    case "BlockQuote":
      return { $: "BlockQuote" };
    case "HtmlBlock":
      return { $: "HtmlBlock" };
    case "List": {
      const c = body._1;
      const is_ordered = c === 0x2e /* . */ || c === 0x29 /* ) */;
      return { $: "List", _0: is_ordered };
    }
    case "ListItem":
      return { $: "Item" };
    case "TableHead":
      return { $: "TableHead" };
    case "TableCell":
      return { $: "TableCell" };
    case "TableRow":
      return { $: "TableRow" };
    case "Table":
      return { $: "Table" };
    case "FootnoteDefinition":
      return { $: "FootnoteDefinition" };
    case "MetadataBlock":
      return { $: "MetadataBlock", _0: body._0 };
    default:
      // PORT: `{:?}` of the body is not ported (panic message only).
      return panic(`unexpected item body ${body.$}`);
  }
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:2055 item_to_event
function item_to_event(item: Item, text: Str, allocs: Allocations): Event {
  let tag: Tag;
  const b = item.body;
  switch (b.$) {
    case "Text":
      return { $: "Text", _0: text.slice(item.start, item.end).toString() };
    case "Code":
      return { $: "Code", _0: allocs.take_cow(b._0) };
    case "SynthesizeText":
      return { $: "Text", _0: allocs.take_cow(b._0) };
    case "SynthesizeChar":
      return { $: "Text", _0: String.fromCodePoint(b._0) };
    case "HtmlBlock":
      tag = { $: "HtmlBlock" };
      break;
    case "Html":
      return { $: "Html", _0: text.slice(item.start, item.end).toString() };
    case "InlineHtml":
      return { $: "InlineHtml", _0: text.slice(item.start, item.end).toString() };
    case "OwnedHtml":
      return { $: "Html", _0: allocs.take_cow(b._0) };
    case "SoftBreak":
      return { $: "SoftBreak" };
    case "HardBreak":
      return { $: "HardBreak" };
    case "FootnoteReference":
      return { $: "FootnoteReference", _0: allocs.take_cow(b._0) };
    case "TaskListMarker":
      return { $: "TaskListMarker", _0: b._0 };
    case "Rule":
      return { $: "Rule" };
    case "Paragraph":
      tag = { $: "Paragraph" };
      break;
    case "Emphasis":
      tag = { $: "Emphasis" };
      break;
    case "Strong":
      tag = { $: "Strong" };
      break;
    case "Strikethrough":
      tag = { $: "Strikethrough" };
      break;
    case "Link": {
      const [link_type, dest_url, title, id] = allocs.take_link(b._0);
      tag = { $: "Link", link_type, dest_url, title, id };
      break;
    }
    case "Image": {
      const [link_type, dest_url, title, id] = allocs.take_link(b._0);
      tag = { $: "Image", link_type, dest_url, title, id };
      break;
    }
    case "Heading": {
      const level = b._0;
      if (b._1 !== undefined) {
        const { id, classes, attrs } = allocs.index_heading(b._1);
        tag = { $: "Heading", level, id, classes: [...classes], attrs: attrs.map(([k, v]) => [k, v]) };
      } else {
        tag = { $: "Heading", level, id: undefined, classes: [], attrs: [] };
      }
      break;
    }
    case "FencedCodeBlock":
      tag = { $: "CodeBlock", _0: { $: "Fenced", _0: allocs.take_cow(b._0) } };
      break;
    case "IndentCodeBlock":
      tag = { $: "CodeBlock", _0: CodeBlockKind.Indented };
      break;
    case "BlockQuote":
      tag = { $: "BlockQuote", _0: b._0 };
      break;
    case "List": {
      const c = b._1;
      const listitem_start = b._2;
      if (c === 0x2e /* . */ || c === 0x29 /* ) */) {
        tag = { $: "List", _0: listitem_start };
      } else {
        tag = { $: "List", _0: undefined };
      }
      break;
    }
    case "ListItem":
      tag = { $: "Item" };
      break;
    case "TableHead":
      tag = { $: "TableHead" };
      break;
    case "TableCell":
      tag = { $: "TableCell" };
      break;
    case "TableRow":
      tag = { $: "TableRow" };
      break;
    case "Table":
      tag = { $: "Table", _0: allocs.take_alignment(b._0) };
      break;
    case "FootnoteDefinition":
      tag = { $: "FootnoteDefinition", _0: allocs.take_cow(b._0) };
      break;
    case "MetadataBlock":
      tag = { $: "MetadataBlock", _0: b._0 };
      break;
    case "Math": {
      if (b._1) {
        return { $: "DisplayMath", _0: allocs.take_cow(b._0) };
      } else {
        return { $: "InlineMath", _0: allocs.take_cow(b._0) };
      }
    }
    default:
      // PORT: `{:?}` of the body is not ported (panic message only).
      return panic(`unexpected item body ${b.$}`);
  }

  return { $: "Start", _0: tag };
}
