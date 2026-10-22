// Stub module (lane mt-inline): compiler/rustc_mir_transform/src/inline.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/inline.rs:43 Inline (lane mt-inline)
export class Inline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::Inline";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::inline::Inline (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::inline::Inline (pass not ported)");
  }
}

// stub: compiler/rustc_mir_transform/src/inline.rs:74 ForceInline (lane mt-inline)
export class ForceInline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::ForceInline";

  // stub: compiler/rustc_mir_transform/src/inline.rs:77 should_run_pass_for_callee (lane mt-inline)
  static should_run_pass_for_callee(_tcx: TyCtxt, _def_id: DefId): boolean {
    return unported("rustc_mir_transform::inline::ForceInline::should_run_pass_for_callee");
  }

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::inline::ForceInline (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::inline::ForceInline (pass not ported)");
  }
}

// pub(crate) mod cycle;
export * as cycle from "./inline/cycle.ts";
