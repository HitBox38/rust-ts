// Port of compiler/rustc_mir_transform/src/match_branches.rs (lane mt-opt2-c). In progress: the policy is ported, the pass
// body stops as UNPORTED.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/match_branches.rs:15 MatchBranchSimplification
export class MatchBranchSimplification extends MirPass {
  readonly type_name = "rustc_mir_transform::match_branches::MatchBranchSimplification";

  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:18 policy
  policy(ctx: PassCtx): PassPolicy {
    // Enable only under -Zmir-opt-level=2 as this can make programs less debuggable.
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::match_branches::MatchBranchSimplification::run_pass");
  }
}
