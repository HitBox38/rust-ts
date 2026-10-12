//! `types` module contains types necessary for Fluent runtime
//! value handling.
//! The core struct is [`FluentValue`] which is a type that can be passed
//! to the [`FluentBundle::format_pattern`](crate::bundle::FluentBundle) as an argument, it can be passed
//! to any Fluent Function, and any function may return it.
//!
//! This part of functionality is not fully hashed out yet, since we're waiting
//! for the internationalization APIs to mature, at which point all number
//! formatting operations will be moved out of Fluent.
//!
//! For now, [`FluentValue`] can be a string, a number, or a custom [`FluentType`]
//! which allows users of the library to implement their own types of values,
//! such as dates, or more complex structures needed for their bindings.
//
// Port of fluent-bundle 0.16.0, src/types/mod.rs.
// PORT: `Cow<'source, str>` is a JS `string` (Borrowed and Owned are indistinguishable here).
import { debug_str, debug_tuple, type Fmt } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import type { FmtError, Write } from "../../fluent_syntax/unicode.ts";
import type { IntlLangMemoizer } from "../../intl_memoizer/lib.ts";
import type { IntlLangMemoizer as ConcurrentIntlLangMemoizer } from "../../intl_memoizer/concurrent.ts";
import { PluralCategory, PluralRuleType } from "../../intl_pluralrules/lib.ts";
import type { MemoizerKind } from "../memoizer.ts";
import type { Scope } from "../resolver/scope.ts";
import {
  debug_FluentNumber,
  FluentNumber,
  FluentValue_from_FluentNumber,
  PluralOperands_from_FluentNumber,
} from "./number.ts";
import { PluralRules, PluralRules_Memoizable } from "./plural.ts";

export * from "./number.ts";
export { PluralRules, PluralRules_Memoizable } from "./plural.ts";

/// Custom types can implement the [`FluentType`] trait in order to generate a string
/// value for use in the message generation process.
export interface FluentType extends AnyEq {
  /** PORT: the `fmt::Debug` supertrait (`{:?}` / `{:#?}` of the value). */
  fmt(f: Fmt): string;

  /// Create a clone of the underlying type.
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:35 duplicate
  duplicate(): FluentType;

  /// Convert the custom type into a string value, for instance a custom `DateTime`
  /// type could return "Oct. 27, 2022".
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:39 as_string
  as_string(intls: IntlLangMemoizer): string;

  /// Convert the custom type into a string value, for instance a custom `DateTime`
  /// type could return "Oct. 27, 2022". This operation is provided the threadsafe
  /// [`IntlLangMemoizer`](intl_memoizer::concurrent::IntlLangMemoizer).
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:44 as_string_threadsafe
  as_string_threadsafe(intls: ConcurrentIntlLangMemoizer): string;
}

/** `impl PartialEq for dyn FluentType + Send` */
// crate: fluent-bundle-0.16.0/src/types/mod.rs:51 eq
export function FluentType_eq(self: FluentType, other: FluentType): boolean {
  return self.equals(other.as_any());
}

export interface AnyEq {
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:57 equals
  equals(other: unknown): boolean;
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:58 as_any
  as_any(): unknown;
}

/**
 * `impl<T: Any + PartialEq> AnyEq for T`: implementors call these with their own `PartialEq`.
 * PORT: `other.downcast_ref::<Self>()` succeeds iff `other` is an instance of the same class
 * (the class stands for the `TypeId`).
 */
export const AnyEq_blanket = {
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:62 equals
  equals<T extends object>(self: T, other: unknown, eq: (a: T, b: T) => boolean): boolean {
    const downcast =
      typeof other === "object" && other !== null && Object.getPrototypeOf(other) === Object.getPrototypeOf(self)
        ? (other as T)
        : undefined;
    return downcast !== undefined && eq(downcast, self);
  },
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:65 as_any
  as_any<T>(self: T): unknown {
    return self;
  },
};

/// The `FluentValue` enum represents values which can be formatted to a String.
///
/// Those values are either passed as arguments to [`FluentBundle::format_pattern`] or
/// produced by functions, or generated in the process of pattern resolution.
///
/// [`FluentBundle::format_pattern`]: crate::bundle::FluentBundle::format_pattern
// #[derive(Debug)]
export type FluentValue =
  | { readonly $: "String"; readonly _0: string }
  | { readonly $: "Number"; readonly _0: FluentNumber }
  | { readonly $: "Custom"; readonly _0: FluentType }
  | { readonly $: "None" }
  | { readonly $: "Error" };

export const FluentValue = {
  None: Object.freeze({ $: "None" }) as FluentValue,
  Error: Object.freeze({ $: "Error" }) as FluentValue,

  /** `impl PartialEq for FluentValue<'_>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:86 eq
  eq(self: FluentValue, other: FluentValue): boolean {
    if (self.$ === "String" && other.$ === "String") return self._0 === other._0;
    if (self.$ === "Number" && other.$ === "Number") return self._0.eq(other._0);
    if (self.$ === "Custom" && other.$ === "Custom") return FluentType_eq(self._0, other._0);
    return false;
  },

  /** `impl Clone for FluentValue<'_>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:97 clone
  clone(self: FluentValue): FluentValue {
    switch (self.$) {
      case "String":
        return { $: "String", _0: self._0 };
      case "Number":
        return { $: "Number", _0: self._0.clone() };
      case "Custom": {
        const new_value: FluentType = self._0.duplicate();
        return { $: "Custom", _0: new_value };
      }
      case "Error":
        return FluentValue.Error;
      case "None":
        return FluentValue.None;
    }
  },

  /// Attempts to parse the string representation of a `value` that supports
  /// [`ToString`] into a [`FluentValue::Number`]. If it fails, it will instead
  /// convert it to a [`FluentValue::String`].
  ///
  /// ```
  /// use fluent_bundle::types::{FluentNumber, FluentNumberOptions, FluentValue};
  ///
  /// // "2" parses into a `FluentNumber`
  /// assert_eq!(
  ///     FluentValue::try_number("2"),
  ///     FluentValue::Number(FluentNumber::new(2.0, FluentNumberOptions::default()))
  /// );
  ///
  /// // Floats can be parsed as well.
  /// assert_eq!(
  ///     FluentValue::try_number("3.141569"),
  ///     FluentValue::Number(FluentNumber::new(
  ///         3.141569,
  ///         FluentNumberOptions {
  ///             minimum_fraction_digits: Some(6),
  ///             ..Default::default()
  ///         }
  ///     ))
  /// );
  ///
  /// // When a value is not a valid number, it falls back to a `FluentValue::String`
  /// assert_eq!(
  ///     FluentValue::try_number("A string"),
  ///     FluentValue::String("A string".into())
  /// );
  /// ```
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:143 try_number
  try_number(value: string): FluentValue {
    const r = FluentNumber.from_str(value);
    if (r.$ === "Ok") {
      const number = r._0;
      return FluentValue_from_FluentNumber(number);
    } else {
      return FluentValue.from_str(value);
    }
  },

  /// Checks to see if two [`FluentValues`](FluentValue) match each other by having the
  /// same type and contents. The special exception is in the case of a string being
  /// compared to a number. Here attempt to check that the plural rule category matches.
  ///
  /// ```
  /// use fluent_bundle::resolver::Scope;
  /// use fluent_bundle::{types::FluentValue, FluentBundle, FluentResource};
  /// use unic_langid::langid;
  ///
  /// let langid_ars = langid!("en");
  /// let bundle: FluentBundle<FluentResource> = FluentBundle::new(vec![langid_ars]);
  /// let scope = Scope::new(&bundle, None, None);
  ///
  /// // Matching examples:
  /// assert!(FluentValue::try_number("2").matches(&FluentValue::try_number("2"), &scope));
  /// assert!(FluentValue::from("fluent").matches(&FluentValue::from("fluent"), &scope));
  /// assert!(
  ///     FluentValue::from("one").matches(&FluentValue::try_number("1"), &scope),
  ///     "Plural rules are matched."
  /// );
  ///
  /// // Non-matching examples:
  /// assert!(!FluentValue::try_number("2").matches(&FluentValue::try_number("3"), &scope));
  /// assert!(!FluentValue::from("fluent").matches(&FluentValue::from("not fluent"), &scope));
  /// assert!(!FluentValue::from("two").matches(&FluentValue::try_number("100"), &scope),);
  /// ```
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:177 matches
  matches<M extends MemoizerKind>(self: FluentValue, other: FluentValue, scope: Scope<M>): boolean {
    if (self.$ === "String" && other.$ === "String") {
      return self._0 === other._0;
    } else if (self.$ === "Number" && other.$ === "Number") {
      return self._0.eq(other._0);
    } else if (self.$ === "String" && other.$ === "Number") {
      const a = self._0;
      const b = other._0;
      let cat: PluralCategory;
      switch (a) {
        case "zero":
          cat = PluralCategory.ZERO;
          break;
        case "one":
          cat = PluralCategory.ONE;
          break;
        case "two":
          cat = PluralCategory.TWO;
          break;
        case "few":
          cat = PluralCategory.FEW;
          break;
        case "many":
          cat = PluralCategory.MANY;
          break;
        case "other":
          cat = PluralCategory.OTHER;
          break;
        default:
          return false;
      }
      // This string matches a plural rule keyword. Check if the number
      // matches the plural rule category.
      let type: PluralRuleType;
      switch (b.options.type) {
        case "Cardinal":
          type = PluralRuleType.CARDINAL;
          break;
        case "Ordinal":
          type = PluralRuleType.ORDINAL;
          break;
      }
      const r = scope.bundle.intls.with_try_get_threadsafe(PluralRules_Memoizable, [type], (pr: PluralRules) => {
        const sel = pr._0.select(b, (n: FluentNumber) => Ok(PluralOperands_from_FluentNumber(n)));
        return sel.$ === "Ok" && sel._0 === cat; // `== Ok(cat)`
      });
      if (r.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_str(r._0)}`);
      return r._0;
    } else {
      return false;
    }
  },

  /// Write out a string version of the [`FluentValue`] to `W`.
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:217 write
  write<M extends MemoizerKind>(self: FluentValue, w: Write, scope: Scope<M>): Result<null, FmtError> {
    const formatter = scope.bundle.formatter;
    if (formatter !== undefined) {
      const val = formatter(self, scope.bundle.intls);
      if (val !== undefined) {
        return w.write_str(val);
      }
    }
    switch (self.$) {
      case "String":
        return w.write_str(self._0);
      case "Number":
        return w.write_str(self._0.as_string());
      case "Custom":
        return w.write_str(scope.bundle.intls.stringify_value(self._0));
      case "Error":
        return Ok(null);
      case "None":
        return Ok(null);
    }
  },

  /// Converts the [`FluentValue`] to a string.
  ///
  /// Clones inner values when owned, borrowed data is not cloned.
  /// Prefer using [`FluentValue::into_string()`] when possible.
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:241 as_string
  as_string<M extends MemoizerKind>(self: FluentValue, scope: Scope<M>): string {
    const formatter = scope.bundle.formatter;
    if (formatter !== undefined) {
      const val = formatter(self, scope.bundle.intls);
      if (val !== undefined) {
        return val;
      }
    }
    switch (self.$) {
      case "String":
        return self._0;
      case "Number":
        return self._0.as_string();
      case "Custom":
        return scope.bundle.intls.stringify_value(self._0);
      case "Error":
        return "";
      case "None":
        return "";
    }
  },

  /// Converts the [`FluentValue`] to a string.
  ///
  /// Takes self by-value to be able to skip expensive clones.
  /// Prefer this method over [`FluentValue::as_string()`] when possible.
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:263 into_string
  into_string<M extends MemoizerKind>(self: FluentValue, scope: Scope<M>): string {
    const formatter = scope.bundle.formatter;
    if (formatter !== undefined) {
      const val = formatter(self, scope.bundle.intls);
      if (val !== undefined) {
        return val;
      }
    }
    switch (self.$) {
      case "String":
        return self._0;
      case "Number":
        return self._0.as_string();
      case "Custom":
        return scope.bundle.intls.stringify_value(self._0);
      case "Error":
        return "";
      case "None":
        return "";
    }
  },

  // crate: fluent-bundle-0.16.0/src/types/mod.rs:281 into_owned
  into_owned(self: FluentValue): FluentValue {
    switch (self.$) {
      case "String":
        return { $: "String", _0: self._0 };
      case "Number":
        return { $: "Number", _0: self._0.clone() };
      case "Custom":
        return { $: "Custom", _0: self._0.duplicate() };
      case "Error":
        return FluentValue.Error;
      case "None":
        return FluentValue.None;
    }
  },

  /** `impl From<String> for FluentValue<'_>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:293 from
  from_String(s: string): FluentValue {
    return { $: "String", _0: s };
  },

  /** `impl<'source> From<&'source String> for FluentValue<'source>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:299 from
  from_ref_String(s: string): FluentValue {
    return { $: "String", _0: s };
  },

  /** `impl<'source> From<&'source str> for FluentValue<'source>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:305 from
  from_str(s: string): FluentValue {
    return { $: "String", _0: s };
  },

  /** `impl<'source> From<Cow<'source, str>> for FluentValue<'source>` */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:311 from
  from_Cow(s: string): FluentValue {
    return { $: "String", _0: s };
  },

  /** `impl<'source, T: Into<FluentValue<'source>>> From<Option<T>> for FluentValue<'source>` (`into` is `T`'s conversion). */
  // crate: fluent-bundle-0.16.0/src/types/mod.rs:320 from
  from_Option<T>(v: T | undefined, into: (v: T) => FluentValue): FluentValue {
    if (v !== undefined) {
      return into(v);
    } else {
      return FluentValue.None;
    }
  },
};

/** `#[derive(Debug)]` */
export function debug_FluentValue(v: FluentValue, f: Fmt): string {
  switch (v.$) {
    case "String":
      return debug_tuple(f, "String", [debug_str(v._0)]);
    case "Number":
      return debug_tuple(f, "Number", [debug_FluentNumber(v._0, f)]);
    case "Custom":
      return debug_tuple(f, "Custom", [v._0.fmt(f)]);
    case "None":
    case "Error":
      return v.$;
  }
}
