// Tests of lane old-select-a (wave 18c): the selection / evaluation entry path of the old solver's `SelectionContext`
// (traits/select/mod.rs:223..1633) on a real `InferCtxt` over fresh interners (as traits_a.test.ts), and the stops the
// ported code reaches until lanes old-select-b (`push_stack`, winnowing) and old-candidates-confirm land.
import { describe, expect, test } from "bun:test";
import "./lib.ts";
import { Obligation, type PredicateObligation } from "../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import * as tls from "../rustc_middle/ty/context/tls.ts";
import type { Predicate } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { ParamEnv } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_PredicateKind } from "../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { Limit } from "../rustc_structures/limit.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { PredicateKind } from "../rustc_type_ir/predicate_kind.ts";
import { TraitRef, as_interner } from "../rustc_type_ir/predicate.ts";
import { Unported } from "../std/panic.ts";
import { SelectionContext, TraitObligationStackList, ProvisionalEvaluationCache } from "./traits/select/mod.ts";

/** A `TyCtxt` over fresh interners (as traits_a.test.ts), on the old solver, with a recursion limit. */
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
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true, disable_fast_paths: true } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // PORT(test): the compiletest-argv suites run typeck on the old solver (`-Znext-solver=coherence`); no query system, so
  // `recursion_limit()` (the `limits` query) is the default limit 128. `-Zdisable-fast-paths` keeps `sizedness_fast_path`
  // (lang items, not in this mock) out of the way.
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => false;
  (tcx as unknown as { renormalize_rigid_aliases: () => boolean }).renormalize_rigid_aliases = () => false;
  (tcx as unknown as { recursion_limit: () => Limit }).recursion_limit = () => new Limit(128);
  return tcx;
}

const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

const pred = (tcx: TyCtxt, kind: PredicateKind): Predicate => Predicate_upcast_from_PredicateKind(kind, tcx);
const oblig = (p: Predicate, depth = 0): PredicateObligation => new Obligation(ObligationCause.dummy(), ParamEnv.empty(), p, depth);

describe("SelectionContext evaluation (old-select-a)", () => {
  test(
    "evaluate_predicate_recursively: outlives / ambiguous predicates and the lattice max",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const selcx = SelectionContext.new(infcx);
      const re = tcx.lifetimes.re_static;
      const empty = () => TraitObligationStackList.empty(ProvisionalEvaluationCache.default());
      const region_outlives = pred(tcx, { $: "Clause", _0: { $: "RegionOutlives", _0: { _0: re, _1: re } } });
      // A global type with no free lifetimes or generic parameters outlives anything.
      const type_outlives_global = pred(tcx, { $: "Clause", _0: { $: "TypeOutlives", _0: { _0: tcx.types.u32, _1: re } } });
      const type_outlives_infer = pred(tcx, { $: "Clause", _0: { $: "TypeOutlives", _0: { _0: infcx.next_ty_var(DUMMY_SP), _1: re } } });
      const ambiguous = pred(tcx, { $: "Ambiguous" });

      expect(selcx.evaluate_predicate_recursively(empty(), oblig(region_outlives))).toEqual({ $: "Ok", _0: "EvaluatedToOkModuloRegions" });
      expect(selcx.evaluate_predicate_recursively(empty(), oblig(type_outlives_global))).toEqual({ $: "Ok", _0: "EvaluatedToOk" });
      expect(selcx.evaluate_predicate_recursively(empty(), oblig(type_outlives_infer))).toEqual({ $: "Ok", _0: "EvaluatedToOkModuloRegions" });
      expect(selcx.evaluate_predicate_recursively(empty(), oblig(ambiguous))).toEqual({ $: "Ok", _0: "EvaluatedToAmbig" });

      // `evaluate_predicates_recursively` takes the max and sets each depth from the (empty) stack.
      const os = [oblig(type_outlives_global), oblig(region_outlives), oblig(ambiguous), oblig(type_outlives_global)];
      expect(selcx.evaluate_predicates_recursively(empty(), os)).toEqual({ $: "Ok", _0: "EvaluatedToAmbig" });
      expect(os.map((o) => o.recursion_depth)).toEqual([1, 1, 1, 1]);
      expect(selcx.evaluate_predicates_recursively(empty(), [])).toEqual({ $: "Ok", _0: "EvaluatedToOk" });
    }),
  );

  test(
    "evaluate_root_obligation runs in an evaluation probe; trait goals reach the old-select-b stop push_stack",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const selcx = SelectionContext.new(infcx);
      const re = tcx.lifetimes.re_static;
      const region_outlives = pred(tcx, { $: "Clause", _0: { $: "RegionOutlives", _0: { _0: re, _1: re } } });
      expect(selcx.evaluate_root_obligation(oblig(region_outlives))).toEqual({ $: "Ok", _0: "EvaluatedToOkModuloRegions" });

      // `?0: Trait`: `evaluate_trait_predicate_recursively` -> `push_stack` (lane old-select-b).
      const v = infcx.next_ty_var(DUMMY_SP);
      const trait_ref = TraitRef.new(as_interner(tcx), new DefId(DefIndex.from_u32(5), LOCAL_CRATE), [GenericArg.from_Ty(v)]);
      const trait_pred = pred(tcx, { $: "Clause", _0: { $: "Trait", _0: { trait_ref, polarity: "Positive" } } });
      expect(() => selcx.evaluate_root_obligation(oblig(trait_pred))).toThrow(Unported);
      expect(() => selcx.evaluate_root_obligation(oblig(trait_pred))).toThrow(/rustc_trait_selection::traits::select::SelectionContext::push_stack/);
    }),
  );

  test(
    "check_recursion_limit: past the limit in canonical mode is OverflowError::Canonical",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const selcx = SelectionContext.with_query_mode(infcx, "Canonical");
      const ambiguous = pred(tcx, { $: "Ambiguous" });
      expect(selcx.check_recursion_limit(oblig(ambiguous, 128), oblig(ambiguous), (p: Predicate) => p)).toEqual({ $: "Ok", _0: null });
      expect(selcx.check_recursion_limit(oblig(ambiguous, 129), oblig(ambiguous), (p: Predicate) => p)).toEqual({
        $: "Err",
        _0: { $: "Canonical" },
      });
      const empty = TraitObligationStackList.empty(ProvisionalEvaluationCache.default());
      expect(selcx.evaluate_predicate_recursively(empty, oblig(ambiguous, 200))).toEqual({ $: "Err", _0: { $: "Canonical" } });
    }),
  );

  test(
    "coinductive_match and can_use_global_caches",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const selcx = SelectionContext.new(infcx);
      expect(selcx.coinductive_match([])).toBe(true);
      expect(selcx.coinductive_match([pred(tcx, { $: "Ambiguous" })])).toBe(false);

      const def_id = new DefId(DefIndex.from_u32(5), LOCAL_CRATE);
      const global = Binder.dummy({ trait_ref: TraitRef.new(as_interner(tcx), def_id, [GenericArg.from_Ty(tcx.types.u32)]), polarity: "Positive" as const }, {
        visit_with: (_v, visitor) => visitor.Result.output(),
      });
      // Inference variables force the local caches.
      const infer = Binder.dummy(
        { trait_ref: TraitRef.new(as_interner(tcx), def_id, [GenericArg.from_Ty(infcx.next_ty_var(DUMMY_SP))]), polarity: "Positive" as const },
        { visit_with: (_v, visitor) => visitor.Result.output() },
      );
      expect(selcx.can_use_global_caches(ParamEnv.empty(), global)).toBe(true);
      expect(selcx.can_use_global_caches(ParamEnv.empty(), infer)).toBe(false);
    }),
  );
});
