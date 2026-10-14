// Unit checks of the item.rs port (lane lower-item) that do not need a real `LoweringContext`.
// `LoweringContext::new` and the lib.rs helpers are other lanes' (lower-lib-a/b), so the methods under test run
// on a bare `LoweringContext.prototype` object whose cross-file dependencies (`lower_span`, `local_def_id`, ...)
// are replaced by own-property fakes. Expected values are written from the upstream bodies (item.rs line numbers
// in the test names).
import { expect, test } from "bun:test";
import { type Generics, type WherePredicate, WhereClause } from "../rustc_ast/lib.ts";
import { NodeId } from "../rustc_ast/node_id.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type * as attr_ir from "../rustc_attr_ir/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Panic } from "../std/panic.ts";
import { add_ty_alias_where_clause } from "./item.ts";
import { LoweringContext } from "./lib.ts";

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));
const OWNER = new OwnerId(LocalDefId.new(3));

interface FakeOwner {
  owner: { def_id: LocalDefId; id: NodeId; extra_lifetime_params(id: NodeId): readonly unknown[] };
  attrs: unknown;
  bodies: [ItemLocalId, hir.Body][];
  define_opaque: unknown;
  impl_trait_defs: hir.GenericParam[];
  impl_trait_bounds: hir.WherePredicate[];
  owner_id(): OwnerId;
}

/** A `LoweringContext` with only the state item.rs touches and identity / counter fakes for other lanes' fns. */
function fake_cx(): LoweringContext & { owner_: FakeOwner } {
  const cx = Object.create(LoweringContext.prototype) as LoweringContext & { owner_: FakeOwner };
  const owner: FakeOwner = {
    owner: { def_id: OWNER.def_id, id: NodeId.from_u32(7), extra_lifetime_params: () => [] },
    attrs: undefined,
    bodies: [],
    define_opaque: undefined,
    impl_trait_defs: [],
    impl_trait_bounds: [],
    owner_id: () => OWNER,
  };
  cx.owner_ = owner;
  cx.curr_owner = owner as unknown as LoweringContext["curr_owner"]; // a fake with only the fields item.rs reads
  cx.coroutine_kind = undefined;
  cx.task_context = undefined;
  let next = 1;
  Object.assign(cx, {
    lower_span: (s: Span) => s,
    next_id: () => new HirId(OWNER, ItemLocalId.from_u32(next++)),
    local_def_id: (id: NodeId) => LocalDefId.new(100 + NodeId.as_u32(id)),
    lower_generic_params_mut: () => [],
  });
  return cx;
}

function where_clause(has_where_token: boolean, preds: number, span: Span): WhereClause {
  const p: WherePredicate[] = [];
  for (let i = 0; i < preds; i++) {
    p.push({ attrs: [], kind: { $: "RegionPredicate", _0: { lifetime: { id: NodeId.from_u32(i), ident: undefined! }, bounds: [] } }, id: NodeId.from_u32(i), span: DUMMY_SP, is_placeholder: false });
  }
  return new WhereClause(has_where_token, p, span);
}

test("add_ty_alias_where_clause (item.rs:30): predicates appended, preferred where clause wins when present", () => {
  create_default_session_globals_then(() => {
    const A = sp(1, 2);
    const B = sp(3, 4);
    const mk = (tok: boolean, n: number): Generics => ({ params: [], where_clause: where_clause(tok, n, A), span: DUMMY_SP });

    // prefer_first, only the second has a `where`: the second wins
    let g = mk(false, 1);
    add_ty_alias_where_clause(g, where_clause(true, 2, B), true);
    expect(g.where_clause.predicates.length).toBe(3);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([true, B]);

    // prefer_first, both have a `where`: the first wins
    g = mk(true, 0);
    add_ty_alias_where_clause(g, where_clause(true, 0, B), true);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([true, A]);

    // !prefer_first, both have a `where`: the second wins
    g = mk(true, 0);
    add_ty_alias_where_clause(g, where_clause(true, 0, B), false);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([true, B]);

    // !prefer_first, only the first has a `where`: the first wins
    g = mk(true, 0);
    add_ty_alias_where_clause(g, where_clause(false, 0, B), false);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([true, A]);

    // neither has a `where`: the preferred one's span is kept
    g = mk(false, 0);
    add_ty_alias_where_clause(g, where_clause(false, 0, B), true);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([false, A]);
    g = mk(false, 0);
    add_ty_alias_where_clause(g, where_clause(false, 0, B), false);
    expect([g.where_clause.has_where_token, g.where_clause.span]).toEqual([false, B]);

    // the appended predicates are copies (`extend_from_slice` clones)
    const after = where_clause(false, 1, B);
    g = mk(false, 0);
    add_ty_alias_where_clause(g, after, true);
    expect(g.where_clause.predicates[0]).not.toBe(after.predicates[0]);
  });
});

test("lower_safety (item.rs:1691), lower_extern (:1636), lower_defaultness (:1199)", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    expect(cx.lower_safety({ $: "Default" }, "Unsafe")).toBe("Unsafe");
    expect(cx.lower_safety({ $: "Safe", _0: DUMMY_SP }, "Unsafe")).toBe("Safe");
    expect(cx.lower_safety({ $: "Unsafe", _0: DUMMY_SP }, "Safe")).toBe("Unsafe");

    expect(cx.lower_extern({ $: "None" })).toEqual(ExternAbi.Rust);
    expect(cx.lower_extern({ $: "Implicit", _0: DUMMY_SP })).toEqual(ExternAbi.FALLBACK);

    const s = sp(5, 9);
    expect(cx.lower_defaultness({ $: "Implicit" }, true, () => hir.Defaultness.Final)).toEqual([hir.Defaultness.Final, undefined]);
    expect(cx.lower_defaultness({ $: "Default", _0: s }, false, () => hir.Defaultness.Final)).toEqual([{ $: "Default", has_value: false }, s]);
    expect(cx.lower_defaultness({ $: "Final", _0: s }, true, () => ({ $: "Default", has_value: true }))).toEqual([hir.Defaultness.Final, s]);
  });
});

test("lower_constness (item.rs:1664): const / not const, `#[rustc_comptime]` makes a non-const fn `Const { always: true }`", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    expect(cx.lower_constness([], { $: "No" })).toEqual({ $: "NotConst" });
    expect(cx.lower_constness([], { $: "Yes", _0: DUMMY_SP })).toEqual({ $: "Const", always: false });
    const comptime: attr_ir.Attribute[] = [{ $: "Parsed", _0: { $: "RustcComptime", _0: sp(1, 2) } }];
    expect(cx.lower_constness(comptime, { $: "No" })).toEqual({ $: "Const", always: true });
  });
});

test("lower_body (item.rs:1226) / record_body (:1214): takes and restores coroutine_kind and task_context, records the body", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    const tc = new HirId(OWNER, ItemLocalId.from_u32(42));
    cx.coroutine_kind = { $: "Coroutine", _0: "Movable" } as hir.CoroutineKind;
    cx.task_context = tc;
    const value = new hir.Expr(new HirId(OWNER, ItemLocalId.from_u32(9)), { $: "Err", _0: undefined! }, DUMMY_SP);
    let seen: unknown[] = [];
    const id = cx.lower_body((this_) => {
      seen = [this_.coroutine_kind, this_.task_context];
      return [[], value];
    });
    expect(seen).toEqual([undefined, undefined]);
    expect(cx.coroutine_kind).toEqual({ $: "Coroutine", _0: "Movable" });
    expect(cx.task_context).toBe(tc);
    expect(id.hir_id).toBe(value.hir_id);
    expect(cx.owner_.bodies.length).toBe(1);
    expect(cx.owner_.bodies[0]![0]).toBe(ItemLocalId.from_u32(9));

    // `assert_eq!(id.hir_id.owner, self.curr_owner.owner_id())`
    const foreign = new hir.Expr(new HirId(new OwnerId(LocalDefId.new(4)), ItemLocalId.from_u32(1)), { $: "Err", _0: undefined! }, DUMMY_SP);
    expect(() => cx.record_body([], foreign)).toThrow(Panic);
  });
});

test("lower_generics (item.rs:1766): takes the impl-trait defs/bounds created by `f`, asserts they start empty", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    const g: Generics = { params: [], where_clause: new WhereClause(true, [], sp(10, 15)), span: sp(1, 20) };
    const def = { hir_id: new HirId(OWNER, ItemLocalId.from_u32(77)) } as unknown as hir.GenericParam;
    const [generics, r] = cx.lower_generics(g, { $: "Universal" }, (this_) => {
      (this_.curr_owner as FakeOwner).impl_trait_defs.push(def);
      return "res";
    });
    expect(r).toBe("res");
    expect(generics.params).toEqual([def]);
    expect(generics.predicates).toEqual([]);
    expect(generics.has_where_clause_predicates).toBe(false);
    expect(generics.where_clause_span).toBe(sp(10, 15));
    expect(generics.span).toBe(sp(1, 20));
    expect(cx.owner_.impl_trait_defs).toEqual([]);

    cx.owner_.impl_trait_bounds.push({} as hir.WherePredicate);
    expect(() => cx.lower_generics(g, { $: "Universal" }, () => 0)).toThrow("assertion failed: self.curr_owner.impl_trait_bounds.is_empty()");
  });
});

test("lower_test_binder_constraints_as_and (item.rs:2055): one constraint as is, otherwise wrapped in `And`", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    const a = sp(1, 2);
    const b = sp(3, 4);
    expect(cx.lower_test_binder_constraints_as_and([{ $: "Ambiguity", span: a }])).toEqual({ $: "Ambiguity", span: a });
    expect(cx.lower_test_binder_constraints_as_and([{ $: "Ambiguity", span: a }, { $: "Or", items: [{ $: "Ambiguity", span: b }] }])).toEqual({
      $: "And",
      items: [
        { $: "Ambiguity", span: a },
        { $: "Or", items: [{ $: "Ambiguity", span: b }] },
      ],
    });
    expect(cx.lower_test_binder_constraints_as_and([])).toEqual({ $: "And", items: [] });
  });
});

test("lower_define_opaque (item.rs:1835): `None` leaves the owner's `define_opaque` unset; asserts an owner HirId", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx();
    cx.lower_define_opaque(new HirId(OWNER, ItemLocalId.ZERO), undefined);
    expect(cx.owner_.define_opaque).toBe(undefined);
    cx.lower_define_opaque(new HirId(OWNER, ItemLocalId.ZERO), []);
    expect(cx.owner_.define_opaque).toEqual([]);
    expect(() => cx.lower_define_opaque(new HirId(OWNER, ItemLocalId.ZERO), undefined)).toThrow("assertion `left == right` failed\n  left: Some([])\n right: None");
    cx.owner_.define_opaque = undefined;
    expect(() => cx.lower_define_opaque(new HirId(OWNER, ItemLocalId.from_u32(2)), undefined)).toThrow("assertion failed: hir_id.is_owner()");
  });
});
