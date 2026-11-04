// `-Zrandomize-layout -Zlayout-seed=N` on real types: `#[rustc_dump_layout(debug)]` prints every field's offset and the
// `in_memory_order` the shuffle chose (compiler/rustc_abi/src/layout.rs:1125). The oracle's stderr must equal the port's,
// and the shuffle has to be visible: a shuffled layout differs from the plain one.
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import { oracleSysroot } from "../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

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

const WORK = test_scratch_dir("randomize-layout-oracle");
mkdirSync(WORK, { recursive: true });
writeFileSync(
  join(WORK, "l.rs"),
  `#![feature(rustc_attrs)]
#![allow(dead_code)]
#[rustc_dump_layout(debug)]
struct Five { a: u8, b: u16, c: u32, d: u64, e: u128 }
#[rustc_dump_layout(debug)]
struct Tail { a: u8, b: u32, c: u16, tail: [u8] }
#[rustc_dump_layout(debug)]
struct Many { a: u8, b: u8, c: u16, d: u16, e: u32, f: u32, g: u64, h: u64, i: u8, j: u16, k: u32, l: u64, m: u8, n: u16, o: u32 }
#[rustc_dump_layout(debug)]
#[repr(C)]
struct NotShuffled { a: u8, b: u16, c: u32 }
#[rustc_dump_layout(debug)]
enum E { A(u8, u32, u16), B(u64, u8) }
#[rustc_dump_layout(debug)]
type T = (u8, u16, u32, u64);
`,
);

function run(cmd: string[], flags: string[]): { code: number | null; stderr: string } {
  const r = Bun.spawnSync([...cmd, "--crate-type=lib", "--target", "x86_64-unknown-linux-gnu", ...flags, "l.rs"], { cwd: WORK, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stderr: r.stderr.toString() };
}
const MAIN = join(REPO, "src/rust_ts/main.ts");

for (const seed of [undefined, 0, 2, 7, 12345, 18446744073709551615n]) {
  const flags = seed === undefined ? ["-Zrandomize-layout"] : ["-Zrandomize-layout", `-Zlayout-seed=${seed}`];
  test.skipIf(SKIP)(`rustc ${flags.join(" ")}`, () => {
    const want = run(RUSTC, flags);
    const got = run([process.execPath, MAIN, "--sysroot", oracleSysroot()], flags);
    expect(got).toEqual(want);
  }, 120_000);
}

test.skipIf(SKIP)("the shuffle is visible in the dump", () => {
  const order = (s: string): string[] => [...s.matchAll(/in_memory_order: \[([^\]]*)\]/g)].map((m) => m[1]!.replace(/\s+/g, ""));
  const plain = order(run(RUSTC, []).stderr);
  const shuffled = order(run(RUSTC, ["-Zrandomize-layout", "-Zlayout-seed=2"]).stderr);
  expect(plain.length).toBeGreaterThan(0);
  expect(shuffled).not.toEqual(plain);
}, 120_000);
