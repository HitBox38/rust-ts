// rust-ts: LLVM's `APFloat` (llvm/include/llvm/ADT/APFloat.h, llvm/lib/Support/APFloat.cpp at the llvm-project commit the pin
// names) for the IR model's floating-point constants (lane llir-apfloat). The constant folds (fold.ts, ir.ts) and the printer
// (printer.ts) call this API by LLVM's names; each function carries the `// llvm:` marker of the APFloat function it stands for.
//
// PORT: the arithmetic is the vendored `rustc_apfloat` (src/vendor/rustc_apfloat, 0.2.3+llvm-462a31f5a5ab), itself a port of
// LLVM's APFloat.cpp. It is reused only where it is bit-exact with the pinned LLVM, which `apfloat.oracle.test.ts` checks
// against the oracle's own libLLVM.dylib: add/subtract/multiply/divide/mod, `convert`, `convertToInteger` (its status decides
// fptoui/fptosi poison), `convertFromAPInt`, `compare`, the decimal `toString` / `convertFromString` the AsmWriter's round trip
// uses, NaN payloads and signs, for half, bfloat, float, double, fp128 and x86_fp80. ppc_fp128 (LLVM's `DoubleAPFloat`, which
// the pinned LLVM changed after rustc_apfloat's base, and which rustc never makes constants of) keeps only what is plain bits:
// zero, all-ones, sign changes, the NaN and infinity tests and the printer's forced bitwise form; its arithmetic, conversions,
// comparisons and decimal `toString` stop with `unported("llir: ...")`. `isSignaling` is LLVM's own (below).
//
// PORT: an APFloat here is immutable. LLVM's mutating members (`add`, `convert`, `changeSign`, ...) return the new value
// alongside the status (`{ status, value }`); the folds use only the value, as ConstantFold.cpp ignores the status
// except in `convertToInteger`.
import { unported } from "../../std/panic.ts";
import { type Float, type FloatConvert, type FloatType, Round, Status } from "../../vendor/rustc_apfloat/lib.ts";
import { BFloat, Double, Half, Quad, Single, X87DoubleExtended } from "../../vendor/rustc_apfloat/ieee.ts";

/** `fltSemantics`, by the names of LLVM's accessors (`APFloat::IEEEhalf()`, ...). */
export type FltSemantics = "IEEEhalf" | "BFloat" | "IEEEsingle" | "IEEEdouble" | "x87DoubleExtended" | "IEEEquad" | "PPCDoubleDouble";

/** `APFloat::roundingMode` (only the two ConstantFold.cpp passes). */
export type RoundingMode = "rmNearestTiesToEven" | "rmTowardZero";

/** `APFloat::cmpResult`. */
export type CmpResult = "cmpLessThan" | "cmpEqual" | "cmpGreaterThan" | "cmpUnordered";

/** `APFloat::opStatus`, as rustc_apfloat's `Status` bits (the same values: opOK 0, opInvalidOp 1, ... opInexact 0x10). */
export type OpStatus = Status;
export const opOK = Status.OK;
export const opInvalidOp = Status.INVALID_OP;

// PORT: one value type for the seven semantics. rustc_apfloat's float types are generic over `Self`; LLVM picks the layout at
// run time (`APFLOAT_DISPATCH_ON_SEMANTICS`), as this module does, so the values are held through this one structural type.
type AF = Float<AF> & FloatConvert;

/** The rustc_apfloat type of each IEEE-layout semantics (`usesLayout<IEEEFloat>`); ppc_fp128 has none here. */
function ieeeType(sem: FltSemantics): FloatType<AF> | undefined {
  switch (sem) {
    case "IEEEhalf":
      return Half as unknown as FloatType<AF>;
    case "BFloat":
      return BFloat as unknown as FloatType<AF>;
    case "IEEEsingle":
      return Single as unknown as FloatType<AF>;
    case "IEEEdouble":
      return Double as unknown as FloatType<AF>;
    case "x87DoubleExtended":
      return X87DoubleExtended as unknown as FloatType<AF>;
    case "IEEEquad":
      return Quad as unknown as FloatType<AF>;
    case "PPCDoubleDouble":
      return undefined;
  }
}

/** `fltSemantics::sizeInBits` (`APFloat::getSizeInBits`). */
export function semanticsSizeInBits(sem: FltSemantics): number {
  switch (sem) {
    case "IEEEhalf":
    case "BFloat":
      return 16;
    case "IEEEsingle":
      return 32;
    case "IEEEdouble":
      return 64;
    case "x87DoubleExtended":
      return 80;
    case "IEEEquad":
    case "PPCDoubleDouble":
      return 128;
  }
}

const rm = (m: RoundingMode): Round => (m === "rmNearestTiesToEven" ? Round.NearestTiesToEven : Round.TowardZero);

const ppcStop = (what: string): never => unported(`llir: APFloat ${what} of a ppc_fp128 (DoubleAPFloat; not bit-checked against the pinned LLVM)`);

export class APFloat {
  private constructor(
    readonly semantics: FltSemantics,
    /** The IEEE-layout value (undefined for ppc_fp128, which is held by its bits). */
    private readonly v: AF | undefined,
    /** The bit pattern, for ppc_fp128 only. */
    private readonly ppcBits: bigint,
  ) {}

  // llvm: llvm/lib/Support/APFloat.cpp:4030 IEEEFloat::IEEEFloat
  /** `APFloat(const fltSemantics &, const APInt &)`: the value of a bit pattern (`initFromAPInt`). x86_fp80 encodings without
   * the explicit integer bit read as NaN (unnormals, pseudo-infinities) or as denormals, as `initFromF80LongDoubleAPInt` does,
   * so `bitcastToAPInt` of the result may differ from `bits`. */
  static fromAPInt(sem: FltSemantics, bits: bigint): APFloat {
    const T = ieeeType(sem);
    if (T === undefined) return new APFloat(sem, undefined, BigInt.asUintN(128, bits));
    return new APFloat(sem, T.from_bits(BigInt.asUintN(semanticsSizeInBits(sem), bits)), 0n);
  }

  // llvm: llvm/lib/Support/APFloat.cpp:4038 IEEEFloat::IEEEFloat
  /** `explicit APFloat(double d)`: a JS number is an IEEE double, bit for bit. */
  static fromDouble(d: number): APFloat {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, d);
    return APFloat.fromAPInt("IEEEdouble", dv.getBigUint64(0));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1165 getZero
  static getZero(sem: FltSemantics, negative = false): APFloat {
    // Every semantics' zero is all bits clear but the sign (`makeZero`; a DoubleAPFloat zeroes both halves).
    const signBit = sem === "PPCDoubleDouble" ? 1n << 63n : 1n << BigInt(semanticsSizeInBits(sem) - 1);
    return APFloat.fromAPInt(sem, negative ? signBit : 0n);
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1195 getNaN
  /** `getNaN(Sem, Negative, payload = 0)`: `getQNaN` with no payload. */
  static getNaN(sem: FltSemantics, negative = false): APFloat {
    return APFloat.getQNaN(sem, negative);
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1206 getQNaN
  /** `getQNaN(Sem, Negative, nullptr)`: `makeNaN(false, Negative)`, the quiet bit alone (and x87's integer bit). */
  static getQNaN(sem: FltSemantics, negative = false): APFloat {
    const T = ieeeType(sem);
    if (T === undefined) return ppcStop("getQNaN");
    const nan = T.qnan(undefined);
    return new APFloat(sem, negative ? nan.neg() : nan, 0n);
  }

  // llvm: llvm/lib/Support/APFloat.cpp:5946 APFloat::getAllOnesValue
  static getAllOnesValue(sem: FltSemantics): APFloat {
    return APFloat.fromAPInt(sem, (1n << BigInt(semanticsSizeInBits(sem))) - 1n);
  }

  // llvm: llvm/lib/Support/APFloat.cpp:5842 APFloat::APFloat
  /** `APFloat(const fltSemantics &, StringRef)`: `convertFromString(S, rmNearestTiesToEven)`, which must succeed. */
  static fromString(sem: FltSemantics, s: string): APFloat {
    const T = ieeeType(sem);
    if (T === undefined) return ppcStop("convertFromString");
    const r = T.from_str_r(s, Round.NearestTiesToEven);
    if (r.$ === "Err") throw new Error(`llvm: Invalid floating point representation (${s})`);
    return new APFloat(sem, r._0.value, 0n);
  }

  private get ieee(): AF {
    return this.v!;
  }
  private wrap(r: { status: Status; value: AF }): { status: OpStatus; value: APFloat } {
    return { status: r.status, value: new APFloat(this.semantics, r.value, 0n) };
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1267 add
  add(rhs: APFloat, mode: RoundingMode): { status: OpStatus; value: APFloat } {
    if (this.v === undefined) return ppcStop("add");
    return this.wrap(this.ieee.add_r(rhs.ieee, rm(mode)));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1276 subtract
  subtract(rhs: APFloat, mode: RoundingMode): { status: OpStatus; value: APFloat } {
    if (this.v === undefined) return ppcStop("subtract");
    return this.wrap(this.ieee.sub_r(rhs.ieee, rm(mode)));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1285 multiply
  multiply(rhs: APFloat, mode: RoundingMode): { status: OpStatus; value: APFloat } {
    if (this.v === undefined) return ppcStop("multiply");
    return this.wrap(this.ieee.mul_r(rhs.ieee, rm(mode)));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1294 divide
  divide(rhs: APFloat, mode: RoundingMode): { status: OpStatus; value: APFloat } {
    if (this.v === undefined) return ppcStop("divide");
    return this.wrap(this.ieee.div_r(rhs.ieee, rm(mode)));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1312 mod
  /** `mod`: C's fmod, the remainder truncated toward zero (rustc_apfloat's `c_fmod`, "C fmod, or llvm frem"). */
  mod(rhs: APFloat): { status: OpStatus; value: APFloat } {
    if (this.v === undefined) return ppcStop("mod");
    return this.wrap(this.ieee.c_fmod(rhs.ieee));
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1383 changeSign
  /** `changeSign`: the sign flipped, nothing else (a NaN keeps its payload; a DoubleAPFloat flips both halves). */
  changeSign(): APFloat {
    if (this.v === undefined) return new APFloat(this.semantics, undefined, this.ppcBits ^ ((1n << 63n) | (1n << 127n)));
    return new APFloat(this.semantics, this.ieee.neg(), 0n);
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1508 compare
  /** IEEE comparison: NaNs compare unordered, `0 == -0`. */
  compare(rhs: APFloat): CmpResult {
    if (this.v === undefined) return ppcStop("compare");
    const o = this.ieee.partial_cmp(rhs.ieee);
    return o === undefined ? "cmpUnordered" : o < 0 ? "cmpLessThan" : o > 0 ? "cmpGreaterThan" : "cmpEqual";
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1484 operator==
  equals(rhs: APFloat): boolean {
    return this.compare(rhs) === "cmpEqual";
  }

  // llvm: llvm/lib/Support/APFloat.cpp:5920 APFloat::convert
  /** `convert(ToSemantics, RM, &losesInfo)`. */
  convert(to: FltSemantics, mode: RoundingMode): { status: OpStatus; value: APFloat; losesInfo: boolean } {
    if (this.semantics === to) return { status: opOK, value: this, losesInfo: false };
    const T = ieeeType(to);
    if (this.v === undefined || T === undefined) return ppcStop("convert");
    const losesInfo = { value: false };
    const r = this.ieee.convert_r(T, rm(mode), losesInfo);
    return { status: r.status, value: new APFloat(to, r.value, 0n), losesInfo: losesInfo.value };
  }

  // llvm: llvm/lib/Support/APFloat.cpp:5967 APFloat::convertToInteger
  /** `convertToInteger(APSInt &Result, RM, &IsExact)` of a result `width` bits wide: the integer as unsigned bits, masked. */
  convertToInteger(width: number, isSigned: boolean, mode: RoundingMode): { status: OpStatus; value: bigint } {
    if (this.v === undefined) return ppcStop("convertToInteger");
    // PORT: rustc_apfloat converts to at most 128 bits; rustc's integers are no wider.
    if (width > 128) return unported(`llir: APFloat::convertToInteger to i${width} (wider than rustc_apfloat's 128 bits)`);
    const isExact = { value: false };
    const r = isSigned ? this.ieee.to_i128_r(width, rm(mode), isExact) : this.ieee.to_u128_r(width, rm(mode), isExact);
    return { status: r.status, value: BigInt.asUintN(width, r.value) };
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1433 convertFromAPInt
  /** `APFloat(Sem, APInt::getZero(..)).convertFromAPInt(Input, IsSigned, RM)`: `input` is the integer's bits, `width` wide. */
  static convertFromAPInt(sem: FltSemantics, input: bigint, width: number, isSigned: boolean, mode: RoundingMode): { status: OpStatus; value: APFloat } {
    const T = ieeeType(sem);
    if (T === undefined) return ppcStop("convertFromAPInt");
    // PORT: rustc_apfloat converts from at most 128 bits; rustc's integers are no wider.
    if (width > 128) return unported(`llir: APFloat::convertFromAPInt of an i${width} (wider than rustc_apfloat's 128 bits)`);
    const r = isSigned ? T.from_i128_r(BigInt.asIntN(width, input), rm(mode)) : T.from_u128_r(BigInt.asUintN(width, input), rm(mode));
    return { status: r.status, value: new APFloat(sem, r.value, 0n) };
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1457 bitcastToAPInt
  bitcastToAPInt(): bigint {
    if (this.v === undefined) return this.ppcBits;
    return this.ieee.to_bits();
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1530 bitwiseIsEqual
  bitwiseIsEqual(rhs: APFloat): boolean {
    return this.semantics === rhs.semantics && this.bitcastToAPInt() === rhs.bitcastToAPInt();
  }

  /** The high-order double of a ppc_fp128 (`Floats[0]`, the low 64 bits of its APInt), which LLVM's predicates ask. */
  private ppcHi(): APFloat {
    return APFloat.fromAPInt("IEEEdouble", this.ppcBits & ((1n << 64n) - 1n));
  }

  /** `isZero` (a DoubleAPFloat asks its first double). */
  isZero(): boolean {
    return this.v === undefined ? this.ppcHi().isZero() : this.ieee.is_zero();
  }
  /** `isNegative`. */
  isNegative(): boolean {
    return this.v === undefined ? this.ppcHi().isNegative() : this.ieee.is_negative();
  }
  /** `isNaN`. */
  isNaN(): boolean {
    return this.v === undefined ? this.ppcHi().isNaN() : this.ieee.is_nan();
  }
  /** `isInfinity`. */
  isInfinity(): boolean {
    return this.v === undefined ? this.ppcHi().isInfinity() : this.ieee.is_infinite();
  }

  // llvm: llvm/lib/Support/APFloat.cpp:4392 IEEEFloat::isSignaling
  /** A NaN whose first trailing significand bit (bit `precision - 2` of the stored significand) is clear. PORT: not
   * rustc_apfloat's `is_signaling`, which disagrees for x86_fp80 unnormals (an exponent with the explicit integer bit
   * clear, a NaN to LLVM): the oracle test caught it. The payload is the stored significand, so its top bit is that bit. */
  isSignaling(): boolean {
    if (this.v === undefined) return this.ppcHi().isSignaling(); // APFloat::isSignaling: `getIEEE()`, the first double.
    if (!this.isNaN()) return false;
    // (No semantics here is NanOnly or FiniteOnly.) IEEE-754R 2008 6.2.1: A signaling NaN bit string should be encoded with
    // the first bit of the trailing significand being 0.
    const p = this.getNaNPayload();
    return ((p.value >> BigInt(p.width - 1)) & 1n) === 0n;
  }

  // llvm: llvm/lib/Support/APFloat.cpp:4541 IEEEFloat::getNaNPayload
  /** `getNaNPayload` of a NaN: the significand without the (maybe implied) integer bit, `precision - 1` bits wide. */
  getNaNPayload(): { value: bigint; width: number } {
    if (this.v === undefined) return this.ppcHi().getNaNPayload(); // DoubleAPFloat::getNaNPayload: `Floats[0]`'s.
    // The stored significand of a NaN is its encoding's significand field: the trailing field of the interchange formats,
    // the explicit 64-bit field of x86_fp80 (`initFromF80LongDoubleAPInt`), whose integer bit the 63-bit payload drops.
    const width = this.ieee.Self().PRECISION - 1;
    return { value: this.bitcastToAPInt() & ((1n << BigInt(width)) - 1n), width };
  }

  // llvm: llvm/include/llvm/ADT/APFloat.h:1602 toString
  /** `toString(Str, FormatPrecision, FormatMaxPadding, TruncateZero)`. A DoubleAPFloat prints through the legacy semantics
   * (DoubleAPFloat::toString), which rustc_apfloat's DoubleDouble `Display` does too, but only an IEEE value is reused here. */
  toString(formatPrecision: number, formatMaxPadding: number, truncateZero: boolean): string {
    if (this.v === undefined) return ppcStop("toString");
    // rustc_apfloat's `Display`: precision = FormatPrecision (0 = "enough digits", its `None`), width = FormatMaxPadding,
    // `#` = !TruncateZero.
    return this.ieee.fmt({ precision: formatPrecision === 0 ? undefined : formatPrecision, width: formatMaxPadding, alternate: !truncateZero });
  }
}

// llvm: llvm/include/llvm/ADT/APFloat.h:1709 neg
/** `neg(X)`: the negated value. */
export const neg = (x: APFloat): APFloat => x.changeSign();
