// Unit tests of the gate's probe check (scripts/gate.ts `checkProbes`, `oracleRuns`, `undeclaredRuns`; lane
// probe-rmetadump-fix, review probe-rmetadump finding 1): every registered suite passes it, including the rmeta suites,
// whose oracle command is scripts/rmeta-run.ts under Bun. gate.ts loads scripts/lib/common.ts, so (as
// scripts/unstable.test.ts) it is loaded in a child process; see scripts/lib/deps.test.ts for why.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CHILD = `
const { existsSync } = await import("node:fs");
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES, RMETA_RUN, IR_RUN, RG_CHECK, irReportSuite } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { parseIrRunArgs } = await import(${JSON.stringify(join(REPO, "scripts/ir-run.ts"))});
const { irTierError } = await import(${JSON.stringify(join(REPO, "scripts/lib/ir-normal.ts"))});
const { readFileSync } = await import("node:fs");
const { probeBinary } = await import(${JSON.stringify(join(REPO, "scripts/probes.ts"))});
// A suite whose declared probes are not all built cannot build its oracle command (probePath ends the process).
const built = (s) => (s.probes ?? []).every((p) => existsSync(probeBinary(p)));
const unbuilt = SUITES.filter((s) => !built(s)).map((s) => s.name);
const lines = [];
const log = console.log;
console.log = (...a) => lines.push(a.join(" "));
const all = unbuilt.length ? null : g.checkProbes(SUITES.map((s) => s.name), false);
// With the unit tests, every registered suite's probes are needed (this test reads them), with no suite run.
const { oracleTestProbes } = await import(${JSON.stringify(join(REPO, "scripts/probes.ts"))});
const unitProbes = [...new Set([...oracleTestProbes(["src", "tools", "scripts", "harness"]), ...SUITES.flatMap((s) => s.probes ?? [])])];
const unitUnbuilt = unitProbes.filter((p) => !existsSync(probeBinary(p)));
const unitLines = [];
console.log = (...a) => unitLines.push(a.join(" "));
const unit = g.checkProbes([], true);
console.log = log;
const bun = process.execPath;
const probe = probeBinary("rmetadump");
const wrap = (opts, compiler = ["rustc", "+x", "a.rs"]) => [bun, RMETA_RUN, "--out", "d", "--side", "oracle", ...opts, "--", ...compiler];
const fake = (probes, cmd) => g.undeclaredRuns({ name: "fake", probes, oracle: () => cmd });
const CASE = { id: "", file: "", args: [] };
const irTierOf = (cmd) => parseIrRunArgs(cmd.slice(2)).tier;
const irRunners = SUITES.filter(built).filter((s) => s.oracle([CASE])[1] === IR_RUN || s.subject([CASE])[1] === IR_RUN);
const history = readFileSync(${JSON.stringify(join(REPO, "docs/state/history.jsonl"))}, "utf8");
const hello = SUITES.find((s) => s.name === "ir-hello");
const report = irReportSuite(hello, "N3");
console.log(JSON.stringify({
  ir: irRunners.map((s) => ({ name: s.name, tier: s.irTier, oracle: irTierOf(s.oracle([CASE])), subject: irTierOf(s.subject([CASE])), diff: Boolean(s.irArgs) })),
  irTierErrors: SUITES.flatMap((s) => (s.irTier ? [irTierError(s.name, s.irTier, history)] : [])).filter(Boolean),
  irTiered: SUITES.filter((s) => s.irTier || s.irArgs).map((s) => s.name),
  report: { name: report.name, tier: report.irTier, oracle: irTierOf(report.oracle([CASE])), subject: irTierOf(report.subject([CASE])), criterion: report.criterion ?? null, again: irReportSuite(report, "N2").name },
  sameTier: irReportSuite(hello, "N1") === hello,
  registeredReports: SUITES.filter((s) => s.name.includes("@")).map((s) => s.name),
  keys: [hello.oracleKey(), report.oracleKey(), irReportSuite(hello, "N2").oracleKey()],
  acceptIr: g.acceptEntry(3, { total: 5, irTier: "N1" }),
  acceptPlain: g.acceptEntry(3, { total: 5 }),
  unbuilt,
  all,
  unit,
  unitUnbuilt,
  unitLines,
  lines,
  errors: SUITES.filter(built).flatMap((s) => g.undeclaredRuns(s)),
  rmetaRuns: SUITES.filter((s) => s.oracle([{ id: "", file: "", args: [] }])[1] === RMETA_RUN).map((s) => [s.name, g.oracleRuns(s.oracle([{ id: "", file: "", args: [] }]))]),
  probe,
  runsPlain: g.oracleRuns(["rustc", "+x"]),
  runsBytes: g.oracleRuns(wrap(["--bytes"])),
  runsDump: g.oracleRuns(wrap(["--dump", probe, "--dump-arg", "--content"])),
  bytesUndeclared: fake([], wrap(["--bytes"])),
  dumpDeclared: fake(["rmetadump"], wrap(["--dump", probe])),
  dumpUndeclared: fake([], wrap(["--dump", probe])),
  otherCompiler: fake(["rmetadump"], wrap(["--dump", probe], ["/bin/cc"])),
  otherScript: fake([], [bun, "scripts/other.ts", "--", "rustc"]),
  malformed: fake([], [bun, RMETA_RUN, "--side", "oracle", "--", "rustc"]),
  irRuns: g.oracleRuns([bun, IR_RUN, "--out", "d", "--side", "oracle", "--bin", "b", "--", "rustc", "+x"]),
  irOther: fake([], [bun, IR_RUN, "--out", "d", "--side", "oracle", "--bin", "b", "--", "/bin/cc"]),
  irMalformed: fake([], [bun, IR_RUN, "--side", "oracle", "--", "rustc"]),
  rgRuns: g.oracleRuns([bun, RG_CHECK, "run", "--label", "l", "--side", "oracle", "--target", "t"]),
}));
`;

test("checkProbes over every suite; the rmeta wrapper's compiler and probe", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // Under RUST_TS_REQUIRE_PROBES=1 every probe must be built, so every suite is checked.
  if (process.env.RUST_TS_REQUIRE_PROBES === "1") expect(j.unbuilt).toEqual([]);
  if (j.unbuilt.length === 0) expect({ all: j.all, lines: j.lines }).toEqual({ all: true, lines: [] });
  expect(j.errors).toEqual([]);
  // The unit-test pre-check fails exactly on the unbuilt probes the unit tests need, naming who needs them.
  expect(j.unit).toBe(j.unitUnbuilt.length === 0);
  expect(j.unitLines.length).toBe(j.unitUnbuilt.length);
  if (process.env.RUST_TS_REQUIRE_PROBES === "1") expect(j.unitUnbuilt).toEqual([]);
  // The suites that run the wrapper run the oracle rustc, and the dump suites the probe.
  expect(j.rmetaRuns).toEqual([
    ["rmeta-core", ["rustc", j.probe]],
    ["check-core", ["rustc"]],
    ["rmeta-ui", ["rustc", j.probe]],
    ["check-ui", ["rustc"]],
    ["check-alloc", ["rustc"]],
    ["rmeta-alloc", ["rustc", j.probe]],
    ["check-std", ["rustc"]],
    ["rmeta-std", ["rustc", j.probe]],
    ["check-chain", ["rustc"]],
    ["check-ui-encode-mir", ["rustc"]],
  ]);
  // Every suite that runs the IR wrapper names its tier, both sides read it at that tier, and it is N1 or has its decision (review harness-m7a H3).
  expect(j.ir.map((s: { name: string }) => s.name)).toContain("ir-hello");
  for (const s of j.ir) expect(s).toEqual({ name: s.name, tier: s.oracle, oracle: s.oracle, subject: s.oracle, diff: true });
  expect(j.irTiered).toEqual(j.ir.map((s: { name: string }) => s.name));
  expect(j.irTierErrors).toEqual([]);
  // Another tier is a report: its own name, its own key, no criterion, and not a registered suite, so no gate or baseline takes it.
  expect(j.report).toEqual({ name: "ir-hello@N3", tier: "N3", oracle: "N3", subject: "N3", criterion: null, again: "ir-hello@N2" });
  expect(j.sameTier).toBe(true);
  expect(j.registeredReports).toEqual([]);
  expect(new Set(j.keys).size).toBe(3);
  expect(j.acceptIr).toEqual({ protected: 3, total: 5, irTier: "N1" });
  expect(j.acceptPlain).toEqual({ protected: 3, total: 5 });
  // The IR wrapper's compiler, as the rmeta wrapper's; the check-rg script runs the oracle rustc through its own cargo.
  expect(j.irRuns).toEqual(["rustc"]);
  expect(j.irOther).toEqual(expect.arrayContaining([expect.stringContaining("/bin/cc")]));
  expect(j.irMalformed[0]).toContain("--bin");
  expect(j.rgRuns).toEqual(["rustc"]);
  expect(j.runsPlain).toEqual(["rustc"]);
  expect(j.runsBytes).toEqual(["rustc"]);
  expect(j.runsDump).toEqual(["rustc", j.probe]);
  expect(j.bytesUndeclared).toEqual([]);
  expect(j.dumpDeclared).toEqual([]);
  expect(j.dumpUndeclared).toEqual([`suite fake runs ${j.probe} but declares probes []`]);
  expect(j.otherCompiler).toEqual(["suite fake runs /bin/cc but declares probes [rmetadump]"]);
  // Bun running any other script is still Bun: not rustc, not a probe.
  expect(j.otherScript).toEqual([`suite fake runs ${process.execPath} but declares probes []`]);
  expect(j.malformed).toEqual(["suite fake: rmeta-run: --out and --side are required"]);
});

test("a stale probe stops the gate with what is wrong: the last line does not call it missing (review harness-m7a N2)", () => {
  const data = mkdtempSync(join(tmpdir(), "rust-ts-gate-stale-"));
  try {
    // A private RUST_TS_DATA with the probe "built" and stamped from other sources (N3 of the same review: no shared probes/ touched).
    mkdirSync(join(data, "rust", "compiler"), { recursive: true });
    expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
    const child = `
const { mkdirSync, writeFileSync } = await import("node:fs");
const { dirname } = await import("node:path");
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { probeBinary } = await import(${JSON.stringify(join(REPO, "scripts/probes.ts"))});
mkdirSync(dirname(probeBinary("rmetadump")), { recursive: true });
writeFileSync(probeBinary("rmetadump"), "");
mkdirSync(${JSON.stringify(join(data, "probes", "rmetadump"))}, { recursive: true });
writeFileSync(${JSON.stringify(join(data, "probes", "rmetadump", "source.hash"))}, "other sources\\n");
SUITES.push({ name: "stale-stub", milestone: "test", description: "", mode: "single", probes: ["rmetadump"], cases: () => [], oracle: () => ["rustc"], subject: () => ["x"] });
const readers = { pmset: async () => undefined, swapusage: async () => undefined, load: () => [], now: () => new Date() };
await gateRun(["stale-stub"], true, false, false, { readers, pollMs: 60000, keepEveryMs: 3600000 });
`;
    const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: data } });
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode, out).toBe(1);
    expect(out).toContain("ERROR: probe 'rmetadump' was built from other sources");
    expect(out).toContain("missing or stale");
    expect(out).not.toContain("missing probes");
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("difftest --ir-tier: a report under its own name, and it says so; a bad tier or a suite with no tiers is one ERROR: line", () => {
  const data = mkdtempSync(join(tmpdir(), "rust-ts-difftest-tier-"));
  try {
    mkdirSync(join(data, "rust", "compiler"), { recursive: true });
    expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
    const difftest = (...args: string[]) => {
      const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/difftest.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_TS_DATA: data } });
      return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
    };
    // A filter that selects no case: nothing runs, so this needs no oracle.
    const report = difftest("--suite", "ir-hello", "--ir-tier", "N3", "--filter", "no such case", "--run-id", "r");
    expect(report.code, report.out).toBe(0);
    expect(report.out).toContain("suite=ir-hello@N3 total=0");
    expect(report.out).toContain("ir tier: N3 (a report; no gate reads this name)");
    expect(existsSync(join(data, "runs", "r", "ir-hello@N3.summary.json"))).toBe(true);
    const own = difftest("--suite", "ir-hello", "--filter", "no such case", "--run-id", "o");
    expect(own.out).toContain("ir tier: N1\n");
    const bad = difftest("--suite", "ir-hello", "--ir-tier", "N9");
    expect([bad.code, bad.out.trim()]).toEqual([1, "ERROR: --ir-tier must be N1, N2 or N3, not N9"]);
    const none = difftest("--suite", "parse", "--ir-tier", "N3");
    expect([none.code, none.out.trim()]).toEqual([1, "ERROR: suite parse is not an IR suite, so it has no tiers"]);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("checkProbes with the unit tests: every suite's probe is needed up front, with its build hint", () => {
  // No probe is built under an empty RUST_TS_DATA (set before scripts/lib/common.ts is loaded).
  const child = `
process.env.RUST_TS_DATA = ${JSON.stringify(join(REPO, ".no-such-data-dir"))};
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const lines = [];
const log = console.log;
console.log = (...a) => lines.push(a.join(" "));
const ok = g.checkProbes([], true);
console.log = log;
console.log(JSON.stringify({ ok, lines }));
`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.ok).toBe(false);
  // rmetadump: read by scripts/gate-probes.test.ts and declared by the rmeta suites.
  expect(j.lines).toContain("ERROR: probe 'rmetadump' not built (needed by unit tests, runner unit tests (scripts/gate-probes.test.ts)); run: bun scripts/probes.ts build rmetadump");
  expect(j.lines.every((l: string) => l.startsWith("ERROR: probe '"))).toBe(true);
});

test("a fixture probe that is missing: its test fails under RUST_TS_REQUIRE_PROBES=1 and only then does its title not say skipped", () => {
  const run = (env: Record<string, string>) => {
    const r = Bun.spawnSync([process.execPath, "test", join(REPO, "tools/probes/fixtures.test.ts"), "-t", "randstream"], { cwd: REPO, env: { ...process.env, RUST_TS_DATA: join(REPO, ".no-such-data-dir"), RUST_TS_HOST_TUPLE: "aarch64-apple-darwin", ...env }, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
  };
  const required = run({ RUST_TS_REQUIRE_PROBES: "1" });
  expect(required.code).toBe(1);
  expect(required.out).toContain("(required, missing: probe not built; bun scripts/probes.ts build randstream)");
  expect(required.out).not.toContain("(skipped: probe not built");
  const optional = run({ RUST_TS_REQUIRE_PROBES: "0" });
  expect(optional.code).toBe(0);
  expect(optional.out).not.toContain("(required, missing");
}, 60_000);
