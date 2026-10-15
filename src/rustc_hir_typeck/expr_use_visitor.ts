// Port of compiler/rustc_hir_typeck/src/expr_use_visitor.rs (STUB, lane typeck-euv): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// expr_use_visitor.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./expr_use_visitor.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { ExprUseVisitor } from "./expr_use_visitor.gen.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { Result } from "../std/result.ts";
import type { Delegate, FnCtxt, PlaceWithHirId, TypeInformationCtxtImpl } from "./decls.ts";

/** expr_use_visitor.rs:1862 `struct ExprPlaceDelegate` (unit struct, `impl Delegate`; hand type, lane typeck-euv writes it). */
export type ExprPlaceDelegate = unknown;

/** expr_use_visitor.rs:180 `impl<'tcx> TypeInformationCtxt<'tcx> for &FnCtxt<'_, 'tcx>`: the vtable (decls.ts `TypeInformationCtxtImpl`); lane typeck-euv assigns each method (`TypeInformationCtxt_FnCtxt.<name> = function (this: FnCtxt, ..) {..}`). */
export const TypeInformationCtxt_FnCtxt = {} as TypeInformationCtxtImpl<FnCtxt>;

/** The provided methods of `trait Delegate` (expr_use_visitor.rs:80 `copy`, :93 `bind`), `self_` first (decls.ts `Delegate`). */
export const Delegate_provided = {
  // expr_use_visitor.rs:80 (stub)
  copy(_self_: Delegate, _place_with_id: PlaceWithHirId, _diag_expr_id: HirId): void {
    return unported("rustc_hir_typeck::expr_use_visitor::Delegate::copy");
  },
  // expr_use_visitor.rs:93 (stub)
  bind(_self_: Delegate, _binding_place: PlaceWithHirId, _diag_expr_id: HirId): void {
    return unported("rustc_hir_typeck::expr_use_visitor::Delegate::bind");
  },
};

unported_methods(ExprUseVisitor.prototype, "rustc_hir_typeck::expr_use_visitor::ExprUseVisitor", ["consume_body", "consume_or_copy", "consume_clone_or_copy", "consume_exprs", "consume_expr", "consume_or_clone_expr", "mutate_expr", "borrow_expr", "walk_expr", "walk_stmt", "fake_read_scrutinee", "walk_local", "walk_block", "walk_struct_expr", "walk_adjustment", "walk_autoref", "walk_arm", "walk_pat", "walk_captures", "expect_and_resolve_type", "node_ty", "expr_ty", "expr_ty_adjusted", "pat_ty_adjusted", "pat_ty_unadjusted", "cat_expr", "cat_expr_", "cat_expr_adjusted", "cat_expr_adjusted_with", "cat_expr_unadjusted", "cat_res", "cat_upvar", "cat_rvalue", "cat_projection", "cat_overloaded_place", "cat_deref", "variant_index_for_adt", "total_fields_in_adt_variant", "total_fields_in_tuple", "cat_pattern", "pat_deref_place", "is_multivariant_adt"]);
unported_methods(ExprUseVisitor, "rustc_hir_typeck::expr_use_visitor::ExprUseVisitor", ["for_clippy", "new"]);
unported_methods(TypeInformationCtxt_FnCtxt, "rustc_hir_typeck::expr_use_visitor::<&FnCtxt as TypeInformationCtxt>", ["typeck_results", "deeply_resolve_ignoring_regions", "structurally_resolve_type", "report_bug", "error_reported_in_ty", "tainted_by_errors", "type_is_copy_modulo_regions", "type_is_use_cloned_modulo_regions", "body_owner_def_id", "tcx"]);

// expr_use_visitor.rs:1879 (stub; final signature: decls.ts `Fns_expr_use_visitor`)
export function expr_place(fcx: FnCtxt, expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::expr_use_visitor::expr_place");
}
