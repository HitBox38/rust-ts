// The rmeta suites' path through difftest (lane probe-rmetadump): split runs (`runSplit`) whose two sides are
// scripts/rmeta-run.ts over a fake compiler and a fake probe, cut by scripts/lib/split.ts `splitRmetaDump`, and the
// oracle cache key's `Suite.oracleKey` part. The fake compiler writes its last argument into the `-o` file (or fails as
// the port does today: exit 70, `rust-ts: unported: ...`); the fake probe prints the file (the "dump") and exits with
// $FAKE_PROBE_EXIT. As scripts/split-run.test.ts, difftest is loaded in a child process with RUST_TS_DATA pointing at a
// temp dir, so the shared oracle cache is never touched.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rmeta-split-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHILD = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const TMP = process.env.RMETA_SPLIT_TMP;
const COMPILER = join(TMP, "compiler.mjs");
writeFileSync(COMPILER, \`const a = process.argv.slice(2); const o = a[a.indexOf("-o") + 1];
if (a[0] === "unported") { process.stderr.write("rust-ts: unported: rustc_metadata::rmeta::encoder::encode_metadata\\\\n"); process.exit(70); }
require("node:fs").writeFileSync(o, a[0]);\`);
const PROBE = join(TMP, "probe.mjs");
writeFileSync(PROBE, \`const f = process.argv.slice(2).find((x) => x.endsWith(".rmeta"));
process.stdout.write(require("node:fs").readFileSync(f, "utf8"));
if (process.env.FAKE_PROBE_EXIT) { process.stderr.write("error: internal compiler error: decoding\\\\n"); process.exit(Number(process.env.FAKE_PROBE_EXIT)); }\`);
const WRAPPER = ${JSON.stringify(join(REPO, "scripts/rmeta-run.ts"))};
const dump = (...defs) => ["rmetadump foo", "== root", "  edition 2021", ...defs.flatMap((x) => ["== def ::" + x[0], "  index " + x[1]])].join("\\n") + "\\n";
const OK = dump(["a", 1], ["b", 2]);
const side = (name, sideName, src) => [process.execPath, WRAPPER, "--out", join(TMP, "out", name), "--side", sideName, "--dump", process.execPath, "--dump-arg", PROBE, "--dump-arg", "--", "--", process.execPath, COMPILER, src];
const C = { id: "foo", file: "", args: [] };
const suite = (name, subjectSrc, extra = {}) => ({
  name: "rmeta-split-test-" + name, milestone: "test", description: "", mode: "split", split: "rmetadump", cwd: TMP, timeoutMs: 10000,
  cases: () => [C], oracle: () => side(name, "oracle", OK), subject: () => side(name, "subject", subjectSrc), ...extra,
});
const stats = () => ({ processes: 0, batchOnlyFailures: 0, batchOnlyTimeouts: 0 });
const go = async (s) => (await d.runSplit(s, C, "port", stats())).results;
const out = {};
out.match = await go(suite("match", OK));
out.diff = await go(suite("diff", dump(["a", 1], ["b", 3])));
out.unported = await go(suite("unported", "unported"));
process.env.FAKE_PROBE_EXIT = "101";
out.crash = await go(suite("crash", OK, { oracle: () => ["true"] }));
delete process.env.FAKE_PROBE_EXIT;
out.keys = [suite("k1", OK), suite("k1", OK, { oracleKey: () => "a" }), suite("k1", OK, { oracleKey: () => "b" })].map((s) => d.cachePath(s, C, "", []));
console.log(JSON.stringify(out));
`;

type R = { id: string; status: string; unported?: string; first?: string };

test("rmeta split runs: sections, run-level failures, the oracleKey cache part", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: TMP, RMETA_SPLIT_TMP: TMP } });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) as Record<string, R[]> & { keys: string[] };
  const st = (rs: R[]) => rs.map((x) => [x.id, x.status]);
  const ids = ["foo", "foo|root", "foo|def ::a", "foo|def ::b"];
  expect(st(j.match)).toEqual(ids.map((id) => [id, "MATCH"]));
  // One differing def: that section only (the skeleton, i.e. the run case, is the same).
  expect(st(j.diff)).toEqual([["foo", "MATCH"], ["foo|root", "MATCH"], ["foo|def ::a", "MATCH"], ["foo|def ::b", "DIFF"]]);
  expect(j.diff[3]!.first).toBe(`2: "  index 2" | "  index 3"`);
  // The port today: its compiler stops UNPORTED, so every case of the run is UNPORTED, with what on the run case.
  expect(st(j.unported)).toEqual(ids.map((id) => [id, "UNPORTED"]));
  expect(j.unported[0]!.unported).toBe("rustc_metadata::rmeta::encoder::encode_metadata");
  // The probe cannot read the subject's file (an ICE, exit 101): a CRASH of the run, every section with it. (The oracle
  // here is `true`: exit 0, no sections, so only the run case is reported.)
  expect(st(j.crash)).toEqual([["foo", "CRASH"]]);
  // `Suite.oracleKey` joins the cache key only when set, and changes it.
  expect(new Set(j.keys).size).toBe(3);
}, 60_000);
