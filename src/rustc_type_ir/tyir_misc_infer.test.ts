// Lane tyir-misc, sub-lane infer: infer_ctxt.rs (`TypingMode` and its methods, `TypingModeEqWrapper`'s manual
// `PartialEq` / `Hash`), canonical.rs (`Canonical`, `CanonicalVarKind`, `CanonicalVarValues`) and fast_reject.rs
// (`simplify_type`, `DeepRejectCtxt`).
//
// The oracle strings / booleans below were printed by the pinned nightly (rustc 1.101.0-nightly 6f5da406b) through a
// throwaway rustc-dev program (`after_expansion` callback building the same values with rustc's own `TyCtxt`, printing
// them with `{:?}` / `{:#?}` / `{}`; described in the tyir-misc handoff, "infer" probe). Lines are copied verbatim.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type List, RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, debug_DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import { debug_option, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import type { BoundVar, UniverseIndex as UniverseIndexT } from "./decls.ts";
import {
  Canonical,
  CanonicalVarKind,
  CanonicalVarValues,
  CanonicalizerState,
  debug_CanonicalVarKind,
  display_Canonical,
} from "./canonical.ts";
import { DeepRejectCtxt, debug_SimplifiedType, simplify_type, type SimplifiedType, type TreatParams } from "./fast_reject.ts";
import {
  debug_MayBeErased,
  debug_TypingMode,
  debug_TypingModeEqWrapper,
  hash_TypingMode,
  MayBeErased,
  TypingMode,
  TypingModeEqWrapper,
  TypingModeEqWrapper_eq,
} from "./infer_ctxt.ts";
import type { Interner } from "./interner.ts";
import { FnHeader, type FloatVid, type IntVid } from "./ty_kind.ts";

// `impl inherent::Tys for &List<Ty>` (rustc_middle ty/sty.rs:2180, lane ty-sty) is not ported yet; `simplify_type`'s
// `FnPtr` arm needs `inputs()`, so these tests provide upstream's one-liner (`split_last().unwrap().1`), as
// tyir_kind.test.ts does.
const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies.push(spyOn(RawList.prototype as unknown as { inputs(): readonly Ty[] }, "inputs").mockImplementation(function (this: readonly Ty[]) {
    return this.slice(0, this.length - 1);
  }));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

/** A `TyCtxt` over a fresh `CtxtInterners` (as in rustc_middle/ty/interning.test.ts). */
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

const guar = ErrorGuaranteed.unchecked_error_guaranteed();
const U = (n: number) => n as UniverseIndexT;
const BV = (n: number) => n as BoundVar;

/** Records the `Hasher` calls (`write_isize` / `write_usize`) of a `Hash` impl. */
function hash_calls(f: (h: { write_isize(i: number): void; write_usize(i: number): void }) => void): string[] {
  const calls: string[] = [];
  f({ write_isize: (i) => calls.push(`isize ${i}`), write_usize: (i) => calls.push(`usize ${i}`) });
  return calls;
}

describe("TypingMode (infer_ctxt.rs)", () => {
  const modes: [string, TypingMode][] = [
    ["Coherence", TypingMode.Coherence],
    ["non_body_analysis", TypingMode.non_body_analysis()],
    ["Reflection", TypingMode.Reflection],
    ["PostAnalysis", TypingMode.PostAnalysis],
    ["Codegen", TypingMode.Codegen],
    ["Erased", { $: "ErasedNotCoherence", _0: MayBeErased }],
  ];

  test("Debug of the variants without a list matches the oracle", () => {
    const dbg = (m: TypingMode, pretty: boolean) =>
      format_debug(m, (v, f) => debug_TypingMode(v, f, debug_MayBeErased), pretty ? PRETTY : PLAIN);
    const got: string[] = [];
    for (const [n, m] of modes) {
      if (n === "non_body_analysis") continue; // `I::LocalDefIds` has no Debug in the generated code (report)
      got.push(`TypingMode ${n} ${dbg(m, false)}`);
      got.push(`TypingMode# ${n} ${dbg(m, true)}`);
      got.push(`TMW ${n} ${format_debug({ _0: m }, debug_TypingModeEqWrapper, PLAIN)}`);
    }
    expect(got.join("\n")).toBe(
      [
        "TypingMode Coherence Coherence",
        "TypingMode# Coherence Coherence",
        "TMW Coherence TypingModeEqWrapper(Coherence)",
        "TypingMode Reflection Reflection",
        "TypingMode# Reflection Reflection",
        "TMW Reflection TypingModeEqWrapper(Reflection)",
        "TypingMode PostAnalysis PostAnalysis",
        "TypingMode# PostAnalysis PostAnalysis",
        "TMW PostAnalysis TypingModeEqWrapper(PostAnalysis)",
        "TypingMode Codegen Codegen",
        "TypingMode# Codegen Codegen",
        "TMW Codegen TypingModeEqWrapper(Codegen)",
        "TypingMode Erased ErasedNotCoherence(MayBeErased)",
        "TypingMode# Erased ErasedNotCoherence(\n    MayBeErased,\n)",
        "TMW Erased TypingModeEqWrapper(ErasedNotCoherence(MayBeErased))",
      ].join("\n"),
    );
  });

  test("is_coherence / is_reflection / is_erased_not_coherence and TypingModeEqWrapper::eq match the oracle", () => {
    const preds = modes.map(([n, m]) => `TMpreds ${n} ${TypingMode.is_coherence(m)} ${TypingMode.is_reflection(m)} ${TypingMode.is_erased_not_coherence(m)}`);
    expect(preds).toEqual([
      "TMpreds Coherence true false false",
      "TMpreds non_body_analysis false false false",
      "TMpreds Reflection false true false",
      "TMpreds PostAnalysis false false false",
      "TMpreds Codegen false false false",
      "TMpreds Erased false false true",
    ]);
    let row = "";
    for (const [, a] of modes) {
      for (const [, b] of modes) row += TypingModeEqWrapper_eq({ _0: a }, { _0: b }) ? "1" : "0";
      row += " ";
    }
    expect(`TMEq ${row}`).toBe("TMEq 100000 010000 001000 000100 000010 000001 ");
    // Lists compare by identity (interned): a different list is a different typing mode.
    const tcx = mk_tcx();
    const other: TypingMode = { $: "Typeck", defining_opaque_types_and_generators: tcx.mk_local_def_ids([0 as LocalDefId]) };
    expect(TypingModeEqWrapper_eq({ _0: other }, { _0: TypingMode.non_body_analysis() })).toBe(false);
    expect(TypingModeEqWrapper_eq({ _0: other }, { _0: { ...other } })).toBe(true);
  });

  test("TypingModeEqWrapper::hash agrees with its PartialEq (derived Hash of TypingMode)", () => {
    for (const [, a] of modes) {
      for (const [, b] of modes) {
        const ha = hash_calls((h) => TypingModeEqWrapper.hash({ _0: a }, h));
        const hb = hash_calls((h) => TypingModeEqWrapper.hash({ _0: b }, h));
        expect(TypingModeEqWrapper_eq({ _0: a }, { _0: b })).toBe(ha.join() === hb.join());
      }
    }
    expect(hash_calls((h) => hash_TypingMode(TypingMode.Codegen, h))).toEqual(["isize 6"]);
    const nba = TypingMode.non_body_analysis();
    expect(hash_calls((h) => hash_TypingMode(nba, h))).toEqual(["isize 1", `usize ${RawList.empty<LocalDefId>().id}`]);
  });

  test("assert_not_erased / From<TypingMode<CantBeErased>> keep every variant; ErasedNotCoherence is an ICE", () => {
    for (const [n, m] of modes) {
      if (n === "Erased") {
        expect(() => TypingMode.assert_not_erased(m)).toThrow(
          "Called `assert_not_erased` from a place that can be called by the trait solver in `TypingMode::ErasedNotCoherence`. `TypingMode` is `ErasedNotCoherence` in a place where that should be impossible",
        );
      } else {
        const back = TypingMode.from_TypingMode(TypingMode.assert_not_erased(m));
        expect(TypingModeEqWrapper_eq({ _0: back }, { _0: m })).toBe(true);
      }
    }
  });

  test("borrowck / post_borrowck_analysis fall back to non_body_analysis without opaques", () => {
    const tcx = mk_tcx();
    const some = tcx.mk_local_def_ids([3 as LocalDefId]);
    const cx_with = (l: List<LocalDefId>) => ({ opaque_types_defined_by: () => l, opaque_types_and_coroutines_defined_by: () => l }) as unknown as Interner;
    const empty = RawList.empty<LocalDefId>();
    const body = 7 as LocalDefId;
    expect(TypingMode.borrowck(cx_with(empty), body)).toEqual({ $: "Typeck", defining_opaque_types_and_generators: empty });
    expect(TypingMode.borrowck(cx_with(some), body)).toEqual({ $: "PostTypeckUntilBorrowck", defining_opaque_types: some });
    expect(TypingMode.post_borrowck_analysis(cx_with(empty), body)).toEqual({ $: "Typeck", defining_opaque_types_and_generators: empty });
    expect(TypingMode.post_borrowck_analysis(cx_with(some), body)).toEqual({ $: "PostBorrowck", defined_opaque_types: some });
    expect(TypingMode.typeck_for_body(cx_with(some), body)).toEqual({ $: "Typeck", defining_opaque_types_and_generators: some });
    expect(TypingMode.analysis_in_body(cx_with(some), body)).toEqual({ $: "Typeck", defining_opaque_types_and_generators: some });
  });
});

describe("canonical.rs", () => {
  const cvks: CanonicalVarKind[] = [
    { $: "Ty", ui: U(1), sub_root: BV(0) },
    CanonicalVarKind.Int,
    CanonicalVarKind.Float,
    { $: "Region", _0: U(0) },
    { $: "Const", _0: U(2) },
    { $: "PlaceholderTy", _0: { universe: U(3), bound: { var: BV(4), kind: { $: "Anon" } }, _tcx: undefined } },
    { $: "PlaceholderRegion", _0: { universe: U(1), bound: { var: BV(2), kind: { $: "Anon" } }, _tcx: undefined } },
    { $: "PlaceholderConst", _0: { universe: U(2), bound: { var: BV(5), _tcx: undefined }, _tcx: undefined } },
  ];

  test("CanonicalVarKind Debug and methods match the oracle", () => {
    const got: string[] = [];
    for (const k of cvks) {
      const placeholder = !CanonicalVarKind.is_existential(k);
      // The placeholder variants print through `impl Debug for Placeholder` (binder.rs, lane tyir-binder).
      if (!placeholder) {
        got.push(`CVK ${format_debug(k, debug_CanonicalVarKind, PLAIN)}`);
        got.push(`CVK# ${format_debug(k, debug_CanonicalVarKind, PRETTY)}`);
      }
      got.push(`CVKpreds U${CanonicalVarKind.universe(k)} ${CanonicalVarKind.is_existential(k)} ${CanonicalVarKind.is_region(k)}`);
      if (placeholder) {
        got.push(`CVKidx ${CanonicalVarKind.expect_placeholder_index(k)}`);
        expect(CanonicalVarKind.universe(CanonicalVarKind.with_updated_universe(k, U(7)))).toBe(U(7));
      } else if (k.$ !== "Int" && k.$ !== "Float") {
        got.push(`CVKupd ${format_debug(CanonicalVarKind.with_updated_universe(k, U(7)), debug_CanonicalVarKind, PLAIN)}`);
      } else {
        got.push(`CVKupd ${format_debug(CanonicalVarKind.with_updated_universe(k, U(0)), debug_CanonicalVarKind, PLAIN)}`);
      }
    }
    expect(got.join("\n")).toBe(
      [
        "CVK Ty { ui: U1, sub_root: 0 }",
        "CVK# Ty {\n    ui: U1,\n    sub_root: 0,\n}",
        "CVKpreds U1 true false",
        "CVKupd Ty { ui: U7, sub_root: 0 }",
        "CVK Int",
        "CVK# Int",
        "CVKpreds U0 true false",
        "CVKupd Int",
        "CVK Float",
        "CVK# Float",
        "CVKpreds U0 true false",
        "CVKupd Float",
        "CVK Region(U0)",
        "CVK# Region(\n    U0,\n)",
        "CVKpreds U0 true true",
        "CVKupd Region(U7)",
        "CVK Const(U2)",
        "CVK# Const(\n    U2,\n)",
        "CVKpreds U2 true false",
        "CVKupd Const(U7)",
        "CVKpreds U3 false false",
        "CVKidx 4",
        "CVKpreds U1 false true",
        "CVKidx 2",
        "CVKpreds U2 false false",
        "CVKidx 5",
      ].join("\n"),
    );
    // `assert_eq!(ui, UniverseIndex::ROOT)` for int / float variables; `panic!("expected placeholder: {self:?}")`.
    expect(() => CanonicalVarKind.with_updated_universe(CanonicalVarKind.Int, U(1))).toThrow("assertion `left == right` failed");
    expect(() => CanonicalVarKind.expect_placeholder_index(cvks[3]!)).toThrow("expected placeholder: Region(U0)");
  });

  test("Display for Canonical matches the oracle", () => {
    const tcx = mk_tcx();
    const c: Canonical<number> = { value: 5, max_universe: U(1), var_kinds: tcx.mk_canonical_var_kinds(cvks.slice(0, 5)) };
    expect(`CanonicalDisplay ${display_Canonical(c, (v) => `${v}`)}`).toBe(
      "CanonicalDisplay Canonical { value: 5, max_universe: U1, var_kinds: [Ty { ui: U1, sub_root: 0 }, Int, Float, Region(U0), Const(U2)] }",
    );
    const c0: Canonical<string> = { value: "v", max_universe: U(0), var_kinds: RawList.empty() };
    expect(`CanonicalDisplay ${display_Canonical(c0, (v) => v)}`).toBe("CanonicalDisplay Canonical { value: v, max_universe: U0, var_kinds: [] }");
    // `unchecked_map` keeps the universe and the variable kinds.
    expect(Canonical.unchecked_map(c, (v) => [v])).toEqual({ value: [5], max_universe: U(1), var_kinds: c.var_kinds });
  });

  test("CanonicalVarValues::instantiate gives `f` the values so far (ArrayVec and cold paths)", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    for (const n of [3, 6]) {
      const kinds = tcx.mk_canonical_var_kinds(Array.from({ length: n }, (_, i): CanonicalVarKind => ({ $: "Ty", ui: U(0), sub_root: BV(i) })));
      const seen: number[] = [];
      const values = CanonicalVarValues.instantiate(tcx as unknown as Interner, kinds, (so_far, info) => {
        seen.push(so_far.length);
        expect(info.$).toBe("Ty");
        return GenericArg.from_Ty(t.ty_vars[so_far.length]!);
      });
      expect(seen).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(CanonicalVarValues.len(values)).toBe(n);
      expect(values.var_values).toBe(tcx.mk_args(Array.from({ length: n }, (_, i) => GenericArg.from_Ty(t.ty_vars[i]!))));
    }
  });
});

test("CanonicalizerState::clear empties every table", () => {
  const tcx = mk_tcx();
  const t = tcx.types;
  const s = CanonicalizerState.default_();
  s.variables.push(GenericArg.from_Ty(t.ty_vars[0]!));
  s.var_kinds.push(CanonicalVarKind.Int);
  s.variable_lookup_table.set(GenericArg.from_Ty(t.ty_vars[0]!), 0);
  s.sub_root_lookup_table.set(0 as never, 0);
  expect(s.cache.insert(t.ty_vars[0]!, t.i32)).toBe(true);
  s.clear();
  expect([s.variables.length, s.var_kinds.length, s.variable_lookup_table.size, s.sub_root_lookup_table.size]).toEqual([0, 0, 0, 0]);
  expect(s.cache.get(t.ty_vars[0]!)).toBeUndefined();
});

describe("fast_reject.rs", () => {
  const tcx = mk_tcx();
  // PORT: `TyCtxt` does not implement all of `Interner` yet (contract.test.ts pins the 14 missing methods, lane
  // ty-ctxt); these fns only call `trait_is_auto` / `next_trait_solver_globally` / `mk_args`.
  const cx = tcx as unknown as Interner;
  const t = tcx.types;
  const mk = (k: Parameters<TyCtxt["mk_ty_from_kind"]>[0]) => tcx.mk_ty_from_kind(k);
  const i32_ = t.i32;
  const u32_ = t.u32;
  const u8_ = t.u8;
  const f64_ = t.f64;
  const t0 = t.self_param;
  const t1 = mk({ $: "Param", _0: { index: 1, name: kw.SelfUpper } });
  const tv = t.ty_vars[0]!;
  const iv = mk({ $: "Infer", _0: { $: "IntVar", _0: 0 as IntVid } });
  const fv = mk({ $: "Infer", _0: { $: "FloatVar", _0: 0 as FloatVid } });
  const fnptr = (io: Ty[]) => mk({ $: "FnPtr", _0: { value: { inputs_and_output: tcx.mk_type_list(io) }, bound_vars: RawList.empty<never>() }, _1: FnHeader.dummy() });
  const ct_var = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 0 as never } });
  const tup = (tys: Ty[]) => mk({ $: "Tuple", _0: tcx.mk_type_list(tys) });
  const slice = (ty: Ty) => mk({ $: "Slice", _0: ty });
  const ptr = (ty: Ty, m: "Mut" | "Not") => mk({ $: "RawPtr", _0: ty, _1: m });
  const err = mk({ $: "Error", _0: guar });

  test("simplify_type matches the oracle (both TreatParams)", () => {
    const tys: [string, Ty][] = [
      ["bool", t.bool], ["char", t.char], ["i32", i32_], ["u8", u8_], ["f64", f64_],
      ["str", t.str_], ["never", t.never], ["unit", t.unit],
      ["tup3", tup([i32_, u8_, tv])], ["slice", slice(i32_)],
      ["array", mk({ $: "Array", _0: i32_, _1: ct_var })],
      ["ptr_mut", ptr(i32_, "Mut")], ["ptr_not", ptr(i32_, "Not")],
      ["ref", mk({ $: "Ref", _0: tcx.lifetimes.re_static, _1: i32_, _2: "Not" })],
      ["fnptr2", fnptr([i32_, u8_, t.unit])], ["param", t0], ["tyvar", tv], ["intvar", iv],
      ["error", err], ["bound", t.anon_bound_tys[0]![0]!],
    ];
    const dbg = (s: SimplifiedType<never> | undefined) => debug_option(s, PLAIN, (v, f) => debug_SimplifiedType(v, f, debug_DefId as never));
    const simp = (ty: Ty, p: TreatParams) => dbg(simplify_type(cx, ty, p) as SimplifiedType<never> | undefined);
    expect(tys.map(([n, ty]) => `Simplify ${n} ${simp(ty, "AsRigid")} ${simp(ty, "InstantiateWithInfer")}`).join("\n")).toBe(
      [
        "Simplify bool Some(Bool) Some(Bool)",
        "Simplify char Some(Char) Some(Char)",
        "Simplify i32 Some(Int(i32)) Some(Int(i32))",
        "Simplify u8 Some(Uint(u8)) Some(Uint(u8))",
        "Simplify f64 Some(Float(f64)) Some(Float(f64))",
        "Simplify str Some(Str) Some(Str)",
        "Simplify never Some(Never) Some(Never)",
        "Simplify unit Some(Tuple(0)) Some(Tuple(0))",
        "Simplify tup3 Some(Tuple(3)) Some(Tuple(3))",
        "Simplify slice Some(Slice) Some(Slice)",
        "Simplify array Some(Array) Some(Array)",
        "Simplify ptr_mut Some(Ptr(Mut)) Some(Ptr(Mut))",
        "Simplify ptr_not Some(Ptr(Not)) Some(Ptr(Not))",
        "Simplify ref Some(Ref(Not)) Some(Ref(Not))",
        "Simplify fnptr2 Some(Function(2)) Some(Function(2))",
        "Simplify param Some(Placeholder) None",
        "Simplify tyvar None None",
        "Simplify intvar None None",
        "Simplify error Some(Error) Some(Error)",
        "Simplify bound None None",
      ].join("\n"),
    );
  });

  test("DeepRejectCtxt::types_may_unify (rigid/infer modes, depth limits) matches the oracle", () => {
    const pairs: [string, Ty, Ty][] = [
      ["i32_i32", i32_, i32_], ["i32_u32", i32_, u32_], ["i32_iv", i32_, iv], ["f64_iv", f64_, iv], ["f64_fv", f64_, fv],
      ["iv_f64", iv, f64_], ["tv_u8", tv, u8_], ["T_u32", t0, u32_], ["u32_T", u32_, t0], ["T_T", t0, t0], ["T0_T1", t0, t1],
      ["sl_i32_u32", slice(i32_), slice(u32_)],
      ["tup_ok", tup([i32_, u8_]), tup([i32_, tv])],
      ["tup_len", tup([i32_, u8_]), tup([i32_])],
      ["ptr_mut_not", ptr(i32_, "Mut"), ptr(i32_, "Not")],
      ["ptr_T_u8", ptr(t0, "Mut"), ptr(u8_, "Mut")],
      ["err_bool", err, t.bool], ["bool_err", t.bool, err],
      ["fn_i32_u32", fnptr([i32_, t.unit]), fnptr([u32_, t.unit])],
      ["fn_i32_iv", fnptr([i32_, t.unit]), fnptr([iv, t.unit])],
      ["bound_u8", t.anon_bound_tys[0]![0]!, u8_],
    ];
    const rr = DeepRejectCtxt.relate_rigid_rigid(cx);
    const ii = DeepRejectCtxt.relate_infer_infer(cx);
    const ri = DeepRejectCtxt.relate_rigid_infer(cx);
    const got = pairs.map(([n, a, b]) =>
      `DRC ${n} ${rr.types_may_unify(a, b)} ${ii.types_may_unify(a, b)} ${ri.types_may_unify(a, b)} ${rr.types_may_unify_with_depth(a, b, 0)} ${rr.types_may_unify_with_depth(a, b, 1)} ${rr.types_may_unify_with_depth(a, b, 2)}`,
    );
    expect(got.join("\n")).toBe(
      [
        "DRC i32_i32 true true true true true true",
        "DRC i32_u32 false false false true false false",
        "DRC i32_iv true true true true true true",
        "DRC f64_iv false false false false false false",
        "DRC f64_fv true true true true true true",
        "DRC iv_f64 false false false true false false",
        "DRC tv_u8 true true true true true true",
        "DRC T_u32 false true false true false false",
        "DRC u32_T false true true true false false",
        "DRC T_T true true true true true true",
        "DRC T0_T1 false true true true false false",
        "DRC sl_i32_u32 false false false true true false",
        "DRC tup_ok true true true true true true",
        "DRC tup_len false false false true false false",
        "DRC ptr_mut_not false false false true false false",
        "DRC ptr_T_u8 false true false true true false",
        "DRC err_bool true true true true true true",
        "DRC bool_err true true true true true true",
        "DRC fn_i32_u32 false false false true true false",
        "DRC fn_i32_iv true true true true true true",
        "DRC bound_u8 true true true true true true",
      ].join("\n"),
    );
  });

  test("DeepRejectCtxt::args_may_unify matches the oracle", () => {
    const a1 = tcx.mk_args([GenericArg.from_Ty(i32_), GenericArg.from_Ty(u8_)]);
    const a2 = tcx.mk_args([GenericArg.from_Ty(iv), GenericArg.from_Ty(u8_)]);
    const a3 = tcx.mk_args([GenericArg.from_Ty(u32_)]);
    const a4 = tcx.mk_args([GenericArg.from_Ty(t0)]);
    const rr = DeepRejectCtxt.relate_rigid_rigid(cx);
    const ri = DeepRejectCtxt.relate_rigid_infer(cx);
    expect(`DRCargs ${rr.args_may_unify(a1, a2)} ${rr.args_may_unify(a3, a4)} ${ri.args_may_unify(a3, a4)} ${rr.args_may_unify(a1, a3)}`).toBe(
      "DRCargs true false true false",
    );
  });

  test("unported dependencies stop as UNPORTED, not as a wrong answer", () => {
    // `Alias` under `TreatParams::AsRigid` needs `TypeVisitableExt::has_non_region_infer` (lane tyir-binder).
    const alias = mk({ $: "Alias", _0: "Yes", _1: { kind: { $: "Projection", def_id: LocalDefId.to_def_id(CRATE_DEF_ID) }, args: tcx.mk_args([]), _use_alias_new_instead: null } });
    expect(() => simplify_type(cx, alias, "AsRigid")).toThrow(Unported);
    expect(simplify_type(cx, alias, "InstantiateWithInfer")).toBeUndefined();
  });
});
