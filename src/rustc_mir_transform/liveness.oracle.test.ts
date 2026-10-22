// Oracle check of `check_liveness` (lane mt-liveness: liveness.ts) against the pinned nightly rustc: rendered stderr.
//
// Each case runs the test driver liveness_oracle/run.ts (see its header): the ported driver through type checking,
// then per body owner `check_unsafety`, `has_ffi_unwind_calls` and `check_liveness` on the real `mir_promoted`. The
// lints are built by rustc_mir_transform's generated diagnostics (diagnostics.ts) and rendered by the ported emitter.
// The oracle compiles the same file (`--emit=metadata`); both sides get `-A unused_mut` (a borrowck lint; `mir_borrowck`
// is not ported). The fixtures trigger nothing else the driver leaves out (borrowck errors, dead code, late lints), so
// the complete stderr and the exit code of both sides must be equal.
// (Before the generated diagnostics landed, this test compared structured lints taken from `pending` stand-ins.)
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

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

const WORK = join(DATA, "tmp", "liveness-oracle", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(REPO, "src/rustc_mir_transform/liveness_oracle/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}

// A no_core crate with the lang items the bodies need. Bodies: an unused argument, an unused local, an assigned-only
// local, a dead store overwritten later, an argument overwritten before use, `+=` self-assignments, a binding used only
// in a match guard, an unused match binding, struct-pattern shorthands, underscore names, a loop with a dead
// assignment, a binding that looks like a unit variant (typo suggestion), and a `mut` reference argument reassigned
// with a borrow (the `annotate_mut_binding_to_immutable_binding` suggestion).
const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features, non_snake_case)]",
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
  "#[lang = \"copy\"] pub trait Copy {}",
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  "impl<T: ?Sized> Copy for &T {}",
  "#[lang = \"add\"] pub trait Add<Rhs = Self> { type Output; fn add(self, rhs: Rhs) -> Self::Output; }",
  "impl Add for u8 { type Output = u8; fn add(self, rhs: u8) -> u8 { self + rhs } }",
  "#[lang = \"add_assign\"] pub trait AddAssign<Rhs = Self> { fn add_assign(&mut self, rhs: Rhs); }",
  "impl AddAssign for u8 { fn add_assign(&mut self, rhs: u8) { *self += rhs } }",
  "#[lang = \"legacy_receiver\"] pub trait LegacyReceiver {}",
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "impl<T: ?Sized> LegacyReceiver for &mut T {}",
  "#[lang = \"eq\"] pub trait PartialEq<Rhs: ?Sized = Self> { fn eq(&self, other: &Rhs) -> bool; }",
  "impl PartialEq for u8 { fn eq(&self, other: &u8) -> bool { *self == *other } }",
  "pub fn unused_param(x: u8) {}",
  "pub fn unused_local() { let y = 5u8; }",
  "pub fn assigned_only() { let mut z = 1u8; z = 2; }",
  "pub fn dead_store(a: u8) -> u8 { let mut b = a; b = 3; b }",
  "pub fn param_overwritten(mut p: u8) -> u8 { p = 4; p }",
  "pub fn self_add(mut c: u8) -> u8 { c += 1; 0 }",
  "pub fn self_add_used(mut d: u8) -> u8 { d += 1; d }",
  "pub enum Opt { Nothing, Just(u8) }",
  "pub fn guard_only(o: Opt) -> u8 { match o { Opt::Just(v) if v == 3 => 1, _ => 0 } }",
  "pub fn unused_arm(o: Opt) -> u8 { match o { Opt::Just(w) => 1, Opt::Nothing => 0 } }",
  "pub struct P { pub a: u8, pub b: u8 }",
  "pub fn shorthand(p: P) -> u8 { let P { a, b } = p; a }",
  "pub fn underscore(_u: u8) { let _v = 1u8; }",
  "pub fn last_assign(n: u8) -> u8 { let mut i = 0u8; let mut last = 0u8; loop { last = i; i = i + 1; if i == n { break; } } i }",
  "pub fn typo(o: Opt) -> u8 { match o { Nothng => 0 } }",
  "pub fn out_param<'a>(mut r: &'a u8, s: &'a u8) { r = &*s; }",
].join("\n");

function compare(name: string, src: string): void {
  mkdirSync(WORK, { recursive: true });
  const file = `${name}.rs`;
  writeFileSync(join(WORK, file), src);
  const args = ["--crate-type", "lib", "--edition", "2024", "-A", "unused_mut", "--emit=metadata", "-o", `lib${name}.rmeta`, file];
  const oracle = run([...RUSTC, ...args], WORK);
  const ours = run([process.execPath, RUNNER, ...args], WORK);
  // every warning is a liveness lint (the summary line aside)
  const lints = oracle.stderr.split("\n").filter((l) => l.startsWith("warning: ") && !/^warning: \d+ warnings? emitted/.test(l)).length;
  console.log(`liveness ${name}: ${lints} oracle liveness warnings`);
  expect(lints).toBeGreaterThan(3);
  expect(ours.stderr).not.toContain("rust-ts: ");
  if (ours.stderr !== oracle.stderr) {
    // Show the first differing line.
    const ol = oracle.stderr.split("\n");
    const pl = ours.stderr.split("\n");
    let k = 0;
    while (k < pl.length && ol[k] === pl[k]) k++;
    expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
  }
  expect(ours.code).toBe(oracle.code);
}

test.skipIf(SKIP)("check_liveness: unused_variables / unused_assignments as the oracle reports them", () => {
  compare("liveness", SRC);
});

// Closures (captures by value / by reference, an `FnMut` closure whose returns become `goto bb0`, dead captures passed
// back to the parent through the `check_liveness` query).
const CLOSURES = [
  "#![feature(no_core, lang_items, unboxed_closures)]",
  ...SRC.split("\n").slice(1, 19),
  "#[lang = \"tuple_trait\"] pub trait Tuple {}",
  "#[lang = \"fn_once\"] pub trait FnOnce<Args: Tuple> { #[lang = \"fn_once_output\"] type Output; extern \"rust-call\" fn call_once(self, args: Args) -> Self::Output; }",
  "#[lang = \"fn_mut\"] pub trait FnMut<Args: Tuple>: FnOnce<Args> { extern \"rust-call\" fn call_mut(&mut self, args: Args) -> Self::Output; }",
  "#[lang = \"fn\"] pub trait Fn<Args: Tuple>: FnMut<Args> { extern \"rust-call\" fn call(&self, args: Args) -> Self::Output; }",
  "pub fn move_assign(a: u8) -> u8 { let mut x = a; let f = move || { x = 5; }; a }",
  "pub fn ref_assign(a: u8) -> u8 { let mut x = a; let f = || { x = 6; }; x }",
  "pub fn unused_closures(a: u8) -> u8 { let x = a; let g = || x; let h = || 0u8; 1 }",
  "pub fn dead_capture(a: u8) -> u8 { let x = a; let k = move || { let y = x; 0u8 }; 2 }",
  "pub fn used_capture(a: u8) -> u8 { let x = a; let m = || x; 3 }",
].join("\n");

test.skipIf(SKIP)("check_liveness: closures and captures as the oracle reports them", () => {
  compare("liveness_closures", CLOSURES);
});
