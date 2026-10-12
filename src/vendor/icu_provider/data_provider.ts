// Port of icu_provider 2.3.0 `src/data_provider.rs` (the `DataProvider` trait).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { Result } from "../../std/result.ts";
import type { DataError } from "./error.ts";
import type { DataMarker } from "./marker.ts";
import type { DataRequest } from "./request.ts";
import type { DataResponse } from "./response.ts";

/// A data provider that loads data for a specific [`DataMarkerInfo`].
///
/// PORT: `DataProvider<M>` is generic over the marker type; a provider that implements it for
/// several markers dispatches on the marker value passed to `load`.
export interface DataProvider {
  /// Query the provider for data, returning the result.
  ///
  /// Returns [`Ok`] if the request successfully loaded data. If data failed to load, returns an
  /// Error with more information.
  // crate: icu_provider-2.3.0/src/data_provider.rs:22 load
  load<T>(marker: DataMarker<T>, req: DataRequest): Result<DataResponse<T>, DataError>;
}
