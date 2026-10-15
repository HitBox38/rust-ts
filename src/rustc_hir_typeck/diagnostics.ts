// Port of compiler/rustc_hir_typeck/src/diagnostics.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// diagnostics.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./diagnostics.gen.ts";
import { unported } from "../std/panic.ts";
import type { AssignOpKind } from "../rustc_ast/lib.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { Spanned } from "../rustc_span/lib.ts";
import type { Result } from "../std/result.ts";
import type { FnCtxt } from "./decls.ts";

// diagnostics.rs:1260 (stub; final signature: decls.ts `Fns_diagnostics`)
export function maybe_emit_plus_equals_diagnostic(fnctxt: FnCtxt, assign_op: Spanned<AssignOpKind>, lhs_expr: hir.Expr): Result<undefined, Diag> {
  return unported("rustc_hir_typeck::diagnostics::maybe_emit_plus_equals_diagnostic");
}
