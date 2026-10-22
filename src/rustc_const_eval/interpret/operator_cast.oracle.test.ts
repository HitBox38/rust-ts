// Differential test (not a port): interpret/operator.ts and interpret/cast.ts against the pinned rustc's own CTFE.
// Every case is a `const` item of one generated Rust file built with the pinned toolchain, so the oracle values are
// computed by the oracle compiler's interpreter (preferred-NaN results included); the program only prints them. The
// same cases run through `InterpCx::{binary_op, binary_float_op, unary_op, int_to_int_or_float, cast_from_float}`
// here: binary / unary ops on every int width (wrapping, `*WithOverflow`, `*Unchecked` UB, division UB, shifts with
// signed and unsigned out-of-range amounts, `Cmp`), bool and char ops, float ops on f16 / f32 / f64 / f128 (rustc_apfloat,
// D9), int -> int / float / char and float -> int / float casts.
//
// Encoding of a result: `<hex bits> <code>`; code 0 = value, 1 = the overflow flag of a `*WithOverflow` pair, 2..7 =
// the UB `DivisionByZero`, `RemainderByZero`, `DivisionOverflow`, `RemainderOverflow`, `ArithOverflow`, `ShiftOverflow`.
//
// The operand.rs helpers these paths call (`ImmTy::from_*`, `Immediate::to_scalar*`, ...) belong to lane
// interp-place-operand; while one is still a stub it is replaced for this file by a test double written from upstream
// (installed only if the real one is `unported`, restored afterwards). `Scalar::to_f16..to_f128` are unported in
// rustc_middle, so float ops are entered at `binary_float_op` / `cast_from_float` (below `binary_op` / `float_to_float_or_int`).
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { type InterpErrorInfo, type InterpResult, Scalar, Scalar_from_ScalarInt } from "../../rustc_middle/mir/interpret/mod.ts";
import type { BinOp, UnOp } from "../../rustc_middle/mir/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";
import { panic } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/mod.ts";
import { InterpCx } from "./eval_context.ts";
import { ImmTy, Immediate } from "./operand.ts";
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
  const vals = t.signed ? [0n, 1n, m /* -1 */, half + 1n /* MIN */, half /* MAX */, 2n, m - 1n /* -2 */] : [0n, 1n, 2n, half, half + 1n, m - 1n, m];
  // a mixed bit pattern
  vals.push(BigInt.asUintN(t.bits, 0x5a5a_c3c3_0f0f_9696_a5a5_3c3c_f0f0_6969n));
  return vals;
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

function float_type(t: FloatTy): typeof Half {
  return (t.name === "f16" ? Half : t.name === "f32" ? Single : t.name === "f64" ? Double : Quad) as typeof Half;
}

/** A Rust expression of type `T` with the given bit pattern. */
function rs_val(t: IntTy, bits: bigint): string {
  return t.signed ? `(0x${hex(bits)}u${t.bits} as i${t.bits})` : `0x${hex(bits)}u${t.bits}`;
}
function rs_fval(t: FloatTy, bits: bigint): string {
  return `${t.name}::from_bits(0x${hex(bits)})`;
}
const rs_bits = (t: IntTy, e: string): string => `((${e}) as u${t.bits} as u128)`;

type Case = { line: string; rs: string; run: (cx: Cx) => string };
interface Cx {
  ecx: InterpCx;
  tcx: TyCtxt;
  layout(ty: Ty): TyAndLayout;
  int_ty(name: string): Ty;
}

function code_of(err: InterpErrorInfo): number {
  const k = err.kind();
  if (k.$ !== "UndefinedBehavior") return panic(`unexpected error kind ${k.$}`);
  switch (k._0.$) {
    case "DivisionByZero":
      return 2;
    case "RemainderByZero":
      return 3;
    case "DivisionOverflow":
      return 4;
    case "RemainderOverflow":
      return 5;
    case "ArithOverflow":
      return 6;
    case "ShiftOverflow":
      return 7;
    default:
      return panic(`unexpected UB ${k._0.$}`);
  }
}

function scalar_bits(s: Scalar): bigint {
  if (s.$ !== "Int") return panic("pointer result");
  return s._0.to_bits_unchecked();
}

/** `<hex> <code>` of an op's result: a scalar, or the value and flag of a `*WithOverflow` pair. */
function show(r: InterpResult<ImmTy>): string {
  if (r.$ === "Err") return `0 ${code_of(r._0)}`;
  const imm = r._0.imm;
  if (imm.$ === "ScalarPair") return `${hex(scalar_bits(imm._0))} ${scalar_bits(imm._1)}`;
  if (imm.$ === "Scalar") return `${hex(scalar_bits(imm._0))} 0`;
  return panic("uninit result");
}

const INT_BINOPS: BinOp[] = [
  "Add", "Sub", "Mul", "AddWithOverflow", "SubWithOverflow", "MulWithOverflow", "AddUnchecked", "SubUnchecked", "MulUnchecked",
  "Div", "Rem", "BitAnd", "BitOr", "BitXor", "Eq", "Ne", "Lt", "Le", "Gt", "Ge", "Cmp",
];
const RS_CMP: Partial<Record<BinOp, string>> = { Eq: "==", Ne: "!=", Lt: "<", Le: "<=", Gt: ">", Ge: ">=" };
const RS_BIT: Partial<Record<BinOp, string>> = { BitAnd: "&", BitOr: "|", BitXor: "^" };

/** `Ord::cmp` as an `i8` (`Ord::cmp` is not callable in a `const`; `<` / `>` on primitives are). */
function rs_cmp3(a: string, b: string): string {
  return `((if ${a} < ${b} { -1i8 } else if ${a} > ${b} { 1i8 } else { 0i8 }) as u8 as u128, 0)`;
}

function rs_int_binop(t: IntTy, op: BinOp, a: string, b: string): string {
  const name = op.replace(/WithOverflow|Unchecked/, "").toLowerCase();
  if (op.endsWith("WithOverflow")) return `{ let (r, o) = ${a}.overflowing_${name}(${b}); (${rs_bits(t, "r")}, o as u8) }`;
  if (op.endsWith("Unchecked")) return `match ${a}.checked_${name}(${b}) { Some(r) => (${rs_bits(t, "r")}, 0), None => (0, 6) }`;
  if (op === "Add" || op === "Sub" || op === "Mul") return `(${rs_bits(t, `${a}.wrapping_${name}(${b})`)}, 0)`;
  if (op === "Div" || op === "Rem") {
    const [zero, ovf] = op === "Div" ? [2, 4] : [3, 5];
    return `if ${b} == 0 { (0, ${zero}) } else { match ${a}.checked_${name}(${b}) { Some(r) => (${rs_bits(t, "r")}, 0), None => (0, ${ovf}) } }`;
  }
  if (RS_BIT[op] !== undefined) return `(${rs_bits(t, `${a} ${RS_BIT[op]} ${b}`)}, 0)`;
  if (RS_CMP[op] !== undefined) return `((${a} ${RS_CMP[op]} ${b}) as u128, 0)`;
  if (op === "Cmp") return rs_cmp3(a, b);
  return panic(op);
}

function gen(): Case[] {
  const cases: Case[] = [];
  const imm_int = (cx: Cx, t: IntTy, bits: bigint): ImmTy => {
    const layout = cx.layout(cx.int_ty(t.name));
    return ImmTy.from_scalar(Scalar.from_uint(bits, layout.size), layout);
  };

  for (const t of INTS) {
    const vals = int_values(t);
    // binary ops
    for (const op of INT_BINOPS) {
      for (const a of vals) {
        for (const b of vals) {
          cases.push({
            line: `bin ${t.name} ${op} ${hex(a)} ${hex(b)}`,
            rs: rs_int_binop(t, op, rs_val(t, a), rs_val(t, b)),
            run: (cx) => show(cx.ecx.binary_op(op, imm_int(cx, t, a), imm_int(cx, t, b))),
          });
        }
      }
    }
    // shifts: the RHS is `u32` or `i32` (MIR allows any integer type), in and out of range
    for (const op of ["Shl", "Shr", "ShlUnchecked", "ShrUnchecked"] as BinOp[]) {
      for (const [rt, amounts] of [
        [{ name: "u32", bits: 32, signed: false }, [0n, 1n, BigInt(t.bits - 1), BigInt(t.bits), BigInt(t.bits + 3), 0xffff_ffffn]],
        [{ name: "i32", bits: 32, signed: true }, [3n, BigInt(t.bits - 1), BigInt(t.bits), 0xffff_ffffn /* -1 */, BigInt.asUintN(32, BigInt(-t.bits - 3))]],
      ] as [IntTy, bigint[]][]) {
        for (const a of vals) {
          for (const s of amounts) {
            const dir = op.startsWith("Shl") ? "shl" : "shr";
            const av = rs_val(t, a);
            const sv = rs_val(rt, s);
            const rs = op.endsWith("Unchecked")
              ? `match ${av}.checked_${dir}(${sv} as u32) { Some(r) => (${rs_bits(t, "r")}, 0), None => (0, 7) }`
              : `(${rs_bits(t, `${av}.wrapping_${dir}(${sv} as u32)`)}, 0)`;
            cases.push({
              line: `shift ${t.name} ${op} ${hex(a)} ${rt.name} ${hex(s)}`,
              rs,
              run: (cx) => show(cx.ecx.binary_op(op, imm_int(cx, t, a), imm_int(cx, rt, s))),
            });
          }
        }
      }
    }
    // unary ops
    for (const op of (t.signed ? ["Not", "Neg"] : ["Not"]) as UnOp[]) {
      for (const a of vals) {
        const av = rs_val(t, a);
        cases.push({
          line: `un ${t.name} ${op} ${hex(a)}`,
          rs: `(${rs_bits(t, op === "Not" ? `!${av}` : `${av}.wrapping_neg()`)}, 0)`,
          run: (cx) => show(cx.ecx.unary_op(op, imm_int(cx, t, a))),
        });
      }
    }
    // int -> int / float casts
    for (const a of vals) {
      for (const to of INTS) {
        cases.push({
          line: `cast ${t.name} ${to.name} ${hex(a)}`,
          rs: `(${rs_bits(to, `${rs_val(t, a)} as ${to.name}`)}, 0)`,
          run: (cx) => show(cx.ecx.int_to_int_or_float(imm_int(cx, t, a), cx.layout(cx.int_ty(to.name)))),
        });
      }
      for (const to of FLOATS) {
        cases.push({
          line: `cast ${t.name} ${to.name} ${hex(a)}`,
          rs: `((${rs_val(t, a)} as ${to.name}).to_bits() as u128, 0)`,
          run: (cx) => show(cx.ecx.int_to_int_or_float(imm_int(cx, t, a), cx.layout(cx.int_ty(to.name)))),
        });
      }
      if (t.name === "u8") {
        cases.push({
          line: `cast u8 char ${hex(a)}`,
          rs: `((${rs_val(t, a)} as char) as u32 as u128, 0)`,
          run: (cx) => show(cx.ecx.int_to_int_or_float(imm_int(cx, t, a), cx.layout(cx.tcx.types.char))),
        });
      }
    }
  }

  // bool and char ops
  for (const op of ["Eq", "Ne", "Lt", "Le", "Gt", "Ge", "BitAnd", "BitOr", "BitXor"] as BinOp[]) {
    for (const a of [false, true]) {
      for (const b of [false, true]) {
        const rs_op = RS_CMP[op] ?? RS_BIT[op]!;
        cases.push({
          line: `bin bool ${op} ${a} ${b}`,
          rs: `((${a} ${rs_op} ${b}) as u128, 0)`,
          run: (cx) => {
            const l = cx.layout(cx.tcx.types.bool);
            return show(cx.ecx.binary_op(op, ImmTy.from_scalar(Scalar.from_bool(a), l), ImmTy.from_scalar(Scalar.from_bool(b), l)));
          },
        });
      }
    }
  }
  for (const op of ["Eq", "Ne", "Lt", "Le", "Gt", "Ge", "Cmp"] as BinOp[]) {
    for (const a of [0x41, 0xe9, 0x1f600]) {
      for (const b of [0x41, 0x1f600]) {
        const ca = `char::from_u32(0x${a.toString(16)}).unwrap()`;
        const cb = `char::from_u32(0x${b.toString(16)}).unwrap()`;
        cases.push({
          line: `bin char ${op} ${a} ${b}`,
          rs: op === "Cmp" ? rs_cmp3(ca, cb) : `((${ca} ${RS_CMP[op]} ${cb}) as u128, 0)`,
          run: (cx) => {
            const l = cx.layout(cx.tcx.types.char);
            return show(cx.ecx.binary_op(op, ImmTy.from_scalar(Scalar.from_char(a), l), ImmTy.from_scalar(Scalar.from_char(b), l)));
          },
        });
      }
    }
  }

  // float ops and float casts
  const RS_FOP: Partial<Record<BinOp, string>> = { Add: "+", Sub: "-", Mul: "*", Div: "/", Rem: "%" };
  for (const t of FLOATS) {
    const F = float_type(t);
    const vals = float_values(t);
    for (const op of ["Eq", "Ne", "Lt", "Le", "Gt", "Ge", "Add", "Sub", "Mul", "Div", "Rem"] as BinOp[]) {
      for (const a of vals) {
        for (const b of vals) {
          const [fa, fb] = [rs_fval(t, a), rs_fval(t, b)];
          cases.push({
            line: `fbin ${t.name} ${op} ${hex(a)} ${hex(b)}`,
            rs: RS_CMP[op] !== undefined ? `((${fa} ${RS_CMP[op]} ${fb}) as u128, 0)` : `((${fa} ${RS_FOP[op]} ${fb}).to_bits() as u128, 0)`,
            run: (cx) => show({ $: "Ok", _0: cx.ecx.binary_float_op(op, cx.layout(cx.int_ty(t.name)), F.from_bits(a), F.from_bits(b)) }),
          });
        }
      }
    }
    for (const a of vals) {
      for (const to of INTS.filter((i) => i.bits !== 16)) {
        cases.push({
          line: `fcast ${t.name} ${to.name} ${hex(a)}`,
          rs: `(${rs_bits(to, `${rs_fval(t, a)} as ${to.name}`)}, 0)`,
          run: (cx) => show({ $: "Ok", _0: ImmTy.from_scalar(cx.ecx.cast_from_float(F.from_bits(a), cx.int_ty(to.name)), cx.layout(cx.int_ty(to.name))) }),
        });
      }
      // (an identity `as` is no cast in MIR, so the oracle cannot express `f32 -> f32`)
      for (const to of FLOATS.filter((f) => f.name !== t.name)) {
        cases.push({
          line: `fcast ${t.name} ${to.name} ${hex(a)}`,
          rs: `((${rs_fval(t, a)} as ${to.name}).to_bits() as u128, 0)`,
          run: (cx) => show({ $: "Ok", _0: ImmTy.from_scalar(cx.ecx.cast_from_float(F.from_bits(a), cx.int_ty(to.name)), cx.layout(cx.int_ty(to.name))) }),
        });
      }
    }
  }
  return cases;
}

function rust_source(cases: Case[]): string {
  return [
    "#![feature(f16, f128)]",
    "#![allow(overflowing_literals, unused_parens, unused_braces)]",
    `const R: [(u128, u8); ${cases.length}] = [`,
    ...cases.map((c) => `    ${c.rs},`),
    "];",
    'fn main() { for (v, c) in R { println!("{v:x} {c}"); } }',
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
  const dir = test_scratch_dir("interp-ops");
  const src = join(dir, "ops_oracle.rs");
  writeFileSync(src, rust_source(CASES));
  const exe = join(dir, process.platform === "win32" ? "ops_oracle.exe" : "ops_oracle");
  const c = Bun.spawnSync([...cmd, "--edition=2021", "-o", exe, src], { stdout: "pipe", stderr: "pipe" });
  if (c.exitCode !== 0) {
    const err = c.stderr.toString().split("\n").filter((l) => l.trim() !== "");
    throw new Error(`ERROR: building the ops oracle failed: ${err.slice(0, 3).join(" / ")}`);
  }
  const r = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: the ops oracle failed: ${r.stderr.toString().split("\n")[0]}`);
  oracle = r.stdout.toString().split("\n").slice(0, CASES.length);
}, 300_000);

// ---- test doubles for the operand.rs helpers still stubbed (lane interp-place-operand) ----

const restores: (() => void)[] = [];
function is_stub(f: unknown): boolean {
  return typeof f === "function" && f.toString().includes("unported(");
}
function double<T extends object, K extends keyof T>(obj: T, key: K, f: T[K]): void {
  if (!is_stub(obj[key])) return;
  const old = obj[key];
  obj[key] = f;
  restores.push(() => {
    obj[key] = old;
  });
}
afterAll(() => {
  for (const r of restores.reverse()) r();
});

function install_doubles(tcx: TyCtxt): void {
  const bool_layout = (): TyAndLayout => unwrap_result(tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(tcx.types.bool)));
  // operand.rs:83 to_scalar
  double(Immediate, "to_scalar", (self: Immediate) => (self.$ === "Scalar" ? self._0 : panic("Got a non-scalar where a scalar was expected")));
  // operand.rs:99 to_scalar_pair
  double(Immediate, "to_scalar_pair", (self: Immediate): [Scalar, Scalar] =>
    self.$ === "ScalarPair" ? [self._0, self._1] : panic("Got a non-pair where a scalar pair was expected"),
  );
  // operand.rs:259 from_scalar
  double(ImmTy, "from_scalar", (val: Scalar, layout: TyAndLayout) => new ImmTy({ $: "Scalar", _0: val }, layout));
  // operand.rs:266 from_scalar_pair
  double(ImmTy, "from_scalar_pair", (a: Scalar, b: Scalar, layout: TyAndLayout) => new ImmTy({ $: "ScalarPair", _0: a, _1: b }, layout));
  // operand.rs:276 from_immediate
  double(ImmTy, "from_immediate", (imm: Immediate, layout: TyAndLayout) => new ImmTy(imm, layout));
  // operand.rs:297 from_scalar_int
  double(ImmTy, "from_scalar_int", (s: ScalarInt, layout: TyAndLayout) => ImmTy.from_scalar(Scalar_from_ScalarInt(s), layout));
  // operand.rs:302 from_uint
  double(ImmTy, "from_uint", (i: bigint, layout: TyAndLayout) => ImmTy.from_scalar(Scalar.from_uint(i, layout.size), layout));
  // operand.rs:307 from_int
  double(ImmTy, "from_int", (i: bigint, layout: TyAndLayout) => ImmTy.from_scalar(Scalar.from_int(i, layout.size), layout));
  // operand.rs:312 from_bool
  double(ImmTy, "from_bool", (b: boolean) => ImmTy.from_scalar(Scalar.from_bool(b), bool_layout()));
  // operand.rs:321 from_ordering. PORT (test double): `Ordering` is a lang item the test crate (no_core) lacks; the
  // value is the same `i8` `ScalarInt`, given the `i8` layout.
  double(ImmTy, "from_ordering", (c: -1 | 0 | 1) =>
    ImmTy.from_scalar(Scalar_from_ScalarInt(ScalarInt.from_Ordering(c)), unwrap_result(tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(tcx.types.i8)))),
  );
  // operand.rs:329 from_pair
  double(ImmTy, "from_pair", (a: ImmTy, b: ImmTy) => {
    const layout = unwrap_result(tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(Ty.new_tup(tcx, [a.layout.ty, b.layout.ty]))));
    return ImmTy.from_scalar_pair(Immediate.to_scalar(a.imm), Immediate.to_scalar(b.imm), layout);
  });
  // operand.rs:342 to_scalar_int
  double(ImmTy.prototype, "to_scalar_int", function (this: ImmTy) {
    const s = Scalar.to_scalar_int(Immediate.to_scalar(this.imm));
    if (s.$ === "Err") return s;
    if (s._0.size().bytes() !== this.layout.size.bytes()) panic("scalar immediate size does not match layout");
    return s;
  });
}

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

test("binary / unary ops and casts on every int and float width equal the pinned rustc's CTFE", () => {
  if (oracle === undefined) return;
  expect(oracle.length).toBe(CASES.length);
  const file = join(DATA, "tmp", "interp-ops", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_ops.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  const bad: string[] = [];
  const per_kind = new Map<string, number>();
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      install_doubles(tcx);
      const ecx = InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const types = tcx.types as unknown as Record<string, Ty>;
      const cx: Cx = {
        ecx,
        tcx,
        layout: (ty) => unwrap_result(ecx.layout_of(ty)),
        int_ty: (name) => types[name]!,
      };
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
      ran = true;
    });
  });
  expect(ran).toBe(true);
  expect(bad).toEqual([]);
  expect(per_kind.size).toBeGreaterThan(300);
}, 300_000);
