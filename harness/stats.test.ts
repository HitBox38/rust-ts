// The `stats-ui` report suite's case generation (lane harness-w51; harness/stats.ts). The case functions are pure and checked on
// fixtures; the registered suite (harness/suites.ts loads scripts/lib/common.ts, so, as harness/cli.test.ts, it is loaded in a
// child) is checked on the pinned upstream sources.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Case } from "./suites.ts";
import { STATS_FLAGS, statsCrateCases, statsFlagOf, statsUiArgs, statsUiSuite } from "./stats.ts";

const REPO = resolve(import.meta.dir, "..");

const crate = (f: string): Case => ({ id: f, file: f, args: ["--target", "t", "--crate-type", "lib", "--emit=metadata", f], env: { RUSTC_ICE: "0" } });

test("statsCrateCases: each crate with each flag appended, flags in order; statsFlagOf tells them from UI tests", () => {
  const cs = statsCrateCases([crate("a/auxiliary/x.rs"), crate("b/auxiliary/y.rs")]);
  expect(cs.map((c) => c.id)).toEqual(STATS_FLAGS.flatMap((f) => [`${f} a/auxiliary/x.rs`, `${f} b/auxiliary/y.rs`]));
  expect(cs[0]).toEqual({ id: "-Zinput-stats a/auxiliary/x.rs", file: "a/auxiliary/x.rs", args: ["--target", "t", "--crate-type", "lib", "--emit=metadata", "a/auxiliary/x.rs", "-Zinput-stats"], env: { RUSTC_ICE: "0" } });
  expect(cs.map((c) => statsFlagOf(c.id))).toEqual(STATS_FLAGS.flatMap((f) => [f, f]));
  expect(statsFlagOf("tests/ui/stats/meta-stats.rs")).toBeUndefined();
  expect(statsFlagOf("-Zother a.rs")).toBeUndefined();
});

test("statsUiArgs: --emit=metadata unless compiletest passes --emit metadata; not the parse-only argv; a stats flag required", () => {
  expect(statsUiArgs("t", ["x.rs", "--emit", "metadata", "-Zmacro-stats"])).toEqual(["x.rs", "--emit", "metadata", "-Zmacro-stats"]);
  expect(statsUiArgs("t", ["x.rs", "-C", "prefer-dynamic", "-Zmeta-stats"])).toEqual(["x.rs", "-C", "prefer-dynamic", "-Zmeta-stats", "--emit=metadata"]);
  expect(() => statsUiArgs("t", ["x.rs", "-Zmacro-stats", "-Zparse-crate-root-only"])).toThrow("ERROR: t: argv ends with -Zparse-crate-root-only");
  expect(() => statsUiArgs("t", ["x.rs", "--emit", "metadata"])).toThrow("ERROR: t: argv has none of -Zinput-stats, -Zmacro-stats, -Zmeta-stats");
});

test("statsUiSuite: UI cases first, then the crate cases; each side's command by kind; subsets; skips from the UI tests", () => {
  const ui: Case = { id: "tests/ui/stats/meta-stats.rs", file: "tests/ui/stats/meta-stats.rs", args: ["tests/ui/stats/meta-stats.rs", "-Zmeta-stats", "--emit=metadata"] };
  const s = statsUiSuite({
    ui: () => ({ cases: [ui], skipped: [{ id: "tests/ui/stats/z.rs", reason: "r" }] }),
    crates: () => [crate("a/auxiliary/x.rs")],
    uiCmd: (side, c) => [`${side}-ui`, ...c.args],
    crateCmd: (side, c) => [`${side}-crate`, ...c.args],
    oracleKey: () => "k",
  });
  const cs = s.cases();
  expect(cs.map((c) => c.id)).toEqual(["tests/ui/stats/meta-stats.rs", ...STATS_FLAGS.map((f) => `${f} a/auxiliary/x.rs`)]);
  expect(s.oracle([cs[0]!])[0]).toBe("oracle-ui");
  expect(s.subject([cs[0]!])[0]).toBe("subject-ui");
  expect(s.oracle([cs[3]!])).toEqual(["oracle-crate", "--target", "t", "--crate-type", "lib", "--emit=metadata", "a/auxiliary/x.rs", "-Zmeta-stats"]);
  expect(s.subject([cs[1]!])[0]).toBe("subject-crate");
  expect(Object.fromEntries(Object.entries(s.subsets!).map(([k, f]) => [k, cs.filter(f).map((c) => c.id)]))).toEqual({
    ui: ["tests/ui/stats/meta-stats.rs"],
    "-Zinput-stats": ["-Zinput-stats a/auxiliary/x.rs"],
    "-Zmacro-stats": ["-Zmacro-stats a/auxiliary/x.rs"],
    "-Zmeta-stats": ["-Zmeta-stats a/auxiliary/x.rs"],
  });
  expect(s.skipped!()).toEqual([{ id: "tests/ui/stats/z.rs", reason: "r" }]);
  expect(s.oracleKey!()).toBe("k");
  expect([s.name, s.mode]).toEqual(["stats-ui", "single"]);
});

test("the registered suite: report only, no baseline; the 3 tests/ui/stats tests and 3 x check-ui's crates on the pinned upstream", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { oracleRustcCmd } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const x = s.suite("stats-ui");
const ui = s.suite("check-ui").cases();
const cases = x.cases();
const counts = {};
for (const c of cases) for (const [k, f] of Object.entries(x.subsets)) if (f(c)) counts[k] = (counts[k] ?? 0) + 1;
const at = (id) => cases.find((c) => c.id === id);
const meta = at("tests/ui/stats/meta-stats.rs");
const input = at("tests/ui/stats/input-stats.rs");
const crate = at("-Zmeta-stats " + ui[0].id);
const co = x.oracle([crate]);
const cs = x.subject([crate]);
console.log(JSON.stringify({
  mode: x.mode, heavy: Boolean(x.heavy), n: cases.length, ids: new Set(cases.map((c) => c.id)).size, counts, skipped: x.skipped(),
  uiIds: cases.slice(0, 3).map((c) => c.id),
  metaTail: meta.args.slice(-2), inputEmit: input.args.filter((a, i) => a === "--emit" || a.startsWith("--emit=") || input.args[i - 1] === "--emit"),
  outDir: meta.args[meta.args.indexOf("--out-dir") + 1],
  uiOracle: JSON.stringify(x.oracle([meta])) === JSON.stringify(oracleRustcCmd(meta.args)),
  uiSubjectMain: x.subject([meta]).some((a) => a.endsWith("src/rust_ts/main.ts") || a.endsWith("/main")),
  crateIsCheckUi: cases.filter((c) => c.id.startsWith("-Z")).every((c) => { const u = ui.find((v) => c.id.endsWith(" " + v.id)); return u && JSON.stringify(c.args) === JSON.stringify([...u.args, c.id.split(" ")[0]]) && JSON.stringify(c.env) === JSON.stringify(u.env); }),
  crateWrapper: co.some((a) => a.endsWith("scripts/rmeta-run.ts")) && !co.includes("--bytes") && !co.includes("--dump"),
  crateSides: [co[co.indexOf("--side") + 1], cs[cs.indexOf("--side") + 1]],
  crateOracleTail: JSON.stringify(co.slice(co.indexOf("--") + 1)) === JSON.stringify(oracleRustcCmd(crate.args)),
  runs: g.oracleRuns(co), uiRuns: g.oracleRuns(x.oracle([meta])), undeclared: g.undeclaredRuns(x),
  keyed: typeof x.oracleKey() === "string",
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j).toEqual({
    mode: "single",
    heavy: false,
    // At the pin: 3 tests in tests/ui/stats (input-stats.rs's needs-asm-support and needs-deterministic-layouts hold for
    // x86_64-unknown-linux-gnu), 730 check-ui crates.
    n: 2193,
    ids: 2193,
    counts: { ui: 3, "-Zinput-stats": 730, "-Zmacro-stats": 730, "-Zmeta-stats": 730 },
    skipped: [],
    uiIds: ["tests/ui/stats/input-stats.rs", "tests/ui/stats/macro-stats.rs", "tests/ui/stats/meta-stats.rs"],
    // meta-stats.rs is build-pass: metadata only, appended; input-stats.rs is check-pass: compiletest's own `--emit metadata`.
    metaTail: ["-Zmeta-stats", "--emit=metadata"],
    inputEmit: ["--emit", "metadata"],
    outDir: "build/x86_64-unknown-linux-gnu/test/ui/stats/meta-stats",
    uiOracle: true,
    uiSubjectMain: true,
    crateIsCheckUi: true,
    crateWrapper: true,
    crateSides: ["oracle", "subject"],
    crateOracleTail: true,
    runs: ["rustc"],
    uiRuns: ["rustc"],
    undeclared: [],
    keyed: true,
  });
  expect(existsSync(join(REPO, "harness", "baseline", "stats-ui.txt"))).toBe(false);
}, 120_000);
