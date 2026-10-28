// Unit tests for the typeck-pat-b region of pat.ts (compiler/rustc_hir_typeck/src/pat.rs:1780..3388).
//
// Typeck of real bodies does not reach these methods yet (other lanes' placeholders stop first), so each test calls
// the ported method on a fake `FnCtxt` receiver: a plain object carrying the members the method reads, with the other
// FnCtxt methods it calls recorded or stubbed. Diagnostics go through a real `DiagCtxt` with a recording emitter.
import { expect, test } from "bun:test";
import "./lib.ts";
import { BindingMode, ByRef } from "../rustc_ast/lib.ts";
import { Diag, DiagCtxt, DiagCtxtFlags_default, type DiagInner, E0027, E0527, E0528, E0730, Suggestions } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message, format_diag_messages } from "../rustc_errors/formatting.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Rust2024IncompatiblePatInfo } from "../rustc_middle/ty/typeck_results.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { with_reduced_queries } from "../rustc_middle/ty/print/pretty.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { enter_context, ImplicitCtxt } from "../rustc_middle/ty/context/tls.ts";
import { BytePos, create_default_session_globals_then, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { ch } from "../std/char.ts";
import { Ok } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import { MutblCap, type PatInfo } from "./pat.gen.ts";

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
const pat = (local: number, kind: hir.PatKind, span: Span = sp(local, local + 1)): hir.Pat => new hir.Pat(hid(local), kind, span, true);
const wild = (local: number): hir.Pat => pat(local, hir.PatKind.Wild);

/** `FnCtxt.prototype.<name>` called on a fake receiver. */
function call<K extends keyof FnCtxt>(name: K, self_: object, ...args: unknown[]): unknown {
  return (FnCtxt.prototype[name] as unknown as (...a: unknown[]) => unknown).apply(self_, args);
}

function labels(d: DiagInner): string[] {
  return d.span.span_labels.map(([, m]) => format_diag_message(m, d.args));
}

function suggestions(d: DiagInner): [string, string[]][] {
  return Suggestions.unwrap_tag(d.suggestions).map((s) => [format_diag_message(s.msg, d.args), s.substitutions[0]!.parts.map((p) => p.snippet)]);
}

function pat_info(tcx: TyCtxt, binding_mode: ByRef = ByRef.No): PatInfo {
  return {
    binding_mode,
    max_pinnedness: "Not",
    max_ref_mutbl: MutblCap.Mut,
    top_info: { expected: tcx.types.unit, origin_expr: undefined, span: undefined, hir_id: hid(0) },
    decl_origin: undefined,
    current_depth: 0,
  };
}

test_("pat.rs:3200/3219/3241: array length errors (messages, codes, labels)", () => {
  const { em, dcx } = mk_dcx();
  const fcx = { dcx: () => dcx.handle() };
  call("error_scrutinee_inconsistent_length", fcx, sp(0, 5), 1, 3);
  call("error_scrutinee_with_rest_inconsistent_length", fcx, sp(0, 5), 4, 1);
  call("error_scrutinee_unfixed_length", fcx, sp(0, 5));
  expect(em.out.map((d) => format_diag_messages(d.messages, d.args))).toEqual([
    "pattern requires 1 element but array has 3",
    "pattern requires at least 4 elements but array has 1",
    "cannot pattern-match on an array without a fixed length",
  ]);
  expect(em.out.map((d) => d.code)).toEqual([E0527, E0528, E0730]);
  expect(labels(em.out[0]!)).toEqual(["expected 3 elements"]);
  expect(labels(em.out[1]!)).toEqual(["pattern cannot match array of 1 element"]);
});

test_("pat.rs:3152 check_array_pat_len: known length, with and without a rest pattern", () => {
  const tcx = mk_tcx();
  const { em, dcx } = mk_dcx();
  let len: bigint | undefined = 3n; // `Const::try_to_target_usize`: the `u64` is a `bigint`
  const demanded: [Ty, Ty][] = [];
  const fcx = {
    tcx,
    dcx: () => dcx.handle(),
    try_structurally_resolve_const: () => ({ try_to_target_usize: () => len }),
    demand_eqtype: (_sp: Span, a: Ty, b: Ty) => demanded.push([a, b]),
    error_scrutinee_inconsistent_length: FnCtxt.prototype.error_scrutinee_inconsistent_length,
    error_scrutinee_with_rest_inconsistent_length: FnCtxt.prototype.error_scrutinee_with_rest_inconsistent_length,
    error_scrutinee_unfixed_length: FnCtxt.prototype.error_scrutinee_unfixed_length,
  };
  const arr = tcx.types.u8;
  // exact match, no `..`: (None, arr_ty)
  expect(call("check_array_pat_len", fcx, sp(0, 1), tcx.types.u8, arr, undefined, undefined, 3)).toEqual([undefined, arr]);
  // too few elements, no `..`: E0527, Some(error)
  const r1 = call("check_array_pat_len", fcx, sp(0, 1), tcx.types.u8, arr, undefined, undefined, 2) as [Ty | undefined, Ty];
  expect(r1[0]?.kind().$).toBe("Error");
  expect(r1[1]).toBe(arr);
  // `..` but more elements than the array: E0528
  const r2 = call("check_array_pat_len", fcx, sp(0, 1), tcx.types.u8, arr, wild(1), undefined, 4) as [Ty | undefined, Ty];
  expect(r2[0]?.kind().$).toBe("Error");
  // unknown length with `..`: E0730
  len = undefined;
  call("check_array_pat_len", fcx, sp(0, 1), tcx.types.u8, arr, wild(1), undefined, 1);
  expect(em.out.map((d) => d.code)).toEqual([E0527, E0528, E0730]);
  expect(demanded).toEqual([]);
});

test_("pat.rs:2053 check_pat_tuple: `..` takes the arity from the expected tuple and skips the gap", () => {
  const tcx = mk_tcx();
  const t = tcx.types;
  const fresh = [t.u8, t.u16, t.u32, t.u64];
  let next = 0;
  const checked: [number, Ty][] = [];
  const expected = Ty.new_tup(tcx, [t.bool, t.bool, t.bool, t.bool]);
  const fcx = {
    tcx,
    structurally_resolve_type: (_sp: Span, ty: Ty) => ty,
    next_ty_var: () => fresh[next++]!,
    demand_eqtype_pat: () => Ok(undefined),
    check_pat: (p: hir.Pat, ty: Ty) => checked.push([p.hir_id.local_id as unknown as number, ty]),
  };
  // `(a, .., b)` against a 4-tuple: a -> element 0, b -> element 3
  const r = call("check_pat_tuple", fcx, sp(0, 1), [wild(1), wild(2)], hir.DotDotPos.new(1), expected, pat_info(tcx)) as Ty;
  expect(next).toBe(4);
  // PORT(test): compared structurally: `Ty::new_tup(tcx, element_tys)` with an interned `&List` currently re-interns a
  // second list (TyCtxt `slice_intern` keys an interned list by id; reported in docs/handoff/typeck-pat-b.md).
  const rk = r.kind();
  expect(rk.$ === "Tuple" ? [...rk._0] : undefined).toEqual(fresh);
  expect(checked).toEqual([
    [1, t.u8],
    [2, t.u64],
  ]);
});

test_("pat.rs:2781 check_pat_ref: `&p` against `&u8` matches the reference without touching the caller's PatInfo", () => {
  const tcx = mk_tcx();
  const expected = Ty.new_ref(tcx, tcx.lifetimes.re_static, tcx.types.u8, "Not");
  const checked: [hir.Pat, Ty, PatInfo][] = [];
  const fcx = {
    tcx,
    ref_pat_matches_mut_ref: () => false,
    deeply_resolve_ignoring_regions_with_obligations: (ty: Ty) => ty,
    check_dereferenceable: () => Ok(undefined),
    check_pat: (p: hir.Pat, ty: Ty, info: PatInfo) => checked.push([p, ty, info]),
  };
  const inner = wild(2);
  const outer = pat(1, { $: "Ref", _0: inner, _1: "Not", _2: "Not" }, sp(0, 2));
  const info = pat_info(tcx);
  const r = call("check_pat_ref", fcx, outer, inner, "Not", "Not", expected, info);
  expect(r).toBe(expected);
  expect(checked.length).toBe(1);
  expect(checked[0]![1]).toBe(tcx.types.u8);
  // r_mutbl == Not caps the inner pattern's ref mutability
  expect(checked[0]![2].max_ref_mutbl).toBe(MutblCap.Not);
  // `mut pat_info` is a copy
  expect(info.max_ref_mutbl).toBe(MutblCap.Mut);
});

test_("pat.rs:3069 pat_is_irrefutable / pat.rs:3022 try_resolve_slice_ty_to_array_ty", () => {
  const fcx = {};
  expect(call("pat_is_irrefutable", fcx, { $: "LocalDecl", els: undefined })).toBe(true);
  expect(call("pat_is_irrefutable", fcx, { $: "LocalDecl", els: {} })).toBe(false);
  expect(call("pat_is_irrefutable", fcx, { $: "LetExpr" })).toBe(false);
  expect(call("pat_is_irrefutable", fcx, undefined)).toBe(false);
  // a rest pattern means no array type can be inferred
  expect(call("try_resolve_slice_ty_to_array_ty", { next_ty_var: () => expect.unreachable() }, [], wild(1), sp(0, 1))).toBeUndefined();
});

test_("pat.rs:3301 is_slice_or_array_or_vector: peels references", () => {
  const tcx = mk_tcx();
  const fcx = { tcx, is_slice_or_array_or_vector: FnCtxt.prototype.is_slice_or_array_or_vector };
  const slice = tcx.mk_ty_from_kind({ $: "Slice", _0: tcx.types.u8 });
  const r = Ty.new_ref(tcx, tcx.lifetimes.re_static, Ty.new_ref(tcx, tcx.lifetimes.re_static, slice, "Not"), "Mut");
  expect(call("is_slice_or_array_or_vector", fcx, r)).toEqual([true, slice]);
  expect(call("is_slice_or_array_or_vector", fcx, tcx.types.u8)).toEqual([false, tcx.types.u8]);
});

test_("pat.rs:2627 error_unmentioned_fields: message and label (no suggestion for a non-struct pattern)", () => {
  const { dcx } = mk_dcx();
  const fcx = { dcx: () => dcx.handle() };
  const a = Ident.new(Symbol.intern("a"), sp(20, 21));
  const zero = Ident.new(Symbol.intern("0"), sp(22, 23));
  const qpath = { $: "Resolved", _0: undefined, _1: { span: sp(0, 3), res: { $: "Err" }, segments: [] } } as unknown as hir.QPath;
  // `fields` empty and the pattern is not `Path {}`: `_ => return err` before the suggestions (which need
  // `is_number`, pat.rs:49, lane typeck-pat-a).
  const p = pat(1, { $: "TupleStruct", _0: qpath, _1: [], _2: hir.DotDotPos.new(undefined) }, sp(0, 9));
  const err = call("error_unmentioned_fields", fcx, p, [[{}, a], [{}, zero]], true, []) as Diag;
  const d = err.deref();
  expect(format_diag_messages(d.messages, d.args)).toBe("pattern does not mention fields `a`, `0` and inaccessible fields");
  expect(d.code).toBe(E0027);
  expect(labels(d)).toEqual(["missing fields `a`, `0` and inaccessible fields"]);
  expect(suggestions(d)).toEqual([]);
  err.cancel();
  const err1 = call("error_unmentioned_fields", fcx, p, [[{}, a]], false, []) as Diag;
  expect(format_diag_messages(err1.deref().messages, err1.deref().args)).toBe("pattern does not mention field `a`");
  err1.cancel();
});

test_("pat.rs:3314 add_rust_2024_migration_desugared_pat: labels and flags", () => {
  const table = new Map<HirId, Rust2024IncompatiblePatInfo>();
  const fcx = {
    tcx: {
      sess: { source_map: () => ({ span_through_char: (s: Span, c: number) => (c === ch("&") ? Span.shrink_to_lo(s) : s) }) },
      features: () => ({ ref_pat_eat_one_layer_2024: () => false, ref_pat_eat_one_layer_2024_structural: () => false }),
    },
    typeck_results: {
      rust_2024_migration_desugared_pats_mut: () => ({
        entry: (id: HirId) => ({
          or_insert_with: (f: () => Rust2024IncompatiblePatInfo) => {
            if (!table.has(id)) table.set(id, f());
            return { value: table.get(id)! };
          },
        }),
      }),
    },
  };
  const top = hid(0);
  const ref_pat = pat(1, { $: "Ref", _0: wild(2), _1: "Not", _2: "Not" }, sp(10, 12));
  call("add_rust_2024_migration_desugared_pat", fcx, top, ref_pat, ch("&"), "Not");
  const binding = pat(3, { $: "Binding", _0: new BindingMode({ $: "Yes", _0: "Not", _1: "Not" }, "Not"), _1: hid(3), _2: Ident.new(Symbol.intern("x"), sp(20, 21)), _3: undefined }, sp(16, 21));
  call("add_rust_2024_migration_desugared_pat", fcx, top, binding, ch("f"), "Not");
  const info = table.get(top)!;
  expect(info.primary_labels.map(([, l]) => l)).toEqual([
    "reference pattern not allowed when implicitly borrowing",
    "explicit `ref` binding modifier not allowed when implicitly borrowing",
  ]);
  expect(info.primary_labels[0]![0]).toBe(Span.shrink_to_lo(sp(10, 12)));
  expect([info.bad_ref_pats, info.bad_ref_modifiers, info.bad_mut_modifiers, info.suggest_eliding_modes]).toEqual([true, true, false, false]);
});

test_("pat.rs:2559 lint_non_exhaustive_omitted_patterns: FieldsNotListed (pat.rs:2573) and the joined field list (pat.rs:2586)", () => {
  const tcx = mk_tcx();
  const { dcx } = mk_dcx();
  const render = (names: string[]): string[] => {
    let decorator: { into_diag(dcx: unknown, level: unknown): Diag } | undefined;
    const fcx = { tcx: { emit_node_span_lint: (_l: unknown, _h: unknown, _s: unknown, d: typeof decorator) => (decorator = d) } };
    const fields = names.map((n, i) => [{}, Ident.new(Symbol.intern(n), sp(i, i + 1))]);
    call("lint_non_exhaustive_omitted_patterns", fcx, wild(1), fields, tcx.types.u8);
    const diag = enter_context(new ImplicitCtxt(tcx, undefined, 0), () => with_reduced_queries(() => decorator!.into_diag(dcx.handle(), { $: "Warning" })));
    const d = diag.deref();
    const out = [format_diag_messages(d.messages, d.args), ...labels(d), ...d.children.map((c) => format_diag_messages(c.messages, d.args))];
    diag.cancel();
    return out;
  };
  expect(render(["a"])).toEqual([
    "some fields are not explicitly listed",
    "field `a` not listed",
    "ensure that all fields are mentioned explicitly by adding the suggested fields",
    "the pattern is of type `u8` and the `non_exhaustive_omitted_patterns` attribute was found",
  ]);
  expect(render(["a", "b"])[1]).toBe("fields `a` and `b` not listed");
  expect(render(["a", "b", "c"])[1]).toBe("fields `a`, `b` and `c` not listed");
  // `[head @ .., tail] if head.len() < LIMIT` fails for 4 witnesses (head has 3): the `_` arm
  expect(render(["a", "b", "c", "d"])[1]).toBe("fields `a`, `b`, `c` and 1 more not listed");
  expect(render(["a", "b", "c", "d", "e"])[1]).toBe("fields `a`, `b`, `c` and 2 more not listed");
});

test_("guar plumbing: ErrorGuaranteed values flow through check_pat_tuple's error path", () => {
  const tcx = mk_tcx();
  const { dcx } = mk_dcx();
  const guar = dcx.handle().struct_err("boom").emit_err() as ErrorGuaranteed;
  const checked: Ty[] = [];
  const fcx = {
    tcx,
    next_ty_var: () => tcx.types.u8,
    demand_eqtype_pat: () => ({ $: "Err", _0: guar }),
    check_pat: (_p: hir.Pat, ty: Ty) => checked.push(ty),
  };
  const r = call("check_pat_tuple", fcx, sp(0, 1), [wild(1)], hir.DotDotPos.new(undefined), tcx.types.u8, pat_info(tcx)) as Ty;
  expect(r.kind().$).toBe("Error");
  expect(checked.map((t) => t.kind().$)).toEqual(["Error"]);
});
