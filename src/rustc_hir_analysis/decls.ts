// The rustc_hir_analysis collect / HIR ty lowering contract (lane hirtylowerer-contract, plan-m3 wave 16):
// - the `HirTyLowerer` trait (hir_ty_lowering/mod.rs:138) as `HirTyLowererImpl<S>` (an impl block = a vtable object) and
//   its trait object `HirTyLowerer` (class), whose `impl dyn HirTyLowerer` methods span hir_ty_lowering/{mod, bounds,
//   dyn_trait, errors}.rs; mod.rs is split between two lanes at line 2186;
// - `GenericArgsLowerer` (mod.rs:371);
// - `ItemCtxt` (collect.rs:134, which implements `HirTyLowerer`): fields, statics and its inherent methods (collect.rs,
//   collect/clauses_of.rs);
// - `Fns_<module>`: the free fns of every module with their final signatures (checked against the stub modules by
//   contract.test.ts);
// - comment-only declarations of the remaining fns: `impl HirTyLowerer for ItemCtxt` (`HirTyLowerer_ItemCtxt`), methods
//   of single-file helper types (visitors, folders, `BoundVarContext`, ...), trait impls and nested fns. The owning lane
//   decides their exact form.
// Grouped by upstream file in upstream order; every declaration carries `// <file>:<line>` (the line of its `fn` keyword
// at the pin, relative to compiler/rustc_hir_analysis/src/).
//
// Contract rules (docs/handoff/hirtylowerer-contract.md "How to fill a stub"):
// - Ownership: lane hirtylowerer-contract wrote this file; afterwards root owns it. A lane that needs a missing or
//   changed declaration writes it in its handoff (signature + reason); if it cannot type-check without it, it may add a
//   local `declare module "<path>/decls.ts"` augmentation in its own file marked `// PORT(decls): pending root`.
// - Signatures (PORTING §5, as rustc_ast_lowering/decls.ts): `&self`/`&mut self`/`self` -> `this`; `&T`/`&mut T`/`&'tcx T`
//   -> `T`; `&[T]`/`&'tcx [T]` -> `readonly T[]`; `Vec`/`ThinVec`/`SmallVec`/`&mut Vec` (out-parameters) -> `T[]`;
//   `Option<T>` -> `T | undefined`; `()` -> `void`, `Result<(), E>` -> `Result<undefined, E>`; tuples -> arrays;
//   `FxIndexSet<T>` / `FxIndexMap<K, V>` -> `Set` / `Map` for primitive or interned keys, `DefIdMap` for `DefId` keys,
//   `KeyedSet` / `KeyedMap` (rust_ts/keyed.ts) for composite keys (tuples, `BoundRegionKind`, `ResolvedArg`);
//   `impl Iterator<Item = T>` / `impl IntoIterator` -> `Iterable<T>` (an `impl Iterator + Clone` parameter is iterated
//   more than once: pass an array); closures `impl Fn(A) -> R` -> `(_1: A) => R`; a destructuring parameter
//   (`&hir::PolyTraitRef { .. }`, `(a, b): (A, B)`) is `_0`; generic fns over `T: TypeFoldable` take the D4 descriptor
//   `d_T` last (ty-contract). `ty::X` is rustc_middle's / rustc_type_ir's `X`; `hir::X` is `hir.X` (rustc_hir/lib.ts);
//   `GenericArgsRef<'tcx>` is `GenericArgs` (a `List<GenericArg>`).
// - `&dyn HirTyLowerer<'tcx>` is the class `HirTyLowerer`. An implementor coerces to it with `lowerer()` (upstream's
//   implicit unsizing coercion, e.g. `placeholder_type_error_diag(self, ..)` in an `ItemCtxt` method, is
//   `placeholder_type_error_diag(this.lowerer(), ..)`). A static call of a trait method on a concrete `ItemCtxt`
//   (`self.tcx()`, `icx.probe_ty_param_bounds(..)`) calls the impl: `HirTyLowerer_ItemCtxt.tcx.call(this)`.
// - Associated fns without `self` are `declare static` members of the class (`ItemCtxt.new`, `.new_internal`,
//   `.new_for_delegation`), assigned by collect.ts.
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types and must never import a
// rustc_hir_analysis module at runtime. Extension modules (collect.ts, collect/clauses_of.ts, hir_ty_lowering/{mod,
// bounds, dyn_trait, errors}.ts) import the classes from here and assign onto their prototypes; lib.ts (the crate root)
// loads every module.

import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { LitKind, TraitObjectSyntax } from "../rustc_ast/lib.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { Diag, DiagCtxtHandle } from "../rustc_errors/lib.ts";
import type { CtorOf, DefKind, Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { ObjectLifetimeDefault, ResolveBoundVars, ResolvedArg } from "../rustc_middle/middle/resolve_bound_vars.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { DynCompatibilityViolation } from "../rustc_middle/traits/mod.ts";
import type { AdtDef, AdtKind } from "../rustc_middle/ty/adt.ts";
import type { AssocItem, AssocTag } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Const, LayoutError, Region, TyAndLayout } from "../rustc_middle/ty/decls.ts";
import type { GenericArg, GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { ConstConditions, GenericClauses, GenericParamDef, GenericParamDefKind, Generics } from "../rustc_middle/ty/generics.ts";
import type { Clauses, List } from "../rustc_middle/ty/list.ts";
import type { DefiningScopeKind, DefinitionSiteHiddenType, ImplTraitHeader, ParamEnv, Ty, VariantDef, VariantDiscr } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import type { TraitDef } from "../rustc_middle/ty/trait_def.ts";
import type { DefIdMap, DefId, LocalDefId, LocalModId, ModId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import type {
  AliasConstKind,
  AliasTy,
  AnonConstKind,
  Binder,
  BoundRegionKind,
  BoundVariableKind,
  EarlyBinder,
  ImplPolarity,
  PatternKind,
  PolyExistentialPredicate,
  PolyFnSig,
  PolyProjectionClause,
  PolyTraitClause,
  PolyTraitRef,
  PolyTypeOutlivesClause,
  RegionOutlivesClause,
  TraitRef,
} from "../rustc_type_ir/decls.ts";
import type { Pending } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { AliasTerm } from "../rustc_type_ir/ty/alias.ts";
import type { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Result } from "../std/result.ts";
import type { ParamDefaultPolicy } from "./collect/generics_of.gen.ts";
import type { CollectedBound, CollectedSizednessBounds } from "./hir_ty_lowering/bounds.gen.ts";
import type { GenericsArgsErrExtend } from "./hir_ty_lowering/errors.gen.ts";
import type {
  AssocItemQSelf,
  ExplicitLateBound,
  ForbidParamContext,
  GenericArgCountResult,
  GenericArgPosition,
  GenericPathSegment,
  ImpliedBoundsContext,
  InherentAssocCandidate,
  IsMethodCall,
  LowerTypeRelativePathMode,
  OverlappingAsssocItemConstraints,
  PermitVariants,
  PredicateFilter,
  RegionInferReason,
  ResolvedStructPath,
  TypeRelativePath,
} from "./hir_ty_lowering/mod.gen.ts";

// ---- pending types (crates / files not ported yet); root replaces each with a re-export when it lands ----
/** rustc_infer infer/mod.rs `InferCtxt<'tcx>` (lane infcx-contract; re-exported by merge-w16a). */
import type { InferCtxt } from "../rustc_infer/decls.ts";
export type { InferCtxt };
/** rustc_infer infer/solver_region_constraints.rs `SolverRegionConstraint<'tcx>` (`ItemCtxt::lower_test_binder_constraint`; re-exported by merge-w16a). */
import type { SolverRegionConstraint } from "../rustc_infer/infer/solver_region_constraints.ts";
export type { SolverRegionConstraint };
/** rustc_trait_selection traits `FulfillmentError<'tcx>` (traits/mod.gen.ts). */
export type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
/** check/wfcheck.rs `TestBinderBody` / `TestBinderForall` / `TestBinderExists` (`#[rustc_test_binder]` lowering; generated). */
export type { TestBinderBody, TestBinderExists, TestBinderForall } from "./check/wfcheck.gen.ts";
import type { TestBinderBody, TestBinderExists, TestBinderForall } from "./check/wfcheck.gen.ts";
/**
 * rustc_middle middle/resolve_bound_vars.rs (ported by lane collect-rbv): `ResolvedArg`, `ObjectLifetimeDefault`,
 * `ResolveBoundVars<'tcx>`.
 */
// Type-only re-exports of the real types (lane collect-rbv; adopted by merge-w16a).
export type { ObjectLifetimeDefault, ResolveBoundVars, ResolvedArg };
/** rustc_middle ty/layout.rs `LayoutCx<'tcx>` (hir_ty_lowering/cmse.rs; lane layout-contract: the real type). */
import type { LayoutCx } from "../rustc_middle/ty/layout.ts";
export type { LayoutCx };

// ==== hir_ty_lowering/mod.rs:138 `pub trait HirTyLowerer<'tcx>` ====

/**
 * hir_ty_lowering/mod.rs:138 `trait HirTyLowerer<'tcx>`: one `impl HirTyLowerer for X` block, as an object of `this`-typed methods.
 * It is the vtable of the trait object `HirTyLowerer` below: `HirTyLowerer_ItemCtxt: HirTyLowererImpl<ItemCtxt>` (collect.ts),
 * later `HirTyLowerer_FnCtxt` (rustc_hir_typeck). PORT: a separate object, not methods on the implementor, because the
 * implementors have fields of the same names (`ItemCtxt.tcx`, `ItemCtxt.item_def_id`, FnCtxt's `infcx`) and inherent methods
 * that differ from the `dyn` ones (`ItemCtxt::lower_ty`, `FnCtxt::lower_ty` -> `LoweredTy`).
 */
export interface HirTyLowererImpl<S> {
  // hir_ty_lowering/mod.rs:139
  tcx(this: S): TyCtxt;
  // hir_ty_lowering/mod.rs:141
  dcx(this: S): DiagCtxtHandle;
  // hir_ty_lowering/mod.rs:144
  item_def_id(this: S): LocalDefId;
  // hir_ty_lowering/mod.rs:147
  mod_id(this: S): LocalModId;
  // hir_ty_lowering/mod.rs:150
  re_infer(this: S, span: Span, reason: RegionInferReason): Region;
  // hir_ty_lowering/mod.rs:153
  ty_infer(this: S, param: GenericParamDef | undefined, span: Span): Ty;
  // hir_ty_lowering/mod.rs:156
  ct_infer(this: S, param: GenericParamDef | undefined, span: Span): Const;
  // hir_ty_lowering/mod.rs:158
  register_trait_ascription_bounds(this: S, bounds: [Clause, Span][], hir_id: HirId, span: Span): void;
  // hir_ty_lowering/mod.rs:179
  probe_ty_param_bounds(this: S, span: Span, def_id: LocalDefId, assoc_ident: Ident): EarlyBinder<readonly [Clause, Span][]>;
  // hir_ty_lowering/mod.rs:186
  select_inherent_assoc_candidates(this: S, span: Span, self_ty: Ty, candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], FulfillmentError[]];
  // hir_ty_lowering/mod.rs:205
  lower_assoc_item_path(this: S, span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:213
  lower_fn_sig(this: S, decl: hir.FnDecl, generics: hir.Generics | undefined, hir_id: HirId, hir_ty: hir.Ty | undefined): [Ty[], Ty];
  // hir_ty_lowering/mod.rs:227
  probe_adt(this: S, span: Span, ty: Ty): AdtDef | undefined;
  // hir_ty_lowering/mod.rs:230
  record_ty(this: S, hir_id: HirId, ty: Ty, span: Span): void;
  // hir_ty_lowering/mod.rs:233
  infcx(this: S): InferCtxt | undefined;
  // hir_ty_lowering/mod.rs:239
  // lowerer(): HirTyLowerer;  (provided, `where Self: Sized`: no vtable slot; `HirTyLowerer_provided.lowerer`, mod.ts)
  // hir_ty_lowering/mod.rs:248
  dyn_compatibility_violations(this: S, trait_def_id: DefId): DynCompatibilityViolation[];
}

/**
 * `&dyn HirTyLowerer<'tcx>` (hir_ty_lowering/mod.rs:138): the trait object, a data pointer and its vtable. Made by the provided
 * method `lowerer()` (`HirTyLowerer_provided.lowerer`). The trait's required methods dispatch through the vtable (below, the only
 * code in this file); the `impl dyn HirTyLowerer` methods of mod.rs, bounds.rs, dyn_trait.rs and errors.rs are declared in the
 * interface after the class and assigned onto `HirTyLowerer.prototype` by those files.
 */
export class HirTyLowerer {
  constructor(
    readonly data: unknown,
    readonly vtable: HirTyLowererImpl<unknown>,
  ) {}

  // ---- the trait's required methods (dispatch; not ports: the `// rustc:` markers sit on each impl's methods) ----
  tcx(): TyCtxt {
    return this.vtable.tcx.call(this.data);
  }
  dcx(): DiagCtxtHandle {
    return this.vtable.dcx.call(this.data);
  }
  item_def_id(): LocalDefId {
    return this.vtable.item_def_id.call(this.data);
  }
  mod_id(): LocalModId {
    return this.vtable.mod_id.call(this.data);
  }
  re_infer(span: Span, reason: RegionInferReason): Region {
    return this.vtable.re_infer.call(this.data, span, reason);
  }
  ty_infer(param: GenericParamDef | undefined, span: Span): Ty {
    return this.vtable.ty_infer.call(this.data, param, span);
  }
  ct_infer(param: GenericParamDef | undefined, span: Span): Const {
    return this.vtable.ct_infer.call(this.data, param, span);
  }
  register_trait_ascription_bounds(bounds: [Clause, Span][], hir_id: HirId, span: Span): void {
    return this.vtable.register_trait_ascription_bounds.call(this.data, bounds, hir_id, span);
  }
  probe_ty_param_bounds(span: Span, def_id: LocalDefId, assoc_ident: Ident): EarlyBinder<readonly [Clause, Span][]> {
    return this.vtable.probe_ty_param_bounds.call(this.data, span, def_id, assoc_ident);
  }
  select_inherent_assoc_candidates(span: Span, self_ty: Ty, candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], FulfillmentError[]] {
    return this.vtable.select_inherent_assoc_candidates.call(this.data, span, self_ty, candidates);
  }
  lower_assoc_item_path(span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed> {
    return this.vtable.lower_assoc_item_path.call(this.data, span, item_def_id, item_segment, poly_trait_ref);
  }
  lower_fn_sig(decl: hir.FnDecl, generics: hir.Generics | undefined, hir_id: HirId, hir_ty: hir.Ty | undefined): [Ty[], Ty] {
    return this.vtable.lower_fn_sig.call(this.data, decl, generics, hir_id, hir_ty);
  }
  probe_adt(span: Span, ty: Ty): AdtDef | undefined {
    return this.vtable.probe_adt.call(this.data, span, ty);
  }
  record_ty(hir_id: HirId, ty: Ty, span: Span): void {
    return this.vtable.record_ty.call(this.data, hir_id, ty, span);
  }
  infcx(): InferCtxt | undefined {
    return this.vtable.infcx.call(this.data);
  }
  dyn_compatibility_violations(trait_def_id: DefId): DynCompatibilityViolation[] {
    return this.vtable.dyn_compatibility_violations.call(this.data, trait_def_id);
  }
}

export interface HirTyLowerer {
  // ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs, lines 1..2185 (lane hir-ty-lowering-a) ----
  // hir_ty_lowering/mod.rs:491
  check_param_res_if_mcg_for_instantiate_value_path(res: Res, span: Span): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:523
  anon_const_forbids_generic_params(): ForbidParamContext | undefined;
  // hir_ty_lowering/mod.rs:560
  check_param_uses_if_mcg<T>(term: T, span: Span, is_self_alias: boolean, d_T: TypeFoldable<T>): T;
  // hir_ty_lowering/mod.rs:580
  lower_lifetime(lifetime: hir.Lifetime, reason: RegionInferReason): Region;
  // hir_ty_lowering/mod.rs:595
  lower_resolved_lifetime(resolved: ResolvedArg): Region;
  // hir_ty_lowering/mod.rs:631
  lower_generic_args_of_path_segment(span: Span, def_id: DefId, item_segment: hir.PathSegment): GenericArgs;
  // hir_ty_lowering/mod.rs:679
  lower_generic_args_of_path(span: Span, def_id: DefId, parent_args: readonly GenericArg[], segment: hir.PathSegment, self_ty: Ty | undefined): [GenericArgs, GenericArgCountResult];
  // hir_ty_lowering/mod.rs:902
  lower_generic_args_of_assoc_item(span: Span, item_def_id: DefId, item_segment: hir.PathSegment, parent_args: GenericArgs): GenericArgs;
  // hir_ty_lowering/mod.rs:920
  lower_impl_trait_ref(trait_ref: hir.TraitRef, self_ty: Ty): TraitRef;
  // hir_ty_lowering/mod.rs:962
  lower_poly_trait_ref(_0: hir.PolyTraitRef, self_ty: Ty, bounds: [Clause, Span][], predicate_filter: PredicateFilter, overlapping_assoc_item_constraints: OverlappingAsssocItemConstraints): GenericArgCountResult;
  // hir_ty_lowering/mod.rs:1187
  lower_mono_trait_ref(span: Span, trait_def_id: DefId, self_ty: Ty, trait_segment: hir.PathSegment, is_impl: boolean): TraitRef;
  // hir_ty_lowering/mod.rs:1205
  probe_trait_that_defines_assoc_item(trait_def_id: DefId, assoc_tag: AssocTag, assoc_ident: Ident): boolean;
  // hir_ty_lowering/mod.rs:1217
  lower_path_segment(span: Span, def_id: DefId, item_segment: hir.PathSegment): Ty;
  // hir_ty_lowering/mod.rs:1247
  probe_single_ty_param_bound_for_assoc_item(ty_param_def_id: LocalDefId, ty_param_span: Span, assoc_tag: AssocTag, assoc_ident: Ident, span: Span): Result<PolyTraitRef, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1286
  collapse_candidates_to_subtrait_pick(matching_candidates: readonly PolyTraitRef[]): PolyTraitRef | undefined;
  // hir_ty_lowering/mod.rs:1351
  probe_single_bound_for_assoc_item(all_candidates: () => Iterable<PolyTraitRef>, qself: AssocItemQSelf, assoc_tag: AssocTag, assoc_ident: Ident, span: Span, constraint: hir.AssocItemConstraint | undefined): Result<PolyTraitRef, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1426
  lower_type_relative_ty_path(self_ty: Ty, hir_self_ty: hir.Ty, segment: hir.PathSegment, qpath_hir_id: HirId, span: Span, permit_variants: PermitVariants): Result<[Ty, DefKind, DefId], ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1468
  lower_type_relative_const_path(self_ty: Ty, hir_self_ty: hir.Ty, segment: hir.PathSegment, qpath_hir_id: HirId, span: Span): Result<Const, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1512
  lower_type_relative_path(self_ty: Ty, hir_self_ty: hir.Ty, segment: hir.PathSegment, qpath_hir_id: HirId, span: Span, mode: LowerTypeRelativePathMode): Result<TypeRelativePath, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1626
  resolve_type_relative_path(self_ty: Ty, hir_self_ty: hir.Ty, assoc_tag: AssocTag, segment: hir.PathSegment, qpath_hir_id: HirId, span: Span, variant_def_id: DefId | undefined): Result<[DefId, PolyTraitRef], ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1694
  probe_inherent_assoc_item(segment: hir.PathSegment, adt_did: DefId, self_ty: Ty, block: HirId, span: Span, assoc_tag: AssocTag): Result<AliasTerm | undefined, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1796
  probe_assoc_item(ident: Ident, assoc_tag: AssocTag, block: HirId, span: Span, scope: DefId): AssocItem | undefined;
  // hir_ty_lowering/mod.rs:1813
  probe_assoc_item_unchecked(ident: Ident, assoc_tag: AssocTag, scope: DefId): [AssocItem, ModId] | undefined;
  // hir_ty_lowering/mod.rs:1834
  check_assoc_item(item_def_id: DefId, ident: Ident, scope: ModId, block: HirId, span: Span): void;
  // hir_ty_lowering/mod.rs:1856
  probe_traits_that_match_assoc_ty(qself_ty: Ty, assoc_ident: Ident): string[];
  // hir_ty_lowering/mod.rs:1911
  lower_resolved_assoc_ty_path(span: Span, opt_self_ty: Ty | undefined, item_def_id: DefId, trait_segment: hir.PathSegment | undefined, item_segment: hir.PathSegment): Ty;
  // hir_ty_lowering/mod.rs:1936
  lower_resolved_assoc_const_path(span: Span, opt_self_ty: Ty | undefined, item_def_id: DefId, trait_segment: hir.PathSegment | undefined, item_segment: hir.PathSegment): Result<Const, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1961
  lower_resolved_assoc_item_path(span: Span, opt_self_ty: Ty | undefined, item_def_id: DefId, trait_segment: hir.PathSegment | undefined, item_segment: hir.PathSegment, assoc_tag: AssocTag): Result<[DefId, GenericArgs], ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:1995
  prohibit_generic_args(segments: Iterable<hir.PathSegment>, err_extend: GenericsArgsErrExtend): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:2037
  probe_generic_path_segments(segments: readonly hir.PathSegment[], self_ty: Ty | undefined, kind: DefKind, def_id: DefId, span: Span): GenericPathSegment[];

  // ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs, lines 2186..3915 (lane hir-ty-lowering-b) ----
  // hir_ty_lowering/mod.rs:2189
  lower_resolved_ty_path(opt_self_ty: Ty | undefined, path: hir.Path, hir_id: HirId, permit_variants: PermitVariants): Ty;
  // hir_ty_lowering/mod.rs:2337
  lower_ty_param(hir_id: HirId): Ty;
  // hir_ty_lowering/mod.rs:2364
  lower_const_param(param_def_id: DefId, path_hir_id: HirId): Const;
  // hir_ty_lowering/mod.rs:2390
  lower_const_arg(const_arg: hir.ConstArg, ty: Ty): Const;
  // hir_ty_lowering/mod.rs:2482
  lower_const_arg_array(array_expr: hir.ConstArgArrayExpr, ty: Ty): Const;
  // hir_ty_lowering/mod.rs:2515
  try_recover_misrepresented_function_call(hir_self_ty: hir.Ty, span: Span): ErrorGuaranteed | undefined;
  // hir_ty_lowering/mod.rs:2540
  lower_const_arg_tuple_call(hir_id: HirId, qpath: hir.QPath, args: readonly hir.ConstArg[], span: Span): Const;
  // hir_ty_lowering/mod.rs:2643
  lower_const_arg_tup(exprs: readonly hir.ConstArg[], ty: Ty, span: Span): Const;
  // hir_ty_lowering/mod.rs:2684
  lower_const_arg_struct(hir_id: HirId, qpath: hir.QPath, inits: readonly hir.ConstArgExprField[], span: Span): Const;
  // hir_ty_lowering/mod.rs:2827
  lower_path_for_struct_expr(qpath: hir.QPath, path_span: Span, hir_id: HirId): ResolvedStructPath;
  // hir_ty_lowering/mod.rs:2863
  lower_resolved_const_path(opt_self_ty: Ty | undefined, path: hir.Path, hir_id: HirId): Const;
  // hir_ty_lowering/mod.rs:3032
  lower_const_arg_anon(anon: hir.AnonConst): Const;
  // hir_ty_lowering/mod.rs:3058
  lower_const_arg_literal(kind: LitKind, neg: boolean, ty: Ty, span: Span): Const;
  // hir_ty_lowering/mod.rs:3083
  try_lower_anon_const_lit(ty: Ty, expr: hir.Expr): Const | undefined;
  // hir_ty_lowering/mod.rs:3124
  check_const_item_in_type_system(alias_const: AliasConstKind, span: Span): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:3174
  lower_delegation_ty(infer: hir.InferDelegation): Ty;
  // hir_ty_lowering/mod.rs:3192
  lower_ty(hir_ty: hir.Ty): Ty;
  // hir_ty_lowering/mod.rs:3446
  lower_pat_ty_pat(ty: Ty, ty_span: Span, pat: hir.TyPat): Result<PatternKind, ErrorGuaranteed>;
  // hir_ty_lowering/mod.rs:3480
  lower_field_of(ty: Ty, mod_id: LocalModId, ty_span: Span, hir_id: HirId, variant: Ident | undefined, field: Ident): Ty;
  // hir_ty_lowering/mod.rs:3631
  lower_opaque_ty(def_id: LocalDefId, in_trait: LocalDefId | undefined): Ty;
  // hir_ty_lowering/mod.rs:3682
  lower_fn_ty(hir_id: HirId, safety: hir.Safety, abi: ExternAbi, decl: hir.FnDecl, generics: hir.Generics | undefined, hir_ty: hir.Ty | undefined): PolyFnSig;
  // hir_ty_lowering/mod.rs:3747
  suggest_trait_fn_ty_for_impl_fn_infer(fn_hir_id: HirId, arg_idx: number | undefined): Ty | undefined;
  // hir_ty_lowering/mod.rs:3788
  validate_late_bound_regions(constrained_regions: KeyedSet<BoundRegionKind>, referenced_regions: KeyedSet<BoundRegionKind>, generate_err: (_1: string) => Diag): void;
  // hir_ty_lowering/mod.rs:3820
  construct_const_ctor_value(ctor_def_id: DefId, ctor_of: CtorOf, args: GenericArgs): Const;
  // hir_ty_lowering/mod.rs:3847
  lower_view(inner_ty: Ty, fields: readonly Ident[], ty_span: Span): Ty;

  // ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs (lane hir-ty-lowering-c) ----
  // hir_ty_lowering/bounds.rs:149
  add_implicit_sizedness_bounds(bounds: [Clause, Span][], self_ty: Ty, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, span: Span): void;
  // hir_ty_lowering/bounds.rs:211
  add_default_traits(bounds: [Clause, Span][], self_ty: Ty, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, span: Span): void;
  // hir_ty_lowering/bounds.rs:227
  add_default_trait(trait_: LangItem, bounds: [Clause, Span][], self_ty: Ty, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, span: Span): void;
  // hir_ty_lowering/bounds.rs:254
  should_add_default_traits(trait_def_id: DefId, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext): boolean;
  // hir_ty_lowering/bounds.rs:264
  require_bound_to_relax_default_trait(trait_ref: hir.TraitRef, span: Span): void;
  // hir_ty_lowering/bounds.rs:311
  lower_bounds(param_ty: Ty, hir_bounds: Iterable<hir.GenericBound>, bounds: [Clause, Span][], bound_vars: List<BoundVariableKind>, predicate_filter: PredicateFilter, overlapping_assoc_constraints: OverlappingAsssocItemConstraints): void;
  // hir_ty_lowering/bounds.rs:376
  lower_assoc_item_constraint(hir_ref_id: HirId, trait_ref: PolyTraitRef, constraint: hir.AssocItemConstraint, bounds: [Clause, Span][], duplicates: DefIdMap<Span> | undefined, path_span: Span, predicate_filter: PredicateFilter): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/bounds.rs:619
  lower_ty_maybe_return_type_notation(hir_ty: hir.Ty): Ty;
  // hir_ty_lowering/bounds.rs:748
  lower_return_type_notation_ty(candidate: PolyTraitRef, item_def_id: DefId, path_span: Span): Result<AliasTy, ErrorGuaranteed>;

  // ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs (lane hir-ty-lowering-c) ----
  // hir_ty_lowering/dyn_trait.rs:34
  lower_trait_object_ty(span: Span, hir_id: hir.HirId, hir_bounds: readonly hir.PolyTraitRef[], lifetime: hir.Lifetime, syntax: TraitObjectSyntax): Ty;
  // hir_ty_lowering/dyn_trait.rs:447
  lower_trait_object_lifetime(lifetime: hir.Lifetime, predicates: List<PolyExistentialPredicate>, span: Span): Region;
  // hir_ty_lowering/dyn_trait.rs:475
  check_elaborated_projection_mentions_input_lifetimes(pred: PolyProjectionClause, span: Span, supertrait_span: Span): void;
  // hir_ty_lowering/dyn_trait.rs:528
  compute_object_lifetime_bound(span: Span, existential_predicates: List<PolyExistentialPredicate>): Region | undefined;
  // hir_ty_lowering/dyn_trait.rs:566
  prohibit_or_lint_bare_trait_object_ty(span: Span, hir_id: hir.HirId, hir_bounds: readonly hir.PolyTraitRef[]): ErrorGuaranteed | undefined;
  // hir_ty_lowering/dyn_trait.rs:679
  maybe_suggest_add_generic_impl_trait(span: Span, hir_id: hir.HirId, diag: Diag): boolean;
  // hir_ty_lowering/dyn_trait.rs:739
  maybe_suggest_blanket_trait_impl(span: Span, hir_id: hir.HirId, diag: Diag): void;
  // hir_ty_lowering/dyn_trait.rs:793
  maybe_suggest_dyn_trait(hir_id: hir.HirId, span: Span, sugg: [Span, string][], diag: Diag): boolean;
  // hir_ty_lowering/dyn_trait.rs:849
  add_generic_param_suggestion(generics: hir.Generics, self_ty_span: Span, impl_trait_name: string): [Span, string][];
  // hir_ty_lowering/dyn_trait.rs:867
  maybe_suggest_impl_trait(span: Span, hir_id: hir.HirId, hir_bounds: readonly hir.PolyTraitRef[], diag: Diag): boolean;
  // hir_ty_lowering/dyn_trait.rs:1001
  maybe_suggest_assoc_ty_bound(hir_id: hir.HirId, diag: Diag): void;
  // hir_ty_lowering/dyn_trait.rs:1048
  maybe_suggest_typoed_method(hir_id: hir.HirId, trait_def_id: DefId | undefined, diag: Diag): void;

  // ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs (lane hir-ty-lowering-d) ----
  // hir_ty_lowering/errors.rs:37
  report_missing_generic_params(missing_generic_params: [Symbol, GenericParamDefKind][], def_id: DefId, span: Span, empty_generic_args: boolean): void;
  // hir_ty_lowering/errors.rs:59
  report_internal_fn_trait(span: Span, trait_def_id: DefId, trait_segment: hir.PathSegment, is_impl: boolean): void;
  // hir_ty_lowering/errors.rs:115
  report_unresolved_assoc_item(all_candidates: () => Iterable<PolyTraitRef>, qself: AssocItemQSelf, assoc_tag: AssocTag, assoc_ident: Ident, span: Span, constraint: hir.AssocItemConstraint | undefined): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:344
  report_assoc_kind_mismatch(assoc_item: AssocItem, assoc_tag: AssocTag, ident: Ident, span: Span, constraint: hir.AssocItemConstraint | undefined): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:432
  report_ambiguous_assoc_item(matching_candidates: readonly PolyTraitRef[], qself: AssocItemQSelf, assoc_tag: AssocTag, assoc_ident: Ident, span: Span, constraint: hir.AssocItemConstraint | undefined): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:563
  report_missing_self_ty_for_resolved_path(trait_def_id: DefId, span: Span, item_segment: hir.PathSegment, assoc_tag: AssocTag): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:614
  report_unresolved_type_relative_path(self_ty: Ty, hir_self_ty: hir.Ty, assoc_tag: AssocTag, ident: Ident, qpath_hir_id: HirId, span: Span, variant_def_id: DefId | undefined): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:728
  report_ambiguous_assoc_item_path(span: Span, types: readonly string[], traits: readonly string[], ident: Ident, assoc_tag: AssocTag): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:842
  report_ambiguous_inherent_assoc_item(name: Ident, candidates: DefId[], span: Span): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:860
  note_ambiguous_inherent_assoc_item(err: Diag, candidates: DefId[], span: Span): void;
  // hir_ty_lowering/errors.rs:903
  report_unresolved_inherent_assoc_item(name: Ident, self_ty: Ty, candidates: InherentAssocCandidate[], fulfillment_errors: FulfillmentError[], span: Span, assoc_tag: AssocTag): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:1080
  check_for_required_assoc_items(spans: Span[], missing_assoc_items: KeyedSet<[DefId, PolyTraitRef]>, potential_assoc_items: number[], trait_bounds: readonly hir.PolyTraitRef[]): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/errors.rs:1372
  maybe_report_similar_assoc_fn(span: Span, qself_ty: Ty, qself: hir.Ty): Result<undefined, ErrorGuaranteed>;
  // hir_ty_lowering/errors.rs:1424
  report_prohibited_generic_args(segments: Iterable<hir.PathSegment>, args_visitors: Iterable<hir.GenericArg>, err_extend: GenericsArgsErrExtend): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:1506
  report_trait_object_addition_traits(regular_traits: readonly [PolyTraitClause, Span[]][]): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:1549
  report_trait_object_with_no_traits(span: Span, user_written_clauses: Iterable<[Clause, Span]>): ErrorGuaranteed;
}

/**
 * hir_ty_lowering/mod.rs:371 `trait GenericArgsLowerer<'a, 'tcx>`: lowers HIR generic args for `generics::lower_generic_args`
 * (`&mut impl GenericArgsLowerer`). Implementors: `GenericArgsCtxt` (a struct local to `lower_generic_args_of_path`, mod.rs:725),
 * rustc_hir_typeck's `CtorGenericArgsCtxt` / method confirm's.
 */
export interface GenericArgsLowerer {
  // hir_ty_lowering/mod.rs:376
  args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean];
  // hir_ty_lowering/mod.rs:378
  provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg;
  // hir_ty_lowering/mod.rs:385
  inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg;
}

// ==== collect.rs:134 `pub(crate) struct ItemCtxt<'tcx>` ====

// rustc-type: compiler/rustc_hir_analysis/src/collect.rs:134 ItemCtxt
/// Context specific to some particular item. This is what implements [`HirTyLowerer`].
// PORT: `ItemCtxt::new_internal` (collect.rs:252, lane collect-a) writes out the initial field values. Its
// `impl HirTyLowerer` is the vtable object `HirTyLowerer_ItemCtxt` (collect.ts), not methods of this class: the trait's
// `tcx()` / `item_def_id()` share their names with the fields below.
export class ItemCtxt {
  constructor(
    public tcx: TyCtxt,
    public item_def_id: LocalDefId,
    /** PORT: `Cell<Option<ErrorGuaranteed>>` is a `MutRef` cell: `dcx()` hands it to `DiagCtxtHandle::into_taintable` by reference. */
    public tainted_by_errors: MutRef<ErrorGuaranteed | undefined>,
    public lowering_delegation_segment: boolean,
  ) {}

  // collect.rs:248 (assigned in collect.ts)
  declare static new: (tcx: TyCtxt, item_def_id: LocalDefId) => ItemCtxt;
  // collect.rs:252 (assigned in collect.ts)
  declare static new_internal: (tcx: TyCtxt, item_def_id: LocalDefId, delegation: boolean) => ItemCtxt;
  // collect.rs:265 (assigned in collect.ts)
  declare static new_for_delegation: (tcx: TyCtxt, item_def_id: LocalDefId) => ItemCtxt;
}

export interface ItemCtxt {
  // ---- compiler/rustc_hir_analysis/src/collect.rs (lane collect-a) ----
  // collect.rs:248 (static: `declare static` in the class above)
  // new(tcx: TyCtxt, item_def_id: LocalDefId): ItemCtxt;
  // collect.rs:252 (static: `declare static` in the class above)
  // new_internal(tcx: TyCtxt, item_def_id: LocalDefId, delegation: boolean): ItemCtxt;
  // collect.rs:265 (static: `declare static` in the class above)
  // new_for_delegation(tcx: TyCtxt, item_def_id: LocalDefId): ItemCtxt;
  // collect.rs:269
  lower_ty(hir_ty: hir.Ty): Ty;
  // collect.rs:273
  hir_id(): hir.HirId;
  // collect.rs:277
  node(): hir.Node;
  // collect.rs:281
  check_tainted_by_errors(): Result<undefined, ErrorGuaranteed>;
  // collect.rs:288
  report_placeholder_type_error(placeholder_types: Span[], infer_replacements: [Span, string][]): ErrorGuaranteed;
  // collect.rs:327
  lower_test_binder_body(item: hir.TestBinderBody): TestBinderBody;
  // collect.rs:344
  lower_test_binder_forall(forall: hir.TestBinderForall): TestBinderForall;
  // collect.rs:365
  lower_test_binder_exists(exists: hir.TestBinderExists): TestBinderExists;
  // collect.rs:375
  lower_test_binder_assumptions(predicate: hir.WherePredicate, type_outlives: PolyTypeOutlivesClause[], region_outlives: RegionOutlivesClause[]): void;
  // collect.rs:424
  lower_test_binder_constraint(constraint: hir.TestBinderConstraint): SolverRegionConstraint;
  // hir_ty_lowering/mod.rs:239 (provided `HirTyLowerer::lowerer`; collect.ts assigns it: `HirTyLowerer_provided.lowerer(this, HirTyLowerer_ItemCtxt)`)
  lowerer(): HirTyLowerer;

  // ---- compiler/rustc_hir_analysis/src/collect/clauses_of.rs (lane collect-b) ----
  // collect/clauses_of.rs:982
  probe_ty_param_bounds_in_generics(hir_generics: hir.Generics, param_def_id: LocalDefId, filter: PredicateFilter): [Clause, Span][];
}

// ==== the free fns, per module ====

/** The free fns of compiler/rustc_hir_analysis/src/lib.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_lib {
  // lib.rs:97
  check_c_variadic_abi(tcx: TyCtxt, decl: hir.FnDecl, abi: ExternAbi, span: Span): void;
  // lib.rs:126
  provide(providers: Providers): void;
  // lib.rs:145
  check_crate(tcx: TyCtxt): void;
  // lib.rs:242
  lower_ty(tcx: TyCtxt, hir_ty: hir.Ty): Ty;
  // lib.rs:254
  lower_const_arg_for_rustdoc(tcx: TyCtxt, hir_ct: hir.ConstArg, ty: Ty): Const;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect {
  // collect.rs:65
  provide(providers: Providers): void;
  // collect.rs:161
  placeholder_type_error_diag(cx: HirTyLowerer, generics: hir.Generics | undefined, placeholder_types: Span[], additional_spans: Span[], suggest: boolean, hir_ty: hir.Ty | undefined, kind: string): Diag;
  // collect.rs:236
  bad_placeholder(cx: HirTyLowerer, spans: Span[], kind: string): Diag;
  // collect.rs:766
  get_new_lifetime_name(tcx: TyCtxt, poly_trait_ref: PolyTraitRef, generics: hir.Generics): string;
  // collect.rs:796
  check_ctor(tcx: TyCtxt, def_id: LocalDefId): void;
  // collect.rs:802
  check_enum_variant_types(tcx: TyCtxt, def_id: LocalDefId): void;
  // collect.rs:980
  lower_variant(tcx: TyCtxt, variant_did: LocalDefId | undefined, ident: Ident, discr: VariantDiscr, def: hir.VariantData, adt_kind: AdtKind, parent_did: LocalDefId): VariantDef;
  // collect.rs:1028
  adt_def(tcx: TyCtxt, def_id: LocalDefId): AdtDef;
  // collect.rs:1088
  trait_def(tcx: TyCtxt, def_id: LocalDefId): TraitDef;
  // collect.rs:1168
  fn_sig(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<PolyFnSig>;
  // collect.rs:1254
  lower_fn_sig_recovering_infer_ret_ty(icx: ItemCtxt, sig: hir.FnSig, generics: hir.Generics, def_id: LocalDefId): PolyFnSig;
  // collect.rs:1275
  late_param_regions_to_bound<T>(tcx: TyCtxt, scope: DefId, bound_vars: List<BoundVariableKind>, value: T, d_T: TypeFoldable<T>): Binder<T>;
  // collect.rs:1338
  recover_infer_ret_ty(icx: ItemCtxt, infer_ret_ty: hir.Ty, generics: hir.Generics, def_id: LocalDefId): PolyFnSig;
  // collect.rs:1429
  suggest_impl_trait(infcx: InferCtxt, param_env: ParamEnv, ret_ty: Ty): string | undefined;
  // collect.rs:1561
  impl_is_fully_generic_for_reflection(tcx: TyCtxt, def_id: LocalDefId): boolean;
  // collect.rs:1566
  impl_trait_header(tcx: TyCtxt, def_id: LocalDefId): ImplTraitHeader;
  // collect.rs:1587
  check_impl_constness(tcx: TyCtxt, constness: hir.Constness, hir_trait_ref: hir.TraitRef): void;
  // collect.rs:1629
  polarity_of_impl(of_trait: hir.TraitImplHeader): ImplPolarity;
  // collect.rs:1641
  early_bound_lifetimes_from_generics(tcx: TyCtxt, generics: hir.Generics): Iterable<hir.GenericParam>;
  // collect.rs:1651
  compute_sig_of_foreign_fn_decl(tcx: TyCtxt, def_id: LocalDefId, decl: hir.FnDecl, abi: ExternAbi, safety: hir.Safety): PolyFnSig;
  // collect.rs:1687
  coroutine_kind(tcx: TyCtxt, def_id: LocalDefId): hir.CoroutineKind | undefined;
  // collect.rs:1701
  coroutine_for_closure(tcx: TyCtxt, def_id: LocalDefId): DefId;
  // collect.rs:1724
  opaque_ty_origin(tcx: TyCtxt, def_id: LocalDefId): hir.OpaqueTyOrigin<DefId>;
  // collect.rs:1738
  rendered_precise_capturing_args(tcx: TyCtxt, def_id: LocalDefId): readonly hir.PreciseCapturingArgKind<Symbol, Symbol>[] | undefined;
  // collect.rs:1761
  const_param_default(tcx: TyCtxt, param_def_id: LocalDefId): EarlyBinder<Const>;
  // collect.rs:1787
  anon_const_kind(tcx: TyCtxt, def: LocalDefId): AnonConstKind;
  // collect.rs:1818
  const_of_item(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<Const> | undefined;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/generics_of.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_generics_of {
  // collect/generics_of.rs:17
  generics_of(tcx: TyCtxt, def_id: LocalDefId): Generics;
  // collect/generics_of.rs:412
  param_default_policy(node: hir.Node): ParamDefaultPolicy | undefined;
  // collect/generics_of.rs:446
  has_late_bound_regions(tcx: TyCtxt, node: hir.Node): Span | undefined;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/type_of.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_type_of {
  // collect/type_of.rs:21
  type_of(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<Ty>;
  // collect/type_of.rs:290
  type_of_opaque(tcx: TyCtxt, def_id: DefId): EarlyBinder<Ty>;
  // collect/type_of.rs:333
  type_of_opaque_hir_typeck(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<Ty>;
  // collect/type_of.rs:369
  anon_const_type_of(icx: ItemCtxt, def_id: LocalDefId): Ty;
  // collect/type_of.rs:412
  const_arg_anon_type_of(icx: ItemCtxt, arg_hir_id: HirId, span: Span): Ty;
  // collect/type_of.rs:448
  infer_placeholder_type(cx: HirTyLowerer, def_id: LocalDefId, hir_body_id: HirId | undefined, ty_span: Span, body_span: Span, item_ident: Ident, kind: string): Ty;
  // collect/type_of.rs:557
  check_feature_inherent_assoc_ty(tcx: TyCtxt, span: Span): void;
  // collect/type_of.rs:571
  type_alias_is_checked(tcx: TyCtxt, def_id: LocalDefId): boolean;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_type_of_opaque {
  // collect/type_of/opaque.rs:15
  find_opaque_ty_constraints_for_impl_trait_in_assoc_type(tcx: TyCtxt, def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty>;
  // collect/type_of/opaque.rs:75
  find_opaque_ty_constraints_for_tait(tcx: TyCtxt, def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty>;
  // collect/type_of/opaque.rs:237
  find_opaque_ty_constraints_for_rpit(tcx: TyCtxt, def_id: LocalDefId, owner_def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty>;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/clauses_of.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_clauses_of {
  // collect/clauses_of.rs:28
  clauses_of(tcx: TyCtxt, def_id: DefId): GenericClauses;
  // collect/clauses_of.rs:82
  gather_explicit_clauses_of(tcx: TyCtxt, def_id: LocalDefId): GenericClauses;
  // collect/clauses_of.rs:318
  where_predicate_clauses(icx: ItemCtxt, predicate: hir.WherePredicate, clauses: KeyedSet<[Clause, Span]>): void;
  // collect/clauses_of.rs:384
  compute_bidirectional_outlives_clauses(tcx: TyCtxt, opaque_own_params: readonly GenericParamDef[], clauses: [Clause, Span][]): void;
  // collect/clauses_of.rs:412
  const_evaluatable_clauses_of(tcx: TyCtxt, def_id: LocalDefId, clauses: KeyedSet<[Clause, Span]>): KeyedSet<[Clause, Span]>;
  // collect/clauses_of.rs:497
  trait_explicit_clauses_and_bounds(tcx: TyCtxt, def_id: LocalDefId): GenericClauses;
  // collect/clauses_of.rs:505
  explicit_clauses_of(tcx: TyCtxt, def_id: LocalDefId): GenericClauses;
  // collect/clauses_of.rs:618
  explicit_super_clauses_of(tcx: TyCtxt, trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]>;
  // collect/clauses_of.rs:625
  explicit_supertraits_containing_assoc_item(tcx: TyCtxt, _0: [DefId, Ident]): EarlyBinder<readonly [Clause, Span][]>;
  // collect/clauses_of.rs:636
  explicit_implied_clauses_of(tcx: TyCtxt, trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]>;
  // collect/clauses_of.rs:654
  implied_clauses_with_filter(tcx: TyCtxt, trait_def_id: DefId, filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]>;
  // collect/clauses_of.rs:756
  assert_only_contains_clauses_from(filter: PredicateFilter, bounds: readonly [Clause, Span][], ty: Ty): void;
  // collect/clauses_of.rs:891
  type_param_clauses(tcx: TyCtxt, _0: [LocalDefId, LocalDefId, Ident]): EarlyBinder<readonly [Clause, Span][]>;
  // collect/clauses_of.rs:1053
  const_conditions(tcx: TyCtxt, def_id: LocalDefId): ConstConditions;
  // collect/clauses_of.rs:1175
  explicit_implied_const_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [PolyTraitRef, Span][]>;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/item_bounds.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_item_bounds {
  // collect/item_bounds.rs:25
  associated_type_bounds(tcx: TyCtxt, assoc_item_def_id: LocalDefId, hir_bounds: readonly hir.GenericBound[], span: Span, filter: PredicateFilter): readonly [Clause, Span][];
  // collect/item_bounds.rs:129
  remap_gat_vars_and_recurse_into_nested_projections(tcx: TyCtxt, filter: PredicateFilter, item_trait_ref: TraitRef, assoc_item_def_id: LocalDefId, span: Span, clause: Clause): [Clause, Span] | undefined;
  // collect/item_bounds.rs:359
  opaque_type_bounds(tcx: TyCtxt, opaque_def_id: LocalDefId, hir_bounds: readonly hir.GenericBound[], item_ty: Ty, span: Span, filter: PredicateFilter): readonly [Clause, Span][];
  // collect/item_bounds.rs:408
  explicit_item_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]>;
  // collect/item_bounds.rs:415
  explicit_item_self_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]>;
  // collect/item_bounds.rs:422
  explicit_item_bounds_with_filter(tcx: TyCtxt, def_id: LocalDefId, filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]>;
  // collect/item_bounds.rs:493
  item_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses>;
  // collect/item_bounds.rs:499
  item_self_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses>;
  // collect/item_bounds.rs:512
  item_non_self_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses>;
  // collect/item_bounds.rs:530
  impl_super_outlives(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses>;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_resolve_bound_vars {
  // collect/resolve_bound_vars.rs:234
  provide(providers: Providers): void;
  // collect/resolve_bound_vars.rs:257
  resolve_bound_vars(tcx: TyCtxt, local_def_id: hir.OwnerId): ResolveBoundVars;
  // collect/resolve_bound_vars.rs:291
  late_arg_as_bound_arg(param: hir.GenericParam): BoundVariableKind;
  // collect/resolve_bound_vars.rs:305
  generic_param_def_as_bound_arg(param: GenericParamDef): BoundVariableKind;
  // collect/resolve_bound_vars.rs:322
  opaque_captures_all_in_scope_lifetimes(opaque: hir.OpaqueTy): boolean;
  // collect/resolve_bound_vars.rs:1181
  object_lifetime_default(tcx: TyCtxt, param_def_id: LocalDefId): ObjectLifetimeDefault;
  // collect/resolve_bound_vars.rs:2587
  is_late_bound_map(tcx: TyCtxt, owner_id: hir.OwnerId): Set<hir.ItemLocalId> | undefined;
  // collect/resolve_bound_vars.rs:2807
  deny_non_region_late_bound(tcx: TyCtxt, bound_vars: Map<LocalDefId, ResolvedArg>, where_: string): void;
}

/** The free fns of compiler/rustc_hir_analysis/src/collect/dump.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_collect_dump {
  // collect/dump.rs:11
  generics(tcx: TyCtxt): void;
  // collect/dump.rs:30
  object_lifetime_defaults(tcx: TyCtxt): void;
  // collect/dump.rs:54
  opaque_hidden_types(tcx: TyCtxt): void;
  // collect/dump.rs:74
  clauses_and_item_bounds(tcx: TyCtxt): void;
  // collect/dump.rs:118
  def_parents(tcx: TyCtxt): void;
  // collect/dump.rs:164
  vtables(tcx: TyCtxt): void;
}

/** The free fns of compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_hir_ty_lowering_bounds {
  // hir_ty_lowering/bounds.rs:61
  search_bounds_for(hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, f: (_1: hir.PolyTraitRef) => void): void;
  // hir_ty_lowering/bounds.rs:88
  collect_bounds(hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, target_did: DefId): CollectedBound;
  // hir_ty_lowering/bounds.rs:108
  collect_sizedness_bounds(tcx: TyCtxt, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, span: Span): CollectedSizednessBounds;
  // hir_ty_lowering/bounds.rs:127
  add_trait_bound(tcx: TyCtxt, bounds: [Clause, Span][], self_ty: Ty, did: DefId, span: Span): void;
  // hir_ty_lowering/bounds.rs:834
  check_assoc_const_binding_type(cx: HirTyLowerer, assoc_const: Ident, ty: Binder<Ty>, hir_id: hir.HirId): Ty;
}

/** The free fns of compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_hir_ty_lowering_generics {
  // hir_ty_lowering/generics.rs:29
  generic_arg_mismatch_err(cx: HirTyLowerer, arg: hir.GenericArg, param: GenericParamDef, possible_ordering_error: boolean, help: string | undefined): ErrorGuaranteed;
  // hir_ty_lowering/generics.rs:190
  lower_generic_args(cx: HirTyLowerer, def_id: DefId, parent_args: readonly GenericArg[], has_self: boolean, self_ty: Ty | undefined, arg_count: GenericArgCountResult, ctx: GenericArgsLowerer): GenericArgs;
  // hir_ty_lowering/generics.rs:405
  check_generic_arg_count_for_value_path(cx: HirTyLowerer, def_id: DefId, generics: Generics, seg: hir.PathSegment, is_method_call: IsMethodCall): GenericArgCountResult;
  // hir_ty_lowering/generics.rs:419
  check_generic_arg_count(cx: HirTyLowerer, def_id: DefId, seg: hir.PathSegment, gen_params: Generics, gen_pos: GenericArgPosition, has_self: boolean): GenericArgCountResult;
  // hir_ty_lowering/generics.rs:662
  prohibit_explicit_late_bound_lifetimes(cx: HirTyLowerer, def: Generics, args: hir.GenericArgs, position: GenericArgPosition): ExplicitLateBound;
}

/** The free fns of compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_hir_ty_lowering_dyn_trait {
  // hir_ty_lowering/dyn_trait.rs:1098
  replace_dummy_self_with_error<T>(tcx: TyCtxt, t: T, guar: ErrorGuaranteed, d_T: TypeFoldable<T>): T;
}

/** The free fns of compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_hir_ty_lowering_errors {
  // hir_ty_lowering/errors.rs:1566
  prohibit_assoc_item_constraint(cx: HirTyLowerer, constraint: hir.AssocItemConstraint, segment: [DefId, hir.PathSegment, Span] | undefined): ErrorGuaranteed;
  // hir_ty_lowering/errors.rs:1744
  fn_trait_to_string(tcx: TyCtxt, trait_segment: hir.PathSegment, parenthesized: boolean): string;
  // hir_ty_lowering/errors.rs:1812
  generics_args_err_extend(tcx: TyCtxt, segments: Iterable<hir.PathSegment>, err: Diag, err_extend: GenericsArgsErrExtend): void;
  // hir_ty_lowering/errors.rs:2071
  assoc_tag_str(assoc_tag: AssocTag): string;
  // hir_ty_lowering/errors.rs:2083
  eq_ctxt_suggestion_span(pat: Span, ty: Span): Span | undefined;
}

/** The free fns of compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs (checked against the module's exports by contract.test.ts). */
export interface Fns_hir_ty_lowering_cmse {
  // hir_ty_lowering/cmse.rs:13
  validate_cmse_abi(tcx: TyCtxt, dcx: DiagCtxtHandle, hir_id: HirId, abi: ExternAbi, fn_sig: PolyFnSig): void;
  // hir_ty_lowering/cmse.rs:73
  is_valid_cmse_inputs(tcx: TyCtxt, dcx: DiagCtxtHandle, fn_sig: PolyFnSig, fn_decl: hir.FnDecl, abi: ExternAbi): Result<undefined, [Span, LayoutError]>;
  // hir_ty_lowering/cmse.rs:119
  is_valid_cmse_output(tcx: TyCtxt, dcx: DiagCtxtHandle, fn_sig: PolyFnSig, fn_decl: hir.FnDecl, abi: ExternAbi): Result<undefined, LayoutError>;
  // hir_ty_lowering/cmse.rs:162
  is_valid_cmse_output_layout(cx: LayoutCx, layout: TyAndLayout): boolean;
  // hir_ty_lowering/cmse.rs:178
  should_emit_layout_error(abi: ExternAbi, layout_err: LayoutError): boolean;
}
// ==== comment-only declarations (helper types, trait impls, nested fns; the owning lane decides their form) ====

// ---- compiler/rustc_hir_analysis/src/collect.rs ----
// collect.rs:152 (HirPlaceholderCollector(Visitor))
// visit_infer(_inf_id: HirId, inf_span: Span, kind: InferKind): Result;
// collect.rs:381 (nested fn)
// outlives_bounds(dcx: DiagCtxtHandle, bounds: hir.GenericBounds): Iterable<hir.Lifetime>;
// collect.rs:481 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// tcx(this: ItemCtxt): TyCtxt;
// collect.rs:485 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// dcx(this: ItemCtxt): DiagCtxtHandle;
// collect.rs:489 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// item_def_id(this: ItemCtxt): LocalDefId;
// collect.rs:493 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// mod_id(this: ItemCtxt): LocalModId;
// collect.rs:497 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// re_infer(this: ItemCtxt, span: Span, reason: RegionInferReason): Region;
// collect.rs:529 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// ty_infer(this: ItemCtxt, _1: GenericParamDef | undefined, span: Span): Ty;
// collect.rs:536 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// ct_infer(this: ItemCtxt, _1: GenericParamDef | undefined, span: Span): Const;
// collect.rs:541 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// register_trait_ascription_bounds(this: ItemCtxt, _1: [Clause, Span][], _2: HirId, span: Span): void;
// collect.rs:550 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// probe_ty_param_bounds(this: ItemCtxt, span: Span, def_id: LocalDefId, assoc_ident: Ident): EarlyBinder<readonly [Clause, Span][]>;
// collect.rs:560 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// select_inherent_assoc_candidates(this: ItemCtxt, _span: Span, self_ty: Ty, candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], FulfillmentError[]];
// collect.rs:611 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// lower_assoc_item_path(this: ItemCtxt, span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed>;
// collect.rs:698 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// probe_adt(this: ItemCtxt, _span: Span, ty: Ty): AdtDef | undefined;
// collect.rs:703 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// record_ty(this: ItemCtxt, _hir_id: hir.HirId, _ty: Ty, _span: Span): void;
// collect.rs:707 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// infcx(this: ItemCtxt): InferCtxt | undefined;
// collect.rs:711 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// lower_fn_sig(this: ItemCtxt, decl: hir.FnDecl, _generics: hir.Generics | undefined, hir_id: hir.HirId, _hir_ty: hir.Ty | undefined): [Ty[], Ty];
// collect.rs:760 (HirTyLowerer for ItemCtxt: `HirTyLowerer_ItemCtxt` (collect.ts))
// dyn_compatibility_violations(this: ItemCtxt, trait_def_id: DefId): DynCompatibilityViolation[];
// collect.rs:808 (ReprCIssue(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// collect.rs:896 (NestedSpan)
// to_field_already_declared_nested_help(): FieldAlreadyDeclaredNestedHelp;
// collect.rs:908 (FieldDeclSpan(From), static)
// from(span: Span): Self;
// collect.rs:914 (FieldDeclSpan(From), static)
// from(span: NestedSpan): Self;
// collect.rs:925 (FieldUniquenessCheckContext, static)
// new(tcx: TyCtxt): Self;
// collect.rs:930 (FieldUniquenessCheckContext)
// check_field_decl(field_name: Ident, field_decl: FieldDeclSpan): void;
// ---- compiler/rustc_hir_analysis/src/collect/generics_of.rs ----
// collect/generics_of.rs:25 (GenericParametersForbiddenHere(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// collect/generics_of.rs:454 (LateBoundRegionsDetector(Visitor))
// visit_ty(ty: hir.Ty<hir.AmbigArg>): ControlFlow<Span>;
// collect/generics_of.rs:472 (LateBoundRegionsDetector(Visitor))
// visit_poly_trait_ref(tr: hir.PolyTraitRef): ControlFlow<Span>;
// collect/generics_of.rs:479 (LateBoundRegionsDetector(Visitor))
// visit_lifetime(lt: hir.Lifetime): ControlFlow<Span>;
// collect/generics_of.rs:499 (nested fn)
// has_late_bound_regions(tcx: TyCtxt, generics: hir.Generics, decl: hir.FnDecl): Span | undefined;
// collect/generics_of.rs:528 (AnonConstInParamTyDetector(Visitor))
// visit_generic_param(p: hir.GenericParam): Result;
// collect/generics_of.rs:540 (AnonConstInParamTyDetector(Visitor))
// visit_anon_const(c: hir.AnonConst): Result;
// ---- compiler/rustc_hir_analysis/src/collect/type_of.rs ----
// collect/type_of.rs:579 (HasTait(Visitor))
// visit_ty(t: hir.Ty<hir.AmbigArg>): Result;
// ---- compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs ----
// collect/type_of/opaque.rs:118 (TaitConstraintLocator)
// insert_found(hidden_ty: DefinitionSiteHiddenType): void;
// collect/type_of/opaque.rs:130 (TaitConstraintLocator)
// non_defining_use_in_defining_scope(item_def_id: LocalDefId): void;
// collect/type_of/opaque.rs:140 (TaitConstraintLocator)
// check(item_def_id: LocalDefId): void;
// collect/type_of/opaque.rs:208 (TaitConstraintLocator(Visitor))
// maybe_tcx(): MaybeTyCtxt;
// collect/type_of/opaque.rs:211 (TaitConstraintLocator(Visitor))
// visit_expr(ex: hir.Expr): void;
// collect/type_of/opaque.rs:214 (TaitConstraintLocator(Visitor))
// visit_item(it: hir.Item): void;
// collect/type_of/opaque.rs:219 (TaitConstraintLocator(Visitor))
// visit_impl_item(it: hir.ImplItem): void;
// collect/type_of/opaque.rs:224 (TaitConstraintLocator(Visitor))
// visit_trait_item(it: hir.TraitItem): void;
// collect/type_of/opaque.rs:229 (TaitConstraintLocator(Visitor))
// visit_foreign_item(it: hir.ForeignItem): void;
// ---- compiler/rustc_hir_analysis/src/collect/clauses_of.rs ----
// collect/clauses_of.rs:422 (nested fn)
// is_const_param_default(tcx: TyCtxt, kind: AliasConstKind): boolean;
// collect/clauses_of.rs:439 (ConstCollector(TypeVisitor))
// visit_const(c: Const): void;
// ---- compiler/rustc_hir_analysis/src/collect/item_bounds.rs ----
// collect/item_bounds.rs:256 (MapAndCompressBoundVars(TypeFolder))
// cx(): TyCtxt;
// collect/item_bounds.rs:260 (MapAndCompressBoundVars(TypeFolder))
// fold_binder<T>(t: Binder<T>, d_T: TypeFoldable<T>): Binder<T>;
// collect/item_bounds.rs:270 (MapAndCompressBoundVars(TypeFolder))
// fold_ty(ty: Ty): Ty;
// collect/item_bounds.rs:300 (MapAndCompressBoundVars(TypeFolder))
// fold_region(re: Region): Region;
// collect/item_bounds.rs:324 (MapAndCompressBoundVars(TypeFolder))
// fold_const(ct: Const): Const;
// collect/item_bounds.rs:349 (MapAndCompressBoundVars(TypeFolder))
// fold_predicate<P>(p: P): P;
// collect/item_bounds.rs:551 (AssocTyToOpaque(TypeFolder))
// cx(): TyCtxt;
// collect/item_bounds.rs:555 (AssocTyToOpaque(TypeFolder))
// fold_ty(ty: Ty): Ty;
// ---- compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs ----
// collect/resolve_bound_vars.rs:37 (ResolvedArg, static)
// early(param: hir.GenericParam): ResolvedArg;
// collect/resolve_bound_vars.rs:41 (ResolvedArg, static)
// late(idx: number, param: hir.GenericParam): ResolvedArg;
// collect/resolve_bound_vars.rs:45 (ResolvedArg)
// id(): LocalDefId | undefined;
// collect/resolve_bound_vars.rs:55 (ResolvedArg)
// shifted(amount: number): ResolvedArg;
// collect/resolve_bound_vars.rs:173 (Scope)
// debug_truncated(): /* impl fmt::Debug */ string;
// collect/resolve_bound_vars.rs:335 (BoundVarContext)
// poly_trait_ref_binder_info(): [BoundVariableKind[], BinderScopeType];
// collect/resolve_bound_vars.rs:381 (BoundVarContext)
// visit_poly_trait_ref_inner(trait_ref: hir.PolyTraitRef, non_lifetime_binder_allowed: NonLifetimeBinderAllowed): void;
// collect/resolve_bound_vars.rs:433 (BoundVarContext(Visitor))
// maybe_tcx(): MaybeTyCtxt;
// collect/resolve_bound_vars.rs:437 (BoundVarContext(Visitor))
// visit_nested_body(body: hir.BodyId): void;
// collect/resolve_bound_vars.rs:444 (BoundVarContext(Visitor))
// visit_expr(e: hir.Expr): void;
// collect/resolve_bound_vars.rs:450 (nested fn)
// span_of_infer(ty: hir.Ty): Span | undefined;
// collect/resolve_bound_vars.rs:457 (FindInferInClosureWithBinder(Visitor))
// visit_infer(_inf_id: HirId, inf_span: Span, _kind: InferKind): Result;
// collect/resolve_bound_vars.rs:527 (BoundVarContext(Visitor))
// visit_opaque_ty(opaque: hir.OpaqueTy): void;
// collect/resolve_bound_vars.rs:621 (BoundVarContext(Visitor))
// visit_item(item: hir.Item): void;
// collect/resolve_bound_vars.rs:659 (BoundVarContext(Visitor))
// visit_precise_capturing_arg(arg: hir.PreciseCapturingArg): Result;
// collect/resolve_bound_vars.rs:701 (BoundVarContext(Visitor))
// visit_foreign_item(item: hir.ForeignItem): void;
// collect/resolve_bound_vars.rs:718 (BoundVarContext(Visitor))
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// collect/resolve_bound_vars.rs:839 (BoundVarContext(Visitor))
// visit_pattern_type_pattern(p: hir.TyPat): void;
// collect/resolve_bound_vars.rs:844 (BoundVarContext(Visitor))
// visit_trait_item(trait_item: hir.TraitItem): void;
// collect/resolve_bound_vars.rs:870 (BoundVarContext(Visitor))
// visit_impl_item(impl_item: hir.ImplItem): void;
// collect/resolve_bound_vars.rs:887 (BoundVarContext(Visitor))
// visit_lifetime(lifetime_ref: hir.Lifetime): void;
// collect/resolve_bound_vars.rs:904 (BoundVarContext(Visitor))
// visit_qpath(qpath: hir.QPath, id: HirId, _3: Span): void;
// collect/resolve_bound_vars.rs:948 (BoundVarContext(Visitor))
// visit_path(path: hir.Path, hir_id: HirId): void;
// collect/resolve_bound_vars.rs:959 (BoundVarContext(Visitor))
// visit_fn(fk: FnKind, fd: hir.FnDecl, body_id: hir.BodyId, _4: Span, def_id: LocalDefId): void;
// collect/resolve_bound_vars.rs:984 (BoundVarContext(Visitor))
// visit_generics(generics: hir.Generics): void;
// collect/resolve_bound_vars.rs:992 (BoundVarContext(Visitor))
// visit_where_predicate(predicate: hir.WherePredicate): void;
// collect/resolve_bound_vars.rs:1047 (BoundVarContext(Visitor))
// visit_poly_trait_ref(trait_ref: hir.PolyTraitRef): void;
// collect/resolve_bound_vars.rs:1051 (BoundVarContext(Visitor))
// visit_anon_const(c: hir.AnonConst): void;
// collect/resolve_bound_vars.rs:1060 (BoundVarContext(Visitor))
// visit_generic_param(p: hir.GenericParam): void;
// collect/resolve_bound_vars.rs:1087 (BoundVarContext(Visitor))
// visit_test_binder_forall(forall: hir.TestBinderForall): Result;
// collect/resolve_bound_vars.rs:1121 (BoundVarContext(Visitor))
// visit_test_binder_exists(exists: hir.TestBinderExists): Result;
// collect/resolve_bound_vars.rs:1152 (BoundVarContext(Visitor))
// visit_test_binder_bound_type_constraint(bound_type: hir.TestBinderBoundTypeConstraint): Result;
// collect/resolve_bound_vars.rs:1236 (BoundVarContext)
// with(wrap_scope: Scope, f: (_1: BoundVarContext) => void): void;
// collect/resolve_bound_vars.rs:1257 (BoundVarContext)
// record_late_bound_vars(hir_id: HirId, binder: BoundVariableKind[]): void;
// collect/resolve_bound_vars.rs:1284 (BoundVarContext)
// visit_early_late(hir_id: HirId, generics: hir.Generics, walk: (_1: BoundVarContext) => void): void;
// collect/resolve_bound_vars.rs:1333 (BoundVarContext)
// visit_early(hir_id: HirId, generics: hir.Generics, walk: (_1: BoundVarContext) => void): void;
// collect/resolve_bound_vars.rs:1354 (BoundVarContext)
// resolve_lifetime_ref(region_def_id: LocalDefId, lifetime_ref: hir.Lifetime): void;
// collect/resolve_bound_vars.rs:1561 (BoundVarContext)
// check_lifetime_is_capturable(opaque_def_id: LocalDefId, lifetime: ResolvedArg, capture_span: Span): Result<undefined, ErrorGuaranteed>;
// collect/resolve_bound_vars.rs:1610 (BoundVarContext)
// emit_opaque_capture_errors(): ErrorGuaranteed | undefined;
// collect/resolve_bound_vars.rs:1634 (BoundVarContext)
// remap_opaque_captures(opaque_capture_scopes: readonly [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][], lifetime: ResolvedArg, ident: Ident): ResolvedArg;
// collect/resolve_bound_vars.rs:1671 (BoundVarContext)
// resolve_type_ref(param_def_id: LocalDefId, hir_id: HirId): void;
// collect/resolve_bound_vars.rs:1807 (BoundVarContext)
// visit_path_segment_args(generic_args: hir.GenericArgs, seg_idx: SegIdx, path: hir.Path): void;
// collect/resolve_bound_vars.rs:1999 (BoundVarContext)
// eligible_container(path: hir.Path, seg_idx: SegIdx): [DefId, readonly hir.PathSegment[]] | undefined;
// collect/resolve_bound_vars.rs:2094 (BoundVarContext)
// compute_object_lifetime_defaults(generics: Generics, segments: readonly hir.PathSegment[]): (ResolvedArg | undefined)[];
// collect/resolve_bound_vars.rs:2131 (nested fn)
// resolve_param(param_def_id: DefId, generics: Generics, tcx: TyCtxt): [RevSegIdx, ArgIdx];
// collect/resolve_bound_vars.rs:2205 (BoundVarContext, static)
// supertrait_hrtb_vars(tcx: TyCtxt, def_id: DefId, assoc_ident: Ident, assoc_tag: AssocTag): [BoundVariableKind[], AssocItem] | undefined;
// collect/resolve_bound_vars.rs:2264 (BoundVarContext)
// visit_fn_like_elision(inputs: readonly hir.Ty[], output: hir.Ty | undefined, in_closure: boolean): void;
// collect/resolve_bound_vars.rs:2290 (BoundVarContext)
// resolve_object_lifetime_default(lifetime_ref: hir.Lifetime): void;
// collect/resolve_bound_vars.rs:2332 (BoundVarContext)
// insert_lifetime(lifetime_ref: hir.Lifetime, def: ResolvedArg): void;
// collect/resolve_bound_vars.rs:2355 (BoundVarContext)
// try_append_return_type_notation_params(hir_id: HirId, hir_ty: hir.Ty): void;
// collect/resolve_bound_vars.rs:2499 (BoundVarContext)
// for_each_trait_bound_on_res(expected_res: Res): Iterable<DefId>;
// collect/resolve_bound_vars.rs:2679 (ConstrainedCollectorPostHirTyLowering(TypeVisitor))
// visit_ty(t: Ty): void;
// collect/resolve_bound_vars.rs:2693 (ConstrainedCollectorPostHirTyLowering(TypeVisitor))
// visit_const(_1: Const): void;
// collect/resolve_bound_vars.rs:2695 (ConstrainedCollectorPostHirTyLowering(TypeVisitor))
// visit_region(r: Region): void;
// collect/resolve_bound_vars.rs:2709 (ConstrainedCollector(Visitor))
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// collect/resolve_bound_vars.rs:2779 (ConstrainedCollector(Visitor))
// visit_lifetime(lifetime_ref: hir.Lifetime): void;
// collect/resolve_bound_vars.rs:2792 (AllCollector(Visitor))
// visit_lifetime(lifetime_ref: hir.Lifetime): void;
// collect/resolve_bound_vars.rs:2798 (AllCollector(Visitor))
// visit_opaque_ty(opaque: hir.OpaqueTy): void;
// collect/resolve_bound_vars.rs:2842 (SegIdx)
// reverse(segments: readonly hir.PathSegment[]): RevSegIdx;
// collect/resolve_bound_vars.rs:2855 (RevSegIdx)
// reverse(segments: readonly hir.PathSegment[]): SegIdx;
// ---- compiler/rustc_hir_analysis/src/collect/dump.rs ----
// collect/dump.rs:130 (AnonConstFinder(Visitor))
// maybe_tcx(): MaybeTyCtxt;
// collect/dump.rs:134 (AnonConstFinder(Visitor))
// visit_anon_const(c: hir.AnonConst): void;
// ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs ----
// hir_ty_lowering/mod.rs:261 (AssocItemQSelf)
// to_string(tcx: TyCtxt): string;
// hir_ty_lowering/mod.rs:277 (LowerTypeRelativePathMode)
// assoc_tag(): AssocTag;
// hir_ty_lowering/mod.rs:285 (LowerTypeRelativePathMode)
// def_kind_for_diagnostics(): DefKind;
// hir_ty_lowering/mod.rs:292 (LowerTypeRelativePathMode)
// permit_variants(): PermitVariants;
// hir_ty_lowering/mod.rs:410 (ForbidParamUsesFolder)
// error(): ErrorGuaranteed;
// hir_ty_lowering/mod.rs:461 (ForbidParamUsesFolder(TypeFolder))
// cx(): TyCtxt;
// hir_ty_lowering/mod.rs:465 (ForbidParamUsesFolder(TypeFolder))
// fold_ty(t: Ty): Ty;
// hir_ty_lowering/mod.rs:472 (ForbidParamUsesFolder(TypeFolder))
// fold_const(c: Const): Const;
// hir_ty_lowering/mod.rs:479 (ForbidParamUsesFolder(TypeFolder))
// fold_region(r: Region): Region;
// hir_ty_lowering/mod.rs:736 (GenericArgsCtxt(GenericArgsLowerer))
// args_for_def_id(did: DefId): [hir.GenericArgs | undefined, boolean];
// hir_ty_lowering/mod.rs:745 (GenericArgsCtxt(GenericArgsLowerer))
// provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg;
// hir_ty_lowering/mod.rs:810 (GenericArgsCtxt(GenericArgsLowerer))
// inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg;
// ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs ----
// hir_ty_lowering/bounds.rs:38 (CollectedBound)
// any(): boolean;
// hir_ty_lowering/bounds.rs:56 (CollectedSizednessBounds)
// any(): boolean;
// hir_ty_lowering/bounds.rs:916 (GenericParamAndBoundVarCollector(TypeVisitor))
// visit_binder<T>(binder: Binder<T>, d_T: TypeVisitable<T>): ControlFlow<ErrorGuaranteed>;
// hir_ty_lowering/bounds.rs:926 (GenericParamAndBoundVarCollector(TypeVisitor))
// visit_ty(ty: Ty): Result;
// hir_ty_lowering/bounds.rs:949 (GenericParamAndBoundVarCollector(TypeVisitor))
// visit_region(re: Region): Result;
// hir_ty_lowering/bounds.rs:974 (GenericParamAndBoundVarCollector(TypeVisitor))
// visit_const(ct: Const): Result;
// ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs ----
// hir_ty_lowering/generics.rs:673 (LifetimeArgsIssue(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs ----
// hir_ty_lowering/dyn_trait.rs:580 (TraitObjectWithoutDyn(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// ---- compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs ----
// hir_ty_lowering/errors.rs:2031 (AmbiguityBetweenVariantAndAssocItem(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// ---- compiler/rustc_hir_analysis/src/diagnostics.rs ----
// diagnostics.rs:477 (MissingGenericParams(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// diagnostics.rs:2078 (UncoveredTyParam(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
