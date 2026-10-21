//! Method lookup: the secret sauce of Rust. See the [rustc dev guide] for more information.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/hir-typeck/method-lookup.html
// Port of compiler/rustc_hir_typeck/src/method/mod.rs (lane typeck-method).
//
// The `impl FnCtxt` methods of this file are assigned onto `FnCtxt.prototype` (declared in ../decls.ts). `MethodCallee`,
// `MethodError`, `NoMatchData`, `CandidateSource` and `TreatNotYetDefinedOpaques` are generated (mod.gen.ts).
// - `pub(crate) mod confirm; mod prelude_edition_lints; pub(crate) mod probe; mod suggest;` are loaded by ../lib.ts (they
//   extend `FnCtxt.prototype`).
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only ../decls.ts, this file's .gen.ts and other crates.
import type { Diag } from "../../rustc_errors/lib.ts";
import type { Applicability } from "../../rustc_lint_defs/lib.ts";
import { predicates_for_generics } from "../../rustc_trait_selection/traits/mod.ts";
import type { DiagMessage } from "../../rustc_error_messages/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { Res, type DefKind } from "../../rustc_hir/def.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { BoundRegionConversionTime, InferOk } from "../../rustc_infer/infer/mod.ts";
import { Obligation, type PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { clone_ObligationCause, type ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Predicate_upcast_from_Binder_PredicateKind, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { fold_Clause } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Symbol, Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig, PredicateKind } from "../../rustc_type_ir/decls.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_FnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { FnCtxt } from "../decls.ts";
import type { MethodCallee, MethodError, CandidateSource, TreatNotYetDefinedOpaques } from "./mod.gen.ts";
import { type PickResult, type ProbeScope, ProbeScope as ProbeScopeC } from "./probe.gen.ts";

export * from "./mod.gen.ts";

const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };

/** The `TypeFoldable` descriptor of `ty::PolyFnSig` (`Binder<FnSig>`). */
const fold_PolyFnSig = fold_Binder(fold_FnSig);

/** `Upcast<TyCtxt, P>` descriptors are typed over `Interner` (precedent: rustc_hir_analysis autoderef.ts). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
/// Determines whether the type `self_ty` supports a visible method named `method_name` or not.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:91 method_exists_for_diagnostic
FnCtxt.prototype.method_exists_for_diagnostic = function (this: FnCtxt, method_name: Ident, self_ty: Ty, call_expr_id: HirId, return_type: Ty | undefined): boolean {
  const r = this.probe_for_name("MethodCall", method_name, return_type, { _0: true }, self_ty, call_expr_id, ProbeScopeC.TraitsInScope);
  if (r.$ === "Ok") {
    const pick = r._0;
    pick.maybe_emit_unstable_name_collision_hint(this.tcx, method_name.span, call_expr_id);
    return true;
  }
  switch (r._0.$) {
    case "NoMatch":
      return false;
    case "Ambiguity":
      return true;
    case "PrivateMatch":
      return false;
    case "IllegalSizedBound":
      return true;
    case "BadReturnType":
      return true;
    case "ErrorReported":
      return false;
  }
};

/// Adds a suggestion to call the given method to the provided diagnostic.
// #[instrument(level = "debug", skip(self, err, call_expr))]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:126 suggest_method_call
FnCtxt.prototype.suggest_method_call = function (this: FnCtxt, err: Diag, msg: DiagMessage, method_name: Ident, self_ty: Ty, call_expr: hir.Expr, span: Span | undefined): void {
  const r = this.lookup_probe_for_diagnostic(method_name, self_ty, call_expr, ProbeScopeC.TraitsInScope, undefined);
  let params = 0;
  if (r.$ === "Ok") {
    const pick = r._0;
    const sig = this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSig>;
    // `.len().saturating_sub(1)`
    params = Math.max(FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(sig))).length - 1, 0);
  }

  // Account for `foo.bar<T>`;
  const sugg_span = Span.shrink_to_hi(span ?? call_expr.span);
  const [suggestion, applicability]: [string, Applicability] = [
    `(${Array.from({ length: params }, () => "_").join(", ")})`,
    params > 0 ? "HasPlaceholders" : "MaybeIncorrect",
  ];

  err.span_suggestion_verbose(sugg_span, msg, suggestion, applicability);
};

/// Performs method lookup. If lookup is successful, it will return the callee
/// and store an appropriate adjustment for the self-expr. In some cases it may
/// report an error (e.g., invoking the `drop` method).
///
/// # Arguments
///
/// Given a method call like `foo.bar::<T1,...Tn>(a, b + 1, ...)`:
///
/// * `self`:                  the surrounding `FnCtxt` (!)
/// * `self_ty`:               the (unadjusted) type of the self expression (`foo`)
/// * `segment`:               the name and generic arguments of the method (`bar::<T1, ...Tn>`)
/// * `span`:                  the span for the method call
/// * `call_expr`:             the complete method call: (`foo.bar::<T1,...Tn>(...)`)
/// * `self_expr`:             the self expression (`foo`)
/// * `args`:                  the expressions of the arguments (`a, b + 1, ...`)
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:175 lookup_method
FnCtxt.prototype.lookup_method = function (this: FnCtxt, self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr, args: readonly hir.Expr[]): Result<MethodCallee, MethodError> {
  const only_method = Res.opt_def_id(segment.res);
  const scope: ProbeScope = only_method !== undefined ? { $: "Single", _0: only_method, _1: undefined } : ProbeScopeC.TraitsInScope;

  const pick_r = this.lookup_probe(segment.ident, self_ty, call_expr, scope);
  if (pick_r.$ === "Err") return pick_r;
  const pick = pick_r._0;

  this.lint_edition_dependent_dot_call(self_ty, segment, span, call_expr, self_expr, pick, args);

  // NOTE: on the failure path, we also record the possibly-used trait methods
  // since an unused import warning is kinda distracting from the method error.
  for (const import_id of pick.import_ids) {
    // debug!("used_trait_import: {:?}", import_id);
    this.typeck_results.used_trait_imports.add(import_id);
  }

  this.tcx.check_stability(pick.item.def_id, call_expr.hir_id, span, undefined);

  const result = this.confirm_method(span, self_expr, call_expr, self_ty, pick, segment);
  // debug!("result = {:?}", result);

  if (result.illegal_sized_bound !== undefined) {
    const span = result.illegal_sized_bound;
    let needs_mut = false;
    const k = self_ty.kind();
    if (k.$ === "Ref") {
      const [region, t_type, mutability] = [k._0, k._1, k._2];
      const trait_type = Ty.new_ref(this.tcx, region, t_type, Mutability.invert(mutability));
      // We probe again to see if there might be a borrow mutability discrepancy.
      const r = this.lookup_probe(segment.ident, trait_type, call_expr, ProbeScopeC.TraitsInScope);
      if (r.$ === "Ok" && pick.differs_from(r._0)) {
        const new_pick = r._0;
        needs_mut = new_pick.self_ty.ref_mutability() !== self_ty.ref_mutability();
      }
    }

    // We probe again, taking all traits into account (not only those in scope).
    const r = this.lookup_probe_for_diagnostic(segment.ident, self_ty, call_expr, ProbeScopeC.AllTraits, undefined);
    let candidates: DefId[];
    if (r.$ === "Ok" && pick.differs_from(r._0)) {
      // If we find a different result the caller probably forgot to import a trait.
      const new_pick = r._0;
      candidates = [AssocItem.container_id(new_pick.item, this.tcx)];
    } else if (r.$ === "Err" && r._0.$ === "Ambiguity") {
      const sources: CandidateSource[] = r._0._0;
      candidates = [];
      for (const source of sources) {
        switch (source.$) {
          // Note: this cannot come from an inherent impl,
          // because the first probing succeeded.
          case "Impl":
            candidates.push(this.tcx.impl_trait_id(source._0));
            break;
          case "Trait":
            break;
        }
      }
    } else {
      candidates = [];
    }

    return Err({ $: "IllegalSizedBound", candidates, needs_mut, bound_span: span, self_expr });
  }

  return Ok(result.callee);
};

// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:258 lookup_method_for_diagnostic
FnCtxt.prototype.lookup_method_for_diagnostic = function (this: FnCtxt, self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr): Result<MethodCallee, MethodError> {
  const pick = this.lookup_probe_for_diagnostic(segment.ident, self_ty, call_expr, ProbeScopeC.TraitsInScope, undefined);
  if (pick.$ === "Err") return pick;

  return Ok(this.confirm_method_for_diagnostic(span, self_expr, call_expr, self_ty, pick._0, segment).callee);
};

// #[instrument(level = "debug", skip(self, call_expr))]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:280 lookup_probe
FnCtxt.prototype.lookup_probe = function (this: FnCtxt, method_name: Ident, self_ty: Ty, call_expr: hir.Expr, scope: ProbeScope): PickResult {
  const pick = this.probe_for_name("MethodCall", method_name, undefined, { _0: false }, self_ty, call_expr.hir_id, scope);
  if (pick.$ === "Err") return pick;
  pick._0.maybe_emit_unstable_name_collision_hint(this.tcx, method_name.span, call_expr.hir_id);
  return Ok(pick._0);
};

// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:300 lookup_probe_for_diagnostic
FnCtxt.prototype.lookup_probe_for_diagnostic = function (this: FnCtxt, method_name: Ident, self_ty: Ty, call_expr: hir.Expr, scope: ProbeScope, return_type: Ty | undefined): PickResult {
  const pick = this.probe_for_name("MethodCall", method_name, return_type, { _0: true }, self_ty, call_expr.hir_id, scope);
  if (pick.$ === "Err") return pick;
  return Ok(pick._0);
};
// }

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
/// `lookup_method_in_trait` is used for overloaded operators.
/// It does a very narrow slice of what the normal probe/confirm path does.
/// In particular, it doesn't really do any probing: it simply constructs
/// an obligation for a particular trait with the given self type and checks
/// whether that trait is implemented.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:345 lookup_method_for_operator
FnCtxt.prototype.lookup_method_for_operator = function (this: FnCtxt, cause: ObligationCause, method_name: Symbol, trait_def_id: DefId, self_ty: Ty, opt_rhs_ty: Ty | undefined, treat_opaques: TreatNotYetDefinedOpaques): InferOk<MethodCallee> | undefined {
  // Construct a trait-reference `self_ty : Trait<input_tys>`
  const args = RawList.for_item(this.tcx, trait_def_id, (param, _) => {
    switch (param.kind.$) {
      case "Lifetime":
      case "Const":
        return unreachable("did not expect operator trait to have lifetime/const");
      case "Type": {
        if (param.index === 0) {
          return GenericArg.from_Ty(self_ty);
        } else if (opt_rhs_ty !== undefined) {
          const rhs_ty = opt_rhs_ty;
          if (param.index !== 1) {
            panic(`assertion \`left == right\` failed: did not expect >1 param on operator trait\n  left: ${param.index}\n right: 1`);
          }
          return GenericArg.from_Ty(rhs_ty);
        } else {
          // FIXME: We should stop passing `None` for the failure case
          // when probing for call exprs. I.e. `opt_rhs_ty` should always
          // be set when it needs to be.
          return this.var_for_def(cause.span, param);
        }
      }
    }
  });

  const obligation = Obligation.new(
    this.tcx,
    cause,
    this.param_env,
    TraitRef.new_from_args(as_interner(this.tcx), trait_def_id, args),
    upcast_tcx(Predicate_upcast_from_TraitRef),
  );

  // Now we want to know if this can be matched
  let matches_trait: boolean;
  switch (treat_opaques) {
    case "AsInfer":
      matches_trait = this.predicate_may_hold(obligation);
      break;
    case "AsRigid":
      matches_trait = this.predicate_may_hold_opaque_types_jank(obligation);
      break;
  }

  if (!matches_trait) {
    // debug!("--> Cannot match obligation");
    // Cannot be matched, no such method resolution is possible.
    return undefined;
  }

  // Trait must have a method named `m_name` and it should not have
  // type parameters or early-bound regions.
  const tcx = this.tcx;
  // We use `Ident::with_dummy_span` since no built-in operator methods have
  // any macro-specific hygiene, so the span's context doesn't really matter.
  const method_item = this.associated_value(trait_def_id, Ident.with_dummy_span(method_name));
  if (method_item === undefined) {
    return bug("expected associated item for operator trait");
  }

  const def_id = method_item.def_id;
  if (!AssocItem.is_fn(method_item)) {
    span_bug(tcx.def_span(def_id), `expected \`${display_Symbol(method_name)}\` to be an associated function`);
  }

  // debug!("lookup_in_trait_adjusted: method_item={:?}", method_item);
  const obligations: PredicateObligations = [];

  // Instantiate late-bound regions and instantiate the trait
  // parameters into the method type to get the actual method type.
  //
  // N.B., instantiate late-bound regions before normalizing the
  // function signature so that normalization does not need to deal
  // with bound regions.
  const fn_sig_b = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>, this.tcx, args, fold_PolyFnSig));
  let fn_sig = this.instantiate_binder_with_fresh_vars(obligation.cause.span, BoundRegionConversionTime.FnCall, fn_sig_b, fold_FnSig);

  const { value: fn_sig_n, obligations: o } = this.at(obligation.cause, this.param_env).normalize(Unnormalized.new_wip(fn_sig), fold_FnSig);
  fn_sig = fn_sig_n;
  obligations.push(...o);

  // Register obligations for the parameters. This will include the
  // `Self` parameter, which in turn has a bound of the main trait,
  // so this also effectively registers `obligation` as well. (We
  // used to register `obligation` explicitly, but that resulted in
  // double error messages being reported.)
  //
  // Note that as the method comes from a trait, it should not have
  // any late-bound regions appearing in its bounds.
  const bounds = GenericClauses.instantiate(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx, args);

  const predicates_cause = clone_ObligationCause(obligation.cause);
  const normalization_obligations: PredicateObligations = [];
  obligations.push(
    ...predicates_for_generics(
      (_1, _2) => clone_ObligationCause(predicates_cause),
      (clause: Unnormalized<Clause>): Clause => {
        const { value: pred, obligations: o } = this.at(obligation.cause, this.param_env).normalize(clause, fold_Clause);
        normalization_obligations.push(...o);
        assert(!TypeVisitableExt.has_escaping_bound_vars(pred, fold_Clause), "assertion failed: !pred.has_escaping_bound_vars()");
        return pred;
      },
      this.param_env,
      bounds,
    ),
  );
  obligations.push(...normalization_obligations);

  // Also add an obligation for the method type being well-formed.
  // debug!(
  //     "lookup_method_in_trait: matched method fn_sig={:?} obligation={:?}",
  //     fn_sig, obligation
  // );
  for (const ty of fn_sig.inputs_and_output) {
    obligations.push(
      Obligation.new(
        tcx,
        clone_ObligationCause(obligation.cause),
        this.param_env,
        Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "WellFormed", _0: ty } }, d_PredicateKind),
        upcast_tcx(Predicate_upcast_from_Binder_PredicateKind),
      ),
    );
  }

  const callee: MethodCallee = { def_id, args, sig: fn_sig };
  // debug!("callee = {:?}", callee);

  return new InferOk(callee, obligations);
};

/// Performs a [full-qualified function call] (formerly "universal function call") lookup. If
/// lookup is successful, it will return the type of definition and the [`DefId`] of the found
/// function definition.
///
/// [full-qualified function call]: https://doc.rust-lang.org/reference/expressions/call-expr.html#disambiguating-function-calls
///
/// # Arguments
///
/// Given a function call like `Foo::bar::<T1,...Tn>(...)`:
///
/// * `self`:                  the surrounding `FnCtxt` (!)
/// * `span`:                  the span of the call, excluding arguments (`Foo::bar::<T1, ...Tn>`)
/// * `method_name`:           the identifier of the function within the container type (`bar`)
/// * `self_ty`:               the type to search within (`Foo`)
/// * `self_ty_span`           the span for the type being searched within (span of `Foo`)
/// * `expr_id`:               the [`hir::HirId`] of the expression composing the entire call
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:497 resolve_fully_qualified_call
FnCtxt.prototype.resolve_fully_qualified_call = function (this: FnCtxt, span: Span, method_name: Ident, self_ty: Ty, self_ty_span: Span, expr_id: HirId): Result<[DefKind, DefId], MethodError> {
  const tcx = this.tcx;

  // Check if we have an enum variant.
  let struct_variant: [DefKind, DefId] | undefined = undefined;
  const k = self_ty.kind();
  if (k.$ === "Adt") {
    const adt_def = k._0;
    if (adt_def.is_enum()) {
      const variant_def = adt_def.variants().find((vd) => tcx.hygienic_eq(method_name, vd.ident(tcx), adt_def.did()));
      if (variant_def !== undefined) {
        if (variant_def.ctor !== undefined) {
          const [ctor_kind, ctor_def_id] = variant_def.ctor;
          tcx.check_stability(ctor_def_id, expr_id, span, method_name.span);
          return Ok([{ $: "Ctor", _0: "Variant", _1: ctor_kind }, ctor_def_id]);
        } else {
          struct_variant = [{ $: "Variant" }, variant_def.def_id];
        }
      }
    }
  }

  const pick_r = this.probe_for_name("Path", method_name, undefined, { _0: false }, self_ty, expr_id, ProbeScopeC.TraitsInScope);
  // Fall back to a resolution that will produce an error later.
  if (pick_r.$ === "Err" && struct_variant !== undefined) return Ok(struct_variant);
  if (pick_r.$ === "Err") return pick_r;
  const pick = pick_r._0;

  pick.maybe_emit_unstable_name_collision_hint(this.tcx, span, expr_id);

  this.lint_fully_qualified_call_from_2018(span, method_name, self_ty, self_ty_span, expr_id, pick);

  // debug!(?pick);
  {
    const typeck_results = this.typeck_results;
    for (const import_id of pick.import_ids) {
      // debug!(used_trait_import=?import_id);
      typeck_results.used_trait_imports.add(import_id);
    }
  }

  const def_kind = AssocItem.as_def_kind(pick.item);
  tcx.check_stability(pick.item.def_id, expr_id, span, method_name.span);
  return Ok([def_kind, pick.item.def_id]);
};

/// Finds item with name `item_ident` defined in impl/trait `def_id`
/// and return it, or `None`, if no such item was defined there.
// rustc: compiler/rustc_hir_typeck/src/method/mod.rs:573 associated_value
FnCtxt.prototype.associated_value = function (this: FnCtxt, def_id: DefId, item_ident: Ident): AssocItem | undefined {
  return AssocItems.find_by_ident_and_namespace(this.tcx.associated_items(def_id) as AssocItems, this.tcx, item_ident, "ValueNS", def_id);
};
// }
