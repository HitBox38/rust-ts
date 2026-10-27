// Differential test (not a port): interpret/intrinsics.ts against the pinned rustc's own CTFE.
// Every case is a `const` item of one generated Rust file that calls a `core::intrinsics` function directly; the file is
// built with the pinned toolchain, so the oracle values are computed by the oracle compiler's interpreter (preferred-NaN
// results included) and the program only prints them. The same cases run through the ported helpers here:
// `numeric_intrinsic` (ctpop / ctlz / cttz / ctlz_nonzero / cttz_nonzero / bswap / bitreverse on every int width),
// `saturating_arith`, `exact_div` (exact operands only: the UB cases do not compile), `unop_float_intrinsic` (fabs),
// `float_minmax_intrinsic` (minimum / maximum / minimum_number_nsz / maximum_number_nsz), `float_copysign_intrinsic`,
// `float_round_intrinsic` (floor / ceil / trunc / round / round_ties_even) and `float_muladd_intrinsic` (fma / fmuladd),
// on f16 / f32 / f64 / f128 (rustc_apfloat, D9). The `*_intrinsic` helpers read their operands from immediates and write
// into a fresh stack allocation, which the test reads back. A few `float_to_int_checked` cases (no `const` intrinsic
// reaches it) are checked against Rust's documented semantics.
//
// Encoding of a result: `<hex bits>`.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { type InterpResult, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { type FloatType, Round } from "../../vendor/rustc_apfloat/lib.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";
import { panic } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { MemoryKind } from "./memory.gen.ts";
import { ImmTy } from "./operand.ts";
import type { OpTy } from "./operand.gen.ts";
import { PlaceTy_from_MPlaceTy } from "./place.ts";
import type { PlaceTy } from "./place.gen.ts";
import { MinMax, MulAddType } from "./intrinsics.ts";
import "./mod.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

// ---- cases ----

type IntTy = { name: string; bits: number; signed: boolean };
const INTS: IntTy[] = [8, 16, 32, 64, 128].flatMap((bits) => [
  { name: `u${bits}`, bits, signed: false },
  { name: `i${bits}`, bits, signed: true },
]);
type FloatTy = { name: "f16" | "f32" | "f64" | "f128"; bits: number };
const FLOATS: FloatTy[] = [
  { name: "f16", bits: 16 },
  { name: "f32", bits: 32 },
  { name: "f64", bits: 64 },
  { name: "f128", bits: 128 },
];

const mask = (bits: number): bigint => (1n << BigInt(bits)) - 1n;
const hex = (v: bigint): string => v.toString(16);

/** Bit patterns of interesting values of an int type (two's complement for signed). */
function int_values(t: IntTy): bigint[] {
  const m = mask(t.bits);
  const half = m >> 1n;
  const vals = t.signed ? [0n, 1n, m /* -1 */, half + 1n /* MIN */, half /* MAX */, 2n, m - 1n /* -2 */, 6n] : [0n, 1n, 2n, half, half + 1n, m - 1n, m, 6n];
  // mixed bit patterns
  vals.push(BigInt.asUintN(t.bits, 0x5a5a_c3c3_0f0f_9696_a5a5_3c3c_f0f0_6969n));
  vals.push(BigInt.asUintN(t.bits, 0x0000_0000_0001_0000_0000_0000_0010_0300n));
  return vals;
}

function float_type(t: FloatTy): FloatType<Half> {
  return (t.name === "f16" ? Half : t.name === "f32" ? Single : t.name === "f64" ? Double : Quad) as unknown as FloatType<Half>;
}

/** Bit patterns of interesting values of a float type. */
function float_values(t: FloatTy): bigint[] {
  const F = float_type(t);
  const lit = (s: string): bigint => unwrap_result(F.from_str(s)).to_bits();
  const sign = 1n << BigInt(t.bits - 1);
  return [
    0n,
    sign, // -0
    lit("1"),
    lit("-1.5"),
    lit("2.5"),
    lit("-0.5"),
    lit("0.1"),
    lit("3"),
    F.largest().to_bits(),
    F.SMALLEST.to_bits(), // smallest subnormal
    F.INFINITY.to_bits(),
    F.INFINITY.to_bits() | sign,
    F.NAN.to_bits(),
    F.NAN.to_bits() | sign | 1n, // a negative NaN with a payload
  ];
}

/** A Rust expression of type `T` with the given bit pattern. */
function rs_val(t: IntTy, bits: bigint): string {
  return t.signed ? `(0x${hex(bits)}u${t.bits} as i${t.bits})` : `0x${hex(bits)}u${t.bits}`;
}
function rs_fval(t: FloatTy, bits: bigint): string {
  return `${t.name}::from_bits(0x${hex(bits)})`;
}
const rs_bits = (t: IntTy, e: string): string => `((${e}) as u${t.bits} as u128)`;
const rs_fbits = (e: string): string => `((${e}).to_bits() as u128)`;

interface Cx {
  ecx: InterpCx;
  tcx: TyCtxt;
  layout(ty: Ty): TyAndLayout;
  ty(name: string): Ty;
}
type Case = { line: string; rs: string; run: (cx: Cx) => string };

function scalar_bits(s: Scalar): bigint {
  if (s.$ !== "Int") return panic("pointer result");
  return s._0.to_bits_unchecked();
}
function show_scalar(r: InterpResult<Scalar>): string {
  if (r.$ === "Err") return `error ${r._0.kind().$}`;
  return hex(scalar_bits(r._0));
}
function imm(cx: Cx, ty: string, bits: bigint): ImmTy {
  const layout = cx.layout(cx.ty(ty));
  return ImmTy.from_scalar(Scalar.from_uint(bits, layout.size), layout);
}
function op(cx: Cx, ty: string, bits: bigint): OpTy {
  return unwrap_result(imm(cx, ty, bits).to_op(cx.ecx));
}
/** Runs a helper that writes into `dest` (a fresh stack allocation of type `ty`) and reads `dest` back. */
function via_dest(cx: Cx, ty: string, f: (dest: PlaceTy) => InterpResult<undefined>): string {
  const mplace = unwrap_result(cx.ecx.allocate(cx.layout(cx.ty(ty)), MemoryKind.Stack));
  const r = f(PlaceTy_from_MPlaceTy(mplace));
  if (r.$ === "Err") return `error ${r._0.kind().$}`;
  return show_scalar(cx.ecx.read_scalar(mplace));
}

const NUMERIC: [string, Symbol, boolean][] = [
  ["ctpop", sym.ctpop, false],
  ["ctlz", sym.ctlz, false],
  ["cttz", sym.cttz, false],
  ["ctlz_nonzero", sym.ctlz_nonzero, false],
  ["cttz_nonzero", sym.cttz_nonzero, false],
  ["bswap", sym.bswap, true],
  ["bitreverse", sym.bitreverse, true],
];

const MINMAX: [string, MinMax][] = [
  ["minimum", MinMax.Minimum],
  ["maximum", MinMax.Maximum],
  ["minimum_number_nsz", MinMax.MinimumNumberNsz],
  ["maximum_number_nsz", MinMax.MaximumNumberNsz],
];
const ROUND: [string, Round][] = [
  ["floor", Round.TowardNegative],
  ["ceil", Round.TowardPositive],
  ["trunc", Round.TowardZero],
  ["round", Round.NearestTiesToAway],
  ["round_ties_even", Round.NearestTiesToEven],
];
/** `core::intrinsics::<name>f64` or `<name>_f64` (the `_` spellings of the pinned library). */
function float_fn(name: string, t: FloatTy): string {
  const bits = t.name.slice(1);
  return name.includes("_") ? `core::intrinsics::${name}_f${bits}` : `core::intrinsics::${name}f${bits}`;
}

function gen(): Case[] {
  const cases: Case[] = [];
  for (const t of INTS) {
    const vals = int_values(t);
    // numeric intrinsics
    for (const [name, s, same_ty] of NUMERIC) {
      for (const v of vals) {
        if (name.endsWith("_nonzero") && v === 0n) continue; // UB: does not compile
        const call = `core::intrinsics::${name}(${rs_val(t, v)})`;
        const rs = same_ty ? rs_bits(t, call) : `(${name.endsWith("_nonzero") ? `unsafe { ${call} }` : call} as u128)`;
        cases.push({
          line: `numeric ${t.name} ${name} ${hex(v)}`,
          rs,
          run: (cx) => {
            const layout = cx.layout(cx.ty(t.name));
            const ret_layout = same_ty ? layout : cx.layout(cx.ty("u32"));
            return show_scalar(cx.ecx.numeric_intrinsic(s, Scalar.from_uint(v, layout.size), layout, ret_layout));
          },
        });
      }
    }
    // saturating arithmetic
    for (const [name, mir_op] of [["saturating_add", "Add"], ["saturating_sub", "Sub"]] as const) {
      for (const a of vals) {
        for (const b of vals) {
          cases.push({
            line: `sat ${t.name} ${name} ${hex(a)} ${hex(b)}`,
            rs: rs_bits(t, `core::intrinsics::${name}(${rs_val(t, a)}, ${rs_val(t, b)})`),
            run: (cx) => show_scalar(cx.ecx.saturating_arith(mir_op, imm(cx, t.name, a), imm(cx, t.name, b))),
          });
        }
      }
    }
    // exact_div on exact operands
    const sval = (bits: bigint): bigint => (t.signed ? BigInt.asIntN(t.bits, bits) : bits);
    const half = mask(t.bits) >> 1n;
    for (const a of vals) {
      for (const b of vals) {
        const [x, y] = [sval(a), sval(b)];
        if (y === 0n || x % y !== 0n) continue;
        if (t.signed && a === half + 1n && y === -1n) continue; // MIN / -1: UB
        cases.push({
          line: `exact_div ${t.name} ${hex(a)} ${hex(b)}`,
          rs: rs_bits(t, `unsafe { core::intrinsics::exact_div(${rs_val(t, a)}, ${rs_val(t, b)}) }`),
          run: (cx) => via_dest(cx, t.name, (dest) => cx.ecx.exact_div(imm(cx, t.name, a), imm(cx, t.name, b), dest)),
        });
      }
    }
  }

  for (const t of FLOATS) {
    const F = float_type(t);
    const vals = float_values(t);
    for (const x of vals) {
      cases.push({
        line: `fabs ${t.name} ${hex(x)}`,
        rs: rs_fbits(`core::intrinsics::fabs(${rs_fval(t, x)})`),
        run: (cx) => show_scalar(cx.ecx.unop_float_intrinsic(sym.fabs, imm(cx, t.name, x), F)),
      });
      for (const [name, mode] of ROUND) {
        cases.push({
          line: `round ${t.name} ${name} ${hex(x)}`,
          rs: rs_fbits(`${float_fn(name, t)}(${rs_fval(t, x)})`),
          run: (cx) => via_dest(cx, t.name, (dest) => cx.ecx.float_round_intrinsic([op(cx, t.name, x)], dest, mode, F)),
        });
      }
      for (const y of vals) {
        for (const [name, mm] of MINMAX) {
          cases.push({
            line: `minmax ${t.name} ${name} ${hex(x)} ${hex(y)}`,
            rs: rs_fbits(`${float_fn(name, t)}(${rs_fval(t, x)}, ${rs_fval(t, y)})`),
            run: (cx) => via_dest(cx, t.name, (dest) => cx.ecx.float_minmax_intrinsic([op(cx, t.name, x), op(cx, t.name, y)], mm, dest, F)),
          });
        }
        cases.push({
          line: `copysign ${t.name} ${hex(x)} ${hex(y)}`,
          rs: rs_fbits(`${float_fn("copysign", t)}(${rs_fval(t, x)}, ${rs_fval(t, y)})`),
          run: (cx) => via_dest(cx, t.name, (dest) => cx.ecx.float_copysign_intrinsic([op(cx, t.name, x), op(cx, t.name, y)], dest, F)),
        });
      }
    }
    // fma / fmuladd on a subset (cubic)
    const sub = [vals[0]!, vals[1]!, vals[2]!, vals[3]!, vals[6]!, vals[8]!, vals[10]!, vals[13]!];
    for (const a of sub) {
      for (const b of sub) {
        for (const c of sub) {
          for (const [name, typ] of [["fma", MulAddType.Fused], ["fmuladd", MulAddType.Nondeterministic]] as const) {
            cases.push({
              line: `muladd ${t.name} ${name} ${hex(a)} ${hex(b)} ${hex(c)}`,
              rs: rs_fbits(`${float_fn(name, t)}(${rs_fval(t, a)}, ${rs_fval(t, b)}, ${rs_fval(t, c)})`),
              run: (cx) =>
                via_dest(cx, t.name, (dest) => cx.ecx.float_muladd_intrinsic([op(cx, t.name, a), op(cx, t.name, b), op(cx, t.name, c)], dest, typ, F)),
            });
          }
        }
      }
    }
  }
  return cases;
}

function rust_source(cases: Case[]): string {
  return [
    "#![feature(f16, f128, core_intrinsics)]",
    "#![allow(internal_features, overflowing_literals, unused_parens, unused_braces, unused_unsafe)]",
    `const R: [u128; ${cases.length}] = [`,
    ...cases.map((c) => `    ${c.rs},`),
    "];",
    'fn main() { for v in R { println!("{v:x}"); } }',
    "",
  ].join("\n");
}

// ---- oracle ----

const CASES = gen();
let oracle: string[] | undefined;

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

beforeAll(() => {
  let cmd: string[];
  try {
    const o = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    if (!rustc_at_pin()) throw new Error("not at the pin");
    cmd = o.oracleRustcCmd([]);
  } catch {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const dir = test_scratch_dir("interp-intrinsics");
  const src = join(dir, "intrinsics_oracle.rs");
  writeFileSync(src, rust_source(CASES));
  const exe = join(dir, process.platform === "win32" ? "intrinsics_oracle.exe" : "intrinsics_oracle");
  const c = Bun.spawnSync([...cmd, "--edition=2021", "-o", exe, src], { stdout: "pipe", stderr: "pipe" });
  if (c.exitCode !== 0) {
    const err = c.stderr.toString().split("\n").filter((l) => l.trim() !== "");
    throw new Error(`ERROR: building the intrinsics oracle failed: ${err.slice(0, 3).join(" / ")}`);
  }
  const r = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: the intrinsics oracle failed: ${r.stderr.toString().split("\n")[0]}`);
  oracle = r.stdout.toString().split("\n").slice(0, CASES.length);
}, 300_000);

// ---- driver ----

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
].join("\n");

function with_ecx(f: (cx: Cx) => void): void {
  const file = join(DATA, "tmp", "interp-intrinsics", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_intrinsics.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const ecx = InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const types = tcx.types as unknown as Record<string, Ty>;
      f({ ecx, tcx, layout: (ty) => unwrap_result(ecx.layout_of(ty)), ty: (name) => types[name]! });
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

test("numeric / saturating / exact_div / float intrinsics equal the pinned rustc's CTFE", () => {
  if (oracle === undefined) return;
  expect(oracle.length).toBe(CASES.length);
  const bad: string[] = [];
  const per_kind = new Map<string, number>();
  with_ecx((cx) => {
    CASES.forEach((c, i) => {
      const kind = c.line.split(" ").slice(0, 3).join(" ");
      per_kind.set(kind, (per_kind.get(kind) ?? 0) + 1);
      let ours: string;
      try {
        ours = c.run(cx);
      } catch (e) {
        ours = `threw ${(e as Error).message}`;
      }
      if (ours !== oracle![i] && bad.length < 30) bad.push(`${c.line}\n  ours:   ${ours}\n  oracle: ${oracle![i]}`);
    });
  });
  expect(bad).toEqual([]);
  expect(per_kind.size).toBeGreaterThan(150);
}, 300_000);

test("float_to_int_checked rounds, then rejects NaN and out-of-range values", () => {
  with_ecx((cx) => {
    const lit = (s: string): bigint => unwrap_result(Double.from_str(s)).to_bits();
    const run = (v: string, ty: string, round: Round): string => {
      const r = cx.ecx.float_to_int_checked(imm(cx, "f64", lit(v)), cx.layout(cx.ty(ty)), round);
      if (r.$ === "Err") return `error ${r._0.kind().$}`;
      if (r._0 === undefined) return "None";
      const s = r._0.imm;
      if (s.$ !== "Scalar") return panic("non-scalar");
      return `${ty.startsWith("i") ? BigInt.asIntN(Number(ty.slice(1)), scalar_bits(s._0)) : scalar_bits(s._0)}`;
    };
    expect(run("3.7", "u8", Round.TowardZero)).toBe("3");
    expect(run("3.5", "u8", Round.NearestTiesToEven)).toBe("4");
    expect(run("255.9", "u8", Round.TowardZero)).toBe("255");
    expect(run("256", "u8", Round.TowardZero)).toBe("None");
    expect(run("-1", "u8", Round.TowardZero)).toBe("None");
    expect(run("-0.5", "u8", Round.TowardZero)).toBe("0");
    expect(run("-128.9", "i8", Round.TowardZero)).toBe("-128");
    expect(run("-129", "i8", Round.TowardZero)).toBe("None");
    expect(run("nan", "i32", Round.TowardZero)).toBe("None");
    expect(run("inf", "u64", Round.TowardZero)).toBe("None");
  });
}, 300_000);
