// Unit tests of lane lower-lib-b (rustc_ast_lowering lib.rs 1757..3401). The `LoweringContext` here is a bare object
// with the lib.rs 1..1756 helpers it calls (lane lower-lib-a: `next_id`, `lower_span`, ...) replaced by small fakes, so
// the tests check this region's own logic: the order in which it allocates `HirId`s, which HIR it builds, and the
// const-arg classification. Expectations follow the upstream code cited per test.
import { expect, test } from "bun:test";
import * as ast from "../rustc_ast/lib.ts";
import { DefKind, type Res } from "../rustc_hir/def.ts";
import * as rustc_hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import type { LifetimeRes } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP, type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import {
  debug_DirectConstArgContext,
  DirectConstArgContext,
  GenericArgsCtor,
  HIR_ARENA,
  LoweringContext,
  UnrepresentableConstArgError,
} from "./lib.ts";

const OWNER = new OwnerId(LocalDefId.new(0));
const node = (n: number): ast.NodeId => ast.node_id.NodeId.from_u32(n);
const span = (n: number): Span => n as Span;
const GUAR = {} as ErrorGuaranteed;

type Calls = string[];

/** A `LoweringContext` with fake lib.rs 1..1756 helpers; `calls` records the diagnostics it emits. */
function lctx(opts: { features?: string[]; lifetimes?: Map<ast.NodeId, LifetimeRes>; partial_res?: Map<ast.NodeId, Res<ast.NodeId>> } = {}): [LoweringContext, Calls] {
  const calls: Calls = [];
  const features = new Set(opts.features ?? []);
  const feature = (name: string) => () => features.has(name);
  const diag = (msg: string) => {
    const d = {
      with_code(code: unknown) {
        calls.push(`code ${String(code)}`);
        return d;
      },
      with_note(note: string) {
        calls.push(`note ${note}`);
        return d;
      },
      note(note: string) {
        calls.push(`note ${note}`);
        return d;
      },
      emit() {
        calls.push(`emit ${msg}`);
      },
    };
    return d;
  };
  const dcx = {
    span_err: (_sp: unknown, msg: string) => (calls.push(`err ${msg}`), GUAR),
    span_fatal: (_sp: unknown, msg: string) => {
      calls.push(`fatal ${msg}`);
      throw new Error("fatal");
    },
    span_delayed_bug: (_sp: unknown, msg: string) => (calls.push(`delayed_bug ${msg}`), GUAR),
    struct_span_err: (_sp: unknown, msg: string) => diag(msg),
  };
  const tcx = {
    features: () => ({
      gca: feature("gca"),
      gca_adts: feature("gca_adts"),
      gca_min_const_items: feature("gca_min_const_items"),
      gca_macroless_args: feature("gca_macroless_args"),
      gca_macroless_items: feature("gca_macroless_items"),
      more_maybe_bounds: feature("more_maybe_bounds"),
    }),
    dcx: () => dcx,
    item_name: () => sym.Sized,
  } as unknown as TyCtxt;
  const l = Object.create(LoweringContext.prototype) as LoweringContext;
  let next = 1;
  const lifetimes = opts.lifetimes ?? new Map();
  Object.assign(l, {
    tcx,
    arena: HIR_ARENA,
    curr_owner: {
      owner: { def_id: LocalDefId.new(0), id: node(0), lifetime_elision_allowed: true, get_lifetime_res: (id: ast.NodeId) => lifetimes.get(id) },
      attrs: new rustc_hir.def_id.DefIdMap(), // only `insert` is used (see stmt_let_pat test)
    },
    next_id: () => new HirId(OWNER, ItemLocalId.from_u32(next++)),
    lower_node_id: (id: ast.NodeId) => new HirId(OWNER, ItemLocalId.from_u32(1000 + ast.node_id.NodeId.as_u32(id))),
    local_def_id: (id: ast.NodeId) => LocalDefId.new(500 + ast.node_id.NodeId.as_u32(id)),
    lower_span: (sp: Span) => sp,
    lower_ident: (i: Ident) => i,
    dcx: () => dcx,
    get_partial_res: (id: ast.NodeId) => {
      const res = opts.partial_res?.get(id);
      return res === undefined ? undefined : { full_res: () => res };
    },
    make_lang_item_qpath: (lang_item: string, sp: Span): rustc_hir.QPath => ({
      $: "Resolved",
      _0: undefined,
      _1: new rustc_hir.Path(sp, { $: "Err" }, [rustc_hir.PathSegment.new(Ident.new(sym.integer(9), sp), new HirId(OWNER, ItemLocalId.from_u32(999)), { $: "Err" })]),
    }) as unknown as rustc_hir.QPath & { lang_item?: string },
  });
  return [l, calls];
}

const hid = (n: number) => new HirId(OWNER, ItemLocalId.from_u32(n));
const local = (h: HirId) => ItemLocalId.as_u32(h.local_id);
const expr = (id: number, kind: ast.ExprKind): ast.Expr => new ast.Expr(node(id), kind, span(id), [], undefined);

test("DirectConstArgContext: flags and the associated consts of `impl DirectConstArgContext` (lib.rs:3321-3368)", () => {
  const C = DirectConstArgContext;
  expect([C.TUPLE_CALL, C.PATH_PLAIN_PARAM, C.GCA_MACRO]).toEqual([0x1, 0x4, 0x1000] as DirectConstArgContext[]);
  expect(C.STABLE).toBe(C.PATH_PLAIN_PARAM);
  expect(C.GCA).toBe(0x1004 as DirectConstArgContext);
  // GCA | UNDERSCORE | PAREN | BLOCK | LIT | CONST_BLOCK
  expect(C.GCA_BASE_FEATURES).toBe((0x1004 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800) as DirectConstArgContext);
  expect(C.GCA_MIN_CONST_ITEMS).toBe(C.PATH_ANY);
  // PATH_CONST_CTOR | TUPLE_CALL | TUPLE | STRUCT | ARRAY
  expect(C.GCA_ADTS).toBe((0x8 | 0x1 | 0x2 | 0x20 | 0x40) as DirectConstArgContext);
  expect(format_debug(C.GCA, debug_DirectConstArgContext, PLAIN)).toBe("DirectConstArgContext(PATH_PLAIN_PARAM | GCA_MACRO)");
  expect(format_debug(C.empty(), debug_DirectConstArgContext, PLAIN)).toBe("DirectConstArgContext(0x0)");
});

test("ambient_direct_const_arg_context / direct_const_arg_context_enabled_by_gca_macro follow the gca features (lib.rs:2682-2702)", () => {
  const C = DirectConstArgContext;
  expect(lctx()[0].ambient_direct_const_arg_context()).toBe(C.STABLE);
  // `gca()` is `gca_min_const_items || gca_adts` upstream; the fake reads a `gca` flag directly
  expect(lctx({ features: ["gca"] })[0].ambient_direct_const_arg_context()).toBe(C.GCA);
  expect(lctx({ features: ["gca_macroless_args"] })[0].ambient_direct_const_arg_context()).toBe(C.GCA_BASE_FEATURES);
  const all = lctx({ features: ["gca_macroless_args", "gca_min_const_items", "gca_adts"] })[0];
  expect(all.ambient_direct_const_arg_context()).toBe(C.union(C.union(C.GCA_BASE_FEATURES, C.PATH_ANY), C.GCA_ADTS));
});

test("can_lower_path_to_const_arg_direct / can_lower_expr_to_const_arg_direct (lib.rs:2704-2798)", () =>
  create_default_session_globals_then(() => {
    const C = DirectConstArgContext;
    const const_param: Res<ast.NodeId> = { $: "Def", _0: DefKind.ConstParam, _1: new DefId(7 as never, 0 as never) };
    const [l] = lctx({ partial_res: new Map([[node(1), const_param]]) });
    const n = ast.Path.from_ident(Ident.new(sym.integer(1), DUMMY_SP));
    const path = (id: number) => expr(id, { $: "Path", _0: undefined, _1: n });
    // a plain path to a const param is the one stable direct form
    expect(l.can_lower_expr_to_const_arg_direct(path(1), C.STABLE)).toEqual({ $: "Ok", _0: undefined });
    // an unresolved path is not, and the error is built without visiting (`will_create_def_ids: false`)
    const err = l.can_lower_expr_to_const_arg_direct(path(2), C.STABLE);
    expect(err).toEqual({ $: "Err", _0: new UnrepresentableConstArgError(span(2), false) });
    expect(l.can_lower_path_to_const_arg_direct(undefined, n, span(3), undefined, C.PATH_ANY)).toEqual({ $: "Ok", _0: undefined });
    // the gca! macro forms: `(_)`, `{ (_) }`, `-lit`, nested through Paren/Block
    const under = expr(4, { $: "Underscore" });
    const paren = expr(5, { $: "Paren", _0: under });
    const lit: ast.token.Lit = { kind: { $: "Integer" }, symbol: sym.integer(3), suffix: undefined } as unknown as ast.token.Lit;
    const neg = expr(6, { $: "Unary", _0: "Neg", _1: expr(7, { $: "Lit", _0: lit }) });
    const block = (e: ast.Expr): ast.Expr =>
      expr(8, { $: "Block", _0: { stmts: [new ast.Stmt(node(9), { $: "Expr", _0: e }, DUMMY_SP)], id: node(10), rules: { $: "Default" }, span: DUMMY_SP, tokens: undefined } as unknown as ast.Block, _1: undefined });
    for (const e of [paren, block(paren), neg, block(neg)]) {
      expect(l.can_lower_expr_to_const_arg_direct(e, C.GCA_BASE_FEATURES).$).toBe("Ok");
    }
    // a tuple of const params needs TUPLE; with it, every element is checked (the first `Err` wins)
    const tup = expr(11, { $: "Tup", _0: [path(1), path(1)] });
    expect(l.can_lower_expr_to_const_arg_direct(tup, C.union(C.STABLE, C.TUPLE)).$).toBe("Ok");
    expect(l.can_lower_expr_to_const_arg_direct(expr(12, { $: "Tup", _0: [path(1), path(2)] }), C.union(C.STABLE, C.TUPLE))).toEqual({
      $: "Err",
      _0: new UnrepresentableConstArgError(span(2), false),
    });
  }));

test("lower_expr_to_const_arg_direct: `_`, parens/blocks keep the id override, tuples lower element-wise (lib.rs:2828-2994)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const under = expr(4, { $: "Underscore" });
    const ca = l.lower_expr_to_const_arg_direct(expr(5, { $: "Paren", _0: under }), node(42));
    expect(ca.kind).toEqual({ $: "Infer", _0: null });
    expect(local(ca.hir_id)).toBe(1042); // `id_override` is passed down through `Paren`
    expect(ca.span).toBe(span(4));
    const tup = l.lower_expr_to_const_arg_direct(expr(6, { $: "Tup", _0: [expr(7, { $: "Underscore" }), expr(8, { $: "Underscore" })] }), undefined);
    if (tup.kind.$ !== "Tup") throw new Error("expected Tup");
    expect(tup.kind._0.map((c) => local(c.hir_id))).toEqual([1007, 1008]);
    expect(local(tup.hir_id)).toBe(1006);
  }));

test("lower_array_length_to_const_arg: `(_)` is an inferred const arg (lib.rs:2585)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const c: ast.AnonConst = { id: node(3), value: expr(5, { $: "Paren", _0: expr(4, { $: "Underscore" }) }) };
    const ca = l.lower_array_length_to_const_arg(c);
    expect(ca.kind).toEqual({ $: "Infer", _0: null });
    expect([local(ca.hir_id), ca.span]).toEqual([1003, span(5)]);
  }));

test("ty_path turns a trait path into a bare trait object; the PolyTraitRef keeps the id (lib.rs:3248-3292)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const trait_res: Res = { $: "Def", _0: DefKind.Trait, _1: new DefId(3 as never, 0 as never) };
    const path = new rustc_hir.Path(span(1), trait_res, []);
    const ty = l.ty_path(hid(100), span(2), { $: "Resolved", _0: undefined, _1: path });
    if (ty.kind.$ !== "TraitObject") throw new Error("expected TraitObject");
    expect(local(ty.kind._0[0]!.trait_ref.hir_ref_id)).toBe(100);
    // the `Ty` gets the next id, then `elided_dyn_bound` takes one for its lifetime
    expect(local(ty.hir_id)).toBe(1);
    const lt = ty.kind._1.pointer();
    expect([local(lt.hir_id), lt.ident.name, lt.kind.$, lt.source.$, lt.syntax]).toEqual([2, kw.UnderscoreLifetime, "ImplicitObjectLifetimeDefault", "Other", "Implicit"]);
    expect(ty.kind._1.tag()).toBe("None");
    // any other path stays a path, with the given id
    const struct_res: Res = { $: "Def", _0: DefKind.Struct, _1: new DefId(4 as never, 0 as never) };
    const ty2 = l.ty_path(hid(101), span(2), { $: "Resolved", _0: undefined, _1: new rustc_hir.Path(span(1), struct_res, []) });
    expect([ty2.kind.$, local(ty2.hir_id)]).toEqual(["Path", 101]);
  }));

test("statement, block and pattern builders allocate ids in upstream order (lib.rs:3073-3246)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const e = new rustc_hir.Expr(hid(50), { $: "Err", _0: GUAR }, span(1));
    // `stmt`: the id is taken after the kind is built
    const s = l.stmt_expr(span(2), e);
    expect([s.kind.$, local(s.hir_id), s.span]).toEqual(["Expr", 1, span(2)]);
    // `stmt_let_pat`: the `LetStmt` id first, then the `Stmt` id
    const [p, p_id] = l.pat_ident(span(3), Ident.new(sym.integer(1), span(3)));
    expect(local(p_id)).toBe(2);
    expect(p.kind).toEqual({ $: "Binding", _0: ast.BindingMode.NONE, _1: p_id, _2: Ident.new(sym.integer(1), span(3)), _3: undefined });
    const inserted: [unknown, unknown][] = [];
    (l.curr_owner as { attrs: unknown }).attrs = { insert: (k: unknown, v: unknown) => void inserted.push([k, v]) };
    const attrs = [{}] as never[];
    const let_ = l.stmt_let_pat(attrs, span(4), undefined, p, "Normal");
    if (let_.kind.$ !== "Let") throw new Error("expected Let");
    expect([local(let_.kind._0.hir_id), local(let_.hir_id), let_.kind._0.super_]).toEqual([3, 4, undefined]);
    expect(inserted).toEqual([[ItemLocalId.from_u32(3), attrs]]);
    expect(() => l.stmt_let_pat([], span(4), undefined, p, "Normal")).toThrow(new Panic("assertion failed: !a.is_empty()"));
    const sup = l.stmt_super_let_pat(span(5), p, e);
    if (sup.kind.$ !== "Let") throw new Error("expected Let");
    expect([sup.kind._0.super_, sup.kind._0.source]).toEqual([span(5), "Normal"]);
    // `block_expr`: the block takes the expression's span
    const b = l.block_expr(e);
    expect([b.stmts, b.expr, b.rules, b.span, b.targeted_by_break]).toEqual([[], e, rustc_hir.BlockCheckMode.DefaultBlock, span(1), false]);
    // `pat_some`: the field (named `0`) before the pattern
    const before = local(l.next_id());
    const some = l.pat_some(span(6), p);
    if (some.kind.$ !== "Struct") throw new Error("expected Struct");
    const [field] = some.kind._1;
    expect([local(field!.hir_id), field!.ident.name, field!.is_shorthand, local(some.hir_id), some.default_binding_modes]).toEqual([
      before + 1,
      sym.integer(0),
      false,
      before + 2,
      true,
    ]);
    expect(l.pat_none(span(7)).kind).toEqual({ $: "Struct", _0: expect.anything(), _1: [], _2: undefined });
    expect(l.pat_without_dbm(span(8), { $: "Wild" }).default_binding_modes).toBe(false);
  }));

test("lower_trait_bound_modifiers / lower_unsafe_source / GenericArgsCtor (lib.rs:3047, 3054, 3304, 3310)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const m = l.lower_trait_bound_modifiers({ constness: { $: "Maybe", _0: span(1) }, asyncness: { $: "Normal" }, polarity: { $: "Maybe", _0: span(2) } } as ast.TraitBoundModifiers);
    expect(m).toEqual({ constness: { $: "Maybe", _0: span(1) }, polarity: { $: "Maybe", _0: span(2) } });
    expect(l.lower_unsafe_source("UserProvided")).toBe("UserProvided");
    const empty = new GenericArgsCtor([], [], "No", span(3));
    expect(empty.is_empty()).toBe(true);
    expect(new GenericArgsCtor([], [], "ParenSugar", span(3)).is_empty()).toBe(false);
    const ga = empty.into_generic_args(l);
    expect([ga.args, ga.parenthesized, ga.span_ext]).toEqual([[], "No", span(3)]);
  }));

test("new_named_lifetime maps the lifetime resolution (lib.rs:2206-2247)", () =>
  create_default_session_globals_then(() => {
    const lifetimes = new Map<ast.NodeId, LifetimeRes>([
      [node(1), { $: "Param", param: LocalDefId.new(11), binder: node(0) }],
      [node(2), { $: "Fresh", param: node(12), kind: undefined }],
      [node(3), { $: "Static" }],
      [node(4), { $: "Error", _0: GUAR }],
    ]);
    const [l, calls] = lctx({ lifetimes });
    const anon = (n: number) => Ident.new(kw.UnderscoreLifetime, span(n));
    const lt = (id: number, ident: Ident) => l.lower_lifetime({ id: node(id), ident }, rustc_hir.LifetimeSource.Reference, "Implicit");
    expect(lt(1, Ident.new(kw.StaticLifetime, span(1))).kind).toEqual({ $: "Param", _0: LocalDefId.new(11) });
    expect(lt(2, anon(2)).kind).toEqual({ $: "Param", _0: LocalDefId.new(512) });
    expect(lt(3, Ident.new(kw.StaticLifetime, span(3))).kind.$).toBe("Static");
    expect(lt(4, anon(4)).kind.$).toBe("Error");
    expect(local(lt(5, anon(5)).hir_id)).toBe(1005);
    expect(calls).toEqual(["delayed_bug unresolved lifetime"]);
    expect(() => lt(3, Ident.new(sym.integer(1), span(3)))).toThrow(
      new Panic("assertion failed: matches!(ident.name, kw::StaticLifetime | kw::UnderscoreLifetime)"),
    );
  }));

test("lower_fn_decl: implicit self kind, `...` dropped from the inputs, return type (lib.rs:1933-2053)", () =>
  create_default_session_globals_then(() => {
    const [l] = lctx();
    const lowered: unknown[] = [];
    Object.assign(l, {
      lower_ty: (t: ast.Ty, itctx: unknown) => (lowered.push(itctx), new rustc_hir.Ty(hid(2000 + ast.node_id.NodeId.as_u32(t.id)), t.span, { $: "Never" })),
    });
    const self_ty = new ast.Ty(node(1), ast.TyKind.ImplicitSelf, span(1));
    const ref_self = new ast.Ty(node(2), { $: "Ref", _0: undefined, _1: self_ty, _2: "Mut" }, span(2));
    const pat = (mutbl: "Not" | "Mut") => new ast.Pat(node(3), { $: "Ident", _0: new ast.BindingMode({ $: "No" } as never, mutbl), _1: Ident.new(kw.SelfLower, DUMMY_SP), _2: undefined }, DUMMY_SP);
    const param = (ty: ast.Ty, mutbl: "Not" | "Mut" = "Not") => new ast.Param([], ty, pat(mutbl), node(4), DUMMY_SP, false);
    const decl = (inputs: ast.Param[]) => new ast.FnDecl(inputs, { $: "Default", _0: span(9) });
    const kind = (inputs: ast.Param[]) => l.lower_fn_decl(decl(inputs), node(0), hid(0), "Fn", undefined, "No").implicit_self();
    expect(kind([param(self_ty, "Mut")])).toBe("Mut");
    expect(kind([param(self_ty)])).toBe("Imm");
    expect(kind([param(ref_self)])).toBe("RefMut");
    expect(kind([])).toBe("None");
    expect(lowered).toEqual([{ $: "Universal" }, { $: "Universal" }, { $: "Universal" }]);
    const d = l.lower_fn_decl(decl([param(self_ty)]), node(0), hid(0), "ExternFn", undefined, "No");
    expect(d.output).toEqual({ $: "DefaultReturn", _0: span(9) });
    expect(lowered[3]).toEqual({ $: "Disallowed", _0: "ExternFnParam" });
    expect(d.lifetime_elision_allowed()).toBe(true);
  }));

test("validate_relaxed_bound: duplicates under `Allowed` are E0203, `Forbidden` where-bounds get the generic error (lib.rs:2422-2506)", () =>
  create_default_session_globals_then(() => {
    const [l, calls] = lctx();
    const trait_res: Res = { $: "Def", _0: DefKind.Trait, _1: new DefId(3 as never, 0 as never) };
    const tr = new rustc_hir.TraitRef(new rustc_hir.Path(span(1), trait_res, []), hid(1));
    const allowed = { $: "Allowed", _0: new rustc_hir.def_id.DefIdMap<Span>() };
    l.validate_relaxed_bound(tr, span(10), allowed);
    expect(calls).toEqual([]);
    // a second relaxed bound on the same trait (an equal `DefId`, not the same object)
    const tr2 = new rustc_hir.TraitRef(new rustc_hir.Path(span(1), { $: "Def", _0: DefKind.Trait, _1: new DefId(3 as never, 0 as never) }, []), hid(2));
    l.validate_relaxed_bound(tr2, span(11), allowed);
    expect(calls).toEqual(["code 203", "emit duplicate relaxed `Sized` bounds"]);
    calls.length = 0;
    l.validate_relaxed_bound(tr, span(12), { $: "Forbidden", _0: "WhereBound" });
    expect(calls).toEqual([
      "note in this context, relaxed bounds are only allowed on type parameters defined on the closest item",
      "emit this relaxed bound is not permitted here",
    ]);
  }));

test("lower_param_bounds_mut / lower_generic_params_mut are lazy, as upstream's `impl Iterator` (lib.rs:2249, 2518)", () => {
  const [l] = lctx();
  const seen: unknown[] = [];
  Object.assign(l, { lower_param_bound: (b: unknown) => (seen.push(b), b) });
  const bounds = [{ $: "Use", _0: [], _1: span(1) }, { $: "Use", _0: [], _1: span(2) }] as ast.GenericBound[];
  const it = l.lower_param_bounds_mut(bounds, { $: "Forbidden", _0: "WhereBound" }, { $: "Universal" })[Symbol.iterator]();
  expect(seen).toEqual([]);
  it.next();
  expect(seen).toEqual([bounds[0]]);
  expect(l.lower_param_bounds(bounds, { $: "Forbidden", _0: "WhereBound" }, { $: "Universal" }) as unknown).toEqual(bounds);
});
