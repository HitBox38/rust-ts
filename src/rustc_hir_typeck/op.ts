// Port of compiler/rustc_hir_typeck/src/op.rs (STUB, lane typeck-expr-a): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// op.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/op.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./op.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type * as ast from "../rustc_ast/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { BinOpCategory, Op } from "./op.gen.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::op::FnCtxt", ["check_expr_assign_op", "check_expr_binop", "enforce_builtin_binop_types", "check_overloaded_binop", "overloaded_binop_ret_ty", "report_binop_fulfillment_errors", "suggest_deref_or_call_for_binop_error", "suggest_raw_ptr_binop_arithmetic", "suggest_raw_ptr_assign_arithmetic", "suggest_different_borrow", "is_lhs_of_assign_stmt", "suggest_deref_binop", "check_str_addition", "check_user_unop", "lookup_op_method"]);

// op.rs:1169 (stub; final signature: decls.ts `Fns_op`)
export function lang_item_for_binop(tcx: TyCtxt, op: Op): [Symbol, DefId | undefined] {
  return unported("rustc_hir_typeck::op::lang_item_for_binop");
}

// op.rs:1208 (stub; final signature: decls.ts `Fns_op`)
export function lang_item_for_unop(tcx: TyCtxt, op: ast.UnOp): [Symbol, DefId | undefined] {
  return unported("rustc_hir_typeck::op::lang_item_for_unop");
}

// op.rs:1218 (stub; final signature: decls.ts `Fns_op`)
export function contains_let_in_chain(expr: hir.Expr): boolean {
  return unported("rustc_hir_typeck::op::contains_let_in_chain");
}

// op.rs:1307 (stub; final signature: decls.ts `Fns_op`)
export function deref_ty_if_possible(ty: Ty): Ty {
  return unported("rustc_hir_typeck::op::deref_ty_if_possible");
}

// op.rs:1325 (stub; final signature: decls.ts `Fns_op`)
export function is_builtin_binop(lhs: Ty, rhs: Ty, category: BinOpCategory): boolean {
  return unported("rustc_hir_typeck::op::is_builtin_binop");
}
