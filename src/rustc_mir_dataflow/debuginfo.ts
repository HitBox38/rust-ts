// Port of compiler/rustc_mir_dataflow/src/debuginfo.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
//
// Representation: `struct DebuginfoLocals(DenseBitSet<Local>)` is a class with field `_0`; `impl Visitor for
// DebuginfoLocals` makes it extend mir-contract's `Visitor` class (plan-m4 D4) overriding `visit_local`.
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Body, Local, Location } from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";

/// Return the set of locals that appear in debuginfo.
// rustc: compiler/rustc_mir_dataflow/src/debuginfo.rs:6 debuginfo_locals
export function debuginfo_locals(body: Body): DenseBitSet<Local> {
  const visitor = new DebuginfoLocals(DenseBitSet.new_empty<Local>(body.local_decls.length));
  for (const debuginfo of body.var_debug_info) {
    visitor.visit_var_debug_info(debuginfo);
  }
  return visitor._0;
}

// rustc-type: compiler/rustc_mir_dataflow/src/debuginfo.rs:14 DebuginfoLocals
class DebuginfoLocals extends Visitor {
  constructor(public _0: DenseBitSet<Local>) {
    super();
  }

  /** `impl Visitor<'_> for DebuginfoLocals`. */
  // rustc: compiler/rustc_mir_dataflow/src/debuginfo.rs:17 visit_local
  override visit_local(local: Local, _: PlaceContext, _location: Location): void {
    this._0.insert(local);
  }
}
