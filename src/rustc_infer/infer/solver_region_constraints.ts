// Port of compiler/rustc_infer/src/infer/solver_region_constraints.rs (lane infcx-contract: ported in full). Codegen
// skips both types (`RegionConstraint<TyCtxt<'tcx>, Span>`: the type map cannot drop the interner argument).
import type { Span } from "../../rustc_span/lib.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_RegionConstraint, fold_with_RegionConstraint, RegionConstraint, try_fold_with_RegionConstraint, visit_with_RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { fold_with_trivial, type FallibleTypeFolder, try_fold_with_trivial, type TypeFolder, type TypeVisitor, visit_with_trivial } from "../../rustc_type_ir/fold.ts";
import type { Result } from "../../std/result.ts";
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

// PORT: `SolverRegionConstraint<'tcx>` is a type alias; its derived `Debug` / `TypeFoldable` / `TypeVisitable` are
// `RegionConstraint`'s at `S = Span` (a trivially traversed type). Named here for the codegen type map (merge-w17).
export const debug_SolverRegionConstraint: Debug<SolverRegionConstraint> = (v, f) => debug_RegionConstraint(v, f, debug_Span);
export function visit_with_SolverRegionConstraint<R>(self: SolverRegionConstraint, visitor: TypeVisitor<R>): R {
  return visit_with_RegionConstraint<Span, R>(self, visitor, visit_with_trivial);
}
export function try_fold_with_SolverRegionConstraint<E>(self: SolverRegionConstraint, folder: FallibleTypeFolder<E>): Result<SolverRegionConstraint, E> {
  return try_fold_with_RegionConstraint<Span, E>(self, folder, try_fold_with_trivial);
}
export function fold_with_SolverRegionConstraint(self: SolverRegionConstraint, folder: TypeFolder): SolverRegionConstraint {
  return fold_with_RegionConstraint<Span>(self, folder, fold_with_trivial);
}
