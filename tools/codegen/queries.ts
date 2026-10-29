// Generates src/rustc_middle/queries.gen.ts from upstream compiler/rustc_middle/src/queries.rs
// (PORTING.md §5 "Macros inside rustc": `rustc_queries!` is generated, never hand-ported; decision D3 of
// docs/plan-m2.md: hand-written minimal query engine + generated declarations).
//
// `rustc_queries! { .. }` is parsed token by token (our rustc_lexer port) the way
// compiler/rustc_macros/src/query.rs parses it (`QueryEntry::parse`, `parse_query_modifiers`), and each
// query becomes what `rustc_with_all_queries! { define_query_api! }` (rustc_middle/src/query/query_api.rs)
// and `define_queries!` (rustc_query_impl/src/query_vtables.rs) need per query:
//   - the key / value types (`pub mod $name { type Key; type Value; type LocalKey; type ProvidedValue }`),
//     mapped to TS through the type maps (tools/codegen/typemap*.json) and the index of generated types
//     (`// rustc-type:` markers in src/**/*.gen.ts); types that are not ported yet are `unknown` (reported);
//   - the modifier list (QMODLIST) incl. `returns_error_guaranteed` (query.rs `returns_error_guaranteed`);
//   - the `desc` closure (`|tcx, $key_pat: $key_ty| format!($desc)`) translated to TS when every part of it is
//     understood (queries.config.json), otherwise a closure that calls `unported(..)` (reported);
//   - the `QueryKey` impl of the key type (query/keys.ts) and its `IntoQueryKey` conversion.
// The TyCtxt / TyCtxtAt / TyCtxtEnsure* / TyCtxtFeed methods, `TaggedQueryKey`, `Providers` and
// `ExternProviders` are typed here (mapped types over `QueryTypes`) and implemented generically by the
// hand-written src/rustc_middle/query/query_api.ts from `QUERY_DECLS`.
//
// The QMODLIST of rustc_macros/src/query.rs and the `define_query_api!` matcher are fingerprinted: if
// upstream changes them, this generator stops with an ERROR instead of guessing.
//
//   bun tools/codegen/queries.ts           write the file (report: $RUST_TS_DATA/codegen/queries.report.json)
//   bun tools/codegen/queries.ts --check   ERROR if the committed file is stale
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, hash, requireUpstream } from "../../scripts/lib/common.ts";
import { lex, type Tok } from "./lints.ts";
import { loadStableHashMap, loadTypeMap, type StableHashMapEntry, type TypeMap, type TypeMapEntry } from "./types.ts";

export const SRC_PATH = "compiler/rustc_middle/src/queries.rs";
const MACROS_PATH = "compiler/rustc_macros/src/query.rs";
const QUERY_API_PATH = "compiler/rustc_middle/src/query/query_api.rs";
export const OUT_PATH = "src/rustc_middle/queries.gen.ts";
const OUT_DIR = "src/rustc_middle";

/// sha1 of the upstream text this generator implements (see `fingerprints`). A mismatch means upstream
/// changed the query grammar / modifier list: re-read it and update this generator.
const FINGERPRINTS: Record<string, string> = {
  "query.rs QueryModifiers": "ffde7c53d9245ba339c33c9d97751efc034564a5",
  "query_api.rs define_query_api matcher": "873bb21ee1bd775d086a511cb407ad49efe7f391",
};

/** The QMODLIST, in the macro's (alphabetical) order; `desc` and `returns_error_guaranteed` are not flags. */
export const MODIFIERS = [
  "arena_cache",
  "cache_on_disk",
  "depth_limit",
  "eval_always",
  "feedable",
  "handle_cycle_error",
  "no_force",
  "no_hash",
  "separate_provide_extern",
] as const;
export type Modifier = (typeof MODIFIERS)[number];

class GenError extends Error {}
function fail(t: { line: number } | undefined, msg: string): never {
  throw new GenError(`ERROR: ${SRC_PATH}:${t?.line ?? "?"}: ${msg}`);
}

// ---- token cursor -------------------------------------------------------------------------------

const isComment = (t: Tok): boolean => t.kind.$ === "LineComment" || t.kind.$ === "BlockComment";
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

class Cursor {
  i: number;
  constructor(
    readonly toks: Tok[],
    start: number,
    readonly end: number,
    /** keep `///` doc comments as tokens (true only at the query-list level) */
    readonly docs = false,
  ) {
    this.i = start;
  }
  private skip(): void {
    while (this.i < this.end) {
      const t = this.toks[this.i]!;
      if (!isComment(t) || (this.docs && t.doc !== undefined)) break;
      this.i++;
    }
  }
  peek(n = 0): Tok | undefined {
    this.skip();
    let j = this.i;
    for (let k = 0; ; k++) {
      while (j < this.end && isComment(this.toks[j]!) && !(this.docs && this.toks[j]!.doc !== undefined)) j++;
      if (j >= this.end) return undefined;
      if (k === n) return this.toks[j];
      j++;
    }
  }
  next(): Tok {
    const t = this.peek();
    if (t === undefined) fail(this.toks[this.end - 1], "unexpected end of input");
    this.i = this.toks.indexOf(t, this.i) + 1;
    return t;
  }
  is(text: string, n = 0): boolean {
    const t = this.peek(n);
    return t !== undefined && t.doc === undefined && t.text === text;
  }
  eat(text: string): boolean {
    if (!this.is(text)) return false;
    this.next();
    return true;
  }
  expect(text: string): Tok {
    const t = this.next();
    if (t.text !== text || t.doc !== undefined) fail(t, `expected \`${text}\`, found \`${t.text}\``);
    return t;
  }
  ident(): Tok {
    const t = this.next();
    if (t.kind.$ !== "Ident" && t.kind.$ !== "RawIdent") fail(t, `expected an identifier, found \`${t.text}\``);
    return t;
  }
  atEnd(): boolean {
    return this.peek() === undefined;
  }
  /** After consuming `open`: a cursor over the group's contents; moves past the closing delimiter. */
  group(open: Tok): Cursor {
    const close = OPEN[open.text];
    if (close === undefined) fail(open, `expected a delimiter, found \`${open.text}\``);
    let depth = 1;
    for (let j = this.i; j < this.end; j++) {
      const t = this.toks[j]!;
      if (isComment(t)) continue;
      if (t.text in OPEN) depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") {
        if (--depth === 0) {
          if (t.text !== close) fail(t, `mismatched delimiter \`${t.text}\``);
          const c = new Cursor(this.toks, this.i, j, this.docs);
          this.i = j + 1;
          return c;
        }
      }
    }
    fail(open, "unclosed delimiter");
  }
  /** Source text of the tokens in `[from, this.i)` (rustfmt-like spacing; for comments and messages only). */
  textFrom(from: number): string {
    return this.toks
      .slice(from, this.i)
      .filter((t) => !isComment(t))
      .map((t) => t.text)
      .join(" ")
      .replace(/ : : /g, "::")
      .replace(/^: : /, "::")
      .replace(/ ([<>,)\]])/g, "$1")
      .replace(/([<&(\[]) /g, "$1");
  }
}

// ---- Rust types ---------------------------------------------------------------------------------

export type RType =
  | { k: "path"; segs: { name: string; args: RType[] }[]; global: boolean }
  | { k: "ref"; elem: RType }
  | { k: "tuple"; elems: RType[] }
  | { k: "slice"; elem: RType }
  | { k: "array"; elem: RType }
  | { k: "never" };

function parseType(c: Cursor): RType {
  const t = c.peek();
  if (t === undefined) fail(undefined, "expected a type");
  if (c.eat("&")) {
    if (c.peek()?.kind.$ === "Lifetime") c.next();
    c.eat("mut");
    return { k: "ref", elem: parseType(c) };
  }
  if (t.text === "(") {
    const g = c.group(c.next());
    const elems: RType[] = [];
    let trailing = false;
    while (!g.atEnd()) {
      elems.push(parseType(g));
      trailing = g.eat(",");
      if (!trailing && !g.atEnd()) fail(g.peek(), "expected `,` in tuple type");
    }
    if (elems.length === 1 && !trailing) return elems[0]!;
    return { k: "tuple", elems };
  }
  if (t.text === "[") {
    const g = c.group(c.next());
    const elem = parseType(g);
    if (g.eat(";")) {
      while (!g.atEnd()) g.next();
      return { k: "array", elem };
    }
    return { k: "slice", elem };
  }
  if (c.eat("!")) return { k: "never" };
  if (t.text === "dyn" || t.text === "impl" || t.text === "<") fail(t, `unsupported type syntax \`${t.text}\``);
  const global = c.is(":") && c.is(":", 1);
  if (global) {
    c.next();
    c.next();
  }
  const segs: { name: string; args: RType[] }[] = [];
  for (;;) {
    const name = c.ident().text;
    const args: RType[] = [];
    if (c.eat("<")) {
      while (!c.eat(">")) {
        if (c.peek()?.kind.$ === "Lifetime") c.next();
        else args.push(parseType(c));
        if (!c.eat(",") && !c.is(">")) fail(c.peek(), "expected `,` or `>` in generic arguments");
      }
    }
    segs.push({ name, args });
    if (c.is(":") && c.is(":", 1)) {
      c.next();
      c.next();
      continue;
    }
    break;
  }
  return { k: "path", segs, global };
}

// ---- `use` scope of queries.rs ------------------------------------------------------------------

/** name -> absolute path (`crate::` replaced by `rustc_middle::`). */
type Scope = Map<string, string>;

function parseUses(toks: Tok[], end: number): Scope {
  const scope: Scope = new Map();
  const c = new Cursor(toks, 0, end);
  const add = (prefix: string[], g: Cursor): void => {
    // one use-tree
    const path = [...prefix];
    for (;;) {
      if (g.is("{")) {
        const inner = g.group(g.next());
        while (!inner.atEnd()) {
          add(path, inner);
          inner.eat(",");
        }
        return;
      }
      if (g.is("*")) {
        g.next();
        return; // glob: names unknown (none used by queries.rs types)
      }
      const id = g.ident().text;
      if (g.is(":") && g.is(":", 1)) {
        g.next();
        g.next();
        path.push(id);
        continue;
      }
      let name = id;
      let full = [...path, id];
      if (id === "self") {
        full = path;
        name = path[path.length - 1]!;
      }
      if (g.eat("as")) name = g.ident().text;
      const abs = full.map((s, i) => (i === 0 && s === "crate" ? "rustc_middle" : s)).join("::");
      scope.set(name, abs);
      return;
    }
  };
  while (!c.atEnd()) {
    const t = c.next();
    if (t.text === "use") {
      add([], c);
      c.expect(";");
    }
  }
  return scope;
}

// ---- rustc_queries! entries ---------------------------------------------------------------------

export interface Query {
  name: string;
  line: number;
  doc: string[];
  /** key pattern as written (`key`, `_`, `()`, `(a, b)`) */
  key_pat: string;
  /** names bound by the key pattern, in order; a single `name` for an identifier pattern */
  key_bind: { k: "ident"; name: string } | { k: "tuple"; names: (string | undefined)[] } | { k: "none" };
  key_ty: RType;
  key_text: string;
  /** `None` for `-> ()` omitted (query.rs normalizes it to `-> ()`) */
  ret_ty: RType;
  ret_text: string;
  modifiers: Record<Modifier, boolean>;
  desc: { toks: Tok[]; line: number };
  returns_error_guaranteed: boolean;
}
export interface NonQuery {
  name: string;
  doc: string[];
}

function parsePattern(c: Cursor): Query["key_bind"] {
  if (c.eat("_")) return { k: "none" };
  if (c.is("(")) {
    const g = c.group(c.next());
    const names: (string | undefined)[] = [];
    while (!g.atEnd()) {
      if (g.eat("_")) names.push(undefined);
      else names.push(g.ident().text);
      g.eat(",");
    }
    return names.length === 0 ? { k: "none" } : { k: "tuple", names };
  }
  const id = c.ident();
  return { k: "ident", name: id.text };
}

export function parseQueries(src: string): { queries: Query[]; nonQueries: NonQuery[]; scope: Scope } {
  const toks = lex(src);
  const start = toks.findIndex((t, i) => t.text === "rustc_queries" && toks[i + 1]?.text === "!" && toks[i + 2]?.text === "{");
  if (start < 0) fail(undefined, "`rustc_queries! {` not found");
  const scope = parseUses(toks, start);
  const outer = new Cursor(toks, start + 2, toks.length, true);
  const body = outer.group(outer.next());
  const queries: Query[] = [];
  const nonQueries: NonQuery[] = [];
  const seen = new Set<string>();
  while (!body.atEnd()) {
    const doc: string[] = [];
    for (let t = body.peek(); t !== undefined && t.doc !== undefined; t = body.peek()) doc.push(body.next().doc!);
    const kw = body.ident();
    if (kw.text === "non_query") {
      nonQueries.push({ name: body.ident().text, doc });
      continue;
    }
    if (kw.text !== "query") fail(kw, "expected `query` or `non_query`");
    const nameTok = body.ident();
    const name = nameTok.text;
    if (seen.has(name)) fail(nameTok, `duplicate query \`${name}\``);
    seen.add(name);
    const parens = body.group(body.expect("("));
    const patFrom = parens.i;
    const key_bind = parsePattern(parens);
    const key_pat = parens.textFrom(patFrom);
    parens.expect(":");
    const keyFrom = parens.i;
    const key_ty = parseType(parens);
    const key_text = parens.textFrom(keyFrom);
    parens.eat(",");
    if (!parens.atEnd()) fail(parens.peek(), "unexpected tokens after the query key");
    let ret_ty: RType = { k: "tuple", elems: [] };
    let ret_text = "()";
    if (body.is("-") && body.is(">", 1)) {
      body.next();
      body.next();
      const from = body.i;
      ret_ty = parseType(body);
      ret_text = body.textFrom(from);
    }
    const mods = body.group(body.expect("{"));
    const modifiers = Object.fromEntries(MODIFIERS.map((m) => [m, false])) as Record<Modifier, boolean>;
    let desc: Query["desc"] | undefined;
    while (!mods.atEnd()) {
      const m = mods.ident();
      if (m.text === "desc") {
        if (desc !== undefined) fail(m, "duplicate modifier");
        const g = mods.group(mods.expect("{"));
        const dt: Tok[] = [];
        while (!g.atEnd()) dt.push(g.next());
        desc = { toks: dt, line: m.line };
      } else if ((MODIFIERS as readonly string[]).includes(m.text)) {
        if (modifiers[m.text as Modifier]) fail(m, "duplicate modifier");
        modifiers[m.text as Modifier] = true;
      } else fail(m, "unknown query modifier");
    }
    if (desc === undefined) fail(nameTok, "no description provided");
    if (modifiers.feedable && modifiers.eval_always) fail(nameTok, `Query ${name} cannot be both \`feedable\` and \`eval_always\`.`);
    queries.push({
      name,
      line: nameTok.line,
      doc,
      key_pat,
      key_bind,
      key_ty,
      key_text,
      ret_ty,
      ret_text,
      modifiers,
      desc,
      returns_error_guaranteed: returnsErrorGuaranteed(ret_ty),
    });
  }
  return { queries, nonQueries, scope };
}

/** query.rs `returns_error_guaranteed`: the last path segment is `Result<_, ErrorGuaranteed>` (as written). */
function returnsErrorGuaranteed(t: RType): boolean {
  if (t.k !== "path") return false;
  const last = t.segs[t.segs.length - 1]!;
  if (last.name !== "Result" || last.args.length !== 2) return false;
  const e = last.args[1]!;
  return e.k === "path" && !e.global && e.segs.length === 1 && e.segs[0]!.name === "ErrorGuaranteed" && e.segs[0]!.args.length === 0;
}

// ---- type resolution / mapping ------------------------------------------------------------------

interface Config {
  aliases: Record<string, string>;
  keys: Record<string, string>;
  into_key: Record<string, string>;
  display: Record<string, { ts: string; imports?: Record<string, string[]> }>;
  methods: Record<string, string>;
  fns: Record<string, { ts: string; module: string; ret: string }>;
  consts: Record<string, { ts: string; module: string; ty: string }>;
  structs: Record<string, { params: string[]; alias?: string; fields?: Record<string, string> }>;
  rust_methods: Record<string, Record<string, { ts: string; ret: string; params?: string[]; imports?: Record<string, string[]> }>>;
  tagged_enums: string[];
  types?: TypeMapEntry[];
}

/** A generated type found through a `// rustc-type:` marker. */
interface GenType {
  rust: string;
  ts: string;
  module: string;
  arity: number;
  debug: string | undefined;
}

function walkGen(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkGen(p, out);
    else if (e.name.endsWith(".gen.ts")) out.push(p);
  }
  return out;
}

function moduleOf(upstream: string): string {
  // compiler/<crate>/src/<path>.rs -> <crate>::<path...>
  const m = /^compiler\/([^/]+)\/src\/(.+)\.rs$/.exec(upstream);
  if (!m) return upstream;
  const parts = m[2]!.split("/");
  const last = parts[parts.length - 1]!;
  if (last === "lib" || last === "mod") parts.pop();
  return [m[1]!, ...parts].join("::");
}

/** Index of every generated type (`// rustc-type: <upstream>:<line> <Name>` in src/**\/*.gen.ts). */
export function genTypeIndex(srcRoot: string): Map<string, GenType> {
  const idx = new Map<string, GenType>();
  for (const file of walkGen(srcRoot)) {
    const text = readFileSync(file, "utf8");
    const hand = file.replace(/\.gen\.ts$/, ".ts");
    const module = relative(REPO, existsSync(hand) ? hand : file);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^\/\/ rustc-type: (\S+):\d+ (\w+)$/.exec(lines[i]!);
      if (!m) continue;
      const name = m[2]!;
      let arity = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const d = new RegExp(`^export (?:type|interface|class|declare class) ${name}(<[^=>{]*>)?`).exec(lines[j]!);
        if (d) {
          arity = d[1] ? d[1].split(",").length : 0;
          break;
        }
      }
      const debug = new RegExp(`export (?:const|function) debug_${name}\\b`).test(text) || (existsSync(hand) && new RegExp(`export (?:const|function) debug_${name}\\b`).test(readFileSync(hand, "utf8"))) ? `debug_${name}` : undefined;
      idx.set(`${moduleOf(m[1]!)}::${name}`, { rust: `${moduleOf(m[1]!)}::${name}`, ts: name, module, arity, debug });
    }
  }
  return idx;
}

export interface Report {
  unknown_types: Record<string, string[]>;
  unported_desc: Record<string, string>;
  unported_keys: Record<string, string[]>;
  missing_debug: Record<string, string[]>;
  /** value types of hashed (not `no_hash`) queries with no `StableHash` impl (`hash_result` is unported for them) */
  missing_stable_hash: Record<string, string[]>;
}

/** Collected imports: module (repo-relative) -> names (`type X` for type-only). */
class Imports {
  m = new Map<string, Map<string, { local: string; typeOnly: boolean }>>();
  /** local name -> module that owns it */
  private owner = new Map<string, string>();
  /** Adds an import and returns the local name (aliased `<name>_<n>` when another module already uses `name`). */
  add(module: string, name: string, typeOnly = false): string {
    const s = this.m.get(module) ?? new Map<string, { local: string; typeOnly: boolean }>();
    this.m.set(module, s);
    const cur = s.get(name);
    if (cur !== undefined) {
      if (!typeOnly) cur.typeOnly = false;
      return cur.local;
    }
    let local = name;
    for (let n = 1; this.owner.has(local) && this.owner.get(local) !== module; n++) local = `${name}_${n}`;
    this.owner.set(local, module);
    s.set(name, { local, typeOnly });
    return local;
  }
  /** `tpl` with each of `names` (imported from `module`) replaced by its local name. */
  rename(tpl: string, module: string, names: readonly string[], typeOnly: boolean): string {
    for (const n of names) {
      const local = this.add(module, n, typeOnly);
      if (local !== n) tpl = tpl.replace(new RegExp(`(?<![\\w$])${n}(?![\\w$])`, "g"), local);
    }
    return tpl;
  }
  render(fromFile: string): string[] {
    const out: string[] = [];
    for (const [mod, names] of [...this.m].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      let rel = relative(dirname(fromFile), mod).replaceAll("\\", "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      const list = [...names]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([n, { local, typeOnly }]) => `${typeOnly ? "type " : ""}${n}${local !== n ? ` as ${local}` : ""}`);
      out.push(`import { ${list.join(", ")} } from "${rel}";`);
    }
    return out;
  }
}

interface Mapped {
  ts: string;
  /** Debug expression of a value `$v` with formatter `$f`, or undefined */
  debug: ((v: string, f: string) => string) | undefined;
  /**
   * `StableHash` impl of the type as a TS expression of type `StableHash<T>` (`stable_hash_<T>` or a closure
   * passing the type arguments' impls), or undefined. Imports are added when it is called.
   */
  sh: (() => string) | undefined;
  /** canonical Rust text (resolved paths), for keys / display / reports */
  canon: string;
  /** resolved absolute path for paths */
  path?: string;
  args?: Mapped[];
  known: boolean;
}

class TypeMapper {
  private entries = new Map<string, TypeMapEntry>();
  constructor(
    readonly tm: TypeMap,
    readonly gen: Map<string, GenType>,
    readonly cfg: Config,
    readonly scope: Scope,
    readonly imports: Imports,
    readonly report: Report,
  ) {
    for (const e of tm.types) for (const p of e.paths) this.entries.set(p, e);
    this.shMap = loadStableHashMap();
    for (const e of this.shMap.types) for (const p of e.paths) this.shEntries.set(p, e);
  }

  // ---- StableHash of query values (`hash_result`, dep_graph/graph.rs) ----
  private shMap: { module: string; types: StableHashMapEntry[] };
  private shEntries = new Map<string, StableHashMapEntry>();
  private exportsCache = new Map<string, string>();

  /** A `stable_hash_*` helper of tools/codegen/stable_hash.json's module (rustc_data_structures/stable_hash.ts). */
  private shHelper(name: string, module = this.shMap.module): () => string {
    return () => this.imports.add(module, name);
  }

  /** Whether `module` (repo-relative) exports a value `name`. */
  private exportsValue(module: string, name: string): boolean {
    let text = this.exportsCache.get(module);
    if (text === undefined) {
      text = existsSync(join(REPO, module)) ? readFileSync(join(REPO, module), "utf8") : "";
      this.exportsCache.set(module, text);
    }
    return new RegExp(`^export (?:function|const) ${name}\\b`, "m").test(text);
  }

  /**
   * `StableHash` of the type at `path` with type arguments `args`: an external impl from stable_hash.json, or the
   * `stable_hash_<Name>` of a ported type (derived: `<crate>/stable_hash.gen.ts`; manual: the type's module).
   */
  private stableHash(path: string, typeModule: string | undefined, args: Mapped[]): (() => string) | undefined {
    const e = this.shEntries.get(path);
    if (e !== undefined) {
      if (e.transparent) return args[0]?.sh;
      if (e.stable_hash === undefined) return undefined;
      if (args.some((a) => a.sh === undefined)) return undefined;
      // `Option<T>` with an undefined-able `T` is `{ $: "Some", _0 } | undefined` (PORTING §5): not mapped here.
      if (e.stable_hash_nullable !== undefined && args[0] !== undefined && /\bundefined\b/.test(args[0].ts)) return undefined;
      if (e.u8_seq && args[0]?.canon === "u8") return this.shHelper("stable_hash_bytes");
      const tpl = e.stable_hash;
      const module = e.import ?? this.shMap.module;
      return () => {
        let out = tpl;
        for (const m of tpl.matchAll(/\b(stable_hash_\w+)\(/g)) out = this.imports.rename(out, module, [m[1]!], false);
        const simple = /^(\w+)\(\$v, \$hcx, \$h\)$/.exec(out);
        if (simple) return simple[1]!;
        out = out.replaceAll("$v", "v").replaceAll("$hcx", "hcx").replaceAll("$h", "h");
        for (let i = args.length - 1; i >= 0; i--) out = out.replaceAll(`$s${i}`, args[i]!.sh!());
        return `(v, hcx, h) => ${out}`;
      };
    }
    const name = `stable_hash_${path.split("::").pop()!}`;
    const derived = `src/${path.split("::")[0]}/stable_hash.gen.ts`;
    const module = this.exportsValue(derived, name) ? derived : typeModule !== undefined && this.exportsValue(typeModule, name) ? typeModule : undefined;
    if (module === undefined || args.some((a) => a.sh === undefined)) return undefined;
    return () => {
      const local = this.imports.add(module, name);
      return args.length === 0 ? local : `(v, hcx, h) => ${local}(v, hcx, h, ${args.map((a) => a.sh!()).join(", ")})`;
    };
  }

  /** Resolves a path's segments to an absolute Rust path through queries.rs's `use`s and the aliases. */
  resolve(segs: string[], global: boolean): string {
    let path: string[];
    if (!global && this.scope.has(segs[0]!)) path = [...this.scope.get(segs[0]!)!.split("::"), ...segs.slice(1)];
    else path = segs.map((s, i) => (i === 0 && s === "crate" ? "rustc_middle" : s));
    let p = path.join("::");
    let best = "";
    for (const a of Object.keys(this.cfg.aliases)) if ((p === a || p.startsWith(a.endsWith("::") ? a : `${a}::`)) && a.length > best.length) best = a;
    if (best !== "") p = this.cfg.aliases[best]! + p.slice(best.length);
    return p;
  }

  map(t: RType, at: string): Mapped {
    switch (t.k) {
      case "never":
        return { ts: "never", debug: undefined, sh: this.shHelper("stable_hash_never"), canon: "!", known: true };
      case "ref": {
        const e = this.map(t.elem, at);
        // PORTING §5: `&T` -> `T`
        return { ...e, canon: e.canon };
      }
      case "tuple": {
        if (t.elems.length === 0) return { ts: "null", debug: () => `"()"`, sh: this.shHelper("stable_hash_unit"), canon: "()", known: true };
        const es = t.elems.map((e) => this.map(e, at));
        const dbgs = es.map((e) => e.debug);
        const debug = dbgs.every((d) => d !== undefined)
          ? (v: string, f: string) => {
              this.imports.add("src/std/fmt.ts", "debug_tuple");
              return `debug_tuple(${f}, "", [${dbgs.map((d, i) => d!(`${v}[${i}]`, f)).join(", ")}])`;
            }
          : undefined;
        const sh =
          es.length <= 4 && es.every((e) => e.sh !== undefined)
            ? () => {
                const tup = this.shHelper(`stable_hash_tuple${es.length}`)!();
                return `(v, hcx, h) => ${tup}(v, hcx, h, ${es.map((e) => e.sh!()).join(", ")})`;
              }
            : undefined;
        return { ts: `[${es.map((e) => e.ts).join(", ")}]`, debug, sh, canon: `(${es.map((e) => e.canon).join(", ")})`, known: es.every((e) => e.known), args: es };
      }
      case "slice":
      case "array": {
        const e = this.map(t.elem, at);
        const debug = e.debug
          ? (v: string, f: string) => {
              this.imports.add("src/std/fmt.ts", "debug_vec");
              return `debug_vec(${v}, ${f}, (x, f) => ${e.debug!("x", "f")})`;
            }
          : undefined;
        // stable_hash.rs: `[T]` hashes its length then the elements; `[u8]` hashes the bytes (`stable_hash_bytes`).
        const sh =
          e.canon === "u8"
            ? this.shHelper("stable_hash_bytes")
            : e.sh !== undefined
              ? () => `(v, hcx, h) => ${this.shHelper("stable_hash_slice")!()}(v, hcx, h, ${e.sh!()})`
              : undefined;
        return { ts: `readonly ${wrapUnion(e.ts)}[]`, debug, sh, canon: `[${e.canon}]`, known: e.known, args: [e] };
      }
      case "path": {
        const path = this.resolve(
          t.segs.map((s) => s.name),
          t.global,
        );
        const args = t.segs[t.segs.length - 1]!.args.map((a) => this.map(a, at));
        const canon = args.length ? `${path}<${args.map((a) => a.canon).join(", ")}>` : path;
        const entry = this.entries.get(path);
        if (entry !== undefined) {
          const needs = (tpl: string, prefix: string): number[] => [...tpl.matchAll(new RegExp(`\\${prefix}(\\d)`, "g"))].map((m) => Number(m[1]));
          if ([...needs(entry.ts, "$"), ...(entry.debug ? needs(entry.debug, "$d") : [])].some((i) => args[i] === undefined)) {
            // A defaulted type argument (`Visibility<Id = LocalModId>`) the template cannot express.
            (this.report.unknown_types[`${canon} (missing type argument)`] ??= []).push(at);
            return { ts: "unknown", debug: undefined, sh: undefined, canon, path, args, known: false };
          }
          const sub = (tpl: string, which: "ts" | "debug", v = "", f = ""): string => {
            let out = tpl.replaceAll("$v", v).replaceAll("$f", f);
            for (let i = args.length - 1; i >= 0; i--) {
              if (which === "debug") out = out.replaceAll(`$d${i}`, `((x, f) => ${args[i]!.debug!("x", "f")})`);
              out = out.replaceAll(`$${i}`, which === "ts" ? args[i]!.ts : "");
            }
            return out;
          };
          const tsTpl = entry.import !== undefined ? this.imports.rename(entry.ts, entry.import, entry.types ?? [], true) : entry.ts;
          const ts = sub(tsTpl, "ts");
          const dbgTpl = entry.debug === null || /\bunported_debug\b/.test(entry.debug) ? null : entry.debug;
          const argsDebuggable = !dbgTpl || !/\$d\d/.test(dbgTpl) || args.every((a) => a.debug !== undefined);
          const debug =
            dbgTpl && dbgTpl !== "transparent" && argsDebuggable
              ? (v: string, f: string): string => {
                  let tpl = dbgTpl;
                  if (entry.import !== undefined) tpl = this.imports.rename(tpl, entry.import, entry.values ?? [], false);
                  for (const [mod, hs] of Object.entries(this.tm.helpers)) for (const h of hs) if (new RegExp(`\\b${h}\\(`).test(dbgTpl)) tpl = this.imports.rename(tpl, mod, [h], false);
                  return sub(tpl, "debug", v, f);
                }
              : dbgTpl === "transparent"
                ? args[0]?.debug
                : undefined;
          return { ts, debug, sh: this.stableHash(path, entry.import, args), canon, path, args, known: args.every((a) => a.known) && !/\bunknown\b/.test(ts) };
        }
        const g = this.gen.get(path);
        if (g !== undefined && g.arity === args.length) {
          const local = this.imports.add(g.module, g.ts, true);
          const ts = args.length ? `${local}<${args.map((a) => a.ts).join(", ")}>` : local;
          const debug =
            g.debug && args.every((a) => a.debug)
              ? (v: string, f: string): string => {
                  const dlocal = this.imports.add(g.module, g.debug!);
                  return `${dlocal}(${[v, f, ...args.map((a) => `(x, f) => ${a.debug!("x", "f")}`)].join(", ")})`;
                }
              : undefined;
          return { ts, debug, sh: this.stableHash(path, g.module, args), canon, path, args, known: args.every((a) => a.known) };
        }
        (this.report.unknown_types[canon] ??= []).push(at);
        return { ts: "unknown", debug: undefined, sh: undefined, canon, path, args, known: false };
      }
    }
  }
}

function wrapUnion(ts: string): string {
  return /[|&]/.test(ts) && !/^\(.*\)$/.test(ts) ? `(${ts})` : ts;
}

// ---- desc translation ---------------------------------------------------------------------------

type DescTy = { k: "rust"; t: RType } | { k: "string" } | { k: "tcx" } | { k: "unknown"; why: string };

class Unsupported extends Error {}
const unsupported = (why: string): never => {
  throw new Unsupported(why);
};

type DExpr =
  | { k: "str"; v: string }
  | { k: "path"; segs: string[] }
  | { k: "ref"; e: DExpr }
  | { k: "field"; e: DExpr; name: string }
  | { k: "method"; e: DExpr; name: string; args: DExpr[] }
  | { k: "call"; f: DExpr; args: DExpr[] }
  | { k: "match"; e: DExpr; arms: { pats: string[][] | "wild"; body: DExpr }[] };

function strLit(t: Tok): string | undefined {
  if (t.kind.$ !== "Literal") return undefined;
  const lit = t.kind.kind;
  if (lit.$ !== "Str") return undefined;
  // Escapes in desc strings at the pin: none besides `\"`; reject anything else so nothing is guessed.
  const body = t.text.slice(1, -1);
  if (/\\[^"\\]/.test(body)) unsupported(`string escape in ${t.text}`);
  return body.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function parseDExpr(c: Cursor): DExpr {
  if (c.eat("&")) return { k: "ref", e: parseDExpr(c) };
  const t = c.next();
  let e: DExpr;
  const s = strLit(t);
  if (s !== undefined) e = { k: "str", v: s };
  else if (t.text === "match") {
    const scrut = parseDExprNoStruct(c);
    const g = c.group(c.expect("{"));
    const arms: { pats: string[][] | "wild"; body: DExpr }[] = [];
    while (!g.atEnd()) {
      let pats: string[][] | "wild";
      if (g.eat("_")) pats = "wild";
      else {
        pats = [];
        do {
          const segs = [g.ident().text];
          while (g.is(":") && g.is(":", 1)) {
            g.next();
            g.next();
            segs.push(g.ident().text);
          }
          if (g.is("(") || g.is("{")) unsupported("match pattern with fields");
          pats.push(segs);
        } while (g.eat("|"));
      }
      g.expect("=");
      g.expect(">");
      const body = parseDExpr(g);
      arms.push({ pats, body });
      g.eat(",");
    }
    e = { k: "match", e: scrut, arms };
  } else if (t.kind.$ === "Ident") {
    const segs = [t.text];
    while (c.is(":") && c.is(":", 1)) {
      c.next();
      c.next();
      segs.push(c.ident().text);
    }
    e = { k: "path", segs };
  } else return unsupported(`expression starting with \`${t.text}\``);
  for (;;) {
    if (c.is(".")) {
      c.next();
      const f = c.next();
      if (f.kind.$ === "Literal" && /^\d+$/.test(f.text)) e = { k: "field", e, name: f.text };
      else if (f.kind.$ === "Literal" && /^\d+\.\d+$/.test(f.text)) {
        const [a, b] = f.text.split(".");
        e = { k: "field", e: { k: "field", e, name: a! }, name: b! };
      } else if (f.kind.$ === "Ident") {
        if (c.is("(")) {
          const g = c.group(c.next());
          e = { k: "method", e, name: f.text, args: parseArgs(g) };
        } else e = { k: "field", e, name: f.text };
      } else unsupported(`field \`${f.text}\``);
    } else if (c.is("(") && e.k === "path") {
      const g = c.group(c.next());
      e = { k: "call", f: e, args: parseArgs(g) };
    } else break;
  }
  return e;
}
const parseDExprNoStruct = parseDExpr;
function parseArgs(g: Cursor): DExpr[] {
  const out: DExpr[] = [];
  while (!g.atEnd()) {
    out.push(parseDExpr(g));
    if (!g.eat(",") && !g.atEnd()) unsupported(`unsupported expression syntax at \`${g.peek()?.text}\``);
  }
  return out;
}

/** Rust format string pieces: literal text and `{arg[:spec]}` holes. */
function parseFormat(fmt: string): ({ lit: string } | { arg: string; spec: "" | "?" })[] {
  const out: ({ lit: string } | { arg: string; spec: "" | "?" })[] = [];
  let lit = "";
  let next = 0;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]!;
    if (ch === "{" && fmt[i + 1] === "{") {
      lit += "{";
      i++;
    } else if (ch === "}" && fmt[i + 1] === "}") {
      lit += "}";
      i++;
    } else if (ch === "{") {
      const j = fmt.indexOf("}", i);
      if (j < 0) unsupported("unterminated format hole");
      const inner = fmt.slice(i + 1, j);
      const [argPart, spec = ""] = inner.split(":") as [string, string?];
      if (spec !== "" && spec !== "?") unsupported(`format spec \`${spec}\``);
      if (lit) out.push({ lit });
      lit = "";
      out.push({ arg: argPart === "" ? String(next++) : argPart, spec: spec as "" | "?" });
      i = j;
    } else if (ch === "}") unsupported("unmatched `}` in format string");
    else lit += ch;
  }
  if (lit) out.push({ lit });
  return out;
}

const tsTemplate = (s: string): string => s.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");

function parseRust(rust: string): RType {
  const toks = lex(rust);
  return parseType(new Cursor(toks, 0, toks.length));
}

/** `r` with the type parameters `params` (single-segment paths) replaced by `args`. */
function substParams(params: string[], args: RType[], r: RType): RType {
  switch (r.k) {
    case "path": {
      const i = !r.global && r.segs.length === 1 && r.segs[0]!.args.length === 0 ? params.indexOf(r.segs[0]!.name) : -1;
      if (i >= 0) return args[i]!;
      return { ...r, segs: r.segs.map((g) => ({ name: g.name, args: g.args.map((a) => substParams(params, args, a)) })) };
    }
    case "ref":
    case "slice":
    case "array":
      return { ...r, elem: substParams(params, args, r.elem) };
    case "tuple":
      return { k: "tuple", elems: r.elems.map((e) => substParams(params, args, e)) };
    case "never":
      return r;
  }
}

class DescTranslator {
  constructor(
    readonly mapper: TypeMapper,
    readonly cfg: Config,
    readonly queries: Map<string, Query>,
    readonly imports: Imports,
  ) {}

  /** Returns the TS body (an expression of type string) for `format!($desc)`. */
  translate(q: Query, env: Map<string, RType>): string {
    const c = new Cursor(q.desc.toks, 0, q.desc.toks.length);
    const first = c.next();
    const fmt = strLit(first);
    if (fmt === undefined) return unsupported("desc does not start with a string literal");
    // `format_args!` evaluates its explicit arguments once each, in the order they are written.
    const args: { name: string | undefined; e: DExpr }[] = [];
    while (c.eat(",")) {
      if (c.atEnd()) break;
      if (c.peek()?.kind.$ === "Ident" && c.is("=", 1) && !c.is("=", 2)) {
        const n = c.next().text;
        c.next();
        args.push({ name: n, e: parseDExpr(c) });
      } else args.push({ name: undefined, e: parseDExpr(c) });
    }
    if (!c.atEnd()) unsupported(`unexpected \`${c.peek()?.text}\` in desc`);
    let lets = "";
    const tys: DescTy[] = [];
    args.forEach((a, i) => {
      const [ts, ty] = this.expr(a.e, env);
      lets += `const __${i} = ${ts}; `;
      tys.push(ty);
    });
    const positional = args.map((a, i) => (a.name === undefined ? i : -1)).filter((i) => i >= 0);
    let out = "";
    for (const p of parseFormat(fmt)) {
      if ("lit" in p) {
        out += tsTemplate(p.lit);
        continue;
      }
      if (/^\d+$/.test(p.arg)) {
        const i = positional[Number(p.arg)];
        if (i === undefined) unsupported(`format argument \`${p.arg}\` not found`);
        out += "${" + this.format(`__${i}`, tys[i]!, p.spec) + "}";
        continue;
      }
      const i = args.findIndex((a) => a.name === p.arg);
      if (i >= 0) out += "${" + this.format(`__${i}`, tys[i]!, p.spec) + "}";
      else if (env.has(p.arg)) out += "${" + this.format(p.arg, { k: "rust", t: env.get(p.arg)! }, p.spec) + "}";
      else unsupported(`format argument \`${p.arg}\` not found`);
    }
    return lets === "" ? `\`${out}\`` : `{ ${lets}return \`${out}\`; }`;
  }

  format(v: string, ty: DescTy, spec: "" | "?"): string {
    if (ty.k === "unknown") return unsupported(ty.why);
    if (ty.k === "tcx") return unsupported("formatting tcx");
    if (spec === "") {
      if (ty.k === "string") return v;
      const m = this.mapper.map(ty.t, "desc");
      const base = m.path ?? m.canon;
      const d = this.cfg.display[base];
      if (d === undefined) return unsupported(`Display of \`${m.canon}\``);
      for (const [mod, names] of Object.entries(d.imports ?? {})) for (const n of names) this.imports.add(mod, n);
      return d.ts.replaceAll("$v", v);
    }
    if (ty.k === "string") {
      this.imports.add("src/std/fmt.ts", "debug_str");
      return `debug_str(${v})`;
    }
    const m = this.mapper.map(ty.t, "desc");
    if (m.debug === undefined) return unsupported(`Debug of \`${m.canon}\``);
    this.imports.add("src/std/fmt.ts", "PLAIN");
    return m.debug(v, "PLAIN");
  }

  expr(e: DExpr, env: Map<string, RType>): [string, DescTy] {
    switch (e.k) {
      case "str":
        return [JSON.stringify(e.v), { k: "string" }];
      case "ref":
        return this.expr(e.e, env);
      case "path": {
        if (e.segs.length === 1 && e.segs[0] === "tcx") return ["tcx", { k: "tcx" }];
        if (e.segs.length === 1 && env.has(e.segs[0]!)) return [e.segs[0]!, { k: "rust", t: env.get(e.segs[0]!)! }];
        const c = this.cfg.consts[this.mapper.resolve(e.segs, false)];
        if (c !== undefined) {
          this.imports.add(c.module, c.ts);
          return [c.ts, this.retTy(c.ty)];
        }
        return unsupported(`path \`${e.segs.join("::")}\``);
      }
      case "field": {
        const [ts, ty] = this.expr(e.e, env);
        if (ty.k === "rust" && /^\d+$/.test(e.name)) {
          const t = ty.t.k === "ref" ? ty.t.elem : ty.t;
          if (t.k === "tuple" && Number(e.name) < t.elems.length) return [`${ts}[${e.name}]`, { k: "rust", t: t.elems[Number(e.name)]! }];
        }
        if (ty.k === "rust") {
          const ft = this.fieldTy(ty.t, e.name);
          if (ft !== undefined) return [`${ts}.${e.name}`, { k: "rust", t: ft }];
        }
        return unsupported(`field \`.${e.name}\``);
      }
      case "method": {
        const [recv, rty] = this.expr(e.e, env);
        if (rty.k === "rust") {
          const t = rty.t.k === "ref" ? rty.t.elem : rty.t;
          const m = t.k === "path" ? this.cfg.rust_methods[this.mapper.resolve(t.segs.map((s) => s.name), t.global)]?.[e.name] : undefined;
          if (m === undefined || t.k !== "path") return unsupported(`method \`.${e.name}()\` on a non-tcx receiver`);
          for (const [mod, names] of Object.entries(m.imports ?? {})) for (const n of names) this.imports.add(mod, n);
          let out = m.ts.replaceAll("$v", recv);
          const args = e.args.map((a) => this.expr(a, env)[0]);
          for (let i = args.length - 1; i >= 0; i--) out = out.replaceAll(`$${i}`, args[i]!);
          if (m.ret === "String" || m.ret === "str") return [out, { k: "string" }];
          const targs = t.segs[t.segs.length - 1]!.args;
          const params = m.params ?? [];
          if (targs.length !== params.length) return unsupported(`method \`.${e.name}()\` of a receiver with ${targs.length} type arguments`);
          return [out, { k: "rust", t: substParams(params, targs, parseRust(m.ret)) }];
        }
        if (rty.k !== "tcx") return unsupported(`method \`.${e.name}()\` on a non-tcx receiver`);
        const args = e.args.map((a) => this.expr(a, env)[0]);
        const q = this.queries.get(e.name);
        if (q !== undefined) return [`${recv}.${e.name}(${args.join(", ")})`, { k: "rust", t: q.ret_ty }];
        const ret = this.cfg.methods[e.name];
        if (ret === undefined) return unsupported(`TyCtxt method \`${e.name}\``);
        return [`${recv}.${e.name}(${args.join(", ")})`, this.retTy(ret)];
      }
      case "call": {
        if (e.f.k !== "path" || e.f.segs.length !== 1) return unsupported("call of a path");
        const f = this.cfg.fns[e.f.segs[0]!];
        if (f === undefined) return unsupported(`function \`${e.f.segs.join("::")}\``);
        this.imports.add(f.module, f.ts);
        return [`${f.ts}(${e.args.map((a) => this.expr(a, env)[0]).join(", ")})`, this.retTy(f.ret)];
      }
      case "match": {
        const [scrut, sty] = this.expr(e.e, env);
        if (sty.k !== "rust") return unsupported("match on a non-Rust value");
        const m = this.mapper.map(sty.t, "desc");
        const enumPath = m.path ?? "";
        const tagged = this.cfg.tagged_enums.includes(enumPath);
        let body = "const __m = " + scrut + "; ";
        let resTy: DescTy | undefined;
        for (const arm of e.arms) {
          const [bts, bty] = this.expr(arm.body, env);
          if (resTy === undefined) resTy = bty;
          else if (resTy.k !== bty.k) return unsupported("match arms of different types");
          if (arm.pats === "wild") {
            body += `return ${bts};`;
            break;
          }
          const conds = arm.pats.map((segs) => {
            const variant = segs[segs.length - 1]!;
            const enumSegs = segs.slice(0, -1);
            const resolved = this.mapper.resolve(enumSegs, false);
            if (resolved !== enumPath) unsupported(`match pattern \`${segs.join("::")}\` of another type`);
            return tagged ? `__m.$ === ${JSON.stringify(variant)}` : `__m === ${JSON.stringify(variant)}`;
          });
          body += `if (${conds.join(" || ")}) return ${bts}; `;
        }
        if (!e.arms.some((a) => a.pats === "wild")) return unsupported("match without a wildcard arm");
        return [`(() => { ${body} })()`, resTy!];
      }
    }
  }

  /**
   * Type of field `name` of a value of Rust type `t`, from queries.config.json's `structs` (type aliases are expanded
   * first; the struct's type parameters are substituted with `t`'s type arguments).
   */
  fieldTy(t: RType, name: string): RType | undefined {
    for (;;) {
      if (t.k === "ref") t = t.elem;
      if (t.k !== "path") return undefined;
      const path = this.mapper.resolve(
        t.segs.map((s) => s.name),
        t.global,
      );
      const s = this.cfg.structs[path];
      if (s === undefined) return undefined;
      const args = t.segs[t.segs.length - 1]!.args;
      if (args.length !== s.params.length) return unsupported(`\`${path}\` with ${args.length} type arguments`);
      if (s.alias !== undefined) {
        t = substParams(s.params, args, parseRust(s.alias));
        continue;
      }
      const f = s.fields?.[name];
      return f === undefined ? undefined : substParams(s.params, args, parseRust(f));
    }
  }

  retTy(rust: string): DescTy {
    if (rust === "String" || rust === "str") return { k: "string" };
    const toks = lex(rust);
    const c = new Cursor(toks, 0, toks.length);
    return { k: "rust", t: parseType(c) };
  }
}

// ---- generation ---------------------------------------------------------------------------------

export interface Generated {
  text: string;
  queries: Query[];
  nonQueries: NonQuery[];
  report: Report;
}

function docComment(lines: string[], indent: string): string[] {
  if (lines.length === 0) return [];
  return [`${indent}/**`, ...lines.map((l) => `${indent} *${l.replaceAll("*/", "*\\/")}`), `${indent} */`];
}

export function fingerprints(macros: string, queryApi: string): Record<string, string> {
  const mods = /struct QueryModifiers \{([\s\S]*?)\n\}/.exec(macros)?.[1] ?? "";
  const matcher = /macro_rules! define_query_api \{([\s\S]*?)\) => \{/.exec(queryApi)?.[1] ?? "";
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  return { "query.rs QueryModifiers": hash(norm(mods)), "query_api.rs define_query_api matcher": hash(norm(matcher)) };
}

export function generate(src: string, macros: string, queryApi: string, srcRoot = join(REPO, "src")): Generated {
  const fp = fingerprints(macros, queryApi);
  for (const [k, v] of Object.entries(FINGERPRINTS)) {
    if (fp[k] !== v) throw new GenError(`ERROR: ${k} changed upstream (fingerprint ${fp[k]}, expected ${v}): re-read it and update tools/codegen/queries.ts`);
  }
  const cfg: Config = JSON.parse(readFileSync(join(import.meta.dir, "queries.config.json"), "utf8"));
  const { queries, nonQueries, scope } = parseQueries(src);
  const report: Report = { unknown_types: {}, unported_desc: {}, unported_keys: {}, missing_debug: {}, missing_stable_hash: {} };
  const imports = new Imports();
  const tm = loadTypeMap();
  tm.types.unshift(...(cfg.types ?? []));
  const mapper = new TypeMapper(tm, genTypeIndex(srcRoot), cfg, scope, imports, report);
  const byName = new Map(queries.map((q) => [q.name, q]));
  const desc = new DescTranslator(mapper, cfg, byName, imports);
  const OUT = OUT_PATH;
  const local = (p: string): string => `${OUT_DIR}/${p}`;

  imports.add(local("ty/context.ts"), "TyCtxt", true);
  imports.add(local("query/query_api.ts"), "QueryDecl", true);
  imports.add("src/std/panic.ts", "unported");

  const L: string[] = [];
  const types: string[] = [];
  const decls: string[] = [];
  const keyDebug: string[] = [];
  const feedable: string[] = [];
  const ensureResult: string[] = [];
  const extern: string[] = [];

  for (const q of queries) {
    const at = `${q.name} (queries.rs:${q.line})`;
    const key = mapper.map(q.key_ty, `${at} key`);
    const val = mapper.map(q.ret_ty, `${at} value`);
    // LocalKey: `<Key as QueryKey>::LocalQueryKey` for separate_provide_extern queries.
    const keyImpl = cfg.keys[key.canon];
    if (keyImpl === undefined) (report.unported_keys[key.canon] ??= []).push(q.name);
    const keyExpr = keyImpl !== undefined ? `KEY_${keyImpl}` : `key_unported(${JSON.stringify(q.key_text)})`;
    imports.add(local("query/keys.ts"), keyImpl !== undefined ? `KEY_${keyImpl}` : "key_unported");
    let localKeyTs = key.ts;
    if (q.modifiers.separate_provide_extern) {
      imports.add(local("query/keys.ts"), "LocalQueryKeyOf", true);
      localKeyTs = keyImpl !== undefined ? `LocalQueryKeyOf<typeof KEY_${keyImpl}>` : "unknown";
    }
    const intoKey = cfg.into_key[key.canon];
    if (intoKey !== undefined) imports.add(local("query/into_query_key.ts"), intoKey);
    const keyArgTs = intoKey !== undefined ? `Parameters<typeof ${intoKey}>[0]` : key.ts;

    const notes: string[] = [];
    if (!key.known) notes.push(`key \`${q.key_text}\` not ported`);
    if (!val.known) notes.push(`value \`${q.ret_text}\` not ported`);
    types.push(
      ...docComment(q.doc, "  "),
      ...(notes.length ? [`  // PORT: ${notes.join("; ")} (\`unknown\`)`] : []),
      `  ${q.name}: { Key: ${key.ts}; KeyArg: ${keyArgTs}; LocalKey: ${localKeyTs}; Value: ${val.ts}; ProvidedValue: ${val.ts} };`,
    );

    // desc closure
    const env = new Map<string, RType>();
    let params = "_tcx, _key";
    let destructure = "";
    if (q.key_bind.k === "ident") {
      env.set(q.key_bind.name, q.key_ty);
      params = `_tcx, ${q.key_bind.name}`;
    } else if (q.key_bind.k === "tuple") {
      const t = q.key_ty;
      if (t.k !== "tuple" || t.elems.length !== q.key_bind.names.length) fail({ line: q.line }, "tuple key pattern on a non-tuple key");
      q.key_bind.names.forEach((n, i) => n && env.set(n, t.elems[i]!));
      destructure = `const [${q.key_bind.names.map((n) => n ?? "").join(", ")}] = _key; `;
    }
    let descTs: string;
    try {
      const body = desc.translate(q, env);
      const usesTcx = /\btcx\b/.test(body);
      const p = params.replace("_tcx", usesTcx ? "tcx" : "_tcx");
      descTs = destructure ? `(${p}) => { ${destructure}return ${body.startsWith("{") ? `(() => ${body})()` : body}; }` : body.startsWith("{") ? `(${p}) => ${body}` : `(${p}) => ${body}`;
      if (q.key_bind.k === "ident" && !new RegExp(`\\b${q.key_bind.name}\\b`).test(body)) descTs = descTs.replace(`, ${q.key_bind.name})`, `, _${q.key_bind.name})`);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      report.unported_desc[q.name] = e.message;
      descTs = `() => unported(${JSON.stringify(`desc of query \`${q.name}\` (${e.message})`)})`;
    }

    const debugValue = val.debug ? `(v, f) => ${val.debug("v", "f")}` : "undefined";
    if (!val.debug) (report.missing_debug[val.canon] ??= []).push(q.name);
    // `hash_value_fn` (query_vtables.rs): `hash_result(hcx, &value)` over the value's `StableHash` (not for `no_hash`).
    const stableHashValue = q.modifiers.no_hash ? "undefined" : val.sh !== undefined ? val.sh() : "undefined";
    if (!q.modifiers.no_hash && val.sh === undefined) (report.missing_stable_hash[val.canon] ??= []).push(q.name);
    decls.push(
      `  ${q.name}: {`,
      `    name: "${q.name}",`,
      `    key: ${keyExpr},`,
      `    into_key: ${intoKey ?? "into_query_key_identity"},`,
      ...MODIFIERS.map((m) => `    ${m}: ${q.modifiers[m]},`),
      `    returns_error_guaranteed: ${q.returns_error_guaranteed},`,
      `    desc: ${descTs},`,
      `    debug_value: ${debugValue},`,
      `    stable_hash_value: ${stableHashValue},`,
      `  },`,
    );
    if (intoKey === undefined) imports.add(local("query/into_query_key.ts"), "into_query_key_identity");
    if (q.modifiers.feedable) feedable.push(q.name);
    if (q.returns_error_guaranteed) ensureResult.push(q.name);
    if (q.modifiers.separate_provide_extern) extern.push(q.name);
    void keyDebug;
  }

  L.push(
    `// GENERATED by tools/codegen/queries.ts from ${SRC_PATH} @ ${PIN.commit.slice(0, 12)}. Do not edit.`,
    "// The `rustc_queries!` list as `define_query_api!` (query/query_api.rs) and `define_queries!`",
    "// (rustc_query_impl/src/query_vtables.rs) see it: per-query types (`QueryTypes`), the modifier list and",
    "// `desc` closure (`QUERY_DECLS`), and the typed method / provider tables. query/query_api.ts implements",
    "// them generically. PORT: `unknown` types are not ported yet (see the PORT notes); calling such a query",
    "// without a provider is the upstream `default_query` ICE.",
  );
  const body: string[] = [];
  body.push(
    "",
    "/** Key / value types of every query (`pub mod $name { type Key; type Value; type LocalKey; type ProvidedValue; }`).",
    " * `KeyArg` is the TyCtxt method argument (`maybe_into_query_key!`). PORT: arena-allocated values are the values",
    " * themselves (`&'tcx T` -> `T`), so `ProvidedValue` = `Value`. */",
    "export interface QueryTypes {",
    ...types,
    "}",
    "",
    "export type QueryName = keyof QueryTypes;",
    "",
    "/** Per-query declaration: modifiers (QMODLIST), `desc`, key impl (`rustc_with_all_queries!` item list). */",
    "export const QUERY_DECLS: { readonly [N in QueryName]: QueryDecl<QueryTypes[N][\"Key\"], QueryTypes[N][\"Value\"]> } = {",
    ...decls,
    "};",
    "",
    "/** Query names in declaration order. */",
    "export const QUERY_NAMES = Object.keys(QUERY_DECLS) as QueryName[];",
    "",
    "/** Queries with the `feedable` modifier (`TyCtxtFeed` methods). */",
    `export type FeedableQuery = ${feedable.map((n) => `"${n}"`).join(" | ") || "never"};`,
    "/** Queries with `returns_error_guaranteed` (`TyCtxtEnsureResult` methods). */",
    `export type ErrorGuaranteedQuery = ${ensureResult.map((n) => `"${n}"`).join(" | ") || "never"};`,
    "/** Queries with the `separate_provide_extern` modifier (`ExternProviders` fields). */",
    `export type ExternQuery = ${extern.map((n) => `"${n}"`).join(" | ") || "never"};`,
    "",
    "/// Identifies a query by kind and key. This is in contrast to `QueryJobId` which is just a",
    "/// number.",
    "export type TaggedQueryKey = { [N in QueryName]: { readonly $: N; readonly _0: QueryTypes[N][\"Key\"] } }[QueryName];",
    "",
    "export type Providers = {",
    "  /// This is the provider for the query. Use `Find references` on this to",
    "  /// navigate between the provider assignment and the query definition.",
    "  [N in QueryName]: (tcx: TyCtxt, key: QueryTypes[N][\"LocalKey\"]) => QueryTypes[N][\"ProvidedValue\"];",
    "};",
    "",
    "export type ExternProviders = {",
    "  [N in ExternQuery]: (tcx: TyCtxt, key: QueryTypes[N][\"Key\"]) => QueryTypes[N][\"ProvidedValue\"];",
    "};",
    "",
    "/** `impl TyCtxt { pub fn $name(self, key) -> $V }` (and `TyCtxtAt`). */",
    "export type TyCtxtQueries = { [N in QueryName]: (key: QueryTypes[N][\"KeyArg\"]) => QueryTypes[N][\"Value\"] };",
    "/** `impl TyCtxtEnsureOk` / `TyCtxtEnsureDone { pub fn $name(self, key) }`. */",
    "export type TyCtxtEnsureQueries = { [N in QueryName]: (key: QueryTypes[N][\"KeyArg\"]) => void };",
    "/** `impl TyCtxtEnsureResult { pub fn $name(self, key) -> Result<(), ErrorGuaranteed> }`. */",
    "export type TyCtxtEnsureResultQueries = { [N in ErrorGuaranteedQuery]: (key: QueryTypes[N][\"KeyArg\"]) => Result<null, ErrorGuaranteed> };",
    "/** `impl TyCtxtFeed<K> { pub fn $name(self, value: ProvidedValue) }` for feedable queries. */",
    "export type TyCtxtFeedQueries = { [N in FeedableQuery]: (value: QueryTypes[N][\"ProvidedValue\"]) => void };",
    "",
    "// Non-queries are special dep kinds that are not queries (`non_query` entries). PORT: no dep graph (D3).",
    `export const NON_QUERIES = [${nonQueries.map((n) => `"${n.name}"`).join(", ")}] as const;`,
  );
  imports.add("src/std/result.ts", "Result", true);
  imports.add("src/rustc_span/lib.ts", "ErrorGuaranteed", true);
  const text = [...L, ...imports.render(OUT), ...body, ""].join("\n");
  return { text, queries, nonQueries, report };
}

function main(): void {
  requireUpstream();
  const read = (p: string): string => readFileSync(join(UPSTREAM, p), "utf8");
  let g: Generated;
  try {
    g = generate(read(SRC_PATH), read(MACROS_PATH), read(QUERY_API_PATH));
  } catch (e) {
    if (e instanceof GenError) die(e.message.replace(/^ERROR: /, ""));
    throw e;
  }
  const out = join(REPO, OUT_PATH);
  const reportPath = join(DATA, "codegen", "queries.report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(g.report, null, 1));
  const summary = `${g.queries.length} queries, ${g.nonQueries.length} non-queries; unknown types: ${Object.keys(g.report.unknown_types).length}, unported desc: ${Object.keys(g.report.unported_desc).length}, unported key impls: ${Object.keys(g.report.unported_keys).length}, values without Debug: ${Object.keys(g.report.missing_debug).length}, hashed values without StableHash: ${Object.keys(g.report.missing_stable_hash).length}`;
  if (process.argv.includes("--check")) {
    let cur = "";
    try {
      cur = readFileSync(out, "utf8");
    } catch {}
    if (cur !== g.text) die(`${OUT_PATH} is stale; run: bun tools/codegen/queries.ts`);
    console.log(`${OUT_PATH} up to date (${summary})`);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, g.text);
  console.log(`wrote ${OUT_PATH}: ${summary}`);
  console.log(`report: ${reportPath}`);
}

if (import.meta.main) main();
