// plan-m7 O6, reduced. `serde_core.rmeta` looked 4 bytes smaller than the oracle's, with the difference 1.5 kB from the
// end, and it was the comparison: the two sides were built in `t-check-or` and `t-check2`. A file `include!`d from
// `OUT_DIR` keeps its path in the metadata, twice, so the oracle differs from itself in the same way. A byte comparison
// of crates with build scripts has to build both sides at one target path. The port does encode the path as upstream does.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
if (!HAVE && REQUIRE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");

const WORK = test_scratch_dir("out-dir-path");
const SRC = `#![feature(no_core, rustc_attrs)]
#![no_core]
#[rustc_builtin_macro]
macro_rules! include { ($file:expr $(,)?) => {{ /* compiler built-in */ }}; }
#[rustc_builtin_macro]
macro_rules! concat { ($($e:expr),* $(,)?) => {{ /* compiler built-in */ }}; }
#[rustc_builtin_macro]
macro_rules! env { ($name:expr $(,)?) => {{ /* compiler built-in */ }}; }
include!(concat!(env!("OUT_DIR"), "/private.rs"));
`;
const DIRS = ["t-check-or", "t-check2"];
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, "x.rs"), SRC);
for (const d of DIRS) {
  mkdirSync(join(WORK, d), { recursive: true });
  writeFileSync(join(WORK, d, "private.rs"), "pub mod private {}\n");
}
const LIB = ["--crate-type", "lib", "--crate-name", "x", "--emit=metadata", "x.rs"];
function build(compiler: string[], dir: string, out: string) {
  const r = Bun.spawnSync([...compiler, ...LIB, "-o", out], {
    cwd: WORK,
    env: { ...process.env, OUT_DIR: join(WORK, dir), RUSTC_ICE: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return { bytes: readFileSync(join(WORK, out)), stderr: r.stderr.toString() };
}

describe.skipIf(SKIP)("the path of a file included from OUT_DIR, oracle", () => {
  test("the oracle differs from itself by twice the difference in length; the port is byte-identical at one path", () => {
    const a = build(RUSTC, DIRS[0]!, "oracle-a.rmeta");
    const b = build(RUSTC, DIRS[1]!, "oracle-b.rmeta");
    expect(a.bytes.length - b.bytes.length).toBe(2 * (DIRS[0]!.length - DIRS[1]!.length));
    const p = build([process.execPath, join(REPO, "src/rust_ts/main.ts")], DIRS[1]!, "port-b.rmeta");
    expect(p.stderr).toBe(b.stderr);
    expect(Buffer.compare(p.bytes, b.bytes)).toBe(0);
  }, 30_000);
});
