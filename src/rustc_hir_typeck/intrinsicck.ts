// Port of compiler/rustc_hir_typeck/src/intrinsicck.rs (lane typeck-euv).
//
// The layout parts use rustc_middle ty/layout.rs's `SizeSkeleton` / `LayoutError` (repointed from stand-ins by
// merge-layout).
// PORT: `trace!` is tracing only and not ported.
// Init order: top-level code here touches only ./decls.ts and other crates.
import { debug_Size, Primitive } from "../rustc_abi/lib.ts";
import { into_MultiSpan } from "../rustc_error_messages/lib.ts";
import { E0512, E0591, struct_span_code_err } from "../rustc_errors/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { VariantIdx } from "../rustc_middle/ty/decls.ts";
import { display_LayoutError, type LayoutError, SizeSkeleton } from "../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId as LocalDefIdC, type LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { fold_tuple2, set_aliases_to_non_rigid } from "../rustc_type_ir/fold.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, unported } from "../std/panic.ts";
import { bug } from "../rustc_span/macros.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";

/// If the type is `Option<T>`, it will return `T`, otherwise
/// the type itself. Works on most `Option`-like types.
// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:16 unpack_option_like
export function unpack_option_like(tcx: TyCtxt, ty: Ty): Ty {
  const kind = ty.kind();
  if (kind.$ !== "Adt") return ty;
  const def = kind._0;
  const args = kind._1;

  if (def.variants().length === 2 && !def.repr().c() && def.repr().int === undefined) {
    let data_idx: VariantIdx;

    const one = 1 as VariantIdx;
    const zero = 0 as VariantIdx;

    if (def.variant(zero).fields.length === 0) {
      data_idx = one;
    } else if (def.variant(one).fields.length === 0) {
      data_idx = zero;
    } else {
      return ty;
    }

    if (def.variant(data_idx).fields.length === 1) {
      return Unnormalized.skip_norm_wip(def.variant(data_idx).single_field().ty(tcx, args));
    }
  }

  return ty;
}

/// Try to display a sensible error with as much information as possible.
// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:42 skeleton_string
export function skeleton_string(ty: Ty, sk: Result<SizeSkeleton, LayoutError>): string {
  if (sk.$ === "Ok" && sk._0.$ === "Pointer") {
    const { tail } = sk._0;
    return `pointer to \`${display_Ty(tail)}\``;
  } else if (sk.$ === "Ok" && sk._0.$ === "Known") {
    const size = sk._0._0;
    // PORT: `u128::from(size.bytes()).checked_mul(8)` cannot overflow a u128 for a u64 byte count; kept as a `bigint`
    // check against `u128::MAX`.
    const v = BigInt(size.bytes()) * 8n;
    if (v <= (1n << 128n) - 1n) {
      return `${v} bits`;
    } else {
      // `u128` should definitely be able to hold the size of different architectures
      // larger sizes should be reported as error `are too big for the target architecture`
      // otherwise we have a bug somewhere
      return bug(`${debug_Size(size, PLAIN)} overflow for u128`);
    }
  } else if (sk.$ === "Err" && sk._0.$ === "TooGeneric") {
    const bad = sk._0._0;
    if (bad === ty) {
      return "this type does not have a fixed size";
    } else {
      return `size can vary because of ${display_Ty(bad)}`;
    }
  } else {
    const err = (sk as { $: "Err"; _0: LayoutError })._0;
    return display_LayoutError(err);
  }
}

// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:69 check_transmute
export function check_transmute(tcx: TyCtxt, typing_env: TypingEnv, from_: Unnormalized<Ty>, to_: Unnormalized<Ty>, hir_id: HirId): Result<undefined, ErrorGuaranteed> {
  const span = tcx.hir_span(hir_id);
  const normalize = (ty: Unnormalized<Ty>): Result<Ty, ErrorGuaranteed> => {
    const r = tcx.try_normalize_erasing_regions(typing_env, ty, fold_Ty);
    if (r.$ === "Ok") return r;
    const err: LayoutError = { $: "NormalizationFailure", _0: Unnormalized.skip_normalization(ty), _1: r._0 };
    return Err(tcx.dcx().span_err(span, display_LayoutError(err)));
  };

  const from = normalize(from_);
  if (from.$ === "Err") return from;
  const to = normalize(to_);
  if (to.$ === "Err") return to;

  // Transmutes that are only changing lifetimes are always ok.
  if (from._0 === to._0) {
    return Ok(undefined);
  }

  const sk_from = SizeSkeleton.compute(from._0, tcx, typing_env, span);
  const sk_to = SizeSkeleton.compute(to._0, tcx, typing_env, span);

  // Check for same size using the skeletons.
  if (sk_from.$ === "Ok" && sk_to.$ === "Ok") {
    if (SizeSkeleton.same_size(sk_from._0, sk_to._0)) {
      return Ok(undefined);
    }

    // Special-case transmuting from `typeof(function)` and
    // `Option<typeof(function)>` to present a clearer error.
    const from_ = unpack_option_like(tcx, from._0);
    const sk = sk_to._0;
    if (
      from_.kind().$ === "FnDef" &&
      sk.$ === "Known" &&
      sk._0.bytes() === Primitive.size({ $: "Pointer", _0: tcx.data_layout().instruction_address_space }, tcx).bytes()
    ) {
      struct_span_code_err(tcx.sess.dcx(), span, E0591, "can't transmute zero-sized type")
        .with_note(`source type: ${display_Ty(from_)}`)
        .with_note(`target type: ${display_Ty(to._0)}`)
        .with_help("cast with `as` to a pointer instead")
        .emit();
      return Ok(undefined);
    }
  }

  const err = struct_span_code_err(tcx.sess.dcx(), span, E0512, "cannot transmute between types of different sizes, or dependently-sized types");
  if (from._0 === to._0) {
    err.note(`\`${display_Ty(from._0)}\` does not have a fixed size`);
    return Err(err.emit_err());
  } else {
    err.note(`source type: \`${display_Ty(from._0)}\` (${skeleton_string(from._0, sk_from)})`);
    err.note(`target type: \`${display_Ty(to._0)}\` (${skeleton_string(to._0, sk_to)})`);
    return Err(err.emit_err());
  }
}

// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:137 check_offload
export function check_offload(tcx: TyCtxt, typing_env: TypingEnv, kernel_ty: Ty, args_ty: Ty, ret_ty: Ty, hir_id: HirId): Result<undefined, ErrorGuaranteed> {
  const span = tcx.hir_span(hir_id);
  const kernel_kind = kernel_ty.kind();
  if (kernel_kind.$ !== "FnDef") {
    const guar = tcx.sess
      .dcx()
      .struct_span_err(span, `expected a function item for the offload kernel, found \`${display_Ty(kernel_ty)}\``)
      .emit_err();
    return Err(guar);
  }
  const kernel_def_id = kernel_kind._0;
  const kernel_args = kernel_kind._1;

  const kernel_sig_poly = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(tcx.fn_sig(kernel_def_id) as EarlyBinder<PolyFnSig>, tcx, Binder.skip_binder(kernel_args), fold_Binder(fold_FnSig)),
  );
  const kernel_sig = tcx.instantiate_bound_regions_with_erased(kernel_sig_poly, fold_FnSig);

  const args_kind = args_ty.kind();
  if (args_kind.$ !== "Tuple") {
    const guar = tcx.sess
      .dcx()
      .struct_span_err(span, `expected a tuple for the offload arguments, found \`${display_Ty(args_ty)}\``)
      .emit_err();
    return Err(guar);
  }
  const tuple_fields = args_kind._0;

  if (FnSig.inputs(kernel_sig).length !== tuple_fields.length) {
    const guar = tcx.sess
      .dcx()
      .struct_span_err(span, `offload kernel expects ${FnSig.inputs(kernel_sig).length} arguments, but ${tuple_fields.length} arguments were provided`)
      .emit_err();
    return Err(guar);
  }

  const normalize = (ty: Ty): Ty => {
    const r = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
    if (r.$ === "Ok") {
      return r._0;
    } else {
      return Ty.new_error_with_message(tcx, into_MultiSpan(span), `tried to normalize non-wf type ${debug_Ty(ty, PRETTY)} in check_offload`);
    }
  };

  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);

  const inputs = FnSig.inputs(kernel_sig);
  const n = Math.min(inputs.length, tuple_fields.length);
  for (let i = 0; i < n; i++) {
    const input_ty = inputs[i]!;
    const arg_ty = tuple_fields[i]!;
    const norm_input_ty = normalize(input_ty);
    const norm_arg_ty = normalize(arg_ty);
    if (norm_input_ty !== norm_arg_ty) {
      const guar = tcx.sess
        .dcx()
        .struct_span_err(span, `type mismatch in offload kernel argument ${i}: expected \`${display_Ty(norm_input_ty)}\`, found \`${display_Ty(norm_arg_ty)}\``)
        .emit_err();
      result = Err(guar);
    }
  }

  const norm_kernel_ret = normalize(FnSig.output(kernel_sig));
  const norm_offload_ret = normalize(ret_ty);
  if (norm_kernel_ret !== norm_offload_ret) {
    const guar = tcx.sess
      .dcx()
      .struct_span_err(
        span,
        `offload kernel return type mismatch: kernel returns \`${display_Ty(norm_kernel_ret)}\`, but offload call expects \`${display_Ty(norm_offload_ret)}\``,
      )
      .emit_err();
    result = Err(guar);
  }

  return result;
}

/** `Result::and` (`self` is `Err` -> `self`, else `res`; `res` is evaluated by the caller either way). */
function result_and<E>(self_: Result<undefined, E>, res: Result<undefined, E>): Result<undefined, E> {
  return self_.$ === "Err" ? self_ : res;
}

// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:240 check_transmutes
export function check_transmutes(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed> {
  assert(!tcx.is_typeck_child(LocalDefIdC.to_def_id(owner)), "assertion failed: !tcx.is_typeck_child(owner.to_def_id())");
  const typeck_results = tcx.typeck(owner) as TypeckResults;
  if (typeck_results.tainted_by_errors !== undefined) {
    const e = typeck_results.tainted_by_errors;
    return Err(e);
  }

  const typing_env = TypingEnv.codegen(tcx, owner);
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);
  for (const [from_, to_, hir_id] of typeck_results.transmutes_to_check) {
    const [to, from] = Unnormalized.unzip(set_aliases_to_non_rigid(tcx, [to_, from_] as [Ty, Ty], fold_tuple2(fold_Ty, fold_Ty)));
    result = result_and(result, check_transmute(tcx, typing_env, from, to, hir_id));
  }
  return result.$ === "Ok" ? Ok(null) : result;
}

// rustc: compiler/rustc_hir_typeck/src/intrinsicck.rs:256 check_offloads
export function check_offloads(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed> {
  assert(!tcx.is_typeck_child(LocalDefIdC.to_def_id(owner)), "assertion failed: !tcx.is_typeck_child(owner.to_def_id())");
  const typeck_results = tcx.typeck(owner) as TypeckResults;
  if (typeck_results.tainted_by_errors !== undefined) {
    const e = typeck_results.tainted_by_errors;
    return Err(e);
  }

  const typing_env = TypingEnv.codegen(tcx, owner);
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);
  for (const [kernel_ty, args_ty, ret_ty, hir_id] of typeck_results.offloads_to_check) {
    result = result_and(result, check_offload(tcx, typing_env, kernel_ty, args_ty, ret_ty, hir_id));
  }
  return result.$ === "Ok" ? Ok(null) : result;
}
