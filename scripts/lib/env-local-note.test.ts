// scripts/lib/env-local-note.ts, through a real `bun test` in a throwaway repo: bunfig.toml's preload, a test file, and
// with or without `.env.local`.
import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");

const runIn = (dir: string) => {
  const env = { ...process.env };
  delete env.RUST_TS_DATA;
  const p = Bun.spawnSync([process.execPath, "test"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};

test("no .env.local: one warning line for the whole run, after the last test, and the exit code stays; with one: no line", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-env-note-"));
  try {
    mkdirSync(join(dir, "scripts/lib"), { recursive: true });
    cpSync(join(REPO, "bunfig.toml"), join(dir, "bunfig.toml"));
    cpSync(join(REPO, "scripts/lib/env-local-note.ts"), join(dir, "scripts/lib/env-local-note.ts"));
    for (const f of ["a.test.ts", "b.test.ts"]) writeFileSync(join(dir, f), `import { test } from "bun:test";\ntest.skip("needs data", () => {});\ntest("ok ${f}", () => { console.error("ran ${f}"); });\n`);

    const without = runIn(dir);
    expect(without.code).toBe(0);
    const lines = without.out.split("\n").filter((l) => l.startsWith("WARNING: no "));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`${join(dir, ".env.local")}: tests that need RUST_TS_DATA`);
    expect(without.out.indexOf(lines[0]!)).toBeGreaterThan(without.out.indexOf("ran b.test.ts"));
    expect(without.out).toContain("2 skip");

    writeFileSync(join(dir, ".env.local"), "");
    const withFile = runIn(dir);
    expect(withFile.code).toBe(0);
    expect(withFile.out).not.toContain("WARNING: no ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

test("the repo's bunfig.toml preloads it", () => {
  expect(readFileSync(join(REPO, "bunfig.toml"), "utf8")).toContain(`preload = ["./scripts/lib/env-local-note.ts"]`);
});
