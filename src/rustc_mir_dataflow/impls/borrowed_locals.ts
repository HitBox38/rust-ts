// Port of compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls). `MaybeBorrowedLocals` (a unit struct) is a class extending `AnalysisBase<DenseBitSet<Local>>`
// (framework/mod.ts); `state.kill(local)` is `GenKill_DenseBitSet<Local>().kill(state, local)`.
// PORT: `body.local_decls().len()` (`HasLocalDecls`) is `body.local_decls.length` (the field; the method shares its name).

import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet, GenKill_DenseBitSet } from "../framework/mod.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import type { Body, Local, Location, Statement, Terminator } from "../../rustc_middle/mir/mod.ts";

/// A dataflow analysis that tracks whether a pointer or reference could possibly exist that points
/// to a given local. This analysis ignores fake borrows, so it should not be used by
/// borrowck.
///
/// At present, this is used as a very limited form of alias analysis. For example,
/// `MaybeBorrowedLocals` is used to compute which locals are live during a yield expression for
/// immovable coroutines.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:13 MaybeBorrowedLocals
export class MaybeBorrowedLocals extends AnalysisBase<DenseBitSet<Local>> {
  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:16 gen_statement
  static gen_statement(state: DenseBitSet<Local>, stmt: Statement): void {
    if (stmt.kind.$ === "Assign") {
      const rvalue = stmt.kind._0[1];
      switch (rvalue.$) {
        // We ignore fake borrows as these get removed after analysis and shouldn't effect
        // the layout of generators.
        case "RawPtr":
        case "Ref":
        case "Reborrow": {
          if (rvalue.$ === "Ref" && rvalue._1.$ === "Fake") break;
          const borrowed_place = rvalue.$ === "RawPtr" ? rvalue._1 : rvalue._2;
          if (!borrowed_place.is_indirect()) {
            state.insert(borrowed_place.local);
          }
          break;
        }

        case "Cast":
        case "Use":
        case "ThreadLocalRef":
        case "Repeat":
        case "BinaryOp":
        case "UnaryOp":
        case "Discriminant":
        case "Aggregate":
        case "CopyForDeref":
        case "WrapUnsafeBinder":
          break;
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:44 gen_terminator
  static gen_terminator(state: DenseBitSet<Local>, terminator: Terminator): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "Drop": {
        const dropped_place = kind.place;
        // Drop terminators may call custom drop glue (`Drop::drop`), which takes `&mut
        // self` as a parameter. In the general case, a drop impl could launder that
        // reference into the surrounding environment through a raw pointer, thus creating
        // a valid `*mut` pointing to the dropped local. We are not yet willing to declare
        // this particular case UB, so we must treat all dropped locals as mutably borrowed
        // for now. See discussion on [#61069].
        //
        // [#61069]: https://github.com/rust-lang/rust/pull/61069
        if (!dropped_place.is_indirect()) {
          state.insert(dropped_place.local);
        }
        break;
      }

      case "UnwindTerminate":
      case "Assert":
      case "Call":
      case "FalseEdge":
      case "FalseUnwind":
      case "CoroutineDrop":
      case "Goto":
      case "InlineAsm":
      case "UnwindResume":
      case "Return":
      case "TailCall":
      case "SwitchInt":
      case "Unreachable":
      case "Yield":
        break;
    }
  }

  // ---- impl Analysis for MaybeBorrowedLocals ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);
  readonly NAME = "maybe_borrowed_locals";

  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:82 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = unborrowed
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:87 initialize_start_block
  initialize_start_block(_1: Body, _2: DenseBitSet<Local>): void {
    // No locals are aliased on function entry
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:91 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, statement: Statement, _location: Location): void {
    MaybeBorrowedLocals.gen_statement(state, statement);

    // When we reach a `StorageDead` statement, we can assume that any pointers to this memory
    // are now invalid.
    if (statement.kind.$ === "StorageDead") {
      const local = statement.kind._0;
      GenKill_DenseBitSet<Local>().kill(state, local);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:106 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, _location: Location): void {
    MaybeBorrowedLocals.gen_terminator(state, terminator);
  }
}

/// The set of locals that are borrowed at some point in the MIR body.
// rustc: compiler/rustc_mir_dataflow/src/impls/borrowed_locals.rs:117 borrowed_locals
export function borrowed_locals(body: Body): DenseBitSet<Local> {
  const borrowed = DenseBitSet.new_empty<Local>(body.local_decls.length);
  for (const bb_data of body.basic_blocks.deref()) {
    for (const stmt of bb_data.statements) {
      MaybeBorrowedLocals.gen_statement(borrowed, stmt);
    }
    MaybeBorrowedLocals.gen_terminator(borrowed, bb_data.terminator_());
  }
  return borrowed;
}
