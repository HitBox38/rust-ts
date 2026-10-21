// Unit tests for lane typeck-impl: fn_ctxt/_impl.rs, place_op.rs, _match.rs.
//
// Typeck of real bodies does not reach these methods yet (other lanes' placeholders stop first: `loops::check`,
// `check_fn`, ...), so each test calls the ported method on a fake `FnCtxt` receiver: a plain object carrying the
// members the method reads (a real `TypeckResults`, a fresh-interner `TyCtxt`, a real `DiagCtxt` with a recording
// emitter), with the other FnCtxt methods it calls recorded or bound to the real prototype methods.
import { expect, test } from "bun:test";
import "./lib.ts";
import { BindingMode } from "../rustc_ast/lib.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message, format_diag_messages } from "../rustc_errors/formatting.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId, HirIdMap, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import type { PredicateObligation } from "../rustc_infer/traits/mod.ts";
import type { Adjustment } from "../rustc_middle/ty/adjustment.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { enter_context, ImplicitCtxt } from "../rustc_middle/ty/context/tls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { with_reduced_queries } from "../rustc_middle/ty/print/pretty.ts";
import { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { TyVid } from "../rustc_type_ir/ty_kind.gen.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { FnCtxt } from "./decls.ts";
import { arms_contain_ref_bindings } from "./_match.ts";
import { Diverges } from "./diverges.ts";
import { EnclosingBreakables } from "./lib.gen.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () =>
    create_default_session_globals_then(() => {
      const tcx = mk_tcx();
      enter_context(new ImplicitCtxt(tcx, undefined, 0), () => f());
    }),
  );
};

let TCX: TyCtxt | undefined;
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  TCX = new TyCtxt(gcx as unknown as GlobalCtxt);
  return TCX;
}

class RecordingEmitter extends Emitter {
  readonly out: DiagInner[] = [];
  emit_diagnostic(diag: DiagInner): void {
    this.out.push(diag);
  }
  source_map(): undefined {
    return undefined;
  }
}

function mk_dcx(): { em: RecordingEmitter; dcx: DiagCtxt } {
  const em = new RecordingEmitter();
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  return { em, dcx };
}

const OWNER = new OwnerId(0 as LocalDefId);
const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));
const hid = (local: number): HirId => new HirId(OWNER, ItemLocalId.from_u32(local));
const expr = (local: number, kind: hir.ExprKind): hir.Expr => new hir.Expr(hid(local), kind, sp(local, local + 1));
const lit_unit = (local: number): hir.Expr => expr(local, { $: "Tup", _0: [] });

/** `FnCtxt.prototype.<name>` called on a fake receiver. */
function call<K extends keyof FnCtxt>(name: K, self_: object, ...args: unknown[]): unknown {
  return (FnCtxt.prototype[name] as unknown as (...a: unknown[]) => unknown).apply(self_, args);
}

/** A fake receiver with a real `TypeckResults` and the `_impl.rs` table writers bound to the real methods. */
function fake_fcx(extra: Record<string, unknown> = {}): Record<string, unknown> & { typeck_results: TypeckResults } {
  const fcx: Record<string, unknown> & { typeck_results: TypeckResults } = {
    tcx: TCX!,
    typeck_results: TypeckResults.new(OWNER),
    tainted: undefined as ErrorGuaranteed | undefined,
    tainted_by_errors(this: { tainted: ErrorGuaranteed | undefined }) {
      return this.tainted;
    },
    set_tainted_by_errors(this: { tainted: ErrorGuaranteed | undefined }, e: ErrorGuaranteed) {
      this.tainted = e;
    },
    diverging_type_vars: [],
    write_ty: FnCtxt.prototype.write_ty,
    write_args: FnCtxt.prototype.write_args,
    write_resolution: FnCtxt.prototype.write_resolution,
    node_ty: FnCtxt.prototype.node_ty,
    tag: FnCtxt.prototype.tag,
    ...extra,
  };
  return fcx;
}

test_("_impl.rs:169/635/645 write_ty, node_ty, node_ty_opt", () => {
  const tcx = TCX!;
  const { em, dcx } = mk_dcx();
  const fcx = fake_fcx({ dcx: () => dcx.handle(), body_def_id: 0 as LocalDefId });
  call("write_ty", fcx, hid(1), tcx.types.u8);
  expect(call("node_ty", fcx, hid(1))).toBe(tcx.types.u8);
  expect(call("node_ty_opt", fcx, hid(2))).toBeUndefined();
  // node_ty of an unknown node without errors is a `bug!`.
  expect(() => call("node_ty", fcx, hid(2))).toThrow();
  // Re-writing with an error type keeps the error and taints; nothing is reported.
  const guar = dcx.handle().span_delayed_bug(sp(0, 1), "test");
  call("write_ty", fcx, hid(3), Ty.new_error(tcx, guar));
  expect(fcx.tainted).toBe(guar);
  expect(call("node_ty", fcx, hid(9))).toBe(Ty.new_error(tcx, guar));
  expect(call("node_ty_opt", fcx, hid(9))).toBe(Ty.new_error(tcx, guar));
  call("write_ty", fcx, hid(3), tcx.types.u8);
  expect(fcx.typeck_results.node_types().get(hid(3))).toBe(Ty.new_error(tcx, guar));
  expect(em.out.length).toBe(0);
});

test_("_impl.rs:199/204/286 write_field_index, write_resolution, write_args (empty args are not written)", () => {
  const tcx = TCX!;
  const fcx = fake_fcx();
  call("write_field_index", fcx, hid(1), 2);
  expect(fcx.typeck_results.field_index(hid(1)) as number).toBe(2);
  call("write_args", fcx, hid(1), tcx.mk_args([]));
  expect(fcx.typeck_results.node_args_opt(hid(1))).toBeUndefined();
  const args = tcx.mk_args([GenericArg.from_Ty(tcx.types.u8)]);
  call("write_args", fcx, hid(1), args);
  expect(fcx.typeck_results.node_args_opt(hid(1))).toBe(args);
});

test_("_impl.rs:141/150 record / remove deferred call resolutions", () => {
  const fcx = fake_fcx({ deferred_call_resolutions: new Map() });
  const a = { tag: "a" };
  const b = { tag: "b" };
  call("record_deferred_call_resolution", fcx, 7 as LocalDefId, a);
  call("record_deferred_call_resolution", fcx, 7 as LocalDefId, b);
  expect(call("remove_deferred_call_resolutions", fcx, 7 as LocalDefId)).toEqual([a, b]);
  expect(call("remove_deferred_call_resolutions", fcx, 7 as LocalDefId)).toEqual([]);
});

test_("_impl.rs:1607 with_breakable_ctxt pushes and pops the context", () => {
  const eb = new EnclosingBreakables([], new HirIdMap());
  const fcx = fake_fcx({ enclosing_breakables: eb });
  const ctxt = { may_break: false, coerce: undefined };
  let inside: unknown;
  const [out, r] = call("with_breakable_ctxt", fcx, hid(4), ctxt, () => {
    inside = [eb.stack.length, eb.by_id.get(hid(4))];
    return 42;
  }) as [unknown, number];
  expect(inside).toEqual([1, 0]);
  expect(out).toBe(ctxt);
  expect(r).toBe(42);
  expect(eb.stack.length).toBe(0);
  expect(eb.by_id.has(hid(4))).toBe(false);
});

test_("_impl.rs:347 apply_adjustments: NeverToAny on a type variable, retargeting, reborrow replacement, compose bug", () => {
  const tcx = TCX!;
  const { em, dcx } = mk_dcx();
  const fcx = fake_fcx({ dcx: () => dcx.handle() });
  const e = lit_unit(1);
  call("write_ty", fcx, e.hir_id, tcx.types.never);
  const v = Ty.new_var(tcx, TyVid.from_u32(3));
  // NeverToAny to `?3t` records the diverging type variable.
  call("apply_adjustments", fcx, e, [{ kind: { $: "NeverToAny" }, target: v }]);
  expect(fcx.diverging_type_vars).toEqual([TyVid.from_u32(3)]);
  // A later adjustment on top of a lone NeverToAny only changes its target.
  const ref_u8 = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, tcx.types.u8);
  call("apply_adjustments", fcx, e, [{ kind: { $: "Borrow", _0: { $: "Ref", _0: { $: "Not" } } }, target: ref_u8 }]);
  const adjs = fcx.typeck_results.adjustments().get(e.hir_id)!;
  expect(adjs.length).toBe(1);
  expect(adjs[0]!.kind.$).toBe("NeverToAny");
  expect(adjs[0]!.target).toBe(ref_u8);

  // `[Deref, Borrow(Ref)]` followed by `[Deref, ..]`: replaced.
  const e2 = lit_unit(2);
  call("write_ty", fcx, e2.hir_id, ref_u8);
  const reborrow: Adjustment[] = [
    { kind: { $: "Deref", _0: { $: "Builtin" } }, target: tcx.types.u8 },
    { kind: { $: "Borrow", _0: { $: "Ref", _0: { $: "Not" } } }, target: ref_u8 },
  ];
  call("apply_adjustments", fcx, e2, reborrow);
  const deref_only: Adjustment[] = [{ kind: { $: "Deref", _0: { $: "Builtin" } }, target: tcx.types.u8 }];
  call("apply_adjustments", fcx, e2, deref_only);
  expect(fcx.typeck_results.adjustments().get(e2.hir_id)).toBe(deref_only);

  // Anything else: a delayed bug, then the new adjustments win.
  const other: Adjustment[] = [{ kind: { $: "Pointer", _0: { $: "Unsize" } }, target: ref_u8 }];
  with_reduced_queries(() => call("apply_adjustments", fcx, e2, other));
  expect(fcx.typeck_results.adjustments().get(e2.hir_id)).toBe(other);
  expect(dcx.handle().has_errors_or_delayed_bugs()).toBeDefined();
  expect(em.out.length).toBe(0);

  // Empty adjustments are a no-op.
  call("apply_adjustments", fcx, lit_unit(3), []);
  expect(fcx.typeck_results.adjustments().get(hid(3))).toBeUndefined();
});

test_("_impl.rs:627/781 can_contain_user_lifetime_bounds, err_args", () => {
  const tcx = TCX!;
  expect(FnCtxt.can_contain_user_lifetime_bounds(tcx.types.u8, fold_Ty)).toBe(false);
  expect(FnCtxt.can_contain_user_lifetime_bounds(Ty.new_param(tcx, 0, Symbol.intern("T")), fold_Ty)).toBe(true);
  expect(FnCtxt.can_contain_user_lifetime_bounds(Ty.new_var(tcx, TyVid.from_u32(0)), fold_Ty)).toBe(true);
  const { dcx } = mk_dcx();
  const guar = dcx.handle().span_delayed_bug(sp(0, 1), "test");
  const errs = call("err_args", fake_fcx(), 3, guar) as Ty[];
  expect(errs.length).toBe(3);
  expect(errs.every((t) => t === Ty.new_error(tcx, guar))).toBe(true);
});

test_("_impl.rs:654/671 register_wf_obligation / add_wf_bounds register `WellFormed` clauses", () => {
  const tcx = TCX!;
  const registered: PredicateObligation[] = [];
  const fcx = fake_fcx({
    param_env: { caller_bounds: () => [] },
    cause: (span: Span, code: unknown) => ({ span, code }),
    register_predicate: (o: PredicateObligation) => registered.push(o),
    register_wf_obligation: FnCtxt.prototype.register_wf_obligation,
  });
  const args = tcx.mk_args([GenericArg.from_Ty(tcx.types.u8), GenericArg.from_Region(tcx.lifetimes.re_static), GenericArg.from_Ty(tcx.types.bool)]);
  call("add_wf_bounds", fcx, args, sp(1, 2), hid(5));
  // Lifetimes are skipped (`GenericArg::as_term`).
  expect(registered.length).toBe(2);
  const kinds = registered.map((o) => Binder.skip_binder(o.predicate.kind()));
  expect(kinds.map((k) => (k.$ === "Clause" ? k._0.$ : k.$))).toEqual(["WellFormed", "WellFormed"]);
  expect((registered[0]!.cause as unknown as { code: unknown }).code).toEqual({ $: "WellFormed", _0: { $: "HirId", _0: hid(5) } });
});

test_("_impl.rs:741 select_obligations_where_possible: errors are mutated, adjusted, then reported through err_ctxt", () => {
  let errors: unknown[] = [];
  const seen: string[] = [];
  const fcx = fake_fcx({
    infcx: {},
    fulfillment_cx: { try_evaluate_obligations: () => (errors.length === 0 ? { $: "NoErrors" } : { $: "HasErrors", _0: errors }) },
    adjust_fulfillment_errors_for_expr_obligation: () => seen.push("adjust"),
    err_ctxt: () => {
      seen.push("err_ctxt");
      return { report_fulfillment_errors: () => seen.push("report") };
    },
  });
  call("select_obligations_where_possible", fcx, () => seen.push("mutate"));
  expect(seen).toEqual([]);
  errors = ["e"];
  call("select_obligations_where_possible", fcx, () => seen.push("mutate"));
  expect(seen).toEqual(["mutate", "adjust", "err_ctxt", "report"]);
});

test_("_impl.rs:114 deeply_resolve_ignoring_regions_with_obligations: no inference variables, nothing to do", () => {
  const tcx = TCX!;
  const fcx = fake_fcx({
    deeply_resolve_ignoring_regions: () => {
      throw new Error("must not resolve");
    },
  });
  expect(call("deeply_resolve_ignoring_regions_with_obligations", fcx, tcx.types.u8, fold_Ty)).toBe(tcx.types.u8);
  // With an unresolved variable: resolve, select, resolve again.
  const v = Ty.new_var(tcx, TyVid.from_u32(1));
  const seen: string[] = [];
  const fcx2 = fake_fcx({
    deeply_resolve_ignoring_regions: (t: Ty) => (seen.push("resolve"), seen.length === 3 ? tcx.types.i32 : t),
    select_obligations_where_possible: () => seen.push("select"),
  });
  expect(call("deeply_resolve_ignoring_regions_with_obligations", fcx2, v, fold_Ty)).toBe(tcx.types.i32);
  expect(seen).toEqual(["resolve", "select", "resolve"]);
});

test_("_impl.rs:1648 expr_in_place: the LHS of an assignment", () => {
  const lhs = lit_unit(1);
  const rhs = lit_unit(2);
  const assign = expr(3, { $: "Assign", _0: lhs, _1: rhs, _2: sp(0, 1) });
  const parents = new Map<number, hir.Node>([
    [1, { $: "Expr", _0: assign }],
    [2, { $: "Expr", _0: assign }],
    [3, { $: "Crate", _0: undefined as never }],
  ]);
  const fcx = fake_fcx({ tcx: { parent_hir_node: (id: HirId) => parents.get(id.local_id)! } });
  expect(call("expr_in_place", fcx, hid(1))).toBe(true);
  expect(call("expr_in_place", fcx, hid(2))).toBe(false);
});

test_("_impl.rs:52 warn_if_unreachable: only after `Always`, warns once, message and labels", () => {
  const { dcx } = mk_dcx();
  const lints: [unknown, HirId, Span, { into_diag: (d: unknown, l: unknown) => { messages: unknown; span: { span_labels: [Span, unknown][] }; args: unknown } }][] = [];
  const fcx = fake_fcx({
    diverges: Diverges.Maybe,
    tcx: {
      is_automatically_derived: () => false,
      parent: (d: unknown) => d,
      emit_node_span_lint: (lint: unknown, id: HirId, span: Span, decorator: never) => lints.push([lint, id, span, decorator]),
    },
  });
  call("warn_if_unreachable", fcx, hid(1), sp(5, 6), "expression");
  expect(lints.length).toBe(0);
  fcx.diverges = Diverges.always(sp(1, 2));
  call("warn_if_unreachable", fcx, hid(1), sp(5, 6), "expression");
  expect((fcx.diverges as Diverges).$).toBe("WarnedAlways");
  call("warn_if_unreachable", fcx, hid(1), sp(5, 6), "expression");
  expect(lints.length).toBe(1);
  const diag = (lints[0]![3].into_diag(dcx.handle(), { $: "Warning" }) as unknown as { diag: DiagInner }).diag;
  expect(format_diag_messages(diag.messages, diag.args)).toBe("unreachable expression");
  expect(diag.span.span_labels.map(([s, m]) => [s, format_diag_message(m, diag.args)])).toEqual([
    [sp(5, 6), "unreachable expression"],
    [sp(1, 2), "any code following this expression is unreachable"],
  ]);
});

test_("_match.rs:562 arms_contain_ref_bindings: the max mutability of explicit `ref` bindings", () => {
  const pat = (local: number, by_ref: BindingMode | undefined): hir.Pat =>
    new hir.Pat(
      hid(local),
      by_ref === undefined ? { $: "Wild" } : { $: "Binding", _0: by_ref, _1: hid(local), _2: Ident.new(Symbol.intern("x"), sp(0, 1)), _3: undefined },
      sp(local, local + 1),
      true,
    );
  const arm = (local: number, p: hir.Pat): hir.Arm => ({ hir_id: hid(local), span: sp(0, 1), pat: p, guard: undefined, body: lit_unit(local + 100) });
  const ref_not = new BindingMode({ $: "Yes", _0: "Not", _1: "Not" }, "Not");
  const ref_mut = new BindingMode({ $: "Yes", _0: "Not", _1: "Mut" }, "Not");
  expect(arms_contain_ref_bindings([])).toBeUndefined();
  expect(arms_contain_ref_bindings([arm(1, pat(1, undefined))])).toBeUndefined();
  expect(arms_contain_ref_bindings([arm(1, pat(1, ref_not)), arm(2, pat(2, undefined))])).toBe("Not");
  expect(arms_contain_ref_bindings([arm(1, pat(1, ref_mut)), arm(2, pat(2, ref_not))])).toBe("Mut");
});

test_("_match.rs:407/437 maybe_get_coercion_reason (`let` with a type), if_cause", () => {
  const pat = new hir.Pat(hid(2), { $: "Wild" }, sp(10, 11), true);
  const let_stmt = { hir_id: hid(1), pat, ty: {} } as unknown as hir.LetStmt;
  const fcx = fake_fcx({
    tcx: { hir_node: () => ({ $: "LetStmt", _0: let_stmt }) },
    find_block_span_from_hir_id: () => sp(30, 31),
    cause: (span: Span, code: unknown) => ({ span, code }),
  });
  expect(call("maybe_get_coercion_reason", fcx, hid(1), sp(0, 1))).toEqual([sp(10, 11), "expected because of this assignment"]);
  expect(call("if_cause", fcx, hid(4), lit_unit(5), undefined)).toEqual({
    span: sp(30, 31),
    code: { $: "IfExpression", expr_id: hid(4), tail_defines_return_position_impl_trait: undefined },
  });
});

test_("place_op.rs:196/226 try_(mutable_)overloaded_place_op bail without the lang items", () => {
  const fcx = fake_fcx({
    tcx: { lang_items: () => ({ deref_trait: () => undefined, index_trait: () => undefined, deref_mut_trait: () => undefined, index_mut_trait: () => undefined }) },
    lookup_method_for_operator: () => {
      throw new Error("must not look up");
    },
  });
  for (const op of ["Deref", "Index"]) {
    expect(call("try_overloaded_place_op", fcx, sp(0, 1), TCX!.types.u8, undefined, op)).toBeUndefined();
    expect(call("try_mutable_overloaded_place_op", fcx, sp(0, 1), TCX!.types.u8, undefined, op)).toBeUndefined();
  }
});

test_("place_op.rs:20 lookup_derefing: builtin deref of `&u8` needs no method", () => {
  const tcx = TCX!;
  const fcx = fake_fcx({
    try_overloaded_deref: () => {
      throw new Error("must not look up");
    },
  });
  const ref_u8 = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, tcx.types.u8);
  expect(call("lookup_derefing", fcx, lit_unit(1), lit_unit(2), ref_u8)).toBe(tcx.types.u8);
});

test_("place_op.rs:352 convert_place_op_to_mutable: builtin place ops are left alone", () => {
  const fcx = fake_fcx({
    try_mutable_overloaded_place_op: () => {
      throw new Error("must not look up");
    },
  });
  // No type-dependent def for the expression: not a method call.
  call("convert_place_op_to_mutable", fcx, "Deref", lit_unit(1), lit_unit(2));
});
