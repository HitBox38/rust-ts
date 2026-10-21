// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/named_anon_conflict.rs (lane errrep-region; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/nice_region_error/named_anon_conflict.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/named_anon_conflict.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import type { Diag } from "../../../../rustc_errors/lib.ts";
import { LateParamRegionKind } from "../../../../rustc_middle/ty/region.ts";
import { fold_Ty } from "../../../../rustc_middle/ty/structural_impls.ts";
import { display_Region } from "../../../../rustc_type_ir/ir_print.ts";
import type { ExplicitLifetimeRequired } from "../../../diagnostics.gen.ts";
import { NiceRegionError } from "./mod.ts";

// PORT: other rustc_trait_selection modules are read inside function bodies (init order, errctxt-contract handoff).
function diagnostics(): typeof import("../../../diagnostics.ts") {
  return require("../../../diagnostics.ts");
}
function find_anon_type_mod(): typeof import("./find_anon_type.ts") {
  return require("./find_anon_type.ts");
}

/// When given a `ConcreteFailure` for a function with parameters containing a named region and
/// an anonymous region, emit an descriptive diagnostic error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/named_anon_conflict.rs:15 try_report_named_anon_conflict
NiceRegionError.prototype.try_report_named_anon_conflict = function (this: NiceRegionError): Diag | undefined {
  const regions = this.regions();
  if (regions === undefined) return undefined;
  const [span, sub, sup] = regions;

  // debug!("try_report_named_anon_conflict(sub={:?}, sup={:?}, error={:?})", sub, sup, self.error);

  // Determine whether the sub and sup consist of one named region ('a)
  // and one anonymous (elided) region. If so, find the parameter arg
  // where the anonymous region appears (there must always be one; we
  // only introduced anonymous regions in parameters) as well as a
  // version new_ty of its type where the anonymous region is replaced
  // with the named one.
  let named, anon, anon_param_info, region_info;
  let region_info_;
  let anon_param_info_;
  if (
    sub.is_named(this.tcx()) &&
    (region_info_ = this.tcx().is_suitable_region(this.generic_param_scope, sup)) !== undefined &&
    (anon_param_info_ = this.find_param_with_region(sup, sub)) !== undefined
  ) {
    [named, anon, anon_param_info, region_info] = [sub, sup, anon_param_info_, region_info_];
  } else if (
    sup.is_named(this.tcx()) &&
    (region_info_ = this.tcx().is_suitable_region(this.generic_param_scope, sub)) !== undefined &&
    (anon_param_info_ = this.find_param_with_region(sub, sup)) !== undefined
  ) {
    [named, anon, anon_param_info, region_info] = [sup, sub, anon_param_info_, region_info_];
  } else {
    return undefined; // inapplicable
  }

  // Suggesting to add a `'static` lifetime to a parameter is nearly always incorrect,
  // and can steer users down the wrong path.
  if (named.is_static()) {
    return undefined;
  }

  // debug!("try_report_named_anon_conflict: named = {:?}", named);
  // debug!("try_report_named_anon_conflict: anon_param_info = {:?}", anon_param_info);
  // debug!("try_report_named_anon_conflict: region_info = {:?}", region_info);

  const param = anon_param_info.param;
  const new_ty = anon_param_info.param_ty;
  const new_ty_span_ = anon_param_info.param_ty_span;
  const is_first = anon_param_info.is_first;
  const scope_def_id = region_info.scope;
  const is_impl_item = region_info.is_impl_item;

  if (LateParamRegionKind.is_named(anon_param_info.kind, this.tcx())) {
    /* not an anonymous region */
    // debug!("try_report_named_anon_conflict: not an anonymous region");
    return undefined;
  }

  if (is_impl_item) {
    // debug!("try_report_named_anon_conflict: impl item, bail out");
    return undefined;
  }

  if (find_anon_type_mod().find_anon_type(this.tcx(), this.generic_param_scope, anon) !== undefined && this.is_self_anon(is_first, scope_def_id)) {
    return undefined;
  }
  const orig_ty = anon_param_info.orig_param_ty;
  // Don't suggest naming the outer lifetime when it already appears in the pointee
  // (e.g. `&'a mut Buffer<'a>`); point at borrow splitting instead.
  const k = orig_ty.kind();
  const named_ = named;
  const suggestion_would_alias_lifetime =
    k.$ === "Ref" && k._2 === "Mut" ? this.tcx().any_free_region_meets(k._1, (r) => r === named_, fold_Ty) : false;

  const named_str = display_Region(named);
  const new_ty_span = suggestion_would_alias_lifetime ? undefined : new_ty_span_;
  let err: ExplicitLifetimeRequired;
  const simple_ident = param.pat.simple_ident();
  if (simple_ident !== undefined) {
    err = {
      $: "WithIdent",
      span,
      simple_ident,
      named: named_str,
      new_ty_span,
      new_ty,
      link_nomicon: suggestion_would_alias_lifetime,
    };
  } else {
    err = {
      $: "WithParamType",
      span,
      named: named_str,
      new_ty_span,
      new_ty,
      link_nomicon: suggestion_would_alias_lifetime,
    };
  }
  return this.tcx().sess.dcx().create_err(diagnostics().ExplicitLifetimeRequired_diagnostic(err));
};
