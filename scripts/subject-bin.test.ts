// The subject binary's tests (scripts/subject-bin.cases.ts) in a child `bun test`, with RUST_TS_DATA at a temp dir. They load
// scripts/lib/common.ts, which reads RUST_TS_DATA once, at import; loaded in the runner unit-test process before
// scripts/lib/deps.test.ts, they left it with the real data dir and its "uses a temp oracle cache" check failed. So (as
// scripts/gate-probes.test.ts and scripts/frozen-lists.test.ts) they run in a child; see scripts/lib/deps.test.ts.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const DATA = mkdtempSync(join(tmpdir(), "rust-ts-subject-bin-data-"));
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

test("scripts/subject-bin.cases.ts passes in a child with a temp RUST_TS_DATA", () => {
  const p = Bun.spawnSync([process.execPath, "test", "./scripts/subject-bin.cases.ts"], {
    cwd: REPO,
    env: { ...process.env, RUST_TS_DATA: DATA },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = p.stdout.toString() + p.stderr.toString();
  const failed = out.split("\n").filter((l) => l.startsWith("(fail)") || l.startsWith("error:"));
  expect({ exit: p.exitCode, failed }).toEqual({ exit: 0, failed: [] });
  expect(out).toMatch(/\n\s*\d+ pass\n\s*0 fail\n/);
}, 600_000);
