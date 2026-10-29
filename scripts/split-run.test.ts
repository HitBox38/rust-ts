// Unit tests of difftest's split runs (`runSplit`, lane harness-m5b): how a run's outcome maps to the statuses of its
// run case and its sections, and what happens when the oracle's re-run (for the diff files' text) does not reproduce
// its cached entry. Also `usageOf` / `heavyErrorLines`. The oracle and the subject are a stub script that prints the
// output a spec file gives for its n-th invocation. difftest.ts loads scripts/lib/common.ts, so (as unstable.test.ts)
// it is loaded in a child process, with RUST_TS_DATA pointing at a temp dir: the shared oracle cache is never touched.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-split-run-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHILD = `
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const TMP = process.env.SPLIT_RUN_TMP;
const STUB = join(TMP, "stub.mjs");
writeFileSync(STUB, \`
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nf = process.argv[2] + ".n";
const n = existsSync(nf) ? Number(readFileSync(nf, "utf8")) : 0;
writeFileSync(nf, String(n + 1));
const o = spec[Math.min(n, spec.length - 1)];
if (o.sleepMs) await Bun.sleep(o.sleepMs);
await Bun.write(Bun.stdout, o.stdout ?? "");
await Bun.write(Bun.stderr, o.stderr ?? "");
process.exit(o.code ?? 0);
\`);
const PRE = ["// WARNING: This output format is intended for human consumers only", "// and is subject to change without notice. Knock yourself out.", "// HINT: See also -Z dump-mir for MIR at specific points during compilation."];
const fn = (name, v = "") => ["fn " + name + "() -> () {", "    let mut _0: ();" + v, "", "    bb0: {", "        return;", "    }", "}"];
const mir = (...items) => [...PRE, ...items.flatMap((it, i) => (i === 0 ? it : ["", ...it]))].join("\\n") + "\\n";
const AB = mir(fn("a"), fn("b"));
let k = 0;
/** A spec file: the outputs of the 1st, 2nd, ... invocation (the last one repeats). */
const spec = (...outs) => {
  const p = join(TMP, "spec" + k++ + ".json");
  writeFileSync(p, JSON.stringify(outs));
  return p;
};
const C = { id: "run", file: "", args: [] };
/** A split suite whose oracle and subject print what the spec files say. */
const suite = (name, o, s, extra = {}) => ({
  name: "split-run-test-" + name, milestone: "test", description: "", mode: "split", split: "mir-pretty", cwd: TMP, timeoutMs: 5000,
  cases: () => [C], oracle: () => [process.execPath, STUB, o], subject: () => [process.execPath, STUB, s], ...extra,
});
const stats = () => ({ processes: 0, batchOnlyFailures: 0, batchOnlyTimeouts: 0 });
const go = async (s) => {
  const r = await d.runSplit(s, C, "port", stats());
  return { results: r.results, diffs: Object.fromEntries(r.diffs), extra: r.extra, heavy: r.heavy, oracleRerun: r.oracleRerun, cached: existsSync(d.cachePath(s, C, "", [])) };
};
const out = {};
const ok = spec({ stdout: AB });
out.match = await go(suite("match", ok, ok));
out.extra = await go(suite("extra", ok, spec({ stdout: mir(fn("a"), fn("b"), fn("c")) })));
out.unported = await go(suite("unported", ok, spec({ stdout: mir(fn("a")), stderr: "rust-ts: unported: some::thing\\n", code: 70 })));
out.crash = await go(suite("crash", ok, spec({ stdout: AB, stderr: "error: internal compiler error\\n", code: 101 })));
out.exit = await go(suite("exit", ok, spec({ stdout: AB, stderr: "error: x\\n", code: 1 })));
out.timeout = await go(suite("timeout", ok, spec({ stdout: AB, sleepMs: 4000 }), { timeoutMs: 500 }));
out.oracleTimeout = await go(suite("oracle-timeout", spec({ stdout: AB, sleepMs: 3000 }), ok, { oracleTimeoutMs: 200 }));
out.unstableRun = await go(suite("unstable-run", ok, ok, { unstable: () => [{ id: "run", reason: "listed" }] }));
out.unstableSection = await go(suite("unstable-section", ok, spec({ stdout: mir(fn("a"), fn("b", " // x")) }), { unstable: () => [{ id: "run|fn b() -> ()", reason: "listed" }] }));
out.detected = await go(suite("detected", spec({ stdout: AB, stderr: "thread 'rustc' (12345) panicked at x.rs:1:1:\\n", code: 101 }), ok));
// The oracle's re-run: the 1st run caches the entry (subject MATCH); the 2nd differs in section a, so its diff file
// needs the oracle's text and the oracle runs again: its 2nd invocation reproduces, or not.
const twice = async (name, oracle, extra = {}) => {
  const s = suite(name, oracle, spec({ stdout: AB }, { stdout: mir(fn("a", " // x"), fn("b")) }), extra);
  const first = await go(s);
  return { first, second: await go(s) };
};
out.reproduced = await twice("reproduced", spec({ stdout: AB }), { heavy: { rssBudgetMb: 1 } });
out.wholeDiffers = await twice("whole", spec({ stdout: AB }, { stdout: AB, stderr: "warning: new\\n" }));
out.sectionDiffers = await twice("section", spec({ stdout: AB }, { stdout: mir(fn("a"), fn("b", " // changed")) }));
out.rerunTimeout = await twice("rerun-timeout", spec({ stdout: AB }, { stdout: AB, sleepMs: 10000 }), { oracleTimeoutMs: 1500 });
const pr = (usage, ms = 2000) => ({ stdout: "", stderr: "", code: 0, timedOut: false, ms, usage });
out.usage = {
  ok: d.usageOf(pr({ userMs: 1500, sysMs: 100, maxRssBytes: 300 * 2 ** 20 })),
  none: d.usageOf(pr(undefined)),
  nan: d.usageOf(pr({ userMs: NaN, sysMs: 1, maxRssBytes: 1 })),
  kib: d.usageOf(pr({ userMs: 5000, sysMs: 100, maxRssBytes: 300 * 1024 })),
  short: d.usageOf(pr({ userMs: 10, sysMs: 5, maxRssBytes: 2 * 2 ** 20 })),
};
const u = (maxRssMb, unavailable) => ({ exit: 0, timedOut: false, wallS: 1, userS: maxRssMb === null ? null : 1, sysS: maxRssMb === null ? null : 0, maxRssMb, ...(unavailable ? { unavailable } : {}) });
out.errors = {
  over: d.heavyErrorLines("s", { id: "run", oracle: "cached", subject: u(200), rssBudgetMb: 100, overBudget: true }),
  under: d.heavyErrorLines("s", { id: "run", oracle: u(50), subject: u(50), rssBudgetMb: 100, overBudget: false }),
  unavailable: d.heavyErrorLines("s", { id: "run", oracle: u(null, "why o"), subject: u(null, "why s"), oracleRerun: u(10), rssBudgetMb: 100, overBudget: false }),
};
console.log(JSON.stringify(out));
`;

type R = { id: string; status: string; first?: string; unported?: string; unstable?: string; subject?: string };
type Run = { results: R[]; diffs: Record<string, string>; extra: string[]; heavy?: { oracle: unknown; subject: { maxRssMb: number | null }; oracleRerun?: { maxRssMb: number | null }; overBudget: boolean }; oracleRerun?: { run: string; outcome: string; detail?: string }; cached: boolean };

const IDS = ["run", "run|fn a() -> ()", "run|fn b() -> ()"];
const statuses = (r: Run) => r.results.map((x) => [x.id, x.status]);
const all = (status: string) => IDS.map((id) => [id, status]);

test("split runs: status mapping, unstable runs and sections, the oracle re-run, usage", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: TMP, SPLIT_RUN_TMP: TMP } });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const lines = r.stdout.toString().trim().split("\n");
  const j = JSON.parse(lines.at(-1)!) as Record<string, Run> & { reproduced: { first: Run; second: Run }; wholeDiffers: { first: Run; second: Run }; sectionDiffers: { first: Run; second: Run }; rerunTimeout: { first: Run; second: Run } } & Record<string, any>;

  expect(statuses(j.match)).toEqual(all("MATCH"));
  expect(j.match.cached).toBe(true);
  expect(j.match.oracleRerun).toBeUndefined();
  // A section only the subject prints is not a case: it is listed, and the skeleton (the run case) differs.
  expect(statuses(j.extra)).toEqual([["run", "DIFF"], ["run|fn a() -> ()", "MATCH"], ["run|fn b() -> ()", "MATCH"]]);
  expect(j.extra.extra).toEqual(["run|fn c() -> ()"]);

  // A run-level failure spreads to every section; `unported`/`first` only on the run case.
  expect(statuses(j.unported)).toEqual(all("UNPORTED"));
  expect(j.unported.results[0]!.unported).toBe("some::thing");
  for (const x of j.unported.results.slice(1)) expect(x.unported ?? x.first).toBeUndefined();
  expect(statuses(j.crash)).toEqual(all("CRASH"));
  expect(j.crash.results[0]!.first).toContain("internal compiler error");
  expect(Object.keys(j.crash.diffs)).toEqual(["run"]);
  for (const x of j.crash.results.slice(1)) expect(x.first).toBeUndefined();
  expect(statuses(j.exit)).toEqual(all("DIFF"));
  expect(Object.keys(j.exit.diffs)).toEqual(["run"]);
  expect(statuses(j.timeout)).toEqual(all("TIMEOUT"));

  // An oracle timeout reports only the run case (there are no sections), with what the subject did; never cached.
  expect(j.oracleTimeout.results).toEqual([{ id: "run", status: "ORACLE_TIMEOUT", subject: "exit 0" }]);
  expect(j.oracleTimeout.cached).toBe(false);

  // `Suite.unstable` listing the run makes every case UNSTABLE (and the entry is never cached); listing one section
  // makes only that one UNSTABLE, and its diff file is dropped.
  expect(statuses(j.unstableRun)).toEqual(all("UNSTABLE"));
  expect(j.unstableRun.cached).toBe(false);
  expect(statuses(j.unstableSection)).toEqual([["run", "MATCH"], ["run|fn a() -> ()", "MATCH"], ["run|fn b() -> ()", "UNSTABLE"]]);
  expect(j.unstableSection.results[2]!.unstable).toBe("listed");
  expect(j.unstableSection.diffs).toEqual({});
  // A detected unstable oracle output (UNSTABLE_ORACLE_PATTERNS) too.
  expect(statuses(j.detected)).toEqual(all("UNSTABLE"));
  expect(j.detected.cached).toBe(false);

  // The re-run reproduces: scored as cached, and the diff file has the re-run's text.
  const rep = j.reproduced;
  expect(statuses(rep.first)).toEqual(all("MATCH"));
  expect(rep.first.heavy!.oracle).not.toBe("cached");
  expect(statuses(rep.second)).toEqual([["run", "MATCH"], ["run|fn a() -> ()", "DIFF"], ["run|fn b() -> ()", "MATCH"]]);
  expect(rep.second.oracleRerun).toEqual({ run: "run", outcome: "reproduced" });
  expect(rep.second.cached).toBe(true);
  expect(rep.second.diffs["run|fn a() -> ()"]).toContain("=== oracle (exit 0) ===\nfn a() -> () {\n    let mut _0: ();\n");
  expect(rep.second.results[1]!.first).toContain("// x");
  // A heavy run records the oracle as cached, the re-run's usage, and the subject over its 1 MB budget.
  expect(rep.second.heavy!.oracle).toBe("cached");
  expect(rep.second.heavy!.oracleRerun!.maxRssMb).toBeGreaterThan(1);
  expect(rep.second.heavy!.overBudget).toBe(true);

  // The re-run's stderr differs: nothing is scored against the cached entry; every case UNSTABLE, the entry removed.
  const whole = j.wholeDiffers.second;
  expect(statuses(j.wholeDiffers.first)).toEqual(all("MATCH"));
  expect(statuses(whole)).toEqual(all("UNSTABLE"));
  expect(whole.results[0]!.unstable).toBe("detected: the oracle's re-run did not reproduce its cached stderr");
  expect(whole.results[0]!.subject).toBe("exit 0");
  expect(whole.oracleRerun!.outcome).toBe("not reproduced");
  expect(whole.cached).toBe(false);
  expect(whole.diffs).toEqual({});
  expect(lines.some((l) => l.startsWith("ERROR: split-run-test-whole run: the oracle's re-run did not reproduce"))).toBe(true);

  // Only section b's text differs: b UNSTABLE, a keeps its DIFF (its text reproduced), the entry removed.
  const sec = j.sectionDiffers.second;
  expect(statuses(sec)).toEqual([["run", "MATCH"], ["run|fn a() -> ()", "DIFF"], ["run|fn b() -> ()", "UNSTABLE"]]);
  expect(sec.results[2]!.unstable).toBe("detected: the oracle's re-run did not reproduce its cached text of 1 section(s)");
  expect(sec.oracleRerun).toEqual({ run: "run", outcome: "not reproduced", detail: "1 section(s) differ and are UNSTABLE" });
  expect(sec.cached).toBe(false);
  expect(Object.keys(sec.diffs)).toEqual(["run|fn a() -> ()"]);

  // The re-run times out: the statuses stand (scored against the entry), with no oracle text for the diff files.
  const to = j.rerunTimeout.second;
  expect(statuses(to)).toEqual([["run", "MATCH"], ["run|fn a() -> ()", "DIFF"], ["run|fn b() -> ()", "MATCH"]]);
  expect(to.oracleRerun).toEqual({ run: "run", outcome: "timed out" });
  expect(to.results[1]!.first).toBe("(the oracle's text is not available: its re-run timed out)");
  expect(to.cached).toBe(true);

  // Usage: bytes to MB; missing, non-finite or implausible (KiB read as bytes after 1 s of CPU) is unavailable, not NaN.
  expect(j.usage.ok).toEqual({ exit: 0, timedOut: false, wallS: 2, userS: 1.5, sysS: 0.1, maxRssMb: 300 });
  for (const k of ["none", "nan", "kib"]) {
    expect(j.usage[k].maxRssMb).toBeNull();
    expect(j.usage[k].userS).toBeNull();
    expect(j.usage[k].unavailable.length).toBeGreaterThan(0);
  }
  expect(j.usage.kib.unavailable).toContain("implausible max RSS");
  expect(j.usage.short.maxRssMb).toBe(2);
  // An RSS over budget and an unavailable usage are ERROR: lines (reported, not a status; not a gate failure).
  expect(j.errors.over).toEqual(["ERROR: s run: subject max RSS 200 MB is over the suite's budget of 100 MB (plan-m5 D11: reported, not a status; does not fail the gate)"]);
  expect(j.errors.under).toEqual([]);
  expect(j.errors.unavailable.length).toBe(2);
  expect(j.errors.unavailable[0]).toStartWith("ERROR: s run: the subject's resource usage is unavailable (why s); its RSS budget is unchecked");
  expect(j.errors.unavailable[1]).toStartWith("ERROR: s run: the oracle's resource usage is unavailable (why o)");
}, 120_000);
