// Tests for src/rust_ts/track_caller.ts (`DiagLocation::caller` resolution) through the driver.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAIL_CALLS } from "./track_caller.ts";

const MAIN = join(import.meta.dir, "main.ts");
const SRC = "fn main() {\n    let x = ;\n}\n";

// `rustc +nightly -Ztrack-diagnostics -Zparse-crate-root-only p.rs` (pinned nightly 6f5da406b56c), exit 1.
const ORACLE_STDERR = `error: expected expression, found \`;\`
 --> p.rs:2:13
  |
2 |     let x = ;
  |             ^ expected expression
  |
  = note: -Ztrack-diagnostics: created at /rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297/compiler/rustc_parse/src/parser/diagnostics.rs:2237:34

error: aborting due to 1 previous error

`;

function run(env: Record<string, string>): { code: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-track-caller-"));
  try {
    writeFileSync(join(dir, "p.rs"), SRC);
    const r = Bun.spawnSync([process.execPath, MAIN, "-Ztrack-diagnostics", "-Zparse-crate-root-only", "p.rs"], {
      cwd: dir,
      env: { ...process.env, ...env },
    });
    return { code: r.exitCode, stderr: r.stderr.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("this process runs with JSC proper tail calls (the default)", () => {
  expect(TAIL_CALLS).toBe(process.env.BUN_JSC_useTailCalls !== "0" && process.env.BUN_JSC_useTailCalls !== "false");
});

test("without tail calls the location is the upstream call site, as the oracle prints it", () => {
  const r = run({ BUN_JSC_useTailCalls: "0" });
  expect(r.stderr).toBe(ORACLE_STDERR);
  expect(r.code).toBe(1);
});

test("with tail calls a dropped frame makes the location unported, never a guess", () => {
  const r = run({ BUN_JSC_useTailCalls: "1" });
  expect(r.code).toBe(70);
  expect(r.stderr).toContain("rust-ts: unported: std::panic::Location::caller (DiagLocation Display: ");
  expect(r.stderr).not.toContain("created at");
});
