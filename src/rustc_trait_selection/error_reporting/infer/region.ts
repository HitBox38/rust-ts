// Port of compiler/rustc_trait_selection/src/error_reporting/infer/region.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/region.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./region.gen.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_infer_region } from "../../decls.ts";

// error_reporting/infer/region.rs:1145 (stub; lane errrep-region)
export const note_and_explain_region = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::note_and_explain_region")) as Fns_error_reporting_infer_region["note_and_explain_region"];
// error_reporting/infer/region.rs:1172 (stub; lane errrep-region)
export const explain_free_region = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::explain_free_region")) as Fns_error_reporting_infer_region["explain_free_region"];
// error_reporting/infer/region.rs:1185 (stub; lane errrep-region)
export const msg_span_from_named_region = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::msg_span_from_named_region")) as Fns_error_reporting_infer_region["msg_span_from_named_region"];
// error_reporting/infer/region.rs:1246 (stub; lane errrep-region)
export const emit_msg_span = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::emit_msg_span")) as Fns_error_reporting_infer_region["emit_msg_span"];
// error_reporting/infer/region.rs:1262 (stub; lane errrep-region)
export const label_msg_span = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::label_msg_span")) as Fns_error_reporting_infer_region["label_msg_span"];
// error_reporting/infer/region.rs:1279 (stub; lane errrep-region)
export const unexpected_hidden_region_diagnostic = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::unexpected_hidden_region_diagnostic")) as Fns_error_reporting_infer_region["unexpected_hidden_region_diagnostic"];
// error_reporting/infer/region.rs:1369 (stub; lane errrep-region)
export const suggest_precise_capturing = ((): never => unported("rustc_trait_selection::error_reporting::infer::region::suggest_precise_capturing")) as Fns_error_reporting_infer_region["suggest_precise_capturing"];

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::infer::region::TypeErrCtxt", [
  "report_region_errors", "process_errors", "note_region_origin", "report_concrete_failure", "suggest_copy_trait_method_bounds", "report_placeholder_failure", "report_generic_bound_failure", "construct_generic_bound_failure", "suggest_name_region", "report_sub_sup_conflict", "report_inference_failure",
]);
