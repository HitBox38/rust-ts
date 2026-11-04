// Summary `unportedBuckets` (scripts/difftest.ts, lane harness-w38): how many UNPORTED cases stopped on each reason, on
// real runs of `difftest()` with stub suites (single and split), read back from the run's own files. Also pins
// what readers rely on: the `<suite>.jsonl` rows keep their reason and only their fields, and the flat `UNPORTED` count stays.
// difftest.ts loads scripts/lib/common.ts, so (as split-run.test.ts) it runs in a child, with RUST_TS_DATA pointing at a
// temp dir: the shared oracle cache and run directories are never touched. The temp dir has an empty git repository as
// its upstream checkout, which `difftest` only checks for and reads the `git status` of.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-unported-buckets-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHILD = `
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { RUNS } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const TMP = process.env.BUCKETS_TMP;
const STUB = join(TMP, "stub.mjs");
// argv: the side, then a case id. The subject's behaviour for an id is in its name.
writeFileSync(STUB, \`
const [side, id] = process.argv.slice(2);
if (side === "subject" && id.startsWith("unported-")) {
  await Bun.write(Bun.stderr, "note\\\\nrust-ts: unported: " + id.split("-")[1] + "\\\\n");
  process.exit(70);
}
if (side === "subject" && id === "silent") process.exit(70);
await Bun.write(Bun.stdout, "ok\\\\n");
\`);
const IDS = ["unported-b-1", "unported-a-1", "unported-a-2", "silent", "match"];
const cases = (ids) => ids.map((id) => ({ id, file: "", args: [] }));
const suite = (name, ids, extra = {}) => ({
  name, milestone: "test", description: "", mode: "single", cwd: TMP, timeoutMs: 20000, cases: () => cases(ids),
  oracle: ([c]) => [process.execPath, STUB, "oracle", c.id], subject: ([c]) => [process.execPath, STUB, "subject", c.id], ...extra,
});
const PRE = ["// WARNING: This output format is intended for human consumers only", "// and is subject to change without notice. Knock yourself out.", "// HINT: See also -Z dump-mir for MIR at specific points during compilation."];
const fn = (name) => ["fn " + name + "() -> () {", "    let mut _0: ();", "", "    bb0: {", "        return;", "    }", "}"];
const AB = [...PRE, ...fn("a"), "", ...fn("b")].join("\\n") + "\\n";
const SPLIT_STUB = join(TMP, "split.mjs");
writeFileSync(SPLIT_STUB, \`
const [side, id] = process.argv.slice(2);
await Bun.write(Bun.stdout, \${JSON.stringify(AB)});
if (side === "subject") { await Bun.write(Bun.stderr, "rust-ts: unported: " + id + "\\\\n"); process.exit(70); }
\`);
SUITES.push(
  suite("buckets-single", IDS),
  suite("buckets-none", ["match"]),
  suite("buckets-split", ["r1", "r2"], {
    mode: "split", split: "mir-pretty",
    oracle: ([c]) => [process.execPath, SPLIT_STUB, "oracle", c.id], subject: ([c]) => [process.execPath, SPLIT_STUB, "subject", c.id],
  }),
);
const go = async (name) => {
  await d.difftest({ suite: name, runId: "run-" + name, quiet: true, jobs: 2 });
  const dir = join(RUNS, "run-" + name);
  return {
    summary: JSON.parse(readFileSync(join(dir, name + ".summary.json"), "utf8")),
    rows: readFileSync(join(dir, name + ".jsonl"), "utf8").trim().split("\\n").map((l) => JSON.parse(l)),
  };
};
console.log(JSON.stringify({
  single: await go("buckets-single"),
  none: await go("buckets-none"),
  split: await go("buckets-split"),
  noReason: d.UNPORTED_NO_REASON,
  pure: d.unportedBuckets([
    { id: "1", status: "UNPORTED", unported: "z" },
    { id: "2", status: "UNPORTED", unported: "y" },
    { id: "3", status: "UNPORTED" },
    { id: "4", status: "UNPORTED" },
    { id: "5", status: "UNPORTED" },
    { id: "6", status: "DIFF", unported: "not counted" },
    { id: "7", status: "ORACLE_TIMEOUT", subject: "UNPORTED: not counted" },
  ], new Map([["5", "z"]])),
}));
`;

test("the summary counts UNPORTED cases per reason; the rows and the flat count are as before", () => {
  mkdirSync(join(TMP, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(TMP, "rust")]).exitCode).toBe(0);
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env: { ...process.env, RUST_TS_DATA: TMP, BUCKETS_TMP: TMP }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);

  // Single mode: most frequent first, ties by reason, an exit 70 with no line in its own bucket; they sum to `UNPORTED`.
  expect(j.single.summary.UNPORTED).toBe(4);
  expect(j.single.summary.MATCH).toBe(1);
  expect(Object.entries(j.single.summary.unportedBuckets)).toEqual([["a", 2], ["(no reason printed)", 1], ["b", 1]]);
  expect(j.noReason).toBe("(no reason printed)");
  // The rows keep exactly what they had.
  expect(j.single.rows).toEqual([
    { id: "match", status: "MATCH" },
    { id: "silent", status: "UNPORTED" },
    { id: "unported-a-1", status: "UNPORTED", unported: "a" },
    { id: "unported-a-2", status: "UNPORTED", unported: "a" },
    { id: "unported-b-1", status: "UNPORTED", unported: "b" },
  ]);

  // No UNPORTED case: no key, like the summary's other conditional parts.
  expect(j.none.summary.UNPORTED).toBe(0);
  expect(j.none.summary.unportedBuckets).toBeUndefined();

  // Split: a section row has no reason of its own (only its run case does), yet counts under its run's reason.
  expect(j.split.summary.UNPORTED).toBe(6);
  expect(j.split.summary.unportedBuckets).toEqual({ r1: 3, r2: 3 });
  expect(j.split.rows.filter((x: { unported?: string }) => x.unported !== undefined).map((x: { id: string }) => x.id)).toEqual(["r1", "r2"]);

  // Only UNPORTED rows count; the row's reason, else the given one, else no reason.
  expect(Object.entries(j.pure)).toEqual([["(no reason printed)", 2], ["z", 2], ["y", 1]]);
}, 120_000);
