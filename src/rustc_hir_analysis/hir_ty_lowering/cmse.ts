// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs (lane hir-ty-lowering-d).
//
// The free fns keep the signatures of decls.ts `Fns_hir_ty_lowering_cmse`.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
// PORT: layouts are M4. `LayoutError`, `TyAndLayout` and `LayoutCx` are pending types (ty/decls.ts, ../decls.ts); this file
// reads `LayoutError` through a local view in its PORTING §5 shape (`LayoutErrorView`, ty/layout.rs:253) and reaches the
// layout data only through the stand-ins at the end, which stop as UNPORTED. `tcx.layout_of` is the query (its provider
// is not ported, so it stops first).
// PORT: `u64` sizes / alignments are `number`: cmse ABIs exist only on 32-bit Armv8-M targets, so they stay < 2^53.
import { display_ExternAbi, type ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type DiagCtxtHandle, E0781, struct_span_code_err } from "../../rustc_errors/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { FnRetTy, Node as HirNode } from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LayoutError, TyAndLayout } from "../../rustc_middle/ty/decls.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { panic, unported } from "../../std/panic.ts";
import type { LayoutCx } from "../decls.ts";
import {
  CmseGeneric_diagnostic,
  CmseImplTrait_diagnostic,
  CmseInputsStackSpill_diagnostic,
  CmseOutputStackSpill_diagnostic,
} from "../diagnostics.ts";

/// Check conditions on inputs and outputs that the cmse ABIs impose: arguments and results MUST be
/// returned via registers (i.e. MUST NOT spill to the stack). LLVM will also validate these
/// conditions, but by checking them here rustc can emit nicer error messages.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs:13 validate_cmse_abi
export function validate_cmse_abi(tcx: TyCtxt, dcx: DiagCtxtHandle, hir_id: HirId, abi: ExternAbi, fn_sig: PolyFnSig): void {
  let fn_decl: hir.FnDecl;
  switch (abi.$) {
    case "CmseNonSecureCall": {
      const node = tcx.hir_node(hir_id);
      if (node.$ === "Ty" && node._0.kind.$ === "FnPtr") {
        fn_decl = node._0.kind._0.decl;
      } else {
        const parent = tcx.parent_hir_node(hir_id);
        const span = parent.$ === "Item" && parent._0.kind.$ === "ForeignMod" ? parent._0.span : tcx.hir_span(hir_id);
        struct_span_code_err(dcx, span, E0781, 'the `"cmse-nonsecure-call"` ABI is only allowed on function pointers').emit();
        return;
      }
      break;
    }
    case "CmseNonSecureEntry": {
      const sig = HirNode.fn_sig(tcx.hir_node(hir_id));
      if (sig === undefined) {
        // might happen when this ABI is used incorrectly. That will be handled elsewhere
        return;
      }
      const decl = sig.decl;

      // An `extern "cmse-nonsecure-entry"` function cannot be c-variadic. We run
      // into https://github.com/rust-lang/rust/issues/132142 if we don't explicitly bail.
      if (decl.c_variadic()) {
        return;
      }

      fn_decl = decl;
      break;
    }
    default:
      return;
  }

  const inputs = is_valid_cmse_inputs(tcx, dcx, fn_sig, fn_decl, abi);
  if (inputs.$ === "Err") {
    const [span, layout_err] = inputs._0;
    if (should_emit_layout_error(abi, layout_err)) {
      dcx.emit_err(CmseGeneric_diagnostic({ span, abi }));
    }
  }

  const output = is_valid_cmse_output(tcx, dcx, fn_sig, fn_decl, abi);
  if (output.$ === "Err") {
    const layout_err = output._0;
    if (should_emit_layout_error(abi, layout_err)) {
      dcx.emit_err(CmseGeneric_diagnostic({ span: FnRetTy.span(fn_decl.output), abi }));
    }
  }
}

/// Returns whether the inputs will fit into the available registers
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs:73 is_valid_cmse_inputs
export function is_valid_cmse_inputs(
  tcx: TyCtxt,
  dcx: DiagCtxtHandle,
  fn_sig_: PolyFnSig,
  fn_decl: hir.FnDecl,
  abi: ExternAbi,
): Result<undefined, [Span, LayoutError]> {
  let accum = 0;
  const excess_argument_spans: Span[] = [];

  // this type is only used for layout computation, which does not rely on regions
  let fn_sig = tcx.instantiate_bound_regions_with_erased(fn_sig_, fold_FnSig);
  fn_sig = tcx.erase_and_anonymize_regions(fn_sig, fold_FnSig);

  const inputs = FnSig.inputs(fn_sig);
  const n = Math.min(inputs.length, fn_decl.inputs.length);
  for (let i = 0; i < n; i++) {
    const ty = inputs[i]!;
    const hir_ty = fn_decl.inputs[i]!;
    if (TypeVisitableExt.has_infer_types(ty, fold_Ty)) {
      const err: LayoutErrorView = { $: "Unknown", _0: ty };
      return Err([hir_ty.span, /* tcx.arena.alloc */ err as unknown as LayoutError]);
    }

    const layout_r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty)) as Result<TyAndLayout, LayoutError>;
    if (layout_r.$ === "Err") return Err([hir_ty.span, layout_r._0]);
    const layout = layout_r._0;

    const align = TyAndLayout_layout_align_bytes(layout);
    const size = TyAndLayout_layout_size_bytes(layout);

    accum += size;
    accum = next_multiple_of(accum, Math.max(4, align));

    // i.e. exceeds 4 32-bit registers
    if (accum > 16) {
      excess_argument_spans.push(hir_ty.span);
    }
  }

  if (excess_argument_spans.length !== 0) {
    // fn f(x: u32, y: u32, z: u32, w: u16, q: u16) -> u32,
    //                                      ^^^^^^
    dcx.emit_err(CmseInputsStackSpill_diagnostic({ spans: excess_argument_spans, abi }));
  }

  return Ok(undefined);
}

/// Returns whether the output will fit into the available registers
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs:119 is_valid_cmse_output
export function is_valid_cmse_output(
  tcx: TyCtxt,
  dcx: DiagCtxtHandle,
  fn_sig_: PolyFnSig,
  fn_decl: hir.FnDecl,
  abi: ExternAbi,
): Result<undefined, LayoutError> {
  // this type is only used for layout computation, which does not rely on regions
  let fn_sig = tcx.instantiate_bound_regions_with_erased(fn_sig_, fold_FnSig);
  fn_sig = tcx.erase_and_anonymize_regions(fn_sig, fold_FnSig);
  const return_type = FnSig.output(fn_sig);

  // `impl Trait` is already disallowed with `cmse-nonsecure-call`, because that ABI is only
  // allowed on function pointers, and function pointers cannot contain `impl Trait` in their
  // signature.
  //
  // Here we explicitly disallow `impl Trait` in the `cmse-nonsecure-entry` return type too, to
  // prevent query cycles when calculating the layout. This ABI is meant to be used with
  // `#[no_mangle]` or similar, so generics in the type really don't make sense.
  //
  // see also https://github.com/rust-lang/rust/issues/147242.
  if (abi.$ === "CmseNonSecureEntry" && TypeVisitableExt.has_opaque_types(return_type, fold_Ty)) {
    dcx.emit_err(CmseImplTrait_diagnostic({ span: FnRetTy.span(fn_decl.output), abi }));
    return Ok(undefined);
  }

  if (TypeVisitableExt.has_infer_types(return_type, fold_Ty)) {
    const err: LayoutErrorView = { $: "Unknown", _0: return_type };
    return Err(/* tcx.arena.alloc */ err as unknown as LayoutError);
  }

  const typing_env = TypingEnv.fully_monomorphized();
  const layout_r = tcx.layout_of(typing_env.as_query_input(return_type)) as Result<TyAndLayout, LayoutError>;
  if (layout_r.$ === "Err") return layout_r;
  const layout = layout_r._0;
  const layout_cx = LayoutCx_new(tcx, typing_env);

  if (!is_valid_cmse_output_layout(layout_cx, layout)) {
    dcx.emit_err(CmseOutputStackSpill_diagnostic({ span: FnRetTy.span(fn_decl.output), abi }));
  }

  return Ok(undefined);
}

/// Returns whether the output will fit into the available registers
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs:162 is_valid_cmse_output_layout
export function is_valid_cmse_output_layout(cx: LayoutCx, layout: TyAndLayout): boolean {
  const size = TyAndLayout_layout_size_bytes(layout);

  if (size <= 4) {
    return true;
  } else if (size !== 8) {
    return false;
  }

  // Accept (transparently wrapped) scalar 64-bit primitives.
  const kind = TyAndLayout_peel_transparent_wrappers_from_non_1zst_ty(layout, cx).kind();
  return (kind.$ === "Int" && kind._0 === "I64") || (kind.$ === "Uint" && kind._0 === "U64") || (kind.$ === "Float" && kind._0 === "F64");
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/cmse.rs:178 should_emit_layout_error
export function should_emit_layout_error(abi: ExternAbi, layout_err_: LayoutError): boolean {
  // use LayoutError::*;
  const layout_err = layout_err_ as unknown as LayoutErrorView;

  switch (layout_err.$) {
    case "TooGeneric": {
      const ty = layout_err._0;
      switch (abi.$) {
        case "CmseNonSecureCall":
          // prevent double reporting of this error
          return !TypeVisitableExt.has_opaque_types(ty, fold_Ty);
        case "CmseNonSecureEntry":
          return true;
        default:
          return panic(`invalid ABI: ${display_ExternAbi(abi)}`);
      }
    }
    case "Unknown":
    case "SizeOverflow":
    case "InvalidSimd":
    case "NormalizationFailure":
    case "ReferencesError":
      return false; // not our job to report these
  }
}

// ---- local helpers (not ports) ----

/**
 * rustc_middle ty/layout.rs:253 `enum LayoutError<'tcx>` as read here (PORTING §5 shape). PORT: a local view of the pending
 * `LayoutError`; the payloads this file does not read are `unknown`.
 */
type LayoutErrorView =
  | { readonly $: "Unknown"; _0: Ty }
  | { readonly $: "SizeOverflow"; _0: Ty }
  | { readonly $: "InvalidSimd"; ty: Ty; kind: unknown }
  | { readonly $: "TooGeneric"; _0: Ty }
  | { readonly $: "NormalizationFailure"; _0: Ty; _1: unknown }
  | { readonly $: "ReferencesError"; _0: ErrorGuaranteed };

/** `u64::next_multiple_of` (panics on a zero `rhs`, as the `Ord::max(4, ..)` argument never is). */
function next_multiple_of(lhs: number, rhs: number): number {
  const r = lhs % rhs;
  return r === 0 ? lhs : lhs + (rhs - r);
}

// ==== stand-ins (PORT: M4 layout, not ported). Root replaces each when rustc_middle ty/layout.rs / rustc_abi land. ====

/** `layout.layout.align().bytes()` (rustc_abi `Layout::align`, `Align::bytes`). */
function TyAndLayout_layout_align_bytes(_layout: TyAndLayout): number {
  return unported("rustc_abi::Layout::align");
}

/** `layout.layout.size().bytes()` (rustc_abi `Layout::size`, `Size::bytes`). */
function TyAndLayout_layout_size_bytes(_layout: TyAndLayout): number {
  return unported("rustc_abi::Layout::size");
}

/** `layout.peel_transparent_wrappers_from_non_1zst(&cx).ty` (rustc_abi layout/ty.rs:268). */
function TyAndLayout_peel_transparent_wrappers_from_non_1zst_ty(_layout: TyAndLayout, _cx: LayoutCx): Ty {
  return unported("rustc_abi::TyAndLayout::peel_transparent_wrappers_from_non_1zst");
}

/** `LayoutCx::new(tcx, typing_env)` (rustc_middle ty/layout.rs:323). */
function LayoutCx_new(_tcx: TyCtxt, _typing_env: TypingEnv): LayoutCx {
  return unported("rustc_middle::ty::layout::LayoutCx::new");
}
