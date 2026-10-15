// Unit tests for the typeck-expr-b region of expr.ts (compiler/rustc_hir_typeck/src/expr.rs:1855..3957) and for
// inline_asm.ts.
//
// Typeck of real bodies does not reach these methods yet (`check_expr_kind` and `check_asms` belong to other lanes),
// so each test calls the ported method on a fake receiver: a plain object carrying the members the method reads, with
// the other methods it calls recorded or stubbed. Diagnostics go through a real `DiagCtxt` with a recording emitter.
// (The harness follows pat_b.test.ts.)
import { expect, test } from "bun:test";
import "./lib.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner, E0063, E0627 } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message, format_diag_messages } from "../rustc_errors/formatting.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { enter_context, ImplicitCtxt } from "../rustc_middle/ty/context/tls.ts";
import type { FieldIdx } from "../rustc_middle/ty/decls.ts";
import { type FieldDef, Ty } from "../rustc_middle/ty/mod.ts";
import { with_reduced_queries } from "../rustc_middle/ty/print/pretty.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { InlineAsmType } from "../rustc_target/asm/mod.ts";
import { Ok } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import { InlineAsmCtxt } from "./inline_asm.ts";
import { Needs } from "./lib.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

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

/** A `TyCtxt` whose listed members are overridden (the rest from `tcx`). */
function with_members(tcx: TyCtxt, members: object): TyCtxt {
  const o = Object.create(tcx) as TyCtxt;
  for (const [k, v] of Object.entries(members)) Object.defineProperty(o, k, { value: v });
  return o;
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

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));
const hid = (local: number): HirId => new HirId(new OwnerId(0 as LocalDefId), ItemLocalId.from_u32(local));
/** A fake `hir::Expr`: only the members the tested methods read. */
const ex = (local: number, extra: object = {}): hir.Expr => ({ hir_id: hid(local), span: sp(local, local + 1), ...extra }) as unknown as hir.Expr;

/** `FnCtxt.prototype.<name>` called on a fake receiver. */
function call<K extends keyof FnCtxt>(name: K, self_: object, ...args: unknown[]): unknown {
  return (FnCtxt.prototype[name] as unknown as (...a: unknown[]) => unknown).apply(self_, args);
}

function labels(d: DiagInner): string[] {
  return d.span.span_labels.map(([, m]) => format_diag_message(m, d.args));
}

test_("expr.rs:2705 name_series_display: limit 5, or 6 when exactly 6", () => {
  const names = (n: number): Symbol[] => Array.from({ length: n }, (_, i) => Symbol.intern(`f${i}`));
  expect(call("name_series_display", {}, names(2))).toBe("`f0`, `f1`");
  expect(call("name_series_display", {}, names(6))).toBe("`f0`, `f1`, `f2`, `f3`, `f4`, `f5`");
  expect(call("name_series_display", {}, names(8))).toBe("`f0`, `f1`, `f2`, `f3`, `f4` ... and 3 others");
});

test_("expr.rs:2278 report_missing_fields: sorted names, 3 shown then 'and N other fields' (E0063)", () => {
  const tcx = mk_tcx();
  const { em, dcx } = mk_dcx();
  const fcx = { tcx, dcx: () => dcx.handle() };
  const field = { value: undefined } as unknown as FieldDef;
  const remaining = (names: string[]): Map<Ident, [FieldIdx, FieldDef]> =>
    new Map(names.map((n, i): [Ident, [FieldIdx, FieldDef]] => [Ident.from_str(n), [i as FieldIdx, field]]));
  enter_context(new ImplicitCtxt(tcx, undefined, 0), () =>
    with_reduced_queries(() => {
      call("report_missing_fields", fcx, tcx.types.u8, sp(0, 3), sp(0, 9), remaining(["c", "a"]), undefined, [], undefined);
      call("report_missing_fields", fcx, tcx.types.u8, sp(0, 3), sp(0, 9), remaining(["e", "c", "a", "d", "b"]), undefined, [], undefined);
    }),
  );
  expect(em.out.map((d) => format_diag_messages(d.messages, d.args))).toEqual([
    "missing fields `a` and `c` in initializer of `u8`",
    "missing fields `a`, `b`, `c` and 2 other fields in initializer of `u8`",
  ]);
  expect(em.out.map((d) => d.code)).toEqual([E0063, E0063]);
  expect(labels(em.out[0]!)).toEqual(["missing `a` and `c`"]);
  expect(labels(em.out[1]!)).toEqual(["missing `a`, `b`, `c` and 2 other fields"]);
});

test_("expr.rs:2254 check_struct_fields_on_error: every field expression, then the base", () => {
  const checked: hir.Expr[] = [];
  const fcx = { check_expr: (e: hir.Expr) => checked.push(e) };
  const [e1, e2, e3] = [ex(1), ex(2), ex(3)];
  const fields = [{ expr: e1 }, { expr: e2 }];
  call("check_struct_fields_on_error", fcx, fields, { $: "Base", _0: e3 });
  expect(checked).toEqual([e1, e2, e3]);
  checked.length = 0;
  call("check_struct_fields_on_error", fcx, fields, { $: "DefaultFields", _0: sp(0, 1) });
  expect(checked).toEqual([e1, e2]);
});

test_("expr.rs:3646 check_expr_yield: inside a coroutine / outside (E0627, value still checked)", () => {
  const tcx = mk_tcx();
  const { em, dcx } = mk_dcx();
  const coerced: [hir.Expr, Ty][] = [];
  const checked: hir.Expr[] = [];
  const fcx = {
    tcx,
    dcx: () => dcx.handle(),
    coroutine_types: { resume_ty: tcx.types.u8, yield_ty: tcx.types.u16 } as object | undefined,
    check_expr_coercible_to_type: (e: hir.Expr, t: Ty) => coerced.push([e, t]),
    check_expr: (e: hir.Expr) => checked.push(e),
  };
  const value = ex(1);
  expect(call("check_expr_yield", fcx, value, ex(2))).toBe(tcx.types.u8);
  expect(coerced).toEqual([[value, tcx.types.u16]]);
  fcx.coroutine_types = undefined;
  expect(call("check_expr_yield", fcx, value, ex(2))).toBe(tcx.types.unit);
  expect(checked).toEqual([value]);
  expect(em.out.map((d) => d.code)).toEqual([E0627]);
});

test_("expr.rs:3666 check_expr_asm_operand: outputs need a place, `&T` inputs coerce to `*const T`", () => {
  const tcx = mk_tcx();
  const { em, dcx } = mk_dcx();
  const needs: Needs[] = [];
  const sized: string[] = [];
  const coerced: [Ty, Ty][] = [];
  const ref_u8 = Ty.new_ref(tcx, tcx.lifetimes.re_static, tcx.types.u8, "Not");
  const fcx = {
    tcx,
    dcx: () => dcx.handle(),
    check_expr_with_needs: (_e: hir.Expr, n: Needs) => (needs.push(n), ref_u8),
    require_type_is_sized: (_t: Ty, _s: Span, code: { $: string }) => sized.push(code.$),
    structurally_resolve_type: (_s: Span, t: Ty) => t,
    demand_coerce: (_e: hir.Expr, a: Ty, b: Ty) => (coerced.push([a, b]), b),
  };
  // output, not a place expression
  call("check_expr_asm_operand", fcx, ex(1, { is_syntactic_place_expr: () => false }), false);
  // input `&u8`
  call("check_expr_asm_operand", fcx, ex(2, { is_syntactic_place_expr: () => false }), true);
  expect(needs).toEqual([Needs.MutPlace, Needs.None]);
  expect(sized).toEqual(["InlineAsmSized", "InlineAsmSized"]);
  expect(em.out.map((d) => format_diag_messages(d.messages, d.args))).toEqual(["invalid asm output"]);
  expect(labels(em.out[0]!)).toEqual(["cannot assign to this expression"]);
  expect(coerced).toEqual([[ref_u8, Ty.new_ptr(tcx, tcx.types.u8, "Not")]]);
});

test_("expr.rs:3785 check_expr_offset_of: tuple field `1` of `(u8, u16)`", () => {
  const tcx0 = mk_tcx();
  const tcx = with_members(tcx0, { features: () => ({ offset_of_slice: () => false }) });
  const tup = Ty.new_tup(tcx0, [tcx0.types.u8, tcx0.types.u16]);
  const sized: [Ty, string][] = [];
  const inserted: unknown[] = [];
  const fcx = {
    tcx,
    lower_ty: () => ({ normalized: tup }),
    structurally_resolve_type: (_s: Span, t: Ty) => t,
    require_type_is_sized: (t: Ty, _s: Span, code: { $: string }) => sized.push([t, code.$]),
    typeck_results: { offset_of_data_mut: () => ({ insert: (_id: HirId, v: unknown) => inserted.push(v) }) },
  };
  const r = call("check_expr_offset_of", fcx, {}, [Ident.from_str("1")], ex(1));
  expect(r).toBe(tcx0.types.usize);
  expect(sized).toEqual([[tcx0.types.u16, "WellFormed"]]);
  expect(inserted).toEqual([[[tup, 0, 1]]]);
});

test_("inline_asm.rs:71 get_asm_ty: integers by size, isize by pointer width, floats, other types invalid", () => {
  const tcx0 = mk_tcx();
  const t = tcx0.types;
  const tcx = with_members(tcx0, { sess: { target: { pointer_width: 64 } } });
  const cx = new InlineAsmCtxt(new Set(), { tcx } as unknown as FnCtxt);
  const s = sp(0, 1);
  expect(cx.get_asm_ty(s, t.u8)).toEqual(Ok(InlineAsmType.I8));
  expect(cx.get_asm_ty(s, t.i32)).toEqual(Ok(InlineAsmType.I32));
  expect(cx.get_asm_ty(s, t.usize)).toEqual(Ok(InlineAsmType.I64));
  expect(cx.get_asm_ty(s, t.f32)).toEqual(Ok(InlineAsmType.F32));
  expect(cx.get_asm_ty(s, t.bool)).toEqual({ $: "Err", _0: { $: "Invalid", _0: t.bool } });
});

// ---- fake ADTs (only the members the tested methods read) ----------------------------------------------------------

const PUBLIC = { $: "Public" } as const;
/** A fake `FieldDef` named `name` (public, no default value). */
function fake_field(name: string, did: number): FieldDef {
  return { did: { krate: 0, index: did }, name: Symbol.intern(name), vis: PUBLIC, value: undefined, ident: () => Ident.from_str(name) } as unknown as FieldDef;
}
/** A fake struct `AdtDef` with one variant holding `fields`, and a fake `Ty` of kind `Adt` over it. */
function fake_struct(fields: FieldDef[]): { adt: object; variant: object; ty: Ty } {
  const variant = {
    def_id: { krate: 0, index: 100 },
    fields,
    has_errors: () => Ok(null),
    field_list_has_applicable_non_exhaustive: () => false,
  };
  const adt = {
    is_enum: () => false,
    is_struct: () => true,
    adt_kind: () => "Struct",
    variant_descr: () => "struct",
    did: () => ({ krate: 0, index: 99 }),
    non_enum_variant: () => variant,
  };
  const ty = { kind: () => ({ $: "Adt", _0: adt, _1: [] }) } as unknown as Ty;
  return { adt, variant, ty };
}

test_("expr.rs:2748 check_expr_field: struct field through autoderef, tuple field `1`", () => {
  const tcx0 = mk_tcx();
  const stability: number[] = [];
  const tcx = with_members(tcx0, {
    adjust_ident_and_get_scope: (ident: Ident) => [ident, { krate: 0, index: 0 }],
    check_stability: (did: { index: number }) => stability.push(did.index),
  });
  const { ty: s_ty } = fake_struct([fake_field("x", 1), fake_field("y", 2)]);
  const written: [HirId, number][] = [];
  const applied: unknown[] = [];
  const registered: unknown[] = [];
  let base_ty: Ty = s_ty;
  const fcx = {
    tcx,
    mod_id: 0,
    check_expr: () => base_ty,
    structurally_resolve_type: (_s: Span, t: Ty) => t,
    autoderef: (_s: Span, t: Ty) => {
      let done = false;
      return {
        next: () => (done ? undefined : ((done = true), [t, 0])),
        into_obligations: () => ["obligations"],
      };
    },
    adjust_steps: () => ["adjustments"],
    apply_adjustments: (_e: hir.Expr, a: unknown) => applied.push(a),
    register_predicates: (o: unknown) => registered.push(o),
    write_field_index: (id: HirId, i: number) => written.push([id, i]),
    find_adt_field: FnCtxt.prototype.find_adt_field,
    field_ty: (_s: Span, f: FieldDef) => (f.name === Symbol.intern("y") ? tcx0.types.u32 : tcx0.types.u8),
  };
  const expr = ex(5);
  expect(call("check_expr_field", fcx, expr, ex(4), Ident.from_str("y"), { $: "NoExpectation" })).toBe(tcx0.types.u32);
  expect(written).toEqual([[expr.hir_id, 1]]);
  expect(applied).toEqual([["adjustments"]]);
  expect(registered).toEqual([["obligations"]]);
  expect(stability).toEqual([2]);

  written.length = 0;
  base_ty = Ty.new_tup(tcx0, [tcx0.types.u8, tcx0.types.u32]);
  expect(call("check_expr_field", fcx, expr, ex(4), Ident.from_str("1"), { $: "NoExpectation" })).toBe(tcx0.types.u32);
  expect(written).toEqual([[expr.hir_id, 1]]);
});

test_("expr.rs:1856 check_expr_struct_fields: fields typed in order; duplicate (E0062) and missing fields reported", () => {
  const tcx0 = mk_tcx();
  const tcx = with_members(tcx0, {
    adjust_ident: (ident: Ident) => ident,
    check_stability: () => true,
  });
  const { em, dcx } = mk_dcx();
  const fx = fake_field("x", 1);
  const fy = fake_field("y", 2);
  const { variant, ty: s_ty } = fake_struct([fx, fy]);
  const log: string[] = [];
  const missing: string[][] = [];
  const fcx = {
    tcx,
    mod_id: 0,
    dcx: () => dcx.handle(),
    deeply_resolve_ignoring_regions_with_obligations: (t: Ty) => t,
    write_field_index: (_id: HirId, i: number) => log.push(`index ${i}`),
    field_ty: (_s: Span, f: FieldDef) => (log.push(`field_ty ${Symbol.as_str(f.name)}`), tcx0.types.u8),
    register_wf_obligation: () => log.push("wf"),
    check_expr_with_hint: (e: hir.Expr, t: Ty) => (log.push(`check ${e.span}`), t),
    demand_coerce_diag: (_e: hir.Expr, t: Ty) => Ok(t),
    report_missing_fields: (_t: Ty, _s: Span, _f: Span, remaining: Map<Ident, unknown>) =>
      missing.push([...remaining.keys()].map((i) => i.as_str())),
  };
  const field = (name: string, local: number) => ({ hir_id: hid(local), ident: Ident.from_str(name), expr: ex(local), span: sp(local, local + 1) });
  // `P { y: .., x: .. }`
  call("check_expr_struct_fields", fcx, s_ty, { $: "NoExpectation" }, ex(0), sp(0, 1), variant, [field("y", 1), field("x", 2)], { $: "None" });
  expect(log).toEqual(["index 1", "field_ty y", "wf", `check ${sp(1, 2)}`, "index 0", "field_ty x", "wf", `check ${sp(2, 3)}`]);
  expect(missing).toEqual([]);
  // `P { x: .. }`: `y` missing
  call("check_expr_struct_fields", fcx, s_ty, { $: "NoExpectation" }, ex(0), sp(0, 1), variant, [field("x", 3)], { $: "None" });
  expect(missing).toEqual([["y"]]);
  // `P { x: .., x: .. }`: E0062, and no missing-field report after an error
  call("check_expr_struct_fields", fcx, s_ty, { $: "NoExpectation" }, ex(0), sp(0, 1), variant, [field("x", 4), field("x", 5)], { $: "None" });
  expect(em.out.map((d) => format_diag_messages(d.messages, d.args))).toEqual(["field `x` specified more than once"]);
  expect(missing).toEqual([["y"]]);
});
