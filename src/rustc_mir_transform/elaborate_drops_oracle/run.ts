// Test driver for elaborate_drops.oracle.test.ts (lane mt-drops; not a port).
//   bun src/rustc_mir_transform/elaborate_drops_oracle/run.ts <rustc arguments...>
//
// `analysis` and `mir_borrowck` are not ported, so `mir_drops_elaborated_and_const_checked` is not reachable through the
// queries. In `after_expansion` this runs tydump's `run_required_analyses_prefix` (src/rust_ts/tydump_dump.ts) and the
// part of the `MIR_borrow_checking` loop that the ported driver reaches (`check_unsafety`, `has_ffi_unwind_calls`,
// `check_liveness`, as liveness_oracle/run.ts), aborts on errors as `analysis` does, and then, for every fn / assoc fn
// / closure body of `mir_keys`, takes a copy of the real `mir_promoted` body and runs:
// 1. `run_passes([CleanupPostBorrowck, RemoveNoopLandingPads, SimplifyCfg::PostAnalysis], Analysis(PostCleanup))`:
//    rustc's `run_analysis_cleanup_passes` minus `ImpossibleClauses` and `Derefer` (no-ops on the fixtures: no
//    impossible predicates, no derefs of non-local places). `CleanupPostBorrowck` and `RemoveNoopLandingPads` are still
//    stubs (lane mt-cleanup), so this driver uses TEST-ONLY STAND-INS below that do what the upstream passes do on these
//    fixtures (cleanup_post_borrowck.rs: statements to `Nop`, `FalseEdge`/`FalseUnwind` to `Goto`, user types cleared;
//    remove_noop_landing_pads.rs with `extra = None`). mt-cleanup / root: replace them with the real passes when they
//    land. `SimplifyCfg::PostAnalysis` is the real pass.
// 2. `run_passes([ElaborateDrops], Runtime(Initial))` (the real pass), so that the pass manager's `-Zdump-mir` hooks write
//    `<crate>.<item>.ElaborateDrops.{before,after}.mir` as rustc does. The rustc-side passes before `ElaborateDrops`
//    (`CriticalCallEdges`, `PostAnalysisNormalize`, `Subtyper`) are no-ops on the fixtures; the test checks this by
//    comparing the `before` dumps too.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { PassPolicy } from "../pass_manager.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("../../rust_ts/tydump_dump.ts");
  const { LocalDefId } = await import("../../rustc_span/def_id.ts");
  const { clone_Body } = await import("../../rustc_middle/mir/mod.ts");
  const { TerminatorKind } = await import("../../rustc_middle/mir/syntax.ts");
  const { CoverageKind } = await import("../../rustc_middle/mir/coverage.ts");
  const { postorder } = await import("../../rustc_middle/mir/traversal.ts");
  const { DenseBitSet } = await import("../../rustc_index/bit_set.ts");
  const pm = await import("../pass_manager.ts");
  const { MirPatch } = await import("../patch.ts");
  const { SimplifyCfg } = await import("../simplify.ts");
  const { ElaborateDrops } = await import("../elaborate_drops.ts");

  /** TEST-ONLY stand-in for cleanup_post_borrowck.rs `CleanupPostBorrowck` (see the header). */
  class CleanupPostBorrowckStandIn extends pm.MirPass {
    readonly type_name = "rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck";
    policy(): PassPolicy {
      return pm.PassPolicy.Required;
    }
    run_pass(_tcx: TyCtxt, body: Body): void {
      let invalidate_cfg = false;
      for (const basic_block of body.basic_blocks.as_mut_preserves_cfg()) {
        for (const statement of basic_block.statements) {
          const k = statement.kind;
          if (
            k.$ === "AscribeUserType" ||
            (k.$ === "Assign" && k._0[1].$ === "Ref" && k._0[1]._1.$ === "Fake") ||
            k.$ === "FakeRead" ||
            k.$ === "BackwardIncompatibleDropHint" ||
            (k.$ === "Coverage" && CoverageKind.is_removed_after_analysis(k._0))
          ) {
            statement.make_nop(true);
          } else if (
            k.$ === "Assign" &&
            k._0[1].$ === "Cast" &&
            k._0[1]._0.$ === "PointerCoercion" &&
            (k._0[1]._0._0.$ === "ArrayToPointer" || k._0[1]._0._0.$ === "MutToConstPointer")
          ) {
            k._0[1]._0 = { $: "PtrToPtr" };
          }
        }
        const terminator = basic_block.terminator_();
        if (terminator.kind.$ === "FalseEdge" || terminator.kind.$ === "FalseUnwind") {
          invalidate_cfg = true;
          terminator.kind = TerminatorKind.goto(terminator.kind.real_target);
        }
      }
      if (invalidate_cfg) body.basic_blocks.invalidate_cfg_cache();
      body.user_type_annotations.length = 0;
      for (const decl of body.local_decls) decl.user_ty = undefined;
    }
  }

  /** TEST-ONLY stand-in for remove_noop_landing_pads.rs `RemoveNoopLandingPads` (`extra = None`; see the header). */
  class RemoveNoopLandingPadsStandIn extends pm.MirPass {
    readonly type_name = "rustc_mir_transform::remove_noop_landing_pads::RemoveNoopLandingPads";
    policy(): PassPolicy {
      return pm.PassPolicy.optional(true);
    }
    run_pass(_tcx: TyCtxt, body: Body): void {
      const blocks = body.basic_blocks.deref();
      if (!blocks.some((b) => b.terminator_().kind.$ === "UnwindResume")) return;
      const nop_landing_pads = DenseBitSet.new_empty<number>(blocks.length);
      const ignored = ["FakeRead", "StorageLive", "StorageDead", "PlaceMention", "AscribeUserType", "Coverage", "ConstEvalCounter", "BackwardIncompatibleDropHint", "Nop"];
      for (const [bb, bbdata] of postorder(body)) {
        let is_nop = true;
        for (const stmt of bbdata.statements) {
          const k = stmt.kind;
          if (ignored.includes(k.$)) continue;
          if (k.$ === "Assign" && (k._0[1].$ === "Use" || k._0[1].$ === "Discriminant") && k._0[0].as_local() !== undefined) continue;
          is_nop = false;
          break;
        }
        if (is_nop) {
          const kind = bbdata.terminator_().kind;
          is_nop =
            ["Goto", "UnwindResume", "SwitchInt", "FalseEdge", "FalseUnwind"].includes(kind.$) &&
            [...TerminatorKind.successors(kind)].every((succ) => nop_landing_pads.contains(succ));
        }
        if (is_nop) nop_landing_pads.insert(bb);
      }
      if (nop_landing_pads.is_empty()) return;
      const patch = MirPatch.new(body);
      const resume_block = patch.resume_block_();
      patch.apply(body);
      for (const bbdata of body.basic_blocks.as_mut()) {
        const unwind = bbdata.terminator_().unwind_mut();
        if (unwind !== undefined && unwind.value.$ === "Cleanup" && nop_landing_pads.contains(unwind.value._0)) {
          unwind.value = { $: "Continue" };
        }
        bbdata.terminator_().successors_mut((target) => {
          if (target.value !== resume_block && nop_landing_pads.contains(target.value)) target.value = resume_block;
        });
      }
    }
  }

  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.sess.time("MIR_borrow_checking", () => {
        tcx.par_hir_body_owners((def_id) => {
          const not_typeck_child = !tcx.is_typeck_child(LocalDefId.to_def_id(def_id));
          if (not_typeck_child) {
            // Child unsafety and borrowck happens together with the parent
            tcx.ensure_ok().check_unsafety(def_id);
          }
          if (tcx.is_trivial_const(def_id)) {
            return;
          }
          tcx.ensure_ok().has_ffi_unwind_calls(def_id);
          tcx.ensure_ok().check_liveness(def_id);
        });
      });
      // `analysis`: "we exclude lint errors from this" (rustc_interface passes.rs).
      const guar = tcx.sess.dcx().has_errors_excluding_lint_errors();
      if (guar !== undefined) guar.raise_fatal();

      for (const def_id of tcx.mir_keys(null)) {
        const did = LocalDefId.to_def_id(def_id);
        if (tcx.trivial_const(def_id) !== undefined || tcx.is_constructor(did)) continue;
        const kind = tcx.def_kind(did);
        if (!(kind.$ === "Fn" || kind.$ === "AssocFn" || kind.$ === "Closure")) continue;
        const body = clone_Body(tcx.mir_promoted(def_id)[0].borrow());
        pm.run_passes(tcx, body, [new CleanupPostBorrowckStandIn(), new RemoveNoopLandingPadsStandIn(), SimplifyCfg.PostAnalysis], {
          $: "Analysis",
          _0: "PostCleanup",
        });
        pm.run_passes(tcx, body, [new ElaborateDrops()], { $: "Runtime", _0: "Initial" });
      }
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
