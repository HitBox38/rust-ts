// Port of compiler/rustc_mir_transform/src/multiple_return_terminators.rs (lane mt-opt1).
//! This pass removes jumps to basic blocks containing only a return, and replaces them with a
//! return instead.
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { type BasicBlock, type Body, TerminatorKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { remove_dead_blocks } from "./simplify.ts";

// rustc-type: compiler/rustc_mir_transform/src/multiple_return_terminators.rs:10 MultipleReturnTerminators
export class MultipleReturnTerminators extends MirPass {
  readonly type_name = "rustc_mir_transform::multiple_return_terminators::MultipleReturnTerminators";

  // rustc: compiler/rustc_mir_transform/src/multiple_return_terminators.rs:13 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 4);
  }

  // rustc: compiler/rustc_mir_transform/src/multiple_return_terminators.rs:17 run_pass
  run_pass(_: TyCtxt, body: Body): void {
    // find basic blocks with no statement and a return terminator
    const bbs_simple_returns = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
    const bbs = body.basic_blocks_mut();
    for (let idx = 0 as BasicBlock; idx < bbs.length; idx = (idx + 1) as BasicBlock) {
      const bb = bbs[idx]!;
      if (bb.statements.length === 0 && bb.terminator_().kind.$ === "Return") {
        bbs_simple_returns.insert(idx);
      }
    }

    for (const bb of bbs) {
      const kind = bb.terminator_().kind;
      if (kind.$ === "Goto" && bbs_simple_returns.contains(kind.target)) {
        bb.terminator_mut().kind = TerminatorKind.Return;
      }
    }

    remove_dead_blocks(body);
  }
}
