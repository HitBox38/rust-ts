// Stub module (lane mt-validate): compiler/rustc_mir_transform/src/validate.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path. (pass_manager.ts reads this module lazily: it must not import it at load.)
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/validate.rs:31 Validator (lane mt-validate)
export class Validator extends MirPass {
  readonly type_name = "rustc_mir_transform::validate::Validator";

  constructor(
    /// Describes at which point in the pipeline this validation is happening.
    public when: string,
  ) {
    super();
  }

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::validate::Validator (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::validate::Validator (pass not ported)");
  }
}
