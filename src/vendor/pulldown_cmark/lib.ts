// Port of pulldown-cmark-0.11.3/src/lib.rs (the parser's public types; `html`, `utils` and serde are not ported).
// Copyright 2015 Google Inc. All rights reserved.
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

//! Pull parser for [CommonMark](https://commonmark.org). This crate provides a [Parser](struct.Parser.html) struct
//! which is an iterator over [Event](enum.Event.html)s.
//!
//! PORT (crate-wide, see also the headers of parse.ts and strings.ts):
//! - `CowStr<'a>` is a JS `string` (its Borrowed/Boxed/Inlined variants are a storage detail that
//!   nothing in the parser branches on). Its `len()` is `utf8_len(..)`.
//! - The input `&str` is a `Str` (UTF-8 bytes, byte offsets as upstream); `&[u8]` is a `Uint8Array`
//!   (`&bytes[ix..]` is `bytes.subarray(ix)`).
//! - Fieldless enums are string unions; enums with data are `$`-tagged unions (PORTING.md §5).
//! - `bitflags!` `Options` is a plain `number` with the flag consts on the companion (only
//!   `contains` / `|` are used: `Options.contains(a, b)` = `(a & b) === b`).

import { unreachable } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { Err, Ok } from "../../std/result.ts";

export {
  BrokenLink,
  type BrokenLinkCallback,
  DefaultBrokenLinkCallback,
  type LinkDef,
  type FootnoteDef,
  OffsetIter,
  Parser,
  RefDefs,
} from "./parse.ts";
export { type CowStr } from "./strings.ts";

/// Codeblock kind.
export type CodeBlockKind =
  | { $: "Indented" }
  /// The value contained in the tag describes the language of the code, which may be empty.
  | { $: "Fenced"; _0: string };

export const CodeBlockKind = {
  Indented: { $: "Indented" } as CodeBlockKind,

  // crate: pulldown-cmark-0.11.3/src/lib.rs:116 is_indented
  is_indented(self: CodeBlockKind): boolean {
    return self.$ === "Indented";
  },

  // crate: pulldown-cmark-0.11.3/src/lib.rs:120 is_fenced
  is_fenced(self: CodeBlockKind): boolean {
    return self.$ === "Fenced";
  },
};

/// BlockQuote kind (Note, Tip, Important, Warning, Caution).
export type BlockQuoteKind = "Note" | "Tip" | "Important" | "Warning" | "Caution";
export const BlockQuoteKind = { Note: "Note", Tip: "Tip", Important: "Important", Warning: "Warning", Caution: "Caution" } as const;

/// Metadata block kind.
export type MetadataBlockKind = "YamlStyle" | "PlusesStyle";
export const MetadataBlockKind = { YamlStyle: "YamlStyle", PlusesStyle: "PlusesStyle" } as const;

/// Tags for elements that can contain other elements.
export type Tag =
  /// A paragraph of text and other inline elements.
  | { $: "Paragraph" }
  /// A heading, with optional identifier, classes and custom attributes.
  /// The identifier is prefixed with `#` and the last one in the attributes
  /// list is chosen, classes are prefixed with `.` and custom attributes
  /// have no prefix and can optionally have a value (`myattr` or `myattr=myvalue`).
  | {
      $: "Heading";
      level: HeadingLevel;
      id: string | undefined;
      classes: string[];
      /// The first item of the tuple is the attr and second one the value.
      attrs: [string, string | undefined][];
    }
  | { $: "BlockQuote"; _0: BlockQuoteKind | undefined }
  /// A code block.
  | { $: "CodeBlock"; _0: CodeBlockKind }
  /// A HTML block.
  | { $: "HtmlBlock" }
  /// A list. If the list is ordered the field indicates the number of the first item.
  /// Contains only list items.
  // PORT: `Option<u64>` list start: a `number` (`scan_listitem` caps ordered starts at 9 digits).
  | { $: "List"; _0: number | undefined } // TODO: add delim and tight for ast (not needed for html)
  /// A list item.
  | { $: "Item" }
  /// A footnote definition. The value contained is the footnote's label by which it can
  /// be referred to.
  | { $: "FootnoteDefinition"; _0: string }
  /// A table. Contains a vector describing the text-alignment for each of its columns.
  | { $: "Table"; _0: Alignment[] }
  /// A table header. Contains only `TableCell`s. Note that the table body starts immediately
  /// after the closure of the `TableHead` tag. There is no `TableBody` tag.
  | { $: "TableHead" }
  /// A table row. Is used both for header rows as body rows. Contains only `TableCell`s.
  | { $: "TableRow" }
  | { $: "TableCell" }
  // span-level tags
  | { $: "Emphasis" }
  | { $: "Strong" }
  | { $: "Strikethrough" }
  /// A link.
  | {
      $: "Link";
      link_type: LinkType;
      dest_url: string;
      title: string;
      /// Identifier of reference links, e.g. `world` in the link `[hello][world]`.
      id: string;
    }
  /// An image. The first field is the link type, the second the destination URL and the third is a title,
  /// the fourth is the link identifier.
  | {
      $: "Image";
      link_type: LinkType;
      dest_url: string;
      title: string;
      /// Identifier of reference links, e.g. `world` in the link `[hello][world]`.
      id: string;
    }
  /// A metadata block.
  | { $: "MetadataBlock"; _0: MetadataBlockKind };

export const Tag = {
  Paragraph: { $: "Paragraph" } as Tag,
  HtmlBlock: { $: "HtmlBlock" } as Tag,
  Item: { $: "Item" } as Tag,
  TableHead: { $: "TableHead" } as Tag,
  TableRow: { $: "TableRow" } as Tag,
  TableCell: { $: "TableCell" } as Tag,
  Emphasis: { $: "Emphasis" } as Tag,
  Strong: { $: "Strong" } as Tag,
  Strikethrough: { $: "Strikethrough" } as Tag,

  // crate: pulldown-cmark-0.11.3/src/lib.rs:218 to_end
  to_end(self: Tag): TagEnd {
    switch (self.$) {
      case "Paragraph":
        return TagEnd.Paragraph;
      case "Heading":
        return { $: "Heading", _0: self.level };
      case "BlockQuote":
        return TagEnd.BlockQuote;
      case "CodeBlock":
        return TagEnd.CodeBlock;
      case "HtmlBlock":
        return TagEnd.HtmlBlock;
      case "List":
        return { $: "List", _0: self._0 !== undefined };
      case "Item":
        return TagEnd.Item;
      case "FootnoteDefinition":
        return TagEnd.FootnoteDefinition;
      case "Table":
        return TagEnd.Table;
      case "TableHead":
        return TagEnd.TableHead;
      case "TableRow":
        return TagEnd.TableRow;
      case "TableCell":
        return TagEnd.TableCell;
      case "Emphasis":
        return TagEnd.Emphasis;
      case "Strong":
        return TagEnd.Strong;
      case "Strikethrough":
        return TagEnd.Strikethrough;
      case "Link":
        return TagEnd.Link;
      case "Image":
        return TagEnd.Image;
      case "MetadataBlock":
        return { $: "MetadataBlock", _0: self._0 };
    }
  },
};

/// The end of a `Tag`.
export type TagEnd =
  | { $: "Paragraph" }
  | { $: "Heading"; _0: HeadingLevel }
  | { $: "BlockQuote" }
  | { $: "CodeBlock" }
  | { $: "HtmlBlock" }
  /// A list, `true` for ordered lists.
  | { $: "List"; _0: boolean }
  | { $: "Item" }
  | { $: "FootnoteDefinition" }
  | { $: "Table" }
  | { $: "TableHead" }
  | { $: "TableRow" }
  | { $: "TableCell" }
  | { $: "Emphasis" }
  | { $: "Strong" }
  | { $: "Strikethrough" }
  | { $: "Link" }
  | { $: "Image" }
  | { $: "MetadataBlock"; _0: MetadataBlockKind };

export const TagEnd = {
  Paragraph: { $: "Paragraph" } as TagEnd,
  BlockQuote: { $: "BlockQuote" } as TagEnd,
  CodeBlock: { $: "CodeBlock" } as TagEnd,
  HtmlBlock: { $: "HtmlBlock" } as TagEnd,
  Item: { $: "Item" } as TagEnd,
  FootnoteDefinition: { $: "FootnoteDefinition" } as TagEnd,
  Table: { $: "Table" } as TagEnd,
  TableHead: { $: "TableHead" } as TagEnd,
  TableRow: { $: "TableRow" } as TagEnd,
  TableCell: { $: "TableCell" } as TagEnd,
  Emphasis: { $: "Emphasis" } as TagEnd,
  Strong: { $: "Strong" } as TagEnd,
  Strikethrough: { $: "Strikethrough" } as TagEnd,
  Link: { $: "Link" } as TagEnd,
  Image: { $: "Image" } as TagEnd,

  // crate: pulldown-cmark-0.11.3/src/lib.rs:280 from
  from(value: Tag): TagEnd {
    return Tag.to_end(value);
  },
};

// PORT: `HeadingLevel` has explicit discriminants (H1 = 1 ..); `HeadingLevel_discriminant` gives them.
export type HeadingLevel = "H1" | "H2" | "H3" | "H4" | "H5" | "H6";
export const HeadingLevel = {
  H1: "H1",
  H2: "H2",
  H3: "H3",
  H4: "H4",
  H5: "H5",
  H6: "H6",

  // crate: pulldown-cmark-0.11.3/src/lib.rs:297 fmt
  fmt(self: HeadingLevel): string {
    switch (self) {
      case "H1":
        return "h1";
      case "H2":
        return "h2";
      case "H3":
        return "h3";
      case "H4":
        return "h4";
      case "H5":
        return "h5";
      case "H6":
        return "h6";
    }
  },

  // crate: pulldown-cmark-0.11.3/src/lib.rs:317 try_from
  try_from(value: number): Result<HeadingLevel, InvalidHeadingLevel> {
    switch (value) {
      case 1:
        return Ok("H1");
      case 2:
        return Ok("H2");
      case 3:
        return Ok("H3");
      case 4:
        return Ok("H4");
      case 5:
        return Ok("H5");
      case 6:
        return Ok("H6");
      default:
        return Err({ _0: value });
    }
  },
} as const;
export const HeadingLevel_discriminant: Record<HeadingLevel, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

/// Returned when trying to convert a `usize` into a `Heading` but it fails
/// because the usize isn't a valid heading level
export interface InvalidHeadingLevel {
  _0: number;
}

/// Type specifier for inline links. See [the Tag::Link](enum.Tag.html#variant.Link) for more information.
export type LinkType =
  /// Inline link like `[foo](bar)`
  | "Inline"
  /// Reference link like `[foo][bar]`
  | "Reference"
  /// Reference without destination in the document, but resolved by the broken_link_callback
  | "ReferenceUnknown"
  /// Collapsed link like `[foo][]`
  | "Collapsed"
  /// Collapsed link without destination in the document, but resolved by the broken_link_callback
  | "CollapsedUnknown"
  /// Shortcut link like `[foo]`
  | "Shortcut"
  /// Shortcut without destination in the document, but resolved by the broken_link_callback
  | "ShortcutUnknown"
  /// Autolink like `<http://foo.bar/baz>`
  | "Autolink"
  /// Email address in autolink like `<john@example.org>`
  | "Email";

export const LinkType = {
  Inline: "Inline",
  Reference: "Reference",
  ReferenceUnknown: "ReferenceUnknown",
  Collapsed: "Collapsed",
  CollapsedUnknown: "CollapsedUnknown",
  Shortcut: "Shortcut",
  ShortcutUnknown: "ShortcutUnknown",
  Autolink: "Autolink",
  Email: "Email",

  // crate: pulldown-cmark-0.11.3/src/lib.rs:356 to_unknown
  /// Map the link type to an equivalent _Unknown link type.
  to_unknown(self: LinkType): LinkType {
    switch (self) {
      case "Reference":
        return "ReferenceUnknown";
      case "Collapsed":
        return "CollapsedUnknown";
      case "Shortcut":
        return "ShortcutUnknown";
      default:
        return unreachable();
    }
  },
} as const;

/// Markdown events that are generated in a preorder traversal of the document
/// tree, with additional `End` events whenever all of an inner node's children
/// have been visited.
export type Event =
  /// Start of a tagged element. Events that are yielded after this event
  /// and before its corresponding `End` event are inside this element.
  /// Start and end events are guaranteed to be balanced.
  | { $: "Start"; _0: Tag }
  /// End of a tagged element.
  | { $: "End"; _0: TagEnd }
  /// A text node.
  | { $: "Text"; _0: string }
  /// An inline code node.
  | { $: "Code"; _0: string }
  /// An inline math environment node.
  | { $: "InlineMath"; _0: string }
  /// A display math environment node.
  | { $: "DisplayMath"; _0: string }
  /// An HTML node.
  | { $: "Html"; _0: string }
  /// An inline HTML node.
  | { $: "InlineHtml"; _0: string }
  /// A reference to a footnote with given label, which may or may not be defined
  /// by an event with a `Tag::FootnoteDefinition` tag. Definitions and references to them may
  /// occur in any order.
  | { $: "FootnoteReference"; _0: string }
  /// A soft line break.
  | { $: "SoftBreak" }
  /// A hard line break.
  | { $: "HardBreak" }
  /// A horizontal ruler.
  | { $: "Rule" }
  /// A task list marker, rendered as a checkbox in HTML. Contains a true when it is checked.
  | { $: "TaskListMarker"; _0: boolean };

export const Event = {
  SoftBreak: { $: "SoftBreak" } as Event,
  HardBreak: { $: "HardBreak" } as Event,
  Rule: { $: "Rule" } as Event,
};

/// Table column text alignment.
export type Alignment =
  /// Default text alignment.
  | "None"
  | "Left"
  | "Center"
  | "Right";
export const Alignment = { None: "None", Left: "Left", Center: "Center", Right: "Right" } as const;

/// Option struct containing flags for enabling extra features
/// that are not part of the CommonMark spec.
export type Options = number;
export const Options = {
  ENABLE_TABLES: 1 << 1,
  /// GitHub-compatible footnote syntax.
  ///
  /// Footnotes are referenced with the syntax `[^IDENT]`,
  /// and defined with an identifier followed by a colon at top level.
  ENABLE_FOOTNOTES: 1 << 2,
  ENABLE_STRIKETHROUGH: 1 << 3,
  ENABLE_TASKLISTS: 1 << 4,
  ENABLE_SMART_PUNCTUATION: 1 << 5,
  /// Extension to allow headings to have ID and classes.
  ///
  /// `# text { #id .class1 .class2 myattr other_attr=myvalue }`
  /// is interpreted as a level 1 heading
  /// with the content `text`, ID `id`, classes `class1` and `class2` and
  /// custom attributes `myattr` (without value) and
  /// `other_attr` with value `myvalue`.
  /// Note that ID, classes, and custom attributes should be space-separated.
  ENABLE_HEADING_ATTRIBUTES: 1 << 6,
  /// Metadata blocks in YAML style, i.e.:
  /// - starting with a `---` line
  /// - ending with a `---` or `...` line
  ENABLE_YAML_STYLE_METADATA_BLOCKS: 1 << 7,
  /// Metadata blocks delimited by:
  /// - `+++` line at start
  /// - `+++` line at end
  ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS: 1 << 8,
  /// Older footnote syntax. This flag implies `ENABLE_FOOTNOTES`, changing it to use an
  /// older syntax instead of the new, default, GitHub-compatible syntax.
  ENABLE_OLD_FOOTNOTES: (1 << 9) | (1 << 2),
  /// With this feature enabled, two events `Event::InlineMath` and `Event::DisplayMath`
  /// are emitted that conventionally contain TeX formulas.
  ENABLE_MATH: 1 << 10,
  /// Misc GitHub Flavored Markdown features not supported in CommonMark.
  /// The following features are currently behind this tag:
  /// - Blockquote tags ([!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]).
  ENABLE_GFM: 1 << 11,

  /** bitflags `Options::empty()` */
  empty(): Options {
    return 0;
  },

  /** bitflags `Options::contains`: whether all set bits of `other` are set in `self`. */
  contains(self: Options, other: Options): boolean {
    return (self & other) === other;
  },

  // crate: pulldown-cmark-0.11.3/src/lib.rs:498 has_gfm_footnotes
  has_gfm_footnotes(self: Options): boolean {
    return Options.contains(self, Options.ENABLE_FOOTNOTES) && !Options.contains(self, Options.ENABLE_OLD_FOOTNOTES);
  },
} as const;
