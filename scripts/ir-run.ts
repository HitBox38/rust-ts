// The command of both sides of an IR suite (plan-m7 D12, D2; lane harness-m7a), as scripts/rmeta-run.ts is for the rmeta
// suites: runs a compiler, normalises the IR it wrote (scripts/lib/ir-normal.ts) and prints it. difftest compares stdout.
//
//   bun scripts/ir-run.ts --out <dir> --side oracle|subject --bin <llvm-tools dir> [--tier N1|N2|N3] [--keep] -- <compiler argv...>
//
// - The compiler runs with this process's cwd, environment and stdout/stderr (inherited, so its diagnostics pass through byte
//   for byte), with `--out-dir <dir>/<side>-<pid>` appended; the argv names `--emit=llvm-ir` and no `-o`. `--out-dir`, not `-o`:
//   a `-o` turns several codegen units into one, which would change what is compared. A compiler that fails ends the run with
//   its exit code. One that exits 0 and writes no `.ll` prints `ir: none` and exits 0.
// - Each `.ll`, in byte order of its name, prints `ir: <file name> <tier>`, then its normal form. The default tier is N1.
// - An `opt` or `llvm-as` failure (the module does not parse or verify) prints `ir: normal form failed: <first error line>` and
//   exits `EXIT_NORMAL_FORM`, a difference from any oracle that succeeded (plan-m7 D16: never retried, never hidden).
// - `--keep` keeps the raw texts as `<dir>/<side>/<file name>` (renamed), for scripts/ir-diff.ts and to read the other tiers later
//   without running a compiler again. An IR suite does not pass it: a suite's raw text is about 230 MB (plan-m7 §6).
// - SIGTERM/SIGINT (difftest's timeout) are passed on to the compiler.
// No ERROR lines of its own: what it prints is part of the compared output. Only a malformed command line exits 2.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isIrTier, normalForm, type IrTier } from "./lib/ir-normal.ts";

/** Not a code rustc uses: 0, 1, 70 (the port's `unported`) or 101 (an ICE). */
export const EXIT_NORMAL_FORM = 102;

export interface IrRunArgs {
  out: string;
  side: "oracle" | "subject";
  bin: string;
  tier: IrTier;
  keep: boolean;
  compiler: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseIrRunArgs(argv: string[]): IrRunArgs {
  const a: Partial<IrRunArgs> = { tier: "N1", keep: false };
  let compiler: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`ir-run: ${o} needs a value`);
      return v;
    };
    if (o === "--") {
      compiler = argv.slice(i + 1);
      break;
    } else if (o === "--out") a.out = val();
    else if (o === "--bin") a.bin = val();
    else if (o === "--side") {
      const v = val();
      if (v !== "oracle" && v !== "subject") throw new Error(`ir-run: --side must be oracle or subject, not ${v}`);
      a.side = v;
    } else if (o === "--tier") {
      const v = val();
      if (!isIrTier(v)) throw new Error(`ir-run: --tier must be N1, N2 or N3, not ${v}`);
      a.tier = v;
    } else if (o === "--keep") a.keep = true;
    else throw new Error(`ir-run: unknown option ${o}`);
  }
  if (compiler === undefined) throw new Error("ir-run: missing `--` before the compiler command");
  if (compiler.length === 0) throw new Error("ir-run: no compiler command");
  if (a.out === undefined || a.side === undefined || a.bin === undefined) throw new Error("ir-run: --out, --side and --bin are required");
  return { out: a.out, side: a.side, bin: a.bin, tier: a.tier!, keep: a.keep!, compiler };
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Runs a child with inherited stdio, passing SIGTERM/SIGINT on; its exit code (128 + signal if it was killed). */
async function child(cmd: string[]): Promise<number> {
  const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const pass = (sig: NodeJS.Signals) => () => p.kill(sig);
  const onTerm = pass("SIGTERM");
  const onInt = pass("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  try {
    const code = await p.exited;
    return p.signalCode ? 128 + (SIGNALS[p.signalCode] ?? 0) : code;
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
  }
}

/** Every byte of `text` to fd 1: a large write to a pipe can stop short. */
function writeAll(text: string): void {
  const b = Buffer.from(text, "latin1");
  for (let at = 0; at < b.length; ) at += writeSync(1, b, at);
}

export async function irRun(a: IrRunArgs): Promise<number> {
  const tmp = join(a.out, `${a.side}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const code = await child([...a.compiler, "--out-dir", tmp]);
    if (code !== 0) return code;
    const files = readdirSync(tmp)
      .filter((f) => f.endsWith(".ll"))
      .sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    if (files.length === 0) {
      writeAll("ir: none\n");
      return 0;
    }
    let failed = false;
    for (const f of files) {
      writeAll(`ir: ${f} ${a.tier}\n`);
      const n = await normalForm(readFileSync(join(tmp, f)), a.tier, a.bin);
      if ("error" in n) {
        writeAll(`ir: normal form failed: ${n.error}\n`);
        failed = true;
        break;
      }
      writeAll(n.text);
    }
    if (a.keep) {
      const kept = join(a.out, a.side);
      rmSync(kept, { recursive: true, force: true });
      mkdirSync(kept, { recursive: true });
      for (const f of files) renameSync(join(tmp, f), join(kept, f));
    }
    return failed ? EXIT_NORMAL_FORM : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  let a: IrRunArgs;
  try {
    a = parseIrRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  process.exit(await irRun(a));
}
