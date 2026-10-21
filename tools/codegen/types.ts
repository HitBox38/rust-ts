// Type-definition generator (PORTING.md §5): upstream structs/enums/aliases -> TS types + derive(Debug),
// derive(Clone) (`clone_<T>`, sets with `derive_clone`), `<Enum>_discriminant` (explicit discriminants or
// derive(PartialOrd/Ord)), derive(Walkable) (`<crate>/walkable.gen.ts` + `<crate>/mut_walkable.gen.ts`,
// the `Walkable::walk_ref` / `MutWalkable::walk_mut` tables that visit.ts / mut_visit.ts spread in), and
// derive(StableHash) / derive(StableHash_NoContext) (`<crate>/stable_hash.gen.ts`, sets with `derive_stable_hash`:
// one `stable_hash_<T>` per type, rustc_macros/src/stable_hash.rs; the external-type impls come from
// tools/codegen/stable_hash.json), derive(Decodable) / derive(Encodable) (rustc_macros/src/serialize.rs), and
// derive(TypeVisitable[_Generic]) / derive(TypeFoldable[_Generic]) (sets with `derive_type_fold`: `visit_with_<T>` /
// `try_fold_with_<T>` / `fold_with_<T>` next to the type; impls of other types from tools/codegen/type_fold.json).
// `#[derive_where(..)]` (derive-where) derives like `#[derive(..)]`; sets with `erase_params` drop `I: Interner`.
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
import {
  type BitflagsType,
  debugFormatTemplate,
  evalFlagExpr,
  type LangItemRow,
  macroBody,
  type NewtypeIndex,
  parseBitflags,
  parseLanguageItemTable,
  parseLanguageItemTableDef,
  parseNewtypeIndex,
} from "./macros.ts";

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
  /** names `clone` uses that `values` does not list, imported from `import` only where a clone is emitted */
  clone_values?: string[];
  /** derive(Default): expression (`$e0`.. = defaults of the type arguments); absent = none */
  default?: string | null;
  /** names `default` uses, imported from `import` */
  default_values?: string[];
  /** type arguments of a type written without them (defaulted generic params, `DiagSymbolList` = `DiagSymbolList<Symbol>`) */
  default_args?: PType[];
  /**
   * The path names an item of the set being generated (key `mod::Name`), e.g. `I::Probe` -> `rustc_type_ir::solve::inspect::Probe`
   * (an `Interner` associated type that TyCtxt sets to a type of the set): it resolves to that item, the other fields are unused.
   */
  item?: string;
  /** manual `impl Subdiagnostic` of an external type: the TS fns (`<T>_add_to_diag`, `<T>_subdiagnostic`), imported from `import` */
  subdiagnostic?: { add_to_diag: string; subdiagnostic: string };
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
  /** Emit `default_<T>()` for `#[derive(Default)]` types (typemap `default` rules for external field types). */
  derive_default?: boolean;
  /** Why a `skip` entry is skipped (reported); entries for types the probe cannot see need one. */
  skip_notes?: Record<string, string>;
  /** Emit `<crate>/stable_hash.gen.ts`: `stable_hash_<T>` for `#[derive(StableHash)]` / `StableHash_NoContext` types. */
  derive_stable_hash?: boolean;
  /** Write only the per-crate derive modules (walkable / stable_hash), not the per-file type modules (the types are hand-written). */
  derive_only?: boolean;
  /**
   * derive(StableHash): emit only these items (names or keys). For sets over a large hand-written file of
   * which only a few types are ported (rustc_middle ty/mod.rs); absent = every derive(StableHash) item.
   */
  stable_hash_types?: string[];
  /**
   * derive(StableHash) field reads of hand types whose TS value is not a `{ field }` object, keyed
   * `<type key>::<field name or index>`: `expr` with `$v` = the value, `import` = values it needs from
   * the type's hand module (e.g. a branded newtype `ExpnHash(Fingerprint)`: `ExpnHash._0($v)`).
   */
  stable_hash_access?: Record<string, { expr: string; import?: string[] }>;
  /**
   * derive(Decodable) / Decodable_NoContext / BlobDecodable / LazyDecodable / TyDecodable (rustc_macros/src/serialize.rs
   * `decodable_body`): `decode_<T>(__decoder[, decode_<P>...])`. Per-file sets emit it next to the type in the file's
   * `.gen.ts`; `derive_only` sets (hand-written types) into `<crate>/decodable.gen.ts`. Field reads of the encoder use
   * `stable_hash_access` (it describes the hand types' field reads, whatever the derive).
   */
  derive_decodable?: boolean;
  /** derive(Encodable) / Encodable_NoContext / TyEncodable / MetadataEncodable (`encodable_body`): `encode_<T>(self, __encoder[, encode_<P>...])`. */
  derive_encodable?: boolean;
  /** derive(Decodable)/(Encodable): emit only these items (names or keys); absent = every derived item of the set. */
  decodable_types?: string[];
  /**
   * derive(Decodable) of hand types whose TS value is not a `{ field }` object / `new T(..)`, keyed by type key:
   * `expr` builds the value from the decoded fields `$0..$n` (decoded first, in declaration order), `import` = values
   * it needs from the type's hand module (e.g. a branded newtype `ExpnHash(Fingerprint)`: `ExpnHash.of($0)`).
   */
  decodable_construct?: Record<string, { expr: string; import?: string[] }>;
  /**
   * derive(Decodable*): per-set override of serialize.json `decoders` (derive name -> the TS decoder type), for a set
   * whose decoder trait exists before the global entry can switch (e.g. `BlobDecodable` -> `BlobDecoder` while other
   * sets' callers still pass a plain `MemDecoder`).
   */
  decoders?: Record<string, { type: string; import: string; note?: string }>;
  /**
   * derive(Decodable*) of a per-file set: hand modules (src-relative paths) through which the generated `decode_<T>` of
   * their `.gen.ts` is *not* imported; it is imported from the `.gen.ts` itself (lane rmeta-ty: extension modules, which
   * a generated module must not evaluate early; ty-contract "Init order").
   */
  decodable_import_gen?: string[];
  /**
   * Type parameters erased from the TS types of this set's items (plan-m3 D3: `I: Interner`, generic code takes no
   * interner type). An erased parameter is dropped from the item's TS generics and from every reference's type
   * arguments at its position (`Binder<I, T>` -> `Binder<T>`, `ir::TraitRef<TyCtxt<'tcx>>` -> `TraitRef`), and
   * `<I as Interner>::X` reads as `I::X` (the interner's associated types resolve through the type map: `I::Ty`).
   */
  erase_params?: string[];
  /**
   * derive(TypeVisitable[_Generic]) / derive(TypeFoldable[_Generic]) (rustc_macros/src/type_visitable.rs,
   * type_foldable.rs; rustc_type_ir_macros/src/lib.rs): `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>`
   * next to the type in the file's `.gen.ts` (per-file sets only). Impls of external types: tools/codegen/type_fold.json.
   * derive(Lift[_Generic]) and derive(GenericTypeVisitable) are skipped (PORTING §3, plan-m3 D4; rust-analyzer only).
   */
  derive_type_fold?: boolean;
  /** derive(TypeVisitable/TypeFoldable): emit only these items (names or keys); absent = every derived item of the set. */
  type_fold_types?: string[];
  /**
   * derive(TypeVisitable/TypeFoldable) of these `hand` items is generated too (next to the re-export of the hand type in the
   * file's `.gen.ts`): for hand-written types whose derives are still codegen's (PORTING §5). A hand class (`class`) is
   * rebuilt with `new` (its constructor takes every field in declaration order, as the generated classes'), imported as a value.
   */
  type_fold_hand?: string[];
  /**
   * Upstream files probed for their `use` / `mod` declarations only (path resolution through their re-exports, e.g.
   * rustc_middle's ty/mod.rs `pub use self::sty::*;`): nothing is generated from them and their items do not resolve.
   */
  resolve_files?: string[];
  /** Emit `debug_<T>` for `bitflags! { #[derive(Debug)] struct T: uN { .. } }` (bitflags-2.10.0's internal Debug). */
  bitflags_debug?: boolean;
  /**
   * Type-map files (under tools/codegen, not named `typemap.*.json`) merged after the global type map for this set only:
   * their entries win over global ones for the same path (e.g. `rustc_middle::ty::Ty`, an `unknown` placeholder for other sets).
   */
  typemap_extra?: string[];
  /**
   * Rust paths whose diag_args.json entries this set does not use: its derives keep `unported_into_diag_arg` /
   * `unported_display` for them (reported as missing). For a `.gen.ts` that a defining module imports, where the
   * entry's import would evaluate modules that read that defining module's bindings at load (init order, TDZ).
   */
  diag_args_skip?: string[];
}

/** tools/codegen/type_fold.json: `TypeVisitable` / `TypeFoldable` impls of external types and the trait shapes. */
export interface TypeFoldMapEntry {
  paths: string[];
  /** `TrivialTypeTraversalImpls!`: visiting does nothing, folding returns the value */
  trivial?: boolean;
  /** `&T`, `Box<T>`, `Arc<T>`, ...: the impl of the type argument */
  transparent?: boolean;
  /** fn names (`$0..` = impls of the type arguments, passed after the visitor / folder) */
  visit?: string;
  try_fold?: string;
  fold?: string;
  /** module of the fn names (default: the map's `module`) */
  import?: string;
  note?: string;
}
export interface TypeFoldMap {
  /** module of the fn names and the trait types below */
  module: string;
  /** TS names of `TypeVisitor<R>`, `TypeFolder`, `FallibleTypeFolder<E>`, and the impl fn types `VisitWith<T>` / `TryFoldWith<T>` / `FoldWith<T>` */
  names: { visitor: string; folder: string; fallible_folder: string; visit_fn: string; try_fold_fn: string; fold_fn: string };
  /** impls of trivially traversable types as values (generic arguments) */
  trivial_fns: { visit: string; try_fold: string; fold: string };
  /** item keys or paths of trivially traversable types of the generated sets (`TrivialTypeTraversalImpls!`) */
  trivial: string[];
  types: TypeFoldMapEntry[];
}
/** `"Name as Alias"` (an import alias in a type map / type-fold map entry) -> `[Name, Alias]`; a plain name is its own alias. */
export function asAlias(s: string): [string, string] {
  const m = /^(\S+) as (\S+)$/.exec(s);
  return m ? [m[1]!, m[2]!] : [s, s];
}

export function loadTypeFoldMap(): TypeFoldMap {
  return JSON.parse(readFileSync(join(HERE, "type_fold.json"), "utf8"));
}
const TYPE_VISITABLE_DERIVES = ["TypeVisitable_Generic", "TypeVisitable"];
const TYPE_FOLDABLE_DERIVES = ["TypeFoldable_Generic", "TypeFoldable"];

/** tools/codegen/serialize.json: `Decodable`/`Encodable` impls of external (non-generated) types, and the decoder traits. */
export interface SerializeMapEntry {
  paths: string[];
  /** call template: `$D` the decoder, `$d0..$dn` Decodable fns of the type arguments */
  decode?: string;
  /** call template: `$v` the value, `$E` the encoder, `$e0..$en` Encodable fns of the type arguments */
  encode?: string;
  /** `Option`: templates for an undefined-able argument (`{ $: "Some", _0 } | undefined`, PORTING §5) */
  decode_nullable?: string;
  encode_nullable?: string;
  /** `Box`, `Rc`, `Arc`, `Cell`, ...: the impl of the type argument */
  transparent?: boolean;
  /** module of the `decode_*` / `encode_*` names the templates use (default: the map's `module`) */
  import?: string;
  /** other value names the templates use, imported from `values_import` (default: `import`) */
  values?: string[];
  values_import?: string;
  note?: string;
}
export interface SerializeMap {
  module: string;
  /** derive name -> the TS type of its `__D: <trait>` decoder (`Decodable` -> `SpanDecoder`, ...) */
  decoders: Record<string, { type: string; import: string; note?: string }>;
  /** derive name -> the TS type of its encoder */
  encoders: Record<string, { type: string; import: string; note?: string }>;
  types: SerializeMapEntry[];
}
export function loadSerializeMap(): SerializeMap {
  return JSON.parse(readFileSync(join(HERE, "serialize.json"), "utf8"));
}
const DECODABLE_DERIVES = ["Decodable_NoContext", "Decodable", "BlobDecodable", "LazyDecodable", "TyDecodable"];
const ENCODABLE_DERIVES = ["Encodable_NoContext", "Encodable", "TyEncodable", "MetadataEncodable"];

/** tools/codegen/stable_hash.json: `StableHash` impls of external (non-generated) types. */
export interface StableHashMapEntry {
  paths: string[];
  /** call template: `$v` value, `$hcx` / `$h` context and hasher, `$s0..$sn` StableHash fns of the type arguments */
  stable_hash?: string;
  /** `Option`: template for an undefined-able argument (`{ $: "Some", _0 } | undefined`, PORTING §5) */
  stable_hash_nullable?: string;
  /** `Box`, `Rc`, `Arc`, `&T`: the impl of the type argument */
  transparent?: boolean;
  /** `Vec<u8>`-like: a `u8` element uses the `[u8]` impl (`stable_hash_bytes`) */
  u8_seq?: boolean;
  /** module of the `stable_hash_*` names the template uses (default: the map's `module`) */
  import?: string;
  /** other names the template uses, by repo-relative module (e.g. an external type alias `BinOp = Spanned<BinOpKind>`) */
  imports?: Record<string, string[]>;
  note?: string;
}
export interface StableHashMap {
  module: string;
  types: StableHashMapEntry[];
}
export function loadStableHashMap(): StableHashMap {
  return JSON.parse(readFileSync(join(HERE, "stable_hash.json"), "utf8"));
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
  /** type arguments used when the type is written without them (`DiagSymbolList` = `DiagSymbolList<Symbol>`); see `$display0` */
  default_args?: PType[];
  /** the impl is for this first type argument only (`Vec<char>`: `"char"`); other instantiations do not match */
  arg0?: string;
  /** repo-relative module -> names used by the two expressions */
  imports?: Record<string, string[]>;
  note?: string;
}
/** `PrintAttribute` impls of types outside the generated sets (print_attribute.json). */
export interface PrintAttrEntry {
  paths: string[];
  /** expression of the `PrintAttribute<T>` table; `$p0`.. = tables of the type arguments */
  print: string;
  values: string[];
  note?: string;
}
export function loadPrintAttrs(): { import: string; types: PrintAttrEntry[] } {
  return JSON.parse(readFileSync(join(HERE, "print_attribute.json"), "utf8"));
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
  files: {
    upstream: string;
    out: string;
    types: number;
    debug_fns: number;
    clone_fns: number;
    walkable: number;
    diag_impls: number;
    print_attrs: number;
    stable_hash: number;
    decodable: number;
    encodable: number;
    type_fold: number;
  }[];
  unknown_types: Record<string, string[]>;
  missing_debug: Record<string, string[]>;
  manual_debug: { type: string; impl_at: string; defined_at: string; provide_in: string; generic_params: string[] }[];
  missing_clone: Record<string, string[]>;
  manual_clone: { type: string; impl_at: string; defined_at: string; provide_in: string; generic_params: string[] }[];
  unknown_cfg: Record<string, string[]>;
  macro_types: { at: string; macro: string; types: string[]; debug_formats: string[] }[];
  /** `IntoDiagArg` / `Display` of a diagnostic field type without an entry in diag_args.json (emitted as `unported`) */
  missing_diag_arg: Record<string, string[]>;
  /** derive(StableHash) field types with no StableHash impl (generated, manual or stable_hash.json): emitted as `unported` */
  missing_stable_hash: Record<string, string[]>;
  /** derive(Decodable) field types with no TS `decode_<T>` (generated, exported by a hand module, or serialize.json): emitted as `unported` */
  missing_decodable: Record<string, string[]>;
  /** derive(Encodable) field types with no TS `encode_<T>`: emitted as `unported` */
  missing_encodable: Record<string, string[]>;
  /** derive(TypeVisitable/TypeFoldable) field types with no impl (generated, manual or type_fold.json): emitted as `unported` */
  missing_type_fold: Record<string, string[]>;
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
  /** set for types produced by an item macro the generator expands (`newtype_index!`, `bitflags!`, `language_item_table!`) */
  mac?:
    | { kind: "newtype"; at: string; def: NewtypeIndex }
    | { kind: "bitflags"; at: string; def: BitflagsType }
    | { kind: "lang_items"; at: string; rows: LangItemRow[] };
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

/**
 * The traits of a `#[derive_where(Clone, Debug, ..; I: Interner)]` item attribute (derive-where 1.6.1 `DeriveWhere::from_attr`:
 * the trait list before the `;` bounds). Its other forms (`skip(..)`, `skip_inner(..)`, `default`, `incomparable`, field
 * and variant options) derive nothing.
 */
export function deriveWhereTraits(a: PAttr): string[] {
  if (a.path !== "derive_where" || !a.tokens) return [];
  const out: string[] = [];
  const toks = a.tokens;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t === "punct" && t.v === ";") break;
    if (t.t === "ident") {
      // `skip(..)` / `skip_inner(..)` / `crate = ..`: an option, not a trait list
      if (toks[i + 1]?.t === "group" || (toks[i + 1]?.t === "punct" && toks[i + 1]!.v === "=")) return [];
      // `::core::fmt::Debug`: the last segment
      while (toks[i + 1]?.t === "punct" && toks[i + 1]!.v === ":" && toks[i + 2]?.t === "punct" && toks[i + 2]!.v === ":" && toks[i + 3]?.t === "ident") i += 3;
      out.push(toks[i]!.v!);
    }
  }
  return out;
}

/** `#[derive_where(skip)]` / `#[derive_where(skip(Debug, ..))]` on a field: whether derive_where's `trait_` skips it. */
export function deriveWhereSkips(attrs: PAttr[], trait_: string): boolean {
  return attrs.some((a) => {
    if (a.path !== "derive_where" || !a.tokens) return false;
    const toks = a.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.t !== "ident" || t.v !== "skip") continue;
      const g = toks[i + 1];
      if (g?.t !== "group") return true;
      if ((g.tokens ?? []).some((x) => x.t === "ident" && x.v === trait_)) return true;
    }
    return false;
  });
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
    missing_stable_hash: {},
    missing_decodable: {},
    missing_encodable: {},
    missing_type_fold: {},
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
  const derives = (attrs: PAttr[], at: string) => effAttrs(attrs, at).flatMap((a) => a.derives ?? deriveWhereTraits(a));

  // `I: Interner` erasure (set `erase_params`, plan-m3 D3): `<I as Interner>::X` -> `I::X` in the set's types
  const erased = new Set(set.erase_params ?? []);
  if (erased.size) {
    const norm = (t: PType | null | undefined): void => {
      if (!t) return;
      const q = t.qself;
      if (q && q.kind === "path" && !q.qself && q.path!.segments.length === 1 && erased.has(q.path!.segments[0]!.name) && t.path) {
        const last = t.path.segments[t.path.segments.length - 1]!;
        t.path = { global: false, segments: [{ name: q.path!.segments[0]!.name, args: [] }, last] };
        delete t.qself;
      }
      for (const s of t.path?.segments ?? []) for (const a of s.args) norm(a.ty);
      norm(t.qself);
      norm(t.elem);
      for (const e of t.elems ?? []) norm(e);
    };
    for (const file of probe.files)
      for (const item of file.items ?? []) {
        norm(item.ty);
        for (const fl of item.fields?.fields ?? []) norm(fl.ty);
        for (const v of item.variants ?? []) for (const fl of v.fields.fields) norm(fl.ty);
        for (const p of item.generics.params) norm(p.default);
      }
  }

  // type map index
  const tmIndex = new Map<string, TypeMapEntry>();
  for (const e of tm.types) for (const p of e.paths) tmIndex.set(p, e);
  const helperModule = new Map<string, string>();
  for (const [m, names] of Object.entries(tm.helpers)) for (const n of names) helperModule.set(n, m);
  for (const name of set.typemap_extra ?? []) {
    const extra: Partial<TypeMap> = JSON.parse(readFileSync(join(HERE, name), "utf8"));
    for (const e of extra.types ?? []) for (const p of e.paths) tmIndex.set(p, e);
    for (const [m, names] of Object.entries(extra.helpers ?? {})) for (const n of names) helperModule.set(n, m);
  }

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
    const resolveOnly = set.resolve_files?.includes(file.path) === true;
    if (!resolveOnly) mfs.push(mf);
    for (let i = 1; i <= mod.length; i++) modsWithChildren.add(mod.slice(0, i).join("::"));
    for (const m of file.mods) modsWithChildren.add([...mod, ...m.module, m.name].join("::"));
    for (const u of file.uses) {
      const k = [...mod, ...u.module].join("::");
      if (!usesByMod.has(k)) usesByMod.set(k, []);
      usesByMod.get(k)!.push(u);
    }
    for (const item of resolveOnly ? [] : file.items) {
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
      if (m.kind !== "call" || (last !== "newtype_index" && last !== "bitflags" && last !== "language_item_table")) continue;
      const at = `${mf.file.path}:${m.line}`;
      try {
        const body = macroBody(upstreamSrc(mf.file.path), m.line);
        if (body === undefined) throw new Error("cannot find the macro body");
        if (last === "newtype_index") {
          const def = parseNewtypeIndex(body);
          const key = [...mf.mod, def.name].join("::");
          items.set(key, { item: synth(def.name, m.line), mf, mod: mf.mod, key, mac: { kind: "newtype", at, def } });
        } else if (last === "language_item_table") {
          // rustc_attr_ir/src/lang_items.rs: the `macro_rules!` declares `#[derive(..)] pub enum LangItem { $(
          // #[doc = concat!("The `", stringify!($name), "` lang item.")] $(#[$attr])* $variant, )* }` plus fns
          // over the rows (ported by hand over the `language_item_table` rows emitted after the enum).
          const defM = mf.file.macros.find((d) => d.kind === "macro_rules" && d.name === last && d.line < m.line);
          if (!defM) throw new Error("no macro_rules! language_item_table before the invocation in this file");
          const def = parseLanguageItemTableDef(upstreamSrc(mf.file.path).split("\n").slice(defM.line - 1, m.line - 1).join("\n"));
          const rows = parseLanguageItemTable(body);
          const key = [...mf.mod, def.name].join("::");
          const item: PItem = {
            kind: "enum",
            name: def.name,
            line: m.line,
            vis: "pub",
            module: [],
            attrs: [{ path: "derive", text: `derive(${def.derives.join(", ")})`, derives: def.derives }],
            docs: def.docs,
            generics: { params: [], where: [] },
            variants: rows.map((r) => ({
              name: r.variant,
              line: m.line,
              attrs: [],
              docs: [` The \`${r.name.split("::").pop()}\` lang item.`, ...r.docs],
              fields: { style: "unit", fields: [] },
              discriminant: null,
            })),
          };
          items.set(key, { item, mf, mod: mf.mod, key, mac: { kind: "lang_items", at, rows } });
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
  // `active`: the (path, module) pairs being resolved further up the stack. Re-entering one is a
  // cycle through glob imports (`use rustc_ast::*;` + `use rustc_errors::codes::*;` + ...), which
  // can only fail like the depth cutoff below; without the guard the glob loops branch
  // exponentially until that cutoff (minutes for a module with 3 globs).
  const active = new Set<string>();
  const absolutize = (segs: string[], mod: string[], depth: number): string[] | undefined => {
    if (depth > 12 || segs.length === 0) return undefined;
    const key = `a ${segs.join("::")} @ ${mod.join("::")}`;
    if (active.has(key)) return undefined;
    active.add(key);
    try {
      return absolutizeInner(segs, mod, depth);
    } finally {
      active.delete(key);
    }
  };
  const absolutizeInner = (segs: string[], mod: string[], depth: number): string[] | undefined => {
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
    // a glob of a local module (`use super::*;`) also imports that module's own `use`s of external
    // paths (`use rustc_span::Span;` in the parent)
    for (const g of uses.filter((u) => u.glob)) {
      const base = absolutize(g.path, mod, depth + 1);
      if (!base || !modsWithChildren.has(base.join("::"))) continue;
      if ((usesByMod.get(base.join("::")) ?? []).some((u) => !u.glob && u.alias === first)) return absolutize(segs, base, depth + 1);
    }
    // an external crate path (`std::..`, `rustc_span::..`) or a prelude name (`Option`)
    return segs;
  };
  // follow `use` re-exports to a generated item
  const lookup = (abs: string[], depth = 0): ItemRef | undefined => {
    if (depth > 12) return undefined;
    const key = `l ${abs.join("::")}`;
    if (active.has(key)) return undefined;
    active.add(key);
    try {
      return lookupInner(abs, depth);
    } finally {
      active.delete(key);
    }
  };
  const lookupInner = (abs: string[], depth: number): ItemRef | undefined => {
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
      // a bare name may also come from a glob import of an external crate; so may the first
      // segment of an unresolved path (`ast::Visibility` under `use rustc_ast::*;`, which imports
      // the module `rustc_ast::ast`)
      if ((segs.length === 1 && abs.length === 1) || (segs.length > 1 && abs.length === segs.length && abs.every((x, i) => x === segs[i])))
        for (const g of (usesByMod.get(sc.mod.join("::")) ?? []).filter((u) => u.glob)) {
          keys.push([...g.path, ...segs].join("::"));
          // `use super::*;` in an inline module: the name may be a `use` of the parent module
          const ga = absolutize(g.path, sc.mod, 0);
          if (ga) keys.push(extAbs([...ga, ...segs]).join("::"));
        }
      const alias = tmLookup(keys)?.item;
      const ar = alias === undefined ? undefined : items.get(alias);
      if (ar) return { k: "item", ref: ar };
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
  const typeArgs = (p: PPath): PType[] => {
    const seg = p.segments[p.segments.length - 1]!;
    const args = seg.args.filter((a) => a.kind === "type").map((a) => a.ty!);
    // `smallvec::SmallVec<A: Array>` is parameterised by its inline backing array `[T; N]`; the typemap entry
    // (`$0[]`, `debug_vec`, ...) is about the element type `T`, so `SmallVec<[T; N]>` reads as `SmallVec<T>`.
    if (seg.name === "SmallVec" && args.length === 1 && args[0]!.kind === "array") return [args[0]!.elem!];
    return args;
  };
  const tsParams = (it: PItem) => it.generics.params.filter((g) => g.kind === "type" && !erased.has(g.name));
  /** The type arguments of a reference to item `it` at the positions of its TS parameters (erased ones dropped). */
  const itemArgs = (it: PItem, args: PType[]): PType[] => {
    if (!erased.size) return args;
    const all = it.generics.params.filter((g) => g.kind === "type");
    return args.filter((_, i) => !erased.has(all[i]?.name ?? ""));
  };
  /** `typeArgs` of a resolved path, aligned with the TS parameters of an item. */
  const argsOf = (r: Resolved, p: PPath): PType[] => (r.k === "item" ? itemArgs(r.ref.item, typeArgs(p)) : typeArgs(p));
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
  // derive(StableHash) / derive(StableHash_NoContext); manual `impl StableHash` (hand-written
  // `stable_hash_<T>` in the hand module of the file with the impl); `newtype_index!` with `#[stable_hash]`
  const deriveStableHash = new Set<string>();
  for (const r of items.values()) {
    if (set.stable_hash_types !== undefined && !matches(set.stable_hash_types, r)) continue;
    if (hasDerive(r, "StableHash") || hasDerive(r, "StableHash_NoContext")) deriveStableHash.add(r.key);
    if (r.mac?.kind === "newtype" && r.mac.def.attrs.some((a) => a.name === "stable_hash")) deriveStableHash.add(r.key);
  }
  /**
   * Exported name of a derived `stable_hash_<T>`: `stable_hash_<T>` unless another derived item of the crate has the
   * same name (`ast::LitKind` / `token::LitKind`), then `stable_hash_<module>_<T>` for each of them.
   */
  const shDup = new Set<string>();
  {
    const seen = new Set<string>();
    for (const r of items.values()) {
      if (!deriveStableHash.has(r.key)) continue;
      const k = `${r.mf.crate}::${r.item.name}`;
      if (seen.has(k)) shDup.add(k);
      seen.add(k);
    }
  }
  const shExportName = (r: ItemRef): string =>
    shDup.has(`${r.mf.crate}::${r.item.name}`) ? `stable_hash_${r.mod[r.mod.length - 1]}_${r.item.name}` : `stable_hash_${r.item.name}`;
  const manualStableHash = new Map<string, ModFile>(); // item key -> file with the impl
  if (set.derive_stable_hash)
    for (const mf of mfs)
      for (const im of mf.file.impls) {
        if (!im.trait || !(im.trait === "StableHash" || im.trait.endsWith("::StableHash")) || im.self_ty.kind !== "path") continue;
        if (!enabled(im.attrs, `${mf.file.path}:${im.line}`)) continue;
        const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
        if (r.k === "item") manualStableHash.set(r.ref.key, mf);
        else report.notes.push(`manual StableHash impl for non-generated type ${im.self_ty.text} at ${mf.file.path}:${im.line}`);
      }
  const shMap = set.derive_stable_hash ? loadStableHashMap() : { module: "", types: [] };
  const shIndex = new Map<string, StableHashMapEntry>();
  for (const e of shMap.types) for (const p of e.paths) shIndex.set(p, e);
  // derive(Decodable*) / derive(Encodable*) (item key -> derive name); `newtype_index!` with `#[encodable]`;
  // manual `impl Decodable` / `impl Encodable` (a `decode_<T>` / `encode_<T>` exported by the hand module of
  // the impl's file; checked against that file, so a hand impl ported later is picked up on regeneration)
  const deriveDecodable = new Map<string, string>();
  const deriveEncodable = new Map<string, string>();
  const serWanted = (r: ItemRef) => set.decodable_types === undefined || matches(set.decodable_types, r);
  for (const r of items.values()) {
    if (!serWanted(r)) continue;
    if (set.derive_decodable) {
      const d = DECODABLE_DERIVES.find((n) => hasDerive(r, n));
      if (d) deriveDecodable.set(r.key, d);
      if (r.mac?.kind === "newtype" && r.mac.def.attrs.some((a) => a.name === "encodable")) deriveDecodable.set(r.key, "Decodable_NoContext");
    }
    if (set.derive_encodable) {
      const d = ENCODABLE_DERIVES.find((n) => hasDerive(r, n));
      if (d) deriveEncodable.set(r.key, d);
      if (r.mac?.kind === "newtype" && r.mac.def.attrs.some((a) => a.name === "encodable")) deriveEncodable.set(r.key, "Encodable_NoContext");
    }
  }
  const manualSer = { Decodable: new Map<string, ModFile>(), Encodable: new Map<string, ModFile>() };
  if (set.derive_decodable || set.derive_encodable)
    for (const mf of mfs)
      for (const im of mf.file.impls) {
        const tr = im.trait?.split("::").pop()?.replace(/<.*$/s, "");
        if ((tr !== "Decodable" && tr !== "Encodable") || im.self_ty.kind !== "path") continue;
        if (!enabled(im.attrs, `${mf.file.path}:${im.line}`)) continue;
        const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
        if (r.k === "item") manualSer[tr].set(r.ref.key, mf);
      }
  const serMap: SerializeMap = set.derive_decodable || set.derive_encodable ? loadSerializeMap() : { module: "", decoders: {}, encoders: {}, types: [] };
  const serIndex = new Map<string, SerializeMapEntry>();
  for (const e of serMap.types) for (const p of e.paths) serIndex.set(p, e);
  // derive(TypeVisitable[_Generic]) / derive(TypeFoldable[_Generic]); manual `impl TypeVisitable` / `impl TypeFoldable`
  // (`visit_with_<T>` / `try_fold_with_<T>` + `fold_with_<T>` in the hand module of the impl's file); type_fold.json
  const deriveVisit = new Map<string, string>();
  const deriveFold = new Map<string, string>();
  if (set.derive_type_fold)
    for (const r of items.values()) {
      if (set.type_fold_types !== undefined && !matches(set.type_fold_types, r)) continue;
      const v = TYPE_VISITABLE_DERIVES.find((n) => hasDerive(r, n));
      if (v) deriveVisit.set(r.key, v);
      const f = TYPE_FOLDABLE_DERIVES.find((n) => hasDerive(r, n));
      if (f) deriveFold.set(r.key, f);
    }
  const manualTF = { TypeVisitable: new Map<string, ModFile>(), TypeFoldable: new Map<string, ModFile>() };
  if (set.derive_type_fold)
    for (const mf of mfs)
      for (const im of mf.file.impls) {
        const tr = im.trait?.split("::").pop()?.replace(/<.*$/s, "");
        if ((tr !== "TypeVisitable" && tr !== "TypeFoldable") || im.self_ty.kind !== "path") continue;
        if (!enabled(im.attrs, `${mf.file.path}:${im.line}`)) continue;
        const r = resolvePath(im.self_ty.path!, { mf, mod: [...mf.mod, ...im.module], params: new Set() });
        if (r.k === "item") manualTF[tr].set(r.ref.key, mf);
      }
  const tfMap: TypeFoldMap = set.derive_type_fold
    ? loadTypeFoldMap()
    : { module: "", names: { visitor: "", folder: "", fallible_folder: "", visit_fn: "", try_fold_fn: "", fold_fn: "" }, trivial_fns: { visit: "", try_fold: "", fold: "" }, trivial: [], types: [] };
  const tfIndex = new Map<string, TypeFoldMapEntry>();
  for (const e of tfMap.types) for (const p of e.paths) tfIndex.set(p, e);
  // set-local type_fold.json entries (`type_fold` of the `typemap_extra` files) win over the global ones (lane mir-contract)
  if (set.derive_type_fold)
    for (const name of set.typemap_extra ?? []) {
      const extra: { type_fold?: TypeFoldMapEntry[] } = JSON.parse(readFileSync(join(HERE, name), "utf8"));
      for (const e of extra.type_fold ?? []) for (const p of e.paths) tfIndex.set(p, e);
    }
  const tfTrivial = new Set(tfMap.trivial);
  /** `export function <name>` / `export const <name>` / `export { .. <name> .. }` in a hand module (under --src-root). */
  const handExports = new Map<string, string>();
  const handExports_ = (hand: string, name: string): boolean => {
    let text = handExports.get(hand);
    if (text === undefined) {
      const p = join(opts.srcRoot, hand);
      text = existsSync(p) ? readFileSync(p, "utf8") : "";
      handExports.set(hand, text);
    }
    return new RegExp(`export (?:declare )?(?:function|const|let) ${name}\\b|export \\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);
  };
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
  const daIndex = new Map<string, DiagArgEntry[]>();
  for (const e of diagArgs) for (const p of e.paths) daIndex.set(p, [...(daIndex.get(p) ?? []), e]);
  const printAttrs = loadPrintAttrs();
  const paModule = printAttrs.import.replace(/^src\//, "");
  const paIndex = new Map<string, PrintAttrEntry>();
  for (const e of printAttrs.types) for (const p of e.paths) paIndex.set(p, e);

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
  // `bitflags! { #[derive(Debug)] struct X: uN { .. } }` with `bitflags_debug`
  if (set.bitflags_debug)
    for (const r of items.values())
      if (r.mac?.kind === "bitflags" && r.mac.def.form === "struct" && r.mac.def.attrs.some((a) => /^derive\s*\(.*\bDebug\b/s.test(a.name))) deriveDebug.add(r.key);
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

  // `#[derive(StableHash)]` impls: one generated module per crate, `<crate>/stable_hash.gen.ts`.
  const shMfs: (ModFile & { sh: true })[] = [];
  if (set.derive_stable_hash)
    for (const crate of [...new Set([...items.values()].filter((r) => deriveStableHash.has(r.key)).map((r) => r.mf.crate))]) {
      const file: PFile = { path: `compiler/${crate}/src/lib.rs`, attrs: [], items: [], uses: [], impls: [], macros: [], mods: [] };
      shMfs.push({ file, crate, mod: [crate, "stable_hash"], gen: `${crate}/stable_hash.gen.ts`, hand: `${crate}/lib.ts`, sh: true });
    }

  // `derive_only` sets: the derive(Decodable)/(Encodable) impls of the (hand-written) types go into one generated
  // module per crate, `<crate>/decodable.gen.ts`; other sets emit them next to each type.
  const serMfs: (ModFile & { ser: true })[] = [];
  if (set.derive_only)
    for (const crate of [...new Set([...items.values()].filter((r) => deriveDecodable.has(r.key) || deriveEncodable.has(r.key)).map((r) => r.mf.crate))]) {
      const file: PFile = { path: `compiler/${crate}/src/lib.rs`, attrs: [], items: [], uses: [], impls: [], macros: [], mods: [] };
      serMfs.push({ file, crate, mod: [crate, "decodable"], gen: `${crate}/decodable.gen.ts`, hand: `${crate}/lib.ts`, ser: true });
    }

  for (const mf of [...mfs, ...walkMfs, ...shMfs, ...serMfs]) {
    const walk = (mf as { walk?: "ref" | "mut" }).walk;
    const sh = (mf as { sh?: true }).sh === true;
    const ser = (mf as { ser?: true }).ser === true;
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
    let fileStableHash = 0;
    let fileDecodable = 0;
    let fileEncodable = 0;
    let fileTypeFold = 0;

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
    /**
     * Items of inline modules (`mod unexpected_cfg_name { .. }` inside the file) are emitted inside
     * `export namespace <mod> { .. }` (nested for nested modules). `curRel` is the inline-module path of the
     * item being emitted; `localName` qualifies a name of this file's item `r` as seen from there.
     */
    let curRel: string[] = [];
    const relMod = (r: ItemRef): string[] => r.mod.slice(mf.mod.length);
    const localName = (r: ItemRef, name: string): string => {
      const rel = relMod(r);
      let i = 0;
      while (i < rel.length && i < curRel.length && rel[i] === curRel[i]) i++;
      return [...rel.slice(i), name].join(".");
    };
    /**
     * A `hand` item inside an inline module: nothing is emitted for it (a namespace cannot re-export);
     * the hand module defines it at top level together with its `debug_<T>` / `clone_<T>`.
     */
    const handInline = (r: ItemRef): boolean => matches(set.hand, r) && r.mod.length > r.mf.mod.length;
    /** The TS name of a generated item as seen from this file (imports it if needed). */
    const refName = (r: ItemRef): string => {
      if (r.mf === mf) return handInline(r) ? r.item.name : localName(r, r.item.name);
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
      const alias = deriveDebug.has(r.key) && r.mf === mf && !handInline(r) ? localName(r, name) : `debug_${tname}`;
      if (handInline(r)) {
        imp(`src:${r.mf.hand}`, "values", name, alias);
        addStub(r.mf.hand, name, `export declare function ${name}(v: any, f: Fmt, ...d: Debug<any>[]): string;`);
      } else if (deriveDebug.has(r.key)) {
        if (r.mf !== mf) imp(viaHand(r), "values", name, alias);
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
      for (const t0 of e.types ?? []) {
        // `"Name as Alias"`: imported under the alias (the `ts` template uses it), for a name the set's own items take
        const [t, ta] = asAlias(t0);
        imp(`src:${e.import.replace(/^src\//, "")}`, "types", t, ta);
        const arity = new Set(e.ts.match(/\$\d/g) ?? []).size;
        const ps = Array.from({ length: arity }, (_, i) => `T${i}`);
        addStub(
          e.import.replace(/^src\//, ""),
          t,
          `export type ${t}${ps.length ? `<${ps.join(", ")}>` : ""} = { readonly __stub: "${t}"${ps.length ? `; readonly __args?: [${ps.join(", ")}]` : ""} };`,
        );
      }
      if (withValues)
        for (const v0 of e.values ?? []) {
          const [v, va] = asAlias(v0);
          imp(`src:${e.import.replace(/^src\//, "")}`, "values", v, va);
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
          const args = argsOf(r, ty.path!);
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
            const a = args[i] ?? e.default_args?.[i];
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
        const args = argsOf(r, ty.path!);
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
          const args = argsOf(r, ty.path!);
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
          for (const n of new Set(e.debug.match(/\$d\d/g) ?? [])) {
            const a = args[Number(n.slice(2))] ?? e.default_args?.[Number(n.slice(2))];
            if (!a) {
              report.errors.push(`${at}: ${r.display} needs type arg ${n.slice(2)} (Debug)`);
              return `unknown_debug(${v})`;
            }
            out = out.replaceAll(n, paren(dbgFn(a, sc, at)));
          }
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
      const local = deriveClone.has(r.key) && !matches(set.hand, r);
      const alias = local && r.mf === mf ? localName(r, name) : `clone_${tname}`;
      if (local) {
        if (r.mf !== mf) imp(viaHand(r), "values", name, alias);
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
          const args = argsOf(r, ty.path!);
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
          const args = argsOf(r, ty.path!);
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
          if (e.import) for (const n of e.clone_values ?? []) imp(`src:${e.import.replace(/^src\//, "")}`, "values", n, n);
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

    // ---- derive(Default) ----
    /** `T::default()` as a TS expression. */
    const defExpr = (ty: PType, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "tuple":
          return ty.elems!.length === 0 ? "null" : `[${ty.elems!.map((e) => defExpr(e, sc, at)).join(", ")}] as ${tsType(ty, sc, at)}`;
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const sub = sc.subst?.get(r.name);
            if (sub) return defExpr(sub.ty, sub.scope, at);
            break;
          }
          if (r.k === "item") {
            if (r.ref.item.kind === "type") return defExpr(r.ref.item.ty!, aliasScope(r.ref, args, sc), at);
            if (!hasDerive(r.ref, "Default") || tsParams(r.ref.item).length) break;
            const n = `default_${r.ref.item.name}`;
            const alias = r.ref.mf === mf ? localName(r.ref, n) : `default_${refName(r.ref)}`;
            if (r.ref.mf !== mf) imp(viaHand(r.ref), "values", n, alias);
            return `${alias}()`;
          }
          const e = tmLookup(r.keys);
          if (!e || e.default == null) break;
          if (e.import) for (const v of e.default_values ?? []) imp(`src:${e.import.replace(/^src\//, "")}`, "values", v, v);
          let out = e.default;
          for (const n of new Set(e.default.match(/\$e\d/g) ?? [])) out = out.replaceAll(n, defExpr(args[Number(n.slice(2))]!, sc, at));
          return out;
        }
      }
      report.errors.push(`${at}: no Default for field type \`${ty.text}\` (typemap \`default\`)`);
      return "unported_default()";
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
          const args = argsOf(r, ty.path!);
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

    // ---- derive(StableHash) (rustc_macros/src/stable_hash.rs) ----
    const shModule = `src:${shMap.module.replace(/^src\//, "")}`;
    /** A `stable_hash_*` helper of rustc_data_structures/stable_hash.ts (or `module`), imported. */
    const shUse = (name: string, module: string = shModule): string => {
      imp(module, "values", name, name);
      return name;
    };
    const shAliasOwner = new Map<string, string>();
    /** `stable_hash_<T>` of an item as seen from this file. */
    const shItemName = (r: ItemRef, at: string): string => {
      let alias = `stable_hash_${r.item.name}`;
      const taken = shAliasOwner.get(alias);
      if (taken !== undefined && taken !== r.key) alias = `stable_hash_${r.mod[r.mod.length - 1]}_${r.item.name}`;
      shAliasOwner.set(alias, r.key);
      const name = `stable_hash_${r.item.name}`;
      if (deriveStableHash.has(r.key)) {
        const exported = shExportName(r);
        if (exported !== name) {
          if (r.mf.crate !== mf.crate) imp(`gen:${r.mf.crate}/stable_hash.gen.ts`, "values", exported, exported);
          return exported;
        }
        if (r.mf.crate !== mf.crate) imp(`gen:${r.mf.crate}/stable_hash.gen.ts`, "values", name, alias);
        else if (alias !== name) report.errors.push(`${at}: two derive(StableHash) types named ${r.item.name} in ${mf.crate}`);
        return alias;
      }
      const implMf = manualStableHash.get(r.key);
      if (implMf) {
        imp(`src:${implMf.hand}`, "values", name, alias);
        addStub(implMf.hand, name, `export declare function ${name}(v: any, hcx: any, hasher: any, ...s: any[]): void;`);
        return alias;
      }
      push(report.missing_stable_hash, r.key, at);
      return "unported_stable_hash";
    };
    const isU8 = (ty: PType, sc: Scope): boolean => {
      if (ty.kind !== "path" || ty.qself) return false;
      const r = resolvePath(ty.path!, sc);
      return r.k === "ext" && r.keys.includes("u8");
    };
    const H = "__hcx, __hasher";
    /** `StableHash::stable_hash(v, __hcx, __hasher)` for a value of type `ty`. */
    const shExpr = (ty: PType, v: string, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "ref":
        case "ptr":
          // `impl<T: StableHash> StableHash for &T`: the referent
          return shExpr(ty.elem!, v, sc, at);
        case "slice":
        case "array":
          // an array hashes as its slice (method autoref + unsizing); `[u8]` has its own impl
          if (isU8(ty.elem!, sc)) return `${shUse("stable_hash_bytes")}(${v}, ${H})`;
          return `${shUse("stable_hash_slice")}(${v}, ${H}, ${shFn(ty.elem!, sc, at)})`;
        case "tuple": {
          const n = ty.elems!.length;
          if (n === 0) return `${shUse("stable_hash_unit")}(${v}, ${H})`;
          if (n > 4) {
            report.errors.push(`${at}: StableHash of a ${n}-tuple (impls exist up to 4)`);
            return `unported_stable_hash(${v})`;
          }
          return `${shUse(`stable_hash_tuple${n}`)}(${v}, ${H}, ${ty.elems!.map((e) => shFn(e, sc, at)).join(", ")})`;
        }
        case "never":
          return `${shUse("stable_hash_never")}(${v}, ${H})`;
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? shExpr(s.ty, v, s.scope, at) : `stable_hash_${r.name}(${v}, ${H})`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            if (it.kind === "type") return shExpr(it.ty!, v, aliasScope(r.ref, args, sc), at);
            const fn = shItemName(r.ref, at);
            const fns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) return shFn(a, sc, at);
              if (p.default) return shFn(p.default, itemScope(r.ref), at);
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              return "unported_stable_hash";
            });
            return `${fn}(${v}, ${H}${fns.map((f) => `, ${f}`).join("")})`;
          }
          let e: StableHashMapEntry | undefined;
          for (const k of r.keys) if ((e = shIndex.get(k))) break;
          if (!e) {
            push(report.missing_stable_hash, r.display, at);
            return `unported_stable_hash(${v})`;
          }
          if (e.transparent) return shExpr(args[0]!, v, sc, at);
          if (e.u8_seq && args[0] && isU8(args[0], sc)) return `${shUse("stable_hash_bytes")}(${v}, ${H})`;
          const tmpl = e.stable_hash_nullable !== undefined && args[0] && nullable(args[0], sc) ? e.stable_hash_nullable : e.stable_hash;
          if (tmpl === undefined) {
            push(report.missing_stable_hash, `${r.display} (${e.note ?? "no StableHash in stable_hash.json"})`, at);
            return `unported_stable_hash(${v})`;
          }
          const mod = e.import ? `src:${e.import.replace(/^src\//, "")}` : shModule;
          const named = new Set<string>();
          for (const [m, ns] of Object.entries(e.imports ?? {})) for (const n of ns) named.add(shUse(n, `src:${m.replace(/^src\//, "")}`));
          for (const m of tmpl.matchAll(/\b(stable_hash_\w+)\(/g)) if (!named.has(m[1]!)) shUse(m[1]!, mod);
          let out = tmpl.replaceAll("$hcx", "__hcx").replaceAll("$h", "__hasher").replaceAll("$v", v);
          for (const n of new Set(tmpl.match(/\$s\d/g) ?? [])) {
            const a = args[Number(n.slice(2))];
            if (!a) {
              report.errors.push(`${at}: ${r.display} needs type arg ${n.slice(2)} for StableHash`);
              return `unported_stable_hash(${v})`;
            }
            out = out.replaceAll(n, shFn(a, sc, at));
          }
          return out;
        }
      }
      push(report.missing_stable_hash, `${ty.kind}: ${ty.text}`, at);
      return `unported_stable_hash(${v})`;
    };
    /** The StableHash impl of a type as a value (`StableHash<T>`). */
    const shFn = (ty: PType, sc: Scope, at: string): string => {
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `stable_hash_${r.name}`;
        if (r.k === "item" && r.ref.item.kind !== "type" && tsParams(r.ref.item).length === 0) return shItemName(r.ref, at);
        if (r.k === "ext") {
          let e: StableHashMapEntry | undefined;
          for (const k of r.keys) if ((e = shIndex.get(k))) break;
          const m = e?.stable_hash && /^(stable_hash_\w+)\(\$v, \$hcx, \$h\)$/.exec(e.stable_hash);
          if (m && !e!.transparent) return shUse(m[1]!, e!.import ? `src:${e!.import.replace(/^src\//, "")}` : shModule);
        }
      }
      return `(__v, __hcx, __hasher) => ${shExpr(ty, "__v", sc, at)}`;
    };
    /** `#[stable_hash(ignore)]` / `#[stable_hash(project(name))]` of a field (stable_hash.rs `parse_attributes`). */
    const shAttrs = (fl: PField, at: string): { ignore: boolean; project?: string } => {
      const attrs: { ignore: boolean; project?: string } = { ignore: false };
      for (const a of effAttrs(fl.attrs, at)) {
        if (a.path !== "stable_hash") continue;
        const m = /^stable_hash\s*\((.*)\)$/s.exec(a.text);
        let any_attr = false;
        for (const part of (m?.[1] ?? "").split(",").map((p) => p.trim())) {
          if (part === "ignore") {
            attrs.ignore = true;
            any_attr = true;
          }
          const pm = /^project\s*\(\s*(\w+)\s*\)$/.exec(part);
          if (pm) {
            if (attrs.project === undefined) attrs.project = pm[1]!;
            any_attr = true;
          }
        }
        // `panic!("error parsing stable_hash")`
        if (!any_attr) report.errors.push(`${at}: error parsing stable_hash (#[${a.text}])`);
      }
      return attrs;
    };
    /** Read of field `fl` of a value `owner` of item `r` (respecting `stable_hash_access`). */
    const shField = (r: ItemRef, fl: PField, owner: string): string => {
      const acc = set.stable_hash_access?.[`${r.key}::${fl.name === null ? fl.index : unraw(fl.name)}`];
      if (!acc) return `${owner}.${fieldName(fl)}`;
      for (const n of acc.import ?? []) imp(`src:${r.mf.hand}`, "values", n, n);
      return acc.expr.replaceAll("$v", owner);
    };
    const shBody = (): string[] => {
      const out: string[] = [];
      imp(shModule, "types", "StableHash", "StableHash");
      imp(shModule, "types", "StableHashCtxt", "StableHashCtxt");
      imp(shModule, "types", "StableHasher", "StableHasher");
      const fileOrder = new Map(mfs.map((m, i) => [m, i]));
      const list = [...items.values()]
        .filter((r) => r.mf.crate === mf.crate && deriveStableHash.has(r.key) && !matches(set.skip, r))
        .sort((a, b) => fileOrder.get(a.mf)! - fileOrder.get(b.mf)! || a.item.line - b.item.line);
      for (const r of list) {
        const it = r.item;
        const at = r.mac ? r.mac.at : `${r.mf.file.path}:${it.line}`;
        const sc = itemScope(r);
        const tname = refName(r);
        const ps = tsParams(it).map((p) => p.name);
        const gen = ps.length ? `<${ps.join(", ")}>` : "";
        const self = `${tname}${gen}`;
        const extra = ps.map((p) => `, stable_hash_${p}: StableHash<${p}>`).join("");
        const fname = shExportName(r);
        out.push("");
        if (r.mac?.kind === "newtype") {
          // rustc_index_macros/src/newtype.rs `#[stable_hash]`: `self.as_u32().stable_hash(hcx, hasher)`
          out.push(`// rustc-derive: ${at} newtype_index! #[stable_hash] for ${it.name}`);
          out.push(`export function ${fname}(self: ${tname}, __hcx: StableHashCtxt, __hasher: StableHasher): void {`);
          out.push(`  ${shUse("stable_hash_u32")}(self, ${H});`);
          out.push("}");
          fileStableHash++;
          continue;
        }
        if (r.mac?.kind === "bitflags" && r.mac.def.form === "impl" && it.kind === "struct" && it.fields?.style === "unnamed" && it.fields.fields.length === 1) {
          // `#[derive(StableHash)] struct Flags(u8);` + `bitflags! { impl Flags: u8 { .. } }`: the derive hashes the
          // single field, and the TS value (a branded number) is that field
          out.push(`// rustc-derive: ${r.mf.file.path}:${it.line} StableHash for ${it.name}`);
          out.push(`export function ${fname}(self: ${tname}, __hcx: StableHashCtxt, __hasher: StableHasher): void {`);
          out.push(`  ${shExpr(it.fields.fields[0]!.ty, "self", sc, at)};`);
          out.push("}");
          fileStableHash++;
          continue;
        }
        if (r.mac) {
          report.errors.push(`${at}: derive(StableHash) on a ${r.mac.kind} type`);
          continue;
        }
        if (it.kind !== "struct" && it.kind !== "enum") {
          // `panic!("cannot derive on union")`
          report.errors.push(`${at}: derive(StableHash) on a ${it.kind}`);
          continue;
        }
        const fieldStmts = (fs: PFields, owner: string, fat0: string): string[] => {
          const stmts: string[] = [];
          for (const fl of liveFields(fs, r.mf.file.path)) {
            const fat = `${r.mf.file.path}:${fl.line}`;
            const a = shAttrs(fl, fat);
            if (a.ignore) continue;
            const v = it.kind === "struct" ? shField(r, fl, owner) : `${owner}.${fieldName(fl)}`;
            if (a.project !== undefined) {
              // `(&#bi.#project).stable_hash(__hcx, __hasher)`: a field of the field's (struct) type
              const ft = fl.ty.kind === "ref" ? fl.ty.elem! : fl.ty;
              const fr = ft.kind === "path" && !ft.qself ? resolvePath(ft.path!, sc) : undefined;
              const inner = fr?.k === "item" && fr.ref.item.kind === "struct" ? fr.ref.item.fields!.fields.find((f) => f.name !== null && unraw(f.name) === a.project) : undefined;
              if (!inner || fr?.k !== "item") {
                report.errors.push(`${fat}: #[stable_hash(project(${a.project}))]: cannot resolve the projected field of ${ft.text}`);
                stmts.push(`unported_stable_hash(${v});`);
                continue;
              }
              stmts.push(`${shExpr(inner.ty, shField(fr.ref, inner, v), itemScope(fr.ref), fat)};`);
            } else stmts.push(`${shExpr(fl.ty, v, sc, fat)};`);
          }
          void fat0;
          return stmts;
        };
        out.push(`// rustc-derive: ${at} StableHash for ${it.name}`);
        if (it.kind === "struct") {
          const stmts = fieldStmts(it.fields!, "self", at);
          const selfName = stmts.length ? "self" : "_self";
          out.push(`export function ${fname}${gen}(${selfName}: ${self}, __hcx: StableHashCtxt, __hasher: StableHasher${extra}): void {`);
          out.push(...stmts.map((st) => `  ${st}`));
          out.push("}");
          fileStableHash++;
          continue;
        }
        // enums: `::std::mem::discriminant(self).stable_hash(__hcx, __hasher);` then `match *self { .. }`
        const variants = it.variants!.filter((v) => enabled(v.attrs, `${r.mf.file.path}:${v.line}`));
        const fieldless = fieldlessEnum(r);
        const reprs = effAttrs(it.attrs, at).flatMap((a) => a.repr ?? []).filter((x) => /^[iu](8|16|32|64|128|size)$/.test(x));
        const repr = reprs[0];
        if (repr && !["i8", "i16", "i32", "isize", "u8", "u16", "u32", "usize"].includes(repr)) report.errors.push(`${at}: #[repr(${repr})] discriminant hashing not supported`);
        // discriminant values: explicit `= n`, else previous + 1 (from 0)
        let next = 0n;
        const discr: string[] = [];
        for (const v of variants) {
          if (v.discriminant !== null) {
            const n = parseIntLit(v.discriminant);
            if (n === undefined) report.errors.push(`${r.mf.file.path}:${v.line}: cannot evaluate discriminant \`${v.discriminant}\` of ${r.key}::${v.name}`);
            else next = n;
          }
          discr.push(`${unraw(v.name)}: ${next}`);
          next++;
        }
        const table = `${fname.slice("stable_hash_".length)}__discriminant`;
        out.push(`const ${table} = { ${discr.join(", ")} } as const;`);
        const tag = fieldless ? "self" : "self.$";
        const arms: [string, string[]][] = [];
        if (!fieldless) for (const v of variants) arms.push([unraw(v.name), fieldStmts(v.fields, "self", at)]);
        out.push(`export function ${fname}${gen}(self: ${self}, __hcx: StableHashCtxt, __hasher: StableHasher${extra}): void {`);
        out.push(`  ${shUse("stable_hash_Discriminant")}(${table}[${tag}], ${H}${repr ? `, ${JSON.stringify(repr)}` : ""});`);
        if (arms.some(([, st]) => st.length)) {
          out.push("  switch (self.$) {");
          for (const [vn, st] of arms) {
            out.push(`    case ${JSON.stringify(vn)}:`);
            out.push(...st.map((x) => `      ${x}`));
            out.push("      break;");
          }
          out.push("  }");
        }
        out.push("}");
        fileStableHash++;
      }
      return out;
    };

    // ---- derive(Decodable) / derive(Encodable) (rustc_macros/src/serialize.rs) ----
    const serModule = `src:${serMap.module.replace(/^src\//, "")}`;
    /** A `decode_*` / `encode_*` impl of rustc_serialize/serialize.ts (or `module`), imported. */
    const serUse = (name: string, module: string = serModule): string => {
      imp(module, "values", name, name);
      return name;
    };
    const serAliasOwner = new Map<string, string>();
    /** Whether this set generates the derive of `r` (hand types of per-file sets bring their own). */
    const serGenerated = (kind: "decode" | "encode", r: ItemRef): boolean =>
      (kind === "decode" ? deriveDecodable : deriveEncodable).has(r.key) &&
      (set.derive_only === true || (!matches(set.hand, r) && (!r.mac || r.mac.kind === "newtype" || r.mac.kind === "lang_items" || (r.mac.kind === "bitflags" && r.mac.def.form === "impl"))));
    /** `decode_<T>` / `encode_<T>` of an item as seen from this file (imported if needed). */
    const serItemName = (kind: "decode" | "encode", r: ItemRef, at: string): string => {
      const name = `${kind}_${r.item.name}`;
      if (serGenerated(kind, r)) {
        if (!ser && r.mf === mf) return localName(r, name);
        let alias = name;
        const taken = serAliasOwner.get(alias);
        if (taken !== undefined && taken !== r.key) alias = `${kind}_${r.mod[r.mod.length - 1]}_${r.item.name}`;
        serAliasOwner.set(alias, r.key);
        if (ser) {
          if (r.mf.crate !== mf.crate) imp(`gen:${r.mf.crate}/decodable.gen.ts`, "values", name, alias);
          else if (alias !== name) report.errors.push(`${at}: two derive(${kind === "decode" ? "Decodable" : "Encodable"}) types named ${r.item.name} in ${mf.crate}`);
        } else imp(set.decodable_import_gen?.includes(r.mf.hand) ? `gen:${r.mf.gen}` : viaHand(r), "values", name, alias);
        return alias;
      }
      // a manual impl (or a hand type's derive): `decode_<T>` exported by the hand module
      const implMf = manualSer[kind === "decode" ? "Decodable" : "Encodable"].get(r.key);
      const hand = implMf?.hand ?? r.mf.hand;
      if ((implMf || matches(set.hand, r)) && handExports_(hand, name)) {
        let alias = name;
        const taken = serAliasOwner.get(alias);
        if (taken !== undefined && taken !== r.key) alias = `${kind}_${r.mod[r.mod.length - 1]}_${r.item.name}`;
        serAliasOwner.set(alias, r.key);
        imp(`src:${hand}`, "values", name, alias);
        return alias;
      }
      push(
        kind === "decode" ? report.missing_decodable : report.missing_encodable,
        implMf ? `${r.key} (manual impl in ${implMf.file.path}: src/${hand} exports no ${name})` : r.key,
        at,
      );
      return `unported_${kind === "decode" ? "decodable" : "encodable"}`;
    };
    const serEntry = (keys: string[]): SerializeMapEntry | undefined => {
      for (const k of keys) {
        const e = serIndex.get(k);
        if (e) return e;
      }
      return undefined;
    };
    /**
     * A serialize.json entry for an item of the set whose derive this set does not generate and whose hand module
     * exports no `decode_<T>`: its `Decodable` impl is hand-written in another module than the type's (rustc_middle
     * ty/codec.rs `Predicate` / `Clause`, rustc_type_ir serialize.rs `Binder` / `Region` / `Const`). Keyed by the
     * item's key. A type alias's entry (`GenericArgsRef`: the alias hides a reference) is used before the alias is
     * expanded.
     */
    const serItemEntry = (r: ItemRef): SerializeMapEntry | undefined => {
      if (serGenerated("decode", r)) return undefined;
      const e = serIndex.get(r.key);
      if (e === undefined || r.item.kind === "type") return e;
      const implMf = manualSer.Decodable.get(r.key);
      const hand = implMf?.hand ?? r.mf.hand;
      if ((implMf || matches(set.hand, r)) && handExports_(hand, `decode_${r.item.name}`)) return undefined;
      return e;
    };
    const serEntryModule = (e: SerializeMapEntry) => (e.import ? `src:${e.import.replace(/^src\//, "")}` : serModule);
    /** `N` of an array type `[T; N]` (a literal). */
    const arrayLen = (ty: PType, at: string): string | undefined => {
      const m = /;\s*(.+?)\s*\]$/s.exec(ty.text);
      const n = m ? parseIntLit(m[1]!) : undefined;
      if (n === undefined) report.errors.push(`${at}: cannot evaluate the length of ${ty.text}`);
      return n === undefined ? undefined : String(n);
    };
    const DEC = "__decoder";
    const ENC = "__encoder";
    /** `Decodable::decode(__decoder)` of a field of type `ty` (serialize.rs `decode_field`). */
    const decExpr = (ty: PType, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "ref": {
          // `::rustc_middle::ty::codec::RefDecodable::decode(__decoder)` for reference fields. A serialize.json entry
          // keyed `&<referent>` (the `renderKey` text, e.g. `&[(Clause, Span)]`) names the referent's `RefDecodable`
          // impl (rustc_middle arena.rs `impl_ref_decodable_into_arena!`, ty/codec/ref_decodable.rs); for a slice
          // referent its `$d0` is the element's Decodable fn.
          const re = serIndex.get(`&${renderKey(ty.elem!)}`);
          if (re !== undefined) return decTemplate(re, `RefDecodable for ${ty.text}`, ty.elem!.kind === "slice" ? [ty.elem!.elem!] : [ty.elem!], sc, at);
          push(report.missing_decodable, `RefDecodable (reference field ${ty.text})`, at);
          return `unported_decodable(${DEC})`;
        }
        case "slice":
          // only reachable through `Box<[T]>` / `Rc<[T]>` / `Arc<[T]>`, which decode a `Vec<T>`
          return `${serUse("decode_Vec")}(${DEC}, ${decFn(ty.elem!, sc, at)})`;
        case "array": {
          const n = arrayLen(ty, at);
          if (n === undefined) return `unported_decodable(${DEC})`;
          return `${serUse("decode_array")}(${DEC}, ${n}, ${decFn(ty.elem!, sc, at)})`;
        }
        case "tuple":
          if (ty.elems!.length === 0) return `${serUse("decode_unit")}(${DEC})`;
          return `${serUse("decode_tuple")}(${DEC}, ${ty.elems!.map((e) => decFn(e, sc, at)).join(", ")})`;
        case "never":
          return `${serUse("decode_never")}(${DEC})`;
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? decExpr(s.ty, s.scope, at) : `decode_${r.name}(${DEC})`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            const ie = serItemEntry(r.ref);
            if (ie) return decTemplate(ie, r.ref.key, args, sc, at);
            if (it.kind === "type") return decExpr(it.ty!, aliasScope(r.ref, args, sc), at);
            const fn = serItemName("decode", r.ref, at);
            const fns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) return decFn(a, sc, at);
              if (p.default) return decFn(p.default, itemScope(r.ref), at);
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              return "unported_decodable";
            });
            return `${fn}(${DEC}${fns.map((f) => `, ${f}`).join("")})`;
          }
          const e = serEntry(r.keys);
          if (!e) {
            push(report.missing_decodable, r.display, at);
            return `unported_decodable(${DEC})`;
          }
          return decTemplate(e, r.display, args, sc, at);
        }
      }
      push(report.missing_decodable, `${ty.kind}: ${ty.text}`, at);
      return `unported_decodable(${DEC})`;
    };
    /** A serialize.json entry `e` applied to type arguments `args` (`$D` the decoder, `$d<k>` their Decodable fns). */
    const decTemplate = (e: SerializeMapEntry, display: string, args: PType[], sc: Scope, at: string): string => {
      if (e.transparent) return decExpr(args[0]!, sc, at);
      const tmpl = e.decode_nullable !== undefined && args[0] && nullable(args[0], sc) ? e.decode_nullable : e.decode;
      if (tmpl === undefined) {
        push(report.missing_decodable, `${display} (${e.note ?? "no decode in serialize.json"})`, at);
        return `unported_decodable(${DEC})`;
      }
      const mod = serEntryModule(e);
      for (const m of tmpl.matchAll(/(?<![.\w])(decode_\w+)\(/g)) serUse(m[1]!, mod);
      for (const v of e.values ?? []) if (tmpl.includes(v)) serUse(v, e.values_import ? `src:${e.values_import.replace(/^src\//, "")}` : mod);
      let out = tmpl.replaceAll("$D", () => DEC);
      for (const n of new Set(tmpl.match(/\$d\d/g) ?? [])) {
        const a = args[Number(n.slice(2))];
        if (!a) {
          report.errors.push(`${at}: ${display} needs type arg ${n.slice(2)} for Decodable`);
          return `unported_decodable(${DEC})`;
        }
        const f = decFn(a, sc, at);
        out = out.replaceAll(n, () => f);
      }
      return out;
    };
    /** The Decodable impl of a type as a value (`Decodable<T, D>`). */
    const decFn = (ty: PType, sc: Scope, at: string): string => {
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `decode_${r.name}`;
        if (r.k === "item" && r.ref.item.kind !== "type" && tsParams(r.ref.item).length === 0 && !serItemEntry(r.ref)) return serItemName("decode", r.ref, at);
        if (r.k === "ext" || (r.k === "item" && serItemEntry(r.ref))) {
          const e = r.k === "ext" ? serEntry(r.keys) : serItemEntry(r.ref);
          const m = e?.decode && /^(decode_\w+)\(\$D\)$/.exec(e.decode);
          if (e && m && !e.transparent) return serUse(m[1]!, serEntryModule(e));
        }
      }
      return `(${DEC}) => ${decExpr(ty, sc, at)}`;
    };
    /** `Encodable::encode(v, __encoder)` for a value `v` of type `ty`. */
    const encExpr = (ty: PType, v: string, sc: Scope, at: string): string => {
      switch (ty.kind) {
        case "ref":
          // `impl<S: Encoder, T: ?Sized + PointeeSized> Encodable<S> for &T`: the referent
          return encExpr(ty.elem!, v, sc, at);
        case "slice":
          return `${serUse("encode_slice")}(${v}, ${ENC}, ${encFn(ty.elem!, sc, at)})`;
        case "array":
          return `${serUse("encode_array")}(${v}, ${ENC}, ${encFn(ty.elem!, sc, at)})`;
        case "tuple":
          if (ty.elems!.length === 0) return `${serUse("encode_unit")}(${v}, ${ENC})`;
          return `${serUse("encode_tuple")}(${v}, ${ENC}, ${ty.elems!.map((e) => encFn(e, sc, at)).join(", ")})`;
        case "never":
          return `${serUse("encode_never")}(${v}, ${ENC})`;
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? encExpr(s.ty, v, s.scope, at) : `encode_${r.name}(${v}, ${ENC})`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            if (it.kind === "type") return encExpr(it.ty!, v, aliasScope(r.ref, args, sc), at);
            const fn = serItemName("encode", r.ref, at);
            const fns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) return encFn(a, sc, at);
              if (p.default) return encFn(p.default, itemScope(r.ref), at);
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              return "unported_encodable";
            });
            return `${fn}(${v}, ${ENC}${fns.map((f) => `, ${f}`).join("")})`;
          }
          const e = serEntry(r.keys);
          if (!e) {
            push(report.missing_encodable, r.display, at);
            return `unported_encodable(${v})`;
          }
          if (e.transparent) return encExpr(args[0]!, v, sc, at);
          const tmpl = e.encode_nullable !== undefined && args[0] && nullable(args[0], sc) ? e.encode_nullable : e.encode;
          if (tmpl === undefined) {
            push(report.missing_encodable, `${r.display} (${e.note ?? "no encode in serialize.json"})`, at);
            return `unported_encodable(${v})`;
          }
          const mod = serEntryModule(e);
          for (const m of tmpl.matchAll(/(?<![.\w])(encode_\w+)\(/g)) serUse(m[1]!, mod);
          for (const x of e.values ?? []) if (tmpl.includes(x)) serUse(x, e.values_import ? `src:${e.values_import.replace(/^src\//, "")}` : mod);
          let out = tmpl.replaceAll("$E", () => ENC).replaceAll("$v", () => v);
          for (const n of new Set(tmpl.match(/\$e\d/g) ?? [])) {
            const a = args[Number(n.slice(2))];
            if (!a) {
              report.errors.push(`${at}: ${r.display} needs type arg ${n.slice(2)} for Encodable`);
              return `unported_encodable(${v})`;
            }
            const f = encFn(a, sc, at);
            out = out.replaceAll(n, () => f);
          }
          return out;
        }
      }
      push(report.missing_encodable, `${ty.kind}: ${ty.text}`, at);
      return `unported_encodable(${v})`;
    };
    /** The Encodable impl of a type as a value (`Encodable<T, E>`). */
    const encFn = (ty: PType, sc: Scope, at: string): string => {
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `encode_${r.name}`;
        if (r.k === "item" && r.ref.item.kind !== "type" && tsParams(r.ref.item).length === 0) return serItemName("encode", r.ref, at);
        if (r.k === "ext") {
          const e = serEntry(r.keys);
          const m = e?.encode && /^(encode_\w+)\(\$v, \$E\)$/.exec(e.encode);
          if (e && m && !e.transparent) return serUse(m[1]!, serEntryModule(e));
        }
      }
      return `(__v, ${ENC}) => ${encExpr(ty, "__v", sc, at)}`;
    };
    /** The value companion of item `r` as seen from this file (unit variants, `newtype_index!` helpers). */
    const serCompanion = (r: ItemRef): string => {
      if (!ser && r.mf === mf) return localName(r, r.item.name);
      const tname = refName(r);
      imp(ser ? `src:${r.mf.hand}` : viaHand(r), "values", r.item.name, tname);
      return tname;
    };
    /** The decoder / encoder type of a derive (serialize.json `decoders` / `encoders`), imported. */
    const serTraitType = (kind: "decode" | "encode", derive: string, at: string): string => {
      const t = (kind === "decode" ? (set.decoders?.[derive] ?? serMap.decoders[derive]) : serMap.encoders[derive]);
      if (!t) {
        report.errors.push(`${at}: no ${kind === "decode" ? "decoder" : "encoder"} type for derive(${derive}) in serialize.json`);
        return kind === "decode" ? "unknown" : "unknown";
      }
      imp(`src:${t.import.replace(/^src\//, "")}`, "types", t.type, t.type);
      return t.type;
    };
    /** `decode_<T>` / `encode_<T>` of item `r` (serialize.rs `decodable_body` / `encodable_body`). */
    const serLines = (r: ItemRef): string[] => {
      const out: string[] = [];
      const it = r.item;
      const at = r.mac ? r.mac.at : `${r.mf.file.path}:${it.line}`;
      const wantDec = serGenerated("decode", r);
      const wantEnc = serGenerated("encode", r);
      if (!wantDec && !wantEnc) return out;
      const sc = itemScope(r);
      const tname = refName(r);
      const ps = tsParams(it).map((p) => p.name);
      const gen = ps.length ? `<${ps.join(", ")}>` : "";
      const self = `${tname}${gen}`;
      const decName = `decode_${it.name}`;
      const encName = `encode_${it.name}`;
      const flagsStruct = r.mac?.kind === "bitflags" && r.mac.def.form === "impl" && it.kind === "struct" && it.fields!.style === "unnamed" && it.fields!.fields.length === 1;
      // `language_item_table!`'s `#[derive(.., Encodable, BlobDecodable, ..)] pub enum LangItem` is a synthesized enum item.
      if (r.mac && r.mac.kind !== "newtype" && r.mac.kind !== "lang_items" && !flagsStruct) {
        report.errors.push(`${at}: derive(Decodable/Encodable) on a ${r.mac.kind} type`);
        return out;
      }
      if (!r.mac && it.kind !== "struct" && it.kind !== "enum") {
        // `panic!("cannot derive on union")`
        report.errors.push(`${at}: derive(Decodable/Encodable) on a ${it.kind}`);
        return out;
      }
      const DT = wantDec ? serTraitType("decode", deriveDecodable.get(r.key)!, at) : "";
      const ET = wantEnc ? serTraitType("encode", deriveEncodable.get(r.key)!, at) : "";
      if (wantDec && ps.length) imp(serModule, "types", "Decodable", "Decodable");
      if (wantEnc && ps.length) imp(serModule, "types", "Encodable", "Encodable");
      // A generic type's impl is generic over the decoder too (`impl<__D: SpanDecoder, T: Decodable<__D>> Decodable<__D>`), so
      // a caller with a richer decoder (a `SpanDecoder` decoding a `BlobDecodable` `Visibility<ModId>`) passes its own fns.
      const decHead = ps.length
        ? `export function ${decName}<${ps.join(", ")}, __D extends ${DT} = ${DT}>(${DEC}: __D${ps.map((p) => `, decode_${p}: Decodable<${p}, __D>`).join("")}): ${self} {`
        : `export function ${decName}(${DEC}: ${DT}): ${self} {`;
      const encHead = (used: boolean) =>
        `export function ${encName}${gen}(${used ? "self" : "_self"}: ${self}, ${ENC}: ${ET}${ps.map((p) => `, encode_${p}: Encodable<${p}, ${ET}>`).join("")}): void {`;
      if (flagsStruct) {
        // `#[derive(Decodable, Encodable)] struct X(uN);` + `bitflags! { impl X: uN { .. } }`: the derive sees a
        // plain tuple struct, so it decodes / encodes the bits field (e.g. rustc_hir::def::MacroKinds). The TS value
        // is the branded number itself.
        const fl = it.fields!.fields[0]!;
        const fat = `${r.mf.file.path}:${fl.line}`;
        if (wantDec) {
          out.push(`// rustc-derive: ${at} ${deriveDecodable.get(r.key)} for ${it.name}`);
          out.push(decHead, `  return ${decExpr(fl.ty, sc, fat)} as ${self};`, "}");
          fileDecodable++;
        }
        if (wantEnc) {
          out.push(`// rustc-derive: ${at} ${deriveEncodable.get(r.key)} for ${it.name}`);
          out.push(encHead(true), `  ${encExpr(fl.ty, "self", sc, fat)};`, "}");
          fileEncodable++;
        }
        return out;
      }
      if (r.mac?.kind === "newtype") {
        // rustc_index_macros/src/newtype.rs `#[encodable]`: `Self::from_u32(d.read_u32())` / `e.emit_u32(self.as_u32())`
        const c = serCompanion(r);
        if (wantDec) {
          out.push(`// rustc-derive: ${at} newtype_index! #[encodable] Decodable for ${it.name}`);
          out.push(decHead, `  return ${c}.from_u32(${DEC}.read_u32());`, "}");
          fileDecodable++;
        }
        if (wantEnc) {
          out.push(`// rustc-derive: ${at} newtype_index! #[encodable] Encodable for ${it.name}`);
          out.push(encHead(true), `  ${ENC}.emit_u32(${c}.as_u32(self));`, "}");
          fileEncodable++;
        }
        return out;
      }
      // the struct, or the enum's variants (`s.variants()`)
      type V = { name: string | undefined; style: string; fields: PField[]; line: number };
      const vs: V[] =
        it.kind === "struct"
          ? [{ name: undefined, style: it.fields!.style, fields: liveFields(it.fields!, r.mf.file.path), line: it.line }]
          : it.variants!.filter((v) => enabled(v.attrs, `${r.mf.file.path}:${v.line}`)).map((v) => ({ name: unraw(v.name), style: v.fields.style, fields: liveFields(v.fields, r.mf.file.path), line: v.line }));
      const fieldless = it.kind === "enum" && fieldlessEnum(r);
      const fat = (fl: PField) => `${r.mf.file.path}:${fl.line}`;
      if (wantDec) {
        /** `vi.construct(|field, _index| decode_field(field))` as statements ending in `return`. */
        const construct = (v: V, indent: string): string[] => {
          if (v.name !== undefined) {
            if (fieldless) return [`${indent}return ${JSON.stringify(v.name)};`];
            if (v.style === "unit") return [`${indent}return ${serCompanion(r)}.${v.name};`];
            return [`${indent}return { $: ${JSON.stringify(v.name)}${v.fields.map((fl) => `, ${fieldName(fl)}: ${decExpr(fl.ty, sc, fat(fl))}`).join("")} };`];
          }
          const vals = v.fields.map((fl) => decExpr(fl.ty, sc, fat(fl)));
          const cons = set.decodable_construct?.[r.key];
          if (cons) {
            for (const n of cons.import ?? []) imp(ser ? `src:${r.mf.hand}` : viaHand(r), "values", n, n);
            let e = cons.expr;
            for (let i = vals.length - 1; i >= 0; i--) e = e.replaceAll(`$${i}`, `__${i}`);
            return [...vals.map((x, i) => `${indent}const __${i} = ${x};`), `${indent}return ${e};`];
          }
          // `derive_only` modules import the hand class as a value (the per-file module defines it)
          if (isClass(r)) return [`${indent}return new ${ser ? serCompanion(r) : tname}(${vals.join(", ")});`];
          if (!vals.length) return [`${indent}return {};`];
          return [`${indent}return {`, ...v.fields.map((fl, i) => `${indent}  ${fieldName(fl)}: ${vals[i]},`), `${indent}};`];
        };
        out.push(`// rustc-derive: ${at} ${deriveDecodable.get(r.key)} for ${it.name}`);
        out.push(decHead);
        if (vs.length === 0) {
          out.push(`  return ${serUse("panic", "src:std/panic.ts")}(${JSON.stringify(`\`${it.name}\` has no variants to decode`)});`);
        } else if (vs.length === 1) {
          out.push(...construct(vs[0]!, "  "));
        } else {
          const tag = vs.length < 255 ? `${DEC}.read_u8()` : `${DEC}.read_usize()`;
          out.push(`  const __tag = ${tag};`, "  switch (__tag) {");
          vs.forEach((v, i) => {
            out.push(`    case ${i}:`, ...construct(v, "      "));
          });
          out.push("    default:");
          out.push(`      return ${serUse("panic", "src:std/panic.ts")}(\`invalid enum variant tag while decoding \\\`${it.name}\\\`, expected 0..${vs.length}, actual \${__tag}\`);`);
          out.push("  }");
        }
        out.push("}");
        fileDecodable++;
      }
      if (wantEnc) {
        const read = (fl: PField, owner: string) => (it.kind === "struct" ? shField(r, fl, owner) : `${owner}.${fieldName(fl)}`);
        const stmts = (v: V, indent: string) => v.fields.map((fl) => `${indent}${encExpr(fl.ty, read(fl, "self"), sc, fat(fl))};`);
        const lines: string[] = [];
        if (vs.length === 1) {
          // Unit-like types don't need to encode anything.
          lines.push(...stmts(vs[0]!, "  "));
        } else if (vs.length > 1) {
          // This code generates two separate match statements on purpose, because
          //  LLVM can optimize the first one into direct discriminant read.
          //  See: https://github.com/rust-lang/rust/pull/108440
          // `let disc = match *self { V0 => 0, V1 => 1, .. };` (a hoisted fn: cycle-safe, unlike a const table)
          const table = `${it.name}__variant_index`;
          out.push(`function ${table}${gen}(tag: ${fieldless ? self : `${self}["$"]`}): number {`, "  switch (tag) {");
          vs.forEach((v, i) => out.push(`    case ${JSON.stringify(v.name)}:`, `      return ${i};`));
          out.push("  }", "}");
          lines.push(`  const disc = ${table}(${fieldless ? "self" : "self.$"});`);
          lines.push(`  ${ENC}.${vs.length < 255 ? "emit_u8" : "emit_usize"}(disc);`);
          if (!vs.every((v) => v.fields.length === 0)) {
            lines.push("  switch (self.$) {");
            for (const v of vs) {
              lines.push(`    case ${JSON.stringify(v.name)}:`, ...stmts(v, "      "), "      break;");
            }
            lines.push("  }");
          }
        }
        out.push(`// rustc-derive: ${at} ${deriveEncodable.get(r.key)} for ${it.name}`);
        out.push(encHead(lines.length > 0), ...lines, "}");
        fileEncodable++;
      }
      return out;
    };
    /** `<crate>/decodable.gen.ts` of a `derive_only` set: every derived type of the crate, in file / line order. */
    const serBody = (): string[] => {
      const out: string[] = [];
      const fileOrder = new Map(mfs.map((m, i) => [m, i]));
      const list = [...items.values()]
        .filter((r) => r.mf.crate === mf.crate && (deriveDecodable.has(r.key) || deriveEncodable.has(r.key)) && !matches(set.skip, r))
        .sort((a, b) => fileOrder.get(a.mf)! - fileOrder.get(b.mf)! || a.item.line - b.item.line);
      for (const r of list) out.push("", ...serLines(r));
      return out;
    };

    // ---- derive(TypeVisitable) / derive(TypeFoldable) (rustc_macros/src/type_visitable.rs + type_foldable.rs,
    // rustc_type_ir_macros/src/lib.rs `type_visitable_derive` / `type_foldable_derive`) ----
    type TfKind = "visit" | "try_fold" | "fold";
    const TF_PREFIX: Record<TfKind, string> = { visit: "visit_with", try_fold: "try_fold_with", fold: "fold_with" };
    const tfModule = `src:${tfMap.module.replace(/^src\//, "")}`;
    const tfUse = (name0: string, module: string = tfModule): string => {
      const [name, alias] = asAlias(name0);
      imp(module, "values", name, alias);
      return alias;
    };
    const tfType = (name: string): string => {
      imp(tfModule, "types", name, name);
      return name;
    };
    const tfAliasOwner = new Map<string, string>();
    /** Whether this set generates the impl of `r` (hand types bring their own). */
    const tfGenerated = (kind: TfKind, r: ItemRef): boolean =>
      (kind === "visit" ? deriveVisit : deriveFold).has(r.key) && (!matches(set.hand, r) || matches(set.type_fold_hand ?? [], r)) && !r.mac;
    /** `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` of an item as seen from this file; `null`: trivially traversable. */
    const tfItemName = (kind: TfKind, r: ItemRef, at: string): string | null => {
      const name = `${TF_PREFIX[kind]}_${r.item.name}`;
      const aliasFor = () => {
        let alias = name;
        const taken = tfAliasOwner.get(alias);
        if (taken !== undefined && taken !== r.key) alias = `${TF_PREFIX[kind]}_${r.mod[r.mod.length - 1]}_${r.item.name}`;
        tfAliasOwner.set(alias, r.key);
        return alias;
      };
      if (tfGenerated(kind, r)) {
        if (r.mf === mf) return localName(r, name);
        const alias = aliasFor();
        imp(viaHand(r), "values", name, alias);
        return alias;
      }
      if (tfTrivial.has(r.key)) return null;
      // a manual impl: the hand module of the impl's file exports the fn
      const implMf = manualTF[kind === "visit" ? "TypeVisitable" : "TypeFoldable"].get(r.key);
      if (implMf || matches(set.hand, r)) {
        const hand = implMf?.hand ?? r.mf.hand;
        const alias = aliasFor();
        imp(`src:${hand}`, "values", name, alias);
        addStub(hand, name, `export declare function ${name}(v: any, ...a: any[]): any;`);
        return alias;
      }
      push(report.missing_type_fold, `${r.key} (${kind === "visit" ? "TypeVisitable" : "TypeFoldable"})`, at);
      return "unported_type_fold";
    };
    const tfEntry = (keys: string[]): TypeFoldMapEntry | undefined => {
      for (const k of keys) {
        const e = tfIndex.get(k);
        if (e) return e;
      }
      return undefined;
    };
    const tfHolder = (kind: TfKind) => (kind === "visit" ? "__visitor" : "__folder");
    /**
     * Explicit type arguments of a call to a generic impl fn (`visit_with_X<T1, .., R>`): TS cannot infer `T` from an impl fn
     * argument that is itself generic (`visit_with_trivial`), so the types of the arguments are spelled out, then `R` / `E`
     * (the enclosing fn's, or the typed closure's of `tfFn`).
     */
    const tfTypeArgs = (kind: TfKind, tys: string[]): string => {
      const all = kind === "visit" ? [...tys, "R"] : kind === "try_fold" ? [...tys, "E"] : tys;
      return all.length ? `<${all.join(", ")}>` : "";
    };
    /** An external impl (type_fold.json) applied to `v`, with the impls of `args` (`null`: trivial). */
    const tfExt = (kind: TfKind, e: TypeFoldMapEntry, display: string, args: PType[], v: string, sc: Scope, at: string): string | null => {
      if (e.trivial) return null;
      if (e.transparent) return tfExpr(kind, args[0]!, v, sc, at);
      const fn = e[kind];
      if (fn === undefined) {
        push(report.missing_type_fold, `${display} (${e.note ?? `no ${kind} in type_fold.json`})`, at);
        return `unported_type_fold(${v})`;
      }
      // `name($1, $0)`: the impls of these type arguments, in this order
      const name = tfUse(fn.replace(/\(.*$/s, ""), e.import ? `src:${e.import.replace(/^src\//, "")}` : tfModule);
      const fns: string[] = [];
      const tys: string[] = [];
      for (const m of fn.matchAll(/\$(\d)/g)) {
        const a = args[Number(m[1])];
        if (!a) {
          report.errors.push(`${at}: ${display} needs type arg ${m[1]} for ${kind}`);
          return `unported_type_fold(${v})`;
        }
        fns.push(tfFn(kind, a, sc, at));
        tys.push(tsType(a, sc, at));
      }
      const targs = tys.length ? tfTypeArgs(kind, tys) : "";
      return `${name}${targs}(${v}, ${tfHolder(kind)}${fns.map((f) => `, ${f}`).join("")})`;
    };
    /** `TypeVisitable::visit_with(v, __visitor)` / `try_fold_with(v, __folder)` / `fold_with(v, __folder)`; `null`: trivial. */
    const tfExpr = (kind: TfKind, ty: PType, v: string, sc: Scope, at: string): string | null => {
      switch (ty.kind) {
        case "ref":
          // `impl<I, T: TypeVisitable<I> + ?Sized> TypeVisitable<I> for &T`: the referent
          return tfExpr(kind, ty.elem!, v, sc, at);
        case "tuple": {
          if (ty.elems!.length === 0) return null; // `()` is in `TrivialTypeTraversalImpls!`
          const key = ty.elems!.length === 2 ? "(T, U)" : ty.elems!.length === 3 ? "(A, B, C)" : `${ty.elems!.length}-tuple`;
          const e = tfIndex.get(key);
          if (!e) break;
          return tfExt(kind, e, ty.text, ty.elems!, v, sc, at);
        }
        case "slice":
        case "array": {
          const e = tfIndex.get(ty.kind === "slice" ? "[T]" : "[T; N]");
          if (!e) break;
          return tfExt(kind, e, ty.text, [ty.elem!], v, sc, at);
        }
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const s = sc.subst?.get(r.name);
            return s ? tfExpr(kind, s.ty, v, s.scope, at) : `${TF_PREFIX[kind]}_${r.name}(${v}, ${tfHolder(kind)})`;
          }
          if (r.k === "item") {
            const it = r.ref.item;
            // an alias with its own impl entry (`GenericArgsRef<'tcx>`, whose fold differs per `List` element type)
            const ae = it.kind === "type" ? tfEntry([r.ref.key]) : undefined;
            if (ae) return tfExt(kind, ae, r.ref.key, args, v, sc, at);
            if (it.kind === "type" && !matches(set.hand, r.ref)) return tfExpr(kind, it.ty!, v, aliasScope(r.ref, args, sc), at);
            const fn = tfItemName(kind, r.ref, at);
            if (fn === null) return null;
            if (fn === "unported_type_fold") return `unported_type_fold(${v})`;
            const tys: string[] = [];
            const fns = tsParams(it).map((p, i) => {
              const a = args[i];
              if (a) {
                tys.push(tsType(a, sc, at));
                return tfFn(kind, a, sc, at);
              }
              if (p.default) {
                tys.push(tsType(p.default, itemScope(r.ref), at));
                return tfFn(kind, p.default, itemScope(r.ref), at);
              }
              report.errors.push(`${at}: missing type argument ${p.name} for ${r.ref.key}`);
              tys.push("never");
              return "unported_type_fold";
            });
            const targs = tys.length ? tfTypeArgs(kind, tys) : "";
            return `${fn}${targs}(${v}, ${tfHolder(kind)}${fns.map((f) => `, ${f}`).join("")})`;
          }
          if (r.keys.some((k) => tfTrivial.has(k))) return null;
          // an impl of one instance of a generic type (`&List<Binder<ExistentialPredicate>>`: `list_fold!` impls differ per
          // element type): the entry keyed `<path><<arg keys>>`, before the generic entry
          const inst = args.length ? tfEntry(r.keys.map((k) => `${k}<${args.map((a) => tfTypeKey(a, sc)).join(", ")}>`)) : undefined;
          if (inst) return tfExt(kind, inst, r.display, args, v, sc, at);
          const e = tfEntry(r.keys);
          if (!e) {
            push(report.missing_type_fold, r.display, at);
            return `unported_type_fold(${v})`;
          }
          if (e.paths.includes("Option") && args[0] && nullable(args[0], sc)) {
            report.errors.push(`${at}: TypeVisitable/TypeFoldable of Option<undefined-able> (${ty.text}) is not supported`);
            return `unported_type_fold(${v})`;
          }
          return tfExt(kind, e, r.display, args, v, sc, at);
        }
      }
      push(report.missing_type_fold, `${ty.kind}: ${ty.text}`, at);
      return `unported_type_fold(${v})`;
    };
    /** A type as an instance key of type_fold.json (`rustc_middle::ty::Binder<rustc_middle::ty::ExistentialPredicate>`):
     *  paths by their first resolved key (items by item key), type arguments in `<..>`, references by their referent. */
    const tfTypeKey = (ty: PType, sc: Scope): string => {
      if (ty.kind === "ref") return tfTypeKey(ty.elem!, sc);
      if (ty.kind !== "path" || ty.qself) return ty.text;
      const r = resolvePath(ty.path!, sc);
      const head = r.k === "param" ? r.name : r.k === "item" ? r.ref.key : (r.keys[0] ?? r.display);
      const args = argsOf(r, ty.path!);
      return args.length ? `${head}<${args.map((a) => tfTypeKey(a, sc)).join(", ")}>` : head;
    };
    /** The impl of a type as a value (`VisitWith<T>` / `TryFoldWith<T>` / `FoldWith<T>`). */
    const tfFn = (kind: TfKind, ty: PType, sc: Scope, at: string): string => {
      if (ty.kind === "path" && !ty.qself) {
        const r = resolvePath(ty.path!, sc);
        if (r.k === "param" && !sc.subst?.has(r.name)) return `${TF_PREFIX[kind]}_${r.name}`;
        if (r.k === "item" && r.ref.item.kind !== "type" && tsParams(r.ref.item).length === 0) {
          const fn = tfItemName(kind, r.ref, at);
          return fn ?? tfUse(tfMap.trivial_fns[kind]);
        }
        if (r.k === "ext" && !r.keys.some((k) => tfTrivial.has(k))) {
          const e = tfEntry(r.keys);
          const fn = e?.[kind];
          if (e && fn && !e.trivial && !e.transparent && !/\$\d/.test(fn)) return tfUse(fn.replace(/\(.*$/s, ""), e.import ? `src:${e.import.replace(/^src\//, "")}` : tfModule);
        }
      }
      const e = tfExpr(kind, ty, "__v", sc, at);
      if (e === null) return tfUse(tfMap.trivial_fns[kind]);
      // a typed closure: its own `R` / `E` (TS does not make an unannotated closure generic)
      const T = tsType(ty, sc, at);
      if (kind === "visit") return `<R>(__v: ${T}, __visitor: ${tfType(tfMap.names.visitor)}<R>): R => ${e}`;
      if (kind === "try_fold") {
        imp("src:std/result.ts", "types", "Result", "Result");
        return `<E>(__v: ${T}, __folder: ${tfType(tfMap.names.fallible_folder)}<E>): Result<${T}, E> => ${e}`;
      }
      return `(__v: ${T}, __folder: ${tfType(tfMap.names.folder)}): ${T} => ${e}`;
    };
    /** `#[type_visitable(ignore)]` / `#[type_foldable(identity)]` of a field (`has_ignore_attr`). */
    const tfAttr = (fl: PField, name: string, meta: string, at: string): boolean =>
      effAttrs(fl.attrs, at).some((a) => a.path === name && new RegExp(`^${name}\\s*\\((.*\\b)?${meta}\\b`, "s").test(a.text));
    /** The impls of item `r` (synstructure: struct fields / enum variants in declaration order). */
    const tfLines = (r: ItemRef): string[] => {
      const out: string[] = [];
      const wantV = tfGenerated("visit", r);
      const wantF = tfGenerated("fold", r);
      if (!wantV && !wantF) return out;
      const it = r.item;
      const at = `${r.mf.file.path}:${it.line}`;
      if (it.kind !== "struct" && it.kind !== "enum") {
        // `panic!("cannot derive on union")`
        report.errors.push(`${at}: derive(TypeVisitable/TypeFoldable) on a ${it.kind}`);
        return out;
      }
      const sc = itemScope(r);
      const tname = refName(r);
      // a hand class rebuilt by the fold (`type_fold_hand`): its constructor is a value of the hand module
      if (wantF && isClass(r) && matches(set.hand, r)) imp(`src:${r.mf.hand}`, "values", it.name, tname);
      const ps = tsParams(it).map((p) => p.name);
      const self = `${tname}${ps.length ? `<${ps.join(", ")}>` : ""}`;
      type V = { name: string | undefined; style: string; fields: PField[] };
      const vs: V[] =
        it.kind === "struct"
          ? [{ name: undefined, style: it.fields!.style, fields: liveFields(it.fields!, r.mf.file.path) }]
          : it.variants!.filter((v) => enabled(v.attrs, `${r.mf.file.path}:${v.line}`)).map((v) => ({ name: unraw(v.name), style: v.fields.style, fields: liveFields(v.fields, r.mf.file.path) }));
      const fieldless = it.kind === "enum" && fieldlessEnum(r);
      const fat = (fl: PField) => `${r.mf.file.path}:${fl.line}`;
      if (wantV) {
        const visitor = tfType(tfMap.names.visitor);
        const vfn = tfType(tfMap.names.visit_fn);
        const stmtsOf = (v: V, indent: string): string[] => {
          const st: string[] = [];
          for (const fl of v.fields) {
            if (tfAttr(fl, "type_visitable", "ignore", fat(fl))) continue;
            const e = tfExpr("visit", fl.ty, `self.${fieldName(fl)}`, sc, fat(fl));
            // PORT: a trivially traversable field (`TrivialTypeTraversalImpls!`) visits to `V::Result::output()`, whose
            // `branch` always continues: its `try_visit!` is left out.
            if (e === null) continue;
            st.push(`${indent}if ((r = ${tfUse("try_visit", "src:rustc_ast_ir/visit.ts")}(__visitor.Result, ${e})) !== undefined) return r;`);
          }
          return st;
        };
        const arms = fieldless ? [] : vs.map((v) => [v, stmtsOf(v, it.kind === "struct" ? "  " : "      ")] as const);
        const used = arms.some(([, st]) => st.length > 0);
        out.push(`// rustc-derive: ${at} ${deriveVisit.get(r.key)} for ${it.name}`);
        out.push(
          `export function ${TF_PREFIX.visit}_${it.name}<${[...ps, "R"].join(", ")}>(${used ? "self" : "_self"}: ${self}, __visitor: ${visitor}<R>${ps.map((p) => `, ${TF_PREFIX.visit}_${p}: ${vfn}<${p}>`).join("")}): R {`,
        );
        if (used) out.push("  let r: R | undefined;");
        if (it.kind === "struct") out.push(...arms[0]![1]);
        else if (used) {
          out.push("  switch (self.$) {");
          for (const [v, st] of arms) if (st.length) out.push(`    case ${JSON.stringify(v.name)}:`, ...st, "      break;");
          out.push("  }");
        }
        out.push("  return __visitor.Result.output();", "}");
        fileTypeFold++;
      }
      if (wantF) {
        for (const kind of ["try_fold", "fold"] as const) {
          const folder = tfType(kind === "fold" ? tfMap.names.folder : tfMap.names.fallible_folder);
          const ffn = tfType(kind === "fold" ? tfMap.names.fold_fn : tfMap.names.try_fold_fn);
          if (kind === "try_fold") imp("src:std/result.ts", "types", "Result", "Result");
          const ret = kind === "fold" ? self : `Result<${self}, E>`;
          const wrap = (x: string) => (kind === "fold" ? x : `${tfUse("Ok", "src:std/result.ts")}(${x})`);
          /** `vi.construct(..)`: statements ending in `return`. */
          const construct = (v: V, indent: string): string[] => {
            const st: string[] = [];
            const vals: string[] = [];
            for (const [i, fl] of v.fields.entries()) {
              const read = `self.${fieldName(fl)}`;
              // retain value of fields with #[type_foldable(identity)]
              const e = tfAttr(fl, "type_foldable", "identity", fat(fl)) ? null : tfExpr(kind, fl.ty, read, sc, fat(fl));
              if (e === null) vals.push(read);
              else if (kind === "fold") vals.push(e);
              else if (e.startsWith("unported_type_fold(")) {
                // no impl upstream either (the derived impl's where-clause never holds): the fn ends here
                st.push(`${indent}return ${e};`);
                return st;
              } else {
                // `::rustc_type_ir::TypeFoldable::try_fold_with(#bind, __folder)?`
                st.push(`${indent}const __${i} = ${e};`, `${indent}if (__${i}.$ === "Err") return __${i};`);
                vals.push(`__${i}._0`);
              }
            }
            let value: string;
            if (v.name !== undefined) {
              if (v.style === "unit") value = "self";
              else value = `{ $: ${JSON.stringify(v.name)} as const${v.fields.map((fl, i) => `, ${fieldName(fl)}: ${vals[i]}`).join("")} }`;
            } else if (isClass(r)) value = `new ${tname}(${vals.join(", ")})`;
            else if (!v.fields.length) value = "self";
            else value = `{ ${v.fields.map((fl, i) => `${fieldName(fl)}: ${vals[i]}`).join(", ")} }`;
            st.push(`${indent}return ${wrap(value)};`);
            return st;
          };
          const lines: string[] = [];
          if (it.kind === "struct") lines.push(...construct(vs[0]!, "  "));
          else if (fieldless || vs.every((v) => v.style === "unit")) lines.push(`  return ${wrap("self")};`);
          else {
            lines.push("  switch (self.$) {");
            const units = vs.filter((v) => v.style === "unit");
            for (const v of vs.filter((v) => v.style !== "unit")) lines.push(`    case ${JSON.stringify(v.name)}: {`, ...construct(v, "      "), "    }");
            if (units.length) lines.push(...units.map((v) => `    case ${JSON.stringify(v.name)}:`), `      return ${wrap("self")};`);
            lines.push("  }");
          }
          const used = lines.some((l) => /\bself\b/.test(l));
          out.push(`// rustc-derive: ${at} ${deriveFold.get(r.key)} for ${it.name} (${kind === "fold" ? "fold_with" : "try_fold_with"})`);
          out.push(
            `export function ${TF_PREFIX[kind]}_${it.name}${kind === "fold" && !ps.length ? "" : `<${[...ps, ...(kind === "fold" ? [] : ["E"])].join(", ")}>`}(${used ? "self" : "_self"}: ${self}, __folder: ${folder}${kind === "fold" ? "" : "<E>"}${ps.map((p) => `, ${TF_PREFIX[kind]}_${p}: ${ffn}<${p}>`).join("")}): ${ret} {`,
          );
          out.push(...lines, "}");
          fileTypeFold++;
        }
      }
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
    /** emitted after every item of the file (data that reads companions of later items at module init) */
    const trailer: string[] = [];

    // ---- derive(PrintAttribute) (rustc_macros/src/print_attribute.rs) ----
    /** The `PrintAttribute<T>` table expression of a type. */
    const paFn = (ty: PType, sc: Scope, at: string): string => {
      const paImp = (n: string) => {
        imp(`src:${paModule}`, "values", n, n);
        return n;
      };
      switch (ty.kind) {
        case "ref":
          return `${paImp("print_attribute_ref")}(${paFn(ty.elem!, sc, at)})`;
        case "tuple":
          if (ty.elems!.length === 0) return paImp("print_attribute_unit");
          if (ty.elems!.length > 8) break;
          return `${paImp("print_attribute_tuple")}([${ty.elems!.map((e) => paFn(e, sc, at)).join(", ")}])`;
        case "path": {
          if (ty.qself) break;
          const r = resolvePath(ty.path!, sc);
          const args = argsOf(r, ty.path!);
          if (r.k === "param") {
            const sub = sc.subst?.get(r.name);
            if (sub) return paFn(sub.ty, sub.scope, at);
            report.errors.push(`${at}: derive(PrintAttribute) over a type parameter is not supported`);
            return "unported_print_attribute";
          }
          if (r.k === "item") {
            if (r.ref.item.kind === "type") return paFn(r.ref.item.ty!, aliasScope(r.ref, args, sc), at);
            if (!hasDerive(r.ref, "PrintAttribute")) break;
            const n = `print_attribute_${r.ref.item.name}`;
            const alias = r.ref.mf === mf ? localName(r.ref, n) : `print_attribute_${refName(r.ref)}`;
            if (r.ref.mf !== mf) imp(viaHand(r.ref), "values", n, alias);
            return alias;
          }
          const e = r.keys.map((k) => paIndex.get(k)).find((x) => x !== undefined);
          if (!e) break;
          for (const v of e.values) paImp(v);
          let out = e.print;
          for (const n of new Set(e.print.match(/\$p\d/g) ?? [])) {
            const a = args[Number(n.slice(2))];
            if (!a) {
              report.errors.push(`${at}: PrintAttribute of ${r.display} needs type argument ${n.slice(2)}`);
              return "unported_print_attribute";
            }
            out = out.replaceAll(n, paFn(a, sc, at));
          }
          return out;
        }
      }
      report.errors.push(`${at}: no PrintAttribute impl for field type \`${ty.text}\` (print_attribute.json)`);
      return "unported_print_attribute";
    };
    /** `print_fields` of print_attribute.rs: the statements printing `name` and `fields` read from `owner`. */
    const paFields = (name: string, fs: PFields, owner: string, sc: Scope, at: string): string[] => {
      const live = liveFields(fs, mf.file.path);
      const out: string[] = [];
      if (fs.style === "unit") return [`__p.word(${JSON.stringify(name)});`];
      const vals = live.map((fl) => ({ fl, v: `${owner}.${fieldName(fl)}`, pa: paFn(fl.ty, sc, at) }));
      const disps: string[] = ["let __printed_anything = false;"];
      for (const { fl, v, pa } of vals) {
        disps.push(`if (${pa}.should_render(${v})) {`);
        disps.push("  if (__printed_anything) {");
        disps.push('    __p.word_space(",");');
        disps.push("  }");
        if (fs.style === "named") {
          disps.push(`  __p.word(${JSON.stringify(unraw(fl.name!))});`);
          disps.push('  __p.word(":");');
          disps.push("  __p.nbsp();");
        }
        disps.push("  __printed_anything = true;");
        disps.push("}");
        disps.push(`${pa}.print_attribute(${v}, __p);`);
      }
      out.push(`__p.word(${JSON.stringify(name)});`);
      out.push(`if (true${vals.map(({ v, pa }) => ` && !${pa}.should_render(${v})`).join("")}) {`);
      out.push("  return;");
      out.push("}");
      if (fs.style === "named") {
        out.push("__p.nbsp();");
        out.push('__p.word("{");');
        out.push(...disps);
        out.push('__p.word("}");');
      } else {
        out.push("__p.popen();");
        out.push(...disps);
        out.push("__p.pclose();");
      }
      return out;
    };
    let filePrint = 0;
    const emitPrint = (r: ItemRef, sc: Scope, selfType: string) => {
      const it = r.item;
      const at = `${mf.file.path}:${it.line}`;
      if (!hasDerive(r, "PrintAttribute")) return;
      if (tsParams(it).length) {
        report.errors.push(`${at}: derive(PrintAttribute) on a generic type is not supported`);
        return;
      }
      imp(`src:${paModule}`, "types", "PrintAttribute", "PrintAttribute");
      imp("src:rustc_ast_pretty/pp.ts", "types", "Printer", "Printer");
      const stmts: string[] = [];
      if (it.kind === "struct") stmts.push(...paFields(it.name, it.fields!, "self", sc, at));
      else if (it.kind === "enum") {
        stmts.push("switch (self.$) {");
        for (const v of it.variants!.filter((v) => enabled(v.attrs, `${mf.file.path}:${v.line}`))) {
          const vn = unraw(v.name);
          stmts.push(`  case ${JSON.stringify(vn)}: {`);
          stmts.push(...paFields(vn, v.fields, "self", sc, `${mf.file.path}:${v.line}`).map((l) => `    ${l}`));
          stmts.push("    break;");
          stmts.push("  }");
        }
        stmts.push("}");
      } else {
        report.errors.push(`${at}: can't derive PrintAttribute on unions`);
        return;
      }
      // a fieldless enum is a string union: `self.$` is the string itself
      const fieldless = it.kind === "enum" && it.variants!.every((v) => v.fields.style === "unit");
      const code = fieldless ? stmts.map((l) => l.replace("switch (self.$)", "switch (self)")) : stmts;
      const usesSelf = code.some((l) => /\bself\b/.test(l));
      body.push(`// rustc-derive: ${at} PrintAttribute for ${it.name}`);
      body.push(`export const print_attribute_${it.name}: PrintAttribute<${selfType}> = {`);
      body.push("  should_render: (_self) => true,");
      body.push(`  print_attribute: (${usesSelf ? "self" : "_self"}, __p) => {`);
      body.push(...code.map((l) => `    ${l}`));
      body.push("  },");
      body.push("};");
      filePrint++;
    };

    // ---- `language_item_table!` rows (rustc_attr_ir/src/lang_items.rs) ----
    /** A Rust constant expression of a table row (`sym::x`, `Enum::Variant`, `Enum::V(..)`, `Enum::V { f: .. }`, ints, bools) as TS. */
    const rustConstExpr = (expr: string, sc: Scope, at: string): string => {
      const toks = expr.match(/r#\w+|\w+|::|[(){},:]/g) ?? [];
      if (toks.join("") !== expr.replace(/\s+/g, "")) {
        report.errors.push(`${at}: unsupported constant expression \`${expr}\``);
        return "unported_const_expr";
      }
      let p = 0;
      const fail = (): string => {
        report.errors.push(`${at}: unsupported constant expression \`${expr}\``);
        p = toks.length;
        return "unported_const_expr";
      };
      const prim = (): string => {
        const t = toks[p];
        if (t === undefined) return fail();
        if (/^\d+$/.test(t) || t === "true" || t === "false") {
          p++;
          return t;
        }
        const segs = [unraw(toks[p++]!)];
        while (toks[p] === "::") {
          p++;
          segs.push(unraw(toks[p++] ?? ""));
        }
        if (segs.length !== 2) return fail();
        const [ty, v] = segs as [string, string];
        if (ty === "sym" || ty === "kw") {
          imp("src:rustc_span/symbol.ts", "values", ty, ty);
          return `${ty}.${v}`;
        }
        // the enum's companion const (imported only where a unit variant reads it)
        const r = resolvePath({ global: false, segments: [{ name: ty, args: [] }] }, sc);
        let owner: (() => string) | undefined;
        if (r.k === "item" && r.ref.item.kind === "enum") {
          const ref = r.ref;
          owner = () => {
            const a = refName(ref);
            if (ref.mf !== mf) imp(viaHand(ref), "values", ref.item.name, a);
            return a;
          };
        } else if (r.k === "ext") {
          const e = tmLookup(r.keys);
          if (e?.import && e.values?.includes(ty)) {
            const m = e.import.replace(/^src\//, "");
            owner = () => {
              imp(`src:${m}`, "values", ty, ty);
              return ty;
            };
          }
        }
        if (owner === undefined) return fail();
        if (toks[p] === "(") {
          p++;
          const args: string[] = [];
          while (p < toks.length && toks[p] !== ")") {
            args.push(prim());
            if (toks[p] === ",") p++;
          }
          p++;
          return `{ $: ${JSON.stringify(v)}${args.map((a, i) => `, _${i}: ${a}`).join("")} }`;
        }
        if (toks[p] === "{") {
          p++;
          const fs: string[] = [];
          while (p < toks.length && toks[p] !== "}") {
            const f = unraw(toks[p++]!);
            if (toks[p++] !== ":") return fail();
            fs.push(`${f}: ${prim()}`);
            if (toks[p] === ",") p++;
          }
          p++;
          return `{ $: ${JSON.stringify(v)}${fs.map((f) => `, ${f}`).join("")} }`;
        }
        return `${owner()}.${v}`;
      };
      const out = prim();
      if (p !== toks.length) return fail();
      return out;
    };
    const pathTy = (text: string): PType => ({ kind: "path", text, path: { global: false, segments: text.split("::").map((name) => ({ name, args: [] })) } });
    const emitLangItemTable = (r: ItemRef, rows: LangItemRow[], at: string) => {
      const sc: Scope = { mf, mod: mf.mod, params: new Set() };
      const tSym = tsType(pathTy("Symbol"), sc, at);
      const tTarget = tsType(pathTy("Target"), sc, at);
      const tGen = tsType(pathTy("GenericRequirement"), sc, at);
      const tDefId = tsType(pathTy("DefId"), sc, at);
      const name = r.item.name;
      trailer.push("");
      trailer.push(`// rustc-macro: ${at} language_item_table! rows`);
      trailer.push(`// PORT: the rows of \`language_item_table!\` as data. The fns the macro generates (\`${name}::{from_u32, name,`);
      trailer.push(`// from_name, variant_name, target, required_generics}\` and the \`LanguageItems\` getters) are ported in`);
      trailer.push(`// ${mf.hand.split("/").pop()} over this table.`);
      trailer.push("export interface LanguageItemTableRow {");
      trailer.push(`  variant: ${name};`);
      trailer.push("  /** `$module::$name` */");
      trailer.push(`  name: ${tSym};`);
      trailer.push("  /** the `LanguageItems` getter */");
      trailer.push("  method: string;");
      trailer.push(`  target: ${tTarget};`);
      trailer.push(`  generics: ${tGen};`);
      trailer.push("}");
      trailer.push("export const language_item_table: readonly LanguageItemTableRow[] = [");
      for (const row of rows) {
        const rat = at;
        trailer.push(
          `  { variant: ${JSON.stringify(row.variant)}, name: ${rustConstExpr(row.name, sc, rat)}, method: ${JSON.stringify(row.method)}, target: ${rustConstExpr(row.target, sc, rat)}, generics: ${rustConstExpr(row.generics, sc, rat)} },`,
        );
      }
      trailer.push("];");
      trailer.push("/** The `LanguageItems` getters `language_item_table!` generates (installed on the class by the hand module). */");
      trailer.push("export interface LanguageItemsGetters {");
      for (const row of rows) {
        trailer.push(`  /** Returns the [\`DefId\`] of the \`${row.name.split("::").pop()}\` lang item if it is defined. */`);
        trailer.push(`  ${row.method}(): ${tDefId} | undefined;`);
      }
      trailer.push("}");
    };

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
        // a local type alias (`type Res = def::Res<NodeId>;`): the impl of the aliased type
        if (r.ref.item.kind === "type" && r.ref.item.ty) return diagArgOf(r.ref.item.ty, itemScope(r.ref), at, which);
        return undefined;
      }
      if (r.k !== "ext") return undefined;
      for (const k of r.keys) for (const e of daIndex.get(k) ?? []) {
        if (e[which] === undefined) continue;
        if (e.paths.some((p) => set.diag_args_skip?.includes(p))) continue;
        // impls for one instantiation only (`impl IntoDiagArg for Vec<char>`)
        if (e.arg0 !== undefined && t.path!.segments.at(-1)!.args.find((a) => a.kind === "type")?.ty?.text !== e.arg0) continue;
        let expr = e[which]!;
        if (expr.includes("$display0")) {
          // generic impls over `S: Display` (`DiagSymbolList<S>`): `$display0` = the first type argument's Display
          // as a function (`default_args` when the argument is omitted).
          const a0 = t.path!.segments.at(-1)!.args.find((a) => a.kind === "type")?.ty ?? e.default_args?.[0];
          const d = a0 === undefined ? undefined : diagArgOf(a0, sc, at, "display");
          if (d === undefined) return undefined;
          const m = /^([\w.]+)\(\$v\)$/.exec(d);
          expr = expr.replaceAll("$display0", m ? m[1]! : `(x) => ${d.replaceAll("$v", "x")}`);
        }
        for (const [m, names] of Object.entries(e.imports ?? {})) for (const n of names) imp(`src:${m.replace(/^src\//, "")}`, "values", n, n);
        return expr;
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
            if (r.ref.mf === mf) return { add_to_diag: localName(r.ref, names.add_to_diag), subdiagnostic: localName(r.ref, names.subdiagnostic) };
            for (const v of Object.values(names)) imp(viaHand(r.ref), "values", v, v);
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
        if (r?.k === "ext") {
          const e = tmLookup(r.keys);
          if (e?.subdiagnostic && e.import) {
            for (const v of Object.values(e.subdiagnostic)) imp(`src:${e.import.replace(/^src\//, "")}`, "values", v, v);
            return e.subdiagnostic;
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
    const itemList = walk || sh || set.derive_only ? [] : [...items.values()].filter((r) => r.mf === mf).sort((a, b) => a.item.line - b.item.line);
    for (const r of itemList) {
      const it = r.item;
      const at = `${mf.file.path}:${it.line}`;
      if (it.kind === "trait") continue;
      if (matches(set.skip, r)) {
        report.notes.push(`${r.key}: skipped by config`);
        continue;
      }
      if (handInline(r)) {
        report.notes.push(`${r.key}: hand type inside inline module ${r.mod.join("::")}; defined (with its Debug/Clone) in ${mf.hand}`);
        imp(`src:${mf.hand}`, "types", it.name, it.name);
        continue;
      }
      const rel = relMod(r);
      if (rel.join("::") !== curRel.join("::")) {
        let i = 0;
        while (i < rel.length && i < curRel.length && rel[i] === curRel[i]) i++;
        for (let k = curRel.length; k > i; k--) body.push("}");
        for (const m of rel.slice(i)) body.push("", `export namespace ${m} {`);
        curRel = rel;
      }
      if (rel.length) report.notes.push(`${r.key}: inside inline module ${r.mod.join("::")}; emitted into ${mf.gen} as namespace ${rel.join(".")}`);
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
        body.push(...serLines(r));
        continue;
      }
      if (r.mac?.kind === "bitflags") {
        // bitflags-2.10.0 `bitflags!`: a branded number; the flags and the `Flags` API on the companion
        const def = r.mac.def;
        const width = { u8: 8, u16: 16, u32: 32 }[def.bits];
        const known = new Map<string, bigint>();
        const flags: [string, string, string[]][] = [];
        if (width === undefined) report.errors.push(`${r.mac.at}: bitflags over ${def.bits} not supported (number-backed flags are at most u32)`);
        else {
          // Rust consts may name flags declared later (rustc_type_ir `TypeFlags::STILL_FURTHER_SPECIALIZABLE` reads
          // `HAS_TY_FRESH`): evaluate until no flag is added, then emit in declaration order.
          const vals = new Map<(typeof def.flags)[number], bigint>();
          const failed = new Map<(typeof def.flags)[number], Error>();
          for (let progress = true; progress; ) {
            progress = false;
            for (const c of def.flags) {
              if (vals.has(c)) continue;
              try {
                const v = evalFlagExpr(c.expr, known, width);
                known.set(c.name, v);
                vals.set(c, v);
                failed.delete(c);
                progress = true;
              } catch (e) {
                failed.set(c, e as Error);
              }
            }
          }
          for (const c of def.flags) {
            const v = vals.get(c);
            if (v === undefined) report.errors.push(`${r.mac.at}: ${failed.get(c)!.message}`);
            else flags.push([c.name === "_" ? "" : c.name, `0x${v.toString(16)}`, c.docs]);
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
        if (def.form === "struct" && def.attrs.some((a) => /^derive\s*\(.*\bDebug\b/s.test(a.name))) {
          if (set.bitflags_debug) {
            // bitflags-2.10.0 internal.rs: `struct X(<X as PublicFlags>::Internal)` derives Debug over the internal
            // flags, whose Debug writes `{:#x}` of the empty bits (`0x0`) or else `parser::to_writer` (`A | B | 0x..`).
            imp("src:vendor/bitflags/parser.ts", "values", "to_writer", "to_writer");
            body.push(`export const debug_${name}: Debug<${name}> = (v, f) => debug_tuple(f, ${JSON.stringify(name)}, [${name}.is_empty(v) ? "0x0" : to_writer(${name}.FLAGS_DESC, v)]);`);
            fileDebug++;
          } else report.notes.push(`${r.key}: derive(Debug) inside bitflags! is not generated yet`);
        }
        if (hasDebug && def.form === "impl") {
          // `#[derive(Debug)] struct X(uN);` + `bitflags! { impl X: uN { .. } }`: the derive sees a plain
          // tuple struct, so its Debug is `X(<bits>)` (e.g. rustc_hir::def::MacroKinds).
          body.push(`export const debug_${name}: Debug<${name}> = (v, f) => debug_tuple(f, ${JSON.stringify(name)}, [debug_int(v, f)]);`);
          fileDebug++;
        } else if (hasDebug && !(set.bitflags_debug && def.form === "struct")) report.errors.push(`${at}: derive(Debug) on a bitflags struct is not supported`);
        body.push(...serLines(r));
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
          // `#[derive_where(skip(Debug))]` fields are left out; a struct with one ends in `finish_non_exhaustive`
          const dl = live.filter((fl) => !deriveWhereSkips(fl.attrs, "Debug"));
          if (fs.style === "named" && dl.length < live.length)
            expr = `debug_struct_non_exhaustive(f, "${name}", [${dl.length ? `\n${dl.map((fl) => `    ["${fieldName(fl)}", ${dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)}],`).join("\n")}\n  ` : ""}])`;
          else if (fs.style === "named" && dl.length)
            expr = `debug_struct(f, "${name}", [\n${dl.map((fl) => `    ["${fieldName(fl)}", ${dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)}],`).join("\n")}\n  ])`;
          else if (fs.style === "unnamed" && dl.length)
            expr = `debug_tuple(f, "${name}", [${dl.map((fl) => dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)).join(", ")}])`;
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
        if (set.derive_default && hasDerive(r, "Default") && it.kind === "struct" && !matches(set.hand, r)) {
          if (gparams.length) report.errors.push(`${at}: derive(Default) on a generic type is not supported`);
          body.push(`export function default_${name}(): ${name} {`);
          const vals = live.map((fl) => defExpr(fl.ty, sc, `${mf.file.path}:${fl.line}`));
          if (isClass(r)) body.push(`  return new ${name}(${vals.join(", ")});`);
          else if (live.length) body.push(`  return {\n${live.map((fl, i) => `    ${fieldName(fl)}: ${vals[i]},`).join("\n")}\n  };`);
          else body.push("  return {};");
          body.push("}");
        }
        body.push(...serLines(r));
        body.push(...tfLines(r));
        emitDiag(r, sc, selfType, "struct");
        emitPrint(r, sc, selfType);
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
        if (set.derive_default && hasDerive(r, "Default") && !matches(set.hand, r)) {
          const dv = variants.filter((v) => effAttrs(v.attrs, `${mf.file.path}:${v.line}`).some((a) => a.path === "default"));
          if (dv.length !== 1) report.errors.push(`${at}: derive(Default) needs exactly one #[default] variant`);
          else body.push(`export function default_${name}(): ${name} {\n  return ${JSON.stringify(unraw(dv[0]!.name))};\n}`);
        }
        body.push(...serLines(r));
        body.push(...tfLines(r));
        emitDiag(r, sc, selfType, "fieldless");
        emitPrint(r, sc, selfType);
        if (r.mac?.kind === "lang_items") emitLangItemTable(r, r.mac.rows, r.mac.at);
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
          const all = liveFields(v.fields, mf.file.path);
          // `#[derive_where(skip(Debug))]` fields are left out; a struct variant with one ends in `finish_non_exhaustive`
          const live = all.filter((fl) => !deriveWhereSkips(fl.attrs, "Debug"));
          if (v.fields.style === "named" && live.length < all.length) {
            cases.push(
              `    case "${vn}":\n      return debug_struct_non_exhaustive(f, "${vn}", [${live.length ? `\n${live.map((fl) => `        ["${fieldName(fl)}", ${dbg(fl.ty, `v.${fieldName(fl)}`, sc, at)}],`).join("\n")}\n      ` : ""}]);`,
            );
          } else if (v.fields.style === "named" && live.length) {
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
      if (set.derive_default && hasDerive(r, "Default") && !matches(set.hand, r)) {
        const dv = variants.filter((v) => effAttrs(v.attrs, `${mf.file.path}:${v.line}`).some((a) => a.path === "default"));
        if (dv.length !== 1 || dv[0]!.fields.style !== "unit") report.errors.push(`${at}: derive(Default) needs exactly one unit #[default] variant`);
        else body.push(`export function default_${name}(): ${name} {\n  return ${name}.${unraw(dv[0]!.name)};\n}`);
      }
      body.push(...serLines(r));
      body.push(...tfLines(r));
      emitDiag(r, sc, selfType, "data");
      emitPrint(r, sc, selfType);
    }
    for (; curRel.length; curRel = curRel.slice(0, -1)) body.push("}");
    if (walk) body.push("", ...walkBody(walk));
    if (sh) body.push(...shBody());
    if (ser) body.push(...serBody());
    body.push(...trailer);

    // helpers used by the body
    const text = body.join("\n");
    for (const [h, m] of helperModule) if (new RegExp(`\\b${h}\\b`).test(text)) imp(`src:${m.replace(/^src\//, "")}`, "values", h, h);
    if (/\bDebug<|\bFmt\b/.test(text)) {
      if (/\bDebug</.test(text)) imp("src:std/fmt.ts", "types", "Debug", "Debug");
      if (/\bFmt\b/.test(text)) imp("src:std/fmt.ts", "types", "Fmt", "Fmt");
    }
    const header = ser
      ? [
          `// GENERATED by tools/codegen/types.ts: #[derive(Decodable)] / #[derive(Encodable)] (compiler/rustc_macros/src/serialize.rs) of the ${mf.crate} types${opts.pin ? ` @ ${opts.pin}` : ""}. Do not edit.`,
          "// `decode_<T>(__decoder[, decode_<P>...])`: a struct decodes its fields in declaration order; an enum reads the variant",
          "// index (`read_u8`, or `read_usize` from 255 variants on), then that variant's fields. `encode_<T>` writes the same.",
          "// Only function declarations: hand modules may import from here inside an import cycle.",
        ]
      : sh
      ? [
          `// GENERATED by tools/codegen/types.ts: #[derive(StableHash)] / #[derive(StableHash_NoContext)] (compiler/rustc_macros/src/stable_hash.rs) of the ${mf.crate} types${opts.pin ? ` @ ${opts.pin}` : ""}. Do not edit.`,
          "// One `stable_hash_<T>(self, __hcx, __hasher[, stable_hash_<P>...])` per type: enums first hash `mem::discriminant(self)`",
          "// (the `isize` discriminant, or the `#[repr]` integer), then the fields of the variant / struct in declaration order,",
          "// skipping `#[stable_hash(ignore)]` and hashing `field.name` for `#[stable_hash(project(name))]`.",
          "// Only `export function` declarations: hand modules may import from here inside an import cycle.",
        ]
      : walk
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
    // A type name imported both from this crate (an item, e.g. a hand alias `type Res = def::Res<NodeId>`)
    // and from another crate (a type-map entry pulled in by a Debug/Clone of the alias' target): the
    // file's references mean the crate's own item; the other import is dropped.
    const ownCrate = `src:${mf.crate}/`;
    const ownTypes = new Set<string>();
    for (const [t, { types }] of imports) if (t.startsWith(ownCrate) || t.startsWith("gen:")) for (const a of types.values()) ownTypes.add(a);
    for (const t of sortedTargets) {
      const { types, values } = imports.get(t)!;
      if (t === `gen:${mf.gen}`) continue;
      if (!t.startsWith(ownCrate) && !t.startsWith("gen:")) for (const [n, a] of [...types]) if (ownTypes.has(a) && values.get(n) !== a) types.delete(n);
      const abs = t.startsWith("gen:") ? join(opts.out, t.slice(4)) : join(opts.srcRoot, t.slice(4));
      const spec = relImport(outFile, abs);
      const parts = [
        ...[...types].filter(([n, a]) => values.get(n) !== a).map(([n, a]) => `type ${n === a ? n : `${n} as ${a}`}`),
        ...[...values].map(([n, a]) => (n === a ? n : `${n} as ${a}`)),
      ].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));
      if (parts.length) importLines.push(`import { ${parts.join(", ")} } from "${spec}";`);
    }
    if (/\bunported_debug\(|\bunknown_debug\(|\bunported_discriminant\(|\bunported_clone\b|\bunported_into_diag_arg\b|\bunported_display\(|\bunported_print_attribute\b|\bunported_const_expr\b|\bunported_default\(|\bunported_stable_hash\b|\bunported_decodable\b|\bunported_encodable\b|\bunported_type_fold\b/.test(text)) {
      importLines.push(`import { unported } from "${relImport(outFile, join(opts.srcRoot, "std/panic.ts"))}";`);
      const extra: string[] = [];
      if (/\bunported_debug\(/.test(text)) extra.push(`const unported_debug = (_v: unknown): string => unported("Debug without a TS impl (see types report)");`);
      if (/\bunknown_debug\(/.test(text)) extra.push(`const unknown_debug = (_v: unknown): string => unported("Debug of an unknown type (see types report)");`);
      if (/\bunported_discriminant\(/.test(text)) extra.push(`const unported_discriminant = (e: string): number => unported(\`discriminant \${e}\`);`);
      if (/\bunported_clone\b/.test(text)) extra.push(`const unported_clone = <T>(_v: T): T => unported("Clone without a TS impl (see types report)");`);
      if (/\bunported_into_diag_arg\b/.test(text))
        extra.push(`const unported_into_diag_arg = (_v: unknown, _path: unknown): never => unported("IntoDiagArg without a TS impl (see types report)");`);
      if (/\bunported_display\(/.test(text)) extra.push(`const unported_display = (_v: unknown): string => unported("Display without a TS impl (see types report)");`);
      if (/\bunported_print_attribute\b/.test(text))
        extra.push(`const unported_print_attribute = { should_render: (_v: unknown): boolean => unported("PrintAttribute without a TS impl (see types report)"), print_attribute: (_v: unknown, _p: unknown): void => unported("PrintAttribute without a TS impl (see types report)") };`);
      if (/\bunported_default\(/.test(text)) extra.push(`const unported_default = (): never => unported("Default without a TS impl (see types report)");`);
      if (/\bunported_const_expr\b/.test(text)) extra.push(`const unported_const_expr: never = unported("constant expression the generator cannot translate (see types report)");`);
      if (/\bunported_stable_hash\b/.test(text))
        extra.push(`function unported_stable_hash(..._a: unknown[]): void {\n  unported("StableHash without a TS impl (see types report)");\n}`);
      if (/\bunported_decodable\b/.test(text))
        extra.push(`function unported_decodable(..._a: unknown[]): never {\n  return unported("Decodable without a TS impl (see types report)");\n}`);
      if (/\bunported_encodable\b/.test(text))
        extra.push(`function unported_encodable(..._a: unknown[]): void {\n  unported("Encodable without a TS impl (see types report)");\n}`);
      if (/\bunported_type_fold\b/.test(text))
        extra.push(`function unported_type_fold(..._a: unknown[]): never {\n  return unported("TypeVisitable/TypeFoldable without a TS impl (see types report)");\n}`);
      importLines.push(...extra);
    }
    if (fileTypes === 0 && !walk && !sh && !ser) {
      report.notes.push(`${mf.file.path}: no types; ${mf.gen} not written`);
      continue;
    }
    files.set(outFile, [...header, ...importLines, text, ""].join("\n"));
    report.files.push({
      upstream: ser ? `derive(Decodable/Encodable) of ${mf.crate}` : sh ? `derive(StableHash) of ${mf.crate}` : walk ? `derive(Walkable) of ${mf.crate}` : mf.file.path,
      out: mf.gen,
      types: fileTypes,
      debug_fns: fileDebug,
      clone_fns: fileClone,
      walkable: fileWalk,
      diag_impls: fileDiag,
      print_attrs: filePrint,
      stable_hash: fileStableHash,
      decodable: fileDecodable,
      encodable: fileEncodable,
      type_fold: fileTypeFold,
    });
  }
  return { files, report, stubs };

  function itemScope(r: ItemRef): Scope {
    return { mf: r.mf, mod: r.mod, params: new Set(tsParams(r.item).map((p) => p.name)), self: r };
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
  const probe: ProbeJson = jsonIn ? JSON.parse(readFileSync(jsonIn, "utf8")) : await runProbe([...set.files, ...(set.resolve_files ?? [])]);
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
  const nSh = r.files.reduce((a, f) => a + f.stable_hash, 0);
  const nPrint = r.files.reduce((a, f) => a + f.print_attrs, 0);
  const nDec = r.files.reduce((a, f) => a + f.decodable, 0);
  const nEnc = r.files.reduce((a, f) => a + f.encodable, 0);
  const nTf = r.files.reduce((a, f) => a + f.type_fold, 0);
  console.log(
    `${setName}: ${r.files.length} files, ${nTypes} types, ${nDebug} debug fns, ${nClone} clone fns, ${nWalk} walkable impls, ${nDiag} diagnostic derives, ${nPrint} PrintAttribute derives, ${nSh} stable_hash impls, ${nDec}/${nEnc} decodable/encodable impls${nTf ? `, ${nTf} TypeVisitable/TypeFoldable impls` : ""} -> ${out}`,
  );
  console.log(
    `unknown types: ${Object.keys(r.unknown_types).length}, missing debug: ${Object.keys(r.missing_debug).length}, manual Debug impls: ${r.manual_debug.length}, missing clone: ${Object.keys(r.missing_clone).length}, manual Clone impls: ${r.manual_clone.length}, unknown cfg: ${Object.keys(r.unknown_cfg).length}, macro types: ${r.macro_types.length}, missing IntoDiagArg/Display: ${Object.keys(r.missing_diag_arg).length}, missing StableHash: ${Object.keys(r.missing_stable_hash).length}, missing Decodable/Encodable: ${Object.keys(r.missing_decodable).length}/${Object.keys(r.missing_encodable).length}${Object.keys(r.missing_type_fold).length ? `, missing TypeVisitable/TypeFoldable: ${Object.keys(r.missing_type_fold).length}` : ""}`,
  );
  console.log(`report: ${rp}`);
  if (stubs) console.log(`stubs: ${writeStubs(res, opts)} modules under ${srcRoot}`);
  if (r.errors.length) {
    for (const e of r.errors.slice(0, 5)) console.log(`ERROR: ${e}`);
    process.exit(1);
  }
}
