// tools/codegen for the M7 codegen crates (lane codegen-sets-m7): the sets rustc_codegen_ssa (diagnostics.rs, codegen_attrs.rs),
// rustc_codegen_ssa_link (back/link.rs `LinkerOutput`), rustc_codegen_ssa_lib (lib.rs rlink derive(Encodable/Decodable)) and
// rustc_codegen_llvm (diagnostics.rs) regenerate their committed files byte for byte from the typedefs probe; the eight
// `Box<dyn Error>` fields of `ExtractBundledLibsError` are each typed by the error they hold (codegen_ssa.typemap.json `fields`),
// not by the driver's io-error mapping (review driver-cli-2 N3); and the query value types the mono lanes listed are typed.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, UPSTREAM } from "../../scripts/lib/common.ts";
import { generate, loadSet, loadTypeMap, type GenResult, REPO, runProbe } from "./types.ts";

const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_codegen_ssa/src/diagnostics.rs"));
const PROBE = join(DATA, "target", "probes", "release", "typedefs" + (process.platform === "win32" ? ".exe" : ""));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !(HAVE_UPSTREAM && existsSync(PROBE)) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: codegen M7 goldens need the upstream checkout and the typedefs probe; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const SRC = join(REPO, "src");
const PIN = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);

async function gen(name: string): Promise<GenResult> {
  if (!HAVE_UPSTREAM) throw new Error(`ERROR: upstream checkout missing (${UPSTREAM}) and RUST_TS_REQUIRE_PROBES=1`);
  if (!existsSync(PROBE)) throw new Error(`ERROR: typedefs probe not built (${PROBE}) and RUST_TS_REQUIRE_PROBES=1`);
  const set = loadSet(name);
  const probe = await runProbe([...set.files, ...(set.resolve_files ?? [])]);
  return generate(probe, set, loadTypeMap(), { set: name, out: SRC, srcRoot: SRC, pin: PIN, upstream: UPSTREAM });
}

function expectGolden(res: GenResult, files: string[]): void {
  expect([...res.files.keys()].sort()).toEqual(files.map((f) => join(SRC, f)).sort());
  for (const [file, content] of res.files) expect(content).toBe(readFileSync(file, "utf8"));
}

test.skipIf(SKIP)("golden: rustc_codegen_ssa set; ExtractBundledLibsError's Box<dyn Error> fields typed per field", async () => {
  const res = await gen("rustc_codegen_ssa");
  expect(res.report.errors).toEqual([]);
  // `ThorinErrorWrapper(thorin::Error)`: manual `Diagnostic` impl, thorin (split DWARF) is not vendored
  expect(Object.keys(res.report.unknown_types)).toEqual(["thorin::Error"]);
  expect(res.report.missing_diag_arg).toEqual({});
  expectGolden(res, ["rustc_codegen_ssa/codegen_attrs.gen.ts", "rustc_codegen_ssa/diagnostics.gen.ts"]);
  const text = res.files.get(join(SRC, "rustc_codegen_ssa", "diagnostics.gen.ts"))!;
  const ty = /^export type ExtractBundledLibsError =\n((?: {2}\| .*\n)+)/m.exec(text)![1]!;
  const fields = Object.fromEntries([...ty.matchAll(/\$: "(\w+)"; rlib: string; error: (\w+) \}/g)].map((m) => [m[1], m[2]]));
  expect(fields).toEqual({
    OpenFile: "IoError",
    MmapFile: "IoError",
    ParseArchive: "object_read_Error",
    ReadEntry: "object_read_Error",
    ArchiveMember: "object_read_Error",
    ConvertName: "Utf8Error",
    WriteFile: "IoError",
    ExtractSection: "string",
  });
  const body = text.slice(text.indexOf("export function ExtractBundledLibsError_into_diag"));
  const args = [...body.slice(0, body.indexOf("\n}\n")).matchAll(/diag\.arg\("error", IntoDiagArg\.of\(__binding_1, (.+)\)\);/g)].map((m) => m[1]);
  expect(args).toEqual([
    "into_diag_arg_using_display(display_IoError)",
    "into_diag_arg_using_display(display_IoError)",
    "into_diag_arg_using_display(display_Error)",
    "into_diag_arg_using_display(display_Error)",
    "into_diag_arg_using_display(display_Error)",
    "into_diag_arg_using_display((e: Utf8Error) => e.toString())",
    "into_diag_arg_using_display(display_IoError)",
    "into_diag_arg_using_display((s: string) => s)",
  ]);
  expect(text).not.toContain("unported_into_diag_arg");
  // FailedToGetLayout reaches ty/layout.ts (an extension module) lazily
  expect(text).toContain("lazy_rustc_middle_ty_layout().LayoutError_into_diag_arg");
  expect(text).not.toMatch(/^import [^\n]*LayoutError_into_diag_arg/m);
});

test.skipIf(SKIP)("golden: rustc_codegen_ssa_link set (LinkerOutput only)", async () => {
  const res = await gen("rustc_codegen_ssa_link");
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  expect(res.report.missing_diag_arg).toEqual({});
  expectGolden(res, ["rustc_codegen_ssa/back/link.gen.ts"]);
});

test.skipIf(SKIP)("golden: rustc_codegen_ssa_lib set (rlink derive(Encodable/Decodable))", async () => {
  const res = await gen("rustc_codegen_ssa_lib");
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  // codecs not ported yet: emitted as unported (the hand types or their codecs do not exist)
  expect(Object.keys(res.report.missing_decodable).sort()).toEqual(
    ["rust_ts::natvis_debugger_visualizers", "rustc_middle::lint::StableLevelSpec", "rustc_middle::middle::dependency_format::Dependencies"].sort(),
  );
  expect(Object.keys(res.report.missing_encodable).sort()).toEqual(Object.keys(res.report.missing_decodable).sort());
  expect(res.report.files.map((f) => [f.decodable, f.encodable])).toEqual([[9, 9]]);
  expectGolden(res, ["rustc_codegen_ssa/decodable.gen.ts"]);
});

test.skipIf(SKIP)("golden: rustc_codegen_llvm set (diagnostics.rs)", async () => {
  const res = await gen("rustc_codegen_llvm");
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  expect(res.report.missing_diag_arg).toEqual({});
  expect(res.report.files.map((f) => f.diag_impls)).toEqual([30]);
  expectGolden(res, ["rustc_codegen_llvm/diagnostics.gen.ts"]);
});

test("queries.gen.ts: the query values the mono / codegen lanes listed are typed", () => {
  const text = readFileSync(join(SRC, "rustc_middle", "queries.gen.ts"), "utf8");
  const value = (q: string): string => {
    const m = new RegExp(`^ {2}${q}: \\{ Key: [^\\n]*?; Value: (.*); ProvidedValue: `, "m").exec(text);
    if (!m) throw new Error(`ERROR: query ${q} not in queries.gen.ts`);
    return m[1]!;
  };
  expect({
    collect_and_partition_mono_items: value("collect_and_partition_mono_items"),
    codegen_unit: value("codegen_unit"),
    symbol_name: value("symbol_name"),
    codegen_fn_attrs: value("codegen_fn_attrs"),
    sanitizer_settings_for: value("sanitizer_settings_for"),
    hir_crate_items: value("hir_crate_items"),
    impl_trait_header: value("impl_trait_header"),
    constness: value("constness"),
    asyncness: value("asyncness"),
    typeck_root: value("typeck_root"),
    items_of_instance: value("items_of_instance"),
    all_rust_target_features: value("all_rust_target_features"),
    backend_optimization_level: value("backend_optimization_level"),
    symbol_mangling_version: value("symbol_mangling_version"),
  }).toEqual({
    collect_and_partition_mono_items: "MonoItemPartitions",
    codegen_unit: "CodegenUnit",
    symbol_name: "SymbolName",
    codegen_fn_attrs: "CodegenFnAttrs",
    sanitizer_settings_for: "SanitizerFnAttrs",
    hir_crate_items: "ModuleItems",
    impl_trait_header: "ImplTraitHeader",
    constness: "Constness",
    asyncness: "Asyncness",
    typeck_root: "TypeckResults",
    items_of_instance: "Result<[readonly Spanned<MonoItem>[], readonly Spanned<MonoItem>[]], NormalizationErrorInMono>",
    all_rust_target_features: "Map<string, target_features_Stability>",
    backend_optimization_level: "OptLevel",
    symbol_mangling_version: "SymbolManglingVersion",
  });
  // generics_of / reachable_non_generics typed by root's follow-up (docs/reviews/codegen-sets-m7.md); entry_fn stays `unknown`
  // (`EntryFnType` is not in rustc_session config.ts)
  expect(value("generics_of")).toBe("Generics");
  expect(value("reachable_non_generics")).toBe("DefIdMap<SymbolExportInfo>");
  expect(value("entry_fn")).toBe("[DefId, unknown] | undefined");
});
