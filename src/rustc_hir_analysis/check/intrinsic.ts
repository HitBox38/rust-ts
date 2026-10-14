//! Type-checking for the `#[rustc_intrinsic]` intrinsics that the compiler exposes.
// Port of compiler/rustc_hir_analysis/src/check/intrinsic.rs (lane check-region-intrinsic).
//
// Init order: top-level code here touches only other crates.
//
// PORT: `crate::check::check_function_signature` is lane check-check's (check/mod.rs), which is not in this lane's
// base: it is called through `pending` (end of this file), an `unported(..)` stand-in that root repoints at merge.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import { into_MultiSpan } from "../../rustc_error_messages/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, BoundRegionKind, type BoundVariableKind, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { BoundVar, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { fold_FnSig, IsRigid, PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unported, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { UnrecognizedIntrinsicFunction_diagnostic, WrongNumberOfGenericArgumentsToIntrinsic_diagnostic } from "../diagnostics.ts";

// rustc: compiler/rustc_hir_analysis/src/check/intrinsic.rs:15 equate_intrinsic_type
function equate_intrinsic_type(
  tcx: TyCtxt,
  span: Span,
  def_id: LocalDefId,
  n_tps: number,
  n_lts: number,
  n_cts: number,
  sig: PolyFnSig,
): void {
  let generics: Generics;
  {
    const node = tcx.hir_node_by_def_id(def_id);
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      generics = tcx.generics_of(def_id) as Generics;
      span = node._0.kind.generics.span;
    } else {
      return tcx.dcx().span_bug(span, "intrinsic must be a function");
    }
  }
  const own_counts = generics.own_counts();

  const gen_count_ok = (found: number, expected: number, descr: string): boolean => {
    if (found !== expected) {
      tcx.dcx().emit_err(
        WrongNumberOfGenericArgumentsToIntrinsic_diagnostic({
          span,
          found,
          expected,
          descr,
        }),
      );
      return false;
    } else {
      return true;
    }
  };

  // the host effect param should be invisible as it shouldn't matter
  // whether effects is enabled for the intrinsic provider crate.
  if (gen_count_ok(own_counts.lifetimes, n_lts, "lifetime") && gen_count_ok(own_counts.types, n_tps, "type") && gen_count_ok(own_counts.consts, n_cts, "const")) {
    void pending.check_function_signature(tcx, ObligationCause.new(span, def_id, ObligationCauseCode.IntrinsicType), LocalDefIdC.to_def_id(def_id), sig);
  }
}

/// Returns the unsafety of the given intrinsic.
// rustc: compiler/rustc_hir_analysis/src/check/intrinsic.rs:62 intrinsic_operation_unsafety
function intrinsic_operation_unsafety(tcx: TyCtxt, intrinsic_id: LocalDefId): hir.Safety {
  let is_in_list: hir.Safety;
  switch (tcx.item_name(intrinsic_id)) {
    // When adding a new intrinsic to this list,
    // it's usually worth updating that intrinsic's documentation
    // to note that it's safe to call, since
    // safe extern fns are otherwise unprecedented.

    // tidy-alphabetical-start
    case sym.abort_immediate:
    case sym.add_with_overflow:
    case sym.aggregate_raw_ptr:
    case sym.align_of:
    case sym.amdgpu_dispatch_ptr:
    case sym.assert_inhabited:
    case sym.assert_mem_uninitialized_valid:
    case sym.assert_zero_valid:
    case sym.autodiff:
    case sym.bitreverse:
    case sym.black_box:
    case sym.breakpoint:
    case sym.bswap:
    case sym.caller_location:
    case sym.carrying_mul_add:
    case sym.carryless_mul:
    case sym.ceilf16:
    case sym.ceilf32:
    case sym.ceilf64:
    case sym.ceilf128:
    case sym.cold_path:
    case sym.const_eval_select:
    case sym.contract_check_ensures:
    case sym.contract_check_requires:
    case sym.contract_checks:
    case sym.copysignf16:
    case sym.copysignf32:
    case sym.copysignf64:
    case sym.copysignf128:
    case sym.cos:
    case sym.ctlz:
    case sym.ctpop:
    case sym.cttz:
    case sym.discriminant_value:
    case sym.exp:
    case sym.exp2:
    case sym.fabs:
    case sym.fadd_algebraic:
    case sym.fdiv_algebraic:
    case sym.field_offset:
    case sym.field_representing_type_actual_type_id:
    case sym.field_representing_type_name:
    case sym.field_representing_type_offset:
    case sym.floorf16:
    case sym.floorf32:
    case sym.floorf64:
    case sym.floorf128:
    case sym.fmaf16:
    case sym.fmaf32:
    case sym.fmaf64:
    case sym.fmaf128:
    case sym.fmul_algebraic:
    case sym.fmuladdf16:
    case sym.fmuladdf32:
    case sym.fmuladdf64:
    case sym.fmuladdf128:
    case sym.forget:
    case sym.frem_algebraic:
    case sym.fsub_algebraic:
    case sym.gpu_launch_sized_workgroup_mem:
    case sym.integer_max:
    case sym.integer_min:
    case sym.is_val_statically_known:
    case sym.log:
    case sym.log2:
    case sym.log10:
    case sym.maximum_number_nsz_f16:
    case sym.maximum_number_nsz_f32:
    case sym.maximum_number_nsz_f64:
    case sym.maximum_number_nsz_f128:
    case sym.maximumf16:
    case sym.maximumf32:
    case sym.maximumf64:
    case sym.maximumf128:
    case sym.minimum_number_nsz_f16:
    case sym.minimum_number_nsz_f32:
    case sym.minimum_number_nsz_f64:
    case sym.minimum_number_nsz_f128:
    case sym.minimumf16:
    case sym.minimumf32:
    case sym.minimumf64:
    case sym.minimumf128:
    case sym.mul_with_overflow:
    case sym.needs_drop:
    case sym.offload:
    case sym.offload_get_num_devices:
    case sym.offset_of:
    case sym.overflow_checks:
    case sym.powf16:
    case sym.powf32:
    case sym.powf64:
    case sym.powf128:
    case sym.powif16:
    case sym.powif32:
    case sym.powif64:
    case sym.powif128:
    case sym.prefetch_read_data:
    case sym.prefetch_read_instruction:
    case sym.prefetch_write_data:
    case sym.prefetch_write_instruction:
    case sym.ptr_guaranteed_cmp:
    case sym.ptr_mask:
    case sym.ptr_metadata:
    case sym.return_address:
    case sym.rotate_left:
    case sym.rotate_right:
    case sym.round_ties_even_f16:
    case sym.round_ties_even_f32:
    case sym.round_ties_even_f64:
    case sym.round_ties_even_f128:
    case sym.roundf16:
    case sym.roundf32:
    case sym.roundf64:
    case sym.roundf128:
    case sym.rustc_peek:
    case sym.saturating_add:
    case sym.saturating_sub:
    case sym.select_unpredictable:
    case sym.sin:
    case sym.size_of:
    case sym.size_of_type_id:
    case sym.sqrtf16:
    case sym.sqrtf32:
    case sym.sqrtf64:
    case sym.sqrtf128:
    case sym.sub_with_overflow:
    case sym.three_way_compare:
    case sym.truncf16:
    case sym.truncf32:
    case sym.truncf64:
    case sym.truncf128:
    case sym.type_id:
    case sym.type_id_array_len:
    case sym.type_id_element_ty:
    case sym.type_id_eq:
    case sym.type_id_field_representing_type:
    case sym.type_id_fields:
    case sym.type_id_function_ptr:
    case sym.type_id_generics:
    case sym.type_id_is_signed:
    case sym.type_id_non_exhaustive:
    case sym.type_id_points_mutably:
    case sym.type_id_points_to:
    case sym.type_id_size_of:
    case sym.type_id_type_of:
    case sym.type_id_variant_name:
    case sym.type_id_variant_non_exhaustive:
    case sym.type_id_variants:
    case sym.type_id_vtable:
    case sym.type_name:
    case sym.ub_checks:
    case sym.va_copy:
    case sym.variant_count:
    case sym.wrapping_add:
    case sym.wrapping_mul:
    case sym.wrapping_sub:
    case sym.write_box_via_move:
    // tidy-alphabetical-end
      is_in_list = "Safe";
      break;
    default:
      is_in_list = "Unsafe";
  }

  if (PolyFnSigC.safety(EarlyBinder.skip_binder(tcx.fn_sig(intrinsic_id) as EarlyBinder<PolyFnSig>)) !== is_in_list) {
    tcx
      .dcx()
      .struct_span_err(
        tcx.def_span(intrinsic_id),
        `intrinsic safety mismatch between list of intrinsics within the compiler and core library intrinsics for intrinsic \`${Symbol.as_str(tcx.item_name(intrinsic_id))}\``,
      )
      .emit();
  }

  return is_in_list;
}

/// Remember to add all intrinsics here, in `compiler/rustc_codegen_llvm/src/intrinsic.rs`,
/// and in `library/core/src/intrinsics.rs`.
// rustc: compiler/rustc_hir_analysis/src/check/intrinsic.rs:247 check_intrinsic_type
export function check_intrinsic_type(tcx: TyCtxt, intrinsic_id: LocalDefId, span: Span, intrinsic_name: Symbol): void {
  const generics = tcx.generics_of(intrinsic_id) as Generics;
  const param = (n: number): Ty => {
    const p = generics.param_at(n, tcx);
    if (p.kind.$ === "Type") {
      const name = p.name;
      return Ty.new_param(tcx, n, name);
    } else {
      return Ty.new_error_with_message(tcx, into_MultiSpan(span), "expected param");
    }
  };

  const bound_vars = tcx.mk_bound_variable_kinds([
    { $: "Region", _0: BoundRegionKind.Anon },
    { $: "Region", _0: BoundRegionKind.Anon },
    { $: "Region", _0: BoundRegionKind.ClosureEnv },
  ] satisfies BoundVariableKind[]);
  const mk_va_list_ty = (mutbl: Mutability): [Ty, Ty] => {
    const did = tcx.require_lang_item(LangItem.VaList, span);
    const region = Region.new_bound(tcx, INNERMOST, { var: BoundVar.ZERO, kind: BoundRegionKind.Anon });
    const env_region = Region.new_bound(tcx, INNERMOST, {
      var: BoundVar.from_u32(2),
      kind: BoundRegionKind.ClosureEnv,
    });
    const va_list_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(did) as EarlyBinder<Ty>, tcx, [GenericArg.from_Region(region)], fold_Ty));
    return [Ty.new_ref(tcx, env_region, va_list_ty, mutbl), va_list_ty];
  };
  const type_id_ty = (): Ty => unwrap(EarlyBinder.no_bound_vars(tcx.type_of(unwrap(tcx.lang_items().type_id())) as EarlyBinder<Ty>, fold_Ty));

  const safety = intrinsic_operation_unsafety(tcx, intrinsic_id);
  const n_lts = 0;
  // `let (n_tps, n_cts, inputs, output) = match intrinsic_name { .. }`
  let r: [number, number, Ty[], Ty];
  switch (intrinsic_name) {
    case sym.autodiff:
      r = [4, 0, [param(0), param(1), param(2)], param(3)];
      break;
    case sym.abort_immediate:
      r = [0, 0, [], tcx.types.never];
      break;
    case sym.amdgpu_dispatch_ptr:
      r = [0, 0, [], Ty.new_imm_ptr(tcx, tcx.types.unit)];
      break;
    case sym.unreachable:
      r = [0, 0, [], tcx.types.never];
      break;
    case sym.breakpoint:
      r = [0, 0, [], tcx.types.unit];
      break;
    case sym.size_of:
    case sym.align_of:
    case sym.variant_count:
      r = [1, 0, [], tcx.types.usize];
      break;
    case sym.size_of_val:
    case sym.align_of_val:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0))], tcx.types.usize];
      break;
    case sym.type_id_size_of:
      r = [0, 0, [type_id_ty()], Ty.new_option(tcx, tcx.types.usize)];
      break;
    case sym.offset_of:
      r = [1, 0, [tcx.types.u32, tcx.types.u32], tcx.types.usize];
      break;
    case sym.field_offset:
      r = [1, 0, [], tcx.types.usize];
      break;
    case sym.rustc_peek:
      r = [1, 0, [param(0)], param(0)];
      break;
    case sym.caller_location:
      r = [0, 0, [], tcx.caller_location_ty()];
      break;
    case sym.gpu_launch_sized_workgroup_mem:
      r = [1, 0, [], Ty.new_mut_ptr(tcx, param(0))];
      break;
    case sym.assert_inhabited:
    case sym.assert_zero_valid:
    case sym.assert_mem_uninitialized_valid:
      r = [1, 0, [], tcx.types.unit];
      break;
    case sym.forget:
      r = [1, 0, [param(0)], tcx.types.unit];
      break;
    case sym.transmute:
    case sym.transmute_unchecked:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.prefetch_read_data:
    case sym.prefetch_write_data:
    case sym.prefetch_read_instruction:
    case sym.prefetch_write_instruction:
      r = [1, 1, [Ty.new_imm_ptr(tcx, param(0))], tcx.types.unit];
      break;
    case sym.needs_drop:
      r = [1, 0, [], tcx.types.bool];
      break;
    case sym.type_name:
      r = [1, 0, [], Ty.new_static_str(tcx)];
      break;
    case sym.type_id:
      r = [1, 0, [], type_id_ty()];
      break;
    case sym.type_id_array_len:
      r = [0, 0, [type_id_ty()], tcx.types.usize];
      break;
    case sym.type_id_element_ty:
      r = [0, 0, [type_id_ty()], Ty.new_option(tcx, type_id_ty())];
      break;
    case sym.type_id_eq:
      r = [0, 0, [type_id_ty(), type_id_ty()], tcx.types.bool];
      break;
    case sym.type_id_field_representing_type:
      r = [0, 0, [type_id_ty(), tcx.types.usize, tcx.types.usize], type_id_ty()];
      break;
    case sym.type_id_fields:
      r = [0, 0, [type_id_ty(), tcx.types.usize], tcx.types.usize];
      break;
    case sym.type_id_function_ptr: {
      const fn_ptr = tcx.require_lang_item(LangItem.FnPtr, span);
      const fn_ptr_adt_ref = tcx.adt_def(fn_ptr) as AdtDef;
      const fn_ptr_ty = Ty.new_adt(tcx, fn_ptr_adt_ref, RawList.empty());

      const option = tcx.require_lang_item(LangItem.Option, span);
      const option_adt_ref = tcx.adt_def(option) as AdtDef;
      const option_args = tcx.mk_args([GenericArg.from_Ty(fn_ptr_ty)]);
      const option_fn_ptr_ty = Ty.new_adt(tcx, option_adt_ref, option_args);
      r = [0, 0, [type_id_ty()], option_fn_ptr_ty];
      break;
    }
    case sym.type_id_is_signed:
      r = [0, 0, [type_id_ty()], tcx.types.bool];
      break;
    case sym.type_id_points_mutably:
      r = [0, 0, [type_id_ty()], tcx.types.bool];
      break;
    case sym.type_id_points_to:
      r = [0, 0, [type_id_ty()], Ty.new_option(tcx, type_id_ty())];
      break;
    case sym.type_id_variants:
      r = [0, 0, [type_id_ty()], tcx.types.usize];
      break;
    case sym.type_id_variant_name:
      r = [0, 0, [type_id_ty(), tcx.types.usize], Ty.new_static_str(tcx)];
      break;
    case sym.type_id_variant_non_exhaustive:
      r = [0, 0, [type_id_ty(), tcx.types.usize], tcx.types.bool];
      break;
    case sym.type_id_vtable: {
      const dyn_metadata = tcx.require_lang_item(LangItem.DynMetadata, span);
      const dyn_metadata_adt_ref = tcx.adt_def(dyn_metadata) as AdtDef;
      const dyn_metadata_args = tcx.mk_args([GenericArg.from_Ty(Ty.new_ptr(tcx, tcx.types.unit, "Not"))]);
      const dyn_ty = Ty.new_adt(tcx, dyn_metadata_adt_ref, dyn_metadata_args);

      const option_did = tcx.require_lang_item(LangItem.Option, span);
      const option_adt_ref = tcx.adt_def(option_did) as AdtDef;
      const option_args = tcx.mk_args([GenericArg.from_Ty(dyn_ty)]);
      const ret_ty = Ty.new_adt(tcx, option_adt_ref, option_args);

      // `vec![type_id_ty(); 2]`: one call, cloned
      const t = type_id_ty();
      r = [0, 0, [t, t], ret_ty];
      break;
    }
    case sym.type_id_type_of:
      r = [0, 0, [type_id_ty()], unwrap(EarlyBinder.no_bound_vars(tcx.type_of(unwrap(tcx.lang_items().type_struct())) as EarlyBinder<Ty>, fold_Ty))];
      break;
    case sym.field_representing_type_actual_type_id:
      r = [0, 0, [type_id_ty()], type_id_ty()];
      break;
    case sym.field_representing_type_name:
      r = [0, 0, [type_id_ty()], Ty.new_static_str(tcx)];
      break;
    case sym.field_representing_type_offset:
      r = [0, 0, [type_id_ty()], tcx.types.usize];
      break;
    case sym.type_id_non_exhaustive:
      r = [0, 0, [type_id_ty()], tcx.types.bool];
      break;
    case sym.type_id_generics:
      r = [
        0,
        0,
        [type_id_ty()],
        Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, Ty.new_slice(tcx, unwrap(EarlyBinder.no_bound_vars(tcx.type_of(unwrap(tcx.lang_items().type_generic())) as EarlyBinder<Ty>, fold_Ty)))),
      ];
      break;
    case sym.offload:
      r = [
        3,
        0,
        [
          param(0),
          Ty.new_array_with_const_len(tcx, tcx.types.u32, Const.from_target_usize(tcx, 3)),
          Ty.new_array_with_const_len(tcx, tcx.types.u32, Const.from_target_usize(tcx, 3)),
          tcx.types.u32,
          tcx.types.i32,
          param(1),
        ],
        param(2),
      ];
      break;
    case sym.offload_get_num_devices:
      r = [0, 0, [], tcx.types.i32];
      break;
    case sym.offset:
      r = [2, 0, [param(0), param(1)], param(0)];
      break;
    case sym.arith_offset:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), tcx.types.isize], Ty.new_imm_ptr(tcx, param(0))];
      break;
    case sym.slice_get_unchecked:
      r = [3, 0, [param(1), tcx.types.usize], param(0)];
      break;
    case sym.ptr_mask:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), tcx.types.usize], Ty.new_imm_ptr(tcx, param(0))];
      break;
    case sym.copy:
    case sym.copy_nonoverlapping:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), Ty.new_mut_ptr(tcx, param(0)), tcx.types.usize], tcx.types.unit];
      break;
    case sym.volatile_copy_memory:
    case sym.volatile_copy_nonoverlapping_memory:
      r = [1, 0, [Ty.new_mut_ptr(tcx, param(0)), Ty.new_imm_ptr(tcx, param(0)), tcx.types.usize], tcx.types.unit];
      break;
    case sym.compare_bytes: {
      const byte_ptr = Ty.new_imm_ptr(tcx, tcx.types.u8);
      r = [0, 0, [byte_ptr, byte_ptr, tcx.types.usize], tcx.types.i32];
      break;
    }
    case sym.write_bytes:
    case sym.volatile_set_memory:
      r = [1, 0, [Ty.new_mut_ptr(tcx, param(0)), tcx.types.u8, tcx.types.usize], tcx.types.unit];
      break;
    case sym.sqrtf16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.sqrtf32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.sqrtf64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.sqrtf128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.powif16:
      r = [0, 0, [tcx.types.f16, tcx.types.i32], tcx.types.f16];
      break;
    case sym.powif32:
      r = [0, 0, [tcx.types.f32, tcx.types.i32], tcx.types.f32];
      break;
    case sym.powif64:
      r = [0, 0, [tcx.types.f64, tcx.types.i32], tcx.types.f64];
      break;
    case sym.powif128:
      r = [0, 0, [tcx.types.f128, tcx.types.i32], tcx.types.f128];
      break;
    case sym.powf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.powf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.powf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.powf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.fmaf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.fmaf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.fmaf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.fmaf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.fmuladdf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.fmuladdf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.fmuladdf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.fmuladdf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.exp:
    case sym.exp2:
    case sym.log:
    case sym.log2:
    case sym.log10:
    case sym.fabs:
    case sym.sin:
    case sym.cos:
      r = [1, 0, [param(0)], param(0)];
      break;
    case sym.minimum_number_nsz_f16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.minimum_number_nsz_f32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.minimum_number_nsz_f64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.minimum_number_nsz_f128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.minimumf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.minimumf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.minimumf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.minimumf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.maximum_number_nsz_f16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.maximum_number_nsz_f32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.maximum_number_nsz_f64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.maximum_number_nsz_f128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.maximumf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.maximumf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.maximumf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.maximumf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.copysignf16:
      r = [0, 0, [tcx.types.f16, tcx.types.f16], tcx.types.f16];
      break;
    case sym.copysignf32:
      r = [0, 0, [tcx.types.f32, tcx.types.f32], tcx.types.f32];
      break;
    case sym.copysignf64:
      r = [0, 0, [tcx.types.f64, tcx.types.f64], tcx.types.f64];
      break;
    case sym.copysignf128:
      r = [0, 0, [tcx.types.f128, tcx.types.f128], tcx.types.f128];
      break;
    case sym.floorf16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.floorf32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.floorf64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.floorf128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.ceilf16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.ceilf32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.ceilf64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.ceilf128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.truncf16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.truncf32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.truncf64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.truncf128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.round_ties_even_f16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.round_ties_even_f32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.round_ties_even_f64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.round_ties_even_f128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.roundf16:
      r = [0, 0, [tcx.types.f16], tcx.types.f16];
      break;
    case sym.roundf32:
      r = [0, 0, [tcx.types.f32], tcx.types.f32];
      break;
    case sym.roundf64:
      r = [0, 0, [tcx.types.f64], tcx.types.f64];
      break;
    case sym.roundf128:
      r = [0, 0, [tcx.types.f128], tcx.types.f128];
      break;
    case sym.volatile_load:
    case sym.unaligned_volatile_load:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0))], param(0)];
      break;
    case sym.volatile_store:
    case sym.unaligned_volatile_store:
      r = [1, 0, [Ty.new_mut_ptr(tcx, param(0)), param(0)], tcx.types.unit];
      break;
    case sym.ctpop:
    case sym.ctlz:
    case sym.ctlz_nonzero:
    case sym.cttz:
    case sym.cttz_nonzero:
      r = [1, 0, [param(0)], tcx.types.u32];
      break;
    case sym.bswap:
    case sym.bitreverse:
      r = [1, 0, [param(0)], param(0)];
      break;
    case sym.three_way_compare:
      r = [1, 0, [param(0), param(0)], tcx.ty_ordering_enum(span)];
      break;
    case sym.add_with_overflow:
    case sym.sub_with_overflow:
    case sym.mul_with_overflow:
      r = [1, 0, [param(0), param(0)], Ty.new_tup(tcx, [param(0), tcx.types.bool])];
      break;
    case sym.carrying_mul_add:
      {
      // `vec![param(0); 4]`: one call, cloned
      const p0 = param(0);
      r = [2, 0, [p0, p0, p0, p0], Ty.new_tup(tcx, [param(1), param(0)])];
      break;
    }
    case sym.ptr_guaranteed_cmp:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), Ty.new_imm_ptr(tcx, param(0))], tcx.types.u8];
      break;
    case sym.const_allocate:
      r = [0, 0, [tcx.types.usize, tcx.types.usize], Ty.new_mut_ptr(tcx, tcx.types.u8)];
      break;
    case sym.const_deallocate:
      r = [0, 0, [Ty.new_mut_ptr(tcx, tcx.types.u8), tcx.types.usize, tcx.types.usize], tcx.types.unit];
      break;
    case sym.const_make_global:
      r = [0, 0, [Ty.new_mut_ptr(tcx, tcx.types.u8)], Ty.new_imm_ptr(tcx, tcx.types.u8)];
      break;
    case sym.ptr_offset_from:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), Ty.new_imm_ptr(tcx, param(0))], tcx.types.isize];
      break;
    case sym.ptr_offset_from_unsigned:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0)), Ty.new_imm_ptr(tcx, param(0))], tcx.types.usize];
      break;
    case sym.integer_max:
    case sym.integer_min:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.unchecked_div:
    case sym.unchecked_rem:
    case sym.exact_div:
    case sym.disjoint_bitor:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.unchecked_shl:
    case sym.unchecked_shr:
      r = [2, 0, [param(0), param(1)], param(0)];
      break;
    case sym.rotate_left:
    case sym.rotate_right:
      r = [1, 0, [param(0), tcx.types.u32], param(0)];
      break;
    case sym.unchecked_funnel_shl:
    case sym.unchecked_funnel_shr:
      r = [1, 0, [param(0), param(0), tcx.types.u32], param(0)];
      break;
    case sym.unchecked_add:
    case sym.unchecked_sub:
    case sym.unchecked_mul:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.wrapping_add:
    case sym.wrapping_sub:
    case sym.wrapping_mul:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.saturating_add:
    case sym.saturating_sub:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.carryless_mul:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.fadd_fast:
    case sym.fsub_fast:
    case sym.fmul_fast:
    case sym.fdiv_fast:
    case sym.frem_fast:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.fadd_algebraic:
    case sym.fsub_algebraic:
    case sym.fmul_algebraic:
    case sym.fdiv_algebraic:
    case sym.frem_algebraic:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.float_to_int_unchecked:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.assume:
      r = [0, 0, [tcx.types.bool], tcx.types.unit];
      break;
    case sym.select_unpredictable:
      r = [1, 0, [tcx.types.bool, param(0), param(0)], param(0)];
      break;
    case sym.cold_path:
      r = [0, 0, [], tcx.types.unit];
      break;
    case sym.read_via_copy:
      r = [1, 0, [Ty.new_imm_ptr(tcx, param(0))], param(0)];
      break;
    case sym.write_via_move:
      r = [1, 0, [Ty.new_mut_ptr(tcx, param(0)), param(0)], tcx.types.unit];
      break;
    case sym.write_box_via_move: {
      const t = param(0);
      const maybe_uninit_t = Ty.new_maybe_uninit(tcx, t);
      const box_mu_t = Ty.new_box(tcx, maybe_uninit_t);

      r = [1, 0, [box_mu_t, param(0)], box_mu_t];
      break;
    }

    case sym.typed_swap_nonoverlapping: {
      // `vec![Ty::new_mut_ptr(tcx, param(0)); 2]`: one call, cloned
      const p = Ty.new_mut_ptr(tcx, param(0));
      r = [1, 0, [p, p], tcx.types.unit];
      break;
    }
    case sym.discriminant_value: {
      const assoc_items = tcx.associated_item_def_ids(tcx.require_lang_item(LangItem.DiscriminantKind, span)) as readonly DefId[];
      const discriminant_def_id = assoc_items[0]!;

      const br = { var: BoundVar.ZERO, kind: BoundRegionKind.Anon };
      r = [
        1,
        0,
        [Ty.new_imm_ref(tcx, Region.new_bound(tcx, INNERMOST, br), param(0))],
        Ty.new_projection_from_args(tcx, IsRigid.No, discriminant_def_id, tcx.mk_args([GenericArg.from_Ty(param(0))])),
      ];
      break;
    }

    case sym.catch_unwind: {
      const mut_data = Ty.new_mut_ptr(tcx, param(0));
      const mut_u8 = Ty.new_mut_ptr(tcx, tcx.types.u8);
      const try_fn_ty = Binder.dummy(tcx.mk_fn_sig_unsafe_rust_abi([mut_data], tcx.types.unit), fold_FnSig);
      const catch_fn_ty = Binder.dummy(tcx.mk_fn_sig_unsafe_rust_abi([mut_data, mut_u8], tcx.types.unit), fold_FnSig);
      r = [1, 0, [Ty.new_fn_ptr(tcx, try_fn_ty), mut_data, Ty.new_fn_ptr(tcx, catch_fn_ty)], tcx.types.bool];
      break;
    }

    case sym.va_copy: {
      const [va_list_ref_ty, va_list_ty] = mk_va_list_ty("Not");
      r = [0, 0, [va_list_ref_ty], va_list_ty];
      break;
    }

    case sym.va_end:
      r = [0, 0, [mk_va_list_ty("Mut")[0]], tcx.types.unit];

      break;
    case sym.va_arg:
      r = [1, 0, [mk_va_list_ty("Mut")[0]], param(0)];

      break;
    case sym.nontemporal_store:
      r = [1, 0, [Ty.new_mut_ptr(tcx, param(0)), param(0)], tcx.types.unit];
      break;
    case sym.raw_eq: {
      const br = { var: BoundVar.ZERO, kind: BoundRegionKind.Anon };
      const param_ty_lhs = Ty.new_imm_ref(tcx, Region.new_bound(tcx, INNERMOST, br), param(0));
      const br1 = { var: BoundVar.from_u32(1), kind: BoundRegionKind.Anon };
      const param_ty_rhs = Ty.new_imm_ref(tcx, Region.new_bound(tcx, INNERMOST, br1), param(0));
      r = [1, 0, [param_ty_lhs, param_ty_rhs], tcx.types.bool];
      break;
    }

    case sym.black_box:
      r = [1, 0, [param(0)], param(0)];
      break;
    case sym.is_val_statically_known:
      r = [1, 0, [param(0)], tcx.types.bool];
      break;
    case sym.const_eval_select:
      r = [4, 0, [param(0), param(1), param(2)], param(3)];
      break;
    case sym.vtable_size:
    case sym.vtable_align:
      r = [0, 0, [Ty.new_imm_ptr(tcx, tcx.types.unit)], tcx.types.usize];
      break;

    // This type check is not particularly useful, but the `where` bounds
    // on the definition in `core` do the heavy lifting for checking it.
    case sym.aggregate_raw_ptr:
      r = [3, 0, [param(1), param(2)], param(0)];
      break;
    case sym.ptr_metadata:
      r = [2, 0, [Ty.new_imm_ptr(tcx, param(0))], param(1)];
      break;
    case sym.ub_checks:
    case sym.overflow_checks:
      r = [0, 0, [], tcx.types.bool];
      break;

    // contract_check_requires::<C>(C) -> bool, where C: impl Fn() -> bool
    case sym.contract_check_requires:
      r = [1, 0, [param(0)], tcx.types.unit];
      break;
    case sym.contract_check_ensures:
      r = [2, 0, [Ty.new_option(tcx, param(0)), param(1)], param(1)];
      break;
    case sym.simd_eq:
    case sym.simd_ne:
    case sym.simd_lt:
    case sym.simd_le:
    case sym.simd_gt:
    case sym.simd_ge:
      r = [2, 0, [param(0), param(0)], param(1)];
      break;
    case sym.simd_add:
    case sym.simd_sub:
    case sym.simd_mul:
    case sym.simd_rem:
    case sym.simd_div:
    case sym.simd_shl:
    case sym.simd_shr:
    case sym.simd_and:
    case sym.simd_or:
    case sym.simd_xor:
    case sym.simd_minimum_number_nsz:
    case sym.simd_maximum_number_nsz:
    case sym.simd_saturating_add:
    case sym.simd_saturating_sub:
    case sym.simd_carryless_mul:
      r = [1, 0, [param(0), param(0)], param(0)];
      break;
    case sym.simd_arith_offset:
      r = [2, 0, [param(0), param(1)], param(0)];
      break;
    case sym.simd_neg:
    case sym.simd_bswap:
    case sym.simd_bitreverse:
    case sym.simd_ctlz:
    case sym.simd_cttz:
    case sym.simd_ctpop:
    case sym.simd_fsqrt:
    case sym.simd_fsin:
    case sym.simd_fcos:
    case sym.simd_fexp:
    case sym.simd_fexp2:
    case sym.simd_flog2:
    case sym.simd_flog10:
    case sym.simd_flog:
    case sym.simd_fabs:
    case sym.simd_ceil:
    case sym.simd_floor:
    case sym.simd_round:
    case sym.simd_round_ties_even:
    case sym.simd_trunc:
      r = [1, 0, [param(0)], param(0)];
      break;
    case sym.simd_fma:
    case sym.simd_relaxed_fma:
    case sym.simd_funnel_shl:
    case sym.simd_funnel_shr:
      r = [1, 0, [param(0), param(0), param(0)], param(0)];
      break;
    case sym.simd_gather:
      r = [3, 0, [param(0), param(1), param(2)], param(0)];
      break;
    case sym.simd_masked_load:
      r = [3, 1, [param(0), param(1), param(2)], param(2)];
      break;
    case sym.simd_masked_store:
      r = [3, 1, [param(0), param(1), param(2)], tcx.types.unit];
      break;
    case sym.simd_scatter:
      r = [3, 0, [param(0), param(1), param(2)], tcx.types.unit];
      break;
    case sym.simd_insert:
    case sym.simd_insert_dyn:
      r = [2, 0, [param(0), tcx.types.u32, param(1)], param(0)];
      break;
    case sym.simd_extract:
    case sym.simd_extract_dyn:
      r = [2, 0, [param(0), tcx.types.u32], param(1)];
      break;
    case sym.simd_splat:
      r = [2, 0, [param(1)], param(0)];
      break;
    case sym.simd_cast:
    case sym.simd_as:
    case sym.simd_cast_ptr:
    case sym.simd_expose_provenance:
    case sym.simd_with_exposed_provenance:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.simd_bitmask:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.simd_select:
    case sym.simd_select_bitmask:
      r = [2, 0, [param(0), param(1), param(1)], param(1)];
      break;
    case sym.simd_reduce_all:
    case sym.simd_reduce_any:
      r = [1, 0, [param(0)], tcx.types.bool];
      break;
    case sym.simd_reduce_add_ordered:
    case sym.simd_reduce_mul_ordered:
      r = [2, 0, [param(0), param(1)], param(1)];
      break;
    case sym.simd_reduce_add_unordered:
    case sym.simd_reduce_mul_unordered:
    case sym.simd_reduce_and:
    case sym.simd_reduce_or:
    case sym.simd_reduce_xor:
    case sym.simd_reduce_min:
    case sym.simd_reduce_max:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.simd_shuffle:
      r = [3, 0, [param(0), param(0), param(1)], param(2)];
      break;
    case sym.simd_shuffle_const_generic:
      r = [2, 1, [param(0), param(0)], param(1)];
      break;
    case sym.sve_cast:
      r = [2, 0, [param(0)], param(1)];
      break;
    case sym.sve_tuple_create2:
      r = [2, 0, [param(0), param(0)], param(1)];
      break;
    case sym.sve_tuple_create3:
      r = [2, 0, [param(0), param(0), param(0)], param(1)];
      break;
    case sym.sve_tuple_create4:
      r = [2, 0, [param(0), param(0), param(0), param(0)], param(1)];
      break;
    case sym.sve_tuple_get:
      r = [2, 1, [param(0)], param(1)];
      break;
    case sym.sve_tuple_set:
      r = [2, 1, [param(0), param(1)], param(0)];
      break;
    case sym.atomic_cxchg:
    case sym.atomic_cxchgweak:
      r = [1, 2, [Ty.new_mut_ptr(tcx, param(0)), param(0), param(0)], Ty.new_tup(tcx, [param(0), tcx.types.bool])];
      break;
    case sym.atomic_load:
      r = [1, 2, [Ty.new_imm_ptr(tcx, param(0))], param(0)];
      break;
    case sym.atomic_store:
      r = [1, 2, [Ty.new_mut_ptr(tcx, param(0)), param(0)], tcx.types.unit];
      break;
    case sym.atomic_xchg:
    case sym.atomic_max:
    case sym.atomic_min:
    case sym.atomic_umax:
    case sym.atomic_umin:
      r = [1, 1, [Ty.new_mut_ptr(tcx, param(0)), param(0)], param(0)];
      break;
    case sym.atomic_xadd:
    case sym.atomic_xsub:
    case sym.atomic_and:
    case sym.atomic_nand:
    case sym.atomic_or:
    case sym.atomic_xor:
      r = [2, 1, [Ty.new_mut_ptr(tcx, param(0)), param(1)], param(0)];
      break;
    case sym.atomic_fence:
    case sym.atomic_singlethreadfence:
      r = [0, 1, [], tcx.types.unit];
      break;
    case sym.return_address:
      r = [0, 0, [], Ty.new_imm_ptr(tcx, tcx.types.unit)];
      break;

    default: {
      const other = intrinsic_name;
      tcx.dcx().emit_err(UnrecognizedIntrinsicFunction_diagnostic({ span, name: other }));
      return;
    }
  }
  const [n_tps, n_cts, inputs, output] = r;
  const sig0 = tcx.mk_fn_sig_rust_abi(inputs, output, safety);
  const sig = Binder.bind_with_vars(sig0, bound_vars);
  equate_intrinsic_type(tcx, span, intrinsic_id, n_tps, n_lts, n_cts, sig);
}

// ---- PORT stand-ins for items of lanes not in this lane's base (root repoints them at merge) ----------------------

/** Stand-ins, called through this object so a test can observe the computed signature. */
export const pending = {
  /** `crate::check::check_function_signature` (check/mod.rs, lane check-check). */
  check_function_signature(_tcx: TyCtxt, _cause: ObligationCause, _fn_id: DefId, _expected_sig: PolyFnSig): Result<null, ErrorGuaranteed> {
    return unported("rustc_hir_analysis::check::check_function_signature (lane check-check)");
  },
};
