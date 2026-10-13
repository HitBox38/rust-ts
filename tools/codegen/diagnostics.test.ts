// tools/codegen/diagnostics.ts: the derive(Diagnostic)/derive(Subdiagnostic) generator.
// 1. Every derive impl of compiler/rustc_parse/src/diagnostics.rs and compiler/rustc_session/src/diagnostics.rs
//    equals the real rustc_macros expansion (fixtures/diag-expansion.json, written by
//    `bun tools/codegen/diag-expand.ts rustc_parse compiler/rustc_session/src/diagnostics.rs --write-fixture`
//    from `rustc -Zunpretty=expanded`), token for token after canonicalization.
// 2. Regenerating the rustc_parse set from the committed probe JSON reproduces src/rustc_parse/diagnostics.gen.ts.
// 3. Synthetic items: statement order, arg selection, format strings, error paths.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { compare, type ExpandedImpl, FIXTURE, generatedImpls } from "./diag-expand.ts";
import { diagnostic_derive, parseFormatString, renderRust, subdiagnostic_derive, type Tok } from "./diagnostics.ts";
import { generate, loadSet, loadTypeMap, type PFile, type PItem, type ProbeJson, REPO } from "./types.ts";

const fixture = (name: string): ProbeJson => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"));
const haveUpstream = existsSync(join(UPSTREAM, "compiler/rustc_span/src/edition.rs"));

test("generated derive impls equal the rustc_macros expansion (rustc_parse, rustc_session, rustc_attr_parsing)", () => {
  const expansion: Record<string, ExpandedImpl[]> = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const counts: Record<string, number> = {};
  for (const name of ["rustc_parse.typedefs.json", "rustc_session.typedefs.json", "rustc_attr_parsing.typedefs.json"]) {
    for (const file of fixture(name).files) {
      const errors: string[] = [];
      const r = compare(expansion[file.path]!, generatedImpls(file, errors), file.path);
      expect(errors).toEqual([]);
      expect(r.diffs).toEqual([]);
      counts[file.path] = r.same;
    }
  }
  expect(counts).toEqual({
    "compiler/rustc_parse/src/diagnostics.rs": 325,
    "compiler/rustc_session/src/diagnostics.rs": 69,
    "compiler/rustc_attr_parsing/src/diagnostics.rs": 167,
  });
});

test.skipIf(!haveUpstream)("rustc_parse set regenerates src/rustc_parse/diagnostics.gen.ts byte for byte", () => {
  const src = join(REPO, "src");
  const res = generate(fixture("rustc_parse.typedefs.json"), loadSet("rustc_parse"), loadTypeMap(), {
    set: "rustc_parse",
    out: src,
    srcRoot: src,
    pin: JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12),
    upstream: UPSTREAM,
  });
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_diag_arg).toEqual({});
  expect(res.report.unknown_types).toEqual({});
  expect(res.report.files.map((f) => f.diag_impls)).toEqual([325]);
  const path = join(src, "rustc_parse", "diagnostics.gen.ts");
  expect(res.files.get(path)).toBe(readFileSync(path, "utf8"));
});

test.skipIf(!haveUpstream)("rustc_attr_parsing set regenerates src/rustc_attr_parsing/diagnostics.gen.ts byte for byte", () => {
  const src = join(REPO, "src");
  const res = generate(fixture("rustc_attr_parsing.typedefs.json"), loadSet("rustc_attr_parsing"), loadTypeMap(), {
    set: "rustc_attr_parsing",
    out: src,
    srcRoot: src,
    pin: JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12),
    upstream: UPSTREAM,
  });
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_diag_arg).toEqual({});
  expect(res.report.unknown_types).toEqual({});
  expect(res.report.files.map((f) => f.diag_impls)).toEqual([167]);
  const path = join(src, "rustc_attr_parsing", "diagnostics.gen.ts");
  expect(res.files.get(path)).toBe(readFileSync(path, "utf8"));
  // the inline modules `unexpected_cfg_name` / `unexpected_cfg_value` are namespaces (their item names overlap)
  expect(res.files.get(path)!.match(/^export namespace \w+ \{$/gm)).toEqual(["export namespace unexpected_cfg_name {", "export namespace unexpected_cfg_value {"]);
});

// ---- synthetic items -------------------------------------------------------------------------------

const id = (v: string): Tok => ({ t: "ident", v, line: 1, col: 0 });
const p = (v: string): Tok => ({ t: "punct", v, line: 1, col: 0 });
const lit = (s: string): Tok => ({ t: "lit", v: JSON.stringify(s), str: s, suffix: "", line: 1, col: 0 });
const path = (name: string) => ({ kind: "path", text: name, path: { global: false, segments: [{ name, args: [] }] } });
const generic = (outer: string, inner: string) => ({
  kind: "path",
  text: `${outer} < ${inner} >`,
  path: { global: false, segments: [{ name: outer, args: [{ kind: "type", ty: path(inner) }] }] },
});
const attr = (name: string, tokens?: Tok[]) => ({ path: name, text: name, line: 1, col: 0, ...(tokens ? { tokens } : {}) });
const field = (name: string, ty: object, attrs: object[] = [], index = 0) => ({ name, index, vis: "pub", ty, attrs, docs: [], line: 2 });
const struct = (name: string, attrs: object[], fields: object[]): PItem =>
  ({
    kind: "struct",
    name,
    line: 1,
    vis: "pub",
    module: [],
    attrs: [{ path: "derive", text: "derive(Diagnostic)", derives: ["Diagnostic"] }, ...attrs],
    generics: { params: [], where: [] },
    fields: { style: "named", fields },
  }) as unknown as PItem;
const rust = (item: PItem, kind: "Diagnostic" | "Subdiagnostic", errors: string[] = []) => {
  const errs = { error: (m: string) => errors.push(m) };
  const d = kind === "Diagnostic" ? diagnostic_derive(item, "x.rs", errs) : subdiagnostic_derive(item, "x.rs", errs);
  return renderRust(d).map((a) => a.body);
};

test("Diagnostic: Diag::new, formatting_init, preamble, `;`, args (used fields only), then field attributes", () => {
  const item = struct(
    "Ex",
    [attr("diag", [lit("msg {$a}"), p(","), id("code"), p("="), id("E0123")]), attr("note", [lit("n")])],
    [
      field("unused", path("String")),
      field("span", path("Span"), [attr("primary_span"), attr("label", [lit("l {$b}")])]),
      field("a", path("String")),
      field("sugg", generic("Option", "Span"), [attr("suggestion", [lit("s"), p(","), id("code"), p("="), lit("{a}x{{"), p(","), id("applicability"), p("="), lit("maybe-incorrect")])]),
      field("b", path("Symbol")),
      field("flag", path("bool"), [attr("help", [lit("h")])]),
    ],
  );
  expect(rust(item, "Diagnostic")).toEqual([
    [
      'let mut diag = rustc_errors::Diag::new(dcx, level, rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("msg {$a}")));',
      'let __code_0 = [format!("{a}x{{", a = __binding_2)].into_iter();',
      "diag.code(E0123);",
      'diag.note(rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("n")));',
      ";",
      'diag.arg("a", __binding_2);',
      'diag.arg("b", __binding_4);',
      "diag.span(__binding_1);",
      'diag.span_label(__binding_1, rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("l {$b}")));',
      "if let Some(__binding_3) = __binding_3 {",
      '    diag.span_suggestions_with_style(__binding_3, rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("s")), __code_0, rustc_errors::Applicability::MaybeIncorrect, rustc_errors::SuggestionStyle::ShowCode);',
      "}",
      "if __binding_5 {",
      '    diag.help(rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("h")));',
      "}",
      "diag",
    ].join("\n"),
  ]);
});

test("Subdiagnostic: #[applicability] field is taken by the first suggestion only; sub_args are the used plain fields", () => {
  const item = {
    ...struct("Sub", [], []),
    attrs: [
      { path: "derive", text: "", derives: ["Subdiagnostic"] },
      attr("suggestion", [lit("first {$x}"), p(","), id("code"), p("="), lit("c")]),
      attr("suggestion", [lit("second"), p(","), id("code"), p("="), lit("d")]),
    ],
    fields: {
      style: "named",
      fields: [field("span", path("Span"), [attr("primary_span")]), field("appl", path("Applicability"), [attr("applicability")]), field("x", path("u32"))],
    },
  } as unknown as PItem;
  const body = rust(item, "Subdiagnostic")[0]!.split("\n");
  expect(body).toEqual([
    'let __code_0 = [format!("c")].into_iter();',
    'let __code_1 = [format!("d")].into_iter();',
    "let mut sub_args = rustc_errors::DiagArgMap::default();",
    'sub_args.insert("x".into(), rustc_errors::IntoDiagArg::into_diag_arg(__binding_2, &mut diag.long_ty_path));',
    'let __message = rustc_errors::format_diag_message(&rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("first {$x}")), &sub_args);',
    "diag.span_suggestions_with_style(__binding_0, __message, __code_0, __binding_1, rustc_errors::SuggestionStyle::ShowCode);",
    'let __message = rustc_errors::format_diag_message(&rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed("second")), &sub_args);',
    "diag.span_suggestions_with_style(__binding_0, __message, __code_1, rustc_errors::Applicability::Unspecified, rustc_errors::SuggestionStyle::ShowCode);",
  ]);
});

test("error paths of the macro are generator errors", () => {
  const errors: string[] = [];
  rust(struct("Bad", [attr("diag", [lit("Capitalized.")])], [field("s", path("Span"), [attr("bogus")])]), "Diagnostic", errors);
  expect(errors.some((e) => e.includes("starts with an uppercase letter"))).toBe(true);
  expect(errors.some((e) => e.includes("`#[bogus]` is not a valid attribute"))).toBe(true);
  const e2: string[] = [];
  rust(struct("NoMsg", [], []), "Diagnostic", e2);
  expect(e2.some((e) => e.includes("diagnostic message not specified"))).toBe(true);
});

test("format strings", () => {
  expect(parseFormatString("{{ {a} }}x{b:?}")).toEqual([{ lit: "{ " }, { arg: "a", spec: "" }, { lit: " }x" }, { arg: "b", spec: "?" }]);
  expect(typeof parseFormatString("{a")).toBe("string");
});

void ({} as PFile);
