// Port of compiler/rustc_mir_transform/src/strip_debuginfo.rs (lane mt-opt1).
//
// PORT: `Vec::retain` on `body.var_debug_info` keeps the kept elements in place (same array object).
import { type Body, RETURN_PLACE, START_BLOCK } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debuginfo_locals } from "../rustc_mir_dataflow/debuginfo.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/// Conditionally remove some of the VarDebugInfo in MIR.
///
/// In particular, stripping non-parameter debug info for tiny, primitive-like
/// methods in core saves work later, and nobody ever wanted to use it anyway.
// rustc-type: compiler/rustc_mir_transform/src/strip_debuginfo.rs:12 StripDebugInfo
export class StripDebugInfo extends MirPass {
  readonly type_name = "rustc_mir_transform::strip_debuginfo::StripDebugInfo";

  // rustc: compiler/rustc_mir_transform/src/strip_debuginfo.rs:15 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.deref().opts.unstable_opts.mir_strip_debuginfo !== "None");
  }

  // rustc: compiler/rustc_mir_transform/src/strip_debuginfo.rs:19 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    switch (tcx.sess.opts.unstable_opts.mir_strip_debuginfo) {
      case "None":
        return;
      case "AllLocals":
        break;
      case "LocalsInTinyFunctions":
        if (body.basic_blocks.deref()[START_BLOCK]!.terminator_().kind.$ === "Return") {
          break;
        }
        return;
    }

    const kept = body.var_debug_info.filter((vdi) => {
      const value = vdi.value;
      return value.$ === "Place" && value._0.local <= body.arg_count && value._0.local !== RETURN_PLACE;
    });
    body.var_debug_info.length = 0;
    body.var_debug_info.push(...kept);

    drop_invalid_debuginfos(body);
  }
}

// Drop invalid debuginfos when strip locals in `var_debug_info`.
// rustc: compiler/rustc_mir_transform/src/strip_debuginfo.rs:42 drop_invalid_debuginfos
export function drop_invalid_debuginfos(body: Body): void {
  const debuginfo_locals_ = debuginfo_locals(body);
  for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
    for (const stmt of data.statements) {
      stmt.debuginfos.retain_locals(debuginfo_locals_);
    }
    data.after_last_stmt_debuginfos.retain_locals(debuginfo_locals_);
  }
}
