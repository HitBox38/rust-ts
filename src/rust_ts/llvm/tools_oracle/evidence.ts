// rust-ts: lane llir-tools' evidence script (a tool, run by hand; not a test). For a deterministic sample of `mir-o2` cases at one
// opt level, it compares `LLVMRustOptimize` (tools.ts) with the oracle under the IR normal form N1 (scripts/lib/ir-normal.ts):
//   1. the oracle's `--emit=llvm-ir` at that level (its IR after its own `LLVMRustOptimize`), and the pipeline it printed
//      (`-Zautodiff=PrintPasses`);
//   2. the oracle's C API calls for the same compile with `-Cno-prepopulate-passes` (record.ts), replayed into the model (replay.ts);
//   3. model: tools.ts's `LLVMRustOptimize` on the replayed module; control: the same on the oracle's own pre-pass text (the
//      recorded run's output), which takes the model out of the picture;
//   4. the pipeline tools.ts printed for the case against the oracle's.
// Usage: bun src/rust_ts/llvm/tools_oracle/evidence.ts --opt 0|2 [--sample N] [--salt S] [--as <level>]. One summary line per class to stdout;
// per-case results to $RUST_TS_DATA/tmp/llir-tools-evidence/<opt>/results.jsonl.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, UPSTREAM } from "../../../../scripts/lib/common.ts";
import { normalForm } from "../../../../scripts/lib/ir-normal.ts";
import { llvmBinDir } from "../../../../scripts/lib/llvm-tools.ts";
import { SUITES } from "../../../../harness/suites.ts";
import { recorderDylib } from "../record.ts";
import { parseScript, replay } from "../replay.ts";
import type { Module } from "../ir.ts";
import type { TargetMachine } from "../handles.ts";
import { LLVMRustOptimize, module_text, opt_plan, print_pipeline, set_module_text, triple_probe, with_cl_args } from "../tools.ts";
import { Module as IrModule, Context } from "../ir.ts";
import { CL_ARGS, CODEGEN_LEVEL, settingsFor, tmFromRecorded, type Level } from "./fixtures.ts";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i < 0 ? undefined : process.argv[i + 1];
};
const level = (arg("--opt") ?? "2") as Level;
const N = Number(arg("--sample") ?? "40");
/** A sensitivity check: tools.ts runs at this level instead (its results must then differ where the level matters). */
const asLevel = (arg("--as") ?? level) as Level;
const salt = arg("--salt") ?? "llir-tools";
const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } }).stdout.toString().trim();
const bin = llvmBinDir(sysroot, "aarch64-apple-darwin");
const dylib = recorderDylib(sysroot, DATA, UPSTREAM);
const OUT = join(DATA, "tmp", "llir-tools-evidence", asLevel === level ? `O${level}` : `O${level}-as-O${asLevel}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const suite = SUITES.find((s) => s.name === "mir-o2")!;
const cases = (suite.cases as () => { id: string; file: string; args: string[]; env: Record<string, string | null> }[])()
  .map((c) => ({ c, k: createHash("sha256").update(`${salt}\0${c.id}`).digest("hex") }))
  .sort((a, b) => (a.k < b.k ? -1 : 1))
  .slice(0, N)
  .map((x) => x.c);

// mir-o2's cases all have `--target=x86_64-unknown-linux-gnu` (plan-m7 D3).
const TRIPLE = "x86_64-unknown-linux-gnu";
const tmText = readFileSync(join(import.meta.dir, "..", "..", "..", "rustc_codegen_llvm", "back", "write_oracle", `${TRIPLE}.tm`), "utf8");
const tm = tmFromRecorded(tmText.split("\n")[0]!, CODEGEN_LEVEL[asLevel]) as unknown as TargetMachine;

function envOf(c: { env: Record<string, string | null> }): Record<string, string> {
  const e: Record<string, string> = { ...(process.env as Record<string, string>), RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(c.env)) {
    if (v === null) delete e[k];
    else e[k] = v;
  }
  return e;
}
/** compiletest's argv without `-Zunpretty=mir` and any opt level, plus ours. */
function argvOf(c: { args: string[] }, extra: string[]): string[] {
  const a = c.args.filter((x) => x !== "-Zunpretty=mir" && x !== "-O" && !x.startsWith("-Copt-level"));
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "-C" && a[i + 1]?.startsWith("opt-level")) {
      i++;
      continue;
    }
    out.push(a[i]!);
  }
  return [...out, `-Copt-level=${level}`, ...extra];
}

const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
const results: string[] = [];

for (const c of cases) {
  const dir = join(OUT, c.id.replace(/[^A-Za-z0-9._-]/g, "_"));
  mkdirSync(dir, { recursive: true });
  const r: Record<string, unknown> = { id: c.id };
  const A = join(dir, "oracle.ll");
  const o = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...argvOf(c, ["--emit=llvm-ir", "-Zautodiff=PrintPasses", "-o", A])], { cwd: UPSTREAM, env: envOf(c), stdout: "pipe", stderr: "pipe" });
  if (o.exitCode !== 0 || !existsSync(A)) {
    r.class = "oracle-failed";
    r.why = o.stderr.toString().split("\n")[0];
  } else {
    const oraclePipeline = o.stdout.toString().trim();
    const B = join(dir, "prepass.ll");
    const script = join(dir, "calls.script");
    const rec = Bun.spawnSync([join(sysroot, "bin", "rustc"), ...argvOf(c, ["--emit=llvm-ir", "-Cno-prepopulate-passes", "-o", B])], {
      cwd: UPSTREAM,
      env: { ...envOf(c), DYLD_INSERT_LIBRARIES: dylib, RUST_TS_LLVM_RECORD: script },
      stdout: "pipe",
      stderr: "pipe",
      // The recorder is slow on big programs (its handle lookup, lane llir-init's fix); a case it cannot record in time is counted apart.
      timeout: 90_000,
    });
    const want = await normalForm(new Uint8Array(readFileSync(A)), "N1", bin);
    const settings_ = settingsFor(asLevel, c.args);
    if (settings_ === undefined) {
      r.class = "skipped-flags";
      bump(`class ${r.class}`);
      results.push(JSON.stringify(r));
      continue;
    }
    const settings = settings_;
    // The pipeline: what tools.ts would print against what the oracle printed (the PORT'd slp-vectorizer at O2 aside).
    const plan = opt_plan(settings, tm as never);
    let mine = plan.passes === undefined ? "" : new TextDecoder().decode(with_cl_args(CL_ARGS, () => print_pipeline([...CL_ARGS, ...plan.flags], plan.passes!, triple_probe(TRIPLE)))).trim();
    if (!settings.SLPVectorize) mine = mine.replace(",slp-vectorizer,", ",");
    r.pipeline = mine === oraclePipeline ? "same" : "differs";
    const optimize = (M: Module): void => {
      with_cl_args(CL_ARGS, () =>
        LLVMRustOptimize(M, tm, settings.OptLevel, "PreLinkNoLTO", false, settings.NoPrepopulatePasses, settings.VerifyIR, settings.LintIR, undefined, undefined, settings.MergeFunctions, settings.UnrollLoops, settings.SLPVectorize, settings.LoopVectorize, false, true, undefined, false, false, false, settings.SanitizerOptions, undefined, undefined, false, undefined, undefined, false, undefined, undefined, undefined, undefined, 0, settings.ExtraPasses, new TextEncoder().encode(settings.ExtraPasses).length, undefined, 0),
      );
    };
    const n1 = async (M: Module): Promise<{ text: string } | { error: string }> => normalForm(new Uint8Array(Buffer.from(module_text(M), "latin1")), "N1", bin);
    /** For a miss at N1: does N2 (local names discarded) reach the oracle's? */
    const wantN2 = await normalForm(new Uint8Array(readFileSync(A)), "N2", bin);
    const atN2 = async (M: Module): Promise<string> => {
      const got = await normalForm(new Uint8Array(Buffer.from(module_text(M), "latin1")), "N2", bin);
      return "error" in got || "error" in wantN2 ? "N2 failed" : got.text === wantN2.text ? "N2 only" : "differs at N2";
    };
    const firstDiff = (a: string, b: string): string => {
      const x = a.split("\n"), y = b.split("\n");
      const i = x.findIndex((l, j) => l !== y[j]);
      return `line ${i + 1}: ours ${JSON.stringify((x[i] ?? "").slice(0, 160))} oracle ${JSON.stringify((y[i] ?? "").slice(0, 160))}`;
    };
    if ("error" in want) {
      r.class = "oracle-normal-form-failed";
    } else if (rec.exitCode === null || rec.signalCode !== null) {
      r.class = "record-timeout";
    } else if (rec.exitCode !== 0 || !existsSync(B)) {
      r.class = "record-failed";
    } else {
      // Control: the oracle's own pre-pass text through tools.ts.
      try {
        const ctl = new IrModule(new Context(), "control");
        set_module_text(ctl, readFileSync(B).toString("latin1"));
        optimize(ctl);
        const got = await n1(ctl);
        r.control = "error" in got ? `normal form failed: ${got.error}` : got.text === want.text ? "N1" : `${await atN2(ctl)}: ${firstDiff(got.text, want.text)}`;
      } catch (e) {
        r.control = `stopped: ${(e as Error).message.split("\n")[0]}`;
      }
      // Model: the replayed module through tools.ts.
      try {
        const rr = replay(parseScript(readFileSync(script, "latin1")), UPSTREAM);
        const oracleId = readFileSync(A, "latin1").split("\n")[0]!;
        const M = rr.modules.find((m) => oracleId === `; ModuleID = '${m.moduleID}'`) ?? rr.modules[0]!;
        optimize(M);
        const got = await n1(M);
        r.model = "error" in got ? `normal form failed: ${got.error}` : got.text === want.text ? "N1" : `${await atN2(M)}: ${firstDiff(got.text, want.text)}`;
      } catch (e) {
        r.model = `stopped: ${(e as Error).message.split("\n")[0]}`;
      }
      r.class = "compared";
    }
  }
  bump(`class ${r.class}`);
  if (r.class === "compared") {
    bump(`pipeline ${r.pipeline}`);
    bump(`control ${String(r.control).split(":")[0]}`);
    bump(`model ${String(r.model).split(":")[0]}`);
  }
  results.push(JSON.stringify(r));
  writeFileSync(join(OUT, "results.jsonl"), `${results.join("\n")}\n`);
}
for (const [k, v] of [...tally].sort()) console.log(`O${level} ${k}: ${v}/${cases.length}`);
console.log(`details: ${join(OUT, "results.jsonl")}`);
