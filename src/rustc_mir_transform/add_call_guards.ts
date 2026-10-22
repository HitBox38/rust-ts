// Port of compiler/rustc_mir_transform/src/add_call_guards.rs (lane mt-cleanup).
//
// PORT: the pass enum `AddCallGuards` is a class with one frozen instance per variant, tagged `$` (pass_manager.ts
// header); `self == &AllCallEdges` compares the tag. The fn-local `enum Action` is a local tagged union.
// `IndexVec::from_elem(0u8, ..)` is a `number[]`; `u8::saturating_add(1)` clamps at 255. `&mut` of the chosen target
// slot (`destination` / `targets[target_index]`) is a `MutRef<BasicBlock>`.
//! Breaks outgoing critical edges for call terminators in the MIR.
//!
//! Critical edges are edges that are neither the only edge leaving a
//! block, nor the only edge entering one.
//!
//! When you want something to happen "along" an edge, you can either
//! do at the end of the predecessor block, or at the start of the
//! successor block. Critical edges have to be broken in order to prevent
//! "edge actions" from affecting other edges. We need this for calls that are
//! codegened to LLVM invoke instructions, because invoke is a block terminator
//! in LLVM so we can't insert any code to handle the call's result into the
//! block that performs the call.
//!
//! This function will break those edges by inserting new blocks along them.
//!
//! NOTE: Simplify CFG will happily undo most of the work this pass does.
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  clone_SourceInfo,
  type SourceInfo,
  Terminator,
  TerminatorKind,
  type UnwindAction,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type MutRef, field_mut } from "../std/mut_ref.ts";
import { unreachable } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/add_call_guards.rs:26 AddCallGuards
// #[derive(PartialEq)]
export type AddCallGuards_variant = "AllCallEdges" | "CriticalCallEdges";
export class AddCallGuards extends MirPass {
  readonly type_name = "rustc_mir_transform::add_call_guards::AddCallGuards";

  private constructor(readonly $: AddCallGuards_variant) {
    super();
    Object.freeze(this);
  }

  static readonly AllCallEdges = new AddCallGuards("AllCallEdges");
  static readonly CriticalCallEdges = new AddCallGuards("CriticalCallEdges");

  // rustc: compiler/rustc_mir_transform/src/add_call_guards.rs:33 run_pass
  run_pass(_tcx: TyCtxt, body: Body): void {
    const pred_count: number[] = new Array<number>(body.basic_blocks.deref().length).fill(0);
    for (const data of body.basic_blocks.deref()) {
      for (const succ of data.terminator_().successors()) {
        pred_count[succ] = Math.min(pred_count[succ]! + 1, 255);
      }
    }

    type Action = { $: "Call" } | { $: "Asm"; target_index: number };

    const work: [BasicBlock, Action][] = [];
    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const block = blocks[i]!;
      const term = block.terminator_();
      const kind = term.kind;
      if (
        kind.$ === "Call" &&
        kind.target !== undefined &&
        pred_count[kind.target]! > 1 &&
        (generates_invoke(kind.unwind) || this.$ === "AllCallEdges")
      ) {
        // It's a critical edge, break it
        work.push([bb, { $: "Call" }]);
      } else if (kind.$ === "InlineAsm" && kind.asm_macro === "Asm" && this.$ === "CriticalCallEdges") {
        const targets = kind.targets;
        const operands = kind.operands;
        const unwind = kind.unwind;
        const has_outputs = operands.some((op) => op.$ === "InOut" || op.$ === "Out");
        const has_labels = operands.some((op) => op.$ === "Label");
        if (has_outputs && (has_labels || generates_invoke(unwind))) {
          for (let target_index = 0; target_index < targets.length; target_index++) {
            const target = targets[target_index]!;
            if (pred_count[target]! > 1) {
              work.push([bb, { $: "Asm", target_index }]);
            }
          }
        }
      } else {
      }
    }

    if (work.length === 0) {
      return;
    }

    // We need a place to store the new blocks generated
    const new_blocks: BasicBlockData[] = [];

    const cur_len = body.basic_blocks.deref().length;
    const new_block = (source_info: SourceInfo, is_cleanup: boolean, target: BasicBlock): BasicBlock => {
      const block = BasicBlockData.new(new Terminator(source_info, TerminatorKind.goto(target)), is_cleanup);
      const idx = cur_len + new_blocks.length;
      new_blocks.push(block);
      return BasicBlock.new(idx);
    };

    const basic_blocks = body.basic_blocks.as_mut();
    for (const [source, action] of work) {
      const block = basic_blocks[source]!;
      const is_cleanup = block.is_cleanup;
      const term = block.terminator_mut();
      const source_info = clone_SourceInfo(term.source_info);
      let destination: MutRef<BasicBlock>;
      switch (action.$) {
        case "Call": {
          const k = term.kind;
          if (!(k.$ === "Call" && k.target !== undefined)) {
            return unreachable();
          }
          destination = field_mut(k, "target") as MutRef<BasicBlock>;
          break;
        }
        case "Asm": {
          const target_index = action.target_index;
          const k = term.kind;
          if (k.$ !== "InlineAsm") {
            return unreachable();
          }
          destination = field_mut(k.targets, target_index);
          break;
        }
      }
      destination.value = new_block(source_info, is_cleanup, destination.value);
    }

    // debug!("Broke {} N edges", new_blocks.len());
    basic_blocks.push(...new_blocks);
  }

  // rustc: compiler/rustc_mir_transform/src/add_call_guards.rs:127 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Breaks critical edges so codegen can place edge-specific actions without affecting
    // other control-flow edges.
    return PassPolicy.Required;
  }
}
// pub(super) use self::AddCallGuards::*;
export const AllCallEdges = AddCallGuards.AllCallEdges;
export const CriticalCallEdges = AddCallGuards.CriticalCallEdges;

/// Returns true if this unwind action is code generated as an invoke as opposed to a call.
// rustc: compiler/rustc_mir_transform/src/add_call_guards.rs:135 generates_invoke
function generates_invoke(unwind: UnwindAction): boolean {
  switch (unwind.$) {
    case "Continue":
    case "Unreachable":
      return false;
    case "Cleanup":
    case "Terminate":
      return true;
  }
}
