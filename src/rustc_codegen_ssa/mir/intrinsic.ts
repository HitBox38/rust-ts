// Port of compiler/rustc_codegen_ssa/src/mir/intrinsic.rs (lane ssa-rvalue-intrinsic, plan-m7 wave 41).
//
// PORT (ssa-rvalue-intrinsic): conventions as rvalue.ts's header:
// - The `impl FunctionCx` block (`codegen_intrinsic_call`) is in `install_FunctionCx_intrinsic`, which mod.ts calls
//   right after `class FunctionCx`; this file imports mod.ts for types only.
// - `IntrinsicResult` is mod.ts's union; its `Operand(..)` arm is built as an object literal.
// - `match name { sym::a | sym::b => .. }` over `Symbol`s is a `switch` on the interned handles, arms in upstream order.
// - block.rs `FunctionCx::get_caller_location` (ssa-block), size_of_val.rs `size_and_align_of_dst` and meth.rs
//   `VirtualIndex::{from_index, get_usize}` (ssa-mir-rest) are called directly (root at integ-w54; they were stubs).
import { Align, type FieldIdx, Integer, WrappingRange } from "../../rustc_abi/lib.ts";
import type { SourceInfo } from "../../rustc_middle/mir/mod.ts";
import "../../rustc_middle/ty/consts.ts";
import { Value } from "../../rustc_middle/ty/consts/valtree.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { COMMON_VTABLE_ENTRIES_ALIGN, COMMON_VTABLE_ENTRIES_SIZE } from "../../rustc_middle/ty/vtable.ts";
import { FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_unit } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { AtomicRmwBinOp, SynchronizationScope } from "../common.ts";
import { InvalidMonomorphization_diagnostic } from "../diagnostics.ts";
import { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx, IntrinsicResult } from "./mod.ts";
import { OperandRef, OperandRefBuilder, OperandValue } from "./operand.ts";
import type { PlaceValue } from "./place.ts";
import { size_and_align_of_dst } from "../size_of_val.ts";
import { VirtualIndex } from "../meth.ts";

// rustc: compiler/rustc_codegen_ssa/src/mir/intrinsic.rs:18 copy_intrinsic
function copy_intrinsic<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  allow_overlap: boolean,
  volatile: boolean,
  ty: Ty,
  dst: B["Value"],
  src: B["Value"],
  count: B["Value"],
): void {
  const layout = bx.layout_of(ty);
  const size = layout.size;
  const align = layout.align.abi;
  const size_ = bx.unchecked_sumul(bx.const_usize(size.bytes_u64()), count);
  const flags = volatile ? MemFlags.VOLATILE : MemFlags.empty();
  if (allow_overlap) {
    bx.memmove(dst, align, src, align, size_, flags);
  } else {
    bx.memcpy(dst, align, src, align, size_, flags, undefined);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/mir/intrinsic.rs:39 memset_intrinsic
function memset_intrinsic<B extends BackendTypes>(bx: BuilderMethods<B>, volatile: boolean, ty: Ty, dst: B["Value"], val: B["Value"], count: B["Value"]): void {
  const layout = bx.layout_of(ty);
  const size = layout.size;
  const align = layout.align.abi;
  const size_ = bx.mul(bx.const_usize(size.bytes_u64()), count);
  const flags = volatile ? MemFlags.VOLATILE : MemFlags.empty();
  bx.memset(dst, val, size_, align, flags);
}

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_intrinsic_call(
      bx: Bx,
      instance: Instance,
      args: readonly OperandRef<B["Value"]>[],
      result_layout: TyAndLayout,
      result_place: PlaceValue<B["Value"]> | undefined,
      source_info: SourceInfo,
    ): IntrinsicResult<B["Value"]>;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of intrinsic.rs; mod.ts calls this once,
 *  right after its `class FunctionCx` (header). */
export function install_FunctionCx_intrinsic(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  /// In the `Fallback` case, returns the instance that should be called instead.
  // rustc: compiler/rustc_codegen_ssa/src/mir/intrinsic.rs:57 codegen_intrinsic_call
  FunctionCx_.prototype.codegen_intrinsic_call = function (
    this: FunctionCx<BackendTypes>,
    bx: BuilderMethods<BackendTypes>,
    instance: Instance,
    args: readonly OperandRef<unknown>[],
    result_layout: TyAndLayout,
    result_place: PlaceValue<unknown> | undefined,
    source_info: SourceInfo,
  ): IntrinsicResult<unknown> {
    // When `-Zforce-intrinsic-fallback` is enabled, always use the fallback body if it exists,
    if (bx.tcx_().sess.opts.unstable_opts.force_intrinsic_fallback) {
      const def = bx.tcx_().intrinsic(Instance.def_id(instance));
      if (def !== undefined && !def.must_be_overridden) {
        return { $: "Fallback", _0: Instance.new_raw(Instance.def_id(instance), instance.args) };
      }
    }

    const span = source_info.span;

    const name = bx.tcx_().item_name(Instance.def_id(instance));
    const fn_args = instance.args;

    // If we're swapping something that's *not* an `OperandValue::Ref`,
    // then we can do it directly and avoid the alloca.
    // Otherwise, we'll let the fallback MIR body take care of it.
    if (name === sym.typed_swap_nonoverlapping) {
      const pointee_ty = fn_args.type_at(0);
      const pointee_layout = bx.layout_of(pointee_ty);
      if (
        pointee_layout.is_ssa_standalone() ||
        // But if we're not going to optimize, trying to use the fallback
        // body just makes things worse, so don't bother.
        bx.sess().opts.optimize === "No" ||
        // NOTE(eddyb) SPIR-V's Logical addressing model doesn't allow for arbitrary
        // reinterpretation of values as (chunkable) byte arrays, and the loop in the
        // block optimization in `ptr::swap_nonoverlapping` is hard to rewrite back
        // into the (unoptimized) direct swapping implementation, so we disable it.
        bx.sess().target.arch.$ === "SpirV"
      ) {
        const align = pointee_layout.align.abi;
        const x_place = OperandValue.deref(args[0]!.val, align, bx.debug_Value);
        const y_place = OperandValue.deref(args[1]!.val, align, bx.debug_Value);
        bx.typed_place_swap(x_place, y_place, pointee_layout);
        return { $: "Operand", _0: OperandValue.ZeroSized };
      }
    }

    const invalid_monomorphization_int_type = (ty: Ty): ErrorGuaranteed => {
      return bx.tcx_().dcx().emit_err(InvalidMonomorphization_diagnostic({ $: "BasicIntegerType", span, name, ty }));
    };
    const invalid_monomorphization_int_or_ptr_type = (ty: Ty): ErrorGuaranteed => {
      return bx.tcx_().dcx().emit_err(
        InvalidMonomorphization_diagnostic({
          $: "BasicIntegerOrPtrType",
          span,
          name,
          ty,
        }),
      );
    };

    const parse_atomic_ordering = (ord: Value) => {
      const discr = Value.to_branch(ord)[0]!.to_leaf();
      return discr.to_atomic_ordering();
    };

    if (args.length === 0) {
      switch (name) {
        case sym.abort_immediate:
        case sym.unreachable:
        case sym.cold_path:
        case sym.gpu_launch_sized_workgroup_mem:
        case sym.breakpoint:
        case sym.amdgpu_dispatch_ptr:
        case sym.assert_zero_valid:
        case sym.assert_mem_uninitialized_valid:
        case sym.assert_inhabited:
        case sym.ub_checks:
        case sym.contract_checks:
        case sym.atomic_fence:
        case sym.atomic_singlethreadfence:
        case sym.caller_location:
        case sym.offload_get_num_devices:
        case sym.return_address:
          break;
        default: {
          span_bug(
            span,
            `Nullary intrinsic ${Symbol.as_str(name)} must be called in a const block. ` +
              "If you are seeing this message from code outside the standard library, the " +
              "unstable implementation details of the relevant intrinsic may have changed. " +
              "Consider using stable APIs instead. " +
              "If you are adding a new nullary intrinsic that is inherently a runtime " +
              "intrinsic, update this check.",
          );
        }
      }
    }

    let op_val: OperandValue<unknown>;
    switch (name) {
      case sym.abort_immediate: {
        bx.abort_immediate();
        op_val = OperandValue.ZeroSized;
        break;
      }

      case sym.caller_location: {
        const location = this.get_caller_location(bx, source_info);
        op_val = location.val;
        break;
      }

      case sym.size_of_val: {
        const tp_ty = fn_args.type_at(0);
        const [, meta] = OperandValue.pointer_parts(args[0]!.val, bx.debug_Value);
        const [llsize] = size_and_align_of_dst(bx, tp_ty, meta, span);
        op_val = { $: "Immediate", _0: llsize };
        break;
      }
      case sym.align_of_val: {
        const tp_ty = fn_args.type_at(0);
        const [, meta] = OperandValue.pointer_parts(args[0]!.val, bx.debug_Value);
        const [, llalign] = size_and_align_of_dst(bx, tp_ty, meta, span);
        op_val = { $: "Immediate", _0: llalign };
        break;
      }
      case sym.vtable_size:
      case sym.vtable_align: {
        const vtable = args[0]!.immediate(bx.debug_Value);
        let idx: number;
        switch (name) {
          case sym.vtable_size:
            idx = COMMON_VTABLE_ENTRIES_SIZE;
            break;
          case sym.vtable_align:
            idx = COMMON_VTABLE_ENTRIES_ALIGN;
            break;
          default:
            return bug();
        }
        const value = VirtualIndex.from_index(idx).get_usize(bx, vtable, Instance.ty(instance, bx.tcx_(), bx.typing_env_()));
        switch (name) {
          // Size is always <= isize::MAX.
          case sym.vtable_size: {
            const size_bound = BigInt.asUintN(128, Integer.signed_max(bx.data_layout().ptr_sized_integer()));
            bx.range_metadata(value, new WrappingRange(0n, size_bound));
            break;
          }
          // Alignment is always a power of two, thus 1..=0x800…000,
          // but also bounded by the maximum we support in type layout.
          case sym.vtable_align: {
            const align_bound = BigInt(Align.max_for_target(bx.data_layout()).bytes());
            bx.range_metadata(value, new WrappingRange(1n, align_bound));
            break;
          }
          default:
            break;
        }
        op_val = { $: "Immediate", _0: value };
        break;
      }
      case sym.arith_offset: {
        const ty = fn_args.type_at(0);
        const layout = bx.layout_of(ty);
        const ptr = args[0]!.immediate(bx.debug_Value);
        const offset = args[1]!.immediate(bx.debug_Value);
        op_val = { $: "Immediate", _0: bx.gep(bx.backend_type(layout), ptr, [offset]) };
        break;
      }
      case sym.copy: {
        copy_intrinsic(
          bx,
          true,
          false,
          fn_args.type_at(0),
          args[1]!.immediate(bx.debug_Value),
          args[0]!.immediate(bx.debug_Value),
          args[2]!.immediate(bx.debug_Value),
        );
        op_val = OperandValue.ZeroSized;
        break;
      }
      case sym.write_bytes: {
        memset_intrinsic(bx, false, fn_args.type_at(0), args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value), args[2]!.immediate(bx.debug_Value));
        op_val = OperandValue.ZeroSized;
        break;
      }

      case sym.volatile_copy_nonoverlapping_memory: {
        copy_intrinsic(
          bx,
          false,
          true,
          fn_args.type_at(0),
          args[0]!.immediate(bx.debug_Value),
          args[1]!.immediate(bx.debug_Value),
          args[2]!.immediate(bx.debug_Value),
        );
        op_val = OperandValue.ZeroSized;
        break;
      }
      case sym.volatile_copy_memory: {
        copy_intrinsic(
          bx,
          true,
          true,
          fn_args.type_at(0),
          args[0]!.immediate(bx.debug_Value),
          args[1]!.immediate(bx.debug_Value),
          args[2]!.immediate(bx.debug_Value),
        );
        op_val = OperandValue.ZeroSized;
        break;
      }
      case sym.volatile_set_memory: {
        memset_intrinsic(bx, true, fn_args.type_at(0), args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value), args[2]!.immediate(bx.debug_Value));
        op_val = OperandValue.ZeroSized;
        break;
      }
      case sym.volatile_store:
      case sym.unaligned_volatile_store: {
        const dst0 = args[0]!.deref(bx.cx());
        const dst = name === sym.volatile_store ? dst0 : dst0.unaligned();
        OperandValue.volatile_store(args[1]!.val, bx, dst);
        op_val = OperandValue.ZeroSized;
        break;
      }
      case sym.disjoint_bitor: {
        const a = args[0]!.immediate(bx.debug_Value);
        const b = args[1]!.immediate(bx.debug_Value);
        op_val = { $: "Immediate", _0: bx.or_disjoint(a, b) };
        break;
      }
      case sym.exact_div: {
        const ty = args[0]!.layout.ty;
        const w = int_type_width_signed(ty, bx.tcx_());
        if (w !== undefined) {
          const [_width, signed] = w;
          op_val = {
            $: "Immediate",
            _0: signed
              ? bx.exactsdiv(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value))
              : bx.exactudiv(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value)),
          };
        } else {
          const err = bx.tcx_().dcx().emit_err(InvalidMonomorphization_diagnostic({ $: "BasicIntegerType", span, name, ty }));
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.fadd_fast:
      case sym.fsub_fast:
      case sym.fmul_fast:
      case sym.fdiv_fast:
      case sym.frem_fast: {
        if (float_type_width(args[0]!.layout.ty) !== undefined) {
          let v;
          switch (name) {
            case sym.fadd_fast:
              v = bx.fadd_fast(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fsub_fast:
              v = bx.fsub_fast(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fmul_fast:
              v = bx.fmul_fast(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fdiv_fast:
              v = bx.fdiv_fast(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.frem_fast:
              v = bx.frem_fast(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            default:
              return bug();
          }
          op_val = { $: "Immediate", _0: v };
        } else {
          const err = bx.tcx_().dcx().emit_err(
            InvalidMonomorphization_diagnostic({
              $: "BasicFloatType",
              span,
              name,
              ty: args[0]!.layout.ty,
            }),
          );
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.fadd_algebraic:
      case sym.fsub_algebraic:
      case sym.fmul_algebraic:
      case sym.fdiv_algebraic:
      case sym.frem_algebraic: {
        if (float_type_width(args[0]!.layout.ty) !== undefined) {
          let v;
          switch (name) {
            case sym.fadd_algebraic:
              v = bx.fadd_algebraic(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fsub_algebraic:
              v = bx.fsub_algebraic(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fmul_algebraic:
              v = bx.fmul_algebraic(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.fdiv_algebraic:
              v = bx.fdiv_algebraic(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            case sym.frem_algebraic:
              v = bx.frem_algebraic(args[0]!.immediate(bx.debug_Value), args[1]!.immediate(bx.debug_Value));
              break;
            default:
              return bug();
          }
          op_val = { $: "Immediate", _0: v };
        } else {
          const err = bx.tcx_().dcx().emit_err(
            InvalidMonomorphization_diagnostic({
              $: "BasicFloatType",
              span,
              name,
              ty: args[0]!.layout.ty,
            }),
          );
          return { $: "Err", _0: err };
        }
        break;
      }

      case sym.float_to_int_unchecked: {
        if (float_type_width(args[0]!.layout.ty) === undefined) {
          const err = bx.tcx_().dcx().emit_err(
            InvalidMonomorphization_diagnostic({
              $: "FloatToIntUnchecked",
              span,
              ty: args[0]!.layout.ty,
            }),
          );
          return { $: "Err", _0: err };
        }
        const w = int_type_width_signed(result_layout.ty, bx.tcx_());
        if (w === undefined) {
          const err = bx.tcx_().dcx().emit_err(
            InvalidMonomorphization_diagnostic({
              $: "FloatToIntUnchecked",
              span,
              ty: result_layout.ty,
            }),
          );
          return { $: "Err", _0: err };
        }
        const [_width, signed] = w;
        op_val = {
          $: "Immediate",
          _0: signed
            ? bx.fptosi(args[0]!.immediate(bx.debug_Value), bx.backend_type(result_layout))
            : bx.fptoui(args[0]!.immediate(bx.debug_Value), bx.backend_type(result_layout)),
        };
        break;
      }

      case sym.atomic_load: {
        const ty = fn_args.type_at(0);
        if (!(int_type_width_signed(ty, bx.tcx_()) !== undefined || ty.is_raw_ptr())) {
          const err = invalid_monomorphization_int_or_ptr_type(ty);
          return { $: "Err", _0: err };
        }
        const ordering = fn_args.const_at(1).to_value();
        const volatile = fn_args.const_at(2).to_value();
        const layout = bx.layout_of(ty);
        const source = args[0]!.immediate(bx.debug_Value);
        op_val = {
          $: "Immediate",
          _0: bx.atomic_load(bx.backend_type(layout), source, parse_atomic_ordering(ordering), unwrap_result(Value.to_leaf(volatile).try_to_bool(), debug_unit), layout.size),
        };
        break;
      }
      case sym.atomic_store: {
        const ty = fn_args.type_at(0);
        if (!(int_type_width_signed(ty, bx.tcx_()) !== undefined || ty.is_raw_ptr())) {
          const err = invalid_monomorphization_int_or_ptr_type(ty);
          return { $: "Err", _0: err };
        }
        const ordering = fn_args.const_at(1).to_value();
        const volatile = fn_args.const_at(2).to_value();
        const size = bx.layout_of(ty).size;
        const val = args[1]!.immediate(bx.debug_Value);
        const ptr = args[0]!.immediate(bx.debug_Value);
        bx.atomic_store(val, ptr, parse_atomic_ordering(ordering), unwrap_result(Value.to_leaf(volatile).try_to_bool(), debug_unit), size);
        op_val = OperandValue.ZeroSized;
        break;
      }
      // These are all AtomicRMW ops
      case sym.atomic_cxchg:
      case sym.atomic_cxchgweak: {
        const ty = fn_args.type_at(0);
        if (!(int_type_width_signed(ty, bx.tcx_()) !== undefined || ty.is_raw_ptr())) {
          const err = invalid_monomorphization_int_or_ptr_type(ty);
          return { $: "Err", _0: err };
        }
        const succ_ordering = fn_args.const_at(1).to_value();
        const fail_ordering = fn_args.const_at(2).to_value();
        const weak = name === sym.atomic_cxchgweak;
        const dst = args[0]!.immediate(bx.debug_Value);
        const cmp = args[1]!.immediate(bx.debug_Value);
        const src = args[2]!.immediate(bx.debug_Value);
        const [val, success] = bx.atomic_cmpxchg(dst, cmp, src, parse_atomic_ordering(succ_ordering), parse_atomic_ordering(fail_ordering), weak);

        const builder = OperandRefBuilder.new<unknown>(result_layout);
        builder.insert_imm(0 as FieldIdx, val, bx.debug_Value);
        builder.insert_imm(1 as FieldIdx, success, bx.debug_Value);
        op_val = builder.build(bx.cx()).val;
        break;
      }
      case sym.atomic_max:
      case sym.atomic_min: {
        const atom_op = name === sym.atomic_max ? AtomicRmwBinOp.AtomicMax : AtomicRmwBinOp.AtomicMin;

        const ty = fn_args.type_at(0);
        if (ty.kind().$ === "Int") {
          const ordering = fn_args.const_at(1).to_value();
          const ptr = args[0]!.immediate(bx.debug_Value);
          const val = args[1]!.immediate(bx.debug_Value);
          op_val = { $: "Immediate", _0: bx.atomic_rmw(atom_op, ptr, val, parse_atomic_ordering(ordering), /* ret_ptr */ false) };
        } else {
          const err = invalid_monomorphization_int_type(ty);
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.atomic_umax:
      case sym.atomic_umin: {
        const atom_op = name === sym.atomic_umax ? AtomicRmwBinOp.AtomicUMax : AtomicRmwBinOp.AtomicUMin;

        const ty = fn_args.type_at(0);
        if (ty.kind().$ === "Uint") {
          const ordering = fn_args.const_at(1).to_value();
          const ptr = args[0]!.immediate(bx.debug_Value);
          const val = args[1]!.immediate(bx.debug_Value);
          op_val = { $: "Immediate", _0: bx.atomic_rmw(atom_op, ptr, val, parse_atomic_ordering(ordering), /* ret_ptr */ false) };
        } else {
          const err = invalid_monomorphization_int_type(ty);
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.atomic_xchg: {
        const ty = fn_args.type_at(0);
        const ordering = fn_args.const_at(1).to_value();
        if (int_type_width_signed(ty, bx.tcx_()) !== undefined || ty.is_raw_ptr()) {
          const ptr = args[0]!.immediate(bx.debug_Value);
          const val = args[1]!.immediate(bx.debug_Value);
          const atomic_op = AtomicRmwBinOp.AtomicXchg;
          op_val = { $: "Immediate", _0: bx.atomic_rmw(atomic_op, ptr, val, parse_atomic_ordering(ordering), /* ret_ptr */ ty.is_raw_ptr()) };
        } else {
          const err = invalid_monomorphization_int_or_ptr_type(ty);
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.atomic_xadd:
      case sym.atomic_xsub:
      case sym.atomic_and:
      case sym.atomic_nand:
      case sym.atomic_or:
      case sym.atomic_xor: {
        let atom_op: AtomicRmwBinOp;
        switch (name) {
          case sym.atomic_xadd:
            atom_op = AtomicRmwBinOp.AtomicAdd;
            break;
          case sym.atomic_xsub:
            atom_op = AtomicRmwBinOp.AtomicSub;
            break;
          case sym.atomic_and:
            atom_op = AtomicRmwBinOp.AtomicAnd;
            break;
          case sym.atomic_nand:
            atom_op = AtomicRmwBinOp.AtomicNand;
            break;
          case sym.atomic_or:
            atom_op = AtomicRmwBinOp.AtomicOr;
            break;
          case sym.atomic_xor:
            atom_op = AtomicRmwBinOp.AtomicXor;
            break;
          default:
            return unreachable();
        }

        // The type of the in-memory data.
        const ty_mem = fn_args.type_at(0);
        // The type of the 2nd operand, given by-value.
        const ty_op = fn_args.type_at(1);

        const ordering = fn_args.const_at(2).to_value();
        // We require either both arguments to have the same integer type, or the first to
        // be a pointer and the second to be `usize`.
        if ((int_type_width_signed(ty_mem, bx.tcx_()) !== undefined && ty_op === ty_mem) || (ty_mem.is_raw_ptr() && ty_op === bx.tcx_().types.usize)) {
          const ptr = args[0]!.immediate(bx.debug_Value); // of type "pointer to `ty_mem`"
          const val = args[1]!.immediate(bx.debug_Value); // of type `ty_op`
          op_val = { $: "Immediate", _0: bx.atomic_rmw(atom_op, ptr, val, parse_atomic_ordering(ordering), /* ret_ptr */ ty_mem.is_raw_ptr()) };
        } else {
          const err = invalid_monomorphization_int_or_ptr_type(ty_mem);
          return { $: "Err", _0: err };
        }
        break;
      }
      case sym.atomic_fence: {
        const ordering = fn_args.const_at(0).to_value();
        bx.atomic_fence(parse_atomic_ordering(ordering), SynchronizationScope.CrossThread);
        op_val = OperandValue.ZeroSized;
        break;
      }

      case sym.atomic_singlethreadfence: {
        const ordering = fn_args.const_at(0).to_value();
        bx.atomic_fence(parse_atomic_ordering(ordering), SynchronizationScope.SingleThread);
        op_val = OperandValue.ZeroSized;
        break;
      }

      case sym.nontemporal_store: {
        const dst = args[0]!.deref(bx.cx());
        OperandValue.nontemporal_store(args[1]!.val, bx, dst);
        op_val = OperandValue.ZeroSized;
        break;
      }

      case sym.ptr_offset_from:
      case sym.ptr_offset_from_unsigned: {
        const ty = fn_args.type_at(0);
        const pointee_size = bx.layout_of(ty).size;

        const a0 = args[0]!.immediate(bx.debug_Value);
        const b0 = args[1]!.immediate(bx.debug_Value);
        const a = bx.ptrtoint(a0, bx.type_isize());
        const b = bx.ptrtoint(b0, bx.type_isize());
        const pointee_size_ = bx.const_usize(pointee_size.bytes_u64());
        let v;
        if (name === sym.ptr_offset_from) {
          // This is the same sequence that Clang emits for pointer subtraction.
          // It can be neither `nsw` nor `nuw` because the input is treated as
          // unsigned but then the output is treated as signed, so neither works.
          const d = bx.sub(a, b);
          // this is where the signed magic happens (notice the `s` in `exactsdiv`)
          v = bx.exactsdiv(d, pointee_size_);
        } else {
          // The `_unsigned` version knows the relative ordering of the pointers,
          // so can use `sub nuw` and `udiv exact` instead of dealing in signed.
          const d = bx.unchecked_usub(a, b);
          v = bx.exactudiv(d, pointee_size_);
        }
        op_val = { $: "Immediate", _0: v };
        break;
      }

      case sym.cold_path: {
        // This is a no-op. The intrinsic is just a hint to the optimizer.
        op_val = OperandValue.ZeroSized;
        break;
      }

      default: {
        // Need to use backend-specific things in the implementation.
        const result = bx.codegen_intrinsic_call(instance, args, result_layout, result_place, span);
        if (result.$ === "Operand") {
          op_val = result._0;
        } else {
          return result;
        }
      }
    }

    // debug_assert!(
    //     op_val.is_expected_variant_for_type(result_layout),
    //     "[{name:?}] Value {op_val:?} is wrong for type {result_layout:?}",
    // );

    return { $: "Operand", _0: op_val };
  };
}

// Returns the width of an int Ty, and if it's signed or not
// Returns None if the type is not an integer
// FIXME: there’s multiple of this functions, investigate using some of the already existing
// stuffs.
// rustc: compiler/rustc_codegen_ssa/src/mir/intrinsic.rs:626 int_type_width_signed
function int_type_width_signed(ty: Ty, tcx: TyCtxt): [number, boolean] | undefined {
  const k = ty.kind();
  switch (k.$) {
    case "Int":
      return [IntTy.bit_width(k._0) ?? tcx.sess.target.pointer_width, true];
    case "Uint":
      return [UintTy.bit_width(k._0) ?? tcx.sess.target.pointer_width, false];
    default:
      return undefined;
  }
}

// Returns the width of a float Ty
// Returns None if the type is not a float
// rustc: compiler/rustc_codegen_ssa/src/mir/intrinsic.rs:640 float_type_width
function float_type_width(ty: Ty): number | undefined {
  const k = ty.kind();
  switch (k.$) {
    case "Float":
      return FloatTy.bit_width(k._0);
    default:
      return undefined;
  }
}
