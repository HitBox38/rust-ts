// Stub module (lane mt-inline): compiler/rustc_mir_transform/src/inline.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
// merge-w22 ported the policy fns ahead of the lane (`mir_drops_elaborated_and_const_checked` asks them for every
// fn-like body): `Inline::policy`, `ForceInline::should_run_pass_for_callee`, `ForceInline::policy`. The inliner itself
// (`run_pass`) stays stubbed.
import { unported } from "../std/panic.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { OptLevel } from "../rustc_session/config.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/inline.rs:43 Inline (lane mt-inline)
// Made public so that `mir_drops_elaborated_and_const_checked` can be overridden
// by custom rustc drivers, running all the steps by themselves. See #114628.
export class Inline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::Inline";

  // rustc: compiler/rustc_mir_transform/src/inline.rs:46 policy
  policy(ctx: PassCtx): PassPolicy {
    const opts = ctx.deref().opts;
    const enabled = opts.unstable_opts.inline_mir;
    if (enabled !== undefined) {
      return PassPolicy.optional(enabled);
    } else {
      let on: boolean;
      const level = ctx.mir_opt_level();
      switch (level) {
        case 0:
        case 1:
          on = false;
          break;
        // Only inline for `-Copt-level >= 2`, and don't inline
        // in incremental mode to increase incremental effectiveness.
        // FIXME: This should be cleaned up to not rely on inspecting the global opt level.
        case 2:
          on = (opts.optimize === OptLevel.More || opts.optimize === OptLevel.Aggressive) && opts.incremental === undefined;
          break;
        default:
          on = true;
      }
      return PassPolicy.optional(on);
    }
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::inline::Inline (pass not ported)");
  }
}

// stub: compiler/rustc_mir_transform/src/inline.rs:74 ForceInline (lane mt-inline)
export class ForceInline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::ForceInline";

  // rustc: compiler/rustc_mir_transform/src/inline.rs:77 should_run_pass_for_callee
  static should_run_pass_for_callee(tcx: TyCtxt, def_id: DefId): boolean {
    // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
    return (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === "Force";
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:83 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Forced inlining is part of MIR semantics.
    return PassPolicy.Required;
  }

  run_pass(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_transform::inline::ForceInline (pass not ported)");
  }
}

// pub(crate) mod cycle;
export * as cycle from "./inline/cycle.ts";
