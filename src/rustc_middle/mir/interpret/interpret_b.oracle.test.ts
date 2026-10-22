// Tests of lane mir-interp-b: rustc_middle mir/interpret/{mod, value, pointer, error, queries}.rs (no upstream unit tests).
// - `Display` of interpreter errors against the pinned rustc: CTFE reports every `UndefinedBehavior` / `Unsupported`
//   error as `error[E0080]: {error}` (rustc_const_eval const_eval/error.rs:191 `error.to_string()`), so each message of
//   the program below is `display_InterpErrorKind` of the error value built here (same `AllocId`s as the oracle's run);
// - `Pointer` / `CtfeProvenance` / `Scalar` Debug and Display (`const {alloc1: &i32}` in `-Zunpretty=mir`);
// - `AllocMap` reservation order (plan-m4 D13) on a scripted sequence of `reserve_*` calls;
// - target-endian integer access, `InterpResult` helpers.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";
import "../../lib.ts";
import { Align, Size } from "../../../rustc_abi/lib.ts";
import { CrateNum, DefId, DefIndex, type LocalDefId } from "../../../rustc_span/def_id.ts";
import { PLAIN, PRETTY } from "../../../std/fmt.ts";
import { Panic } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { ScalarInt } from "../../ty/consts/int.ts";
import { TyCtxt } from "../../ty/context.ts";
import type { ConstAllocation } from "./allocation.ts";
import {
  type AllocId,
  AllocMap,
  CtfeProvenance,
  CtfeProvenance_from_AllocId,
  debug_CtfeProvenance,
  debug_Pointer,
  debug_Pointer_Option,
  debug_Scalar,
  display_InterpErrorKind,
  display_Pointer_Option,
  display_Scalar,
  type InterpErrorKind,
  InterpErrorInfo_from_InterpErrorKind,
  InterpResult,
  interp_ok,
  lower_hex_Scalar,
  Pointer,
  Pointer_from_AllocId,
  read_target_uint,
  Scalar,
  write_target_uint,
} from "./mod.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const id = (n: number): AllocId => n as AllocId;

// ---- interpreter error Display vs the oracle's E0080 messages ----

const PROGRAM = `#![allow(unused)]
const A: i32 = unsafe { *(&[1i32, 2, 3] as *const i32).add(3) };
const B: i32 = unsafe { *(16 as *const i32) };
const C: i32 = unsafe { *(0 as *const i32) };
const D: () = unsafe { std::hint::unreachable_unchecked() };
const E: usize = unsafe { std::mem::transmute(&0u8) };
const F: i32 = unsafe { *(&[1i32, 2] as *const i32).offset(-1) };
const G: i32 = unsafe { *((&[1i32, 2, 3] as *const i32 as *const u8).add(1) as *const i32) };
const H: u8 = unsafe { *(&[1u8, 2, 3] as *const u8).add(1).offset(-2) };
const K: [i32; 2] = unsafe { *((&[1i32, 2, 3] as *const i32).add(2) as *const [i32; 2]) };
const L: u8 = unsafe { *(&[1u8] as *const u8).add(1) };
const M: i32 = unsafe { std::ptr::read_unaligned((8usize as *const u8).cast::<i32>()) };
fn main() { let _ = (A, B, C, D, E, F, G, H, K, L, M); }
`;

const ub = (_0: InterpErrorKind & { $: "UndefinedBehavior" } extends { _0: infer U } ? U : never): InterpErrorKind => ({
  $: "UndefinedBehavior",
  _0,
});
const MEM = { $: "MemoryAccess" } as const;
const ARITH = { $: "InboundsPointerArithmetic" } as const;
const align = (bytes: number): Align => {
  const r = Align.from_bytes(bytes);
  if (r.$ === "Err") throw new Error("bad align");
  return r._0;
};
/** The errors of `PROGRAM`'s consts, in order; the `AllocId`s are the oracle's (its CTFE interns in this order). */
const ERRORS: InterpErrorKind[] = [
  ub({ $: "PointerOutOfBounds", alloc_id: id(3), alloc_size: Size.from_bytes(12), ptr_offset: 12, inbounds_size: 4, msg: MEM }),
  ub({ $: "DanglingIntPointer", addr: 16, inbounds_size: 4, msg: MEM }),
  ub({ $: "DanglingIntPointer", addr: 0, inbounds_size: 4, msg: MEM }),
  ub({ $: "Unreachable" }),
  { $: "Unsupported", _0: { $: "ReadPointerAsInt", _0: undefined } },
  ub({ $: "PointerOutOfBounds", alloc_id: id(13), alloc_size: Size.from_bytes(8), ptr_offset: 0, inbounds_size: -4, msg: ARITH }),
  ub({ $: "AlignmentCheckFailed", _0: { has: align(1), required: align(4) }, _1: "BasedOn" }),
  ub({ $: "PointerOutOfBounds", alloc_id: id(19), alloc_size: Size.from_bytes(3), ptr_offset: 1, inbounds_size: -2, msg: ARITH }),
  ub({ $: "PointerOutOfBounds", alloc_id: id(22), alloc_size: Size.from_bytes(12), ptr_offset: 8, inbounds_size: 8, msg: MEM }),
  ub({ $: "PointerOutOfBounds", alloc_id: id(26), alloc_size: Size.from_bytes(1), ptr_offset: 1, inbounds_size: 1, msg: MEM }),
  ub({ $: "DanglingIntPointer", addr: 8, inbounds_size: 4, msg: MEM }),
];
/** The oracle's messages (captured from the pinned rustc; re-checked live below). */
const EXPECTED = [
  "memory access failed: attempting to access 4 bytes, but got alloc3+0xc which is at or beyond the end of the allocation of size 12 bytes",
  "memory access failed: attempting to access 4 bytes, but got 0x10[noalloc] which is a dangling pointer (it has no provenance)",
  "memory access failed: attempting to access 4 bytes, but got null pointer",
  "entering unreachable code",
  "unable to turn pointer into integer",
  "in-bounds pointer arithmetic failed: attempting to offset pointer by -4 bytes, but got alloc13 which is at the beginning of the allocation",
  "accessing memory based on pointer with alignment 1, but alignment 4 is required",
  "in-bounds pointer arithmetic failed: attempting to offset pointer by -2 bytes, but got alloc19+0x1 which is only 1 bytes from the beginning of the allocation",
  "memory access failed: attempting to access 8 bytes, but got alloc22+0x8 which is only 4 bytes from the end of the allocation",
  "memory access failed: attempting to access 1 byte, but got alloc26+0x1 which is at or beyond the end of the allocation of size 1 byte",
  "memory access failed: attempting to access 4 bytes, but got 0x8[noalloc] which is a dangling pointer (it has no provenance)",
];

test("Display of interpreter errors = the captured oracle messages", () => {
  expect(ERRORS.map(display_InterpErrorKind)).toEqual(EXPECTED);
  // `InterpErrorInfo::to_string` (no CTFE backtrace outside a `TyCtxt`)
  expect(InterpErrorInfo_from_InterpErrorKind(ERRORS[3]!).to_string()).toBe("entering unreachable code");
});

test.skipIf(SKIP)("Display of interpreter errors = the pinned rustc's E0080 messages (live)", () => {
  const work = join(DATA, "tmp", "mir-interp-b", process.env.RUST_TS_AGENT ?? "default");
  mkdirSync(work, { recursive: true });
  const file = join(work, "ctfe_errors.rs");
  writeFileSync(file, PROGRAM);
  const r = Bun.spawnSync([...RUSTC, "--edition=2021", "-o", join(work, "ctfe_errors"), file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
  });
  const msgs = r.stderr
    .toString()
    .split("\n")
    .filter((l) => l.startsWith("error[E0080]: "))
    .map((l) => l.slice("error[E0080]: ".length));
  expect(msgs).toEqual(EXPECTED);
});

test("Display of the other error kinds", () => {
  expect(display_InterpErrorKind(ub({ $: "InvalidBool", _0: 3 }))).toBe("interpreting an invalid 8-bit value as a bool: 0x03");
  expect(display_InterpErrorKind(ub({ $: "InvalidChar", _0: 0xd800 }))).toBe("interpreting an invalid 32-bit value as a char: 0x0000d800");
  expect(display_InterpErrorKind(ub({ $: "BoundsCheckFailed", len: 3, index: 5 }))).toBe("indexing out of bounds: the len is 3 but the index is 5");
  expect(display_InterpErrorKind(ub({ $: "PointerUseAfterFree", _0: id(4), _1: { $: "Dereferenceable", _0: "pointer" } }))).toBe(
    "pointer not dereferenceable: alloc4 has been freed, so this pointer is dangling",
  );
  expect(
    display_InterpErrorKind(ub({ $: "DanglingIntPointer", addr: 16, inbounds_size: 0, msg: { $: "Dereferenceable", _0: "pointer" } })),
  ).toBe("pointer not dereferenceable: pointer must point to some allocation, but got 0x10[noalloc] which is a dangling pointer (it has no provenance)");
  expect(display_InterpErrorKind(ub({ $: "InvalidTag", _0: { $: "Int", _0: ScalarInt.from_u8(7) } }))).toBe("enum value has invalid tag: 0x07");
  expect(display_InterpErrorKind({ $: "ResourceExhaustion", _0: "StackFrameLimitReached" })).toBe(
    "reached the configured maximum number of stack frames",
  );
  expect(display_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } })).toBe("encountered overly generic constant");
});

// ---- Pointer / CtfeProvenance / Scalar formatting ----

test("CtfeProvenance bits and Debug", () => {
  const p = CtfeProvenance_from_AllocId(id(5));
  expect(p).toBe(5n as CtfeProvenance);
  expect(CtfeProvenance.into_parts(p)).toEqual([id(5), false, false]);
  const imm = CtfeProvenance.as_immutable(p);
  expect(CtfeProvenance.into_parts(imm)).toEqual([id(5), true, true]); // immutable implies shared_ref
  expect(CtfeProvenance.into_parts(CtfeProvenance.as_shared_ref(p))).toEqual([id(5), false, true]);
  expect(CtfeProvenance.from_parts([id(5), true, false])).toBe(imm);
  expect(CtfeProvenance.from_parts([id(5), false, true])).toBe(CtfeProvenance.as_shared_ref(p));
  expect(debug_CtfeProvenance(imm, PLAIN)).toBe("alloc5<imm>");
  expect(debug_CtfeProvenance(imm, PRETTY)).toBe("a5<imm>");
  // an `AllocId` that is only flag bits: `alloc_id()`'s `NonZero::new(..).unwrap()` fails before the assertion (as upstream)
  expect(() => CtfeProvenance_from_AllocId(Number(1n << 62n) as AllocId)).toThrow("called `Option::unwrap()` on a `None` value");
});

test("Pointer Debug / Display (`const {alloc1: &i32}` in -Zunpretty=mir)", () => {
  const p = Pointer_from_AllocId(id(1));
  expect(debug_Pointer(p, PLAIN, debug_CtfeProvenance)).toBe("alloc1");
  const q = new Pointer(Size.from_bytes(12), CtfeProvenance.as_immutable(CtfeProvenance_from_AllocId(id(3))));
  expect(debug_Pointer(q, PLAIN, debug_CtfeProvenance)).toBe("alloc3+0xc<imm>");
  expect(debug_Pointer(q, PRETTY, debug_CtfeProvenance)).toBe("a3+0xc<imm>");
  const r = Pointer.new(id(3), Size.from_bytes(4)); // Pointer<AllocId>
  expect(debug_Pointer(r, PLAIN, () => "")).toBe("alloc3+0x4");
  expect(debug_Pointer_Option(Pointer.without_provenance<AllocId>(16n), PLAIN, () => "")).toBe("0x10[noalloc]");
  expect(display_Pointer_Option(Pointer.null<AllocId>(), PLAIN)).toBe("null pointer");
  expect(display_Pointer_Option(Pointer.without_provenance<AllocId>(16n), PLAIN)).toBe("0x10[noalloc]");
  // `Pointer<Option<AllocId>>` through the generated Debug (`debug_Pointer` with a `None` provenance)
  expect(debug_Pointer(Pointer.without_provenance<AllocId>(1n), PLAIN, () => "")).toBe("0x1[noalloc]");
  expect(p.into_pointer_or_addr()).toEqual(Ok(p));
  expect(Pointer.without_provenance<AllocId>(16n).into_pointer_or_addr()).toEqual(Err(Size.from_bytes(16)));
  expect(() => Pointer.null<AllocId>().addr()).toThrow("Prov::OFFSET_IS_ADDR");
});

/** A `HasDataLayout` for 64-bit and 32-bit targets (only `pointer_size` / `pointer_offset` are read). */
const cx = (bytes: number) => ({
  data_layout: () => ({ pointer_size: () => Size.from_bytes(bytes), pointer_offset: () => Size.from_bytes(bytes) }) as never,
});

test("Scalar formatting and conversions", () => {
  const five = Scalar.from_u8<CtfeProvenance>(5);
  expect(debug_Scalar(five, PLAIN, debug_CtfeProvenance)).toBe("0x05");
  expect(display_Scalar(five, PLAIN)).toBe("5");
  expect(lower_hex_Scalar(five, PLAIN)).toBe("0x05");
  const ptr = Scalar.from_pointer(Pointer_from_AllocId(id(2)), cx(8));
  expect(ptr).toEqual({ $: "Ptr", _0: Pointer_from_AllocId(id(2)), _1: 8 });
  expect(debug_Scalar(ptr, PRETTY, debug_CtfeProvenance)).toBe("alloc2"); // `{ptr:?}`: fresh flags
  expect(display_Scalar(ptr, PLAIN)).toBe("pointer to alloc2");
  expect(Scalar.size(ptr).bytes()).toBe(8);
  // ptr-to-int fails: the erased `Scalar<AllocId>` and `ReadPointerAsInt`
  expect(Scalar.try_to_scalar_int(ptr)).toEqual(Err({ $: "Ptr", _0: Pointer.new(id(2), Size.ZERO), _1: 8 }));
  const r = Scalar.to_u64(ptr);
  expect(r.$ === "Err" && display_InterpErrorKind(r._0.kind())).toBe("unable to turn pointer into integer");
  expect(() => Scalar.assert_scalar_int(ptr)).toThrow("got a pointer where a ScalarInt was expected: alloc2");
  // ints
  expect(Scalar.to_i8(Scalar.from_int(-1n, Size.from_bytes(1)))).toEqual(Ok(-1));
  expect(Scalar.to_u64(Scalar.from_uint((1n << 64n) - 1n, Size.from_bytes(8)))).toEqual(Ok((1n << 64n) - 1n));
  expect(Scalar.to_target_isize(Scalar.from_target_isize(-2n, cx(4)), cx(4))).toEqual(Ok(-2n));
  expect(() => Scalar.from_uint(256n, Size.from_bytes(1))).toThrow("Unsigned value 0x100 does not fit in 8 bits");
  expect(() => Scalar.from_int(-129n, Size.from_bytes(1))).toThrow(
    "Signed value 0xffffffffffffffffffffffffffffff7f does not fit in 8 bits",
  );
  expect(() => Scalar.to_bits(five, Size.ZERO)).toThrow("you should never look at the bits of a ZST");
  expect(() => Scalar.to_u16(five)).toThrow("ScalarInt has size 1 but expected 2");
  expect(Scalar.to_bool(Scalar.from_bool(true))).toEqual(Ok(true));
  const bad = Scalar.to_bool(Scalar.from_u8(3));
  expect(bad.$ === "Err" && display_InterpErrorKind(bad._0.kind())).toBe("interpreting an invalid 8-bit value as a bool: 0x03");
  const badc = Scalar.to_char(Scalar.from_u32(0xd800));
  expect(badc.$ === "Err" && display_InterpErrorKind(badc._0.kind())).toBe("interpreting an invalid 32-bit value as a char: 0x0000d800");
  // pointers out of ints, ints out of pointers
  expect(Scalar.to_pointer(Scalar.from_target_usize(16n, cx(8)), cx(8))).toEqual(Pointer.without_provenance(16n));
  expect(Scalar.from_maybe_pointer(Pointer.without_provenance<CtfeProvenance>(16n), cx(4))).toEqual(
    Scalar.from_uint(16n, Size.from_bytes(4)),
  );
  const s = { value: ptr };
  expect(Scalar.clear_provenance(s).$).toBe("Err");
  const t = { value: five };
  expect(Scalar.clear_provenance(t)).toEqual(Ok(undefined));
  expect(() => Scalar.to_bits_or_ptr_internal(ptr, Size.from_bytes(4))).toThrow("Scalar pointer has size 8 but expected 4");
});

// ---- AllocMap: D13 reservation order ----

test("AllocId reservation order on a scripted sequence (D13)", () => {
  const tcx = Object.create(TyCtxt.prototype) as TyCtxt;
  Object.defineProperty(tcx, "gcx", { value: { alloc_map: AllocMap.new() } });
  const s1 = new DefId(DefIndex.from_u32(1), CrateNum.from_u32(0));
  const s2 = new DefId(DefIndex.from_u32(2), CrateNum.from_u32(0));
  const s1_again = new DefId(DefIndex.from_u32(1), CrateNum.from_u32(0));
  const mem = { inner: () => ({ mutability: "Not" }) } as unknown as ConstAllocation;
  const seq = [
    tcx.reserve_and_set_static_alloc(s1), // 1
    tcx.reserve_alloc_id(), // 2 (reserved, nothing set)
    tcx.reserve_and_set_static_alloc(s2), // 3
    tcx.reserve_and_set_static_alloc(s1_again), // dedup: 1
    tcx.reserve_and_set_memory_alloc(mem), // 4 (never deduplicated)
    tcx.reserve_and_set_memory_alloc(mem), // 5
    tcx.reserve_and_set_static_alloc(s2), // dedup: 3
  ];
  expect(seq).toEqual([1, 2, 3, 1, 4, 5, 3].map(id));
  expect(tcx.global_alloc(id(1))).toEqual({ $: "Static", _0: s1 });
  expect(tcx.global_alloc(id(4))).toEqual({ $: "Memory", _0: mem });
  expect(tcx.try_get_global_alloc(id(2))).toBeUndefined();
  expect(() => tcx.global_alloc(id(2))).toThrow("could not find allocation for alloc2");
  // `set_nested_alloc_id_static` fills a reserved id
  tcx.set_nested_alloc_id_static(id(2), 7 as LocalDefId);
  expect(tcx.try_get_global_alloc(id(2))).toEqual({ $: "Static", _0: new DefId(DefIndex.from_u32(7), CrateNum.from_u32(0)) });
  // dedup-reserving mutable memory is a bug
  const mut_mem = { inner: () => ({ mutability: "Mut" }) } as unknown as ConstAllocation;
  expect(() => tcx.reserve_and_set_memory_dedup(mut_mem, 0)).toThrow("trying to dedup-reserve mutable memory");
});

// ---- target-endian integers, InterpResult ----

test("read_target_uint / write_target_uint", () => {
  const b = new Uint8Array(4);
  expect(write_target_uint("Little", b, 0x01020304n)).toEqual(Ok(undefined));
  expect([...b]).toEqual([4, 3, 2, 1]);
  expect(read_target_uint("Little", b)).toEqual(Ok(0x01020304n));
  expect(write_target_uint("Big", b, 0x01020304n)).toEqual(Ok(undefined));
  expect([...b]).toEqual([1, 2, 3, 4]);
  expect(read_target_uint("Big", b)).toEqual(Ok(0x01020304n));
  const w = new Uint8Array(16);
  write_target_uint("Big", w, (1n << 128n) - 2n);
  expect(read_target_uint("Big", w)).toEqual(Ok((1n << 128n) - 2n));
  expect(read_target_uint("Little", w.subarray(14, 16))).toEqual(Ok(0xfeffn));
});

test("InterpResult helpers", () => {
  const e = InterpErrorInfo_from_InterpErrorKind(ub({ $: "Unreachable" }));
  const err: InterpResult<number> = Err(e);
  expect(InterpResult.map(interp_ok(2), (x) => x + 1)).toEqual(Ok(3));
  expect(InterpResult.discard_err(err)).toBeUndefined();
  expect(InterpResult.and(interp_ok(1), interp_ok("a"))).toEqual(Ok([1, "a"]));
  expect(InterpResult.and(err, interp_ok("a"))).toEqual(err);
  // `collect::<InterpResult<Vec<_>>>()` stops at the first error
  const seen: number[] = [];
  const items: Result<number, typeof e>[] = [Ok(1), Ok(2), err, Ok(4)];
  const collected = InterpResult.from_iter(items, (it) => {
    for (const x of it) seen.push(x);
    return seen;
  });
  expect(collected).toEqual(Err(e));
  expect(seen).toEqual([1, 2]);
  expect(InterpResult.map_err_kind(err, () => ({ $: "InvalidProgram", _0: { $: "TooGeneric" } })).$).toBe("Err");
  expect(display_InterpErrorKind(e.kind())).toBe("encountered overly generic constant");
  expect(() => InterpResult.unwrap(Err(InterpErrorInfo_from_InterpErrorKind(ub({ $: "DeadLocal" }))))).toThrow(Panic);
});
