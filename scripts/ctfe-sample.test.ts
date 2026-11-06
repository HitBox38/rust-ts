// Tests of the CTFE trace sample (scripts/ctfe-sample.ts, scripts/lib/ctfe-sample.ts; lane harness-w37): the classes
// (a crash is a failure, never a skip), the deterministic selection, the per-reason report and the exit status.
// The pure part runs in-process; the CLI runs once, on one small file, in a child (it needs the oracle).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type SampleResult, type SampleRun, FAILURE_CLASSES, SAMPLE_CLASSES, classify, failures, fileEdition, sampleFiles, sampleReport } from "./lib/ctfe-sample.ts";

const REPO = resolve(import.meta.dir, "..");
const run = (r: Partial<SampleRun> = {}): SampleRun => ({ exit: 0, stdout: "", stderr: "", over: false, timeout: false, ...r });
const INFO = "  INFO rustc_const_eval::interpret::eval_context x\n";

describe("classes", () => {
  test("matched: stdout, stderr and exit equal; `info` when the oracle traced", () => {
    expect(classify(run({ stdout: "fn f", stderr: INFO }), run({ stdout: "fn f", stderr: INFO }), REPO)).toEqual({ cls: "matched", detail: "info" });
    expect(classify(run({ exit: 1, stderr: "error: x\n" }), run({ exit: 1, stderr: "error: x\n" }), REPO)).toEqual({ cls: "matched", detail: "no-info" });
  });
  test("oracle-skip: the oracle went over the cap or timed out (the port is not needed)", () => {
    expect(classify(run({ over: true }), undefined, REPO)).toEqual({ cls: "oracle-skip", detail: "oracle output over the cap" });
    expect(classify(run({ timeout: true, exit: null }), undefined, REPO)).toEqual({ cls: "oracle-skip", detail: "oracle timeout" });
    expect(() => classify(run(), undefined, REPO)).toThrow();
  });
  test("a crash (port exit 101, the oracle did not ICE) is a failure with its message and top frames", () => {
    const stderr = [
      "rust-ts: internal compiler error: TypeError: undefined is not an object (evaluating 'x.kind')",
      `TypeError: undefined is not an object`,
      `    at eval_to_allocation (${REPO}/src/rustc_const_eval/const_eval/eval_queries.ts:521:9)`,
      `    at ${REPO}/src/rustc_const_eval/interpret/eval_context.ts:88:3`,
      `    at f (${REPO}/src/a.ts:1:1)`,
      `    at g (${REPO}/src/b.ts:1:1)`,
      "",
    ].join("\n");
    const c = classify(run({ stdout: "fn f" }), run({ exit: 101, stderr }), REPO);
    expect(c.cls).toBe("crashed");
    expect(c.detail).toBe(
      "TypeError: undefined is not an object (evaluating 'x.kind') @ src/rustc_const_eval/const_eval/eval_queries.ts < src/rustc_const_eval/interpret/eval_context.ts < src/a.ts",
    );
    expect(FAILURE_CLASSES).toContain("crashed");
    // A port panic printed as rustc does.
    expect(classify(run(), run({ exit: 101, stderr: "thread 'rustc' panicked at x\n" }), REPO).detail).toBe("thread 'rustc' panicked at x @ ");
    expect(classify(run(), run({ exit: 101, stderr: "thread 'rustc' (123) panicked at x\n" }), REPO).detail).toBe("thread 'rustc' (123) panicked at x @ ");
    // Both sides ICE: compared like any other output.
    expect(classify(run({ exit: 101, stderr: "error: internal compiler error: a\n" }), run({ exit: 101, stderr: "error: internal compiler error: a\n" }), REPO).cls).toBe("matched");
    expect(classify(run({ exit: 101, stderr: "error: internal compiler error: a\n" }), run({ exit: 101, stderr: "error: internal compiler error: b\n" }), REPO).cls).toBe("differed");
    // ... with the thread id masked, as difftest compares it; a location still differs.
    expect(classify(run({ exit: 101, stderr: "thread 'rustc' (1) panicked at x\n" }), run({ exit: 101, stderr: "thread 'rustc' (2) panicked at x\n" }), REPO).cls).toBe("matched");
    expect(classify(run({ exit: 101, stderr: "thread 'rustc' (1) panicked at x\n" }), run({ exit: 101, stderr: "thread 'rustc' (2) panicked at y\n" }), REPO).cls).toBe("differed");
  });
  test("port-timeout and port output over the cap are failures; unported is not", () => {
    expect(classify(run(), run({ timeout: true, exit: null }), REPO)).toEqual({ cls: "port-timeout", detail: "" });
    expect(classify(run(), run({ over: true }), REPO)).toEqual({ cls: "differed", detail: "port output over the cap, oracle not" });
    expect(classify(run(), run({ exit: 70, stderr: "rust-ts: unported: rustc_x::y (z.rs:1)\n" }), REPO)).toEqual({ cls: "port-unported", detail: "rustc_x::y (z.rs:1)" });
    expect(FAILURE_CLASSES).not.toContain("port-unported");
    expect(FAILURE_CLASSES).not.toContain("oracle-skip");
  });
  test("differed: the first differing stderr line, else stdout, else exit", () => {
    expect(classify(run({ stderr: "a\nb\nc\n" }), run({ stderr: "a\nB\nc\n" }), REPO)).toEqual({ cls: "differed", detail: "exit 0/0 stderr line 2/4: o=b | p=B" });
    expect(classify(run({ stdout: "x" }), run({ stdout: "y" }), REPO)).toEqual({ cls: "differed", detail: "exit 0/0 stdout" });
    expect(classify(run({ exit: 1 }), run({ exit: 0 }), REPO)).toEqual({ cls: "differed", detail: "exit 1/0 exit" });
    // The port stops early: its missing lines show as empty.
    expect(classify(run({ stderr: INFO + INFO }), run({ stderr: INFO }), REPO).detail).toBe(`exit 0/0 stderr line 2/3: o=${INFO.trimEnd()} | p=`);
  });
});

describe("selection", () => {
  const files = Array.from({ length: 10 }, (_, i) => `/u/tests/ui/consts/f${String(9 - i).padStart(2, "0")}.rs`);
  test("every k-th of the sorted files, at most n; `all` takes all", () => {
    expect(sampleFiles(files, 3).map((f) => f.slice(-6))).toEqual(["f00.rs", "f03.rs", "f06.rs"]);
    expect(sampleFiles(files, 4).map((f) => f.slice(-6))).toEqual(["f00.rs", "f02.rs", "f04.rs", "f06.rs"]);
    expect(sampleFiles(files, 20).length).toBe(10);
    expect(sampleFiles(files, "all")).toEqual([...files].sort());
  });
  test("edition from `//@ edition:`, else 2015", () => {
    expect(fileEdition("//@ edition: 2021\nfn main() {}")).toBe("2021");
    expect(fileEdition("//@edition:2018\n")).toBe("2018");
    expect(fileEdition("fn main() {}")).toBe("2015");
  });
});

describe("report", () => {
  const results: SampleResult[] = [
    { file: "a.rs", cls: "matched", detail: "info" },
    { file: "b.rs", cls: "matched", detail: "no-info" },
    { file: "c.rs", cls: "crashed", detail: "TypeError: `x` @ src/a.ts" },
    { file: "d.rs", cls: "crashed", detail: "TypeError: `y` @ src/a.ts" },
    { file: "e.rs", cls: "port-unported", detail: "rustc_x::y" },
    { file: "f.rs", cls: "oracle-skip", detail: "oracle timeout" },
  ];
  test("counts per class (failures marked), INFO matches, and the details grouped per reason", () => {
    expect(sampleReport(results, "f=info")).toEqual([
      "files=6 filter=f=info",
      "matched=2",
      "differed=0 (failure)",
      "crashed=2 (failure)",
      "port-timeout=0 (failure)",
      "port-unported=1",
      "oracle-skip=1",
      "matched with INFO lines=1",
      "-- crashed",
      "  2 TypeError: `_` @ src/a.ts",
      "-- port-unported",
      "  1 rustc_x::y",
      "-- oracle-skip",
      "  1 oracle timeout",
    ]);
    expect(SAMPLE_CLASSES.length).toBe(6);
    expect(failures(results)).toBe(2);
    expect(failures(results.filter((r) => r.cls !== "crashed"))).toBe(0);
  });
});

// The CLI on one file of tests/ui/consts with the oracle (skipped, visibly, without the upstream checkout). The checkout
// is found where the CLI finds it, `RUST_TS_DATA` or the repo's `.env.local` (which `bun test` does not load, so the
// environment alone would skip this test): scripts/lib/common.ts says, in a child (see scripts/lib/deps.test.ts for why).
const UPSTREAM_FILE = "tests/ui/consts/const-fn-val.rs";
const data = Bun.spawnSync([process.execPath, "-e", `console.log((await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))})).DATA)`], { cwd: REPO, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
const haveUpstream = data !== "" && existsSync(join(data, "rust", UPSTREAM_FILE));
const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(REPO, "scripts/ctfe-sample.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
(haveUpstream ? test : test.skip)(`the CLI classifies one file and writes its report${haveUpstream ? "" : " (skipped: no upstream checkout)"}`, () => {
  const r = cli("--file", UPSTREAM_FILE);
  const out = r.stdout.toString();
  expect(out).toMatch(/^files=1 filter=rustc_const_eval::interpret=info$/m);
  const counts = SAMPLE_CLASSES.map((c) => Number(new RegExp(`^${c}=(\\d+)`, "m").exec(out)![1]));
  expect(counts.reduce((x, y) => x + y, 0)).toBe(1);
  const dir = /^details: (.*)$/m.exec(out)![1]!;
  const lines = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n");
  expect(lines.length).toBe(1);
  const res = JSON.parse(lines[0]!) as SampleResult;
  expect(res.file).toBe(UPSTREAM_FILE);
  // Exit 1 with an ERROR line exactly when the file failed.
  const failed = FAILURE_CLASSES.includes(res.cls);
  expect(r.exitCode).toBe(failed ? 1 : 0);
  expect(out.includes("ERROR: ctfe-sample:")).toBe(failed);
}, 300_000);

(haveUpstream ? test : test.skip)(`the CLI on a missing --file: one ERROR line, no stack trace${haveUpstream ? "" : " (skipped: no upstream checkout)"}`, () => {
  const r = cli("--file", "tests/ui/consts/no-such-file.rs");
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).toMatch(/^ERROR: --file tests\/ui\/consts\/no-such-file\.rs: no such file/m);
  expect(r.stderr.toString()).toBe("");
}, 60_000);
