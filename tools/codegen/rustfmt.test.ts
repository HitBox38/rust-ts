// tools/codegen/rustfmt.ts (lane codegen-fmt-serde, plan-m8 D5, D6): rustfmt's serde derives, `#[config_type]` and `create_config!`.
// - golden: the generator reproduces the committed src/rustfmt/**/*.gen.ts and contract files from the probe fixture;
// - oracle (D6): every serde derive, `#[config_type]` expansion and the parse-dependent parts of `create_config!` rendered as Rust
//   equal, token for token, the oracle's `-Zunpretty=expanded` blocks in fixtures/rustfmt.expanded.rs (rewritten and checked against
//   the oracle by `bun tools/codegen/rustfmt_oracle.ts write|check`), and clippy_config has no serde derive;
// - the generator's refusals (never guessed): `#[serde(..)]` attributes, generics, unsupported shapes;
// - the emitted TS run against a minimal serde runtime (a JSON-like value deserializer): field order, unknown / duplicate /
//   missing fields, sequences, newtypes, `#[config_type]`'s case-insensitive values and its errors.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, UPSTREAM } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../src/rust_ts/test_scratch.ts";
import * as CT from "./config_type.ts";
import { renderRustDefault, renderRustOverrideValue, renderRustPrintDocs } from "./create_config.ts";
import { firstTokenDiff, normRust } from "./rust_tokens.ts";
import { generateRustfmt } from "./rustfmt.ts";
import { readFixture, stripDerived } from "./rustfmt_oracle.ts";
import * as SD from "./serde.ts";
import { type PItem, type ProbeJson, type PType, REPO } from "./types.ts";

const SRC = join(REPO, "src");
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "src/tools/rustfmt/src/config/config_type.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustfmt golden/oracle tests need the upstream checkout (src/tools/rustfmt); RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const probe: ProbeJson = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustfmt.typedefs.json"), "utf8"));
const pin = PIN.commit.slice(0, 12);
const gen = () => generateRustfmt(probe, { out: SRC, srcRoot: SRC, pin, upstream: UPSTREAM });

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: the generator reproduces src/rustfmt's generated files", () => {
  const g = gen();
  expect(g.errors).toEqual([]);
  expect([...g.files.keys()].map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
    "rustfmt/config/create_config.gen.ts",
    "rustfmt/config/file_lines.gen.ts",
    "rustfmt/config/lists.gen.ts",
    "rustfmt/config/macro_names.gen.ts",
    "rustfmt/config/options.gen.ts",
    "rustfmt/contract.gen.d.ts",
    "rustfmt/contract_augment.gen.d.ts",
    "rustfmt/emitter/json.gen.ts",
  ]);
  for (const [f, text] of g.files) expect({ f, same: text === readFileSync(f, "utf8") }).toEqual({ f, same: true });
});

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("oracle: every serde derive, #[config_type] and create_config! part equals -Zunpretty=expanded", () => {
  const g = gen();
  expect(g.errors).toEqual([]);
  const { blocks, clippySerde } = readFixture();
  // clippy_config derives no serde trait at the pin (its de.rs is hand-written)
  expect(clippySerde).toBe(0);
  const oracle = new Map(blocks.map((b) => [b.key, b.text]));
  const mine = new Map<string, string>();
  for (const [k, p] of g.serdePlans) mine.set(k, normRust(SD.renderRust(p)));
  for (const [name, p] of g.configTypePlans) mine.set(`config_type ${name}`, normRust(CT.renderRust(p)));
  const cc = g.createConfig!;
  for (const d of cc.defaults.values()) mine.set(`style_edition_default ${d.name}`, normRust(renderRustDefault(d, cc.version)));
  mine.set("create_config print_docs", normRust(renderRustPrintDocs(cc)));
  mine.set("create_config override_value", normRust(renderRustOverrideValue(cc)));
  expect([...mine.keys()].sort()).toEqual([...oracle.keys()].sort());
  expect(mine.size).toBe(14 + 23 + 90 + 2);
  const diffs: string[] = [];
  for (const [k, text] of oracle) {
    const want = k.startsWith("config_type ") ? stripDerived(text) : normRust(text);
    const d = firstTokenDiff(want, mine.get(k)!);
    if (d) diffs.push(`${k}: ${d}`);
  }
  expect(diffs).toEqual([]);
});

// ---- refusals ----
const path = (name: string, ...args: PType[]): PType => ({
  kind: "path",
  text: args.length ? `${name}<${args.map((a) => a.text).join(", ")}>` : name,
  path: { global: false, segments: [{ name, args: args.map((ty) => ({ kind: "type", ty })) }] },
});
const item = (it: Partial<PItem> & Pick<PItem, "kind" | "name">): PItem => ({ line: 1, vis: "pub", module: [], attrs: [], docs: [], generics: { params: [], where: [] }, ...it });
const derive = (...ds: string[]) => ({ path: "derive", text: `derive (${ds.join(", ")})`, derives: ds });

test("serde plans: shapes and refusals", () => {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const fieldTs = (f: { name: string | null; index: number }) => f.name ?? `_${f.index}`;
  const fl = (name: string | null, index: number, ty: PType, attrs: { path: string; text: string }[] = []) => ({ name, index, vis: "pub", ty, attrs, docs: [], line: 2 });
  const s = item({ kind: "struct", name: "S", attrs: [derive("Clone", "Serialize", "Deserialize")], fields: { style: "named", fields: [fl("a", 0, path("usize"))] } });
  expect(SD.serdePlans(s, "x:1", err, fieldTs).map((p) => `${p.trait} ${p.shape}`)).toEqual(["Serialize struct", "Deserialize struct"]);
  const n = item({ kind: "struct", name: "N", attrs: [derive("Deserialize")], fields: { style: "unnamed", fields: [fl(null, 0, path("String"))] } });
  expect(SD.serdePlans(n, "x:1", err, fieldTs).map((p) => p.shape)).toEqual(["newtype"]);
  expect(errs).toEqual([]);
  // never guessed: #[serde(..)], generics, tuple structs, Deserialize of an enum, struct variants
  SD.serdePlans({ ...s, attrs: [...s.attrs, { path: "serde", text: "serde (rename_all = \"kebab-case\")" }] }, "a:1", err, fieldTs);
  SD.serdePlans({ ...s, fields: { style: "named", fields: [fl("a", 0, path("usize"), [{ path: "serde", text: "serde (default)" }])] } }, "b:1", err, fieldTs);
  SD.serdePlans({ ...s, generics: { params: [{ kind: "type", name: "T" }], where: [] } }, "c:1", err, fieldTs);
  SD.serdePlans({ ...n, fields: { style: "unnamed", fields: [fl(null, 0, path("u32")), fl(null, 1, path("u32"))] } }, "d:1", err, fieldTs);
  const e = item({ kind: "enum", name: "E", attrs: [derive("Serialize", "Deserialize")], variants: [{ name: "A", line: 3, attrs: [], docs: [], fields: { style: "named", fields: [fl("x", 0, path("u32"))] }, discriminant: null }] });
  SD.serdePlans(e, "e:1", err, fieldTs);
  expect(errs.map((m) => m.split(":")[0])).toEqual(["a", "b", "c", "d", "e", "e"]);
});

test("#[config_type] plans: values, doc hints, unstable variants and refusals", () => {
  const errs: string[] = [];
  const unit = (name: string, attrs: { path: string; text: string; value?: string }[] = [], docs: string[] = []) => ({ name, line: 2, attrs, docs, fields: { style: "unit" as const, fields: [] }, discriminant: null });
  const en = item({
    kind: "enum",
    name: "Ed",
    attrs: [{ path: "config_type", text: "config_type" }],
    variants: [
      unit("Edition2015", [{ path: "value", text: 'value = "2015"', value: "2015" }, { path: "doc_hint", text: 'doc_hint = "2015"', value: "2015" }], [" first"]),
      unit("Next", [{ path: "unstable_variant", text: "unstable_variant" }]),
    ],
  });
  const p = CT.configTypePlan(en, "x:1", (m) => errs.push(m))!;
  expect(p.variants.map((v) => [v.value, v.doc_hint, v.unstable])).toEqual([
    ["2015", "2015", false],
    ["Next", "Next (unstable)", true],
  ]);
  // the item types.ts sees: the macro's derive, no config attributes, the variant docs kept
  const it = CT.configTypeItem(en);
  expect(it.attrs.map((a) => a.text)).toEqual(["derive (Debug, Copy, Clone, Eq, PartialEq)"]);
  expect(it.variants!.map((v) => [v.attrs.length, v.docs])).toEqual([
    [0, [" first"]],
    [0, []],
  ]);
  expect(normRust(CT.renderRust(p))).toContain(normRust('"[2015|Next (unstable)]" . to_owned ( )'));
  expect(errs).toEqual([]);
  CT.configTypePlan({ ...en, kind: "struct", fields: { style: "named", fields: [] } }, "s:1", (m) => errs.push(m));
  CT.configTypePlan({ ...en, variants: [{ ...unit("V"), fields: { style: "named", fields: [] } }] }, "n:1", (m) => errs.push(m));
  expect(errs.map((m) => m.split(":")[0])).toEqual(["s", "n"]);
});

// ---- the emitted TS, run ----
/** A minimal serde runtime for the tests: values are JSON-like (`Map` for maps), errors are strings with serde's texts. */
const RUNTIME = `
import { Ok, Err, type Result } from "${join(SRC, "std/result.ts")}";
export type Value = number | string | boolean | null | Uint8Array | Value[] | Entries;
/** a map, as its entries in order (duplicate keys allowed, as in a serialized document) */
export class Entries { constructor(readonly entries: [Value, Value][]) {} }
export interface Visitor<V> { expecting(): string; [k: string]: any }
export interface Expected { fmt(): string }
export const Expected_str = (s: string): Expected => ({ fmt: () => s });
const Error = {
  custom: (m: string) => m,
  invalid_length: (len: number, exp: Expected) => \`invalid length \${len}, expected \${exp.fmt()}\`,
  invalid_type: (what: string, exp: Expected) => \`invalid type: \${what}, expected \${exp.fmt()}\`,
  unknown_variant: (v: string, exp: readonly string[]) => \`unknown variant \\\`\${v}\\\`, expected one of \${exp.map((e) => "\`" + e + "\`").join(", ")}\`,
  duplicate_field: (f: string) => \`duplicate field \\\`\${f}\\\`\`,
  missing_field: (f: string) => \`missing field \\\`\${f}\\\`\`,
};
export type Deserialize<T> = <E>(d: Deserializer<E>) => Result<T, E>;
export class Deserializer<E = string> {
  readonly Error: any = Error;
  constructor(readonly v: Value) {}
  deserialize_struct<V>(_name: string, _fields: readonly string[], visitor: Visitor<V>): Result<V, E> {
    if (this.v instanceof Entries) return visitor.visit_map(new MapAccess(this.v));
    if (Array.isArray(this.v)) return visitor.visit_seq(new SeqAccess(this.v));
    return Err(Error.invalid_type("other", { fmt: () => visitor.expecting() }) as E);
  }
  deserialize_identifier<V>(visitor: Visitor<V>): Result<V, E> {
    if (typeof this.v === "number") return visitor.visit_u64(BigInt(this.v), Error);
    if (this.v instanceof Uint8Array) return visitor.visit_bytes(this.v, Error);
    return visitor.visit_str(this.v as string, Error);
  }
  deserialize_newtype_struct<V>(_name: string, visitor: Visitor<V>): Result<V, E> {
    if (Array.isArray(this.v)) return visitor.visit_seq(new SeqAccess(this.v));
    return visitor.visit_newtype_struct(this);
  }
  deserialize_string<V>(visitor: Visitor<V>): Result<V, E> {
    if (typeof this.v !== "string") return Err(Error.invalid_type("other", { fmt: () => visitor.expecting() }) as E);
    return visitor.visit_str(this.v, Error);
  }
}
export class SeqAccess<E = string> {
  readonly Error: any = Error;
  i = 0;
  constructor(readonly v: Value[]) {}
  next_element<T>(de: Deserialize<T>): Result<{ $: "Some"; _0: T } | undefined, E> {
    if (this.i >= this.v.length) return Ok(undefined);
    const r = de<E>(new Deserializer<E>(this.v[this.i++]!));
    return r.$ === "Err" ? r : Ok({ $: "Some", _0: r._0 });
  }
}
export class MapAccess<E = string> {
  readonly Error: any = Error;
  entries: [Value, Value][];
  i = 0;
  constructor(m: Entries) { this.entries = m.entries; }
  next_key<K>(de: Deserialize<K>): Result<{ $: "Some"; _0: K } | undefined, E> {
    if (this.i >= this.entries.length) return Ok(undefined);
    const r = de<E>(new Deserializer<E>(this.entries[this.i]![0]));
    return r.$ === "Err" ? r : Ok({ $: "Some", _0: r._0 });
  }
  next_value<V>(de: Deserialize<V>): Result<V, E> {
    return de<E>(new Deserializer<E>(this.entries[this.i++]![1]));
  }
}
export function deserialize_usize<E>(d: Deserializer<E>): Result<number, E> {
  return typeof d.v === "number" ? Ok(d.v) : Err(Error.invalid_type("other", Expected_str("usize")) as E);
}
export function deserialize_String<E>(d: Deserializer<E>): Result<string, E> {
  return typeof d.v === "string" ? Ok(d.v) : Err(Error.invalid_type("other", Expected_str("a string")) as E);
}
export function deserialize_Option<T>(de: Deserialize<T>): Deserialize<T | undefined> {
  return <E,>(d: Deserializer<E>) => (d.v === null ? Ok(undefined) : de(d));
}
export function deserialize_IgnoredAny<E>(_d: Deserializer<E>): Result<null, E> { return Ok(null); }
// serde's private::de::missing_field: \`None\` for an \`Option\`, else \`Error::missing_field\`
export function missing_field<V, E>(de: Deserialize<V>, field: string, _err: unknown): Result<V, E> {
  const r = de<E>(new Deserializer<E>(null));
  return r.$ === "Ok" && r._0 === undefined ? r : Err(Error.missing_field(field) as E);
}
export class Serializer {
  readonly Error = Error;
  serialize_str(v: string) { return Ok(JSON.stringify(v)); }
  serialize_unit_variant(_n: string, _i: number, v: string) { return Ok(JSON.stringify(v)); }
  serialize_newtype_struct<T>(_n: string, v: T, ser: any) { return ser(v, this); }
  serialize_newtype_variant<T>(_n: string, _i: number, variant: string, v: T, ser: any) { const r = ser(v, this); return Ok(\`{\${JSON.stringify(variant)}:\${r._0}}\`); }
  serialize_struct(_n: string, len: number) {
    const parts: string[] = [];
    const self = this;
    return Ok({ serialize_field(k: string, v: any, ser: any) { parts.push(\`\${JSON.stringify(k)}:\${ser(v, self)._0}\`); return Ok(null); }, end() { return Ok(\`{\${parts.join(",")}}#\${len}\`); } });
  }
}
export const serialize_usize = (v: number) => Ok(String(v));
export const serialize_String = (v: string) => Ok(JSON.stringify(v));
export const serialize_Vec = (ser: any) => (v: any[], s: any) => Ok(\`[\${v.map((x) => ser(x, s)._0).join(",")}]\`);
`;

test("emitted TS: struct / newtype / enum serde and #[config_type], run against a minimal serde runtime", async () => {
  const dir = test_scratch_dir("codegen-rustfmt");
  writeFileSync(join(dir, "runtime.ts"), RUNTIME);
  const used = new Set<string>();
  const usize = path("usize");
  const fl = (name: string | null, index: number, ty: PType) => ({ name, index, vis: "pub", ty, attrs: [], docs: [], line: 2 });
  const W = item({ kind: "struct", name: "W", attrs: [derive("Deserialize", "Serialize")], fields: { style: "named", fields: [fl("a", 0, usize), fl("b_c", 1, path("Option", usize))] } });
  const N = item({ kind: "struct", name: "N", attrs: [derive("Deserialize", "Serialize")], fields: { style: "unnamed", fields: [fl(null, 0, path("String"))] } });
  const fnOf = (ty: PType, kind: "de" | "ser"): string => {
    const n = ty.path!.segments[0]!;
    if (n.name === "Option") return kind === "de" ? `deserialize_Option<number>(${fnOf(n.args[0]!.ty!, kind)})` : "serialize_usize";
    const f = `${kind === "de" ? "deserialize" : "serialize"}_${n.name}`;
    used.add(f);
    return f;
  };
  const ctx = (self: string, fields: { name: string | null; index: number }[], cls: boolean): SD.SerdeTsCtx => ({
    use: (_m, n) => (used.add(n), n),
    result: (n) => n,
    deFn: (t) => fnOf(t, "de"),
    serFn: (t) => fnOf(t, "ser"),
    tsType: (t) => (t.path!.segments[0]!.name === "String" ? "string" : t.path!.segments[0]!.name === "Option" ? "number | undefined" : "number"),
    self,
    construct: (vals) => (cls ? `new ${self}(${vals.join(", ")})` : `{ ${fields.map((f, i) => `${f.name ?? `_${f.index}`}: ${vals[i]}`).join(", ")} }`),
    read: (v, f) => `${v}.${f.ts}`,
    at: "test:1",
  });
  const errs: string[] = [];
  const body: string[] = ["export class W { constructor(public a: number, public b_c: number | undefined) {} }", "export interface N { _0: string }"];
  for (const p of SD.serdePlans(W, "w:1", (m) => errs.push(m), (f) => f.name!)) body.push(...SD.renderTs(p, ctx("W", W.fields!.fields, true)));
  for (const p of SD.serdePlans(N, "n:1", (m) => errs.push(m), () => "_0")) body.push(...SD.renderTs(p, ctx("N", N.fields!.fields, false)));
  // a #[config_type] enum
  const C = item({
    kind: "enum",
    name: "C",
    attrs: [{ path: "config_type", text: "config_type" }],
    variants: ["Auto", "Native"].map((name) => ({ name, line: 2, attrs: name === "Native" ? [{ path: "value", text: 'value = "native-nl"', value: "native-nl" }] : [], docs: [], fields: { style: "unit" as const, fields: [] }, discriminant: null })),
  });
  const cp = CT.configTypePlan(C, "c:1", (m) => errs.push(m))!;
  const cctx: CT.ConfigTypeTsCtx = { use: (_m, n) => (used.add(n), n), serde: (_m, n) => (used.add(n), n), configTypeModule: "", at: "c:1", error: (m) => errs.push(m) };
  body.push('export type C = "Auto" | "Native";', "export const debug_C = (v: C) => v;", "export const C = {", ...CT.companionMembers(cp, cctx), "};", ...CT.renderTs(cp, cctx));
  body.push(...SD.BYTES_EQ_HELPER, ...CT.EQ_IGNORE_ASCII_CASE_HELPER);
  expect(errs).toEqual([]);
  const RT = ["type Visitor", "Expected_str", "Deserializer", "SeqAccess", "MapAccess", "deserialize_usize", "deserialize_String", "deserialize_Option", "deserialize_IgnoredAny", "missing_field", "Serializer", "serialize_usize", "serialize_String"];
  const head = [
    `import { Ok, Err, type Result } from "${join(SRC, "std/result.ts")}";`,
    `import { panic } from "${join(SRC, "std/panic.ts")}";`,
    'const PLAIN = { alternate: false };',
    "type ConfigType<T> = { doc_hint(): string; stable_variant(self: T): boolean };",
    `import { ${RT.join(", ")} } from "./runtime.ts";`,
  ];
  writeFileSync(join(dir, "gen.ts"), [...head, ...body].join("\n") + "\n");
  const G = await import(join(dir, "gen.ts"));
  const R = await import(join(dir, "runtime.ts"));
  const de = (fn: (d: unknown) => unknown, v: unknown) => fn(new R.Deserializer(v));
  const m = (...kv: [unknown, unknown][]) => new R.Entries(kv);
  // struct: declaration order, unknown keys ignored, Option fields default to None, errors as serde words them
  const w = de(G.deserialize_W, m(["b_c", 2], ["zzz", "ignored"], ["a", 1])) as { $: string; _0: { a: number; b_c: number } };
  expect(w.$).toBe("Ok");
  expect(w._0).toBeInstanceOf(G.W);
  expect([w._0.a, w._0.b_c]).toEqual([1, 2]);
  expect((de(G.deserialize_W, m(["a", 7])) as { _0: { b_c: unknown } })._0.b_c).toBeUndefined();
  expect(de(G.deserialize_W, m(["b_c", 1]))).toEqual({ $: "Err", _0: "missing field `a`" });
  expect(de(G.deserialize_W, m(["a", 1], ["a", 2]))).toEqual({ $: "Err", _0: "duplicate field `a`" });
  expect(de(G.deserialize_W, [1])).toEqual({ $: "Err", _0: "invalid length 1, expected struct W with 2 elements" });
  expect((de(G.deserialize_W, [3, 4]) as { _0: { a: number; b_c: number } })._0.b_c).toBe(4);
  // field identifiers by index (`visit_u64`) and by bytes (`visit_bytes`); an out-of-range index is ignored
  const byIndex = de(G.deserialize_W, m([0 as never, 5], [1 as never, 6], [2 as never, 7])) as { _0: { a: number; b_c: number } };
  expect([byIndex._0.a, byIndex._0.b_c]).toEqual([5, 6]);
  const byBytes = de(G.deserialize_W, m([new TextEncoder().encode("a") as never, 8], [new TextEncoder().encode("b_") as never, 9])) as { _0: { a: number; b_c: unknown } };
  expect([byBytes._0.a, byBytes._0.b_c]).toEqual([8, undefined]);
  // newtype struct
  expect(de(G.deserialize_N, "x")).toEqual({ $: "Ok", _0: { _0: "x" } });
  expect(de(G.deserialize_N, [])).toEqual({ $: "Err", _0: "invalid length 0, expected tuple struct N with 1 element" });
  // serialize
  const ser = new R.Serializer();
  expect(G.serialize_W(new G.W(1, 2), ser)).toEqual({ $: "Ok", _0: '{"a":1,"b_c":2}#2' });
  expect(G.serialize_N({ _0: "q" }, ser)).toEqual({ $: "Ok", _0: '"q"' });
  // #[config_type]: values (case-insensitive), FromStr / Deserialize errors, Display, doc hint
  expect(de(G.deserialize_C, "NATIVE-NL")).toEqual({ $: "Ok", _0: "Native" });
  expect(de(G.deserialize_C, "Native")).toEqual({ $: "Err", _0: "unknown variant `Native`, expected one of `Auto`, `native-nl`" });
  expect(G.C.from_str("auto")).toEqual({ $: "Ok", _0: "Auto" });
  expect(G.C.from_str("x")).toEqual({ $: "Err", _0: "Bad variant, expected one of: `Auto` `Native`" });
  expect([G.display_C("Native"), G.config_type_C.doc_hint(), G.config_type_C.stable_variant("Auto")]).toEqual(["native-nl", "[Auto|Native]", true]);
  expect(G.serialize_C("Native", ser)).toEqual({ $: "Ok", _0: '"native-nl"' });
});
