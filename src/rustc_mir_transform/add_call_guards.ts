// Stub module (lane mt-cleanup): compiler/rustc_mir_transform/src/add_call_guards.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/add_call_guards.rs:26 AddCallGuards (lane mt-cleanup)
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type AddCallGuards_variant = "AllCallEdges" | "CriticalCallEdges";
export class AddCallGuards extends MirPass {
  readonly type_name = "rustc_mir_transform::add_call_guards::AddCallGuards";

  private constructor(readonly $: AddCallGuards_variant) {
    super();
    Object.freeze(this);
  }

  static readonly AllCallEdges = new AddCallGuards("AllCallEdges");
  static readonly CriticalCallEdges = new AddCallGuards("CriticalCallEdges");

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::add_call_guards::AddCallGuards (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::add_call_guards::AddCallGuards (pass not ported)");
  }
}
// pub(super) use self::AddCallGuards::*;
export const AllCallEdges = AddCallGuards.AllCallEdges;
export const CriticalCallEdges = AddCallGuards.CriticalCallEdges;
