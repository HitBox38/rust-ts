// Port of compiler/rustc_codegen_llvm/src/va_arg.rs (skeleton: lane cg-contract; lane ir-fix-a ported `emit_va_arg` and the
// x86_64 SysV path ahead of the fill lane, because run-pass programs reach it; lane cg-intrinsic-b ported the rest: every
// target's body, `emit_aapcs_va_arg` (:189), `emit_powerpc_va_arg` (:293), `emit_s390x_va_arg` (:423),
// `emit_hexagon_va_arg_musl` (:832), `emit_hexagon_va_arg_bare_metal` (:915) and `emit_xtensa_va_arg` (:952), and the
// `assert_matches!` / `bug!` texts of `emit_va_arg`). The whole file, in upstream order.
// - `bx` is a concrete `Builder`, so `bx.load(..)` / `bx.store(..)` / `bx.append_block(..)` / `bx.va_arg(..)` resolve to the
//   inherent `load_inherent` / `store_inherent` / `va_arg_inherent` (intrinsic.ts header, decision 2026-11-11); every other
//   name has one method.
// - `std::assert_matches!(stability, CVariadicStatus::Unstable { .. })` is `assert_unstable` (core's text, with the `Debug`
//   of `CVariadicStatus`).
// - `align.bytes() as i32` and the other `as i32` / `as u32` / `as u64` casts take values far below 2^31 here (alignments,
//   slot sizes, register counts and offsets); `u64::div_ceil` / `next_multiple_of` of such sizes are `Math.ceil` forms.
import { Align, type BackendRepr, Primitive, type Primitive as PrimitiveT, Scalar, type Size, debug_AlignFromBytesError, debug_BackendRepr } from "../rustc_abi/lib.ts";
import { Integer, Float } from "../rustc_abi/lib.ts";
import { type CVariadicStatus, debug_CVariadicStatus } from "../rustc_abi/extern_abi.ts";
import { IntPredicate } from "../rustc_codegen_ssa/common.ts";
import type { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { LlvmAbi } from "../rustc_target/spec/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, assert_matches, unreachable } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import type { Builder } from "./builder.ts";
import type { Value } from "./llvm/mod.ts";

/** `std::assert_matches!(stability, CVariadicStatus::Unstable { .. })` (header). */
const assert_unstable = (stability: CVariadicStatus): void =>
  assert_matches(stability, stability.$ === "Unstable", "CVariadicStatus::Unstable { .. }", (v) => debug_CVariadicStatus(v, PLAIN));

const align_from_bytes = (n: number): Align => unwrap_result(Align.from_bytes(n), debug_AlignFromBytesError);

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:18 round_up_to_alignment
function round_up_to_alignment(bx: Builder, value: Value, align: Align): Value {
  value = bx.add(value, bx.cx().const_i32(align.bytes() - 1));
  return bx.and(value, bx.cx().const_i32(-align.bytes()));
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:27 round_pointer_up_to_alignment
function round_pointer_up_to_alignment(bx: Builder, addr: Value, align: Align): Value {
  const ptr = bx.inbounds_ptradd(addr, bx.const_i32(align.bytes() - 1));
  const pointer_width = bx.tcx.sess.target.pointer_width;
  // `align.bytes().wrapping_neg() & (u64::MAX >> (64 - pointer_width))`
  const mask = BigInt.asUintN(64, -BigInt(align.bytes())) & (((1n << 64n) - 1n) >> BigInt(64 - pointer_width));
  return bx.call_intrinsic("llvm.ptrmask", [bx.type_ptr(), bx.type_isize()], [ptr, bx.const_usize(mask)]);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:42 emit_direct_ptr_va_arg
function emit_direct_ptr_va_arg(bx: Builder, list: OperandRef<Value>, size: Size, align: Align, slot_size: Align, allow_higher_align: boolean, force_right_adjust: boolean): [Value, Align] {
  const va_list_ty = bx.type_ptr();
  const va_list_addr = list.immediate(String);

  const ptr_align_abi = bx.tcx.data_layout().pointer_align().abi;
  const ptr = bx.load_inherent(va_list_ty, va_list_addr, ptr_align_abi);

  const [addr, addr_align] = allow_higher_align && align.pow2 > slot_size.pow2 ? [round_pointer_up_to_alignment(bx, ptr, align), align] : [ptr, slot_size];

  const aligned_size = size.align_to(slot_size).bytes();
  const full_direct_size = bx.cx().const_i32(aligned_size);
  const next = bx.inbounds_ptradd(addr, full_direct_size);
  bx.store_inherent(next, va_list_addr, ptr_align_abi);

  if (size.bytes() < slot_size.bytes() && bx.tcx.sess.target.endian === "Big" && force_right_adjust) {
    const adjusted_size = bx.cx().const_i32(slot_size.bytes() - size.bytes());
    const adjusted = bx.inbounds_ptradd(addr, adjusted_size);
    // We're in the middle of a slot now, so use the type's alignment, not the slot's.
    return [adjusted, align];
  } else {
    return [addr, addr_align];
  }
}

/// Some backends apply special alignment rules to c-variadic arguments.
// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:82 get_param_type_alignment
function get_param_type_alignment(bx: Builder, layout: TyAndLayout): Align {
  const repr = layout.backend_repr;
  if (repr.$ !== "Scalar") {
    return bug(`unexpected backend repr ${debug_BackendRepr(repr, PLAIN)}`);
  }
  const scalar = repr._0;

  switch (bx.cx_.tcx.sess.target.arch.$) {
    case "PowerPC64": {
      const p = Scalar.primitive(scalar);
      switch (p.$) {
        case "Int":
          switch (p._0) {
            case "I8":
            case "I16":
              return unreachable("internal error: entered unreachable code");
            case "I32":
            case "I64":
              /* fall through */
              break;
            case "I128":
              return Align.EIGHT;
          }
          break;
        case "Float":
          switch (p._0) {
            case "F16":
            case "F16B":
            case "F32":
              return unreachable("internal error: entered unreachable code");
            case "F64":
            case "F128":
            case "PpcF128":
              /* fall through */
              break;
          }
          break;
        case "Pointer":
          /* fall through */
          break;
      }
      break;
    }
    default:
      /* fall through */
      break;
  }

  return layout.align.abi;
}

type PassMode = "Direct" | "Indirect";

/** `enum SlotSize { Bytes8 = 8, Bytes4 = 4, Bytes1 = 1 }`: the discriminant. */
type SlotSize = 8 | 4 | 1;

/// Whether to respect a value alignment that is higher than the slot alignment.
///
/// When `No` the argument is in the next slot, when `Yes` there will be empty slots
/// until a slot's starting address has the required alignment.
type AllowHigherAlign = "No" | "Yes";

/// Determines where in the slot the value is located. Only takes effect on big-endian targets.
///
/// with 8-byte slots, a 32-bit integer is either stored right-adjusted:
///
/// ```text
/// [0x0, 0x0, 0x0, 0x0, 0xaa, 0xaa, 0xaa, 0xaa]
/// ```
///
/// or left-adjusted:
///
/// ```text
/// [0xaa, 0xaa, 0xaa, 0xaa, 0x0, 0x0, 0x0, 0x0]
/// ```
///
/// Most big-endian targets store values as right-adjusted.
type ForceRightAdjust = "No" | "Yes";

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:149 emit_ptr_va_arg
function emit_ptr_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout, pass_mode: PassMode, slot_size_: SlotSize, allow_higher_align_: AllowHigherAlign, force_right_adjust_: ForceRightAdjust): Value {
  const indirect = pass_mode === "Indirect";
  const allow_higher_align = allow_higher_align_ === "Yes";
  const force_right_adjust = force_right_adjust_ === "Yes";
  const slot_size = align_from_bytes(slot_size_);

  const [llty, size, align] = indirect
    ? [bx.cx_.layout_of(Ty.new_imm_ptr(bx.cx_.tcx, layout.ty)).llvm_type(bx.cx_), bx.cx_.data_layout().pointer_size(), bx.cx_.data_layout().pointer_align().abi]
    : [layout.llvm_type(bx.cx_), layout.size, get_param_type_alignment(bx, layout)];
  const [addr, addr_align] = emit_direct_ptr_va_arg(bx, list, size, align, slot_size, allow_higher_align, force_right_adjust);
  if (indirect) {
    const tmp_ret = bx.load_inherent(llty, addr, addr_align);
    return bx.load_inherent(layout.llvm_type(bx.cx_), tmp_ret, align);
  } else {
    return bx.load_inherent(llty, addr, addr_align);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:189 emit_aapcs_va_arg
function emit_aapcs_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  const dl = bx.cx_.data_layout();

  // Implementation of the AAPCS64 calling convention for va_args see
  // https://github.com/ARM-software/abi-aa/blob/master/aapcs64/aapcs64.rst
  //
  // typedef struct  va_list {
  //     void * stack; // next stack param
  //     void * gr_top; // end of GP arg reg save area
  //     void * vr_top; // end of FP/SIMD arg reg save area
  //     int gr_offs; // offset from  gr_top to next GP register arg
  //     int vr_offs; // offset from  vr_top to next FP/SIMD register arg
  // } va_list;
  const va_list_addr = list.immediate(String);

  // There is no padding between fields since `void*` is size=8 align=8, `int` is size=4 align=4.
  // See https://github.com/ARM-software/abi-aa/blob/master/aapcs64/aapcs64.rst
  // Table 1, Byte size and byte alignment of fundamental data types
  // Table 3, Mapping of C & C++ built-in data types
  const ptr_offset = 8;
  const i32_offset = 4;
  const gr_top = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(ptr_offset)));
  const vr_top = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(2 * ptr_offset)));
  const gr_offs = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(3 * ptr_offset)));
  const vr_offs = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(3 * ptr_offset + i32_offset)));

  const maybe_reg = bx.append_sibling_block("va_arg.maybe_reg");
  const in_reg = bx.append_sibling_block("va_arg.in_reg");
  const on_stack = bx.append_sibling_block("va_arg.on_stack");
  const end = bx.append_sibling_block("va_arg.end");
  const zero = bx.const_i32(0);
  const offset_align = align_from_bytes(4);

  const gr_type = layout.ty.is_any_ptr() || layout.ty.is_integral();
  let reg_off: Value;
  let reg_top: Value;
  let slot_size: number;
  if (gr_type) {
    const nreg = Math.ceil(layout.size.bytes() / 8);
    [reg_off, reg_top, slot_size] = [gr_offs, gr_top, nreg * 8];
  } else {
    const nreg = Math.ceil(layout.size.bytes() / 16);
    [reg_off, reg_top, slot_size] = [vr_offs, vr_top, nreg * 16];
  }

  // if the offset >= 0 then the value will be on the stack
  let reg_off_v = bx.load_inherent(bx.type_i32(), reg_off, offset_align);
  let use_stack = bx.icmp(IntPredicate.IntSGE, reg_off_v, zero);
  bx.cond_br(use_stack, on_stack, maybe_reg);

  // The value at this point might be in a register, but there is a chance that
  // it could be on the stack so we have to update the offset and then check
  // the offset again.

  bx.switch_to_block(maybe_reg);
  if (gr_type && layout.align.abi.bytes() > 8) {
    reg_off_v = bx.add(reg_off_v, bx.const_i32(15));
    reg_off_v = bx.and(reg_off_v, bx.const_i32(-16));
  }
  const new_reg_off_v = bx.add(reg_off_v, bx.const_i32(slot_size));

  bx.store_inherent(new_reg_off_v, reg_off, offset_align);

  // Check to see if we have overflowed the registers as a result of this.
  // If we have then we need to use the stack for this value
  use_stack = bx.icmp(IntPredicate.IntSGT, new_reg_off_v, zero);
  bx.cond_br(use_stack, on_stack, in_reg);

  bx.switch_to_block(in_reg);
  const top_type = bx.type_ptr();
  const top = bx.load_inherent(top_type, reg_top, dl.pointer_align().abi);

  // reg_value = *(@top + reg_off_v);
  let reg_addr = bx.ptradd(top, reg_off_v);
  if (bx.tcx_().sess.target.endian === "Big" && layout.size.bytes() !== slot_size) {
    // On big-endian systems the value is right-aligned in its slot.
    const offset = bx.const_i32(slot_size - layout.size.bytes());
    reg_addr = bx.ptradd(reg_addr, offset);
  }
  const reg_type = layout.llvm_type(bx.cx_);
  const reg_value = bx.load_inherent(reg_type, reg_addr, layout.align.abi);
  bx.br(end);

  // On Stack block
  bx.switch_to_block(on_stack);
  const stack_value = emit_ptr_va_arg(bx, list, layout, "Direct", 8, "Yes", "No");
  bx.br(end);

  bx.switch_to_block(end);
  const val = bx.phi(layout.immediate_llvm_type(bx.cx_), [reg_value, stack_value], [in_reg, on_stack]);

  return val;
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:293 emit_powerpc_va_arg
function emit_powerpc_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  const dl = bx.cx_.data_layout();

  // struct __va_list_tag {
  //   unsigned char gpr;
  //   unsigned char fpr;
  //   unsigned short reserved;
  //   void *overflow_arg_area;
  //   void *reg_save_area;
  // };
  const va_list_addr = list.immediate(String);

  // Peel off any newtype wrappers.
  layout = layout.peel_transparent_wrappers_from_non_1zst(bx.cx_);

  // Rust does not currently support any powerpc softfloat targets.
  const target = bx.cx_.tcx.sess.target;
  const is_soft_float_abi = target.rustc_abi === "Softfloat";
  assert(!is_soft_float_abi, "assertion failed: !is_soft_float_abi");

  // All instances of VaArgSafe are passed directly.
  const is_indirect = false;

  let is_i64: boolean;
  let is_int: boolean;
  let is_f64: boolean;
  const repr = layout.layout.backend_repr();
  if (repr.$ === "Scalar") {
    const p = Scalar.primitive(repr._0);
    switch (p.$) {
      case "Int":
        [is_i64, is_int, is_f64] = [Integer.size(p._0).bits() === 64, true, false];
        break;
      case "Float":
        [is_i64, is_int, is_f64] = [false, false, Float.size(p._0).bits() === 64];
        break;
      case "Pointer":
        [is_i64, is_int, is_f64] = [false, true, false];
        break;
    }
  } else {
    return unreachable("internal error: entered unreachable code: all instances of VaArgSafe are represented as scalars");
  }

  const num_regs_addr = is_int || is_soft_float_abi
    ? va_list_addr // gpr
    : bx.inbounds_ptradd(va_list_addr, bx.const_usize(1n)); // fpr

  let num_regs = bx.load_inherent(bx.type_i8(), num_regs_addr, dl.i8_align);

  // "Align" the register count when the type is passed as `i64`.
  if (is_i64 || (is_f64 && is_soft_float_abi)) {
    num_regs = bx.add(num_regs, bx.const_u8(1));
    num_regs = bx.and(num_regs, bx.const_u8(0b1111_1110));
  }

  const max_regs = 8;
  const use_regs = bx.icmp(IntPredicate.IntULT, num_regs, bx.const_u8(max_regs));
  const ptr_align_abi = bx.tcx_().data_layout().pointer_align().abi;

  const in_reg = bx.append_sibling_block("va_arg.in_reg");
  const in_mem = bx.append_sibling_block("va_arg.in_mem");
  const end = bx.append_sibling_block("va_arg.end");

  bx.cond_br(use_regs, in_reg, in_mem);

  const reg_addr = ((): Value => {
    bx.switch_to_block(in_reg);

    const reg_safe_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(1 + 1 + 2 + 4)));
    let reg_addr = bx.load_inherent(bx.type_ptr(), reg_safe_area_ptr, ptr_align_abi);

    // Floating-point registers start after the general-purpose registers.
    if (!is_int && !is_soft_float_abi) {
      reg_addr = bx.inbounds_ptradd(reg_addr, bx.cx_.const_usize(32n));
    }

    // Get the address of the saved value by scaling the number of
    // registers we've used by the number of.
    const reg_size = is_int || is_soft_float_abi ? 4 : 8;
    const reg_offset = bx.mul(num_regs, bx.cx().const_u8(reg_size));
    const reg_addr_ = bx.inbounds_ptradd(reg_addr, reg_offset);

    // Increase the used-register count.
    const reg_incr = is_i64 || (is_f64 && is_soft_float_abi) ? 2 : 1;
    const new_num_regs = bx.add(num_regs, bx.cx_.const_u8(reg_incr));
    bx.store_inherent(new_num_regs, num_regs_addr, dl.i8_align);

    bx.br(end);

    return reg_addr_;
  })();

  const mem_addr = ((): Value => {
    bx.switch_to_block(in_mem);

    bx.store_inherent(bx.const_u8(max_regs), num_regs_addr, dl.i8_align);

    // Everything in the overflow area is rounded up to a size of at least 4.
    const overflow_area_align = align_from_bytes(4);

    const size = !is_indirect ? layout.layout.size().align_to(overflow_area_align) : dl.pointer_size();

    const overflow_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(1 + 1 + 2)));
    let overflow_area = bx.load_inherent(bx.type_ptr(), overflow_area_ptr, ptr_align_abi);

    // Round up address of argument to alignment
    if (layout.layout.align().abi.pow2 > overflow_area_align.pow2) {
      overflow_area = round_pointer_up_to_alignment(bx, overflow_area, layout.layout.align().abi);
    }

    const mem_addr = overflow_area;

    // Increase the overflow area.
    overflow_area = bx.inbounds_ptradd(overflow_area, bx.const_usize(BigInt(size.bytes())));
    bx.store_inherent(overflow_area, overflow_area_ptr, ptr_align_abi);

    bx.br(end);

    return mem_addr;
  })();

  // Return the appropriate result.
  bx.switch_to_block(end);
  const val_addr_ = bx.phi(bx.type_ptr(), [reg_addr, mem_addr], [in_reg, in_mem]);
  const val_type = layout.llvm_type(bx.cx_);
  const val_addr = is_indirect ? bx.load_inherent(bx.cx_.type_ptr(), val_addr_, ptr_align_abi) : val_addr_;
  return bx.load_inherent(val_type, val_addr, layout.align.abi);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:423 emit_s390x_va_arg
function emit_s390x_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  const dl = bx.cx_.data_layout();

  // Implementation of the s390x ELF ABI calling convention for va_args see
  // https://github.com/IBM/s390x-abi (chapter 1.2.4)
  //
  // typedef struct __va_list_tag {
  //     long __gpr;
  //     long __fpr;
  //     void *__overflow_arg_area;
  //     void *__reg_save_area;
  // } va_list[1];
  const va_list_addr = list.immediate(String);

  // There is no padding between fields since `long` and `void*` both have size=8 align=8.
  // https://github.com/IBM/s390x-abi (Table 1.1.: Scalar types)
  const i64_offset = 8;
  const ptr_offset = 8;
  const gpr = va_list_addr;
  const fpr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(i64_offset)));
  const overflow_arg_area = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(2 * i64_offset)));
  const reg_save_area = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(2 * i64_offset + ptr_offset)));

  const in_reg = bx.append_sibling_block("va_arg.in_reg");
  const in_mem = bx.append_sibling_block("va_arg.in_mem");
  const end = bx.append_sibling_block("va_arg.end");
  const ptr_align_abi = dl.pointer_align().abi;

  // FIXME: vector ABI not yet supported.
  const target_ty_size = layout.size.bytes();
  const indirect: boolean = target_ty_size > 8 || !is_power_of_two(target_ty_size);
  const unpadded_size = indirect ? 8 : target_ty_size;
  const padded_size = 8;
  const padding = padded_size - unpadded_size;

  // NOTE: if we ever allow aggregate types, this should handle structs with a single fp element.
  const is_single_fp_element = (layout: TyAndLayout): boolean => {
    const repr = layout.layout.backend_repr();
    switch (repr.$) {
      case "Scalar": {
        const p = Scalar.primitive(repr._0);
        switch (p.$) {
          case "Float":
            switch (p._0) {
              case "F16":
              case "F32":
              case "F64":
                return true;
              case "F128":
                return false;
              case "F16B":
                return bug("`f16b` use in varadics unsupported on s390x");
              case "PpcF128":
                return bug("`ppcf128` use in varadics unsupported on s390x");
            }
            break;
          case "Int":
          case "Pointer":
            return false;
        }
        return unreachable("internal error: entered unreachable code");
      }

      default:
        return false;
    }
  };

  const gpr_type = indirect || !is_single_fp_element(layout);
  const [max_regs, reg_count, reg_save_index, reg_padding] = gpr_type ? [5, gpr, 2, padding] : [4, fpr, 16, 0];

  // Check whether the value was passed in a register or in memory.
  const reg_count_v = bx.load_inherent(bx.type_i64(), reg_count, align_from_bytes(8));
  const use_regs = bx.icmp(IntPredicate.IntULT, reg_count_v, bx.const_u64(BigInt(max_regs)));
  bx.cond_br(use_regs, in_reg, in_mem);

  // Emit code to load the value if it was passed in a register.
  bx.switch_to_block(in_reg);

  // Work out the address of the value in the register save area.
  const reg_ptr_v = bx.load_inherent(bx.type_ptr(), reg_save_area, ptr_align_abi);
  const scaled_reg_count = bx.mul(reg_count_v, bx.const_u64(8n));
  const reg_off = bx.add(scaled_reg_count, bx.const_u64(BigInt(reg_save_index * 8 + reg_padding)));
  const reg_addr = bx.ptradd(reg_ptr_v, reg_off);

  // Update the register count.
  const new_reg_count_v = bx.add(reg_count_v, bx.const_u64(1n));
  bx.store_inherent(new_reg_count_v, reg_count, align_from_bytes(8));
  bx.br(end);

  // Emit code to load the value if it was passed in memory.
  bx.switch_to_block(in_mem);

  // Work out the address of the value in the argument overflow area.
  const arg_ptr_v = bx.load_inherent(bx.type_ptr(), overflow_arg_area, ptr_align_abi);
  const arg_off = bx.const_u64(BigInt(padding));
  const mem_addr = bx.ptradd(arg_ptr_v, arg_off);

  // Update the argument overflow area pointer.
  const arg_size = bx.cx().const_u64(BigInt(padded_size));
  const new_arg_ptr_v = bx.inbounds_ptradd(arg_ptr_v, arg_size);
  bx.store_inherent(new_arg_ptr_v, overflow_arg_area, ptr_align_abi);
  bx.br(end);

  // Return the appropriate result.
  bx.switch_to_block(end);
  const val_addr_ = bx.phi(bx.type_ptr(), [reg_addr, mem_addr], [in_reg, in_mem]);
  const val_type = layout.llvm_type(bx.cx_);
  const val_addr = indirect ? bx.load_inherent(bx.cx_.type_ptr(), val_addr_, ptr_align_abi) : val_addr_;
  return bx.load_inherent(val_type, val_addr, layout.align.abi);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:528 emit_x86_64_sysv64_va_arg
function emit_x86_64_sysv64_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  const dl = bx.cx_.data_layout();

  // Implementation of the systemv x86_64 ABI calling convention for va_args, see
  // https://gitlab.com/x86-psABIs/x86-64-ABI (section 3.5.7). This implementation is heavily
  // based on the one in clang.

  // We're able to take some shortcuts because the return type of `va_arg` must implement the
  // `VaArgSafe` trait. Currently, only pointers, f64, i32, u32, i64 and u64 implement this trait.

  // typedef struct __va_list_tag {
  //     unsigned int gp_offset;
  //     unsigned int fp_offset;
  //     void *overflow_arg_area;
  //     void *reg_save_area;
  // } va_list[1];
  const va_list_addr = list.immediate(String);

  // Peel off any newtype wrappers.
  //
  // The "C" ABI does not unwrap newtypes (see `ReprOptions::inhibit_newtype_abi_optimization`).
  // Here, we do actually want the unwrapped representation, because that is how LLVM/Clang
  // pass such types to variadic functions.
  //
  // An example of a type that must be unwrapped is `Foo` below. Without the unwrapping, it has
  // `BackendRepr::Memory`, but we need it to be `BackendRepr::Scalar` to generate correct code.
  //
  // ```
  // #[repr(C)]
  // struct Empty;
  //
  // #[repr(C)]
  // struct Foo([Empty; 8], i32);
  // ```
  layout = layout.peel_transparent_wrappers_from_non_1zst(bx.cx_);

  // AMD64-ABI 3.5.7p5: Step 1. Determine whether type may be passed
  // in the registers. If not go to step 7.

  // AMD64-ABI 3.5.7p5: Step 2. Compute num_gp to hold the number of
  // general purpose registers needed to pass type and num_fp to hold
  // the number of floating point registers needed.

  let num_gp_registers = 0;
  let num_fp_registers = 0;

  const registers_for_primitive = (p: PrimitiveT): void => {
    switch (p.$) {
      case "Int":
        num_gp_registers += Math.ceil(Integer.size(p._0).bytes() / 8);
        break;
      case "Float":
        num_fp_registers += Math.ceil(Float.size(p._0).bytes() / 16);
        break;
      case "Pointer":
        num_gp_registers += 1;
        break;
    }
  };

  const repr: BackendRepr = layout.layout.backend_repr();
  switch (repr.$) {
    case "Scalar":
      registers_for_primitive(Scalar.primitive(repr._0));
      break;
    case "ScalarPair":
      registers_for_primitive(Scalar.primitive(repr.a));
      registers_for_primitive(Scalar.primitive(repr.b));
      break;
    case "SimdVector":
    case "SimdScalableVector":
      // Because no instance of VaArgSafe uses a non-scalar `BackendRepr`.
      return unreachable(`internal error: entered unreachable code: No x86-64 SysV va_arg implementation for ${debug_BackendRepr(repr, PLAIN)}`);
    case "Memory": {
      const mem_addr = x86_64_sysv64_va_arg_from_memory(bx, va_list_addr, layout);
      return bx.load_inherent(layout.llvm_type(bx.cx_), mem_addr, layout.align.abi);
    }
  }

  // AMD64-ABI 3.5.7p5: Step 3. Verify whether arguments fit into
  // registers. In the case: l->gp_offset > 48 - num_gp * 8 or
  // l->fp_offset > 176 - num_fp * 16 go to step 7.

  // We support x86_64-unknown-linux-gnux32 which uses 4-byte pointers.
  const unsigned_int_offset = 4;
  const ptr_offset = bx.tcx.data_layout().pointer_size().bytes();

  const gp_offset_ptr = va_list_addr;
  const fp_offset_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(unsigned_int_offset)));

  const gp_offset_v = bx.load_inherent(bx.type_i32(), gp_offset_ptr, align_from_bytes(8));
  const fp_offset_v = bx.load_inherent(bx.type_i32(), fp_offset_ptr, align_from_bytes(4));

  let use_regs = bx.const_bool(false);

  if (num_gp_registers > 0) {
    const max_offset_val = 48 - num_gp_registers * 8;
    const fits_in_gp = bx.icmp(IntPredicate.IntULE, gp_offset_v, bx.const_u32(max_offset_val));
    use_regs = fits_in_gp;
  }

  if (num_fp_registers > 0) {
    const max_offset_val = 176 - num_fp_registers * 16;
    const fits_in_fp = bx.icmp(IntPredicate.IntULE, fp_offset_v, bx.const_u32(max_offset_val));
    use_regs = num_gp_registers > 0 ? bx.and(use_regs, fits_in_fp) : fits_in_fp;
  }

  const in_reg = bx.append_sibling_block("va_arg.in_reg");
  const in_mem = bx.append_sibling_block("va_arg.in_mem");
  const end = bx.append_sibling_block("va_arg.end");

  bx.cond_br(use_regs, in_reg, in_mem);

  // Emit code to load the value if it was passed in a register.
  bx.switch_to_block(in_reg);

  // AMD64-ABI 3.5.7p5: Step 4. Fetch type from l->reg_save_area with
  // an offset of l->gp_offset and/or l->fp_offset. This may require
  // copying to a temporary location in case the parameter is passed
  // in different register classes or requires an alignment greater
  // than 8 for general purpose registers and 16 for XMM registers.
  //
  // FIXME(llvm): This really results in shameful code when we end up needing to
  // collect arguments from different places; often what should result in a
  // simple assembling of a structure from scattered addresses has many more
  // loads than necessary. Can we clean this up?
  const reg_save_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(2 * unsigned_int_offset + ptr_offset)));
  const reg_save_area_v = bx.load_inherent(bx.type_ptr(), reg_save_area_ptr, dl.pointer_align().abi);

  let reg_addr: Value;
  switch (repr.$) {
    case "Scalar": {
      const p = Scalar.primitive(repr._0);
      switch (p.$) {
        case "Int":
        case "Pointer": {
          const reg_addr_ = bx.inbounds_ptradd(reg_save_area_v, gp_offset_v);

          // Copy into a temporary if the type is more aligned than the register save area.
          const gp_align = align_from_bytes(8);
          reg_addr = copy_to_temporary_if_more_aligned(bx, reg_addr_, layout, gp_align);
          break;
        }
        case "Float":
          reg_addr = bx.inbounds_ptradd(reg_save_area_v, fp_offset_v);
          break;
      }
      break;
    }
    case "ScalarPair": {
      const { a: scalar1, b: scalar2, b_offset: offset } = repr;
      const ty_lo = bx.cx().scalar_pair_element_backend_type(layout, 0, false);
      const ty_hi = bx.cx().scalar_pair_element_backend_type(layout, 1, false);

      const align_lo = layout.field(bx.cx_, 0).layout.align().abi;
      const align_hi = layout.field(bx.cx_, 1).layout.align().abi;

      const p1 = Scalar.primitive(scalar1);
      const p2 = Scalar.primitive(scalar2);
      if (p1.$ === "Float" && p2.$ === "Float") {
        // SSE registers are spaced 16 bytes apart in the register save
        // area, we need to collect the two eightbytes together.
        // The ABI isn't explicit about this, but it seems reasonable
        // to assume that the slots are 16-byte aligned, since the stack is
        // naturally 16-byte aligned and the prologue is expected to store
        // all the SSE registers to the RSA.
        const reg_lo_addr = bx.inbounds_ptradd(reg_save_area_v, fp_offset_v);
        const reg_hi_addr = bx.inbounds_ptradd(reg_lo_addr, bx.const_i32(16));

        const align = layout.layout.align().abi;
        const tmp = bx.alloca(layout.size, layout.align.abi);

        const reg_lo = bx.load_inherent(ty_lo, reg_lo_addr, align_lo);
        const reg_hi = bx.load_inherent(ty_hi, reg_hi_addr, align_hi);

        const field0 = tmp;
        const field1 = bx.inbounds_ptradd(tmp, bx.const_u32(offset.bytes()));

        bx.store_inherent(reg_lo, field0, align);
        bx.store_inherent(reg_hi, field1, align);

        reg_addr = tmp;
      } else if (p1.$ === "Float" || p2.$ === "Float") {
        const gp_addr = bx.inbounds_ptradd(reg_save_area_v, gp_offset_v);
        const fp_addr = bx.inbounds_ptradd(reg_save_area_v, fp_offset_v);

        const [reg_lo_addr, reg_hi_addr] = p1.$ === "Float" ? [fp_addr, gp_addr] : [gp_addr, fp_addr];

        const tmp = bx.alloca(layout.size, layout.align.abi);

        const reg_lo = bx.load_inherent(ty_lo, reg_lo_addr, align_lo);
        const reg_hi = bx.load_inherent(ty_hi, reg_hi_addr, align_hi);

        const field0 = tmp;
        const field1 = bx.inbounds_ptradd(tmp, bx.const_u32(offset.bytes()));

        bx.store_inherent(reg_lo, field0, align_lo);
        bx.store_inherent(reg_hi, field1, align_hi);

        reg_addr = tmp;
      } else {
        // Two integer/pointer values are just contiguous in memory.
        const reg_addr_ = bx.inbounds_ptradd(reg_save_area_v, gp_offset_v);

        // Copy into a temporary if the type is more aligned than the register save area.
        const gp_align = align_from_bytes(8);
        reg_addr = copy_to_temporary_if_more_aligned(bx, reg_addr_, layout, gp_align);
      }
      break;
    }
    // The Previous match on `BackendRepr` means control flow already escaped.
    default:
      return unreachable("internal error: entered unreachable code");
  }

  // AMD64-ABI 3.5.7p5: Step 5. Set:
  // l->gp_offset = l->gp_offset + num_gp * 8
  if (num_gp_registers > 0) {
    const offset = bx.const_u32(num_gp_registers * 8);
    const sum = bx.add(gp_offset_v, offset);
    // An alignment of 8 because `__va_list_tag` is 8-aligned and this is its first field.
    bx.store_inherent(sum, gp_offset_ptr, align_from_bytes(8));
  }

  // l->fp_offset = l->fp_offset + num_fp * 16.
  if (num_fp_registers > 0) {
    const offset = bx.const_u32(num_fp_registers * 16);
    const sum = bx.add(fp_offset_v, offset);
    bx.store_inherent(sum, fp_offset_ptr, align_from_bytes(4));
  }

  bx.br(end);

  bx.switch_to_block(in_mem);
  const mem_addr = x86_64_sysv64_va_arg_from_memory(bx, va_list_addr, layout);
  bx.br(end);

  bx.switch_to_block(end);

  const val_type = layout.llvm_type(bx.cx_);
  const val_addr = bx.phi(bx.type_ptr(), [reg_addr, mem_addr], [in_reg, in_mem]);

  return bx.load_inherent(val_type, val_addr, layout.align.abi);
}

/// Copy into a temporary if the type is more aligned than the register save area.
// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:774 copy_to_temporary_if_more_aligned
function copy_to_temporary_if_more_aligned(bx: Builder, reg_addr: Value, layout: TyAndLayout, src_align: Align): Value {
  if (layout.layout.align().abi.pow2 > src_align.pow2) {
    assert(layout.ty.is_integral(), "assertion failed: layout.ty.is_integral()");

    // A memcpy below optimizes poorly for 128-bit integers.
    const tmp = bx.alloca(layout.size, layout.align.abi);
    const val = bx.load_inherent(layout.llvm_type(bx.cx_), reg_addr, src_align);
    bx.store_inherent(val, tmp, layout.align.abi);
    return tmp;
  } else {
    return reg_addr;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:793 x86_64_sysv64_va_arg_from_memory
function x86_64_sysv64_va_arg_from_memory(bx: Builder, va_list_addr: Value, layout: TyAndLayout): Value {
  const dl = bx.cx_.data_layout();
  const ptr_align_abi = dl.pointer_align().abi;

  const overflow_arg_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.const_usize(8n));

  let overflow_arg_area_v = bx.load_inherent(bx.type_ptr(), overflow_arg_area_ptr, ptr_align_abi);
  // AMD64-ABI 3.5.7p5: Step 7. Align l->overflow_arg_area upwards to a 16
  // byte boundary if alignment needed by type exceeds 8 byte boundary.
  // It isn't stated explicitly in the standard, but in practice we use
  // alignment greater than 16 where necessary.
  // The AMD64 psABI leaves unspecified what to do for alignments above 16, but
  // this behavior for 32+ alignment matches clang.
  // It currently (2026 July) can only occur for 16-byte-aligned types.
  overflow_arg_area_v = layout.layout.align().abi.bytes() > 8 ? round_pointer_up_to_alignment(bx, overflow_arg_area_v, layout.layout.align().abi) : overflow_arg_area_v;

  // AMD64-ABI 3.5.7p5: Step 8. Fetch type from l->overflow_arg_area.
  const mem_addr = overflow_arg_area_v;

  // AMD64-ABI 3.5.7p5: Step 9. Set l->overflow_arg_area to:
  // l->overflow_arg_area + sizeof(type).
  // AMD64-ABI 3.5.7p5: Step 10. Align l->overflow_arg_area upwards to
  // an 8 byte boundary.
  const size_in_bytes = layout.layout.size().bytes();
  const offset = bx.const_i32(Math.ceil(size_in_bytes / 8) * 8);
  const overflow_arg_area = bx.inbounds_ptradd(overflow_arg_area_v, offset);
  bx.store_inherent(overflow_arg_area, overflow_arg_area_ptr, ptr_align_abi);

  return mem_addr;
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:832 emit_hexagon_va_arg_musl
function emit_hexagon_va_arg_musl(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  // Implementation of va_arg for Hexagon musl target.
  // Based on LLVM's HexagonBuiltinVaList implementation.
  //
  // struct __va_list_tag {
  //   void *__current_saved_reg_area_pointer;
  //   void *__saved_reg_area_end_pointer;
  //   void *__overflow_area_pointer;
  // };
  //
  // All variadic arguments are passed on the stack, but the musl implementation
  //  uses a register save area for compatibility.
  const va_list_addr = list.immediate(String);
  const ptr_align_abi = bx.tcx_().data_layout().pointer_align().abi;
  const ptr_size = bx.tcx_().data_layout().pointer_size().bytes();

  // Check if argument fits in register save area
  const maybe_reg = bx.append_sibling_block("va_arg.maybe_reg");
  const from_overflow = bx.append_sibling_block("va_arg.from_overflow");
  const end = bx.append_sibling_block("va_arg.end");

  // Load the three pointers from va_list
  const current_ptr_addr = va_list_addr;
  const end_ptr_addr = bx.inbounds_ptradd(va_list_addr, bx.const_usize(BigInt(ptr_size)));
  const overflow_ptr_addr = bx.inbounds_ptradd(va_list_addr, bx.const_usize(BigInt(2 * ptr_size)));

  const current_ptr = bx.load_inherent(bx.type_ptr(), current_ptr_addr, ptr_align_abi);
  const end_ptr = bx.load_inherent(bx.type_ptr(), end_ptr_addr, ptr_align_abi);
  const overflow_ptr = bx.load_inherent(bx.type_ptr(), overflow_ptr_addr, ptr_align_abi);

  // Align current pointer based on argument type size (following LLVM's implementation)
  // Arguments <= 32 bits (4 bytes) use 4-byte alignment, > 32 bits use 8-byte alignment
  const type_size_bits = layout.size.bits();
  const arg_align = type_size_bits > 32 ? align_from_bytes(8) : align_from_bytes(4);
  const aligned_current = round_pointer_up_to_alignment(bx, current_ptr, arg_align);

  // Calculate next pointer position (following LLVM's logic)
  // Arguments <= 32 bits take 4 bytes, > 32 bits take 8 bytes
  const arg_size = type_size_bits > 32 ? 8 : 4;
  const next_ptr = bx.inbounds_ptradd(aligned_current, bx.const_usize(BigInt(arg_size)));

  // Check if argument fits in register save area
  const fits_in_regs = bx.icmp(IntPredicate.IntULE, next_ptr, end_ptr);
  bx.cond_br(fits_in_regs, maybe_reg, from_overflow);

  // Load from register save area
  bx.switch_to_block(maybe_reg);
  const reg_value_addr = aligned_current;
  // Update current pointer
  bx.store_inherent(next_ptr, current_ptr_addr, ptr_align_abi);
  bx.br(end);

  // Load from overflow area (stack)
  bx.switch_to_block(from_overflow);

  // Align overflow pointer using the same alignment rules
  const aligned_overflow = round_pointer_up_to_alignment(bx, overflow_ptr, arg_align);

  const overflow_value_addr = aligned_overflow;
  // Update overflow pointer - use the same size calculation
  const next_overflow = bx.inbounds_ptradd(aligned_overflow, bx.const_usize(BigInt(arg_size)));
  bx.store_inherent(next_overflow, overflow_ptr_addr, ptr_align_abi);

  // IMPORTANT: Also update the current saved register area pointer to match
  // This synchronizes the pointers when switching to overflow area
  bx.store_inherent(next_overflow, current_ptr_addr, ptr_align_abi);
  bx.br(end);

  // Return the value
  bx.switch_to_block(end);
  const value_addr = bx.phi(bx.type_ptr(), [reg_value_addr, overflow_value_addr], [maybe_reg, from_overflow]);
  return bx.load_inherent(layout.llvm_type(bx.cx_), value_addr, layout.align.abi);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:915 emit_hexagon_va_arg_bare_metal
function emit_hexagon_va_arg_bare_metal(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  // Implementation of va_arg for Hexagon bare-metal (non-musl) targets.
  // Based on LLVM's EmitVAArgForHexagon implementation.
  //
  // va_list is a simple pointer (char *)
  const va_list_addr = list.immediate(String);
  const ptr_align_abi = bx.tcx_().data_layout().pointer_align().abi;

  // Load current pointer from va_list
  const current_ptr = bx.load_inherent(bx.type_ptr(), va_list_addr, ptr_align_abi);

  // Handle address alignment for types with alignment > 4 bytes
  const ty_align = layout.align.abi;
  let aligned_ptr: Value;
  if (ty_align.bytes() > 4) {
    // Ensure alignment is a power of 2
    // debug_assert!(ty_align.bytes().is_power_of_two(), "Alignment is not power of 2!");
    aligned_ptr = round_pointer_up_to_alignment(bx, current_ptr, ty_align);
  } else {
    aligned_ptr = current_ptr;
  }

  // Calculate offset: round up type size to 4-byte boundary (minimum stack slot size)
  const type_size = layout.size.bytes();
  const offset = Math.ceil(type_size / 4) * 4; // align to 4 bytes

  // Update va_list to point to next argument
  const next_ptr = bx.inbounds_ptradd(aligned_ptr, bx.const_usize(BigInt(offset)));
  bx.store_inherent(next_ptr, va_list_addr, ptr_align_abi);

  // Load and return the argument value
  return bx.load_inherent(layout.llvm_type(bx.cx_), aligned_ptr, layout.align.abi);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:952 emit_xtensa_va_arg
function emit_xtensa_va_arg(bx: Builder, list: OperandRef<Value>, layout: TyAndLayout): Value {
  // Implementation of va_arg for Xtensa. There doesn't seem to be an authoritative source for
  // this, other than "what GCC does".
  //
  // The va_list type has three fields:
  // struct __va_list_tag {
  //   int32_t *va_stk; // Arguments passed on the stack
  //   int32_t *va_reg; // Arguments passed in registers, saved to memory by the prologue.
  //   int32_t va_ndx; // Offset into the arguments, in bytes
  // };
  //
  // The first 24 bytes (equivalent to 6 registers) come from va_reg, the rest from va_stk.
  // Thus if va_ndx is less than 24, the next va_arg *may* read from va_reg,
  // otherwise it must come from va_stk.
  //
  // Primitive arguments are never split between registers and the stack. For example, if loading an 8 byte
  // primitive value and va_ndx = 20, we instead bump the offset and read everything from va_stk.
  const va_list_addr = list.immediate(String);
  // FIXME: handle multi-field structs that split across regsave/stack?
  const from_stack = bx.append_sibling_block("va_arg.from_stack");
  const from_regsave = bx.append_sibling_block("va_arg.from_regsave");
  const end = bx.append_sibling_block("va_arg.end");
  const ptr_align_abi = bx.tcx_().data_layout().pointer_align().abi;

  // (*va).va_ndx
  const va_reg_offset = 4;
  const va_ndx_offset = va_reg_offset + 4;
  const offset_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(va_ndx_offset)));

  let offset = bx.load_inherent(bx.type_i32(), offset_ptr, bx.tcx_().data_layout().i32_align);
  offset = round_up_to_alignment(bx, offset, layout.align.abi);

  const slot_size = layout.size.align_to(align_from_bytes(4)).bytes();

  // Update the offset in va_list, by adding the slot's size.
  const offset_next = bx.add(offset, bx.const_i32(slot_size));

  // Figure out where to look for our value. We do that by checking the end of our slot (offset_next).
  // If that is within the regsave area, then load from there. Otherwise load from the stack area.
  const regsave_size = bx.const_i32(24);
  const use_regsave = bx.icmp(IntPredicate.IntULE, offset_next, regsave_size);
  bx.cond_br(use_regsave, from_regsave, from_stack);

  bx.switch_to_block(from_regsave);
  // update va_ndx
  bx.store_inherent(offset_next, offset_ptr, ptr_align_abi);

  // (*va).va_reg
  const regsave_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(BigInt(va_reg_offset)));
  const regsave_area = bx.load_inherent(bx.type_ptr(), regsave_area_ptr, ptr_align_abi);
  const regsave_value_ptr = bx.inbounds_ptradd(regsave_area, offset);
  bx.br(end);

  bx.switch_to_block(from_stack);

  // The first time we switch from regsave to stack we needs to adjust our offsets a bit.
  // va_stk is set up such that the first stack argument is always at va_stk + 32.
  // The corrected offset is written back into the va_list struct.

  // let offset_corrected = cmp::max(offset, 32);
  const stack_offset_start = bx.const_i32(32);
  const needs_correction = bx.icmp(IntPredicate.IntULE, offset, stack_offset_start);
  const offset_corrected = bx.select(needs_correction, stack_offset_start, offset);

  // let offset_next_corrected = offset_corrected + slot_size;
  // va_ndx = offset_next_corrected;
  const offset_next_corrected = bx.add(offset_corrected, bx.const_i32(slot_size));
  // update va_ndx
  bx.store_inherent(offset_next_corrected, offset_ptr, ptr_align_abi);

  // let stack_value_ptr = unsafe { (*va).va_stk.byte_add(offset_corrected) };
  const stack_area_ptr = bx.inbounds_ptradd(va_list_addr, bx.cx_.const_usize(0n));
  const stack_area = bx.load_inherent(bx.type_ptr(), stack_area_ptr, ptr_align_abi);
  const stack_value_ptr = bx.inbounds_ptradd(stack_area, offset_corrected);
  bx.br(end);

  bx.switch_to_block(end);

  // On big-endian, for values smaller than the slot size we'd have to align the read to the end
  // of the slot rather than the start. While the ISA and GCC support big-endian, all the Xtensa
  // targets supported by rustc are little-endian so don't worry about it.

  // if from_regsave {
  //     unsafe { *regsave_value_ptr }
  // } else {
  //     unsafe { *stack_value_ptr }
  // }
  assert(bx.tcx_().sess.target.endian === "Little", "assertion failed: bx.tcx().sess.target.endian == Endian::Little");
  const value_ptr = bx.phi(bx.type_ptr(), [regsave_value_ptr, stack_value_ptr], [from_regsave, from_stack]);
  return bx.load_inherent(layout.llvm_type(bx.cx_), value_ptr, layout.align.abi);
}

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:1053 emit_va_arg
export function emit_va_arg(bx: Builder, addr: OperandRef<Value>, layout: TyAndLayout): Value {
  // Some ABIs have special behavior for zero-sized types. currently `VaArgSafe` is not
  // implemented for any zero-sized types, so this assert should always hold.
  assert(!layout.is_zst(), "assertion failed: !layout.is_zst()");

  const target = bx.cx_.tcx.sess.target;
  const stability = target.supports_c_variadic_definitions();

  switch (target.arch.$) {
    case "X86": {
      // A small deviation from clang to get the right behavior for f128.
      //
      // Note that i64 and f64 have an alignment of only 4 on this architecture.
      // We need to be careful when adding future types with an alignment bigger
      // than 4 (e.g. i128), clang has a bunch of custom logic for them.
      const allow_higher_align: AllowHigherAlign = layout.ty === bx.tcx.types.f128 ? "Yes" : "No";

      return emit_ptr_va_arg(bx, addr, layout, "Direct", 4, allow_higher_align, "No");
    }
    case "Arm64EC":
      return emit_ptr_va_arg(
        bx,
        addr,
        layout,
        // MS x64 ABI requirement: "Any argument that doesn't fit in 8 bytes, or is
        // not 1, 2, 4, or 8 bytes, must be passed by reference."
        layout.size.bytes() > 8 || !is_power_of_two(layout.size.bytes()) ? "Indirect" : "Direct",
        8,
        "No",
        "No",
      );
    case "AArch64":
      if (target.is_like_windows || target.is_like_darwin) return emit_ptr_va_arg(bx, addr, layout, "Direct", 8, "Yes", "No");
      return emit_aapcs_va_arg(bx, addr, layout);
    case "Arm":
      // Types wider than 16 bytes are not currently supported. Clang has special logic for
      // such types, but `VaArgSafe` is not implemented for any type that is this large on
      // arm (i.e. 32-bit) targets.
      assert(layout.size.bytes() <= 16, "assertion failed: layout.size.bytes() <= 16");

      return emit_ptr_va_arg(bx, addr, layout, "Direct", 4, "Yes", "No");
    case "S390x":
      return emit_s390x_va_arg(bx, addr, layout);
    case "PowerPC":
      return emit_powerpc_va_arg(bx, addr, layout);
    case "PowerPC64":
      return emit_ptr_va_arg(
        bx,
        addr,
        layout,
        "Direct",
        8,
        "Yes",
        // ForceRightAdjust only takes effect on big-endian architectures.
        "Yes",
      );
    case "RiscV32":
      if (target.llvm_abiname.$ === "Ilp32e") {
        assert_unstable(stability);
        // FIXME: clang manually adjusts the alignment for this ABI. It notes:
        //
        // > To be compatible with GCC's behaviors, we force arguments with
        // > 2×XLEN-bit alignment and size at most 2×XLEN bits like `long long`,
        // > `unsigned long long` and `double` to have 4-byte alignment. This
        // > behavior may be changed when RV32E/ILP32E is ratified.
        return bug("c-variadic calls with ilp32e use a custom ABI and are not currently implemented");
      }
      return emit_ptr_va_arg(bx, addr, layout, layout.size.bytes() > 2 * 4 ? "Indirect" : "Direct", 4, "Yes", "No");
    case "LoongArch32":
      return emit_ptr_va_arg(bx, addr, layout, layout.size.bytes() > 2 * 4 ? "Indirect" : "Direct", 4, "Yes", "No");
    case "RiscV64":
    case "LoongArch64":
      return emit_ptr_va_arg(bx, addr, layout, layout.size.bytes() > 2 * 8 ? "Indirect" : "Direct", 8, "Yes", "No");
    case "AmdGpu":
      return emit_ptr_va_arg(bx, addr, layout, "Direct", 4, "No", "No");
    case "Nvptx64":
      return emit_ptr_va_arg(bx, addr, layout, "Direct", 1, "Yes", "No");
    case "Wasm32":
    case "Wasm64":
      return emit_ptr_va_arg(bx, addr, layout, layout.is_aggregate() || layout.is_zst() || layout.is_1zst() ? "Indirect" : "Direct", 4, "Yes", "No");
    case "CSky":
      return emit_ptr_va_arg(bx, addr, layout, "Direct", 4, "Yes", "No");
    case "X86_64":
      // Windows x86_64
      if (target.is_like_windows) {
        return emit_ptr_va_arg(bx, addr, layout, layout.size.bytes() > 8 || !is_power_of_two(layout.size.bytes()) ? "Indirect" : "Direct", 8, "No", "No");
      }
      // This includes `target.is_like_darwin`, which on x86_64 targets is like sysv64.
      return emit_x86_64_sysv64_va_arg(bx, addr, layout);
    case "Xtensa":
      return emit_xtensa_va_arg(bx, addr, layout);
    case "Hexagon":
      switch (target.env.$) {
        case "Musl":
          return emit_hexagon_va_arg_musl(bx, addr, layout);
        default:
          return emit_hexagon_va_arg_bare_metal(bx, addr, layout);
      }
    case "Sparc64":
      return emit_ptr_va_arg(
        bx,
        addr,
        layout,
        layout.size.bytes() > 2 * 8 ? "Indirect" : "Direct",
        8,
        "Yes",
        // sparc64 is a big-endian target and stores variable arguments right-adjusted.
        "Yes",
      );
    case "Sparc": {
      assert_unstable(stability);

      // f128 is passed indirectly.
      let pass_mode: PassMode;
      const repr = layout.layout.backend_repr();
      if (repr.$ === "Scalar") {
        const p = Scalar.primitive(repr._0);
        pass_mode = p.$ === "Float" && p._0 === "F128" ? "Indirect" : "Direct";
      } else {
        pass_mode = "Direct";
      }

      return emit_ptr_va_arg(bx, addr, layout, pass_mode, 4, "No", "Yes");
    }
    case "Mips":
    case "Mips32r6":
    case "Mips64":
    case "Mips64r6": {
      let slot: SlotSize;
      switch (target.llvm_abiname.$) {
        case "N32":
        case "N64":
          slot = 8;
          break;
        case "O32":
          slot = 4;
          break;
        default:
          return bug(`unexpected LLVM ABI ${LlvmAbi.display(target.llvm_abiname)}`);
      }
      return emit_ptr_va_arg(
        bx,
        addr,
        layout,
        "Direct",
        slot,
        "Yes",
        // In big-endian mode the actual value is stored in the right side of the slot, meaning
        // that when the value is smaller than a slot, we need to adjust the pointer we read
        // to somewhere in the middle of the slot.
        bx.tcx.sess.target.endian === "Big" ? "Yes" : "No",
      );
    }

    case "Bpf":
      return bug("bpf does not support c-variadic functions");
    case "SpirV":
      return bug("spirv does not support c-variadic functions");

    case "Avr":
    case "M68k":
    case "Msp430":
      assert_unstable(stability);

      // Clang uses the LLVM implementation for these architectures.
      return bx.va_arg_inherent(addr.immediate(String), layout.llvm_type(bx.cx_));

    case "Other":
      assert_unstable(stability);

      // Just to be safe we error out explicitly here, instead of crossing our fingers that
      // the default LLVM implementation has the correct behavior for this target.
      return bug(`c-variadic functions are not currently implemented for custom target ${target.arch._0}`);
  }
}

/** `u64::is_power_of_two`. */
function is_power_of_two(n: number): boolean {
  const b = BigInt(n);
  return b > 0n && (b & (b - 1n)) === 0n;
}
