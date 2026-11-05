// Tests of scripts/ir-diff.ts (plan-m7 D17, review F6): the pure parts on small texts, the tracer's source, and one real comparison in a
// child process, the oracle against a fake port that mutates the oracle's own text, since no port IR exists yet. Budget (F5): cheap.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { firstIrDifference, tierClass } from "./lib/ir-diff.ts";
import { compareCalls, importedCFunctions, parseOracleCalls, parsePortCalls, tracerSource } from "./lib/llvm-trace.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-ir-diff-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("firstIrDifference", () => {
  const MOD = '@g = global i8 0\ndefine void @a() {\nstart:\n  ret void\n}\n\ndefine internal i8 @"b::c"(ptr %x) {\nstart:\n  %0 = load i8, ptr %x, align 1\n  ret i8 %0\n}\n';
  test("the same text has none", () => {
    expect(firstIrDifference(MOD, MOD)).toBeUndefined();
  });
  test("inside a function: its name, and the line", () => {
    expect(firstIrDifference(MOD, MOD.replace("align 1", "align 2"))).toEqual({ function: '@"b::c"', oracleLine: 9, portLine: 9, oracle: "  %0 = load i8, ptr %x, align 1", port: "  %0 = load i8, ptr %x, align 2" });
  });
  test("a definition's own line: that function", () => {
    expect(firstIrDifference(MOD, MOD.replace("ptr %x)", "ptr noalias %x)"))?.function).toBe('@"b::c"');
  });
  test("module level: no function, and not the one before it", () => {
    expect(firstIrDifference(MOD, MOD.replace("global i8 0", "global i8 1"))?.function).toBeUndefined();
    expect(firstIrDifference(`${MOD}@h = global i8 0\n`, `${MOD}@h = global i8 1\n`)?.function).toBeUndefined();
  });
  test("one side ends first", () => {
    const d = firstIrDifference(MOD, `${MOD}extra`);
    expect(d?.oracle).toBe("");
    expect(d?.port).toBe("extra");
    expect(firstIrDifference(`${MOD}a\nb`, `${MOD}a`)).toMatchObject({ oracle: "b" });
    expect(firstIrDifference(`${MOD}a\nb`, `${MOD}a`)?.port).toBeUndefined();
  });
});

test("tierClass says which tier the sides agree at", () => {
  expect(tierClass({ N1: true, N2: true, N3: true })).toBe("same at N1");
  expect(tierClass({ N1: false, N2: true, N3: true })).toContain("local names");
  expect(tierClass({ N1: false, N2: false, N3: true })).toContain("instsimplify");
  expect(tierClass({ N1: false, N2: false, N3: false })).toContain("not names and not folds");
});

describe("the call trace", () => {
  const M = "LLVMModuleCreateWithNameInContext";
  test("the oracle's: only the thread that creates the first module, from that call on", () => {
    expect(parseOracleCalls(`1\tLLVMContextCreate\n2\t${M}\n1\tLLVMGetVersion\n2\tLLVMBuildAdd\tinst\n`)).toEqual([M, "LLVMBuildAdd\tinst"]);
    expect(parseOracleCalls("1\tLLVMContextCreate\n")).toEqual([]);
  });
  test("the port's: no LLVMRust wrappers, which the oracle's cannot see", () => {
    expect(parsePortCalls(`LLVMRustFoo\n${M}\nLLVMRustAddFunctionAttributes\nLLVMBuildAdd\tinst\n`)).toEqual([M, "LLVMBuildAdd\tinst"]);
  });
  test("a different call is the layer above the model", () => {
    expect(compareCalls(["LLVMBuildAdd\tinst"], ["LLVMBuildSub\tinst"]).kind).toBe("called-differently");
    expect(compareCalls(["LLVMSetValueName2\tself\tself"], ["LLVMSetValueName2\tx\tx"]).kind).toBe("called-differently");
  });
  test("the same call with another answer is the model: a fold, a no-op cast, a collision", () => {
    expect(compareCalls(["LLVMBuildAdd\tconst i64 3"], ["LLVMBuildAdd\tinst"]).kind).toBe("answered-differently");
    expect(compareCalls(["LLVMBuildPointerCast\toperand"], ["LLVMBuildPointerCast\tinst"]).kind).toBe("answered-differently");
    expect(compareCalls(["LLVMSetValueName2\tself\tself1"], ["LLVMSetValueName2\tself\tself2"]).kind).toBe("answered-differently");
  });
  test("equal, shorter, longer", () => {
    expect(compareCalls(["a", "b"], ["a", "b"])).toEqual({ kind: "match", calls: 2 });
    expect(compareCalls(["a", "b"], ["a"])).toEqual({ kind: "port-stops", index: 1, oracle: "b" });
    expect(compareCalls(["a"], ["a", "b"])).toEqual({ kind: "port-extra", index: 1, port: "b" });
  });
  test("imports: C functions only; the source covers each", () => {
    expect(importedCFunctions("_LLVMBuildAdd\n_LLVMRustFoo\n_memcpy\n")).toEqual(["LLVMBuildAdd"]);
    const c = tracerSource(["LLVMBuildAdd", "LLVMBuildCall2", "LLVMSetValueName2", "LLVMGetVersion"]);
    expect(c).toContain('built(0,(P)r,a)');
    expect(c).not.toContain("built(1,");
    expect(c).toContain("answer(2,w,h)");
    expect(c.match(/__interpose/g)?.length).toBe(4);
  });
});

test("ir-diff against a fake port: names the function, the tiers and the first line, and the tracer sees real calls", () => {
  const prog = join(TMP, "prog.rs");
  writeFileSync(prog, "#[inline(never)] pub fn add(a: &u64, b: u64) -> u64 { a.wrapping_add(b) }\nfn main() { println!(\"{}\", add(&1, 2)); }\n");
  const fake = join(TMP, "fake.ts");
  // The fake port: the oracle's rustc, then a lost `noalias` on one parameter.
  writeFileSync(fake, `import { readFileSync, writeFileSync } from "node:fs"; const argv = process.argv.slice(2); const r = Bun.spawnSync(["rustc", "+nightly", ...argv], { stdout: "inherit", stderr: "inherit" }); if (r.exitCode) process.exit(r.exitCode); const d = argv[argv.indexOf("--out-dir") + 1]; const f = d + "/prog.ll"; const t = readFileSync(f, "latin1"); writeFileSync(f, t.replace(/^(define .*@\\S*add\\S*\\(ptr )noalias /m, "$1"), "latin1");`);
  const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/ir-diff.ts"), prog, "--calls", "--subject", `${process.execPath} ${fake}`, "--run-id", `test-ir-diff-${process.pid}`], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: process.env });
  const out = r.stdout.toString();
  expect(out, r.stderr.toString()).toContain("tiers: N1 differs, N2 differs, N3 differs");
  expect(out).toContain("first difference at N1: function @");
  expect(out).toContain("add");
  expect(out).toMatch(/- define .*add\S*\(ptr noalias/);
  expect(out).toContain("the port wrote no call trace");
  expect(r.exitCode).toBe(1);
  const dir = /^files: (.*)$/m.exec(out)![1]!;
  // The tracer changes nothing: the traced oracle's text gives the same IR as an untraced run, and it saw the calls.
  const calls = readFileSync(join(dir, "oracle.calls.txt"), "latin1").split("\n");
  expect(calls[0]).toBe("LLVMModuleCreateWithNameInContext");
  expect(calls.some((c) => c.startsWith("LLVMBuildStore\tinst"))).toBe(true);
  expect(calls.some((c) => c.startsWith("LLVMSetValueName2\t"))).toBe(true);
  const untraced = Bun.spawnSync(["rustc", "+nightly", "--target", "x86_64-unknown-linux-gnu", "--edition=2021", "-O", "-Ccodegen-units=1", "-Cno-prepopulate-passes", "--emit=llvm-ir", "--out-dir", TMP, "prog.rs"], { cwd: TMP });
  expect(untraced.exitCode).toBe(0);
  expect(readFileSync(join(dir, "oracle", "prog.ll"), "latin1")).toBe(readFileSync(join(TMP, "prog.ll"), "latin1"));
  rmSync(resolve(dir, ".."), { recursive: true, force: true });
}, 60_000);
