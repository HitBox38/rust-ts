// Lane tyir-misc, sub-lane predicate: predicate.rs, predicate_kind.rs, ir_print.rs, unnormalized.rs.
//
// The oracle strings below were printed by the pinned nightly (rustc 1.101.0-nightly 6f5da406b 2026-10-10) through a
// throwaway rustc-dev program (lane handoff docs/handoff/tyir-misc.md, sub-lane predicate, "Probe") that builds the same
// values with rustc's own `TyCtxt` (`ty::Region::new_var(tcx, 5)`, `tcx.lifetimes.re_static`, `ty::Const::new_var(tcx, 3)`,
// `ty::Const::new_infer(tcx, Fresh(2))`, `ty::TraitRef::new(tcx, sized, [u8])`, ...) and prints them with `{:?}` /
// `{:#?}` / `{}`. `TraitRef`'s own Debug is rustc_middle's printer (`IrPrint`, lane ty-print): those tests install a
// stand-in `IrPrint<TraitRef>` that returns the oracle's `TraitRef` line, so they check the rustc_type_ir part around it.
import { afterEach, describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { type CrateNum, DefId, type DefIndex } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { debug_int, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";
import type { Binder, BoundVariableKind, ConstVid } from "./decls.ts";
import type { FallibleTypeFolder, TryFoldWith, TypeFolder } from "./fold.ts";
import type { Interner } from "./interner.ts";
import {
  ClosureKind_into_diag_arg,
  debug_TraitRef,
  display_Binder,
  display_Region,
  display_TraitRef,
  IR_PRINT,
  type IrPrint,
  TraitRef_into_diag_arg,
} from "./ir_print.ts";
import {
  BoundConstness,
  ClausePolarity,
  debug_BoundConstness,
  debug_ClausePolarity,
  debug_HostEffectClause,
  debug_ImplPolarity,
  debug_RegionConstraint,
  debug_TraitClause,
  display_BoundConstness,
  display_ClausePolarity,
  display_ImplPolarity,
  ExistentialProjection,
  ExistentialTraitRef,
  type HostEffectClause,
  ImplPolarity,
  PolyTraitRef,
  RegionConstraint,
  type TraitClause,
  TraitRef,
} from "./predicate.ts";
import { type ClauseKind, debug_ClauseKind, debug_PredicateKind, type PredicateKind } from "./predicate_kind.ts";
import { Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import { debug_Unnormalized, fold_with_Unnormalized, try_fold_with_Unnormalized, Unnormalized, UnnormalizedPolyTraitRef } from "./unnormalized.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (as in tyir_kind.test.ts). */
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

const did = (index: number) => new DefId(index as DefIndex, 0 as CrateNum);
const pretty = <T>(v: T, d: (v: T, f: typeof PLAIN) => string) => format_debug(v, d, PRETTY);

// merge-w15a: rustc_middle (ty/print/mod.ts) fills the registry at load; tests that install a stand-in restore it.
const REGISTERED_TRAIT_REF = IR_PRINT.TraitRef;
afterEach(() => {
  if (REGISTERED_TRAIT_REF === undefined) delete IR_PRINT.TraitRef;
  else IR_PRINT.TraitRef = REGISTERED_TRAIT_REF;
});

/** Stand-in for rustc_middle's `IrPrint<TraitRef>` (lane ty-print): the oracle's `{:?}` / `{}` of the probe's TraitRef. */
function install_trait_ref_printer(): void {
  IR_PRINT.TraitRef = {
    print: () => "<u8 as std::marker::Sized>",
    print_debug: () => "<u8 as std::marker::Sized>",
  };
}

describe("polarities and constness (oracle)", () => {
  test("ImplPolarity", () => {
    // ImplPolarity Positive | positive | ""
    // ImplPolarity Negative | negative | "!"
    expect(debug_ImplPolarity("Positive", PLAIN)).toBe("Positive");
    expect(display_ImplPolarity("Positive")).toBe("positive");
    expect(ImplPolarity.as_str("Positive")).toBe("");
    expect(debug_ImplPolarity(ImplPolarity.Negative, PLAIN)).toBe("Negative");
    expect(display_ImplPolarity("Negative")).toBe("negative");
    expect(ImplPolarity.as_str("Negative")).toBe("!");
  });

  test("ClausePolarity", () => {
    // ClausePolarity Positive | positive | Negative
    // ClausePolarity Negative | negative | Positive
    expect(debug_ClausePolarity("Positive", PLAIN)).toBe("Positive");
    expect(display_ClausePolarity("Positive")).toBe("positive");
    expect(ClausePolarity.flip("Positive")).toBe("Negative");
    expect(display_ClausePolarity(ClausePolarity.Negative)).toBe("negative");
    expect(ClausePolarity.flip("Negative")).toBe("Positive");
  });

  test("BoundConstness", () => {
    // BoundConstness Const | const | const | true true
    // BoundConstness Maybe | [const] | [const] | false true
    const lines = (["Const", "Maybe"] as const).map(
      (c) =>
        `${debug_BoundConstness(c, PLAIN)} | ${display_BoundConstness(c)} | ${BoundConstness.as_str(c)} | ` +
        `${BoundConstness.satisfies(c, "Const")} ${BoundConstness.satisfies(c, "Maybe")}`,
    );
    expect(lines).toEqual(["Const | const | const | true true", "Maybe | [const] | [const] | false true"]);
  });
});

describe("Debug of ClauseKind / PredicateKind (oracle)", () => {
  test("Ambiguous and UnstableFeature", () => {
    const amb: PredicateKind = { $: "Ambiguous" };
    expect(debug_PredicateKind(amb, PLAIN)).toBe("Ambiguous");
    expect(pretty(amb, debug_PredicateKind)).toBe("Ambiguous");
    create_default_session_globals_then(() => {
      const uf: ClauseKind = { $: "UnstableFeature", _0: sym.rustc_attrs };
      expect(debug_ClauseKind(uf, PLAIN)).toBe('UnstableFeature("rustc_attrs")');
      expect(pretty(uf, debug_ClauseKind)).toBe('UnstableFeature("rustc_attrs")');
      expect(debug_PredicateKind({ $: "Clause", _0: uf }, PLAIN)).toBe('UnstableFeature("rustc_attrs")');
      expect(pretty<PredicateKind>({ $: "Clause", _0: uf }, debug_PredicateKind)).toBe('UnstableFeature("rustc_attrs")');
    });
  });

  test("RegionOutlives", () => {
    const tcx = mk_tcx();
    const r_static = tcx.lifetimes.re_static;
    const r_var = tcx.lifetimes.re_vars[5] as Region;
    const ro: ClauseKind = { $: "RegionOutlives", _0: { _0: r_var, _1: r_static } };
    const lines = "OutlivesClause(\n    '?5,\n    'static,\n)";
    expect(debug_ClauseKind(ro, PLAIN)).toBe("OutlivesClause('?5, 'static)");
    expect(pretty(ro, debug_ClauseKind)).toBe(lines);
    expect(debug_PredicateKind({ $: "Clause", _0: ro }, PLAIN)).toBe("OutlivesClause('?5, 'static)");
    expect(pretty<PredicateKind>({ $: "Clause", _0: ro }, debug_PredicateKind)).toBe(lines);
  });

  test("ConstEvaluatable and ConstEquate", () => {
    const tcx = mk_tcx();
    const c3 = Const.new_var(tcx, 3 as ConstVid);
    const cf = Const.new_infer(tcx, { $: "Fresh", _0: 2 });
    const ce: ClauseKind = { $: "ConstEvaluatable", _0: c3 };
    expect(debug_ClauseKind(ce, PLAIN)).toBe("ConstEvaluatable(?3c)");
    expect(pretty(ce, debug_ClauseKind)).toBe("ConstEvaluatable(?3c)");
    const ceq: PredicateKind = { $: "ConstEquate", _0: c3, _1: cf };
    expect(debug_PredicateKind(ceq, PLAIN)).toBe("ConstEquate(?3c, Fresh(2))");
    expect(pretty(ceq, debug_PredicateKind)).toBe("ConstEquate(?3c, Fresh(2))");
  });

  test("Trait and HostEffect clauses around rustc_middle's TraitRef printer", () => {
    install_trait_ref_printer();
    const tcx = mk_tcx();
    const tr: TraitRef = { def_id: did(1), args: tcx.mk_args([tcx.types.u8]), _use_trait_ref_new_instead: null };
    expect(debug_TraitRef(tr, PLAIN)).toBe("<u8 as std::marker::Sized>");
    expect(display_TraitRef(tr)).toBe("<u8 as std::marker::Sized>");
    const tc: TraitClause = { trait_ref: tr, polarity: "Negative" };
    const tc_line = "TraitClause(<u8 as std::marker::Sized>, polarity:Negative)";
    expect(debug_TraitClause(tc, PLAIN)).toBe(tc_line);
    expect(pretty(tc, debug_TraitClause)).toBe(tc_line);
    expect(debug_ClauseKind({ $: "Trait", _0: tc }, PLAIN)).toBe(tc_line);
    expect(pretty<ClauseKind>({ $: "Trait", _0: tc }, debug_ClauseKind)).toBe(tc_line);
    const he: HostEffectClause = { trait_ref: tr, constness: "Maybe" };
    const he_line = "HostEffectClause { trait_ref: <u8 as std::marker::Sized>, constness: Maybe }";
    const he_pretty = "HostEffectClause {\n    trait_ref: <u8 as std::marker::Sized>,\n    constness: Maybe,\n}";
    expect(debug_HostEffectClause(he, PLAIN)).toBe(he_line);
    expect(pretty(he, debug_HostEffectClause)).toBe(he_pretty);
    expect(debug_ClauseKind({ $: "HostEffect", _0: he }, PLAIN)).toBe(he_line);
    expect(pretty<ClauseKind>({ $: "HostEffect", _0: he }, debug_ClauseKind)).toBe(he_pretty);
    expect(pretty<PredicateKind>({ $: "Clause", _0: { $: "HostEffect", _0: he } }, debug_PredicateKind)).toBe(he_pretty);
    // IntoDiagArg for TraitRef is its Display.
    expect(TraitRef_into_diag_arg(tr, { value: undefined })).toEqual({ $: "Str", _0: "<u8 as std::marker::Sized>" });
  });
});

describe("ir_print registry", () => {
  test("an empty slot stops as UNPORTED; a filled slot prints through rustc_middle; generic impls are parameters", () => {
    const tcx = mk_tcx();
    const tr: TraitRef = { def_id: did(1), args: tcx.mk_args([]), _use_trait_ref_new_instead: null };
    delete IR_PRINT.TraitRef;
    expect(() => display_TraitRef(tr)).toThrow(Unported);
    expect(() => debug_TraitRef(tr, PLAIN)).toThrow(Unported);
    // merge-w15a: `IR_PRINT.Region` is rustc_middle's blanket `IrPrint` impl (print/mod.rs:427), which prints with the
    // `TyCtxt` of `tls::with`; outside one it panics like upstream.
    expect(() => display_Region(tcx.lifetimes.re_static)).toThrow("no ImplicitCtxt stored in tls");
    const seen: unknown[] = [];
    const ir_print: IrPrint<{ value: number; bound_vars: never }> = {
      print: (t) => (seen.push(t), "for<> 7"),
      print_debug: () => "unused",
    };
    const b = { value: 7, bound_vars: undefined as never };
    expect(display_Binder(b, ir_print)).toBe("for<> 7");
    expect(seen).toEqual([b]);
  });

  test("IntoDiagArg for ClosureKind", () => {
    expect(ClosureKind_into_diag_arg("Fn", { value: undefined })).toEqual({ $: "Str", _0: "Fn" });
    expect(ClosureKind_into_diag_arg("FnMut", { value: undefined })).toEqual({ $: "Str", _0: "FnMut" });
    expect(ClosureKind_into_diag_arg("FnOnce", { value: undefined })).toEqual({ $: "Str", _0: "FnOnce" });
  });
});

describe("RegionConstraint", () => {
  test("is_trivial / iter_outlives (oracle) and Debug of Eq", () => {
    const tcx = mk_tcx();
    const r_static = tcx.lifetimes.re_static;
    const r_var = tcx.lifetimes.re_vars[5] as Region;
    const eq = RegionConstraint.from_RegionEqPredicate({ _0: r_var, _1: r_static });
    const eq_same = RegionConstraint.from_RegionEqPredicate({ _0: r_var, _1: r_var });
    const ol = RegionConstraint.from_OutlivesClause({ _0: GenericArg.from_Region(r_static), _1: r_static });
    const ol_ty = RegionConstraint.from_OutlivesClause({ _0: GenericArg.from_Ty(tcx.types.u8), _1: r_static });
    // RC Eq(RegionEqPredicate('?5, 'static)) false
    // RC Eq(RegionEqPredicate('?5, '?5)) true
    // RC Outlives(OutlivesClause('static, 'static)) true
    // RC false
    expect(`${debug_RegionConstraint(eq, PLAIN)} ${RegionConstraint.is_trivial(eq)}`).toBe("Eq(RegionEqPredicate('?5, 'static)) false");
    expect(`${debug_RegionConstraint(eq_same, PLAIN)} ${RegionConstraint.is_trivial(eq_same)}`).toBe("Eq(RegionEqPredicate('?5, '?5)) true");
    expect(RegionConstraint.is_trivial(ol)).toBe(true);
    expect(RegionConstraint.is_trivial(ol_ty)).toBe(false);
    // RCiter [OutlivesClause('?5, 'static), OutlivesClause('static, '?5)]  (Debug of GenericArg: rustc_middle, still a stub)
    expect(RegionConstraint.iter_outlives(eq)).toEqual([
      { _0: r_var, _1: r_static },
      { _0: r_static, _1: r_var },
    ]);
    // RCiter [OutlivesClause('static, 'static)]
    expect(RegionConstraint.iter_outlives(ol)).toEqual([{ _0: r_static, _1: r_static }]);
  });
});

describe("Unnormalized", () => {
  test("Debug (oracle) and the wrapper methods", () => {
    const u = Unnormalized.new(5);
    expect(debug_Unnormalized(u, PLAIN, debug_int)).toBe("Unnormalized { value: 5, .. }");
    expect(format_debug(u, (v, f) => debug_Unnormalized(v, f, debug_int), PRETTY)).toBe("Unnormalized {\n    value: 5,\n    ..\n}");
    expect(Unnormalized.skip_normalization(u)).toBe(5);
    expect(Unnormalized.skip_norm_wip(Unnormalized.new_wip("x"))).toBe("x");
    expect(Unnormalized.map(Unnormalized.dummy(2), (x) => x * 3).value).toBe(6);
    expect(Unnormalized.map_ref(u, (x) => `${x}`).value).toBe("5");
    expect(Unnormalized.as_ref(u).value).toBe(5);
    const [a, b] = Unnormalized.unzip(Unnormalized.new<[number, string]>([1, "b"]));
    expect([a.value, b.value]).toEqual([1, "b"]);
    expect(Unnormalized.skip_binder(Unnormalized.new({ value: 9, bound_vars: undefined as never }))).toBe(9);
    // TypeFoldable: folds the value and rewraps it.
    const folder = {} as TypeFolder;
    expect(fold_with_Unnormalized(u, folder, (v: number) => v + 1).value).toBe(6);
    const r = try_fold_with_Unnormalized<number, string>(u, {} as FallibleTypeFolder<string>, (v: number) => Ok(v * 2));
    expect(r.$ === "Ok" && r._0.value).toBe(10);
    const e = try_fold_with_Unnormalized<number, string>(u, {} as FallibleTypeFolder<string>, (() => Err("no")) as unknown as TryFoldWith<number>);
    expect(e).toEqual({ $: "Err", _0: "no" });
    expect(UnnormalizedPolyTraitRef.def_id(Unnormalized.new({ value: { def_id: did(4) } as TraitRef, bound_vars: undefined as never }))).toEqual(did(4));
  });
});

describe("TraitRef / ExistentialTraitRef / ExistentialProjection logic", () => {
  /** An `Interner` view over `tcx` with the two `debug_assert_*` hooks (no-ops in the release oracle) and fixed generics. */
  function mk_interner(tcx: TyCtxt, count: number, parent: DefId): Interner {
    return {
      mk_args_from_iter: (it: Iterable<GenericArg>) => tcx.mk_args_from_iter(it),
      mk_args: (xs: readonly GenericArg[]) => tcx.mk_args(xs),
      debug_assert_args_compatible: () => {},
      debug_assert_existential_args_compatible: () => {},
      generics_of: () => ({ count: () => count }) as unknown as Generics,
      projection_parent: () => parent,
    } as unknown as Interner;
  }

  // merge-w15a: `TyCtxt::debug_assert_args_compatible` is real (lane ty-ctxt): a no-op without debug assertions, like the
  // release oracle, so `new_from_args` builds the struct.
  test("TraitRef::new_from_args on a real TyCtxt (debug_assert_args_compatible is a release no-op)", () => {
    const tcx = mk_tcx();
    const args = tcx.mk_args([]);
    const tr = TraitRef.new_from_args(tcx as unknown as Interner, did(1), args);
    expect(tr.def_id).toEqual(did(1));
    expect(tr.args).toBe(args);
  });

  test("from_assoc keeps or truncates the args; with_replaced_self_ty; with_self_ty", () => {
    const tcx = mk_tcx();
    const { u8, u16, u32, bool } = tcx.types;
    const args = tcx.mk_args([u8, u16, u32]);
    const whole = TraitRef.from_assoc(mk_interner(tcx, 3, did(0)), did(1), args);
    expect(whole.args).toBe(args);
    const some = TraitRef.from_assoc(mk_interner(tcx, 2, did(0)), did(1), args);
    expect([...some.args]).toEqual([u8, u16]);
    expect(some.args).toBe(tcx.mk_args([u8, u16]));
    const replaced = TraitRef.with_replaced_self_ty(whole, mk_interner(tcx, 3, did(0)), bool);
    expect(replaced.args).toBe(tcx.mk_args([bool, u16, u32]));
    expect(replaced.def_id).toBe(whole.def_id);
    const ex = ExistentialTraitRef.new(mk_interner(tcx, 0, did(0)), did(2), [u16]);
    const full = ExistentialTraitRef.with_self_ty(ex, mk_interner(tcx, 0, did(0)), u8);
    expect(full.args).toBe(tcx.mk_args([u8, u16]));
    expect(full._use_trait_ref_new_instead).toBe(null);
  });

  test("ExistentialProjection::trait_ref and alias_kind", () => {
    const tcx = mk_tcx();
    const { u8, u16, u32 } = tcx.types;
    const p = ExistentialProjection.new(mk_interner(tcx, 0, did(0)), did(5), [u8, u16, u32], u8);
    // the trait has 3 generics (Self + 2), so the existential trait ref keeps the first 2 args
    const tr = ExistentialProjection.trait_ref(p, mk_interner(tcx, 3, did(7)));
    expect(tr.def_id).toEqual(did(7));
    expect(tr.args).toBe(tcx.mk_args([u8, u16]));
    expect(ExistentialProjection.alias_kind(p)).toEqual({ $: "ProjectionTy", def_id: did(5) });
    const pc = ExistentialProjection.new(mk_interner(tcx, 0, did(0)), did(6), [], Const.new_var(tcx, 0 as ConstVid));
    expect(ExistentialProjection.alias_kind(pc)).toEqual({ $: "ProjectionConst", def_id: did(6) });
    // a trait with more generics than args: the slice panics like rustc's `[..args_count]`
    expect(() => ExistentialProjection.trait_ref(p, mk_interner(tcx, 5, did(7)))).toThrow("range end index 4 out of range for slice of length 3");
  });

  // merge-w15a: the Binder stand-ins are binder.ts's real fns now; the helpers stop at rustc_middle stubs
  // (`GenericArgs::type_at`, `Predicate::expect_clause`, lane ty-args).
  test("PolyTraitRef helpers stop at rustc_middle stubs as UNPORTED", () => {
    const tcx = mk_tcx();
    const tr: TraitRef = { def_id: did(1), args: tcx.mk_args([]), _use_trait_ref_new_instead: null };
    const b: Binder<TraitRef> = { value: tr, bound_vars: RawList.empty<BoundVariableKind>() };
    expect(PolyTraitRef.def_id(b)).toBe(tr.def_id);
    expect(() => PolyTraitRef.self_ty(b)).toThrow("rustc_middle::ty::generic_args::GenericArgs::type_at");
    expect(() => PolyTraitRef.to_host_effect_clause(b, tcx, BoundConstness.Const)).toThrow("rustc_middle::ty::predicate::Predicate::expect_clause");
  });
});
