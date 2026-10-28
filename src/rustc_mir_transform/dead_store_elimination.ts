// Port of compiler/rustc_mir_transform/src/dead_store_elimination.rs (lane mt-opt2-a).
//
// PORT: `*arg = Operand::Move(place)` stores a new operand object into the call's `Spanned<Operand>` (`.node`), keeping
// the same `Place` object (the copy operand it replaces is dropped).
//! This module implements a dead store elimination (DSE) routine.
//!
//! This transformation was written specifically for the needs of dest prop. Although it is
//! perfectly sound to use it in any context that might need it, its behavior should not be changed
//! without analyzing the interaction this will have with dest prop. Specifically, in addition to
//! the soundness of this pass in general, dest prop needs it to satisfy two additional conditions:
//!
//!  1. It's idempotent, meaning that running this pass a second time immediately after running it a
//!     first time will not cause any further changes.
//!  2. This idempotence persists across dest prop's main transform, in other words inserting any
//!     number of iterations of dest prop between the first and second application of this transform
//!     will still not cause any further changes.
//!
import { type BasicBlock, type Body, debug_StatementKind, Location, StatementKind, traversal } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debuginfo_locals } from "../rustc_mir_dataflow/debuginfo.ts";
import { GenKill_DenseBitSet } from "../rustc_mir_dataflow/framework/mod.ts";
import { borrowed_locals } from "../rustc_mir_dataflow/impls/borrowed_locals.ts";
import { LivenessTransferFunction, MaybeTransitiveLiveLocals } from "../rustc_mir_dataflow/impls/liveness.ts";
import type { Local } from "../rustc_middle/mir/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import { most_packed_projection } from "../rustc_const_eval/util/mod.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { UsedInStmtLocals } from "./simplify.ts";

/// Performs the optimization on the body
///
/// The `borrowed` set must be a `DenseBitSet` of all the locals that are ever borrowed in this
/// body. It can be generated via the [`borrowed_locals`] function.
/// Returns true if any instruction is eliminated.
// rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:34 eliminate
function eliminate(tcx: TyCtxt, body: Body): boolean {
  const borrowed_locals_ = borrowed_locals(body);

  // If the user requests complete debuginfo, mark the locals that appear in it as live, so
  // we don't remove assignments to them.
  const debuginfo_locals_ = debuginfo_locals(body);

  const live = MaybeTransitiveLiveLocals.new(borrowed_locals_, debuginfo_locals_)
    .iterate_to_fixpoint(tcx, body, undefined)
    .into_results_cursor(body);

  // For blocks with a call terminator, if an argument copy can be turned into a move,
  // record it as (block, argument index).
  const call_operands_to_move: [BasicBlock, number][] = [];
  const patch: [Location, boolean][] = [];

  for (const [bb, bb_data] of traversal.preorder(body)) {
    const tkind = bb_data.terminator_().kind;
    if (tkind.$ === "Call") {
      const { args, destination } = tkind;
      const loc = new Location(bb, bb_data.statements.length);

      // Position ourselves between the evaluation of `args` and the write to `destination`.
      live.seek_to_block_end(bb);
      const state = live.get().clone();

      // Don't turn into a move if the local is used as an index
      // projection for the destination place.
      new LivenessTransferFunction(state, GenKill_DenseBitSet<Local>()).visit_place(
        destination,
        { $: "MutatingUse", _0: "Call" },
        loc,
      );

      // The logic in LivenessTransferFunction isn't quite what we need; it ignores call
      // destinations that are just locals because they are killed by the call, which makes
      // it eligible to be moved-from in the argument list. That's backwards.
      if (!destination.is_indirect()) {
        state.insert(destination.local);
      }

      for (let index = args.length - 1; index >= 0; index--) {
        const arg = args[index]!.node;
        if (
          arg.$ === "Copy" &&
          !arg._0.is_indirect() &&
          // Do not skip the transformation if the local is in debuginfo, as we do
          // not really lose any information for this purpose.
          !borrowed_locals_.contains(arg._0.local) &&
          !state.contains(arg._0.local) &&
          // If `place` is a projection of a disaligned field in a packed ADT,
          // the move may be codegened as a pointer to that field.
          // Using that disaligned pointer may trigger UB in the callee,
          // so do nothing.
          most_packed_projection(tcx, body, arg._0) === undefined
        ) {
          call_operands_to_move.push([bb, index]);
        }

        // Account that `arg` is read from, so we don't promote another argument to a move.
        new LivenessTransferFunction(state, GenKill_DenseBitSet<Local>()).visit_operand(arg, loc);
      }
    }

    for (let statement_index = bb_data.statements.length - 1; statement_index >= 0; statement_index--) {
      const statement = bb_data.statements[statement_index]!;
      const destination = MaybeTransitiveLiveLocals.can_be_removed_if_dead(statement.kind, borrowed_locals_, debuginfo_locals_);
      if (destination !== undefined) {
        const loc = new Location(bb, statement_index);
        live.seek_before_primary_effect(loc);
        if (!live.get().contains(destination.local)) {
          const drop_debuginfo = !debuginfo_locals_.contains(destination.local);
          // When eliminating a dead statement, we need to address
          // the debug information for that statement.
          assert(
            drop_debuginfo || StatementKind.as_debuginfo(statement.kind) !== undefined,
            () => `don't know how to retain the debug information for ${debug_StatementKind(statement.kind, PLAIN)}`,
          );
          patch.push([loc, drop_debuginfo]);
        }
      }
    }
  }

  if (patch.length === 0 && call_operands_to_move.length === 0) {
    return false;
  }
  const eliminated = patch.length !== 0;

  const bbs = body.basic_blocks.as_mut_preserves_cfg();
  for (const [{ block, statement_index }, drop_debuginfo] of patch) {
    bbs[block]!.statements[statement_index]!.make_nop(drop_debuginfo);
  }
  for (const [block, argument_index] of call_operands_to_move) {
    const kind = bbs[block]!.terminator_mut().kind;
    if (kind.$ !== "Call") {
      return bug();
    }
    const args = kind.args;
    const arg = args[argument_index]!.node;
    if (arg.$ !== "Copy") {
      return bug();
    }
    const place = arg._0;
    args[argument_index]!.node = { $: "Move", _0: place };
  }

  return eliminated;
}

// rustc-type: compiler/rustc_mir_transform/src/dead_store_elimination.rs:138 DeadStoreElimination
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type DeadStoreElimination_variant = "Initial" | "Final";
export class DeadStoreElimination extends MirPass {
  readonly type_name = "rustc_mir_transform::dead_store_elimination::DeadStoreElimination";

  private constructor(readonly $: DeadStoreElimination_variant) {
    super();
    Object.freeze(this);
  }

  static readonly Initial = new DeadStoreElimination("Initial");
  static readonly Final = new DeadStoreElimination("Final");

  // rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:144 name
  override name(): string {
    switch (this.$) {
      case "Initial":
        return "DeadStoreElimination-initial";
      case "Final":
        return "DeadStoreElimination-final";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:151 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/dead_store_elimination.rs:155 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    if (eliminate(tcx, body)) {
      UsedInStmtLocals.new(body).remove_unused_storage_annotations(body);
      for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
        data.strip_nops();
      }
    }
  }
}
