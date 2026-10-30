// Port of compiler/rustc_middle/src/ty/codec.rs (lane rmeta-ty).
//
//! This module contains some shared code for encoding and decoding various
//! things from the `ty` module, and in particular implements support for
//! "shorthands" which allow to have pointers back into the already encoded
//! stream instead of re-encoding the same thing twice.
//!
//! The functionality in here is shared between persisting to crate metadata and
//! persisting to incr. comp. caches.
//
// PORT:
// - `trait TyDecoder<'tcx>: SpanDecoder + InternerDecoder<Interner = TyCtxt<'tcx>>` is an interface; its provided
//   `positioned_at_shorthand` lives in `TyDecoder_provided` (PORTING §8) and implementors forward to it.
//   `const CLEAR_CROSS_CRATE: bool` is an associated const: each implementor exports `<Impl>_CLEAR_CROSS_CRATE`
//   (rmeta decoder.ts `MetadataDecodeContext_CLEAR_CROSS_CRATE`); only mir's `ClearCrossCrate` decoding reads it (M4).
// - The `Decodable` impls are `decode_<T>(decoder)` fns, the names tools/codegen's serialize.json entries call from
//   the generated `derive(TyDecodable)` / `derive(Decodable_NoContext)` of the type sets (lane rmeta-ty). `T::decode`
//   arguments of generic code are those fns.
// - The encoding half (`TyEncoder`, `EncodableWithShorthand`, `encode_with_shorthand`, the `Encodable` impls; plan-m5 D3):
//   the traits are declared (lane encode-contract) and the fns are stubs for lane encode-middle (`encode_<T>`, the names
//   tools/codegen's serialize.json `encode` templates call), except `AllocId`'s one-line impl.
// - `(0..len).map(|_| Decodable::decode(decoder))` fed to a `mk_*_from_iter` is a lazy generator: the interner
//   collects it, so the elements are decoded in order, inside the call, as upstream.
// - Every generated `.gen.ts` of the rustc_ty set imports this module (its derive(Decodable) fields call these fns),
//   so this module must not change the evaluation order of the type modules it calls into: it loads them lazily
//   (`require` inside a function, the sty/mod.ts precedent of merge-w15a decision 2). Types are imported normally.
// - `mod ref_decodable;` + `pub use self::ref_decodable::RefDecodable;`: ./codec/ref_decodable.ts; its decoders are
//   re-exported here (the `Decodable for &'tcx List<..>` impls of `impl_decodable_via_ref_decodable_for_local_types!`
//   are the `RefDecodable` impls themselves).
import type { Binder, BoundVariableKind, ExistentialPredicate, PredicateKind, TyKind } from "../../rustc_type_ir/decls.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import type { InternerDecoder } from "../../rustc_type_ir/serialize.ts";
import { type Decoder, decode_unit, type Encodable, encode_unit } from "../../rustc_serialize/serialize.ts";
import type { SpanDecoder, SpanEncoder } from "../../rustc_span/lib.ts";
import type { Pending } from "../../rustc_type_ir/decls.ts";
import type { List } from "./list.ts";
import { assert, unported } from "../../std/panic.ts";
import type { TyCtxt } from "./context.ts";
import type { AdtDef, Allocation, BinOp, CanonicalVarKinds, CastKind, ConstAllocation, ParamEnv, Pattern, PlaceElem, UnOp, ValTree, Value } from "./decls.ts";
import type { GenericArg, GenericArgs } from "./generic_args.ts";
import type { Term, Ty } from "./mod.ts";
import type { Clause, Predicate } from "./predicate.ts";
import type { Clauses } from "./list.ts";

export type { RefDecodable } from "./codec/ref_decodable.ts";
export {
  decode_List_BoundVariableKind,
  decode_List_Const,
  decode_List_Pattern,
  decode_List_PolyExistentialPredicate,
  decode_List_Ty,
  decode_ListWithCachedTypeInfo_Clause,
} from "./codec/ref_decodable.ts";

// mir / mir::interpret types (read lazily, module comment). (`ty::SymbolName` is ty/mod.ts's.)
type AllocId = import("../mir/interpret/mod.ts").AllocId;
type CtfeProvenance = import("../mir/interpret/pointer.ts").CtfeProvenance;
type SymbolName = import("./mod.ts").SymbolName;
type Local = import("../mir/mod.ts").Local;
type Place = import("../mir/syntax.ts").Place;

// ---- lazily loaded callees (module comment) ----
/** mir/interpret/pointer.ts (`CtfeProvenance::from_parts`), read lazily. */
function mir_interpret_pointer_(): typeof import("../mir/interpret/pointer.ts") {
  return (mir_interpret_pointer__m ??= require("../mir/interpret/pointer.ts") as typeof import("../mir/interpret/pointer.ts"));
}
var mir_interpret_pointer__m: typeof import("../mir/interpret/pointer.ts") | undefined;
function binder_(): typeof import("../../rustc_type_ir/binder.ts") {
  return (binder___m ??= require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts"));
}
var binder___m: typeof import("../../rustc_type_ir/binder.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function ty_kind_(): typeof import("../../rustc_type_ir/ty_kind.ts") {
  return (ty_kind___m ??= require("../../rustc_type_ir/ty_kind.ts") as typeof import("../../rustc_type_ir/ty_kind.ts"));
}
var ty_kind___m: typeof import("../../rustc_type_ir/ty_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function predicate_kind_(): typeof import("../../rustc_type_ir/predicate_kind.ts") {
  return (predicate_kind___m ??= require("../../rustc_type_ir/predicate_kind.ts") as typeof import("../../rustc_type_ir/predicate_kind.ts"));
}
var predicate_kind___m: typeof import("../../rustc_type_ir/predicate_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function canonical_(): typeof import("../../rustc_type_ir/canonical.ts") {
  return (canonical___m ??= require("../../rustc_type_ir/canonical.ts") as typeof import("../../rustc_type_ir/canonical.ts"));
}
var canonical___m: typeof import("../../rustc_type_ir/canonical.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
// PORT (init order): decodable.gen.ts imports the extension module ty/trait_def.ts, which must load after TyCtxt.
function decodable_(): typeof import("../decodable.gen.ts") {
  return (decodable___m ??= require("../decodable.gen.ts") as typeof import("../decodable.gen.ts"));
}
var decodable___m: typeof import("../decodable.gen.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function pattern_(): typeof import("../../rustc_type_ir/pattern.ts") {
  return (pattern___m ??= require("../../rustc_type_ir/pattern.ts") as typeof import("../../rustc_type_ir/pattern.ts"));
}
var pattern___m: typeof import("../../rustc_type_ir/pattern.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function const_kind_(): typeof import("../../rustc_type_ir/const_kind.ts") {
  return (const_kind___m ??= require("../../rustc_type_ir/const_kind.ts") as typeof import("../../rustc_type_ir/const_kind.ts"));
}
var const_kind___m: typeof import("../../rustc_type_ir/const_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function generic_arg_ir_(): typeof import("../../rustc_type_ir/generic_arg.ts") {
  return (generic_arg_ir___m ??= require("../../rustc_type_ir/generic_arg.ts") as typeof import("../../rustc_type_ir/generic_arg.ts"));
}
var generic_arg_ir___m: typeof import("../../rustc_type_ir/generic_arg.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function term_kind_(): typeof import("../../rustc_type_ir/term_kind.ts") {
  return (term_kind___m ??= require("../../rustc_type_ir/term_kind.ts") as typeof import("../../rustc_type_ir/term_kind.ts"));
}
var term_kind___m: typeof import("../../rustc_type_ir/term_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function generic_args_(): typeof import("./generic_args.ts") {
  return (generic_args___m ??= require("./generic_args.ts") as typeof import("./generic_args.ts"));
}
var generic_args___m: typeof import("./generic_args.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function mod_(): typeof import("./mod.ts") {
  return (mod___m ??= require("./mod.ts") as typeof import("./mod.ts"));
}
var mod___m: typeof import("./mod.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** mir/syntax.ts (`mir::Place`, the derived `ProjectionElem` decoder) and mir/mod.ts (`Local`), read lazily (lane meta-mir). */
function mir_syntax_(): typeof import("../mir/syntax.ts") {
  return (mir_syntax___m ??= require("../mir/syntax.ts") as typeof import("../mir/syntax.ts"));
}
var mir_syntax___m: typeof import("../mir/syntax.ts") | undefined;
function mir_mod_(): typeof import("../mir/mod.ts") {
  return (mir_mod___m ??= require("../mir/mod.ts") as typeof import("../mir/mod.ts"));
}
var mir_mod___m: typeof import("../mir/mod.ts") | undefined;
function type_ir_serialize_(): typeof import("../../rustc_type_ir/serialize.ts") {
  return (type_ir_serialize___m ??= require("../../rustc_type_ir/serialize.ts") as typeof import("../../rustc_type_ir/serialize.ts"));
}
var type_ir_serialize___m: typeof import("../../rustc_type_ir/serialize.ts") | undefined;
function list_(): typeof import("./list.ts") {
  return (list___m ??= require("./list.ts") as typeof import("./list.ts"));
}
var list___m: typeof import("./list.ts") | undefined;
function predicate_ir_(): typeof import("../../rustc_type_ir/predicate.ts") {
  return (predicate_ir___m ??= require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts"));
}
var predicate_ir___m: typeof import("../../rustc_type_ir/predicate.ts") | undefined;
function ref_decodable_(): typeof import("./codec/ref_decodable.ts") {
  return (ref_decodable___m ??= require("./codec/ref_decodable.ts") as typeof import("./codec/ref_decodable.ts"));
}
var ref_decodable___m: typeof import("./codec/ref_decodable.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/// The shorthand encoding uses an enum's variant index `usize`
/// and is offset by this value so it never matches a real variant.
/// This offset is also chosen so that the first byte is never < 0x80.
export const SHORTHAND_OFFSET = 0x80;

/** `pub trait TyEncoder<'tcx>: SpanEncoder` (`const CLEAR_CROSS_CRATE: bool`: each implementor exports `<Impl>_CLEAR_CROSS_CRATE`,
 *  like `TyDecoder`; rmeta encoder.ts `EncodeContext_CLEAR_CROSS_CRATE`). */
export interface TyEncoder extends SpanEncoder {
  // rustc: compiler/rustc_middle/src/ty/codec.rs:33 position
  position(): number;

  // rustc: compiler/rustc_middle/src/ty/codec.rs:35 type_shorthands
  type_shorthands(): Map<Ty, number>;

  // rustc: compiler/rustc_middle/src/ty/codec.rs:37 predicate_shorthands
  predicate_shorthands(): Map<string, number>;

  // rustc: compiler/rustc_middle/src/ty/codec.rs:39 encode_alloc_id
  encode_alloc_id(alloc_id: AllocId): void;
}

export interface TyDecoder extends SpanDecoder, InternerDecoder {
  // const CLEAR_CROSS_CRATE: bool;  (module comment)

  // rustc: compiler/rustc_middle/src/ty/codec.rs:47 cached_ty_for_shorthand
  cached_ty_for_shorthand(shorthand: number, or_insert_with: (this_: TyDecoder) => Ty): Ty;

  // rustc: compiler/rustc_middle/src/ty/codec.rs:51 with_position
  with_position<R>(pos: number, f: (this_: TyDecoder) => R): R;

  positioned_at_shorthand(): boolean; // (provided)

  // rustc: compiler/rustc_middle/src/ty/codec.rs:59 decode_alloc_id
  decode_alloc_id(): AllocId;

  interner(): TyCtxt;
}

/** The provided methods of `TyDecoder` (PORTING §8); implementors forward to them. */
export const TyDecoder_provided = {
  // rustc: compiler/rustc_middle/src/ty/codec.rs:55 positioned_at_shorthand
  positioned_at_shorthand(self: TyDecoder): boolean {
    return (self.peek_byte() & SHORTHAND_OFFSET) !== 0;
  },
};

/** `pub trait EncodableWithShorthand<'tcx, E: TyEncoder<'tcx>>: Copy + Eq + Hash { type Variant: Encodable<E>; .. }`
 *  PORT: a function table per implementor (`EncodableWithShorthand_Ty`, `EncodableWithShorthand_PredicateKind`):
 *  - `variant` is the trait method;
 *  - `encode_variant` is `Self::Variant: Encodable<E>` (the derived encoder);
 *  - `discriminant` is `intrinsics::discriminant_value` of the variant (`T::Variant: DiscriminantKind<Discriminant = isize>`);
 *  - `key` is `Eq + Hash`: the key `self` has in the shorthand cache (`Ty`: the interned object; `PredicateKind`: its
 *    intern key, `TyEncoder.predicate_shorthands`'s key type). */
export interface EncodableWithShorthand<T, Variant, K> {
  // rustc: compiler/rustc_middle/src/ty/codec.rs:64 variant
  variant(self: T): Variant;
  encode_variant(variant: Variant, e: TyEncoder): void;
  discriminant(variant: Variant): number;
  key(self: T): K;
}

// #[allow(rustc::usage_of_ty_tykind)]
// impl<'tcx, E: TyEncoder<'tcx>> EncodableWithShorthand<'tcx, E> for Ty<'tcx> { type Variant = ty::TyKind<'tcx>; .. }
// #[inline]
// rustc: compiler/rustc_middle/src/ty/codec.rs:72 variant
export function variant_Ty(self: Ty): TyKind {
  return self.kind();
}

// impl<'tcx, E: TyEncoder<'tcx>> EncodableWithShorthand<'tcx, E> for ty::PredicateKind<'tcx> { type Variant = ty::PredicateKind<'tcx>; .. }
// #[inline]
// rustc: compiler/rustc_middle/src/ty/codec.rs:81 variant
export function variant_PredicateKind(self: PredicateKind): PredicateKind {
  return self;
}

/** PORT: `discriminant_value` of a `TyKind` / `PredicateKind`: neither has explicit discriminants, so it is the variant
 *  index in declaration order (rustc_type_ir ty_kind.rs:75 / predicate_kind.rs:63; the derived encoders' `disc`). */
const TyKind__discriminant: { readonly [K in TyKind["$"]]: number } = {
  Bool: 0,
  Char: 1,
  Int: 2,
  Uint: 3,
  Float: 4,
  Adt: 5,
  Foreign: 6,
  Str: 7,
  Array: 8,
  Pat: 9,
  Slice: 10,
  RawPtr: 11,
  Ref: 12,
  FnDef: 13,
  FnPtr: 14,
  UnsafeBinder: 15,
  Dynamic: 16,
  Closure: 17,
  CoroutineClosure: 18,
  Coroutine: 19,
  CoroutineWitness: 20,
  Never: 21,
  Tuple: 22,
  Alias: 23,
  Param: 24,
  Bound: 25,
  Placeholder: 26,
  Infer: 27,
  Error: 28,
};
const PredicateKind__discriminant: { readonly [K in PredicateKind["$"]]: number } = {
  Clause: 0,
  DynCompatible: 1,
  Subtype: 2,
  Coerce: 3,
  ConstEquate: 4,
  Ambiguous: 5,
  NormalizesTo: 6,
};

/** `impl EncodableWithShorthand for Ty` (module comment: the function table). */
export const EncodableWithShorthand_Ty: EncodableWithShorthand<Ty, TyKind, Ty> = {
  variant: variant_Ty,
  encode_variant: (variant, e) => ty_kind_().encode_TyKind(variant, e),
  discriminant: (variant) => TyKind__discriminant[variant.$],
  key: (self) => self,
};

/** `impl EncodableWithShorthand for ty::PredicateKind` (module comment: the function table). */
export const EncodableWithShorthand_PredicateKind: EncodableWithShorthand<PredicateKind, PredicateKind, string> = {
  variant: variant_PredicateKind,
  encode_variant: (variant, e) => predicate_kind_().encode_PredicateKind(variant, e),
  discriminant: (variant) => PredicateKind__discriminant[variant.$],
  key: (self) => intern_key(self),
};

/// Encode the given value or a previously cached shorthand.
// PORT: `T: EncodableWithShorthand<'tcx, E>` is the function table `T_` (above); `cache` is `TyEncoder::type_shorthands` /
// `predicate_shorthands`, keyed by `T_.key(value)`.
// rustc: compiler/rustc_middle/src/ty/codec.rs:87 encode_with_shorthand
export function encode_with_shorthand<E extends TyEncoder, T, V, K>(
  encoder: E,
  value: T,
  cache: (encoder: E) => Map<K, number>,
  T_: EncodableWithShorthand<T, V, K>,
): void {
  const existing_shorthand = cache(encoder).get(T_.key(value));
  if (existing_shorthand !== undefined) {
    encoder.emit_usize(existing_shorthand);
    return;
  }

  const variant = T_.variant(value);

  const start = encoder.position();
  T_.encode_variant(variant, encoder);
  const len = encoder.position() - start;

  // The shorthand encoding uses the same usize as the
  // discriminant, with an offset so they can't conflict.
  const discriminant = T_.discriminant(variant);
  assert(SHORTHAND_OFFSET > discriminant, "assertion failed: SHORTHAND_OFFSET > discriminant as usize");

  const shorthand = start + SHORTHAND_OFFSET;

  // Get the number of bits that leb128 could fit
  // in the same space as the fully encoded type.
  const leb128_bits = len * 7;

  // Check that the shorthand is a not longer than the
  // full encoding itself, i.e., it's an obvious win.
  if (leb128_bits >= 64 || shorthand < 2 ** leb128_bits) {
    cache(encoder).set(T_.key(value), shorthand);
  }
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for Ty<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:126 encode
export function encode_Ty<E extends TyEncoder>(self: Ty, e: E): void {
  encode_with_shorthand(e, self, (e) => e.type_shorthands(), EncodableWithShorthand_Ty);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ty::Predicate<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:132 encode
export function encode_Predicate<E extends TyEncoder>(self: Predicate, e: E): void {
  const kind = self.kind();
  encode_List_BoundVariableKind(binder_().Binder.bound_vars(kind), e);
  encode_with_shorthand(e, binder_().Binder.skip_binder(kind), (e) => e.predicate_shorthands(), EncodableWithShorthand_PredicateKind);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ty::Clause<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:140 encode
export function encode_Clause<E extends TyEncoder>(self: Clause, e: E): void {
  encode_Predicate(self.as_predicate(), e);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ty::Pattern<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:146 encode
export function encode_Pattern<E extends TyEncoder>(self: Pattern, e: E): void {
  pattern_().encode_PatternKind(self.internee, e);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ty::ValTree<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:152 encode
export function encode_ValTree<E extends TyEncoder>(self: ValTree, e: E): void {
  const_kind_().encode_ValTreeKind(self.internee, e);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ConstAllocation<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:158 encode
export function encode_ConstAllocation<E extends TyEncoder>(self: ConstAllocation, e: E): void {
  encode_Allocation(self.inner(), e);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for AdtDef<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:164 encode
export function encode_AdtDef<E extends TyEncoder>(self: AdtDef, e: E): void {
  decodable_().encode_AdtDefData(self.internee, e);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for AllocId
// rustc: compiler/rustc_middle/src/ty/codec.rs:170 encode
export function encode_AllocId<E extends TyEncoder>(self: AllocId, e: E): void {
  e.encode_alloc_id(self);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for CtfeProvenance
// rustc: compiler/rustc_middle/src/ty/codec.rs:176 encode
export function encode_CtfeProvenance<E extends TyEncoder>(self: CtfeProvenance, e: E): void {
  // `self.into_parts().encode(e)`: `(AllocId, bool, bool)`
  const parts = mir_interpret_pointer_().CtfeProvenance.into_parts(self);
  encode_AllocId(parts[0], e);
  e.emit_bool(parts[1]);
  e.emit_bool(parts[2]);
}

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for ty::ParamEnv<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:182 encode
export function encode_ParamEnv<E extends TyEncoder>(self: ParamEnv, e: E): void {
  encode_ListWithCachedTypeInfo_Clause(self.caller_bounds_, e);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for Ty<'tcx>
// #[allow(rustc::usage_of_ty_tykind)]
// rustc: compiler/rustc_middle/src/ty/codec.rs:189 decode
export function decode_Ty<D extends TyDecoder>(decoder: D): Ty {
  // Handle shorthands first, if we have a usize > 0x80.
  if (decoder.positioned_at_shorthand()) {
    const pos = decoder.read_usize();
    assert(pos >= SHORTHAND_OFFSET, "assertion failed: pos >= SHORTHAND_OFFSET");
    const shorthand = pos - SHORTHAND_OFFSET;

    return decoder.cached_ty_for_shorthand(shorthand, (decoder) => decoder.with_position(shorthand, decode_Ty));
  } else {
    const tcx = decoder.interner();
    return tcx.mk_ty_from_kind(ty_kind_().decode_TyKind(decoder));
  }
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::Predicate<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:207 decode
export function decode_Predicate<D extends TyDecoder>(decoder: D): Predicate {
  const bound_vars = ref_decodable_().decode_List_BoundVariableKind(decoder);
  // Handle shorthands first, if we have a usize > 0x80.
  let value: PredicateKind;
  if (decoder.positioned_at_shorthand()) {
    const pos = decoder.read_usize();
    assert(pos >= SHORTHAND_OFFSET, "assertion failed: pos >= SHORTHAND_OFFSET");
    const shorthand = pos - SHORTHAND_OFFSET;

    value = decoder.with_position(shorthand, predicate_kind_().decode_PredicateKind);
  } else {
    value = predicate_kind_().decode_PredicateKind(decoder);
  }
  const predicate_kind = binder_().Binder.bind_with_vars(value, bound_vars);
  return decoder.interner().mk_predicate(predicate_kind);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::Clause<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:227 decode
export function decode_Clause<D extends TyDecoder>(decoder: D): Clause {
  const pred: Predicate = decode_Predicate(decoder);
  return pred.expect_clause();
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for GenericArgsRef<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:234 decode
export function decode_GenericArgs<D extends TyDecoder>(decoder: D): GenericArgs {
  const len = decoder.read_usize();
  const tcx = decoder.interner();
  return tcx.mk_args_from_iter(
    (function* (): Generator<GenericArg> {
      for (let i = 0; i < len; i++) yield decode_GenericArg_TyDecoder(decoder);
    })(),
  );
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for mir::Place<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:244 decode
export function decode_Place<D extends TyDecoder>(decoder: D): Place {
  const local: Local = mir_mod_().decode_Local(decoder);
  const len = decoder.read_usize();
  const projection = decoder.interner().mk_place_elems_from_iter(
    (function* (): Generator<PlaceElem> {
      for (let i = 0; i < len; i++) yield decode_PlaceElem(decoder);
    })(),
  );
  return new (mir_syntax_().Place)(local, projection);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for CanonicalVarKinds<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:255 decode
export function decode_CanonicalVarKinds<D extends TyDecoder>(decoder: D): CanonicalVarKinds {
  const len = decoder.read_usize();
  return decoder.interner().mk_canonical_var_infos_from_iter(
    (function* () {
      for (let i = 0; i < len; i++) yield canonical_().decode_CanonicalVarKind(decoder);
    })(),
  );
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for AllocId
// rustc: compiler/rustc_middle/src/ty/codec.rs:264 decode
export function decode_AllocId<D extends TyDecoder>(decoder: D): AllocId {
  return decoder.decode_alloc_id();
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for CtfeProvenance
// rustc: compiler/rustc_middle/src/ty/codec.rs:270 decode
export function decode_CtfeProvenance<D extends TyDecoder>(decoder: D): CtfeProvenance {
  // `let parts = Decodable::decode(decoder);`: `(AllocId, bool, bool)` (`CtfeProvenance::into_parts`)
  const parts: [AllocId, boolean, boolean] = [decode_AllocId(decoder), decoder.read_bool(), decoder.read_bool()];
  return mir_interpret_pointer_().CtfeProvenance.from_parts(parts);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::SymbolName<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:277 decode
export function decode_SymbolName<D extends TyDecoder>(decoder: D): SymbolName {
  return mod_().SymbolName.new(decoder.interner(), decoder.read_str());
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::ParamEnv<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:283 decode
export function decode_ParamEnv<D extends TyDecoder>(d: D): ParamEnv {
  const caller_bounds = ref_decodable_().decode_ListWithCachedTypeInfo_Clause(d);
  return new (mod_().ParamEnv)(caller_bounds);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::Pattern<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:290 decode
export function decode_Pattern<D extends TyDecoder>(decoder: D): Pattern {
  return decoder.interner().mk_pat(pattern_().decode_PatternKind(decoder));
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ty::ValTree<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:296 decode
export function decode_ValTree<D extends TyDecoder>(decoder: D): ValTree {
  return decoder.interner().intern_valtree(const_kind_().decode_ValTreeKind(decoder));
}

/** PORT: the generated `derive(TyDecodable)` of `ty::Value` (decodable.gen.ts), reached lazily (init order: decodable.gen.ts
 *  imports the extension module ty/trait_def.ts; rustc_type_ir's const_kind.gen.ts decodes `ConstKind::Value` through here). */
export function decode_Value(decoder: TyDecoder): Value {
  return decodable_().decode_Value(decoder);
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for ConstAllocation<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:302 decode
export function decode_ConstAllocation<D extends TyDecoder>(decoder: D): ConstAllocation {
  return decoder.interner().mk_const_alloc(decode_Allocation(decoder));
}

// impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for AdtDef<'tcx>
// rustc: compiler/rustc_middle/src/ty/codec.rs:308 decode
export function decode_AdtDef<D extends TyDecoder>(decoder: D): AdtDef {
  return decoder.interner().mk_adt_def_from_data(decodable_().decode_AdtDefData(decoder));
}

/// Declares implementations of all [`Decoder`](rustc_serialize::Decoder) methods,
/// each of which forwards to a method of the same name on some underlying decoder,
/// typically a field of type [`MemDecoder`](rustc_serialize::opaque::MemDecoder).
///
/// Call this macro within an impl block `impl Decoder for $MyDecoder { ... }`.
// PORT: `pub macro forward_all_decoder_methods_to { (|$self:ident| $inner:expr) => { .. } }`: installs the 14
// forwarding methods on `proto` (the implementor's prototype); `inner(self)` is `$inner`.
export function forward_all_decoder_methods_to<S>(proto: S, inner: (self: S) => Decoder): void {
  const p = proto as unknown as Decoder;
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/codec.rs:327 read_usize
  p.read_usize = function (this: S): number {
    return inner(this).read_usize();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:328 read_u128
  p.read_u128 = function (this: S): bigint {
    return inner(this).read_u128();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:329 read_u64
  p.read_u64 = function (this: S): bigint {
    return inner(this).read_u64();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:330 read_u32
  p.read_u32 = function (this: S): number {
    return inner(this).read_u32();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:331 read_u16
  p.read_u16 = function (this: S): number {
    return inner(this).read_u16();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:332 read_u8
  p.read_u8 = function (this: S): number {
    return inner(this).read_u8();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:333 read_isize
  p.read_isize = function (this: S): number {
    return inner(this).read_isize();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:334 read_i128
  p.read_i128 = function (this: S): bigint {
    return inner(this).read_i128();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:335 read_i64
  p.read_i64 = function (this: S): bigint {
    return inner(this).read_i64();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:336 read_i32
  p.read_i32 = function (this: S): number {
    return inner(this).read_i32();
  };
  // rustc: compiler/rustc_middle/src/ty/codec.rs:337 read_i16
  p.read_i16 = function (this: S): number {
    return inner(this).read_i16();
  };

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/codec.rs:340 read_raw_bytes
  p.read_raw_bytes = function (this: S, len: number): Uint8Array {
    return inner(this).read_raw_bytes(len);
  };

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/codec.rs:345 peek_byte
  p.peek_byte = function (this: S): number {
    return inner(this).peek_byte();
  };

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/codec.rs:350 position
  p.position = function (this: S): number {
    return inner(this).position();
  };
}

// ---- the `Decodable<D: TyDecoder>` impls of `GenericArg` / `Term` as one-argument decoders ----
// PORT (merge-w15b): the impls are ported where they live upstream (generic_args.ts `decode_GenericArg`, marker
// generic_args.rs:372; ty/mod.ts `decode_Term`, mod.rs:640) and take their derived kind decoder as an argument; these
// adapters pass rustc_type_ir's derived `GenericArgKind` / `TermKind` decoders, for codec.rs and the generated decoders
// (tools/codegen serialize.json `I::GenericArg` / `I::Term`). Not markers.
export function decode_GenericArg_TyDecoder<D extends TyDecoder>(d: D): GenericArg {
  return generic_args_().decode_GenericArg(d, generic_arg_ir_().decode_GenericArgKind);
}
export function decode_Term_TyDecoder<D extends TyDecoder>(d: D): Term {
  return mod_().decode_Term(d, term_kind_().decode_TermKind);
}

/** PORT (lane meta-mir): `ty::Const`'s `Decodable` (rustc_type_ir serialize.rs:130) with the derived `ConstKind` decoder, as a
 *  one-argument decoder for the generated decoders of the MIR set (tools/codegen serialize.json `rustc_middle::ty::Const`),
 *  named apart from mir's own `decode_Const` (`mir::Const`, consts.rs). Not a marker. */
export function decode_ty_Const<D extends TyDecoder>(d: D): import("./consts.ts").Const {
  return type_ir_serialize_().decode_Const(d, const_kind_().decode_ConstKind) as import("./consts.ts").Const;
}

/** The encode halves of the adapters above (`Encodable for GenericArg` / `Term`: generic_args.rs:366, mod.rs:634, with
 *  the derived kind encoders; `ty::Const`: rustc_type_ir serialize.rs:125 with the derived `ConstKind` encoder; `ty::Value`:
 *  the generated `derive(TyEncodable)`, reached lazily). Not markers. */
export function encode_GenericArg_TyEncoder<E extends TyEncoder>(v: GenericArg, e: E): void {
  generic_args_().encode_GenericArg(v, e, generic_arg_ir_().encode_GenericArgKind);
}
export function encode_Term_TyEncoder<E extends TyEncoder>(v: Term, e: E): void {
  mod_().encode_Term(v, e, term_kind_().encode_TermKind);
}
export function encode_ty_Const<E extends TyEncoder>(v: import("./consts.ts").Const, e: E): void {
  type_ir_serialize_().encode_Const(v, e, const_kind_().encode_ConstKind);
}
export function encode_Value(v: Value, e: TyEncoder): void {
  decodable_().encode_Value(v, e);
}

// ---- the `Encodable` impls of the interned lists (the encode half of ./codec/ref_decodable.ts) ----
// PORT: `&'tcx List<T>` encodes through `impl<T: Encodable> Encodable for &T` and `RawList`'s impl (list.rs:199, the
// slice); `GenericArgsRef`, `Clauses` (`ListWithCachedTypeInfo`) and `CanonicalVarKinds` likewise. These adapters pass
// the element's `Encodable` impl, for codec.rs and the generated encoders (tools/codegen serialize.json `I::Tys`, ...).
// Not markers.
export function encode_List<T, E extends TyEncoder>(v: List<T>, e: E, encode_T: Encodable<T, E>): void {
  list_().encode_RawList(v, e, encode_T);
}
export function encode_List_Ty(v: List<Ty>, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_Ty);
}
export function encode_List_PolyExistentialPredicate(v: List<Binder<ExistentialPredicate>>, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_PolyExistentialPredicate);
}
/** `ty::PolyExistentialPredicate` (`Binder<ExistentialPredicate>`): rustc_type_ir serialize.rs:28 with the derived
 *  `ExistentialPredicate` encoder. */
export function encode_PolyExistentialPredicate(v: Binder<ExistentialPredicate>, e: TyEncoder): void {
  type_ir_serialize_().encode_Binder(v, e, predicate_ir_().encode_ExistentialPredicate, encode_List_BoundVariableKind);
}
export function encode_List_BoundVariableKind(v: List<BoundVariableKind>, e: TyEncoder): void {
  list_().encode_RawList(v, e, binder_().encode_BoundVariableKind);
}
export function encode_List_Pattern(v: List<Pattern>, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_Pattern);
}
export function encode_List_Const(v: List<import("./consts.ts").Const>, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_ty_Const);
}
export function encode_ListWithCachedTypeInfo_Clause(v: Clauses, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_Clause);
}
export function encode_GenericArgs(v: GenericArgs, e: TyEncoder): void {
  list_().encode_RawList(v, e, encode_GenericArg_TyEncoder);
}
export function encode_CanonicalVarKinds(v: CanonicalVarKinds, e: TyEncoder): void {
  list_().encode_RawList(v, e, canonical_().encode_CanonicalVarKind);
}

// ---- the element types these impls decode ----

/** `Decodable for mir::PlaceElem` (`ProjectionElem<Local, Ty>`): the derived `decode_ProjectionElem` of mir/syntax.rs (lane
 *  meta-mir), read lazily (init order). */
function decode_PlaceElem(d: TyDecoder): PlaceElem {
  return mir_syntax_().decode_ProjectionElem(d, mir_mod_().decode_Local, decode_Ty);
}
/** `Decodable for mir::interpret::Allocation` (`Allocation<CtfeProvenance, (), Box<[u8]>>`): allocation.rs:213's generic
 *  impl with `CtfeProvenance`'s decoder (above) and `()`'s; mir/interpret/allocation.ts read lazily (init order). */
function decode_Allocation(d: TyDecoder): Allocation {
  const allocation = require("../mir/interpret/allocation.ts") as typeof import("../mir/interpret/allocation.ts");
  return allocation.decode_Allocation(d, decode_CtfeProvenance, decode_unit);
}

/** `Encodable for mir::interpret::Allocation` (`Allocation<CtfeProvenance, (), Box<[u8]>>`): allocation.rs:194's generic
 *  impl with `CtfeProvenance`'s encoder (above) and `()`'s; mir/interpret/allocation.ts read lazily (init order). */
function encode_Allocation(v: Allocation, e: TyEncoder): void {
  const allocation = require("../mir/interpret/allocation.ts") as typeof import("../mir/interpret/allocation.ts");
  allocation.encode_Allocation(v, e, encode_CtfeProvenance, encode_unit);
}

/** `TyDecodable` / `TyEncodable` of `ty::ExprKind`'s operands, read lazily (init order: ty/consts/kind.gen.ts would
 *  otherwise load mir/ or rustc_middle/decodable.gen.ts before `TyCtxt` exists). The tools/codegen serialize.json
 *  entries of `mir::BinOp`, `mir::UnOp` and `ty::abstract_const::CastKind` name these (lane rmeta-gaps-a).
 *  `mir::BinOp` / `mir::UnOp`: the derives generated into mir/syntax.gen.ts (set rustc_middle_mir). */
export function decode_mir_BinOp(d: TyDecoder): BinOp {
  return mir_mod_().decode_BinOp(d);
}
export function encode_mir_BinOp(v: BinOp, e: TyEncoder): void {
  mir_mod_().encode_BinOp(v, e);
}
export function decode_mir_UnOp(d: TyDecoder): UnOp {
  return mir_mod_().decode_UnOp(d);
}
export function encode_mir_UnOp(v: UnOp, e: TyEncoder): void {
  mir_mod_().encode_UnOp(v, e);
}
/** `ty::abstract_const::CastKind`: the derive generated into rustc_middle/decodable.gen.ts (set rustc_middle). */
export function decode_abstract_const_CastKind(d: TyDecoder): CastKind {
  return decodable_().decode_CastKind(d);
}
export function encode_abstract_const_CastKind(v: CastKind, e: TyEncoder): void {
  decodable_().encode_CastKind(v, e);
}

export type { BoundVariableKind };
