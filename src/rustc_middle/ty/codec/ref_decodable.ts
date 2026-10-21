// Port of compiler/rustc_middle/src/ty/codec/ref_decodable.rs (lane rmeta-ty).
//
// PORT:
// - `trait RefDecodable<'tcx>` is an interface over the decoded referent; each impl is a `decode_<T>(decoder)` fn
//   (`decode_List_Ty`, ...), the names tools/codegen's serialize.json entries call for the `I::Tys` / `I::Consts` /
//   ... fields of the generated `derive(TyDecodable)`s. Arenas and interning are erased (PORTING §5): `&'tcx T` is `T`.
// - `impl_decodable_via_ref_decodable_for_local_types!` (`Decodable for &'tcx $T` = `RefDecodable::decode`) is
//   `decode_via_RefDecodable`; for the `List`s below it is the `decode_List_*` fn itself, so callers use those.
// - Callees are loaded lazily, as in ../codec.ts (its module comment): every generated type module imports these.
import type { Binder, BoundVariableKind, ExistentialPredicate } from "../../../rustc_type_ir/decls.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { TyDecoder } from "../codec.ts";
import type { Pattern } from "../decls.ts";
import type { Clauses, List } from "../list.ts";
import type { Ty } from "../mod.ts";
import type { Clause } from "../predicate.ts";

function codec_(): typeof import("../codec.ts") {
  return (codec___m ??= require("../codec.ts") as typeof import("../codec.ts"));
}
var codec___m: typeof import("../codec.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function serialize_ir_(): typeof import("../../../rustc_type_ir/serialize.ts") {
  return (serialize_ir___m ??= require("../../../rustc_type_ir/serialize.ts") as typeof import("../../../rustc_type_ir/serialize.ts"));
}
var serialize_ir___m: typeof import("../../../rustc_type_ir/serialize.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function predicate_ir_(): typeof import("../../../rustc_type_ir/predicate.ts") {
  return (predicate_ir___m ??= require("../../../rustc_type_ir/predicate.ts") as typeof import("../../../rustc_type_ir/predicate.ts"));
}
var predicate_ir___m: typeof import("../../../rustc_type_ir/predicate.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function binder_(): typeof import("../../../rustc_type_ir/binder.ts") {
  return (binder___m ??= require("../../../rustc_type_ir/binder.ts") as typeof import("../../../rustc_type_ir/binder.ts"));
}
var binder___m: typeof import("../../../rustc_type_ir/binder.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
function const_kind_(): typeof import("../../../rustc_type_ir/const_kind.ts") {
  return (const_kind___m ??= require("../../../rustc_type_ir/const_kind.ts") as typeof import("../../../rustc_type_ir/const_kind.ts"));
}
var const_kind___m: typeof import("../../../rustc_type_ir/const_kind.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/// Trait for decoding to a reference.
///
/// This is a separate trait from [`Decodable`] so that we can easily implement it for
/// upstream types, such as `FxHashSet`.
///
/// The [`TyDecodable`](rustc_macros::TyDecodable) derive macro will use this
/// trait for fields that are references (and don't use a type alias to hide that).
///
/// [`Decodable`] can still be implemented in cases where `Decodable` is required
/// by a trait bound; see `impl_decodable_via_ref_decodable_for_local_types!` for examples.
///
/// Implementations of this trait will typically allocate into an arena or interner,
/// e.g. see `impl_ref_decodable_into_arena!` in [`rustc_middle::arena`].
// #[diagnostic::on_unimplemented(note = "consider adding `{Self}` to the list in `impl_ref_decodable_into_arena!`")]
export interface RefDecodable<T> {
  // rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:26 decode
  decode(d: TyDecoder): T;
}

/** `(0..len).map(|_| decode(decoder))` (lazy; the interner collects it). */
function* decode_n<T>(decoder: TyDecoder, len: number, decode: (d: TyDecoder) => T): Generator<T> {
  for (let i = 0; i < len; i++) yield decode(decoder);
}

// impl<'tcx> RefDecodable<'tcx> for ty::List<Ty<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:30 decode
export function decode_List_Ty(decoder: TyDecoder): List<Ty> {
  const len = decoder.read_usize();
  return decoder.interner().mk_type_list_from_iter(decode_n(decoder, len, codec_().decode_Ty));
}

// impl<'tcx> RefDecodable<'tcx> for ty::List<ty::PolyExistentialPredicate<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:39 decode
export function decode_List_PolyExistentialPredicate(decoder: TyDecoder): List<Binder<ExistentialPredicate>> {
  const len = decoder.read_usize();
  return decoder.interner().mk_poly_existential_predicates_from_iter(
    decode_n(decoder, len, (d) => serialize_ir_().decode_Binder(d, predicate_ir_().decode_ExistentialPredicate, decode_List_BoundVariableKind)),
  );
}

// impl<'tcx> RefDecodable<'tcx> for ty::List<ty::BoundVariableKind<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:48 decode
export function decode_List_BoundVariableKind(decoder: TyDecoder): List<BoundVariableKind> {
  const len = decoder.read_usize();
  return decoder.interner().mk_bound_variable_kinds_from_iter(decode_n(decoder, len, binder_().decode_BoundVariableKind));
}

// impl<'tcx> RefDecodable<'tcx> for ty::List<ty::Pattern<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:57 decode
export function decode_List_Pattern(decoder: TyDecoder): List<Pattern> {
  const len = decoder.read_usize();
  return decoder.interner().mk_patterns_from_iter(decode_n(decoder, len, codec_().decode_Pattern));
}

// impl<'tcx> RefDecodable<'tcx> for ty::List<ty::Const<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:66 decode
export function decode_List_Const(decoder: TyDecoder): List<Const> {
  const len = decoder.read_usize();
  return decoder.interner().mk_const_list_from_iter(decode_n(decoder, len, (d) => serialize_ir_().decode_Const(d, const_kind_().decode_ConstKind)));
}

// impl<'tcx> RefDecodable<'tcx> for ty::ListWithCachedTypeInfo<ty::Clause<'tcx>>
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:75 decode
export function decode_ListWithCachedTypeInfo_Clause(decoder: TyDecoder): Clauses {
  const len = decoder.read_usize();
  return decoder.interner().mk_clauses_from_iter(decode_n<Clause>(decoder, len, codec_().decode_Clause));
}

/// Implements [`Decodable`] for `&'tcx T`, where [`T: RefDecodable`](RefDecodable)
/// and T is defined in this crate (`rustc_middle`).
///
/// For locally-defined types, we can use a blanket impl over any [`D: TyDecoder`](TyDecoder).
///
/// ## Note on implementing [`Decodable`] for references to non-local types
///
/// For references to types not defined in this crate, including slices/tuples/collections
/// of local types, [`Decodable`] cannot use a blanket impl and must be implemented for
/// specific decoders instead.
///
/// See invocations of `impl_decodable_via_ref_decodable_for_foreign_types!` for examples.
// macro_rules! impl_decodable_via_ref_decodable_for_local_types { (&'tcx $T:ty, ..) => { impl<'tcx, D: TyDecoder<'tcx>> Decodable<D> for &'tcx $T { .. } } }
// PORT: the macro's impl, generic over the `RefDecodable` impl of `$T`.
// rustc: compiler/rustc_middle/src/ty/codec/ref_decodable.rs:103 decode
export function decode_via_RefDecodable<T>(decoder: TyDecoder, ref_decodable_T: RefDecodable<T>): T {
  return ref_decodable_T.decode(decoder);
}

// impl_decodable_via_ref_decodable_for_local_types! {
//     // tidy-alphabetical-start
//     &'tcx mir::Body<'tcx>,                               (M4)
//     &'tcx traits::ImplSource<'tcx, ()>,                  (lane middle-traits-thir)
//     &'tcx traits::specialization_graph::Graph,           (lane middle-traits-thir)
//     &'tcx ty::List<Ty<'tcx>>,                            decode_List_Ty
//     &'tcx ty::List<ty::BoundVariableKind<'tcx>>,         decode_List_BoundVariableKind
//     &'tcx ty::List<ty::Const<'tcx>>,                     decode_List_Const
//     &'tcx ty::List<ty::Pattern<'tcx>>,                   decode_List_Pattern
//     &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>>,  decode_List_PolyExistentialPredicate
//     &'tcx ty::ListWithCachedTypeInfo<ty::Clause<'tcx>>,  decode_ListWithCachedTypeInfo_Clause
//     &'tcx ty::TypeckResults<'tcx>,                       (lane ty-results)
//     // tidy-alphabetical-end
// }
