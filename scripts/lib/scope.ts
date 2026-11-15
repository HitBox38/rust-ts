// Per-path scope inside an in-scope crate (lane scope-m7, plan-m7 D4): `harness/scope.json` `miri` (plan-m6 D2) and the
// entries of `harness/scope.json` `crates` (compiler crates) share one shape, a `PathScope`:
// - `root`: the crate's directory, upstream-relative (`src/tools/miri/src`, `compiler/<crate>`);
// - `excluded`: paths relative to `root` (a file, or a directory and everything under it) out of coverage, each with its reason;
// - `partial`: files relative to `root` of which only the listed fns are in scope.
// A compiler crate with no `crates` entry is a `PathScope` with nothing excluded. No import of common.ts (or of the lexer:
// the fn finder is passed in), so its tests run in-process.
// M8's tools (plan-m8 D1, D4; lane tools-prep-m8): `harness/scope.json` `tools.crates` names a coverage crate per entry, each a
// `PathScope` with its own `root` (`src/tools/clippy/clippy_lints/src`, ...), counted like Miri; `tools.excluded` lists the tools'
// upstream trees that are out (`src/tools/clippy/clippy_dev`, ...), each with its reason. A `// rustc:` marker into `src/tools/` must
// fall under Miri's root or a tool crate's root (`toolMarkerError`).
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
  tools?: { crates?: Record<string, unknown>; excluded?: Record<string, string> };
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

/** The tool crates of `harness/scope.json` `tools.crates` (keys other than `comment`), each with its `PathScope`; an entry without a string `root` is skipped (`toolsEntryErrors` names it). */
export function toolPathScopes(scope: ScopeJson): { crate: string; s: PathScope }[] {
  const out: { crate: string; s: PathScope }[] = [];
  for (const [crate, v] of Object.entries(scope.tools?.crates ?? {})) {
    if (crate === "comment") continue;
    const e = v as { root?: unknown; excluded?: Record<string, string>; partial?: Record<string, { fns: string[]; reason: string }> };
    if (typeof e.root === "string") out.push({ crate, s: { root: e.root, excluded: e.excluded ?? {}, partial: e.partial ?? {} } });
  }
  return out;
}

/** `harness/scope.json` `tools.excluded`: upstream-relative trees of the tools that are out of scope, with reasons. */
export const toolsExcluded = (scope: ScopeJson): Record<string, string> => Object.fromEntries(Object.entries(scope.tools?.excluded ?? {}).filter(([k]) => k !== "comment"));

/** The tool directory (`src/tools/<tool>`) of an upstream-relative path, or undefined. */
export const toolDirOf = (path: string): string | undefined => /^(src\/tools\/[^/]+)\//.exec(path)?.[1];

/**
 * The `harness/scope.json` `tools` entries that cannot be meant: a crate entry without a `root` under `src/tools/<tool>/`, one whose
 * name is Miri's or a compiler crate's (`compilerCrates`), two roots of which one contains the other, Miri's root inside a tool root;
 * an excluded path that is not relative-clean, has no reason, or overlaps a root. Paths that must exist are checked only when the
 * checkout at `root` has their tool directory (a sparse checkout without it reports nothing, as `scopeErrors`).
 */
export function toolsEntryErrors(scope: ScopeJson, root: string, compilerCrates: readonly string[]): string[] {
  const out: string[] = [];
  const clean = (p: string) => p !== "" && !p.startsWith("/") && !p.endsWith("/") && !p.split("/").includes("..") && toolDirOf(p) !== undefined;
  const under = (a: string, b: string) => a === b || a.startsWith(`${b}/`);
  for (const [crate, v] of Object.entries(scope.tools?.crates ?? {})) {
    if (crate === "comment") continue;
    const r = (v as { root?: unknown }).root;
    if (typeof r !== "string" || !clean(r)) out.push(`ERROR: harness/scope.json tools.crates.${crate}: root ${JSON.stringify(r)} is not a path under src/tools/<tool>/`);
    if (crate === "miri" || compilerCrates.includes(crate)) out.push(`ERROR: harness/scope.json tools.crates.${crate}: the name is Miri's or a compiler crate's`);
  }
  const ts = toolPathScopes(scope).filter((t) => clean(t.s.root));
  for (const a of ts) {
    for (const b of ts) if (a !== b && under(a.s.root, b.s.root)) out.push(`ERROR: harness/scope.json tools.crates.${a.crate}: root ${a.s.root} is inside tools.crates.${b.crate}'s ${b.s.root}`);
    const m = miriPathScope(scope);
    if (m && (under(m.root, a.s.root) || under(a.s.root, m.root))) out.push(`ERROR: harness/scope.json tools.crates.${a.crate}: root ${a.s.root} overlaps Miri's ${m.root}`);
    if (existsSync(join(root, toolDirOf(a.s.root)!)) && !existsSync(join(root, a.s.root))) out.push(`ERROR: harness/scope.json tools.crates.${a.crate}: root ${a.s.root}: no such directory`);
  }
  for (const [x, why] of Object.entries(toolsExcluded(scope))) {
    if (!clean(x)) out.push(`ERROR: harness/scope.json tools.excluded ${JSON.stringify(x)}: not a relative path under src/tools/<tool>/`);
    else if (existsSync(join(root, toolDirOf(x)!)) && !existsSync(join(root, x))) out.push(`ERROR: harness/scope.json tools.excluded ${x}: no such file or directory`);
    if (typeof why !== "string" || why.trim() === "") out.push(`ERROR: harness/scope.json tools.excluded ${x}: no reason`);
    for (const t of ts) if (under(x, t.s.root) || under(t.s.root, x)) out.push(`ERROR: harness/scope.json tools.excluded ${x}: overlaps tools.crates.${t.crate}'s root ${t.s.root}`);
  }
  return out;
}

/**
 * Why a `// rustc:` marker path under `src/tools/` names nothing in scope, or undefined if it does not need to: it is not under
 * `src/tools/`, or it is under Miri's root or a tool crate's root (whose fns `--check` then matches it against). `present`: whether
 * that root is in the checkout; a marker into a root the checkout lacks cannot be checked, so it is refused too (plan-m8 D21).
 */
export function toolMarkerError(scope: ScopeJson, path: string, present: (root: string) => boolean): string | undefined {
  if (toolDirOf(path) === undefined) return undefined;
  const m = miriPathScope(scope);
  if (m && path.startsWith(`${m.root}/`)) return undefined;
  const t = toolPathScopes(scope).find((t) => path.startsWith(`${t.s.root}/`));
  if (t) return present(t.s.root) ? undefined : `names tool crate ${t.crate}, whose root ${t.s.root} is not in the upstream checkout (run: bun scripts/upstream.ts fetch)`;
  const x = Object.keys(toolsExcluded(scope)).find((x) => path === x || path.startsWith(`${x}/`));
  if (x !== undefined) return `is out of scope (harness/scope.json tools.excluded ${x}: ${toolsExcluded(scope)[x]})`;
  return "is under no tool crate's root (harness/scope.json tools.crates) nor Miri's";
}

/**
 * The scope an upstream path falls under, with its label in `harness/scope.json`: Miri's, a tool crate's (`tools.crates.<crate>`), or
 * the compiler crate's (its `crates` entry, or nothing excluded). Undefined for paths outside all of them (vendor, library,
 * rustc_llvm's C++, the tools' trees out of scope).
 */
export function scopeOfPath(scope: ScopeJson, path: string): { s: PathScope; label: string } | undefined {
  const m = miriPathScope(scope);
  if (m && path.startsWith(`${m.root}/`)) return { s: m, label: "miri" };
  const t = toolPathScopes(scope).find((t) => path.startsWith(`${t.s.root}/`));
  if (t) return { s: t.s, label: `tools.crates.${t.crate}` };
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
