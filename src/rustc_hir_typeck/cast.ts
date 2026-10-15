// Port of compiler/rustc_hir_typeck/src/cast.rs (STUB, lane typeck-callee-cast): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// cast.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/cast.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./cast.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import { CastCheck } from "./cast.gen.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { CastKind } from "./cast.gen.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::cast::FnCtxt", ["pointer_kind"]);
unported_methods(CastCheck.prototype, "rustc_hir_typeck::cast::CastCheck", ["report_cast_error", "report_cast_to_unsized_type", "trivial_cast_lint", "is_non_trivial_ref_trait_object_upcast", "expr_span_for_type_resolution", "check", "try_report_ambiguous_binop_for_infer_cast", "do_check", "check_ptr_ptr_cast", "check_fptr_ptr_cast", "check_ptr_addr_cast", "check_ref_cast", "check_addr_ptr_cast", "check_enum_cast", "try_coercion_cast", "try_suggest_collection_to_bool"]);
unported_methods(CastCheck, "rustc_hir_typeck::cast::CastCheck", ["new"]);

// cast.rs:212 (stub; final signature: decls.ts `Fns_cast`)
export function make_invalid_casting_error(span: Span, expr_ty: Ty, cast_ty: Ty, fcx: FnCtxt): Diag {
  return unported("rustc_hir_typeck::cast::make_invalid_casting_error");
}

// cast.rs:233 (stub; final signature: decls.ts `Fns_cast`)
export function check_cast(tcx: TyCtxt, param_env: ParamEnv, e: hir.Expr, from_ty: Ty, to_ty: Ty): CastKind | undefined {
  return unported("rustc_hir_typeck::cast::check_cast");
}

// cast.rs:1315 (stub; final signature: decls.ts `Fns_cast`)
export function index_operand_ambiguity_span(expr: hir.Expr): Span {
  return unported("rustc_hir_typeck::cast::index_operand_ambiguity_span");
}
