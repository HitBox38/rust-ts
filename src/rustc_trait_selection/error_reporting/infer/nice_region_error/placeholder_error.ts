// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs (lane errrep-nice-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/placeholder_error.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_error.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./placeholder_error.gen.ts";
import type { DiagArgValue } from "../../../../rustc_error_messages/lib.ts";
import type { PathBuf } from "../../../../rustc_span/lib.ts";
import { unported_methods } from "../../../../rust_ts/stubs.ts";
import type { MutRef } from "../../../../std/mut_ref.ts";
import { unported } from "../../../../std/panic.ts";
import type { Highlighted } from "./placeholder_error.gen.ts";
import { NiceRegionError } from "./mod.ts";

// error_reporting/infer/nice_region_error/placeholder_error.rs:35 (stub) `impl IntoDiagArg for Highlighted<'tcx, T>`
// (`T: Print<FmtPrinter>`: the generated diagnostics call it for `Highlighted<TraitRefPrintOnlyTraitPath>`; the lane picks
// how `T`'s printer reaches it)
export function Highlighted_into_diag_arg<T>(_self: Highlighted<T>, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_trait_selection::error_reporting::infer::nice_region_error::placeholder_error::<Highlighted as IntoDiagArg>::into_diag_arg");
}

unported_methods(NiceRegionError.prototype, "rustc_trait_selection::error_reporting::infer::nice_region_error::placeholder_error::NiceRegionError", [
  "try_report_placeholder_conflict", "try_report_trait_placeholder_mismatch", "report_trait_placeholder_mismatch", "explain_actual_impl_that_was_found",
]);
