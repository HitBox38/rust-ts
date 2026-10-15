// Port of compiler/rustc_hir_typeck/src/method/confirm.rs (STUB, lane typeck-method): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// method/confirm.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./confirm.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import { ConfirmContext } from "./confirm.gen.ts";

// method/confirm.rs:47 `impl Deref for ConfirmContext { type Target = FnCtxt }` (`&self.fcx`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(ConfirmContext, "fcx", FnCtxt);
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::confirm::FnCtxt", ["confirm_method", "confirm_method_for_diagnostic"]);
unported_methods(ConfirmContext.prototype, "rustc_hir_typeck::method::confirm::ConfirmContext", ["deref", "confirm", "adjust_self_ty", "create_ty_adjustments_from_pick", "fresh_receiver_args", "extract_existential_trait_ref", "instantiate_method_args", "unify_receivers", "instantiate_method_sig", "add_obligations", "clauses_require_illegal_sized_bound", "check_for_illegal_method_calls", "lint_shadowed_supertrait_items", "lint_ambiguously_glob_imported_traits", "upcast", "instantiate_binder_with_fresh_vars"]);
unported_methods(ConfirmContext, "rustc_hir_typeck::method::confirm::ConfirmContext", ["new"]);
