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
// - `forward_all_decoder_methods_to!` (rustc_middle ty/codec.rs:318) is rustc_middle ty/codec.ts's `forward_all_decoder_methods_to`, called for the two `Decoder` impls.
// - `rustc_span::{BlobDecoder, SpanDecoder}` (lib.rs:1501 / 1528) are rustc_span's (lane span-decode), re-exported.
// - `Svh` (rustc_data_structures svh.rs, not ported) stays the creader stand-in: the hash's `Display` text.
// PORT: crate roots first, for their load order (decodable.gen.ts reaches rustc_target/spec/mod.ts and
// rustc_session/config.ts, which must be evaluated through their lib.ts).
import "../../rustc_session/lib.ts";
import "../../rustc_target/lib.ts";
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
// rmeta-decoder-a imports
import { proc_macro as expand_proc_macro } from "../../rustc_expand/lib.ts";
import { SyntaxExtension as SyntaxExtension_, type SyntaxExtensionKind } from "../../rustc_expand/base.ts";
import { CanonicalSymbols } from "../../rustc_attr_ir/canonical_symbols.ts";
import type { StrippedCfgItem } from "../../rustc_attr_ir/data_structures.ts";
import type { DiagnosticItems } from "../../rustc_attr_ir/diagnostic_items.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import { DefPath as DefPath_, DefPathData } from "../../rustc_hir_id/definitions.ts";
import { decode_FeatureStability, decode_ImplTraitInTraitData, decode_RestrictionKind, decode_Visibility } from "../../rustc_middle/decodable.gen.ts";
import type { FeatureStability } from "../../rustc_middle/middle/mod.ts";
import type { RestrictionKind } from "../../rustc_middle/ty/mod.ts";
import { debug_Visibility, Visibility as ty_Visibility } from "../../rustc_middle/ty/mod.ts";
import { decode_u32 } from "../../rustc_serialize/serialize.ts";
import { CRATE_DEF_INDEX, DefIdMap, debug_DefId, ModId as ModId_ } from "../../rustc_span/def_id.ts";
import { decode_ExpnData, decode_ExpnHash, decode_Transparency } from "../../rustc_span/decodable.gen.ts";
import { decode_expn_id as hygiene_decode_expn_id, decode_syntax_context as hygiene_decode_syntax_context, type ExpnData, HygieneDecodeContext as HygieneDecodeContext_, type SyntaxContextKey } from "../../rustc_span/hygiene.ts";
import { type BlobDecoder, type SpanDecoder, BytePos, DUMMY_SP, decode_BytePos, decode_CrateNum, decode_DefId, decode_ExpnId, decode_Span, decode_SyntaxContext, type SourceFile as SourceFile_, Span as Span_, SpanData as SpanData_ } from "../../rustc_span/lib.ts";
import { debug_Symbol, Ident as Ident_, kw } from "../../rustc_span/symbol.ts";
import { debug_str } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { CStore } from "../creader.ts";
import { decode_SpanTag, decode_VariantData } from "../decodable.gen.ts";
import type { AdtDef, AdtKind } from "../../rustc_middle/ty/adt.ts";
import { FieldDef, VariantDef } from "../../rustc_middle/ty/mod.ts";
import type { VariantIdx } from "../../rustc_middle/ty/decls.ts";
import type { ReprOptions } from "../../rustc_abi/lib.ts";
import { decode_ReprOptions } from "../../rustc_abi/decodable.gen.ts";
import { SpanTag } from "./mod.ts";
import { fse_Option_DefKind, fse_Option_LazyArray, fse_Option_LazyValue, fse_Safety } from "./table.ts";

// rmeta-decoder-b imports
import type { DelimArgs } from "../../rustc_ast/lib.ts";
import type { Res } from "../../rustc_hir/def.ts";
import { clone_DefKey, debug_DefKey, debug_DefPathData, decode_DefKey } from "../../rustc_hir_id/definitions.ts";
import { decode_u64 } from "../../rustc_serialize/serialize.ts";
import { DefPathHash as DefPathHash_, StableCrateId as StableCrateId_ } from "../../rustc_span/def_id.ts";
import { decode_Ident } from "../../rustc_span/decodable.gen.ts";
import { register_expn_id } from "../../rustc_span/hygiene.ts";
import { decode_SourceFile, type FileName, type PathBuf, RealFileName, RelativeBytePos, RemapPathScopeComponents } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { path_eq, path_join, path_strip_prefix } from "../../std/path.ts";
import { decode_IncoherentImpls, decode_TraitImpls } from "../decodable.gen.ts";
import { DefPathHashMapRef as DefPathHashMapRef_, decode_DefPathHashMapRef } from "./def_path_hash_map.ts";
import { fse_AttrFlags, fse_bool, fse_LazyArray, fse_u64, is_default_LazyArray } from "./table.ts";
import { RawDefId_key, type VariantData } from "./mod.ts";
// end rmeta-decoder-b imports
// decode-elems imports
import { type SimplifiedType, SimplifiedType_key } from "../../rustc_middle/ty/fast_reject.ts";
import { decode_SimplifiedType as decode_SimplifiedType_ } from "../../rustc_type_ir/fast_reject.ts";
import { decode_AmbigModChild, decode_ModChild } from "../../rustc_middle/decodable.gen.ts";
import { decode_DelimArgs } from "../../rustc_ast/lib.ts";
import { decode_Attribute } from "../../rustc_attr_ir/attr.ts";
import { decode_StrippedCfgItem } from "../../rustc_attr_ir/data_structures.ts";
import { decode_LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { decode_DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
// end decode-elems imports
// rmeta-ty imports
import { forward_all_decoder_methods_to, type TyDecoder, TyDecoder_provided } from "../../rustc_middle/ty/codec.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Pending } from "../../rustc_type_ir/decls.ts";
import { type AssocContainer, type AssocItem, type AssocKind, type AssocTypeData, decode_AssocContainer } from "../../rustc_middle/ty/assoc.gen.ts";
import type { ImplTraitInTraitData } from "../../rustc_middle/ty/decls.ts";
// end rmeta-ty imports

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

// `rustc_span::{BlobDecoder, SpanDecoder}` (lib.rs:1501 / 1528, lane span-decode); re-exported for the modules
// that imported the contract's structural declarations from here.
export type { BlobDecoder, SpanDecoder };

/** Types without a TS port yet (M3 / M6), named for the declarations below. */
export type ProcMacroClient = unknown; // rustc_proc_macro::bridge::client::Client (M6)
export type AllocDecodingState = unknown; // rustc_middle::mir::interpret (M3)
export type AllocDecodingSession = unknown; // rustc_middle::mir::interpret (M3)
type AllocId = Pending<"mir::interpret::AllocId">; // rustc_middle::mir::interpret (M4)
export type HygieneDecodeContext = unknown; // rustc_span::hygiene (lane hygiene-decode)
// `rustc_middle::ty::fast_reject::SimplifiedType` (rustc_type_ir fast_reject.rs at `DefId`, lane decode-elems).
export type { SimplifiedType };
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
    /// PORT: a `KeyedMap` (src/rust_ts/keyed.ts) keyed by `SimplifiedType_key` (rustc_middle ty/fast_reject.ts).
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

  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1977 new
  static new(
    tcx: TyCtxt,
    blob: MetadataBlob,
    root: CrateRoot,
    unhashed: CrateRootUnhashed,
    raw_proc_macros: readonly ProcMacroClient[] | undefined,
    cnum: CrateNum,
    cnum_map: CrateNumMap,
    dep_kind: CrateDepKind,
    source: CrateSource,
    private_dep: boolean,
    host_hash: Svh | undefined,
  ): CrateMetadata {
    // `.map(|trait_impls| (trait_impls.trait_id, trait_impls.impls)).collect()` (an `FxIndexMap<RawDefId, _>`)
    const trait_impls = new KeyedMap<RawDefId, LazyArray<[LocalDefId, SimplifiedType | undefined]>>(RawDefId_key);
    for (const trait_impls_ of root.impls.decode(blob, decode_TraitImpls)) {
      // PORT: mod.ts types `TraitImpls::impls`' element `(LocalDefId, Option<SimplifiedType>)` as `[LocalDefId, unknown]`.
      trait_impls.set(trait_impls_.trait_id, trait_impls_.impls as LazyArray<[LocalDefId, SimplifiedType | undefined]>);
    }
    // PORT: `interpret_alloc_index` is a `LazyArray<u64>` (mod.ts types its phantom element `number`).
    const alloc_decoding_state = AllocDecodingState_new([...(root.interpret_alloc_index as LazyArray<unknown> as LazyArray<bigint>).decode(blob, decode_u64)]);

    // Pre-decode the DefPathHash->DefIndex table. This is a cheap operation
    // that does not copy any data. It just does some data verification.
    const def_path_hash_map = root.def_path_hash_map.decode(blob, decode_DefPathHashMapRef);

    const cdata = new CrateMetadata(
      blob,
      root,
      unhashed,
      trait_impls,
      /* incoherent_impls */ new KeyedMap(SimplifiedType_key),
      raw_proc_macros,
      /* source_map_import_info */ [],
      def_path_hash_map,
      /* expn_hash_map */ undefined,
      alloc_decoding_state,
      /* def_key_cache */ new Map(),
      cnum,
      cnum_map,
      dep_kind,
      source,
      private_dep,
      host_hash,
      /* used */ false,
      /* hygiene_context */ HygieneDecodeContext_.default(),
      /* extern_crate */ undefined,
    );

    const incoherent_impls = new KeyedMap<SimplifiedType, LazyArray<LocalDefId>>(SimplifiedType_key);
    for (const incoherent_impls_ of cdata.root.incoherent_impls.decode([cdata, tcx], decode_IncoherentImpls)) {
      incoherent_impls.set((incoherent_impls_.self_ty as LazyValue<SimplifiedType>).decode([cdata, tcx], decode_SimplifiedType), incoherent_impls_.impls);
    }
    cdata.incoherent_impls = incoherent_impls;

    return cdata;
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
  get_variant(tcx: TyCtxt, kind: DefKind, index: DefIndex, parent_did: DefId): [VariantIdx, VariantDef];
  get_adt_def(tcx: TyCtxt, item_id: DefIndex): AdtDef;
  get_visibility(tcx: TyCtxt, id: DefIndex): Visibility<ModId>;
  get_mut_restriction(tcx: TyCtxt, id: DefIndex): RestrictionKind;
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
  get_associated_item(tcx: TyCtxt, id: DefIndex): AssocItem;
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
export interface MetadataDecodeContext extends LazyDecoder, SpanDecoder, TyDecoder {
  // impl LazyDecoder for MetadataDecodeContext (decoder.rs:243) + its provided methods
  read_lazy<T>(): LazyValue<T>;
  read_lazy_array<T>(len: number): LazyArray<T>;
  read_lazy_table<Ie, Id, T>(width: number, len: number): LazyTable<Ie, Id, T>;
  read_lazy_offset_then<T>(f: (pos: number) => T): T;
  // impl MetadataDecodeContext (decoder.rs:359)
  map_encoded_cnum_to_current(cnum: CrateNum): CrateNum;
  // impl TyDecoder<'tcx> for MetadataDecodeContext (decoder.rs:395); `const CLEAR_CROSS_CRATE: bool = true;`
  // PORT(decls) (lane rmeta-ty): `Ty` / `AllocId` now that rustc_middle ty/codec.ts declares `TyDecoder`.
  cached_ty_for_shorthand(shorthand: number, or_insert_with: (this_: MetadataDecodeContext) => Ty): Ty;
  with_position<R>(pos: number, f: (this_: MetadataDecodeContext) => R): R;
  positioned_at_shorthand(): boolean; // (provided, ty/codec.rs:55)
  decode_alloc_id(): AllocId;
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
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:260 decoder
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
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:297 decoder
export function CrateMetadata_tcx_decoder(self: [CrateMetadata, TyCtxt], pos: number): MetadataDecodeContext {
  return new MetadataDecodeContext(
    self[0].blob().decoder(pos),
    self[0],
    self[1],
    // PORT: `self.0.alloc_decoding_state.new_decoding_session()`: rustc_middle mir/interpret/mod.rs:158 is
    // `AllocDecodingSession { state: self }` (no other state); `AllocDecodingState` has no TS port yet (M3), so the
    // session is that one-field record. Only `decode_alloc_id` (M3, unported) reads it.
    { state: self[0].alloc_decoding_state },
  );
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
// impl<'a, 'tcx> TyDecoder<'tcx> for MetadataDecodeContext<'a, 'tcx>
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:398 cached_ty_for_shorthand
MetadataDecodeContext.prototype.cached_ty_for_shorthand = function (this: MetadataDecodeContext, shorthand: number, or_insert_with: (this_: MetadataDecodeContext) => Ty): Ty {
  const tcx = this.tcx;

  const key = CReaderCacheKey_key({ cnum: this.cdata.cnum, pos: shorthand });

  {
    const ty = tcx.caches.ty_rcache.get(key);
    if (ty !== undefined) {
      return ty;
    }
  }

  const ty = or_insert_with(this);
  tcx.caches.ty_rcache.set(key, ty);
  return ty;
};

/**
 * PORT (lane rmeta-ty): `ty::CReaderCacheKey { cnum: Option<CrateNum>, pos: usize }` (ty/mod.rs:508, derive(Hash, Eq))
 * as the string key of `GlobalCaches.ty_rcache` (a `Map<string, Ty>`, context.ts): `<cnum>:<pos>`, `-` for `None`.
 */
function CReaderCacheKey_key(k: { cnum: CrateNum | undefined; pos: number }): string {
  return `${k.cnum === undefined ? "-" : k.cnum}:${k.pos}`;
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:415 with_position
MetadataDecodeContext.prototype.with_position = function <R>(this: MetadataDecodeContext, pos: number, f: (this_: MetadataDecodeContext) => R): R {
  const new_opaque = this.blob_decoder.opaque.split_at(pos);
  const old_opaque = this.blob_decoder.opaque;
  this.blob_decoder.opaque = new_opaque;
  const old_state = this.blob_decoder.lazy_state;
  this.blob_decoder.lazy_state = LazyState.NoNode;
  const r = f(this);
  this.blob_decoder.opaque = old_opaque;
  this.blob_decoder.lazy_state = old_state;
  return r;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:428 decode_alloc_id
MetadataDecodeContext.prototype.decode_alloc_id = function (this: MetadataDecodeContext): AllocId {
  // let ads = self.alloc_decoding_session;
  // ads.decode_alloc_id(self)
  return unported("rustc_metadata::rmeta::decoder::MetadataDecodeContext::decode_alloc_id (AllocDecodingSession::decode_alloc_id, M3)");
};

// the provided `TyDecoder::positioned_at_shorthand` (ty/codec.rs:55)
MetadataDecodeContext.prototype.positioned_at_shorthand = function (this: MetadataDecodeContext): boolean {
  return TyDecoder_provided.positioned_at_shorthand(this);
};

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

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:464 decode_syntax_context
MetadataDecodeContext.prototype.decode_syntax_context = function (this: MetadataDecodeContext): SyntaxContext {
  const cdata = this.cdata;
  const tcx = this.tcx;

  const cname = cdata.root.name();
  // PORT: `CrateMetadata.hygiene_context` is typed `unknown` by the contract (the header's stand-ins); it is
  // `rustc_span::hygiene::HygieneDecodeContext` (built by `CrateMetadata::new`).
  return hygiene_decode_syntax_context(this, cdata.hygiene_context as HygieneDecodeContext_, (_, id) => {
    // debug!("SpecializedDecoder<SyntaxContext>: decoding {}", id);
    const lazy = cdata.root.syntax_contexts.get(fse_Option_LazyValue, cdata, id) as LazyValue<SyntaxContextKey> | undefined;
    if (lazy === undefined) return panic(`Missing SyntaxContext ${id} for crate ${debug_Symbol(cname, PLAIN)}`);
    return lazy.decode([cdata, tcx], (d): SyntaxContextKey => decode_tuple_(d, decode_SyntaxContext, decode_ExpnId, decode_Transparency));
  });
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:480 decode_expn_id
MetadataDecodeContext.prototype.decode_expn_id = function (this: MetadataDecodeContext): ExpnId {
  const tcx = this.tcx;
  const cnum = decode_CrateNum(this);
  const index = decode_u32(this);

  const expn_id = hygiene_decode_expn_id(cnum, index, (expn_id) => {
    const cnum = expn_id.krate;
    const index = expn_id.local_id;
    // Lookup local `ExpnData`s in our own crate data. Foreign `ExpnData`s
    // are stored in the owning crate, to avoid duplication.
    // debug_assert_ne!(cnum, LOCAL_CRATE);
    let cdata: CrateMetadata;
    if (cnum === this.cdata.cnum) {
      cdata = this.cdata;
    } else {
      const cstore = CStore.from_tcx(tcx);
      cdata = cstore.get_crate_data(cnum);
    }
    const expn_data = unwrap(cdata.root.expn_data.get(fse_Option_LazyValue, cdata, index) as LazyValue<ExpnData> | undefined).decode([cdata, tcx], decode_ExpnData);
    const expn_hash = unwrap(cdata.root.expn_hashes.get(fse_Option_LazyValue, cdata, index) as LazyValue<ExpnHash> | undefined).decode([cdata, tcx], decode_ExpnHash);
    return [expn_data, expn_hash];
  });
  return expn_id;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:504 decode_span
MetadataDecodeContext.prototype.decode_span = function (this: MetadataDecodeContext): Span {
  const start = this.position();
  const tag = new SpanTag(this.peek_byte());
  let data: SpanData_;
  if (tag.kind() === "Indirect") {
    // Skip past the tag we just peek'd.
    this.read_u8();
    // indirect tag lengths are safe to access, since they're (0, 8)
    const bytes_needed = unwrap(tag.length());
    // `let mut total = [0u8; 8]; total[..bytes_needed].copy_from_slice(..); usize::from_le_bytes(total)`
    const bytes = this.read_raw_bytes(bytes_needed);
    let offset_or_position = 0;
    for (let i = bytes_needed - 1; i >= 0; i--) offset_or_position = offset_or_position * 256 + bytes[i]!;
    if (!Number.isSafeInteger(offset_or_position)) return panic(`rustc_metadata: span position ${offset_or_position} is not an exact usize`);
    const position = tag.is_relative_offset() ? start - offset_or_position : offset_or_position;
    data = this.with_position(position, decode_SpanData);
  } else {
    data = decode_SpanData(this);
  }
  return data.span();
};

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

// impl<'a, 'tcx> Decodable<MetadataDecodeContext<'a, 'tcx>> for SpanData
// PORT: returns rustc_span's `SpanData` (the contract's `SpanData` alias is `unknown`).
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:576 decode
export function decode_SpanData(decoder: MetadataDecodeContext): SpanData_ {
  const tag = decode_SpanTag(decoder);
  const ctxt = tag.context() ?? decode_SyntaxContext(decoder);

  if (tag.kind() === "Partial") {
    return Span_.data(Span_.with_ctxt(DUMMY_SP, ctxt));
  }

  // debug_assert!(tag.kind() == SpanKind::Local || tag.kind() == SpanKind::Foreign);

  const lo = decode_BytePos(decoder);
  const len = tag.length() ?? decode_BytePos(decoder);
  const hi = BytePos.add(lo, len);

  const tcx = decoder.tcx;

  // Index of the file in the corresponding crate's list of encoded files.
  const metadata_index = decode_u32(decoder);

  // There are two possibilities here:
  // 1. This is a 'local span', which is located inside a `SourceFile`
  // that came from this crate. In this case, we use the source map data
  // encoded in this crate. This branch should be taken nearly all of the time.
  // 2. This is a 'foreign span', which is located inside a `SourceFile`
  // that came from a *different* crate (some crate upstream of the one
  // whose metadata we're looking at). For example, consider this dependency graph:
  //
  // A -> B -> C
  //
  // Suppose that we're currently compiling crate A, and start deserializing
  // metadata from crate B. When we deserialize a Span from crate B's metadata,
  // there are two possibilities:
  //
  // 1. The span references a file from crate B. This makes it a 'local' span,
  // which means that we can use crate B's serialized source map information.
  // 2. The span references a file from crate C. This makes it a 'foreign' span,
  // which means we need to use Crate *C* (not crate B) to determine the source
  // map information. We only record source map information for a file in the
  // crate that 'owns' it, so deserializing a Span may require us to look at
  // a transitive dependency.
  //
  // When we encode a foreign span, we adjust its 'lo' and 'high' values
  // to be based on the *foreign* crate (e.g. crate C), not the crate
  // we are writing metadata for (e.g. crate B). This allows us to
  // treat the 'local' and 'foreign' cases almost identically during deserialization:
  // we can call `imported_source_file` for the proper crate, and binary search
  // through the returned slice using our span.
  let source_file: ImportedSourceFile;
  if (tag.kind() === "Local") {
    source_file = decoder.cdata.imported_source_file(tcx, metadata_index);
  } else {
    // When we encode a proc-macro crate, all `Span`s should be encoded
    // with `TAG_VALID_SPAN_LOCAL`
    if (decoder.cdata.root.is_proc_macro_crate()) {
      // Decode `CrateNum` as u32 - using `CrateNum::decode` will ICE
      // since we don't have `cnum_map` populated.
      const cnum = decode_u32(decoder);
      return panic(`Decoding of crate ${debug_Symbol(decoder.cdata.root.header.name, PLAIN)} tried to access proc-macro dep ${cnum}`);
    }
    // tag is TAG_VALID_SPAN_FOREIGN, checked by `debug_assert` above
    const cnum = decode_CrateNum(decoder);
    // debug!("SpecializedDecoder<Span>::specialized_decode: loading source files from cnum {:?}", cnum);

    const cstore = CStore.from_tcx(tcx);
    const foreign_cdata = cstore.get_crate_data(cnum);
    source_file = foreign_cdata.imported_source_file(tcx, metadata_index);
  }

  // Make sure our span is well-formed.
  // debug_assert!(lo + source_file.original_start_pos <= source_file.original_end_pos, "Malformed encoded span: lo={:?} ..");

  // Make sure we correctly filtered out invalid spans during encoding.
  // debug_assert!(hi + source_file.original_start_pos <= source_file.original_end_pos, "Malformed encoded span: hi={:?} ..");

  // PORT: `translated_source_file` is rustc_span's `SourceFile` (the contract's alias is `unknown`).
  const translated_start_pos = (source_file.translated_source_file as SourceFile_).start_pos;
  const lo_ = BytePos.add(lo, translated_start_pos);
  const hi_ = BytePos.add(hi, translated_start_pos);

  // Do not try to decode parent for foreign spans (it wasn't encoded in the first place).
  return new SpanData_(lo_, hi_, ctxt, undefined);
}

// impl Decodable for LazyValue / LazyArray / LazyTable (decoder.rs:675..695): in mod.ts (`decode_LazyValue`, ..).

// impl<'a, 'tcx> Decoder for MetadataDecodeContext<'a, 'tcx> { forward_all_decoder_methods_to!(|self| self.blob_decoder.opaque); }
// impl<'a> Decoder for BlobDecodeContext<'a> { forward_all_decoder_methods_to!(|self| self.opaque); }
// PORT (lane rmeta-ty): rustc_middle ty/codec.ts's `forward_all_decoder_methods_to` (the macro, with its markers).
forward_all_decoder_methods_to(BlobDecodeContext.prototype, (self: BlobDecodeContext) => self.opaque);
forward_all_decoder_methods_to(MetadataDecodeContext.prototype, (self: MetadataDecodeContext) => self.blob_decoder.opaque);
for (const Ctx of [BlobDecodeContext, MetadataDecodeContext] as const) {
  const proto = Ctx.prototype as unknown as Record<string, unknown>;
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

      case "features": {
        if ((r = w(out, "=Lib features=\n")).$ === "Err") return r;
        for (const [feature, since] of (root.lib_features as LazyArray<[Symbol, FeatureStability]>).decode(this, (d) =>
          decode_tuple_(d, (d) => d.decode_symbol(), decode_FeatureStability),
        )) {
          if ((r = w(out, `${Symbol.as_str(feature)}${since.$ === "AcceptedSince" ? ` since ${Symbol.as_str(since._0)}` : ""}\n`)).$ === "Err") return r;
        }
        if ((r = w(out, "\n")).$ === "Err") return r;
        break;
      }

      case "items": {
        if ((r = w(out, "=Items=\n")).$ === "Err") return r;

        // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:888 print_item
        const print_item = (blob: MetadataBlob, out: Write, item: DefIndex, indent: number): IoResult<void> => {
          const root = blob.get_root();

          const def_kind = unwrap(root.tables.def_kind.get(fse_Option_DefKind, blob, item));
          const def_key = unwrap(root.tables.def_keys.get(fse_Option_LazyValue, blob, item) as LazyValue<DefKey> | undefined).decode(blob, decode_DefKey);
          // #[allow(rustc::symbol_intern_string_literal)]
          const def_name = item === CRATE_DEF_INDEX ? kw.Crate : (DefPathData.get_opt_name(def_key.disambiguated_data.data) ?? Symbol.intern("???"));
          const visibility = ty_Visibility.map_id(
            unwrap(root.tables.visibility.get(fse_Option_LazyValue, blob, item) as LazyValue<ty_Visibility<LocalDefId>> | undefined).decode(blob, (d) =>
              decode_Visibility(d, (d) => d.decode_local_def_id()),
            ),
            (id) =>
              `crate${DefPath_.make(LOCAL_CRATE, LocalDefId.local_def_index(id), (parent) =>
                unwrap(root.tables.def_keys.get(fse_Option_LazyValue, blob, parent) as LazyValue<DefKey> | undefined).decode(blob, decode_DefKey),
              ).to_string_no_crate_verbose()}`,
          );
          // `write!(out, "{nil: <indent$}{:?} {:?} {} {{", visibility, def_kind, def_name, nil = "")`
          let r: IoResult<void>;
          if ((r = w(out, `${" ".repeat(indent)}${debug_Visibility(visibility, PLAIN, debug_str)} ${debug_DefKind(def_kind, PLAIN)} ${Symbol.as_str(def_name)} {`)).$ === "Err") return r;

          const children = root.tables.module_children_non_reexports.get(fse_Option_LazyArray, blob, item) as LazyArray<LocalDefId> | undefined;
          if (children !== undefined) {
            if ((r = w(out, "\n")).$ === "Err") return r;
            for (const child of children.decode(blob, (d) => d.decode_local_def_id())) {
              if ((r = print_item(blob, out, LocalDefId.local_def_index(child), indent + 4)).$ === "Err") return r;
            }
            if ((r = w(out, `${" ".repeat(indent)}}\n`)).$ === "Err") return r;
          } else {
            if ((r = w(out, "}\n")).$ === "Err") return r;
          }

          return Ok(undefined);
        };

        if ((r = print_item(this, out, CRATE_DEF_INDEX, 0)).$ === "Err") return r;

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

// ---- impl CrateMetadata (decoder.rs:1027) ----
// ---- lane rmeta-decoder-a: decoder.rs:1028..1342 ----

/**
 * PORT: the element `Decodable`s of crate-level arrays whose types have no TS port (or no generated derive) yet. A
 * `LazyArray` decodes its elements only when it has some, so an empty array still decodes (as upstream).
 */
function decode_unported<T = never>(what: string): (d: MetadataDecodeContext) => T {
  return () => unported(`Decodable for ${what}`);
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1028 missing
CrateMetadata.prototype.missing = function (this: CrateMetadata, descr: string, id: DefIndex): never {
  return bug(`missing \`${descr}\` for ${debug_DefId(this.local_def_id(id), PLAIN)}`);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1032 raw_proc_macro
CrateMetadata.prototype.raw_proc_macro = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): [ProcMacroClient, ProcMacroKind] {
  // DefIndex's in root.proc_macro_data have a one-to-one correspondence
  // with items in 'raw_proc_macros'.
  // `.decode((self, tcx)).enumerate().find(|(_pos, (i, _))| i.local_def_index == id).unwrap()`
  let found: [number, LazyValue<ProcMacroKind>] | undefined;
  let pos = 0;
  for (const [i, kind] of unwrap(this.root.proc_macro_data).macros.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_local_def_id(), (d) => d.read_lazy<ProcMacroKind>()))) {
    if (LocalDefId.local_def_index(i) === id) {
      found = [pos, kind];
      break;
    }
    pos++;
  }
  const [pos_, kind] = unwrap(found);
  const raw_proc_macros = unwrap(this.raw_proc_macros);
  if (pos_ >= raw_proc_macros.length) return panic(`index out of bounds: the len is ${raw_proc_macros.length} but the index is ${pos_}`);
  return [raw_proc_macros[pos_], kind.decode([this, tcx], decode_ProcMacroKind)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1048 opt_item_name
CrateMetadata.prototype.opt_item_name = function (this: CrateMetadata, item_index: DefIndex): Symbol | undefined {
  const def_key = this.def_key(item_index);
  const name = DefPathData.get_opt_name(def_key.disambiguated_data.data);
  if (name !== undefined) return name;
  if (def_key.disambiguated_data.data.$ === "Ctor") {
    const parent_index = unwrap(def_key.parent, "no parent for a constructor");
    return DefPathData.get_opt_name(this.def_key(parent_index).disambiguated_data.data);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1060 item_name
CrateMetadata.prototype.item_name = function (this: CrateMetadata, item_index: DefIndex): Symbol {
  return unwrap(this.opt_item_name(item_index), "no encoded ident for item");
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1064 opt_item_ident
CrateMetadata.prototype.opt_item_ident = function (this: CrateMetadata, tcx: TyCtxt, item_index: DefIndex): Ident | undefined {
  const name = this.opt_item_name(item_index);
  if (name === undefined) return undefined;
  const span = ((this.root.tables.def_ident_span.get(fse_Option_LazyValue, this, item_index) as LazyValue<Span> | undefined) ?? this.missing("def_ident_span", item_index)).decode(
    [this, tcx],
    decode_Span,
  );
  return Ident_.new(name, span);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1076 item_ident
CrateMetadata.prototype.item_ident = function (this: CrateMetadata, tcx: TyCtxt, item_index: DefIndex): Ident {
  return unwrap(this.opt_item_ident(tcx, item_index), "no encoded ident for item");
};

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

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1085 def_kind
CrateMetadata.prototype.def_kind = function (this: CrateMetadata, item_id: DefIndex): DefKind {
  return this.root.tables.def_kind.get(fse_Option_DefKind, this, item_id) ?? this.missing("def_kind", item_id);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1093 get_span
CrateMetadata.prototype.get_span = function (this: CrateMetadata, tcx: TyCtxt, index: DefIndex): Span {
  return ((this.root.tables.def_span.get(fse_Option_LazyValue, this, index) as LazyValue<Span> | undefined) ?? this.missing("def_span", index)).decode([this, tcx], decode_Span);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1102 load_proc_macro
CrateMetadata.prototype.load_proc_macro = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): SyntaxExtension {
  // PORT: `ProcMacroClient` (rustc_proc_macro bridge `Client`, M6) is `unknown` here; the expanders take their
  // client types.
  type DeriveClient = ConstructorParameters<typeof expand_proc_macro.DeriveProcMacro>[0];
  type AttrClient = ConstructorParameters<typeof expand_proc_macro.AttrProcMacro>[0];
  type BangClient = ConstructorParameters<typeof expand_proc_macro.BangProcMacro>[0];
  let name: string;
  let kind: SyntaxExtensionKind;
  let helper_attrs: Symbol[];
  const [client, pm_kind] = this.raw_proc_macro(tcx, id);
  switch (pm_kind.$) {
    case "CustomDerive": {
      const { trait_name, attributes } = pm_kind;
      helper_attrs = attributes.map((attr) => Symbol.intern(attr));
      [name, kind] = [trait_name, { $: "Derive", _0: new expand_proc_macro.DeriveProcMacro(client as DeriveClient) }];
      break;
    }
    case "Attr": {
      [name, kind, helper_attrs] = [pm_kind.name, { $: "Attr", _0: new expand_proc_macro.AttrProcMacro(client as AttrClient) }, []];
      break;
    }
    case "Bang": {
      [name, kind, helper_attrs] = [pm_kind.name, { $: "Bang", _0: new expand_proc_macro.BangProcMacro(client as BangClient) }, []];
      break;
    }
  }

  const sess = tcx.sess;
  const attrs: Attribute[] = [...this.get_item_attrs(tcx, id)];
  return SyntaxExtension_.new(sess, kind, this.get_span(tcx, id), helper_attrs, this.root.edition, Symbol.intern(name), attrs, false);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1135 get_variant
CrateMetadata.prototype.get_variant = function (this: CrateMetadata, tcx: TyCtxt, kind: DefKind, index: DefIndex, parent_did: DefId): [VariantIdx, VariantDef] {
  let adt_kind: AdtKind;
  switch (kind.$) {
    case "Variant":
      adt_kind = "Enum";
      break;
    case "Struct":
      adt_kind = "Struct";
      break;
    case "Union":
      adt_kind = "Union";
      break;
    default:
      return bug();
  }

  const data = unwrap(this.root.tables.variant_data.get(fse_Option_LazyValue, this, index) as LazyValue<VariantData> | undefined).decode([this, tcx], decode_VariantData);

  const variant_did = adt_kind === "Enum" ? this.local_def_id(index) : undefined;
  const ctor: [CtorKind, DefId] | undefined = data.ctor === undefined ? undefined : [data.ctor[0], this.local_def_id(LocalDefId.local_def_index(data.ctor[1]))];

  return [
    data.idx,
    VariantDef.new(
      this.item_name(index),
      variant_did,
      ctor,
      data.discr,
      [...this.get_associated_item_or_field_def_ids(tcx, index)].map(
        (did): FieldDef =>
          new FieldDef(
            did,
            this.item_name(did.index),
            this.get_visibility(tcx, did.index),
            this.get_mut_restriction(tcx, did.index),
            this.get_safety(did.index),
            this.get_default_field(tcx, did.index),
          ),
      ),
      parent_did,
      undefined,
      data.is_non_exhaustive,
    ),
  ];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1179 get_adt_def
CrateMetadata.prototype.get_adt_def = function (this: CrateMetadata, tcx: TyCtxt, item_id: DefIndex): AdtDef {
  const kind = this.def_kind(item_id);
  const did = this.local_def_id(item_id);

  let adt_kind: AdtKind;
  switch (kind.$) {
    case "Enum":
      adt_kind = "Enum";
      break;
    case "Struct":
      adt_kind = "Struct";
      break;
    case "Union":
      adt_kind = "Union";
      break;
    default:
      return bug(`get_adt_def called on a non-ADT ${debug_DefId(did, PLAIN)}`);
  }
  const repr = unwrap(this.root.tables.repr_options.get(fse_Option_LazyValue, this, item_id) as LazyValue<ReprOptions> | undefined).decode([this, tcx], decode_ReprOptions);

  const variants: [VariantIdx, VariantDef][] = [];
  if (adt_kind === "Enum") {
    const children = unwrap(this.root.tables.module_children_non_reexports.get(fse_Option_LazyArray, this, item_id) as LazyArray<LocalDefId> | undefined, "variants are not encoded for an enum");
    for (const id of children.decode([this, tcx], (d) => d.decode_local_def_id())) {
      const index = LocalDefId.local_def_index(id);
      const kind = this.def_kind(index);
      switch (kind.$) {
        case "Ctor":
          break;
        default:
          variants.push(this.get_variant(tcx, kind, index, did));
      }
    }
  } else {
    variants.push(this.get_variant(tcx, kind, item_id, did));
  }

  // PORT: `sort_by_key` is stable, as `Array.prototype.sort`.
  variants.sort(([a], [b]) => a - b);

  return tcx.mk_adt_def(
    did,
    adt_kind,
    variants.map(([_, variant]) => variant),
    repr,
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1221 get_visibility
CrateMetadata.prototype.get_visibility = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): Visibility<ModId> {
  const lazy = (this.root.tables.visibility.get(fse_Option_LazyValue, this, id) as LazyValue<Visibility<LocalDefId>> | undefined) ?? this.missing("visibility", id);
  return ty_Visibility.map_id(
    lazy.decode([this, tcx], (d) => decode_Visibility(d, (d) => d.decode_local_def_id())),
    (id) => ModId_.new_unchecked(this.local_def_id(LocalDefId.local_def_index(id))),
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1231 get_mut_restriction
CrateMetadata.prototype.get_mut_restriction = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): RestrictionKind {
  const lazy = (this.root.tables.mut_restriction.get(fse_Option_LazyValue, this, id) as LazyValue<RestrictionKind> | undefined) ?? this.missing("mut_restriction", id);
  return lazy.decode([this, tcx], decode_RestrictionKind);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1240 get_safety
CrateMetadata.prototype.get_safety = function (this: CrateMetadata, id: DefIndex): Safety {
  return this.root.tables.safety.get(fse_Safety, this, id);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1244 get_default_field
CrateMetadata.prototype.get_default_field = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): DefId | undefined {
  const d = this.root.tables.default_fields.get(fse_Option_LazyValue, this, id) as LazyValue<DefId> | undefined;
  return d === undefined ? undefined : d.decode([this, tcx], decode_DefId);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1248 get_expn_that_defined
CrateMetadata.prototype.get_expn_that_defined = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): ExpnId {
  return ((this.root.tables.expn_that_defined.get(fse_Option_LazyValue, this, id) as LazyValue<ExpnId> | undefined) ?? this.missing("expn_that_defined", id)).decode(
    [this, tcx],
    decode_ExpnId,
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1257 get_debugger_visualizers
CrateMetadata.prototype.get_debugger_visualizers = function (this: CrateMetadata, tcx: TyCtxt): unknown[] {
  return [...this.root.debugger_visualizers.decode([this, tcx], decode_unported("rustc_span::DebuggerVisualizerFile"))];
};

/// Iterates over all the stability attributes in the given crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1262 get_lib_features
CrateMetadata.prototype.get_lib_features = function (this: CrateMetadata, tcx: TyCtxt): unknown {
  // PORT: `LibFeatures { stability: UnordMap<Symbol, (FeatureStability, Span)> }` (rustc_middle lib_features.rs, not
  // ported): a record with that field.
  return {
    stability: new Map(
      [...this.root.lib_features.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_symbol(), decode_FeatureStability))].map(
        ([sym, stab]): [Symbol, [unknown, Span]] => [sym, [stab, DUMMY_SP]],
      ),
    ),
  };
};

/// Iterates over the stability implications in the given crate (when a `#[unstable]` attribute
/// has an `implied_by` meta item, then the mapping from the implied feature to the actual
/// feature is a stability implication).
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1276 get_stability_implications
CrateMetadata.prototype.get_stability_implications = function (this: CrateMetadata, tcx: TyCtxt): [Symbol, Symbol][] {
  return [...this.root.stability_implications.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_symbol(), (d) => d.decode_symbol()))];
};

/// Iterates over the lang items in the given crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1281 get_lang_items
CrateMetadata.prototype.get_lang_items = function (this: CrateMetadata, tcx: TyCtxt): [DefId, LangItem][] {
  return [
    ...(this.root.lang_items as LazyArray<[LocalDefId, LangItem]>).decode([this, tcx], (d) =>
      decode_tuple_(d, (d) => d.decode_local_def_id(), decode_LangItem),
    ),
  ].map(([id, index]): [DefId, LangItem] => [this.local_def_id(LocalDefId.local_def_index(id)), index]);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1290 get_stripped_cfg_items
CrateMetadata.prototype.get_stripped_cfg_items = function (this: CrateMetadata, tcx: TyCtxt, cnum: CrateNum): unknown[] {
  const item_names = [...(this.root.stripped_cfg_items as LazyArray<StrippedCfgItem<LocalDefId>>).decode([this, tcx], (d) => decode_StrippedCfgItem(d, (d) => d.decode_local_def_id()))].map(
    (item) => item.map_scope_id((id) => new DefId(LocalDefId.local_def_index(id), cnum)),
  );

  return item_names;
};

/// Iterates over the diagnostic items in the given crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1304 get_diagnostic_items
CrateMetadata.prototype.get_diagnostic_items = function (this: CrateMetadata, tcx: TyCtxt): DiagnosticItems {
  // PORT: `DefIdMap` (an `UnordMap` keyed by `DefId`) is rustc_span's `DefIdMap` (D5; also the generated field type
  // since merge-w15b), so `get_diagnostic_name` finds extern items by value (merge-w15a).
  const id_to_name = new DefIdMap<Symbol>();
  const name_to_id = new Map<Symbol, DefId>();
  for (const [name, id0] of this.root.diagnostic_items.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_symbol(), (d) => d.decode_local_def_id()))) {
    const id = this.local_def_id(LocalDefId.local_def_index(id0));
    id_to_name.set(id, name);
    name_to_id.set(name, id);
  }
  return { id_to_name, name_to_id };
};

/// Iterates over the canonical_symbols in the given crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1320 get_canonical_symbols
CrateMetadata.prototype.get_canonical_symbols = function (this: CrateMetadata, tcx: TyCtxt): CanonicalSymbols {
  const canonical_symbols = CanonicalSymbols.new();

  for (const [name, id0] of this.root.canonical_symbols.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_symbol(), (d) => d.decode_local_def_id()))) {
    const id = this.local_def_id(LocalDefId.local_def_index(id0));
    void canonical_symbols.set(name, id);
  }

  return canonical_symbols;
};

/// Iterates over the fake_doc_items in the given crate.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1332 get_fake_doc_items
CrateMetadata.prototype.get_fake_doc_items = function (this: CrateMetadata, tcx: TyCtxt): DefId[] {
  const fake_doc_items: DefId[] = [];

  for (const id0 of this.root.fake_doc_items.decode([this, tcx], (d) => d.decode_local_def_id())) {
    const id = this.local_def_id(LocalDefId.local_def_index(id0));
    fake_doc_items.push(id);
  }

  return fake_doc_items;
};

// ---- end rmeta-decoder-a ----

// ---- lane rmeta-decoder-b: decoder.rs:1343..2035 ----

// PORT: element types whose `Decodable` impl has no TS port yet. Each is the `T::decode` a `LazyValue<T>` /
// `LazyArray<T>` / `LazyTable` element of this region needs; it stops as UNPORTED naming the impl, so a crate
// load reaching it stops there (no guessed values). They become imports once their crates generate them.
/** `<SimplifiedType<DefId> as Decodable<DecodeContext>>::decode`: the generated derive(Decodable_NoContext) at `DefId`. */
function decode_SimplifiedType(d: MetadataDecodeContext): SimplifiedType {
  return decode_SimplifiedType_(d, decode_DefId);
}
/** `#[derive(Decodable)]` of `rustc_crate_store::NativeLib`. */
function decode_NativeLib(_d: MetadataDecodeContext): NativeLib {
  return unported("Decodable for rustc_crate_store::NativeLib (derive(Decodable) not generated)");
}
/** `#[derive(Decodable)]` of `rustc_crate_store::ForeignModule`. */
function decode_ForeignModule(_d: MetadataDecodeContext): ForeignModule {
  return unported("Decodable for rustc_crate_store::ForeignModule (derive(Decodable) not generated)");
}
/** `Decodable` of `EiiMapEncodedKeyValue` (rmeta encoder.rs type alias of a tuple; `EiiDecl` / `EiiImpl`). */
function decode_EiiMapEncodedKeyValue(_d: MetadataDecodeContext): unknown {
  return unported("Decodable for rustc_metadata::rmeta::EiiMapEncodedKeyValue (rustc_attr_ir EiiDecl/EiiImpl, derive(Decodable) not generated)");
}
/** `Decodable` of `(ExportedSymbol<'tcx>, SymbolExportInfo)` (rustc_middle middle/exported_symbols.rs, M3). */
function decode_ExportedSymbol_SymbolExportInfo(_d: MetadataDecodeContext): unknown {
  return unported("Decodable for (rustc_middle::middle::exported_symbols::ExportedSymbol, SymbolExportInfo) (M3)");
}
/** `Decodable` of `rustc_middle::ty::IntrinsicDef` (M3). */
function decode_IntrinsicDef(_d: MetadataDecodeContext): unknown {
  return unported("Decodable for rustc_middle::ty::IntrinsicDef (M3)");
}
/** `Decodable` of `DocLinkResMap` (`UnordMap<(Symbol, Namespace), Option<Res<NodeId>>>`). */
function decode_DocLinkResMap(_d: MetadataDecodeContext): DocLinkResMap {
  return unported("Decodable for rustc_hir::def::DocLinkResMap (derive(Decodable) of Res / Namespace not generated)");
}

/** `Iterator::map` over an iterator that is already created (the `.decode(..)` ran eagerly, as upstream). */
function* iter_map<T, U>(it: Iterable<T>, f: (t: T) => U): Generator<U, void, undefined> {
  for (const x of it) yield f(x);
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1343 get_mod_child
CrateMetadata.prototype.get_mod_child = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): ModChild {
  const ident = this.item_ident(tcx, id);
  const res: Res<never> = { $: "Def", _0: this.def_kind(id), _1: this.local_def_id(id) };
  const vis = this.get_visibility(tcx, id);

  return { ident, res, vis, reexport_chain: [] };
};

/// Iterates over all named children of the given module,
/// including both proper items and reexports.
/// Module here is understood in name resolution sense - it can be a `mod` item,
/// or a crate root, or an enum, or a trait.
///
/// # Panics
///
/// May panic if the provided `id` does not refer to a module.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1359 get_module_children
CrateMetadata.prototype.get_module_children = function* (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): Iterable<ModChild> {
  const data = this.root.proc_macro_data;
  if (data !== undefined) {
    // If we are loading as a proc macro, we want to return
    // the view of this crate as a proc macro crate.
    if (id === CRATE_DEF_INDEX) {
      for (const [child_index, _] of data.macros.decode([this, tcx], (d) => decode_tuple_(d, (d) => d.decode_local_def_id(), (d) => d.read_lazy<ProcMacroKind>()))) {
        yield this.get_mod_child(tcx, LocalDefId.local_def_index(child_index));
      }
    }
  } else {
    // Iterate over all children.
    const non_reexports_ = this.root.tables.module_children_non_reexports.get(fse_Option_LazyArray, this, id);
    if (non_reexports_ === undefined) return panic("provided `DefIndex` must refer to a module-like item");
    const non_reexports = non_reexports_ as LazyArray<LocalDefId>;
    for (const child_index of non_reexports.decode([this, tcx], (d) => d.decode_local_def_id())) {
      yield this.get_mod_child(tcx, LocalDefId.local_def_index(child_index));
    }

    const reexports = this.root.tables.module_children_reexports.get(fse_LazyArray, this, id) as LazyArray<ModChild>;
    if (!is_default_LazyArray(reexports)) {
      for (const reexport of reexports.decode([this, tcx], decode_ModChild)) {
        yield reexport;
      }
    }
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1388 get_ambig_module_children
CrateMetadata.prototype.get_ambig_module_children = function* (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): Iterable<AmbigModChild> {
  const children = this.root.tables.ambig_module_children.get(fse_LazyArray, this, id) as LazyArray<AmbigModChild>;
  if (!is_default_LazyArray(children)) {
    for (const child of children.decode([this, tcx], decode_AmbigModChild)) {
      yield child;
    }
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1403 is_item_mir_available
CrateMetadata.prototype.is_item_mir_available = function (this: CrateMetadata, id: DefIndex): boolean {
  return this.root.tables.optimized_mir.get(fse_Option_LazyValue, this, id) !== undefined;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1407 get_fn_has_self_parameter
CrateMetadata.prototype.get_fn_has_self_parameter = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): boolean {
  const idents = this.root.tables.fn_arg_idents.get(fse_Option_LazyArray, this, id) as LazyArray<Ident | undefined> | undefined;
  if (idents === undefined) return panic("argument names not encoded for a function");
  // `.nth(0).is_some_and(|ident| matches!(ident, Some(Ident { name: kw::SelfLower, .. })))`
  const first = idents.decode([this, tcx], (d) => decode_Option_(d, decode_Ident)).next();
  if (first.done) return false;
  const ident = first.value;
  return ident !== undefined && ident.name === kw.SelfLower;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1418 get_associated_item_or_field_def_ids
CrateMetadata.prototype.get_associated_item_or_field_def_ids = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): Iterable<DefId> {
  let ids = this.root.tables.associated_item_or_field_def_ids.get(fse_Option_LazyArray, this, id) as LazyArray<LocalDefId> | undefined;
  if (ids === undefined) ids = this.missing("associated_item_or_field_def_ids", id);
  return iter_map(
    ids.decode([this, tcx], (d) => d.decode_local_def_id()),
    (id) => this.local_def_id(LocalDefId.local_def_index(id)),
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1432 get_associated_item
CrateMetadata.prototype.get_associated_item = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): AssocItem {
  let kind: AssocKind;
  switch (this.def_kind(id).$) {
    case "AssocConst":
      kind = { $: "Const", name: this.item_name(id) };
      break;
    case "AssocFn":
      kind = {
        $: "Fn",
        name: this.item_name(id),
        has_self: this.get_fn_has_self_parameter(tcx, id),
      };
      break;
    case "AssocTy": {
      let data: AssocTypeData;
      const rpitit_info = this.root.tables.opt_rpitit_info.get(fse_Option_LazyValue, this, id) as LazyValue<ImplTraitInTraitData> | undefined;
      if (rpitit_info !== undefined) {
        data = { $: "Rpitit", _0: rpitit_info.decode([this, tcx], decode_ImplTraitInTraitData) };
      } else {
        data = { $: "Normal", _0: this.item_name(id) };
      }
      kind = { $: "Type", data };
      break;
    }
    default:
      return bug(`cannot get associated-item of \`${debug_DefKey(this.def_key(id), PLAIN)}\``);
  }
  const container = unwrap(this.root.tables.assoc_container.get(fse_Option_LazyValue, this, id) as LazyValue<AssocContainer> | undefined).decode([this, tcx], decode_AssocContainer);

  return { kind, def_id: this.local_def_id(id), container };
};


// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1455 get_ctor
CrateMetadata.prototype.get_ctor = function (this: CrateMetadata, tcx: TyCtxt, node_id: DefIndex): [CtorKind, DefId] | undefined {
  const kind = this.def_kind(node_id);
  switch (kind.$) {
    case "Struct":
    case "Variant": {
      const lazy = this.root.tables.variant_data.get(fse_Option_LazyValue, this, node_id);
      if (lazy === undefined) return panic("called `Option::unwrap()` on a `None` value");
      const vdata = lazy.decode([this, tcx], decode_VariantData);
      if (vdata.ctor === undefined) return undefined;
      const [ctor_kind, id] = vdata.ctor;
      return [ctor_kind, this.local_def_id(LocalDefId.local_def_index(id))];
    }
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1466 get_item_attrs
CrateMetadata.prototype.get_item_attrs = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): Iterable<Attribute> {
  let attrs = this.root.tables.attributes.get(fse_Option_LazyArray, this, id) as LazyArray<Attribute> | undefined;
  if (attrs === undefined) {
    const def_key = this.def_key(id);
    switch (def_key.disambiguated_data.data.$) {
      case "Ctor": {
        // Structure and variant constructors don't have any attributes encoded for them,
        // but we assume that someone passing a constructor ID actually wants to look at
        // the attributes on the corresponding struct or variant.
        const parent_id = def_key.parent;
        if (parent_id === undefined) return panic("no parent for a constructor");
        const parent_attrs = this.root.tables.attributes.get(fse_Option_LazyArray, this, parent_id) as LazyArray<Attribute> | undefined;
        if (parent_attrs === undefined) return panic("no encoded attributes for a structure or variant");
        attrs = parent_attrs;
        break;
      }
      case "SyntheticCoroutineBody":
        // SyntheticCoroutineBodies cannot have attributes
        attrs = LazyArray.default<Attribute>();
        break;
      default:
        return panic(
          `Definition key ${debug_DefKey(def_key, PLAIN)} of type \`${debug_DefPathData(def_key.disambiguated_data.data, PLAIN)}\` did not have any attributes stored`,
        );
    }
  }
  return attrs.decode([this, tcx], decode_Attribute);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1499 get_inherent_implementations_for_type
CrateMetadata.prototype.get_inherent_implementations_for_type = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): DefId[] {
  // `tcx.arena.alloc_from_iter(..)`
  const out: DefId[] = [];
  const impls = this.root.tables.inherent_impls.get(fse_LazyArray, this, id) as LazyArray<LocalDefId>;
  for (const id_ of impls.decode([this, tcx], (d) => d.decode_local_def_id())) {
    out.push(this.local_def_id(LocalDefId.local_def_index(id_)));
  }
  return out;
};

/// Decodes all traits in the crate (for rustdoc and rustc diagnostics).
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1515 get_traits
CrateMetadata.prototype.get_traits = function (this: CrateMetadata, tcx: TyCtxt): Iterable<DefId> {
  return iter_map(
    this.root.traits.decode([this, tcx], (d) => d.decode_local_def_id()),
    (id) => this.local_def_id(LocalDefId.local_def_index(id)),
  );
};

/// Decodes all trait impls in the crate (for rustdoc).
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1520 get_trait_impls
CrateMetadata.prototype.get_trait_impls = function* (this: CrateMetadata, tcx: TyCtxt): Iterable<DefId> {
  for (const impls of this.trait_impls.values()) {
    for (const [id, _] of impls.decode([this, tcx], decode_LocalDefId_Option_SimplifiedType)) {
      yield this.local_def_id(LocalDefId.local_def_index(id));
    }
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1526 get_incoherent_impls
CrateMetadata.prototype.get_incoherent_impls = function (this: CrateMetadata, tcx: TyCtxt, simp: SimplifiedType): DefId[] {
  const impls = this.incoherent_impls.get(simp);
  if (impls !== undefined) {
    const out: DefId[] = [];
    for (const id of impls.decode([this, tcx], (d) => d.decode_local_def_id())) {
      out.push(this.local_def_id(LocalDefId.local_def_index(id)));
    }
    return out;
  } else {
    return [];
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1536 get_implementations_of_trait
CrateMetadata.prototype.get_implementations_of_trait = function (this: CrateMetadata, tcx: TyCtxt, trait_def_id: DefId): [DefId, SimplifiedType | undefined][] {
  if (this.trait_impls.size === 0) {
    return [];
  }

  // Do a reverse lookup beforehand to avoid touching the crate_num
  // hash map in the loop below.
  const key = this.reverse_translate_def_id(trait_def_id);
  if (key === undefined) return [];

  const impls = this.trait_impls.get(key);
  if (impls !== undefined) {
    const out: [DefId, SimplifiedType | undefined][] = [];
    for (const [id, simplified_self_ty] of impls.decode([this, tcx], decode_LocalDefId_Option_SimplifiedType)) {
      out.push([this.local_def_id(LocalDefId.local_def_index(id)), simplified_self_ty]);
    }
    return out;
  } else {
    return [];
  }
};

/** `<(LocalDefId, Option<SimplifiedType>)>::decode` (the elements of `TraitImpls::impls`). */
function decode_LocalDefId_Option_SimplifiedType(d: MetadataDecodeContext): [LocalDefId, SimplifiedType | undefined] {
  return decode_tuple_<[LocalDefId, SimplifiedType | undefined], MetadataDecodeContext>(
    d,
    (d) => d.decode_local_def_id(),
    (d) => decode_Option_(d, decode_SimplifiedType),
  );
}

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1561 get_native_libraries
CrateMetadata.prototype.get_native_libraries = function (this: CrateMetadata, tcx: TyCtxt): Iterable<NativeLib> {
  return (this.root.native_libraries as LazyArray<NativeLib>).decode([this, tcx], decode_NativeLib);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1565 get_proc_macro_quoted_span
CrateMetadata.prototype.get_proc_macro_quoted_span = function (this: CrateMetadata, tcx: TyCtxt, index: number): Span {
  const data = this.root.proc_macro_data;
  if (data === undefined) return panic("missing proc macro data");
  const lazy = data.proc_macro_quoted_spans.get(fse_Option_LazyValue, this, index) as LazyValue<Span> | undefined;
  if (lazy === undefined) return panic(`missing proc macro quoted span: ${index}`);
  return lazy.decode([this, tcx], (d) => d.decode_span());
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1576 get_foreign_modules
CrateMetadata.prototype.get_foreign_modules = function (this: CrateMetadata, tcx: TyCtxt): Iterable<ForeignModule> {
  return (this.root.foreign_modules as LazyArray<ForeignModule>).decode([this, tcx], decode_ForeignModule);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1580 get_dylib_dependency_formats
CrateMetadata.prototype.get_dylib_dependency_formats = function (this: CrateMetadata, tcx: TyCtxt): [CrateNum, LinkagePreference][] {
  // `tcx.arena.alloc_from_iter(..enumerate().flat_map(..))`
  const out: [CrateNum, LinkagePreference][] = [];
  let i = 0;
  for (const link of (this.root.dylib_dependency_formats as LazyArray<LinkagePreference | undefined>).decode([this, tcx], (d) =>
    decode_Option_(d, (d) => decode_LinkagePreference_(d)),
  )) {
    const cnum = CrateNum.new(i + 1); // We skipped LOCAL_CRATE when encoding
    if (link !== undefined) {
      const c = this.cnum_map[CrateNum.as_usize(cnum)];
      if (c === undefined) return panic(`index out of bounds: the len is ${this.cnum_map.length} but the index is ${CrateNum.as_usize(cnum)}`);
      out.push([c, link]);
    }
    i++;
  }
  return out;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1594 get_externally_implementable_items
CrateMetadata.prototype.get_externally_implementable_items = function (this: CrateMetadata, tcx: TyCtxt): Iterable<unknown> {
  return this.root.externally_implementable_items.decode([this, tcx], decode_EiiMapEncodedKeyValue);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1601 get_missing_lang_items
CrateMetadata.prototype.get_missing_lang_items = function (this: CrateMetadata, tcx: TyCtxt): LangItem[] {
  return [...(this.root.lang_items_missing as LazyArray<LangItem>).decode([this, tcx], decode_LangItem)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1605 get_exportable_items
CrateMetadata.prototype.get_exportable_items = function (this: CrateMetadata, tcx: TyCtxt): Iterable<DefId> {
  return iter_map(
    this.root.exportable_items.decode([this, tcx], (d) => d.decode_local_def_id()),
    (id) => this.local_def_id(LocalDefId.local_def_index(id)),
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1612 get_stable_order_of_exportable_impls
CrateMetadata.prototype.get_stable_order_of_exportable_impls = function (this: CrateMetadata, tcx: TyCtxt): Iterable<[DefId, number]> {
  return iter_map(
    this.root.stable_order_of_exportable_impls.decode([this, tcx], (d) =>
      decode_tuple_<[LocalDefId, number], MetadataDecodeContext>(d, (d) => d.decode_local_def_id(), (d) => d.read_usize()),
    ),
    (v): [DefId, number] => [this.local_def_id(LocalDefId.local_def_index(v[0])), v[1]],
  );
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1622 exported_non_generic_symbols
CrateMetadata.prototype.exported_non_generic_symbols = function (this: CrateMetadata, tcx: TyCtxt): unknown[] {
  return [...this.root.exported_non_generic_symbols.decode([this, tcx], decode_ExportedSymbol_SymbolExportInfo)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1629 exported_generic_symbols
CrateMetadata.prototype.exported_generic_symbols = function (this: CrateMetadata, tcx: TyCtxt): unknown[] {
  return [...this.root.exported_generic_symbols.decode([this, tcx], decode_ExportedSymbol_SymbolExportInfo)];
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1636 get_macro
CrateMetadata.prototype.get_macro = function (this: CrateMetadata, tcx: TyCtxt, id: DefIndex): MacroDef {
  const kind = this.def_kind(id);
  switch (kind.$) {
    case "Macro": {
      const macro_rules = this.root.tables.is_macro_rules.get(fse_bool, this, id);
      const lazy = this.root.tables.macro_definition.get(fse_Option_LazyValue, this, id) as LazyValue<DelimArgs> | undefined;
      if (lazy === undefined) return panic("called `Option::unwrap()` on a `None` value");
      const body = lazy.decode([this, tcx], decode_DelimArgs);
      return { macro_rules, body, eii_declaration: undefined };
    }
    default:
      // `bug!()`
      return bug("impossible case reached");
  }
};

// #[inline]
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1649 def_key
CrateMetadata.prototype.def_key = function (this: CrateMetadata, index: DefIndex): DefKey {
  // `*self.def_key_cache.lock().entry(index).or_insert_with(|| ..)`
  let key = this.def_key_cache.get(index);
  if (key === undefined) {
    const lazy = this.root.tables.def_keys.get(fse_Option_LazyValue, this.blob_, index) as LazyValue<DefKey> | undefined;
    if (lazy === undefined) return panic("called `Option::unwrap()` on a `None` value");
    key = lazy.decode(this.blob_, decode_DefKey);
    this.def_key_cache.set(index, key);
  }
  return clone_DefKey(key);
};

// Returns the path leading to the thing with this `id`.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1656 def_path
CrateMetadata.prototype.def_path = function (this: CrateMetadata, id: DefIndex): DefPath {
  // debug!("def_path(cnum={:?}, id={:?})", self.cnum, id);
  return DefPath_.make(this.cnum, id, (parent) => this.def_key(parent));
};

// #[inline]
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1662 def_path_hash
CrateMetadata.prototype.def_path_hash = function (this: CrateMetadata, index: DefIndex): DefPathHash {
  // This is a hack to workaround the fact that we can't easily encode/decode a Hash64
  // into the FixedSizeEncoding, as Hash64 lacks a Default impl. A future refactor to
  // relax the Default restriction will likely fix this.
  const fingerprint = Fingerprint.new(StableCrateId_.as_u64(this.root.stable_crate_id_), this.root.tables.def_path_hashes.get(fse_u64, this.blob_, index));
  return DefPathHash_.new(this.root.stable_crate_id_, Fingerprint.split(fingerprint)[1]);
};

// #[inline]
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1674 def_path_hash_to_def_index
CrateMetadata.prototype.def_path_hash_to_def_index = function (this: CrateMetadata, hash: DefPathHash): DefIndex | undefined {
  return DefPathHashMapRef_.def_path_hash_to_def_index(this.def_path_hash_map, hash);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1678 expn_hash_to_expn_id
CrateMetadata.prototype.expn_hash_to_expn_id = function (this: CrateMetadata, tcx: TyCtxt, index_guess_: number, hash: ExpnHash): ExpnId {
  const index_guess = ExpnIndex.from_u32(index_guess_);
  const old_lazy = this.root.expn_hashes.get(fse_Option_LazyValue, this, index_guess) as LazyValue<ExpnHash> | undefined;
  const old_hash = old_lazy === undefined ? undefined : old_lazy.decode([this, tcx], decode_ExpnHash);

  let index: ExpnIndex;
  if (old_hash !== undefined && old_hash === hash) {
    // Fast path: the expn and its index is unchanged from the
    // previous compilation session. There is no need to decode anything
    // else.
    index = index_guess;
  } else {
    // Slow path: We need to find out the new `DefIndex` of the provided
    // `DefPathHash`, if its still exists. This requires decoding every `DefPathHash`
    // stored in this crate.
    // `self.expn_hash_map.get_or_init(|| ..)`
    let map = this.expn_hash_map;
    if (map === undefined) {
      const end_id = this.root.expn_hashes.size();
      const m = new Map<ExpnHash, ExpnIndex>();
      for (let i_ = 0; i_ < end_id; i_++) {
        const i = ExpnIndex.from_u32(i_);
        const h = this.root.expn_hashes.get(fse_Option_LazyValue, this, i) as LazyValue<ExpnHash> | undefined;
        if (h !== undefined) {
          m.set(h.decode([this, tcx], decode_ExpnHash), i);
        }
      }
      map = this.expn_hash_map = m;
    }
    // `map[&hash]`
    const found = map.get(hash);
    if (found === undefined) return panic("no entry found for key");
    index = found;
  }

  const lazy = this.root.expn_data.get(fse_Option_LazyValue, this, index) as LazyValue<ExpnData> | undefined;
  if (lazy === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const data = lazy.decode([this, tcx], decode_ExpnData);
  return register_expn_id(this.cnum, index, data, hash);
};

/// Imports the source_map from an external crate into the source_map of the crate
/// currently being compiled (the "local crate").
///
/// The import algorithm works analogous to how AST items are inlined from an
/// external crate's metadata:
/// For every SourceFile in the external source_map an 'inline' copy is created in the
/// local source_map. The correspondence relation between external and local
/// SourceFiles is recorded in the `ImportedSourceFile` objects returned from this
/// function. When an item from an external crate is later inlined into this
/// crate, this correspondence information is used to translate the span
/// information of the inlined item so that it refers the correct positions in
/// the local source_map (see `<decoder::DecodeContext as SpecializedDecoder<Span>>`).
///
/// The import algorithm in the function below will reuse SourceFiles already
/// existing in the local source_map. For example, even if the SourceFile of some
/// source file of libstd gets imported many times, there will only ever be
/// one SourceFile object for the corresponding file in the local source_map.
///
/// Note that imported SourceFiles do not actually contain the source code of the
/// file they represent, just information about length, line breaks, and
/// multibyte characters. This information is enough to generate valid debuginfo
/// for items inlined from other crates.
///
/// Proc macro crates don't currently export spans, so this function does not have
/// to work for them.
// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1736 imported_source_file
CrateMetadata.prototype.imported_source_file = function (this: CrateMetadata, tcx: TyCtxt, source_file_index: number): ImportedSourceFile {
  // rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1737 filter
  function filter(tcx: TyCtxt, real_source_base_dir: PathBuf | undefined, path: PathBuf | undefined): PathBuf | undefined {
    // `path.filter(|_| ..).filter(|virtual_dir| ..)`
    if (path === undefined) return undefined;
    if (
      !(
        // Only spend time on further checks if we have what to translate *to*.
        (
          real_source_base_dir !== undefined &&
          // Some tests need the translation to be always skipped.
          tcx.sess.opts.unstable_opts.translate_remapped_path_to_local_path
        )
      )
    ) {
      return undefined;
    }
    const virtual_dir = path;
    // Don't translate away `/rustc/$hash` if we're still remapping to it,
    // since that means we're still building `std`/`rustc` that need it,
    // and we don't want the real path to leak into codegen/debuginfo.
    if (tcx.sess.opts.remap_path_prefix.some(([_from, to]) => path_eq(to, virtual_dir))) {
      return undefined;
    }
    return path;
  }

  const try_to_translate_virtual_to_real = (
    virtual_source_base_dir: string | undefined,
    real_source_base_dir: PathBuf | undefined,
    name: { value: FileName },
  ): void => {
    const virtual_source_base_dir_ = [
      filter(tcx, real_source_base_dir, virtual_source_base_dir),
      filter(tcx, real_source_base_dir, tcx.sess.opts.unstable_opts.simulate_remapped_rust_src_base),
    ];

    // debug!(
    //     "try_to_translate_virtual_to_real(name={:?}): \
    //      virtual_source_base_dir={:?}, real_source_base_dir={:?}",
    //     name, virtual_source_base_dir, real_source_base_dir,
    // );

    for (const virtual_dir of virtual_source_base_dir_) {
      if (virtual_dir === undefined) continue;
      const real_dir = real_source_base_dir;
      if (real_dir === undefined) continue;
      const n = name.value;
      if (n.$ !== "Real") continue;
      const old_name = n._0;
      const virtual_path = old_name.path(RemapPathScopeComponents.MACRO);
      const rest = path_strip_prefix(virtual_path, virtual_dir);
      if (rest === undefined) continue;
      const new_path = path_join(real_dir, rest);

      // debug!(
      //     "try_to_translate_virtual_to_real: `{}` -> `{}`",
      //     virtual_path.display(),
      //     new_path.display(),
      // );

      // Check if the translated real path is affected by any user-requested
      // remaps via --remap-path-prefix. Apply them if so.
      // Note that this is a special case for imported rust-src paths specified by
      // https://rust-lang.github.io/rfcs/3127-trim-paths.html#handling-sysroot-paths.
      // Other imported paths are not currently remapped (see #66251).
      name.value = { $: "Real", _0: tcx.sess.source_map().path_mapping().to_real_filename(RealFileName.empty(), new_path) };
    }
  };

  const try_to_translate_real_to_virtual = (
    virtual_source_base_dir: string | undefined,
    real_source_base_dir: PathBuf | undefined,
    subdir: string,
    name: { value: FileName },
  ): void => {
    const virtual_dir = tcx.sess.opts.unstable_opts.simulate_remapped_rust_src_base;
    const real_dir = real_source_base_dir;
    const n = name.value;
    if (virtual_dir !== undefined && real_dir !== undefined && n.$ === "Real") {
      const old_name = n._0;
      const [_working_dir, embeddable_path] = old_name.embeddable_name(RemapPathScopeComponents.MACRO);
      let relative_path = path_strip_prefix(embeddable_path, real_dir);
      if (relative_path === undefined) {
        relative_path = virtual_source_base_dir === undefined ? undefined : path_strip_prefix(embeddable_path, virtual_source_base_dir);
      }
      // debug!(?relative_path, ?virtual_dir, ?subdir, "simulate_remapped_rust_src_base");
      const rest = relative_path === undefined ? undefined : path_strip_prefix(relative_path, subdir);
      if (rest !== undefined) {
        name.value = { $: "Real", _0: RealFileName.from_virtual_path(path_join(path_join(virtual_dir, subdir), rest)) };
      }
    }
  };

  const import_info = this.source_map_import_info;
  for (let _ = import_info.length; _ <= source_file_index; _++) {
    import_info.push(undefined);
  }
  // `import_info[source_file_index].get_or_insert_with(|| ..).clone()`
  let info = import_info[source_file_index];
  if (info === undefined) {
    const lazy = this.root.source_map.get(fse_Option_LazyValue, this, source_file_index) as LazyValue<SourceFile_> | undefined;
    if (lazy === undefined) return panic("missing source file");
    const source_file_to_import = lazy.decode([this, tcx], decode_SourceFile);

    // We can't reuse an existing SourceFile, so allocate a new one
    // containing the information we need.
    const original_end_pos = source_file_to_import.end_position();
    const {
      src_hash,
      checksum_hash,
      start_pos: original_start_pos,
      normalized_source_len,
      unnormalized_source_len,
      lines_: lines,
      multibyte_chars,
      normalized_pos,
      stable_id,
    } = source_file_to_import;
    const name = { value: source_file_to_import.name };

    // If this file is under $sysroot/lib/rustlib/src/
    // and the user wish to simulate remapping with -Z simulate-remapped-rust-src-base,
    // then we change `name` to a similar state as if the rust was bootstrapped
    // with `remap-debuginfo = true`.
    // This is useful for testing so that tests about the effects of
    // `try_to_translate_virtual_to_real` don't have to worry about how the
    // compiler is bootstrapped.
    try_to_translate_real_to_virtual(CFG_VIRTUAL_RUST_SOURCE_BASE_DIR, tcx.sess.opts.real_rust_source_base_dir, "library", name);

    // If this file is under $sysroot/lib/rustlib/rustc-src/
    // and the user wish to simulate remapping with -Z simulate-remapped-rust-src-base,
    // then we change `name` to a similar state as if the rust was bootstrapped
    // with `remap-debuginfo = true`.
    try_to_translate_real_to_virtual(CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR, tcx.sess.opts.real_rustc_dev_source_base_dir, "compiler", name);

    // If this file's path has been remapped to `/rustc/$hash`,
    // we might be able to reverse that.
    //
    // NOTE: if you update this, you might need to also update bootstrap's code for generating
    // the `rust-src` component in `Src::run` in `src/bootstrap/dist.rs`.
    try_to_translate_virtual_to_real(CFG_VIRTUAL_RUST_SOURCE_BASE_DIR, tcx.sess.opts.real_rust_source_base_dir, name);

    // If this file's path has been remapped to `/rustc-dev/$hash`,
    // we might be able to reverse that.
    //
    // NOTE: if you update this, you might need to also update bootstrap's code for generating
    // the `rustc-dev` component in `Src::run` in `src/bootstrap/dist.rs`.
    try_to_translate_virtual_to_real(CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR, tcx.sess.opts.real_rustc_dev_source_base_dir, name);

    const local_version = tcx.sess
      .source_map()
      .new_imported_source_file(
        name.value,
        src_hash,
        checksum_hash,
        stable_id,
        RelativeBytePos.to_u32(normalized_source_len),
        unnormalized_source_len,
        this.cnum,
        lines,
        multibyte_chars,
        normalized_pos,
        source_file_index,
      );
    // debug!(
    //     "CrateMetaData::imported_source_files alloc \
    //          source_file {:?} original (start_pos {:?} source_len {:?}) \
    //          translated (start_pos {:?} source_len {:?})",
    //     local_version.name,
    //     original_start_pos,
    //     normalized_source_len,
    //     local_version.start_pos,
    //     local_version.normalized_source_len
    // );

    info = {
      original_start_pos,
      original_end_pos,
      translated_source_file: local_version,
    };
    import_info[source_file_index] = info;
  }
  // `#[derive(Clone)]` (the `Arc<SourceFile>` is shared)
  return { ...info };
};

/**
 * PORT: `option_env!("CFG_VIRTUAL_RUST_SOURCE_BASE_DIR")` / `option_env!("CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR")` of
 * the oracle build: bootstrap's `debuginfo_map_to` (`/rustc/{commit}` and `/rustc-dev/{commit}` for the pinned
 * `rust.commit`, UPSTREAM.json). Checked against the oracle: the sysroot's `core` metadata names its files
 * `/rustc/6f5da406../library/core/src/..`, and librustc_driver embeds `/rustc-dev/6f5da406../compiler/..`.
 */
const CFG_VIRTUAL_RUST_SOURCE_BASE_DIR: string | undefined = "/rustc/6f5da406b56c2db6607202b63daee73aa8c61297";
const CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR: string | undefined = "/rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297";

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1945 get_attr_flags
CrateMetadata.prototype.get_attr_flags = function (this: CrateMetadata, index: DefIndex): AttrFlags {
  return this.root.tables.attr_flags.get(fse_AttrFlags, this, index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1949 get_intrinsic
CrateMetadata.prototype.get_intrinsic = function (this: CrateMetadata, tcx: TyCtxt, index: DefIndex): unknown | undefined {
  const d = this.root.tables.intrinsic.get(fse_Option_LazyValue, this, index);
  return d === undefined ? undefined : d.decode([this, tcx], decode_IntrinsicDef);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1953 get_doc_link_resolutions
CrateMetadata.prototype.get_doc_link_resolutions = function (this: CrateMetadata, tcx: TyCtxt, index: DefIndex): DocLinkResMap {
  const lazy = this.root.tables.doc_link_resolutions.get(fse_Option_LazyValue, this, index) as LazyValue<DocLinkResMap> | undefined;
  if (lazy === undefined) return panic("no resolutions for a doc link");
  return lazy.decode([this, tcx], decode_DocLinkResMap);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder.rs:1962 get_doc_link_traits_in_scope
CrateMetadata.prototype.get_doc_link_traits_in_scope = function (this: CrateMetadata, tcx: TyCtxt, index: DefIndex): Iterable<DefId> {
  const lazy = this.root.tables.doc_link_traits_in_scope.get(fse_Option_LazyArray, this, index) as LazyArray<DefId> | undefined;
  if (lazy === undefined) return panic("no traits in scope for a doc link");
  return lazy.decode([this, tcx], (d) => d.decode_def_id());
};

/**
 * PORT: stand-in for `rustc_middle::mir::interpret::AllocDecodingState` (mir/interpret/mod.rs:149; rustc_middle's
 * mir is M3): its two fields, built as `AllocDecodingState::new` (mod.rs:162) builds them. `State::Empty` is
 * `"Empty"`; `Lock<State>` is the element itself.
 */
export interface AllocDecodingStateStandIn {
  // For each `AllocId`, we keep track of which decoding state it's currently in.
  decoding_state: ({ $: "Empty" } | { $: "Done"; _0: unknown /* AllocId */ })[];
  // The offsets of each allocation in the data stream.
  data_offsets: bigint[];
}
/** `AllocDecodingState::new(data_offsets)` (rustc_middle mir/interpret/mod.rs:162) for the stand-in. */
function AllocDecodingState_new(data_offsets: bigint[]): AllocDecodingStateStandIn {
  const decoding_state: AllocDecodingStateStandIn["decoding_state"] = [];
  for (let i = 0; i < data_offsets.length; i++) decoding_state.push({ $: "Empty" });

  return { decoding_state, data_offsets };
}

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

