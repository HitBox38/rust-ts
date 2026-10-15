// Port of compiler/rustc_hir_analysis/src/check/compare_impl_item.rs (lane check-compare, wave 17).
//
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.
//
// PORT notes (file-wide):
// - Query values that are `unknown` in queries.gen.ts (`associated_item`, `generics_of`, `fn_sig`, `type_of`,
//   `clauses_of`, `const_conditions`, `explicit_item_bounds`, `param_env`, `asyncness`, ...) are cast to the upstream
//   value type.
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// - `struct_span_code_err!` is rustc_errors' `struct_span_code_err` with the message formatted here.
// - `TypeErrCtxt`'s `report_fulfillment_errors` / `note_type_err` / `report_region_errors` (wave 19) are a view over
//   `infcx.err_ctxt()` at the end of this file ("Stand-ins"); its stub stops as UNPORTED.
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { normalize_param_env_or_error } from "../../rustc_trait_selection/traits/mod.ts";
import { potentially_plural_count } from "./mod.ts";
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import {
  Applicability,
  type Diag,
  E0049,
  E0050,
  E0053,
  E0185,
  E0186,
  E0195,
  E0326,
  E0643,
  type ErrorGuaranteed,
  MultiSpan,
  pluralize,
  struct_span_code_err,
} from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { FnRetTy, GenericBound, IsAsync, Node } from "../../rustc_hir/hir.ts";
import { Visitor as HirVisitor } from "../../rustc_hir/intravisit.ts";
import type { AmbigArg } from "../../rustc_hir/hir.ts";
import { walk_ty } from "../../rustc_hir/intravisit.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { ValuePairs } from "../../rustc_infer/infer/mod.gen.ts";
import type { ToTrace } from "../../rustc_infer/infer/at.ts";
import type { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import * as rustc_infer from "../../rustc_infer/lib.ts";
import { clone_ObligationCause, ObligationCause, type ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { ConstConditions, GenericClauses, type GenericParamDef, type Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Asyncness, ParamEnv, Term, Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_PolyProjectionClause, Predicate_upcast_from_Clause, Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty, with_crate_prefix } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Clause, fold_Predicate, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_AssocTag } from "../../rustc_middle/ty/assoc.ts";
import { debug_Node } from "../../rustc_hir/hir.gen.ts";
import { fold_with_ProjectionClause, fold_with_TraitRef, try_fold_with_ProjectionClause, try_fold_with_TraitRef, visit_with_ProjectionClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { BoundTyKind, type BoundRegionKind } from "../../rustc_type_ir/binder.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import "../../rustc_trait_selection/lib.ts";
import { BottomUpFolder } from "../../rustc_middle/ty/fold.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "../../rustc_middle/ty/region.gen.ts";
import { type DefId, DefId_eq, DefIdMap, LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Ident, display_Symbol } from "../../rustc_span/symbol.ts";
import { Binder, BoundConst, BoundVariableKind, EarlyBinder, PlaceholderType, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { type PredicateProxy, fold_tuple2, type FallibleTypeFolder, FallibleTypeFolder_provided, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { elaborate } from "../../rustc_type_ir/elaborate.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { BoundVar, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { PolyTraitRef, TraitRef, type ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { Const as ConstC, Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { FnSig, fold_FnSig, PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized, UnnormalizedPolyTraitRef } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitor, TypeVisitableExt, TypeVisitor_provided, type TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { Const } from "../../rustc_middle/ty/decls.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { assert_eq, panic, unreachable, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { LifetimesOrBoundsMismatchOnTrait_diagnostic, MethodShouldReturnFuture_diagnostic } from "../diagnostics.ts";

export * as refine from "./compare_impl_item/refine.ts";

/** `ty::ParamEnv`'s `and` result for `ValuePairs` (`ParamEnvAnd<ValuePairs>`). */
type ParamEnvAndValuePairs = ReturnType<ParamEnv["and"]>;

/// Call the query `tcx.compare_impl_item()` directly instead.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:37 compare_impl_item
export function compare_impl_item(tcx: TyCtxt, impl_item_def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const impl_item = tcx.associated_item(impl_item_def_id) as AssocItem;
  const trait_item_def_id = AssocItem.expect_trait_impl(impl_item);
  if (trait_item_def_id.$ === "Err") return trait_item_def_id;
  const trait_item = tcx.associated_item(trait_item_def_id._0) as AssocItem;
  const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(AssocItem.container_id(impl_item, tcx))));
  // debug!(?impl_trait_ref);

  switch (impl_item.kind.$) {
    case "Fn":
      return compare_impl_method(tcx, impl_item, trait_item, impl_trait_ref);
    case "Type":
      return compare_impl_ty(tcx, impl_item, trait_item, impl_trait_ref);
    case "Const": {
      return compare_impl_const(tcx, impl_item, trait_item, impl_trait_ref);
    }
  }
}

/// Checks that a method from an impl conforms to the signature of
/// the same method as declared in the trait.
///
/// # Parameters
///
/// - `impl_m`: type of the method we are checking
/// - `trait_m`: the method in the trait
/// - `impl_trait_ref`: the TraitRef corresponding to the trait implementation
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:65 compare_impl_method
function compare_impl_method(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  let r = check_method_is_structurally_compatible(tcx, impl_m, trait_m, impl_trait_ref, false);
  if (r.$ === "Err") return r;
  r = compare_method_clause_entailment(tcx, impl_m, trait_m, impl_trait_ref);
  if (r.$ === "Err") return r;
  return Ok(null);
}

/// Checks a bunch of different properties of the impl/trait methods for
/// compatibility, such as asyncness, number of argument, self receiver kind,
/// and number of early- and late-bound generics.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:79 check_method_is_structurally_compatible
function check_method_is_structurally_compatible(
  tcx: TyCtxt,
  impl_m: AssocItem,
  trait_m: AssocItem,
  impl_trait_ref: TraitRef,
  delay: boolean,
): Result<null, ErrorGuaranteed> {
  let r = compare_self_type(tcx, impl_m, trait_m, impl_trait_ref, delay);
  if (r.$ === "Err") return r;
  r = compare_number_of_generics(tcx, impl_m, trait_m, delay);
  if (r.$ === "Err") return r;
  r = compare_generic_param_kinds(tcx, impl_m, trait_m, delay);
  if (r.$ === "Err") return r;
  r = compare_const_generic_param_types(tcx, impl_m, trait_m, impl_trait_ref, delay);
  if (r.$ === "Err") return r;
  r = compare_number_of_method_arguments(tcx, impl_m, trait_m, delay);
  if (r.$ === "Err") return r;
  r = compare_synthetic_generics(tcx, impl_m, trait_m, delay);
  if (r.$ === "Err") return r;
  r = check_region_bounds_on_impl_item(tcx, impl_m, trait_m, delay);
  if (r.$ === "Err") return r;
  return Ok(null);
}

/// This function is best explained by example. Consider a trait with its implementation:
///
/// ```rust
/// trait Trait<'t, T> {
///     // `trait_m`
///     fn method<'a, M>(t: &'t T, m: &'a M) -> Self;
/// }
///
/// struct Foo;
///
/// impl<'i, 'j, U> Trait<'j, &'i U> for Foo {
///     // `impl_m`
///     fn method<'b, N>(t: &'j &'i U, m: &'b N) -> Foo { Foo }
/// }
/// ```
///
/// We wish to decide if those two method types are compatible.
/// For this we have to show that, assuming the bounds of the impl hold, the
/// bounds of `trait_m` imply the bounds of `impl_m`.
///
/// We start out with `trait_to_impl_args`, that maps the trait
/// type parameters to impl type parameters. This is taken from the
/// impl trait reference:
///
/// ```rust,ignore (pseudo-Rust)
/// trait_to_impl_args = {'t => 'j, T => &'i U, Self => Foo}
/// ```
///
/// We create a mapping `dummy_args` that maps from the impl type
/// parameters to fresh types and regions. For type parameters,
/// this is the identity transform, but we could as well use any
/// placeholder types. For regions, we convert from bound to free
/// regions (Note: but only early-bound regions, i.e., those
/// declared on the impl or used in type parameter bounds).
///
/// ```rust,ignore (pseudo-Rust)
/// impl_to_placeholder_args = {'i => 'i0, U => U0, N => N0 }
/// ```
///
/// Now we can apply `placeholder_args` to the type of the impl method
/// to yield a new function type in terms of our fresh, placeholder
/// types:
///
/// ```rust,ignore (pseudo-Rust)
/// <'b> fn(t: &'i0 U0, m: &'b N0) -> Foo
/// ```
///
/// We now want to extract and instantiate the type of the *trait*
/// method and compare it. To do so, we must create a compound
/// instantiation by combining `trait_to_impl_args` and
/// `impl_to_placeholder_args`, and also adding a mapping for the method
/// type parameters. We extend the mapping to also include
/// the method parameters.
///
/// ```rust,ignore (pseudo-Rust)
/// trait_to_placeholder_args = { T => &'i0 U0, Self => Foo, M => N0 }
/// ```
///
/// Applying this to the trait method type yields:
///
/// ```rust,ignore (pseudo-Rust)
/// <'a> fn(t: &'i0 U0, m: &'a N0) -> Foo
/// ```
///
/// This type is also the same but the name of the bound region (`'a`
/// vs `'b`). However, the normal subtyping rules on fn types handle
/// this kind of equivalency just fine.
///
/// We now use these generic parameters to ensure that all declared bounds
/// are satisfied by the implementation's method.
///
/// We do this by creating a parameter environment which contains a
/// generic parameter corresponding to `impl_to_placeholder_args`. We then build
/// `trait_to_placeholder_args` and use it to convert the clauses contained
/// in the `trait_m` generics to the placeholder form.
///
/// Finally we register each of these clauses as an obligation and check that
/// they hold.
// #[instrument(level = "debug", skip(tcx, impl_trait_ref))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:175 compare_method_clause_entailment
function compare_method_clause_entailment(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  // This node-id should be used for the `body_def_id` field on each
  // `ObligationCause` (and the `FnCtxt`).
  //
  // FIXME(@lcnr): remove that after removing `cause.body_def_id` from
  // obligations.
  const impl_m_def_id = impl_m.def_id.expect_local();
  const impl_m_span = tcx.def_span(impl_m_def_id);
  const cause = ObligationCause.new(impl_m_span, impl_m_def_id, {
    $: "CompareImplItem",
    impl_item_def_id: impl_m_def_id,
    trait_item_def_id: trait_m.def_id,
    kind: impl_m.kind,
  });

  // Create mapping from trait method to impl method.
  const impl_def_id = AssocItem.container_id(impl_m, tcx);
  const trait_to_impl_args = RawList.identity_for_item(tcx, impl_m.def_id).rebase_onto(tcx, AssocItem.container_id(impl_m, tcx), impl_trait_ref.args);
  // debug!(?trait_to_impl_args);

  const impl_m_clauses = tcx.clauses_of(impl_m.def_id) as GenericClauses;
  const trait_m_clauses = tcx.clauses_of(trait_m.def_id) as GenericClauses;

  // This is the only tricky bit of the new way we check implementation methods
  // We need to build a set of clauses where only the method-level bounds
  // are from the trait and we assume all other bounds from the implementation
  // to be previously satisfied.
  //
  // We then register the obligations from the impl_m and check to see
  // if all constraints hold.
  const impl_clauses = tcx.clauses_of(unwrap(impl_m_clauses.parent)) as GenericClauses;
  const hybrid_clauses_: Unnormalized<Clause>[] = GenericClauses.instantiate_identity(impl_clauses, tcx).clauses;
  for (const [clause, _] of GenericClauses.instantiate_own(trait_m_clauses, tcx, trait_to_impl_args)) hybrid_clauses_.push(clause);

  const is_conditionally_const = tcx.is_conditionally_const(impl_m.def_id);
  if (is_conditionally_const) {
    // Augment the hybrid param-env with the const conditions
    // of the impl header and the trait method.
    const conds: [Unnormalized<Binder<TraitRef>>, Span][] = [
      ...ConstConditions.instantiate_identity(tcx.const_conditions(impl_def_id) as ConstConditions, tcx),
      ...ConstConditions.instantiate_own(tcx.const_conditions(trait_m.def_id) as ConstConditions, tcx, trait_to_impl_args),
    ];
    for (const [trait_ref, _] of conds) {
      hybrid_clauses_.push(UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, tcx, "Maybe"));
    }
  }

  const hybrid_clauses = hybrid_clauses_.map(Unnormalized.skip_norm_wip);
  const normalize_cause = ObligationCause.misc(impl_m_span, impl_m_def_id);
  let param_env = ParamEnv.new(tcx, hybrid_clauses);
  // NOTE(-Zhigher-ranked-assumptions): The `hybrid_preds`
  // should be well-formed. However, using them may result in
  // region errors as we currently don't track placeholder
  // assumptions.
  //
  // We eagerly normalize the where-clauses here while ignoring
  // region constraints. This means we can then use where-bounds
  // whose normalization results in placeholder errors further
  // down without getting any errors.
  //
  // This should be sound to do so as the only region errors here
  // should be due to missing implied bounds.
  //
  // cc trait-system-refactor-initiative/issues/166.
  param_env = normalize_param_env_or_error(tcx, param_env, normalize_cause);
  // debug!(?param_env);

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  // Create obligations for each clause declared by the impl
  // definition in the context of the hybrid param-env. This makes
  // sure that the impl's method's where clauses are not more
  // restrictive than the trait's method (and the impl itself).
  const impl_m_own_bounds = GenericClauses.instantiate_own_identity(impl_m_clauses);
  for (const [clause_, span] of impl_m_own_bounds) {
    const normalize_cause = ObligationCause.misc(span, impl_m_def_id);
    const clause = ocx.normalize(normalize_cause, param_env, clause_, fold_Clause);

    const cause = ObligationCause.new(span, impl_m_def_id, {
      $: "CompareImplItem",
      impl_item_def_id: impl_m_def_id,
      trait_item_def_id: trait_m.def_id,
      kind: impl_m.kind,
    });
    ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause, param_env, clause, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  // If we're within a const implementation, we need to make sure that the method
  // does not assume stronger `[const]` bounds than the trait definition.
  //
  // This registers the `[const]` bounds of the impl method, which we will prove
  // using the hybrid param-env that we earlier augmented with the const conditions
  // from the impl header and trait method declaration.
  if (is_conditionally_const) {
    for (const [const_condition_, span] of ConstConditions.instantiate_own_identity(tcx.const_conditions(impl_m.def_id) as ConstConditions)) {
      const normalize_cause = ObligationCause.misc(span, impl_m_def_id);
      const const_condition = ocx.normalize(normalize_cause, param_env, const_condition_, d_PolyTraitRef);

      const cause = ObligationCause.new(span, impl_m_def_id, {
        $: "CompareImplItem",
        impl_item_def_id: impl_m_def_id,
        trait_item_def_id: trait_m.def_id,
        kind: impl_m.kind,
      });
      ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause, param_env, PolyTraitRef.to_host_effect_clause(const_condition, tcx, "Maybe"), upcast_tcx(Predicate_upcast_from_Clause)));
    }
  }

  // We now need to check that the signature of the impl method is
  // compatible with that of the trait method. We do this by
  // checking that `impl_fty <: trait_fty`.
  //
  // FIXME: We manually instantiate the trait method here as we need
  // to manually compute its implied bounds. Otherwise this could just
  // be `ocx.sub(impl_sig, trait_sig)`.

  // PORT: `FxIndexSet<Ty>` (interned keys: a `Set`).
  const wf_tys = new Set<Ty>();

  const unnormalized_impl_sig = infcx.instantiate_binder_with_fresh_vars(
    impl_m_span,
    rustc_infer.infer.BoundRegionConversionTime.HigherRankedType,
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(fn_sig_of(tcx, impl_m.def_id))),
    fold_FnSig,
  );

  const norm_cause = ObligationCause.misc(impl_m_span, impl_m_def_id);
  const impl_sig = ocx.normalize(norm_cause, param_env, Unnormalized.new_wip(unnormalized_impl_sig), fold_FnSig);
  // debug!(?impl_sig);

  const trait_sig_binder = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig_of(tcx, trait_m.def_id), tcx, trait_to_impl_args, fold_Binder(fold_FnSig)));
  let trait_sig = tcx.liberate_late_bound_regions(impl_m.def_id, trait_sig_binder, fold_FnSig);

  // Next, add all inputs and output as well-formed tys. Importantly,
  // we have to do this before normalization, since the normalized ty may
  // not contain the input parameters. See issue #87748.
  for (const ty of trait_sig.inputs_and_output) wf_tys.add(ty);
  trait_sig = ocx.normalize(norm_cause, param_env, Unnormalized.new_wip(trait_sig), fold_FnSig);
  // We also have to add the normalized trait signature
  // as we don't normalize during implied bounds computation.
  for (const ty of trait_sig.inputs_and_output) wf_tys.add(ty);
  // debug!(?trait_sig);

  // FIXME: We'd want to keep more accurate spans than "the method signature" when
  // processing the comparison between the trait and impl fn, but we sadly lose them
  // and point at the whole signature when a trait bound or specific input or output
  // type would be more appropriate. In other places we have a `Vec<Span>`
  // corresponding to their `Vec<Predicate>`, but we don't have that here.
  // Fixing this would improve the output of test `issue-83765.rs`.
  // There's the same issue in compare_eii code.
  const result = ocx.sup(cause, param_env, trait_sig, impl_sig, rustc_infer.infer.at.ToTrace_FnSig);

  if (result.$ === "Err") {
    const terr = result._0;
    // debug!(?impl_sig, ?trait_sig, ?terr, "sub_types failed");

    const emitted = report_trait_method_mismatch(infcx, cause, param_env, terr, [trait_m, trait_sig], [impl_m, impl_sig], impl_trait_ref);
    return Err(emitted);
  }

  if (!TypeVisitableExt.references_error([impl_sig, trait_sig] as [FnSig, FnSig], fold_tuple2(fold_FnSig, fold_FnSig))) {
    for (const ty of unnormalized_impl_sig.inputs_and_output) {
      ocx.register_obligation(rustc_infer.traits.Obligation.new(infcx.tcx, clone_ObligationCause(cause), param_env, { $: "WellFormed", _0: ty }, upcast_tcx(Predicate_upcast_from_ClauseKind)));
    }
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const reported = err_ctxt(infcx).report_fulfillment_errors(errors._0);
    return Err(reported);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  const region_errors = infcx.resolve_regions(impl_m_def_id, param_env, wf_tys);
  if (region_errors.length !== 0) {
    return Err(infcx.tainted_by_errors() ?? err_ctxt(infcx).report_region_errors(impl_m_def_id, region_errors));
  }

  return Ok(null);
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:403 RemapLateParam
export class RemapLateParam implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    /** PORT: `FxIndexMap<LateParamRegionKind, LateParamRegionKind>`: a `KeyedMap` on the derived `Eq` (`intern_key`). */
    public mapping: KeyedMap<LateParamRegionKind, LateParamRegionKind>,
  ) {}

  // ---- impl<'tcx> TypeFolder<TyCtxt<'tcx>> for RemapLateParam<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:409 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:413 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReLateParam") {
      const fr = k._0;
      return Region.new_late_param(this.tcx, fr.scope, this.mapping.get(fr.kind) ?? fr.kind);
    } else {
      return r;
    }
  }

  // PORT: the provided `TypeFolder` methods (PORTING §8).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** `FxIndexMap::default()` for `RemapLateParam::mapping`. */
export function new_late_param_mapping(): KeyedMap<LateParamRegionKind, LateParamRegionKind> {
  return new KeyedMap<LateParamRegionKind, LateParamRegionKind>(intern_key);
}

/// Given a method def-id in an impl, compare the method signature of the impl
/// against the trait that it's implementing. In doing so, infer the hidden types
/// that this method's signature provides to satisfy each return-position `impl Trait`
/// in the trait signature.
///
/// The method is also responsible for making sure that the hidden types for each
/// RPITIT actually satisfy the bounds of the `impl Trait`, i.e. that if we infer
/// `impl Trait = Foo`, that `Foo: Trait` holds.
///
/// For example, given the sample code:
///
/// ```
/// use std::ops::Deref;
///
/// trait Foo {
///     fn bar() -> impl Deref<Target = impl Sized>;
///     //          ^- RPITIT #1        ^- RPITIT #2
/// }
///
/// impl Foo for () {
///     fn bar() -> Box<String> { Box::new(String::new()) }
/// }
/// ```
///
/// The hidden types for the RPITITs in `bar` would be inferred to:
///     * `impl Deref` (RPITIT #1) = `Box<String>`
///     * `impl Sized` (RPITIT #2) = `String`
///
/// The relationship between these two types is straightforward in this case, but
/// may be more tenuously connected via other `impl`s and normalization rules for
/// cases of more complicated nested RPITITs.
// #[instrument(skip(tcx), level = "debug", ret)]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:458 collect_return_position_impl_trait_in_trait_tys
export function collect_return_position_impl_trait_in_trait_tys(tcx: TyCtxt, impl_m_def_id: LocalDefId): Result<DefIdMap<EarlyBinder<Ty>>, ErrorGuaranteed> {
  const impl_m = tcx.associated_item(LocalDefId.to_def_id(impl_m_def_id)) as AssocItem;
  const trait_m_def_id = AssocItem.expect_trait_impl(impl_m);
  if (trait_m_def_id.$ === "Err") return trait_m_def_id;
  const trait_m = tcx.associated_item(trait_m_def_id._0) as AssocItem;
  const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(tcx.parent(LocalDefId.to_def_id(impl_m_def_id)))));
  // First, check a few of the same things as `compare_impl_method`,
  // just so we don't ICE during instantiation later.
  const r = check_method_is_structurally_compatible(tcx, impl_m, trait_m, impl_trait_ref, true);
  if (r.$ === "Err") return r;

  const impl_m_hir_id = tcx.local_def_id_to_hir_id(impl_m_def_id);
  const return_span = FnRetTy.span(unwrap(tcx.hir_fn_decl_by_hir_id(impl_m_hir_id)).output);
  const cause = ObligationCause.new(return_span, impl_m_def_id, {
    $: "CompareImplItem",
    impl_item_def_id: impl_m_def_id,
    trait_item_def_id: trait_m.def_id,
    kind: impl_m.kind,
  });

  // Create mapping from trait to impl (i.e. impl trait header + impl method identity args).
  const trait_to_impl_args = RawList.identity_for_item(tcx, impl_m.def_id).rebase_onto(tcx, AssocItem.container_id(impl_m, tcx), impl_trait_ref.args);

  const hybrid_clauses = [
    ...GenericClauses.instantiate_identity(tcx.clauses_of(AssocItem.container_id(impl_m, tcx)) as GenericClauses, tcx),
    ...GenericClauses.instantiate_own(tcx.clauses_of(trait_m.def_id) as GenericClauses, tcx, trait_to_impl_args),
  ].map(([clause, _]) => Unnormalized.skip_norm_wip(clause));
  let param_env = ParamEnv.new(tcx, hybrid_clauses);
  param_env = normalize_param_env_or_error(tcx, param_env, ObligationCause.misc(tcx.def_span(impl_m_def_id), impl_m_def_id));

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  // Check that the where clauses of the impl are satisfied by the hybrid param env.
  // You might ask -- what does this have to do with RPITIT inference? Nothing.
  // We check these because if the where clauses of the signatures do not match
  // up, then we don't want to give spurious other errors that point at the RPITITs.
  // They're not necessary to check, though, because we already check them in
  // `compare_method_clause_entailment`.
  const impl_m_own_bounds = GenericClauses.instantiate_own_identity(tcx.clauses_of(impl_m_def_id) as GenericClauses);
  for (const [clause_, span] of impl_m_own_bounds) {
    const normalize_cause = ObligationCause.misc(span, impl_m_def_id);
    const clause = ocx.normalize(normalize_cause, param_env, clause_, fold_Clause);

    const cause = ObligationCause.new(span, impl_m_def_id, {
      $: "CompareImplItem",
      impl_item_def_id: impl_m_def_id,
      trait_item_def_id: trait_m.def_id,
      kind: impl_m.kind,
    });
    ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause, param_env, clause, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  // Normalize the impl signature with fresh variables for lifetime inference.
  const misc_cause = ObligationCause.misc(return_span, impl_m_def_id);
  const impl_sig = ocx.normalize(
    misc_cause,
    param_env,
    Unnormalized.new_wip(
      infcx.instantiate_binder_with_fresh_vars(
        return_span,
        rustc_infer.infer.BoundRegionConversionTime.HigherRankedType,
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(fn_sig_of(tcx, impl_m.def_id))),
        fold_FnSig,
      ),
    ),
    fold_FnSig,
  );
  let er = TypeVisitableExt.error_reported(impl_sig, fold_FnSig);
  if (er.$ === "Err") return er;
  const impl_return_ty = FnSig.output(impl_sig);

  // Normalize the trait signature with liberated bound vars, passing it through
  // the ImplTraitInTraitCollector, which gathers all of the RPITITs and replaces
  // them with inference variables.
  // We will use these inference variables to collect the hidden types of RPITITs.
  const collector = ImplTraitInTraitCollector.new(ocx, return_span, param_env, impl_m_def_id);
  const unnormalized_trait_sig = fold_FnSig.fold_with(
    tcx.liberate_late_bound_regions(
      impl_m.def_id,
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig_of(tcx, trait_m.def_id), tcx, trait_to_impl_args, fold_Binder(fold_FnSig))),
      fold_FnSig,
    ),
    collector,
  );

  const trait_sig = ocx.normalize(misc_cause, param_env, Unnormalized.new_wip(unnormalized_trait_sig), fold_FnSig);
  er = TypeVisitableExt.error_reported(trait_sig, fold_FnSig);
  if (er.$ === "Err") return er;
  const trait_return_ty = FnSig.output(trait_sig);

  // RPITITs are allowed to use the implied predicates of the method that
  // defines them. This is because we want code like:
  // ```
  // trait Foo {
  //     fn test<'a, T>(_: &'a T) -> impl Sized;
  // }
  // impl Foo for () {
  //     fn test<'a, T>(x: &'a T) -> &'a T { x }
  // }
  // ```
  // .. to compile. However, since we use both the normalized and unnormalized
  // inputs and outputs from the instantiated trait signature, we will end up
  // seeing the hidden type of an RPIT in the signature itself. Naively, this
  // means that we will use the hidden type to imply the hidden type's own
  // well-formedness.
  //
  // To avoid this, we replace the infer vars used for hidden type inference
  // with placeholders, which imply nothing about outlives bounds, and then
  // prove below that the hidden types are well formed.
  const universe = infcx.create_next_universe();
  let idx = BoundVar.ZERO;
  // PORT: `FxIndexMap<Ty, Ty>` (interned keys: a `Map`).
  const mapping = new Map<Ty, Ty>();
  for (const [_, [ty, _args]] of collector.types) {
    if (!(infcx.deeply_resolve_ignoring_regions(ty, fold_Ty) === ty && ty.is_ty_var())) {
      panic(`${format_debug(infcx.deeply_resolve_ignoring_regions(ty, fold_Ty), debug_Ty, PLAIN)} should not have been constrained via normalization`);
    }
    // `idx += 1` (`BoundVar: AddAssign<usize>`)
    idx = BoundVar.from_usize(BoundVar.as_usize(idx) + 1);
    mapping.set(ty, Ty.new_placeholder(tcx, PlaceholderType.new(universe, { var: idx, kind: BoundTyKind.Anon })));
  }
  const type_mapper = new BottomUpFolder(
    tcx,
    (ty) => mapping.get(ty) ?? ty,
    (lt) => lt,
    (ct) => ct,
  );
  // PORT: `FxIndexSet<Ty>` (interned keys: a `Set`).
  const wf_tys = new Set<Ty>([...unnormalized_trait_sig.inputs_and_output, ...trait_sig.inputs_and_output].map((ty) => fold_Ty.fold_with(ty, type_mapper)));

  {
    const res = ocx.eq(cause, param_env, trait_return_ty, impl_return_ty, rustc_infer.infer.at.ToTrace_Ty);
    if (res.$ === "Err") {
      const terr = res._0;
      const diag = struct_span_code_err(tcx.dcx(), cause.span, E0053, `method \`${display_Symbol(AssocItem.name(trait_m))}\` has an incompatible return type for trait`);
      const node = tcx.hir_get_if_local(impl_m.def_id);
      const decl = node === undefined ? undefined : Node.fn_decl(node);
      err_ctxt(infcx).note_type_err(
        diag,
        cause,
        decl === undefined ? undefined : [FnRetTy.span(decl.output), "return type in trait", false],
        param_env.and<ValuePairs>({ $: "Terms", _0: { expected: trait_return_ty, found: impl_return_ty } }),
        terr,
        false,
        undefined,
      );
      return Err(diag.emit_err());
    }
  }

  // debug!(?trait_sig, ?impl_sig, "equating function signatures");

  // Unify the whole function signature. We need to do this to fully infer
  // the lifetimes of the return type, but do this after unifying just the
  // return types, since we want to avoid duplicating errors from
  // `compare_method_clause_entailment`.
  {
    const res = ocx.eq(cause, param_env, trait_sig, impl_sig, rustc_infer.infer.at.ToTrace_FnSig);
    if (res.$ === "Err") {
      const terr = res._0;
      // This function gets called during `compare_method_clause_entailment` when normalizing a
      // signature that contains RPITIT. When the method signatures don't match, we have to
      // emit an error now because `compare_method_clause_entailment` will not report the error
      // when normalization fails.
      const emitted = report_trait_method_mismatch(infcx, cause, param_env, terr, [trait_m, trait_sig], [impl_m, impl_sig], impl_trait_ref);
      return Err(emitted);
    }
  }

  if (!TypeVisitableExt.references_error(FnSig.output(unnormalized_trait_sig), fold_Ty) && collector.types.size === 0) {
    tcx.dcx().delayed_bug("expect >0 RPITITs in call to `collect_return_position_impl_trait_in_trait_tys`");
  }

  // FIXME: This has the same issue as #108544, but since this isn't breaking
  // existing code, I'm not particularly inclined to do the same hack as above
  // where we process wf obligations manually. This can be fixed in a forward-
  // compatible way later.
  const collected_types = collector.types;
  for (const [_, [ty, _args]] of collected_types) {
    ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, clone_ObligationCause(misc_cause), param_env, { $: "WellFormed", _0: ty }, upcast_tcx(Predicate_upcast_from_ClauseKind)));
  }

  // Check that all obligations are satisfied by the implementation's
  // RPITs.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const r = try_report_async_mismatch(tcx, infcx, errors._0, trait_m, impl_m, impl_sig);
    if (r.$ === "Err") {
      return Err(r._0);
    }

    const guar = err_ctxt(infcx).report_fulfillment_errors(errors._0);
    return Err(guar);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  const rr = ocx.resolve_regions_and_report_errors(impl_m_def_id, param_env, wf_tys);
  if (rr.$ === "Err") return rr;

  const remapped_types = new DefIdMap<EarlyBinder<Ty>>();
  for (const [def_id, [ty_, args]] of collected_types) {
    const resolved = infcx.deeply_resolve_via_region_graph(ty_, fold_Ty);
    switch (resolved.$) {
      case "Ok": {
        let ty = resolved._0;
        // `ty` contains free regions that we created earlier while liberating the
        // trait fn signature. However, projection normalization expects `ty` to
        // contains `def_id`'s early-bound regions.
        const id_args = RawList.identity_for_item(tcx, def_id);
        // debug!(?id_args, ?args);
        // PORT: `FxIndexMap<Region, Region>` (interned keys: a `Map`).
        const map = new Map<Region, Region>();
        const skip = (tcx.generics_of(trait_m.def_id) as Generics).count();
        // `std::iter::zip(args, id_args).skip(n).filter_map(..)`
        for (let i = skip; i < Math.min(args.length, id_args.length); i++) {
          const a = GenericArg.as_region(args[i]!);
          if (a === undefined) continue;
          const b = GenericArg.as_region(id_args[i]!);
          if (b === undefined) continue;
          map.set(a, b);
        }
        // debug!(?map);

        // NOTE(compiler-errors): RPITITs, like all other RPITs, have early-bound
        // region args that are synthesized during AST lowering. These are args
        // that are appended to the parent args (trait and trait method). However,
        // we're trying to infer the uninstantiated type value of the RPITIT inside
        // the *impl*, so we can later use the impl's method args to normalize
        // an RPITIT to a concrete type (`confirm_impl_trait_in_trait_candidate`).
        //
        // Due to the design of RPITITs, during AST lowering, we have no idea that
        // an impl method corresponds to a trait method with RPITITs in it. Therefore,
        // we don't have a list of early-bound region args for the RPITIT in the impl.
        // Since early region parameters are index-based, we can't just rebase these
        // (trait method) early-bound region args onto the impl, and there's no
        // guarantee that the indices from the trait args and impl args line up.
        // So to fix this, we subtract the number of trait args and add the number of
        // impl args to *renumber* these early-bound regions to their corresponding
        // indices in the impl's generic parameters list.
        //
        // Also, we only need to account for a difference in trait and impl args,
        // since we previously enforce that the trait method and impl method have the
        // same generics.
        const num_trait_args = impl_trait_ref.args.length;
        const num_impl_args = (tcx.generics_of(AssocItem.container_id(impl_m, tcx)) as Generics).own_params.length;
        const folded = fold_Ty.try_fold_with(ty, new RemapHiddenTyRegions(tcx, map, num_trait_args, num_impl_args, def_id, impl_m.def_id, ty, return_span));
        switch (folded.$) {
          case "Ok":
            ty = folded._0;
            break;
          case "Err":
            ty = Ty.new_error(tcx, folded._0);
            break;
        }
        remapped_types.set(def_id, EarlyBinder.bind(tcx, ty, fold_Ty));
        break;
      }
      case "Err": {
        const err = resolved._0;
        // This code path is not reached in any tests, but may be
        // reachable. If this is triggered, it should be converted to
        // `span_delayed_bug` and the triggering case turned into a
        // test.
        tcx.dcx().span_bug(return_span, `could not fully resolve: ${display_Ty(ty_)} => ${format_debug(err, rustc_infer.infer.debug_FixupError, PLAIN)}`);
      }
    }
  }

  // We may not collect all RPITITs that we see in the HIR for a trait signature
  // because an RPITIT was located within a missing item. Like if we have a sig
  // returning `-> Missing<impl Sized>`, that gets converted to `-> {type error}`,
  // and when walking through the signature we end up never collecting the def id
  // of the `impl Sized`. Insert that here, so we don't ICE later.
  for (const assoc_item of tcx.associated_types_for_impl_traits_in_associated_fn(trait_m.def_id)) {
    if (!remapped_types.has(assoc_item)) {
      remapped_types.set(assoc_item, EarlyBinder.bind(tcx, Ty.new_error_with_message(tcx, MultiSpan.from_span(return_span), "missing synthetic item for RPITIT"), fold_Ty));
    }
  }

  return Ok(remapped_types);
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:796 ImplTraitInTraitCollector
class ImplTraitInTraitCollector<E> implements TypeFolder {
  constructor(
    public ocx: ObligationCtxt<E>,
    /** PORT: `FxIndexMap<DefId, (Ty, GenericArgsRef)>`: a `DefIdMap` (insertion-ordered). */
    public types: DefIdMap<[Ty, GenericArgs]>,
    public span: Span,
    public param_env: ParamEnv,
    public impl_m_id: LocalDefId,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:809 new
  static new<E>(ocx: ObligationCtxt<E>, span: Span, param_env: ParamEnv, impl_m_id: LocalDefId): ImplTraitInTraitCollector<E> {
    return new ImplTraitInTraitCollector<E>(ocx, new DefIdMap(), span, param_env, impl_m_id);
  }

  // ---- impl<'tcx, E> TypeFolder<TyCtxt<'tcx>> for ImplTraitInTraitCollector<'_, 'tcx, E> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:824 cx
  cx(): TyCtxt {
    return this.ocx.infcx.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:828 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && this.cx().is_impl_trait_in_trait(k._1.kind.def_id)) {
      const def_id = k._1.kind.def_id;
      const proj_args = k._1.args;
      const existing = this.types.get(def_id);
      if (existing !== undefined) {
        return existing[0];
      }
      //FIXME(RPITIT): Deny nested RPITIT in args too
      if (TypeVisitableExt.has_escaping_bound_vars(proj_args, fold_GenericArgs)) {
        bug("FIXME(RPITIT): error here");
      }
      // Replace with infer var
      const infer_ty = this.ocx.infcx.next_ty_var(this.span);
      this.types.set(def_id, [infer_ty, proj_args]);
      // Recurse into bounds
      for (const u of EarlyBinder.iter_instantiated_copied(
        this.cx().explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>,
        this.cx(),
        proj_args,
        fold_tuple2(fold_Clause, fold_Span),
      )) {
        const [pred_, pred_span] = Unnormalized.skip_norm_wip(u);
        const pred__ = fold_Clause.fold_with(pred_, this);
        const pred = this.ocx.normalize(ObligationCause.misc(this.span, this.impl_m_id), this.param_env, Unnormalized.new_wip(pred__), fold_Clause);

        this.ocx.register_obligation(
          rustc_infer.traits.Obligation.new(this.cx(), ObligationCause.new(this.span, this.impl_m_id, { $: "WhereClause", _0: def_id, _1: pred_span }), this.param_env, pred, upcast_tcx(Predicate_upcast_from_Clause)),
        );
      }
      return infer_ty;
    } else {
      return fold_Ty.super_fold_with(ty, this);
    }
  }

  // PORT: the provided `TypeFolder` methods (PORTING §8).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:875 RemapHiddenTyRegions
class RemapHiddenTyRegions implements FallibleTypeFolder<ErrorGuaranteed> {
  constructor(
    public tcx: TyCtxt,
    /// Map from early/late params of the impl to identity regions of the RPITIT (GAT)
    /// in the trait.
    public map: Map<Region, Region>,
    public num_trait_args: number,
    public num_impl_args: number,
    /// Def id of the RPITIT (GAT) in the *trait*.
    public def_id: DefId,
    /// Def id of the impl method which owns the opaque hidden type we're remapping.
    public impl_m_def_id: DefId,
    /// The hidden type we're remapping. Useful for diagnostics.
    public ty: Ty,
    /// Span of the return type. Useful for diagnostics.
    public return_span: Span,
  ) {}

  // ---- impl<'tcx> ty::FallibleTypeFolder<TyCtxt<'tcx>> for RemapHiddenTyRegions<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:895 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:899 try_fold_region
  try_fold_region(region: Region): Result<Region, ErrorGuaranteed> {
    const k = region.kind();
    switch (k.$) {
      // Never remap bound regions or `'static`
      case "ReBound":
      case "ReStatic":
      case "ReError":
        return Ok(region);
      // We always remap liberated late-bound regions from the function.
      case "ReLateParam":
        break;
      // Remap early-bound regions as long as they don't come from the `impl` itself,
      // in which case we don't really need to renumber them.
      case "ReEarlyParam": {
        const ebr = k._0;
        if (ebr.index >= this.num_impl_args) {
          // Remap
        } else {
          return Ok(region);
        }
        break;
      }
      case "ReVar":
      case "RePlaceholder":
      case "ReErased":
        return unreachable("should not have leaked vars or placeholders into hidden type of RPITIT");
    }

    let e: EarlyParamRegion;
    const id_region = this.map.get(region);
    if (id_region !== undefined) {
      const ik = id_region.kind();
      if (ik.$ === "ReEarlyParam") {
        e = ik._0;
      } else {
        bug(`expected to map region ${display_Region(region)} to early-bound identity region, but got ${display_Region(id_region)}`);
      }
    } else {
      let guar: ErrorGuaranteed;
      const def_id = region.opt_param_def_id(this.tcx, this.impl_m_def_id);
      if (def_id !== undefined) {
        const tk = this.ty.kind();
        const return_span = tk.$ === "Alias" && tk._1.kind.$ === "Opaque" ? this.tcx.def_span(tk._1.kind.def_id) : this.return_span;
        guar = this.tcx
          .dcx()
          .struct_span_err(return_span, "return type captures more lifetimes than trait definition")
          .with_span_label(this.tcx.def_span(def_id), "this lifetime was captured")
          .with_span_note(this.tcx.def_span(this.def_id), "hidden type must only reference lifetimes captured by this impl trait")
          .with_note(`hidden type inferred to be \`${display_Ty(this.ty)}\``)
          .emit_err();
      } else {
        // This code path is not reached in any tests, but may be
        // reachable. If this is triggered, it should be converted
        // to `delayed_bug` and the triggering case turned into a
        // test.
        guar = this.tcx.dcx().bug("should've been able to remap region");
      }
      return Err(guar);
    }

    return Ok(Region.new_early_param(this.tcx, { name: e.name, index: e.index - this.num_trait_args + this.num_impl_args }));
  }

  // PORT: the provided `FallibleTypeFolder` methods (PORTING §8).
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, ErrorGuaranteed> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }

  try_fold_ty(t: Ty): Result<Ty, ErrorGuaranteed> {
    return FallibleTypeFolder_provided.try_fold_ty(this, t);
  }

  try_fold_const(c: Const): Result<Const, ErrorGuaranteed> {
    return FallibleTypeFolder_provided.try_fold_const(this, c);
  }

  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, ErrorGuaranteed> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, ErrorGuaranteed> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

/// Gets the string for an explicit self declaration, e.g. "self", "&self",
/// etc.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:979 get_self_string
function get_self_string(self_arg_ty: Ty, is_self_ty: (ty: Ty) => boolean): string {
  const k = self_arg_ty.kind();
  if (is_self_ty(self_arg_ty)) {
    return "self";
  } else if (k.$ === "Ref" && is_self_ty(k._1)) {
    const mutbl = k._2;
    switch (mutbl) {
      case "Not":
        return "&self";
      case "Mut":
        return "&mut self";
    }
  } else {
    return `self: ${display_Ty(self_arg_ty)}`;
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:997 report_trait_method_mismatch
function report_trait_method_mismatch(
  infcx: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  terr: TypeError,
  [trait_m, trait_sig]: [AssocItem, FnSig],
  [impl_m, impl_sig]: [AssocItem, FnSig],
  impl_trait_ref: TraitRef,
): ErrorGuaranteed {
  const tcx = infcx.tcx;
  const [impl_err_span, trait_err_span] = extract_spans_for_error_reporting(infcx, terr, cause, impl_m, trait_m);

  const diag = struct_span_code_err(tcx.dcx(), impl_err_span, E0053, `method \`${display_Symbol(AssocItem.name(trait_m))}\` has an incompatible type for trait`);
  if (((terr.$ === "ArgumentMutability" && terr._0 === 0) || (terr.$ === "ArgumentSorts" && terr._1 === 0)) && AssocItem.is_method(trait_m)) {
    const ty = FnSig.inputs(trait_sig)[0]!;
    const sugg = get_self_string(ty, (ty) => ty === TraitRef.self_ty(impl_trait_ref));

    // When the `impl` receiver is an arbitrary self type, like `self: Box<Self>`, the
    // span points only at the type `Box<Self`>, but we want to cover the whole
    // argument pattern and type.
    const [sig, body] = tcx.hir_expect_impl_item(impl_m.def_id.expect_local()).expect_fn();
    const param_idents = tcx.hir_body_param_idents(body);
    let span = impl_err_span;
    // `.zip(sig.decl.inputs.iter()).map(..).next().unwrap_or(impl_err_span)`
    if (param_idents.length > 0 && sig.decl.inputs.length > 0) {
      const param_ident = param_idents[0];
      const ty = sig.decl.inputs[0]!;
      if (param_ident !== undefined) {
        span = Span.to(param_ident.span, ty.span);
      } else {
        span = ty.span;
      }
    }

    diag.span_suggestion_verbose(span, "change the self-receiver type to match the trait", sugg, Applicability.MachineApplicable);
  } else if (terr.$ === "ArgumentMutability" || terr.$ === "ArgumentSorts") {
    const i = terr.$ === "ArgumentMutability" ? terr._0 : terr._1;
    if (FnSig.inputs(trait_sig).length === i) {
      // Suggestion to change output type. We do not suggest in `async` functions
      // to avoid complex logic or incorrect output.
      const kind = tcx.hir_expect_impl_item(impl_m.def_id.expect_local()).kind;
      if (kind.$ === "Fn" && !IsAsync.is_async(kind._0.header.asyncness)) {
        const sig = kind._0;
        const msg = "change the output type to match the trait";
        const ap = Applicability.MachineApplicable;
        const output = sig.decl.output;
        switch (output.$) {
          case "DefaultReturn": {
            const sp = output._0;
            const sugg = ` -> ${display_Ty(FnSig.output(trait_sig))}`;
            diag.span_suggestion_verbose(sp, msg, sugg, ap);
            break;
          }
          case "Return": {
            const hir_ty = output._0;
            const sugg = FnSig.output(trait_sig);
            diag.span_suggestion_verbose(hir_ty.span, msg, display_Ty(sugg), ap);
            break;
          }
        }
      }
    } else {
      const trait_ty = FnSig.inputs(trait_sig)[i];
      if (trait_ty !== undefined) {
        with_crate_prefix(() => diag.span_suggestion_verbose(impl_err_span, "change the parameter type to match the trait", display_Ty(trait_ty), Applicability.MachineApplicable));
      }
    }
  }

  cause.span = impl_err_span;
  err_ctxt(infcx).note_type_err(
    diag,
    cause,
    trait_err_span === undefined ? undefined : [trait_err_span, "type in trait", false],
    param_env.and<ValuePairs>({ $: "PolySigs", _0: { expected: Binder.dummy(trait_sig, fold_FnSig), found: Binder.dummy(impl_sig, fold_FnSig) } }),
    terr,
    false,
    undefined,
  );

  return diag.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1098 check_region_bounds_on_impl_item
function check_region_bounds_on_impl_item(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, delay: boolean): Result<null, ErrorGuaranteed> {
  const impl_generics = tcx.generics_of(impl_m.def_id) as Generics;
  const impl_params = impl_generics.own_counts().lifetimes;

  const trait_generics = tcx.generics_of(trait_m.def_id) as Generics;
  const trait_params = trait_generics.own_counts().lifetimes;

  const res = check_number_of_early_bound_regions(tcx, impl_m.def_id.expect_local(), trait_m.def_id, impl_generics, impl_params, trait_generics, trait_params);
  if (res.$ !== "Err") {
    return Ok(null);
  }
  const { span, generics_span, bounds_span, where_span } = res._0;

  if (!delay) {
    const guar = check_region_late_boundedness(tcx, impl_m, trait_m);
    if (guar !== undefined) {
      return Err(guar);
    }
  }

  const reported = tcx
    .dcx()
    .create_err(
      LifetimesOrBoundsMismatchOnTrait_diagnostic({
        span,
        item_kind: AssocItem.descr(impl_m),
        ident: AssocItem.ident(impl_m, tcx),
        generics_span,
        bounds_span,
        where_span,
      }),
    )
    .emit_err_unless_delay(delay);

  return Err(reported);
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1143 CheckNumberOfEarlyBoundRegionsError
export interface CheckNumberOfEarlyBoundRegionsError {
  span: Span;
  generics_span: Span;
  bounds_span: Span[];
  where_span: Span | undefined;
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1150 check_number_of_early_bound_regions
export function check_number_of_early_bound_regions(
  tcx: TyCtxt,
  impl_def_id: LocalDefId,
  trait_def_id: DefId,
  impl_generics: Generics,
  impl_params: number,
  trait_generics: Generics,
  trait_params: number,
): Result<null, CheckNumberOfEarlyBoundRegionsError> {
  // debug!(?trait_generics, ?impl_generics);
  void impl_generics;
  void trait_generics;

  // Must have same number of early-bound lifetime parameters.
  // Unfortunately, if the user screws up the bounds, then this
  // will change classification between early and late. E.g.,
  // if in trait we have `<'a,'b:'a>`, and in impl we just have
  // `<'a,'b>`, then we have 2 early-bound lifetime parameters
  // in trait but 0 in the impl. But if we report "expected 2
  // but found 0" it's confusing, because it looks like there
  // are zero. Since I don't quite know how to phrase things at
  // the moment, give a kind of vague error message.
  if (trait_params === impl_params) {
    return Ok(null);
  }

  const span = unwrap(tcx.hir_get_generics(impl_def_id), "expected impl item to have generics or else we can't compare them").span;

  let generics_span = tcx.def_span(trait_def_id);
  let bounds_span: Span[] = [];
  let where_span: Span | undefined = undefined;

  const trait_node = tcx.hir_get_if_local(trait_def_id);
  const trait_generics_ = trait_node === undefined ? undefined : Node.generics(trait_node);
  if (trait_generics_ !== undefined) {
    generics_span = trait_generics_.span;
    // FIXME: we could potentially look at the impl's bounds to not point at bounds that
    // *are* present in the impl.
    for (const p of trait_generics_.predicates) {
      switch (p.kind.$) {
        case "BoundPredicate":
        case "RegionPredicate": {
          const bounds = p.kind._0.bounds;
          for (const b of bounds) {
            if (b.$ === "Outlives") {
              const lt = b._0;
              bounds_span.push(lt.ident.span);
            }
          }
          break;
        }
      }
    }
    const impl_node = tcx.hir_get_if_local(LocalDefId.to_def_id(impl_def_id));
    const impl_generics_ = impl_node === undefined ? undefined : Node.generics(impl_node);
    if (impl_generics_ !== undefined) {
      let impl_bounds = 0;
      for (const p of impl_generics_.predicates) {
        switch (p.kind.$) {
          case "BoundPredicate":
          case "RegionPredicate": {
            const bounds = p.kind._0.bounds;
            for (const b of bounds) {
              if (b.$ === "Outlives") {
                impl_bounds += 1;
              }
            }
            break;
          }
        }
      }
      if (impl_bounds === bounds_span.length) {
        bounds_span = [];
      } else if (impl_generics_.has_where_clause_predicates) {
        where_span = impl_generics_.where_clause_span;
      }
    }
  }

  return Err({ span, generics_span, bounds_span, where_span });
}

// #[allow(unused)]
// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1241 LateEarlyMismatch
type LateEarlyMismatch =
  | { readonly $: "EarlyInImpl"; _0: DefId; _1: DefId; _2: Region }
  | { readonly $: "LateInImpl"; _0: DefId; _1: DefId; _2: Region };

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1246 check_region_late_boundedness
function check_region_late_boundedness(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem): ErrorGuaranteed | undefined {
  if (!AssocItem.is_fn(impl_m)) {
    return undefined;
  }

  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(TypingEnv.non_body_analysis(tcx, impl_m.def_id));

  const impl_m_args = infcx.fresh_args_for_item(DUMMY_SP, impl_m.def_id);
  const impl_m_sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig_of(tcx, impl_m.def_id), tcx, impl_m_args, fold_Binder(fold_FnSig)));
  const impl_m_sig = tcx.liberate_late_bound_regions(impl_m.def_id, impl_m_sig_, fold_FnSig);

  const trait_m_args = infcx.fresh_args_for_item(DUMMY_SP, trait_m.def_id);
  const trait_m_sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig_of(tcx, trait_m.def_id), tcx, trait_m_args, fold_Binder(fold_FnSig)));
  const trait_m_sig = tcx.liberate_late_bound_regions(impl_m.def_id, trait_m_sig_, fold_FnSig);

  const ocx = ObligationCtxt.new(infcx);

  // Equate the signatures so that we can infer whether a late-bound param was present where
  // an early-bound param was expected, since we replace the late-bound lifetimes with
  // `ReLateParam`, and early-bound lifetimes with infer vars, so the early-bound args will
  // resolve to `ReLateParam` if there is a mismatch.
  const eq = ocx.eq(ObligationCause.dummy(), param_env, Binder.dummy(trait_m_sig, fold_FnSig), Binder.dummy(impl_m_sig, fold_FnSig), rustc_infer.infer.at.ToTrace_PolyFnSig);
  if (eq.$ !== "Ok") {
    return undefined;
  }

  const errors = ocx.try_evaluate_obligations();
  if (!rustc_infer.traits.TraitErrors.no_errors(errors)) {
    return undefined;
  }

  const mismatched: LateEarlyMismatch[] = [];

  const impl_generics = tcx.generics_of(impl_m.def_id) as Generics;
  {
    const id_args = RawList.identity_for_item(tcx, impl_m.def_id);
    for (let i = 0; i < Math.min(id_args.length, impl_m_args.length); i++) {
      const id_arg = id_args[i]!;
      const ak = GenericArg.kind(impl_m_args[i]!);
      if (ak.$ !== "Lifetime") continue;
      const rk = ak._0.kind();
      if (rk.$ !== "ReVar") continue;
      const vid = rk._0;
      const r = infcx.inner.unwrap_region_constraints().shallow_resolve_region_var(tcx, vid);
      const r_k = r.kind();
      if (!(r_k.$ === "ReLateParam" && r_k._0.kind.$ === "Named")) continue;
      const trait_param_def_id = r_k._0.kind._0;
      const ik = GenericArg.expect_region(id_arg).kind();
      if (ik.$ !== "ReEarlyParam") continue;
      const ebr = ik._0;
      mismatched.push({ $: "EarlyInImpl", _0: impl_generics.region_param(ebr, tcx).def_id, _1: trait_param_def_id, _2: GenericArg.expect_region(id_arg) });
    }
  }

  const trait_generics = tcx.generics_of(trait_m.def_id) as Generics;
  {
    const id_args = RawList.identity_for_item(tcx, trait_m.def_id);
    for (let i = 0; i < Math.min(id_args.length, trait_m_args.length); i++) {
      const id_arg = id_args[i]!;
      const ak = GenericArg.kind(trait_m_args[i]!);
      if (ak.$ !== "Lifetime") continue;
      const rk = ak._0.kind();
      if (rk.$ !== "ReVar") continue;
      const vid = rk._0;
      const r = infcx.inner.unwrap_region_constraints().shallow_resolve_region_var(tcx, vid);
      const r_k = r.kind();
      if (!(r_k.$ === "ReLateParam" && r_k._0.kind.$ === "Named")) continue;
      const impl_param_def_id = r_k._0.kind._0;
      const ik = GenericArg.expect_region(id_arg).kind();
      if (ik.$ !== "ReEarlyParam") continue;
      const ebr = ik._0;
      mismatched.push({ $: "LateInImpl", _0: impl_param_def_id, _1: trait_generics.region_param(ebr, tcx).def_id, _2: GenericArg.expect_region(id_arg) });
    }
  }

  if (mismatched.length === 0) {
    return undefined;
  }

  const spans: Span[] = mismatched.map((param) => {
    const impl_param_def_id = param._0;
    return tcx.def_span(impl_param_def_id);
  });

  const diag = tcx.dcx().struct_span_err(spans, "lifetime parameters do not match the trait definition").with_note("lifetime parameters differ in whether they are early- or late-bound").with_code(E0195);
  for (const mismatch of mismatched) {
    switch (mismatch.$) {
      case "EarlyInImpl": {
        const impl_param_def_id = mismatch._0;
        const trait_param_def_id = mismatch._1;
        const early_bound_region = mismatch._2;
        const multispan = MultiSpan.from_spans([tcx.def_span(impl_param_def_id), tcx.def_span(trait_param_def_id)]);
        multispan.push_span_label(tcx.def_span(tcx.parent(impl_m.def_id)), "in this impl...");
        multispan.push_span_label(tcx.def_span(tcx.parent(trait_m.def_id)), "in this trait...");
        multispan.push_span_label(tcx.def_span(impl_param_def_id), `\`${display_Symbol(tcx.item_name(impl_param_def_id))}\` is early-bound`);
        multispan.push_span_label(tcx.def_span(trait_param_def_id), `\`${display_Symbol(tcx.item_name(trait_param_def_id))}\` is late-bound`);
        const span = find_region_in_clauses(tcx, impl_m.def_id, early_bound_region);
        if (span !== undefined) {
          multispan.push_span_label(span, `this lifetime bound makes \`${display_Symbol(tcx.item_name(impl_param_def_id))}\` early-bound`);
        }
        diag.span_note(multispan, `\`${display_Symbol(tcx.item_name(impl_param_def_id))}\` differs between the trait and impl`);
        break;
      }
      case "LateInImpl": {
        const impl_param_def_id = mismatch._0;
        const trait_param_def_id = mismatch._1;
        const early_bound_region = mismatch._2;
        const multispan = MultiSpan.from_spans([tcx.def_span(impl_param_def_id), tcx.def_span(trait_param_def_id)]);
        multispan.push_span_label(tcx.def_span(tcx.parent(impl_m.def_id)), "in this impl...");
        multispan.push_span_label(tcx.def_span(tcx.parent(trait_m.def_id)), "in this trait...");
        multispan.push_span_label(tcx.def_span(impl_param_def_id), `\`${display_Symbol(tcx.item_name(impl_param_def_id))}\` is late-bound`);
        multispan.push_span_label(tcx.def_span(trait_param_def_id), `\`${display_Symbol(tcx.item_name(trait_param_def_id))}\` is early-bound`);
        const span = find_region_in_clauses(tcx, trait_m.def_id, early_bound_region);
        if (span !== undefined) {
          multispan.push_span_label(span, `this lifetime bound makes \`${display_Symbol(tcx.item_name(trait_param_def_id))}\` early-bound`);
        }
        diag.span_note(multispan, `\`${display_Symbol(tcx.item_name(impl_param_def_id))}\` differs between the trait and impl`);
        break;
      }
    }
  }

  return diag.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1442 find_region_in_clauses
function find_region_in_clauses(tcx: TyCtxt, def_id: DefId, early_bound_region: Region): Span | undefined {
  // PORT: the item `struct FindRegion` (declared after the loop upstream) is declared first: a JS class is not hoisted.
  // rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1453 FindRegion
  class FindRegion implements TypeVisitor<ControlFlow<null>> {
    // type Result = ControlFlow<()>;
    readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();
    constructor(public _0: Region) {}

    // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1456 visit_region
    visit_region(r: Region): ControlFlow<null> {
      if (r === this._0) {
        return ControlFlow.Break(null);
      } else {
        return ControlFlow.CONTINUE;
      }
    }

    // PORT: the provided `TypeVisitor` methods (PORTING §8).
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }

    visit_ty(t: Ty): ControlFlow<null> {
      return TypeVisitor_provided.visit_ty(this, t);
    }

    visit_const(c: Const): ControlFlow<null> {
      return TypeVisitor_provided.visit_const(this, c);
    }

    visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
      return TypeVisitor_provided.visit_predicate(this, p, d);
    }

    visit_clauses(c: Clauses): ControlFlow<null> {
      return TypeVisitor_provided.visit_clauses(this, c);
    }

    visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
      return TypeVisitor_provided.visit_error(this, guar);
    }
  }

  for (const [clause, span] of GenericClauses.instantiate_identity(tcx.explicit_clauses_of(def_id) as GenericClauses, tcx)) {
    if (fold_Clause.visit_with(Unnormalized.skip_norm_wip(clause), new FindRegion(early_bound_region)).$ === "Break") {
      return span;
    }
  }

  return undefined;
}

// #[instrument(level = "debug", skip(infcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1465 extract_spans_for_error_reporting
function extract_spans_for_error_reporting(infcx: InferCtxt, terr: TypeError, cause: ObligationCause, impl_m: AssocItem, trait_m: AssocItem): [Span, Span | undefined] {
  const tcx = infcx.tcx;
  // PORT: the lazy `inputs.map(span).chain(once(output.span()))` iterators are arrays (no side effects).
  const impl_args = (() => {
    const [sig, _] = tcx.hir_expect_impl_item(impl_m.def_id.expect_local()).expect_fn();
    return [...sig.decl.inputs.map((t) => t.span), FnRetTy.span(sig.decl.output)];
  })();

  const trait_def_id = trait_m.def_id.as_local();
  const trait_args =
    trait_def_id === undefined
      ? undefined
      : (() => {
          const [sig, _] = tcx.hir_expect_trait_item(trait_def_id).expect_fn();
          return [...sig.decl.inputs.map((t) => t.span), FnRetTy.span(sig.decl.output)];
        })();

  switch (terr.$) {
    case "ArgumentMutability":
    case "ArgumentSorts": {
      const i = terr.$ === "ArgumentMutability" ? terr._0 : terr._1;
      return [unwrap(impl_args[i]), trait_args === undefined ? undefined : trait_args[i]];
    }
    default:
      return [cause.span, tcx.hir_span_if_local(trait_m.def_id)];
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1491 compare_self_type
function compare_self_type(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, impl_trait_ref: TraitRef, delay: boolean): Result<null, ErrorGuaranteed> {
  // Try to give more informative error messages about self typing
  // mismatches. Note that any mismatch will also be detected
  // below, where we construct a canonical function type that
  // includes the self parameter as a normal parameter. It's just
  // that the error messages you get out of this code are a bit more
  // inscrutable, particularly for cases where one method has no
  // self.

  const self_string = (method: AssocItem): string => {
    let untransformed_self_ty: Ty;
    switch (method.container.$) {
      case "InherentImpl":
      case "TraitImpl":
        untransformed_self_ty = TraitRef.self_ty(impl_trait_ref);
        break;
      case "Trait":
        untransformed_self_ty = tcx.types.self_param;
        break;
    }
    const self_arg_ty_ = PolyFnSig.input(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(fn_sig_of(tcx, method.def_id))), 0);
    const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(TypingEnv.non_body_analysis(tcx, method.def_id));
    const self_arg_ty = tcx.liberate_late_bound_regions(method.def_id, self_arg_ty_, fold_Ty);
    const can_eq_self = (ty: Ty): boolean => infcx.can_eq(param_env, untransformed_self_ty, ty, rustc_infer.infer.at.ToTrace_Ty);
    return get_self_string(self_arg_ty, can_eq_self);
  };

  const t = AssocItem.is_method(trait_m);
  const i = AssocItem.is_method(impl_m);
  if ((!t && !i) || (t && i)) {
    // {}
  } else if (!t && i) {
    const self_descr = self_string(impl_m);
    const impl_m_span = tcx.def_span(impl_m.def_id);
    const err = struct_span_code_err(
      tcx.dcx(),
      impl_m_span,
      E0185,
      `method \`${display_Symbol(AssocItem.name(trait_m))}\` has a \`${self_descr}\` declaration in the impl, but not in the trait`,
    );
    err.span_label(impl_m_span, `\`${self_descr}\` used in impl`);
    const span = tcx.hir_span_if_local(trait_m.def_id);
    if (span !== undefined) {
      err.span_label(span, `trait method declared without \`${self_descr}\``);
    } else {
      err.note_trait_signature(display_Symbol(AssocItem.name(trait_m)), AssocItem.signature(trait_m, tcx));
    }
    return Err(err.emit_err_unless_delay(delay));
  } else {
    // (true, false)
    const self_descr = self_string(trait_m);
    const impl_m_span = tcx.def_span(impl_m.def_id);
    const err = struct_span_code_err(
      tcx.dcx(),
      impl_m_span,
      E0186,
      `method \`${display_Symbol(AssocItem.name(trait_m))}\` has a \`${self_descr}\` declaration in the trait, but not in the impl`,
    );
    err.span_label(impl_m_span, `expected \`${self_descr}\` in impl`);
    const span = tcx.hir_span_if_local(trait_m.def_id);
    if (span !== undefined) {
      err.span_label(span, `\`${self_descr}\` used in trait`);
    } else {
      err.note_trait_signature(display_Symbol(AssocItem.name(trait_m)), AssocItem.signature(trait_m, tcx));
    }

    return Err(err.emit_err_unless_delay(delay));
  }

  return Ok(null);
}

/// Checks that the number of generics on a given assoc item in a trait impl is the same
/// as the number of generics on the respective assoc item in the trait definition.
///
/// For example this code emits the errors in the following code:
/// ```rust,compile_fail
/// trait Trait {
///     fn foo();
///     type Assoc<T>;
/// }
///
/// impl Trait for () {
///     fn foo<T>() {}
///     //~^ error
///     type Assoc = u32;
///     //~^ error
/// }
/// ```
///
/// Notably this does not error on `foo<T>` implemented as `foo<const N: u8>` or
/// `foo<const N: u8>` implemented as `foo<const N: u32>`. This is handled in
/// [`compare_generic_param_kinds`]. This function also does not handle lifetime parameters
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1591 compare_number_of_generics
function compare_number_of_generics(tcx: TyCtxt, impl_: AssocItem, trait_: AssocItem, delay: boolean): Result<null, ErrorGuaranteed> {
  const trait_own_counts = (tcx.generics_of(trait_.def_id) as Generics).own_counts();
  const impl_own_counts = (tcx.generics_of(impl_.def_id) as Generics).own_counts();

  // This avoids us erroring on `foo<T>` implemented as `foo<const N: u8>` as this is implemented
  // in `compare_generic_param_kinds` which will give a nicer error message than something like:
  // "expected 1 type parameter, found 0 type parameters"
  if (trait_own_counts.types + trait_own_counts.consts === impl_own_counts.types + impl_own_counts.consts) {
    return Ok(null);
  }

  // We never need to emit a separate error for RPITITs, since if an RPITIT
  // has mismatched type or const generic arguments, then the method that it's
  // inheriting the generics from will also have mismatched arguments, and
  // we'll report an error for that instead. Delay a bug for safety, though.
  if (AssocItem.is_impl_trait_in_trait(trait_)) {
    // FIXME: no tests trigger this. If you find example code that does
    // trigger this, please add it to the test suite.
    tcx.dcx().bug("errors comparing numbers of generics of trait/impl functions were not emitted");
  }

  const matchings: [string, number, number][] = [
    ["type", trait_own_counts.types, impl_own_counts.types],
    ["const", trait_own_counts.consts, impl_own_counts.consts],
  ];

  const item_kind = AssocItem.descr(impl_);

  let err_occurred: ErrorGuaranteed | undefined = undefined;
  for (const [kind, trait_count, impl_count] of matchings) {
    if (impl_count !== trait_count) {
      const arg_spans = (item: AssocItem, generics: hir.Generics): Span[] => {
        let spans = generics.params
          .filter((p) => {
            if (p.kind.$ === "Lifetime" && p.kind.kind.$ === "Elided") {
              // A fn can have an arbitrary number of extra elided lifetimes for the
              // same signature.
              return !AssocItem.is_fn(item);
            }
            return true;
          })
          .map((p) => p.span);
        if (spans.length === 0) {
          spans = [generics.span];
        }
        return spans;
      };
      let trait_spans: Span[] | undefined;
      let impl_trait_spans: Span[];
      const def_id = trait_.def_id.as_local();
      if (def_id !== undefined) {
        const trait_item = tcx.hir_expect_trait_item(def_id);
        const arg_spans_: Span[] = arg_spans(trait_, trait_item.generics);
        const impl_trait_spans_: Span[] = [];
        for (const p of trait_item.generics.params) {
          if (p.kind.$ === "Type" && p.kind.synthetic === true) impl_trait_spans_.push(p.span);
        }
        [trait_spans, impl_trait_spans] = [arg_spans_, impl_trait_spans_];
      } else {
        const trait_span = tcx.hir_span_if_local(trait_.def_id);
        [trait_spans, impl_trait_spans] = [trait_span === undefined ? undefined : [trait_span], []];
      }

      const impl_item = tcx.hir_expect_impl_item(impl_.def_id.expect_local());
      const impl_item_impl_trait_spans: Span[] = [];
      for (const p of impl_item.generics.params) {
        if (p.kind.$ === "Type" && p.kind.synthetic === true) impl_item_impl_trait_spans.push(p.span);
      }
      const spans = arg_spans(impl_, impl_item.generics);
      const span = spans[0];

      const err = tcx
        .dcx()
        .struct_span_err(
          spans,
          `${item_kind} \`${display_Symbol(AssocItem.name(trait_))}\` has ${impl_count} ${kind} parameter${pluralize(impl_count)} but its trait declaration has ${trait_count} ${kind} parameter${pluralize(trait_count)}`,
        );
      err.code(E0049);

      const msg = `expected ${trait_count} ${kind} parameter${pluralize(trait_count)}`;
      if (trait_spans !== undefined) {
        const spans = trait_spans;
        if (spans.length > 0) {
          err.span_label(spans[0]!, msg);
        }
        for (const span of spans.slice(1)) {
          err.span_label(span, "");
        }
      } else {
        err.span_label(tcx.def_span(trait_.def_id), msg);
      }

      if (span !== undefined) {
        err.span_label(span, `found ${impl_count} ${kind} parameter${pluralize(impl_count)}`);
      }

      for (const span of [...impl_trait_spans, ...impl_item_impl_trait_spans]) {
        err.span_label(span, "`impl Trait` introduces an implicit type parameter");
      }

      const guar = err.emit_err_unless_delay(delay);
      err_occurred = guar;
    }
  }

  if (err_occurred !== undefined) {
    return Err(err_occurred);
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1731 compare_number_of_method_arguments
function compare_number_of_method_arguments(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, delay: boolean): Result<null, ErrorGuaranteed> {
  const impl_m_fty = fn_sig_of(tcx, impl_m.def_id);
  const trait_m_fty = fn_sig_of(tcx, trait_m.def_id);
  const trait_number_args = Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(trait_m_fty))).length;
  const impl_number_args = Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(impl_m_fty))).length;

  if (trait_number_args !== impl_number_args) {
    let trait_span: Span | undefined = undefined;
    const trait_m_local = trait_m.def_id.as_local();
    if (trait_m_local !== undefined) {
      const [trait_m_sig, _] = tcx.hir_expect_trait_item(trait_m_local).expect_fn();
      const pos = saturating_sub(trait_number_args, 1);
      const arg = trait_m_sig.decl.inputs[pos];
      if (arg !== undefined) {
        if (pos === 0) {
          trait_span = arg.span;
        } else {
          trait_span = Span.with_lo(arg.span, Span.lo(trait_m_sig.decl.inputs[0]!.span));
        }
      }
    }
    if (trait_span === undefined) {
      trait_span = tcx.hir_span_if_local(trait_m.def_id);
    }

    const [impl_m_sig, _] = tcx.hir_expect_impl_item(impl_m.def_id.expect_local()).expect_fn();
    const pos = saturating_sub(impl_number_args, 1);
    const impl_arg = impl_m_sig.decl.inputs[pos];
    let impl_span: Span;
    if (impl_arg !== undefined) {
      if (pos === 0) {
        impl_span = impl_arg.span;
      } else {
        impl_span = Span.with_lo(impl_arg.span, Span.lo(impl_m_sig.decl.inputs[0]!.span));
      }
    } else {
      impl_span = tcx.def_span(impl_m.def_id);
    }

    const err = struct_span_code_err(
      tcx.dcx(),
      impl_span,
      E0050,
      `method \`${display_Symbol(AssocItem.name(trait_m))}\` has ${potentially_plural_count(impl_number_args, "parameter")} but the declaration in trait \`${tcx.def_path_str(trait_m.def_id)}\` has ${trait_number_args}`,
    );

    if (trait_span !== undefined) {
      err.span_label(trait_span, `trait requires ${potentially_plural_count(trait_number_args, "parameter")}`);
    } else {
      err.note_trait_signature(display_Symbol(AssocItem.name(trait_m)), AssocItem.signature(trait_m, tcx));
    }

    err.span_label(impl_span, `expected ${potentially_plural_count(trait_number_args, "parameter")}, found ${impl_number_args}`);

    // Only emit verbose suggestions when the trait span isn’t local (e.g., cross-crate).
    if (!trait_m.def_id.is_local()) {
      const trait_sig = fn_sig_of(tcx, trait_m.def_id);
      const trait_arg_idents = tcx.fn_arg_idents(trait_m.def_id);
      const sm = tcx.sess.source_map();
      // Find the span of the space between the parentheses in a method.
      // fn foo(...) {}
      //        ^^^
      let impl_inputs_span: Span | undefined;
      const first = impl_m_sig.decl.inputs[0];
      const last = impl_m_sig.decl.inputs[impl_m_sig.decl.inputs.length - 1];
      if (first !== undefined && last !== undefined) {
        // We have inputs; construct the span from those.
        // fn foo( a: i32, b: u32 ) {}
        //        ^^^^^^^^^^^^^^^^
        const arg_idents = tcx.fn_arg_idents(impl_m.def_id);
        const id0 = arg_idents[0];
        const first_lo = id0 !== undefined ? Span.lo(id0.span) : Span.lo(first.span);
        impl_inputs_span = Span.with_hi(Span.with_lo(impl_m_sig.span, first_lo), Span.hi(last.span));
      } else {
        // We have no inputs; construct the span to the left of the last parenthesis
        // fn foo( ) {}
        //        ^
        // FIXME: Keep spans for function parentheses around to make this more robust.
        const s = sm.span_to_snippet(impl_m_sig.span);
        impl_inputs_span = undefined;
        if (s.$ === "Ok") {
          const right_paren = s._0.rfind(")");
          if (right_paren !== undefined) {
            const pos = BytePos(Span.lo(impl_m_sig.span) + right_paren);
            impl_inputs_span = Span.with_hi(Span.with_lo(impl_m_sig.span, pos), pos);
          }
        }
      }
      let suggestion: [Span, string, string] | undefined;
      if (trait_number_args > impl_number_args) {
        // Ordering::Greater
        // Span is right before the end parenthesis:
        // fn foo(a: i32 ) {}
        //              ^
        const trait_inputs = Binder.skip_binder(PolyFnSig.inputs(EarlyBinder.skip_binder(trait_sig)));
        const missing: string[] = [];
        trait_inputs.forEach((ty, idx) => {
          if (idx < impl_number_args) return;
          const ident = trait_arg_idents[idx];
          const name = ident !== undefined ? display_Ident(ident) : "_";
          missing.push(`${name}: ${display_Ty(ty)}`);
        });

        if (missing.length === 0) {
          suggestion = undefined;
        } else {
          suggestion =
            impl_inputs_span === undefined
              ? undefined
              : (() => {
                  const span = Span.shrink_to_hi(impl_inputs_span);
                  const prefix = impl_number_args === 0 ? "" : ", ";
                  const replacement = `${prefix}${missing.join(", ")}`;
                  return [span, `add the missing parameter${pluralize(trait_number_args - impl_number_args)} from the trait`, replacement] as [Span, string, string];
                })();
        }
      } else if (trait_number_args < impl_number_args) {
        // Ordering::Less
        suggestion =
          impl_inputs_span === undefined
            ? undefined
            : ((full: Span): [Span, string, string] | undefined => {
                // Span of the arguments that there are too many of:
                // fn foo(a: i32, b: u32) {}
                //              ^^^^^^^^
                let lo: BytePos;
                if (trait_number_args === 0) {
                  lo = Span.lo(full);
                } else {
                  const arg = impl_m_sig.decl.inputs[trait_number_args - 1];
                  if (arg === undefined) return undefined;
                  lo = Span.hi(arg.span);
                }
                const span = Span.with_lo(full, lo);
                return [span, `remove the extra parameter${pluralize(impl_number_args - trait_number_args)} to match the trait`, ""];
              })(impl_inputs_span);
      } else {
        // Ordering::Equal
        unreachable();
      }
      if (suggestion !== undefined) {
        const [span, msg, replacement] = suggestion;
        err.span_suggestion_verbose(span, msg, replacement, Applicability.MaybeIncorrect);
      }
    }

    return Err(err.emit_err_unless_delay(delay));
  }

  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1911 compare_synthetic_generics
function compare_synthetic_generics(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, delay: boolean): Result<null, ErrorGuaranteed> {
  // FIXME(chrisvittal) Clean up this function, list of FIXME items:
  //     1. Better messages for the span labels
  //     2. Explanation as to what is going on
  // If we get here, we already have the same number of generics, so the zip will
  // be okay.
  let error_found: ErrorGuaranteed | undefined = undefined;
  const impl_m_generics = tcx.generics_of(impl_m.def_id) as Generics;
  const trait_m_generics = tcx.generics_of(trait_m.def_id) as Generics;
  const impl_m_type_params: [DefId, boolean][] = [];
  for (const param of impl_m_generics.own_params) {
    if (param.kind.$ === "Type") impl_m_type_params.push([param.def_id, param.kind.synthetic]);
  }
  const trait_m_type_params: [DefId, boolean][] = [];
  for (const param of trait_m_generics.own_params) {
    if (param.kind.$ === "Type") trait_m_type_params.push([param.def_id, param.kind.synthetic]);
  }
  for (let i = 0; i < Math.min(impl_m_type_params.length, trait_m_type_params.length); i++) {
    const [impl_def_id_, impl_synthetic] = impl_m_type_params[i]!;
    const [trait_def_id, trait_synthetic] = trait_m_type_params[i]!;
    if (impl_synthetic !== trait_synthetic) {
      const impl_def_id = impl_def_id_.expect_local();
      const impl_span = tcx.def_span(impl_def_id);
      const trait_span = tcx.def_span(trait_def_id);
      const err = struct_span_code_err(tcx.dcx(), impl_span, E0643, `method \`${display_Symbol(AssocItem.name(trait_m))}\` has incompatible signature for trait`);
      err.span_label(trait_span, "declaration in trait here");
      if (impl_synthetic) {
        // The case where the impl method uses `impl Trait` but the trait method uses
        // explicit generics
        err.span_label(impl_span, "expected generic parameter, found `impl Trait`");
        // PORT: `try { .. }` with `?` on `Option`s is a closure that returns early.
        (() => {
          // try taking the name from the trait impl
          // FIXME: this is obviously suboptimal since the name can already be used
          // as another generic argument
          const new_name = tcx.opt_item_name(trait_def_id);
          if (new_name === undefined) return;
          const trait_m_ = trait_m.def_id.as_local();
          if (trait_m_ === undefined) return;
          const trait_m__ = tcx.hir_expect_trait_item(trait_m_);

          const impl_m_ = impl_m.def_id.as_local();
          if (impl_m_ === undefined) return;
          const impl_m__ = tcx.hir_expect_impl_item(impl_m_);

          // in case there are no generics, take the spot between the function name
          // and the opening paren of the argument list
          const ident_span = tcx.def_ident_span(impl_def_id);
          if (ident_span === undefined) return;
          const new_generics_span = Span.shrink_to_hi(ident_span);
          // in case there are generics, just replace them
          const generics_span = Span.substitute_dummy(impl_m__.generics.span, new_generics_span);
          // replace with the generics from the trait
          const new_generics = tcx.sess.source_map().span_to_snippet(trait_m__.generics.span);
          if (new_generics.$ !== "Ok") return;

          err.multipart_suggestion(
            "try changing the `impl Trait` argument to a generic parameter",
            [
              // replace `impl Trait` with `T`
              [impl_span, display_Symbol(new_name)],
              // replace impl method generics with trait method generics
              // This isn't quite right, as users might have changed the names
              // of the generics, but it works for the common case
              [generics_span, new_generics._0.toString()],
            ],
            Applicability.MaybeIncorrect,
          );
        })();
      } else {
        // The case where the trait method uses `impl Trait`, but the impl method uses
        // explicit generics.
        err.span_label(impl_span, "expected `impl Trait`, found generic parameter");
        // PORT: `try { .. }` with `?` on `Option`s is a closure that returns early.
        (() => {
          const impl_m_ = impl_m.def_id.as_local();
          if (impl_m_ === undefined) return;
          const impl_m__ = tcx.hir_expect_impl_item(impl_m_);
          const [sig, _] = impl_m__.expect_fn();
          const input_tys = sig.decl.inputs;

          // rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:1997 Visitor
          class Visitor extends HirVisitor<ControlFlow<Span>> {
            // type Result = ControlFlow<Span>;
            override Result = VisitorResultC.ControlFlow<Span>();
            constructor(public _0: LocalDefId) {
              super();
            }

            // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2000 visit_ty
            override visit_ty(ty: hir.Ty<AmbigArg>): ControlFlow<Span> {
              const k = ty.kind;
              if (
                k.$ === "Path" &&
                k._0.$ === "Resolved" &&
                k._0._0 === undefined &&
                k._0._1.res.$ === "Def" &&
                k._0._1.res._0.$ === "TyParam" &&
                DefId_eq(k._0._1.res._1, LocalDefId.to_def_id(this._0))
              ) {
                return ControlFlow.Break(ty.span);
              } else {
                return walk_ty(this, ty);
              }
            }
          }

          let span: Span | undefined = undefined;
          for (const ty of input_tys) {
            const r = new Visitor(impl_def_id).visit_ty_unambig(ty);
            if (r.$ === "Break") {
              span = r._0;
              break;
            }
          }
          if (span === undefined) return;

          const bp = impl_m__.generics.bounds_for_param(impl_def_id)[0];
          if (bp === undefined) return;
          const bounds_ = bp.bounds;
          const first = bounds_[0];
          if (first === undefined) return;
          const last = bounds_[bounds_.length - 1];
          if (last === undefined) return;
          const bounds__ = Span.to(GenericBound.span(first), GenericBound.span(last));
          const bounds = tcx.sess.source_map().span_to_snippet(bounds__);
          if (bounds.$ !== "Ok") return;

          err.multipart_suggestion(
            "try removing the generic parameter and using `impl Trait` instead",
            [
              // delete generic parameters
              [impl_m__.generics.span, ""],
              // replace param usage with `impl Trait`
              [span, `impl ${bounds._0.toString()}`],
            ],
            Applicability.MaybeIncorrect,
          );
        })();
      }
      error_found = err.emit_err_unless_delay(delay);
    }
  }
  if (error_found !== undefined) {
    return Err(error_found);
  } else {
    return Ok(null);
  }
}

/// Checks that corresponding generic parameters in a trait item and its impl
/// are both type parameters or both const parameters.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2040 compare_generic_param_kinds
function compare_generic_param_kinds(tcx: TyCtxt, impl_item: AssocItem, trait_item: AssocItem, delay: boolean): Result<null, ErrorGuaranteed> {
  assert_eq(AssocItem.tag(impl_item), AssocItem.tag(trait_item), (t) => format_debug(t, debug_AssocTag, PLAIN));

  const ty_const_params_of = (def_id: DefId): GenericParamDef[] => (tcx.generics_of(def_id) as Generics).own_params.filter((param) => param.kind.$ === "Const" || param.kind.$ === "Type");

  const impl_params = ty_const_params_of(impl_item.def_id);
  const trait_params = ty_const_params_of(trait_item.def_id);
  for (let i = 0; i < Math.min(impl_params.length, trait_params.length); i++) {
    const param_impl = impl_params[i]!;
    const param_trait = trait_params[i]!;
    // use GenericParamDefKind::*;
    let mismatch: boolean;
    const a = param_impl.kind.$;
    const b = param_trait.kind.$;
    if ((a === "Const" && b === "Type") || (a === "Type" && b === "Const")) {
      mismatch = true;
    } else if ((a === "Const" && b === "Const") || (a === "Type" && b === "Type")) {
      // this is exhaustive so that anyone adding new generic param kinds knows
      // to make sure this error is reported for them.
      mismatch = false;
    } else {
      // (Lifetime { .. }, _) | (_, Lifetime { .. })
      bug("lifetime params are expected to be filtered by `ty_const_params_of`");
    }
    if (mismatch) {
      const param_impl_span = tcx.def_span(param_impl.def_id);
      const param_trait_span = tcx.def_span(param_trait.def_id);

      const err = struct_span_code_err(
        tcx.dcx(),
        param_impl_span,
        E0053,
        `${AssocItem.descr(impl_item)} \`${display_Symbol(AssocItem.name(trait_item))}\` has an incompatible generic parameter for trait \`${tcx.def_path_str(tcx.parent(trait_item.def_id))}\``,
      );

      const make_param_message = (prefix: string, param: GenericParamDef): string => {
        switch (param.kind.$) {
          case "Const":
            return `${prefix} const parameter of type \`${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param.def_id) as EarlyBinder<Ty>)))}\``;
          case "Type":
            return `${prefix} type parameter`;
          case "Lifetime":
            return span_bug(tcx.def_span(param.def_id), "lifetime params are expected to be filtered by `ty_const_params_of`");
        }
      };

      const trait_header_span = unwrap(tcx.def_ident_span(tcx.parent(trait_item.def_id)));
      err.span_context(trait_header_span);
      err.span_label(param_trait_span, make_param_message("expected", param_trait));

      const impl_header_span = tcx.def_span(tcx.parent(impl_item.def_id));
      err.span_context(impl_header_span);
      err.span_label(param_impl_span, make_param_message("found", param_impl));

      const guar = err.emit_err_unless_delay(delay);
      return Err(guar);
    }
  }

  return Ok(null);
}

/// Checks that corresponding const generic parameters in a trait item and its
/// impl have compatible types.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2116 compare_const_generic_param_types
function compare_const_generic_param_types(tcx: TyCtxt, impl_item: AssocItem, trait_item: AssocItem, impl_trait_ref: TraitRef, delay: boolean): Result<null, ErrorGuaranteed> {
  assert_eq(AssocItem.tag(impl_item), AssocItem.tag(trait_item), (t) => format_debug(t, debug_AssocTag, PLAIN));
  // use GenericParamDefKind::*;

  const const_params_of = (def_id: DefId): GenericParamDef[] => (tcx.generics_of(def_id) as Generics).own_params.filter((param) => param.kind.$ === "Const");

  // Map the trait item's generic parameters into the impl item's generic context.
  const trait_to_impl_args = RawList.identity_for_item(tcx, impl_item.def_id).rebase_onto(tcx, AssocItem.container_id(impl_item, tcx), impl_trait_ref.args);
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const param_env = tcx.param_env(impl_item.def_id) as ParamEnv;

  const impl_params = const_params_of(impl_item.def_id);
  const trait_params = const_params_of(trait_item.def_id);

  for (let i = 0; i < Math.min(impl_params.length, trait_params.length); i++) {
    const param_impl = impl_params[i]!;
    const param_trait = trait_params[i]!;
    const param_impl_ty_span = tcx.ty_span(param_impl.def_id.expect_local());

    const cause = ObligationCause.new(param_impl_ty_span, impl_item.def_id.expect_local(), {
      $: "CompareImplItem",
      impl_item_def_id: impl_item.def_id.expect_local(),
      trait_item_def_id: trait_item.def_id,
      kind: impl_item.kind,
    });

    const impl_ty = ocx.normalize(cause, param_env, EarlyBinder.instantiate_identity(tcx.type_of(param_impl.def_id) as EarlyBinder<Ty>), fold_Ty);

    const trait_ty = ocx.normalize(cause, param_env, EarlyBinder.instantiate(tcx.type_of(param_trait.def_id) as EarlyBinder<Ty>, tcx, trait_to_impl_args, fold_Ty), fold_Ty);

    const res = ocx.eq(cause, param_env, trait_ty, impl_ty, rustc_infer.infer.at.ToTrace_Ty);
    switch (res.$) {
      // Despite returning `Ok` all may not be well. As such, outside of this
      // loop we invoke `ocx.evaluate_obligations_error_on_ambiguity()` to check
      // for any other errors that may have occurred.
      case "Ok":
        break;
      case "Err": {
        const terr = res._0;
        const param_trait_local = param_trait.def_id.as_local();
        const param_trait_ty_span = param_trait_local === undefined ? undefined : tcx.ty_span(param_trait_local);
        const diag = struct_span_code_err(
          tcx.dcx(),
          param_impl_ty_span,
          E0053,
          `${AssocItem.descr(trait_item)} \`${display_Symbol(AssocItem.name(trait_item))}\` has an incompatible type for const generic parameter`,
        );
        err_ctxt(infcx).note_type_err(
          diag,
          cause,
          param_trait_ty_span === undefined ? undefined : [param_trait_ty_span, "type in trait", false],
          param_env.and<ValuePairs>({ $: "Terms", _0: { expected: trait_ty, found: impl_ty } }),
          terr,
          false,
          undefined,
        );
        const reported = diag.emit_err_unless_delay(delay);
        return Err(reported);
      }
    }
  }

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    return Err(err_ctxt(infcx).report_fulfillment_errors(errors._0));
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2206 compare_impl_const
function compare_impl_const(tcx: TyCtxt, impl_const_item: AssocItem, trait_const_item: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  let r = compare_const_directness(tcx, impl_const_item, trait_const_item);
  if (r.$ === "Err") return r;
  r = compare_number_of_generics(tcx, impl_const_item, trait_const_item, false);
  if (r.$ === "Err") return r;
  r = compare_generic_param_kinds(tcx, impl_const_item, trait_const_item, false);
  if (r.$ === "Err") return r;
  r = compare_const_generic_param_types(tcx, impl_const_item, trait_const_item, impl_trait_ref, false);
  if (r.$ === "Err") return r;
  r = check_region_bounds_on_impl_item(tcx, impl_const_item, trait_const_item, false);
  if (r.$ === "Err") return r;
  return compare_const_clause_entailment(tcx, impl_const_item, trait_const_item, impl_trait_ref);
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2226 compare_const_directness
export function compare_const_directness(tcx: TyCtxt, impl_const_item: AssocItem, trait_const_item: AssocItem): Result<null, ErrorGuaranteed> {
  const trait_is_gca = tcx.is_always_gca(trait_const_item.def_id);
  const impl_is_gca = tcx.const_of_item(impl_const_item.def_id) !== undefined;

  if (trait_is_gca === impl_is_gca) {
    return Ok(null);
  }
  // feature(gca_const_items) is allowed to impl non-GCA traits with a GCA const
  if (tcx.features().gca_const_items() && !trait_is_gca && impl_is_gca) {
    return Ok(null);
  }

  let guar: ErrorGuaranteed;
  if (trait_is_gca) {
    guar = tcx
      .dcx()
      .struct_span_err(tcx.def_span(impl_const_item.def_id), "implementation of a `#[rustc_always_gca]` must have a `gca!` RHS")
      .with_span_note(tcx.def_span(trait_const_item.def_id), "trait declaration of const is marked as `#[rustc_always_gca]`")
      .emit_err();
  } else {
    guar = tcx
      .dcx()
      .struct_span_err(tcx.def_span(impl_const_item.def_id), "implementation of a regular const cannot have a `gca!` RHS")
      .with_span_note(tcx.def_span(trait_const_item.def_id), "trait declaration of const is not marked as `#[rustc_always_gca]`")
      .emit_err();
  }
  return Err(guar);
}

/// The equivalent of [compare_method_clause_entailment], but for associated constants
/// instead of associated functions.
// FIXME(generic_const_items): If possible extract the common parts of
// `compare_{type,const}_clause_entailment`.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2273 compare_const_clause_entailment
function compare_const_clause_entailment(tcx: TyCtxt, impl_ct: AssocItem, trait_ct: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  const impl_ct_def_id = impl_ct.def_id.expect_local();
  const impl_ct_span = tcx.def_span(impl_ct_def_id);

  // The below is for the most part highly similar to the procedure
  // for methods above. It is simpler in many respects, especially
  // because we shouldn't really have to deal with lifetimes or
  // predicates. In fact some of this should probably be put into
  // shared functions because of DRY violations...
  const trait_to_impl_args = RawList.identity_for_item(tcx, impl_ct.def_id).rebase_onto(tcx, AssocItem.container_id(impl_ct, tcx), impl_trait_ref.args);

  // Create a parameter environment that represents the implementation's
  // associated const.
  const impl_ty_ = EarlyBinder.instantiate_identity(tcx.type_of(impl_ct_def_id) as EarlyBinder<Ty>);

  const trait_ty_ = EarlyBinder.instantiate(tcx.type_of(trait_ct.def_id) as EarlyBinder<Ty>, tcx, trait_to_impl_args, fold_Ty);
  const code: ObligationCauseCode = {
    $: "CompareImplItem",
    impl_item_def_id: impl_ct_def_id,
    trait_item_def_id: trait_ct.def_id,
    kind: impl_ct.kind,
  };
  const cause = ObligationCause.new(impl_ct_span, impl_ct_def_id, { ...code });

  const impl_ct_clauses = tcx.clauses_of(impl_ct.def_id) as GenericClauses;
  const trait_ct_clauses = tcx.clauses_of(trait_ct.def_id) as GenericClauses;

  // The clauses declared by the impl definition, the trait and the
  // associated const in the trait are assumed.
  const impl_clauses = tcx.clauses_of(unwrap(impl_ct_clauses.parent)) as GenericClauses;
  const hybrid_clauses_: Unnormalized<Clause>[] = GenericClauses.instantiate_identity(impl_clauses, tcx).clauses;
  for (const [clause, _] of GenericClauses.instantiate_own(trait_ct_clauses, tcx, trait_to_impl_args)) hybrid_clauses_.push(clause);
  const hybrid_clauses = hybrid_clauses_.map(Unnormalized.skip_norm_wip);

  let param_env = ParamEnv.new(tcx, hybrid_clauses);
  param_env = normalize_param_env_or_error(tcx, param_env, ObligationCause.misc(impl_ct_span, impl_ct_def_id));

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  const impl_ct_own_bounds = GenericClauses.instantiate_own_identity(impl_ct_clauses);
  for (const [clause_, span] of impl_ct_own_bounds) {
    const cause = ObligationCause.misc(span, impl_ct_def_id);
    const clause = ocx.normalize(cause, param_env, clause_, fold_Clause);

    const cause_ = ObligationCause.new(span, impl_ct_def_id, { ...code });
    ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause_, param_env, clause, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  // There is no "body" here, so just pass dummy id.
  const impl_ty = ocx.normalize(cause, param_env, impl_ty_, fold_Ty);
  // debug!(?impl_ty);

  const trait_ty = ocx.normalize(cause, param_env, trait_ty_, fold_Ty);
  // debug!(?trait_ty);

  const err = ocx.sup(cause, param_env, trait_ty, impl_ty, rustc_infer.infer.at.ToTrace_Ty);

  if (err.$ === "Err") {
    const terr = err._0;
    // debug!(?impl_ty, ?trait_ty);

    // Locate the Span containing just the type of the offending impl
    const [ty, _] = tcx.hir_expect_impl_item(impl_ct_def_id).expect_const();
    cause.span = ty.span;

    const diag = struct_span_code_err(tcx.dcx(), cause.span, E0326, `implemented const \`${display_Symbol(AssocItem.name(trait_ct))}\` has an incompatible type for trait`);

    const trait_ct_def_id = trait_ct.def_id.as_local();
    const trait_c_span =
      trait_ct_def_id === undefined
        ? undefined
        : (() => {
            // Add a label to the Span containing just the type of the const
            const [ty, _] = tcx.hir_expect_trait_item(trait_ct_def_id).expect_const();
            return ty.span;
          })();

    err_ctxt(infcx).note_type_err(
      diag,
      cause,
      trait_c_span === undefined ? undefined : [trait_c_span, "type in trait", false],
      param_env.and<ValuePairs>({ $: "Terms", _0: { expected: trait_ty, found: impl_ty } }),
      terr,
      false,
      undefined,
    );
    return Err(diag.emit_err());
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    return Err(err_ctxt(infcx).report_fulfillment_errors(errors._0));
  }

  return ocx.resolve_regions_and_report_errors(impl_ct_def_id, param_env, []);
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2392 compare_impl_ty
function compare_impl_ty(tcx: TyCtxt, impl_ty: AssocItem, trait_ty: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  let r = compare_number_of_generics(tcx, impl_ty, trait_ty, false);
  if (r.$ === "Err") return r;
  r = compare_generic_param_kinds(tcx, impl_ty, trait_ty, false);
  if (r.$ === "Err") return r;
  r = compare_const_generic_param_types(tcx, impl_ty, trait_ty, impl_trait_ref, false);
  if (r.$ === "Err") return r;
  r = check_region_bounds_on_impl_item(tcx, impl_ty, trait_ty, false);
  if (r.$ === "Err") return r;
  r = compare_type_clause_entailment(tcx, impl_ty, trait_ty, impl_trait_ref);
  if (r.$ === "Err") return r;
  return check_type_bounds(tcx, trait_ty, impl_ty, impl_trait_ref);
}

/// The equivalent of [compare_method_clause_entailment], but for associated types
/// instead of associated functions.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2409 compare_type_clause_entailment
function compare_type_clause_entailment(tcx: TyCtxt, impl_ty: AssocItem, trait_ty: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  const impl_def_id = AssocItem.container_id(impl_ty, tcx);
  const trait_to_impl_args = RawList.identity_for_item(tcx, impl_ty.def_id).rebase_onto(tcx, impl_def_id, impl_trait_ref.args);

  const impl_ty_clauses = tcx.clauses_of(impl_ty.def_id) as GenericClauses;
  const trait_ty_clauses = tcx.clauses_of(trait_ty.def_id) as GenericClauses;

  const impl_ty_own_bounds = GenericClauses.instantiate_own_identity(impl_ty_clauses);
  // If there are no bounds, then there are no const conditions, so no need to check that here.
  // PORT: `ExactSizeIterator::len` is the exact `size_hint`.
  if (impl_ty_own_bounds.size_hint()[0] === 0) {
    // Nothing to check.
    return Ok(null);
  }

  // This `DefId` should be used for the `body_def_id` field on each
  // `ObligationCause` (and the `FnCtxt`). This is what
  // `regionck_item` expects.
  const impl_ty_def_id = impl_ty.def_id.expect_local();
  // debug!(?trait_to_impl_args);

  // The clauses declared by the impl definition, the trait and the
  // associated type in the trait are assumed.
  const impl_clauses = tcx.clauses_of(unwrap(impl_ty_clauses.parent)) as GenericClauses;
  const hybrid_clauses_: Unnormalized<Clause>[] = GenericClauses.instantiate_identity(impl_clauses, tcx).clauses;
  for (const [predicate, _] of GenericClauses.instantiate_own(trait_ty_clauses, tcx, trait_to_impl_args)) hybrid_clauses_.push(predicate);
  // debug!(?hybrid_clauses);

  const impl_ty_span = tcx.def_span(impl_ty_def_id);
  const normalize_cause = ObligationCause.misc(impl_ty_span, impl_ty_def_id);

  const is_conditionally_const = tcx.is_conditionally_const(impl_ty.def_id);
  if (is_conditionally_const) {
    // Augment the hybrid param-env with the const conditions
    // of the impl header and the trait assoc type.
    const conds: [Unnormalized<Binder<TraitRef>>, Span][] = [
      ...ConstConditions.instantiate_identity(tcx.const_conditions(unwrap(impl_ty_clauses.parent)) as ConstConditions, tcx),
      ...ConstConditions.instantiate_own(tcx.const_conditions(trait_ty.def_id) as ConstConditions, tcx, trait_to_impl_args),
    ];
    for (const [trait_ref, _] of conds) {
      hybrid_clauses_.push(UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, tcx, "Maybe"));
    }
  }

  const hybrid_clauses = hybrid_clauses_.map(Unnormalized.skip_norm_wip);
  let param_env = ParamEnv.new(tcx, hybrid_clauses);
  param_env = normalize_param_env_or_error(tcx, param_env, normalize_cause);
  // debug!(?param_env);

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  for (const [clause_, span] of impl_ty_own_bounds) {
    const cause = ObligationCause.misc(span, impl_ty_def_id);
    const clause = ocx.normalize(cause, param_env, clause_, fold_Clause);

    const cause_ = ObligationCause.new(span, impl_ty_def_id, {
      $: "CompareImplItem",
      impl_item_def_id: impl_ty.def_id.expect_local(),
      trait_item_def_id: trait_ty.def_id,
      kind: impl_ty.kind,
    });
    ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause_, param_env, clause, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  if (is_conditionally_const) {
    // Validate the const conditions of the impl associated type.
    const impl_ty_own_const_conditions = ConstConditions.instantiate_own_identity(tcx.const_conditions(impl_ty.def_id) as ConstConditions);
    for (const [const_condition_, span] of impl_ty_own_const_conditions) {
      const normalize_cause = ObligationCause.misc(span, impl_ty_def_id);
      const const_condition = ocx.normalize(normalize_cause, param_env, const_condition_, d_PolyTraitRef);

      const cause = ObligationCause.new(span, impl_ty_def_id, {
        $: "CompareImplItem",
        impl_item_def_id: impl_ty_def_id,
        trait_item_def_id: trait_ty.def_id,
        kind: impl_ty.kind,
      });
      ocx.register_obligation(rustc_infer.traits.Obligation.new(tcx, cause, param_env, PolyTraitRef.to_host_effect_clause(const_condition, tcx, "Maybe"), upcast_tcx(Predicate_upcast_from_Clause)));
    }
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const reported = err_ctxt(infcx).report_fulfillment_errors(errors._0);
    return Err(reported);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  return ocx.resolve_regions_and_report_errors(impl_ty_def_id, param_env, []);
}

/// Validate that `ProjectionCandidate`s created for this associated type will
/// be valid.
///
/// Usually given
///
/// trait X { type Y: Copy } impl X for T { type Y = S; }
///
/// We are able to normalize `<T as X>::Y` to `S`, and so when we check the
/// impl is well-formed we have to prove `S: Copy`.
///
/// For default associated types the normalization is not possible (the value
/// from the impl could be overridden). We also can't normalize generic
/// associated types (yet) because they contain bound parameters.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2544 check_type_bounds
export function check_type_bounds(tcx: TyCtxt, trait_ty: AssocItem, impl_ty: AssocItem, impl_trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for Foo` in case
  // other `Foo` impls are incoherent.
  const c = tcx.ensure_result().coherent_trait(impl_trait_ref.def_id);
  if (c.$ === "Err") return c;

  const param_env = tcx.param_env(impl_ty.def_id) as ParamEnv;
  // debug!(?param_env);

  const container_id = AssocItem.container_id(impl_ty, tcx);
  const impl_ty_def_id = impl_ty.def_id.expect_local();
  const impl_ty_args = RawList.identity_for_item(tcx, impl_ty.def_id);
  const rebased_args = impl_ty_args.rebase_onto(tcx, container_id, impl_trait_ref.args);

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);

  // A synthetic impl Trait for RPITIT desugaring or assoc type for effects desugaring has no HIR,
  // which we currently use to get the span for an impl's associated type. Instead, for these,
  // use the def_span for the synthesized  associated type.
  let impl_ty_span: Span;
  if (AssocItem.is_impl_trait_in_trait(impl_ty)) {
    impl_ty_span = tcx.def_span(impl_ty_def_id);
  } else {
    const item = tcx.hir_node_by_def_id(impl_ty_def_id);
    if (item.$ === "TraitItem" && item._0.kind.$ === "Type" && item._0.kind._1 !== undefined) {
      impl_ty_span = item._0.kind._1.span;
    } else if (item.$ === "ImplItem" && item._0.kind.$ === "Type") {
      impl_ty_span = item._0.kind._0.span;
    } else {
      span_bug(tcx.def_span(impl_ty_def_id), `cannot call \`check_type_bounds\` on item: ${format_debug(item, debug_Node, PLAIN)}`);
    }
  }
  const assumed_wf_types = ocx.assumed_wf_types_and_report_errors(param_env, impl_ty_def_id);
  if (assumed_wf_types.$ === "Err") return assumed_wf_types;

  const normalize_cause = ObligationCause.new(impl_ty_span, impl_ty_def_id, {
    $: "CheckAssociatedTypeBounds",
    impl_item_def_id: impl_ty.def_id.expect_local(),
    trait_item_def_id: trait_ty.def_id,
  });
  const mk_cause = (span: Span): ObligationCause => {
    const code: ObligationCauseCode = { $: "WhereClause", _0: trait_ty.def_id, _1: span };
    return ObligationCause.new(impl_ty_span, impl_ty_def_id, code);
  };

  const obligations: PredicateObligation[] = [
    ...elaborate(
      tcx,
      [
        ...EarlyBinder.iter_instantiated_copied(
          tcx.explicit_item_bounds(trait_ty.def_id) as EarlyBinder<readonly [Clause, Span][]>,
          tcx,
          rebased_args,
          fold_tuple2(fold_Clause, fold_Span),
        ),
      ]
        .map(Unnormalized.skip_norm_wip)
        .map(([concrete_ty_bound, span]) => {
          // debug!(?concrete_ty_bound);
          return rustc_infer.traits.Obligation.new(tcx, mk_cause(span), param_env, concrete_ty_bound, upcast_tcx(Predicate_upcast_from_Clause));
        }),
      rustc_infer.traits.util.Elaboratable_PredicateObligation,
    ),
  ];

  // Only in a const implementation do we need to check that the `[const]` item bounds hold.
  if (tcx.is_conditionally_const(LocalDefId.to_def_id(impl_ty_def_id))) {
    obligations.push(
      ...elaborate(
        tcx,
        [
          ...EarlyBinder.iter_instantiated_copied(
            tcx.explicit_implied_const_bounds(trait_ty.def_id) as EarlyBinder<readonly [Binder<TraitRef>, Span][]>,
            tcx,
            rebased_args,
            fold_tuple2(d_PolyTraitRef, fold_Span),
          ),
        ]
          .map(Unnormalized.skip_norm_wip)
          .map(([c, span]) => rustc_infer.traits.Obligation.new(tcx, mk_cause(span), param_env, PolyTraitRef.to_host_effect_clause(c, tcx, "Maybe"), upcast_tcx(Predicate_upcast_from_Clause))),
        rustc_infer.traits.util.Elaboratable_PredicateObligation,
      ),
    );
  }
  // debug!(item_bounds=?obligations);

  // Normalize predicates with the assumption that the GAT may always normalize
  // to its definition type. This should be the param-env we use to *prove* the
  // predicate too, but we don't do that because of performance issues.
  // See <https://github.com/rust-lang/rust/pull/117542#issue-1976337685>.
  const normalize_param_env = param_env_with_gat_bounds(tcx, impl_ty, impl_trait_ref);
  for (const obligation of obligations) {
    const r = ocx.deeply_normalize(normalize_cause, normalize_param_env, Unnormalized.new_wip(obligation.predicate), fold_Predicate);
    switch (r.$) {
      case "Ok":
        obligation.predicate = r._0;
        break;
      case "Err": {
        const e = r._0;
        return Err(err_ctxt(infcx).report_fulfillment_errors(e));
      }
    }
  }

  // Check that all obligations are satisfied by the implementation's
  // version.
  ocx.register_obligations(obligations);
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const reported = err_ctxt(infcx).report_fulfillment_errors(errors._0);
    return Err(reported);
  }

  // Finally, resolve all regions. This catches wily misuses of
  // lifetime parameters.
  return ocx.resolve_regions_and_report_errors(impl_ty_def_id, param_env, assumed_wf_types._0);
}

/// Install projection predicates that allow GATs to project to their own
/// definition types. This is not allowed in general in cases of default
/// associated types in trait definitions, or when specialization is involved,
/// but is needed when checking these definition types actually satisfy the
/// trait bounds of the GAT.
///
/// # How it works
///
/// ```ignore (example)
/// impl<A, B> Foo<u32> for (A, B) {
///     type Bar<C> = Wrapper<A, B, C>
/// }
/// ```
///
/// - `impl_trait_ref` would be `<(A, B) as Foo<u32>>`
/// - `normalize_impl_ty_args` would be `[A, B, ^0.0]` (`^0.0` here is the bound var with db 0 and index 0)
/// - `normalize_impl_ty` would be `Wrapper<A, B, ^0.0>`
/// - `rebased_args` would be `[(A, B), u32, ^0.0]`, combining the args from
///    the *trait* with the generic associated type parameters (as bound vars).
///
/// A note regarding the use of bound vars here:
/// Imagine as an example
/// ```
/// trait Family {
///     type Member<C: Eq>;
/// }
///
/// impl Family for VecFamily {
///     type Member<C: Eq> = i32;
/// }
/// ```
/// Here, we would generate
/// ```ignore (pseudo-rust)
/// forall<C> { Normalize(<VecFamily as Family>::Member<C> => i32) }
/// ```
///
/// when we really would like to generate
/// ```ignore (pseudo-rust)
/// forall<C> { Normalize(<VecFamily as Family>::Member<C> => i32) :- Implemented(C: Eq) }
/// ```
///
/// But, this is probably fine, because although the first clause can be used with types `C` that
/// do not implement `Eq`, for it to cause some kind of problem, there would have to be a
/// `VecFamily::Member<X>` for some type `X` where `!(X: Eq)`, that appears in the value of type
/// `Member<C: Eq> = ....` That type would fail a well-formedness check that we ought to be doing
/// elsewhere, which would check that any `<T as Family>::Member<X>` meets the bounds declared in
/// the trait (notably, that `X: Eq` and `T: Family`).
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2708 param_env_with_gat_bounds
function param_env_with_gat_bounds(tcx: TyCtxt, impl_ty: AssocItem, impl_trait_ref: TraitRef): ParamEnv {
  const param_env = tcx.param_env(impl_ty.def_id) as ParamEnv;
  const container_id = AssocItem.container_id(impl_ty, tcx);
  const clauses: Clause[] = [...param_env.caller_bounds()];

  // for RPITITs, we should install predicates that allow us to project all
  // of the RPITITs associated with the same body. This is because checking
  // the item bounds of RPITITs often involves nested RPITITs having to prove
  // bounds about themselves.
  let impl_tys_to_install: AssocItem[];
  if (impl_ty.kind.$ === "Type" && impl_ty.kind.data.$ === "Rpitit") {
    // ImplTraitInTraitData::Impl { fn_def_id } | ImplTraitInTraitData::Trait { fn_def_id, .. }
    const fn_def_id = impl_ty.kind.data._0.fn_def_id;
    impl_tys_to_install = tcx.associated_types_for_impl_traits_in_associated_fn(fn_def_id).map((def_id) => tcx.associated_item(def_id) as AssocItem);
  } else {
    impl_tys_to_install = [impl_ty];
  }

  for (const impl_ty of impl_tys_to_install) {
    let trait_ty: AssocItem;
    const container = impl_ty.container;
    switch (container.$) {
      case "InherentImpl":
        bug();
      case "Trait":
        trait_ty = impl_ty;
        break;
      case "TraitImpl":
        if (container._0.$ === "Err") continue;
        trait_ty = tcx.associated_item(container._0._0) as AssocItem;
        break;
    }

    // PORT: `SmallVec<[BoundVariableKind; 8]>` is an array (`with_capacity` only reserves).
    const bound_vars_: BoundVariableKind[] = [];
    // Extend the impl's identity args with late-bound GAT vars
    const normalize_impl_ty_args = RawList.identity_for_item(tcx, container_id).extend_to(tcx, impl_ty.def_id, (param, _) => {
      switch (param.kind.$) {
        case "Type": {
          const kind: BoundTyKind = { $: "Param", _0: param.def_id };
          const bound_var: BoundVariableKind = { $: "Ty", _0: kind };
          bound_vars_.push(bound_var);
          return Ty.new_bound(tcx, INNERMOST, { var: BoundVar.from_usize(bound_vars_.length - 1), kind });
        }
        case "Lifetime": {
          const kind: BoundRegionKind = { $: "Named", _0: param.def_id };
          const bound_var: BoundVariableKind = { $: "Region", _0: kind };
          bound_vars_.push(bound_var);
          return Region.new_bound(tcx, INNERMOST, { var: BoundVar.from_usize(bound_vars_.length - 1), kind });
        }
        case "Const": {
          const bound_var: BoundVariableKind = BoundVariableKind.Const;
          bound_vars_.push(bound_var);
          return ConstC.new_bound(tcx, INNERMOST, BoundConst.new(BoundVar.from_usize(bound_vars_.length - 1)));
        }
      }
    });
    // When checking something like
    //
    // trait X { type Y: PartialEq<<Self as X>::Y> }
    // impl X for T { default type Y = S; }
    //
    // We will have to prove the bound S: PartialEq<<T as X>::Y>. In this case
    // we want <T as X>::Y to normalize to S. This is valid because we are
    // checking the default value specifically here. Add this equality to the
    // ParamEnv for normalization specifically.
    const normalize_impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(impl_ty.def_id) as EarlyBinder<Ty>, tcx, normalize_impl_ty_args, fold_Ty));
    const rebased_args = normalize_impl_ty_args.rebase_onto(tcx, container_id, impl_trait_ref.args);
    const bound_vars = tcx.mk_bound_variable_kinds(bound_vars_);

    const k = normalize_impl_ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && DefId_eq(k._1.kind.def_id, trait_ty.def_id) && k._1.args === rebased_args) {
      // Don't include this predicate if the projected type is
      // exactly the same as the projection. This can occur in
      // (somewhat dubious) code like this:
      //
      // impl<T> X for T where T: X { type Y = <T as X>::Y; }
    } else {
      clauses.push(
        Clause_upcast_from_PolyProjectionClause(
          Binder.bind_with_vars<ProjectionClause>(
            {
              projection_term: AliasTerm.new(tcx, { $: "ProjectionTy", def_id: trait_ty.def_id }, rebased_args),
              term: normalize_impl_ty,
            },
            bound_vars,
          ),
          tcx,
        ),
      );
    }
  }

  return ParamEnv.new(tcx, clauses);
}

/// Manually check here that `async fn foo()` wasn't matched against `fn foo()`,
/// and extract a better error if so.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item.rs:2834 try_report_async_mismatch
function try_report_async_mismatch(
  tcx: TyCtxt,
  infcx: InferCtxt,
  errors: readonly FulfillmentError[],
  trait_m: AssocItem,
  impl_m: AssocItem,
  impl_sig: FnSig,
): Result<null, ErrorGuaranteed> {
  if (!Asyncness.is_async(tcx.asyncness(trait_m.def_id) as Asyncness)) {
    return Ok(null);
  }

  const out = FnSig.output(Binder.skip_binder(EarlyBinder.skip_binder(fn_sig_of(tcx, trait_m.def_id)))).kind();
  if (!(out.$ === "Alias" && out._1.kind.$ === "Projection")) {
    bug("expected `async fn` to return an RPITIT");
  }
  const async_future_def_id = out._1.kind.def_id;

  for (const error of errors) {
    const code = error.root_obligation.cause.code_();
    if (code.$ !== "WhereClause" || !DefId_eq(code._0, async_future_def_id)) continue;
    const proj_ = error.root_obligation.predicate.as_projection_clause();
    if (proj_ === undefined) continue;
    const proj = Binder.no_bound_vars(proj_, d_ProjectionClause);
    if (proj === undefined) continue;
    if (infcx.can_eq(error.root_obligation.param_env, Term.expect_type(proj.term), FnSig.output(impl_sig), rustc_infer.infer.at.ToTrace_Ty)) {
      // FIXME: We should suggest making the fn `async`, but extracting
      // the right span is a bit difficult.
      return Err(
        tcx.sess.dcx().emit_err(
          MethodShouldReturnFuture_diagnostic({
            span: tcx.def_span(impl_m.def_id),
            method_name: tcx.item_ident(impl_m.def_id),
            trait_item_span: tcx.hir_span_if_local(trait_m.def_id),
          }),
        ),
      );
    }
  }

  return Ok(null);
}

// ==== Helpers (PORT; no upstream counterpart) ========================================================================

/** `tcx.fn_sig(def_id)`: the query value is `unknown` in queries.gen.ts (`EarlyBinder<PolyFnSig>`). */
function fn_sig_of(tcx: TyCtxt, def_id: DefId): EarlyBinder<Binder<FnSig>> {
  return tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>;
}

/** `Upcast<TyCtxt, P>` descriptors are typed over `Interner` (precedent: rustc_infer opaque_types/mod.ts). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

/** `usize::saturating_sub`. */
function saturating_sub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

/** `TypeFoldable for TraitRef` (generated) as a D4 descriptor (precedent: rustc_middle generics.ts). */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PolyTraitRef: TypeFoldable<Binder<TraitRef>> = fold_Binder(d_TraitRef);
/** `TypeVisitable for ProjectionClause` (generated) as a D4 descriptor. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = { visit_with: visit_with_ProjectionClause, try_fold_with: try_fold_with_ProjectionClause, fold_with: fold_with_ProjectionClause };

// ==== Stand-ins (PORT: other wave-17 lanes and wave 19; see the file header) =========================================

/** `TypeErrCtxt<'_, 'tcx>` (rustc_trait_selection error_reporting, wave 19): the methods this file calls. */
interface TypeErrCtxtView {
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
  note_type_err(
    diag: Diag,
    cause: ObligationCause,
    secondary_span: [Span, string, boolean] | undefined,
    values: ParamEnvAndValuePairs | undefined,
    terr: TypeError,
    prefer_label: boolean,
    override_span: Span | undefined,
  ): void;
  report_region_errors(generic_param_scope: LocalDefId, errors: readonly unknown[]): ErrorGuaranteed;
}

/** `infcx.err_ctxt()` (`InferCtxtErrorExt`, wave 19): its stub stops as UNPORTED; `TypeErrCtxt` is still `Pending`. */
function err_ctxt(infcx: InferCtxt): TypeErrCtxtView {
  return infcx.err_ctxt() as unknown as TypeErrCtxtView;
}
