// The M7 preflight suites' definitions (harness/suites.ts; plan-m7 §6, review F7; lane harness-m7a), in a child process (it loads scripts/lib/common.ts; see
// scripts/lib/deps.test.ts for why). No suite runs here: its results are in docs/handoff/harness-m7a.md.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-m7-suites-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const NEW = ["mir-o2", "mono-ui", "ir-hello", "mir-opt-o4", "check-ui-encode-mir", "check-rg", "check-rg-encode-mir", "check-rg-host"];
const CHILD = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const get = (n) => s.suite(n);
const fake = { id: "x", file: "x.rs", args: ["x.rs"] };
console.log(JSON.stringify({
  dropped: s.dropOutput(["a", "-o", "b", "-Zc", "-ofoo"]),
  mono: s.monoArgs("tests/ui/a.rs"),
  monoOther: s.monoArgs("tests/ui/b.rs"),
  subject: { mirO2: get("mir-o2").subject([fake])[1], mono: get("mono-ui").subject([fake])[1] },
  hello: get("ir-hello").cases().map((c) => [c.id, c.args.includes("-O"), c.args.includes("--emit=llvm-ir"), c.args.includes("-Cno-prepopulate-passes")]),
  helloOracle: get("ir-hello").oracle([fake]).slice(1, 6).map((a) => a.split("/").pop()),
  encode: get("check-ui-encode-mir").cases().slice(0, 1).map((c) => [c.args.includes("-Zalways-encode-mir"), c.args.includes("-Copt-level=3"), c.args.at(-1) === c.file])[0],
  encodeCount: get("check-ui-encode-mir").cases().length,
  ui: get("check-ui").cases().length,
  // Each side's dump dir, which scripts/mir-dump-run.ts passes last as -Zdump-mir-dir= (lane harness-w50; harness/mir-dump.test.ts).
  dumpOracle: ((c) => c[c.indexOf("--dir") + 1])(get("mir-opt-o4").oracle([fake])),
  dumpSubject: ((c) => c[c.indexOf("--dir") + 1])(get("mir-opt-o4").subject([fake])),
  rgDescriptions: ["check-rg", "check-rg-encode-mir", "check-rg-host"].map((n) => get(n).description),
  rg: ["check-rg", "check-rg-encode-mir", "check-rg-host"].map((n) => [get(n).mode, get(n).split, Boolean(get(n).heavy), get(n).oracle([fake]).slice(2).join(" "), get(n).subject([fake]).slice(2).join(" ")]),
}));
`;

test("mir-heavy: the oracle-cost rule, out of mir, unprotected, in no gate by default", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const heavy = s.suite("mir-heavy");
console.log(JSON.stringify({
  ids: heavy.cases().map((c) => c.id),
  list: Object.keys(s.MIR_HEAVY),
  heavy: heavy.heavy,
  skipped: s.suite("mir").skipped().map((k) => k.id),
  same: JSON.stringify(heavy.oracle(heavy.cases())) === JSON.stringify(s.suite("mir").oracle(heavy.cases())),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.ids).toEqual(["tests/ui/closures/supertrait-hint-cycle.rs"]);
  expect(j.ids).toEqual(j.list);
  expect(j.skipped).toEqual(j.ids);
  expect(j.heavy).toBeDefined();
  expect(j.same).toBe(true);
  // gate.ts's default is the suites with a baseline file, and a protected case can never have moved.
  expect(existsSync(join(REPO, "harness/baseline/mir-heavy.txt"))).toBe(false);
  const mir = new Set(readFileSync(join(REPO, "harness/baseline/mir.txt"), "utf8").split("\n"));
  for (const id of j.ids) expect(mir.has(id)).toBe(false);
}, 120_000);

test("parse's skips: each with its own flag in the reason, none protected", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
console.log(JSON.stringify(s.suite("parse").skipped()));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const skipped = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!) as { id: string; reason: string }[];
  expect(skipped.map((k) => k.id).sort()).toEqual(["tests/ui/associated-consts/issue-93775.rs", "tests/ui/expr/if/expr-stack-overflow.rs", "tests/ui/parser/survive-peano-lesson-queue.rs"]);
  const base = new Set(readFileSync(join(REPO, "harness/baseline/parse.txt"), "utf8").split("\n"));
  for (const k of skipped) {
    expect(base.has(k.id)).toBe(false);
    expect(k.reason).toContain("-Zunpretty=ast-tree ");
    expect(k.reason).not.toContain("expanded");
  }
});

test("the suites, without running one", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // The two run-pass suites' case lists come from the full corpus (3,479 tests, docs/handoff/harness-m7a.md); building it here would spend the unit step's budget.
  expect(j.dropped).toEqual(["a", "-Zc", "-ofoo"]);
  expect(j.mono.slice(0, 4)).toEqual(["-Zprint-mono-items=yes", "-Cno-prepopulate-passes", "--emit=llvm-ir", "--out-dir"]);
  // Each case has its own output directory, and no `-o` (review harness-m7a H1): a shared one makes the oracle itself wrong.
  expect(j.mono).not.toContain("-o");
  expect(j.mono[4]).toContain("mono-ui-out");
  expect(j.monoOther[4]).not.toBe(j.mono[4]);
  expect(j.subject.mirO2).toEndWith("src/rust_ts/main.ts");
  expect(j.subject.mono).toEndWith("scripts/mono-run.ts");
  expect(j.hello).toEqual([["hello -O", true, true, true], ["hello -Copt-level=0", false, true, true]]);
  expect(j.encode).toEqual([true, true, true]);
  expect(j.encodeCount).toBe(Math.ceil(j.ui / 5));
  expect(j.dumpOracle).toContain("/tmp/mir-opt-o4/oracle/");
  expect(j.dumpSubject).toContain("/tmp/mir-opt-o4/subject/");
  expect(j.dumpOracle).not.toBe(j.dumpSubject);
  // Root's and lane real-crates' terms.
  for (const d of j.rgDescriptions) {
    expect(d).toContain("emit `link`");
    expect(d).toContain("to the oracle");
    expect(d).toContain("one absolute target path");
    expect(d).toContain("CARGO_INCREMENTAL=0");
    expect(d).toContain("rg's MIR");
  }
  expect(j.rg[0]).toEqual(["split", "rmetadump", true, "run --label check-rg --side oracle --target x86_64-unknown-linux-gnu", "run --label check-rg --side subject --target x86_64-unknown-linux-gnu"]);
  expect(j.rg[1][3]).toEndWith("--encode-mir");
  expect(j.rg[2][3]).toContain("--target aarch64-apple-darwin");
}, 120_000);

// ir-hello was report only until root named it in wave 40q's gate (decision 2026-11-14T06:52) and that run's accept (0da8b38d) wrote its
// baseline, so this test, which said it was not protected, failed from that commit on (lane harness-m7b). It is protected now, with both cases.
test("ir-hello is protected since wave 40q's accept, with both its cases", () => {
  const baseline = readFileSync(join(REPO, "harness/baseline/ir-hello.txt"), "utf8").split("\n").filter(Boolean);
  expect(baseline).toEqual(["hello -Copt-level=0", "hello -O"]);
});

test("the sparse list adds exactly the two directories root approved", () => {
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { sparse: string[] };
  expect(pin.sparse).toEqual(["compiler", "library", "tests/ui", "tests/auxiliary", "tests/codegen-llvm", "tests/mir-opt", "src/tools/compiletest", "src/tools/miri/src", "src/tools/miri/tests"]);
});

test("a dump directory keeps a test's -Zdump-mir out of the cwd: the oracle, on dump_dataflow.rs's own flags", () => {
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string };
  writeFileSync(join(TMP, "d.rs"), "fn main() {}\n");
  const base = ["rustc", `+${pin.toolchain}`, "-Zdump-mir=main", "-Zdump-mir-dataflow", "-Zunpretty=mir", "d.rs"];
  const dump = join(TMP, "dump");
  const r = Bun.spawnSync([...base, `-Zdump-mir-dir=${dump}`], { cwd: TMP, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  expect(existsSync(join(TMP, "mir_dump"))).toBe(false);
  expect(readdirSync(dump).length).toBeGreaterThan(0);
  // Without it, what the review saw: the files go to the cwd, which is the upstream checkout in a suite.
  const bare = Bun.spawnSync(base, { cwd: TMP, stdout: "pipe", stderr: "pipe" });
  expect(bare.exitCode).toBe(0);
  expect(existsSync(join(TMP, "mir_dump"))).toBe(true);
});

// Lane harness-m7b: M7b's suites, without building their case lists (the run corpus for two targets would spend the unit step's budget):
// the commands, the pure helpers, and the target override on two files.
test("M7b's suites: report only, their commands, and compiletest run as on the host", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const ct = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const { oracleHost } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const get = (n) => s.suite(n);
const FILES = ["tests/ui/asm/x86_64/may_unwind.rs", "tests/ui/linkage-attr/linkage-attr-does-not-panic-llvm-issue-33992.rs"];
const set = () => { const r = ct.uiFileCases(FILES, "human", { run: true, needs: true }); return { cases: r.cases.map((c) => [c.id, c.args.find((a) => a.startsWith("--target="))]), skipped: r.skipped.map((k) => k.id) }; };
const before = set();
const host = ct.withCompiletestTarget(oracleHost(), set);
const after = set();
const fake = { id: "tests/ui/a.rs", file: "tests/ui/a.rs", args: ["--expect", "run-pass", "--", "tests/ui/a.rs", "-O"] };
const hello = get("native-hello").cases()[0];
const { readFileSync: read } = await import("node:fs");
const libc = {
  text: ["extern crate libc;", "    extern crate libc as c;", "#![feature(rustc_private)]\\nextern crate libc;", "// extern crate libc;", "extern crate libcore;", "use libc::c_int;", "#![feature(rustc_private)]"].map((t) => s.namesLibcCrate(t)),
  cloexec: s.hostLibcConflict("tests/ui/process/fds-are-cloexec.rs", undefined),
  plain: s.hostLibcConflict("tests/ui/array-slice-vec/subslice-patterns-const-eval.rs", undefined),
  viaAux: s.hostLibcConflict("tests/ui/array-slice-vec/subslice-patterns-const-eval.rs", undefined, ["tests/ui/process/fds-are-cloexec.rs"]),
  hello: s.namesLibcCrate(read(${JSON.stringify(join(REPO, "harness/corpus/miri/hello.rs"))}, "utf8")),
  reason: s.DUPLICATE_LIBC_REASON,
  // Review harness-m7b F3: an extern crate whose own cfg, or an enclosing item's, is false on the host does not load the crate.
  gated: (() => {
    const linux = new Set(["unix", 'target_os="linux"', 'target_family="unix"']);
    const mac = new Set(["unix", 'target_os="macos"', 'target_family="unix"']);
    const t = {
      own: '#[cfg(target_os = "linux")]\\nextern crate libc;',
      fn: '#[cfg(target_os = "linux")]\\nfn main() {\\n    extern crate libc;\\n}',
      unixFn: '#[cfg(unix)]\\nfn f() { let x = "}"; extern crate libc; }',
      notWin: "#[cfg(not(windows))]\\nmod m {\\n    extern crate libc;\\n}",
      sibling: '#[cfg(target_os = "linux")]\\nfn a() {}\\nextern crate libc;',
      anyOf: '#[cfg(any(target_os = "linux", target_os = "macos"))]\\nextern crate libc;',
      unknown: "#[cfg(some_feature_check(1))]\\nextern crate libc;",
      string: 'fn f() { let s = "extern crate libc;"; }',
      block: "/* extern crate libc; */ fn f() {}",
      // Review harness-m7b-recheck note 4: a commented-out cfg is no gate; a real one after it still is, read with its string value.
      lineCommentCfg: '// #[cfg(target_os = "linux")]\\nextern crate libc;',
      blockCommentCfg: '/* #[cfg(target_os = "linux")] */\\nextern crate libc;',
      nestedCommentCfg: '/* a /* #[cfg(target_os = "linux")] */ b */ extern crate libc;',
      commentThenCfg: '// #[cfg(unix)]\\n#[cfg(target_os = "linux")]\\nextern crate libc;',
      commentedFnCfg: '// #[cfg(target_os = "linux")]\\nfn main() {\\n    extern crate libc;\\n}',
      parenInString: '#[cfg(target_os = "li)nux")]\\nextern crate libc;',
    };
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [s.libcLoadedOn(v, linux), s.libcLoadedOn(v, mac)]]));
  })(),
  reviewThree: ["tests/ui/intrinsics/panic-uninitialized-zeroed.rs", "tests/ui/process/env-null-vars.rs", "tests/ui/runtime/out-of-stack.rs"].map((f) => s.hostLibcConflict(f, undefined)),
  evalCfg: [s.evalCfg('all(unix, not(target_os = "linux"))', new Set(["unix"])), s.evalCfg("true", new Set()), s.evalCfg("all(unix", new Set(["unix"]))],
};
const { asSubjectSide } = await import(${JSON.stringify(join(REPO, "scripts/oracle-self.ts"))});
console.log(JSON.stringify({
  libc,
  selfSide: asSubjectSide(get("run-pass-native").oracle([fake])).slice(4, 8),
  selfIr: asSubjectSide(get("ir-run-pass").oracle([fake])).slice(4, 6),
  before, host, after, hostName: oracleHost(),
  ir: ["ir-run-pass", "ir-run-pass-o0", "ir-host"].map((n) => [get(n).irTier, get(n).criterion?.percent ?? null, get(n).oracle([fake]).slice(1, 2)[0].split("/").pop()]),
  native: ["native-hello", "run-pass-native", "run-fail-native"].map((n) => [get(n).criterion?.percent ?? null, get(n).timeoutMs, get(n).oracleTimeoutMs]),
  oracle: get("run-pass-native").oracle([fake]),
  subject: get("run-pass-native").subject([fake]),
  empty: get("run-fail-native").oracle([{ id: "", file: "", args: [] }]).slice(-3),
  hello: { args: hello.args, file: hello.file, cwd: get("native-hello").cwd },
  helpers: s.withTestHelpers(["x", "-Crpath", "-Cdebuginfo=0", "-g"], "/h"),
  helpersOwnDebug: s.withTestHelpers(["x", "-Crpath", "-g"], "/h"),
  helpersNone: (() => { try { s.withTestHelpers(["x"], "/h"); return "no throw"; } catch (e) { return e.message; } })(),
  opts: s.nativeRunOpts({ flags: ["a b"], env: [["K", "v=w"]], unsetEnv: ["U"], errorPatterns: ["boom"], regexErrorPatterns: ["r+"], checkStdout: true }, "run-fail"),
  optsPass: s.nativeRunOpts(undefined, "run-pass"),
  optsLibtest: s.nativeRunOpts({ flags: [], env: [], unsetEnv: [], errorPatterns: [], regexErrorPatterns: [], checkStdout: false, shouldFail: true }, "run-fail", true),
  masked: ["native-hello", "run-pass-native", "run-fail-native", "ir-run-pass", "mir-o2"].map((n) => get(n).maskProgramOutput === true),
  unstableLists: Object.fromEntries(Object.entries(s.NATIVE_UNSTABLE).map(([k, v]) => [k, Object.values(v).every((r) => r.length > 40) ? Object.keys(v).length : -1])),
  unstableHooked: ["run-pass-native", "run-fail-native"].map((n) => get(n).unstable().length),
  harnessSkips: Object.keys(s.NATIVE_HARNESS_SKIPS),
  linkEnv: s.NATIVE_LINK_ENV,
  optsBadEnv: (() => { try { s.nativeRunOpts({ flags: [], env: [["", "x"]], unsetEnv: [], errorPatterns: [], regexErrorPatterns: [], checkStdout: false }, "run-pass"); return "no throw"; } catch (e) { return e.message; } })(),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // The override gives the host's case set and argv, and puts COMPILETEST_TARGET's memos back: the case set after equals the one before.
  expect(j.before.cases).toEqual([["tests/ui/asm/x86_64/may_unwind.rs", "--target=x86_64-unknown-linux-gnu"], ["tests/ui/linkage-attr/linkage-attr-does-not-panic-llvm-issue-33992.rs", "--target=x86_64-unknown-linux-gnu"]]);
  expect(j.after).toEqual(j.before);
  expect(j.hostName).toBe("aarch64-apple-darwin");
  expect(j.host.cases).toEqual([]);
  expect(j.host.skipped).toEqual(["tests/ui/asm/x86_64/may_unwind.rs", "tests/ui/linkage-attr/linkage-attr-does-not-panic-llvm-issue-33992.rs"]);
  expect(j.ir).toEqual([["N1", 70, "ir-run.ts"], ["N1", null, "ir-run.ts"], ["N1", null, "ir-run.ts"]]);
  expect(j.native).toEqual([[100, 300_000, 180_000], [80, 300_000, 180_000], [95, 300_000, 180_000]]);
  // Both sides in one case directory, the oracle's program twice, the run options before the compiler.
  const dir = (cmd: string[]) => cmd[cmd.indexOf("--dir") + 1];
  expect(j.oracle[1]).toEndWith("scripts/native-run.ts");
  expect(dir(j.oracle)).toBe(dir(j.subject));
  expect(dir(j.oracle)).toMatch(/\/native\/run-pass-native\/[0-9a-f]{16}$/);
  expect(j.oracle.slice(4, 11)).toEqual(["--side", "oracle", "--runs", "2", "--expect", "run-pass", "--"]);
  expect(j.oracle.slice(11, 13)).toEqual(["rustc", expect.stringMatching(/^\+nightly/)]);
  expect(j.oracle.slice(-2)).toEqual(["tests/ui/a.rs", "-O"]);
  expect(j.subject.slice(4, 8)).toEqual(["--side", "subject", "--runs", "1"]);
  expect(j.subject.join(" ")).toContain("src/rust_ts/main.ts tests/ui/a.rs -O");
  // gate.ts's probe check calls the oracle with an empty case.
  expect(j.empty).toEqual(["--", "rustc", expect.stringMatching(/^\+nightly/)]);
  expect(j.hello.file).toBe("harness/corpus/miri/hello.rs");
  expect(j.hello.args.slice(j.hello.args.indexOf("--"))).toEqual(["--", "--target", "aarch64-apple-darwin", "--sysroot", expect.any(String), "--edition=2021", "harness/corpus/miri/hello.rs"]);
  // Root's decision (2026-11-14): host cases naming the libc crate are skipped, decided from the source (the test, what it includes, its aux files).
  expect(j.libc.text).toEqual([true, true, true, false, false, false, false]);
  expect([j.libc.cloexec, j.libc.plain, j.libc.viaAux, j.libc.hello]).toEqual([true, false, true, false]);
  expect(j.libc.reason).toContain("two libc candidates");
  expect(j.libc.reason).toContain("E0464");
  expect(j.libc.gated).toEqual({
    own: [true, false],
    fn: [true, false],
    unixFn: [true, true],
    notWin: [true, true],
    sibling: [true, true],
    anyOf: [true, true],
    unknown: [true, true],
    string: [false, false],
    block: [false, false],
    lineCommentCfg: [true, true],
    blockCommentCfg: [true, true],
    nestedCommentCfg: [true, true],
    commentThenCfg: [true, false],
    commentedFnCfg: [true, true],
    parenInString: [false, false],
  });
  // The review's cases on this host: the two cfg(linux) ones load no libc here (kept), out-of-stack's cfg(unix) one does (skipped).
  expect(j.libc.reviewThree).toEqual([false, false, true]);
  expect(j.libc.evalCfg).toEqual([true, true, null]);
  // scripts/oracle-self.ts: the oracle's command as the subject side, still with the oracle's compiler.
  expect(j.selfSide).toEqual(["--side", "subject", "--runs", "1"]);
  expect(j.selfIr).toEqual(["--side", "subject"]);
  expect(j.helpers).toEqual(["x", "-Crpath", "-Cdebuginfo=0", "-Lnative=/h", "-g"]);
  expect(j.helpersOwnDebug).toEqual(["x", "-Crpath", "-Lnative=/h", "-g"]);
  expect(j.helpersNone).toContain("-Crpath");
  expect(j.opts).toEqual(["--expect", "run-fail", "--arg", "a b", "--env", "K=v=w", "--unset", "U", "--error-pattern", "boom", "--regex-error-pattern", "r+", "--check-stdout"]);
  expect(j.optsPass).toEqual(["--expect", "run-pass"]);
  // Review harness-m7b: should-fail (N5), and a --test program runs one test at a time (F1).
  expect(j.optsLibtest).toEqual(["--expect", "run-fail", "--should-fail", "--libtest"]);
  // F1: the program-output mask is the native suites' alone; their unstable cases are listed, each with a diagnosed reason.
  expect(j.masked).toEqual([true, true, true, false, false]);
  expect(j.unstableLists).toEqual({ "run-pass-native": 18, "run-fail-native": 7 });
  expect(j.unstableHooked).toEqual([18, 7]);
  // N3: the harness-caused case left; N2: the link variables in the key.
  expect(j.harnessSkips).toEqual(["tests/ui/process-termination/process-termination-blocking-io.rs"]);
  expect(j.linkEnv).toEqual(["SDKROOT", "DEVELOPER_DIR", "LIBRARY_PATH"]);
  expect(j.optsBadEnv).toContain("exec-env");
  // Their criteria stay report only, but the suites are protected now: the wave 40r gate named them (decision 2026-11-14T16:27) and its
  // accept (gate-20261114-162816-root-vc2v, 4ec9a565) gave each a baseline, so the gate runs them by default.
  const baseline = new Set(readdirSync(join(REPO, "harness/baseline")).map((f) => f.replace(/\.txt$/, "")));
  for (const n of ["ir-run-pass", "ir-run-pass-o0", "ir-host", "native-hello", "run-pass-native", "run-fail-native"]) expect(baseline.has(n)).toBe(true);
  // Review harness-w40s N2: native-hello's protected set is its one case, as ir-hello's is pinned above; the growing ones are at least not empty.
  const ids = (n: string) => readFileSync(join(REPO, "harness/baseline", `${n}.txt`), "utf8").split("\n").filter(Boolean);
  expect(ids("native-hello")).toEqual(["hello"]);
  for (const n of ["ir-run-pass", "ir-run-pass-o0", "ir-host", "run-pass-native", "run-fail-native"]) expect(ids(n).length).toBeGreaterThan(0);
}, 120_000);
