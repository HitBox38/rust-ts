// Port of compiler/rustc_hir_typeck/src/callee.rs (STUB, lane typeck-callee-cast): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// callee.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/callee.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./callee.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import { DeferredCallResolution } from "./callee.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Result } from "../std/result.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::callee::FnCtxt", ["check_expr_call", "check_call_abi", "try_overloaded_call_step", "try_overloaded_call_traits", "is_scalable_vector_ctor", "identify_bad_closure_def_and_call", "maybe_suggest_bad_array_definition", "confirm_builtin_call", "check_argument_types_maybe_method_like", "get_info_for_method_call_adjustments", "suggest_call_as_method", "report_invalid_callee", "confirm_deferred_closure_call", "enforce_context_effects", "confirm_overloaded_call"]);
unported_methods(DeferredCallResolution.prototype, "rustc_hir_typeck::callee::DeferredCallResolution", ["resolve"]);

// callee.rs:50 (stub; final signature: decls.ts `Fns_callee`)
export function check_legal_trait_for_method_call(tcx: TyCtxt, span: Span, receiver: Span | undefined, expr_span: Span, trait_id: DefId, body_def_id: DefId): Result<undefined, ErrorGuaranteed> {
  return unported("rustc_hir_typeck::callee::check_legal_trait_for_method_call");
}
