// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/mod.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
// - `NiceRegionError` is a hand class (codegen `hand`): its field `regions` is `regions_` (the method `regions()` has the
//   same name; precedent rustc_hir_typeck `CoerceMany.expected_ty_`). Its methods / associated fns are declared in the
//   crate decls.ts (`declare module "./error_reporting/infer/nice_region_error/mod.ts"`) and assigned by the files of this
//   directory.
// - `pub use find_anon_type::find_anon_type; pub use static_impl_trait::{HirTraitObjectVisitor, TraitObjectVisitor,
//   suggest_new_region_bound}; pub use util::find_param_with_region;`: PORT: not re-exported here (a re-export would
//   evaluate those modules before this one defines `NiceRegionError`, which they extend); import them from their modules.
export * from "./mod.gen.ts";
import type { RegionResolutionError } from "../../../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import type { Region } from "../../../../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { Span } from "../../../../rustc_span/lib.ts";
import { unported_methods } from "../../../../rust_ts/stubs.ts";
import { TypeErrCtxt } from "../../../decls.ts";


// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:34 NiceRegionError
export class NiceRegionError {
  constructor(
    public cx: TypeErrCtxt,
    /// The innermost definition that introduces generic parameters that may be involved in
    /// the region errors we are dealing with.
    public generic_param_scope: LocalDefId,
    public error: RegionResolutionError | undefined,
    // PORT: field `regions` (the method `regions()` has the same name).
    public regions_: [Span, Region, Region] | undefined,
  ) {}
}

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::infer::nice_region_error::TypeErrCtxt", [
  "try_report_nice_region_error",
]);

unported_methods(NiceRegionError.prototype, "rustc_trait_selection::error_reporting::infer::nice_region_error::NiceRegionError", [
  "tcx", "try_report_from_nll", "try_report", "regions",
]);

unported_methods(NiceRegionError, "rustc_trait_selection::error_reporting::infer::nice_region_error::NiceRegionError", ["new", "new_from_span"]);
