// Unit tests of the oracle toolchain check (scripts/lib/toolchain.ts, lane harness-w35) on fake sysroots, and of the
// pinned list against the real oracle toolchain. toolchain.ts has no imports beyond node:, so nothing here loads
// scripts/lib/common.ts (see scripts/lib/deps.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { installedComponents, oracleToolchainError, pinnedComponents } from "./toolchain.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const PINNED = ["cargo-{host}", "llvm-tools-preview-{host}", "rust-std-{host}", "rust-std-x86_64-unknown-linux-gnu", "rustc-{host}", "rustc-dev-{host}"];
const HOST = "aarch64-apple-darwin";
const CLEAN = ["cargo-aarch64-apple-darwin", "rust-std-aarch64-apple-darwin", "rustc-aarch64-apple-darwin", "llvm-tools-preview-aarch64-apple-darwin", "rustc-dev-aarch64-apple-darwin", "rust-std-x86_64-unknown-linux-gnu"];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fake sysroot whose `lib/rustlib/components` lists `components` (none: no file), with `lib/rustlib/src` if `src`. */
function sysroot(components: string[] | undefined, src = false, eol = "\n"): string {
  const root = mkdtempSync(join(tmpdir(), "rust-ts-toolchain-"));
  dirs.push(root);
  const rustlib = join(root, "lib", "rustlib");
  mkdirSync(rustlib, { recursive: true });
  if (components) writeFileSync(join(rustlib, "components"), components.map((c) => c + eol).join(""));
  if (src) mkdirSync(join(rustlib, "src", "rust", "library"), { recursive: true });
  return root;
}

describe("oracleToolchainError", () => {
  test("the pinned components in any order, no src dir: ok", () => {
    expect(oracleToolchainError(sysroot(CLEAN), PINNED, HOST, "tc")).toBeUndefined();
    expect(oracleToolchainError(sysroot([...CLEAN].reverse(), false, "\r\n"), PINNED, HOST, "tc")).toBeUndefined();
  });
  test("extra components (the 2026-10-31 miri + rust-src install) are named", () => {
    const e = oracleToolchainError(sysroot([...CLEAN, "rust-src", "miri-preview-aarch64-apple-darwin"]), PINNED, HOST, "nightly-x");
    expect(e).toContain("extra [miri-preview-aarch64-apple-darwin, rust-src]");
    expect(e).not.toContain("missing [");
    expect(e).toContain("--toolchain nightly-x");
    expect(e!.includes("\n")).toBe(false);
  });
  test("missing components are named", () => {
    const e = oracleToolchainError(sysroot(CLEAN.filter((c) => !c.startsWith("rustc-dev"))), PINNED, HOST, "tc");
    expect(e).toContain("missing [rustc-dev-aarch64-apple-darwin]");
    expect(e).not.toContain("extra [");
  });
  test("{host} is the oracle's host: another host's components are both extra and missing", () => {
    const e = oracleToolchainError(sysroot(CLEAN), PINNED, "x86_64-pc-windows-msvc", "tc");
    expect(e).toContain("extra [cargo-aarch64-apple-darwin,");
    expect(e).toContain("missing [cargo-x86_64-pc-windows-msvc,");
  });
  test("lib/rustlib/src fails the check even with the pinned components", () => {
    const root = sysroot(CLEAN, true);
    expect(oracleToolchainError(root, PINNED, HOST, "tc")).toContain(`${join(root, "lib", "rustlib", "src")} exists`);
  });
  test("an unreadable component list is an error, not a pass", () => {
    expect(oracleToolchainError(sysroot(undefined), PINNED, HOST, "tc")).toContain("cannot read the oracle toolchain's component list");
  });
  test("pinnedComponents and installedComponents", () => {
    expect(pinnedComponents(["a-{host}", "b"], "h")).toEqual(["a-h", "b"]);
    expect(installedComponents(sysroot(["a", "", " b "], false, "\r\n"))).toEqual(["a", "b"]);
  });
});

test("the pinned list (UPSTREAM.json rust.components) matches the oracle toolchain installed here", () => {
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string; components: string[] };
  expect(pin.components).toEqual(PINNED);
  const r = Bun.spawnSync(["rustc", `+${pin.toolchain}`, "--print", "sysroot"], { stdout: "pipe", stderr: "pipe" });
  const v = Bun.spawnSync(["rustc", `+${pin.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const root = r.stdout.toString().trim();
  const host = /^host: (\S+)$/m.exec(v.stdout.toString())![1]!;
  expect(oracleToolchainError(root, pin.components, host, basename(root))).toBeUndefined();
});
