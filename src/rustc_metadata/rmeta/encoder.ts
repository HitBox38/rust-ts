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
import { DefKind, encode_Namespace, encode_Res, Res } from "../../rustc_hir/def.ts";
import { encode_OpaqueTyOrigin, encode_PreciseCapturingArgKind, type OpaqueTyOrigin, type PreciseCapturingArgKind } from "../../rustc_hir/hir.ts";
import { ast, node_id } from "../../rustc_ast/lib.ts";
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { encode_ReprOptions } from "../../rustc_abi/decodable.gen.ts";
import { encode_ConstStability, encode_DefaultBodyStability, encode_Stability, type ConstStability, type DefaultBodyStability, type Stability } from "../../rustc_attr_ir/stability.ts";
import { encode_Deprecation, encode_EiiDecl, encode_EiiImpl, type EiiImpl } from "../../rustc_attr_ir/data_structures.ts";
import { encode_DenseBitSet } from "../../rustc_index/decodable.gen.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type CodegenFnAttrs, encode_CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { DeducedParamAttrs } from "../../rustc_middle/middle/deduced_param_attrs.ts";
import type { ObjectLifetimeDefault } from "../../rustc_middle/middle/resolve_bound_vars.ts";
import type { AmbigModChild, DocLinkResMap } from "../../rustc_middle/middle/resolve.ts";
import {
  encode_AmbigModChild,
  encode_AsyncDestructor,
  encode_ConstConditions,
  encode_DeducedParamAttrs,
  encode_Destructor,
  encode_GenericClauses,
  encode_Generics,
  encode_ImplTraitInTraitData,
  encode_IntrinsicDef,
  encode_ModChild,
  encode_ObjectLifetimeDefault,
  encode_RestrictionKind,
  encode_TraitDef,
  encode_Visibility as encode_ty_Visibility,
} from "../../rustc_middle/decodable.gen.ts";
import { type Body as MirBody, type ConstValue, encode_Body, encode_ConstQualifs, encode_ConstValue, encode_CoroutineLayout } from "../../rustc_middle/mir/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, type AssocItem as AssocItemT, encode_AssocContainer } from "../../rustc_middle/ty/assoc.ts";
import { encode_Clause, encode_ConstAllocation, encode_List_BoundVariableKind, encode_Ty, encode_ty_Const } from "../../rustc_middle/ty/codec.ts";
import type { Const } from "../../rustc_middle/ty/consts.ts";
import { VariantIdx } from "../../rustc_middle/ty/decls.ts";
import type { ConstConditions, Generics } from "../../rustc_middle/ty/generics.ts";
import { type AsyncDestructor, type CrateInherentImpls, type Destructor, Visibility } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { type Binder, EarlyBinder, encode_EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { type AnonConstKind, encode_AnonConstKind } from "../../rustc_type_ir/const_kind.ts";
import { encode_Variance, type Variance } from "../../rustc_type_ir/lib.ts";
import { encode_TraitRef, type TraitRef } from "../../rustc_type_ir/predicate.ts";
import { encode_Binder } from "../../rustc_type_ir/serialize.ts";
import { encode_FnSig, type FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { EiiMap } from "../eii.ts";
import { encode_VariantData } from "../decodable.gen.ts";
import type { Body, Expr } from "../../rustc_hir/hir.ts";
import type { DebuggerVisualizerFile } from "../../rustc_middle/middle/debugger_visualizer.ts";
import type { FeatureStability } from "../../rustc_middle/middle/mod.ts";
import type { AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyEncoder } from "../../rustc_middle/ty/codec.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Encodable, type Encoder, Encoder_provided, encode_bool, encode_HashMap, encode_Option, encode_String, encode_tuple, encode_u32, encode_usize, encode_Vec } from "../../rustc_serialize/serialize.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import { encode_ExpnData, encode_ExpnHash, encode_Ident, encode_Transparency } from "../../rustc_span/decodable.gen.ts";
import { CRATE_DEF_ID, CrateNum, type DefId, DefIndex, debug_CrateNum, encode_LocalDefId, LOCAL_CRATE, LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import { type ExpnData, type ExpnHash, type ExpnId, ExpnIndex, HygieneEncodeContext, LocalExpnId, SyntaxContext, type SyntaxContextKey } from "../../rustc_span/hygiene.ts";
import { BytePos, debug_ExternalSource, encode_BytePos, encode_CrateNum, encode_DefId, encode_ExpnId, encode_SourceFile, encode_Span, encode_Symbol, encode_SyntaxContext, RealFileName, type SourceFile, Span, type SpanData, StableSourceFileId } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { ByteSymbol, type Ident, Symbol } from "../../rustc_span/symbol.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { XxHash3_128 } from "../../vendor/twox_hash/lib.ts";
import { encode_SpanTag } from "../decodable.gen.ts";
import type { EiiMapEncodedKeyValue } from "../eii.ts";
import type { Svh } from "./decoder.ts";
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
  RawDefId,
  type VariantData,
} from "./mod.ts";
import { type Asyncness, type Constness, type CoroutineKind, fse_Option_LazyValue, TableBuilder } from "./table.ts";

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

  // PORT: the table macros (encoder.rs:430-468) are expanded in place, keeping their evaluation order (the value, then
  // `lazy`/`lazy_array`, then the table write):
  // - `record_some_lazy!(t[i] <- v)` -> `this.tables.t.set_some(i, this.lazy(v, encode_T))`;
  // - `record_some!(t[i] <- v)` -> `this.tables.t.set_some(i, v)`; `record_value!(t[i] <- v)` -> `this.tables.t.set(i, v)`;
  // - `record_array!(t[i] <- v)` -> `this.tables.t.set_some(i, this.lazy_array(v, encode_T))`;
  // - `record_defaulted_array!(t[i] <- v)` -> `this.tables.t.set(i, this.lazy_array(v, encode_T))`.
  // `encode_T` is the `Encodable` impl of the table's element type (the decode side is rmeta/decoder/cstore_impl.ts).

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1482 encode_def_ids
  encode_def_ids(): void {
    this.encode_info_for_mod(CRATE_DEF_ID);

    // Proc-macro crates only export proc-macro items, which are looked
    // up using `proc_macro_data`
    if (this.is_proc_macro) {
      return;
    }

    const tcx = this.tcx;

    for (const local_id of tcx.iter_local_def_id()) {
      const def_id = LocalDefId.to_def_id(local_id);
      const def_kind = tcx.def_kind(local_id);
      this.tables.def_kind.set_some(local_id, def_kind);

      // The `DefCollector` will sometimes create unnecessary `DefId`s
      // for trivial const arguments which are directly lowered to
      // `ConstArgKind::Path`. We never actually access this `DefId`
      // anywhere so we don't need to encode it for other crates.
      // FIXME(mgca): This probably isn't true, they probably are accessed, but, test case?
      if (def_kind.$ === "AnonConst") {
        const node = tcx.hir_node_by_def_id(local_id);
        if (node.$ === "ConstArg" || (node.$ === "Infer" && node._0.kind === "Const")) {
          continue;
        }
      }

      if (def_kind.$ === "Field") {
        const node = tcx.hir_node_by_def_id(local_id);
        if (node.$ === "Field") {
          const anon = node._0.default;
          if (anon !== undefined) {
            this.tables.default_fields.set_some(local_id, this.lazy(LocalDefId.to_def_id(anon.def_id), encode_DefId));
          }
        }
      }

      if (should_encode_span(def_kind)) {
        const def_span = tcx.def_span(local_id);
        this.tables.def_span.set_some(local_id, this.lazy(def_span, encode_Span));
      }
      if (should_encode_attrs(def_kind)) {
        this.encode_attrs(local_id);
      }
      if (should_encode_expn_that_defined(def_kind)) {
        this.tables.expn_that_defined.set_some(local_id, this.lazy(this.tcx.expn_that_defined(def_id), encode_ExpnId));
      }
      if (should_encode_span(def_kind)) {
        const ident_span = tcx.def_ident_span(def_id);
        if (ident_span !== undefined) {
          this.tables.def_ident_span.set_some(local_id, this.lazy(ident_span, encode_Span));
        }
      }
      if (DefKind.has_codegen_attrs(def_kind)) {
        this.tables.codegen_fn_attrs.set_some(local_id, this.lazy(this.tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs, encode_CodegenFnAttrs));
      }
      if (should_encode_visibility(def_kind)) {
        const vis = Visibility.map_id(this.tcx.local_visibility(local_id), (mod_id) => LocalModId.to_local_def_id(mod_id));
        this.tables.visibility.set_some(local_id, this.lazy(vis, encode_Visibility_LocalDefId));
      }
      if (should_encode_stability(def_kind)) {
        this.encode_stability(local_id);
        this.encode_const_stability(local_id);
        this.encode_default_body_stability(local_id);
        this.encode_deprecation(local_id);
      }
      if (should_encode_variances(tcx, def_id, def_kind)) {
        const v = this.tcx.variances_of(def_id) as readonly Variance[];
        this.tables.variances_of.set_some(local_id, this.lazy_array(v, encode_Variance));
      }
      if (should_encode_fn_sig(def_kind)) {
        this.tables.fn_sig.set_some(local_id, this.lazy(tcx.fn_sig(def_id), encode_EarlyBinder_PolyFnSig));
      }
      if (should_encode_generics(def_kind)) {
        const g = tcx.generics_of(def_id) as Generics;
        this.tables.generics_of.set_some(local_id, this.lazy(g, encode_Generics));
        this.tables.explicit_clauses_of.set_some(local_id, this.lazy(this.tcx.explicit_clauses_of(def_id), encode_GenericClauses));
        const inferred_outlives = this.tcx.inferred_outlives_of(def_id);
        this.tables.inferred_outlives_of.set(local_id, this.lazy_array(inferred_outlives, encode_Clause_Span));

        for (const param of g.own_params) {
          if (param.kind.$ === "Const" && param.kind.has_default) {
            const default_ = this.tcx.const_param_default(param.def_id) as EarlyBinder<Const>;
            this.tables.const_param_default.set_some(param.def_id.expect_local(), this.lazy(default_, encode_EarlyBinder_Const));
          }
        }
      }
      if (tcx.is_conditionally_const(def_id)) {
        this.tables.const_conditions.set_some(local_id, this.lazy(this.tcx.const_conditions(def_id) as ConstConditions, encode_ConstConditions));
      }
      if (should_encode_type(tcx, local_id, def_kind)) {
        this.tables.type_of.set_some(local_id, this.lazy(this.tcx.type_of(def_id), encode_EarlyBinder_Ty));
      }
      if (should_encode_constness(def_kind)) {
        const constness = this.tcx.constness(def_id) as Constness;
        this.tables.constness.set(local_id, constness);
      }
      if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
        const asyncness = tcx.asyncness(def_id) as Asyncness;
        this.tables.asyncness.set(local_id, asyncness);
        this.tables.fn_arg_idents.set_some(local_id, this.lazy_array(tcx.fn_arg_idents(def_id), encode_Option_Ident));
      }
      const name = tcx.intrinsic(def_id);
      if (name !== undefined) {
        this.tables.intrinsic.set_some(local_id, this.lazy(name, encode_IntrinsicDef));
      }
      if (def_kind.$ === "TyParam" || def_kind.$ === "Trait") {
        const default_ = this.tcx.object_lifetime_default(def_id) as ObjectLifetimeDefault;
        this.tables.object_lifetime_default.set_some(local_id, this.lazy(default_, encode_ObjectLifetimeDefault));
      }
      if (def_kind.$ === "Trait") {
        this.tables.trait_def.set_some(local_id, this.lazy(this.tcx.trait_def(def_id) as TraitDef, encode_TraitDef));
        this.tables.explicit_super_clauses_of.set(local_id, this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_super_clauses_of(def_id)), encode_Clause_Span));
        this.tables.explicit_implied_clauses_of.set(local_id, this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_implied_clauses_of(def_id)), encode_Clause_Span));
        const module_children = this.tcx.module_children_local(local_id);
        this.tables.module_children_non_reexports.set_some(
          local_id,
          this.lazy_array(
            module_children.map((child) => Res.def_id(child.res, debug_never).expect_local()),
            encode_LocalDefId,
          ),
        );
        if (this.tcx.is_const_trait(def_id)) {
          this.tables.explicit_implied_const_bounds.set(
            local_id,
            this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_implied_const_bounds(def_id)) as readonly [Binder<TraitRef>, Span][], encode_PolyTraitRef_Span),
          );
        }
      }
      if (def_kind.$ === "TraitAlias") {
        this.tables.trait_def.set_some(local_id, this.lazy(this.tcx.trait_def(def_id) as TraitDef, encode_TraitDef));
        this.tables.explicit_super_clauses_of.set(local_id, this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_super_clauses_of(def_id)), encode_Clause_Span));
        this.tables.explicit_implied_clauses_of.set(local_id, this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_implied_clauses_of(def_id)), encode_Clause_Span));
      }
      if (def_kind.$ === "Trait" || def_kind.$ === "Impl") {
        const associated_item_def_ids = this.tcx.associated_item_def_ids(def_id);
        this.tables.associated_item_or_field_def_ids.set_some(
          local_id,
          this.lazy_array(
            associated_item_def_ids.map((def_id) => {
              return def_id.expect_local();
            }),
            encode_LocalDefId,
          ),
        );
        for (const def_id of associated_item_def_ids) {
          this.encode_info_for_assoc_item(def_id.expect_local());
        }
      }
      if (def_kind.$ === "Closure" || def_kind.$ === "SyntheticCoroutineBody") {
        const coroutine_kind = this.tcx.coroutine_kind(def_id) as CoroutineKind | undefined;
        if (coroutine_kind !== undefined) {
          this.tables.coroutine_kind.set(local_id, coroutine_kind);
        }
      }
      if (def_kind.$ === "Closure" && EarlyBinder.skip_binder(tcx.type_of(def_id)).is_coroutine_closure()) {
        const coroutine_for_closure = this.tcx.coroutine_for_closure(def_id);
        this.tables.coroutine_for_closure.set_some(local_id, RawDefId.from(coroutine_for_closure));

        // If this async closure has a by-move body, record it too.
        if (tcx.needs_coroutine_by_move_body_def_id(coroutine_for_closure)) {
          const id = this.tcx.coroutine_by_move_body_def_id(coroutine_for_closure);
          this.tables.coroutine_by_move_body_def_id.set_some(coroutine_for_closure.expect_local(), RawDefId.from(id));
        }
      }
      if (def_kind.$ === "Static") {
        if (!this.tcx.is_foreign_item(def_id)) {
          const r = this.tcx.eval_static_initializer(def_id);
          switch (r.$) {
            case "Ok": {
              const data = r._0;
              this.tables.eval_static_initializer.set_some(local_id, this.lazy(data, encode_ConstAllocation));
              break;
            }
            case "Err": {
              const err = r._0;
              switch (err.$) {
                case "Reported":
                  this.tcx.dcx().delayed_bug(`eval_static_initializer returned an error in metadata emission`);
                  break;
                case "TooGeneric": {
                  const span = err._0;
                  span_bug(span, "generic static???");
                }
              }
              break;
            }
          }
        }
      }
      if (def_kind.$ === "Enum" || def_kind.$ === "Struct" || def_kind.$ === "Union") {
        this.encode_info_for_adt(local_id);
      }
      if (def_kind.$ === "Mod") {
        this.encode_info_for_mod(local_id);
      }
      if (def_kind.$ === "Macro") {
        this.encode_info_for_macro(local_id);
      }
      if (def_kind.$ === "TyAlias") {
        this.tables.type_alias_is_checked.set(local_id, this.tcx.type_alias_is_checked(def_id));

        if (this.tcx.type_alias_is_checked(def_id)) {
          this.tables.args_known_to_outlive_alias_params.set_some(
            local_id,
            this.lazy(tcx.args_known_to_outlive_alias_params(def_id) as [number, DenseBitSet][], encode_Vec_usize_DenseBitSet),
          );
        }
      }
      if (def_kind.$ === "OpaqueTy") {
        this.encode_explicit_item_bounds(local_id);
        this.encode_explicit_item_self_bounds(local_id);
        this.tables.opaque_ty_origin.set_some(local_id, this.lazy(this.tcx.opaque_ty_origin(def_id) as OpaqueTyOrigin<DefId>, encode_OpaqueTyOrigin_DefId));
        this.encode_precise_capturing_args(local_id);
        if (tcx.is_conditionally_const(def_id)) {
          this.tables.explicit_implied_const_bounds.set(
            local_id,
            this.lazy_array(EarlyBinder.skip_binder(tcx.explicit_implied_const_bounds(def_id)) as readonly [Binder<TraitRef>, Span][], encode_PolyTraitRef_Span),
          );
        }
        this.tables.args_known_to_outlive_alias_params.set_some(
          local_id,
          this.lazy(tcx.args_known_to_outlive_alias_params(def_id) as [number, DenseBitSet][], encode_Vec_usize_DenseBitSet),
        );
      }
      if (def_kind.$ === "AssocTy") {
        const assoc_item = tcx.associated_item(def_id) as AssocItemT;
        switch (assoc_item.container.$) {
          case "Trait": {
            this.tables.args_known_to_outlive_alias_params.set_some(
              local_id,
              this.lazy(tcx.args_known_to_outlive_alias_params(def_id) as [number, DenseBitSet][], encode_Vec_usize_DenseBitSet),
            );
            break;
          }
          case "InherentImpl": {
            this.tables.args_known_to_outlive_alias_params.set_some(
              local_id,
              this.lazy(tcx.args_known_to_outlive_alias_params(def_id) as [number, DenseBitSet][], encode_Vec_usize_DenseBitSet),
            );
            break;
          }
          case "TraitImpl":
            break;
        }
      }
      if (def_kind.$ === "AnonConst") {
        this.tables.anon_const_kind.set_some(local_id, this.lazy(this.tcx.anon_const_kind(def_id) as AnonConstKind, encode_AnonConstKind));
      }
      if (def_kind.$ === "Const" || def_kind.$ === "AssocConst") {
        this.tables.const_of_item.set_some(local_id, this.lazy(this.tcx.const_of_item(def_id) as EarlyBinder<Const> | undefined, encode_Option_EarlyBinder_Const));
      }
      if (tcx.impl_method_has_trait_impl_trait_tys(def_id)) {
        const r = this.tcx.collect_return_position_impl_trait_in_trait_tys(def_id);
        if (r.$ === "Ok") {
          const table = r._0;
          this.tables.collect_return_position_impl_trait_in_trait_tys.set_some(local_id, this.lazy(table, encode_DefIdMap_EarlyBinder_Ty));
        }
      }
      if (def_kind.$ === "Impl" || def_kind.$ === "Trait") {
        const table = tcx.associated_types_for_impl_traits_in_trait_or_impl(def_id);
        this.tables.associated_types_for_impl_traits_in_trait_or_impl.set_some(local_id, this.lazy(table, encode_DefIdMap_Vec_DefId));
      }
    }

    for (const [def_id, impls] of (tcx.crate_inherent_impls(null)[0] as CrateInherentImpls).inherent_impls) {
      this.tables.inherent_impls.set(
        def_id,
        this.lazy_array(
          impls.map((def_id) => {
            return def_id.expect_local();
          }),
          encode_LocalDefId,
        ),
      );
    }

    for (const [def_id, res_map] of tcx.resolutions(null).doc_link_resolutions) {
      this.tables.doc_link_resolutions.set_some(LocalModId.to_local_def_id(def_id), this.lazy(res_map, encode_DocLinkResMap));
    }

    for (const [def_id, traits] of tcx.resolutions(null).doc_link_traits_in_scope) {
      this.tables.doc_link_traits_in_scope.set_some(LocalModId.to_local_def_id(def_id), this.lazy_array(traits, encode_DefId));
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1733 encode_externally_implementable_items
  encode_externally_implementable_items(): LazyArray<EiiMapEncodedKeyValue> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self)
    const externally_implementable_items = this.tcx.externally_implementable_items(LOCAL_CRATE) as EiiMap;

    return this.lazy_array(
      [...externally_implementable_items].map(([foreign_item, [decl, impls]]): EiiMapEncodedKeyValue => {
        // PORT: `decl.clone()`: the encoder only reads it.
        return [foreign_item, [decl, [...impls].map(([impl_did, i]): [DefId, EiiImpl] => [impl_did, i])]];
      }),
      encode_EiiMapEncodedKeyValue,
    );
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1748 encode_info_for_adt
  encode_info_for_adt(local_def_id: LocalDefId): void {
    const def_id = LocalDefId.to_def_id(local_def_id);
    const tcx = this.tcx;
    const adt_def = tcx.adt_def(def_id) as AdtDef;
    this.tables.repr_options.set_some(local_def_id, this.lazy(adt_def.repr(), encode_ReprOptions));

    const params_in_repr = this.tcx.params_in_repr(def_id) as DenseBitSet;
    this.tables.params_in_repr.set_some(local_def_id, this.lazy(params_in_repr, encode_DenseBitSet));

    if (adt_def.is_enum()) {
      const module_children = tcx.module_children_local(local_def_id);
      this.tables.module_children_non_reexports.set_some(
        local_def_id,
        this.lazy_array(
          module_children.map((child) => Res.def_id(child.res, debug_never).expect_local()),
          encode_LocalDefId,
        ),
      );
    } else {
      // For non-enum, there is only one variant, and its def_id is the adt's.
      // debug_assert_eq!(adt_def.variants().len(), 1);
      // debug_assert_eq!(adt_def.non_enum_variant().def_id, def_id);
      // Therefore, the loop over variants will encode its fields as the adt's children.
    }

    const variants = adt_def.variants();
    for (let i = 0; i < variants.length; i++) {
      const idx = VariantIdx.from_usize(i);
      const variant = variants[i]!;
      const variant_id = variant.def_id.expect_local();

      const data: VariantData = {
        discr: variant.discr,
        idx,
        ctor: variant.ctor === undefined ? undefined : [variant.ctor[0], variant.ctor[1].expect_local()],
        is_non_exhaustive: variant.is_field_list_non_exhaustive(),
      };
      this.tables.variant_data.set_some(variant_id, this.lazy(data, encode_VariantData));

      this.tables.associated_item_or_field_def_ids.set_some(
        variant_id,
        this.lazy_array(
          variant.fields.map((f) => {
            return f.did.expect_local();
          }),
          encode_LocalDefId,
        ),
      );

      for (const field of variant.fields) {
        const field_id = field.did.expect_local();
        this.tables.safety.set(field_id, field.safety);
        this.tables.mut_restriction.set_some(field_id, this.lazy(field.mut_restriction, encode_RestrictionKind));
      }

      if (variant.ctor !== undefined && variant.ctor[0] === "Fn") {
        const ctor_def_id = variant.ctor[1];
        const fn_sig = tcx.fn_sig(ctor_def_id);
        // FIXME only encode signature for ctor_def_id
        this.tables.fn_sig.set_some(variant_id, this.lazy(fn_sig, encode_EarlyBinder_PolyFnSig));
      }
    }

    const destructor = tcx.adt_destructor(local_def_id) as Destructor | undefined;
    if (destructor !== undefined) {
      this.tables.adt_destructor.set_some(local_def_id, this.lazy(destructor, encode_Destructor));
    }

    const async_destructor = tcx.adt_async_destructor(local_def_id) as AsyncDestructor | undefined;
    if (async_destructor !== undefined) {
      this.tables.adt_async_destructor.set_some(local_def_id, this.lazy(async_destructor, encode_AsyncDestructor));
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1808 encode_info_for_mod
  encode_info_for_mod(local_def_id: LocalDefId): void {
    const tcx = this.tcx;

    // If we are encoding a proc-macro crates, `encode_info_for_mod` will
    // only ever get called for the crate root. We still want to encode
    // the crate root for consistency with other crates (some of the resolver
    // code uses it). However, we skip encoding anything relating to child
    // items - we encode information about proc-macros later on.
    if (this.is_proc_macro) {
      // Encode this here because we don't do it in encode_def_ids.
      this.tables.expn_that_defined.set_some(local_def_id, this.lazy(tcx.expn_that_defined(local_def_id), encode_ExpnId));
    } else {
      const module_children = tcx.module_children_local(local_def_id);

      this.tables.module_children_non_reexports.set_some(
        local_def_id,
        this.lazy_array(
          module_children.filter((child) => child.reexport_chain.length === 0).map((child) => Res.def_id(child.res, debug_never).expect_local()),
          encode_LocalDefId,
        ),
      );

      this.tables.module_children_reexports.set(
        local_def_id,
        this.lazy_array(
          module_children.filter((child) => child.reexport_chain.length !== 0),
          encode_ModChild,
        ),
      );

      const ambig_module_children: readonly AmbigModChild[] = tcx.resolutions(null).ambig_module_children.get(local_def_id) ?? [];
      this.tables.ambig_module_children.set(local_def_id, this.lazy_array(ambig_module_children, encode_AmbigModChild));
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1839 encode_explicit_item_bounds
  encode_explicit_item_bounds(def_id: LocalDefId): void {
    // debug!("EncodeContext::encode_explicit_item_bounds({:?})", def_id);
    const bounds = EarlyBinder.skip_binder(this.tcx.explicit_item_bounds(def_id));
    this.tables.explicit_item_bounds.set(def_id, this.lazy_array(bounds, encode_Clause_Span));
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1845 encode_explicit_item_self_bounds
  encode_explicit_item_self_bounds(def_id: LocalDefId): void {
    // debug!("EncodeContext::encode_explicit_item_self_bounds({:?})", def_id);
    const bounds = EarlyBinder.skip_binder(this.tcx.explicit_item_self_bounds(def_id));
    this.tables.explicit_item_self_bounds.set(def_id, this.lazy_array(bounds, encode_Clause_Span));
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1852 encode_info_for_assoc_item
  encode_info_for_assoc_item(def_id: LocalDefId): void {
    const tcx = this.tcx;
    const item = tcx.associated_item(def_id) as AssocItemT;

    if (item.container.$ === "Trait" || item.container.$ === "TraitImpl") {
      this.tables.defaultness.set(def_id, AssocItem.defaultness(item, tcx));
    }

    this.tables.assoc_container.set_some(def_id, this.lazy(item.container, encode_AssocContainer));

    if (item.container.$ === "Trait" && AssocItem.is_type(item)) {
      this.encode_explicit_item_bounds(def_id);
      this.encode_explicit_item_self_bounds(def_id);
      if (tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
        this.tables.explicit_implied_const_bounds.set(
          def_id,
          this.lazy_array(EarlyBinder.skip_binder(this.tcx.explicit_implied_const_bounds(def_id)) as readonly [Binder<TraitRef>, Span][], encode_PolyTraitRef_Span),
        );
      }
    }
    if (item.kind.$ === "Type" && item.kind.data.$ === "Rpitit") {
      const rpitit_info = item.kind.data._0;
      this.tables.opt_rpitit_info.set_some(def_id, this.lazy(rpitit_info, encode_ImplTraitInTraitData));
      if (rpitit_info.$ === "Trait") {
        this.tables.assumed_wf_types_for_rpitit.set_some(def_id, this.lazy_array(this.tcx.assumed_wf_types_for_rpitit(def_id), encode_Ty_Span));
        this.encode_precise_capturing_args(def_id);
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1884 encode_precise_capturing_args
  encode_precise_capturing_args(def_id: LocalDefId): void {
    const precise_capturing_args = this.tcx.rendered_precise_capturing_args(def_id) as readonly PreciseCapturingArgKind<Symbol, Symbol>[] | undefined;
    if (precise_capturing_args === undefined) {
      return;
    }

    this.tables.rendered_precise_capturing_args.set_some(def_id, this.lazy_array(precise_capturing_args, encode_PreciseCapturingArgKind_Symbol));
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1892 encode_mir
  encode_mir(): void {
    if (this.is_proc_macro) {
      return;
    }

    const tcx = this.tcx;
    const reachable_set = tcx.reachable_set(null) as ReadonlySet<LocalDefId>;

    // PORT: `filter_map` is lazy: `should_encode_mir` runs for each key just before that key's body is encoded.
    const keys_and_jobs = (function* (): Generator<[LocalDefId, boolean, boolean]> {
      for (const def_id of tcx.mir_keys(null)) {
        const [encode_const, encode_opt] = should_encode_mir(tcx, reachable_set, def_id);
        if (encode_const || encode_opt) yield [def_id, encode_const, encode_opt];
      }
    })();
    for (const [def_id, encode_const, encode_opt] of keys_and_jobs) {
      // debug_assert!(encode_const || encode_opt);

      // debug!("EntryBuilder::encode_mir({:?})", def_id);
      if (encode_opt) {
        this.tables.optimized_mir.set_some(def_id, this.lazy(tcx.optimized_mir(def_id), encode_Body));

        this.tables.cross_crate_inlinable.set(def_id, this.tcx.cross_crate_inlinable(def_id));

        this.tables.closure_saved_names_of_captured_variables.set_some(def_id, this.lazy(tcx.closure_saved_names_of_captured_variables(def_id), encode_Vec_Symbol));

        if (this.tcx.is_coroutine(LocalDefId.to_def_id(def_id))) {
          const witnesses = tcx.mir_coroutine_witnesses(def_id);
          if (witnesses !== undefined) {
            this.tables.mir_coroutine_witnesses.set_some(def_id, this.lazy(witnesses, encode_CoroutineLayout));
          }
        }
      }
      let is_trivial = false;
      if (encode_const) {
        const trivial = tcx.trivial_const(def_id);
        if (trivial !== undefined) {
          const [val, ty] = trivial;
          is_trivial = true;
          this.tables.trivial_const.set_some(def_id, this.lazy([val, ty] as [ConstValue, Ty], encode_ConstValue_Ty));
        } else {
          is_trivial = false;
          this.tables.mir_for_ctfe.set_some(def_id, this.lazy(tcx.mir_for_ctfe(def_id), encode_Body));
        }

        // FIXME(generic_const_exprs): this feels wrong to have in `encode_mir`
        const abstract_const = tcx.thir_abstract_const(def_id);
        if (abstract_const.$ === "Ok" && abstract_const._0 !== undefined) {
          this.tables.thir_abstract_const.set_some(def_id, this.lazy(abstract_const._0 as EarlyBinder<Const>, encode_EarlyBinder_Const));
        }

        if (should_encode_const(tcx.def_kind(def_id))) {
          const qualifs = tcx.mir_const_qualif(def_id);
          this.tables.mir_const_qualif.set_some(def_id, this.lazy(qualifs, encode_ConstQualifs));
          const body = tcx.hir_maybe_body_owned_by(def_id);
          if (body !== undefined) {
            const const_data = rendered_const(this.tcx, body, def_id);
            this.tables.rendered_const.set_some(def_id, this.lazy(const_data, encode_String));
          }
        }
      }
      if (!is_trivial) {
        this.tables.promoted_mir.set_some(def_id, this.lazy(tcx.promoted_mir(def_id), encode_IndexVec_Promoted_Body));
      }

      if (this.tcx.is_coroutine(LocalDefId.to_def_id(def_id))) {
        const witnesses = tcx.mir_coroutine_witnesses(def_id);
        if (witnesses !== undefined) {
          this.tables.mir_coroutine_witnesses.set_some(def_id, this.lazy(witnesses, encode_CoroutineLayout));
        }
      }
    }

    // Encode all the deduced parameter attributes for everything that has MIR, even for items
    // that can't be inlined. But don't if we aren't optimizing in non-incremental mode, to
    // save the query traffic.
    if (tcx.sess.opts.output_types.should_codegen() && tcx.sess.opts.optimize !== "No" && tcx.sess.opts.incremental === undefined) {
      for (const local_def_id of tcx.mir_keys(null)) {
        const k = tcx.def_kind(local_def_id);
        if (k.$ === "AssocFn" || k.$ === "Fn") {
          this.tables.deduced_param_attrs.set_some(
            local_def_id,
            this.lazy_array(this.tcx.deduced_param_attrs(LocalDefId.to_def_id(local_def_id)) as readonly DeducedParamAttrs[], encode_DeducedParamAttrs),
          );
        }
      }
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1976 encode_stability
  encode_stability(def_id: LocalDefId): void {
    // The query lookup can take a measurable amount of time in crates with many items. Check if
    // the stability attributes are even enabled before using their queries.
    if (this.feat.staged_api() || this.tcx.sess.opts.unstable_opts.force_unstable_if_unmarked) {
      const stab = this.tcx.lookup_stability(def_id) as Stability | undefined;
      if (stab !== undefined) {
        this.tables.lookup_stability.set_some(def_id, this.lazy(stab, encode_Stability));
      }
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1987 encode_const_stability
  encode_const_stability(def_id: LocalDefId): void {
    // The query lookup can take a measurable amount of time in crates with many items. Check if
    // the stability attributes are even enabled before using their queries.
    if (this.feat.staged_api() || this.tcx.sess.opts.unstable_opts.force_unstable_if_unmarked) {
      const stab = this.tcx.lookup_const_stability(def_id) as ConstStability | undefined;
      if (stab !== undefined) {
        this.tables.lookup_const_stability.set_some(def_id, this.lazy(stab, encode_ConstStability));
      }
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1998 encode_default_body_stability
  encode_default_body_stability(def_id: LocalDefId): void {
    // The query lookup can take a measurable amount of time in crates with many items. Check if
    // the stability attributes are even enabled before using their queries.
    if (this.feat.staged_api() || this.tcx.sess.opts.unstable_opts.force_unstable_if_unmarked) {
      const stab = this.tcx.lookup_default_body_stability(def_id) as DefaultBodyStability | undefined;
      if (stab !== undefined) {
        this.tables.lookup_default_body_stability.set_some(def_id, this.lazy(stab, encode_DefaultBodyStability));
      }
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2009 encode_deprecation
  encode_deprecation(def_id: LocalDefId): void {
    const depr = this.tcx.lookup_deprecation(LocalDefId.to_def_id(def_id));
    if (depr !== undefined) {
      this.tables.lookup_deprecation_entry.set_some(def_id, this.lazy(depr, encode_Deprecation));
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2016 encode_info_for_macro
  encode_info_for_macro(def_id: LocalDefId): void {
    const tcx = this.tcx;

    const [, macro_def] = tcx.hir_expect_item(def_id).expect_macro();
    this.tables.is_macro_rules.set(def_id, macro_def.macro_rules);
    this.tables.macro_definition.set_some(def_id, this.lazy(macro_def.body, ast.encode_DelimArgs));
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2024 encode_native_libraries
  encode_native_libraries(): LazyArray<NativeLib> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self)
    const used_libraries = this.tcx.native_libraries(LOCAL_CRATE);
    return this.lazy_array(used_libraries, encode_NativeLib);
  }

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:2030 encode_foreign_modules
  encode_foreign_modules(): LazyArray<ForeignModule> {
    if (this.is_proc_macro) return LazyArray.default(); // empty_proc_macro!(self)
    const foreign_modules = this.tcx.foreign_modules(LOCAL_CRATE);
    // PORT: `.cloned()`: the encoder only reads the modules.
    return this.lazy_array(foreign_modules.values(), encode_ForeignModule);
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

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2064 encode_proc_macros (lane encoder-d)
  encode_proc_macros(): ProcMacroData | undefined {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_proc_macros (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2161 encode_debugger_visualizers (lane encoder-d)
  encode_debugger_visualizers(): LazyArray<DebuggerVisualizerFile> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_debugger_visualizers (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2175 encode_crate_deps (lane encoder-d)
  encode_crate_deps(): LazyArray<CrateDep> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_crate_deps (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2210 encode_target_modifiers (lane encoder-d)
  encode_target_modifiers(): LazyArray<TargetModifier> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_target_modifiers (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2216 encode_enabled_denied_partial_mitigations (lane encoder-d)
  encode_enabled_denied_partial_mitigations(): LazyArray<DeniedPartialMitigation> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_enabled_denied_partial_mitigations (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2222 encode_lib_features (lane encoder-d)
  encode_lib_features(): LazyArray<[Symbol, FeatureStability]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_lib_features (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2229 encode_stability_implications (lane encoder-d)
  encode_stability_implications(): LazyArray<[Symbol, Symbol]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_stability_implications (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2237 encode_canonical_symbols (lane encoder-d)
  encode_canonical_symbols(): LazyArray<[Symbol, LocalDefId]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_canonical_symbols (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2244 encode_diagnostic_items (lane encoder-d)
  encode_diagnostic_items(): LazyArray<[Symbol, LocalDefId]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_diagnostic_items (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2253 encode_fake_doc_items (lane encoder-d)
  encode_fake_doc_items(): LazyArray<LocalDefId> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_fake_doc_items (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2260 encode_lang_items (lane encoder-d)
  encode_lang_items(): LazyArray<[LocalDefId, LangItem]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_lang_items (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2269 encode_lang_items_missing (lane encoder-d)
  encode_lang_items_missing(): LazyArray<LangItem> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_lang_items_missing (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2275 encode_stripped_cfg_items (lane encoder-d)
  encode_stripped_cfg_items(): LazyArray<StrippedCfgItem<LocalDefId>> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_stripped_cfg_items (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2284 encode_traits (lane encoder-d)
  encode_traits(): LazyArray<LocalDefId> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_traits (lane encoder-d)");
  }

  /// Encodes an index, mapping each trait to its (local) implementations.
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2291 encode_impls (lane encoder-d)
  encode_impls(): LazyArray<TraitImpls> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_impls (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2352 encode_incoherent_impls (lane encoder-d)
  encode_incoherent_impls(): LazyArray<IncoherentImpls> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_incoherent_impls (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2370 encode_exportable_items (lane encoder-d)
  encode_exportable_items(): LazyArray<LocalDefId> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_exportable_items (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2377 encode_stable_order_of_exportable_impls (lane encoder-d)
  encode_stable_order_of_exportable_impls(): LazyArray<[LocalDefId, number]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_stable_order_of_exportable_impls (lane encoder-d)");
  }

  // Encodes all symbols exported from this crate into the metadata.
  //
  // This pass is seeded off the reachability list calculated in the
  // middle::reachable module but filters out items that either don't have a
  // symbol associated with them (they weren't translated) or if they're an FFI
  // definition (as that's not defined in this crate).
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2394 encode_exported_symbols (lane encoder-d)
  encode_exported_symbols(_exported_symbols: readonly [ExportedSymbol, SymbolExportInfo][]): LazyArray<[ExportedSymbol, SymbolExportInfo]> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_exported_symbols (lane encoder-d)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2403 encode_dylib_dependency_formats (lane encoder-d)
  encode_dylib_dependency_formats(): LazyArray<LinkagePreference | undefined> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_dylib_dependency_formats (lane encoder-d)");
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

// ---- lane encoder-c: the `Encodable` impls of the table element types of encoder.rs:1482-2035 (not markers) ----
// PORT: each is the `T: Encodable<EncodeContext>` that `lazy` / `lazy_array` take for one table (PORTING §5: generic
// bounds become function tables), composed from the generated / hand-ported encoders; the decode side is
// rmeta/decoder/cstore_impl.ts. Element types with no TS `Encodable` yet stop as UNPORTED naming the impl, like
// decoder.ts's `decode_NativeLib`.

/** `Debug` of `!` (the `Id` of `ModChild::res: Res<!>`, for `Res::def_id`'s panic message; never called). */
const debug_never = (x: never): never => x;

/** `ty::Visibility<LocalDefId>` */
function encode_Visibility_LocalDefId(v: Visibility<LocalDefId>, e: EncodeContext): void {
  encode_ty_Visibility(v, e, encode_LocalDefId);
}
/** `ty::EarlyBinder<'tcx, ty::PolyFnSig<'tcx>>` */
function encode_EarlyBinder_PolyFnSig(v: EarlyBinder<Binder<FnSig>>, e: EncodeContext): void {
  encode_EarlyBinder(v, e, (v, e) => encode_Binder(v, e, encode_FnSig, encode_List_BoundVariableKind));
}
/** `ty::EarlyBinder<'tcx, Ty<'tcx>>` */
function encode_EarlyBinder_Ty(v: EarlyBinder<Ty>, e: EncodeContext): void {
  encode_EarlyBinder(v, e, encode_Ty);
}
/** `ty::EarlyBinder<'tcx, ty::Const<'tcx>>` */
function encode_EarlyBinder_Const(v: EarlyBinder<Const>, e: EncodeContext): void {
  encode_EarlyBinder(v, e, encode_ty_Const);
}
/** `Option<ty::EarlyBinder<'tcx, ty::Const<'tcx>>>` */
function encode_Option_EarlyBinder_Const(v: EarlyBinder<Const> | undefined, e: EncodeContext): void {
  encode_Option(v, e, encode_EarlyBinder_Const);
}
/** `(ty::Clause<'tcx>, Span)` */
function encode_Clause_Span(v: readonly [Clause, Span], e: EncodeContext): void {
  encode_tuple(v, e, encode_Clause, encode_Span);
}
/** `(ty::PolyTraitRef<'tcx>, Span)` */
function encode_PolyTraitRef_Span(v: readonly [Binder<TraitRef>, Span], e: EncodeContext): void {
  encode_tuple(v, e, (v, e) => encode_Binder(v, e, encode_TraitRef, encode_List_BoundVariableKind), encode_Span);
}
/** `(Ty<'tcx>, Span)` */
function encode_Ty_Span(v: readonly [Ty, Span], e: EncodeContext): void {
  encode_tuple(v, e, encode_Ty, encode_Span);
}
/** `Option<Ident>` */
function encode_Option_Ident(v: Ident | undefined, e: EncodeContext): void {
  encode_Option(v, e, encode_Ident);
}
/** `Vec<(usize, DenseBitSet<u32>)>` */
function encode_Vec_usize_DenseBitSet(v: readonly [number, DenseBitSet][], e: EncodeContext): void {
  encode_Vec(v, e, (v, e) => encode_tuple(v, e, encode_usize, encode_DenseBitSet));
}
/** `hir::OpaqueTyOrigin<DefId>` */
function encode_OpaqueTyOrigin_DefId(v: OpaqueTyOrigin<DefId>, e: EncodeContext): void {
  encode_OpaqueTyOrigin(v, e, encode_DefId);
}
/** `PreciseCapturingArgKind<Symbol, Symbol>` */
function encode_PreciseCapturingArgKind_Symbol(v: PreciseCapturingArgKind<Symbol, Symbol>, e: EncodeContext): void {
  encode_PreciseCapturingArgKind(v, e, encode_Symbol, encode_Symbol);
}
/** `DefIdMap<ty::EarlyBinder<'tcx, Ty<'tcx>>>`: `UnordMap`'s derived `Encodable_NoContext` is its `FxHashMap`'s
 *  (hashbrown order: `encode_HashMap` stops on a non-`FxHashMap` with more than one entry). */
function encode_DefIdMap_EarlyBinder_Ty(v: ReadonlyMap<DefId, EarlyBinder<Ty>>, e: EncodeContext): void {
  encode_HashMap(v, e, encode_DefId, encode_EarlyBinder_Ty);
}
/** `DefIdMap<Vec<DefId>>` (see `encode_DefIdMap_EarlyBinder_Ty`) */
function encode_DefIdMap_Vec_DefId(v: ReadonlyMap<DefId, readonly DefId[]>, e: EncodeContext): void {
  encode_HashMap(v, e, encode_DefId, (v, e) => encode_Vec(v, e, encode_DefId));
}
/** `IndexVec<FieldIdx, Symbol>` (`IndexVec`'s `Encodable` is its `Vec`'s) */
function encode_Vec_Symbol(v: readonly Symbol[], e: EncodeContext): void {
  encode_Vec(v, e, encode_Symbol);
}
/** `(ConstValue, Ty<'tcx>)` */
function encode_ConstValue_Ty(v: readonly [ConstValue, Ty], e: EncodeContext): void {
  encode_tuple(v, e, encode_ConstValue, encode_Ty);
}
/** `IndexVec<mir::Promoted, mir::Body<'tcx>>` */
function encode_IndexVec_Promoted_Body(v: readonly MirBody[], e: EncodeContext): void {
  encode_Vec(v, e, encode_Body);
}
/** `DocLinkResMap` = `FxIndexMap<(Symbol, Namespace), Option<Res<NodeId>>>`: `impl Encodable for IndexMap`
 *  (rustc_serialize serialize.rs:666: the length, then each key and value in order).
 *  PORT: the TS map is keyed by `DocLinkResMap_key` and stores `[key, value]` (rustc_middle middle/resolve.ts). */
function encode_DocLinkResMap(v: DocLinkResMap, e: EncodeContext): void {
  e.emit_usize(v.size);
  for (const [key, val] of v.values()) {
    encode_tuple(key, e, encode_Symbol, encode_Namespace);
    encode_Option(val, e, (v, e) => encode_Res(v, e, node_id.encode_NodeId));
  }
}
/** `EiiMapEncodedKeyValue` = `(DefId, (EiiDecl, Vec<(DefId, EiiImpl)>))` */
function encode_EiiMapEncodedKeyValue(v: EiiMapEncodedKeyValue, e: EncodeContext): void {
  encode_tuple(v, e, encode_DefId, (v, e) => encode_tuple(v, e, encode_EiiDecl, (v, e) => encode_Vec(v, e, (v, e) => encode_tuple(v, e, encode_DefId, encode_EiiImpl))));
}
/** `#[derive(Encodable)]` of `rustc_crate_store::NativeLib` (its `cfg` / `DllImport` fields have no TS `Encodable`). */
function encode_NativeLib(_v: NativeLib, _e: EncodeContext): void {
  unported("Encodable for rustc_crate_store::NativeLib (derive(Encodable) not generated)");
}
/** `#[derive(Encodable)]` of `rustc_crate_store::ForeignModule` (cstore.rs:138: fields in declaration order).
 *  PORT: hand-expanded (rustc_crate_store is not a tools/codegen serialize set). */
function encode_ForeignModule(v: ForeignModule, e: EncodeContext): void {
  encode_Vec(v.foreign_items, e, encode_DefId);
  encode_DefId(v.def_id, e);
  encode_ExternAbi(v.abi, e);
}
/** `#[cfg_attr(feature = "nightly", derive(Encodable))]` of `rustc_abi::ExternAbi` (extern_abi.rs:19): the variant
 *  index in declaration order as a `u8`, then the `unwind` field of the variants that have one.
 *  PORT: hand-expanded (tools/codegen does not generate rustc_abi's `ExternAbi` derive). */
function encode_ExternAbi(v: ExternAbi, e: Encoder): void {
  const disc = EXTERN_ABI_VARIANTS.indexOf(v.$);
  assert(disc >= 0, "ExternAbi variant");
  e.emit_u8(disc);
  if ("unwind" in v) encode_bool(v.unwind, e);
}
/** `ExternAbi`'s variants in declaration order (extern_abi.rs:19-127). */
const EXTERN_ABI_VARIANTS: readonly ExternAbi["$"][] = [
  "C",
  "System",
  "Rust",
  "RustCall",
  "RustCold",
  "RustInvalid",
  "RustPreserveNone",
  "RustTail",
  "LlvmIntrinsic",
  "Custom",
  "EfiApi",
  "Swift",
  "Aapcs",
  "CmseNonSecureCall",
  "CmseNonSecureEntry",
  "GpuKernel",
  "PtxKernel",
  "AvrInterrupt",
  "AvrNonBlockingInterrupt",
  "Msp430Interrupt",
  "RiscvInterruptM",
  "RiscvInterruptS",
  "X86Interrupt",
  "Cdecl",
  "Stdcall",
  "Fastcall",
  "Thiscall",
  "Vectorcall",
  "SysV64",
  "Win64",
];

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

/// Used to prefetch queries which will be needed later by metadata encoding.
/// Only a subset of the queries are actually prefetched to keep this code smaller.
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2422 prefetch_mir (lane encoder-d)
export function prefetch_mir(_tcx: TyCtxt): void {
  unported("rustc_metadata::rmeta::encoder::prefetch_mir (lane encoder-d)");
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
// PORT: `full_metadata: Option<Mmap>` is the file's bytes; `_temp_dir: Option<MaybeTempDir>` the directory's path
// (dropping it, which deletes a temporary directory, is the owner's job). rustc_interface's stand_ins.ts declares the
// part of it the driver reads until lane encoder-d ports `encode_metadata`.
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
    public _temp_dir: string | undefined,
  ) {}

  // #[inline]
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2486 from_path (lane encoder-d)
  static from_path(_path: string, _stub_path: string | undefined, _temp_dir: string | undefined): Result<EncodedMetadata, string> {
    return unported("rustc_metadata::rmeta::encoder::EncodedMetadata::from_path (lane encoder-d)");
  }

  // #[inline]
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2515 full (lane encoder-d)
  full(): Uint8Array {
    return unported("rustc_metadata::rmeta::encoder::EncodedMetadata::full (lane encoder-d)");
  }

  // #[inline]
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2520 stub_or_full (lane encoder-d)
  stub_or_full(): Uint8Array {
    return unported("rustc_metadata::rmeta::encoder::EncodedMetadata::stub_or_full (lane encoder-d)");
  }

  // #[inline]
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2525 path (lane encoder-d)
  path(): string | undefined {
    return unported("rustc_metadata::rmeta::encoder::EncodedMetadata::path (lane encoder-d)");
  }
}

// impl<S: Encoder> Encodable<S> for EncodedMetadata
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2531 encode (lane encoder-d)
export function encode_EncodedMetadata(_self: EncodedMetadata, _s: Encoder): void {
  unported("rustc_metadata::rmeta::encoder::encode EncodedMetadata (lane encoder-d)");
}

// impl<D: Decoder> Decodable<D> for EncodedMetadata
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2540 decode (lane encoder-d)
export function decode_EncodedMetadata(_d: import("../../rustc_serialize/serialize.ts").Decoder): EncodedMetadata {
  return unported("rustc_metadata::rmeta::encoder::decode EncodedMetadata (lane encoder-d)");
}

// #[instrument(level = "trace", skip(tcx))]
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2557 encode_metadata (lane encoder-d)
export function encode_metadata(_tcx: TyCtxt, _path: string, _ref_path: string | undefined): void {
  unported("rustc_metadata::rmeta::encoder::encode_metadata (lane encoder-d)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2664 with_encode_metadata_header (lane encoder-d)
export function with_encode_metadata_header(_tcx: TyCtxt, _path: string, _f: (ecx: EncodeContext) => [number, number]): void {
  unported("rustc_metadata::rmeta::encoder::with_encode_metadata_header (lane encoder-d)");
}

// PORT: `file: &File` is the open file's descriptor; `std::io::Error` its message.
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2778 encode_root_position (lane encoder-d)
export function encode_root_position(_file: number, _pos: number): Result<null, string> {
  return unported("rustc_metadata::rmeta::encoder::encode_root_position (lane encoder-d)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2784 encode_unhashed_position (lane encoder-d)
export function encode_unhashed_position(_file: number, _pos: number): Result<null, string> {
  return unported("rustc_metadata::rmeta::encoder::encode_unhashed_position (lane encoder-d)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2790 encode_crate_hash (lane encoder-d)
export function encode_crate_hash(_file: number, _hash: Svh): Result<null, string> {
  return unported("rustc_metadata::rmeta::encoder::encode_crate_hash (lane encoder-d)");
}

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2796 provide (lane encoder-d)
export function provide(_providers: Providers): void {
  unported("rustc_metadata::rmeta::encoder::provide (lane encoder-d)");
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
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2841 rendered_const (lane encoder-d)
export function rendered_const(_tcx: TyCtxt, _body: Body, _def_id: LocalDefId): string {
  return unported("rustc_metadata::rmeta::encoder::rendered_const (lane encoder-d)");
}

// PORT: `rendered_const`'s local `enum Classification { Literal, Simple, Complex }` and `fn classify`, at module level.
type Classification = "Literal" | "Simple" | "Complex";

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2853 classify (lane encoder-d)
export function classify(_expr: Expr): Classification {
  return unported("rustc_metadata::rmeta::encoder::rendered_const::classify (lane encoder-d)");
}
