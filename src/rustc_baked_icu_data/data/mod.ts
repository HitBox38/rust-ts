// Port of compiler/rustc_baked_icu_data/src/data/mod.rs and the provider impl inside
// list_and_v1.rs.data (`__impl_list_and_v1!`). Both are databake output (`// @generated`); the
// data itself is translated by tools/codegen/icu-data.ts into ./list_and_v1.ts, and that generator
// checks token-for-token that the macro code ported here is unchanged upstream.
//
// PORT: the `.rs.data` macros have no `fn` markers (coverage tracks `.rs` files only); their
// source lines are cited as `from:` comments.
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { LocaleFallbacker } from "../../vendor/icu_locale_fallback/lib.ts";
import { ListAndV1, type ListFormatterPatterns } from "../../vendor/icu_list/provider/mod.ts";
import { Data } from "../../vendor/icu_provider/baked/zerotrie.ts";
import { DataError } from "../../vendor/icu_provider/error.ts";
import { DataMarkerId, DataMarkerInfo, type DataMarker } from "../../vendor/icu_provider/marker.ts";
import { DataIdentifierBorrowed, type DataRequest } from "../../vendor/icu_provider/request.ts";
import { type DataPayload, type DataResponse, DataResponseMetadata } from "../../vendor/icu_provider/response.ts";
import { TRIE, VALUES } from "./list_and_v1.ts";

// include!("list_and_v1.rs.data");

/// Marks a type as a data provider. You can then use macros like
/// `impl_core_helloworld_v1` to add implementations.
// from: compiler/rustc_baked_icu_data/src/data/mod.rs:16 macro_rules! __make_provider
//   impl $name { pub(crate) const MUST_USE_MAKE_PROVIDER_MACRO: () = (); }
//   icu_provider::marker::impl_data_provider_never_marker!($name);

/// `NeverMarker<Y>::INFO`: `DataMarkerInfo::from_id(DataMarkerId { hash: *b"nevermar" })`.
const NEVER_MARKER_INFO = DataMarkerInfo.from_id(new DataMarkerId(new TextEncoder().encode("nevermar")));

/// `impl_data_provider_never_marker!` (icu_provider marker.rs:193): the `NeverMarker` load.
// crate: icu_provider-2.3.0/src/marker.rs:199 load
export function load_never_marker<T>(req: DataRequest): Result<DataResponse<T>, DataError> {
  return Err(DataError.with_req_kind({ $: "MarkerNotFound" }, NEVER_MARKER_INFO, req));
}

/// This macro requires the following crates:
/// * `icu_list`
/// * `icu_locale_fallback/compiled_data`
/// * `icu_provider`
/// * `icu_provider/baked`
/// * `zerovec`
// from: compiler/rustc_baked_icu_data/src/data/mod.rs:35 macro_rules! impl_data_provider
//   make_provider!($provider); impl_list_and_v1!($provider);

// from: compiler/rustc_baked_icu_data/src/data/list_and_v1.rs.data:20 macro_rules! __impl_list_and_v1
/// Implement `DataProvider<ListAndV1>` on the given struct using the data
/// hardcoded in this file. This allows the struct to be used with
/// `icu`'s `_unstable` constructors.
///
/// Using this implementation will embed the following data in the binary's data segment:
/// * 179B for the lookup data structure (33 data identifiers)
/// * 4183B[^1] for the actual data (11 unique structs)
///
/// [^1]: these numbers can be smaller in practice due to linker deduplication

/// `const DATA_LIST_AND_V1: icu_provider::baked::zerotrie::Data<icu_list::provider::ListAndV1>`
let DATA_LIST_AND_V1_: Data<ListFormatterPatterns> | undefined;
function DATA_LIST_AND_V1(): Data<ListFormatterPatterns> {
  return (DATA_LIST_AND_V1_ ??= Data.from_trie_and_values_unchecked(TRIE, VALUES));
}

// from: compiler/rustc_baked_icu_data/src/data/list_and_v1.rs.data:34 fn load
// impl icu_provider::DataProvider<icu_list::provider::ListAndV1> for $provider
export function load_list_and_v1(req: DataRequest): Result<DataResponse<ListFormatterPatterns>, DataError> {
  const metadata = DataResponseMetadata.default();
  let payload: DataPayload<ListFormatterPatterns>;
  const p = DATA_LIST_AND_V1().get(req.id, req.metadata.attributes_prefix_match);
  if (p !== undefined) {
    payload = p;
  } else {
    // const FALLBACKER: icu_locale_fallback::LocaleFallbackerWithConfig<'static> =
    //     icu_locale_fallback::LocaleFallbacker::new().for_config(<ListAndV1 as DataMarker>::INFO.fallback_config);
    const FALLBACKER = LocaleFallbacker.new().for_config(ListAndV1.INFO.fallback_config);
    const fallback_iterator = FALLBACKER.fallback_for(req.id.locale.clone());
    for (;;) {
      const p = DATA_LIST_AND_V1().get(
        DataIdentifierBorrowed.for_marker_attributes_and_locale(req.id.marker_attributes, fallback_iterator.get()),
        req.metadata.attributes_prefix_match,
      );
      if (p !== undefined) {
        metadata.locale = fallback_iterator.take();
        payload = p;
        break;
      }
      if (fallback_iterator.get().is_unknown()) {
        return Err(DataError.with_req_kind({ $: "IdentifierNotFound" }, ListAndV1.INFO, req));
      }
      fallback_iterator.step();
    }
  }
  return Ok({ payload, metadata });
}

/** Dispatches `DataProvider<M>::load` over the markers the provider implements. */
export function load_baked<T>(marker: DataMarker<T>, req: DataRequest): Result<DataResponse<T>, DataError> {
  if (marker === (ListAndV1 as DataMarker<unknown>)) {
    return load_list_and_v1(req) as unknown as Result<DataResponse<T>, DataError>;
  }
  // PORT: Rust resolves `DataProvider<M>` at compile time; a marker the provider does not
  // implement is a type error there, not a runtime path.
  return panic(`BakedDataProvider does not implement DataProvider for this marker`);
}


