// Port coverage: every upstream `fn` in in-scope crates vs `// rustc: <path>:<line> <name>`
// markers in src/. Upstream functions are found with our own rustc_lexer port, so `fn`
// inside comments/strings is never counted.
//
//   bun scripts/coverage.ts                 per-crate table (+ writes $RUST_TS_DATA/coverage.json)
//   bun scripts/coverage.ts --crate C       per-file table for one crate
//   bun scripts/coverage.ts --missing PATH  unported functions in one upstream file
//   bun scripts/coverage.ts --check         ERROR on markers that point at no upstream fn
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FrontmatterAllowed, strip_shebang, tokenize } from "../src/rustc_lexer/lib.ts";
import { Str } from "../src/std/str.ts";
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

export function upstreamFns(relPath: string): UpstreamFn[] {
  const bytes = readFileSync(join(UPSTREAM, relPath));
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
  const re = /\/\/ rustc: (\S+):(\d+) (\S+)/g;
  for (const f of walk(join(REPO, "src"), ".ts")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) out.push({ file: relative(REPO, f).replaceAll("\\", "/"), path: m[1]!, line: Number(m[2]), name: m[3]! });
  }
  return out;
}

export function inScopeCrates(): string[] {
  const scope = JSON.parse(readFileSync(join(REPO, "harness", "scope.json"), "utf8"));
  return readdirSync(join(UPSTREAM, "compiler")).filter((c) => !(c in scope.excluded));
}

if (import.meta.main) {
  requireUpstream();
  const a = parseArgs(process.argv.slice(2));
  const ms = markers();
  const key = (p: string, l: number) => `${p}:${l}`;
  const marked = new Map(ms.map((m) => [key(m.path, m.line), m]));

  if (typeof a.missing === "string") {
    const fns = upstreamFns(a.missing);
    const miss = fns.filter((f) => !marked.has(key(f.path, f.line)));
    for (const f of miss) console.log(`${f.path}:${f.line} ${f.name}`);
    console.log(`${fns.length - miss.length}/${fns.length} ported`);
    process.exit(0);
  }

  const crates = typeof a.crate === "string" ? [a.crate] : inScopeCrates();
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

  if (a.check) {
    const bad = ms.filter((m) => {
      const fn = all.get(key(m.path, m.line));
      return m.path.startsWith("compiler/") && crates.some((c) => m.path.startsWith(`compiler/${c}/`)) && (!fn || fn.name !== m.name);
    });
    for (const m of bad) console.log(`ERROR: ${m.file}: marker ${m.path}:${m.line} ${m.name} matches no upstream fn`);
    if (bad.length) process.exit(1);
    console.log(`markers ok (${ms.length})`);
    process.exit(0);
  }

  const total = rows.reduce((s, r) => s + r.total, 0);
  const ported = rows.reduce((s, r) => s + r.ported, 0);
  if (typeof a.crate === "string") {
    for (const f of rows[0]!.files) console.log(`${String(f.ported).padStart(5)}/${String(f.total).padEnd(5)} ${f.path}`);
  } else {
    for (const r of rows.filter((r) => r.ported > 0).sort((x, y) => y.ported - x.ported)) {
      console.log(`${r.crate.padEnd(28)} ${String(r.ported).padStart(6)}/${String(r.total).padEnd(6)} ${((100 * r.ported) / r.total).toFixed(1)}%`);
    }
  }
  console.log(`TOTAL ${ported}/${total} fns ported (${((100 * ported) / total).toFixed(2)}%) across ${rows.length} crates`);
  writeFileSync(join(DATA, "coverage.json"), JSON.stringify({ ported, total, crates: rows.map(({ files, ...r }) => r) }, null, 1));
}
