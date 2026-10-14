//! Constraint solving
//!
//! The final phase iterates over the constraints, refining the variance
//! for each inferred until a fixed point is reached. This will be the
//! optimal solution to the constraints. The final variance for each
//! inferred is then written into the `variance_map` in the tcx.
//
// Port of compiler/rustc_hir_analysis/src/variance/solve.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `FxHashSet<usize>` is a `Set<number>`; it is only probed, never iterated.
// - `self.terms_cx.inferred_starts.items()` (`UnordItems`) iterates the `Map` in insertion order. The order is not
//   observable: the result is a `DefIdMap` (hash map), and the queries the closure calls (`generics_of`, `type_of`) were
//   all computed while building the constraints.
// - `map[&key]` (`Index`) is `unwrap(map.get(key), "key not found")`, the message of std's `HashMap` `Index` panic.
// - `tcx.arena.alloc_slice(&solutions[..])` is a copy of the slice (`Array.prototype.slice`).
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only other crates.
import type { CrateVariancesMap, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { DefIdMap, LocalDefId } from "../../rustc_span/def_id.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../../std/panic.ts";
import type { Constraint, ConstraintContext } from "./constraints.ts";
import type { TermsContext, VarianceTermPtr } from "./terms.ts";

// rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:17 glb
function glb(v1: Variance, v2: Variance): Variance {
  // Greatest lower bound of the variance lattice as defined in The Paper:
  //
  //       *
  //    -     +
  //       o
  if (v1 === "Invariant" || v2 === "Invariant") return Variance.Invariant;

  if (v1 === "Covariant" && v2 === "Contravariant") return Variance.Invariant;
  if (v1 === "Contravariant" && v2 === "Covariant") return Variance.Invariant;

  if (v1 === "Covariant" && v2 === "Covariant") return Variance.Covariant;

  if (v1 === "Contravariant" && v2 === "Contravariant") return Variance.Contravariant;

  // (x, ty::Bivariant) | (ty::Bivariant, x) => x,
  if (v2 === "Bivariant") return v1;
  return v2;
}

// rustc-type: compiler/rustc_hir_analysis/src/variance/solve.rs:36 SolveContext
class SolveContext {
  constructor(
    public terms_cx: TermsContext,
    public constraints: Constraint[],

    // Maps from an InferredIndex to the inferred value for that variable.
    public solutions: Variance[],
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:75 solve
  solve(): void {
    // Propagate constraints until a fixed point is reached. Note
    // that the maximum number of iterations is 2C where C is the
    // number of constraints (each variable can change values at most
    // twice). Since number of constraints is linear in size of the
    // input, so is the inference process.
    let changed = true;
    while (changed) {
      changed = false;

      for (const constraint of this.constraints) {
        const { inferred, variance: term } = constraint;
        const variance = this.evaluate(term);
        const old_value = this.solutions[inferred]!;
        const new_value = glb(variance, old_value);
        if (old_value !== new_value) {
          // debug!(
          //     "updating inferred {} \
          //         from {:?} to {:?} due to {:?}",
          //     inferred, old_value, new_value, term
          // );

          this.solutions[inferred] = new_value;
          changed = true;
        }
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:105 enforce_const_invariance
  enforce_const_invariance(generics: Generics, variances: Variance[]): void {
    const tcx = this.terms_cx.tcx;

    // Make all const parameters invariant.
    for (const param of generics.own_params) {
      if (param.kind.$ === "Const") {
        variances[param.index] = Variance.Invariant;
      }
    }

    // Make all the const parameters in the parent invariant (recursively).
    const def_id = generics.parent;
    if (def_id !== undefined) {
      this.enforce_const_invariance(tcx.generics_of(def_id) as Generics, variances);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:121 create_map
  create_map(): DefIdMap<readonly Variance[]> {
    const tcx = this.terms_cx.tcx;

    const solutions = this.solutions;
    const out = new DefIdMap<readonly Variance[]>();
    for (const [def_id, start] of this.terms_cx.inferred_starts) {
      const generics = tcx.generics_of(def_id) as Generics;
      const count = generics.count();

      const variances = solutions.slice(start, start + count);

      // Const parameters are always invariant.
      this.enforce_const_invariance(generics, variances);

      // Functions are permitted to have unused generic parameters: make those invariant.
      if (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)).kind().$ === "FnDef") {
        for (let i = 0; i < variances.length; i++) {
          if (variances[i] === "Bivariant") {
            variances[i] = Variance.Invariant;
          }
        }
      }

      out.set(LocalDefId.to_def_id(def_id), variances);
    }
    return out;
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:151 evaluate
  evaluate(term: VarianceTermPtr): Variance {
    switch (term.$) {
      case "ConstantTerm":
        return term._0;

      case "TransformTerm": {
        const [t1, t2] = [term._0, term._1];
        const v1 = this.evaluate(t1);
        const v2 = this.evaluate(t2);
        return Variance.xform(v1, v2);
      }

      case "InferredTerm": {
        const index = term._0;
        return this.solutions[index]!;
      }
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/variance/solve.rs:44 solve_constraints
export function solve_constraints(constraints_cx: ConstraintContext): CrateVariancesMap {
  const { terms_cx } = constraints_cx;
  let { constraints } = constraints_cx;

  const overridden_inferreds = new Set<number>();
  const solutions: Variance[] = new Array<Variance>(terms_cx.inferred_terms.length).fill(Variance.Bivariant);
  // prime the solutions for certain lang items which have hard-coded variance
  for (const [id, variances] of terms_cx.lang_items) {
    const start = unwrap(terms_cx.inferred_starts.get(id), "key not found");
    for (let i = 0; i < variances.length; i++) {
      const variance = variances[i]!;
      solutions[start + i] = variance;
      overridden_inferreds.add(start + i);
    }
  }

  // ensure the solutions for overridden inferreds are never constrained by anything else
  if (overridden_inferreds.size !== 0) {
    constraints = constraints.filter(({ inferred }) => !overridden_inferreds.has(inferred));
  }

  const solutions_cx = new SolveContext(terms_cx, constraints, solutions);
  solutions_cx.solve();
  const variances = solutions_cx.create_map();

  return { variances };
}
