// rust-ts: lane llir-tools' evidence script (a tool, run by hand; not a test). For a deterministic sample of `mir-o2` cases at one
// opt level, it compares `LLVMRustOptimize` (tools.ts) with the oracle under the IR normal form N1 (scripts/lib/ir-normal.ts):
//   1. the oracle's `--emit=llvm-ir` at that level (its IR after its own `LLVMRustOptimize`), and the pipeline it printed
//      (`-Zautodiff=PrintPasses`);
//   2. control: the oracle's own pre-pass text (`-Cno-prepopulate-passes`) through tools.ts's `LLVMRustOptimize`, which takes the
//      model out of the picture;
//   3. model: the oracle's C API calls for the same compile (record.ts), replayed into the model (replay.ts), through tools.ts;
//   4. the pipeline tools.ts prints for the case against the oracle's.
// A result that misses N1 is also compared at N2 (local names discarded).
// Usage: bun src/rust_ts/llvm/tools_oracle/evidence.ts --opt 0|2 [--sample N] [--salt S] [--as <level>] [--record-timeout <s>].
// One summary line per class to stdout; per-case results to $RUST_TS_DATA/tmp/llir-tools-evidence/O<opt>/results.jsonl.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES } from "../../../../harness/suites.ts";
import { DATA, PIN, UPSTREAM } from "../../../../scripts/lib/common.ts";
import { normalForm } from "../../../../scripts/lib/ir-normal.ts";
import { llvmBinDir } from "../../../../scripts/lib/llvm-tools.ts";
import type { TargetMachine } from "../handles.ts";
import { Context, Module } from "../ir.ts";
import { recorderDylib } from "../record.ts";
import { parseScript, replay } from "../replay.ts";
import { LLVMRustOptimize, module_text, opt_plan, print_pipeline, set_module_text, triple_probe, with_cl_args } from "../tools.ts";
import { CL_ARGS, CODEGEN_LEVEL, type Level, settingsFor, tmFromRecorded } from "./fixtures.ts";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i < 0 ? undefined : process.argv[i + 1];
};
const level = (arg("--opt") ?? "2") as Level;
const N = Number(arg("--sample") ?? "40");
const salt = arg("--salt") ?? "llir-tools";
/** A sensitivity check: tools.ts runs at this level instead (its results must then differ where the level matters). */
const asLevel = (arg("--as") ?? level) as Level;
const RECORD_TIMEOUT_MS = Number(arg("--record-timeout") ?? "60") * 1000;
const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } }).stdout.toString().trim();
const bin = llvmBinDir(sysroot, "aarch64-apple-darwin");
const dylib = recorderDylib(sysroot, DATA, UPSTREAM);
const OUT = join(DATA, "tmp", "llir-tools-evidence", asLevel === level ? `O${level}` : `O${level}-as-O${asLevel}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

type SuiteCase = { id: string; file: string; args: string[]; env: Record<string, string | null> };
const suite = SUITES.find((s) => s.name === "mir-o2")!;
const cases = (suite.cases as () => SuiteCase[])()
  .map((c) => ({ c, k: createHash("sha256").update(`${salt}\0${c.id}`).digest("hex") }))
  .sort((a, b) => (a.k < b.k ? -1 : 1))
  .slice(0, N)
  .map((x) => x.c);

// mir-o2's cases all have `--target=x86_64-unknown-linux-gnu` (plan-m7 D3).
const TRIPLE = "x86_64-unknown-linux-gnu";
const tmText = readFileSync(join(import.meta.dir, "..", "..", "..", "rustc_codegen_llvm", "back", "write_oracle", `${TRIPLE}.tm`), "utf8");
const tm = tmFromRecorded(tmText.split("\n")[0]!, CODEGEN_LEVEL[asLevel]) as unknown as TargetMachine;

function envOf(c: SuiteCase): Record<string, string> {
  const e: Record<string, string> = { ...(process.env as Record<string, string>), RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  for (const [k, v] of Object.entries(c.env)) {
    if (v === null) delete e[k];
    else e[k] = v;
  }
  return e;
}
/** compiletest's argv without `-Zunpretty=mir` and any opt level, plus ours. */
function argvOf(c: SuiteCase, extra: string[]): string[] {
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
const firstDiff = (a: string, b: string): string => {
  const x = a.split("\n");
  const y = b.split("\n");
  const i = x.findIndex((l, j) => l !== y[j]);
  return `line ${i + 1}: ours ${JSON.stringify((x[i] ?? "").slice(0, 160))} oracle ${JSON.stringify((y[i] ?? "").slice(0, 160))}`;
};
const textOf = (M: Module): Uint8Array => new Uint8Array(Buffer.from(module_text(M), "latin1"));

const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
const results: string[] = [];

async function runCase(c: SuiteCase, r: Record<string, unknown>): Promise<void> {
  const dir = join(OUT, c.id.replace(/[^A-Za-z0-9._-]/g, "_"));
  mkdirSync(dir, { recursive: true });
  const settings = settingsFor(asLevel, c.args);
  if (settings === undefined) {
    r.class = "skipped-flags";
    return;
  }
  const A = join(dir, "oracle.ll");
  const o = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...argvOf(c, ["--emit=llvm-ir", "-Zautodiff=PrintPasses", "-o", A])], { cwd: UPSTREAM, env: envOf(c), stdout: "pipe", stderr: "pipe" });
  if (o.exitCode !== 0 || !existsSync(A)) {
    r.class = "oracle-failed";
    r.why = o.stderr.toString().split("\n")[0];
    return;
  }
  const want = await normalForm(new Uint8Array(readFileSync(A)), "N1", bin);
  if ("error" in want) {
    r.class = "oracle-normal-form-failed";
    return;
  }
  // The oracle's pre-pass text, without the recorder (the control's input).
  const P = join(dir, "prepass.ll");
  const pre = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...argvOf(c, ["--emit=llvm-ir", "-Cno-prepopulate-passes", "-o", P])], { cwd: UPSTREAM, env: envOf(c), stdout: "pipe", stderr: "pipe" });
  if (pre.exitCode !== 0 || !existsSync(P)) {
    r.class = "prepass-failed";
    return;
  }
  r.class = "compared";

  // The pipeline: what tools.ts would print against what the oracle printed (the PORT'd slp-vectorizer aside).
  const plan = opt_plan(settings, tm as never);
  let mine = plan.passes === undefined ? "" : new TextDecoder().decode(print_pipeline([...CL_ARGS, ...plan.flags], plan.passes, triple_probe(TRIPLE))).trim();
  if (!settings.SLPVectorize) mine = mine.replace(",slp-vectorizer,", ",");
  r.pipeline = mine === o.stdout.toString().trim() ? "same" : "differs";

  const optimize = (M: Module): void => {
    const extra = new TextEncoder().encode(settings.ExtraPasses);
    with_cl_args(CL_ARGS, () =>
      LLVMRustOptimize(M, tm, settings.OptLevel, "PreLinkNoLTO", false, settings.NoPrepopulatePasses, settings.VerifyIR, settings.LintIR, undefined, undefined, settings.MergeFunctions, settings.UnrollLoops, settings.SLPVectorize, settings.LoopVectorize, false, true, undefined, false, false, false, settings.SanitizerOptions, undefined, undefined, false, undefined, undefined, false, undefined, undefined, undefined, undefined, 0, extra, extra.length, undefined, 0),
    );
  };
  const wantN2 = await normalForm(new Uint8Array(readFileSync(A)), "N2", bin);
  const verdict = async (M: Module): Promise<string> => {
    const got = await normalForm(textOf(M), "N1", bin);
    if ("error" in got) return `normal form failed: ${got.error}`;
    if (got.text === want.text) return "N1";
    const n2 = await normalForm(textOf(M), "N2", bin);
    const tier = "error" in n2 || "error" in wantN2 ? "N2 failed" : n2.text === wantN2.text ? "N2 only" : `differs at N2 (${firstDiff(n2.text, wantN2.text)})`;
    return `${tier}: N1 ${firstDiff(got.text, want.text)}`;
  };

  // Control: the oracle's own pre-pass text through tools.ts.
  try {
    const ctl = new Module(new Context(), "control");
    set_module_text(ctl, readFileSync(P).toString("latin1"));
    optimize(ctl);
    r.control = await verdict(ctl);
  } catch (e) {
    r.control = `stopped: ${(e as Error).message.split("\n")[0]}`;
  }

  // Model: the recorded calls replayed into the model, through tools.ts.
  const script = join(dir, "calls.script");
  const rec = Bun.spawnSync([join(sysroot, "bin", "rustc"), ...argvOf(c, ["--emit=llvm-ir", "-Cno-prepopulate-passes", "-o", join(dir, "recorded.ll")])], {
    cwd: UPSTREAM,
    env: { ...envOf(c), DYLD_INSERT_LIBRARIES: dylib, RUST_TS_LLVM_RECORD: script },
    stdout: "pipe",
    stderr: "pipe",
    // The recorder is slow on big programs (its handle lookup, lane llir-init's fix); a case it cannot record in time is counted apart.
    timeout: RECORD_TIMEOUT_MS,
  });
  if (rec.exitCode === null || rec.signalCode) {
    r.model = "record timeout";
    return;
  }
  if (rec.exitCode !== 0) {
    r.model = `record failed: ${rec.stderr.toString().split("\n")[0]}`;
    return;
  }
  try {
    const rr = replay(parseScript(readFileSync(script, "latin1")), UPSTREAM);
    const oracleId = readFileSync(A, "latin1").split("\n")[0]!;
    const M = rr.modules.find((m) => oracleId === `; ModuleID = '${m.moduleID}'`) ?? rr.modules[0]!;
    optimize(M);
    r.model = await verdict(M);
  } catch (e) {
    r.model = `stopped: ${(e as Error).message.split("\n")[0]}`;
  }
}

for (const c of cases) {
  const r: Record<string, unknown> = { id: c.id };
  await runCase(c, r);
  bump(`class ${r.class}`);
  if (r.class === "compared") {
    bump(`pipeline ${r.pipeline}`);
    bump(`control ${String(r.control).split(":")[0]}`);
    bump(`model ${String(r.model).split(":")[0]}`);
  }
  results.push(JSON.stringify(r));
  writeFileSync(join(OUT, "results.jsonl"), `${results.join("\n")}\n`);
}
for (const [k, v] of [...tally].sort()) console.log(`O${level}${asLevel === level ? "" : ` as O${asLevel}`} ${k}: ${v}/${cases.length}`);
console.log(`details: ${join(OUT, "results.jsonl")}`);
