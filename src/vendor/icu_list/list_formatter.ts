// Port of icu_list 2.3.0 `src/list_formatter.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { Ok, type Result } from "../../std/result.ts";
import { EmptyPreferences } from "../icu_locale_core/preferences/mod.ts";
import type { DataProvider } from "../icu_provider/data_provider.ts";
import type { DataError } from "../icu_provider/error.ts";
import type { DataMarker } from "../icu_provider/marker.ts";
import { DataIdentifierBorrowed, DataRequest } from "../icu_provider/request.ts";
import type { DataPayload } from "../icu_provider/response.ts";
import { writeable_str } from "../writeable/impls.ts";
import {
  type FmtWrite,
  type fmt_Result,
  type LengthHint,
  type Part,
  type PartsWrite,
  type Writeable,
  Writeable_write_to,
  Writeable_write_to_string,
  Writeable_writeable_borrow,
} from "../writeable/lib.ts";
import { add, sum } from "../writeable/ops.ts";
import { ListFormatterOptions, ListLength } from "./options.ts";
import { ConditionalListJoinerPattern_parts, ListFormatterPatterns_length_hint, ListJoinerPattern_parts } from "./patterns.ts";
import { ListAndV1, ListFormatterPatterns, ListOrV1, ListUnitV1 } from "./provider/mod.ts";

// define_preferences!(
/// The preferences for list formatting.
// [Copy] ListFormatterPreferences, {}
// );
// PORT: a preferences struct without keys; see icu_locale_core/preferences/mod.ts `EmptyPreferences`.
export { EmptyPreferences as ListFormatterPreferences } from "../icu_locale_core/preferences/mod.ts";
type ListFormatterPreferences = EmptyPreferences;

/// A formatter that renders sequences of items in an i18n-friendly way. See the
/// [crate-level documentation](crate) for more details.
// #[derive(Debug)]
export class ListFormatter {
  constructor(public data: DataPayload<ListFormatterPatterns>) {}

  // macro_rules! constructor: `` (the compiled-data and buffer constructors that
  // `icu_provider::gen_buffer_data_constructors!` generates need the `compiled_data` / `serde`
  // features, which are off in rustc's build).
  private static constructor_unstable(
    marker: DataMarker<ListFormatterPatterns>,
    provider: DataProvider,
    prefs: ListFormatterPreferences,
    options: ListFormatterOptions,
  ): Result<ListFormatter, DataError> {
    let length;
    switch (options.length ?? ListLength.default()) {
      case "Narrow":
        length = ListFormatterPatterns.NARROW;
        break;
      case "Short":
        length = ListFormatterPatterns.SHORT;
        break;
      case "Wide":
        length = ListFormatterPatterns.WIDE;
        break;
    }
    const locale = marker.INFO.make_locale(prefs.locale_preferences);
    const r = provider.load(marker, DataRequest(DataIdentifierBorrowed.for_marker_attributes_and_locale(length, locale)));
    if (r.$ === "Err") return r;
    const data = r._0.payload.cast();
    return Ok(new ListFormatter(data));
  }

  /// Creates a new [`ListFormatter`] that produces a and-type list using compiled data.
  ///
  /// See the [CLDR spec](https://unicode.org/reports/tr35/tr35-general.html#ListPatterns) for
  /// an explanation of the different types.
  // constructor!(try_new_and, try_new_and_with_buffer_provider, try_new_and_unstable, ListAndV1, "and");
  static try_new_and_unstable(provider: DataProvider, prefs: ListFormatterPreferences, options: ListFormatterOptions): Result<ListFormatter, DataError> {
    return ListFormatter.constructor_unstable(ListAndV1, provider, prefs, options);
  }

  // constructor!(try_new_or, try_new_or_with_buffer_provider, try_new_or_unstable, ListOrV1, "or");
  static try_new_or_unstable(provider: DataProvider, prefs: ListFormatterPreferences, options: ListFormatterOptions): Result<ListFormatter, DataError> {
    return ListFormatter.constructor_unstable(ListOrV1, provider, prefs, options);
  }

  // constructor!(try_new_unit, try_new_unit_with_buffer_provider, try_new_unit_unstable, ListUnitV1, "unit");
  static try_new_unit_unstable(provider: DataProvider, prefs: ListFormatterPreferences, options: ListFormatterOptions): Result<ListFormatter, DataError> {
    return ListFormatter.constructor_unstable(ListUnitV1, provider, prefs, options);
  }

  /// Returns a [`Writeable`] composed of the input [`Writeable`]s and the language-dependent
  /// formatting.
  ///
  /// The [`Writeable`] is annotated with [`parts::ELEMENT`] for input elements,
  /// and [`parts::LITERAL`] for list literals.
  ///
  /// PORT: `I: Iterator<Item = W> + Clone` is any iterable (collected once, so it can be walked
  /// twice); string items are `Writeable` through the `str` impl.
  // crate: icu_list-2.3.0/src/list_formatter.rs:132 format
  format(values: Iterable<Writeable | string>): FormattedList {
    return new FormattedList(this, [...values].map((v) => (typeof v === "string" ? writeable_str(v) : v)));
  }

  /// Returns a [`String`] composed of the input [`Writeable`]s and the language-dependent
  /// formatting.
  ///
  /// ✨ *Enabled with the `alloc` Cargo feature.*
  // crate: icu_list-2.3.0/src/list_formatter.rs:147 format_to_string
  format_to_string(values: Iterable<Writeable | string>): string {
    return this.format(values).write_to_string();
  }
}

/// The [`Part`]s used by [`ListFormatter`].
export const parts = {
  /// The [`Part`] used by [`FormattedList`](super::FormattedList) to mark the part of the string that is an element.
  ///
  /// * `category`: `"list"`
  /// * `value`: `"element"`
  ELEMENT: { category: "list", value: "element" } as Part,

  /// The [`Part`] used by [`FormattedList`](super::FormattedList) to mark the part of the string that is a list literal,
  /// such as ", " or " and ".
  ///
  /// * `category`: `"list"`
  /// * `value`: `"literal"`
  LITERAL: { category: "list", value: "literal" } as Part,
};

/// The [`Writeable`] implementation that is returned by [`ListFormatter::format`]. See
/// the [`writeable`] crate for how to consume this.
// #[derive(Debug)]
export class FormattedList implements Writeable {
  constructor(
    public formatter: ListFormatter,
    public values: readonly Writeable[],
  ) {}

  // impl Writeable for FormattedList
  // crate: icu_list-2.3.0/src/list_formatter.rs:190 write_to_parts
  write_to_parts(sink: PartsWrite): fmt_Result {
    // macro_rules! literal / value
    const literal = (lit: string) => sink.with_part(parts.LITERAL, (l) => l.write_str(lit));
    const value = (val: Writeable) => sink.with_part(parts.ELEMENT, (e) => val.write_to_parts(e));

    const patterns = this.formatter.data.get();

    // `let mut values = self.values.clone();`
    let i = 0;
    const values = this.values;
    const next = (): Writeable | undefined => values[i++];

    let r: fmt_Result;
    const first = next();
    if (first !== undefined) {
      const second = next();
      if (second !== undefined) {
        const third = next();
        if (third !== undefined) {
          // Start(values[0], middle(..., middle(values[n-3], End(values[n-2], values[n-1]))...)) =
          // start_before + values[0] + start_between + (values[1..n-3] + middle_between)* +
          // values[n-2] + end_between + values[n-1] + end_after

          const [start_before, start_between] = ListJoinerPattern_parts(patterns.start);

          if ((r = literal(start_before)).$ === "Err") return r;
          if ((r = value(first)).$ === "Err") return r;
          if ((r = literal(start_between)).$ === "Err") return r;
          if ((r = value(second)).$ === "Err") return r;

          let next_ = third;

          for (let next_next = next(); next_next !== undefined; next_next = next()) {
            const between = patterns.middle;
            if ((r = literal(between)).$ === "Err") return r;
            if ((r = value(next_)).$ === "Err") return r;
            next_ = next_next;
          }

          const [, end_between, end_after] = ConditionalListJoinerPattern_parts(patterns.end, next_);
          if ((r = literal(end_between)).$ === "Err") return r;
          if ((r = value(next_)).$ === "Err") return r;
          return literal(end_after);
        } else {
          // Pair(values[0], values[1]) = pair_before + values[0] + pair_between + values[1] + pair_after
          const [before, between, after] = ConditionalListJoinerPattern_parts(patterns.pair ?? patterns.end, second);
          if ((r = literal(before)).$ === "Err") return r;
          if ((r = value(first)).$ === "Err") return r;
          if ((r = literal(between)).$ === "Err") return r;
          if ((r = value(second)).$ === "Err") return r;
          return literal(after);
        }
      } else {
        return value(first);
      }
    } else {
      return Ok(undefined);
    }
  }

  // crate: icu_list-2.3.0/src/list_formatter.rs:254 writeable_length_hint
  writeable_length_hint(): LengthHint {
    let count = 0;
    const item_length = sum(
      this.values.map((w) => {
        count += 1;
        return w.writeable_length_hint();
      }),
    );
    return add(item_length, ListFormatterPatterns_length_hint(this.formatter.data.get(), count));
  }

  write_to(sink: FmtWrite): fmt_Result {
    return Writeable_write_to(this, sink);
  }
  writeable_borrow(): string | undefined {
    return Writeable_writeable_borrow(this);
  }
  write_to_string(): string {
    return Writeable_write_to_string(this);
  }

  // impl fmt::Display for FormattedList
  // crate: icu_list-2.3.0/src/list_formatter.rs:271 fmt
  fmt(f: FmtWrite): fmt_Result {
    return this.write_to(f);
  }
}

// #[cfg(all(test, feature = "datagen"))] mod tests: needs `ListFormatterPatterns::try_new` (datagen)
// and compiled data; covered by list_formatter.test.ts (with baked data) and the oracle test.
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:281 formatter #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:288 test_slices #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:321 test_into_iterator #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:342 test_iterator #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:359 test_conditional #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:378 test_basic #[cfg(all(test, feature = "datagen"))] (compiled data for "fr" or-lists)
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:383 test_spanish #[cfg(all(test, feature = "datagen"))] (compiled data; the and-list cases run in list_formatter.test.ts)
// crate-skip: icu_list-2.3.0/src/list_formatter.rs:416 test_hebrew #[cfg(all(test, feature = "datagen"))] (compiled data for "he")
