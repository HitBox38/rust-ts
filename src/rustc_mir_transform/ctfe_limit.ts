// Port of compiler/rustc_mir_transform/src/ctfe_limit.rs (lane mt-cleanup).
//! A pass that inserts the `ConstEvalCounter` instruction into any blocks that have a back edge
//! (thus indicating there is a loop in the CFG), or whose terminator is a function call.
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import { BasicBlock, type BasicBlockData, type Body, clone_SourceInfo, Statement, StatementKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/ctfe_limit.rs:13 CtfeLimit
export class CtfeLimit extends MirPass {
  readonly type_name = "rustc_mir_transform::ctfe_limit::CtfeLimit";

  // #[instrument(skip(self, _tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/ctfe_limit.rs:17 run_pass
  run_pass(_tcx: TyCtxt, body: Body): void {
    const doms = body.basic_blocks.dominators();
    const indices: BasicBlock[] = [];
    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const node = BasicBlock.new(i);
      const node_data = blocks[i]!;
      const k = node_data.terminator_().kind.$;
      if (
        k === "Call" ||
        k === "TailCall" ||
        // Back edges in a CFG indicate loops
        has_back_edge(doms, node, node_data)
      ) {
        indices.push(node);
      }
    }

    const basic_blocks = body.basic_blocks.as_mut_preserves_cfg();
    for (const index of indices) {
      const bbdata = basic_blocks[index]!;
      const source_info = clone_SourceInfo(bbdata.terminator_().source_info);
      bbdata.statements.push(Statement.new(source_info, StatementKind.ConstEvalCounter));
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ctfe_limit.rs:42 policy
  policy(_ctx: PassCtx): PassPolicy {
    // This is part of CTFE diagnostics rather than an optimization.
    return PassPolicy.optional(true);
  }
}

// rustc: compiler/rustc_mir_transform/src/ctfe_limit.rs:48 has_back_edge
function has_back_edge(doms: Dominators<BasicBlock>, node: BasicBlock, node_data: BasicBlockData): boolean {
  if (!doms.is_reachable(node)) {
    return false;
  }
  // Check if any of the dominators of the node are also the node's successor.
  for (const succ of node_data.terminator_().successors()) {
    if (doms.dominates(succ, node)) return true;
  }
  return false;
}
