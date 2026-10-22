// Port of compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs: DECLARED (lane dataflow-contract). Every fn is a
// stub for lane `dataflow-impls` (plan-m4 §5 wave 22).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. `MaybeBorrowedLocals` (a unit struct) is a class extending
// `AnalysisBase<DenseBitSet<Local>>` (framework/mod.ts); `state.kill(local)` is `GenKill_DenseBitSet<Local>().kill(state,
// local)`; `body.local_decls().len()` / `body.basic_blocks.iter()` come from mir-contract's `Body`.

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { unported } from "../../std/panic.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet } from "../framework/mod.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import type { Body, Local, Location, Statement, Terminator } from "../pending.ts";

/// A dataflow analysis that tracks whether a pointer or reference could possibly exist that points
/// to a given local. This analysis ignores fake borrows, so it should not be used by
/// borrowck.
///
/// At present, this is used as a very limited form of alias analysis. For example,
/// `MaybeBorrowedLocals` is used to compute which locals are live during a yield expression for
/// immovable coroutines.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:13 MaybeBorrowedLocals
export class MaybeBorrowedLocals extends AnalysisBase<DenseBitSet<Local>> {
  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:16 gen_statement (lane dataflow-impls)
  static gen_statement(_state: DenseBitSet<Local>, _stmt: Statement): void {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::gen_statement");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:44 gen_terminator (lane dataflow-impls)
  static gen_terminator(_state: DenseBitSet<Local>, _terminator: Terminator): void {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::gen_terminator");
  }

  // ---- impl Analysis for MaybeBorrowedLocals ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);
  readonly NAME = "maybe_borrowed_locals";

  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:82 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::bottom_value");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:87 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::initialize_start_block");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:91 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::apply_primary_statement_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:106 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::borrowed_locals::MaybeBorrowedLocals::apply_primary_terminator_effect");
  }
}

/// The set of locals that are borrowed at some point in the MIR body.
// stub: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:117 borrowed_locals (lane dataflow-impls)
export function borrowed_locals(_body: Body): DenseBitSet<Local> {
  return unported("rustc_mir_dataflow::impls::borrowed_locals::borrowed_locals");
}
