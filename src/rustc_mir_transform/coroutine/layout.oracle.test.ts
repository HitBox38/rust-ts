// Oracle checks of `mir_coroutine_witnesses` (lane mt-coroutine-b: coroutine/layout.ts) against the pinned nightly rustc.
//
// Each case runs the test driver layout_oracle/run.ts (see its header): the ported driver through type checking, then
// per body owner `check_unsafety`, `has_ffi_unwind_calls`, `check_liveness` and, for coroutines, `mir_coroutine_witnesses`
// on the real `mir_promoted`. The cases are coroutine closures (`#[coroutine] [static] || { .. yield .. }`) in std
// crates: `async fn`s need the hidden type of their opaque return type, i.e. `mir_borrowck` (not ported).
// 1. `must_not_suspend` (`check_suspend_tys` / `check_must_not_suspend_ty` / `_def`): the complete rendered stderr and the
//    exit code equal the oracle's (`--emit=metadata`). The cases trigger nothing the driver leaves out (borrowck errors,
//    dead code, late lints).
// 2. The layout itself: the oracle prints a coroutine's `CoroutineLayout` only in the `-Zdump-mir` dump of its
//    `coroutine_resume` body (StateTransform's own `compute_layout` on runtime MIR). For bodies without drop glue to
//    elaborate and without fake borrows, that MIR has the same locals live across the same yields as `mir_promoted`, so
//    the two layouts are equal: the test compares the dump's `coroutine layout { .. }` block and its `coroutine debug`
//    lines (sorted) with the driver's `RUST_TS_DUMP_WITNESSES=1` output (same printer, `write_coroutine_layout`).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../../scripts/lib/common.ts";

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

const WORK = join(DATA, "tmp", "coroutine-layout-oracle", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(REPO, "src/rustc_mir_transform/coroutine/layout_oracle/run.ts");
const SYSROOT = HAVE ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE", "RUST_TS_DUMP_WITNESSES"].includes(k)) ENV[k] = v;
}
interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string, env: Record<string, string> = ENV): Out {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
function first_difference(ours: string, oracle: string): void {
  if (ours === oracle) return;
  const ol = oracle.split("\n");
  const pl = ours.split("\n");
  let k = 0;
  while (k < pl.length && ol[k] === pl[k]) k++;
  expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
}

const PRELUDE = [
  "#[must_not_suspend = \"You gotta use Umbrella's\"]",
  "pub struct Umbrella { pub i: i64 }",
  "#[must_not_suspend]",
  "pub trait Wow {}",
  "impl Wow for Umbrella {}",
  "pub static S: Umbrella = Umbrella { i: 7 };",
  "pub fn use_ref(_r: &Umbrella) {}",
  "pub fn bar() -> Umbrella { Umbrella { i: 1 } }",
];

// `must_not_suspend` through every arm of `check_must_not_suspend_ty`: a plain ADT with a reason, `Box` (boxed + its
// allocator), a reference (only held because the coroutine is immovable and the local is borrowed), a tuple and an array
// (plural), a trait object, a type seen in two variants (linted once), and a movable coroutine whose moved-out local is
// not saved at the later yields.
const LINTS = [
  "#![feature(coroutines, stmt_expr_attributes, must_not_suspend)]",
  "#![warn(must_not_suspend)]",
  ...PRELUDE,
  "pub fn plain() { let _c = #[coroutine] static || { let guard = bar(); yield; drop(guard); }; }",
  "pub fn boxed() { let _c = #[coroutine] static || { let guard = Box::new(bar()); yield; drop(guard); }; }",
  "pub fn borrowed() { let _c = #[coroutine] static || { let x = bar(); let r = &x; yield; use_ref(r); }; }",
  "pub fn tuple_and_array() { let _c = #[coroutine] static || { let t = (bar(), 1u8, bar()); let a = [bar(), bar()]; yield; drop(t); yield; drop(a); }; }",
  "pub fn dyn_trait() { let _c = #[coroutine] static || { let d: Box<dyn Wow> = Box::new(bar()); yield; drop(d); }; }",
  "pub fn dedup() { let _c = #[coroutine] static || { let a = bar(); yield; let b = bar(); yield; drop(a); drop(b); }; }",
  "pub fn movable(n: u8) { let _c = #[coroutine] move || { let a = bar(); yield n; drop(a); let b = 3u8; yield b; }; }",
].join("\n");

// `#![deny]`: the lint is an error, the compilation fails with rustc's exit code.
const DENY = [
  "#![feature(coroutines, stmt_expr_attributes, must_not_suspend)]",
  "#![deny(must_not_suspend)]",
  ...PRELUDE,
  "pub fn plain() { let _c = #[coroutine] static || { let guard = bar(); yield; drop(guard); }; }",
].join("\n");

// Layouts: disjoint scopes (no storage conflict between the saved locals), a local borrowed before the yield in an
// immovable (saved) and a movable (not saved) coroutine, a `static` reference (`ignore_for_traits`), resume arguments
// and upvars, chained borrows over three yields, and the `must_not_suspend` cases above.
const LAYOUTS = [
  "#![feature(coroutines, stmt_expr_attributes, must_not_suspend)]",
  "#![allow(must_not_suspend)]",
  ...PRELUDE,
  "pub fn disjoint() { let _c = #[coroutine] move || { { let a = bar(); yield; use_ref(&a); } { let b = (bar(), 2u32); yield; use_ref(&b.0); } }; }",
  "pub fn borrowed_before_yield_static() { let _c = #[coroutine] static || { let x = bar(); use_ref(&x); yield; }; }",
  "pub fn borrowed_before_yield_movable() { let _c = #[coroutine] || { let x = bar(); use_ref(&x); yield; }; }",
  "pub fn static_ref() { let _c = #[coroutine] || { let s = &S; yield; use_ref(s); }; }",
  "pub fn resume_and_upvar(u: u64) { let _c = #[coroutine] move |r: u32| { let k = r; let r2 = yield u; let q = (k, r2); yield u; let _z = q; }; }",
  "pub fn three(n: u8) { let _c = #[coroutine] static move || { let a = n; let b = &a; yield; let c = *b; yield; let d = [c; 4]; yield; let _e = d; }; }",
  ...LINTS.split("\n").slice(2 + PRELUDE.length),
].join("\n");

function args(name: string): string[] {
  return ["--crate-type", "lib", "--edition", "2021", "--emit=metadata", "-o", `lib${name}.rmeta`, `${name}.rs`];
}

function compare_stderr(name: string, src: string, expect_lints: number): void {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, `${name}.rs`), src);
  const oracle = run([...RUSTC, ...args(name)], WORK);
  const ours = run([process.execPath, RUNNER, "--sysroot", SYSROOT, ...args(name)], WORK);
  const lints = oracle.stderr.split("\n").filter((l) => /^(warning|error): .*held across a suspend point/.test(l)).length;
  console.log(`coroutine layout ${name}: ${lints} oracle must_not_suspend lints`);
  expect(lints).toBe(expect_lints);
  expect(ours.stderr).not.toContain("rust-ts: ");
  first_difference(ours.stderr, oracle.stderr);
  expect(ours.code).toBe(oracle.code);
}

test.skipIf(SKIP)("mir_coroutine_witnesses: must_not_suspend lints as the oracle reports them", () => {
  compare_stderr("coroutine_lints", LINTS, 10);
});

test.skipIf(SKIP)("mir_coroutine_witnesses: a denied must_not_suspend fails the compilation as in the oracle", () => {
  compare_stderr("coroutine_deny", DENY, 1);
});

test.skipIf(SKIP)("mir_coroutine_witnesses: layouts equal the oracle's coroutine_resume layout (no drops, no fake borrows)", () => {
  const name = "coroutine_layouts";
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, `${name}.rs`), LAYOUTS);
  const dump_dir = join(WORK, `${name}.mir`);
  rmSync(dump_dir, { recursive: true, force: true });
  const oracle = run([...RUSTC, ...args(name), "-Zdump-mir=coroutine_resume", `-Zdump-mir-dir=${dump_dir}`], WORK);
  expect(oracle.code).toBe(0);
  const ours = run([process.execPath, RUNNER, "--sysroot", SYSROOT, ...args(name)], WORK, { ...ENV, RUST_TS_DUMP_WITNESSES: "1" });
  expect(ours.stderr).not.toContain("rust-ts: ");
  expect(ours.code).toBe(0);

  const expected = new Map<string, string>();
  for (const f of readdirSync(dump_dir).sort()) {
    const m = /^[^.]+\.(.*)\.-------\.coroutine_resume\.0\.mir$/.exec(f);
    if (m === null) continue;
    const lines = readFileSync(join(dump_dir, f), "utf8").split("\n");
    const s = lines.indexOf("    coroutine layout {");
    const e = lines.indexOf("    }", s);
    expect(s).toBeGreaterThan(0);
    const dbg = lines.filter((l) => l.trim().startsWith("coroutine debug ")).map((l) => l.trim()).sort();
    expected.set(m[1]!.replaceAll("-", "::"), [...lines.slice(s, e + 1), ...dbg].join("\n"));
  }
  const actual = new Map<string, string>();
  for (const chunk of ours.stdout.split(/^== /m).slice(1)) {
    const [item, ...rest] = chunk.trimEnd().split("\n");
    const dbg = rest.filter((l) => l.startsWith("coroutine debug ")).sort();
    actual.set(item!, [...rest.filter((l) => !l.startsWith("coroutine debug ")), ...dbg].join("\n"));
  }
  console.log(`coroutine layout ${name}: ${expected.size} oracle coroutine layouts`);
  expect(expected.size).toBe(13);
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [item, text] of expected) {
    first_difference(`${item}\n${actual.get(item)}`, `${item}\n${text}`);
  }
});
