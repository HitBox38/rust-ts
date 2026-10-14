// Port of compiler/rustc_infer/src/infer/solver_region_constraints.rs (lane infcx-contract: ported in full). Codegen
// skips both types (`RegionConstraint<TyCtxt<'tcx>, Span>`: the type map cannot drop the interner argument).
import type { Span } from "../../rustc_span/lib.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_RegionConstraint, RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { type Debug, debug_option, debug_tuple } from "../../std/fmt.ts";

// rustc-type: compiler/rustc_infer/src/infer/solver_region_constraints.rs:5 SolverRegionConstraint
export type SolverRegionConstraint = RegionConstraint<Span>;

// rustc-type: compiler/rustc_infer/src/infer/solver_region_constraints.rs:9 SolverRegionConstraintStorage
export class SolverRegionConstraintStorage {
  constructor(public _0: SolverRegionConstraint | undefined) {}

  // rustc: compiler/rustc_infer/src/infer/solver_region_constraints.rs:12 new
  static new(): SolverRegionConstraintStorage {
    return new SolverRegionConstraintStorage(undefined);
  }

  // rustc: compiler/rustc_infer/src/infer/solver_region_constraints.rs:16 get_constraint
  get_constraint(): SolverRegionConstraint {
    const v = this._0;
    if (v !== undefined) {
      // PORT: `v.clone()`: region constraints are immutable values.
      return v;
    } else {
      return RegionConstraint.new_true<Span>();
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_infer/src/infer/solver_region_constraints.rs:24 overwrite
  overwrite(constraint: SolverRegionConstraint): void {
    this._0 = constraint;
  }
}

/** `#[derive(Debug)]` */
export const debug_SolverRegionConstraintStorage: Debug<SolverRegionConstraintStorage> = (v, f) =>
  debug_tuple(f, "SolverRegionConstraintStorage", [debug_option(v._0, f, (x, f) => debug_RegionConstraint(x, f, debug_Span))]);

/** `#[derive(Clone)]` (region constraints are immutable values). */
export function clone_SolverRegionConstraintStorage(v: SolverRegionConstraintStorage): SolverRegionConstraintStorage {
  return new SolverRegionConstraintStorage(v._0);
}
