// Oracle test for `TyCtxt::mk_const_alloc` (lane const-check): string, byte-string and C-string literals become
// interned `ConstAllocation`s (`allocate_bytes_dedup` -> `mk_const_alloc` -> `reserve_and_set_memory_dedup`), and the
// `-Zdump-mir=built` files print them (`const "hello"`, the `allocN (size: .., align: ..) { .. }` hex dumps), so
// interning order, dedup (two equal literals share one `allocN`) and the allocation bytes are compared byte for byte
// with the pinned rustc's dumps. Only `fn` bodies: AllocIds are numbered in query order (plan-m4 D13), and rustc builds
// the MIR of consts/statics earlier (CTFE in `check_crate`) than this driver's `mir_keys` walk.
//
// Subject: const_alloc_oracle/run.ts. Oracle: `rustc <file> --crate-type lib -Zdump-mir=built --emit=metadata`.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const WORK = test_scratch_dir("mk-const-alloc-oracle");
const RUNNER = join(REPO, "src/rustc_middle/ty/const_alloc_oracle/run.ts");
const ARGS = ["--crate-type", "lib", "--edition", "2021", "-Zdump-mir=built"];

const SRC = [
  'pub fn a() -> &\'static str { "hello" }',
  "pub fn b() -> &'static [u8; 3] { b\"abc\" }",
  'pub fn c() -> &\'static str { "hello" }',
  "pub fn d() -> &'static core::ffi::CStr { c\"hi\" }",
  'pub fn e() -> (&\'static str, &\'static str) { ("x", "a longer string literal, more than sixteen bytes long, to wrap the hex dump lines\\n") }',
  "pub fn f() -> &'static [u8] { b\"\" }",
  'pub fn g() -> &\'static str { "\\u{1F600} ünïcödé" }',
].join("\n");

async function run(cmd: string[], cwd: string): Promise<number> {
  const p = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "ignore" });
  return p.exited;
}

test.skipIf(SKIP)("mk_const_alloc oracle: string literal allocations in -Zdump-mir=built", async () => {
  writeFileSync(join(WORK, "lit.rs"), `${SRC}\n`);
  const od = join(WORK, "o");
  const pd = join(WORK, "p");
  mkdirSync(od, { recursive: true });
  mkdirSync(pd, { recursive: true });
  const [oc, pc] = await Promise.all([
    run([...RUSTC, "lit.rs", ...ARGS, `-Zdump-mir-dir=${od}`, "--emit=metadata", "-o", "lit.rmeta"], WORK),
    run([process.execPath, RUNNER, "lit.rs", ...ARGS, `-Zdump-mir-dir=${pd}`, "--sysroot", SYSROOT], WORK),
  ]);
  expect([oc, pc]).toEqual([0, 0]);
  const files = readdirSync(od).filter((f) => f.endsWith(".built.after.mir")).sort();
  expect(files.length).toBe(8);
  expect(readdirSync(pd).filter((f) => f.endsWith(".built.after.mir")).sort()).toEqual(files);
  let allocs = 0;
  for (const f of files) {
    const o = readFileSync(join(od, f), "utf8");
    allocs += (o.match(/^alloc\d+ \(size/gm) ?? []).length;
    expect({ f, mir: readFileSync(join(pd, f), "utf8") }).toEqual({ f, mir: o });
  }
  expect(allocs).toBeGreaterThanOrEqual(8);
});
