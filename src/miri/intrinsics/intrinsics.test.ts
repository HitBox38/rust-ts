// Tests of lane miri-shims-d's intrinsics (src/miri/intrinsics/{mod,math,simd}.ts) against the oracle.
//
// - intrinsics.oracle.txt: the isolated Miri oracle running docs/handoff/miri-shims-d-probe/intrinsics.rs with
//   `-Zmiri-deterministic-floats` (target x86_64-unknown-linux-gnu, on aarch64-apple-darwin): sqrtf16/32/64/128, the
//   generic `sin cos exp exp2 log log10 log2` intrinsics, powf16/32/64, powif16/32/64, and simd_fsqrt / fsin / .. on
//   f32x4 / f64x2. The port's `emulate_intrinsic_by_name` (-> `emulate_math_intrinsic` / `emulate_simd_intrinsic`) runs
//   on a stand-in `ecx`: `InterpCx.prototype` with a `MiriMachine` (`float_nondet = false`, as the flag sets it) and
//   operands / places that hold one `Scalar` (or SIMD lanes). Everything after `read_scalar` (fixed values, host ops,
//   `adjust_nan` -> the machine's `generate_nan`, `write_scalar` of the right width) is the port's own code. The host ops
//   (everything but sqrt and powi) are the host libm's, so those lines are checked only on the oracle's host
//   (math.test.ts rule).
// - crc32.oracle.txt: the host's hardware CRC32 / CRC32C instructions (docs/handoff/miri-shims-d-probe/crc32.rs, built
//   with the oracle rustc) against `compute_crc32`.
// - `sub_word` / `sigma0` / `sigma1` / `round`: FIPS-197 Appendix A.1 (key expansion) and FIPS 180-4 (SHA-256("abc")).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../lib.ts";
import { MiriMachine } from "../machine.ts";
import { compute_crc32, round, sigma0, sigma1, sub_word } from "./math.ts";
import { check_intrinsic_arg_count } from "./mod.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { interp_ok, Scalar, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { host_tuple } from "../../rustc_session/config.ts";

const ORACLE_HOST = "aarch64-apple-darwin";
const HOST_OK = ((): boolean => {
  try {
    return host_tuple() === ORACLE_HOST;
  } catch {
    return false;
  }
})();

type FTy = "F16" | "F32" | "F64" | "F128";
const SIZE: Record<FTy, bigint> = { F16: 2n, F32: 4n, F64: 8n, F128: 16n };
const fty = (t: FTy) => ({ kind: () => ({ $: "Float", _0: t }) });
const ity = { kind: () => ({ $: "Int", _0: "I32" }) };

/** An operand / place holding one scalar (`val`), or SIMD lanes (`lanes`). */
interface Slot {
  layout: { ty: unknown; size: Size };
  val?: Scalar;
  lanes?: Slot[];
}
const slot = (t: FTy | "I32", bits?: bigint): Slot => {
  const size = Size.from_bytes(t === "I32" ? 4n : SIZE[t]);
  return { layout: { ty: t === "I32" ? ity : fty(t), size }, val: bits === undefined ? undefined : Scalar.from_uint(bits, size) };
};

/** The stand-in `ecx` (header). */
function stand_in_ecx(): InterpCx {
  const machine = Object.create(MiriMachine.prototype) as MiriMachine & Record<string, unknown>;
  machine.float_nondet = false;
  machine.float_rounding_error = "None";
  const ecx = Object.create(InterpCx.prototype) as InterpCx & Record<string, unknown>;
  ecx.machine = machine;
  ecx.read_scalar = (op: Slot): InterpResult<Scalar> => interp_ok(op.val!);
  ecx.write_scalar = (v: Scalar, dest: Slot): InterpResult => {
    dest.val = v;
    return interp_ok(undefined);
  };
  ecx.project_to_simd = (p: Slot): InterpResult<[Slot, bigint]> => interp_ok([p, BigInt(p.lanes!.length)]);
  ecx.project_index = (p: Slot, i: bigint): InterpResult<Slot> => interp_ok(p.lanes![Number(i)]!);
  return ecx;
}

function bits_of(s: Slot): bigint {
  const r = Scalar.to_bits(s.val!, s.layout.size);
  if (r.$ === "Err") throw new Error("not an integer scalar");
  return r._0;
}

const lines = readFileSync(join(import.meta.dir, "intrinsics.oracle.txt"), "utf8").trim().split("\n").map((l) => l.split(" "));
const WIDTH: Record<string, FTy> = { f16: "F16", f32: "F32", f64: "F64", f128: "F128" };
const HOST_OPS = new Set(["sin", "cos", "exp", "exp2", "log", "log10", "log2"]);

/** Runs one oracle line through the port; returns `[intrinsic, want, got]` or undefined when skipped. */
function run_line(ecx: InterpCx, l: string[]): [string, bigint[], bigint[]] | undefined {
  const name = l[0]!;
  const h = (s: string) => BigInt(`0x${s}`);
  if (name.startsWith("sqrtf")) {
    const t = WIDTH[name.slice(4)]!;
    const dest = slot(t);
    const r = ecx.emulate_intrinsic_by_name(name, undefined as never, [slot(t, h(l[1]!))] as never, dest as never, undefined);
    expect(r).toEqual({ $: "Ok", _0: "NeedsReturn" });
    return [name, [h(l[2]!)], [bits_of(dest)]];
  }
  if (HOST_OPS.has(name)) {
    if (!HOST_OK) return undefined;
    const t = WIDTH[l[1]!]!;
    const dest = slot(t);
    const generic_args = { type_at: () => fty(t) };
    const r = ecx.emulate_intrinsic_by_name(name, generic_args as never, [slot(t, h(l[2]!))] as never, dest as never, undefined);
    expect(r).toEqual({ $: "Ok", _0: "NeedsReturn" });
    return [`${name} ${l[1]}`, [h(l[3]!)], [bits_of(dest)]];
  }
  if (name.startsWith("powif")) {
    const t = WIDTH[name.slice(4)]!;
    const dest = slot(t);
    const r = ecx.emulate_intrinsic_by_name(name, undefined as never, [slot(t, h(l[1]!)), slot("I32", h(l[2]!))] as never, dest as never, undefined);
    expect(r).toEqual({ $: "Ok", _0: "NeedsReturn" });
    return [name, [h(l[3]!)], [bits_of(dest)]];
  }
  if (name.startsWith("powf")) {
    if (!HOST_OK) return undefined;
    const t = WIDTH[name.slice(3)]!;
    const dest = slot(t);
    const r = ecx.emulate_intrinsic_by_name(name, undefined as never, [slot(t, h(l[1]!)), slot(t, h(l[2]!))] as never, dest as never, undefined);
    expect(r).toEqual({ $: "Ok", _0: "NeedsReturn" });
    return [name, [h(l[3]!)], [bits_of(dest)]];
  }
  if (name.startsWith("simd_")) {
    if (name !== "simd_fsqrt" && !HOST_OK) return undefined;
    const t: FTy = l[1] === "f32x4" ? "F32" : "F64";
    const n = t === "F32" ? 4 : 2;
    const ins = l.slice(2, 2 + n).map(h);
    const want = l.slice(2 + n).map(h);
    const op: Slot = { layout: { ty: undefined, size: Size.ZERO }, lanes: ins.map((b) => slot(t, b)) };
    const dest: Slot = { layout: { ty: undefined, size: Size.ZERO }, lanes: ins.map(() => slot(t)) };
    const r = ecx.emulate_intrinsic_by_name(name, undefined as never, [op] as never, dest as never, undefined);
    expect(r).toEqual({ $: "Ok", _0: "NeedsReturn" });
    return [`${name} ${l[1]}`, want, dest.lanes!.map(bits_of)];
  }
  throw new Error(`unknown oracle line: ${l.join(" ")}`);
}

test("float intrinsics (math.rs / simd.rs dispatch) match the Miri oracle bit for bit", () => {
  const ecx = stand_in_ecx();
  let checked = 0;
  const bad: string[] = [];
  for (const l of lines) {
    const r = run_line(ecx, l);
    if (r === undefined) continue;
    checked++;
    const [what, want, got] = r;
    if (want.join() !== got.join()) bad.push(`${what} ${l.slice(1).join(" ")}: port ${got.map((b) => b.toString(16)).join(" ")}`);
  }
  expect(bad.slice(0, 10)).toEqual([]);
  // 18 inputs: 4 sqrt + 18*3 pow + 7*3 powi per input, + the SIMD lines; host-op lines only on the oracle host.
  expect(checked).toBe(HOST_OK ? lines.length : 18 * 4 + 18 * 7 * 3 + 5 + 9);
});

test("intrinsics the math / simd emulation does not know are NotSupported; the arg count is checked", () => {
  const ecx = stand_in_ecx();
  expect(ecx.emulate_intrinsic_by_name("no_such_intrinsic", undefined as never, [], slot("F32") as never, undefined)).toEqual({ $: "Ok", _0: "NotSupported" });
  expect(ecx.emulate_intrinsic_by_name("simd_no_such", undefined as never, [], slot("F32") as never, undefined)).toEqual({ $: "Ok", _0: "NotSupported" });
  expect(ecx.emulate_intrinsic_by_name("assert_inhabited", undefined as never, [], slot("F32") as never, undefined)).toEqual({ $: "Ok", _0: "NeedsReturn" });
  const r = check_intrinsic_arg_count([], 2);
  expect(r.$).toBe("Err");
  if (r.$ !== "Err") return;
  expect(r._0.kind()).toEqual({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "incorrect number of arguments for intrinsic: got 0, expected 2" } });
});

test("compute_crc32 matches the host's CRC32 / CRC32C instructions", () => {
  const POLY: Record<string, bigint> = { crc32c: 0x11edc6f41n, crc32: 0x104c11db7n };
  const rows = readFileSync(join(import.meta.dir, "crc32.oracle.txt"), "utf8").trim().split("\n").map((l) => l.split(" "));
  expect(rows.length).toBe(192);
  for (const [poly, bits, crc, data, want] of rows) {
    const got = compute_crc32(parseInt(crc!, 16), BigInt(`0x${data}`), Number(bits), POLY[poly!]!);
    expect(`${poly} ${bits} ${crc} ${data} ${got.toString(16).padStart(8, "0")}`).toBe(`${poly} ${bits} ${crc} ${data} ${want}`);
  }
});

test("aes::sub_word: FIPS-197 S-box and key expansion (Appendix A.1)", () => {
  expect(sub_word(0x00000000)).toBe(0x63636363);
  // i = 4: RotWord(w[3]) = cf4f3c09, SubWord = 8a84eb01; i = 8: RotWord = 8c050572 -> 64 6b 6b 40.
  expect(sub_word(0xcf4f3c09)).toBe(0x8a84eb01);
  expect(sub_word(0x8c050572)).toBe(0x646b6b40);
  expect(sub_word(0xffffffff)).toBe(0x16161616);
});

test("sha256::{sigma0, sigma1, round}: SHA-256(\"abc\") (FIPS 180-4 example)", () => {
  // prettier-ignore
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  // The one padded block of "abc".
  const w: number[] = new Array(64).fill(0);
  w[0] = 0x61626380;
  w[15] = 24;
  for (let i = 16; i < 64; i++) w[i] = (sigma1(w[i - 2]!) + w[i - 7]! + sigma0(w[i - 15]!) + w[i - 16]!) >>> 0;
  let state = H0.slice();
  for (let i = 0; i < 64; i++) state = round(state, (w[i]! + K[i]!) >>> 0);
  const digest = state.map((v, i) => ((v + H0[i]!) >>> 0).toString(16).padStart(8, "0")).join("");
  expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
