// Unit tests for the expr.rs / expr/closure.rs port (lane lower-expr). Not an upstream test file.
//
// The rest of the crate (lib.rs, block.rs, path.rs, ...) is ported by parallel lanes, so these tests drive
// the expr.rs methods on a `LoweringContext` whose foreign methods are minimal own-property stubs (fresh
// `HirId`s from a counter, identity span lowering, a recording `mark_span_with_reason`, a placeholder
// lang-item qpath). Expectations are derived from the upstream fns (line numbers in comments).
import { expect, test } from "bun:test";
import { type Expr, visit } from "../rustc_ast/lib.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type { LangItem } from "../rustc_attr_ir/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { ParseSess } from "../rustc_session/parse.ts";
import { CRATE_DEF_ID } from "../rustc_span/def_id.ts";
import type { DesugaringKind } from "../rustc_span/hygiene.ts";
import { create_default_session_globals_then, Span } from "../rustc_span/lib.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import { LoweringContext } from "./lib.ts";
import { MoveExprInitializerFinder, WillCreateDefIdsVisitor } from "./expr.ts";

let file_counter = 0;
function parse_expr(psess: ParseSess, src: string): Expr {
  const sm = psess.source_map();
  // A fresh file name per source: the source map returns the existing file for a known name.
  const path = `lower_expr_test_${file_counter++}.rs`;
  const name = { $: "Real" as const, _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
  const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, name, src, "Nothing"));
  const r = p.parse_expr();
  if (r.$ === "Err") return panic("parse error");
  return r._0;
}

interface Fake {
  cx: LoweringContext;
  marks: [string, Span][];
  lang_items: LangItem[];
}

function fake_ctx(new_range = false): Fake {
  const cx = Object.create(LoweringContext.prototype) as LoweringContext;
  const owner = new OwnerId(CRATE_DEF_ID);
  let counter = 0;
  const marks: [string, Span][] = [];
  const lang_items: LangItem[] = [];
  const own = cx as unknown as Record<string, unknown>;
  own.next_id = (): HirId => new HirId(owner, ItemLocalId.from_u32(++counter));
  own.lower_node_id = (): HirId => new HirId(owner, ItemLocalId.from_u32(++counter));
  own.lower_span = (s: Span): Span => s;
  own.lower_ident = <T>(i: T): T => i;
  own.lower_attrs = (): readonly unknown[] => [];
  own.mark_span_with_reason = (kind: DesugaringKind, span: Span): Span => {
    marks.push([kind.$, span]);
    return span;
  };
  own.make_lang_item_qpath = (lang_item: LangItem, span: Span): unknown => {
    lang_items.push(lang_item);
    return { $: "Resolved", _0: undefined, _1: { span, res: { $: "Err" }, segments: [] } };
  };
  own.tcx = { features: () => ({ new_range: () => new_range }) };
  cx.move_expr_bindings = [];
  cx.lowering_move_expr_initializer = false;
  cx.loop_scope = undefined;
  cx.is_in_loop_condition = false;
  cx.try_block_scope = { $: "Function" };
  cx.coroutine_kind = undefined;
  cx.task_context = undefined;
  // a fake with only the fields expr.rs reads
  cx.curr_owner = {
    owner: { get_label_res: () => undefined },
    ident_and_label_to_local_id: new Map(),
    owner_id: () => owner,
  } as unknown as LoweringContext["curr_owner"];
  return { cx, marks, lang_items };
}

function lit_int(e: hir.Expr): string {
  if (e.kind.$ !== "Lit" || e.kind._0.node.$ !== "Int") return panic(`not an int literal: ${e.kind.$}`);
  return String(e.kind._0.node._0);
}

test("MoveExprInitializerFinder collects `move(..)` initializers inner-first, skipping const blocks (expr.rs:76)", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const e = parse_expr(psess, "f(move(move(a)), move(b), const { move(c) })");
    const found = MoveExprInitializerFinder.collect(e);
    // `move(move(a))`: the inner `move(a)` is visited (and pushed) before the outer one is pushed.
    expect(found.map((i) => i.expr.kind.$)).toEqual(["Path", "Move", "Path"]);
    // The outer initializer is the inner `move(a)` expression itself.
    expect(found[1]!.expr.kind.$).toBe("Move");
  });
});

test("WillCreateDefIdsVisitor breaks on anon consts, items, closures and blocks with defs (expr.rs:93-108)", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const run = (src: string): ControlFlow<Span> => new WillCreateDefIdsVisitor().visit_expr(parse_expr(psess, src));
    expect(run("1 + x.y[2]").$).toBe("Continue");
    const closure = parse_expr(psess, "1 + (|| 2)");
    const r = new WillCreateDefIdsVisitor().visit_expr(closure);
    expect(r.$).toBe("Break");
    // The break span is the closure expression's span (inside the parens).
    if (closure.kind.$ !== "Binary" || closure.kind._2.kind.$ !== "Paren") return panic("shape");
    expect(r._0).toBe(closure.kind._2.kind._0.span);
    expect(run("[0u8; 3]").$).toBe("Break");
    expect(run("{ fn f() {} 1 }").$).toBe("Break");
    expect(run("const { 1 }").$).toBe("Break");
  });
});

test("lower_expr_mut: parenthesised binary keeps the inner HirId and widens the span (expr.rs:223)", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const e = parse_expr(psess, "(1 + 2)");
    const { cx } = fake_ctx();
    const own = cx as unknown as Record<string, unknown>;
    own.lower_lit = LoweringContext.prototype.lower_lit;
    own.tcx = { features: () => ({}), sess: { psess } };
    const h = cx.lower_expr_mut(e);
    expect(h.kind.$).toBe("Binary");
    expect(h.span).toBe(e.span);
    if (h.kind.$ !== "Binary" || e.kind.$ !== "Paren") return panic("shape");
    expect(h.kind._0.node).toBe("Add");
    expect(lit_int(h.kind._1)).toBe("1");
    expect(lit_int(h.kind._2)).toBe("2");
    // ids: the Binary's lower_node_id (1) is taken before its operands (2, 3).
    expect(h.hir_id.local_id).toBe(ItemLocalId.from_u32(1));
    expect(h.kind._1.hir_id.local_id).toBe(ItemLocalId.from_u32(2));
  });
});

test("lower_expr_range: lang items and field names with and without `new_range` (expr.rs:1492)", () => {
  create_default_session_globals_then(() => {
    const psess = ParseSess.new();
    const lower = (src: string, new_range: boolean): [hir.ExprKind, Fake] => {
      const fake = fake_ctx(new_range);
      const own = fake.cx as unknown as Record<string, unknown>;
      own.tcx = { features: () => ({ new_range: () => new_range }), sess: { psess } };
      const e = parse_expr(psess, src);
      if (e.kind.$ !== "Range") return panic("not a range");
      return [fake.cx.lower_expr_range(e.span, e.kind._0, e.kind._1, e.kind._2), fake];
    };
    const field_names = (k: hir.ExprKind): Symbol[] => (k.$ === "Struct" ? k._1.map((f) => f.ident.name) : panic("not a struct"));

    let [k, fake] = lower("..", false);
    expect(fake.lang_items).toEqual(["RangeFull"]);
    expect(field_names(k)).toEqual([]);

    [k, fake] = lower("1..2", false);
    expect(fake.lang_items).toEqual(["Range"]);
    expect(field_names(k)).toEqual([sym.start, sym.end]);
    // Each field span is marked `RangeExpr` (expr.rs:1565).
    expect(fake.marks.map(([m]) => m)).toEqual(["RangeExpr", "RangeExpr"]);

    [k, fake] = lower("1..2", true);
    expect(fake.lang_items).toEqual(["RangeCopy"]);

    [k, fake] = lower("..=5", false);
    expect(fake.lang_items).toEqual(["RangeToInclusive"]);
    expect(field_names(k)).toEqual([sym.end]);

    [k, fake] = lower("..=5", true);
    expect(fake.lang_items).toEqual(["RangeToInclusiveCopy"]);
    expect(field_names(k)).toEqual([sym.last]);

    [k, fake] = lower("1..=2", true);
    expect(fake.lang_items).toEqual(["RangeInclusiveCopy"]);
    expect(field_names(k)).toEqual([sym.start, sym.last]);

    // Without `new_range`, `a..=b` is `RangeInclusive::new(a, b)` (expr.rs:1484).
    [k, fake] = lower("1..=2", false);
    expect(fake.lang_items).toEqual(["RangeInclusiveNew"]);
    expect(k.$).toBe("Call");
    if (k.$ !== "Call") return;
    expect(k._1.map(lit_int)).toEqual(["1", "2"]);
  });
});

test("loop scopes and jump destinations (expr.rs:1592-1658)", () => {
  const { cx } = fake_ctx();
  const outside = cx.lower_jump_destination(0 as never, undefined);
  expect(outside.target_id).toEqual({ $: "Err", _0: "OutsideLoopScope" });

  const loop_id = cx.next_id();
  const inside = cx.with_loop_scope(loop_id, (this_) => this_.lower_jump_destination(0 as never, undefined));
  expect(inside.target_id).toEqual({ $: "Ok", _0: loop_id });
  expect(cx.loop_scope).toBeUndefined();

  // An unlabeled `break` in a `while` condition, but not inside a loop nested in the condition.
  const in_cond = cx.with_loop_scope(loop_id, (this_) =>
    this_.with_loop_condition_scope((this_) => [
      this_.lower_jump_destination(0 as never, undefined),
      this_.with_loop_scope(loop_id, (this_) => this_.lower_jump_destination(0 as never, undefined)),
      this_.is_in_loop_condition,
    ]),
  );
  expect(in_cond[0]).toEqual({ label: undefined, target_id: { $: "Err", _0: "UnlabeledCfInWhileCondition" } });
  expect((in_cond[1] as hir.Destination).target_id).toEqual({ $: "Ok", _0: loop_id });
  expect(in_cond[2]).toBe(true);
  expect(cx.is_in_loop_condition).toBe(false);
});

test("with_move_expr_bindings pushes and pops the state (expr.rs:112)", () => {
  const { cx } = fake_ctx();
  const state = { occurrences: [] };
  const [depth, popped] = cx.with_move_expr_bindings(state, (this_) => this_.move_expr_bindings.length);
  expect(depth).toBe(1);
  expect(popped).toBe(state);
  expect(cx.move_expr_bindings.length).toBe(0);
  const [, none] = cx.with_move_expr_bindings(undefined, () => 0);
  expect(none).toBeUndefined();
});

test("expr_ident_mut allocates the segment id before the expression id (expr.rs:2255)", () => {
  create_default_session_globals_then(() => {
    const { cx } = fake_ctx();
    const binding = cx.next_id();
    const e = cx.expr_ident_mut(Span.default(), { name: sym.iter, span: Span.default() } as never, binding);
    if (e.kind.$ !== "Path" || e.kind._0.$ !== "Resolved") return panic("shape");
    const path = e.kind._0._1;
    expect(path.res).toEqual({ $: "Local", _0: binding });
    expect(path.segments[0]!.hir_id.local_id).toBe(ItemLocalId.from_u32(2));
    expect(e.hir_id.local_id).toBe(ItemLocalId.from_u32(3));
  });
});

test("visitor classes extend the rustc_ast Visitor", () => {
  expect(new MoveExprInitializerFinder([])).toBeInstanceOf(visit.Visitor);
  expect(new WillCreateDefIdsVisitor()).toBeInstanceOf(visit.Visitor);
});
