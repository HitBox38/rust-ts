// Oracle check of `analysis` / `run_required_analyses` (lane passes-analysis: passes.ts) against the pinned nightly
// rustc: rendered stderr and exit code.
//
// Each case runs the test driver analysis_oracle/run.ts (see its header): the ported driver, stopped right after
// `tcx.ensure_ok().analysis(())`. The oracle compiles the same file as a lib (`--emit=metadata`, std); for these cases
// nothing after `analysis` (metadata encoding) prints anything, so stderr and the exit code must be equal.
// The crates have no bodies (every fn body stops at `mir_borrowck`, every const / static at CTFE, both unported), so
// they reach misc_checking_3: dead code, the late lints, private-in-public, lint expectations. One case with a body
// checks that the port stops UNPORTED and that everything it printed before is the oracle's own stderr, in order
// (once `mir_borrowck` lands it must match completely).
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
const SYSROOT = HAVE ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";

const WORK = join(DATA, "tmp", "analysis-oracle", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(REPO, "src/rustc_interface/analysis_oracle/run.ts");

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

function both(name: string, src: string): { oracle: Out; ours: Out } {
  mkdirSync(WORK, { recursive: true });
  const file = `${name}.rs`;
  writeFileSync(join(WORK, file), src);
  const args = ["--sysroot", SYSROOT, "--crate-type", "lib", "--edition", "2024", "--emit=metadata", "-o", `lib${name}.rmeta`, file];
  const oracle = run([...RUSTC, ...args], WORK);
  const ours = run([process.execPath, RUNNER, ...args], WORK);
  return { oracle, ours };
}

function expect_same_lines(ours: string, oracle: string): void {
  if (ours === oracle) return;
  // Show the first differing line.
  const ol = oracle.split("\n");
  const pl = ours.split("\n");
  let k = 0;
  while (k < pl.length && ol[k] === pl[k]) k++;
  expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
}

function compare(name: string, src: string, expect_diags: RegExp[]): void {
  const { oracle, ours } = both(name, src);
  for (const re of expect_diags) expect(oracle.stderr).toMatch(re);
  expect(ours.stderr).not.toContain("rust-ts: ");
  expect_same_lines(ours.stderr, oracle.stderr);
  expect(ours.code).toBe(oracle.code);
}

// misc_checking_3 on a crate without bodies: late lints (non_camel_case_types, missing_docs as errors: lint errors do
// not abort), private_bounds (check_private_in_public), dead code (structs, enums, a field, a type alias), fulfilled
// and unfulfilled `#[expect]` (check_expectations).
const MISC3 = [
  "struct bar;",
  "pub enum E { A, B }",
  "type X = u8;",
  "struct Unused(u8);",
  "enum Never { V1, V2(u8) }",
  "pub struct Pubf { f: u8 }",
  "#[expect(dead_code)]",
  "struct Expected;",
  "#[expect(non_camel_case_types)]",
  "pub struct fine;",
  "#[expect(unused_variables)]",
  "pub struct Unfulfilled;",
  "mod inner { pub struct S; pub(super) trait Tr {} }",
  "pub trait Bound: inner::Tr {}",
  "#[deny(missing_docs)]",
  "pub mod docs { pub struct NoDoc; }",
  "pub use inner::S as Reexp;",
  "pub type Alias<T> = (T,);",
  "pub trait WithAssoc { type A; const C: u8; }",
].join("\n");

test.skipIf(SKIP)("analysis: misc_checking_3 (dead code, late lints, private bounds, expectations) as the oracle", () => {
  compare("analysis_misc3", MISC3, [/is never constructed/, /is more private than/, /missing documentation/, /lint expectation is unfulfilled/]);
});

// `#![deny(dead_code)]`: dead-code errors are lint errors, so `analysis` goes on; a nested `#[warn(unused)]` module.
const DENY_DEAD = ["#![deny(dead_code)]", "pub struct T { f: u8 }", "struct U;", "#[warn(unused)]", "mod m { struct V; }"].join("\n");

test.skipIf(SKIP)("analysis: denied dead_code (lint errors do not abort)", () => {
  compare("analysis_deny_dead", DENY_DEAD, [/^error: struct `U` is never constructed/m]);
});

// A non-lint error (E0425 from resolution): `analysis` raises the fatal error after `run_required_analyses`, so
// misc_checking_3 (dead code) does not run.
const ABORT = ["struct S(Missing);", "struct bar;", "pub struct T { f: u8 }", "#[expect(dead_code)]", "struct Ex;"].join("\n");

test.skipIf(SKIP)("analysis: a non-lint error skips misc_checking_3", () => {
  compare("analysis_abort", ABORT, [/E0425/]);
});

// A body: liveness and check_unsafety run in the MIR_borrow_checking loop; the port stops at `mir_borrowck` (not
// ported yet). Whatever it printed before must be the oracle's stderr, in order.
const BODY = ["pub fn f(x: u8) -> u8 { let y = 1; x }", "struct bar;"].join("\n");

test.skipIf(SKIP)("analysis: a fn body (stops UNPORTED at mir_borrowck until borrowck lands)", () => {
  const { oracle, ours } = both("analysis_body", BODY);
  const m = /\nrust-ts: unported: (.*)\n$/.exec(`\n${ours.stderr}`);
  if (m === null) {
    expect_same_lines(ours.stderr, oracle.stderr);
    expect(ours.code).toBe(oracle.code);
    return;
  }
  expect(ours.code).toBe(70);
  const printed = ours.stderr.slice(0, ours.stderr.length - m[0].length + 1);
  expect(printed.length).toBeGreaterThan(0);
  expect_same_lines(printed, oracle.stderr.slice(0, printed.length));
});
