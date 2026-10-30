// Port of compiler/rustc_type_ir/src/serialize.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT: the `Encodable` impls (plan-m5 D3, lane encode-contract) mirror the `Decodable` ones: the `Encodable` impls of their
// parts are passed as fns (`encode_T`, `encode_BoundVarKinds`, `encode_RegionKind`, `encode_ConstKind`). The `Decodable` impls are reached from
// crate metadata (rmeta type tables decode `Binder`s, `Region`s and `Const`s, e.g. `fn_sig` / `type_of` /
// `predicates_of` of extern items), but they are hand-written upstream (re-interning through `InternerDecoder`), so they
// are ported here, with the `Decodable` impls of their parts passed as fns (`decode_T`, `decode_BoundVarKinds`,
// `decode_RegionKind`, `decode_ConstKind`): those are derived impls that tools/codegen generates. Nothing calls these
// yet (no TS decoder decodes types so far).
// (Since lane rmeta-ty, the generated decoders and rustc_middle ty/codec.ts call them.)
// PORT: `D: Decoder` / `D: InternerDecoder<Interner = I>` are the decoder object; `I` is erased to `TyCtxt` (D3).
// PORT (lane rmeta-ty): tools/codegen's serialize.json entries for `Binder`, `UnsafeBinderInner`, `Region` and `Const`
// call these from the generated type modules, so the callees are loaded lazily (rustc_middle ty/codec.ts module
// comment): importing this module must not change the evaluation order of binder.ts / sty / ty_kind.ts.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Decoder, Encodable, Encoder } from "../rustc_serialize/serialize.ts";
import type { Binder } from "./binder.ts";
import type { BoundVariableKind, ConstKind, RegionKind } from "./decls.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import type { UnsafeBinderInner } from "./ty_kind.ts";

function binder_(): typeof import("./binder.ts") {
  return (binder___m ??= require("./binder.ts") as typeof import("./binder.ts"));
}
var binder___m: typeof import("./binder.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function consts_(): typeof import("./sty/consts.ts") {
  return (consts___m ??= require("./sty/consts.ts") as typeof import("./sty/consts.ts"));
}
var consts___m: typeof import("./sty/consts.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function ty_kind_(): typeof import("./ty_kind.ts") {
  return (ty_kind___m ??= require("./ty_kind.ts") as typeof import("./ty_kind.ts"));
}
var ty_kind___m: typeof import("./ty_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/// A decoder that can reconstruct interned type IR values by supplying the
/// interner that owns the decoded data.
///
/// Some serialized type IR wrappers only store their structural kind. When
/// decoding, those kinds have to be re-interned instead of rebuilt as raw
/// values, so their `Decodable` impls need access to the active interner in
/// addition to the byte stream.
// rustc-trait: compiler/rustc_type_ir/src/serialize.rs:14 InternerDecoder
export interface InternerDecoder extends Decoder {
  // rustc: compiler/rustc_type_ir/src/serialize.rs:17 interner
  interner(): TyCtxt;
}

// `impl_binder_encode_decode! { FnSig, FnSigTys, TraitClause, ExistentialPredicate, TraitRef, ExistentialTraitRef,
// HostEffectClause }`: the macro's impls, one generic fn each.
// PORT: `$t: Encodable<E>` is `encode_T`, `I::BoundVarKinds: Encodable<E>` is `encode_BoundVarKinds`.
// rustc: compiler/rustc_type_ir/src/serialize.rs:28 encode
export function encode_Binder<E extends Encoder, T>(
  self: Binder<T>,
  e: E,
  encode_T: Encodable<T, E>,
  encode_BoundVarKinds: Encodable<List<BoundVariableKind>, E>,
): void {
  const Binder = binder_().Binder;
  encode_BoundVarKinds(Binder.bound_vars(self), e);
  encode_T(Binder.skip_binder(Binder.as_ref(self)), e);
}

// PORT: `$t: Decodable<D>` is `decode_T`, `I::BoundVarKinds: Decodable<D>` is `decode_BoundVarKinds`.
// rustc: compiler/rustc_type_ir/src/serialize.rs:38 decode
export function decode_Binder<D extends Decoder, T>(
  decoder: D,
  decode_T: (d: D) => T,
  decode_BoundVarKinds: (d: D) => List<BoundVariableKind>,
): Binder<T> {
  const bound_vars = decode_BoundVarKinds(decoder);
  return binder_().Binder.bind_with_vars(decode_T(decoder), bound_vars);
}

// `impl<T: GenericArgs<I>, ..> Encodable<E> / Decodable<D> for ty::Binder<I, T>` (`T` = `I::GenericArgs`).
// rustc: compiler/rustc_type_ir/src/serialize.rs:62 encode
export function encode_Binder_GenericArgs<E extends Encoder, T>(
  self: Binder<T>,
  e: E,
  encode_T: Encodable<T, E>,
  encode_BoundVarKinds: Encodable<List<BoundVariableKind>, E>,
): void {
  const Binder = binder_().Binder;
  encode_BoundVarKinds(Binder.bound_vars(self), e);
  encode_T(Binder.skip_binder(Binder.as_ref(self)), e);
}

// rustc: compiler/rustc_type_ir/src/serialize.rs:73 decode
export function decode_Binder_GenericArgs<D extends Decoder, T>(
  decoder: D,
  decode_T: (d: D) => T,
  decode_BoundVarKinds: (d: D) => List<BoundVariableKind>,
): Binder<T> {
  const bound_vars = decode_BoundVarKinds(decoder);
  return binder_().Binder.bind_with_vars(decode_T(decoder), bound_vars);
}

// PORT: `self.bound_vars()` / `self.as_ref()` go through `Deref<Target = Binder<I, I::Ty>>` (`self._0`).
// rustc: compiler/rustc_type_ir/src/serialize.rs:84 encode
export function encode_UnsafeBinderInner<E extends Encoder>(
  self: UnsafeBinderInner,
  e: E,
  encode_Ty: Encodable<Ty, E>,
  encode_BoundVarKinds: Encodable<List<BoundVariableKind>, E>,
): void {
  const Binder = binder_().Binder;
  encode_BoundVarKinds(Binder.bound_vars(self._0), e);
  encode_Ty(Binder.skip_binder(Binder.as_ref(self._0)), e);
}

// rustc: compiler/rustc_type_ir/src/serialize.rs:95 decode
export function decode_UnsafeBinderInner<D extends Decoder>(
  decoder: D,
  decode_Ty: (d: D) => Ty,
  decode_BoundVarKinds: (d: D) => List<BoundVariableKind>,
): UnsafeBinderInner {
  const bound_vars = decode_BoundVarKinds(decoder);
  return ty_kind_().UnsafeBinderInner.from_Binder(binder_().Binder.bind_with_vars(decode_Ty(decoder), bound_vars));
}

// rustc: compiler/rustc_type_ir/src/serialize.rs:105 encode
export function encode_Region<E extends Encoder>(self: Region, e: E, encode_RegionKind: Encodable<RegionKind, E>): void {
  encode_RegionKind(self.kind(), e);
}

// Decoding a region needs an interner so it can decode a RegionKind and
// re-intern it.
// rustc: compiler/rustc_type_ir/src/serialize.rs:116 decode
export function decode_Region<D extends InternerDecoder>(decoder: D, decode_RegionKind: (d: D) => RegionKind): Region {
  return decoder.interner().intern_region(decode_RegionKind(decoder));
}

// rustc: compiler/rustc_type_ir/src/serialize.rs:125 encode
export function encode_Const<E extends Encoder>(self: Const, e: E, encode_ConstKind: Encodable<ConstKind, E>): void {
  encode_ConstKind(self.kind(), e);
}

// rustc: compiler/rustc_type_ir/src/serialize.rs:134 decode
export function decode_Const<D extends InternerDecoder>(decoder: D, decode_ConstKind: (d: D) => ConstKind): Const {
  return consts_().Const.new(decoder.interner(), decode_ConstKind(decoder));
}
