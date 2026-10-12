// Port coverage: every upstream `fn` in in-scope crates vs `// rustc: <path>:<line> <name>`
// markers in src/, and every `fn` in the vendored external crates (`harness/scope.json` `vendor`,
// sources from scripts/crate-src.ts) vs `// crate: <crate>-<ver>/<path>:<line> <name>` markers.
// Functions are found with our own rustc_lexer port, so `fn` inside comments/strings is never
// counted. `// rustc-skip:` / `// crate-skip:` markers count as covered.
//
//   bun scripts/coverage.ts                 per-crate table, compiler then vendor (+ writes $RUST_TS_DATA/coverage.json)
//   bun scripts/coverage.ts --crate C       per-file table for one crate (compiler crate, or vendor `<crate>` / `<crate>-<ver>`)
//   bun scripts/coverage.ts --missing PATH  unported functions in one upstream file (`compiler/...` or `<crate>-<ver>/<path>`)
//   bun scripts/coverage.ts --check         ERROR on markers that point at no upstream / crate fn
//   --offline                               fetch missing vendor crate sources only from cargo's local cache
// Vendor crate sources are resolved lazily: only the crates a mode actually reads (none for a
// compiler `--missing` / `--crate`; for `--check`, only crates that have markers).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../src/rustc_lexer/lib.ts";
import { Str } from "../src/std/str.ts";
import { crateSrc } from "./crate-src.ts";
import { DATA, REPO, UPSTREAM, die, parseArgs, requireUpstream } from "./lib/common.ts";

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

if (import.meta.main) {
  requireUpstream();
  const a = parseArgs(process.argv.slice(2));
  const ms = markers();
  const vms = vendorMarkers();
  const key = (p: string, l: number) => `${p}:${l}`;
  const marked = new Map(ms.map((m) => [key(m.path, m.line), m]));
  const vmarked = new Map(vms.map((m) => [key(m.path, m.line), m]));
  const offline = a.offline === true;
  const vendor = vendorEntries();
  const vendorOf = (path: string) => vendor.find((v) => path.startsWith(`${v.id}/`));

  if (typeof a.missing === "string") {
    const ve = vendorOf(a.missing);
    const v = ve ? await resolveVendor(ve, { offline }) : undefined;
    const fns = v ? upstreamFns(a.missing, dirname(v.dir)) : upstreamFns(a.missing);
    const miss = fns.filter((f) => !(v ? vmarked : marked).has(key(f.path, f.line)));
    for (const f of miss) console.log(`${f.path}:${f.line} ${f.name}`);
    console.log(`${fns.length - miss.length}/${fns.length} ported`);
    process.exit(0);
  }

  // `--crate` names either a compiler crate or a vendored one (`<crate>` or `<crate>-<ver>`).
  const vselEntries = typeof a.crate === "string" ? vendor.filter((v) => v.id === a.crate || v.name === a.crate) : vendor;
  // `--check` only needs the sources of crates that have markers; the tables need all selected ones.
  const vneeded = a.check ? vselEntries.filter((v) => vms.some((m) => m.path.startsWith(`${v.id}/`))) : vselEntries;
  const vsel: VendorCrate[] = [];
  for (const v of vneeded) vsel.push(await resolveVendor(v, { offline }));
  const crates = typeof a.crate === "string" ? (vsel.length ? [] : [a.crate]) : inScopeCrates();
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
      return m.path.startsWith("compiler/") && crates.some((c) => m.path.startsWith(`compiler/${c}/`)) && (!fn || fn.name !== m.name);
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
    if (bad.length || vbad.length) process.exit(1);
    console.log(`markers ok (${ms.length}; vendor ${vms.length})`);
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
  for (const r of rows.filter((r) => r.ported > 0).sort((x, y) => y.ported - x.ported)) {
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
  writeFileSync(
    join(DATA, "coverage.json"),
    JSON.stringify({ ported, total, crates: rows.map(({ files, ...r }) => r), vendor: { ported: vported, total: vtotal, crates: vrows.map(({ files, ...r }) => r) } }, null, 1),
  );
}
