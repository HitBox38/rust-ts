// rustfmt's generated code (plan-m8 D4, D5, D6; lane codegen-fmt-serde), under src/rustfmt/:
//   config/{options,lists,file_lines,macro_names}.gen.ts, emitter/json.gen.ts
//       the types of those files (tools/codegen/types.ts, set in tools/codegen/rustfmt.json) with, through types.ts's hooks:
//       - `#[config_type]` (rustfmt's config_proc_macro, tools/codegen/config_type.ts): the enum as the macro emits it, and
//         `display_X`, `config_type_X`, `X.from_str`, `serialize_X`, `deserialize_X`;
//       - `#[derive(Serialize)]` / `#[derive(Deserialize)]` (serde_derive 1.0.228, tools/codegen/serde.ts):
//         `serialize_X` / `deserialize_X`;
//   config/create_config.gen.ts
//       `create_config!` (config/config_type.rs) as invoked by config/mod.rs, with the option types and defaults of
//       `config_option_with_style_edition_default!` (config/options.rs) / `style_edition_default!` (config/style_edition.rs)
//       (tools/codegen/create_config.ts);
//   contract.gen.d.ts
//       ambient `declare module` blocks for every module the generated code imports that does not exist yet under src/ (the
//       serde surface of vendor-serde-de, the hand modules of the rustfmt-contract lanes): TypeScript consults them only while
//       the real module is missing, so the generated code type-checks now and checks the real modules once they land. Each
//       block lists exactly the names the generated code needs.
//
//   bun tools/codegen/rustfmt.ts            write the files
//   bun tools/codegen/rustfmt.ts --check    ERROR if a committed file is stale
//   [--json <probe.json>] [--save-json <f>] the typedefs probe's JSON (default: run tools/probes/typedefs on the files)
//
// tools/codegen/rustfmt.test.ts checks the outputs against the committed files (golden) and the Rust renderings of every serde
// derive, `#[config_type]` and `create_config!` against the oracle's `-Zunpretty=expanded` (tools/codegen/rustfmt_oracle.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as CT from "./config_type.ts";
import { type CreateConfigInput, createConfigTs, readCreateConfig } from "./create_config.ts";
import * as SD from "./serde.ts";
import { generate, type GenResult, type ItemHookCtx, type ItemHooks, loadTypeMap, type PItem, type ProbeJson, REPO, type SetConfig, type PType } from "./types.ts";

const HERE = import.meta.dir;
export const CONFIG: { set: SetConfig; config_type_module: string } = JSON.parse(readFileSync(join(HERE, "rustfmt.json"), "utf8"));
export const CONTRACT = "rustfmt/contract.gen.d.ts";
export const AUGMENT = "rustfmt/contract_augment.gen.d.ts";

/** Manual `impl Serialize` / `impl Deserialize` of the set's types (hand-ported; the generated code imports their fns). */
export function manualSerdeImpls(probe: ProbeJson): Map<string, Set<"Serialize" | "Deserialize">> {
  const out = new Map<string, Set<"Serialize" | "Deserialize">>();
  for (const f of probe.files)
    for (const im of f.impls) {
      const tr = im.trait?.split("::").pop()?.trim();
      if ((tr !== "Serialize" && tr !== "Deserialize") || !im.self_name) continue;
      if (!out.has(im.self_name)) out.set(im.self_name, new Set());
      out.get(im.self_name)!.add(tr);
    }
  return out;
}

/** The probe with every top-level `#[config_type]` enum rewritten to what config_proc_macro emits, and the plans by item name. */
export function applyConfigType(probe: ProbeJson, err: (m: string) => void): { probe: ProbeJson; plans: Map<string, CT.ConfigTypePlan> } {
  const plans = new Map<string, CT.ConfigTypePlan>();
  const files = probe.files.map((f) => ({
    ...f,
    items: f.items.map((it): PItem => {
      if (!it.attrs.some(CT.isConfigTypeAttr)) return it;
      const at = `${f.path}:${it.line}`;
      if (it.module.length) {
        err(`${at}: #[config_type] inside an inline module is not implemented`);
        return it;
      }
      const p = CT.configTypePlan(it, at, err);
      if (!p) return it;
      plans.set(it.name, p);
      return CT.configTypeItem(it);
    }),
  }));
  return { probe: { files }, plans };
}

export interface RustfmtGen {
  files: Map<string, string>;
  errors: string[];
  report: GenResult["report"];
  /** the serde plans by `trait type` (for the oracle comparison) */
  serdePlans: Map<string, SD.SerdePlan>;
  configTypePlans: Map<string, CT.ConfigTypePlan>;
  createConfig?: CreateConfigInput;
}

/**
 * The serde fn (`deserialize_*` / `serialize_*`) of a field type, as seen from the item of `c` (serde_derive's `<T as
 * Deserialize>::deserialize` / `Serialize::serialize`): a generated impl of an item of the set, a manual impl (hand module), or
 * serde_core's impls of std types.
 */
export function serdeFn(
  c: Pick<ItemHookCtx, "resolveType" | "itemFn" | "error">,
  use: (m: SD.SerdeModule, n: string) => string,
  derived: (name: string, tr: "Serialize" | "Deserialize") => boolean,
  manual: Map<string, Set<"Serialize" | "Deserialize">>,
  ty: PType,
  kind: "de" | "ser",
  at: string,
  tsType: (ty: PType) => string,
): string {
  const tr = kind === "de" ? "Deserialize" : "Serialize";
  const pre = kind === "de" ? "deserialize" : "serialize";
  const mod: SD.SerdeModule = kind === "de" ? "de_impls" : "ser_impls";
  // generic impls get explicit type arguments: TS cannot infer them from a generic function argument
  if (ty.kind === "tuple" && ty.elems!.length === 2)
    return `${use(mod, `${pre}_tuple2`)}<${ty.elems!.map(tsType).join(", ")}>(${ty.elems!.map((e) => serdeFn(c, use, derived, manual, e, kind, at, tsType)).join(", ")})`;
  if (ty.kind === "path") {
    const r = c.resolveType(ty);
    if (r.k === "item") {
      if (derived(r.name, tr)) return c.itemFn(r.key, `${pre}_${r.name}`, true);
      if (manual.get(r.name)?.has(tr)) return c.itemFn(r.key, `${pre}_${r.name}`, false);
      c.error(`${at}: no ${tr} impl for ${r.key}`);
      return `unported_${pre}`;
    }
    if (r.k === "ext") {
      const seg = ty.path!.segments[ty.path!.segments.length - 1]!;
      const std = SD.SERDE_STD_IMPLS[seg.name];
      if (std && r.keys.some((k) => k === seg.name || /^(std|alloc|core)::/.test(k))) {
        const fn = use(mod, kind === "de" ? std.de : std.ser);
        if (!std.generic) return fn;
        const args = seg.args.filter((a) => a.kind === "type").map((a) => a.ty!);
        if (args.length !== std.generic) c.error(`${at}: ${seg.name} needs ${std.generic} type argument(s)`);
        return `${fn}<${args.map(tsType).join(", ")}>(${args.map((a) => serdeFn(c, use, derived, manual, a, kind, at, tsType)).join(", ")})`;
      }
    }
  }
  c.error(`${at}: no ${tr} impl for ${ty.text} in tools/codegen/serde.ts SERDE_STD_IMPLS`);
  return `unported_${pre}`;
}

export function generateRustfmt(probeIn: ProbeJson, opts: { out: string; srcRoot: string; pin?: string; upstream?: string }): RustfmtGen {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  const { probe, plans } = applyConfigType(probeIn, err);
  const manual = manualSerdeImpls(probe);
  const serdePlans = new Map<string, SD.SerdePlan>();
  const itemsByName = new Map<string, PItem>();
  const itemFile = new Map<string, string>();
  for (const f of probe.files)
    for (const it of f.items)
      if (!it.module.length) {
        itemsByName.set(it.name, it);
        itemFile.set(it.name, f.path);
      }
  const derived = (name: string, tr: "Serialize" | "Deserialize") => plans.has(name) || (itemsByName.has(name) && SD.serdeDerivesOf(itemsByName.get(name)!).includes(tr));
  const hooks: ItemHooks = {
    itemLines: (c) => {
      const out: string[] = [];
      const ct = plans.get(c.item.name);
      if (ct) out.push(...CT.renderTs(ct, ctCtx(c)));
      const sps = SD.serdePlans(c.item, c.at, c.error, (f) => c.fieldName(f));
      for (const p of sps) {
        serdePlans.set(`${p.trait} ${p.ty}`, p);
        out.push(...SD.renderTs(p, serdeCtx(c)));
      }
      return out;
    },
    companionMembers: (c) => {
      const ct = plans.get(c.item.name);
      return ct ? CT.companionMembers(ct, ctCtx(c)) : [];
    },
    fileTrailer: (_file, body) => fileHelpers(body),
  };
  const ctCtx = (c: ItemHookCtx): CT.ConfigTypeTsCtx => ({
    use: (m, n, k) => c.use(m, n, k),
    serde: (m, n, k) => c.use(SD.SERDE_MODULES[m], n, k),
    configTypeModule: CONFIG.config_type_module,
    at: c.at,
    error: c.error,
  });
  const serdeCtx = (c: ItemHookCtx): SD.SerdeTsCtx => {
    const use = (m: SD.SerdeModule, n: string, k: "types" | "values" = "values") => c.use(SD.SERDE_MODULES[m], n, k);
    const fields = c.item.fields?.fields ?? [];
    return {
      use,
      result: (n) => c.use("std/result.ts", n, n === "Result" ? "types" : "values"),
      deFn: (ty, at) => serdeFn(c, use, derived, manual, ty, "de", at, (t) => c.tsType(t, at)),
      serFn: (ty, at) => serdeFn(c, use, derived, manual, ty, "ser", at, (t) => c.tsType(t, at)),
      tsType: (ty, at) => c.tsType(ty, at),
      self: c.name,
      construct: (vals) =>
        c.isClass ? `new ${c.name}(${vals.join(", ")})` : `{ ${fields.map((f, i) => `${c.fieldName(f)}: ${vals[i]}`).join(", ")} }`,
      read: (v, f) => `${v}.${f.ts}`,
      at: c.at,
    };
  };
  const res = generate(probe, CONFIG.set, loadTypeMap(), { set: "rustfmt", out: opts.out, srcRoot: opts.srcRoot, pin: opts.pin, upstream: opts.upstream, hooks });
  errors.push(...res.report.errors);
  const files = new Map(res.files);
  // create_config! (config/mod.rs) with the style-edition defaults of config/options.rs
  let cc: CreateConfigInput | undefined;
  if (opts.upstream) {
    try {
      cc = readCreateConfig(opts.upstream);
    } catch (e) {
      err(`create_config!: ${(e as Error).message}`);
    }
  }
  if (cc) {
    const r = createConfigTs(cc, { plans, manual, itemsByName, itemFile, pin: opts.pin, serdePlans, err });
    const helpers = fileHelpers(r);
    files.set(join(opts.out, "rustfmt/config/create_config.gen.ts"), helpers.length ? `${r}\n${helpers.join("\n")}\n` : r);
  } else if (!opts.upstream) err("create_config!: no upstream checkout given");
  canonicalizeImports(files, opts.out, opts.srcRoot, err);
  files.set(join(opts.out, CONTRACT), contractText(files, opts.out, opts.srcRoot, opts.pin, err));
  files.set(join(opts.out, AUGMENT), augmentText(opts.srcRoot, opts.pin));
  return { files, errors, report: res.report, serdePlans, configTypePlans: plans, createConfig: cc };
}

/** The module-local helpers a generated file's body uses. */
export function fileHelpers(body: string): string[] {
  const out: string[] = [];
  if (/\b__bytes_eq\(/.test(body)) out.push(...SD.BYTES_EQ_HELPER);
  if (/\b__eq_ignore_ascii_case\(/.test(body)) out.push(...CT.EQ_IGNORE_ASCII_CASE_HELPER);
  return out;
}

// ---- the contract of not-yet-ported modules -------------------------------------------------------

// The declarations below name other modules as `import("@/<src-relative path>")`; `contractText` resolves each to the module's
// real path from src/rustfmt/ if it exists, else to its canonical specifier (the block that declares it).
const RES = 'type Result<T, E> = import("@/std/result.ts").Result<T, E>;';
const SER = 'type Serializer<O, E> = import("@/vendor/serde_core/ser/mod.ts").Serializer<O, E>;';
const DES = 'type Deserializer<E> = import("@/vendor/serde_core/de/mod.ts").Deserializer<E>;';
const G = (file: string, name: string) => `import("@/rustfmt/config/${file}.gen.ts").${name}`;
const fnDecls = (ty: string, tyRef: string, err: string | undefined, manualSerde: boolean, extra: Record<string, string> = {}): Record<string, string> => ({
  [`display_${ty}`]: `export function display_${ty}(self: ${tyRef}): string;`,
  [`${ty}_eq`]: `export function ${ty}_eq(self: ${tyRef}, other: ${tyRef}): boolean;`,
  ...(err ? { [`debug_${err}`]: `export const debug_${err}: import("@/std/fmt.ts").Debug<${err}>;` } : {}),
  ...(manualSerde
    ? {
        [`serialize_${ty}`]: `export function serialize_${ty}<O, E>(self: ${tyRef}, serializer: Serializer<O, E>): Result<O, E>;`,
        [`deserialize_${ty}`]: `export function deserialize_${ty}<E>(deserializer: Deserializer<E>): Result<${tyRef}, E>;`,
      }
    : {}),
  ...extra,
});

/**
 * The hand modules' names the generated code imports, by src-relative module: what the upstream item is in the port's conventions
 * (PORTING §5, §8). `prelude` lines open the module's block. The rustfmt-contract lanes implement them.
 */
export const HAND_DECLS: Record<string, { prelude: string[]; decls: Record<string, string> }> = {
  "rustfmt/config/config_type.ts": {
    prelude: [],
    decls: {
      ConfigType: [
        "// `pub(crate) trait ConfigType: Sized` (config/config_type.rs:6), as a table per type (PORTING §5 \"Traits\")",
        "export interface ConfigType<T> {",
        "  doc_hint(): string;",
        "  stable_variant(self: T): boolean;",
        "}",
      ].join("\n"),
      // the hand impls of config/config_type.rs:20-65
      config_type_bool: "export const config_type_bool: ConfigType<boolean>;",
      config_type_usize: "export const config_type_usize: ConfigType<number>;",
      config_type_String: "export const config_type_String: ConfigType<string>;",
      config_type_FileLines: 'export const config_type_FileLines: ConfigType<import("@/rustfmt/config/file_lines.ts").FileLines>;',
      config_type_MacroSelectors: `export const config_type_MacroSelectors: ConfigType<${G("macro_names", "MacroSelectors")}>;`,
      config_type_WidthHeuristics: `export const config_type_WidthHeuristics: ConfigType<${G("options", "WidthHeuristics")}>;`,
      config_type_IgnoreList: `export const config_type_IgnoreList: ConfigType<${G("options", "IgnoreList")}>;`,
      is_stable_option_and_value: [
        "// config/config_type.rs:675 (`T: PartialEq + Debug + ConfigType`: the ConfigType and Debug impls are passed)",
        'export function is_stable_option_and_value<T>(option_name: string, option_stable: boolean, option_value: T, config_type_T: ConfigType<T>, debug_T: import("@/std/fmt.ts").Debug<T>): boolean;',
      ].join("\n"),
    },
  },
  "rustfmt/config/style_edition.ts": {
    prelude: [],
    decls: {
      StyleEditionDefault: [
        "// `pub trait StyleEditionDefault { type ConfigType; fn style_edition_default(StyleEdition) -> Self::ConfigType; }` (config/style_edition.rs:5)",
        "export interface StyleEditionDefault<ConfigType> {",
        `  style_edition_default(style_edition: ${G("options", "StyleEdition")}): ConfigType;`,
        "}",
      ].join("\n"),
    },
  },
  "rustfmt/config/options.ts": {
    prelude: [RES, SER, DES],
    decls: {
      USIZE_MAX: "// `usize::MAX` (root's decision \"rustfmt-contract-1 PORT decisions\" (1): `Number.MAX_SAFE_INTEGER`)\nexport const USIZE_MAX: number;",
      ...fnDecls("WidthHeuristics", G("options", "WidthHeuristics"), undefined, false),
      ...fnDecls("IgnoreList", G("options", "IgnoreList"), undefined, true),
    },
  },
  "rustfmt/config/macro_names.ts": {
    prelude: [RES, SER, DES, "type MacroSelectorsError = unknown;"],
    decls: {
      MacroSelectors: [
        `export type MacroSelectors = ${G("macro_names", "MacroSelectors")};`,
        "// `impl FromStr for MacroSelectors` (config/macro_names.rs:86) on the type's companion const (PORTING §8)",
        "export const MacroSelectors: { from_str(s: string): Result<MacroSelectors, MacroSelectorsError> };",
      ].join("\n"),
      ...fnDecls("MacroSelectors", G("macro_names", "MacroSelectors"), "MacroSelectorsError", false),
      deserialize_MacroSelector: `export function deserialize_MacroSelector<E>(deserializer: Deserializer<E>): Result<${G("macro_names", "MacroSelector")}, E>;`,
    },
  },
  "rustfmt/config/file_lines.ts": {
    prelude: [RES, SER, DES, "type FileLinesError = unknown;"],
    decls: {
      FileLines: [
        "// `pub struct FileLines(Option<HashMap<FileName, Vec<Range>>>)` (config/file_lines.rs:165): hand-written (tools/codegen/rustfmt.json skip_notes)",
        "export class FileLines {",
        "  static all(): FileLines;",
        "  // `impl FromStr for FileLines` (config/file_lines.rs:308)",
        "  static from_str(s: string): Result<FileLines, FileLinesError>;",
        "}",
      ].join("\n"),
      ...fnDecls("FileLines", "FileLines", "FileLinesError", true, {
        clone_FileLines: "export function clone_FileLines(v: FileLines): FileLines;",
        debug_FileLines: 'export const debug_FileLines: import("@/std/fmt.ts").Debug<FileLines>;',
      }),
      serialize_FileName: `export function serialize_FileName<O, E>(self: ${G("file_lines", "FileName")}, serializer: Serializer<O, E>): Result<O, E>;`,
      deserialize_FileName: `export function deserialize_FileName<E>(deserializer: Deserializer<E>): Result<${G("file_lines", "FileName")}, E>;`,
    },
  },
};

/**
 * Methods and associated fns the hand modules add to generated classes (PORTING §5 "Methods defined in another file": `declare
 * module "./x.gen.ts"` + prototype / namespace), keyed by the generated module (relative to src/rustfmt/) with the hand module that
 * will add them. While that hand module is missing they go into the augmentation contract (contract_augment.gen.d.ts).
 */
export const AUGMENT_DECLS: Record<string, { hand: string; decl: string[] }> = {
  "./config/options.gen.ts": {
    hand: "rustfmt/config/options.ts",
    decl: [
      "interface IgnoreList {",
      "  // config/options.rs:443",
      "  add_prefix(dir: string): void;",
      "}",
      "namespace IgnoreList {",
      "  // `impl FromStr for IgnoreList` (config/options.rs:452)",
      '  export let from_str: (s: string) => import("../std/result.ts").Result<IgnoreList, string>;',
      "}",
      "namespace WidthHeuristics {",
      "  // config/options.rs:302, :315, :329",
      "  function null_(): WidthHeuristics;",
      "  export { null_ as null };",
      "  export let set: (max_width: number) => WidthHeuristics;",
      "  export let scaled: (max_width: number) => WidthHeuristics;",
      "  // `impl FromStr for WidthHeuristics` (config/options.rs:351)",
      '  export let from_str: (s: string) => import("../std/result.ts").Result<WidthHeuristics, string>;',
      "}",
    ],
  },
};

/**
 * The specifier every generated file uses for a module that does not exist yet: `../../<src-relative path>` (the generated files
 * sit two directories below src/). Its contract block is named by this exact text plus a trailing `*` (TypeScript never matches an
 * ambient module name that looks relative; with the `*` the name is a pattern whose prefix is the whole specifier and whose
 * wildcard matches the empty rest). So a block covers only imports written exactly this way, which nothing outside src/rustfmt/
 * may use (tools/codegen/rustfmt.test.ts checks it).
 */
export const CANON = "../../";

/** Generated files' imports of modules that are neither on disk nor generated, rewritten to their canonical specifier. */
export function canonicalizeImports(files: Map<string, string>, out: string, srcRoot: string, err: (m: string) => void): void {
  const generated = new Set([...files.keys()].map((f) => relative(out, f).replaceAll("\\", "/")));
  for (const [file, text] of files) {
    if (file.endsWith(".d.ts")) continue;
    const dir = dirname(relative(out, file)).replaceAll("\\", "/");
    let bad = false;
    const next = text.replace(/^(import (?:type )?\{[^}]*\} from ")([^"]+)(";)$/gm, (line, a: string, spec: string, b: string) => {
      const target = join(dir, spec).replaceAll("\\", "/");
      if (generated.has(target) || existsSync(join(srcRoot, target))) return line;
      if (dir.split("/").length !== CANON.split("/").length - 1) bad = true;
      return `${a}${CANON}${target}${b}`;
    });
    if (bad) err(`contract: ${relative(out, file)} imports a missing module but is not ${CANON.split("/").length - 1} directories below src/`);
    files.set(file, next);
  }
}

/** The contract file: ambient blocks for every imported module missing under `srcRoot` and not generated here. */
export function contractText(files: Map<string, string>, out: string, srcRoot: string, pin: string | undefined, err: (m: string) => void): string {
  const wanted = new Map<string, Set<string>>(); // src-relative module -> names
  const specifiers = new Map<string, Set<string>>(); // src-relative module -> the import specifiers that name it
  const generated = new Set([...files.keys()].map((f) => relative(out, f).replaceAll("\\", "/")));
  for (const [file, text] of files) {
    if (file.endsWith(".d.ts")) continue;
    for (const m of text.matchAll(/^import (?:type )?\{([^}]*)\} from "([^"]+)";$/gm)) {
      const target = join(dirname(relative(out, file)), m[2]!).replaceAll("\\", "/");
      if (generated.has(target) || existsSync(join(srcRoot, target))) continue;
      if (!wanted.has(target)) wanted.set(target, new Set());
      if (!specifiers.has(target)) specifiers.set(target, new Set());
      specifiers.get(target)!.add(m[2]!);
      for (const part of m[1]!.split(",").map((x) => x.trim()).filter(Boolean)) wanted.get(target)!.add(part.replace(/^type /, "").split(" as ")[0]!.trim());
    }
  }
  const serdeByPath = new Map(Object.entries(SD.SERDE_MODULES).map(([k, v]) => [v as string, k as SD.SerdeModule]));
  // `import("@/x")`: the real module from src/rustfmt/ if it exists (or is generated), else the canonical specifier of its block
  const resolveRefs = (l: string) =>
    l.replace(/import\("@\/([^"]+)"\)/g, (_m, t: string) => {
      if (generated.has(t) || existsSync(join(srcRoot, t))) {
        const r = relative(join(out, "rustfmt"), join(out, t)).replaceAll("\\", "/");
        return `import("${r.startsWith(".") ? r : `./${r}`}")`;
      }
      if (!wanted.has(t)) err(`contract: a declaration refers to ${t}, which is missing and has no block`);
      return `import("${CANON}${t}")`;
    });
  const lines = [
    `// GENERATED by tools/codegen/rustfmt.ts${pin ? ` @ ${pin}` : ""}. Do not edit.`,
    "// The modules src/rustfmt's generated code imports that do not exist yet, as ambient `declare module` blocks: TypeScript",
    "// consults a block only while no file resolves the import, so the generated code type-checks now, and once a module lands",
    "// the real one is checked against the same uses (rerun `bun tools/codegen/rustfmt.ts` then: its block is dropped). Each block",
    "// lists exactly what the generated code needs from that module; docs/handoff/codegen-fmt-serde.md has the conventions.",
    `// A block is named by the exact specifier the generated files use (\`${CANON}<path under src/>\`) plus \`*\`, which TypeScript`,
    "// needs to accept a relative-looking name; only imports written exactly so (by nothing outside src/rustfmt/) match it.",
  ];
  for (const target of [...wanted.keys()].sort()) {
    const sm = serdeByPath.get(target);
    const table = sm ? SD.SERDE_SURFACE_DECLS[sm] : HAND_DECLS[target]?.decls;
    const prelude = sm ? SD.SERDE_SURFACE_PRELUDE[sm] : (HAND_DECLS[target]?.prelude ?? []);
    if (!table) {
      err(`contract: no declarations for module ${target} (tools/codegen/rustfmt.ts HAND_DECLS)`);
      continue;
    }
    // named by the exact canonical specifier (see CANON), which every generated import of the module uses
    for (const sp of specifiers.get(target)!) if (sp !== `${CANON}${target}`) err(`contract: ${target} is imported as ${sp}, not ${CANON}${target} (canonicalizeImports)`);
    lines.push("", `declare module "${CANON}${target}*" {`, ...prelude.map((l) => `  ${resolveRefs(l)}`));
    const declared = new Set<string>();
    const emit = (n: string) => {
      if (declared.has(n)) return;
      const d = table[n];
      if (d === undefined) {
        err(`contract: ${target} has no declaration for ${n} (tools/codegen/${sm ? "serde.ts SERDE_SURFACE_DECLS" : "rustfmt.ts HAND_DECLS"})`);
        return;
      }
      declared.add(n);
      // a declaration that names another of the module's own declarations pulls it in first
      for (const other of Object.keys(table)) if (other !== n && new RegExp(`\\b${other}\\b`).test(d)) emit(other);
      lines.push(...d.split("\n").map((l) => `  ${resolveRefs(l)}`));
    };
    for (const n of [...wanted.get(target)!].sort()) emit(n);
    lines.push("}");
  }
  return lines.join("\n") + "\n";
}

/** The augmentation contract: AUGMENT_DECLS of generated modules whose hand module is missing (a module file: `export {}`). */
export function augmentText(srcRoot: string, pin: string | undefined): string {
  const lines = [
    `// GENERATED by tools/codegen/rustfmt.ts${pin ? ` @ ${pin}` : ""}. Do not edit.`,
    "// What the hand modules add to generated classes (methods, associated fns) that the generated code calls, as module",
    "// augmentations, while those hand modules do not exist yet. Once a hand module lands with its own `declare module` block,",
    "// rerun `bun tools/codegen/rustfmt.ts`: its entry here is dropped (two declarations of one namespace member conflict).",
    "export {};",
  ];
  for (const [gen, a] of Object.entries(AUGMENT_DECLS)) {
    if (existsSync(join(srcRoot, a.hand))) continue;
    lines.push("", `// added by src/${a.hand}`, `declare module "${gen}" {`, ...a.decl.map((l) => `  ${l}`), "}");
  }
  return lines.join("\n") + "\n";
}

// ---- CLI -----------------------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  const check = argv.includes("--check");
  const { UPSTREAM, PIN } = await import("../../scripts/lib/common.ts");
  const { runProbe } = await import("./types.ts");
  const jsonIn = opt("--json");
  const probe: ProbeJson = jsonIn ? JSON.parse(readFileSync(jsonIn, "utf8")) : await runProbe(CONFIG.set.files);
  const save = opt("--save-json");
  if (save) writeFileSync(save, JSON.stringify(probe, null, 1) + "\n");
  const src = join(REPO, "src");
  const g = generateRustfmt(probe, { out: src, srcRoot: src, pin: PIN.commit.slice(0, 12), upstream: UPSTREAM });
  let stale = 0;
  for (const [f, text] of g.files) {
    if (check) {
      if (!existsSync(f) || readFileSync(f, "utf8") !== text) {
        console.log(`ERROR: ${relative(REPO, f)} is stale (run bun tools/codegen/rustfmt.ts)`);
        stale++;
      }
    } else {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
  }
  const r = g.report;
  console.log(
    `rustfmt: ${g.files.size} files, ${r.files.reduce((a, f) => a + f.types, 0)} types, ${g.serdePlans.size} serde derives, ${g.configTypePlans.size} #[config_type] enums, create_config! ${g.createConfig ? `${g.createConfig.options.length} options` : "missing"}`,
  );
  for (const e of g.errors.slice(0, 10)) console.log(`ERROR: ${e}`);
  if (g.errors.length || stale) process.exit(1);
}
