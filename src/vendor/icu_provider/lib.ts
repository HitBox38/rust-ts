// Port of icu_provider 2.3.0 `src/lib.rs` (subset; see docs/handoff/icu-list.md).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! `icu_provider` is one of the `ICU4X` components.
//!
//! Unicode's experience with ICU4X's parent projects, ICU4C and ICU4J, led the team to realize
//! that data management is the most critical aspect of deploying internationalization, and that it requires
//! a high level of customization for the needs of the platform it is embedded in. As a result
//! ICU4X comes with a selection of providers that should allow for ICU4X to naturally fit into
//! different business and technological needs of customers.
//!
//! (Details of upstream's crate docs are not repeated here.)
//
// Ported: baked (+ baked/zerotrie), data_provider (`DataProvider`), error, fallback, marker
// (subset), request (subset), response (subset). Not ported: buf, constructors (doc macros),
// dynutil, export, hello_world, serde_borrow_de_utils, varule_traits (unused on rustc's path).
// `log` is a no-op module in rustc's build (see error.ts).
// crate-skip: icu_provider-2.3.0/src/lib.rs:223 test_logging tests that `log::info!` compiles; `log` is a no-op here
export * as baked from "./baked.ts";
export * as fallback from "./fallback.ts";
export type { DataProvider } from "./data_provider.ts";
export { DataError, type DataErrorKind, allow_identifier_not_found, debug_DataError, display_DataError } from "./error.ts";
export { DataIdentifierBorrowed, DataLocale, DataMarkerAttributes, DataRequest, DataRequestMetadata } from "./request.ts";
export { DataPayload, type DataResponse, DataResponseMetadata } from "./response.ts";
export { type DataMarker, DataMarkerId, DataMarkerInfo, data_marker } from "./marker.ts";
