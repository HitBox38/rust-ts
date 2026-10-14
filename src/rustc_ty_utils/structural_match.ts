// Port of compiler/rustc_ty_utils/src/structural_match.rs (lane ty-utils).
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { clone_ObligationCause } from "../rustc_middle/traits/mod.gen.ts";
import { ObligationCause, type ObligationCause as ObligationCauseT } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ParamEnv, type Ty } from "../rustc_middle/ty/mod.ts";
import type { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { TypingMode as TypingModeC } from "../rustc_type_ir/infer_ctxt.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";

// ---- PORT(stand-in): rustc_infer / rustc_trait_selection are not ported --------------------------------------------
// Repoint on merge: `tcx.infer_ctxt()` (rustc_infer `TyCtxtInferExt`, lane infcx-contract) and `ObligationCtxt`
// (rustc_trait_selection traits/engine.rs, wave 17). `infer_ctxt` stops as UNPORTED; the code after it is the
// upstream logic typed against these minimal interfaces.
interface InferCtxtBuilder_ {
  build(typing_mode: TypingMode): InferCtxt_;
}
interface InferCtxt_ {
  readonly tcx: TyCtxt;
}
interface FulfillmentErrors_ {
  no_errors(): boolean;
}
interface ObligationCtxt_ {
  register_bound(cause: ObligationCauseT, param_env: ParamEnv, ty: Ty, def_id: DefId): void;
  evaluate_obligations_error_on_ambiguity(): FulfillmentErrors_;
}
function TyCtxt_infer_ctxt(_tcx: TyCtxt): InferCtxtBuilder_ {
  return unported("rustc_infer::infer::TyCtxtInferExt::infer_ctxt (lane infcx-contract)");
}
function ObligationCtxt_new(_infcx: InferCtxt_): ObligationCtxt_ {
  return unported("rustc_trait_selection::traits::ObligationCtxt::new");
}
// ---- end stand-ins ------------------------------------------------------------------------------------------------

/// This method returns true if and only if `adt_ty` itself has been marked as
/// eligible for structural-match: namely, if it implements
/// `StructuralPartialEq` (which is injected by `#[derive(PartialEq)]`).
///
/// Note that this does *not* recursively check if the substructure of `adt_ty`
/// implements the trait.
// rustc: compiler/rustc_ty_utils/src/structural_match.rs:13 has_structural_eq_impl
function has_structural_eq_impl(tcx: TyCtxt, adt_ty: Ty): boolean {
  const infcx = TyCtxt_infer_ctxt(tcx).build(TypingModeC.non_body_analysis());
  const cause = ObligationCause.dummy();

  const ocx = ObligationCtxt_new(infcx);
  // require `#[derive(PartialEq)]`
  const structural_peq_def_id = infcx.tcx.require_lang_item("StructuralPeq", cause.span);
  ocx.register_bound(clone_ObligationCause(cause), ParamEnv.empty(), adt_ty, structural_peq_def_id);

  // We deliberately skip *reporting* fulfillment errors (via
  // `report_fulfillment_errors`), for two reasons:
  //
  // 1. The error messages would mention `std::marker::StructuralPartialEq`
  //    (a trait which is solely meant as an implementation detail
  //    for now), and
  //
  // 2. We are sometimes doing future-incompatibility lints for
  //    now, so we do not want unconditional errors here.
  return ocx.evaluate_obligations_error_on_ambiguity().no_errors();
}

// rustc: compiler/rustc_ty_utils/src/structural_match.rs:34 provide
export function provide(providers: Providers): void {
  providers.has_structural_eq_impl = (tcx, adt_ty) => has_structural_eq_impl(tcx, adt_ty as Ty);
}
