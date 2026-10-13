// Generated Debug / PrintAttribute (and the hand-ported encode_cross_crate, Attribute/AttributeExt
// queries, LangItem table and Target names) of rustc_attr_ir against the real crates of the pinned
// toolchain: debug_oracle/gen.rs builds the same values with rustc-dev and printed debug_oracle/cases.txt.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MetaItemLit, StrStyle } from "../rustc_ast/lib.ts";
import { RustcVersion } from "../rustc_ast/attr/version.ts";
import type { CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import { DiffActivity, DiffMode } from "../rustc_ast/expand/autodiff_attrs.ts";
import { Printer } from "../rustc_ast_pretty/pp.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { AttrId, create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { debug_Symbol, Ident, PREDEFINED_SYMBOLS_COUNT, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_option, debug_vec, PLAIN, PRETTY } from "../std/fmt.ts";
import {
  Attribute,
  AttributeExt,
  AttributeKind,
  AttrPath,
  type AttrItem,
  debug_Attribute,
  debug_AttributeKind,
  debug_LangItem,
  default_DocAttribute,
  Deprecation,
  display_AttrPath,
  LangItem,
  LangItem_discriminant,
  PartialConstStability,
  type PrintAttribute,
  print_attribute_AttributeKind,
  print_attribute_LangItem,
  ReprC,
  RustcAutodiff,
  Stability,
} from "./lib.ts";
import { default_Directive, Directive, Filter, FilterFormatString, FormatString, NameValue } from "./diagnostic.ts";
import { debug_Target, display_Target, Target } from "./target.ts";

const ORACLE = readFileSync(join(import.meta.dir, "debug_oracle", "cases.txt"), "utf8");

function pa<T>(t: PrintAttribute<T>, v: T): string {
  const p = Printer.new();
  t.print_attribute(v, p);
  return p.eof();
}

function render(): string {
  return create_default_session_globals_then(() => {
    let out = "";
    const println = (s: string) => (out += s + "\n");
    const s = (x: string) => Symbol.intern(x);
    const sp = DUMMY_SP;

    const show = <T>(name: string, v: T, debug: Debug<T>, print: PrintAttribute<T>) => {
      println(`== ${name}`);
      println(debug(v, PLAIN));
      println(debug(v, PRETTY));
      println(`-- print_attribute (should_render: ${print.should_render(v)})`);
      println(pa(print, v));
    };
    const kind = (name: string, k: AttributeKind) => {
      show(name, k, debug_AttributeKind, print_attribute_AttributeKind);
      println(`-- encode_cross_crate: ${AttributeKind.encode_cross_crate(k)}, is_extern_indicator: ${AttributeKind.is_extern_indicator(k)}`);
    };

    kind("Repr", {
      $: "Repr",
      reprs: [
        [ReprC, sp],
        [{ $: "ReprInt", _0: { $: "UnsignedInt", _0: "U8" } }, sp],
        [{ $: "ReprTransparent" }, sp],
      ],
      first_span: sp,
    });
    kind("Inline", { $: "Inline", _0: { $: "Force", attr_span: sp, reason: s("why") }, _1: sp });
    kind("InlineHint", { $: "Inline", _0: { $: "Hint" }, _1: sp });
    kind("Deprecated", {
      $: "Deprecated",
      deprecation: new Deprecation({ $: "NonStandard", _0: s("1.0") }, Ident.with_dummy_span(s("use bar")), undefined),
      span: sp,
    });
    kind("DeprecatedVersion", {
      $: "Deprecated",
      deprecation: new Deprecation({ $: "RustcVersion", _0: new RustcVersion(1, 2, 3) }, undefined, s("bar")),
      span: sp,
    });
    kind("Stability", {
      $: "Stability",
      stability: new Stability({ $: "Unstable", reason: { $: "Some", _0: s("not yet") }, issue: 123, implied_by: undefined, old_name: s("old") }, s("my_feature")),
      span: sp,
    });
    kind("RustcConstStability", {
      $: "RustcConstStability",
      stability: new PartialConstStability(
        { $: "Stable", since: { $: "Version", _0: new RustcVersion(1, 80, 0) }, allowed_through_unstable_modules: [s("msg"), s("path::to")] },
        s("const_feature"),
        false,
      ),
      span: sp,
    });
    kind("MacroUse", { $: "MacroUse", span: sp, arguments: { $: "UseSpecific", _0: [Ident.with_dummy_span(s("a")), Ident.with_dummy_span(s("b"))] } });
    kind("MacroUseAll", { $: "MacroUse", span: sp, arguments: { $: "UseAll" } });
    kind("DocComment", { $: "DocComment", style: "Outer", kind: { $: "Sugared", _0: "Line" }, span: sp, comment: s(" hello") });
    kind("DocCommentRaw", { $: "DocComment", style: "Inner", kind: { $: "Raw", _0: sp }, span: sp, comment: s("x") });
    kind("LangPartialEq", { $: "Lang", _0: "PartialEq" });
    kind("LangPanicImpl", { $: "Lang", _0: "PanicImpl" });
    const doc = default_DocAttribute();
    doc.aliases.set(s("alias1"), sp);
    doc.hidden = sp;
    doc.inline = ["NoInline", sp];
    doc.keyword = [s("kw"), sp];
    doc.auto_cfg_change = [[true, sp]];
    kind("Doc", { $: "Doc", _0: doc });
    kind("DocDefault", { $: "Doc", _0: default_DocAttribute() });
    const directive = new Directive(
      true,
      [
        [
          new Filter(sp, {
            $: "All",
            _0: [
              { $: "Flag", _0: "CrateLocal" },
              {
                $: "Not",
                _0: {
                  $: "Match",
                  _0: new NameValue({ $: "GenericArg", _0: s("T") }, new FilterFormatString([{ $: "Lit", _0: s("&[") }, { $: "Arg", _0: s("A") }])),
                },
              },
              { $: "Any", _0: [{ $: "Match", _0: new NameValue({ $: "SelfUpper" }, new FilterFormatString([])) }] },
            ],
          }),
          default_Directive(),
        ],
      ],
      [
        sp,
        new FormatString(s("the {T} for {This}"), sp, [
          { $: "Lit", _0: s("the ") },
          { $: "Arg", _0: { $: "GenericParam", generic_param: s("T"), span: sp } },
          { $: "Lit", _0: s(" for ") },
          { $: "Arg", _0: { $: "This" } },
          { $: "Arg", _0: { $: "AsIs", _0: s("x") } },
        ]),
      ],
      undefined,
      [new FormatString(s("n"), sp, [{ $: "Arg", _0: { $: "SelfUpper" } }])],
      undefined,
    );
    kind("OnUnimplemented", { $: "OnUnimplemented", directive });
    kind("OnUnknownNone", { $: "OnUnknown", directive: undefined });
    const cfg_all: CfgEntry = {
      $: "All",
      _0: [
        { $: "NameValue", name: s("feature"), value: s("x"), span: sp },
        { $: "Not", _0: { $: "Version", _0: new RustcVersion(1, 70, 0), _1: sp }, _1: sp },
      ],
      _1: sp,
    };
    kind("CfgTrace", {
      $: "CfgTrace",
      _0: [
        [{ $: "Bool", _0: true, _1: sp }, sp],
        [cfg_all, sp],
      ],
    });
    kind("RustcMir", {
      $: "RustcMir",
      _0: [{ $: "BorrowckGraphvizPostflow", path: "a/b.dot" }, { $: "PeekLiveness" }, { $: "BorrowckGraphvizFormat", format: "TwoPhase" }],
    });
    kind("CustomMir", { $: "CustomMir", _0: ["Built", sp], _1: undefined });
    kind("Coverage", { $: "Coverage", _0: "Off" });
    kind("Optimize", { $: "Optimize", _0: "Speed", _1: sp });
    kind("ProcMacroDerive", { $: "ProcMacroDerive", trait_name: s("Foo"), helper_attrs: [s("foo"), s("bar")] });
    kind("LinkOrdinal", { $: "LinkOrdinal", ordinal: 7, span: sp });
    kind("PatchableFunctionEntry", { $: "PatchableFunctionEntry", prefix: 1, entry: undefined, section: s(".text") });
    kind("RustcLegacyConstGenerics", { $: "RustcLegacyConstGenerics", fn_indexes: [[0, sp], [2, sp]], attr_span: sp });
    kind("RustcSkipDuringMethodDispatch", { $: "RustcSkipDuringMethodDispatch", array: true, boxed_slice: false });
    kind("Cold", AttributeKind.Cold);
    kind("NoMangle", { $: "NoMangle", _0: sp });
    kind("Feature", { $: "Feature", _0: [Ident.with_dummy_span(s("f1"))], _1: sp });
    kind("RustcAutodiff", {
      $: "RustcAutodiff",
      _0: new RustcAutodiff(DiffMode.Reverse, 1, [DiffActivity.Active, { $: "FakeActivitySize", _0: 3 }], DiffActivity.None),
    });
    kind("UnstableRemoved", {
      $: "UnstableRemoved",
      _0: [{ feature: s("gone"), reason: s("removed"), link: s("https://example.com"), since: new RustcVersion(1, 0, 0) }],
    });
    kind("RustcCguTestAttr", { $: "RustcCguTestAttr", _0: [[sp, { $: "ExpectedCguReuse", cfg: s("cfail1"), module: s("m"), kind: "PreDashLto" }]] });
    kind("EiiDeclaration", {
      $: "EiiDeclaration",
      _0: { foreign_item: new DefId(DefIndex.from_u32(5), LOCAL_CRATE), impl_unsafe: false, name: Ident.with_dummy_span(s("eii")) },
    });
    kind("RustcMacroTransparency", { $: "RustcMacroTransparency", _0: "SemiOpaque" });
    kind("Used", { $: "Used", used_by: "Linker" });
    kind("CrateName", { $: "CrateName", name: s("krate"), name_span: sp, attr_span: sp });
    kind("RustcDumpLayout", { $: "RustcDumpLayout", _0: ["Align", "Size"] });
    kind("RustcClean", {
      $: "RustcClean",
      _0: [{ span: sp, cfg: s("rpass2"), except: { entries: [s("hir_owner"), s("typeck")], span: sp }, loaded_from_disk: undefined }],
    });
    kind("RegisterTool", { $: "RegisterTool", attr_tools: [], lint_tools: [Ident.with_dummy_span(s("clippy"))] });

    const item = (segments: Symbol[], args: AttrItem["args"], id: number, style: AttrItem["style"]): AttrItem => ({
      path: new AttrPath(segments, sp),
      args,
      id: { attr_id: AttrId.from_u32(id) },
      style,
      span: sp,
    });
    const unparsed: Attribute = {
      $: "Unparsed",
      _0: item([s("rustfmt"), s("skip")], { $: "Eq", eq_span: sp, expr: new MetaItemLit(s("v"), undefined, { $: "Str", _0: s("v"), _1: StrStyle.Cooked }, sp) }, 5, "Inner"),
    };
    const word: Attribute = { $: "Unparsed", _0: item([s("my_tool")], { $: "Empty" }, 0, "Outer") };
    const parsed: Attribute = { $: "Parsed", _0: AttributeKind.AutomaticallyDerived };
    const sym_opt = (v: Symbol | undefined) => debug_option(v, PLAIN, debug_Symbol);
    for (const [name, a] of [
      ["Unparsed", unparsed],
      ["UnparsedWord", word],
      ["Parsed", parsed],
    ] as const) {
      println(`== Attribute ${name}`);
      println(debug_Attribute(a, PLAIN));
      println(debug_Attribute(a, PRETTY));
      println(
        `-- is_parsed_attr ${Attribute.is_parsed_attr(a)} name ${sym_opt(Attribute.name(a))} path ${debug_vec(Attribute.path(a), PLAIN, debug_Symbol)} is_word ${Attribute.is_word(a)} value_str ${sym_opt(Attribute.value_str(a))} doc_str ${sym_opt(Attribute.doc_str(a))} is_proc_macro_attr ${Attribute.is_proc_macro_attr(a)} is_automatically_derived_attr ${AttributeExt.Attribute.is_automatically_derived_attr(a)}`,
      );
    }
    if (unparsed.$ === "Unparsed") println(`== AttrPath Display\n${display_AttrPath(unparsed._0.path)}`);

    println("== LangItem table (from_name over the predefined symbols)");
    println(`variant_count ${Object.keys(LangItem_discriminant).length}`);
    for (let i = 0; i < PREDEFINED_SYMBOLS_COUNT; i++) {
      const sym = Symbol.new(i);
      const item = LangItem.from_name(sym);
      if (item !== undefined) {
        const r = LangItem.required_generics(item);
        const g = r.$ === "None" ? "None" : `${r.$}(${r._0})`;
        println(
          `${i}\t${debug_LangItem(item, PLAIN)}\t${debug_Symbol(LangItem.name(item), PLAIN)}\t${LangItem.variant_name(item)}\t${debug_Target(LangItem.target(item), PLAIN)}\t${g}\t${debug_bool(LangItem.is_weak(item), PLAIN)}\t${sym_opt(LangItem.link_name(item))}\t${pa(print_attribute_LangItem, item)}`,
        );
      }
    }
    println("== Target");
    const targets: Target[] = [
      Target.Fn,
      { $: "Impl", of_trait: true },
      { $: "Impl", of_trait: false },
      { $: "Method", _0: { $: "Trait", body: true } },
      { $: "Method", _0: { $: "TraitImpl" } },
      { $: "AssocTy", _0: { $: "Trait" } },
      { $: "Delegation", mac: true },
    ];
    for (const t of targets) println(`${debug_Target(t, PLAIN)}\t${display_Target(t)}\t${Target.plural_name(t)}\t${Target.is_associated_item(t)}`);
    return out;
  });
}

test("rustc_attr_ir Debug / PrintAttribute / queries equal the rustc-dev oracle (debug_oracle/cases.txt)", () => {
  const got = render();
  const want = ORACLE;
  if (got !== want) {
    const g = got.split("\n");
    const w = want.split("\n");
    let i = 0;
    while (i < g.length && i < w.length && g[i] === w[i]) i++;
    expect(`first difference at line ${i + 1}: ${g[i]}`).toBe(`first difference at line ${i + 1}: ${w[i]}`);
  }
  expect(got.length).toBe(want.length);
});
