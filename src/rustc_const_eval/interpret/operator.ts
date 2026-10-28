// Port of compiler/rustc_const_eval/src/interpret/operator.rs (declared by lane interp-contract, filled by lane interp-ops).
// PORT: `i128` / `u128` arithmetic is bigint arithmetic, wrapped to 128 bits where Rust's `overflowing_*` / `checked_sh*`
// wrap (`BigInt.asIntN` / `asUintN(128, ..)`); floats go through rustc_apfloat (plan-m4 D9).
import { BackendRepr, Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { AtomicRmwOp } from "./operator.gen.ts";
import {
  type CtfeProvenance,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  interp_ok,
  PointerArithmetic_provided,
  Scalar,
  Scalar_from_Double,
  Scalar_from_Half,
  Scalar_from_Quad,
  Scalar_from_ScalarInt,
  Scalar_from_Single,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { BinOp, UnOp, debug_BinOp, debug_UnOp } from "../../rustc_middle/mir/mod.ts";
import { debug_ScalarInt, ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { type Float, type FloatType } from "../../vendor/rustc_apfloat/lib.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import type { Double as ApDouble, Half as ApHalf, Quad as ApQuad, Single as ApSingle } from "../../vendor/rustc_apfloat/ieee.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { ImmTy } from "./operand.gen.ts";
import { debug_ImmTy, Immediate } from "./operand.ts";
import { MemPlaceMeta } from "./place.ts";

export * from "./operator.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // operator.rs:27 (lane interp-ops)
    three_way_compare<T>(lhs: T, rhs: T): ImmTy;
    // operator.rs:32 (lane interp-ops)
    binary_char_op(bin_op: BinOp, l: number, r: number): ImmTy;
    // operator.rs:51 (lane interp-ops)
    binary_bool_op(bin_op: BinOp, l: boolean, r: boolean): ImmTy;
    // operator.rs:69 (lane interp-ops)
    binary_float_op<F extends Float<F>>(bin_op: BinOp, layout: TyAndLayout, l: F, r: F): ImmTy;
    // operator.rs:97 (lane interp-ops)
    binary_int_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:304 (lane interp-ops)
    compute_size_in_bytes(elem_size: Size, count: bigint): Size | undefined;
    // operator.rs:316 (lane interp-ops)
    binary_ptr_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:367 (lane interp-ops)
    binary_op(bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:445 (lane interp-ops)
    unary_op(un_op: UnOp, val: ImmTy): InterpResult<ImmTy>;
    // operator.rs:521 (lane interp-ops)
    atomic_rmw_op(op: AtomicRmwOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
  }
}

/** `throw_ub!(..)` of this file. */
function ub<T>(info: Extract<InterpErrorKind, { $: "UndefinedBehavior" }>["_0"]): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: info }));
}

const I128_MIN = -(1n << 127n);
const U64_MAX = (1n << 64n) - 1n;

/** `i128::overflowing_*` / `u128::overflowing_*` (core::num): the wrapped result and whether it wrapped. */
function wrap_i128(v: bigint): [bigint, boolean] {
  const w = BigInt.asIntN(128, v);
  return [w, w !== v];
}
function wrap_u128(v: bigint): [bigint, boolean] {
  const w = BigInt.asUintN(128, v);
  return [w, w !== v];
}
function i128_overflowing_div(a: bigint, b: bigint): [bigint, boolean] {
  // `self == MIN && rhs == -1` wraps to `MIN`; bigint `/` truncates toward zero, as Rust.
  if (a === I128_MIN && b === -1n) return [a, true];
  return [a / b, false];
}
function i128_overflowing_rem(a: bigint, b: bigint): [bigint, boolean] {
  // `self == MIN && rhs == -1` gives `(0, true)`; bigint `%` takes the dividend's sign, as Rust.
  if (b === -1n) return [0n, a === I128_MIN];
  return [a % b, false];
}

/** PORT: rustc_middle's mir/interpret/value.ts still types `Scalar::to_f16..to_f128` / `from_f16..` with placeholders
 * (`Pending<"rustc_apfloat::ieee::..">`); the values are the vendored rustc_apfloat floats (D9). */
function ap<T>(f: unknown): T {
  return f as T;
}

/** `<F as Into<Scalar>>::into` for the four IEEE types (`F` is dispatched on its `FloatType`). */
function F_into_Scalar<F extends Float<F>>(f: F): Scalar {
  const F_ = f.Self() as unknown;
  if (F_ === Half) return Scalar_from_Half(f as never);
  if (F_ === Single) return Scalar_from_Single(f as never);
  if (F_ === Double) return Scalar_from_Double(f as never);
  if (F_ === Quad) return Scalar_from_Quad(f as never);
  return bug("`Into<Scalar>` on a float type other than Half / Single / Double / Quad");
}

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:27 three_way_compare
InterpCx.prototype.three_way_compare = function <T>(this: InterpCx, lhs: T, rhs: T): ImmTy {
  // `Ord::cmp(&lhs, &rhs)` (`T` is `char` / `i128` / `u128`: numbers or bigints)
  const res = lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  return ImmTy.from_ordering(res, this.tcx.deref());
};

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:32 binary_char_op
InterpCx.prototype.binary_char_op = function (this: InterpCx, bin_op: BinOp, l: number, r: number): ImmTy {
  // use rustc_middle::mir::BinOp::*;

  if (bin_op === BinOp.Cmp) {
    return this.three_way_compare(l, r);
  }

  let res: boolean;
  switch (bin_op) {
    case "Eq":
      res = l === r;
      break;
    case "Ne":
      res = l !== r;
      break;
    case "Lt":
      res = l < r;
      break;
    case "Le":
      res = l <= r;
      break;
    case "Gt":
      res = l > r;
      break;
    case "Ge":
      res = l >= r;
      break;
    default:
      return span_bug(this.cur_span(), `Invalid operation on char: ${debug_BinOp(bin_op, PLAIN)}`);
  }
  return ImmTy.from_bool(res, this.tcx.deref());
};

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:51 binary_bool_op
InterpCx.prototype.binary_bool_op = function (this: InterpCx, bin_op: BinOp, l: boolean, r: boolean): ImmTy {
  // use rustc_middle::mir::BinOp::*;

  // PORT: `bool`'s `Ord` is `false < true` (compared as 0 / 1).
  const ln = l ? 1 : 0;
  const rn = r ? 1 : 0;
  let res: boolean;
  switch (bin_op) {
    case "Eq":
      res = l === r;
      break;
    case "Ne":
      res = l !== r;
      break;
    case "Lt":
      res = ln < rn;
      break;
    case "Le":
      res = ln <= rn;
      break;
    case "Gt":
      res = ln > rn;
      break;
    case "Ge":
      res = ln >= rn;
      break;
    case "BitAnd":
      res = l && r;
      break;
    case "BitOr":
      res = l || r;
      break;
    case "BitXor":
      res = l !== r;
      break;
    default:
      return span_bug(this.cur_span(), `Invalid operation on bool: ${debug_BinOp(bin_op, PLAIN)}`);
  }
  return ImmTy.from_bool(res, this.tcx.deref());
};

// PORT: `F: Float + FloatConvert<F> + Into<Scalar>`: `F`'s `FloatType` is `l.Self()`, `Into<Scalar>` is `F_into_Scalar`.
// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:69 binary_float_op
InterpCx.prototype.binary_float_op = function <F extends Float<F>>(this: InterpCx, bin_op: BinOp, layout: TyAndLayout, l: F, r: F): ImmTy {
  // use rustc_middle::mir::BinOp::*;
  const F_: FloatType<F> = l.Self();

  // Performs appropriate non-deterministic adjustments of NaN results.
  const adjust_nan = (f: F): F => this.adjust_nan(f, [l, r], F_);

  // `PartialOrd` of IEEE floats: `partial_cmp` is `None` when either side is NaN.
  const ord = l.partial_cmp(r);
  switch (bin_op) {
    case "Eq":
      return ImmTy.from_bool(ord === 0, this.tcx.deref());
    case "Ne":
      return ImmTy.from_bool(ord !== 0, this.tcx.deref());
    case "Lt":
      return ImmTy.from_bool(ord === -1, this.tcx.deref());
    case "Le":
      return ImmTy.from_bool(ord === -1 || ord === 0, this.tcx.deref());
    case "Gt":
      return ImmTy.from_bool(ord === 1, this.tcx.deref());
    case "Ge":
      return ImmTy.from_bool(ord === 1 || ord === 0, this.tcx.deref());
    case "Add":
      return ImmTy.from_scalar(F_into_Scalar(adjust_nan(l.add(r).value)), layout);
    case "Sub":
      return ImmTy.from_scalar(F_into_Scalar(adjust_nan(l.sub(r).value)), layout);
    case "Mul":
      return ImmTy.from_scalar(F_into_Scalar(adjust_nan(l.mul(r).value)), layout);
    case "Div":
      return ImmTy.from_scalar(F_into_Scalar(adjust_nan(l.div(r).value)), layout);
    case "Rem":
      return ImmTy.from_scalar(F_into_Scalar(adjust_nan(l.rem(r).value)), layout);
    default:
      return span_bug(this.cur_span(), `invalid float op: \`${debug_BinOp(bin_op, PLAIN)}\``);
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:97 binary_int_op
InterpCx.prototype.binary_int_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  // use rustc_middle::mir::BinOp::*;

  // This checks the size, so that we can just assert it below.
  const l_r = left.to_scalar_int();
  if (l_r.$ === "Err") return l_r;
  const l = l_r._0;
  const r_r = right.to_scalar_int();
  if (r_r.$ === "Err") return r_r;
  const r = r_r._0;
  // Prepare to convert the values to signed or unsigned form.
  const l_signed = (): bigint => l.to_int(left.layout.size);
  const l_unsigned = (): bigint => l.to_uint(left.layout.size);
  const r_signed = (): bigint => r.to_int(right.layout.size);
  const r_unsigned = (): bigint => r.to_uint(right.layout.size);

  let throw_ub_on_overflow: Symbol | undefined;
  switch (bin_op) {
    case "AddUnchecked":
      throw_ub_on_overflow = sym.unchecked_add;
      break;
    case "SubUnchecked":
      throw_ub_on_overflow = sym.unchecked_sub;
      break;
    case "MulUnchecked":
      throw_ub_on_overflow = sym.unchecked_mul;
      break;
    case "ShlUnchecked":
      throw_ub_on_overflow = sym.unchecked_shl;
      break;
    case "ShrUnchecked":
      throw_ub_on_overflow = sym.unchecked_shr;
      break;
    default:
      throw_ub_on_overflow = undefined;
  }
  const with_overflow = BinOp.is_overflowing(bin_op);

  // Shift ops can have an RHS with a different numeric type.
  if (bin_op === "Shl" || bin_op === "ShlUnchecked" || bin_op === "Shr" || bin_op === "ShrUnchecked") {
    const l_bits = BigInt(left.layout.size.bits());
    // Compute the equivalent shift modulo `size` that is in the range `0..size`. (This is
    // the one MIR operator that does *not* directly map to a single LLVM operation.)
    let shift_amount_: bigint;
    let overflow: boolean;
    if (BackendRepr.is_signed(right.layout.backend_repr)) {
      const shift_amount = r_signed();
      // `shift_amount.rem_euclid(l_bits.into())`
      const rem = ((shift_amount % l_bits) + l_bits) % l_bits;
      // `rem` is guaranteed positive, so the `unwrap` cannot fail
      [shift_amount_, overflow] = [rem, rem !== shift_amount];
    } else {
      const shift_amount = r_unsigned();
      const rem = shift_amount % l_bits;
      [shift_amount_, overflow] = [rem, rem !== shift_amount];
    }
    const shift_amount = shift_amount_; // we brought this in the range `0..size` so this will always fit
    // Compute the shifted result.
    // PORT: `checked_shl` / `checked_shr` with `shift_amount < 128` never fail: `<<` wraps to 128 bits, `>>` on a
    // bigint is arithmetic for `i128` and logical for a non-negative `u128`.
    let result: ScalarInt;
    if (BackendRepr.is_signed(left.layout.backend_repr)) {
      const l = l_signed();
      let res: bigint;
      switch (bin_op) {
        case "Shl":
        case "ShlUnchecked":
          res = BigInt.asIntN(128, l << shift_amount);
          break;
        case "Shr":
        case "ShrUnchecked":
          res = l >> shift_amount;
          break;
        default:
          return bug();
      }
      result = ScalarInt.truncate_from_int(res, left.layout.size)[0];
    } else {
      const l = l_unsigned();
      let res: bigint;
      switch (bin_op) {
        case "Shl":
        case "ShlUnchecked":
          res = BigInt.asUintN(128, l << shift_amount);
          break;
        case "Shr":
        case "ShrUnchecked":
          res = l >> shift_amount;
          break;
        default:
          return bug();
      }
      result = ScalarInt.truncate_from_uint(res, left.layout.size)[0];
    }

    if (overflow && throw_ub_on_overflow !== undefined) {
      const intrinsic = throw_ub_on_overflow;
      // throw_ub!(ShiftOverflow { intrinsic, shift_amount: .. })
      return ub({
        $: "ShiftOverflow",
        intrinsic,
        shift_amount: BackendRepr.is_signed(right.layout.backend_repr) ? { $: "Right", _0: r_signed() } : { $: "Left", _0: r_unsigned() },
      });
    }

    return interp_ok(ImmTy.from_scalar_int(result, left.layout));
  }

  // For the remaining ops, the types must be the same on both sides
  if (left.layout.ty !== right.layout.ty) {
    return span_bug(
      this.cur_span(),
      `invalid asymmetric binary op ${debug_BinOp(bin_op, PLAIN)}: ${debug_ScalarInt(l, PLAIN)} (${display_Ty(left.layout.ty)}), ${debug_ScalarInt(r, PLAIN)} (${display_Ty(right.layout.ty)})`,
    );
  }

  const size = left.layout.size;

  // Operations that need special treatment for signed integers
  if (BackendRepr.is_signed(left.layout.backend_repr)) {
    let cmp: ((a: bigint, b: bigint) => boolean) | undefined;
    switch (bin_op) {
      case "Lt":
        cmp = (a, b) => a < b;
        break;
      case "Le":
        cmp = (a, b) => a <= b;
        break;
      case "Gt":
        cmp = (a, b) => a > b;
        break;
      case "Ge":
        cmp = (a, b) => a >= b;
        break;
      default:
        cmp = undefined;
    }
    if (cmp !== undefined) {
      return interp_ok(ImmTy.from_bool(cmp(l_signed(), r_signed()), this.tcx.deref()));
    }
    if (bin_op === BinOp.Cmp) {
      return interp_ok(this.three_way_compare(l_signed(), r_signed()));
    }
    let op: ((a: bigint, b: bigint) => [bigint, boolean]) | undefined;
    switch (bin_op) {
      case "Div":
        if (r.is_null()) return ub({ $: "DivisionByZero" });
        op = i128_overflowing_div;
        break;
      case "Rem":
        if (r.is_null()) return ub({ $: "RemainderByZero" });
        op = i128_overflowing_rem;
        break;
      case "Add":
      case "AddUnchecked":
      case "AddWithOverflow":
        op = (a, b) => wrap_i128(a + b);
        break;
      case "Sub":
      case "SubUnchecked":
      case "SubWithOverflow":
        op = (a, b) => wrap_i128(a - b);
        break;
      case "Mul":
      case "MulUnchecked":
      case "MulWithOverflow":
        op = (a, b) => wrap_i128(a * b);
        break;
      default:
        op = undefined;
    }
    if (op !== undefined) {
      const l = l_signed();
      const r = r_signed();

      // We need a special check for overflowing Rem and Div since they are *UB*
      // on overflow, which can happen with "int_min $OP -1".
      if (bin_op === "Rem" || bin_op === "Div") {
        if (l === size.signed_int_min() && r === -1n) {
          if (bin_op === BinOp.Rem) {
            return ub({ $: "RemainderOverflow" });
          } else {
            return ub({ $: "DivisionOverflow" });
          }
        }
      }

      const [result_, oflo] = op(l, r);
      // This may be out-of-bounds for the result type, so we have to truncate.
      // If that truncation loses any information, we have an overflow.
      const [result, lossy] = ScalarInt.truncate_from_int(result_, left.layout.size);
      const overflow = oflo || lossy;
      if (overflow && throw_ub_on_overflow !== undefined) {
        // throw_ub!(ArithOverflow { intrinsic })
        return ub({ $: "ArithOverflow", intrinsic: throw_ub_on_overflow });
      }
      const res = ImmTy.from_scalar_int(result, left.layout);
      if (with_overflow) {
        const overflow_ = ImmTy.from_bool(overflow, this.tcx.deref());
        return interp_ok(ImmTy.from_pair(res, overflow_, this));
      } else {
        return interp_ok(res);
      }
    }
  }
  // From here on it's okay to treat everything as unsigned.
  const lu = l_unsigned();
  const ru = r_unsigned();

  if (bin_op === BinOp.Cmp) {
    return interp_ok(this.three_way_compare(lu, ru));
  }

  switch (bin_op) {
    case "Eq":
      return interp_ok(ImmTy.from_bool(lu === ru, this.tcx.deref()));
    case "Ne":
      return interp_ok(ImmTy.from_bool(lu !== ru, this.tcx.deref()));

    case "Lt":
      return interp_ok(ImmTy.from_bool(lu < ru, this.tcx.deref()));
    case "Le":
      return interp_ok(ImmTy.from_bool(lu <= ru, this.tcx.deref()));
    case "Gt":
      return interp_ok(ImmTy.from_bool(lu > ru, this.tcx.deref()));
    case "Ge":
      return interp_ok(ImmTy.from_bool(lu >= ru, this.tcx.deref()));

    case "BitOr":
      return interp_ok(ImmTy.from_uint(lu | ru, left.layout));
    case "BitAnd":
      return interp_ok(ImmTy.from_uint(lu & ru, left.layout));
    case "BitXor":
      return interp_ok(ImmTy.from_uint(lu ^ ru, left.layout));

    default: {
      assert(!BackendRepr.is_signed(left.layout.backend_repr), "assertion failed: !left.layout.backend_repr.is_signed()");
      let op: (a: bigint, b: bigint) => [bigint, boolean];
      switch (bin_op) {
        case "Add":
        case "AddUnchecked":
        case "AddWithOverflow":
          op = (a, b) => wrap_u128(a + b);
          break;
        case "Sub":
        case "SubUnchecked":
        case "SubWithOverflow":
          op = (a, b) => wrap_u128(a - b);
          break;
        case "Mul":
        case "MulUnchecked":
        case "MulWithOverflow":
          op = (a, b) => wrap_u128(a * b);
          break;
        case "Div":
          if (ru === 0n) return ub({ $: "DivisionByZero" });
          op = (a, b) => [a / b, false];
          break;
        case "Rem":
          if (ru === 0n) return ub({ $: "RemainderByZero" });
          op = (a, b) => [a % b, false];
          break;
        default:
          return span_bug(
            this.cur_span(),
            `invalid binary op ${debug_BinOp(bin_op, PLAIN)}: ${debug_ImmTy(left, PLAIN)}, ${debug_ImmTy(right, PLAIN)} (both ${display_Ty(right.layout.ty)})`,
          );
      }
      const [result_, oflo] = op(lu, ru);
      // Truncate to target type.
      // If that truncation loses any information, we have an overflow.
      const [result, lossy] = ScalarInt.truncate_from_uint(result_, left.layout.size);
      const overflow = oflo || lossy;
      if (overflow && throw_ub_on_overflow !== undefined) {
        // throw_ub!(ArithOverflow { intrinsic })
        return ub({ $: "ArithOverflow", intrinsic: throw_ub_on_overflow });
      }
      const res = ImmTy.from_scalar_int(result, left.layout);
      if (with_overflow) {
        const overflow_ = ImmTy.from_bool(overflow, this.tcx.deref());
        return interp_ok(ImmTy.from_pair(res, overflow_, this));
      } else {
        return interp_ok(res);
      }
    }
  }
};

/// Computes the total size of this access, `count * elem_size`,
/// checking for overflow beyond isize::MAX.
// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:304 compute_size_in_bytes
InterpCx.prototype.compute_size_in_bytes = function (this: InterpCx, elem_size: Size, count: bigint): Size | undefined {
  // `checked_mul` applies `u64` limits independent of the target pointer size... but the
  // subsequent check for `max_size_of_val` means we also handle 32bit targets correctly.
  // (We cannot use `Size::checked_mul` as that enforces `obj_size_bound` as the limit, which
  // would be wrong here.)
  const total_bytes = BigInt(elem_size.bytes()) * count;
  if (total_bytes > U64_MAX) return undefined;
  // PORT: `max_size_of_val()` is `Size::from_bytes(isize::MAX)`, beyond 2^53 for 64-bit targets (unported under the
  // Size rule), so the comparison is done in bigint against `target_isize_max` (the same value) before building the Size.
  return total_bytes <= PointerArithmetic_provided.target_isize_max(this) ? Size.from_bytes(total_bytes) : undefined;
};

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:316 binary_ptr_op
InterpCx.prototype.binary_ptr_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  // use rustc_middle::mir::BinOp::*;

  switch (bin_op) {
    // Pointer ops that are always supported.
    case "Offset": {
      const ptr = Scalar.to_pointer(Immediate.to_scalar(left.imm), this);
      const pointee_ty = unwrap(left.layout.ty.builtin_deref(true));
      const pointee_layout_r = this.layout_of(pointee_ty);
      if (pointee_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(pointee_layout_r._0));
      const pointee_layout = pointee_layout_r._0;
      assert(pointee_layout.is_sized(), "assertion failed: pointee_layout.is_sized()");

      // The size always fits in `i64` as it can be at most `isize::MAX`.
      const pointee_size_ = BigInt(pointee_layout.size.bytes());
      // This uses the same type as `right`, which can be `isize` or `usize`.
      // `pointee_size` is guaranteed to fit into both types.
      const pointee_size = ImmTy.from_int(pointee_size_, right.layout);
      // Multiply element size and element count.
      const prod = this.binary_op(BinOp.MulWithOverflow, right, pointee_size);
      if (prod.$ === "Err") return prod;
      const [val, overflowed] = Immediate.to_scalar_pair(prod._0.imm);
      // This must not overflow.
      const o = Scalar.to_bool(overflowed);
      if (o.$ === "Err") return o;
      if (o._0) {
        return ub({ $: "PointerArithOverflow" });
      }

      const offset_bytes_r = Scalar.to_target_isize(val, this);
      if (offset_bytes_r.$ === "Err") return offset_bytes_r;
      const offset_bytes = offset_bytes_r._0;
      if (!BackendRepr.is_signed(right.layout.backend_repr) && offset_bytes < 0n) {
        // We were supposed to do an unsigned offset but the result is negative -- this
        // can only mean that the cast wrapped around.
        return ub({ $: "PointerArithOverflow" });
      }
      const offset_ptr = this.ptr_offset_inbounds(ptr, offset_bytes);
      if (offset_ptr.$ === "Err") return offset_ptr;
      return interp_ok(ImmTy.from_scalar(Scalar.from_maybe_pointer<CtfeProvenance>(offset_ptr._0, this), left.layout));
    }

    // Fall back to machine hook so Miri can support more pointer ops.
    default:
      return this.machine.binary_ptr_op(this, bin_op, left, right);
  }
};

/// Returns the result of the specified operation.
///
/// Whether this produces a scalar or a pair depends on the specific `bin_op`.
// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:367 binary_op
InterpCx.prototype.binary_op = function (this: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  // trace!(
  //     "Running binary op {:?}: {:?} ({}), {:?} ({})",
  //     bin_op, *left, left.layout.ty, *right, right.layout.ty
  // );

  const kind = left.layout.ty.kind();
  switch (kind.$) {
    case "Char": {
      assert_eq(left.layout.ty, right.layout.ty, (v) => debug_Ty(v, PLAIN));
      const l = Immediate.to_scalar(left.imm);
      const r = Immediate.to_scalar(right.imm);
      const lc = Scalar.to_char(l);
      if (lc.$ === "Err") return lc;
      const rc = Scalar.to_char(r);
      if (rc.$ === "Err") return rc;
      return interp_ok(this.binary_char_op(bin_op, lc._0, rc._0));
    }
    case "Bool": {
      assert_eq(left.layout.ty, right.layout.ty, (v) => debug_Ty(v, PLAIN));
      const l = Immediate.to_scalar(left.imm);
      const r = Immediate.to_scalar(right.imm);
      const lb = Scalar.to_bool(l);
      if (lb.$ === "Err") return lb;
      const rb = Scalar.to_bool(r);
      if (rb.$ === "Err") return rb;
      return interp_ok(this.binary_bool_op(bin_op, lb._0, rb._0));
    }
    case "Float": {
      assert_eq(left.layout.ty, right.layout.ty, (v) => debug_Ty(v, PLAIN));
      const layout = left.layout;
      const l = Immediate.to_scalar(left.imm);
      const r = Immediate.to_scalar(right.imm);
      switch (kind._0) {
        case "F16": {
          const lf = Scalar.to_f16(l);
          if (lf.$ === "Err") return lf;
          const rf = Scalar.to_f16(r);
          if (rf.$ === "Err") return rf;
          return interp_ok(this.binary_float_op(bin_op, layout, ap<ApHalf>(lf._0), ap<ApHalf>(rf._0)));
        }
        case "F32": {
          const lf = Scalar.to_f32(l);
          if (lf.$ === "Err") return lf;
          const rf = Scalar.to_f32(r);
          if (rf.$ === "Err") return rf;
          return interp_ok(this.binary_float_op(bin_op, layout, ap<ApSingle>(lf._0), ap<ApSingle>(rf._0)));
        }
        case "F64": {
          const lf = Scalar.to_f64(l);
          if (lf.$ === "Err") return lf;
          const rf = Scalar.to_f64(r);
          if (rf.$ === "Err") return rf;
          return interp_ok(this.binary_float_op(bin_op, layout, ap<ApDouble>(lf._0), ap<ApDouble>(rf._0)));
        }
        case "F128": {
          const lf = Scalar.to_f128(l);
          if (lf.$ === "Err") return lf;
          const rf = Scalar.to_f128(r);
          if (rf.$ === "Err") return rf;
          return interp_ok(this.binary_float_op(bin_op, layout, ap<ApQuad>(lf._0), ap<ApQuad>(rf._0)));
        }
      }
    }
  }
  if (left.layout.ty.is_integral()) {
    // the RHS type can be different, e.g. for shifts -- but it has to be integral, too
    assert(
      right.layout.ty.is_integral(),
      () => `Unexpected types for BinOp: ${display_Ty(left.layout.ty)} ${debug_BinOp(bin_op, PLAIN)} ${display_Ty(right.layout.ty)}`,
    );

    return this.binary_int_op(bin_op, left, right);
  }
  if (left.layout.ty.is_any_ptr()) {
    // The RHS type must be a `pointer` *or an integer type* (for `Offset`).
    // (Even when both sides are pointers, their type might differ, see issue #91636)
    assert(
      right.layout.ty.is_any_ptr() || right.layout.ty.is_integral(),
      () => `Unexpected types for BinOp: ${display_Ty(left.layout.ty)} ${debug_BinOp(bin_op, PLAIN)} ${display_Ty(right.layout.ty)}`,
    );

    return this.binary_ptr_op(bin_op, left, right);
  }
  return span_bug(this.cur_span(), `Invalid MIR: bad LHS type for binop: ${display_Ty(left.layout.ty)}`);
};

/// Returns the result of the specified operation.
// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:445 unary_op
InterpCx.prototype.unary_op = function (this: InterpCx, un_op: UnOp, val: ImmTy): InterpResult<ImmTy> {
  // use rustc_middle::mir::UnOp::*;

  const layout = val.layout;
  // trace!("Running unary op {:?}: {:?} ({})", un_op, val, layout.ty);

  const kind = layout.ty.kind();
  switch (kind.$) {
    case "Bool": {
      const v = Scalar.to_bool(Immediate.to_scalar(val.imm));
      if (v.$ === "Err") return v;
      let res: boolean;
      switch (un_op) {
        case "Not":
          res = !v._0;
          break;
        default:
          return span_bug(this.cur_span(), `Invalid bool op ${debug_UnOp(un_op, PLAIN)}`);
      }
      return interp_ok(ImmTy.from_bool(res, this.tcx.deref()));
    }
    case "Float": {
      const v = Immediate.to_scalar(val.imm);
      if (un_op !== UnOp.Neg) {
        span_bug(this.cur_span(), `Invalid float op ${debug_UnOp(un_op, PLAIN)}`);
      }

      // No NaN adjustment here, `-` is a bitwise operation!
      let res: Scalar;
      switch (kind._0) {
        case "F16": {
          const f = Scalar.to_f16(v);
          if (f.$ === "Err") return f;
          res = Scalar.from_f16(ap<ApHalf>(f._0).neg() as never);
          break;
        }
        case "F32": {
          const f = Scalar.to_f32(v);
          if (f.$ === "Err") return f;
          res = Scalar.from_f32(ap<ApSingle>(f._0).neg() as never);
          break;
        }
        case "F64": {
          const f = Scalar.to_f64(v);
          if (f.$ === "Err") return f;
          res = Scalar.from_f64(ap<ApDouble>(f._0).neg() as never);
          break;
        }
        case "F128": {
          const f = Scalar.to_f128(v);
          if (f.$ === "Err") return f;
          res = Scalar.from_f128(ap<ApQuad>(f._0).neg() as never);
          break;
        }
      }
      return interp_ok(ImmTy.from_scalar(res, layout));
    }
    case "Int": {
      const v = Scalar.to_int(Immediate.to_scalar(val.imm), layout.size);
      if (v.$ === "Err") return v;
      let res_: bigint;
      switch (un_op) {
        case "Not":
          // `!val` on an `i128`
          res_ = ~v._0;
          break;
        case "Neg":
          // `i128::wrapping_neg`
          res_ = BigInt.asIntN(128, -v._0);
          break;
        default:
          return span_bug(this.cur_span(), `Invalid integer op ${debug_UnOp(un_op, PLAIN)}`);
      }
      const res = ScalarInt.truncate_from_int(res_, layout.size)[0];
      return interp_ok(ImmTy.from_scalar(Scalar_from_ScalarInt(res), layout));
    }
    case "Uint": {
      const v = Scalar.to_uint(Immediate.to_scalar(val.imm), layout.size);
      if (v.$ === "Err") return v;
      let res_: bigint;
      switch (un_op) {
        case "Not":
          // `!val` on a `u128`
          res_ = BigInt.asUintN(128, ~v._0);
          break;
        default:
          return span_bug(this.cur_span(), `Invalid unsigned integer op ${debug_UnOp(un_op, PLAIN)}`);
      }
      const res = ScalarInt.truncate_from_uint(res_, layout.size)[0];
      return interp_ok(ImmTy.from_scalar(Scalar_from_ScalarInt(res), layout));
    }
    case "RawPtr":
    case "Ref": {
      assert_eq(un_op, UnOp.PtrMetadata, (v) => debug_UnOp(v, PLAIN));
      const d = this.deref_pointer(val); // validity check
      if (d.$ === "Err") return d;
      const [, meta] = Immediate.to_scalar_and_meta(val.imm);
      switch (meta.$) {
        case "Meta": {
          const scalar = meta._0;
          const ty = UnOp.ty(un_op, this.tcx.deref(), val.layout.ty);
          const layout_r = this.layout_of(ty);
          if (layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout_r._0));
          return interp_ok(ImmTy.from_scalar(scalar, layout_r._0));
        }
        case "None": {
          const unit_layout = this.layout_of(this.tcx.deref().types.unit);
          if (unit_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(unit_layout._0));
          return interp_ok(ImmTy.uninit(unit_layout._0));
        }
      }
    }
    // falls through (unreachable: every arm above returns)
    default:
      return bug(`Unexpected unary op argument ${debug_ImmTy(val, PLAIN)}`);
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/operator.rs:521 atomic_rmw_op
InterpCx.prototype.atomic_rmw_op = function (this: InterpCx, op: AtomicRmwOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  switch (op.$) {
    case "MirOp": {
      const val = this.binary_op(op.op, left, right);
      if (val.$ === "Err") return val;
      if (op.neg) {
        const r = this.unary_op(UnOp.Not, val._0);
        if (r.$ === "Err") return r;
        return interp_ok(r._0);
      } else {
        return interp_ok(val._0);
      }
    }
    case "Max": {
      const lt_r = this.binary_op(BinOp.Lt, left, right);
      if (lt_r.$ === "Err") return lt_r;
      const lt = Scalar.to_bool(Immediate.to_scalar(lt_r._0.imm));
      if (lt.$ === "Err") return lt;
      return interp_ok(lt._0 ? right : left);
    }
    case "Min": {
      const lt_r = this.binary_op(BinOp.Lt, left, right);
      if (lt_r.$ === "Err") return lt_r;
      const lt = Scalar.to_bool(Immediate.to_scalar(lt_r._0.imm));
      if (lt.$ === "Err") return lt;
      return interp_ok(lt._0 ? left : right);
    }
    case "Swap":
      return interp_ok(right);
  }
};
