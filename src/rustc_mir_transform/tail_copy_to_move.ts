// Port of compiler/rustc_mir_transform/src/tail_copy_to_move.rs (lane mt-opt2-c). In progress: the policy is ported, the pass
// body stops as UNPORTED.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:48 TailCopyToMove
export class TailCopyToMove extends MirPass {
  readonly type_name = "rustc_mir_transform::tail_copy_to_move::TailCopyToMove";

  // rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:51 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2 && ctx.deref().opts.unstable_opts.mir_move_elimination);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::tail_copy_to_move::TailCopyToMove::run_pass");
  }
}
