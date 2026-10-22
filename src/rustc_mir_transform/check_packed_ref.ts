// Stub module (lane mt-built-lints): compiler/rustc_mir_transform/src/check_packed_ref.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirLint } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/check_packed_ref.rs:8 CheckPackedRef (lane mt-built-lints)
export class CheckPackedRef extends MirLint {
  readonly type_name = "rustc_mir_transform::check_packed_ref::CheckPackedRef";

  run_lint(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::check_packed_ref::CheckPackedRef (pass not ported)");
  }
}
