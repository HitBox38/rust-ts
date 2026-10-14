// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs (lane hir-ty-lowering-c).
//
// The `impl dyn HirTyLowerer` methods of this file are assigned onto `HirTyLowerer.prototype` (decls.ts) in upstream order.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { HirTyLowerer } from "../decls.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { type Diag, E0582, struct_span_code_err } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericParamDefKind, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses, List } from "../../rustc_middle/ty/list.ts";
import { fold_Term, type Term, Ty } from "../../rustc_middle/ty/mod.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { type Clause, Clause_upcast_from_Binder_ClauseKind, Clause_upcast_from_PolyProjectionClause, Clause_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, type DefIdMap, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Ident, display_Symbol, type Ident, kw } from "../../rustc_span/symbol.ts";
import { Binder, debug_BoundRegionKind, EarlyBinder, fold_Binder, visit_Binder } from "../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import type { AliasTy, BoundVariableKind, ClauseKind, DebruijnIndex, FnSig, PolyTraitRef, ProjectionClause } from "../../rustc_type_ir/decls.ts";
import { supertraits } from "../../rustc_type_ir/elaborate.ts";
import { BoundVar, DebruijnIndex as DebruijnIndexC, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { debug_BoundVar } from "../../rustc_type_ir/lib.gen.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { relate_AliasTerm, relate_AliasTy } from "../../rustc_type_ir/relate.ts";
import { Const as ConstC, Region as RegionC } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { display_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { AliasTerm as AliasTermT } from "../../rustc_type_ir/ty/alias.ts";
import type { AliasTermKind } from "../../rustc_type_ir/term_kind.gen.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import {
  AssociatedItemTraitUninferredGenericParams_diagnostic,
  EscapingBoundVarInTyOfAssocConstBinding_diagnostic,
  ParamInTyOfAssocConstBinding_diagnostic,
  ReturnTypeNotationEqualityBound_diagnostic,
  ReturnTypeNotationIllegalParam_diagnostic,
  ReturnTypeNotationOnNonRpitit_diagnostic,
  type TyOfAssocConstBindingNote,
  ValueOfAssociatedStructAlreadySpecified_diagnostic,
} from "../diagnostics.gen.ts";
import { CollectedBound, CollectedSizednessBounds } from "./bounds.gen.ts";
import { GenericsArgsErrExtend } from "./errors.ts";
import type { AssocItemQSelf, ImpliedBoundsContext, OverlappingAsssocItemConstraints, PredicateFilter, RegionInferReason } from "./mod.gen.ts";

export * from "./bounds.gen.ts";

/** PORT: D4 descriptor of the generated `TypeFoldable` impl of `TraitRef`. */
const d_TraitRef = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** `#[derive(Default)]` of `CollectedBound`. */
function default_CollectedBound(): CollectedBound {
  return new CollectedBound(undefined, undefined, undefined);
}

declare module "./bounds.gen.ts" {
  interface CollectedBound {
    any(): boolean;
  }
  interface CollectedSizednessBounds {
    any(): boolean;
  }
}

/// Returns `true` if any of `Trait`, `?Trait` or `!Trait` were encountered.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:38 any
CollectedBound.prototype.any = function (this: CollectedBound): boolean {
  return this.positive !== undefined || this.maybe !== undefined || this.negative !== undefined;
};

/// Returns `true` if any of `Trait`, `?Trait` or `!Trait` were encountered for `Sized`,
/// `MetaSized` or `PointeeSized`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:56 any
CollectedSizednessBounds.prototype.any = function (this: CollectedSizednessBounds): boolean {
  return this.sized.any() || this.meta_sized.any() || this.pointee_sized.any();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:61 search_bounds_for
export function search_bounds_for(hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, f: (_1: hir.PolyTraitRef) => void): void {
  const search_bounds = (hir_bounds: readonly hir.GenericBound[]): void => {
    for (const hir_bound of hir_bounds) {
      if (hir_bound.$ !== "Trait") {
        continue;
      }
      const ptr = hir_bound._0;

      f(ptr);
    }
  };

  search_bounds(hir_bounds);
  if (context.$ === "TyParam") {
    const self_ty = context._0;
    const where_clause = context._1;
    for (const clause of where_clause) {
      if (clause.kind.$ === "BoundPredicate" && clause.kind._0.is_param_bound(LocalDefId.to_def_id(self_ty))) {
        const pred = clause.kind._0;
        search_bounds(pred.bounds);
      }
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:88 collect_bounds
export function collect_bounds(hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, target_did: DefId): CollectedBound {
  const collect_into = default_CollectedBound();
  search_bounds_for(hir_bounds, context, (ptr) => {
    const res = ptr.trait_ref.path.res;
    if (!(res.$ === "Def" && res._0.$ === "Trait" && DefId_eq(res._1, target_did))) {
      return;
    }

    switch (ptr.modifiers.polarity.$) {
      case "Maybe":
        collect_into.maybe = ptr.span;
        break;
      case "Negative":
        collect_into.negative = ptr.span;
        break;
      case "Positive":
        collect_into.positive = ptr.span;
        break;
    }
  });
  return collect_into;
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:108 collect_sizedness_bounds
export function collect_sizedness_bounds(tcx: TyCtxt, hir_bounds: readonly hir.GenericBound[], context: ImpliedBoundsContext, span: Span): CollectedSizednessBounds {
  const sized_did = tcx.require_lang_item("Sized", span);
  const sized = collect_bounds(hir_bounds, context, sized_did);

  const meta_sized_did = tcx.require_lang_item("MetaSized", span);
  const meta_sized = collect_bounds(hir_bounds, context, meta_sized_did);

  const pointee_sized_did = tcx.require_lang_item("PointeeSized", span);
  const pointee_sized = collect_bounds(hir_bounds, context, pointee_sized_did);

  return new CollectedSizednessBounds(sized, meta_sized, pointee_sized);
}

/// Add a trait bound for `did`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:127 add_trait_bound
export function add_trait_bound(tcx: TyCtxt, bounds: [Clause, Span][], self_ty: Ty, did: DefId, span: Span): void {
  const trait_ref = TraitRef.new(as_interner(tcx), did, [self_ty]);
  // Preferable to put sizedness obligations first, since we report better errors for `Sized`
  // ambiguity.
  bounds.splice(0, 0, [Clause_upcast_from_TraitRef(trait_ref, tcx), span]);
}

// ---- impl<'tcx> dyn HirTyLowerer<'tcx> + '_ (bounds.rs:140) ----

/// Adds sizedness bounds to a trait, trait alias, parameter, opaque type or associated type.
///
/// - On parameters, opaque type and associated types, add default `Sized` bound if no explicit
///   sizedness bounds are present.
/// - On traits and trait aliases, add default `MetaSized` supertrait if no explicit sizedness
///   bounds are present.
/// - On parameters, opaque type, associated types and trait aliases, add a `MetaSized` bound if
///   a `?Sized` bound is present.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:149 add_implicit_sizedness_bounds
HirTyLowerer.prototype.add_implicit_sizedness_bounds = function (
  this: HirTyLowerer,
  bounds: [Clause, Span][],
  self_ty: Ty,
  hir_bounds: readonly hir.GenericBound[],
  context: ImpliedBoundsContext,
  span: Span,
): void {
  const tcx = this.tcx();

  // Skip adding any default bounds if `#![rustc_no_implicit_bounds]`
  if (find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "RustcNoImplicitBounds" ? null : undefined)) !== undefined) {
    return;
  }

  const meta_sized_did = tcx.require_lang_item("MetaSized", span);
  const pointee_sized_did = tcx.require_lang_item("PointeeSized", span);

  // If adding sizedness bounds to a trait, then there are some relevant early exits
  switch (context.$) {
    case "TraitDef": {
      const trait_did = LocalDefId.to_def_id(context._0);
      // Never add a default supertrait to `PointeeSized`.
      if (DefId_eq(trait_did, pointee_sized_did)) {
        return;
      }
      // Don't add default sizedness supertraits to auto traits because it isn't possible to
      // relax an automatically added supertrait on the defn itself.
      if (tcx.trait_is_auto(trait_did)) {
        return;
      }
      break;
    }
    case "TyParam":
    case "AssociatedTypeOrImplTrait":
      break;
  }
  const collected = collect_sizedness_bounds(tcx, hir_bounds, context, span);
  const span_ = collected.sized.maybe ?? collected.sized.negative;
  if (span_ !== undefined && collected.sized.positive === undefined && !collected.meta_sized.any() && !collected.pointee_sized.any()) {
    // `?Sized` is equivalent to `MetaSized` (but only add the bound if there aren't any
    // other explicit ones) - this can happen for trait aliases as well as bounds.
    add_trait_bound(tcx, bounds, self_ty, meta_sized_did, span_);
  } else if (!collected.any()) {
    switch (context.$) {
      case "TraitDef":
        // If there are no explicit sizedness bounds on a trait then add a default
        // `MetaSized` supertrait.
        add_trait_bound(tcx, bounds, self_ty, meta_sized_did, span);
        break;
      case "TyParam":
      case "AssociatedTypeOrImplTrait": {
        // If there are no explicit sizedness bounds on a parameter then add a default
        // `Sized` bound.
        const sized_did = tcx.require_lang_item("Sized", span);
        add_trait_bound(tcx, bounds, self_ty, sized_did, span);
        break;
      }
    }
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:211 add_default_traits
HirTyLowerer.prototype.add_default_traits = function (
  this: HirTyLowerer,
  bounds: [Clause, Span][],
  self_ty: Ty,
  hir_bounds: readonly hir.GenericBound[],
  context: ImpliedBoundsContext,
  span: Span,
): void {
  for (const default_trait of this.tcx().default_traits()) {
    this.add_default_trait(default_trait, bounds, self_ty, hir_bounds, context, span);
  }
};

/// Add a `experimental_default_bounds` bound to the `bounds` if appropriate.
///
/// Doesn't add the bound if the HIR bounds contain any of `Trait`, `?Trait` or `!Trait`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:227 add_default_trait
HirTyLowerer.prototype.add_default_trait = function (
  this: HirTyLowerer,
  trait_: LangItem,
  bounds: [Clause, Span][],
  self_ty: Ty,
  hir_bounds: readonly hir.GenericBound[],
  context: ImpliedBoundsContext,
  span: Span,
): void {
  const tcx = this.tcx();

  // Supertraits for auto trait are unsound according to the unstable book:
  // https://doc.rust-lang.org/beta/unstable-book/language-features/auto-traits.html#supertraits
  if (context.$ === "TraitDef" && this.tcx().trait_is_auto(LocalDefId.to_def_id(context._0))) {
    return;
  }

  const trait_did = tcx.lang_items().get(trait_);
  if (trait_did !== undefined && this.should_add_default_traits(trait_did, hir_bounds, context)) {
    add_trait_bound(tcx, bounds, self_ty, trait_did, span);
  }
};

/// Returns `true` if default trait bound should be added.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:254 should_add_default_traits
HirTyLowerer.prototype.should_add_default_traits = function (
  this: HirTyLowerer,
  trait_def_id: DefId,
  hir_bounds: readonly hir.GenericBound[],
  context: ImpliedBoundsContext,
): boolean {
  const collected = collect_bounds(hir_bounds, context, trait_def_id);
  return find_attr(this.tcx().hir_krate_attrs(), (k) => (k.$ === "RustcNoImplicitBounds" ? null : undefined)) === undefined && !collected.any();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:264 require_bound_to_relax_default_trait
HirTyLowerer.prototype.require_bound_to_relax_default_trait = function (this: HirTyLowerer, trait_ref: hir.TraitRef, span: Span): void {
  const tcx = this.tcx();

  const res = trait_ref.path.res;
  if (res.$ === "Def" && res._0.$ === "Trait" && (tcx.is_lang_item(res._1, "Sized") || tcx.is_default_trait(res._1))) {
    return;
  }

  this.dcx().span_err(
    span,
    tcx.sess.opts.unstable_opts.experimental_default_bounds || tcx.features().more_maybe_bounds()
      ? "bound modifier `?` can only be applied to default traits"
      : "bound modifier `?` can only be applied to `Sized`",
  );
};

/// Lower HIR bounds into `bounds` given the self type `param_ty` and the overarching late-bound vars if any.
///
/// ### Examples
///
/// ```ignore (illustrative)
/// fn foo<T>() where for<'a> T: Trait<'a> + Copy {}
/// //                ^^^^^^^ ^  ^^^^^^^^^^^^^^^^ `hir_bounds`, in HIR form
/// //                |       |
/// //                |       `param_ty`, in ty form
/// //                `bound_vars`, in ty form
///
/// fn bar<T>() where T: for<'a> Trait<'a> + Copy {} // no overarching `bound_vars` here!
/// //                ^  ^^^^^^^^^^^^^^^^^^^^^^^^ `hir_bounds`, in HIR form
/// //                |
/// //                `param_ty`, in ty form
/// ```
///
/// ### A Note on Binders
///
/// There is an implied binder around `param_ty` and `hir_bounds`.
/// See `lower_poly_trait_ref` for more details.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:311 lower_bounds
HirTyLowerer.prototype.lower_bounds = function (
  this: HirTyLowerer,
  param_ty: Ty,
  hir_bounds: Iterable<hir.GenericBound>,
  bounds: [Clause, Span][],
  bound_vars: List<BoundVariableKind>,
  predicate_filter: PredicateFilter,
  overlapping_assoc_constraints: OverlappingAsssocItemConstraints,
): void {
  for (const hir_bound of hir_bounds) {
    // In order to avoid cycles, when we're lowering `SelfTraitThatDefines`,
    // we skip over any traits that don't define the given associated type.
    if (predicate_filter.$ === "SelfTraitThatDefines") {
      const assoc_ident = predicate_filter._0;
      const trait_ref = hir.GenericBound.trait_ref(hir_bound);
      const trait_did = trait_ref !== undefined ? trait_ref.trait_def_id() : undefined;
      if (trait_did !== undefined && this.tcx().trait_may_define_assoc_item(trait_did, assoc_ident)) {
        // Okay
      } else {
        continue;
      }
    }

    switch (hir_bound.$) {
      case "Trait": {
        const poly_trait_ref = hir_bound._0;
        this.lower_poly_trait_ref(poly_trait_ref, param_ty, bounds, predicate_filter, overlapping_assoc_constraints);
        break;
      }
      case "Outlives": {
        const lifetime = hir_bound._0;
        // `ConstIfConst` is only interested in `[const]` bounds.
        if (predicate_filter.$ === "ConstIfConst" || predicate_filter.$ === "SelfConstIfConst") {
          continue;
        }

        const region = this.lower_lifetime(lifetime, { $: "OutlivesBound" } satisfies RegionInferReason);
        const bound = Binder.bind_with_vars<ClauseKind>({ $: "TypeOutlives", _0: { _0: param_ty, _1: region } }, bound_vars);
        bounds.push([Clause_upcast_from_Binder_ClauseKind(bound, this.tcx()), lifetime.ident.span]);
        break;
      }
      case "Use":
        // We don't actually lower `use` into the type layer.
        break;
    }
  }
};

/// Lower an associated item constraint from the HIR into `bounds`.
///
/// ### A Note on Binders
///
/// Given something like `T: for<'a> Iterator<Item = &'a u32>`,
/// the `trait_ref` here will be `for<'a> T: Iterator`.
/// The `constraint` data however is from *inside* the binder
/// (e.g., `&'a u32`) and hence may reference bound regions.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:376 lower_assoc_item_constraint
HirTyLowerer.prototype.lower_assoc_item_constraint = function (
  this: HirTyLowerer,
  hir_ref_id: HirId,
  trait_ref: PolyTraitRef,
  constraint: hir.AssocItemConstraint,
  bounds: [Clause, Span][],
  duplicates: DefIdMap<Span> | undefined,
  path_span: Span,
  predicate_filter: PredicateFilter,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();

  let assoc_tag: "Fn" | "Const" | "Type";
  if (constraint.gen_args.parenthesized === "ReturnTypeNotation") {
    assoc_tag = "Fn";
  } else if (constraint.kind.$ === "Equality" && constraint.kind.term.$ === "Const") {
    assoc_tag = "Const";
  } else {
    assoc_tag = "Type";
  }

  // Given something like `U: Trait<T = X>`, we want to produce a predicate like
  // `<U as Trait>::T = X`.
  // This is somewhat subtle in the event that `T` is defined in a supertrait of `Trait`,
  // because in that case we need to upcast. I.e., we want to produce
  // `<B as SuperTrait<i32>>::T == X` for `B: SubTrait<T = X>` where
  //
  //     trait SubTrait: SuperTrait<i32> {}
  //     trait SuperTrait<A> { type T; }
  let candidate: PolyTraitRef;
  if (this.probe_trait_that_defines_assoc_item(Binder.skip_binder(trait_ref).def_id, assoc_tag, constraint.ident)) {
    // Simple case: The assoc item is defined in the current trait.
    candidate = trait_ref;
  } else {
    // Otherwise, we have to walk through the supertraits to find
    // one that does define it.
    const r = this.probe_single_bound_for_assoc_item(
      () => supertraits(tcx, trait_ref),
      { $: "Trait", _0: Binder.skip_binder(trait_ref).def_id } satisfies AssocItemQSelf,
      assoc_tag,
      constraint.ident,
      path_span,
      constraint,
    );
    if (r.$ === "Err") return r;
    candidate = r._0;
  }

  const assoc_item = unwrap(
    this.probe_assoc_item(constraint.ident, assoc_tag, hir_ref_id, constraint.span, Binder.skip_binder(candidate).def_id),
    "failed to find associated item",
  );

  if (duplicates !== undefined) {
    // `duplicates.entry(assoc_item.def_id).and_modify(|prev_span| ..).or_insert(constraint.span)`
    const prev_span = duplicates.get(assoc_item.def_id);
    if (prev_span !== undefined) {
      this.dcx().emit_err(
        ValueOfAssociatedStructAlreadySpecified_diagnostic({
          span: constraint.span,
          prev_span: prev_span,
          item_name: constraint.ident,
          def_path: tcx.def_path_str(AssocItem.container_id(assoc_item, tcx)),
        }),
      );
    } else {
      duplicates.set(assoc_item.def_id, constraint.span);
    }
  }

  let projection_term: Binder<AliasTermT>;
  if (assoc_tag === "Fn") {
    const bound_vars = tcx.late_bound_vars(constraint.hir_id);
    const r = this.lower_return_type_notation_ty(candidate, assoc_item.def_id, path_span);
    if (r.$ === "Err") return r;
    projection_term = Binder.bind_with_vars<AliasTermT>(AliasTerm.from_AliasTy(r._0), bound_vars);
  } else {
    // Create the generic arguments for the associated type or constant by joining the
    // parent arguments (the arguments of the trait) and the own arguments (the ones of
    // the associated item itself) and construct an alias type using them.
    projection_term = Binder.map_bound(candidate, (trait_ref) => {
      const item_segment = new hir.PathSegment(constraint.ident, constraint.hir_id, { $: "Err" }, constraint.gen_args, false, false);

      const alias_args = this.lower_generic_args_of_assoc_item(path_span, assoc_item.def_id, item_segment, trait_ref.args);
      // debug!(?alias_args);

      const kind: AliasTermKind =
        assoc_tag === "Const" ? { $: "ProjectionConst", def_id: assoc_item.def_id } : { $: "ProjectionTy", def_id: assoc_item.def_id };
      return AliasTerm.new_from_args(tcx, kind, alias_args);
    });
  }

  const ckind = constraint.kind;
  if (ckind.$ === "Equality" && assoc_tag === "Fn") {
    return Err(this.dcx().emit_err(ReturnTypeNotationEqualityBound_diagnostic({ span: constraint.span })));
  } else if (ckind.$ === "Equality") {
    // Lower an equality constraint like `Item = u32` as found in HIR bound `T: Iterator<Item = u32>`
    // to a projection predicate: `<T as Iterator>::Item = u32`.
    const hterm = ckind.term;
    let term: Term;
    switch (hterm.$) {
      case "Ty":
        term = this.lower_ty(hterm._0);
        break;
      case "Const": {
        const ct = hterm._0;
        const ty_ = Binder.map_bound(projection_term, (alias) => Unnormalized.skip_norm_wip(AliasConst.type_of(AliasTerm.expect_ct(alias), tcx)));
        const ty = check_assoc_const_binding_type(this, constraint.ident, ty_, constraint.hir_id);

        term = this.lower_const_arg(ct, ty);
        break;
      }
    }

    // Find any late-bound regions declared in `ty` that are not
    // declared in the trait-ref or assoc_item. These are not well-formed.
    //
    // Example:
    //
    //     for<'a> <T as Iterator>::Item = &'a str // <-- 'a is bad
    //     for<'a> <T as FnMut<(&'a u32,)>>::Output = &'a str // <-- 'a is ok
    const late_bound_in_projection_ty = tcx.collect_constrained_late_bound_regions(projection_term, relate_AliasTerm);
    const late_bound_in_term = tcx.collect_referenced_late_bound_regions(Binder.rebind(trait_ref, term), fold_Term);
    // debug!(?late_bound_in_projection_ty);
    // debug!(?late_bound_in_term);

    // FIXME: point at the type params that don't have appropriate lifetimes:
    // struct S1<F: for<'a> Fn(&i32, &i32) -> &'a i32>(F);
    //                         ----  ----     ^^^^^^^
    // NOTE(mgca): This error should be impossible to trigger with assoc const bindings.
    this.validate_late_bound_regions(late_bound_in_projection_ty, late_bound_in_term, (br_name: string): Diag => {
      return struct_span_code_err(
        this.dcx(),
        constraint.span,
        E0582,
        `binding for associated type \`${display_Ident(constraint.ident)}\` references ${br_name}, \
which does not appear in the trait input types`,
      );
    });

    switch (predicate_filter.$) {
      case "All":
      case "SelfOnly":
      case "SelfAndAssociatedTypeBounds": {
        const bound = Binder.map_bound(projection_term, (projection_term): ProjectionClause => ({
          projection_term,
          term,
        }));

        if (assoc_tag === "Const" && !this.tcx().is_direct_const(assoc_item.def_id) && !tcx.features().gca_const_items()) {
          if (tcx.features().gca_min_const_items()) {
            const err = this.dcx().struct_span_err(constraint.span, "use of trait associated const not defined as `#[rustc_always_gca]`");
            return Err(err.emit_err());
          } else {
            const err = this.dcx().span_delayed_bug(constraint.span, "use of trait associated const defined as `#[rustc_always_gca]`");
            return Err(err);
          }
        }

        bounds.push([Clause_upcast_from_PolyProjectionClause(bound, tcx), constraint.span]);
        break;
      }
      // SelfTraitThatDefines is only interested in trait predicates.
      case "SelfTraitThatDefines":
        break;
      // `ConstIfConst` is only interested in `[const]` bounds.
      case "ConstIfConst":
      case "SelfConstIfConst":
        break;
    }
  } else {
    // Lower a constraint like `Item: Debug` as found in HIR bound `T: Iterator<Item: Debug>`
    // to a bound involving a projection: `<T as Iterator>::Item: Debug`.
    const hir_bounds = ckind.bounds;
    switch (predicate_filter.$) {
      case "All":
      case "SelfAndAssociatedTypeBounds":
      case "ConstIfConst": {
        const projection_ty = Binder.map_bound(projection_term, (projection_term) => AliasTerm.expect_ty(projection_term));
        // Calling `skip_binder` is okay, because `lower_bounds` expects the `param_ty`
        // parameter to have a skipped binder.
        const param_ty = Ty.new_alias(tcx, "No", Binder.skip_binder(projection_ty));
        this.lower_bounds(param_ty, hir_bounds, bounds, Binder.bound_vars(projection_ty), predicate_filter, "Allowed");
        break;
      }
      case "SelfOnly":
      case "SelfTraitThatDefines":
      case "SelfConstIfConst":
        break;
    }
  }
  return Ok(undefined);
};

/// Lower a type, possibly specially handling the type if it's a return type notation
/// which we otherwise deny in other positions.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:619 lower_ty_maybe_return_type_notation
HirTyLowerer.prototype.lower_ty_maybe_return_type_notation = function (this: HirTyLowerer, hir_ty: hir.Ty): Ty {
  if (hir_ty.kind.$ !== "Path") {
    return this.lower_ty(hir_ty);
  }
  const qpath = hir_ty.kind._0;

  const tcx = this.tcx();
  let item_segment: hir.PathSegment | undefined;
  let segment: hir.PathSegment | undefined;
  if (
    qpath.$ === "Resolved" &&
    qpath._1.segments.length >= 2 &&
    (item_segment = qpath._1.segments[qpath._1.segments.length - 1]!).args !== undefined &&
    item_segment.args!.parenthesized === "ReturnTypeNotation"
  ) {
    const opt_self_ty = qpath._0;
    const path = qpath._1;
    const mod_segments = path.segments.slice(0, path.segments.length - 2);
    const trait_segment = path.segments[path.segments.length - 2]!;
    // We don't allow generics on the module segments.
    this.prohibit_generic_args(mod_segments, GenericsArgsErrExtend.None);

    let item_def_id: DefId;
    const res = path.res;
    if (res.$ === "Def" && res._0.$ === "AssocFn") {
      item_def_id = res._1;
    } else if (res.$ === "Err") {
      return Ty.new_error_with_message(tcx, MultiSpan.from_span(hir_ty.span), "failed to resolve RTN");
    } else {
      return bug("only expected method resolution for fully qualified RTN");
    }
    const trait_def_id = tcx.parent(item_def_id);

    // Good error for `where Trait::method(..): Send`.
    if (opt_self_ty === undefined) {
      const guar = this.report_missing_self_ty_for_resolved_path(trait_def_id, hir_ty.span, item_segment, "Type");
      return Ty.new_error(tcx, guar);
    }
    const self_ty = this.lower_ty(opt_self_ty);

    const trait_ref = this.lower_mono_trait_ref(hir_ty.span, trait_def_id, self_ty, trait_segment, false);

    // SUBTLE: As noted at the end of `try_append_return_type_notation_params`
    // in `resolve_bound_vars`, we stash the explicit bound vars of the where
    // clause onto the item segment of the RTN type. This allows us to know
    // how many bound vars are *not* coming from the signature of the function
    // from lowering RTN itself.
    //
    // For example, in `where for<'a> <T as Trait<'a>>::method(..): Other`,
    // the `late_bound_vars` of the where clause predicate (i.e. this HIR ty's
    // parent) will include `'a` AND all the early- and late-bound vars of the
    // method. But when lowering the RTN type, we just want the list of vars
    // we used to resolve the trait ref. We explicitly stored those back onto
    // the item segment, since there's no other good place to put them.
    const candidate = Binder.bind_with_vars(trait_ref, tcx.late_bound_vars(item_segment.hir_id));

    const r = this.lower_return_type_notation_ty(candidate, item_def_id, hir_ty.span);
    switch (r.$) {
      case "Ok":
        return Ty.new_alias(tcx, "No", r._0);
      case "Err":
        return Ty.new_error(tcx, r._0);
    }
  } else if (
    qpath.$ === "TypeRelative" &&
    (segment = qpath._1).args !== undefined &&
    segment.args!.parenthesized === "ReturnTypeNotation"
  ) {
    const hir_self_ty = qpath._0;
    const self_ty = this.lower_ty(hir_self_ty);
    const r = this.resolve_type_relative_path(self_ty, hir_self_ty, "Fn", segment, hir_ty.hir_id, hir_ty.span, undefined);
    if (r.$ === "Err") return Ty.new_error(tcx, r._0);
    const [item_def_id, bound] = r._0;

    // Don't let `T::method` resolve to some `for<'a> <T as Tr<'a>>::method`,
    // which may happen via a higher-ranked where clause or supertrait.
    // This is the same restrictions as associated types; even though we could
    // support it, it just makes things a lot more difficult to support in
    // `resolve_bound_vars`, since we'd need to introduce those as elided
    // bound vars on the where clause too.
    if (TypeVisitableExt.has_bound_vars(bound, fold_Binder(d_TraitRef))) {
      return Ty.new_error(
        tcx,
        this.dcx().emit_err(
          AssociatedItemTraitUninferredGenericParams_diagnostic({
            span: hir_ty.span,
            inferred_sugg: Span.with_hi(hir_ty.span, Span.lo(segment.ident.span)),
            bound: `${display_TraitRef(Binder.skip_binder(tcx.anonymize_bound_vars(bound, d_TraitRef)))}::`,
            mpart_sugg: undefined,
            what: tcx.def_descr(item_def_id),
          }),
        ),
      );
    }

    const r2 = this.lower_return_type_notation_ty(bound, item_def_id, hir_ty.span);
    switch (r2.$) {
      case "Ok":
        return Ty.new_alias(tcx, "No", r2._0);
      case "Err":
        return Ty.new_error(tcx, r2._0);
    }
  } else {
    return this.lower_ty(hir_ty);
  }
};

/// Do the common parts of lowering an RTN type. This involves extending the
/// candidate binder to include all of the early- and late-bound vars that are
/// defined on the function itself, and constructing a projection to the RPITIT
/// return type of that function.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:748 lower_return_type_notation_ty
HirTyLowerer.prototype.lower_return_type_notation_ty = function (
  this: HirTyLowerer,
  candidate: PolyTraitRef,
  item_def_id: DefId,
  path_span: Span,
): Result<AliasTy, ErrorGuaranteed> {
  const tcx = this.tcx();
  let emitted_bad_param_err: ErrorGuaranteed | undefined = undefined;
  // If we have an method return type bound, then we need to instantiate
  // the method's early bound params with suitable late-bound params.
  let num_bound_vars = Binder.bound_vars(candidate).length;
  const args = Binder.skip_binder(candidate).args.extend_to(tcx, item_def_id, (param, _) => {
    let arg: GenericArg;
    switch (param.kind.$) {
      case "Lifetime":
        arg = RegionC.new_bound(tcx, INNERMOST, { var: BoundVar.from_usize(num_bound_vars), kind: { $: "Named", _0: param.def_id } });
        break;
      case "Type": {
        const guar = (emitted_bad_param_err ??= this.dcx().emit_err(
          ReturnTypeNotationIllegalParam_diagnostic({ $: "Type", span: path_span, param_span: tcx.def_span(param.def_id) }),
        ));
        arg = Ty.new_error(tcx, guar);
        break;
      }
      case "Const": {
        const guar = (emitted_bad_param_err ??= this.dcx().emit_err(
          ReturnTypeNotationIllegalParam_diagnostic({ $: "Const", span: path_span, param_span: tcx.def_span(param.def_id) }),
        ));
        arg = ConstC.new_error(tcx, guar);
        break;
      }
    }
    num_bound_vars += 1;
    return arg;
  });

  // Next, we need to check that the return-type notation is being used on
  // an RPITIT (return-position impl trait in trait) or AFIT (async fn in trait).
  const output = PolyFnSig.output(EarlyBinder.skip_binder(tcx.fn_sig(item_def_id) as EarlyBinder<Binder<FnSig>>));
  let output_: AliasTy;
  const okind = Binder.skip_binder(output).kind();
  if (okind.$ === "Alias" && okind._1.kind.$ === "Projection" && tcx.is_impl_trait_in_trait(okind._1.kind.def_id)) {
    output_ = okind._1;
  } else {
    return Err(
      this.dcx().emit_err(
        ReturnTypeNotationOnNonRpitit_diagnostic({
          span: path_span,
          ty: tcx.liberate_late_bound_regions(item_def_id, output, fold_Ty),
          fn_span: tcx.hir_span_if_local(item_def_id),
          note: null,
        }),
      ),
    );
  }

  // Finally, move the fn return type's bound vars over to account for the early bound
  // params (and trait ref's late bound params). This logic is very similar to
  // `rustc_middle::ty::predicate::Clause::instantiate_supertrait`
  // and it's no coincidence why.
  const shifted_output = tcx.shift_bound_var_indices(num_bound_vars, output_, relate_AliasTy);
  return Ok(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, shifted_output, relate_AliasTy), tcx, args, relate_AliasTy)));
};

/// Detect and reject early-bound & escaping late-bound generic params in the type of assoc const bindings.
///
/// FIXME(const_generics): This is a temporary and semi-artificial restriction until the
/// arrival of *generic const generics*[^1].
///
/// It might actually be possible that we can already support early-bound generic params
/// in such types if we just lifted some more checks in other places, too, for example
/// inside `HirTyLowerer::lower_anon_const`. However, even if that were the case, we should
/// probably gate this behind another feature flag.
///
/// [^1]: <https://github.com/rust-lang/project-const-generics/issues/28>.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:834 check_assoc_const_binding_type
export function check_assoc_const_binding_type(cx: HirTyLowerer, assoc_const: Ident, ty_: Binder<Ty>, hir_id: hir.HirId): Ty {
  // We can't perform the checks for early-bound params during name resolution unlike E0770
  // because this information depends on *type* resolution.
  // We can't perform these checks in `resolve_bound_vars` either for the same reason.
  // Consider the trait ref `for<'a> Trait<'a, C = { &0 }>`. We need to know the fully
  // resolved type of `Trait::C` in order to know if it references `'a` or not.

  const ty = Binder.skip_binder(ty_);
  if (!TypeVisitableExt.has_param(ty, fold_Ty) && !TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
    return ty;
  }

  const collector = new GenericParamAndBoundVarCollector(cx, new Set<number>(), new DefIdSet(), INNERMOST);
  const r = fold_Ty.visit_with(ty, collector);
  let guar: ErrorGuaranteed | undefined = r.$ === "Break" ? r._0 : undefined;

  const tcx = cx.tcx();
  const sugg = IsSuggestable.make_suggestable(ty, tcx, false, undefined, fold_Ty);
  const ty_note: TyOfAssocConstBindingNote | undefined = sugg !== undefined ? { assoc_const, ty: sugg } : undefined;

  let enclosing_item_owner_id: hir.OwnerId | undefined;
  for (const [owner_id, parent] of tcx.hir_parent_owner_iter(hir_id)) {
    if (hir.OwnerNode.generics(parent) !== undefined) {
      enclosing_item_owner_id = owner_id;
      break;
    }
  }
  const generics = tcx.generics_of(unwrap(enclosing_item_owner_id)) as Generics;
  for (const index of collector.params) {
    const param = generics.param_at(index, tcx);
    const is_self_param = param.name === kw.SelfUpper;
    guar ??= cx.dcx().emit_err(
      ParamInTyOfAssocConstBinding_diagnostic({
        span: assoc_const.span,
        assoc_const,
        param_name: param.name,
        param_def_kind: tcx.def_descr(param.def_id),
        param_category: is_self_param ? "self" : GenericParamDefKind.is_synthetic(param.kind) ? "synthetic" : "normal",
        param_defined_here_label: !is_self_param ? unwrap(tcx.def_ident_span(param.def_id) as Span | undefined) : undefined,
        ty_note,
      }),
    );
  }
  for (const var_def_id of collector.vars) {
    guar ??= cx.dcx().emit_err(
      EscapingBoundVarInTyOfAssocConstBinding_diagnostic({
        span: assoc_const.span,
        assoc_const,
        var_name: cx.tcx().item_name(var_def_id),
        var_def_kind: tcx.def_descr(var_def_id),
        var_defined_here_label: unwrap(tcx.def_ident_span(var_def_id) as Span | undefined),
        ty_note,
      }),
    );
  }

  const guar_ = guar !== undefined ? guar : bug("failed to find gen params or bound vars in ty");
  return Ty.new_error(tcx, guar_);
}

// rustc-type: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:906 GenericParamAndBoundVarCollector
// PORT: hand class (types.sets.json `hand`). `params: FxIndexSet<u32>` is a `Set<number>`, `vars: FxIndexSet<DefId>` a
// `DefIdSet` (both insertion-ordered); `depth` is mutated in place (`shift_in` / `shift_out` on the field).
export class GenericParamAndBoundVarCollector implements TypeVisitor<ControlFlow<ErrorGuaranteed>> {
  // type Result = ControlFlow<ErrorGuaranteed>;
  readonly Result: VisitorResult<ControlFlow<ErrorGuaranteed>, unknown> = VisitorResultC.ControlFlow<ErrorGuaranteed>();

  constructor(
    public cx: HirTyLowerer,
    public params: Set<number>,
    public vars: DefIdSet,
    public depth: DebruijnIndex,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:916 visit_binder
  visit_binder<T>(binder: Binder<T>, d: TypeVisitable<T>): ControlFlow<ErrorGuaranteed> {
    this.depth = DebruijnIndexC.shifted_in(this.depth, 1);
    const result = visit_Binder(d).super_visit_with(binder, this);
    this.depth = DebruijnIndexC.shifted_out(this.depth, 1);
    return result;
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:926 visit_ty
  visit_ty(ty: Ty): ControlFlow<ErrorGuaranteed> {
    const k = ty.kind();
    if (k.$ === "Param") {
      this.params.add(k._0.index);
    } else if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.depth) {
      const bt = k._1;
      let def_id: DefId;
      switch (bt.kind.$) {
        case "Param":
          def_id = bt.kind._0;
          break;
        case "Anon": {
          const reported = this.cx.dcx().delayed_bug(`unexpected anon bound ty: ${debug_BoundVar(bt.var, PLAIN)}`);
          return ControlFlow.Break(reported);
        }
      }
      this.vars.add(def_id);
    } else if (TypeVisitableExt.has_param(ty, fold_Ty) || TypeVisitableExt.has_bound_vars(ty, fold_Ty)) {
      return fold_Ty.super_visit_with(ty, this);
    } else {
      // _ => {}
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:949 visit_region
  visit_region(re: Region): ControlFlow<ErrorGuaranteed> {
    const k = re.kind();
    if (k.$ === "ReEarlyParam") {
      this.params.add(k._0.index);
    } else if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 >= this.depth) {
      const br = k._1;
      let def_id: DefId;
      switch (br.kind.$) {
        case "Named":
          def_id = br.kind._0;
          break;
        case "Anon":
        case "ClosureEnv": {
          const guar = this.cx.dcx().delayed_bug(`unexpected bound region kind: ${debug_BoundRegionKind(br.kind, PLAIN)}`);
          return ControlFlow.Break(guar);
        }
        case "NamedForPrinting":
          return bug("only used for pretty printing");
      }
      this.vars.add(def_id);
    } else {
      // _ => {}
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs:974 visit_const
  visit_const(ct: Const): ControlFlow<ErrorGuaranteed> {
    const k = ct.kind();
    if (k.$ === "Param") {
      this.params.add(k._0.index);
    } else if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.depth) {
      const guar = this.cx.dcx().delayed_bug("unexpected escaping late-bound const var");
      return ControlFlow.Break(guar);
    } else if (TypeVisitableExt.has_param(ct, fold_Const) || TypeVisitableExt.has_bound_vars(ct, fold_Const)) {
      return fold_Const.super_visit_with(ct, this);
    } else {
      // _ => {}
    }
    return ControlFlow.CONTINUE;
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}
