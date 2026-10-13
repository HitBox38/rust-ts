// Port of compiler/rustc_metadata/src/rmeta/mod.rs.
//
// PORT: contract-first stub (lane creader, wave 11). Only the declared shapes creader.rs and
// rmeta/decoder/cstore_impl.rs read are here (`CrateHeader`, `CrateRoot`, `CrateRootUnhashed`, `CrateDep`);
// the rmeta-types / rmeta-decoder lanes complete the structs (Decodable via codegen) and the rest of the file.
// Struct fields are `declare`d: no value of these types is built before the decoder exists.
//
// `pub(crate) use decoder::{CrateMetadata, CrateNumMap, MetadataBlob, TargetModifiers};` is a type-only
// re-export: decoder.ts extends `CrateRoot` and imports this module, so a value re-export would be an import
// cycle evaluated before `CrateRoot` exists. Values come from ./decoder.ts directly.
import type { CrateDepKind } from "../../rustc_crate_store/lib.ts";
import type { StableCrateId } from "../../rustc_span/def_id.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { PanicStrategy } from "../../rustc_target/spec/mod.ts";
import type { Svh } from "./decoder.ts";

export type { CrateMetadata, CrateNumMap, MetadataBlob, TargetModifiers } from "./decoder.ts";

/// Serialized crate metadata.
///
/// This contains just enough information to determine if we should load the `CrateRoot` or not.
/// Prefer [`CrateRoot`] whenever possible to avoid ICEs when using `omit-git-hash` locally.
/// See #76720 for more details.
///
/// If you do modify this struct, also bump the [`METADATA_VERSION`] constant.
// #[derive(MetadataEncodable, BlobDecodable)]
export interface CrateHeader {
  triple: unknown;
  name: Symbol;
  /// Whether this is the header for a proc-macro crate.
  ///
  /// This is separate from [`ProcMacroData`] to avoid having to update [`METADATA_VERSION`] every
  /// time ProcMacroData changes.
  is_proc_macro_crate: boolean;
  /// Whether this crate metadata section is just a stub.
  /// Stubs do not contain the full metadata (it will be typically stored
  /// in a separate rmeta file).
  ///
  /// This is used inside rlibs and dylibs when using `-Zembed-metadata=no`.
  is_stub: boolean;
}

/// Serialized `.rmeta` data for a crate.
///
/// When compiling a proc-macro crate, we encode many of
/// the `LazyArray<T>` fields as `Lazy::empty()`. This serves two purposes:
///
/// 1. We avoid performing unnecessary work. Proc-macro crates can only
/// export proc-macros functions, which are compiled into a shared library.
/// As a result, a large amount of the information we normally store
/// (e.g. optimized MIR) is unneeded by downstream crates.
/// 2. We avoid serializing invalid `CrateNum`s. When we deserialize
/// a proc-macro crate, we don't load any of its dependencies (since we
/// just need to invoke a native function from the shared library).
/// This means that any foreign `CrateNum`s that we serialize cannot be
/// deserialized, since we will not know how to map them into the current
/// compilation session. If we were to serialize a proc-macro crate like
/// a normal crate, much of what we serialized would be unusable in addition
/// to being unused.
// #[derive(MetadataEncodable, LazyDecodable)]
// PORT(stub): the fields creader.rs / cstore_impl.rs / decoder.rs's accessors read. `stable_crate_id` is
// `stable_crate_id_` (the method of the same name lives in decoder.ts).
export class CrateRoot {
  /// A header used to detect if this is the right crate to load.
  declare header: CrateHeader;

  declare stable_crate_id_: StableCrateId;
  declare required_panic_strategy: PanicStrategy | undefined;
  declare panic_in_drop_strategy: PanicStrategy;
  declare edition: Edition;
  declare has_global_allocator: boolean;
  declare has_alloc_error_handler: boolean;
  declare has_panic_handler: boolean;
  declare has_default_lib_allocator: boolean;

  declare proc_macro_data: unknown;
  declare tables: unknown;
  declare source_map: unknown;

  declare compiler_builtins: boolean;
  declare needs_allocator: boolean;
  declare needs_panic_runtime: boolean;
  declare no_builtins: boolean;
  declare panic_runtime: boolean;
  declare profiler_runtime: boolean;
}

/// A separate struct for extra metadata that must be encoded *after*
/// the main crate hash is finalized.
// #[derive(MetadataEncodable, LazyDecodable)]
export class CrateRootUnhashed {
  declare extra_filename: string;

  /// The `-C extra-filename` of each dependency, indexed by the `CrateNum` they had in *this*
  /// crate's encoding. The `LOCAL_CRATE` slot is unused filler so that dependency `CrateNum`s
  /// can index this directly; this crate's own value is `extra_filename` above.
  declare dep_extra_filenames: string[];
}

/// A dependency record, as stored in the hashed [`CrateRoot`].
///
/// Note the absence of the dependency's `-C extra-filename`: it lives in
/// [`CrateRootUnhashed::dep_extra_filenames`] instead, deliberately outside the hash.
// #[derive(Encodable, BlobDecodable)]
export interface CrateDep {
  name: Symbol;
  hash: Svh;
  host_hash: Svh | undefined;
  kind: CrateDepKind;
  is_private: boolean;
}
