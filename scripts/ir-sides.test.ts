// `difftest()` runs an IR suite's two sides in turn (review harness-w42 F1): both compile at one work directory under a lock
// (scripts/ir-run.ts), so side by side the second's wait would count against its own limit. A real run with stub suites, in a
// child, with RUST_TS_DATA at a temp dir holding an empty git repository as its upstream checkout, as scripts/retry-times.test.ts.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-ir-sides-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHILD = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const TMP = process.env.IR_SIDES_TMP;
const STUB = join(TMP, "stub.mjs");
writeFileSync(STUB, \`
import { appendFileSync, readFileSync } from "node:fs";
const [log, side, other] = process.argv.slice(2);
appendFileSync(log, side + " start\\\\n");
// Sides that run together wait for each other here, so that says so on any host. Sides in turn name no other.
const until = Date.now() + 20000;
while (other && !readFileSync(log, "utf8").includes(other + " start") && Date.now() < until) await Bun.sleep(5);
if (!other) await Bun.sleep(100);
appendFileSync(log, side + " end\\\\n");
await Bun.write(Bun.stdout, "ok\\\\n");
\`);
const events = {};
for (const [name, extra, together] of [["sides-ir", { irTier: "N1" }, false], ["sides-plain", {}, true]]) {
  const log = join(TMP, name + ".log");
  writeFileSync(log, "");
  SUITES.push({
    name, milestone: "test", description: "", mode: "single", cwd: TMP, timeoutMs: 30000, ...extra,
    cases: () => [{ id: "only", file: "", args: [] }],
    oracle: () => [process.execPath, STUB, log, "oracle", ...(together ? ["subject"] : [])],
    subject: () => [process.execPath, STUB, log, "subject", ...(together ? ["oracle"] : [])],
  });
  await d.difftest({ suite: name, runId: name, quiet: true, jobs: 1 });
  events[name] = readFileSync(log, "utf8").trim().split("\\n");
}
console.log(JSON.stringify(events));
`;

test("an IR suite's sides run in turn; another suite's still run together", () => {
  mkdirSync(join(TMP, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(TMP, "rust")]).exitCode).toBe(0);
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, RUST_TS_DATA: TMP, IR_SIDES_TMP: TMP },
  });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const events = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) as Record<string, string[]>;
  expect(events["sides-ir"]).toEqual(["oracle start", "oracle end", "subject start", "subject end"]);
  expect(events["sides-plain"]!.slice(0, 2).every((e) => e.endsWith(" start"))).toBe(true);
}, 60_000);
