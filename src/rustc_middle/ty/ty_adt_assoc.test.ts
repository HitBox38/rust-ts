// Lane ty-adt-assoc: ty/adt.rs, ty/assoc.rs, ty/trait_def.rs, ty/closure.rs and rustc_data_structures
// sorted_map/index_map.rs. The upstream bodies over hand-built values (the pending ty/mod.rs types `VariantDef` /
// `FieldDef` and hir/place.rs `Place` are built as the `*View` shapes the port reads), plus the D2 interning of
// `AdtDef` the way `TyCtxt::mk_adt_def_from_data` will do it (keyed by `AdtDefData::hash`, i.e. by `did`).
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { HirId, ItemLocalId, OwnerId } from "../../rustc_hir_id/lib.ts";
import { CrateNum, DefId, DefIndex, LocalDefId } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok } from "../../std/result.ts";
import { SortedIndexMultiMap } from "../../rustc_data_structures/sorted_map/index_map.ts";
import { AdtDef, AdtDefData, AdtFlags, AdtKind, DataTypeKind_from_AdtKind, debug_AdtFlags, type FieldDefView, type VariantDefView } from "./adt.ts";
import { AssocItem, AssocItems, AssocKind, AssocTag, display_AssocKind } from "./assoc.ts";
import {
  analyze_coroutine_closure_captures,
  BorrowKind,
  CapturedPlace,
  debug_CaptureInfo,
  type HirProjectionKind,
  is_ancestor_or_same_capture,
  place_to_string_for_capture,
  UpvarCapture,
  UpvarId,
} from "./closure.ts";
import { CtxtInterners, TyCtxt } from "./context.ts";
import type { FieldIdx, HirPlace, ReprOptions, VariantDef, VariantIdx } from "./decls.ts";
import type { SimplifiedType } from "./fast_reject.ts";
import type { Ty } from "./mod.ts";
import { TraitImpls, debug_TraitImpls } from "./trait_def.ts";

const did = (i: number, krate = 0): DefId => new DefId(i as DefIndex, krate as CrateNum);

// ---- index_map.rs --------------------------------------------------------------------------------------------------

describe("SortedIndexMultiMap", () => {
  const cmp = (a: number, b: number): number => a - b;
  test("get_by_key yields equal keys in insertion order; indices are insertion indices", () => {
    const m = SortedIndexMultiMap.from_iter<number, number, string>(
      [
        [3, "a"],
        [1, "b"],
        [3, "c"],
        [2, "d"],
        [1, "e"],
      ],
      cmp,
    );
    expect(m.len()).toBe(5);
    expect(m.is_empty()).toBe(false);
    expect([...m.get_by_key(1)]).toEqual(["b", "e"]);
    expect([...m.get_by_key(3)]).toEqual(["a", "c"]);
    expect([...m.get_by_key_enumerated(3)]).toEqual([
      [0, "a"],
      [2, "c"],
    ]);
    expect([...m.get_by_key(4)]).toEqual([]);
    expect(m.contains_key(2)).toBe(true);
    expect(m.contains_key(0)).toBe(false);
    expect([...m.iter()].map(([, v]) => v)).toEqual(["a", "b", "c", "d", "e"]);
    expect(m.get(3)).toEqual([2, "d"]);
    expect(m.index(4)).toBe("e");
    expect(SortedIndexMultiMap.new<number, number, string>(cmp).is_empty()).toBe(true);
  });
});

// ---- assoc.rs ------------------------------------------------------------------------------------------------------

describe("AssocItem / AssocItems", () => {
  const fn_item = (i: number, name: Symbol, has_self: boolean): AssocItem => ({ def_id: did(i), kind: { $: "Fn", name, has_self }, container: { $: "Trait" } });
  const ty_item = (i: number, name: Symbol): AssocItem => ({ def_id: did(i), kind: { $: "Type", data: { $: "Normal", _0: name } }, container: { $: "InherentImpl" } });
  const ct_item = (i: number, name: Symbol): AssocItem => ({ def_id: did(i), kind: { $: "Const", name }, container: { $: "TraitImpl", _0: Ok(did(99)) } });
  const rpitit = (i: number): AssocItem => ({
    def_id: did(i),
    kind: { $: "Type", data: { $: "Rpitit", _0: {} as never } },
    container: { $: "TraitImpl", _0: Err({} as never) },
  });

  test("AssocItem accessors", () => {
    const m = fn_item(1, sym.clone, true);
    expect(AssocItem.opt_name(m)).toBe(sym.clone);
    expect(AssocItem.is_fn(m)).toBe(true);
    expect(AssocItem.is_method(m)).toBe(true);
    expect(AssocItem.is_method(fn_item(2, sym.clone, false))).toBe(false);
    expect(AssocItem.descr(m)).toBe("method");
    expect(AssocItem.descr(fn_item(2, sym.clone, false))).toBe("associated function");
    expect(AssocItem.namespace(m)).toBe("ValueNS");
    expect(AssocItem.as_def_kind(m)).toEqual({ $: "AssocFn" });
    expect(AssocItem.tag(m)).toBe("Fn");
    expect(AssocItem.trait_item_def_id(m)).toBeUndefined();
    expect(AssocItem.trait_item_or_self(m)).toEqual(Ok(did(1)));

    const c = ct_item(3, sym.clone);
    expect(AssocItem.trait_item_def_id(c)).toEqual(did(99));
    expect(AssocItem.expect_trait_impl(c)).toEqual(Ok(did(99)));
    expect(AssocItem.trait_item_or_self(c)).toEqual(Ok(did(99)));
    expect(AssocItem.descr(c)).toBe("associated constant");
    expect(AssocItem.as_def_kind(c)).toEqual({ $: "AssocConst" });

    const t = ty_item(4, sym.Item);
    expect(AssocItem.is_type(t)).toBe(true);
    expect(AssocItem.namespace(t)).toBe("TypeNS");
    expect(AssocItem.is_impl_trait_in_trait(t)).toBe(false);
    expect(() => AssocItem.expect_trait_impl(t)).toThrow("expected item to be in a trait impl");

    const r = rpitit(5);
    expect(AssocItem.opt_name(r)).toBeUndefined();
    expect(AssocItem.is_impl_trait_in_trait(r)).toBe(true);
    expect(AssocItem.trait_item_def_id(r)).toBeUndefined();
    expect(() => AssocItem.name(r)).toThrow("name of non-Rpitit assoc item");
  });

  test("AssocKind / AssocTag descr and Display", () => {
    expect(display_AssocKind({ $: "Fn", name: sym.clone, has_self: true })).toBe("method");
    expect(display_AssocKind({ $: "Type", data: { $: "Normal", _0: sym.Item } })).toBe("associated type");
    expect(AssocKind.tag({ $: "Const", name: sym.clone })).toBe("Const");
    expect(AssocTag.descr(AssocTag.Type)).toBe("associated type");
    expect(AssocTag.Fn).toBe("Fn");
  });

  test("AssocItems lookups by name keep definition order", () => {
    const items = [fn_item(1, sym.clone, true), ty_item(2, sym.Item), rpitit(3), ct_item(4, sym.clone), fn_item(5, sym.Item, false)];
    const assoc = AssocItems.new(items);
    expect(AssocItems.len(assoc)).toBe(5);
    expect([...AssocItems.in_definition_order(assoc)]).toEqual(items);
    expect([...AssocItems.filter_by_name_unhygienic(assoc, sym.clone)].map((i) => i.def_id)).toEqual([did(1), did(4)]);
    expect([...AssocItems.filter_by_name_unhygienic(assoc, sym.Item)].map((i) => i.def_id)).toEqual([did(2), did(5)]);
    expect([...AssocItems.filter_by_name_unhygienic_and_kind(assoc, sym.Item, "Fn")].map((i) => i.def_id)).toEqual([did(5)]);
    expect(() => AssocItems.filter_by_name_unhygienic(assoc, sym.empty)).toThrow("assertion failed: !name.is_empty()");
  });

  test("find_by_ident_and_kind / _namespace match hygienically through tcx", () => {
    const items = [fn_item(1, sym.clone, true), ct_item(2, sym.clone)];
    const assoc = AssocItems.new(items);
    const seen: DefId[] = [];
    const tcx = {
      def_ident_span: (d: DefId) => {
        seen.push(d);
        return DUMMY_SP;
      },
      hygienic_eq: (_a: Ident, _b: Ident, _p: DefId) => true,
    } as unknown as TyCtxt;
    const ident = Ident.new(sym.clone, DUMMY_SP);
    expect(AssocItems.find_by_ident_and_kind(assoc, tcx, ident, "Const", did(9))?.def_id).toEqual(did(2));
    // the tag filter runs before the (query-calling) hygiene check
    expect(seen).toEqual([did(2)]);
    expect(AssocItems.find_by_ident_and_namespace(assoc, tcx, ident, "ValueNS", did(9))?.def_id).toEqual(did(1));
    expect(AssocItems.find_by_ident_and_kind(assoc, tcx, ident, "Type", did(9))).toBeUndefined();
  });
});

// ---- adt.rs --------------------------------------------------------------------------------------------------------

function variant(def_id: DefId, discr: VariantDefView["discr"], nfields: number, ctor?: ["Fn" | "Const", DefId]): VariantDef {
  const fields: FieldDefView[] = [];
  for (let i = 0; i < nfields; i++) fields.push({ did: did(1000 + i), name: sym.integer(i), ty: () => ({}) as never });
  const v: VariantDefView = {
    def_id,
    ctor,
    name: sym.clone,
    discr,
    fields,
    ctor_kind: () => ctor?.[0],
    ctor_def_id: () => ctor?.[1],
    tail_opt: () => fields.at(-1),
  };
  return v as unknown as VariantDef;
}
const REPR = {} as ReprOptions;

describe("AdtFlags", () => {
  test("bitflags Debug (`to_writer`)", () => {
    expect(debug_AdtFlags(AdtFlags.union(AdtFlags.IS_STRUCT, AdtFlags.HAS_CTOR), PLAIN)).toBe("IS_STRUCT | HAS_CTOR");
    expect(debug_AdtFlags(AdtFlags.IS_MAYBE_DANGLING, PLAIN)).toBe("IS_MAYBE_DANGLING");
    expect(debug_AdtFlags(AdtFlags.NO_ADT_FLAGS, PLAIN)).toBe("");
  });
});

describe("AdtDef", () => {
  const enum_def = (): AdtDef =>
    new AdtDef(
      new AdtDefData(
        did(1),
        [
          variant(did(10), { $: "Relative", _0: 0 }, 0, ["Const", did(20)]),
          variant(did(11), { $: "Relative", _0: 1 }, 0, ["Const", did(21)]),
          variant(did(12), { $: "Explicit", _0: did(30) }, 0, ["Const", did(22)]),
          variant(did(13), { $: "Relative", _0: 1 }, 2, ["Fn", did(23)]),
          variant(did(14), { $: "Relative", _0: 2 }, 0),
        ],
        AdtFlags.union(AdtFlags.IS_ENUM, AdtFlags.IS_VARIANT_LIST_NON_EXHAUSTIVE),
        REPR,
      ),
    );

  test("kind predicates and descriptions", () => {
    const e = enum_def();
    expect(e.is_enum()).toBe(true);
    expect(e.is_struct()).toBe(false);
    expect(e.adt_kind()).toBe("Enum");
    expect(e.descr()).toBe("enum");
    expect(e.article()).toBe("an");
    expect(e.variant_descr()).toBe("variant");
    expect(e.is_variant_list_non_exhaustive()).toBe(true);
    expect(e.variant_list_has_applicable_non_exhaustive()).toBe(false); // local `did`
    expect(e.def_id()).toEqual(did(1));
    expect(e.variant_range()).toEqual({ start: 0 as VariantIdx, end: 5 as VariantIdx });
    expect(() => e.non_enum_variant()).toThrow("assertion failed: self.is_struct() || self.is_union()");
    expect(AdtKind.article("Union")).toBe("a");
    expect(DataTypeKind_from_AdtKind("Enum")).toBe("Enum");
  });

  test("variant lookups", () => {
    const e = enum_def();
    expect(e.variant_index_with_id(did(12))).toBe(2 as VariantIdx);
    expect(e.variant_index_with_ctor_id(did(23))).toBe(3 as VariantIdx);
    expect(e.variant_with_id(did(11))).toBe(e.variant(1 as VariantIdx));
    expect(e.variant_with_ctor_id(did(20))).toBe(e.variant(0 as VariantIdx));
    expect(() => e.variant_with_id(did(99))).toThrow("variant_with_id: unknown variant");
    expect(() => e.variant_index_with_ctor_id(did(99))).toThrow("variant_index_with_ctor_id: unknown variant");
    expect(e.variant_of_res({ $: "Def", _0: { $: "Variant" }, _1: did(13) })).toBe(e.variant(3 as VariantIdx));
    expect(e.variant_of_res({ $: "Def", _0: { $: "Ctor", _0: "Variant", _1: "Fn" }, _1: did(23) })).toBe(e.variant(3 as VariantIdx));
    expect(() => e.variant_of_res({ $: "Err" } as never)).toThrow("in variant_of_res");
    expect([...e.all_fields()].map((f) => f.did)).toEqual([did(1000), did(1001)]);
  });

  test("discriminant_def_for_variant walks back to the last explicit discriminant", () => {
    const e = enum_def();
    expect(e.discriminant_def_for_variant(0 as VariantIdx)).toEqual([undefined, 0]);
    expect(e.discriminant_def_for_variant(1 as VariantIdx)).toEqual([undefined, 1]);
    expect(e.discriminant_def_for_variant(2 as VariantIdx)).toEqual([did(30), 0]);
    expect(e.discriminant_def_for_variant(3 as VariantIdx)).toEqual([did(30), 1]);
    expect(e.discriminant_def_for_variant(4 as VariantIdx)).toEqual([did(30), 2]);
  });

  test("is_payloadfree", () => {
    // an explicit discriminant on a non-unit variant makes it not payload-free (#88621)
    const explicit_tuple = new AdtDef(new AdtDefData(did(2), [variant(did(10), { $: "Explicit", _0: did(31) }, 0, ["Fn", did(20)])], AdtFlags.IS_ENUM, REPR));
    expect(explicit_tuple.is_payloadfree()).toBe(false);
    const units = new AdtDef(new AdtDefData(did(3), [variant(did(10), { $: "Explicit", _0: did(31) }, 0, ["Const", did(20)])], AdtFlags.IS_ENUM, REPR));
    expect(units.is_payloadfree()).toBe(true);
    expect(enum_def().is_payloadfree()).toBe(false); // variant 3 has fields
    expect(new AdtDef(new AdtDefData(did(4), [], AdtFlags.IS_ENUM, REPR)).is_payloadfree()).toBe(true);
  });

  test("struct: non_enum_variant, has_ctor", () => {
    const s = new AdtDef(new AdtDefData(did(5), [variant(did(5), { $: "Relative", _0: 0 }, 1, ["Fn", did(6)])], AdtFlags.union(AdtFlags.IS_STRUCT, AdtFlags.HAS_CTOR), REPR));
    expect(s.is_struct()).toBe(true);
    expect(s.has_ctor()).toBe(true);
    expect(s.non_enum_variant()).toBe(s.variant(0 as VariantIdx));
    expect(s.variant_of_res({ $: "SelfCtor", _0: did(5) } as never)).toBe(s.variant(0 as VariantIdx));
    expect(s.descr()).toBe("struct");
    expect(s.article()).toBe("a");
  });

  test("AdtDefData: PartialEq and Hash only look at `did`; interning hash-conses per `did`", () => {
    const a = new AdtDefData(did(7), [], AdtFlags.IS_STRUCT, REPR);
    const b = new AdtDefData(did(7), [variant(did(7), { $: "Relative", _0: 0 }, 0)], AdtFlags.IS_UNION, REPR);
    const c = new AdtDefData(did(8), [], AdtFlags.IS_STRUCT, REPR);
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());
    // `direct_interners!` `mk_adt_def_from_data`, as root wires it in context.ts (handoff)
    const interners = CtxtInterners.new(undefined);
    const mk = (v: AdtDefData): AdtDef => interners.adt_def.intern(v, v.hash(), (v) => new AdtDef(v)) as AdtDef;
    const x = mk(a);
    expect(x).toBeInstanceOf(AdtDef);
    expect(mk(b)).toBe(x);
    expect(mk(c)).not.toBe(x);
    expect(Object.isFrozen(x)).toBe(true);
    expect(x.did()).toEqual(did(7));
  });

  test("AdtDefData::new computes the flags from attributes and lang items", () => {
    const fake = {
      hir_attrs: () => [{ $: "Parsed", _0: { $: "NonExhaustive", _0: DUMMY_SP } }],
      local_def_id_to_hir_id: () => ({}),
      as_lang_item: () => "ManuallyDrop",
    } as unknown as TyCtxt;
    const d = AdtDefData.new(fake, did(9), "Enum", [], REPR);
    expect(debug_AdtFlags(d.flags, PLAIN)).toBe("IS_ENUM | IS_MANUALLY_DROP | IS_VARIANT_LIST_NON_EXHAUSTIVE");
    const s = AdtDefData.new(fake, did(9), "Struct", [variant(did(9), { $: "Relative", _0: 0 }, 0, ["Const", did(10)])], REPR);
    // `#[non_exhaustive]` on a struct does not set the variant-list flag
    expect(debug_AdtFlags(s.flags, PLAIN)).toBe("IS_STRUCT | HAS_CTOR | IS_MANUALLY_DROP");
  });
});

// ---- trait_def.rs --------------------------------------------------------------------------------------------------

describe("TraitImpls / for_each_relevant_impl", () => {
  function impls(): TraitImpls {
    const t = TraitImpls.default_();
    t.blanket_impls.push(did(1));
    t.non_blanket_impls.set({ $: "Int", _0: "I32" } as SimplifiedType, [did(2), did(3)]);
    t.non_blanket_impls.set({ $: "Uint", _0: "U8" } as SimplifiedType, [did(4)]);
    t.non_blanket_impls.set({ $: "Bool" } as SimplifiedType, [did(5)]);
    return t;
  }
  function fake_tcx(t: TraitImpls): TyCtxt {
    return {
      trait_impls_of: () => t,
      for_each_blanket_impl: TyCtxt.prototype.for_each_blanket_impl,
      for_each_relevant_impl: TyCtxt.prototype.for_each_relevant_impl,
      all_impls: TyCtxt.prototype.all_impls,
    } as unknown as TyCtxt;
  }
  const ty_of = (kind: unknown): Ty => ({ kind: () => kind }) as unknown as Ty;

  test("TraitImpls basics", () => {
    expect(TraitImpls.is_empty(TraitImpls.default_())).toBe(true);
    const t = impls();
    expect(TraitImpls.is_empty(t)).toBe(false);
    expect(TraitImpls.blanket_impls(t)).toEqual([did(1)]);
    expect(debug_TraitImpls(TraitImpls.default_(), PLAIN)).toBe("TraitImpls { blanket_impls: [], non_blanket_impls: {} }");
  });

  test("an integer variable looks at every integer self type, then the blanket impls", () => {
    const tcx = fake_tcx(impls());
    const seen: DefId[] = [];
    const r = tcx.for_each_relevant_impl(did(0), ty_of({ $: "Infer", _0: { $: "IntVar", _0: 0 } }), (d) => void seen.push(d), VisitorResult.unit);
    expect(r).toBeUndefined();
    expect(seen).toEqual([did(2), did(3), did(4), did(1)]);
  });

  test("a type variable visits every non-blanket impl; ControlFlow::Break stops early", () => {
    const tcx = fake_tcx(impls());
    const seen: DefId[] = [];
    tcx.for_each_relevant_impl(did(0), ty_of({ $: "Infer", _0: { $: "TyVar", _0: 0 } }), (d) => void seen.push(d), VisitorResult.unit);
    expect(seen).toEqual([did(2), did(3), did(4), did(5), did(1)]);
    const cf = VisitorResult.ControlFlow<DefId>();
    const r = tcx.for_each_relevant_impl(did(0), ty_of({ $: "Infer", _0: { $: "TyVar", _0: 0 } }), (d) => (d.index === 3 ? ControlFlow.Break(d) : ControlFlow.CONTINUE), cf);
    expect(r).toEqual(ControlFlow.Break(did(3)));
  });

  test("params only see blanket impls; fresh types are a bug", () => {
    const tcx = fake_tcx(impls());
    const seen: DefId[] = [];
    tcx.for_each_relevant_impl(did(0), ty_of({ $: "Param", _0: {} }), (d) => void seen.push(d), VisitorResult.unit);
    expect(seen).toEqual([did(1)]);
    expect(() => tcx.for_each_relevant_impl(did(0), ty_of({ $: "Infer", _0: { $: "FreshTy", _0: 0 } }), () => undefined, VisitorResult.unit)).toThrow();
  });

  test("all_impls: blanket first, then the non-blanket impls in insertion order", () => {
    const tcx = fake_tcx(impls());
    expect([...tcx.all_impls(did(0))]).toEqual([did(1), did(2), did(3), did(4), did(5)]);
  });
});

// ---- closure.rs ----------------------------------------------------------------------------------------------------

describe("closure", () => {
  const hir = (owner: number, local: number): HirId => new HirId(new OwnerId(owner as LocalDefId), ItemLocalId.from_u32(local));

  test("UpvarCapture::partial_cmp and BorrowKind", () => {
    const by_ref = (k: BorrowKind): UpvarCapture => ({ $: "ByRef", _0: k });
    expect(UpvarCapture.partial_cmp(UpvarCapture.ByValue, UpvarCapture.ByValue)).toBe("Equal");
    expect(UpvarCapture.partial_cmp(UpvarCapture.ByUse, by_ref("Mutable"))).toBe("Greater");
    expect(UpvarCapture.partial_cmp(by_ref("Mutable"), UpvarCapture.ByValue)).toBe("Less");
    expect(UpvarCapture.partial_cmp(by_ref("Immutable"), by_ref("UniqueImmutable"))).toBe("Less");
    expect(UpvarCapture.partial_cmp(by_ref("Mutable"), by_ref("UniqueImmutable"))).toBe("Greater");
    expect(UpvarCapture.partial_cmp(UpvarCapture.ByUse, UpvarCapture.ByValue)).toBeUndefined();
    expect(BorrowKind.from_mutbl("Mut")).toBe("Mutable");
    expect(BorrowKind.to_mutbl_lossy("UniqueImmutable")).toBe("Mut");
    expect(BorrowKind.to_mutbl_lossy("Immutable")).toBe("Not");
  });

  test("is_ancestor_or_same_capture", () => {
    const f = (i: number): HirProjectionKind => ({ $: "Field", _0: i as FieldIdx, _1: 0 as VariantIdx });
    expect(is_ancestor_or_same_capture([f(0)], [f(0), f(1)])).toBe(true);
    expect(is_ancestor_or_same_capture([f(0), f(1)], [f(0), f(1)])).toBe(true);
    expect(is_ancestor_or_same_capture([f(0), f(0)], [f(0)])).toBe(false);
    expect(is_ancestor_or_same_capture([f(1)], [f(0), f(1)])).toBe(false);
    expect(is_ancestor_or_same_capture([{ $: "Deref" }], [{ $: "Deref" }, f(2)])).toBe(true);
  });

  test("CaptureInfo Debug", () => {
    create_default_session_globals_then(() => {
      expect(debug_CaptureInfo({ capture_kind_expr_id: undefined, path_expr_id: undefined, capture_kind: { $: "ByRef", _0: "Mutable" } }, PLAIN)).toBe(
        "CaptureInfo { capture_kind_expr_id: None, path_expr_id: None, capture_kind: ByRef(Mutable) }",
      );
    });
  });

  // a tuple-typed base so the field projections print by index
  const tuple_ty = { kind: () => ({ $: "Tuple", _0: [] }) } as unknown as Ty;
  const mk_place = (root: HirId, projs: HirProjectionKind[]): HirPlace =>
    ({
      base_ty: tuple_ty,
      base: { $: "Upvar", _0: UpvarId.new(root, 7 as LocalDefId) },
      projections: projs.map((kind) => ({ ty: tuple_ty, kind })),
      ty_before_projection: () => tuple_ty,
    }) as unknown as HirPlace;
  const field = (i: number): HirProjectionKind => ({ $: "Field", _0: i as FieldIdx, _1: 0 as VariantIdx });

  test("CapturedPlace::to_symbol / place_to_string_for_capture / roots", () => {
    create_default_session_globals_then(() => {
      const root = hir(1, 2);
      const p = new CapturedPlace(Ident.new(Symbol.intern("x"), DUMMY_SP), mk_place(root, [{ $: "Deref" }, field(1), field(0)]), { capture_kind_expr_id: undefined, path_expr_id: undefined, capture_kind: UpvarCapture.ByValue }, "Not");
      expect(Symbol.as_str(p.to_symbol())).toBe("x__1__0");
      expect(p.get_root_variable()).toBe(root);
      expect(p.get_closure_local_def_id()).toBe(7 as LocalDefId);
      expect(p.is_by_ref()).toBe(false);
      const tcx = { hir_name: () => Symbol.intern("x") } as unknown as TyCtxt;
      expect(place_to_string_for_capture(tcx, p.place)).toBe("*x.1.0");
      expect(p.to_string(tcx)).toBe("*x.1.0");
      const u = new CapturedPlace(Ident.new(Symbol.intern("y"), DUMMY_SP), mk_place(root, [{ $: "UnwrapUnsafeBinder" }]), { capture_kind_expr_id: undefined, path_expr_id: undefined, capture_kind: { $: "ByRef", _0: "Immutable" } }, "Not");
      expect(place_to_string_for_capture(tcx, u.place)).toBe("unwrap_binder!(x)");
      expect(Symbol.as_str(u.to_symbol())).toBe("y__unwrap");
      expect(u.is_by_ref()).toBe(true);
    });
  });

  test("analyze_coroutine_closure_captures pairs each parent with its prefix-matching children", () => {
    const info = { capture_kind_expr_id: undefined, path_expr_id: undefined, capture_kind: UpvarCapture.ByValue };
    const cap = (root: HirId, projs: HirProjectionKind[]): CapturedPlace => new CapturedPlace(Ident.new(sym.empty, DUMMY_SP), mk_place(root, projs), info, "Not");
    const a = hir(1, 1);
    const b = hir(1, 2);
    const parents = [cap(a, []), cap(b, [field(0)])];
    const children = [cap(a, [field(0)]), cap(a, [field(1)]), cap(b, [field(0), field(3)])];
    const pairs = [...analyze_coroutine_closure_captures(parents, children, ([pi], [ci]) => [pi, ci])];
    expect(pairs).toEqual([
      [0, 0],
      [0, 1],
      [1, 2],
    ]);
    // a parent without a matching child is a bug (the message formats the capture: hir/place.rs Debug is pending)
    expect(() => [...analyze_coroutine_closure_captures([cap(a, [])], [cap(b, [])], () => 0)]).toThrow();
  });
});

