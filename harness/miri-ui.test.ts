// Unit tests of Miri's own test cases (lane harness-m6c, plan-m6 D13, A8): ui_test's directive rules, revision expansion
// and target filters (harness/compiletest.ts "Miri's own tests"), checked against ui_test-0.30.7's sources by hand; the
// argv of ui.rs; the suites; and Miri-built aux crates. As harness/compiletest.test.ts does, everything that loads
// scripts/lib/common.ts runs in a child process (see scripts/lib/deps.test.ts for why), which prints JSON.
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
// Without RUST_TS_DATA, as harness/compiletest.test.ts: it then comes from .env.local, as for every tool.
const CHILD_ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") CHILD_ENV[k] = v;
const CHILD = `
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const CFG = { host: "aarch64-apple-darwin", target: "x86_64-unknown-linux-gnu" };
const RUN = { ...CFG, sysroot: "/sys", outDir: "/out" };
const parse = (src) => {
  try {
    return c.uiTestComments(src);
  } catch (e) {
    return "reject: " + e.message;
  }
};
const ignored = (src, rev = "", cfg = CFG) => c.uiTestIgnored(c.uiTestComments(src), rev, cfg);
const args = (src, rev = "") => c.uiTestArgs(c.uiTestComments(src), "tests/pass/a.rs", rev, RUN);
const REVS = [
  "//@revisions: stack tree",
  "//@compile-flags: -Zmiri-base",
  "//@[tree]compile-flags: -Zmiri-tree-borrows",
  "//@[stack,tree]compile-flags: -Zmiri-both",
  "//@[stack]compile-flags: -Zmiri-stack",
  "//@[tree]edition: 2024",
  "//@[tree]rustc-env: A=tree",
  "//@rustc-env: A=base B=2",
  "fn main() {}",
].join("\\n");
const out = {
  comma: [
    c.commaParseCommand(" -Za   -Zb=1\\t--x "),
    c.commaParseCommand("a 'b c' \\"d \\\\\\"e\\" f\\\\ g"),
    c.commaParseCommand("x 'open"),
    c.commaParseCommand(""),
  ],
  revisions: c.uiTestComments(REVS).revisions,
  none: c.uiTestComments("fn main() {}").revisions,
  stack: args(REVS, "stack"),
  tree: args(REVS, "tree"),
  plain: args("//@compile-flags: -Zmiri-x\\nfn main() {}"),
  envStack: c.uiTestEnv(c.uiTestComments(REVS), "stack"),
  envTree: c.uiTestEnv(c.uiTestComments(REVS), "tree"),
  order: c.uiTestForRevision(c.uiTestComments(REVS), "tree").map((r) => r.compileFlags),
  // Only a line that starts with //@ is a directive.
  indented: args("  //@compile-flags: -Zmiri-no\\nlet x; //@compile-flags: -Zmiri-no2\\n//@  compile-flags:  -Zmiri-yes  \\nfn main() {}"),
  filters: {
    onlyTarget: ignored("//@only-target: x86_64 i686"),
    onlyTargetMiss: ignored("//@only-target: aarch64"),
    onlyTargetComment: ignored("//@only-target: windows # x86_64 is only named in the comment"),
    ignoreTarget: ignored("//@ignore-target: linux"),
    ignoreTargetMiss: ignored("//@ignore-target: windows"),
    ignoreSubstring: ignored("//@ignore-target: x86_64-apple-darwin"),
    onlyAllMustHold: ignored("//@only-target: x86_64\\n//@only-target: windows"),
    ignoreFirst: ignored("//@only-target: windows\\n//@ignore-target: linux"),
    ignoreHost: ignored("//@ignore-host: windows"),
    ignoreHostHit: ignored("//@ignore-host: apple"),
    onlyHostHit: ignored("//@only-host: darwin"),
    bitwidth64: ignored("//@ignore-bitwidth: 64"),
    bitwidth32: ignored("//@ignore-bitwidth: 32"),
    onHostCross: ignored("//@only-on-host"),
    onHostSame: ignored("//@only-on-host", "", { host: "x", target: "x" }),
    revOnly: [ignored("//@revisions: a b\\n//@[a]only-target: windows", "a"), ignored("//@revisions: a b\\n//@[a]only-target: windows", "b")],
  },
  sameHost: c.uiTestArgs(c.uiTestComments("fn main() {}"), "f.rs", "", { host: "x", target: "x", sysroot: "/s", outDir: "/o" }),
  rejects: {
    unknown: parse("//@frobnicate: 1"),
    noColon: parse("//@compile-flags -Zx"),
    unclosed: parse("//@compile-flags: 'x"),
    unknownRev: parse("//@revisions: a\\n//@[b]compile-flags: -Zx"),
    noRevs: parse("//@[b]compile-flags: -Zx"),
    twiceRev: parse("//@revisions: a\\n//@revisions: b"),
    revUnderRev: parse("//@revisions: a\\n//@[a]revisions: b"),
    aux: parse("//@aux-build: x.rs"),
    run: parse("//@run"),
    condition: parse("//@only-frob: x"),
    envKv: parse("//@rustc-env: NOEQ"),
    edition: parse("//@edition: 2021\\n//@edition: 2024"),
  },
  noEffect: c.uiTestArgs(
    c.uiTestComments('//@normalize-stderr-test: "a" -> "b"\\n//@error-in-other-file: x\\n//@run-native\\n//@stderr-per-bitwidth\\n//@require-annotations-for-level: note\\n//@check-pass\\n//@no-rustfix\\nfn main() {} //~ ERROR: x'),
    "f.rs",
    "",
    RUN,
  ),
};
console.log(JSON.stringify(out));
`;

const proc = Bun.spawnSync(["bun", "-e", CHILD], { cwd: REPO, env: CHILD_ENV, stdout: "pipe", stderr: "pipe" });
const j = proc.exitCode === 0 ? JSON.parse(proc.stdout.toString()) : undefined;
const failed = proc.exitCode === 0 ? "" : proc.stderr.toString().slice(0, 2000);

const HEAD = ["--error-format=json", "-Dwarnings", "-Dunused", "-Ainternal_features", "-Zui-testing", "--sysroot=/sys", "--out-dir", "/out", "tests/pass/a.rs"];
const TARGET = ["--target", "x86_64-unknown-linux-gnu"];

test("the child ran", () => {
  expect(failed).toBe("");
});

test("comma's parse_command", () => {
  expect(j.comma[0]).toEqual(["-Za", "-Zb=1", "--x"]);
  expect(j.comma[1]).toEqual(["a", "b c", 'd "e', "f g"]);
  expect(j.comma[2]).toBeNull();
  expect(j.comma[3]).toEqual([]);
});

test("revisions expand, with --cfg and -Cextra-filename, and flags in BTreeMap key order", () => {
  expect(j.revisions).toEqual(["stack", "tree"]);
  expect(j.none).toBeUndefined();
  // Keys holding `stack`: ["stack"], ["stack", "tree"], sorted, though the file lists `[stack,tree]` first.
  expect(j.stack).toEqual([...HEAD, "-Zmiri-base", "-Zmiri-stack", "-Zmiri-both", "--edition", "2021", "--cfg=stack", "-Cextra-filename=stack", ...TARGET]);
  // Keys holding `tree`: ["stack", "tree"], ["tree"]. The revision's edition replaces the default.
  expect(j.tree).toEqual([...HEAD, "-Zmiri-base", "-Zmiri-both", "-Zmiri-tree-borrows", "--edition", "2024", "--cfg=tree", "-Cextra-filename=tree", ...TARGET]);
  expect(j.order).toEqual([["-Zmiri-base"], ["-Zmiri-both"], ["-Zmiri-tree-borrows"]]);
  expect(j.plain).toEqual([...HEAD, "-Zmiri-x", "--edition", "2021", ...TARGET]);
});

test("rustc-env: base first, a later value wins", () => {
  expect(j.envStack).toEqual({ A: "base", B: "2" });
  expect(j.envTree).toEqual({ A: "tree", B: "2" });
});

test("only a line starting with //@ is a directive; its name and args are trimmed", () => {
  expect(j.indented).toEqual([...HEAD, "-Zmiri-yes", "--edition", "2021", ...TARGET]);
});

test("only-target / ignore-target / host / bitwidth", () => {
  const f = j.filters;
  expect(f.onlyTarget).toBeUndefined();
  expect(f.onlyTargetMiss).toContain("only-target aarch64");
  // `#` ends the list.
  expect(f.onlyTargetComment).toContain("only-target windows");
  expect(f.ignoreTarget).toContain("ignore-target linux");
  expect(f.ignoreTargetMiss).toBeUndefined();
  // A substring of the whole tuple, so this names another target.
  expect(f.ignoreSubstring).toBeUndefined();
  expect(f.onlyAllMustHold).toContain("only-target windows");
  expect(f.ignoreFirst).toContain("ignore-target linux");
  expect(f.ignoreHost).toBeUndefined();
  expect(f.ignoreHostHit).toContain("ignore-host apple");
  expect(f.onlyHostHit).toBeUndefined();
  expect(f.bitwidth64).toContain("ignore-bitwidth 64");
  expect(f.bitwidth32).toBeUndefined();
  expect(f.onHostCross).toContain("only-on-host");
  expect(f.onHostSame).toBeUndefined();
  expect(f.revOnly[0]).toContain("only-target windows");
  expect(f.revOnly[1]).toBeNull(); // (undefined in an array: null in JSON)
});

test("no --target when the target is the host (host_matches_target)", () => {
  expect(j.sameHost).toEqual(["--error-format=json", "-Dwarnings", "-Dunused", "-Ainternal_features", "-Zui-testing", "--sysroot=/s", "--out-dir", "/o", "f.rs", "--edition", "2021"]);
});

test("what ui_test rejects (a skip with its reason), and what shapes nothing", () => {
  const r = j.rejects;
  expect(r.unknown).toContain("not a command known to `ui_test`");
  expect(r.noColon).toContain("must be followed by `:`");
  expect(r.unclosed).toContain("unclosed quotation mark");
  expect(r.unknownRev).toContain("the revision `b` is not known");
  expect(r.noRevs).toContain("there are no revisions");
  expect(r.twiceRev).toContain("cannot specify `revisions` twice");
  expect(r.revUnderRev).toContain("cannot be declared under a revision");
  expect(r.aux).toContain("not reproduced");
  expect(r.run).toContain("not reproduced");
  expect(r.condition).toContain("`frob` is not a valid condition");
  expect(r.envKv).toContain("key/value pairs");
  expect(r.edition).toContain("cannot specify `edition` twice");
  expect(j.noEffect).toEqual([...HEAD.slice(0, 8), "f.rs", "--edition", "2021", ...TARGET]);
});

// The real suites, on the real sparse checkout; skipped with a reason where the Miri toolchain is not set up.
const SUITES_CHILD = `
const m = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))});
const problem = m.miriOracleProblem({ sysroot: true });
if (problem !== undefined) {
  console.log(JSON.stringify({ problem }));
  process.exit(0);
}
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const { UPSTREAM } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const get = (n) => s.SUITES.find((x) => x.name === n);
const ids = (n) => get(n).cases().map((x) => x.id);
const byId = (n, id) => get(n).cases().find((x) => x.id === id);
const fields = (n) => {
  const x = get(n);
  return { milestone: x.milestone, miri: x.miri, heavy: x.heavy !== undefined, criterion: x.criterion, cwd: x.cwd?.slice(UPSTREAM.length), mode: x.mode };
};
const out = {
  fields: Object.fromEntries(["miri-pass", "miri-pass-heavy", "miri-pass-tb", "miri-fail", "run-pass-aux-miri"].map((n) => [n, fields(n)])),
  counts: Object.fromEntries(["miri-pass", "miri-pass-heavy", "miri-pass-tb", "miri-fail"].map((n) => [n, ids(n).length])),
  dup: ["miri-pass", "miri-pass-heavy", "miri-pass-tb", "miri-fail"].some((n) => new Set(ids(n)).size !== ids(n).length),
  overlap: ids("miri-pass").filter((i) => ids("miri-pass-heavy").includes(i) || ids("miri-pass-tb").includes(i)),
  gated: ["miri-pass", "miri-pass-heavy"].flatMap((n) => ids(n).filter((i) => byId(n, i)?.args.some((a) => a.startsWith("-Zmiri-tree-borrows")))),
  tb: ids("miri-pass-tb").filter((i) => !byId("miri-pass-tb", i).args.some((a) => a.startsWith("-Zmiri-tree-borrows"))),
  fsHeavy: ids("miri-pass-heavy").filter((i) => i.includes("shims/fs") || i.includes("issue-miri-3680")),
  unstable: get("miri-pass").unstable().map((u) => u.id),
  skippedPass: get("miri-pass").skipped().filter((k) => !k.reason.includes("Tree Borrows") && !k.reason.startsWith("heavy")).map((k) => k.id),
  tbSkipped: get("miri-pass").skipped().filter((k) => k.reason.includes("Tree Borrows")).length,
  hello: byId("miri-pass", "tests/panic/panic2.rs"),
  stack: byId("miri-pass", "tests/pass/btreemap.rs#stack")?.args.slice(-6),
  tree: byId("miri-pass-tb", "tests/pass/btreemap.rs#tree")?.args.slice(-6),
  tempDirs: new Set(get("miri-pass").cases().map((x) => x.env.MIRI_TEMP)).size,
  subset: Object.keys(get("miri-fail").subsets ?? {}),
};
console.log(JSON.stringify(out));
`;

const sp = Bun.spawnSync(["bun", "-e", SUITES_CHILD], { cwd: REPO, env: CHILD_ENV, stdout: "pipe", stderr: "pipe" });
const k = sp.exitCode === 0 ? JSON.parse(sp.stdout.toString().trim().split("\n").at(-1)!) : { failed: sp.stderr.toString().slice(0, 2000) };

test("the suites child ran", () => {
  expect(k.failed).toBeUndefined();
});

const suiteTest = k.problem ? test.skip : test;
const why = k.problem ? ` (skipped: ${String(k.problem).slice(0, 120)})` : "";

suiteTest(`the suites' fields${why}`, () => {
  for (const n of Object.keys(k.fields)) {
    expect(k.fields[n].milestone).toBe("M6");
    expect(k.fields[n].miri).toBe(true);
    expect(k.fields[n].mode).toBe("single");
  }
  expect(k.fields["miri-pass"].criterion.percent).toBe(80);
  expect(k.fields["miri-pass"].heavy).toBe(false);
  expect(k.fields["miri-pass-heavy"].criterion.percent).toBe(80);
  expect(k.fields["miri-pass-heavy"].heavy).toBe(true);
  expect(k.fields["miri-pass-tb"].criterion).toBeUndefined();
  expect(k.fields["miri-fail"].criterion).toBeUndefined();
  expect(k.fields["run-pass-aux-miri"].criterion).toBeUndefined();
  expect(k.fields["miri-pass"].cwd).toBe("/src/tools/miri");
});

suiteTest(`the case sets at the pin (revisions expanded, target filters honoured)${why}`, () => {
  expect(k.counts).toEqual({ "miri-pass": 353, "miri-pass-heavy": 7, "miri-pass-tb": 132, "miri-fail": 610 });
  expect(k.dup).toBe(false);
  expect(k.overlap).toEqual([]);
  expect(k.gated).toEqual([]);
  expect(k.tb).toEqual([]);
  expect(k.fsHeavy).toEqual(["tests/pass/issues/issue-miri-3680.rs", "tests/pass/shims/fs-permissions.rs", "tests/pass/shims/fs.rs"]);
  expect(k.unstable).toEqual(["tests/panic/mir-validation.rs", "tests/panic/panic1.rs"]);
  expect(k.skippedPass).toContain("tests/pass/shims/aarch64/intrinsics-aarch64-aes.rs");
  expect(k.skippedPass.length).toBe(12);
  expect(k.tbSkipped).toBe(132);
  expect(k.tempDirs).toBe(353);
  expect(k.subset).toEqual(["tree-borrows"]);
});

suiteTest(`one case's env and argv${why}`, () => {
  expect(k.hello.file).toBe("tests/panic/panic2.rs");
  expect(k.hello.env.RUST_BACKTRACE).toBe("1");
  expect(k.hello.env.MIRI_ENV_VAR_TEST).toBe("0");
  expect(k.hello.env.RUSTC_ICE).toBe("0");
  expect(k.hello.env.MIRI_TEMP).toContain("miri-temp");
  expect(k.hello.env.MIRI_BE_RUSTC).toBeNull();
  expect(k.hello.args.slice(0, 5)).toEqual(["--error-format=json", "-Dwarnings", "-Dunused", "-Ainternal_features", "-Zui-testing"]);
  expect(k.stack).toEqual(["--edition", "2021", "--cfg=stack", "-Cextra-filename=stack", "--target", "x86_64-unknown-linux-gnu"]);
  expect(k.tree).toEqual(["--edition", "2021", "--cfg=tree", "-Cextra-filename=tree", "--target", "x86_64-unknown-linux-gnu"]);
});

// A real Miri aux build into a throwaway key: the aux argv, the rlib, and the main compile running it.
const AUX_CHILD = `
const m = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))});
const problem = m.miriOracleProblem({ sysroot: true });
if (problem !== undefined) {
  console.log(JSON.stringify({ problem }));
  process.exit(0);
}
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { UPSTREAM, run } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { caseEnv } = await import(${JSON.stringify(join(REPO, "scripts/lib/env.ts"))});
const { existsSync } = await import("node:fs");
const FILE = "tests/ui/cross-crate/cci_capture_clause.rs";
const opts = { aux: true, auxTimeoutMs: 300000, run: true, needs: true, miriAux: true };
const r = c.uiFileCases([FILE], "human", opts);
const steps = r.auxSteps.get(FILE);
const k = r.cases[0];
const args = s.miriRunArgs(k, (await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))})).oracleSysroot(), m.MIRI_SYSROOT);
const env = { ...k.env, ...m.MIRI_CASE_ENV };
const p = await run([m.miriBinary(), ...args], { cwd: UPSTREAM, env: caseEnv(env), timeoutMs: 60000 });
const dir = args[args.indexOf("-L") + 1];
const noMiri = c.uiFileCases([FILE], "human", { aux: true, auxTimeoutMs: 300000, needs: true });
const pm = c.uiFileCases(["tests/ui/proc-macro/derive-helper-shadowing.rs"], "human", opts);
const bin = c.uiFileCases(["tests/ui/runtime/on-broken-pipe/child-processes.rs"], "human", opts);
const native = c.uiFileCases(["tests/ui/abi/foreign/foreign-dupe.rs"], "human", opts);
console.log(JSON.stringify({
  step: steps[0],
  rlib: existsSync(dir + "/" + "libcci_capture_clause.rlib"),
  exit: p.code,
  stderr: p.stderr.slice(0, 500),
  noMiriArgs: noMiri.cases[0].args,
  noMiriStep: noMiri.auxSteps.get(FILE)?.[0],
  pm: pm.skipped.map((x) => x.reason),
  bin: bin.skipped.map((x) => x.reason),
  native: native.skipped.map((x) => x.reason),
  sysroot: m.MIRI_SYSROOT,
  keyMiri: c.auxKey("x", steps),
  keySameArgsNoMiri: c.auxKey("x", steps.map((x) => ({ ...x, miri: undefined }))),
}));
`;
const ap = Bun.spawnSync(["bun", "-e", AUX_CHILD], { cwd: REPO, env: CHILD_ENV, stdout: "pipe", stderr: "pipe" });
const a = ap.exitCode === 0 ? JSON.parse(ap.stdout.toString().trim().split("\n").at(-1)!) : { failed: ap.stderr.toString().slice(0, 2000) };

test("the aux child ran", () => {
  expect(a.failed).toBeUndefined();
});

const auxTest = a.problem ? test.skip : test;
const auxWhy = a.problem ? ` (skipped: ${String(a.problem).slice(0, 120)})` : "";

auxTest(`a Miri-built aux crate: MIRI_BE_RUSTC=target, an rlib, the Miri sysroot; the program runs${auxWhy}`, () => {
  expect(a.step.miri).toBe(true);
  expect(a.step.env.MIRI_BE_RUSTC).toBe("target");
  expect(a.step.env.RUSTUP_HOME).toContain("rustup-miri");
  expect(a.step.args).toContain("--crate-type");
  expect(a.step.args[a.step.args.indexOf("--crate-type") + 1]).toBe("lib");
  expect(a.step.args[a.step.args.indexOf("--sysroot") + 1]).toBe(a.sysroot);
  expect(a.step.args.some((x: string) => x.startsWith("--emit"))).toBe(false);
  expect(a.rlib).toBe(true);
  // (compiletest's `-O`: Miri warns and ignores it.)
  expect(a.stderr).toContain("the opt-level is ignored");
  expect(a.stderr).not.toContain("error");
  expect(a.exit).toBe(0);
});

auxTest(`callers without miriAux keep the oracle's rmeta build${auxWhy}`, () => {
  expect(a.noMiriStep.miri).toBeUndefined();
  expect(a.noMiriStep.args).toContain("--emit=metadata");
  expect(a.noMiriStep.args).toContain("dylib");
  expect(a.noMiriArgs.at(-1)).toBe("-Zparse-crate-root-only");
});

auxTest(`the Miri identity is in the aux key only for Miri-built crates${auxWhy}`, () => {
  expect(a.keyMiri).not.toBe(a.keySameArgsNoMiri);
});

auxTest(`proc-macro, binary and native-helper aux crates are skips with a reason${auxWhy}`, () => {
  expect(a.pm.join()).toContain("proc-macro");
  expect(a.bin.join()).toContain("auxiliary binary");
  expect(a.native.join()).toContain("could not find native static library");
});
