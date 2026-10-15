// Tests of lane old-project: traits/project.rs on a real `InferCtxt` over fresh interners (as ../traits_a.test.ts):
// `ProjectionCandidateSet::push_candidate`, the projection-cache paths of `opt_normalize_projection_term`, `Progress`,
// `ProjectionCacheKey::from_poly_projection_obligation` (`project` itself: traits/old_solve.test.ts, against the oracle).
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { Obligation, type PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import { Normalized, ProjectionCacheKey } from "../../rustc_infer/traits/project.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import * as tls from "../../rustc_middle/ty/context/tls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { ParamEnv, Term, Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { as_interner, TraitRef, visit_with_ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Panic } from "../../std/panic.ts";
import {
  opt_normalize_projection_term,
  type ProjectionCandidate,
  ProjectionCandidateSet,
  ProjectionCacheKey_from_poly_projection_obligation,
  Progress,
} from "./project.ts";
import { SelectionContext } from "./select/mod.ts";

/** A `TyCtxt` over fresh interners, old solver (`-Znext-solver=coherence`, as traits_a.test.ts's `sg_old`). */
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

const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

const def = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);

/** `<u8 as Trait>::Assoc` with `Assoc = def(item)` (no `generics_of` needed: `new_from_args` does not check). */
function projection(tcx: TyCtxt, item: number, self_ty: Ty) {
  return AliasTerm.new_from_args(tcx, { $: "ProjectionTy", def_id: def(item) }, tcx.mk_args([GenericArg.from_Ty(self_ty)]));
}

function clause_candidate(tcx: TyCtxt, $: "ParamEnv" | "TraitDef" | "Object", term: Ty): ProjectionCandidate {
  return { $, _0: Binder.dummy({ projection_term: projection(tcx, 7, tcx.types.u8), term: Term.from_Ty(term) }, { visit_with: visit_with_ProjectionClause }) } as ProjectionCandidate;
}

describe("ProjectionCandidateSet::push_candidate", () => {
  test(
    "None -> Single; duplicates are dropped; ParamEnv beats later candidates; two different ParamEnv are ambiguous",
    sg((tcx) => {
      const set: MutRef<ProjectionCandidateSet> = { value: ProjectionCandidateSet.None };
      const p1 = clause_candidate(tcx, "ParamEnv", tcx.types.u8);
      expect(ProjectionCandidateSet.push_candidate(set, p1)).toBe(true);
      expect(set.value.$).toBe("Single");
      // A structurally equal duplicate is a lazy dedup: still `Single`.
      expect(ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "ParamEnv", tcx.types.u8))).toBe(false);
      expect(set.value.$).toBe("Single");
      // ParamEnv over a non-ParamEnv candidate: discarded, still `Single`.
      expect(ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "TraitDef", tcx.types.u16))).toBe(false);
      expect(set.value.$).toBe("Single");
      // A different ParamEnv candidate: ambiguous.
      expect(ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "ParamEnv", tcx.types.u16))).toBe(false);
      expect(set.value.$).toBe("Ambiguous");
      // Ambiguous / Error swallow everything.
      expect(ProjectionCandidateSet.push_candidate(set, p1)).toBe(false);
      expect(set.value.$).toBe("Ambiguous");
      ProjectionCandidateSet.mark_error(set, { $: "Unimplemented" });
      expect(ProjectionCandidateSet.push_candidate(set, p1)).toBe(false);
      expect(set.value.$).toBe("Error");
    }),
  );

  test(
    "two non-ParamEnv candidates are ambiguous; a ParamEnv candidate after a non-ParamEnv one is a bug",
    sg((tcx) => {
      const set: MutRef<ProjectionCandidateSet> = { value: ProjectionCandidateSet.None };
      expect(ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "TraitDef", tcx.types.u8))).toBe(true);
      expect(ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "Object", tcx.types.u8))).toBe(false);
      expect(set.value.$).toBe("Ambiguous");

      const set2: MutRef<ProjectionCandidateSet> = { value: ProjectionCandidateSet.None };
      ProjectionCandidateSet.push_candidate(set2, clause_candidate(tcx, "Object", tcx.types.u8));
      expect(() => ProjectionCandidateSet.push_candidate(set2, clause_candidate(tcx, "ParamEnv", tcx.types.u8))).toThrow(
        "should never prefer non-param-env candidates over param-env candidates",
      );
    }),
  );
});

describe("opt_normalize_projection_term: the projection cache", () => {
  test(
    "Ambiguous -> Ok(None); InProgress -> Err(InProgress) and marks Recur; Recur -> Err; NormalizedTerm -> the cached term and obligations",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      expect(infcx.next_trait_solver()).toBe(false);
      const selcx = SelectionContext.new(infcx);
      const env = ParamEnv.empty();
      const cause = () => ObligationCause.dummy();

      // Ambiguous.
      const a = projection(tcx, 7, tcx.types.u8);
      const ka = ProjectionCacheKey.new(a, env);
      expect(infcx.inner.projection_cache().try_start(ka).$).toBe("Ok");
      infcx.inner.projection_cache().ambiguous(ka);
      const out: PredicateObligation[] = [];
      expect(opt_normalize_projection_term(selcx, env, a, cause(), 0, out)).toEqual({ $: "Ok", _0: undefined });

      // InProgress: a recursive normalization; the entry becomes `Recur`, which then also reports `InProgress`.
      const b = projection(tcx, 8, tcx.types.u8);
      const kb = ProjectionCacheKey.new(b, env);
      expect(infcx.inner.projection_cache().try_start(kb).$).toBe("Ok");
      expect(opt_normalize_projection_term(selcx, env, b, cause(), 0, out).$).toBe("Err");
      const eb = infcx.inner.projection_cache().try_start(kb);
      expect(eb.$ === "Err" && eb._0.$).toBe("Recur");
      expect(opt_normalize_projection_term(selcx, env, b, cause(), 0, out).$).toBe("Err");

      // NormalizedTerm: the term, and its obligations appended to `obligations`.
      const c = projection(tcx, 9, tcx.types.u8);
      const kc = ProjectionCacheKey.new(c, env);
      expect(infcx.inner.projection_cache().try_start(kc).$).toBe("Ok");
      const tr = TraitRef.new(as_interner(tcx), def(3), [GenericArg.from_Ty(tcx.types.u8)]);
      const ob = Obligation.new(tcx, cause(), env, tr, Predicate_upcast_from_TraitRef as never) as PredicateObligation;
      infcx.inner.projection_cache().insert_term(kc, new Normalized(Term.from_Ty(tcx.types.u16), [ob]));
      expect(out.length).toBe(0);
      expect(opt_normalize_projection_term(selcx, env, c, cause(), 0, out)).toEqual({ $: "Ok", _0: Term.from_Ty(tcx.types.u16) });
      expect(out.length).toBe(1);
      expect(out[0]!.predicate).toBe(ob.predicate);
    }),
  );

  // An unstarted projection runs `project` (candidate assembly from the param env, the trait def's item bounds and the
  // impls, then confirmation): that needs the query system, so traits/old_solve.test.ts drives
  // `normalize_projection_term` -> `opt_normalize_projection_term` on a real compiler session and checks the normalized
  // terms and obligations against rustc's (old_solve_test/probe.rs).
});

describe("Progress and ProjectionCacheKey::from_poly_projection_obligation", () => {
  test(
    "with_addl_obligations appends (and drains the argument); from_poly_projection_obligation keys on the resolved term",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const selcx = SelectionContext.new(infcx);
      const env = ParamEnv.empty();
      const tr = TraitRef.new(as_interner(tcx), def(3), [GenericArg.from_Ty(tcx.types.u8)]);
      const ob = Obligation.new(tcx, ObligationCause.dummy(), env, tr, Predicate_upcast_from_TraitRef as never) as PredicateObligation;
      const more = [ob];
      const p = new Progress({ value: Term.from_Ty(tcx.types.u8), _tcx: undefined }, []).with_addl_obligations(more);
      expect(p.obligations.length).toBe(1);
      expect(more.length).toBe(0);

      const pred = { projection_term: projection(tcx, 7, tcx.types.u8), term: Term.from_Ty(tcx.types.u16) };
      const poly = Binder.dummy(pred, { visit_with: visit_with_ProjectionClause });
      const key = ProjectionCacheKey_from_poly_projection_obligation(selcx, new Obligation(ObligationCause.dummy(), env, poly, 0));
      expect(key).toBeDefined();
      expect(key!.term).toEqual(pred.projection_term);
    }),
  );

  test(
    "push_candidate's bug is an ICE (Panic)",
    sg((tcx) => {
      const set: MutRef<ProjectionCandidateSet> = { value: { $: "Single", _0: clause_candidate(tcx, "TraitDef", tcx.types.u8) } };
      expect(() => ProjectionCandidateSet.push_candidate(set, clause_candidate(tcx, "ParamEnv", tcx.types.u8))).toThrow(Panic);
    }),
  );
});
