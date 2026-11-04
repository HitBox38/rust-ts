// Direct tests of lane miri-x86-b's entry points (avx, avx2, avx512, aesni, bmi, gfni, sha) against the Miri oracle.
//
// fixtures/*.rs are the programs and fixtures/*.oracle.txt their output on the isolated Miri
// (docs/handoff/miri-x86-b-probe/gen.ts regenerates them). Each result line is `<link name> <arg>.. => <dest>`. Here the port's `emulate_x86_*_intrinsic` runs on a stand-in
// `ecx`: `InterpCx.prototype` with operands and places over a byte buffer (`Slot`), so read_scalar / write_scalar /
// project_* / transmute / mem_copy are the test's, and everything between them is the port's own code.
//
// Lines that go through a helper of mod.rs (lane miri-x86-a) need a real interpreter: those, and the `stdarch` mask lines,
// are checked by running the whole programs through the port (handoff, "End to end").
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { interp_ok, type InterpResult, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

/** `exit`, stdout lines and stderr of an oracle fixture. */
function oracle(name: string): { exit: number; lines: string[]; stderr: string } {
  const text = readFileSync(join(FIXTURES, `${name}.oracle.txt`), "utf8");
  const m = /^exit: (\d+)\n--- stdout\n([\s\S]*?)--- stderr\n([\s\S]*)$/.exec(text);
  if (m === null) throw new Error(`bad fixture ${name}`);
  return { exit: Number(m[1]), lines: m[2]!.split("\n").filter((l) => l !== ""), stderr: m[3]! };
}

const layouts = new Map<string, Layout>();
interface Layout {
  ty: unknown;
  layout: unknown;
  size: Size;
  elem: number;
  field(cx: unknown, i: number): { size: Size };
}
/** One stand-in `TyAndLayout` per shape, so `TyAndLayout_eq` works by identity. */
function layout_of_shape(elem: number, len: number): Layout {
  const key = `${elem}x${len}`;
  let l = layouts.get(key);
  if (l === undefined) {
    const id = { key };
    l = { ty: id, layout: id, size: Size.from_bytes(elem * len), elem, field: () => ({ size: Size.from_bytes(elem) }) };
    layouts.set(key, l);
  }
  return l;
}
const U128 = layout_of_shape(16, 1);

/** An operand / place over `buf` at `off`. */
class Slot {
  constructor(
    public buf: Uint8Array,
    public off: number,
    public layout: Layout,
  ) {}
  get len(): number {
    return Number(this.layout.size.bytes()) / this.layout.elem;
  }
  transmute(layout: Layout, _ecx: unknown): InterpResult<Slot> {
    return interp_ok(new Slot(this.buf, this.off, layout));
  }
  force_mplace(_ecx: unknown): InterpResult<Slot> {
    return interp_ok(this);
  }
  ptr(): Slot {
    return this;
  }
  read(n: number): bigint {
    let v = 0n;
    for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(this.buf[this.off + i]!);
    return v;
  }
  write(n: number, v: bigint): void {
    for (let i = 0; i < n; i++) this.buf[this.off + i] = Number((v >> BigInt(i * 8)) & 0xffn);
  }
  hex(): string {
    const lanes: string[] = [];
    for (let i = 0; i < this.len; i++) lanes.push(new Slot(this.buf, this.off + i * this.layout.elem, this.layout).read(this.layout.elem).toString(16).padStart(this.layout.elem * 2, "0"));
    return lanes.join(",");
  }
}

/** A pointer into the fixtures' byte tables, where the byte at address `a` is `a` (the programs' `DATA` / `bytes`). */
class Addr {
  constructor(public addr: number) {}
  wrapping_signed_offset(i: bigint, _cx: unknown): Addr {
    return new Addr(this.addr + Number(i));
  }
}

const ELEM: Record<string, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, u64: 8, i64: 8, f64: 8, u128: 16 };

/** Parses `<ty>:<lanes>`: a scalar `u32:..` or a vector `u8x16:..`, lane 0 first. */
function parse_slot(tok: string, empty = false): Slot {
  const [ty, hex] = tok.split(":") as [string, string];
  const m = /^([a-z]+\d+)(?:x(\d+))?$/.exec(ty)!;
  const elem = ELEM[m[1]!]!;
  const lanes = hex.split(",");
  const len = m[2] === undefined ? 1 : Number(m[2]);
  const slot = new Slot(new Uint8Array(elem * len), 0, layout_of_shape(elem, len));
  if (!empty) lanes.forEach((l, i) => new Slot(slot.buf, i * elem, slot.layout).write(elem, BigInt(`0x${l}`)));
  return slot;
}

/** The stand-in `ecx` (header). `features` are the enabled target features. */
function stand_in_ecx(features: readonly string[]): MiriInterpCx {
  const enabled = new Set(features.map((f) => Symbol.intern(f)));
  const ecx = Object.create(InterpCx.prototype) as Record<string, unknown>;
  const tcx_ = { sess: { internal_target_features: enabled, target: { arch: { $: "X86_64" } } }, types: { u128: "u128" } };
  ecx.tcx = { deref: () => tcx_, tcx: tcx_ };
  ecx.machine = { layouts: { u128: U128 } };
  ecx.eval_context_mut = () => ecx;
  ecx.eval_context_ref = () => ecx;
  ecx.check_shim_sig_llvm_intrinsic = (_l: unknown, args: readonly unknown[], n: number) => {
    expect(args.length).toBe(n);
    return Ok(args);
  };
  ecx.read_scalar = (op: Slot): InterpResult<Scalar> => interp_ok(Scalar.from_uint(op.read(Number(op.layout.size.bytes())), op.layout.size));
  ecx.write_scalar = (v: Scalar, dest: Slot): InterpResult => {
    const r = Scalar.to_bits(v, dest.layout.size);
    if (r.$ === "Err") return r;
    dest.write(Number(dest.layout.size.bytes()), r._0);
    return interp_ok(undefined);
  };
  ecx.project_to_simd = (p: Slot): InterpResult<[Slot, bigint]> => interp_ok([p, BigInt(p.len)]);
  ecx.project_index = (p: Slot, i: bigint): InterpResult<Slot> => {
    expect(i < BigInt(p.len)).toBe(true);
    return interp_ok(new Slot(p.buf, p.off + Number(i) * p.layout.elem, layout_of_shape(p.layout.elem, 1)));
  };
  ecx.copy_op = (src: Slot, dest: Slot): InterpResult => {
    dest.write(Number(dest.layout.size.bytes()), src.read(Number(src.layout.size.bytes())));
    return interp_ok(undefined);
  };
  ecx.read_pointer = (p: Addr): InterpResult<Addr> => interp_ok(p);
  ecx.mem_copy = (src: Addr, dest: Slot, size: Size, nonoverlapping: boolean): InterpResult => {
    expect(nonoverlapping).toBe(true);
    for (let i = 0; i < Number(size.bytes()); i++) dest.buf[dest.off + i] = src.addr + i;
    return interp_ok(undefined);
  };
  ecx.layout_of = (ty: { n: number }): unknown => Ok(layout_of_shape(16, ty.n));
  return ecx as unknown as MiriInterpCx;
}

/** Calls the entry point `emulate_x86_intrinsic` would dispatch `link_name` to (mod.rs:28). */
function dispatch(ecx: MiriInterpCx, link_name: string, args: unknown[], dest: Slot): InterpResult<string> {
  const name = link_name.slice("llvm.x86.".length);
  const l = Symbol.intern(link_name);
  const a = args as never;
  const d = dest as never;
  if (name.startsWith("bmi.")) return ecx.emulate_x86_bmi_intrinsic(l, a, d);
  if (name.startsWith("vgf2p8affine") || name.startsWith("vgf2p8mulb")) return ecx.emulate_x86_gfni_intrinsic(l, a, d);
  if (name.startsWith("sha")) return ecx.emulate_x86_sha_intrinsic(l, a, d);
  if (name.startsWith("aesni.")) return ecx.emulate_x86_aesni_intrinsic(l, a, d);
  if (name.startsWith("avx.")) return ecx.emulate_x86_avx_intrinsic(l, a, d);
  if (name.startsWith("avx2.")) return ecx.emulate_x86_avx2_intrinsic(l, a, d);
  if (name.startsWith("avx512.")) return ecx.emulate_x86_avx512_intrinsic(l, a, d);
  throw new Error(`no entry point of this lane for ${link_name}`);
}

/** Runs the lines of fixture `name` selected by `direct`; returns how many were checked. */
function run_fixture(name: string, features: readonly string[], direct: (link_name: string) => boolean): number {
  const ecx = stand_in_ecx(features);
  let checked = 0;
  const bad: string[] = [];
  for (const line of oracle(name).lines) {
    const arrow = line.indexOf(" => ");
    if (arrow < 0 || line.startsWith("stdarch ")) continue;
    const toks = line.slice(0, arrow).split(" ");
    const link_name = toks[0]!;
    if (!direct(link_name)) continue;
    const args = toks.slice(1).map((t): unknown => {
      if (t === "ptr") return new Addr(64);
      if (t === "ptr:+1") return new Addr(1);
      return parse_slot(t);
    });
    const want = line.slice(arrow + 4);
    const dest = parse_slot(want, true);
    // Junk, so that an element the port should have written (or zeroed) cannot pass by accident.
    dest.buf.fill(0xaa);
    const r = dispatch(ecx, link_name, args, dest);
    checked++;
    const got = r.$ === "Ok" && r._0 === "NeedsReturn" ? `${want.split(":")[0]}:${dest.hex()}` : `result ${r.$}`;
    if (got !== want) bad.push(`${line}: port ${got}`);
  }
  expect(bad.slice(0, 5)).toEqual([]);
  return checked;
}

/** The `Ub` message of an error result. */
function ub_message(r: InterpResult<unknown>): string {
  expect(r.$).toBe("Err");
  const kind = (r as ReturnType<typeof Err<{ kind(): { $: string; _0: { $: string; _0: string } } }>>)._0.kind();
  expect(kind.$).toBe("UndefinedBehavior");
  return kind._0._0;
}

/** The first line of the oracle's error in a fixture, without `error: Undefined Behavior: `. */
function oracle_ub(name: string): string {
  const first = oracle(name).stderr.split("\n")[0]!;
  const prefix = "error: Undefined Behavior: ";
  expect(first.startsWith(prefix)).toBe(true);
  return first.slice(prefix.length);
}

const in_session = (f: () => void) => () => create_default_session_globals_then(f);

test("bmi: every line of bmi.rs (zero inputs, counts past the width) matches the oracle", in_session(() => {
  expect(run_fixture("bmi", ["bmi1", "bmi2"], () => true)).toBe(480);
}));

test("gfni: mulb and the affine forms (identity, zero, all-ones, AES matrices; 128/256/512) match the oracle", in_session(() => {
  expect(run_fixture("gfni", ["gfni", "avx", "avx512f"], () => true)).toBe(48);
}));

test("sha: rnds2 / msg1 / msg2 match the oracle", in_session(() => {
  expect(run_fixture("sha", ["sha"], () => true)).toBe(52);
}));

test("aesni: aeskeygenassist matches the oracle", in_session(() => {
  expect(run_fixture("aes_keygen", ["aes"], () => true)).toBe(9);
}));

test("avx512: pternlog and vpdpbusd match the oracle", in_session(() => {
  const features = ["avx512f", "avx512vl", "avx512vnni"];
  expect(run_fixture("avx512", features, (l) => l.includes("pternlog") || l.includes("vpdpbusd"))).toBe(16);
}));

test("avx: vpermilvar and ldu.dq match the oracle", in_session(() => {
  expect(run_fixture("avx", ["avx"], (l) => l.includes("vpermilvar") || l.includes("ldu.dq"))).toBe(9);
}));

test("avx2: every gather form (masks, scales, negative offsets, offsets / dest length mismatch) matches the oracle", in_session(() => {
  expect(run_fixture("avx2", ["avx2"], (l) => l.includes("gather"))).toBe(41);
}));

test("vzeroupper / vzeroall take no arguments and write nothing", in_session(() => {
  const ecx = stand_in_ecx(["avx"]);
  const dest = parse_slot("u8:00");
  expect(dispatch(ecx, "llvm.x86.avx.vzeroupper", [], dest)).toEqual(Ok("NeedsReturn"));
  expect(dispatch(ecx, "llvm.x86.avx.vzeroall", [], dest)).toEqual(Ok("NeedsReturn"));
  expect(dest.hex()).toBe("00");
}));

test("missing target features: the oracle's error text, per entry point", in_session(() => {
  const dest = parse_slot("u32:00000000");
  const u32 = () => parse_slot("u32:00000000");
  const none = stand_in_ecx([]);
  expect(ub_message(dispatch(none, "llvm.x86.bmi.pext.64", [u32(), u32()], dest))).toBe(oracle_ub("err_missing_bmi2"));
  expect(ub_message(dispatch(stand_in_ecx(["bmi2"]), "llvm.x86.bmi.bextr.32", [u32(), u32()], dest))).toBe(oracle_ub("err_missing_bmi1"));
  expect(ub_message(dispatch(none, "llvm.x86.aesni.aesenc", [u32(), u32()], dest))).toBe(oracle_ub("err_missing_aes"));
  expect(ub_message(dispatch(none, "llvm.x86.sha256msg1", [u32(), u32()], dest))).toBe(oracle_ub("err_missing_sha"));
  expect(ub_message(dispatch(none, "llvm.x86.vgf2p8mulb.128", [u32(), u32()], dest))).toBe(oracle_ub("err_missing_gfni"));
  expect(ub_message(dispatch(stand_in_ecx(["avx512f"]), "llvm.x86.avx512.pternlog.d.128", [u32(), u32(), u32(), u32()], dest))).toBe(oracle_ub("err_missing_avx512vl"));
}));

test("unknown names give NotSupported, after the same checks as the oracle's fixtures", in_session(() => {
  const dest = parse_slot("u32:00000000");
  const u32 = () => parse_slot("u32:00000000");
  // The oracle prints `can't call LLVM intrinsic ..` for these (err_notsupported_*.oracle.txt); that text is the caller's.
  for (const name of ["aesni", "avx", "avx512", "bmi", "gfni", "sha"]) {
    expect(oracle(`err_notsupported_${name}`).stderr).toContain("unsupported operation: can't call LLVM intrinsic");
  }
  expect(dispatch(stand_in_ecx(["aes"]), "llvm.x86.aesni.nonexistent", [], dest)).toEqual(Ok("NotSupported"));
  expect(dispatch(stand_in_ecx(["avx"]), "llvm.x86.avx.nonexistent", [], dest)).toEqual(Ok("NotSupported"));
  expect(dispatch(stand_in_ecx(["avx2"]), "llvm.x86.avx2.nonexistent", [], dest)).toEqual(Ok("NotSupported"));
  expect(dispatch(stand_in_ecx([]), "llvm.x86.avx512.nonexistent", [], dest)).toEqual(Ok("NotSupported"));
  expect(dispatch(stand_in_ecx(["sha"]), "llvm.x86.sha1rnds4", [], dest)).toEqual(Ok("NotSupported"));
  // `.16` strips to the empty name, which needs bmi2, then reads its two operands, then is not supported.
  expect(dispatch(stand_in_ecx(["bmi2"]), "llvm.x86.bmi.pext.16", [u32(), u32()], dest)).toEqual(Ok("NotSupported"));
  expect(ub_message(dispatch(stand_in_ecx(["bmi1"]), "llvm.x86.bmi.pext.16", [u32(), u32()], dest))).toContain("missing target feature bmi2");
  // `is_64_bit` follows the name's end, so a `.64` name on a 64-bit target gets as far as the unknown-name arm.
  expect(dispatch(stand_in_ecx(["bmi2"]), "llvm.x86.bmi.nonexistent.64", [parse_slot("u64:0000000000000000"), parse_slot("u64:0000000000000000")], dest)).toEqual(Ok("NotSupported"));
}));

test("64-bit bmi on a non-x86_64 target is not supported", in_session(() => {
  const ecx = stand_in_ecx(["bmi2"]);
  (ecx.tcx.deref().sess.target as unknown as { arch: { $: string } }).arch = { $: "X86" };
  const u64 = () => parse_slot("u64:0000000000000000");
  expect(dispatch(ecx, "llvm.x86.bmi.pext.64", [u64(), u64()], u64())).toEqual(Ok("NotSupported"));
}));

test("gather panics carry the oracle's text", in_session(() => {
  const ecx = stand_in_ecx(["avx2"]);
  const v = (t: string) => parse_slot(t);
  const z = "i32x4:00000000,00000000,00000000,00000000";
  const panic_of = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      if (e instanceof Panic) return e.message;
      throw e;
    }
    throw new Error("did not panic");
  };
  expect(oracle("err_gather_scale").exit).toBe(101);
  expect(`panicked: ${panic_of(() => dispatch(ecx, "llvm.x86.avx2.gather.d.d", [v(z), new Addr(0), v(z), v(z), v("i8:03")], v(z)))}\n`).toBe(oracle("err_gather_scale").stderr);
  expect(oracle("err_gather_overflow").exit).toBe(101);
  const o = v("i64x2:7fffffffffffffff,0000000000000000");
  const m = v("i32x4:ffffffff,ffffffff,ffffffff,ffffffff");
  expect(`panicked: ${panic_of(() => dispatch(ecx, "llvm.x86.avx2.gather.q.d", [v(z), new Addr(0), o, m, v("i8:08")], v(z)))}\n`).toBe(oracle("err_gather_overflow").stderr);
}));

test("the aes crate's calls stop unported (plan-m6 D5), after the operands are read", in_session(() => {
  const ecx = stand_in_ecx(["aes"]);
  const new_array = Ty.new_array;
  (Ty as { new_array: unknown }).new_array = (_tcx: unknown, _ty: unknown, n: number) => ({ n });
  try {
    const m = (t = "i64x2:0000000000000000,0000000000000000") => parse_slot(t);
    const unported_of = (name: string, args: Slot[]): string => {
      try {
        dispatch(ecx, name, args, m());
      } catch (e) {
        if (e instanceof Unported) return e.message;
        throw e;
      }
      throw new Error("did not stop");
    };
    expect(unported_of("llvm.x86.aesni.aesenc", [m(), m()])).toContain("aes::hazmat::cipher_round");
    expect(unported_of("llvm.x86.aesni.aesenclast", [m(), m()])).toContain("aes::hazmat::cipher_round");
    expect(unported_of("llvm.x86.aesni.aesdec", [m(), m()])).toContain("aes::hazmat::equiv_inv_cipher_round");
    expect(unported_of("llvm.x86.aesni.aesdeclast", [m(), m()])).toContain("aes::hazmat::equiv_inv_cipher_round");
    expect(unported_of("llvm.x86.aesni.aesimc", [m()])).toContain("aes::hazmat::inv_mix_columns");
  } finally {
    (Ty as { new_array: unknown }).new_array = new_array;
  }
}));

test("every fixture has the shape gen.ts writes, and the known-answer lines are the published values", () => {
  expect(oracle("sha").lines).toContain("sha256-abc ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(oracle("aes_keygen").lines).toContain("fips197-a1 rcon 36 key d014f9a8c9ee2589e13f0cc8b6630ca6");
  expect(oracle("aes_rounds").lines).toContain("fips197-c1 cipher 69c4e0d86a7b0430d8cdb78070b4c55a");
  expect(oracle("aes_rounds").lines).toContain("fips197-c1 plain 00112233445566778899aabbccddeeff");
});
