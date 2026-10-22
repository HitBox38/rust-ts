// Stub module (lane mt-cleanup): compiler/rustc_mir_transform/src/deref_separator.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/deref_separator.rs:9 Derefer (lane mt-cleanup)
export class Derefer extends MirPass {
  readonly type_name = "rustc_mir_transform::deref_separator::Derefer";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::deref_separator::Derefer (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::deref_separator::Derefer (pass not ported)");
  }
}
