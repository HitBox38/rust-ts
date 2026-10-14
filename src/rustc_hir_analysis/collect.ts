// Port of compiler/rustc_hir_analysis/src/collect.rs (lane collect-a).
//
//! "Collection" is the process of determining the type and other external
//! details of each item in Rust. Collection is specifically concerned
//! with *inter-procedural* things -- for example, for a function
//! definition, collection will figure out the type and signature of the
//! function, but it will not visit the *body* of the function in any way,
//! nor examine type annotations on local variables (that's the job of
//! type *checking*).
//!
//! Collecting is ultimately defined by a bundle of queries that
//! inquire after various facts about the items in the crate (e.g.,
//! `type_of`, `generics_of`, `clauses_of`, etc). See the `provide` function
//! for the full set.
//!
//! At present, however, we do run collection across all items in the
//! crate as a kind of pass. This should eventually be factored away.
//
// Contract: `ItemCtxt` is declared in ./decls.ts; its inherent methods are assigned onto `ItemCtxt.prototype` here (and
// in collect/clauses_of.ts), its `impl HirTyLowerer` is the vtable object `HirTyLowerer_ItemCtxt` below.
// Init order: top-level code here may touch only ./decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
// PORT: `InferCtxt`, `SolverRegionConstraint` (lane infcx-contract), `TestBinderBody` / `TestBinderForall` /
// `TestBinderExists` (check/wfcheck.rs, wave 17) and rustc_trait_selection are pending: the code that builds or uses
// them stops with `unported(..)` at the first use, after the upstream statements before it.
import { ItemCtxt, type HirTyLowerer, type HirTyLowererImpl, type InferCtxt, type SolverRegionConstraint, type TestBinderBody, type TestBinderExists, type TestBinderForall } from "./decls.ts";
import { Size } from "../rustc_abi/lib.ts";
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { into_MultiSpan } from "../rustc_error_messages/lib.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0228, type Level } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { debug_Node } from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import { pluralize } from "../rustc_lint_defs/lib.ts";
import { REPR_C_ENUMS_LARGER_THAN_INT } from "../rustc_lint_defs/builtin.gen.ts";
import type { DynCompatibilityViolation } from "../rustc_middle/traits/mod.ts";
import type { AdtDef, AdtKind } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Const, Region } from "../rustc_middle/ty/decls.ts";
import { fold_List_Ty, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type GenericParamDef } from "../rustc_middle/ty/generics.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { type List, RawList } from "../rustc_middle/ty/list.ts";
import { FieldDef, HasAttrs_LocalDefId, ImplTraitHeader, type ParamEnv, RestrictionKind, Ty, VariantDef, type VariantDiscr } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { TraitDef } from "../rustc_middle/ty/trait_def.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { type Discr, display_Discr, IntTypeExt } from "../rustc_middle/ty/util.ts";
import { Size_sign_extend } from "../rustc_middle/ty/consts/int.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { IsSuggestable } from "../rustc_middle/ty/diagnostics.ts";
import { debug_LateParamRegionKind, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, debug_LocalDefId, LocalDefId, type LocalModId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { type Ident, kw, Symbol } from "../rustc_span/symbol.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Binder, BoundRegionKind, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { debug_BoundVariableKind } from "../rustc_type_ir/binder.gen.ts";
import type { AnonConstKind, BoundRegion, BoundVariableKind, ImplPolarity, PolyFnSig, PolyTraitRef, PolyTypeOutlivesClause, RegionOutlivesClause, TraitRef } from "../rustc_type_ir/decls.ts";
import { DeepRejectCtxt } from "../rustc_type_ir/fast_reject.ts";
import { fold_regions, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../rustc_type_ir/predicate.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { display_TraitRef } from "../rustc_type_ir/ir_print.ts";
import { FnSig, fold_FnSig, PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import { fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { Const as ConstC, Region as RegionC } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_RawList } from "../rustc_middle/ty/list.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as clauses_of from "./collect/clauses_of.ts";
import * as generics_of from "./collect/generics_of.ts";
import * as item_bounds from "./collect/item_bounds.ts";
import * as resolve_bound_vars from "./collect/resolve_bound_vars.ts";
import * as type_of from "./collect/type_of.ts";
import { type FieldDeclSpan, FieldUniquenessCheckContext, type NestedSpan } from "./collect.gen.ts";
import * as diagnostics from "./diagnostics.ts";
import { HirTyLowerer_provided, type InherentAssocCandidate, RegionInferReason } from "./hir_ty_lowering/mod.ts";

export * from "./collect.gen.ts";
export { ItemCtxt } from "./decls.ts";

// mod clauses_of;
// pub(crate) mod dump;
export * as dump from "./collect/dump.ts";
// mod generics_of;
// mod item_bounds;
// mod resolve_bound_vars;
// mod type_of;

///////////////////////////////////////////////////////////////////////////

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`]
// rustc: compiler/rustc_hir_analysis/src/collect.rs:65 provide
export function provide(providers: Providers): void {
  resolve_bound_vars.provide(providers);
  providers.type_of = type_of.type_of;
  providers.type_of_opaque = type_of.type_of_opaque;
  providers.type_of_opaque_hir_typeck = type_of.type_of_opaque_hir_typeck;
  providers.type_alias_is_checked = type_of.type_alias_is_checked;
  providers.item_bounds = item_bounds.item_bounds;
  providers.explicit_item_bounds = item_bounds.explicit_item_bounds;
  providers.item_self_bounds = item_bounds.item_self_bounds;
  providers.explicit_item_self_bounds = item_bounds.explicit_item_self_bounds;
  providers.item_non_self_bounds = item_bounds.item_non_self_bounds;
  providers.impl_super_outlives = item_bounds.impl_super_outlives;
  providers.generics_of = generics_of.generics_of;
  providers.clauses_of = clauses_of.clauses_of;
  providers.explicit_clauses_of = clauses_of.explicit_clauses_of;
  providers.explicit_super_clauses_of = clauses_of.explicit_super_clauses_of;
  providers.explicit_implied_clauses_of = clauses_of.explicit_implied_clauses_of;
  providers.explicit_supertraits_containing_assoc_item = clauses_of.explicit_supertraits_containing_assoc_item;
  providers.trait_explicit_clauses_and_bounds = clauses_of.trait_explicit_clauses_and_bounds;
  providers.const_conditions = clauses_of.const_conditions;
  providers.explicit_implied_const_bounds = clauses_of.explicit_implied_const_bounds;
  providers.type_param_clauses = clauses_of.type_param_clauses;
  providers.trait_def = trait_def;
  providers.adt_def = adt_def;
  providers.fn_sig = fn_sig;
  providers.impl_trait_header = impl_trait_header;
  providers.impl_is_fully_generic_for_reflection = impl_is_fully_generic_for_reflection;
  providers.coroutine_kind = coroutine_kind;
  providers.coroutine_for_closure = coroutine_for_closure;
  providers.opaque_ty_origin = opaque_ty_origin;
  providers.rendered_precise_capturing_args = rendered_precise_capturing_args;
  providers.const_param_default = const_param_default;
  providers.anon_const_kind = anon_const_kind;
  providers.const_of_item = const_of_item;
}

///////////////////////////////////////////////////////////////////////////

// rustc-type: compiler/rustc_hir_analysis/src/collect.rs:144 HirPlaceholderCollector
// #[derive(Default)]
export class HirPlaceholderCollector extends hir.intravisit.Visitor {
  spans: Span[] = [];
  // If any of the spans points to a const infer var, then suppress any messages
  // that may try to turn that const infer into a type parameter.
  may_contain_const_infer = false;

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:152 visit_infer
  override visit_infer(_inf_id: HirId, inf_span: Span, kind: hir.intravisit.InferKind): undefined {
    this.spans.push(inf_span);

    if (kind.$ === "Const" || kind.$ === "Ambig") {
      this.may_contain_const_infer = true;
    }
    return undefined;
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:161 placeholder_type_error_diag
export function placeholder_type_error_diag(cx: HirTyLowerer, generics: hir.Generics | undefined, placeholder_types: Span[], additional_spans: Span[], suggest: boolean, hir_ty: hir.Ty | undefined, kind: string): Diag {
  if (placeholder_types.length === 0) {
    return bad_placeholder(cx, additional_spans, kind);
  }

  const params = generics !== undefined ? generics.params : [];
  void params;
  // `params.next_type_param_name(None)`: rustc_trait_selection's `NextTypeParamName` (not ported).
  const type_name: string = unported("rustc_trait_selection::error_reporting::traits::suggestions::NextTypeParamName::next_type_param_name");
  const sugg: [Span, string][] = placeholder_types.map((sp) => [sp, type_name]);

  if (generics !== undefined) {
    let found: Span | undefined;
    for (const arg of params) {
      if (arg.name.$ === "Plain" && arg.name._0.name === kw.Underscore) {
        found = arg.name._0.span;
        break;
      }
    }
    if (found !== undefined) {
      const span = found;
      // Account for `_` already present in cases like `struct S<_>(_);` and suggest
      // `struct S<T>(T);` instead of `struct S<_, T>(T);`.
      sugg.push([span, type_name]);
    } else {
      const span = generics.span_for_param_suggestion();
      if (span !== undefined) {
        // Account for bounds, we want `fn foo<T: E, K>(_: K)` not `fn foo<T, K: E>(_: K)`.
        sugg.push([span, `, ${type_name}`]);
      } else {
        sugg.push([generics.span, `<${type_name}>`]);
      }
    }
  }

  const err = bad_placeholder(cx, [...placeholder_types, ...additional_spans], kind);

  // Suggest, but only if it is not a function in const or static
  if (suggest) {
    let is_fn = false;
    let is_const_or_static = false;

    if (hir_ty !== undefined && hir_ty.kind.$ === "FnPtr") {
      is_fn = true;

      // Check if parent is const or static
      const parent = cx.tcx().parent_hir_node(hir_ty.hir_id);
      is_const_or_static =
        (parent.$ === "Item" && (parent._0.kind.$ === "Const" || parent._0.kind.$ === "Static")) ||
        (parent.$ === "TraitItem" && parent._0.kind.$ === "Const") ||
        (parent.$ === "ImplItem" && parent._0.kind.$ === "Const");
    }

    // if function is wrapped around a const or static,
    // then don't show the suggestion
    if (!(is_fn && is_const_or_static)) {
      err.multipart_suggestion("use type parameters instead", sugg, "HasPlaceholders");
    }
  }

  return err;
}

///////////////////////////////////////////////////////////////////////////
// Utility types and common code for the above passes.

// rustc: compiler/rustc_hir_analysis/src/collect.rs:236 bad_placeholder
export function bad_placeholder(cx: HirTyLowerer, spans: Span[], kind_: string): Diag {
  const kind = kind_.endsWith("s") ? `${kind_}es` : `${kind_}s`;

  // `spans.sort_by_key(|span| span.lo_hi())` (a stable sort, as JS's).
  spans.sort((a, b) => {
    const [alo, ahi] = Span.lo_hi(a);
    const [blo, bhi] = Span.lo_hi(b);
    return alo !== blo ? alo - blo : ahi - bhi;
  });
  return cx.dcx().create_err(diagnostics.PlaceholderNotAllowedItemSignatures_diagnostic({ spans, kind }));
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:248 new
ItemCtxt.new = function (tcx: TyCtxt, item_def_id: LocalDefId): ItemCtxt {
  return ItemCtxt.new_internal(tcx, item_def_id, false);
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:252 new_internal
ItemCtxt.new_internal = function (tcx: TyCtxt, item_def_id: LocalDefId, delegation: boolean): ItemCtxt {
  const tainted_by_errors: MutRef<ErrorGuaranteed | undefined> = { value: undefined }; // `Cell::new(None)`
  return new ItemCtxt(tcx, item_def_id, tainted_by_errors, delegation);
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:265 new_for_delegation
ItemCtxt.new_for_delegation = function (tcx: TyCtxt, item_def_id: LocalDefId): ItemCtxt {
  return ItemCtxt.new_internal(tcx, item_def_id, true);
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:269 lower_ty
ItemCtxt.prototype.lower_ty = function (this: ItemCtxt, hir_ty: hir.Ty): Ty {
  return this.lowerer().lower_ty(hir_ty);
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:273 hir_id
ItemCtxt.prototype.hir_id = function (this: ItemCtxt): HirId {
  return this.tcx.local_def_id_to_hir_id(this.item_def_id);
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:277 node
ItemCtxt.prototype.node = function (this: ItemCtxt): hir.Node {
  return this.tcx.hir_node(this.hir_id());
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:281 check_tainted_by_errors
ItemCtxt.prototype.check_tainted_by_errors = function (this: ItemCtxt): Result<undefined, ErrorGuaranteed> {
  const err = this.tainted_by_errors.value;
  if (err !== undefined) {
    return Err(err);
  } else {
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:288 report_placeholder_type_error
ItemCtxt.prototype.report_placeholder_type_error = function (this: ItemCtxt, placeholder_types: Span[], infer_replacements: [Span, string][]): ErrorGuaranteed {
  const node = this.tcx.hir_node_by_def_id(this.item_def_id);
  const generics = hir.Node.generics(node);
  let kind_id: LocalDefId;
  switch (node.$) {
    case "GenericParam":
    case "WherePredicate":
    case "Field":
      kind_id = this.tcx.local_parent(this.item_def_id);
      break;
    default:
      kind_id = this.item_def_id;
  }
  const kind = this.tcx.def_descr(LocalDefId.to_def_id(kind_id));
  const diag = placeholder_type_error_diag(
    this.lowerer(),
    generics,
    placeholder_types,
    infer_replacements.map(([span, _]) => span),
    false,
    undefined,
    kind,
  );
  if (infer_replacements.length !== 0) {
    diag.multipart_suggestion(
      `try replacing \`_\` with the type${pluralize(infer_replacements.length)} in the corresponding trait method signature`,
      infer_replacements,
      "MachineApplicable",
    );
  }

  return diag.emit_err();
};

// PORT: `#[instrument(level = "debug", skip(self), ret)]` (tracing) is dropped, here and below.
// rustc: compiler/rustc_hir_analysis/src/collect.rs:327 lower_test_binder_body
ItemCtxt.prototype.lower_test_binder_body = function (this: ItemCtxt, item: hir.TestBinderBody): TestBinderBody {
  const { foralls, exists, constraints, predicates } = item;
  const foralls_ = foralls.map((forall) => this.lower_test_binder_forall(forall));
  const exists_ = exists.map((exists) => this.lower_test_binder_exists(exists));
  const constraints_ = this.lower_test_binder_constraint(constraints);
  // PORT: `FxIndexSet<(Clause, Span)>`, keyed by its derived `Eq` (interned clause, span).
  const clauses = new KeyedSet<[Clause, Span]>(intern_key);
  for (const predicate of predicates) {
    clauses_of.where_predicate_clauses(this, predicate, clauses);
  }
  const predicates_ = [...clauses].map(([c, span]) => [c.kind(), span] as const);
  void [foralls_, exists_, constraints_, predicates_];
  // `TestBinderBody { foralls, exists, constraints, predicates }`
  return unported("rustc_hir_analysis::check::wfcheck::TestBinderBody (pending, wave 17)");
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:344 lower_test_binder_forall
ItemCtxt.prototype.lower_test_binder_forall = function (this: ItemCtxt, forall: hir.TestBinderForall): TestBinderForall {
  const bound_vars = this.tcx.late_bound_vars(forall.hir_id);
  const value = this.lower_test_binder_body(forall.body);
  const type_outlives: PolyTypeOutlivesClause[] = [];
  const region_outlives: RegionOutlivesClause[] = [];
  for (const predicate of forall.generics.predicates) {
    this.lower_test_binder_assumptions(predicate, type_outlives, region_outlives);
  }
  void [bound_vars, value];
  // `crate::check::wfcheck::WithWhereClauses { value, type_outlives, region_outlives }`, then
  // `TestBinderForall { span, binder: Binder::bind_with_vars(body, bound_vars), assert_on_exit }`
  return unported("rustc_hir_analysis::check::wfcheck::WithWhereClauses / TestBinderForall (pending, wave 17)");
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:365 lower_test_binder_exists
ItemCtxt.prototype.lower_test_binder_exists = function (this: ItemCtxt, exists: hir.TestBinderExists): TestBinderExists {
  const bound_vars = this.tcx.late_bound_vars(exists.hir_id);
  const body = this.lower_test_binder_body(exists.body);
  const binder = Binder.bind_with_vars(body, bound_vars);
  void binder;
  // `TestBinderExists { span: exists.span, binder }`
  return unported("rustc_hir_analysis::check::wfcheck::TestBinderExists (pending, wave 17)");
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:375 lower_test_binder_assumptions
ItemCtxt.prototype.lower_test_binder_assumptions = function (
  this: ItemCtxt,
  predicate: hir.WherePredicate,
  type_outlives: PolyTypeOutlivesClause[],
  region_outlives: RegionOutlivesClause[],
): void {
  // rustc: compiler/rustc_hir_analysis/src/collect.rs:381 outlives_bounds
  function* outlives_bounds(dcx: DiagCtxtHandle, bounds: hir.GenericBounds): Iterable<hir.Lifetime> {
    for (const bound of bounds) {
      switch (bound.$) {
        case "Trait": {
          const poly_trait_ref = bound._0;
          dcx.span_err(poly_trait_ref.span, "trait bounds aren't supported in forall where clauses");
          break;
        }
        case "Outlives":
          yield bound._0;
          break;
        case "Use": {
          const span = bound._1;
          dcx.span_err(span, "use bounds aren't supported in forall where clauses");
          break;
        }
      }
    }
  }
  const kind = predicate.kind;
  switch (kind.$) {
    case "BoundPredicate": {
      const p = kind._0;
      const bound_vars = this.tcx.late_bound_vars(predicate.hir_id);
      const ty = this.lower_ty(p.bounded_ty);
      for (const lifetime of outlives_bounds(HirTyLowerer_ItemCtxt.dcx.call(this), p.bounds)) {
        const region = this.lowerer().lower_lifetime(lifetime, RegionInferReason.RegionPredicate);
        const binder = Binder.bind_with_vars({ _0: ty, _1: region } as PolyTypeOutlivesClause extends Binder<infer T> ? T : never, bound_vars);
        type_outlives.push(binder);
      }
      break;
    }
    case "RegionPredicate": {
      const p = kind._0;
      const lhs = this.lowerer().lower_lifetime(p.lifetime, RegionInferReason.RegionPredicate);
      for (const lifetime of outlives_bounds(HirTyLowerer_ItemCtxt.dcx.call(this), p.bounds)) {
        const rhs = this.lowerer().lower_lifetime(lifetime, RegionInferReason.RegionPredicate);
        region_outlives.push({ _0: lhs, _1: rhs } as RegionOutlivesClause);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_analysis/src/collect.rs:424 lower_test_binder_constraint
ItemCtxt.prototype.lower_test_binder_constraint = function (this: ItemCtxt, constraint: hir.TestBinderConstraint): SolverRegionConstraint {
  // PORT: `SolverRegionConstraint` (`build_and`, `build_or`, `new_true`, `new_false`, `new_ambig`, `new_leaf`) is pending
  // (lane infcx-contract): each arm stops where upstream builds one, after lowering its operands.
  const pending = (what: string): SolverRegionConstraint =>
    unported(`rustc_infer::infer::SolverRegionConstraint::${what} (pending: lane infcx-contract)`);
  switch (constraint.$) {
    case "And": {
      const items = constraint.items.map((item) => this.lower_test_binder_constraint(item));
      void items;
      return pending("build_and");
    }
    case "Or": {
      const items = constraint.items.map((item) => this.lower_test_binder_constraint(item));
      void items;
      return pending("build_or");
    }
    case "Ambiguity":
      return pending("new_ambig");
    case "Lifetime": {
      const span = Span.to(constraint.lhs.ident.span, constraint.rhs.ident.span);
      const lhs = this.lowerer().lower_lifetime(constraint.lhs, RegionInferReason.RegionPredicate);
      const rhs = this.lowerer().lower_lifetime(constraint.rhs, RegionInferReason.RegionPredicate);
      void [span, lhs, rhs];
      return pending("new_leaf(LeafRegionConstraint::RegionOutlives)");
    }
    case "PlaceholderOutlives": {
      const span = Span.to(constraint.lhs.span, constraint.rhs.ident.span);
      const lhs = this.lower_ty(constraint.lhs);
      const rhs = this.lowerer().lower_lifetime(constraint.rhs, RegionInferReason.RegionPredicate);
      // note that we cannot check that lhs is a placeholder at this moment, as at this
      // point it is a bound variable that is not yet instantiated with a placeholder.
      // instead, we check it when we emit the region constraint.
      void [span, lhs, rhs];
      return pending("new_leaf(LeafRegionConstraint::PlaceholderTyOutlives)");
    }
    case "AliasOutlives": {
      const { span, hir_id, lhs: lhs_, rhs: rhs_ } = constraint.bound_type_constraint;
      const bound_vars = this.tcx.late_bound_vars(hir_id);
      const lhs_ty = this.lower_ty(lhs_).kind();
      if (lhs_ty.$ !== "Alias") {
        HirTyLowerer_ItemCtxt.dcx.call(this).span_err(lhs_.span, "bound type test binder constraint must be alias (it's a AliasTyOutlivesViaEnv)");
        return pending("new_true");
      }
      const lhs = lhs_ty._1;
      const rhs = this.lowerer().lower_lifetime(rhs_, RegionInferReason.RegionPredicate);
      void [span, bound_vars, lhs, rhs];
      return pending("new_leaf(LeafRegionConstraint::AliasTyOutlivesViaEnv)");
    }
  }
};

// The provided method `HirTyLowerer::lowerer` (hir_ty_lowering/mod.rs:239) for `ItemCtxt`: the trait object over this
// impl. Not a port of its own (the marker sits on `HirTyLowerer_provided.lowerer`).
ItemCtxt.prototype.lowerer = function (this: ItemCtxt): HirTyLowerer {
  return HirTyLowerer_provided.lowerer(this, HirTyLowerer_ItemCtxt);
};

/**
 * collect.rs:480 `impl<'tcx> HirTyLowerer<'tcx> for ItemCtxt<'tcx>`: the vtable of `ItemCtxt`'s trait objects.
 */
export const HirTyLowerer_ItemCtxt: HirTyLowererImpl<ItemCtxt> = {
  // rustc: compiler/rustc_hir_analysis/src/collect.rs:481 tcx
  tcx(this: ItemCtxt): TyCtxt {
    return this.tcx;
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:485 dcx
  dcx(this: ItemCtxt): DiagCtxtHandle {
    return this.tcx.dcx().into_taintable(this.tainted_by_errors);
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:489 item_def_id
  item_def_id(this: ItemCtxt): LocalDefId {
    return this.item_def_id;
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:493 mod_id
  mod_id(this: ItemCtxt): LocalModId {
    return this.tcx.parent_module_from_def_id(this.item_def_id);
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:497 re_infer
  re_infer(this: ItemCtxt, span: Span, reason: RegionInferReason): Region {
    if (reason.$ === "ObjectLifetimeDefault") {
      const sugg_sp = reason._0;
      // FIXME: Account for trailing plus `dyn Trait+`, the need of parens in
      //        `*const dyn Trait` and `Fn() -> *const dyn Trait`.
      const guar = HirTyLowerer_ItemCtxt.dcx
        .call(this)
        .struct_span_err(span, "cannot deduce the lifetime bound for this trait object type from context")
        .with_code(E0228)
        .with_span_suggestion_verbose(sugg_sp, "please supply an explicit bound", " + /* 'a */", "HasPlaceholders")
        .emit_err();
      return RegionC.new_error(HirTyLowerer_ItemCtxt.tcx.call(this), guar);
    } else {
      // If we found elided lifetime during lowering of delegation parent or child
      // segment then emit an error, as we need a named lifetime for proper signature
      // inheritance (#156848).
      if (this.lowering_delegation_segment) {
        this.tcx.dcx().emit_err(diagnostics.ElidedLifetimesAreNotAllowedInDelegations_diagnostic({ span }));
      }

      // This indicates an illegal lifetime in a non-assoc-trait position
      return RegionC.new_error_with_message(HirTyLowerer_ItemCtxt.tcx.call(this), span, "inferred lifetime in signature");
    }
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:529 ty_infer
  ty_infer(this: ItemCtxt, _: GenericParamDef | undefined, span: Span): Ty {
    if (!this.tcx.dcx().has_stashed_diagnostic(span, "ItemNoType")) {
      this.report_placeholder_type_error([span], []);
    }
    return Ty.new_error_with_message(HirTyLowerer_ItemCtxt.tcx.call(this), into_multispan(span), "bad placeholder type");
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:536 ct_infer
  ct_infer(this: ItemCtxt, _: GenericParamDef | undefined, span: Span): Const {
    this.report_placeholder_type_error([span], []);
    return ConstC.new_error_with_message(HirTyLowerer_ItemCtxt.tcx.call(this), span, "bad placeholder constant");
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:541 register_trait_ascription_bounds
  register_trait_ascription_bounds(this: ItemCtxt, _: [Clause, Span][], _1: HirId, span: Span): void {
    HirTyLowerer_ItemCtxt.dcx.call(this).span_delayed_bug(span, "trait ascription type not allowed here");
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:550 probe_ty_param_bounds
  probe_ty_param_bounds(this: ItemCtxt, span: Span, def_id: LocalDefId, assoc_ident: Ident): EarlyBinder<readonly [Clause, Span][]> {
    return this.tcx.at(span).type_param_clauses([this.item_def_id, def_id, assoc_ident]) as EarlyBinder<readonly [Clause, Span][]>;
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:560 select_inherent_assoc_candidates
  select_inherent_assoc_candidates(this: ItemCtxt, _span: Span, self_ty_: Ty, candidates_: InherentAssocCandidate[]): [InherentAssocCandidate[], never[]] {
    assert(!TypeVisitableExt.has_infer(self_ty_, fold_Ty), "assertion failed: !self_ty.has_infer()");

    // We don't just call the normal normalization routine here as we can't provide the
    // correct `ParamEnv` and it would be wrong to invoke arbitrary trait solving under
    // the wrong `ParamEnv`. Expanding free aliases doesn't need a `ParamEnv` so we do
    // this just to make resolution a little bit smarter.
    const self_ty = this.tcx.expand_free_alias_tys(self_ty_, fold_Ty);
    // debug!("select_inherent_assoc_candidates: self_ty={:?}", self_ty);

    const candidates = candidates_.filter(({ impl_ }) => {
      const impl_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(HirTyLowerer_ItemCtxt.tcx.call(this).type_of(impl_) as EarlyBinder<Ty>));

      // See comment on doing this operation for `self_ty`
      const impl_ty = this.tcx.expand_free_alias_tys(impl_ty_, fold_Ty);
      // debug!("select_inherent_assoc_candidates: impl_ty={:?}", impl_ty);

      // We treat parameters in the self ty as rigid and parameters in the impl ty as infers
      // because it allows `impl<T> Foo<T>` to unify with `Foo<u8>::IAT`, while also disallowing
      // `Foo<T>::IAT` from unifying with `impl Foo<u8>`.
      //
      // We don't really care about a depth limit here because we're only working with user-written
      // types and if they wrote a type that would take hours to walk then that's kind of on them. On
      // the other hand the default depth limit is relatively low and could realistically be hit by
      // users in normal cases.
      //
      // `DeepRejectCtxt` leads to slightly worse IAT resolution than real type equality in cases
      // where the `impl_ty` has repeated uses of generic parameters. E.g. `impl<T> Foo<T, T>` would
      // be considered a valid candidate when resolving `Foo<u8, u16>::IAT`.
      //
      // Not replacing escaping bound vars in `self_ty` with placeholders also leads to slightly worse
      // resolution, but it probably won't come up in practice and it would be backwards compatible
      // to switch over to doing that.
      // PORT: `usize::MAX` as the depth limit: `Number.MAX_SAFE_INTEGER` (the walk decrements it, never reaching 0 either way).
      return DeepRejectCtxt.relate_rigid_infer(as_interner(this.tcx)).types_may_unify_with_depth(self_ty, impl_ty, Number.MAX_SAFE_INTEGER);
    });

    return [candidates, []];
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:611 lower_assoc_item_path
  lower_assoc_item_path(this: ItemCtxt, span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed> {
    const trait_ref = Binder.no_bound_vars(poly_trait_ref, d_TraitRef);
    if (trait_ref !== undefined) {
      const item_args = this.lowerer().lower_generic_args_of_assoc_item(span, item_def_id, item_segment, trait_ref.args);
      return Ok([item_def_id, item_args]);
    } else {
      // There are no late-bound regions; we can just ignore the binder.
      let mpart_sugg: diagnostics.AssociatedItemTraitUninferredGenericParamsMultipartSuggestion | undefined = undefined;
      let inferred_sugg: Span | undefined = undefined;
      let bound = "";

      const node = this.node();
      switch (node.$) {
        case "Field":
        case "Ctor":
        case "Variant": {
          const item = this.tcx.hir_expect_item(this.tcx.hir_get_parent_item(this.hir_id()).def_id);
          const kind = item.kind;
          switch (kind.$) {
            case "Enum":
            case "Struct":
            case "Union": {
              const generics = kind._1;
              const lt_name = get_new_lifetime_name(this.tcx, poly_trait_ref, generics);
              const [lt_sp, sugg]: [Span, string] =
                generics.params.length === 0 ? [generics.span, `<${lt_name}>`] : [Span.shrink_to_lo(generics.params[0]!.span), `${lt_name}, `];
              mpart_sugg = {
                fspan: lt_sp,
                first: sugg,
                sspan: Span.with_hi(span, Span.lo(item_segment.ident.span)),
                second: `${display_TraitRef(
                  // Replace the existing lifetimes with a new named lifetime.
                  this.tcx.instantiate_bound_regions_uncached(
                    poly_trait_ref,
                    (_) => RegionC.new_early_param(this.tcx, { index: 0, name: Symbol.intern(lt_name) }),
                    d_TraitRef,
                  ),
                )}::`,
              };
              break;
            }
            default:
              break;
          }
          break;
        }
        case "Item":
        case "ForeignItem":
        case "TraitItem":
        case "ImplItem":
          if (node.$ === "Item" && (node._0.kind.$ === "Struct" || node._0.kind.$ === "Enum" || node._0.kind.$ === "Union")) {
            break;
          }
          inferred_sugg = Span.with_hi(span, Span.lo(item_segment.ident.span));
          bound = `${display_TraitRef(
            // Erase named lt, we want `<A as B<'_>::C`, not `<A as B<'a>::C`.
            Binder.skip_binder(this.tcx.anonymize_bound_vars(poly_trait_ref, d_TraitRef)),
          )}::`;
          break;
        default:
          break;
      }

      return Err(
        HirTyLowerer_ItemCtxt.tcx
          .call(this)
          .dcx()
          .emit_err(
            diagnostics.AssociatedItemTraitUninferredGenericParams_diagnostic({
              span,
              inferred_sugg,
              bound,
              mpart_sugg,
              what: this.tcx.def_descr(item_def_id),
            }),
          ),
      );
    }
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:698 probe_adt
  probe_adt(this: ItemCtxt, _span: Span, ty: Ty): AdtDef | undefined {
    // FIXME(#103640): Should we handle the case where `ty` is a projection?
    return ty.ty_adt_def();
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:703 record_ty
  record_ty(this: ItemCtxt, _hir_id: HirId, _ty: Ty, _span: Span): void {
    // There's no place to record types from signatures?
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:707 infcx
  infcx(this: ItemCtxt): InferCtxt | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:711 lower_fn_sig
  lower_fn_sig(this: ItemCtxt, decl: hir.FnDecl, _generics: hir.Generics | undefined, hir_id: HirId, _hir_ty: hir.Ty | undefined): [Ty[], Ty] {
    const tcx = HirTyLowerer_ItemCtxt.tcx.call(this);

    const infer_replacements: [Span, string][] = [];

    const input_tys = decl.inputs.map((a, i) => {
      if (a.kind.$ === "Infer") {
        const suggested_ty = this.lowerer().suggest_trait_fn_ty_for_impl_fn_infer(hir_id, i);
        if (suggested_ty !== undefined) {
          infer_replacements.push([a.span, display_Ty(suggested_ty)]);
          return Ty.new_error_with_message(tcx, into_multispan(a.span), display_Ty(suggested_ty));
        }
      }

      return this.lowerer().lower_ty(a);
    });

    let output_ty: Ty;
    const output_ = decl.output;
    switch (output_.$) {
      case "Return": {
        const output = output_._0;
        let suggested_ty: Ty | undefined;
        if (output.kind.$ === "Infer" && (suggested_ty = this.lowerer().suggest_trait_fn_ty_for_impl_fn_infer(hir_id, undefined)) !== undefined) {
          infer_replacements.push([output.span, display_Ty(suggested_ty)]);
          output_ty = Ty.new_error_with_message(tcx, into_multispan(output.span), display_Ty(suggested_ty));
        } else {
          output_ty = this.lower_ty(output);
        }
        break;
      }
      case "DefaultReturn":
        output_ty = tcx.types.unit;
        break;
    }

    if (infer_replacements.length !== 0) {
      this.report_placeholder_type_error([], infer_replacements);
    }
    return [input_tys, output_ty];
  },

  // rustc: compiler/rustc_hir_analysis/src/collect.rs:760 dyn_compatibility_violations
  dyn_compatibility_violations(this: ItemCtxt, trait_def_id: DefId): DynCompatibilityViolation[] {
    void trait_def_id;
    // `hir_ty_lowering_dyn_compatibility_violations(self.tcx, trait_def_id)`
    return unported("rustc_trait_selection::traits::hir_ty_lowering_dyn_compatibility_violations");
  },
};

/// Synthesize a new lifetime name that doesn't clash with any of the lifetimes already present.
// rustc: compiler/rustc_hir_analysis/src/collect.rs:766 get_new_lifetime_name
export function get_new_lifetime_name(tcx: TyCtxt, poly_trait_ref: PolyTraitRef, generics: hir.Generics): string {
  const existing_lifetimes = new Set<string>();
  for (const lt of tcx.collect_referenced_late_bound_regions(poly_trait_ref, d_TraitRef)) {
    const name = BoundRegionKind.get_name(lt, tcx);
    if (name !== undefined) existing_lifetimes.add(Symbol.as_str(name));
  }
  for (const param of generics.params) {
    if (param.kind.$ === "Lifetime") {
      existing_lifetimes.add(Symbol.as_str(hir.ParamName.ident(param.name).name));
    }
  }

  const a_to_z_repeat_n = function* (n: number): Iterable<string> {
    for (let c = 0x61; c <= 0x7a; c++) {
      let s = "'";
      s += String.fromCharCode(c).repeat(n);
      yield s;
    }
  };

  // If all single char lifetime names are present, we wrap around and double the chars.
  for (let n = 1; ; n++) {
    for (const lt of a_to_z_repeat_n(n)) {
      if (!existing_lifetimes.has(lt)) return lt;
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:796 check_ctor
export function check_ctor(tcx: TyCtxt, def_id: LocalDefId): void {
  tcx.ensure_ok().generics_of(def_id);
  tcx.ensure_ok().type_of(def_id);
  tcx.ensure_ok().clauses_of(def_id);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:802 check_enum_variant_types
export function check_enum_variant_types(tcx: TyCtxt, def_id: LocalDefId): void {
  // struct ReprCIssue { msg: &'static str }
  interface ReprCIssue {
    msg: string;
  }

  // impl<'a> Diagnostic<'a> for ReprCIssue
  // rustc: compiler/rustc_hir_analysis/src/collect.rs:808 into_diag
  function ReprCIssue_into_diag(self: ReprCIssue, dcx: DiagCtxtHandle, level: Level): Diag {
    const { msg } = self;
    return Diag.new(dcx, level, msg)
      .with_note("`repr(C)` enums with big discriminants are non-portable, and their size in Rust might not match their size in C")
      .with_help("use `repr($int_ty)` instead to explicitly set the size of this enum");
  }
  const ReprCIssue_diagnostic = (self: ReprCIssue): Diagnostic => ({ into_diag: (dcx, level) => ReprCIssue_into_diag(self, dcx, level) });

  const def = tcx.adt_def(def_id) as AdtDef;
  const repr_type = def.repr().discr_type();
  const initial = IntTypeExt.initial_discriminant(repr_type, tcx);
  let prev_discr: Discr | undefined = undefined;
  // Some of the logic below relies on `i128` being able to hold all c_int and c_uint values.
  assert(tcx.sess.target.c_int_width < 128, "assertion failed: tcx.sess.target.c_int_width < 128");
  let min_discr = I128_MAX;
  let max_discr = I128_MIN;

  // fill the discriminant values and field types
  for (const variant of def.variants()) {
    const wrapped_discr: Discr = prev_discr === undefined ? initial : prev_discr.wrap_incr(tcx);
    let cur_discr_: Discr | undefined;
    if (variant.discr.$ === "Explicit") {
      const const_def_id = variant.discr._0;
      const r = def.eval_explicit_discr(tcx, const_def_id);
      cur_discr_ = r.$ === "Ok" ? r._0 : undefined;
    } else {
      const discr = IntTypeExt.disr_incr(repr_type, tcx, prev_discr);
      if (discr !== undefined) {
        cur_discr_ = discr;
      } else {
        const span = tcx.def_span(variant.def_id);
        tcx.dcx().emit_err(
          diagnostics.EnumDiscriminantOverflowed_diagnostic({
            span,
            discr: display_Discr(prev_discr!),
            item_name: tcx.item_ident(variant.def_id),
            wrapped_discr: display_Discr(wrapped_discr),
          }),
        );
        cur_discr_ = undefined;
      }
    }
    const cur_discr: Discr = cur_discr_ ?? wrapped_discr;

    if (def.repr().c()) {
      const c_int = Size.from_bits(tcx.sess.target.c_int_width);
      const c_uint_max = c_int.unsigned_int_max(); // `i128::try_from(..).unwrap()`: < 2^127 (c_int_width < 128)
      // c_int is a signed type, so get a proper signed version of the discriminant
      const discr_size = cur_discr.ty.int_size_and_signed(tcx)[0];
      const discr_val = Size_sign_extend(discr_size, cur_discr.val);
      min_discr = min_discr < discr_val ? min_discr : discr_val;
      max_discr = max_discr > discr_val ? max_discr : discr_val;

      // The discriminant range must either fit into c_int or c_uint.
      if (!(min_discr >= c_int.signed_int_min() && max_discr <= c_int.signed_int_max()) && !(min_discr >= 0n && max_discr <= c_uint_max)) {
        const span = tcx.def_span(variant.def_id);
        let msg: string;
        if (discr_val < c_int.signed_int_min() || discr_val > c_uint_max) {
          msg = "`repr(C)` enum discriminant does not fit into C `int` nor into C `unsigned int`";
        } else if (discr_val < 0n) {
          msg = "`repr(C)` enum discriminant does not fit into C `unsigned int`, and a previous discriminant does not fit into C `int`";
        } else {
          msg = "`repr(C)` enum discriminant does not fit into C `int`, and a previous discriminant does not fit into C `unsigned int`";
        }
        tcx.emit_node_span_lint(REPR_C_ENUMS_LARGER_THAN_INT, tcx.local_def_id_to_hir_id(def_id), span, ReprCIssue_diagnostic({ msg }));
      }
    }

    prev_discr = cur_discr;

    for (const f of variant.fields) {
      tcx.ensure_ok().generics_of(f.did);
      tcx.ensure_ok().type_of(f.did);
      tcx.ensure_ok().clauses_of(f.did);
    }

    // Lower the ctor, if any. This also registers the variant as an item.
    const ctor_def_id = variant.ctor_def_id();
    if (ctor_def_id !== undefined) {
      check_ctor(tcx, ctor_def_id.expect_local());
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:896 to_field_already_declared_nested_help
function NestedSpan_to_field_already_declared_nested_help(self: NestedSpan): diagnostics.FieldAlreadyDeclaredNestedHelp {
  return { span: self.span };
}

// impl From<Span> for FieldDeclSpan
// rustc: compiler/rustc_hir_analysis/src/collect.rs:908 from
function FieldDeclSpan_from_Span(span: Span): FieldDeclSpan {
  return { $: "NotNested", _0: span };
}

// impl From<NestedSpan> for FieldDeclSpan
// rustc: compiler/rustc_hir_analysis/src/collect.rs:914 from
function FieldDeclSpan_from_NestedSpan(span: NestedSpan): FieldDeclSpan {
  return { $: "Nested", _0: span };
}
void FieldDeclSpan_from_NestedSpan;

// rustc: compiler/rustc_hir_analysis/src/collect.rs:925 new
function FieldUniquenessCheckContext_new(tcx: TyCtxt): FieldUniquenessCheckContext {
  // PORT: `FxIndexMap<Ident, FieldDeclSpan>`: `Ident` is an object, so the map is keyed by its `Eq` (`Ident_key`).
  return new FieldUniquenessCheckContext(tcx, new KeyedMap<Ident, FieldDeclSpan>(Ident_key));
}

/// Check if a given field `ident` declared at `field_decl` has been declared elsewhere before.
// rustc: compiler/rustc_hir_analysis/src/collect.rs:930 check_field_decl
function FieldUniquenessCheckContext_check_field_decl(self: FieldUniquenessCheckContext, field_name_: Ident, field_decl: FieldDeclSpan): void {
  const field_name = field_name_.normalize_to_macros_2_0();
  const prev = self.seen_fields.get(field_name);
  if (field_decl.$ === "NotNested" && prev !== undefined && prev.$ === "NotNested") {
    const span = field_decl._0;
    const prev_span = prev._0;
    self.tcx.dcx().emit_err(diagnostics.FieldAlreadyDeclared_diagnostic({ $: "NotNested", field_name, span, prev_span }));
  } else if (field_decl.$ === "NotNested" && prev !== undefined && prev.$ === "Nested") {
    const span = field_decl._0;
    const prev_ = prev._0;
    self.tcx.dcx().emit_err(
      diagnostics.FieldAlreadyDeclared_diagnostic({
        $: "PreviousNested",
        field_name,
        span,
        prev_span: prev_.span,
        prev_nested_field_span: prev_.nested_field_span,
        prev_help: NestedSpan_to_field_already_declared_nested_help(prev_),
      }),
    );
  } else if (field_decl.$ === "Nested" && prev !== undefined && prev.$ === "NotNested") {
    const current = field_decl._0;
    const { span, nested_field_span } = current;
    const prev_span = prev._0;
    self.tcx.dcx().emit_err(
      diagnostics.FieldAlreadyDeclared_diagnostic({
        $: "CurrentNested",
        field_name,
        span,
        nested_field_span,
        help: NestedSpan_to_field_already_declared_nested_help(current),
        prev_span,
      }),
    );
  } else if (field_decl.$ === "Nested" && prev !== undefined && prev.$ === "Nested") {
    const current = field_decl._0;
    const { span, nested_field_span } = current;
    const prev_ = prev._0;
    self.tcx.dcx().emit_err(
      diagnostics.FieldAlreadyDeclared_diagnostic({
        $: "BothNested",
        field_name,
        span,
        nested_field_span,
        help: NestedSpan_to_field_already_declared_nested_help(current),
        prev_span: prev_.span,
        prev_nested_field_span: prev_.nested_field_span,
        prev_help: NestedSpan_to_field_already_declared_nested_help(prev_),
      }),
    );
  } else {
    // (field_decl, None)
    self.seen_fields.set(field_name, field_decl);
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:980 lower_variant
export function lower_variant(tcx: TyCtxt, variant_did: LocalDefId | undefined, ident: Ident, discr: VariantDiscr, def: hir.VariantData, adt_kind: AdtKind, parent_did: LocalDefId): VariantDef {
  const field_uniqueness_check_ctx = FieldUniquenessCheckContext_new(tcx);
  const fields = hir.VariantData.fields(def).map((field) => {
    // `.inspect(..)` runs before `.map(..)` per element.
    FieldUniquenessCheckContext_check_field_decl(field_uniqueness_check_ctx, field.ident, FieldDeclSpan_from_Span(field.span));
    const f = field;
    let mut_restriction: RestrictionKind;
    const k = f.mut_restriction.kind;
    switch (k.$) {
      case "Unrestricted":
        mut_restriction = RestrictionKind.Unrestricted;
        break;
      case "Restricted": {
        const path = k._0;
        mut_restriction = { $: "Restricted", _0: path.res, _1: f.mut_restriction.span };
        break;
      }
    }
    return new FieldDef(
      LocalDefId.to_def_id(f.def_id),
      f.ident.name,
      tcx.visibility(f.def_id),
      mut_restriction,
      f.safety,
      f.default !== undefined ? LocalDefId.to_def_id(f.default.def_id) : undefined,
    );
  });
  const recovered = def.$ === "Struct" && def.recovered.$ === "Yes" ? def.recovered._0 : undefined;
  const ctor = hir.VariantData.ctor(def);
  return VariantDef.new(
    ident.name,
    variant_did !== undefined ? LocalDefId.to_def_id(variant_did) : undefined,
    ctor !== undefined ? [ctor[0], LocalDefId.to_def_id(ctor[2])] : undefined,
    discr,
    fields,
    LocalDefId.to_def_id(parent_did),
    recovered,
    (adt_kind === "Struct" && find_attr(HasAttrs_LocalDefId.get_attrs(parent_did, tcx), (k) => (k.$ === "NonExhaustive" ? null : undefined)) !== undefined) ||
      (variant_did !== undefined && find_attr(HasAttrs_LocalDefId.get_attrs(variant_did, tcx), (k) => (k.$ === "NonExhaustive" ? null : undefined)) !== undefined),
  );
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1028 adt_def
export function adt_def(tcx: TyCtxt, def_id: LocalDefId): AdtDef {
  const node = tcx.hir_node_by_def_id(def_id);
  if (node.$ !== "Item") {
    return bug("expected ADT to be an item");
  }
  const item = node._0;

  const repr = tcx.repr_options_of_def(def_id);
  let kind: AdtKind;
  let variants: VariantDef[];
  const ik = item.kind;
  switch (ik.$) {
    case "Enum": {
      const def = ik._2;
      let distance_from_explicit = 0;
      variants = def.variants.map((v) => {
        let discr: VariantDiscr;
        if (v.disr_expr !== undefined) {
          const e = v.disr_expr;
          distance_from_explicit = 0;
          discr = { $: "Explicit", _0: LocalDefId.to_def_id(e.def_id) };
        } else {
          discr = { $: "Relative", _0: distance_from_explicit };
        }
        distance_from_explicit += 1;

        return lower_variant(tcx, v.def_id, v.ident, discr, v.data, "Enum", def_id);
      });

      kind = "Enum";
      break;
    }
    case "Struct":
    case "Union": {
      const ident = ik._0;
      const def = ik._2;
      const adt_kind: AdtKind = ik.$ === "Struct" ? "Struct" : "Union";
      variants = [lower_variant(tcx, undefined, ident, { $: "Relative", _0: 0 }, def, adt_kind, def_id)];

      kind = adt_kind;
      break;
    }
    default:
      return bug(`${debug_LocalDefId(item.owner_id.def_id, PLAIN)} is not an ADT`);
  }
  return tcx.mk_adt_def(LocalDefId.to_def_id(def_id), kind, variants, repr);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1088 trait_def
export function trait_def(tcx: TyCtxt, def_id: LocalDefId): TraitDef {
  const item = tcx.hir_expect_item(def_id);

  let constness: hir.Constness;
  let is_alias: boolean;
  let is_auto: boolean;
  let safety: hir.Safety;
  let impl_restriction: RestrictionKind;
  const ik = item.kind;
  switch (ik.$) {
    case "Trait": {
      constness = ik.constness;
      is_alias = false;
      is_auto = ik.is_auto === "Yes";
      safety = ik.safety;
      const k = ik.impl_restriction.kind;
      switch (k.$) {
        case "Restricted":
          impl_restriction = { $: "Restricted", _0: k._0.res, _1: ik.impl_restriction.span };
          break;
        case "Unrestricted":
          impl_restriction = RestrictionKind.Unrestricted;
          break;
      }
      break;
    }
    case "TraitAlias":
      [constness, is_alias, is_auto, safety, impl_restriction] = [ik._0, true, false, "Safe", RestrictionKind.Unrestricted];
      break;
    default:
      return span_bug(item.span, "trait_def_of_item invoked on non-trait");
  }

  // we do a bunch of find_attr calls here, probably faster to get them from the tcx just once.
  // #[allow(deprecated)]
  const attrs = tcx.get_all_attrs(LocalDefId.to_def_id(def_id));

  const paren_sugar = find_attr(attrs, (k) => (k.$ === "RustcParenSugar" ? null : undefined)) !== undefined;

  // Only regular traits can be marker.
  const is_marker = !is_alias && find_attr(attrs, (k) => (k.$ === "Marker" ? null : undefined)) !== undefined;

  const rustc_coinductive = find_attr(attrs, (k) => (k.$ === "RustcCoinductive" ? null : undefined)) !== undefined;
  const is_fundamental = find_attr(attrs, (k) => (k.$ === "Fundamental" ? null : undefined)) !== undefined;

  const [skip_array_during_method_dispatch, skip_boxed_slice_during_method_dispatch] =
    find_attr(attrs, (k) => (k.$ === "RustcSkipDuringMethodDispatch" ? ([k.array, k.boxed_slice] as [boolean, boolean]) : undefined)) ?? [false, false];

  let specialization_kind: TraitDef["specialization_kind"];
  if (find_attr(attrs, (k) => (k.$ === "RustcAllowLifetimeDependentSpecialization" ? null : undefined)) !== undefined) {
    specialization_kind = "Marker";
  } else if (find_attr(attrs, (k) => (k.$ === "RustcSpecializationTrait" ? null : undefined)) !== undefined) {
    specialization_kind = "AlwaysApplicable";
  } else {
    specialization_kind = "None";
  }

  const must_implement_one_of = find_attr(attrs, (k) => (k.$ === "RustcMustImplementOneOf" ? [...k.fn_names] : undefined));

  const deny_explicit_impl = find_attr(attrs, (k) => (k.$ === "RustcDenyExplicitImpl" ? null : undefined)) !== undefined;
  const force_dyn_incompatible = find_attr(attrs, (k) => (k.$ === "RustcDynIncompatibleTrait" ? k._0 : undefined));

  return new TraitDef(
    LocalDefId.to_def_id(def_id),
    impl_restriction,
    safety,
    constness,
    paren_sugar,
    is_auto,
    is_marker,
    rustc_coinductive || is_auto,
    is_fundamental,
    skip_array_during_method_dispatch,
    skip_boxed_slice_during_method_dispatch,
    specialization_kind,
    must_implement_one_of,
    force_dyn_incompatible,
    deny_explicit_impl,
  );
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1168 fn_sig
export function fn_sig(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<PolyFnSig> {
  const hir_id = tcx.local_def_id_to_hir_id(def_id);

  const icx = ItemCtxt.new(tcx, def_id);

  let output: PolyFnSig;
  const node = tcx.hir_node(hir_id);
  if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Provided") {
    output = lower_fn_sig_recovering_infer_ret_ty(icx, node._0.kind._0, node._0.generics, def_id);
  } else if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    output = lower_fn_sig_recovering_infer_ret_ty(icx, node._0.kind.sig, node._0.kind.generics, def_id);
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    const sig = node._0.kind._0;
    const generics = node._0.generics;
    // Do not try to infer the return type for a impl method coming from a trait
    const parent = tcx.parent_hir_node(hir_id);
    if (parent.$ === "Item" && parent._0.kind.$ === "Impl" && parent._0.kind._0.of_trait !== undefined) {
      output = icx.lowerer().lower_fn_ty(hir_id, sig.header.safety_(), sig.header.abi, sig.decl, generics, undefined);
    } else {
      output = lower_fn_sig_recovering_infer_ret_ty(icx, sig, generics, def_id);
    }
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    const { header, decl } = node._0.kind._0;
    const generics = node._0.generics;
    output = icx.lowerer().lower_fn_ty(hir_id, header.safety_(), header.abi, decl, generics, undefined);
  } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
    const sig = node._0.kind._0;
    const abi = tcx.hir_get_foreign_abi(hir_id);
    output = compute_sig_of_foreign_fn_decl(tcx, def_id, sig.decl, abi, sig.header.safety_());
  } else if (node.$ === "Ctor") {
    const data = node._0;
    // assert_matches!(data.ctor(), Some(_));
    assert(hir.VariantData.ctor(data) !== undefined, "assertion failed: data.ctor() matches Some(_)");
    const adt_def_id = LocalDefId.to_def_id(tcx.hir_get_parent_item(hir_id).def_id);
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(adt_def_id) as EarlyBinder<Ty>));
    const inputs = hir.VariantData.fields(data).map((f) => Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(f.def_id) as EarlyBinder<Ty>)));
    output = Binder.dummy(tcx.mk_fn_sig_rust_abi(inputs, ty, "Safe"), fold_FnSig);
  } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    // Closure signatures are not like other function
    // signatures and cannot be accessed through `fn_sig`. For
    // example, a closure signature excludes the `self`
    // argument. In any case they are embedded within the
    // closure type as part of the `ClosureArgs`.
    //
    // To get the signature of a closure, you should use the
    // `sig` method on the `ClosureArgs`:
    //
    //    args.as_closure().sig(def_id, tcx)
    return bug("to get the signature of a closure, use `args.as_closure().sig()` not `fn_sig()`");
  } else {
    return bug(`unexpected sort of node in fn_sig(): ${debug_Node(node, PLAIN)}`);
  }
  return EarlyBinder.bind(tcx, output, fold_Binder(fold_FnSig));
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1254 lower_fn_sig_recovering_infer_ret_ty
export function lower_fn_sig_recovering_infer_ret_ty(icx: ItemCtxt, sig: hir.FnSig, generics: hir.Generics, def_id: LocalDefId): PolyFnSig {
  const infer_ret_ty = hir.FnRetTy.is_suggestable_infer_ty(sig.decl.output);
  if (infer_ret_ty !== undefined) {
    return recover_infer_ret_ty(icx, infer_ret_ty, generics, def_id);
  }

  return icx.lowerer().lower_fn_ty(HirTyLowerer_ItemCtxt.tcx.call(icx).local_def_id_to_hir_id(def_id), sig.header.safety_(), sig.header.abi, sig.decl, generics, undefined);
}

/// Convert `ReLateParam`s in `value` back into `ReBound`s and bind it with `bound_vars`.
// rustc: compiler/rustc_hir_analysis/src/collect.rs:1275 late_param_regions_to_bound
export function late_param_regions_to_bound<T>(tcx: TyCtxt, scope: DefId, bound_vars: List<BoundVariableKind>, value_: T, d_T: TypeFoldable<T>): Binder<T> {
  const value = fold_regions(
    tcx,
    value_,
    (r, debruijn) => {
      const k = r.kind();
      if (k.$ === "ReLateParam") {
        const lp = k._0;
        // Should be in scope, otherwise inconsistency happens somewhere.
        assert(DefId_eq(lp.scope, scope), "assertion `left == right` failed: lp.scope == scope");

        let br: BoundRegion;
        const lk = lp.kind;
        switch (lk.$) {
          // These variants preserve the bound var index.
          case "Anon":
          case "NamedAnon": {
            const kind = lk;
            const idx = lk._0;
            const var_ = idx as BoundRegion["var"];

            const bv = bound_vars[idx];
            if (bv === undefined || bv.$ !== "Region") {
              return bug(`unexpected late-bound region ${debug_LateParamRegionKind(kind, PLAIN)} for bound vars ${debug_RawList(bound_vars, PLAIN, debug_BoundVariableKind)}`);
            }

            br = { var: var_, kind: bv._0 };
            break;
          }

          // For named regions, look up the corresponding bound var.
          case "Named": {
            const def_id = lk._0;
            let found: BoundRegion | undefined;
            for (let idx = 0; idx < bound_vars.length; idx++) {
              const bv = bound_vars[idx]!;
              if (bv.$ === "Region" && bv._0.$ === "Named" && DefId_eq(bv._0._0, def_id)) {
                found = { var: idx as BoundRegion["var"], kind: bv._0 };
                break;
              }
            }
            if (found === undefined) return panic("called `Option::unwrap()` on a `None` value");
            br = found;
            break;
          }

          case "ClosureEnv": {
            let found: BoundRegion | undefined;
            for (let idx = 0; idx < bound_vars.length; idx++) {
              const bv = bound_vars[idx]!;
              if (bv.$ === "Region" && bv._0.$ === "ClosureEnv") {
                found = { var: idx as BoundRegion["var"], kind: bv._0 };
                break;
              }
            }
            if (found === undefined) return panic("called `Option::unwrap()` on a `None` value");
            br = found;
            break;
          }
        }

        return RegionC.new_bound(tcx, debruijn, br);
      }
      return r;
    },
    d_T,
  );

  return Binder.bind_with_vars(value, bound_vars);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1338 recover_infer_ret_ty
export function recover_infer_ret_ty(icx: ItemCtxt, infer_ret_ty: hir.Ty, generics: hir.Generics, def_id: LocalDefId): PolyFnSig {
  const tcx = icx.tcx;
  const hir_id = tcx.local_def_id_to_hir_id(def_id);

  const fn_sig_ = (tcx.typeck(def_id) as TypeckResults).liberated_fn_sigs().index(hir_id);

  // Typeck doesn't expect erased regions to be returned from `type_of`.
  // This is a heuristic approach. If the scope has region parameters,
  // we should change fn_sig's lifetime from `ReErased` to `ReError`,
  // otherwise to `ReStatic`.
  const has_region_params = generics.params.some((param) => param.kind.$ === "Lifetime");
  const fn_sig = fold_regions(
    tcx,
    fn_sig_,
    (r, _) => {
      if (r.kind().$ === "ReErased") {
        if (has_region_params) {
          return RegionC.new_error_with_message(tcx, DUMMY_SP, "erased region is not allowed here in return type");
        } else {
          return tcx.lifetimes.re_static;
        }
      }
      return r;
    },
    fold_FnSig,
  );

  const visitor = new HirPlaceholderCollector();
  visitor.visit_ty_unambig(infer_ret_ty);

  const diag = bad_placeholder(icx.lowerer(), visitor.spans, "return type");
  const ret_ty = FnSig.output(fn_sig);

  // Don't leak types into signatures unless they're nameable!
  // For example, if a function returns itself, we don't want that
  // recursive function definition to leak out into the fn sig.
  let recovered_ret_ty: Ty | undefined = undefined;
  const suggestable_ret_ty = IsSuggestable.make_suggestable(ret_ty, tcx, false, undefined, fold_Ty);
  let sugg: string | undefined;
  if (suggestable_ret_ty !== undefined) {
    diag.span_suggestion_verbose(infer_ret_ty.span, "replace with the correct return type", display_Ty(suggestable_ret_ty), "MachineApplicable");
    recovered_ret_ty = suggestable_ret_ty;
  } else if (
    (sugg = suggest_impl_trait(
      // `&tcx.infer_ctxt().build(TypingMode::non_body_analysis())`
      unported("rustc_infer::infer::TyCtxtInferExt::infer_ctxt (pending: lane infcx-contract)"),
      tcx.param_env(def_id) as ParamEnv,
      ret_ty,
    )) !== undefined
  ) {
    diag.span_suggestion_verbose(infer_ret_ty.span, "replace with an appropriate return type", sugg, "MachineApplicable");
  } else if (ret_ty.is_closure()) {
    diag.help("consider using an `Fn`, `FnMut`, or `FnOnce` trait bound");
  }

  // Also note how `Fn` traits work just in case!
  if (ret_ty.is_closure()) {
    diag.note("for more information on `Fn` traits and closure types, see https://doc.rust-lang.org/book/ch13-01-closures.html");
  }
  const guar = diag.emit_err();

  // If we return a dummy binder here, we can ICE later in borrowck when it encounters
  // `ReLateParam` regions (e.g. in a local type annotation) which weren't registered via the
  // signature binder. See #135845.
  const bound_vars = tcx.late_bound_vars(hir_id);
  const scope = LocalDefId.to_def_id(def_id);

  const fn_sig2 = tcx.mk_fn_sig(FnSig.inputs(fn_sig), recovered_ret_ty ?? Ty.new_error(tcx, guar), fn_sig.fn_sig_kind);

  return late_param_regions_to_bound(tcx, scope, bound_vars, fn_sig2, fold_FnSig);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1429 suggest_impl_trait
export function suggest_impl_trait(infcx: InferCtxt, param_env: ParamEnv, ret_ty: Ty): string | undefined {
  const format_as_assoc = (tcx: TyCtxt, _: GenericArgs, trait_def_id: DefId, assoc_item_def_id: DefId, item_ty: Ty): string | undefined => {
    const trait_name = Symbol.as_str(tcx.item_name(trait_def_id));
    const assoc_name = Symbol.as_str(tcx.item_name(assoc_item_def_id));
    return `impl ${trait_name}<${assoc_name} = ${display_Ty(item_ty)}>`;
  };
  const format_as_parenthesized = (tcx: TyCtxt, args: GenericArgs, trait_def_id: DefId, _: DefId, item_ty: Ty): string | undefined => {
    const trait_name = Symbol.as_str(tcx.item_name(trait_def_id));
    const args_tuple = args.type_at(1);
    const k = args_tuple.kind();
    if (k.$ !== "Tuple") {
      return undefined;
    }
    const types = IsSuggestable.make_suggestable(k._0, tcx, false, undefined, fold_List_Ty);
    if (types === undefined) return undefined;
    const maybe_ret = item_ty.is_unit() ? "" : ` -> ${display_Ty(item_ty)}`;
    return `impl ${trait_name}(${types.map((ty) => display_Ty(ty)).join(", ")})${maybe_ret}`;
  };
  void [format_as_assoc, format_as_parenthesized, param_env, ret_ty];

  // PORT: `InferCtxt` is pending (lane infcx-contract): the candidate list reads `infcx.tcx` first, so the fn stops there.
  // The loop (`infcx.probe`, `GenericArgs::for_item` with `infcx.var_for_def`, `type_implements_trait`, `ObligationCtxt`,
  // `deeply_resolve_ignoring_regions`) is all `InferCtxt` / rustc_trait_selection.
  void infcx;
  return unported("rustc_hir_analysis::collect::suggest_impl_trait (InferCtxt pending: lane infcx-contract)");
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1561 impl_is_fully_generic_for_reflection
export function impl_is_fully_generic_for_reflection(tcx: TyCtxt, def_id: LocalDefId): boolean {
  return (tcx.impl_trait_header(def_id) as ImplTraitHeader).is_fully_generic_for_reflection() && GenericClauses.is_fully_generic_for_reflection(tcx.explicit_clauses_of(def_id) as GenericClauses);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1566 impl_trait_header
export function impl_trait_header(tcx: TyCtxt, def_id: LocalDefId): ImplTraitHeader {
  const icx = ItemCtxt.new(tcx, def_id);
  const item = tcx.hir_expect_item(def_id);
  const impl_ = item.expect_impl();
  const of_trait = impl_.of_trait;
  if (of_trait === undefined) {
    return panic(`expected impl trait, found inherent impl on ${debug_LocalDefId(def_id, PLAIN)}`);
  }
  const selfty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));

  check_impl_constness(tcx, impl_.constness, of_trait.trait_ref);

  const trait_ref = icx.lowerer().lower_impl_trait_ref(of_trait.trait_ref, selfty);

  return new ImplTraitHeader(EarlyBinder.bind(tcx, trait_ref, d_TraitRef), polarity_of_impl(of_trait), of_trait.safety, impl_.constness);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1587 check_impl_constness
export function check_impl_constness(tcx: TyCtxt, constness: hir.Constness, hir_trait_ref: hir.TraitRef): void {
  if (constness.$ === "NotConst") {
    return;
  }

  const trait_def_id = hir_trait_ref.trait_def_id();
  if (trait_def_id === undefined) return;
  if (tcx.is_const_trait(trait_def_id)) {
    return;
  }

  const trait_name = Symbol.as_str(tcx.item_name(trait_def_id));
  let suggestion: Span | undefined;
  let suggestion_pre: string;
  const local = trait_def_id.as_local();
  if (local !== undefined && tcx.sess.is_nightly_build()) {
    const span_ = tcx.hir_expect_item(local).vis_span;
    const span = tcx.sess.source_map().span_extend_while_whitespace(span_);

    [suggestion, suggestion_pre] = [
      Span.shrink_to_hi(span),
      tcx.features().const_trait_impl() ? "" : "enable `#![feature(const_trait_impl)]` in your crate and ",
    ];
  } else {
    [suggestion, suggestion_pre] = [undefined, ""];
  }
  tcx.dcx().emit_err(
    diagnostics.ConstImplForNonConstTrait_diagnostic({
      trait_ref_span: hir_trait_ref.path.span,
      trait_name,
      suggestion,
      suggestion_pre,
      marking: null,
      adding: null,
    }),
  );
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1629 polarity_of_impl
export function polarity_of_impl(of_trait: hir.TraitImplHeader): ImplPolarity {
  switch (of_trait.polarity.$) {
    case "Negative":
      return "Negative";
    case "Positive":
      return "Positive";
  }
}

/// Returns the early-bound lifetimes declared in this generics
/// listing. For anything other than fns/methods, this is just all
/// the lifetimes that are declared. For fns or methods, we have to
/// screen out those that do not appear in any where-clauses etc using
/// `resolve_lifetime::early_bound_lifetimes`.
// rustc: compiler/rustc_hir_analysis/src/collect.rs:1641 early_bound_lifetimes_from_generics
export function early_bound_lifetimes_from_generics(tcx: TyCtxt, generics: hir.Generics): Iterable<hir.GenericParam> {
  return generics.params.filter((param) => {
    switch (param.kind.$) {
      case "Lifetime":
        return !tcx.is_late_bound(param.hir_id);
      default:
        return false;
    }
  });
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1651 compute_sig_of_foreign_fn_decl
export function compute_sig_of_foreign_fn_decl(tcx: TyCtxt, def_id: LocalDefId, decl: hir.FnDecl, abi: ExternAbi, safety: hir.Safety): PolyFnSig {
  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const fty = ItemCtxt.new(tcx, def_id).lowerer().lower_fn_ty(hir_id, safety, abi, decl, undefined, undefined);

  // Feature gate SIMD types in FFI, since I am not sure that the
  // ABIs are handled at all correctly. -huonw
  if (!tcx.features().simd_ffi()) {
    const check = (hir_ty: hir.Ty, ty: Ty): void => {
      if (ty.is_simd()) {
        const r = tcx.sess.source_map().span_to_snippet(hir_ty.span);
        const snip = r.$ === "Err" ? "" : ` \`${r._0.toString()}\``;
        tcx.dcx().emit_err(diagnostics.SIMDFFIHighlyExperimental_diagnostic({ span: hir_ty.span, snip }));
      }
    };
    const inputs = Binder.skip_binder(PolyFnSigC.inputs(fty));
    for (let i = 0; i < Math.min(decl.inputs.length, inputs.length); i++) {
      check(decl.inputs[i]!, inputs[i]!);
    }
    if (decl.output.$ === "Return") {
      check(decl.output._0, Binder.skip_binder(PolyFnSigC.output(fty)));
    }
  }

  return fty;
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1687 coroutine_kind
export function coroutine_kind(tcx: TyCtxt, def_id: LocalDefId): hir.CoroutineKind | undefined {
  const node = tcx.hir_node_by_def_id(def_id);
  if (node.$ === "Expr" && node._0.kind.$ === "Closure" && node._0.kind._0.kind.$ === "Coroutine") {
    return node._0.kind._0.kind._0;
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1701 coroutine_for_closure
export function coroutine_for_closure(tcx: TyCtxt, def_id: LocalDefId): DefId {
  const closure = hir.Node.expect_closure(tcx.hir_node_by_def_id(def_id));
  if (closure.kind.$ !== "CoroutineClosure") {
    return bug();
  }
  const body = closure.body;

  const value = tcx.hir_body(body).value;
  if (!(value.kind.$ === "Closure" && value.kind._0.kind.$ === "Coroutine")) {
    return bug();
  }
  const def_id_ = value.kind._0.def_id;

  return LocalDefId.to_def_id(def_id_);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1724 opaque_ty_origin
export function opaque_ty_origin(tcx: TyCtxt, def_id: LocalDefId): hir.OpaqueTyOrigin<DefId> {
  const origin = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(def_id)).origin;
  switch (origin.$) {
    case "FnReturn":
      return { $: "FnReturn", parent: LocalDefId.to_def_id(origin.parent), in_trait_or_impl: origin.in_trait_or_impl };
    case "AsyncFn":
      return { $: "AsyncFn", parent: LocalDefId.to_def_id(origin.parent), in_trait_or_impl: origin.in_trait_or_impl };
    case "TyAlias":
      return { $: "TyAlias", parent: LocalDefId.to_def_id(origin.parent), in_assoc_ty: origin.in_assoc_ty };
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1738 rendered_precise_capturing_args
export function rendered_precise_capturing_args(tcx: TyCtxt, def_id: LocalDefId): readonly hir.PreciseCapturingArgKind<Symbol, Symbol>[] | undefined {
  const info = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (info !== undefined && info.$ === "Trait") {
    const { opaque_def_id } = info;
    return tcx.rendered_precise_capturing_args(opaque_def_id) as readonly hir.PreciseCapturingArgKind<Symbol, Symbol>[] | undefined;
  }

  for (const bound of hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(def_id)).bounds) {
    if (bound.$ === "Use") {
      const args = bound._0;
      return args.map((arg): hir.PreciseCapturingArgKind<Symbol, Symbol> => {
        switch (arg.$) {
          case "Lifetime":
            return { $: "Lifetime", _0: hir.PreciseCapturingArg.name(arg) };
          case "Param":
            return { $: "Param", _0: hir.PreciseCapturingArg.name(arg) };
        }
      });
    }
  }
  return undefined;
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1761 const_param_default
export function const_param_default(tcx: TyCtxt, param_def_id: LocalDefId): EarlyBinder<Const> {
  const node = tcx.hir_node_by_def_id(param_def_id);
  if (!(node.$ === "GenericParam" && node._0.kind.$ === "Const" && node._0.kind.default !== undefined)) {
    return span_bug(tcx.def_span(param_def_id), "const_param_default: expected a const parameter with a default value");
  }
  const ct = node._0.kind.default;

  // FIXME: Don't lower in the context of parent. Blocked on the removal of GCE. See comment in
  //        `type_of.rs` for details (Ctrl+F for `generics_of`).
  const item_def_id = tcx.local_parent(param_def_id);
  const icx = ItemCtxt.new(tcx, item_def_id);

  const ct_ = icx.lowerer().lower_const_arg(ct, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param_def_id) as EarlyBinder<Ty>)));
  return EarlyBinder.bind(tcx, ct_, fold_Const);
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1787 anon_const_kind
export function anon_const_kind(tcx: TyCtxt, def: LocalDefId): AnonConstKind {
  // debug_assert_matches!(tcx.def_kind(def), DefKind::AnonConst);
  const hir_id = tcx.local_def_id_to_hir_id(def);
  const parent_node_id = tcx.parent_hir_id(hir_id);
  const node = tcx.hir_node(parent_node_id);
  switch (node.$) {
    case "ConstArg": {
      // debug_assert_matches!(const_arg.kind, hir::ConstArgKind::Anon(hir::AnonConst { def_id, .. }) if *def_id == def);
      if (tcx.features().generic_const_exprs()) {
        return "GCE";
      } else if (tcx.features().gca()) {
        return "MCG";
      } else {
        const p = tcx.parent_hir_node(parent_node_id);
        if (p.$ === "Expr" && p._0.kind.$ === "Repeat" && HirId_eq(p._0.kind._1.hir_id, parent_node_id)) {
          return "RepeatExprCount";
        } else {
          return "MCG";
        }
      }
    }
    case "Expr":
      if (node._0.kind.$ === "ConstBlock" || node._0.kind.$ === "InlineAsm") {
        return "NonTypeSystemInline";
      }
      return "NonTypeSystemAnon";
    default:
      return "NonTypeSystemAnon";
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect.rs:1818 const_of_item
export function const_of_item(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<Const> | undefined {
  let ct_rhs: hir.ConstItemRhs;
  const node = tcx.hir_node_by_def_id(def_id);
  if (node.$ === "Item" && node._0.kind.$ === "Const") {
    ct_rhs = node._0.kind._3;
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Const") {
    const ct = node._0.kind._1;
    if (ct === undefined) return undefined;
    ct_rhs = ct;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Const") {
    ct_rhs = node._0.kind._1;
  } else {
    return span_bug(tcx.def_span(def_id), `\`const_of_item\` expected a const or assoc const item, got ${debug_Node(node, PLAIN)}`);
  }
  let ct_arg: hir.ConstArg;
  switch (ct_rhs.$) {
    case "Direct":
      ct_arg = ct_rhs._0;
      break;
    case "Body":
      return undefined;
  }
  const icx = ItemCtxt.new(tcx, def_id);
  const identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
  const ct = icx.lowerer().lower_const_arg(ct_arg, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>, tcx, identity_args, fold_Ty)));
  const e = icx.check_tainted_by_errors();
  if (e.$ === "Err" && !TypeVisitableExt.references_error(ct, fold_Const)) {
    return EarlyBinder.bind(tcx, ConstC.new_error(tcx, e._0), fold_Const);
  } else {
    return EarlyBinder.bind(tcx, ct, fold_Const);
  }
}

// ---- helpers (not ports) ----

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

/** `Span` -> `MultiSpan` (`impl From<Span> for MultiSpan`), for `Ty::new_error_with_message`'s `impl Into<MultiSpan>`. */
function into_multispan(span: Span) {
  return into_MultiSpan(span);
}

/** PORT: the `TypeFoldable` impl fns of `TraitRef` (generated) as a D4 descriptor (as rustc_middle print/mod.ts). */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** `FxIndexMap<Ident, _>` key: `Ident`'s `Eq`/`Hash` (the name and the span's `SyntaxContext`). */
function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}

