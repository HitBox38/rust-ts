// Port of compiler/rustc_hir_typeck/src/_match.rs (STUB, lane typeck-impl): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// _match.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/_match.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::_match::FnCtxt", ["check_expr_match", "explain_never_type_coerced_to_unit", "suggest_removing_semicolon_for_coerce", "warn_arms_when_scrutinee_diverges", "if_fallback_coercion", "is_from_assert_macro", "explain_if_expr", "maybe_get_coercion_reason", "if_cause", "demand_scrutinee_type", "return_position_impl_trait_from_match_expectation"]);

// _match.rs:562 (stub; final signature: decls.ts `Fns__match`)
export function arms_contain_ref_bindings(arms: readonly hir.Arm[]): Mutability | undefined {
  return unported("rustc_hir_typeck::_match::arms_contain_ref_bindings");
}
