// `CaseResult.attempts` (scripts/difftest.ts, lane harness-w40): a subject that times out in the pool records each attempt's
// time and max RSS and the host's load around them, and that record changes no status. A real run of `difftest()` with a stub suite; as
// scripts/unported-buckets.test.ts, in a child, with RUST_TS_DATA at a temp dir holding an empty git repository as its
// upstream checkout: the shared oracle cache and run directories are never touched.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-retry-times-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHILD = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { RUNS } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const TMP = process.env.RETRY_TMP;
const STUB = join(TMP, "stub.mjs");
// argv: the side, then a case id. "once": the subject's first run hangs. "always": every run hangs.
writeFileSync(STUB, \`
import { existsSync, writeFileSync } from "node:fs";
const [side, id, dir] = process.argv.slice(2);
if (side === "subject") {
  const seen = dir + "/" + id + ".seen";
  if (id === "always" || (id === "once" && !existsSync(seen))) { writeFileSync(seen, ""); await Bun.sleep(60000); }
  if (id === "differs") { await Bun.write(Bun.stdout, "other\\\\n"); process.exit(0); }
}
await Bun.write(Bun.stdout, "ok\\\\n");
\`);
SUITES.push({
  name: "retry-times", milestone: "test", description: "", mode: "single", cwd: TMP, timeoutMs: 3000,
  cases: () => ["once", "always", "plain", "differs"].map((id) => ({ id, file: "", args: [] })),
  oracle: ([c]) => [process.execPath, STUB, "oracle", c.id, TMP], subject: ([c]) => [process.execPath, STUB, "subject", c.id, TMP],
});
await d.difftest({ suite: "retry-times", runId: "run", quiet: true, jobs: 4 });
console.log(JSON.stringify({ rows: readFileSync(join(RUNS, "run", "retry-times.jsonl"), "utf8").trim().split("\\n").map((l) => JSON.parse(l)) }));
`;

test("a pool timeout records each attempt; statuses are what they were", () => {
  mkdirSync(join(TMP, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(TMP, "rust")]).exitCode).toBe(0);
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: TMP, RETRY_TMP: TMP } });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const out = r.stdout.toString().trim().split("\n").at(-1)!;
  const rows = new Map((JSON.parse(out).rows as { id: string; status: string; retried?: boolean; attempts?: Record<string, { timedOut: boolean; wallS: number; maxRssMb: number | null; userS: number | null }> }[]).map((x) => [x.id, x]));
  // Matched only through the re-run: the pool's attempt timed out at the limit, the one alone did not.
  const once = rows.get("once")!;
  expect(once.status).toBe("MATCH");
  expect(once.retried).toBe(true);
  expect(once.attempts!.pool!.timedOut).toBe(true);
  expect(once.attempts!.pool!.wallS).toBeGreaterThanOrEqual(2.9);
  expect(once.attempts!.alone!.timedOut).toBe(false);
  expect(once.attempts!.alone!.maxRssMb).toBeGreaterThan(1);
  expect(once.attempts!.alone!.userS).not.toBeNull();
  // Timed out again: still TIMEOUT, with both attempts.
  const always = rows.get("always")!;
  expect(always.status).toBe("TIMEOUT");
  expect(always.retried).toBe(true);
  expect(always.attempts!.alone!.timedOut).toBe(true);
  // The host's 1-minute load at the pool's timeout and around the re-run (lane harness-w45, review w40d-audit N1); on Windows
  // `os.loadavg()` is always 0, elsewhere a busy test host is above 0.
  const loads = (row: typeof once) => (row.attempts as unknown as { load1: Record<string, number> }).load1;
  for (const row of [once, always]) {
    expect(Object.keys(loads(row))).toEqual(["pool", "aloneStart", "aloneEnd"]);
    for (const v of Object.values(loads(row))) {
      expect(Number.isFinite(v) && v >= 0).toBe(true);
      // Two decimals: `19.01 * 100` is 1901.0000000000002 in floating point, so compare with a tolerance (review harness-w45 F1).
      expect(Math.abs(Math.round(v * 100) - v * 100)).toBeLessThan(1e-6);
    }
  }
  if (process.platform !== "win32") expect(Object.values(loads(once)).some((v) => v > 0)).toBe(true);
  // No timeout, no record: the rows of every other case keep their fields.
  expect(rows.get("plain")).toEqual({ id: "plain", status: "MATCH" });
  expect(rows.get("differs")!.status).toBe("DIFF");
  expect(rows.get("differs")!.attempts).toBeUndefined();
}, 60_000);
