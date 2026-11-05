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
  mono: s.MONO_ARGS,
  subject: { mirO2: get("mir-o2").subject([fake])[1], mono: get("mono-ui").subject([fake])[1] },
  hello: get("ir-hello").cases().map((c) => [c.id, c.args.includes("-O"), c.args.includes("--emit=llvm-ir"), c.args.includes("-Cno-prepopulate-passes")]),
  helloOracle: get("ir-hello").oracle([fake]).slice(1, 6).map((a) => a.split("/").pop()),
  encode: get("check-ui-encode-mir").cases().slice(0, 1).map((c) => [c.args.includes("-Zalways-encode-mir"), c.args.includes("-Copt-level=3"), c.args.at(-1) === c.file])[0],
  encodeCount: get("check-ui-encode-mir").cases().length,
  ui: get("check-ui").cases().length,
  dumpOracle: get("mir-opt-o4").oracle([fake]).at(-1),
  dumpSubject: get("mir-opt-o4").subject([fake]).at(-1),
  rgDescriptions: ["check-rg", "check-rg-encode-mir", "check-rg-host"].map((n) => get(n).description),
  rg: ["check-rg", "check-rg-encode-mir", "check-rg-host"].map((n) => [get(n).mode, get(n).split, Boolean(get(n).heavy), get(n).oracle([fake]).slice(2).join(" "), get(n).subject([fake]).slice(2).join(" ")]),
}));
`;

test("the suites, without running one", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  // The two run-pass suites' case lists come from the full corpus (3,479 tests, docs/handoff/harness-m7a.md); building it here would spend the unit step's budget.
  expect(j.dropped).toEqual(["a", "-Zc", "-ofoo"]);
  expect(j.mono.slice(0, 4)).toEqual(["-Zprint-mono-items=yes", "-Cno-prepopulate-passes", "--emit=llvm-ir", "-o"]);
  expect(j.mono[4]).toEndWith("mono-ui-discard.ll");
  expect(j.subject.mirO2).toEndWith("src/rust_ts/main.ts");
  expect(j.subject.mono).toEndWith("partitioning_oracle/run.ts");
  expect(j.hello).toEqual([["hello -O", true, true, true], ["hello -Copt-level=0", false, true, true]]);
  expect(j.encode).toEqual([true, true, true]);
  expect(j.encodeCount).toBe(Math.ceil(j.ui / 5));
  expect(j.dumpOracle).toContain("-Zdump-mir-dir=");
  expect(j.dumpSubject).toContain("-Zdump-mir-dir=");
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

test("no new suite is protected, so none is in the gate's defaults", () => {
  const baseline = new Set(readdirSync(join(REPO, "harness/baseline")).map((f) => f.replace(/\.txt$/, "")));
  expect(NEW.filter((n) => baseline.has(n))).toEqual([]);
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
