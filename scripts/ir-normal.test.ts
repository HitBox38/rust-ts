// The normal form tiers on real oracle IR (scripts/lib/ir-normal.ts, scripts/lib/ir-mutations.ts; review plan-m7 F1, F10), and
// scripts/ir-run.ts with a fake compiler. Nothing here loads scripts/lib/common.ts. Budget (F5): under a few seconds of CPU.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyEdits, MUTATIONS } from "./lib/ir-mutations.ts";
import { IR_TIERS, normalForm, stripIrComments, tierCommands, type IrTier } from "./lib/ir-normal.ts";
import { llvmBinDir } from "./lib/llvm-tools.ts";
import { EXIT_NORMAL_FORM, parseIrRunArgs } from "./ir-run.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-ir-normal-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string };
const text = (cmd: string[]) => new TextDecoder().decode(Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout);
const host = /^host: (\S+)$/m.exec(text(["rustc", `+${pin.toolchain}`, "-vV"]))![1]!;
const BIN = llvmBinDir(text(["rustc", `+${pin.toolchain}`, "--print", "sysroot"]).trim(), host);

const nf = async (ir: string, tier: IrTier): Promise<string> => {
  const n = await normalForm(Buffer.from(ir, "latin1"), tier, BIN);
  // A module that does not parse or verify is a difference: the wrapper reports it, and the other side has text.
  return "error" in n ? `ERROR ${n.error}` : n.text;
};

let IR = "";
const REF = {} as Record<IrTier, string>;
/** What each mutation got, computed together in beforeAll: about 200 tool runs, so at 6 at a time for the unit step's wall. */
const GOT = new Map<string, Record<string, "caught" | "absorbed">>();
beforeAll(async () => {
  const r = Bun.spawnSync(["rustc", `+${pin.toolchain}`, "--target", "x86_64-unknown-linux-gnu", "-O", "-Ccodegen-units=1", "-Awarnings", "--emit=llvm-ir", "-Cno-prepopulate-passes", "--out-dir", TMP, join(REPO, "scripts/fixtures/ir/mut.rs")], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  IR = readFileSync(join(TMP, "mut.ll"), "latin1");
  for (const t of IR_TIERS) REF[t] = await nf(IR, t);
  const jobs = MUTATIONS.flatMap((m) => {
    const edits = m.sites(IR);
    return edits.length === 0 ? [] : IR_TIERS.map((t) => ({ m, t, ir: applyEdits(IR, edits) }));
  });
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < jobs.length) {
        const { m, t, ir } = jobs[next++]!;
        const got = (await nf(ir, t)) === REF[t] ? "absorbed" : "caught";
        GOT.set(m.name, { ...GOT.get(m.name), [t]: got });
      }
    }),
  );
}, 120_000);

describe("the oracle's text", () => {
  test("every tier gives text, not an error, and the tiers differ", () => {
    for (const t of IR_TIERS) expect(REF[t].startsWith("ERROR")).toBe(false);
    expect(REF.N2).not.toBe(REF.N1);
    expect(REF.N3).not.toBe(REF.N2);
    expect(REF.N1).toContain("%self"); // N1 keeps names
    expect(REF.N2).not.toContain("%self"); // N2 discards them
    expect(REF.N2).toContain("@alloc_"); // but never a global's
  });
  test("a normal form is a fixed point at N1", async () => {
    expect(await nf(REF.N1, "N1")).toBe(REF.N1);
  });
  test("bitcode with names kept gives N1's text: names are all the N2 path gives up", () => {
    const bc = Bun.spawnSync([join(BIN, "llvm-as"), "-", "-o", "-"], { stdin: Buffer.from(IR, "latin1"), stdout: "pipe" }).stdout;
    const opt = Bun.spawnSync([join(BIN, "opt"), "-passes=assign-guid,verify", "-S", "-o", "-"], { stdin: bc, stdout: "pipe" }).stdout;
    expect(stripIrComments(Buffer.from(opt).toString("latin1"))).toBe(REF.N1);
  });
});

describe("mutations of real oracle IR", () => {
  for (const m of MUTATIONS) {
    test(`${m.name}: ${IR_TIERS.map((t) => `${t} ${m.expect[t]}`).join(", ")}`, () => {
      const edits = m.sites(IR);
      expect(edits.length, `${m.name} has no site in the fixture: this test would prove nothing`).toBeGreaterThan(0);
      expect(applyEdits(IR, edits)).not.toBe(IR);
      expect(GOT.get(m.name)).toEqual(m.expect);
    });
  }
});

describe("stripIrComments", () => {
  test("a preds tail goes only on a block label line", () => {
    expect(stripIrComments('bb1:                ; preds = %a, %b\n"x y":   ; preds = %c\n7:  ; preds = %0\n')).toBe('bb1:\n"x y":\n7:\n');
    const kept = ['@s = constant [1 x i8] c"a  ; preds = %b", align 64', '  %x = call i8 @"f:  ; preds = %c"()', '!0 = !{!"x:  ; preds = %b"}', 'module asm "x:  ; preds = %b"', 'source_filename = "a:  ; preds = b"', "bb2:    ; No predecessors!"];
    expect(stripIrComments(kept.join("\n"))).toBe(kept.join("\n"));
  });
  test("a line goes only if it starts with `; `", () => {
    expect(stripIrComments("; a\n;b\n  ; c\nd\n")).toBe(";b\n  ; c\nd\n");
  });
  test("a label whose name holds the text keeps its name", () => {
    expect(stripIrComments('"a  ; preds = %b":   ; preds = %c')).toBe('"a  ; preds = %b":');
  });
});

describe("tier commands", () => {
  test("N1 reads text, N2 and N3 go through llvm-as; only N3 runs instsimplify; all verify", () => {
    expect(tierCommands("N1", "/b")).toEqual([["/b/opt", "-passes=assign-guid,verify", "-S", "-o", "-"]]);
    expect(tierCommands("N2", "/b")).toEqual([["/b/llvm-as", "-", "-o", "-"], ["/b/opt", "--discard-value-names", "-passes=assign-guid,verify", "-S", "-o", "-"]]);
    expect(tierCommands("N3", "/b")[1]).toContain("-passes=assign-guid,function(instsimplify),verify");
  });
  test("a broken module is an error with its first line and no absolute path", async () => {
    const n = await normalForm(Buffer.from("define void @f() {\n  bogus\n}\n"), "N1", BIN);
    expect(n).toEqual({ error: expect.stringMatching(/^opt: <stdin>:2:3: error: .* \(exit 1\)$/) });
    expect((n as { error: string }).error).not.toContain(BIN);
    const v = await normalForm(Buffer.from("define void @f() {\nstart:\n  br label %start\n  ret void\n}\n"), "N2", BIN);
    expect(v).toEqual({ error: expect.stringMatching(/^llvm-as: /) });
  });
});

describe("ir-run", () => {
  const run = (compiler: string, side = "subject", extra: string[] = []) => {
    const out = join(TMP, `run-${Math.random().toString(36).slice(2)}`);
    const c = join(TMP, `c-${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(c, compiler);
    const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/ir-run.ts"), "--out", out, "--side", side, "--bin", BIN, ...extra, "--", process.execPath, c, "arg"], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), out };
  };
  const WRITE = (files: Record<string, string>) => `import { writeFileSync } from "node:fs"; const d = process.argv.at(-1)!; console.log("compiler stdout"); console.error("compiler stderr"); const f = ${JSON.stringify(files)}; for (const k of Object.keys(f)) writeFileSync(d + "/" + k, f[k]);`;
  const LL = "; ModuleID = 'x'\nsource_filename = \"x\"\ndefine void @f() {\nstart:\n  ret void\n}\n";

  test("command line", () => {
    expect(parseIrRunArgs(["--out", "d", "--side", "oracle", "--bin", "b", "--", "rustc", "--", "x"])).toEqual({ out: "d", side: "oracle", bin: "b", tier: "N1", keep: false, compiler: ["rustc", "--", "x"] });
    expect(parseIrRunArgs(["--out", "d", "--side", "subject", "--bin", "b", "--tier", "N3", "--keep", "--", "c"])).toMatchObject({ tier: "N3", keep: true });
    expect(() => parseIrRunArgs(["--out", "d", "--side", "oracle", "--bin", "b", "--tier", "N4", "--", "c"])).toThrow("--tier");
    expect(() => parseIrRunArgs(["--out", "d", "--side", "oracle", "--", "c"])).toThrow("required");
    expect(() => parseIrRunArgs(["--out", "d", "--side", "oracle", "--bin", "b", "--"])).toThrow("no compiler");
    expect(() => parseIrRunArgs(["--out", "d", "--side", "both", "--bin", "b", "--", "c"])).toThrow("--side");
  });
  test("prints the compiler's output, then each file's normal form in name order; leaves no temp dir", () => {
    const r = run(WRITE({ "b.ll": LL, "a.ll": LL.replace("@f", "@g"), "c.txt": "not ir" }));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("compiler stderr\n");
    expect(r.stdout.startsWith("compiler stdout\nir: a.ll N1\n")).toBe(true);
    expect(r.stdout.indexOf("ir: b.ll N1")).toBeGreaterThan(r.stdout.indexOf("@g"));
    expect(r.stdout).not.toContain("ModuleID");
    expect(readdirSync(r.out)).toEqual([]);
  });
  test("--keep keeps the raw text, under the side's name", () => {
    const r = run(WRITE({ "a.ll": LL }), "oracle", ["--keep"]);
    expect(readFileSync(join(r.out, "oracle", "a.ll"), "utf8")).toBe(LL);
  });
  test("a failing compiler ends the run with its code, and no IR is read", () => {
    const r = run(`console.error("nope"); process.exit(70);`);
    expect([r.code, r.stdout, r.stderr]).toEqual([70, "", "nope\n"]);
    expect(existsSync(r.out)).toBe(true);
  });
  test("no .ll: `ir: none`", () => {
    const r = run(WRITE({}));
    expect([r.code, r.stdout]).toEqual([0, "compiler stdout\nir: none\n"]);
  });
  test("a module that does not parse is reported in the compared output, with its own exit code", () => {
    const r = run(WRITE({ "a.ll": "bogus\n" }));
    expect(r.code).toBe(EXIT_NORMAL_FORM);
    expect(r.stdout).toContain("ir: normal form failed: opt: <stdin>:1:1: error");
  });
});
