// Port of compiler/rustc_infer/src/infer/snapshot/mod.rs (lane infer-opaque-snapshot). `CombinedSnapshot` and
// `VariableLengths` are generated (mod.gen.ts); the `impl InferCtxt` methods are assigned onto `InferCtxt.prototype`
// (declared in ../../decls.ts). Init order: other rustc_infer modules are read inside function bodies only.
//
// PORT: `#[instrument]` / `debug!` (tracing) are left out (kept as comments). `#[must_use]` on `CombinedSnapshot` is
// dropped. `CombinedSnapshot` is an interface: the methods take it by value (it is never used after being consumed).

import { InferCtxt } from "../../decls.ts";
import type { CombinedSnapshot, VariableLengths } from "./mod.gen.ts";
import type { Result } from "../../../std/result.ts";

export * from "./mod.gen.ts";

// ---- impl InferCtxt --------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:29 variable_lengths
InferCtxt.prototype.variable_lengths = function (this: InferCtxt): VariableLengths {
  const inner = this.inner;
  return {
    region_constraints_len: inner.unwrap_region_constraints().num_region_vars(),
    type_var_len: inner.type_variables().num_vars(),
    int_var_len: inner.int_unification_table().len(),
    float_var_len: inner.float_unification_table().len(),
    const_var_len: inner.const_unification_table().len(),
  };
};

// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:40 in_snapshot
InferCtxt.prototype.in_snapshot = function (this: InferCtxt): boolean {
  return this.inner.undo_log.in_snapshot();
};

// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:44 num_open_snapshots
InferCtxt.prototype.num_open_snapshots = function (this: InferCtxt): number {
  return this.inner.undo_log.num_open_snapshots();
};

// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:48 start_snapshot
InferCtxt.prototype.start_snapshot = function (this: InferCtxt): CombinedSnapshot {
  // debug!("start_snapshot()");

  const inner = this.inner;

  return {
    undo_snapshot: inner.undo_log.start_snapshot(),
    region_constraints_snapshot: inner.unwrap_region_constraints().start_snapshot(),
    universe: this.universe(),
  };
};

// #[instrument(skip(self, snapshot), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:61 rollback_to
InferCtxt.prototype.rollback_to = function (this: InferCtxt, snapshot: CombinedSnapshot): void {
  const { undo_snapshot, region_constraints_snapshot, universe } = snapshot;

  this.universe_ = universe;

  const inner = this.inner;
  inner.rollback_to(undo_snapshot);
  inner.unwrap_region_constraints().rollback_to(region_constraints_snapshot);
};

// #[instrument(skip(self, snapshot), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:72 commit_from
InferCtxt.prototype.commit_from = function (this: InferCtxt, snapshot: CombinedSnapshot): void {
  const { undo_snapshot } = snapshot;

  this.inner.commit(undo_snapshot);
};

/// Execute `f` and commit the bindings if closure `f` returns `Ok(_)`.
// #[instrument(skip(self, f), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:81 commit_if_ok
InferCtxt.prototype.commit_if_ok = function <T, E>(this: InferCtxt, f: (snapshot: CombinedSnapshot) => Result<T, E>): Result<T, E> {
  const snapshot = this.start_snapshot();
  const r = f(snapshot);
  // debug!("commit_if_ok() -- r.is_ok() = {}", r.is_ok());
  switch (r.$) {
    case "Ok":
      this.commit_from(snapshot);
      break;
    case "Err":
      this.rollback_to(snapshot);
      break;
  }
  return r;
};

/// Execute `f` then unroll any bindings it creates.
// #[instrument(skip(self, f), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:101 probe
InferCtxt.prototype.probe = function <R>(this: InferCtxt, f: (snapshot: CombinedSnapshot) => R): R {
  const snapshot = this.start_snapshot();
  const r = f(snapshot);
  this.rollback_to(snapshot);
  return r;
};

/// Scan the constraints produced since `snapshot` and check whether
/// we added any region constraints.
// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:113 region_constraints_added_in_snapshot
InferCtxt.prototype.region_constraints_added_in_snapshot = function (this: InferCtxt, snapshot: CombinedSnapshot): boolean {
  return this.inner.unwrap_region_constraints().region_constraints_added_in_snapshot(snapshot.undo_snapshot);
};

// rustc: compiler/rustc_infer/src/infer/snapshot/mod.rs:120 opaque_types_added_in_snapshot
InferCtxt.prototype.opaque_types_added_in_snapshot = function (this: InferCtxt, snapshot: CombinedSnapshot): boolean {
  return this.inner.undo_log.opaque_types_in_snapshot(snapshot.undo_snapshot);
};
