// Stub module (lane mt-cleanup): compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";
import type { BasicBlock, Body } from "../rustc_middle/mir/mod.ts";

// stub: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:12 RemoveNoopLandingPads (lane mt-cleanup)
export class RemoveNoopLandingPads extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_noop_landing_pads::RemoveNoopLandingPads";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::remove_noop_landing_pads::RemoveNoopLandingPads (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::remove_noop_landing_pads::RemoveNoopLandingPads (pass not ported)");
  }
}

// stub: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:157 find_noop_landing_pads_for_instance (lane mt-cleanup)
export function find_noop_landing_pads_for_instance(_tcx: TyCtxt, _body: Body, _instance: Instance, _typing_env: TypingEnv): DenseBitSet<BasicBlock> {
  return unported("rustc_mir_transform::remove_noop_landing_pads::find_noop_landing_pads_for_instance");
}
