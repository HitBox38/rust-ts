// Tests of lane ctfe-a: rustc_const_eval const_eval/error.rs (no upstream unit tests).
// - `Display` of `ConstEvalErrKind` against the pinned rustc: CTFE reports a `MachineStop` as `error[E0080]: {error}`
//   (const_eval/error.rs:191 `error.to_string()`), so each message of the program below is `display_InterpErrorKind`
//   of the `ConstEvalErrKind` raised there (boxed by `ConstEvalErrKind_into_InterpErrorInfo`);
// - `throw_machine_stop_str!`'s `Zst` (dummy_machine.rs) displays its message.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import "../lib.ts";
import { display_InterpErrorKind } from "../../rustc_middle/mir/interpret/mod.ts";
import { ConstInt } from "../../rustc_middle/ty/consts/int.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { type ConstEvalErrKind, ConstEvalErrKind_into_InterpErrorInfo, display_ConstEvalErrKind } from "./error.ts";
import { display_Zst, Zst } from "./dummy_machine.ts";

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

const PROGRAM = `#![allow(unused, static_mut_refs)]
static mut S: i32 = 0;
const A: () = panic!("boom");
const B: i32 = unsafe { S };
const fn add(a: u8) -> u8 { a + 1 }
const C: u8 = add(255);
const fn div(a: i32, b: i32) -> i32 { a / b }
const D: i32 = div(1, 0);
const fn idx(a: &[u8], i: usize) -> u8 { a[i] }
const E: u8 = idx(&[1, 2], 5);
fn main() { let _ = (A, B, C, D, E); }
`;

/** The `ConstEvalErrKind`s `PROGRAM`'s consts raise, in order (x86_64: `usize` is 8 bytes). */
function errors(): ConstEvalErrKind[] {
  const u8 = (n: number): ConstInt => new ConstInt(ScalarInt.from_u8(n), false, false);
  const usize = (n: bigint): ConstInt => new ConstInt(ScalarInt.from_u64(n), false, true);
  return [
    { $: "Panic", msg: Symbol.intern("boom"), line: 3, col: 15, file: Symbol.intern("ctfe_kind_errors.rs") },
    { $: "ConstAccessesMutGlobal" },
    { $: "AssertFailure", _0: { $: "Overflow", _0: "Add", _1: u8(255), _2: u8(1) } },
    { $: "AssertFailure", _0: { $: "DivisionByZero", _0: new ConstInt(ScalarInt.from_i32(1), true, false) } },
    { $: "AssertFailure", _0: { $: "BoundsCheck", len: usize(2n), index: usize(5n) } },
  ];
}
/** The oracle's messages (captured from the pinned rustc; re-checked live below). */
const EXPECTED = [
  "evaluation panicked: boom",
  "constant accesses mutable global memory",
  "attempt to compute `u8::MAX + 1_u8`, which would overflow",
  "attempt to divide `1_i32` by zero",
  "index out of bounds: the length is 2 but the index is 5",
];

test("Display of ConstEvalErrKind (as a MachineStop) = the captured oracle messages", () => {
  create_default_session_globals_then(() => {
    const errs = errors();
    expect(errs.map((e) => display_ConstEvalErrKind(e, PLAIN))).toEqual(EXPECTED);
    expect(errs.map((e) => display_InterpErrorKind(ConstEvalErrKind_into_InterpErrorInfo(e).into_kind()))).toEqual(EXPECTED);
    const k = ConstEvalErrKind_into_InterpErrorInfo({ $: "RecursiveStatic" }).into_kind();
    expect(k.$).toBe("MachineStop");
    if (k.$ === "MachineStop") expect(k._0.debug(PLAIN)).toBe("RecursiveStatic");
  });
});

test("throw_machine_stop_str!'s Zst displays its message", () => {
  const z = new Zst("pointer arithmetic is not handled");
  expect(display_Zst(z, PLAIN)).toBe("pointer arithmetic is not handled");
  expect(z.display()).toBe("pointer arithmetic is not handled");
  expect(z.debug(PLAIN)).toBe("Zst");
});

test.skipIf(SKIP)("Display of ConstEvalErrKind = the pinned rustc's E0080 messages (live)", () => {
  const work = join(DATA, "tmp", "ctfe-a", process.env.RUST_TS_AGENT ?? "default");
  mkdirSync(work, { recursive: true });
  const file = join(work, "ctfe_kind_errors.rs");
  writeFileSync(file, PROGRAM);
  const r = Bun.spawnSync([...RUSTC, "--edition=2021", "-o", join(work, "ctfe_kind_errors"), file], {
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
