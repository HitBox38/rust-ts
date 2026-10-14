// Lane ty-mod-b: ty/mod.rs:1102..end (TypingEnv, VariantDef / FieldDef, the `impl TyCtxt` helpers, SymbolName),
// checked against upstream's bodies with a `TyCtxt` whose queries are replaced per test.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import type { Constness } from "../../rustc_hir/lib.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import type { CrateNum } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Ident, sym } from "../../rustc_span/symbol.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import type { ParamEnv } from "./decls.ts";
import {
  debug_ImplOverlapKind,
  debug_VariantDiscr,
  debug_VariantFlags,
  debug_SymbolName,
  display_SymbolName,
  key_VariantDef,
  SymbolName,
  TypingEnv,
  VariantDef,
  VariantDef_eq,
  VariantFlags,
} from "./mod.ts";

const did = (index: number, krate: number = LOCAL_CRATE as number): DefId => new DefId(DefIndex.from_u32(index), krate as CrateNum);

/** A `TyCtxt` whose listed methods / queries are the given functions (own properties shadow the prototype). */
function mk_tcx(overrides: Record<string, unknown> = {}): TyCtxt {
  const gcx = { interners: CtxtInterners.new(undefined) };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  return Object.assign(tcx, overrides);
}

function expect_panic(f: () => unknown, msg: string): void {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(Panic);
    expect((e as Panic).message).toContain(msg);
    return;
  }
  throw new Error("expected a panic");
}

describe("VariantDef", () => {
  test("new: def_id falls back to parent_did; flags from is_field_list_non_exhaustive", () => {
    const v = VariantDef.new(sym.main, undefined, ["Fn", did(7)], { $: "Relative", _0: 0 }, [], did(5), undefined, true);
    expect(v.def_id.index as number).toBe(5);
    expect(v.flags).toBe(VariantFlags.IS_FIELD_LIST_NON_EXHAUSTIVE);
    expect(v.is_field_list_non_exhaustive()).toBe(true);
    // local: not applicable
    expect(v.field_list_has_applicable_non_exhaustive()).toBe(false);
    expect(v.ctor_kind()).toBe("Fn");
    expect(v.ctor_def_id()!.index as number).toBe(7);
    expect(v.has_errors()).toEqual({ $: "Ok", _0: null });

    const ext = VariantDef.new(sym.main, did(3, 2), undefined, { $: "Relative", _0: 1 }, [], did(1, 2), undefined, true);
    expect(ext.def_id.index as number).toBe(3);
    expect(ext.field_list_has_applicable_non_exhaustive()).toBe(true);
    expect(ext.ctor_kind()).toBeUndefined();
    expect(ext.ctor_def_id()).toBeUndefined();

    const plain = VariantDef.new(sym.main, undefined, undefined, { $: "Relative", _0: 0 }, [], did(1), undefined, false);
    expect(plain.flags).toBe(VariantFlags.NO_VARIANT_FLAGS);
    expect(plain.is_field_list_non_exhaustive()).toBe(false);
  });

  test("has_errors / single_field / tail on an empty variant", () => {
    const g = new (ErrorGuaranteed as unknown as new () => ErrorGuaranteed)();
    const v = VariantDef.new(sym.main, undefined, undefined, { $: "Relative", _0: 0 }, [], did(1), g, false);
    expect(v.has_errors()).toEqual({ $: "Err", _0: g });
    expect(v.tail_opt()).toBeUndefined();
    expect_panic(() => v.tail(), "expected unsized ADT to have a tail field");
    expect_panic(() => v.single_field(), "assertion failed: self.fields.len() == 1");
    expect(v.has_unsafe_fields()).toBe(false);
  });

  test("PartialEq / Hash look at the def_id only", () => {
    const a = VariantDef.new(sym.main, did(4), undefined, { $: "Relative", _0: 0 }, [], did(1), undefined, false);
    const b = VariantDef.new(sym.test, did(4), ["Const", did(9)], { $: "Relative", _0: 2 }, [], did(2), undefined, true);
    const c = VariantDef.new(sym.main, did(5), undefined, { $: "Relative", _0: 0 }, [], did(1), undefined, false);
    expect(VariantDef_eq(a, b)).toBe(true);
    expect(VariantDef_eq(a, c)).toBe(false);
    expect(key_VariantDef(a)).toBe(key_VariantDef(b));
    expect(key_VariantDef(a)).not.toBe(key_VariantDef(c));
  });

  test("Debug of VariantFlags (bitflags to_writer), VariantDiscr, ImplOverlapKind", () => {
    expect(debug_VariantFlags(VariantFlags.NO_VARIANT_FLAGS, PLAIN)).toBe("");
    expect(debug_VariantFlags(VariantFlags.IS_FIELD_LIST_NON_EXHAUSTIVE, PLAIN)).toBe("IS_FIELD_LIST_NON_EXHAUSTIVE");
    expect(debug_VariantDiscr({ $: "Relative", _0: 3 }, PLAIN)).toBe("Relative(3)");
    expect(debug_ImplOverlapKind({ $: "Permitted", marker: true }, PLAIN)).toBe("Permitted { marker: true }");
    expect(debug_ImplOverlapKind({ $: "Permitted", marker: false }, PRETTY)).toBe("Permitted {\n    marker: false,\n}");
  });
});

describe("TypingEnv", () => {
  const pe = { caller_bounds: "pe" } as unknown as ParamEnv;

  test("new / typing_mode / as_query_input", () => {
    const env = TypingEnv.new(pe, TypingMode.PostAnalysis);
    expect(env.typing_mode()).toBe(TypingMode.PostAnalysis);
    expect(env.param_env).toBe(pe);
    const q = env.as_query_input(42);
    expect(q.typing_env).toBe(env);
    expect(q.value).toBe(42);
  });

  test("with_*_normalized return self when already revealing", () => {
    const tcx = mk_tcx();
    const pa = TypingEnv.new(pe, TypingMode.PostAnalysis);
    const cg = TypingEnv.new(pe, TypingMode.Codegen);
    expect(pa.with_post_analysis_normalized(tcx)).toBe(pa);
    expect(cg.with_post_analysis_normalized(tcx)).toBe(cg);
    expect(cg.with_codegen_normalized(tcx)).toBe(cg);
    // otherwise `ParamEnv::with_normalized` runs (lane ty-mod-a: a stand-in for now)
    expect(() => pa.with_codegen_normalized(tcx)).toThrow(Unported);
    expect(() => TypingEnv.new(pe, TypingMode.Coherence).with_post_analysis_normalized(tcx)).toThrow(Unported);
  });

  test("non_body_analysis reads the param_env query", () => {
    const seen: DefId[] = [];
    const tcx = mk_tcx({ param_env: (d: DefId) => (seen.push(d), pe) });
    const env = TypingEnv.non_body_analysis(tcx, did(3));
    expect(env.param_env).toBe(pe);
    expect(env.typing_mode()).toEqual(TypingMode.non_body_analysis());
    expect(seen.map((d) => d.index as number)).toEqual([3]);
  });
});

describe("impl TyCtxt", () => {
  // DefIds: 1 trait, 2 inherent impl, 3 trait impl, 4 fn in trait, 5 fn in inherent impl, 6 fn in trait impl, 7 mod
  const kinds: Record<number, DefKind> = {
    1: { $: "Trait" },
    2: { $: "Impl", of_trait: false },
    3: { $: "Impl", of_trait: true },
    4: { $: "AssocFn" },
    5: { $: "AssocFn" },
    6: { $: "AssocFn" },
    7: { $: "Mod" },
  };
  const parents: Record<number, number> = { 4: 1, 5: 2, 6: 3 };
  const tcx = mk_tcx({
    def_kind: (d: DefId) => kinds[d.index as number],
    parent: (d: DefId) => did(parents[d.index as number]!),
  });

  test("assoc_parent / trait_of_assoc / impl_of_assoc / inherent_impl_of_assoc / trait_impl_of_assoc", () => {
    expect(tcx.assoc_parent(did(7))).toBeUndefined();
    const [p, k] = tcx.assoc_parent(did(4))!;
    expect([p.index as number, k]).toEqual([1, { $: "Trait" }]);
    const idx = (d: DefId | undefined): number | undefined => (d === undefined ? undefined : (d.index as number));
    expect([4, 5, 6].map((i) => idx(tcx.trait_of_assoc(did(i))))).toEqual([1, undefined, undefined]);
    expect([4, 5, 6].map((i) => idx(tcx.impl_of_assoc(did(i))))).toEqual([undefined, 2, 3]);
    expect([4, 5, 6].map((i) => idx(tcx.inherent_impl_of_assoc(did(i))))).toEqual([undefined, 2, undefined]);
    expect([4, 5, 6].map((i) => idx(tcx.trait_impl_of_assoc(did(i))))).toEqual([undefined, undefined, 3]);
  });

  test("impl_is_of_trait panics on a non-impl; trait_is_alias; span_of_impl", () => {
    expect(tcx.impl_is_of_trait(did(2))).toBe(false);
    expect(tcx.impl_is_of_trait(did(3))).toBe(true);
    expect_panic(() => tcx.impl_is_of_trait(did(7)), "expected Impl for");
    expect(tcx.trait_is_alias(did(1))).toBe(false);
    const t2 = mk_tcx({ def_span: () => DUMMY_SP, crate_name: () => sym.core });
    expect(t2.span_of_impl(did(3))).toEqual({ $: "Ok", _0: DUMMY_SP });
    expect(t2.span_of_impl(did(3, 2))).toEqual({ $: "Err", _0: sym.core });
  });

  test("is_const_fn / is_conditionally_const read constness by def kind", () => {
    const constness: Record<number, Constness> = {
      10: { $: "Const", always: false },
      11: { $: "Const", always: true },
      12: { $: "NotConst" },
    };
    const t = mk_tcx({
      def_kind: (d: DefId): DefKind => ((d.index as number) === 13 ? { $: "Mod" } : { $: "Fn" }),
      constness: (d: DefId) => constness[d.index as number],
    });
    expect([10, 11, 12, 13].map((i) => t.is_const_fn(did(i)))).toEqual([true, true, false, false]);
    expect([10, 11, 12, 13].map((i) => t.is_conditionally_const(did(i)))).toEqual([true, false, false, false]);
  });

  test("hygienic_eq compares names before contexts", () => {
    // different names: false without asking for the expansion
    const t = mk_tcx({ expn_that_defined: () => { throw new Error("must not be called"); } });
    expect(t.hygienic_eq(new Ident(sym.main, DUMMY_SP), new Ident(sym.test, DUMMY_SP), did(1))).toBe(false);
  });

  test("repr_options_of_def stops UNPORTED (rustc_abi ReprOptions)", () => {
    expect(() => tcx.repr_options_of_def(DefIndex.from_u32(1) as never)).toThrow(Unported);
  });
});

describe("SymbolName", () => {
  test("Display and Debug print the name", () => {
    const s = SymbolName.new(mk_tcx(), "_ZN4core3foo17h0123456789abcdefE");
    expect(display_SymbolName(s)).toBe("_ZN4core3foo17h0123456789abcdefE");
    expect(debug_SymbolName(s, PLAIN)).toBe("_ZN4core3foo17h0123456789abcdefE");
  });
});
