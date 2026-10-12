// Port of annotate-snippets =0.12.16 `src/snippet.rs`.
//
//! Structures used as an input for the library.
//
// PORT: the builder structs here have methods named like their fields (`Group::elements`,
// `Title::id`, `Snippet::{source, path, line_start, fold}`, `Annotation::{label,
// highlight_source}`, `Origin::{path, line, char_column}`), which a TS class cannot express. Each
// is an interface plus a same-named companion const whose methods take `self` first. The
// `mut self -> Self` builders update `self` in place and return it (the Rust value is moved, so
// nobody can observe the old one).
// PORT: text types. `Snippet::source` and `Patch::replacement` are byte-indexed (spans are byte
// ranges into them) → `Str`. Every other `Cow<str>` (titles, labels, paths, ids, messages) →
// `string`. `impl Into<Cow<str>>` parameters take the target type directly; `impl
// Into<OptionCow>` parameters take `string | undefined`; `impl Into<Element>` parameters take an
// `Element` (build one with the `Element.from_*` functions).

import { debug_bool, debug_option, debug_struct, debug_tuple, debug_vec, type Debug, type Fmt } from "../../std/fmt.ts";
import type { Str } from "../../std/str.ts";
import { debug_Level, type Level } from "./level.ts";
import { as_substr, TrimmedPatch } from "./renderer/source_map.ts";
import { debug_Range, debug_Str, debug_string, saturating_sub, str_get, type Range } from "./std_ext.ts";

export const ERROR_TXT: string = "error";
export const HELP_TXT: string = "help";
export const INFO_TXT: string = "info";
export const NOTE_TXT: string = "note";
export const WARNING_TXT: string = "warning";

/// A [diagnostic message][Title] and any associated [context][Element] to help users
/// understand it
///
/// The first [`Group`] is the ["primary" group][Level::primary_title], ie it contains the diagnostic
/// message.
///
/// All subsequent [`Group`]s are for distinct pieces of [context][Level::secondary_title].
/// The primary group will be visually distinguished to help tell them apart.
export type Report = readonly Group[];

export interface Id {
  id: string | undefined;
  url: string | undefined;
}

/** `#[derive(Default)] for Id` */
export function Id_default(): Id {
  return { id: undefined, url: undefined };
}

export const debug_Id: Debug<Id> = (v, f) =>
  debug_struct(f, "Id", [
    ["id", debug_option(v.id, f, debug_string)],
    ["url", debug_option(v.url, f, debug_string)],
  ]);

/// A [`Title`] with supporting [context][Element] within a [`Report`]
///
/// [Decor][crate::renderer::DecorStyle] is used to visually connect [`Element`]s of a `Group`.
///
/// Generally, you will create separate group's for:
/// - New [`Snippet`]s, especially if they need their own [`AnnotationKind::Primary`]
/// - Each logically distinct set of [suggestions][Patch`]
export interface Group {
  primary_level: Level;
  title: Title | undefined;
  elements: Element[];
}

export const Group = {
  /// Create group with a [`Title`], deriving [`AnnotationKind::Primary`] from its [`Level`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:57 with_title
  with_title(title: Title): Group {
    const level = title.level;
    const x = Group.with_level(level);
    x.title = title;
    return x;
  },

  /// Create a title-less group with a primary [`Level`] for [`AnnotationKind::Primary`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:73 with_level
  with_level(level: Level): Group {
    return {
      primary_level: level,
      title: undefined,
      elements: [],
    };
  },

  /// Append an [`Element`] that adds context to the [`Title`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:82 element
  element(self: Group, section: Element): Group {
    self.elements.push(section);
    return self;
  },

  /// Append [`Element`]s that adds context to the [`Title`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:88 elements
  elements(self: Group, sections: Iterable<Element>): Group {
    for (const s of sections) self.elements.push(s);
    return self;
  },

  // crate: annotate-snippets-0.12.16/src/snippet.rs:93 is_empty
  is_empty(self: Group): boolean {
    return self.elements.length === 0 && self.title === undefined;
  },
} as const;

export const debug_Group: Debug<Group> = (v, f) =>
  debug_struct(f, "Group", [
    ["primary_level", debug_Level(v.primary_level, f)],
    ["title", debug_option(v.title, f, debug_Title)],
    ["elements", debug_vec(v.elements, f, debug_Element)],
  ]);

/// A section of content within a [`Group`]
export type Element =
  | { readonly $: "Message"; readonly _0: Message }
  | { readonly $: "Cause"; readonly _0: Snippet<Annotation> }
  | { readonly $: "Suggestion"; readonly _0: Snippet<Patch> }
  | { readonly $: "Origin"; readonly _0: Origin }
  | { readonly $: "Padding"; readonly _0: Padding };

export const Element = {
  // impl<'a> From<Message<'a>> for Element<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:110 from
  from_Message(value: Message): Element {
    return { $: "Message", _0: value };
  },

  // impl<'a> From<Snippet<'a, Annotation<'a>>> for Element<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:116 from
  from_Snippet_Annotation(value: Snippet<Annotation>): Element {
    return { $: "Cause", _0: value };
  },

  // impl<'a> From<Snippet<'a, Patch<'a>>> for Element<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:122 from
  from_Snippet_Patch(value: Snippet<Patch>): Element {
    return { $: "Suggestion", _0: value };
  },

  // impl<'a> From<Origin<'a>> for Element<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:128 from
  from_Origin(value: Origin): Element {
    return { $: "Origin", _0: value };
  },

  // impl From<Padding> for Element<'_>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:134 from
  from_Padding(value: Padding): Element {
    return { $: "Padding", _0: value };
  },
} as const;

export const debug_Element: Debug<Element> = (v, f) => {
  switch (v.$) {
    case "Message":
      return debug_tuple(f, "Message", [debug_Message(v._0, f)]);
    case "Cause":
      return debug_tuple(f, "Cause", [debug_Snippet(v._0, f, debug_Annotation)]);
    case "Suggestion":
      return debug_tuple(f, "Suggestion", [debug_Snippet(v._0, f, debug_Patch)]);
    case "Origin":
      return debug_tuple(f, "Origin", [debug_Origin(v._0, f)]);
    case "Padding":
      return debug_tuple(f, "Padding", [debug_Padding(v._0, f)]);
  }
};

/// A whitespace [`Element`] in a [`Group`]
// PORT: unit struct → class without fields; construct with `new Padding()`.
export class Padding {}

export const debug_Padding: Debug<Padding> = () => "Padding";

/// A title that introduces a [`Group`], describing the main point
///
/// To create a `Title`, see [`Level::primary_title`] or [`Level::secondary_title`].
export interface Title {
  level: Level;
  id: Id | undefined;
  text: string;
  allows_styling: boolean;
}

export const Title = {
  /// The category for this [`Report`]
  ///
  /// Useful for looking searching for more information to resolve the diagnostic.
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:180 id
  id(self: Title, id: string): Title {
    (self.id ??= Id_default()).id = id;
    return self;
  },

  /// Provide a URL for [`Title::id`] for more information on this diagnostic
  ///
  /// <div class="warning">
  ///
  /// This is only relevant if `id` is present
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:192 id_url
  id_url(self: Title, url: string): Title {
    (self.id ??= Id_default()).url = url;
    return self;
  },

  /// Append an [`Element`] that adds context to the [`Title`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:198 element
  element(self: Title, section: Element): Group {
    return Group.element(Group.with_title(self), section);
  },

  /// Append [`Element`]s that adds context to the [`Title`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:203 elements
  elements(self: Title, sections: Iterable<Element>): Group {
    return Group.elements(Group.with_title(self), sections);
  },
} as const;

export const debug_Title: Debug<Title> = (v, f) =>
  debug_struct(f, "Title", [
    ["level", debug_Level(v.level, f)],
    ["id", debug_option(v.id, f, debug_Id)],
    ["text", debug_string(v.text, f)],
    ["allows_styling", debug_bool(v.allows_styling, f)],
  ]);

/// A text [`Element`] in a [`Group`]
///
/// See [`Level::message`] to create this.
export interface Message {
  level: Level;
  text: string;
}

export const debug_Message: Debug<Message> = (v, f) =>
  debug_struct(f, "Message", [
    ["level", debug_Level(v.level, f)],
    ["text", debug_string(v.text, f)],
  ]);

/// A source view [`Element`] in a [`Group`]
///
/// If you do not have [source][Snippet::source] available, see instead [`Origin`]
///
/// `Snippet`s come in the following styles (`T`):
/// - With [`Annotation`]s, see [`Snippet::annotation`]
/// - With [`Patch`]s, see [`Snippet::patch`]
export interface Snippet<T> {
  path: string | undefined;
  line_start: number;
  source: Str;
  markers: T[];
  fold: boolean;
}

export const Snippet = {
  /// The source code to be rendered
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:243 source
  source<T>(source: Str): Snippet<T> {
    return {
      path: undefined,
      line_start: 1,
      source: source,
      markers: [],
      fold: true,
    };
  },

  /// When manually [`fold`][Self::fold]ing,
  /// the [`source`][Self::source]s line offset from the original start
  // crate: annotate-snippets-0.12.16/src/snippet.rs:255 line_start
  line_start<T>(self: Snippet<T>, line_start: number): Snippet<T> {
    self.line_start = line_start;
    return self;
  },

  /// The location of the [`source`][Self::source] (e.g. a path)
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:269 path
  path<T>(self: Snippet<T>, path: string | undefined): Snippet<T> {
    self.path = path;
    return self;
  },

  /// Control whether lines without [`Annotation`]s are shown
  ///
  /// The default is `fold(true)`, collapsing uninteresting lines.
  ///
  /// See [`AnnotationKind::Visible`] to force specific spans to be shown.
  // crate: annotate-snippets-0.12.16/src/snippet.rs:279 fold
  fold<T>(self: Snippet<T>, fold: boolean): Snippet<T> {
    self.fold = fold;
    return self;
  },

  /// Highlight and describe a span of text within the [`source`][Self::source]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:287 annotation
  annotation(self: Snippet<Annotation>, annotation: Annotation): Snippet<Annotation> {
    self.markers.push(annotation);
    return self;
  },

  /// Highlight and describe spans of text within the [`source`][Self::source]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:293 annotations
  annotations(self: Snippet<Annotation>, annotation: Iterable<Annotation>): Snippet<Annotation> {
    for (const a of annotation) self.markers.push(a);
    return self;
  },

  /// Suggest to the user an edit to the [`source`][Self::source]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:301 patch
  patch(self: Snippet<Patch>, patch: Patch): Snippet<Patch> {
    self.markers.push(patch);
    return self;
  },

  /// Suggest to the user edits to the [`source`][Self::source]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:307 patches
  patches(self: Snippet<Patch>, patches: Iterable<Patch>): Snippet<Patch> {
    for (const p of patches) self.markers.push(p);
    return self;
  },
} as const;

export function debug_Snippet<T>(v: Snippet<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "Snippet", [
    ["path", debug_option(v.path, f, debug_string)],
    ["line_start", String(v.line_start)],
    ["source", debug_Str(v.source, f)],
    ["markers", debug_vec(v.markers, f, debug_T)],
    ["fold", debug_bool(v.fold, f)],
  ]);
}

/// Highlight and describe a span of text within a [`Snippet`]
///
/// See [`AnnotationKind`] to create an annotation.
export interface Annotation {
  span: Range;
  label: string | undefined;
  kind: AnnotationKind;
  highlight_source: boolean;
}

export const Annotation = {
  /// Describe the reason the span is highlighted
  ///
  /// This will be styled according to the [`AnnotationKind`]
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:345 label
  label(self: Annotation, label: string | undefined): Annotation {
    self.label = label;
    return self;
  },

  /// Style the source according to the [`AnnotationKind`]
  ///
  /// This gives extra emphasis to this annotation
  // crate: annotate-snippets-0.12.16/src/snippet.rs:353 highlight_source
  highlight_source(self: Annotation, highlight_source: boolean): Annotation {
    self.highlight_source = highlight_source;
    return self;
  },
} as const;

export const debug_Annotation: Debug<Annotation> = (v, f) =>
  debug_struct(f, "Annotation", [
    ["span", debug_Range(v.span, f)],
    ["label", debug_option(v.label, f, debug_string)],
    ["kind", debug_AnnotationKind(v.kind, f)],
    ["highlight_source", debug_bool(v.highlight_source, f)],
  ]);

/// The type of [`Annotation`] being applied to a [`Snippet`]
export type AnnotationKind =
  /// For showing the source that the [Group's Title][Group::with_title] references
  ///
  /// For [`Title`]-less groups, see [`Group::with_level`]
  | "Primary"
  /// Additional context to better understand the [`Primary`][Self::Primary]
  /// [`Annotation`]
  ///
  /// See also [`Renderer::context`].
  ///
  /// [`Renderer::context`]: crate::renderer::Renderer
  | "Context"
  /// Prevents the annotated text from getting [folded][Snippet::fold]
  ///
  /// By default, [`Snippet`]s will [fold][`Snippet::fold`] (remove) lines
  /// that do not contain any annotations. [`Visible`][Self::Visible] makes
  /// it possible to selectively prevent this behavior for specific text,
  /// allowing context to be preserved without adding any annotation
  /// characters.
  | "Visible";

export const AnnotationKind = {
  Primary: "Primary",
  Context: "Context",
  Visible: "Visible",

  /// Annotate a byte span within [`Snippet`]
  // crate: annotate-snippets-0.12.16/src/snippet.rs:396 span
  span(self: AnnotationKind, span: Range): Annotation {
    return {
      span,
      label: undefined,
      kind: self,
      highlight_source: false,
    };
  },

  // crate: annotate-snippets-0.12.16/src/snippet.rs:405 is_primary
  is_primary(self: AnnotationKind): boolean {
    return self === "Primary";
  },
} as const;

export const debug_AnnotationKind: Debug<AnnotationKind> = (v) => v;

/// Suggested edit to the [`Snippet`]
///
/// See [`Snippet::patch`]
export interface Patch {
  span: Range;
  replacement: Str;
}

export const Patch = {
  /// Splice `replacement` into the [`Snippet`] at the specified byte span
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:438 new
  new(span: Range, replacement: Str): Patch {
    return {
      span,
      replacement: replacement,
    };
  },

  /// Try to turn a replacement into an addition when the span that is being
  /// overwritten matches either the prefix or suffix of the replacement.
  // crate: annotate-snippets-0.12.16/src/snippet.rs:447 trim_trivial_replacements
  trim_trivial_replacements(self: Patch, source: Str): TrimmedPatch {
    const trimmed = new TrimmedPatch(self.span, self.span, self.replacement);

    if (trimmed.replacement.is_empty()) {
      return trimmed;
    }
    const snippet = str_get(source, trimmed.original_span.start, trimmed.original_span.end);
    if (snippet === undefined) {
      return trimmed;
    }

    const r = as_substr(snippet, trimmed.replacement);
    if (r !== undefined) {
      const [prefix, substr, suffix] = r;
      trimmed.span = { start: trimmed.original_span.start + prefix, end: saturating_sub(trimmed.original_span.end, suffix) };
      trimmed.replacement = substr;
    }
    return trimmed;
  },
} as const;

export const debug_Patch: Debug<Patch> = (v, f) =>
  debug_struct(f, "Patch", [
    ["span", debug_Range(v.span, f)],
    ["replacement", debug_Str(v.replacement, f)],
  ]);

/// A source location [`Element`] in a [`Group`]
///
/// If you have source available, see instead [`Snippet`]
export interface Origin {
  path: string;
  line: number | undefined;
  char_column: number | undefined;
}

export const Origin = {
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:500 path
  path(path: string): Origin {
    return {
      path: path,
      line: undefined,
      char_column: undefined,
    };
  },

  /// Set the default line number to display
  // crate: annotate-snippets-0.12.16/src/snippet.rs:509 line
  line(self: Origin, line: number): Origin {
    self.line = line;
    return self;
  },

  /// Set the default column to display
  ///
  /// <div class="warning">
  ///
  /// `char_column` is only be respected if [`Origin::line`] is also set.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:521 char_column
  char_column(self: Origin, char_column: number): Origin {
    self.char_column = char_column;
    return self;
  },

  // impl<'a> From<Cow<'a, str>> for Origin<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:528 from
  from_Cow(origin: string): Origin {
    return Origin.path(origin);
  },
} as const;

export const debug_Origin: Debug<Origin> = (v, f) =>
  debug_struct(f, "Origin", [
    ["path", debug_string(v.path, f)],
    ["line", debug_option(v.line, f, (n) => String(n))],
    ["char_column", debug_option(v.char_column, f, (n) => String(n))],
  ]);

// PORT: the API takes `string | undefined` wherever upstream takes `impl Into<OptionCow>`; the
// type and its `From` impls are kept for completeness.
export interface OptionCow {
  readonly _0: string | undefined;
}

export const OptionCow = {
  // impl<'a, T: Into<Cow<'a, str>>> From<Option<T>> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:537 from
  from_Option(value: string | undefined): OptionCow {
    return { _0: value };
  },

  // impl<'a> From<&'a Cow<'a, str>> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:543 from
  from_Cow_ref(value: string): OptionCow {
    return { _0: value };
  },

  // impl<'a> From<Cow<'a, str>> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:549 from
  from_Cow(value: string): OptionCow {
    return { _0: value };
  },

  // impl<'a> From<&'a str> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:555 from
  from_str(value: string): OptionCow {
    return { _0: value };
  },

  // impl<'a> From<String> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:560 from
  from_String(value: string): OptionCow {
    return { _0: value };
  },

  // impl<'a> From<&'a String> for OptionCow<'a>
  // crate: annotate-snippets-0.12.16/src/snippet.rs:566 from
  from_String_ref(value: string): OptionCow {
    return { _0: value };
  },
} as const;

export const debug_OptionCow: Debug<OptionCow> = (v, f) => debug_tuple(f, "OptionCow", [debug_option(v._0, f, debug_string)]);
