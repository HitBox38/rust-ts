// tools/codegen for the rustc_attr_ir set: `language_item_table!` expansion, #[derive(PrintAttribute)],
// #[derive(Default)], and the golden (the committed probe JSON regenerates src/rustc_attr_ir/*.gen.ts).
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { macroBody, parseLanguageItemTable, parseLanguageItemTableDef } from "./macros.ts";
import { generate, loadSet, loadTypeMap, REPO } from "./types.ts";

test("language_item_table! rows and definition", () => {
  const src = [
    "macro_rules! language_item_table {",
    "    ($($x:tt)*) => {",
    "        /// All lang items.",
    "        #[derive(Debug, Copy, PrintAttribute)]",
    "        pub enum LangItem { $($variant,)* }",
    "    }",
    "}",
    "language_item_table! {",
    "//  Variant name, Name, Getter method name, Target, Generic requirements;",
    "    Sized,      sym::sized,  sized_trait, Target::Trait,  GenericRequirement::Exact(0);",
    "    /// Doc; with a `;` and a comma, here.",
    "    CloneFn,    sym::clone_fn, clone_fn,  Target::Method(MethodKind::Trait { body: false }), GenericRequirement::None;",
    "    AsyncGenPending, sym::AsyncGenPending, async_gen_pending, Target::AssocConst(AssocCtxt::Impl { of_trait: false }), GenericRequirement::Exact(1);",
    "}",
  ].join("\n");
  const rows = parseLanguageItemTable(macroBody(src, 8)!);
  expect(rows.map((r) => [r.variant, r.name, r.method, r.target, r.generics])).toEqual([
    ["Sized", "sym::sized", "sized_trait", "Target::Trait", "GenericRequirement::Exact(0)"],
    ["CloneFn", "sym::clone_fn", "clone_fn", "Target::Method(MethodKind::Trait { body: false })", "GenericRequirement::None"],
    ["AsyncGenPending", "sym::AsyncGenPending", "async_gen_pending", "Target::AssocConst(AssocCtxt::Impl { of_trait: false })", "GenericRequirement::Exact(1)"],
  ]);
  expect(rows[1]!.docs).toEqual([" Doc; with a `;` and a comma, here."]);
  expect(parseLanguageItemTableDef(src.split("\n").slice(0, 7).join("\n"))).toEqual({ docs: [" All lang items."], derives: ["Debug", "Copy", "PrintAttribute"], name: "LangItem" });
  expect(() => parseLanguageItemTable("A, sym::a, a;")).toThrow();
});

// Missing upstream checkout: a visible skip, or a failure under RUST_TS_REQUIRE_PROBES=1.
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_attr_ir/src/lang_items.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustc_attr_ir golden needs the upstream checkout; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: generator reproduces src/rustc_attr_ir", () => {
  if (!HAVE_UPSTREAM) throw new Error(`ERROR: upstream checkout missing (${UPSTREAM}) and RUST_TS_REQUIRE_PROBES=1`);
  const probe = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_attr_ir.typedefs.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);
  const src = join(REPO, "src");
  const res = generate(probe, loadSet("rustc_attr_ir"), loadTypeMap(), { set: "rustc_attr_ir", out: src, srcRoot: src, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  // the one Debug left unported: `DiagnosticItems.id_to_name: DefIdMap<Symbol>`
  expect(Object.keys(res.report.missing_debug)).toEqual([expect.stringContaining("rustc_span::def_id::DefIdMap")]);
  expect(res.report.missing_clone).toEqual({});
  const sum = (k: "types" | "debug_fns" | "clone_fns" | "print_attrs") => res.report.files.reduce((a, f) => a + f[k], 0);
  expect([res.files.size, sum("types"), sum("debug_fns"), sum("clone_fns"), sum("print_attrs")]).toEqual([9, 80, 77, 70, 60]);
  for (const [file, content] of res.files) expect(content).toBe(readFileSync(file, "utf8"));
  // no stale generated file left on disk
  const onDisk = (readdirSync(join(src, "rustc_attr_ir")) as string[]).filter((f) => f.endsWith(".gen.ts")).map((f) => resolve(src, "rustc_attr_ir", f));
  expect(onDisk.sort()).toEqual([...res.files.keys()].map((f) => resolve(f)).sort());
  // derive(Default): exactly the derive(Default) types (`RtsanSetting` uses `#[derive_const(Default)]`, not generated)
  const all = [...res.files.values()].join("\n");
  expect([...all.matchAll(/^export function default_(\w+)\(/gm)].map((m) => m[1]).sort()).toEqual(
    ["CustomDiagnostic", "DiagnosticItems", "Directive", "DocAttribute", "OptimizeAttr"].sort(),
  );
  // language_item_table!: one LangItem variant, discriminant and row per table row, in table order
  const lang = res.files.get(join(src, "rustc_attr_ir", "lang_items.gen.ts"))!;
  const rows = [...lang.matchAll(/^ {2}\{ variant: "(\w+)"/gm)].map((m) => m[1]);
  expect(rows.length).toBe(226);
  expect(rows.slice(0, 3)).toEqual(["Sized", "MetaSized", "PointeeSized"]);
  expect(lang).toContain(`export const LangItem_discriminant: Record<LangItem, number> = { ${rows.map((r, i) => `${r}: ${i}`).join(", ")} };`);
});
