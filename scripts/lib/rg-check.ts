// The pure parts of scripts/rg-check.ts and scripts/rg-rustc.ts (lane harness-m7a). No imports beyond node:, so tests load it without
// scripts/lib/common.ts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface RgUnit {
  crate: string;
  code: number;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** The kept stderr file's name, in the log directory. */
  stderr: string;
}

/** The value after `flag`, or in `flag=value` form. */
export function argValue(args: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return args[i + 1];
    if (args[i]!.startsWith(`${flag}=`)) return args[i]!.slice(flag.length + 1);
  }
  return undefined;
}

/** What a rustc call is, for the routing in the header. */
export function classifyCall(args: readonly string[]): "probe" | "link" | "unit" {
  if (args.some((a) => a === "-vV" || a === "-" || a === "--print" || a.startsWith("--print="))) return "probe";
  return (argValue(args, "--emit") ?? "link").split(",").includes("link") ? "link" : "unit";
}

/** `-C metadata=<x>`'s value, which tells a crate's units apart. */
export function unitMetadata(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-Cmetadata=")) return a.slice("-Cmetadata=".length);
    if (a === "-C" && args[i + 1]?.startsWith("metadata=")) return args[i + 1]!.slice("metadata=".length);
  }
  return "none";
}

/** Every file under `dir`, as `<relative path>`, sorted. */
function walkFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out.push(relative(base, p));
  }
  return out.sort();
}

/** Not hashed: cargo's own lock, and a cache keyed by the wrapper's mtime. */
const TREE_UNHASHED = new Set([".cargo-lock", ".rustc_info.json"]);

/** A hash of every file of the tree but the ones that mean nothing (`TREE_UNHASHED`), with the count: paths, sizes, contents. */
export function treeLine(dir: string): string {
  const h = createHash("sha256");
  const files = existsSync(dir) ? walkFiles(dir).filter((f) => !TREE_UNHASHED.has(f.slice(f.lastIndexOf("/") + 1))) : [];
  for (const f of files) {
    const p = join(dir, f);
    h.update(`${f}\0${statSync(p).size}\0`).update(readFileSync(p));
  }
  return `tree ${files.length} files, sha256 ${h.digest("hex")}`;
}

export const sizeHash = (b: Uint8Array): string => `${b.length} bytes, sha256 ${createHash("sha256").update(b).digest("hex")}`;


/** The unit's `.rmeta`, as cargo asked for it: `--out-dir`, `lib<crate><-C extra-filename>.rmeta`. */
export function unitRmeta(u: Pick<RgUnit, "args" | "crate">): string | undefined {
  const dir = argValue(u.args, "--out-dir");
  if (dir === undefined) return undefined;
  let extra = "";
  for (let i = 0; i < u.args.length; i++) {
    const a = u.args[i]!;
    if (a.startsWith("-Cextra-filename=")) extra = a.slice("-Cextra-filename=".length);
    else if (a === "-C" && u.args[i + 1]?.startsWith("extra-filename=")) extra = u.args[i + 1]!.slice("extra-filename=".length);
  }
  return join(dir, `lib${u.crate}${extra}.rmeta`);
}

/** The first line that says why a unit failed: its `unported` line, else its first error. */
export function stopLine(stderr: string): string {
  const lines = stderr.split("\n");
  return (lines.find((l) => l.includes("unported")) ?? lines.find((l) => /\berror\b/.test(l)) ?? lines.find((l) => l.trim() !== "") ?? "(no stderr)").slice(0, 300);
}

/**
 * A unit's section key. A compile with no `-C metadata` is not cargo's: anyhow's build script runs one to probe the compiler, with
 * `--crate-name=anyhow`. It goes to the side's compiler like any unit, and is compared, but it is not one of ripgrep's crates.
 */
export const unitKey = (u: Pick<RgUnit, "crate" | "args">): string => (unitMetadata(u.args) === "none" ? `${u.crate} (a build script's probe)` : u.crate);

/** One unit's section lines (scripts/rg-check.ts has the format). `mir`: the MIR step's lines, for `rg`. */
export function crateSection(u: Pick<RgUnit, "crate" | "code" | "args">, rmeta: Uint8Array | undefined, stderr: Uint8Array, mir: string[] = []): string[] {
  return [
    `== ${unitKey(u)}`,
    `  exit ${u.code}`,
    `  rmeta ${rmeta === undefined ? "none" : sizeHash(rmeta)}`,
    `  stderr ${sizeHash(stderr)}`,
    ...(u.code !== 0 ? [`  stop ${stopLine(Buffer.from(stderr).toString("latin1"))}`] : []),
    ...mir,
  ];
}

/** The argv of the MIR step: the unit's, without what makes it a cargo compile, plus what asks for MIR. */
export function mirArgs(args: readonly string[], extra: readonly string[]): string[] {
  return [...args.filter((a) => !a.startsWith("--json=") && a !== "--error-format=json" && !a.startsWith("--emit=")), ...extra, "-Zunpretty=mir"];
}

/**
 * What cargo's environment must say on both sides, whatever the caller's says. `CARGO_INCREMENTAL=0`: plan-m7 D11. `GIT_CEILING_DIRECTORIES`: ripgrep's build.rs
 * asks `git rev-parse` for a hash, puts it in `RIPGREP_BUILD_GIT_HASH`, and so in `rg`'s MIR and the tree. $RUST_TS_DATA sits inside this repository, so
 * without this the hash is this repository's HEAD, and each commit made the cached oracle a false difference with the next subject.
 */
export const rgCargoEnv = (root: string, cargoHome: string): Record<string, string> => ({ CARGO_HOME: cargoHome, CARGO_INCREMENTAL: "0", GIT_CEILING_DIRECTORIES: root });
