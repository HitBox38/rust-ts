// Port of compiler/rustc_metadata/src/rmeta/encoder.rs.
//
// Contract-first (lane encode-contract, plan-m5 D3 / wave 32; docs/handoff/encode-contract.md). Every upstream fn of
// encoder.rs is either ported (a `// rustc:` marker) or declared as a stub: a `// stub: <path>:<line> <name> (lane
// <lane>)` comment directly above a declaration with its final signature whose body is
// `unported("rustc_metadata::rmeta::encoder::.. (lane <lane>)")`. A lane replaces each of its stubs in place with the
// body and a `// rustc:` marker (contract.test.ts pins who owns what, so lanes cannot drift):
// - encoder-a: :1–:580 (the `SpanEncoder` impl, `bytes_needed`, `SpanData` / `[u8]` encoding,
//   `encode_symbol_or_byte_symbol`, the def-path tables);
// - encode-span-hygiene (wave 32): `encode_source_map` (:581) and `encode_hygiene` (:2036);
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
import type { DefKind } from "../../rustc_hir/def.ts";
import type { Body, Expr } from "../../rustc_hir/hir.ts";
import type { DebuggerVisualizerFile } from "../../rustc_middle/middle/debugger_visualizer.ts";
import type { FeatureStability } from "../../rustc_middle/middle/mod.ts";
import type { AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyEncoder } from "../../rustc_middle/ty/codec.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Encodable, type Encoder, Encoder_provided, encode_usize } from "../../rustc_serialize/serialize.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import type { CrateNum, DefId, DefIndex, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ExpnId, ExpnIndex, type HygieneEncodeContext, type SyntaxContext } from "../../rustc_span/hygiene.ts";
import type { SourceFile, Span, SpanData } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { ByteSymbol, Symbol } from "../../rustc_span/symbol.ts";
import { assert, assert_eq, unported, unwrap } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { XxHash3_128 } from "../../vendor/twox_hash/lib.ts";
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
  type SyntaxContextTable,
  type TableBuilders,
  type TraitImpls,
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

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:151 encode_crate_num (lane encoder-a)
  encode_crate_num(_crate_num: CrateNum): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_crate_num (lane encoder-a)");
  }

  /// This function panics as we need to remap only local def indices, however
  /// we can not determine if the def index is local given only def index.
  /// In metadata `LocalDefId` is used instead of `DefIndex` as with this wrapper
  /// around def index we certainly know that it came from local crate.
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:162 encode_def_index (lane encoder-a)
  encode_def_index(_: DefIndex): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_index (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:166 encode_def_id (lane encoder-a)
  encode_def_id(_def_id: DefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_id (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:171 encode_syntax_context (lane encoder-a)
  encode_syntax_context(_syntax_context: SyntaxContext): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_syntax_context (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:176 encode_expn_id (lane encoder-a)
  encode_expn_id(_expn_id: ExpnId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_expn_id (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:188 encode_span (lane encoder-a)
  encode_span(_span: Span): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_span (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:222 encode_symbol (lane encoder-a)
  encode_symbol(_sym: Symbol): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_symbol (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:226 encode_byte_symbol (lane encoder-a)
  encode_byte_symbol(_byte_sym: ByteSymbol): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_byte_symbol (lane encoder-a)");
  }

  /// We override `encode` function for `LocalDefId` as its default
  /// encoding logic is `self.encode_def_id(def_id.to_def_id())`
  /// meaning that the crate num will also be encoded, however as in metadata we use
  /// `LocalDefId` as a wrapper around def index we want to encode
  /// def index only, so we override the encode implementation.
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:237 encode_local_def_id (lane encoder-a)
  encode_local_def_id(_def_id: LocalDefId): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_local_def_id (lane encoder-a)");
  }

  /// We override encoding logic for `DefKey` during metadata encoding,
  /// as `DefKey` has a field `parent` of type `Option<DefIndex>` whose encoding will
  /// cause panic. So we remap it to `LocalDefId` as def keys during metadata encoding are all local.
  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:244 encode_def_key (lane encoder-a)
  encode_def_key<T>(_parent: DefIndex | undefined, _disambiguated_data: T, _encode_T: Encodable<T, EncodeContext>): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_key (lane encoder-a)");
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

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:529 encode_symbol_or_byte_symbol (lane encoder-a)
  encode_symbol_or_byte_symbol(_index: number, _emit_str_or_byte_str: (this_: EncodeContext) => void): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_symbol_or_byte_symbol (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:556 encode_def_path_table (lane encoder-a)
  encode_def_path_table(): void {
    unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_path_table (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:577 encode_def_path_hash_map (lane encoder-a)
  encode_def_path_hash_map(): LazyValue<DefPathHashMapRef> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_def_path_hash_map (lane encoder-a)");
  }

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:581 encode_source_map (lane encode-span-hygiene)
  encode_source_map(): LazyTable<number, number, LazyValue<SourceFile> | undefined> {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_source_map (lane encode-span-hygiene)");
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

  // stub: compiler/rustc_metadata/src/rmeta/encoder.rs:2036 encode_hygiene (lane encode-span-hygiene)
  encode_hygiene(): [SyntaxContextTable, ExpnDataTable, ExpnHashTable] {
    return unported("rustc_metadata::rmeta::encoder::EncodeContext::encode_hygiene (lane encode-span-hygiene)");
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

// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:254 bytes_needed (lane encoder-a)
export function bytes_needed(_n: number): number {
  return unported("rustc_metadata::rmeta::encoder::bytes_needed (lane encoder-a)");
}

// impl<'a, 'tcx> Encodable<EncodeContext<'a, 'tcx>> for SpanData
// stub: compiler/rustc_metadata/src/rmeta/encoder.rs:259 encode (lane encoder-a)
export function encode_SpanData(_self: SpanData, _s: EncodeContext): void {
  unported("rustc_metadata::rmeta::encoder::encode SpanData (lane encoder-a)");
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
