// Port of icu_provider 2.3.0 `src/response.rs` (the subset used by baked providers).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: `DataPayload<M>` wraps either a `Yoke` (owned data) or a `&'static` reference; both are
// the data struct itself in TS (no lifetimes, no zero-copy). The marker type parameter is erased.
import type { DataLocale } from "../icu_locale_core/data.ts";

/// A response object containing metadata about the returned data.
// #[derive(Debug, Clone, PartialEq, Default)] #[non_exhaustive]
export class DataResponseMetadata {
  constructor(
    /// The resolved locale of the returned data, if locale fallbacking was performed.
    public locale: DataLocale | undefined,
    /// The format of the buffer for buffer-backed data, if known (for example, JSON).
    // PORT: `Option<BufferFormat>`; buffer providers are not ported, so always `None`.
    public buffer_format: undefined,
    /// An optional checksum. This can be used to ensure consistency across different markers.
    public checksum: bigint | undefined,
  ) {}

  /** `#[derive(Default)]` */
  static default(): DataResponseMetadata {
    return new DataResponseMetadata(undefined, undefined, undefined);
  }

  /// Sets the checksum.
  // crate: icu_provider-2.3.0/src/response.rs:39 with_checksum
  with_checksum(checksum: bigint): DataResponseMetadata {
    return new DataResponseMetadata(this.locale, this.buffer_format, checksum);
  }
}

/// A container for data payloads returned from a data provider.
// pub struct DataPayload<M: DynamicDataMarker>(pub(crate) DataPayloadInner<M>);
export class DataPayload<T> {
  constructor(public _0: { readonly $: "Yoke"; readonly _0: T } | { readonly $: "StaticRef"; readonly _0: T }) {}

  /// Convert a fully owned (`'static`) data struct into a DataPayload.
  ///
  /// This constructor creates `'static` payloads.
  // crate: icu_provider-2.3.0/src/response.rs:382 from_owned
  static from_owned<T>(data: T): DataPayload<T> {
    return new DataPayload<T>({ $: "Yoke", _0: data });
  }

  /// Construct a [`DataPayload`] from a static reference.
  ///
  /// This is mainly used by databake.
  // crate: icu_provider-2.3.0/src/response.rs:392 from_static_ref
  static from_static_ref<T>(data: T): DataPayload<T> {
    return new DataPayload<T>({ $: "StaticRef", _0: data });
  }

  /// Borrows the underlying data.
  // crate: icu_provider-2.3.0/src/response.rs:462 get
  get(): T {
    return this._0._0;
  }

  /// Convert between two [`DynamicDataMarker`] types that are compatible with each other
  /// with compile-time type checking.
  // crate: icu_provider-2.3.0/src/response.rs:729 cast
  cast(): DataPayload<T> {
    return new DataPayload<T>(this._0);
  }
}

/// A response object containing an object as payload and metadata about it.
// #[allow(clippy::exhaustive_structs)] // this type is stable
export interface DataResponse<T> {
  /// Metadata about the returned object.
  readonly metadata: DataResponseMetadata;
  /// The object itself
  readonly payload: DataPayload<T>;
}

/// Convert between two [`DynamicDataMarker`] types that are compatible with each other
/// with compile-time type checking.
// crate: icu_provider-2.3.0/src/response.rs:1072 cast
export function DataResponse_cast<T>(self: DataResponse<T>): DataResponse<T> {
  return { metadata: self.metadata, payload: self.payload.cast() };
}
