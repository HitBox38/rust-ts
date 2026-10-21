//! Logic and data structures related to impl specialization, explained in
//! greater detail below.
//!
//! At the moment, this implementation support only the simple "chain" rule:
//! If any two impls overlap, one must be a strict subset of the other.
//!
//! See the [rustc dev guide] for a bit more detail on how specialization
//! fits together with the rest of the trait machinery.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/specialization.html
//
// Port of compiler/rustc_trait_selection/src/traits/specialize/mod.rs (lane trait-sel-traits-c).
//
// PORT notes (file-wide):
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`; `Result::and` is `and` (eager argument).
// - `OverlapError`'s `#[derive(Debug)]` only serves `debug!` tracing and is not ported.
// - `tcx.arena.alloc(sg)` is `sg` (arenas are erased).
// - Iterators that upstream feeds lazily into `ObligationCtxt::register_obligations` (which normalizes as it goes) are
//   generators here, so normalization and registration interleave as upstream.
// - The items this file calls that are not ported yet (`NegativePositiveConflict`, unassigned) are local stand-ins at the end of the file that stop as UNPORTED.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.

import { predicates_for_generics } from "../mod.ts";
import { ObligationCtxt } from "../engine.ts";
import { type Diag, type Diagnostic, DiagDecorator, E0119 } from "../../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { ToTrace_TraitRef } from "../../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { Obligation, type PredicateObligation, type ScrubbedTraitError } from "../../../rustc_infer/traits/mod.ts";
import { COHERENCE_LEAK_CHECK } from "../../../rustc_lint_defs/builtin.gen.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import { clone_ObligationCause, ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { LocalCrate } from "../../../rustc_middle/query/keys.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { ConstConditions, type ConstConditions as ConstConditionsT, GenericClauses, type GenericClauses as GenericClausesT } from "../../../rustc_middle/ty/generics.ts";
import type { ImplTraitHeader, InstantiatedClauses, ParamEnv, Ty } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty, TraitRef_print_trait_sugared, display_TraitRefPrintSugared } from "../../../rustc_middle/ty/print/pretty.ts";
import type { TraitImpls } from "../../../rustc_middle/ty/trait_def.ts";
import { TraitImpls as TraitImplsC } from "../../../rustc_middle/ty/trait_def.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { CrateNum, type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { type Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { fold_Option, fold_tuple2, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { display_TraitRef } from "../../../rustc_type_ir/ir_print.ts";
import { fold_with_TraitRef, PolyTraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import type { TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { IntercrateAmbiguityCause } from "../select/mod.ts";
import { type FutureCompatOverlapErrorKind, Graph, type Node, OverlapMode } from "./specialization_graph.ts";
import { to_pretty_impl_header } from "../../error_reporting/traits/mod.ts";

// `pub mod specialization_graph;`
export * as specialization_graph from "./specialization_graph.ts";

/** The unit struct `NoSolution`. */
const NO_SOLUTION: NoSolution = Object.freeze({});

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/// Information pertinent to an overlapping impl error.
// rustc-type: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:42 OverlapError
export interface OverlapError {
  with_impl: DefId;
  trait_ref: TraitRef;
  self_ty: Ty | undefined;
  intercrate_ambiguity_causes: KeyedSet<IntercrateAmbiguityCause>;
  involves_placeholder: boolean;
  overflowing_predicates: Predicate[];
}

/// Given the generic parameters for the requested impl, translate it to the generic parameters
/// appropriate for the actual item definition (whether it be in that impl,
/// a parent impl, or the trait).
///
/// When we have selected one impl, but are actually using item definitions from
/// a parent impl providing a default, we need a way to translate between the
/// type parameters of the two impls. Here the `source_impl` is the one we've
/// selected, and `source_args` is its generic parameters.
/// And `target_node` is the impl/trait we're actually going to get the
/// definition from. The resulting instantiation will map from `target_node`'s
/// generics to `source_impl`'s generics as instantiated by `source_args`.
///
/// For example, consider the following scenario:
///
/// ```ignore (illustrative)
/// trait Foo { ... }
/// impl<T, U> Foo for (T, U) { ... }  // target impl
/// impl<V> Foo for (V, V) { ... }     // source impl
/// ```
///
/// Suppose we have selected "source impl" with `V` instantiated with `u32`.
/// This function will produce an instantiation with `T` and `U` both mapping to `u32`.
///
/// where-clauses add some trickiness here, because they can be used to "define"
/// an argument indirectly:
///
/// ```ignore (illustrative)
/// impl<'a, I, T: 'a> Iterator for Cloned<I>
///    where I: Iterator<Item = &'a T>, T: Clone
/// ```
///
/// In a case like this, the instantiation for `T` is determined indirectly,
/// through associated type projection. We deal with such cases by using
/// *fulfillment* to relate the two impls, requiring that all projections are
/// resolved.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:86 translate_args
export function translate_args(infcx: InferCtxt, param_env: ParamEnv, source_impl: DefId, source_args: GenericArgsRef, target_node: Node): GenericArgsRef {
  return translate_args_with_cause(infcx, param_env, source_impl, source_args, target_node, ObligationCause.dummy());
}

/// Like [translate_args], but obligations from the parent implementation
/// are registered with the provided `ObligationCause`.
///
/// This is for reporting *region* errors from those bounds. Type errors should
/// not happen because the specialization graph already checks for those, and
/// will result in an ICE.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:109 translate_args_with_cause
export function translate_args_with_cause(
  infcx: InferCtxt,
  param_env: ParamEnv,
  source_impl: DefId,
  source_args: GenericArgsRef,
  target_node: Node,
  cause: ObligationCause,
): GenericArgsRef {
  // debug!(
  //     "translate_args({:?}, {:?}, {:?}, {:?})",
  //     param_env, source_impl, source_args, target_node
  // );
  const source_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(infcx.tcx.impl_trait_ref(source_impl), infcx.tcx, source_args, d_TraitRef));

  // translate the Self and Param parts of the generic parameters, since those
  // vary across impls
  let target_args: GenericArgsRef;
  switch (target_node.$) {
    case "Impl": {
      const target_impl = target_node._0;
      // no need to translate if we're targeting the impl we started with
      if (DefId_eq(source_impl, target_impl)) {
        return source_args;
      }

      const r = fulfill_implication(infcx, param_env, source_trait_ref, source_impl, target_impl, cause);
      if (r.$ === "Err") {
        return bug(
          `When translating generic parameters from ${debug_DefId_(source_impl)} to ${debug_DefId_(target_impl)}, the expected specialization failed to hold`,
        );
      }
      target_args = r._0;
      break;
    }
    case "Trait":
      target_args = source_trait_ref.args;
      break;
  }

  // directly inherent the method generics, since those do not vary across impls
  return source_args.rebase_onto(infcx.tcx, source_impl, target_args);
}

/// Attempt to fulfill all obligations of `target_impl` after unification with
/// `source_trait_ref`. If successful, returns the generic parameters for *all* the
/// generics of `target_impl`, including both those needed to unify with
/// `source_trait_ref` and those whose identity is determined via a where
/// clause in the impl.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:153 fulfill_implication
function fulfill_implication(
  infcx: InferCtxt,
  param_env: ParamEnv,
  source_trait_ref_: TraitRef,
  source_impl: DefId,
  target_impl: DefId,
  cause: ObligationCause,
): Result<GenericArgsRef, NoSolution> {
  // debug!(
  //     "fulfill_implication({:?}, trait_ref={:?} |- {:?} applies)",
  //     param_env, source_trait_ref, target_impl
  // );

  const ocx = ObligationCtxt.new(infcx);
  const source_trait_ref = ocx.normalize(cause, param_env, Unnormalized.new_wip(source_trait_ref_), d_TraitRef);

  if (!TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
    infcx.dcx().span_delayed_bug(infcx.tcx.def_span(source_impl), `failed to fully normalize ${display_TraitRef(source_trait_ref)}`);
    return Err(NO_SOLUTION);
  }

  const target_args = infcx.fresh_args_for_item(DUMMY_SP, target_impl);
  const target_trait_ref = ocx.normalize(cause, param_env, EarlyBinder.instantiate(infcx.tcx.impl_trait_ref(target_impl), infcx.tcx, target_args, d_TraitRef), d_TraitRef);

  // do the impls unify? If not, no specialization.
  const eq = ocx.eq(cause, param_env, source_trait_ref, target_trait_ref, ToTrace_TraitRef);
  // PORT: `?` converts the `TypeError` into `NoSolution` (`impl From<TypeError> for NoSolution`).
  if (eq.$ === "Err") return Err(NO_SOLUTION);

  // Now check that the source trait ref satisfies all the where clauses of the target impl.
  // This is not just for correctness; we also need this to constrain any params that may
  // only be referenced via projection predicates.
  const clauses = GenericClauses.instantiate(infcx.tcx.clauses_of(target_impl) as GenericClausesT, infcx.tcx, target_args);
  const obligations = predicates_for_generics(
    (_, _span) => clone_ObligationCause(cause),
    (clause) => ocx.normalize(cause, param_env, clause, fold_Clause()),
    param_env,
    clauses,
  );
  ocx.register_obligations(obligations);

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (!TraitErrors.no_errors(errors)) {
    // no dice!
    // debug!(
    //     "fulfill_implication: for impls on {:?} and {:?}, \
    //          could not fulfill: {:?} given {:?}",
    //     source_trait_ref, target_trait_ref, errors, param_env
    // );
    return Err(NO_SOLUTION);
  }

  // debug!(
  //     "fulfill_implication: an impl for {:?} specializes {:?}",
  //     source_trait_ref, target_trait_ref
  // );

  // Now resolve the *generic parameters* we built for the target earlier, replacing
  // the inference variables inside with whatever we got from fulfillment.
  return Ok(infcx.deeply_resolve_ignoring_regions(target_args, fold_GenericArgs()));
}

// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:220 specialization_enabled_in
export function specialization_enabled_in(tcx: TyCtxt, _: LocalCrate): boolean {
  return tcx.features().specialization() || tcx.features().min_specialization();
}

/// Is `specializing_impl_def_id` a specialization of `parent_impl_def_id`?
///
/// For every type that could apply to `specializing_impl_def_id`, we prove that
/// the `parent_impl_def_id` also applies (i.e. it has a valid impl header and
/// its where-clauses hold).
///
/// For the purposes of const traits, we also check that the specializing
/// impl is not more restrictive than the parent impl. That is, if the
/// `parent_impl_def_id` is a const impl (conditionally based off of some `[const]`
/// bounds), then `specializing_impl_def_id` must also be const for the same
/// set of types.
// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:236 specializes
export function specializes(tcx: TyCtxt, [specializing_impl_def_id, parent_impl_def_id]: [DefId, DefId]): boolean {
  // We check that the specializing impl comes from a crate that has specialization enabled,
  // or if the specializing impl is marked with `allow_internal_unstable`.
  //
  // We don't really care if the specialized impl (the parent) is in a crate that has
  // specialization enabled, since it's not being specialized, and it's already been checked
  // for coherence.
  if (!tcx.specialization_enabled_in(specializing_impl_def_id.krate)) {
    const span = tcx.def_span(specializing_impl_def_id);
    if (!Span.allows_unstable(span, sym.specialization) && !Span.allows_unstable(span, sym.min_specialization)) {
      return false;
    }
  }

  // PORT: the `impl_trait_header` query value is typed `unknown` in queries.gen.ts.
  const specializing_impl_trait_header = tcx.impl_trait_header(specializing_impl_def_id) as ImplTraitHeader;

  // We determine whether there's a subset relationship by:
  //
  // - replacing bound vars with placeholders in impl1,
  // - assuming the where clauses for impl1,
  // - instantiating impl2 with fresh inference variables,
  // - unifying,
  // - attempting to prove the where clauses for impl2
  //
  // The last three steps are encapsulated in `fulfill_implication`.
  //
  // See RFC 1210 for more details and justification.

  // Currently we do not allow e.g., a negative impl to specialize a positive one
  if (specializing_impl_trait_header.polarity !== tcx.impl_polarity(parent_impl_def_id)) {
    return false;
  }

  // create a parameter environment corresponding to an identity instantiation of the specializing impl,
  // i.e. the most generic instantiation of the specializing impl.
  // PORT: the `param_env` query value is typed `unknown` in queries.gen.ts.
  const param_env = tcx.param_env(specializing_impl_def_id) as ParamEnv;

  // Create an infcx, taking the predicates of the specializing impl as assumptions:
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());

  const specializing_impl_trait_ref_ = EarlyBinder.instantiate_identity(specializing_impl_trait_header.trait_ref);
  const cause = ObligationCause.dummy();
  // debug!(
  //     "fulfill_implication({:?}, trait_ref={:?} |- {:?} applies)",
  //     param_env, specializing_impl_trait_ref, parent_impl_def_id
  // );

  // Attempt to prove that the parent impl applies, given all of the above.

  const ocx = ObligationCtxt.new(infcx);
  const specializing_impl_trait_ref = ocx.normalize(cause, param_env, specializing_impl_trait_ref_, d_TraitRef);

  if (!TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
    infcx.dcx().span_delayed_bug(infcx.tcx.def_span(specializing_impl_def_id), `failed to fully normalize ${display_TraitRef(specializing_impl_trait_ref)}`);
    return false;
  }

  const parent_args = infcx.fresh_args_for_item(DUMMY_SP, parent_impl_def_id);
  const parent_impl_trait_ref = ocx.normalize(cause, param_env, EarlyBinder.instantiate(infcx.tcx.impl_trait_ref(parent_impl_def_id), infcx.tcx, parent_args, d_TraitRef), d_TraitRef);

  // do the impls unify? If not, no specialization.
  if (ocx.eq(cause, param_env, specializing_impl_trait_ref, parent_impl_trait_ref, ToTrace_TraitRef).$ !== "Ok") {
    return false;
  }

  // Now check that the source trait ref satisfies all the where clauses of the target impl.
  // This is not just for correctness; we also need this to constrain any params that may
  // only be referenced via projection predicates.
  const clauses = GenericClauses.instantiate(infcx.tcx.clauses_of(parent_impl_def_id) as GenericClausesT, infcx.tcx, parent_args);
  const obligations = predicates_for_generics(
    (_, _span) => clone_ObligationCause(cause),
    (clause) => ocx.normalize(cause, param_env, clause, fold_Clause()),
    param_env,
    clauses,
  );
  ocx.register_obligations(obligations);

  let errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (!TraitErrors.no_errors(errors)) {
    // no dice!
    // debug!(
    //     "fulfill_implication: for impls on {:?} and {:?}, \
    //          could not fulfill: {:?} given {:?}",
    //     specializing_impl_trait_ref, parent_impl_trait_ref, errors, param_env
    // );
    return false;
  }

  // If the parent impl is const, then the specializing impl must be const,
  // and it must not be *more restrictive* than the parent impl (that is,
  // it cannot be const in fewer cases than the parent impl).
  if (tcx.is_conditionally_const(parent_impl_def_id)) {
    if (!tcx.is_conditionally_const(specializing_impl_def_id)) {
      return false;
    }

    // PORT: the `const_conditions` query value is typed `unknown` in queries.gen.ts.
    const const_conditions_ = ConstConditions.instantiate(infcx.tcx.const_conditions(parent_impl_def_id) as ConstConditionsT, infcx.tcx, parent_args);
    // `const_conditions.into_iter().map(|(trait_ref, span)| (ocx.normalize(..), span))`, then mapped again into
    // obligations; both maps are lazy, so each normalization runs right before its obligation is registered.
    const const_conditions = (function* (): Generator<[Binder<TraitRef>, Span]> {
      for (const [trait_ref, span] of const_conditions_) {
        yield [ocx.normalize(cause, param_env, trait_ref, d_PolyTraitRef()), span];
      }
    })();
    ocx.register_obligations(
      (function* (): Generator<PredicateObligation> {
        for (const [trait_ref] of const_conditions) {
          yield Obligation.new(infcx.tcx, clone_ObligationCause(cause), param_env, PolyTraitRef.to_host_effect_clause(trait_ref, infcx.tcx, "Maybe"), upcast_Clause_to_Predicate());
        }
      })(),
    );

    errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (!TraitErrors.no_errors(errors)) {
      // no dice!
      // debug!(
      //     "fulfill_implication: for impls on {:?} and {:?}, \
      //      could not fulfill: {:?} given {:?}",
      //     specializing_impl_trait_ref, parent_impl_trait_ref, errors, param_env
      // );
      return false;
    }
  }

  // debug!(
  //     "fulfill_implication: an impl for {:?} specializes {:?}",
  //     specializing_impl_trait_ref, parent_impl_trait_ref
  // );

  return true;
}

/// Query provider for `specialization_graph_of`.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:381 specialization_graph_provider
export function specialization_graph_provider(tcx: TyCtxt, trait_id: DefId): Result<Graph, ErrorGuaranteed> {
  const sg = Graph.new();
  const overlap_mode = OverlapMode.get(tcx, trait_id);

  // Skip foreign non-blanket impls whose simplified-self bucket holds no
  // local impl. This is sound because:
  // - foreign impls are never overlap-checked, only recorded; `Ancestors`
  //   reads their parent lazily from metadata instead (the same value).
  // - a local non-blanket impl is only compared against blanket impls and
  //   impls in its own bucket (see `filtered_children`), and instantiation
  //   preserves the simplified type, so kept buckets are complete at every
  //   level of the tree.
  // - a local blanket impl, including alias self types which simplify to
  //   `None`, is compared against every child, so then all buckets are kept;
  //   pruning them would change error recovery (see impl-unpin.rs, `tait`
  //   revision).
  // PORT: the `trait_impls_of` query value is typed `unknown` in queries.gen.ts.
  const all_impls = tcx.trait_impls_of(trait_id) as TraitImpls;
  const trait_impls: DefId[] = [...TraitImplsC.blanket_impls(all_impls)];
  const has_local_blanket_impl = TraitImplsC.blanket_impls(all_impls).some((impl_def_id) => impl_def_id.is_local());
  for (const [_simplified_self, bucket] of TraitImplsC.non_blanket_impls(all_impls)) {
    if (has_local_blanket_impl || bucket.some((impl_def_id) => impl_def_id.is_local())) {
      trait_impls.push(...bucket);
    } else {
      // PORT: `else if cfg!(debug_assertions) { .. }` is dead in the oracle (a release rustc without debug
      // assertions): it only `debug_assert_eq!`s the metadata-derived bucket key against `simplify_type`.
    }
  }

  // The coherence checking implementation seems to rely on impls being
  // iterated over (roughly) in definition order, so we are sorting by
  // negated `CrateNum` (so remote definitions are visited first) and then
  // by a flattened version of the `DefIndex`.
  // PORT: `sort_unstable_by_key(|def_id| (-(krate as i64), index))`; the keys are distinct, so the order is total.
  trait_impls.sort((a, b) => {
    const ka = -CrateNum.as_u32(a.krate);
    const kb = -CrateNum.as_u32(b.krate);
    if (ka !== kb) return ka - kb;
    return a.index - b.index;
  });

  let errored: Result<null, ErrorGuaranteed> = Ok(null);

  for (const impl_def_id_ of trait_impls) {
    const impl_def_id = impl_def_id_.as_local();
    if (impl_def_id !== undefined) {
      // This is where impl overlap checking happens:
      const insert_result = sg.insert(tcx, LocalDefId.to_def_id(impl_def_id), overlap_mode);
      // Report error if there was one.
      let overlap: OverlapError | undefined;
      let used_to_be_allowed: FutureCompatOverlapErrorKind | undefined;
      if (insert_result.$ === "Err") {
        overlap = insert_result._0;
        used_to_be_allowed = undefined;
      } else if (insert_result._0 !== undefined) {
        const o = insert_result._0;
        overlap = o.error;
        used_to_be_allowed = o.kind;
      } else {
        overlap = undefined;
        used_to_be_allowed = undefined;
      }

      if (overlap !== undefined) {
        errored = and(errored, report_overlap_conflict(tcx, overlap, impl_def_id, used_to_be_allowed));
      }
    } else {
      const parent = tcx.impl_parent(impl_def_id_) ?? trait_id;
      sg.record_impl_from_cstore(tcx, parent, impl_def_id_);
    }
  }
  if (errored.$ === "Err") return errored;

  return Ok(sg);
}

// This function is only used when
// encountering errors and inlining
// it negatively impacts perf.
// #[cold]
// #[inline(never)]
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:464 report_overlap_conflict
function report_overlap_conflict(
  tcx: TyCtxt,
  overlap: OverlapError,
  impl_def_id: LocalDefId,
  used_to_be_allowed: FutureCompatOverlapErrorKind | undefined,
): Result<null, ErrorGuaranteed> {
  const impl_polarity = tcx.impl_polarity(LocalDefId.to_def_id(impl_def_id));
  const other_polarity = tcx.impl_polarity(overlap.with_impl);
  if (impl_polarity === "Negative" && other_polarity === "Positive") {
    return Err(report_negative_positive_conflict(tcx, overlap, impl_def_id, LocalDefId.to_def_id(impl_def_id), overlap.with_impl));
  } else if (impl_polarity === "Positive" && other_polarity === "Negative") {
    return Err(report_negative_positive_conflict(tcx, overlap, impl_def_id, overlap.with_impl, LocalDefId.to_def_id(impl_def_id)));
  } else {
    return report_conflicting_impls(tcx, overlap, impl_def_id, used_to_be_allowed);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:497 report_negative_positive_conflict
function report_negative_positive_conflict(
  tcx: TyCtxt,
  overlap: OverlapError,
  local_impl_def_id: LocalDefId,
  negative_impl_def_id: DefId,
  positive_impl_def_id: DefId,
): ErrorGuaranteed {
  const diag = tcx.dcx().create_err(
    NegativePositiveConflict_diagnostic({
      impl_span: tcx.def_span(local_impl_def_id),
      trait_desc: overlap.trait_ref,
      self_ty: overlap.self_ty,
      negative_impl_span: tcx.span_of_impl(negative_impl_def_id),
      positive_impl_span: tcx.span_of_impl(positive_impl_def_id),
    }),
  );

  for (const cause of overlap.intercrate_ambiguity_causes) {
    IntercrateAmbiguityCause.add_intercrate_ambiguity_hint(cause, diag);
  }

  return diag.emit_err();
}

// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:519 report_conflicting_impls
function report_conflicting_impls(
  tcx: TyCtxt,
  overlap: OverlapError,
  impl_def_id: LocalDefId,
  used_to_be_allowed: FutureCompatOverlapErrorKind | undefined,
): Result<null, ErrorGuaranteed> {
  const impl_span = tcx.def_span(impl_def_id);

  const msg = (): string =>
    `conflicting implementations of trait \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(overlap.trait_ref))}\`${
      overlap.self_ty === undefined ? "" : ` for type \`${display_Ty(overlap.self_ty)}\``
    }`;

  // Don't report overlap errors if the header references error
  const er = TypeVisitableExt.error_reported<[TraitRef, Ty | undefined]>([overlap.trait_ref, overlap.self_ty], fold_tuple2(d_TraitRef, fold_Option(fold_Ty)));
  if (er.$ === "Err") {
    const err = er._0;
    return Err(err);
  }

  if (used_to_be_allowed === undefined) {
    let reported: ErrorGuaranteed;
    if (overlap.with_impl.is_local() || tcx.ensure_result().orphan_check_impl(impl_def_id).$ === "Ok") {
      const err = tcx.dcx().struct_span_err(impl_span, msg());
      err.code(E0119);
      decorate(tcx, overlap, impl_span, err);
      reported = err.emit_err();
    } else {
      reported = tcx.dcx().span_delayed_bug(impl_span, "impl should have failed the orphan check");
    }
    return Err(reported);
  } else {
    const kind = used_to_be_allowed;
    let lint;
    switch (kind) {
      case "LeakCheck":
        lint = COHERENCE_LEAK_CHECK;
        break;
    }
    tcx.emit_node_span_lint(
      lint,
      tcx.local_def_id_to_hir_id(impl_def_id),
      impl_span,
      DiagDecorator((err) => {
        err.primary_message(msg());
        decorate(tcx, overlap, impl_span, err);
      }),
    );
    return Ok(null);
  }
}

// Work to be done after we've built the Diag. We have to define it now
// because the lint emit methods don't return back the Diag that's passed
// in.
// PORT: the fn-local `fn decorate` of `report_conflicting_impls`, at module level.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/mod.rs:530 decorate
function decorate(tcx: TyCtxt, overlap: OverlapError, impl_span: Span, err: Diag): void {
  const coherence = coherence_mod();
  const s = tcx.span_of_impl(overlap.with_impl);
  if (s.$ === "Ok") {
    const span = s._0;
    err.span_label(span, "first implementation here");

    err.span_label(impl_span, `conflicting implementation${overlap.self_ty === undefined ? "" : ` for \`${display_Ty(overlap.self_ty)}\``}`);
  } else {
    const cname = s._0;
    const h = to_pretty_impl_header(tcx, overlap.with_impl);
    let msg: string;
    if (h !== undefined) {
      const s = h;
      msg = `conflicting implementation in crate \`${Symbol.as_str(cname)}\`:\n- ${s}`;
    } else {
      msg = `conflicting implementation in crate \`${Symbol.as_str(cname)}\``;
    }
    err.note(msg);
  }

  for (const cause of overlap.intercrate_ambiguity_causes) {
    IntercrateAmbiguityCause.add_intercrate_ambiguity_hint(cause, err);
  }

  if (overlap.involves_placeholder) {
    coherence.add_placeholder_note(err);
  }

  if (overlap.overflowing_predicates.length !== 0) {
    coherence.suggest_increasing_recursion_limit(tcx, err, overlap.overflowing_predicates);
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

function debug_DefId_(d: DefId): string {
  const m = require("../../../rustc_span/def_id.ts") as typeof import("../../../rustc_span/def_id.ts");
  const { PLAIN } = require("../../../std/fmt.ts") as typeof import("../../../std/fmt.ts");
  return m.debug_DefId(d, PLAIN);
}

function fold_GenericArgs(): TypeFoldable<GenericArgsRef> {
  return (require("../../../rustc_middle/ty/generic_args.ts") as typeof import("../../../rustc_middle/ty/generic_args.ts")).fold_GenericArgs;
}

function fold_Clause(): TypeFoldable<Clause> {
  return (require("../../../rustc_middle/ty/structural_impls.ts") as typeof import("../../../rustc_middle/ty/structural_impls.ts")).fold_Clause;
}

/** `ty::PolyTraitRef`'s `TypeFoldable` (the `Binder<TraitRef>` impl) as a D4 descriptor. */
function d_PolyTraitRef(): TypeFoldable<Binder<TraitRef>> {
  const { fold_Binder } = require("../../../rustc_type_ir/binder.ts") as typeof import("../../../rustc_type_ir/binder.ts");
  return fold_Binder(d_TraitRef);
}

/** `impl Upcast<TyCtxt, Predicate> for Clause` (`Obligation::new(.., clause)` of a `PredicateObligation`). */
function upcast_Clause_to_Predicate(): (from: Clause, tcx: unknown) => Predicate {
  return (from) => from.as_predicate();
}

// ---- lazy loads (init order: ../coherence.ts imports this module's siblings) -----------------------------------------
function coherence_mod(): typeof import("../coherence.ts") {
  return require("../coherence.ts") as typeof import("../coherence.ts");
}

// ---- stand-ins for items that are not ported yet (each stops as UNPORTED) ------------------------------------------


/** the fields of `diagnostics::NegativePositiveConflict` (diagnostics.rs:31). */
interface NegativePositiveConflict {
  impl_span: Span;
  trait_desc: TraitRef;
  self_ty: Ty | undefined;
  negative_impl_span: Result<Span, Symbol>;
  positive_impl_span: Result<Span, Symbol>;
}
/** stand-in for `impl Diagnostic for NegativePositiveConflict` (diagnostics.rs:39, not assigned yet). */
function NegativePositiveConflict_diagnostic(_d: NegativePositiveConflict): Diagnostic {
  return unported("rustc_trait_selection::diagnostics::NegativePositiveConflict");
}

