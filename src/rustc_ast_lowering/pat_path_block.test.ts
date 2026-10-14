// Unit tests for the ports of compiler/rustc_ast_lowering/src/{pat,path,block}.rs (lane lower-pat-path-block; upstream
// has no unit tests for these files). The lib.rs / expr.rs methods they call (lanes lower-lib-a/-b, lower-expr) are
// still placeholders, so each test runs on a LoweringContext whose collaborators are small fakes: `lower_node_id`
// hands out ItemLocalIds in call order (memoized per NodeId, as lib.rs:899 does), `next_id` takes the next one. The
// expected HIR and HirId numbering are derived from the upstream fns (line numbers in comments).
import { describe, expect, test } from "bun:test";
import {
  type AnonConst,
  BindingMode,
  type Block,
  Expr,
  type ExprKind,
  type Local,
  Pat,
  type PatKind,
  type RangeEnd,
  Stmt,
  type StmtKind,
  type TyPat,
} from "../rustc_ast/lib.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import { DefKind, PerNS, type Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId, type ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { PartialRes, PerOwnerResolverData } from "../rustc_middle/middle/resolve.ts";
import { CrateNum, DefId, type DefIndex, type LocalDefId } from "../rustc_span/def_id.ts";
import { ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import { Panic, Unported } from "../std/panic.ts";
import { HIR_ARENA, LoweringContext } from "./lib.ts";

const sp = (n: number) => n as Span;
const nid = (n: number) => n as NodeId;
const OWNER = new OwnerId(7 as LocalDefId);
const hid = (local: number) => new HirId(OWNER, local as ItemLocalId);
const ident = (s: number, span = 0) => new Ident(s as Symbol, sp(span));
const GUAR = ErrorGuaranteed.unchecked_error_guaranteed();
const STRUCT_DEF = new DefId(5 as DefIndex, CrateNum.from_u32(0));

/** A LoweringContext with fakes for the placeholder methods of other lanes. */
function fake(opts: { features?: Record<string, boolean>; partial_res?: [number, Res<NodeId>][] } = {}) {
  const lctx = Object.create(LoweringContext.prototype) as LoweringContext;
  const ids = new Map<NodeId, HirId>();
  let next = 0;
  const log: string[] = [];
  const partial = new Map(opts.partial_res?.map(([id, res]) => [nid(id), PartialRes.new(res)]));
  const curr_owner = {
    ident_and_label_to_local_id: new Map<NodeId, ItemLocalId>(),
    owner_id: () => OWNER,
    owner: PerOwnerResolverData.new(nid(0), OWNER.def_id),
  };
  const features = opts.features ?? {};
  Object.assign(lctx, {
    arena: HIR_ARENA,
    curr_owner,
    tcx: {
      features: () => new Proxy({}, { get: (_t, name: string) => () => features[name] ?? false }),
    },
    lower_node_id(this: LoweringContext, id: NodeId): HirId {
      let h = ids.get(id);
      if (h === undefined) {
        h = hid(next++);
        ids.set(id, h);
      }
      return h;
    },
    next_id: () => hid(next++),
    lower_span: (s: Span) => s,
    lower_ident: (i: Ident) => i,
    lower_res: (r: Res<NodeId>) => r,
    get_partial_res: (id: NodeId) => partial.get(id),
    dcx: () => ({ emit_err: () => (log.push("emit_err"), GUAR) }),
    lower_attrs: (id: HirId, attrs: unknown[], _span: Span, target: { $: string }) => {
      log.push(`attrs ${id.local_id} ${attrs.length} ${target.$}`);
      return [];
    },
    alias_attrs: (id: HirId, target_id: HirId) => log.push(`alias ${id.local_id}->${target_id.local_id}`),
    lower_expr(this: LoweringContext, e: Expr): hir.Expr {
      return new hir.Expr(this.lower_node_id(e.id), { $: "Err", _0: GUAR }, e.span);
    },
    lower_lit: (lit: unknown, span: Span) => ({ node: { $: "Lowered", lit }, span }),
    lower_unsafe_source: (u: unknown) => u,
  });
  return { lctx, log, curr_owner };
}

const pat = (id: number, kind: PatKind, span = 0) => new Pat(nid(id), kind, sp(span));
const bind = (id: number, name: number, sub?: Pat) => pat(id, { $: "Ident", _0: BindingMode.NONE, _1: ident(name), _2: sub });
const rest = (id: number) => pat(id, { $: "Rest" });
const expr = (id: number, kind: ExprKind, span = 0) => new Expr(nid(id), kind, sp(span), [], undefined);
const local_ids = (ps: readonly hir.Pat[]) => ps.map((p) => p.hir_id.local_id as number);
const stops = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof Unported || e instanceof Panic) return `${e.constructor.name}: ${e.message}`;
    throw e;
  }
  throw new Error("expected a stop");
};

describe("block.rs", () => {
  test("lower_block: stmts, the tail expression and HirId order (block.rs:10-79, 91-109)", () => {
    const { lctx, log } = fake();
    const local: Local = {
      id: nid(30),
      super_: undefined,
      pat: bind(40, 1),
      ty: undefined,
      kind: { $: "Decl" },
      span: sp(3),
      colon_sp: undefined,
      attrs: [],
      tokens: undefined,
    };
    const stmts = [
      new Stmt(nid(10), { $: "Let", _0: local }, sp(1)),
      new Stmt(nid(11), { $: "Empty" }, sp(0)),
      new Stmt(nid(12), { $: "Semi", _0: expr(21, { $: "Dummy" }) }, sp(2)),
      new Stmt(nid(13), { $: "Expr", _0: expr(22, { $: "Dummy" }) }, sp(4)),
    ];
    const b: Block = { stmts, id: nid(1), rules: { $: "Default" }, span: sp(9) };
    const out = lctx.lower_block(b, true);
    expect(out).toBeInstanceOf(hir.Block);
    // block id first (block.rs:15), then per stmt: Let: stmt id, local id, pat id; Semi: expr first, then stmt id
    expect(out.hir_id.local_id as number).toBe(0);
    expect(out.stmts.map((s) => [s.kind.$, s.hir_id.local_id as number])).toEqual([
      ["Let", 1],
      ["Semi", 5],
    ]);
    const let_ = (out.stmts[0]!.kind as Extract<hir.StmtKind, { $: "Let" }>)._0;
    expect([let_.hir_id.local_id, let_.pat.hir_id.local_id, let_.ty, let_.init, let_.els, let_.source]).toEqual([
      2 as ItemLocalId,
      3 as ItemLocalId,
      undefined,
      undefined,
      undefined,
      "Normal",
    ]);
    // the trailing `StmtKind::Expr` becomes the block's expression and gets no stmt HirId
    expect(out.expr?.hir_id.local_id as number).toBe(6);
    expect([out.rules, out.span, out.targeted_by_break]).toEqual([{ $: "DefaultBlock" }, sp(9), true]);
    expect(log).toEqual(["attrs 2 0 Statement", "alias 1->2", "alias 5->4"]);
  });

  test("lower_stmts: a non-trailing StmtKind::Expr is a statement (block.rs:53-64)", () => {
    const { lctx } = fake();
    const [stmts, tail] = lctx.lower_stmts([
      new Stmt(nid(10), { $: "Expr", _0: expr(20, { $: "Dummy" }) }, sp(0)),
      new Stmt(nid(11), { $: "Empty" }, sp(0)),
    ]);
    expect(stmts.map((s) => s.kind.$)).toEqual(["Expr"]);
    expect(tail).toBeUndefined();
  });

  test("lower_stmts: MacCall panics (block.rs:74)", () => {
    const { lctx } = fake();
    const mac = { $: "MacCall", _0: {} } as unknown as StmtKind;
    expect(stops(() => lctx.lower_stmts([new Stmt(nid(1), mac, sp(0))]))).toBe("Panic: shouldn't exist here");
  });

  test("impl_trait_in_bindings_ctxt follows the feature gate (block.rs:83)", () => {
    expect(fake().lctx.impl_trait_in_bindings_ctxt("Variable")).toEqual({
      $: "FeatureGated",
      _0: "Variable",
      _1: sym.impl_trait_in_bindings,
    });
    expect(fake({ features: { impl_trait_in_bindings: true } }).lctx.impl_trait_in_bindings_ctxt("Variable")).toEqual({
      $: "InBinding",
    });
  });

  test("lower_block_check_mode (block.rs:111)", () => {
    const { lctx } = fake();
    expect(lctx.lower_block_check_mode({ $: "Default" })).toEqual({ $: "DefaultBlock" });
    expect(lctx.lower_block_check_mode({ $: "Unsafe", _0: "UserProvided" })).toEqual({
      $: "UnsafeBlock",
      _0: "UserProvided",
    });
  });
});

describe("pat.rs", () => {
  test("tuple with `..`: elements around the rest, DotDotPos, HirIds (pat.rs:115-117, 152-201)", () => {
    const { lctx, curr_owner } = fake();
    const out = lctx.lower_pat(pat(1, { $: "Tuple", _0: [bind(2, 10), rest(3), bind(4, 11)] }, 5));
    expect(out.hir_id.local_id as number).toBe(0);
    expect([out.span, out.default_binding_modes]).toEqual([sp(5), true]);
    const k = out.kind as Extract<hir.PatKind, { $: "Tuple" }>;
    expect(k.$).toBe("Tuple");
    expect(local_ids(k._0)).toEqual([1, 2]);
    expect(k._1).toEqual(new hir.DotDotPos(1));
    // bindings record their own HirId (pat.rs:301-303)
    expect([...curr_owner.ident_and_label_to_local_id]).toEqual([
      [nid(2), 1 as ItemLocalId],
      [nid(4), 2 as ItemLocalId],
    ]);
    expect(k._0.map((p) => (p.kind as Extract<hir.PatKind, { $: "Binding" }>)._1.local_id as number)).toEqual([1, 2]);
  });

  test("tuple without `..` has DotDotPos::new(None) (pat.rs:200)", () => {
    const { lctx } = fake();
    const k = lctx.lower_pat(pat(1, { $: "Tuple", _0: [bind(2, 10)] })).kind as Extract<hir.PatKind, { $: "Tuple" }>;
    expect(k._1).toEqual(hir.DotDotPos.new(undefined));
  });

  test("a second `..` in a tuple reports ExtraDoubleDot (pat.rs:192-194)", () => {
    const { lctx, log } = fake();
    const k = lctx.lower_pat(pat(1, { $: "Tuple", _0: [rest(2), rest(3)] })).kind as Extract<hir.PatKind, { $: "Tuple" }>;
    expect(log.filter((l) => l === "emit_err").length).toBe(1);
    expect(k._1).toEqual(hir.DotDotPos.new(0));
  });

  test("slice with `rest @ ..`: sub-slice binding lowered to `rest @ _` (pat.rs:209-273)", () => {
    const { lctx } = fake();
    const out = lctx.lower_pat(pat(1, { $: "Slice", _0: [bind(2, 10), bind(3, 11, rest(4)), bind(5, 12)] }));
    const k = out.kind as Extract<hir.PatKind, { $: "Slice" }>;
    expect(local_ids(k._0)).toEqual([1]);
    // lower_rest_sub: the sub-pattern's id is lowered before the binding's (pat.rs:217-219)
    const slice = k._1!;
    expect(slice.hir_id.local_id as number).toBe(3);
    const b = slice.kind as Extract<hir.PatKind, { $: "Binding" }>;
    expect([b.$, b._3?.hir_id.local_id, b._3?.kind]).toEqual(["Binding", 2 as ItemLocalId, hir.PatKind.Wild]);
    expect(local_ids(k._2)).toEqual([4]);
  });

  test("slice with `..`: the rest is a wildcard with the rest pattern's id (pat.rs:229-233)", () => {
    const { lctx } = fake();
    const k = lctx.lower_pat(pat(1, { $: "Slice", _0: [rest(2), bind(3, 10)] })).kind as Extract<
      hir.PatKind,
      { $: "Slice" }
    >;
    expect([k._0.length, k._1?.hir_id.local_id, k._1?.kind, local_ids(k._2)]).toEqual([
      0,
      1 as ItemLocalId,
      hir.PatKind.Wild,
      [2],
    ]);
  });

  test("or-pattern bindings resolved to the same local share one HirId (pat.rs:287-299)", () => {
    const { lctx } = fake({ partial_res: [[2, { $: "Local", _0: nid(2) }], [3, { $: "Local", _0: nid(2) }]] });
    const k = lctx.lower_pat(pat(1, { $: "Or", _0: [bind(2, 10), bind(3, 10)] })).kind as Extract<
      hir.PatKind,
      { $: "Or" }
    >;
    expect(local_ids(k._0)).toEqual([1, 2]);
    expect(k._0.map((p) => (p.kind as Extract<hir.PatKind, { $: "Binding" }>)._1.local_id as number)).toEqual([1, 1]);
  });

  test("an identifier resolving to a definition becomes a path pattern expression (pat.rs:313-328)", () => {
    const res: Res<NodeId> = { $: "Def", _0: DefKind.Struct, _1: STRUCT_DEF };
    const { lctx } = fake({ partial_res: [[1, res]] });
    const out = lctx.lower_pat(pat(1, { $: "Ident", _0: BindingMode.NONE, _1: ident(10, 8), _2: undefined }, 9));
    expect(out.hir_id.local_id as number).toBe(0);
    const e = (out.kind as Extract<hir.PatKind, { $: "Expr" }>)._0;
    // the segment's `next_id()` is taken before the PatExpr's (pat.rs:322, 325)
    expect([e.hir_id.local_id as number, e.span]).toEqual([2, sp(8)]);
    const qpath = (e.kind as Extract<hir.PatExprKind, { $: "Path" }>)._0 as Extract<hir.QPath, { $: "Resolved" }>;
    expect(qpath._0).toBeUndefined();
    expect([qpath._1.span, qpath._1.res]).toEqual([sp(8), res as unknown as Res]);
    expect(qpath._1.segments.map((s) => [s.ident.name, s.hir_id.local_id as number, s.args, s.infer_args])).toEqual([
      [10 as Symbol, 1, undefined, true],
    ]);
  });

  test("parentheses are peeled in the loop: outer HirId, inner span (pat.rs:141, 149)", () => {
    const { lctx } = fake();
    const out = lctx.lower_pat(pat(1, { $: "Paren", _0: pat(2, { $: "Paren", _0: pat(3, { $: "Wild" }, 33) }, 22) }, 11));
    expect([out.hir_id.local_id as number, out.kind, out.span]).toEqual([0, hir.PatKind.Wild, sp(33)]);
  });

  test("ref, deref and range patterns (pat.rs:119-131, 361-367)", () => {
    const { lctx } = fake();
    const r = lctx.lower_pat(pat(1, { $: "Ref", _0: bind(2, 10), _1: "Not", _2: "Mut" }));
    expect([r.kind.$, (r.kind as Extract<hir.PatKind, { $: "Ref" }>)._2]).toEqual(["Ref", "Mut"]);
    const d = lctx.lower_pat(pat(3, { $: "Deref", _0: bind(4, 10) }));
    expect(d.kind.$).toBe("Deref");
    const excluded: RangeEnd = { $: "Excluded" };
    const lit = (id: number) => expr(id, { $: "Lit", _0: { kind: "Integer", symbol: 1, suffix: undefined } as never });
    const range = (id: number, end?: Expr) =>
      lctx.lower_pat(pat(id, { $: "Range", _0: lit(id + 1), _1: end, _2: { node: excluded, span: sp(0) } }))
        .kind as Extract<hir.PatKind, { $: "Range" }>;
    expect(range(10, lit(12))._2).toBe("Excluded");
    // no end: `X..` behaves like `RangeFrom`
    const open = range(20);
    expect([open._1, open._2, open._0?.kind.$]).toEqual([undefined, "Included", "Lit"]);
    expect(lctx.lower_range_end({ $: "Included", _0: "DotDotDot" } as RangeEnd, true)).toBe("Included");
  });

  test("lower_expr_within_pat: literals, negation, errors, paths (pat.rs:384-430)", () => {
    const { lctx } = fake();
    const lit = { kind: "Integer", symbol: 1, suffix: undefined } as never;
    const a = lctx.lower_expr_within_pat(expr(1, { $: "Lit", _0: lit }, 4), false);
    expect([a.hir_id.local_id as number, a.span, a.kind]).toEqual([
      0,
      sp(4),
      { $: "Lit", lit: { node: { $: "Lowered", lit }, span: sp(4) } as never, negated: false },
    ]);
    const neg = lctx.lower_expr_within_pat(expr(2, { $: "Unary", _0: "Neg", _1: expr(3, { $: "Lit", _0: lit }) }, 5), false);
    expect(neg.kind).toEqual({ $: "Lit", lit: { node: { $: "Lowered", lit }, span: sp(5) } as never, negated: true });
    const err = lctx.lower_expr_within_pat(expr(4, { $: "Err", _0: GUAR }, 6), false);
    expect(err.kind).toEqual({ $: "Lit", lit: { node: { $: "Err", _0: GUAR }, span: sp(6) }, negated: false });
    const bytes = lctx.lower_expr_within_pat(expr(5, { $: "IncludedBytes", _0: 9 as never }, 7), false);
    expect(bytes.kind).toEqual({
      $: "Lit",
      lit: { node: { $: "ByteStr", _0: 9 as never, _1: { $: "Cooked" } }, span: sp(7) },
      negated: false,
    });
    // a path is only allowed in range patterns; elsewhere it is an arbitrary expression (ArbitraryExpressionInPattern)
    const path = expr(6, { $: "Path", _0: undefined, _1: {} as never }, 8);
    const arb = lctx.lower_expr_within_pat(path, false);
    expect(arb.kind).toEqual({ $: "Lit", lit: { node: { $: "Err", _0: GUAR }, span: sp(8) }, negated: false });
    expect(stops(() => lctx.lower_expr_within_pat(expr(7, { $: "Dummy" }), false))).toContain("lowered ExprKind::Dummy");
  });

  test("`..` outside a list reports MisplacedDoubleDot (pat.rs:136-139, 352)", () => {
    const { lctx, log } = fake();
    expect(lctx.lower_pat(rest(1)).kind).toEqual(hir.PatKind.Wild);
    expect(log.filter((l) => l === "emit_err").length).toBe(1);
  });

  test("type patterns: NotNull, Or and the HirId order (pat.rs:432-477)", () => {
    const { lctx } = fake();
    const tp = (id: number, kind: TyPat["kind"], span = 0): TyPat => ({ id: nid(id), kind, span: sp(span) });
    const out = lctx.lower_ty_pat(tp(1, { $: "Or", _0: [tp(2, { $: "NotNull" }, 2), tp(3, { $: "Err", _0: GUAR })] }, 1), sp(0));
    expect(out.hir_id.local_id as number).toBe(0);
    const or = out.kind as Extract<hir.TyPatKind, { $: "Or" }>;
    expect(or._0.map((p) => [p.hir_id.local_id as number, p.kind.$, p.span])).toEqual([
      [1, "NotNull", sp(2)],
      [2, "Err", sp(0)],
    ]);
    expect(or._0[0]!.kind).toBe(hir.TyPatKind.NotNull);
  });

  test("an included type-pattern range end lowers the anon const (pat.rs:444-458)", () => {
    const { lctx } = fake();
    const seen: number[] = [];
    Object.assign(lctx, {
      lower_anon_const_to_const_arg_and_alloc: (c: AnonConst) => {
        seen.push(c.id as number);
        return { anon: c.id };
      },
    });
    const c = (id: number): AnonConst => ({ id: nid(id), value: expr(id + 100, { $: "Dummy" }) });
    const out = lctx.lower_ty_pat_mut(
      { id: nid(1), kind: { $: "Range", _0: c(2), _1: c(3), _2: { node: { $: "Included", _0: "DotDotEq" } as RangeEnd, span: sp(0) } }, span: sp(0) },
      sp(0),
    );
    expect(seen).toEqual([2, 3]);
    expect(out.kind).toEqual({ $: "Range", _0: { anon: 2 } as never, _1: { anon: 3 } as never });
  });
});

describe("path.rs", () => {
  test("assoc_ty_binding builds `Name = Ty` with empty generic args (path.rs:572-595)", () => {
    const { lctx } = fake();
    const ty = new hir.Ty<null>(hid(40), sp(3), { $: "Never" });
    const c = lctx.assoc_ty_binding(sym.Output, sp(6), ty);
    expect(c).toBeInstanceOf(hir.AssocItemConstraint);
    expect([c.hir_id.local_id as number, c.ident.name, c.span]).toEqual([0, sym.Output, sp(6)]);
    expect(c.kind).toEqual({ $: "Equality", term: { $: "Ty", _0: ty } });
    expect(c.gen_args).toEqual(new hir.GenericArgs([], [], "No", 0 as Span));
  });

  test("lower_use_path asserts a resolution (path.rs:236)", () => {
    const { lctx } = fake();
    const none = new PerNS<Res | undefined>(undefined, undefined, undefined);
    expect(stops(() => lctx.lower_use_path(none, { span: sp(0), segments: [], tokens: undefined } as never, "Explicit"))).toBe(
      "Panic: assertion failed: !res.is_empty()",
    );
  });

  test("a segment without args gets an empty, non-parenthesized GenericArgs (path.rs:419-421, lib.rs:3310)", () => {
    const { lctx } = fake();
    const segment = { ident: ident(10), id: nid(3), args: undefined } as never;
    const seg = lctx.lower_path_segment(sp(0), segment, "Optional", "Err", { $: "Disallowed", _0: "Path" }, undefined);
    expect(seg.ident.name).toBe(10 as Symbol);
    expect(seg.args).toBeUndefined();
    expect(seg.infer_args).toBe(true);
  });

  test("trait paths ask the TyCtxt lang-item methods (path.rs:75-76, 603-610)", () => {
    const res: Res<NodeId> = { $: "Def", _0: DefKind.Trait, _1: STRUCT_DEF };
    const { lctx } = fake({ partial_res: [[1, res]] });
    const asked: string[] = [];
    const ASYNC_FN_MUT = new DefId(9 as DefIndex, CrateNum.from_u32(0));
    Object.assign(lctx.tcx, {
      async_fn_trait_kind_from_def_id: (id: DefId) => (asked.push(`async_fn_trait_kind_from_def_id ${id.index}`), undefined),
      fn_trait_kind_from_def_id: (id: DefId) => (asked.push(`fn_trait_kind_from_def_id ${id.index}`), "FnMut"),
      lang_items: () => ({ async_fn_mut_trait: () => ASYNC_FN_MUT }),
    });
    const p = { span: sp(0), segments: [], tokens: undefined } as never;
    lctx.lower_qpath(nid(1), undefined, p, "Explicit", "No", { $: "Disallowed", _0: "Path" }, undefined);
    expect(asked).toEqual(["async_fn_trait_kind_from_def_id 5"]);
    expect(lctx.map_trait_to_async_trait(STRUCT_DEF)).toBe(ASYNC_FN_MUT);
    expect(asked).toEqual(["async_fn_trait_kind_from_def_id 5", "fn_trait_kind_from_def_id 5"]);
  });
});
