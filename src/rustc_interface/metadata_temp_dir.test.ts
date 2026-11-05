// Every exit of the driver after `encode_and_write_metadata` drops the metadata temp dir, as Rust's drop does
// (`docs/reviews/integ-w39-b1.md` F1). The oracle, run on each of these by hand at the pin, leaves no `rmeta*`.
// One case per place that owns `EncodedMetadata` when the exit happens: each run costs about 0.9 s of CPU, and the other
// exits (`-Zprint-type-sizes`, `-Zoffload=HostMetadata`) pass through the same `catch`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";

const MAIN = join(import.meta.dir, "../rust_ts/main.ts");
const ROOT = join(DATA, "tmp", "metadata-temp-dir");
let cwd = "";

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  cwd = mkdtempSync(join(ROOT, "t"));
  writeFileSync(join(cwd, "libfoo.rs"), "#![feature(no_core)]\n#![no_core]\n#![crate_type = \"lib\"]\n");
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function leftovers(): string[] {
  return readdirSync(cwd, { recursive: true, encoding: "utf8" }).filter((n) => n.split("/").at(-1)!.startsWith("rmeta"));
}

test("start_codegen: abort_if_errors, --emit=metadata -o - at a terminal", () => {
  const argv = [process.execPath, MAIN, "libfoo.rs", "--emit=metadata", "-o", "-"];
  const pty = process.platform === "darwin" ? ["script", "-q", "/dev/null", ...argv] : ["script", "-qec", argv.join(" "), "/dev/null"];
  const r = Bun.spawnSync(pty, { cwd, stdout: "pipe", stderr: "pipe" });
  // The error is the oracle's, so this exit is the one meant. `script` passes the status on.
  expect(r.stdout.toString()).toContain("stdout is a tty");
  expect(r.exitCode).toBe(1);
  expect(leftovers()).toEqual([]);
});

test("run_compiler: a stop once the Linker exists, -Zmetrics-dir --emit=metadata", () => {
  const r = Bun.spawnSync([process.execPath, MAIN, "libfoo.rs", "-Zmetrics-dir=d2/m", "--emit=metadata", "--out-dir", "d2"], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toContain("dump_feature_usage_metrics");
  expect(r.exitCode).toBe(70);
  expect(leftovers()).toEqual([]);
});
