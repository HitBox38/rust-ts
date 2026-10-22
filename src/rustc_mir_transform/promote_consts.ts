// Stub module (lane mt-promote): compiler/rustc_mir_transform/src/promote_consts.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/promote_consts.rs:40 PromoteTemps (lane mt-promote)
// `#[derive(Default)]`: `PromoteTemps::default()` is `new PromoteTemps([])`.
export class PromoteTemps extends MirPass {
  readonly type_name = "rustc_mir_transform::promote_consts::PromoteTemps";

  constructor(
    // Must use `Cell` because `run_pass` takes `&self`, not `&mut self`.
    /** `Cell<IndexVec<Promoted, Body<'tcx>>>`: `run_pass` replaces it; `.into_inner()` is the field. */
    public promoted_fragments: Body[],
  ) {
    super();
  }

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::promote_consts::PromoteTemps (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::promote_consts::PromoteTemps (pass not ported)");
  }
}
