// Port of compiler/rustc_hir_typeck/src/upvar.rs (STUB, lane typeck-upvar): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// upvar.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/upvar.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./upvar.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { CaptureInfo, CapturedPlace, UpvarCapture } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Region } from "../rustc_middle/ty/decls.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { Place } from "./decls.ts";
import type { NeededMigration, PlaceAncestryRelation } from "./upvar.gen.ts";

/** upvar.rs `struct InferBorrowKindVisitor` (`impl Visitor`; hand type, lane typeck-upvar writes the class). */
export type InferBorrowKindVisitor = unknown;
/** upvar.rs `struct InferBorrowKind` (`impl euv::Delegate`: a class implementing decls.ts `Delegate`; hand type, lane typeck-upvar). */
export type InferBorrowKind = unknown;

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::upvar::FnCtxt", ["closure_analyze", "infer_closure_kind_for_diagnostic", "analyze_closure", "coroutine_body_consumes_upvars", "final_upvar_tys", "process_collected_capture_information", "compute_min_captures", "perform_2229_migration_analysis", "compute_2229_migrations_reasons", "compute_2229_migrations_for_trait", "compute_2229_migrations_for_drop", "compute_2229_migrations", "has_significant_drop_outside_of_captures", "init_capture_kind_for_place", "place_for_root_variable", "should_log_capture_analysis", "log_capture_analysis_first_pass", "log_closure_min_capture_info", "determine_capture_mutability"]);

// upvar.rs:2094 (stub; final signature: decls.ts `Fns_upvar`)
export function should_reborrow_from_env_of_parent_coroutine_closure(parent_capture: CapturedPlace, child_capture: CapturedPlace): boolean {
  return unported("rustc_hir_typeck::upvar::should_reborrow_from_env_of_parent_coroutine_closure");
}

// upvar.rs:2122 (stub; final signature: decls.ts `Fns_upvar`)
export function restrict_repr_packed_field_ref_capture(place: Place, curr_borrow_kind: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::restrict_repr_packed_field_ref_capture");
}

// upvar.rs:2153 (stub; final signature: decls.ts `Fns_upvar`)
export function apply_capture_kind_on_capture_ty(tcx: TyCtxt, ty: Ty, capture_kind: UpvarCapture, region: Region): Ty {
  return unported("rustc_hir_typeck::upvar::apply_capture_kind_on_capture_ty");
}

// upvar.rs:2166 (stub; final signature: decls.ts `Fns_upvar`)
export function drop_location_span(tcx: TyCtxt, hir_id: HirId): Span | undefined {
  return unported("rustc_hir_typeck::upvar::drop_location_span");
}

// upvar.rs:2317 (stub; final signature: decls.ts `Fns_upvar`)
export function restrict_precision_for_drop_types(fcx: FnCtxt, place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::restrict_precision_for_drop_types");
}

// upvar.rs:2343 (stub; final signature: decls.ts `Fns_upvar`)
export function restrict_precision_for_unsafe(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::restrict_precision_for_unsafe");
}

// upvar.rs:2378 (stub; final signature: decls.ts `Fns_upvar`)
export function restrict_capture_precision(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::restrict_capture_precision");
}

// upvar.rs:2408 (stub; final signature: decls.ts `Fns_upvar`)
export function adjust_for_move_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::adjust_for_move_closure");
}

// upvar.rs:2423 (stub; final signature: decls.ts `Fns_upvar`)
export function adjust_for_use_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::adjust_for_use_closure");
}

// upvar.rs:2439 (stub; final signature: decls.ts `Fns_upvar`)
export function adjust_for_non_move_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::adjust_for_non_move_closure");
}

// upvar.rs:2469 (stub; final signature: decls.ts `Fns_upvar`)
export function construct_place_string(tcx: TyCtxt, place: Place): string {
  return unported("rustc_hir_typeck::upvar::construct_place_string");
}

// upvar.rs:2494 (stub; final signature: decls.ts `Fns_upvar`)
export function construct_capture_kind_reason_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string {
  return unported("rustc_hir_typeck::upvar::construct_capture_kind_reason_string");
}

// upvar.rs:2510 (stub; final signature: decls.ts `Fns_upvar`)
export function construct_path_string(tcx: TyCtxt, place: Place): string {
  return unported("rustc_hir_typeck::upvar::construct_path_string");
}

// upvar.rs:2516 (stub; final signature: decls.ts `Fns_upvar`)
export function construct_capture_info_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string {
  return unported("rustc_hir_typeck::upvar::construct_capture_info_string");
}

// upvar.rs:2531 (stub; final signature: decls.ts `Fns_upvar`)
export function var_name(tcx: TyCtxt, var_hir_id: HirId): Symbol {
  return unported("rustc_hir_typeck::upvar::var_name");
}

// upvar.rs:2536 (stub; final signature: decls.ts `Fns_upvar`)
export function should_do_rust_2021_incompatible_closure_captures_analysis(tcx: TyCtxt, closure_id: HirId): boolean {
  return unported("rustc_hir_typeck::upvar::should_do_rust_2021_incompatible_closure_captures_analysis");
}

// upvar.rs:2550 (stub; final signature: decls.ts `Fns_upvar`)
export function migration_suggestion_for_2229(tcx: TyCtxt, need_migrations: readonly NeededMigration[]): [string, string] {
  return unported("rustc_hir_typeck::upvar::migration_suggestion_for_2229");
}

// upvar.rs:2608 (stub; final signature: decls.ts `Fns_upvar`)
export function determine_capture_info(capture_info_a: CaptureInfo, capture_info_b: CaptureInfo): CaptureInfo {
  return unported("rustc_hir_typeck::upvar::determine_capture_info");
}

// upvar.rs:2633 (stub; final signature: decls.ts `Fns_upvar`)
export function truncate_place_to_len_and_update_capture_kind(place: Place, curr_mode: UpvarCapture, len: number): void {
  return unported("rustc_hir_typeck::upvar::truncate_place_to_len_and_update_capture_kind");
}

// upvar.rs:2668 (stub; final signature: decls.ts `Fns_upvar`)
export function determine_place_ancestry_relation(place_a: Place, place_b: Place): PlaceAncestryRelation {
  return unported("rustc_hir_typeck::upvar::determine_place_ancestry_relation");
}

// upvar.rs:2730 (stub; final signature: decls.ts `Fns_upvar`)
export function truncate_capture_for_optimization(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture] {
  return unported("rustc_hir_typeck::upvar::truncate_capture_for_optimization");
}

// upvar.rs:2754 (stub; final signature: decls.ts `Fns_upvar`)
export function enable_precise_capture(span: Span): boolean {
  return unported("rustc_hir_typeck::upvar::enable_precise_capture");
}
