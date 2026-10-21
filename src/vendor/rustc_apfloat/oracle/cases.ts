// Differential test cases for apfloat.oracle.test.ts (not a port): input generation and the TS side of every op of
// apfloat_oracle.rs. `bun src/vendor/rustc_apfloat/oracle/cases.ts` times the TS side per op.
import {
  BFloat,
  Double,
  Float8E4M3FN,
  Float8E5M2,
  Half,
  type IeeeFloat,
  type IeeeFloatType,
  Quad,
  type Semantics,
  Single,
  X87DoubleExtended,
} from "../ieee.ts";
import { type Round, type Status, type StatusAnd, debug_Status, debug_StatusAnd } from "../lib.ts";
import { Panic } from "../../../std/panic.ts";

const PLAIN = { alternate: false };

type T = IeeeFloatType<Semantics>;
type F = IeeeFloat<Semantics>;
export const FORMATS: Record<string, T> = {
  h: Half,
  s: Single,
  d: Double,
  q: Quad,
  b: BFloat,
  x: X87DoubleExtended,
  e5: Float8E5M2,
  e4: Float8E4M3FN,
} as unknown as Record<string, T>;
const ROUNDS: Record<string, Round> = {
  E: "NearestTiesToEven",
  P: "TowardPositive",
  N: "TowardNegative",
  Z: "TowardZero",
  A: "NearestTiesToAway",
};

// ---- the TS side of every op (mirrors oracle/apfloat_oracle.rs `run`) ----

const hex = (x: bigint) => x.toString(16);
const sa = (r: StatusAnd<F>) => `${r.status} ${hex(r.value.to_bits())}`;
const bit = (x: boolean) => (x ? "1" : "0");
const ord = (o: -1 | 0 | 1 | undefined) => (o === undefined ? "u" : o === -1 ? "l" : o === 0 ? "e" : "g");
function unhex(s: string): string {
  if (s === "_") return "";
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(b);
}

export function run(Fm: T, op: string, a: string[]): string {
  const f = (i: number) => Fm.from_bits(BigInt("0x" + a[i]!));
  const r = () => ROUNDS[a[0]!]!;
  switch (op) {
    case "add":
      return sa(f(1).add_r(f(2), r()));
    case "sub":
      return sa(f(1).sub_r(f(2), r()));
    case "mul":
      return sa(f(1).mul_r(f(2), r()));
    case "div":
      return sa(f(1).div_r(f(2), r()));
    case "fma":
      return sa(f(1).mul_add_r(f(2), f(3), r()));
    case "rem":
      return sa(f(0).ieee_rem(f(1)));
    case "mod":
      return sa(f(0).c_fmod(f(1)));
    case "rti":
      return sa(f(1).round_to_integral(r()));
    case "nu":
      return sa(f(0).next_up());
    case "nd":
      return sa(f(0).next_down());
    case "cvt": {
      const loses = { value: false };
      const x = f(2).convert_r(FORMATS[a[0]!]!, ROUNDS[a[1]!]!, loses);
      return `${sa(x)} ${bit(loses.value)}`;
    }
    case "toi":
    case "tou": {
      const exact = { value: false };
      const w = Number(a[0]);
      const x = op === "toi" ? f(2).to_i128_r(w, ROUNDS[a[1]!]!, exact) : f(2).to_u128_r(w, ROUNDS[a[1]!]!, exact);
      return `${x.status} ${x.value} ${bit(exact.value)}`;
    }
    case "fu":
      return sa(Fm.from_u128_r(BigInt("0x" + a[1]!), r()));
    case "fi":
      return sa(Fm.from_i128_r(BigInt(a[1]!), r()));
    case "fs": {
      const x = Fm.from_str_r(unhex(a[1]!), r());
      return x.$ === "Ok" ? `ok ${sa(x._0)}` : `err ${x._0._0}`;
    }
    case "disp": {
      const x = f(3);
      return x.fmt({
        width: a[0] === "-" ? undefined : Number(a[0]),
        precision: a[1] === "-" ? undefined : Number(a[1]),
        alternate: a[2] === "1",
      });
    }
    case "dbg":
      return f(0).debug_fmt();
    case "scal":
      return hex(f(2).scalbn_r(Number(a[1]), r()).to_bits());
    case "frexp": {
      const e = { value: 0 };
      const x = f(1).frexp_r(e, r());
      return `${e.value} ${hex(x.to_bits())}`;
    }
    case "ilogb":
      return String(f(0).ilogb());
    case "nan": {
      const p = a[1] === "-" ? undefined : BigInt("0x" + a[1]!);
      return hex((a[0] === "s" ? Fm.snan(p) : Fm.qnan(p)).to_bits());
    }
    case "misc": {
      const x = f(0);
      const y = f(1);
      const inv = x.get_exact_inverse();
      return [
        ord(x.partial_cmp(y)),
        bit(x.eq(y)),
        bit(x.bitwise_eq(y)),
        hex(x.min(y).to_bits()),
        hex(x.max(y).to_bits()),
        hex(x.minimum(y).to_bits()),
        hex(x.maximum(y).to_bits()),
        hex(x.abs().to_bits()),
        hex(x.copy_sign(y).to_bits()),
        [
          x.is_negative(),
          x.is_normal(),
          x.is_finite(),
          x.is_zero(),
          x.is_denormal(),
          x.is_infinite(),
          x.is_nan(),
          x.is_signaling(),
          x.is_non_zero(),
          x.is_finite_non_zero(),
          x.is_pos_zero(),
          x.is_neg_zero(),
          x.is_pos_infinity(),
          x.is_neg_infinity(),
          x.is_smallest(),
          x.is_smallest_normalized(),
          x.is_largest(),
          x.is_integer(),
          x.neg().to_bits() === x.to_bits(),
        ]
          .map(bit)
          .join(""),
        x.category(),
        inv === undefined ? "-" : hex(inv.to_bits()),
      ].join(" ");
    }
    case "consts":
      return [
        Fm.BITS,
        Fm.PRECISION,
        Fm.MAX_EXP,
        Fm.MIN_EXP,
        hex(Fm.ZERO.to_bits()),
        hex(Fm.INFINITY.to_bits()),
        hex(Fm.NAN.to_bits()),
        hex(Fm.largest().to_bits()),
        hex(Fm.SMALLEST.to_bits()),
        hex(Fm.smallest_normalized().to_bits()),
      ].join(" ");
    case "status":
      return `${debug_Status(Number.parseInt(a[0]!, 16) as Status, PLAIN)} ${debug_StatusAnd({ status: 0 as Status, value: 1 }, PLAIN, (v) => String(v))}`;
  }
  throw new Error(`op ${op}`);
}

// ---- input generation ----

let seed = 0x9e3779b9;
function rnd32(): number {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed;
}
const rint = (n: number) => rnd32() % n;
const pick = <X>(xs: readonly X[]): X => xs[rint(xs.length)]!;
function rbig(bits: number): bigint {
  let x = 0n;
  for (let i = 0; i < bits; i += 32) x = (x << 32n) | BigInt(rnd32());
  return x & ((1n << BigInt(bits)) - 1n);
}

/** Layout of the interchange format: [mantissa field width, exponent field width]. */
function layout(Fm: T): [number, number] {
  return [Fm.BITS - 1 - Fm.S.EXP_BITS, Fm.S.EXP_BITS];
}
function pack(Fm: T, sign: number, e: bigint, m: bigint): bigint {
  const [mb, eb] = layout(Fm);
  return (BigInt(sign) << BigInt(Fm.BITS - 1)) | ((e & ((1n << BigInt(eb)) - 1n)) << BigInt(mb)) | (m & ((1n << BigInt(mb)) - 1n));
}
const EDGES = new Map<T, bigint[]>();
function edges(Fm: T): bigint[] {
  let v = EDGES.get(Fm);
  if (v) return v;
  const [mb, eb] = layout(Fm);
  const emax = (1n << BigInt(eb)) - 1n;
  const bias = emax >> 1n;
  const mall = (1n << BigInt(mb)) - 1n;
  const mhalf = 1n << BigInt(mb - 1);
  const ms = [0n, 1n, 2n, 3n, mhalf, mhalf + 1n, mhalf - 1n, mall - 1n, mall, mhalf >> 1n, (mhalf >> 1n) + 1n];
  const es = [0n, 1n, 2n, bias - 1n, bias, bias + 1n, bias + 2n, emax - 2n, emax - 1n, emax];
  v = [];
  for (const s of [0, 1]) for (const e of es) for (const m of ms) v.push(pack(Fm, s, e, m));
  if (Fm === (X87DoubleExtended as unknown as T)) {
    // explicit integer bit: the same with the integer bit cleared / set
    const ib = 1n << 63n;
    v = v.flatMap((x) => [x, x ^ ib]);
  }
  for (const x of [Fm.ZERO, Fm.INFINITY, Fm.NAN, Fm.largest(), Fm.SMALLEST, Fm.smallest_normalized(), Fm.snan(undefined), Fm.snan(1n), Fm.qnan(5n)]) {
    v.push(x.to_bits(), x.neg().to_bits());
  }
  for (const n of [1n, 2n, 3n, 10n, 100n]) v.push(Fm.from_u128(n).value.to_bits(), Fm.from_u128(n).value.neg().to_bits());
  EDGES.set(Fm, v);
  return v;
}
/** A value in a moderate exponent range (for ops whose cost grows with exponent differences). */
function moderate(Fm: T, span: number): bigint {
  const [mb, eb] = layout(Fm);
  const bias = ((1n << BigInt(eb)) - 1n) >> 1n;
  let m = rbig(mb);
  if (Fm === (X87DoubleExtended as unknown as T) && rint(8) !== 0) m |= 1n << 63n;
  return pack(Fm, rint(2), bias + BigInt(rint(2 * span + 1) - span), m);
}
function value(Fm: T, span = 0): bigint {
  const k = rint(10);
  if (k < 3) return pick(edges(Fm));
  if (k < 6 || span > 0) return moderate(Fm, span > 0 ? span : 40);
  return rbig(Fm.BITS);
}
/** A second operand close to `a` (cancellation, ties, equal exponents). */
function near(Fm: T, a: bigint): bigint {
  const k = rint(4);
  if (k === 0) return a ^ (1n << BigInt(Fm.BITS - 1));
  if (k === 1) return a ^ BigInt(1 + rint(7));
  if (k === 2) return a ^ (1n << BigInt(rint(Fm.BITS - 1)));
  return a;
}
const R = () => pick(Object.keys(ROUNDS));
function str_hex(s: string): string {
  if (s === "") return "_";
  return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function digits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String(rint(10));
  return s;
}
function dec_string(): string {
  let s = pick(["", "", "-", "+"]);
  const lead = rint(5) === 0 ? "0".repeat(rint(4)) : "";
  s += lead + digits(rint(4) === 0 ? 1 + rint(60) : 1 + rint(20));
  if (rint(2) === 0) s += "." + digits(rint(25));
  if (rint(3) !== 0) {
    s += pick(["e", "E"]) + pick(["", "-", "+"]);
    const k = rint(10);
    s += k === 0 ? digits(1 + rint(12)) : k < 3 ? String(rint(5000)) : k < 4 ? "" : String(rint(400));
  }
  return s;
}
function hex_string(): string {
  let s = pick(["", "-", "+"]) + pick(["0x", "0X"]);
  s += rbig(4 * (1 + rint(36))).toString(16);
  if (rint(2) === 0) s += "." + rbig(4 * (1 + rint(10))).toString(16);
  if (rint(10) !== 0) s += pick(["p", "P"]) + pick(["", "-", "+"]) + String(rint(rint(5) === 0 ? 20000 : 300));
  return s;
}
const SPECIAL_STRINGS = [
  "inf", "-inf", "+inf", "Inf", "-Inf", "+Inf", "INFINITY", "-INFINITY", "+INFINITY", "infinity", "nan", "-nan", "+nan",
  "NaN", "-NaN", "snan", "sNaN", "-snan", "SNaN", "Snan", "nan(123)", "-nan(123)", "nan(0x1f)", "nan(0X1F)", "nan(017)",
  "nan(0)", "nan(00)", "nan()", "nan(", "nan)", "nan(12", "snan(0x)", "snan(0x1)", "snan(0)", "nan123", "nan0x7",
  "nan(+5)", "nan(-5)", "nan(340282366920938463463374607431768211455)", "nan(340282366920938463463374607431768211456)",
  "nan(0xfffffffffffffffffffffffffffffffff)", "nanx", "NAN", "", "-", "+", ".", "..", "1..2", "1.2.3", "1e", "1e+", "1e-",
  "e5", ".e5", "1.e5", ".5", "5.", "-.5e-1", "1a", "1.5e5x", "0x", "0x1", "0x1p", "0x.p1", "0xp1", "0x1.p", "0x1.8p1",
  "0x1p+", "0x1p-1x", "0X.8P0", "0x0p0", "0x0.0p99", "-0x0p0", "0x1.fffffffffffffp1023", "00", "-0", "+0", "0e99999999999",
  "0.000e-99999999999", "1e99999999999", "1e-99999999999", "١", "1١", "é", "1e١", "1€", "0x1p١",
  "4.9406564584124654e-324", "2.4703282292062327e-324", "2.4703282292062328e-324", "1.7976931348623157e308",
  "1.7976931348623158e308", "1.7976931348623159e308", "6.103515625e-05", "65504", "65520", "65519.99", "3.4028235e38",
  "3.4028236e38", "1.401298464324817e-45", "7.006492321624085e-46", "7.006492321624086e-46", "0.1", "0.2", "0.3",
  "123456789012345678901234567890", "1" + "0".repeat(400), "0." + "0".repeat(400) + "1",
];

export function gen(): string[] {
  const lines: string[] = [];
  for (const [k, Fm] of Object.entries(FORMATS)) {
    const big = k === "q" || k === "x";
    lines.push(`${k} consts`);
    const N = 1500;
    for (const op of ["add", "sub", "mul", "div"]) {
      for (let i = 0; i < N; i++) {
        const a = value(Fm);
        const b = rint(3) === 0 ? near(Fm, a) : value(Fm);
        lines.push(`${k} ${op} ${R()} ${hex(a)} ${hex(b)}`);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = value(Fm);
      const b = value(Fm);
      const p = Fm.from_bits(a).mul(Fm.from_bits(b)).value.to_bits();
      const c = rint(3) === 0 ? near(Fm, p) : value(Fm);
      lines.push(`${k} fma ${R()} ${hex(a)} ${hex(b)} ${hex(c)}`);
    }
    for (const op of ["rem", "mod"]) {
      for (let i = 0; i < (big ? 300 : 1000); i++) {
        const span = big ? 60 : 0;
        lines.push(`${k} ${op} ${hex(value(Fm, span))} ${hex(value(Fm, span))}`);
      }
    }
    for (let i = 0; i < 1000; i++) lines.push(`${k} rti ${R()} ${hex(value(Fm))}`);
    for (let i = 0; i < 1000; i++) lines.push(`${k} ${pick(["nu", "nd"])} ${hex(value(Fm))}`);
    for (const t of Object.keys(FORMATS)) {
      for (let i = 0; i < 300; i++) lines.push(`${k} cvt ${t} ${R()} ${hex(value(Fm))}`);
    }
    for (const op of ["toi", "tou"]) {
      for (let i = 0; i < 1000; i++) {
        const w = pick([2, 3, 8, 16, 32, 64, 127, 128, 2 + rint(127)]);
        lines.push(`${k} ${op} ${w} ${R()} ${hex(value(Fm))}`);
      }
    }
    for (let i = 0; i < 1000; i++) {
      const v = rint(3) === 0 ? BigInt(rint(1 << 20)) : rbig(1 + rint(128));
      lines.push(`${k} fu ${R()} ${hex(v)}`);
      const s = rbig(1 + rint(127));
      lines.push(`${k} fi ${R()} ${rint(2) === 0 ? "-" : ""}${s}`);
    }
    lines.push(`${k} fi E ${-(1n << 127n)}`);
    for (const s of SPECIAL_STRINGS) for (const r of Object.keys(ROUNDS)) lines.push(`${k} fs ${r} ${str_hex(s)}`);
    for (let i = 0; i < 1500; i++) lines.push(`${k} fs ${R()} ${str_hex(dec_string())}`);
    for (let i = 0; i < 400; i++) lines.push(`${k} fs ${R()} ${str_hex(hex_string())}`);
    // Decimal strings at (and one digit off) the midpoint of two adjacent values: exact decimal expansions
    // printed by Display of the midpoint in a wider format.
    if (k !== "q" && k !== "x") {
      for (let i = 0; i < 400; i++) {
        const a = Fm.from_bits(moderate(Fm, 30)).abs();
        const b = a.next_up().value;
        if (!b.is_finite()) continue;
        const loses = { value: false };
        const qa = a.convert(Quad, loses).value;
        const qb = b.convert(Quad, loses).value;
        const mid = qa.add(qb).value.scalbn(-1);
        let s = mid.fmt({ width: 0, precision: 3000 });
        if (rint(3) === 0) {
          const m = /^(\d)\.(\d*)E/.exec(s);
          if (m && m[2]!.length > 0) {
            const last = Number(s[m[0].length - 2]);
            s = s.slice(0, m[0].length - 2) + String((last + pick([1, 9])) % 10) + s.slice(m[0].length - 1);
          }
        }
        lines.push(`${k} fs ${R()} ${str_hex(s)}`);
      }
    }
    for (let i = 0; i < 1200; i++) {
      const W = pick(["-", "-", "0", "1", "2", "3", "5", "10", "40"]);
      const P = pick(["-", "-", "0", "1", "2", "5", "10", "17", "40", "60"]);
      lines.push(`${k} disp ${W} ${P} ${rint(3) === 0 ? 1 : 0} ${hex(big ? value(Fm, 300) : value(Fm))}`);
    }
    if (big) for (const x of edges(Fm)) lines.push(`${k} disp - - 0 ${hex(x)}`);
    for (let i = 0; i < 500; i++) lines.push(`${k} dbg ${hex(big ? value(Fm, 300) : value(Fm))}`);
    for (let i = 0; i < 1000; i++) {
      const e = pick([rint(2 * Fm.MAX_EXP + 400) - Fm.MAX_EXP - 200, rint(80) - 40, 2147483647, -2147483648, 2147483000, -2147483000]);
      lines.push(`${k} scal ${R()} ${e} ${hex(value(Fm))}`);
    }
    for (let i = 0; i < 500; i++) lines.push(`${k} frexp ${R()} ${hex(value(Fm))}`);
    for (let i = 0; i < 500; i++) lines.push(`${k} ilogb ${hex(value(Fm))}`);
    for (let i = 0; i < 200; i++) {
      const p = rint(4) === 0 ? "-" : hex(rint(2) === 0 ? BigInt(rint(16)) : rbig(128));
      lines.push(`${k} nan ${pick(["s", "q"])} ${p}`);
    }
    for (let i = 0; i < 1000; i++) {
      const a = value(Fm);
      lines.push(`${k} misc ${hex(a)} ${hex(rint(3) === 0 ? near(Fm, a) : value(Fm))}`);
    }
  }
  for (const s of [0, 1, 2, 4, 8, 0x10, 0x11, 0x1f, 0x20, 0xff]) lines.push(`d status ${s.toString(16)}`);
  return lines;
}


/** The TS result line of one input line (`PANIC` if the port panics). */
export function run_line(line: string): string {
  const [fmt, op, ...args] = line.split(" ");
  try {
    return run(FORMATS[fmt!]!, op!, args);
  } catch (e) {
    return e instanceof Panic ? "PANIC" : `THROW ${(e as Error).message.split("\n")[0]}`;
  }
}

if (import.meta.main) {
  const lines = gen();
  const t = new Map<string, [number, number]>();
  for (const line of lines) {
    const key = line.split(" ").slice(0, 2).join(" ");
    const t0 = performance.now();
    run_line(line);
    const dt = performance.now() - t0;
    const e = t.get(key) ?? [0, 0];
    t.set(key, [e[0] + dt, Math.max(e[1], dt)]);
  }
  const rows = [...t].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25);
  for (const [k, [tot, max]] of rows) console.log(`${k.padEnd(12)} total ${tot.toFixed(0)}ms max ${max.toFixed(1)}ms`);
}
