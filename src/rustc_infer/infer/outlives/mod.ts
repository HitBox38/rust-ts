// Port of compiler/rustc_infer/src/infer/outlives/mod.rs (lane infer-canonical-outlives).
//
//! Various code related to computing outlives relations.
//
// PORT: `pub mod env; pub mod obligations; pub mod test_type_match; pub(crate) mod verify;` are re-exported as
// namespaces (the crate root lib.ts loads them). Other rustc_infer modules are read inside function bodies only
// (infcx-contract "How to fill a stub" 6).
import type { OutlivesBound } from "../../../rustc_middle/traits/query.gen.ts";
import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { RegionOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import { debug_OutlivesClause, visit_with_OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import { debug_GenericArg } from "../../../rustc_middle/ty/structural_impls.ts";
import { visit_with_Region } from "../../../rustc_type_ir/sty/mod.ts";
import type { TypeVisitable, TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { debug_vec, PRETTY } from "../../../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../../../std/panic.ts";
import { InferCtxt } from "../../decls.ts";
import type { RegionResolutionError } from "../lexical_region_resolve/mod.ts";
import * as free_regions from "../free_regions.ts";
import * as lexical_region_resolve from "../lexical_region_resolve/mod.ts";
import * as infer_mod from "../mod.ts";
import type { Constraint, RegionConstraintData } from "../region_constraints/mod.gen.ts";
import type { SubregionOrigin } from "../mod.gen.ts";
import type { OutlivesEnvironment } from "./env.ts";

export * as env from "./env.ts";
export * as obligations from "./obligations.ts";
export * as test_type_match from "./test_type_match.ts";
export * as verify from "./verify.ts";

// #[instrument(level = "debug", skip(param_env))]
// rustc: compiler/rustc_infer/src/infer/outlives/mod.rs:23 explicit_outlives_bounds
export function* explicit_outlives_bounds(param_env: ParamEnv): Iterable<OutlivesBound> {
  for (const clause of param_env.caller_bounds()) {
    const b = clause.as_region_outlives_clause();
    if (b === undefined) continue;
    const oc = Binder.no_bound_vars(b, visit_RegionOutlivesClause);
    if (oc === undefined) continue;
    const { _0: r_a, _1: r_b } = oc;
    yield { $: "RegionSubRegion", _0: r_b, _1: r_a };
  }
}

/// Process the region constraints and return any errors that
/// result. After this, no more unification operations should be
/// done -- or the compiler will panic -- but it is legal to use
/// `deeply_resolve_ignoring_regions` as well as `fully_resolve`.
///
/// Don't call this directly unless you know what you're doing.
/// You probably want to use `resolve_regions` instead.
// #[must_use]
// rustc: compiler/rustc_infer/src/infer/outlives/mod.rs:43 resolve_regions_with_outlives_env
InferCtxt.prototype.resolve_regions_with_outlives_env = function (this: InferCtxt, outlives_env: OutlivesEnvironment): RegionResolutionError[] {
  this.process_registered_region_obligations(outlives_env);

  const storage = (() => {
    const inner = this.inner;
    if (!(this.tainted_by_errors() !== undefined || inner.region_obligations_.length === 0)) {
      panic(`region_obligations not empty: ${debug_vec(inner.region_obligations_, PRETTY, infer_mod.debug_TypeOutlivesConstraint)}`);
    }
    assert(!inner.undo_log.in_snapshot(), "assertion failed: !UndoLogs::<UndoLog<'_>>::in_snapshot(&inner.undo_log)");
    // `inner.region_constraint_storage.take().expect("regions already resolved")`
    const storage = unwrap(inner.region_constraint_storage, "regions already resolved");
    inner.region_constraint_storage = undefined;
    return storage;
  })();

  const flattened: [Constraint, SubregionOrigin][] = [];
  for (const [constraint, origin] of storage.data.constraints) {
    for (const c of constraint.iter_outlives()) {
      flattened.push([c, infer_mod.clone_SubregionOrigin(origin)]);
    }
  }
  storage.data.constraints = flattened;

  // Filter out any region-region outlives assumptions that are implied by
  // coroutine well-formedness.
  if (this.tcx.sess.opts.unstable_opts.higher_ranked_assumptions) {
    storage.data.constraints = storage.data.constraints.filter(([c, _]) => {
      switch (c.kind) {
        case "RegSubReg":
          return !outlives_env.higher_ranked_assumptions().has({ _0: c.sup, _1: c.sub });

        case "VarSubVar":
        case "RegSubVar":
        case "VarSubReg":
          return true;

        case "VarEqVar":
        case "VarEqReg":
        case "RegEqReg":
          return unreachable();
      }
    });
  }

  const region_rels = free_regions.RegionRelations.new(this.tcx, outlives_env.free_region_map());

  const [lexical_region_resolutions, errors] = lexical_region_resolve.resolve(region_rels, storage.var_infos, storage.data);

  const old_value = this.lexical_region_resolutions;
  this.lexical_region_resolutions = lexical_region_resolutions;
  assert(old_value === undefined, "assertion failed: old_value.is_none()");

  return errors;
};

/// Obtains (and clears) the current set of region
/// constraints. The inference context is still usable: further
/// unifications will simply add new constraints.
///
/// This method is not meant to be used with normal lexical region
/// resolution. Rather, it is used in the NLL mode as a kind of
/// interim hack: basically we run normal type-check and generate
/// region constraints as normal, but then we take them and
/// translate them into the form that the NLL solver
/// understands. See the NLL module for mode details.
// rustc: compiler/rustc_infer/src/infer/outlives/mod.rs:109 take_and_reset_region_constraints
InferCtxt.prototype.take_and_reset_region_constraints = function (this: InferCtxt): RegionConstraintData {
  if (!(this.inner.region_obligations_.length === 0)) {
    panic(`region_obligations not empty: ${debug_vec(this.inner.region_obligations_, PRETTY, infer_mod.debug_TypeOutlivesConstraint)}`);
  }
  if (!(this.inner.region_assumptions_.length === 0)) {
    panic(`region_assumptions not empty: ${debug_vec(this.inner.region_assumptions_, PRETTY, (x, f) => debug_OutlivesClause(x, f, debug_GenericArg))}`);
  }

  return this.inner.unwrap_region_constraints().take_and_reset_data();
};

/// Gives temporary access to the region constraint data.
// rustc: compiler/rustc_infer/src/infer/outlives/mod.rs:125 with_region_constraints
InferCtxt.prototype.with_region_constraints = function <R>(this: InferCtxt, op: (_1: RegionConstraintData) => R): R {
  const inner = this.inner;
  return op(inner.unwrap_region_constraints().data());
};

/** PORT: `TypeVisitable` of `ty::RegionOutlivesClause` (`OutlivesClause<Region>`, generated impl). */
const visit_RegionOutlivesClause: TypeVisitable<RegionOutlivesClause> = {
  visit_with: <R>(s: RegionOutlivesClause, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, visit_with_Region),
};
