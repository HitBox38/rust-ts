// The command of both sides of the report suite `rlib-native` (harness/suites.ts; lane harness-w46, docs/handoff/link-rlib-native.md
// "Proposed report suite", review link-rlib-native §6): rlibs that bundle native static libraries, built in one fixed directory, and
// what was written.
//
//   bun scripts/rlib-native-run.ts --dir <case dir> --side oracle|subject --tree <dir> [--src <file>]... --compiler <n> -- <compiler argv (n words)> <step args> [--then <step args>]...
//
// - `<case dir>/work` and `<case dir>/tmp` are emptied (`<case dir>` must be an absolute `<...>/rlib-native/<16 hex digits>`; anything
//   else is refused). The `--tree` directory's contents (the checked-in static libraries, harness/corpus/rlib-native/libs) are copied
//   into `work`, the `--src` files by their base names, and `work/out` is made. Every step then runs the compiler there:
//   `<compiler argv> <step args>`, cwd `work`, this process's environment with `TMPDIR` set to `<case dir>/tmp`, its stdout and
//   stderr inherited. The rmeta embeds the working directory and the source path, so both sides use the same `<case dir>` (difftest
//   holds the suite's case lock around the two sides, which run one after the other: `Suite.caseLock`) and the case's args name the
//   sources by their base names (review link-rlib-native §6.1). The temp directory is the case's own: a universal library is narrowed
//   to the target's slice in a kept temp file (`.tmp<6 random>libfat.a`, upstream `try_extract_macho_fat_archive`).
// - The steps stop at the first that fails. Then, in every case (an error still writes the rmeta and dep-info), for every file
//   under `work/out`, sorted: scripts/host-rlib-run.ts `outReport` (a dep-info file as text with the work directory spelled `$DIR`, any
//   other file as `<name>: <size> bytes, sha256 <hex>`); for each `*.rlib`, its members in order, `  <member>: <size> bytes, sha256
//   <hex>` (§6.3: a DIFF names the member); and each file left in the temp directory, `tmp: <name>: <size> bytes`, with the 6 random characters of
//   `.tmpXXXXXX` masked, or `tmp: none`. The exit code is the failed step's (128 + signal if it was killed), else 0. The out directory
//   is kept as `<case dir>/<side>.out` for diagnosis, replacing the last one. SIGTERM/SIGINT (difftest's timeout) are passed on.
// No ERROR lines of its own: what it prints is part of the compared output.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, isAbsolute, join, sep } from "node:path";
import { outReport, parseHostRlibRunArgs } from "./host-rlib-run.ts";

export interface RlibNativeRunArgs {
  dir: string;
  side: "oracle" | "subject";
  tree: string;
  srcs: string[];
  compiler: string[];
  steps: string[][];
}

/** Parses the command line (see the header); throws on a malformed one. The rest is scripts/host-rlib-run.ts's command line. */
export function parseRlibNativeRunArgs(argv: string[]): RlibNativeRunArgs {
  const end = argv.indexOf("--");
  const i = argv.indexOf("--tree");
  if (i < 0 || (end >= 0 && i > end)) throw new Error("rlib-native-run: --tree is required");
  const tree = argv[i + 1];
  if (tree === undefined || tree === "--") throw new Error("rlib-native-run: --tree needs a value");
  try {
    return { tree, ...parseHostRlibRunArgs([...argv.slice(0, i), ...argv.slice(i + 2)]) };
  } catch (e) {
    throw new Error(String(e instanceof Error ? e.message : e).replace(/^host-rlib-run:/, "rlib-native-run:"));
  }
}

/** Why `<dir>/work` and `<dir>/tmp` may not be emptied, or `undefined`: `dir` must be an absolute `<...>/rlib-native/<16 hex digits>`. */
export function rlibNativeDirRefusal(dir: string): string | undefined {
  const parts = dir.split(sep);
  if (!isAbsolute(dir) || parts.includes("..") || parts.includes(".") || parts.at(-2) !== "rlib-native" || !/^[0-9a-f]{16}$/.test(parts.at(-1) ?? "")) {
    return `rlib-native-run: --dir must be an absolute <...>/rlib-native/<16 hex digits>, not ${dir}`;
  }
  return undefined;
}

/**
 * The members of an `ar` archive in order, with their data (`data`, `size`): GNU names (`name/`, `/<offset>` into the `//` table, `/` and
 * `//` themselves) and BSD names (`#1/<n>`: the name is the first n bytes of the data, not counted in the size). Throws on
 * anything else.
 */
export function arMembers(b: Uint8Array): { name: string; size: number; data: Uint8Array }[] {
  const text = (from: number, to: number) => new TextDecoder("latin1").decode(b.subarray(from, to));
  if (text(0, 8) !== "!<arch>\n") throw new Error("not an ar archive");
  const out: { name: string; size: number; data: Uint8Array }[] = [];
  let names = "";
  let at = 8;
  while (at < b.length) {
    if (b.length - at < 60) throw new Error(`a truncated member header at ${at}`);
    const raw = text(at, at + 16).trimEnd();
    const size = Number(text(at + 48, at + 58).trim());
    if (!Number.isSafeInteger(size) || size < 0 || text(at + 58, at + 60) !== "`\n" || at + 60 + size > b.length) throw new Error(`a bad member header at ${at}`);
    const data = at + 60;
    let name = raw;
    let from = data;
    if (raw.startsWith("#1/")) {
      const n = Number(raw.slice(3));
      if (!Number.isSafeInteger(n) || n < 0 || n > size) throw new Error(`a bad BSD member name at ${at}`);
      name = text(data, data + n).replace(/\0+$/, "");
      from = data + n;
    } else if (raw === "//") names = text(data, data + size);
    else if (/^\/\d+$/.test(raw)) {
      const off = Number(raw.slice(1));
      const endAt = names.indexOf("/\n", off);
      name = names.slice(off, endAt < 0 ? undefined : endAt);
    } else if (raw !== "/" && raw !== "/SYM64/" && raw.endsWith("/")) name = raw.slice(0, -1);
    out.push({ name, size: data + size - from, data: b.subarray(from, data + size) });
    at = data + size + (size % 2);
  }
  return out;
}

/** The member lines of every `*.rlib` under `out` (see the header). */
export function rlibMembersReport(out: string): string {
  const lines: string[] = [];
  const rlibs = existsSync(out) ? readdirSync(out, { recursive: true }).map(String).filter((f) => f.endsWith(".rlib")).sort() : [];
  for (const f of rlibs) {
    lines.push(`${f} members:`);
    try {
      for (const m of arMembers(readFileSync(join(out, f)))) lines.push(`  ${m.name}: ${m.size} bytes, sha256 ${new Bun.CryptoHasher("sha256").update(m.data).digest("hex")}`);
    } catch (e) {
      lines.push(`  (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** The temp directory's report (see the header): tempfile's `.tmp` + 6 random alphanumerics masked as `.tmpXXXXXX`. */
export function tmpReport(tmp: string): string {
  const files = existsSync(tmp) ? readdirSync(tmp, { recursive: true }).map(String).filter((f) => statSync(join(tmp, f)).isFile()) : [];
  if (files.length === 0) return "tmp: none\n";
  const mask = (f: string) => f.replace(/(^|\/)\.tmp[0-9A-Za-z]{6}/, "$1.tmpXXXXXX");
  return (
    files
      .map((f) => ({ f, m: mask(f) }))
      .sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0))
      .map(({ f, m }) => `tmp: ${m}: ${statSync(join(tmp, f)).size} bytes`)
      .join("\n") + "\n"
  );
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Runs a child in `cwd` with inherited stdio and `env` over this process's, passing SIGTERM/SIGINT on; its exit code (128 + signal if killed). */
async function child(cmd: string[], cwd: string, env: Record<string, string>): Promise<number> {
  const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
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

export async function rlibNativeRun(a: RlibNativeRunArgs): Promise<number> {
  const refused = rlibNativeDirRefusal(a.dir);
  if (refused !== undefined) throw new Error(refused);
  if (a.steps.length === 0) throw new Error("rlib-native-run: no step after the compiler command");
  const work = join(a.dir, "work");
  const tmp = join(a.dir, "tmp");
  const out = join(work, "out");
  rmSync(work, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  cpSync(a.tree, work, { recursive: true });
  mkdirSync(out, { recursive: true });
  for (const s of a.srcs) copyFileSync(s, join(work, basename(s)));
  let code = 0;
  for (const step of a.steps) {
    code = await child([...a.compiler, ...step], work, { TMPDIR: tmp });
    if (code !== 0) break;
  }
  writeSync(1, outReport(out, work) + rlibMembersReport(out) + tmpReport(tmp));
  const kept = join(a.dir, `${a.side}.out`);
  rmSync(kept, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, kept);
  return code;
}

if (import.meta.main) {
  let a: RlibNativeRunArgs;
  try {
    a = parseRlibNativeRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  try {
    process.exit(await rlibNativeRun(a));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
