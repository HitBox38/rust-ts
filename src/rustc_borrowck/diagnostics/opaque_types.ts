// Port of compiler/rustc_borrowck/src/diagnostics/opaque_types.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `FindOpaqueRegion` / `CheckExplicitRegionMentionAndCollectGenerics` are generated data interfaces (no inherent
// impl), so their `impl TypeVisitor` are impl tables `TypeVisitor_<Type>` whose methods take the visitor state as
// `self` (the fill lane builds the `TypeVisitor<R>` object over them, `Result` = `ControlFlow<..>`).
import type { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { Location } from "../../rustc_middle/mir/mod.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import type { DeferredOpaqueTypeError } from "../region_infer/opaque_types/mod.gen.ts";
import type { CheckExplicitRegionMentionAndCollectGenerics, FindOpaqueRegion } from "./opaque_types.gen.ts";

export * from "./opaque_types.gen.ts";

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // opaque_types.rs:25 (lane bck-diag-f)
    report_opaque_type_errors(errors: DeferredOpaqueTypeError[]): void;
    // opaque_types.rs:92 (lane bck-diag-f)
    note_due_to_edition_2024_opaque_capture_rules(borrow: BorrowData, diag: Diag): void;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:25 report_opaque_type_errors (lane bck-diag-f)
MirBorrowckCtxt.prototype.report_opaque_type_errors = function (this: MirBorrowckCtxt, errors: DeferredOpaqueTypeError[]): void {
  return unported("rustc_borrowck::diagnostics::opaque_types::MirBorrowckCtxt::report_opaque_type_errors");
};

/// Try to note when an opaque is involved in a borrowck error and that
/// opaque captures lifetimes due to edition 2024.
// stub: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:92 note_due_to_edition_2024_opaque_capture_rules (lane bck-diag-f)
MirBorrowckCtxt.prototype.note_due_to_edition_2024_opaque_capture_rules = function (this: MirBorrowckCtxt, borrow: BorrowData, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::opaque_types::MirBorrowckCtxt::note_due_to_edition_2024_opaque_capture_rules");
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for FindOpaqueRegion<'_, 'tcx> { type Result = ControlFlow<(DefId, usize, Location), ()>; }
export const TypeVisitor_FindOpaqueRegion = {
  // stub: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:217 visit_ty (lane bck-diag-f)
  visit_ty(self: FindOpaqueRegion, ty: Ty): ControlFlow<[DefId, number, Location], null> {
    return unported("rustc_borrowck::diagnostics::opaque_types::FindOpaqueRegion::visit_ty");
  },
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for CheckExplicitRegionMentionAndCollectGenerics<'tcx> { type Result = ControlFlow<(), ()>; }
export const TypeVisitor_CheckExplicitRegionMentionAndCollectGenerics = {
  // stub: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:275 visit_ty (lane bck-diag-f)
  visit_ty(self: CheckExplicitRegionMentionAndCollectGenerics, ty: Ty): ControlFlow<null, null> {
    return unported("rustc_borrowck::diagnostics::opaque_types::CheckExplicitRegionMentionAndCollectGenerics::visit_ty");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:294 visit_region (lane bck-diag-f)
  visit_region(self: CheckExplicitRegionMentionAndCollectGenerics, r: Region): ControlFlow<null, null> {
    return unported("rustc_borrowck::diagnostics::opaque_types::CheckExplicitRegionMentionAndCollectGenerics::visit_region");
  },
};
