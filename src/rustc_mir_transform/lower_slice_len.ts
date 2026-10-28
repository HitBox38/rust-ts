// Port of compiler/rustc_mir_transform/src/lower_slice_len.rs (lane mt-opt1).
//
// PORT: copies of the `Copy` MIR objects (`*destination`, `terminator.source_info`) are `clone_*` (PORTING §8).
//! This pass lowers calls to core::slice::len to just PtrMetadata op.
//! It should run before inlining!
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import {
  type BasicBlockData,
  type Body,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  Operand,
  type Rvalue,
  Statement,
  type StatementKind,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/lower_slice_len.rs:10 LowerSliceLenCalls
export class LowerSliceLenCalls extends MirPass {
  readonly type_name = "rustc_mir_transform::lower_slice_len::LowerSliceLenCalls";

  // rustc: compiler/rustc_mir_transform/src/lower_slice_len.rs:13 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/lower_slice_len.rs:17 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const language_items = tcx.lang_items();
    const slice_len_fn_item_def_id = language_items.slice_len_fn();
    if (slice_len_fn_item_def_id === undefined) {
      // there is no lang item to compare to :)
      return;
    }

    // The one successor remains unchanged, so no need to invalidate
    const basic_blocks = body.basic_blocks.as_mut_preserves_cfg();
    for (const block of basic_blocks) {
      // lower `<[_]>::len` calls
      lower_slice_len_call(block, slice_len_fn_item_def_id);
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/lower_slice_len.rs:33 lower_slice_len_call
function lower_slice_len_call(block: BasicBlockData, slice_len_fn_item_def_id: DefId): void {
  const terminator = block.terminator_();
  const kind = terminator.kind;
  if (kind.$ !== "Call" || kind.target === undefined || kind.call_source !== "Normal") return;
  // some heuristics for fast rejection
  if (kind.args.length !== 1) return;
  const arg = kind.args[0]!;
  const fd = Operand.const_fn_def(kind.func);
  if (fd === undefined) return;
  const fn_def_id = fd[0];
  if (DefId_eq(fn_def_id, slice_len_fn_item_def_id)) {
    const destination = kind.destination;
    const bb = kind.target;
    // perform modifications from something like:
    //     _5 = core::slice::<impl [u8]>::len(move _6) -> bb1
    // into:
    //     _5 = PtrMetadata(move _6)
    //     goto bb1

    // make new RValue for Len
    const r_value: Rvalue = { $: "UnaryOp", _0: "PtrMetadata", _1: clone_Operand(arg.node) };
    const len_statement_kind: StatementKind = { $: "Assign", _0: [clone_Place(destination), r_value] };
    const add_statement = Statement.new(clone_SourceInfo(terminator.source_info), len_statement_kind);

    // modify terminator into simple Goto
    const new_terminator_kind = TerminatorKind.goto(bb);

    block.statements.push(add_statement);
    block.terminator_mut().kind = new_terminator_kind;
  }
}
