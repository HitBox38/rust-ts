// Port of icu_provider 2.3.0 `src/request.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { debug_str } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { DataLocale } from "../icu_locale_core/data.ts";
import { StrWriteable } from "../writeable/impls.ts";

export { DataLocale } from "../icu_locale_core/data.ts";

/// The request type passed into all data provider implementations.
// #[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
export interface DataRequest {
  /// The data identifier for which to load data.
  ///
  /// If locale fallback is enabled, the resulting data may be from a different identifier
  /// than the one requested here.
  readonly id: DataIdentifierBorrowed;
  /// Metadata that may affect the behavior of the data provider.
  readonly metadata: DataRequestMetadata;
}

/** `DataRequest { id, ..Default::default() }` */
export function DataRequest(id: DataIdentifierBorrowed, metadata: DataRequestMetadata = DataRequestMetadata.default()): DataRequest {
  return { id, metadata };
}

/// Metadata for data requests. This is currently empty, but it may be extended with options
/// for tuning locale fallback, buffer layout, and so forth.
// #[derive(Default, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)] #[non_exhaustive]
export interface DataRequestMetadata {
  /// Silent requests do not log errors. This can be used for exploratory querying, such as fallbacks.
  readonly silent: boolean;
  /// Whether to allow prefix matches for the data marker attributes.
  readonly attributes_prefix_match: boolean;
}
export const DataRequestMetadata = {
  default(): DataRequestMetadata {
    return { silent: false, attributes_prefix_match: false };
  },
};

/// The borrowed version of a [`DataIdentifierCow`].
// #[derive(Default, Debug, Clone, Copy, PartialEq, Eq)] #[non_exhaustive]
export class DataIdentifierBorrowed {
  constructor(
    /// Marker-specific request attributes
    public marker_attributes: DataMarkerAttributes,
    /// The CLDR locale
    public locale: DataLocale,
  ) {}

  /** `#[derive(Default)]` */
  static default(): DataIdentifierBorrowed {
    return new DataIdentifierBorrowed(DataMarkerAttributes.empty(), DataLocale.default_ref());
  }

  // impl fmt::Display for DataIdentifierBorrowed
  // crate: icu_provider-2.3.0/src/request.rs:60 fmt
  to_string(): string {
    let s = this.locale.to_string();
    if (!this.marker_attributes.is_empty()) {
      s += `/${this.marker_attributes.as_str()}`;
    }
    return s;
  }

  /// Creates a [`DataIdentifierBorrowed`] for a borrowed [`DataLocale`].
  // crate: icu_provider-2.3.0/src/request.rs:71 for_locale
  static for_locale(locale: DataLocale): DataIdentifierBorrowed {
    return new DataIdentifierBorrowed(DataMarkerAttributes.empty(), locale);
  }

  /// Creates a [`DataIdentifierBorrowed`] for a borrowed [`DataMarkerAttributes`].
  // crate: icu_provider-2.3.0/src/request.rs:79 for_marker_attributes
  static for_marker_attributes(marker_attributes: DataMarkerAttributes): DataIdentifierBorrowed {
    return new DataIdentifierBorrowed(marker_attributes, DataLocale.default_ref());
  }

  /// Creates a [`DataIdentifierBorrowed`] for a borrowed [`DataMarkerAttributes`] and [`DataLocale`].
  // crate: icu_provider-2.3.0/src/request.rs:87 for_marker_attributes_and_locale
  static for_marker_attributes_and_locale(marker_attributes: DataMarkerAttributes, locale: DataLocale): DataIdentifierBorrowed {
    return new DataIdentifierBorrowed(marker_attributes, locale);
  }

  // crate-skip: icu_provider-2.3.0/src/request.rs:101 into_owned `DataIdentifierCow` is not ported; unused on rustc's path
  // crate-skip: icu_provider-2.3.0/src/request.rs:112 as_cow `DataIdentifierCow` is not ported; unused on rustc's path
}

// `DataIdentifierCow` (request.rs:128) is not ported: it is only used by iterable/exportable
// providers, which rustc does not use.
// crate-skip: icu_provider-2.3.0/src/request.rs:137 partial_cmp `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:144 cmp `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:153 fmt `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:165 as_borrowed `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:173 from_locale `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:181 from_marker_attributes `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:189 from_marker_attributes_owned `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:197 from_owned `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:205 from_borrowed_and_owned `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:216 is_unknown `DataIdentifierCow` is not ported; unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/request.rs:223 default `DataIdentifierCow` is not ported; unused on rustc's path

/// An additional key to identify data beyond a [`DataLocale`].
///
/// The is a loose wrapper around a string, with semantics defined by each [`DataMarker`](crate::DataMarker).
// #[derive(PartialEq, Eq, Ord, PartialOrd, Hash)] #[repr(transparent)]
// PORT: `DataMarkerAttributes` is unsized (`str`); here a class over the string. It derefs to
// `str`, so it is `Writeable` through the `str` impl (`StrWriteable`).
export class DataMarkerAttributes extends StrWriteable {
  constructor(readonly value: string) {
    super(value);
  }

  // impl Default for &DataMarkerAttributes
  // crate: icu_provider-2.3.0/src/request.rs:242 default
  static default(): DataMarkerAttributes {
    return DataMarkerAttributes.empty();
  }

  // impl Deref for DataMarkerAttributes
  // crate: icu_provider-2.3.0/src/request.rs:250 deref
  deref(): string {
    return this.value;
  }

  is_empty(): boolean {
    return this.value.length === 0;
  }

  // impl Debug for DataMarkerAttributes
  // crate: icu_provider-2.3.0/src/request.rs:257 fmt
  debug(): string {
    return debug_str(this.value);
  }

  // crate: icu_provider-2.3.0/src/request.rs:269 validate
  static validate(s: Uint8Array): Result<undefined, AttributeParseError> {
    if (s.length === 0) {
      return Ok(undefined);
    }
    let i = 0;
    let prev_was_slash = true;
    while (i < s.length) {
      const c = s[i]!;
      if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x5f || c === 0x2f)) {
        return Err(AttributeParseError);
      }
      if (c === 0x2f) {
        if (prev_was_slash) {
          return Err(AttributeParseError);
        }
        prev_was_slash = true;
      } else {
        prev_was_slash = false;
      }
      i += 1;
    }

    if (prev_was_slash) {
      return Err(AttributeParseError);
    }
    return Ok(undefined);
  }

  /// Creates a borrowed [`DataMarkerAttributes`] from a borrowed string.
  ///
  /// Returns an error if the string contains characters other than `[a-zA-Z0-9_\-/]`,
  /// or if the string starts or ends with `/` or has two consecutive `/`.
  // crate: icu_provider-2.3.0/src/request.rs:302 try_from_str
  static try_from_str(s: string): Result<DataMarkerAttributes, AttributeParseError> {
    return DataMarkerAttributes.try_from_utf8(utf8(s));
  }

  /// Attempts to create a borrowed [`DataMarkerAttributes`] from a borrowed UTF-8 encoded byte slice.
  // crate: icu_provider-2.3.0/src/request.rs:321 try_from_utf8
  static try_from_utf8(code_units: Uint8Array): Result<DataMarkerAttributes, AttributeParseError> {
    const v = DataMarkerAttributes.validate(code_units);
    if (v.$ === "Err") {
      return Err(AttributeParseError);
    }

    // SAFETY: `validate` requires a UTF-8 subset
    const s = new TextDecoder().decode(code_units);

    // SAFETY: `Self` has the same layout as `str`
    return Ok(new DataMarkerAttributes(s));
  }

  /// Creates an owned [`DataMarkerAttributes`] from an owned string.
  // crate: icu_provider-2.3.0/src/request.rs:339 try_from_string
  static try_from_string(s: string): Result<DataMarkerAttributes, AttributeParseError> {
    const v = DataMarkerAttributes.validate(utf8(s));
    if (v.$ === "Err") {
      return Err(AttributeParseError);
    }
    return Ok(new DataMarkerAttributes(s));
  }

  /// Creates a borrowed [`DataMarkerAttributes`] from a borrowed string.
  ///
  /// Panics if the string contains characters other than `[a-zA-Z0-9_\-/]`,
  /// or if the string starts or ends with `/` or has two consecutive `/`.
  // crate: icu_provider-2.3.0/src/request.rs:353 from_str_or_panic
  static from_str_or_panic(s: string): DataMarkerAttributes {
    const r = DataMarkerAttributes.try_from_str(s);
    if (r.$ === "Err") {
      return panic("Invalid marker attribute syntax");
    }
    return r._0;
  }

  /// Creates an empty [`DataMarkerAttributes`].
  // crate: icu_provider-2.3.0/src/request.rs:362 empty
  static empty(): DataMarkerAttributes {
    // SAFETY: `Self` has the same layout as `str`
    return new DataMarkerAttributes("");
  }

  /// Returns this [`DataMarkerAttributes`] as a `&str`.
  // crate: icu_provider-2.3.0/src/request.rs:368 as_str
  as_str(): string {
    return this.value;
  }

  // impl ToOwned for DataMarkerAttributes
  // crate: icu_provider-2.3.0/src/request.rs:377 to_owned
  to_owned(): DataMarkerAttributes {
    return new DataMarkerAttributes(this.value);
  }
}

/// Invalid character
// #[derive(Debug)] #[non_exhaustive]
export type AttributeParseError = "AttributeParseError";
export const AttributeParseError: AttributeParseError = "AttributeParseError";
