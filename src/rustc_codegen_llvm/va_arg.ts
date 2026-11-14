// Port of compiler/rustc_codegen_llvm/src/va_arg.rs (skeleton: lane cg-contract; fill: lane cg-intrinsic-b, plan-m7 §8 wave 43).
//
// PORT (lane ir-fix-a): ported ahead of cg-intrinsic-b, because run-pass programs reach `emit_va_arg` (`VaList::arg`, the
// `va_arg` intrinsic) on x86_64-unknown-linux-gnu. What is here, in upstream order: `round_up_to_alignment`,
// `round_pointer_up_to_alignment`, `emit_direct_ptr_va_arg`, `get_param_type_alignment`, the enums, `emit_ptr_va_arg`,
// `emit_x86_64_sysv64_va_arg`, `copy_to_temporary_if_more_aligned`, `x86_64_sysv64_va_arg_from_memory` and `emit_va_arg`.
// The targets' own bodies `emit_aapcs_va_arg` (:189, aarch64 outside Windows and Darwin), `emit_powerpc_va_arg` (:293),
// `emit_s390x_va_arg` (:423), `emit_hexagon_va_arg_musl` (:832), `emit_hexagon_va_arg_bare_metal` (:915) and
// `emit_xtensa_va_arg` (:952) are not ported: each stops by its name (`va_arg_stop`), and stays cg-intrinsic-b's.
// - `bx` is a concrete `Builder`, so `bx.load(..)` / `bx.store(..)` / `bx.append_block(..)` resolve to the inherent
//   `load_inherent` / `store_inherent` (intrinsic.ts header, decision 2026-11-11); every other name has one method.
// - `std::assert_matches!(stability, CVariadicStatus::Unstable { .. })` is ported where it holds; where it fails, its panic text
//   (the `Debug` of `CVariadicStatus`) is not, and the arm stops (`va_arg_stop`).
// - `align.bytes() as i32` and the other `as i32` / `as u32` casts take values far below 2^31 here (alignments, slot sizes,
//   register counts and offsets).
import { Align, type BackendRepr, Primitive, type Primitive as PrimitiveT, Scalar, type Size, debug_AlignFromBytesError, debug_BackendRepr } from "../rustc_abi/lib.ts";
import { Integer, Float } from "../rustc_abi/lib.ts";
import { IntPredicate } from "../rustc_codegen_ssa/common.ts";
import type { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, unported, unreachable } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import type { Builder } from "./builder.ts";
import type { Value } from "./llvm/mod.ts";

/** The not-ported targets' bodies (header). */
const va_arg_stop = (what: string): never => unported("cg-intrinsic-b: compiler/rustc_codegen_llvm/src/va_arg.rs " + what);

const align_from_bytes = (n: number): Align => unwrap_result(Align.from_bytes(n), debug_AlignFromBytesError);

// rustc: compiler/rustc_codegen_llvm/src/va_arg.rs:18 round_up_to_alignment
function round_up_to_alignment(bx: Builder, value: Value, align: Align): Value {
  value = bx.add(value, bx.cx().const_i32(align.bytes() - 1));
  return bx.and(value, bx.cx().const_i32(-align.bytes()));
}
void round_up_to_alignment;

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
      return va_arg_stop("emit_aapcs_va_arg");
    case "Arm":
      // Types wider than 16 bytes are not currently supported. Clang has special logic for
      // such types, but `VaArgSafe` is not implemented for any type that is this large on
      // arm (i.e. 32-bit) targets.
      assert(layout.size.bytes() <= 16, "assertion failed: layout.size.bytes() <= 16");

      return emit_ptr_va_arg(bx, addr, layout, "Direct", 4, "Yes", "No");
    case "S390x":
      return va_arg_stop("emit_s390x_va_arg");
    case "PowerPC":
      return va_arg_stop("emit_powerpc_va_arg");
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
        // std::assert_matches!(stability, CVariadicStatus::Unstable { .. });
        if (stability.$ !== "Unstable") return va_arg_stop("emit_va_arg's assert_matches! on RiscV32 ilp32e (the panic text)");
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
      return va_arg_stop("emit_xtensa_va_arg");
    case "Hexagon":
      switch (target.env.$) {
        case "Musl":
          return va_arg_stop("emit_hexagon_va_arg_musl");
        default:
          return va_arg_stop("emit_hexagon_va_arg_bare_metal");
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
      // std::assert_matches!(stability, CVariadicStatus::Unstable { .. });
      if (stability.$ !== "Unstable") return va_arg_stop("emit_va_arg's assert_matches! on Sparc (the panic text)");

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
          return va_arg_stop("emit_va_arg's bug! for an unexpected MIPS LLVM ABI (the LlvmAbi Display text)");
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
      // std::assert_matches!(stability, CVariadicStatus::Unstable { .. });
      if (stability.$ !== "Unstable") return va_arg_stop("emit_va_arg's assert_matches! on Avr/M68k/Msp430 (the panic text)");

      // Clang uses the LLVM implementation for these architectures.
      return bx.va_arg(addr.immediate(String), layout.llvm_type(bx.cx_));

    case "Other":
      // std::assert_matches!(stability, CVariadicStatus::Unstable { .. });
      if (stability.$ !== "Unstable") return va_arg_stop("emit_va_arg's assert_matches! on a custom target (the panic text)");

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
