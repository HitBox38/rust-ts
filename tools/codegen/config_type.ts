// `#[config_type]`: the expansion of rustfmt's `config_proc_macro` (src/tools/rustfmt/config_proc_macro/src, out of scope as a
// crate: harness/scope.json tools.excluded; plan-m8 D5) for the enums rustfmt marks with it. A port of item_enum.rs
// `define_config_type_on_enum` and attrs.rs; `item_struct.rs` is `unimplemented!()` upstream, so a struct is an ERROR here too.
//
// The macro replaces the enum by `mod __define_config_type_on_enum_X { #[derive(Debug, Copy, Clone, Eq, PartialEq)] pub enum X
// { .. } impl Display, ConfigType, FromStr, Serialize, Deserialize } pub use ..::X;`. The enum itself (and its derives) goes through
// tools/codegen/types.ts like any other type (`configTypeItem` rewrites the probed item into what the macro emits); the five impls
// come from here. As for serde (tools/codegen/serde.ts), a plan is rendered twice: `renderRust` (compared with the oracle's
// `-Zunpretty=expanded`, tools/codegen/rustfmt_oracle.ts) and `renderTs`.
import { debug_str } from "../../src/std/fmt.ts";
import type { PAttr, PItem, PVariant } from "./types.ts";

export interface ConfigTypeVariant {
  name: string;
  /** `#[value = ".."]` or the variant's name (item_enum.rs `config_value_of_variant`) */
  value: string;
  /** `#[doc_hint = ".."]` or the name, `" (unstable)"` appended for unstable variants (`doc_hint_of_variant`) */
  doc_hint: string;
  /** `#[unstable_variant]` (`unstable_of_variant`) */
  unstable: boolean;
  /** the variant's doc comments (kept by `process_variant`, which drops only the three config attributes) */
  docs: string[];
  style: "unit" | "unnamed" | "named";
  /** the field types of a tuple variant, as Rust text (`process_variant` re-emits `#fields`) */
  fields: string[];
}
export interface ConfigTypePlan {
  ty: string;
  vis: string;
  variants: ConfigTypeVariant[];
}

export const isConfigTypeAttr = (a: PAttr): boolean => a.path === "config_type" || a.path.endsWith("::config_type");

/** attrs.rs `is_doc_hint` / `is_config_value` / `is_unstable_variant`: the attributes `process_variant` removes. */
const isConfigAttr = (a: PAttr): boolean =>
  (a.path === "doc_hint" && a.value !== undefined) || (a.path === "value" && a.value !== undefined) || (a.path === "unstable_variant" && a.value === undefined && !a.tokens);

/** The plan of a `#[config_type]` item (item_enum.rs, attrs.rs). */
export function configTypePlan(item: PItem, at: string, err: (m: string) => void): ConfigTypePlan | undefined {
  if (item.kind === "struct") {
    // config_type.rs `define_config_type` -> item_struct.rs `define_config_type_on_struct`: `unimplemented!()`
    err(`${at}: #[config_type] on a struct (config_proc_macro item_struct.rs is unimplemented!())`);
    return undefined;
  }
  if (item.kind !== "enum") {
    err(`${at}: #[config_type] on a ${item.kind} ("Expected enum or struct")`);
    return undefined;
  }
  if (item.generics.params.length) err(`${at}: #[config_type] on a generic enum is not implemented`);
  const variants = item.variants!.map((v: PVariant): ConfigTypeVariant => {
    // attrs.rs `find_config_value` / `find_doc_hint`: the first such attribute
    const value = v.attrs.find((a) => a.path === "value" && a.value !== undefined)?.value ?? v.name;
    const unstable = v.attrs.some((a) => a.path === "unstable_variant" && a.value === undefined);
    let doc_hint = v.attrs.find((a) => a.path === "doc_hint" && a.value !== undefined)?.value ?? v.name;
    if (unstable) doc_hint += " (unstable)";
    for (const a of v.attrs) if (!isConfigAttr(a)) err(`${at}: variant ${v.name} keeps attribute #[${a.text}] (only docs are implemented)`);
    return { name: v.name, value, doc_hint, unstable, docs: v.docs, style: v.fields.style, fields: v.fields.fields.map((f) => f.ty.text) };
  });
  // item_enum.rs `impl_serde` writes a named variant's pattern as `#ident::v_ident{..}` (a literal `v_ident`), which does not
  // compile upstream: no such variant can exist at the pin, so it is refused rather than rendered.
  for (const v of variants) if (v.style === "named") err(`${at}: #[config_type] variant ${v.name} has named fields (impl_serde cannot expand it)`);
  return { ty: item.name, vis: item.vis, variants };
}

/** What the macro's `pub enum` is to types.ts: the item with `#[derive(Debug, Copy, Clone, Eq, PartialEq)]` and without the config attributes. */
export function configTypeItem(item: PItem): PItem {
  const derive: PAttr = { path: "derive", text: "derive (Debug, Copy, Clone, Eq, PartialEq)", derives: ["Debug", "Copy", "Clone", "Eq", "PartialEq"] };
  return {
    ...item,
    // the macro drops the enum's own attributes (and docs): `pub #enum_token #ident #generics { #variants }`
    attrs: [derive],
    docs: [],
    variants: item.variants!.map((v) => ({ ...v, attrs: v.attrs.filter((a) => !isConfigAttr(a)) })),
  };
}

// ---- the Rust rendering (what config_proc_macro emits, after rustc's own derives and format macros are expanded) -------------

const lit = (s: string) => debug_str(s);

/**
 * item_enum.rs `define_config_type_on_enum`'s output, as `-Zunpretty=expanded` prints it, without the derived impls of the
 * `#[derive(..)]` (compared with tools/codegen/rustfmt_oracle.ts `stripDerived` of the oracle's block). Nested macros are shown
 * expanded as rustc expands them: `write!(f, "{}", s)` -> `f.write_fmt(format_args!("{0}", s))`, `unimplemented!()` ->
 * `::core::panicking::panic("not implemented")`, `format!(..)` -> `::alloc::__export::must_use({ ::alloc::fmt::format(..) })`.
 */
export function renderRust(p: ConfigTypePlan): string {
  const X = p.ty;
  const units = p.variants.filter((v) => v.style === "unit");
  const variants = p.variants.map((v) => `${v.docs.map((d) => `#[doc = ${lit(d)}]`).join(" ")} ${v.name}${v.style === "unnamed" ? `(${v.fields.join(", ")})` : ""},`).join("\n");
  // item_enum.rs `fields_in_variant`: the pattern that ignores a variant's fields
  const pat = (v: ConfigTypeVariant) => `${X}::${v.name}${v.style === "unnamed" ? "(..)" : ""}`;
  const docHint = `[${p.variants.map((v) => v.doc_hint).join("|")}]`;
  const errMsg = `Bad variant, expected one of:${units.map((v) => ` \`${v.name}\``).join("")}`;
  const ifs = units.map((v) => `if ${lit(v.value)}.eq_ignore_ascii_case(s) { return Ok(${X}::${v.name}); }`).join("\n");
  return `#[allow(non_snake_case)]
mod __define_config_type_on_enum_${X} {
  pub enum ${X} { ${variants} }
  use std::fmt;
  impl fmt::Display for ${X} {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
      match self {
        ${units.map((v) => `${X}::${v.name} => f.write_fmt(format_args!("{0}", ${lit(v.value)})),`).join("\n")}
        _ => ::core::panicking::panic("not implemented"),
      }
    }
  }
  use crate::config::ConfigType;
  impl ConfigType for ${X} {
    fn doc_hint() -> String { ${lit(docHint)}.to_owned() }
    fn stable_variant(&self) -> bool { match self { ${p.variants.map((v) => `${pat(v)} => ${!v.unstable},`).join(" ")} } }
  }
  impl ::std::str::FromStr for ${X} {
    type Err = &'static str;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
      ${ifs}
      return Err(${lit(errMsg)});
    }
  }
  impl ::serde::ser::Serialize for ${X} {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: ::serde::ser::Serializer {
      use serde::ser::Error;
      match self {
        ${p.variants.map((v) => `${pat(v)} => serializer.serialize_str(&${lit(v.value)}),`).join("\n")}
        _ => Err(S::Error::custom(::alloc::__export::must_use({ ::alloc::fmt::format(format_args!("Cannot serialize {0:?}", self)) }))),
      }
    }
  }
  impl<'de> serde::de::Deserialize<'de> for ${X} {
    fn deserialize<D>(d: D) -> Result<Self, D::Error> where D: serde::Deserializer<'de> {
      use serde::de::{Error, Visitor};
      use std::marker::PhantomData;
      use std::fmt;
      struct StringOnly<T>(PhantomData<T>);
      impl<'de, T> Visitor<'de> for StringOnly<T> where T: serde::Deserializer<'de> {
        type Value = String;
        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str("string") }
        fn visit_str<E>(self, value: &str) -> Result<String, E> { Ok(String::from(value)) }
      }
      let s = &d.deserialize_string(StringOnly::<D>(PhantomData))?;
      ${ifs}
      static ALLOWED: &'static [&str] = &[${units.map((v) => lit(v.value)).join(", ")}];
      Err(D::Error::unknown_variant(&s, ALLOWED))
    }
  }
}
${p.vis === "pub" ? "pub " : p.vis ? `${p.vis} ` : ""}use __define_config_type_on_enum_${X}::${X};`;
}

// ---- the TS rendering -------------------------------------------------------------------------

/** What `renderTs` needs from types.ts. */
export interface ConfigTypeTsCtx {
  /** imports `name` (a value, or a type with `kind` "types") from a src-relative module and returns the local name */
  use(module: string, name: string, kind?: "types" | "values"): string;
  /** the serde surface (tools/codegen/serde.ts SERDE_MODULES keys) */
  serde(module: "de" | "ser", name: string, kind?: "types" | "values"): string;
  /** the src-relative module that defines `trait ConfigType` (the hand port of config/config_type.rs) */
  configTypeModule: string;
  /** `upstream:line` of the enum */
  at: string;
  error(m: string): void;
}

const IE = "src/tools/rustfmt/config_proc_macro/src/item_enum.rs";

/**
 * The TS of a variant as a value and the switch subject: a fieldless enum is a string-literal union, an enum with a tuple variant
 * (`ListTactic::LimitedHorizontalVertical(usize)`) is a `$`-tagged union whose unit variants are the companion's singletons (PORTING §5).
 */
function tsRepr(p: ConfigTypePlan): { subject: string; value: (v: ConfigTypeVariant) => string } {
  const data = p.variants.some((v) => v.style !== "unit");
  return data ? { subject: "self.$", value: (v) => `${p.ty}.${v.name}` } : { subject: "self", value: (v) => JSON.stringify(v.name) };
}

/** The TS of the five impls (Display, ConfigType, Serialize, Deserialize as functions; FromStr is `companionMembers`). */
export function renderTs(p: ConfigTypePlan, c: ConfigTypeTsCtx): string[] {
  const X = p.ty;
  const units = p.variants.filter((v) => v.style === "unit");
  const { subject, value } = tsRepr(p);
  const R = c.use("std/result.ts", "Result", "types");
  const Ok = c.use("std/result.ts", "Ok");
  const Err = c.use("std/result.ts", "Err");
  const panic = c.use("std/panic.ts", "panic");
  const out: string[] = [];
  out.push(`// rustc-derive: ${c.at} #[config_type] fmt::Display for ${X} (${IE}:99 impl_display)`);
  out.push(`export function display_${X}(self: ${X}): string {`, `  switch (${subject}) {`);
  for (const v of units) out.push(`    case ${JSON.stringify(v.name)}:`, `      return ${JSON.stringify(v.value)};`);
  out.push("    default:", `      return ${panic}("not implemented");`, "  }", "}");

  const ConfigType = c.use(c.configTypeModule, "ConfigType", "types");
  const docHint = `[${p.variants.map((v) => v.doc_hint).join("|")}]`;
  out.push(`// rustc-derive: ${c.at} #[config_type] ConfigType for ${X} (${IE}:68 impl_doc_hint)`);
  out.push(`export const config_type_${X}: ${ConfigType}<${X}> = {`);
  out.push("  doc_hint(): string {", `    return ${JSON.stringify(docHint)};`, "  },");
  out.push(`  stable_variant(self: ${X}): boolean {`, `    switch (${subject}) {`);
  for (const v of p.variants) out.push(`      case ${JSON.stringify(v.name)}:`, `        return ${!v.unstable};`);
  out.push("    }", "  },", "};");

  const Serializer = c.serde("ser", "Serializer", "types");
  const debug = `debug_${X}`;
  const PLAIN = c.use("std/fmt.ts", "PLAIN");
  out.push(`// rustc-derive: ${c.at} #[config_type] Serialize for ${X} (${IE}:167 impl_serde)`);
  out.push(`export function serialize_${X}<__O, __E>(self: ${X}, serializer: ${Serializer}<__O, __E>): ${R}<__O, __E> {`, `  switch (${subject}) {`);
  for (const v of p.variants) out.push(`    case ${JSON.stringify(v.name)}:`, `      return serializer.serialize_str(${JSON.stringify(v.value)});`);
  out.push("    default:", `      return ${Err}(serializer.Error.custom(\`Cannot serialize \${${debug}(self, ${PLAIN})}\`));`, "  }", "}");

  if (p.variants.some((v) => v.style !== "unit")) {
    // the macro's `#[derive(PartialEq)]` on an enum with a tuple variant (`===` serves the string-literal unions)
    out.push(`// rustc-derive: ${c.at} #[config_type] #[derive(PartialEq)] for ${X} (${IE}:11 define_config_type_on_enum)`);
    out.push(`export function ${X}_eq(self: ${X}, other: ${X}): boolean {`, "  if (self.$ !== other.$) return false;");
    for (const v of p.variants.filter((x) => x.style === "unnamed")) {
      for (const f of v.fields) if (!["usize", "isize", "u32", "bool", "String"].includes(f)) c.error(`${c.at}: #[config_type] PartialEq of a ${f} field is not implemented`);
      const cmp = v.fields.map((_, i) => `self._${i} === other._${i}`).join(" && ");
      out.push(`  if (self.$ === ${JSON.stringify(v.name)} && other.$ === ${JSON.stringify(v.name)}) return ${cmp};`);
    }
    out.push("  return true;", "}");
  }

  const Deserializer = c.serde("de", "Deserializer", "types");
  const Visitor = c.serde("de", "Visitor", "types");
  out.push(`// rustc-derive: ${c.at} #[config_type] Deserialize for ${X} (${IE}:198 impl_deserialize)`);
  out.push(`export function deserialize_${X}<__E>(d: ${Deserializer}<__E>): ${R}<${X}, __E> {`);
  out.push(`  const StringOnly: ${Visitor}<string> = {`);
  out.push("    expecting(): string {", `      return "string";`, "    },");
  out.push(`    visit_str<E>(value: string): ${R}<string, E> {`, `      return ${Ok}(value);`, "    },", "  };");
  out.push("  const __s = d.deserialize_string(StringOnly);", `  if (__s.$ === "Err") return __s;`, "  const s = __s._0;");
  for (const v of units) out.push(`  if (__eq_ignore_ascii_case(${JSON.stringify(v.value)}, s)) return ${Ok}(${value(v)});`);
  out.push(`  const ALLOWED: readonly string[] = [${units.map((v) => JSON.stringify(v.value)).join(", ")}];`);
  out.push(`  return ${Err}(d.Error.unknown_variant(s, ALLOWED));`, "}");
  return out;
}

/** `impl FromStr` (item_enum.rs:122 `impl_from_str`), a member of the enum's companion const (PORTING §8). */
export function companionMembers(p: ConfigTypePlan, c: ConfigTypeTsCtx): string[] {
  const X = p.ty;
  const units = p.variants.filter((v) => v.style === "unit");
  const { value } = tsRepr(p);
  const R = c.use("std/result.ts", "Result", "types");
  const Ok = c.use("std/result.ts", "Ok");
  const Err = c.use("std/result.ts", "Err");
  const errMsg = `Bad variant, expected one of:${units.map((v) => ` \`${v.name}\``).join("")}`;
  const out: string[] = [];
  out.push(`  // rustc-derive: ${c.at} #[config_type] FromStr for ${X} (${IE}:122 impl_from_str)`);
  out.push(`  from_str(s: string): ${R}<${X}, string> {`);
  for (const v of units) out.push(`    if (__eq_ignore_ascii_case(${JSON.stringify(v.value)}, s)) return ${Ok}(${value(v)});`);
  out.push(`    return ${Err}(${JSON.stringify(errMsg)});`, "  },");
  return out;
}

/** The module-local `str::eq_ignore_ascii_case` the FromStr / Deserialize impls use (emitted once per file that needs it). */
export const EQ_IGNORE_ASCII_CASE_HELPER = [
  "/** `str::eq_ignore_ascii_case` (core): equal lengths and bytes equal after ASCII lowercasing. */",
  "function __eq_ignore_ascii_case(a: string, b: string): boolean {",
  "  const x = new TextEncoder().encode(a);",
  "  const y = new TextEncoder().encode(b);",
  "  if (x.length !== y.length) return false;",
  "  const lower = (c: number) => (c >= 0x41 && c <= 0x5a ? c + 0x20 : c);",
  "  for (let i = 0; i < x.length; i++) if (lower(x[i]!) !== lower(y[i]!)) return false;",
  "  return true;",
  "}",
];
