// The pure parts of the project-build harness (scripts/cargo-project-build.ts and its `RUSTC`, scripts/cargo-project-build-rustc.ts;
// plan-m8 D8, D15; lanes harness-m7d, harness-m8a-build): a real `cargo build` of a pinned project with every compiler call on the side's
// compiler, as the suites `rg-build` (ripgrep) and `cargo-build` (cargo) run it. No imports beyond node:, so tests load it without
// scripts/lib/common.ts. Every suite of the harness keys this file (scripts/cargo-project-build.ts `PROJECT_BUILD_SOURCES`), so what only
// one suite needs lives elsewhere (cargo-smoke's normalisation: scripts/lib/cargo-smoke.ts; review harness-m8a-build N1).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join, relative } from "node:path";

/** One compiler call cargo made, as scripts/cargo-project-build-rustc.ts records it. */
export interface BuildCall {
  crate: string;
  /** `-C metadata`'s value, or `none` (a probe, or a build script's own probe of the compiler). */
  metadata: string;
  kind: "probe" | "compile";
  code: number;
  /**
   * The signal the compiler was killed by, if it was (harness-m7d re-check note 4): its `code` is then 101 for cargo, but the build is
   * treated as interrupted, so a compiler the kernel killed under memory pressure leaves no stamp. Absent in a call that exited.
   */
  signal?: string;
  args: string[];
  /** The kept stderr file's name, in the log directory. */
  stderr: string;
  /** The size and SHA-256 of what the call printed on stdout: the answer cargo reads from a probe (review harness-m7d N3). */
  stdout: string;
}

/** A call that asks the compiler about itself (cargo's `-vV` and `--print`, a build script's `--version`), or a compile. */
export function callKind(args: readonly string[]): BuildCall["kind"] {
  return args.some((a) => a === "-vV" || a === "-V" || a === "--version" || a === "--print" || a.startsWith("--print=")) ? "probe" : "compile";
}

export const sizeHash = (b: Uint8Array): string => `${b.length} bytes, sha256 ${createHash("sha256").update(b).digest("hex")}`;

/** cargo's elapsed time at the end of its `Finished` line: `in 42.13s`, `in 1m 02s`, `in 1h 03m 04s`. */
export const CARGO_TIME = / in (?:\d+h )?(?:\d+m )?\d+(?:\.\d+)?s$/;

/** cargo's line for a unit it starts, `   Compiling <package> v<version>` (a build script and its crate both show it). */
const COMPILING = /^\s*Compiling \S+ v\S+/;

/** Each `root` (`[path, name]`) of `line` replaced by its name, longest path first. */
export function nameRoots(line: string, roots: readonly [string, string][]): string {
  let l = line;
  for (const [path, name] of [...roots].sort((a, b) => b[0].length - a[0].length)) l = l.replaceAll(path, name);
  return l;
}

/**
 * cargo's stderr as a project build compares it: each `root` (`[path, name]`, longest first) replaced by its name, the elapsed time of
 * the `Finished` line replaced by `in <time>`, `\r\n` as `\n`, and the `Compiling` lines taken out and listed first, sorted, with their
 * count. Their order is the order cargo starts units in, which varies from run to run even at `-j1` (seen: two oracle runs swapped
 * `serde` and `termcolor`). Every other line keeps its place: a compiler's diagnostics are compared as they are.
 */
export function normaliseCargoStderr(text: string, roots: readonly [string, string][]): string[] {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => {
      const l = nameRoots(line, roots);
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
 * The `-sys` crates' build-script outputs, as text (plan-m8 D15's recorded check): for each `build/<package>-sys/<hash>/run/stdout` (and
 * the older layout's `build/<package>-sys-<hash>/output`) of a profile directory, its `cargo:` lines (link lines, `cfg`s, and the
 * `cargo:KEY=VALUE` metadata cargo hands dependants as `DEP_*`) with each `root` named, but not its `rerun-if-*` lines, which name what
 * it watches rather than what it found. A host change that leaks into the build (a Homebrew OpenSSL, a `pkg-config`) shows here by name,
 * on both sides' rebuild; `artifactLines` already compares these files' bytes.
 */
export function sysBuildScriptLines(profileDir: string, roots: readonly [string, string][]): string[] {
  const outs = walkFiles(join(profileDir, "build")).filter((f) => /^[^/]+-sys\/[^/]+\/run\/stdout$/.test(f) || /^[^/]+-sys-[^/]+\/output$/.test(f));
  const lines = ["-sys build scripts:"];
  for (const f of outs) {
    const text = readFileSync(join(profileDir, "build", f), "latin1");
    const kept = text
      .replaceAll("\r\n", "\n")
      .split("\n")
      .filter((l) => /^cargo::?/.test(l) && !/^cargo::?rerun-if-/.test(l))
      .map((l) => `    ${nameRoots(l, roots)}`);
    lines.push(`  ${f.replace(/\/run\/stdout$|\/output$/, "")}: ${kept.length} lines`, ...kept);
  }
  return lines;
}

/**
 * `otool -L <binary>`'s dylibs (plan-m8 D15): every line after the first (which names the binary), trimmed, each `root` named. A
 * binary that links a dylib outside the OS (a Homebrew OpenSSL or libgit2) shows here.
 */
export function otoolLines(text: string, roots: readonly [string, string][]): string[] {
  const deps = text.replaceAll("\r\n", "\n").split("\n").slice(1).map((l) => l.trim()).filter((l) => l !== "");
  return deps.map((l) => `  ${nameRoots(l, roots)}`);
}

/**
 * Why a built `PATH` (plan-m8 D15) must not be used, or undefined: it must hold no `pkg-config` (which would switch `libgit2-sys` and
 * `libz-sys` to whatever it finds), and no `curl-config` but the OS's `/usr/bin/curl-config` (curl-sys asks the first one on `PATH`).
 */
export function builtPathRefusal(dirs: readonly string[], exists: (p: string) => boolean): string | undefined {
  const bad: string[] = [];
  for (const d of dirs) {
    if (exists(join(d, "pkg-config"))) bad.push(join(d, "pkg-config"));
    if (d !== "/usr/bin" && exists(join(d, "curl-config"))) bad.push(join(d, "curl-config"));
  }
  return bad.length ? `the built PATH (${dirs.join(":")}) has ${bad.join(", ")}: a -sys build script would use the host's library instead of the pinned one (plan-m8 D15)` : undefined;
}

/**
 * The cargo config files a cargo run in `dir` would read that are not part of a pinned source (review harness-m8a-build N5): cargo
 * reads `.cargo/config.toml` and `.cargo/config` in `dir` and in every directory above it, and `config.toml` (or `config`) in
 * `CARGO_HOME`. `dir`'s own `.cargo` belongs to the source tree, so only its parents and `cargoHome` are listed.
 */
export function cargoConfigsAbove(dir: string, cargoHome: string, exists: (p: string) => boolean): string[] {
  const found: string[] = [];
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const f of ["config.toml", "config"]) if (exists(join(d, ".cargo", f))) found.push(join(d, ".cargo", f));
    if (dirname(d) === d) break;
  }
  for (const f of ["config.toml", "config"]) if (exists(join(cargoHome, f))) found.push(join(cargoHome, f));
  return found;
}

/**
 * The pids of the processes whose **environment** holds `mark` as one whole entry (harness-m7d re-check note 1, w40t-audit N6), from two
 * listings of the same moment: `withEnv`, `ps -axwwE -o pid=,command=` (argv, then the environment), and `plain`, the same without `-E`
 * (argv only). The argv a line starts with is cut off before matching, so a process that only names the mark in its argv, as a
 * platform binary's whole line is, is never matched; an entry must start at a space and end at a space or the line's end, and the mark
 * carries a per-build nonce (`<var>=<tree>#<nonce>`), so another variable's value holds it only if copied from a live build. A pid whose
 * plain line is not a prefix of its `-E` line (it exec'd between the listings) is `unsure`: the caller lists again. `self` is never matched.
 */
export function markedPids(withEnv: string, plain: string, mark: string, self: number): { pids: number[]; unsure: number[] } {
  const argv = new Map<number, string>();
  for (const line of plain.split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (m) argv.set(Number(m[1]), m[2]!);
  }
  const pids: number[] = [];
  const unsure: number[] = [];
  for (const line of withEnv.split("\n")) {
    const m = /^\s*(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === self || !m[2]!.includes(mark)) continue;
    const a = argv.get(pid);
    if (a === undefined || !m[2]!.startsWith(a)) {
      unsure.push(pid);
      continue;
    }
    if (` ${m[2]!.slice(a.length)} `.includes(` ${mark} `)) pids.push(pid);
  }
  return { pids, unsure };
}

/** A signal's number (`SIGHUP` 1, `SIGTERM` 15, ...), for the exit code `128 + n` of an interrupted run (harness-m7d re-check note 6). */
export const signalNumber = (sig: string): number => (constants.signals as Record<string, number>)[sig] ?? 0;

/**
 * A call's line in the report: what kind, which crate and unit, how it ended, and the size and hash of its stdout (a probe's answer) and
 * stderr. Sorted by the caller, so cargo's order does not matter.
 */
export const callLine = (c: Pick<BuildCall, "crate" | "metadata" | "kind" | "code" | "stdout">, stderr: Uint8Array): string =>
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

/** The same for the cargo suites (`cargo-build`, `cargo-smoke`): the oracle's build made no `cargo`, was interrupted, refused or stopped. */
export const CARGO_NO_RESULT_MARK = "cargo-harness: no result: ";
export const cargoNoResultReason = (stderr: string): string | undefined => {
  const m = /^cargo-harness: no result: (.*)$/m.exec(stderr);
  return m ? `detected: the cargo harness had no result: ${m[1]!.slice(0, 200)}` : undefined;
};

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

/** A stamp of the built binary of one side: the key it was built for, and the outcome. */
export interface BinStamp {
  key: string;
  /** `ok`: the binary is beside the stamp. Otherwise why there is none (the port's stop line, or cargo's exit). */
  outcome: string;
  builtAt: string;
}
