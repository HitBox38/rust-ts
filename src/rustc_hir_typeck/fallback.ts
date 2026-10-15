// Port of compiler/rustc_hir_typeck/src/fallback.rs (STUB, lane typeck-lib-wb): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fallback.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fallback.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./fallback.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { TyVid } from "../rustc_type_ir/decls.ts";
import type { UnsafeUseReason } from "./fallback.gen.ts";

/** fallback.rs `struct AnnotateUnitFallbackVisitor` (`impl Visitor`; hand type, lane typeck-lib-wb writes the class). */
export type AnnotateUnitFallbackVisitor = unknown;

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fallback::FnCtxt", ["type_inference_fallback", "fallback_types", "fallback_types_to_error", "calculate_fallback_to_f32", "calculate_diverging_fallback", "lint_never_type_fallback_flowing_into_unsafe_code", "create_coercion_graph", "root_vid", "root_float_vid", "try_to_suggest_annotations"]);

// fallback.rs:517 (stub; final signature: decls.ts `Fns_fallback`)
export function compute_unsafe_infer_vars(fcx: FnCtxt, body_def_id: LocalDefId): Map<TyVid, [HirId, Span, UnsafeUseReason]> {
  return unported("rustc_hir_typeck::fallback::compute_unsafe_infer_vars");
}
