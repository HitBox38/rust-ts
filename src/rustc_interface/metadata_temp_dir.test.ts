// Every exit of the driver after `encode_and_write_metadata` drops the metadata temp dir, as Rust's drop does
// (`docs/reviews/integ-w39-b1.md` F1). The oracle, run on each of these by hand at the pin, leaves no `rmeta*`.
// One case per place that owns `EncodedMetadata` when the exit happens: each run costs about 0.9 s of CPU, and the other
// exits (`-Zprint-type-sizes`, `-Zoffload=HostMetadata`) pass through the same `catch`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/** The `rmeta*` temp dirs left in this test's own output dir `sub` (the temp dir is made directly in the output dir),
 *  so each test points at its own exit, not at another test's leftovers (docs/reviews/driver-cli-2.md N2). */
function leftovers(sub: string): string[] {
  return readdirSync(join(cwd, sub), { encoding: "utf8" }).filter((n) => n.startsWith("rmeta"));
}

test("start_codegen: abort_if_errors, --emit=metadata -o - at a terminal", () => {
  const argv = [process.execPath, MAIN, "libfoo.rs", "--emit=metadata", "-o", "-"];
  const pty = process.platform === "darwin" ? ["script", "-q", "/dev/null", ...argv] : ["script", "-qec", argv.join(" "), "/dev/null"];
  const r = Bun.spawnSync(pty, { cwd, stdout: "pipe", stderr: "pipe" });
  // The error is the oracle's, so this exit is the one meant. `script` passes the status on.
  expect(r.stdout.toString()).toContain("stdout is a tty");
  expect(r.exitCode).toBe(1);
  expect(leftovers(".")).toEqual([]);
});

// The stop: `-Zincremental-verify-ich` stops in `tcx.finish()` (`verify_query_key_hashes`, unported: no dep graph, D3), after
// the closure of `create_and_enter_global_ctxt` has returned the Linker and before `link`, so the run unwinds through
// `run_compiler`'s `catch`, which drops the Linker. (Until lane driver-cli-2 this was `-Zmetrics-dir` with a missing dir;
// that error now matches the oracle and exits through `link`, the next test.) The oracle exits 0 here and leaves
// `d2/liblibfoo.rmeta` and no `rmeta*`. The rmeta proves the stop came after `encode_and_write_metadata`: a stop before
// it makes no temp dir, so `leftovers()` alone would pass vacuously (docs/reviews/root-w50-check.md N4). Checked by
// mutation: without `built_linker?.drop()` this run leaves `d2/rmeta*`.
test("run_compiler: a stop once the Linker exists, -Zincremental-verify-ich --emit=metadata", () => {
  const r = Bun.spawnSync([process.execPath, MAIN, "libfoo.rs", "-Zincremental-verify-ich", "--emit=metadata", "--out-dir", "d2"], { cwd, stdout: "pipe", stderr: "pipe" });
  // This stop and no other (docs/reviews/driver-cli-2.md N1): another `unported` after `encode_and_write_metadata`
  // but before the Linker exists would leave by a different `catch`.
  expect(r.stderr.toString()).toContain("rust-ts: unported: rustc_query_impl::incremental::verify_query_key_hashes");
  expect(r.exitCode).toBe(70);
  expect(existsSync(join(cwd, "d2", "liblibfoo.rmeta"))).toBe(true);
  expect(leftovers("d2")).toEqual([]);
});

// The error for a missing metrics dir is emitted after the Linker exists; the run then exits 1 from `link`
// (`has_errors_or_delayed_bugs` → `raise_fatal`), which drops the metadata itself. Oracle (same argv, `d3/m` absent): this stderr, exit 1, `d3/liblibfoo.rmeta` and no `rmeta*`.
test("Linker::link: the -Zmetrics-dir error, --emit=metadata", () => {
  const r = Bun.spawnSync([process.execPath, MAIN, "libfoo.rs", "-Zmetrics-dir=d3/m", "--emit=metadata", "--out-dir", "d3"], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("error: cannot dump feature usage metrics: No such file or directory (os error 2)\n\nerror: aborting due to 1 previous error\n\n");
  expect(r.exitCode).toBe(1);
  expect(existsSync(join(cwd, "d3", "liblibfoo.rmeta"))).toBe(true);
  expect(leftovers("d3")).toEqual([]);
});
