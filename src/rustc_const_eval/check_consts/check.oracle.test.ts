// Oracle scenarios for check_consts/check.rs + ops.rs (lane const-check) against the pinned nightly rustc.
//
// Subject: check_oracle/run.ts (the ported driver up to the global ctxt, then what `mir_const_qualif` does for every
// const-context body: `Checker::check_body` on the built MIR). Oracle: `rustc <file> --crate-type lib --edition 2021
// --emit=metadata` (stderr). Both sides compile the same file against the pinned toolchain's sysroot.
//
// Every case is a crate whose only errors are const-checking errors (E0015 non-const calls in their desugared forms,
// E0492 / E0764 escaping borrows, E0493 live drops, E0658 feature-gated ops, function-pointer calls, raw pointer
// casts and comparisons), so the subject's whole stderr must equal the oracle's, byte for byte.
//
// PENDING: while check_consts/{mod, qualifs, resolver, post_drop_elaboration}.rs (lane mt-promote) or
// rustc_mir_dataflow's storage_liveness.rs (lane dataflow-impls) are stubs on this branch, a body stops UNPORTED in
// them; such a case is reported PENDING (and passes). Any other UNPORTED stop fails.
//
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";

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
const SYSROOT = HAVE ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";

const WORK = test_scratch_dir("const-check-oracle");
const RUNNER = join(REPO, "src/rustc_const_eval/check_consts/check_oracle/run.ts");
const ARGS = ["--crate-type", "lib", "--edition", "2021"];

/** `unported(..)` stops in other lanes' stub modules (see the header). */
const PENDING_STUBS = [
  "rustc_const_eval::check_consts::ConstCx::",
  "rustc_const_eval::check_consts::rustc_allow_const_fn_unstable",
  "rustc_const_eval::check_consts::is_fn_or_trait_safe_to_expose_on_stable",
  "rustc_const_eval::check_consts::qualifs::",
  "rustc_const_eval::check_consts::resolver::",
  "rustc_const_eval::check_consts::post_drop_elaboration::",
  "rustc_mir_dataflow::impls::storage_liveness::",
];

interface Case {
  name: string;
  body: string;
  /** Number of `error` blocks in the oracle's stderr (aborting line included), as a guard on the scenario. */
  errors: number;
}

const CASES: Case[] = [
  { name: "non-const-fn-in-const-and-const-fn", body: "fn nc() -> u8 { 1 }\npub const C: u8 = nc();\npub const fn f() -> u8 { nc() }", errors: 3 },
  { name: "non-const-fn-in-static", body: "pub fn nc() -> i32 { 1 }\npub static S: i32 = nc();", errors: 2 },
  {
    name: "escaping-borrows-live-drop-fn-ptr",
    body: "use std::cell::Cell;\npub const X: &Cell<i32> = &Cell::new(0);\npub const Y: &mut i32 = &mut 0;\npub const fn d<T>(x: T) {}\npub const fn g(f: fn()) { f() }",
    errors: 5,
  },
  { name: "ptr-to-int-cast", body: "pub const fn h(p: *const u8) -> usize { p as usize }", errors: 2 },
  { name: "raw-ptr-comparison", body: "pub const fn k(a: *const u8, b: *const u8) -> bool { a == b }", errors: 2 },
  { name: "trait-method-call", body: "pub const fn t<T: Default>() -> T { T::default() }", errors: 2 },
  { name: "for-loop", body: "pub const fn fl() { for _ in 0..3 {} }", errors: 4 },
  { name: "question-mark", body: "pub const fn q(o: Option<i32>) -> Option<i32> { let x = o?; Some(x) }", errors: 4 },
  { name: "format-args", body: 'pub const fn fm() { let _ = format_args!("{}", 1); }', errors: 2 },
  { name: "closure-call", body: "pub const fn cl(f: impl Fn()) { f() }", errors: 3 },
  { name: "match-str", body: 'pub const fn m(s: &str) -> bool { match s { "a" => true, _ => false } }', errors: 3 },
  { name: "async-block", body: "pub const fn a() { let _ = async {}; }", errors: 2 },
  { name: "no-errors-static-ref", body: "pub static A: u8 = 1;\npub static B: &u8 = &A;\npub const fn ok(x: u8) -> u8 { x + 1 }", errors: 0 },
  { name: "non-const-trait", body: "pub trait Tr { fn m(&self); }\npub const fn tr<T: Tr>(t: &T) { t.m() }", errors: 2 },
  { name: "drop-impl", body: "pub struct D; impl Drop for D { fn drop(&mut self) {} }\npub const fn dd(d: D) {}", errors: 2 },
  { name: "ref-eq-operator", body: "pub const fn cmp(a: &i32, b: &i32) -> bool { a == b }", errors: 3 },
];

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

for (const c of CASES) {
  test.skipIf(SKIP)(`const-check oracle: ${c.name}`, async () => {
    const file = `${c.name}.rs`;
    writeFileSync(join(WORK, file), `${c.body}\n`);
    const [oracle, subject] = await Promise.all([
      run([...RUSTC, file, ...ARGS, "--emit=metadata", "-o", `${c.name}.rmeta`], WORK),
      run([process.execPath, RUNNER, file, ...ARGS, "--sysroot", SYSROOT], WORK),
    ]);
    expect(oracle.stderr.split("\n").filter((l) => l.startsWith("error")).length).toBe(c.errors);
    const lines = subject.stdout.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(0);
    const stops = lines.filter((l) => l.includes(" = UNPORTED "));
    if (stops.length > 0) {
      const what = stops.map((l) => l.slice(l.indexOf(" = UNPORTED ") + 12));
      expect(what.every((w) => PENDING_STUBS.some((p) => w.startsWith(p)))).toBe(true);
      console.log(`PENDING const-check oracle ${c.name}: ${what[0]}`);
      return;
    }
    expect(subject.stderr).toBe(oracle.stderr);
  });
}
