// Port coverage: every upstream `fn` in in-scope crates vs `// rustc: <path>:<line> <name>`
// markers in src/ (the compiler crates, plus Miri as crate `miri`: `harness/scope.json` `miri`, plan-m6 D2), and every
// `fn` in the vendored external crates (`harness/scope.json` `vendor`,
// sources from scripts/crate-src.ts) vs `// crate: <crate>-<ver>/<path>:<line> <name>` markers.
// Functions are found with our own rustc_lexer port, so `fn` inside comments/strings is never
// counted. `// rustc-skip:` / `// crate-skip:` markers count as covered.
// Ported Rust library code (`src/std/`, `src/proc_macro/`, ...) carries `// std: library/<crate>/src/<path>:<line> <name>`
// markers, `// std-skip: ... <reason>` for fns deliberately not ported (decision 2026-10-31; the library/ counterparts of
// rustc / rustc-skip): they count as covered for `--missing library/...`, `--check` validates them, and the full run
// adds a `library` table over the library files that have at least one marker (most of std/core is not ported and
// never will be file by file, so whole crates would only be noise). The library table is not part of the compiler TOTAL.
//
//   bun scripts/coverage.ts                 per-crate table, compiler then vendor (+ writes $RUST_TS_DATA/coverage.json)
//   bun scripts/coverage.ts --crate C       per-file table for one crate (compiler crate, `miri`, vendor `<crate>` / `<crate>-<ver>`,
//                                           or `library/<crate>`: its files with std markers)
//   bun scripts/coverage.ts --missing PATH  unported functions in one upstream file (`compiler/...`, `src/tools/miri/src/...`,
//                                           `library/...` or `<crate>-<ver>/<path>`)
//   bun scripts/coverage.ts --check         ERROR on markers that point at no upstream / crate / library fn, and on stale
//                                           `// rustc-call:` anchors and `// rustc-const:` markers (scripts/lib/marker-check.ts)
//   bun scripts/coverage.ts --order         report only: markers out of upstream's order, per TS file and upstream file
//                                           (the rows go to $RUST_TS_DATA/coverage-order.txt; PORTING section 8 allows some)
//   --order --require-clean PREFIX          also an ERROR line, and exit 1, for each row of a TS file under PREFIX (a tree with
//                                           no inversions, which must stay so: the gate checks src/rustc_monomorphize/)
//   --offline                               fetch missing vendor crate sources only from cargo's local cache
// Vendor crate sources are resolved lazily: only the crates a mode actually reads (none for a
// compiler `--missing` / `--crate`; for `--check`, only crates that have markers).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../src/rustc_lexer/lib.ts";
import { Str } from "../src/std/str.ts";
import { crateSrc } from "./crate-src.ts";
import { DATA, REPO, UPSTREAM, die, parseArgs, requireUpstream } from "./lib/common.ts";
import { anchorErrors, orderErrors, orderRows } from "./lib/marker-check.ts";

export interface UpstreamFn {
  path: string;
  line: number;
  name: string;
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Every `fn <name>` in `<root>/<relPath>`; `path` of each result is `relPath`. */
export function upstreamFns(relPath: string, root: string = UPSTREAM): UpstreamFn[] {
  const bytes = readFileSync(join(root, relPath));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const fns: UpstreamFn[] = [];
  let pos = strip_shebang(src) ?? 0;
  let line = 1;
  for (let i = 0; i < pos; i++) if (src.byte(i) === 0x0a) line++;
  const sig: { kind: string; text: string; line: number }[] = [];
  for (const tok of tokenize(src.slice(pos), FrontmatterAllowed.Yes)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      const text = k === "Ident" || k === "RawIdent" ? src.slice(pos, pos + tok.len).toString() : "";
      sig.push({ kind: k, text, line });
      const n = sig.length;
      if (n >= 2 && sig[n - 2]!.kind === "Ident" && sig[n - 2]!.text === "fn" && (k === "Ident" || k === "RawIdent")) {
        fns.push({ path: relPath, line: sig[n - 2]!.line, name: text });
      }
      if (n > 4) sig.shift();
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  return fns;
}

export interface Marker {
  file: string;
  path: string;
  line: number;
  name: string;
}

export function markers(): Marker[] {
  const out: Marker[] = [];
  // `// rustc-skip: <path>:<line> <name> <reason>` marks a fn deliberately not ported; it counts as covered.
  const re = /\/\/ rustc(?:-skip)?: (\S+):(\d+) (\S+)/g;
  for (const f of walk(join(REPO, "src"), ".ts")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) out.push({ file: relative(REPO, f).replaceAll("\\", "/"), path: m[1]!, line: Number(m[2]), name: m[3]! });
  }
  return out;
}

/**
 * `// std: library/<crate>/src/<path>:<line> <name>` and `// std-skip: ... <reason>` markers (ported Rust library
 * code; see the header).
 */
export function stdMarkers(): (Marker & { skip: boolean })[] {
  const out: (Marker & { skip: boolean })[] = [];
  const re = /\/\/ std(-skip)?: (\S+):(\d+) (\S+)/g;
  for (const f of walk(join(REPO, "src"), ".ts")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) {
      out.push({ file: relative(REPO, f).replaceAll("\\", "/"), path: m[2]!, line: Number(m[3]), name: m[4]!, skip: m[1] !== undefined });
    }
  }
  return out;
}

/**
 * Whether `--check` fails on an invalid std marker (lane harness-w36). On: the 3 markers that predated the check named
 * their fn qualified (`<Path as Hash>::hash`) on the right lines; root renamed them to the bare fn name at integ-w36.
 */
const STD_MARKERS_STRICT = true;

/** The library crate (`library/<crate>`) of a std marker path, or undefined if it is not under `library/<crate>/`. */
export const libraryCrateOf = (path: string): string | undefined => /^(library\/[^/]+)\//.exec(path)?.[1];

/** `// crate: <crate>-<ver>/<path>:<line> <name>` and `// crate-skip: ... <reason>` markers; `path` is `<crate>-<ver>/<path>`. */
export function vendorMarkers(): (Marker & { skip: boolean })[] {
  const out: (Marker & { skip: boolean })[] = [];
  const re = /\/\/ crate(-skip)?: (\S+):(\d+) (\S+)/g;
  for (const f of walk(join(REPO, "src"), ".ts")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) {
      out.push({ file: relative(REPO, f).replaceAll("\\", "/"), path: m[2]!, line: Number(m[3]), name: m[4]!, skip: m[1] !== undefined });
    }
  }
  return out;
}

export interface VendorEntry {
  name: string;
  version: string;
  /** `<name>-<version>`: the first path segment of its markers. */
  id: string;
}

export interface VendorCrate extends VendorEntry {
  /** The unpacked crate source (`<registry>/<id>`). */
  dir: string;
}

/** The vendored crates of `harness/scope.json` `vendor` (exact `=` versions), without resolving sources. */
export function vendorEntries(): VendorEntry[] {
  const scope = JSON.parse(readFileSync(join(REPO, "harness", "scope.json"), "utf8"));
  const out: VendorEntry[] = [];
  for (const [name, spec] of Object.entries((scope.vendor ?? {}) as Record<string, string>)) {
    if (!/^=[^=]+$/.test(spec)) die(`harness/scope.json vendor ${name}: version ${JSON.stringify(spec)} is not an exact \`=\` version`);
    const version = spec.slice(1);
    out.push({ name, version, id: `${name}-${version}` });
  }
  return out;
}

/** One vendored crate with its source directory (fetched with cargo if it is not unpacked yet). */
export async function resolveVendor(v: VendorEntry, opts: { offline?: boolean } = {}): Promise<VendorCrate> {
  return { ...v, dir: await crateSrc(v.name, v.version, opts) };
}

/** The vendored crates of `harness/scope.json` `vendor` (exact `=` versions), with their sources. */
export async function vendorCrates(opts: { offline?: boolean } = {}): Promise<VendorCrate[]> {
  const out: VendorCrate[] = [];
  for (const v of vendorEntries()) out.push(await resolveVendor(v, opts));
  return out;
}

/** Every `.rs` file of a vendored crate, as sorted `<crate>-<ver>/<path>` marker paths. */
function vendorFiles(v: VendorCrate): string[] {
  return walk(v.dir, ".rs")
    .map((f) => relative(dirname(v.dir), f).replaceAll("\\", "/"))
    .sort();
}

export function inScopeCrates(): string[] {
  const scope = JSON.parse(readFileSync(join(REPO, "harness", "scope.json"), "utf8"));
  return readdirSync(join(UPSTREAM, "compiler")).filter((c) => !(c in scope.excluded));
}

/** The coverage crate name of Miri (plan-m6 D2). */
export const MIRI_CRATE = "miri";

/** `harness/scope.json` `miri`: its source root (upstream-relative), excluded paths, and partially in-scope files. */
export interface MiriScope {
  root: string;
  excluded: Record<string, string>;
  partial: Record<string, { fns: string[]; reason: string }>;
}

export function miriScope(): MiriScope | undefined {
  const scope = JSON.parse(readFileSync(join(REPO, "harness", "scope.json"), "utf8"));
  const m = scope.miri as MiriScope | undefined;
  return m && typeof m.root === "string" ? { root: m.root, excluded: m.excluded ?? {}, partial: m.partial ?? {} } : undefined;
}

/** Whether `rel` (relative to Miri's root) is under an excluded path (a file, or a directory and everything in it). */
export const miriExcluded = (m: MiriScope, rel: string): string | undefined => Object.keys(m.excluded).find((x) => rel === x || rel.startsWith(`${x}/`));

/**
 * Every `.rs` under Miri's root (`all`) and the in-scope ones (`files`), as sorted upstream-relative paths; empty if the
 * checkout has no Miri sources (the sparse checkout before src/tools/miri/src was added).
 */
export function miriFiles(m: MiriScope, root: string = UPSTREAM): { all: string[]; files: string[] } {
  const dir = join(root, m.root);
  if (!existsSync(dir)) return { all: [], files: [] };
  const all = walk(dir, ".rs")
    .map((f) => relative(root, f).replaceAll("\\", "/"))
    .sort();
  return { all, files: all.filter((f) => miriExcluded(m, f.slice(m.root.length + 1)) === undefined) };
}

/** The in-scope fns of a Miri file: all of them, or only the listed ones of a `partial` file. */
export function miriFns(m: MiriScope, path: string, root: string = UPSTREAM): UpstreamFn[] {
  const fns = upstreamFns(path, root);
  const part = m.partial[path.slice(m.root.length + 1)];
  return part ? fns.filter((f) => part.fns.includes(f.name)) : fns;
}

if (import.meta.main) {
  requireUpstream();
  const a = parseArgs(process.argv.slice(2));
  const ms = markers();
  const vms = vendorMarkers();
  const sms = stdMarkers();
  const key = (p: string, l: number) => `${p}:${l}`;
  const marked = new Map(ms.map((m) => [key(m.path, m.line), m]));
  const smarked = new Map(sms.map((m) => [key(m.path, m.line), m]));
  const vmarked = new Map(vms.map((m) => [key(m.path, m.line), m]));
  const offline = a.offline === true;
  const vendor = vendorEntries();
  const vendorOf = (path: string) => vendor.find((v) => path.startsWith(`${v.id}/`));

  if (a.order) {
    const rows = orderRows(ms);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
    writeFileSync(join(DATA, "coverage-order.txt"), rows.map((r) => `${r.file} ${r.path}: ${r.outOfOrder} out of order of ${r.markers}, ${r.descents} descents; first ${r.first}\n`).join(""));
    console.log(`order (report only): ${sum((r) => r.outOfOrder)} markers out of order of ${ms.length}, ${sum((r) => r.descents)} descents, in ${rows.length} file pairs (rows: ${join(DATA, "coverage-order.txt")})`);
    const clean = a["require-clean"];
    if (clean !== undefined) {
      const errors = orderErrors(rows, typeof clean === "string" ? clean : "");
      for (const e of errors) console.log(e);
      if (errors.length) process.exit(1);
      console.log(`order: no inversions under ${clean}`);
    }
    process.exit(0);
  }

  const ms_ = miriScope();
  if (typeof a.missing === "string") {
    const ve = vendorOf(a.missing);
    const v = ve ? await resolveVendor(ve, { offline }) : undefined;
    const inMiri = ms_ !== undefined && a.missing.startsWith(`${ms_.root}/`);
    if (inMiri && miriExcluded(ms_, a.missing.slice(ms_.root.length + 1)) !== undefined) {
      const x = miriExcluded(ms_, a.missing.slice(ms_.root.length + 1))!;
      console.log(`note: ${a.missing} is out of scope (harness/scope.json miri.excluded ${x}: ${ms_.excluded[x]})`);
    }
    const part = inMiri ? ms_.partial[a.missing.slice(ms_.root.length + 1)] : undefined;
    if (part) console.log(`note: only ${part.fns.join(", ")} of ${a.missing} are in scope (harness/scope.json miri.partial: ${part.reason})`);
    const fns = v ? upstreamFns(a.missing, dirname(v.dir)) : inMiri ? miriFns(ms_, a.missing) : upstreamFns(a.missing);
    const inLibrary = !v && a.missing.startsWith("library/");
    const miss = fns.filter((f) => !(v ? vmarked : inLibrary ? smarked : marked).has(key(f.path, f.line)));
    for (const f of miss) console.log(`${f.path}:${f.line} ${f.name}`);
    console.log(`${fns.length - miss.length}/${fns.length} ported`);
    process.exit(0);
  }

  // Library files with std markers (see the header): `library/<crate>` -> files -> fns.
  const libSel = typeof a.crate === "string" ? (a.crate.startsWith("library/") ? a.crate : undefined) : "";
  const lall = new Map<string, UpstreamFn>();
  const lrows: { crate: string; total: number; ported: number; skipped: number; files: { path: string; total: number; ported: number }[] }[] = [];
  const lmissing: (Marker & { skip: boolean })[] = [];
  if (libSel !== undefined || a.check) {
    const byCrate = new Map<string, Set<string>>();
    for (const m of sms) {
      const c = libraryCrateOf(m.path);
      if (c === undefined || !existsSync(join(UPSTREAM, m.path))) {
        lmissing.push(m);
        continue;
      }
      if (libSel && c !== libSel && !a.check) continue;
      if (!byCrate.has(c)) byCrate.set(c, new Set());
      byCrate.get(c)!.add(m.path);
    }
    for (const c of [...byCrate.keys()].sort()) {
      const row = { crate: c, total: 0, ported: 0, skipped: 0, files: [] as { path: string; total: number; ported: number }[] };
      for (const f of [...byCrate.get(c)!].sort()) {
        const fns = upstreamFns(f);
        for (const fn of fns) lall.set(key(fn.path, fn.line), fn);
        const covered = fns.map((fn) => smarked.get(key(fn.path, fn.line))).filter((m) => m !== undefined);
        row.total += fns.length;
        row.ported += covered.length;
        row.skipped += covered.filter((m) => m.skip).length;
        row.files.push({ path: f, total: fns.length, ported: covered.length });
      }
      if (!libSel || c === libSel) lrows.push(row);
    }
  }
  if (libSel) {
    const r = lrows[0];
    if (!r) die(`no // std: markers in ${libSel}`);
    for (const f of r.files) console.log(`${String(f.ported).padStart(5)}/${String(f.total).padEnd(5)} ${f.path}`);
    console.log(`TOTAL ${r.ported}/${r.total} fns covered (${r.total ? ((100 * r.ported) / r.total).toFixed(2) : "0.00"}%) in the marked files of ${r.crate} (${r.skipped} std-skip)`);
    process.exit(0);
  }

  // `--crate` names either a compiler crate or a vendored one (`<crate>` or `<crate>-<ver>`).
  const vselEntries = typeof a.crate === "string" ? vendor.filter((v) => v.id === a.crate || v.name === a.crate) : vendor;
  // `--check` only needs the sources of crates that have markers; the tables need all selected ones.
  const vneeded = a.check ? vselEntries.filter((v) => vms.some((m) => m.path.startsWith(`${v.id}/`))) : vselEntries;
  const vsel: VendorCrate[] = [];
  for (const v of vneeded) vsel.push(await resolveVendor(v, { offline }));
  const crates = typeof a.crate === "string" ? (vsel.length || a.crate === MIRI_CRATE ? [] : [a.crate]) : inScopeCrates();
  const all = new Map<string, UpstreamFn>();
  const rows: { crate: string; total: number; ported: number; files: { path: string; total: number; ported: number }[] }[] = [];
  for (const c of crates) {
    const files = walk(join(UPSTREAM, "compiler", c), ".rs").map((f) => relative(UPSTREAM, f).replaceAll("\\", "/"));
    const row = { crate: c, total: 0, ported: 0, files: [] as { path: string; total: number; ported: number }[] };
    for (const f of files.sort()) {
      const fns = upstreamFns(f);
      for (const fn of fns) all.set(key(fn.path, fn.line), fn);
      const ported = fns.filter((fn) => marked.has(key(fn.path, fn.line))).length;
      row.total += fns.length;
      row.ported += ported;
      row.files.push({ path: f, total: fns.length, ported });
    }
    rows.push(row);
  }
  // Miri (plan-m6 D2): one crate row over its in-scope files and fns (`miriFiles`, `miriFns`). `--check` validates its
  // markers against every fn under its root, in scope or not.
  const miri = ms_ && (typeof a.crate !== "string" || a.crate === MIRI_CRATE) ? miriFiles(ms_) : undefined;
  if (ms_ && miri) {
    if (miri.all.length === 0) console.log(`note: no Miri sources in the upstream checkout (${ms_.root}); run: bun scripts/upstream.ts fetch`);
    else {
      const row = { crate: MIRI_CRATE, total: 0, ported: 0, files: [] as { path: string; total: number; ported: number }[] };
      for (const f of miri.all) for (const fn of upstreamFns(f)) all.set(key(fn.path, fn.line), fn);
      for (const f of miri.files) {
        const fns = miriFns(ms_, f);
        const ported = fns.filter((fn) => marked.has(key(fn.path, fn.line))).length;
        row.total += fns.length;
        row.ported += ported;
        row.files.push({ path: f, total: fns.length, ported });
      }
      rows.push(row);
    }
  }
  // Vendor crates: every `.rs` of the published package (src/, tests/, benches/, examples/, build.rs).
  // `ported` counts every covered fn (crate: or crate-skip:); `skipped` the crate-skip: ones among them.
  const vall = new Map<string, UpstreamFn>();
  const vrows: { crate: string; total: number; ported: number; skipped: number; files: { path: string; total: number; ported: number }[] }[] = [];
  for (const v of vsel) {
    const row = { crate: v.id, total: 0, ported: 0, skipped: 0, files: [] as { path: string; total: number; ported: number }[] };
    for (const f of vendorFiles(v)) {
      const fns = upstreamFns(f, dirname(v.dir));
      for (const fn of fns) vall.set(key(fn.path, fn.line), fn);
      const covered = fns.map((fn) => vmarked.get(key(fn.path, fn.line))).filter((m) => m !== undefined);
      row.total += fns.length;
      row.ported += covered.length;
      row.skipped += covered.filter((m) => m.skip).length;
      row.files.push({ path: f, total: fns.length, ported: covered.length });
    }
    vrows.push(row);
  }

  if (a.check) {
    const bad = ms.filter((m) => {
      const fn = all.get(key(m.path, m.line));
      const checked = (m.path.startsWith("compiler/") && crates.some((c) => m.path.startsWith(`compiler/${c}/`))) || (ms_ !== undefined && miri !== undefined && miri.all.length > 0 && m.path.startsWith(`${ms_.root}/`));
      return checked && (!fn || fn.name !== m.name);
    });
    for (const m of bad) console.log(`ERROR: ${m.file}: marker ${m.path}:${m.line} ${m.name} matches no upstream fn`);
    // Vendor markers: the crate must be a scope.json vendor entry at that exact version, and the
    // marker must name a fn of that name at that line of that file of the crate source.
    const vbad = vms.filter((m) => {
      const v = vendorOf(m.path);
      if (!v) return typeof a.crate !== "string";
      if (!vsel.some((x) => x.id === v.id)) return false;
      const fn = vall.get(key(m.path, m.line));
      return !fn || fn.name !== m.name;
    });
    for (const m of vbad) {
      const why = vendorOf(m.path) ? "matches no fn in the crate source" : "names no harness/scope.json vendor crate at that version";
      console.log(`ERROR: ${m.file}: marker ${m.path}:${m.line} ${m.name} ${why}`);
    }
    // std markers: the file must exist under library/<crate>/ and the marker name a fn at that line.
    const sbad = sms.filter((m) => {
      if (lmissing.includes(m)) return true;
      const fn = lall.get(key(m.path, m.line));
      return !fn || fn.name !== m.name;
    });
    const sev = STD_MARKERS_STRICT ? "ERROR" : "warning";
    for (const m of sbad) console.log(`${sev}: ${m.file}: marker ${m.path}:${m.line} ${m.name} ${lmissing.includes(m) ? "names no file under library/<crate>/ in the upstream checkout" : "matches no upstream library fn"}`);
    // `// rustc-call:` anchors and `// rustc-const:` markers, in the ported sources only: the resolver and its tests quote the syntax.
    const anchors = walk(join(REPO, "src"), ".ts")
      .filter((f) => !f.endsWith(".test.ts") && !/[\\/]rust_ts[\\/]track_caller/.test(f))
      .flatMap((f) => anchorErrors(f, relative(REPO, f).replaceAll("\\", "/")));
    for (const e of anchors) console.log(`ERROR: ${e}`);
    if (bad.length || vbad.length || anchors.length || (STD_MARKERS_STRICT && sbad.length)) process.exit(1);
    console.log(`markers ok (${ms.length}; vendor ${vms.length}; library ${sms.length}${sbad.length ? `, ${sbad.length} invalid: warnings above` : ""})`);
    process.exit(0);
  }

  const total = rows.reduce((s, r) => s + r.total, 0);
  const ported = rows.reduce((s, r) => s + r.ported, 0);
  const pct = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(1) : "0.0"}%`;
  if (typeof a.crate === "string") {
    // Per-file table of the one crate. coverage.json is only written by the full run, so state.ts
    // never reports a single crate's numbers as the overall coverage.
    const r = (rows[0] ?? vrows[0])!;
    for (const f of r.files) console.log(`${String(f.ported).padStart(5)}/${String(f.total).padEnd(5)} ${f.path}`);
    console.log(`TOTAL ${r.ported}/${r.total} fns ported (${r.total ? ((100 * r.ported) / r.total).toFixed(2) : "0.00"}%) in ${r.crate}`);
    process.exit(0);
  }
  for (const r of rows.filter((r) => r.ported > 0 || r.crate === MIRI_CRATE).sort((x, y) => y.ported - x.ported)) {
    console.log(`${r.crate.padEnd(28)} ${String(r.ported).padStart(6)}/${String(r.total).padEnd(6)} ${((100 * r.ported) / r.total).toFixed(1)}%`);
  }
  console.log(`TOTAL ${ported}/${total} fns ported (${((100 * ported) / total).toFixed(2)}%) across ${rows.length} crates`);
  console.log(`vendor (all .rs of each published crate; covered = crate: + crate-skip:)`);
  for (const r of vrows) {
    console.log(`${r.crate.padEnd(28)} ${String(r.ported).padStart(6)}/${String(r.total).padEnd(6)} ${pct(r.ported, r.total).padStart(6)}  (${r.skipped} skipped)`);
  }
  const vtotal = vrows.reduce((s, r) => s + r.total, 0);
  const vported = vrows.reduce((s, r) => s + r.ported, 0);
  console.log(`VENDOR ${vported}/${vtotal} fns covered (${vtotal ? ((100 * vported) / vtotal).toFixed(2) : "0.00"}%) across ${vrows.length} crates`);
  console.log(`library (the library/ files with // std: markers; covered = std: + std-skip:)`);
  for (const r of lrows) {
    console.log(`${r.crate.padEnd(28)} ${String(r.ported).padStart(6)}/${String(r.total).padEnd(6)} ${pct(r.ported, r.total).padStart(6)}  (${r.files.length} files, ${r.skipped} skipped)`);
  }
  const ltotal = lrows.reduce((s, r) => s + r.total, 0);
  const lported = lrows.reduce((s, r) => s + r.ported, 0);
  console.log(`LIBRARY ${lported}/${ltotal} fns covered (${ltotal ? ((100 * lported) / ltotal).toFixed(2) : "0.00"}%) in ${lrows.reduce((s, r) => s + r.files.length, 0)} marked files of ${lrows.length} crates`);
  writeFileSync(
    join(DATA, "coverage.json"),
    JSON.stringify(
      {
        ported,
        total,
        crates: rows.map(({ files, ...r }) => r),
        vendor: { ported: vported, total: vtotal, crates: vrows.map(({ files, ...r }) => r) },
        library: { ported: lported, total: ltotal, crates: lrows.map(({ files, ...r }) => r) },
      },
      null,
      1,
    ),
  );
}
