// Port of compiler/rustc_hir_typeck/src/writeback.rs (STUB, lane typeck-lib-wb): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// writeback.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/writeback.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./writeback.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { FnCtxt } from "./decls.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";

// rustc-type: compiler/rustc_hir_typeck/src/writeback.rs:97 WritebackCx
/// The Writeback context. This visitor walks the HIR, checking the
/// fn-specific typeck results to find inference variables. It resolves
/// those inference variables and writes the final result into the
/// `TypeckResults`. It also applies a few ad-hoc checks that were not
/// convenient to do elsewhere.
// PORT: hand class (types.sets.json `hand`): `impl Visitor for WritebackCx` (writeback.rs:259) overrides methods of
// rustc_hir intravisit's `Visitor`. Its methods are declared in decls.ts (`declare module "./writeback.ts"`).
export class WritebackCx extends hir.intravisit.Visitor {
  constructor(
    public fcx: FnCtxt,

    public typeck_results: TypeckResults,

    public body: hir.Body,

    public rustc_dump_user_args: boolean,
  ) {
    super();
  }
}

// The other hand types of this file (types.sets.json `hand`); lane typeck-lib-wb writes each class (with its trait impl).
/** writeback.rs:916 `struct Resolver` (`impl TypeFolder`). */
export type Resolver = unknown;
/** writeback.rs:1045 `struct EagerlyNormalizeConsts` (`impl TypeFolder`). */
export type EagerlyNormalizeConsts = unknown;
/** writeback.rs:1075 `struct HasRecursiveOpaque` (`impl TypeVisitor`). */
export type HasRecursiveOpaque = unknown;

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::writeback::FnCtxt", ["resolve_type_vars_in_body"]);
unported_methods(WritebackCx.prototype, "rustc_hir_typeck::writeback::WritebackCx", ["tcx", "write_ty_to_typeck_results", "fix_scalar_builtin_expr", "is_builtin_index", "fix_index_builtin_expr", "eval_closure_size", "visit_min_capture_map", "visit_fake_reads_map", "visit_closures", "visit_coercion_casts", "visit_user_provided_tys", "visit_user_provided_sigs", "visit_coroutine_interior", "visit_transmutes", "visit_offloads", "visit_opaque_types_next", "visit_opaque_types", "visit_field_id", "visit_node_id", "visit_adjustments", "visit_rust_2024_migration_desugared_pats", "visit_pat_adjustments", "visit_skipped_ref_pats", "visit_liberated_fn_sigs", "visit_fru_field_types", "visit_offset_of_container_types", "visit_potentially_region_dependent_goals", "resolve", "resolve_coroutine_predicate"]);
unported_methods(WritebackCx, "rustc_hir_typeck::writeback::WritebackCx", ["new"]);
// `impl Visitor for WritebackCx` (writeback.rs:259): placeholders, so that the base `Visitor` defaults never run instead.
unported_methods(WritebackCx.prototype, "rustc_hir_typeck::writeback::<WritebackCx as Visitor>", ["visit_expr", "visit_inline_const", "visit_generic_param", "visit_block", "visit_pat", "visit_pat_expr", "visit_local", "visit_ty", "visit_infer"]);
