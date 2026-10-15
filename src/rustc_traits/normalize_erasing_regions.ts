// Port of compiler/rustc_traits/src/normalize_erasing_regions.rs (lane selcx-contract).
//
// PORT: `T: TypeFoldable + PartialEq + Copy` of `try_normalize_after_erasing_regions` is the D4 descriptor `d_T`
// (`PartialEq` is `===`: the provider's `T` is `GenericArg`, interned). The closure provider is `provide`'s arrow.

import { clone_ObligationCause, ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Predicate } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArg, type GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { PseudoCanonicalInput } from "../rustc_middle/ty/mod.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { assert_eq } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { debug_Obligation } from "../rustc_infer/traits/structural_impls.ts";
import { debug_Predicate } from "../rustc_middle/ty/structural_impls.ts";
import { debug_option, PLAIN } from "../std/fmt.ts";

/** `NoSolution` (`rustc_next_trait_solver::solve::NO_SOLUTION`), read lazily (init order). */
function NO_SOLUTION(): NoSolution {
  return (require("../rustc_next_trait_solver/solve/mod.ts") as typeof import("../rustc_next_trait_solver/solve/mod.ts")).NO_SOLUTION;
}

// rustc: compiler/rustc_traits/src/normalize_erasing_regions.rs:9 provide
export function provide(p: Providers): void {
  p.try_normalize_generic_arg_after_erasing_regions = ((tcx: TyCtxt, goal: PseudoCanonicalInput<GenericArg>) => {
    // debug!("try_normalize_generic_arg_after_erasing_regions(goal={:#?}", goal);

    return try_normalize_after_erasing_regions(tcx, goal, fold_GenericArg);
  }) as Providers["try_normalize_generic_arg_after_erasing_regions"];
}

// rustc: compiler/rustc_traits/src/normalize_erasing_regions.rs:20 try_normalize_after_erasing_regions
function try_normalize_after_erasing_regions<T>(tcx: TyCtxt, goal: PseudoCanonicalInput<T>, d_T: TypeFoldable<T>): Result<T, NoSolution> {
  const { typing_env, value } = goal;
  const [infcx, param_env] = tcx.infer_ctxt().ignoring_regions().build_with_typing_env(typing_env);
  const cause = ObligationCause.dummy();
  const r = infcx.at(clone_ObligationCause(cause), param_env).query_normalize(value, d_T);
  if (r.$ === "Ok") {
    const { value: normalized_value, obligations: normalized_obligations } = r._0;
    // We don't care about the `obligations`; they are
    // always only region relations, and we are about to
    // erase those anyway:
    // This has been seen to fail in RL, so making it a non-debug assertion to better catch
    // those cases.
    assert_eq(
      normalized_obligations.find((p) => not_outlives_predicate(p.predicate)),
      undefined,
      (v) => debug_option(v, PLAIN, (o, f) => debug_Obligation(o, f, debug_Predicate)),
    );

    const resolved_value = infcx.deeply_resolve_ignoring_regions(normalized_value, d_T);
    // It's unclear when `resolve_vars` would have an effect in a
    // fresh `InferCtxt`. If this assert does trigger, it will give
    // us a test case.
    // debug_assert_eq!(normalized_value, resolved_value);
    const erased = infcx.tcx.erase_and_anonymize_regions(resolved_value, d_T);
    if (infcx.next_trait_solver()) {
      // debug_assert!(!erased.has_infer(), "{erased:?}");
    } else {
      // The old solver returns an ty var with the failed obligation in case of
      // selection error. And when the obligation is re-tried, the error should be
      // reported. However in case of overflow error, the obligation may be fulfilled
      // due to the original depth being dropped.
      // In conclusion, overflow results in an unconstrained ty var.
      if (TypeVisitableExt.has_infer(erased, d_T)) {
        return Err(NO_SOLUTION());
      }
    }
    return Ok(erased);
  } else {
    return Err(NO_SOLUTION());
  }
}

// rustc: compiler/rustc_traits/src/normalize_erasing_regions.rs:63 not_outlives_predicate
function not_outlives_predicate(p: Predicate): boolean {
  const k = Binder.skip_binder(p.kind());
  switch (k.$) {
    case "Clause":
      switch (k._0.$) {
        case "RegionOutlives":
        case "TypeOutlives":
          return false;
        case "Trait":
        case "Projection":
        case "HostEffect":
        case "ConstArgHasType":
        case "UnstableFeature":
        case "WellFormed":
        case "ConstEvaluatable":
          return true;
      }
      break;
    case "NormalizesTo":
    case "DynCompatible":
    case "Subtype":
    case "Coerce":
    case "ConstEquate":
    case "Ambiguous":
      return true;
  }
  return true;
}
