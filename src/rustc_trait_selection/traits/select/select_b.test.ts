// Unit tests of lane old-select-b (select/mod.rs:1710..2797 and select/_match.rs). Not an upstream file: these drive the
// winnowing rules, the builtin-condition helpers and `MatchAgainstFreshVars` directly, because the selection entry points
// (`poly_select`, lane old-select-a) are not ported yet. Expected values follow the upstream code paths.
import { describe, expect, test } from "bun:test";
import "../../lib.ts";
import type { EvaluatedCandidate } from "./mod.ts";
import { SelectionContext } from "./mod.ts";
import { MatchAgainstFreshVars } from "./_match.ts";
import type { EvaluationResult, SelectionCandidate } from "../../../rustc_middle/traits/select.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../../rustc_middle/ty/context.ts";
import * as tls from "../../../rustc_middle/ty/context/tls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { kw } from "../../../rustc_span/symbol.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { TraitClause } from "../../../rustc_type_ir/decls.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, TraitRef, visit_with_TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { relate_Ty } from "../../../rustc_type_ir/relate.ts";
import { Panic } from "../../../std/panic.ts";

/** A `TyCtxt` over fresh interners (as traits_a.test.ts), old solver (`-Znext-solver=coherence`). */
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
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => false;
  (tcx as unknown as { renormalize_rigid_aliases: () => boolean }).renormalize_rigid_aliases = () => false;
  return tcx;
}

const sg = (f: (tcx: TyCtxt, selcx: SelectionContext) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      f(tcx, SelectionContext.new(infcx));
    });
  });

const def = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);

function poly_trait_clause(tcx: TyCtxt, trait_def_id: DefId, self_ty: Ty): Binder<TraitClause> {
  const trait_ref = TraitRef.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(self_ty)]);
  return Binder.dummy<TraitClause>({ trait_ref, polarity: "Positive" }, { visit_with: visit_with_TraitClause });
}

const ev = (candidate: SelectionCandidate, evaluation: EvaluationResult = "EvaluatedToOk"): EvaluatedCandidate => ({ candidate, evaluation });

describe("MatchAgainstFreshVars (select/_match.rs)", () => {
  test(
    "fresh types in `b` match anything; other infer vars and different types do not",
    sg((tcx) => {
      const m = MatchAgainstFreshVars.new(tcx);
      expect(m.cx()).toBe(tcx);
      const fresh = Ty.new_fresh(tcx, 0);
      expect(m.relate(tcx.types.u8, fresh, relate_Ty)).toEqual({ $: "Ok", _0: tcx.types.u8 });
      expect(m.relate(tcx.types.u8, tcx.types.u8, relate_Ty)).toEqual({ $: "Ok", _0: tcx.types.u8 });
      const r = m.relate(tcx.types.u8, tcx.types.bool, relate_Ty);
      expect(r.$).toBe("Err");
      // `(&ty::Infer(_), _)`: a fresh type in `a` against a concrete `b` is `Sorts`.
      const r2 = m.relate(fresh, tcx.types.u8, relate_Ty);
      expect(r2.$ === "Err" && r2._0.$).toBe("Sorts");
      // Structural: `(u8, ?F0)` matches `(u8, ?F1)` and `(u8, bool)` only through `b`'s fresh var.
      const t_a = Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool]);
      const t_b = Ty.new_tup(tcx, [tcx.types.u8, Ty.new_fresh(tcx, 1)]);
      expect(m.relate(t_a, t_b, relate_Ty).$).toBe("Ok");
      expect(m.relate(t_b, t_a, relate_Ty).$).toBe("Err");
    }),
  );

  test(
    "match_fresh_trait_preds",
    sg((tcx, selcx) => {
      const tr = def(5);
      const a = poly_trait_clause(tcx, tr, tcx.types.u8);
      expect(selcx.match_fresh_trait_preds(a, poly_trait_clause(tcx, tr, Ty.new_fresh(tcx, 0)))).toBe(true);
      expect(selcx.match_fresh_trait_preds(a, poly_trait_clause(tcx, tr, tcx.types.bool))).toBe(false);
      // Different traits never match (`TraitRef::relate`).
      expect(selcx.match_fresh_trait_preds(a, poly_trait_clause(tcx, def(6), Ty.new_fresh(tcx, 0)))).toBe(false);
    }),
  );
});

describe("winnow_candidates (select/mod.rs:1716)", () => {
  test(
    "a single candidate; Sized is preferred only when it must apply",
    sg((tcx, selcx) => {
      const impl_ = { $: "ImplCandidate", _0: def(9) } as const;
      expect(selcx.winnow_candidates(false, "Default", [ev(impl_)])).toBe(impl_);
      const sized: SelectionCandidate = { $: "SizedCandidate" };
      expect(selcx.winnow_candidates(false, "Default", [ev(impl_), ev(sized)])).toEqual(sized);
      expect(selcx.winnow_candidates(false, "Default", [ev(impl_), ev(sized, "EvaluatedToAmbig")])).toBeUndefined();
      void tcx;
    }),
  );

  test(
    "where-bounds: duplicates are dropped, a non-global one wins over impls, global + non-global is ambiguous",
    sg((tcx, selcx) => {
      const tr = def(5);
      const self_param = Ty.new_param(tcx, 0, kw.SelfUpper);
      const p = poly_trait_clause(tcx, tr, self_param);
      const p_dup = poly_trait_clause(tcx, tr, self_param);
      const global = poly_trait_clause(tcx, tr, tcx.types.u8);
      const impl_: SelectionCandidate = { $: "ImplCandidate", _0: def(9) };
      const r = selcx.winnow_candidates(false, "Default", [
        ev({ $: "ParamCandidate", _0: p }),
        ev({ $: "ParamCandidate", _0: p_dup }),
        ev(impl_),
      ]);
      expect(r?.$).toBe("ParamCandidate");
      expect(
        selcx.winnow_candidates(false, "Default", [ev({ $: "ParamCandidate", _0: p }), ev({ $: "ParamCandidate", _0: global })]),
      ).toBeUndefined();
      // Only a global where-bound and an impl: the impl candidate applies (global where-bounds are ignored).
      expect(selcx.winnow_candidates(false, "Default", [ev({ $: "ParamCandidate", _0: global }), ev(impl_)])).toEqual(impl_);
    }),
  );

  test(
    "alias bounds, object and upcasting candidates pick the lowest index unless inference is affected",
    sg((_tcx, selcx) => {
      const proj = (idx: number, kind: "SelfBounds" | "NonSelfBounds"): EvaluatedCandidate => ev({ $: "ProjectionCandidate", idx, kind });
      expect(selcx.winnow_candidates(false, "Marker", [proj(3, "SelfBounds"), proj(1, "SelfBounds")])).toEqual({
        $: "ProjectionCandidate",
        idx: 1,
        kind: "SelfBounds",
      });
      expect(selcx.winnow_candidates(true, "Marker", [proj(3, "SelfBounds"), proj(1, "SelfBounds")])).toBeUndefined();
      expect(selcx.winnow_candidates(false, "Default", [proj(2, "NonSelfBounds"), proj(0, "SelfBounds")])).toEqual({
        $: "ProjectionCandidate",
        idx: 0,
        kind: "SelfBounds",
      });
      const obj = (i: number): EvaluatedCandidate => ev({ $: "ObjectCandidate", _0: i });
      expect(selcx.winnow_candidates(false, "Default", [obj(2), obj(1)])).toEqual({ $: "ObjectCandidate", _0: 1 });
      expect(selcx.winnow_candidates(true, "Default", [obj(2), obj(1)])).toBeUndefined();
      expect(selcx.winnow_candidates(true, "Default", [obj(2), ev({ $: "ImplCandidate", _0: def(9) })])).toBeUndefined();
      expect(selcx.winnow_candidates(false, "Default", [obj(2), ev({ $: "ImplCandidate", _0: def(9) })])).toEqual({
        $: "ObjectCandidate",
        _0: 2,
      });
      const up = (i: number): EvaluatedCandidate => ev({ $: "TraitUpcastingUnsizeCandidate", _0: i });
      expect(selcx.winnow_candidates(false, "Default", [up(4), up(3)])).toEqual({ $: "TraitUpcastingUnsizeCandidate", _0: 3 });
    }),
  );

  test(
    "an impl overlapping a builtin candidate, and two builtin candidates, are ambiguous",
    sg((_tcx, selcx) => {
      expect(
        selcx.winnow_candidates(false, "Default", [ev({ $: "BuiltinCandidate" }), ev({ $: "ImplCandidate", _0: def(9) })]),
      ).toBeUndefined();
      expect(selcx.winnow_candidates(false, "Default", [ev({ $: "BuiltinCandidate" }), ev({ $: "FnPointerCandidate" })])).toBeUndefined();
    }),
  );
});

describe("builtin conditions (select/mod.rs:2024..2160)", () => {
  test(
    "sizedness_conditions / copy_clone_conditions / coroutine_is_gen / should_stall_coroutine",
    sg((tcx, selcx) => {
      const tup = Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool]);
      expect(Binder.skip_binder(selcx.sizedness_conditions(tup, "Sized"))).toEqual([tcx.types.bool]);
      expect(Binder.skip_binder(selcx.sizedness_conditions(tcx.types.u8, "Sized"))).toEqual([]);
      expect(Binder.skip_binder(selcx.sizedness_conditions(tcx.types.str_, "MetaSized"))).toEqual([]);
      expect(() => selcx.sizedness_conditions(tcx.types.str_, "Sized")).toThrow(
        "internal error: entered unreachable code: tried to assemble `Sized` for unsized type",
      );
      expect(Binder.skip_binder(selcx.copy_clone_conditions(tup))).toEqual([tcx.types.u8, tcx.types.bool]);
      expect(() => selcx.copy_clone_conditions(tcx.types.u8)).toThrow(Panic);
      expect(() => selcx.copy_clone_conditions(tcx.types.u8)).toThrow(
        "internal error: entered unreachable code: tried to assemble `Sized` for type with libcore-provided impl",
      );
      expect(selcx.coroutine_is_gen(tcx.types.u8)).toBe(false);
      expect(selcx.should_stall_coroutine(def(3))).toBe(false);
      const c = selcx.constituent_types_for_auto_trait(tcx.types.str_);
      expect(c.$ === "Ok" && Binder.skip_binder(c._0).types).toEqual([Ty.new_slice(tcx, tcx.types.u8)]);
      const c2 = selcx.constituent_types_for_auto_trait(tup);
      expect(c2.$ === "Ok" && Binder.skip_binder(c2._0).types).toEqual([tcx.types.u8, tcx.types.bool]);
    }),
  );
});
