// The guard on the pinned toolchain's `llvm-tools` (scripts/lib/llvm-tools.ts): on fake sysroots, and on the real one. It
// reads files and runs `--version`; it never installs anything. Imports nothing from scripts/lib/common.ts (deps.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LLVM_TOOLS, LLVM_TOOLS_PINNED, libLlvmCopies, llvmBinDir, llvmToolHashes, llvmToolsError } from "./llvm-tools.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-llvm-tools-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const HOST = "aarch64-apple-darwin";

function fake(name: string, libs: [string, string], tools: readonly string[] = LLVM_TOOLS): string {
  const root = join(TMP, name);
  mkdirSync(llvmBinDir(root, HOST), { recursive: true });
  const [a, b] = libLlvmCopies(root, HOST);
  mkdirSync(join(a, ".."), { recursive: true });
  mkdirSync(join(b, ".."), { recursive: true });
  writeFileSync(a, libs[0]);
  writeFileSync(b, libs[1]);
  for (const t of tools) writeFileSync(join(llvmBinDir(root, HOST), t), "x");
  return root;
}

describe("llvmToolsError", () => {
  test("a complete toolchain with one library build is fine", () => {
    expect(llvmToolsError(fake("ok", ["same", "same"]), HOST)).toBeUndefined();
  });
  test("a missing tool is named, and it says never to change the toolchain", () => {
    const e = llvmToolsError(fake("no-opt", ["same", "same"], ["llc", "llvm-as"]), HOST)!;
    expect(e).toContain("/opt");
    expect(e).toContain("never change it");
    expect(e).not.toContain("rustup component add");
  });
  test("two library copies that differ in content, or in size without hashing, are an error", () => {
    expect(llvmToolsError(fake("differ", ["aaaa", "bbbb"]), HOST)).toContain("not one build");
    expect(llvmToolsError(fake("differ-fast", ["aaaa", "bbbb"]), HOST, false)).toBeUndefined();
    expect(llvmToolsError(fake("differ-size", ["aaaa", "bbb"]), HOST, false)).toContain("not one build");
  });
});

const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string; components: string[] };
const out = (cmd: string[]) => new TextDecoder().decode(Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout);
const realHost = /^host: (\S+)$/m.exec(out(["rustc", `+${pin.toolchain}`, "-vV"]))![1]!;
const sysroot = out(["rustc", `+${pin.toolchain}`, "--print", "sysroot"]).trim();

test("llvm-tools is in the pinned components, so the tools need no install", () => {
  expect(pin.components).toContain("llvm-tools-preview-{host}");
});

test("the real toolchain has the tools, one library build, and the LLVM rustc reports", () => {
  expect(llvmToolsError(sysroot, realHost)).toBeUndefined();
  const rustcLlvm = /^LLVM version: (\S+)$/m.exec(out(["rustc", `+${pin.toolchain}`, "-vV"]))![1]!;
  for (const t of LLVM_TOOLS) expect(out([join(llvmBinDir(sysroot, realHost), t), "--version"])).toContain(`LLVM version ${rustcLlvm}-rust-`);
});

// On another host this skips with its reason, and the gate's skip allowlist rejects it (AGENTS.md section 5).
const why = LLVM_TOOLS_PINNED[realHost] === undefined ? ` (skipped: no hashes pinned for host ${realHost})` : "";
test.skipIf(why !== "")(`the real toolchain's tools are the pinned build${why}`, () => {
  expect(llvmToolHashes(sysroot, realHost)).toEqual(LLVM_TOOLS_PINNED[realHost]!);
});
