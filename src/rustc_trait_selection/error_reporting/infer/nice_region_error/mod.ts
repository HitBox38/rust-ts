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
import type { Diag } from "../../../../rustc_errors/lib.ts";
import type { RegionResolutionError } from "../../../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import { SubregionOrigin } from "../../../../rustc_infer/infer/mod.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Region } from "../../../../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
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

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:25 try_report_nice_region_error
TypeErrCtxt.prototype.try_report_nice_region_error = function (
  this: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  error: RegionResolutionError,
): ErrorGuaranteed | undefined {
  // PORT: `error.clone()`: `RegionResolutionError` values are never mutated in place.
  return NiceRegionError.new(this, generic_param_scope, error).try_report();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:44 new
(NiceRegionError as unknown as { new: typeof NiceRegionError.new }).new = function (
  cx: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  error: RegionResolutionError,
): NiceRegionError {
  return new NiceRegionError(cx, generic_param_scope, error, undefined);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:52 new_from_span
(NiceRegionError as unknown as { new_from_span: typeof NiceRegionError.new_from_span }).new_from_span = function (
  cx: TypeErrCtxt,
  generic_param_scope: LocalDefId,
  span: Span,
  sub: Region,
  sup: Region,
): NiceRegionError {
  return new NiceRegionError(cx, generic_param_scope, undefined, [span, sub, sup]);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:62 tcx
NiceRegionError.prototype.tcx = function (this: NiceRegionError): TyCtxt {
  return this.cx.tcx;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:66 try_report_from_nll
NiceRegionError.prototype.try_report_from_nll = function (this: NiceRegionError): Diag | undefined {
  // Due to the improved diagnostics returned by the MIR borrow checker, only a subset of
  // the nice region errors are required when running under the MIR borrow checker.
  return this.try_report_named_anon_conflict() ?? this.try_report_placeholder_conflict() ?? this.try_report_placeholder_relation();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:74 try_report
NiceRegionError.prototype.try_report = function (this: NiceRegionError): ErrorGuaranteed | undefined {
  const diag = this.try_report_from_nll();
  return (
    (diag !== undefined ? diag.emit_err() : undefined) ??
    this.try_report_impl_not_conforming_to_trait() ??
    this.try_report_anon_anon_conflict() ??
    this.try_report_static_impl_trait() ??
    this.try_report_mismatched_static_lifetime()
  );
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mod.rs:83 regions
NiceRegionError.prototype.regions = function (this: NiceRegionError): [Span, Region, Region] | undefined {
  const error = this.error;
  const regions = this.regions_;
  if (error !== undefined && error.$ === "ConcreteFailure" && regions === undefined) {
    const [origin, sub, sup] = [error._0, error._1, error._2];
    return [SubregionOrigin.span(origin), sub, sup];
  } else if (error !== undefined && error.$ === "SubSupConflict" && regions === undefined) {
    const [origin, sub, sup] = [error._2, error._3, error._5];
    return [SubregionOrigin.span(origin), sub, sup];
  } else if (error === undefined && regions !== undefined) {
    const [span, sub, sup] = regions;
    return [span, sub, sup];
  } else {
    return undefined;
  }
};
