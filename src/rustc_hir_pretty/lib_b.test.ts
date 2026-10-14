// Unit tests of lane hir-pretty-b (compiler/rustc_hir_pretty/src/lib.rs:1306..end). The HIR is built by hand; the
// expected strings are what the pinned rustc prints for the same source with `-Zunpretty=hir` (verified on the oracle
// for each case marked "oracle"; the source is quoted next to it).
//
// The `State` methods of lane hir-pretty-a's region (lib.rs:1..1305) that these cases reach are installed below as
// test doubles copied from upstream, ONLY when the prototype lacks them (before the two halves are merged). After the
// merge the real methods are used and the doubles are skipped.
import { expect, test } from "bun:test";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ast } from "../rustc_ast/lib.ts";
import { pp } from "../rustc_ast_pretty/lib.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import { HirId_INVALID } from "../rustc_hir_id/lib.ts";
import { CRATE_DEF_ID } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import {
  contains_exterior_struct_lit,
  expr_requires_semi_to_be_stmt,
  type Nested,
  PpAnn,
  State,
  stmt_ends_with_semi,
} from "./lib.ts";

// ---- doubles for lane a's methods (installed only while they are missing) --------------------------------------

const P = State.prototype as unknown as Record<string, unknown>;
function double(name: string, f: Function): void {
  if (!(name in P)) P[name] = f;
}
// rustc: lib.rs:80 attrs
double("attrs", function (this: State, id: hir.HirId) {
  return this.attrs_(id);
});
// rustc: lib.rs:84 precedence
double("precedence", function (this: State, expr: hir.Expr) {
  return expr.precedence((id) => this.attrs(id).length !== 0);
});
// rustc: lib.rs:89 print_attrs (only the empty case is reached here)
double("print_attrs", function (this: State, attrs: readonly Attribute[]) {
  if (attrs.length === 0) return;
  unported("test double: print_attrs with attributes");
});
// rustc: lib.rs:339 bclose_maybe_open
double("bclose_maybe_open_", function (this: State, span: Span, cb: pp.BoxMarker | undefined) {
  this.maybe_print_comment(Span.hi(span));
  this.break_offset_if_not_bol(1, -4);
  this.s.word("}");
  if (cb !== undefined) this.s.end(cb);
});
// rustc: lib.rs:348 bclose
double("bclose_", function (this: State, span: Span, cb: pp.BoxMarker) {
  this.bclose_maybe_open_(span, cb);
});
// rustc: lib.rs:352 commasep_cmnt
double(
  "commasep_cmnt",
  function <T>(this: State, b: pp.Breaks, elts: readonly T[], op: (s: State, e: T) => void, get_span: (e: T) => Span) {
    const rb = this.s.rbox(0, b);
    const len = elts.length;
    let i = 0;
    for (const elt of elts) {
      this.maybe_print_comment(Span.hi(get_span(elt)));
      op(this, elt);
      i += 1;
      if (i < len) {
        this.s.word(",");
        this.maybe_print_trailing_comment(get_span(elt), Span.hi(get_span(elts[i]!)));
        this.s.space_if_not_bol();
      }
    }
    this.s.end(rb);
  },
);
// rustc: lib.rs:373 commasep_exprs
double("commasep_exprs", function (this: State, b: pp.Breaks, exprs: readonly hir.Expr[]) {
  this.commasep_cmnt(b, exprs, (s, e) => s.print_expr(e), (e) => e.span);
});
// rustc: lib.rs:387 print_type (only `Path` and `Infer` are reached here)
double("print_type", function (this: State, ty: hir.Ty) {
  const ib = this.s.ibox(0);
  if (ty.kind.$ === "Path") this.print_qpath(ty.kind._0, false);
  else if (ty.kind.$ === "Infer") this.s.word("_");
  else unported("test double: print_type");
  this.s.end(ib);
});
// rustc: lib.rs:229 print_generic_arg (no `Const` here)
double("print_generic_arg", function (this: State, generic_arg: hir.GenericArg, elide_lifetimes: boolean) {
  if (generic_arg.$ === "Lifetime" && !elide_lifetimes) this.print_lifetime(generic_arg._0);
  else if (generic_arg.$ === "Lifetime") {
  } else if (generic_arg.$ === "Type") this.print_type(generic_arg._0 as hir.Ty);
  else if (generic_arg.$ === "Infer") this.s.word("_");
  else unported("test double: print_generic_arg Const");
});
// rustc: lib.rs:840 print_formal_generic_params
double("print_formal_generic_params", function (this: State, generic_params: readonly hir.GenericParam[]) {
  if (generic_params.length !== 0) {
    this.s.word("for");
    this.print_generic_params(generic_params);
    this.s.nbsp();
  }
});
// rustc: lib.rs:1244 print_call_post
double("print_call_post", function (this: State, args: readonly hir.Expr[]) {
  this.s.popen();
  this.commasep_exprs(pp.Breaks.Inconsistent, args);
  this.s.pclose();
});
// rustc: lib.rs:1289 cond_needs_par
function cond_needs_par(expr: hir.Expr): boolean {
  const k = expr.kind.$;
  return k === "Break" || k === "Closure" || k === "Ret" ? true : contains_exterior_struct_lit(expr);
}
// rustc: lib.rs:1252 print_expr_as_cond
double("print_expr_as_cond", function (this: State, expr: hir.Expr) {
  this.print_expr_cond_paren(expr, cond_needs_par(expr));
});
// rustc: lib.rs:1257 print_expr_cond_paren
double("print_expr_cond_paren", function (this: State, expr: hir.Expr, needs_par: boolean) {
  if (needs_par) this.s.popen();
  if (expr.kind.$ === "DropTemps") this.print_expr(expr.kind._0);
  else this.print_expr(expr);
  if (needs_par) this.s.pclose();
});
// rustc: lib.rs:1298 print_expr_vec
double("print_expr_vec", function (this: State, exprs: readonly hir.Expr[]) {
  const ib = this.s.ibox(4);
  this.s.word("[");
  this.commasep_exprs(pp.Breaks.Inconsistent, exprs);
  this.s.word("]");
  this.s.end(ib);
});
// The constructor of the merged `State` is lane a's; the tests build it through this helper.
function new_state(ann: PpAnn): State {
  const attrs = (_: hir.HirId): readonly Attribute[] => [];
  return new (State as unknown as new (...args: unknown[]) => State)(pp.Printer.new(), undefined, attrs, ann);
}

// ---- HIR builders ------------------------------------------------------------------------------------------------

const H = HirId_INVALID;
const sp = DUMMY_SP;
const id = (s: string): Ident => Ident.with_dummy_span(Symbol.intern(s));
const seg = (s: string, args?: hir.GenericArgs): hir.PathSegment => new hir.PathSegment(id(s), H, Res.Err, args, false, false);
const path = (...segs: hir.PathSegment[]): hir.Path => new hir.Path(sp, Res.Err, segs);
const qpath = (...names: string[]): hir.QPath => ({ $: "Resolved", _0: undefined, _1: path(...names.map((n) => seg(n))) });
const e = (kind: hir.ExprKind): hir.Expr => new hir.Expr(H, kind, sp);
const p = (...names: string[]): hir.Expr => e({ $: "Path", _0: qpath(...names) });
const lit = (n: number): hir.Lit => ({ node: { $: "Int", _0: BigInt(n), _1: ast.LitIntType.Unsuffixed }, span: sp });
const int = (n: number): hir.Expr => e({ $: "Lit", _0: lit(n) });
const bool = (b: boolean): hir.Expr => e({ $: "Lit", _0: { node: { $: "Bool", _0: b }, span: sp } });
const bin = (op: ast.BinOpKind, l: hir.Expr, r: hir.Expr): hir.Expr => e({ $: "Binary", _0: { node: op, span: sp }, _1: l, _2: r });
const ty = (...names: string[]): hir.Ty => new hir.Ty<null>(H, sp, { $: "Path", _0: qpath(...names) });
const pat = (kind: hir.PatKind): hir.Pat => new hir.Pat(H, kind, sp, false);
const bind = (n: string, mutbl: "Not" | "Mut" = "Not", by_ref: ast.ByRef = ast.ByRef.No): hir.Pat =>
  pat({ $: "Binding", _0: new ast.BindingMode(by_ref, mutbl), _1: H, _2: id(n), _3: undefined });
const patlit = (n: number): hir.PatExpr => ({ hir_id: H, span: sp, kind: { $: "Lit", lit: lit(n), negated: false } });
const lifetime = (n: string): hir.Lifetime => new hir.Lifetime(H, id(n), { $: "Static" }, { $: "Other" }, "ExplicitBound");

class TestAnn extends PpAnn {
  bodies = new Map<hir.BodyId, { params: hir.Pat[]; value: hir.Expr }>();
  // Mirrors `impl PpAnn for &dyn HirTyCtxt` (lib.rs:60) for bodies.
  override nested(state: State, nested: Nested): void {
    if (nested.$ === "Body") state.print_expr(this.bodies.get(nested._0)!.value);
    else if (nested.$ === "BodyParamPat") state.print_pat(this.bodies.get(nested._0)!.params[nested._1]!);
    else throw new Error("unexpected nested");
  }
}

function render(f: (s: State, ann: TestAnn) => void): string {
  const ann = new TestAnn();
  const s = new_state(ann);
  f(s, ann);
  return s.s.eof();
}
const show_expr = (x: hir.Expr): string => render((s) => s.print_expr(x));
const show_pat = (x: hir.Pat): string => render((s) => s.print_pat(x));
const g = <R>(f: () => R): R => create_default_session_globals_then(f);

// ---- tests ------------------------------------------------------------------------------------------------------

test("print_expr: tuples, arrays, struct literals (oracle)", () =>
  g(() => {
    // `(x, 1, true)`, `[x, 2]`, `(x,)`
    expect(show_expr(e({ $: "Tup", _0: [p("x"), int(1), bool(true)] }))).toBe("(x, 1, true)");
    expect(show_expr(e({ $: "Array", _0: [p("x"), int(2)] }))).toBe("[x, 2]");
    expect(show_expr(e({ $: "Tup", _0: [p("x")] }))).toBe("(x,)");
    // `S { a: x, b: 3 }`, `S { a, ..s }`
    const field = (n: string, v: hir.Expr, is_shorthand = false): hir.ExprField => ({ hir_id: H, ident: id(n), expr: v, span: sp, is_shorthand });
    expect(show_expr(e({ $: "Struct", _0: qpath("S"), _1: [field("a", p("x")), field("b", int(3))], _2: hir.StructTailExpr.None }))).toBe(
      "S { a: x, b: 3 }",
    );
    expect(show_expr(e({ $: "Struct", _0: qpath("S"), _1: [field("a", p("a"), true)], _2: { $: "Base", _0: p("s") } }))).toBe(
      "S { a, ..s }",
    );
  }));

test("print_expr: precedence-driven parentheses (oracle)", () =>
  g(() => {
    // `(a + b) * c`, `a - (b - c)`, `(x as i32) < y`, `a = b = c`
    expect(show_expr(bin("Mul", bin("Add", p("a"), p("b")), p("c")))).toBe("(a + b) * c");
    expect(show_expr(bin("Sub", p("a"), bin("Sub", p("b"), p("c"))))).toBe("a - (b - c)");
    expect(show_expr(bin("Lt", e({ $: "Cast", _0: p("x"), _1: ty("i32") }), p("y")))).toBe("(x as i32) < y");
    expect(show_expr(e({ $: "Assign", _0: p("a"), _1: e({ $: "Assign", _0: p("b"), _1: p("c"), _2: sp }), _2: sp }))).toBe("a = b = c");
    // `!-x`, `&raw const x`
    expect(show_expr(e({ $: "Unary", _0: "Not", _1: e({ $: "Unary", _0: "Neg", _1: p("x") }) }))).toBe("!-x");
    expect(show_expr(e({ $: "AddrOf", _0: "Raw", _1: "Not", _2: p("x") }))).toBe("&raw const x");
  }));

test("print_expr: method calls, fields, indexing, qualified paths, calls (oracle)", () =>
  g(() => {
    // `x.0.foo::<u8>(1, 2)[3]`
    const u8 = new hir.GenericArgs([{ $: "Type", _0: ty("u8") as hir.Ty<never> }], [], "No", sp);
    const recv = e({ $: "Field", _0: p("x"), _1: id("0") });
    const call = e({ $: "MethodCall", _0: seg("foo", u8), _1: recv, _2: [int(1), int(2)], _3: sp });
    expect(show_expr(e({ $: "Index", _0: call, _1: int(3), _2: sp }))).toBe("x.0.foo::<u8>(1, 2)[3]");
    // `a.b(c).d`, `A { x: 1 }.y`
    const abc = e({ $: "MethodCall", _0: seg("b"), _1: p("a"), _2: [p("c")], _3: sp });
    expect(show_expr(e({ $: "Field", _0: abc, _1: id("d") }))).toBe("a.b(c).d");
    const field: hir.ExprField = { hir_id: H, ident: id("x"), expr: int(1), span: sp, is_shorthand: false };
    const st = e({ $: "Struct", _0: qpath("A"), _1: [field], _2: hir.StructTailExpr.None });
    expect(show_expr(e({ $: "Field", _0: st, _1: id("y") }))).toBe("A { x: 1 }.y");
    // `<u8 as Tr>::C`, `A::B(1)`, `return`
    expect(show_expr(e({ $: "Path", _0: { $: "Resolved", _0: ty("u8"), _1: path(seg("Tr"), seg("C")) } }))).toBe("<u8 as Tr>::C");
    expect(show_expr(e({ $: "Call", _0: p("A", "B"), _1: [int(1)] }))).toBe("A::B(1)");
    expect(show_expr(e({ $: "Ret", _0: undefined }))).toBe("return");
  }));

test("print_expr: match and closures (oracle)", () =>
  g(() => {
    // `match x { 1 => 2, _ => 3 }` prints `match x { 1 => 2, _ => 3, }`
    const arm = (q: hir.Pat, body: hir.Expr): hir.Arm => ({ hir_id: H, span: sp, pat: q, guard: undefined, body });
    const m = e({
      $: "Match",
      _0: p("x"),
      _1: [arm(pat({ $: "Expr", _0: patlit(1) }), int(2)), arm(pat({ $: "Wild" }), int(3))],
      _2: { $: "Normal" },
    });
    expect(show_expr(m)).toBe("match x { 1 => 2, _ => 3, }");
    // `move |a| a`
    const body: hir.BodyId = { hir_id: H };
    const closure: hir.Closure = {
      def_id: CRATE_DEF_ID,
      binder: hir.ClosureBinder.Default,
      constness: hir.Constness.NotConst,
      capture_clause: { $: "Value", move_kw: sp },
      bound_generic_params: [],
      fn_decl: new hir.FnDecl([new hir.Ty(H, sp, { $: "Infer", _0: null })], { $: "DefaultReturn", _0: sp }, hir.FnDeclFlags.default_()),
      body,
      fn_decl_span: sp,
      fn_arg_span: undefined,
      kind: { $: "Closure" },
      explicit_captures: [],
    };
    const out = render((s, ann) => {
      ann.bodies.set(body, { params: [bind("a")], value: p("a") });
      s.print_expr(e({ $: "Closure", _0: closure }));
    });
    expect(out).toBe("move |a| a");
  }));

test("print_pat: tuple structs, tuples, structs, refs, ranges (oracle; `(p,)`, `mut x`, or/slice from upstream logic)", () =>
  g(() => {
    // `T(a, .., c)` prints `T(a, ..,c)`; `(p, ..)`
    expect(show_pat(pat({ $: "TupleStruct", _0: qpath("T"), _1: [bind("a"), bind("c")], _2: hir.DotDotPos.new(1) }))).toBe("T(a, ..,c)");
    expect(show_pat(pat({ $: "Tuple", _0: [bind("p")], _1: hir.DotDotPos.new(1) }))).toBe("(p, ..)");
    expect(show_pat(pat({ $: "Tuple", _0: [bind("p")], _1: hir.DotDotPos.new(undefined) }))).toBe("(p,)");
    // `S { a: ref mut q, .. }` prints `S {  a: ref mut q, .. }`
    const q = bind("q", "Not", { $: "Yes", _0: "Not", _1: "Mut" });
    const f: hir.PatField = { hir_id: H, ident: id("a"), pat: q, is_shorthand: false, span: sp };
    expect(show_pat(pat({ $: "Struct", _0: qpath("S"), _1: [f], _2: sp }))).toBe("S {  a: ref mut q, .. }");
    // `&mut z`, `1..=5` (printed `1...5`), `mut x`
    expect(show_pat(pat({ $: "Ref", _0: bind("z"), _1: "Not", _2: "Mut" }))).toBe("&mut z");
    expect(show_pat(pat({ $: "Range", _0: patlit(1), _1: patlit(5), _2: "Included" }))).toBe("1...5");
    expect(show_pat(bind("x", "Mut"))).toBe("mut x");
    // or-pattern / slice (upstream logic: `strsep("|", true, ..)`; a `Wild` rest prints as `..`)
    expect(show_pat(pat({ $: "Or", _0: [bind("a"), bind("b")] }))).toBe("a | b");
    expect(show_pat(pat({ $: "Slice", _0: [bind("a")], _1: pat({ $: "Wild" }), _2: [bind("c")] }))).toBe("[a, .., c]");
  }));

test("fn headers, generic params, where clauses (oracle)", () =>
  g(() => {
    // `const unsafe extern "C" fn`
    const header = new hir.FnHeader({ $: "Normal", _0: "Unsafe" }, { $: "Const", always: false }, hir.IsAsync.NotAsync, ExternAbi.C(false));
    expect(render((s) => s.print_fn_header_info(header))).toBe('const unsafe extern "C" fn');
    const tf = new hir.FnHeader({ $: "SafeTargetFeatures" }, hir.Constness.NotConst, hir.IsAsync.NotAsync, ExternAbi.Rust);
    expect(render((s) => s.print_fn_header_info(tf))).toBe("#[target_feature] fn");
    // `<'a, 'b, T>` (an elided lifetime param is skipped)
    const gp = (n: string, kind: hir.GenericParamKind): hir.GenericParam =>
      new hir.GenericParam(H, CRATE_DEF_ID, { $: "Plain", _0: id(n) }, sp, false, kind, undefined, "Generics");
    const params = [
      gp("'a", { $: "Lifetime", kind: { $: "Explicit" } }),
      gp("'_", { $: "Lifetime", kind: { $: "Elided", _0: "Underscore" } }),
      gp("T", { $: "Type", default: undefined, synthetic: false }),
    ];
    expect(render((s) => s.print_generic_params(params))).toBe("<'a, T>");
    expect(render((s) => s.print_generic_params([params[1]!]))).toBe("");
    // ` where T: 'a, 'a:'b`
    const preds: hir.WherePredicate[] = [
      {
        hir_id: H,
        span: sp,
        kind: { $: "BoundPredicate", _0: new hir.WhereBoundPredicate("WhereClause", [], ty("T"), [{ $: "Outlives", _0: lifetime("'a") }]) },
      },
      { hir_id: H, span: sp, kind: { $: "RegionPredicate", _0: new hir.WhereRegionPredicate(true, lifetime("'a"), [{ $: "Outlives", _0: lifetime("'b") }]) } },
    ];
    const generics = new hir.Generics([], preds, true, sp, sp);
    expect(render((s) => s.print_where_clause(generics))).toBe(" where T: 'a, 'a:'b");
  }));

test("free fns: expr_requires_semi_to_be_stmt, stmt_ends_with_semi, contains_exterior_struct_lit", () =>
  g(() => {
    const blk = new hir.Block([], undefined, H, { $: "DefaultBlock" }, sp, false);
    const block = e({ $: "Block", _0: blk, _1: undefined });
    expect(expr_requires_semi_to_be_stmt(block)).toBe(false);
    expect(expr_requires_semi_to_be_stmt(p("x"))).toBe(true);
    expect(stmt_ends_with_semi({ $: "Expr", _0: block })).toBe(false);
    expect(stmt_ends_with_semi({ $: "Expr", _0: p("x") })).toBe(true);
    expect(stmt_ends_with_semi({ $: "Semi", _0: p("x") })).toBe(false);
    const st = e({ $: "Struct", _0: qpath("X"), _1: [], _2: hir.StructTailExpr.None });
    expect(contains_exterior_struct_lit(st)).toBe(true);
    expect(contains_exterior_struct_lit(bin("Eq", p("foo"), st))).toBe(true);
    expect(contains_exterior_struct_lit(e({ $: "Field", _0: st, _1: id("y") }))).toBe(true);
    expect(contains_exterior_struct_lit(e({ $: "MethodCall", _0: seg("bar"), _1: st, _2: [], _3: sp }))).toBe(true);
    expect(contains_exterior_struct_lit(bin("Eq", p("foo"), e({ $: "Tup", _0: [st] })))).toBe(false);
  }));
