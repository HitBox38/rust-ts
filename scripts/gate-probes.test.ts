// Unit tests of the gate's probe check (scripts/gate.ts `checkProbes`, `oracleRuns`, `undeclaredRuns`; lane
// probe-rmetadump-fix, review probe-rmetadump finding 1): every registered suite passes it, including the rmeta suites,
// whose oracle command is scripts/rmeta-run.ts under Bun. gate.ts loads scripts/lib/common.ts, so (as
// scripts/unstable.test.ts) it is loaded in a child process; see scripts/lib/deps.test.ts for why.
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CHILD = `
const { existsSync } = await import("node:fs");
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES, RMETA_RUN } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { probeBinary } = await import(${JSON.stringify(join(REPO, "scripts/probes.ts"))});
// A suite whose declared probes are not all built cannot build its oracle command (probePath ends the process).
const built = (s) => (s.probes ?? []).every((p) => existsSync(probeBinary(p)));
const unbuilt = SUITES.filter((s) => !built(s)).map((s) => s.name);
const lines = [];
const log = console.log;
console.log = (...a) => lines.push(a.join(" "));
const all = unbuilt.length ? null : g.checkProbes(SUITES.map((s) => s.name), false);
console.log = log;
const bun = process.execPath;
const probe = probeBinary("rmetadump");
const wrap = (opts, compiler = ["rustc", "+x", "a.rs"]) => [bun, RMETA_RUN, "--out", "d", "--side", "oracle", ...opts, "--", ...compiler];
const fake = (probes, cmd) => g.undeclaredRuns({ name: "fake", probes, oracle: () => cmd });
console.log(JSON.stringify({
  unbuilt,
  all,
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
  ]);
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
