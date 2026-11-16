// derive(Serialize) / derive(Deserialize): a port of serde_derive 1.0.228 (the version upstream's root Cargo.lock pins, plan-m8
// D6) restricted to the shapes rustfmt's config and JSON types use at the pin. clippy_config derives no serde trait at the pin
// (its `-Zunpretty=expanded` has no serde impl; its `de.rs` is its own `Deserialize` trait, ported by hand).
//
// Each derive is first turned into a plan (`serdePlans`): the container shape, the fields and their serialized names. From the
// plan come two renderings:
// - `renderRust`: what serde_derive emits for it, as Rust text. tools/codegen/rustfmt_oracle.ts compares it, token for token, with
//   the oracle's `-Zunpretty=expanded` of rustfmt, so the plan is checked to be exactly serde_derive's (D6's check);
// - `renderTs`: the TS port of that same expansion, against the `serde::de` / `serde::ser` surface that the vendor-serde-de lane
//   ports (see `SERDE_SURFACE` and docs/handoff/codegen-fmt-serde.md for the conventions).
//
// Supported: structs with named fields (Deserialize, Serialize), newtype structs (both), enums with unit and newtype variants
// (Serialize). Any `#[serde(..)]` attribute, generics, or another shape is an ERROR: never guessed.
import type { PField, PItem, PType } from "./types.ts";

// ---- plans ---------------------------------------------------------------------------------

export interface SerdeField {
  /** the Rust member (`fn_call_width`) */
  member: string;
  /** the serialized name (`cattrs`/`#[serde(rename)]` are refused, so it is the member) */
  name: string;
  ty: PType;
  /** the TS property of the field (`types.ts` `fieldName`) */
  ts: string;
}
export type DePlan =
  | { trait: "Deserialize"; shape: "struct"; ty: string; fields: SerdeField[] }
  | { trait: "Deserialize"; shape: "newtype"; ty: string; field: SerdeField };
export type SerPlan =
  | { trait: "Serialize"; shape: "struct"; ty: string; fields: SerdeField[] }
  | { trait: "Serialize"; shape: "newtype"; ty: string; field: SerdeField }
  | { trait: "Serialize"; shape: "enum"; ty: string; variants: { name: string; index: number; field?: SerdeField }[] };
export type SerdePlan = DePlan | SerPlan;

export const SERDE_DERIVES = ["Serialize", "Deserialize"] as const;

/** The serde derives of `item`, in `#[derive(..)]` order (the order serde_derive's impls appear in the expansion). */
export function serdeDerivesOf(item: PItem): ("Serialize" | "Deserialize")[] {
  const out: ("Serialize" | "Deserialize")[] = [];
  for (const a of item.attrs)
    for (const d of a.derives ?? []) {
      const n = d.split("::").pop()!.trim();
      if (n === "Serialize" || n === "Deserialize") out.push(n);
    }
  return out;
}

/**
 * The plans of `item`'s serde derives (serde_derive internals/ast.rs `Container::from_ast` + the shape checks of de.rs / ser.rs),
 * or errors through `err`. `fieldTs` maps a field to its TS property name.
 */
export function serdePlans(item: PItem, at: string, err: (m: string) => void, fieldTs: (f: PField) => string): SerdePlan[] {
  const derives = serdeDerivesOf(item);
  if (!derives.length) return [];
  const serdeAttr = (attrs: { path: string }[], where: string) => {
    for (const a of attrs) if (a.path === "serde") err(`${where}: #[serde(..)] attributes are not implemented by tools/codegen/serde.ts`);
  };
  serdeAttr(item.attrs, at);
  if (item.generics.params.length) err(`${at}: derive(${derives.join(", ")}) on a generic type is not implemented`);
  for (const f of item.fields?.fields ?? []) serdeAttr(f.attrs, `${at} field ${f.name ?? f.index}`);
  const field = (f: PField, i: number): SerdeField => ({ member: f.name ?? String(i), name: f.name ?? String(i), ty: f.ty, ts: fieldTs(f) });
  const plans: SerdePlan[] = [];
  for (const d of derives) {
    if (item.kind === "struct") {
      const fs = item.fields!;
      if (fs.style === "named") plans.push({ trait: d, shape: "struct", ty: item.name, fields: fs.fields.map(field) });
      else if (fs.style === "unnamed" && fs.fields.length === 1) plans.push({ trait: d, shape: "newtype", ty: item.name, field: field(fs.fields[0]!, 0) });
      else err(`${at}: derive(${d}) on a ${fs.style === "unit" ? "unit" : "tuple"} struct is not implemented`);
    } else if (item.kind === "enum" && d === "Serialize") {
      const vs: { name: string; index: number; field?: SerdeField }[] = [];
      item.variants!.forEach((v, index) => {
        serdeAttr(v.attrs, `${at} variant ${v.name}`);
        for (const f of v.fields.fields) serdeAttr(f.attrs, `${at} variant ${v.name} field ${f.name ?? f.index}`);
        if (v.fields.style === "unit") vs.push({ name: v.name, index });
        else if (v.fields.style === "unnamed" && v.fields.fields.length === 1) vs.push({ name: v.name, index, field: field(v.fields.fields[0]!, 0) });
        else err(`${at}: derive(Serialize) of ${v.fields.style} variant ${v.name} is not implemented`);
      });
      plans.push({ trait: d, shape: "enum", ty: item.name, variants: vs });
    } else err(`${at}: derive(${d}) on a ${item.kind} is not implemented`);
  }
  return plans;
}

// ---- the Rust rendering (what serde_derive emits; checked against the oracle) ---------------

const P = "_serde :: __private228";

/** `ty` as Rust tokens (the probe's `text`; layout is irrelevant to the token comparison). */
const rty = (ty: PType): string => ty.text;

/** serde_derive's `const _: () = { .. };` wrapper (dummy.rs `wrap_in_const`) around `impl`. */
function wrapInConst(impl: string): string {
  return `#[doc(hidden)]
#[allow(non_upper_case_globals, unused_attributes, unused_qualifications, clippy :: absolute_paths,)]
const _: () = {
  #[allow(unused_extern_crates, clippy :: useless_attribute)]
  extern crate serde as _serde;
  ;
  #[automatically_derived]
  ${impl}
};`;
}

/** de/identifier.rs `deserialize_generated` + `deserialize_identifier` for a struct's fields (no `#[serde(deny_unknown_fields)]`). */
function rustFieldVisitor(fields: SerdeField[]): string {
  const idx = fields.map((_, i) => `__field${i}`);
  return `#[allow(non_camel_case_types)]
#[doc(hidden)]
enum __Field { ${idx.map((f) => `${f},`).join(" ")} __ignore, }
#[doc(hidden)]
struct __FieldVisitor;
#[automatically_derived]
impl<'de> _serde::de::Visitor<'de> for __FieldVisitor {
  type Value = __Field;
  fn expecting(&self, __formatter: &mut ${P}::Formatter) -> ${P}::fmt::Result {
    ${P}::Formatter::write_str(__formatter, "field identifier")
  }
  fn visit_u64<__E>(self, __value: u64) -> ${P}::Result<Self::Value, __E> where __E: _serde::de::Error {
    match __value { ${idx.map((f, i) => `${i}u64 => ${P}::Ok(__Field::${f}),`).join(" ")} _ => ${P}::Ok(__Field::__ignore), }
  }
  fn visit_str<__E>(self, __value: &str) -> ${P}::Result<Self::Value, __E> where __E: _serde::de::Error {
    match __value { ${fields.map((f, i) => `${JSON.stringify(f.name)} => ${P}::Ok(__Field::${idx[i]}),`).join(" ")} _ => { ${P}::Ok(__Field::__ignore) } }
  }
  fn visit_bytes<__E>(self, __value: &[u8]) -> ${P}::Result<Self::Value, __E> where __E: _serde::de::Error {
    match __value { ${fields.map((f, i) => `b${JSON.stringify(f.name)} => ${P}::Ok(__Field::${idx[i]}),`).join(" ")} _ => { ${P}::Ok(__Field::__ignore) } }
  }
}
#[automatically_derived]
impl<'de> _serde::Deserialize<'de> for __Field {
  #[inline]
  fn deserialize<__D>(__deserializer: __D) -> ${P}::Result<Self, __D::Error> where __D: _serde::Deserializer<'de> {
    _serde::Deserializer::deserialize_identifier(__deserializer, __FieldVisitor)
  }
}`;
}

/** de.rs `deserialize_seq` (`let __fieldN = match next_element ..`), the elements of an `expecting` with `n` fields. */
function rustSeqElems(fields: SerdeField[], expecting: string): string {
  const n = fields.length;
  const what = `${expecting} with ${n} element${n === 1 ? "" : "s"}`;
  return fields
    .map(
      (f, i) => `let __field${i} = match _serde::de::SeqAccess::next_element::<${rty(f.ty)}>(&mut __seq)? {
  ${P}::Some(__value) => __value,
  ${P}::None => return ${P}::Err(_serde::de::Error::invalid_length(${i}usize, &${JSON.stringify(what)})),
};`,
    )
    .join("\n");
}

function rustDeserialize(p: DePlan): string {
  const head = `impl<'de> _serde::Deserialize<'de> for ${p.ty} {
  fn deserialize<__D>(__deserializer: __D) -> ${P}::Result<Self, __D::Error> where __D: _serde::Deserializer<'de> {`;
  const visitorStruct = `#[doc(hidden)]
struct __Visitor<'de> { marker: ${P}::PhantomData<${p.ty}>, lifetime: ${P}::PhantomData<&'de ()>, }`;
  const visitorExpr = `__Visitor { marker: ${P}::PhantomData::<${p.ty}>, lifetime: ${P}::PhantomData, }`;
  const expecting = (s: string) => `fn expecting(&self, __formatter: &mut ${P}::Formatter) -> ${P}::fmt::Result {
  ${P}::Formatter::write_str(__formatter, ${JSON.stringify(s)})
}`;
  if (p.shape === "newtype") {
    // de/tuple.rs `deserialize` + `deserialize_newtype_struct`
    const e = `tuple struct ${p.ty}`;
    const t = rty(p.field.ty);
    return `${head}
${visitorStruct}
#[automatically_derived]
impl<'de> _serde::de::Visitor<'de> for __Visitor<'de> {
  type Value = ${p.ty};
  ${expecting(e)}
  #[inline]
  fn visit_newtype_struct<__E>(self, __e: __E) -> ${P}::Result<Self::Value, __E::Error> where __E: _serde::Deserializer<'de> {
    let __field0: ${t} = <${t} as _serde::Deserialize>::deserialize(__e)?;
    ${P}::Ok(${p.ty}(__field0))
  }
  #[inline]
  fn visit_seq<__A>(self, mut __seq: __A) -> ${P}::Result<Self::Value, __A::Error> where __A: _serde::de::SeqAccess<'de> {
    ${rustSeqElems([p.field], e)}
    ${P}::Ok(${p.ty}(__field0))
  }
}
_serde::Deserializer::deserialize_newtype_struct(__deserializer, ${JSON.stringify(p.ty)}, ${visitorExpr})
} }`;
  }
  // de/struct_.rs `deserialize` + `deserialize_map`
  const fs = p.fields;
  const e = `struct ${p.ty}`;
  const build = `${P}::Ok(${p.ty} { ${fs.map((f, i) => `${f.member}: __field${i},`).join(" ")} })`;
  const decls = fs.map((f, i) => `let mut __field${i}: ${P}::Option<${rty(f.ty)}> = ${P}::None;`).join("\n");
  const arms = fs
    .map(
      (f, i) => `__Field::__field${i} => {
  if ${P}::Option::is_some(&__field${i}) { return ${P}::Err(<__A::Error as _serde::de::Error>::duplicate_field(${JSON.stringify(f.name)})); }
  __field${i} = ${P}::Some(_serde::de::MapAccess::next_value::<${rty(f.ty)}>(&mut __map)?);
}`,
    )
    .join("\n");
  const missing = fs
    .map(
      (f, i) => `let __field${i} = match __field${i} {
  ${P}::Some(__field${i}) => __field${i},
  ${P}::None => ${P}::de::missing_field(${JSON.stringify(f.name)})?,
};`,
    )
    .join("\n");
  return `${head}
${rustFieldVisitor(fs)}
${visitorStruct}
#[automatically_derived]
impl<'de> _serde::de::Visitor<'de> for __Visitor<'de> {
  type Value = ${p.ty};
  ${expecting(e)}
  #[inline]
  fn visit_seq<__A>(self, mut __seq: __A) -> ${P}::Result<Self::Value, __A::Error> where __A: _serde::de::SeqAccess<'de> {
    ${rustSeqElems(fs, e)}
    ${build}
  }
  #[inline]
  fn visit_map<__A>(self, mut __map: __A) -> ${P}::Result<Self::Value, __A::Error> where __A: _serde::de::MapAccess<'de> {
    ${decls}
    while let ${P}::Some(__key) = _serde::de::MapAccess::next_key::<__Field>(&mut __map)? {
      match __key {
        ${arms}
        _ => { let _ = _serde::de::MapAccess::next_value::<_serde::de::IgnoredAny>(&mut __map)?; }
      }
    }
    ${missing}
    ${build}
  }
}
#[doc(hidden)]
const FIELDS: &'static [&'static str] = &[${fs.map((f) => JSON.stringify(f.name)).join(", ")}];
_serde::Deserializer::deserialize_struct(__deserializer, ${JSON.stringify(p.ty)}, FIELDS, ${visitorExpr})
} }`;
}

function rustSerialize(p: SerPlan): string {
  const head = `impl _serde::Serialize for ${p.ty} {
  fn serialize<__S>(&self, __serializer: __S) -> ${P}::Result<__S::Ok, __S::Error> where __S: _serde::Serializer {`;
  if (p.shape === "newtype") {
    // ser.rs `serialize_newtype_struct`
    return `${head}
_serde::Serializer::serialize_newtype_struct(__serializer, ${JSON.stringify(p.ty)}, &self.0)
} }`;
  }
  if (p.shape === "struct") {
    // ser.rs `serialize_struct_as_struct` + `serialize_struct_visitor`
    const len = ["false as usize", ...p.fields.map(() => "1")].join(" + ");
    return `${head}
let mut __serde_state = _serde::Serializer::serialize_struct(__serializer, ${JSON.stringify(p.ty)}, ${len})?;
${p.fields.map((f) => `_serde::ser::SerializeStruct::serialize_field(&mut __serde_state, ${JSON.stringify(f.name)}, &self.${f.member})?;`).join("\n")}
_serde::ser::SerializeStruct::end(__serde_state)
} }`;
  }
  // ser.rs `serialize_enum` + `serialize_variant` + `serialize_externally_tagged_variant`
  const arms = p.variants.map((v) =>
    v.field
      ? `${p.ty}::${v.name}(ref __field0) => _serde::Serializer::serialize_newtype_variant(__serializer, ${JSON.stringify(p.ty)}, ${v.index}u32, ${JSON.stringify(v.name)}, __field0),`
      : `${p.ty}::${v.name} => _serde::Serializer::serialize_unit_variant(__serializer, ${JSON.stringify(p.ty)}, ${v.index}u32, ${JSON.stringify(v.name)}),`,
  );
  return `${head}
match *self { ${arms.join("\n")} }
} }`;
}

/** The expansion serde_derive emits for `p` (the `const _: () = { .. };` item). */
export function renderRust(p: SerdePlan): string {
  return wrapInConst(p.trait === "Deserialize" ? rustDeserialize(p) : rustSerialize(p));
}

// ---- the TS rendering -----------------------------------------------------------------------

/**
 * The `serde` surface the generated code uses, by module (src-relative, PORTING §5b paths of serde 1.0.228 / serde_core 1.0.228)
 * and name. Its exact shape is declared in `SERDE_SURFACE_DECLS` (the contract the vendor-serde-de lane implements).
 */
export const SERDE_MODULES = {
  de: "vendor/serde_core/de/mod.ts",
  de_impls: "vendor/serde_core/de/impls.ts",
  ignored_any: "vendor/serde_core/de/ignored_any.ts",
  private_de: "vendor/serde/private/de.ts",
  ser: "vendor/serde_core/ser/mod.ts",
  ser_impls: "vendor/serde_core/ser/impls.ts",
} as const;
export type SerdeModule = keyof typeof SERDE_MODULES;

/** What `renderTs` needs from its caller (types.ts or the create_config generator). */
export interface SerdeTsCtx {
  /** imports `name` from a serde module (`kind` "types" for a type-only import) and returns the local name */
  use(module: SerdeModule, name: string, kind?: "types" | "values"): string;
  /** imports `Ok` / `Err` from src/std/result.ts and returns the local name */
  result(name: "Ok" | "Err" | "Result"): string;
  /** `<T as Deserialize>::deserialize` for a field type `ty`, as a TS value of type `Deserialize<T>` */
  deFn(ty: PType, at: string): string;
  /** `<T as Serialize>::serialize` as a TS value of type `Serialize<T>` */
  serFn(ty: PType, at: string): string;
  /** the TS type of a field type */
  tsType(ty: PType, at: string): string;
  /** the TS type of `Self` */
  self: string;
  /** a TS expression building `Self` from its field values (declaration order), or a variant `name`'s value for enums */
  construct(vals: string[]): string;
  /** the TS expression reading field `f` of the value `v` */
  read(v: string, f: SerdeField): string;
  /** `upstream:line` of the derive, for the `// rustc-derive:` line */
  at: string;
}

/** `ident` of a field / visitor local: `__field<i>` as in serde_derive. */
const fieldI = (i: number) => `__field${i}`;

/** TS of the `Deserialize` / `Serialize` impl of `p`: one exported function `deserialize_<T>` / `serialize_<T>`. */
export function renderTs(p: SerdePlan, c: SerdeTsCtx): string[] {
  return p.trait === "Deserialize" ? tsDeserialize(p, c) : tsSerialize(p, c);
}

function tsFieldVisitor(fields: SerdeField[], c: SerdeTsCtx): string[] {
  const Ok = c.result("Ok");
  const R = c.result("Result");
  const Visitor = c.use("de", "Visitor", "types");
  const Deserializer = c.use("de", "Deserializer", "types");
  const names = fields.map((_, i) => fieldI(i));
  const out: string[] = [];
  out.push(`  // \`enum __Field { ${names.join(", ")}, __ignore }\` (serde_derive de/identifier.rs deserialize_generated)`);
  out.push(`  type __Field = ${[...names, "__ignore"].map((n) => JSON.stringify(n)).join(" | ")};`);
  out.push(`  const __FieldVisitor: ${Visitor}<__Field> = {`);
  out.push(`    expecting(): string {`, `      return "field identifier";`, "    },");
  out.push(`    visit_u64<__E>(__value: bigint): ${R}<__Field, __E> {`, "      switch (__value) {");
  names.forEach((n, i) => out.push(`        case ${i}n:`, `          return ${Ok}(${JSON.stringify(n)});`));
  out.push("        default:", `          return ${Ok}("__ignore");`, "      }", "    },");
  out.push(`    visit_str<__E>(__value: string): ${R}<__Field, __E> {`, "      switch (__value) {");
  fields.forEach((f, i) => out.push(`        case ${JSON.stringify(f.name)}:`, `          return ${Ok}(${JSON.stringify(names[i])});`));
  out.push("        default:", `          return ${Ok}("__ignore");`, "      }", "    },");
  // `match __value { b"name" => .. }`: byte-wise equality with the name's UTF-8
  out.push(`    visit_bytes<__E>(__value: Uint8Array): ${R}<__Field, __E> {`);
  fields.forEach((f, i) => out.push(`      if (__bytes_eq(__value, ${JSON.stringify(f.name)})) return ${Ok}(${JSON.stringify(names[i])});`));
  out.push(`      return ${Ok}("__ignore");`, "    },", "  };");
  out.push(`  // \`impl Deserialize for __Field\``);
  out.push(`  const deserialize___Field = <__E>(__deserializer: ${Deserializer}<__E>): ${R}<__Field, __E> => __deserializer.deserialize_identifier(__FieldVisitor);`);
  return out;
}

/** `let __fieldN = match next_element::<T>()? { Some(v) => v, None => return Err(invalid_length(N, &"..")) };` */
function tsSeqElems(fields: SerdeField[], expecting: string, c: SerdeTsCtx, indent: string): string[] {
  const Err = c.result("Err");
  const Expected_str = c.use("de", "Expected_str");
  const n = fields.length;
  const what = `${expecting} with ${n} element${n === 1 ? "" : "s"}`;
  const out: string[] = [];
  fields.forEach((f, i) => {
    out.push(`${indent}const __e${i} = __seq.next_element<${c.tsType(f.ty, c.at)}>(${c.deFn(f.ty, c.at)});`);
    out.push(`${indent}if (__e${i}.$ === "Err") return __e${i};`);
    out.push(`${indent}if (__e${i}._0 === undefined) return ${Err}(__seq.Error.invalid_length(${i}, ${Expected_str}(${JSON.stringify(what)})));`);
    out.push(`${indent}const ${fieldI(i)} = __e${i}._0._0;`);
  });
  return out;
}

function tsDeserialize(p: DePlan, c: SerdeTsCtx): string[] {
  const Ok = c.result("Ok");
  const Err = c.result("Err");
  const R = c.result("Result");
  const Visitor = c.use("de", "Visitor", "types");
  const Deserializer = c.use("de", "Deserializer", "types");
  const SeqAccess = c.use("de", "SeqAccess", "types");
  const out: string[] = [];
  out.push(`// rustc-derive: ${c.at} Deserialize for ${p.ty} (serde_derive 1.0.228)`);
  out.push(`export function deserialize_${p.ty}<__E>(__deserializer: ${Deserializer}<__E>): ${R}<${c.self}, __E> {`);
  if (p.shape === "newtype") {
    const e = `tuple struct ${p.ty}`;
    out.push(`  const __Visitor: ${Visitor}<${c.self}> = {`);
    out.push("    expecting(): string {", `      return ${JSON.stringify(e)};`, "    },");
    out.push(`    visit_newtype_struct<__E>(__e: ${Deserializer}<__E>): ${R}<${c.self}, __E> {`);
    out.push(`      const __r = ${c.deFn(p.field.ty, c.at)}<__E>(__e);`, `      if (__r.$ === "Err") return __r;`, "      const __field0 = __r._0;");
    out.push(`      return ${Ok}(${c.construct(["__field0"])});`, "    },");
    out.push(`    visit_seq<__E>(__seq: ${SeqAccess}<__E>): ${R}<${c.self}, __E> {`);
    out.push(...tsSeqElems([p.field], e, c, "      "));
    out.push(`      return ${Ok}(${c.construct(["__field0"])});`, "    },", "  };");
    out.push(`  return __deserializer.deserialize_newtype_struct(${JSON.stringify(p.ty)}, __Visitor);`, "}");
    return out;
  }
  const fs = p.fields;
  const e = `struct ${p.ty}`;
  const MapAccess = c.use("de", "MapAccess", "types");
  const missing_field = c.use("private_de", "missing_field");
  const deserialize_IgnoredAny = c.use("ignored_any", "deserialize_IgnoredAny");
  out.push(...tsFieldVisitor(fs, c));
  const build = c.construct(fs.map((_, i) => fieldI(i)));
  out.push(`  const __Visitor: ${Visitor}<${c.self}> = {`);
  out.push("    expecting(): string {", `      return ${JSON.stringify(e)};`, "    },");
  out.push(`    visit_seq<__E>(__seq: ${SeqAccess}<__E>): ${R}<${c.self}, __E> {`);
  out.push(...tsSeqElems(fs, e, c, "      "));
  out.push(`      return ${Ok}(${build});`, "    },");
  out.push(`    visit_map<__E>(__map: ${MapAccess}<__E>): ${R}<${c.self}, __E> {`);
  // PORT: `Option<T>` locals are `{ $: "Some", _0 } | undefined` (PORTING §5): a field may itself be an `Option`.
  fs.forEach((f, i) => out.push(`      let ${fieldI(i)}: { $: "Some"; _0: ${c.tsType(f.ty, c.at)} } | undefined = undefined;`));
  out.push("      for (;;) {");
  out.push("        const __k = __map.next_key<__Field>(deserialize___Field);", `        if (__k.$ === "Err") return __k;`, "        if (__k._0 === undefined) break;");
  out.push("        switch (__k._0._0) {");
  fs.forEach((f, i) => {
    out.push(`          case ${JSON.stringify(fieldI(i))}: {`);
    out.push(`            if (${fieldI(i)} !== undefined) return ${Err}(__map.Error.duplicate_field(${JSON.stringify(f.name)}));`);
    out.push(`            const __v = __map.next_value<${c.tsType(f.ty, c.at)}>(${c.deFn(f.ty, c.at)});`);
    out.push(`            if (__v.$ === "Err") return __v;`, `            ${fieldI(i)} = { $: "Some", _0: __v._0 };`, "            break;", "          }");
  });
  out.push("          default: {");
  out.push(`            const __v = __map.next_value(${deserialize_IgnoredAny});`, `            if (__v.$ === "Err") return __v;`, "            break;", "          }");
  out.push("        }", "      }");
  fs.forEach((f, i) => {
    // `match __fieldN { Some(v) => v, None => __private::de::missing_field("name")? }`
    out.push(
      `      const __m${i}: ${R}<${c.tsType(f.ty, c.at)}, __E> = ${fieldI(i)} !== undefined ? ${Ok}(${fieldI(i)}._0) : ${missing_field}<${c.tsType(f.ty, c.at)}, __E>(${c.deFn(f.ty, c.at)}, ${JSON.stringify(f.name)}, __map.Error);`,
    );
    out.push(`      if (__m${i}.$ === "Err") return __m${i};`);
  });
  out.push(`      return ${Ok}(${c.construct(fs.map((_, i) => `__m${i}._0`))});`, "    },", "  };");
  out.push(`  const FIELDS: readonly string[] = [${fs.map((f) => JSON.stringify(f.name)).join(", ")}];`);
  out.push(`  return __deserializer.deserialize_struct(${JSON.stringify(p.ty)}, FIELDS, __Visitor);`, "}");
  return out;
}

function tsSerialize(p: SerPlan, c: SerdeTsCtx): string[] {
  const R = c.result("Result");
  const Serializer = c.use("ser", "Serializer", "types");
  const out: string[] = [];
  out.push(`// rustc-derive: ${c.at} Serialize for ${p.ty} (serde_derive 1.0.228)`);
  out.push(`export function serialize_${p.ty}<__O, __E>(self: ${c.self}, __serializer: ${Serializer}<__O, __E>): ${R}<__O, __E> {`);
  if (p.shape === "newtype") {
    out.push(`  return __serializer.serialize_newtype_struct<${c.tsType(p.field.ty, c.at)}>(${JSON.stringify(p.ty)}, ${c.read("self", p.field)}, ${c.serFn(p.field.ty, c.at)});`, "}");
    return out;
  }
  if (p.shape === "struct") {
    out.push(`  const __s = __serializer.serialize_struct(${JSON.stringify(p.ty)}, ${["Number(false)", ...p.fields.map(() => "1")].join(" + ")});`);
    out.push(`  if (__s.$ === "Err") return __s;`, "  const __serde_state = __s._0;");
    p.fields.forEach((f, i) => {
      out.push(`  const __r${i} = __serde_state.serialize_field<${c.tsType(f.ty, c.at)}>(${JSON.stringify(f.name)}, ${c.read("self", f)}, ${c.serFn(f.ty, c.at)});`);
      out.push(`  if (__r${i}.$ === "Err") return __r${i};`);
    });
    out.push("  return __serde_state.end();", "}");
    return out;
  }
  // a data enum (`{ $: "Name", _0 }`) or, when every variant is a unit, a string-literal union
  const fieldless = p.variants.every((v) => !v.field);
  out.push(`  switch (${fieldless ? "self" : "self.$"}) {`);
  for (const v of p.variants) {
    out.push(`    case ${JSON.stringify(v.name)}:`);
    if (v.field)
      out.push(`      return __serializer.serialize_newtype_variant<${c.tsType(v.field.ty, c.at)}>(${JSON.stringify(p.ty)}, ${v.index}, ${JSON.stringify(v.name)}, self._0, ${c.serFn(v.field.ty, c.at)});`);
    else out.push(`      return __serializer.serialize_unit_variant(${JSON.stringify(p.ty)}, ${v.index}, ${JSON.stringify(v.name)});`);
  }
  out.push("  }", "}");
  return out;
}

/** The module-local helper the field visitors' `visit_bytes` use (emitted once per file that needs it). */
export const BYTES_EQ_HELPER = [
  "/** `__value == name.as_bytes()` (the `b\"name\"` arms of serde_derive's field visitors). */",
  "function __bytes_eq(value: Uint8Array, name: string): boolean {",
  "  const b = new TextEncoder().encode(name);",
  "  if (value.length !== b.length) return false;",
  "  for (let i = 0; i < b.length; i++) if (value[i] !== b[i]) return false;",
  "  return true;",
  "}",
];

/**
 * The declarations of the serde surface the generated code uses, by module. While a module is missing under src/ these are
 * written into the generated contract (`src/rustfmt/serde_contract.gen.d.ts`, ambient `declare module` blocks that TypeScript
 * only consults while the real module is absent), so the generated code type-checks and the vendor-serde-de lane has the exact
 * surface to port. Conventions (PORTING §5, §8):
 * - a trait with an associated `Error` type carries its `de::Error` / `ser::Error` impl as the `Error` field of the object
 *   (`<__A::Error as de::Error>::duplicate_field(..)` -> `__map.Error.duplicate_field(..)`);
 * - `Deserialize<T>` / `Serialize<T>` impls are functions, passed where Rust names the type (`next_element::<T>()` ->
 *   `next_element(deserialize_T)`); generic impls (`Option<T>`, `Vec<T>`, tuples) take their parameters' impls;
 * - `fmt::Formatter`-writing fns (`Visitor::expecting`, `Expected::fmt`) return their text, as the port's Display impls do;
 * - `Option<T>` results of generic fns are `{ $: "Some", _0: T } | undefined` (T may itself be an `Option`);
 * - `u64` visitor arguments are `bigint`.
 */
export const SERDE_SURFACE_DECLS: Record<SerdeModule, Record<string, string>> = {
  de: {
    Deserialize: "export type Deserialize<T> = <E>(deserializer: Deserializer<E>) => Result<T, E>;",
    Deserializer: [
      "export interface Deserializer<E> {",
      "  readonly Error: Error<E>;",
      "  deserialize_string<V>(visitor: Visitor<V>): Result<V, E>;",
      "  deserialize_newtype_struct<V>(name: string, visitor: Visitor<V>): Result<V, E>;",
      "  deserialize_struct<V>(name: string, fields: readonly string[], visitor: Visitor<V>): Result<V, E>;",
      "  deserialize_identifier<V>(visitor: Visitor<V>): Result<V, E>;",
      "}",
    ].join("\n"),
    Visitor: [
      "export interface Visitor<V> {",
      "  expecting(): string;",
      "  visit_u64?<E>(v: bigint, err: Error<E>): Result<V, E>;",
      "  visit_str?<E>(v: string, err: Error<E>): Result<V, E>;",
      "  visit_bytes?<E>(v: Uint8Array, err: Error<E>): Result<V, E>;",
      "  visit_newtype_struct?<E>(deserializer: Deserializer<E>): Result<V, E>;",
      "  visit_seq?<E>(seq: SeqAccess<E>): Result<V, E>;",
      "  visit_map?<E>(map: MapAccess<E>): Result<V, E>;",
      "}",
    ].join("\n"),
    SeqAccess: [
      "export interface SeqAccess<E> {",
      "  readonly Error: Error<E>;",
      '  next_element<T>(deserialize_T: Deserialize<T>): Result<{ $: "Some"; _0: T } | undefined, E>;',
      "}",
    ].join("\n"),
    MapAccess: [
      "export interface MapAccess<E> {",
      "  readonly Error: Error<E>;",
      '  next_key<K>(deserialize_K: Deserialize<K>): Result<{ $: "Some"; _0: K } | undefined, E>;',
      "  next_value<V>(deserialize_V: Deserialize<V>): Result<V, E>;",
      "}",
    ].join("\n"),
    Error: [
      "export interface Error<E> {",
      "  custom(msg: string): E;",
      "  invalid_length(len: number, exp: Expected): E;",
      "  unknown_variant(variant: string, expected: readonly string[]): E;",
      "  duplicate_field(field: string): E;",
      "}",
    ].join("\n"),
    Expected: "export interface Expected {\n  fmt(): string;\n}",
    Expected_str: "export function Expected_str(s: string): Expected;",
  },
  de_impls: {
    deserialize_bool: "export function deserialize_bool<E>(deserializer: Deserializer<E>): Result<boolean, E>;",
    deserialize_usize: "export function deserialize_usize<E>(deserializer: Deserializer<E>): Result<number, E>;",
    deserialize_u32: "export function deserialize_u32<E>(deserializer: Deserializer<E>): Result<number, E>;",
    deserialize_isize: "export function deserialize_isize<E>(deserializer: Deserializer<E>): Result<number, E>;",
    deserialize_String: "export function deserialize_String<E>(deserializer: Deserializer<E>): Result<string, E>;",
    deserialize_Option: "export function deserialize_Option<T>(deserialize_T: Deserialize<T>): Deserialize<T | undefined>;",
    deserialize_Vec: "export function deserialize_Vec<T>(deserialize_T: Deserialize<T>): Deserialize<T[]>;",
    deserialize_tuple2: "export function deserialize_tuple2<T0, T1>(deserialize_T0: Deserialize<T0>, deserialize_T1: Deserialize<T1>): Deserialize<[T0, T1]>;",
  },
  ignored_any: {
    deserialize_IgnoredAny: "export function deserialize_IgnoredAny<E>(deserializer: Deserializer<E>): Result<IgnoredAny, E>;",
    IgnoredAny: "export type IgnoredAny = null;",
  },
  private_de: {
    missing_field: "export function missing_field<V, E>(deserialize_V: Deserialize<V>, field: string, err: Error<E>): Result<V, E>;",
  },
  ser: {
    Serialize: "export type Serialize<T> = <O, E>(self: T, serializer: Serializer<O, E>) => Result<O, E>;",
    Serializer: [
      "export interface Serializer<O, E> {",
      "  readonly Error: Error<E>;",
      "  serialize_str(v: string): Result<O, E>;",
      "  serialize_unit_variant(name: string, variant_index: number, variant: string): Result<O, E>;",
      "  serialize_newtype_struct<T>(name: string, value: T, serialize_T: Serialize<T>): Result<O, E>;",
      "  serialize_newtype_variant<T>(name: string, variant_index: number, variant: string, value: T, serialize_T: Serialize<T>): Result<O, E>;",
      "  serialize_struct(name: string, len: number): Result<SerializeStruct<O, E>, E>;",
      "}",
    ].join("\n"),
    SerializeStruct: [
      "export interface SerializeStruct<O, E> {",
      "  serialize_field<T>(key: string, value: T, serialize_T: Serialize<T>): Result<null, E>;",
      "  end(): Result<O, E>;",
      "}",
    ].join("\n"),
    Error: "export interface Error<E> {\n  custom(msg: string): E;\n}",
  },
  ser_impls: {
    serialize_bool: "export function serialize_bool<O, E>(self: boolean, serializer: Serializer<O, E>): Result<O, E>;",
    serialize_usize: "export function serialize_usize<O, E>(self: number, serializer: Serializer<O, E>): Result<O, E>;",
    serialize_u32: "export function serialize_u32<O, E>(self: number, serializer: Serializer<O, E>): Result<O, E>;",
    serialize_isize: "export function serialize_isize<O, E>(self: number, serializer: Serializer<O, E>): Result<O, E>;",
    serialize_String: "export function serialize_String<O, E>(self: string, serializer: Serializer<O, E>): Result<O, E>;",
    serialize_Option: "export function serialize_Option<T>(serialize_T: Serialize<T>): Serialize<T | undefined>;",
    serialize_Vec: "export function serialize_Vec<T>(serialize_T: Serialize<T>): Serialize<readonly T[]>;",
    serialize_tuple2: "export function serialize_tuple2<T0, T1>(serialize_T0: Serialize<T0>, serialize_T1: Serialize<T1>): Serialize<readonly [T0, T1]>;",
  },
};

/** Type aliases at the top of each module's contract block (`$SRC` = the path from the contract file to src/). */
export const SERDE_SURFACE_PRELUDE: Record<SerdeModule, string[]> = {
  de: ['type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;'],
  de_impls: [
    'type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;',
    'type Deserialize<T> = import("$SRC/vendor/serde_core/de/mod.ts").Deserialize<T>;',
    'type Deserializer<E> = import("$SRC/vendor/serde_core/de/mod.ts").Deserializer<E>;',
  ],
  ignored_any: ['type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;', 'type Deserializer<E> = import("$SRC/vendor/serde_core/de/mod.ts").Deserializer<E>;'],
  private_de: [
    'type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;',
    'type Deserialize<T> = import("$SRC/vendor/serde_core/de/mod.ts").Deserialize<T>;',
    'type Error<E> = import("$SRC/vendor/serde_core/de/mod.ts").Error<E>;',
  ],
  ser: ['type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;'],
  ser_impls: [
    'type Result<T, E> = import("$SRC/std/result.ts").Result<T, E>;',
    'type Serialize<T> = import("$SRC/vendor/serde_core/ser/mod.ts").Serialize<T>;',
    'type Serializer<O, E> = import("$SRC/vendor/serde_core/ser/mod.ts").Serializer<O, E>;',
  ],
};

/** `<T as Deserialize>` / `<T as Serialize>` impls of std types in serde_core's de/impls.rs / ser/impls.rs, by type path. */
export const SERDE_STD_IMPLS: Record<string, { de: string; ser: string; generic?: number }> = {
  bool: { de: "deserialize_bool", ser: "serialize_bool" },
  usize: { de: "deserialize_usize", ser: "serialize_usize" },
  u32: { de: "deserialize_u32", ser: "serialize_u32" },
  isize: { de: "deserialize_isize", ser: "serialize_isize" },
  String: { de: "deserialize_String", ser: "serialize_String" },
  Option: { de: "deserialize_Option", ser: "serialize_Option", generic: 1 },
  Vec: { de: "deserialize_Vec", ser: "serialize_Vec", generic: 1 },
};
