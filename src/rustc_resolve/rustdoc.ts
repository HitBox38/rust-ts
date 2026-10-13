// Port of compiler/rustc_resolve/src/rustdoc.rs
//
// PORT:
// - `pub use pulldown_cmark;` re-exports the vendored crate (src/vendor/pulldown_cmark).
// - `FxIndexMap<Option<DefId>, DocStrings>` is an insertion-ordered `Map` whose keys are canonicalized
//   through `DefId_hash_key`, so equal `DefId`s share an entry as upstream.
// - `A: AttributeExt + Clone` is the trailing impl table; `attr.clone()` pushes the attribute itself
//   (callers only read the returned attributes).
// - `Box<str>`/`String` results are JS strings; `str::len()` is `utf8_len`. Doc strings are sliced only
//   inside their leading ASCII-whitespace indentation, where UTF-16 and UTF-8 offsets agree.
// - `tracing` `debug!`/`trace!` are comments.
// Init order: top-level code here may touch only this file's `.gen.ts` and other crates.
import type { AttributeExt } from "../rustc_ast/attr/mod.ts";
import { type Attribute, attr as ast_attr, join_path_syms, token } from "../rustc_ast/lib.ts";
// PORT: `rustc_ast::util` is not re-exported by rustc_ast/lib.ts; lib.ts is imported above, so its
// extension modules are loaded before this one is used.
import { beautify_doc_string } from "../rustc_ast/util/comments.ts";
import { DefId_hash_key } from "../rustc_middle/query/caches.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, InnerSpan, Span } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { is_whitespace } from "../std/char.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

type DocFragmentKind = token.DocFragmentKind;
const DocFragmentKind = token.DocFragmentKind;
import { Str, str_lines, utf8, utf8_len } from "../std/str.ts";
import { type BrokenLink, type Event, type LinkType, Options, Parser } from "../vendor/pulldown_cmark/lib.ts";
import type { DocFragment, DocStrings, MalformedGenerics } from "./rustdoc.gen.ts";
import type { Range } from "./lib.ts";

export * from "./rustdoc.gen.ts";
/// Re-export the markdown parser used by rustdoc.
export * as pulldown_cmark from "../vendor/pulldown_cmark/lib.ts";

/** `pulldown_cmark::Options` */
export type { Options } from "../vendor/pulldown_cmark/lib.ts";
/** `pulldown_cmark::LinkType` */
export type { LinkType } from "../vendor/pulldown_cmark/lib.ts";
/** `pulldown_cmark::Parser<'input, F>` (the callback type is erased). */
export type { Parser } from "../vendor/pulldown_cmark/lib.ts";

/** `char::is_whitespace` over a JS string's code points. */
function any_non_whitespace(line: string): boolean {
  for (const c of line) if (!is_whitespace(c.codePointAt(0)!)) return true;
  return false;
}

/// Removes excess indentation on comments in order for the Markdown
/// to be parsed correctly. This is necessary because the convention for
/// writing documentation is to provide a space between the /// or //! marker
/// and the doc text, but Markdown is whitespace-sensitive. For example,
/// a block of text with four-space indentation is parsed as a code block,
/// so if we didn't unindent comments, these list items
///
/// /// A list:
/// ///
/// ///    - Foo
/// ///    - Bar
///
/// would be parsed as if they were in a code block, which is likely not what the user intended.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:108 unindent_doc_fragments
export function unindent_doc_fragments(docs: DocFragment[]): void {
  // `add` is used in case the most common sugared doc syntax is used ("/// "). The other
  // fragments kind's lines are never starting with a whitespace unless they are using some
  // markdown formatting requiring it. Therefore, if the doc block have a mix between the two,
  // we need to take into account the fact that the minimum indent minus one (to take this
  // whitespace into account).
  //
  // For example:
  //
  // /// hello!
  // #[doc = "another"]
  //
  // In this case, you want "hello! another" and not "hello!  another".
  let windows_differ = false;
  for (let i = 0; i + 1 < docs.length; i++) {
    if (!DocFragmentKind_eq(docs[i]!.kind, docs[i + 1]!.kind)) {
      windows_differ = true;
      break;
    }
  }
  const add = windows_differ && docs.some((d) => DocFragmentKind.is_sugared(d.kind))
    ? // In case we have a mix of sugared doc comments and "raw" ones, we want the sugared one to
      // "decide" how much the minimum indent will be.
      1
    : 0;

  // `min_indent` is used to know how much whitespaces from the start of each lines must be
  // removed. Example:
  //
  // ///     hello!
  // #[doc = "another"]
  //
  // In here, the `min_indent` is 1 (because non-sugared fragment are always counted with minimum
  // 1 whitespace), meaning that "hello!" will be considered a codeblock because it starts with 4
  // (5 - 1) whitespaces.
  // PORT: `usize::MAX` is `Infinity` (only compared and subtracted from when finite).
  let min_indent: number | undefined = undefined;
  for (const fragment of docs) {
    let m = Infinity;
    for (const line of str_lines(Symbol.as_str(fragment.doc))) {
      if (!any_non_whitespace(line)) continue;
      // Compare against either space or tab, ignoring whether they are
      // mixed or not.
      let whitespace = 0;
      for (const c of line) {
        if (c === " " || c === "\t") whitespace++;
        else break;
      }
      const v = whitespace + (DocFragmentKind.is_sugared(fragment.kind) ? 0 : add);
      if (v < m) m = v;
    }
    if (min_indent === undefined || m < min_indent) min_indent = m;
  }
  if (min_indent === undefined) {
    return;
  }

  for (const fragment of docs) {
    if (fragment.doc === sym.empty) {
      continue;
    }

    const indent = !DocFragmentKind.is_sugared(fragment.kind) && min_indent > 0 ? min_indent - add : min_indent;

    // PORT: `usize::MAX` (no non-blank line anywhere) stays `usize::MAX` upstream; `Infinity` here.
    fragment.indent = indent;
  }
}

/** `#[derive(PartialEq)] DocFragmentKind` (`Sugared(CommentKind)` / `Raw(Span)`). */
function DocFragmentKind_eq(a: DocFragmentKind, b: DocFragmentKind): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

/// The goal of this function is to apply the `DocFragment` transformation that is required when
/// transforming into the final Markdown, which is applying the computed indent to each line in
/// each doc fragment (a `DocFragment` can contain multiple lines in case of `#[doc = ""]`).
///
/// Note: remove the trailing newline where appropriate
// rustc: compiler/rustc_resolve/src/rustdoc.rs:182 add_doc_fragment
export function add_doc_fragment(out: MutRef<string>, frag: DocFragment): void {
  if (frag.doc === sym.empty) {
    out.value += "\n";
    return;
  }
  const s = Symbol.as_str(frag.doc);

  for (const line of str_lines(s)) {
    if (any_non_whitespace(line)) {
      assert(utf8_len(line) >= frag.indent, "assertion failed: line.len() >= frag.indent");
      out.value += line.slice(frag.indent);
    } else {
      out.value += line;
    }
    out.value += "\n";
  }
}

// rustc: compiler/rustc_resolve/src/rustdoc.rs:201 attrs_to_doc_fragments
/** `A: AttributeExt` is the trailing impl table. */
export function attrs_to_doc_fragments<A>(attrs: Iterable<[A, DefId | undefined]>, doc_only: boolean, A_AttributeExt: AttributeExt<A>): [DocFragment[], A[]] {
  // PORT: `size_hint` / `with_capacity` / `shrink_to_fit` only size the allocations.
  const doc_fragments: DocFragment[] = [];
  const other_attrs: A[] = [];
  for (const [attr, item_id] of attrs) {
    const dk = A_AttributeExt.doc_str_and_fragment_kind(attr);
    if (dk !== undefined) {
      const [doc_str, fragment_kind] = dk;
      const doc = beautify_doc_string(doc_str, DocFragmentKind.comment_kind(fragment_kind));
      const attr_span = A_AttributeExt.span(attr);
      let span: Span;
      let from_expansion: boolean;
      switch (fragment_kind.$) {
        case "Sugared":
          [span, from_expansion] = [attr_span, Span.from_expansion(attr_span)];
          break;
        case "Raw": {
          const value_span = fragment_kind._0;
          [span, from_expansion] = [Span.with_ctxt(value_span, Span.ctxt(attr_span)), Span.from_expansion(value_span)];
          break;
        }
      }
      const style = A_AttributeExt.doc_resolution_scope(attr);
      assert(style !== undefined, "called `Option::unwrap()` on a `None` value");
      const fragment: DocFragment = {
        span,
        doc,
        kind: fragment_kind,
        item_id,
        indent: 0,
        from_expansion,
        style,
      };
      doc_fragments.push(fragment);
    } else if (!doc_only) {
      other_attrs.push(attr);
    }
  }

  unindent_doc_fragments(doc_fragments);

  return [doc_fragments, other_attrs];
}

/// Return the doc-comments on this item, grouped by the module they came from.
/// The module can be different if this is a re-export with added documentation.
///
/// The last newline is not trimmed so the produced strings are reusable between
/// early and late doc link resolution regardless of their position.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:255 prepare_to_doc_link_resolution
export function prepare_to_doc_link_resolution(doc_fragments: readonly DocFragment[]): Map<DefId | undefined, DocStrings> {
  const res = new Map<DefId | undefined, DocStrings>();
  // PORT: `Option<DefId>` keys compare by value: each key is canonicalized to the first equal key
  // object (`KeyedMap` cannot hold the `None` key).
  const canon = new Map<number, DefId | undefined>();
  for (const fragment of doc_fragments) {
    const ck = fragment.item_id === undefined ? -1 : DefId_hash_key(fragment.item_id);
    if (!canon.has(ck)) canon.set(ck, fragment.item_id);
    const key = canon.get(ck);
    let out_strs = res.get(key);
    if (out_strs === undefined) {
      out_strs = { outer: "", inner: "" };
      res.set(key, out_strs);
    }
    const strs = out_strs;
    const out: MutRef<string> =
      fragment.style === "Inner"
        ? {
            get value() {
              return strs.inner;
            },
            set value(v: string) {
              strs.inner = v;
            },
          }
        : {
            get value() {
              return strs.outer;
            },
            set value(v: string) {
              strs.outer = v;
            },
          };
    add_doc_fragment(out, fragment);
  }
  return res;
}

/// Options for rendering Markdown in the main body of documentation.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:272 main_body_opts
export function main_body_opts(): Options {
  return (
    Options.ENABLE_TABLES |
    Options.ENABLE_FOOTNOTES |
    Options.ENABLE_STRIKETHROUGH |
    Options.ENABLE_TASKLISTS |
    Options.ENABLE_SMART_PUNCTUATION
  );
}

// rustc: compiler/rustc_resolve/src/rustdoc.rs:280 strip_generics_from_path_segment
/** `Vec<char>` -> code points. */
export function strip_generics_from_path_segment(segment: number[]): Result<Symbol, MalformedGenerics> {
  let stripped_segment = "";
  let param_depth = 0;

  let latest_generics_chunk = "";

  for (const c of segment) {
    if (c === 0x3c /* < */) {
      param_depth += 1;
      latest_generics_chunk = "";
    } else if (c === 0x3e /* > */) {
      param_depth -= 1;
      if (latest_generics_chunk.includes(" as ")) {
        // The segment tries to use fully-qualified syntax, which is currently unsupported.
        // Give a helpful error message instead of completely ignoring the angle brackets.
        return Err("HasFullyQualifiedSyntax");
      }
    } else if (param_depth === 0) {
      stripped_segment += String.fromCodePoint(c);
    } else {
      latest_generics_chunk += String.fromCodePoint(c);
    }
  }

  if (param_depth === 0) {
    return Ok(Symbol.intern(stripped_segment));
  } else {
    // The segment has unbalanced angle brackets, e.g. `Vec<T` or `Vec<T>>`
    return Err("UnbalancedAngleBrackets");
  }
}

// rustc: compiler/rustc_resolve/src/rustdoc.rs:312 strip_generics_from_path
export function strip_generics_from_path(path_str: string): Result<string, MalformedGenerics> {
  if (!path_str.includes("<") && !path_str.includes(">")) {
    return Ok(path_str);
  }
  const stripped_segments: Symbol[] = [];
  // `path_str.chars().peekable()`
  const chars = [...path_str].map((c) => c.codePointAt(0)!);
  let pos = 0;
  const next = (): number | undefined => (pos < chars.length ? chars[pos++] : undefined);
  let segment: number[] = [];

  for (;;) {
    const chr = next();
    if (chr === undefined) break;
    if (chr === 0x3a /* : */) {
      // `path.next_if_eq(&':')`
      if (chars[pos] === 0x3a /* : */) {
        pos++;
        const taken = segment;
        segment = [];
        const r = strip_generics_from_path_segment(taken);
        if (r.$ === "Err") return r;
        const stripped_segment = r._0;
        if (!Symbol.is_empty(stripped_segment)) {
          stripped_segments.push(stripped_segment);
        }
      } else {
        return Err("InvalidPathSeparator");
      }
    } else if (chr === 0x3c /* < */) {
      segment.push(chr);

      const n = next();
      if (n === 0x3c /* < */) {
        return Err("TooManyAngleBrackets");
      } else if (n === 0x3e /* > */) {
        return Err("EmptyAngleBrackets");
      } else if (n !== undefined) {
        segment.push(n);

        // `while let Some(chr) = path.next_if(|c| *c != '>')`
        while (pos < chars.length && chars[pos] !== 0x3e /* > */) {
          segment.push(chars[pos++]!);
        }
      } else {
        break;
      }
    } else {
      segment.push(chr);
    }
    // trace!("raw segment: {:?}", segment);
  }

  if (segment.length !== 0) {
    const r = strip_generics_from_path_segment(segment);
    if (r.$ === "Err") return r;
    const stripped_segment = r._0;
    if (!Symbol.is_empty(stripped_segment)) {
      stripped_segments.push(stripped_segment);
    }
  }

  // debug!("path_str: {path_str:?}\nstripped segments: {stripped_segments:?}");

  if (stripped_segments.length !== 0) {
    const stripped_path = join_path_syms(stripped_segments);
    return Ok(stripped_path);
  } else {
    return Err("MissingType");
  }
}

/// Has `#[rustc_doc_primitive]` or `#[doc(keyword)]` or `#[doc(attribute)]`.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:376 has_primitive_or_keyword_or_attribute_docs
/** `impl AttributeExt` is the trailing impl table. */
export function has_primitive_or_keyword_or_attribute_docs<A>(attrs: readonly A[], A_AttributeExt: AttributeExt<A>): boolean {
  for (const attr of attrs) {
    if (A_AttributeExt.is_rustc_doc_primitive(attr) || A_AttributeExt.is_doc_keyword_or_attribute(attr)) {
      return true;
    }
  }
  return false;
}

/** `str::trim` (Unicode `White_Space`). */
function str_trim(s: string): string {
  const cps = [...s];
  let lo = 0;
  let hi = cps.length;
  while (lo < hi && is_whitespace(cps[lo]!.codePointAt(0)!)) lo++;
  while (hi > lo && is_whitespace(cps[hi - 1]!.codePointAt(0)!)) hi--;
  return cps.slice(lo, hi).join("");
}

/** `str::trim_suffix` */
function trim_suffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

/// Simplified version of the corresponding function in rustdoc.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:386 preprocess_link
export function preprocess_link(link: string): string {
  // IMPORTANT: To be kept in sync with the corresponding function in rustdoc.
  // Namely, whenever the rustdoc function returns a successful result for a given input,
  // this function *MUST* return a link that's equal to `PreprocessingInfo.path_str`!

  link = link.replaceAll("`", "");
  link = link.split("#")[0]!;
  link = str_trim(link);
  {
    // `split_once('@').map_or(link, |(_, rhs)| rhs)`
    const at = link.indexOf("@");
    if (at >= 0) link = link.slice(at + 1);
  }
  link = trim_suffix(link, "()");
  link = trim_suffix(link, "{}");
  link = trim_suffix(link, "[]");
  link = link !== "!" ? trim_suffix(link, "!") : link;
  link = str_trim(link);
  const r = strip_generics_from_path(link);
  return r.$ === "Ok" ? r._0 : link;
}

/// Keep inline and reference links `[]`,
/// but skip autolinks `<>` which we never consider to be intra-doc links.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:405 may_be_doc_link
export function may_be_doc_link(link_type: LinkType): boolean {
  switch (link_type) {
    case "Inline":
    case "Reference":
    case "ReferenceUnknown":
    case "Collapsed":
    case "CollapsedUnknown":
    case "Shortcut":
    case "ShortcutUnknown":
      return true;
    case "Autolink":
    case "Email":
      return false;
  }
}

/// Simplified version of `preprocessed_markdown_links` from rustdoc.
/// Must return at least the same links as it, but may add some more links on top of that.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:420 attrs_to_preprocessed_links
export function attrs_to_preprocessed_links(attrs: readonly Attribute[]): string[] {
  const [doc_fragments, other_attrs] = attrs_to_doc_fragments(
    attrs.map((attr): [Attribute, DefId | undefined] => [attr, undefined]),
    false,
    ast_attr.AttributeExt.Attribute,
  );
  const doc = prepare_to_doc_link_resolution(doc_fragments).values().next();
  const links = doc.done ? [] : parse_links(`${doc.value.outer}${doc.value.inner}`);

  for (const attr of other_attrs) {
    const note = attr.deprecation_note();
    if (note !== undefined) {
      links.push(...parse_links(note.as_str()));
    }
  }

  return links;
}

/** `<str as Ord>::cmp` (byte order). */
function cmp_str(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/// Similar version of `markdown_links` from rustdoc.
/// This will collect destination links and display text if exists.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:440 parse_links
export function parse_links(doc: string): string[] {
  const broken_link_callback = (link: BrokenLink): [string, string] => [link.reference, ""];
  const event_iter = Parser.new_with_broken_link_callback(Str.from(doc), main_body_opts(), broken_link_callback);
  const links: string[] = [];

  // PORT: `UnordSet<CowStr>` is a `Set<string>` (only `insert` / `contains`).
  const refids = new Set<string>();

  for (let event = event_iter.next(); event !== undefined; event = event_iter.next()) {
    if (event.$ === "Start" && event._0.$ === "Link" && may_be_doc_link(event._0.link_type)) {
      const { link_type, dest_url, id } = event._0;
      if (
        link_type === "Inline" ||
        link_type === "ReferenceUnknown" ||
        link_type === "Reference" ||
        link_type === "Shortcut" ||
        link_type === "ShortcutUnknown"
      ) {
        const display_text = collect_link_data(event_iter);
        if (display_text !== undefined) {
          links.push(display_text);
        }
      }
      if (link_type === "Reference" || link_type === "Shortcut" || link_type === "Collapsed") {
        refids.add(id);
      }

      links.push(preprocess_link(dest_url));
    }
  }

  // `.iter().sorted_by_key(|x| x.0)` (stable sort by the label `&str`)
  const defs = event_iter.reference_definitions().iter();
  defs.sort((a, b) => cmp_str(a[0], b[0]));
  for (const [label, refdef] of defs) {
    if (!refids.has(label)) {
      links.push(preprocess_link(refdef.dest));
    }
  }

  return links;
}

/// Collects additional data of link.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:491 collect_link_data
/** `F: BrokenLinkCallback` is erased (`Parser` holds the callback). */
export function collect_link_data(event_iter: Parser): string | undefined {
  let display_text: string | undefined = undefined;
  const append_text = (text: string): void => {
    if (display_text !== undefined) {
      display_text += text;
    } else {
      display_text = text;
    }
  };

  for (let event: Event | undefined = event_iter.next(); event !== undefined; event = event_iter.next()) {
    if (event.$ === "Text") {
      append_text(event._0);
    } else if (event.$ === "Code") {
      append_text(event._0);
    } else if (event.$ === "End") {
      break;
    }
  }

  return display_text;
}

/// Returns a span encompassing all the document fragments.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:522 span_of_fragments
export function span_of_fragments(fragments: readonly DocFragment[]): Span | undefined {
  if (fragments.length === 0) return undefined;
  const first_fragment = fragments[0]!;
  const last_fragment = fragments[fragments.length - 1]!;
  if (first_fragment.span === DUMMY_SP) {
    return undefined;
  }
  return Span.to(first_fragment.span, last_fragment.span);
}

/// Attempts to match a range of bytes from parsed markdown to a `Span` in the source code.
///
/// This method does not always work, because markdown bytes don't necessarily match source bytes,
/// like if escapes are used in the string. In this case, it returns `None`.
///
/// `markdown` is typically the entire documentation for an item,
/// after combining fragments.
///
/// This method will return `Some` only if one of the following is true:
///
/// - The doc is made entirely from sugared doc comments, which cannot contain escapes
/// - The doc is entirely from a single doc fragment with a string literal exactly equal to
///   `markdown`.
/// - The doc comes from `include_str!`
/// - The doc includes exactly one substring matching `markdown[md_range]` which is contained in a
///   single doc fragment.
///
/// This function is defined in the compiler so it can be used by both `rustdoc` and `clippy`.
///
/// It returns a tuple containing a span encompassing all the document fragments and a boolean that
/// is `true` if any of the *matched* fragments are from a macro expansion.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:555 source_span_for_markdown_range
export function source_span_for_markdown_range(tcx: TyCtxt, markdown: string, md_range: Range<number>, fragments: readonly DocFragment[]): [Span, boolean] | undefined {
  const map = tcx.sess.source_map();
  return source_span_for_markdown_range_inner(map, markdown, md_range, fragments);
}

/** `str::trim_end` on a `Str`, as a `Str`. */
function trim_end(s: Str): Str {
  let hi = s.len();
  // Unicode White_Space: decode backwards over code points.
  const t = s.toString();
  const cps = [...t];
  let k = cps.length;
  while (k > 0 && is_whitespace(cps[k - 1]!.codePointAt(0)!)) {
    hi -= utf8_len(cps[k - 1]!);
    k--;
  }
  return s.slice(0, hi);
}

function str_eq(a: Str, b: Str): boolean {
  if (a.len() !== b.len()) return false;
  for (let i = 0; i < a.len(); i++) if (a.byte(i) !== b.byte(i)) return false;
  return true;
}

/** `haystack.find(pat)` on bytes. */
function find_bytes(haystack: Str, pat: Str, from = 0): number | undefined {
  const n = pat.len();
  outer: for (let i = from; i + n <= haystack.len(); i++) {
    for (let k = 0; k < n; k++) if (haystack.byte(i + k) !== pat.byte(k)) continue outer;
    return i;
  }
  return undefined;
}

/** `s.matches('\n').count()` */
function count_newlines(s: Str): number {
  let n = 0;
  for (let i = 0; i < s.len(); i++) if (s.byte(i) === 0x0a) n++;
  return n;
}

/** `str::split_terminator('\n')` */
function split_terminator_nl(s: Str): Str[] {
  const out: Str[] = [];
  let start = 0;
  for (let i = 0; i < s.len(); i++) {
    if (s.byte(i) === 0x0a) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (start < s.len()) out.push(s.slice(start));
  return out;
}

function any_non_whitespace_str(s: Str): boolean {
  return any_non_whitespace(s.toString());
}

/// Same as `source_span_for_markdown_range` but takes a `SourceMap` instead of a `TyCtxt`.
// rustc: compiler/rustc_resolve/src/rustdoc.rs:566 source_span_for_markdown_range_inner
// inner function used for unit testing
export function source_span_for_markdown_range_inner(map: SourceMap, markdown_: string, md_range: Range<number>, fragments: readonly DocFragment[]): [Span, boolean] | undefined {
  const markdown = Str.from(markdown_);

  if (fragments.length === 1) {
    const fragment = fragments[0]!;
    if (!DocFragmentKind.is_sugared(fragment.kind)) {
      const snippet = map.span_to_snippet(fragment.span);
      // PORT: `u32::try_from(usize)` never fails for in-memory offsets.
      if (snippet.$ === "Ok" && str_eq(trim_end(snippet._0), trim_end(markdown))) {
        const md_range_lo = md_range.start;
        const md_range_hi = md_range.end;
        // Single fragment with string that contains same bytes as doc.
        return [
          Span.new(
            BytePos(Span.lo(fragment.span) + md_range_lo),
            BytePos(Span.lo(fragment.span) + md_range_hi),
            Span.ctxt(fragment.span),
            Span.parent(fragment.span),
          ),
          fragment.from_expansion,
        ];
      }
    }
  }

  const is_all_sugared_doc = fragments.every((frag) => DocFragmentKind.is_sugared(frag.kind));

  if (!is_all_sugared_doc) {
    // This case ignores the markdown outside of the range so that it can
    // work in cases where the markdown is made from several different
    // doc fragments, but the target range does not span across multiple
    // fragments.
    let match_data: [number, number] | undefined = undefined;
    const pat = markdown.slice(md_range.start, md_range.end);
    // This heirustic doesn't make sense with a zero-sized range.
    if (pat.is_empty()) {
      return undefined;
    }
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i]!;
      const snippet = map.span_to_snippet(fragment.span);
      if (snippet.$ !== "Ok") continue;
      const match_start = find_bytes(snippet._0, pat);
      if (match_start !== undefined) {
        // If there is either a match in a previous fragment, or
        // multiple matches in this fragment, there is ambiguity.
        // the snippet cannot be zero-sized, because it matches
        // the pattern, which is checked to not be zero sized.
        // `snippet.as_bytes()[match_start + 1..].windows(pat.len()).any(|s| s == pat.as_bytes())`
        if (match_data === undefined && find_bytes(snippet._0, pat, match_start + 1) === undefined) {
          match_data = [i, match_start];
        } else {
          // Heuristic produced ambiguity, return nothing.
          return undefined;
        }
      }
    }
    if (match_data !== undefined) {
      const [i, match_start] = match_data;
      const fragment = fragments[i]!;
      const sp = fragment.span;
      // we need to calculate the span start,
      // then use that in our calculations for the span end
      const lo = BytePos(Span.lo(sp) + match_start);
      return [Span.with_hi(Span.with_lo(sp, lo), BytePos(lo + (md_range.end - md_range.start))), fragment.from_expansion];
    }
    return undefined;
  }

  const sof = span_of_fragments(fragments);
  if (sof === undefined) return undefined;
  const snippet_r = map.span_to_snippet(sof);
  if (snippet_r.$ !== "Ok") return undefined;
  const snippet = snippet_r._0;

  const starting_line = count_newlines(markdown.slice(0, md_range.start));
  const ending_line = starting_line + count_newlines(markdown.slice(md_range.start, md_range.end));

  // We use `split_terminator('\n')` instead of `lines()` when counting bytes so that we treat
  // CRLF and LF line endings the same way.
  const src_lines = split_terminator_nl(snippet);
  let src_pos = 0;
  const md_lines = split_terminator_nl(markdown);

  // The number of bytes from the source span to the markdown span that are not part
  // of the markdown, like comment markers.
  let start_bytes = 0;
  let end_bytes = 0;

  const span_of_all_fragments_ = span_of_fragments(fragments);
  if (span_of_all_fragments_ === undefined) return undefined;
  const span_of_all_fragments: Span = span_of_all_fragments_;

  let prev_lines_bytes = 0;
  outer: for (let line_no = 0; line_no < md_lines.length; line_no++) {
    const md_line = md_lines[line_no]!;
    for (;;) {
      const source_line = src_lines[src_pos++];
      if (source_line === undefined) return undefined;
      const source_line_len = source_line.len();
      const source_line_span = Span.split_at(Span.split_at(span_of_all_fragments, prev_lines_bytes)[1], source_line_len)[0];
      const fragment = fragments
        // `source_line_span` might contain indentation that `fragment.span` doesn't contain
        .find((fragment) => Span.overlaps(fragment.span, source_line_span));
      // Since we're counting bytes, `prev_line_bytes` includes the "\n".
      prev_lines_bytes += source_line_len + 1;
      const offset = fragment !== undefined ? find_bytes(source_line, md_line) : undefined;
      if (fragment !== undefined && offset !== undefined) {
        if (
          Span.lo(fragment.span) > Span.lo(source_line_span) &&
          any_non_whitespace_str(source_line.slice(0, Span.lo(fragment.span) - Span.lo(source_line_span)))
        ) {
          // Make sure anything between the start of this line and the fragment itself is just indentation.
          // Because source_line is built by splitting the span that covers all fragments, this only finds
          // characters *between* doc comments, not characters before or after doc comments.
          //
          //     1| /** doc */
          //     2| #[inline] /** doc2 */
          //        ^^^^^^^^^
          //        | this
          //
          //     3| fn foo() {}
          return undefined;
        }
        if (
          Span.hi(fragment.span) < Span.hi(source_line_span) &&
          any_non_whitespace_str(source_line.slice(Span.hi(fragment.span) - Span.lo(source_line_span)))
        ) {
          // Make sure anything between the start of this line and the fragment itself is just indentation.
          // Because source_line is built by splitting the span that covers all fragments, this only finds
          // characters *between* doc comments, not characters before or after doc comments.
          //     1| /** doc */ #[inline]
          //                   ^^^^^^^^^
          //                   | this
          //
          //     2| /** doc2 */
          //     3| fn foo() {}
          return undefined;
        }
        if (line_no === starting_line) {
          start_bytes += offset;

          if (starting_line === ending_line) {
            break outer;
          }
        } else if (line_no === ending_line) {
          end_bytes += offset;
          break outer;
        } else if (line_no < starting_line) {
          start_bytes += source_line.len() - md_line.len();
        } else {
          end_bytes += source_line.len() - md_line.len();
        }
        break;
      } else {
        // Since this is a source line that doesn't include a markdown line,
        // we have to count it and its newline as non-markdown bytes.
        if (line_no <= starting_line) {
          start_bytes += source_line.len() + 1;
        } else if (any_non_whitespace_str(source_line)) {
          // We're past the first line, but haven't found the last line,
          // but we found a non-empty non-markdown line.
          // This could be an attribute, and we don't want a diagnostic
          // suggesting to delete that attribute, so we return None to be safe.
          //     1| /** doc */
          //     2 | #[inline]
          //          ^^^^^^^^^
          //          | this
          //     3| /** doc2 */
          //     4| fn foo() {}
          return undefined;
        } else {
          end_bytes += source_line.len() + 1;
        }
      }
    }
  }

  const src_span = Span.from_inner(span_of_all_fragments, InnerSpan.new(md_range.start + start_bytes, md_range.end + start_bytes + end_bytes));
  return [src_span, fragments.some((frag) => Span.overlaps(frag.span, src_span) && frag.from_expansion)];
}
