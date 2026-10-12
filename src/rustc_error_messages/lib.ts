// Port of compiler/rustc_error_messages/src/lib.rs.
// Types (DiagMessage, SpanLabel, MultiSpan, DiagArgValue, DiagArgMap, ...) are generated into lib.gen.ts.
//
// PORT: Fluent comes from the vendored crates (src/vendor/fluent_bundle, unic_langid,
// intl_memoizer). `icu_list`, `icu_locale_core` and `rustc_baked_icu_data` are not vendored yet:
// `icu_locale_from_unic_langid` and the `ListFormatter` uses inside
// `fluent_value_from_str_list_sep_by_and` call `unported(...)`.
import { Span } from "../rustc_span/lib.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { debug_str, debug_tuple, debug_vec, PLAIN, type Fmt } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import type { FluentBundle } from "../vendor/fluent_bundle/bundle.ts";
import { debug_FluentError, FluentValue } from "../vendor/fluent_bundle/lib.ts";
import type { MemoizerKind } from "../vendor/fluent_bundle/memoizer.ts";
import { AnyEq_blanket, FluentValue_from_num, type FluentType } from "../vendor/fluent_bundle/types/mod.ts";
import type { IntlLangMemoizer, Memoizable } from "../vendor/intl_memoizer/lib.ts";
import type { IntlLangMemoizer as ConcurrentIntlLangMemoizer } from "../vendor/intl_memoizer/concurrent.ts";
import { TypeId } from "../vendor/type_map/lib.ts";
import { display_LanguageIdentifier, type LanguageIdentifier } from "../vendor/unic_langid/lib.ts";
import {
  MultiSpan,
  type DiagArgValue as DiagArgValue_,
  type DiagMessage as DiagMessage_,
  type SpanLabel,
} from "./lib.gen.ts";
import { String_into_diag_arg } from "./diagnostic_impls.ts";

export * from "./lib.gen.ts";
export * from "./diagnostic_impls.ts";

// pub use fluent_bundle::types::FluentType;
// pub use fluent_bundle::{self, FluentArgs, FluentError, FluentValue};
// pub use unic_langid::{LanguageIdentifier, langid};
export type { FluentType } from "../vendor/fluent_bundle/types/mod.ts";
export * as fluent_bundle from "../vendor/fluent_bundle/lib.ts";
export { FluentArgs, FluentError, FluentValue } from "../vendor/fluent_bundle/lib.ts";
export { LanguageIdentifier, langid } from "../vendor/unic_langid/lib.ts";

/** `std::path::PathBuf` (PORT: a UTF-8 string, see tools/codegen/typemap.errors.json). */
export type PathBuf = string;

// rustc: compiler/rustc_error_messages/src/lib.rs:13 register_functions
export function register_functions<M extends MemoizerKind>(bundle: FluentBundle<M>): void {
  const r = bundle.add_function("STREQ", (positional, _named) => {
    const [a, b] = positional;
    if (positional.length === 2 && a!.$ === "String" && b!.$ === "String") {
      return FluentValue.from_String(`${a!._0 === b!._0}`); // `format!("{}", (a == b)).into()`
    }
    return FluentValue.Error;
  });
  if (r.$ === "Err") {
    panic(`Failed to add a function to the bundle.: ${debug_FluentError(r._0, PLAIN)}`); // `.expect(..)`
  }
}

/// Abstraction over a message in a diagnostic to support both translatable and non-translatable
/// diagnostic messages.
///
/// Intended to be removed once diagnostics are entirely translatable.
export type DiagMessage = DiagMessage_;
export const DiagMessage = {
  // rustc: compiler/rustc_error_messages/src/lib.rs:40 as_str
  as_str(self: DiagMessage): string | undefined {
    switch (self.$) {
      case "Str":
        return self._0;
      case "Inline":
        return undefined;
    }
  },

  /** `impl From<String> for DiagMessage` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:49 from
  from_String(s: string): DiagMessage {
    return { $: "Str", _0: s };
  },

  /** `impl From<&'static str> for DiagMessage` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:54 from
  from_str(s: string): DiagMessage {
    return { $: "Str", _0: s };
  },

  /** `impl From<Cow<'static, str>> for DiagMessage` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:59 from
  from_Cow(s: string): DiagMessage {
    return { $: "Str", _0: s };
  },
};

/** `#[derive(PartialEq)]` on `DiagMessage`. */
export function DiagMessage_eq(a: DiagMessage, b: DiagMessage): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

/**
 * PORT: `impl Into<DiagMessage>` parameters. A `string` goes through `From<String>` / `From<&str>`
 * (both produce `DiagMessage::Str`); a `DiagMessage` is passed through (`From<T> for T`).
 */
export type IntoDiagMessage = DiagMessage | string;

/** PORT: `.into()` for an `impl Into<DiagMessage>` argument (see `IntoDiagMessage`). */
export function into_DiagMessage(m: IntoDiagMessage): DiagMessage {
  return typeof m === "string" ? DiagMessage.from_String(m) : m;
}

declare module "./lib.gen.ts" {
  interface MultiSpan {
    push_primary_span(primary_span: Span): void;
    push_span_label(span: Span, label: IntoDiagMessage): void;
    push_span_context(span: Span): void;
    push_span_diag(span: Span, diag: DiagMessage): void;
    primary_span(): Span | undefined;
    primary_spans_(): readonly Span[];
    has_primary_spans(): boolean;
    is_dummy(): boolean;
    replace(before: Span, after: Span): boolean;
    span_labels_(): SpanLabel[];
    span_context_(): readonly Span[];
    span_labels_raw(): readonly [Span, DiagMessage][];
    has_span_labels(): boolean;
    clone_ignoring_labels(): MultiSpan;
    clone(): MultiSpan;
  }
  namespace MultiSpan {
    function new_(): MultiSpan;
    export { new_ as new };
    export let from_span: (primary_span: Span) => MultiSpan;
    export let from_spans: (vec: Span[]) => MultiSpan;
    export let from_Span: (span: Span) => MultiSpan;
    export let from_Option: (span: Span | undefined) => MultiSpan;
    export let from_Vec: (spans: Span[]) => MultiSpan;
  }
}

// PORT: the getters `primary_spans()`, `span_labels()` and `span_context()` share their names with
// the struct's private fields, so the methods get a trailing underscore (`ms.span_labels_()`).

// rustc: compiler/rustc_error_messages/src/lib.rs:95 new
(MultiSpan as unknown as { new: () => MultiSpan }).new = function (): MultiSpan {
  return new MultiSpan([], [], []);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:99 from_span
MultiSpan.from_span = function (primary_span: Span): MultiSpan {
  return new MultiSpan([primary_span], [], []);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:103 from_spans
MultiSpan.from_spans = function (vec: Span[]): MultiSpan {
  // `sort_by_key(|span| span.lo_hi())` (stable; tuples compare lexicographically).
  vec.sort((a, b) => {
    const [alo, ahi] = Span.lo_hi(a);
    const [blo, bhi] = Span.lo_hi(b);
    return alo !== blo ? alo - blo : ahi - bhi;
  });
  return new MultiSpan(vec, [], []);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:108 push_primary_span
MultiSpan.prototype.push_primary_span = function (this: MultiSpan, primary_span: Span): void {
  this.primary_spans.push(primary_span);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:112 push_span_label
MultiSpan.prototype.push_span_label = function (this: MultiSpan, span: Span, label: IntoDiagMessage): void {
  this.span_labels.push([span, into_DiagMessage(label)]);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:116 push_span_context
MultiSpan.prototype.push_span_context = function (this: MultiSpan, span: Span): void {
  this.span_context.push(span);
};

// rustc: compiler/rustc_error_messages/src/lib.rs:120 push_span_diag
MultiSpan.prototype.push_span_diag = function (this: MultiSpan, span: Span, diag: DiagMessage): void {
  this.span_labels.push([span, diag]);
};

/// Selects the first primary span (if any).
// rustc: compiler/rustc_error_messages/src/lib.rs:125 primary_span
MultiSpan.prototype.primary_span = function (this: MultiSpan): Span | undefined {
  return this.primary_spans[0];
};

/// Returns all primary spans.
// rustc: compiler/rustc_error_messages/src/lib.rs:130 primary_spans
MultiSpan.prototype.primary_spans_ = function (this: MultiSpan): readonly Span[] {
  return this.primary_spans;
};

/// Returns `true` if any of the primary spans are displayable.
// rustc: compiler/rustc_error_messages/src/lib.rs:135 has_primary_spans
MultiSpan.prototype.has_primary_spans = function (this: MultiSpan): boolean {
  return !this.is_dummy();
};

/// Returns `true` if this contains only a dummy primary span with any hygienic context.
// rustc: compiler/rustc_error_messages/src/lib.rs:140 is_dummy
MultiSpan.prototype.is_dummy = function (this: MultiSpan): boolean {
  return this.primary_spans.every((sp) => Span.is_dummy(sp));
};

/// Replaces all occurrences of one Span with another. Used to move `Span`s in areas that don't
/// display well (like std macros). Returns whether replacements occurred.
// rustc: compiler/rustc_error_messages/src/lib.rs:146 replace
MultiSpan.prototype.replace = function (this: MultiSpan, before: Span, after: Span): boolean {
  let replacements_occurred = false;
  for (let i = 0; i < this.primary_spans.length; i++) {
    if (this.primary_spans[i] === before) {
      this.primary_spans[i] = after;
      replacements_occurred = true;
    }
  }
  for (const span_label of this.span_labels) {
    if (span_label[0] === before) {
      span_label[0] = after;
      replacements_occurred = true;
    }
  }
  return replacements_occurred;
};

/// Returns the strings to highlight. We always ensure that there
/// is an entry for each of the primary spans -- for each primary
/// span `P`, if there is at least one label with span `P`, we return
/// those labels (marked as primary). But otherwise we return
/// `SpanLabel` instances with empty labels.
// rustc: compiler/rustc_error_messages/src/lib.rs:168 span_labels
MultiSpan.prototype.span_labels_ = function (this: MultiSpan): SpanLabel[] {
  const is_primary = (span: Span) => this.primary_spans.includes(span);

  const span_labels: SpanLabel[] = this.span_labels.map(([span, label]) => ({
    span,
    is_primary: is_primary(span),
    label: label,
  }));

  for (const span of this.primary_spans) {
    if (!span_labels.some((sl) => sl.span === span)) {
      span_labels.push({ span, is_primary: true, label: undefined });
    }
  }

  return span_labels;
};

// rustc: compiler/rustc_error_messages/src/lib.rs:190 span_context
MultiSpan.prototype.span_context_ = function (this: MultiSpan): readonly Span[] {
  return this.span_context;
};

/// Returns the span labels as contained by `MultiSpan`.
// rustc: compiler/rustc_error_messages/src/lib.rs:195 span_labels_raw
MultiSpan.prototype.span_labels_raw = function (this: MultiSpan): readonly [Span, DiagMessage][] {
  return this.span_labels;
};

/// Returns `true` if any of the span labels is displayable.
// rustc: compiler/rustc_error_messages/src/lib.rs:200 has_span_labels
MultiSpan.prototype.has_span_labels = function (this: MultiSpan): boolean {
  return this.span_labels.some(([sp, _]) => !Span.is_dummy(sp));
};

/// Clone this `MultiSpan` without keeping any of the span labels - sometimes a `MultiSpan` is
/// to be re-used in another diagnostic, but includes `span_labels` which have translated
/// messages. These translated messages would fail to translate without their diagnostic
/// arguments which are unlikely to be cloned alongside the `Span`.
// rustc: compiler/rustc_error_messages/src/lib.rs:208 clone_ignoring_labels
MultiSpan.prototype.clone_ignoring_labels = function (this: MultiSpan): MultiSpan {
  return new MultiSpan([...this.primary_spans], [], []);
};

/** `#[derive(Clone)]` (PORT: `DiagMessage` values are immutable, so a shallow tuple copy suffices). */
MultiSpan.prototype.clone = function (this: MultiSpan): MultiSpan {
  return new MultiSpan(
    [...this.primary_spans],
    this.span_labels.map(([sp, m]) => [sp, m] as [Span, DiagMessage]),
    [...this.span_context],
  );
};

/** `impl From<Span> for MultiSpan` */
// rustc: compiler/rustc_error_messages/src/lib.rs:214 from
MultiSpan.from_Span = function (span: Span): MultiSpan {
  return MultiSpan.from_span(span);
};

/** `impl From<Option<Span>> for MultiSpan` */
// rustc: compiler/rustc_error_messages/src/lib.rs:220 from
MultiSpan.from_Option = function (span: Span | undefined): MultiSpan {
  return MultiSpan.from_spans(span === undefined ? [] : [span]);
};

/** `impl From<Vec<Span>> for MultiSpan` */
// rustc: compiler/rustc_error_messages/src/lib.rs:226 from
MultiSpan.from_Vec = function (spans: Span[]): MultiSpan {
  return MultiSpan.from_spans(spans);
};

/** `#[derive(PartialEq)]` on `MultiSpan`. */
export function MultiSpan_eq(a: MultiSpan, b: MultiSpan): boolean {
  return (
    a.primary_spans.length === b.primary_spans.length &&
    a.primary_spans.every((s, i) => s === b.primary_spans[i]) &&
    a.span_labels.length === b.span_labels.length &&
    a.span_labels.every(([s, m], i) => s === b.span_labels[i]![0] && DiagMessage_eq(m, b.span_labels[i]![1])) &&
    a.span_context.length === b.span_context.length &&
    a.span_context.every((s, i) => s === b.span_context[i])
  );
}

/**
 * PORT: `impl Into<MultiSpan>` parameters: a `MultiSpan` (`From<T> for T`), a `Span` (`From<Span>`),
 * a `Span[]` (`From<Vec<Span>>`) or `undefined` (`From<Option<Span>>` with `None`). A `Some(span)`
 * is passed as the span itself; `From<Option<Span>>` and `From<Span>` agree on it.
 */
export type IntoMultiSpan = MultiSpan | Span | Span[] | undefined;

/** PORT: `.into()` for an `impl Into<MultiSpan>` argument (see `IntoMultiSpan`). */
export function into_MultiSpan(sp: IntoMultiSpan): MultiSpan {
  if (sp instanceof MultiSpan) return sp;
  if (sp === undefined) return MultiSpan.from_Option(undefined);
  if (Array.isArray(sp)) return MultiSpan.from_Vec(sp);
  return MultiSpan.from_Span(sp);
}

/** PORT: stand-in for `icu_locale_core::Locale` (icu_locale_core is not vendored yet). */
export interface IcuLocale {
  readonly __icu_locale: never;
}

// rustc: compiler/rustc_error_messages/src/lib.rs:231 icu_locale_from_unic_langid
function icu_locale_from_unic_langid(lang: LanguageIdentifier): IcuLocale | undefined {
  void display_LanguageIdentifier(lang); // `&lang.to_string()`
  return unported("icu_locale_core::Locale::try_from_str");
}

/** PORT: stand-in for `icu_list::ListFormatter` (icu_list is not vendored yet). */
export interface ListFormatter {
  format_to_string(values: Iterable<string>): string;
}

// rustc: compiler/rustc_error_messages/src/lib.rs:235 fluent_value_from_str_list_sep_by_and
export function fluent_value_from_str_list_sep_by_and(l: string[]): FluentValue {
  // Fluent requires 'static value here for its AnyEq usages.
  // PORT: the fn-local items `FluentStrListSepByAnd` and `MemoizableListFormatter` are the
  // module-level classes below (one class per Rust type, so `AnyEq`'s downcast works across calls).

  const l_ = l.map((x) => x); // `.into_iter().map(|x| x.into_owned()).collect()`

  return { $: "Custom", _0: new FluentStrListSepByAnd(l_) };
}

// #[derive(Clone, PartialEq, Debug)]
class FluentStrListSepByAnd implements FluentType {
  constructor(public _0: string[]) {}

  /** `#[derive(Clone)]` */
  clone(): FluentStrListSepByAnd {
    return new FluentStrListSepByAnd([...this._0]);
  }

  /** `#[derive(PartialEq)]` */
  eq(other: FluentStrListSepByAnd): boolean {
    return this._0.length === other._0.length && this._0.every((s, i) => s === other._0[i]);
  }

  /** `#[derive(Debug)]` */
  fmt(f: Fmt): string {
    return debug_tuple(f, "FluentStrListSepByAnd", [debug_vec(this._0, f, (s) => debug_str(s))]);
  }

  /** `AnyEq` (blanket impl for `T: Any + PartialEq`) */
  equals(other: unknown): boolean {
    return AnyEq_blanket.equals(this, other, (a, b) => a.eq(b));
  }
  as_any(): unknown {
    return AnyEq_blanket.as_any(this);
  }

  // rustc: compiler/rustc_error_messages/src/lib.rs:241 duplicate
  duplicate(): FluentType {
    return this.clone();
  }

  // rustc: compiler/rustc_error_messages/src/lib.rs:245 as_string
  as_string(intls: IntlLangMemoizer): string {
    const result = intls.with_try_get(MemoizableListFormatter_Memoizable, [], (list_formatter) =>
      list_formatter.deref().format_to_string(this._0),
    );
    if (result.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: ()");
    return result._0;
  }

  // rustc: compiler/rustc_error_messages/src/lib.rs:254 as_string_threadsafe
  as_string_threadsafe(intls: ConcurrentIntlLangMemoizer): string {
    const result = intls.with_try_get(MemoizableListFormatter_Memoizable, [], (list_formatter) =>
      list_formatter.deref().format_to_string(this._0),
    );
    if (result.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: ()");
    return result._0;
  }
}

class MemoizableListFormatter {
  constructor(public _0: ListFormatter) {}

  /** `impl std::ops::Deref for MemoizableListFormatter` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:271 deref
  deref(): ListFormatter {
    return this._0;
  }
}

/** `impl intl_memoizer::Memoizable for MemoizableListFormatter` (`type Args = (); type Error = ();`) */
const MemoizableListFormatter_Memoizable: Memoizable<MemoizableListFormatter, [], null> = {
  args_key: () => "",
  memoizer_cache: TypeId.new<Map<string, MemoizableListFormatter>>(
    "HashMap<(), rustc_error_messages::fluent_value_from_str_list_sep_by_and::MemoizableListFormatter>",
  ),

  // rustc: compiler/rustc_error_messages/src/lib.rs:280 construct
  construct(lang: LanguageIdentifier, _args: []): Result<MemoizableListFormatter, null> {
    const locale =
      icu_locale_from_unic_langid(lang) ?? unported("rustc_baked_icu_data::supported_locales::EN");
    void locale;
    // icu_list::ListFormatter::try_new_and_unstable(
    //     &rustc_baked_icu_data::BakedDataProvider,
    //     locale.into(),
    //     icu_list::options::ListFormatterOptions::default()
    //         .with_length(icu_list::options::ListLength::Wide),
    // )
    // .expect("Failed to create list formatter");
    const list_formatter: ListFormatter = unported("icu_list::ListFormatter::try_new_and_unstable");

    return Ok(new MemoizableListFormatter(list_formatter));
  },
};

/// Simplified version of `FluentValue` that can implement `Encodable` and `Decodable`. Converted
/// to a `FluentValue` by the emitter to be used in diagnostic translation.
export type DiagArgValue = DiagArgValue_;
export const DiagArgValue = {
  /** `impl IntoDiagArg for DiagArgValue` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:339 into_diag_arg
  into_diag_arg(self: DiagArgValue, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return self;
  },

  /** `impl From<DiagArgValue> for FluentValue<'static>` */
  // rustc: compiler/rustc_error_messages/src/lib.rs:345 from
  into_FluentValue(val: DiagArgValue): FluentValue {
    switch (val.$) {
      case "Str":
        return FluentValue.from_Cow(val._0);
      case "Number":
        return FluentValue_from_num(val._0);
      case "StrListSepByAnd":
        return fluent_value_from_str_list_sep_by_and(val._0);
    }
  },
};

/** `#[derive(PartialEq)]` on `DiagArgValue`. */
export function DiagArgValue_eq(a: DiagArgValue, b: DiagArgValue): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "StrListSepByAnd") {
    const bl = (b as typeof a)._0;
    return a._0.length === bl.length && a._0.every((s, i) => s === bl[i]);
  }
  return a._0 === (b as typeof a)._0;
}

/// Converts a value of a type into a `DiagArg` (typically a field of an `Diag` struct).
/// Implemented as a custom trait rather than `From` so that it is implemented on the type being
/// converted rather than on `DiagArgValue`, which enables types from other `rustc_*` crates to
/// implement this.
// PORT: Rust picks the impl from the static type; TS values (numbers for chars, symbols and
// integers alike) cannot. So `IntoDiagArg` is a trait object pairing a value with its impl, built
// with the companion constructors (`IntoDiagArg.String(s)`, `IntoDiagArg.number(n)`, ...) or with
// `IntoDiagArg.of(value, <Type>_into_diag_arg)` for impls defined in other crates.
export interface IntoDiagArg {
  /// Convert `Self` into a `DiagArgValue` suitable for rendering in a diagnostic.
  ///
  /// It takes a `path` where "long values" could be written to, if the `DiagArgValue` is too big
  /// for displaying on the terminal. This path comes from the `Diag` itself. When rendering
  /// values that come from `TyCtxt`, like `Ty<'_>`, they can use `TyCtxt::short_string`. If a
  /// value has no shortening logic that could be used, the argument can be safely ignored.
  // rustc: compiler/rustc_error_messages/src/lib.rs:335 into_diag_arg
  into_diag_arg(path: MutRef<PathBuf | undefined>): DiagArgValue;
}

export const IntoDiagArg = {
  /** Pairs `value` with the impl `f` (`impl IntoDiagArg for T`). */
  of<T>(value: T, f: (self: T, path: MutRef<PathBuf | undefined>) => DiagArgValue): IntoDiagArg {
    return { into_diag_arg: (path) => f(value, path) };
  },
  DiagArgValue(v: DiagArgValue): IntoDiagArg {
    return { into_diag_arg: (path) => DiagArgValue.into_diag_arg(v, path) };
  },
  String(s: string): IntoDiagArg {
    return { into_diag_arg: (path) => String_into_diag_arg(s, path) };
  },
};
