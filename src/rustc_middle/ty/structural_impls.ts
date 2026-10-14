// Contract stub for compiler/rustc_middle/src/ty/structural_impls.rs (merge-w13; the file belongs to the ty-print /
// tyir-binder lanes of plan-m3 waves 14-15).
//
// The `TypeVisitable` / `TypeFoldable` impls of the interned types whose TS module does not exist yet (and of
// `Clauses` / `ErrorGuaranteed`), as tools/codegen's generated code calls them: `visit_with_<T>` / `try_fold_with_<T>`
// / `fold_with_<T>` free fns (tools/codegen type_fold.json). The impls of `Ty`, `Predicate` and `Clause` are stubs
// in their types' modules (ty/mod.ts, ty/predicate.ts). When a lane ports one, it writes the D4 descriptor
// `fold_<T>` (docs/plan-m3.md D4, rustc_type_ir/fold.ts header) and keeps these names as its wrappers.
// The list impls are `list_fold!` (structural_impls.rs) for fold and `impl TypeVisitable for &List<T>`
// (generic_args.rs:714) for visit.
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { ParamTy } from "./sty.gen.ts";
import type { Result } from "../../std/result.ts";
import type { AdtDef, BoundExistentialPredicates, Consts, LocalDefIds, PatList, Pattern, PredefinedOpaques, RegionAssumptions } from "./decls.ts";
import type { Clauses } from "./list.ts";

const stub = (what: string): never => unported(`rustc_middle::ty::structural_impls: ${what}`);

// `impl fmt::Debug for ty::ParamTy` (structural_impls.rs:88): ported by the later ty lanes (codegen-tyir stub; moved here
// from ty/sty.ts by merge-w15a, so that defining modules do not import that extension module).
export const debug_ParamTy: Debug<ParamTy> = (_v, _f) => unported("Debug for ParamTy (`impl fmt::Debug for ty::ParamTy` (structural_impls.rs:88))");

/** Stub: `impl TypeVisitable for ty::AdtDef` (structural_impls.rs:284); no TypeFoldable impl. */
export function visit_with_AdtDef<R>(_self: AdtDef, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for AdtDef (:284)");
}

/** Stub: `impl TypeVisitable for Pattern` (structural_impls.rs:305). */
export function visit_with_Pattern<R>(_self: Pattern, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for Pattern (:305)");
}
/** Stub: `impl TypeFoldable for Pattern` (structural_impls.rs:290). */
export function try_fold_with_Pattern<E>(_self: Pattern, _folder: FallibleTypeFolder<E>): Result<Pattern, E> {
  return stub("TypeFoldable for Pattern (:290)");
}
export function fold_with_Pattern(_self: Pattern, _folder: TypeFolder): Pattern {
  return stub("TypeFoldable for Pattern (:290)");
}

/** Stub: `impl TypeVisitable for ty::Clauses` (structural_impls.rs:618). */
export function visit_with_Clauses<R>(_self: Clauses, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for Clauses (:618)");
}
/** Stub: `impl TypeFoldable for ty::Clauses` (structural_impls.rs:564). */
export function try_fold_with_Clauses<E>(_self: Clauses, _folder: FallibleTypeFolder<E>): Result<Clauses, E> {
  return stub("TypeFoldable for Clauses (:564)");
}
export function fold_with_Clauses(_self: Clauses, _folder: TypeFolder): Clauses {
  return stub("TypeFoldable for Clauses (:564)");
}

/** Stub: `impl TypeVisitable for rustc_span::ErrorGuaranteed` (structural_impls.rs:674). */
export function visit_with_ErrorGuaranteed<R>(_self: ErrorGuaranteed, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for ErrorGuaranteed (:674)");
}
/** Stub: `impl TypeFoldable for rustc_span::ErrorGuaranteed` (structural_impls.rs:680). */
export function try_fold_with_ErrorGuaranteed<E>(_self: ErrorGuaranteed, _folder: FallibleTypeFolder<E>): Result<ErrorGuaranteed, E> {
  return stub("TypeFoldable for ErrorGuaranteed (:680)");
}
export function fold_with_ErrorGuaranteed(_self: ErrorGuaranteed, _folder: TypeFolder): ErrorGuaranteed {
  return stub("TypeFoldable for ErrorGuaranteed (:680)");
}

/** Stub: `impl TypeVisitable for &List<LocalDefId>` (generic_args.rs:714). */
export function visit_with_LocalDefIds<R>(_self: LocalDefIds, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<LocalDefId> (generic_args.rs:714)");
}
/** Stub: `impl TypeFoldable for &List<LocalDefId>` (structural_impls.rs:726). */
export function try_fold_with_LocalDefIds<E>(_self: LocalDefIds, _folder: FallibleTypeFolder<E>): Result<LocalDefIds, E> {
  return stub("TypeFoldable for &List<LocalDefId> (:726)");
}
export function fold_with_LocalDefIds(_self: LocalDefIds, _folder: TypeFolder): LocalDefIds {
  return stub("TypeFoldable for &List<LocalDefId> (:726)");
}

/** Stub: `TypeVisitable for &List<Const>` (generic_args.rs:714). */
export function visit_with_Consts<R>(_self: Consts, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<Const> (generic_args.rs:714)");
}
/** Stub: `list_fold! { &'tcx ty::List<ty::Const<'tcx>> : mk_const_list }` (structural_impls.rs). */
export function try_fold_with_Consts<E>(_self: Consts, _folder: FallibleTypeFolder<E>): Result<Consts, E> {
  return stub("TypeFoldable for &List<Const> (list_fold!)");
}
export function fold_with_Consts(_self: Consts, _folder: TypeFolder): Consts {
  return stub("TypeFoldable for &List<Const> (list_fold!)");
}

/** Stub: `TypeVisitable for &List<Pattern>` (generic_args.rs:714). */
export function visit_with_PatList<R>(_self: PatList, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<Pattern> (generic_args.rs:714)");
}
/** Stub: `list_fold! { &'tcx ty::List<ty::Pattern<'tcx>> : mk_patterns }` (structural_impls.rs). */
export function try_fold_with_PatList<E>(_self: PatList, _folder: FallibleTypeFolder<E>): Result<PatList, E> {
  return stub("TypeFoldable for &List<Pattern> (list_fold!)");
}
export function fold_with_PatList(_self: PatList, _folder: TypeFolder): PatList {
  return stub("TypeFoldable for &List<Pattern> (list_fold!)");
}

/** Stub: `TypeVisitable for &List<PolyExistentialPredicate>` (generic_args.rs:714). */
export function visit_with_BoundExistentialPredicates<R>(_self: BoundExistentialPredicates, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<PolyExistentialPredicate> (generic_args.rs:714)");
}
/** Stub: `list_fold! { &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>> : mk_poly_existential_predicates }`. */
export function try_fold_with_BoundExistentialPredicates<E>(_self: BoundExistentialPredicates, _folder: FallibleTypeFolder<E>): Result<BoundExistentialPredicates, E> {
  return stub("TypeFoldable for &List<PolyExistentialPredicate> (list_fold!)");
}
export function fold_with_BoundExistentialPredicates(_self: BoundExistentialPredicates, _folder: TypeFolder): BoundExistentialPredicates {
  return stub("TypeFoldable for &List<PolyExistentialPredicate> (list_fold!)");
}

/** Stub: `TypeVisitable for &List<ArgOutlivesClause>` (generic_args.rs:714). */
export function visit_with_RegionAssumptions<R>(_self: RegionAssumptions, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<ArgOutlivesClause> (generic_args.rs:714)");
}
/** Stub: `list_fold! { &'tcx ty::List<ty::ArgOutlivesClause<'tcx>> : mk_outlives }` (structural_impls.rs). */
export function try_fold_with_RegionAssumptions<E>(_self: RegionAssumptions, _folder: FallibleTypeFolder<E>): Result<RegionAssumptions, E> {
  return stub("TypeFoldable for &List<ArgOutlivesClause> (list_fold!)");
}
export function fold_with_RegionAssumptions(_self: RegionAssumptions, _folder: TypeFolder): RegionAssumptions {
  return stub("TypeFoldable for &List<ArgOutlivesClause> (list_fold!)");
}

/** Stub: `TypeVisitable for &List<(OpaqueTypeKey, Ty)>` (generic_args.rs:714). */
export function visit_with_PredefinedOpaques<R>(_self: PredefinedOpaques, _visitor: TypeVisitor<R>): R {
  return stub("TypeVisitable for &List<(OpaqueTypeKey, Ty)> (generic_args.rs:714)");
}
/** Stub: `list_fold! { &'tcx ty::List<(ty::OpaqueTypeKey<'tcx>, Ty<'tcx>)>: mk_predefined_opaques_in_body }`. */
export function try_fold_with_PredefinedOpaques<E>(_self: PredefinedOpaques, _folder: FallibleTypeFolder<E>): Result<PredefinedOpaques, E> {
  return stub("TypeFoldable for &List<(OpaqueTypeKey, Ty)> (list_fold!)");
}
export function fold_with_PredefinedOpaques(_self: PredefinedOpaques, _folder: TypeFolder): PredefinedOpaques {
  return stub("TypeFoldable for &List<(OpaqueTypeKey, Ty)> (list_fold!)");
}
