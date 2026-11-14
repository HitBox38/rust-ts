// Port of compiler/rustc_codegen_llvm/src/intrinsic.rs (skeleton: lane cg-contract; bodies: lane cg-intrinsic-a, plan-m7 §8
// wave 41). This lane ports the scalar half, intrinsic.rs:1-2046: everything before `generic_simd_intrinsic` (:2047), which,
// with what follows it (`vector_mask_to_bitmask`, `simd_simple_float_intrinsic`, `llvm_vector_ty`, `llvm_alignment`, all nested
// in it), is lane cg-intrinsic-b's (plan-m7 §8 wave 43, M7c) and stays the typed stub at the end of this file.
//
// What is here, in upstream order: `call_simple_intrinsic`; `impl Builder { black_box }`; `impl IntrinsicCallBuilderMethods for
// Builder` (attached with PORTING §5's extension pattern; lib.ts imports this file after the class's own module);
// `llvm_arch_for`, `can_autocast`, `autocast`, `intrinsic_fn`, `catch_unwind_intrinsic`, `codegen_msvc_try`,
// `codegen_wasm_try`, `codegen_gnu_try`, `gen_fn`, `get_rust_try_fn`, `codegen_retag_inner`, `codegen_autodiff`,
// `codegen_offload`, `get_args_from_tuple`.
//
// PORT (cg-intrinsic-a):
// - **Inherent before trait** (builder.ts header, decision 2026-11-11): `self` here is a concrete `Builder`, so `self.store(..)`,
//   `self.load(..)`, `self.trunc(..)`, `bx.ret(..)`, `bx.bitcast(..)`, `Builder::append_block(..)` and `Builder::build(..)`
//   resolve to `GenericBuilder`'s inherent methods (`store_inherent`, `load_inherent`, `trunc_inherent`, `ret_inherent`,
//   `bitcast_inherent`, `append_block_inherent`, `build_inherent`), and `bx.const_null(..)` / `bx.const_struct(..)` auto-deref to
//   `CodegenCx`, where `GenericCx`'s inherent `const_null` / `const_struct` win (`const_null_inherent`,
//   `const_struct_inherent`). Every other name has one method.
// - `match name { _ if simple.is_some() => .., sym::x => .., _ if name.as_str().starts_with("simd_") => .., sym::return_address
//   => .., _ => .. }` is a `switch` on the `Symbol` after the first guard; the `simd_` guard, `return_address` and the fallback
//   are tested in that order in its `default`, as upstream's arms (the `simd_` names and `return_address` are disjoint).
// - `llvm_version < (23, 0, 0)` compares the `[major, minor, patch]` tuples lexicographically (`version_lt`).
// - `debug!` (tracing) is compiled out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stays a comment.
// - `Cell::get` / `Cell::set` of `rust_try_fn` read / write the field. `self.intrinsic_instances.borrow()` reads the map.
// - Calls into other lanes go through their typed stubs: `crate::asm::inline_asm_call` (cg-asm), `emit_va_arg` (cg-intrinsic-b),
//   `wants_msvc_seh` (ssa-base, imported from rustc_codegen_ssa/base.ts at integ-w54), `FnAbi::llvm_type` (cg-abi-consts), `llvm_util::get_version`
//   (cg-write), the autodiff and offload builders (excluded, plan-m7 D18).
import { AddressSpace, Align, Align_eq, type BackendRepr, type Float, type NumScalableVectors, type Primitive, Scalar, Size, Size_cmp, debug_Align } from "../rustc_abi/lib.ts";
import { IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { TyAndLayout_eq } from "../rustc_abi/layout/ty.ts";
import { WrappingRange } from "../rustc_abi/wrapping_range.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { type RustcAutodiff, clone_RustcAutodiff } from "../rustc_attr_ir/data_structures.gen.ts";
import { compare_simd_types, wants_wasm_eh } from "../rustc_codegen_ssa/base.ts";
import { IntPredicate, TypeKind, debug_TypeKind } from "../rustc_codegen_ssa/common.ts";
import { type InvalidMonomorphization, InvalidMonomorphization_diagnostic } from "../rustc_codegen_ssa/diagnostics.gen.ts";
import type { RetagInfo } from "../rustc_codegen_ssa/lib.ts";
import type { IntrinsicResult } from "../rustc_codegen_ssa/mir/mod.ts";
import { OperandRef, OperandValue } from "../rustc_codegen_ssa/mir/operand.ts";
import { PlaceRef, PlaceValue } from "../rustc_codegen_ssa/mir/place.ts";
import { ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { IntrinsicCallBuilderMethods } from "../rustc_codegen_ssa/traits/intrinsic.ts";
import { DiagDecorator } from "../rustc_errors/diagnostic.ts";
import { type DefId, LOCAL_CRATE, debug_DefId } from "../rustc_span/def_id.ts";
import { DEPRECATED_LLVM_INTRINSIC } from "../rustc_lint_defs/builtin.gen.ts";
import { GenericArg, type GenericArgsRef, debug_GenericArgs, fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { BinOp } from "../rustc_middle/mir/syntax.ts";
import type { Const } from "../rustc_middle/ty/decls.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { type TyAndLayout, debug_TyAndLayout_Ty } from "../rustc_middle/ty/layout.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, Ty } from "../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fnc_typetrees } from "../rustc_middle/ty/typetree.ts";
import { LinkerPluginLto } from "../rustc_session/config.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { mangle_offload_export, symbol_name_for_instance_in_crate } from "../rustc_symbol_mangling/lib.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import { Arch, PanicStrategy } from "../rustc_target/spec/mod.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig, TyKind } from "../rustc_type_ir/decls.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unreachable } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";
import * as attributes from "./attributes.ts";
import * as asm from "./asm.ts";
import { adjust_activity_to_abi, generate_enzyme_call } from "./builder/autodiff.ts";
import * as gpu_offload from "./builder/gpu_offload.ts";
import { OffloadKernelDims, declare_omp_get_num_devices, type OffloadMetadata } from "./builder/gpu_offload.ts";
import { Builder } from "./builder.ts";
import type { CodegenCx } from "./context.ts";
import { wants_msvc_seh } from "../rustc_codegen_ssa/base.ts";
import { PointerAuthConfig } from "../rustc_session/session.ts";
import { declare_raw_fn } from "./declare.ts";
import {
  AutoDiffWithoutEnable_diagnostic,
  AutoDiffWithoutLto_diagnostic,
  IntrinsicSignatureMismatch_diagnostic,
  IntrinsicWrongArch_diagnostic,
  OffloadWithoutEnable_diagnostic,
  OffloadWithoutFatLTO_diagnostic,
  UnknownIntrinsic_diagnostic,
} from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import type { Attribute, Type, Value } from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";
import { debug_Type } from "./type_.ts";
import { debug_Value } from "./value.ts";
import { emit_va_arg } from "./va_arg.ts";
import { unported } from "../std/panic.ts";

/** `llvm_version < (a, b, c)` on `(u32, u32, u32)` tuples (header). */
function version_lt(v: readonly [number, number, number], w: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== w[i]!) return v[i]! < w[i]!;
  }
  return false;
}

/** `u64::next_power_of_two` (the operands here are vector lengths, far below 2^53). */
function next_power_of_two(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:51 call_simple_intrinsic
function call_simple_intrinsic(bx: Builder, name: Symbol, args: readonly OperandRef<Value>[]): Value | undefined {
  const llvm_version = llvm_util.get_version();
  // minimum/maximum were broken for f64/f128 before
  // <https://github.com/llvm/llvm-project/commit/56385af687c3a7a1f67716fb3f819336789a8cab>.
  // We use the fallback body there.
  const fixed_minmax = !version_lt(llvm_version, [23, 0, 0]);

  let base_name: string;
  let type_params: Type[];
  switch (name) {
    case sym.sqrtf16:
      [base_name, type_params] = ["llvm.sqrt", [bx.type_f16()]];
      break;
    case sym.sqrtf32:
      [base_name, type_params] = ["llvm.sqrt", [bx.type_f32()]];
      break;
    case sym.sqrtf64:
      [base_name, type_params] = ["llvm.sqrt", [bx.type_f64()]];
      break;
    case sym.sqrtf128:
      [base_name, type_params] = ["llvm.sqrt", [bx.type_f128()]];
      break;

    case sym.powif16:
      [base_name, type_params] = ["llvm.powi", [bx.type_f16(), bx.type_i32()]];
      break;
    case sym.powif32:
      [base_name, type_params] = ["llvm.powi", [bx.type_f32(), bx.type_i32()]];
      break;
    case sym.powif64:
      [base_name, type_params] = ["llvm.powi", [bx.type_f64(), bx.type_i32()]];
      break;
    case sym.powif128:
      [base_name, type_params] = ["llvm.powi", [bx.type_f128(), bx.type_i32()]];
      break;

    case sym.powf16:
      [base_name, type_params] = ["llvm.pow", [bx.type_f16()]];
      break;
    case sym.powf32:
      [base_name, type_params] = ["llvm.pow", [bx.type_f32()]];
      break;
    case sym.powf64:
      [base_name, type_params] = ["llvm.pow", [bx.type_f64()]];
      break;
    case sym.powf128:
      [base_name, type_params] = ["llvm.pow", [bx.type_f128()]];
      break;

    case sym.fmaf16:
      [base_name, type_params] = ["llvm.fma", [bx.type_f16()]];
      break;
    case sym.fmaf32:
      [base_name, type_params] = ["llvm.fma", [bx.type_f32()]];
      break;
    case sym.fmaf64:
      [base_name, type_params] = ["llvm.fma", [bx.type_f64()]];
      break;
    case sym.fmaf128:
      [base_name, type_params] = ["llvm.fma", [bx.type_f128()]];
      break;

    case sym.fmuladdf16:
      [base_name, type_params] = ["llvm.fmuladd", [bx.type_f16()]];
      break;
    case sym.fmuladdf32:
      [base_name, type_params] = ["llvm.fmuladd", [bx.type_f32()]];
      break;
    case sym.fmuladdf64:
      [base_name, type_params] = ["llvm.fmuladd", [bx.type_f64()]];
      break;
    case sym.fmuladdf128:
      [base_name, type_params] = ["llvm.fmuladd", [bx.type_f128()]];
      break;

    case sym.minimumf16:
      [base_name, type_params] = ["llvm.minimum", [bx.type_f16()]];
      break;
    case sym.minimumf32:
      [base_name, type_params] = ["llvm.minimum", [bx.type_f32()]];
      break;
    case sym.minimumf64:
      if (!fixed_minmax) return undefined;
      [base_name, type_params] = ["llvm.minimum", [bx.type_f64()]];
      break;
    case sym.minimumf128:
      if (!fixed_minmax) return undefined;
      [base_name, type_params] = ["llvm.minimum", [bx.type_f128()]];
      break;

    case sym.maximumf16:
      [base_name, type_params] = ["llvm.maximum", [bx.type_f16()]];
      break;
    case sym.maximumf32:
      [base_name, type_params] = ["llvm.maximum", [bx.type_f32()]];
      break;
    case sym.maximumf64:
      if (!fixed_minmax) return undefined;
      [base_name, type_params] = ["llvm.maximum", [bx.type_f64()]];
      break;
    case sym.maximumf128:
      if (!fixed_minmax) return undefined;
      [base_name, type_params] = ["llvm.maximum", [bx.type_f128()]];
      break;

    case sym.copysignf16:
      [base_name, type_params] = ["llvm.copysign", [bx.type_f16()]];
      break;
    case sym.copysignf32:
      [base_name, type_params] = ["llvm.copysign", [bx.type_f32()]];
      break;
    case sym.copysignf64:
      [base_name, type_params] = ["llvm.copysign", [bx.type_f64()]];
      break;
    case sym.copysignf128:
      [base_name, type_params] = ["llvm.copysign", [bx.type_f128()]];
      break;

    case sym.floorf16:
      [base_name, type_params] = ["llvm.floor", [bx.type_f16()]];
      break;
    case sym.floorf32:
      [base_name, type_params] = ["llvm.floor", [bx.type_f32()]];
      break;
    case sym.floorf64:
      [base_name, type_params] = ["llvm.floor", [bx.type_f64()]];
      break;
    case sym.floorf128:
      [base_name, type_params] = ["llvm.floor", [bx.type_f128()]];
      break;

    case sym.ceilf16:
      [base_name, type_params] = ["llvm.ceil", [bx.type_f16()]];
      break;
    case sym.ceilf32:
      [base_name, type_params] = ["llvm.ceil", [bx.type_f32()]];
      break;
    case sym.ceilf64:
      [base_name, type_params] = ["llvm.ceil", [bx.type_f64()]];
      break;
    case sym.ceilf128:
      [base_name, type_params] = ["llvm.ceil", [bx.type_f128()]];
      break;

    case sym.truncf16:
      [base_name, type_params] = ["llvm.trunc", [bx.type_f16()]];
      break;
    case sym.truncf32:
      [base_name, type_params] = ["llvm.trunc", [bx.type_f32()]];
      break;
    case sym.truncf64:
      [base_name, type_params] = ["llvm.trunc", [bx.type_f64()]];
      break;
    case sym.truncf128:
      [base_name, type_params] = ["llvm.trunc", [bx.type_f128()]];
      break;

    // We could use any of `rint`, `nearbyint`, or `roundeven`
    // for this -- they are all identical in semantics when
    // assuming the default FP environment.
    // `rint` is what we used for $forever.
    case sym.round_ties_even_f16:
      [base_name, type_params] = ["llvm.rint", [bx.type_f16()]];
      break;
    case sym.round_ties_even_f32:
      [base_name, type_params] = ["llvm.rint", [bx.type_f32()]];
      break;
    case sym.round_ties_even_f64:
      [base_name, type_params] = ["llvm.rint", [bx.type_f64()]];
      break;
    case sym.round_ties_even_f128:
      [base_name, type_params] = ["llvm.rint", [bx.type_f128()]];
      break;

    case sym.roundf16:
      [base_name, type_params] = ["llvm.round", [bx.type_f16()]];
      break;
    case sym.roundf32:
      [base_name, type_params] = ["llvm.round", [bx.type_f32()]];
      break;
    case sym.roundf64:
      [base_name, type_params] = ["llvm.round", [bx.type_f64()]];
      break;
    case sym.roundf128:
      [base_name, type_params] = ["llvm.round", [bx.type_f128()]];
      break;

    default:
      return undefined;
  }
  return bx.call_intrinsic(
    base_name,
    type_params,
    args.map((arg) => arg.immediate(debug_Value)),
  );
}

// ---- impl<'ll, 'tcx> Builder<'_, 'll, 'tcx> (intrinsic.rs:141) ----
declare module "./builder.ts" {
  interface Builder {
    /** private (intrinsic.rs:142) */
    black_box(result: PlaceRef<Value>, span: Span): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:142 black_box
Builder.prototype.black_box = function (this: Builder, result: PlaceRef<Value>, span: Span): void {
  const result_val_span = [result.val.llval];
  // We need to "use" the argument in some way LLVM can't introspect, and on
  // targets that support it we can typically leverage inline assembly to do
  // this. LLVM's interpretation of inline assembly is that it's, well, a black
  // box. This isn't the greatest implementation since it probably deoptimizes
  // more than we want, but it's so far good enough.
  //
  // For zero-sized types, the location pointed to by the result may be
  // uninitialized. Do not "use" the result in this case; instead just clobber
  // the memory.
  const [constraint, inputs]: [string, readonly Value[]] = result.layout.is_zst() ? ["~{memory}", []] : ["r,~{memory}", result_val_span];
  const r = asm.inline_asm_call(this, "", constraint, inputs, this.type_void(), [], true, false, "Att", [span], false, undefined, undefined);
  if (r === undefined) bug("failed to generate inline asm call for `black_box`");
};

// ---- impl<'ll, 'tcx> IntrinsicCallBuilderMethods<'tcx> for Builder<'_, 'll, 'tcx> (intrinsic.rs:177) ----
declare module "./builder.ts" {
  interface Builder {
    codegen_intrinsic_call(instance: Instance, args: readonly OperandRef<Value>[], result_layout: TyAndLayout, result_place: PlaceValue<Value> | undefined, span: Span): IntrinsicResult<Value>;
    codegen_llvm_intrinsic_call(instance: Instance, args: readonly OperandRef<Value>[], is_cleanup: boolean): Value;
    abort_immediate(): void;
    assume(val: Value): void;
    expect(cond: Value, expected: boolean): Value;
    ctpop(val: Value): Value;
    type_checked_load(llvtable: Value, vtable_byte_offset: number, typeid: Uint8Array): Value;
    va_start(val: Value): void;
    retag_reg(ptr: Value, info: RetagInfo<Value>): Value;
    retag_mem(place: Value, info: RetagInfo<Value>): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:178 codegen_intrinsic_call
Builder.prototype.codegen_intrinsic_call = function (
  this: Builder,
  instance: Instance,
  args: readonly OperandRef<Value>[],
  result_layout: TyAndLayout,
  result_place: PlaceValue<Value> | undefined,
  span: Span,
): IntrinsicResult<Value> {
  const tcx = this.tcx;
  const llvm_version = llvm_util.get_version();

  const name = tcx.item_name(Instance.def_id(instance));
  const fn_args = instance.args;

  const simple = call_simple_intrinsic(this, name, args);
  let llval: Value;
  if (simple !== undefined) {
    llval = simple;
  } else {
    switch (name) {
      case sym.minimum_number_nsz_f16:
      case sym.minimum_number_nsz_f32:
      case sym.minimum_number_nsz_f64:
      case sym.minimum_number_nsz_f128:
      case sym.maximum_number_nsz_f16:
      case sym.maximum_number_nsz_f32:
      case sym.maximum_number_nsz_f64:
      case sym.maximum_number_nsz_f128: {
        const intrinsic_name = Symbol.as_str(name).startsWith("min") ? "llvm.minimumnum" : "llvm.maximumnum";
        const call = this.call_intrinsic(intrinsic_name, [args[0]!.layout.immediate_llvm_type(this.cx_)], [args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value)]);
        // `nsz` on minimumnum/maximumnum is special: its only effect is to make
        // signed-zero ordering non-deterministic.
        llvm.LLVMRustSetNoSignedZeros(call);
        llval = call;
        break;
      }
      case sym.ptr_mask: {
        const ptr = args[0]!.immediate(debug_Value);
        llval = this.call_intrinsic("llvm.ptrmask", [this.val_ty(ptr), this.type_isize()], [ptr, args[1]!.immediate(debug_Value)]);
        break;
      }
      case sym.autodiff: {
        return codegen_autodiff(this, instance, args, result_layout, result_place);
      }
      case sym.offload: {
        if (tcx.sess.opts.unstable_opts.offload.length === 0) {
          tcx.dcx().emit_err(OffloadWithoutEnable_diagnostic({}));
        }

        if (tcx.sess.lto() !== "Fat") {
          tcx.dcx().emit_err(OffloadWithoutFatLTO_diagnostic({}));
        }

        codegen_offload(this, tcx, instance, args);
        // offload *has* a return type, but somehow works without mentioning the place
        return { $: "WroteIntoPlace" };
      }
      case sym.offload_get_num_devices: {
        const [fn_decl, fn_ty] = declare_omp_get_num_devices(this.cx_);

        const llval_ = this.call(fn_ty, undefined, undefined, fn_decl, ReturnSlot.Direct, [], undefined, undefined);

        return { $: "Operand", _0: { $: "Immediate", _0: llval_ } };
      }
      case sym.is_val_statically_known: {
        const v0 = args[0]!.val;
        if (v0.$ === "Immediate") {
          const imm = v0._0;
          llval = this.call_intrinsic("llvm.is.constant", [args[0]!.layout.immediate_llvm_type(this.cx_)], [imm]);
        } else {
          llval = this.const_bool(false);
        }
        break;
      }
      case sym.select_unpredictable: {
        const cond = args[0]!.immediate(debug_Value);
        assert_eq(args[1]!.layout, args[2]!.layout, debug_layout, TyAndLayout_eq);
        const select = (bx: Builder, true_val: Value, false_val: Value): Value => {
          const result = bx.select(cond, true_val, false_val);
          bx.set_unpredictable(result);
          return result;
        };
        const a1 = args[1]!.val;
        const a2 = args[2]!.val;
        if (a1.$ === "Ref" && a2.$ === "Ref") {
          const true_val = a1._0;
          const false_val = a2._0;
          assert(true_val.llextra === undefined, "assertion failed: true_val.llextra.is_none()");
          assert(false_val.llextra === undefined, "assertion failed: false_val.llextra.is_none()");
          assert_eq(true_val.align, false_val.align, debug_align, Align_eq);
          const ptr = select(this, true_val.llval, false_val.llval);
          const selected: OperandValue<Value> = { $: "Ref", _0: PlaceValue.new_sized(ptr, true_val.align) };
          const result = new PlaceRef(unwrap_place(result_place), result_layout);
          OperandValue.store(selected, this, result);
          return { $: "WroteIntoPlace" };
        } else if ((a1.$ === "Immediate" && a2.$ === "Immediate") || (a1.$ === "Pair" && a2.$ === "Pair")) {
          const true_val = args[1]!.immediate_or_packed_pair(this);
          const false_val = args[2]!.immediate_or_packed_pair(this);
          llval = select(this, true_val, false_val);
        } else if (a1.$ === "ZeroSized" && a2.$ === "ZeroSized") {
          return { $: "Operand", _0: OperandValue.ZeroSized };
        } else {
          span_bug(span, "Incompatible OperandValue for select_unpredictable");
        }
        break;
      }
      case sym.catch_unwind:
        llval = catch_unwind_intrinsic(this, args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), args[2]!.immediate(debug_Value));
        break;
      case sym.breakpoint:
        llval = this.call_intrinsic("llvm.debugtrap", [], []);
        break;
      case sym.va_arg: {
        const target = this.cx_.tcx.sess.target;
        const stability = target.supports_c_variadic_definitions();
        if (stability.$ === "Unstable" && !this.tcx.features().enabled(stability.feature)) {
          const feature = stability.feature;
          const msg = "C-variadic function definitions on this target are unstable";
          feature_err(this.sess(), feature, span, msg).emit();
        }

        const br = result_layout.backend_repr;
        if (br.$ !== "Scalar") {
          bug("the va_arg intrinsic does not support non-scalar types");
        }
        const scalar = br._0;

        // We reject types that would never be passed as varargs in C because
        // they get promoted to a larger type, specifically integers smaller than
        // c_int and float type smaller than c_double.
        const prim: Primitive = Scalar.primitive(scalar);
        switch (prim.$) {
          case "Pointer": {
            // Pointers are always OK.
            break;
          }
          case "Int": {
            const int_width = this.cx().size_of(result_layout.ty).bits();
            const target_c_int_width = this.cx().sess().target.c_int_width;
            if (int_width < target_c_int_width) {
              // Smaller integer types are automatically promototed and `va_arg`
              // should not be called on them.
              bug(`va_arg got i${int_width} but needs at least c_int (an i${target_c_int_width})`);
            }
            break;
          }
          case "Float": {
            const f: Float = prim._0;
            switch (f) {
              case "F16":
                bug("the va_arg intrinsic does not support `f16`");
                break;
              case "F16B":
                bug("the va_arg intrinsic does not support `f16b`");
                break;
              case "F32": {
                // c_double is actually f32 on avr.
                if (this.cx().sess().target.arch.$ !== "Avr") {
                  bug("the va_arg intrinsic does not support `f32` on this target");
                }
                break;
              }
              case "F64": {
                // 64-bit floats are always OK.
                break;
              }
              case "F128": {
                // Supported on some targets, especially where long double is IEEE f128.
                break;
              }
              case "PpcF128": {
                // FIXME(ppcf128) we should support this.
                bug("the va_arg intrinsic does not currently support `ppcf128`");
                break;
              }
            }
            break;
          }
        }

        llval = emit_va_arg(this, args[0]!, result_layout);
        break;
      }

      case sym.volatile_load:
      case sym.unaligned_volatile_load: {
        // Note that we cannot just load the `llvm_type` because we should never load non-scalars.
        // Trying to do so blows up horribly in some cases -- for example loading a
        // `MaybeUninint<&dyn Trait>` would load as `{ [i64x2] }` which gives assertions later
        // (if we're lucky) from things not being pointers that ought to be.
        const ptr = args[0]!.immediate(debug_Value);
        const abi_align = result_layout.align.abi;
        const ptr_align = name === sym.volatile_load ? abi_align : Align.ONE;
        const need_black_box = version_lt(llvm_version, [23, 0, 0]);
        const br = result_layout.backend_repr;
        if (result_layout.is_zst()) {
          return { $: "Operand", _0: OperandValue.ZeroSized };
        } else if (br.$ === "Scalar" && !need_black_box) {
          const scalar = br._0;
          const load = this.volatile_load(this.type_from_scalar(scalar), ptr, ptr_align);
          llval = this.to_immediate_scalar(load, scalar);
        } else {
          // One day Rust will probably want to define how we split up a volatile load
          // of something that's *not* just an ordinary scalar, but for now we can just
          // use an LLVM integer type of the correct width and let it split it however.
          const llty = this.type_ix(result_layout.size.bits());
          const temp = result_place !== undefined ? new PlaceRef(result_place, result_layout) : PlaceRef.alloca(this, result_layout);
          const llval_ = this.volatile_load(llty, ptr, ptr_align);
          this.store_inherent(llval_, temp.val.llval, abi_align);
          if (need_black_box) {
            // LLVM up until v22 considers volatile reads `willreturn` and hence can
            // move UB from further down up across this read. To prevent that, insert an
            // inline asm block that, as far as LLVM is concerned, might not terminate,
            // and hence should prevent such reordering.
            this.black_box(temp, span);
          }
          return result_place === undefined ? { $: "Operand", _0: this.load_operand(temp).val } : { $: "WroteIntoPlace" };
        }
        break;
      }
      case sym.prefetch_read_data:
      case sym.prefetch_write_data:
      case sym.prefetch_read_instruction:
      case sym.prefetch_write_instruction: {
        let rw: number;
        let cache_type: number;
        switch (name) {
          case sym.prefetch_read_data:
            [rw, cache_type] = [0, 1];
            break;
          case sym.prefetch_write_data:
            [rw, cache_type] = [1, 1];
            break;
          case sym.prefetch_read_instruction:
            [rw, cache_type] = [0, 0];
            break;
          case sym.prefetch_write_instruction:
            [rw, cache_type] = [1, 0];
            break;
          default:
            bug();
        }
        const ptr = args[0]!.immediate(debug_Value);
        const locality = fn_args.const_at(1).to_leaf().to_i32();
        this.call_intrinsic("llvm.prefetch.p0", [this.val_ty(ptr)], [ptr, this.const_i32(rw), this.const_i32(locality), this.const_i32(cache_type)]);
        return { $: "Operand", _0: OperandValue.ZeroSized };
      }
      case sym.carrying_mul_add: {
        const [size, signed] = fn_args.type_at(0).int_size_and_signed(this.tcx);

        const wide_llty = this.type_ix(size.bits() * 2);
        // `args.as_array().unwrap()`: exactly four operands.
        if (args.length !== 4) panic("called `Option::unwrap()` on a `None` value");
        const [a, b, c, d] = args.map((a_) => this.intcast(a_.immediate(debug_Value), wide_llty, signed)) as [Value, Value, Value, Value];

        let wide: Value;
        if (signed) {
          const prod = this.unchecked_smul(a, b);
          const acc = this.unchecked_sadd(prod, c);
          wide = this.unchecked_sadd(acc, d);
        } else {
          const prod = this.unchecked_umul(a, b);
          const acc = this.unchecked_uadd(prod, c);
          wide = this.unchecked_uadd(acc, d);
        }

        const narrow_llty = this.type_ix(size.bits());
        const low = this.trunc_inherent(wide, narrow_llty);
        const bits_const = this.const_uint(wide_llty, BigInt(size.bits()));
        // No need for ashr when signed; LLVM changes it to lshr anyway.
        const high0 = this.lshr(wide, bits_const);
        // FIXME: could be `trunc nuw`, even for signed.
        const high = this.trunc_inherent(high0, narrow_llty);

        const pair_llty = this.type_struct([narrow_llty, narrow_llty], false);
        const pair0 = this.const_poison(pair_llty);
        const pair1 = this.insert_value(pair0, low, 0);
        const pair = this.insert_value(pair1, high, 1);
        llval = pair;
        break;
      }

      case sym.ctlz:
      case sym.ctlz_nonzero:
      case sym.cttz:
      case sym.cttz_nonzero:
      case sym.ctpop:
      case sym.bswap:
      case sym.bitreverse:
      case sym.carryless_mul:
      case sym.integer_max:
      case sym.integer_min:
      case sym.saturating_add:
      case sym.saturating_sub:
      case sym.unchecked_funnel_shl:
      case sym.unchecked_funnel_shr: {
        const ty = args[0]!.layout.ty;
        if (!ty.is_integral()) {
          const err = tcx.dcx().emit_err(InvalidMonomorphization_diagnostic({ $: "BasicIntegerType", span, name, ty }));
          return { $: "Err", _0: err };
        }
        const [size, signed] = ty.int_size_and_signed(this.tcx);
        const width = size.bits();
        const llty = this.type_ix(width);
        switch (name) {
          case sym.ctlz:
          case sym.ctlz_nonzero:
          case sym.cttz:
          case sym.cttz_nonzero: {
            const y = this.const_bool(name === sym.ctlz_nonzero || name === sym.cttz_nonzero);
            const llvm_name = name === sym.ctlz || name === sym.ctlz_nonzero ? "llvm.ctlz" : "llvm.cttz";
            const ret = this.call_intrinsic(llvm_name, [llty], [args[0]!.immediate(debug_Value), y]);
            llval = this.intcast(ret, result_layout.llvm_type(this.cx_), false);
            break;
          }
          case sym.ctpop:
            llval = this.ctpop(args[0]!.immediate(debug_Value));
            break;
          case sym.bswap: {
            if (width === 8) {
              llval = args[0]!.immediate(debug_Value); // byte swap a u8/i8 is just a no-op
            } else {
              llval = this.call_intrinsic("llvm.bswap", [llty], [args[0]!.immediate(debug_Value)]);
            }
            break;
          }
          case sym.bitreverse:
            llval = this.call_intrinsic("llvm.bitreverse", [llty], [args[0]!.immediate(debug_Value)]);
            break;
          case sym.carryless_mul: {
            const lhs = args[0]!.immediate(debug_Value);
            const rhs = args[1]!.immediate(debug_Value);
            llval = this.call_intrinsic("llvm.clmul", [llty], [lhs, rhs]);
            break;
          }
          case sym.integer_min:
          case sym.integer_max: {
            const lhs = args[0]!.immediate(debug_Value);
            const rhs = args[1]!.immediate(debug_Value);
            let llvm_name: string;
            if (name === sym.integer_max && !signed) llvm_name = "llvm.umax";
            else if (name === sym.integer_max && signed) llvm_name = "llvm.smax";
            else if (name === sym.integer_min && !signed) llvm_name = "llvm.umin";
            else if (name === sym.integer_min && signed) llvm_name = "llvm.smin";
            else bug();
            llval = this.call_intrinsic(llvm_name, [llty], [lhs, rhs]);
            break;
          }
          case sym.unchecked_funnel_shl:
          case sym.unchecked_funnel_shr: {
            const is_left = name === sym.unchecked_funnel_shl;
            const lhs = args[0]!.immediate(debug_Value);
            const rhs = args[1]!.immediate(debug_Value);
            const raw_shift0 = args[2]!.immediate(debug_Value);
            const llvm_name = `llvm.fsh${is_left ? "l" : "r"}`;

            // llvm expects shift to be the same type as the values, but rust
            // always uses `u32`.
            const raw_shift = this.intcast(raw_shift0, this.val_ty(lhs), false);

            llval = this.call_intrinsic(llvm_name, [llty], [lhs, rhs, raw_shift]);
            break;
          }
          case sym.saturating_add:
          case sym.saturating_sub: {
            const is_add = name === sym.saturating_add;
            const lhs = args[0]!.immediate(debug_Value);
            const rhs = args[1]!.immediate(debug_Value);
            const llvm_name = `llvm.${signed ? "s" : "u"}${is_add ? "add" : "sub"}.sat`;
            llval = this.call_intrinsic(llvm_name, [llty], [lhs, rhs]);
            break;
          }
          default:
            bug();
        }
        break;
      }

      case sym.fabs:
      case sym.exp:
      case sym.exp2:
      case sym.log:
      case sym.log10:
      case sym.log2:
      case sym.sin:
      case sym.cos: {
        const ty = args[0]!.layout.ty;
        const kind = ty.kind();
        if (kind.$ !== "Float") {
          span_bug(span, `the \`${Symbol.as_str(name)}\` intrinsic requires a floating-point argument, got ${debug_ty(ty)}`);
        }
        const f = kind._0;
        const llty = this.type_float_from_ty(f);
        let llvm_name: string;
        switch (name) {
          case sym.fabs:
            llvm_name = "llvm.fabs";
            break;
          case sym.exp:
            llvm_name = "llvm.exp";
            break;
          case sym.exp2:
            llvm_name = "llvm.exp2";
            break;
          case sym.log:
            llvm_name = "llvm.log";
            break;
          case sym.log10:
            llvm_name = "llvm.log10";
            break;
          case sym.log2:
            llvm_name = "llvm.log2";
            break;
          case sym.sin:
            llvm_name = "llvm.sin";
            break;
          case sym.cos:
            llvm_name = "llvm.cos";
            break;
          default:
            bug();
        }
        llval = this.call_intrinsic(
          llvm_name,
          [llty],
          args.map((arg) => arg.immediate(debug_Value)),
        );
        break;
      }

      case sym.raw_eq: {
        // use BackendRepr::*;
        const tp_ty = fn_args.type_at(0);
        const layout = this.layout_of(tp_ty).layout;
        let use_integer_compare: boolean;
        const repr: BackendRepr = layout.backend_repr();
        switch (repr.$) {
          case "Scalar":
          case "ScalarPair":
            use_integer_compare = true;
            break;
          case "SimdVector":
            use_integer_compare = false;
            break;
          case "SimdScalableVector": {
            const err = tcx.dcx().emit_err(InvalidMonomorphization_diagnostic({ $: "NonScalableType", span, name: sym.raw_eq, ty: tp_ty }));
            return { $: "Err", _0: err };
          }
          case "Memory": {
            // For rusty ABIs, small aggregates are actually passed
            // as `RegKind::Integer` (see `FnAbi::adjust_for_abi`),
            // so we re-use that same threshold here.
            use_integer_compare = Size_cmp(layout.size(), this.data_layout().pointer_size().mul(2)) <= 0;
            break;
          }
        }

        const a = args[0]!.immediate(debug_Value);
        const b = args[1]!.immediate(debug_Value);
        if (layout.size().bytes() === 0) {
          llval = this.const_bool(true);
        } else if (use_integer_compare) {
          const integer_ty = this.type_ix(layout.size().bits());
          const a_val = this.load_inherent(integer_ty, a, layout.align().abi);
          const b_val = this.load_inherent(integer_ty, b, layout.align().abi);
          llval = this.icmp(IntPredicate.IntEQ, a_val, b_val);
        } else {
          const n = this.const_usize(layout.size().bytes_u64());
          const cmp = this.call_intrinsic("memcmp", [], [a, b, n]);
          llval = this.icmp(IntPredicate.IntEQ, cmp, this.const_int(this.type_int(), 0n));
        }
        break;
      }

      case sym.compare_bytes: {
        // Here we assume that the `memcmp` provided by the target is a NOP for size 0.
        const cmp = this.call_intrinsic("memcmp", [], [args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), args[2]!.immediate(debug_Value)]);
        // Some targets have `memcmp` returning `i16`, but the intrinsic is always `i32`.
        llval = this.sext(cmp, this.type_ix(32));
        break;
      }

      case sym.black_box: {
        // This `unwrap` is justified by `intrinsic_call_expects_place_always` declaring
        // this intrinsic as always needing a return place.
        const result = new PlaceRef(unwrap_place(result_place), result_layout);
        OperandValue.store(args[0]!.val, this, result);
        this.black_box(result, span);

        // We have copied the value to `result` already.
        return { $: "WroteIntoPlace" };
      }

      case sym.gpu_launch_sized_workgroup_mem: {
        // Generate an anonymous global per call, with these properties:
        // 1. The global is in the address space for workgroup memory
        // 2. It is an `external` global
        // 3. It is correctly aligned for the pointee `T`
        // All instances of extern addrspace(gpu_workgroup) globals are merged in the LLVM backend.
        // The name is irrelevant.
        // See https://docs.nvidia.com/cuda/cuda-c-programming-guide/#shared
        const name_ =
          version_lt(llvm_version, [23, 0, 0]) && tcx.sess.target.arch.$ === "Nvptx64"
            ? // The auto-assigned name for extern shared globals in the nvptx backend does
              // not compile in ptxas. Workaround this issue by assigning a name.
              // Fixed in LLVM 23.
              "gpu_launch_sized_workgroup_mem"
            : "";
        const global = this.declare_global_in_addrspace(name_, this.type_array(this.type_i8(), 0n), AddressSpace.GPU_WORKGROUP);
        const kind = result_layout.ty.kind();
        if (kind.$ !== "RawPtr") unreachable();
        const inner_ty = kind._0;
        // The alignment of the global is used to specify the *minimum* alignment that
        // must be obeyed by the GPU runtime.
        // When multiple of these global variables are used by a kernel, the maximum alignment is taken.
        // See https://github.com/llvm/llvm-project/blob/a271d07488a85ce677674bbe8101b10efff58c95/llvm/lib/Target/AMDGPU/AMDGPULowerModuleLDSPass.cpp#L821
        const alignment = this.align_of(inner_ty).bytes() >>> 0;
        // FIXME Workaround the above issue by taking maximum alignment if the global existed
        if (tcx.sess.target.arch.$ === "Nvptx64") {
          if (alignment > llvm.LLVMGetAlignment(global)) {
            llvm.LLVMSetAlignment(global, alignment);
          }
        } else {
          llvm.LLVMSetAlignment(global, alignment);
        }
        llval = this.cx().const_pointercast(global, this.type_ptr());
        break;
      }

      case sym.amdgpu_dispatch_ptr: {
        const val = this.call_intrinsic("llvm.amdgcn.dispatch.ptr", [], []);
        // Relying on `LLVMBuildPointerCast` to produce an addrspacecast
        llval = this.pointercast(val, this.type_ptr());
        break;
      }

      case sym.sve_tuple_create2: {
        assert_scalable(this.layout_of(fn_args.type_at(0)).backend_repr, [1], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(1), .. }");
        const tuple_ty = this.layout_of(fn_args.type_at(1));
        assert_scalable(tuple_ty.backend_repr, [2], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(2), .. }");
        const ret0 = this.const_poison(this.backend_type(tuple_ty));
        const ret1 = this.insert_value(ret0, args[0]!.immediate(debug_Value), 0);
        llval = this.insert_value(ret1, args[1]!.immediate(debug_Value), 1);
        break;
      }

      case sym.sve_tuple_create3: {
        assert_scalable(this.layout_of(fn_args.type_at(0)).backend_repr, [1], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(1), .. }");
        const tuple_ty = this.layout_of(fn_args.type_at(1));
        assert_scalable(tuple_ty.backend_repr, [3], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(3), .. }");
        const ret0 = this.const_poison(this.backend_type(tuple_ty));
        const ret1 = this.insert_value(ret0, args[0]!.immediate(debug_Value), 0);
        const ret2 = this.insert_value(ret1, args[1]!.immediate(debug_Value), 1);
        llval = this.insert_value(ret2, args[2]!.immediate(debug_Value), 2);
        break;
      }

      case sym.sve_tuple_create4: {
        assert_scalable(this.layout_of(fn_args.type_at(0)).backend_repr, [1], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(1), .. }");
        const tuple_ty = this.layout_of(fn_args.type_at(1));
        assert_scalable(tuple_ty.backend_repr, [4], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(4), .. }");
        const ret0 = this.const_poison(this.backend_type(tuple_ty));
        const ret1 = this.insert_value(ret0, args[0]!.immediate(debug_Value), 0);
        const ret2 = this.insert_value(ret1, args[1]!.immediate(debug_Value), 1);
        const ret3 = this.insert_value(ret2, args[2]!.immediate(debug_Value), 2);
        llval = this.insert_value(ret3, args[3]!.immediate(debug_Value), 3);
        break;
      }

      case sym.sve_tuple_get: {
        assert_scalable(this.layout_of(fn_args.type_at(0)).backend_repr, [2, 3, 4, 5, 6, 7, 8], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(2 | 3 | 4 | 5 | 6 | 7 | 8), .. }");
        assert_scalable(this.layout_of(fn_args.type_at(1)).backend_repr, [1], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(1), .. }");
        // `to_i32() as u64`
        llval = this.extract_value(args[0]!.immediate(debug_Value), as_u64_index(fn_args.const_at(2).to_leaf().to_i32()));
        break;
      }

      case sym.sve_tuple_set: {
        assert_scalable(this.layout_of(fn_args.type_at(0)).backend_repr, [2, 3, 4, 5, 6, 7, 8], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(2 | 3 | 4 | 5 | 6 | 7 | 8), .. }");
        assert_scalable(this.layout_of(fn_args.type_at(1)).backend_repr, [1], "BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(1), .. }");
        llval = this.insert_value(args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), as_u64_index(fn_args.const_at(2).to_leaf().to_i32()));
        break;
      }

      default: {
        if (Symbol.as_str(name).startsWith("simd_")) {
          // Unpack non-power-of-2 #[repr(packed, simd)] arguments.
          // This gives them the expected layout of a regular #[repr(simd)] vector.
          const loaded_args: OperandRef<Value>[] = [];
          for (const arg of args) {
            const argv = arg.val;
            loaded_args.push(
              // #[repr(packed, simd)] vectors are passed like arrays (as references,
              // with reduced alignment and no padding) rather than as immediates.
              // We can use a vector load to fix the layout and turn the argument
              // into an immediate.
              arg.layout.ty.is_simd() && argv.$ === "Ref"
                ? (() => {
                    const place = argv._0;
                    const [size, elem_ty] = arg.layout.ty.simd_size_and_type(this.tcx);
                    const elem_ll_ty = simd_elem_ll_ty(this, elem_ty);
                    const loaded = this.load_from_place(this.type_vector(elem_ll_ty, size), place);
                    return OperandRef.from_immediate_or_packed_pair(this, loaded, arg.layout);
                  })()
                : arg,
            );
          }

          let llret_ty: Type;
          if (result_layout.ty.is_simd() && result_layout.backend_repr.$ === "Memory") {
            const [size, elem_ty] = result_layout.ty.simd_size_and_type(this.tcx);
            const elem_ll_ty = simd_elem_ll_ty(this, elem_ty);
            llret_ty = this.type_vector(elem_ll_ty, size);
          } else {
            llret_ty = result_layout.llvm_type(this.cx_);
          }

          const r = generic_simd_intrinsic(this, name, fn_args, loaded_args, result_layout.ty, llret_ty, span);
          if (r.$ === "Ok") {
            llval = r._0;
          } else {
            // If there was an error, just skip this invocation... we'll abort compilation
            // anyway, but we can keep codegen'ing to find more errors.
            return { $: "Err", _0: r._0 };
          }
        } else if (name === sym.return_address) {
          switch (this.sess().target.arch.$) {
            // Expand this list as needed
            case "Wasm32":
            case "Wasm64": {
              const ty = this.type_ptr();
              llval = this.const_null_inherent(ty);
              break;
            }
            default: {
              const ty = this.type_ix(32);
              const val = this.const_int(ty, 0n);

              const type_params: Type[] = version_lt(llvm_version, [23, 0, 0]) ? [] : [this.type_ptr()];

              llval = this.call_intrinsic("llvm.returnaddress", type_params, [val]);
              break;
            }
          }
        } else {
          // debug!("unknown intrinsic '{}' -- falling back to default body", name);
          // Call the fallback body instead of generating the intrinsic code
          const fallback = Instance.new_raw(Instance.def_id(instance), instance.args);
          return { $: "Fallback", _0: fallback };
        }
        break;
      }
    }
  }

  if (result_layout.backend_repr.$ === "Memory") {
    // We have an llvm immediate, but that's not what cg_ssa expects,
    // so write it into the place (that always exists for memory)
    if (!result_layout.is_zst()) {
      this.store_to_place(llval, unwrap_place(result_place));
    }
    return { $: "WroteIntoPlace" };
  } else {
    return { $: "Operand", _0: OperandRef.from_immediate_or_packed_pair(this, llval, result_layout).val };
  }
};

/** `ty::Float(f) => self.type_float_from_ty(*f), ty::Int(i) => .., ty::Uint(u) => .., ty::RawPtr(_, _) => self.type_ptr(), _ =>
 *  unreachable!()`, written twice in the `simd_` arm (intrinsic.rs:845, :868). */
function simd_elem_ll_ty(bx: Builder, elem_ty: Ty): Type {
  const k = elem_ty.kind();
  switch (k.$) {
    case "Float":
      return bx.type_float_from_ty(k._0);
    case "Int":
      return bx.type_int_from_ty(k._0);
    case "Uint":
      return bx.type_uint_from_ty(k._0);
    case "RawPtr":
      return bx.type_ptr();
    default:
      return unreachable();
  }
}

/** `assert_matches!(repr, BackendRepr::SimdScalableVector { number_of_vectors: NumScalableVectors(n), .. })` for `n` in `ns`. */
function assert_scalable(repr: BackendRepr, ns: readonly number[], pat: string): void {
  if (repr.$ === "SimdScalableVector" && ns.includes(repr.number_of_vectors)) return;
  // PORT: `assert_matches!`'s message prints the value with `{:?}` (`left: <value>`); BackendRepr's Debug is not reached by any
  // compile the port runs (these are SVE intrinsics), so the stop names the pattern instead of guessing the text.
  return unported(`rustc_codegen_llvm::intrinsic: assert_matches! failure message (Debug of BackendRepr) for ${pat}`);
}

/** `to_i32() as u64` of an index (a tuple field index: small and non-negative in any valid program). */
function as_u64_index(i: number): number {
  return i >= 0 ? i : unported("rustc_codegen_llvm::intrinsic: `i32 as u64` of a negative index (2^64 + i)");
}

/** `result_place.unwrap()` */
function unwrap_place(p: PlaceValue<Value> | undefined): PlaceValue<Value> {
  return p ?? panic("called `Option::unwrap()` on a `None` value");
}

const debug_layout = (v: TyAndLayout): string => debug_TyAndLayout_Ty(v, PLAIN);
const debug_align = (v: Align): string => debug_Align(v, PLAIN);
const debug_ty = (t: Ty): string => debug_Ty(t, PLAIN);
const debug_def_id = (d: DefId): string => debug_DefId(d, PLAIN);
const debug_args = (a: GenericArgsRef): string => debug_GenericArgs(a, PLAIN);

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:911 codegen_llvm_intrinsic_call
Builder.prototype.codegen_llvm_intrinsic_call = function (this: Builder, instance: Instance, args: readonly OperandRef<Value>[], _is_cleanup: boolean): Value {
  const tcx = this.tcx;

  const fn_ty0 = Instance.ty(instance, tcx, this.typing_env_());
  const k = fn_ty0.kind();
  let fn_sig;
  if (k.$ === "FnDef") {
    const def_id = k._0;
    const args_ = k._1;
    fn_sig = tcx.instantiate_bound_regions_with_erased(fn_sig_instantiate(tcx, def_id, unwrap_no_bound_vars(args_)), fold_FnSig);
  } else {
    unreachable();
  }
  assert(!FnSig.c_variadic(fn_sig), "assertion failed: !fn_sig.c_variadic()");

  const ret_layout = this.layout_of(FnSig.output(fn_sig));
  const llreturn_ty = ret_layout.is_zst() ? this.type_void() : ret_layout.immediate_llvm_type(this.cx_);

  const llargument_tys: Type[] = [];
  for (const arg of FnSig.inputs(fn_sig)) {
    const arg_layout = this.layout_of(arg);
    if (arg_layout.is_zst()) {
      continue;
    }
    llargument_tys.push(arg_layout.immediate_llvm_type(this.cx_));
  }

  let fn_ptr: Value;
  const cached = this.cx_.intrinsic_instances.get(instance);
  if (cached !== undefined) {
    fn_ptr = cached;
  } else {
    const sym_ = tcx.symbol_name(instance).name;

    const declared = this.get_declared_value(sym_);
    const llfn = declared !== undefined ? declared : intrinsic_fn(this, sym_, llreturn_ty, llargument_tys, instance);

    this.cx_.intrinsic_instances.set(instance, llfn);

    fn_ptr = llfn;
  }
  const fn_ty = this.get_type_of_global(fn_ptr);

  const llargs: Value[] = [];

  for (const arg of args) {
    const v = arg.val;
    switch (v.$) {
      case "ZeroSized":
        break;
      case "Immediate":
        llargs.push(v._0);
        break;
      case "Pair":
        llargs.push(v._0);
        llargs.push(v._1);
        break;
      case "Ref": {
        const op_place_val = v._0;
        let llval = op_place_val.llval;
        // We can't use `PlaceRef::load` here because the argument
        // may have a type we don't treat as immediate, but the ABI
        // used for this call is passing it by-value. In that case,
        // the load would just produce `OperandValue::Ref` instead
        // of the `OperandValue::Immediate` we need for the call.
        llval = this.load_inherent(this.backend_type(arg.layout), llval, op_place_val.align);
        const br = arg.layout.backend_repr;
        if (br.$ === "Scalar") {
          const scalar = br._0;
          if (Scalar.is_bool(scalar)) {
            this.range_metadata(llval, new WrappingRange(0n, 1n));
          }
          // We store bools as `i8` so we need to truncate to `i1`.
          llval = this.to_immediate_scalar(llval, scalar);
        }
        llargs.push(llval);
        break;
      }
    }
  }

  // debug!("call intrinsic {:?} with args ({:?})", instance, llargs);

  const params = this.func_params_types(fn_ty);
  for (let i = 0; i < Math.min(params.length, llargs.length); i++) {
    const dest_ty = params[i]!;
    const arg = llargs[i]!;
    const src_ty = this.val_ty(arg);
    assert(can_autocast(this.cx_, src_ty, dest_ty), () => `Cannot match \`${debug_Type(dest_ty, PLAIN)}\` (expected) with ${debug_Type(src_ty, PLAIN)} (found) in \`${debug_Value(fn_ptr, PLAIN)}`);

    llargs[i] = autocast(this, arg, src_ty, dest_ty);
  }

  const llret = llvm.LLVMBuildCallWithOperandBundles(this.llbuilder, fn_ty, fn_ptr, llargs, llargs.length >>> 0, [], 0, "");

  const src_ty = this.val_ty(llret);
  const dest_ty = llreturn_ty;
  assert(can_autocast(this.cx_, dest_ty, src_ty), () => `Cannot match \`${debug_Type(src_ty, PLAIN)}\` (expected) with \`${debug_Type(dest_ty, PLAIN)}\` (found) in \`${debug_Value(fn_ptr, PLAIN)}\``);

  return autocast(this, llret, src_ty, dest_ty);
};

/** `args.no_bound_vars().unwrap()` of a `ty::FnDef`'s args. */
function unwrap_no_bound_vars(args: Binder<GenericArgsRef>): GenericArgsRef {
  return Binder.no_bound_vars(args, fold_GenericArgs) ?? panic("called `Option::unwrap()` on a `None` value");
}

/** `tcx.fn_sig(def_id).instantiate(tcx, args).skip_norm_wip()` (queries.gen.ts types the query's value `unknown`; it is
 *  `EarlyBinder<PolyFnSig>`). */
function fn_sig_instantiate(tcx: TyCtxt, def_id: DefId, args: GenericArgsRef): PolyFnSig {
  return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>, tcx, args, fold_Binder(fold_FnSig)));
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1026 abort_immediate
Builder.prototype.abort_immediate = function (this: Builder): void {
  this.call_intrinsic("llvm.trap", [], []);
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1030 assume
Builder.prototype.assume = function (this: Builder, val: Value): void {
  if (this.cx_.sess().opts.optimize !== "No") {
    this.call_intrinsic("llvm.assume", [], [val]);
  }
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1036 expect
Builder.prototype.expect = function (this: Builder, cond: Value, expected: boolean): Value {
  if (this.cx_.sess().opts.optimize !== "No") {
    return this.call_intrinsic("llvm.expect", [this.type_i1()], [cond, this.const_bool(expected)]);
  } else {
    return cond;
  }
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1048 ctpop
Builder.prototype.ctpop = function (this: Builder, val: Value): Value {
  const ret = this.call_intrinsic("llvm.ctpop", [this.val_ty(val)], [val]);
  return this.intcast(ret, this.type_i32(), false);
};

/** `vtable_byte_offset: u64` (a vtable offset, far below 2^53) */
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1053 type_checked_load
Builder.prototype.type_checked_load = function (this: Builder, llvtable: Value, vtable_byte_offset: number, typeid0: Uint8Array): Value {
  const typeid1 = this.create_metadata(typeid0);
  const typeid = this.get_metadata_value(typeid1);
  // `vtable_byte_offset as i32`
  const vtable_byte_offset_ = this.const_i32(vtable_byte_offset | 0);
  const type_checked_load = this.call_intrinsic("llvm.type.checked.load", [], [llvtable, vtable_byte_offset_, typeid]);
  return this.extract_value(type_checked_load, 0);
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1070 va_start
Builder.prototype.va_start = function (this: Builder, va_list: Value): void {
  this.call_intrinsic("llvm.va_start", [this.val_ty(va_list)], [va_list]);
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1074 retag_reg
Builder.prototype.retag_reg = function (this: Builder, ptr: Value, info: RetagInfo<Value>): Value {
  return codegen_retag_inner(this, "__rust_retag_reg", ptr, info);
};

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1078 retag_mem
Builder.prototype.retag_mem = function (this: Builder, ptr: Value, info: RetagInfo<Value>): void {
  codegen_retag_inner(this, "__rust_retag_mem", ptr, info);
};

// Compile-time check: `Builder` implements the trait with the members above.
type _CheckIntrinsicCallBuilderMethods = Builder extends IntrinsicCallBuilderMethods<import("./common.ts").LlvmTypes> ? true : never;
const _check_intrinsic_call_builder_methods: _CheckIntrinsicCallBuilderMethods = true;
void _check_intrinsic_call_builder_methods;

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1083 llvm_arch_for
function llvm_arch_for(rust_arch: Arch): string | undefined {
  switch (rust_arch.$) {
    case "AArch64":
    case "Arm64EC":
      return "aarch64";
    case "AmdGpu":
      return "amdgcn";
    case "Arm":
      return "arm";
    case "Bpf":
      return "bpf";
    case "Hexagon":
      return "hexagon";
    case "LoongArch32":
    case "LoongArch64":
      return "loongarch";
    case "Mips":
    case "Mips32r6":
    case "Mips64":
    case "Mips64r6":
      return "mips";
    case "Nvptx64":
      return "nvvm";
    case "PowerPC":
    case "PowerPC64":
      return "ppc";
    case "RiscV32":
    case "RiscV64":
      return "riscv";
    case "S390x":
      return "s390";
    case "SpirV":
      return "spv";
    case "Wasm32":
    case "Wasm64":
      return "wasm";
    case "X86":
    case "X86_64":
      return "x86";
    default:
      return undefined; // fallback for unknown archs
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1103 can_autocast
function can_autocast(cx: CodegenCx, rust_ty: Type, llvm_ty: Type): boolean {
  if (rust_ty === llvm_ty) {
    return true;
  }

  const kind = cx.type_kind(llvm_ty);
  // Some LLVM intrinsics return **non-packed** structs, but they can't be mimicked from Rust
  // due to auto field-alignment in non-packed structs (packed structs are represented in LLVM
  // as, well, packed structs, so they won't match with those either)
  if (kind === TypeKind.Struct && cx.type_kind(rust_ty) === TypeKind.Struct) {
    const rust_element_tys = cx.struct_element_types(rust_ty);
    const llvm_element_tys = cx.struct_element_types(llvm_ty);

    if (rust_element_tys.length !== llvm_element_tys.length) {
      return false;
    }

    return rust_element_tys.every((rust_element_ty, i) => can_autocast(cx, rust_element_ty, llvm_element_tys[i]!));
  } else if (kind === TypeKind.Vector) {
    const llvm_element_ty = cx.element_type(llvm_ty);
    const element_count = cx.vector_length(llvm_ty);

    if (llvm_element_ty === cx.type_bf16()) {
      return rust_ty === cx.type_vector(cx.type_i16(), element_count);
    } else if (llvm_element_ty === cx.type_i1()) {
      const int_width = Math.max(next_power_of_two(element_count), 8);
      return rust_ty === cx.type_ix(int_width);
    } else {
      return false;
    }
  } else if (kind === TypeKind.BFloat) {
    return rust_ty === cx.type_i16();
  } else if (kind === TypeKind.X86_AMX && cx.type_kind(rust_ty) === TypeKind.Vector) {
    const element_ty = cx.element_type(rust_ty);
    const element_count = cx.vector_length(rust_ty);

    let element_size_bits: number;
    switch (cx.type_kind(element_ty)) {
      case TypeKind.Half:
        element_size_bits = 16;
        break;
      case TypeKind.Float:
        element_size_bits = 32;
        break;
      case TypeKind.Double:
        element_size_bits = 64;
        break;
      case TypeKind.FP128:
        element_size_bits = 128;
        break;
      case TypeKind.Integer:
        element_size_bits = cx.int_width(element_ty);
        break;
      case TypeKind.Pointer:
        element_size_bits = cx.int_width(cx.isize_ty());
        break;
      default:
        bug(`Vector element type \`${debug_Type(element_ty, PLAIN)}\` not one of integer, float or pointer`);
    }

    return element_size_bits * element_count === 8192;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1162 autocast
function autocast(bx: Builder, val: Value, src_ty: Type, dest_ty: Type): Value {
  if (src_ty === dest_ty) {
    return val;
  }
  const sk = bx.type_kind(src_ty);
  const dk = bx.type_kind(dest_ty);
  // re-pack structs
  if (sk === TypeKind.Struct && dk === TypeKind.Struct) {
    let ret = bx.const_poison(dest_ty);
    const src_elts = bx.struct_element_types(src_ty);
    const dest_elts = bx.struct_element_types(dest_ty);
    for (let idx = 0; idx < Math.min(src_elts.length, dest_elts.length); idx++) {
      const src_element_ty = src_elts[idx]!;
      const dest_element_ty = dest_elts[idx]!;
      const elt = bx.extract_value(val, idx);
      const casted_elt = autocast(bx, elt, src_element_ty, dest_element_ty);
      ret = bx.insert_value(ret, casted_elt, idx);
    }
    return ret;
  }
  // cast from the i1xN vector type to the primitive type
  else if (sk === TypeKind.Vector && dk === TypeKind.Integer && bx.element_type(src_ty) === bx.type_i1()) {
    const vector_length = bx.vector_length(src_ty);
    const int_width = Math.max(next_power_of_two(vector_length), 8);

    let val_: Value;
    if (vector_length === int_width) {
      val_ = val;
    } else {
      // zero-extends vector
      let shuffle_indices: number[];
      switch (vector_length) {
        case 0:
          unreachable("zero length vectors are not allowed");
          break;
        case 1:
          shuffle_indices = [0, 1, 1, 1, 1, 1, 1, 1];
          break;
        case 2:
          shuffle_indices = [0, 1, 2, 2, 2, 2, 2, 2];
          break;
        case 3:
          shuffle_indices = [0, 1, 2, 3, 3, 3, 3, 3];
          break;
        default:
          shuffle_indices = Array.from({ length: int_width }, (_, i) => i);
          break;
      }
      const shuffle_mask = shuffle_indices.map((i) => bx.const_i32(i));
      val_ = bx.shuffle_vector(val, bx.const_null_inherent(src_ty), bx.const_vector(shuffle_mask));
    }
    return bx.bitcast_inherent(val_, dest_ty);
  }
  // cast from the primitive type to the i1xN vector type
  else if (sk === TypeKind.Integer && dk === TypeKind.Vector && bx.element_type(dest_ty) === bx.type_i1()) {
    const vector_length = bx.vector_length(dest_ty);
    const int_width = Math.max(next_power_of_two(vector_length), 8);

    const intermediate_ty = bx.type_vector(bx.type_i1(), int_width);
    const intermediate = bx.bitcast_inherent(val, intermediate_ty);

    if (vector_length === int_width) {
      return intermediate;
    } else {
      const shuffle_mask = Array.from({ length: vector_length }, (_, i) => bx.const_i32(i));
      return bx.shuffle_vector(intermediate, bx.const_poison(intermediate_ty), bx.const_vector(shuffle_mask));
    }
  } else if (sk === TypeKind.Vector && dk === TypeKind.X86_AMX) {
    return bx.call_intrinsic("llvm.x86.cast.vector.to.tile", [src_ty], [val]);
  } else if (sk === TypeKind.X86_AMX && dk === TypeKind.Vector) {
    return bx.call_intrinsic("llvm.x86.cast.tile.to.vector", [dest_ty], [val]);
  } else {
    return bx.bitcast_inherent(val, dest_ty); // for `bf16(xN)` <-> `u16(xN)`
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1237 intrinsic_fn
function intrinsic_fn(bx: Builder, name: string, rust_return_ty: Type, rust_argument_tys: Type[], instance: Instance): Value {
  const tcx = bx.tcx;

  const rust_fn_ty = bx.type_func(rust_argument_tys, rust_return_ty);

  const intrinsic = llvm.Intrinsic.lookup(utf8(name));

  if (intrinsic !== undefined && intrinsic.is_target_specific()) {
    // `name[5..].split_once('.').unwrap()`
    const rest = name.slice(5);
    const dot = rest.indexOf(".");
    if (dot === -1) panic("called `Option::unwrap()` on a `None` value");
    const llvm_arch = rest.slice(0, dot);
    const rust_arch = tcx.sess.target.arch;

    const correct_llvm_arch = llvm_arch_for(rust_arch);
    if (correct_llvm_arch !== undefined && llvm_arch !== correct_llvm_arch) {
      tcx.dcx().emit_fatal(IntrinsicWrongArch_diagnostic({ name, target_arch: Arch.desc(rust_arch), span: tcx.def_span(Instance.def_id(instance)) }));
    }
  }

  if (intrinsic !== undefined && !intrinsic.is_overloaded()) {
    // FIXME: also do this for overloaded intrinsics
    const llfn = intrinsic.get_declaration(bx.llmod(), []);
    const llvm_fn_ty = bx.get_type_of_global(llfn);

    const llvm_return_ty = bx.get_return_type(llvm_fn_ty);
    const llvm_argument_tys = bx.func_params_types(llvm_fn_ty);
    const llvm_is_variadic = bx.func_is_variadic(llvm_fn_ty);

    const is_correct_signature =
      !llvm_is_variadic &&
      rust_argument_tys.length === llvm_argument_tys.length &&
      [[rust_return_ty, llvm_return_ty] as const, ...rust_argument_tys.map((t, i) => [t, llvm_argument_tys[i]!] as const)].every(([rust_ty, llvm_ty]) => can_autocast(bx.cx_, rust_ty, llvm_ty));

    if (!is_correct_signature) {
      tcx.dcx().emit_fatal(
        IntrinsicSignatureMismatch_diagnostic({
          name,
          llvm_fn_ty: debug_Type(llvm_fn_ty, PLAIN),
          rust_fn_ty: debug_Type(rust_fn_ty, PLAIN),
          span: tcx.def_span(Instance.def_id(instance)),
        }),
      );
    }

    return llfn;
  }

  // Function addresses in Rust are never significant, allowing functions to be merged.
  const llfn = declare_raw_fn(bx.cx_, name, llvm.CallConv.CCallConv, "Global", "Default", rust_fn_ty);

  if (intrinsic === undefined) {
    const new_llfn: { value: Value | undefined } = { value: undefined };
    const can_upgrade = llvm.LLVMRustUpgradeIntrinsicFunction(llfn, new_llfn);

    if (!can_upgrade) {
      // This is either plain wrong, or this can be caused by incompatible LLVM versions
      tcx.dcx().emit_fatal(UnknownIntrinsic_diagnostic({ name, span: tcx.def_span(Instance.def_id(instance)) }));
    } else {
      const def_id = Instance.def_id(instance).as_local();
      if (def_id !== undefined) {
        // we can emit diagnostics only for local crates
        const hir_id = tcx.local_def_id_to_hir_id(def_id);

        // not all intrinsics are upgraded to some other intrinsics, most are upgraded to instruction sequences
        const msg =
          new_llfn.value !== undefined
            ? `using deprecated intrinsic \`${name}\`, \`${str_from_utf8_unwrap(llvm.get_value_name(new_llfn.value))}\` can be used instead`
            : `using deprecated intrinsic \`${name}\``;

        tcx.emit_node_lint(
          DEPRECATED_LLVM_INTRINSIC,
          hir_id,
          DiagDecorator((d) => {
            d.primary_message(msg).span(tcx.hir_span(hir_id));
          }),
        );
      }
    }
  }

  return llfn;
}

/** `str::from_utf8(bytes).unwrap()` */
function str_from_utf8_unwrap(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unported("rustc_codegen_llvm::intrinsic: `str::from_utf8(..).unwrap()` of a non-UTF-8 value name (the Utf8Error panic text)");
  }
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1340 catch_unwind_intrinsic
function catch_unwind_intrinsic(bx: Builder, try_func: Value, data: Value, catch_func: Value): Value {
  if (!PanicStrategy.unwinds(bx.sess().panic_strategy())) {
    const try_func_ty = bx.type_func([bx.type_ptr()], bx.type_void());
    bx.call(try_func_ty, undefined, undefined, try_func, ReturnSlot.Direct, [data], undefined, undefined);
    // Return 0 unconditionally from the intrinsic call;
    // we can never unwind.
    return bx.const_bool(false);
  } else if (wants_msvc_seh(bx.sess().target)) {
    return codegen_msvc_try(bx, try_func, data, catch_func);
  } else if (wants_wasm_eh(bx.sess().target)) {
    return codegen_wasm_try(bx, try_func, data, catch_func);
  } else {
    return codegen_gnu_try(bx, try_func, data, catch_func);
  }
}

// MSVC's definition of the `rust_try` function.
//
// This implementation uses the new exception handling instructions in LLVM
// which have support in LLVM for SEH on MSVC targets. Although these
// instructions are meant to work for all targets, as of the time of this
// writing, however, LLVM does not recommend the usage of these new instructions
// as the old ones are still more optimized.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1368 codegen_msvc_try
export function codegen_msvc_try(bx: Builder, try_func: Value, data: Value, catch_func: Value): Value {
  const [llty, llfn] = get_rust_try_fn(bx.cx_, (bx) => {
    bx.set_personality_fn(bx.eh_personality());

    const normal = bx.append_sibling_block("normal");
    const catchswitch = bx.append_sibling_block("catchswitch");
    const catchpad_rust = bx.append_sibling_block("catchpad_rust");
    const catchpad_foreign = bx.append_sibling_block("catchpad_foreign");
    const caught = bx.append_sibling_block("caught");

    const try_func = llvm.get_param(bx.llfn(), 0);
    const data = llvm.get_param(bx.llfn(), 1);
    const catch_func = llvm.get_param(bx.llfn(), 2);

    // We're generating an IR snippet that looks like:
    //
    //   declare bool @rust_try(%try_func, %data, %catch_func) {
    //      %slot = alloca i8*
    //      invoke %try_func(%data) to label %normal unwind label %catchswitch
    //
    //   normal:
    //      ret i1 false
    //
    //   catchswitch:
    //      %cs = catchswitch within none [%catchpad_rust, %catchpad_foreign] unwind to caller
    //
    //   catchpad_rust:
    //      %tok = catchpad within %cs [%type_descriptor, 8, %slot]
    //      %ptr = load %slot
    //      call %catch_func(%data, %ptr)
    //      catchret from %tok to label %caught
    //
    //   catchpad_foreign:
    //      %tok = catchpad within %cs [null, 64, null]
    //      call %catch_func(%data, null)
    //      catchret from %tok to label %caught
    //
    //   caught:
    //      ret i1 true
    //   }
    //
    // This structure follows the basic usage of throw/try/catch in LLVM.
    // For example, compile this C++ snippet to see what LLVM generates:
    //
    //      struct rust_panic {
    //          rust_panic(const rust_panic&);
    //          ~rust_panic();
    //
    //          void* x[2];
    //      };
    //
    //      int __rust_try(
    //          void (*try_func)(void*),
    //          void *data,
    //          void (*catch_func)(void*, void*) noexcept
    //      ) {
    //          try {
    //              try_func(data);
    //              return 0;
    //          } catch(rust_panic& a) {
    //              catch_func(data, &a);
    //              return 1;
    //          } catch(...) {
    //              catch_func(data, NULL);
    //              return 1;
    //          }
    //      }
    //
    // More information can be found in libstd's seh.rs implementation.
    const ptr_size = bx.tcx.data_layout().pointer_size();
    const ptr_align = bx.tcx.data_layout().pointer_align().abi;
    const slot = bx.alloca(ptr_size, ptr_align);
    const try_func_ty = bx.type_func([bx.type_ptr()], bx.type_void());
    bx.invoke(try_func_ty, undefined, undefined, try_func, ReturnSlot.Direct, [data], normal, catchswitch, undefined, undefined);

    bx.switch_to_block(normal);
    bx.ret_inherent(bx.const_bool(false));

    bx.switch_to_block(catchswitch);
    const cs = bx.catch_switch(undefined, undefined, [catchpad_rust, catchpad_foreign]);

    // We can't use the TypeDescriptor defined in libpanic_unwind because it
    // might be in another DLL and the SEH encoding only supports specifying
    // a TypeDescriptor from the current module.
    //
    // However this isn't an issue since the MSVC runtime uses string
    // comparison on the type name to match TypeDescriptors rather than
    // pointer equality.
    //
    // So instead we generate a new TypeDescriptor in each module that uses
    // `try` and let the linker merge duplicate definitions in the same
    // module.
    //
    // When modifying, make sure that the type_name string exactly matches
    // the one used in library/panic_unwind/src/seh.rs.
    const type_info_vtable = bx.declare_global("??_7type_info@@6B@", bx.type_ptr());
    const type_name = bx.const_bytes(utf8("rust_panic\0"));
    const type_info = bx.const_struct_inherent([type_info_vtable, bx.const_null_inherent(bx.type_ptr()), type_name], false);
    const tydesc = bx.declare_global(mangle_internal_symbol(bx.tcx, "__rust_panic_type_info"), bx.val_ty(type_info));

    llvm.set_linkage(tydesc, llvm.Linkage.LinkOnceODRLinkage);
    if (bx.cx_.tcx.sess.target.supports_comdat()) {
      llvm.SetUniqueComdat(bx.llmod(), tydesc);
    }
    llvm.set_initializer(tydesc, type_info);

    // The flag value of 8 indicates that we are catching the exception by
    // reference instead of by value. We can't use catch by value because
    // that requires copying the exception object, which we don't support
    // since our exception object effectively contains a Box.
    //
    // Source: MicrosoftCXXABI::getAddrOfCXXCatchHandlerType in clang
    bx.switch_to_block(catchpad_rust);
    const flags = bx.const_i32(8);
    const funclet = bx.catch_pad(cs, [tydesc, flags, slot]);
    const ptr = bx.load_inherent(bx.type_ptr(), slot, ptr_align);
    const catch_ty = bx.type_func([bx.type_ptr(), bx.type_ptr()], bx.type_void());
    bx.call(catch_ty, undefined, undefined, catch_func, ReturnSlot.Direct, [data, ptr], funclet, undefined);
    bx.catch_ret(funclet, caught);

    // The flag value of 64 indicates a "catch-all".
    bx.switch_to_block(catchpad_foreign);
    const flags2 = bx.const_i32(64);
    const null_ = bx.const_null_inherent(bx.type_ptr());
    const funclet2 = bx.catch_pad(cs, [null_, flags2, null_]);
    bx.call(catch_ty, undefined, undefined, catch_func, ReturnSlot.Direct, [data, null_], funclet2, undefined);
    bx.catch_ret(funclet2, caught);

    bx.switch_to_block(caught);
    bx.ret_inherent(bx.const_bool(true));
  });

  // Note that no invoke is used here because by definition this function
  // can't panic (that's what it's catching).
  const ret = bx.call(llty, undefined, undefined, llfn, ReturnSlot.Direct, [try_func, data, catch_func], undefined, undefined);
  return ret;
}

// WASM's definition of the `rust_try` function.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1554 codegen_wasm_try
export function codegen_wasm_try(bx: Builder, try_func: Value, data: Value, catch_func: Value): Value {
  const [llty, llfn] = get_rust_try_fn(bx.cx_, (bx) => {
    bx.set_personality_fn(bx.eh_personality());

    const normal = bx.append_sibling_block("normal");
    const catchswitch = bx.append_sibling_block("catchswitch");
    const catchpad = bx.append_sibling_block("catchpad");
    const caught = bx.append_sibling_block("caught");

    const try_func = llvm.get_param(bx.llfn(), 0);
    const data = llvm.get_param(bx.llfn(), 1);
    const catch_func = llvm.get_param(bx.llfn(), 2);

    // We're generating an IR snippet that looks like:
    //
    //   declare i1 @rust_try(%try_func, %data, %catch_func) {
    //      %slot = alloca i8*
    //      invoke %try_func(%data) to label %normal unwind label %catchswitch
    //
    //   normal:
    //      ret i1 false
    //
    //   catchswitch:
    //      %cs = catchswitch within none [%catchpad] unwind to caller
    //
    //   catchpad:
    //      %tok = catchpad within %cs [null]
    //      %ptr = call @llvm.wasm.get.exception(token %tok)
    //      %sel = call @llvm.wasm.get.ehselector(token %tok)
    //      call %catch_func(%data, %ptr)
    //      catchret from %tok to label %caught
    //
    //   caught:
    //      ret i1 true
    //   }
    //
    const try_func_ty = bx.type_func([bx.type_ptr()], bx.type_void());
    bx.invoke(try_func_ty, undefined, undefined, try_func, ReturnSlot.Direct, [data], normal, catchswitch, undefined, undefined);

    bx.switch_to_block(normal);
    bx.ret_inherent(bx.const_bool(false));

    bx.switch_to_block(catchswitch);
    const cs = bx.catch_switch(undefined, undefined, [catchpad]);

    bx.switch_to_block(catchpad);
    const null_ = bx.const_null_inherent(bx.type_ptr());
    const funclet = bx.catch_pad(cs, [null_]);

    const ptr = bx.call_intrinsic("llvm.wasm.get.exception", [], [funclet.cleanuppad()]);
    const _sel = bx.call_intrinsic("llvm.wasm.get.ehselector", [], [funclet.cleanuppad()]);

    const catch_ty = bx.type_func([bx.type_ptr(), bx.type_ptr()], bx.type_void());
    bx.call(catch_ty, undefined, undefined, catch_func, ReturnSlot.Direct, [data, ptr], funclet, undefined);
    bx.catch_ret(funclet, caught);

    bx.switch_to_block(caught);
    bx.ret_inherent(bx.const_bool(true));
  });

  // Note that no invoke is used here because by definition this function
  // can't panic (that's what it's catching).
  const ret = bx.call(llty, undefined, undefined, llfn, ReturnSlot.Direct, [try_func, data, catch_func], undefined, undefined);
  return ret;
}

// Definition of the standard `try` function for Rust using the GNU-like model
// of exceptions (e.g., the normal semantics of LLVM's `landingpad` and `invoke`
// instructions).
//
// This codegen is a little surprising because we always call a shim
// function instead of inlining the call to `invoke` manually here. This is done
// because in LLVM we're only allowed to have one personality per function
// definition. The call to the `try` intrinsic is being inlined into the
// function calling it, and that function may already have other personality
// functions in play. By calling a shim we're guaranteed that our shim will have
// the right personality function.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1665 codegen_gnu_try
export function codegen_gnu_try(bx: Builder, try_func: Value, data: Value, catch_func: Value): Value {
  const [llty, llfn] = get_rust_try_fn(bx.cx_, (bx) => {
    // Codegens the shims described above:
    //
    //   bx:
    //      invoke %try_func(%data) normal %normal unwind %catch
    //
    //   normal:
    //      ret 0
    //
    //   catch:
    //      (%ptr, _) = landingpad
    //      call %catch_func(%data, %ptr)
    //      ret 1
    const then = bx.append_sibling_block("then");
    const catch_ = bx.append_sibling_block("catch");

    const try_func = llvm.get_param(bx.llfn(), 0);
    const data = llvm.get_param(bx.llfn(), 1);
    const catch_func = llvm.get_param(bx.llfn(), 2);
    const try_func_ty = bx.type_func([bx.type_ptr()], bx.type_void());
    bx.invoke(try_func_ty, undefined, undefined, try_func, ReturnSlot.Direct, [data], then, catch_, undefined, undefined);

    bx.switch_to_block(then);
    bx.ret_inherent(bx.const_bool(false));

    // Type indicator for the exception being thrown.
    //
    // The first value in this tuple is a pointer to the exception object
    // being thrown. The second value is a "selector" indicating which of
    // the landing pad clauses the exception's type had been matched to.
    // rust_try ignores the selector.
    bx.switch_to_block(catch_);
    const lpad_ty = bx.type_struct([bx.type_ptr(), bx.type_i32()], false);
    const vals = bx.landing_pad(lpad_ty, bx.eh_personality(), 1);
    const tydesc = bx.const_null_inherent(bx.type_ptr());
    bx.add_clause(vals, tydesc);
    const ptr = bx.extract_value(vals, 0);
    const catch_ty = bx.type_func([bx.type_ptr(), bx.type_ptr()], bx.type_void());
    bx.call(catch_ty, undefined, undefined, catch_func, ReturnSlot.Direct, [data, ptr], undefined, undefined);
    bx.ret_inherent(bx.const_bool(true));
  });

  // Note that no invoke is used here because by definition this function
  // can't panic (that's what it's catching).
  const ret = bx.call(llty, undefined, undefined, llfn, ReturnSlot.Direct, [try_func, data, catch_func], undefined, undefined);
  return ret;
}

// Helper function to give a Block to a closure to codegen a shim function.
// This is currently primarily used for the `try` intrinsic functions above.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1741 gen_fn
function gen_fn(cx: CodegenCx, name: string, rust_fn_sig: PolyFnSig, codegen: (bx: Builder) => void): readonly [Type, Value] {
  const fn_abi = cx.fn_abi_of_fn_ptr(rust_fn_sig, RawList.empty());
  const llty = fn_abi.llvm_type(cx);
  const llfn = cx.declare_fn(name, fn_abi, undefined);
  cx.set_frame_pointer_type(llfn);
  cx.apply_target_cpu_attr(llfn);
  // FIXME(eddyb) find a nicer way to do this.
  llvm.set_linkage(llfn, llvm.Linkage.InternalLinkage);
  const llbb = Builder.append_block_inherent(cx, llfn, "entry-block");
  const bx = Builder.build_inherent(cx, llbb);
  codegen(bx);
  return [llty, llfn];
}

// Helper function used to get a handle to the `__rust_try` function used to
// catch exceptions.
//
// This function is only generated once and is then cached.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1764 get_rust_try_fn
function get_rust_try_fn(cx: CodegenCx, codegen: (bx: Builder) => void): readonly [Type, Value] {
  const cached = cx.rust_try_fn;
  if (cached !== undefined) {
    return cached;
  }

  // Define the type up front for the signature of the rust_try function.
  const tcx = cx.tcx;
  const i8p = Ty.new_mut_ptr(tcx, tcx.types.i8);
  // `unsafe fn(*mut Data) -> ()`
  const try_fn_ty = Ty.new_fn_ptr(tcx, Binder.dummy(tcx.mk_fn_sig_rust_abi([i8p], tcx.types.unit, "Unsafe"), fold_FnSig));
  // `unsafe fn(*mut Data, *mut i8) -> ()`
  const catch_fn_ty = Ty.new_fn_ptr(tcx, Binder.dummy(tcx.mk_fn_sig_rust_abi([i8p, i8p], tcx.types.unit, "Unsafe"), fold_FnSig));
  // `unsafe fn(unsafe fn(*mut Data) -> (), *mut Data, unsafe fn(*mut Data, *mut i8) -> ()) -> bool`
  const rust_fn_sig = Binder.dummy(cx.tcx.mk_fn_sig_rust_abi([try_fn_ty, i8p, catch_fn_ty], tcx.types.bool, "Unsafe"), fold_FnSig);
  const rust_try = gen_fn(cx, "__rust_try", rust_fn_sig, codegen);

  if (cx.sess().pointer_authentication()) {
    const cfg = cx.sess().pointer_auth_config ?? panic("called `Option::unwrap()` on a `None` value");
    const attrs: Attribute[] = PointerAuthConfig.fn_attrs(cfg).map((name) => llvm.CreateAttrString(cx.llcx(), name));

    const [_ty, rust_try_fn] = rust_try;
    attributes.apply_to_llfn(rust_try_fn, llvm.AttributePlace.Function, attrs);
  }

  cx.rust_try_fn = rust_try;
  return rust_try;
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1806 codegen_retag_inner
function codegen_retag_inner(bx: Builder, name: string, ptr: Value, info: RetagInfo<Value>): Value {
  const size = bx.const_usize(info.size.bytes_u64());
  const perms = bx.const_u8(info.flags); // `RetagFlags::bits()`

  return bx.call_intrinsic(
    name,
    // Retag intrinsics have special handling within `CodegenCx::declare_intrinsic`
    // to ensure that each form has the correct return type.
    [bx.type_ptr(), bx.val_ty(size), bx.type_i8(), bx.type_ptr(), bx.type_ptr()],
    [ptr, size, perms, info.im_layout, info.pin_layout],
  );
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1824 codegen_autodiff
function codegen_autodiff(bx: Builder, instance: Instance, args: readonly OperandRef<Value>[], result_layout: TyAndLayout, result_place: PlaceValue<Value> | undefined): IntrinsicResult<Value> {
  const tcx = bx.tcx;
  if (!tcx.sess.opts.unstable_opts.autodiff.some((a) => a.$ === "Enable")) {
    tcx.dcx().emit_err(AutoDiffWithoutEnable_diagnostic({}));
  }

  const ct = tcx.crate_types();
  const lto = tcx.sess.lto();
  if (ct.length === 1 && ct.includes("Executable")) {
    if (lto !== "Fat") {
      tcx.dcx().emit_err(AutoDiffWithoutLto_diagnostic({}));
    }
  } else {
    if (lto !== "Fat" && !LinkerPluginLto.enabled(tcx.sess.opts.cg.linker_plugin_lto)) {
      tcx.dcx().emit_err(AutoDiffWithoutLto_diagnostic({}));
    }
  }

  const fn_args = instance.args;
  const callee_ty = Instance.ty(instance, tcx, bx.typing_env_());

  const sig = Binder.skip_binder(callee_ty.fn_sig(tcx));

  const ret_ty = FnSig.output(sig);
  const llret_ty = bx.layout_of(ret_ty).llvm_type(bx.cx_);

  const source_fn_ptr_ty = fn_args.into_type_list(tcx)[0]!;
  const fn_to_diff = args[0]!.immediate(debug_Value);

  const k = fn_args.into_type_list(tcx)[1]!.kind();
  let diff_id;
  let diff_args;
  if (k.$ === "FnDef") {
    [diff_id, diff_args] = [k._0, unwrap_no_bound_vars(k._1)];
  } else {
    bug("invalid args");
  }

  let fn_diff: Instance;
  const resolved = Instance.try_resolve(tcx, bx.cx_.typing_env_(), diff_id, diff_args);
  if (resolved.$ === "Ok") {
    if (resolved._0 !== undefined) {
      fn_diff = resolved._0;
    } else {
      bug(`could not resolve (${debug_def_id(diff_id)}, ${debug_args(diff_args)}) to a specific autodiff instance`);
    }
  } else {
    // An error has already been emitted
    return { $: "Err", _0: resolved._0 };
  }

  const val_arr = get_args_from_tuple(bx, args[2]!, fn_diff);
  const diff_symbol = symbol_name_for_instance_in_crate(tcx, fn_diff, LOCAL_CRATE);

  const found = find_attr(HasAttrs_DefId.get_attrs(Instance.def_id(fn_diff), tcx), (k): { $: "Some"; _0: RustcAutodiff | undefined } | undefined => (k.$ === "RustcAutodiff" ? { $: "Some", _0: k._0 === undefined ? undefined : clone_RustcAutodiff(k._0) } : undefined));
  if (found === undefined || found._0 === undefined) {
    bug("could not find autodiff attrs");
  }
  const diff_attrs = found._0;

  adjust_activity_to_abi(tcx, source_fn_ptr_ty, bx.cx_.typing_env_(), diff_attrs.input_activity);

  const fnc_tree = fnc_typetrees(tcx, source_fn_ptr_ty);

  // Build body
  return generate_enzyme_call(bx, fn_to_diff, diff_symbol, llret_ty, val_arr, diff_attrs, result_layout, result_place, fnc_tree);
}

// Generates the LLVM code to offload a Rust function to a target device (e.g., GPU).
// For each kernel call, it generates the necessary globals (including metadata such as
// size and pass mode), manages memory mapping to and from the device, handles all
// data transfers, and launches the kernel on the target device.
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1913 codegen_offload
function codegen_offload(bx: Builder, tcx: TyCtxt, instance: Instance, args0: readonly OperandRef<Value>[]): void {
  const cx = bx.cx_;
  const fn_args = instance.args;

  const k = fn_args.into_type_list(tcx)[0]!.kind();
  let target_id;
  let target_args;
  if (k.$ === "FnDef") {
    [target_id, target_args] = [k._0, unwrap_no_bound_vars(k._1)];
  } else {
    bug("invalid offload intrinsic arg");
  }

  let fn_target: Instance;
  const resolved = Instance.try_resolve(tcx, cx.typing_env_(), target_id, target_args);
  if (resolved.$ === "Ok") {
    if (resolved._0 !== undefined) {
      fn_target = resolved._0;
    } else {
      bug(`could not resolve (${debug_def_id(target_id)}, ${debug_args(target_args)}) to a specific offload instance`);
    }
  } else {
    // An error has already been emitted
    return;
  }

  const offload_dims = OffloadKernelDims.from_operands(bx, args0[1]!, args0[2]!);
  const a3 = args0[3]!.val;
  const dyn_cache = a3.$ === "Immediate" ? a3._0 : panic("unparsable");
  const a4 = args0[4]!.val;
  const device_id = a4.$ === "Immediate" ? a4._0 : panic("unparsable");
  const args = get_args_from_tuple(bx, args0[5]!, fn_target);
  const target_symbol = mangle_offload_export(tcx, fn_target);

  const sig0 = fn_sig_instantiate(tcx, Instance.def_id(fn_target), fn_target.args);
  const sig = tcx.instantiate_bound_regions_with_erased(sig0, fold_FnSig);
  const inputs = FnSig.inputs(sig);

  const fn_abi = cx.fn_abi_of_instance(fn_target, RawList.empty());

  const metadata: OffloadMetadata[] = [];
  const types: Type[] = [];

  for (let i = 0; i < fn_abi.args.length; i++) {
    const arg_abi = fn_abi.args[i]!;
    const ty = inputs[i]!;
    // `OffloadMetadata::handle_abi(cx, tcx, ty, arg_abi)`: rustc_middle's ty/offload_meta.rs is out of M7 (plan-m7 D18).
    void ty;
    void arg_abi;
    const decomposed: [OffloadMetadata, Ty][] = unported("excluded (plan-m7 D18): compiler/rustc_middle/src/ty/offload_meta.rs OffloadMetadata::handle_abi");

    for (const [meta, entry_ty] of decomposed) {
      metadata.push(meta);
      types.push(bx.cx_.layout_of(entry_ty).llvm_type(bx.cx_));
    }
  }

  const offload_globals = cx.offload_globals;
  if (offload_globals === undefined) {
    // Offload is not initialized, cannot continue
    return;
  }
  const offload_data = gpu_offload.gen_define_handling(cx, metadata, target_symbol, offload_globals);
  gpu_offload.gen_call_handling(bx, offload_data, args, types, metadata, offload_globals, offload_dims, dyn_cache, device_id);
}

// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:1994 get_args_from_tuple
function get_args_from_tuple(bx: Builder, tuple_op: OperandRef<Value>, fn_instance: Instance): Value[] {
  const cx = bx.cx_;
  const fn_abi = cx.fn_abi_of_instance(fn_instance, RawList.empty());

  const v = tuple_op.val;
  switch (v.$) {
    case "Immediate":
      return [v._0];
    case "Pair":
      return [v._0, v._1];
    case "Ref": {
      const ptr = v._0;
      const tuple_place = new PlaceRef(ptr, tuple_op.layout);

      const result: Value[] = [];
      let tuple_index = 0;

      for (const arg of fn_abi.args) {
        const mode = arg.mode;
        switch (mode.$) {
          case "Ignore":
            break;
          case "Direct":
          case "Cast": {
            const field = tuple_place.project_field(bx, tuple_index);
            const llvm_ty = field.layout.llvm_type(bx.cx_);
            const val = bx.load_inherent(llvm_ty, field.val.llval, field.val.align);
            result.push(val);
            tuple_index += 1;
            break;
          }
          case "Pair": {
            const field = tuple_place.project_field(bx, tuple_index);
            const llvm_ty = field.layout.llvm_type(bx.cx_);
            const pair_val = bx.load_inherent(llvm_ty, field.val.llval, field.val.align);
            result.push(bx.extract_value(pair_val, 0));
            result.push(bx.extract_value(pair_val, 1));
            tuple_index += 1;
            break;
          }
          case "Indirect": {
            const field = tuple_place.project_field(bx, tuple_index);
            result.push(field.val.llval);
            tuple_index += 1;
            break;
          }
          case "IndirectUnsized": {
            bug("autodiff/offload args must not be unsized");
          }
        }
      }

      return result;
    }

    case "ZeroSized":
      return [];
  }
}

// The SIMD half (intrinsic.rs:2047-end) is lane cg-intrinsic-b's (plan-m7 §8 wave 43). PORT (lane ir-fix-a): its head is ported
// ahead of that lane, because run-pass programs reach it through std (`simd_splat` from core's SIMD string search, `simd_shuffle`):
// the macros, `vector_mask_to_bitmask`, the arms up to `simd_extract_dyn` (intrinsic.rs:2047-2409), `simd_bitmask` (:2443),
// `minmax_red!` and `bitwise_red!` (:3011-3089), `arith_binary!` and `arith_unary!` (:3308-3355) and the final `span_bug!`, in
// upstream order. Every other arm stops by the intrinsic's name (`unported`), in its place in the chain, so a program reaching
// one stops as it did before, with its name.
// - `macro_rules! return_error` / `require!` / `require_simd!` / `require_simd_or_scalable!` and the `*_red!` / `arith_*!` macros
//   are local closures; a macro's `return` is the caller's `return` of the closure's result.
// - `if cfg!(debug_assertions)` is false in the oracle's build (rustc ships without debug assertions): the check stays a comment.
/** Private upstream (`fn`); exported for the scalar half. */
// rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:2047 generic_simd_intrinsic
export function generic_simd_intrinsic(bx: Builder, name: Symbol, fn_args: GenericArgsRef, args: readonly OperandRef<Value>[], ret_ty: Ty, llret_ty: Type, span: Span): Result<Value, ErrorGuaranteed> {
  type Err = { $: "Err"; _0: ErrorGuaranteed };
  const return_error = (diag: InvalidMonomorphization): Err => {
    const err = bx.sess().dcx().emit_err(InvalidMonomorphization_diagnostic(diag));
    return { $: "Err", _0: err };
  };
  /** `require_simd!($ty, $variant)`: the `Err` to return, or the type's `simd_size_and_type`. */
  const require_simd = (ty: Ty, variant: "SimdArgument" | "SimdInput" | "SimdReturn"): Err | [number, Ty] => {
    if (!ty.is_simd()) return return_error({ $: variant, span, name, ty });
    return ty.simd_size_and_type(bx.tcx);
  };
  /** `require_simd_or_scalable!($ty, $variant)`. */
  const require_simd_or_scalable = (ty: Ty, variant: "SimdArgument" | "SimdInput"): Err | [number, Ty, NumScalableVectors | undefined] => {
    if (!(ty.is_simd() || ty.is_scalable_vector())) return return_error({ $: variant, span, name, ty });
    if (ty.is_simd()) {
      const [len, ty_] = ty.simd_size_and_type(bx.tcx);
      return [len, ty_, undefined];
    } else {
      const parts = ty.scalable_vector_parts(bx.tcx);
      if (parts === undefined) return panic("`is_scalable_vector` was wrong");
      const [count, ty_, num_vecs] = parts;
      return [count, ty_, num_vecs];
    }
  };
  /// Returns the bitwidth of the `$ty` argument if it is an `Int` or `Uint` type.
  const require_int_or_uint_ty = (k: TyKind, diag: InvalidMonomorphization): Err | number => {
    switch (k.$) {
      case "Int":
        return IntTy.bit_width(k._0) ?? bx.data_layout().pointer_size().bits();
      case "Uint":
        return UintTy.bit_width(k._0) ?? bx.data_layout().pointer_size().bits();
      default:
        return return_error(diag);
    }
  };
  const isErr = <T>(r: Err | T): r is Err => typeof r === "object" && r !== null && !Array.isArray(r) && (r as { $?: string }).$ === "Err";

  /// Converts a vector mask, where each element has a bit width equal to the data elements it is used with,
  /// down to an i1 based mask that can be used by llvm intrinsics.
  ///
  /// The rust simd semantics are that each element should either consist of all ones or all zeroes,
  /// but this information is not available to llvm. Truncating the vector effectively uses the lowest bit,
  /// but codegen for several targets is better if we consider the highest bit by shifting.
  ///
  /// For x86 SSE/AVX targets this is beneficial since most instructions with mask parameters only consider the highest bit.
  /// So even though on llvm level we have an additional shift, in the final assembly there is no shift or truncate and
  /// instead the mask can be used as is.
  ///
  /// For aarch64 and other targets there is a benefit because a mask from the sign bit can be more
  /// efficiently converted to an all ones / all zeroes mask by comparing whether each element is negative.
  // rustc: compiler/rustc_codegen_llvm/src/intrinsic.rs:2125 vector_mask_to_bitmask
  function vector_mask_to_bitmask(bx: Builder, i_xn: Value, in_elem_bitwidth: number, in_len: number): Value {
    // Shift the MSB to the right by "in_elem_bitwidth - 1" into the first bit position.
    const shift_idx = bx.cx_.const_int(bx.type_ix(in_elem_bitwidth), BigInt(in_elem_bitwidth - 1));
    const shift_indices = Array.from({ length: in_len }, () => shift_idx);
    const i_xn_msb = bx.lshr(i_xn, bx.const_vector(shift_indices));
    // Truncate vector to an <i1 x N>
    return bx.trunc_inherent(i_xn_msb, bx.type_vector(bx.type_i1(), in_len));
  }

  // Sanity-check: all vector arguments must be immediates.
  // if cfg!(debug_assertions) { for arg in args { if arg.layout.ty.is_simd() { assert_matches!(arg.val, OperandValue::Immediate(_)); } } }

  if (name === sym.simd_select_bitmask) {
    const r = require_simd(args[1]!.layout.ty, "SimdArgument");
    if (isErr(r)) return r;
    const [len] = r;

    const expected_int_bits = next_power_of_two(Math.max(len, 8));
    const expected_bytes = Math.ceil(len / 8);

    const mask_ty = args[0]!.layout.ty;
    const k = mask_ty.kind();
    let mask: Value;
    if (k.$ === "Int" && IntTy.bit_width(k._0) === expected_int_bits) {
      mask = args[0]!.immediate(debug_Value);
    } else if (k.$ === "Uint" && UintTy.bit_width(k._0) === expected_int_bits) {
      mask = args[0]!.immediate(debug_Value);
    } else if (
      k.$ === "Array" &&
      (() => {
        const ek = k._0.kind();
        return ek.$ === "Uint" && ek._0 === "U8";
      })() &&
      (k._1.try_to_target_usize(bx.tcx) ?? panic("expected monomorphic const in codegen")) === BigInt(expected_bytes)
    ) {
      const place = PlaceRef.alloca(bx, args[0]!.layout);
      OperandValue.store(args[0]!.val, bx, place);
      const int_ty = bx.type_ix(expected_bytes * 8);
      mask = bx.load_inherent(int_ty, place.val.llval, Align.ONE);
    } else {
      return return_error({ $: "InvalidBitmask", span, name, mask_ty, expected_int_bits, expected_bytes });
    }

    const i1 = bx.type_i1();
    const im = bx.type_ix(len);
    const i1xn = bx.type_vector(i1, len);
    const m_im = bx.trunc_inherent(mask, im);
    const m_i1s = bx.bitcast_inherent(m_im, i1xn);
    return { $: "Ok", _0: bx.select(m_i1s, args[1]!.immediate(debug_Value), args[2]!.immediate(debug_Value)) };
  }

  if (name === sym.simd_splat) {
    const r = require_simd(ret_ty, "SimdReturn");
    if (isErr(r)) return r;
    const [out_len, out_ty] = r;

    if (!(args[0]!.layout.ty === out_ty)) {
      return return_error({ $: "ExpectedVectorElementType", span, name, expected_element: out_ty, vector_type: ret_ty });
    }

    // `insertelement <N x elem> poison, elem %x, i32 0`
    const poison_vec = bx.const_poison(llret_ty);
    const idx0 = bx.const_i32(0);
    const v0 = bx.insert_element(poison_vec, args[0]!.immediate(debug_Value), idx0);

    // `shufflevector <N x elem> v0, <N x elem> poison, <N x i32> zeroinitializer`
    // The masks is all zeros, so this splats lane 0 (which has our element in it).
    const mask_ty = bx.type_vector(bx.type_i32(), out_len);
    const splat = bx.shuffle_vector(v0, poison_vec, bx.const_null_inherent(mask_ty));

    return { $: "Ok", _0: splat };
  }

  let supports_scalable: boolean;
  switch (name) {
    case sym.simd_cast:
    case sym.simd_select:
      supports_scalable = true;
      break;
    default:
      supports_scalable = false;
  }

  // Every intrinsic below takes a SIMD vector as its first argument. Some intrinsics also accept
  // scalable vectors. `require_simd_or_scalable` is used regardless as it'll do the right thing
  // for non-scalable vectors, and an additional check to prohibit scalable vectors for those
  // intrinsics that do not support them is added.
  if (!supports_scalable) {
    const r = require_simd(args[0]!.layout.ty, "SimdInput");
    if (isErr(r)) return r;
  }
  const rin = require_simd_or_scalable(args[0]!.layout.ty, "SimdInput");
  if (isErr(rin)) return rin;
  const [in_len, in_elem, in_num_vecs] = rin;
  void in_num_vecs;
  const in_ty = args[0]!.layout.ty;

  let comparison: BinOp | undefined;
  switch (name) {
    case sym.simd_eq:
      comparison = "Eq";
      break;
    case sym.simd_ne:
      comparison = "Ne";
      break;
    case sym.simd_lt:
      comparison = "Lt";
      break;
    case sym.simd_le:
      comparison = "Le";
      break;
    case sym.simd_gt:
      comparison = "Gt";
      break;
    case sym.simd_ge:
      comparison = "Ge";
      break;
    default:
      comparison = undefined;
  }

  if (comparison !== undefined) {
    const cmp_op = comparison;
    const r = require_simd(ret_ty, "SimdReturn");
    if (isErr(r)) return r;
    const [out_len, out_ty] = r;

    if (!(in_len === out_len)) {
      return return_error({ $: "ReturnLengthInputType", span, name, in_len, in_ty, ret_ty, out_len });
    }
    if (!(bx.type_kind(bx.element_type(llret_ty)) === TypeKind.Integer)) {
      return return_error({ $: "ReturnIntegerType", span, name, ret_ty, out_ty });
    }

    return { $: "Ok", _0: compare_simd_types(bx, args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), in_elem, llret_ty, cmp_op) };
  }

  if (name === sym.simd_shuffle_const_generic) {
    // PORT: `fn_args[2].expect_const()`.
    const idx = GenericArg.expect_const(fn_args[2]!).to_branch();
    const n = idx.length;

    const r = require_simd(ret_ty, "SimdReturn");
    if (isErr(r)) return r;
    const [out_len, out_ty] = r;
    if (!(out_len === n)) {
      return return_error({ $: "ReturnLength", span, name, in_len: n, ret_ty, out_len });
    }
    if (!(in_elem === out_ty)) {
      return return_error({ $: "ReturnElement", span, name, in_elem, in_ty, ret_ty, out_ty });
    }

    const total_len = in_len * 2;

    // `.map(..).collect::<Option<Vec<_>>>()`: the map runs over every element (each out-of-bounds index emits its error), and
    // the result is `None` if any was.
    const indices: (Value | undefined)[] = idx.map((val: Const, arg_idx: number) => {
      const idx_ = val.to_leaf().to_i32();
      // `i32::try_from(total_len).unwrap()`
      if (total_len > 0x7fffffff) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
      if (idx_ >= total_len) {
        bx.sess().dcx().emit_err(InvalidMonomorphization_diagnostic({ $: "SimdIndexOutOfBounds", span, name, arg_idx, total_len: BigInt(total_len) }));
        return undefined;
      } else {
        return bx.const_i32(idx_);
      }
    });
    if (indices.some((v) => v === undefined)) {
      return { $: "Ok", _0: bx.const_null_inherent(llret_ty) };
    }

    return { $: "Ok", _0: bx.shuffle_vector(args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), bx.const_vector(indices as Value[])) };
  }

  if (name === sym.simd_shuffle) {
    // Make sure this is actually a SIMD vector.
    const idx_ty = args[2]!.layout.ty;
    let n: number;
    if (
      idx_ty.is_simd() &&
      (() => {
        const ek = idx_ty.simd_size_and_type(bx.cx_.tcx)[1].kind();
        return ek.$ === "Uint" && ek._0 === "U32";
      })()
    ) {
      n = idx_ty.simd_size_and_type(bx.cx_.tcx)[0];
    } else {
      return return_error({ $: "SimdShuffle", span, name, ty: idx_ty });
    }

    const r = require_simd(ret_ty, "SimdReturn");
    if (isErr(r)) return r;
    const [out_len, out_ty] = r;
    if (!(out_len === n)) {
      return return_error({ $: "ReturnLength", span, name, in_len: n, ret_ty, out_len });
    }
    if (!(in_elem === out_ty)) {
      return return_error({ $: "ReturnElement", span, name, in_elem, in_ty, ret_ty, out_ty });
    }

    const total_len = BigInt(in_len) * 2n;

    // Check that the indices are in-bounds.
    const indices = args[2]!.immediate(debug_Value);
    for (let i = 0; i < n; i++) {
      const val = bx.const_get_elt(indices, i);
      const idx = bx.const_to_opt_u128(val, true) ?? bug("typeck should have already ensured that these are const");
      if (idx >= total_len) {
        return return_error({ $: "SimdIndexOutOfBounds", span, name, arg_idx: i, total_len });
      }
    }

    return { $: "Ok", _0: bx.shuffle_vector(args[0]!.immediate(debug_Value), args[1]!.immediate(debug_Value), indices) };
  }

  if (name === sym.simd_insert || name === sym.simd_insert_dyn) {
    if (!(in_elem === args[2]!.layout.ty)) {
      return return_error({ $: "InsertedType", span, name, in_elem, in_ty, out_ty: args[2]!.layout.ty });
    }

    let index_imm: Value;
    if (name === sym.simd_insert) {
      const idx = bx.const_to_opt_u128(args[1]!.immediate(debug_Value), false) ?? panic("typeck should have ensure that this is a const");
      if (idx >= BigInt(in_len)) {
        return return_error({ $: "SimdIndexOutOfBounds", span, name, arg_idx: 1, total_len: BigInt(in_len) });
      }
      // `idx as i32`: `idx < in_len`, a vector length.
      index_imm = bx.const_i32(Number(idx));
    } else {
      index_imm = args[1]!.immediate(debug_Value);
    }

    return { $: "Ok", _0: bx.insert_element(args[0]!.immediate(debug_Value), args[2]!.immediate(debug_Value), index_imm) };
  }
  if (name === sym.simd_extract || name === sym.simd_extract_dyn) {
    if (!(ret_ty === in_elem)) {
      return return_error({ $: "ReturnType", span, name, in_elem, in_ty, ret_ty });
    }
    let index_imm: Value;
    if (name === sym.simd_extract) {
      const idx = bx.const_to_opt_u128(args[1]!.immediate(debug_Value), false) ?? panic("typeck should have ensure that this is a const");
      if (idx >= BigInt(in_len)) {
        return return_error({ $: "SimdIndexOutOfBounds", span, name, arg_idx: 1, total_len: BigInt(in_len) });
      }
      // `idx as i32`: `idx < in_len`, a vector length.
      index_imm = bx.const_i32(Number(idx));
    } else {
      index_imm = args[1]!.immediate(debug_Value);
    }

    return { $: "Ok", _0: bx.extract_element(args[0]!.immediate(debug_Value), index_imm) };
  }

  // The arms from `simd_select` (intrinsic.rs:2411) to `simd_cast` / `simd_as` (:3193), and the nested `simd_simple_float_intrinsic`
  // (:2496), `llvm_vector_ty` (:2567) and `llvm_alignment` (:2671), are lane cg-intrinsic-b's (header). Each of those arms is
  // guarded by the intrinsic's name alone, so stopping on exactly those names, in their order, leaves every other name to fall
  // through to the arms after them, as upstream's chain does.
  const stop = (): never => unported("cg-intrinsic-b: compiler/rustc_codegen_llvm/src/intrinsic.rs generic_simd_intrinsic " + Symbol.as_str(name));
  if (name === sym.simd_select) return stop();

  if (name === sym.simd_bitmask) {
    // The `fn simd_bitmask(vector) -> unsigned integer` intrinsic takes a vector mask and
    // returns one bit for each lane (which must all be `0` or `!0`) in the form of either:
    // * an unsigned integer
    // * an array of `u8`
    // If the vector has less than 8 lanes, a u8 is returned with zeroed trailing bits.
    //
    // The bit order of the result depends on the byte endianness, LSB-first for little
    // endian and MSB-first for big endian.
    const expected_int_bits = next_power_of_two(Math.max(in_len, 8));
    const expected_bytes = Math.ceil(in_len / 8);

    // Integer vector <i{in_bitwidth} x in_len>:
    const rb = require_int_or_uint_ty(in_elem.kind(), { $: "MaskWrongElementType", span, name, ty: in_elem });
    if (isErr(rb)) return rb;
    const in_elem_bitwidth = rb;

    const i1xn = vector_mask_to_bitmask(bx, args[0]!.immediate(debug_Value), in_elem_bitwidth, in_len);
    // Bitcast <i1 x N> to iN:
    const i_ = bx.bitcast_inherent(i1xn, bx.type_ix(in_len));

    const k = ret_ty.kind();
    if (k.$ === "Uint" && UintTy.bit_width(k._0) === expected_int_bits) {
      // Zero-extend iN to the bitmask type:
      return { $: "Ok", _0: bx.zext(i_, bx.type_ix(expected_int_bits)) };
    } else if (
      k.$ === "Array" &&
      (() => {
        const ek = k._0.kind();
        return ek.$ === "Uint" && ek._0 === "U8";
      })() &&
      (k._1.try_to_target_usize(bx.tcx) ?? panic("expected monomorphic const in codegen")) === BigInt(expected_bytes)
    ) {
      // Zero-extend iN to the array length:
      const ze = bx.zext(i_, bx.type_ix(expected_bytes * 8));

      // Convert the integer to a byte array
      const ptr = bx.alloca(Size.from_bytes(expected_bytes), Align.ONE);
      bx.store_inherent(ze, ptr, Align.ONE);
      const array_ty = bx.type_array(bx.type_i8(), BigInt(expected_bytes));
      return { $: "Ok", _0: bx.load_inherent(array_ty, ptr, Align.ONE) };
    } else {
      return return_error({ $: "CannotReturn", span, name, ret_ty, expected_int_bits, expected_bytes });
    }
  }
  switch (name) {
    case sym.simd_ceil:
    case sym.simd_fabs:
    case sym.simd_fcos:
    case sym.simd_fexp2:
    case sym.simd_fexp:
    case sym.simd_flog10:
    case sym.simd_flog2:
    case sym.simd_flog:
    case sym.simd_floor:
    case sym.simd_fma:
    case sym.simd_fsin:
    case sym.simd_fsqrt:
    case sym.simd_relaxed_fma:
    case sym.simd_round:
    case sym.simd_round_ties_even:
    case sym.simd_trunc:
      return stop();
  }
  if (name === sym.simd_gather) return stop();
  if (name === sym.simd_masked_load) return stop();
  if (name === sym.simd_masked_store) return stop();
  if (name === sym.simd_scatter) return stop();
  // `arith_red!` (:2938) and its four expansions (:2994-3009).
  switch (name) {
    case sym.simd_reduce_add_ordered:
    case sym.simd_reduce_mul_ordered:
    case sym.simd_reduce_add_unordered:
    case sym.simd_reduce_mul_unordered:
      return stop();
  }

  // `macro_rules! minmax_red` (:3011).
  const minmax_red = (sym_name: Symbol, int_red: (src: Value, is_signed: boolean) => Value): Result<Value, ErrorGuaranteed> => {
    if (!(ret_ty === in_elem)) {
      return return_error({ $: "ReturnType", span, name, in_elem, in_ty, ret_ty });
    }
    switch (in_elem.kind().$) {
      case "Int":
        return { $: "Ok", _0: int_red(args[0]!.immediate(debug_Value), true) };
      case "Uint":
        return { $: "Ok", _0: int_red(args[0]!.immediate(debug_Value), false) };
      default:
        return return_error({ $: "UnsupportedSymbol", span, name, symbol: sym_name, in_ty, in_elem, ret_ty });
    }
  };

  // Currently no support for float due to <https://github.com/llvm/llvm-project/issues/185827>.
  if (name === sym.simd_reduce_min) return minmax_red(sym.simd_reduce_min, (src, s) => bx.vector_reduce_min(src, s));
  if (name === sym.simd_reduce_max) return minmax_red(sym.simd_reduce_max, (src, s) => bx.vector_reduce_max(src, s));

  // `macro_rules! bitwise_red` (:3038).
  const bitwise_red = (sym_name: Symbol, red: (src: Value) => Value, boolean: boolean): Result<Value, ErrorGuaranteed> => {
    let input: Value;
    if (!boolean) {
      if (!(ret_ty === in_elem)) {
        return return_error({ $: "ReturnType", span, name, in_elem, in_ty, ret_ty });
      }
      input = args[0]!.immediate(debug_Value);
    } else {
      const k = in_elem.kind();
      let bitwidth: number;
      if (k.$ === "Int") {
        bitwidth = IntTy.bit_width(k._0) ?? bx.data_layout().pointer_size().bits();
      } else if (k.$ === "Uint") {
        bitwidth = UintTy.bit_width(k._0) ?? bx.data_layout().pointer_size().bits();
      } else {
        return return_error({ $: "UnsupportedSymbol", span, name, symbol: sym_name, in_ty, in_elem, ret_ty });
      }

      input = vector_mask_to_bitmask(bx, args[0]!.immediate(debug_Value), bitwidth, in_len);
    }
    switch (in_elem.kind().$) {
      case "Int":
      case "Uint": {
        const r = red(input);
        return { $: "Ok", _0: r };
      }
      default:
        return return_error({ $: "UnsupportedSymbol", span, name, symbol: sym_name, in_ty, in_elem, ret_ty });
    }
  };

  if (name === sym.simd_reduce_and) return bitwise_red(sym.simd_reduce_and, (src) => bx.vector_reduce_and(src), false);
  if (name === sym.simd_reduce_or) return bitwise_red(sym.simd_reduce_or, (src) => bx.vector_reduce_or(src), false);
  if (name === sym.simd_reduce_xor) return bitwise_red(sym.simd_reduce_xor, (src) => bx.vector_reduce_xor(src), false);
  if (name === sym.simd_reduce_all) return bitwise_red(sym.simd_reduce_all, (src) => bx.vector_reduce_and(src), true);
  if (name === sym.simd_reduce_any) return bitwise_red(sym.simd_reduce_any, (src) => bx.vector_reduce_or(src), true);

  if (name === sym.simd_cast_ptr) return stop();
  if (name === sym.simd_expose_provenance) return stop();
  if (name === sym.simd_with_exposed_provenance) return stop();
  if (name === sym.simd_cast || name === sym.simd_as) return stop();

  // `macro_rules! arith_binary` (:3308) and its expansion (:3323): for each name, the call of the first arm whose kinds hold the
  // element's kind, else `UnsupportedOperation`.
  const arith = (arms: readonly (readonly [readonly ("Uint" | "Int" | "Float")[], () => Value])[]): Result<Value, ErrorGuaranteed> => {
    const k = in_elem.kind().$;
    for (const [kinds, call] of arms) {
      if ((kinds as readonly string[]).includes(k)) return { $: "Ok", _0: call() };
    }
    return return_error({ $: "UnsupportedOperation", span, name, in_ty, in_elem });
  };
  const a0 = (): Value => args[0]!.immediate(debug_Value);
  const a1 = (): Value => args[1]!.immediate(debug_Value);
  switch (name) {
    case sym.simd_add:
      return arith([[["Uint", "Int"], () => bx.add(a0(), a1())], [["Float"], () => bx.fadd(a0(), a1())]]);
    case sym.simd_sub:
      return arith([[["Uint", "Int"], () => bx.sub(a0(), a1())], [["Float"], () => bx.fsub(a0(), a1())]]);
    case sym.simd_mul:
      return arith([[["Uint", "Int"], () => bx.mul(a0(), a1())], [["Float"], () => bx.fmul(a0(), a1())]]);
    case sym.simd_div:
      return arith([[["Uint"], () => bx.udiv(a0(), a1())], [["Int"], () => bx.sdiv(a0(), a1())], [["Float"], () => bx.fdiv(a0(), a1())]]);
    case sym.simd_rem:
      return arith([[["Uint"], () => bx.urem(a0(), a1())], [["Int"], () => bx.srem(a0(), a1())], [["Float"], () => bx.frem(a0(), a1())]]);
    case sym.simd_shl:
      return arith([[["Uint", "Int"], () => bx.shl(a0(), a1())]]);
    case sym.simd_shr:
      return arith([[["Uint"], () => bx.lshr(a0(), a1())], [["Int"], () => bx.ashr(a0(), a1())]]);
    case sym.simd_and:
      return arith([[["Uint", "Int"], () => bx.and(a0(), a1())]]);
    case sym.simd_or:
      return arith([[["Uint", "Int"], () => bx.or(a0(), a1())]]);
    case sym.simd_xor:
      return arith([[["Uint", "Int"], () => bx.xor(a0(), a1())]]);
    case sym.simd_maximum_number_nsz:
      return arith([[["Float"], () => bx.maximum_number_nsz(a0(), a1())]]);
    case sym.simd_minimum_number_nsz:
      return arith([[["Float"], () => bx.minimum_number_nsz(a0(), a1())]]);
  }
  // `macro_rules! arith_unary` (:3338) and its expansion (:3353).
  if (name === sym.simd_neg) {
    return arith([[["Int"], () => bx.neg(a0())], [["Float"], () => bx.fneg(a0())]]);
  }

  // Unary integer intrinsics (:3357), `simd_arith_offset` (:3425), `simd_saturating_add` / `simd_saturating_sub` (:3446): lane
  // cg-intrinsic-b's (header).
  switch (name) {
    case sym.simd_bswap:
    case sym.simd_bitreverse:
    case sym.simd_ctlz:
    case sym.simd_ctpop:
    case sym.simd_cttz:
    case sym.simd_carryless_mul:
    case sym.simd_funnel_shl:
    case sym.simd_funnel_shr:
      return stop();
  }
  if (name === sym.simd_arith_offset) return stop();
  if (name === sym.simd_saturating_add || name === sym.simd_saturating_sub) return stop();

  return span_bug(span, "unknown SIMD intrinsic");
}
