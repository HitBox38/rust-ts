// Port of compiler/rustc_mir_transform/src/jump_threading.rs (lane mt-opt2-c). In progress: the policy is ported, the pass
// body stops as UNPORTED.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:73 JumpThreading
export class JumpThreading extends MirPass {
  readonly type_name = "rustc_mir_transform::jump_threading::JumpThreading";

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:78 policy
  policy(ctx: PassCtx): PassPolicy {
    // Jump threading can duplicate calls in control-flow.
    // This leads to incorrect code when done for so called "convergent" operations on GPU
    // targets, similar to how inline assembly cannot be duplicated on all targets.
    // Conservatively prevent this by disabling the pass.
    // See also issue #137086.
    return PassPolicy.optional(ctx.mir_opt_level() >= 2 && !ctx.deref().target.is_like_gpu);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::jump_threading::JumpThreading::run_pass");
  }
}
