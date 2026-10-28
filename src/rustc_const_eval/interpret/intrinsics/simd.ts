// Port of compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs (declared by lane interp-contract, ported by lane
// interp-simd, plan-m4 wave 24). docs/handoff/interp-contract.md has the conventions (interpret/eval_context.ts's header
// repeats them); this file in addition:
// - `throw_ub_format!(..)` / `err_ub_format!(..)` / `throw_unsup_format!(..)` are the helpers at the end of the file (the
//   macros' expansions), the macro kept as a comment.
// - The vector lengths and lane indices (`u64`) are bigints, as `project_to_simd` / `project_index` take them.
// - The nested `enum Op`s of the arms are local string / object unions.
// - `::<Half>` / `::<Single>` / `::<Double>` / `::<Quad>` of intrinsics.rs's `float_round` / `float_minmax` /
//   `float_muladd` are called as declared at this lane's base (no `FloatType` argument); lane interp-intrinsics adds the
//   trailing `F_` dictionary to those signatures, and these calls then pass `Half` / `Single` / `Double` / `Quad`.
import { debug_BackendRepr, type Endian, type Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../eval_context.ts";
import { MinMax, MulAddType } from "../intrinsics.gen.ts";
import { type Machine } from "../machine.ts";
import { assert_eq_msg, display_ImmTy, Immediate } from "../operand.ts";
import {
  type CtfeProvenance,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  InterpResult,
  interp_ok,
  type Pointer,
  Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, BinOp, UnOp } from "../../../rustc_middle/mir/mod.ts";
import { ScalarInt, type SimdAlign } from "../../../rustc_middle/ty/consts/int.ts";
import { GenericArg, type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { type TyAndLayout } from "../../../rustc_middle/ty/layout.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, Panic, unreachable, unwrap } from "../../../std/panic.ts";
import { debug_InterpErrorInfo, debug_InterpErrorKind } from "../../../rustc_middle/mir/interpret/error.gen.ts";
import { Err, unwrap_result } from "../../../std/result.ts";
import { Round } from "../../../vendor/rustc_apfloat/lib.ts";
import type { Double as ApDouble, Half as ApHalf, Quad as ApQuad, Single as ApSingle } from "../../../vendor/rustc_apfloat/ieee.ts";
import { Double, Half, Quad, Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import { ImmTy, type OpTy } from "../operand.gen.ts";
import { type MPlaceTy, type PlaceTy } from "../place.gen.ts";

declare module "../eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // simd.rs:22
    eval_simd_intrinsic(intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
    // simd.rs:815
    fminmax_op(op: MinMax, left: ImmTy, right: ImmTy): InterpResult<Scalar>;
    // simd.rs:835
    check_simd_ptr_alignment(ptr: Pointer<CtfeProvenance | undefined>, vector_layout: TyAndLayout, alignment: SimdAlign): InterpResult;
  }
}

/// Returns `true` if emulation happened.
/// Here we implement the intrinsics that are common to all CTFE instances; individual machines can add their own
/// intrinsic handling.
// PORT: the parameter `dest` is `dest_` (upstream shadows it with `dest.force_mplace(self)?`); the arms' shadowing
// `let (dest, dest_len) = self.project_to_simd(&dest)?` / `let dest = self.project_index(&dest, i)?` are `dest_v` / `dest_i`.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:22 eval_simd_intrinsic
InterpCx.prototype.eval_simd_intrinsic = function (this: InterpCx, intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest_: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  const dest_r = dest_.force_mplace(this);
  if (dest_r.$ === "Err") return dest_r;
  const dest = dest_r._0;

  switch (intrinsic_name) {
    case sym.simd_insert:
    case sym.simd_insert_dyn: {
      const s = this.read_scalar(args[1]!);
      if (s.$ === "Err") return s;
      const u = Scalar.to_u32(s._0);
      if (u.$ === "Err") return u;
      const index = BigInt(u._0);
      const elem = args[2]!;
      const input_r = this.project_to_simd(args[0]!);
      if (input_r.$ === "Err") return input_r;
      const [input, input_len] = input_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;
      assert_eq_msg(input_len, dest_len, String, (a, b) => a === b, () => "Return vector length must match input length");
      // Bounds are not checked by typeck so we have to do it ourselves.
      if (index >= input_len) {
        // throw_ub_format!("`{intrinsic_name}` index {index} is out-of-bounds of vector with length {input_len}")
        return ub_format(`\`${Symbol.as_str(intrinsic_name)}\` index ${index} is out-of-bounds of vector with length ${input_len}`);
      }

      for (let i = 0n; i < dest_len; i++) {
        const place = this.project_index(dest_v, i);
        if (place.$ === "Err") return place;
        let value: OpTy;
        if (i === index) {
          value = elem;
        } else {
          const v = this.project_index(input, i);
          if (v.$ === "Err") return v;
          value = v._0;
        }
        const c = this.copy_op(value, place._0);
        if (c.$ === "Err") return c;
      }
      break;
    }
    case sym.simd_extract:
    case sym.simd_extract_dyn: {
      const s = this.read_scalar(args[1]!);
      if (s.$ === "Err") return s;
      const u = Scalar.to_u32(s._0);
      if (u.$ === "Err") return u;
      const index = BigInt(u._0);
      const input_r = this.project_to_simd(args[0]!);
      if (input_r.$ === "Err") return input_r;
      const [input, input_len] = input_r._0;
      // Bounds are not checked by typeck so we have to do it ourselves.
      if (index >= input_len) {
        // throw_ub_format!("`{intrinsic_name}` index {index} is out-of-bounds of vector with length {input_len}")
        return ub_format(`\`${Symbol.as_str(intrinsic_name)}\` index ${index} is out-of-bounds of vector with length ${input_len}`);
      }
      const src = this.project_index(input, index);
      if (src.$ === "Err") return src;
      const c = this.copy_op(src._0, dest);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.simd_splat: {
      const elem = args[0]!;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      for (let i = 0n; i < dest_len; i++) {
        const place = this.project_index(dest_v, i);
        if (place.$ === "Err") return place;
        const c = this.copy_op(elem, place._0);
        if (c.$ === "Err") return c;
      }
      break;
    }
    case sym.simd_neg:
    case sym.simd_fabs:
    case sym.simd_ceil:
    case sym.simd_floor:
    case sym.simd_round:
    case sym.simd_round_ties_even:
    case sym.simd_trunc:
    case sym.simd_ctlz:
    case sym.simd_ctpop:
    case sym.simd_cttz:
    case sym.simd_bswap:
    case sym.simd_bitreverse: {
      const op_r = this.project_to_simd(args[0]!);
      if (op_r.$ === "Err") return op_r;
      const [op_v, op_len] = op_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, op_len, String);

      // #[derive(Copy, Clone)]
      type Op =
        | { $: "MirOp"; _0: UnOp }
        | { $: "Abs" }
        | { $: "Round"; _0: Round }
        | { $: "Numeric"; _0: Symbol };
      let which: Op;
      switch (intrinsic_name) {
        case sym.simd_neg:
          which = { $: "MirOp", _0: UnOp.Neg };
          break;
        case sym.simd_fabs:
          which = { $: "Abs" };
          break;
        case sym.simd_ceil:
          which = { $: "Round", _0: Round.TowardPositive };
          break;
        case sym.simd_floor:
          which = { $: "Round", _0: Round.TowardNegative };
          break;
        case sym.simd_round:
          which = { $: "Round", _0: Round.NearestTiesToAway };
          break;
        case sym.simd_round_ties_even:
          which = { $: "Round", _0: Round.NearestTiesToEven };
          break;
        case sym.simd_trunc:
          which = { $: "Round", _0: Round.TowardZero };
          break;
        case sym.simd_ctlz:
          which = { $: "Numeric", _0: sym.ctlz };
          break;
        case sym.simd_ctpop:
          which = { $: "Numeric", _0: sym.ctpop };
          break;
        case sym.simd_cttz:
          which = { $: "Numeric", _0: sym.cttz };
          break;
        case sym.simd_bswap:
          which = { $: "Numeric", _0: sym.bswap };
          break;
        case sym.simd_bitreverse:
          which = { $: "Numeric", _0: sym.bitreverse };
          break;
        default:
          return unreachable();
      }

      for (let i = 0n; i < dest_len; i++) {
        const op_place = this.project_index(op_v, i);
        if (op_place.$ === "Err") return op_place;
        const op_ri = this.read_immediate(op_place._0);
        if (op_ri.$ === "Err") return op_ri;
        const op = op_ri._0;
        const dest_i_r = this.project_index(dest_v, i);
        if (dest_i_r.$ === "Err") return dest_i_r;
        const dest_i = dest_i_r._0;
        let val: Scalar;
        switch (which.$) {
          case "MirOp": {
            // this already does NaN adjustments
            const r = this.unary_op(which._0, op);
            if (r.$ === "Err") return r;
            val = Immediate.to_scalar(r._0.imm);
            break;
          }
          case "Abs": {
            // Works for f32 and f64.
            const kind = op.layout.ty.kind();
            if (kind.$ !== "Float") {
              return span_bug(this.cur_span(), `${Symbol.as_str(intrinsic_name)} operand is not a float`);
            }
            const float_ty = kind._0;
            const op_s = Immediate.to_scalar(op.imm);
            // "Bitwise" operation, no NaN adjustments
            switch (float_ty) {
              case "F16": {
                const f = Scalar.to_f16(op_s);
                if (f.$ === "Err") return f;
                val = Scalar.from_f16(ap(ap<ApHalf>(f._0).abs()));
                break;
              }
              case "F32": {
                const f = Scalar.to_f32(op_s);
                if (f.$ === "Err") return f;
                val = Scalar.from_f32(ap(ap<ApSingle>(f._0).abs()));
                break;
              }
              case "F64": {
                const f = Scalar.to_f64(op_s);
                if (f.$ === "Err") return f;
                val = Scalar.from_f64(ap(ap<ApDouble>(f._0).abs()));
                break;
              }
              case "F128": {
                const f = Scalar.to_f128(op_s);
                if (f.$ === "Err") return f;
                val = Scalar.from_f128(ap(ap<ApQuad>(f._0).abs()));
                break;
              }
            }
            break;
          }
          case "Round": {
            const rounding = which._0;
            const kind = op.layout.ty.kind();
            if (kind.$ !== "Float") {
              return span_bug(this.cur_span(), `${Symbol.as_str(intrinsic_name)} operand is not a float`);
            }
            const float_ty = kind._0;
            const op_s = Immediate.to_scalar(op.imm);
            let r: InterpResult<Scalar>;
            switch (float_ty) {
              case "F16":
                r = this.float_round(op_s, rounding, Half);
                break;
              case "F32":
                r = this.float_round(op_s, rounding, Single);
                break;
              case "F64":
                r = this.float_round(op_s, rounding, Double);
                break;
              case "F128":
                r = this.float_round(op_s, rounding, Quad);
                break;
            }
            if (r.$ === "Err") return r;
            val = r._0;
            break;
          }
          case "Numeric": {
            const r = this.numeric_intrinsic(which._0, Immediate.to_scalar(op.imm), op.layout, op.layout);
            if (r.$ === "Err") return r;
            val = r._0;
            break;
          }
        }
        const w = this.write_scalar(val, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_add:
    case sym.simd_sub:
    case sym.simd_mul:
    case sym.simd_div:
    case sym.simd_rem:
    case sym.simd_shl:
    case sym.simd_shr:
    case sym.simd_and:
    case sym.simd_or:
    case sym.simd_xor:
    case sym.simd_eq:
    case sym.simd_ne:
    case sym.simd_lt:
    case sym.simd_le:
    case sym.simd_gt:
    case sym.simd_ge:
    case sym.simd_maximum_number_nsz:
    case sym.simd_minimum_number_nsz:
    case sym.simd_saturating_add:
    case sym.simd_saturating_sub:
    case sym.simd_arith_offset: {
      // use mir::BinOp;

      const left_r = this.project_to_simd(args[0]!);
      if (left_r.$ === "Err") return left_r;
      const [left_v, left_len] = left_r._0;
      const right_r = this.project_to_simd(args[1]!);
      if (right_r.$ === "Err") return right_r;
      const [right_v, right_len] = right_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, left_len, String);
      assert_eq(dest_len, right_len, String);

      type Op =
        | { $: "MirOp"; _0: BinOp }
        | { $: "SaturatingOp"; _0: BinOp }
        | { $: "FMinMax"; _0: MinMax }
        | { $: "WrappingOffset" };
      let which: Op;
      switch (intrinsic_name) {
        case sym.simd_add:
          which = { $: "MirOp", _0: BinOp.Add };
          break;
        case sym.simd_sub:
          which = { $: "MirOp", _0: BinOp.Sub };
          break;
        case sym.simd_mul:
          which = { $: "MirOp", _0: BinOp.Mul };
          break;
        case sym.simd_div:
          which = { $: "MirOp", _0: BinOp.Div };
          break;
        case sym.simd_rem:
          which = { $: "MirOp", _0: BinOp.Rem };
          break;
        case sym.simd_shl:
          which = { $: "MirOp", _0: BinOp.ShlUnchecked };
          break;
        case sym.simd_shr:
          which = { $: "MirOp", _0: BinOp.ShrUnchecked };
          break;
        case sym.simd_and:
          which = { $: "MirOp", _0: BinOp.BitAnd };
          break;
        case sym.simd_or:
          which = { $: "MirOp", _0: BinOp.BitOr };
          break;
        case sym.simd_xor:
          which = { $: "MirOp", _0: BinOp.BitXor };
          break;
        case sym.simd_eq:
          which = { $: "MirOp", _0: BinOp.Eq };
          break;
        case sym.simd_ne:
          which = { $: "MirOp", _0: BinOp.Ne };
          break;
        case sym.simd_lt:
          which = { $: "MirOp", _0: BinOp.Lt };
          break;
        case sym.simd_le:
          which = { $: "MirOp", _0: BinOp.Le };
          break;
        case sym.simd_gt:
          which = { $: "MirOp", _0: BinOp.Gt };
          break;
        case sym.simd_ge:
          which = { $: "MirOp", _0: BinOp.Ge };
          break;
        case sym.simd_maximum_number_nsz:
          which = { $: "FMinMax", _0: MinMax.MaximumNumberNsz };
          break;
        case sym.simd_minimum_number_nsz:
          which = { $: "FMinMax", _0: MinMax.MinimumNumberNsz };
          break;
        case sym.simd_saturating_add:
          which = { $: "SaturatingOp", _0: BinOp.Add };
          break;
        case sym.simd_saturating_sub:
          which = { $: "SaturatingOp", _0: BinOp.Sub };
          break;
        case sym.simd_arith_offset:
          which = { $: "WrappingOffset" };
          break;
        default:
          return unreachable();
      }

      for (let i = 0n; i < dest_len; i++) {
        const lp = this.project_index(left_v, i);
        if (lp.$ === "Err") return lp;
        const left_ri = this.read_immediate(lp._0);
        if (left_ri.$ === "Err") return left_ri;
        const left = left_ri._0;
        const rp = this.project_index(right_v, i);
        if (rp.$ === "Err") return rp;
        const right_ri = this.read_immediate(rp._0);
        if (right_ri.$ === "Err") return right_ri;
        const right = right_ri._0;
        const dest_i_r = this.project_index(dest_v, i);
        if (dest_i_r.$ === "Err") return dest_i_r;
        const dest_i = dest_i_r._0;
        let val: Scalar;
        switch (which.$) {
          case "MirOp": {
            const mir_op = which._0;
            // this does NaN adjustments.
            const val_r = InterpResult.map_err_kind(this.binary_op(mir_op, left, right), (kind) => {
              if (kind.$ === "UndefinedBehavior" && kind._0.$ === "ShiftOverflow") {
                const { shift_amount } = kind._0;
                // this resets the interpreter backtrace, but it's not worth avoiding that.
                let shift_amount_s: string;
                switch (shift_amount.$) {
                  case "Left":
                    shift_amount_s = shift_amount._0.toString();
                    break;
                  case "Right":
                    shift_amount_s = shift_amount._0.toString();
                    break;
                }
                return err_ub_format(`overflowing shift by ${shift_amount_s} in \`${Symbol.as_str(intrinsic_name)}\` in lane ${i}`);
              }
              return kind;
            });
            if (val_r.$ === "Err") return val_r;
            const v = val_r._0;
            if (mir_op === "Eq" || mir_op === "Ne" || mir_op === "Lt" || mir_op === "Le" || mir_op === "Gt" || mir_op === "Ge") {
              // Special handling for boolean-returning operations
              assert_eq(v.layout.ty, this.tcx.deref().types.bool, (t) => debug_Ty(t, PLAIN));
              const b = unwrap_result(Scalar.to_bool(Immediate.to_scalar(v.imm)), debug_InterpErrorInfo);
              val = bool_to_simd_element(b, dest_i.layout.size);
            } else {
              assert_ne(v.layout.ty, this.tcx.deref().types.bool, (t) => debug_Ty(t, PLAIN));
              assert_eq(v.layout.ty, dest_i.layout.ty, (t) => debug_Ty(t, PLAIN));
              val = Immediate.to_scalar(v.imm);
            }
            break;
          }
          case "SaturatingOp": {
            const r = this.saturating_arith(which._0, left, right);
            if (r.$ === "Err") return r;
            val = r._0;
            break;
          }
          case "WrappingOffset": {
            const ptr = Scalar.to_pointer(Immediate.to_scalar(left.imm), this);
            const offset_count_r = Scalar.to_target_isize(Immediate.to_scalar(right.imm), this);
            if (offset_count_r.$ === "Err") return offset_count_r;
            const offset_count = offset_count_r._0;
            const pointee_ty = unwrap(left.layout.ty.builtin_deref(true));

            const pointee_layout = this.layout_of(pointee_ty);
            if (pointee_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(pointee_layout._0));
            // `i64::try_from(size.bytes()).unwrap()`: a layout size is below 2^61 bytes.
            const pointee_size = BigInt(pointee_layout._0.size.bytes());
            const offset_bytes = BigInt.asIntN(64, offset_count * pointee_size);
            const offset_ptr = ptr.wrapping_signed_offset(offset_bytes, this);
            val = Scalar.from_maybe_pointer(offset_ptr, this);
            break;
          }
          case "FMinMax": {
            const r = this.fminmax_op(which._0, left, right);
            if (r.$ === "Err") return r;
            val = r._0;
            break;
          }
        }
        const w = this.write_scalar(val, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_reduce_and:
    case sym.simd_reduce_or:
    case sym.simd_reduce_xor:
    case sym.simd_reduce_any:
    case sym.simd_reduce_all:
    case sym.simd_reduce_max:
    case sym.simd_reduce_min: {
      // use mir::BinOp;

      const op_r = this.project_to_simd(args[0]!);
      if (op_r.$ === "Err") return op_r;
      const [op_v, op_len] = op_r._0;

      const imm_from_bool = (b: boolean): ImmTy => {
        return ImmTy.from_scalar(Scalar.from_bool(b), unwrap_result(this.layout_of(this.tcx.deref().types.bool), debug_InterpErrorKind));
      };

      type Op = { $: "MirOp"; _0: BinOp } | { $: "MirOpBool"; _0: BinOp } | { $: "MinMax"; _0: MinMax };
      let which: Op;
      switch (intrinsic_name) {
        case sym.simd_reduce_and:
          which = { $: "MirOp", _0: BinOp.BitAnd };
          break;
        case sym.simd_reduce_or:
          which = { $: "MirOp", _0: BinOp.BitOr };
          break;
        case sym.simd_reduce_xor:
          which = { $: "MirOp", _0: BinOp.BitXor };
          break;
        case sym.simd_reduce_any:
          which = { $: "MirOpBool", _0: BinOp.BitOr };
          break;
        case sym.simd_reduce_all:
          which = { $: "MirOpBool", _0: BinOp.BitAnd };
          break;
        case sym.simd_reduce_max:
          which = { $: "MinMax", _0: MinMax.MaximumNumberNsz };
          break;
        case sym.simd_reduce_min:
          which = { $: "MinMax", _0: MinMax.MinimumNumberNsz };
          break;
        default:
          return unreachable();
      }

      // Initialize with first lane, then proceed with the rest.
      const first = this.project_index(op_v, 0n);
      if (first.$ === "Err") return first;
      const first_ri = this.read_immediate(first._0);
      if (first_ri.$ === "Err") return first_ri;
      let res = first_ri._0;
      if (which.$ === "MirOpBool") {
        // Convert to `bool` scalar.
        const b = simd_element_to_bool(res);
        if (b.$ === "Err") return b;
        res = imm_from_bool(b._0);
      }
      for (let i = 1n; i < op_len; i++) {
        const op_place = this.project_index(op_v, i);
        if (op_place.$ === "Err") return op_place;
        const op_ri = this.read_immediate(op_place._0);
        if (op_ri.$ === "Err") return op_ri;
        const op = op_ri._0;
        switch (which.$) {
          case "MirOp": {
            const r = this.binary_op(which._0, res, op);
            if (r.$ === "Err") return r;
            res = r._0;
            break;
          }
          case "MirOpBool": {
            const b = simd_element_to_bool(op);
            if (b.$ === "Err") return b;
            const op_b = imm_from_bool(b._0);
            const r = this.binary_op(which._0, res, op_b);
            if (r.$ === "Err") return r;
            res = r._0;
            break;
          }
          case "MinMax": {
            const mmop = which._0;
            if (res.layout.ty.kind().$ === "Float") {
              const r = this.fminmax_op(mmop, res, op);
              if (r.$ === "Err") return r;
              res = ImmTy.from_scalar(r._0, res.layout);
            } else {
              // Just boring integers, no NaNs to worry about.
              let mirop: BinOp;
              switch (mmop) {
                case "MinimumNumberNsz":
                case "Minimum":
                  mirop = BinOp.Le;
                  break;
                case "MaximumNumberNsz":
                case "Maximum":
                  mirop = BinOp.Ge;
                  break;
              }
              const r = this.binary_op(mirop, res, op);
              if (r.$ === "Err") return r;
              const b = Scalar.to_bool(Immediate.to_scalar(r._0.imm));
              if (b.$ === "Err") return b;
              if (b._0) {
                // res
              } else {
                res = op;
              }
            }
            break;
          }
        }
      }
      const w = this.write_immediate(res.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.simd_reduce_add_ordered:
    case sym.simd_reduce_mul_ordered: {
      // use mir::BinOp;

      const op_r = this.project_to_simd(args[0]!);
      if (op_r.$ === "Err") return op_r;
      const [op_v, op_len] = op_r._0;
      const init = this.read_immediate(args[1]!);
      if (init.$ === "Err") return init;

      let mir_op: BinOp;
      switch (intrinsic_name) {
        case sym.simd_reduce_add_ordered:
          mir_op = BinOp.Add;
          break;
        case sym.simd_reduce_mul_ordered:
          mir_op = BinOp.Mul;
          break;
        default:
          return unreachable();
      }

      let res = init._0;
      for (let i = 0n; i < op_len; i++) {
        const op_place = this.project_index(op_v, i);
        if (op_place.$ === "Err") return op_place;
        const op = this.read_immediate(op_place._0);
        if (op.$ === "Err") return op;
        const r = this.binary_op(mir_op, res, op._0);
        if (r.$ === "Err") return r;
        res = r._0;
      }
      const w = this.write_immediate(res.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.simd_select: {
      const mask_r = this.project_to_simd(args[0]!);
      if (mask_r.$ === "Err") return mask_r;
      const [mask_v, mask_len] = mask_r._0;
      const yes_r = this.project_to_simd(args[1]!);
      if (yes_r.$ === "Err") return yes_r;
      const [yes_v, yes_len] = yes_r._0;
      const no_r = this.project_to_simd(args[2]!);
      if (no_r.$ === "Err") return no_r;
      const [no_v, no_len] = no_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, mask_len, String);
      assert_eq(dest_len, yes_len, String);
      assert_eq(dest_len, no_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const mask = read_lane(this, mask_v, i);
        if (mask.$ === "Err") return mask;
        const yes = read_lane(this, yes_v, i);
        if (yes.$ === "Err") return yes;
        const no = read_lane(this, no_v, i);
        if (no.$ === "Err") return no;
        const dest_i = this.project_index(dest_v, i);
        if (dest_i.$ === "Err") return dest_i;

        const b = simd_element_to_bool(mask._0);
        if (b.$ === "Err") return b;
        const val = b._0 ? yes._0 : no._0;
        const w = this.write_immediate(val.imm, dest_i._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    // Variant of `select` that takes a bitmask rather than a "vector of bool".
    case sym.simd_select_bitmask: {
      const mask_op = args[0]!;
      const yes_r = this.project_to_simd(args[1]!);
      if (yes_r.$ === "Err") return yes_r;
      const [yes_v, yes_len] = yes_r._0;
      const no_r = this.project_to_simd(args[2]!);
      if (no_r.$ === "Err") return no_r;
      const [no_v, no_len] = no_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len_u64] = dest_simd_r._0;
      const bitmask_len = next_multiple_of(dest_len_u64, 8n);
      if (bitmask_len > 64n) {
        // throw_unsup_format!("simd_select_bitmask: vectors larger than 64 elements are currently not supported")
        return unsup_format("simd_select_bitmask: vectors larger than 64 elements are currently not supported");
      }

      assert_eq(dest_len_u64, yes_len, String);
      assert_eq(dest_len_u64, no_len, String);

      // Read the mask, either as an integer or as an array.
      let mask: bigint;
      const mask_kind = mask_op.layout.ty.kind();
      if (mask_kind.$ === "Uint") {
        // Any larger integer type is fine.
        assert(BigInt(mask_op.layout.size.bits()) >= bitmask_len, "assertion failed: mask.layout.size.bits() >= bitmask_len");
        const s = this.read_scalar(mask_op);
        if (s.$ === "Err") return s;
        const bits = Scalar.to_bits(s._0, mask_op.layout.size);
        if (bits.$ === "Err") return bits;
        mask = u64_try_from_unwrap(bits._0);
      } else if (mask_kind.$ === "Array" && mask_kind._0 === this.tcx.deref().types.u8) {
        // The array must have exactly the right size.
        assert_eq(BigInt(mask_op.layout.size.bits()), bitmask_len, String);
        // Read the raw bytes.
        const mask_place = mask_op.assert_mem_place(); // arrays cannot be immediate
        const mask_bytes_r = this.read_bytes_ptr_strip_provenance(mask_place.ptr(), mask_place.layout.size);
        if (mask_bytes_r.$ === "Err") return mask_bytes_r;
        const mask_bytes = mask_bytes_r._0;
        // Turn them into a `u64` in the right way.
        const mask_size = mask_place.layout.size.bytes_usize();
        const mask_arr = new Uint8Array(8);
        switch (this.tcx.data_layout().endian) {
          case "Little": {
            // Fill the first N bytes.
            copy_from_slice(mask_arr, 0, mask_size, mask_bytes);
            mask = u64_from_le_bytes(mask_arr);
            break;
          }
          case "Big": {
            // Fill the last N bytes.
            const i = usize_strict_sub(mask_arr.length, mask_size);
            copy_from_slice(mask_arr, i, mask_arr.length, mask_bytes);
            mask = u64_from_be_bytes(mask_arr);
            break;
          }
        }
      } else {
        return bug(`simd_select_bitmask: invalid mask type ${display_Ty(mask_op.layout.ty)}`);
      }

      const dest_len = u32_try_from_unwrap(dest_len_u64);
      for (let i = 0; i < dest_len; i++) {
        const bit_i = simd_bitmask_index(i, dest_len, this.tcx.data_layout().endian);
        const mask_i = mask & u64_strict_shl(1n, bit_i);
        const yes = read_lane(this, yes_v, BigInt(i));
        if (yes.$ === "Err") return yes;
        const no = read_lane(this, no_v, BigInt(i));
        if (no.$ === "Err") return no;
        const dest_i = this.project_index(dest_v, BigInt(i));
        if (dest_i.$ === "Err") return dest_i;

        const val = mask_i !== 0n ? yes._0 : no._0;
        const w = this.write_immediate(val.imm, dest_i._0);
        if (w.$ === "Err") return w;
      }
      // The remaining bits of the mask are ignored.
      break;
    }
    // Converts a "vector of bool" into a bitmask.
    case sym.simd_bitmask: {
      const op_r = this.project_to_simd(args[0]!);
      if (op_r.$ === "Err") return op_r;
      const [op_v, op_len_u64] = op_r._0;
      const bitmask_len = next_multiple_of(op_len_u64, 8n);
      if (bitmask_len > 64n) {
        // throw_unsup_format!("simd_bitmask: vectors larger than 64 elements are currently not supported")
        return unsup_format("simd_bitmask: vectors larger than 64 elements are currently not supported");
      }

      const op_len = u32_try_from_unwrap(op_len_u64);
      let res = 0n;
      for (let i = 0; i < op_len; i++) {
        const op = read_lane(this, op_v, BigInt(i));
        if (op.$ === "Err") return op;
        const b = simd_element_to_bool(op._0);
        if (b.$ === "Err") return b;
        if (b._0) {
          const bit_i = simd_bitmask_index(i, op_len, this.tcx.data_layout().endian);
          res |= u64_strict_shl(1n, bit_i);
        }
      }
      // Write the result, depending on the `dest` type.
      // Returns either an unsigned integer or array of `u8`.
      const dest_kind = dest.layout.ty.kind();
      if (dest_kind.$ === "Uint") {
        // Any larger integer type is fine, it will be zero-extended.
        assert(BigInt(dest.layout.size.bits()) >= bitmask_len, "assertion failed: dest.layout.size.bits() >= bitmask_len");
        const w = this.write_scalar(Scalar.from_uint(res, dest.layout.size), dest);
        if (w.$ === "Err") return w;
      } else if (dest_kind.$ === "Array" && dest_kind._0 === this.tcx.deref().types.u8) {
        // The array must have exactly the right size.
        assert_eq(BigInt(dest.layout.size.bits()), bitmask_len, String);
        // We have to write the result byte-for-byte.
        const res_size = dest.layout.size.bytes_usize();
        let res_bytes: Uint8Array;
        let res_bytes_slice: Uint8Array;
        switch (this.tcx.data_layout().endian) {
          case "Little": {
            res_bytes = u64_to_le_bytes(res);
            res_bytes_slice = slice_range(res_bytes, 0, res_size); // take the first N bytes
            break;
          }
          case "Big": {
            res_bytes = u64_to_be_bytes(res);
            res_bytes_slice = slice_range(res_bytes, usize_strict_sub(res_bytes.length, res_size), res_bytes.length); // take the last N bytes
            break;
          }
        }
        const w = this.write_bytes_ptr(dest.ptr(), res_bytes_slice.values());
        if (w.$ === "Err") return w;
      } else {
        return bug(`simd_bitmask: invalid return type ${display_Ty(dest.layout.ty)}`);
      }
      break;
    }
    case sym.simd_cast:
    case sym.simd_as:
    case sym.simd_cast_ptr:
    case sym.simd_with_exposed_provenance: {
      const op_r = this.project_to_simd(args[0]!);
      if (op_r.$ === "Err") return op_r;
      const [op_v, op_len] = op_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, op_len, String);

      const unsafe_cast = intrinsic_name === sym.simd_cast;
      const safe_cast = intrinsic_name === sym.simd_as;
      const ptr_cast = intrinsic_name === sym.simd_cast_ptr;
      const from_exposed_cast = intrinsic_name === sym.simd_with_exposed_provenance;

      for (let i = 0n; i < dest_len; i++) {
        const op_ri = read_lane(this, op_v, i);
        if (op_ri.$ === "Err") return op_ri;
        const op = op_ri._0;
        const dest_i_r = this.project_index(dest_v, i);
        if (dest_i_r.$ === "Err") return dest_i_r;
        const dest_i = dest_i_r._0;

        const from = op.layout.ty.kind().$;
        const to = dest_i.layout.ty.kind().$;
        const from_int = from === "Int" || from === "Uint";
        const to_int = to === "Int" || to === "Uint";
        let val_r: InterpResult<ImmTy>;
        if (from_int && (to_int || to === "Float") && (safe_cast || unsafe_cast)) {
          // Int-to-(int|float): always safe
          val_r = this.int_to_int_or_float(op, dest_i.layout);
        } else if (from === "Float" && to === "Float" && (safe_cast || unsafe_cast)) {
          // Float-to-float: always safe
          val_r = this.float_to_float_or_int(op, dest_i.layout);
        } else if (from === "Float" && to_int && safe_cast) {
          // Float-to-int in safe mode
          val_r = this.float_to_float_or_int(op, dest_i.layout);
        } else if (from === "Float" && to_int && unsafe_cast) {
          // Float-to-int in unchecked mode
          const r = this.float_to_int_checked(op, dest_i.layout, Round.TowardZero);
          if (r.$ === "Err") return r;
          if (r._0 === undefined) {
            return Err(
              InterpErrorInfo_from_InterpErrorKind(
                err_ub_format(
                  `\`simd_cast\` intrinsic called on ${display_ImmTy(op, PLAIN)} which cannot be represented in target type \`${debug_Ty(dest_i.layout.ty, PLAIN)}\``,
                ),
              ),
            );
          }
          val_r = interp_ok(r._0);
        } else if (from === "RawPtr" && to === "RawPtr" && ptr_cast) {
          // Ptr-to-ptr cast
          val_r = this.ptr_to_ptr(op, dest_i.layout);
        } else if (from_int && to === "RawPtr" && from_exposed_cast) {
          // Int->Ptr casts
          val_r = this.pointer_with_exposed_provenance_cast(op, dest_i.layout);
        } else {
          // Error otherwise
          // throw_unsup_format!("Unsupported SIMD cast from element type {from_ty} to {to_ty}", ..)
          return unsup_format(`Unsupported SIMD cast from element type ${display_Ty(op.layout.ty)} to ${display_Ty(dest_i.layout.ty)}`);
        }
        if (val_r.$ === "Err") return val_r;
        const w = this.write_immediate(val_r._0.imm, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_shuffle_const_generic: {
      const left_r = this.project_to_simd(args[0]!);
      if (left_r.$ === "Err") return left_r;
      const [left_v, left_len] = left_r._0;
      const right_r = this.project_to_simd(args[1]!);
      if (right_r.$ === "Err") return right_r;
      const [right_v, right_len] = right_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      const index = GenericArg.expect_const(generic_args[2]!).to_branch();
      const index_len = index.length;

      assert_eq(left_len, right_len, String);
      assert_eq(BigInt(index_len), dest_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const src_index = BigInt(index[Number(i)]!.to_leaf().to_u32());
        const dest_i = this.project_index(dest_v, i);
        if (dest_i.$ === "Err") return dest_i;

        let val: ImmTy;
        if (src_index < left_len) {
          const v = read_lane(this, left_v, src_index);
          if (v.$ === "Err") return v;
          val = v._0;
        } else if (src_index < u64_strict_add(left_len, right_len)) {
          const right_idx = u64_strict_sub(src_index, left_len);
          const v = read_lane(this, right_v, right_idx);
          if (v.$ === "Err") return v;
          val = v._0;
        } else {
          // throw_ub_format!("`simd_shuffle_const_generic` index {src_index} is out-of-bounds for 2 vectors with length {dest_len}")
          return ub_format(`\`simd_shuffle_const_generic\` index ${src_index} is out-of-bounds for 2 vectors with length ${dest_len}`);
        }
        const w = this.write_immediate(val.imm, dest_i._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_shuffle: {
      const left_r = this.project_to_simd(args[0]!);
      if (left_r.$ === "Err") return left_r;
      const [left_v, left_len] = left_r._0;
      const right_r = this.project_to_simd(args[1]!);
      if (right_r.$ === "Err") return right_r;
      const [right_v, right_len] = right_r._0;
      const index_r = this.project_to_simd(args[2]!);
      if (index_r.$ === "Err") return index_r;
      const [index_v, index_len] = index_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(left_len, right_len, String);
      assert_eq(index_len, dest_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const idx = read_lane(this, index_v, i);
        if (idx.$ === "Err") return idx;
        const idx_u32 = Scalar.to_u32(Immediate.to_scalar(idx._0.imm));
        if (idx_u32.$ === "Err") return idx_u32;
        const src_index = BigInt(idx_u32._0);
        const dest_i = this.project_index(dest_v, i);
        if (dest_i.$ === "Err") return dest_i;

        let val: ImmTy;
        if (src_index < left_len) {
          const v = read_lane(this, left_v, src_index);
          if (v.$ === "Err") return v;
          val = v._0;
        } else if (src_index < u64_strict_add(left_len, right_len)) {
          const right_idx = u64_strict_sub(src_index, left_len);
          const v = read_lane(this, right_v, right_idx);
          if (v.$ === "Err") return v;
          val = v._0;
        } else {
          // throw_ub_format!("`simd_shuffle` index {src_index} is out-of-bounds for 2 vectors with length {dest_len}")
          return ub_format(`\`simd_shuffle\` index ${src_index} is out-of-bounds for 2 vectors with length ${dest_len}`);
        }
        const w = this.write_immediate(val.imm, dest_i._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_gather: {
      const passthru_r = this.project_to_simd(args[0]!);
      if (passthru_r.$ === "Err") return passthru_r;
      const [passthru_v, passthru_len] = passthru_r._0;
      const ptrs_r = this.project_to_simd(args[1]!);
      if (ptrs_r.$ === "Err") return ptrs_r;
      const [ptrs_v, ptrs_len] = ptrs_r._0;
      const mask_r = this.project_to_simd(args[2]!);
      if (mask_r.$ === "Err") return mask_r;
      const [mask_v, mask_len] = mask_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, passthru_len, String);
      assert_eq(dest_len, ptrs_len, String);
      assert_eq(dest_len, mask_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const passthru = read_lane(this, passthru_v, i);
        if (passthru.$ === "Err") return passthru;
        const ptr = read_lane(this, ptrs_v, i);
        if (ptr.$ === "Err") return ptr;
        const mask = read_lane(this, mask_v, i);
        if (mask.$ === "Err") return mask;
        const dest_i = this.project_index(dest_v, i);
        if (dest_i.$ === "Err") return dest_i;

        const b = simd_element_to_bool(mask._0);
        if (b.$ === "Err") return b;
        let val: ImmTy;
        if (b._0) {
          const place = this.deref_pointer(ptr._0);
          if (place.$ === "Err") return place;
          const v = this.read_immediate(place._0);
          if (v.$ === "Err") return v;
          val = v._0;
        } else {
          val = passthru._0;
        }
        const w = this.write_immediate(val.imm, dest_i._0);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_scatter: {
      const value_r = this.project_to_simd(args[0]!);
      if (value_r.$ === "Err") return value_r;
      const [value_v, value_len] = value_r._0;
      const ptrs_r = this.project_to_simd(args[1]!);
      if (ptrs_r.$ === "Err") return ptrs_r;
      const [ptrs_v, ptrs_len] = ptrs_r._0;
      const mask_r = this.project_to_simd(args[2]!);
      if (mask_r.$ === "Err") return mask_r;
      const [mask_v, mask_len] = mask_r._0;

      assert_eq(ptrs_len, value_len, String);
      assert_eq(ptrs_len, mask_len, String);

      for (let i = 0n; i < ptrs_len; i++) {
        const value = read_lane(this, value_v, i);
        if (value.$ === "Err") return value;
        const ptr = read_lane(this, ptrs_v, i);
        if (ptr.$ === "Err") return ptr;
        const mask = read_lane(this, mask_v, i);
        if (mask.$ === "Err") return mask;

        const b = simd_element_to_bool(mask._0);
        if (b.$ === "Err") return b;
        if (b._0) {
          const place = this.deref_pointer(ptr._0);
          if (place.$ === "Err") return place;
          const w = this.write_immediate(value._0.imm, place._0);
          if (w.$ === "Err") return w;
        }
      }
      break;
    }
    case sym.simd_masked_load: {
      const dest_layout = dest.layout;

      const mask_r = this.project_to_simd(args[0]!);
      if (mask_r.$ === "Err") return mask_r;
      const [mask_v, mask_len] = mask_r._0;
      const ptr_r = this.read_pointer(args[1]!);
      if (ptr_r.$ === "Err") return ptr_r;
      const ptr = ptr_r._0;
      const default_r = this.project_to_simd(args[2]!);
      if (default_r.$ === "Err") return default_r;
      const [default_v, default_len] = default_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, mask_len, String);
      assert_eq(dest_len, default_len, String);

      const a = this.check_simd_ptr_alignment(ptr, dest_layout, GenericArg.expect_const(generic_args[3]!).to_branch()[0]!.to_leaf().to_simd_alignment());
      if (a.$ === "Err") return a;

      for (let i = 0n; i < dest_len; i++) {
        const mask = read_lane(this, mask_v, i);
        if (mask.$ === "Err") return mask;
        const default_ = read_lane(this, default_v, i);
        if (default_.$ === "Err") return default_;
        const dest_i_r = this.project_index(dest_v, i);
        if (dest_i_r.$ === "Err") return dest_i_r;
        const dest_i = dest_i_r._0;

        const b = simd_element_to_bool(mask._0);
        if (b.$ === "Err") return b;
        let val: ImmTy;
        if (b._0) {
          // Size * u64 is implemented as always checked
          const ptr_i = ptr.wrapping_offset(dest_i.layout.size.mul(i), this);
          // we have already checked the alignment requirements
          const place = this.ptr_to_mplace_unaligned(ptr_i, dest_i.layout);
          const v = this.read_immediate(place);
          if (v.$ === "Err") return v;
          val = v._0;
        } else {
          val = default_._0;
        }
        const w = this.write_immediate(val.imm, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_masked_store: {
      const mask_r = this.project_to_simd(args[0]!);
      if (mask_r.$ === "Err") return mask_r;
      const [mask_v, mask_len] = mask_r._0;
      const ptr_r = this.read_pointer(args[1]!);
      if (ptr_r.$ === "Err") return ptr_r;
      const ptr = ptr_r._0;
      const vals_r = this.project_to_simd(args[2]!);
      if (vals_r.$ === "Err") return vals_r;
      const [vals_v, vals_len] = vals_r._0;

      assert_eq(mask_len, vals_len, String);

      const a = this.check_simd_ptr_alignment(ptr, args[2]!.layout, GenericArg.expect_const(generic_args[3]!).to_branch()[0]!.to_leaf().to_simd_alignment());
      if (a.$ === "Err") return a;

      for (let i = 0n; i < vals_len; i++) {
        const mask = read_lane(this, mask_v, i);
        if (mask.$ === "Err") return mask;
        const val_r = read_lane(this, vals_v, i);
        if (val_r.$ === "Err") return val_r;
        const val = val_r._0;

        const b = simd_element_to_bool(mask._0);
        if (b.$ === "Err") return b;
        if (b._0) {
          // Size * u64 is implemented as always checked
          const ptr_i = ptr.wrapping_offset(val.layout.size.mul(i), this);
          // we have already checked the alignment requirements
          const place = this.ptr_to_mplace_unaligned(ptr_i, val.layout);
          const w = this.write_immediate(val.imm, place);
          if (w.$ === "Err") return w;
        }
      }
      break;
    }
    case sym.simd_fma:
    case sym.simd_relaxed_fma: {
      // `simd_fma` should always deterministically use `mul_add`, whereas `relaxed_fma`
      // is non-deterministic, and can use either `mul_add` or `a * b + c`
      let typ: MulAddType;
      switch (intrinsic_name) {
        case sym.simd_fma:
          typ = MulAddType.Fused;
          break;
        case sym.simd_relaxed_fma:
          typ = MulAddType.Nondeterministic;
          break;
        default:
          return unreachable();
      }

      const a_r = this.project_to_simd(args[0]!);
      if (a_r.$ === "Err") return a_r;
      const [a_v, a_len] = a_r._0;
      const b_r = this.project_to_simd(args[1]!);
      if (b_r.$ === "Err") return b_r;
      const [b_v, b_len] = b_r._0;
      const c_r = this.project_to_simd(args[2]!);
      if (c_r.$ === "Err") return c_r;
      const [c_v, c_len] = c_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v, dest_len] = dest_simd_r._0;

      assert_eq(dest_len, a_len, String);
      assert_eq(dest_len, b_len, String);
      assert_eq(dest_len, c_len, String);

      for (let i = 0n; i < dest_len; i++) {
        const a = read_lane_scalar(this, a_v, i);
        if (a.$ === "Err") return a;
        const b = read_lane_scalar(this, b_v, i);
        if (b.$ === "Err") return b;
        const c = read_lane_scalar(this, c_v, i);
        if (c.$ === "Err") return c;
        const dest_i_r = this.project_index(dest_v, i);
        if (dest_i_r.$ === "Err") return dest_i_r;
        const dest_i = dest_i_r._0;

        const kind = dest_i.layout.ty.kind();
        if (kind.$ !== "Float") {
          return span_bug(this.cur_span(), `${Symbol.as_str(intrinsic_name)} operand is not a float`);
        }
        const float_ty = kind._0;

        let val: InterpResult<Scalar>;
        switch (float_ty) {
          case "F16":
            val = this.float_muladd(a._0, b._0, c._0, typ, Half);
            break;
          case "F32":
            val = this.float_muladd(a._0, b._0, c._0, typ, Single);
            break;
          case "F64":
            val = this.float_muladd(a._0, b._0, c._0, typ, Double);
            break;
          case "F128":
            val = this.float_muladd(a._0, b._0, c._0, typ, Quad);
            break;
        }
        if (val.$ === "Err") return val;
        const w = this.write_scalar(val._0, dest_i);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case sym.simd_funnel_shl:
    case sym.simd_funnel_shr: {
      const left_r = this.project_to_simd(args[0]!);
      if (left_r.$ === "Err") return left_r;
      const [left_v] = left_r._0;
      const right_r = this.project_to_simd(args[1]!);
      if (right_r.$ === "Err") return right_r;
      const [right_v] = right_r._0;
      const shift_r = this.project_to_simd(args[2]!);
      if (shift_r.$ === "Err") return shift_r;
      const [shift_v] = shift_r._0;
      const dest_simd_r = this.project_to_simd(dest);
      if (dest_simd_r.$ === "Err") return dest_simd_r;
      const [dest_v] = dest_simd_r._0;

      const [len, elem_ty] = args[0]!.layout.ty.simd_size_and_type(this.tcx.deref());
      const [elem_size, _signed] = elem_ty.int_size_and_signed(this.tcx.deref());
      const elem_size_bits = BigInt(elem_size.bits());

      const is_left = intrinsic_name === sym.simd_funnel_shl;

      for (let i = 0n; i < BigInt(len); i++) {
        const left_s = read_lane_scalar(this, left_v, i);
        if (left_s.$ === "Err") return left_s;
        const left = Scalar.to_bits(left_s._0, elem_size);
        if (left.$ === "Err") return left;
        const right_s = read_lane_scalar(this, right_v, i);
        if (right_s.$ === "Err") return right_s;
        const right = Scalar.to_bits(right_s._0, elem_size);
        if (right.$ === "Err") return right;
        const shift_s = read_lane_scalar(this, shift_v, i);
        if (shift_s.$ === "Err") return shift_s;
        const shift_bits_r = Scalar.to_bits(shift_s._0, elem_size);
        if (shift_bits_r.$ === "Err") return shift_bits_r;
        const shift_bits = shift_bits_r._0;

        if (shift_bits >= elem_size_bits) {
          // throw_ub_format!("overflowing shift by {shift_bits} in `{intrinsic_name}` in lane {i}")
          return ub_format(`overflowing shift by ${shift_bits} in \`${Symbol.as_str(intrinsic_name)}\` in lane ${i}`);
        }
        const inv_shift_bits = elem_size_bits - shift_bits;

        // A funnel shift left by S can be implemented as `(x << S) | y.unbounded_shr(SIZE - S)`.
        // The `unbounded_shr` is needed because otherwise if `S = 0`, it would be `x | y`
        // when it should be `x`.
        //
        // This selects the least-significant `SIZE - S` bits of `x`, followed by the `S` most
        // significant bits of `y`. As `left` and `right` both occupy the lower `SIZE` bits,
        // we can treat the lower `SIZE` bits as an integer of the right width and use
        // the same implementation, but on a zero-extended `x` and `y`. This works because
        // `x << S` just pushes the `SIZE-S` MSBs out, and `y >> (SIZE - S)` shifts in
        // zeros, as it is zero-extended. To the lower `SIZE` bits, this looks just like a
        // funnel shift left.
        //
        // Note that the `unbounded_sh{l,r}`s are needed only in case we are using this on
        // `u128xN` and `inv_shift_bits == 128`.
        let result_bits: bigint;
        if (is_left) {
          result_bits = u128_wrap(left._0 << shift_bits) | u128_unbounded_shr(right._0, inv_shift_bits);
        } else {
          result_bits = u128_unbounded_shl(left._0, inv_shift_bits) | (right._0 >> shift_bits);
        }
        const [result, _overflow] = ScalarInt.truncate_from_uint(result_bits, elem_size);

        const dest_i = this.project_index(dest_v, i);
        if (dest_i.$ === "Err") return dest_i;
        const w = this.write_scalar({ $: "Int", _0: result }, dest_i._0);
        if (w.$ === "Err") return w;
      }
      break;
    }

    // Unsupported intrinsic: skip the return_to_block below.
    default:
      return interp_ok(false);
  }

  // trace!("{:?}", self.dump_place(&dest.clone().into()));
  const r = this.return_to_block(ret);
  if (r.$ === "Err") return r;
  return interp_ok(true);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:815 fminmax_op
InterpCx.prototype.fminmax_op = function (this: InterpCx, op: MinMax, left_: ImmTy, right_: ImmTy): InterpResult<Scalar> {
  assert_eq(left_.layout.ty, right_.layout.ty, (t) => debug_Ty(t, PLAIN));
  const kind = left_.layout.ty.kind();
  if (kind.$ !== "Float") {
    return bug("fmax operand is not a float");
  }
  const float_ty = kind._0;
  const left = Immediate.to_scalar(left_.imm);
  const right = Immediate.to_scalar(right_.imm);
  let r: InterpResult<Scalar>;
  switch (float_ty) {
    case "F16":
      r = this.float_minmax(left, right, op, Half);
      break;
    case "F32":
      r = this.float_minmax(left, right, op, Single);
      break;
    case "F64":
      r = this.float_minmax(left, right, op, Double);
      break;
    case "F128":
      r = this.float_minmax(left, right, op, Quad);
      break;
  }
  if (r.$ === "Err") return r;
  return interp_ok(r._0);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:835 check_simd_ptr_alignment
InterpCx.prototype.check_simd_ptr_alignment = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, vector_layout: TyAndLayout, alignment: SimdAlign): InterpResult {
  // Packed SIMD types with non-power-of-two element counts use BackendRepr::Memory
  // instead of BackendRepr::SimdVector. We need to handle both cases.
  // FIXME: remove the BackendRepr::Memory case when SIMD vectors are always passed as BackendRepr::SimdVector.
  assert(vector_layout.ty.is_simd(), "check_simd_ptr_alignment called on non-SIMD type");
  switch (vector_layout.backend_repr.$) {
    case "SimdVector":
    case "Memory":
      break;
    default:
      return span_bug(this.cur_span(), `SIMD type has unexpected backend_repr: ${debug_BackendRepr(vector_layout.backend_repr, PLAIN)}`);
  }

  let align;
  switch (alignment) {
    case "Unaligned": {
      // The pointer is supposed to be unaligned, so no check is required.
      return interp_ok(undefined);
    }
    case "Element": {
      // Take the alignment of the only field, which is an array and therefore has the same
      // alignment as the element type.
      align = vector_layout.field(this, 0).align.abi;
      break;
    }
    case "Vector":
      align = vector_layout.align.abi;
      break;
  }

  return this.check_ptr_align(ptr, align);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:873 simd_bitmask_index
function simd_bitmask_index(idx: number, vec_len: number, endianness: Endian): number {
  assert(idx < vec_len, "assertion failed: idx < vec_len");
  switch (endianness) {
    case "Little":
      return idx;
    // #[expect(clippy::arithmetic_side_effects)] // idx < vec_len
    case "Big":
      return vec_len - 1 - idx; // reverse order of bits
  }
}

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:882 bool_to_simd_element
function bool_to_simd_element(b: boolean, size: Size): Scalar {
  // SIMD uses all-1 as pattern for "true". In two's complement,
  // -1 has all its bits set to one and `from_int` will truncate or
  // sign-extend it to `size` as required.
  const val = b ? -1n : 0n;
  return Scalar.from_int(val, size);
}

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/simd.rs:890 simd_element_to_bool
function simd_element_to_bool(elem: ImmTy): InterpResult<boolean> {
  const k = elem.layout.ty.kind().$;
  assert(k === "Int" || k === "Uint", () => `SIMD mask element type must be an integer, but this is \`${display_Ty(elem.layout.ty)}\``);
  const val = Scalar.to_int(Immediate.to_scalar(elem.imm), elem.layout.size);
  if (val.$ === "Err") return val;
  switch (val._0) {
    case 0n:
      return interp_ok(false);
    case -1n:
      return interp_ok(true);
    default:
      // throw_ub_format!("each element of a SIMD mask must be all-0-bits or all-1-bits")
      return ub_format("each element of a SIMD mask must be all-0-bits or all-1-bits");
  }
}

// ---- helpers ----

/** PORT: `self.read_immediate(&self.project_index(&v, i)?)` (the arms' repeated lane read). */
function read_lane<P extends OpTy | MPlaceTy>(ecx: InterpCx, v: P, i: bigint): InterpResult<ImmTy> {
  const p = ecx.project_index(v as OpTy, i);
  if (p.$ === "Err") return p;
  return ecx.read_immediate(p._0);
}

/** PORT: `self.read_scalar(&self.project_index(&v, i)?)`. */
function read_lane_scalar(ecx: InterpCx, v: OpTy, i: bigint): InterpResult<Scalar> {
  const p = ecx.project_index(v, i);
  if (p.$ === "Err") return p;
  return ecx.read_scalar(p._0);
}

/** PORT: rustc_middle's mir/interpret/value.ts types `Scalar::to_f16..` / `from_f16..` with placeholders at this base
 * (`Pending<"rustc_apfloat::ieee::..">`); the values are the vendored rustc_apfloat floats (D9). */
function ap<T>(f: unknown): T {
  return f as T;
}

/** `assert_ne!(left, right)` (core's `AssertKind::Ne` text). */
function assert_ne<T>(left: T, right: T, debug: (v: T) => string): void {
  if (left === right) {
    throw new Panic(`assertion \`left != right\` failed\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/** `err_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function err_ub_format(msg: string): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } };
}
/** `throw_ub_format!(..)` */
function ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(msg)));
}
/** `throw_unsup_format!(..)` (`throw_unsup!(Unsupported(format!(..)))`) */
function unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MASK = (1n << 128n) - 1n;

/** `u64::next_multiple_of` (panics on overflow, as with overflow checks... rustc ships without them: wraps never happen
 * for a vector length). */
function next_multiple_of(v: bigint, rhs: bigint): bigint {
  const r = v % rhs;
  return r === 0n ? v : v + (rhs - r);
}
/** `u32::try_from(u64).unwrap()` */
function u32_try_from_unwrap(v: bigint): number {
  if (v > 0xffff_ffffn) panic_try_from();
  return Number(v);
}
/** `u64::try_from(u128).unwrap()` */
function u64_try_from_unwrap(v: bigint): bigint {
  if (v > U64_MAX) panic_try_from();
  return v;
}
function panic_try_from(): never {
  throw new Panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
}
/** `u64::strict_shl` */
function u64_strict_shl(v: bigint, n: number): bigint {
  if (n >= 64) throw new Panic("attempt to shift left with overflow");
  return (v << BigInt(n)) & U64_MAX;
}
/** `u64::strict_add` */
function u64_strict_add(a: bigint, b: bigint): bigint {
  const r = a + b;
  if (r > U64_MAX) throw new Panic("attempt to add with overflow");
  return r;
}
/** `u64::strict_sub` */
function u64_strict_sub(a: bigint, b: bigint): bigint {
  if (b > a) throw new Panic("attempt to subtract with overflow");
  return a - b;
}
/** `usize::strict_sub` */
function usize_strict_sub(a: number, b: number): number {
  if (b > a) throw new Panic("attempt to subtract with overflow");
  return a - b;
}
/** `u128 << n` with `n < 128` (wrapping to 128 bits). */
function u128_wrap(v: bigint): bigint {
  return v & U128_MASK;
}
/** `u128::unbounded_shr` */
function u128_unbounded_shr(v: bigint, n: bigint): bigint {
  return n >= 128n ? 0n : v >> n;
}
/** `u128::unbounded_shl` */
function u128_unbounded_shl(v: bigint, n: bigint): bigint {
  return n >= 128n ? 0n : (v << n) & U128_MASK;
}
/** `dst[start..end].copy_from_slice(src)` */
function copy_from_slice(dst: Uint8Array, start: number, end: number, src: Uint8Array): void {
  if (end - start !== src.length) {
    throw new Panic(`source slice length (${src.length}) does not match destination slice length (${end - start})`);
  }
  dst.set(src, start);
}
/** `&s[start..end]` */
function slice_range(s: Uint8Array, start: number, end: number): Uint8Array {
  if (end > s.length) throw new Panic(`range end index ${end} out of range for slice of length ${s.length}`);
  return s.subarray(start, end);
}
/** `u64::from_le_bytes` */
function u64_from_le_bytes(b: Uint8Array): bigint {
  let r = 0n;
  for (let i = 7; i >= 0; i--) r = (r << 8n) | BigInt(b[i]!);
  return r;
}
/** `u64::from_be_bytes` */
function u64_from_be_bytes(b: Uint8Array): bigint {
  let r = 0n;
  for (let i = 0; i < 8; i++) r = (r << 8n) | BigInt(b[i]!);
  return r;
}
/** `u64::to_le_bytes` */
function u64_to_le_bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}
/** `u64::to_be_bytes` */
function u64_to_be_bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[7 - i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}
