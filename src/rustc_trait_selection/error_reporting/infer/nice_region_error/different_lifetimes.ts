// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/different_lifetimes.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/different_lifetimes.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/different_lifetimes.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { unported_methods } from "../../../../rust_ts/stubs.ts";
import { unported } from "../../../../std/panic.ts";
import type { Fns_error_reporting_infer_nice_region_error_different_lifetimes } from "../../../decls.ts";
import { NiceRegionError } from "./mod.ts";

// error_reporting/infer/nice_region_error/different_lifetimes.rs:133 (stub; lane errrep-region)
export const suggest_adding_lifetime_params = ((): never => unported("rustc_trait_selection::error_reporting::infer::nice_region_error::different_lifetimes::suggest_adding_lifetime_params")) as Fns_error_reporting_infer_nice_region_error_different_lifetimes["suggest_adding_lifetime_params"];

unported_methods(NiceRegionError.prototype, "rustc_trait_selection::error_reporting::infer::nice_region_error::different_lifetimes::NiceRegionError", [
  "try_report_anon_anon_conflict",
]);
