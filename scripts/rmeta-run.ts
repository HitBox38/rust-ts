// The command of both sides of the rmeta suites (harness/suites.ts `rmeta-*`, `check-*`; plan-m5 §4, D4; lane
// probe-rmetadump): runs a compiler (the oracle rustc or src/rust_ts/main.ts) with `-o <file>` appended, then reports
// the `.rmeta` it wrote.
//
//   bun scripts/rmeta-run.ts --out <dir> --side oracle|subject [--bytes] [--dump <probe> [--dump-arg <a>]...] -- <compiler argv...>
//
// - The compiler runs with this process's cwd, environment and stdout/stderr (inherited, so its diagnostics are passed
//   through byte for byte), writing `<dir>/lib<side>-<pid>.rmeta`. A compiler that fails ends the run: its exit code
//   is this process's, and the file is removed. A compiler that exits 0 but writes no file prints `rmeta: none` (and
//   nothing else) and exits 0. SIGTERM/SIGINT (difftest's timeout) are passed on.
// - `--bytes` (the check-* suites: byte identity, plan-m5 D4) prints `rmeta: <size> bytes, sha256 <hex>`. On the
//   subject side, when `<dir>/oracle.rmeta` (the oracle's file from the oracle's last *run*) exists and differs, the
//   side file `<dir>/subject.differs` gets `rmeta: differs from oracle.rmeta (<size> bytes, sha256 <hex>) first at
//   byte <offset>`, for diagnosis (it is removed first, so it always describes the subject's last run). It is never
//   printed: the oracle's output may come from difftest's cache under another key than the run that last wrote
//   `oracle.rmeta` (the directory is keyed by suite and case id only), so a stale file must not change the compared
//   output; the sha256 tells whether `oracle.rmeta` is the file the cached output describes. Large files are never
//   printed.
// - `--dump` runs `<probe> [<dump-arg>...] <file> ...`: tools/probes/rmetadump `[--content] <file> <rustc args>`
//   (the `--dump-arg`s before the file are the probe's options, the ones after it its rustc arguments: `--dump-arg`
//   values up to a literal `--` go first, the rest after the file). Its stdout and stderr are inherited; a probe that
//   fails (e.g. an ICE on an rmeta the oracle's decoder cannot read) makes this process exit with its code.
// - The file is then kept as `<dir>/<side>.rmeta` (renamed: atomic), for the subject's comparison and for diagnosis.
// No ERROR lines of its own: what it prints is part of the compared output.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

export interface RmetaRunArgs {
  out: string;
  side: "oracle" | "subject";
  bytes: boolean;
  dump?: string;
  /** Probe options (before the file) and the probe's rustc arguments (after it). */
  dumpPre: string[];
  dumpPost: string[];
  compiler: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseRmetaRunArgs(argv: string[]): RmetaRunArgs {
  const a: Partial<RmetaRunArgs> & { dumpArgs: string[] } = { bytes: false, dumpArgs: [] };
  let compiler: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`rmeta-run: ${o} needs a value`);
      return v;
    };
    // (Only at an option's place: a `--dump-arg --` is a value.)
    if (o === "--") {
      compiler = argv.slice(i + 1);
      break;
    } else if (o === "--out") a.out = val();
    else if (o === "--side") {
      const v = val();
      if (v !== "oracle" && v !== "subject") throw new Error(`rmeta-run: --side must be oracle or subject, not ${v}`);
      a.side = v;
    } else if (o === "--bytes") a.bytes = true;
    else if (o === "--dump") a.dump = val();
    else if (o === "--dump-arg") a.dumpArgs.push(val());
    else throw new Error(`rmeta-run: unknown option ${o}`);
  }
  if (compiler === undefined) throw new Error("rmeta-run: missing `--` before the compiler command");
  if (compiler.length === 0) throw new Error("rmeta-run: no compiler command");
  if (a.out === undefined || a.side === undefined) throw new Error("rmeta-run: --out and --side are required");
  const k = a.dumpArgs.indexOf("--");
  const [dumpPre, dumpPost] = k < 0 ? [[], a.dumpArgs] : [a.dumpArgs.slice(0, k), a.dumpArgs.slice(k + 1)];
  return { out: a.out, side: a.side, bytes: a.bytes!, ...(a.dump !== undefined ? { dump: a.dump } : {}), dumpPre, dumpPost, compiler };
}

/** The first offset where two files differ (the shorter one's length if one is a prefix of the other), or -1. */
export function firstDifference(a: string, b: string): number {
  const fa = openSync(a, "r");
  const fb = openSync(b, "r");
  try {
    const ba = Buffer.alloc(1 << 20);
    const bb = Buffer.alloc(1 << 20);
    for (let pos = 0; ; ) {
      const na = readSync(fa, ba, 0, ba.length, pos);
      const nb = readSync(fb, bb, 0, bb.length, pos);
      const n = Math.min(na, nb);
      for (let i = 0; i < n; i++) if (ba[i] !== bb[i]) return pos + i;
      if (na !== nb) return pos + n;
      if (na === 0) return -1;
      pos += n;
    }
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}

const sha256 = (p: string): string => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");

/** `rmeta: <size> bytes, sha256 <hex>` of a file. */
export const bytesLine = (p: string): string => `rmeta: ${statSync(p).size} bytes, sha256 ${sha256(p)}`;

/** The subject's comparison line against the oracle's file (`subject.differs`), or `undefined` when there is none or they are equal. */
export function differsLine(subject: string, oracle: string): string | undefined {
  if (!existsSync(oracle)) return undefined;
  const off = firstDifference(subject, oracle);
  if (off < 0) return undefined;
  return `rmeta: differs from oracle.rmeta (${statSync(oracle).size} bytes, sha256 ${sha256(oracle)}) first at byte ${off}`;
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

export async function rmetaRun(a: RmetaRunArgs): Promise<number> {
  mkdirSync(a.out, { recursive: true });
  // `lib*.rmeta`: rustc takes an `--extern` file only by that name (rustc_metadata locator.rs).
  const tmp = join(a.out, `lib${a.side}-${process.pid}.rmeta`);
  const kept = join(a.out, `${a.side}.rmeta`);
  const differs = join(a.out, "subject.differs");
  rmSync(tmp, { force: true });
  if (a.side === "subject") rmSync(differs, { force: true });
  try {
    const code = await child([...a.compiler, "-o", tmp]);
    if (code !== 0) return code;
    if (!existsSync(tmp)) {
      writeSync(1, "rmeta: none\n");
      return 0;
    }
    if (a.bytes) {
      writeSync(1, bytesLine(tmp) + "\n");
      if (a.side === "subject") {
        const d = differsLine(tmp, join(a.out, "oracle.rmeta"));
        if (d) writeFileSync(differs, d + "\n");
      }
    }
    if (a.dump !== undefined) {
      const pc = await child([a.dump, ...a.dumpPre, tmp, ...a.dumpPost]);
      if (pc !== 0) return pc;
    }
    renameSync(tmp, kept);
    return 0;
  } finally {
    rmSync(tmp, { force: true });
  }
}

if (import.meta.main) {
  let a: RmetaRunArgs;
  try {
    a = parseRmetaRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  process.exit(await rmetaRun(a));
}
