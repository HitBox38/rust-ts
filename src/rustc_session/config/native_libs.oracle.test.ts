// Oracle check of the `-l` parser (config/native_libs.rs): rustc and rust-ts accept or reject the same values with the
// same text. Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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

const WORK = test_scratch_dir("native-libs-oracle");
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, "x.rs"), "fn main() {}\n");

for (const value of [
  "foo",
  "static=foo",
  "dylib=foo",
  "framework=foo",
  "foo:",
  ":bar",
  "static=",
  "=foo",
  "nope=foo",
  "link-arg=foo",
  "dylib:+as-needed=foo",
  "static:bundle=foo",
  "static:+bundle,+bundle=foo",
  "static:+whole-archive,-bundle=foo:bar",
  "dylib:+bundle=foo",
  "dylib:+whole-archive=foo",
  "dylib:+export-symbols=foo",
  "static:+as-needed=foo",
  "static:+nonsense=foo",
  "static:+verbatim,+verbatim=foo",
  "static:=foo",
]) {
  test.skipIf(SKIP)(`-l ${value}`, () => {
    if (!HAVE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");
    const args = ["-Zunpretty=ast-tree", "-l", value, "x.rs"];
    const run = (cmd: string[]) => {
      const r = Bun.spawnSync([...cmd, ...args], { cwd: WORK, stdout: "pipe", stderr: "pipe" });
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    };
    expect(run([process.execPath, join(REPO, "src/rust_ts/main.ts")])).toEqual(run(RUSTC));
  });
}
