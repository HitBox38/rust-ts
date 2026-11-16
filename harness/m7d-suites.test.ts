// M7d's suites' definitions (harness/suites.ts; plan-m7 §6, D19; lane harness-m7d), in a child process (it loads scripts/lib/common.ts; see
// scripts/lib/deps.test.ts for why). No suite runs here, and pm-self's 282 cases are not made (that reads every tests/ui directive): the
// oracle-side runs are in docs/handoff/harness-m7d.md.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

test("M7d's suites: which are protected, their commands, the corpus and the queries", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { rgCorpus, rgQueries } = await import(${JSON.stringify(join(REPO, "scripts/rg-behaviour.ts"))});
const get = (n) => s.suite(n);
const fake = { id: "files", file: "", args: ["--files", "--sort=path"] };
const pmFake = { id: "tests/ui/a.rs", file: "tests/ui/a.rs", args: ["--aux-key", "0123456789abcdef", "--step", JSON.stringify({ file: "tests/ui/auxiliary/b.rs", args: ["--crate-type", "proc-macro"], env: { PATH: "/usr/bin" } }), "--", "tests/ui/a.rs"] };
const shape = (n) => { const x = get(n); return [x.mode, x.split ?? null, Boolean(x.heavy), x.cwd === undefined ? null : x.cwd.split("/").pop(), x.inputDirs ?? null, x.criterion?.percent ?? null]; };
console.log(JSON.stringify({
  names: s.SUITES.map((x) => x.name).filter((n) => ["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "std-self"].includes(n)),
  shapes: Object.fromEntries(["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "std-self"].map((n) => [n, shape(n)])),
  build: { oracle: get("rg-build").oracle([fake]).slice(1), subject: get("rg-build").subject([fake]).slice(1), cases: get("rg-build").cases() },
  query: { oracle: get("rg-behaviour").oracle([fake]).slice(1), subject: get("rg-behaviour").subject([fake]).slice(1), lock: get("rg-behaviour").caseLock(fake) },
  stdinQuery: get("rg-behaviour").oracle([{ id: "stdin", file: "", args: ["-n", "foo"] }]),
  cases: get("rg-behaviour").cases().map((c) => c.id),
  queryIds: rgQueries().map((q) => q.id),
  corpus: Object.keys(rgCorpus()).sort(),
  rgtest: [get("rg-behaviour-rgtest").cases(), get("rg-behaviour-rgtest").oracle([fake]).slice(2, 7)],
  pm: { oracle: get("pm-self").oracle([pmFake]).slice(1), subject: get("pm-self").subject([pmFake]).slice(1), lock: get("pm-self").caseLock(pmFake) },
  std: [get("std-self").cases(), get("std-self").skipped()],
  keys: [get("rg-build").oracleKey(), get("rg-behaviour").oracleKey(), get("rg-behaviour-rgtest").oracleKey(), get("pm-self").oracleKey()],
  undeclared: ["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "std-self"].flatMap((n) => g.undeclaredRuns(get(n))),
  runs: ["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self"].map((n) => g.oracleRuns(get(n).oracle([n === "pm-self" ? pmFake : fake]))),
  // Review harness-m7d F2: the ripgrep suites' no-result mark is never cached (UNSTABLE); no other suite has the hook.
  noResult: ["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "parse", "run-pass-native"].map((n) => d.oracleUnstableReason(get(n), "warning: x\\nrg-harness: no result: the build was interrupted (SIGTERM)\\n") ?? null),
  plain: d.oracleUnstableReason(get("rg-behaviour"), "rg: foo: No such file or directory\\n") ?? null,
  hooked: s.SUITES.filter((x) => x.uncachedOracle).map((x) => x.name),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.names).toEqual(["rg-build", "rg-behaviour", "rg-behaviour-rgtest", "pm-self", "std-self"]);
  expect(j.shapes).toEqual({
    "rg-build": ["single", null, true, "ripgrep", ["ripgrep-15.2.0", "cargo/registry/src"], 100],
    "rg-behaviour": ["single", null, true, "ripgrep", ["ripgrep-15.2.0", "cargo/registry/src"], 100],
    "rg-behaviour-rgtest": ["split", "rmetadump", true, "ripgrep", ["ripgrep-15.2.0", "cargo/registry/src"], null],
    "pm-self": ["single", null, false, null, null, null],
    // The repository's directory, whatever this checkout is called.
    "std-self": ["single", null, true, expect.any(String), null, null],
  });
  // gate-20261115-141315-root-qswd's accept protected rg-build, rg-behaviour(-rgtest) and pm-self (M7d); std-self stays report
  // only, with no baseline, so it is not in the gate's defaults (w40t-audit N5).
  for (const n of j.names) expect(existsSync(join(REPO, "harness/baseline", `${n}.txt`))).toBe(n !== "std-self");
  // rg-build: one case, the wrapper's two sides differing only in --side and the compiler after `--`.
  expect(j.build.cases).toEqual([{ id: "ripgrep-15.2.0", file: "ripgrep-15.2.0/Cargo.lock", args: ["release", "-j1"] }]);
  expect(j.build.oracle[0]).toEndWith("scripts/rg-build.ts");
  expect(j.build.oracle.slice(1, 5)).toEqual(["run", "--side", "oracle", "--"]);
  expect(j.build.oracle[5]).toMatch(/\/bin\/rustc$/);
  expect(j.build.subject.slice(1, 5)).toEqual(["run", "--side", "subject", "--"]);
  expect(j.build.subject.join(" ")).toMatch(/src\/rust_ts\/main\.ts --sysroot \/\S+$/);
  // rg-behaviour: one case per scripted query, in the file's order; both sides in one directory under one lock.
  expect(j.cases).toEqual(j.queryIds);
  expect(j.cases.length).toBeGreaterThanOrEqual(50);
  expect(new Set(j.cases).size).toBe(j.cases.length);
  const dir = (cmd: string[]) => cmd[cmd.indexOf("--dir") + 1];
  expect(dir(j.query.oracle)).toBe(dir(j.query.subject));
  expect(dir(j.query.oracle)).toMatch(/\/ripgrep\/behaviour\/[0-9a-f]{16}$/);
  expect(j.query.lock).toBe(`${dir(j.query.oracle)}.case.lock`);
  expect(JSON.parse(j.query.oracle[j.query.oracle.indexOf("--query") + 1])).toEqual({ args: ["--files", "--sort=path"] });
  // A query's stdin comes from the query file, by id.
  expect(JSON.parse(j.stdinQuery[j.stdinQuery.indexOf("--query") + 1])).toEqual({ args: ["-n", "foo"], stdin: "one foo\ntwo\nthree foo\n" });
  // The corpus has what the queries name: ignore files, hidden and ignored files, a binary and a Latin-1 file.
  for (const f of [".gitignore", ".rgignore", ".hidden/secret.txt", "app.log", "keep.log", "build/output.txt", "data/binary.bin", "data/latin1.txt", "patterns.txt", "words.txt"]) expect(j.corpus).toContain(f);
  expect(j.rgtest[0]).toEqual([{ id: "integration", file: "", args: [] }]);
  expect(j.rgtest[1]).toEqual(["rgtest", "--side", "oracle", "--dir", expect.stringMatching(/\/ripgrep\/rgtest-run$/)]);
  // pm-self: the compiler as JSON, then the case's own argv; the oracle's is `rustc +<pin>`.
  expect(j.pm.oracle[0]).toEndWith("scripts/pm-self-run.ts");
  expect(j.pm.oracle.slice(1, 3)).toEqual(["--side", "oracle"]);
  expect(dir(j.pm.oracle)).toBe(dir(j.pm.subject));
  expect(dir(j.pm.oracle)).toMatch(/\/pm-self\/[0-9a-f]{16}$/);
  expect(j.pm.lock).toBe(`${dir(j.pm.oracle)}.case.lock`);
  expect(JSON.parse(j.pm.oracle[j.pm.oracle.indexOf("--compiler") + 1])).toEqual(["rustc", expect.stringMatching(/^\+nightly/)]);
  expect(JSON.parse(j.pm.subject[j.pm.subject.indexOf("--compiler") + 1]).join(" ")).toContain("src/rust_ts/main.ts");
  expect(j.pm.oracle.slice(-6)).toEqual(pmCaseArgs());
  // std-self: defined, no case, the reason as its skip.
  expect(j.std[0]).toEqual([]);
  expect(j.std[1]).toEqual([{ id: "hello", reason: expect.stringContaining("too heavy") }]);
  for (const k of j.keys) expect(k).toMatch(/^[0-9a-f]{40,64}$/);
  expect(new Set(j.keys).size).toBe(4);
  // gate.ts's probe check: each runs the oracle rustc and nothing undeclared.
  expect(j.undeclared).toEqual([]);
  expect(j.runs).toEqual([["rustc"], ["rustc"], ["rustc"], ["rustc"]]);
  const why = "detected: the ripgrep harness had no result: the build was interrupted (SIGTERM)";
  expect(j.noResult).toEqual([why, why, why, null, null, null]);
  expect(j.plain).toBeNull();
  expect(j.hooked).toEqual(["rg-build", "rg-behaviour", "rg-behaviour-rgtest"]);
}, 60_000);

const pmCaseArgs = () => ["--aux-key", "0123456789abcdef", "--step", JSON.stringify({ file: "tests/ui/auxiliary/b.rs", args: ["--crate-type", "proc-macro"], env: { PATH: "/usr/bin" } }), "--", "tests/ui/a.rs"];

test("the corpus and queries files are small and well-formed", () => {
  const corpus = readFileSync(join(REPO, "harness/corpus/rg-behaviour/corpus.json"));
  const queries = JSON.parse(readFileSync(join(REPO, "harness/corpus/rg-behaviour/queries.json"), "utf8")) as { queries: { id: string; args: unknown[]; stdin?: unknown }[] };
  expect(corpus.length).toBeLessThan(16 * 1024);
  for (const q of queries.queries) {
    expect(q.id).toMatch(/^[a-z0-9-]+$/);
    expect(q.args.every((a) => typeof a === "string")).toBe(true);
    if (q.stdin !== undefined) expect(typeof q.stdin).toBe("string");
  }
  // A query that searches a directory must fix the order (rg's parallel walk prints files as it finds them): it names a file, or sorts.
  const searchesDir = (a: string[]) => !a.some((x) => /^--sort(r)?=/.test(x)) && !a.includes("--version") && !/\.(txt|md|rs|csv|bin)$/.test(a.at(-1) ?? "");
  expect(queries.queries.filter((q) => q.stdin === undefined && searchesDir(q.args as string[])).map((q) => q.id)).toEqual([]);
});
