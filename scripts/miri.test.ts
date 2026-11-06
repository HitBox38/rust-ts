// Unit tests of the Miri oracle harness (lane harness-m6a): the isolated toolchain's component check
// (scripts/lib/toolchain.ts `miriToolchainError`) on fake sysroots, Miri's unstable-output detection
// (scripts/lib/unstable.ts), and, in a child process (scripts/lib/miri.ts, harness/suites.ts and scripts/gate.ts load
// scripts/lib/common.ts; see scripts/lib/deps.test.ts for why), MIRI_DEFAULT_ARGS against the upstream source, the real
// isolated toolchain, the Miri suites' cases (plan-m6 D6) and the criterion report (A9).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { miriToolchainError, oracleToolchainError } from "./lib/toolchain.ts";
import { isIceStderr, stderrMask, unstableOracleReason } from "./lib/unstable.ts";

const REPO = resolve(import.meta.dir, "..");
const HOST = "aarch64-apple-darwin";
const PINNED = ["cargo-{host}", "miri-preview-{host}", "rust-src", "rust-std-{host}", "rustc-{host}"];
const CLEAN = ["cargo-aarch64-apple-darwin", "rust-std-aarch64-apple-darwin", "rustc-aarch64-apple-darwin", "miri-preview-aarch64-apple-darwin", "rust-src"];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sysroot(components: string[] | undefined, src: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "rust-ts-miri-toolchain-"));
  dirs.push(root);
  mkdirSync(join(root, "lib", "rustlib"), { recursive: true });
  if (components) writeFileSync(join(root, "lib", "rustlib", "components"), components.map((c) => c + "\n").join(""));
  if (src) mkdirSync(join(root, "lib", "rustlib", "src", "rust", "library"), { recursive: true });
  return root;
}

// Suites run the preload form, where this import does nothing, and from a cwd whose `.env` agrees. So nothing else notices if plain miri.ts loses it: `ensure_stack`
// then runs after the module-level reads of process.env, which see `.env`'s variables (review harness-w41 N2). A parse error is the cheapest path that gets the host's target spec.
test("plain miri.ts settles the environment before anything reads it: a cwd's .env does not reach the compiler", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rust-ts-miri-dotenv-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, ".env"), "RUST_TS_HOST_TUPLE=bogus-host\n");
  writeFileSync(join(cwd, "bad.rs"), "fn main( {\n");
  const env: Record<string, string | undefined> = { ...process.env };
  // From this repo's .env.local, which would win over the cwd's; and a stack already set up would mean no re-exec.
  delete env.RUST_TS_HOST_TUPLE;
  delete env.BUN_JSC_maxPerThreadStackUsage;
  const r = Bun.spawnSync([process.execPath, join(REPO, "src/miri/bin/miri.ts"), "bad.rs"], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const stderr = r.stderr.toString();
  expect(stderr).not.toContain("bogus-host");
  expect(stderr).toContain("this file contains an unclosed delimiter");
  expect(r.exitCode).toBe(1);
}, 60_000);

describe("miriToolchainError", () => {
  test("the pinned components with rust-src's directory: ok", () => {
    expect(miriToolchainError(sysroot(CLEAN, true), PINNED, HOST, "tc", "/h")).toBeUndefined();
    expect(miriToolchainError(sysroot([...CLEAN].reverse(), true), PINNED, HOST, "tc", "/h")).toBeUndefined();
  });
  test("rust-src's directory is required (the oracle's check forbids it)", () => {
    const root = sysroot(CLEAN, false);
    expect(miriToolchainError(root, PINNED, HOST, "tc", "/h")).toContain(`${join(root, "lib", "rustlib", "src")} is missing`);
  });
  test("extra and missing components are named, with the setup hint and the isolated home", () => {
    const e = miriToolchainError(sysroot([...CLEAN.filter((c) => !c.startsWith("miri")), "rustc-dev-aarch64-apple-darwin"], true), PINNED, HOST, "nightly-x", "/iso");
    expect(e).toContain("extra [rustc-dev-aarch64-apple-darwin]");
    expect(e).toContain("missing [miri-preview-aarch64-apple-darwin]");
    expect(e).toContain("RUSTUP_HOME=/iso");
    expect(e).toContain("bun scripts/miri.ts setup");
    expect(e!.includes("\n")).toBe(false);
  });
  test("an unreadable component list is an error", () => {
    expect(miriToolchainError(sysroot(undefined, true), PINNED, HOST, "tc", "/h")).toContain("cannot read the Miri toolchain's component list");
  });
  test("the Miri toolchain's components fail the oracle's check (two separate pins)", () => {
    expect(oracleToolchainError(sysroot(CLEAN, true), PINNED, HOST, "tc")).toContain("exists");
  });
});

describe("the thread-id mask on a Miri suite (stderrMask)", () => {
  const programPanic = "\nthread 'main' (1000) panicked at tests/ui/macros/cfg-expr.rs:26:1:\nexplicit panic\n";
  const masked = (e: string) => stderrMask(true, e)(e) !== e;
  test("the interpreted program's panic names Miri's virtual thread id: compared", () => {
    expect(masked(programPanic)).toBe(false);
    expect(masked("thread '<unnamed>' (1001) panicked at a.rs:1:1:\n")).toBe(false);
  });
  test("a panic of Miri itself (an ICE) names the host's thread id: masked", () => {
    expect(masked("thread 'rustc' (178972394) panicked at compiler/a.rs:1:1:\nboom\nerror: the compiler unexpectedly panicked. This is a bug\n")).toBe(true);
  });
  test("an ICE through bug! (ExplicitBug: no `unexpectedly panicked` line) is still an ICE (review harness-m6a N1)", () => {
    // report_ice (rustc_driver_impl lib.rs:1539) skips the `Ice` error for an ExplicitBug payload but always prints the
    // bug-report and version notes; the bug!/span_bug! message itself is an `error: internal compiler error: ...`.
    const notes = [
      "note: we would appreciate a bug report: https://github.com/rust-lang/miri/issues/new",
      "note: please make sure that you have updated to the latest nightly",
      "note: rustc 1.101.0-nightly (6f5da406b 2026-10-10) running on aarch64-apple-darwin",
    ];
    const bug = ["error: internal compiler error: src/tools/miri/src/x.rs:1:1: boom", "", "thread 'rustc' (73787783) panicked at src/tools/miri/src/x.rs:1:1:", "Box<dyn Any>", ...notes].join("\n");
    expect(isIceStderr(bug)).toBe(true);
    expect(masked(bug)).toBe(true);
    // Each marker alone (the tid line plus one of them).
    const tid = "thread 'rustc' (73787783) panicked at a.rs:1:1:\nx\n";
    for (const n of notes.filter((n) => !n.includes("updated"))) expect(masked(tid + n + "\n")).toBe(true);
    expect(masked(tid + "note: using internal features is not supported and expected to cause internal compiler errors when used incorrectly\n")).toBe(true);
    expect(masked(tid + "error: internal compiler error[E0308]: mismatched types\n")).toBe(true);
    // A program's own panic with Miri's diagnostics is not an ICE.
    expect(isIceStderr("thread 'main' (1000) panicked at a.rs:1:1:\nboom\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n")).toBe(false);
  });
  test("the unstable patterns apply as everywhere", () => {
    expect(unstableOracleReason("note: please attach the file at `/u/rustc-ice-2026-10-21T11_18_00-4242.txt` to your bug report\n")).toContain("ICE note");
    expect(unstableOracleReason(programPanic)).toBeUndefined();
    expect(unstableOracleReason("")).toBeUndefined();
  });
});

const CHILD = `
const fs = await import("node:fs");
const { join } = await import("node:path");
const { UPSTREAM } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const m = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))});
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { oracleSysroot } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const libRs = fs.readFileSync(join(UPSTREAM, "src/tools/miri/src/lib.rs"), "utf8");
const block = /pub const MIRI_DEFAULT_ARGS: &\\[&str\\] = &\\[([\\s\\S]*?)\\];/.exec(libRs)[1];
const upstreamArgs = [...block.replace(/\\/\\/.*$/gm, "").matchAll(/"([^"]*)"/g)].map((x) => x[1]);
const installed = fs.existsSync(m.miriToolchainDir());
const miriSuites = s.SUITES.filter((x) => x.miri).map((x) => x.name);
const runPass = s.suite("run-pass-miri");
const runFail = s.suite("run-fail-miri");
const rp = runPass.cases();
const rf = runFail.cases();
const byId = (cs, id) => cs.find((c) => c.id === id);
const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const os = "/o/sysroot";
const ui = (args, run) => ({ id: "t", args, run });
console.log(JSON.stringify({
  upstreamArgs,
  ours: m.MIRI_DEFAULT_ARGS,
  installed,
  problem: installed ? m.miriOracleProblem({ sysroot: true }) ?? null : "not installed",
  miriSuites,
  milestones: miriSuites.map((n) => s.suite(n).milestone),
  undeclared: miriSuites.flatMap((n) => g.undeclaredRuns(s.suite(n))),
  oracleCmd: s.suite("miri-hello").oracle([{ id: "x", file: "x", args: ["a.rs"] }]),
  binary: m.miriBinary(),
  hello: s.suite("miri-hello").cases(),
  helloSubject: s.suite("miri-hello").subject(s.suite("miri-hello").cases()),
  counts: { runPass: rp.length, runFail: rf.length, heavy: s.suite("run-pass-miri-heavy").cases().length },
  noOut: [...rp, ...rf].filter((c) => c.args.includes("-o") || c.args.includes("-Zparse-crate-root-only")).map((c) => c.id),
  sysroots: [...new Set([...rp, ...rf].map((c) => c.args[c.args.indexOf("--sysroot") + 1]))],
  oracleSysrootNamed: [...rp, ...rf].filter((c) => c.args.some((a) => a.includes(oracleSysroot()))).map((c) => c.id),
  envOk: [...rp, ...rf].every((c) => Object.entries(m.MIRI_CASE_ENV).every(([k, v]) => c.env[k] === v)),
  ids: { rp: new Set(rp.map((c) => c.id)).size, rf: new Set(rf.map((c) => c.id)).size, both: rp.filter((c) => rf.some((x) => x.id === c.id)).length },
  execEnv: byId(rp, "tests/ui/process/exec-env.rs").args.slice(-1),
  trimSet: byId(rp, "tests/ui/compiletest-self-test/trim-env-name.rs#set").args.filter((a) => a.startsWith("-Zmiri-env-set")),
  trimUnset: byId(rp, "tests/ui/compiletest-self-test/trim-env-name.rs#unset").args.filter((a) => a.startsWith("-Zmiri-env-set")),
  runFlags: byId(rp, "tests/ui/test-attrs/tests-listing-format-terse.rs").args.slice(-5),
  revRunPass: byId(rp, "tests/ui/borrowck/super-let-lifetime-and-drop.rs#runtime") !== undefined,
  revCheckFail: [...rp, ...rf].some((c) => c.id === "tests/ui/borrowck/super-let-lifetime-and-drop.rs#borrowck"),
  ignoredDir: rp.some((c) => c.id === "tests/ui/foreign/foreign-mod-src/inner.rs"),
  skippedRp: runPass.skipped().length,
  skippedRf: runFail.skipped().length,
  skippedOverlap: runPass.skipped().filter((k) => runFail.skipped().some((x) => x.id === k.id)).map((k) => k.id),
  args: {
    plain: s.miriRunArgs(ui(["a.rs", "--sysroot", os, "--target=x", "-O", "-o", "build/a"], { flags: [], env: [], unsetEnv: [] }), os, "/m"),
    run: s.miriRunArgs(ui(["a.rs", "--sysroot", os], { flags: ["--x", "y"], env: [["K", " v"], ["U", "1"]], unsetEnv: ["U", "Z"] }), os, "/m"),
    ownSysroot: err(() => s.miriRunArgs(ui(["a.rs", "--sysroot", "/own"], undefined), os, "/m")),
    named: err(() => s.miriRunArgs(ui(["a.rs", "--sysroot", os, "-L", os + "/lib"], undefined), os, "/m")),
    isolation: err(() => s.miriRunArgs(ui(["a.rs", "--sysroot", os, "-Zmiri-disable-isolation"], undefined), os, "/m")),
    isolationSplit: err(() => s.miriRunArgs(ui(["a.rs", "--sysroot", os, "-Z", "miri-disable-isolation"], undefined), os, "/m")),
    envForward: err(() => s.miriRunArgs(ui(["a.rs", "--sysroot", os, "-Zmiri-env-forward=HOME"], undefined), os, "/m")),
    // Program arguments after \`--\` are the program's, not Miri's.
    programArg: s.miriRunArgs(ui(["a.rs", "--sysroot", os], { flags: ["-Zmiri-disable-isolation"], env: [], unsetEnv: [] }), os, "/m"),
  },
  subjectEntry: s.MIRI_SUBJECT_ENTRY,
  driverEntry: s.MIRI_DRIVER_ENTRY,
  subject: s.miriSubject(["a.rs", "--sysroot", "/m", "-Zmiri-disable-isolation", "-O", "--", "-Zmiri-x", "p"]),
  subjectRustc: s.miriSubjectOf(s.RUSTC_DRIVER_ENTRY, ["a.rs", "--sysroot", "/m", "-Zmiri-disable-isolation", "-O", "--", "-Zmiri-x", "p"]),
  needsUnwind: byId(rp, "tests/ui/panics/panic-handler-chain.rs") !== undefined,
  needsSkips: [...runPass.skipped(), ...runFail.skipped()].filter((k) => /\\\`needs-/.test(k.reason)).map((k) => k.reason.slice(0, k.reason.indexOf("\\\`", 1) + 1)),
  criterion: [
    d.criterionOf({ percent: 90, what: "w" }, { MATCH: 9, DIFF: 0, UNPORTED: 0, CRASH: 0, TIMEOUT: 0, ORACLE_TIMEOUT: 2, UNSTABLE: 1 }, 12),
    d.criterionOf({ percent: 100, what: "w" }, { MATCH: 0, DIFF: 0, UNPORTED: 0, CRASH: 0, TIMEOUT: 0, ORACLE_TIMEOUT: 1, UNSTABLE: 0 }, 1),
  ],
  key: installed ? m.miriOracleKey() === m.miriOracleKey() && /^[0-9a-f]{40}$/.test(m.miriOracleKey()) : null,
}));
`;

test("Miri oracle, suites and argv (child process)", () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") env[k] = v;
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // MIRI_DEFAULT_ARGS is upstream's (src/tools/miri/src/lib.rs at the pin).
  expect(j.ours).toEqual(j.upstreamArgs);
  expect(j.ours.length).toBe(8);
  // The isolated toolchain is installed and pinned here (required under RUST_TS_REQUIRE_PROBES=1, as probes are).
  if (process.env.RUST_TS_REQUIRE_PROBES === "1") expect(j.installed).toBe(true);
  if (j.installed) {
    expect(j.problem).toBeNull();
    expect(j.key).toBe(true);
  }
  expect(j.miriSuites).toEqual(["miri-hello", "run-pass-miri", "run-pass-miri-heavy", "run-fail-miri", "miri-pass", "miri-pass-heavy", "miri-pass-tb", "miri-fail", "run-pass-aux-miri", "miri-sysroot-core", "miri-sysroot-alloc", "miri-sysroot-std"]);
  expect(j.milestones).toEqual(j.miriSuites.map(() => "M6"));
  // The gate accepts the Miri binary as these suites' oracle program, by absolute path, never through rustup.
  expect(j.undeclared).toEqual([]);
  expect(j.oracleCmd).toEqual([j.binary, "a.rs"]);
  expect(j.binary.endsWith("/bin/miri") || j.binary.endsWith("\\bin\\miri.exe")).toBe(true);
  expect(j.binary).toContain("rustup-miri");
  // miri-hello: Miri's plain argv on the Miri sysroot; the subject is the port of Miri's driver with the oracle's argv
  // (lane harness-w36).
  expect(j.hello.length).toBe(1);
  expect(j.hello[0].args.slice(0, 2)).toEqual(["harness/corpus/miri/hello.rs", "--sysroot"]);
  expect(j.hello[0].args.slice(3)).toEqual(["--target", "x86_64-unknown-linux-gnu"]);
  expect(j.subjectEntry).toBe(j.driverEntry);
  expect(existsSync(j.helloSubject[2])).toBe(true); // A missing preload is Bun's own error, on every Miri case.
  expect(j.helloSubject.slice(1)).toEqual(["--preload", join(REPO, "src/rust_ts/miri_stack_first.ts"), join(REPO, "src/miri/bin/miri.ts"), ...j.hello[0].args]);
  // run-pass / run-fail: the counts measured by lanes harness-m6a (3,269 / 263) and harness-w36 (needs-* evaluated:
  // +209 / +31), D6's argv; harness-w37: +1 (type-sizes.rs, needs-deterministic-layouts decided by the oracle).
  // 3,479 minus mpsc_stress.rs, which the Miri oracle does not finish (skipped).
  expect(j.counts.runPass + j.counts.heavy).toBe(3478);
  // harness-m6a's 6 heavy cases plus 2 among the new ones (harness-w36's full timing).
  expect(j.counts.heavy).toBe(8);
  expect(j.counts.runFail).toBe(294);
  // needs-unwind holds on x86_64-unknown-linux-gnu (compiletest's can_unwind); only needs that depend on bootstrap/CI
  // configuration are still skipped (needs-deterministic-layouts is decided by the oracle since harness-w37).
  expect(j.needsUnwind).toBe(true);
  expect([...new Set(j.needsSkips)].sort()).toEqual(["`needs-sanitizer-support`"]);
  expect(j.noOut).toEqual([]);
  expect(j.sysroots.length).toBe(1);
  expect(j.sysroots[0]).toContain("miri-sysroot");
  expect(j.oracleSysrootNamed).toEqual([]);
  expect(j.envOk).toBe(true);
  expect(j.ids).toEqual({ rp: j.counts.runPass, rf: j.counts.runFail, both: 0 });
  expect(j.execEnv).toEqual(["-Zmiri-env-set=TEST_EXEC_ENV=22"]);
  // compiletest's parse_env trims the name, not the value; unset-exec-env removes a set variable.
  expect(j.trimSet).toEqual(["-Zmiri-env-set=MY_EXEC_ENV=  my-exec-value"]);
  expect(j.trimUnset).toEqual([]);
  expect(j.runFlags).toEqual(["--test", "--", "--list", "--format", "terse"]);
  // Modes per revision; compiletest-ignore-dir directories are not collected.
  expect(j.revRunPass).toBe(true);
  expect(j.revCheckFail).toBe(false);
  expect(j.ignoredDir).toBe(false);
  // harness-w36: 489 (aux 420, only-*/ignore-* 55, needs-* config 8, min-llvm-version 6) + 8 heavy + 1 the oracle
  // does not finish; run-fail 32. harness-w37: needs-* config 7 (type-sizes.rs is a case).
  expect(j.skippedRp).toBe(497);
  expect(j.skippedRf).toBe(32);
  expect(j.skippedOverlap).toEqual([]);
  expect(j.args.plain).toEqual(["a.rs", "--sysroot", "/m", "--target=x", "-O"]);
  expect(j.args.run).toEqual(["a.rs", "--sysroot", "/m", "-Zmiri-env-set=K= v", "--", "--x", "y"]);
  expect(j.args.ownSysroot).toContain("not 1");
  expect(j.args.named).toContain("names the oracle sysroot");
  expect(j.args.isolation).toContain("isolation");
  expect(j.args.isolationSplit).toContain("-Zmiri-disable-isolation");
  expect(j.args.envForward).toContain("-Zmiri-env-forward=HOME");
  expect(j.args.programArg).toEqual(["a.rs", "--sysroot", "/m", "--", "-Zmiri-disable-isolation"]);
  expect(j.subject.slice(1)).toEqual(["--preload", join(REPO, "src/rust_ts/miri_stack_first.ts"), join(REPO, "src/miri/bin/miri.ts"), "a.rs", "--sysroot", "/m", "-Zmiri-disable-isolation", "-O", "--", "-Zmiri-x", "p"]);
  // The rustc-driver fallback (before harness-w36): Miri's rustc argv.
  expect(j.subjectRustc.slice(1)).toEqual([join(REPO, "src/rust_ts/main.ts"), ...j.ours, "a.rs", "--sysroot", "/m", "-O"]);
  expect(j.criterion[0]).toEqual({ match: 9, of: 10, oracleTimeouts: 2, percent: 90, target: 90, met: true, what: "w" });
  expect(j.criterion[1]).toEqual({ match: 0, of: 0, oracleTimeouts: 1, percent: 0, target: 100, met: false, what: "w" });
});
