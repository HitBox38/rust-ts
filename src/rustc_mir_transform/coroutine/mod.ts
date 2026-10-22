// Stub module (lane mt-coroutine-a): compiler/rustc_mir_transform/src/coroutine/mod.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../../std/panic.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "../pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/coroutine/mod.rs:84 StateTransform (lane mt-coroutine-a)
export class StateTransform extends MirPass {
  readonly type_name = "rustc_mir_transform::coroutine::StateTransform";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::coroutine::StateTransform (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::coroutine::StateTransform (pass not ported)");
  }
}

// mod by_move_body; mod drop; mod layout;
// pub(super) use by_move_body::coroutine_by_move_body_def_id;
export { coroutine_by_move_body_def_id } from "./by_move_body.ts";
// pub(super) use layout::mir_coroutine_witnesses;
export { mir_coroutine_witnesses } from "./layout.ts";
