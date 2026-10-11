// Focused tests for hygiene.ts / def_id.ts (upstream has no unit tests for these files).
import { expect, test } from "bun:test";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import {
  CRATE_DEF_ID,
  CRATE_DEF_INDEX,
  CrateNum,
  DEF_ID_DEBUG,
  DefId,
  DefIndex,
  DefPathHash,
  debug_CrateNum,
  debug_DefId,
  debug_DefIndex,
  debug_DefPathHash,
  debug_LocalDefId,
  debug_LocalModId,
  display_CrateNum,
  Fingerprint,
  Hash64,
  LOCAL_CRATE,
  LocalDefId,
  LocalModId,
  StableCrateId,
} from "./def_id.ts";
import { DUMMY_SP } from "./span_encoding.ts";
import { kw } from "./symbol.ts";
import {
  DesugaringKind,
  ExpnData,
  ExpnHash,
  ExpnId,
  ExpnId_eq,
  ExpnKind,
  HygieneData,
  LocalExpnId,
  MacroKind,
  SyntaxContext,
  Transparency,
  debug_DesugaringKind,
  debug_ExpnHash,
  debug_ExpnId,
  debug_ExpnIndex,
  debug_LocalExpnId,
  debug_SyntaxContext,
  ExpnIndex,
} from "./hygiene.ts";

test("SyntaxContext root Debug", () => {
  expect(debug_SyntaxContext(SyntaxContext.root(), PLAIN)).toBe("#0");
  expect(debug_SyntaxContext(SyntaxContext.from_u32(17), PRETTY)).toBe("#17");
  expect(SyntaxContext.is_root(SyntaxContext.root())).toBe(true);
  expect(SyntaxContext.is_root(SyntaxContext.from_u16(1))).toBe(false);
  // root fast paths do not touch HygieneData
  expect(SyntaxContext.normalize_to_macros_2_0(SyntaxContext.root())).toBe(SyntaxContext.root());
  expect(SyntaxContext.normalize_to_macro_rules(SyntaxContext.root())).toBe(SyntaxContext.root());
});

test("ExpnId::root and index Debug formats", () => {
  const root = ExpnId.root();
  expect(root.krate).toBe(LOCAL_CRATE);
  expect(root.local_id).toBe(ExpnIndex.ZERO);
  expect(debug_ExpnId(root, PLAIN)).toBe("crate0::{{expn0}}");
  expect(debug_ExpnId(new ExpnId(CrateNum.new(3), ExpnIndex.from_u32(42)), PRETTY)).toBe("crate3::{{expn42}}");
  expect(debug_LocalExpnId(LocalExpnId.ROOT, PLAIN)).toBe("expn0");
  expect(debug_ExpnIndex(ExpnIndex.from_u32(7), PLAIN)).toBe("7");
  expect(root.as_local()).toBe(LocalExpnId.ROOT);
  expect(ExpnId_eq(LocalExpnId.to_expn_id(LocalExpnId.ROOT), root)).toBe(true);
  expect(root.is_descendant_of(ExpnId.root())).toBe(true);
  expect(debug_ExpnHash(ExpnHash.of(Fingerprint.ZERO), PLAIN)).toBe("ExpnHash(Fingerprint(0, 0))");
  expect(ExpnHash.is_root(ExpnHash.of(Fingerprint.ZERO))).toBe(true);
});

test("HygieneData::new initial state", () => {
  const data = HygieneData.new("Edition2021");
  expect(data.local_expn_data.length).toBe(1);
  const root = data.local_expn_data[0]!;
  expect(root.kind).toBe(ExpnKind.Root);
  expect(root.is_root()).toBe(true);
  expect(ExpnId_eq(root.parent, ExpnId.root())).toBe(true);
  expect(root.call_site).toBe(DUMMY_SP);
  expect(root.def_site).toBe(DUMMY_SP);
  expect(root.edition).toBe("Edition2021");
  expect(debug_DefId(root.macro_def_id!, PLAIN)).toBe("DefId { krate: crate0, index: DefIndex(0) }");
  expect(root.parent_module).toBeUndefined();
  expect(root.disambiguator).toBe(0);
  expect(data.local_expn_hashes).toEqual([ExpnHash.of(Fingerprint.ZERO)]);
  expect(ExpnId_eq(data.expn_hash_to_expn_id.get(ExpnHash.of(Fingerprint.ZERO))!, ExpnId.root())).toBe(true);
  expect(data.syntax_context_data.length).toBe(1);
  const sc = data.syntax_context_data[0]!;
  expect(sc.parent).toBe(SyntaxContext.root());
  expect(sc.opaque).toBe(SyntaxContext.root());
  expect(sc.opaque_and_semiopaque).toBe(SyntaxContext.root());
  expect(sc.outer_transparency).toBe("Opaque");
  expect(sc.dollar_crate_name).toBe(kw.DollarCrate);
  expect(data.syntax_context_map.get([SyntaxContext.root(), ExpnId.root(), "Opaque"])).toBe(SyntaxContext.root());
  expect(data.expn_data_disambiguators.size).toBe(0);
  expect(data.marks(SyntaxContext.root())).toEqual([]);
});

test("alloc_ctxt / marks / normalization on a local HygieneData", () => {
  const data = HygieneData.new("Edition2024");
  // Register two expansions directly (fresh() needs StableHasher).
  const mk = () => ExpnData.default({ $: "Macro", _0: MacroKind.Bang, _1: kw.DollarCrate }, DUMMY_SP, "Edition2024", undefined, undefined);
  data.local_expn_data.push(mk(), mk());
  const e1 = LocalExpnId.to_expn_id(LocalExpnId.from_u32(1));
  const e2 = LocalExpnId.to_expn_id(LocalExpnId.from_u32(2));

  // Opaque mark: ctxt #1, opaque == opaque_and_semiopaque == itself.
  const c1 = data.apply_mark(SyntaxContext.root(), e1, Transparency.Opaque);
  expect(c1).toBe(SyntaxContext.from_u32(1));
  expect(data.normalize_to_macros_2_0(c1)).toBe(c1);
  expect(data.normalize_to_macro_rules(c1)).toBe(c1);
  // Cached on second request.
  expect(data.alloc_ctxt(SyntaxContext.root(), e1, Transparency.Opaque)).toBe(c1);

  // Transparent mark on top: normalizes back to c1.
  const c2 = data.alloc_ctxt(c1, e2, Transparency.Transparent);
  expect(c2).toBe(SyntaxContext.from_u32(2));
  expect(data.normalize_to_macros_2_0(c2)).toBe(c1);
  expect(data.normalize_to_macro_rules(c2)).toBe(c1);

  // SemiOpaque on root: opaque = root, opaque_and_semiopaque = itself.
  const c3 = data.alloc_ctxt(SyntaxContext.root(), e2, Transparency.SemiOpaque);
  expect(data.normalize_to_macros_2_0(c3)).toBe(SyntaxContext.root());
  expect(data.normalize_to_macro_rules(c3)).toBe(c3);

  const marks = data.marks(c2);
  expect(marks.map(([e, t]) => `${debug_ExpnId(e, PLAIN)} ${t}`)).toEqual(["crate0::{{expn1}} Opaque", "crate0::{{expn2}} Transparent"]);

  const r = { value: c2 };
  expect(ExpnId_eq(data.remove_mark(r)[0], e2)).toBe(true);
  expect(r.value).toBe(c1);

  // Neither expansion descends from the other (both have the root as parent).
  expect(data.is_descendant_of(e2, e1)).toBe(false);
  expect(data.is_descendant_of(e2, ExpnId.root())).toBe(true);
  const a = { value: c2 };
  expect(data.adjust(a, e2)).toBeUndefined();
  expect(a.value).toBe(c2);
  // e1 does not descend from e2, so the e2 mark is removed and becomes the scope.
  const scope = data.adjust(a, e1);
  expect(ExpnId_eq(scope!, e2)).toBe(true);
  expect(a.value).toBe(c1);
});

test("ExpnKind / MacroKind / DesugaringKind helpers", () => {
  expect(MacroKind.descr("Bang")).toBe("macro");
  expect(MacroKind.descr_expected("Attr")).toBe("attribute");
  expect(MacroKind.article("Attr")).toBe("an");
  expect(DesugaringKind.descr({ $: "FormatLiteral", source: false })).toBe("expression that expanded into a format string literal");
  expect(DesugaringKind.matches(DesugaringKind.ForLoop, "ForLoop")).toBe(true);
  expect(debug_DesugaringKind({ $: "FormatLiteral", source: true }, PLAIN)).toBe("FormatLiteral { source: true }");
  expect(ExpnKind.descr({ $: "Desugaring", _0: DesugaringKind.QuestionMark })).toBe("desugaring of operator `?`");
  expect(Transparency.fallback(true)).toBe("SemiOpaque");
});

test("DefId / CrateNum / DefIndex Debug formats", () => {
  expect(debug_CrateNum(LOCAL_CRATE, PLAIN)).toBe("crate0");
  expect(display_CrateNum(CrateNum.new(12))).toBe("12");
  expect(debug_DefIndex(CRATE_DEF_INDEX, PLAIN)).toBe("DefIndex(0)");
  const d = new DefId(DefIndex.from_u32(5), CrateNum.new(2));
  expect(debug_DefId(d, PLAIN)).toBe("DefId { krate: crate2, index: DefIndex(5) }");
  expect(debug_DefId(d, PRETTY)).toBe("DefId {\n    krate: crate2,\n    index: DefIndex(5),\n}");
  expect(debug_LocalDefId(CRATE_DEF_ID, PLAIN)).toBe("DefId { krate: crate0, index: DefIndex(0) }");
  expect(debug_LocalModId(LocalModId.new_unchecked(CRATE_DEF_ID), PLAIN)).toBe("LocalModId(DefId { krate: crate0, index: DefIndex(0) })");
  expect(LocalDefId.is_top_level_module(CRATE_DEF_ID)).toBe(true);
  expect(d.is_local()).toBe(false);
  expect(() => d.expect_local()).toThrow("DefId::expect_local: `DefId { krate: crate2, index: DefIndex(5) }` isn't local");
  expect(DefId.local(DefIndex.from_u32(5)).as_local()).toBe(LocalDefId.new(5));
  expect(DefId.from_raw_def_id(d.to_raw_def_id()).krate).toBe(CrateNum.new(2));
  expect(() => DefIndex.from_u32(0xffff_ff01)).toThrow();
  expect(DefIndex.MAX).toBe(DefIndex.from_u32(0xffff_ff00));
  const h = DefPathHash.new(StableCrateId.of(Hash64.new(1n)), Hash64.new(2n));
  expect(debug_DefPathHash(h, PLAIN)).toBe("DefPathHash(Fingerprint(1, 2))");
  expect(DefPathHash.stable_crate_id(h)).toBe(StableCrateId.of(Hash64.new(1n)));
});

test("DEF_ID_DEBUG hook", () => {
  const old = DEF_ID_DEBUG.swap((def_id) => `hooked(${def_id.index})`);
  try {
    expect(debug_DefId(DefId.local(CRATE_DEF_INDEX), PLAIN)).toBe("hooked(0)");
    expect(debug_LocalDefId(CRATE_DEF_ID, PLAIN)).toBe("hooked(0)");
  } finally {
    DEF_ID_DEBUG.swap(old);
  }
  expect(debug_DefId(DefId.local(CRATE_DEF_INDEX), PLAIN)).toBe("DefId { krate: crate0, index: DefIndex(0) }");
});
