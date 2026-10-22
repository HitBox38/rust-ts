// Port of compiler/rustc_mir_dataflow/src/debuginfo.rs: DECLARED (lane dataflow-contract). Every fn is a stub for
// lane `dataflow-move-paths` (plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it): `struct DebuginfoLocals(DenseBitSet<Local>)` is a class with field `_0`;
// `impl Visitor for DebuginfoLocals` makes it extend mir-contract's `Visitor` class (plan-m4 D4) overriding
// `visit_local` (`PlaceContext` is mir-contract's; pending here). `body.local_decls` / `body.var_debug_info` are
// mir-contract's `Body` fields.
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { unported } from "../std/panic.ts";
import type { Body, Local, Location } from "./pending.ts";

// PORT(contract): pending mir-contract
type PlaceContext = { readonly __pending_mir: "PlaceContext" };

/// Return the set of locals that appear in debuginfo.
// stub: compiler/rustc_mir_dataflow/src/debuginfo.rs:6 debuginfo_locals (lane dataflow-move-paths)
export function debuginfo_locals(_body: Body): DenseBitSet<Local> {
  return unported("rustc_mir_dataflow::debuginfo::debuginfo_locals");
}

// rustc-type: compiler/rustc_mir_dataflow/src/debuginfo.rs:14 DebuginfoLocals
class DebuginfoLocals {
  constructor(public _0: DenseBitSet<Local>) {}

  /** `impl Visitor<'_> for DebuginfoLocals`. */
  // stub: compiler/rustc_mir_dataflow/src/debuginfo.rs:17 visit_local (lane dataflow-move-paths)
  visit_local(_local: Local, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::debuginfo::DebuginfoLocals::visit_local");
  }
}

/** Keeps the module-private visitor referenced for the fill lane. */
export const _debuginfo_decls = { DebuginfoLocals };
