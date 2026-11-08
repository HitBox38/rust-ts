// The command of both sides of the report suite `host-rlib` (harness/suites.ts; lane harness-w44, docs/handoff/object-write-macho.md
// "Proposed report suite", review object-write-macho §7): compiles host rlibs in one fixed directory and reports what was written.
//
//   bun scripts/host-rlib-run.ts --dir <case dir> --side oracle|subject [--src <file>]... --compiler <n> -- <compiler argv (n words)> <step args> [--then <step args>]...
//
// - `<case dir>/work` is emptied (`<case dir>` must be an absolute `<...>/host-rlib/<16 hex digits>`; anything else is refused), the
//   `--src` files are copied into it by their base names, and `work/out` is made. Every step then runs the compiler there:
//   `<compiler argv> <step args>`, cwd `work`, this process's environment, its stdout and stderr inherited, so its
//   diagnostics pass through byte for byte. The rmeta and the rlib embed the working directory and the source path, so both
//   sides use the same `<case dir>` (difftest holds the suite's case lock around the two sides, which run one after the
//   other: `Suite.caseLock`), and the case's args name the sources by their base names.
// - A step that fails ends the run with its exit code (128 + signal if it was killed). SIGTERM/SIGINT (difftest's timeout) are
//   passed on.
// - Then, for every file under `work/out`, sorted: a dep-info file (`*.d`) prints `<name>:` and its text with the work
//   directory (as given, or its real path) spelled `$DIR`; any other file prints `<name>: <size> bytes, sha256 <hex>`. The out directory is then kept as
//   `<case dir>/<side>.out` for diagnosis (`cmp` the two sides' files), replacing the last one.
// No ERROR lines of its own: what it prints is part of the compared output.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, isAbsolute, join, sep } from "node:path";

export interface HostRlibRunArgs {
  dir: string;
  side: "oracle" | "subject";
  srcs: string[];
  compiler: string[];
  steps: string[][];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseHostRlibRunArgs(argv: string[]): HostRlibRunArgs {
  let dir: string | undefined;
  let side: "oracle" | "subject" | undefined;
  let n: number | undefined;
  const srcs: string[] = [];
  let rest: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`host-rlib-run: ${o} needs a value`);
      return v;
    };
    if (o === "--") {
      rest = argv.slice(i + 1);
      break;
    } else if (o === "--dir") dir = val();
    else if (o === "--side") {
      const v = val();
      if (v !== "oracle" && v !== "subject") throw new Error(`host-rlib-run: --side must be oracle or subject, not ${v}`);
      side = v;
    } else if (o === "--src") srcs.push(val());
    else if (o === "--compiler") {
      const v = val();
      n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new Error(`host-rlib-run: --compiler must be a positive count, not ${v}`);
    } else throw new Error(`host-rlib-run: unknown option ${o}`);
  }
  if (dir === undefined || side === undefined || n === undefined) throw new Error("host-rlib-run: --dir, --side and --compiler are required");
  if (rest === undefined) throw new Error("host-rlib-run: missing `--` before the compiler command");
  if (rest.length < n) throw new Error("host-rlib-run: the compiler command is shorter than --compiler");
  // (No step at all parses, for scripts/gate.ts `oracleRuns`, which reads a suite's command for an empty case; a run refuses it.)
  const steps: string[][] = rest.length === n ? [] : [[]];
  for (const a of rest.slice(n)) {
    if (a === "--then") steps.push([]);
    else steps.at(-1)!.push(a);
  }
  if (steps.some((s) => s.length === 0)) throw new Error("host-rlib-run: an empty step");
  return { dir, side, srcs, compiler: rest.slice(0, n), steps };
}

/** Why `<dir>/work` may not be emptied, or `undefined`: `dir` must be an absolute `<...>/host-rlib/<16 hex digits>` (harness/suites.ts `hostRlibDir`). */
export function caseDirRefusal(dir: string): string | undefined {
  const parts = dir.split(sep);
  if (!isAbsolute(dir) || parts.includes("..") || parts.includes(".") || parts.at(-2) !== "host-rlib" || !/^[0-9a-f]{16}$/.test(parts.at(-1) ?? "")) {
    return `host-rlib-run: --dir must be an absolute <...>/host-rlib/<16 hex digits>, not ${dir}`;
  }
  return undefined;
}

const sha256 = (p: string): string => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");

/** The report of `out` (see the header): one entry per file, sorted by name, dep-info as text with `work` (or its real path) spelled `$DIR`. */
export function outReport(out: string, work: string): string {
  const real = existsSync(work) ? realpathSync(work) : work;
  const mask = (t: string): string => t.replaceAll(real, "$DIR").replaceAll(work, "$DIR");
  const lines: string[] = [];
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(out, rel), { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else files.push(r);
    }
  };
  walk("");
  for (const f of files.sort()) {
    const p = join(out, f);
    if (f.endsWith(".d")) lines.push(`${f}:`, ...mask(readFileSync(p, "utf8")).split("\n").filter((l, i, a) => i < a.length - 1 || l !== ""));
    else lines.push(`${f}: ${statSync(p).size} bytes, sha256 ${sha256(p)}`);
  }
  if (files.length === 0) lines.push("out: none");
  return lines.join("\n") + "\n";
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Runs a child in `cwd` with inherited stdio, passing SIGTERM/SIGINT on; its exit code (128 + signal if it was killed). */
async function child(cmd: string[], cwd: string): Promise<number> {
  const p = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
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

export async function hostRlibRun(a: HostRlibRunArgs): Promise<number> {
  const refused = caseDirRefusal(a.dir);
  if (refused !== undefined) throw new Error(refused);
  if (a.steps.length === 0) throw new Error("host-rlib-run: no step after the compiler command");
  const work = join(a.dir, "work");
  const out = join(work, "out");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const s of a.srcs) copyFileSync(s, join(work, basename(s)));
  for (const step of a.steps) {
    const code = await child([...a.compiler, ...step], work);
    if (code !== 0) return code;
  }
  writeSync(1, outReport(out, work));
  const kept = join(a.dir, `${a.side}.out`);
  rmSync(kept, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, kept);
  return 0;
}

if (import.meta.main) {
  let a: HostRlibRunArgs;
  try {
    a = parseHostRlibRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  try {
    process.exit(await hostRlibRun(a));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
