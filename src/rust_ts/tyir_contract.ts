// PORT: stand-ins for the M3 type contract (plan-m3 D2-D4) that the generated rustc_type_ir / rustc_middle::ty types
// (set `rustc_ty` of tools/codegen/types.ts) import before the lanes that own them have merged:
//
// - the interned types and lists of lane ty-contract (`Ty`, `Region`, `Const`, `List`, `GenericArg`, ...), named as
//   TyCtxt's `Interner` associated types (rustc_middle/src/ty/context/impl_interner.rs), because D3 erases `I: Interner`
//   and the generated code reads `I::Ty` as `Ty` (tools/codegen/tyir.typemap.json);
// - the traversal traits of rustc_type_ir visit.rs / fold.rs (`TypeVisitor`, `TypeFolder`, `FallibleTypeFolder`) and
//   the impl-fn shapes the generated `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` take for type parameters
//   (D4: generic code takes descriptors), plus the impls of std containers and of the interned types
//   (tools/codegen/type_fold.json);
// - a few types of crates not ported yet (rustc_abi `FieldIdx`, mir `BinOp`, ...).
//
// Nothing here is a port: every value is `unported(..)` except the `TrivialTypeTraversalImpls!` bodies. When the owning
// lanes merge, root points the entries of tools/codegen/tyir.typemap.json and type_fold.json at the real modules,
// regenerates set rustc_ty and deletes the names from here (see docs/handoff/codegen-tyir.md).
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import type { Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";

/** An opaque stand-in type (no values can be built outside this module). */
type Stub<N extends string> = { readonly __tyir_stub: N };

const stub_debug =
  (what: string) =>
  (_v: unknown, _f: Fmt, ..._d: unknown[]): string =>
    unported(`${what} (stand-in in src/rust_ts/tyir_contract.ts)`);
const stub_fn =
  (what: string) =>
  (..._a: unknown[]): never =>
    unported(`${what} (stand-in in src/rust_ts/tyir_contract.ts)`);

// ---- traversal traits (rustc_type_ir visit.rs / fold.rs; lanes ty-contract / tyir-binder) ----

/** `TypeVisitor<I>`: `type Result: VisitorResult`; the hooks (`visit_ty`, `visit_region`, ...) belong to the real trait. */
export interface TypeVisitor<R> {
  readonly Result: VisitorResult<R, unknown>;
}
/** `TypeFolder<I>` (the hooks `fold_ty`, `fold_region`, ... belong to the real trait). */
export interface TypeFolder {
  readonly __TypeFolder?: never;
}
/** `FallibleTypeFolder<I>` with `type Error = E`. */
export interface FallibleTypeFolder<E> {
  readonly __FallibleTypeFolder?: E;
}
/** `<T as TypeVisitable<I>>::visit_with` as a value (the impl of a type parameter). */
export type VisitWith<T> = <R>(self: T, visitor: TypeVisitor<R>) => R;
/** `<T as TypeFoldable<I>>::try_fold_with` as a value. */
export type TryFoldWith<T> = <E>(self: T, folder: FallibleTypeFolder<E>) => Result<T, E>;
/** `<T as TypeFoldable<I>>::fold_with` as a value. */
export type FoldWith<T> = (self: T, folder: TypeFolder) => T;

// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (visit_with: `output()`)
export function visit_with_trivial<T, R>(_self: T, visitor: TypeVisitor<R>): R {
  return visitor.Result.output();
}
// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (try_fold_with: `Ok(self)`)
export function try_fold_with_trivial<T, E>(self: T, _folder: FallibleTypeFolder<E>): Result<T, E> {
  return Ok(self);
}
// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (fold_with: `self`)
export function fold_with_trivial<T>(self: T, _folder: TypeFolder): T {
  return self;
}

// std impls (visit.rs:136-240, fold.rs:232-392; lane tyir-binder)
export const visit_with_Option: <T, R>(self: T | undefined, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>) => R = stub_fn("TypeVisitable for Option<T>");
export const try_fold_with_Option: <T, E>(self: T | undefined, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>) => Result<T | undefined, E> = stub_fn("TypeFoldable for Option<T>");
export const fold_with_Option: <T>(self: T | undefined, folder: TypeFolder, fold_with_T: FoldWith<T>) => T | undefined = stub_fn("TypeFoldable for Option<T>");
export const visit_with_Result: <T, U, R>(self: Result<T, U>, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>, visit_with_U: VisitWith<U>) => R = stub_fn("TypeVisitable for Result<T, E>");
export const try_fold_with_Result: <T, U, E>(self: Result<T, U>, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>, try_fold_with_U: TryFoldWith<U>) => Result<Result<T, U>, E> =
  stub_fn("TypeFoldable for Result<T, E>");
export const fold_with_Result: <T, U>(self: Result<T, U>, folder: TypeFolder, fold_with_T: FoldWith<T>, fold_with_U: FoldWith<U>) => Result<T, U> = stub_fn("TypeFoldable for Result<T, E>");
export const visit_with_Vec: <T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>) => R = stub_fn("TypeVisitable for Vec<T>");
export const try_fold_with_Vec: <T, E>(self: T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>) => Result<T[], E> = stub_fn("TypeFoldable for Vec<T>");
export const fold_with_Vec: <T>(self: T[], folder: TypeFolder, fold_with_T: FoldWith<T>) => T[] = stub_fn("TypeFoldable for Vec<T>");
export const visit_with_IndexSet: <T, R>(self: Set<T>, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>) => R = stub_fn("TypeVisitable for IndexSet<T>");
export const visit_with_slice: <T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>) => R = stub_fn("TypeVisitable for [T]");
export const try_fold_with_slice: <T, E>(self: T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>) => Result<T[], E> = stub_fn("TypeFoldable for Box<[T]>");
export const fold_with_slice: <T>(self: T[], folder: TypeFolder, fold_with_T: FoldWith<T>) => T[] = stub_fn("TypeFoldable for Box<[T]>");
export const visit_with_tuple2: <T, U, R>(self: [T, U], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>, visit_with_U: VisitWith<U>) => R = stub_fn("TypeVisitable for (T, U)");
export const try_fold_with_tuple2: <T, U, E>(self: [T, U], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>, try_fold_with_U: TryFoldWith<U>) => Result<[T, U], E> =
  stub_fn("TypeFoldable for (T, U)");
export const fold_with_tuple2: <T, U>(self: [T, U], folder: TypeFolder, fold_with_T: FoldWith<T>, fold_with_U: FoldWith<U>) => [T, U] = stub_fn("TypeFoldable for (T, U)");
export const visit_with_tuple3: <A, B, C, R>(self: [A, B, C], visitor: TypeVisitor<R>, a: VisitWith<A>, b: VisitWith<B>, c: VisitWith<C>) => R = stub_fn("TypeVisitable for (A, B, C)");
export const try_fold_with_tuple3: <A, B, C, E>(self: [A, B, C], folder: FallibleTypeFolder<E>, a: TryFoldWith<A>, b: TryFoldWith<B>, c: TryFoldWith<C>) => Result<[A, B, C], E> =
  stub_fn("TypeFoldable for (A, B, C)");
export const fold_with_tuple3: <A, B, C>(self: [A, B, C], folder: TypeFolder, a: FoldWith<A>, b: FoldWith<B>, c: FoldWith<C>) => [A, B, C] = stub_fn("TypeFoldable for (A, B, C)");

// ---- interned types and lists (lane ty-contract; TyCtxt's `Interner` associated types) ----

export type Ty = Stub<"Ty">;
export type Region = Stub<"Region">;
export type Const = Stub<"Const">;
export type GenericArg = Stub<"GenericArg">;
export type Term = Stub<"Term">;
/** `&'tcx List<T>` / `RawList<(), T>` */
export type List<T> = Stub<"List"> & { readonly __elem?: T };
/** `type Tys = &'tcx List<Ty<'tcx>>` */
export type Tys = List<Ty>;
/** `type FnInputTys = &'tcx [Ty<'tcx>]` */
export type FnInputTys = readonly Ty[];
/** `type GenericArgs = ty::GenericArgsRef<'tcx>` (`&'tcx List<GenericArg<'tcx>>`) */
export type GenericArgs = List<GenericArg>;
/** `type GenericArgsSlice = &'tcx [ty::GenericArg<'tcx>]` */
export type GenericArgsSlice = readonly GenericArg[];
/** `type Consts = &'tcx List<ty::Const<'tcx>>` */
export type Consts = List<Const>;
export type BoundVarKinds = Stub<"BoundVarKinds">;
export type PredefinedOpaques = Stub<"PredefinedOpaques">;
export type LocalDefIds = Stub<"LocalDefIds">;
export type CanonicalVarKinds = Stub<"CanonicalVarKinds">;
export type ExternalConstraints = Stub<"ExternalConstraints">;
export type BoundExistentialPredicates = Stub<"BoundExistentialPredicates">;
export type Pattern = Stub<"Pattern">;
export type PatList = Stub<"PatList">;
export type Value = Stub<"Value">;
export type ValTree = Stub<"ValTree">;
export type ScalarInt = Stub<"ScalarInt">;
export type AdtDef = Stub<"AdtDef">;
export type Predicate = Stub<"Predicate">;
export type Clause = Stub<"Clause">;
export type Clauses = Stub<"Clauses">;
export type ParamEnv = Stub<"ParamEnv">;
export type RegionAssumptions = Stub<"RegionAssumptions">;
export type InternedRegionKind = Stub<"InternedRegionKind">;
export type InternedConstKind = Stub<"InternedConstKind">;

export const debug_Ty = stub_debug("Debug for Ty");
export const debug_Region = stub_debug("Debug for Region");
export const debug_Const = stub_debug("Debug for Const");
export const debug_GenericArg = stub_debug("Debug for GenericArg");
export const debug_Term = stub_debug("Debug for Term");
export const debug_List: <T>(v: List<T>, f: Fmt, debug_T: (v: T, f: Fmt) => string) => string = stub_debug("Debug for List<T>");
export const debug_Tys = stub_debug("Debug for &List<Ty>");
export const debug_FnInputTys = stub_debug("Debug for &[Ty]");
export const debug_GenericArgs = stub_debug("Debug for GenericArgsRef");
export const debug_GenericArgsSlice = stub_debug("Debug for &[GenericArg]");
export const debug_Consts = stub_debug("Debug for &List<Const>");
export const debug_BoundVarKinds = stub_debug("Debug for &List<BoundVariableKind>");
export const debug_PredefinedOpaques = stub_debug("Debug for PredefinedOpaques");
export const debug_LocalDefIds = stub_debug("Debug for &List<LocalDefId>");
export const debug_CanonicalVarKinds = stub_debug("Debug for CanonicalVarKinds");
export const debug_ExternalConstraints = stub_debug("Debug for ExternalConstraints");
export const debug_BoundExistentialPredicates = stub_debug("Debug for &List<PolyExistentialPredicate>");
export const debug_Pattern = stub_debug("Debug for Pattern");
export const debug_PatList = stub_debug("Debug for &List<Pattern>");
export const debug_Value = stub_debug("Debug for ty::Value");
export const debug_ValTree = stub_debug("Debug for ValTree");
export const debug_ScalarInt = stub_debug("Debug for ScalarInt");
export const debug_AdtDef = stub_debug("Debug for AdtDef");
export const debug_Predicate = stub_debug("Debug for Predicate");
export const debug_Clause = stub_debug("Debug for Clause");
export const debug_Clauses = stub_debug("Debug for Clauses");
export const debug_ParamEnv = stub_debug("Debug for ParamEnv");
export const debug_RegionAssumptions = stub_debug("Debug for &List<ArgOutlivesClause>");
export const debug_InternedRegionKind = stub_debug("Debug for Interned<RegionKind>");
export const debug_InternedConstKind = stub_debug("Debug for Interned<WithCachedTypeInfo<ConstKind>>");

/** The structural impls of the interned types (rustc_middle structural_impls.rs, generic_args.rs, mod.rs; see type_fold.json). */
function traversal<T>(what: string): { visit: <R>(self: T, visitor: TypeVisitor<R>) => R; try_fold: <E>(self: T, folder: FallibleTypeFolder<E>) => Result<T, E>; fold: (self: T, folder: TypeFolder) => T } {
  return { visit: stub_fn(`TypeVisitable for ${what}`), try_fold: stub_fn(`TypeFoldable for ${what}`), fold: stub_fn(`TypeFoldable for ${what}`) };
}
const Ty_ = traversal<Ty>("Ty");
export const { visit: visit_with_Ty, try_fold: try_fold_with_Ty, fold: fold_with_Ty } = Ty_;
const GenericArgs_ = traversal<GenericArgs>("GenericArgsRef");
export const { visit: visit_with_GenericArgs, try_fold: try_fold_with_GenericArgs, fold: fold_with_GenericArgs } = GenericArgs_;
const GenericArg_ = traversal<GenericArg>("GenericArg");
export const { visit: visit_with_GenericArg, try_fold: try_fold_with_GenericArg, fold: fold_with_GenericArg } = GenericArg_;
export const visit_with_GenericArgsSlice: <R>(self: GenericArgsSlice, visitor: TypeVisitor<R>) => R = stub_fn("TypeVisitable for &[GenericArg]");
const Tys_ = traversal<Tys>("&List<Ty>");
export const { visit: visit_with_Tys, try_fold: try_fold_with_Tys, fold: fold_with_Tys } = Tys_;
const Term_ = traversal<Term>("Term");
export const { visit: visit_with_Term, try_fold: try_fold_with_Term, fold: fold_with_Term } = Term_;
const Consts_ = traversal<Consts>("&List<Const>");
export const { visit: visit_with_Consts, try_fold: try_fold_with_Consts, fold: fold_with_Consts } = Consts_;
const Pattern_ = traversal<Pattern>("Pattern");
export const { visit: visit_with_Pattern, try_fold: try_fold_with_Pattern, fold: fold_with_Pattern } = Pattern_;
const PatList_ = traversal<PatList>("&List<Pattern>");
export const { visit: visit_with_PatList, try_fold: try_fold_with_PatList, fold: fold_with_PatList } = PatList_;
const ParamEnv_ = traversal<ParamEnv>("ParamEnv");
export const { visit: visit_with_ParamEnv, try_fold: try_fold_with_ParamEnv, fold: fold_with_ParamEnv } = ParamEnv_;
const Predicate_ = traversal<Predicate>("Predicate");
export const { visit: visit_with_Predicate, try_fold: try_fold_with_Predicate, fold: fold_with_Predicate } = Predicate_;
const Clause_ = traversal<Clause>("Clause");
export const { visit: visit_with_Clause, try_fold: try_fold_with_Clause, fold: fold_with_Clause } = Clause_;
const Clauses_ = traversal<Clauses>("Clauses");
export const { visit: visit_with_Clauses, try_fold: try_fold_with_Clauses, fold: fold_with_Clauses } = Clauses_;
const BoundExistentialPredicates_ = traversal<BoundExistentialPredicates>("&List<PolyExistentialPredicate>");
export const { visit: visit_with_BoundExistentialPredicates, try_fold: try_fold_with_BoundExistentialPredicates, fold: fold_with_BoundExistentialPredicates } = BoundExistentialPredicates_;
const PredefinedOpaques_ = traversal<PredefinedOpaques>("PredefinedOpaques");
export const { visit: visit_with_PredefinedOpaques, try_fold: try_fold_with_PredefinedOpaques, fold: fold_with_PredefinedOpaques } = PredefinedOpaques_;
const ExternalConstraints_ = traversal<ExternalConstraints>("ExternalConstraints");
export const { visit: visit_with_ExternalConstraints, try_fold: try_fold_with_ExternalConstraints, fold: fold_with_ExternalConstraints } = ExternalConstraints_;
const RegionAssumptions_ = traversal<RegionAssumptions>("&List<ArgOutlivesClause>");
export const { visit: visit_with_RegionAssumptions, try_fold: try_fold_with_RegionAssumptions, fold: fold_with_RegionAssumptions } = RegionAssumptions_;
const LocalDefIds_ = traversal<LocalDefIds>("&List<LocalDefId>");
export const { visit: visit_with_LocalDefIds, try_fold: try_fold_with_LocalDefIds, fold: fold_with_LocalDefIds } = LocalDefIds_;
const Value_ = traversal<Value>("ty::Value");
export const { visit: visit_with_Value, try_fold: try_fold_with_Value, fold: fold_with_Value } = Value_;
const ErrorGuaranteed_ = traversal<import("../rustc_span/lib.ts").ErrorGuaranteed>("ErrorGuaranteed");
export const { visit: visit_with_ErrorGuaranteed, try_fold: try_fold_with_ErrorGuaranteed, fold: fold_with_ErrorGuaranteed } = ErrorGuaranteed_;
export const visit_with_AdtDef: <R>(self: AdtDef, visitor: TypeVisitor<R>) => R = stub_fn("TypeVisitable for AdtDef");

// ---- types of crates or modules not ported yet ----

/** rustc_middle ty/mod.rs `ImplTraitInTraitData` (lane ty-mod) */
export type ImplTraitInTraitData = Stub<"ImplTraitInTraitData">;
/** rustc_middle ty/abstract_const.rs `CastKind` */
export type CastKind = Stub<"CastKind">;
/** rustc_middle mir/syntax.rs `BinOp` / `UnOp` (M4) */
export type BinOp = Stub<"BinOp">;
export type UnOp = Stub<"UnOp">;
/** rustc_abi `FieldIdx` / `VariantIdx` (`newtype_index!`) */
export type FieldIdx = Stub<"FieldIdx">;
export type VariantIdx = Stub<"VariantIdx">;
/** rustc_type_ir search_graph/mod.rs `RequiredDepth` (lane tyir-solve) */
export type RequiredDepth = Stub<"RequiredDepth">;
/** rustc_data_structures sorted_map.rs `SortedIndexMultiMap<I, K, V>` */
export type SortedIndexMultiMap<I, K, V> = Stub<"SortedIndexMultiMap"> & { readonly __args?: [I, K, V] };
/** rustc_data_structures transitive_relation.rs `TransitiveRelation<T>` */
export type TransitiveRelation<T> = Stub<"TransitiveRelation"> & { readonly __args?: T };

export const debug_ImplTraitInTraitData = stub_debug("Debug for ImplTraitInTraitData");
export const debug_CastKind = stub_debug("Debug for abstract_const::CastKind");
export const debug_BinOp = stub_debug("Debug for mir::BinOp");
export const debug_UnOp = stub_debug("Debug for mir::UnOp");
export const debug_FieldIdx = stub_debug("Debug for FieldIdx");
export const debug_VariantIdx = stub_debug("Debug for VariantIdx");
export const debug_RequiredDepth = stub_debug("Debug for RequiredDepth");
export const debug_SortedIndexMultiMap: <I, K, V>(v: SortedIndexMultiMap<I, K, V>, f: Fmt, debug_I: (v: I, f: Fmt) => string, debug_K: (v: K, f: Fmt) => string, debug_V: (v: V, f: Fmt) => string) => string =
  stub_debug("Debug for SortedIndexMultiMap");
export const debug_TransitiveRelation: <T>(v: TransitiveRelation<T>, f: Fmt, debug_T: (v: T, f: Fmt) => string) => string = stub_debug("Debug for TransitiveRelation");
