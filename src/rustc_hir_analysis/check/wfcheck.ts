// Port of compiler/rustc_hir_analysis/src/check/wfcheck.rs (lanes check-wf-a: lines 1–1139, check-wf-b: 1140–end).
//
// PORT notes (file-wide):
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`. `Result::and(self, res)` evaluates `res`
//   eagerly (it is an argument), so `res.and(f(..))` is `and(res, f(..))` with the call made first.
// - `WfCheckingCtxt` derefs to its `ObligationCtxt` (`impl Deref`, wfcheck.rs:57). The members of `ObligationCtxt` that
//   this file reaches through the deref (`infcx`, `register_bound`, `register_obligation`, `register_obligations`,
//   `evaluate_obligations_error_on_ambiguity`) are forwarding members of the class, next to `deref()`.
// - `value: impl TypeFoldable<TyCtxt>` takes the D4 descriptor `d_T` last (plan-m3 D4).
// - `FxIndexSet<(Region, usize)>` / `FxIndexSet<(Ty, usize)>` are `KeyedSet`s keyed by the interned value's `id` and the
//   index; `FxIndexSet<Clause>` is a `Set` (interned objects are their own keys); `FxIndexMap<LocalDefId, _>` is a `Map`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// - The rustc_trait_selection items this file calls that are not ported yet (`ObligationCtxt`, `traits::wf`,
//   `regions::{region,ty}_known_to_outlive`, `misc::type_allowed_to_implement_const_param_ty`, the `TypeErrCtxt`
//   reports) and the items of lanes not in this lane's base (`check::check_item_type`, `const_eval_poly` (M4)) are
//   local stand-ins at the end of the check-wf-a region that stop as UNPORTED.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.

// check-wf-a imports
import { Applicability, E0714, E0750, type Diag, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { DiagSymbolList_from } from "../../rustc_errors/diagnostic_impls.ts";
import type * as hir from "../../rustc_hir/hir.ts";
import { Defaultness, Node as HirNode, debug_Item } from "../../rustc_hir/hir.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { OutlivesEnvironment } from "../../rustc_infer/infer/outlives/env.ts";
import { Obligation, type PredicateObligation, type TraitErrors } from "../../rustc_infer/traits/mod.ts";
import { SHADOWING_SUPERTRAIT_ITEMS } from "../../rustc_lint_defs/builtin.gen.ts";
import { pluralize } from "../../rustc_lint_defs/lib.ts";
import { ObligationCause, ObligationCauseCode, type WellFormedLoc } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems, type AssocItem as AssocItemT } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_List_Ty, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { ImplTraitHeader, ParamEnv, type Term, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import { Region as RegionC } from "../../rustc_type_ir/sty/mod.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { type Clause, Clause_upcast_from_ClauseKind, Predicate_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { display_Clause, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { type DefId, DefId_eq, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Ident, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.gen.ts";
import { FnSig as FnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { Const } from "../../rustc_type_ir/sty/mod.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { SupertraitItemShadowing_diagnostic, type SupertraitItemShadowee } from "../diagnostics.ts";
import { check_impl_wf } from "../impl_wf_check.ts";

/** PORT: `impl Upcast<TyCtxt, Predicate> for ClauseKind` takes `TyCtxt` where `Obligation::new` names the `Interner`. */
function as_obligation_upcast<T, U>(upcast: (from: T, tcx: TyCtxt) => U): (from: T, tcx: Interner) => U {
  return upcast as unknown as (from: T, tcx: Interner) => U;
}

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:52 WfCheckingCtxt
export class WfCheckingCtxt {
  constructor(
    public ocx: ObligationCtxt,
    // PORT: private upstream; the rest of the file (lane check-wf-b) reads them.
    public body_def_id: LocalDefId,
    public param_env: ParamEnv,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:59 deref
  deref(): ObligationCtxt {
    return this.ocx;
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::infcx`. */
  get infcx(): InferCtxt {
    return this.deref().infcx;
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_bound`. */
  register_bound(cause: ObligationCause, param_env: ParamEnv, ty: Ty, def_id: DefId): void {
    this.deref().register_bound(cause, param_env, ty, def_id);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_obligation`. */
  register_obligation(obligation: PredicateObligation): void {
    this.deref().register_obligation(obligation);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::register_obligations`. */
  register_obligations(obligations: Iterable<PredicateObligation>): void {
    this.deref().register_obligations(obligations);
  }

  /** PORT: `Deref` to `ObligationCtxt`: `ObligationCtxt::evaluate_obligations_error_on_ambiguity`. */
  evaluate_obligations_error_on_ambiguity(): TraitErrors<FulfillmentError> {
    return this.deref().evaluate_obligations_error_on_ambiguity();
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:65 tcx
  tcx(): TyCtxt {
    return this.ocx.infcx.tcx;
  }

  // Convenience function to normalize during wfcheck. This performs
  // `ObligationCtxt::normalize`, but provides a nice `ObligationCauseCode`.
  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:71 normalize
  normalize<T>(span: Span, loc: WellFormedLoc, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
    return this.ocx.normalize(
      ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc }),
      this.param_env,
      value,
      d_T,
    );
  }

  /// Convenience function to *deeply* normalize during wfcheck. In the old solver,
  /// this just dispatches to [`WfCheckingCtxt::normalize`], but in the new solver
  /// this calls `deeply_normalize` and reports errors if they are encountered.
  ///
  /// This function should be called in favor of `normalize` in cases where we will
  /// then check the well-formedness of the type, since we only use the normalized
  /// signature types for implied bounds when checking regions.
  // FIXME(-Znext-solver): This should be removed when we compute implied outlives
  // bounds using the unnormalized signature of the function we're checking.
  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:91 deeply_normalize
  deeply_normalize<T>(span: Span, loc: WellFormedLoc, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
    if (this.infcx.next_trait_solver()) {
      const r = this.ocx.deeply_normalize(
        ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc }),
        this.param_env,
        Unnormalized.as_ref(value),
        d_T,
      );
      if (r.$ === "Ok") {
        return r._0;
      } else {
        const errors = r._0;
        TypeErrCtxt_report_fulfillment_errors(this.infcx, errors);
        return Unnormalized.skip_norm_wip(value);
      }
    } else {
      return this.normalize(span, loc, value, d_T);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:117 register_wf_obligation
  register_wf_obligation(span: Span, loc: WellFormedLoc, term: Term): void {
    const cause = ObligationCause.new(span, this.body_def_id, { $: "WellFormed", _0: loc });
    this.ocx.register_obligation(
      Obligation.new(this.tcx(), cause, this.param_env, { $: "WellFormed", _0: term } as ClauseKind, as_obligation_upcast(Predicate_upcast_from_ClauseKind)),
    );
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:136 unnormalized_obligations
  unnormalized_obligations(span: Span, ty: Ty): PredicateObligation[] | undefined {
    return wf_unnormalized_obligations(this.ocx.infcx, this.param_env, ty, span, this.body_def_id);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:151 enter_wf_checking_ctxt
export function enter_wf_checking_ctxt(
  tcx: TyCtxt,
  body_def_id: LocalDefId,
  f: (wfcx: WfCheckingCtxt) => Result<null, ErrorGuaranteed>,
): Result<null, ErrorGuaranteed> {
  const param_env = tcx.param_env(body_def_id) as ParamEnv;
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt_new_with_diagnostics(infcx);

  const wfcx = new WfCheckingCtxt(ocx, body_def_id, param_env);

  // As of now, bounds are only enforced on checked type aliases, they're ignored for most type
  // aliases. So, only check for false global bounds if we're not ignoring bounds altogether.
  const ignore_bounds = tcx.def_kind(body_def_id).$ === "TyAlias" && !(tcx.type_alias_is_checked(body_def_id) as boolean);

  if (!ignore_bounds && !tcx.features().trivial_bounds()) {
    wfcx.check_false_global_bounds();
  }
  const r = f(wfcx);
  if (r.$ === "Err") return r;

  const errors = wfcx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    return Err(TypeErrCtxt_report_fulfillment_errors(infcx, errors._0));
  }

  const assumed_wf_types_r = wfcx.ocx.assumed_wf_types_and_report_errors(param_env, body_def_id);
  if (assumed_wf_types_r.$ === "Err") return assumed_wf_types_r;
  const assumed_wf_types = assumed_wf_types_r._0;
  // debug!(?assumed_wf_types);

  const infcx_compat = infcx.fork();

  // We specifically want to *disable* the implied bounds hack, first,
  // so we can detect when failures are due to bevy's implied bounds.
  const outlives_env = OutlivesEnvironment.new_with_implied_bounds_compat(
    infcx,
    body_def_id,
    param_env,
    [...assumed_wf_types],
    true,
  );

  lint_redundant_lifetimes(tcx, body_def_id, outlives_env);

  const errors_ = infcx.resolve_regions_with_outlives_env(outlives_env);
  if (errors_.length === 0) {
    return Ok(null);
  }

  const outlives_env_ = OutlivesEnvironment.new_with_implied_bounds_compat(
    infcx_compat,
    body_def_id,
    param_env,
    assumed_wf_types,
    // Don't *disable* the implied bounds hack; though this will only apply
    // the implied bounds hack if this contains `bevy_ecs`'s `ParamSet` type.
    false,
  );
  const errors_compat = infcx_compat.resolve_regions_with_outlives_env(outlives_env_);
  if (errors_compat.length === 0) {
    // FIXME: Once we fix bevy, this would be the place to insert a warning
    // to upgrade bevy.
    return Ok(null);
  } else {
    return Err(TypeErrCtxt_report_region_errors(infcx_compat, body_def_id, errors_compat));
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:221 check_well_formed
export function check_well_formed(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  let res = check_check_item_type(tcx, def_id);

  for (const param of (tcx.generics_of(def_id) as Generics).own_params) {
    res = and(res, check_param_wf(tcx, param));
  }

  return res;
}

/// Checks that the field types (in a struct def'n) or argument types (in an enum def'n) are
/// well-formed, meaning that they do not require any constraints not declared in the struct
/// definition itself. For example, this definition would be illegal:
///
/// ```rust
/// struct StaticRef<T> { x: &'static T }
/// ```
///
/// because the type did not declare that `T: 'static`.
///
/// We do this check as a pre-pass before checking fn bodies because if these constraints are
/// not included it frequently leads to confusing errors in fn bodies. So it's better to check
/// the types first.
// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:248 check_item
export function check_item(tcx: TyCtxt, item: hir.Item): Result<null, ErrorGuaranteed> {
  const def_id = item.owner_id.def_id;

  // debug!(
  //     ?item.owner_id,
  //     item.name = ? tcx.def_path_str(def_id)
  // );

  const kind = item.kind;
  switch (kind.$) {
    // Right now we check that every default trait implementation
    // has an implementation of itself. Basically, a case like:
    //
    //     impl Trait for T {}
    //
    // has a requirement of `T: Trait` which was required for default
    // method implementations. Although this could be improved now that
    // there's a better infrastructure in place for this, it's being left
    // for a follow-up work.
    //
    // Since there's such a requirement, we need to check *just* positive
    // implementations, otherwise things like:
    //
    //     impl !Send for T {}
    //
    // won't be allowed unless there's an *explicit* implementation of `Send`
    // for `T`
    case "Impl": {
      const impl_ = kind._0;
      const r = check_impl_wf(tcx, def_id, impl_.of_trait !== undefined);
      if (r.$ === "Err") return r;
      let res: Result<null, ErrorGuaranteed> = Ok(null);
      const of_trait = impl_.of_trait;
      if (of_trait !== undefined) {
        const header = tcx.impl_trait_header(def_id) as ImplTraitHeader;
        const is_auto = tcx.trait_is_auto(EarlyBinder.skip_binder(header.trait_ref).def_id);
        if (of_trait.defaultness.$ === "Default" && is_auto) {
          const sp = of_trait.trait_ref.path.span;
          res = Err(
            tcx
              .dcx()
              .struct_span_err(sp, "impls of auto traits cannot be default")
              .with_span_labels(of_trait.defaultness_span === undefined ? [] : [of_trait.defaultness_span], "default because of this")
              .with_span_label(sp, "auto trait")
              .emit_err(),
          );
        }
        switch (header.polarity) {
          case "Positive": {
            res = and(res, check_impl(tcx, item, impl_));
            break;
          }
          case "Negative": {
            if (of_trait.polarity.$ !== "Negative") {
              return bug("impl_polarity query disagrees with impl's polarity in HIR");
            }
            const span = of_trait.polarity._0;
            // FIXME(#27579): what amount of WF checking do we need for neg impls?
            if (of_trait.defaultness.$ === "Default") {
              const spans = [span];
              if (of_trait.defaultness_span !== undefined) spans.push(of_trait.defaultness_span);
              res = Err(struct_span_code_err(tcx.dcx(), spans, E0750, "negative impls cannot be default impls").emit_err());
            }
            break;
          }
        }
      } else {
        res = and(res, check_impl(tcx, item, impl_));
      }
      return res;
    }
    case "Fn":
      return check_item_fn(tcx, def_id, kind.sig.decl);
    // Note: do not add new entries to this match. Instead add all new logic in `check_item_type`
    default:
      return span_bug(item.span, `should have been handled by the type based wf check: ${debug_Item(item, PLAIN)}`);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:325 check_foreign_item
export function check_foreign_item(tcx: TyCtxt, item: hir.ForeignItem): Result<null, ErrorGuaranteed> {
  const def_id = item.owner_id.def_id;

  // debug!(
  //     ?item.owner_id,
  //     item.name = ? tcx.def_path_str(def_id)
  // );

  const kind = item.kind;
  switch (kind.$) {
    case "Fn":
      return check_item_fn(tcx, def_id, kind._0.decl);
    case "Static":
    case "Type":
      return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:342 check_trait_item
export function check_trait_item(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  // Check that an item definition in a subtrait is shadowing a supertrait item.
  lint_item_shadowing_supertrait_item(tcx, def_id);

  let res: Result<null, ErrorGuaranteed> = Ok(null);

  if (tcx.def_kind(def_id).$ === "AssocFn") {
    for (const assoc_ty_def_id of tcx.associated_types_for_impl_traits_in_associated_fn(LocalDefIdC.to_def_id(def_id))) {
      res = and(res, check_associated_item(tcx, assoc_ty_def_id.expect_local()));
    }
  }
  return res;
}

/// Require that the user writes where clauses on GATs for the implicit
/// outlives bounds involving trait parameters in trait functions and
/// lifetimes passed as GAT args. See `self-outlives-lint` test.
///
/// We use the following trait as an example throughout this function:
/// ```rust,ignore (this code fails due to this lint)
/// trait IntoIter {
///     type Iter<'a>: Iterator<Item = Self::Item<'a>>;
///     type Item<'a>;
///     fn into_iter<'a>(&'a self) -> Self::Iter<'a>;
/// }
/// ```
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:373 check_gat_where_clauses
export function check_gat_where_clauses(tcx: TyCtxt, trait_def_id: LocalDefId): void {
  // Associates every GAT's def_id to a list of possibly missing bounds detected by this lint.
  const required_bounds_by_item = new Map<LocalDefId, Set<Clause>>();
  const associated_items = tcx.associated_items(trait_def_id) as AssocItems;

  // Loop over all GATs together, because if this lint suggests adding a where-clause bound
  // to one GAT, it might then require us to an additional bound on another GAT.
  // In our `IntoIter` example, we discover a missing `Self: 'a` bound on `Iter<'a>`, which
  // then in a second loop adds a `Self: 'a` bound to `Item` due to the relationship between
  // those GATs.
  for (;;) {
    let should_continue = false;
    for (const gat_item_ of AssocItems.in_definition_order(associated_items)) {
      const gat_def_id = gat_item_.def_id.expect_local();
      const gat_item = tcx.associated_item(gat_def_id) as AssocItemT;
      // If this item is not an assoc ty, or has no args, then it's not a GAT
      if (!AssocItem.is_type(gat_item)) {
        continue;
      }
      const gat_generics = tcx.generics_of(gat_def_id) as Generics;
      // FIXME(jackh726): we can also warn in the more general case
      if (gat_generics.is_own_empty()) {
        continue;
      }

      // Gather the bounds with which all other items inside of this trait constrain the GAT.
      // This is calculated by taking the intersection of the bounds that each item
      // constrains the GAT with individually.
      let new_required_bounds: Set<Clause> | undefined = undefined;
      for (const item of AssocItems.in_definition_order(associated_items)) {
        const item_def_id = item.def_id.expect_local();
        // Skip our own GAT, since it does not constrain itself at all.
        if (item_def_id === gat_def_id) {
          continue;
        }

        const param_env = tcx.param_env(item_def_id) as ParamEnv;

        let item_required_bounds: Set<Clause> | undefined;
        const item_kind = (tcx.associated_item(item_def_id) as AssocItemT).kind;
        switch (item_kind.$) {
          // In our example, this corresponds to `into_iter` method
          case "Fn": {
            // For methods, we check the function signature's return type for any GATs
            // to constrain. In the `into_iter` case, we see that the return type
            // `Self::Iter<'a>` is a GAT we want to gather any potential missing bounds from.
            const sig: FnSig = tcx.liberate_late_bound_regions(
              LocalDefIdC.to_def_id(item_def_id),
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item_def_id) as EarlyBinder<Binder<FnSig>>)),
              d_FnSig,
            );
            item_required_bounds = gather_gat_bounds(
              tcx,
              param_env,
              item_def_id,
              sig.inputs_and_output,
              // We also assume that all of the function signature's parameter types
              // are well formed.
              new Set(FnSigC.inputs(sig)),
              gat_def_id,
              gat_generics,
              fold_List_Ty,
            );
            break;
          }
          // In our example, this corresponds to the `Iter` and `Item` associated types
          case "Type": {
            // If our associated item is a GAT with missing bounds, add them to
            // the param-env here. This allows this GAT to propagate missing bounds
            // to other GATs.
            const param_env_ = augment_param_env(tcx, param_env, required_bounds_by_item.get(item_def_id));
            item_required_bounds = gather_gat_bounds(
              tcx,
              param_env_,
              item_def_id,
              [
                ...EarlyBinder.iter_identity_copied(tcx.explicit_item_bounds(item_def_id) as EarlyBinder<readonly [Clause, Span][]>),
              ].map(Unnormalized.skip_norm_wip),
              new Set(),
              gat_def_id,
              gat_generics,
              d_Vec_Clause_Span,
            );
            break;
          }
          case "Const":
            item_required_bounds = undefined;
            break;
        }

        if (item_required_bounds !== undefined) {
          // Take the intersection of the required bounds for this GAT, and
          // the item_required_bounds which are the ones implied by just
          // this item alone.
          // This is why we use an Option<_>, since we need to distinguish
          // the empty set of bounds from the _uninitialized_ set of bounds.
          if (new_required_bounds !== undefined) {
            for (const b of new_required_bounds) {
              if (!item_required_bounds.has(b)) new_required_bounds.delete(b);
            }
          } else {
            new_required_bounds = item_required_bounds;
          }
        }
      }

      if (new_required_bounds !== undefined) {
        let required_bounds = required_bounds_by_item.get(gat_def_id);
        if (required_bounds === undefined) {
          required_bounds = new Set();
          required_bounds_by_item.set(gat_def_id, required_bounds);
        }
        // PORT: `.any(|p| required_bounds.insert(p))` stops at the first newly inserted bound.
        let any = false;
        for (const p of new_required_bounds) {
          const inserted = !required_bounds.has(p);
          required_bounds.add(p);
          if (inserted) {
            any = true;
            break;
          }
        }
        if (any) {
          // Iterate until our required_bounds no longer change
          // Since they changed here, we should continue the loop
          should_continue = true;
        }
      }
    }
    // We know that this loop will eventually halt, since we only set `should_continue` if the
    // `required_bounds` for this item grows. Since we are not creating any new region or type
    // variables, the set of all region and type bounds that we could ever insert are limited
    // by the number of unique types and regions we observe in a given item.
    if (!should_continue) {
      break;
    }
  }

  for (const [gat_def_id, required_bounds] of required_bounds_by_item) {
    // Don't suggest adding `Self: 'a` to a GAT that can't be named
    if (tcx.is_impl_trait_in_trait(LocalDefIdC.to_def_id(gat_def_id))) {
      continue;
    }

    const gat_item_hir = tcx.hir_expect_trait_item(gat_def_id);
    // debug!(?required_bounds);
    const param_env = tcx.param_env(gat_def_id) as ParamEnv;

    const unsatisfied_bounds: string[] = [...required_bounds]
      .filter((clause) => {
        const k = Binder.skip_binder(clause.kind());
        switch (k.$) {
          case "RegionOutlives": {
            const [a, b] = [k._0._0, k._0._1];
            return !region_known_to_outlive(tcx, gat_def_id, param_env, new Set(), a, b);
          }
          case "TypeOutlives": {
            const [a, b] = [k._0._0, k._0._1];
            return !ty_known_to_outlive(tcx, gat_def_id, param_env, new Set(), Unnormalized.new_wip(a), b);
          }
          default:
            return bug("Unexpected ClauseKind");
        }
      })
      .map((clause) => display_Clause(clause));

    if (unsatisfied_bounds.length !== 0) {
      const plural = pluralize(unsatisfied_bounds.length);
      const suggestion = `${gat_item_hir.generics.add_where_or_trailing_comma()} ${unsatisfied_bounds.join(", ")}`;
      const bound = unsatisfied_bounds.length > 1 ? "these bounds are" : "this bound is";
      tcx
        .dcx()
        .struct_span_err(gat_item_hir.span, `missing required bound${plural} on \`${display_Ident(gat_item_hir.ident)}\``)
        .with_span_suggestion(
          gat_item_hir.generics.tail_span_for_predicate_suggestion(),
          `add the required where clause${plural}`,
          suggestion,
          Applicability.MachineApplicable,
        )
        .with_note(`${bound} currently required to ensure that impls have maximum flexibility`)
        .with_note(
          "we are soliciting feedback, see issue #87479 " + "<https://github.com/rust-lang/rust/issues/87479> for more information",
        )
        .emit();
    }
  }
}

/// Add a new set of predicates to the caller_bounds of an existing param_env.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:560 augment_param_env
function augment_param_env(tcx: TyCtxt, param_env: ParamEnv, new_clauses: Set<Clause> | undefined): ParamEnv {
  if (new_clauses === undefined) {
    return param_env;
  }

  if (new_clauses.size === 0) {
    return param_env;
  }

  const bounds = [...param_env.caller_bounds(), ...new_clauses];
  // FIXME(compiler-errors): Perhaps there is a case where we need to normalize this
  // i.e. traits::normalize_param_env_or_error
  return ParamEnv.new(tcx, bounds);
}

/// We use the following trait as an example throughout this function.
/// Specifically, let's assume that `to_check` here is the return type
/// of `into_iter`, and the GAT we are checking this for is `Iter`.
/// ```rust,ignore (this code fails due to this lint)
/// trait IntoIter {
///     type Iter<'a>: Iterator<Item = Self::Item<'a>>;
///     type Item<'a>;
///     fn into_iter<'a>(&'a self) -> Self::Iter<'a>;
/// }
/// ```
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:589 gather_gat_bounds
function gather_gat_bounds<T>(
  tcx: TyCtxt,
  param_env: ParamEnv,
  item_def_id: LocalDefId,
  to_check: T,
  wf_tys: Set<Ty>,
  gat_def_id: LocalDefId,
  gat_generics: Generics,
  d_T: TypeFoldable<T>,
): Set<Clause> | undefined {
  // The bounds we that we would require from `to_check`
  const bounds = new Set<Clause>();

  const [regions, types] = GATArgsCollector.visit(LocalDefIdC.to_def_id(gat_def_id), to_check, d_T);

  // If both regions and types are empty, then this GAT isn't in the
  // set of types we are checking, and we shouldn't try to do clause analysis
  // (particularly, doing so would end up with an empty set of clauses,
  // since the current method would require none, and we take the
  // intersection of requirements of all methods)
  if (types.size === 0 && regions.size === 0) {
    return undefined;
  }

  for (const [region_a, region_a_idx] of regions) {
    // Ignore `'static` lifetimes for the purpose of this lint: it's
    // because we know it outlives everything and so doesn't give meaningful
    // clues. Also ignore `ReError`, to avoid knock-down errors.
    const ka = region_a.kind();
    if (ka.$ === "ReStatic" || ka.$ === "ReError") {
      continue;
    }
    // For each region argument (e.g., `'a` in our example), check for a
    // relationship to the type arguments (e.g., `Self`). If there is an
    // outlives relationship (`Self: 'a`), then we want to ensure that is
    // reflected in a where clause on the GAT itself.
    for (const [ty, ty_idx] of types) {
      // In our example, requires that `Self: 'a`
      if (ty_known_to_outlive(tcx, item_def_id, param_env, wf_tys, Unnormalized.new_wip(ty), region_a)) {
        // debug!(?ty_idx, ?region_a_idx);
        // debug!("required clause: {ty} must outlive {region_a}");
        // Translate into the generic parameters of the GAT. In
        // our example, the type was `Self`, which will also be
        // `Self` in the GAT.
        const ty_param_ = gat_generics.param_at(ty_idx, tcx);
        const ty_param = Ty.new_param(tcx, ty_param_.index, ty_param_.name);
        // Same for the region. In our example, 'a corresponds
        // to the 'me parameter.
        const region_param_ = gat_generics.param_at(region_a_idx, tcx);
        const region_param = RegionC.new_early_param(tcx, { index: region_param_.index, name: region_param_.name });
        // The clause we expect to see. (In our example,
        // `Self: 'me`.)
        bounds.add(Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: ty_param, _1: region_param } }, tcx));
      }
    }

    // For each region argument (e.g., `'a` in our example), also check for a
    // relationship to the other region arguments. If there is an outlives
    // relationship, then we want to ensure that is reflected in the where clause
    // on the GAT itself.
    for (const [region_b, region_b_idx] of regions) {
      // Again, skip `'static` because it outlives everything. Also, we trivially
      // know that a region outlives itself. Also ignore `ReError`, to avoid
      // knock-down errors.
      const kb = region_b.kind();
      if (kb.$ === "ReStatic" || kb.$ === "ReError" || region_a === region_b) {
        continue;
      }
      if (region_known_to_outlive(tcx, item_def_id, param_env, wf_tys, region_a, region_b)) {
        // debug!(?region_a_idx, ?region_b_idx);
        // debug!("required clause: {region_a} must outlive {region_b}");
        // Translate into the generic parameters of the GAT.
        const region_a_param_ = gat_generics.param_at(region_a_idx, tcx);
        const region_a_param = RegionC.new_early_param(tcx, { index: region_a_param_.index, name: region_a_param_.name });
        // Same for the region.
        const region_b_param_ = gat_generics.param_at(region_b_idx, tcx);
        const region_b_param = RegionC.new_early_param(tcx, { index: region_b_param_.index, name: region_b_param_.name });
        // The clause we expect to see.
        bounds.add(Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: region_a_param, _1: region_b_param } }, tcx));
      }
    }
  }

  return bounds;
}

/// TypeVisitor that looks for uses of GATs like
/// `<P0 as Trait<P1..Pn>>::GAT<Pn..Pm>` and adds the arguments `P0..Pm` into
/// the two vectors, `regions` and `types` (depending on their kind). For each
/// parameter `Pi` also track the index `i`.
// rustc-type: compiler/rustc_hir_analysis/src/check/wfcheck.rs:701 GATArgsCollector
class GATArgsCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public gat: DefId,
    // Which region appears and which parameter index its instantiated with
    public regions: KeyedSet<[Region, number]>,
    // Which params appears and which parameter index its instantiated with
    public types: KeyedSet<[Ty, number]>,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:710 visit
  static visit<T>(gat: DefId, t: T, d_T: TypeFoldable<T>): [KeyedSet<[Region, number]>, KeyedSet<[Ty, number]>] {
    const visitor = new GATArgsCollector(gat, new KeyedSet<[Region, number]>(key_interned_usize), new KeyedSet<[Ty, number]>(key_interned_usize));
    d_T.visit_with(t, visitor);
    return [visitor.regions, visitor.types];
  }

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<U>(t: Binder<U>, d: TypeVisitable<U>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:722 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && DefId_eq(k._1.kind.def_id, this.gat)) {
      const args = k._1.args;
      let idx = 0;
      for (const arg of args) {
        const ak = GenericArg.kind(arg);
        switch (ak.$) {
          case "Lifetime": {
            const lt = ak._0;
            if (!lt.is_bound()) {
              this.regions.add([lt, idx]);
            }
            break;
          }
          case "Type": {
            this.types.add([ak._0, idx]);
            break;
          }
          default:
            break;
        }
        idx += 1;
      }
    }
    return fold_Ty.super_visit_with(t, this);
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** PORT: the `Hash`+`Eq` of `(Region<'tcx>, usize)` / `(Ty<'tcx>, usize)` (interned by identity, so by `id`). */
function key_interned_usize<T extends { id: number }>(k: [T, number]): string {
  return `${k[0].id}:${k[1]}`;
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:745 lint_item_shadowing_supertrait_item
function lint_item_shadowing_supertrait_item(tcx: TyCtxt, trait_item_def_id: LocalDefId): void {
  const item_name = tcx.item_name(LocalDefIdC.to_def_id(trait_item_def_id));
  const trait_def_id = tcx.local_parent(trait_item_def_id);

  const shadowed: AssocItemT[] = [...supertrait_def_ids(tcx, LocalDefIdC.to_def_id(trait_def_id))]
    .slice(1)
    .flatMap((supertrait_def_id) => [
      ...AssocItems.filter_by_name_unhygienic(tcx.associated_items(supertrait_def_id) as AssocItems, item_name),
    ]);
  if (shadowed.length !== 0) {
    let shadowee: SupertraitItemShadowee;
    if (shadowed.length === 1) {
      const shadowed_ = shadowed[0]!;
      shadowee = {
        $: "Labeled",
        span: tcx.def_span(shadowed_.def_id),
        supertrait: tcx.item_name(AssocItem.trait_container(shadowed_, tcx)!),
      };
    } else {
      const traits: Symbol[] = [];
      const spans: Span[] = [];
      for (const item of shadowed) {
        traits.push(tcx.item_name(AssocItem.trait_container(item, tcx)!));
        spans.push(tcx.def_span(item.def_id));
      }
      shadowee = {
        $: "Several",
        traits: DiagSymbolList_from(traits),
        spans: MultiSpan.from_spans(spans),
      };
    }

    tcx.emit_node_span_lint(
      SHADOWING_SUPERTRAIT_ITEMS,
      tcx.local_def_id_to_hir_id(trait_item_def_id),
      tcx.def_span(LocalDefIdC.to_def_id(trait_item_def_id)),
      SupertraitItemShadowing_diagnostic({
        item: item_name,
        subtrait: tcx.item_name(LocalDefIdC.to_def_id(trait_def_id)),
        shadowee,
      }),
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:787 check_param_wf
function check_param_wf(tcx: TyCtxt, param: GenericParamDef): Result<null, ErrorGuaranteed> {
  switch (param.kind.$) {
    // We currently only check wf of const params here.
    case "Lifetime":
    case "Type":
      return Ok(null);

    // Const parameters are well formed if their type is structural match.
    case "Const": {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param.def_id) as EarlyBinder<Ty>));
      const span = tcx.def_span(param.def_id);
      const def_id = param.def_id.expect_local();

      if (tcx.features().const_param_ty_unchecked()) {
        return enter_wf_checking_ctxt(tcx, tcx.local_parent(def_id), (wfcx) => {
          wfcx.register_wf_obligation(span, WellFormedLoc_None, ty);
          return Ok(null);
        });
      } else if (tcx.features().adt_const_params() || tcx.features().min_adt_const_params()) {
        return enter_wf_checking_ctxt(tcx, tcx.local_parent(def_id), (wfcx) => {
          wfcx.register_bound(
            ObligationCause.new(span, def_id, { $: "ConstParam", _0: ty }),
            wfcx.param_env,
            ty,
            tcx.require_lang_item(LangItem.ConstParamTy, span),
          );
          return Ok(null);
        });
      } else {
        const span_ = (): Span => {
          const kind = HirNode.expect_generic_param(tcx.hir_node_by_def_id(def_id)).kind;
          if (kind.$ !== "Const") {
            return bug();
          }
          const span = kind.ty.span;
          return span;
        };
        let diag: Diag;
        const k = ty.kind();
        switch (k.$) {
          case "Bool":
          case "Char":
          case "Int":
          case "Uint":
          case "Error":
            return Ok(null);
          case "FnPtr":
            diag = tcx.dcx().struct_span_err(span_(), "using function pointers as const generic parameters is forbidden");
            break;
          case "RawPtr":
            diag = tcx.dcx().struct_span_err(span_(), "using raw pointers as const generic parameters is forbidden");
            break;
          default: {
            // Avoid showing "{type error}" to users. See #118179.
            const r = TypeVisitableExt.error_reported(ty, fold_Ty);
            if (r.$ === "Err") return r;

            diag = tcx.dcx().struct_span_err(span_(), `\`${display_Ty(ty)}\` is forbidden as the type of a const generic parameter`);
            break;
          }
        }

        diag.note("the only supported types are integers, `bool`, and `char`");

        const cause = ObligationCause.misc(span_(), def_id);
        const adt_const_params_feature_string = " more complex and user defined types";
        let may_suggest_feature: [string, Symbol][] | undefined;
        const res = type_allowed_to_implement_const_param_ty(tcx, tcx.param_env(param.def_id) as ParamEnv, ty, cause);
        if (res.$ === "Err") {
          switch (res._0.$) {
            // Can never implement `ConstParamTy`, don't suggest anything.
            case "NotAnAdtOrBuiltinAllowed":
            case "NonExhaustive":
            case "InvalidInnerTyOfBuiltinTy":
              may_suggest_feature = undefined;
              break;
            case "UnsizedConstParamsFeatureRequired":
              may_suggest_feature = [
                [adt_const_params_feature_string, sym.min_adt_const_params],
                [" references to implement the `ConstParamTy` trait", sym.unsized_const_params],
              ];
              break;
            // May be able to implement `ConstParamTy`. Only emit the feature help
            // if the type is local, since the user may be able to fix the local type.
            case "InfrigingFields": {
              may_suggest_feature = ty_is_local(ty) ? [[adt_const_params_feature_string, sym.min_adt_const_params]] : undefined;
              break;
            }
          }
        } else {
          // Implements `ConstParamTy`, suggest adding the feature to enable.
          may_suggest_feature = [[adt_const_params_feature_string, sym.min_adt_const_params]];
        }
        if (may_suggest_feature !== undefined) {
          const features = may_suggest_feature;
          tcx.disabled_nightly_features(diag, features);
        }

        return Err(diag.emit_err());
      }
    }
  }
}

// PORT: the fn item nested in `check_param_wf` (wfcheck.rs:874).
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:874 ty_is_local
function ty_is_local(ty: Ty): boolean {
  const k = ty.kind();
  switch (k.$) {
    case "Adt":
      return k._0.did().is_local();
    // Arrays and slices use the inner type's `ConstParamTy`.
    case "Array":
    case "Slice":
      return ty_is_local(k._0);
    // `&` references use the inner type's `ConstParamTy`.
    // `&mut` are not supported.
    case "Ref":
      if (k._2 === "Not") return ty_is_local(k._1);
      return false;
    // Say that a tuple is local if any of its components are local.
    // This is not strictly correct, but it's likely that the user can fix the local component.
    case "Tuple":
      return [...k._0].some((ty) => ty_is_local(ty));
    default:
      return false;
  }
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:910 check_associated_item
export function check_associated_item(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const loc: WellFormedLoc = { $: "Ty", _0: def_id };
  return enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
    const item = tcx.associated_item(def_id) as AssocItemT;

    // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for Foo` in case
    // other `Foo` impls are incoherent.
    const trait_item = AssocItem.trait_item_or_self(item);
    if (trait_item.$ === "Err") return trait_item;
    const r = tcx.ensure_result().coherent_trait(tcx.parent(trait_item._0));
    if (r.$ === "Err") return r;

    let self_ty: Ty;
    switch (item.container.$) {
      case "Trait":
        self_ty = tcx.types.self_param;
        break;
      case "InherentImpl":
      case "TraitImpl":
        self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(AssocItem.container_id(item, tcx)) as EarlyBinder<Ty>));
        break;
    }

    const span = tcx.def_span(LocalDefIdC.to_def_id(def_id));

    switch (item.kind.$) {
      case "Const": {
        const ty_ = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
        const ty = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, ty_, fold_Ty);
        wfcx.register_wf_obligation(span, loc, ty);

        if (Defaultness.has_value(AssocItem.defaultness(item, tcx))) {
          const code = ObligationCauseCode.SizedConstOrStatic;
          wfcx.register_bound(ObligationCause.new(span, def_id, code), wfcx.param_env, ty, tcx.require_lang_item(LangItem.Sized, span));
        }

        return check_const_item(wfcx, def_id, ty);
      }
      case "Fn": {
        const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
        const hir_sig = unwrap(HirNode.fn_sig(tcx.hir_node_by_def_id(def_id)), "bad signature for method");
        check_fn_or_method(wfcx, sig, hir_sig.decl, def_id);
        return check_method_receiver(wfcx, hir_sig, item, self_ty);
      }
      case "Type": {
        if (item.container.$ === "Trait") {
          check_associated_type_bounds(wfcx, item, span);
        }
        if (Defaultness.has_value(AssocItem.defaultness(item, tcx))) {
          const ty_ = EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
          const ty = wfcx.deeply_normalize(span, { $: "Ty", _0: def_id }, ty_, fold_Ty);
          wfcx.register_wf_obligation(span, loc, ty);
        }
        return Ok(null);
      }
    }
  });
}

/// In a type definition, we check that to ensure that the types of the fields are well-formed.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:972 check_type_defn
export function check_type_defn(tcx: TyCtxt, item: LocalDefId, all_sized_: boolean): Result<null, ErrorGuaranteed> {
  tcx.ensure_ok().check_representability(item);
  const adt_def = tcx.adt_def(item) as AdtDef;

  return enter_wf_checking_ctxt(tcx, item, (wfcx) => {
    const variants = adt_def.variants();
    const packed = adt_def.repr().packed();

    for (const variant of variants) {
      // All field types must be well-formed.
      for (const field of variant.fields) {
        const def_id = field.value;
        if (def_id !== undefined && EarlyBinder.no_bound_vars(tcx.type_of(def_id) as EarlyBinder<Ty>, fold_Ty) !== undefined) {
          // FIXME(generic_const_exprs, default_field_values): this is a hack and needs to
          // be refactored to check the instantiate-ability of the code better.
          const local = def_id.as_local();
          let is_bare_const_param = false;
          if (local !== undefined && tcx.def_kind(local).$ === "AnonConst") {
            const node = tcx.hir_node_by_def_id(local);
            if (node.$ === "AnonConst") {
              const anon = node._0;
              const expr = tcx.hir_body(anon.body).value;
              if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined) {
                const path = expr.kind._0._1;
                if (path.res.$ === "Def" && path.res._0.$ === "ConstParam") {
                  is_bare_const_param = true;
                }
              }
            }
          }
          if (is_bare_const_param) {
            // Do not evaluate bare `const` params, as those would ICE and are only
            // usable if `#![feature(generic_const_exprs)]` is enabled.
          } else {
            // Evaluate the constant proactively, to emit an error if the constant has
            // an unconditional error. We only do so if the const has no type params.
            const_eval_poly(tcx, def_id);
          }
        }
        const field_id = field.did.expect_local();
        const span = tcx.ty_span(field_id);
        const ty = wfcx.deeply_normalize(
          span,
          WellFormedLoc_None,
          EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>),
          fold_Ty,
        );
        wfcx.register_wf_obligation(span, { $: "Ty", _0: field_id }, ty);

        const tk = ty.kind();
        if (tk.$ === "Adt" && tk._0.repr().is_scalable() && !(adt_def.repr().scalable?.$ === "Container")) {
          // Scalable vectors can only be fields of structs if the type has a
          // `rustc_scalable_vector` attribute w/out specifying an element count
          tcx.dcx().span_err(span, `scalable vectors cannot be fields of a ${adt_def.variant_descr()}`);
        }
      }

      // For DST, or when drop needs to copy things around, all
      // intermediate types must be sized.
      const needs_drop_copy = (): boolean => {
        if (!packed) return false;
        let ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(variant.tail().did) as EarlyBinder<Ty>));
        ty = tcx.erase_and_anonymize_regions(ty, fold_Ty);
        assert(!TypeVisitableExt.has_infer(ty, fold_Ty), "assertion failed: !ty.has_infer()");
        return ty.needs_drop(tcx, wfcx.infcx.typing_env(wfcx.param_env));
      };
      // All fields (except for possibly the last) should be sized.
      const all_sized = all_sized_ || variant.fields.length === 0 || needs_drop_copy();
      const unsized_len = all_sized ? 0 : 1;
      const sized_fields = variant.fields.slice(0, variant.fields.length - unsized_len);
      for (let idx = 0; idx < sized_fields.length; idx++) {
        const field = sized_fields[idx]!;
        const last = idx === variant.fields.length - 1;
        const span = tcx.ty_span(field.did.expect_local());
        const ty = wfcx.normalize(span, WellFormedLoc_None, EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>), fold_Ty);
        wfcx.register_bound(
          ObligationCause.new(span, wfcx.body_def_id, {
            $: "FieldSized",
            adt_kind: adt_def.adt_kind(),
            span,
            last,
          }),
          wfcx.param_env,
          ty,
          tcx.require_lang_item(LangItem.Sized, span),
        );
      }

      // Explicit `enum` discriminant values must const-evaluate successfully.
      if (variant.discr.$ === "Explicit") {
        const discr_def_id = variant.discr._0;
        const r = const_eval_poly(tcx, discr_def_id);
        if (r.$ === "Ok") {
          // ok
        } else if (r._0.$ === "Reported") {
          // reported
        } else {
          const sp = r._0._0;
          span_bug(sp, "enum variant discr was too generic to eval");
        }
      }
    }

    check_where_clauses(wfcx, item);
    return Ok(null);
  });
}

// #[instrument(skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1088 check_trait
export function check_trait(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  if (tcx.is_lang_item(LocalDefIdC.to_def_id(def_id), LangItem.PointeeSized)) {
    // `PointeeSized` is removed during lowering.
    return Ok(null);
  }

  const trait_def = tcx.trait_def(def_id) as TraitDef;
  if (trait_def.is_marker || trait_def.specialization_kind === "Marker") {
    for (const associated_def_id of tcx.associated_item_def_ids(def_id) as readonly DefId[]) {
      struct_span_code_err(tcx.dcx(), tcx.def_span(associated_def_id), E0714, "marker traits cannot have associated items").emit();
    }
  }

  const res = enter_wf_checking_ctxt(tcx, def_id, (wfcx) => {
    check_where_clauses(wfcx, def_id);
    return Ok(null);
  });

  return res;
}

/// Checks all associated type defaults of trait `trait_def_id`.
///
/// Assuming the defaults are used, check that all predicates (bounds on the
/// assoc type and where clauses on the trait) hold.
// rustc: compiler/rustc_hir_analysis/src/check/wfcheck.rs:1121 check_associated_type_bounds
function check_associated_type_bounds(wfcx: WfCheckingCtxt, item: AssocItemT, _span: Span): void {
  const bounds = wfcx.tcx().explicit_item_bounds(item.def_id) as EarlyBinder<readonly [Clause, Span][]>;

  // debug!("check_associated_type_bounds: bounds={:?}", bounds);
  const wf_obligations = [...EarlyBinder.iter_identity_copied(bounds)]
    .map(Unnormalized.skip_norm_wip)
    .flatMap(([bound, bound_span]) => wf_clause_obligations(wfcx.infcx, wfcx.param_env, wfcx.body_def_id, bound, bound_span));

  wfcx.register_obligations(wf_obligations);
}

// ---- check-wf-a: PORT stand-ins for items of files / lanes that are not in this lane's base -------------------------

/** `WellFormedLoc::None`. */
const WellFormedLoc_None: WellFormedLoc = { $: "None" };

/** D4 descriptor of `ty::FnSig` (for `liberate_late_bound_regions`). */
const d_FnSig: TypeFoldable<FnSig> = FnSigC as unknown as TypeFoldable<FnSig>;

/** D4 descriptor of `Vec<(Clause, Span)>` (`explicit_item_bounds(..).iter_identity_copied().collect()`). */
const d_Vec_Clause_Span: TypeFoldable<readonly [Clause, Span][]> = fold_Vec(fold_tuple2(fold_Clause, fold_Span));

/** `traits::ObligationCtxt<'_, 'tcx, FulfillmentError<'tcx>>` (rustc_trait_selection traits/engine.rs, lane trait-sel-traits-a): the members this file uses. */
export interface ObligationCtxt {
  infcx: InferCtxt;
  register_obligation(obligation: PredicateObligation): void;
  register_obligations(obligations: Iterable<PredicateObligation>): void;
  register_bound(cause: ObligationCause, param_env: ParamEnv, ty: Ty, def_id: DefId): void;
  normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): T;
  deeply_normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): Result<T, FulfillmentError[]>;
  evaluate_obligations_error_on_ambiguity(): TraitErrors<FulfillmentError>;
  assumed_wf_types_and_report_errors(param_env: ParamEnv, def_id: LocalDefId): Result<Set<Ty>, ErrorGuaranteed>;
}
/** `traits::FulfillmentError<'tcx>` (rustc_trait_selection traits/mod.rs, lane trait-sel-traits-a). */
type FulfillmentError = unknown;

/** PORT: stand-in for `ObligationCtxt::new_with_diagnostics` (rustc_trait_selection traits/engine.rs, lane trait-sel-traits-a). */
function ObligationCtxt_new_with_diagnostics(_infcx: InferCtxt): ObligationCtxt {
  return unported("rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics");
}

/** PORT: stand-in for `infcx.err_ctxt().report_fulfillment_errors(errors)` (rustc_trait_selection error_reporting, wave 19). */
function TypeErrCtxt_report_fulfillment_errors(_infcx: InferCtxt, _errors: FulfillmentError[]): ErrorGuaranteed {
  return unported("rustc_trait_selection::error_reporting::TypeErrCtxt::report_fulfillment_errors");
}

/** PORT: stand-in for `infcx.err_ctxt().report_region_errors(body_def_id, errors)` (rustc_trait_selection error_reporting, wave 19). */
function TypeErrCtxt_report_region_errors(_infcx: InferCtxt, _body_def_id: LocalDefId, _errors: readonly unknown[]): ErrorGuaranteed {
  return unported("rustc_trait_selection::error_reporting::TypeErrCtxt::report_region_errors");
}

/** PORT: stand-in for `traits::wf::unnormalized_obligations` (rustc_trait_selection traits/wf.rs, lane trait-sel-traits-b). */
function wf_unnormalized_obligations(_infcx: InferCtxt, _param_env: ParamEnv, _term: Term, _span: Span, _body_id: LocalDefId): PredicateObligation[] | undefined {
  return unported("rustc_trait_selection::traits::wf::unnormalized_obligations");
}

/** PORT: stand-in for `traits::wf::clause_obligations` (rustc_trait_selection traits/wf.rs, lane trait-sel-traits-b). */
function wf_clause_obligations(_infcx: InferCtxt, _param_env: ParamEnv, _body_id: LocalDefId, _clause: Clause, _span: Span): PredicateObligation[] {
  return unported("rustc_trait_selection::traits::wf::clause_obligations");
}

/** PORT: stand-in for `regions::region_known_to_outlive` (rustc_trait_selection regions.rs, lane trait-sel-traits-a). */
function region_known_to_outlive(_tcx: TyCtxt, _id: LocalDefId, _param_env: ParamEnv, _wf_tys: Set<Ty>, _region_a: Region, _region_b: Region): boolean {
  return unported("rustc_trait_selection::regions::region_known_to_outlive");
}

/** PORT: stand-in for `regions::ty_known_to_outlive` (rustc_trait_selection regions.rs, lane trait-sel-traits-a). */
function ty_known_to_outlive(_tcx: TyCtxt, _id: LocalDefId, _param_env: ParamEnv, _wf_tys: Set<Ty>, _ty: Unnormalized<Ty>, _region: Region): boolean {
  return unported("rustc_trait_selection::regions::ty_known_to_outlive");
}

/** `misc::ConstParamTyImplementationError` (rustc_trait_selection traits/misc.rs, lane trait-sel-traits-a): the variants this file matches. */
type ConstParamTyImplementationError =
  | { readonly $: "UnsizedConstParamsFeatureRequired" }
  | { readonly $: "InvalidInnerTyOfBuiltinTy"; _0: unknown }
  | { readonly $: "InfrigingFields"; _0: unknown }
  | { readonly $: "NotAnAdtOrBuiltinAllowed" }
  | { readonly $: "NonExhaustive"; _0: unknown };

/** PORT: stand-in for `misc::type_allowed_to_implement_const_param_ty` (rustc_trait_selection traits/misc.rs, lane trait-sel-traits-a). */
function type_allowed_to_implement_const_param_ty(_tcx: TyCtxt, _param_env: ParamEnv, _self_type: Ty, _parent_cause: ObligationCause): Result<null, ConstParamTyImplementationError> {
  return unported("rustc_trait_selection::traits::misc::type_allowed_to_implement_const_param_ty");
}

/** PORT: stand-in for `crate::check::check::check_item_type` (check/check.rs, lane check-check). */
function check_check_item_type(_tcx: TyCtxt, _def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::check::check_item_type (lane check-check)");
}

/** `mir::interpret::ErrorHandled` (rustc_middle mir/interpret/error.rs, M4): the variants this file matches. */
type ErrorHandled = { readonly $: "Reported"; _0: unknown; _1: Span } | { readonly $: "TooGeneric"; _0: Span };

/** PORT: stand-in for `TyCtxt::const_eval_poly` (rustc_middle mir/interpret/queries.rs, M4). */
function const_eval_poly(_tcx: TyCtxt, _def_id: DefId): Result<unknown, ErrorHandled> {
  return unported("rustc_middle::mir::interpret::TyCtxt::const_eval_poly (M4)");
}

// ---- check-wf-b region: wfcheck.rs:1140–end (lane check-wf-b) -------------------------------------------------------
// PORT: until lane check-wf-b lands, the items of its region that the check-wf-a region calls are stand-ins here.

export interface WfCheckingCtxt {
  check_false_global_bounds(): void;
}

/** (check-wf-b) `WfCheckingCtxt::check_false_global_bounds` (wfcheck.rs:2306). */
WfCheckingCtxt.prototype.check_false_global_bounds = function (this: WfCheckingCtxt): void {
  return unported("rustc_hir_analysis::check::wfcheck::WfCheckingCtxt::check_false_global_bounds (lane check-wf-b)");
};

/** (check-wf-b) `check_item_fn` (wfcheck.rs:1140). */
function check_item_fn(_tcx: TyCtxt, _def_id: LocalDefId, _decl: hir.FnDecl): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::wfcheck::check_item_fn (lane check-wf-b)");
}

/** (check-wf-b) `check_const_item` (wfcheck.rs:1272). */
function check_const_item(_wfcx: WfCheckingCtxt, _item_id: LocalDefId, _ty: Ty): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::wfcheck::check_const_item (lane check-wf-b)");
}

/** (check-wf-b) `check_impl` (wfcheck.rs:1321). */
function check_impl(_tcx: TyCtxt, _item: hir.Item, _impl_: hir.Impl): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::wfcheck::check_impl (lane check-wf-b)");
}

/** (check-wf-b) `check_where_clauses` (wfcheck.rs:1416). */
function check_where_clauses(_wfcx: WfCheckingCtxt, _def_id: LocalDefId): void {
  return unported("rustc_hir_analysis::check::wfcheck::check_where_clauses (lane check-wf-b)");
}

/** (check-wf-b) `check_fn_or_method` (wfcheck.rs:1624). */
function check_fn_or_method(_wfcx: WfCheckingCtxt, _sig: Binder<FnSig>, _hir_decl: hir.FnDecl, _def_id: LocalDefId): void {
  return unported("rustc_hir_analysis::check::wfcheck::check_fn_or_method (lane check-wf-b)");
}

/** (check-wf-b) `check_method_receiver` (wfcheck.rs:1722). */
function check_method_receiver(_wfcx: WfCheckingCtxt, _fn_sig: hir.FnSig, _method: AssocItemT, _self_ty: Ty): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::wfcheck::check_method_receiver (lane check-wf-b)");
}

/** (check-wf-b) `lint_redundant_lifetimes` (wfcheck.rs:2638). */
function lint_redundant_lifetimes(_tcx: TyCtxt, _owner_id: LocalDefId, _outlives_env: OutlivesEnvironment): void {
  return unported("rustc_hir_analysis::check::wfcheck::lint_redundant_lifetimes (lane check-wf-b)");
}
