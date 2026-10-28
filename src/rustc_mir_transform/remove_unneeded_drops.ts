// Port of compiler/rustc_mir_transform/src/remove_unneeded_drops.rs (lane mt-opt1).
//! This pass replaces a drop of a type that does not need dropping, with a goto.
//!
//! When the MIR is built, we check `needs_drop` before emitting a `Drop` for a place. This pass is
//! useful because (unlike MIR building) it runs after type checking, so it can make use of
//! `TypingMode::PostAnalysis` to provide more precise type information, especially about opaque
//! types.
import { type Body, TerminatorKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { simplify_cfg } from "./simplify.ts";

// rustc-type: compiler/rustc_mir_transform/src/remove_unneeded_drops.rs:15 RemoveUnneededDrops
export class RemoveUnneededDrops extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_unneeded_drops::RemoveUnneededDrops";

  // rustc: compiler/rustc_mir_transform/src/remove_unneeded_drops.rs:18 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("Running RemoveUnneededDrops on {:?}", body.source);

    const typing_env = body.typing_env(tcx);
    let should_simplify = false;
    for (const block of body.basic_blocks.as_mut()) {
      const terminator = block.terminator_mut();
      const kind = terminator.kind;
      if (kind.$ !== "Drop") continue;
      const place = kind.place;
      const target = kind.target;
      const ty = place.ty(body.local_decls, tcx).ty;

      if (ty.needs_drop(tcx, typing_env)) {
        continue;
      }
      // debug!("SUCCESS: replacing `drop` with goto({:?})", target);
      terminator.kind = TerminatorKind.goto(target);
      should_simplify = true;
    }

    // if we applied optimizations, we potentially have some cfg to cleanup to
    // make it easier for further passes
    if (should_simplify) {
      simplify_cfg(tcx, body);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_unneeded_drops.rs:43 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }
}
