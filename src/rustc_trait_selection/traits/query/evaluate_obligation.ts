// Port of compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs (lane selcx-contract; the contract stub
// was lane infcx-contract's). `#[extension(pub trait InferCtxtExt)] impl InferCtxt` puts its methods on
// `InferCtxt.prototype` (rustc_trait_selection decls.ts).
//
// PORT: `self.probe(|snapshot| ..)` passes the `CombinedSnapshot`; `result.max(..)` is the derived `Ord` of
// `EvaluationResult` (its discriminants). Init order: top-level code here touches only rustc_infer (loaded first by
// ../../lib.ts) and other crates; this crate's modules are read inside function bodies only.

import { InferCtxt } from "../../../rustc_infer/decls.ts";
import { clone_Obligation, type PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import { ScrubbedTraitError, TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { OriginalQueryValues } from "../../../rustc_middle/infer/canonical.ts";
import { EvaluationResult, EvaluationResult_discriminant, debug_OverflowError, type OverflowError } from "../../../rustc_middle/traits/select.ts";
import type { Predicate } from "../../../rustc_middle/ty/decls.ts";
import { debug_Predicate, fold_Predicate } from "../../../rustc_middle/ty/structural_impls.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { Goal, type Goal as GoalT } from "../../../rustc_type_ir/solve/mod.ts";
import { as_interner } from "../../../rustc_type_ir/predicate.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/structural_impls.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";

/** `Ord::max` of `EvaluationResult` (derived: discriminant order). */
function EvaluationResult_max(a: EvaluationResult, b: EvaluationResult): EvaluationResult {
  return EvaluationResult_discriminant[b] >= EvaluationResult_discriminant[a] ? b : a;
}

// ---- #[extension(pub trait InferCtxtExt<'tcx>)] impl<'tcx> InferCtxt<'tcx> ------------------------------------------

/// Evaluates whether the predicate can be satisfied (by any means)
/// in the given `ParamEnv`.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:18 predicate_may_hold
InferCtxt.prototype.predicate_may_hold = function (this: InferCtxt, obligation: PredicateObligation): boolean {
  return EvaluationResult.may_apply(this.evaluate_obligation_no_overflow(obligation));
};

/// See the comment on [OpaqueTypesJank](crate::solve::OpaqueTypesJank)
/// for more details.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:24 predicate_may_hold_opaque_types_jank
InferCtxt.prototype.predicate_may_hold_opaque_types_jank = function (this: InferCtxt, obligation: PredicateObligation): boolean {
  if (this.next_trait_solver()) {
    return this.goal_may_hold_opaque_types_jank(Goal.new(as_interner(this.tcx), obligation.param_env, obligation.predicate, (p: Predicate) => p));
  } else {
    return this.predicate_may_hold(obligation);
  }
};

/// See the comment on [OpaqueTypesJank](crate::solve::OpaqueTypesJank)
/// for more details.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:38 goal_may_hold_opaque_types_jank
InferCtxt.prototype.goal_may_hold_opaque_types_jank = function (this: InferCtxt, goal: GoalT<Predicate>): boolean {
  assert(this.next_trait_solver(), "assertion failed: self.next_trait_solver()");
  const { SolverDelegate } = (delegate__m ??= require("../../solve/delegate.ts") as typeof import("../../solve/delegate.ts"));
  const { solve } = (next_trait_solver__m ??= require("../../../rustc_next_trait_solver/lib.ts") as typeof import("../../../rustc_next_trait_solver/lib.ts"));
  return solve.SolverDelegateEvalExt_for_D.root_goal_may_hold_opaque_types_jank(SolverDelegate.from(this), goal);
};

/// Evaluates whether the predicate can be satisfied in the given
/// `ParamEnv`, and returns `false` if not certain. However, this is
/// not entirely accurate if inference variables are involved.
///
/// This version may conservatively fail when outlives obligations
/// are required. Therefore, this version should only be used for
/// optimizations or diagnostics and be treated as if it can always
/// return `false`.
///
/// # Example
///
/// ```
/// # #![allow(dead_code)]
/// trait Trait {}
///
/// fn check<T: Trait>() {}
///
/// fn foo<T: 'static>()
/// where
///     &'static T: Trait,
/// {
///     // Evaluating `&'?0 T: Trait` adds a `'?0: 'static` outlives obligation,
///     // which means that `predicate_must_hold_considering_regions` will return
///     // `false`.
///     check::<&'_ T>();
/// }
/// ```
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:70 predicate_must_hold_considering_regions
InferCtxt.prototype.predicate_must_hold_considering_regions = function (this: InferCtxt, obligation: PredicateObligation): boolean {
  return EvaluationResult.must_apply_considering_regions(this.evaluate_obligation_no_overflow(obligation));
};

/// Evaluates whether the predicate can be satisfied in the given
/// `ParamEnv`, and returns `false` if not certain. However, this is
/// not entirely accurate if inference variables are involved.
///
/// This version ignores all outlives constraints.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:82 predicate_must_hold_modulo_regions
InferCtxt.prototype.predicate_must_hold_modulo_regions = function (this: InferCtxt, obligation: PredicateObligation): boolean {
  return EvaluationResult.must_apply_modulo_regions(this.evaluate_obligation_no_overflow(obligation));
};

/// Evaluate a given predicate, capturing overflow and propagating it back.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:87 evaluate_obligation
InferCtxt.prototype.evaluate_obligation = function (this: InferCtxt, obligation: PredicateObligation): Result<EvaluationResult, OverflowError> {
  const _orig_values = OriginalQueryValues.default_();

  const param_env = obligation.param_env;

  if (this.next_trait_solver()) {
    return this.probe((snapshot) => {
      const { ObligationCtxt } = (engine__m ??= require("../engine.ts") as typeof import("../engine.ts"));
      const ocx = ObligationCtxt.new(this);
      ocx.register_obligation(clone_Obligation(obligation, (p) => p));
      let result: EvaluationResult = "EvaluatedToOk";
      for (const error of TraitErrors.into_iter(ocx.evaluate_obligations_error_on_ambiguity())) {
        if (ScrubbedTraitError.is_true_error(error)) {
          return Ok<EvaluationResult>("EvaluatedToErr");
        } else {
          result = EvaluationResult_max(result, "EvaluatedToAmbig");
        }
      }
      if (this.opaque_types_added_in_snapshot(snapshot)) {
        result = EvaluationResult_max(result, "EvaluatedToOkModuloOpaqueTypes");
      } else if (this.region_constraints_added_in_snapshot(snapshot)) {
        result = EvaluationResult_max(result, "EvaluatedToOkModuloRegions");
      }
      return Ok(result);
    });
  } else {
    const c_pred = this.canonicalize_query(param_env.and(obligation.predicate), _orig_values, fold_Predicate);
    return this.tcx.at(obligation.cause.span).evaluate_obligation(c_pred) as Result<EvaluationResult, OverflowError>;
  }
};

/// Helper function that canonicalizes and runs the query. If an
/// overflow results, we re-run it in the local context so we can
/// report a nice error.
// rustc: compiler/rustc_trait_selection/src/traits/query/evaluate_obligation.rs:124 evaluate_obligation_no_overflow
InferCtxt.prototype.evaluate_obligation_no_overflow = function (this: InferCtxt, obligation: PredicateObligation): EvaluationResult {
  // Run canonical query. If overflow occurs, rerun from scratch but this time
  // in standard trait query mode so that overflow is handled appropriately
  // within `SelectionContext`.
  const r = this.evaluate_obligation(obligation);
  if (r.$ === "Ok") {
    return r._0;
  }
  switch (r._0.$) {
    case "Canonical": {
      const { SelectionContext } = require("../select/mod.ts") as typeof import("../select/mod.ts");
      const selcx = SelectionContext.new(this);
      const r2 = selcx.evaluate_root_obligation(obligation);
      if (r2.$ === "Ok") return r2._0;
      const e = r2._0;
      switch (e.$) {
        case "Canonical":
          return span_bug(
            obligation.cause.span,
            `Overflow should be caught earlier in standard query mode: ${debug_Obligation(obligation, PLAIN, debug_Predicate)}, ${debug_OverflowError(e, PLAIN)}`,
          );
        case "Error":
          return "EvaluatedToErr";
      }
    }
    // falls through (unreachable: the inner switch returns)
    case "Error":
      return "EvaluatedToErr";
  }
};

var engine__m: typeof import("../engine.ts") | undefined; // PORT: (perf) lazy-require memo (precedent: perf-intern)
var delegate__m: typeof import("../../solve/delegate.ts") | undefined; // PORT: (perf) lazy-require memo (precedent: perf-intern)
var next_trait_solver__m: typeof import("../../../rustc_next_trait_solver/lib.ts") | undefined; // PORT: (perf) lazy-require memo (precedent: perf-intern)
