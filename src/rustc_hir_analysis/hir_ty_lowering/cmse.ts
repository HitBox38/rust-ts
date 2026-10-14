// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs (STUB, lane hir-ty-lowering-d):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LayoutError, TyAndLayout } from "../../rustc_middle/ty/decls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import type { Result } from "../../std/result.ts";
import type { LayoutCx } from "../decls.ts";
import { unported } from "../../std/panic.ts";

// hir_ty_lowering/cmse.rs:13 (stub; final signature: decls.ts `Fns_hir_ty_lowering_cmse`)
export function validate_cmse_abi(_tcx: TyCtxt, _dcx: DiagCtxtHandle, _hir_id: HirId, _abi: ExternAbi, _fn_sig: PolyFnSig): void {
  return unported("rustc_hir_analysis::hir_ty_lowering::cmse::validate_cmse_abi");
}

// hir_ty_lowering/cmse.rs:73 (stub; final signature: decls.ts `Fns_hir_ty_lowering_cmse`)
export function is_valid_cmse_inputs(_tcx: TyCtxt, _dcx: DiagCtxtHandle, _fn_sig: PolyFnSig, _fn_decl: hir.FnDecl, _abi: ExternAbi): Result<undefined, [Span, LayoutError]> {
  return unported("rustc_hir_analysis::hir_ty_lowering::cmse::is_valid_cmse_inputs");
}

// hir_ty_lowering/cmse.rs:119 (stub; final signature: decls.ts `Fns_hir_ty_lowering_cmse`)
export function is_valid_cmse_output(_tcx: TyCtxt, _dcx: DiagCtxtHandle, _fn_sig: PolyFnSig, _fn_decl: hir.FnDecl, _abi: ExternAbi): Result<undefined, LayoutError> {
  return unported("rustc_hir_analysis::hir_ty_lowering::cmse::is_valid_cmse_output");
}

// hir_ty_lowering/cmse.rs:162 (stub; final signature: decls.ts `Fns_hir_ty_lowering_cmse`)
export function is_valid_cmse_output_layout(_cx: LayoutCx, _layout: TyAndLayout): boolean {
  return unported("rustc_hir_analysis::hir_ty_lowering::cmse::is_valid_cmse_output_layout");
}

// hir_ty_lowering/cmse.rs:178 (stub; final signature: decls.ts `Fns_hir_ty_lowering_cmse`)
export function should_emit_layout_error(_abi: ExternAbi, _layout_err: LayoutError): boolean {
  return unported("rustc_hir_analysis::hir_ty_lowering::cmse::should_emit_layout_error");
}
