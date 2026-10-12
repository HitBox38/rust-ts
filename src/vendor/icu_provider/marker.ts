// Port of icu_provider 2.3.0 `src/marker.rs` (the subset used by baked providers and the
// `*_unstable` constructors).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `DynamicDataMarker` / `DataMarker` are type-level traits; a marker is a value carrying
// its `INFO` (`DataMarker::INFO`) and the type of its data struct (erased). `NeverMarker` and
// `ErasedMarker` are type-level only.
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { debug_list, debug_struct, type Fmt, PLAIN } from "../../std/fmt.ts";
import { utf8 } from "../../std/str.ts";
import type { DataLocale } from "../icu_locale_core/data.ts";
import type { LocalePreferences } from "../icu_locale_core/preferences/locale.ts";
import { DataError } from "./error.ts";
import { LocaleFallbackConfig } from "./fallback.ts";

/// Trait marker for data structs. All types delivered by the data provider must be associated with
/// something implementing this trait.
///
/// A [`DataMarker`] is a [`DynamicDataMarker`] with a [`DataMarkerInfo`] (its `INFO`).
// pub trait DataMarker: DynamicDataMarker { const INFO: DataMarkerInfo; }
export interface DataMarker<DataStruct> {
  readonly INFO: DataMarkerInfo;
  /** Phantom: the `DynamicDataMarker::DataStruct` type. */
  readonly __data_struct?: DataStruct;
}

/// Extension trait for methods on [`DataMarker`]
// crate-skip: icu_provider-2.3.0/src/marker.rs:83 bind `DataProviderWithMarker` is not ported; unused on rustc's path

// impl<M: DataMarker + Sized> DataMarkerExt for M
// crate-skip: icu_provider-2.3.0/src/marker.rs:91 bind `DataProviderWithMarker` is not ported; unused on rustc's path
// crate: icu_provider-2.3.0/src/marker.rs:98 make_locale
export function DataMarkerExt_make_locale<T>(M: DataMarker<T>, locale: LocalePreferences): DataLocale {
  return M.INFO.make_locale(locale);
}

/// A compact hash of a [`DataMarkerInfo`]. Useful for keys in maps.
///
/// The hash will be stable over time within major releases.
// #[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Copy, Clone, Hash, ULE)] #[repr(transparent)]
export class DataMarkerIdHash {
  constructor(public _0: Uint8Array /* [u8; 4] */) {}

  /// Magic bytes to locate [`DataMarkerIdHash`]es in binaries.
  static readonly LEADING_TAG: Uint8Array = utf8("tdmh");

  /// Gets the hash value as a byte array.
  // crate: icu_provider-2.3.0/src/marker.rs:228 to_bytes
  to_bytes(): Uint8Array {
    return this._0;
  }
}

/// Const function to compute the FxHash of a byte array.
///
/// FxHash is a speedy hash algorithm used within rustc. The algorithm is satisfactory for our
/// use case since the strings being hashed originate from a trusted source (the ICU4X
/// components), and the hashes are computed at compile time, so we can check for collisions.
///
/// We could have considered a SHA or other cryptographic hash function. However, we are using
/// FxHash because:
///
/// 1. There is precedent for this algorithm in Rust
/// 2. The algorithm is easy to implement as a const function
/// 3. The amount of code is small enough that we can reasonably keep the algorithm in-tree
/// 4. FxHash is designed to output 32-bit or 64-bit values, whereas SHA outputs more bits,
///    such that truncation would be required in order to fit into a u32, partially reducing
///    the benefit of a cryptographically secure algorithm
// crate: icu_provider-2.3.0/src/marker.rs:250 fxhash_32
export function fxhash_32(bytes: Uint8Array): number {
  // This code is adapted from https://github.com/rust-lang/rustc-hash,
  // whose license text is reproduced below.
  //
  // Copyright 2015 The Rust Project Developers. See the COPYRIGHT
  // file at the top-level directory of this distribution and at
  // http://rust-lang.org/COPYRIGHT.
  //
  // Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
  // http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
  // <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
  // option. This file may not be copied, modified, or distributed
  // except according to those terms.

  // crate: icu_provider-2.3.0/src/marker.rs:265 hash_word_32
  function hash_word_32(hash: number, word: number): number {
    const ROTATE = 5;
    const SEED32 = 0x9e_37_79_b9;
    hash = ((hash << ROTATE) | (hash >>> (32 - ROTATE))) >>> 0;
    hash = (hash ^ word) >>> 0;
    hash = Math.imul(hash, SEED32) >>> 0;
    return hash;
  }

  let cursor = 0;
  const end = bytes.length;
  let hash = 0;

  while (end - cursor >= 4) {
    const word = (bytes[cursor]! | (bytes[cursor + 1]! << 8) | (bytes[cursor + 2]! << 16) | (bytes[cursor + 3]! << 24)) >>> 0;
    hash = hash_word_32(hash, word);
    cursor += 4;
  }

  if (end - cursor >= 2) {
    const word = bytes[cursor]! | (bytes[cursor + 1]! << 8);
    hash = hash_word_32(hash, word);
    cursor += 2;
  }

  if (end - cursor >= 1) {
    hash = hash_word_32(hash, bytes[cursor]!);
  }

  return hash;
}

// crate-skip: icu_provider-2.3.0/src/marker.rs:313 to_unaligned ULE impl (zerovec): unused on rustc's path
// crate-skip: icu_provider-2.3.0/src/marker.rs:317 from_unaligned ULE impl (zerovec): unused on rustc's path

/// The ID of a data marker.
///
/// This is generally a [`DataMarkerIdHash`]. If debug assertions or the `export` Cargo feature
/// are enabled, this also contains a human-readable string for an improved `Debug` implementation.
// #[derive(Debug, Copy, Clone, Eq)]
// PORT: rustc builds icu_provider without debug assertions and without `export`, so the
// `debug: &'static str` field does not exist and `Debug` prints only `hash`.
export class DataMarkerId {
  constructor(public hash: Uint8Array /* [u8; 8] */) {}

  // impl PartialEq for DataMarkerId
  // crate: icu_provider-2.3.0/src/marker.rs:338 eq
  eq(other: DataMarkerId): boolean {
    return this.hash.every((b, i) => b === other.hash[i]);
  }

  // impl Ord for DataMarkerId
  // crate: icu_provider-2.3.0/src/marker.rs:345 cmp
  cmp(other: DataMarkerId): -1 | 0 | 1 {
    for (let i = 0; i < 8; i++) {
      if (this.hash[i]! !== other.hash[i]!) return this.hash[i]! < other.hash[i]! ? -1 : 1;
    }
    return 0;
  }

  // impl PartialOrd for DataMarkerId
  // crate: icu_provider-2.3.0/src/marker.rs:352 partial_cmp
  partial_cmp(other: DataMarkerId): -1 | 0 | 1 {
    return this.cmp(other);
  }

  // crate-skip: icu_provider-2.3.0/src/marker.rs:359 hash `Hash` impl (no hashing in the TS port)

  // #[doc(hidden)] Error is a (message, position) pair.
  // crate: icu_provider-2.3.0/src/marker.rs:369 from_name
  static from_name(name: string): Result<DataMarkerId, readonly [string, number]> {
    const bytes = utf8(name);
    if (!is_ascii_digit(bytes[bytes.length - 1]!)) {
      return Err(["[0-9]", bytes.length]);
    }
    let i = bytes.length - 1;
    while (is_ascii_digit(bytes[i - 1]!)) {
      i -= 1;
    }
    if (bytes[i - 1] !== 0x56 /* b'V' */) {
      return Err(["V", i]);
    }

    const magic = DataMarkerIdHash.LEADING_TAG;
    const h = fxhash_32(bytes);
    const hash = [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, (h >>> 24) & 0xff];

    return Ok(new DataMarkerId(new Uint8Array([magic[0]!, magic[1]!, magic[2]!, magic[3]!, hash[0]!, hash[1]!, hash[2]!, hash[3]!])));
  }

  /// Gets a platform-independent hash of a [`DataMarkerId`].
  ///
  /// The hash is 4 bytes and allows for fast comparison.
  // crate: icu_provider-2.3.0/src/marker.rs:408 hashed
  hashed(): DataMarkerIdHash {
    return new DataMarkerIdHash(this.hash.slice(4, 8));
  }

  // crate-skip: icu_provider-2.3.0/src/marker.rs:417 name feature "export" off
}

function is_ascii_digit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

/** `#[derive(Debug)]` on `DataMarkerId` (without the cfg'd-out `debug` field). */
export function debug_DataMarkerId(v: DataMarkerId, f: Fmt = PLAIN): string {
  return debug_struct(f, "DataMarkerId", [["hash", debug_list(f, [...v.hash].map(String))]]);
}

/// Used for loading data from a dynamic ICU4X data provider.
///
/// A data marker is tightly coupled with the code that uses it to load data at runtime.
/// Executables can be searched for `DataMarkerInfo` instances to produce optimized data files.
/// Therefore, users should not generally create DataMarkerInfo instances; they should instead use
/// the ones exported by a component.
// #[derive(Copy, Clone, PartialEq, Eq)] #[non_exhaustive]
export class DataMarkerInfo {
  constructor(
    /// The ID of this marker.
    public id: DataMarkerId,
    /// Whether this data marker only has a single payload, not keyed by a data identifier.
    public is_singleton: boolean,
    /// Whether this data marker uses checksums for integrity purposes.
    public has_checksum: boolean,
    /// The fallback to use for this data marker.
    public fallback_config: LocaleFallbackConfig,
  ) {}

  // impl PartialOrd for DataMarkerInfo
  // crate: icu_provider-2.3.0/src/marker.rs:449 partial_cmp
  partial_cmp(other: DataMarkerInfo): -1 | 0 | 1 {
    return this.cmp(other);
  }

  // impl Ord for DataMarkerInfo
  // crate: icu_provider-2.3.0/src/marker.rs:455 cmp
  cmp(other: DataMarkerInfo): -1 | 0 | 1 {
    return this.id.cmp(other.id);
  }

  // crate-skip: icu_provider-2.3.0/src/marker.rs:461 hash `Hash` impl (no hashing in the TS port)

  /// See [`Default::default`]
  // crate: icu_provider-2.3.0/src/marker.rs:468 from_id
  static from_id(id: DataMarkerId): DataMarkerInfo {
    return new DataMarkerInfo(id, false, false, LocaleFallbackConfig.default());
  }

  /// Returns [`Ok`] if this data marker matches the argument, or the appropriate error.
  ///
  /// Convenience method for data providers that support a single [`DataMarkerInfo`].
  // crate: icu_provider-2.3.0/src/marker.rs:517 match_marker
  match_marker(marker: DataMarkerInfo): Result<undefined, DataError> {
    if (this.eq(marker)) {
      return Ok(undefined);
    } else {
      return Err(DataError.with_marker_kind({ $: "MarkerNotFound" }, marker));
    }
  }

  /// Constructs a [`DataLocale`] for this [`DataMarkerInfo`].
  // crate: icu_provider-2.3.0/src/marker.rs:526 make_locale
  make_locale(locale: LocalePreferences): DataLocale {
    if (this.fallback_config.priority === "Region") {
      return locale.to_data_locale_region_priority();
    } else {
      return locale.to_data_locale_language_priority();
    }
  }

  /** `#[derive(PartialEq)]` */
  eq(other: DataMarkerInfo): boolean {
    return (
      this.id.eq(other.id) &&
      this.is_singleton === other.is_singleton &&
      this.has_checksum === other.has_checksum &&
      this.fallback_config.priority === other.fallback_config.priority
    );
  }
}

// impl fmt::Debug for DataMarkerInfo
// PORT: without `export`/debug assertions this is `write!(f, "{:?}", self.id)`.
// crate: icu_provider-2.3.0/src/marker.rs:597 fmt
export function debug_DataMarkerInfo(v: DataMarkerInfo, f: Fmt = PLAIN): string {
  return debug_DataMarkerId(v.id, f);
}

/// Creates a data marker (`data_marker!`): the `INFO` const of a marker named `name`, with the
/// given `DataMarkerInfo` field overrides (`is_singleton = true`, `fallback_config = ..`).
export function data_marker<T>(
  name: string,
  fields: { is_singleton?: boolean; has_checksum?: boolean; fallback_config?: LocaleFallbackConfig } = {},
): DataMarker<T> {
  const id = DataMarkerId.from_name(name);
  if (id.$ === "Err") panic(`Invalid marker name: ${name}`);
  const info = DataMarkerInfo.from_id(id._0);
  if (fields.is_singleton !== undefined) info.is_singleton = fields.is_singleton;
  if (fields.has_checksum !== undefined) info.has_checksum = fields.has_checksum;
  if (fields.fallback_config !== undefined) info.fallback_config = fields.fallback_config;
  return { INFO: info };
}
