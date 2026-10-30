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
import { Attribute, encode_Attribute } from "../../rustc_attr_ir/attr.ts";
import { AttributeKind } from "../../rustc_attr_ir/data_structures.ts";
import { EncodeCrossCrate } from "../../rustc_attr_ir/encode_cross_crate.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { StrippedCfgItem } from "../../rustc_attr_ir/data_structures.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { ExportedSymbol, SymbolExportInfo } from "../../rustc_codegen_ssa/back/symbol_export.ts";
import type { ForeignModule, LinkagePreference, NativeLib } from "../../rustc_crate_store/lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { debug_Svh, Svh } from "../../rustc_data_structures/svh.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { type Body, type Constness, Defaultness, type Expr } from "../../rustc_hir/hir.ts";
import type { DebuggerVisualizerFile } from "../../rustc_middle/middle/debugger_visualizer.ts";
import type { FeatureStability } from "../../rustc_middle/middle/mod.ts";
import type { EffectiveVisibilities } from "../../rustc_middle/middle/privacy.ts";
import { type AllocId, specialized_encode_alloc_id } from "../../rustc_middle/mir/interpret/mod.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { TyEncoder } from "../../rustc_middle/ty/codec.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Encodable, type Encoder, Encoder_provided, encode_Option, encode_tuple, encode_u32, encode_u64, encode_usize } from "../../rustc_serialize/serialize.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import { Options_impl } from "../../rustc_session/config.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import { encode_ExpnData, encode_ExpnHash, encode_Transparency } from "../../rustc_span/decodable.gen.ts";
import { CrateNum, type DefId, DefIndex, debug_CrateNum, encode_LocalDefId, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ExpnData, type ExpnHash, type ExpnId, ExpnIndex, HygieneEncodeContext, LocalExpnId, SyntaxContext, type SyntaxContextKey } from "../../rustc_span/hygiene.ts";
import { BytePos, debug_ExternalSource, encode_BytePos, encode_CrateNum, encode_ExpnId, encode_SourceFile, encode_SyntaxContext, RealFileName, type SourceFile, Span, type SpanData, StableSourceFileId } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { ByteSymbol, Symbol, sym } from "../../rustc_span/symbol.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { XxHash3_128 } from "../../vendor/twox_hash/lib.ts";
import { encode_CrateRoot, encode_CrateRootUnhashed, encode_SpanTag } from "../decodable.gen.ts";
import type { EiiMapEncodedKeyValue } from "../eii.ts";
import type { DefPathHashMapRef } from "./def_path_hash_map.ts";
import {
  AttrFlags,
  type CrateDep,
  CrateRoot,
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
  TableBuilders_encode,
  type TraitImpls,
} from "./mod.ts";
import { fse_Option_LazyValue, TableBuilder } from "./table.ts";

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

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:651 encode_crate_root
  encode_crate_root(): [LazyValue<CrateRoot>, LazyValue<CrateRootUnhashed>] {
    const tcx = this.tcx;
    const stats: [string, number][] = [];

    // PORT: `macro_rules! stat { ($label, $f) => { let orig_pos = self.position(); let res = $f(); stats.push(($label,
    // self.position() - orig_pos)); res } }` as a local closure.
    const stat = <R>(label: string, f: () => R): R => {
      const orig_pos = this.position();
      const res = f();
      stats.push([label, this.position() - orig_pos]);
      return res;
    };

    // We have already encoded some things. Get their combined size from the current position.
    stats.push(["preamble", this.position()]);

    const externally_implementable_items = stat("externally-implementable-items", () => this.encode_externally_implementable_items());

    const [crate_deps, dylib_dependency_formats] = stat("dep", () => [this.encode_crate_deps(), this.encode_dylib_dependency_formats()] as const);

    const lib_features = stat("lib-features", () => this.encode_lib_features());

    const stability_implications = stat("stability-implications", () => this.encode_stability_implications());

    const [lang_items, lang_items_missing] = stat("lang-items", () => [this.encode_lang_items(), this.encode_lang_items_missing()] as const);

    const stripped_cfg_items = stat("stripped-cfg-items", () => this.encode_stripped_cfg_items());

    const diagnostic_items = stat("diagnostic-items", () => this.encode_diagnostic_items());

    const canonical_symbols = stat("canonical-symbols", () => this.encode_canonical_symbols());

    const fake_doc_items = stat("fake-doc-items", () => this.encode_fake_doc_items());

    const native_libraries = stat("native-libs", () => this.encode_native_libraries());

    const foreign_modules = stat("foreign-modules", () => this.encode_foreign_modules());

    stat("def-path-table", () => this.encode_def_path_table());

    // Encode the def IDs of traits, for rustdoc and diagnostics.
    const traits = stat("traits", () => this.encode_traits());

    // Encode the def IDs of impls, for coherence checking.
    const impls = stat("impls", () => this.encode_impls());

    const incoherent_impls = stat("incoherent-impls", () => this.encode_incoherent_impls());

    stat("mir", () => this.encode_mir());

    stat("def-ids", () => this.encode_def_ids());

    const interpret_alloc_index = stat("interpret-alloc-index", () => {
      const interpret_alloc_index: number[] = [];
      let n = 0;
      // trace!("beginning to encode alloc ids");
      for (;;) {
        const new_n = this.interpret_allocs.size;
        // if we have found new ids, serialize those, too
        if (n === new_n) {
          // otherwise, abort
          break;
        }
        // trace!("encoding {} further alloc ids", new_n - n);
        // PORT: `self.interpret_allocs[idx]` indexes the `FxIndexSet`; the `Map`'s keys in insertion order are the
        // set's elements by index (taken once per round: encoding only appends, past `new_n`).
        const interpret_allocs = [...this.interpret_allocs.keys()];
        for (let idx = n; idx < new_n; idx++) {
          const id = interpret_allocs[idx]!;
          const pos = this.position(); // `as u64`
          interpret_alloc_index.push(pos);
          specialized_encode_alloc_id(this, tcx, id);
        }
        n = new_n;
      }
      return this.lazy_array(interpret_alloc_index, (v, e) => encode_u64(BigInt(v), e));
    });

    // Encode the proc macro data. This affects `tables`, so we need to do this before we
    // encode the tables. This overwrites def_keys, so it must happen after
    // encode_def_path_table.
    const proc_macro_data = stat("proc-macro-data", () => this.encode_proc_macros());

    const tables = stat("tables", () => TableBuilders_encode(this.tables, this.opaque));

    const debugger_visualizers = stat("debugger-visualizers", () => this.encode_debugger_visualizers());

    const exportable_items = stat("exportable-items", () => this.encode_exportable_items());

    const stable_order_of_exportable_impls = stat("exportable-items", () => this.encode_stable_order_of_exportable_impls());

    // Encode exported symbols info. This is prefetched in `encode_metadata`.
    const [exported_non_generic_symbols, exported_generic_symbols] = stat(
      "exported-symbols",
      () =>
        [
          this.encode_exported_symbols(tcx.exported_non_generic_symbols(LOCAL_CRATE) as readonly [ExportedSymbol, SymbolExportInfo][]),
          this.encode_exported_symbols(tcx.exported_generic_symbols(LOCAL_CRATE) as readonly [ExportedSymbol, SymbolExportInfo][]),
        ] as const,
    );

    // Encode the hygiene data.
    // IMPORTANT: this *must* be the last thing that we encode (other than `SourceMap`). The
    // process of encoding other items (e.g. `optimized_mir`) may cause us to load data from
    // the incremental cache. If this causes us to deserialize a `Span`, then we may load
    // additional `SyntaxContext`s into the global `HygieneData`. Therefore, we need to encode
    // the hygiene data last to ensure that we encode any `SyntaxContext`s that might be used.
    const [syntax_contexts, expn_data, expn_hashes] = stat("hygiene", () => this.encode_hygiene());

    const def_path_hash_map = stat("def-path-hash-map", () => this.encode_def_path_hash_map());

    // Encode source_map. This needs to be done last, because encoding `Span`s tells us which
    // `SourceFiles` we actually need to encode.
    const source_map = stat("source-map", () => this.encode_source_map());
    const target_modifiers = stat("target-modifiers", () => this.encode_target_modifiers());
    const denied_partial_mitigations = stat("denied-partial-mitigations", () => this.encode_enabled_denied_partial_mitigations());

    const root = stat("crate-root", () => {
      const attrs = tcx.hir_krate_attrs();
      // PORT: `find_attr!(attrs, Kind)` (the boolean form, rustc_attr_ir lib.ts).
      const has_attr = (kind: AttributeKind["$"]): boolean => find_attr(attrs, (k) => (k.$ === kind ? null : undefined)) !== undefined;
      return this.lazy(
        new CrateRoot(
          /* header */ {
            name: tcx.crate_name(LOCAL_CRATE),
            triple: tcx.sess.opts.target_triple,
            is_proc_macro_crate: proc_macro_data !== undefined,
            is_stub: false,
          },

          /* stable_crate_id */ tcx.stable_crate_id(LOCAL_CRATE),
          /* required_panic_strategy */ tcx.required_panic_strategy(LOCAL_CRATE),
          /* panic_in_drop_strategy */ tcx.sess.opts.unstable_opts.panic_in_drop,
          /* edition */ tcx.sess.edition(),
          /* has_global_allocator */ tcx.has_global_allocator(LOCAL_CRATE),
          /* has_alloc_error_handler */ tcx.has_alloc_error_handler(LOCAL_CRATE),
          /* has_panic_handler */ tcx.has_panic_handler(LOCAL_CRATE),
          /* has_default_lib_allocator */ has_attr("DefaultLibAllocator"),
          externally_implementable_items,

          crate_deps,
          dylib_dependency_formats,
          lib_features,
          stability_implications,
          lang_items,
          lang_items_missing,
          stripped_cfg_items,
          diagnostic_items,
          canonical_symbols,
          fake_doc_items,
          native_libraries,
          foreign_modules,
          traits,
          impls,
          incoherent_impls,
          interpret_alloc_index,
          proc_macro_data,

          tables,
          debugger_visualizers,

          exportable_items,
          stable_order_of_exportable_impls,
          exported_non_generic_symbols,
          exported_generic_symbols,

          syntax_contexts,
          expn_data,
          expn_hashes,

          def_path_hash_map,

          source_map,
          target_modifiers,
          denied_partial_mitigations,

          /* compiler_builtins */ has_attr("CompilerBuiltins"),
          /* needs_allocator */ has_attr("NeedsAllocator"),
          /* needs_panic_runtime */ has_attr("NeedsPanicRuntime"),
          /* no_builtins */ has_attr("NoBuiltins"),
          /* panic_runtime */ has_attr("PanicRuntime"),
          /* profiler_runtime */ has_attr("ProfilerRuntime"),
          /* symbol_mangling_version */ Options_impl.get_symbol_mangling_version(tcx.sess.opts),

          /* specialization_enabled_in */ tcx.specialization_enabled_in(LOCAL_CRATE),
        ),
        encode_CrateRoot,
      );
    });

    // By default the crate hash (SVH) is derived from the encoded metadata bytes. With
    // `-Z metadata-crate-hash=no` we instead store the legacy HIR-based hash, which the
    // `crate_hash` query computes directly without consulting `local_crate_hash`.
    let hash: Svh;
    if (tcx.sess.opts.unstable_opts.metadata_crate_hash) {
      this.opaque.flush();
      hash = Svh.new(Fingerprint.from_le_bytes(u128_to_le_bytes(this.metadata_hasher.finish_128())));
    } else {
      hash = tcx.crate_hash(LOCAL_CRATE);
    }
    // `tcx.untracked().local_crate_hash.set(hash).expect("local_crate_hash set twice")` (a `OnceLock`)
    const untracked = tcx.untracked();
    if (untracked.local_crate_hash !== undefined) {
      panic(`local_crate_hash set twice: ${debug_Svh(hash, PLAIN)}`);
    }
    untracked.local_crate_hash = hash;

    const unhashed = stat("final", () => {
      // Indexed by dependency `CrateNum`, matching the numbering `encode_crate_deps` uses.
      // Slot 0 (`LOCAL_CRATE`) is filler; this crate's own value is `extra_filename`.
      const dep_extra_filenames: string[] = [""]; // `IndexVec::from_elem_n(String::new(), 1)`
      if (!this.is_proc_macro) {
        for (const cnum of this.tcx.crates(null)) {
          const idx = dep_extra_filenames.push(this.tcx.extra_filename(cnum)) - 1;
          // `assert_eq!(idx, cnum, "dep_extra_filenames must be indexed by CrateNum")`
          if (idx !== CrateNum.as_usize(cnum)) {
            panic(`assertion \`left == right\` failed: dep_extra_filenames must be indexed by CrateNum\n  left: ${debug_CrateNum(CrateNum.from_usize(idx), PLAIN)}\n right: ${debug_CrateNum(cnum, PLAIN)}`);
          }
        }
      }

      return this.lazy(
        {
          extra_filename: this.tcx.sess.opts.cg.extra_filename,
          dep_extra_filenames,
        },
        encode_CrateRootUnhashed,
      );
    });

    const total_bytes = this.position();

    let computed_total_bytes = 0;
    for (const [, size] of stats) computed_total_bytes += size;
    assert_eq(total_bytes, computed_total_bytes, String);

    if (tcx.sess.opts.unstable_opts.meta_stats) {
      // PORT: `-Zmeta-stats` rewinds the metadata file to count its zero bytes and prints the table with
      // `usize_with_underscores` (rustc_data_structures thousands.rs, not ported) and `{:4.1}` float formatting.
      unported("rustc_metadata::rmeta::encoder::encode_crate_root: -Zmeta-stats (rustc_data_structures::thousands::usize_with_underscores)");
    }

    return [root, unhashed];
  }

  // ---- impl<'a, 'tcx> EncodeContext<'a, 'tcx> (second block, encoder.rs:1460) ----

  // rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1461 encode_attrs
  encode_attrs(def_id: LocalDefId): void {
    const tcx = this.tcx;
    const state: AnalyzeAttrState = {
      is_exported: (tcx.effective_visibilities(null) as EffectiveVisibilities<LocalDefId>).is_exported(def_id),
      is_doc_hidden: false,
    };
    // PORT: `.iter().filter(|attr| analyze_attr(*attr, &mut state))` is lazy: `lazy_array` drives it, so `state` is
    // updated while the attributes are encoded (a generator keeps that order).
    const attr_iter = (function* () {
      for (const attr of tcx.hir_attrs(tcx.local_def_id_to_hir_id(def_id))) {
        if (analyze_attr(attr, state)) yield attr;
      }
    })();

    // `record_array!(self.tables.attributes[def_id] <- attr_iter)`
    {
      const value = attr_iter;
      const lazy = this.lazy_array(value, encode_Attribute);
      this.tables.attributes.set_some(def_id, lazy);
    }

    let attr_flags = AttrFlags.empty();
    if (state.is_doc_hidden) {
      attr_flags = AttrFlags.union(attr_flags, AttrFlags.IS_DOC_HIDDEN);
    }

    // `record_value!(self.tables.attr_flags[def_id] <- attr_flags)`
    this.tables.attr_flags.set(def_id, attr_flags);
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

/** `n.to_le_bytes()` of a `u128`. */
function u128_to_le_bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0, m = n; i < 16; i++, m >>= 8n) out[i] = Number(m & 0xffn);
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
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:945 analyze_attr
export function analyze_attr(attr: Attribute, state: AnalyzeAttrState): boolean {
  let should_encode = false;
  let name: Symbol | undefined;
  if (attr.$ === "Parsed" && AttributeKind.encode_cross_crate(attr._0) === EncodeCrossCrate.No) {
    // Attributes not marked encode-cross-crate don't need to be encoded for downstream crates.
  } else if ((name = Attribute.name(attr)) !== undefined && [sym.warn, sym.allow, sym.expect, sym.forbid, sym.deny].includes(name)) {
    // Lint attributes don't need to be encoded for downstream crates.
    // FIXME remove this when #152369 is re-merged
  } else if (attr.$ === "Parsed" && attr._0.$ === "DocComment") {
    // We keep all doc comments reachable to rustdoc because they might be "imported" into
    // downstream crates if they use `#[doc(inline)]` to copy an item's documentation into
    // their own.
    if (state.is_exported) {
      should_encode = true;
    }
  } else if (attr.$ === "Parsed" && attr._0.$ === "Doc") {
    const d = attr._0._0;
    should_encode = true;
    if (d.hidden !== undefined) {
      state.is_doc_hidden = true;
    }
  } else {
    should_encode = true;
  }
  return should_encode;
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:974 should_encode_span
export function should_encode_span(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "TyParam":
    case "ConstParam":
    case "LifetimeParam":
    case "Fn":
    case "Const":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "AnonConst":
    case "OpaqueTy":
    case "Field":
    case "Impl":
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    case "ForeignMod":
    case "GlobalAsm":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1008 should_encode_attrs
export function should_encode_attrs(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "Field":
    case "ConstParam":
    case "Impl":
      return true;
    // `DefKind::Static { nested: false, .. } => true`, `DefKind::Static { nested: true, .. } => false`
    case "Static":
      return !def_kind.nested;
    // Encoding attrs for `Use` items allows `#[doc(hidden)]` on re-exports
    // to be read cross-crate, which is needed for diagnostic path selection
    // in `visible_parent_map`. See #153477.
    case "Use":
      return true;
    // Tools may want to be able to detect their tool lints on
    // closures from upstream crates, too. This is used by
    // https://github.com/model-checking/kani and is not a performance
    // or maintenance issue for us.
    case "Closure":
      return true;
    case "SyntheticCoroutineBody":
      return false;
    case "TyParam":
    case "Ctor":
    case "ExternCrate":
    case "ForeignMod":
    case "AnonConst":
    case "OpaqueTy":
    case "LifetimeParam":
    case "GlobalAsm":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1052 should_encode_expn_that_defined
export function should_encode_expn_that_defined(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "Impl":
      return true;
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "TyParam":
    case "Fn":
    case "Const":
    case "ConstParam":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "AnonConst":
    case "OpaqueTy":
    case "Field":
    case "LifetimeParam":
    case "GlobalAsm":
    case "Closure":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1088 should_encode_visibility
export function should_encode_visibility(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "Field":
      return true;
    // `DefKind::Static { nested: false, .. } => true`, `DefKind::Static { nested: true, .. } => false`
    case "Static":
      return !def_kind.nested;
    case "Use":
    case "ForeignMod":
    case "TyParam":
    case "ConstParam":
    case "LifetimeParam":
    case "AnonConst":
    case "OpaqueTy":
    case "GlobalAsm":
    case "Impl":
    case "Closure":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1125 should_encode_stability
export function should_encode_stability(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Mod":
    case "Ctor":
    case "Variant":
    case "Field":
    case "Struct":
    case "AssocTy":
    case "AssocFn":
    case "AssocConst":
    case "TyParam":
    case "ConstParam":
    case "Static":
    case "Const":
    case "Fn":
    case "ForeignMod":
    case "TyAlias":
    case "OpaqueTy":
    case "Enum":
    case "Union":
    case "Impl":
    case "Trait":
    case "TraitAlias":
    case "Macro":
    case "ForeignTy":
      return true;
    case "Use":
    case "LifetimeParam":
    case "AnonConst":
    case "GlobalAsm":
    case "Closure":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
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
// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1181 should_encode_mir
export function should_encode_mir(tcx: TyCtxt, reachable_set: ReadonlySet<LocalDefId>, def_id: LocalDefId): [boolean, boolean] {
  // `match tcx.def_kind(def_id)`: the arms in order (one has a guard).
  const def_kind = tcx.def_kind(def_id);
  // instance_mir uses mir_for_ctfe rather than optimized_mir for constructors
  if (def_kind.$ === "Ctor") return [true, false];
  // Constants
  if (def_kind.$ === "AnonConst" || def_kind.$ === "AssocConst" || def_kind.$ === "Const") return [true, false];
  // Coroutines require optimized MIR to compute layout.
  if (def_kind.$ === "Closure" && tcx.is_coroutine(LocalDefId.to_def_id(def_id))) return [false, true];
  if (def_kind.$ === "SyntheticCoroutineBody") return [false, true];
  // Full-fledged functions + closures
  if (def_kind.$ === "AssocFn" || def_kind.$ === "Fn" || def_kind.$ === "Closure") {
    let opt =
      tcx.sess.opts.unstable_opts.always_encode_mir ||
      (tcx.sess.opts.output_types.should_codegen() &&
        reachable_set.has(def_id) &&
        ((tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) || tcx.cross_crate_inlinable(def_id)));
    // Comptime fns do not have optimized MIR at all.
    const constness = tcx.constness(def_id) as Constness; // PORT: the query value is `unknown` in queries.gen.ts
    opt = opt && !(constness.$ === "Const" && constness.always);
    // The function has a `const` modifier or is in a `const trait`.
    const is_const_fn = tcx.is_const_fn(LocalDefId.to_def_id(def_id));
    return [is_const_fn, opt];
  }
  // The others don't have MIR.
  return [false, false];
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1213 should_encode_variances
export function should_encode_variances(tcx: TyCtxt, def_id: DefId, def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "OpaqueTy":
    case "Fn":
    case "Ctor":
    case "AssocFn":
      return true;
    case "AssocTy": {
      // Only encode variances for RPITITs (for traits)
      const info = tcx.opt_rpitit_info(def_id);
      return info !== undefined && info.$ === "Trait";
    }
    case "Mod":
    case "Variant":
    case "Field":
    case "AssocConst":
    case "TyParam":
    case "ConstParam":
    case "Static":
    case "Const":
    case "ForeignMod":
    case "TyAlias":
    case "Impl":
    case "Trait":
    case "TraitAlias":
    case "Macro":
    case "ForeignTy":
    case "Use":
    case "LifetimeParam":
    case "AnonConst":
    case "GlobalAsm":
    case "Closure":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1252 should_encode_generics
export function should_encode_generics(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "Static":
    case "Ctor":
    case "AssocFn":
    case "AssocConst":
    case "AnonConst":
    case "OpaqueTy":
    case "Impl":
    case "Field":
    case "TyParam":
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    case "Mod":
    case "ForeignMod":
    case "ConstParam":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1288 should_encode_type
export function should_encode_type(tcx: TyCtxt, def_id: LocalDefId, def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Ctor":
    case "Field":
    case "Fn":
    case "Const":
    case "TyAlias":
    case "ForeignTy":
    case "Impl":
    case "AssocFn":
    case "AssocConst":
    case "Closure":
    case "ConstParam":
    case "AnonConst":
    case "SyntheticCoroutineBody":
      return true;
    // `DefKind::Static { nested: false, .. } => true`, `DefKind::Static { nested: true, .. } => false`
    case "Static":
      return !def_kind.nested;

    case "OpaqueTy": {
      const origin = tcx.local_opaque_ty_origin(def_id);
      if (origin.$ === "FnReturn" || origin.$ === "AsyncFn") {
        const parent = origin.parent;
        const node = tcx.hir_node_by_def_id(parent);
        if (node.$ === "TraitItem") {
          const trait_item = node._0;
          if (trait_item.expect_fn()[1].$ === "Required") {
            return false;
          }
        }
      }
      return true;
    }

    case "AssocTy": {
      const assoc_item = tcx.associated_item(def_id) as AssocItem; // PORT: the query value is `unknown` in queries.gen.ts
      const container = assoc_item.container;
      if (container.$ === "InherentImpl" || container.$ === "TraitImpl") return true;
      // ty::AssocContainer::Trait
      return Defaultness.has_value(AssocItem.defaultness(assoc_item, tcx));
    }
    case "TyParam": {
      const node = tcx.hir_node_by_def_id(def_id);
      if (node.$ !== "GenericParam") return bug();
      const param = node._0;
      if (param.kind.$ !== "Type") return bug();
      const default_ = param.kind.default;
      return default_ !== undefined;
    }

    case "Trait":
    case "TraitAlias":
    case "Mod":
    case "ForeignMod":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1349 should_encode_fn_sig
export function should_encode_fn_sig(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Fn":
    case "AssocFn":
      return true;
    // `DefKind::Ctor(_, CtorKind::Fn) => true`, `DefKind::Ctor(..) => false`
    case "Ctor":
      return def_kind._1 === "Fn";

    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Field":
    case "Const":
    case "Static":
    case "TyAlias":
    case "OpaqueTy":
    case "ForeignTy":
    case "Impl":
    case "AssocConst":
    case "Closure":
    case "ConstParam":
    case "AnonConst":
    case "AssocTy":
    case "TyParam":
    case "Trait":
    case "TraitAlias":
    case "Mod":
    case "ForeignMod":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1385 should_encode_constness
export function should_encode_constness(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Fn":
    case "AssocFn":
    case "Closure":
      return true;
    // `DefKind::Ctor(_, CtorKind::Fn) => true`, `DefKind::Ctor(_, CtorKind::Const) => false`
    case "Ctor":
      return def_kind._1 === "Fn";
    // `DefKind::Impl { of_trait: false } => true`, `DefKind::Impl { .. } => false`
    case "Impl":
      return !def_kind.of_trait;

    case "Struct":
    case "Union":
    case "Enum":
    case "Field":
    case "Const":
    case "AssocConst":
    case "AnonConst":
    case "Static":
    case "TyAlias":
    case "OpaqueTy":
    case "ForeignTy":
    case "ConstParam":
    case "AssocTy":
    case "TyParam":
    case "Trait":
    case "TraitAlias":
    case "Mod":
    case "ForeignMod":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "Variant":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/encoder.rs:1424 should_encode_const
export function should_encode_const(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    // FIXME(mgca): should we remove Const and AssocConst here?
    case "Const":
    case "AssocConst":
    case "AnonConst":
      return true;

    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Ctor":
    case "Field":
    case "Fn":
    case "Static":
    case "TyAlias":
    case "OpaqueTy":
    case "ForeignTy":
    case "Impl":
    case "AssocFn":
    case "Closure":
    case "ConstParam":
    case "AssocTy":
    case "TyParam":
    case "Trait":
    case "TraitAlias":
    case "Mod":
    case "ForeignMod":
    case "Macro":
    case "Use":
    case "LifetimeParam":
    case "GlobalAsm":
    case "ExternCrate":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
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
