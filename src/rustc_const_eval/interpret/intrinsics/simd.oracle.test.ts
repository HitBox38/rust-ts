// Differential test (not a port): interpret/intrinsics/simd.ts against the pinned rustc's own CTFE.
// Every case is one `simd_*` call (`#![feature(repr_simd, core_intrinsics)]`) in a `const` item of a generated Rust file
// built with the pinned toolchain, so the oracle values are computed by the oracle compiler's interpreter; the program
// only prints the result lanes (as bit patterns). The UB cases are `const` items of a second, failing crate; the oracle
// is the `error[E0080]: <message>` of each. The same cases run here through `InterpCx::eval_simd_intrinsic` on places
// allocated by the CTFE machine (in a no_core crate that declares the same `#[repr(simd)]` types).
//
// `eval_simd_intrinsic` ends with `return_to_block(ret)`; the test passes `ret = None` (there is no frame), so a
// successful call ends in `throw_ub!(Unreachable)` after every lane is written. The result is then read from `dest`.
//
// Cases whose path reaches a stub of lane interp-intrinsics (`ptr_offset_inbounds`, reached by every in-bounds projection
// into memory, so every case; `numeric_intrinsic`, `saturating_arith`, `float_round`, `float_minmax`, `float_muladd`,
// `float_to_int_checked`) or rustc_middle's `Scalar::to_float` (all ported on integ-w19 by interp-intrinsics, not in
// this lane's base) are counted as pending while those stay `unported`; once merged, they run for real and every case
// must equal the oracle.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";
import type { Crate } from "../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../rustc_driver_impl/lib.ts";
import "../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../rustc_interface/passes.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import "../../../rustc_middle/lib.ts";
import { Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../../../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";
import { panic, Unported } from "../../../std/panic.ts";
import { unwrap_result } from "../../../std/result.ts";
import { Double, Half, Quad, Single } from "../../../vendor/rustc_apfloat/ieee.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../../const_eval/mod.ts";
import { InterpCx } from "../eval_context.ts";
import type { MPlaceTy } from "../place.gen.ts";
import { PlaceTy_from_MPlaceTy } from "../place.ts";
import { OpTy_from_MPlaceTy } from "../operand.ts";
import "../mod.ts";
// PORT: nothing loads intrinsics/simd.ts yet (upstream `mod simd;` in intrinsics.rs; see docs/handoff/interp-simd.md)
import "./simd.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

// ---- types ----

type Kind = "u" | "i" | "f" | "bool";
interface Elem {
  name: string;
  bits: number;
  kind: Kind;
}
const E = (name: string): Elem =>
  name === "bool" ? { name, bits: 8, kind: "bool" } : { name, bits: Number(name.slice(1)), kind: name[0] as Kind };
interface Vec {
  name: string;
  elem: Elem;
  n: number;
}
const V = (elem: string, n: number): Vec => ({ name: `${elem}x${n}`, elem: E(elem), n });

const INT_VECS: Vec[] = [V("u8", 8), V("i8", 8), V("u16", 4), V("i16", 4), V("u32", 4), V("i32", 4), V("u64", 2), V("i64", 2), V("u128", 2), V("i128", 2)];
const FLOAT_VECS: Vec[] = [V("f16", 4), V("f32", 4), V("f64", 2), V("f128", 2)];
/** the signed mask vector of a vector's lane width and count */
const mask_of = (v: Vec): Vec => V(`i${v.elem.bits}`, v.n);
const ALL_VECS = new Map<string, Vec>();
for (const v of [...INT_VECS, ...FLOAT_VECS, V("u32", 2), V("u32", 8), V("i32", 8), V("f32", 2), V("i8", 4), V("u8", 4)]) ALL_VECS.set(v.name, v);
for (const v of [...ALL_VECS.values()]) ALL_VECS.set(mask_of(v).name, mask_of(v));

type Arg = { $: "vec"; ty: Vec; lanes: bigint[] } | { $: "scalar"; elem: Elem; bits: bigint } | { $: "arr"; bytes: bigint[] };
type Out = { $: "vec"; ty: Vec } | { $: "scalar"; elem: Elem } | { $: "arr"; n: number };
interface Case {
  name: string;
  args: Arg[];
  out: Out;
}

const mask = (bits: number): bigint => (1n << BigInt(bits)) - 1n;
const hex = (v: bigint): string => v.toString(16);

/** Interesting bit patterns of an element type. */
function values(e: Elem): bigint[] {
  if (e.kind === "f") {
    const F = float_type(e);
    const lit = (s: string): bigint => unwrap_result(F.from_str(s)).to_bits();
    const sign = 1n << BigInt(e.bits - 1);
    return [lit("1"), lit("-1.5"), 0n, sign, lit("0.1"), lit("2.5"), lit("-3.5"), F.largest().to_bits(), F.SMALLEST.to_bits(), F.INFINITY.to_bits(), F.INFINITY.to_bits() | sign, F.NAN.to_bits(), lit("7"), lit("-0.75")];
  }
  const m = mask(e.bits);
  const half = m >> 1n;
  return [1n, 0n, m, half + 1n, half, 2n, m - 1n, BigInt.asUintN(e.bits, 0x5a5a_c3c3_0f0f_9696_a5a5_3c3c_f0f0_6969n), 3n, BigInt.asUintN(e.bits, 0x0123_4567_89ab_cdef_fedc_ba98_7654_3210n)];
}
function float_type(e: Elem): typeof Half {
  return (e.bits === 16 ? Half : e.bits === 32 ? Single : e.bits === 64 ? Double : Quad) as typeof Half;
}
/** `n` lanes of `values(e)` starting at `off` */
function lanes(e: Elem, n: number, off: number): bigint[] {
  const vs = values(e);
  return Array.from({ length: n }, (_, i) => vs[(off + i * 3) % vs.length]!);
}
const vec = (ty: Vec, ls: bigint[]): Arg => ({ $: "vec", ty, lanes: ls });
const as_signed = (e: Elem, b: bigint): bigint => BigInt.asIntN(e.bits, b);
const mask_lanes = (n: number, off: number, bits: number): bigint[] => Array.from({ length: n }, (_, i) => (((i + off) * 5) % 3 === 0 ? mask(bits) : 0n));

// ---- cases ----

function gen(): { ok: Case[]; ub: Case[] } {
  const ok: Case[] = [];
  const ub: Case[] = [];
  const bin = (name: string, a: Arg, b: Arg, out: Out) => ok.push({ name, args: [a, b], out });
  for (const t of INT_VECS) {
    const e = t.elem;
    for (const off of [0, 1, 4]) {
      const a = lanes(e, t.n, off);
      const b = lanes(e, t.n, off + 2);
      for (const op of ["simd_add", "simd_sub", "simd_mul", "simd_and", "simd_or", "simd_xor", "simd_saturating_add", "simd_saturating_sub"]) bin(op, vec(t, a), vec(t, b), { $: "vec", ty: t });
      for (const op of ["simd_eq", "simd_ne", "simd_lt", "simd_le", "simd_gt", "simd_ge"]) bin(op, vec(t, a), vec(t, b), { $: "vec", ty: mask_of(t) });
      // no division UB: rhs 0 -> 1, MIN / -1 -> MIN / 2
      const min = e.kind === "i" ? (mask(e.bits) >> 1n) + 1n : -1n;
      const d = b.map((x, i) => (x === 0n ? 1n : e.kind === "i" && a[i] === min && x === mask(e.bits) ? 2n : x));
      for (const op of ["simd_div", "simd_rem"]) bin(op, vec(t, a), vec(t, d), { $: "vec", ty: t });
      const sh = b.map((x) => x % BigInt(e.bits));
      for (const op of ["simd_shl", "simd_shr"]) bin(op, vec(t, a), vec(t, sh), { $: "vec", ty: t });
      for (const op of ["simd_funnel_shl", "simd_funnel_shr"]) ok.push({ name: op, args: [vec(t, a), vec(t, b), vec(t, sh)], out: { $: "vec", ty: t } });
      for (const op of ["simd_ctlz", "simd_cttz", "simd_ctpop", "simd_bswap", "simd_bitreverse"]) ok.push({ name: op, args: [vec(t, a)], out: { $: "vec", ty: t } });
      if (e.kind === "i") ok.push({ name: "simd_neg", args: [vec(t, a)], out: { $: "vec", ty: t } });
      for (const op of ["simd_reduce_and", "simd_reduce_or", "simd_reduce_xor", "simd_reduce_max", "simd_reduce_min"]) ok.push({ name: op, args: [vec(t, a)], out: { $: "scalar", elem: e } });
      for (const op of ["simd_reduce_add_ordered", "simd_reduce_mul_ordered"]) ok.push({ name: op, args: [vec(t, a), { $: "scalar", elem: e, bits: b[0]! }], out: { $: "scalar", elem: e } });
      const m = mask_of(t);
      const ml = mask_lanes(t.n, off, e.bits);
      ok.push({ name: "simd_select", args: [vec(m, ml), vec(t, a), vec(t, b)], out: { $: "vec", ty: t } });
      for (const op of ["simd_reduce_any", "simd_reduce_all"]) ok.push({ name: op, args: [vec(m, ml)], out: { $: "scalar", elem: E("bool") } });
      ok.push({ name: "simd_reduce_all", args: [vec(m, ml.map(() => mask(e.bits)))], out: { $: "scalar", elem: E("bool") } });
      ok.push({ name: "simd_reduce_any", args: [vec(m, ml.map(() => 0n))], out: { $: "scalar", elem: E("bool") } });
      // bitmasks: as an unsigned int (u8 / u32) and as `[u8; 1]`
      for (const u of ["u8", "u32"]) ok.push({ name: "simd_bitmask", args: [vec(m, ml)], out: { $: "scalar", elem: E(u) } });
      ok.push({ name: "simd_bitmask", args: [vec(m, ml)], out: { $: "arr", n: 1 } });
      const bm = BigInt(0x5a ^ (off * 0x11));
      for (const u of ["u8", "u16"]) ok.push({ name: "simd_select_bitmask", args: [{ $: "scalar", elem: E(u), bits: bm }, vec(t, a), vec(t, b)], out: { $: "vec", ty: t } });
      ok.push({ name: "simd_select_bitmask", args: [{ $: "arr", bytes: [bm] }, vec(t, a), vec(t, b)], out: { $: "vec", ty: t } });
      // insert / extract / splat
      const idx = BigInt((off + 1) % t.n);
      for (const op of ["simd_insert", "simd_insert_dyn"]) ok.push({ name: op, args: [vec(t, a), { $: "scalar", elem: E("u32"), bits: idx }, { $: "scalar", elem: e, bits: b[1]! }], out: { $: "vec", ty: t } });
      for (const op of ["simd_extract", "simd_extract_dyn"]) ok.push({ name: op, args: [vec(t, a), { $: "scalar", elem: E("u32"), bits: idx }], out: { $: "scalar", elem: e } });
      ok.push({ name: "simd_splat", args: [{ $: "scalar", elem: e, bits: a[0]! }], out: { $: "vec", ty: t } });
    }
    // int casts to every other int / float vector of the same lane count
    for (const to of [...INT_VECS, ...FLOAT_VECS].filter((v) => v.n === t.n && v.name !== t.name)) {
      for (const op of ["simd_cast", "simd_as"]) ok.push({ name: op, args: [vec(t, lanes(e, t.n, 2))], out: { $: "vec", ty: to } });
    }
  }
  for (const t of FLOAT_VECS) {
    const e = t.elem;
    for (const off of [0, 1, 2, 5, 9]) {
      const a = lanes(e, t.n, off);
      const b = lanes(e, t.n, off + 4);
      const c = lanes(e, t.n, off + 7);
      for (const op of ["simd_add", "simd_sub", "simd_mul", "simd_div", "simd_rem", "simd_maximum_number_nsz", "simd_minimum_number_nsz"]) bin(op, vec(t, a), vec(t, b), { $: "vec", ty: t });
      for (const op of ["simd_eq", "simd_ne", "simd_lt", "simd_le", "simd_gt", "simd_ge"]) bin(op, vec(t, a), vec(t, b), { $: "vec", ty: mask_of(t) });
      for (const op of ["simd_neg", "simd_fabs", "simd_ceil", "simd_floor", "simd_round", "simd_round_ties_even", "simd_trunc"]) ok.push({ name: op, args: [vec(t, a)], out: { $: "vec", ty: t } });
      for (const op of ["simd_fma", "simd_relaxed_fma"]) ok.push({ name: op, args: [vec(t, a), vec(t, b), vec(t, c)], out: { $: "vec", ty: t } });
      for (const op of ["simd_reduce_max", "simd_reduce_min"]) ok.push({ name: op, args: [vec(t, a)], out: { $: "scalar", elem: e } });
      for (const op of ["simd_reduce_add_ordered", "simd_reduce_mul_ordered"]) ok.push({ name: op, args: [vec(t, a), { $: "scalar", elem: e, bits: b[0]! }], out: { $: "scalar", elem: e } });
      ok.push({ name: "simd_select", args: [vec(mask_of(t), mask_lanes(t.n, off, e.bits)), vec(t, a), vec(t, b)], out: { $: "vec", ty: t } });
    }
    for (const to of [...INT_VECS, ...FLOAT_VECS].filter((v) => v.n === t.n && v.name !== t.name)) {
      ok.push({ name: "simd_as", args: [vec(t, lanes(e, t.n, 0))], out: { $: "vec", ty: to } });
      ok.push({ name: "simd_as", args: [vec(t, lanes(e, t.n, 7))], out: { $: "vec", ty: to } });
      if (to.elem.kind === "f") {
        ok.push({ name: "simd_cast", args: [vec(t, lanes(e, t.n, 3))], out: { $: "vec", ty: to } });
      } else {
        // values every int type can represent after truncation: 1, 2.5, 7, 0.1
        const F = float_type(e);
        const lit = (s: string): bigint => unwrap_result(F.from_str(s)).to_bits();
        const ls = ["1", "2.5", "7", "0.1"].slice(0, t.n).map(lit);
        ok.push({ name: "simd_cast", args: [vec(t, ls)], out: { $: "vec", ty: to } });
      }
    }
  }
  // shuffles (index vectors of the destination's lane count)
  const i32x4 = ALL_VECS.get("i32x4")!;
  const u32 = (n: number) => ALL_VECS.get(`u32x${n}`)!;
  const sa = lanes(i32x4.elem, 4, 0);
  const sb = lanes(i32x4.elem, 4, 5);
  for (const idx of [[0n, 1n, 2n, 3n], [7n, 0n, 5n, 2n], [4n, 4n, 4n, 4n]]) ok.push({ name: "simd_shuffle", args: [vec(i32x4, sa), vec(i32x4, sb), vec(u32(4), idx)], out: { $: "vec", ty: i32x4 } });
  ok.push({ name: "simd_shuffle", args: [vec(i32x4, sa), vec(i32x4, sb), vec(u32(2), [6n, 1n])], out: { $: "vec", ty: ALL_VECS.get("i32x2")! } });
  ok.push({ name: "simd_shuffle", args: [vec(i32x4, sa), vec(i32x4, sb), vec(u32(8), [0n, 7n, 1n, 6n, 2n, 5n, 3n, 4n])], out: { $: "vec", ty: ALL_VECS.get("i32x8")! } });

  // UB
  const u8x8 = ALL_VECS.get("u8x8")!;
  ub.push({ name: "simd_extract", args: [vec(i32x4, sa), { $: "scalar", elem: E("u32"), bits: 4n }], out: { $: "scalar", elem: E("i32") } });
  ub.push({ name: "simd_insert", args: [vec(i32x4, sa), { $: "scalar", elem: E("u32"), bits: 9n }, { $: "scalar", elem: E("i32"), bits: 1n }], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_shl", args: [vec(i32x4, sa), vec(i32x4, [1n, 2n, 40n, 3n])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_shr", args: [vec(i32x4, sa), vec(i32x4, [1n, mask(32), 4n, 3n])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_shl", args: [vec(u8x8, lanes(u8x8.elem, 8, 0)), vec(u8x8, [0n, 1n, 2n, 3n, 4n, 5n, 6n, 8n])], out: { $: "vec", ty: u8x8 } });
  ub.push({ name: "simd_div", args: [vec(i32x4, sa), vec(i32x4, [1n, 0n, 1n, 1n])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_rem", args: [vec(i32x4, [0x8000_0000n, 1n, 1n, 1n]), vec(i32x4, [mask(32), 1n, 1n, 1n])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_select", args: [vec(i32x4, [0n, 1n, 0n, 0n]), vec(i32x4, sa), vec(i32x4, sb)], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_reduce_any", args: [vec(i32x4, [0n, 0n, 5n, 0n])], out: { $: "scalar", elem: E("bool") } });
  ub.push({ name: "simd_bitmask", args: [vec(i32x4, [0n, 0n, mask(32), 2n])], out: { $: "scalar", elem: E("u8") } });
  ub.push({ name: "simd_shuffle", args: [vec(i32x4, sa), vec(i32x4, sb), vec(u32(4), [0n, 8n, 1n, 2n])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_funnel_shl", args: [vec(i32x4, sa), vec(i32x4, sb), vec(i32x4, [0n, 1n, 32n, 2n])], out: { $: "vec", ty: i32x4 } });
  const f32x4 = ALL_VECS.get("f32x4")!;
  const fl = (s: string) => unwrap_result(Single.from_str(s)).to_bits();
  ub.push({ name: "simd_cast", args: [vec(f32x4, [fl("1"), fl("3e10"), fl("1"), fl("1")])], out: { $: "vec", ty: i32x4 } });
  ub.push({ name: "simd_cast", args: [vec(f32x4, [fl("1"), fl("2"), fl("-1"), fl("1")])], out: { $: "vec", ty: ALL_VECS.get("u32x4")! } });
  return { ok, ub };
}

// ---- Rust source ----

function rs_elem(e: Elem, bits: bigint): string {
  if (e.kind === "f") return `${e.name}::from_bits(0x${hex(bits)})`;
  if (e.kind === "bool") return bits !== 0n ? "true" : "false";
  if (e.kind === "i") return `(0x${hex(bits)}u${e.bits} as ${e.name})`;
  return `0x${hex(bits)}${e.name}`;
}
function rs_arg(a: Arg, i: number, name: string): string {
  switch (a.$) {
    case "vec": {
      const v = `${a.ty.name}([${a.lanes.map((l) => rs_elem(a.ty.elem, l)).join(", ")}])`;
      // the index vector of `simd_shuffle` must be a constant
      return name === "simd_shuffle" && i === 2 ? `const { ${v} }` : v;
    }
    case "scalar":
      return rs_elem(a.elem, a.bits);
    case "arr":
      return `[${a.bytes.map((b) => `0x${hex(b)}u8`).join(", ")}]`;
  }
}
function rs_out_ty(o: Out): string {
  return o.$ === "vec" ? o.ty.name : o.$ === "scalar" ? o.elem.name : `[u8; ${o.n}]`;
}
function rs_bits_of(e: Elem, x: string): string {
  if (e.kind === "f") return `(${x}.to_bits() as u128)`;
  if (e.kind === "bool") return `(${x} as u128)`;
  return `(${x} as u${e.bits} as u128)`;
}
const LANES = 8;
function rs_case(c: Case): string {
  const call = `unsafe { ${c.name}(${c.args.map((a, i) => rs_arg(a, i, c.name)).join(", ")}) }`;
  const o = c.out;
  let ls: string[];
  let pre: string;
  if (o.$ === "vec") {
    pre = `let r: ${o.ty.name} = ${call}; let a: [${o.ty.elem.name}; ${o.ty.n}] = unsafe { transmute(r) };`;
    ls = Array.from({ length: o.ty.n }, (_, i) => rs_bits_of(o.ty.elem, `a[${i}]`));
  } else if (o.$ === "scalar") {
    pre = `let r: ${o.elem.name} = ${call};`;
    ls = [rs_bits_of(o.elem, "r")];
  } else {
    pre = `let r: [u8; ${o.n}] = ${call};`;
    ls = Array.from({ length: o.n }, (_, i) => `(r[${i}] as u128)`);
  }
  while (ls.length < LANES) ls.push("0");
  return `{ ${pre} [${ls.join(", ")}] }`;
}
const PRELUDE = (vecs: Vec[]): string[] => [
  "#![feature(repr_simd, core_intrinsics, f16, f128)]",
  "#![allow(non_camel_case_types, internal_features, overflowing_literals, unused_parens, unused_unsafe)]",
  "use std::intrinsics::simd::*;",
  "#[allow(unused_imports)] use std::mem::transmute;",
  ...vecs.map((v) => `#[repr(simd)] #[derive(Copy, Clone)] pub struct ${v.name}(pub [${v.elem.name}; ${v.n}]);`),
];
function rust_source(cases: Case[]): string {
  return [
    ...PRELUDE([...ALL_VECS.values()]),
    `const R: [[u128; ${LANES}]; ${cases.length}] = [`,
    ...cases.map((c) => `    ${rs_case(c)},`),
    "];",
    'fn main() { for r in R { let s: Vec<String> = r.iter().map(|v| format!("{v:x}")).collect(); println!("{}", s.join(" ")); } }',
    "",
  ].join("\n");
}
function rust_ub_source(cases: Case[]): string {
  return [...PRELUDE([...ALL_VECS.values()]), ...cases.map((c, i) => `pub const E${i}: [u128; ${LANES}] = ${rs_case(c)};`), ""].join("\n");
}

// ---- oracle ----

const { ok: CASES, ub: UB_CASES } = gen();
let oracle: string[] | undefined;
let oracle_ub: string[] | undefined;

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
    const o = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
    if (!rustc_at_pin()) throw new Error("not at the pin");
    cmd = o.oracleRustcCmd([]);
  } catch {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const dir = test_scratch_dir("interp-simd");
  const src = join(dir, "simd_oracle.rs");
  writeFileSync(src, rust_source(CASES));
  const exe = join(dir, process.platform === "win32" ? "simd_oracle.exe" : "simd_oracle");
  const c = Bun.spawnSync([...cmd, "--edition=2021", "-o", exe, src], { stdout: "pipe", stderr: "pipe" });
  if (c.exitCode !== 0) {
    const err = c.stderr.toString().split("\n").filter((l) => l.trim() !== "");
    throw new Error(`ERROR: building the simd oracle failed: ${err.slice(0, 6).join(" / ")}`);
  }
  const r = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: the simd oracle failed: ${r.stderr.toString().split("\n")[0]}`);
  oracle = r.stdout.toString().split("\n").slice(0, CASES.length);

  // UB: `error[E0080]: <message>` ... `evaluation of `E<i>` failed here`
  const ub_src = join(dir, "simd_ub.rs");
  writeFileSync(ub_src, rust_ub_source(UB_CASES));
  const u = Bun.spawnSync([...cmd, "--edition=2021", "--crate-type=lib", "--emit=metadata", "-o", join(dir, "simd_ub.rmeta"), ub_src], { stdout: "pipe", stderr: "pipe" });
  const msgs: string[] = new Array<string>(UB_CASES.length).fill("(no error)");
  let msg: string | undefined;
  for (const line of u.stderr.toString().split("\n")) {
    const m = /^error\[E0080\]: (.*)$/.exec(line);
    if (m !== null) msg = m[1];
    const l = /evaluation of `E(\d+)` failed/.exec(line);
    if (l !== null && msg !== undefined) {
      msgs[Number(l[1])] = msg;
      msg = undefined;
    }
  }
  oracle_ub = msgs;
}, 600_000);

// ---- our side ----

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
  "#![feature(no_core, lang_items, repr_simd, f16, f128)]",
  "#![no_core]",
  "#![allow(internal_features, non_camel_case_types)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  ...[...ALL_VECS.values()].map((v) => `#[repr(simd)] pub struct ${v.name}(pub [${v.elem.name}; ${v.n}]);`),
].join("\n");

interface Cx {
  ecx: InterpCx;
  tcx: TyCtxt;
  layout(ty: Ty): TyAndLayout;
  elem_ty(e: Elem): Ty;
  vec_ty(v: Vec): Ty;
}

function ok<T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T {
  if (r.$ === "Err") return panic(`unexpected Err while setting up a case: ${String(r._0)}`);
  return r._0;
}

function alloc(cx: Cx, ty: Ty): MPlaceTy {
  return ok(cx.ecx.allocate(cx.layout(ty), { $: "Stack" }));
}

function write_lanes(cx: Cx, place: MPlaceTy, size_bits: number, ls: readonly bigint[]): void {
  const [simd, len] = ok(cx.ecx.project_to_simd(place));
  expect(len).toBe(BigInt(ls.length));
  ls.forEach((l, i) => {
    const p = ok(cx.ecx.project_index(simd, BigInt(i)));
    ok(cx.ecx.write_scalar(Scalar.from_uint(l, p.layout.size), p));
    void size_bits;
  });
}

function make_arg(cx: Cx, a: Arg): MPlaceTy {
  switch (a.$) {
    case "vec": {
      const p = alloc(cx, cx.vec_ty(a.ty));
      write_lanes(cx, p, a.ty.elem.bits, a.lanes);
      return p;
    }
    case "scalar": {
      const p = alloc(cx, cx.elem_ty(a.elem));
      ok(cx.ecx.write_scalar(Scalar.from_uint(a.bits, p.layout.size), p));
      return p;
    }
    case "arr": {
      const p = alloc(cx, Ty.new_array(cx.tcx, cx.tcx.types.u8, a.bytes.length));
      a.bytes.forEach((b, i) => {
        const e = ok(cx.ecx.project_index(p, BigInt(i)));
        ok(cx.ecx.write_scalar(Scalar.from_uint(b, e.layout.size), e));
      });
      return p;
    }
  }
}

function read_bits(cx: Cx, p: MPlaceTy): string {
  return hex(ok(Scalar.to_bits(ok(cx.ecx.read_scalar(p)), p.layout.size)));
}

function read_out(cx: Cx, o: Out, dest: MPlaceTy): string {
  const ls: string[] = [];
  if (o.$ === "vec") {
    const [simd, len] = ok(cx.ecx.project_to_simd(dest));
    for (let i = 0n; i < len; i++) ls.push(read_bits(cx, ok(cx.ecx.project_index(simd, i))));
  } else if (o.$ === "scalar") {
    ls.push(read_bits(cx, dest));
  } else {
    for (let i = 0; i < o.n; i++) ls.push(read_bits(cx, ok(cx.ecx.project_index(dest, BigInt(i)))));
  }
  while (ls.length < LANES) ls.push("0");
  return ls.join(" ");
}

// (and `rustc_abi::Size beyond 2^53`: operator.ts `compute_size_in_bytes` builds `max_size_of_val` = `Size::from_bytes(isize::MAX)`, so every
// array index projection into memory on a 64-bit target stops there; see docs/handoff/interp-simd.md)
const PENDING = /rustc_const_eval::interpret::intrinsics::InterpCx::|Scalar::to_float|rustc_abi::Size beyond 2\^53/;

/** The result lanes, `err <UB message>`, or `pending` (a stub of a lane not in this base). */
function run(cx: Cx, c: Case): string {
  try {
    const args = c.args.map((a) => OpTy_from_MPlaceTy(make_arg(cx, a)));
    const dest = alloc(cx, c.out.$ === "vec" ? cx.vec_ty(c.out.ty) : c.out.$ === "scalar" ? cx.elem_ty(c.out.elem) : Ty.new_array(cx.tcx, cx.tcx.types.u8, c.out.n));
    const r = cx.ecx.eval_simd_intrinsic((sym as unknown as Record<string, Symbol>)[c.name]!, cx.tcx.mk_args([]), args, PlaceTy_from_MPlaceTy(dest), undefined);
    if (r.$ === "Ok") return `unexpected Ok(${r._0})`;
    const k = r._0.kind();
    if (k.$ === "UndefinedBehavior" && k._0.$ === "Unreachable") return read_out(cx, c.out, dest);
    if (k.$ === "UndefinedBehavior" && k._0.$ === "Ub") return `err ${k._0._0}`;
    return `err (kind ${k.$} ${"_0" in k ? (k._0 as { $: string }).$ : ""})`;
  } catch (e) {
    if (e instanceof Unported && PENDING.test(e.message)) return "pending";
    throw e;
  }
}

function with_cx(f: (cx: Cx) => void): void {
  const file = join(DATA, "tmp", "interp-simd", `agent-${Bun.hash(process.env.RUST_TS_AGENT ?? "default").toString(16)}`, "interp_simd.rs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const ecx = InterpCx.new(tcx, DUMMY_SP, TypingEnv.fully_monomorphized(), CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.No));
      const types = tcx.types as unknown as Record<string, Ty>;
      const vecs = new Map<string, Ty>();
      for (const id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
        if (tcx.def_kind(id).$ !== "Struct") continue;
        const name = Symbol.as_str(tcx.item_name(LocalDefId.to_def_id(id)));
        vecs.set(name, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(id) as EarlyBinder<Ty>)));
      }
      f({
        ecx,
        tcx,
        layout: (ty) => unwrap_result(ecx.layout_of(ty)),
        elem_ty: (e) => types[e.name]!,
        vec_ty: (v) => vecs.get(v.name) ?? panic(`no type ${v.name}`),
      });
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

test("simd intrinsics on int / float vectors equal the pinned rustc's CTFE", () => {
  if (oracle === undefined) return;
  expect(oracle.length).toBe(CASES.length);
  const bad: string[] = [];
  let pending = 0;
  let matched = 0;
  with_cx((cx) => {
    CASES.forEach((c, i) => {
      let ours: string;
      try {
        ours = run(cx, c);
      } catch (e) {
        ours = `threw ${(e as Error).message}`;
      }
      if (ours === "pending") pending++;
      else if (ours === oracle![i]) matched++;
      else if (bad.length < 30) bad.push(`${c.name} ${rs_case(c)}\n  ours:   ${ours}\n  oracle: ${oracle![i]}`);
    });
  });
  expect(bad).toEqual([]);
  console.log(`simd oracle: ${matched} equal, ${pending} pending (interp-intrinsics stubs), of ${CASES.length}`);
  // every case runs once interp-intrinsics is in (no stub left on these paths)
  if (pending === 0) expect(matched).toBe(CASES.length);
}, 600_000);

test("simd intrinsics' UB messages equal the pinned rustc's", () => {
  if (oracle_ub === undefined) return;
  const bad: string[] = [];
  let pending = 0;
  with_cx((cx) => {
    UB_CASES.forEach((c, i) => {
      let ours: string;
      try {
        ours = run(cx, c);
      } catch (e) {
        ours = `threw ${(e as Error).message}`;
      }
      if (ours === "pending") pending++;
      else if (ours !== `err ${oracle_ub![i]}`) bad.push(`E${i} ${c.name}\n  ours:   ${ours}\n  oracle: err ${oracle_ub![i]}`);
    });
  });
  expect(bad).toEqual([]);
  console.log(`simd UB oracle: ${UB_CASES.length - pending} equal, ${pending} pending (interp-intrinsics stubs), of ${UB_CASES.length}`);
}, 600_000);
