// Tests of lane encoder-b's part of encoder.ts (encoder.rs :651–:1481): `analyze_attr`, the `should_encode_*`
// predicates, `should_encode_mir` on the M5 path (plan-m5 D5: no codegen) and `encode_attrs` against an
// `EncodeContext` over a `MemEncoder` with a stand-in `TyCtxt` (only the queries `encode_attrs` reads).
import { expect, test } from "bun:test";
import "../lib.ts";
import { AttrPath, type Attribute, encode_Attribute } from "../../rustc_attr_ir/attr.ts";
import { AttributeKind, default_DocAttribute } from "../../rustc_attr_ir/data_structures.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type FileEncoder, MemEncoder } from "../../rustc_serialize/opaque.ts";
import "../../rustc_span/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import {
  type AnalyzeAttrState,
  analyze_attr,
  EncodeContext,
  should_encode_attrs,
  should_encode_const,
  should_encode_constness,
  should_encode_expn_that_defined,
  should_encode_fn_sig,
  should_encode_generics,
  should_encode_mir,
  should_encode_span,
  should_encode_stability,
  should_encode_visibility,
} from "./encoder.ts";
import { AttrFlags, LazyState, TableBuilders_default } from "./mod.ts";

const parsed = (k: AttributeKind): Attribute => ({ $: "Parsed", _0: k });
const unparsed = (name: Symbol): Attribute => ({
  $: "Unparsed",
  _0: { path: new AttrPath([name], DUMMY_SP), args: { $: "Empty" }, id: undefined as never, style: "Outer", span: DUMMY_SP } as never,
});
const doc_comment: Attribute = parsed({ $: "DocComment", style: "Outer", kind: "LineDoc" as never, span: DUMMY_SP, comment: sym.doc });
const doc_hidden = (): Attribute => {
  const d = default_DocAttribute();
  d.hidden = DUMMY_SP;
  return parsed({ $: "Doc", _0: d });
};

test("analyze_attr: encode-cross-crate No, lint attributes, doc comments, #[doc(hidden)]", () => {
  const state: AnalyzeAttrState = { is_exported: false, is_doc_hidden: false };
  // `Cold` is `EncodeCrossCrate::No`; `AutomaticallyDerived` is `Yes`
  expect(analyze_attr(parsed(AttributeKind.Cold), state)).toBe(false);
  expect(analyze_attr(parsed(AttributeKind.AutomaticallyDerived), state)).toBe(true);
  for (const lint of [sym.warn, sym.allow, sym.expect, sym.forbid, sym.deny]) expect(analyze_attr(unparsed(lint), state)).toBe(false);
  expect(analyze_attr(unparsed(sym.rustfmt), state)).toBe(true);
  // doc comments only for exported items
  expect(analyze_attr(doc_comment, state)).toBe(false);
  expect(analyze_attr(doc_comment, { is_exported: true, is_doc_hidden: false })).toBe(true);
  expect(state.is_doc_hidden).toBe(false);
  expect(analyze_attr(doc_hidden(), state)).toBe(true);
  expect(state.is_doc_hidden).toBe(true);
});

test("should_encode_* predicates: the guarded arms (Static nested, Ctor kind, Impl of_trait)", () => {
  const stat = (nested: boolean): DefKind => ({ $: "Static", safety: "Safe" as never, mutability: "Not" as never, nested });
  const ctor = (k: "Fn" | "Const"): DefKind => ({ $: "Ctor", _0: "Struct", _1: k });
  const imp = (of_trait: boolean): DefKind => ({ $: "Impl", of_trait });
  expect([should_encode_attrs(stat(false)), should_encode_attrs(stat(true))]).toEqual([true, false]);
  expect([should_encode_visibility(stat(false)), should_encode_visibility(stat(true))]).toEqual([true, false]);
  expect([should_encode_span(stat(true)), should_encode_stability(stat(true)), should_encode_generics(stat(true))]).toEqual([true, true, true]);
  expect([should_encode_fn_sig(ctor("Fn")), should_encode_fn_sig(ctor("Const"))]).toEqual([true, false]);
  expect([should_encode_constness(ctor("Fn")), should_encode_constness(ctor("Const"))]).toEqual([true, false]);
  expect([should_encode_constness(imp(false)), should_encode_constness(imp(true))]).toEqual([true, false]);
  expect([should_encode_expn_that_defined(imp(true)), should_encode_visibility(imp(false))]).toEqual([true, false]);
  expect([should_encode_span(DefKind.ForeignMod), should_encode_span(DefKind.GlobalAsm), should_encode_span(DefKind.TestBinderConstraints)]).toEqual([false, false, false]);
  expect([should_encode_attrs(DefKind.Use), should_encode_attrs(DefKind.Closure), should_encode_attrs(DefKind.SyntheticCoroutineBody)]).toEqual([true, true, false]);
  expect([should_encode_const(DefKind.Const), should_encode_const(DefKind.AssocConst), should_encode_const(DefKind.AnonConst), should_encode_const(DefKind.Fn)]).toEqual([true, true, true, false]);
});

/** A `TyCtxt` stand-in answering `should_encode_mir`'s queries. */
function mir_tcx(def_kind: DefKind, o: { coroutine?: boolean; const_fn?: boolean; always?: boolean; always_encode_mir?: boolean; codegen?: boolean }): TyCtxt {
  return {
    def_kind: () => def_kind,
    is_coroutine: () => o.coroutine ?? false,
    is_const_fn: () => o.const_fn ?? false,
    constness: () => (o.const_fn ? { $: "Const", always: o.always ?? false } : { $: "NotConst" }),
    generics_of: () => ({ requires_monomorphization: () => true }),
    cross_crate_inlinable: () => true,
    sess: { opts: { unstable_opts: { always_encode_mir: o.always_encode_mir ?? false }, output_types: { should_codegen: () => o.codegen ?? false } } },
  } as unknown as TyCtxt;
}

test("should_encode_mir: CTFE MIR only, no optimized MIR without codegen (D5); both branches", () => {
  const id = LocalDefId.of(1 as never);
  const reachable = new Set([id]);
  expect(should_encode_mir(mir_tcx(DefKind.AnonConst, {}), reachable, id)).toEqual([true, false]);
  expect(should_encode_mir(mir_tcx({ $: "Ctor", _0: "Struct", _1: "Fn" }, {}), reachable, id)).toEqual([true, false]);
  expect(should_encode_mir(mir_tcx(DefKind.Closure, { coroutine: true }), reachable, id)).toEqual([false, true]);
  expect(should_encode_mir(mir_tcx(DefKind.Closure, {}), reachable, id)).toEqual([false, false]);
  expect(should_encode_mir(mir_tcx(DefKind.SyntheticCoroutineBody, {}), reachable, id)).toEqual([false, true]);
  // the M5 path: `--emit=metadata`, no codegen
  expect(should_encode_mir(mir_tcx(DefKind.Fn, { const_fn: true }), reachable, id)).toEqual([true, false]);
  expect(should_encode_mir(mir_tcx(DefKind.Fn, {}), reachable, id)).toEqual([false, false]);
  // with codegen / -Zalways-encode-mir
  expect(should_encode_mir(mir_tcx(DefKind.Fn, { codegen: true }), reachable, id)).toEqual([false, true]);
  expect(should_encode_mir(mir_tcx(DefKind.Fn, { codegen: true }), new Set(), id)).toEqual([false, false]);
  expect(should_encode_mir(mir_tcx(DefKind.AssocFn, { always_encode_mir: true }), new Set(), id)).toEqual([false, true]);
  expect(should_encode_mir(mir_tcx(DefKind.Fn, { always_encode_mir: true, const_fn: true, always: true }), reachable, id)).toEqual([true, false]);
  expect(should_encode_mir(mir_tcx(DefKind.Struct, { always_encode_mir: true }), reachable, id)).toEqual([false, false]);
});

/** An `EncodeContext` over a `MemEncoder` with fresh tables and a `TyCtxt` stand-in for `encode_attrs`. */
function attrs_ecx(attrs: Attribute[], is_exported: boolean): EncodeContext {
  const none = undefined as never;
  const tcx = {
    effective_visibilities: () => ({ is_exported: () => is_exported }),
    local_def_id_to_hir_id: () => none,
    hir_attrs: () => attrs,
  } as unknown as TyCtxt;
  return new EncodeContext(MemEncoder.new() as unknown as FileEncoder, none, tcx, none, TableBuilders_default(), LazyState.NoNode, new Map(), new Map(), new Map(), new Map(), none, new Map(), false, none, new Map());
}

test("encode_attrs: filters with analyze_attr while encoding, records attributes and attr_flags", () => {
  const id = LocalDefId.of(3 as never);
  const kept = parsed(AttributeKind.AutomaticallyDerived);
  const e = attrs_ecx([parsed(AttributeKind.Cold), unparsed(sym.allow), kept, doc_comment, kept], false);
  // the `lazy_array` must start at a non-zero position
  e.emit_u8(0xff);
  e.encode_attrs(id);
  const tables = e.tables as unknown as { attributes: { blocks: unknown[] }; attr_flags: { blocks: unknown[] } };
  // two attributes encoded (the kept ones), nothing else
  const expected = MemEncoder.new();
  expected.emit_u8(0xff);
  encode_Attribute(kept, expected as never);
  encode_Attribute(kept, expected as never);
  expect([...(e.opaque as unknown as MemEncoder).finish()]).toEqual([...expected.finish()]);
  expect(tables.attributes.blocks.length).toBe(4);
  // no #[doc(hidden)]: attr_flags is the default, so not set
  expect(tables.attr_flags.blocks.length).toBe(0);

  const e2 = attrs_ecx([doc_hidden()], false);
  e2.emit_u8(0xff);
  e2.encode_attrs(id);
  const t2 = e2.tables as unknown as { attr_flags: { blocks: Uint8Array[] } };
  expect(t2.attr_flags.blocks.length).toBe(4);
  expect(t2.attr_flags.blocks[3]![0]).toBe(AttrFlags.IS_DOC_HIDDEN);
});
