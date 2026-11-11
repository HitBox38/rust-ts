// Per-path scope inside an in-scope crate (lane scope-m7, plan-m7 D4): `harness/scope.json` `miri` (plan-m6 D2) and the
// entries of `harness/scope.json` `crates` (compiler crates) share one shape, a `PathScope`:
// - `root`: the crate's directory, upstream-relative (`src/tools/miri/src`, `compiler/<crate>`);
// - `excluded`: paths relative to `root` (a file, or a directory and everything under it) out of coverage, each with its reason;
// - `partial`: files relative to `root` of which only the listed fns are in scope.
// A compiler crate with no `crates` entry is a `PathScope` with nothing excluded. No import of common.ts (or of the lexer:
// the fn finder is passed in), so its tests run in-process.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ScopeFn {
  path: string;
  line: number;
  name: string;
}

export interface PathScope {
  /** Upstream-relative directory the paths below are relative to. */
  root: string;
  excluded: Record<string, string>;
  partial: Record<string, { fns: string[]; reason: string }>;
}

/** The parts of `harness/scope.json` read here. */
export interface ScopeJson {
  excluded: Record<string, string>;
  miri?: { root?: unknown; excluded?: Record<string, string>; partial?: Record<string, { fns: string[]; reason: string }> };
  crates?: Record<string, unknown>;
}

/** `harness/scope.json` `miri` as a `PathScope`, or undefined if it has none. */
export function miriPathScope(scope: ScopeJson): PathScope | undefined {
  const m = scope.miri;
  return m && typeof m.root === "string" ? { root: m.root, excluded: m.excluded ?? {}, partial: m.partial ?? {} } : undefined;
}

/** The `PathScope` of compiler crate `crate`: its `harness/scope.json` `crates` entry, or nothing excluded. */
export function cratePathScope(scope: ScopeJson, crate: string): PathScope {
  const e = (scope.crates?.[crate] ?? {}) as { excluded?: Record<string, string>; partial?: Record<string, { fns: string[]; reason: string }> };
  return { root: `compiler/${crate}`, excluded: e.excluded ?? {}, partial: e.partial ?? {} };
}

/** The crate names of `harness/scope.json` `crates` (keys other than `comment`). */
export const scopedCrates = (scope: ScopeJson): string[] => Object.keys(scope.crates ?? {}).filter((k) => k !== "comment");

/**
 * The scope an upstream path falls under, with its label in `harness/scope.json`: Miri's, or the compiler crate's (its `crates`
 * entry, or nothing excluded). Undefined for paths outside both (vendor, library, rustc_llvm's C++).
 */
export function scopeOfPath(scope: ScopeJson, path: string): { s: PathScope; label: string } | undefined {
  const m = miriPathScope(scope);
  if (m && path.startsWith(`${m.root}/`)) return { s: m, label: "miri" };
  const c = /^compiler\/([^/]+)\//.exec(path)?.[1];
  return c === undefined ? undefined : { s: cratePathScope(scope, c), label: `crates.${c}` };
}

/** The excluded path of `s` that `rel` (relative to `s.root`) is under, or undefined if it is in scope. */
export const pathExcluded = (s: PathScope, rel: string): string | undefined => Object.keys(s.excluded).find((x) => rel === x || rel.startsWith(`${x}/`));

/** The excluded path of `s` that upstream-relative `path` is under, or undefined (also when `path` is not under `s.root`). */
export const upstreamPathExcluded = (s: PathScope, path: string): string | undefined => (path.startsWith(`${s.root}/`) ? pathExcluded(s, path.slice(s.root.length + 1)) : undefined);

/** The `partial` entry of upstream-relative `path`, if any. */
export const pathPartial = (s: PathScope, path: string): { fns: string[]; reason: string } | undefined => (path.startsWith(`${s.root}/`) ? s.partial[path.slice(s.root.length + 1)] : undefined);

function walkRs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkRs(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

/**
 * Every `.rs` under `s.root` (`all`) and the in-scope ones (`files`), as sorted upstream-relative paths; empty if `root`
 * has no `s.root` (a sparse checkout without it).
 */
export function scopeFiles(s: PathScope, root: string): { all: string[]; files: string[] } {
  const dir = join(root, s.root);
  if (!existsSync(dir)) return { all: [], files: [] };
  const all = walkRs(dir)
    .map((f) => relative(root, f).replaceAll("\\", "/"))
    .sort();
  return { all, files: all.filter((f) => pathExcluded(s, f.slice(s.root.length + 1)) === undefined) };
}

/** The in-scope fns of the file at upstream-relative `path`: all of `fnsOf(path)`, or only the listed ones of a `partial` file. */
export function scopeFns<F extends ScopeFn>(s: PathScope, path: string, fnsOf: (path: string) => F[]): F[] {
  const fns = fnsOf(path);
  const part = pathPartial(s, path);
  return part ? fns.filter((f) => part.fns.includes(f.name)) : fns;
}

/**
 * One `ERROR:` line per entry of `s` that names nothing in the checkout at `root` (a typo would otherwise exclude nothing,
 * or a partial file nothing but what it lists): an excluded or partial path that does not exist, a partial fn the file does not
 * have, a partial file under an excluded path, an entry with no reason. `label` names the scope (`miri`, `crates.<crate>`).
 * Nothing is checked when `root` has no `s.root` (the sparse checkout before it was added).
 */
export function scopeErrors(s: PathScope, root: string, label: string, fnsOf: (path: string) => ScopeFn[]): string[] {
  const dir = join(root, s.root);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const [x, why] of Object.entries(s.excluded)) {
    if (x === "" || x.startsWith("/") || x.endsWith("/") || x.split("/").includes("..")) out.push(`ERROR: harness/scope.json ${label}.excluded ${JSON.stringify(x)}: not a relative path under ${s.root}`);
    else if (!existsSync(join(dir, x))) out.push(`ERROR: harness/scope.json ${label}.excluded ${x}: no such file or directory under ${s.root}`);
    else if (statSync(join(dir, x)).isFile() && !x.endsWith(".rs")) out.push(`ERROR: harness/scope.json ${label}.excluded ${x}: not a .rs file or a directory`);
    if (typeof why !== "string" || why.trim() === "") out.push(`ERROR: harness/scope.json ${label}.excluded ${x}: no reason`);
  }
  for (const [p, part] of Object.entries(s.partial)) {
    if (!p.endsWith(".rs") || !existsSync(join(dir, p)) || !statSync(join(dir, p)).isFile()) {
      out.push(`ERROR: harness/scope.json ${label}.partial ${p}: no such .rs file under ${s.root}`);
      continue;
    }
    if (pathExcluded(s, p) !== undefined) out.push(`ERROR: harness/scope.json ${label}.partial ${p}: under excluded ${pathExcluded(s, p)}`);
    if (typeof part.reason !== "string" || part.reason.trim() === "") out.push(`ERROR: harness/scope.json ${label}.partial ${p}: no reason`);
    const names = new Set(fnsOf(`${s.root}/${p}`).map((f) => f.name));
    for (const f of part.fns ?? []) if (!names.has(f)) out.push(`ERROR: harness/scope.json ${label}.partial ${p}: no fn ${f} in the file`);
    if (!part.fns?.length) out.push(`ERROR: harness/scope.json ${label}.partial ${p}: lists no fns`);
  }
  return out;
}

/**
 * The `harness/scope.json` `crates` entries that cannot be meant: a crate the checkout's `compiler/` does not have, or one that
 * `excluded` takes out whole (its paths would count for nothing).
 */
export function cratesEntryErrors(scope: ScopeJson, compilerCrates: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of scopedCrates(scope)) {
    if (c in scope.excluded) out.push(`ERROR: harness/scope.json crates.${c}: the crate is in excluded`);
    else if (!compilerCrates.includes(c)) out.push(`ERROR: harness/scope.json crates.${c}: no compiler crate of that name in the checkout`);
  }
  return out;
}
