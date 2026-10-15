// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs (lane errrep-nice-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/static_impl_trait.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/static_impl_trait.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./static_impl_trait.gen.ts";
import { unported_methods } from "../../../../rust_ts/stubs.ts";
import { unported } from "../../../../std/panic.ts";
import type { Fns_error_reporting_infer_nice_region_error_static_impl_trait } from "../../../decls.ts";
import { NiceRegionError } from "./mod.ts";

/** PORT(hand type): `pub struct TraitObjectVisitor(pub FxIndexSet<DefId>)` (static_impl_trait.rs:403), a `TypeVisitor`: the class is written by lane errrep-nice-region. */
export type TraitObjectVisitor = unknown;

/** PORT(hand type): `pub struct HirTraitObjectVisitor<'a>(pub &'a mut Vec<Span>, pub DefId)` (static_impl_trait.rs:419), an intravisit `Visitor`: lane errrep-nice-region. */
export type HirTraitObjectVisitor = unknown;

// error_reporting/infer/nice_region_error/static_impl_trait.rs:137 (stub; lane errrep-nice-region)
export const suggest_new_region_bound = ((): never => unported("rustc_trait_selection::error_reporting::infer::nice_region_error::static_impl_trait::suggest_new_region_bound")) as Fns_error_reporting_infer_nice_region_error_static_impl_trait["suggest_new_region_bound"];
// error_reporting/infer/nice_region_error/static_impl_trait.rs:298 (stub; lane errrep-nice-region)
export const make_elided_region_spans_suggs = ((): never => unported("rustc_trait_selection::error_reporting::infer::nice_region_error::static_impl_trait::make_elided_region_spans_suggs")) as Fns_error_reporting_infer_nice_region_error_static_impl_trait["make_elided_region_spans_suggs"];

unported_methods(NiceRegionError.prototype, "rustc_trait_selection::error_reporting::infer::nice_region_error::static_impl_trait::NiceRegionError", [
  "try_report_static_impl_trait",
]);

unported_methods(NiceRegionError, "rustc_trait_selection::error_reporting::infer::nice_region_error::static_impl_trait::NiceRegionError", [
  "get_impl_ident_and_self_ty_from_trait",
]);
