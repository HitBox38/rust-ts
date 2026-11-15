// Unit test of util.ts's `DummyArchiveBuilderBuilder` (lane fixers-60, review fixers-59 N1): its `create_dll_import_lib`
// override (util.rs:499) builds an empty static library instead of calling dlltool, through `ArArchiveBuilder::build` with no
// members. The expected bytes are what the pinned toolchain's `llvm-ar rcs --format=<kind>` writes with no members (the
// second test re-makes them when the toolchain is present): for `coff` (the `*-windows-msvc` targets, where the override is
// reached) the magic and two empty symbol tables, for `gnu` the magic alone.
import { describe, expect, test } from "bun:test";
// Load order: rustc_target through its crate root first (as back/link.ts does).
import "../rustc_target/lib.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import { llvmBinDir } from "../../scripts/lib/llvm-tools.ts";
import type { Session } from "../rustc_session/session.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { Target } from "../rustc_target/spec/mod.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { DummyArchiveBuilderBuilder } from "./util.ts";

const member = (name: string, size: number): string =>
  name.padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "0".padEnd(8) + String(size).padEnd(10) + "`\n";
const EMPTY: Record<string, string> = {
  coff: "!<arch>\n" + member("/", 4) + "\0".repeat(4) + member("/", 8) + "\0".repeat(8),
  gnu: "!<arch>\n",
};
const CASES = [
  ["x86_64-pc-windows-msvc", "coff"],
  ["x86_64-unknown-linux-gnu", "gnu"],
] as const;

describe("the dummy backend's create_dll_import_lib writes an empty archive (util.rs:499)", () => {
  for (const [tuple, kind] of CASES) {
    test(tuple, () => {
      create_default_session_globals_then(() => {
        const r = Target.search(TargetTuple.from_tuple(tuple), "", false);
        if (r.$ === "Err") throw new Error(r._0);
        const target = r._0[0];
        expect(target.options.archive_format).toBe(kind);
        const sess = { target, dcx: () => ({ abort_if_errors: () => {} }) } as unknown as Session;
        const dir = mkdtempSync(join(tmpdir(), "rust-ts-dummy-dll-import-"));
        try {
          const out = join(dir, "foo.dll_imports.lib");
          expect(DummyArchiveBuilderBuilder.create_dll_import_lib).toBeDefined();
          DummyArchiveBuilderBuilder.create_dll_import_lib!(sess, "foo.dll", [], out);
          expect(existsSync(out)).toBe(true);
          expect(readFileSync(out, "latin1")).toBe(EMPTY[kind]!);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });
  }
});

describe("the expected empty archives are the pinned llvm-ar's", () => {
  const SYSROOT = (() => {
    try {
      const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
      return r.exitCode === 0 ? r.stdout.toString().trim() : "";
    } catch {
      return "";
    }
  })();
  const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64";
  test.skipIf(!HAVE && process.env.RUST_TS_REQUIRE_PROBES !== "1")("llvm-ar rcs --format=coff|gnu, no members", () => {
    expect(HAVE).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-dummy-dll-import-"));
    try {
      for (const kind of ["coff", "gnu"]) {
        const out = join(dir, `empty-${kind}.a`);
        const p = Bun.spawnSync([join(llvmBinDir(SYSROOT, "aarch64-apple-darwin"), "llvm-ar"), "rcs", `--format=${kind}`, out], { stderr: "pipe" });
        expect(p.stderr.toString()).toBe("");
        expect(p.exitCode).toBe(0);
        expect(readFileSync(out, "latin1")).toBe(EMPTY[kind]!);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
