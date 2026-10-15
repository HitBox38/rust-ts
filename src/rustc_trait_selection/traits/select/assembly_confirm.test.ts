// Unit tests of the old solver's candidate assembly (select/candidate_assembly.rs) and confirmation
// (select/confirmation.rs) (lane old-candidates-confirm). Their callers (`candidate_from_obligation_no_cache`,
// `evaluate_candidate`, ...: select/mod.rs, lanes old-select-a/-b) are still placeholders on this branch, so the
// difftest suites cannot reach this code yet; these tests drive it directly over a fresh `TyCtxt` (as traits_a.test.ts),
// with the few queries the code reads stubbed on the instance. Expected values follow upstream's match arms.

import { describe, expect, test } from "bun:test";
import "../../lib.ts";
import { Obligation, type PolyTraitObligation } from "../../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { SelectionCandidate } from "../../../rustc_middle/traits/select.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../../rustc_middle/ty/context.ts";
import * as tls from "../../../rustc_middle/ty/context/tls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { ParamEnv, Ty } from "../../../rustc_middle/ty/mod.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { as_interner, TraitRef, visit_with_TraitClause } from "../../../rustc_type_ir/predicate.ts";
import type { TraitClause } from "../../../rustc_type_ir/decls.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { type SelectionCandidateSet, SelectionContext, TraitObligationStack } from "./mod.ts";
import { ProvisionalEvaluationCache, TraitObligationStackList } from "./mod.ts";

const def = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
const SIZED = def(1);
const META_SIZED = def(2);
const COPY = def(3);
const TUPLE = def(4);
const PLAIN_TRAIT = def(5);

const LANG = new Map<number, LangItem>([
  [SIZED.index, "Sized"],
  [META_SIZED.index, "MetaSized"],
  [COPY.index, "Copy"],
  [TUPLE.index, "Tuple"],
]);

/** A `TyCtxt` over fresh interners (as traits_a.test.ts), old solver, with the queries assembly reads stubbed. */
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
  const t = tcx as unknown as Record<string, unknown>;
  t.next_trait_solver_globally = () => false;
  t.renormalize_rigid_aliases = () => false;
  t.as_lang_item = (d: DefId) => (d.krate === LOCAL_CRATE ? LANG.get(d.index) : undefined);
  t.is_trait_alias = () => false;
  t.trait_is_auto = () => false;
  t.is_sizedness_trait = (d: DefId) => d.index === SIZED.index || d.index === META_SIZED.index;
  return tcx;
}

const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

function selcx_of(tcx: TyCtxt): SelectionContext {
  const infcx = tcx.infer_ctxt().with_next_trait_solver(false).build(TypingMode.non_body_analysis());
  return SelectionContext.new(infcx);
}

function obligation(tcx: TyCtxt, trait_def_id: DefId, self_ty: Ty): PolyTraitObligation {
  const pred: TraitClause = { trait_ref: TraitRef.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(self_ty)]), polarity: "Positive" };
  return new Obligation(ObligationCause.dummy(), ParamEnv.empty(), Binder.dummy(pred, { visit_with: visit_with_TraitClause }), 0);
}

function stack(o: PolyTraitObligation): TraitObligationStack {
  const previous = TraitObligationStackList.empty(ProvisionalEvaluationCache.default());
  return new TraitObligationStack(o, o.predicate, 1, previous, 1, 0);
}

const set = (): SelectionCandidateSet => ({ vec: [], ambiguous: false });
const tags = (c: SelectionCandidateSet): string[] => c.vec.map((x) => x.$);

describe("candidate assembly (old solver)", () => {
  test(
    "assemble_candidates: an inference-variable self type takes the ambiguous fast path",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const v = selcx.infcx.next_ty_var(DUMMY_SP);
      const r = selcx.assemble_candidates(stack(obligation(tcx, PLAIN_TRAIT, v)));
      expect(r.$).toBe("Ok");
      if (r.$ === "Ok") expect(r._0).toEqual({ vec: [], ambiguous: true });
    }),
  );

  test(
    "assemble_candidates: `u32: Sized` / `str: MetaSized` give exactly one SizedCandidate; `str: Sized` none",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      // The `Sized`/`MetaSized` arm, then `assemble_candidates_from_projected_tys` (not an alias: returns),
      // caller bounds (empty param env), auto impls (not auto).
      for (const [trait_, ty, expected] of [
        [SIZED, tcx.types.u32, ["SizedCandidate"]],
        [META_SIZED, tcx.types.str_, ["SizedCandidate"]],
        [SIZED, tcx.types.str_, []],
      ] as const) {
        const r = selcx.assemble_candidates(stack(obligation(tcx, trait_, ty)));
        expect(r.$).toBe("Ok");
        if (r.$ === "Ok") {
          expect(tags(r._0)).toEqual([...expected]);
          expect(r._0.ambiguous).toBe(false);
        }
      }
    }),
  );

  test(
    "assemble_builtin_sized_candidate / assemble_builtin_copy_clone_candidate / assemble_candidate_for_tuple arms",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const tup = Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool]);
      const mut_ref = Ty.new_mut_ref(tcx, tcx.lifetimes.re_static, tcx.types.u8);

      let c = set();
      selcx.assemble_builtin_sized_candidate(tcx.types.never, c, "Sized");
      selcx.assemble_builtin_sized_candidate(tup, c, "Sized");
      expect(tags(c)).toEqual(["SizedCandidate", "SizedCandidate"]);

      c = set();
      selcx.assemble_builtin_sized_candidate(selcx.infcx.next_ty_var(DUMMY_SP), c, "Sized");
      expect(c).toEqual({ vec: [], ambiguous: true });

      // `Fresh*` types are a `bug!` (ICE).
      expect(() => selcx.assemble_builtin_sized_candidate(Ty.new_fresh(tcx, 0), set(), "Sized")).toThrow(
        "asked to assemble builtin bounds of unexpected type: FreshTy(0)",
      );

      c = set();
      selcx.assemble_builtin_copy_clone_candidate(tup, c); // builtin
      selcx.assemble_builtin_copy_clone_candidate(tcx.types.u32, c); // libcore impl
      selcx.assemble_builtin_copy_clone_candidate(mut_ref, c); // not `Copy` by design
      expect(tags(c)).toEqual(["BuiltinCandidate"]);

      c = set();
      selcx.assemble_candidate_for_tuple(obligation(tcx, TUPLE, tup), c);
      selcx.assemble_candidate_for_tuple(obligation(tcx, TUPLE, tcx.types.u32), c);
      expect(tags(c)).toEqual(["BuiltinCandidate"]);
    }),
  );

  test(
    "assemble_candidates_for_unsizing: `[T; n] -> [T]` and an inference target",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const UNSIZE = def(9);
      const arr = Ty.new_array_with_const_len(tcx, tcx.types.u8, selcx.infcx.next_const_var(DUMMY_SP));
      const slice = Ty.new_slice(tcx, tcx.types.u8);
      const mk = (a: Ty, b: Ty): PolyTraitObligation => {
        const pred: TraitClause = {
          trait_ref: TraitRef.new(as_interner(tcx), UNSIZE, [GenericArg.from_Ty(a), GenericArg.from_Ty(b)]),
          polarity: "Positive",
        };
        return new Obligation(ObligationCause.dummy(), ParamEnv.empty(), Binder.dummy(pred, { visit_with: visit_with_TraitClause }), 0);
      };
      let c = set();
      selcx.assemble_candidates_for_unsizing(mk(arr, slice), c);
      expect(tags(c)).toEqual(["BuiltinUnsizeCandidate"]);
      c = set();
      selcx.assemble_candidates_for_unsizing(mk(arr, selcx.infcx.next_ty_var(DUMMY_SP)), c);
      expect(c).toEqual({ vec: [], ambiguous: true });
    }),
  );
});

describe("confirmation (old solver)", () => {
  test(
    "confirm_candidate: candidates without nested obligations",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const o = obligation(tcx, PLAIN_TRAIT, tcx.types.u32);
      for (const cand of [SelectionCandidate.BuiltinObjectCandidate, SelectionCandidate.AsyncFnKindHelperCandidate]) {
        const r = selcx.confirm_candidate(o, cand);
        expect(r).toEqual({ $: "Ok", _0: { $: "Builtin", _0: { $: "Misc" }, _1: [] } });
      }
    }),
  );

  test(
    "confirm_candidate(SizedCandidate) reaches `sizedness_conditions` (select/mod.rs, lane old-select-b)",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const o = obligation(tcx, SIZED, tcx.types.u32);
      expect(() => selcx.confirm_candidate(o, SelectionCandidate.SizedCandidate)).toThrow(Unported);
      expect(() => selcx.confirm_candidate(o, SelectionCandidate.SizedCandidate)).toThrow(
        /rustc_trait_selection::traits::select::SelectionContext::sizedness_conditions/,
      );
    }),
  );

  test(
    "confirm_builtin_candidate of a trait that is not builtin is a `bug!`",
    sg((tcx) => {
      const selcx = selcx_of(tcx);
      const o = obligation(tcx, PLAIN_TRAIT, tcx.types.u32);
      expect(() => selcx.confirm_builtin_candidate(o)).toThrow(Panic);
    }),
  );
});
