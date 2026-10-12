// Debug of hand-built rustc_ast values vs. span-free subtrees of the oracle's
// `rustc +nightly -Zunpretty=ast-tree[,expanded]` output (lane ast-types; not an upstream test file).
import { expect, test } from "bun:test";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { debug_Ident, Ident, Symbol } from "../rustc_span/symbol.ts";
import { type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { CRATE_NODE_ID, debug_NodeId, NodeId } from "./node_id.ts";

// PORT: the generated modules import `debug_Span` (span_encoding.ts) and `debug_AttrId` (lib.ts),
// which lane span-wire adds. Until then the modules cannot be linked and these tests are skipped.
let A: typeof import("./ast.ts") | undefined;
let T: typeof import("./token.ts") | undefined;
let TS: typeof import("./tokenstream.ts") | undefined;
let F: typeof import("./format.ts") | undefined;
let IR: typeof import("../rustc_ast_ir/lib.ts") | undefined;
try {
  A = await import("./ast.ts");
  T = await import("./token.ts");
  TS = await import("./tokenstream.ts");
  F = await import("./format.ts");
  IR = await import("../rustc_ast_ir/lib.ts");
} catch (e) {
  if (!(e instanceof SyntaxError && /Export named 'debug_(Span|AttrId)'/.test(String(e)))) throw e;
}
const t = A ? test : test.skip;
// PORT: tests interning symbols need session globals; skipped while rustc_span leaves them unported.
const globals_ok = (() => {
  try {
    create_default_session_globals_then(() => {});
    return true;
  } catch (e) {
    if (e instanceof Unported) return false;
    throw e;
  }
})();
const tg = A && globals_ok ? test : test.skip;
// `Ident` Debug needs `Span::ctxt` (rustc_span lanes).
const ctxt_ok =
  globals_ok &&
  (() => {
    try {
      create_default_session_globals_then(() => debug_Ident(Ident.from_str("x"), PLAIN));
      return true;
    } catch (e) {
      if (e instanceof Unported) return false;
      throw e;
    }
  })();
const tc = A && ctxt_ok ? test : test.skip;

/** Strip the common indentation of an oracle excerpt. */
function dedent(s: string): string {
  const lines = s.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(ind)).join("\n");
}
const run = <R>(f: () => R): R => create_default_session_globals_then(f);

t("FnHeader (fn f<'a>(..))", () => {
  const { FnHeader, Const, Safety, Extern, debug_FnHeader } = A!;
  const h = new FnHeader(Const.No, undefined, Safety.Default, Extern.None);
  expect(debug_FnHeader(h, PRETTY)).toBe(
    dedent(`
                        header: FnHeader {
                            constness: No,
                            coroutine_marker: None,
                            safety: Default,
                            ext: None,
                        },`).replace(/^header: /, "").replace(/,$/, ""),
  );
  expect(debug_FnHeader(h, PLAIN)).toBe("FnHeader { constness: No, coroutine_marker: None, safety: Default, ext: None }");
});

t("BindingMode(No, Not)", () => {
  const { BindingMode, ByRef, debug_BindingMode } = A!;
  const m = new BindingMode(ByRef.No, "Not");
  expect(debug_BindingMode(m, PRETTY)).toBe("BindingMode(\n    No,\n    Not,\n)");
});

t("VisibilityKind: Inherited, Public", () => {
  const { VisibilityKind, debug_VisibilityKind } = A!;
  expect(debug_VisibilityKind(VisibilityKind.Inherited, PRETTY)).toBe("Inherited");
  expect(debug_VisibilityKind(VisibilityKind.Public, PRETTY)).toBe("Public");
});

tg("manual Debug: Lifetime (inline even under {:#?})", () =>
  run(() => {
    const lt = { id: NodeId.MAX, ident: Ident.new(Symbol.intern("'a"), DUMMY_SP) };
    expect(A!.debug_Lifetime(lt, PRETTY)).toBe("lifetime(4294967040: 'a)");
  }));

tc("manual Debug: Label (inline even under {:#?})", () =>
  run(() => {
    expect(A!.debug_Label({ ident: Ident.new(Symbol.intern("'outer"), DUMMY_SP) }, PRETTY)).toBe("label('outer#0)");
  }));

t("manual Debug: ImplPolarity", () => {
  const { ImplPolarity, debug_ImplPolarity } = A!;
  expect(debug_ImplPolarity(ImplPolarity.Positive, PRETTY)).toBe('"positive"');
  expect(debug_ImplPolarity({ $: "Negative", _0: DUMMY_SP }, PRETTY)).toBe('"negative"');
});

t("bitflags!: InlineAsmOptions", () => {
  const { InlineAsmOptions: O, debug_InlineAsmOptions } = A!;
  // asm!("nop", options(nomem, nostack)) / asm!("nop")  (ast-tree,expanded)
  expect(debug_InlineAsmOptions(O.union(O.NOMEM, O.NOSTACK), PRETTY)).toBe("NOMEM | NOSTACK");
  expect(debug_InlineAsmOptions(O.empty(), PRETTY)).toBe("");
  // bitflags::parser::to_writer: unknown bits as `0x..` after the names
  expect(debug_InlineAsmOptions(O.from_bits_retain(0x8001), PLAIN)).toBe("PURE | 0x8000");
  expect(O.contains(O.all(), O.MAY_UNWIND)).toBe(true);
  expect(O.bits(O.all())).toBe(0x1ff);
});

test("newtype_index!: NodeId", () => {
  expect(debug_NodeId(NodeId.MAX, PRETTY)).toBe("NodeId(4294967040)");
  expect(debug_NodeId(CRATE_NODE_ID, PLAIN)).toBe("NodeId(0)");
});

t("rustc_ast_ir: IntTy/UintTy/FloatTy Debug = name_str", () => {
  expect(IR!.debug_IntTy("I64", PRETTY)).toBe("i64");
  expect(IR!.debug_UintTy("U8", PRETTY)).toBe("u8");
  expect(IR!.debug_FloatTy("F32", PRETTY)).toBe("f32");
  expect(IR!.IntTy.Isize).toBe("Isize");
});

tg("token::Lit and TokenKind::Ident", () =>
  run(() => {
    const { Lit, LitKind, debug_Lit, debug_TokenKind } = T!;
    const lit = new Lit(LitKind.Integer, Symbol.intern("1"), Symbol.intern("u8"));
    expect(debug_Lit(lit, PRETTY)).toBe(
      dedent(`
                                            Lit {
                                                kind: Integer,
                                                symbol: "1",
                                                suffix: Some(
                                                    "u8",
                                                ),
                                            }`),
    );
    expect(debug_Lit(lit, PLAIN)).toBe('Lit { kind: Integer, symbol: "1", suffix: Some("u8") }');
    expect(debug_TokenKind({ $: "Ident", _0: Symbol.intern("foo"), _1: "Normal" }, PLAIN)).toBe('Ident("foo", Normal)');
    expect(debug_TokenKind({ $: "Literal", _0: lit }, PLAIN)).toBe('Literal(Lit { kind: Integer, symbol: "1", suffix: Some("u8") })');
  }));

t("tokenstream::DelimSpacing", () => {
  const { DelimSpacing, debug_DelimSpacing } = TS!;
  expect(debug_DelimSpacing(new DelimSpacing("JointHidden", "Alone"), PLAIN)).toBe("DelimSpacing { open: JointHidden, close: Alone }");
});

tg("format::FormatArguments.names (FxHashMap)", () =>
  run(() => {
    const { FormatArguments, debug_FormatArguments } = F!;
    const one = new FormatArguments([], 0, 1, new Map([[Symbol.intern("a"), 0]]));
    const f: Fmt = PRETTY;
    expect(debug_FormatArguments(one, f)).toBe(
      'FormatArguments {\n    arguments: [],\n    num_unnamed_args: 0,\n    num_explicit_args: 1,\n    names: {\n        "a": 0,\n    },\n}',
    );
    // more than one entry: rustc prints hashbrown order (oracle: `"b": 1, "a": 0`), unported
    const two = new FormatArguments([], 0, 2, new Map([[Symbol.intern("a"), 0], [Symbol.intern("b"), 1]]));
    expect(() => debug_FormatArguments(two, f)).toThrow(Unported);
  }));

// ---------------------------------------------------------------------------------------------
// Lane ast-core: scenario tests for the ported fns of ast.rs and its sibling files. Each assertion
// cites the upstream line its expectation is derived from (pin in UPSTREAM.json).
import { entry_point_type } from "./entry.ts";
import { DUMMY_NODE_ID, display_NodeId, NodeId as NodeIdC } from "./node_id.ts";
import { RustcVersion, display_RustcVersion } from "./attr/version.ts";
import { CfgEntry, display_CfgEntry } from "./attr/data_structures.ts";
import { DiffActivity, DiffMode, valid_ret_activity, display_DiffActivity } from "./expand/autodiff_attrs.ts";
import { TypeTree } from "./expand/typetree.ts";
import { default_fn_name, global_fn_name } from "./expand/allocator.ts";
import { kw, sym } from "../rustc_span/symbol.ts";

t("BinOpKind: as_str / precedence / fixity / is_comparison / is_lazy / from(AssignOpKind)", () => {
  const { BinOpKind } = A!;
  expect(BinOpKind.as_str("Shl")).toBe("<<"); // ast.rs:1044
  expect(BinOpKind.as_str("Ne")).toBe("!="); // ast.rs:1049
  expect(BinOpKind.precedence("Rem")).toBe("Product"); // ast.rs:1062
  expect(BinOpKind.precedence("Ge")).toBe("Compare"); // ast.rs:1068
  expect(BinOpKind.precedence("Or")).toBe("LOr"); // ast.rs:1070
  expect(BinOpKind.fixity("Lt")).toBe("None"); // ast.rs:1077
  expect(BinOpKind.fixity("Shr")).toBe("Left"); // ast.rs:1078-1079
  expect(BinOpKind.is_comparison("Eq")).toBe(true); // ast.rs:1087
  expect(BinOpKind.is_by_value("Eq")).toBe(false); // ast.rs:1094
  expect(BinOpKind.is_lazy("And")).toBe(true); // ast.rs:1056
  expect(BinOpKind.from_AssignOpKind("BitXorAssign")).toBe("BitXor"); // ast.rs:1111
  expect(A!.AssignOpKind.as_str("ShrAssign")).toBe(">>="); // ast.rs:1157
  expect(A!.UnOp.is_by_value("Deref")).toBe(false); // ast.rs:1193
});

tg("Path: from_ident / is_global / is_single_argless_ident / eq", () =>
  run(() => {
    const { Path, PathSegment } = A!;
    const foo = Symbol.intern("foo");
    const p = Path.from_ident(Ident.new(foo, DUMMY_SP)); // ast.rs:139-141
    expect(p.segments.length).toBe(1);
    expect(p.segments[0]!.id).toBe(DUMMY_NODE_ID); // ast.rs:241
    expect(p.is_global()).toBe(false); // ast.rs:144
    expect(p.is_single_argless_ident()).toBe(true); // ast.rs:150
    expect(p.as_single_argless_ident()!.name).toBe(foo); // ast.rs:155
    expect(p.eq_Symbol(foo)).toBe(true); // ast.rs:104-107
    expect(p.eq_slice([foo])).toBe(true); // ast.rs:118
    expect(p.eq_slice([foo, foo])).toBe(false); // ast.rs:118 (lengths differ)
    const g = new Path(DUMMY_SP, [PathSegment.path_root(DUMMY_SP), PathSegment.from_ident(Ident.new(foo, DUMMY_SP))]);
    expect(g.is_global()).toBe(true); // ast.rs:144 (first segment is kw::PathRoot)
    expect(g.is_single_argless_ident()).toBe(false); // ast.rs:150
    // join_path_syms: a leading kw::PathRoot prints as empty (ast.rs:180-182)
    expect(A!.join_path_syms([kw.PathRoot, foo, Symbol.intern("bar")])).toBe("::foo::bar");
    expect(A!.join_path_syms([foo])).toBe("foo");
    expect(() => A!.join_path_syms([])).toThrow(); // ast.rs:179 `unwrap()` on an empty path
  }));

tg("Expr: peel_parens / peel_parens_and_refs / maybe_unwrap_block / precedence", () =>
  run(() => {
    const { Expr, Stmt, Path } = A!;
    const path = (): InstanceType<typeof Expr> =>
      new Expr(DUMMY_NODE_ID, { $: "Path", _0: undefined, _1: Path.from_ident(Ident.new(Symbol.intern("x"), DUMMY_SP)) }, DUMMY_SP, [], undefined);
    const inner = path();
    const paren = (e: InstanceType<typeof Expr>) => new Expr(DUMMY_NODE_ID, { $: "Paren", _0: e }, DUMMY_SP, [], undefined);
    const addr = (e: InstanceType<typeof Expr>) => new Expr(DUMMY_NODE_ID, { $: "AddrOf", _0: "Ref", _1: "Not", _2: e }, DUMMY_SP, [], undefined);
    expect(paren(paren(inner)).peel_parens()).toBe(inner); // ast.rs:1490-1492
    expect(paren(addr(inner)).peel_parens()).not.toBe(inner); // ast.rs:1490 (AddrOf is not peeled)
    expect(paren(addr(paren(inner))).peel_parens_and_refs()).toBe(inner); // ast.rs:1498-1500
    // `{ x }` -> `x` (ast.rs:1438-1442), and is_potential_trivial_const_arg (ast.rs:1426-1430)
    const block = (stmts: InstanceType<typeof Stmt>[]) =>
      new Expr(DUMMY_NODE_ID, { $: "Block", _0: { stmts, id: DUMMY_NODE_ID, rules: { $: "Default" }, span: DUMMY_SP }, _1: undefined }, DUMMY_SP, [], undefined);
    const b = block([new Stmt(DUMMY_NODE_ID, { $: "Expr", _0: inner }, DUMMY_SP)]);
    expect(b.maybe_unwrap_block()).toBe(inner);
    expect(b.is_potential_trivial_const_arg()).toBe(true);
    expect(b.optionally_braced_mac_call(false)).toBe(undefined); // ast.rs:1467 (not a mac call)
    expect(block([]).maybe_unwrap_block().kind.$).toBe("Block"); // ast.rs:1444
    // precedence: binary ops defer to BinOpKind::precedence (ast.rs:1583); paths are
    // Unambiguous without outer attrs (ast.rs:1557, 1633); `return x` is Jump (ast.rs:1570)
    const bin = new Expr(DUMMY_NODE_ID, { $: "Binary", _0: { node: "Shl", span: DUMMY_SP }, _1: inner, _2: inner }, DUMMY_SP, [], undefined);
    expect(bin.precedence()).toBe("Shift");
    expect(inner.precedence()).toBe("Unambiguous");
    expect(new Expr(DUMMY_NODE_ID, { $: "Ret", _0: inner }, DUMMY_SP, [], undefined).precedence()).toBe("Jump");
    expect(new Expr(DUMMY_NODE_ID, { $: "Ret", _0: undefined }, DUMMY_SP, [], undefined).precedence()).toBe("Unambiguous"); // ast.rs:1571
    expect(new Expr(DUMMY_NODE_ID, { $: "Yield", _0: { $: "Postfix", _0: inner } }, DUMMY_SP, [], undefined).precedence()).toBe("Unambiguous"); // ast.rs:1630
    expect(Expr.dummy().kind.$).toBe("Dummy"); // ast.rs:1658
    expect(paren(inner).is_approximately_pattern()).toBe(true); // ast.rs:1640, 1647
    // Underscore reparses as `_` (ast.rs:1541); a path is cloned into `TyKind::Path` (ast.rs:1509)
    expect(new Expr(DUMMY_NODE_ID, { $: "Underscore" }, DUMMY_SP, [], undefined).to_ty()!.kind.$).toBe("Infer");
    const tk = inner.to_ty()!.kind;
    const ek = inner.kind as { _1: InstanceType<typeof Path> };
    expect(tk.$).toBe("Path");
    expect((tk as { _1: unknown })._1).toEqual(ek._1);
    expect((tk as { _1: unknown })._1).not.toBe(ek._1);
  }));

tg("Pat: walk / could_be_never_pattern / contains_never_pattern / to_ty / descr", () =>
  run(() => {
    const { Pat, BindingMode } = A!;
    const pat = (kind: ConstructorParameters<typeof Pat>[1]) => new Pat(DUMMY_NODE_ID, kind, DUMMY_SP);
    const never = pat({ $: "Never" });
    const wild = pat({ $: "Wild" });
    const tuple = pat({ $: "Tuple", _0: [wild, never] });
    expect(tuple.contains_never_pattern()).toBe(true); // ast.rs:757-760
    expect(tuple.could_be_never_pattern()).toBe(true); // ast.rs:739-741
    expect(pat({ $: "Or", _0: [never, wild] }).could_be_never_pattern()).toBe(false); // ast.rs:744 (`all`)
    let seen = 0;
    tuple.walk(() => {
      seen++;
      return true;
    });
    expect(seen).toBe(3); // ast.rs:683, 698
    // `_` reparses as `TyKind::Infer` (ast.rs:650); `x` (BindingMode::NONE) as a path (ast.rs:652-654)
    expect(wild.to_ty()!.kind.$).toBe("Infer");
    const x = pat({ $: "Ident", _0: BindingMode.NONE, _1: Ident.new(Symbol.intern("x"), DUMMY_SP), _2: undefined });
    expect(x.to_ty()!.kind.$).toBe("Path");
    expect(pat({ $: "Tuple", _0: [wild, x] }).to_ty()!.kind.$).toBe("Tup"); // ast.rs:669-671
    expect(pat({ $: "Rest" }).to_ty()).toBe(undefined); // ast.rs:673
    expect(wild.descr()).toBe("_"); // ast.rs:769
    expect(pat({ $: "Ref", _0: wild, _1: "Not", _2: "Not" }).peel_refs()).toBe(wild); // ast.rs:723-725
  }));

t("BindingMode::prefix_str / ByRef::cap_ref_mutability", () => {
  const { BindingMode, ByRef } = A!;
  expect(BindingMode.NONE.prefix_str()).toBe(""); // ast.rs:849
  expect(BindingMode.REF_PIN.prefix_str()).toBe("ref pin const "); // ast.rs:851
  expect(BindingMode.MUT_REF_PIN_MUT.prefix_str()).toBe("mut ref pin mut "); // ast.rs:858
  expect(new BindingMode({ $: "Yes", _0: "Not", _1: "Mut" }, "Mut").prefix_str()).toBe("mut ref mut "); // ast.rs:842-843, 857
  // cmp::min(Mut, Not) == Not (ast.rs:814; Mutability: Not < Mut)
  expect(ByRef.cap_ref_mutability({ $: "Yes", _0: "Pinned", _1: "Mut" }, "Not")).toEqual({ $: "Yes", _0: "Pinned", _1: "Not" });
  expect(ByRef.cap_ref_mutability({ $: "Yes", _0: "Not", _1: "Not" }, "Mut")).toEqual({ $: "Yes", _0: "Not", _1: "Not" });
  expect(ByRef.cap_ref_mutability(ByRef.No, "Not")).toBe(ByRef.No); // ast.rs:813 (no-op)
});

tg("TyKind::maybe_scalar / is_unit; FnHeader::span / has_qualifiers", () =>
  run(() => {
    const { TyKind, Path, FnHeader } = A!;
    const p = (s: string): A_TyKind => ({ $: "Path", _0: undefined, _1: Path.from_ident(Ident.new(Symbol.intern(s), DUMMY_SP)) });
    expect(TyKind.maybe_scalar(p("u128"))).toBe(true); // ast.rs:2629
    expect(TyKind.maybe_scalar(p("String"))).toBe(false); // ast.rs:2618
    expect(TyKind.is_simple_path(p("u8"))).toBe(sym.u8); // ast.rs:2600
    expect(TyKind.maybe_scalar({ $: "Tup", _0: [] })).toBe(true); // ast.rs:2616 (unit type)
    const h = FnHeader.default(); // ast.rs:3844-3849
    expect(h.has_qualifiers()).toBe(false); // ast.rs:3811-3814
    expect(h.span()).toBe(undefined); // ast.rs:3838 (`reduce` of no spans)
    h.constness = { $: "Yes", _0: DUMMY_SP };
    expect(h.has_qualifiers()).toBe(true); // ast.rs:3813
    expect(h.span()).toBe(DUMMY_SP); // ast.rs:3834-3838
  }));
type A_TyKind = import("./ast.ts").TyKind;

t("InlineAsmOptions consts / human_readable_names; InlineAsmTemplatePiece Display; AsmMacro", () => {
  const { InlineAsmOptions: O, InlineAsmTemplatePiece, AsmMacro } = A!;
  expect(O.COUNT).toBe(9); // ast.rs:2727 (9 flags at ast.rs:2714-2722)
  expect(O.human_readable_names(O.union(O.NOMEM, O.MAY_UNWIND))).toEqual(["nomem", "may_unwind"]); // ast.rs:2738-2761
  expect(AsmMacro.is_supported_option("GlobalAsm", O.RAW)).toBe(true); // ast.rs:2729, 2898
  expect(AsmMacro.is_supported_option("NakedAsm", O.NOMEM)).toBe(false); // ast.rs:2730, 2899
  expect(AsmMacro.diverges("Asm", O.NORETURN)).toBe(true); // ast.rs:2905
  expect(AsmMacro.macro_name("NakedAsm")).toBe("naked_asm"); // ast.rs:2891
  // `{`/`}` are doubled (ast.rs:2785-2786); placeholders print `{idx:mod}` / `{idx}` (ast.rs:2793, 2796)
  expect(
    InlineAsmTemplatePiece.to_string([
      { $: "String", _0: "mov {a}, " },
      { $: "Placeholder", operand_idx: 0, modifier: 0x78, span: DUMMY_SP },
      { $: "String", _0: ", " },
      { $: "Placeholder", operand_idx: 12, modifier: undefined, span: DUMMY_SP },
    ]),
  ).toBe("mov {{a}}, {0:x}, {12}");
});

t("TraitObjectSyntax Tag; CoroutineKind; RangeLimits; Bound*::as_str; AttrStyle", () => {
  const { TraitObjectSyntax, CoroutineKind, RangeLimits, BoundConstness, BoundPolarity, AttrStyle } = A!;
  expect(TraitObjectSyntax.into_usize("None")).toBe(1); // ast.rs:2671, 2681
  expect(TraitObjectSyntax.from_usize(0)).toBe("Dyn"); // ast.rs:2686
  expect(() => TraitObjectSyntax.from_usize(2)).toThrow(); // ast.rs:2688
  expect(A!.display_CoroutineKind("AsyncGen")).toBe("async gen"); // ast.rs:1954, 1971
  expect(CoroutineKind.is_gen("Async")).toBe(false); // ast.rs:1962
  expect(RangeLimits.as_str("Closed")).toBe("..="); // ast.rs:1709
  expect(BoundConstness.as_str({ $: "Maybe", _0: DUMMY_SP })).toBe("[const]"); // ast.rs:3205
  expect(BoundPolarity.as_str({ $: "Maybe", _0: DUMMY_SP })).toBe("?"); // ast.rs:3183
  expect(AttrStyle.line_doc_comment_prefix("Inner")).toBe("//!"); // ast.rs:3397
  expect(A!.display_ParamKindOrd("TypeOrConst")).toBe("type and const"); // ast.rs:436
});

tg("ItemKind: descr / article / ident; AssocItemKind::try_from", () =>
  run(() => {
    const { ItemKind, AssocItemKind, ConstBlockItem } = A!;
    const cb: A_ItemKind = { $: "ConstBlock", _0: { id: DUMMY_NODE_ID, span: DUMMY_SP, block: { stmts: [], id: DUMMY_NODE_ID, rules: { $: "Default" }, span: DUMMY_SP } } };
    expect(ItemKind.descr(cb)).toBe("const block"); // ast.rs:4281
    expect(ItemKind.article(cb)).toBe("a"); // ast.rs:4258
    expect(ItemKind.ident(cb)!.name).toBe(kw.Underscore); // ast.rs:4239, 4053
    expect(ConstBlockItem.IDENT.span).toBe(DUMMY_SP); // ast.rs:4053
    const r = AssocItemKind.try_from_ItemKind(cb); // ast.rs:4405
    expect(r.$).toBe("Err");
  }));
type A_ItemKind = import("./ast.ts").ItemKind;

tg("node_id / entry / allocator", () =>
  run(() => {
    expect(DUMMY_NODE_ID).toBe(NodeIdC.MAX); // node_id.rs:36
    expect(display_NodeId(NodeIdC.from_u32(7))).toBe("7"); // node_id.rs:50
    expect(NodeIdC.placeholder_to_expn_id(NodeIdC.placeholder_from_expn_id(3 as never))).toBe(3 as never); // node_id.rs:39-45
    expect(entry_point_type(false, true, sym.main)).toBe("MainNamed"); // entry.rs:38
    expect(entry_point_type(false, false, sym.main)).toBe("OtherMain"); // entry.rs:40
    expect(entry_point_type(true, false, undefined)).toBe("RustcMainAttr"); // entry.rs:32
    expect(entry_point_type(false, true, undefined)).toBe("None"); // entry.rs:43
    expect(global_fn_name(sym.alloc)).toBe("__rust_alloc"); // allocator.rs:13
    expect(default_fn_name(sym.dealloc)).toBe("__rdl_dealloc"); // allocator.rs:17
  }));

tg("attr: RustcVersion parse / Display; CfgEntry Display / is_equivalent_to", () =>
  run(() => {
    // version.rs:30-34: suffix after `-` ignored, missing patch = 0
    expect(display_RustcVersion(RustcVersion.parse_str("1.75-nightly")!)).toBe("1.75.0");
    expect(RustcVersion.parse_str("1")).toBe(undefined); // version.rs:33 (`minor` missing)
    expect(RustcVersion.parse_str_strict("1.2")).toBe(undefined); // version.rs:42 (`patch` required)
    expect(RustcVersion.parse_str_strict("1.2.3-dev")).toBe(undefined); // version.rs:42 (`3-dev` does not parse)
    expect(RustcVersion.parse_str_strict("+1.2.70000")).toBe(undefined); // u16 overflow
    expect(display_RustcVersion(RustcVersion.CURRENT)).toBe("1.101.0"); // version.rs:15 (CFG_RELEASE of the pin)
    const nv: import("./attr/data_structures.ts").CfgEntry = { $: "NameValue", name: sym.feature, value: Symbol.intern('a"b'), span: DUMMY_SP };
    const all: import("./attr/data_structures.ts").CfgEntry = { $: "All", _0: [{ $: "Bool", _0: true, _1: DUMMY_SP }, nv], _1: DUMMY_SP };
    // data_structures.rs:75-82 (write_entries), 89 (`{value}`), 95 (`{name} = {:?}`)
    expect(display_CfgEntry(all)).toBe('all(true, feature = "a\\"b")');
    expect(display_CfgEntry({ $: "Not", _0: { $: "Version", _0: undefined, _1: DUMMY_SP }, _1: DUMMY_SP })).toBe("not()"); // data_structures.rs:88, 99
    const rev: import("./attr/data_structures.ts").CfgEntry = { $: "All", _0: [nv, { $: "Bool", _0: true, _1: DUMMY_SP }], _1: DUMMY_SP };
    expect(CfgEntry.is_equivalent_to(all, rev)).toBe(true); // data_structures.rs:51-53 (order ignored)
    expect(CfgEntry.is_equivalent_to(all, { $: "Any", _0: rev._0, _1: DUMMY_SP })).toBe(false); // data_structures.rs:63
  }));

tg("format: FormatArguments::add / by_name / by_index / slices", () =>
  run(() => {
    const { FormatArguments } = F!;
    const args = FormatArguments.new();
    const e = A!.Expr.dummy();
    const name = Ident.new(Symbol.intern("n"), DUMMY_SP);
    expect(args.add({ original_span: DUMMY_SP, kind: { $: "Normal" }, expr: e })).toBe(0); // format.rs:95
    expect(args.add({ original_span: DUMMY_SP, kind: { $: "Named", _0: name }, expr: e })).toBe(1);
    expect(args.add({ original_span: DUMMY_SP, kind: { $: "Captured", _0: Ident.new(Symbol.intern("c"), DUMMY_SP) }, expr: e })).toBe(2);
    expect(args.num_unnamed_args).toBe(1); // format.rs:99-102
    expect(args.num_explicit_args).toBe(2); // format.rs:103-111
    expect(args.by_name(name.name)![0]).toBe(1); // format.rs:118-119
    expect(args.by_index(2)).toBe(undefined); // format.rs:123 (captured args are not explicit)
    expect(args.named_args().length).toBe(1); // format.rs:131
    expect(args.all_args().length).toBe(3); // format.rs:139
    // An explicit argument after a captured one fails the assert_eq! at format.rs:106-110.
    expect(() => args.add({ original_span: DUMMY_SP, kind: { $: "Normal" }, expr: e })).toThrow("captured arguments must be added last");
  }));

t("expand: autodiff activities, TypeTree", () => {
  expect(valid_ret_activity("Reverse", DiffActivity.ActiveOnly)).toBe(true); // autodiff_attrs.rs:139-141
  expect(valid_ret_activity("Source", DiffActivity.Const)).toBe(false); // autodiff_attrs.rs:135
  expect(valid_ret_activity("Source", DiffActivity.None)).toBe(true); // autodiff_attrs.rs:129-132
  expect(DiffMode.from_str("Forward")).toEqual({ $: "Ok", _0: "Forward" }); // autodiff_attrs.rs:202
  expect(DiffActivity.from_str("Bogus").$).toBe("Err"); // autodiff_attrs.rs:224
  expect(display_DiffActivity({ $: "FakeActivitySize", _0: 8 })).toBe("FakeActivitySize(Some(8))"); // autodiff_attrs.rs:190
  const t3 = TypeTree.int(3); // typetree.rs:51-61
  expect(t3._0.map((t) => t.offset)).toEqual([0, 1, 2]);
  expect(TypeTree.all_ints()._0[0]!.offset).toBe(-1); // typetree.rs:49
  expect(t3._0[0]!.add_offset(5).offset).toBe(5); // typetree.rs:91 (`x => add + x`, x = 0)
  expect(TypeTree.all_ints()._0[0]!.add_offset(5).offset).toBe(5); // typetree.rs:90 (`-1 => add`)
  expect(t3.add_indirection()._0[0]!.kind).toBe("Pointer"); // typetree.rs:64
});
