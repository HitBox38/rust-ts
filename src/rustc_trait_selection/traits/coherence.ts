//! See Rustc Dev Guide chapters on [trait-resolution] and [trait-specialization] for more info on
//! how this works.
//!
//! [trait-resolution]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html
//! [trait-specialization]: https://rustc-dev-guide.rust-lang.org/traits/specialization.html
//
// Port of compiler/rustc_trait_selection/src/traits/coherence.rs (lane trait-sel-traits-c).
//
// PORT notes (file-wide):
// - `pub use rustc_next_trait_solver::coherence::*;` re-exports the next solver's orphan check / knowability module
//   (`orphan_check_trait_ref`, `trait_ref_is_knowable`, `InCrate`, `Conflict`, `OrphanCheckErr`, ...).
// - `ImplHeader`'s `#[derive(Clone, Debug, TypeFoldable, TypeVisitable)]` is hand-written below in the generator's shape
//   (no codegen set covers rustc_trait_selection yet; see the handoff).
// - `FxIndexSet<IntercrateAmbiguityCause>` / `FxHashSet<Goal<Predicate>>` are `KeyedSet`s on `intern_key` (the derived
//   `Hash` + `Eq` of values holding interned handles), insertion-ordered as an `IndexSet`.
// - The items this file calls that are not ported yet (`IntercrateAmbiguityCause`, wave 20; `suggest_new_overflow_limit`,
//   wave 19; `impl Elaboratable for (Clause, Span)`) are local stand-ins at the end of the file that stop as UNPORTED.
// - `#[instrument]` / `debug!` / `warn!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.

import { SkipLeakCheck_ } from "./mod.ts";
import type { FulfillmentError, SkipLeakCheck } from "./mod.gen.ts";
import { ObligationCtxt } from "./engine.ts";
import { SolverDelegate } from "../solve/delegate.ts";
import { solve } from "../../rustc_next_trait_solver/lib.ts";
import { deeply_normalize_for_diagnostics } from "../solve/normalize.ts";
import { type InspectConfig, type InspectGoal, type ProofTreeVisitor, ProofTreeVisitor_provided } from "../solve/inspect/analyse.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { ToTrace_Const, ToTrace_Region, ToTrace_TraitRef, ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { clone_Obligation, Obligation, type PredicateObligation, ScrubbedTraitError } from "../../rustc_infer/traits/mod.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { OverlapMode } from "../../rustc_middle/traits/specialization_graph.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { ParamEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Predicate } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { Ty as TyC } from "../../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, type DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import { BoundConst, BoundRegionKind, BoundTyKind, EarlyBinder, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../rustc_type_ir/binder.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { DeepRejectCtxt } from "../../rustc_type_ir/fast_reject.ts";
import { type FallibleTypeFolder, fold_Option, fold_Vec, type TypeFoldable, type TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { Elaborator } from "../../rustc_type_ir/elaborate.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { BoundVar, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { as_interner, fold_with_TraitRef, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import type { Certainty, NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { Goal } from "../../rustc_type_ir/solve/mod.ts";
import type { ProbeKind } from "../../rustc_type_ir/solve/inspect.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import { assert, assert_eq, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Conflict, trait_ref_is_knowable } from "../../rustc_next_trait_solver/coherence.ts";
import type { InferOk } from "../../rustc_infer/infer/mod.gen.ts";

// `pub use rustc_next_trait_solver::coherence::*;`
export * from "../../rustc_next_trait_solver/coherence.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PredicateKind: TypeFoldable<PredicateKind> = {
  visit_with: visit_with_PredicateKind,
  try_fold_with: try_fold_with_PredicateKind,
  fold_with: fold_with_PredicateKind,
};

/// The "header" of an impl is everything outside the body: a Self type, a trait
/// ref (in the case of a trait impl), and a set of predicates (from the
/// bounds / where-clauses).
// rustc-type: compiler/rustc_trait_selection/src/traits/coherence.rs:43 ImplHeader
export interface ImplHeader {
  impl_args: GenericArgs;
  self_ty: Ty;
  trait_ref: TraitRef | undefined;
  predicates: Predicate[];
}
/** `#[derive(Clone)]` */
export function clone_ImplHeader(v: ImplHeader): ImplHeader {
  return { impl_args: v.impl_args, self_ty: v.self_ty, trait_ref: v.trait_ref, predicates: [...v.predicates] };
}
const fold_Option_TraitRef = fold_Option(d_TraitRef);
const fold_Vec_Predicate = fold_Vec(fold_Predicate);
/** PORT: `#[derive(TypeFoldable, TypeVisitable)]`, hand-written in the generator's shape (file header). */
export const fold_ImplHeader: TypeFoldable<ImplHeader> = {
  visit_with<R>(self: ImplHeader, __visitor: TypeVisitor<R>): R {
    let r: R | undefined;
    if ((r = try_visit(__visitor.Result, fold_GenericArgs.visit_with(self.impl_args, __visitor))) !== undefined) return r;
    if ((r = try_visit(__visitor.Result, fold_Ty.visit_with(self.self_ty, __visitor))) !== undefined) return r;
    if ((r = try_visit(__visitor.Result, fold_Option_TraitRef.visit_with(self.trait_ref, __visitor))) !== undefined) return r;
    if ((r = try_visit(__visitor.Result, fold_Vec_Predicate.visit_with(self.predicates, __visitor))) !== undefined) return r;
    return __visitor.Result.output();
  },
  try_fold_with<E>(self: ImplHeader, __folder: FallibleTypeFolder<E>): Result<ImplHeader, E> {
    const __0 = fold_GenericArgs.try_fold_with(self.impl_args, __folder);
    if (__0.$ === "Err") return __0;
    const __1 = fold_Ty.try_fold_with(self.self_ty, __folder);
    if (__1.$ === "Err") return __1;
    const __2 = fold_Option_TraitRef.try_fold_with(self.trait_ref, __folder);
    if (__2.$ === "Err") return __2;
    const __3 = fold_Vec_Predicate.try_fold_with(self.predicates, __folder);
    if (__3.$ === "Err") return __3;
    return Ok({ impl_args: __0._0, self_ty: __1._0, trait_ref: __2._0, predicates: [...__3._0] });
  },
  fold_with(self: ImplHeader, __folder: TypeFolder): ImplHeader {
    return {
      impl_args: fold_GenericArgs.fold_with(self.impl_args, __folder),
      self_ty: fold_Ty.fold_with(self.self_ty, __folder),
      trait_ref: fold_Option_TraitRef.fold_with(self.trait_ref, __folder),
      predicates: [...fold_Vec_Predicate.fold_with(self.predicates, __folder)],
    };
  },
};

// rustc-type: compiler/rustc_trait_selection/src/traits/coherence.rs:50 OverlapResult
export interface OverlapResult {
  impl_header: ImplHeader;
  intercrate_ambiguity_causes: KeyedSet<IntercrateAmbiguityCause>;

  /// `true` if the overlap might've been permitted before the shift
  /// to universes.
  involves_placeholder: boolean;

  /// Used in the new solver to suggest increasing the recursion limit.
  overflowing_predicates: Predicate[];
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:62 add_placeholder_note
export function add_placeholder_note(err: Diag): void {
  err.note("this behavior recently changed as a result of a bug fix; see rust-lang/rust#56105 for details");
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:69 suggest_increasing_recursion_limit
export function suggest_increasing_recursion_limit(tcx: TyCtxt, err: Diag, overflowing_predicates: readonly Predicate[]): void {
  for (const pred of overflowing_predicates) {
    err.note(`overflow evaluating the requirement \`${display_Predicate(pred)}\``);
  }

  suggest_new_overflow_limit(tcx, err);
}

/// If there are types that satisfy both impls, returns `Some`
/// with a suitably-freshened `ImplHeader` with those types
/// instantiated. Otherwise, returns `None`.
// #[instrument(skip(tcx, skip_leak_check), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:85 overlapping_inherent_impls
export function overlapping_inherent_impls(
  tcx: TyCtxt,
  impl1_def_id: DefId,
  impl2_def_id: DefId,
  skip_leak_check: SkipLeakCheck,
  overlap_mode: OverlapMode,
): OverlapResult | undefined {
  // Before doing expensive operations like entering an inference context, do
  // a quick check via fast_reject to tell if the impl headers could possibly
  // unify.
  // PORT: the `type_of` query value is typed `unknown` in queries.gen.ts.
  const self_ty1 = EarlyBinder.skip_binder(tcx.type_of(impl1_def_id) as EarlyBinder<Ty>);
  const self_ty2 = EarlyBinder.skip_binder(tcx.type_of(impl2_def_id) as EarlyBinder<Ty>);
  const may_overlap = DeepRejectCtxt.relate_infer_infer(as_interner(tcx)).types_may_unify(self_ty1, self_ty2);

  if (!may_overlap) {
    // Some types involved are definitely different, so the impls couldn't possibly overlap.
    // debug!("overlapping_inherent_impls: fast_reject early-exit");
    return undefined;
  }

  return overlapping_impls(tcx, impl1_def_id, impl2_def_id, skip_leak_check, overlap_mode, false);
}

/// If there are types that satisfy both impls, returns `Some`
/// with a suitably-freshened `ImplHeader` with those types
/// instantiated. Otherwise, returns `None`.
// #[instrument(skip(tcx, skip_leak_check), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:112 overlapping_trait_impls
export function overlapping_trait_impls(
  tcx: TyCtxt,
  impl1_def_id: DefId,
  impl2_def_id: DefId,
  skip_leak_check: SkipLeakCheck,
  overlap_mode: OverlapMode,
): OverlapResult | undefined {
  // Before doing expensive operations like entering an inference context, do
  // a quick check via fast_reject to tell if the impl headers could possibly
  // unify.
  const impl1_args = EarlyBinder.skip_binder(tcx.impl_trait_ref(impl1_def_id)).args;
  const impl2_args = EarlyBinder.skip_binder(tcx.impl_trait_ref(impl2_def_id)).args;
  const may_overlap = DeepRejectCtxt.relate_infer_infer(as_interner(tcx)).args_may_unify(impl1_args, impl2_args);

  if (!may_overlap) {
    // Some types involved are definitely different, so the impls couldn't possibly overlap.
    // debug!("overlapping_impls: fast_reject early-exit");
    return undefined;
  }

  return overlapping_impls(tcx, impl1_def_id, impl2_def_id, skip_leak_check, overlap_mode, true);
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:136 overlapping_impls
function overlapping_impls(
  tcx: TyCtxt,
  impl1_def_id: DefId,
  impl2_def_id: DefId,
  skip_leak_check: SkipLeakCheck,
  overlap_mode: OverlapMode,
  is_of_trait: boolean,
): OverlapResult | undefined {
  return overlap(tcx, skip_leak_check, impl1_def_id, impl2_def_id, overlap_mode, is_of_trait);
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:147 fresh_impl_header
function fresh_impl_header(infcx: InferCtxt, impl_def_id: DefId, is_of_trait: boolean): ImplHeader {
  const tcx = infcx.tcx;
  const impl_args = infcx.fresh_args_for_item(DUMMY_SP, impl_def_id);

  return {
    impl_args,
    self_ty: Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(impl_def_id) as EarlyBinder<Ty>, tcx, impl_args, fold_Ty)),
    trait_ref: is_of_trait ? Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_def_id), tcx, impl_args, d_TraitRef)) : undefined,
    predicates: [...clauses_of_instantiate(tcx, impl_def_id, impl_args).iter()].map(([c, _]) => Unnormalized.skip_norm_wip(c).as_predicate()),
  };
}

/// Can both impl `a` and impl `b` be satisfied by a common type (including
/// where-clauses)? If so, returns an `ImplHeader` that unifies the two impls.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:172 overlap
function overlap(
  tcx: TyCtxt,
  skip_leak_check: SkipLeakCheck,
  impl1_def_id: DefId,
  impl2_def_id: DefId,
  overlap_mode: OverlapMode,
  is_of_trait: boolean,
): OverlapResult | undefined {
  if (OverlapMode.use_negative_impl(overlap_mode)) {
    if (
      impl_intersection_has_negative_obligation(tcx, impl1_def_id, impl2_def_id, is_of_trait) ||
      impl_intersection_has_negative_obligation(tcx, impl2_def_id, impl1_def_id, is_of_trait)
    ) {
      return undefined;
    }
  }

  const infcx = tcx
    .infer_ctxt()
    .skip_leak_check(SkipLeakCheck_.is_yes(skip_leak_check))
    .with_next_trait_solver(true)
    .enable_next_solver_overflow_fcw(false)
    .build(TypingMode.Coherence);

  // For the purposes of this check, we don't bring any placeholder
  // types into scope; instead, we replace the generic types with
  // fresh type variables, and hence we do our evaluations in an
  // empty environment.
  const param_env = ParamEnv.empty();

  const impl1_header = fresh_impl_header(infcx, impl1_def_id, is_of_trait);
  const impl2_header = fresh_impl_header(infcx, impl2_def_id, is_of_trait);

  // Equate the headers to find their intersection (the general type, with infer vars,
  // that may apply both impls).
  const obligations_ = equate_impl_headers(infcx, param_env, impl1_header, impl2_header);
  if (obligations_ === undefined) return undefined;
  const obligations: PredicateObligation[] = [...obligations_];
  // debug!("overlap: unification check succeeded");

  for (const predicate of [...impl1_header.predicates, ...impl2_header.predicates]) {
    obligations.push(Obligation.new(infcx.tcx, ObligationCause.dummy(), param_env, predicate, upcast_from_self));
  }

  let overflowing_predicates: Predicate[] = [];
  if (OverlapMode.use_implicit_negative(overlap_mode)) {
    const r = impl_intersection_has_impossible_obligation(infcx, obligations);
    switch (r.$) {
      case "Yes":
        return undefined;
      case "No": {
        const p = r.overflowing_predicates;
        overflowing_predicates = p;
        break;
      }
    }
  }

  // We toggle the `leak_check` by using `skip_leak_check` when constructing the
  // inference context, so this may be a noop.
  if (infcx.leak_check(UniverseIndex.ROOT, undefined).$ === "Err") {
    // debug!("overlap: leak check failed");
    return undefined;
  }

  const intercrate_ambiguity_causes = !OverlapMode.use_implicit_negative(overlap_mode)
    ? new KeyedSet<IntercrateAmbiguityCause>(intern_key)
    : compute_intercrate_ambiguity_causes(infcx, obligations);

  // debug!("overlap: intercrate_ambiguity_causes={:#?}", intercrate_ambiguity_causes);
  const involves_placeholder = infcx.inner
    .unwrap_region_constraints()
    .data()
    .constraints.some((c) => c[0].involves_placeholders());

  let impl_header = infcx.deeply_resolve_ignoring_regions(impl1_header, fold_ImplHeader);

  // Deeply normalize the impl header for diagnostics, ignoring any errors if this fails.
  impl_header = deeply_normalize_for_diagnostics(infcx, param_env, impl_header, fold_ImplHeader);

  return {
    impl_header,
    intercrate_ambiguity_causes,
    involves_placeholder,
    overflowing_predicates,
  };
}

// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:267 equate_impl_headers
function equate_impl_headers(infcx: InferCtxt, param_env: ParamEnv, impl1: ImplHeader, impl2: ImplHeader): readonly PredicateObligation[] | undefined {
  let result;
  const t1 = impl1.trait_ref;
  const t2 = impl2.trait_ref;
  if (t1 !== undefined && t2 !== undefined) {
    const impl1_ref = t1;
    const impl2_ref = t2;
    result = infcx.at(ObligationCause.dummy(), param_env).eq("Yes", impl1_ref, impl2_ref, ToTrace_TraitRef);
  } else if (t1 === undefined && t2 === undefined) {
    result = infcx.at(ObligationCause.dummy(), param_env).eq("Yes", impl1.self_ty, impl2.self_ty, ToTrace_Ty);
  } else {
    return bug("equate_impl_headers given mismatched impl kinds");
  }

  // `result.map(|infer_ok| infer_ok.obligations).ok()`
  return result.$ === "Ok" ? result._0.obligations : undefined;
}

/// The result of [fn impl_intersection_has_impossible_obligation].
// rustc-type: compiler/rustc_trait_selection/src/traits/coherence.rs:291 IntersectionHasImpossibleObligations
type IntersectionHasImpossibleObligations =
  | { readonly $: "Yes" }
  | {
      readonly $: "No";
      /// With the next solver, some obligations may
      /// fail if only the user increased the recursion limit.
      ///
      /// We return those obligations here and mention them in the
      /// error message.
      overflowing_predicates: Predicate[];
    };

/// Check if both impls can be satisfied by a common type by considering whether
/// any of either impl's obligations is not known to hold.
///
/// For example, given these two impls:
///     `impl From<MyLocalType> for Box<dyn Error>` (in my crate)
///     `impl<E> From<E> for Box<dyn Error> where E: Error` (in libstd)
///
/// After replacing both impl headers with inference vars (which happens before
/// this function is called), we get:
///     `Box<dyn Error>: From<MyLocalType>`
///     `Box<dyn Error>: From<?E>`
///
/// This gives us `?E = MyLocalType`. We then certainly know that `MyLocalType: Error`
/// never holds in intercrate mode since a local impl does not exist, and a
/// downstream impl cannot be added -- therefore can consider the intersection
/// of the two impls above to be empty.
///
/// Importantly, this works even if there isn't a `impl !Error for MyLocalType`.
// #[instrument(level = "debug", skip(infcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:322 impl_intersection_has_impossible_obligation
function impl_intersection_has_impossible_obligation(infcx: InferCtxt, obligations: readonly PredicateObligation[]): IntersectionHasImpossibleObligations {
  // A fast path optimization, try evaluating all goals with
  // a very low recursion depth and bail if any of them don't
  // hold.
  if (!obligations.every((o) => solve.SolverDelegateEvalExt_for_D.root_goal_may_hold_with_depth(SolverDelegate.from(infcx), 8, Goal.new(as_interner(infcx.tcx), o.param_env, o.predicate, upcast_from_self)))) {
    return { $: "Yes" };
  }

  const ocx = ObligationCtxt.new(infcx);
  ocx.register_obligations(obligations.map((o) => clone_Obligation(o, (p) => p)));
  const hard_errors = ocx.try_evaluate_obligations();
  if (hard_errors.$ === "HasErrors") {
    assert(
      hard_errors._0.every((e) => ScrubbedTraitError.is_true_error(e)),
      "should not have detected ambiguity during first pass",
    );
    return { $: "Yes" };
  }

  // Make a new `ObligationCtxt` and re-prove the ambiguities with a richer
  // `FulfillmentError`. This is so that we can detect overflowing obligations
  // without needing to run the `BestObligation` visitor on true errors.
  const ambiguities = ocx.into_pending_obligations();
  const ocx2 = ObligationCtxt.new_with_diagnostics(infcx);
  ocx2.register_obligations(ambiguities);
  const errors_and_ambiguities = ocx2.evaluate_obligations_error_on_ambiguity();
  // We only care about the obligations that are *definitely* true errors.
  // Ambiguities do not prove the disjointness of two impls.
  const errors: FulfillmentError[] = [];
  const ambiguities2: FulfillmentError[] = [];
  for (const error of TraitErrors.as_slice(errors_and_ambiguities)) {
    (error.is_true_error() ? errors : ambiguities2).push(error);
  }
  assert(errors.length === 0, "should not have ambiguities during second pass");

  return {
    $: "No",
    overflowing_predicates: ambiguities2
      .filter((error) => error.code.$ === "Ambiguity" && error.code.overflow === true)
      .map((e) => infcx.deeply_resolve_ignoring_regions(e.obligation.predicate, fold_Predicate)),
  };
}

/// Check if both impls can be satisfied by a common type by considering whether
/// any of first impl's obligations is known not to hold *via a negative predicate*.
///
/// For example, given these two impls:
///     `struct MyCustomBox<T: ?Sized>(Box<T>);`
///     `impl From<&str> for MyCustomBox<dyn Error>` (in my crate)
///     `impl<E> From<E> for MyCustomBox<dyn Error> where E: Error` (in my crate)
///
/// After replacing the second impl's header with inference vars, we get:
///     `MyCustomBox<dyn Error>: From<&str>`
///     `MyCustomBox<dyn Error>: From<?E>`
///
/// This gives us `?E = &str`. We then try to prove the first impl's predicates
/// after negating, giving us `&str: !Error`. This is a negative impl provided by
/// libstd, and therefore we can guarantee for certain that libstd will never add
/// a positive impl for `&str: Error` (without it being a breaking change).
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:387 impl_intersection_has_negative_obligation
function impl_intersection_has_negative_obligation(tcx: TyCtxt, impl1_def_id: DefId, impl2_def_id: DefId, is_of_trait: boolean): boolean {
  // debug!("negative_impl(impl1_def_id={:?}, impl2_def_id={:?})", impl1_def_id, impl2_def_id);

  // N.B. We need to unify impl headers *with* `TypingMode::Coherence`,
  // even if proving negative predicates doesn't need `TypingMode::Coherence`.
  const infcx = tcx.infer_ctxt().with_next_trait_solver(true).enable_next_solver_overflow_fcw(false).build(TypingMode.Coherence);
  const root_universe = infcx.universe();
  assert_eq(root_universe, UniverseIndex.ROOT, (u) => UniverseIndex_debug(u));

  const impl1_header = fresh_impl_header(infcx, impl1_def_id, is_of_trait);
  const impl2_header = fresh_impl_header(infcx, impl2_def_id, is_of_trait);

  // Equate the headers to find their intersection (the general type, with infer vars,
  // that may apply both impls).
  const equate_obligations = equate_impl_headers(infcx, ParamEnv.empty(), impl1_header, impl2_header);
  if (equate_obligations === undefined) {
    return false;
  }

  // FIXME(with_negative_coherence): the infcx has constraints from equating
  // the impl headers. We should use these constraints as assumptions, not as
  // requirements, when proving the negated where clauses below.
  // drop(equate_obligations);
  infcx.take_registered_region_obligations();
  infcx.take_registered_region_assumptions();
  infcx.take_and_reset_region_constraints();

  plug_infer_with_placeholders(infcx, root_universe, [impl1_header.impl_args, impl2_header.impl_args], d_GenericArgs_pair);

  // Right above we plug inference variables with placeholders,
  // this gets us new impl1_header_args with the inference variables actually resolved
  // to those placeholders.
  const impl1_header_args = infcx.deeply_resolve_ignoring_regions(impl1_header.impl_args, fold_GenericArgs);
  // So there are no infer variables left now, except regions which aren't resolved by
  // `deeply_resolve_ignoring_regions`.
  assert(!TypeVisitableExt.has_non_region_infer(impl1_header_args, fold_GenericArgs), "assertion failed: !impl1_header_args.has_non_region_infer()");

  // PORT: the `param_env` query value is typed `unknown` in queries.gen.ts.
  const param_env = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(EarlyBinder.bind(tcx, tcx.param_env(impl1_def_id) as ParamEnv, fold_ParamEnv()), tcx, impl1_header_args, fold_ParamEnv()),
  );

  const clauses = [...clauses_of_instantiate(tcx, impl2_def_id, impl2_header.impl_args).into_iter()].map(([c, s]): [Clause, Span] => [Unnormalized.skip_norm_wip(c), s]);
  for (const [clause] of elaborate_clause_span(tcx, clauses).elaborate_sized()) {
    if (try_prove_negated_where_clause(infcx, clause, param_env)) return true;
  }
  return false;
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:453 plug_infer_with_placeholders
function plug_infer_with_placeholders<T>(infcx: InferCtxt, universe: UniverseIndex, value: T, d_T: TypeVisitable<T>): void {
  d_T.visit_with(value, new PlugInferWithPlaceholder(infcx, universe, BoundVar.ZERO));
}

// PORT: the fn-local `struct PlugInferWithPlaceholder` of `plug_infer_with_placeholders`, at module level.
class PlugInferWithPlaceholder implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result = VisitorResult.unit;

  constructor(
    public infcx: InferCtxt,
    public universe: UniverseIndex,
    public var_: BoundVar,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:465 next_var
  next_var(): BoundVar {
    const var_ = this.var_;
    this.var_ = BoundVar.from_u32(BoundVar.as_u32(this.var_) + 1);
    return var_;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:473 visit_ty
  visit_ty(ty_: Ty): undefined {
    const ty = this.infcx.shallow_resolve(ty_);
    if (ty.is_ty_var()) {
      const r = this.infcx.at(ObligationCause.dummy(), ParamEnv.empty()).eq(
        // Comparing against a type variable never registers hidden types anyway
        "Yes",
        ty,
        TyC.new_placeholder(this.infcx.tcx, PlaceholderType.new(this.universe, { var: this.next_var(), kind: BoundTyKind.Anon })),
        ToTrace_Ty,
      );
      if (r.$ !== "Ok") {
        return bug("we always expect to be able to plug an infer var with placeholder");
      }
      const { obligations } = r._0 as InferOk<null>;
      assert_eq(obligations.length, 0, String);
    } else {
      fold_Ty.super_visit_with(ty, this);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:498 visit_const
  visit_const(ct_: Const): undefined {
    const ct = this.infcx.shallow_resolve_const(ct_);
    if (ct.is_ct_infer()) {
      const r = this.infcx.at(ObligationCause.dummy(), ParamEnv.empty()).eq(
        // The types of the constants are the same, so there is no hidden type
        // registration happening anyway.
        "Yes",
        ct,
        Const.new_placeholder(this.infcx.tcx, PlaceholderConst.new(this.universe, BoundConst.new(this.next_var()))),
        ToTrace_Const,
      );
      if (r.$ !== "Ok") {
        return bug("we always expect to be able to plug an infer var with placeholder");
      }
      const { obligations } = r._0 as InferOk<null>;
      assert_eq(obligations.length, 0, String);
    } else {
      fold_Const_().super_visit_with(ct, this);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:524 visit_region
  visit_region(r_: Region): undefined {
    const rk = r_.kind();
    if (rk.$ === "ReVar") {
      const vid = rk._0;
      const r = this.infcx.inner.unwrap_region_constraints().shallow_resolve_region_var(this.infcx.tcx, vid);
      if (r.is_var()) {
        const res = this.infcx.at(ObligationCause.dummy(), ParamEnv.empty()).eq(
          // Lifetimes don't contain opaque types (or any types for that matter).
          "Yes",
          r,
          Region.new_placeholder(this.infcx.tcx, PlaceholderRegion.new(this.universe, { var: this.next_var(), kind: BoundRegionKind.Anon })),
          ToTrace_Region,
        );
        if (res.$ !== "Ok") {
          return bug("we always expect to be able to plug an infer var with placeholder");
        }
        const { obligations } = res._0 as InferOk<null>;
        assert_eq(obligations.length, 0, String);
      }
    }
  }

  // (provided) the methods `PlugInferWithPlaceholder` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:561 try_prove_negated_where_clause
function try_prove_negated_where_clause(root_infcx: InferCtxt, clause: Clause, param_env: ParamEnv): boolean {
  const negative_predicate = clause.as_predicate().flip_polarity(root_infcx.tcx);
  if (negative_predicate === undefined) {
    return false;
  }

  // N.B. We don't need to use intercrate mode here because we're trying to prove
  // the *existence* of a negative goal, not the non-existence of a positive goal.
  // Without this, we over-eagerly register coherence ambiguity candidates when
  // impl candidates do exist.
  // FIXME(#132279): `TypingMode::non_body_analysis` is a bit questionable here as it
  // would cause us to reveal opaque types to leak their auto traits.
  const infcx = root_infcx.fork_with_typing_mode(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new(infcx);
  ocx.register_obligation(Obligation.new(infcx.tcx, ObligationCause.dummy(), param_env, negative_predicate, upcast_from_self));
  if (!TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
    return false;
  }

  // FIXME: We could use the assumed_wf_types from both impls, I think,
  // if that wasn't implemented just for LocalDefId, and we'd need to do
  // the normalization ourselves since this is totally fallible...
  return ocx.resolve_regions(CRATE_DEF_ID, param_env, []).length === 0;
}

/// Compute the `intercrate_ambiguity_causes` for the new solver using
/// "proof trees".
///
/// This is a bit scuffed but seems to be good enough, at least
/// when looking at UI tests. Given that it is only used to improve
/// diagnostics this is good enough. We can always improve it once there
/// are test cases where it is currently not enough.
// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:601 compute_intercrate_ambiguity_causes
function compute_intercrate_ambiguity_causes(infcx: InferCtxt, obligations: readonly PredicateObligation[]): KeyedSet<IntercrateAmbiguityCause> {
  const causes = new KeyedSet<IntercrateAmbiguityCause>(intern_key);

  for (const obligation of obligations) {
    search_ambiguity_causes(infcx, obligation.as_goal(), causes);
  }

  return causes;
}

// rustc-type: compiler/rustc_trait_selection/src/traits/coherence.rs:614 AmbiguityCausesVisitor
// PORT: `impl ProofTreeVisitor for AmbiguityCausesVisitor`; the provided `config` / `on_recursion_limit` forward to
// `ProofTreeVisitor_provided`.
class AmbiguityCausesVisitor implements ProofTreeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result = VisitorResult.unit;

  constructor(
    public cache: KeyedSet<Goal<Predicate>>,
    public causes: KeyedSet<IntercrateAmbiguityCause>,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:620 span
  span(): Span {
    return DUMMY_SP;
  }

  config(): InspectConfig {
    return ProofTreeVisitor_provided.config(this);
  }

  on_recursion_limit(): undefined {
    return ProofTreeVisitor_provided.on_recursion_limit(this);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:624 visit_goal
  visit_goal(goal: InspectGoal): undefined {
    // `if !self.cache.insert(goal.goal())`
    const g = goal.goal();
    if (this.cache.has(g)) {
      return undefined;
    }
    this.cache.add(g);

    const infcx = goal.infcx();
    for (const cand of goal.candidates()) {
      cand.visit_nested_in_probe(this);
    }
    // When searching for intercrate ambiguity causes, we only need to look
    // at ambiguous goals, as for others the coherence unknowable candidate
    // was irrelevant.
    const res = goal.result();
    if ((res.$ === "Ok" && res._0.$ === "Yes") || res.$ === "Err") {
      return undefined;
    }
    // Ok(Certainty::Maybe(_)) => {}

    // For bound predicates we simply call `infcx.enter_forall`
    // and then prove the resulting predicate as a nested goal.
    const { param_env, predicate } = goal.goal();
    const predicate_kind = goal.infcx().enter_forall_and_leak_universe(predicate.kind(), d_PredicateKind);
    let trait_ref: TraitRef;
    if (predicate_kind.$ === "Clause" && predicate_kind._0.$ === "Trait") {
      const tr = predicate_kind._0._0;
      trait_ref = tr.trait_ref;
    } else if (predicate_kind.$ === "Clause" && predicate_kind._0.$ === "Projection" && AliasTermKind.is_trait_projection(predicate_kind._0._0.projection_term.kind)) {
      const proj = predicate_kind._0._0;
      trait_ref = AliasTerm.trait_ref(proj.projection_term, as_interner(infcx.tcx));
    } else {
      return undefined;
    }

    if (TypeVisitableExt.references_error(trait_ref, d_TraitRef)) {
      return undefined;
    }

    const candidates = goal.candidates();

    // We also look for unknowable candidates. In case a goal is unknowable, there's
    // always exactly 1 candidate.
    const cand = candidates.pop();
    if (cand === undefined) {
      return undefined;
    }

    const kind = cand.kind();
    if (!(kind.$ === "TraitCandidate" && kind.source.$ === "CoherenceUnknowable" && kind.result.$ === "Ok")) {
      return undefined;
    }

    const lazily_normalize_ty = (ty_: Ty): Result<Ty, null> => {
      let ty = ty_;
      if (ty.kind().$ === "Alias") {
        const ocx = ObligationCtxt.new(infcx);
        const r = ocx.structurally_normalize_ty(ObligationCause.dummy(), param_env, Unnormalized.new_wip(ty));
        // `.map_err(|_| ())?`
        if (r.$ === "Err") return Err(null);
        ty = r._0;
        if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
          return Err(null);
        }
      }
      return Ok(ty);
    };

    infcx.probe((_) => {
      const k = trait_ref_is_knowable(infcx, trait_ref, lazily_normalize_ty);
      let conflict: Conflict;
      if (k.$ === "Err") {
        return;
      } else if (k._0.$ === "Ok") {
        // warn!("expected an unknowable trait ref: {trait_ref:?}");
        return;
      } else {
        conflict = k._0._0;
      }

      // It is only relevant that a goal is unknowable if it would have otherwise
      // failed.
      // FIXME(#132279): Forking with `TypingMode::non_body_analysis` is a bit questionable
      // as it would allow us to reveal opaque types, potentially causing unexpected
      // cycles.
      const non_intercrate_infcx = infcx.fork_with_typing_mode(TypingMode.non_body_analysis());
      if (non_intercrate_infcx.predicate_may_hold(Obligation.new(infcx.tcx, ObligationCause.dummy(), param_env, predicate, upcast_from_self))) {
        return;
      }

      // Normalize the trait ref for diagnostics, ignoring any errors if this fails.
      const trait_ref2 = deeply_normalize_for_diagnostics(infcx, param_env, trait_ref, d_TraitRef);
      const self_ty0 = TraitRef.self_ty(trait_ref2);
      const self_ty = self_ty0.has_concrete_skeleton() ? self_ty0 : undefined;
      switch (conflict) {
        case Conflict.Upstream:
          this.causes.add({ $: "UpstreamCrateUpdate", trait_ref: trait_ref2, self_ty });
          break;
        case Conflict.Downstream:
          this.causes.add({ $: "DownstreamCrate", trait_ref: trait_ref2, self_ty });
          break;
      }
    });
    return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/coherence.rs:733 search_ambiguity_causes
function search_ambiguity_causes(infcx: InferCtxt, goal: Goal<Predicate>, causes: KeyedSet<IntercrateAmbiguityCause>): void {
  infcx.probe((_) => {
    infcx.visit_proof_tree(goal, new AmbiguityCausesVisitor(new KeyedSet<Goal<Predicate>>(intern_key), causes));
  });
}

// ---- helpers -------------------------------------------------------------------------------------------------------

/** `tcx.clauses_of(def_id).instantiate(tcx, args)` (PORT: the `clauses_of` query value is typed `unknown`). */
function clauses_of_instantiate(tcx: TyCtxt, def_id: DefId, args: GenericArgs): import("../../rustc_middle/ty/mod.ts").InstantiatedClauses {
  const { GenericClauses } = require("../../rustc_middle/ty/generics.ts") as typeof import("../../rustc_middle/ty/generics.ts");
  return GenericClauses.instantiate(tcx.clauses_of(def_id) as import("../../rustc_middle/ty/generics.ts").GenericClauses, tcx, args);
}

/** `(GenericArgsRef, GenericArgsRef)`'s `TypeVisitable` (the tuple impl). */
const d_GenericArgs_pair: TypeVisitable<[GenericArgs, GenericArgs]> = {
  visit_with<R>(self: [GenericArgs, GenericArgs], visitor: TypeVisitor<R>): R {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, fold_GenericArgs.visit_with(self[0], visitor))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, fold_GenericArgs.visit_with(self[1], visitor))) !== undefined) return r;
    return visitor.Result.output();
  },
};

/** `ParamEnv`'s `TypeFoldable` (ty/mod.ts's derive fns) as a D4 descriptor. */
function fold_ParamEnv(): TypeFoldable<ParamEnv> {
  const m = require("../../rustc_middle/ty/mod.ts") as typeof import("../../rustc_middle/ty/mod.ts");
  return { visit_with: m.visit_with_ParamEnv, try_fold_with: m.try_fold_with_ParamEnv, fold_with: m.fold_with_ParamEnv };
}

function fold_Const_(): typeof import("../../rustc_type_ir/sty/consts.ts").fold_Const {
  return (require("../../rustc_type_ir/sty/consts.ts") as typeof import("../../rustc_type_ir/sty/consts.ts")).fold_Const;
}

/** `UniverseIndex`'s derived `Debug` (`U0`), for `assert_eq!`. */
function UniverseIndex_debug(u: UniverseIndex): string {
  return `U${UniverseIndex.as_u32(u)}`;
}

// ---- stand-ins for items that are not ported yet (each stops as UNPORTED) ------------------------------------------

/** `traits::select::IntercrateAmbiguityCause` (traits/select/mod.rs:57, wave 20 selcx-contract): the type only. */
export type IntercrateAmbiguityCause =
  | { readonly $: "DownstreamCrate"; trait_ref: TraitRef; self_ty: Ty | undefined }
  | { readonly $: "UpstreamCrateUpdate"; trait_ref: TraitRef; self_ty: Ty | undefined };

/** Stand-in for `error_reporting::traits::suggest_new_overflow_limit` (error_reporting/traits/overflow.rs:20, wave 19). */
function suggest_new_overflow_limit(_tcx: TyCtxt, _err: Diag): void {
  unported("rustc_trait_selection::error_reporting::traits::overflow::suggest_new_overflow_limit");
}

/** Stand-in for `util::elaborate(tcx, iter)` over `(Clause, Span)` (`impl Elaboratable for (Clause, Span)`,
 *  rustc_middle ty/elaborate_impl.rs:66, not ported). */
function elaborate_clause_span(_tcx: TyCtxt, _obligations: Iterable<[Clause, Span]>): Elaborator<[Clause, Span]> {
  return unported("rustc_middle::ty::elaborate_impl: impl Elaboratable for (Clause, Span)");
}
