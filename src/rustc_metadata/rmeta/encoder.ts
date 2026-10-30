// Port of compiler/rustc_metadata/src/rmeta/encoder.rs.
//
// Contract-first (lane encode-contract, plan-m5 D3 / wave 32; docs/handoff/encode-contract.md). Every upstream fn of
// encoder.rs is either ported (a `// rustc:` marker) or declared as a stub: a `// stub: <path>:<line> <name> (lane
// <lane>)` comment directly above a declaration with its final signature whose body is
// `unported("rustc_metadata::rmeta::encoder::.. (lane <lane>)")`. A lane replaces each of its stubs in place with the
// body and a `// rustc:` marker (contract.test.ts pins who owns what, so lanes cannot drift):
// - encoder-a: :1–:580 except encode-span-hygiene's (`[u8]` encoding :402, the def-path tables :556/:577);
// - encode-span-hygiene (wave 32): the `SpanEncoder` impl (:151–:244), `bytes_needed` (:254), `SpanData`'s encoding
//   (:259), `encode_symbol_or_byte_symbol` (:529), `encode_source_map` (:581) and `encode_hygiene` (:2036);
// - encoder-b: :651–:1481 (`encode_crate_root`, `analyze_attr`, the `should_encode_*` predicates, `encode_attrs`);
// - encoder-c: :1482–:2035 (`encode_def_ids` .. `encode_foreign_modules`);
// - encoder-d: :2064–end (`encode_proc_macros` .. `encode_dylib_dependency_formats`, `prefetch_mir`,
//   `EncodedMetadata`, `encode_metadata`, `with_encode_metadata_header`, the header writers, `provide`,
//   `rendered_const`).
// Ported here (the skeleton the generated `MetadataEncodable` derives and the later lanes need): the `Encoder` impl,
// the `TyEncoder` impl, `ExpnIndex`'s `Encodable`, and the lazy machinery (`emit_lazy_distance`, `lazy`,
// `lazy_array`). The `Encodable` impls of `LazyValue` / `LazyArray` / `LazyTable` (:121/:127/:136) live in ./mod.ts,
// next to their `Decodable` impls, because the generated encoders import them from the types' module.
//
// PORT:
// - `EncodeContext<'a, 'tcx>` is a class implementing `TyEncoder` (so `SpanEncoder` and `Encoder`); every `impl`
//   block's methods are in the class body in upstream order (PORTING §8). Fields that clash with a method get `_`:
//   `type_shorthands_`, `predicate_shorthands_` (the `TyEncoder` accessors return them).
// - `const CLEAR_CROSS_CRATE: bool = true` (TyEncoder) is `EncodeContext_CLEAR_CROSS_CRATE` (rustc_middle
//   ty/codec.ts's convention for the associated const).
// - `metadata_hasher: Arc<Mutex<XxHash3_128>>` is the hasher itself (vendor twox-hash); `hygiene_ctxt:
//   Rc<RefCell<HygieneEncodeContext>>` the context itself; `source_file_cache: (Arc<SourceFile>, usize)` a tuple.
// - `FxIndexSet<T>` fields whose index is read (`interpret_allocs`, `required_source_files`: `insert_full`) are
//   `Map<T, number>` from the element to its insertion index (iteration order = index order).
// - `span_shorthands: FxHashMap<Span, usize>` keys on the interned `Span`; `predicate_shorthands` keeps the key type
//   of `TyEncoder.predicate_shorthands` (rustc_middle ty/codec.ts).
// - Generic `T: Encodable<EncodeContext>` arguments (`lazy`, `lazy_array`) take the element's `Encodable` fn
//   (PORTING §5: generic trait bounds become function tables); `B: Borrow<T::Value>` is the value itself.
import type { Attribute } from "../../rustc_attr_ir/attr.ts";
import type { StrippedCfgItem } from "../../rustc_attr_ir/data_structures.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { ExportedSymbol, SymbolExportInfo } from "../../rustc_codegen_ssa/back/symbol_export.ts";
import type { ForeignModule, LinkagePreference, NativeLib } from "../../rustc_crate_store/lib.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import type { Body, Expr } from "../../rustc_hir/hir.ts";
import type { DebuggerVisualizerFile } from "../../rustc_middle/middle/debugger_visualizer.ts";
import type { FeatureStability } from "../../rustc_middle/middle/mod.ts";
import type { AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyEncoder } from "../../rustc_middle/ty/codec.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Encodable, type Encoder, Encoder_provided, encode_Option, encode_tuple, encode_u32, encode_usize } from "../../rustc_serialize/serialize.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import { encode_ExpnData, encode_ExpnHash, encode_Transparency } from "../../rustc_span/decodable.gen.ts";
import { CrateNum, type DefId, DefIndex, debug_CrateNum, encode_LocalDefId, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ExpnData, type ExpnHash, type ExpnId, ExpnIndex, HygieneEncodeContext, LocalExpnId, SyntaxContext, type SyntaxContextKey } from "../../rustc_span/hygiene.ts";
import { BytePos, debug_ExternalSource, encode_BytePos, encode_CrateNum, encode_ExpnId, encode_SourceFile, encode_SyntaxContext, RealFileName, type SourceFile, Span, type SpanData, StableSourceFileId } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { ByteSymbol, Symbol } from "../../rustc_span/symbol.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import { XxHash3_128 } from "../../vendor/twox_hash/lib.ts";
import { encode_SpanTag } from "../decodable.gen.ts";
import type { EiiMapEncodedKeyValue } from "../eii.ts";
import type { DefPathHashMapRef } from "./def_path_hash_map.ts";
import {
  type CrateDep,
  type CrateRoot,
  type CrateRootUnhashed,
  debug_LazyState,
  type ExpnDataTable,
  type ExpnHashTable,
  type IncoherentImpls,
  LazyArray,
  LazyState,
  type LazyTable,
  LazyValue,
  type ProcMacroData,
  SpanTag,
  type SpanKind,
  SYMBOL_OFFSET,
  SYMBOL_PREDEFINED,
  SYMBOL_STR,
  type SyntaxContextTable,
  type TableBuilders,
  type TraitImpls,
} from "./mod.ts";
import { fse_Option_LazyValue, TableBuilder } from "./table.ts";
// lane encoder-d
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { CanonicalSymbols } from "../../rustc_attr_ir/canonical_symbols.ts";
import { clone_StrippedCfgItem, encode_StrippedCfgItem } from "../../rustc_attr_ir/data_structures.gen.ts";
import { encode_LangItem } from "../../rustc_attr_ir/lang_items.gen.ts";
import { encode_Stability } from "../../rustc_attr_ir/stability.gen.ts";
import type { Stability } from "../../rustc_attr_ir/stability.ts";
import { encode_LinkagePreference } from "../../rustc_crate_store/cstore.gen.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { StableHasher, stable_hash_Fingerprint, stable_hash_Hash64 } from "../../rustc_data_structures/stable_hash.ts";
import { Svh } from "../../rustc_data_structures/svh.ts";
import { MacroKinds } from "../../rustc_hir/def.ts";
import { id_to_string } from "../../rustc_hir_pretty/lib.ts";
import { type DefPathData, encode_DefKey } from "../../rustc_hir_id/definitions.ts";
import { clone_DefKey } from "../../rustc_hir_id/definitions.gen.ts";
import { encode_FeatureStability, encode_ImplTraitHeader, encode_Visibility } from "../../rustc_middle/decodable.gen.ts";
import { compute_hir_hash, TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import type { CrateInherentImpls, ImplTraitHeader } from "../../rustc_middle/ty/mod.ts";
import { lib_features as middle_lib_features } from "../../rustc_middle/middle/mod.ts";
import type { DocLinkResMap } from "../../rustc_middle/middle/resolve.ts";
import { type CoerceUnsizedInfo, encode_CoerceUnsizedInfo } from "../../rustc_middle/ty/adjustment.gen.ts";
import type { SimplifiedType } from "../../rustc_middle/ty/fast_reject.ts";
import { Visibility } from "../../rustc_middle/ty/mod.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { type Decoder, decode_Option, decode_u8, decode_Vec, encode_String, encode_u8, encode_Vec } from "../../rustc_serialize/serialize.ts";
import { encode_DeniedPartialMitigation, gather_enabled_denied_partial_mitigations } from "../../rustc_session/options/mitigation_coverage.ts";
import { CRATE_DEF_ID, CRATE_MOD_ID, DefIdMap, debug_LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import type { MacroKind } from "../../rustc_span/hygiene.ts";
import { encode_DefId, encode_Span, encode_Symbol } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { encode_SimplifiedType } from "../../rustc_type_ir/fast_reject.gen.ts";
import { simplify_type, TreatParams } from "../../rustc_type_ir/fast_reject.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { io_error_from_node, type IoResult } from "../../std/io.ts";
import { Err, Ok, unwrap_result } from "../../std/result.ts";
import { encode_CrateDep, encode_CrateHeader, encode_IncoherentImpls, encode_ProcMacroKind, encode_TraitImpls } from "../decodable.gen.ts";
import { FailCreateFileEncoder_diagnostic, FailWriteFile_diagnostic } from "../diagnostics.ts";
import type { MaybeTempDir } from "../fs.ts";
import type { Defaultness } from "./table.ts";
import {
  type CrateHeader,
  CRATE_HASH_OFFSET,
  encode_LazyValue,
  METADATA_HEADER,
  type ProcMacroKind,
  RawDefId,
  ROOT_POS_OFFSET,
  rustc_version,
  TableBuilders_default,
  UNHASHED_POS_OFFSET,
} from "./mod.ts";

// rustc-type: compiler/rustc_metadata/src/rmeta/encoder.rs:52 EncodeContext
export class EncodeContext implements TyEncoder {
  constructor(
    public opaque: FileEncoder,
    public metadata_hasher: XxHash3_128,
    public tcx: TyCtxt,
    public feat: Features,
    public tables: TableBuilders,

    public lazy_state: LazyState,
    public span_shorthands: Map<Span, number>,
    public type_shorthands_: Map<Ty, number>,
    public predicate_shorthands_: Map<string, number>,

    public interpret_allocs: Map<AllocId, number>,

    // This is used to speed up Span encoding.
    // The `usize` is an index into the `MonotonicVec`
    // that stores the `SourceFile`
    public source_file_cache: [SourceFile, number],
    // The indices (into the `SourceMap`'s `MonotonicVec`)
    // of all of the `SourceFiles` that we need to serialize.
    // When we serialize a `Span`, we insert the index of its
    // `SourceFile` into the `FxIndexSet`.
    // The order inside the `FxIndexSet` is used as on-disk
    // order of `SourceFiles`, and encoded inside `Span`s.
    public required_source_files: Map<number, number> | undefined,
    public is_proc_macro: boolean,
    public hygiene_ctxt: HygieneEncodeContext,
    // Used for both `Symbol`s and `ByteSymbol`s.
    public symbol_index_table: Map<number, number>,
  ) {}

  // ---- impl<'a, 'tcx> Encoder for EncodeContext<'a, 'tcx> (encoder_methods!: `self.opaque.$name(value)`) ----

  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_usize (encoder_methods!)
  emit_usize(value: number): void {
    this.opaque.emit_usize(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_u128 (encoder_methods!)
  emit_u128(value: bigint): void {
    this.opaque.emit_u128(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_u64 (encoder_methods!)
  emit_u64(value: bigint): void {
    this.opaque.emit_u64(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_u32 (encoder_methods!)
  emit_u32(value: number): void {
    this.opaque.emit_u32(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_u16 (encoder_methods!)
  emit_u16(value: number): void {
    this.opaque.emit_u16(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_u8 (encoder_methods!)
  emit_u8(value: number): void {
    this.opaque.emit_u8(value);
  }

  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_isize (encoder_methods!)
  emit_isize(value: number): void {
    this.opaque.emit_isize(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_i128 (encoder_methods!)
  emit_i128(value: bigint): void {
    this.opaque.emit_i128(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_i64 (encoder_methods!)
  emit_i64(value: bigint): void {
    this.opaque.emit_i64(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_i32 (encoder_methods!)
  emit_i32(value: number): void {
    this.opaque.emit_i32(value);
  }
  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_i16 (encoder_methods!)
  emit_i16(value: number): void {
    this.opaque.emit_i16(value);
  }

  // rustc-macro: compiler/rustc_metadata/src/rmeta/encoder.rs:96 emit_raw_bytes (encoder_methods!)
  emit_raw_bytes(value: Uint8Array): void {
    this.opaque.emit_raw_bytes(value);
  }

  // (provided methods of `Encoder`: not overridden, so on `self`, not `self.opaque`)
  emit_i8(v: number): void {
    Encoder_provided.emit_i8(this, v);
  }
  emit_bool(v: boolean): void {
    Encoder_provided.emit_bool(this, v);
  }
  emit_char(v: number): void {
    Encoder_provided.emit_char(this, v);
  }
  emit_str(v: string): void {
    Encoder_provided.emit_str(this, v);
  }
  emit_byte_str(v: Uint8Array): void {
    Encoder_provided.emit_byte_str(this, v);
  }

  // ---- impl<'a, 'tcx> SpanEncoder for EncodeContext<'a, 'tcx> ----

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:151 encode_crate_num
  encode_crate_num(crate_num: CrateNum): void {
    if (crate_num !== LOCAL_CRATE && this.is_proc_macro) {
      panic(`Attempted to encode non-local CrateNum ${debug_CrateNum(crate_num, PLAIN)} for proc-macro crate`);
    }
    this.emit_u32(CrateNum.as_u32(crate_num));
  }

  /// This function panics as we need to remap only local def indices, however
  /// we can not determine if the def index is local given only def index.
  /// In metadata `LocalDefId` is used instead of `DefIndex` as with this wrapper
  /// around def index we certainly know that it came from local crate.
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:162 encode_def_index
  encode_def_index(_: DefIndex): void {
    panic("use LocalDefId or DefId or encode DefIndex manually");
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:166 encode_def_id
  encode_def_id(def_id: DefId): void {
    encode_CrateNum(def_id.krate, this);
    this.emit_u32(DefIndex.as_u32(def_id.index));
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:171 encode_syntax_context
  encode_syntax_context(syntax_context: SyntaxContext): void {
    const idx = this.hygiene_ctxt.get_syntax_ctxt_encoding_index(syntax_context);
    encode_u32(idx, this);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:176 encode_expn_id
  encode_expn_id(expn_id: ExpnId): void {
    if (expn_id.krate === LOCAL_CRATE) {
      // We will only write details for local expansions. Non-local expansions will fetch
      // data from the corresponding crate's metadata.
      // FIXME(#43047) FIXME(#74731) We may eventually want to avoid relying on external
      // metadata from proc-macro crates.
      this.hygiene_ctxt.schedule_expn_data_for_encoding(expn_id);
    }
    encode_CrateNum(expn_id.krate, this);
    encode_ExpnIndex(expn_id.local_id, this);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:188 encode_span
  encode_span(span: Span): void {
    // `match self.span_shorthands.entry(span)`
    const last_location = this.span_shorthands.get(span);
    if (last_location !== undefined) {
      // Entry::Occupied
      // If an offset is smaller than the absolute position, we encode with the offset.
      // This saves space since smaller numbers encode in less bits.
      // This cannot underflow. Metadata is written with increasing position(), so any
      // previously saved offset must be smaller than the current position.
      const offset = this.opaque.position() - last_location;
      if (offset < last_location) {
        const needed = bytes_needed(offset);
        encode_SpanTag(SpanTag.indirect(true, needed), this);
        // PORT: `write_with::<8>` writes `offset.to_le_bytes()` and keeps the first `needed` bytes (usize as 8 LE bytes).
        this.opaque.write_with(8, (dest) => {
          dest.set(usize_to_le_bytes(offset));
          return needed;
        });
      } else {
        const needed = bytes_needed(last_location);
        encode_SpanTag(SpanTag.indirect(false, needed), this);
        this.opaque.write_with(8, (dest) => {
          dest.set(usize_to_le_bytes(last_location));
          return needed;
        });
      }
    } else {
      // Entry::Vacant
      const position = this.opaque.position();
      this.span_shorthands.set(span, position);
      // Data is encoded with a SpanTag prefix (see below).
      encode_SpanData(Span.data(span), this);
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:222 encode_symbol
  encode_symbol(sym: Symbol): void {
    this.encode_symbol_or_byte_symbol(Symbol.as_u32(sym), (this_) => this_.emit_str(Symbol.as_str(sym)));
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:226 encode_byte_symbol
  encode_byte_symbol(byte_sym: ByteSymbol): void {
    this.encode_symbol_or_byte_symbol(ByteSymbol.as_u32(byte_sym), (this_) => {
      this_.emit_byte_str(ByteSymbol.as_byte_str(byte_sym));
    });
  }

  /// We override `encode` function for `LocalDefId` as its default
  /// encoding logic is `self.encode_def_id(def_id.to_def_id())`
  /// meaning that the crate num will also be encoded, however as in metadata we use
  /// `LocalDefId` as a wrapper around def index we want to encode
  /// def index only, so we override the encode implementation.
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:237 encode_local_def_id
  encode_local_def_id(def_id: LocalDefId): void {
    this.emit_u32(DefIndex.as_u32(LocalDefId.local_def_index(def_id)));
  }

  /// We override encoding logic for `DefKey` during metadata encoding,
  /// as `DefKey` has a field `parent` of type `Option<DefIndex>` whose encoding will
  /// cause panic. So we remap it to `LocalDefId` as def keys during metadata encoding are all local.
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:244 encode_def_key
  encode_def_key<T>(parent: DefIndex | undefined, disambiguated_data: T, encode_T: Encodable<T, EncodeContext>): void {
    encode_Option(parent === undefined ? undefined : LocalDefId.of(parent), this, encode_LocalDefId);
    encode_T(disambiguated_data, this);
  }

  // ---- impl<'a, 'tcx> TyEncoder<'tcx> for EncodeContext<'a, 'tcx> ----
  // const CLEAR_CROSS_CRATE: bool = true;  (EncodeContext_CLEAR_CROSS_CRATE, below)

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:411 position
  position(): number {
    return this.opaque.position();
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:415 type_shorthands
  type_shorthands(): Map<Ty, number> {
    return this.type_shorthands_;
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:419 predicate_shorthands
  predicate_shorthands(): Map<string, number> {
    return this.predicate_shorthands_;
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:423 encode_alloc_id
  encode_alloc_id(alloc_id: AllocId): void {
    // `let (index, _) = self.interpret_allocs.insert_full(*alloc_id);`
    let index = this.interpret_allocs.get(alloc_id);
    if (index === undefined) {
      index = this.interpret_allocs.size;
      this.interpret_allocs.set(alloc_id, index);
    }

    encode_usize(index, this);
  }

  // ---- impl<'a, 'tcx> EncodeContext<'a, 'tcx> ----

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:472 emit_lazy_distance
  emit_lazy_distance(position: number): void {
    const pos = position; // `position.get()`
    let distance: number;
    const lazy_state = this.lazy_state;
    switch (lazy_state.$) {
      case "NoNode":
        return bug("emit_lazy_distance: outside of a metadata node");
      case "NodeStart": {
        const start = lazy_state._0;
        assert(pos <= start, "assertion failed: pos <= start");
        distance = start - pos;
        break;
      }
      case "Previous": {
        const last_pos = lazy_state._0;
        assert(last_pos <= position, "make sure that the calls to `lazy*` are in the same order as the metadata fields");
        distance = position - last_pos;
        break;
      }
    }
    this.lazy_state = { $: "Previous", _0: unwrap(nonzero(pos)) };
    this.emit_usize(distance);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:494 lazy
  lazy<T>(value: T, encode_T: Encodable<T, EncodeContext>): LazyValue<T> {
    const pos = unwrap(nonzero(this.position()));

    assert_eq(this.lazy_state, LazyState.NoNode, debug_LazyState_plain, LazyState_eq);
    this.lazy_state = { $: "NodeStart", _0: pos };
    encode_T(value, this);
    this.lazy_state = LazyState.NoNode;

    assert(pos <= this.position(), "assertion failed: pos.get() <= self.position()");

    return LazyValue.from_position<T>(pos);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:510 lazy_array
  lazy_array<T>(values: Iterable<T>, encode_T: Encodable<T, EncodeContext>): LazyArray<T> {
    const pos = unwrap(nonzero(this.position()));

    assert_eq(this.lazy_state, LazyState.NoNode, debug_LazyState_plain, LazyState_eq);
    this.lazy_state = { $: "NodeStart", _0: pos };
    // `values.into_iter().map(|value| value.borrow().encode(self)).count()`
    let len = 0;
    for (const value of values) {
      encode_T(value, this);
      len++;
    }
    this.lazy_state = LazyState.NoNode;

    assert(pos <= this.position(), "assertion failed: pos.get() <= self.position()");

    return LazyArray.from_position_and_num_elems<T>(pos, len);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:529 encode_symbol_or_byte_symbol
  encode_symbol_or_byte_symbol(index: number, emit_str_or_byte_str: (this_: EncodeContext) => void): void {
    // if symbol/byte symbol is predefined, emit tag and symbol index
    if (Symbol.is_predefined(index)) {
      this.opaque.emit_u8(SYMBOL_PREDEFINED);
      this.opaque.emit_u32(index);
    } else {
      // otherwise write it as string or as offset to it
      // `match self.symbol_index_table.entry(index)`
      const x = this.symbol_index_table.get(index);
      if (x === undefined) {
        // Entry::Vacant
        this.opaque.emit_u8(SYMBOL_STR);
        const pos = this.opaque.position();
        this.symbol_index_table.set(index, pos);
        emit_str_or_byte_str(this);
      } else {
        // Entry::Occupied
        this.emit_u8(SYMBOL_OFFSET);
        this.emit_usize(x);
      }
    }
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:556 encode_def_path_table (lane encoder-a)
  encode_def_path_table(): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_path_table (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:577 encode_def_path_hash_map (lane encoder-a)
  encode_def_path_hash_map(): LazyValue<DefPathHashMapRef> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_path_hash_map (lane encoder-a)");
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:581 encode_source_map
  encode_source_map(): LazyTable<number, number, LazyValue<SourceFile> | undefined> {
    const source_map = this.tcx.sess.source_map();
    const all_source_files = source_map.files().deref();

    // By replacing the `Option` with `None`, we ensure that we can't
    // accidentally serialize any more `Span`s after the source map encoding
    // is done.
    const required_source_files = unwrap(this.required_source_files);
    this.required_source_files = undefined;

    const adapted = TableBuilder.default<number, number, LazyValue<SourceFile> | undefined>(fse_Option_LazyValue);

    const local_crate_stable_id = this.tcx.stable_crate_id(LOCAL_CRATE);

    // Only serialize `SourceFile`s that were used during the encoding of a `Span`.
    //
    // The order in which we encode source files is important here: the on-disk format for
    // `Span` contains the index of the corresponding `SourceFile`.
    // PORT: `required_source_files.iter().enumerate()`: the `Map` iterates in insertion order and its value is the
    // insertion index (`insert_full`), i.e. `on_disk_index`.
    for (const [source_file_index, on_disk_index] of required_source_files) {
      const source_file = all_source_files[source_file_index]!;
      // Don't serialize imported `SourceFile`s, unless we're in a proc-macro crate.
      assert(!source_file.is_imported() || this.is_proc_macro, "assertion failed: !source_file.is_imported() || self.is_proc_macro");

      // At export time we expand all source file paths to absolute paths because
      // downstream compilation sessions can have a different compiler working
      // directory, so relative paths from this or any other upstream crate
      // won't be valid anymore.
      //
      // At this point we also erase the actual on-disk path and only keep
      // the remapped version -- as is necessary for reproducible builds.
      const adapted_source_file = source_file.clone();

      switch (source_file.name.$) {
        case "Real": {
          const original_file_name = source_file.name._0;
          // PORT: `original_file_name.clone()` (`#[derive(Clone)]`; the `InnerRealFileName`s are never mutated).
          const adapted_file_name = new RealFileName(original_file_name.local, original_file_name.maybe_remapped, original_file_name.scopes);
          adapted_file_name.update_for_crate_metadata();
          adapted_source_file.name = { $: "Real", _0: adapted_file_name };
          break;
        }
        default: {
          // expanded code, not from a file
        }
      }

      // We're serializing this `SourceFile` into our crate metadata,
      // so mark it as coming from this crate.
      // This also ensures that we don't try to deserialize the
      // `CrateNum` for a proc-macro dependency - since proc macro
      // dependencies aren't loaded when we deserialize a proc-macro,
      // trying to remap the `CrateNum` would fail.
      if (this.is_proc_macro) {
        adapted_source_file.cnum = LOCAL_CRATE;
      }

      // Update the `StableSourceFileId` to make sure it incorporates the
      // id of the current crate. This way it will be unique within the
      // crate graph during downstream compilation sessions.
      adapted_source_file.stable_id = StableSourceFileId.from_filename_for_export(adapted_source_file.name, local_crate_stable_id);

      // PORT: `on_disk_index.try_into().expect("cannot export more than U32_MAX files")` — the `u32` conversion's panic, as a range check.
      if (on_disk_index > 0xffff_ffff) panic("cannot export more than U32_MAX files: TryFromIntError(())");
      adapted.set_some(on_disk_index, this.lazy(adapted_source_file, encode_SourceFile));
    }

    return adapted.encode(this.opaque);
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:651 encode_crate_root (lane encoder-b)
  encode_crate_root(): [LazyValue<CrateRoot>, LazyValue<CrateRootUnhashed>] {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_crate_root (lane encoder-b)");
  }

  // ---- impl<'a, 'tcx> EncodeContext<'a, 'tcx> (second block, encoder.rs:1460) ----

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1461 encode_attrs (lane encoder-b)
  encode_attrs(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_attrs (lane encoder-b)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1482 encode_def_ids (lane encoder-c)
  encode_def_ids(): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_ids (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1733 encode_externally_implementable_items (lane encoder-c)
  encode_externally_implementable_items(): LazyArray<EiiMapEncodedKeyValue> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_externally_implementable_items (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1748 encode_info_for_adt (lane encoder-c)
  encode_info_for_adt(_local_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_info_for_adt (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1808 encode_info_for_mod (lane encoder-c)
  encode_info_for_mod(_local_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_info_for_mod (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1839 encode_explicit_item_bounds (lane encoder-c)
  encode_explicit_item_bounds(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_explicit_item_bounds (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1845 encode_explicit_item_self_bounds (lane encoder-c)
  encode_explicit_item_self_bounds(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_explicit_item_self_bounds (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1852 encode_info_for_assoc_item (lane encoder-c)
  encode_info_for_assoc_item(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_info_for_assoc_item (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1884 encode_precise_capturing_args (lane encoder-c)
  encode_precise_capturing_args(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_precise_capturing_args (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1892 encode_mir (lane encoder-c)
  encode_mir(): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_mir (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1976 encode_stability (lane encoder-c)
  encode_stability(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_stability (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1987 encode_const_stability (lane encoder-c)
  encode_const_stability(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_const_stability (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1998 encode_default_body_stability (lane encoder-c)
  encode_default_body_stability(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_default_body_stability (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2009 encode_deprecation (lane encoder-c)
  encode_deprecation(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_deprecation (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2016 encode_info_for_macro (lane encoder-c)
  encode_info_for_macro(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_info_for_macro (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2024 encode_native_libraries (lane encoder-c)
  encode_native_libraries(): LazyArray<NativeLib> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_native_libraries (lane encoder-c)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2030 encode_foreign_modules (lane encoder-c)
  encode_foreign_modules(): LazyArray<ForeignModule> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_foreign_modules (lane encoder-c)");
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2036 encode_hygiene
  encode_hygiene(): [SyntaxContextTable, ExpnDataTable, ExpnHashTable] {
    const syntax_contexts = TableBuilder.default<number, number, LazyValue<SyntaxContextKey> | undefined>(fse_Option_LazyValue);
    const expn_data_table = TableBuilder.default<ExpnIndex, ExpnIndex, LazyValue<ExpnData> | undefined>(fse_Option_LazyValue);
    const expn_hash_table = TableBuilder.default<ExpnIndex, ExpnIndex, LazyValue<ExpnHash> | undefined>(fse_Option_LazyValue);

    HygieneEncodeContext.encode(
      this.hygiene_ctxt,
      [this, syntax_contexts, expn_data_table, expn_hash_table] as const,
      ([this_, syntax_contexts], index, ctxt_data) => {
        syntax_contexts.set_some(index, this_.lazy(ctxt_data, encode_SyntaxContextKey));
      },
      ([this_, , expn_data_table, expn_hash_table], index, expn_data, hash) => {
        const index_ = index.as_local();
        if (index_ !== undefined) {
          expn_data_table.set_some(LocalExpnId.as_raw(index_), this_.lazy(unwrap(expn_data, "local expn"), encode_ExpnData));

          expn_hash_table.set_some(LocalExpnId.as_raw(index_), this_.lazy(hash, encode_ExpnHash));
        }
      },
    );

    return [syntax_contexts.encode(this.opaque), expn_data_table.encode(this.opaque), expn_hash_table.encode(this.opaque)];
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2064 encode_proc_macros
  encode_proc_macros(): ProcMacroData | undefined {
    const is_proc_macro = this.tcx.crate_types().includes("ProcMacro");
    if (is_proc_macro) {
      const tcx = this.tcx;
      const proc_macro_decls_static_ = unwrap(tcx.proc_macro_decls_static(null), "called `Option::unwrap()` on a `None` value");
      const proc_macro_decls_static = this.lazy(proc_macro_decls_static_, encode_LocalDefId);

      const stability = tcx.lookup_stability(CRATE_DEF_ID) as Stability | undefined;

      // record_some!(self.tables.def_kind[CRATE_DEF_ID] <- DefKind::Mod);
      this.tables.def_kind.set_some(CRATE_DEF_ID, DefKind.Mod);
      // record_some_lazy!(self.tables.def_span[CRATE_DEF_ID] <- tcx.def_span(CRATE_DEF_ID.to_def_id()));
      {
        const value = tcx.def_span(LocalDefId.to_def_id(CRATE_DEF_ID));
        const lazy = this.lazy(value, encode_Span);
        this.tables.def_span.set_some(CRATE_DEF_ID, lazy);
      }
      this.encode_attrs(CRATE_DEF_ID);
      const vis = Visibility.map_id(tcx.local_visibility(CRATE_DEF_ID), (mod_id) => LocalModId.to_local_def_id(mod_id));
      // record_some_lazy!(self.tables.visibility[CRATE_DEF_ID] <- vis);
      {
        const lazy = this.lazy(vis, encode_Visibility_LocalDefId);
        this.tables.visibility.set_some(CRATE_DEF_ID, lazy);
      }
      if (stability !== undefined) {
        // record_some_lazy!(self.tables.lookup_stability[CRATE_DEF_ID] <- stability);
        const lazy = this.lazy(stability, encode_Stability);
        this.tables.lookup_stability.set_some(CRATE_DEF_ID, lazy);
      }
      this.encode_deprecation(CRATE_DEF_ID);
      const res_map = tcx.resolutions(null).doc_link_resolutions.get(CRATE_MOD_ID);
      if (res_map !== undefined) {
        // record_some_lazy!(self.tables.doc_link_resolutions[CRATE_DEF_ID] <- res_map);
        const lazy = this.lazy(res_map, encode_DocLinkResMap);
        this.tables.doc_link_resolutions.set_some(CRATE_DEF_ID, lazy);
      }
      const traits = tcx.resolutions(null).doc_link_traits_in_scope.get(CRATE_MOD_ID);
      if (traits !== undefined) {
        // record_array!(self.tables.doc_link_traits_in_scope[CRATE_DEF_ID] <- traits);
        const lazy = this.lazy_array(traits, encode_DefId);
        this.tables.doc_link_traits_in_scope.set_some(CRATE_DEF_ID, lazy);
      }

      const macros: [LocalDefId, LazyValue<ProcMacroKind>][] = [];

      // Normally, this information is encoded when we walk the items
      // defined in this crate. However, we skip doing that for proc-macro crates,
      // so we manually encode just the information that we need
      for (const proc_macro_ of tcx.resolutions(null).proc_macros) {
        const id = proc_macro_;
        const proc_macro = tcx.local_def_id_to_hir_id(proc_macro_);
        let name = tcx.hir_name(proc_macro);
        const span = tcx.hir_span(proc_macro);
        // Proc-macros may have attributes like `#[allow_internal_unstable]`,
        // so downstream crates need access to them.
        const attrs = tcx.hir_attrs(proc_macro);
        let macro_kind: MacroKind;
        let kind: ProcMacroKind;
        let derive: [Symbol, readonly Symbol[]] | undefined;
        if (find_attr(attrs, (k) => (k.$ === "ProcMacro" ? true : undefined)) !== undefined) {
          [macro_kind, kind] = ["Bang", { $: "Bang", name: Symbol.as_str(name) }];
        } else if (find_attr(attrs, (k) => (k.$ === "ProcMacroAttribute" ? true : undefined)) !== undefined) {
          [macro_kind, kind] = ["Attr", { $: "Attr", name: Symbol.as_str(name) }];
        } else if ((derive = find_attr(attrs, (k) => (k.$ === "ProcMacroDerive" ? ([k.trait_name, k.helper_attrs] as [Symbol, readonly Symbol[]]) : undefined))) !== undefined) {
          const [trait_name, helper_attrs] = derive;
          name = trait_name;
          [macro_kind, kind] = [
            "Derive",
            {
              $: "CustomDerive",
              trait_name: Symbol.as_str(name),
              attributes: helper_attrs.map((attr) => Symbol.as_str(attr)),
            },
          ];
        } else {
          return bug(`Unknown proc-macro type for item ${debug_LocalDefId(id, PLAIN)}`);
        }

        macros.push([id, this.lazy(kind, encode_ProcMacroKind)]);

        // PORT: `let mut def_key = ..` is a copy (`DefKey: Copy`), so the mutation stays local: `clone_DefKey`.
        const def_key = clone_DefKey(this.tcx.hir_def_key(id));
        def_key.disambiguated_data.data = { $: "MacroNs", _0: name } as DefPathData;

        // record_some!(self.tables.def_kind[id] <- DefKind::Macro(macro_kind.into()));
        this.tables.def_kind.set_some(id, { $: "Macro", _0: MacroKinds.from_MacroKind(macro_kind) });

        this.encode_attrs(id);
        // record_some_lazy!(self.tables.def_keys[id] <- def_key);
        this.tables.def_keys.set_some(id, this.lazy(def_key, encode_DefKey));
        // record_some_lazy!(self.tables.def_ident_span[id] <- span);
        this.tables.def_ident_span.set_some(id, this.lazy(span, encode_Span));
        // record_some_lazy!(self.tables.def_span[id] <- span);
        this.tables.def_span.set_some(id, this.lazy(span, encode_Span));
        // record_some_lazy!(self.tables.visibility[id] <- ty::Visibility::Public);
        this.tables.visibility.set_some(id, this.lazy(Visibility.Public as Visibility<LocalDefId>, encode_Visibility_LocalDefId));
        if (stability !== undefined) {
          // record_some_lazy!(self.tables.lookup_stability[id] <- stability);
          this.tables.lookup_stability.set_some(id, this.lazy(stability, encode_Stability));
        }
      }

      const macros_ = this.lazy_array(macros, encode_LocalDefId_LazyValue);

      const proc_macro_quoted_spans = TableBuilder.default<number, number, LazyValue<Span> | undefined>(fse_Option_LazyValue);
      for (const [i, span] of this.tcx.sess.proc_macro_quoted_spans()) {
        proc_macro_quoted_spans.set_some(i, this.lazy(span, encode_Span));
      }

      const proc_macro_quoted_spans_ = proc_macro_quoted_spans.encode(this.opaque);

      return {
        proc_macro_decls_static,
        stability,
        macros: macros_,
        proc_macro_quoted_spans: proc_macro_quoted_spans_,
      };
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2161 encode_debugger_visualizers
  encode_debugger_visualizers(): LazyArray<DebuggerVisualizerFile> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    return this.lazy_array(
      (this.tcx.debugger_visualizers(LOCAL_CRATE) as DebuggerVisualizerFile[])
        // Erase the path since it may contain privacy sensitive data
        // that we don't want to end up in crate metadata.
        // The path is only needed for the local crate because of
        // `--emit dep-info`.
        .map((v) => v.path_erased()),
      encode_DebuggerVisualizerFile,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2175 encode_crate_deps
  encode_crate_deps(): LazyArray<CrateDep> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);

    const deps: [CrateNum, CrateDep][] = this.tcx.crates(null).map((cnum) => {
      const dep: CrateDep = {
        name: this.tcx.crate_name(cnum),
        hash: this.tcx.crate_hash(cnum),
        host_hash: this.tcx.crate_host_hash(cnum),
        kind: this.tcx.crate_dep_kind(cnum),
        is_private: this.tcx.is_private_dep(cnum),
      };
      return [cnum, dep];
    });

    {
      // Sanity-check the crate numbers
      let expected_cnum = 1;
      for (const [n] of deps) {
        assert_eq(n, CrateNum.new(expected_cnum), (v) => debug_CrateNum(v, PLAIN));
        expected_cnum += 1;
      }
    }

    // We're just going to write a list of crate 'name-hash-version's, with
    // the assumption that they are numbered 1 to n.
    // FIXME (#2166): This is not nearly enough to support correct versioning
    // but is enough to get transitive crate dependencies working.
    return this.lazy_array(
      deps.map(([, dep]) => dep),
      encode_CrateDep,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2210 encode_target_modifiers
  encode_target_modifiers(): LazyArray<TargetModifier> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    return this.lazy_array(tcx.sess.opts.gather_target_modifiers(), encode_TargetModifier);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2216 encode_enabled_denied_partial_mitigations
  encode_enabled_denied_partial_mitigations(): LazyArray<DeniedPartialMitigation> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    // PORT: `Session::gather_enabled_denied_partial_mitigations` is the generated free fn (as in creader.ts).
    return this.lazy_array(gather_enabled_denied_partial_mitigations(tcx.sess), encode_DeniedPartialMitigation);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2222 encode_lib_features
  encode_lib_features(): LazyArray<[Symbol, FeatureStability]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const lib_features = tcx.lib_features(LOCAL_CRATE) as middle_lib_features.LibFeatures;
    return this.lazy_array(middle_lib_features.LibFeatures.to_sorted_vec(lib_features), encode_Symbol_FeatureStability);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2229 encode_stability_implications
  encode_stability_implications(): LazyArray<[Symbol, Symbol]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const implications = tcx.stability_implications(LOCAL_CRATE);
    // PORT: `UnordMap::to_sorted_stable_ord()` sorts by the key's `StableCompare` (`Symbol::stable_cmp`); keys are
    // unique.
    const sorted = [...implications].sort(([a], [b]) => Symbol.stable_cmp(a, b));
    return this.lazy_array(
      sorted.map(([k, v]): [Symbol, Symbol] => [k, v]),
      encode_Symbol_Symbol,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2237 encode_canonical_symbols
  encode_canonical_symbols(): LazyArray<[Symbol, LocalDefId]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const canonical_symbols = tcx.canonical_symbols(LOCAL_CRATE) as CanonicalSymbols;
    return this.lazy_array(
      [...canonical_symbols.iter()].map((cs): [Symbol, LocalDefId] => [cs.symbol, cs.def_id.expect_local()]),
      encode_Symbol_LocalDefId,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2244 encode_diagnostic_items
  encode_diagnostic_items(): LazyArray<[Symbol, LocalDefId]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const diagnostic_items = tcx.diagnostic_items(LOCAL_CRATE).name_to_id;
    return this.lazy_array(
      [...diagnostic_items].map(([name, def_id]): [Symbol, LocalDefId] => [name, def_id.expect_local()]),
      encode_Symbol_LocalDefId,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2253 encode_fake_doc_items
  encode_fake_doc_items(): LazyArray<LocalDefId> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const fake_doc_items = tcx.fake_doc_items(LOCAL_CRATE);
    return this.lazy_array(
      fake_doc_items.map((cs) => cs.expect_local()),
      encode_LocalDefId,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2260 encode_lang_items
  encode_lang_items(): LazyArray<[LocalDefId, LangItem]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const lang_items = this.tcx.lang_items().iter();
    // `.filter_map(|(lang_item, def_id)| def_id.as_local().map(|id| (id, lang_item)))`
    const items: [LocalDefId, LangItem][] = [];
    for (const [lang_item, def_id] of lang_items) {
      const id = def_id.as_local();
      if (id !== undefined) items.push([id, lang_item]);
    }
    return this.lazy_array(items, encode_LocalDefId_LangItem);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2269 encode_lang_items_missing
  encode_lang_items_missing(): LazyArray<LangItem> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    return this.lazy_array(tcx.lang_items().missing, encode_LangItem);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2275 encode_stripped_cfg_items
  encode_stripped_cfg_items(): LazyArray<StrippedCfgItem<LocalDefId>> {
    return this.lazy_array(
      (this.tcx.stripped_cfg_items(LOCAL_CRATE) as readonly StrippedCfgItem<DefId>[]).map((item) => clone_StrippedCfgItem(item, (def_id) => def_id).map_scope_id((def_id) => def_id.expect_local())),
      encode_StrippedCfgItem_LocalDefId,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2284 encode_traits
  encode_traits(): LazyArray<LocalDefId> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    return this.lazy_array(
      this.tcx.traits(LOCAL_CRATE).map((def_id) => def_id.expect_local()),
      encode_LocalDefId,
    );
  }

  /// Encodes an index, mapping each trait to its (local) implementations.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2291 encode_impls
  encode_impls(): LazyArray<TraitImpls> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;
    const trait_impls = new DefIdMap<[LocalDefId, SimplifiedType | undefined][]>();

    for (const id of tcx.hir_free_items()) {
      const def_kind = tcx.def_kind(id.owner_id);
      if (def_kind.$ !== "Impl") {
        continue;
      }
      const of_trait = def_kind.of_trait;
      const local_id = id.owner_id.def_id;

      if (of_trait) {
        const header = tcx.impl_trait_header(local_id) as ImplTraitHeader;
        // record_some_lazy!(self.tables.impl_trait_header[local_id] <- header);
        this.tables.impl_trait_header.set_some(local_id, this.lazy(header, encode_ImplTraitHeader as Encodable<ImplTraitHeader, EncodeContext>));

        const impl_is_fully_generic_for_reflection = tcx.impl_is_fully_generic_for_reflection(local_id);

        // record_value!(self.tables.impl_is_fully_generic_for_reflection[local_id] <- impl_is_fully_generic_for_reflection);
        this.tables.impl_is_fully_generic_for_reflection.set(local_id, impl_is_fully_generic_for_reflection);
        // record_value!(self.tables.defaultness[local_id] <- tcx.defaultness(local_id));
        this.tables.defaultness.set(local_id, tcx.defaultness(local_id) as Defaultness);

        const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref));
        const simplified_self_ty = simplify_type(as_interner(this.tcx), TraitRef.self_ty(trait_ref), TreatParams.InstantiateWithInfer);
        // `trait_impls.entry(trait_ref.def_id).or_default().push((local_id, simplified_self_ty))`
        let entry = trait_impls.get(trait_ref.def_id);
        if (entry === undefined) {
          entry = [];
          trait_impls.set(trait_ref.def_id, entry);
        }
        entry.push([local_id, simplified_self_ty]);

        const trait_def = tcx.trait_def(trait_ref.def_id) as TraitDef;
        const an = trait_def.ancestors(tcx, LocalDefId.to_def_id(local_id));
        if (an.$ === "Ok") {
          // `an.nth(1)`
          const parent = an._0.next() === undefined ? undefined : an._0.next();
          if (parent !== undefined && parent.$ === "Impl") {
            // record_some!(self.tables.impl_parent[local_id] <- parent.into());
            this.tables.impl_parent.set_some(local_id, RawDefId.from(parent._0));
          }
        }

        // if this is an impl of `CoerceUnsized`, create its
        // "unsized info", else just store None
        if (tcx.is_lang_item(trait_ref.def_id, "CoerceUnsized")) {
          const coerce_unsized_info = unwrap_result(tcx.coerce_unsized_info(local_id));
          // record_some_lazy!(self.tables.coerce_unsized_info[local_id] <- coerce_unsized_info);
          this.tables.coerce_unsized_info.set_some(local_id, this.lazy(coerce_unsized_info, encode_CoerceUnsizedInfo as Encodable<CoerceUnsizedInfo, EncodeContext>));
        }
      }
    }

    const trait_impls_: TraitImpls[] = [...trait_impls].map(([trait_def_id, impls]) => ({
      trait_id: RawDefId.from(trait_def_id),
      impls: this.lazy_array(impls, encode_LocalDefId_Option_SimplifiedType),
    }));

    return this.lazy_array(trait_impls_, encode_TraitImpls);
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2352 encode_incoherent_impls
  encode_incoherent_impls(): LazyArray<IncoherentImpls> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const tcx = this.tcx;

    const all_impls: IncoherentImpls[] = [...(tcx.crate_inherent_impls(null)[0] as CrateInherentImpls).incoherent_impls].map(([simp, impls]) => ({
      self_ty: this.lazy(simp, encode_SimplifiedType_DefId),
      impls: this.lazy_array(
        impls.map((def_id) => def_id),
        encode_LocalDefId,
      ),
    }));

    return this.lazy_array(all_impls, encode_IncoherentImpls);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2370 encode_exportable_items
  encode_exportable_items(): LazyArray<LocalDefId> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    return this.lazy_array(
      this.tcx.exportable_items(LOCAL_CRATE).map((def_id) => def_id.expect_local()),
      encode_LocalDefId,
    );
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2377 encode_stable_order_of_exportable_impls
  encode_stable_order_of_exportable_impls(): LazyArray<[LocalDefId, number]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const stable_order_of_exportable_impls = this.tcx.stable_order_of_exportable_impls(LOCAL_CRATE);
    return this.lazy_array(
      [...stable_order_of_exportable_impls].map(([def_id, idx]): [LocalDefId, number] => [def_id.expect_local(), idx]),
      encode_LocalDefId_usize,
    );
  }

  // Encodes all symbols exported from this crate into the metadata.
  //
  // This pass is seeded off the reachability list calculated in the
  // middle::reachable module but filters out items that either don't have a
  // symbol associated with them (they weren't translated) or if they're an FFI
  // definition (as that's not defined in this crate).
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2394 encode_exported_symbols
  encode_exported_symbols(exported_symbols: readonly [ExportedSymbol, SymbolExportInfo][]): LazyArray<[ExportedSymbol, SymbolExportInfo]> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);

    // `exported_symbols.iter().cloned()`
    return this.lazy_array(exported_symbols, encode_ExportedSymbol_SymbolExportInfo);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2403 encode_dylib_dependency_formats
  encode_dylib_dependency_formats(): LazyArray<LinkagePreference | undefined> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self);
    const formats = this.tcx.dependency_formats(null);
    const arr = formats.get("Dylib");
    if (arr !== undefined) {
      return this.lazy_array(
        arr.slice(1 /* skip LOCAL_CRATE */).map((slot): LinkagePreference | undefined => {
          switch (slot) {
            case "NotLinked":
            case "IncludedFromDylib":
              return undefined;

            case "Dynamic":
              return "RequireDynamic";
            case "Static":
              return "RequireStatic";
          }
        }),
        encode_Option_LinkagePreference,
      );
    }
    return LazyArray.default();
  }
}

/** `<EncodeContext as TyEncoder>::CLEAR_CROSS_CRATE` */
export const EncodeContext_CLEAR_CROSS_CRATE = true;

/** `NonZero::new(n)`: `None` for 0. */
function nonzero(n: number): number | undefined {
  return n === 0 ? undefined : n;
}
/** `#[derive(PartialEq)]` of `LazyState`. */
function LazyState_eq(a: LazyState, b: LazyState): boolean {
  return a.$ === b.$ && (a.$ === "NoNode" || a._0 === (b as typeof a)._0);
}
/** `{:?}` of a `LazyState` (`assert_eq!`'s message). */
function debug_LazyState_plain(v: LazyState): string {
  return debug_LazyState(v, PLAIN);
}

// impl<'a, 'tcx> Encodable<EncodeContext<'a, 'tcx>> for ExpnIndex
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:145 encode
export function encode_ExpnIndex(self: ExpnIndex, s: EncodeContext): void {
  s.emit_u32(ExpnIndex.as_u32(self));
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:254 bytes_needed
export function bytes_needed(n: number): number {
  // `(usize::BITS - n.leading_zeros()).div_ceil(u8::BITS)`
  let bits = 0;
  for (let m = n; m > 0; m = Math.floor(m / 2)) bits++;
  return Math.ceil(bits / 8);
}

/** `n.to_le_bytes()` of a `usize` (8 bytes; `n` < 2^53). */
function usize_to_le_bytes(n: number): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0, m = n; i < 8; i++, m = Math.floor(m / 256)) out[i] = m % 256;
  return out;
}

/** `SyntaxContextKey`'s `Encodable` (a tuple `(SyntaxContext, ExpnId, Transparency)`), the inverse of decoder.ts's
 * `decode_tuple_(d, decode_SyntaxContext, decode_ExpnId, decode_Transparency)`. */
function encode_SyntaxContextKey(v: SyntaxContextKey, e: EncodeContext): void {
  encode_tuple(v, e, encode_SyntaxContext, encode_ExpnId, encode_Transparency);
}

// impl<'a, 'tcx> Encodable<EncodeContext<'a, 'tcx>> for SpanData
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:259 encode
export function encode_SpanData(self: SpanData, s: EncodeContext): void {
  // Don't serialize any `SyntaxContext`s from a proc-macro crate,
  // since we don't load proc-macro dependencies during serialization.
  // This means that any hygiene information from macros used *within*
  // a proc-macro crate (e.g. invoking a macro that expands to a proc-macro
  // definition) will be lost.
  //
  // This can show up in two ways:
  //
  // 1. Any hygiene information associated with identifier of
  // a proc macro (e.g. `#[proc_macro] pub fn $name`) will be lost.
  // Since proc-macros can only be invoked from a different crate,
  // real code should never need to care about this.
  //
  // 2. Using `Span::def_site` or `Span::mixed_site` will not
  // include any hygiene information associated with the definition
  // site. This means that a proc-macro cannot emit a `$crate`
  // identifier which resolves to one of its dependencies,
  // which also should never come up in practice.
  //
  // Additionally, this affects `Span::parent`, and any other
  // span inspection APIs that would otherwise allow traversing
  // the `SyntaxContexts` associated with a span.
  //
  // None of these user-visible effects should result in any
  // cross-crate inconsistencies (getting one behavior in the same
  // crate, and a different behavior in another crate) due to the
  // limited surface that proc-macros can expose.
  //
  // IMPORTANT: If this is ever changed, be sure to update
  // `rustc_span::hygiene::raw_encode_expn_id` to handle
  // encoding `ExpnData` for proc-macro crates.
  const ctxt = s.is_proc_macro ? SyntaxContext.root() : self.ctxt;

  if (self.is_dummy()) {
    const tag = SpanTag.new("Partial", ctxt, 0);
    encode_SpanTag(tag, s);
    if (tag.context() === undefined) {
      encode_SyntaxContext(ctxt, s);
    }
    return;
  }

  // The Span infrastructure should make sure that this invariant holds:
  // debug_assert!(self.lo <= self.hi);

  if (!s.source_file_cache[0].contains(self.lo)) {
    const source_map = s.tcx.sess.source_map();
    const source_file_index = source_map.lookup_source_file_idx(self.lo);
    s.source_file_cache = [source_map.files().deref()[source_file_index]!, source_file_index];
  }
  const [source_file, source_file_index] = s.source_file_cache;
  // debug_assert!(source_file.contains(self.lo));

  if (!source_file.contains(self.hi)) {
    // Unfortunately, macro expansion still sometimes generates Spans
    // that malformed in this way.
    const tag = SpanTag.new("Partial", ctxt, 0);
    encode_SpanTag(tag, s);
    if (tag.context() === undefined) {
      encode_SyntaxContext(ctxt, s);
    }
    return;
  }

  // There are two possible cases here:
  // 1. This span comes from a 'foreign' crate - e.g. some crate upstream of the
  // crate we are writing metadata for. When the metadata for *this* crate gets
  // deserialized, the deserializer will need to know which crate it originally came
  // from. We use `TAG_VALID_SPAN_FOREIGN` to indicate that a `CrateNum` should
  // be deserialized after the rest of the span data, which tells the deserializer
  // which crate contains the source map information.
  // 2. This span comes from our own crate. No special handling is needed - we just
  // write `TAG_VALID_SPAN_LOCAL` to let the deserializer know that it should use
  // our own source map information.
  //
  // If we're a proc-macro crate, we always treat this as a local `Span`.
  // In `encode_source_map`, we serialize foreign `SourceFile`s into our metadata
  // if we're a proc-macro crate.
  // This allows us to avoid loading the dependencies of proc-macro crates: all of
  // the information we need to decode `Span`s is stored in the proc-macro crate.
  let kind: SpanKind;
  let metadata_index: number;
  if (source_file.is_imported() && !s.is_proc_macro) {
    // To simplify deserialization, we 'rebase' this span onto the crate it originally came
    // from (the crate that 'owns' the file it references. These rebased 'lo' and 'hi'
    // values are relative to the source map information for the 'foreign' crate whose
    // CrateNum we write into the metadata. This allows `imported_source_files` to binary
    // search through the 'foreign' crate's source map information, using the
    // deserialized 'lo' and 'hi' values directly.
    //
    // All of this logic ensures that the final result of deserialization is a 'normal'
    // Span that can be used without any additional trouble.
    // Introduce a new scope so that we drop the 'read()' temporary
    const src = source_file.external_src.read();
    if (src.$ === "Foreign") {
      metadata_index = src.metadata_index;
    } else {
      return panic(`Unexpected external source ${debug_ExternalSource(src, PLAIN)}`);
    }

    kind = "Foreign";
  } else {
    // Record the fact that we need to encode the data for this `SourceFile`
    const source_files = unwrap(s.required_source_files, "Already encoded SourceMap!");
    // `let (metadata_index, _) = source_files.insert_full(source_file_index);`
    let index = source_files.get(source_file_index);
    if (index === undefined) {
      index = source_files.size;
      source_files.set(source_file_index, index);
    }
    // PORT: `metadata_index.try_into().expect("cannot export more than U32_MAX files")` — the `u32` conversion's panic, as a range check.
    if (index > 0xffff_ffff) return panic("cannot export more than U32_MAX files: TryFromIntError(())");
    metadata_index = index;

    kind = "Local";
  }

  // Encode the start position relative to the file start, so we profit more from the
  // variable-length integer encoding.
  const lo = BytePos.sub(self.lo, source_file.start_pos);

  // Encode length which is usually less than span.hi and profits more
  // from the variable-length integer encoding that we use.
  const len = BytePos.sub(self.hi, self.lo);

  const tag = SpanTag.new(kind, ctxt, len);
  encode_SpanTag(tag, s);
  if (tag.context() === undefined) {
    encode_SyntaxContext(ctxt, s);
  }
  encode_BytePos(lo, s);
  if (tag.length() === undefined) {
    encode_BytePos(len, s);
  }

  // Encode the index of the `SourceFile` for the span, in order to make decoding faster.
  encode_u32(metadata_index, s);

  if (kind === "Foreign") {
    // This needs to be two lines to avoid holding the `s.source_file_cache`
    // while calling `cnum.encode(s)`
    const cnum = s.source_file_cache[0].cnum;
    encode_CrateNum(cnum, s);
  }
}

// impl<'a, 'tcx> Encodable<EncodeContext<'a, 'tcx>> for [u8]
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:402 encode (lane encoder-a)
export function encode_slice_u8(_self: Uint8Array, _e: EncodeContext): void {
  unported("rustc_metadata::rmeta::encoder::encode [u8] (lane encoder-a)");
}

// struct AnalyzeAttrState
export interface AnalyzeAttrState {
  is_exported: boolean;
  is_doc_hidden: boolean;
}

/// Returns whether an attribute needs to be recorded in metadata, that is, if it's usable and
/// useful in downstream crates. Local-only attributes are an obvious example, but some
/// rustdoc-specific attributes can equally be of use while documenting the current crate only.
///
/// Removing these superfluous attributes speeds up compilation by making the metadata smaller.
///
/// Note: the `is_exported` parameter is used to cache whether the given `DefId` has a public
/// visibility: this is a piece of data that can be computed once per defid, and not once per
/// attribute. Some attributes would only be usable downstream if they are public.
// #[inline]
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:945 analyze_attr (lane encoder-b)
export function analyze_attr(_attr: Attribute, _state: AnalyzeAttrState): boolean {
  return unported("rustc_metadata::rmeta::encoder::analyze_attr (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:974 should_encode_span (lane encoder-b)
export function should_encode_span(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_span (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1008 should_encode_attrs (lane encoder-b)
export function should_encode_attrs(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_attrs (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1052 should_encode_expn_that_defined (lane encoder-b)
export function should_encode_expn_that_defined(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_expn_that_defined (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1088 should_encode_visibility (lane encoder-b)
export function should_encode_visibility(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_visibility (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1125 should_encode_stability (lane encoder-b)
export function should_encode_stability(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_stability (lane encoder-b)");
}

/// Whether we should encode MIR. Return a pair, resp. for CTFE and for LLVM.
///
/// Computing, optimizing and encoding the MIR is a relatively expensive operation.
/// We want to avoid this work when not required. Therefore:
/// - we only compute `mir_for_ctfe` on items with const-eval semantics;
/// - we skip `optimized_mir` for check runs.
/// - we only encode `optimized_mir` that could be generated in other crates, that is, a code that
///   is either generic or has inline hint, and is reachable from the other crates (contained
///   in reachable set).
///
/// Note: Reachable set describes definitions that might be generated or referenced from other
/// crates and it can be used to limit optimized MIR that needs to be encoded. On the other hand,
/// the reachable set doesn't have much to say about which definitions might be evaluated at compile
/// time in other crates, so it cannot be used to omit CTFE MIR. For example, `f` below is
/// unreachable and yet it can be evaluated in other crates:
///
/// ```
/// const fn f() -> usize { 0 }
/// pub struct S { pub a: [usize; f()] }
/// ```
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1181 should_encode_mir (lane encoder-b)
export function should_encode_mir(_tcx: TyCtxt, _reachable_set: ReadonlySet<LocalDefId>, _def_id: LocalDefId): [boolean, boolean] {
  return unported("rustc_metadata::rmeta::encoder::should_encode_mir (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1213 should_encode_variances (lane encoder-b)
export function should_encode_variances(_tcx: TyCtxt, _def_id: DefId, _def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_variances (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1252 should_encode_generics (lane encoder-b)
export function should_encode_generics(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_generics (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1288 should_encode_type (lane encoder-b)
export function should_encode_type(_tcx: TyCtxt, _def_id: LocalDefId, _def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_type (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1349 should_encode_fn_sig (lane encoder-b)
export function should_encode_fn_sig(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_fn_sig (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1385 should_encode_constness (lane encoder-b)
export function should_encode_constness(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_constness (lane encoder-b)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:1424 should_encode_const (lane encoder-b)
export function should_encode_const(_def_kind: DefKind): boolean {
  return unported("rustc_metadata::rmeta::encoder::should_encode_const (lane encoder-b)");
}

// ---- encoder-d: the element encoders of the `lazy` / `lazy_array` calls above ----------------------------------
// PORT: `lazy`/`lazy_array` take the element's `Encodable` fn (see the header); these spell the tuple, generic and
// `Option` instances, and stop as UNPORTED for element types whose `Encodable` is not ported yet (each is reached
// only for a non-empty list).

/** `(LocalDefId, LazyValue<ProcMacroKind>)` */
function encode_LocalDefId_LazyValue(v: [LocalDefId, LazyValue<ProcMacroKind>], e: EncodeContext): void {
  encode_tuple(v, e, encode_LocalDefId, encode_LazyValue);
}
/** `ty::Visibility<LocalDefId>` */
function encode_Visibility_LocalDefId(v: Visibility<LocalDefId>, e: EncodeContext): void {
  encode_Visibility(v, e, encode_LocalDefId);
}
/** `(Symbol, FeatureStability)` */
function encode_Symbol_FeatureStability(v: [Symbol, FeatureStability], e: EncodeContext): void {
  encode_tuple(v, e, encode_Symbol, encode_FeatureStability);
}
/** `(Symbol, Symbol)` */
function encode_Symbol_Symbol(v: [Symbol, Symbol], e: EncodeContext): void {
  encode_tuple(v, e, encode_Symbol, encode_Symbol);
}
/** `(Symbol, LocalDefId)` */
function encode_Symbol_LocalDefId(v: [Symbol, LocalDefId], e: EncodeContext): void {
  encode_tuple(v, e, encode_Symbol, encode_LocalDefId);
}
/** `(LocalDefId, LangItem)` */
function encode_LocalDefId_LangItem(v: [LocalDefId, LangItem], e: EncodeContext): void {
  encode_tuple(v, e, encode_LocalDefId, encode_LangItem);
}
/** `(LocalDefId, usize)` */
function encode_LocalDefId_usize(v: [LocalDefId, number], e: EncodeContext): void {
  encode_tuple(v, e, encode_LocalDefId, encode_usize);
}
/** `SimplifiedType<DefId>` */
function encode_SimplifiedType_DefId(v: SimplifiedType, e: EncodeContext): void {
  encode_SimplifiedType(v, e, encode_DefId);
}
/** `(LocalDefId, Option<SimplifiedType>)` */
function encode_LocalDefId_Option_SimplifiedType(v: [LocalDefId, SimplifiedType | undefined], e: EncodeContext): void {
  encode_tuple(v, e, encode_LocalDefId, (x, e) => encode_Option(x, e, encode_SimplifiedType_DefId));
}
/** `StrippedCfgItem<LocalDefId>` */
function encode_StrippedCfgItem_LocalDefId(v: StrippedCfgItem<LocalDefId>, e: EncodeContext): void {
  encode_StrippedCfgItem(v, e, encode_LocalDefId);
}
/** `Option<LinkagePreference>` */
function encode_Option_LinkagePreference(v: LinkagePreference | undefined, e: EncodeContext): void {
  encode_Option(v, e, encode_LinkagePreference);
}
/** `Vec<u8>` / `[u8]` over any `Encoder` (the generic `[T]` impl; the `FileEncoder` specialization writes the same bytes). */
function encode_Vec_u8(v: Uint8Array, s: Encoder): void {
  encode_Vec(v, s, encode_u8);
}
/** `Vec<u8>` over any `Decoder` (the generic impl). */
function decode_Vec_u8(d: Decoder): Uint8Array {
  return Uint8Array.from(decode_Vec(d, decode_u8));
}
/** `DocLinkResMap` (`UnordMap<(Symbol, Namespace), Option<Res<NodeId>>>`): not ported. */
function encode_DocLinkResMap(_v: DocLinkResMap, _e: EncodeContext): void {
  unported("rustc_metadata::rmeta::encoder: Encodable for DocLinkResMap (proc-macro crate doc links)");
}
/** `DebuggerVisualizerFile`'s derived `Encodable`: not generated (rustc_middle middle/debugger_visualizer.rs). */
function encode_DebuggerVisualizerFile(_v: DebuggerVisualizerFile, _e: EncodeContext): void {
  unported("rustc_middle::middle::debugger_visualizer: Encodable for DebuggerVisualizerFile (#[debugger_visualizer])");
}
/** `TargetModifier`'s derived `Encodable`: not generated (rustc_session options.rs; decoder.ts's decoder is unported too). */
function encode_TargetModifier(_v: TargetModifier, _e: EncodeContext): void {
  unported("rustc_session::options: Encodable for TargetModifier (target-modifier flags)");
}
/** `(ExportedSymbol<'static>, SymbolExportInfo)`: not ported (exported symbols are empty without codegen, plan-m5 D5). */
function encode_ExportedSymbol_SymbolExportInfo(_v: [ExportedSymbol, SymbolExportInfo], _e: EncodeContext): void {
  unported("rustc_middle::middle::exported_symbols: Encodable for (ExportedSymbol, SymbolExportInfo) (codegen, M7)");
}

/// Used to prefetch queries which will be needed later by metadata encoding.
/// Only a subset of the queries are actually prefetched to keep this code smaller.
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2422 prefetch_mir
export function prefetch_mir(tcx: TyCtxt): void {
  if (!tcx.sess.opts.output_types.should_codegen()) {
    // We won't emit MIR, so don't prefetch it.
    return;
  }

  const reachable_set = tcx.reachable_set(null) as ReadonlySet<LocalDefId>;
  // PORT: `par_for_each_in` runs the closure for each key in order (no `-Zthreads` parallelism here).
  for (const def_id of tcx.mir_keys(null)) {
    if (tcx.is_trivial_const(def_id)) {
      continue;
    }
    const [encode_const, encode_opt] = should_encode_mir(tcx, reachable_set, def_id);

    if (encode_const) {
      tcx.ensure_done().mir_for_ctfe(def_id);
    }
    if (encode_opt) {
      tcx.ensure_done().optimized_mir(def_id);
    }
    if (encode_opt || encode_const) {
      tcx.ensure_done().promoted_mir(def_id);
    }
  }
}

// NOTE(eddyb) The following comment was preserved for posterity, even
// though it's no longer relevant as EBML (which uses nested & tagged
// "documents") was replaced with a scheme that can't go out of bounds.
//
// And here we run into yet another obscure archive bug: in which metadata
// loaded from archives may have trailing garbage bytes. Awhile back one of
// our tests was failing sporadically on the macOS 64-bit builders (both nopt
// and opt) by having ebml generate an out-of-bounds panic when looking at
// metadata.
//
// Upon investigation it turned out that the metadata file inside of an rlib
// (and ar archive) was being corrupted. Some compilations would generate a
// metadata file which would end in a few extra bytes, while other
// compilations would not have these extra bytes appended to the end. These
// extra bytes were interpreted by ebml as an extra tag, so they ended up
// being interpreted causing the out-of-bounds.
//
// The root cause of why these extra bytes were appearing was never
// discovered, and in the meantime the solution we're employing is to insert
// the length of the metadata to the start of the metadata. Later on this
// will allow us to slice the metadata to the precise length that we just
// generated regardless of trailing bytes that end up in it.

// pub struct EncodedMetadata
// PORT: `full_metadata: Option<Mmap>` holds the file's bytes (read whole, as locator.ts's `get_rmeta_metadata_section`
// does for `Mmap::map`); `_temp_dir: Option<MaybeTempDir>` is fs.ts's `MaybeTempDir` stand-in. Rust drops the struct
// (and so the temp dir) when its owner goes away; here the owner calls `drop()` (rustc_interface's `Linker::link`).
export class EncodedMetadata {
  constructor(
    // The declaration order matters because `full_metadata` should be dropped
    // before `_temp_dir`.
    public full_metadata: Uint8Array | undefined,
    // This is an optional stub metadata containing only the crate header.
    // The header should be very small, so we load it directly into memory.
    public stub_metadata: Uint8Array | undefined,
    // The path containing the metadata, to record as work product.
    public path_: string | undefined,
    // We need to carry MaybeTempDir to avoid deleting the temporary
    // directory while accessing the Mmap.
    public _temp_dir: MaybeTempDir | undefined,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2486 from_path
  static from_path(path: string, stub_path: string | undefined, temp_dir: MaybeTempDir | undefined): IoResult<EncodedMetadata> {
    // PORT: `temp_dir` is taken by value: every return but the last drops it (which removes the directory unless
    // `-C save-temps`), as leaving the fn drops an unmoved argument.
    let file: number;
    try {
      file = openSync(path, "r");
    } catch (e) {
      temp_dir?.drop();
      return Err(io_error_from_node(e));
    }
    let full_mmap: Uint8Array | undefined;
    try {
      let len: number;
      try {
        len = fstatSync(file).size; // `file.metadata()?`
      } catch (e) {
        temp_dir?.drop();
        return Err(io_error_from_node(e));
      }
      if (len === 0) {
        temp_dir?.drop();
        return Ok(new EncodedMetadata(undefined, undefined, undefined, undefined));
      }
      // `unsafe { Some(Mmap::map(file)?) }`
      try {
        const buf = new Uint8Array(len);
        let off = 0;
        while (off < len) {
          const n = readSync(file, buf, off, len - off, off);
          if (n === 0) break;
          off += n;
        }
        full_mmap = buf.subarray(0, off);
      } catch (e) {
        temp_dir?.drop();
        return Err(io_error_from_node(e));
      }
    } finally {
      closeSync(file);
    }

    let stub: Uint8Array | undefined;
    if (stub_path !== undefined) {
      try {
        stub = readFileSync(stub_path);
      } catch (e) {
        temp_dir?.drop();
        return Err(io_error_from_node(e));
      }
    } else {
      stub = undefined;
    }

    return Ok(new EncodedMetadata(full_mmap, stub, path, temp_dir));
  }

  // #[inline]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2515 full
  full(): Uint8Array {
    return this.full_metadata ?? new Uint8Array(0);
  }

  // #[inline]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2520 stub_or_full
  stub_or_full(): Uint8Array {
    return this.stub_metadata ?? this.full();
  }

  // #[inline]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2525 path
  path(): string | undefined {
    return this.path_;
  }

  /** PORT: the drop glue (fields in declaration order: the bytes, then `_temp_dir`, whose drop removes the dir). */
  drop(): void {
    this.full_metadata = undefined;
    this._temp_dir?.drop();
    this._temp_dir = undefined;
  }
}

// impl<S: Encoder> Encodable<S> for EncodedMetadata
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2531 encode
export function encode_EncodedMetadata(self: EncodedMetadata, s: Encoder): void {
  encode_Option(self.stub_metadata, s, encode_Vec_u8);

  const slice = self.full();
  encode_Vec_u8(slice, s);
}

// impl<D: Decoder> Decodable<D> for EncodedMetadata
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2540 decode
export function decode_EncodedMetadata(d: Decoder): EncodedMetadata {
  const stub = decode_Option(d, decode_Vec_u8);

  const len = d.read_usize();
  let full_metadata: Uint8Array | undefined;
  if (len > 0) {
    // `MmapMut::map_anon(len)` + `copy_from_slice` + `make_read_only`: a copy of the bytes.
    const mmap = new Uint8Array(len);
    mmap.set(d.read_raw_bytes(len));
    full_metadata = mmap;
  } else {
    full_metadata = undefined;
  }

  return new EncodedMetadata(full_metadata, stub, undefined, undefined);
}

// #[instrument(level = "trace", skip(tcx))]
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2557 encode_metadata
export function encode_metadata(tcx: TyCtxt, path: string, ref_path: string | undefined): void {
  // Since encoding metadata is not in a query, and nothing is cached,
  // there's no need to do dep-graph tracking for any of it.
  tcx.dep_graph.assert_ignored();

  const _prof_timer = tcx.prof.verbose_generic_activity("generate_crate_metadata");

  // PORT: no dep graph (D3): `DepNode` is not ported (`DepGraph::with_task` takes `undefined`), and building the
  // metadata `DepNode` has no observable effect, so it is built only when the dep graph is enabled (which is
  // unported).
  const dep_node = tcx.dep_graph.is_fully_enabled() ? tcx.metadata_dep_node() : undefined;

  // If the metadata dep-node is green, try to reuse the saved work product.
  if (tcx.dep_graph.is_fully_enabled()) {
    // `let incr_comp_session = tcx.incr_comp_session.unwrap() && let Some(old_incr_comp_session_dir) = .. &&
    // let Some(work_product) = tcx.dep_graph.previous_work_product(..) && tcx.dep_graph.try_mark_green(..)`:
    // copy the saved metadata, read its SVH, and write the stub.
    void dep_node;
    return unported("rustc_metadata::rmeta::encoder::encode_metadata: reuse of the saved metadata work product (-C incremental; D3)");
  }

  if (tcx.sess.opts.jobs.frontend !== undefined) {
    // Prefetch some queries used by metadata encoding.
    // This is not necessary for correctness, but is only done for performance reasons.
    // It can be removed if it turns out to cause trouble or be detrimental to performance.
    // PORT: `par_join(a, b)` runs `a` then `b` (no `-Zthreads` parallelism here).
    prefetch_mir(tcx);
    void tcx.exported_non_generic_symbols(LOCAL_CRATE);
    void tcx.exported_generic_symbols(LOCAL_CRATE);
  }

  // Perform metadata encoding inside a task, so the dep-graph can check if any encoded
  // information changes, and maybe reuse the work product.
  tcx.dep_graph.with_task(
    dep_node as undefined,
    tcx,
    () => {
      with_encode_metadata_header(tcx, path, (ecx) => {
        // Encode all the entries and extra information in the crate,
        // culminating in the `CrateRoot` which points to all of it.
        const [root, unhashed] = ecx.encode_crate_root();

        // Flush buffer to ensure backing file has the correct size.
        ecx.opaque.flush();
        // Record metadata size for self-profiling
        // PORT: `tcx.prof.artifact_size("crate_metadata", "crate_metadata", ecx.opaque.file().metadata().unwrap().len())`:
        // the stand-in `SelfProfilerRef` has no profiler (`-Z self-profile` is unported), so `artifact_size` records
        // nothing; its size argument (an `fstat`) is still read.
        void fstatSync(ecx.opaque.file()).size;

        return [root.position, unhashed.position];
      });
    },
    undefined,
  );

  // Generate the metadata stub manually, as that is a small file compared to full metadata.
  if (ref_path !== undefined) {
    const _prof_timer = tcx.prof.verbose_generic_activity("generate_crate_metadata_stub");

    with_encode_metadata_header(tcx, ref_path, (ecx) => {
      const header: LazyValue<CrateHeader> = ecx.lazy<CrateHeader>(
        {
          name: tcx.crate_name(LOCAL_CRATE),
          triple: tcx.sess.opts.target_triple,
          is_proc_macro_crate: false,
          is_stub: true,
        },
        encode_CrateHeader,
      );
      return [header.position, 0];
    });
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2664 with_encode_metadata_header
export function with_encode_metadata_header(tcx: TyCtxt, path: string, f: (ecx: EncodeContext) => [number, number]): void {
  // By default the crate hash (SVH) is computed from the bytes of the encoded metadata,
  // Under `-Z metadata-crate-hash=no` the SVH comes from the legacy `crate_hash` query instead and
  // this hasher is never consulted, so we skip seeding it and feeding metadata bytes into it.
  const metadata_crate_hash = tcx.sess.opts.unstable_opts.metadata_crate_hash;
  // The SVH is an XXH3-128 digest of the encoded metadata bytes. XXH3 is a fast, non-cryptographic
  // hash; that is sufficient here because the SVH is only a change detector, is never keyed
  // secretly (it must be reproducible), and compiling a crate already runs its build scripts and
  // proc-macros, so the crate author is trusted regardless.
  const metadata_hasher = XxHash3_128.new();
  if (metadata_crate_hash) {
    // Fold in inputs that are not part of the encoded metadata bytes, reduced to a single
    // fingerprint via the stable hasher and then mixed into the byte digest.
    const hir_body_hash = compute_hir_hash(tcx);
    const supplement: Fingerprint = tcx.with_stable_hashing_context((hcx) => {
      const hasher = StableHasher.new();
      // Add dep_tracking_hash to ensure the SVH changes when any tracked flag changes.
      stable_hash_Hash64(tcx.sess.opts.dep_tracking_hash(true), hcx, hasher);
      // Add HIR hash for untracked elements, e.g. DefKind::GlobalAsm.
      stable_hash_Fingerprint(hir_body_hash, hcx, hasher);
      return hasher.finish(Fingerprint);
    });
    metadata_hasher.write(Fingerprint.to_le_bytes(supplement));
  }

  // Feed every flushed byte into `metadata_hasher` so the SVH covers the entire encoded metadata.
  const flush_strategy = (bytes: Uint8Array): void => metadata_hasher.write(bytes);

  const encoder_r = metadata_crate_hash ? FileEncoder.with_flush_strategy(path, flush_strategy) : FileEncoder.new(path);
  const encoder = encoder_r.$ === "Ok" ? encoder_r._0 : tcx.dcx().emit_fatal(FailCreateFileEncoder_diagnostic({ err: encoder_r._0 }));
  encoder.emit_raw_bytes(METADATA_HEADER);

  // Will be filled with the root position after encoding everything.
  encoder.emit_raw_bytes(usize_to_le_bytes(0)); // `0u64.to_le_bytes()`

  // Same with unhashed_position.
  encoder.emit_raw_bytes(usize_to_le_bytes(0)); // `0u64.to_le_bytes()`

  // Same with crate_hash.
  encoder.emit_raw_bytes(Fingerprint.to_le_bytes(Fingerprint.ZERO));

  const source_map_files = tcx.sess.source_map().files();
  const source_file_cache: [SourceFile, number] = [source_map_files.deref()[0]!, 0];
  const required_source_files = new Map<number, number>();

  const ecx = new EncodeContext(
    /* opaque */ encoder,
    /* metadata_hasher */ metadata_hasher,
    tcx,
    /* feat */ tcx.features(),
    /* tables */ TableBuilders_default(),
    /* lazy_state */ LazyState.NoNode,
    /* span_shorthands */ new Map(),
    /* type_shorthands */ new Map(),
    /* predicate_shorthands */ new Map(),
    /* interpret_allocs */ new Map(),
    source_file_cache,
    required_source_files,
    /* is_proc_macro */ tcx.crate_types().includes("ProcMacro"),
    /* hygiene_ctxt */ HygieneEncodeContext.default(),
    /* symbol_index_table */ new Map(),
  );
  // PORT: dropping `ecx` at the end (or on unwinding) closes the file (`FileEncoder`'s `File`).
  try {
    // Encode the rustc version string in a predictable location.
    encode_String(rustc_version(tcx.sess.cfg_version), ecx);

    const [root_position, unhashed_position] = f(ecx);

    // Make sure we report any errors from writing to the file.
    // If we forget this, compilation can succeed with an incomplete rmeta file,
    // causing an ICE when the rmeta file is read by another compilation.
    const finished = ecx.opaque.finish();
    if (finished.$ === "Err") {
      const [path, err] = finished._0;
      tcx.dcx().emit_fatal(FailWriteFile_diagnostic({ path, err }));
    }

    const file = ecx.opaque.file();
    // We will return to this position after writing the root position and crate hash.
    // PORT: the header writers below are positional writes (`pwrite`), which leave the descriptor's offset where
    // it is, so `file.stream_position()` and the final `file.seek(SeekFrom::Start(pos_before_seek))` (which
    // cannot fail on a regular file) have nothing to do.

    const r1 = encode_root_position(file, root_position);
    if (r1.$ === "Err") {
      tcx.dcx().emit_fatal(FailWriteFile_diagnostic({ path: ecx.opaque.path(), err: r1._0 }));
    }

    const r2 = encode_unhashed_position(file, unhashed_position);
    if (r2.$ === "Err") {
      tcx.dcx().emit_fatal(FailWriteFile_diagnostic({ path: ecx.opaque.path(), err: r2._0 }));
    }

    const hash = tcx.untracked().local_crate_hash;
    if (hash === undefined) {
      return panic("local_crate_hash set during encoding");
    }
    const r3 = encode_crate_hash(file, hash);
    if (r3.$ === "Err") {
      tcx.dcx().emit_fatal(FailWriteFile_diagnostic({ path: ecx.opaque.path(), err: r3._0 }));
    }
  } finally {
    ecx.opaque.drop();
  }
}

/** PORT: `file.seek(SeekFrom::Start(offset))?; file.write_all(bytes)?;` as one positional write (`pwrite`). */
function file_write_all_at(file: number, offset: number, bytes: Uint8Array): IoResult<null> {
  try {
    let off = 0;
    while (off < bytes.length) {
      const n = writeSync(file, bytes, off, bytes.length - off, offset + off);
      if (n === 0) return Err({ $: "SimpleMessage", kind: "WriteZero", message: "failed to write whole buffer" });
      off += n;
    }
  } catch (e) {
    return Err(io_error_from_node(e));
  }
  return Ok(null);
}

// PORT: `file: &File` is the open file's descriptor.
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2778 encode_root_position
export function encode_root_position(file: number, pos: number): IoResult<null> {
  const r = file_write_all_at(file, ROOT_POS_OFFSET, usize_to_le_bytes(pos));
  if (r.$ === "Err") return r;
  return Ok(null);
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2784 encode_unhashed_position
export function encode_unhashed_position(file: number, pos: number): IoResult<null> {
  const r = file_write_all_at(file, UNHASHED_POS_OFFSET, usize_to_le_bytes(pos));
  if (r.$ === "Err") return r;
  return Ok(null);
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2790 encode_crate_hash
export function encode_crate_hash(file: number, hash: Svh): IoResult<null> {
  const r = file_write_all_at(file, CRATE_HASH_OFFSET, Fingerprint.to_le_bytes(Svh.as_fingerprint(hash)));
  if (r.$ === "Err") return r;
  return Ok(null);
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2796 provide
export function provide(providers: Providers): void {
  Object.assign(providers, {
    doc_link_resolutions: (tcx: TyCtxt, def_id: LocalModId): DocLinkResMap => {
      const r = tcx.resolutions(null).doc_link_resolutions.get(def_id);
      return r !== undefined ? r : span_bug(tcx.def_span(LocalModId.to_def_id(def_id)), "no resolutions for a doc link");
    },
    doc_link_traits_in_scope: (tcx: TyCtxt, def_id: LocalModId): readonly DefId[] => {
      const r = tcx.resolutions(null).doc_link_traits_in_scope.get(def_id);
      return r !== undefined ? r : span_bug(tcx.def_span(LocalModId.to_def_id(def_id)), "no traits in scope for a doc link");
    },
  } satisfies Partial<Providers>);
}

/// Build a textual representation of an unevaluated constant expression.
///
/// If the const expression is too complex, an underscore `_` is returned.
/// For const arguments, it's `{ _ }` to be precise.
/// This means that the output is not necessarily valid Rust code.
///
/// Currently, only
///
/// * literals (optionally with a leading `-`)
/// * unit `()`
/// * blocks (`{ … }`) around simple expressions and
/// * paths without arguments
///
/// are considered simple enough. Simple blocks are included since they are
/// necessary to disambiguate unit from the unit type.
/// This list might get extended in the future.
///
/// Without this censoring, in a lot of cases the output would get too large
/// and verbose. Consider `match` expressions, blocks and deeply nested ADTs.
/// Further, private and `doc(hidden)` fields of structs would get leaked
/// since HIR datatypes like the `body` parameter do not contain enough
/// semantic information for this function to be able to hide them –
/// at least not without significant performance overhead.
///
/// Whenever possible, prefer to evaluate the constant first and try to
/// use a different method for pretty-printing. Ideally this function
/// should only ever be used as a fallback.
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2841 rendered_const
export function rendered_const(tcx: TyCtxt, body: Body, def_id: LocalDefId): string {
  const value = body.value;

  switch (classify(value)) {
    // For non-macro literals, we avoid invoking the pretty-printer and use the source snippet
    // instead to preserve certain stylistic choices the user likely made for the sake of
    // legibility, like:
    //
    // * hexadecimal notation
    // * underscores
    // * character escapes
    //
    // FIXME: This passes through `-/*spacer*/0` verbatim.
    case "Literal": {
      if (!Span.from_expansion(value.span)) {
        const snippet = tcx.sess.source_map().span_to_snippet(value.span);
        if (snippet.$ === "Ok") {
          return snippet._0.toString();
        }
      }
      // Otherwise we prefer pretty-printing to get rid of extraneous whitespace, comments and
      // other formatting artifacts.
      return id_to_string(TyCtxt_as_HirTyCtxt(tcx), body.id().hir_id);
    }

    // Otherwise we prefer pretty-printing to get rid of extraneous whitespace, comments and
    // other formatting artifacts.
    case "Simple":
      return id_to_string(TyCtxt_as_HirTyCtxt(tcx), body.id().hir_id);

    // FIXME: Omit the curly braces if the enclosing expression is an array literal
    //        with a repeated element (an `ExprKind::Repeat`) as in such case it
    //        would not actually need any disambiguation.
    case "Complex": {
      const def_kind = tcx.def_kind(def_id);
      if (def_kind.$ === "AnonConst") {
        return "{ _ }";
      } else {
        return "_";
      }
    }
  }
}

// PORT: `rendered_const`'s local `enum Classification { Literal, Simple, Complex }` and `fn classify`, at module level.
type Classification = "Literal" | "Simple" | "Complex";

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2853 classify
export function classify(expr: Expr): Classification {
  const kind = expr.kind;
  switch (kind.$) {
    case "Unary": {
      if (kind._0 === "Neg") {
        const expr_ = kind._1;
        if (expr_.kind.$ === "Lit") {
          return "Literal";
        } else {
          return "Complex";
        }
      }
      return "Complex";
    }
    case "Lit":
      return "Literal";
    case "Tup":
      if (kind._0.length === 0) return "Simple";
      return "Complex";
    case "Block": {
      const block = kind._0;
      if (block.stmts.length === 0 && block.expr !== undefined) {
        if (classify(block.expr) === "Complex") {
          return "Complex";
        } else {
          return "Simple";
        }
      }
      return "Complex";
    }
    // Paths with a self-type or arguments are too “complex” following our measure since
    // they may leak private fields of structs (with feature `adt_const_params`).
    // Consider: `<Self as Trait<{ Struct { private: () } }>>::CONSTANT`.
    // Paths without arguments are definitely harmless though.
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "Resolved") {
        const segments = qpath._1.segments;
        if (segments.every((segment) => segment.args === undefined)) {
          return "Simple";
        } else {
          return "Complex";
        }
      }
      // FIXME: Claiming that those kinds of QPaths are simple is probably not true if the Ty
      //        contains const arguments. Is there a *concise* way to check for this?
      return "Simple";
    }
    default:
      return "Complex";
  }
}
