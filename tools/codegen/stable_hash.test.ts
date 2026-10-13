// derive(StableHash) in tools/codegen/types.ts (port of compiler/rustc_macros/src/stable_hash.rs):
// the rustc_span golden, and the derive semantics on a synthetic crate (field order, `#[stable_hash(ignore)]`,
// `#[stable_hash(project(..))]`, generic parameters, `mem::discriminant` with explicit discriminants and
// `#[repr(u8)]`, data enums, Option-of-Option, `[u8]`/`Vec<u8>`, errors).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { generate, loadSet, loadTypeMap, type PAttr, type PField, type PItem, type ProbeJson, type PType, REPO, type SetConfig } from "./types.ts";

const SRC = join(REPO, "src");

// The golden expands rustc_span's item macros from the upstream checkout: a visible skip without it,
// a failure under RUST_TS_REQUIRE_PROBES=1.
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_span/src/hygiene.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustc_span stable_hash golden needs the upstream checkout; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: the rustc_span set reproduces src/rustc_span/stable_hash.gen.ts", () => {
  const probe: ProbeJson = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_span.typedefs.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);
  const res = generate(probe, loadSet("rustc_span"), loadTypeMap(), { set: "rustc_span", out: SRC, srcRoot: SRC, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_stable_hash).toEqual({});
  // derive_only: no per-file type modules, only the derive modules (decodable.gen.ts: tools/codegen/serialize.test.ts)
  expect([...res.files.keys()]).toEqual([join(SRC, "rustc_span/stable_hash.gen.ts"), join(SRC, "rustc_span/decodable.gen.ts")]);
  expect(res.report.files.reduce((a, f) => a + f.stable_hash, 0)).toBe(20);
  expect(res.files.get(join(SRC, "rustc_span/stable_hash.gen.ts"))).toBe(readFileSync(join(SRC, "rustc_span/stable_hash.gen.ts"), "utf8"));
});

// ---- a synthetic crate ----
const path = (name: string, ...args: PType[]): PType => ({
  kind: "path",
  text: name,
  path: { global: false, segments: [{ name, args: args.map((ty) => ({ kind: "type", ty })) }] },
});
const field = (name: string | null, index: number, ty: PType, attrs: PAttr[] = []): PField => ({ name, index, vis: "pub", ty, attrs, docs: [], line: 10 + index });
const derive: PAttr = { path: "derive", text: "derive (StableHash)", derives: ["StableHash"] };
const item = (it: Partial<PItem> & Pick<PItem, "kind" | "name" | "line">): PItem => ({ vis: "pub", module: [], attrs: [derive], generics: { params: [], where: [] }, ...it });
const sh = (text: string): PAttr => ({ path: "stable_hash", text });

function synth(items: PItem[], extra: Partial<SetConfig> = {}) {
  const probe: ProbeJson = {
    files: [{ path: "compiler/fake/src/lib.rs", attrs: [], items, uses: [], impls: [], macros: [], mods: [] }],
  };
  const set: SetConfig = { files: ["compiler/fake/src/lib.rs"], class: [], hand: [], discriminant: [], skip: [], derive_only: true, derive_stable_hash: true, ...extra };
  const res = generate(probe, set, loadTypeMap(), { set: "fake", out: SRC, srcRoot: SRC });
  return { res, text: res.files.get(join(SRC, "fake/stable_hash.gen.ts")) ?? "" };
}

test("derive(StableHash): structs, ignore, project, generics, enums, discriminants", () => {
  const u8 = path("u8");
  const { res, text } = synth([
    item({ kind: "struct", name: "Inner", line: 1, fields: { style: "named", fields: [field("name", 0, path("u32")), field("other", 1, path("bool"))] } }),
    item({
      kind: "struct",
      name: "Outer",
      line: 2,
      generics: { params: [{ kind: "type", name: "T" }], where: [] },
      fields: {
        style: "named",
        fields: [
          field("a", 0, u8),
          field("b", 1, path("u16"), [sh("stable_hash (ignore)")]),
          field("c", 2, path("Inner"), [sh("stable_hash (project (name))")]),
          field("d", 3, path("T")),
          field("e", 4, path("Option", path("Option", u8))),
          field("f", 5, { kind: "array", text: "[u8; 4]", elem: u8 }),
          field("g", 6, path("Vec", u8)),
          field("h", 7, { kind: "tuple", text: "(u8, char)", elems: [u8, path("char")] }),
        ],
      },
    }),
    item({ kind: "struct", name: "Unit", line: 3, fields: { style: "unit", fields: [] } }),
    item({
      kind: "enum",
      name: "Repr",
      line: 4,
      attrs: [derive, { path: "repr", text: "repr (u8)", repr: ["u8"] }],
      variants: [
        { name: "A", line: 5, attrs: [], docs: [], fields: { style: "unit", fields: [] }, discriminant: "3" },
        { name: "B", line: 6, attrs: [], docs: [], fields: { style: "unit", fields: [] }, discriminant: null },
        { name: "C", line: 7, attrs: [], docs: [], fields: { style: "unit", fields: [] }, discriminant: "10" },
      ],
    }),
    item({
      kind: "enum",
      name: "Data",
      line: 8,
      variants: [
        { name: "X", line: 9, attrs: [], docs: [], fields: { style: "unnamed", fields: [field(null, 0, path("u32"))] }, discriminant: null },
        { name: "Y", line: 10, attrs: [], docs: [], fields: { style: "named", fields: [field("z", 0, path("String")), field("w", 1, u8, [sh("stable_hash (ignore)")])] }, discriminant: null },
        { name: "Z", line: 11, attrs: [], docs: [], fields: { style: "unit", fields: [] }, discriminant: null },
      ],
    }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_stable_hash).toEqual({});
  expect(text).toContain(
    [
      "export function stable_hash_Inner(self: Inner, __hcx: StableHashCtxt, __hasher: StableHasher): void {",
      "  stable_hash_u32(self.name, __hcx, __hasher);",
      "  stable_hash_bool(self.other, __hcx, __hasher);",
      "}",
    ].join("\n"),
  );
  expect(text).toContain(
    [
      "export function stable_hash_Outer<T>(self: Outer<T>, __hcx: StableHashCtxt, __hasher: StableHasher, stable_hash_T: StableHash<T>): void {",
      "  stable_hash_u8(self.a, __hcx, __hasher);",
      // `b` ignored; `c` projected to `c.name`
      "  stable_hash_u32(self.c.name, __hcx, __hasher);",
      "  stable_hash_T(self.d, __hcx, __hasher);",
      "  stable_hash_Option_some(self.e, __hcx, __hasher, (__v, __hcx, __hasher) => stable_hash_Option(__v, __hcx, __hasher, stable_hash_u8));",
      "  stable_hash_bytes(self.f, __hcx, __hasher);",
      "  stable_hash_bytes(self.g, __hcx, __hasher);",
      "  stable_hash_tuple2(self.h, __hcx, __hasher, stable_hash_u8, stable_hash_char);",
      "}",
    ].join("\n"),
  );
  expect(text).toContain("export function stable_hash_Unit(_self: Unit, __hcx: StableHashCtxt, __hasher: StableHasher): void {\n}");
  expect(text).toContain(
    [
      "const Repr__discriminant = { A: 3, B: 4, C: 10 } as const;",
      "export function stable_hash_Repr(self: Repr, __hcx: StableHashCtxt, __hasher: StableHasher): void {",
      '  stable_hash_Discriminant(Repr__discriminant[self], __hcx, __hasher, "u8");',
      "}",
    ].join("\n"),
  );
  expect(text).toContain(
    [
      "const Data__discriminant = { X: 0, Y: 1, Z: 2 } as const;",
      "export function stable_hash_Data(self: Data, __hcx: StableHashCtxt, __hasher: StableHasher): void {",
      "  stable_hash_Discriminant(Data__discriminant[self.$], __hcx, __hasher);",
      "  switch (self.$) {",
      '    case "X":',
      "      stable_hash_u32(self._0, __hcx, __hasher);",
      "      break;",
      '    case "Y":',
      "      stable_hash_String(self.z, __hcx, __hasher);",
      "      break;",
      '    case "Z":',
      "      break;",
      "  }",
      "}",
    ].join("\n"),
  );
});

test("derive(StableHash): unknown field types are unported (reported), bad attributes and unions are errors", () => {
  const { res, text } = synth([
    item({ kind: "struct", name: "S", line: 1, fields: { style: "named", fields: [field("x", 0, path("Mystery")), field("y", 1, path("u8"), [sh("stable_hash (bogus)")])] } }),
    item({ kind: "union", name: "U", line: 2, fields: { style: "named", fields: [field("a", 0, path("u8"))] } }),
  ]);
  expect(res.report.missing_stable_hash).toEqual({ Mystery: ["compiler/fake/src/lib.rs:10"] });
  expect(text).toContain("  unported_stable_hash(self.x);");
  expect(res.report.errors).toEqual(["compiler/fake/src/lib.rs:11: error parsing stable_hash (#[stable_hash (bogus)])", "compiler/fake/src/lib.rs:2: derive(StableHash) on a union"]);
});
