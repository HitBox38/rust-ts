// Files an oracle case may read besides its own input file: the dependency part of the oracle cache
// key (scripts/difftest.ts `cachePath`).
//
// Why: the key used to hash only the case file. 27 tests/ui/simd files `#[path]` to
// tests/auxiliary/minisimd.rs; when the sparse checkout gained tests/auxiliary their cached oracle
// outputs (the "couldn't find file" error) went stale silently (review harness-w13 B1).
//
// Design (a conservative static scan; option (2) of lane cache-deps, see docs/handoff/cache-deps.md):
// - `caseDeps` follows, from the case file, every way rustc reads another source file, and returns every
//   path it *probes*, with its state: `-` missing, `dir`, `other` (not a regular file), or the sha1 of
//   the file's content. A file
//   appearing, disappearing or changing at any probed path changes the result, so it changes the key.
// - A case whose scan probes nothing gets `[]`, and `cachePath` then leaves its key exactly as before,
//   so the cache entries of cases that can read no other file stay valid.
// - It over-approximates: any path rustc might look at is probed, and paths it would not look at may be
//   probed too. An extra path only makes the key depend on one more file of the pinned checkout.
//
// What is followed, as rustc resolves it at the pin (rustc_expand/src/module.rs `mod_dir_path`,
// `mod_file_path`, `default_submod_path`; rustc_session/src/session.rs `Session::resolve_path` for the
// include macros and debugger visualizers):
// - Out-of-line `mod N;`: `<dir>/[<rel>/]N.rs` and `<dir>/[<rel>/]N/mod.rs` for every module state
//   (`dir_path` + `DirOwnership::Owned { relative }`) the declaration may be in, both with and without
//   `relative` (a declaration in a block probes without it). Every existing target is scanned in turn
//   (also when both exist, which rustc reports as an error). The crate root's state is (its directory,
//   no relative); `N.rs` gives (its directory, `N`), `N/mod.rs` and `#[path]` files (their directory, none).
// - `#[path = "P"]` (any `path = "<str>"` in an attribute, so `cfg_attr(.., path = ..)` too) on the next `mod`:
//   `<dir>/P` for an out-of-line module (scanned), the module directory for an inline one.
// - Inline `mod m { .. }` extends the module state for what is inside its braces
//   (`<dir>/[<rel>/]m`, and `<dir>/m` for one in a block).
// - `include!`/`include_str!`/`include_bytes!("P")`, `natvis_file = "P"`, `gdb_script_file = "P"`:
//   `P` relative to the directory of every file reached (rustc uses the file of the outermost macro
//   call site, which can be another file of the crate; an absolute `P` as is). `include!` targets are
//   scanned with their own directory as the module directory (rustc_builtin_macros source_util.rs
//   `expand_include`), like a `#[path]` file.
// - A `mod` declaration in a macro body (`macro_rules!`, `macro`) is followed in every module state of
//   every reached file, since the macro may be invoked in any of them.
// - Dynamic forms, whose target is not a literal in place:
//   - `include!(<not a string literal>)` (`concat!(..)`, a macro call, `env!(..)`), `natvis_file`/
//     `gdb_script_file` without a literal, `#[path = <not a string literal>]` (`dynLit`): if a reached
//     file has one, every string literal of every reached file, every `concat!` of the literals in its
//     parentheses, every value of the case's `env`, and every such value followed by such a literal is
//     a candidate, as an include target (relative to every reached file's directory) and as a `#[path]`
//     of that declaration.
//   - `mod $x` (`dynMod`, a module named by a macro variable): its directories are listed (entry names,
//     `ls:<hash>`, so any file appearing there changes the key), and every `N.rs`/`N/` in them whose
//     name `N` is an identifier of a reached file is followed as `mod N`.
//   The literals and identifiers are those of the files reached, which the scan itself finds; it is
//   repeated until they stop growing.
// Tokens come from a small lexer (comments, string/char literals, lifetimes, raw identifiers, a
// shebang and frontmatter), so braces and words inside literals and comments are not misread, and
// `path = ..` counts only inside an attribute `#[..]`. As a guard against the lexer losing its place on
// malformed input, plain regex matches of `mod N;`, `path = "P"` and `include..!("P")` over the raw text
// are added too, in every module state of the file.
//
// Checked against the oracle: for every tests/ui case of the `expanded` suite, every file in rustc's
// `--emit=dep-info` is among the paths found here, as an existing file (lane cache-deps handoff).
//
// Not covered (documented limits): a path produced by a proc macro (cases get no proc macro crates), a
// module named by `${concat(..)}` whose file existed before (its appearance is still seen through the
// listing), and `env!` of a variable that is not in the case's `env` (the inherited environment).
// Suites whose tools read only the case files (`Suite.readsOnlyCaseFile`) skip all this.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hash } from "./common.ts";

/** A path (relative to the suite's cwd, `/`-separated; a listed directory ends in `/`) and its state. */
export type Dep = [path: string, state: string];

/** rustc's `ModuleData::dir_path` + `DirOwnership::Owned { relative }` (absolute dir). */
interface ModState {
  dir: string;
  rel: string | null;
}

/**
 * One step into an inline module `mod <name> { .. }`: `name` is `null` for a macro variable (`mod $x`);
 * `paths` are the `#[path]` literals before it (`dynPath`: a non-literal one).
 */
interface Seg {
  name: string | null;
  paths: string[];
  dynPath: boolean;
}

/**
 * An out-of-line `mod <name>;` in the inline modules `chain` (fields as `Seg`; `name` `undefined`: a
 * raw-text `path = ".."` match). `inMacro`: in the body of a `macro_rules!`/`macro`, so it may be
 * expanded in any module of any reached file.
 */
interface Decl {
  chain: Seg[];
  name: string | null | undefined;
  paths: string[];
  dynPath: boolean;
  inMacro: boolean;
}

interface Include {
  /** `null`: not a string literal. */
  lit: string | null;
  /** `include!` (the target is Rust source and is scanned); not `include_str!`/`include_bytes!`/debugger files. */
  rust: boolean;
}

interface FileScan {
  decls: Decl[];
  includes: Include[];
  /** Every inline-module chain in the file (`[]` = the file's own module). */
  chains: Seg[][];
  /** A target that is not a literal in place: `include!(<not a string literal>)`, `path = <not a string literal>`, .. */
  dynLit: boolean;
  /** A module named by a macro variable (`mod $x`). */
  dynMod: boolean;
}

type Tok = { k: "ident"; v: string; raw: boolean } | { k: "str"; v: string } | { k: "punct"; v: string };

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c) || c.charCodeAt(0) > 0x7f;
const isIdentCont = (c: string): boolean => /[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) > 0x7f;

/** Cooked value of a (non-raw) string literal body; unknown escapes are kept verbatim. */
function cook(body: string): string {
  return body.replace(/\\(\r?\n[ \t\r\n]*|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f_]*\}|.)/gs, (m, e: string) => {
    if (e[0] === "\n" || e[0] === "\r") return "";
    if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === "u") return String.fromCodePoint(parseInt(e.slice(2, -1).replaceAll("_", ""), 16) || 0);
    return ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[e] ?? (e === "\\" || e === '"' || e === "'" ? e : m);
  });
}

/** The tokens of a Rust source file that matter here (numbers and other literals are dropped). */
export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  // Shebang (not `#![`), then frontmatter (a `---` fence at the start, closed by a line with as many dashes).
  if (src.startsWith("#!") && !/^#!\s*\[/.test(src)) i = src.indexOf("\n") < 0 ? src.length : src.indexOf("\n");
  const fm = /^(?:[ \t]*\r?\n)*[ \t]*(-{3,})/.exec(src.slice(i));
  if (fm) {
    const close = new RegExp(`\\n[ \\t]*${fm[1]}(?!-)[^\\n]*`, "g");
    close.lastIndex = i + fm[0].length;
    const m = close.exec(src);
    i = m ? m.index + m[0].length : src.length;
  }
  const n = src.length;
  const skipStr = (j: number): number => {
    // j at the opening quote; returns the index after the closing quote.
    for (j++; j < n; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === '"') return j + 1;
    }
    return n;
  };
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? n : e;
    } else if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      for (i += 2; i < n && depth > 0; ) {
        if (src[i] === "/" && src[i + 1] === "*") (depth++, (i += 2));
        else if (src[i] === "*" && src[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
    } else if (c === '"') {
      const e = skipStr(i);
      out.push({ k: "str", v: cook(src.slice(i + 1, e - 1)) });
      i = e;
    } else if (c === "'") {
      if (src[i + 1] === "\\") {
        // A char literal with an escape: up to the next quote.
        const e = src.indexOf("'", i + 3);
        i = e < 0 ? n : e + 1;
      } else {
        const cp = src.codePointAt(i + 1);
        const w = cp !== undefined && cp > 0xffff ? 2 : 1;
        if (src[i + 1 + w] === "'") i += 2 + w; // 'x'
        else for (i++; i < n && isIdentCont(src[i]!); i++); // a lifetime or label
      }
    } else if (isIdentStart(c)) {
      let e = i + 1;
      while (e < n && isIdentCont(src[e]!)) e++;
      const w = src.slice(i, e);
      if ((w === "r" || w === "br" || w === "cr") && (src[e] === '"' || (src[e] === "#" && /^#+"/.test(src.slice(e, e + 300))))) {
        let hashes = 0;
        while (src[e + hashes] === "#") hashes++;
        const end = src.indexOf('"' + "#".repeat(hashes), e + hashes + 1);
        const stop = end < 0 ? n : end;
        if (w === "r") out.push({ k: "str", v: src.slice(e + hashes + 1, stop) });
        i = end < 0 ? n : end + 1 + hashes;
      } else if ((w === "b" || w === "c") && src[e] === '"') {
        i = skipStr(e);
      } else if (w === "b" && src[e] === "'") {
        const e2 = src.indexOf("'", e + (src[e + 1] === "\\" ? 3 : 2));
        i = e2 < 0 ? n : e2 + 1;
      } else if (w === "r" && src[e] === "#" && e + 1 < n && isIdentStart(src[e + 1]!)) {
        let e2 = e + 2;
        while (e2 < n && isIdentCont(src[e2]!)) e2++;
        out.push({ k: "ident", v: src.slice(e + 1, e2), raw: true });
        i = e2;
      } else {
        out.push({ k: "ident", v: w, raw: false });
        i = e;
      }
    } else if (/[0-9]/.test(c)) {
      for (i++; i < n && isIdentCont(src[i]!); i++);
    } else {
      out.push({ k: "punct", v: c });
      i++;
    }
  }
  return out;
}

const INCLUDE_MACROS = new Set(["include", "include_str", "include_bytes"]);
const DEBUGGER_FILES = new Set(["natvis_file", "gdb_script_file"]);

const isPunct = (toks: Tok[], j: number, v: string): boolean => toks[j]?.k === "punct" && toks[j]!.v === v;
const isOpen = (toks: Tok[], j: number): boolean => toks[j]?.k === "punct" && "([{".includes(toks[j]!.v);

/** Index after the delimited group that opens at `j` (any of `([{`; the end of the file if unclosed). */
function groupEnd(toks: Tok[], j: number): number {
  let depth = 0;
  for (; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.k !== "punct") continue;
    if ("([{".includes(t.v)) depth++;
    else if (")]}".includes(t.v) && --depth === 0) return j + 1;
  }
  return j;
}

/** Words without which a file can make rustc read no other file (`scanSource` finds nothing). */
const KEYWORDS = /mod|include|path|natvis_file|gdb_script_file/;

const EMPTY_SCAN: FileScan = { decls: [], includes: [], chains: [[]], dynLit: false, dynMod: false };

/** The scan of one file's text (independent of where the file sits in the crate). */
export function scanSource(src: string): FileScan {
  if (!KEYWORDS.test(src)) return EMPTY_SCAN;
  const toks = lex(src);
  const scan: FileScan = { decls: [], includes: [], chains: [[]], dynLit: false, dynMod: false };
  const isP = (j: number, v: string) => isPunct(toks, j, v);
  const skipGroup = (j: number) => groupEnd(toks, j);
  const stack: Seg[][] = [[]];
  let pendingPaths: string[] = [];
  let pendingDynPath = false;
  /** The chain the next `{` opens, if it is an inline module's. */
  let nextChain: Seg[] | null = null;
  /** End (token index) of the attribute `#[..]`/`#![..]` being read, if any. */
  let attrEnd = -1;
  /** End (token index) of the macro definition body being read, if any. */
  let macroEnd = -1;
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j]!;
    const chain = stack[stack.length - 1]!;
    if (t.k === "str") continue;
    if (t.k === "punct") {
      if (t.v === "#" && j >= attrEnd) {
        const open = isP(j + 1, "!") ? j + 2 : j + 1;
        if (isP(open, "[")) attrEnd = skipGroup(open);
      }
      if (t.v === "{") {
        const c = nextChain ?? chain;
        if (nextChain) scan.chains.push(nextChain);
        stack.push(c);
      } else if (t.v === "}") {
        if (stack.length > 1) stack.pop();
      }
      if (t.v === "{" || t.v === "}" || t.v === ";") {
        pendingPaths = [];
        pendingDynPath = false;
        nextChain = null;
      }
      continue;
    }
    if (t.raw) continue;
    if (t.v === "macro_rules" && isP(j + 1, "!") && toks[j + 2]?.k === "ident" && isOpen(toks, j + 3)) {
      macroEnd = Math.max(macroEnd, skipGroup(j + 3));
    } else if (t.v === "macro" && toks[j + 1]?.k === "ident") {
      const body = isP(j + 2, "(") ? skipGroup(j + 2) : j + 2;
      if (isP(body, "{")) macroEnd = Math.max(macroEnd, skipGroup(body));
    }
    if (t.v === "path" && j < attrEnd && isP(j + 1, "=")) {
      if (toks[j + 2]?.k === "str") pendingPaths.push(toks[j + 2]!.v);
      else (pendingDynPath = true), (scan.dynLit = true);
    } else if (DEBUGGER_FILES.has(t.v) && isP(j + 1, "=")) {
      const lit = toks[j + 2]?.k === "str" ? toks[j + 2]!.v : null;
      if (lit === null) scan.dynLit = true;
      scan.includes.push({ lit, rust: false });
    } else if (INCLUDE_MACROS.has(t.v) && isP(j + 1, "!") && isOpen(toks, j + 2)) {
      const end = skipGroup(j + 2);
      // A single string literal, optionally followed by a comma.
      const lit = toks[j + 3]?.k === "str" && (end === j + 5 || (end === j + 6 && isP(j + 4, ","))) ? toks[j + 3]!.v : null;
      if (lit === null) scan.dynLit = true;
      scan.includes.push({ lit, rust: t.v === "include" });
    } else if (t.v === "mod") {
      let k = j + 1;
      let name: string | null;
      if (toks[k]?.k === "ident") name = toks[k++]!.v;
      else if (isP(k, "$")) {
        name = null;
        scan.dynMod = true;
        k++;
        if (isP(k, "{")) k = skipGroup(k);
        else if (toks[k]?.k === "ident") k++;
        else continue;
      } else continue;
      const seg: Seg = { name, paths: pendingPaths, dynPath: pendingDynPath };
      if (isP(k, ";")) scan.decls.push({ chain, ...seg, inMacro: j < macroEnd });
      else if (isP(k, "{")) nextChain = [...chain, seg];
    }
  }
  // Raw-text matches (a guard against the lexer losing its place), in every chain of the file.
  const chains = scan.chains;
  for (const m of src.matchAll(/\bmod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;/g)) for (const chain of chains) scan.decls.push({ chain, name: m[1]!, paths: [], dynPath: false, inMacro: false });
  for (const m of src.matchAll(/\bpath\s*=\s*"([^"\\\n]*)"/g)) for (const chain of chains) scan.decls.push({ chain, name: undefined, paths: [m[1]!], dynPath: false, inMacro: false });
  for (const m of src.matchAll(/\binclude(_str|_bytes)?\s*!\s*[(\[{]\s*"([^"\\\n]*)"/g)) scan.includes.push({ lit: m[2]!, rust: m[1] === undefined });
  return scan;
}

/**
 * Words of a file the dynamic forms may use: its string literals (plain and raw) plus the join of the
 * literals inside each `concat!(..)`, and its identifiers.
 */
export function wordsOf(src: string): { lits: string[]; idents: string[] } {
  const toks = lex(src);
  const lits: string[] = [];
  const idents: string[] = [];
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.k === "str") lits.push(t.v);
    else if (t.k === "ident") {
      idents.push(t.v);
      if (t.v === "concat" && isPunct(toks, j + 1, "!") && isOpen(toks, j + 2)) {
        const parts = toks.slice(j + 3, groupEnd(toks, j + 2) - 1).filter((x) => x.k === "str");
        if (parts.length > 1) lits.push(parts.map((x) => x.v).join(""));
      }
    }
  }
  return { lits, idents };
}

/** Scans by content hash (a file's scan depends only on its text). */
const scanMemo = new Map<string, FileScan>();

/** Work items one analysis may scan before it gives up (no real case comes near). */
const MAX_SCANS = 20_000;

/** Inputs of an analysis that come from its own result (see `caseDeps`). */
interface Pools {
  /** Directories of the files reached. */
  dirs: Set<string>;
  /** If a reached file has a `dynLit` form: the literals of every file reached. */
  lits: Set<string>;
  /** If a reached file has a `dynMod` form: the identifiers of every file reached. */
  idents: Set<string>;
}

/**
 * Every path the case `file` (relative to `cwd`) can make rustc read or probe, with its state, sorted
 * by path; `[]` if there is none (see the header). `env` is the case's environment (`Case.env`).
 */
export function caseDeps(cwd: string, file: string, env?: Record<string, string | null>): Dep[] {
  const root = resolve(cwd, file);
  // Some inputs of an analysis come from its own result; start from the root's directory alone and
  // repeat until they stop growing (they only grow, and are bounded by the files on disk).
  let pools: Pools = { dirs: new Set([dirname(root)]), lits: new Set(), idents: new Set() };
  for (;;) {
    const r = analyze(root, pools, env);
    const grew = (k: keyof Pools) => [...r.pools[k]].some((x) => !pools[k].has(x));
    if (!grew("dirs") && !grew("lits") && !grew("idents")) {
      const rel = (p: string) => relative(cwd, p).split(sep).join("/");
      return [...r.probed].map(([p, st]): Dep => [st.startsWith("ls:") ? `${rel(p)}/` : rel(p), st]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    const union = (k: keyof Pools) => new Set([...pools[k], ...r.pools[k]]);
    pools = { dirs: union("dirs"), lits: union("lits"), idents: union("idents") };
  }
}

function analyze(root: string, pools: Pools, env: Record<string, string | null> | undefined) {
  /** Absolute path -> `-` | `dir` | sha1 of the content | `ls:<hash>` (a listed directory). */
  const probed = new Map<string, string>();
  const texts = new Map<string, string>();
  const probe = (p: string): string => {
    const known = probed.get(p);
    if (known !== undefined) return known.startsWith("ls:") ? "dir" : known;
    let st: string;
    try {
      const s = statSync(p);
      // Only regular files are read (a literal like "/dev/zero" must not hang the scan).
      if (s.isDirectory()) st = "dir";
      else if (!s.isFile()) st = "other";
      else {
        const buf = readFileSync(p);
        st = hash(buf);
        texts.set(p, buf.toString("utf8"));
      }
    } catch {
      st = "-";
    }
    probed.set(p, st);
    return st;
  };
  const isFile = (p: string) => {
    const st = probe(p);
    return st !== "-" && st !== "dir" && st !== "other";
  };
  /** Subdirectories and files of a directory; recorded as `ls:<hash of the sorted names>`. */
  const listing = (d: string): { files: string[]; subdirs: string[] } => {
    let ents: { name: string; isDirectory(): boolean }[];
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      probe(d);
      return { files: [], subdirs: [] };
    }
    probed.set(d, `ls:${hash(ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join("\n"))}`);
    return { files: ents.filter((e) => !e.isDirectory()).map((e) => e.name), subdirs: ents.filter((e) => e.isDirectory()).map((e) => e.name) };
  };

  // Candidate paths of the `dynLit` forms (see the header): literals, env values, env value + literal.
  const envVals = Object.values(env ?? {}).filter((v): v is string => typeof v === "string" && v !== "");
  const dynLits = [...pools.lits, ...envVals, ...envVals.flatMap((v) => [...pools.lits].map((l) => v + l))].filter((l) => l.length <= 1024 && !l.includes("\0"));
  /** Candidate names of the `dynMod` forms in directory `d`: its entries named like an identifier of a reached file. */
  const dynNames = (d: string): { files: string[]; subdirs: string[] } => {
    const ls = listing(d);
    return { files: ls.files.filter((f) => f.endsWith(".rs") && pools.idents.has(f.slice(0, -3))), subdirs: ls.subdirs.filter((n) => pools.idents.has(n)) };
  };

  const key = (st: ModState) => `${st.dir}\0${st.rel ?? ""}`;
  /** `relative` applied (an owned module) and not (a module in a block). */
  const baseDirs = (st: ModState): string[] => (st.rel === null ? [st.dir] : [join(st.dir, st.rel), st.dir]);
  /** The module states inside an inline-module chain entered from `st`. */
  const chainStates = (st: ModState, chain: Seg[]): ModState[] => {
    let cur = [st];
    for (const seg of chain) {
      const next = new Map<string, ModState>();
      const add = (dir: string) => next.set(dir, { dir, rel: null });
      for (const s of cur) {
        for (const p of seg.paths) add(resolve(s.dir, p));
        if (seg.dynPath) for (const l of dynLits) add(resolve(s.dir, l));
        for (const d of baseDirs(s)) {
          if (seg.name) add(join(d, seg.name));
          else if (seg.name === null) for (const sub of dynNames(d).subdirs) add(join(d, sub));
        }
      }
      cur = [...next.values()];
    }
    return cur;
  };

  const seen = new Set<string>();
  const work: [string, ModState][] = [];
  const load = (f: string, st: ModState) => {
    const k = `${f}\0${key(st)}`;
    if (seen.has(k)) return;
    if (seen.size >= MAX_SCANS) throw new Error(`ERROR: dependency scan of ${root} exceeds ${MAX_SCANS} files (scripts/lib/deps.ts)`);
    seen.add(k);
    work.push([f, st]);
  };
  const loadIfFile = (f: string, st: ModState) => {
    if (isFile(f)) load(f, st);
  };
  /** Every file reached, with its text and scan. */
  const reached = new Map<string, { src: string; scan: FileScan }>();
  /** Every (file, module state) scanned, and every declaration in a macro body (see `Decl.inMacro`). */
  const pairs: { st: ModState; scan: FileScan }[] = [];
  const macroDecls: Decl[] = [];
  const macroDone = new Set<string>();
  const includes: Include[] = [];

  /** Follow declaration `decl` in module state `t` (already inside the declaration's chain). */
  const follow = (decl: Decl, t: ModState) => {
    for (const p of decl.dynPath ? [...decl.paths, ...dynLits] : decl.paths) {
      const target = resolve(t.dir, p);
      loadIfFile(target, { dir: dirname(target), rel: null });
    }
    for (const d of baseDirs(t)) {
      const names = decl.name ? [decl.name] : decl.name === null ? [...dynNames(d).files.map((n) => n.slice(0, -3)), ...dynNames(d).subdirs] : [];
      for (const name of names) {
        loadIfFile(join(d, `${name}.rs`), { dir: d, rel: name });
        const modRs = join(d, name, "mod.rs");
        loadIfFile(modRs, { dir: dirname(modRs), rel: null });
      }
    }
  };

  load(root, { dir: dirname(root), rel: null });
  while (work.length > 0) {
    // Scan; follow module declarations.
    while (work.length > 0) {
      const [f, st] = work.pop()!;
      const src = f === root ? readFileSync(f, "utf8") : texts.get(f)!;
      const h = hash(src);
      let scan = scanMemo.get(h);
      if (!scan) scanMemo.set(h, (scan = scanSource(src)));
      reached.set(f, { src, scan });
      pairs.push({ st, scan });
      for (const decl of scan.decls) {
        if (decl.inMacro) macroDecls.push(decl);
        for (const t of chainStates(st, decl.chain)) follow(decl, t);
      }
      includes.push(...scan.includes);
    }
    // Include targets, relative to every reached file's directory (`pools.dirs`: the previous round's).
    // `include!` makes the included file's directory the module directory (source_util.rs `expand_include`).
    for (const inc of includes.splice(0)) {
      for (const l of inc.lit !== null ? [inc.lit] : dynLits) {
        for (const d of pools.dirs) {
          const target = resolve(d, l);
          if (isFile(target) && inc.rust) load(target, { dir: dirname(target), rel: null });
        }
      }
    }
    // Declarations in macro bodies, in every module state of every reached file.
    for (const [pi, { st, scan }] of pairs.entries()) {
      for (const [di, decl] of macroDecls.entries()) {
        if (macroDone.has(`${pi}:${di}`)) continue;
        macroDone.add(`${pi}:${di}`);
        for (const chain of scan.chains) for (const t of chainStates(st, chain)) follow(decl, t);
      }
    }
  }
  const files = [...reached.values()];
  const dynLit = files.some((x) => x.scan.dynLit);
  const dynMod = files.some((x) => x.scan.dynMod);
  const words = dynLit || dynMod ? files.map((x) => wordsOf(x.src)) : [];
  return {
    probed,
    pools: {
      dirs: new Set([...reached.keys()].map((f) => dirname(f))),
      lits: new Set(dynLit ? words.flatMap((w) => w.lits) : []),
      idents: new Set(dynMod ? words.flatMap((w) => w.idents) : []),
    },
  };
}
