// The pure parts of the M7d ripgrep suites (plan-m7 §6, D11, D19; lane harness-m7d): `rg-build` (scripts/rg-build.ts and its `RUSTC`,
// scripts/rg-build-rustc.ts), `rg-behaviour` and `rg-behaviour-rgtest` (scripts/rg-behaviour.ts). No imports beyond node:, so tests load
// it without scripts/lib/common.ts.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** One compiler call cargo made, as scripts/rg-build-rustc.ts records it. */
export interface RgBuildCall {
  crate: string;
  /** `-C metadata`'s value, or `none` (a probe, or a build script's own probe of the compiler). */
  metadata: string;
  kind: "probe" | "compile";
  code: number;
  args: string[];
  /** The kept stderr file's name, in the log directory. */
  stderr: string;
  /** The size and SHA-256 of what the call printed on stdout: the answer cargo reads from a probe (review harness-m7d N3). */
  stdout: string;
}

/** A call that asks the compiler about itself (cargo's `-vV` and `--print`, a build script's `--version`), or a compile. */
export function callKind(args: readonly string[]): RgBuildCall["kind"] {
  return args.some((a) => a === "-vV" || a === "-V" || a === "--version" || a === "--print" || a.startsWith("--print=")) ? "probe" : "compile";
}

export const sizeHash = (b: Uint8Array): string => `${b.length} bytes, sha256 ${createHash("sha256").update(b).digest("hex")}`;

/** cargo's elapsed time at the end of its `Finished` line: `in 42.13s`, `in 1m 02s`, `in 1h 03m 04s`. */
const CARGO_TIME = / in (?:\d+h )?(?:\d+m )?\d+(?:\.\d+)?s$/;

/** cargo's line for a unit it starts, `   Compiling <package> v<version>` (a build script and its crate both show it). */
const COMPILING = /^\s*Compiling \S+ v\S+/;

/**
 * cargo's stderr as rg-build compares it: each `root` (`[path, name]`, longest first) replaced by its name, the elapsed time of the
 * `Finished` line replaced by `in <time>`, `\r\n` as `\n`, and the `Compiling` lines taken out and listed first, sorted, with their count.
 * Their order is the order cargo starts units in, which varies from run to run even at `-j1` (seen: two oracle runs swapped `serde` and
 * `termcolor`). Every other line keeps its place: a compiler's diagnostics are compared as they are.
 */
export function normaliseCargoStderr(text: string, roots: readonly [string, string][]): string[] {
  const sorted = [...roots].sort((a, b) => b[0].length - a[0].length);
  const lines = text
    .replaceAll("\r\n", "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      let l = line;
      for (const [path, name] of sorted) l = l.replaceAll(path, name);
      return /^\s*Finished /.test(l) ? l.replace(CARGO_TIME, " in <time>") : l;
    });
  const compiling = lines.filter((l) => COMPILING.test(l)).map((l) => l.trim());
  compiling.sort();
  return [`compiling: ${compiling.length}`, ...compiling.map((l) => `  ${l}`), "the rest, in order:", ...lines.filter((l) => !COMPILING.test(l) && l !== "").map((l) => `  ${l}`)];
}

/** Every file under `dir`, relative and sorted; `skip(rel)` leaves out a directory or file and what is under it. */
export function walkFiles(dir: string, skip: (rel: string) => boolean = () => false, base = dir, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(base, p);
    if (skip(rel)) continue;
    if (e.isDirectory()) walkFiles(p, skip, base, out);
    else if (e.isFile() || e.isSymbolicLink()) out.push(rel);
  }
  return base === dir ? out.sort() : out;
}

/**
 * What of a profile directory (`<target dir>/release`) is an artifact: everything but cargo's bookkeeping (`.fingerprint`, its lock,
 * an `incremental` directory, which D11 keeps empty anyway).
 */
export const notArtifact = (rel: string): boolean => {
  const top = rel.split("/")[0]!;
  return top === ".fingerprint" || top === "incremental" || top === ".cargo-lock";
};

/**
 * The artifacts whose bytes are compared, not only their names: dep-info (`*.d`, rustc's and cargo's) and what a build script
 * printed and where cargo put its output. In the oracle cargo's build-dir layout that is `build/<package>/<hash>/run/{stdout,stderr,
 * root-output}`: the `cargo:` lines a port-built build script prints are in `stdout` (review harness-m7d F3: this matched `output`, the
 * older layout's name, and so compared none of them). The older layout's `build/<package>-<hash>/{output,stderr,root-output}` is kept.
 * Not a file of those names a build script wrote into its `out` directory. Objects, rlibs and binaries are compared by name only:
 * plan-m7 D2 makes their bytes no gate.
 */
export const comparedBytes = (rel: string): boolean =>
  rel.endsWith(".d") || /^build\/[^/]+\/[^/]+\/run\/(?:stdout|stderr|root-output)$/.test(rel) || /^build\/[^/]+\/(?:output|stderr|root-output)$/.test(rel);

/** The artifact lines of the report: every artifact's path, then `bytes <path>: <size, sha256>` for those of `comparedBytes`. */
export function artifactLines(profileDir: string): string[] {
  const files = walkFiles(profileDir, notArtifact);
  return [`artifacts: ${files.length} files`, ...files.map((f) => `  ${f}`), ...files.filter(comparedBytes).map((f) => `  bytes ${f}: ${sizeHash(readFileSync(join(profileDir, f)))}`)];
}

/**
 * A call's line in the report: what kind, which crate and unit, how it ended, and the size and hash of its stdout (a probe's answer) and
 * stderr. Sorted by the caller, so cargo's order does not matter.
 */
export const callLine = (c: Pick<RgBuildCall, "crate" | "metadata" | "kind" | "code" | "stdout">, stderr: Uint8Array): string =>
  `  ${c.kind} ${c.crate} ${c.metadata}: exit ${c.code}, stdout ${c.stdout}, stderr ${sizeHash(stderr)}`;

/**
 * The line a ripgrep suite's wrapper prints, first on a line of its stderr, when it has no result to give: the oracle's build of rg made no
 * binary, the build was interrupted, or the corpus's surroundings are wrong. difftest never caches an oracle output that has it and makes
 * the case UNSTABLE (the suites' `uncachedOracle`), so an error is never kept as the oracle's answer (review harness-m7d F2).
 */
export const NO_RESULT_MARK = "rg-harness: no result: ";
export const noResultReason = (stderr: string): string | undefined => {
  const m = /^rg-harness: no result: (.*)$/m.exec(stderr);
  return m ? `detected: the ripgrep harness had no result: ${m[1]!.slice(0, 200)}` : undefined;
};

/**
 * The ignore files rg would read above `dir`: it reads `.ignore` and `.rgignore` in every parent directory up to the root, whatever
 * the repository (the `ignore` crate's `add_parents`), so one there would change what the corpus's queries see (review harness-m7d N4).
 */
export function ancestorIgnoreFiles(dir: string): string[] {
  const found: string[] = [];
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const f of [".ignore", ".rgignore"]) if (existsSync(join(d, f))) found.push(join(d, f));
    if (dirname(d) === d) break;
  }
  return found;
}

/** The first `rust-ts: unported: ...` line of a port's stderr, if any (difftest's `unportedOf` reads the same form). */
export const unportedLine = (stderr: string): string | undefined => /^rust-ts: unported: .*$/m.exec(stderr)?.[0];

/**
 * How a side's build ends for difftest (single mode compares the exit code too): the port's first `unported` stop as UNPORTED (70),
 * else a compiler that panicked (101) as a crash, else 0, with cargo's own exit code in the report.
 */
export function buildExit(calls: readonly { code: number; stderrText: string }[]): { code: number; unported?: string } {
  for (const c of calls) {
    const u = unportedLine(c.stderrText);
    if (u !== undefined) return { code: 70, unported: u };
  }
  return { code: calls.some((c) => c.code === 101) ? 101 : 0 };
}

// --- rg-behaviour -------------------------------------------------------------------------------------------------------------------

/** A file of the checked-in corpus: text, or bytes in base64 (a binary file, a Latin-1 file). */
export type CorpusFile = string | { base64: string };

/** One scripted query: rg's argv, and what its stdin holds (empty unless given). */
export interface RgQuery {
  id: string;
  args: string[];
  stdin?: string;
}

/** The corpus's bytes for one file. */
export const corpusBytes = (f: CorpusFile): Buffer => (typeof f === "string" ? Buffer.from(f, "utf8") : Buffer.from(f.base64, "base64"));

/**
 * What rg prints that changes from run to run, masked on both sides: `--json`'s `elapsed` and `elapsed_total` objects, whose three fields
 * come in either order (`{"secs":0,"nanos":51000,"human":"0.000051s"}` in an `end` message, `{"human":...,"nanos":...,"secs":0}` in the
 * `summary`), each as `"<time>"`, and `--stats`'s `<n> seconds` lines. Nothing else is masked.
 */
export function maskRgTimes(text: string): string {
  return text
    .replace(/"(elapsed(?:_total)?)":\{(?:"(?:secs|nanos|human)":(?:\d+|"[0-9.]+s"),?){3}\}/g, '"$1":"<time>"')
    .replace(/^\d+\.\d+ seconds/gm, "<time> seconds");
}

/** libtest's result line for one test, `test <name> ... ok|FAILED|ignored`, or undefined. */
export function libtestResult(line: string): { name: string; result: string } | undefined {
  const m = /^test (\S+) \.\.\. (ok|FAILED|ignored(?:, .*)?)$/.exec(line);
  return m ? { name: m[1]!, result: m[2]! } : undefined;
}

/** The sections of rg-behaviour-rgtest's report, one per test, sorted by name (the tests run on several threads). */
export function rgtestSections(stdout: string): string[] {
  const rs = stdout.split("\n").map(libtestResult).filter((r): r is { name: string; result: string } => r !== undefined);
  rs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rs.flatMap((r) => [`== ${r.name}`, `  ${r.result}`]);
}

/** A stamp of the built binary of one side: the key it was built for, and the outcome. */
export interface RgStamp {
  key: string;
  /** `ok`: the binary is beside the stamp. Otherwise why there is none (the port's stop line, or cargo's exit). */
  outcome: string;
  builtAt: string;
}
