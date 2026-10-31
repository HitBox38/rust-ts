// tools/codegen/types.ts: a set-local type map's `fields` (lane followups-34) retypes single fields, by
// `<item key>::<field>` (structs, tuple fields by index) or `<item key>::<Variant>::<field>` (enums), leaving every other
// field of the same Rust type as the global map has it (`u64` -> `number`).
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test_scratch_dir } from "../../src/rust_ts/test_scratch.ts";
import { generate, loadTypeMap, type PAttr, type PField, type PItem, type ProbeJson, type PType, REPO, type SetConfig } from "./types.ts";

const SRC = join(REPO, "src");
const path = (name: string): PType => ({ kind: "path", text: name, path: { global: false, segments: [{ name, args: [] }] } });
const field = (name: string | null, index: number, ty: PType): PField => ({ name, index, vis: "pub", ty, attrs: [], docs: [], line: 10 + index });
const DEBUG: PAttr = { path: "derive", text: "derive (Debug)", derives: ["Debug"] };
const item = (it: Partial<PItem> & Pick<PItem, "kind" | "name" | "line">): PItem => ({ vis: "pub", module: [], attrs: [DEBUG], generics: { params: [], where: [] }, ...it });

test("typemap `fields`: per-field types (struct, tuple and enum fields), other fields untouched", () => {
  const dir = test_scratch_dir("typemap-fields");
  const tm = join(dir, "fields.typemap.json");
  writeFileSync(
    tm,
    JSON.stringify({
      types: [{ paths: ["rust_ts::u64_exact"], ts: "bigint", debug: "debug_int($v, $f)", clone: "copy" }],
      fields: {
        "fake::S::big": "::rust_ts::u64_exact",
        "fake::T::0": "::rust_ts::u64_exact",
        "fake::E::A::addr": "::rust_ts::u64_exact",
        "fake::Absent::x": "::rust_ts::u64_exact",
      },
    }),
  );
  const items: PItem[] = [
    item({ kind: "struct", name: "S", line: 1, fields: { style: "named", fields: [field("big", 0, path("u64")), field("small", 1, path("u64"))] } }),
    item({ kind: "struct", name: "T", line: 2, fields: { style: "unnamed", fields: [field(null, 0, path("u64")), field(null, 1, path("i64"))] } }),
    item({
      kind: "enum",
      name: "E",
      line: 3,
      variants: [
        { name: "A", line: 4, attrs: [], docs: [], fields: { style: "named", fields: [field("addr", 0, path("u64")), field("len", 1, path("u64"))] }, discriminant: null },
        { name: "B", line: 5, attrs: [], docs: [], fields: { style: "named", fields: [field("addr", 0, path("u64"))] }, discriminant: null },
      ],
    }),
  ];
  const probe: ProbeJson = { files: [{ path: "compiler/fake/src/lib.rs", attrs: [], items, uses: [], impls: [], macros: [], mods: [] }] };
  const set: SetConfig = { files: ["compiler/fake/src/lib.rs"], class: [], hand: [], discriminant: [], skip: [], typemap_extra: [relative(import.meta.dir, tm)] };
  const res = generate(probe, set, loadTypeMap(), { set: "fake", out: SRC, srcRoot: SRC });
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  const text = res.files.get(join(SRC, "fake/lib.gen.ts")) ?? "";
  expect(text).toContain("big: bigint;");
  expect(text).toContain("small: number;");
  expect(text).toMatch(/_0: bigint;\s*_1: number;/);
  expect(text).toContain(`{ readonly $: "A"; addr: bigint; len: number }`);
  expect(text).toContain(`{ readonly $: "B"; addr: number }`);
});

test("typemap `fields`: a key naming no field of an item of the set is an error", () => {
  const dir = test_scratch_dir("typemap-fields-typo");
  const tm = join(dir, "fields.typemap.json");
  writeFileSync(tm, JSON.stringify({ types: [{ paths: ["rust_ts::u64_exact"], ts: "bigint", debug: "debug_int($v, $f)", clone: "copy" }], fields: { "fake::S::bgi": "::rust_ts::u64_exact" } }));
  const items: PItem[] = [item({ kind: "struct", name: "S", line: 1, fields: { style: "named", fields: [field("big", 0, path("u64"))] } })];
  const probe: ProbeJson = { files: [{ path: "compiler/fake/src/lib.rs", attrs: [], items, uses: [], impls: [], macros: [], mods: [] }] };
  const set: SetConfig = { files: ["compiler/fake/src/lib.rs"], class: [], hand: [], discriminant: [], skip: [], typemap_extra: [relative(import.meta.dir, tm)] };
  expect(() => generate(probe, set, loadTypeMap(), { set: "fake", out: SRC, srcRoot: SRC })).toThrow("typemap fields: 'fake::S::bgi' names no field of fake::S");
});
