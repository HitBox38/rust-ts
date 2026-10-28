// Port of compiler/rustc_mir_transform/src/remove_place_mention.rs (lane mt-cleanup).
//! This pass removes `PlaceMention` statement, which has no effect at codegen.
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/remove_place_mention.rs:9 RemovePlaceMention
export class RemovePlaceMention extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_place_mention::RemovePlaceMention";

  // rustc: compiler/rustc_mir_transform/src/remove_place_mention.rs:12 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(!ctx.deref().opts.unstable_opts.mir_preserve_ub);
  }

  // rustc: compiler/rustc_mir_transform/src/remove_place_mention.rs:16 run_pass
  run_pass(_: TyCtxt, body: Body): void {
    // trace!("Running RemovePlaceMention on {:?}", body.source);
    for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
      data.retain_statements((statement) => {
        switch (statement.kind.$) {
          case "PlaceMention":
          case "Nop":
            return false;
          default:
            return true;
        }
      });
    }
  }
}
