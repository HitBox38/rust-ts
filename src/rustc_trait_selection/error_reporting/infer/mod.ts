// Port of compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs (lane errrep-infer-a; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/mod.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
export * from "./mod.gen.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import type { ObligationCauseFailureCode, TypeErrorAdditionalDiags } from "../../diagnostics.gen.ts";
import type { FailureCode } from "./mod.gen.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_infer_mod } from "../../decls.ts";

/** PORT(hand type): `struct SameTypeModuloInfer<'a, 'tcx>(&'a InferCtxt<'tcx>)` (mod.rs:2476), a `TypeRelation`: the class is written by lane errrep-infer-a. */
export type SameTypeModuloInfer = unknown;

// error_reporting/infer/mod.rs:97 (stub; lane errrep-infer-a)
export const escape_literal = ((): never => unported("rustc_trait_selection::error_reporting::infer::escape_literal")) as Fns_error_reporting_infer_mod["escape_literal"];

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::infer::TypeErrCtxt", [
  "normalize_fn_sig", "type_error_struct_with_diag", "report_mismatched_types", "report_mismatched_consts", "check_and_note_conflicting_crates", "suggest_param_env_shadowing", "note_error_origin", "should_deref_suggestion_on_mismatch", "highlight_outer", "cmp_type_arg", "push_comma", "cmp_fn_sig", "cmp_traits", "lifetime_display", "compare_generics", "recurse", "maybe_highlight", "cmp", "note_type_err", "type_error_additional_suggestions", "suggest_specify_actual_length", "check_on_type_error_attribute", "format_on_type_error_notes", "report_and_explain_type_error", "simplify_pin_macro_arg_ty_mismatch", "suggest_wrap_to_build_a_tuple", "values_str", "expected_found_str_term", "expected_found_str", "is_try_conversion", "same_type_modulo_infer",
]);

// `#[extension(pub trait ObligationCauseExt<'tcx>)] impl<'tcx> ObligationCause<'tcx>` (declared in the crate decls.ts on
// rustc_middle's `ObligationCause`): the methods are on `ObligationCause.prototype`. Ported here by lane errctxt-contract
// (the first stop of `check_function_signature` errors).

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2572 as_failure_code
ObligationCause.prototype.as_failure_code = function (this: ObligationCause, terr: TypeError): FailureCode {
  const code = this.code_();
  switch (code.$) {
    case "IfExpressionWithNoElse":
      return "Error0317";
    case "MainFunctionType":
      return "Error0580";
    case "CompareImplItem":
    case "MatchExpressionArm":
    case "IfExpression":
    case "LetElse":
    case "LangFunctionType":
    case "IntrinsicType":
    case "MethodReceiver":
      return "Error0308";

    // In the case where we have no more specific thing to
    // say, also take a look at the error code, maybe we can
    // tailor to that.
    default:
      if (terr.$ === "CyclicTy" && (terr._0.is_closure() || terr._0.is_coroutine() || terr._0.is_coroutine_closure())) {
        return "Error0644";
      } else if (terr.$ === "IntrinsicCast" || terr.$ === "ForceInlineCast") {
        return "Error0308";
      } else {
        return "Error0308";
      }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2599 as_failure_code_diag
ObligationCause.prototype.as_failure_code_diag = function (
  this: ObligationCause,
  terr: TypeError,
  span: Span,
  subdiags: TypeErrorAdditionalDiags[],
): ObligationCauseFailureCode {
  const code = this.code_();
  if (code.$ === "CompareImplItem" && code.kind.$ === "Fn") {
    return { $: "MethodCompat", span, subdiags };
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Type") {
    return { $: "TypeCompat", span, subdiags };
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Const") {
    return { $: "ConstCompat", span, subdiags };
  } else if (code.$ === "BlockTailExpression" && code._1.$ === "TryDesugar") {
    return { $: "TryCompat", span, subdiags };
  } else if (code.$ === "MatchExpressionArm") {
    const source = code._0.source;
    switch (source.$) {
      case "TryDesugar":
        return { $: "TryCompat", span, subdiags };
      default:
        return { $: "MatchCompat", span, subdiags };
    }
  } else if (code.$ === "IfExpression") {
    return { $: "IfElseDifferent", span, subdiags };
  } else if (code.$ === "IfExpressionWithNoElse") {
    return { $: "NoElse", span };
  } else if (code.$ === "LetElse") {
    return { $: "NoDiverge", span, subdiags };
  } else if (code.$ === "MainFunctionType") {
    return { $: "FnMainCorrectType", span };
  } else if (code.$ === "LangFunctionType") {
    const lang_item_name = code._0;
    return { $: "FnLangCorrectType", span, subdiags, lang_item_name };
  } else if (code.$ === "IntrinsicType") {
    return { $: "IntrinsicCorrectType", span, subdiags };
  } else if (code.$ === "MethodReceiver") {
    return { $: "MethodCorrectType", span, subdiags };
  } else {
    // In the case where we have no more specific thing to
    // say, also take a look at the error code, maybe we can
    // tailor to that.
    if (terr.$ === "CyclicTy" && (terr._0.is_closure() || terr._0.is_coroutine() || terr._0.is_coroutine_closure())) {
      return { $: "ClosureSelfref", span };
    } else if (terr.$ === "ForceInlineCast") {
      return { $: "CantCoerceForceInline", span, subdiags };
    } else if (terr.$ === "IntrinsicCast") {
      return { $: "CantCoerceIntrinsic", span, subdiags };
    } else {
      return { $: "Generic", span, subdiags };
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/mod.rs:2668 as_requirement_str
ObligationCause.prototype.as_requirement_str = function (this: ObligationCause): string {
  const code = this.code_();
  if (code.$ === "CompareImplItem" && code.kind.$ === "Fn") {
    return "method type is compatible with trait";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Type") {
    return "associated type is compatible with trait";
  } else if (code.$ === "CompareImplItem" && code.kind.$ === "Const") {
    return "const is compatible with trait";
  } else if (code.$ === "MainFunctionType") {
    return "`main` function has the correct type";
  } else if (code.$ === "LangFunctionType") {
    return "lang item function has the correct type";
  } else if (code.$ === "IntrinsicType") {
    return "intrinsic has the correct type";
  } else if (code.$ === "MethodReceiver") {
    return "method receiver has the correct type";
  } else {
    return "types are compatible";
  }
};
