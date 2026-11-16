// tools/codegen/clippy.ts: the committed outputs are what the generator makes from the pinned clippy sources, the counts
// agree with plan-m8 (835 lints, 51 early and 316 late sub-passes), and the parsers expand / reject synthetic invocations
// as the macros would. The oracle comparison (`-Zunpretty=expanded`, clippy-driver `-W help`) is tools/codegen/clippy-oracle.ts.
// Needs the upstream checkout with src/tools/clippy ($RUST_TS_DATA/rust); skips visibly without it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { PREFILL } from "../../src/rustc_span/symbol.gen.ts";
import {
  CONF_PATH,
  DCL_PATH,
  FILE_PREFIX,
  LINTS_SRC,
  SYM_PATH,
  clippyCtx,
  cratePaths,
  emitConf,
  emitModule,
  emitSym,
  generateAll,
  implSelfTypes,
  lintFilesOf,
  parseConf,
  parseModule,
  parseMsrvs,
  parseSym,
  type GenerateResult,
  type Read,
} from "./clippy.ts";

const SKIP = !existsSync(join(UPSTREAM, DCL_PATH));
if (SKIP) console.log("SKIP: upstream checkout without src/tools/clippy (bun scripts/upstream.ts fetch)");

const read: Read = (p) => readFileSync(join(UPSTREAM, p), "utf8");
let cached: GenerateResult | undefined;
const all = (): GenerateResult => (cached ??= generateAll(read, lintFilesOf(), PREFILL));

test.skipIf(SKIP)("committed outputs are up to date; pending ones are absent until their hand modules exist", () => {
  const g = all();
  for (const o of g.outputs) {
    const abs = join(REPO, o.path);
    if (o.needs.some((n) => !existsSync(join(REPO, n)))) expect(existsSync(abs)).toBe(false);
    else expect(readFileSync(abs, "utf8")).toBe(o.text);
  }
});

test.skipIf(SKIP)("counts agree with plan-m8 (835 lints, 51 early and 316 late sub-passes)", () => {
  const g = all();
  expect(g.mods.reduce((n, m) => n + m.lints.length, 0)).toBe(835);
  const [early, late] = g.combined;
  expect(early!.entries.length).toBe(51);
  expect(late!.entries.length).toBe(316);
  // §2d's table: two pre-expansion passes, then every combined-pass field
  const kinds = g.tables.sub_passes.map((r) => r.kind);
  expect(kinds.filter((k) => k === "pre-expansion").length).toBe(2);
  expect(kinds.filter((k) => k === "early").length).toBe(51);
  expect(kinds.filter((k) => k === "late").length).toBe(316);
  // the lint-less late passes (§2a): DumpHir and Author
  expect(g.tables.sub_passes.filter((r) => r.kind === "late" && r.lints.length === 0).map((r) => r.field)).toEqual(["DumpHir", "Author"]);
  // Methods: one sub-pass with many lints (§2d point 5)
  const methods = g.tables.sub_passes.find((r) => r.field === "Methods")!;
  expect(methods.lints.length).toBeGreaterThan(150);
  expect(methods.files[0]).toBe(`${LINTS_SRC}/methods/mod.rs`);
  // every lint is in exactly one category group; clippy::default = complexity + correctness + perf + style + suspicious
  const groups = new Map(g.tables.groups);
  const cats = ["clippy::cargo", "clippy::complexity", "clippy::correctness", "clippy::nursery", "clippy::pedantic", "clippy::perf", "clippy::restriction", "clippy::style", "clippy::suspicious"];
  expect(cats.reduce((n, c) => n + groups.get(c)!.length, 0)).toBe(835);
  const def = ["clippy::complexity", "clippy::correctness", "clippy::perf", "clippy::style", "clippy::suspicious"].reduce((n, c) => n + groups.get(c)!.length, 0);
  expect(groups.get("clippy::default")!.length).toBe(def);
  expect(g.tables.group_aliases).toEqual([["clippy::all", "clippy::default"]]);
  // cognitive_complexity is clippy's one eval_always lint
  const ea = g.mods.flatMap((m) => m.lints).filter((l) => l.decl.fields.get("eval_always") === "true");
  expect(ea.map((l) => l.decl.name)).toEqual(["COGNITIVE_COMPLEXITY"]);
});

test.skipIf(SKIP)("implementing files: module tree, impls of the pass type elsewhere, crate:: references", () => {
  const g = all();
  const row = (f: string) => g.tables.sub_passes.find((r) => r.field === f)!;
  // manual_let_else.rs holds `impl QuestionMark { fn check_manual_let_else .. }`
  expect(row("QuestionMark").files).toEqual([`${LINTS_SRC}/question_mark.rs`, `${LINTS_SRC}/manual_let_else.rs`]);
  // `use crate::methods::is_clone_like` (methods/mod.rs, which uses crate::matches::manual_filter)
  expect(row("ClonedRefToSliceRefs").files).toContain(`${LINTS_SRC}/methods/mod.rs`);
  expect(row("ClonedRefToSliceRefs").files).toContain(`${LINTS_SRC}/matches/manual_filter.rs`);
  // naming only another module's lint static does not tie the files (question_mark.rs: `use crate::question_mark_used::QUESTION_MARK_USED`)
  expect(row("QuestionMark").files).not.toContain(`${LINTS_SRC}/question_mark_used.rs`);
  expect(cratePaths("x.rs", "use crate::{a::{b, c as d}, e::*};\nfn f() { crate::g::h(); }")).toEqual([["a", "b"], ["a", "c"], ["e"], ["g", "h"]]);
  expect(implSelfTypes("impl<'tcx> LateLintPass<'tcx> for Foo<'_> {}\nimpl Bar { }\nimpl<T: X<Y>> Baz<T> where T: Z {}")).toEqual(["Foo", "Bar", "Baz"]);
});

const lintMod = (body: string): string => {
  const cx = clippyCtx(read);
  const m = parseModule(`${LINTS_SRC}/x.rs`, body, cx);
  if (m === undefined) throw new Error("no module");
  return emitModule(m, new Map(m.lints.map((l) => [l.decl.name, m])));
};

test.skipIf(SKIP)("declare_clippy_lint!: arm -> level and category, docs -> explanation, line!() -> location, @eval_always", () => {
  const t = lintMod(`use x;

declare_clippy_lint! {
    /// ### What it does
    #[doc = "a \\"q\\""]
    #[clippy::version = "1.2.3"]
    pub FOO,
    pedantic,
    "the desc",
    @eval_always = true
}
impl_lint_pass!(Foo<'_> => [FOO]);
declare_lint_pass!(
    /// pass doc
    Bar => [FOO]
);
`);
  expect(t).toContain(`// rustc-lint: ${LINTS_SRC}/x.rs:7 FOO`);
  expect(t).toContain(`  name: "clippy::FOO",\n  default_level: "Allow",\n  desc: "the desc",`);
  expect(t).toContain("  report_in_external_macro: true,");
  expect(t).toContain("  eval_always: true,");
  expect(t).toContain(`  category: "Pedantic" as const,\n  explanation: " ### What it does\\na \\"q\\"\\n",`);
  expect(t).toContain(`  location: "${FILE_PREFIX}${LINTS_SRC}/x.rs#L3",\n  version: "1.2.3",`);
  expect(FILE_PREFIX).toBe(`/rustc/${PIN.commit}/`);
  expect(t).toContain("// impl_lint_pass!(Foo<'_> => [FOO])");
  expect(t).toContain("export const Foo_impl_lint_pass = {");
  expect(t).toContain("/// pass doc\n// declare_lint_pass!(Bar => [FOO])");
  expect(t).toContain("export class Bar implements LintPass {");
  // correctness is Deny
  expect(lintMod(`declare_clippy_lint! { #[clippy::version = "1"] pub A, correctness, "d" }`)).toContain(`default_level: "Deny"`);
});

test.skipIf(SKIP)("declare_clippy_lint!: inputs the macro does not match are rejected", () => {
  // the version attribute must follow the docs
  expect(() => lintMod(`declare_clippy_lint! { #[clippy::version = "1"] /// d\n pub A, style, "d" }`)).toThrow(/after #\[clippy::version\]/);
  expect(() => lintMod(`declare_clippy_lint! { /// d\n pub A, style, "d" }`)).toThrow(/clippy::version.*missing/);
  expect(() => lintMod(`declare_clippy_lint! { #[clippy::version = "1"] pub A, nope, "d" }`)).toThrow(/no arm for category `nope`/);
  expect(() => lintMod(`declare_clippy_lint! { #[clippy::version = "1"] pub A, style, "d", }`)).toThrow();
  expect(() => lintMod(`declare_clippy_lint! { #[clippy::version = "1"] #[allow(x)] pub A, style, "d" }`)).toThrow(/does not match/);
  expect(() => lintMod(`impl_lint_pass!(Foo<T> => [A]);`)).toThrow(/only lifetime arguments/);
});

test.skipIf(SKIP)("sym.rs: values per val!, indices per ${index()}, duplicates rejected", () => {
  const e = parseSym(`generate! { A, B: "b c", C: r"\\'", }`);
  expect(e.map((x) => [x.name, x.value])).toEqual([["A", "A"], ["B", "b c"], ["C", "\\'"]]);
  const t = emitSym(e.slice(0, 2), ["x"]);
  expect(t).toContain('export const EXTRA_SYMBOLS: readonly string[] = [\n  "A",\n  "b c",\n];');
  expect(t).toContain("export const B: rustc_span_symbol.Symbol = rustc_span_symbol.Symbol.new(rustc_span_symbol.PREDEFINED_SYMBOLS_COUNT + 1);");
  expect(() => emitSym(parseSym("generate! { A, B: \"A\", }"), [])).toThrow(/already interned/);
  expect(() => emitSym(parseSym("generate! { as_str, }"), ["as_str"])).toThrow(/already interned/);
  expect(() => parseSym("generate! { A }")).toThrow(); // the matcher requires the trailing comma
  expect(parseSym(read(SYM_PATH)).length).toBe(619);
});

test.skipIf(SKIP)("msrvs.rs: msrv_aliases! in source order", () => {
  const { aliases } = parseMsrvs("msrv_aliases! { 1,99,0 { A } 1,2,3 { B, C, } }");
  expect(aliases.map((a) => [a.name, a.version])).toEqual([["A", [1, 99, 0]], ["B", [1, 2, 3]], ["C", [1, 2, 3]]]);
  expect(all().outputs.find((o) => o.path === "src/clippy_utils/msrvs.gen.ts")!.text).toContain("export const BOX_INTO_NON_NULL: RustcVersion = Object.freeze(new RustcVersion(1, 99, 0));");
});

test.skipIf(SKIP)("define_Conf!: ConfField tables; the upstream #[test]s check_conf_order and check_conf_names", () => {
  const entries = parseConf(read(CONF_PATH));
  // check_conf_order: `for [x, y] in NAMES[..NAMES.len() - 1].array_windows() { assert!(x <= y) }` (byte order, as &str's Ord)
  const names = entries.map((e) => e.name_str);
  for (let i = 0; i + 1 < names.length; i++) expect(Buffer.compare(Buffer.from(names[i]!), Buffer.from(names[i + 1]!))).toBeLessThanOrEqual(0);
  // check_conf_names: `stringify!($name).replace('_', "-") == $name_str`
  for (const e of entries) expect(e.name.replaceAll("_", "-")).toBe(e.name_str);
  // a synthetic invocation: rename -> FIELDS / SUGG_NAMES, matcher order enforced
  const src = (body: string): string => read(CONF_PATH).replace(/define_Conf! \{[\s\S]*?\n\}\n/, `define_Conf! {\n${body}\n}\n`);
  const syn = parseConf(src(`/// doc a\n#[lints(x, y)]\na_b("a-b"): u64 = 2,\n#[rename = a_b]\nold("old"),`));
  expect(syn.map((e) => [e.name, e.rename, e.ty, e.default, e.lints])).toEqual([["a_b", undefined, "u64", "2", ["x", "y"]], ["old", "a_b", undefined, undefined, undefined]]);
  const t = emitConf(syn, (p) => (p === CONF_PATH ? src("") : read(p)));
  expect(t).toContain('  NAMES: ["a-b", "old", "third-party"] as readonly string[],');
  expect(t).toContain('  FIELDS: ["a_b", "a_b", "ThirdParty"] as readonly ConfField[],');
  expect(t).toContain('  SUGG_NAMES: ["a-b", "third-party"] as readonly string[],');
  expect(t).toContain('      case "old":\n        return "old";');
  expect(() => parseConf(src(`#[lints(x)]\n/// doc after lints\na("a"): u64,`))).toThrow();
});
