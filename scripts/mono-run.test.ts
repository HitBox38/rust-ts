// scripts/mono-run.ts, mono-ui's subject (review mono-run-head N1; lane harness-m7b): on a hello world it exits 0, prints the oracle's
// `MONO_ITEM` lines, and never evaluates the ported LLVM backend or the IR model, as src/rustc_monomorphize/wire.test.ts checks of main.ts
// for a check-only compile. It loads no scripts/lib/common.ts, so it needs no child process of its own beyond the runs.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-mono-run-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PIN = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.toolchain as string;
/** The caller's environment without what would change rustc's output (scripts/lib/env.ts scrubs the same for difftest). */
const env = (): Record<string, string> => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(RUSTC_LOG|RUST_BACKTRACE|RUSTC_BOOTSTRAP|CLICOLOR|CARGO_)/.test(k)) e[k] = v;
  return { ...e, RUSTC_ICE: "0", RUSTUP_AUTO_INSTALL: "0" };
};

test("mono-run: exit 0, the oracle's MONO_ITEM lines, and rustc_codegen_llvm never loaded", () => {
  const sysroot = Bun.spawnSync(["rustc", `+${PIN}`, "--print", "sysroot"], { env: env(), stdout: "pipe" }).stdout.toString().trim();
  expect(sysroot).not.toBe("");
  writeFileSync(join(TMP, "hello.rs"), 'fn main() { println!("hello"); }\n');
  const list = join(TMP, "modules.txt");
  const preload = join(TMP, "preload.ts");
  writeFileSync(preload, `process.on("exit", () => require("node:fs").writeFileSync(${JSON.stringify(list)}, Object.keys(require.cache).join("\\n")));\n`);
  // mono-ui's flags (harness/suites.ts `monoArgs`), each side with an output directory of its own.
  const args = (out: string) => ["--sysroot", sysroot, "--target=x86_64-unknown-linux-gnu", "--edition=2021", "-Zprint-mono-items=yes", "-Cno-prepopulate-passes", "--emit=llvm-ir", "--out-dir", join(TMP, out), "hello.rs"];
  const port = Bun.spawnSync([process.execPath, "--preload", preload, join(REPO, "scripts", "mono-run.ts"), ...args("port")], { cwd: TMP, env: env(), stdout: "pipe", stderr: "pipe" });
  expect(port.exitCode, port.stderr.toString()).toBe(0);
  const oracle = Bun.spawnSync(["rustc", `+${PIN}`, ...args("oracle")], { cwd: TMP, env: env(), stdout: "pipe", stderr: "pipe" });
  expect(oracle.exitCode, oracle.stderr.toString()).toBe(0);
  const items = port.stdout.toString().split("\n").filter((l) => l.startsWith("MONO_ITEM "));
  expect(items.length).toBeGreaterThan(0);
  expect(port.stdout.toString()).toBe(oracle.stdout.toString());
  expect(port.stderr.toString()).toBe(oracle.stderr.toString());
  const modules = readFileSync(list, "utf8").split("\n");
  // The collector ran, through the real driver.
  expect(modules.some((m) => m.endsWith("/src/rustc_monomorphize/collector.ts"))).toBe(true);
  expect(modules.some((m) => m.endsWith("/src/rustc_driver_impl/lib.ts"))).toBe(true);
  // Lazy load (plan-m7 D14): the ported backend and the IR model are never evaluated, so nothing after partitioning ran.
  expect(modules.filter((m) => m.includes("/src/rustc_codegen_llvm/") || m.includes("/src/rust_ts/llvm/"))).toEqual([]);
}, 60_000);
