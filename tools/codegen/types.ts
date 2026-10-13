// Type-definition generator (PORTING.md §5): upstream structs/enums/aliases -> TS types + derive(Debug),
// derive(Clone) (`clone_<T>`, sets with `derive_clone`), `<Enum>_discriminant` (explicit discriminants or
// derive(PartialOrd/Ord)), and derive(Walkable) (`<crate>/walkable.gen.ts` + `<crate>/mut_walkable.gen.ts`,
// the `Walkable::walk_ref` / `MutWalkable::walk_mut` tables that visit.ts / mut_visit.ts spread in).
//
//   bun tools/codegen/types.ts <set> [--out <dir>] [--src-root <dir>] [--json <probe.json>]
//                                    [--report <file>] [--stubs] [--save-json <file>]
//
// <set> is a key of tools/codegen/types.sets.json. Input is the JSON of the `typedefs` probe
// (tools/probes/typedefs; run on the set's files unless --json is given).
//
// File naming: `compiler/<crate>/src/<path>.rs` -> `<out>/<crate>/<path>.gen.ts` (lib.rs -> lib.gen.ts,
// mod.rs -> mod.gen.ts). `<out>` defaults to `src/`. The hand port `src/<crate>/<path>.ts` does
// `export * from "./<path>.gen.ts"` and adds methods (`declare module` + prototype, statics via
// `namespace X { export { new_ as new } }`) and the Debug impls the generator cannot derive.
//
// Imports of non-generated modules (src/std/fmt.ts, rustc_span, hand-port modules) are resolved
// against --src-root (default: the repo's src/). --stubs (scratch only) writes declaration stubs
// for imported modules missing under --src-root, copies src/std there and adds a tsconfig, so the
// output can be type-checked in isolation.
//
// Every unresolved type, missing Debug, manual Debug impl, unknown cfg and macro-generated type
// is written to the report (default $RUST_TS_DATA/codegen/<set>.types-report.json) and summarised on stdout.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { type DiagTsCtx, diagDerives, diagnostic_derive, renderTs, subdiagnostic_derive, type Tok } from "./diagnostics.ts";
import { type BitflagsType, debugFormatTemplate, evalFlagExpr, macroBody, type NewtypeIndex, parseBitflags, parseNewtypeIndex } from "./macros.ts";

const HERE = import.meta.dir;
export const REPO = resolve(HERE, "..", "..");

// ---- probe JSON ----------------------------------------------------------------------------

export interface PType {
  kind: string;
  text: string;
  path?: PPath;
  qself?: PType;
  elem?: PType;
  elems?: PType[];
  mut?: boolean;
  bounds?: PBound[];
}
export interface PPath {
  global: boolean;
  segments: { name: string; args: PArg[] }[];
}
export interface PArg {
  kind: string;
  ty?: PType;
  name?: string;
}
export interface PBound {
  kind: string;
  path?: PPath;
  text?: string;
}
export interface PCfg {
  name?: string;
  value?: string;
  op?: string;
  args?: PCfg[];
  text?: string;
}
export interface PAttr {
  path: string;
  text: string;
  derives?: string[];
  cfg?: PCfg;
  attrs?: PAttr[];
  repr?: string[];
  value?: string;
  inner?: boolean;
  /** token trees of `path(...)` (list attributes), for attribute-driven derives (diagnostics.ts) */
  tokens?: Tok[];
  /** start of the attribute (`#`), 1-based line and 0-based column */
  line?: number;
  col?: number;
}
export interface PGenerics {
  params: { kind: string; name: string; default?: PType | null }[];
  where: string[];
}
export interface PField {
  name: string | null;
  index: number;
  vis: string;
  ty: PType;
  attrs: PAttr[];
  docs: string[];
  line: number;
}
export interface PFields {
  style: "named" | "unnamed" | "unit";
  fields: PField[];
}
export interface PVariant {
  name: string;
  line: number;
  attrs: PAttr[];
  docs: string[];
  fields: PFields;
  discriminant: string | null;
}
export interface PItem {
  kind: "struct" | "enum" | "union" | "type" | "trait";
  name: string;
  line: number;
  vis: string;
  module: string[];
  attrs: PAttr[];
  docs?: string[];
  generics: PGenerics;
  fields?: PFields;
  variants?: PVariant[];
  ty?: PType;
}
export interface PUse {
  alias: string | null;
  path: string[];
  glob: boolean;
  module: string[];
  line: number;
}
export interface PImpl {
  line: number;
  module: string[];
  attrs: PAttr[];
  trait: string | null;
  self_ty: PType;
  self_name: string | null;
  fns: { name: string; line: number }[];
}
export interface PMacro {
  kind: string;
  name: string | null;
  macro: string;
  line: number;
  types: string[];
  debug_formats: string[];
}
export interface PMod {
  name: string;
  module: string[];
  inline: boolean;
  attrs: PAttr[];
}
export interface PFile {
  path: string;
  error?: string;
  attrs: PAttr[];
  items: PItem[];
  uses: PUse[];
  impls: PImpl[];
  macros: PMacro[];
  mods: PMod[];
}
export interface ProbeJson {
  files: PFile[];
}

// ---- configuration ---------------------------------------------------------------------------

export interface TypeMapEntry {
  paths: string[];
  ts: string;
  debug: string | null;
  import?: string;
  types?: string[];
  values?: string[];
  option?: boolean;
  nullable?: boolean;
  /** derive(Clone): "copy" | "share" | "transparent" | "option" | template (`$v`, `$c0`..); null = none */
  clone?: string | null;
  note?: string;
}
export interface TypeMap {
  cfg: { true: string[]; false: string[] };
  helpers: Record<string, string[]>;
  types: TypeMapEntry[];
}
export interface SetConfig {
  files: string[];
  class: string[];
  hand: string[];
  discriminant: string[];
  skip: string[];
  /** Structs with an inherent `impl` (with fns) anywhere in the set are emitted as `class` too. */
  auto_class?: boolean;
  /** Emit `clone_<T>` for `#[derive(Clone)]` types (and use hand `clone_<T>` for manual `impl Clone`). */
  derive_clone?: boolean;
  /** Why a `skip` entry is skipped (reported); entries for types the probe cannot see need one. */
  skip_notes?: Record<string, string>;
}

/**
 * `typemap.json` merged with every `typemap.<name>.json` next to it (in name order): types are
 * appended (a later entry for the same path wins), helpers and cfg lists are merged.
 */
export function loadTypeMap(): TypeMap {
  const tm: TypeMap = JSON.parse(readFileSync(join(HERE, "typemap.json"), "utf8"));
  for (const name of readdirSync(HERE).filter((n) => /^typemap\.[\w-]+\.json$/.test(n)).sort()) {
    const extra: Partial<TypeMap> = JSON.parse(readFileSync(join(HERE, name), "utf8"));
    tm.types.push(...(extra.types ?? []));
    for (const [m, hs] of Object.entries(extra.helpers ?? {})) tm.helpers[m] = [...new Set([...(tm.helpers[m] ?? []), ...hs])];
    if (extra.cfg) {
      tm.cfg.true.push(...extra.cfg.true);
      tm.cfg.false.push(...extra.cfg.false);
    }
  }
  return tm;
}
/** `IntoDiagArg` impls / `Display` of Rust types used by generated diagnostic derives (diag_args.json). */
export interface DiagArgEntry {
  paths: string[];
  /** expression of a `(self: T, path) => DiagArgValue` function */
  into_diag_arg?: string;
  /** Display expression template (`$v` = value) */
  display?: string;
  /** repo-relative module -> names used by the two expressions */
  imports?: Record<string, string[]>;
  note?: string;
}
export function loadDiagArgs(): DiagArgEntry[] {
  return JSON.parse(readFileSync(join(HERE, "diag_args.json"), "utf8")).types;
}
export function loadSet(name: string): SetConfig {
  const sets = JSON.parse(readFileSync(join(HERE, "types.sets.json"), "utf8"));
  const s = sets[name];
  if (!s || name === "//") throw new Error(`unknown set '${name}'`);
  return s;
}

// ---- report ----------------------------------------------------------------------------------

export interface Report {
  set: string;
  files: { upstream: string; out: string; types: number; debug_fns: number; clone_fns: number; walkable: number; diag_impls: number }[];
  unknown_types: Record<string, string[]>;
  missing_debug: Record<string, string[]>;
  manual_debug: { type: string; impl_at: string; defined_at: string; provide_in: string; generic_params: string[] }[];
  missing_clone: Record<string, string[]>;
  manual_clone: { type: string; impl_at: string; defined_at: string; provide_in: string; generic_params: string[] }[];
  unknown_cfg: Record<string, string[]>;
  macro_types: { at: string; macro: string; types: string[]; debug_formats: string[] }[];
  /** `IntoDiagArg` / `Display` of a diagnostic field type without an entry in diag_args.json (emitted as `unported`) */
  missing_diag_arg: Record<string, string[]>;
  notes: string[];
  errors: string[];
}

// ---- module model ----------------------------------------------------------------------------

interface ModFile {
  file: PFile;
  crate: string;
  mod: string[]; // module path of the file, starting with the crate name
  gen: string; // out-relative path of the generated module
  hand: string; // src-relative path of the hand-port module
}

interface ItemRef {
  item: PItem;
  mf: ModFile;
  mod: string[]; // full module path (file module + inline modules)
  key: string; // `mod::Name`
  /** set for types produced by an item macro the generator expands (`newtype_index!`, `bitflags!`) */
  mac?: { kind: "newtype"; at: string; def: NewtypeIndex } | { kind: "bitflags"; at: string; def: BitflagsType };
}

function fileModule(upstream: string): { crate: string; mod: string[]; rel: string } {
  const m = /^compiler\/([^/]+)\/src\/(.+)\.rs$/.exec(upstream);
  if (!m) throw new Error(`not a compiler/<crate>/src/*.rs path: ${upstream}`);
  const crate = m[1]!;
  const rel = m[2]!;
  const segs = rel.split("/");
  const last = segs[segs.length - 1]!;
  if (last === "lib" || last === "mod") segs.pop();
  return { crate, mod: [crate, ...segs], rel };
}

const RESERVED = new Set(["Self"]);
/** Names that cannot be (strict-mode) parameter names: PORTING §4 list plus `arguments`/`eval`. */
const PARAM_RESERVED = new Set(
  "default new delete this in function var class enum export import super switch case with yield void null typeof instanceof package interface private protected public static let const catch finally throw try do debugger arguments eval".split(" "),
);
const PRELUDE_ROOTS = new Set(["std", "core", "alloc"]);

function unraw(s: string): string {
  return s.startsWith("r#") ? s.slice(2) : s;
}

function cfgKey(c: PCfg): string {
  return c.value !== undefined ? `${c.name} = ${JSON.stringify(c.value)}` : (c.name ?? c.text ?? "?");
}

// ---- generator -------------------------------------------------------------------------------

export interface GenOptions {
  set: string;
  out: string; // absolute dir standing for src/ (generated files)
  srcRoot: string; // absolute dir for non-generated imports
  pin?: string;
  /** upstream checkout root (macro bodies of `newtype_index!` / `bitflags!` are read from it) */
  upstream?: string;
}

export interface GenResult {
  files: Map<string, string>; // absolute path -> content
  report: Report;
  /** stub declarations per src-relative module (only used with --stubs) */
  stubs: Map<string, Map<string, string>>;
}

interface Scope {
  mf: ModFile;
  mod: string[];
  params: Set<string>;
  self?: ItemRef;
  subst?: Map<string, { ty: PType; scope: Scope }>;
}

type Resolved = { k: "param"; name: string } | { k: "item"; ref: ItemRef } | { k: "ext"; keys: string[]; display: string };

export function generate(probe: ProbeJson, set: SetConfig, tm: TypeMap, opts: GenOptions): GenResult {
  const report: Report = {
    set: opts.set,
    files: [],
    unknown_types: {},
    missing_debug: {},
    manual_debug: [],
    missing_clone: {},
    manual_clone: [],
    unknown_cfg: {},
    macro_types: [],
    missing_diag_arg: {},
    notes: [],
    errors: [],
  };
  const push = (rec: Record<string, string[]>, k: string, at: string) => {
    const l = (rec[k] ??= []);
    if (!l.includes(at)) l.push(at);
  };

  // cfg evaluation
  const cfgTrue = new Set(tm.cfg.true);
  const cfgFalse = new Set(tm.cfg.false);
  const evalCfg = (c: PCfg, at: string): boolean => {
    if (c.op === "all") return c.args!.every((a) => evalCfg(a, at));
    if (c.op === "any") return c.args!.some((a) => evalCfg(a, at));
    if (c.op === "not") return !evalCfg(c.args![0]!, at);
    const k = cfgKey(c);
    if (cfgTrue.has(k)) return true;
    if (cfgFalse.has(k)) return false;
    push(report.unknown_cfg, k, at);
    report.errors.push(`${at}: unknown cfg \`${k}\` (add it to the cfg truth table of the type map)`);
    return false;
  };
  /** Attributes in effect: cfg_attr expanded where its predicate holds. */
  const effAttrs = (attrs: PAttr[], at: string): PAttr[] => {
    const out: PAttr[] = [];
    for (const a of attrs) {
      if (a.path === "cfg_attr") {
        if (a.cfg && a.attrs && evalCfg(a.cfg, at)) out.push(...effAttrs(a.attrs, at));
      } else out.push(a);
    }
    return out;
  };
  const enabled = (attrs: PAttr[], at: string) => effAttrs(attrs, at).every((a) => a.path !== "cfg" || !a.cfg || evalCfg(a.cfg, at));
  const derives = (attrs: PAttr[], at: string) => effAttrs(attrs, at).flatMap((a) => a.derives ?? []);

  // type map index
  const tmIndex = new Map<string, TypeMapEntry>();
  for (const e of tm.types) for (const p of e.paths) tmIndex.set(p, e);
  const helperModule = new Map<string, string>();
  for (const [m, names] of Object.entries(tm.helpers)) for (const n of names) helperModule.set(n, m);

  // modules and items
  const mfs: ModFile[] = [];
  const items = new Map<string, ItemRef>(); // `mod::Name` -> item
  const modsWithChildren = new Set<string>(); // module paths that exist
  const usesByMod = new Map<string, PUse[]>();
  for (const file of probe.files) {
    if (file.error) {
      report.errors.push(`${file.path}: ${file.error}`);
      continue;
    }
    const { crate, mod, rel } = fileModule(file.path);
    const mf: ModFile = { file, crate, mod, gen: `${crate}/${rel}.gen.ts`, hand: `${crate}/${rel}.ts` };
    mfs.push(mf);
    for (let i = 1; i <= mod.length; i++) modsWithChildren.add(mod.slice(0, i).join("::"));
    for (const m of file.mods) modsWithChildren.add([...mod, ...m.module, m.name].join("::"));
    for (const u of file.uses) {
      const k = [...mod, ...u.module].join("::");
      if (!usesByMod.has(k)) usesByMod.set(k, []);
      usesByMod.get(k)!.push(u);
    }
    for (const item of file.items) {
      const at = `${file.path}:${item.line}`;
      if (!enabled(item.attrs, at)) continue;
      const imod = [...mod, ...item.module];
      const key = [...imod, item.name].join("::");
      items.set(key, { item, mf, mod: imod, key });
    }
  }
  // item macros expanded here: `newtype_index!` (new types) and `bitflags!` (flags of a struct)
  const srcCache = new Map<string, string>();
  const upstreamSrc = (path: string): string => {
    if (!opts.upstream) throw new Error("item macro bodies need the upstream checkout (opts.upstream)");
    if (!srcCache.has(path)) srcCache.set(path, readFileSync(join(opts.upstream, path), "utf8"));
    return srcCache.get(path)!;
  };
  const synth = (name: string, line: number): PItem => ({
    kind: "struct",
    name,
    line,
    vis: "pub",
    module: [],
    attrs: [],
    generics: { params: [], where: [] },
    fields: { style: "unit", fields: [] },
  });
  for (const mf of mfs) {
    for (const m of mf.file.macros) {
      const last = m.macro.split("::").pop();
      if (m.kind !== "call" || (last !== "newtype_index" && last !== "bitflags")) continue;
      const at = `${mf.file.path}:${m.line}`;
      try {
        const body = macroBody(upstreamSrc(mf.file.path), m.line);
        if (body === undefined) throw new Error("cannot find the macro body");
        if (last === "newtype_index") {
          const def = parseNewtypeIndex(body);
          const key = [...mf.mod, def.name].join("::");
          items.set(key, { item: synth(def.name, m.line), mf, mod: mf.mod, key, mac: { kind: "newtype", at, def } });
        } else {
          for (const def of parseBitflags(body)) {
            const key = [...mf.mod, def.name].join("::");
            const existing = items.get(key);
            if (def.form === "impl") {
              if (!existing || existing.item.kind !== "struct") throw new Error(`bitflags impl for unknown struct ${def.name}`);
              existing.mac = { kind: "bitflags", at, def };
            } else items.set(key, { item: synth(def.name, m.line), mf, mod: mf.mod, key, mac: { kind: "bitflags", at, def } });
          }
        }
      } catch (e) {
        report.errors.push(`${at}: ${m.macro}!: ${(e as Error).message}`);
      }
    }
  }
  const matches = (list: string[], r: ItemRef) => list.includes(r.item.name) || list.includes(r.key);

  // path resolution (2018-edition rules, approximated: uses, local items, child modules, globs)
  const absolutize = (segs: string[], mod: string[], depth: number): string[] | undefined => {
    if (depth > 12 || segs.length === 0) return undefined;
    const [first, ...rest] = segs as [string, ...string[]];
    if (first === "") return rest;
    if (first === "crate") return [mod[0]!, ...rest];
    if (first === "self") return [...mod, ...rest];
    if (first === "super") return absolutize(rest.length ? ["self", ...rest] : ["self"], mod.slice(0, -1), depth + 1);
    const uses = usesByMod.get(mod.join("::")) ?? [];
    // `use thin_vec::{ThinVec, thin_vec}`: an alias whose path starts with its own name names an
    // extern crate (or a macro of that crate), not a module to expand through.
    const u = uses.find((u) => !u.glob && u.alias === first && !(u.path[0] === first && (rest.length > 0 || u.path.length > 1)));
    if (u) {
      const base = absolutize(u.path, mod, depth + 1);
      return base ? [...base, ...rest] : undefined;
    }
    if (items.has([...mod, first].join("::")) || modsWithChildren.has([...mod, first].join("::"))) return [...mod, ...segs];
    for (const g of uses.filter((u) => u.glob)) {
      const base = absolutize(g.path, mod, depth + 1);
      if (base && lookup([...base, ...segs], depth + 1)) return [...base, ...segs];
    }
    // an external crate path (`std::..`, `rustc_span::..`) or a prelude name (`Option`)
    return segs;
  };
  // follow `use` re-exports to a generated item
  const lookup = (abs: string[], depth = 0): ItemRef | undefined => {
    if (depth > 12) return undefined;
    const hit = items.get(abs.join("::"));
    if (hit) return hit;
    const mod = abs.slice(0, -1);
    const name = abs[abs.length - 1]!;
    const uses = usesByMod.get(mod.join("::"));
    if (!uses) return undefined;
    const u = uses.find((u) => !u.glob && u.alias === name);
    if (u) {
      const a = absolutize(u.path, mod, depth + 1);
      return a ? lookup(a, depth + 1) : undefined;
    }
    for (const g of uses.filter((u) => u.glob)) {
      const a = absolutize(g.path, mod, depth + 1);
      const r = a && lookup([...a, name], depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  // follow `use` re-exports textually (for external paths)
  const extAbs = (abs: string[], depth = 0): string[] => {
    const mod = abs.slice(0, -1);
    const u = (usesByMod.get(mod.join("::")) ?? []).find((u) => !u.glob && u.alias === abs[abs.length - 1]);
    if (!u || depth > 12) return abs;
    const a = absolutize(u.path, mod, depth + 1);
    return a ? extAbs(a, depth + 1) : abs;
  };
  const resolvePath = (p: PPath, sc: Scope): Resolved => {
    const segs = p.segments.map((s) => s.name);
    if (!p.global && segs.length === 1 && sc.params.has(segs[0]!)) return { k: "param", name: segs[0]! };
    if (!p.global && segs.length === 1 && segs[0] === "Self" && sc.self) return { k: "item", ref: sc.self };
    const abs = p.global ? segs : absolutize(segs, sc.mod, 0);
    if (abs) {
      const r = lookup(abs);
      if (r) return { k: "item", ref: r };
      const e = extAbs(abs);
      const keys = [e.join("::"), abs.join("::")];
      if (PRELUDE_ROOTS.has(e[0]!)) keys.push(e[e.length - 1]!);
      // a bare name may also come from a glob import of an external crate
      if (segs.length === 1 && abs.length === 1)
        for (const g of (usesByMod.get(sc.mod.join("::")) ?? []).filter((u) => u.glob)) keys.push([...g.path, ...segs].join("::"));
      return { k: "ext", keys, display: e.join("::") };
    }
    return { k: "ext", keys: [], display: segs.join("::") };
  };
  const tmLookup = (keys: string[]) => {
    for (const k of keys) {
      const e = tmIndex.get(k);
      if (e) return e;
    }
    return undefined;
  };
  const typeArgs = (p: PPath): PType[] =>
    p.segments[p.segments.length - 1]!.args.filter((a) => a.kind === "type").map((a) => a.ty!);
  const tsParams = (it: PItem) => it.generics.params.filter((g) => g.kind === "type");
  /** Scope of a type alias' definition with its parameters bound to `args` (or their defaults). */
  const aliasScope = (ref: ItemRef, args: PType[], sc: Scope): Scope => {
    const subst = new Map<string, { ty: PType; scope: Scope }>();
    tsParams(ref.item).forEach((p, i) => {
      const a = args[i] ?? p.default ?? undefined;
      if (a) subst.set(p.name, { ty: a, scope: sc });
    });
    return { ...itemScope(ref), subst };
  };
  const fieldlessEnum = (r: ItemRef) =>
    r.item.kind === "enum" &&
    r.item.variants!.filter((v) => enabled(v.attrs, `${r.mf.file.path}:${v.line}`)).every((v) => v.fields.style === "unit");

  // Debug availability
  const deriveDebug = new Set<string>();
  for (const r of items.values()) {
    if (derives(r.item.attrs, `${r.mf.file.path}:${r.item.line}`).some((d) => d === "Debug" || d.endsWith("::Debug"))) deriveDebug.add(r.key);
  }
  const manualDebug = new Map<string, ItemRef>();
  for (const mf of mfs) {
    for (const im of mf.file.impls) {
      if (!im.trait || !(im.trait === "Debug" || im.trait.endsWith("::Debug"))) continue;
      const at = `${mf.file.path}:${im.line}`;
      if (!enabled(im.attrs, at) || im.self_ty.kind !== "path") continue;
      const sc: Scope = { mf, mod: [...mf.mod, ...im.module], params: new Set() };
      const r = resolvePath(im.self_ty.path!, sc);
      if (r.k === "item") {
        manualDebug.set(r.ref.key, r.ref);
        report.manual_debug.push({
          type: r.ref.key,
          impl_at: at,
          defined_at: `${r.ref.mf.file.path}:${r.ref.item.line}`,
          provide_in: `src/${r.ref.mf.hand}`,
          generic_params: tsParams(r.ref.item).map((g) => g.name),
        });
      } else report.notes.push(`manual Debug impl for non-generated type ${im.self_ty.text} at ${at}`);
    }
    for (const m of mf.file.macros) {
      if (m.kind === "call" && (m.types.length || m.debug_formats.length))
        report.macro_types.push({ at: `${mf.file.path}:${m.line}`, macro: m.macro, types: m.types, debug_formats: m.debug_formats });
    }
  }

  // derive(Clone) / derive(PartialOrd, Ord) / derive(Walkable); manual `impl Clone`
  const hasDerive = (r: ItemRef, name: string) =>
    derives(r.item.attrs, `${r.mf.file.path}:${r.item.line}`).some((d) => d === name || d.endsWith(`::${name}`));
  const deriveClone = new Set<string>();
  const deriveOrd = new Set<string>();
  const deriveWalkable: ItemRef[] = [];
  for (const r of items.values()) {
    if (hasDerive(r, "Clone")) deriveClone.add(r.key);
    if (hasDerive(r, "PartialOrd") || hasDerive(r, "Ord")) deriveOrd.add(r.key);
    if (hasDerive(r, "Walkable")) deriveWalkable.push(r);
  }
  const manualClone = new Map<string, ItemRef>();
  if (set.derive_clone)
    for (const mf of mfs)
      for (const im of mf.file.impls) {
        if (!im.trait || !(im.trait === "Clone" || im.trait.endsWith("::Clone"))) continue;
        const at = `${mf.file.path}:${im.line}`;
        if (!enabled(im.attrs, at) || im.self_ty.kind !== "path") continue;
        const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
        if (r.k === "item") {
          manualClone.set(r.ref.key, r.ref);
          report.manual_clone.push({
            type: r.ref.key,
            impl_at: at,
            defined_at: `${r.ref.mf.file.path}:${r.ref.item.line}`,
            provide_in: `src/${r.ref.mf.hand}`,
            generic_params: tsParams(r.ref.item).map((g) => g.name),
          });
        } else report.notes.push(`manual Clone impl for non-generated type ${im.self_ty.text} at ${at}`);
      }
  // manual `impl Diagnostic` / `impl Subdiagnostic` / `impl IntoDiagArg` (hand-written `<T>_into_diag`,
  // `<T>_add_to_diag`, `<T>_into_diag_arg` in the hand module)
  const manualDiagTrait = new Map<string, Set<string>>(); // trait -> item keys
  for (const mf of mfs)
    for (const im of mf.file.impls) {
      const tr = im.trait?.split("::").pop();
      if (!tr || !["Diagnostic", "Subdiagnostic", "IntoDiagArg"].includes(tr) || im.self_ty.kind !== "path") continue;
      if (!enabled(im.attrs, `${mf.file.path}:${im.line}`)) continue;
      const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
      if (r.k !== "item") continue;
      if (!manualDiagTrait.has(tr)) manualDiagTrait.set(tr, new Set());
      manualDiagTrait.get(tr)!.add(r.ref.key);
    }
  const diagArgs = loadDiagArgs();
  const daIndex = new Map<string, DiagArgEntry>();
  for (const e of diagArgs) for (const p of e.paths) daIndex.set(p, e);

  // skip entries naming no item of the set (e.g. a type defined inside a `macro_rules!`)
  for (const k of set.skip) {
    if ([...items.values()].some((r) => matches([k], r))) continue;
    const name = k.split("::").pop()!;
    const inMacro = mfs.flatMap((mf) => mf.file.macros.filter((m) => m.kind === "macro_rules" && m.types.includes(name)).map((m) => `${mf.file.path}:${m.line} macro_rules! ${m.name}`));
    const why = set.skip_notes?.[k];
    if (!why) report.errors.push(`skip entry ${k} matches no item of the set${inMacro.length ? ` (named inside ${inMacro.join(", ")})` : ""}; add a skip_notes reason`);
    else report.notes.push(`${k}: skipped by config, not an item the probe sees${inMacro.length ? ` (inside ${inMacro.join(", ")})` : ""}: ${why}`);
  }

  // `newtype_index!` always generates `impl Debug` (rustc_index_macros/src/newtype.rs)
  for (const r of items.values()) if (r.mac?.kind === "newtype") deriveDebug.add(r.key);
  // auto_class: structs with an inherent impl that has fns (PORTING §5 "Structs")
  const autoClass = new Set<string>();
  if (set.auto_class)
    for (const mf of mfs)
      for (const im of mf.file.impls) {
        if (im.trait || im.fns.length === 0 || im.self_ty.kind !== "path") continue;
        if (!enabled(im.attrs, `${mf.file.path}:${im.line}`)) continue;
        const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
        if (r.k === "item" && r.ref.item.kind === "struct" && !r.ref.mac) autoClass.add(r.ref.key);
      }
  const isClass = (r: ItemRef) => !r.mac && (matches(set.class, r) || autoClass.has(r.key));

  // ---- per-file emission ----
  const files = new Map<string, string>();
  const stubs = new Map<string, Map<string, string>>();
  const addStub = (mod: string, name: string, decl: string) => {
    if (!stubs.has(mod)) stubs.set(mod, new Map());
    stubs.get(mod)!.set(name, decl);
  };

  // `#[derive(Walkable)]` impls go into one generated module per crate and visitor (they implement
  // `crate::visit::Walkable` / `crate::mut_visit::MutWalkable`, see visit.ts / mut_visit.ts).
  const walkMfs: (ModFile & { walk: "ref" | "mut" })[] = [];
  for (const crate of [...new Set(deriveWalkable.map((r) => r.mf.crate))])
    for (const walk of ["ref", "mut"] as const) {
      const file: PFile = { path: `compiler/${crate}/src/visit.rs`, attrs: [], items: [], uses: [], impls: [], macros: [], mods: [] };
      const base = walk === "ref" ? "visit" : "mut_visit";
      walkMfs.push({ file, crate, mod: [crate, base], gen: `${crate}/${walk === "ref" ? "walkable" : "mut_walkable"}.gen.ts`, hand: `${crate}/${base}.ts`, walk });
    }

  for (const mf of [...mfs, ...walkMfs]) {
    const walk = (mf as { walk?: "ref" | "mut" }).walk;
    const outFile = join(opts.out, mf.gen);
    const local = new Set(mf.file.items.map((i) => i.name));
    // module specifier -> { types, values } ; key: "gen:<out-rel>" or "src:<src-rel>"
    const imports = new Map<string, { types: Map<string, string>; values: Map<string, string> }>();
    const aliasOwner = new Map<string, string>(); // imported type alias -> item key
    const imp = (target: string, kind: "types" | "values", name: string, alias: string) => {
      if (!imports.has(target)) imports.set(target, { types: new Map(), values: new Map() });
      imports.get(target)![kind].set(name, alias);
    };
    let fileTypes = 0;
    let fileDebug = 0;
    let fileClone = 0;
    let fileWalk = 0;
    let fileDiag = 0;

    /**
     * Module an item of another file is imported from: always its hand-port module (which re-exports
     * the generated one), never another `.gen.ts`. Then every `.gen.ts` is entered from its own hand
     * module only, so hand modules may extend generated companions at module init (PORTING §8: enum
     * methods live on the companion const) without hitting an ESM cycle in its temporal dead zone.
     */
    const viaHand = (r: ItemRef): string => {
      if (r.mf === mf) return `gen:${r.mf.gen}`;
      addStub(r.mf.hand, "*", `export * from "./${r.mf.gen.split("/").pop()}";`);
      return `src:${r.mf.hand}`;
    };
    /** The TS name of a generated item as seen from this file (imports it if needed). */
    const refName = (r: ItemRef): string => {
      if (r.mf === mf && r.mod.length === mf.mod.length) return r.item.name;
      let alias = r.item.name;
      const taken = aliasOwner.get(alias);
      if (local.has(alias) || (taken !== undefined && taken !== r.key)) alias = `${r.mod[r.mod.length - 1]}_${r.item.name}`;
      aliasOwner.set(alias, r.key);
      const target = viaHand(r);
      imp(target, "types", r.item.name, alias);
      return alias;
    };
    const debugName = (r: ItemRef, at: string): string => {
      const tname = refName(r);
      const name = `debug_${r.item.name}`;
      const alias = `debug_${tname}`;
      if (deriveDebug.has(r.key)) {
        if (!(r.mf === mf && r.mod.length === mf.mod.length)) imp(viaHand(r), "values", name, alias);
      } else if (manualDebug.has(r.key)) {
        imp(`src:${r.mf.hand}`, "values", name, alias);
        addStub(r.mf.hand, name, `export declare function ${name}(v: any, f: Fmt, ...d: Debug<any>[]): string;`);
      } else {
        push(report.missing_debug, r.key, at);
        imp(`src:${r.mf.hand}`, "values", name, alias);
        addStub(r.mf.hand, name, `export declare function ${name}(v: any, f: Fmt, ...d: Debug<any>[]): string;`);
      }
      return alias;
    };
    const useEntry = (e: TypeMapEntry, withValues: boolean) => {
      if (!e.import) return;
      for (const t of e.types ?? []) {
        imp(`src:${e.import.replace(/^src\//, "")}`, "types", t, t);
        const arity = new Set(e.ts.match(/\$\d/g) ?? []).size;
        const ps = Array.from({ length: arity }, (_, i) => `T${i}`);
        addStub(
          e.import.replace(/^src\//, ""),
          t,
          `export type ${t}${ps.length ? `<${ps.join(", ")}>` : ""} = { readonly __stub: "${t}"${ps.length ? `; readonly __args?: [${ps.join(", ")}]` : ""} };`,
        );
      }
      if (withValues)
        for (const v of e.values ?? []) {
          imp(`src:${e.import.replace(/^src\//, "")}`, "values", v, v);
          addStub(e.import.replace(/^src\//, ""), v, `export declare function ${v}(v: any, f: Fmt, ...d: Debug<any>[]): string;`);
        }
    };
    const unknown = (display: string, at: string) => push(report.unknown_types, display, at);

    const nullable = (ty: PType, sc: Scope): boolean => {
      if (ty.kind === "ref") return nullable(ty.elem!, sc);
      if (ty.kind !== "path" || ty.qself) return false;
      const r = resolvePath(ty.path!, sc);
      if (r.k === "param") {
        const s = sc.subst?.get(r.name);
        return s ? nullable(s.ty, s.scope) : false;
      }
      if (r.k === "item") return r.ref.item.kind === "type" ? nullable(r.ref.item.ty!, itemScope(r.ref)) : false;
      const e = tmLookup(r.keys);
      if (!e) return false;
      if (e.debug === "transparent") {
        const a = typeArgs(ty.path!)[0];
        return a ? nullable(a, sc) : false;
      }
      return !!e.nullable;
    };

    const wrapArr = (t: string) => (/[ |&]/.test(t) && !/^\{.*\}$/.test(t) ? `(${t})` : t);

    const tsType = (ty: PType, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "path": {
          if (ty.qself) {
            unknown(ty.text, at);
            return `unknown /* ${ty.text} */`;
          }
          const r = resolvePath(ty.path!, sc);
          const args = typeArgs(ty.path!);
          if (r.k === "param") return r.name;
          if (r.k === "item") {
            const n = refName(r.ref);
            const ps = tsParams(r.ref.item);
            if (args.length > ps.length) report.errors.push(`${at}: too many type args for ${r.ref.key}`);
            return args.length ? `${n}<${args.map((a) => tsType(a, sc, at)).join(", ")}>` : n;
          }
          const e = tmLookup(r.keys);
          if (!e) {
            unknown(r.display, at);
            return ty.path!.segments[ty.path!.segments.length - 1]!.name;
          }
          useEntry(e, false);
          if (e.option && args[0] && nullable(args[0], sc)) {
            report.notes.push(`${at}: Option<undefined-able> -> { $: "Some", _0 } | undefined (PORTING §5)`);
            return `{ readonly $: "Some"; _0: ${tsType(args[0], sc, at)} } | undefined`;
          }
          let out = e.ts;
          const needed = new Set(e.ts.match(/\$\d/g) ?? []);
          for (const n of needed) {
            const i = Number(n.slice(1));
            const a = args[i];
            if (!a) {
              report.errors.push(`${at}: ${r.display} needs type arg ${i}`);
              return `unknown /* ${ty.text} */`;
            }
            const t = tsType(a, sc, at);
            out = out.replaceAll(n, /\[\]/.test(e.ts) ? wrapArr(t) : t);
          }
          return out;
        }
        case "ref":
          if (ty.elem!.kind === "slice" && !ty.mut) return `readonly ${tsType(ty.elem!, sc, at)}`;
          return tsType(ty.elem!, sc, at);
        case "ptr":
          report.notes.push(`${at}: raw pointer ${ty.text} mapped to its pointee`);
          return tsType(ty.elem!, sc, at);
        case "slice":
        case "array":
          return `${wrapArr(tsType(ty.elem!, sc, at))}[]`;
        case "tuple":
          return ty.elems!.length === 0 ? "null" : `[${ty.elems!.map((e) => tsType(e, sc, at)).join(", ")}]`;
        case "never":
          return "never";
        case "dyn": {
          const b = ty.bounds!.find((b) => b.kind === "trait");
          if (b) {
            const r = resolvePath(b.path!, sc);
            const keys = r.k === "ext" ? r.keys.map((k) => `dyn ${k}`) : r.k === "item" ? [`dyn ${r.ref.key}`] : [];
            const e = tmLookup(keys);
            if (e) {
              useEntry(e, false);
              return e.ts;
            }
          }
          unknown(`dyn ${ty.text}`, at);
          return `unknown /* ${ty.text} */`;
        }
        default:
          unknown(`${ty.kind}: ${ty.text}`, at);
          return `unknown /* ${ty.text} */`;
      }
    };

    /** Debug fn expression (a `Debug<T>`) for a type. */
    const dbgFn = (ty: PType, sc: Scope, at: string): string => {
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        const args = typeArgs(ty.path!);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `debug_${r.name}`;
        if (r.k === "item" && tsParams(r.ref.item).length === 0 && r.ref.item.kind !== "type") return debugName(r.ref, at);
        if (r.k === "ext") {
          const e = tmLookup(r.keys);
          const m = e?.debug && /^(\w+)\(\$v, \$f\)$/.exec(e.debug);
          if (e && m && !(e.option && args[0] && nullable(args[0], sc))) {
            useEntry(e, true);
            return m[1]!;
          }
        }
      }
      return `(x, f) => ${dbg(ty, "x", sc, at)}`;
    };
    const paren = (s: string) => (s.startsWith("(x, f) =>") ? `(${s})` : s);

    /** Debug expression for value `v` of type `ty`. */
    const dbg = (ty: PType, v: string, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "path": {
          if (ty.qself) return `unknown_debug(${v})`;
          const r = resolvePath(ty.path!, sc);
          const args = typeArgs(ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? dbg(s.ty, v, s.scope, at) : `debug_${r.name}(${v}, f)`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            if (it.kind === "type") {
              // alias: Debug of the aliased type, with the alias' params substituted
              const isc = itemScope(r.ref);
              const subst = new Map<string, { ty: PType; scope: Scope }>();
              tsParams(it).forEach((p, i) => {
                const a = args[i] ?? p.default ?? undefined;
                if (a) subst.set(p.name, { ty: a, scope: sc });
              });
              return dbg(it.ty!, v, { ...isc, subst }, at);
            }
            const fn = debugName(r.ref, at);
            // missing args take the declared defaults (`Item<K = ItemKind>`), resolved in the item's scope
            const dfns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) return dbgFn(a, sc, at);
              if (p.default) return dbgFn(p.default, itemScope(r.ref), at);
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              return "unported_debug";
            });
            return dfns.length ? `${fn}(${v}, f, ${dfns.join(", ")})` : `${fn}(${v}, f)`;
          }
          const e = tmLookup(r.keys);
          if (!e) return `unknown_debug(${v})`;
          if (e.debug === null) {
            push(report.missing_debug, `${r.display} (${e.note ?? "no Debug in typemap"})`, at);
            return `unported_debug(${v})`;
          }
          if (e.debug === "transparent") return dbg(args[0]!, v, sc, at);
          if (e.option && args[0] && nullable(args[0], sc)) {
            return `(${v} === undefined ? "None" : debug_tuple(f, "Some", [${dbg(args[0], `${v}._0`, sc, at)}]))`;
          }
          useEntry(e, true);
          let out = e.debug.replaceAll("$v", v).replaceAll("$f", "f");
          for (const n of new Set(e.debug.match(/\$d\d/g) ?? [])) out = out.replaceAll(n, paren(dbgFn(args[Number(n.slice(2))]!, sc, at)));
          return out;
        }
        case "ref":
        case "ptr":
          return dbg(ty.elem!, v, sc, at);
        case "slice":
        case "array":
          return `debug_vec(${v}, f, ${dbgFn(ty.elem!, sc, at)})`;
        case "tuple":
          if (ty.elems!.length === 0) return `"()"`;
          return `debug_tuple(f, "", [${ty.elems!.map((e, i) => dbg(e, `${v}[${i}]`, sc, at)).join(", ")}])`;
        default:
          push(report.missing_debug, `${ty.kind}: ${ty.text}`, at);
          return `unported_debug(${v})`;
      }
    };

    // ---- derive(Clone) ----
    /** `clone_<T>` of a generated item as seen from this file (imported if needed). */
    const cloneName = (r: ItemRef, at: string): string => {
      const tname = refName(r);
      const name = `clone_${r.item.name}`;
      const alias = `clone_${tname}`;
      if (deriveClone.has(r.key) && !matches(set.hand, r)) {
        if (!(r.mf === mf && r.mod.length === mf.mod.length)) imp(viaHand(r), "values", name, alias);
      } else {
        // hand types provide `clone_<T>` in their hand module (see the derive(Clone) note)
        if (!manualClone.has(r.key) && !matches(set.hand, r)) push(report.missing_clone, r.key, at);
        imp(`src:${r.mf.hand}`, "values", name, alias);
        addStub(r.mf.hand, name, `export declare function ${name}(v: any, ...c: ((v: any) => any)[]): any;`);
      }
      return alias;
    };
    /** Clone is the identity: value-like TS representations (numbers, strings, interned handles), Rc/Arc, refs. */
    const isCopy = (ty: PType, sc: Scope): boolean => {
      switch (ty.kind) {
        case "path": {
          if (ty.qself) return false;
          const r = resolvePath(ty.path!, sc);
          const args = typeArgs(ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? isCopy(s.ty, s.scope) : false;
          }
          if (r.k === "item") {
            if (r.ref.item.kind === "type") return isCopy(r.ref.item.ty!, aliasScope(r.ref, args, sc));
            // PORT: branded numbers and string-literal enums are values. Copy *objects* (`Lifetime`,
            // `FnHeader`, ...) are copied structurally: generated `MutWalkable` impls edit them in place.
            if (r.ref.mac) return true;
            return fieldlessEnum(r.ref) && !matches(set.hand, r.ref);
          }
          const e = tmLookup(r.keys);
          if (!e) return false;
          if (e.clone === "copy" || e.clone === "share") return true;
          if (e.clone === "transparent" || e.clone === "option") return args[0] ? isCopy(args[0], sc) : false;
          return false;
        }
        case "ref":
        case "ptr":
        case "never":
          return true;
        case "tuple":
          // PORT: a tuple is a mutable JS array that generated `MutVisitable["(T1, T2)"]` impls write into in
          // place, so a clone always rebuilds it, even when every element is Copy (review w456a codegen-derive
          // M1). Only `()` (`null`) is a value.
          return ty.elems!.length === 0;
        default:
          return false;
      }
    };
    const IDENT_FN = "(x) => x";
    /** Clone fn expression (`(v: T) => T`) for a type. */
    const clFn = (ty: PType, sc: Scope, at: string): string => {
      if (isCopy(ty, sc)) return IDENT_FN;
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `clone_${r.name}`;
        if (r.k === "item" && r.ref.item.kind !== "type" && tsParams(r.ref.item).length === 0) return cloneName(r.ref, at);
      }
      return `(x) => ${cl(ty, "x", sc, at)}`;
    };
    /** Clone expression for value `v` of type `ty`. */
    const cl = (ty: PType, v: string, sc: Scope, at: string): string => {
      if (isCopy(ty, sc)) return v;
      switch (ty.kind) {
        case "path": {
          if (ty.qself) {
            push(report.missing_clone, ty.text, at);
            return `unported_clone(${v})`;
          }
          const r = resolvePath(ty.path!, sc);
          const args = typeArgs(ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? cl(s.ty, v, s.scope, at) : `clone_${r.name}(${v})`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            // A hand alias: `clone_<Alias>` from the hand module (its definition is not generated).
            if (it.kind === "type" && matches(set.hand, r.ref)) return `${cloneName(r.ref, at)}(${v})`;
            if (it.kind === "type") return cl(it.ty!, v, aliasScope(r.ref, args, sc), at);
            const fn = cloneName(r.ref, at);
            const cfns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) return clFn(a, sc, at);
              if (p.default) return clFn(p.default, itemScope(r.ref), at);
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              return "unported_clone";
            });
            return cfns.length ? `${fn}(${v}, ${cfns.join(", ")})` : `${fn}(${v})`;
          }
          const e = tmLookup(r.keys);
          if (!e || e.clone == null) {
            push(report.missing_clone, e ? `${r.display} (${e.note ?? "no Clone in typemap"})` : r.display, at);
            return `unported_clone(${v})`;
          }
          useEntry(e, false);
          if (e.clone === "transparent") return cl(args[0]!, v, sc, at);
          if (e.clone === "option") {
            if (nullable(args[0]!, sc)) return `(${v} === undefined ? undefined : { $: "Some" as const, _0: ${cl(args[0]!, `${v}._0`, sc, at)} })`;
            return `(${v} === undefined ? undefined : ${cl(args[0]!, v, sc, at)})`;
          }
          let out = e.clone.replaceAll("$v", v);
          for (const n of new Set(e.clone.match(/\$c\d/g) ?? [])) {
            const fn = clFn(args[Number(n.slice(2))]!, sc, at);
            if (fn === IDENT_FN) out = stripCalls(out, n).replaceAll(`.map(${n})`, ".slice()");
            out = out.replaceAll(`${n}(`, `${fn.startsWith("(x)") ? `(${fn})` : fn}(`).replaceAll(n, fn);
          }
          return out;
        }
        case "tuple":
          if (ty.elems!.every((e) => isCopy(e, sc))) return `[...${v}] as ${tsType(ty, sc, at)}`;
          return `[${ty.elems!.map((e, i) => cl(e, `${v}[${i}]`, sc, at)).join(", ")}] as ${tsType(ty, sc, at)}`;
        case "slice":
        case "array": {
          const fn = clFn(ty.elem!, sc, at);
          return fn === IDENT_FN ? `${v}.slice()` : `${v}.map(${fn})`;
        }
        default:
          push(report.missing_clone, `${ty.kind}: ${ty.text}`, at);
          return `unported_clone(${v})`;
      }
    };

    // ---- derive(Walkable) (rustc_macros/src/visitable.rs) ----
    type WalkShape = { k: "key"; key: string } | { k: "generic"; impl: string; arg: PType; sc: Scope } | { k: "tuple"; elems: PType[]; sc: Scope };
    /** `Visitable::<impl>` key text of a type as written upstream: last path segments, no lifetimes. */
    const renderKey = (ty: PType): string => {
      switch (ty.kind) {
        case "path": {
          const segs = ty.path!.segments;
          const last = segs[segs.length - 1]!;
          const args = last.args.filter((a) => a.kind === "type").map((a) => renderKey(a.ty!));
          return `${unraw(last.name)}${args.length ? `<${args.join(", ")}>` : ""}`;
        }
        case "tuple":
          return `(${ty.elems!.map(renderKey).join(", ")})`;
        case "slice":
          return `[${renderKey(ty.elem!)}]`;
        case "ref":
          return renderKey(ty.elem!);
        default:
          return ty.text;
      }
    };
    const walkShape = (ty: PType, sc: Scope, at: string): WalkShape => {
      switch (ty.kind) {
        case "ref":
          return walkShape(ty.elem!, sc, at);
        case "slice":
          return { k: "generic", impl: "[T]", arg: ty.elem!, sc };
        case "tuple":
          if (ty.elems!.length >= 2 && ty.elems!.length <= 4) return { k: "tuple", elems: ty.elems!, sc };
          return { k: "key", key: renderKey(ty) };
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = typeArgs(ty.path!);
          if (r.k === "param") {
            report.errors.push(`${at}: derive(Walkable) over a type parameter is not supported`);
            break;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            // a type alias of a std/external type (`AttrVec`, `GenericBounds`, `BinOp`) is that type
            if (it.kind === "type" && !(it.ty!.kind === "path" && resolvePath(it.ty!.path!, itemScope(r.ref)).k === "item"))
              return walkShape(it.ty!, aliasScope(r.ref, args, sc), at);
            return { k: "key", key: renderKey(ty) };
          }
          const last = r.display.split("::").pop()!;
          if (last === "Box" || last === "P") return walkShape(args[0]!, sc, at);
          if (last === "Option" || last === "Vec" || last === "Spanned") return { k: "generic", impl: last, arg: args[0]!, sc };
          return { k: "key", key: renderKey(ty) };
        }
      }
      unknown(`derive(Walkable) field: ${ty.text}`, at);
      return { k: "key", key: ty.text };
    };
    const keyExpr = (V: string, key: string) => (/^[A-Za-z_]\w*$/.test(key) ? `${V}.${key}` : `${V}[${JSON.stringify(key)}]`);
    /** `Visitable::visit(place, vis, extra)` (ref) / `MutVisitable::visit_mut(place, vis, extra)` (mut, place = `o, k`). */
    // `extraTy` is the TS type of `extra` (`Self::Extra`), used to annotate the mutable-side closures.
    const wcall = (kind: "ref" | "mut", ty: PType, place: string, vis: string, extra: string, extraTy: string, sc: Scope, at: string): string => {
      const V = kind === "ref" ? "Visitable" : "MutVisitable";
      const sh = walkShape(ty, sc, at);
      const head = `${place}, ${vis}, ${extra}`;
      if (sh.k === "key") return `${keyExpr(V, sh.key)}(${head})`;
      if (sh.k === "generic") return `${keyExpr(V, sh.impl)}(${head}, ${wfn(kind, sh.arg, extraTy, sh.sc, at)})`;
      // tuples: `type Extra = ()`
      const tys = sh.elems.map((_, i) => `T${i + 1}`).join(", ");
      return `${V}[${JSON.stringify(`(${tys})`)}](${head}, ${sh.elems.map((e) => wfn(kind, e, "undefined", sh.sc, at)).join(", ")})`;
    };
    /** The impl of a type as a value (`Visitable<T, E>` / `MutVisitable<T, E>`). */
    const wfn = (kind: "ref" | "mut", ty: PType, extraTy: string, sc: Scope, at: string): string => {
      const sh = walkShape(ty, sc, at);
      if (sh.k === "key") return keyExpr(kind === "ref" ? "Visitable" : "MutVisitable", sh.key);
      if (kind === "ref") return `(x, v, e) => ${wcall(kind, ty, "x", "v", "e", extraTy, sc, at)}`;
      // PORT: TS cannot infer the slot type of an unannotated closure here, so it is spelled out
      imp(`src:${mf.crate}/mut_visit.ts`, "types", "Place", "Place");
      return `<K extends PropertyKey>(o: Place<${tsType(ty, sc, at)}, K>, k: K, v: MutVisitor, e: ${extraTy}) => ${wcall(kind, ty, "o, k", "v", "e", extraTy, sc, at)}`;
    };
    /** `#[visitable(ignore)]` / `#[visitable(extra = Path::Variant)]` of a field (last one wins, like the derive). */
    const visitableAttr = (fl: PField, sc: Scope, at: string): { ignore: boolean; extra: string; extraTy: string } => {
      let ignore = false;
      let extra = "undefined";
      let extraTy = "undefined";
      for (const a of effAttrs(fl.attrs, at)) {
        if (a.path !== "visitable") continue;
        const m = /^visitable\s*\((.*)\)$/s.exec(a.text);
        if (!m) {
          report.errors.push(`${at}: cannot parse #[${a.text}]`);
          continue;
        }
        for (const part of m[1]!.split(",").map((p) => p.trim())) {
          if (part === "ignore") ignore = true;
          else if (part.startsWith("extra")) {
            const segs = part.replace(/^extra\s*=\s*/, "").split("::").map((p) => p.trim());
            const r = resolvePath({ global: false, segments: segs.slice(0, -1).map((name) => ({ name, args: [] })) }, sc);
            if (r.k !== "item" || segs.length !== 2) {
              report.errors.push(`${at}: cannot resolve #[${a.text}]`);
              continue;
            }
            const alias = refName(r.ref);
            imp(viaHand(r.ref), "values", r.ref.item.name, alias);
            extra = `${alias}.${segs[1]}`;
            extraTy = alias;
          } else report.errors.push(`${at}: unknown visitable option \`${part}\``);
        }
      }
      return { ignore, extra, extraTy };
    };
    const walkBody = (kind: "ref" | "mut"): string[] => {
      const out: string[] = [];
      const visMod = `src:${mf.crate}/${kind === "ref" ? "visit" : "mut_visit"}.ts`;
      const V = kind === "ref" ? "Visitable" : "MutVisitable";
      const Vis = kind === "ref" ? "Visitor" : "MutVisitor";
      imp(visMod, "values", V, V);
      imp(visMod, "types", Vis, Vis);
      if (kind === "ref") imp("src:rustc_ast_ir/visit.ts", "values", "try_visit", "try_visit");
      const fileOrder = new Map(mfs.map((m, i) => [m, i]));
      const list = deriveWalkable
        .filter((r) => r.mf.crate === mf.crate && !matches(set.skip, r))
        .sort((a, b) => fileOrder.get(a.mf)! - fileOrder.get(b.mf)! || a.item.line - b.item.line);
      out.push(`export const ${kind === "ref" ? "walkable_derived" : "mut_walkable_derived"} = {`);
      for (const r of list) {
        const it = r.item;
        const at = `${r.mf.file.path}:${it.line}`;
        const sc = itemScope(r);
        if (tsParams(it).length) report.errors.push(`${at}: derive(Walkable) on a generic type is not supported`);
        if (it.kind !== "struct" && it.kind !== "enum") {
          report.errors.push(`${at}: derive(Walkable) on a ${it.kind}`);
          continue;
        }
        const tname = refName(r);
        // arms: [variant name | undefined (struct), statements]
        const arms: [string | undefined, string[]][] = [];
        const armOf = (fs: PFields, owner: string): string[] => {
          const stmts: string[] = [];
          for (const fl of liveFields(fs, r.mf.file.path)) {
            const fat = `${r.mf.file.path}:${fl.line}`;
            const { ignore, extra, extraTy } = visitableAttr(fl, sc, fat);
            if (ignore) continue;
            const fname = fieldName(fl);
            if (kind === "ref")
              stmts.push(`if ((r = try_visit(__visitor.Result, ${wcall(kind, fl.ty, `${owner}.${fname}`, "__visitor", extra, extraTy, sc, fat)})) !== undefined) return r;`);
            else stmts.push(`${wcall(kind, fl.ty, `${owner}, ${JSON.stringify(fname)}`, "__visitor", extra, extraTy, sc, fat)};`);
          }
          return stmts;
        };
        if (it.kind === "struct") arms.push([undefined, armOf(it.fields!, "self")]);
        else
          for (const v of it.variants!.filter((v) => enabled(v.attrs, `${r.mf.file.path}:${v.line}`))) {
            const stmts = armOf(v.fields, "self");
            if (stmts.length) arms.push([unraw(v.name), stmts]);
          }
        const nstmts = arms.reduce((n, [, s]) => n + s.length, 0);
        out.push(`  // rustc-derive: ${at} Walkable for ${it.name}`);
        const selfName = nstmts ? "self" : "_self";
        if (kind === "ref") out.push(`  ${it.name}: <R>(${selfName}: ${tname}, __visitor: Visitor<R>): R => {`);
        else out.push(`  ${it.name}: (${selfName}: ${tname}, __visitor: MutVisitor): void => {`);
        if (kind === "ref" && nstmts) out.push("    let r: R | undefined;");
        for (const [vn, stmts] of arms) {
          if (vn === undefined) out.push(...stmts.map((s) => `    ${s}`));
        }
        const varms = arms.filter(([vn]) => vn !== undefined);
        if (varms.length) {
          out.push("    switch (self.$) {");
          for (const [vn, stmts] of varms) {
            out.push(`      case ${JSON.stringify(vn)}:`);
            out.push(...stmts.map((s) => `        ${s}`));
            out.push("        break;");
          }
          out.push("    }");
        }
        if (kind === "ref") out.push("    return __visitor.Result.output();");
        out.push("  },");
        fileWalk++;
      }
      out.push("};");
      return out;
    };

    const docLines = (docs: string[] | undefined, indent: string) =>
      (docs ?? []).flatMap((d) => d.split("\n")).map((l) => `${indent}///${l.replace(/\r$/, "")}`.trimEnd());
    const genericDecl = (it: PItem, sc: Scope) => {
      const ps = tsParams(it);
      if (!ps.length) return "";
      return `<${ps.map((p) => (p.default ? `${p.name} = ${tsType(p.default, sc, `${mf.file.path}:${it.line}`)}` : p.name)).join(", ")}>`;
    };
    const fieldName = (fl: PField) => (fl.name === null ? `_${fl.index}` : unraw(fl.name));
    const liveFields = (fs: PFields, at: string) => fs.fields.filter((fl) => enabled(fl.attrs, `${at}:${fl.line}`));

    const body: string[] = [];

    // ---- derive(Diagnostic) / derive(Subdiagnostic) (rustc_macros/src/diagnostics, see diagnostics.ts) ----
    const diagCodeState = { code_ident_count: 0 };
    const diagArgOf = (ty: PType, sc: Scope, at: string, which: "into_diag_arg" | "display"): string | undefined => {
      let t = ty;
      while (t.kind === "ref") t = t.elem!;
      if (t.kind !== "path" || t.qself) return undefined;
      const r = resolvePath(t.path!, sc);
      if (r.k === "item") {
        if (which === "into_diag_arg" && manualDiagTrait.get("IntoDiagArg")?.has(r.ref.key)) {
          const name = `${r.ref.item.name}_into_diag_arg`;
          imp(`src:${r.ref.mf.hand}`, "values", name, name);
          addStub(r.ref.mf.hand, name, `export declare function ${name}(v: any, path: any): any;`);
          return name;
        }
        return undefined;
      }
      if (r.k !== "ext") return undefined;
      for (const k of r.keys) {
        const e = daIndex.get(k);
        if (!e || e[which] === undefined) continue;
        for (const [m, names] of Object.entries(e.imports ?? {})) for (const n of names) imp(`src:${m.replace(/^src\//, "")}`, "values", n, n);
        return e[which];
      }
      return undefined;
    };
    const diagCtx = (sc: Scope): DiagTsCtx => ({
      use: (module, name, kind) => {
        imp(`src:${module.replace(/^src\//, "")}`, kind === "type" ? "types" : "values", name, name);
        return name;
      },
      intoDiagArg: (ty, at) => {
        const f = diagArgOf(ty, sc, at, "into_diag_arg");
        if (f !== undefined) return f;
        push(report.missing_diag_arg, `IntoDiagArg for ${ty.text}`, at);
        return "unported_into_diag_arg";
      },
      display: (ty, v, at) => {
        const f = diagArgOf(ty, sc, at, "display");
        if (f !== undefined) return f.replaceAll("$v", v);
        push(report.missing_diag_arg, `Display for ${ty.text}`, at);
        return `unported_display(${v})`;
      },
      subdiagnosticFns: (ty, at) => {
        let t = ty;
        while (t.kind === "ref") t = t.elem!;
        const r = t.kind === "path" && !t.qself ? resolvePath(t.path!, sc) : undefined;
        if (r?.k === "item") {
          const n = r.ref.item.name;
          const names = { add_to_diag: `${n}_add_to_diag`, subdiagnostic: `${n}_subdiagnostic` };
          if (hasDerive(r.ref, "Subdiagnostic")) {
            if (!(r.ref.mf === mf && r.ref.mod.length === mf.mod.length)) for (const v of Object.values(names)) imp(viaHand(r.ref), "values", v, v);
            return names;
          }
          if (manualDiagTrait.get("Subdiagnostic")?.has(r.ref.key)) {
            for (const v of Object.values(names)) {
              imp(`src:${r.ref.mf.hand}`, "values", v, v);
              addStub(r.ref.mf.hand, v, `export declare function ${v}(v: any, ...a: any[]): any;`);
            }
            return names;
          }
        }
        report.errors.push(`${at}: #[subdiagnostic] field of type ${ty.text}: no Subdiagnostic impl found`);
        return { add_to_diag: "unported_add_to_diag", subdiagnostic: "unported_subdiagnostic" };
      },
      errCode: (toks, at) => {
        const t = toks.length === 1 ? toks[0]! : undefined;
        if (t?.t === "ident" && /^E\d{4}$/.test(t.v!)) {
          imp("src:rustc_errors/lib.ts", "values", t.v!, t.v!);
          return t.v!;
        }
        report.errors.push(`${at}: unsupported error code expression \`${toks.map((x) => x.v).join("")}\``);
        return "unported_err_code";
      },
      nullable: (ty) => nullable(ty, sc),
      tsType: (ty, at) => tsType(ty, sc, at),
      error: (m) => report.errors.push(m),
    });
    const emitDiag = (r: ItemRef, sc: Scope, selfType: string, repr: "struct" | "data" | "fieldless") => {
      const at = `${mf.file.path}:${r.item.line}`;
      const ds = diagDerives(derives(r.item.attrs, at));
      if (!ds.length) return;
      if (tsParams(r.item).length) {
        report.errors.push(`${at}: derive(${ds.join(", ")}) on a type with type parameters is not supported`);
        return;
      }
      const errs = { error: (m: string) => report.errors.push(m) };
      for (const d of ds) {
        const impl = d === "Diagnostic" ? diagnostic_derive(r.item, mf.file.path, errs, diagCodeState) : subdiagnostic_derive(r.item, mf.file.path, errs, diagCodeState);
        body.push(...renderTs(impl, diagCtx(sc), mf.file.path, selfType, repr));
        fileDiag++;
      }
    };
    const itemList = walk ? [] : [...items.values()].filter((r) => r.mf === mf).sort((a, b) => a.item.line - b.item.line);
    for (const r of itemList) {
      const it = r.item;
      const at = `${mf.file.path}:${it.line}`;
      if (it.kind === "trait") continue;
      if (matches(set.skip, r)) {
        report.notes.push(`${r.key}: skipped by config`);
        continue;
      }
      if (r.mod.length !== mf.mod.length) {
        report.notes.push(`${r.key}: inside inline module ${r.mod.join("::")}; emitted into ${mf.gen} (flattened)`);
      }
      const sc = itemScope(r);
      const name = it.name;
      const gdecl = genericDecl(it, sc);
      const gparams = tsParams(it).map((p) => p.name);
      body.push("");
      body.push(`// rustc-type: ${mf.file.path}:${it.line} ${name}`);
      fileTypes++;

      if (matches(set.hand, r)) {
        body.push(`export type { ${name} } from "${relImport(outFile, join(opts.srcRoot, mf.hand))}";`);
        imp(`src:${mf.hand}`, "types", name, name);
        addStub(mf.hand, name, `export type ${name}${gparams.length ? `<${gparams.join(", ")}>` : ""} = { readonly __stub: "${name}" };`);
      }

      const hasDebug = deriveDebug.has(r.key);
      const debugHead = (valueType: string) =>
        gparams.length
          ? `export function debug_${name}<${gparams.join(", ")}>(v: ${valueType}, f: Fmt, ${gparams.map((g) => `debug_${g}: Debug<${g}>`).join(", ")}): string {\n  return `
          : `export const debug_${name}: Debug<${valueType}> = (v, f) =>\n  `;
      const debugTail = gparams.length ? ";\n}" : ";";
      const selfType = `${name}${gparams.length ? `<${gparams.join(", ")}>` : ""}`;
      // derive(Clone) -> `clone_<T>(v[, clone_<P>...])`
      const wantClone = !!set.derive_clone && deriveClone.has(r.key) && (it.kind === "struct" || it.kind === "enum");
      if (wantClone && matches(set.hand, r)) report.notes.push(`${r.key}: derive(Clone) of a hand type is not generated (provide clone_${name} in ${mf.hand})`);
      const emitClone = wantClone && !matches(set.hand, r) && !r.mac;
      const cloneHead = gparams.length
        ? `export function clone_${name}<${gparams.join(", ")}>(v: ${selfType}, ${gparams.map((g) => `clone_${g}: (v: ${g}) => ${g}`).join(", ")}): ${selfType} {`
        : `export function clone_${name}(v: ${name}): ${name} {`;

      if (r.mac?.kind === "newtype") {
        // rustc_index_macros/src/newtype.rs: struct + module-level consts + `impl Debug`
        const def = r.mac.def;
        const attr = (n: string) => def.attrs.find((a) => a.name === n);
        const fmtAttr = attr("debug_format");
        const maxAttr = attr("max");
        let template = "`${n}`";
        let max: bigint | undefined;
        try {
          if (fmtAttr) template = debugFormatTemplate(fmtAttr.value ?? "");
          if (maxAttr) {
            max = parseIntLit(maxAttr.value ?? "");
            if (max === undefined) throw new Error(`cannot evaluate #[max = ${maxAttr.value}]`);
          }
        } catch (e) {
          report.errors.push(`${r.mac.at}: ${(e as Error).message}`);
        }
        body.push(...docLines(def.docs, ""));
        body.push(`// PORT: \`newtype_index!\` (${r.mac.at}) -> branded number + \`newtype_index\` companion (PORTING §5).`);
        body.push(`export type ${name} = number & { readonly __brand: "${name}" };`);
        body.push(`export const ${name} = newtype_index<${name}>((n) => ${template}${max !== undefined ? `, 0x${max.toString(16)}, ${JSON.stringify(maxAttr!.value)}` : ""});`);
        body.push(`export const debug_${name}: Debug<${name}> = ${name}.debug;`);
        fileDebug++;
        for (const c of def.consts) {
          const v = parseIntLit(c.expr);
          if (v === undefined) report.errors.push(`${r.mac.at}: cannot evaluate const ${c.name} = ${c.expr}`);
          body.push(...docLines(c.docs, ""));
          body.push(`export const ${c.name}: ${name} = ${name}.from_u32(${v ?? "NaN"});`);
        }
        continue;
      }
      if (r.mac?.kind === "bitflags") {
        // bitflags-2.10.0 `bitflags!`: a branded number; the flags and the `Flags` API on the companion
        const def = r.mac.def;
        const width = { u8: 8, u16: 16, u32: 32 }[def.bits];
        const known = new Map<string, bigint>();
        const flags: [string, string, string[]][] = [];
        if (width === undefined) report.errors.push(`${r.mac.at}: bitflags over ${def.bits} not supported (number-backed flags are at most u32)`);
        else
          for (const c of def.flags) {
            try {
              const v = evalFlagExpr(c.expr, known, width);
              known.set(c.name, v);
              flags.push([c.name === "_" ? "" : c.name, `0x${v.toString(16)}`, c.docs]);
            } catch (e) {
              report.errors.push(`${r.mac.at}: ${(e as Error).message}`);
            }
          }
        if (def.form === "struct") body.push(...docLines(def.docs, ""));
        else body.push(...docLines(it.docs, ""));
        body.push(`// PORT: \`bitflags!\` (${r.mac.at}, \`${def.form} ${name}: ${def.bits}\`) -> branded number; flags + \`Flags\` API on the companion.`);
        body.push(`export type ${name} = number & { readonly __brand: "${name}" };`);
        body.push(`export const ${name} = flags_companion<${name}, {`);
        for (const [n] of flags) if (n) body.push(`  ${n}: ${name};`);
        body.push(`}>(`);
        body.push(`  ${width ?? 32},`);
        body.push("  {");
        for (const [n, v, docs] of flags) {
          if (!n) continue;
          body.push(...docLines(docs, "    "));
          body.push(`    ${n}: ${v} as ${name},`);
        }
        body.push("  },");
        body.push(`  [${flags.map(([n, v]) => `[${JSON.stringify(n)}, ${v} as ${name}]`).join(", ")}],`);
        body.push(");");
        if (def.form === "struct" && def.attrs.some((a) => /^derive\s*\(.*\bDebug\b/s.test(a.name)))
          report.notes.push(`${r.key}: derive(Debug) inside bitflags! is not generated yet`);
        if (hasDebug && def.form === "impl") {
          // `#[derive(Debug)] struct X(uN);` + `bitflags! { impl X: uN { .. } }`: the derive sees a plain
          // tuple struct, so its Debug is `X(<bits>)` (e.g. rustc_hir::def::MacroKinds).
          body.push(`export const debug_${name}: Debug<${name}> = (v, f) => debug_tuple(f, ${JSON.stringify(name)}, [debug_int(v, f)]);`);
          fileDebug++;
        } else if (hasDebug) report.errors.push(`${at}: derive(Debug) on a bitflags struct is not supported`);
        continue;
      }

      if (it.kind === "type") {
        // A hand alias is only re-exported (above); its definition lives in the hand module.
        if (matches(set.hand, r)) continue;
        body.push(...docLines(it.docs, ""));
        body.push(`export type ${name}${gdecl} = ${tsType(it.ty!, sc, at)};`);
        continue;
      }
      if (it.kind === "union") {
        report.notes.push(`${r.key}: union emitted as an interface of all fields`);
      }
      if (it.kind === "struct" || it.kind === "union") {
        const fs = it.fields!;
        const live = liveFields(fs, mf.file.path);
        if (!matches(set.hand, r)) {
          body.push(...docLines(it.docs, ""));
          if (isClass(r)) {
            body.push(`export class ${name}${gdecl} {`);
            if (live.length && live.some((fl) => PARAM_RESERVED.has(fieldName(fl)))) {
              // a field named like a JS reserved word cannot be a parameter property: declare the
              // fields and take `<name>_` parameters (PORTING §4)
              const pn = (fl: PField) => (PARAM_RESERVED.has(fieldName(fl)) ? `${fieldName(fl)}_` : fieldName(fl));
              for (const fl of live) {
                body.push(...docLines(fl.docs, "  "));
                body.push(`  ${fieldName(fl)}: ${tsType(fl.ty, sc, at)};`);
              }
              body.push(`  constructor(${live.map((fl) => `${pn(fl)}: ${tsType(fl.ty, sc, at)}`).join(", ")}) {`);
              for (const fl of live) body.push(`    this.${fieldName(fl)} = ${pn(fl)};`);
              body.push("  }");
            } else if (live.length) {
              body.push("  constructor(");
              for (const fl of live) {
                body.push(...docLines(fl.docs, "    "));
                body.push(`    public ${fieldName(fl)}: ${tsType(fl.ty, sc, at)},`);
              }
              body.push("  ) {}");
            }
            body.push("}");
          } else {
            if (fs.style === "unit") report.notes.push(`${r.key}: unit struct emitted as an empty interface`);
            body.push(`export interface ${name}${gdecl} {`);
            for (const fl of live) {
              body.push(...docLines(fl.docs, "  "));
              body.push(`  ${fieldName(fl)}: ${tsType(fl.ty, sc, at)};`);
            }
            body.push("}");
          }
        }
        if (hasDebug && it.kind === "struct") {
          fileDebug++;
          let expr: string;
          if (fs.style === "named" && live.length)
            expr = `debug_struct(f, "${name}", [\n${live.map((fl) => `    ["${fieldName(fl)}", ${dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)}],`).join("\n")}\n  ])`;
          else if (fs.style === "unnamed" && live.length)
            expr = `debug_tuple(f, "${name}", [${live.map((fl) => dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)).join(", ")}])`;
          else expr = `"${name}"`;
          body.push(debugHead(selfType) + expr + debugTail);
        }
        if (emitClone) {
          fileClone++;
          body.push(cloneHead);
          if (isClass(r)) body.push(`  return new ${name}(${live.map((fl) => cl(fl.ty, `v.${fieldName(fl)}`, sc, at)).join(", ")});`);
          else if (live.length) body.push(`  return {\n${live.map((fl) => `    ${fieldName(fl)}: ${cl(fl.ty, `v.${fieldName(fl)}`, sc, at)},`).join("\n")}\n  };`);
          else body.push("  return {};");
          body.push("}");
        }
        emitDiag(r, sc, selfType, "struct");
        continue;
      }

      // enums
      const variants = it.variants!.filter((v) => enabled(v.attrs, `${mf.file.path}:${v.line}`));
      const fieldless = variants.every((v) => v.fields.style === "unit");
      if (fieldless) {
        if (!matches(set.hand, r)) {
          body.push(...docLines(it.docs, ""));
          if (variants.length === 0) body.push(`export type ${name} = never;`);
          else {
            body.push(`export type ${name} =`);
            variants.forEach((v, i) => {
              body.push(...docLines(v.docs, "  "));
              body.push(`  | "${unraw(v.name)}"${i === variants.length - 1 ? ";" : ""}`);
            });
          }
          body.push(`export const ${name} = { ${variants.map((v) => `${unraw(v.name)}: "${unraw(v.name)}"`).join(", ")} } as const;`);
          // `<Enum>_discriminant` (`as isize`): explicit discriminants, the set's list, or a derived
          // `PartialOrd`/`Ord` (which compares fieldless variants by discriminant)
          if (variants.some((v) => v.discriminant !== null) || matches(set.discriminant, r) || deriveOrd.has(r.key)) {
            let next = 0n;
            const vals: string[] = [];
            for (const v of variants) {
              if (v.discriminant !== null) {
                const n = parseIntLit(v.discriminant);
                if (n === undefined) {
                  report.errors.push(`${mf.file.path}:${v.line}: cannot evaluate discriminant \`${v.discriminant}\` of ${r.key}::${v.name}`);
                  vals.push(`${unraw(v.name)}: unported_discriminant(${JSON.stringify(v.discriminant)})`);
                  next = 0n;
                  continue;
                }
                next = n;
              }
              vals.push(`${unraw(v.name)}: ${next}`);
              next++;
            }
            body.push(`/** \`${name} as isize\` */`);
            body.push(`export const ${name}_discriminant: Record<${name}, number> = { ${vals.join(", ")} };`);
          }
        }
        if (hasDebug) {
          fileDebug++;
          body.push(`export const debug_${name}: Debug<${name}> = (v) => v;`);
        }
        if (emitClone) {
          fileClone++;
          body.push(`${cloneHead}\n  return v;\n}`);
        }
        emitDiag(r, sc, selfType, "fieldless");
        continue;
      }
      if (variants.some((v) => v.discriminant !== null)) report.errors.push(`${at}: data enum ${r.key} has explicit discriminants (not emitted)`);
      if (!matches(set.hand, r)) {
        body.push(...docLines(it.docs, ""));
        body.push(`export type ${name}${gdecl} =`);
        variants.forEach((v, i) => {
          body.push(...docLines(v.docs, "  "));
          const fl = liveFields(v.fields, mf.file.path).map((fl) => `${fieldName(fl)}: ${tsType(fl.ty, sc, at)}`);
          body.push(`  | { readonly $: "${unraw(v.name)}"${fl.length ? "; " + fl.join("; ") : ""} }${i === variants.length - 1 ? ";" : ""}`);
        });
        const units = variants.filter((v) => v.fields.style === "unit");
        if (units.length) {
          body.push(`/** Unit variants of \`${name}\`, shared frozen singletons. */`);
          body.push(`export const ${name} = {`);
          for (const v of units) body.push(`  ${unraw(v.name)}: Object.freeze({ $: "${unraw(v.name)}" as const }),`);
          body.push("};");
        }
      }
      if (hasDebug) {
        fileDebug++;
        const cases: string[] = [];
        const unitNames: string[] = [];
        for (const v of variants) {
          const vn = unraw(v.name);
          const live = liveFields(v.fields, mf.file.path);
          if (v.fields.style === "named" && live.length) {
            cases.push(
              `    case "${vn}":\n      return debug_struct(f, "${vn}", [\n${live.map((fl) => `        ["${fieldName(fl)}", ${dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)}],`).join("\n")}\n      ]);`,
            );
          } else if (v.fields.style === "unnamed" && live.length) {
            cases.push(`    case "${vn}":\n      return debug_tuple(f, "${vn}", [${live.map((fl) => dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)).join(", ")}]);`);
          } else unitNames.push(vn);
        }
        if (unitNames.length) cases.push(`${unitNames.map((n) => `    case "${n}":`).join("\n")}\n      return v.$;`);
        const sw = `{\n  switch (v.$) {\n${cases.join("\n")}\n  }\n}`;
        if (gparams.length)
          body.push(
            `export function debug_${name}<${gparams.join(", ")}>(v: ${selfType}, f: Fmt, ${gparams.map((g) => `debug_${g}: Debug<${g}>`).join(", ")}): string ${sw}`,
          );
        else body.push(`export const debug_${name}: Debug<${name}> = (v, f) => ${sw};`);
      }
      if (emitClone) {
        fileClone++;
        body.push(cloneHead);
        {
          const cases: string[] = [];
          const unitNames: string[] = [];
          for (const v of variants) {
            const vn = unraw(v.name);
            const live = liveFields(v.fields, mf.file.path);
            if (v.fields.style === "unit") unitNames.push(vn);
            else
              cases.push(
                `    case "${vn}":\n      return { $: "${vn}"${live.map((fl) => `, ${fieldName(fl)}: ${cl(fl.ty, `v.${fieldName(fl)}`, sc, at)}`).join("")} };`,
              );
          }
          if (unitNames.length) cases.push(`${unitNames.map((n) => `    case "${n}":`).join("\n")}\n      return v;`);
          body.push(`  switch (v.$) {\n${cases.join("\n")}\n  }`);
        }
        body.push("}");
      }
      emitDiag(r, sc, selfType, "data");
    }
    if (walk) body.push("", ...walkBody(walk));

    // helpers used by the body
    const text = body.join("\n");
    for (const [h, m] of helperModule) if (new RegExp(`\\b${h}\\b`).test(text)) imp(`src:${m.replace(/^src\//, "")}`, "values", h, h);
    if (/\bDebug<|\bFmt\b/.test(text)) {
      if (/\bDebug</.test(text)) imp("src:std/fmt.ts", "types", "Debug", "Debug");
      if (/\bFmt\b/.test(text)) imp("src:std/fmt.ts", "types", "Fmt", "Fmt");
    }
    const header = walk
      ? [
          `// GENERATED by tools/codegen/types.ts: #[derive(Walkable)] (compiler/rustc_macros/src/visitable.rs) of the ${mf.crate} types${opts.pin ? ` @ ${opts.pin}` : ""}. Do not edit.`,
          walk === "ref"
            ? `// The \`Walkable::walk_ref\` impls; ${mf.hand.split("/").pop()} spreads \`walkable_derived\` into its \`Walkable\` table.`
            : `// The \`MutWalkable::walk_mut\` impls; ${mf.hand.split("/").pop()} spreads \`mut_walkable_derived\` into its \`MutWalkable\` table.`,
          `// Per field in declaration order, unless #[visitable(ignore)]: ${walk === "ref" ? "try_visit!(Visitable::visit(field, __visitor, extra))" : "MutVisitable::visit_mut(field, __visitor, extra)"},`,
          "// extra = #[visitable(extra = ..)] or `()` (undefined).",
          `// Import cycle: load through ${mf.hand.split("/").pop()} (or the crate's lib.ts), never this module first: entered first in a`,
          `// fresh process it reads ${mf.hand.split("/").pop()}'s bindings before they are initialised (TDZ ReferenceError).`,
        ]
      : [
          `// GENERATED by tools/codegen/types.ts from ${mf.file.path}${opts.pin ? ` @ ${opts.pin}` : ""}. Do not edit.`,
          `// Hand-written additions (methods, manual Debug impls) go in ${mf.hand.split("/").pop()} next to this file.`,
        ];
    const importLines: string[] = [];
    const sortedTargets = [...imports.keys()].sort();
    for (const t of sortedTargets) {
      const { types, values } = imports.get(t)!;
      if (t === `gen:${mf.gen}`) continue;
      const abs = t.startsWith("gen:") ? join(opts.out, t.slice(4)) : join(opts.srcRoot, t.slice(4));
      const spec = relImport(outFile, abs);
      const parts = [
        ...[...types].filter(([n, a]) => values.get(n) !== a).map(([n, a]) => `type ${n === a ? n : `${n} as ${a}`}`),
        ...[...values].map(([n, a]) => (n === a ? n : `${n} as ${a}`)),
      ].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));
      if (parts.length) importLines.push(`import { ${parts.join(", ")} } from "${spec}";`);
    }
    if (/\bunported_debug\(|\bunknown_debug\(|\bunported_discriminant\(|\bunported_clone\b|\bunported_into_diag_arg\b|\bunported_display\(/.test(text)) {
      importLines.push(`import { unported } from "${relImport(outFile, join(opts.srcRoot, "std/panic.ts"))}";`);
      const extra: string[] = [];
      if (/\bunported_debug\(/.test(text)) extra.push(`const unported_debug = (_v: unknown): string => unported("Debug without a TS impl (see types report)");`);
      if (/\bunknown_debug\(/.test(text)) extra.push(`const unknown_debug = (_v: unknown): string => unported("Debug of an unknown type (see types report)");`);
      if (/\bunported_discriminant\(/.test(text)) extra.push(`const unported_discriminant = (e: string): number => unported(\`discriminant \${e}\`);`);
      if (/\bunported_clone\b/.test(text)) extra.push(`const unported_clone = <T>(_v: T): T => unported("Clone without a TS impl (see types report)");`);
      if (/\bunported_into_diag_arg\b/.test(text))
        extra.push(`const unported_into_diag_arg = (_v: unknown, _path: unknown): never => unported("IntoDiagArg without a TS impl (see types report)");`);
      if (/\bunported_display\(/.test(text)) extra.push(`const unported_display = (_v: unknown): string => unported("Display without a TS impl (see types report)");`);
      importLines.push(...extra);
    }
    if (fileTypes === 0 && !walk) {
      report.notes.push(`${mf.file.path}: no types; ${mf.gen} not written`);
      continue;
    }
    files.set(outFile, [...header, ...importLines, text, ""].join("\n"));
    report.files.push({
      upstream: walk ? `derive(Walkable) of ${mf.crate}` : mf.file.path,
      out: mf.gen,
      types: fileTypes,
      debug_fns: fileDebug,
      clone_fns: fileClone,
      walkable: fileWalk,
      diag_impls: fileDiag,
    });
  }
  return { files, report, stubs };

  function itemScope(r: ItemRef): Scope {
    return { mf: r.mf, mod: r.mod, params: new Set(r.item.generics.params.filter((p) => p.kind === "type").map((p) => p.name)), self: r };
  }
}

/** `$cN(expr)` -> `expr` (the clone fn of argument N is the identity). */
function stripCalls(text: string, n: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const j = text.indexOf(`${n}(`, i);
    if (j < 0) return out + text.slice(i);
    let depth = 0;
    let k = j + n.length;
    for (; k < text.length; k++) {
      if (text[k] === "(") depth++;
      else if (text[k] === ")" && --depth === 0) break;
    }
    out += text.slice(i, j) + text.slice(j + n.length + 1, k);
    i = k + 1;
  }
}

/** Integer literal (with `_`, radix prefix, type suffix, leading `-`) -> bigint. */
export function parseIntLit(text: string): bigint | undefined {
  let s = text.replace(/\s+/g, "").replaceAll("_", "");
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/(u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)$/, "");
  if (!/^(0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|[0-9]+)$/.test(s)) return undefined;
  const n = s.startsWith("0o") ? BigInt("0o" + s.slice(2)) : BigInt(s);
  return neg ? -n : n;
}

function relImport(fromFile: string, toFile: string): string {
  let r = relative(dirname(fromFile), toFile).replaceAll("\\", "/");
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}

// ---- stubs (scratch type-checking only) --------------------------------------------------------

export function writeStubs(res: GenResult, opts: GenOptions): number {
  if (resolve(opts.srcRoot) === resolve(REPO, "src")) throw new Error("--stubs refuses to write into the repo's src/");
  let n = 0;
  if (!existsSync(join(opts.srcRoot, "std"))) cpSync(join(REPO, "src", "std"), join(opts.srcRoot, "std"), { recursive: true });
  for (const [mod, decls] of res.stubs) {
    const file = join(opts.srcRoot, mod);
    if (existsSync(file) && !readFileSync(file, "utf8").startsWith("// STUB")) continue;
    mkdirSync(dirname(file), { recursive: true });
    const fmt = relImport(file, join(opts.srcRoot, "std", "fmt.ts"));
    const lines = ["// STUB written by tools/codegen/types.ts --stubs (scratch type-check only).", "/* eslint-disable */"];
    lines.push(`import type { Debug, Fmt } from "${fmt}";`);
    for (const d of decls.values()) lines.push(d);
    lines.push("export type __StubDebug = Debug<unknown> | Fmt;");
    writeFileSync(file, lines.join("\n") + "\n");
    n++;
  }
  const tsconfig = join(dirname(opts.srcRoot), "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023"],
          module: "Preserve",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          typeRoots: [join(REPO, "node_modules", "@types").replaceAll("\\", "/")],
          types: ["bun"],
        },
        include: [relative(dirname(opts.srcRoot), opts.srcRoot).replaceAll("\\", "/")],
      },
      null,
      2,
    ),
  );
  return n;
}

// ---- CLI ---------------------------------------------------------------------------------------

export async function runProbe(files: string[]): Promise<ProbeJson> {
  const { probePath } = await import("../../scripts/probes.ts");
  const { UPSTREAM } = await import("../../scripts/lib/common.ts");
  const r = Bun.spawnSync([probePath("typedefs"), ...files], { cwd: UPSTREAM, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`typedefs probe failed: ${r.stderr.toString().trim()}`);
  return JSON.parse(r.stdout.toString());
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
  };
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    if (i >= 0) argv.splice(i, 1);
    return i >= 0;
  };
  const out = resolve(opt("--out") ?? join(REPO, "src"));
  const srcRoot = resolve(opt("--src-root") ?? join(REPO, "src"));
  const jsonIn = opt("--json");
  const saveJson = opt("--save-json");
  const reportPath = opt("--report");
  const stubs = flag("--stubs");
  const setName = argv[0];
  if (!setName) {
    console.log("usage: bun tools/codegen/types.ts <set> [--out dir] [--src-root dir] [--json probe.json] [--save-json f] [--report f] [--stubs]");
    process.exit(2);
  }
  const set = loadSet(setName);
  const tm = loadTypeMap();
  const probe: ProbeJson = jsonIn ? JSON.parse(readFileSync(jsonIn, "utf8")) : await runProbe(set.files);
  if (saveJson) writeFileSync(saveJson, JSON.stringify(probe, null, 1) + "\n");
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);
  const { UPSTREAM, DATA } = await import("../../scripts/lib/common.ts");
  const opts: GenOptions = { set: setName, out, srcRoot, pin, upstream: UPSTREAM };
  const res = generate(probe, set, tm, opts);
  for (const [f, c] of res.files) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
  }
  const rp = resolve(reportPath ?? join(DATA, "codegen", `${setName}.types-report.json`));
  mkdirSync(dirname(rp), { recursive: true });
  writeFileSync(rp, JSON.stringify(res.report, null, 2) + "\n");
  const r = res.report;
  const nTypes = r.files.reduce((a, f) => a + f.types, 0);
  const nDebug = r.files.reduce((a, f) => a + f.debug_fns, 0);
  const nClone = r.files.reduce((a, f) => a + f.clone_fns, 0);
  const nWalk = r.files.reduce((a, f) => a + f.walkable, 0);
  const nDiag = r.files.reduce((a, f) => a + f.diag_impls, 0);
  console.log(`${setName}: ${r.files.length} files, ${nTypes} types, ${nDebug} debug fns, ${nClone} clone fns, ${nWalk} walkable impls, ${nDiag} diagnostic derives -> ${out}`);
  console.log(
    `unknown types: ${Object.keys(r.unknown_types).length}, missing debug: ${Object.keys(r.missing_debug).length}, manual Debug impls: ${r.manual_debug.length}, missing clone: ${Object.keys(r.missing_clone).length}, manual Clone impls: ${r.manual_clone.length}, unknown cfg: ${Object.keys(r.unknown_cfg).length}, macro types: ${r.macro_types.length}, missing IntoDiagArg/Display: ${Object.keys(r.missing_diag_arg).length}`,
  );
  console.log(`report: ${rp}`);
  if (stubs) console.log(`stubs: ${writeStubs(res, opts)} modules under ${srcRoot}`);
  if (r.errors.length) {
    for (const e of r.errors.slice(0, 5)) console.log(`ERROR: ${e}`);
    process.exit(1);
  }
}
