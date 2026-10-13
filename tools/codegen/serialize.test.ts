// derive(Decodable) / derive(Encodable) in tools/codegen/types.ts (port of compiler/rustc_macros/src/serialize.rs
// `decodable_body` / `encodable_body`): the goldens (rustc_span's derive_only module, the per-file rustc_serialize
// test set), and the derive semantics on a synthetic crate (field order, the variant tag `read_u8` / `read_usize`
// from 255 variants on, single- and zero-variant enums, unit structs, generics, Option-of-Option, arrays, tuples,
// `decodable_construct`, manual impls exported or not by the hand module, missing impls, errors).
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../src/rust_ts/test_scratch.ts";
import { generate, loadSet, loadTypeMap, type PAttr, type PField, type PImpl, type PItem, type ProbeJson, type PType, REPO, type SetConfig } from "./types.ts";

const SRC = join(REPO, "src");
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_span/src/hygiene.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustc_span decodable golden needs the upstream checkout; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: the rustc_span set reproduces src/rustc_span/decodable.gen.ts", () => {
  const probe: ProbeJson = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_span.typedefs.json"), "utf8"));
  const res = generate(probe, loadSet("rustc_span"), loadTypeMap(), { set: "rustc_span", out: SRC, srcRoot: SRC, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_decodable).toEqual({});
  expect(res.report.missing_encodable).toEqual({});
  const f = res.report.files.find((x) => x.out === "rustc_span/decodable.gen.ts")!;
  expect([f.decodable, f.encodable]).toEqual([22, 22]);
  expect(res.files.get(join(SRC, "rustc_span/decodable.gen.ts"))).toBe(readFileSync(join(SRC, "rustc_span/decodable.gen.ts"), "utf8"));
});

test("golden: the rustc_serialize set reproduces src/rustc_serialize/opaque/tests.gen.ts", () => {
  const probe: ProbeJson = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_serialize.typedefs.json"), "utf8"));
  const res = generate(probe, loadSet("rustc_serialize"), loadTypeMap(), { set: "rustc_serialize", out: SRC, srcRoot: SRC, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_decodable).toEqual({});
  expect([...res.files.keys()]).toEqual([join(SRC, "rustc_serialize/opaque/tests.gen.ts")]);
  expect(res.files.get(join(SRC, "rustc_serialize/opaque/tests.gen.ts"))).toBe(readFileSync(join(SRC, "rustc_serialize/opaque/tests.gen.ts"), "utf8"));
});

// ---- a synthetic crate ----
const path = (name: string, ...args: PType[]): PType => ({
  kind: "path",
  text: name,
  path: { global: false, segments: [{ name, args: args.map((ty) => ({ kind: "type", ty })) }] },
});
const field = (name: string | null, index: number, ty: PType): PField => ({ name, index, vis: "pub", ty, attrs: [], docs: [], line: 10 + index });
const derive = (...derives: string[]): PAttr => ({ path: "derive", text: `derive (${derives.join(", ")})`, derives });
const SER = derive("Decodable_NoContext", "Encodable_NoContext");
const item = (it: Partial<PItem> & Pick<PItem, "kind" | "name" | "line">): PItem => ({ vis: "pub", module: [], attrs: [SER], generics: { params: [], where: [] }, ...it });
const unit = (name: string, line: number) => ({ name, line, attrs: [], docs: [], fields: { style: "unit" as const, fields: [] }, discriminant: null });
const u8 = path("u8");

function synth(items: PItem[], extra: Partial<SetConfig> = {}, impls: PImpl[] = [], srcRoot = SRC) {
  const probe: ProbeJson = { files: [{ path: "compiler/fake/src/lib.rs", attrs: [], items, uses: [], impls, macros: [], mods: [] }] };
  const set: SetConfig = { files: ["compiler/fake/src/lib.rs"], class: [], hand: [], discriminant: [], skip: [], derive_decodable: true, derive_encodable: true, ...extra };
  const res = generate(probe, set, loadTypeMap(), { set: "fake", out: SRC, srcRoot });
  const file = extra.derive_only ? "fake/decodable.gen.ts" : "fake/lib.gen.ts";
  return { res, text: res.files.get(join(SRC, file)) ?? "" };
}

test("derive(Decodable)/(Encodable): structs, generics, Option<Option<_>>, arrays, tuples, unit structs", () => {
  const { res, text } = synth([
    item({ kind: "struct", name: "Inner", line: 1, fields: { style: "named", fields: [field("a", 0, path("u32")), field("b", 1, path("bool"))] } }),
    item({
      kind: "struct",
      name: "Outer",
      line: 2,
      generics: { params: [{ kind: "type", name: "T" }], where: [] },
      fields: {
        style: "named",
        fields: [
          field("x", 0, path("T")),
          field("o", 1, path("Option", path("Option", u8))),
          field("arr", 2, { kind: "array", text: "[u8 ; 4]", elem: u8 }),
          field("t", 3, { kind: "tuple", text: "(u8, char)", elems: [u8, path("char")] }),
          field("v", 4, path("Vec", path("Inner"))),
          field("u", 5, { kind: "tuple", text: "()", elems: [] }),
        ],
      },
    }),
    item({ kind: "struct", name: "Unit", line: 3, fields: { style: "unit", fields: [] } }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_decodable).toEqual({});
  expect(res.report.missing_encodable).toEqual({});
  expect(text).toContain(
    [
      "export function decode_Inner(__decoder: Decoder): Inner {",
      "  return {",
      "    a: decode_u32(__decoder),",
      "    b: decode_bool(__decoder),",
      "  };",
      "}",
    ].join("\n"),
  );
  expect(text).toContain(
    [
      "export function decode_Outer<T>(__decoder: Decoder, decode_T: Decodable<T, Decoder>): Outer<T> {",
      "  return {",
      "    x: decode_T(__decoder),",
      "    o: decode_Option_some(__decoder, (__decoder) => decode_Option(__decoder, decode_u8)),",
      "    arr: decode_array(__decoder, 4, decode_u8),",
      "    t: decode_tuple(__decoder, decode_u8, decode_char),",
      "    v: decode_Vec(__decoder, decode_Inner),",
      "    u: decode_unit(__decoder),",
      "  };",
      "}",
    ].join("\n"),
  );
  expect(text).toContain(
    [
      "export function encode_Outer<T>(self: Outer<T>, __encoder: Encoder, encode_T: Encodable<T, Encoder>): void {",
      "  encode_T(self.x, __encoder);",
      "  encode_Option_some(self.o, __encoder, (__v, __encoder) => encode_Option(__v, __encoder, encode_u8));",
      "  encode_array(self.arr, __encoder, encode_u8);",
      "  encode_tuple(self.t, __encoder, encode_u8, encode_char);",
      "  encode_Vec(self.v, __encoder, encode_Inner);",
      "  encode_unit(self.u, __encoder);",
      "}",
    ].join("\n"),
  );
  // unit-like types encode nothing
  expect(text).toContain("export function decode_Unit(__decoder: Decoder): Unit {\n  return {};\n}");
  expect(text).toContain("export function encode_Unit(_self: Unit, __encoder: Encoder): void {\n}");
});

test("derive(Decodable)/(Encodable): enums (tag width, single and zero variants, unit singletons)", () => {
  const big = Array.from({ length: 255 }, (_, i) => unit(`V${i}`, 100 + i));
  const { res, text } = synth([
    item({
      kind: "enum",
      name: "Data",
      line: 1,
      variants: [
        { name: "X", line: 2, attrs: [], docs: [], fields: { style: "unnamed", fields: [field(null, 0, path("u32"))] }, discriminant: null },
        { name: "Y", line: 3, attrs: [], docs: [], fields: { style: "named", fields: [field("z", 0, path("String"))] }, discriminant: null },
        unit("Z", 4),
      ],
    }),
    item({ kind: "enum", name: "Single", line: 5, variants: [{ name: "Only", line: 6, attrs: [], docs: [], fields: { style: "unnamed", fields: [field(null, 0, u8)] }, discriminant: null }] }),
    item({ kind: "enum", name: "Empty", line: 7, variants: [] }),
    // explicit discriminants do not matter: the tag is the variant index
    item({ kind: "enum", name: "Fieldless", line: 8, variants: [{ ...unit("A", 9), discriminant: "7" }, unit("B", 10)] }),
    item({ kind: "enum", name: "Big", line: 11, variants: big }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(text).toContain(
    [
      "export function decode_Data(__decoder: Decoder): Data {",
      "  const __tag = __decoder.read_u8();",
      "  switch (__tag) {",
      "    case 0:",
      '      return { $: "X", _0: decode_u32(__decoder) };',
      "    case 1:",
      '      return { $: "Y", z: decode_String(__decoder) };',
      "    case 2:",
      "      return Data.Z;",
      "    default:",
      "      return panic(`invalid enum variant tag while decoding \\`Data\\`, expected 0..3, actual ${__tag}`);",
      "  }",
      "}",
    ].join("\n"),
  );
  expect(text).toContain(
    [
      "export function encode_Data(self: Data, __encoder: Encoder): void {",
      "  const disc = Data__variant_index(self.$);",
      "  __encoder.emit_u8(disc);",
      "  switch (self.$) {",
      '    case "X":',
      "      encode_u32(self._0, __encoder);",
      "      break;",
      '    case "Y":',
      "      encode_String(self.z, __encoder);",
      "      break;",
      '    case "Z":',
      "      break;",
      "  }",
      "}",
    ].join("\n"),
  );
  // one variant: no tag
  expect(text).toContain('export function decode_Single(__decoder: Decoder): Single {\n  return { $: "Only", _0: decode_u8(__decoder) };\n}');
  expect(text).toContain("export function encode_Single(self: Single, __encoder: Encoder): void {\n  encode_u8(self._0, __encoder);\n}");
  // no variants
  expect(text).toContain("export function decode_Empty(__decoder: Decoder): Empty {\n  return panic(\"`Empty` has no variants to decode\");\n}");
  expect(text).toContain("export function encode_Empty(_self: Empty, __encoder: Encoder): void {\n}");
  // fieldless: strings, variant index (not the discriminant), no second match
  expect(text).toContain('    case 0:\n      return "A";\n    case 1:\n      return "B";');
  expect(text).toContain('function Fieldless__variant_index(tag: Fieldless): number {\n  switch (tag) {\n    case "A":\n      return 0;\n    case "B":\n      return 1;\n  }\n}');
  expect(text).toContain("export function encode_Fieldless(self: Fieldless, __encoder: Encoder): void {\n  const disc = Fieldless__variant_index(self);\n  __encoder.emit_u8(disc);\n}");
  // 255 variants: `read_usize` / `emit_usize`
  expect(text).toContain("export function decode_Big(__decoder: Decoder): Big {\n  const __tag = __decoder.read_usize();");
  expect(text).toContain("  __encoder.emit_usize(disc);");
  expect(text).toContain("expected 0..255, actual ${__tag}");
});

test("derive(Decodable)/(Encodable) of hand types: decodable_construct, field access, manual impls, missing impls, errors", () => {
  const root = test_scratch_dir("codegen-serialize");
  mkdirSync(join(root, "fake"), { recursive: true });
  writeFileSync(join(root, "fake/lib.ts"), "export function decode_Manual(d: unknown): unknown {\n  return d;\n}\n");
  const manualImpl = (name: string, tr: string, line: number): PImpl =>
    ({ trait: tr, self_ty: path(name), module: [], line, attrs: [], fns: [{ name: tr === "Decodable" ? "decode" : "encode", line }] }) as unknown as PImpl;
  const { res, text } = synth(
    [
      item({ kind: "struct", name: "Hash", line: 1, fields: { style: "unnamed", fields: [field(null, 0, path("rustc_hashes::Hash64"))] } }),
      item({ kind: "struct", name: "Manual", line: 2, attrs: [], fields: { style: "unnamed", fields: [field(null, 0, u8)] } }),
      item({ kind: "struct", name: "NoTs", line: 3, attrs: [], fields: { style: "unnamed", fields: [field(null, 0, u8)] } }),
      item({
        kind: "struct",
        name: "User",
        line: 4,
        fields: {
          style: "named",
          fields: [field("m", 0, path("Manual")), field("n", 1, path("NoTs")), field("r", 2, { kind: "ref", text: "& 'tcx u8", elem: u8 }), field("q", 3, path("Mystery"))],
        },
      }),
      item({ kind: "union", name: "U", line: 5, fields: { style: "named", fields: [field("a", 0, u8)] } }),
    ],
    {
      derive_only: true,
      decodable_construct: { "fake::Hash": { expr: "Hash.of($0)", import: ["Hash"] } },
      stable_hash_access: { "fake::Hash::0": { expr: "Hash._0($v)", import: ["Hash"] } },
    },
    [manualImpl("Manual", "Decodable", 20), manualImpl("NoTs", "Decodable", 21)],
    root,
  );
  expect(text).toContain(
    ["export function decode_Hash(__decoder: Decoder): Hash {", "  const __0 = decode_Hash64(__decoder);", "  return Hash.of(__0);", "}"].join("\n"),
  );
  expect(text).toContain("export function encode_Hash(self: Hash, __encoder: Encoder): void {\n  encode_Hash64(Hash._0(self), __encoder);\n}");
  // the manual `decode_Manual` and the construct / access names come from the hand module (under --src-root)
  expect(text).toMatch(/^import \{ decode_Manual, Hash, type U, type User \} from "[./]*\/tmp\/codegen-serialize-[^"]*\/fake\/lib\.ts";$/m);
  expect(text).toContain(
    [
      "export function decode_User(__decoder: Decoder): User {",
      "  return {",
      "    m: decode_Manual(__decoder),",
      "    n: unported_decodable(__decoder),",
      "    r: unported_decodable(__decoder),",
      "    q: unported_decodable(__decoder),",
      "  };",
      "}",
    ].join("\n"),
  );
  expect(res.report.missing_decodable).toEqual({
    "fake::NoTs (manual impl in compiler/fake/src/lib.rs: src/fake/lib.ts exports no decode_NoTs)": ["compiler/fake/src/lib.rs:11"],
    "RefDecodable (reference field & 'tcx u8)": ["compiler/fake/src/lib.rs:12"],
    Mystery: ["compiler/fake/src/lib.rs:13"],
  });
  // the encode side: references encode their referent; `Manual` has no TS `encode_Manual`
  expect(text).toContain("  encode_u8(self.r, __encoder);");
  expect(res.report.missing_encodable["fake::Manual"]).toEqual(["compiler/fake/src/lib.rs:10"]);
  expect(text).toContain('function unported_decodable(..._a: unknown[]): never {\n  return unported("Decodable without a TS impl (see types report)");\n}');
  expect(res.report.errors).toEqual(["compiler/fake/src/lib.rs:5: derive(Decodable/Encodable) on a union"]);
});

test("derive(Decodable): off unless the set opts in, and decodable_types limits it", () => {
  const items = [
    item({ kind: "struct", name: "A", line: 1, fields: { style: "named", fields: [field("x", 0, u8)] } }),
    item({ kind: "struct", name: "B", line: 2, fields: { style: "named", fields: [field("x", 0, u8)] } }),
  ];
  const off = synth(items, { derive_decodable: false, derive_encodable: false });
  expect(off.text).not.toContain("decode_");
  expect(off.text).not.toContain("encode_");
  const some = synth(items, { decodable_types: ["fake::B"] });
  expect(some.text).not.toContain("decode_A");
  expect(some.text).toContain("export function decode_B(");
  expect(some.text).toContain("export function encode_B(");
});
