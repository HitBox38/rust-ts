// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `src/ppc.rs`.
//
// PORT: representation (follows ieee.ts / lib.ts).
// - `DoubleFloat<F>(F, F)` is an immutable value class with fields `_0` / `_1`; a `mut self` method works on a
//   `clone()` (the fields are only assigned on such a copy), and the shared constants are frozen.
// - Its static side (`Float`'s associated consts and the fns without `self`) is the `DoubleFloatType<F>` made by
//   `double_float_type(F)` from `F`'s `FloatType` dictionary (`DoubleDouble` = `double_float_type(Double)`).
//   `Self()` reaches it from an instance through `self.0`'s type.
// - `F: Float` + the `FloatConvert` bounds of the impls: `F` is a `Float<F> & FloatConvert` (in practice an
//   `IeeeFloat`, the only `FloatConvert` implementor). `#[derive(Debug)]` adds `F: Debug`: `F` has `debug_fmt()`.
// - `FallbackS<F>` / `FallbackExtendedS<F>` are `Semantics` values built per `F` by ieee.ts `semantics(..)`
//   (`Fallback<F>` / `FallbackExtended<F>` are `IeeeFloat`s with them); the `DoubleFloatType` holds them.
// - `impl From<Fallback<F>> for DoubleFloat<F>` is `DoubleFloatType.from(x)` (`Self::from`), and
//   `impl From<DoubleFloat<F>> for Fallback<F>` is `DoubleFloatType.fallback_from(x)` (`Fallback::from`).
// - There is no `FloatConvert` impl for `DoubleFloat` upstream (`x.convert::<DoubleDouble>()` does not compile);
//   ieee.ts `IeeeFloat.convert_r` panics for such a target.
//
//! Support for floating point types that use PowerPC semantics.

import { type Fmt, PLAIN, debug_tuple } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Panic } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { Double, type IeeeFloat, type IeeeFloatType, type Semantics, ieee_float_type, semantics } from "./ieee.ts";
import {
  Category,
  type ExpInt,
  FLOAT_COMMON_METHODS,
  FLOAT_PROVIDED_METHODS,
  type Float,
  type FloatConvert,
  type FloatFmt,
  type FloatType,
  Float_provided,
  type Ordering,
  type ParseError,
  type Round,
  Status,
  type StatusAnd,
  StatusAnd as StatusAnd_,
  debug_Status,
  float_common_impls,
} from "./lib.ts";

/** PORT: the bounds `ppc.rs` puts on `F` (`Float`, `FloatConvert<..>`, and `Debug` for the derive). */
export type DoubleFloatInner<F extends Float<F>> = Float<F> & FloatConvert & { debug_fmt(): string };

/** `Fallback<F>` / `FallbackExtended<F>` (`ieee::IeeeFloat<FallbackS<F>>`, ...). */
type Fallback = IeeeFloat<Semantics>;
type FallbackExtended = IeeeFloat<Semantics>;

/** `assert_eq!((status, loses_info), (Status::OK, false))` */
function assert_ok_exact(status: Status, loses_info: boolean): void {
  if (!(status === Status.OK && !loses_info)) {
    throw new Panic(
      `assertion \`left == right\` failed\n  left: (${debug_Status(status, PLAIN)}, ${loses_info})\n right: (${debug_Status(Status.OK, PLAIN)}, false)`,
    );
  }
}
/** `assert_eq!(status, Status::OK)` */
function assert_status_ok(status: Status): void {
  if (status !== Status.OK) {
    throw new Panic(`assertion \`left == right\` failed\n  left: ${debug_Status(status, PLAIN)}\n right: ${debug_Status(Status.OK, PLAIN)}`);
  }
}
/** `bool::cmp` */
function cmp_bool(a: boolean, b: boolean): Ordering {
  return a === b ? 0 : a ? 1 : -1;
}
/** `Ordering::reverse` */
function reverse(o: Ordering): Ordering {
  return o === 0 ? 0 : (-o as Ordering);
}

/// A larger floating point number represented by two smaller floats.
// #[must_use]
// #[derive(Copy, Clone, PartialEq, PartialOrd, Debug)]
export class DoubleFloat<F extends DoubleFloatInner<F>> implements Float<DoubleFloat<F>> {
  constructor(
    public _0: F,
    public _1: F,
  ) {}

  /** PORT: `Self::` */
  Self(): DoubleFloatType<F> {
    return double_float_type(this._0.Self());
  }

  /** `Clone` / `Copy` */
  clone(): DoubleFloat<F> {
    return new DoubleFloat(this._0, this._1);
  }

  /** `#[derive(PartialEq)]` */
  eq(rhs: DoubleFloat<F>): boolean {
    return this._0.eq(rhs._0) && this._1.eq(rhs._1);
  }

  /** `#[derive(PartialOrd)]` (lexicographic over the fields) */
  partial_cmp(rhs: DoubleFloat<F>): Ordering | undefined {
    const o = this._0.partial_cmp(rhs._0);
    if (o === 0) return this._1.partial_cmp(rhs._1);
    return o;
  }

  /** `#[derive(Debug)]` (`{:?}`; `debug_DoubleFloat` takes the formatter flags) */
  debug_fmt(): string {
    return debug_DoubleFloat(this, { alternate: false });
  }

  // impl<F: Float> Neg for DoubleFloat<F>
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:130 neg
  neg(): DoubleFloat<F> {
    if (this._1.is_finite_non_zero()) {
      return new DoubleFloat(this._0.neg(), this._1.neg());
    } else {
      return new DoubleFloat(this._0.neg(), this._1);
    }
  }

  // impl<F: FloatConvert<Fallback<F>>> fmt::Display for DoubleFloat<F>
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:140 fmt
  // PORT: returns the written text; `f` carries the formatter's width / precision / `#` (see ieee.ts).
  fmt(f: FloatFmt = {}): string {
    return this.Self().fallback_from(this).fmt(f);
  }

  // impl<F: FloatConvert<Fallback<F>>> Float for DoubleFloat<F>
  // (the associated consts and the fns without `self` are on `DoubleFloatType`)

  // Implement addition, subtraction, multiplication and division based on:
  // "Software for Doubled-Precision Floating-Point Computations",
  // by Seppo Linnainmaa, ACM TOMS vol 7 no 3, September 1981, pages 272-283.

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:188 add_r
  add_r(rhs: DoubleFloat<F>, round: Round): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    const F = Self.F;
    const self = this.clone();
    const ca = self.category();
    const cb = rhs.category();
    if (ca === Category.Infinity && cb === Category.Infinity) {
      if (self.is_negative() !== rhs.is_negative()) {
        return Status.and(Status.INVALID_OP, Self.NAN.copy_sign(self));
      } else {
        return Status.and(Status.OK, self);
      }
    } else if (cb === Category.Zero || ca === Category.NaN || (ca === Category.Infinity && cb === Category.Normal)) {
      return Status.and(Status.OK, self);
    } else if (ca === Category.Zero || cb === Category.NaN || cb === Category.Infinity) {
      return Status.and(Status.OK, rhs);
    } else {
      // (Category::Normal, Category::Normal)
      let status = Status.OK;
      let r: StatusAnd<F>;
      const [a, aa, c, cc] = [self._0, self._1, rhs._0, rhs._1];
      let z = a;
      r = z.add_r(c, round);
      status = (status | r.status) as Status;
      z = r.value;
      if (!z.is_finite()) {
        if (!z.is_infinite()) {
          return Status.and(status, new DoubleFloat(z, F.ZERO));
        }
        status = Status.OK;
        const a_cmp_c = a.cmp_abs_normal(c);
        z = cc;
        r = z.add_r(aa, round);
        status = (status | r.status) as Status;
        z = r.value;
        if (a_cmp_c === 1) {
          // z = cc + aa + c + a;
          r = z.add_r(c, round);
          status = (status | r.status) as Status;
          z = r.value;
          r = z.add_r(a, round);
          status = (status | r.status) as Status;
          z = r.value;
        } else {
          // z = cc + aa + a + c;
          r = z.add_r(a, round);
          status = (status | r.status) as Status;
          z = r.value;
          r = z.add_r(c, round);
          status = (status | r.status) as Status;
          z = r.value;
        }
        if (!z.is_finite()) {
          return Status.and(status, new DoubleFloat(z, F.ZERO));
        }
        self._0 = z;
        let zz = aa;
        r = zz.add_r(cc, round);
        status = (status | r.status) as Status;
        zz = r.value;
        if (a_cmp_c === 1) {
          // self.1 = a - z + c + zz;
          self._1 = a;
          r = self._1.sub_r(z, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
          r = self._1.add_r(c, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
          r = self._1.add_r(zz, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
        } else {
          // self.1 = c - z + a + zz;
          self._1 = c;
          r = self._1.sub_r(z, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
          r = self._1.add_r(a, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
          r = self._1.add_r(zz, round);
          status = (status | r.status) as Status;
          self._1 = r.value;
        }
      } else {
        // q = a - z;
        let q = a;
        r = q.sub_r(z, round);
        status = (status | r.status) as Status;
        q = r.value;

        // zz = q + c + (a - (q + z)) + aa + cc;
        // Compute a - (q + z) as -((q + z) - a) to avoid temporary copies.
        let zz = q;
        r = zz.add_r(c, round);
        status = (status | r.status) as Status;
        zz = r.value;
        r = q.add_r(z, round);
        status = (status | r.status) as Status;
        q = r.value;
        r = q.sub_r(a, round);
        status = (status | r.status) as Status;
        q = r.value;
        q = q.neg();
        r = zz.add_r(q, round);
        status = (status | r.status) as Status;
        zz = r.value;
        r = zz.add_r(aa, round);
        status = (status | r.status) as Status;
        zz = r.value;
        r = zz.add_r(cc, round);
        status = (status | r.status) as Status;
        zz = r.value;
        if (zz.is_zero() && !zz.is_negative()) {
          return Status.and(Status.OK, new DoubleFloat(z, F.ZERO));
        }
        self._0 = z;
        r = self._0.add_r(zz, round);
        status = (status | r.status) as Status;
        self._0 = r.value;
        if (!self._0.is_finite()) {
          self._1 = F.ZERO;
          return Status.and(status, self);
        }
        self._1 = z;
        r = self._1.sub_r(self._0, round);
        status = (status | r.status) as Status;
        self._1 = r.value;
        r = self._1.add_r(zz, round);
        status = (status | r.status) as Status;
        self._1 = r.value;
      }
      return Status.and(status, self);
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:276 mul_r
  mul_r(rhs: DoubleFloat<F>, round: Round): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    const F = Self.F;
    const self = this.clone();
    // Interesting observation: For special categories, finding the lowest
    // common ancestor of the following layered graph gives the correct
    // return category:
    //
    //    NaN
    //   /   \
    // Zero  Inf
    //   \   /
    //   Normal
    //
    // e.g. NaN * NaN = NaN
    //      Zero * Inf = NaN
    //      Normal * Zero = Zero
    //      Normal * Inf = Inf
    const ca = self.category();
    const cb = rhs.category();
    if (ca === Category.NaN) {
      return Status.and(Status.OK, self);
    } else if (cb === Category.NaN) {
      return Status.and(Status.OK, rhs);
    } else if ((ca === Category.Zero && cb === Category.Infinity) || (ca === Category.Infinity && cb === Category.Zero)) {
      return Status.and(Status.OK, Self.NAN);
    } else if (ca === Category.Zero || ca === Category.Infinity) {
      return Status.and(Status.OK, self);
    } else if (cb === Category.Zero || cb === Category.Infinity) {
      return Status.and(Status.OK, rhs);
    } else {
      // (Category::Normal, Category::Normal)
      let status = Status.OK;
      let r: StatusAnd<F>;
      const [a, b, c, d] = [self._0, self._1, rhs._0, rhs._1];
      // t = a * c
      let t = a;
      r = t.mul_r(c, round);
      status = (status | r.status) as Status;
      t = r.value;
      if (!t.is_finite_non_zero()) {
        return Status.and(status, new DoubleFloat(t, F.ZERO));
      }

      // tau = fmsub(a, c, t), that is -fmadd(-a, c, t).
      let tau = a;
      r = tau.mul_add_r(c, t.neg(), round);
      status = (status | r.status) as Status;
      tau = r.value;
      // v = a * d
      let v = a;
      r = v.mul_r(d, round);
      status = (status | r.status) as Status;
      v = r.value;
      // w = b * c
      let w = b;
      r = w.mul_r(c, round);
      status = (status | r.status) as Status;
      w = r.value;
      r = v.add_r(w, round);
      status = (status | r.status) as Status;
      v = r.value;
      // tau += v + w
      r = tau.add_r(v, round);
      status = (status | r.status) as Status;
      tau = r.value;
      // u = t + tau
      let u = t;
      r = u.add_r(tau, round);
      status = (status | r.status) as Status;
      u = r.value;

      self._0 = u;
      if (!u.is_finite()) {
        self._1 = F.ZERO;
      } else {
        // self.1 = (t - u) + tau
        r = t.sub_r(u, round);
        status = (status | r.status) as Status;
        t = r.value;
        r = t.add_r(tau, round);
        status = (status | r.status) as Status;
        t = r.value;
        self._1 = t;
      }
      return Status.and(status, self);
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:342 mul_add_r
  mul_add_r(multiplicand: DoubleFloat<F>, addend: DoubleFloat<F>, round: Round): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(
      Self.fallback_from(this).mul_add_r(Self.fallback_from(multiplicand), Self.fallback_from(addend), round),
      (x) => Self.from(x),
    );
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:348 div_r
  div_r(rhs: DoubleFloat<F>, round: Round): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(Self.fallback_from(this).div_r(Self.fallback_from(rhs), round), (x) => Self.from(x));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:352 ieee_rem
  ieee_rem(rhs: DoubleFloat<F>): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(Self.fallback_from(this).ieee_rem(Self.fallback_from(rhs)), (x) => Self.from(x));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:356 c_fmod
  c_fmod(rhs: DoubleFloat<F>): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(Self.fallback_from(this).c_fmod(Self.fallback_from(rhs)), (x) => Self.from(x));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:360 round_to_integral
  round_to_integral(round: Round): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(Self.fallback_from(this).round_to_integral(round), (x) => Self.from(x));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:364 next_up
  next_up(): StatusAnd<DoubleFloat<F>> {
    const Self = this.Self();
    return StatusAnd_.map(Self.fallback_from(this).next_up(), (x) => Self.from(x));
  }

  // (from_bits, from_u128_r, from_str_r: on `DoubleFloatType`)

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:381 to_bits
  to_bits(): bigint {
    const F = this.Self().F;
    // PORT: `u128` shift (wrapping: the amount is masked like rustc's release build; `F::BITS` is 64 for `Double`).
    return BigInt.asUintN(128, this._0.to_bits() | (this._1.to_bits() << BigInt(F.BITS & 127)));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:385 to_u128_r
  to_u128_r(width: number, round: Round, is_exact: MutRef<boolean>): StatusAnd<bigint> {
    return this.Self().fallback_from(this).to_u128_r(width, round, is_exact);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:389 cmp_abs_normal
  cmp_abs_normal(rhs: DoubleFloat<F>): Ordering {
    const o = this._0.cmp_abs_normal(rhs._0);
    if (o !== 0) return o;
    const result = this._1.cmp_abs_normal(rhs._1);
    if (result !== 0) {
      const against = this._0.is_negative() !== this._1.is_negative();
      const rhs_against = rhs._0.is_negative() !== rhs._1.is_negative();
      const o2 = cmp_bool(!against, !rhs_against);
      if (o2 !== 0) return o2;
      return against ? reverse(result) : result;
    } else {
      return result;
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:404 bitwise_eq
  bitwise_eq(rhs: DoubleFloat<F>): boolean {
    return this._0.bitwise_eq(rhs._0) && this._1.bitwise_eq(rhs._1);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:408 is_negative
  is_negative(): boolean {
    return this._0.is_negative();
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:412 is_denormal
  is_denormal(): boolean {
    return (
      this.category() === Category.Normal &&
      (this._0.is_denormal() ||
        this._0.is_denormal() ||
        // (double)(Hi + Lo) == Hi defines a normal number.
        !this._0.eq(this._0.add(this._1).value))
    );
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:419 is_signaling
  is_signaling(): boolean {
    return this._0.is_signaling();
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:423 category
  category(): Category {
    return this._0.category();
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:427 is_integer
  is_integer(): boolean {
    return this._0.is_integer() && this._1.is_integer();
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:431 get_exact_inverse
  get_exact_inverse(): DoubleFloat<F> | undefined {
    const Self = this.Self();
    const r = Self.fallback_from(this).get_exact_inverse();
    return r === undefined ? undefined : Self.from(r);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:435 ilogb
  ilogb(): ExpInt {
    return this._0.ilogb();
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:439 scalbn_r
  scalbn_r(exp: ExpInt, round: Round): DoubleFloat<F> {
    return new DoubleFloat(this._0.scalbn_r(exp, round), this._1.scalbn_r(exp, round));
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:443 frexp_r
  frexp_r(exp: MutRef<ExpInt>, round: Round): DoubleFloat<F> {
    const a = this._0.frexp_r(exp, round);
    let b = this._1;
    if (this.category() === Category.Normal) {
      // PORT: `-*exp` is `i32` negation (wrapping in rustc's release build).
      b = b.scalbn_r(-exp.value | 0, round);
    }
    return new DoubleFloat(a, b);
  }
}

/** PORT: the `Float` methods `DoubleFloat` does not define itself (provided / `float_common_impls!`). */
type DoubleFloatProvided =
  | Exclude<(typeof FLOAT_PROVIDED_METHODS)[number], "is_integer">
  | (typeof FLOAT_COMMON_METHODS)[number];
export interface DoubleFloat<F extends DoubleFloatInner<F>> extends Pick<Float<DoubleFloat<F>>, DoubleFloatProvided> {}

// float_common_impls!(DoubleFloat<F>);
for (const k of FLOAT_PROVIDED_METHODS) {
  if (!Object.hasOwn(DoubleFloat.prototype, k)) {
    Object.defineProperty(DoubleFloat.prototype, k, { value: Float_provided[k], writable: true, configurable: true });
  }
}
for (const k of FLOAT_COMMON_METHODS) {
  Object.defineProperty(DoubleFloat.prototype, k, { value: float_common_impls[k], writable: true, configurable: true });
}

/** `#[derive(Debug)]`: `DoubleFloat(<F as Debug>, <F as Debug>)`. */
export function debug_DoubleFloat<F extends DoubleFloatInner<F>>(v: DoubleFloat<F>, f: Fmt): string {
  return debug_tuple(f, "DoubleFloat", [v._0.debug_fmt(), v._1.debug_fmt()]);
}

/**
 * PORT: the static side of `DoubleFloat<F>`: `impl Float for DoubleFloat<F>`'s associated consts and fns without
 * `self`, `Default` / `FromStr` (`float_common_impls!`), and the two `From` impls between `DoubleFloat<F>` and
 * `Fallback<F>`. One per `F`, made by `double_float_type(F)`.
 */
export class DoubleFloatType<F extends DoubleFloatInner<F>> implements FloatType<DoubleFloat<F>> {
  /** `FallbackS<F>` */
  readonly FallbackS: Semantics;
  /** `FallbackExtendedS<F>` */
  readonly FallbackExtendedS: Semantics;
  /** `Fallback::<F>::` */
  readonly Fallback: IeeeFloatType<Semantics>;
  /** `FallbackExtended::<F>::` */
  readonly FallbackExtended: IeeeFloatType<Semantics>;

  readonly BITS: number;
  readonly PRECISION: number;
  readonly MAX_EXP: ExpInt;
  readonly MIN_EXP: ExpInt;
  readonly ZERO: DoubleFloat<F>;
  readonly INFINITY: DoubleFloat<F>;
  // FIXME(eddyb) remove when qnan becomes const fn.
  readonly NAN: DoubleFloat<F>;
  readonly SMALLEST: DoubleFloat<F>;

  constructor(readonly F: FloatType<F>) {
    // These are legacy semantics for the Fallback, inaccurate implementation of
    // IBM double-double, if the accurate DoubleDouble doesn't handle the
    // operation. It's equivalent to having an IEEE number with consecutive 106
    // bits of mantissa and 11 bits of exponent.
    //
    // It's not equivalent to IBM double-double. For example, a legit IBM
    // double-double, 1 + epsilon:
    //
    //   1 + epsilon = 1 + (1 >> 1076)
    //
    // is not representable by a consecutive 106 bits of mantissa.
    //
    // Currently, these semantics are used in the following way:
    //
    //   DoubleDouble -> (Double, Double) ->
    //   DoubleDouble's Fallback -> IEEE operations
    //
    // FIXME: Implement all operations in DoubleDouble, and delete these
    // semantics.
    // FIXME(eddyb) This shouldn't need to be `pub`, it's only used in bounds.
    // impl<F: Float> ieee::Semantics for FallbackS<F>
    this.FallbackS = semantics("FallbackS", {
      // Forbid any conversion to/from bits.
      BITS: 0,
      EXP_BITS: 0,

      PRECISION: F.PRECISION * 2,
      MAX_EXP: F.MAX_EXP,
      MIN_EXP: F.MIN_EXP + F.PRECISION,
    });
    this.Fallback = ieee_float_type(this.FallbackS);

    // Convert number to F. To avoid spurious underflows, we re-
    // normalize against the F exponent range first, and only *then*
    // truncate the mantissa. The result of that second conversion
    // may be inexact, but should never underflow.
    // FIXME(eddyb) This shouldn't need to be `pub`, it's only used in bounds.
    // impl<F: Float> ieee::Semantics for FallbackExtendedS<F>
    this.FallbackExtendedS = semantics("FallbackExtendedS", {
      // Forbid any conversion to/from bits.
      BITS: 0,
      EXP_BITS: 0,

      PRECISION: this.Fallback.PRECISION,
      MAX_EXP: F.MAX_EXP,
      MIN_EXP: F.MIN_EXP,
    });
    this.FallbackExtended = ieee_float_type(this.FallbackExtendedS);

    this.BITS = F.BITS * 2;
    this.PRECISION = this.Fallback.PRECISION;
    this.MAX_EXP = this.Fallback.MAX_EXP;
    this.MIN_EXP = this.Fallback.MIN_EXP;

    this.ZERO = frozen(new DoubleFloat(F.ZERO, F.ZERO));

    this.INFINITY = frozen(new DoubleFloat(F.INFINITY, F.ZERO));

    this.NAN = frozen(new DoubleFloat(F.NAN, F.ZERO));

    this.SMALLEST = frozen(new DoubleFloat(F.SMALLEST, F.ZERO));
  }

  // impl<F: Float> From<Fallback<F>> for DoubleFloat<F>
  // where
  //     F: FloatConvert<FallbackExtended<F>>,
  //     FallbackExtended<F>: FloatConvert<F>,
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:75 from
  from(x: Fallback): DoubleFloat<F> {
    const F = this.F;
    let status: Status;
    const loses_info = { value: false };

    let r = x.convert(this.FallbackExtended, loses_info);
    status = r.status;
    const extended: FallbackExtended = r.value;
    assert_ok_exact(status, loses_info.value);

    const ra = extended.convert(F, loses_info);
    status = ra.status;
    const a = ra.value;
    assert_status_ok(Status.difference(status, Status.INEXACT));

    // If conversion was exact or resulted in a special case, we're done;
    // just set the second double to zero. Otherwise, re-convert back to
    // the extended format and compute the difference. This now should
    // convert exactly to double.
    let b: F;
    if (a.is_finite_non_zero() && loses_info.value) {
      r = a.convert(this.FallbackExtended, loses_info);
      status = r.status;
      const u: FallbackExtended = r.value;
      assert_ok_exact(status, loses_info.value);
      r = extended.sub(u);
      status = r.status;
      const v = r.value;
      assert_status_ok(status);
      const rv = v.convert(F, loses_info);
      status = rv.status;
      assert_ok_exact(status, loses_info.value);
      b = rv.value;
    } else {
      b = F.ZERO;
    }

    return new DoubleFloat(a, b);
  }

  // impl<F: FloatConvert<Self>> From<DoubleFloat<F>> for Fallback<F>
  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:106 from
  // PORT: `Fallback::from(x)`.
  fallback_from(x: DoubleFloat<F>): Fallback {
    const a_ = x._0;
    const b_ = x._1;
    let status: Status;
    const loses_info = { value: false };

    // Get the first F and convert to our format.
    let r = a_.convert(this.Fallback, loses_info);
    status = r.status;
    const a = r.value;
    assert_ok_exact(status, loses_info.value);

    // Unless we have a special case, add in second F.
    if (a.is_finite_non_zero()) {
      r = b_.convert(this.Fallback, loses_info);
      status = r.status;
      const b = r.value;
      assert_ok_exact(status, loses_info.value);

      return a.add(b).value;
    } else {
      return a;
    }
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:161 qnan
  qnan(payload: bigint | undefined): DoubleFloat<F> {
    return new DoubleFloat(this.F.qnan(payload), this.F.ZERO);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:165 snan
  snan(payload: bigint | undefined): DoubleFloat<F> {
    return new DoubleFloat(this.F.snan(payload), this.F.ZERO);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:169 largest
  largest(): DoubleFloat<F> {
    const F = this.F;
    const r = new DoubleFloat(F.largest(), F.largest());
    r._1 = r._1.scalbn(-(F.PRECISION + 1));
    const n = r._1.next_down();
    const status = n.status;
    r._1 = n.value;
    assert_status_ok(status);
    return r;
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:180 smallest_normalized
  smallest_normalized(): DoubleFloat<F> {
    const F = this.F;
    return new DoubleFloat(F.smallest_normalized().scalbn(F.PRECISION), F.ZERO);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:368 from_bits
  from_bits(input: bigint): DoubleFloat<F> {
    const F = this.F;
    // PORT: `u128` shifts (the amount masked as in rustc's release build; `F::BITS` is 64 for `Double`).
    const sh = BigInt(F.BITS & 127);
    const [a, b] = [input, input >> sh];
    const mask = BigInt.asUintN(128, (1n << sh) - 1n);
    return new DoubleFloat(F.from_bits(a & mask), F.from_bits(b & mask));
  }

  from_i128_r(input: bigint, round: Round): StatusAnd<DoubleFloat<F>> {
    return Float_provided.from_i128_r(this, input, round);
  }
  from_i128(input: bigint): StatusAnd<DoubleFloat<F>> {
    return Float_provided.from_i128(this, input);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:373 from_u128_r
  from_u128_r(input: bigint, round: Round): StatusAnd<DoubleFloat<F>> {
    return StatusAnd_.map(this.Fallback.from_u128_r(input, round), (x) => this.from(x));
  }

  from_u128(input: bigint): StatusAnd<DoubleFloat<F>> {
    return Float_provided.from_u128(this, input);
  }

  // crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/src/ppc.rs:377 from_str_r
  from_str_r(s: string, round: Round): Result<StatusAnd<DoubleFloat<F>>, ParseError> {
    const r = this.Fallback.from_str_r(s, round);
    if (r.$ === "Err") return r;
    return Ok(StatusAnd_.map(r._0, (x) => this.from(x)));
  }

  default(): DoubleFloat<F> {
    return float_common_impls.default(this);
  }
  from_str(s: string): Result<DoubleFloat<F>, ParseError> {
    return float_common_impls.from_str(this, s);
  }
}

/** A shared constant: frozen, so that no method can mutate it in place. */
function frozen<F extends DoubleFloatInner<F>>(x: DoubleFloat<F>): DoubleFloat<F> {
  return Object.freeze(x);
}

const TYPES = new WeakMap<object, unknown>();
/** The static side (`DoubleFloat::<F>::..`) of the double float type over `F`. */
export function double_float_type<F extends DoubleFloatInner<F>>(F: FloatType<F>): DoubleFloatType<F> {
  let t = TYPES.get(F);
  if (t === undefined) {
    t = new DoubleFloatType<F>(F);
    TYPES.set(F, t);
  }
  return t as DoubleFloatType<F>;
}

/// 128-bit floating point number comprised of two IEEE [`Double`](ieee::Double) values.
///
/// This is the "IBM Extended Double" format, described at
/// <https://www.ibm.com/docs/en/aix/7.3?topic=sepl-128-bit-long-double-floating-point-data-type>.
export type DoubleDouble = DoubleFloat<Double>;
export const DoubleDouble: DoubleFloatType<Double> = double_float_type<Double>(Double);
