// The Miri driver's panics from its two environment variables, and `RUST_TS_IMPL`, against the oracle's Miri (docs/reviews/fixers-42.md R1, R2).
// One port process per variable: the other values were compared by hand (docs/handoff/fixers-43.md).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIRI_SYSROOT, miriBinary, miriOracleProblem, miriPin } from "../../../scripts/lib/miri.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const problem = miriOracleProblem({ sysroot: true });
const SKIP = process.platform === "win32" || (problem !== undefined && !REQUIRE);
if (SKIP) console.log(`SKIP: ${problem}; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const EXEC_WITH_ENV = join(import.meta.dir, "..", "..", "rust_ts", "exec_with_env.ts");
const PORT = [process.execPath, "--preload", join(import.meta.dir, "..", "..", "rust_ts", "miri_stack_first.ts"), join(import.meta.dir, "miri.ts")];
const PROGRAM = `#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] trait PointeeSized {}
#[lang = "meta_sized"] trait MetaSized: PointeeSized {}
#[lang = "sized"] trait Sized: MetaSized {}
fn main() {}
`;

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rust-ts-miri-env-"));
  writeFileSync(join(dir, "p.rs"), PROGRAM);
  // What a lossy read of `a\xffb` names.
  mkdirSync(join(dir, "a\u{FFFD}b"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** stderr without what cannot be equal: the thread id, and the frames (Rust's against JS's, plan-ice-report D9). */
const mask = (s: string): string =>
  s
    .replace(/(thread '[^']*') \(\d+\)/g, "$1 (N)")
    .replace(/stack backtrace:\n(?:(?:[ \t]+\S|note: rust-ts prints).*\n)*/g, "stack backtrace:\n");

function run(entries: string[], cmd: string[]): { stderr: string; code: number | null } {
  // HOME keeps Bun's transpile cache where it is; with none, Bun makes a `Library/Caches` in the cwd.
  const env = [`HOME=${process.env.HOME ?? ""}`, "RUSTC_ICE=0", ...entries];
  const r = Bun.spawnSync([process.execPath, EXEC_WITH_ENV, JSON.stringify(env), ...cmd], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { stderr: mask(r.stderr.toString("latin1" as never)), code: r.exitCode };
}

const ORACLE = (): string[] => [miriBinary()];

test.skipIf(SKIP)("an invalid MIRI_BE_RUSTC: std's default hook, with OsStr's Debug", () => {
  const entries = ['MIRI_BE_RUSTC=a"\\\n\x01\x7f\xc2\xa0\xcc\x81\xff'];
  const oracle = run(entries, ORACLE());
  expect(oracle.stderr).toContain(String.raw`\u{7f}\u{a0}\u{301}\xFF`);
  const port = run(entries, PORT);
  expect(port.stderr).toBe(oracle.stderr);
  expect(port.code).toBe(oracle.code);
});

test.skipIf(SKIP)("MIRI_CWD is the variable's bytes: `a\\xffb` is not the directory `a\\u{FFFD}b`", () => {
  const args = ["p.rs", "--sysroot", MIRI_SYSROOT, "--target", miriPin().target];
  const entries = ["MIRI_CWD=a\xffb"];
  const oracle = run(entries, [...ORACLE(), ...args]);
  expect(oracle.stderr).toContain("miri.rs:169:39");
  expect(oracle.code).toBe(101);
  const port = run(entries, [...PORT, ...args]);
  expect(port.stderr).toBe(oracle.stderr);
  expect(port.code).toBe(oracle.code);
});

test.skipIf(SKIP)("RUST_TS_IMPL=stub stops the Miri entry, so `--impl` validates the harness on Miri suites", () => {
  const r = run(["RUST_TS_IMPL=stub"], PORT);
  expect(r.code).toBe(70);
  expect(r.stderr).toBe("rust-ts: unported: stub implementation\n");
});
