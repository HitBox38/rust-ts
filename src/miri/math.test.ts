// Tests of src/miri/math.ts (lanes miri-eval, miri-eval-fix): the port of math.rs's `#[cfg(test)] mod tests` (upstream
// order), plus oracle checks of the float-error helpers, `generate_nan` (operator.rs) and the host float operations
// against `math.oracle.txt`: the output of the probe docs/handoff/miri-eval-fix-probe (built with the pinned nightly
// `nightly-2026-10-11`, rand =0.10.1 with chacha20 =0.10.0 as in Miri's Cargo.lock, rustc_apfloat =0.2.3; how to
// rebuild it: docs/handoff/miri-eval-fix.md). Part 1 (RNG helpers) is host-independent; part 2 (host float
// operations) is the host libm's and runs only on the fixture's host.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import {
  apply_random_float_error,
  apply_random_float_error_ulp,
  clamp_float_value,
  fixed_float_value,
  type HostFloatOperation,
  HostFloatOperation_Double,
  HostFloatOperation_Half,
  HostFloatOperation_Single,
  IeeeExt_Double,
  IeeeExt_Half,
  IeeeExt_Single,
  sqrt,
  strip_float_suffix,
} from "./math.ts";
import { type MiriInterpCx } from "./machine.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { StdRng } from "../vendor/rand/rngs/std.ts";
import { Double, Half, type IeeeFloat, Quad, type Semantics, Single } from "../vendor/rustc_apfloat/ieee.ts";
import type { FloatType } from "../vendor/rustc_apfloat/lib.ts";
import { panic } from "../std/panic.ts";
import { host_tuple } from "../rustc_session/config.ts";

// rustc: src/tools/miri/src/math.rs:635 test_sqrt
test("test_sqrt", () => {
  // #[track_caller]
  // rustc: src/tools/miri/src/math.rs:637 test
  function test_<S extends Semantics>(F: FloatType<IeeeFloat<S>>, x_: string, expected_: string): void {
    const x = F.from_str(x_);
    if (x.$ === "Err") panic("parse");
    const expected = F.from_str(expected_);
    if (expected.$ === "Err") panic("parse");
    const result = sqrt(x._0);
    expect(result.eq(expected._0)).toBe(true);
  }

  // rustc: src/tools/miri/src/math.rs:644 exact_tests
  function exact_tests<S extends Semantics>(F: FloatType<IeeeFloat<S>>): void {
    test_(F, "0", "0");
    test_(F, "1", "1");
    test_(F, "1.5625", "1.25");
    test_(F, "2.25", "1.5");
    test_(F, "4", "2");
    test_(F, "5.0625", "2.25");
    test_(F, "9", "3");
    test_(F, "16", "4");
    test_(F, "25", "5");
    test_(F, "36", "6");
    test_(F, "49", "7");
    test_(F, "64", "8");
    test_(F, "81", "9");
    test_(F, "100", "10");

    test_(F, "0.5625", "0.75");
    test_(F, "0.25", "0.5");
    test_(F, "0.0625", "0.25");
    test_(F, "0.00390625", "0.0625");
  }

  exact_tests(Half);
  exact_tests(Single);
  exact_tests(Double);
  exact_tests(Quad);

  test_(Single, "2", "1.4142135");
  test_(Double, "2", "1.4142135623730951");

  test_(Single, "1.1", "1.0488088");
  test_(Double, "1.1", "1.0488088481701516");

  test_(Single, "2.2", "1.4832398");
  test_(Double, "2.2", "1.4832396974191326");

  test_(Single, "1.22101e-40", "1.10499205e-20");
  test_(Double, "1.22101e-310", "1.1049932126488395e-155");

  test_(Single, "3.4028235e38", "1.8446743e19");
  test_(Double, "1.7976931348623157e308", "1.3407807929942596e154");
});

// ---- oracle checks (math.oracle.txt) ----

const ORACLE = readFileSync(join(import.meta.dir, "math.oracle.txt"), "utf8")
  .split("\n")
  .filter((l) => l !== "");
const lines = (tag: string): string[][] => ORACLE.filter((l) => l.startsWith(tag + " ")).map((l) => l.split(" ").slice(1));
const hex = (n: bigint, w: number): string => n.toString(16).padStart(w, "0");

/** A stand-in `MiriInterpCx` with the fields these helpers read (the machine's float settings and its RNG). */
function fake_ecx(mode: "Random" | "Max", rng: StdRng): MiriInterpCx {
  const ecx = {
    machine: { float_nondet: true, float_rounding_error: mode, rng },
    eval_context_ref() {
      return ecx;
    },
    eval_context_mut() {
      return ecx;
    },
    generate_nan: InterpCx.prototype.generate_nan,
  };
  return ecx as unknown as MiriInterpCx;
}

/** The probe's `Counting`: counts the stream's `try_next_u32` / `try_next_u64` / `try_fill_bytes` calls. */
function counting(rng: StdRng): { n32: number; n64: number; nbytes: number } {
  const c = { n32: 0, n64: 0, nbytes: 0 };
  const [u32, u64, bytes] = [rng.try_next_u32.bind(rng), rng.try_next_u64.bind(rng), rng.try_fill_bytes.bind(rng)];
  rng.try_next_u32 = () => (c.n32++, u32());
  rng.try_next_u64 = () => (c.n64++, u64());
  rng.try_fill_bytes = (dst) => (c.nbytes++, bytes(dst));
  return c;
}

test("float error helpers and generate_nan match the oracle (one StdRng stream, seed 0, draws checked per line)", () => {
  const rng = StdRng.seed_from_u64(0n);
  const c = counting(rng);
  const random = fake_ecx("Random", rng);
  const max = fake_ecx("Max", rng);
  /** A line's expected result and draw counts (`@ n32 n64 nbytes`), against the port's. */
  const check = (l: string[], got: string, n: number): void => {
    expect(l[n + 1]).toBe("@");
    expect([got, `${c.n32} ${c.n64} ${c.nbytes}`]).toEqual([l[n]!, l.slice(n + 2, n + 5).join(" ")]);
  };
  const cases: [string, (v: bigint) => { to_bits(): bigint }, number][] = [
    ["are64", (v) => apply_random_float_error(random, Double.from_bits(v), -10), 16],
    ["are32", (v) => apply_random_float_error(random, Single.from_bits(v), -20), 8],
    // Production: x86 `rcp` / `rsqrt` (intrinsics/x86/mod.rs) call it on `f32` with `err_scale = -12`.
    ["are32m12", (v) => apply_random_float_error(random, Single.from_bits(v), -12), 8],
    ["aremax32m12", (v) => apply_random_float_error(max, Single.from_bits(v), -12), 8],
    ["aremax64", (v) => apply_random_float_error(max, Double.from_bits(v), -10), 16],
    ["ulp64", (v) => apply_random_float_error_ulp(random, Double.from_bits(v), 4), 16],
    ["ulp32", (v) => apply_random_float_error_ulp(random, Single.from_bits(v), 16), 8],
    ["ulp16", (v) => apply_random_float_error_ulp(random, Half.from_bits(v), 4), 4],
    ["ulpmax16", (v) => apply_random_float_error_ulp(max, Half.from_bits(v), 4), 4],
    // `apply_random_float_error_to_imm` (machine.rs `apply_float_nondet`) dispatches `f128` too.
    ["ulp128", (v) => apply_random_float_error_ulp(random, Quad.from_bits(v), 4), 32],
    ["ulpmax128", (v) => apply_random_float_error_ulp(max, Quad.from_bits(v), 4), 32],
  ];
  for (const [tag, f, w] of cases) {
    const ls = lines(tag);
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) check(l, hex(f(BigInt("0x" + l[0])).to_bits(), w), 1);
  }

  const snan = Double.snan(5n);
  const qnan = Double.qnan(7n);
  const one = Double.from_bits(0x3ff0000000000000n);
  const nans = lines("nan");
  const inputs = [[one], [qnan], [snan, qnan], [snan]];
  expect(nans.length).toBe(inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const r = random.generate_nan(inputs[i]!, Single);
    const r2 = random.generate_nan(inputs[i]!, Double);
    const r3 = random.generate_nan(inputs[i]!, Half);
    const r4 = random.generate_nan(inputs[i]!, Quad);
    expect(nans[i]!.slice(0, 3).join(" ")).toBe(`${hex(r.to_bits(), 8)} ${hex(r2.to_bits(), 16)} ${hex(r3.to_bits(), 4)}`);
    check(nans[i]!, hex(r4.to_bits(), 32), 3);
  }
  expect(hex(rng.next_u64(), 16)).toBe(lines("next")[0]![0]!);
});

test("IeeeExt::pi is core's PI (oracle bits)", () => {
  const [p16, p32, p64] = lines("pi")[0]!;
  expect(hex(IeeeExt_Half.pi().to_bits(), 4)).toBe(p16!);
  expect(hex(IeeeExt_Single.pi().to_bits(), 8)).toBe(p32!);
  expect(hex(IeeeExt_Double.pi().to_bits(), 16)).toBe(p64!);
});

// ---- host float operations (math.oracle.txt `host` lines) ----
//
// The probe's part 2 (docs/handoff/miri-eval-fix-probe/main.rs): every host op of every width over a large
// deterministic sample (f64 / f32: 200,000 inputs; f16: all 65,536, powf × 8 exponents, powi × 15), outputs folded
// into an FNV-1a hash (NaN canonical: Miri replaces NaN results, math.rs callers' `adjust_nan`). These are the host
// libm's results, so they hold only on the host the fixture was recorded on (`tuple` line); elsewhere the test is
// skipped with the reason printed. To locate a mismatch: `mirimath <tuple> dump <width> <op>` prints the oracle's
// words in the order of `outputs` below.

/** The fixture's host and this machine's (`RUST_TS_HOST_TUPLE`, as rustc_session `host_tuple()` reads it). */
const FIXTURE_TUPLE = lines("tuple")[0]![0]!;
const HOST_TUPLE = ((): string | undefined => {
  try {
    return host_tuple();
  } catch {
    return undefined;
  }
})();
const HOST_SKIP = HOST_TUPLE !== FIXTURE_TUPLE;
if (HOST_SKIP) {
  console.log(
    `math.test.ts: host float operation checks skipped: math.oracle.txt holds the host libm results of ${FIXTURE_TUPLE}, ` +
      `this host is ${HOST_TUPLE ?? "unknown (RUST_TS_HOST_TUPLE unset)"}`,
  );
}

/** The macOS release the fixture was recorded on (docs/handoff/miri-eval-fix.md). Apple's libm can change with an OS
 * update; a host-op hash mismatch on a different release is first checked for that (re-run the probe), not a port bug. */
const FIXTURE_MACOS = "26.7.1 (25G241)";
if (!HOST_SKIP && process.platform === "darwin") {
  const sw = (flag: string): string => Bun.spawnSync(["sw_vers", flag]).stdout.toString().trim();
  const here = `${sw("-productVersion")} (${sw("-buildVersion")})`;
  if (here !== FIXTURE_MACOS) {
    console.log(`math.test.ts: NOTE: math.oracle.txt was recorded on macOS ${FIXTURE_MACOS}, this is ${here}; a host-op hash mismatch may be a changed Apple libm (re-run the mirimath probe)`);
  }
}

/** The probe's `Gen` (mulberry32) and its input classes. */
class Gen {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }
  f32_bits(c: number): number {
    const u = this.next();
    let e: number;
    switch (c) {
      case 0:
        return u;
      case 1:
        e = 117 + (this.next() % 18);
        break;
      case 2:
        e = 125 + (this.next() % 4);
        break;
      default:
        e = 134 + (this.next() % 30);
    }
    return ((u & 0x807fffff) | (e << 23)) >>> 0;
  }
  f64_bits(c: number): bigint {
    let hi = this.next();
    const lo = this.next();
    switch (c) {
      case 0:
        break;
      case 1:
        hi = ((hi & 0x800fffff) | ((1013 + (this.next() % 18)) << 20)) >>> 0;
        break;
      case 2:
        hi = ((hi & 0x800fffff) | ((1021 + (this.next() % 4)) << 20)) >>> 0;
        break;
      default:
        hi = ((hi & 0x800fffff) | ((1030 + (this.next() % 60)) << 20)) >>> 0;
    }
    return (BigInt(hi) << 32n) | BigInt(lo);
  }
  powi_exp(i: number): number {
    const u = this.next();
    return i % 16 === 15 ? u | 0 : (u % 67) - 33;
  }
}

const N = 200_000;
const OPS = ["sin", "cos", "exp", "exp2", "ln", "log10", "log2", "powf", "powi"] as const;
type Op = (typeof OPS)[number];
const POWF16_Y = [0x3800, 0x3d7b, 0x4000, 0xbc00, 0xc100, 0x2e66, 0x47c0, 0x7c00];
const POWI16_N = [-3, -2, -1, 1, 2, 3, 5, 7, -7, 11, 16, 31, -31, 2147483647, -2147483648];

interface Soft<T> {
  to_bits(): bigint;
  is_nan(): boolean;
}
function host_op<T extends Soft<T>>(H: HostFloatOperation<T>, op: Op, x: T, y: T, n: number): T {
  switch (op) {
    case "sin":
      return H.host_sin(x);
    case "cos":
      return H.host_cos(x);
    case "exp":
      return H.host_exp(x);
    case "exp2":
      return H.host_exp2(x);
    case "ln":
      return H.host_log(x);
    case "log10":
      return H.host_log10(x);
    case "log2":
      return H.host_log2(x);
    case "powf":
      return H.host_powf(x, y);
    case "powi":
      return H.host_powi(x, n);
  }
}

/** The probe's `Fnv` (FNV-1a over the little-endian bytes of 32-bit words). */
class Fnv {
  h = 0x811c9dc5;
  count = 0;
  word(w: number): void {
    this.count++;
    for (let i = 0; i < 4; i++) {
      this.h = Math.imul(this.h ^ ((w >>> (8 * i)) & 0xff), 0x01000193) >>> 0;
    }
  }
}

/** The port's outputs of one op, hashed (the probe's `outputs` + `part2`). */
function port_hash(width: "f64" | "f32" | "f16", op: Op): string {
  const h = new Fnv();
  if (width === "f64") {
    const g = new Gen(0x6d697269);
    for (let i = 0; i < N; i++) {
      const x = Double.from_bits(g.f64_bits(i % 4));
      const y = Double.from_bits(g.f64_bits(((i / 4) | 0) % 4));
      const n = g.powi_exp(i);
      const r = host_op(HostFloatOperation_Double, op, x, y, n);
      const b = r.is_nan() ? 0x7ff8000000000000n : r.to_bits();
      h.word(Number(b >> 32n));
      h.word(Number(b & 0xffffffffn));
    }
  } else if (width === "f32") {
    const g = new Gen(0x6d697269);
    for (let i = 0; i < N; i++) {
      const x = Single.from_bits(BigInt(g.f32_bits(i % 4)));
      const y = Single.from_bits(BigInt(g.f32_bits(((i / 4) | 0) % 4)));
      const n = g.powi_exp(i);
      const r = host_op(HostFloatOperation_Single, op, x, y, n);
      h.word(r.is_nan() ? 0x7fc00000 : Number(r.to_bits()));
    }
  } else {
    const zero = Half.from_bits(0n);
    const push = (r: Half): void => h.word(r.is_nan() ? 0x7e00 : Number(r.to_bits()));
    const xs: Half[] = [];
    for (let b = 0; b <= 0xffff; b++) xs.push(Half.from_bits(BigInt(b)));
    if (op === "powf") {
      for (const y of POWF16_Y) for (const x of xs) push(host_op(HostFloatOperation_Half, op, x, Half.from_bits(BigInt(y)), 0));
    } else if (op === "powi") {
      for (const n of POWI16_N) for (const x of xs) push(host_op(HostFloatOperation_Half, op, x, zero, n));
    } else {
      for (const x of xs) push(host_op(HostFloatOperation_Half, op, x, zero, 0));
    }
  }
  return `${h.count} ${h.h.toString(16).padStart(8, "0")}`;
}

for (const width of ["f64", "f32", "f16"] as const) {
  test.skipIf(HOST_SKIP)(`host float operations (${width}) are the oracle host's, bit for bit (hashed sample)`, () => {
    const want = new Map(lines("host").filter((l) => l[0] === width).map((l) => [l[1]!, `${l[2]} ${l[3]}`]));
    expect([...want.keys()]).toEqual([...OPS]);
    const got = new Map<string, string>(OPS.map((op) => [op, port_hash(width, op)]));
    expect(got).toEqual(want);
  }, 120_000);
}

test("strip_float_suffix / clamp_float_value / fixed_float_value", () => {
  expect(strip_float_suffix("sinf32")).toBe("sin");
  expect(strip_float_suffix("erff")).toBe("erf");
  expect(strip_float_suffix("erf")).toBe("erf");
  expect(strip_float_suffix("expf")).toBe("exp");
  expect(strip_float_suffix("atan2f64")).toBe("atan2");
  expect(strip_float_suffix("erfcf")).toBe("erfc");

  const two = Double.from_bits(0x4000000000000000n);
  const one = Double.from_bits(0x3ff0000000000000n);
  expect(clamp_float_value("sinf64", two).eq(one)).toBe(true);
  expect(clamp_float_value("logf64", two).eq(two)).toBe(true);
  expect(clamp_float_value("expf64", two.neg()).is_pos_zero()).toBe(true);

  const ecx = fake_ecx("Random", StdRng.seed_from_u64(0n));
  expect(fixed_float_value(ecx, "cosf64", [Double.ZERO.neg()], Double)!.eq(one)).toBe(true);
  expect(fixed_float_value(ecx, "sinf64", [Double.ZERO], Double)).toBeUndefined();
  expect(fixed_float_value(ecx, "atanf64", [Double.INFINITY.neg()], Double)!.to_bits()).toBe(0xbff921fb54442d18n);
  expect(fixed_float_value(ecx, "powf64", [one.neg(), Double.INFINITY], Double)!.eq(one)).toBe(true);
  expect(fixed_float_value(ecx, "hypotf64", [two.neg(), Double.ZERO], Double)!.eq(two)).toBe(true);
});
