// Port of compiler/rustc_hir_typeck/src/closure.rs (STUB, lane typeck-method): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// closure.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/closure.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./closure.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { FnCtxt } from "./decls.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::closure::FnCtxt", ["check_expr_closure", "deduce_closure_signature", "deduce_closure_signature_from_predicates", "deduce_sig_from_projection", "extract_sig_from_projection", "extract_sig_from_projection_and_future_bound", "sig_of_closure", "sig_of_closure_no_expectation", "sig_of_closure_with_expectation", "sig_of_closure_with_mismatched_number_of_arguments", "merge_supplied_sig_with_expectation", "supplied_sig_of_closure", "deduce_future_output_from_obligations", "deduce_future_output_from_projection", "error_sig_of_closure", "closure_sigs"]);
