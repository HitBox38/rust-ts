// Unit tests (lane typeck-expr-a) for the self-contained parts of op.rs and expr.rs:1..1854: the `BinOpCategory` /
// `Op` impls, `deref_ty_if_possible`, `is_builtin_binop`, `contains_let_in_chain`, `lang_item_for_binop` /
// `lang_item_for_unop`, and the dispatch / divergence bookkeeping of a few `FnCtxt` methods called on a stand-in
// receiver (they only read the members the stand-in provides).
import { describe, expect, test } from "bun:test";
import "./lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { FnCtxt } from "./decls.ts";
import { Diverges } from "./diverges.ts";
import { Expectation } from "./expectation.ts";
import { BinOpCategory, contains_let_in_chain, deref_ty_if_possible, is_builtin_binop, lang_item_for_binop, lang_item_for_unop, Op } from "./op.ts";

/** A `TyCtxt` over fresh interners (as rustc_middle ty/error.test.ts). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const tcx = mk_tcx();
const t = tcx.types;
const ref = (ty: Ty, mutbl: "Not" | "Mut"): Ty => tcx.mk_ty_from_kind({ $: "Ref", _0: tcx.lifetimes.re_erased, _1: ty, _2: mutbl });
const sp = (n: number): Span => n as unknown as Span;

describe("op.rs BinOpCategory / Op", () => {
  test("From<BinOpKind> for BinOpCategory", () => {
    const cases: [Parameters<typeof BinOpCategory.from_BinOpKind>[0], string][] = [
      ["Shl", "Shift"], ["Shr", "Shift"],
      ["Add", "Math"], ["Sub", "Math"], ["Mul", "Math"], ["Div", "Math"], ["Rem", "Math"],
      ["BitXor", "Bitwise"], ["BitAnd", "Bitwise"], ["BitOr", "Bitwise"],
      ["Eq", "Comparison"], ["Ne", "Comparison"], ["Lt", "Comparison"], ["Le", "Comparison"], ["Ge", "Comparison"], ["Gt", "Comparison"],
      ["And", "Shortcircuit"], ["Or", "Shortcircuit"],
    ];
    for (const [op, cat] of cases) expect(BinOpCategory.from_BinOpKind(op)).toBe(cat as never);
  });

  test("From<AssignOpKind> for BinOpCategory", () => {
    const cases: [Parameters<typeof BinOpCategory.from_AssignOpKind>[0], string][] = [
      ["ShlAssign", "Shift"], ["ShrAssign", "Shift"],
      ["AddAssign", "Math"], ["SubAssign", "Math"], ["MulAssign", "Math"], ["DivAssign", "Math"], ["RemAssign", "Math"],
      ["BitXorAssign", "Bitwise"], ["BitAndAssign", "Bitwise"], ["BitOrAssign", "Bitwise"],
    ];
    for (const [op, cat] of cases) expect(BinOpCategory.from_AssignOpKind(op)).toBe(cat as never);
  });

  test("Op::span / as_str / is_by_value", () => {
    const add: Op = { $: "BinOp", _0: { node: "Add", span: sp(3) } };
    const eq: Op = { $: "BinOp", _0: { node: "Eq", span: sp(4) } };
    const add_assign: Op = { $: "AssignOp", _0: { node: "AddAssign", span: sp(5) } };
    expect(Op.span(add)).toBe(sp(3));
    expect(Op.span(add_assign)).toBe(sp(5));
    expect(Op.as_str(add)).toBe("+");
    expect(Op.as_str(eq)).toBe("==");
    expect(Op.as_str(add_assign)).toBe("+=");
    expect(Op.is_by_value(add)).toBe(true);
    expect(Op.is_by_value(eq)).toBe(false);
    expect(Op.is_by_value(add_assign)).toBe(true); // "AssignOps are always by value"
  });
});

describe("op.rs free fns", () => {
  test("deref_ty_if_possible peels one shared reference only", () => {
    expect(deref_ty_if_possible(ref(t.i32, "Not"))).toBe(t.i32);
    expect(deref_ty_if_possible(ref(ref(t.i32, "Not"), "Not"))).toBe(ref(t.i32, "Not"));
    expect(deref_ty_if_possible(ref(t.i32, "Mut"))).toBe(ref(t.i32, "Mut"));
    expect(deref_ty_if_possible(t.bool)).toBe(t.bool);
  });

  test("is_builtin_binop", () => {
    expect(is_builtin_binop(t.str_, t.str_, "Shortcircuit")).toBe(true);
    expect(is_builtin_binop(t.u8, t.i64, "Shift")).toBe(true);
    expect(is_builtin_binop(t.f32, t.i64, "Shift")).toBe(false);
    expect(is_builtin_binop(t.i32, ref(t.i32, "Not"), "Math")).toBe(true);
    expect(is_builtin_binop(t.f64, t.f64, "Math")).toBe(true);
    expect(is_builtin_binop(t.bool, t.bool, "Math")).toBe(false);
    expect(is_builtin_binop(t.bool, t.bool, "Bitwise")).toBe(true);
    expect(is_builtin_binop(t.i32, ref(t.i32, "Mut"), "Bitwise")).toBe(false);
    expect(is_builtin_binop(t.char, t.char, "Comparison")).toBe(true);
    expect(is_builtin_binop(t.str_, t.str_, "Comparison")).toBe(false);
  });

  test("contains_let_in_chain: `let` anywhere under `&&`", () => {
    const e = (kind: unknown): hir.Expr => ({ kind }) as unknown as hir.Expr;
    const lit = e({ $: "Lit" });
    const let_ = e({ $: "Let" });
    const and = (l: hir.Expr, r: hir.Expr): hir.Expr => e({ $: "Binary", _0: { node: "And", span: sp(0) }, _1: l, _2: r });
    const or = (l: hir.Expr, r: hir.Expr): hir.Expr => e({ $: "Binary", _0: { node: "Or", span: sp(0) }, _1: l, _2: r });
    expect(contains_let_in_chain(let_)).toBe(true);
    expect(contains_let_in_chain(lit)).toBe(false);
    expect(contains_let_in_chain(and(lit, and(lit, let_)))).toBe(true);
    expect(contains_let_in_chain(and(lit, lit))).toBe(false);
    expect(contains_let_in_chain(or(let_, lit))).toBe(false);
  });

  test("lang_item_for_binop / lang_item_for_unop", () => {
    const did = (n: number): DefId => new DefId(0 as never, n as never);
    const lang = {
      add_trait: () => did(1),
      partial_ord_trait: () => did(2),
      eq_trait: () => did(3),
      shl_assign_trait: () => undefined,
      neg_trait: () => did(4),
    };
    const ftcx = { lang_items: () => lang } as unknown as TyCtxt;
    expect(lang_item_for_binop(ftcx, { $: "BinOp", _0: { node: "Add", span: sp(0) } })).toEqual([sym.add, did(1)]);
    expect(lang_item_for_binop(ftcx, { $: "BinOp", _0: { node: "Ge", span: sp(0) } })).toEqual([sym.ge, did(2)]);
    expect(lang_item_for_binop(ftcx, { $: "BinOp", _0: { node: "Ne", span: sp(0) } })).toEqual([sym.ne, did(3)]);
    expect(lang_item_for_binop(ftcx, { $: "AssignOp", _0: { node: "ShlAssign", span: sp(0) } })).toEqual([sym.shl_assign, undefined]);
    expect(() => lang_item_for_binop(ftcx, { $: "BinOp", _0: { node: "And", span: sp(0) } })).toThrow(/&& and \|\| are not overloadable/);
    expect(lang_item_for_unop(ftcx, "Neg")).toEqual([sym.neg, did(4)]);
    expect(() => lang_item_for_unop(ftcx, "Deref")).toThrow(/Deref is not overloadable/);
  });
});

describe("expr.rs FnCtxt methods on a stand-in receiver", () => {
  test("check_expr_kind dispatches `DropTemps` / `Use` with the expectation and `Err` to an error type", () => {
    const seen: unknown[] = [];
    const inner = { kind: { $: "Lit" } } as unknown as hir.Expr;
    const fcx = {
      tcx,
      check_expr_with_expectation: (e: hir.Expr, exp: unknown) => (seen.push([e, exp]), t.u8),
    } as unknown as FnCtxt;
    const expected = { $: "ExpectHasType" as const, _0: t.u8 };
    expect(FnCtxt.prototype.check_expr_kind.call(fcx, { kind: { $: "DropTemps", _0: inner } } as unknown as hir.Expr, expected)).toBe(t.u8);
    expect(FnCtxt.prototype.check_expr_use.call(fcx, inner, expected)).toBe(t.u8);
    expect(seen).toEqual([[inner, expected], [inner, expected]]);
    const guar = {} as never;
    expect(FnCtxt.prototype.check_expr_kind.call(fcx, { kind: { $: "Err", _0: guar } } as unknown as hir.Expr, Expectation.NoExpectation).kind().$).toBe("Error");
  });

  test("check_expr_continue: `!` for a loop target, misc error type for an unresolved label", () => {
    const fcx = { tcx: { types: t, hir_node: () => ({ $: "Expr", _0: { kind: { $: "Loop" } } }) } } as unknown as FnCtxt;
    const ok = FnCtxt.prototype.check_expr_continue.call(fcx, { label: undefined, target_id: { $: "Ok", _0: {} as never } }, {} as hir.Expr);
    expect(ok).toBe(t.never);
  });

  test("check_expr_loop: a `while` loop that may break is `()` and resets divergence", () => {
    const fcx = {
      tcx,
      diverges: Diverges.always(sp(9)),
      with_breakable_ctxt: (_id: unknown, ctxt: { may_break: boolean; coerce: unknown }, f: () => void) => {
        f();
        ctxt.may_break = true;
        return [ctxt, undefined];
      },
      check_block_no_value: () => {},
      dcx: () => ({ span_bug: (_: unknown, msg: string) => { throw new Error(msg); } }),
    } as unknown as FnCtxt;
    const body = { span: sp(1) } as unknown as hir.Block;
    const ty = FnCtxt.prototype.check_expr_loop.call(fcx, body, "While", Expectation.NoExpectation, { hir_id: {}, span: sp(2) } as unknown as hir.Expr);
    expect(ty).toBe(t.unit);
    expect(fcx.diverges).toBe(Diverges.Maybe);
  });

  test("check_expr_loop: a `while` loop that cannot break is a bug", () => {
    const fcx = {
      tcx,
      diverges: Diverges.Maybe,
      with_breakable_ctxt: (_id: unknown, ctxt: unknown, f: () => void) => (f(), [ctxt, undefined]),
      check_block_no_value: () => {},
      dcx: () => ({ span_bug: (_: unknown, msg: string) => { throw new Error(msg); } }),
    } as unknown as FnCtxt;
    const body = { span: sp(1) } as unknown as hir.Block;
    expect(() => FnCtxt.prototype.check_expr_loop.call(fcx, body, "ForLoop", Expectation.NoExpectation, { hir_id: {}, span: sp(2) } as unknown as hir.Expr)).toThrow(/no coercion, but loop may not break/);
    expect(fcx.diverges).toEqual(Diverges.always(sp(2)));
  });
});
