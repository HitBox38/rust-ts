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
import type { Diag } from "../../../../rustc_errors/lib.ts";
import type * as hir from "../../../../rustc_hir/lib.ts";
import { HirId_eq } from "../../../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../../../rustc_middle/ty/context.ts";
import type { Region } from "../../../../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import type { AddLifetimeParamsSuggestion, LifetimeMismatchLabels } from "../../../diagnostics.gen.ts";
import { NiceRegionError } from "./mod.ts";

// PORT: other rustc_trait_selection modules are read inside function bodies (init order, errctxt-contract handoff).
function diagnostics(): typeof import("../../../diagnostics.ts") {
  return require("../../../diagnostics.ts");
}
function find_anon_type_mod(): typeof import("./find_anon_type.ts") {
  return require("./find_anon_type.ts");
}

/// Print the error message for lifetime errors when both the concerned regions are anonymous.
///
/// Consider a case where we have
///
/// ```compile_fail
/// fn foo(x: &mut Vec<&u8>, y: &u8) {
///     x.push(y);
/// }
/// ```
///
/// The example gives
///
/// ```text
/// fn foo(x: &mut Vec<&u8>, y: &u8) {
///                    ---      --- these references are declared with different lifetimes...
///     x.push(y);
///     ^ ...but data from `y` flows into `x` here
/// ```
///
/// It has been extended for the case of structs too.
///
/// Consider the example
///
/// ```no_run
/// struct Ref<'a> { x: &'a u32 }
/// ```
///
/// ```text
/// fn foo(mut x: Vec<Ref>, y: Ref) {
///                   ---      --- these structs are declared with different lifetimes...
///     x.push(y);
///     ^ ...but data from `y` flows into `x` here
/// }
/// ```
///
/// It will later be extended to trait objects.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/different_lifetimes.rs:53 try_report_anon_anon_conflict
NiceRegionError.prototype.try_report_anon_anon_conflict = function (this: NiceRegionError): ErrorGuaranteed | undefined {
  const regions = this.regions();
  if (regions === undefined) return undefined;
  const [span, sub, sup] = regions;

  if (this.error !== undefined && this.error.$ === "ConcreteFailure" && this.error._0.$ === "ReferenceOutlivesReferent") {
    // This error doesn't make much sense in this case.
    return undefined;
  }

  // Determine whether the sub and sup consist of both anonymous (elided) regions.
  const sup_info = this.tcx().is_suitable_region(this.generic_param_scope, sup);
  if (sup_info === undefined) return undefined;

  const sub_info = this.tcx().is_suitable_region(this.generic_param_scope, sub);
  if (sub_info === undefined) return undefined;

  const { find_anon_type } = find_anon_type_mod();
  const ty_sup_ = find_anon_type(this.tcx(), this.generic_param_scope, sup);
  if (ty_sup_ === undefined) return undefined;

  const ty_sub_ = find_anon_type(this.tcx(), this.generic_param_scope, sub);
  if (ty_sub_ === undefined) return undefined;

  // debug!("try_report_anon_anon_conflict: found_param1={:?} sup={:?}", ty_sub, sup);
  // debug!("try_report_anon_anon_conflict: found_param2={:?} sub={:?}", ty_sup, sub);

  const [ty_sup, ty_fndecl_sup] = ty_sup_;
  const [ty_sub, ty_fndecl_sub] = ty_sub_;

  const sup_param_info = this.find_param_with_region(sup, sup);
  if (sup_param_info === undefined) return undefined;
  const anon_param_sup = sup_param_info.param;
  const sub_param_info = this.find_param_with_region(sub, sub);
  if (sub_param_info === undefined) return undefined;
  const anon_param_sub = sub_param_info.param;

  const sup_is_ret_type = this.is_return_type_anon(sup_info.scope, sup_info.region_def_id, ty_fndecl_sup);
  const sub_is_ret_type = this.is_return_type_anon(sub_info.scope, sub_info.region_def_id, ty_fndecl_sub);

  // debug!("try_report_anon_anon_conflict: sub_is_ret_type={:?} sup_is_ret_type={:?}", sub_is_ret_type, sup_is_ret_type);

  let labels: LifetimeMismatchLabels;
  if (sup_is_ret_type !== undefined || sub_is_ret_type !== undefined) {
    // `(ret_capture @ Some(ret_span), _) | (_, ret_capture @ Some(ret_span))`
    const ret_capture: Span | undefined = sup_is_ret_type !== undefined ? sup_is_ret_type : sub_is_ret_type;
    const ret_span = ret_capture!;
    const param_span = sup_is_ret_type === ret_capture ? ty_sub.span : ty_sup.span;
    labels = {
      $: "InRet",
      param_span,
      ret_span,
      span,
      label_var1: anon_param_sup.pat.simple_ident(),
    };
  } else {
    labels = {
      $: "Normal",
      hir_equal: HirId_eq(ty_sup.hir_id, ty_sub.hir_id),
      ty_sup: ty_sup.span,
      ty_sub: ty_sub.span,
      span,
      sup: anon_param_sup.pat.simple_ident(),
      sub: anon_param_sub.pat.simple_ident(),
    };
  }

  const suggestion: AddLifetimeParamsSuggestion = {
    tcx: this.tcx(),
    sub,
    ty_sup,
    ty_sub,
    add_note: true,
    generic_param_scope: this.generic_param_scope,
  };
  const err = { span, labels, suggestion };
  const reported = this.tcx().dcx().emit_err(diagnostics().LifetimeMismatch_diagnostic(err));
  return reported;
};

/// Currently only used in rustc_borrowck, probably should be
/// removed in favour of public_errors::AddLifetimeParamsSuggestion
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/different_lifetimes.rs:133 suggest_adding_lifetime_params
export function suggest_adding_lifetime_params(
  tcx: TyCtxt,
  err: Diag,
  generic_param_scope: LocalDefId,
  sub: Region,
  ty_sup: hir.Ty,
  ty_sub: hir.Ty,
): void {
  const suggestion: AddLifetimeParamsSuggestion = {
    tcx,
    sub,
    ty_sup,
    ty_sub,
    add_note: false,
    generic_param_scope,
  };
  diagnostics().AddLifetimeParamsSuggestion_add_to_diag(suggestion, err);
}
