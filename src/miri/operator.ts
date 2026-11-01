// Fill lane: `miri-eval` (plan-m6 wave 36): ported by this lane.
// Port of src/tools/miri/src/operator.rs (crate `miri`, plan-m6 D2; lane miri-eval, wave 36).
//
// PORT:
// - (decision C8) Miri's `binary_ptr_op` is `binary_ptr_op_` (rustc_const_eval's private inherent `InterpCx::binary_ptr_op`
//   lives on the same prototype).
// - `generate_nan::<F1, F2>` takes `F2`'s `FloatType` dictionary as a trailing `F2_` (the interpreter's convention,
//   interpret/machine.ts header: `Machine::generate_nan(ecx, inputs, F2_)`); `F1` values convert themselves
//   (`FloatConvert`).
// - `nans.choose(rng)` runs over a hand-built `RustIterator` with core's exact `next` / `size_hint` for
//   `Once.chain(Map<Filter<slice::Iter>>).chain(FilterMap<Filter<slice::Iter>>)` (rand's `choose` draws depend on
//   `size_hint`, vendor/rand/seq/iterator.ts).
import { type ImmTy, type Scalar } from "./lib.ts";
import { type MiriInterpCx, type Provenance, Provenance_Provenance } from "./machine.ts";
import { BackendRepr_eq, debug_BackendRepr, Size } from "../rustc_abi/lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { Immediate, ImmTy as interp_ImmTy } from "../rustc_const_eval/interpret/operand.ts";
import { type InterpResult, interp_ok, Pointer, PointerArithmetic_provided, Scalar as interp_Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { type BinOp, debug_BinOp } from "../rustc_middle/mir/syntax.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { type Pending } from "../rustc_type_ir/decls.ts";
import type { Rng } from "../vendor/rand_core/lib.ts";
import { StandardUniform_bool } from "../vendor/rand/distr/other.ts";
import { RngExt } from "../vendor/rand/rng.ts";
import { IteratorRandom, type RustIterator } from "../vendor/rand/seq/iterator.ts";
import type { Float, FloatConvert, FloatType } from "../vendor/rustc_apfloat/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic } from "../std/panic.ts";


/**
 * PORT: the `ImmTy` constructors of rustc_const_eval are typed with the CTFE provenance; for Miri's provenance they are
 * the same functions (the provenance is only carried through).
 */
export const MiriImmTy = interp_ImmTy as unknown as {
  from_scalar(val: Scalar, layout: ImmTy["layout"]): ImmTy;
  from_scalar_int(s: Parameters<typeof interp_ImmTy.from_scalar_int>[0], layout: ImmTy["layout"]): ImmTy;
  from_immediate(imm: ImmTy["imm"], layout: ImmTy["layout"]): ImmTy;
  from_uint(i: bigint, layout: ImmTy["layout"]): ImmTy;
  from_int(i: bigint, layout: ImmTy["layout"]): ImmTy;
  from_bool(b: boolean, tcx: Parameters<typeof interp_ImmTy.from_bool>[1]): ImmTy;
};

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- operator.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // operator.rs:13 (PORT: decision C8, `binary_ptr_op` is also a rustc_const_eval `InterpCx` method)
    binary_ptr_op_(this: MiriInterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy>;
    // operator.rs:74
    generate_nan<F1 extends Float<F1> & FloatConvert, F2 extends Float<F2>>(this: MiriInterpCx, inputs: readonly F1[], F2_: FloatType<F2>): F2;
    // operator.rs:119
    equal_float_min_max<F>(this: MiriInterpCx, a: F, b: F): F;
  }
}

/** PORT: `ImmTy` derefs to `Immediate` (`imm.to_scalar()`); the companion is typed with the CTFE provenance. */
export function imm_to_scalar(imm: ImmTy): Scalar {
  return (Immediate.to_scalar as unknown as (self: ImmTy["imm"]) => Scalar)(imm.imm);
}

/** Lexicographic `(u128, u128)` comparison (tuple `PartialOrd`). */
function cmp_pair(a: [bigint, bigint], b: [bigint, bigint]): -1 | 0 | 1 {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

// rustc: src/tools/miri/src/operator.rs:13 binary_ptr_op
InterpCx.prototype.binary_ptr_op_ = function (this: MiriInterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
  // use rustc_middle::mir::BinOp::*;

  const this_ = this.eval_context_ref();
  // trace!("ptr_op: {:?} {:?} {:?}", *left, bin_op, *right);

  let res_imm: ImmTy;
  switch (bin_op) {
    case "Eq":
    case "Ne":
    case "Lt":
    case "Le":
    case "Gt":
    case "Ge": {
      assert_eq(left.layout.backend_repr, right.layout.backend_repr, (v) => debug_BackendRepr(v, PLAIN), BackendRepr_eq); // types can differ, e.g. fn ptrs with different `for`
      const size = PointerArithmetic_provided.pointer_size(this_);
      // Just compare the bits. ScalarPairs are compared lexicographically.
      // We thus always compare pairs and simply fill scalars up with 0.
      const pair_of = (imm: ImmTy): InterpResult<[bigint, bigint]> => {
        const v = imm.deref();
        switch (v.$) {
          case "Scalar": {
            const l = interp_Scalar.to_bits(v._0, size);
            if (l.$ === "Err") return l;
            return interp_ok([l._0, 0n]);
          }
          case "ScalarPair": {
            const l1 = interp_Scalar.to_bits(v._0, size);
            if (l1.$ === "Err") return l1;
            const l2 = interp_Scalar.to_bits(v._1, size);
            if (l2.$ === "Err") return l2;
            return interp_ok([l1._0, l2._0]);
          }
          case "Uninit":
            return panic("we should never see uninit data here");
        }
      };
      const left_ = pair_of(left);
      if (left_.$ === "Err") return left_;
      const right_ = pair_of(right);
      if (right_.$ === "Err") return right_;
      const c = cmp_pair(left_._0, right_._0);
      let res: boolean;
      switch (bin_op) {
        case "Eq":
          res = c === 0;
          break;
        case "Ne":
          res = c !== 0;
          break;
        case "Lt":
          res = c < 0;
          break;
        case "Le":
          res = c <= 0;
          break;
        case "Gt":
          res = c > 0;
          break;
        case "Ge":
          res = c >= 0;
          break;
        default:
          return bug("");
      }
      res_imm = MiriImmTy.from_bool(res, this_.tcx.deref());
      break;
    }

    // Some more operations are possible with atomics.
    // The RHS must be `usize`.
    case "Add":
    case "Sub":
    case "BitOr":
    case "BitAnd":
    case "BitXor": {
      assert(left.layout.ty.is_raw_ptr(), "assertion failed: left.layout.ty.is_raw_ptr()");
      assert_eq(right.layout.ty, this_.tcx.deref().types.usize, (v) => String(v));
      const ptr = interp_Scalar.to_pointer<Provenance>(imm_to_scalar(left), this_);
      // We do the actual operation with usize-typed scalars.
      const left_ = MiriImmTy.from_uint(ptr.addr(Provenance_Provenance).bytes_u64(), this_.machine.layouts.usize);
      const result = this_.binary_op(bin_op, left_, right);
      if (result.$ === "Err") return result;
      const result_usize = interp_Scalar.to_target_usize(imm_to_scalar(result._0), this_);
      if (result_usize.$ === "Err") return result_usize;
      // Construct a new pointer with the provenance of `ptr` (the LHS).
      const result_ptr = Pointer.new<Provenance | undefined>(ptr.provenance, Size.from_bytes(result_usize._0));

      res_imm = MiriImmTy.from_scalar(interp_Scalar.from_maybe_pointer(result_ptr, this_), left_.layout);
      break;
    }

    default:
      return span_bug(this_.cur_span(), `Invalid operator on pointers: ${debug_BinOp(bin_op, PLAIN)}`);
  }
  return interp_ok(res_imm);
};

/// Make the given NaN a signaling NaN.
/// Returns `None` if this would not result in a NaN.
// rustc: src/tools/miri/src/operator.rs:82 make_signaling
function make_signaling<F extends Float<F>>(f: F): F | undefined {
  const F_ = f.Self();
  // The quiet/signaling bit is the leftmost bit in the mantissa.
  // That's position `PRECISION-1`, since `PRECISION` includes the fixed leading 1 bit,
  // and then we subtract 1 more since this is 0-indexed.
  const quiet_bit_mask = 1n << BigInt(F_.PRECISION - 2);
  // Unset the bit. Double-check that this wasn't the last bit set in the payload.
  // (which would turn the NaN into an infinity).
  const f2 = F_.from_bits(f.to_bits() & ~quiet_bit_mask & ((1n << 128n) - 1n));
  if (f2.is_nan()) {
    return f2;
  } else {
    return undefined;
  }
}

/**
 * PORT: `iter::once(preferred_nan).chain(quieting).chain(signaling)` (operator.rs:98) as a `RustIterator`: core's
 * `Chain` (fuses its first half only), `Once` (`(n, Some(n))`), `Map<Filter<slice::Iter>>` / `FilterMap<Filter<..>>`
 * (`(0, Some(remaining))`).
 */
class Chain<T> implements RustIterator<T> {
  constructor(
    private a: RustIterator<T> | undefined,
    private readonly b: RustIterator<T>,
  ) {}
  next(): T | undefined {
    if (this.a !== undefined) {
      const x = this.a.next();
      if (x !== undefined) return x;
      this.a = undefined;
    }
    return this.b.next();
  }
  size_hint(): [number, number | undefined] {
    if (this.a !== undefined) {
      const [a_lower, a_upper] = this.a.size_hint();
      const [b_lower, b_upper] = this.b.size_hint();
      const lower = a_lower + b_lower;
      const upper = a_upper !== undefined && b_upper !== undefined ? a_upper + b_upper : undefined;
      return [lower, upper];
    }
    return this.b.size_hint();
  }
}
class Once<T> implements RustIterator<T> {
  constructor(private v: T | undefined) {}
  next(): T | undefined {
    const v = this.v;
    this.v = undefined;
    return v;
  }
  size_hint(): [number, number | undefined] {
    const n = this.v === undefined ? 0 : 1;
    return [n, n];
  }
}
/** `slice.iter().filter(pred).filter_map(f)` (`.map(f)` is `filter_map` with an `f` that never returns `None`). */
class SliceFilterMap<S, T> implements RustIterator<T> {
  private i = 0;
  constructor(
    private readonly slice: readonly S[],
    private readonly pred: (s: S) => boolean,
    private readonly f: (s: S) => T | undefined,
  ) {}
  next(): T | undefined {
    while (this.i < this.slice.length) {
      const s = this.slice[this.i++]!;
      if (!this.pred(s)) continue;
      const t = this.f(s);
      if (t !== undefined) return t;
    }
    return undefined;
  }
  size_hint(): [number, number | undefined] {
    return [0, this.slice.length - this.i];
  }
}

// rustc: src/tools/miri/src/operator.rs:74 generate_nan
InterpCx.prototype.generate_nan = function <F1 extends Float<F1> & FloatConvert, F2 extends Float<F2>>(
  this: MiriInterpCx,
  inputs: readonly F1[],
  F2_: FloatType<F2>,
): F2 {
  const this_ = this.eval_context_ref();
  if (!this_.machine.float_nondet) {
    return F2_.NAN;
  }

  const rand = this_.machine.rng;
  // Assemble an iterator of possible NaNs: preferred, quieting propagation, unchanged propagation.
  // On some targets there are more possibilities; for now we just generate those options that
  // are possible everywhere.
  const preferred_nan = F2_.qnan(0n);
  const nans: RustIterator<F2> = new Chain(
    new Chain<F2>(
      new Once(preferred_nan),
      new SliceFilterMap(
        inputs,
        (f) => f.is_nan(),
        (f) => {
          // Regular apfloat cast is quieting.
          return f.convert(F2_, { value: false }).value;
        },
      ),
    ),
    new SliceFilterMap(
      inputs,
      (f) => f.is_signaling(),
      (f) => {
        const f2: F2 = f.convert(F2_, { value: false }).value;
        // We have to de-quiet this again for unchanged propagation.
        return make_signaling(f2);
      },
    ),
  );
  // Pick one of the NaNs.
  const nan = IteratorRandom.choose(nans, rand);
  if (nan === undefined) panic("called `Option::unwrap()` on a `None` value");
  // Non-deterministically flip the sign.
  if (RngExt.random(rand, StandardUniform_bool)) {
    // This will properly flip even for NaN.
    return nan.neg();
  } else {
    return nan;
  }
};

// rustc: src/tools/miri/src/operator.rs:119 equal_float_min_max
InterpCx.prototype.equal_float_min_max = function <F>(this: MiriInterpCx, a: F, b: F): F {
  const this_ = this.eval_context_ref();
  if (!this_.machine.float_nondet) {
    return a;
  }
  // Return one side non-deterministically.
  const rand = this_.machine.rng;
  if (RngExt.random(rand, StandardUniform_bool)) {
    return a;
  } else {
    return b;
  }
};
