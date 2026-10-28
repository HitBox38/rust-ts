// Port of compiler/rustc_mir_transform/src/remove_storage_markers.rs (lane mt-opt1).
//
// PORT: `ctx.emit_lifetime_markers()` is `Session::emit_lifetime_markers` (rustc_session/session.ts) through
// `PassCtx`'s `Deref<Target = Session>` (`ctx.deref()`).
//! This pass removes storage markers if they won't be emitted during codegen.
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/remove_storage_markers.rs:9 RemoveStorageMarkers
export class RemoveStorageMarkers extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_storage_markers::RemoveStorageMarkers";

  // rustc: compiler/rustc_mir_transform/src/remove_storage_markers.rs:12 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1 && !ctx.deref().emit_lifetime_markers());
  }

  // rustc: compiler/rustc_mir_transform/src/remove_storage_markers.rs:16 run_pass
  run_pass(_tcx: TyCtxt, body: Body): void {
    // trace!("Running RemoveStorageMarkers on {:?}", body.source);
    for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
      data.retain_statements((statement) => {
        switch (statement.kind.$) {
          case "StorageLive":
          case "StorageDead":
          case "Nop":
            return false;
          default:
            return true;
        }
      });
    }
  }
}
