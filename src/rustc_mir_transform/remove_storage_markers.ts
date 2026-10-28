// Port of compiler/rustc_mir_transform/src/remove_storage_markers.rs (lane mt-opt1).
//
// PORT: `ctx.emit_lifetime_markers()` is `Session::emit_lifetime_markers` (rustc_session/src/session.rs:883) through
// `PassCtx`'s `Deref<Target = Session>`. session.ts (not this lane's file) has not ported it yet, so
// `emit_lifetime_markers` below is a module-local stand-in with the same body and no marker; root should move it to
// session.ts and repoint (see docs/handoff/mt-opt1.md). copy_prop.ts imports it from here.
//! This pass removes storage markers if they won't be emitted during codegen.
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { SanitizerSet } from "../rustc_target/spec/mod.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/** PORT: stand-in for `Session::emit_lifetime_markers` (session.rs:883; see the header). */
export function emit_lifetime_markers(self: Session): boolean {
  /// Checks if LLVM lifetime markers should be emitted.
  return (
    self.opts.optimize !== "No" ||
    // AddressSanitizer and KernelAddressSanitizer uses lifetimes to detect use after scope bugs.
    //
    // MemorySanitizer uses lifetimes to detect use of uninitialized stack variables.
    //
    // HWAddressSanitizer and KernelHWAddressSanitizer will use lifetimes to detect use after
    // scope bugs in the future.
    (self.sanitizers() &
      (SanitizerSet.ADDRESS |
        SanitizerSet.KERNELADDRESS |
        SanitizerSet.MEMORY |
        SanitizerSet.HWADDRESS |
        SanitizerSet.KERNELHWADDRESS)) !==
      0 ||
    // Lifetimes are necessary for retagging semantics.
    self.opts.unstable_opts.codegen_emit_retag !== undefined
  );
}

// rustc-type: compiler/rustc_mir_transform/src/remove_storage_markers.rs:9 RemoveStorageMarkers
export class RemoveStorageMarkers extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_storage_markers::RemoveStorageMarkers";

  // rustc: compiler/rustc_mir_transform/src/remove_storage_markers.rs:12 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1 && !emit_lifetime_markers(ctx.deref()));
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
