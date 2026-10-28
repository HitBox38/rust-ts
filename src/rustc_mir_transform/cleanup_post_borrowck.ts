// Port of compiler/rustc_mir_transform/src/cleanup_post_borrowck.rs (lane mt-cleanup).
//! This module provides a pass that removes parts of MIR that are no longer relevant after
//! analysis phase and borrowck. In particular, it removes false edges, user type annotations and
//! replaces following statements with [`Nop`]s:
//!
//!   - [`AscribeUserType`]
//!   - [`FakeRead`]
//!   - [`Assign`] statements with a [`Fake`] borrow
//!   - [`Coverage`] statements that are not needed after the [`InstrumentCoverage`] pass
//!
//! [`AscribeUserType`]: rustc_middle::mir::StatementKind::AscribeUserType
//! [`Assign`]: rustc_middle::mir::StatementKind::Assign
//! [`FakeRead`]: rustc_middle::mir::StatementKind::FakeRead
//! [`Nop`]: rustc_middle::mir::StatementKind::Nop
//! [`Fake`]: rustc_middle::mir::BorrowKind::Fake
//! [`Coverage`]: rustc_middle::mir::StatementKind::Coverage
//! [`InstrumentCoverage`]: crate::coverage::InstrumentCoverage
import { type Body, CastKind, TerminatorKind } from "../rustc_middle/mir/mod.ts";
import { CoverageKind } from "../rustc_middle/mir/coverage.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/cleanup_post_borrowck.rs:24 CleanupPostBorrowck
export class CleanupPostBorrowck extends MirPass {
  readonly type_name = "rustc_mir_transform::cleanup_post_borrowck::CleanupPostBorrowck";

  // rustc: compiler/rustc_mir_transform/src/cleanup_post_borrowck.rs:27 run_pass
  run_pass(_tcx: TyCtxt, body: Body): void {
    // Manually invalidate CFG caches if we actually change a terminator's edges.
    let invalidate_cfg = false;
    for (const basic_block of body.basic_blocks.as_mut_preserves_cfg()) {
      for (const statement of basic_block.statements) {
        const kind = statement.kind;
        if (
          kind.$ === "AscribeUserType" ||
          (kind.$ === "Assign" && kind._0[1].$ === "Ref" && kind._0[1]._1.$ === "Fake") ||
          kind.$ === "FakeRead" ||
          kind.$ === "BackwardIncompatibleDropHint"
        ) {
          statement.make_nop(true);
        } else if (kind.$ === "Coverage" && CoverageKind.is_removed_after_analysis(kind._0)) {
          statement.make_nop(true);
        } else if (
          kind.$ === "Assign" &&
          kind._0[1].$ === "Cast" &&
          kind._0[1]._0.$ === "PointerCoercion" &&
          (kind._0[1]._0._0.$ === "ArrayToPointer" || kind._0[1]._0._0.$ === "MutToConstPointer")
        ) {
          // BorrowCk needed to track whether these cases were coercions or casts,
          // to know whether to check lifetimes in their pointees,
          // but from now on that distinction doesn't matter,
          // so just make them ordinary pointer casts instead.
          kind._0[1]._0 = CastKind.PtrToPtr;
        } else {
          // ()
        }
      }

      // If we change any terminator, we need to ensure that we invalidated the CFG cache.
      const terminator = basic_block.terminator_mut();
      const tk = terminator.kind;
      if (tk.$ === "FalseEdge" || tk.$ === "FalseUnwind") {
        const real_target = tk.real_target;
        invalidate_cfg = true;
        terminator.kind = TerminatorKind.goto(real_target);
      }
    }

    if (invalidate_cfg) {
      body.basic_blocks.invalidate_cfg_cache();
    }

    body.user_type_annotations.length = 0;

    for (const decl of body.local_decls) {
      decl.user_ty = undefined;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/cleanup_post_borrowck.rs:86 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Removes administrative MIR instructions that later passes must never see.
    return PassPolicy.Required;
  }
}
