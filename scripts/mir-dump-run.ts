// The command of both sides of the suite mir-opt-o4 (harness/suites.ts `mirOptDumpRun`; lane harness-w50, docs/reviews/dataflow-graphviz.md,
// docs/handoff/dataflow-graphviz.md): runs a compiler with its own `-Zdump-mir-dir` and prints, after the compiler's own output, every file the
// compiler wrote there, so that the dump tree is part of the compared output and of the oracle cache.
//
//   bun scripts/mir-dump-run.ts --dir <dump dir> -- <compiler argv>
//
// - `<dump dir>` is emptied first. It must be an absolute `<...>/mir-opt-o4/oracle|subject/<16 hex digits>` (harness/suites.ts
//   `mirOptDumpPath`); anything else is refused, as it is deleted.
// - The compiler runs as `<compiler argv> -Zdump-mir-dir=<dump dir>`: last, so that no test flag can move it (compiletest passes its own
//   before the test's flags, runtest.rs `make_compile_args`; no test in tests/mir-opt at the pin sets one). Its cwd and environment are this process's, its stdout and stderr are
//   inherited, so its output passes through byte for byte. SIGTERM/SIGINT (difftest's timeout) are passed on. Its exit code is this
//   run's (128 + signal if it was killed).
// - Then, whatever that exit code, if the compiler wrote any file under `<dump dir>`: one line `-Zdump-mir-dir: <n> file(s)`, then for every
//   file, sorted by its path relative to `<dump dir>`: `--- <path> (<size> bytes)`, and its text, with a newline added if it does not end
//   with one (the size says whether it did). A file that is not UTF-8 prints `--- <path> (<size> bytes, not UTF-8): sha256 <hex>`. Empty
//   directories are not listed; a file that is neither a regular file nor a directory prints `--- <path>: not a regular file`. Nothing is
//   printed when no file was written, as for most tests (only a test whose own flags have `-Zdump-mir` dumps).
// - Normalisation: `<dump dir>` (as given, and its real path) is spelled `$DUMP_DIR` in the files' text, as each side has its own. Nothing
//   else. compiletest's mir-opt mode compares a dump with its checked-in `.mir`/`.diff` after `normalize_output` (runtest/mir_opt.rs
//   `check_mir_dump`), which spells machine paths (`$DIR`, `$SRC_DIR`, ...) so that one machine's dump compares with a file blessed on
//   another. Here both sides run on one machine, in one cwd, with one argv but the dump dir: byte identity is the stronger check, and that
//   normalisation could only hide a difference.
// - The tree is left in `<dump dir>` for diagnosis (`diff -r` the two sides' dirs) until the next run of that side of the case. difftest
//   holds the suite's case lock around the two sides (`Suite.caseLock`), so two difftests of the case do not share a dump dir.
// - A malformed command line or a refused `<dump dir>` exits 2 with one line on stderr, before anything runs or is removed.
// No ERROR lines of its own: what it prints is part of the compared output.
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

export interface MirDumpRunArgs {
  dir: string;
  compiler: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseMirDumpRunArgs(argv: string[]): MirDumpRunArgs {
  let dir: string | undefined;
  let rest: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    if (o === "--") {
      rest = argv.slice(i + 1);
      break;
    } else if (o === "--dir") {
      if (dir !== undefined) throw new Error("mir-dump-run: --dir given twice");
      const v = argv[++i];
      if (v === undefined) throw new Error("mir-dump-run: --dir needs a value");
      dir = v;
    } else throw new Error(`mir-dump-run: unknown option ${o}`);
  }
  if (dir === undefined) throw new Error("mir-dump-run: --dir is required");
  if (rest === undefined || rest.length === 0) throw new Error("mir-dump-run: missing `--` and the compiler command");
  return { dir, compiler: rest };
}

/** Why `dir` may not be emptied, or `undefined`: it must be an absolute `<...>/mir-opt-o4/oracle|subject/<16 hex digits>`. */
export function dumpDirRefusal(dir: string): string | undefined {
  const parts = dir.split(sep);
  const ok = isAbsolute(dir) && !parts.includes("..") && !parts.includes(".") && parts.at(-3) === "mir-opt-o4" && ["oracle", "subject"].includes(parts.at(-2) ?? "") && /^[0-9a-f]{16}$/.test(parts.at(-1) ?? "");
  return ok ? undefined : `mir-dump-run: --dir must be an absolute <...>/mir-opt-o4/oracle|subject/<16 hex digits>, not ${dir}`;
}

const sha256 = (b: Uint8Array): string => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** The report of the tree under `dir` (see the header), `""` when it holds no file. */
export function dumpReport(dir: string): string {
  if (!existsSync(dir)) return "";
  const real = realpathSync(dir);
  const mask = (t: string): string => t.replaceAll(real, "$DUMP_DIR").replaceAll(dir, "$DUMP_DIR");
  const entries: { rel: string; kind: "file" | "other" }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else entries.push({ rel: r, kind: e.isFile() ? "file" : "other" });
    }
  };
  walk("");
  if (entries.length === 0) return "";
  // Sorted by UTF-16 code unit, as `Array.prototype.sort`: the same order on both sides, whatever the directory order.
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const out: string[] = [`-Zdump-mir-dir: ${entries.length} file(s)\n`];
  for (const { rel, kind } of entries) {
    if (kind === "other") {
      out.push(`--- ${rel}: not a regular file\n`);
      continue;
    }
    const bytes = readFileSync(join(dir, rel));
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      out.push(`--- ${rel} (${bytes.length} bytes, not UTF-8): sha256 ${sha256(bytes)}\n`);
      continue;
    }
    const masked = mask(text);
    out.push(`--- ${rel} (${bytes.length} bytes)\n`, masked, masked === "" || masked.endsWith("\n") ? "" : "\n");
  }
  return out.join("");
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

export async function mirDumpRun(a: MirDumpRunArgs): Promise<number> {
  const refused = dumpDirRefusal(a.dir);
  if (refused !== undefined) throw new Error(refused);
  rmSync(a.dir, { recursive: true, force: true });
  const p = Bun.spawn([...a.compiler, `-Zdump-mir-dir=${a.dir}`], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const pass = (sig: NodeJS.Signals) => () => p.kill(sig);
  const onTerm = pass("SIGTERM");
  const onInt = pass("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  let code: number;
  try {
    const c = await p.exited;
    code = p.signalCode ? 128 + (SIGNALS[p.signalCode] ?? 0) : c;
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
  }
  const report = dumpReport(a.dir);
  if (report !== "") {
    const b = Buffer.from(report, "utf8");
    for (let off = 0; off < b.length; ) off += writeSync(1, b, off);
  }
  return code;
}

if (import.meta.main) {
  let a: MirDumpRunArgs;
  try {
    a = parseMirDumpRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  try {
    process.exit(await mirDumpRun(a));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
