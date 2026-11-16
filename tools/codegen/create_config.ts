// rustfmt's `create_config!` (src/tools/rustfmt/src/config/config_type.rs:68) as invoked by config/mod.rs, with the option types
// and defaults that `config_option_with_style_edition_default!` (config/options.rs:599) and `style_edition_default!`
// (config/style_edition.rs:12) define at options.rs's invocation. Part of tools/codegen/rustfmt.ts (lane codegen-fmt-serde).
//
// The invocations are read with the ported rustc_lexer; the shapes the expansion relies on are checked and anything else is an
// ERROR. The expansion is written in the macro's order:
// - per `config_option_with_style_edition_default!` entry, the unit struct's `StyleEditionDefault` impl as a table
//   `export const MaxWidth: StyleEditionDefault<number> = { style_edition_default(..) { .. } }` (style_edition.rs:17 / :26);
// - `Config` (a class; each option's `(Cell<bool>, bool, T, bool, bool)` is a TS tuple in the field `<option>_`, since the
//   getter `<option>()` takes the option's name: PORT decision, as anstyle_parse's `len_`), `PartialConfig` (an interface,
//   with its serde derives through tools/codegen/serde.ts), `ConfigSetter`, `CliConfigSetter`, `ConfigWasSet`, `CliConfigWasSet`,
//   `impl Config` and `impl Default for Config` (`default_Config`).
// `renderRustDefaults` / `renderRustPrintDocs` render the parts that depend on the parse as rustc prints them, for the oracle
// comparison (tools/codegen/rustfmt.test.ts against tools/codegen/fixtures/rustfmt.expanded.rs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Str } from "../../src/std/str.ts";
import { unescape_str } from "../../src/vendor/rustc_literal_escaper/lib.ts";
import type * as CT from "./config_type.ts";
import { closeOf, lexRust, type RTok } from "./rust_tokens.ts";
import * as SD from "./serde.ts";
import type { PField, PItem, PType } from "./types.ts";

const CONFIG_TYPE_RS = "src/tools/rustfmt/src/config/config_type.rs";
const MOD_RS = "src/tools/rustfmt/src/config/mod.rs";
const OPTIONS_RS = "src/tools/rustfmt/src/config/options.rs";
const STYLE_EDITION_RS = "src/tools/rustfmt/src/config/style_edition.rs";
const CARGO_TOML = "src/tools/rustfmt/Cargo.toml";

export interface CCString {
  /** the literal's source text (`"..."`), as the pretty-printer prints it */
  raw: string;
  value: string;
}
export interface CCOption {
  name: string;
  /** `$ty`: the unit struct naming the option's `StyleEditionDefault` impl */
  ty: string;
  stb: boolean;
  dstrings: CCString[];
  line: number;
}
export interface CCDefault {
  name: string;
  /** `$config_ty` (`<$ty as StyleEditionDefault>::ConfigType`) as Rust text */
  config_ty: string;
  default_2024?: RTok[];
  default: RTok[];
  line: number;
}
export interface CreateConfigInput {
  options: CCOption[];
  defaults: Map<string, CCDefault>;
  /** fixed fn name -> line of its `fn` in config_type.rs */
  fnLine: Map<string, number>;
  /** the two `fn style_edition_default` of style_edition.rs's macro arms */
  sedLines: [number, number];
  /** `env!("CARGO_PKG_VERSION")`: rustfmt's Cargo.toml `version` */
  version: string;
  invokedAt: number;
  defaultsAt: number;
}

function fail(path: string, t: RTok | undefined, msg: string): never {
  throw new Error(`${path}:${t?.line ?? "?"}: ${msg}${t ? ` (at \`${t.text}\`)` : ""}`);
}

function strValue(path: string, t: RTok): string {
  if (t.kind !== "Literal" || !t.text.startsWith('"')) fail(path, t, "expected a string literal");
  let out = "";
  let err: string | undefined;
  unescape_str(Str.from(t.text.slice(1, -1)), (_s, _e, res) => {
    if (res.$ === "Err") err ??= res._0;
    else out += String.fromCodePoint(res._0);
  });
  if (err !== undefined) fail(path, t, `string literal escape error ${err}`);
  return out;
}

/** The token range `(open, close)` of the body of the first top-level `<name> ! <delim>` invocation after token `from`. */
function invocation(path: string, toks: RTok[], name: string, from = 0): [number, number] {
  for (let i = from; i + 2 < toks.length; i++) {
    if (toks[i]!.text === "macro_rules") {
      // skip a `macro_rules! name { .. }` definition (its body invokes macros too)
      const open = i + 3;
      i = closeOf(toks, open);
      continue;
    }
    if (toks[i]!.text === name && toks[i + 1]!.text === "!" && "({[".includes(toks[i + 2]!.text)) return [i + 2, closeOf(toks, i + 2)];
  }
  fail(path, undefined, `no top-level ${name}! invocation`);
}

/** Tokens from `i` up to (not including) the first of `stops` at delimiter depth 0. */
function until(toks: RTok[], i: number, end: number, stops: string[]): number {
  let depth = 0;
  for (; i < end; i++) {
    const t = toks[i]!.text;
    if (t === "(" || t === "[" || t === "{" || (t === "<" && depth >= 0)) depth++;
    else if (t === ")" || t === "]" || t === "}" || t === ">") depth--;
    else if (depth === 0 && stops.includes(t)) return i;
  }
  return end;
}

export function readCreateConfig(upstream: string): CreateConfigInput {
  const src = (p: string) => readFileSync(join(upstream, p), "utf8");
  // create_config! { $($i:ident: $ty:ty, $stb:expr, $( $dstring:expr ),+ );+ $(;)* }  (config/mod.rs)
  const mt = lexRust(src(MOD_RS));
  const [mo, mc] = invocation(MOD_RS, mt, "create_config");
  const options: CCOption[] = [];
  for (let i = mo + 1; i < mc; ) {
    if (mt[i]!.text === ";") {
      i++;
      continue;
    }
    const name = mt[i]!;
    if (name.kind !== "Ident" || mt[i + 1]!.text !== ":") fail(MOD_RS, name, "expected `ident:`");
    const tyEnd = until(mt, i + 2, mc, [","]);
    if (tyEnd !== i + 3 || mt[i + 2]!.kind !== "Ident") fail(MOD_RS, mt[i + 2], "an option type other than a plain ident");
    const stb = mt[tyEnd + 1]!;
    if (stb.text !== "true" && stb.text !== "false") fail(MOD_RS, stb, "`$stb` other than `true`/`false`");
    if (mt[tyEnd + 2]!.text !== ",") fail(MOD_RS, mt[tyEnd + 2], "expected `,`");
    const dstrings: CCString[] = [];
    let j = tyEnd + 3;
    for (;;) {
      const s = mt[j]!;
      dstrings.push({ raw: s.text, value: strValue(MOD_RS, s) });
      j++;
      if (mt[j]!.text === ",") j++;
      else break;
    }
    if (j < mc && mt[j]!.text !== ";") fail(MOD_RS, mt[j], "expected `;`");
    options.push({ name: name.text, ty: mt[i + 2]!.text, stb: stb.text === "true", dstrings, line: name.line });
    i = j;
  }
  // config_option_with_style_edition_default!( $($name:ident, $config_ty:ty, $(Edition2024 => $default_2024:expr,)? _ => $default:expr);* $(;)* )
  const ot = lexRust(src(OPTIONS_RS));
  const [oo, oc] = invocation(OPTIONS_RS, ot, "config_option_with_style_edition_default");
  const defaults = new Map<string, CCDefault>();
  for (let i = oo + 1; i < oc; ) {
    if (ot[i]!.text === ";") {
      i++;
      continue;
    }
    const name = ot[i]!;
    if (name.kind !== "Ident" || ot[i + 1]!.text !== ",") fail(OPTIONS_RS, name, "expected `Name,`");
    const tyEnd = until(ot, i + 2, oc, [","]);
    const config_ty = ot
      .slice(i + 2, tyEnd)
      .map((t) => t.text)
      .join("");
    let j = tyEnd + 1;
    let default_2024: RTok[] | undefined;
    if (ot[j]!.text === "Edition2024") {
      if (ot[j + 1]!.text !== "=" || ot[j + 2]!.text !== ">") fail(OPTIONS_RS, ot[j + 1], "expected `=>`");
      const e = until(ot, j + 3, oc, [","]);
      default_2024 = ot.slice(j + 3, e);
      j = e + 1;
    }
    if (ot[j]!.text !== "_" || ot[j + 1]!.text !== "=" || ot[j + 2]!.text !== ">") fail(OPTIONS_RS, ot[j], "expected `_ =>`");
    const e = until(ot, j + 3, oc, [";"]);
    defaults.set(name.text, { name: name.text, config_ty, default_2024, default: ot.slice(j + 3, e), line: name.line });
    i = e;
  }
  for (const o of options) if (!defaults.has(o.ty)) fail(MOD_RS, undefined, `option ${o.name}: no StyleEditionDefault impl for ${o.ty}`);
  // the fixed fns of the macro body (markers), and the two `style_edition_default` of style_edition.rs
  const ctLines = src(CONFIG_TYPE_RS).split("\n");
  const start = ctLines.findIndex((l) => l.startsWith("macro_rules! create_config"));
  const end = ctLines.findIndex((l, k) => k > start && l === "}");
  const fnLine = new Map<string, number>();
  for (let k = start; k < end; k++) {
    const m = /\bfn ([a-z_]\w*)\s*[(<]/.exec(ctLines[k]!);
    if (m) fnLine.set(m[1]!, k + 1);
  }
  const seLines = src(STYLE_EDITION_RS).split("\n");
  const seMacro = seLines.findIndex((l) => l.startsWith("macro_rules! style_edition_default"));
  const sed = seLines.flatMap((l, k) => (k > seMacro && /^\s+fn style_edition_default\(/.test(l) ? [k + 1] : []));
  if (sed.length !== 2) fail(STYLE_EDITION_RS, undefined, `expected the two macro arms' style_edition_default, found ${sed.length}`);
  const version = /^version = "([^"]+)"$/m.exec(src(CARGO_TOML))?.[1];
  if (!version) fail(CARGO_TOML, undefined, "no package version");
  return { options, defaults, fnLine, sedLines: [sed[0]!, sed[1]!], version, invokedAt: mt[mo - 2]!.line, defaultsAt: ot[oo - 2]!.line };
}

// ---- Rust renderings for the oracle -------------------------------------------------------------

const toksText = (ts: RTok[]) => ts.map((t) => t.text).join(" ");

/** A default expression as rustc prints the expansion (`env!("CARGO_PKG_VERSION")` is expanded by rustc). */
function rustDefault(e: RTok[], version: string): string {
  const t = toksText(e);
  if (t === 'env ! ( "CARGO_PKG_VERSION" ) . to_owned ( )') return `${JSON.stringify(version)}.to_owned()`;
  return t;
}

/** `config_option_with_style_edition_default!` / `style_edition_default!`'s output per entry, as `-Zunpretty=expanded` prints it. */
export function renderRustDefault(d: CCDefault, version: string): string {
  const head = `impl crate::config::style_edition::StyleEditionDefault for ${d.name} { type ConfigType = ${d.config_ty};`;
  if (!d.default_2024)
    return `#[allow(unreachable_pub)] pub struct ${d.name}; ${head} fn style_edition_default(_: crate::config::StyleEdition) -> Self::ConfigType { ${rustDefault(d.default, version)} } }`;
  return `pub struct ${d.name}; ${head} fn style_edition_default(style_edition: crate::config::StyleEdition) -> Self::ConfigType {
    match style_edition {
      crate::config::StyleEdition::Edition2015 | crate::config::StyleEdition::Edition2018 | crate::config::StyleEdition::Edition2021 => ${rustDefault(d.default, version)},
      crate::config::StyleEdition::Edition2024 | crate::config::StyleEdition::Edition2027 => ${rustDefault(d.default_2024, version)},
    }
  } }`;
}

/** `Config::print_docs` (config_type.rs:386) as expanded for the parsed options. */
export function renderRustPrintDocs(input: CreateConfigInput): string {
  const os = input.options;
  const blocks = os.map(
    (o) => `if ${o.stb} || include_unstable {
  let name_raw = ${JSON.stringify(o.name)};
  if !Config::is_hidden_option(name_raw) {
    let mut name_out = String::with_capacity(max);
    for _ in name_raw.len()..max - 1 { name_out.push(' ') }
    name_out.push_str(name_raw);
    name_out.push(' ');
    let default_value = <${o.ty} as StyleEditionDefault>::style_edition_default(style_edition);
    let mut default_str = ::alloc::__export::must_use({ ::alloc::fmt::format(format_args!("{0}", default_value)) });
    if default_str.is_empty() { default_str = String::from("\\"\\""); }
    out.write_fmt(format_args!("{0}{1} Default: {2}{3}\\n", name_out, <<${o.ty} as StyleEditionDefault>::ConfigType>::doc_hint(), default_str, if !${o.stb} { " (unstable)" } else { "" })).unwrap();
    ${o.dstrings.map((s) => `out.write_fmt(format_args!("{0}{1}\\n", space_str, ${s.raw})).unwrap();`).join("\n")}
    out.write_fmt(format_args!("\\n")).unwrap();
  }
}`,
  );
  return `pub fn print_docs(out: &mut dyn Write, include_unstable: bool) {
  let style_edition = StyleEdition::Edition2015;
  use std::cmp;
  let max = 0;
  ${os.map((o) => `let max = cmp::max(max, ${JSON.stringify(o.name)}.len() + 1);`).join("\n")}
  let space_str = " ".repeat(max);
  out.write_fmt(format_args!("Configuration Options:\\n")).unwrap();
  ${blocks.join("\n")}
}`;
}

/**
 * `stringify!(<$ty as StyleEditionDefault>::ConfigType)` (config_type.rs:342): rustc prints the token stream with spaces around
 * the angle brackets and the path separator (checked against the oracle by `renderRustOverrideValue`).
 */
export const stringifyConfigType = (ty: string): string => `< ${ty} as StyleEditionDefault > :: ConfigType`;

/** `Config::override_value` (config_type.rs:322) as expanded for the parsed options. */
export function renderRustOverrideValue(input: CreateConfigInput): string {
  const arms = input.options.map(
    (o) => `${JSON.stringify(o.name)} => {
  let value = val.parse::<<${o.ty} as StyleEditionDefault>::ConfigType>().expect(&::alloc::__export::must_use({ ::alloc::fmt::format(format_args!("Failed to parse override for {0} (\\"{1}\\") as a {2}", ${JSON.stringify(o.name)}, val, ${JSON.stringify(stringifyConfigType(o.ty))})) }));
  self.${o.name}.1 = true;
  self.${o.name}.2 = value;
}`,
  );
  return `pub fn override_value(&mut self, key: &str, val: &str) {
  match key {
    ${arms.join("\n")}
    _ => { ::core::panicking::panic_fmt(format_args!("Unknown config key in override: {0}", key)); }
  }
  match key {
    "max_width" | "use_small_heuristics" | "fn_call_width" | "single_line_if_else_max_width" | "single_line_let_else_max_width" | "attr_fn_like_width" | "struct_lit_width" | "struct_variant_width" | "array_width" | "chain_width" => self.set_heuristics(),
    "merge_imports" => self.set_merge_imports(),
    "fn_args_layout" => self.set_fn_args_layout(),
    "hide_parse_errors" => self.set_hide_parse_errors(),
    "version" => self.set_version(),
    &_ => (),
  }
}`;
}

/** `PartialConfig` as a probe item (`pub struct PartialConfig { $(pub $i: Option<<$ty as StyleEditionDefault>::ConfigType>),+ }`). */
export function partialConfigItem(input: CreateConfigInput): PItem {
  const qty = (o: CCOption): PType => ({ kind: "path", text: `<${o.ty} as StyleEditionDefault>::ConfigType`, path: { global: false, segments: [{ name: "ConfigType", args: [] }] }, qself: { kind: "path", text: o.ty, path: { global: false, segments: [{ name: o.ty, args: [] }] } } });
  const fields: PField[] = input.options.map((o, index) => ({
    name: o.name,
    index,
    vis: "pub",
    ty: { kind: "path", text: `Option<<${o.ty} as StyleEditionDefault>::ConfigType>`, path: { global: false, segments: [{ name: "Option", args: [{ kind: "type", ty: qty(o) }] }] } },
    attrs: [],
    docs: [],
    line: o.line,
  }));
  return {
    kind: "struct",
    name: "PartialConfig",
    line: input.fnLine.get("default_with_style_edition") ?? 0,
    vis: "pub",
    module: [],
    attrs: [{ path: "derive", text: "derive (Deserialize, Serialize, Clone)", derives: ["Deserialize", "Serialize", "Clone"] }],
    docs: [],
    generics: { params: [], where: [] },
    fields: { style: "named", fields },
  };
}

// ---- the TS expansion ---------------------------------------------------------------------------------

export interface CreateConfigCtx {
  plans: Map<string, CT.ConfigTypePlan>;
  manual: Map<string, Set<"Serialize" | "Deserialize">>;
  itemsByName: Map<string, PItem>;
  /** upstream file of each generated item (to import it from its `.gen.ts`) */
  itemFile: Map<string, string>;
  pin?: string;
  serdePlans: Map<string, SD.SerdePlan>;
  err: (m: string) => void;
}

/** What the expansion needs of an option's config type `T` (`<$ty as StyleEditionDefault>::ConfigType`). */
interface TyOps {
  ts: string;
  config_type: string;
  display: (v: string) => string;
  /** `val.parse::<T>()`: a `Result<T, Err>` */
  from_str: (s: string) => string;
  /** `Debug` of `<T as FromStr>::Err` (the `.expect(..)` message) */
  err_debug: string;
  clone: (v: string) => string;
  eq: (a: string, b: string) => string;
  debug: string;
  de: string;
  ser: string;
}

/** The TS module of an upstream rustfmt file, relative to src/rustfmt/config/ (`./options.gen.ts`). */
const genOf = (upstream: string) => `./${upstream.replace(/^src\/tools\/rustfmt\/src\/config\//, "").replace(/\.rs$/, ".gen.ts")}`;

export function createConfigTs(input: CreateConfigInput, c: CreateConfigCtx): string {
  // module specifier -> name -> kind
  const imports = new Map<string, Map<string, "types" | "values">>();
  const use = (module: string, name: string, kind: "types" | "values" = "values"): string => {
    if (!imports.has(module)) imports.set(module, new Map());
    const m = imports.get(module)!;
    if (m.get(name) !== "values") m.set(name, kind);
    return name;
  };
  const serdeUse = (m: SD.SerdeModule, n: string, kind: "types" | "values" = "values") => use(`../../${SD.SERDE_MODULES[m]}`, n, kind);
  const ops = new Map<string, TyOps>();
  const opsOf = (rust: string, at: string): TyOps => {
    const cached = ops.get(rust);
    if (cached) return cached;
    const o = makeOps(rust, at);
    ops.set(rust, o);
    return o;
  };
  const makeOps = (rust: string, at: string): TyOps => {
    const CTM = "./config_type.ts";
    if (rust === "bool")
      return {
        ts: "boolean",
        config_type: use(CTM, "config_type_bool"),
        display: (v) => `String(${v})`,
        from_str: (s) => `__bool_from_str(${s})`,
        err_debug: "__debug_ParseBoolError",
        clone: (v) => v,
        eq: (a, b) => `${a} === ${b}`,
        debug: use("../../std/fmt.ts", "debug_bool"),
        de: serdeUse("de_impls", "deserialize_bool"),
        ser: serdeUse("ser_impls", "serialize_bool"),
      };
    if (rust === "usize")
      return {
        ts: "number",
        config_type: use(CTM, "config_type_usize"),
        display: (v) => `String(${v})`,
        from_str: (s) => `${use("../../std/num.ts", "usize_from_str")}(${s})`,
        err_debug: "__debug_ParseIntError",
        clone: (v) => v,
        eq: (a, b) => `${a} === ${b}`,
        debug: use("../../std/fmt.ts", "debug_int"),
        de: serdeUse("de_impls", "deserialize_usize"),
        ser: serdeUse("ser_impls", "serialize_usize"),
      };
    if (rust === "String")
      return {
        ts: "string",
        config_type: use(CTM, "config_type_String"),
        display: (v) => v,
        // `impl FromStr for String { type Err = Infallible; .. Ok(String::from(s)) }`
        from_str: (s) => `${use("../../std/result.ts", "Ok")}(${s})`,
        err_debug: "__debug_Infallible",
        clone: (v) => v,
        eq: (a, b) => `${a} === ${b}`,
        debug: use("../../std/fmt.ts", "debug_str"),
        de: serdeUse("de_impls", "deserialize_String"),
        ser: serdeUse("ser_impls", "serialize_String"),
      };
    const plan = c.plans.get(rust);
    if (plan) {
      const gen = genOf(c.itemFile.get(rust)!);
      const data = plan.variants.some((v) => v.style !== "unit");
      return {
        ts: use(gen, rust),
        config_type: use(gen, `config_type_${rust}`),
        display: (v) => `${use(gen, `display_${rust}`)}(${v})`,
        from_str: (s) => `${rust}.from_str(${s})`,
        err_debug: use("../../std/fmt.ts", "debug_str"),
        clone: (v) => (data ? `${use(gen, `clone_${rust}`)}(${v})` : v),
        // derive(PartialEq) of the macro's enum: `===` on a string-literal union; a data enum compares variant and fields
        eq: (a, b) => (data ? `${use(gen, `${rust}_eq`)}(${a}, ${b})` : `${a} === ${b}`),
        debug: use(gen, `debug_${rust}`),
        de: use(gen, `deserialize_${rust}`),
        ser: use(gen, `serialize_${rust}`),
      };
    }
    // the four struct option types: generated types and derives, hand-written impls (HAND_DECLS / AUGMENT_DECLS in rustfmt.ts)
    const HAND: Record<string, { gen?: string; hand: string; cls: "gen" | "hand"; errDebug: string; manualSerde?: boolean; handClone?: boolean }> = {
      WidthHeuristics: { gen: "./options.gen.ts", hand: "./options.ts", cls: "gen", errDebug: "debug_str" },
      IgnoreList: { gen: "./options.gen.ts", hand: "./options.ts", cls: "gen", errDebug: "debug_str", manualSerde: true },
      MacroSelectors: { gen: "./macro_names.gen.ts", hand: "./macro_names.ts", cls: "hand", errDebug: "debug_MacroSelectorsError" },
      FileLines: { hand: "./file_lines.ts", cls: "hand", errDebug: "debug_FileLinesError", manualSerde: true, handClone: true },
    };
    const h = HAND[rust];
    if (!h) {
      c.err(`${at}: create_config!: no TS operations for option type ${rust}`);
      return makeOps("bool", at);
    }
    const tyMod = h.cls === "gen" ? h.gen! : h.hand;
    const derived = h.gen ?? h.hand;
    return {
      ts: use(tyMod, rust),
      config_type: use("./config_type.ts", `config_type_${rust}`),
      display: (v) => `${use(h.hand, `display_${rust}`)}(${v})`,
      from_str: (s) => `${use(tyMod, rust)}.from_str(${s})`,
      err_debug: h.errDebug === "debug_str" ? use("../../std/fmt.ts", "debug_str") : use(h.hand, h.errDebug),
      clone: (v) => `${use(h.handClone ? h.hand : derived, `clone_${rust}`)}(${v})`,
      eq: (a, b) => `${use(h.hand, `${rust}_eq`)}(${a}, ${b})`,
      debug: use(h.handClone ? h.hand : derived, `debug_${rust}`),
      de: use(h.manualSerde ? h.hand : derived, `deserialize_${rust}`),
      ser: use(h.manualSerde ? h.hand : derived, `serialize_${rust}`),
    };
  };

  // ---- default expressions (`$default`, `$default_2024`) ----
  const tsDefault = (d: CCDefault, e: RTok[]): string => {
    const t = toksText(e);
    const at = `${OPTIONS_RS}:${d.line}`;
    if (/^\d+$/.test(t)) return t;
    if (t === "true" || t === "false") return t;
    if (t === 'env ! ( "CARGO_PKG_VERSION" ) . to_owned ( )') return `${JSON.stringify(input.version)} /* env!("CARGO_PKG_VERSION") (src/tools/rustfmt/Cargo.toml) */`;
    let m = /^(\w+) : : (\w+)$/.exec(t);
    if (m) {
      const plan = c.plans.get(m[1]!);
      const v = plan?.variants.find((x) => x.name === m![2]);
      if (!plan || !v || v.style !== "unit") c.err(`${at}: default ${t}: not a unit variant of a #[config_type] enum`);
      opsOf(m[1]!, at);
      return plan?.variants.some((x) => x.style !== "unit") ? `${m[1]}.${m[2]}` : JSON.stringify(m[2]);
    }
    m = /^(\w+) : : (\w+) \( (.*?) ?\)$/.exec(t);
    if (m) {
      const [, ty, f, args] = m;
      if (f === "default" && !args && (ty === "MacroSelectors" || ty === "IgnoreList")) {
        // derive(Default) (types.ts `derive_default`)
        return `${use(ty === "MacroSelectors" ? "./macro_names.gen.ts" : "./options.gen.ts", `default_${ty}`)}()`;
      }
      if (ty === "WidthHeuristics" && f === "scaled" && /^\d+$/.test(args ?? "")) return `${use("./options.gen.ts", "WidthHeuristics")}.scaled(${args})`;
      if (ty === "FileLines" && f === "all" && !args) return `${use("./file_lines.ts", "FileLines")}.all()`;
    }
    c.err(`${at}: default expression \`${t}\` is not translated (tools/codegen/create_config.ts tsDefault)`);
    return `unported_default(${JSON.stringify(t)})`;
  };

  const os = input.options;
  const L = (n: string) => {
    const l = input.fnLine.get(n);
    if (l === undefined) c.err(`${CONFIG_TYPE_RS}: no fn ${n} in the create_config! body`);
    return `// rustc: ${CONFIG_TYPE_RS}:${l ?? 0} ${n}`;
  };
  const ty = (o: CCOption) => opsOf(input.defaults.get(o.ty)!.config_ty, `${MOD_RS}:${o.line}`);
  const field = (o: CCOption) => `${o.name}_`;
  const SE = use("./options.gen.ts", "StyleEdition", "types");
  const SED = use("./style_edition.ts", "StyleEditionDefault", "types");
  const R = use("../../std/result.ts", "Result", "types");
  const out: string[] = [];

  // ---- the StyleEditionDefault impls ----
  out.push(`// ---- config_option_with_style_edition_default! (${OPTIONS_RS}:599) at ${OPTIONS_RS}:${input.defaultsAt} ----`);
  out.push("// `pub struct Name; impl StyleEditionDefault for Name { type ConfigType = T; fn style_edition_default(..) -> T }`: the unit struct");
  out.push("// is its impl's table (PORTING §5 \"Traits\"); `ConfigType` is the table's type argument.");
  for (const d of input.defaults.values()) {
    const o = opsOf(d.config_ty, `${OPTIONS_RS}:${d.line}`);
    out.push("", `// ${OPTIONS_RS}:${d.line} ${d.name}, ${d.config_ty}`);
    out.push(`export const ${d.name}: ${SED}<${o.ts}> = {`);
    if (!d.default_2024) {
      out.push(`  // rustc: ${STYLE_EDITION_RS}:${input.sedLines[0]} style_edition_default`);
      out.push(`  style_edition_default(_: ${SE}): ${o.ts} {`, `    return ${tsDefault(d, d.default)};`, "  },");
    } else {
      out.push(`  // rustc: ${STYLE_EDITION_RS}:${input.sedLines[1]} style_edition_default`);
      out.push(`  style_edition_default(style_edition: ${SE}): ${o.ts} {`, "    switch (style_edition) {");
      out.push(`      case "Edition2015":`, `      case "Edition2018":`, `      case "Edition2021":`, `        return ${tsDefault(d, d.default)};`);
      out.push("      // TODO: should update macro when default_2027 becomes available");
      out.push(`      case "Edition2024":`, `      case "Edition2027":`, `        return ${tsDefault(d, d.default_2024)};`, "    }", "  },");
    }
    out.push("};");
  }

  // ---- struct Config / PartialConfig ----
  out.push("", `// ---- create_config! (${CONFIG_TYPE_RS}:68) at ${MOD_RS}:${input.invokedAt} ----`);
  out.push("// For each config item, we store:");
  out.push("//");
  out.push("// - 0: true if the value has been access");
  out.push("// - 1: true if the option was manually initialized");
  out.push("// - 2: the option value");
  out.push("// - 3: true if the option is unstable");
  out.push("// - 4: true if the option was set manually from a CLI flag");
  out.push("// FIXME: 4 is probably unnecessary and duplicative");
  out.push("// https://github.com/rust-lang/rustfmt/issues/6252");
  out.push("// PORT: `$i: (Cell<bool>, bool, T, bool, bool)` is the TS tuple field `<option>_`: the getter `<option>()` has the option's name.");
  out.push("/** `#[derive(Clone)]` */", "export class Config {", "  constructor(");
  for (const o of os) out.push(`    public ${field(o)}: [boolean, boolean, ${ty(o).ts}, boolean, boolean],`);
  out.push("  ) {}");
  // per-option getters
  out.push("");
  out.push(`  // PORT: generated by create_config! (${CONFIG_TYPE_RS}:204): \`pub fn $i(&self) -> T { self.$i.0.set(true); self.$i.2.clone() }\``);
  for (const o of os) out.push(`  ${o.name}(): ${ty(o).ts} {`, `    this.${field(o)}[0] = true;`, `    return ${ty(o).clone(`this.${field(o)}[2]`)};`, "  }");
  // default_with_style_edition
  out.push("", `  ${L("default_with_style_edition")}`, `  static default_with_style_edition(style_edition: ${SE}): Config {`, "    return new Config(");
  for (const o of os) out.push(`      [false, false, ${o.ty}.style_edition_default(style_edition), ${o.stb}, false],`);
  out.push("    );", "  }");
  for (const [n, cls] of [
    ["set", "ConfigSetter"],
    ["set_cli", "CliConfigSetter"],
    ["was_set", "ConfigWasSet"],
    ["was_set_cli", "CliConfigWasSet"],
  ] as const)
    out.push("", `  ${L(n)}`, `  ${n}(): ${cls} {`, `    return new ${cls}(this);`, "  }");
  // fill_from_parsed_config
  const isso = use("./config_type.ts", "is_stable_option_and_value");
  out.push("", `  ${L("fill_from_parsed_config")}`, "  // PORT: `mut self` is consumed upstream; here `this` is updated and returned.");
  out.push("  fill_from_parsed_config(parsed: PartialConfig, dir: string): Config {");
  for (const o of os) {
    const t = ty(o);
    out.push(`    {`, `      const option_value = parsed.${o.name};`, "      if (option_value !== undefined) {");
    out.push(`        const option_stable = this.${field(o)}[3];`);
    out.push(`        if (${isso}(${JSON.stringify(o.name)}, option_stable, option_value, ${t.config_type}, ${t.debug})) {`);
    out.push(`          this.${field(o)}[1] = true;`, `          this.${field(o)}[2] = option_value;`, "        }", "      }", "    }");
  }
  out.push("    this.set_heuristics();", "    this.set_ignore(dir);", "    this.set_merge_imports();", "    this.set_fn_args_layout();");
  out.push("    this.set_hide_parse_errors();", "    this.set_version();", "    return this;", "  }");
  // hash_set (#[cfg(test)])
  out.push("", "  /// Returns a hash set initialized with every user-facing config option name.", `  ${L("hash_set")}`, "  // #[cfg(test)]");
  out.push("  static hash_set(): Set<string> {", "    const hash_set = new Set<string>();");
  for (const o of os) out.push(`    hash_set.add(${JSON.stringify(o.name)});`);
  out.push("    return hash_set;", "  }");
  // is_valid_name
  out.push("", `  ${L("is_valid_name")}`, "  static is_valid_name(name: string): boolean {", "    switch (name) {");
  for (const o of os) out.push(`      case ${JSON.stringify(o.name)}:`);
  out.push("        return true;", "      default:", "        return false;", "    }", "  }");
  // is_valid_key_val
  out.push("", `  ${L("is_valid_key_val")}`, "  static is_valid_key_val(key: string, val: string): boolean {", "    switch (key) {");
  for (const o of os) out.push(`      case ${JSON.stringify(o.name)}:`, `        return ${ty(o).from_str("val")}.$ === "Ok";`);
  out.push("      default:", "        return false;", "    }", "  }");
  // used_options / all_options
  out.push("", `  ${L("used_options")}`, "  used_options(): PartialConfig {", "    return {");
  for (const o of os) out.push(`      ${o.name}: this.${field(o)}[0] ? ${ty(o).clone(`this.${field(o)}[2]`)} : undefined,`);
  out.push("    };", "  }");
  out.push("", `  ${L("all_options")}`, "  all_options(): PartialConfig {", "    return {");
  for (const o of os) out.push(`      ${o.name}: ${ty(o).clone(`this.${field(o)}[2]`)},`);
  out.push("    };", "  }");
  // override_value
  const expect_result = use("../../std/result.ts", "expect_result");
  const panic = use("../../std/panic.ts", "panic");
  out.push("", `  ${L("override_value")}`, "  override_value(key: string, val: string): void {");
  out.push("    // (each option's arm, upstream:) Users are currently allowed to set unstable");
  out.push("    // options/variants via the `--config` options override.");
  out.push("    //");
  out.push("    // There is ongoing discussion about how to move forward here:");
  out.push("    // https://github.com/rust-lang/rustfmt/pull/5379");
  out.push("    //");
  out.push("    // For now, do not validate whether the option or value is stable,");
  out.push("    // just always set it.");
  out.push("    switch (key) {");
  for (const o of os) {
    const t = ty(o);
    out.push(`      case ${JSON.stringify(o.name)}: {`);
    out.push(`        const value = ${expect_result}(`, `          ${t.from_str("val")},`);
    out.push(`          \`Failed to parse override for ${o.name} ("\${val}") as a ${stringifyConfigType(o.ty)}\`,`);
    out.push(`          ${t.err_debug},`, "        );");
    out.push(`        this.${field(o)}[1] = true;`, `        this.${field(o)}[2] = value;`, "        break;", "      }");
  }
  out.push("      default:", `        ${panic}(\`Unknown config key in override: \${key}\`);`, "    }");
  out.push("    __set_dependent_options(this, key);", "  }");
  // is_hidden_option
  out.push("", `  ${L("is_hidden_option")}`, "  static is_hidden_option(name: string): boolean {");
  out.push('    const HIDE_OPTIONS: string[] = ["verbose", "verbose_diff", "file_lines", "width_heuristics", "merge_imports", "fn_args_layout", "hide_parse_errors"];');
  out.push("    return HIDE_OPTIONS.includes(name);", "  }");
  // print_docs
  const unwrap_result = use("../../std/result.ts", "unwrap_result");
  out.push("", `  ${L("print_docs")}`, "  static print_docs(out: Write, include_unstable: boolean): void {");
  out.push(`    const style_edition: ${SE} = "Edition2015";`, "    let max = 0;");
  for (const o of os) out.push(`    max = Math.max(max, ${new TextEncoder().encode(o.name).length} /* ${JSON.stringify(o.name)}.len() */ + 1);`);
  out.push('    const space_str = " ".repeat(max);', `    ${unwrap_result}(out.write_fmt("Configuration Options:\\n"));`);
  for (const o of os) {
    const t = ty(o);
    out.push(`    if (${o.stb} || include_unstable) {`, `      const name_raw = ${JSON.stringify(o.name)};`, "      if (!Config.is_hidden_option(name_raw)) {");
    out.push('        let name_out = "";', `        for (let _i = ${new TextEncoder().encode(o.name).length}; _i < max - 1; _i++) name_out += " ";`);
    out.push("        name_out += name_raw;", '        name_out += " ";');
    out.push(`        const default_value = ${o.ty}.style_edition_default(style_edition);`);
    out.push(`        let default_str = ${t.display("default_value")};`, '        if (default_str === "") default_str = \'""\';');
    out.push(`        ${unwrap_result}(out.write_fmt(\`\${name_out}\${${t.config_type}.doc_hint()} Default: \${default_str}\${!${o.stb} ? " (unstable)" : ""}\\n\`));`);
    for (const s of o.dstrings) out.push(`        ${unwrap_result}(out.write_fmt(\`\${space_str}\${${JSON.stringify(s.value)}}\\n\`));`);
    out.push(`        ${unwrap_result}(out.write_fmt("\\n"));`, "      }", "    }");
  }
  out.push("  }");
  // reduce / increase / adjust max width
  out.push("", "  /// Reduces the maximum width of the configuration.", "  ///");
  out.push("  /// This method is intended to be used when creating a forked", "  /// configuration for a particular formatting context in which the");
  out.push("  /// total available width needs to be reduced. This reduces the", "  /// size of max_width, and all other properties affected by small");
  out.push("  /// heuristics, without treating those adjustments as overrides.", "  ///", "  /// As an example use case, this method is used when formatting");
  out.push("  /// arms within a declarative macro.", `  ${L("reduce_max_width")}`, "  reduce_max_width(delta: number): void {");
  out.push("    this.adjust_max_width(-Math.min(delta, ISIZE_MAX));", "  }");
  out.push("", "  /// Increases the maximum width of the configuration.", "  ///");
  out.push("  /// This method is intended to be used when creating a forked", "  /// configuration for a particular formatting context in which the");
  out.push("  /// total available width needs to be increased. This increases the", "  /// size of max_width, and all other properties affected by small");
  out.push("  /// heuristics, without treating those adjustments as overrides.", "  ///", "  /// As an example use case, this method is used when formatting");
  out.push("  /// arms within a declarative macro.", `  ${L("increase_max_width")}`, "  increase_max_width(delta: number): void {");
  out.push("    this.adjust_max_width(Math.min(delta, ISIZE_MAX));", "  }");
  out.push("", "  /// Adjusts the maximum width of the configuration.", "  ///");
  out.push("  /// This method is intended to be used when creating a forked", "  /// configuration for a particular formatting context in which the");
  out.push("  /// total available width needs to be reduced. This adjusts the", "  /// size of max_width, and all other properties affected by small");
  out.push("  /// heuristics, without treating those adjustments as overrides.", "  ///", "  /// As an example use case, this method is used when formatting");
  out.push("  /// arms within a declarative macro.", `  ${L("adjust_max_width")}`, "  adjust_max_width(delta: number): void {");
  out.push("    // NB: we need to either saturate or report an error (or some kind of testable");
  out.push("    // warning). I picked to saturate here.");
  out.push("    const adjust = (value: number): number => usize_saturating_add_signed(value, delta);", "");
  for (const n of ["array_width", "attr_fn_like_width", "chain_width", "fn_call_width", "single_line_if_else_max_width", "single_line_let_else_max_width", "struct_lit_width", "struct_variant_width"])
    out.push(`    this.${n}_[2] = adjust(this.${n}_[2]);`);
  out.push("", "    this.max_width_[2] = adjust(this.max_width_[2]);", "    this.set_heuristics();", "  }");
  // set_width_heuristics
  const WH = use("./options.gen.ts", "WidthHeuristics");
  const write_stderr = use("../../std/io.ts", "write_stderr");
  out.push("", `  ${L("set_width_heuristics")}`, `  set_width_heuristics(heuristics: ${WH}): void {`, "    const max_width = this.max_width_[2];");
  out.push("    const get_width_value = (was_set: boolean, override_value: number, heuristic_value: number, config_key: string): number => {");
  out.push("      if (!was_set) {", "        return heuristic_value;", "      }", "      if (override_value > max_width) {");
  out.push(`        ${write_stderr}(\`\\\`\${config_key}\\\` cannot have a value that exceeds \\\`max_width\\\`. \\\`\${config_key}\\\` will be set to the same value as \\\`max_width\\\`\\n\`);`);
  out.push("        return max_width;", "      }", "      return override_value;", "    };");
  for (const n of ["fn_call_width", "attr_fn_like_width", "struct_lit_width", "struct_variant_width", "array_width", "chain_width", "single_line_if_else_max_width", "single_line_let_else_max_width"]) {
    out.push("", `    const ${n} = get_width_value(this.was_set().${n}(), this.${n}_[2], heuristics.${n}, ${JSON.stringify(n)});`, `    this.${n}_[2] = ${n};`);
  }
  out.push("  }");
  // set_heuristics
  out.push("", `  ${L("set_heuristics")}`, "  set_heuristics(): void {", "    const max_width = this.max_width_[2];", "    switch (this.use_small_heuristics_[2]) {");
  out.push(`      case "Default":`, `        this.set_width_heuristics(${WH}.scaled(max_width));`, "        break;");
  out.push(`      case "Max":`, `        this.set_width_heuristics(${WH}.set(max_width));`, "        break;");
  out.push(`      case "Off":`, `        this.set_width_heuristics(${WH}.null());`, "        break;", "    }", "  }");
  // set_ignore
  out.push("", `  ${L("set_ignore")}`, "  set_ignore(dir: string): void {", "    this.ignore_[2].add_prefix(dir);", "  }");
  // set_merge_imports
  out.push("", `  ${L("set_merge_imports")}`, "  set_merge_imports(): void {", "    if (this.was_set().merge_imports()) {");
  out.push(`      ${write_stderr}('Warning: the \`merge_imports\` option is deprecated. Use \`imports_granularity="Crate"\` instead\\n');`);
  out.push("      if (!this.was_set().imports_granularity()) {", `        this.imports_granularity_[2] = this.merge_imports() ? "Crate" : "Preserve";`, "      }", "    }", "  }");
  // set_fn_args_layout
  out.push("", `  ${L("set_fn_args_layout")}`, "  set_fn_args_layout(): void {", "    if (this.was_set().fn_args_layout()) {");
  out.push(`      ${write_stderr}("Warning: the \`fn_args_layout\` option is deprecated. Use \`fn_params_layout\`. instead\\n");`);
  out.push("      if (!this.was_set().fn_params_layout()) {", "        this.fn_params_layout_[2] = this.fn_args_layout();", "      }", "    }", "  }");
  // set_hide_parse_errors
  out.push("", `  ${L("set_hide_parse_errors")}`, "  set_hide_parse_errors(): void {", "    if (this.was_set().hide_parse_errors()) {");
  out.push(`      ${write_stderr}("Warning: the \`hide_parse_errors\` option is deprecated. Use \`show_parse_errors\` instead\\n");`);
  out.push("      if (!this.was_set().show_parse_errors()) {", "        this.show_parse_errors_[2] = this.hide_parse_errors();", "      }", "    }", "  }");
  // set_version
  out.push("", `  ${L("set_version")}`, "  set_version(): void {", "    if (!this.was_set().version()) {", "      return;", "    }", "");
  out.push(`    let __v: string;`, "    switch (this.version_[2]) {", `      case "One":`, `        __v = "2015";`, "        break;", `      case "Two":`, `        __v = "2024";`, "        break;", "    }");
  out.push(`    ${write_stderr}(\`Warning: the \\\`version\\\` option is deprecated. Use \\\`style_edition="\${__v}"\\\` instead.\\n\`);`, "");
  out.push("    if (this.was_set().style_edition() || this.was_set_cli().style_edition()) {");
  out.push(
    `      ${write_stderr}("Warning: the deprecated \`version\` option was used in conjunction with the \`style_edition\` option which takes precedence. The value of the \`version\` option will be ignored.\\n");`,
  );
  out.push("    }", "  }");
  // is_default
  out.push("", "  /// Returns `true` if the config key was explicitly set and is the default value.", `  ${L("is_default")}`, "  is_default(key: string): boolean {");
  out.push(`    const style_edition: ${SE} = "Edition2015";`);
  for (const o of os) {
    out.push("    {", `      const default_value = ${o.ty}.style_edition_default(style_edition);`, `      if (${JSON.stringify(o.name)} === key) {`);
    out.push(`        return this.${field(o)}[1] && ${ty(o).eq(`this.${field(o)}[2]`, "default_value")};`, "      }", "    }");
  }
  out.push("    return false;", "  }", "}");
  // clone_Config (#[derive(Clone)])
  out.push("", "/** `#[derive(Clone)]` of `Config` */", "export function clone_Config(v: Config): Config {", "  return new Config(");
  for (const o of os) out.push(`    [v.${field(o)}[0], v.${field(o)}[1], ${ty(o).clone(`v.${field(o)}[2]`)}, v.${field(o)}[3], v.${field(o)}[4]],`);
  out.push("  );", "}");
  // impl Default for Config
  out.push("", "// Template for the default configuration", `${L("default")}`, "export function default_Config(): Config {", `  return Config.default_with_style_edition("Edition2015");`, "}");

  // PartialConfig
  out.push("", "// Just like the Config struct but with each property wrapped", "// as Option<T>. This is used to parse a rustfmt.toml that doesn't");
  out.push("// specify all properties of `Config`.", "// We first parse into `PartialConfig`, then create a default `Config`");
  out.push("// and overwrite the properties with corresponding values from `PartialConfig`.", "/** `#[derive(Deserialize, Serialize, Clone)]` */");
  out.push("export interface PartialConfig {");
  for (const o of os) out.push(`  ${o.name}: ${ty(o).ts} | undefined;`);
  out.push("}", "export function clone_PartialConfig(v: PartialConfig): PartialConfig {", "  return {");
  for (const o of os) out.push(`    ${o.name}: v.${o.name} === undefined ? undefined : ${ty(o).clone(`v.${o.name}`)},`);
  out.push("  };", "}");
  const pc = partialConfigItem(input);
  const pcAt = `${MOD_RS}:${input.invokedAt}`;
  const byQ = new Map(os.map((o) => [o.ty, o]));
  const fieldOps = (t: PType): TyOps => {
    const q = t.path!.segments[0]!.args[0]!.ty!;
    return ty(byQ.get(q.qself!.text)!);
  };
  for (const p of SD.serdePlans(pc, pcAt, c.err, (f) => f.name!)) {
    c.serdePlans.set(`${p.trait} ${p.ty}`, p);
    const ctx: SD.SerdeTsCtx = {
      use: (m, n, k) => serdeUse(m, n, k),
      result: (n) => use("../../std/result.ts", n, n === "Result" ? "types" : "values"),
      deFn: (t) => `${serdeUse("de_impls", "deserialize_Option")}<${fieldOps(t).ts}>(${fieldOps(t).de})`,
      serFn: (t) => `${serdeUse("ser_impls", "serialize_Option")}<${fieldOps(t).ts}>(${fieldOps(t).ser})`,
      tsType: (t) => `${fieldOps(t).ts} | undefined`,
      self: "PartialConfig",
      construct: (vals) => `{ ${os.map((o, i) => `${o.name}: ${vals[i]}`).join(", ")} }`,
      read: (v, f) => `${v}.${f.ts}`,
      at: pcAt,
    };
    out.push("", ...SD.renderTs(p, ctx));
  }

  // the four "views": ConfigSetter, CliConfigSetter, ConfigWasSet, CliConfigWasSet
  const setter = (cls: string, cli: boolean, line: number) => {
    out.push("", `export class ${cls} {`, "  constructor(public _0: Config) {}");
    out.push(`  // PORT: generated by create_config! (${CONFIG_TYPE_RS}:${line}) for each option`);
    for (const o of os) {
      out.push(`  ${o.name}(value: ${ty(o).ts}): void {`, `    this._0.${field(o)}[2] = value;`);
      if (cli) out.push(`    this._0.${field(o)}[4] = true;`);
      out.push(`    __set_dependent_options(this._0, ${JSON.stringify(o.name)});`);
      out.push("  }");
    }
    out.push("}");
  };
  const lineOf = (n: number) => n;
  out.push("", "// Macro hygiene won't allow us to make `set_$i()` methods on Config", "// for each item, so this struct is used to give the API to set values:");
  out.push("// `config.set().option(false)`. It's pretty ugly. Consider replacing", "// with `config.set_option(false)` if we ever get a stable/usable", "// `concat_idents!()`.");
  setter("ConfigSetter", false, lineOf(120));
  setter("CliConfigSetter", true, lineOf(149));
  const wasSet = (cls: string, slot: number, line: number, comment: string[]) => {
    out.push("", ...comment, `export class ${cls} {`, "  constructor(public _0: Config) {}", `  // PORT: generated by create_config! (${CONFIG_TYPE_RS}:${line}) for each option`);
    for (const o of os) out.push(`  ${o.name}(): boolean {`, `    return this._0.${field(o)}[${slot}];`, "  }");
    out.push("}");
  };
  wasSet("ConfigWasSet", 1, 181, ["// Query each option, returns true if the user set the option, false if", "// a default was used."]);
  wasSet("CliConfigWasSet", 4, 195, ["// Query each option, returns true if the user set the option via a CLI flag,", "// false if a default was used."]);

  // the shared match
  out.push("", `// The \`match stringify!($i) { .. }\` ending every setter (${CONFIG_TYPE_RS}:122, :152) and the second \`match key { .. }\` of`);
  out.push("// `override_value` (:352): the same match in every expansion. PORT: one module-local function, not a copy per option and setter.");
  out.push(...heuristicsMatchFn());

  // helpers
  out.push("", "// ---- module-local helpers (std pieces src/std does not have yet) ----");
  out.push("/** `isize::MAX` as a usize (only compared with config widths, far below 2^53). */", "const ISIZE_MAX = 2 ** 63 - 1;");
  out.push("/** `usize::saturating_add_signed` on config widths: never below 0; a result past 2^53 cannot be represented exactly, so it is not guessed. */");
  out.push("function usize_saturating_add_signed(value: number, delta: number): number {", "  const r = value + delta;");
  out.push(`  if (r > Number.MAX_SAFE_INTEGER) return ${use("../../std/panic.ts", "unported")}("usize::saturating_add_signed past 2^53 (Config::adjust_max_width)");`);
  out.push("  return r < 0 ? 0 : r;", "}");
  out.push("/** `dyn std::io::Write` as `print_docs` uses it: `writeln!(out, ..)` is `out.write_fmt(<text>)` (std::io::Write::write_fmt). */");
  out.push(`export interface Write {`, `  write_fmt(text: string): ${use("../../std/io.ts", "IoResult", "types")}<null>;`, "}");
  out.push("/** `impl FromStr for bool` (core::str::traits): only `true` and `false`. */", `function __bool_from_str(s: string): ${R}<boolean, null> {`);
  out.push(`  if (s === "true") return ${use("../../std/result.ts", "Ok")}(true);`, `  if (s === "false") return ${use("../../std/result.ts", "Ok")}(false);`);
  out.push(`  return ${use("../../std/result.ts", "Err")}(null);`, "}");
  out.push('/** `#[derive(Debug)] pub struct ParseBoolError;` (core::str::error) */', 'const __debug_ParseBoolError = (_e: null): string => "ParseBoolError";');
  out.push(`/** \`#[derive(Debug)] pub struct ParseIntError { kind: IntErrorKind }\` (core::num::error) */`);
  out.push(
    `const __debug_ParseIntError = (e: ${use("../../std/num.ts", "ParseIntError", "types")}, f: ${use("../../std/fmt.ts", "Fmt", "types")}): string => ${use("../../std/fmt.ts", "debug_struct")}(f, "ParseIntError", [["kind", e.kind]]);`,
  );
  out.push("/** `Infallible` has no values. */", `const __debug_Infallible = (_e: never): string => ${use("../../std/panic.ts", "unreachable")}();`);

  // header and imports
  const head = [
    `// GENERATED by tools/codegen/rustfmt.ts (tools/codegen/create_config.ts) from ${CONFIG_TYPE_RS} (create_config!) at ${MOD_RS}:${input.invokedAt},`,
    `// with the option types and defaults of ${OPTIONS_RS}:${input.defaultsAt} (config_option_with_style_edition_default!)${c.pin ? ` @ ${c.pin}` : ""}. Do not edit.`,
    "// Generated items of the other config files are imported from their .gen.ts (types and derived fns only); hand-written",
    "// impls from the hand modules (src/rustfmt/contract.gen.d.ts lists what they must export while they do not exist).",
  ];
  const lines: string[] = [];
  for (const m of [...imports.keys()].sort()) {
    const names = [...imports.get(m)!.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const allTypes = names.every(([, k]) => k === "types");
    lines.push(`import ${allTypes ? "type " : ""}{ ${names.map(([n, k]) => (k === "types" && !allTypes ? `type ${n}` : n)).join(", ")} } from "${m}";`);
  }
  return [...head, ...lines, "", ...out, ""].join("\n");
}

/**
 * The `match stringify!($i) { .. }` of the setters (config_type.rs:122, :152) and the second `match key { .. }` of `override_value`
 * (:352): the same match in every expansion. PORT: one module-local function instead of a copy per option and setter.
 */
function heuristicsMatchFn(): string[] {
  const H = ["max_width", "use_small_heuristics", "fn_call_width", "single_line_if_else_max_width", "single_line_let_else_max_width", "attr_fn_like_width", "struct_lit_width", "struct_variant_width", "array_width", "chain_width"];
  return [
    "function __set_dependent_options(config: Config, key: string): void {",
    "  switch (key) {",
    ...H.map((h) => `    case ${JSON.stringify(h)}:`),
    "      config.set_heuristics();",
    "      break;",
    '    case "merge_imports":',
    "      config.set_merge_imports();",
    "      break;",
    '    case "fn_args_layout":',
    "      config.set_fn_args_layout();",
    "      break;",
    '    case "hide_parse_errors":',
    "      config.set_hide_parse_errors();",
    "      break;",
    '    case "version":',
    "      config.set_version();",
    "      break;",
    "    default:",
    "      break;",
    "  }",
    "}",
  ];
}
