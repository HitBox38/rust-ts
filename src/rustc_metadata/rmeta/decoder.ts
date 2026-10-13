// Port of compiler/rustc_metadata/src/rmeta/decoder.rs.
// Decoding metadata from a single crate's metadata
//
// Contract-first (lane rmeta-contract, docs/handoff/rmeta-contract.md "How to fill a stub"). The file is split
// between two lanes at decoder.rs:1343 (`CrateMetadata::get_mod_child`):
// - rmeta-decoder-a: decoder.rs:1..1342 (the `MetadataDecodeContext` span / hygiene / ty decoding, `SpanData`,
//   `impl CrateMetadata` up to `get_fake_doc_items`);
// - rmeta-decoder-b: decoder.rs:1343..end (module children .. `get_doc_link_traits_in_scope`, `CrateMetadata::new`).
// Every method is declared below (the `interface` blocks: final signatures, do not change them without root) and
// installed as an `unported(..)` placeholder by the region's `unported_methods(..)` call; free fns have their final
// signature and an `unported` body, without a marker. A lane replaces each stub in place, in upstream order, with
// its `// rustc:` marker, and deletes the name from its region's list.
//
// Ported here already (markers): the blob header path (`MetadataBlob::{new, bytes, deref, check_compatibility,
// root_pos, unhashed_pos, get_header, get_root, get_root_unhashed, get_dep_extra_filenames, get_crate_hash,
// list_crate_metadata, get_proc_macro_info}`), `impl CrateRoot`, the lazy decoding machinery (`LazyDecoder`,
// `MetaBlob` / `MetaDecoder` for `&MetadataBlob`, `LazyValue::decode`, `LazyArray::decode`, `DecodeIterator`),
// `BlobDecodeContext` (symbols, `DefIndex`, `LocalDefId`), the trivial forwarding parts of
// `MetadataDecodeContext`, and the accessors of the second `impl CrateMetadata` block.
//
// PORT:
// - `MetadataBlob(OwnedSlice)` keeps the `Uint8Array` view as `_0`; `Deref<Target = [u8]>` is `deref()`.
// - Fields that clash with a method get `_`: `CrateMetadata.{blob_, source_, dep_kind_, used_}`,
//   `BlobDecodeContext.blob_`.
// - `trait MetaBlob` (`blob()`) is an interface (MetadataBlob, CrateMetadata and BlobDecodeContext have
//   `blob()`). `trait MetaDecoder` is the union `MetadataBlob | [CrateMetadata, TyCtxt]`; `MetaDecoder_decoder`
//   dispatches to `MetadataBlob.decoder` (decoder.rs:272) / `CrateMetadata_tcx_decoder` (decoder.rs:297).
// - `LazyValue::decode` / `LazyArray::decode` take the element's `Decodable` fn (`T::Value::decode`); the
//   `T: ParameterizedOverTcx` value type is `T` (parameterized.ts).
// - `DecodeIterator`'s `Iterator::next` is the JS iterator protocol `next` (the `IteratorResult` is the
//   `Option`), so it is `Iterable`. `CrateRoot::decode_*` collect it into arrays (creader's call sites index them).
// - `forward_all_decoder_methods_to!` (rustc_middle ty/codec.rs:318) is expanded by hand in the two `Decoder` impls.
// - `rustc_span::{BlobDecoder, SpanDecoder}` (lib.rs:1501 / 1528) belong to lane span-decode: declared here
//   structurally (no markers) so the contract type-checks; replace them with rustc_span's when it lands.
// - `Svh` (rustc_data_structures svh.rs, not ported) stays the creader stand-in: the hash's `Display` text.
import type { MacroDef } from "../../rustc_ast/lib.ts";
import type { Attribute } from "../../rustc_attr_ir/attr.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { CrateDepKind, CrateSource, ExternCrate, ForeignModule, LinkagePreference, NativeLib } from "../../rustc_crate_store/lib.ts";
import { debug_CrateDepKind, debug_LinkagePreference, decode_LinkagePreference as decode_LinkagePreference_ } from "../../rustc_crate_store/lib.ts";
import { debug_Fingerprint, decode_Fingerprint, Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import type { OwnedSlice } from "../../rustc_data_structures/owned_slice.ts";
import type { SyntaxExtension } from "../../rustc_expand/base.ts";
import type { CtorKind, DefKind, Safety } from "../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathHash } from "../../rustc_hir_id/definitions.ts";
import type { AmbigModChild, DocLinkResMap, ModChild } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Visibility } from "../../rustc_middle/ty/mod.ts";
import { MemDecoder } from "../../rustc_serialize/opaque.ts";
import { type Decodable, type Decoder, Decoder_provided, decode_Option as decode_Option_, decode_String, decode_tuple as decode_tuple_ } from "../../rustc_serialize/serialize.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import { CrateNum, DefId, DefIndex, LOCAL_CRATE, LocalDefId, type ModId, type StableCrateId, debug_StableCrateId } from "../../rustc_span/def_id.ts";
import { display_Edition } from "../../rustc_span/edition.ts";
import { type ExpnHash, type ExpnId, ExpnIndex, type SyntaxContext } from "../../rustc_span/hygiene.ts";
import type { AttrId, Span } from "../../rustc_span/lib.ts";
import { ByteSymbol, type Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { PanicStrategy } from "../../rustc_target/spec/mod.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { debug_bool, debug_option, PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { bug } from "../../rustc_span/macros.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import { decode_CrateDep, decode_CrateHeader, decode_CrateRoot, decode_CrateRootUnhashed, decode_ProcMacroKind } from "../decodable.gen.ts";
import type { DefPathHashMapRef } from "./def_path_hash_map.ts";
import {
  type AttrFlags,
  CRATE_HASH_LEN,
  CRATE_HASH_OFFSET,
  type CrateDep,
  type CrateHeader,
  CrateRoot,
  type CrateRootUnhashed,
  LazyArray,
  LazyState,
  LazyTable,
  LazyValue,
  METADATA_HEADER,
  type ProcMacroKind,
  RawDefId,
  ROOT_POS_OFFSET,
  rustc_version,
  SYMBOL_OFFSET,
  SYMBOL_PREDEFINED,
  SYMBOL_STR,
  UNHASHED_POS_OFFSET,
  VERSION_OFFSET,
} from "./mod.ts";

// pub(super) use cstore_impl::provide;  (../lib.ts exports it; mod cstore_impl; is loaded by ../lib.ts)

// ---- stand-ins ------------------------------------------------------------------------------------------------

/**
 * PORT: stand-in for `rustc_data_structures::svh::Svh` (svh.rs is not ported): the hash as its `Display` text
 * (`Svh::to_hex`, `format!("{:032x}", self.hash.as_u128())`), so it can key a `Map` (`hash_to_cnum`).
 */
export type Svh = string & { readonly __brand: "Svh" };
/** `Svh::new(hash)` of the stand-in. */
export function Svh_new(hash: Fingerprint): Svh {
  // `Fingerprint::as_u128`: `u128::from(self.1) << 64 | u128::from(self.0)`
  const [a, b] = Fingerprint.split(hash);
  const as_u128 = (BigInt(b) << 64n) | BigInt(a);
  return as_u128.toString(16).padStart(32, "0") as Svh;
}
/** `Svh::as_fingerprint` of the stand-in. */
export function Svh_as_fingerprint(self: Svh): Fingerprint {
  const v = BigInt(`0x${self}`);
  return Fingerprint.new(v & 0xffff_ffff_ffff_ffffn, v >> 64n);
}
/** `#[derive(Decodable_NoContext)]` of `Svh { hash: Fingerprint }` (svh.rs:15). */
export function decode_Svh(d: Decoder): Svh {
  return Svh_new(decode_Fingerprint(d));
}
/** `#[derive(Debug)]` of `Svh { hash: Fingerprint }`. */
export function debug_Svh(v: Svh, f = PLAIN): string {
  return `Svh { hash: ${debug_Fingerprint(Svh_as_fingerprint(v), f)} }`;
}

/** PORT: `rustc_span::BlobDecoder` (lib.rs:1501), pending lane span-decode (see the header). */
export interface BlobDecoder extends Decoder {
  decode_symbol(): Symbol;
  decode_byte_symbol(): ByteSymbol;
  decode_def_index(): DefIndex;
  // This function is placed here (not in a `SpanDecoder`),
  // as during metadata decoding `LocalDefId` is just a wrapper
  // around `DefIndex`, so it can be decoded without extra knowledge
  // like crate remapping.
  decode_local_def_id(): LocalDefId;
}
/** PORT: `rustc_span::SpanDecoder` (lib.rs:1528), pending lane span-decode (see the header). */
export interface SpanDecoder extends BlobDecoder {
  decode_span(): Span;
  decode_expn_id(): ExpnId;
  decode_syntax_context(): SyntaxContext;
  decode_crate_num(): CrateNum;
  decode_def_id(): DefId;
  decode_attr_id(): AttrId;
}

/** Types without a TS port yet (M3 / M6), named for the declarations below. */
export type ProcMacroClient = unknown; // rustc_proc_macro::bridge::client::Client (M6)
export type AllocDecodingState = unknown; // rustc_middle::mir::interpret (M3)
export type AllocDecodingSession = unknown; // rustc_middle::mir::interpret (M3)
export type HygieneDecodeContext = unknown; // rustc_span::hygiene (lane hygiene-decode)
export type SimplifiedType = unknown; // rustc_middle::ty::fast_reject (M3)
export type SourceFile = unknown; // rustc_span::SourceFile (`Arc<SourceFile>`)
export type SpanData = unknown; // rustc_span::SpanData

// ---- MetadataBlob ------------------------------------------------------------------------------------------------

/// A reference to the raw binary version of crate metadata.
/// This struct applies [`MemDecoder`]'s validation when constructed
/// so that later constructions are guaranteed to succeed.
export class MetadataBlob {
  constructor(readonly _0: OwnedSlice) {}

  // impl std::ops::Deref for MetadataBlob
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:58 deref
  deref(): Uint8Array {
    return this._0;
  }

  /// Runs the [`MemDecoder`] validation and if it passes, constructs a new [`MetadataBlob`].
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:65 new
  static new(slice: OwnedSlice): Result<MetadataBlob, null> {
    if (MemDecoder.new(slice, 0).$ === "Ok") {
      return Ok(new MetadataBlob(slice));
    } else {
      return Err(null);
    }
  }

  /// Since this has passed the validation of [`MetadataBlob::new`], this returns bytes which are
  /// known to pass the [`MemDecoder`] validation.
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:71 bytes
  bytes(): OwnedSlice {
    return this._0;
  }
}
// The rest of `MetadataBlob`'s methods, in upstream order below.
export interface MetadataBlob {
  // impl<'a> MetaBlob<'a> for &'a MetadataBlob (decoder.rs:263)
  blob(): MetadataBlob;
  // impl<'a> MetaDecoder for &'a MetadataBlob (decoder.rs:269)
  decoder(pos: number): BlobDecodeContext;
  // impl MetadataBlob (decoder.rs:705)
  check_compatibility(cfg_version: string): Result<void, string | undefined>;
  root_pos(): number;
  unhashed_pos(): number;
  get_header(): CrateHeader;
  get_root(): CrateRoot;
  get_root_unhashed(): CrateRootUnhashed;
  get_dep_extra_filenames(): string[];
  get_crate_hash(): Svh;
  list_crate_metadata(out: Write, ls_kinds: readonly string[]): IoResult<void>;
  get_proc_macro_info(): ProcMacroKind[];
}

/// A map from external crate numbers (as decoded from some crate file) to
/// local crate numbers (as generated during this session). Each external
/// crate may refer to types in other external crates, and each has their
/// own crate numbers.
export type CrateNumMap = CrateNum[];

/// Target modifiers - abi or exploit mitigations options that may cause unsoundness when mixed or
/// partially enabled.
export type TargetModifiers = TargetModifier[];

/// The set of mitigations that cannot be partially enabled (see
/// [RFC 3855](https://github.com/rust-lang/rfcs/pull/3855)), but are currently enabled for this
/// crate.
export type DeniedPartialMitigations = DeniedPartialMitigation[];

// ---- CrateMetadata ---------------------------------------------------------------------------------------------

export class CrateMetadata {
  constructor(
    /// The primary crate data - binary metadata blob.
    public blob_: MetadataBlob,

    // --- Some data pre-decoded from the metadata blob, usually for performance ---
    /// Data about the top-level items in a crate, as well as various crate-level metadata.
    public root: CrateRoot,
    /// Crate-level metadata that is not in the SVH.
    public unhashed: CrateRootUnhashed,
    /// Trait impl data.
    /// FIXME: Used only from queries and can use query cache,
    /// so pre-decoding can probably be avoided.
    /// FIXME: make type of the value `LazyArray<(DefIndex, Option<SimplifiedType>)>`
    /// through transmuting or somehow else, as `LocalDefId` here should be `DefIndex`,
    /// as it is from external crate.
    /// PORT: a `KeyedMap` (src/rust_ts/keyed.ts) keyed by `RawDefId_key` (mod.ts).
    public trait_impls: Map<RawDefId, LazyArray<[LocalDefId, SimplifiedType | undefined]>>,
    /// Inherent impls which do not follow the normal coherence rules.
    ///
    /// These can be introduced using either `#![rustc_coherence_is_core]`
    /// or `#[rustc_allow_incoherent_impl]`.
    /// FIXME: make type of the value `LazyArray<DefIndex>`
    /// through transmuting or somehow else, as `LocalDefId` here should be `DefIndex`,
    /// as it is from external crate.
    public incoherent_impls: Map<SimplifiedType, LazyArray<LocalDefId>>,
    /// Proc macro function pointers for this crate, if it's a proc macro crate.
    public raw_proc_macros: readonly ProcMacroClient[] | undefined,
    /// Source maps for code from the crate.
    public source_map_import_info: (ImportedSourceFile | undefined)[],
    /// For every definition in this crate, maps its `DefPathHash` to its `DefIndex`.
    public def_path_hash_map: DefPathHashMapRef,
    /// Likewise for ExpnHash.
    public expn_hash_map: Map<ExpnHash, ExpnIndex> | undefined,
    /// Used for decoding interpret::AllocIds in a cached & thread-safe manner.
    public alloc_decoding_state: AllocDecodingState,
    /// Caches decoded `DefKey`s.
    public def_key_cache: Map<DefIndex, DefKey>,

    // --- Other significant crate properties ---
    /// ID of this crate, from the current compilation session's point of view.
    public cnum: CrateNum,
    /// Maps crate IDs as they are were seen from this crate's compilation sessions into
    /// IDs as they are seen from the current compilation session.
    public cnum_map: CrateNumMap,
    /// How to link (or not link) this crate to the currently compiled crate.
    public dep_kind_: CrateDepKind,
    /// Filesystem location of this crate.
    public source_: CrateSource,
    /// Whether or not this crate should be consider a private dependency.
    /// Used by the 'exported_private_dependencies' lint, and for determining
    /// whether to emit suggestions that reference this crate.
    public private_dep: boolean,
    /// The hash for the host proc macro. Used to support `-Z dual-proc-macro`.
    public host_hash: Svh | undefined,
    /// The crate was used non-speculatively.
    public used_: boolean,

    /// Additional data used for decoding `HygieneData` (e.g. `SyntaxContext`
    /// and `ExpnId`).
    /// Note that we store a `HygieneDecodeContext` for each `CrateMetadata`. This is
    /// because `SyntaxContext` ids are not globally unique, so we need
    /// to track which ids we've decoded on a per-crate basis.
    public hygiene_context: HygieneDecodeContext,

    // --- Data used only for improving diagnostics ---
    /// Information about the `extern crate` item or path that caused this crate to be loaded.
    /// If this is `None`, then the crate was injected (e.g., by the allocator).
    public extern_crate: ExternCrate | undefined,
  ) {}

  // ---- impl CrateMetadata (decoder.rs:1976) ----

  // rustc-decl: compiler/rustc_metadata/src/rmeta/decoder.rs:1977 new  (lane rmeta-decoder-b)
  static new(
    _tcx: TyCtxt,
    _blob: MetadataBlob,
    _root: CrateRoot,
    _unhashed: CrateRootUnhashed,
    _raw_proc_macros: readonly ProcMacroClient[] | undefined,
    _cnum: CrateNum,
    _cnum_map: CrateNumMap,
    _dep_kind: CrateDepKind,
    _source: CrateSource,
    _private_dep: boolean,
    _host_hash: Svh | undefined,
  ): CrateMetadata {
    return unported("rustc_metadata::rmeta::decoder::CrateMetadata::new");
  }
}
export interface CrateMetadata {
  // impl<'a> MetaBlob<'a> for &'a CrateMetadata (decoder.rs:288)
  blob(): MetadataBlob;

  // ---- impl CrateMetadata (decoder.rs:1027); rmeta-decoder-a: 1028..1342 ----
  missing(descr: string, id: DefIndex): never;
  raw_proc_macro(tcx: TyCtxt, id: DefIndex): [ProcMacroClient, ProcMacroKind];
  opt_item_name(item_index: DefIndex): Symbol | undefined;
  item_name(item_index: DefIndex): Symbol;
  opt_item_ident(tcx: TyCtxt, item_index: DefIndex): Ident | undefined;
  item_ident(tcx: TyCtxt, item_index: DefIndex): Ident;
  map_encoded_cnum_to_current(cnum: CrateNum): CrateNum;
  def_kind(item_id: DefIndex): DefKind;
  get_span(tcx: TyCtxt, index: DefIndex): Span;
  load_proc_macro(tcx: TyCtxt, id: DefIndex): SyntaxExtension;
  /** `-> (VariantIdx, ty::VariantDef)` */
  get_variant(tcx: TyCtxt, kind: DefKind, index: DefIndex, parent_did: DefId): [number, unknown];
  /** `-> ty::AdtDef<'tcx>` (M3) */
  get_adt_def(tcx: TyCtxt, item_id: DefIndex): unknown;
  get_visibility(tcx: TyCtxt, id: DefIndex): Visibility<ModId>;
  /** `-> RestrictionKind` (rustc_middle ty, M3) */
  get_mut_restriction(tcx: TyCtxt, id: DefIndex): unknown;
  get_safety(id: DefIndex): Safety;
  get_default_field(tcx: TyCtxt, id: DefIndex): DefId | undefined;
  get_expn_that_defined(tcx: TyCtxt, id: DefIndex): ExpnId;
  /** `-> Vec<DebuggerVisualizerFile>` */
  get_debugger_visualizers(tcx: TyCtxt): unknown[];
  /** `-> LibFeatures` */
  get_lib_features(tcx: TyCtxt): unknown;
  get_stability_implications(tcx: TyCtxt): [Symbol, Symbol][];
  get_lang_items(tcx: TyCtxt): [DefId, LangItem][];
  /** `-> &[StrippedCfgItem]` */
  get_stripped_cfg_items(tcx: TyCtxt, cnum: CrateNum): unknown[];
  /** `-> DiagnosticItems` */
  get_diagnostic_items(tcx: TyCtxt): unknown;
  /** `-> CanonicalSymbols` */
  get_canonical_symbols(tcx: TyCtxt): unknown;
  get_fake_doc_items(tcx: TyCtxt): DefId[];

  // ---- rmeta-decoder-b: 1343..1974 ----
  get_mod_child(tcx: TyCtxt, id: DefIndex): ModChild;
  get_module_children(tcx: TyCtxt, id: DefIndex): Iterable<ModChild>;
  get_ambig_module_children(tcx: TyCtxt, id: DefIndex): Iterable<AmbigModChild>;
  is_item_mir_available(id: DefIndex): boolean;
  get_fn_has_self_parameter(tcx: TyCtxt, id: DefIndex): boolean;
  get_associated_item_or_field_def_ids(tcx: TyCtxt, id: DefIndex): Iterable<DefId>;
  /** `-> ty::AssocItem` (M3) */
  get_associated_item(tcx: TyCtxt, id: DefIndex): unknown;
  get_ctor(tcx: TyCtxt, node_id: DefIndex): [CtorKind, DefId] | undefined;
  get_item_attrs(tcx: TyCtxt, id: DefIndex): Iterable<Attribute>;
  get_inherent_implementations_for_type(tcx: TyCtxt, id: DefIndex): DefId[];
  get_traits(tcx: TyCtxt): Iterable<DefId>;
  get_trait_impls(tcx: TyCtxt): Iterable<DefId>;
  get_incoherent_impls(tcx: TyCtxt, simp: SimplifiedType): DefId[];
  get_implementations_of_trait(tcx: TyCtxt, trait_def_id: DefId): [DefId, SimplifiedType | undefined][];
  get_native_libraries(tcx: TyCtxt): Iterable<NativeLib>;
  get_proc_macro_quoted_span(tcx: TyCtxt, index: number): Span;
  get_foreign_modules(tcx: TyCtxt): Iterable<ForeignModule>;
  get_dylib_dependency_formats(tcx: TyCtxt): [CrateNum, LinkagePreference][];
  /** `-> impl Iterator<Item = EiiMapEncodedKeyValue>` */
  get_externally_implementable_items(tcx: TyCtxt): Iterable<unknown>;
  get_missing_lang_items(tcx: TyCtxt): LangItem[];
  get_exportable_items(tcx: TyCtxt): Iterable<DefId>;
  get_stable_order_of_exportable_impls(tcx: TyCtxt): Iterable<[DefId, number]>;
  /** `-> &[(ExportedSymbol<'tcx>, SymbolExportInfo)]` (M3) */
  exported_non_generic_symbols(tcx: TyCtxt): unknown[];
  /** `-> &[(ExportedSymbol<'tcx>, SymbolExportInfo)]` (M3) */
  exported_generic_symbols(tcx: TyCtxt): unknown[];
  get_macro(tcx: TyCtxt, id: DefIndex): MacroDef;
  def_key(index: DefIndex): DefKey;
  def_path(id: DefIndex): DefPath;
  def_path_hash(index: DefIndex): DefPathHash;
  def_path_hash_to_def_index(hash: DefPathHash): DefIndex | undefined;
  expn_hash_to_expn_id(tcx: TyCtxt, index_guess: number, hash: ExpnHash): ExpnId;
  imported_source_file(tcx: TyCtxt, source_file_index: number): ImportedSourceFile;
  get_attr_flags(index: DefIndex): AttrFlags;
  /** `-> Option<ty::IntrinsicDef>` (M3) */
  get_intrinsic(tcx: TyCtxt, index: DefIndex): unknown | undefined;
  get_doc_link_resolutions(tcx: TyCtxt, index: DefIndex): DocLinkResMap;
  get_doc_link_traits_in_scope(tcx: TyCtxt, index: DefIndex): Iterable<DefId>;

  // ---- impl CrateMetadata (decoder.rs:1976), ported (lane rmeta-contract) ----
  dependencies(): Iterable<CrateNum>;
  target_modifiers(): TargetModifiers;
  enabled_denied_partial_mitigations(): DeniedPartialMitigations;
  update_extern_crate_diagnostics(new_extern_crate: ExternCrate): boolean;
  source(): CrateSource;
  dep_kind(): CrateDepKind;
  set_dep_kind(dep_kind: CrateDepKind): void;
  update_and_private_dep(private_dep: boolean): void;
  used(): boolean;
  required_panic_strategy(): PanicStrategy | undefined;
  needs_panic_runtime(): boolean;
  is_private_dep(): boolean;
  is_panic_runtime(): boolean;
  is_profiler_runtime(): boolean;
  is_compiler_builtins(): boolean;
  needs_allocator(): boolean;
  has_global_allocator(): boolean;
  has_alloc_error_handler(): boolean;
  has_default_lib_allocator(): boolean;
  is_proc_macro_crate(): boolean;
  proc_macros_for_crate(tcx: TyCtxt, krate: CrateNum): Iterable<DefId>;
  name(): Symbol;
  hash(): Svh;
  has_async_drops(): boolean;
  num_def_ids(): number;
  local_def_id(index: DefIndex): DefId;
  reverse_translate_def_id(did: DefId): RawDefId | undefined;
}

/// Holds information about a rustc_span::SourceFile imported from another crate.
/// See `imported_source_file()` for more information.
// #[derive(Clone)]
export interface ImportedSourceFile {
  /// This SourceFile's byte-offset within the source_map of its original crate
  original_start_pos: number /* BytePos */;
  /// The end of this SourceFile within the source_map of its original crate
  original_end_pos: number /* BytePos */;
  /// The imported SourceFile's representation within the local source_map
  translated_source_file: SourceFile;
}

// ---- decode contexts ---------------------------------------------------------------------------------------------

/// Decode context used when we just have a blob of metadata from which we have to decode a header
/// and [`CrateRoot`]. After that, [`MetadataDecodeContext`] can be used.
/// Most notably, [`BlobDecodeContext]` doesn't implement [`SpanDecoder`]
export class BlobDecodeContext {
  constructor(
    public opaque: MemDecoder,
    readonly blob_: MetadataBlob,
    public lazy_state: LazyState,
  ) {}
}
export interface BlobDecodeContext extends LazyDecoder {
  // impl LazyDecoder for BlobDecodeContext (decoder.rs:220) + its provided methods
  read_lazy<T>(): LazyValue<T>;
  read_lazy_array<T>(len: number): LazyArray<T>;
  read_lazy_table<Ie, Id, T>(width: number, len: number): LazyTable<Ie, Id, T>;
  read_lazy_offset_then<T>(f: (pos: number) => T): T;
  // impl BlobDecodeContext (decoder.rs:366)
  blob(): MetadataBlob;
  decode_symbol_or_byte_symbol<S>(new_from_index: (i: number) => S, read_and_intern_str_or_byte_str_this: (this_: BlobDecodeContext) => S, read_and_intern_str_or_byte_str_opaque: (opaque: MemDecoder) => S): S;
}

/// This trait abstracts over decoders that can decode lazy values using [`LazyState`]:
///
/// - [`LazyValue`]
/// - [`LazyArray`]
/// - [`LazyTable`]
export interface LazyDecoder extends BlobDecoder {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:187 set_lazy_state
  set_lazy_state(state: LazyState): void;
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:188 get_lazy_state
  get_lazy_state(): LazyState;

  read_lazy<T>(): LazyValue<T>; // (provided)
  read_lazy_array<T>(len: number): LazyArray<T>; // (provided)
  read_lazy_table<Ie, Id, T>(width: number, len: number): LazyTable<Ie, Id, T>; // (provided)
  read_lazy_offset_then<T>(f: (pos: number) => T): T; // (provided)
}
/** The provided methods of `LazyDecoder` (PORTING section 8); implementors forward to them. */
export const LazyDecoder_provided = {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:190 read_lazy
  read_lazy<T>(self: LazyDecoder): LazyValue<T> {
    return self.read_lazy_offset_then((pos) => LazyValue.from_position<T>(pos));
  },

  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:194 read_lazy_array
  read_lazy_array<T>(self: LazyDecoder, len: number): LazyArray<T> {
    return self.read_lazy_offset_then((pos) => LazyArray.from_position_and_num_elems<T>(pos, len));
  },

  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:198 read_lazy_table
  read_lazy_table<Ie, Id, T>(self: LazyDecoder, width: number, len: number): LazyTable<Ie, Id, T> {
    return self.read_lazy_offset_then((pos) => LazyTable.from_position_and_encoded_size<Ie, Id, T>(pos, width, len));
  },

  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:203 read_lazy_offset_then
  read_lazy_offset_then<T>(self: LazyDecoder, f: (pos: number) => T): T {
    const distance = self.read_usize();
    let position: number;
    const state = self.get_lazy_state();
    switch (state.$) {
      case "NoNode":
        return bug("read_lazy_with_meta: outside of a metadata node");
      case "NodeStart": {
        const start = state._0;
        assert(distance <= start, "assertion failed: distance <= start");
        position = start - distance;
        break;
      }
      case "Previous": {
        const last_pos = state._0;
        position = last_pos + distance;
        break;
      }
    }
    // `NonZero::new(position).unwrap()`
    if (position === 0) return panic("called `Option::unwrap()` on a `None` value");
    self.set_lazy_state({ $: "Previous", _0: position });
    return f(position);
  },
};

// impl<'a> LazyDecoder for BlobDecodeContext<'a>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:221 set_lazy_state
BlobDecodeContext.prototype.set_lazy_state = function (this: BlobDecodeContext, state: LazyState): void {
  this.lazy_state = state;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:225 get_lazy_state
BlobDecodeContext.prototype.get_lazy_state = function (this: BlobDecodeContext): LazyState {
  return this.lazy_state;
};
BlobDecodeContext.prototype.read_lazy = function <T>(this: BlobDecodeContext): LazyValue<T> {
  return LazyDecoder_provided.read_lazy<T>(this);
};
BlobDecodeContext.prototype.read_lazy_array = function <T>(this: BlobDecodeContext, len: number): LazyArray<T> {
  return LazyDecoder_provided.read_lazy_array<T>(this, len);
};
BlobDecodeContext.prototype.read_lazy_table = function <Ie, Id, T>(this: BlobDecodeContext, width: number, len: number): LazyTable<Ie, Id, T> {
  return LazyDecoder_provided.read_lazy_table<Ie, Id, T>(this, width, len);
};
BlobDecodeContext.prototype.read_lazy_offset_then = function <T>(this: BlobDecodeContext, f: (pos: number) => T): T {
  return LazyDecoder_provided.read_lazy_offset_then(this, f);
};

/// This is the decode context used when crate metadata was already read.
/// Decoding of some types, like `Span` require some information to already been read.
/// Can be constructed from a [`TyCtxt`] and [`CrateMetadata`] (see impls of the [`MetaDecoder`]
/// trait).
export class MetadataDecodeContext {
  constructor(
    public blob_decoder: BlobDecodeContext,
    readonly cdata: CrateMetadata,
    readonly tcx: TyCtxt,

    // Used for decoding interpret::AllocIds in a cached & thread-safe manner.
    readonly alloc_decoding_session: AllocDecodingSession,
  ) {}
}
export interface MetadataDecodeContext extends LazyDecoder, SpanDecoder {
  // impl LazyDecoder for MetadataDecodeContext (decoder.rs:243) + its provided methods
  read_lazy<T>(): LazyValue<T>;
  read_lazy_array<T>(len: number): LazyArray<T>;
  read_lazy_table<Ie, Id, T>(width: number, len: number): LazyTable<Ie, Id, T>;
  read_lazy_offset_then<T>(f: (pos: number) => T): T;
  // impl MetadataDecodeContext (decoder.rs:359)
  map_encoded_cnum_to_current(cnum: CrateNum): CrateNum;
  // impl TyDecoder<'tcx> for MetadataDecodeContext (decoder.rs:395); `const CLEAR_CROSS_CRATE: bool = true;`
  /** `-> Ty<'tcx>` (M3) */
  cached_ty_for_shorthand(shorthand: number, or_insert_with: (this_: MetadataDecodeContext) => unknown): unknown;
  with_position<R>(pos: number, f: (this_: MetadataDecodeContext) => R): R;
  /** `-> AllocId` (M3) */
  decode_alloc_id(): unknown;
  // impl InternerDecoder for MetadataDecodeContext (decoder.rs:434)
  interner(): TyCtxt;
}
/** `TyDecoder::CLEAR_CROSS_CRATE` of `MetadataDecodeContext` (decoder.rs:396). */
export const MetadataDecodeContext_CLEAR_CROSS_CRATE = true;

// impl<'a, 'tcx> LazyDecoder for MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:244 set_lazy_state
MetadataDecodeContext.prototype.set_lazy_state = function (this: MetadataDecodeContext, state: LazyState): void {
  this.blob_decoder.lazy_state = state;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:248 get_lazy_state
MetadataDecodeContext.prototype.get_lazy_state = function (this: MetadataDecodeContext): LazyState {
  return this.blob_decoder.lazy_state;
};
MetadataDecodeContext.prototype.read_lazy = function <T>(this: MetadataDecodeContext): LazyValue<T> {
  return LazyDecoder_provided.read_lazy<T>(this);
};
MetadataDecodeContext.prototype.read_lazy_array = function <T>(this: MetadataDecodeContext, len: number): LazyArray<T> {
  return LazyDecoder_provided.read_lazy_array<T>(this, len);
};
MetadataDecodeContext.prototype.read_lazy_table = function <Ie, Id, T>(this: MetadataDecodeContext, width: number, len: number): LazyTable<Ie, Id, T> {
  return LazyDecoder_provided.read_lazy_table<Ie, Id, T>(this, width, len);
};
MetadataDecodeContext.prototype.read_lazy_offset_then = function <T>(this: MetadataDecodeContext, f: (pos: number) => T): T {
  return LazyDecoder_provided.read_lazy_offset_then(this, f);
};

/** `pub(super) trait MetaBlob<'a>: Copy { fn blob(&self) -> &'a MetadataBlob; }` */
export interface MetaBlob {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:254 blob
  blob(): MetadataBlob;
}

/**
 * `pub(super) trait MetaDecoder: Copy { type Context: BlobDecoder + LazyDecoder; fn decoder(self, pos: usize) -> Self::Context; }`
 * (decoder.rs:257; `decoder` at :260). Implemented by `&MetadataBlob` and `(&CrateMetadata, TyCtxt)`.
 */
export type MetaDecoder = MetadataBlob | [CrateMetadata, TyCtxt];
/** The decode context of a `MetaDecoder`. */
export type MetaDecoderContext<M extends MetaDecoder> = M extends MetadataBlob ? BlobDecodeContext : MetadataDecodeContext;
/** `MetaDecoder::decoder` dispatch (the two impls below). */
export function MetaDecoder_decoder<M extends MetaDecoder>(self: M, pos: number): MetaDecoderContext<M> {
  if (self instanceof MetadataBlob) return self.decoder(pos) as MetaDecoderContext<M>;
  return CrateMetadata_tcx_decoder(self as [CrateMetadata, TyCtxt], pos) as MetaDecoderContext<M>;
}

// impl<'a> MetaBlob<'a> for &'a MetadataBlob
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:264 blob
MetadataBlob.prototype.blob = function (this: MetadataBlob): MetadataBlob {
  return this;
};

// impl<'a> MetaDecoder for &'a MetadataBlob
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:272 decoder
MetadataBlob.prototype.decoder = function (this: MetadataBlob, pos: number): BlobDecodeContext {
  return new BlobDecodeContext(
    // FIXME: This unwrap should never panic because we check that it won't when creating
    // `MetadataBlob`. Ideally we'd just have a `MetadataDecoder` and hand out subslices of
    // it as we do elsewhere in the compiler using `MetadataDecoder::split_at`. But we own
    // the data for the decoder so holding onto the `MemDecoder` too would make us a
    // self-referential struct which is downright goofy because `MetadataBlob` is already
    // self-referential. Probably `MemDecoder` should contain an `OwnedSlice`, but that
    // demands a significant refactoring due to our crate graph.
    unwrap_result(MemDecoder.new(this.deref(), pos), () => "()"),
    this.blob(),
    LazyState.NoNode,
  );
};

// impl<'a> MetaBlob<'a> for &'a CrateMetadata
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:289 blob
CrateMetadata.prototype.blob = function (this: CrateMetadata): MetadataBlob {
  return this.blob_;
};

// ---- lane rmeta-decoder-a: decoder.rs:297 (MetaDecoder for (&CrateMetadata, TyCtxt)) ----
/** `impl<'a, 'tcx> MetaDecoder for (&'a CrateMetadata, TyCtxt<'tcx>) { fn decoder(self, pos) -> MetadataDecodeContext }` (decoder.rs:297) */
export function CrateMetadata_tcx_decoder(_self: [CrateMetadata, TyCtxt], _pos: number): MetadataDecodeContext {
  return unported("rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)");
}

declare module "./mod.ts" {
  interface LazyValue<T> {
    /** `impl<T: ParameterizedOverTcx> LazyValue<T> { fn decode<M: MetaDecoder>(self, metadata: M) -> T::Value<'tcx> }` */
    decode<V extends T>(metadata: MetadataBlob, decode_T: Decodable<V, BlobDecodeContext>): V;
    decode<V extends T>(metadata: [CrateMetadata, TyCtxt], decode_T: Decodable<V, MetadataDecodeContext>): V;
  }
  interface LazyArray<T> {
    /** `impl<T: ParameterizedOverTcx> LazyArray<T> { fn decode<M: MetaDecoder>(self, metadata: M) -> DecodeIterator<..> }` */
    decode<V extends T>(metadata: MetadataBlob, decode_T: Decodable<V, BlobDecodeContext>): DecodeIterator<V, BlobDecodeContext>;
    decode<V extends T>(metadata: [CrateMetadata, TyCtxt], decode_T: Decodable<V, MetadataDecodeContext>): DecodeIterator<V, MetadataDecodeContext>;
  }
}

// impl<T: ParameterizedOverTcx> LazyValue<T>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:309 decode
LazyValue.prototype.decode = function <T>(this: LazyValue<T>, metadata: MetaDecoder, decode_T: Decodable<T, LazyDecoder & Decoder>): T {
  const dcx: LazyDecoder = MetaDecoder_decoder(metadata, this.position);
  dcx.set_lazy_state({ $: "NodeStart", _0: this.position });
  return decode_T(dcx);
} as unknown as LazyValue<unknown>["decode"];

export class DecodeIterator<T, D extends Decoder> implements IterableIterator<T> {
  constructor(
    /** `std::ops::Range<usize>` */
    public elem_counter: { start: number; end: number },
    public dcx: D,
    /** PORT: `T::decode` (the `Decodable` fn) */
    readonly decode_T: Decodable<T, D>,
  ) {}

  // impl<D: Decoder, T: Decodable<D>> Iterator for DecodeIterator<T, D>
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:329 next
  next(): IteratorResult<T, undefined> {
    // `self.elem_counter.next().map(|_| T::decode(&mut self.dcx))`
    if (this.elem_counter.start < this.elem_counter.end) {
      this.elem_counter.start++;
      return { done: false, value: this.decode_T(this.dcx) };
    }
    return { done: true, value: undefined };
  }

  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:334 size_hint
  size_hint(): [number, number | undefined] {
    const n = Math.max(0, this.elem_counter.end - this.elem_counter.start);
    return [n, n];
  }

  // impl<D: Decoder, T: Decodable<D>> ExactSizeIterator for DecodeIterator<T, D>
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:340 len
  len(): number {
    return Math.max(0, this.elem_counter.end - this.elem_counter.start);
  }

  // unsafe impl TrustedLen for DecodeIterator<T, D> {}
  [globalThis.Symbol.iterator](): IterableIterator<T> {
    return this;
  }
}

// impl<T: ParameterizedOverTcx> LazyArray<T>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:349 decode
LazyArray.prototype.decode = function <T>(this: LazyArray<T>, metadata: MetaDecoder, decode_T: Decodable<T, LazyDecoder & Decoder>): DecodeIterator<T, LazyDecoder> {
  const dcx: LazyDecoder = MetaDecoder_decoder(metadata, this.position);
  dcx.set_lazy_state({ $: "NodeStart", _0: this.position });
  return new DecodeIterator({ start: 0, end: this.num_elems }, dcx, decode_T);
} as unknown as LazyArray<unknown>["decode"];

// impl<'a, 'tcx> MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:361 map_encoded_cnum_to_current
MetadataDecodeContext.prototype.map_encoded_cnum_to_current = function (this: MetadataDecodeContext, cnum: CrateNum): CrateNum {
  return this.cdata.map_encoded_cnum_to_current(cnum);
};

// impl<'a> BlobDecodeContext<'a>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:368 blob
BlobDecodeContext.prototype.blob = function (this: BlobDecodeContext): MetadataBlob {
  return this.blob_;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:372 decode_symbol_or_byte_symbol
BlobDecodeContext.prototype.decode_symbol_or_byte_symbol = function <S>(
  this: BlobDecodeContext,
  new_from_index: (i: number) => S,
  read_and_intern_str_or_byte_str_this: (this_: BlobDecodeContext) => S,
  read_and_intern_str_or_byte_str_opaque: (opaque: MemDecoder) => S,
): S {
  const tag = this.read_u8();

  switch (tag) {
    case SYMBOL_STR:
      return read_and_intern_str_or_byte_str_this(this);
    case SYMBOL_OFFSET: {
      // read str offset
      const pos = this.read_usize();

      // move to str offset and read
      return this.opaque.with_position(pos, (d) => read_and_intern_str_or_byte_str_opaque(d));
    }
    case SYMBOL_PREDEFINED:
      return new_from_index(this.read_u32());
    default:
      return unreachable();
  }
};

// ---- lane rmeta-decoder-a: decoder.rs:395..576 (TyDecoder, InternerDecoder, SpanDecoder, SpanData) ----
// rustc-decl: decoder.rs:398 cached_ty_for_shorthand, :415 with_position, :428 decode_alloc_id (TyDecoder)
unported_methods(MetadataDecodeContext.prototype, "rustc_metadata::rmeta::decoder::MetadataDecodeContext", [
  "cached_ty_for_shorthand",
  "with_position",
  "decode_alloc_id",
  "decode_syntax_context",
  "decode_expn_id",
  "decode_span",
]);

// impl<'a, 'tcx> rustc_middle::ty::InternerDecoder for MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:438 interner
MetadataDecodeContext.prototype.interner = function (this: MetadataDecodeContext): TyCtxt {
  return this.tcx;
};

// impl<'a, 'tcx> Decodable<MetadataDecodeContext<'a, 'tcx>> for ExpnIndex
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:445 decode
export function decode_ExpnIndex(d: MetadataDecodeContext): ExpnIndex {
  return ExpnIndex.from_u32(d.read_u32());
}

// impl<'a, 'tcx> SpanDecoder for MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:451 decode_attr_id
MetadataDecodeContext.prototype.decode_attr_id = function (this: MetadataDecodeContext): AttrId {
  return this.tcx.sess.psess.attr_id_generator.mk_attr_id();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:455 decode_crate_num
MetadataDecodeContext.prototype.decode_crate_num = function (this: MetadataDecodeContext): CrateNum {
  const cnum = CrateNum.from_u32(this.read_u32());
  return this.map_encoded_cnum_to_current(cnum);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:460 decode_def_id
MetadataDecodeContext.prototype.decode_def_id = function (this: MetadataDecodeContext): DefId {
  // `DefId { krate: Decodable::decode(self), index: Decodable::decode(self) }` (field order: krate first)
  const krate = this.decode_crate_num();
  const index = this.decode_def_index();
  return new DefId(index, krate);
};

// rustc-decl: decoder.rs:464 decode_syntax_context, :480 decode_expn_id, :504 decode_span (rmeta-decoder-a)

// impl<'a, 'tcx> BlobDecoder for MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:529 decode_def_index
MetadataDecodeContext.prototype.decode_def_index = function (this: MetadataDecodeContext): DefIndex {
  return this.blob_decoder.decode_def_index();
};
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:532 decode_symbol
MetadataDecodeContext.prototype.decode_symbol = function (this: MetadataDecodeContext): Symbol {
  return this.blob_decoder.decode_symbol();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:536 decode_byte_symbol
MetadataDecodeContext.prototype.decode_byte_symbol = function (this: MetadataDecodeContext): ByteSymbol {
  return this.blob_decoder.decode_byte_symbol();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:540 decode_local_def_id
MetadataDecodeContext.prototype.decode_local_def_id = function (this: MetadataDecodeContext): LocalDefId {
  return this.blob_decoder.decode_local_def_id();
};

// impl<'a> BlobDecoder for BlobDecodeContext<'a>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:546 decode_def_index
BlobDecodeContext.prototype.decode_def_index = function (this: BlobDecodeContext): DefIndex {
  return DefIndex.from_u32(this.read_u32());
};
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:549 decode_symbol
BlobDecodeContext.prototype.decode_symbol = function (this: BlobDecodeContext): Symbol {
  return this.decode_symbol_or_byte_symbol(
    Symbol.new,
    (this_) => Symbol.intern(this_.read_str()),
    (opaque) => Symbol.intern(opaque.read_str()),
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:557 decode_byte_symbol
BlobDecodeContext.prototype.decode_byte_symbol = function (this: BlobDecodeContext): ByteSymbol {
  return this.decode_symbol_or_byte_symbol(
    ByteSymbol.new,
    (this_) => ByteSymbol.intern(this_.read_byte_str()),
    (opaque) => ByteSymbol.intern(opaque.read_byte_str()),
  );
};

/// The `LocalDefId` decoding logic is different from the default
/// one (which is decoding local def id as default def id with crate num),
/// because during metadata encoding/decoding `LocalDefId` is used as a wrapper
/// around `DefIndex` with a guarantee that it is local, that is why we can
/// create `LocalDefId` straight from a def index.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:570 decode_local_def_id
BlobDecodeContext.prototype.decode_local_def_id = function (this: BlobDecodeContext): LocalDefId {
  return LocalDefId.of(this.decode_def_index());
};

// impl<'a, 'tcx> Decodable<MetadataDecodeContext<'a, 'tcx>> for SpanData (decoder.rs:575; rmeta-decoder-a)
export function decode_SpanData(_decoder: MetadataDecodeContext): SpanData {
  return unported("rustc_metadata::rmeta::decoder::<SpanData as Decodable<MetadataDecodeContext>>::decode");
}

// impl Decodable for LazyValue / LazyArray / LazyTable (decoder.rs:675..695): in mod.ts (`decode_LazyValue`, ..).

// impl<'a, 'tcx> Decoder for MetadataDecodeContext<'a, 'tcx> { forward_all_decoder_methods_to!(|self| self.blob_decoder.opaque); }
// impl<'a> Decoder for BlobDecodeContext<'a> { forward_all_decoder_methods_to!(|self| self.opaque); }
// rustc-macro: compiler/rustc_middle/src/ty/codec.rs:318 forward_all_decoder_methods_to! (read_usize .. position)
for (const [Ctx, inner] of [
  [BlobDecodeContext, (self: BlobDecodeContext) => self.opaque],
  [MetadataDecodeContext, (self: MetadataDecodeContext) => self.blob_decoder.opaque],
] as const) {
  const proto = Ctx.prototype as unknown as Record<string, unknown>;
  const get = inner as (self: unknown) => MemDecoder;
  for (const m of ["read_usize", "read_u128", "read_u64", "read_u32", "read_u16", "read_u8", "read_isize", "read_i128", "read_i64", "read_i32", "read_i16", "read_raw_bytes", "peek_byte", "position"] as const) {
    proto[m] = function (this: unknown, ...a: unknown[]): unknown {
      return (get(this)[m] as (...a: unknown[]) => unknown).apply(get(this), a);
    };
  }
  // the provided `Decoder` methods (not forwarded by the macro)
  proto.read_i8 = function (this: Decoder): number {
    return Decoder_provided.read_i8(this);
  };
  proto.read_bool = function (this: Decoder): boolean {
    return Decoder_provided.read_bool(this);
  };
  proto.read_char = function (this: Decoder): number {
    return Decoder_provided.read_char(this);
  };
  proto.read_str = function (this: Decoder): string {
    return Decoder_provided.read_str(this);
  };
  proto.read_byte_str = function (this: Decoder): Uint8Array {
    return Decoder_provided.read_byte_str(this);
  };
}

// ---- impl MetadataBlob (decoder.rs:705) ----

/** `self[off..][..len]` with Rust's slice-index panics. */
function blob_range(blob: Uint8Array, off: number, len: number): Uint8Array {
  if (off > blob.length) panic(`range start index ${off} out of range for slice of length ${blob.length}`);
  if (len > blob.length - off) panic(`range end index ${len} out of range for slice of length ${blob.length - off}`);
  return blob.subarray(off, off + len);
}
/** `u64::from_le_bytes(..) as usize` (positions: exact below 2^53). */
function u64_le_as_usize(b: Uint8Array): number {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[i]!);
  if (x > BigInt(Number.MAX_SAFE_INTEGER)) return panic(`rustc_metadata: position ${x} is not an exact usize`);
  return Number(x);
}
function starts_with(blob: Uint8Array, prefix: Uint8Array): boolean {
  if (blob.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (blob[i] !== prefix[i]) return false;
  return true;
}
const RUST_BYTES = new Uint8Array([0x72, 0x75, 0x73, 0x74]); // b"rust"

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:706 check_compatibility
MetadataBlob.prototype.check_compatibility = function (this: MetadataBlob, cfg_version: string): Result<void, string | undefined> {
  if (!starts_with(this.deref(), METADATA_HEADER)) {
    if (starts_with(this.deref(), RUST_BYTES)) {
      return Err("<unknown rustc version>");
    }
    return Err(undefined);
  }

  const found_version = LazyValue.from_position<string>(VERSION_OFFSET).decode(this, decode_String);
  if (rustc_version(cfg_version) !== found_version) {
    return Err(found_version);
  }

  return Ok(undefined);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:726 root_pos
MetadataBlob.prototype.root_pos = function (this: MetadataBlob): number {
  const pos_bytes = blob_range(this.deref(), ROOT_POS_OFFSET, 8);
  const pos = u64_le_as_usize(pos_bytes);
  if (pos === 0) return panic("called `Option::unwrap()` on a `None` value");
  return pos;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:732 unhashed_pos
MetadataBlob.prototype.unhashed_pos = function (this: MetadataBlob): number {
  const pos_bytes = blob_range(this.deref(), UNHASHED_POS_OFFSET, 8);
  const pos = u64_le_as_usize(pos_bytes);
  if (pos === 0) return panic("called `Option::unwrap()` on a `None` value");
  return pos;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:738 get_header
MetadataBlob.prototype.get_header = function (this: MetadataBlob): CrateHeader {
  const pos = this.root_pos();
  return LazyValue.from_position<CrateHeader>(pos).decode(this, decode_CrateHeader);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:743 get_root
MetadataBlob.prototype.get_root = function (this: MetadataBlob): CrateRoot {
  const pos = this.root_pos();
  return LazyValue.from_position<CrateRoot>(pos).decode(this, decode_CrateRoot);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:748 get_root_unhashed
MetadataBlob.prototype.get_root_unhashed = function (this: MetadataBlob): CrateRootUnhashed {
  const pos = this.unhashed_pos();
  return LazyValue.from_position<CrateRootUnhashed>(pos).decode(this, decode_CrateRootUnhashed);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:753 get_dep_extra_filenames
MetadataBlob.prototype.get_dep_extra_filenames = function (this: MetadataBlob): string[] {
  return this.get_root_unhashed().dep_extra_filenames;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:757 get_crate_hash
MetadataBlob.prototype.get_crate_hash = function (this: MetadataBlob): Svh {
  const bytes = blob_range(this.deref(), CRATE_HASH_OFFSET, CRATE_HASH_LEN);
  return Svh_new(Fingerprint.from_le_bytes(bytes));
};

/** `writeln!(out, ..)?` / `write!(out, ..)?` */
function w(out: Write, s: string): IoResult<void> {
  return out.write_fmt([s]);
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:763 list_crate_metadata
MetadataBlob.prototype.list_crate_metadata = function (this: MetadataBlob, out: Write, ls_kinds_: readonly string[]): IoResult<void> {
  const root = this.get_root();
  const extra_filename = this.get_root_unhashed().extra_filename;

  const all_ls_kinds = ["root", "lang_items", "features", "items", "target_modifiers"];
  const ls_kinds = ls_kinds_.includes("all") ? all_ls_kinds : ls_kinds_;

  let r: IoResult<void>;
  for (const kind of ls_kinds) {
    switch (kind) {
      case "root": {
        if ((r = w(out, "Crate info:\n")).$ === "Err") return r;
        if ((r = w(out, `name ${Symbol.as_str(root.name())}${extra_filename}\n`)).$ === "Err") return r;
        if ((r = w(out, `hash ${this.get_crate_hash()} stable_crate_id ${debug_StableCrateId(root.stable_crate_id_, PLAIN)}\n`)).$ === "Err") return r;
        if ((r = w(out, `proc_macro ${debug_bool(root.proc_macro_data !== undefined, PLAIN)}\n`)).$ === "Err") return r;
        if ((r = w(out, `triple ${TargetTuple.tuple(root.header.triple)}\n`)).$ === "Err") return r;
        if ((r = w(out, `edition ${display_Edition(root.edition)}\n`)).$ === "Err") return r;
        if ((r = w(out, `symbol_mangling_version ${root.symbol_mangling_version}\n`)).$ === "Err") return r;
        if (
          (r = w(out, `required_panic_strategy ${debug_option(root.required_panic_strategy, PLAIN, (v) => v)} panic_in_drop_strategy ${root.panic_in_drop_strategy}\n`)).$ ===
          "Err"
        )
          return r;
        if (
          (r = w(
            out,
            `has_global_allocator ${root.has_global_allocator} has_alloc_error_handler ${root.has_alloc_error_handler} has_panic_handler ${root.has_panic_handler} has_default_lib_allocator ${root.has_default_lib_allocator}\n`,
          )).$ === "Err"
        )
          return r;
        if (
          (r = w(
            out,
            `compiler_builtins ${root.compiler_builtins} needs_allocator ${root.needs_allocator} needs_panic_runtime ${root.needs_panic_runtime} no_builtins ${root.no_builtins} panic_runtime ${root.panic_runtime} profiler_runtime ${root.profiler_runtime}\n`,
          )).$ === "Err"
        )
          return r;

        if ((r = w(out, "=External Dependencies=\n")).$ === "Err") return r;
        const dylib_dependency_formats = [...(root.dylib_dependency_formats as LazyArray<LinkagePreference | undefined>).decode(this, decode_Option_LinkagePreference)];
        // `extra_filename` is stored outside the hashed root; see
        // `CrateRootUnhashed::dep_extra_filenames`.
        const dep_extra_filenames = this.get_dep_extra_filenames();
        let i = 0;
        for (const dep of root.crate_deps.decode(this, decode_CrateDep)) {
          const { name, hash, host_hash, kind, is_private } = dep;
          const number = i + 1;
          const dep_extra_filename = dep_extra_filenames[CrateNum.as_usize(CrateNum.new(number))] ?? "";

          const privacy = is_private ? "private" : "public";
          const linkage = dylib_dependency_formats.length === 0 ? "" : ` linkage ${debug_option(dylib_dependency_formats[i], PLAIN, debug_LinkagePreference)}`;
          if (
            (r = w(
              out,
              `${number} ${Symbol.as_str(name)}${dep_extra_filename} hash ${hash} host_hash ${debug_option(host_hash, PLAIN, debug_Svh)} kind ${debug_CrateDepKind(kind, PLAIN)} ${privacy}${linkage}\n`,
            )).$ === "Err"
          )
            return r;
          i++;
        }
        if ((r = w(out, "\n")).$ === "Err") return r;
        break;
      }

      case "lang_items":
        // PORT: `root.lang_items` decodes `(LocalDefId, LangItem)` and prints `DefPath::make(..)` of each; LangItem's
        // derive(BlobDecodable) is not generated yet (rustc_attr_ir lang_items.rs, `language_item_table!`).
        return unported("rustc_metadata::rmeta::decoder::MetadataBlob::list_crate_metadata (-Zls=lang_items: Decodable for LangItem)");

      case "features":
        // PORT: `root.lib_features` decodes `(Symbol, FeatureStability)`; rustc_middle lib_features is not ported.
        return unported("rustc_metadata::rmeta::decoder::MetadataBlob::list_crate_metadata (-Zls=features: Decodable for FeatureStability)");

      case "items": {
        if ((r = w(out, "=Items=\n")).$ === "Err") return r;

        // `fn print_item(blob, out, item, indent)` (decoder.rs:888; lane rmeta-decoder-a): stub, no marker. It needs
        // `Decodable` for `DefKey` and `Visibility<LocalDefId>`.
        const print_item = (_blob: MetadataBlob, _out: Write, _item: DefIndex, _indent: number): IoResult<void> => {
          return unported("rustc_metadata::rmeta::decoder::MetadataBlob::list_crate_metadata::print_item (-Zls=items)");
        };

        if ((r = print_item(this, out, DefIndex.from_u32(0), 0)).$ === "Err") return r;

        if ((r = w(out, "\n")).$ === "Err") return r;
        break;
      }
      case "target_modifiers":
        // PORT: `root.decode_target_modifiers(self)`; `TargetModifier`'s derive(BlobDecodable) is not generated yet.
        return unported("rustc_metadata::rmeta::decoder::MetadataBlob::list_crate_metadata (-Zls=target_modifiers: Decodable for TargetModifier)");

      default:
        if ((r = w(out, "unknown -Zls kind. allowed values are: all, root, lang_items, features, items, target_modifiers\n")).$ === "Err") return r;
        break;
    }
  }

  return Ok(undefined);
};

/** `Option<LinkagePreference>::decode` (generated `decode_LinkagePreference`, rustc_crate_store). */
function decode_Option_LinkagePreference(d: BlobDecodeContext): LinkagePreference | undefined {
  return decode_Option_(d, (d) => decode_LinkagePreference_(d));
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:981 get_proc_macro_info
MetadataBlob.prototype.get_proc_macro_info = function (this: MetadataBlob): ProcMacroKind[] {
  const data = this.get_root().proc_macro_data;
  if (data === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const out: ProcMacroKind[] = [];
  for (const [_id, kind] of data.macros.decode(this, (d) => decode_tuple_(d, (d) => d.decode_local_def_id(), (d) => d.read_lazy<ProcMacroKind>()))) {
    out.push(kind.decode(this, decode_ProcMacroKind));
  }
  return out;
};

// ---- impl CrateRoot (decoder.rs:992) ----
declare module "./mod.ts" {
  interface CrateRoot {
    is_proc_macro_crate(): boolean;
    name(): Symbol;
    stable_crate_id(): StableCrateId;
    /** PORT: the `impl ExactSizeIterator`, collected (creader indexes it). */
    decode_crate_deps(metadata: MetadataBlob): CrateDep[];
    /** PORT: the `impl ExactSizeIterator`, collected. */
    decode_target_modifiers(metadata: MetadataBlob): TargetModifier[];
    /** PORT: the `impl ExactSizeIterator`, collected. */
    decode_denied_partial_mitigations(metadata: MetadataBlob): DeniedPartialMitigation[];
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:993 is_proc_macro_crate
CrateRoot.prototype.is_proc_macro_crate = function (this: CrateRoot): boolean {
  return this.proc_macro_data !== undefined;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:997 name
CrateRoot.prototype.name = function (this: CrateRoot): Symbol {
  return this.header.name;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1001 stable_crate_id
CrateRoot.prototype.stable_crate_id = function (this: CrateRoot): StableCrateId {
  return this.stable_crate_id_;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1005 decode_crate_deps
CrateRoot.prototype.decode_crate_deps = function (this: CrateRoot, metadata: MetadataBlob): CrateDep[] {
  return [...this.crate_deps.decode(metadata, decode_CrateDep)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1012 decode_target_modifiers
CrateRoot.prototype.decode_target_modifiers = function (this: CrateRoot, metadata: MetadataBlob): TargetModifier[] {
  return [...(this.target_modifiers as LazyArray<TargetModifier>).decode(metadata, decode_TargetModifier)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1019 decode_denied_partial_mitigations
CrateRoot.prototype.decode_denied_partial_mitigations = function (this: CrateRoot, metadata: MetadataBlob): DeniedPartialMitigation[] {
  return [...(this.denied_partial_mitigations as LazyArray<DeniedPartialMitigation>).decode(metadata, decode_DeniedPartialMitigation)];
};

/** `TargetModifier`'s derive(BlobDecodable) (rustc_session options.rs): not generated yet. */
function decode_TargetModifier(_d: BlobDecoder): TargetModifier {
  return unported("Decodable for rustc_session::config::TargetModifier (derive(BlobDecodable) not generated)");
}
/** `DeniedPartialMitigation`'s derive(BlobDecodable) (rustc_session mitigation_coverage.rs): not generated yet. */
function decode_DeniedPartialMitigation(_d: BlobDecoder): DeniedPartialMitigation {
  return unported("Decodable for rustc_session::config::mitigation_coverage::DeniedPartialMitigation (derive(BlobDecodable) not generated)");
}

// ---- impl CrateMetadata (decoder.rs:1027) ----
// ---- lane rmeta-decoder-a: decoder.rs:1028..1342 ----
unported_methods(CrateMetadata.prototype, "rustc_metadata::rmeta::decoder::CrateMetadata", [
  "missing",
  "raw_proc_macro",
  "opt_item_name",
  "item_name",
  "opt_item_ident",
  "item_ident",
  // map_encoded_cnum_to_current: ported below (lane rmeta-contract)
  "def_kind",
  "get_span",
  "load_proc_macro",
  "get_variant",
  "get_adt_def",
  "get_visibility",
  "get_mut_restriction",
  "get_safety",
  "get_default_field",
  "get_expn_that_defined",
  "get_debugger_visualizers",
  "get_lib_features",
  "get_stability_implications",
  "get_lang_items",
  "get_stripped_cfg_items",
  "get_diagnostic_items",
  "get_canonical_symbols",
  "get_fake_doc_items",
]);

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1081 map_encoded_cnum_to_current
CrateMetadata.prototype.map_encoded_cnum_to_current = function (this: CrateMetadata, cnum: CrateNum): CrateNum {
  if (cnum === LOCAL_CRATE) {
    return this.cnum;
  } else {
    const c = this.cnum_map[CrateNum.as_usize(cnum)];
    if (c === undefined) return panic(`index out of bounds: the len is ${this.cnum_map.length} but the index is ${CrateNum.as_usize(cnum)}`);
    return c;
  }
};

// ---- end rmeta-decoder-a ----

// ---- lane rmeta-decoder-b: decoder.rs:1343..2035 ----
unported_methods(CrateMetadata.prototype, "rustc_metadata::rmeta::decoder::CrateMetadata", [
  "get_mod_child",
  "get_module_children",
  "get_ambig_module_children",
  "is_item_mir_available",
  "get_fn_has_self_parameter",
  "get_associated_item_or_field_def_ids",
  "get_associated_item",
  "get_ctor",
  "get_item_attrs",
  "get_inherent_implementations_for_type",
  "get_traits",
  "get_trait_impls",
  "get_incoherent_impls",
  "get_implementations_of_trait",
  "get_native_libraries",
  "get_proc_macro_quoted_span",
  "get_foreign_modules",
  "get_dylib_dependency_formats",
  "get_externally_implementable_items",
  "get_missing_lang_items",
  "get_exportable_items",
  "get_stable_order_of_exportable_impls",
  "exported_non_generic_symbols",
  "exported_generic_symbols",
  "get_macro",
  "def_key",
  "def_path",
  "def_path_hash",
  "def_path_hash_to_def_index",
  "expn_hash_to_expn_id",
  "imported_source_file",
  "get_attr_flags",
  "get_intrinsic",
  "get_doc_link_resolutions",
  "get_doc_link_traits_in_scope",
]);
// rustc-decl: decoder.rs:1977 CrateMetadata::new (static, in the class body above)

// ---- end rmeta-decoder-b ----

// ---- impl CrateMetadata (decoder.rs:1976): accessors (lane rmeta-contract) ----

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2037 dependencies
CrateMetadata.prototype.dependencies = function (this: CrateMetadata): Iterable<CrateNum> {
  return this.cnum_map.values();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2041 target_modifiers
CrateMetadata.prototype.target_modifiers = function (this: CrateMetadata): TargetModifiers {
  return this.root.decode_target_modifiers(this.blob_);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2045 enabled_denied_partial_mitigations
CrateMetadata.prototype.enabled_denied_partial_mitigations = function (this: CrateMetadata): DeniedPartialMitigations {
  return this.root.decode_denied_partial_mitigations(this.blob_);
};

/// Keep `new_extern_crate` if it looks better in diagnostics
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2050 update_extern_crate_diagnostics
CrateMetadata.prototype.update_extern_crate_diagnostics = function (this: CrateMetadata, new_extern_crate: ExternCrate): boolean {
  const old = this.extern_crate;
  // `old.rank() < new_extern_crate.rank()` (tuple `(bool, usize)` order)
  const update = old === undefined || rank_lt(old.rank(), new_extern_crate.rank());
  if (update) {
    this.extern_crate = new_extern_crate;
  }
  return update;
};
function rank_lt(a: [boolean, number], b: [boolean, number]): boolean {
  if (a[0] !== b[0]) return !a[0] && b[0];
  return a[1] < b[1];
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2062 source
CrateMetadata.prototype.source = function (this: CrateMetadata): CrateSource {
  return this.source_;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2066 dep_kind
CrateMetadata.prototype.dep_kind = function (this: CrateMetadata): CrateDepKind {
  return this.dep_kind_;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2070 set_dep_kind
CrateMetadata.prototype.set_dep_kind = function (this: CrateMetadata, dep_kind: CrateDepKind): void {
  this.dep_kind_ = dep_kind;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2074 update_and_private_dep
CrateMetadata.prototype.update_and_private_dep = function (this: CrateMetadata, private_dep: boolean): void {
  this.private_dep &&= private_dep;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2078 used
CrateMetadata.prototype.used = function (this: CrateMetadata): boolean {
  return this.used_;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2082 required_panic_strategy
CrateMetadata.prototype.required_panic_strategy = function (this: CrateMetadata): PanicStrategy | undefined {
  return this.root.required_panic_strategy;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2086 needs_panic_runtime
CrateMetadata.prototype.needs_panic_runtime = function (this: CrateMetadata): boolean {
  return this.root.needs_panic_runtime;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2090 is_private_dep
CrateMetadata.prototype.is_private_dep = function (this: CrateMetadata): boolean {
  return this.private_dep;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2094 is_panic_runtime
CrateMetadata.prototype.is_panic_runtime = function (this: CrateMetadata): boolean {
  return this.root.panic_runtime;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2098 is_profiler_runtime
CrateMetadata.prototype.is_profiler_runtime = function (this: CrateMetadata): boolean {
  return this.root.profiler_runtime;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2102 is_compiler_builtins
CrateMetadata.prototype.is_compiler_builtins = function (this: CrateMetadata): boolean {
  return this.root.compiler_builtins;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2106 needs_allocator
CrateMetadata.prototype.needs_allocator = function (this: CrateMetadata): boolean {
  return this.root.needs_allocator;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2110 has_global_allocator
CrateMetadata.prototype.has_global_allocator = function (this: CrateMetadata): boolean {
  return this.root.has_global_allocator;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2114 has_alloc_error_handler
CrateMetadata.prototype.has_alloc_error_handler = function (this: CrateMetadata): boolean {
  return this.root.has_alloc_error_handler;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2118 has_default_lib_allocator
CrateMetadata.prototype.has_default_lib_allocator = function (this: CrateMetadata): boolean {
  return this.root.has_default_lib_allocator;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2122 is_proc_macro_crate
CrateMetadata.prototype.is_proc_macro_crate = function (this: CrateMetadata): boolean {
  return this.root.is_proc_macro_crate();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2126 proc_macros_for_crate
CrateMetadata.prototype.proc_macros_for_crate = function* (this: CrateMetadata, tcx: TyCtxt, krate: CrateNum): Iterable<DefId> {
  const data = this.root.proc_macro_data;
  if (data !== undefined) {
    const cdata: [CrateMetadata, TyCtxt] = [this, tcx];
    for (const [id, _] of data.macros.decode(cdata, (d) => decode_tuple_(d, (d) => d.decode_local_def_id(), (d) => d.read_lazy<ProcMacroKind>()))) {
      yield new DefId(LocalDefId.local_def_index(id), krate);
    }
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2144 name
CrateMetadata.prototype.name = function (this: CrateMetadata): Symbol {
  return this.root.header.name;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2148 hash
CrateMetadata.prototype.hash = function (this: CrateMetadata): Svh {
  return this.blob_.get_crate_hash();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2152 has_async_drops
CrateMetadata.prototype.has_async_drops = function (this: CrateMetadata): boolean {
  return this.root.tables.adt_async_destructor.len > 0;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2156 num_def_ids
CrateMetadata.prototype.num_def_ids = function (this: CrateMetadata): number {
  return this.root.tables.def_keys.size();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2160 local_def_id
CrateMetadata.prototype.local_def_id = function (this: CrateMetadata, index: DefIndex): DefId {
  return new DefId(index, this.cnum);
};

// Translate a DefId from the current compilation environment to a DefId
// for an external crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:2166 reverse_translate_def_id
CrateMetadata.prototype.reverse_translate_def_id = function (this: CrateMetadata, did: DefId): RawDefId | undefined {
  for (let local = 0; local < this.cnum_map.length; local++) {
    const global = this.cnum_map[local]!;
    if (global === did.krate) {
      return new RawDefId(local, DefIndex.as_u32(did.index));
    }
  }

  return undefined;
};

