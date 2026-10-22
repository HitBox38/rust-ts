// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/dataflow_const_prop.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, type PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:35 DataflowConstProp (lane mt-opt2)
export class DataflowConstProp extends MirPass {
  readonly type_name = "rustc_mir_transform::dataflow_const_prop::DataflowConstProp";

  policy(_ctx: PassCtx): PassPolicy {
    return unported("rustc_mir_transform::dataflow_const_prop::DataflowConstProp (pass not ported)");
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::dataflow_const_prop::DataflowConstProp (pass not ported)");
  }
}
