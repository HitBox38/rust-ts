// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/jump_threading.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/jump_threading.rs:73 JumpThreading (lane mt-opt2)
export class JumpThreading extends MirPass {
  readonly type_name = "rustc_mir_transform::jump_threading::JumpThreading";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::jump_threading::JumpThreading (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::jump_threading::JumpThreading (pass not ported)");
  }
}
