// Regression test of `eval_in_interpreter` (eval_queries.ts) against the pinned rustc: the end of the function drops
// `ecx`, and with it the frames a failed constant left on the stack, which exits their `frame` spans.
// eval_queries_tracing/two_consts.rs: `const A` fails with `f` and `g` still pushed, then `const B` calls `h`. Under
// `RUSTC_LOG=rustc_const_eval::interpret=info`, rustc prints `frame=B` at depth 1 again. The port printed it under
// A's leftover frames (one level too deep per frame) before the fix.
// - one test: the fixture (`two_consts.{stdout,stderr,exit}`) is the current oracle output (`REGEN=1` rewrites it);
// - one test: the port (src/rust_ts/main.ts) gives the fixture byte for byte.
// Both run in the fixture directory with a relative file name, so the fixture holds no host paths. Without the
// pinned toolchain both are a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const DIR = join(import.meta.dir, "eval_queries_tracing");
const CASE = "two_consts";
const FILTER = "rustc_const_eval::interpret=info";

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !k.startsWith("RUSTC_LOG") && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
Object.assign(ENV, { RUSTC_LOG: FILTER, RUSTC_ICE: "0", RUST_BACKTRACE: "0" });

/** The oracle sysroot, or `undefined` (a skip; a failure under RUST_TS_REQUIRE_PROBES=1). */
function sysroot(): string | undefined {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { stdout: "pipe", stderr: "pipe" });
  const s = r.exitCode === 0 ? r.stdout.toString().trim() : undefined;
  if (s === undefined && REQUIRE) throw new Error(`ERROR: the oracle toolchain (rustc +${PIN.toolchain}) is missing`);
  return s;
}

interface Out {
  stdout: string;
  stderr: string;
  exit: number;
}

function run(cmd: string[], s: string): Out {
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "-Zunpretty=mir", `${CASE}.rs`];
  const r = Bun.spawnSync([...cmd, ...args], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exit: r.exitCode ?? -1 };
}

const oracle = (s: string): Out => run(["rustc", `+${PIN.toolchain}`], s);

function expected(): Out {
  const f = (ext: string) => readFileSync(join(DIR, `${CASE}.${ext}`), "utf8");
  return { stdout: f("stdout"), stderr: f("stderr"), exit: Number(f("exit").trim()) };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined) throw new Error("ERROR: REGEN needs the oracle toolchain");
  const o = oracle(s);
  writeFileSync(join(DIR, `${CASE}.stdout`), o.stdout);
  writeFileSync(join(DIR, `${CASE}.stderr`), o.stderr);
  writeFileSync(join(DIR, `${CASE}.exit`), `${o.exit}\n`);
}

test("eval_queries_tracing: the fixture is the current oracle output", () => {
  const want = expected();
  // The case tests something: A fails (E0080), and B's frame is back at depth 1 after A's frames.
  expect(want.stderr).toContain("error[E0080]");
  const lines = want.stderr.split("\n");
  const a_g = lines.indexOf("     rustc_const_eval::interpret::stack::frame frame=g");
  const b = lines.indexOf(" rustc_const_eval::interpret::stack::frame frame=B");
  expect(a_g).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a_g);
  const s = sysroot();
  if (s === undefined) return;
  expect(oracle(s)).toEqual(want);
}, 120_000);

test("eval_queries_tracing: the port's stdout, stderr and exit equal the oracle's (frames of a failed constant are dropped)", () => {
  const s = sysroot();
  if (s === undefined) return;
  expect(run([process.execPath, join(REPO, "src", "rust_ts", "main.ts")], s)).toEqual(expected());
}, 120_000);
