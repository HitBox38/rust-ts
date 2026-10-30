// Port of compiler/rustc_metadata/src/rmeta/mod.rs.
//
// PORT (lane rmeta-contract): the types are hand-written; their derive(LazyDecodable / BlobDecodable / Decodable)
// impls are generated into ../decodable.gen.ts (tools/codegen set `rustc_metadata_rmeta`), except `LazyTables`,
// which `define_tables!` defines (invisible to tools/codegen): its decode is expanded here (`decode_LazyTables`).
// - `NonZero<usize>` positions are numbers (> 0; `NonZero::new(..).unwrap()` is an `assert` where upstream
//   unwraps). `PhantomData` markers are erased.
// - `LazyValue` / `LazyArray` / `LazyTable` are immutable classes; their `Copy`/`Clone` `clone` returns the object.
// - Their `impl Decodable` (decoder.rs:676/683/690) live here as `decode_LazyValue` / `decode_LazyArray` /
//   `decode_LazyTable` (the generated decoders import them from this module, and decoder.ts extends classes of this
//   module at load time, so this module must not import decoder.ts at runtime).
// - `LazyTable::get` (table.rs) takes the table's `FixedSizeEncoding` dictionary first (PORTING section 5:
//   generic trait bounds become function tables): `root.tables.def_kind.get(fse_Option_DefKind, cdata, index)`.
// - Struct fields that clash with a method of the same name get `_` (`CrateRoot.stable_crate_id_`).
//
// `pub(crate) use decoder::{CrateMetadata, CrateNumMap, MetadataBlob, TargetModifiers};` is a type-only
// re-export (see above). `pub use encoder::{EncodedMetadata, encode_metadata, rendered_const};`: encoder.ts (lane
// encode-contract skeleton, filled by lanes encoder-a..d); ../lib.ts does not load it until `encode_metadata` is reached.
import type { DelimArgs } from "../../rustc_ast/lib.ts";
import type { Attribute } from "../../rustc_attr_ir/attr.ts";
import type { Deprecation } from "../../rustc_attr_ir/data_structures.gen.ts";
import type { ConstStability, DefaultBodyStability, Stability } from "../../rustc_attr_ir/stability.ts";
import type { CrateDepKind } from "../../rustc_crate_store/lib.ts";
import type { CtorKind, DefKind } from "../../rustc_hir/def.ts";
import type { Safety } from "../../rustc_hir/def.ts";
import type { DefKey } from "../../rustc_hir_id/definitions.ts";
import type { AmbigModChild, DocLinkResMap, ModChild } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Visibility, VariantDiscr } from "../../rustc_middle/ty/mod.ts";
import type { VariantIdx } from "../../rustc_middle/ty/decls.ts";
import type { IntrinsicDef } from "../../rustc_middle/ty/intrinsic.ts";
import type { ReprOptions } from "../../rustc_abi/lib.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import type { SymbolManglingVersion } from "../../rustc_session/config.ts";
import { CrateNum, DefId, DefIndex, type LocalDefId, type StableCrateId } from "../../rustc_span/def_id.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { type ExpnId, SyntaxContext } from "../../rustc_span/hygiene.ts";
import { BytePos, type Span } from "../../rustc_span/lib.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { PanicStrategy } from "../../rustc_target/spec/mod.ts";
import type { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import { type Debug, debug_int, debug_tuple } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";
import type { CrateMetadata, LazyDecoder, MetaBlob, Svh } from "./decoder.ts";
import type { DefPathHashMapRef } from "./def_path_hash_map.ts";
import type { EncodeContext } from "./encoder.ts";
import {
  type Asyncness,
  type Constness,
  type CoroutineKind,
  type Defaultness,
  type FixedSizeEncoding,
  fse_Asyncness,
  fse_AttrFlags,
  fse_bool,
  fse_Constness,
  fse_Defaultness,
  fse_LazyArray,
  fse_Option_CoroutineKind,
  fse_Option_DefKind,
  fse_Option_LazyArray,
  fse_Option_LazyValue,
  fse_Option_RawDefId,
  fse_Safety,
  fse_u64,
  TableBuilder,
} from "./table.ts";

export type { CrateMetadata, CrateNumMap, MetadataBlob, TargetModifiers } from "./decoder.ts";
// pub(crate) use parameterized::ParameterizedOverTcx; (a type-level trait, erased: see parameterized.ts)

// mod decoder; mod def_path_hash_map; mod encoder; mod parameterized; mod table;
// (decoder.ts / def_path_hash_map.ts / table.ts are loaded by ../lib.ts after this module; encoder.rs is M5)

// rustc: compiler/rustc_metadata/src/rmeta/mod.rs:62 rustc_version
export function rustc_version(cfg_version: string): string {
  return `rustc ${cfg_version}`;
}

/// Metadata encoding version.
/// N.B., increment this if you change the format of metadata such that
/// the rustc version can't be found to compare with `rustc_version()`.
export const METADATA_VERSION = 11;

/// Metadata header which includes `METADATA_VERSION`.
///
/// This header is followed by the `CrateRoot` and `CrateRootUnhashed` positions
/// which represent the hashed and unhashed metadata contents respectively, the
/// crate hash (SVH), and the rustc version string. See the offset constants
/// below for the exact layout.
export const METADATA_HEADER: Uint8Array = new Uint8Array([0x72 /* r */, 0x75 /* u */, 0x73 /* s */, 0x74 /* t */, 0, 0, 0, METADATA_VERSION]);

/// Fixed-size fields encoded immediately after `METADATA_HEADER`, in order:
/// `CrateRoot` position (u64), `CrateRootUnhashed` position (u64), crate hash
/// (`Fingerprint`/SVH), then the variable-length rustc version string.
export const ROOT_POS_OFFSET: number = METADATA_HEADER.length;
export const ROOT_POS_LEN: number = 8; // size_of::<u64>()
export const UNHASHED_POS_OFFSET: number = ROOT_POS_OFFSET + ROOT_POS_LEN;
export const UNHASHED_POS_LEN: number = 8; // size_of::<u64>()
export const CRATE_HASH_OFFSET: number = UNHASHED_POS_OFFSET + UNHASHED_POS_LEN;
export const CRATE_HASH_LEN: number = 16; // size_of::<Fingerprint>()
export const VERSION_OFFSET: number = CRATE_HASH_OFFSET + CRATE_HASH_LEN;

/// A value of type T referred to by its absolute position
/// in the metadata, and which can be decoded lazily.
///
/// Metadata is effective a tree, encoded in post-order,
/// and with the root's position written next to the header.
/// That means every single `LazyValue` points to some previous
/// location in the metadata and is part of a larger node.
///
/// The first `LazyValue` in a node is encoded as the backwards
/// distance from the position where the containing node
/// starts and where the `LazyValue` points to, while the rest
/// use the forward distance from the previous `LazyValue`.
/// Distances start at 1, as 0-byte nodes are invalid.
/// Also invalid are nodes being referred in a different
/// order than they were encoded in.
// #[must_use]
// PORT: `T` is phantom (`PhantomData<fn() -> T>`); `decode` (decoder.rs:309) takes T's `Decodable` fn.
export class LazyValue<T> {
  declare readonly __T?: T;
  constructor(readonly position: number) {}

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:112 from_position
  static from_position<T>(position: number): LazyValue<T> {
    return new LazyValue<T>(position);
  }

  // `impl<T> Copy for LazyValue<T> {}`
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:175 clone
  clone(): LazyValue<T> {
    return this;
  }
}

/// A list of lazily-decoded values.
///
/// Unlike `LazyValue<Vec<T>>`, the length is encoded next to the
/// position, not at the position, which means that the length
/// doesn't need to be known before encoding all the elements.
///
/// If the length is 0, no position is encoded, but otherwise,
/// the encoding is that of `LazyArray`, with the distinction that
/// the minimal distance the length of the sequence, i.e.
/// it's assumed there's no 0-byte element in the sequence.
export class LazyArray<T> {
  declare readonly __T?: T;
  constructor(
    readonly position: number,
    readonly num_elems: number,
  ) {}

  // impl<T> Default for LazyArray<T>
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:134 default
  static default<T>(): LazyArray<T> {
    return LazyArray.from_position_and_num_elems<T>(1, 0);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:140 from_position_and_num_elems
  static from_position_and_num_elems<T>(position: number, num_elems: number): LazyArray<T> {
    return new LazyArray<T>(position, num_elems);
  }

  // `impl<T> Copy for LazyArray<T> {}`
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:182 clone
  clone(): LazyArray<T> {
    return this;
  }
}

/// A list of lazily-decoded values, with the added capability of random access.
///
/// Random-access table (i.e. offering constant-time `get`/`set`), similar to
/// `LazyArray<T>`, but without requiring encoding or decoding all the values
/// eagerly and in-order.
///
/// `IdxEncode` - is a type of index that is used to write to the table,
/// `IdxDecode` - is a type of index that is used to read from the table.
export class LazyTable<IdxEncode, IdxDecode, T> {
  declare readonly __T?: [IdxEncode, IdxDecode, T];
  constructor(
    readonly position: number,
    /// The encoded size of the elements of a table is selected at runtime to drop
    /// trailing zeroes. This is the number of bytes used for each table element.
    readonly width: number,
    /// How many elements are in the table.
    readonly len: number,
  ) {}

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:164 from_position_and_encoded_size
  static from_position_and_encoded_size<Ie, Id, T>(position: number, width: number, len: number): LazyTable<Ie, Id, T> {
    return new LazyTable<Ie, Id, T>(position, width, len);
  }

  // `impl<Ie, Id, T> Copy for LazyTable<Ie, Id, T> {}`
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:189 clone
  clone(): LazyTable<IdxEncode, IdxDecode, T> {
    return this;
  }

  // ---- impl LazyTable (table.rs:505) ----
  // PORT: in the class body (PORTING section 8), so this module needs no runtime import of table.ts / decoder.ts
  // for it. `T: FixedSizeEncoding` is the `fse` dictionary (table.ts `fse_*`); `T::Value<'tcx>` is `T`.

  /// Given the metadata, extract out the value at a particular index (if any).
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:515 get
  get(fse: FixedSizeEncoding<T>, metadata: MetaBlob, i: IdxDecode & number): T {
    // Access past the end of the table returns a Default
    if (i >= this.len) {
      return fse.default();
    }

    const width = this.width;
    const start = this.position + width * i;
    const end = start + width;
    const blob = metadata.blob().deref();
    // `&metadata.blob()[start..end]`
    if (end > blob.length) panic(`range end index ${end} out of range for slice of length ${blob.length}`);
    const bytes = blob.subarray(start, end);

    // `if let Ok(fixed) = bytes.try_into()`: the width is the full `[u8; N]`
    if (bytes.length === fse.BYTE_LEN) {
      return fse.from_bytes(bytes);
    } else {
      const fixed = new Uint8Array(fse.BYTE_LEN);
      fixed.set(bytes);
      return fse.from_bytes(fixed);
    }
  }

  /// Size of the table in entries, including possible gaps.
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:536 size
  size(): number {
    return this.len;
  }
}

/// Encoding / decoding state for `Lazy`s (`LazyValue`, `LazyArray`, and `LazyTable`).
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type LazyState =
  /// Outside of a metadata node.
  | { readonly $: "NoNode" }
  /// Inside a metadata node, and before any `Lazy`s.
  /// The position is that of the node itself.
  | { readonly $: "NodeStart"; readonly _0: number }
  /// Inside a metadata node, with a previous `Lazy`s.
  /// The position is where that previous `Lazy` would start.
  | { readonly $: "Previous"; readonly _0: number };
/** Unit variants of `LazyState`, shared frozen singletons. */
export const LazyState = {
  NoNode: Object.freeze({ $: "NoNode" as const }) as LazyState,
};
/** `#[derive(Debug)]` */
export const debug_LazyState: Debug<LazyState> = (v, f) => {
  switch (v.$) {
    case "NoNode":
      return "NoNode";
    case "NodeStart":
      return debug_tuple(f, "NodeStart", [debug_int(v._0, f)]);
    case "Previous":
      return debug_tuple(f, "Previous", [debug_int(v._0, f)]);
  }
};

export type SyntaxContextTable = LazyTable<number, number, LazyValue<unknown /* SyntaxContextKey */> | undefined>;
export type ExpnDataTable = LazyTable<number /* ExpnIndex */, number /* ExpnIndex */, LazyValue<unknown /* ExpnData */> | undefined>;
export type ExpnHashTable = LazyTable<number /* ExpnIndex */, number /* ExpnIndex */, LazyValue<unknown /* ExpnHash */> | undefined>;

// #[derive(MetadataEncodable, LazyDecodable)]
export interface ProcMacroData {
  proc_macro_decls_static: LazyValue<LocalDefId>;
  stability: Stability | undefined;
  macros: LazyArray<[LocalDefId, LazyValue<ProcMacroKind>]>;
  proc_macro_quoted_spans: LazyTable<number, number, LazyValue<Span> | undefined>;
}

// #[derive(MetadataEncodable, LazyDecodable)]
export type ProcMacroKind =
  | { readonly $: "CustomDerive"; trait_name: string; attributes: string[] }
  | { readonly $: "Attr"; name: string }
  | { readonly $: "Bang"; name: string };

/// Serialized crate metadata.
///
/// This contains just enough information to determine if we should load the `CrateRoot` or not.
/// Prefer [`CrateRoot`] whenever possible to avoid ICEs when using `omit-git-hash` locally.
/// See #76720 for more details.
///
/// If you do modify this struct, also bump the [`METADATA_VERSION`] constant.
// #[derive(MetadataEncodable, BlobDecodable)]
export interface CrateHeader {
  triple: TargetTuple;
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
// PORT: a class (decoder.rs's `impl CrateRoot` adds methods); `stable_crate_id` is `stable_crate_id_` (the
// method `stable_crate_id()` has the name). Element types tools/codegen has no TS type for are `unknown`.
export class CrateRoot {
  constructor(
    /// A header used to detect if this is the right crate to load.
    public header: CrateHeader,

    public stable_crate_id_: StableCrateId,
    public required_panic_strategy: PanicStrategy | undefined,
    public panic_in_drop_strategy: PanicStrategy,
    public edition: Edition,
    public has_global_allocator: boolean,
    public has_alloc_error_handler: boolean,
    public has_panic_handler: boolean,
    public has_default_lib_allocator: boolean,
    public externally_implementable_items: LazyArray<unknown /* EiiMapEncodedKeyValue */>,

    public crate_deps: LazyArray<CrateDep>,
    public dylib_dependency_formats: LazyArray<unknown /* Option<LinkagePreference> */>,
    public lib_features: LazyArray<[Symbol, unknown /* FeatureStability */]>,
    public stability_implications: LazyArray<[Symbol, Symbol]>,
    public lang_items: LazyArray<[LocalDefId, unknown /* LangItem */]>,
    public lang_items_missing: LazyArray<unknown /* LangItem */>,
    public stripped_cfg_items: LazyArray<unknown /* StrippedCfgItem<LocalDefId> */>,
    public diagnostic_items: LazyArray<[Symbol, LocalDefId]>,
    public canonical_symbols: LazyArray<[Symbol, LocalDefId]>,
    public fake_doc_items: LazyArray<LocalDefId>,
    public native_libraries: LazyArray<unknown /* NativeLib */>,
    public foreign_modules: LazyArray<unknown /* ForeignModule */>,
    public traits: LazyArray<LocalDefId>,
    public impls: LazyArray<TraitImpls>,
    public incoherent_impls: LazyArray<IncoherentImpls>,
    public interpret_alloc_index: LazyArray<number>,
    public proc_macro_data: ProcMacroData | undefined,

    public tables: LazyTables,
    public debugger_visualizers: LazyArray<unknown /* DebuggerVisualizerFile */>,

    public exportable_items: LazyArray<LocalDefId>,
    public stable_order_of_exportable_impls: LazyArray<[LocalDefId, number]>,
    public exported_non_generic_symbols: LazyArray<unknown /* (ExportedSymbol<'static>, SymbolExportInfo) */>,
    public exported_generic_symbols: LazyArray<unknown /* (ExportedSymbol<'static>, SymbolExportInfo) */>,

    public syntax_contexts: SyntaxContextTable,
    public expn_data: ExpnDataTable,
    public expn_hashes: ExpnHashTable,

    public def_path_hash_map: LazyValue<DefPathHashMapRef>,

    public source_map: LazyTable<number, number, LazyValue<unknown /* rustc_span::SourceFile */> | undefined>,
    public target_modifiers: LazyArray<unknown /* TargetModifier */>,
    public denied_partial_mitigations: LazyArray<unknown /* DeniedPartialMitigation */>,

    public compiler_builtins: boolean,
    public needs_allocator: boolean,
    public needs_panic_runtime: boolean,
    public no_builtins: boolean,
    public panic_runtime: boolean,
    public profiler_runtime: boolean,
    public symbol_mangling_version: SymbolManglingVersion,

    public specialization_enabled_in: boolean,
  ) {}
}

/// A separate struct for extra metadata that must be encoded *after*
/// the main crate hash is finalized.
// #[derive(MetadataEncodable, LazyDecodable)]
export interface CrateRootUnhashed {
  extra_filename: string;

  /// The `-C extra-filename` of each dependency, indexed by the `CrateNum` they had in *this*
  /// crate's encoding. The `LOCAL_CRATE` slot is unused filler so that dependency `CrateNum`s
  /// can index this directly; this crate's own value is `extra_filename` above.
  dep_extra_filenames: string[];
}

/// On-disk representation of `DefId`.
/// This creates a type-safe way to enforce that we remap the CrateNum between the on-disk
/// representation and the compilation session.
// #[derive(Copy, Clone, Hash, PartialEq, Eq, Encodable, BlobDecodable)]
export class RawDefId {
  constructor(
    readonly krate: number,
    readonly index: number,
  ) {}

  // impl From<DefId> for RawDefId
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:353 from
  static from(val: DefId): RawDefId {
    return new RawDefId(CrateNum.as_u32(val.krate), DefIndex.as_u32(val.index));
  }

  /// This exists so that `provide_one!` is happy
  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:360 decode
  decode(meta: [CrateMetadata, TyCtxt]): DefId {
    let krate = CrateNum.from_u32(this.krate);
    krate = meta[0].map_encoded_cnum_to_current(krate);
    return new DefId(DefIndex.from_u32(this.index), krate);
  }
}
/** `#[derive(PartialEq)]` / `Hash`: the `FxIndexMap<RawDefId, _>` key (`CrateMetadata.trait_impls`). */
export function RawDefId_key(v: RawDefId): string {
  return `${v.krate}:${v.index}`;
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

// #[derive(MetadataEncodable, LazyDecodable)]
export interface TraitImpls {
  trait_id: RawDefId;
  impls: LazyArray<[LocalDefId, unknown /* Option<SimplifiedType> */]>;
}

// #[derive(MetadataEncodable, LazyDecodable)]
export interface IncoherentImpls {
  self_ty: LazyValue<unknown /* SimplifiedType */>;
  impls: LazyArray<LocalDefId>;
}

/// Define `LazyTables` and `TableBuilders` at the same time.
// macro_rules! define_tables { .. } (mod.rs:393), expanded below for the invocation at mod.rs:421.
// PORT: element types tools/codegen has no TS type for are `unknown` (the `T` of `LazyValue` / `LazyArray` is
// phantom; `decode` takes the element's `Decodable` fn); each table's upstream type is in its doc comment.

// #[derive(MetadataEncodable, LazyDecodable)]
export interface LazyTables {
  // - defaulted:
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::IntrinsicDef>>>` */
  intrinsic: LazyTable<LocalDefId, DefIndex, LazyValue<IntrinsicDef> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, bool>` */
  is_macro_rules: LazyTable<LocalDefId, DefIndex, boolean>;
  /** `LazyTable<LocalDefId, DefIndex, bool>` */
  type_alias_is_checked: LazyTable<LocalDefId, DefIndex, boolean>;
  /** `LazyTable<LocalDefId, DefIndex, AttrFlags>` */
  attr_flags: LazyTable<LocalDefId, DefIndex, AttrFlags>;
  // The u64 is the crate-local part of the DefPathHash. All hashes in this crate have the same
  // StableCrateId, so we omit encoding those into the table.
  //
  // Note also that this table is fully populated (no gaps) as every DefIndex should have a
  // corresponding DefPathHash.
  /** `LazyTable<LocalDefId, DefIndex, u64>` */
  def_path_hashes: LazyTable<LocalDefId, DefIndex, bigint>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::Clause<'static>, Span)>>` */
  explicit_item_bounds: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::Clause<'static>, Span)>>` */
  explicit_item_self_bounds: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::Clause<'static>, Span)>>` */
  inferred_outlives_of: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::Clause<'static>, Span)>>` */
  explicit_super_clauses_of: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::Clause<'static>, Span)>>` */
  explicit_implied_clauses_of: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<(ty::PolyTraitRef<'static>, Span)>>` */
  explicit_implied_const_bounds: LazyTable<LocalDefId, DefIndex, LazyArray<unknown>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<LocalDefId>>` */
  inherent_impls: LazyTable<LocalDefId, DefIndex, LazyArray<LocalDefId>>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::ImplTraitInTraitData>>>` */
  opt_rpitit_info: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  // Reexported names are not associated with individual `DefId`s,
  // e.g. a glob import can introduce a lot of names, all with the same `DefId`.
  // That's why the encoded list needs to contain `ModChild` structures describing all the names
  // individually instead of `DefId`s.
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<ModChild>>` */
  module_children_reexports: LazyTable<LocalDefId, DefIndex, LazyArray<ModChild>>;
  /** `LazyTable<LocalDefId, DefIndex, LazyArray<AmbigModChild>>` */
  ambig_module_children: LazyTable<LocalDefId, DefIndex, LazyArray<AmbigModChild>>;
  /** `LazyTable<LocalDefId, DefIndex, bool>` */
  cross_crate_inlinable: LazyTable<LocalDefId, DefIndex, boolean>;
  /** `LazyTable<LocalDefId, DefIndex, ty::Asyncness>` */
  asyncness: LazyTable<LocalDefId, DefIndex, Asyncness>;
  /** `LazyTable<LocalDefId, DefIndex, hir::Constness>` */
  constness: LazyTable<LocalDefId, DefIndex, Constness>;
  /** `LazyTable<LocalDefId, DefIndex, hir::Safety>` */
  safety: LazyTable<LocalDefId, DefIndex, Safety>;
  /** `LazyTable<LocalDefId, DefIndex, hir::Defaultness>` */
  defaultness: LazyTable<LocalDefId, DefIndex, Defaultness>;
  /** `LazyTable<LocalDefId, DefIndex, bool>` */
  impl_is_fully_generic_for_reflection: LazyTable<LocalDefId, DefIndex, boolean>;
  // - optional:
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<Attribute>>>` */
  attributes: LazyTable<LocalDefId, DefIndex, LazyArray<Attribute> | undefined>;
  // For non-reexported names in a module every name is associated with a separate `DefId`,
  // so we can take their names, visibilities etc from other encoded tables.
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<LocalDefId>>>` */
  module_children_non_reexports: LazyTable<LocalDefId, DefIndex, LazyArray<LocalDefId> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<LocalDefId>>>` */
  associated_item_or_field_def_ids: LazyTable<LocalDefId, DefIndex, LazyArray<LocalDefId> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<DefKind>>` */
  def_kind: LazyTable<LocalDefId, DefIndex, DefKind | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::Visibility<LocalDefId>>>>` */
  visibility: LazyTable<LocalDefId, DefIndex, LazyValue<Visibility<LocalDefId>> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Span>>>` */
  def_span: LazyTable<LocalDefId, DefIndex, LazyValue<Span> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Span>>>` */
  def_ident_span: LazyTable<LocalDefId, DefIndex, LazyValue<Span> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Stability>>>` */
  lookup_stability: LazyTable<LocalDefId, DefIndex, LazyValue<Stability> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ConstStability>>>` */
  lookup_const_stability: LazyTable<LocalDefId, DefIndex, LazyValue<ConstStability> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DefaultBodyStability>>>` */
  lookup_default_body_stability: LazyTable<LocalDefId, DefIndex, LazyValue<DefaultBodyStability> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Deprecation>>>` */
  lookup_deprecation_entry: LazyTable<LocalDefId, DefIndex, LazyValue<Deprecation> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::GenericClauses<'static>>>>` */
  explicit_clauses_of: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::Generics>>>` */
  generics_of: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::EarlyBinder<'static, Ty<'static>>>>>` */
  type_of: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<ty::Variance>>>` */
  variances_of: LazyTable<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::EarlyBinder<'static, ty::PolyFnSig<'static>>>>>` */
  fn_sig: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<CodegenFnAttrs>>>` */
  codegen_fn_attrs: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::ImplTraitHeader<'static>>>>` */
  impl_trait_header: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::EarlyBinder<'static, rustc_middle::ty::Const<'static>>>>>` */
  const_param_default: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ObjectLifetimeDefault>>>` */
  object_lifetime_default: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<mir::Body<'static>>>>` */
  optimized_mir: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<mir::Body<'static>>>>` */
  mir_for_ctfe: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<(ConstValue, Ty<'static>)>>>` */
  trivial_const: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<IndexVec<FieldIdx, Symbol>>>>` */
  closure_saved_names_of_captured_variables: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<mir::CoroutineLayout<'static>>>>` */
  mir_coroutine_witnesses: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<IndexVec<mir::Promoted, mir::Body<'static>>>>>` */
  promoted_mir: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::EarlyBinder<'static, ty::Const<'static>>>>>` */
  thir_abstract_const: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<RawDefId>>` */
  impl_parent: LazyTable<LocalDefId, DefIndex, RawDefId | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::ConstConditions<'static>>>>` */
  const_conditions: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  // FIXME(eddyb) perhaps compute this on the fly if cheap enough?
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::adjustment::CoerceUnsizedInfo>>>` */
  coerce_unsized_info: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<mir::ConstQualifs>>>` */
  mir_const_qualif: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<String>>>` */
  rendered_const: LazyTable<LocalDefId, DefIndex, LazyValue<string> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<PreciseCapturingArgKind<Symbol, Symbol>>>>` */
  rendered_precise_capturing_args: LazyTable<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<Option<Ident>>>>` */
  fn_arg_idents: LazyTable<LocalDefId, DefIndex, LazyArray<Ident | undefined> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<hir::CoroutineKind>>` */
  coroutine_kind: LazyTable<LocalDefId, DefIndex, CoroutineKind | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<RawDefId>>` */
  coroutine_for_closure: LazyTable<LocalDefId, DefIndex, RawDefId | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::Destructor>>>` */
  adt_destructor: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::AsyncDestructor>>>` */
  adt_async_destructor: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<RawDefId>>` */
  coroutine_by_move_body_def_id: LazyTable<LocalDefId, DefIndex, RawDefId | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<mir::interpret::ConstAllocation<'static>>>>` */
  eval_static_initializer: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::TraitDef>>>` */
  trait_def: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ExpnId>>>` */
  expn_that_defined: LazyTable<LocalDefId, DefIndex, LazyValue<ExpnId> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DefId>>>` */
  default_fields: LazyTable<LocalDefId, DefIndex, LazyValue<DefId> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DenseBitSet<u32>>>>` */
  params_in_repr: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ReprOptions>>>` */
  repr_options: LazyTable<LocalDefId, DefIndex, LazyValue<ReprOptions> | undefined>;
  // `def_keys` and `def_path_hashes` represent a lazy version of a
  // `DefPathTable`. This allows us to avoid deserializing an entire
  // `DefPathTable` up front, since we may only ever use a few
  // definitions from any given crate.
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DefKey>>>` */
  def_keys: LazyTable<LocalDefId, DefIndex, LazyValue<DefKey> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<VariantData>>>` */
  variant_data: LazyTable<LocalDefId, DefIndex, LazyValue<VariantData> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::AssocContainer>>>` */
  assoc_container: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ast::DelimArgs>>>` */
  macro_definition: LazyTable<LocalDefId, DefIndex, LazyValue<DelimArgs> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<DeducedParamAttrs>>>` */
  deduced_param_attrs: LazyTable<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DefIdMap<ty::EarlyBinder<'static, Ty<'static>>>>>>` */
  collect_return_position_impl_trait_in_trait_tys: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DocLinkResMap>>>` */
  doc_link_resolutions: LazyTable<LocalDefId, DefIndex, LazyValue<DocLinkResMap> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<DefId>>>` */
  doc_link_traits_in_scope: LazyTable<LocalDefId, DefIndex, LazyArray<DefId> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyArray<(Ty<'static>, Span)>>>` */
  assumed_wf_types_for_rpitit: LazyTable<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<hir::OpaqueTyOrigin<DefId>>>>` */
  opaque_ty_origin: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::AnonConstKind>>>` */
  anon_const_kind: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Option<ty::EarlyBinder<'static, ty::Const<'static>>>>>>` */
  const_of_item: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DefIdMap<Vec<DefId>>>>>` */
  associated_types_for_impl_traits_in_trait_or_impl: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<DenseBitSet<u32>>>>` */
  live_args_for_alias_from_outlives_bounds: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<Vec<(usize, DenseBitSet<u32>)>>>>` */
  args_known_to_outlive_alias_params: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  /** `LazyTable<LocalDefId, DefIndex, Option<LazyValue<ty::RestrictionKind>>>` */
  mut_restriction: LazyTable<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
}

/**
 * `#[derive(LazyDecodable)]` of `LazyTables` (rustc_macros serialize.rs `decodable_body`: the fields in order).
 * PORT: hand-expanded: the struct is defined by `define_tables!`, which tools/codegen cannot see; reached from
 * the generated `decode_CrateRoot` through tools/codegen/serialize.json.
 */
export function decode_LazyTables(__decoder: LazyDecoder): LazyTables {
  return {
    intrinsic: decode_LazyTable(__decoder),
    is_macro_rules: decode_LazyTable(__decoder),
    type_alias_is_checked: decode_LazyTable(__decoder),
    attr_flags: decode_LazyTable(__decoder),
    def_path_hashes: decode_LazyTable(__decoder),
    explicit_item_bounds: decode_LazyTable(__decoder),
    explicit_item_self_bounds: decode_LazyTable(__decoder),
    inferred_outlives_of: decode_LazyTable(__decoder),
    explicit_super_clauses_of: decode_LazyTable(__decoder),
    explicit_implied_clauses_of: decode_LazyTable(__decoder),
    explicit_implied_const_bounds: decode_LazyTable(__decoder),
    inherent_impls: decode_LazyTable(__decoder),
    opt_rpitit_info: decode_LazyTable(__decoder),
    module_children_reexports: decode_LazyTable(__decoder),
    ambig_module_children: decode_LazyTable(__decoder),
    cross_crate_inlinable: decode_LazyTable(__decoder),
    asyncness: decode_LazyTable(__decoder),
    constness: decode_LazyTable(__decoder),
    safety: decode_LazyTable(__decoder),
    defaultness: decode_LazyTable(__decoder),
    impl_is_fully_generic_for_reflection: decode_LazyTable(__decoder),
    attributes: decode_LazyTable(__decoder),
    module_children_non_reexports: decode_LazyTable(__decoder),
    associated_item_or_field_def_ids: decode_LazyTable(__decoder),
    def_kind: decode_LazyTable(__decoder),
    visibility: decode_LazyTable(__decoder),
    def_span: decode_LazyTable(__decoder),
    def_ident_span: decode_LazyTable(__decoder),
    lookup_stability: decode_LazyTable(__decoder),
    lookup_const_stability: decode_LazyTable(__decoder),
    lookup_default_body_stability: decode_LazyTable(__decoder),
    lookup_deprecation_entry: decode_LazyTable(__decoder),
    explicit_clauses_of: decode_LazyTable(__decoder),
    generics_of: decode_LazyTable(__decoder),
    type_of: decode_LazyTable(__decoder),
    variances_of: decode_LazyTable(__decoder),
    fn_sig: decode_LazyTable(__decoder),
    codegen_fn_attrs: decode_LazyTable(__decoder),
    impl_trait_header: decode_LazyTable(__decoder),
    const_param_default: decode_LazyTable(__decoder),
    object_lifetime_default: decode_LazyTable(__decoder),
    optimized_mir: decode_LazyTable(__decoder),
    mir_for_ctfe: decode_LazyTable(__decoder),
    trivial_const: decode_LazyTable(__decoder),
    closure_saved_names_of_captured_variables: decode_LazyTable(__decoder),
    mir_coroutine_witnesses: decode_LazyTable(__decoder),
    promoted_mir: decode_LazyTable(__decoder),
    thir_abstract_const: decode_LazyTable(__decoder),
    impl_parent: decode_LazyTable(__decoder),
    const_conditions: decode_LazyTable(__decoder),
    coerce_unsized_info: decode_LazyTable(__decoder),
    mir_const_qualif: decode_LazyTable(__decoder),
    rendered_const: decode_LazyTable(__decoder),
    rendered_precise_capturing_args: decode_LazyTable(__decoder),
    fn_arg_idents: decode_LazyTable(__decoder),
    coroutine_kind: decode_LazyTable(__decoder),
    coroutine_for_closure: decode_LazyTable(__decoder),
    adt_destructor: decode_LazyTable(__decoder),
    adt_async_destructor: decode_LazyTable(__decoder),
    coroutine_by_move_body_def_id: decode_LazyTable(__decoder),
    eval_static_initializer: decode_LazyTable(__decoder),
    trait_def: decode_LazyTable(__decoder),
    expn_that_defined: decode_LazyTable(__decoder),
    default_fields: decode_LazyTable(__decoder),
    params_in_repr: decode_LazyTable(__decoder),
    repr_options: decode_LazyTable(__decoder),
    def_keys: decode_LazyTable(__decoder),
    variant_data: decode_LazyTable(__decoder),
    assoc_container: decode_LazyTable(__decoder),
    macro_definition: decode_LazyTable(__decoder),
    deduced_param_attrs: decode_LazyTable(__decoder),
    collect_return_position_impl_trait_in_trait_tys: decode_LazyTable(__decoder),
    doc_link_resolutions: decode_LazyTable(__decoder),
    doc_link_traits_in_scope: decode_LazyTable(__decoder),
    assumed_wf_types_for_rpitit: decode_LazyTable(__decoder),
    opaque_ty_origin: decode_LazyTable(__decoder),
    anon_const_kind: decode_LazyTable(__decoder),
    const_of_item: decode_LazyTable(__decoder),
    associated_types_for_impl_traits_in_trait_or_impl: decode_LazyTable(__decoder),
    live_args_for_alias_from_outlives_bounds: decode_LazyTable(__decoder),
    args_known_to_outlive_alias_params: decode_LazyTable(__decoder),
    mut_restriction: decode_LazyTable(__decoder),
  };
}

/**
 * `#[derive(MetadataEncodable)]` of `LazyTables` (rustc_macros serialize.rs `encodable_body`: the fields in order).
 * PORT (lane encode-contract): hand-expanded like `decode_LazyTables`; reached from the generated `encode_CrateRoot`
 * through tools/codegen/serialize.json.
 */
export function encode_LazyTables(self: LazyTables, __encoder: EncodeContext): void {
  encode_LazyTable(self.intrinsic, __encoder);
  encode_LazyTable(self.is_macro_rules, __encoder);
  encode_LazyTable(self.type_alias_is_checked, __encoder);
  encode_LazyTable(self.attr_flags, __encoder);
  encode_LazyTable(self.def_path_hashes, __encoder);
  encode_LazyTable(self.explicit_item_bounds, __encoder);
  encode_LazyTable(self.explicit_item_self_bounds, __encoder);
  encode_LazyTable(self.inferred_outlives_of, __encoder);
  encode_LazyTable(self.explicit_super_clauses_of, __encoder);
  encode_LazyTable(self.explicit_implied_clauses_of, __encoder);
  encode_LazyTable(self.explicit_implied_const_bounds, __encoder);
  encode_LazyTable(self.inherent_impls, __encoder);
  encode_LazyTable(self.opt_rpitit_info, __encoder);
  encode_LazyTable(self.module_children_reexports, __encoder);
  encode_LazyTable(self.ambig_module_children, __encoder);
  encode_LazyTable(self.cross_crate_inlinable, __encoder);
  encode_LazyTable(self.asyncness, __encoder);
  encode_LazyTable(self.constness, __encoder);
  encode_LazyTable(self.safety, __encoder);
  encode_LazyTable(self.defaultness, __encoder);
  encode_LazyTable(self.impl_is_fully_generic_for_reflection, __encoder);
  encode_LazyTable(self.attributes, __encoder);
  encode_LazyTable(self.module_children_non_reexports, __encoder);
  encode_LazyTable(self.associated_item_or_field_def_ids, __encoder);
  encode_LazyTable(self.def_kind, __encoder);
  encode_LazyTable(self.visibility, __encoder);
  encode_LazyTable(self.def_span, __encoder);
  encode_LazyTable(self.def_ident_span, __encoder);
  encode_LazyTable(self.lookup_stability, __encoder);
  encode_LazyTable(self.lookup_const_stability, __encoder);
  encode_LazyTable(self.lookup_default_body_stability, __encoder);
  encode_LazyTable(self.lookup_deprecation_entry, __encoder);
  encode_LazyTable(self.explicit_clauses_of, __encoder);
  encode_LazyTable(self.generics_of, __encoder);
  encode_LazyTable(self.type_of, __encoder);
  encode_LazyTable(self.variances_of, __encoder);
  encode_LazyTable(self.fn_sig, __encoder);
  encode_LazyTable(self.codegen_fn_attrs, __encoder);
  encode_LazyTable(self.impl_trait_header, __encoder);
  encode_LazyTable(self.const_param_default, __encoder);
  encode_LazyTable(self.object_lifetime_default, __encoder);
  encode_LazyTable(self.optimized_mir, __encoder);
  encode_LazyTable(self.mir_for_ctfe, __encoder);
  encode_LazyTable(self.trivial_const, __encoder);
  encode_LazyTable(self.closure_saved_names_of_captured_variables, __encoder);
  encode_LazyTable(self.mir_coroutine_witnesses, __encoder);
  encode_LazyTable(self.promoted_mir, __encoder);
  encode_LazyTable(self.thir_abstract_const, __encoder);
  encode_LazyTable(self.impl_parent, __encoder);
  encode_LazyTable(self.const_conditions, __encoder);
  encode_LazyTable(self.coerce_unsized_info, __encoder);
  encode_LazyTable(self.mir_const_qualif, __encoder);
  encode_LazyTable(self.rendered_const, __encoder);
  encode_LazyTable(self.rendered_precise_capturing_args, __encoder);
  encode_LazyTable(self.fn_arg_idents, __encoder);
  encode_LazyTable(self.coroutine_kind, __encoder);
  encode_LazyTable(self.coroutine_for_closure, __encoder);
  encode_LazyTable(self.adt_destructor, __encoder);
  encode_LazyTable(self.adt_async_destructor, __encoder);
  encode_LazyTable(self.coroutine_by_move_body_def_id, __encoder);
  encode_LazyTable(self.eval_static_initializer, __encoder);
  encode_LazyTable(self.trait_def, __encoder);
  encode_LazyTable(self.expn_that_defined, __encoder);
  encode_LazyTable(self.default_fields, __encoder);
  encode_LazyTable(self.params_in_repr, __encoder);
  encode_LazyTable(self.repr_options, __encoder);
  encode_LazyTable(self.def_keys, __encoder);
  encode_LazyTable(self.variant_data, __encoder);
  encode_LazyTable(self.assoc_container, __encoder);
  encode_LazyTable(self.macro_definition, __encoder);
  encode_LazyTable(self.deduced_param_attrs, __encoder);
  encode_LazyTable(self.collect_return_position_impl_trait_in_trait_tys, __encoder);
  encode_LazyTable(self.doc_link_resolutions, __encoder);
  encode_LazyTable(self.doc_link_traits_in_scope, __encoder);
  encode_LazyTable(self.assumed_wf_types_for_rpitit, __encoder);
  encode_LazyTable(self.opaque_ty_origin, __encoder);
  encode_LazyTable(self.anon_const_kind, __encoder);
  encode_LazyTable(self.const_of_item, __encoder);
  encode_LazyTable(self.associated_types_for_impl_traits_in_trait_or_impl, __encoder);
  encode_LazyTable(self.live_args_for_alias_from_outlives_bounds, __encoder);
  encode_LazyTable(self.args_known_to_outlive_alias_params, __encoder);
  encode_LazyTable(self.mut_restriction, __encoder);
}

// #[derive(Default)]
export interface TableBuilders {
  // - defaulted:
  intrinsic: TableBuilder<LocalDefId, DefIndex, LazyValue<IntrinsicDef> | undefined>;
  is_macro_rules: TableBuilder<LocalDefId, DefIndex, boolean>;
  type_alias_is_checked: TableBuilder<LocalDefId, DefIndex, boolean>;
  attr_flags: TableBuilder<LocalDefId, DefIndex, AttrFlags>;
  def_path_hashes: TableBuilder<LocalDefId, DefIndex, bigint>;
  explicit_item_bounds: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  explicit_item_self_bounds: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  inferred_outlives_of: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  explicit_super_clauses_of: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  explicit_implied_clauses_of: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  explicit_implied_const_bounds: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown>>;
  inherent_impls: TableBuilder<LocalDefId, DefIndex, LazyArray<LocalDefId>>;
  opt_rpitit_info: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  module_children_reexports: TableBuilder<LocalDefId, DefIndex, LazyArray<ModChild>>;
  ambig_module_children: TableBuilder<LocalDefId, DefIndex, LazyArray<AmbigModChild>>;
  cross_crate_inlinable: TableBuilder<LocalDefId, DefIndex, boolean>;
  asyncness: TableBuilder<LocalDefId, DefIndex, Asyncness>;
  constness: TableBuilder<LocalDefId, DefIndex, Constness>;
  safety: TableBuilder<LocalDefId, DefIndex, Safety>;
  defaultness: TableBuilder<LocalDefId, DefIndex, Defaultness>;
  impl_is_fully_generic_for_reflection: TableBuilder<LocalDefId, DefIndex, boolean>;
  // - optional:
  attributes: TableBuilder<LocalDefId, DefIndex, LazyArray<Attribute> | undefined>;
  module_children_non_reexports: TableBuilder<LocalDefId, DefIndex, LazyArray<LocalDefId> | undefined>;
  associated_item_or_field_def_ids: TableBuilder<LocalDefId, DefIndex, LazyArray<LocalDefId> | undefined>;
  def_kind: TableBuilder<LocalDefId, DefIndex, DefKind | undefined>;
  visibility: TableBuilder<LocalDefId, DefIndex, LazyValue<Visibility<LocalDefId>> | undefined>;
  def_span: TableBuilder<LocalDefId, DefIndex, LazyValue<Span> | undefined>;
  def_ident_span: TableBuilder<LocalDefId, DefIndex, LazyValue<Span> | undefined>;
  lookup_stability: TableBuilder<LocalDefId, DefIndex, LazyValue<Stability> | undefined>;
  lookup_const_stability: TableBuilder<LocalDefId, DefIndex, LazyValue<ConstStability> | undefined>;
  lookup_default_body_stability: TableBuilder<LocalDefId, DefIndex, LazyValue<DefaultBodyStability> | undefined>;
  lookup_deprecation_entry: TableBuilder<LocalDefId, DefIndex, LazyValue<Deprecation> | undefined>;
  explicit_clauses_of: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  generics_of: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  type_of: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  variances_of: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  fn_sig: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  codegen_fn_attrs: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  impl_trait_header: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  const_param_default: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  object_lifetime_default: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  optimized_mir: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  mir_for_ctfe: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  trivial_const: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  closure_saved_names_of_captured_variables: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  mir_coroutine_witnesses: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  promoted_mir: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  thir_abstract_const: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  impl_parent: TableBuilder<LocalDefId, DefIndex, RawDefId | undefined>;
  const_conditions: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  coerce_unsized_info: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  mir_const_qualif: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  rendered_const: TableBuilder<LocalDefId, DefIndex, LazyValue<string> | undefined>;
  rendered_precise_capturing_args: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  fn_arg_idents: TableBuilder<LocalDefId, DefIndex, LazyArray<Ident | undefined> | undefined>;
  coroutine_kind: TableBuilder<LocalDefId, DefIndex, CoroutineKind | undefined>;
  coroutine_for_closure: TableBuilder<LocalDefId, DefIndex, RawDefId | undefined>;
  adt_destructor: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  adt_async_destructor: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  coroutine_by_move_body_def_id: TableBuilder<LocalDefId, DefIndex, RawDefId | undefined>;
  eval_static_initializer: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  trait_def: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  expn_that_defined: TableBuilder<LocalDefId, DefIndex, LazyValue<ExpnId> | undefined>;
  default_fields: TableBuilder<LocalDefId, DefIndex, LazyValue<DefId> | undefined>;
  params_in_repr: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  repr_options: TableBuilder<LocalDefId, DefIndex, LazyValue<ReprOptions> | undefined>;
  def_keys: TableBuilder<LocalDefId, DefIndex, LazyValue<DefKey> | undefined>;
  variant_data: TableBuilder<LocalDefId, DefIndex, LazyValue<VariantData> | undefined>;
  assoc_container: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  macro_definition: TableBuilder<LocalDefId, DefIndex, LazyValue<DelimArgs> | undefined>;
  deduced_param_attrs: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  collect_return_position_impl_trait_in_trait_tys: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  doc_link_resolutions: TableBuilder<LocalDefId, DefIndex, LazyValue<DocLinkResMap> | undefined>;
  doc_link_traits_in_scope: TableBuilder<LocalDefId, DefIndex, LazyArray<DefId> | undefined>;
  assumed_wf_types_for_rpitit: TableBuilder<LocalDefId, DefIndex, LazyArray<unknown> | undefined>;
  opaque_ty_origin: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  anon_const_kind: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  const_of_item: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  associated_types_for_impl_traits_in_trait_or_impl: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  live_args_for_alias_from_outlives_bounds: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  args_known_to_outlive_alias_params: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
  mut_restriction: TableBuilder<LocalDefId, DefIndex, LazyValue<unknown> | undefined>;
}

/**
 * `#[derive(Default)]` of `TableBuilders`. PORT: hand-expanded (`define_tables!`); each `TableBuilder::default()` takes
 * its element's `FixedSizeEncoding` dictionary (table.ts).
 */
export function TableBuilders_default(): TableBuilders {
  return {
    intrinsic: TableBuilder.default(fse_Option_LazyValue),
    is_macro_rules: TableBuilder.default(fse_bool),
    type_alias_is_checked: TableBuilder.default(fse_bool),
    attr_flags: TableBuilder.default(fse_AttrFlags),
    def_path_hashes: TableBuilder.default(fse_u64),
    explicit_item_bounds: TableBuilder.default(fse_LazyArray),
    explicit_item_self_bounds: TableBuilder.default(fse_LazyArray),
    inferred_outlives_of: TableBuilder.default(fse_LazyArray),
    explicit_super_clauses_of: TableBuilder.default(fse_LazyArray),
    explicit_implied_clauses_of: TableBuilder.default(fse_LazyArray),
    explicit_implied_const_bounds: TableBuilder.default(fse_LazyArray),
    inherent_impls: TableBuilder.default(fse_LazyArray),
    opt_rpitit_info: TableBuilder.default(fse_Option_LazyValue),
    module_children_reexports: TableBuilder.default(fse_LazyArray),
    ambig_module_children: TableBuilder.default(fse_LazyArray),
    cross_crate_inlinable: TableBuilder.default(fse_bool),
    asyncness: TableBuilder.default(fse_Asyncness),
    constness: TableBuilder.default(fse_Constness),
    safety: TableBuilder.default(fse_Safety),
    defaultness: TableBuilder.default(fse_Defaultness),
    impl_is_fully_generic_for_reflection: TableBuilder.default(fse_bool),
    attributes: TableBuilder.default(fse_Option_LazyArray),
    module_children_non_reexports: TableBuilder.default(fse_Option_LazyArray),
    associated_item_or_field_def_ids: TableBuilder.default(fse_Option_LazyArray),
    def_kind: TableBuilder.default(fse_Option_DefKind),
    visibility: TableBuilder.default(fse_Option_LazyValue),
    def_span: TableBuilder.default(fse_Option_LazyValue),
    def_ident_span: TableBuilder.default(fse_Option_LazyValue),
    lookup_stability: TableBuilder.default(fse_Option_LazyValue),
    lookup_const_stability: TableBuilder.default(fse_Option_LazyValue),
    lookup_default_body_stability: TableBuilder.default(fse_Option_LazyValue),
    lookup_deprecation_entry: TableBuilder.default(fse_Option_LazyValue),
    explicit_clauses_of: TableBuilder.default(fse_Option_LazyValue),
    generics_of: TableBuilder.default(fse_Option_LazyValue),
    type_of: TableBuilder.default(fse_Option_LazyValue),
    variances_of: TableBuilder.default(fse_Option_LazyArray),
    fn_sig: TableBuilder.default(fse_Option_LazyValue),
    codegen_fn_attrs: TableBuilder.default(fse_Option_LazyValue),
    impl_trait_header: TableBuilder.default(fse_Option_LazyValue),
    const_param_default: TableBuilder.default(fse_Option_LazyValue),
    object_lifetime_default: TableBuilder.default(fse_Option_LazyValue),
    optimized_mir: TableBuilder.default(fse_Option_LazyValue),
    mir_for_ctfe: TableBuilder.default(fse_Option_LazyValue),
    trivial_const: TableBuilder.default(fse_Option_LazyValue),
    closure_saved_names_of_captured_variables: TableBuilder.default(fse_Option_LazyValue),
    mir_coroutine_witnesses: TableBuilder.default(fse_Option_LazyValue),
    promoted_mir: TableBuilder.default(fse_Option_LazyValue),
    thir_abstract_const: TableBuilder.default(fse_Option_LazyValue),
    impl_parent: TableBuilder.default(fse_Option_RawDefId),
    const_conditions: TableBuilder.default(fse_Option_LazyValue),
    coerce_unsized_info: TableBuilder.default(fse_Option_LazyValue),
    mir_const_qualif: TableBuilder.default(fse_Option_LazyValue),
    rendered_const: TableBuilder.default(fse_Option_LazyValue),
    rendered_precise_capturing_args: TableBuilder.default(fse_Option_LazyArray),
    fn_arg_idents: TableBuilder.default(fse_Option_LazyArray),
    coroutine_kind: TableBuilder.default(fse_Option_CoroutineKind),
    coroutine_for_closure: TableBuilder.default(fse_Option_RawDefId),
    adt_destructor: TableBuilder.default(fse_Option_LazyValue),
    adt_async_destructor: TableBuilder.default(fse_Option_LazyValue),
    coroutine_by_move_body_def_id: TableBuilder.default(fse_Option_RawDefId),
    eval_static_initializer: TableBuilder.default(fse_Option_LazyValue),
    trait_def: TableBuilder.default(fse_Option_LazyValue),
    expn_that_defined: TableBuilder.default(fse_Option_LazyValue),
    default_fields: TableBuilder.default(fse_Option_LazyValue),
    params_in_repr: TableBuilder.default(fse_Option_LazyValue),
    repr_options: TableBuilder.default(fse_Option_LazyValue),
    def_keys: TableBuilder.default(fse_Option_LazyValue),
    variant_data: TableBuilder.default(fse_Option_LazyValue),
    assoc_container: TableBuilder.default(fse_Option_LazyValue),
    macro_definition: TableBuilder.default(fse_Option_LazyValue),
    deduced_param_attrs: TableBuilder.default(fse_Option_LazyArray),
    collect_return_position_impl_trait_in_trait_tys: TableBuilder.default(fse_Option_LazyValue),
    doc_link_resolutions: TableBuilder.default(fse_Option_LazyValue),
    doc_link_traits_in_scope: TableBuilder.default(fse_Option_LazyArray),
    assumed_wf_types_for_rpitit: TableBuilder.default(fse_Option_LazyArray),
    opaque_ty_origin: TableBuilder.default(fse_Option_LazyValue),
    anon_const_kind: TableBuilder.default(fse_Option_LazyValue),
    const_of_item: TableBuilder.default(fse_Option_LazyValue),
    associated_types_for_impl_traits_in_trait_or_impl: TableBuilder.default(fse_Option_LazyValue),
    live_args_for_alias_from_outlives_bounds: TableBuilder.default(fse_Option_LazyValue),
    args_known_to_outlive_alias_params: TableBuilder.default(fse_Option_LazyValue),
    mut_restriction: TableBuilder.default(fse_Option_LazyValue),
  };
}

// impl TableBuilders
// rustc: compiler/rustc_metadata/src/rmeta/mod.rs:411 encode
export function TableBuilders_encode(self: TableBuilders, buf: FileEncoder): LazyTables {
  return {
    intrinsic: self.intrinsic.encode(buf),
    is_macro_rules: self.is_macro_rules.encode(buf),
    type_alias_is_checked: self.type_alias_is_checked.encode(buf),
    attr_flags: self.attr_flags.encode(buf),
    def_path_hashes: self.def_path_hashes.encode(buf),
    explicit_item_bounds: self.explicit_item_bounds.encode(buf),
    explicit_item_self_bounds: self.explicit_item_self_bounds.encode(buf),
    inferred_outlives_of: self.inferred_outlives_of.encode(buf),
    explicit_super_clauses_of: self.explicit_super_clauses_of.encode(buf),
    explicit_implied_clauses_of: self.explicit_implied_clauses_of.encode(buf),
    explicit_implied_const_bounds: self.explicit_implied_const_bounds.encode(buf),
    inherent_impls: self.inherent_impls.encode(buf),
    opt_rpitit_info: self.opt_rpitit_info.encode(buf),
    module_children_reexports: self.module_children_reexports.encode(buf),
    ambig_module_children: self.ambig_module_children.encode(buf),
    cross_crate_inlinable: self.cross_crate_inlinable.encode(buf),
    asyncness: self.asyncness.encode(buf),
    constness: self.constness.encode(buf),
    safety: self.safety.encode(buf),
    defaultness: self.defaultness.encode(buf),
    impl_is_fully_generic_for_reflection: self.impl_is_fully_generic_for_reflection.encode(buf),
    attributes: self.attributes.encode(buf),
    module_children_non_reexports: self.module_children_non_reexports.encode(buf),
    associated_item_or_field_def_ids: self.associated_item_or_field_def_ids.encode(buf),
    def_kind: self.def_kind.encode(buf),
    visibility: self.visibility.encode(buf),
    def_span: self.def_span.encode(buf),
    def_ident_span: self.def_ident_span.encode(buf),
    lookup_stability: self.lookup_stability.encode(buf),
    lookup_const_stability: self.lookup_const_stability.encode(buf),
    lookup_default_body_stability: self.lookup_default_body_stability.encode(buf),
    lookup_deprecation_entry: self.lookup_deprecation_entry.encode(buf),
    explicit_clauses_of: self.explicit_clauses_of.encode(buf),
    generics_of: self.generics_of.encode(buf),
    type_of: self.type_of.encode(buf),
    variances_of: self.variances_of.encode(buf),
    fn_sig: self.fn_sig.encode(buf),
    codegen_fn_attrs: self.codegen_fn_attrs.encode(buf),
    impl_trait_header: self.impl_trait_header.encode(buf),
    const_param_default: self.const_param_default.encode(buf),
    object_lifetime_default: self.object_lifetime_default.encode(buf),
    optimized_mir: self.optimized_mir.encode(buf),
    mir_for_ctfe: self.mir_for_ctfe.encode(buf),
    trivial_const: self.trivial_const.encode(buf),
    closure_saved_names_of_captured_variables: self.closure_saved_names_of_captured_variables.encode(buf),
    mir_coroutine_witnesses: self.mir_coroutine_witnesses.encode(buf),
    promoted_mir: self.promoted_mir.encode(buf),
    thir_abstract_const: self.thir_abstract_const.encode(buf),
    impl_parent: self.impl_parent.encode(buf),
    const_conditions: self.const_conditions.encode(buf),
    coerce_unsized_info: self.coerce_unsized_info.encode(buf),
    mir_const_qualif: self.mir_const_qualif.encode(buf),
    rendered_const: self.rendered_const.encode(buf),
    rendered_precise_capturing_args: self.rendered_precise_capturing_args.encode(buf),
    fn_arg_idents: self.fn_arg_idents.encode(buf),
    coroutine_kind: self.coroutine_kind.encode(buf),
    coroutine_for_closure: self.coroutine_for_closure.encode(buf),
    adt_destructor: self.adt_destructor.encode(buf),
    adt_async_destructor: self.adt_async_destructor.encode(buf),
    coroutine_by_move_body_def_id: self.coroutine_by_move_body_def_id.encode(buf),
    eval_static_initializer: self.eval_static_initializer.encode(buf),
    trait_def: self.trait_def.encode(buf),
    expn_that_defined: self.expn_that_defined.encode(buf),
    default_fields: self.default_fields.encode(buf),
    params_in_repr: self.params_in_repr.encode(buf),
    repr_options: self.repr_options.encode(buf),
    def_keys: self.def_keys.encode(buf),
    variant_data: self.variant_data.encode(buf),
    assoc_container: self.assoc_container.encode(buf),
    macro_definition: self.macro_definition.encode(buf),
    deduced_param_attrs: self.deduced_param_attrs.encode(buf),
    collect_return_position_impl_trait_in_trait_tys: self.collect_return_position_impl_trait_in_trait_tys.encode(buf),
    doc_link_resolutions: self.doc_link_resolutions.encode(buf),
    doc_link_traits_in_scope: self.doc_link_traits_in_scope.encode(buf),
    assumed_wf_types_for_rpitit: self.assumed_wf_types_for_rpitit.encode(buf),
    opaque_ty_origin: self.opaque_ty_origin.encode(buf),
    anon_const_kind: self.anon_const_kind.encode(buf),
    const_of_item: self.const_of_item.encode(buf),
    associated_types_for_impl_traits_in_trait_or_impl: self.associated_types_for_impl_traits_in_trait_or_impl.encode(buf),
    live_args_for_alias_from_outlives_bounds: self.live_args_for_alias_from_outlives_bounds.encode(buf),
    args_known_to_outlive_alias_params: self.args_known_to_outlive_alias_params.encode(buf),
    mut_restriction: self.mut_restriction.encode(buf),
  };
}

// #[derive(TyEncodable, TyDecodable)]
export interface VariantData {
  idx: VariantIdx;
  discr: VariantDiscr;
  /// If this is unit or tuple-variant/struct, then this is the index of the ctor id.
  ctor: [CtorKind, LocalDefId] | undefined;
  is_non_exhaustive: boolean;
}

// bitflags::bitflags! { #[derive(Default)] pub struct AttrFlags: u8 { const IS_DOC_HIDDEN = 1 << 0; } }
export type AttrFlags = number & { readonly __brand: "AttrFlags" };
export const AttrFlags = flags_companion<AttrFlags, { IS_DOC_HIDDEN: AttrFlags }>(8, { IS_DOC_HIDDEN: 0x1 as AttrFlags }, [["IS_DOC_HIDDEN", 0x1 as AttrFlags]]);
/** `#[derive(Default)]`: no flags. */
export function default_AttrFlags(): AttrFlags {
  return AttrFlags.empty();
}

/// A span tag byte encodes a bunch of data, so that we can cut out a few extra bytes from span
/// encodings (which are very common, for example, libcore has ~650,000 unique spans and over 1.1
/// million references to prior-written spans).
///
/// The byte format is split into several parts:
///
/// [ a a a a a c d d ]
///
/// `a` bits represent the span length. We have 5 bits, so we can store lengths up to 30 inline, with
/// an all-1s pattern representing that the length is stored separately.
///
/// `c` represents whether the span context is zero (and then it is not stored as a separate varint)
/// for direct span encodings, and whether the offset is absolute or relative otherwise (zero for
/// absolute).
///
/// d bits represent the kind of span we are storing (local, foreign, partial, indirect).
// #[derive(Encodable, Decodable, Copy, Clone)]
export class SpanTag {
  constructor(public _0: number) {}

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:572 new
  static new(kind: SpanKind, context: SyntaxContext, length: number): SpanTag {
    let data = 0;
    data |= SpanKind_discriminant[kind];
    if (SyntaxContext.is_root(context)) {
      data |= 0b100;
    }
    const all_1s_len = ((0xff << 3) & 0xff) >> 3;
    // strictly less than - all 1s pattern is a sentinel for storage being out of band.
    if (length < all_1s_len) {
      data |= (length << 3) & 0xff;
    } else {
      data |= (all_1s_len << 3) & 0xff;
    }

    return new SpanTag(data);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:589 indirect
  static indirect(relative: boolean, length_bytes: number): SpanTag {
    const tag = new SpanTag(SpanKind_discriminant.Indirect);
    if (relative) {
      tag._0 |= 0b100;
    }
    assert(length_bytes <= 8, "assertion failed: length_bytes <= 8");
    tag._0 |= (length_bytes << 3) & 0xff;
    return tag;
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:599 kind
  kind(): SpanKind {
    const masked = this._0 & 0b11;
    switch (masked) {
      case 0b00:
        return "Local";
      case 0b01:
        return "Foreign";
      case 0b10:
        return "Partial";
      case 0b11:
        return "Indirect";
      default:
        return unreachable();
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:610 is_relative_offset
  is_relative_offset(): boolean {
    // debug_assert_eq!(self.kind(), SpanKind::Indirect);
    return (this._0 & 0b100) !== 0;
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:615 context
  context(): SyntaxContext | undefined {
    if ((this._0 & 0b100) !== 0) {
      return SyntaxContext.root();
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/mod.rs:619 length
  length(): BytePos | undefined {
    const all_1s_len = ((0xff << 3) & 0xff) >> 3;
    const len = this._0 >> 3;
    if (len !== all_1s_len) {
      return BytePos(len);
    } else {
      return undefined;
    }
  }
}

// #[derive(Debug, Copy, Clone, PartialEq, Eq)]
export type SpanKind =
  | "Local"
  | "Foreign"
  | "Partial"
  // Indicates the actual span contents are elsewhere.
  // If this is the kind, then the span context bit represents whether it is a relative or
  // absolute offset.
  | "Indirect";
export const SpanKind = { Local: "Local", Foreign: "Foreign", Partial: "Partial", Indirect: "Indirect" } as const;
/** `SpanKind as u8` (explicit discriminants). */
export const SpanKind_discriminant: Record<SpanKind, number> = { Local: 0b00, Foreign: 0b01, Partial: 0b10, Indirect: 0b11 };
/** `#[derive(Debug)]` */
export const debug_SpanKind: Debug<SpanKind> = (v) => v;

// Tags for encoding Symbol's
export const SYMBOL_STR = 0;
export const SYMBOL_OFFSET = 1;
export const SYMBOL_PREDEFINED = 2;

// rustc: compiler/rustc_metadata/src/rmeta/mod.rs:631 provide
export function provide(_providers: Providers): void {
  // encoder::provide(&mut providers.queries);
  unported("rustc_metadata::rmeta::encoder::provide (metadata encoding, M5)");
  // decoder::provide(providers);
  // PORT: not reached (above); `decoder::provide` is `cstore_impl::provide` (../lib.ts exports it directly).
}

// ---- impl Decodable for LazyValue / LazyArray / LazyTable (decoder.rs) ---------------------------------------
// PORT: placed here (see the header): the generated decoders import them from the types' module.

/**
 * PORT: the `Decodable` fns tools/codegen passes for the phantom type parameters of `LazyValue` / `LazyArray` /
 * `LazyTable` (never called: the lazy types decode positions only). `any`: they are built for whatever decoder the
 * element type needs (BlobDecoder, SpanDecoder, a specific context).
 */
// biome-ignore lint/suspicious/noExplicitAny: phantom decode fns, see above
export type PhantomDecodable = (d: any) => unknown;

// impl<D: LazyDecoder, T> Decodable<D> for LazyValue<T>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:676 decode
export function decode_LazyValue<T>(decoder: LazyDecoder, _decode_T?: PhantomDecodable): LazyValue<T> {
  return decoder.read_lazy<T>();
}

// impl<D: LazyDecoder, T> Decodable<D> for LazyArray<T>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:683 decode
export function decode_LazyArray<T>(decoder: LazyDecoder, _decode_T?: PhantomDecodable): LazyArray<T> {
  const len = decoder.read_usize();
  if (len === 0) {
    return LazyArray.default<T>();
  } else {
    return decoder.read_lazy_array<T>(len);
  }
}

// impl<Ie: Idx, Id: Idx, D: LazyDecoder, T> Decodable<D> for LazyTable<Ie, Id, T>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:690 decode
export function decode_LazyTable<Ie, Id, T>(decoder: LazyDecoder, _decode_Ie?: PhantomDecodable, _decode_Id?: PhantomDecodable, _decode_T?: PhantomDecodable): LazyTable<Ie, Id, T> {
  const width = decoder.read_usize();
  const len = decoder.read_usize();
  return decoder.read_lazy_table<Ie, Id, T>(width, len);
}

// ---- impl Encodable<EncodeContext> for LazyValue / LazyArray / LazyTable (encoder.rs) ------------------------------
// PORT (lane encode-contract): placed here like their `Decodable` impls (see the header): the generated encoders import
// them from the types' module. `EncodeContext` is a type-only import (encoder.ts imports this module).

/** PORT: the `Encodable` fns tools/codegen passes for the phantom type parameters (never called), as `PhantomDecodable`. */
// biome-ignore lint/suspicious/noExplicitAny: phantom encode fns, see above
export type PhantomEncodable = (v: any, e: any) => void;

// impl<'a, 'tcx, T> Encodable<EncodeContext<'a, 'tcx>> for LazyValue<T>
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:122 encode
export function encode_LazyValue<T>(self: LazyValue<T>, e: EncodeContext, _encode_T?: PhantomEncodable): void {
  e.emit_lazy_distance(self.position);
}

// impl<'a, 'tcx, T> Encodable<EncodeContext<'a, 'tcx>> for LazyArray<T>
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:128 encode
export function encode_LazyArray<T>(self: LazyArray<T>, e: EncodeContext, _encode_T?: PhantomEncodable): void {
  e.emit_usize(self.num_elems);
  if (self.num_elems > 0) {
    e.emit_lazy_distance(self.position);
  }
}

// impl<'a, 'tcx, Ie, Id, T> Encodable<EncodeContext<'a, 'tcx>> for LazyTable<Ie, Id, T>
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:137 encode
export function encode_LazyTable<Ie, Id, T>(self: LazyTable<Ie, Id, T>, e: EncodeContext, _encode_Ie?: PhantomEncodable, _encode_Id?: PhantomEncodable, _encode_T?: PhantomEncodable): void {
  e.emit_usize(self.width);
  e.emit_usize(self.len);
  e.emit_lazy_distance(self.position);
}

// Element types re-exported for the decoder lanes (the tables' `T`s that have a TS type).
export type { AmbigModChild, Attribute, ConstStability, DefaultBodyStability, DefKey, DefKind, DelimArgs, Deprecation, DocLinkResMap, ExpnId, Ident, ModChild, Safety, Span, Stability, Visibility };
export type { Asyncness, Constness, CoroutineKind, Defaultness };
