// Tests of src/miri/math.ts (lane miri-eval): the port of math.rs's `#[cfg(test)] mod tests` (upstream order), plus
// oracle checks of the float-error helpers, `generate_nan` (operator.rs) and the host float operations against
// `math.oracle.txt`: the output of a scratch probe built with the pinned nightly (`nightly-2026-10-11`), rand =0.10.1
// (chacha20 =0.10.0, Miri's Cargo.lock) and rustc_apfloat =0.2.3, running math.rs / operator.rs's code verbatim over
// `StdRng::seed_from_u64(0)` (probe source and how to rebuild it: docs/handoff/miri-eval.md).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import {
  apply_random_float_error,
  apply_random_float_error_ulp,
  clamp_float_value,
  fixed_float_value,
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

test("float error helpers and generate_nan match the oracle (one StdRng stream, seed 0)", () => {
  const rng = StdRng.seed_from_u64(0n);
  const random = fake_ecx("Random", rng);
  const max = fake_ecx("Max", rng);

  for (const [v, want] of lines("are64")) {
    expect(hex(apply_random_float_error(random, Double.from_bits(BigInt("0x" + v)), -10).to_bits(), 16)).toBe(want!);
  }
  for (const [v, want] of lines("are32")) {
    expect(hex(apply_random_float_error(random, Single.from_bits(BigInt("0x" + v)), -20).to_bits(), 8)).toBe(want!);
  }
  for (const [v, want] of lines("aremax64")) {
    expect(hex(apply_random_float_error(max, Double.from_bits(BigInt("0x" + v)), -10).to_bits(), 16)).toBe(want!);
  }
  for (const [v, want] of lines("ulp64")) {
    expect(hex(apply_random_float_error_ulp(random, Double.from_bits(BigInt("0x" + v)), 4).to_bits(), 16)).toBe(want!);
  }
  for (const [v, want] of lines("ulp32")) {
    expect(hex(apply_random_float_error_ulp(random, Single.from_bits(BigInt("0x" + v)), 16).to_bits(), 8)).toBe(want!);
  }
  for (const [v, want] of lines("ulpmax16")) {
    expect(hex(apply_random_float_error_ulp(max, Half.from_bits(BigInt("0x" + v)), 4).to_bits(), 4)).toBe(want!);
  }

  const snan = Double.snan(5n);
  const qnan = Double.qnan(7n);
  const one = Double.from_bits(0x3ff0000000000000n);
  const nans = lines("nan");
  const cases = [[one], [qnan], [snan, qnan], [snan]];
  expect(nans.length).toBe(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const r = random.generate_nan(cases[i]!, Single);
    const r2 = random.generate_nan(cases[i]!, Double);
    expect([hex(r.to_bits(), 8), hex(r2.to_bits(), 16)]).toEqual(nans[i]!);
  }
  expect(hex(rng.next_u64(), 16)).toBe(lines("next")[0]![0]!);
});

test("IeeeExt::pi is core's PI (oracle bits)", () => {
  const [p16, p32, p64] = lines("pi")[0]!;
  expect(hex(IeeeExt_Half.pi().to_bits(), 4)).toBe(p16!);
  expect(hex(IeeeExt_Single.pi().to_bits(), 8)).toBe(p32!);
  expect(hex(IeeeExt_Double.pi().to_bits(), 16)).toBe(p64!);
});

/**
 * Host float operations against the oracle's libm (Rust's `f64::sin` & co. on this host). `f64` must match; `f32` /
 * `f16` are computed in `f64` and rounded (math.ts header) and are reported, not required, where the host `sinf`-family
 * result differs.
 */
test("host float operations match the oracle's libm (f64 exactly; f32/f16 differences listed)", () => {
  const ops = ["sin", "cos", "exp", "exp2", "ln", "log10", "log2", "powf", "powi"] as const;
  const run = <F>(
    H: typeof HostFloatOperation_Double,
    F_: FloatType<IeeeFloat<Semantics>>,
    v: IeeeFloat<Semantics>,
    op: (typeof ops)[number],
    powi_exp: number,
  ): bigint => {
    const h = H as unknown as typeof HostFloatOperation_Double;
    const x = v as unknown as Parameters<typeof h.host_sin>[0];
    const c = F_.from_str("1.37");
    if (c.$ === "Err") panic("parse");
    const y = (c._0 as unknown as IeeeFloat<Semantics>).convert(F_, { value: false }).value as unknown as typeof x;
    switch (op) {
      case "sin":
        return h.host_sin(x).to_bits();
      case "cos":
        return h.host_cos(x).to_bits();
      case "exp":
        return h.host_exp(x).to_bits();
      case "exp2":
        return h.host_exp2(x).to_bits();
      case "ln":
        return h.host_log(x).to_bits();
      case "log10":
        return h.host_log10(x).to_bits();
      case "log2":
        return h.host_log2(x).to_bits();
      case "powf":
        return h.host_powf(x, y).to_bits();
      case "powi":
        return h.host_powi(x, powi_exp).to_bits();
    }
  };
  const diffs: string[] = [];
  for (const [tag, H, F_, w, pe] of [
    ["h64", HostFloatOperation_Double, Double, 16, 7],
    ["h32", HostFloatOperation_Single, Single, 8, 7],
    ["h16", HostFloatOperation_Half, Half, 4, 3],
  ] as const) {
    for (const l of lines(tag)) {
      const v = (F_ as unknown as FloatType<IeeeFloat<Semantics>>).from_bits(BigInt("0x" + l[0]));
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        expect(l[1 + 2 * i]).toBe(op);
        const want = l[2 + 2 * i]!;
        const got = hex(run(H as never, F_ as unknown as FloatType<IeeeFloat<Semantics>>, v, op, pe), w);
        if (got !== want) diffs.push(`${tag} ${l[0]} ${op}: port ${got} oracle ${want}`);
      }
    }
  }
  // f64 must be exact (same host libm through JavaScriptCore).
  expect(diffs.filter((d) => d.startsWith("h64"))).toEqual([]);
  if (diffs.length > 0) console.log(`host float op differences (f32/f16, see math.ts header):\n${diffs.join("\n")}`);
});

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
