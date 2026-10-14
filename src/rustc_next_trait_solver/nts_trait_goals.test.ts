// Lane nts-trait-goals: unit tests of solve/trait_goals.rs (the `GoalKind` impl for `TraitClause` and the
// `EvalCtxt` methods of the file) on real interned types and a fake `EvalCtxt`.
//
// The `EvalCtxt` methods of other lanes that these fns call (probes, `evaluate_added_goals_and_make_canonical_response`,
// `forced_ambiguity`, `add_goal(s)`, `enter_forall_with_assumptions`, `try_merge_candidates`, `bail_with_ambiguity`,
// `filter_specialized_impls`) are faked per test on an `Object.create(EvalCtxt.prototype)` object: they record their
// calls and build a recognizable `Candidate`. Interner queries the tests need are faked on the `TyCtxt` instance.
// Since merge-w16a every rustc_next_trait_solver file is ported; real goals end to end need a `SolverDelegate` (wave 17).
import { describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv, Predicate } from "../rustc_middle/ty/decls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitClause } from "../rustc_middle/ty/predicate.ts";
import { CrateNum, DefId, DefId_eq, type DefIndex, LocalDefId } from "../rustc_span/def_id.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TraitClause } from "../rustc_type_ir/decls.ts";
import type { ClausePolarity } from "../rustc_type_ir/predicate.ts";
import type { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { type BoundVarKinds, RawList } from "../rustc_middle/ty/list.ts";
import type { CandidateHeadUsages } from "../rustc_type_ir/search_graph/mod.ts";
import {
  type BuiltinImplSource,
  type CandidateSource,
  type CanonicalResponse,
  Certainty,
  type Goal,
  type GoalSource,
  type MaybeInfo,
  MaybeInfo as MaybeInfoC,
  type NoSolutionOrRerunNonErased,
} from "../rustc_type_ir/solve/mod.ts";
import { Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { EvalCtxt } from "./decls.ts";
import type { Candidate, FailedCandidateInfo } from "./solve/assembly/mod.ts";
import { GoalKind_TraitClause, trait_predicate_with_def_id } from "./solve/trait_goals.ts";

// ---- fixtures ----------------------------------------------------------------------------------------------------

/** A `TyCtxt` over fresh interners (nts-eval's test fixture), plus faked interner queries. */
function mk_tcx(fakes: Record<string, unknown> = {}): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    sess: { opts: { unstable_opts: { renormalize_rigid_aliases: false, assumptions_on_binders: false } } },
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  Object.assign(tcx, fakes);
  return tcx;
}

const did = (index: number) => new DefId(index as DefIndex, 0 as CrateNum);
const TRAIT = did(1);
const param_env = {} as ParamEnv;
const HEAD_USAGES = { usages: "fake" } as unknown as CandidateHeadUsages;
const NO_SOLUTION = Err({ $: "NoSolution", _0: {} });

function trait_goal(tcx: TyCtxt, args: Ty[], polarity: ClausePolarity = "Positive", def_id = TRAIT): Goal<TraitClause> {
  return { param_env, predicate: { trait_ref: { def_id, args: tcx.mk_args(args), _use_trait_ref_new_instead: null }, polarity } };
}

/** A fake canonical response: only its certainty matters to these tests. */
function response(certainty: Certainty): CanonicalResponse {
  return { value: { certainty } } as unknown as CanonicalResponse;
}

interface Log {
  goals: [GoalSource, Goal<Predicate>][];
  probes: CandidateSource[];
  ambiguities: MaybeInfo[];
  bailed: number;
}

/** The fake `EvalCtxt` (header). `extra` overrides or adds methods. */
function mk_ecx(tcx: TyCtxt, typing_mode: TypingMode = { $: "PostAnalysis" }, extra: Record<string, unknown> = {}): { ecx: EvalCtxt; log: Log } {
  const log: Log = { goals: [], probes: [], ambiguities: [], bailed: 0 };
  const ecx = Object.create(EvalCtxt.prototype) as EvalCtxt;
  const probe = (source: CandidateSource) => ({
    enter(f: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>): Result<Candidate, NoSolutionOrRerunNonErased> {
      log.probes.push(source);
      const r = f(ecx);
      if (r.$ === "Err") return r;
      return Ok({ source, result: r._0, head_usages: HEAD_USAGES });
    },
  });
  Object.assign(ecx, {
    cx: () => tcx,
    typing_mode: () => typing_mode,
    probe_builtin_trait_candidate: (source: BuiltinImplSource) => probe({ $: "BuiltinImpl", _0: source }),
    probe_trait_candidate: probe,
    evaluate_added_goals_and_make_canonical_response: (c: Certainty) => Ok(response(c)),
    forced_ambiguity: (maybe: MaybeInfo) => {
      log.ambiguities.push(maybe);
      return Ok({ source: { $: "BuiltinImpl", _0: { $: "Misc" } }, result: response({ $: "Maybe", _0: maybe }), head_usages: HEAD_USAGES });
    },
    add_goal: (source: GoalSource, goal: Goal<Predicate>) => {
      log.goals.push([source, goal]);
      return Ok(undefined);
    },
    add_goals: (source: GoalSource, goals: Iterable<Goal<Predicate>>) => {
      for (const g of goals) log.goals.push([source, g]);
      return Ok(undefined);
    },
    enter_forall_with_assumptions: <T, U>(value: Binder<T>, _pe: ParamEnv, f: (ecx: EvalCtxt, v: T) => U) => f(ecx, Binder.skip_binder(value)),
    bail_with_ambiguity: () => {
      log.bailed++;
      return response(Certainty.AMBIGUOUS);
    },
    ...extra,
  });
  return { ecx, log };
}

/** `Ok(v)` of a merge result (a mutable tuple), for `toEqual`. */
const ok_merged = (v: unknown[]): never => Ok(v) as never;

const certainty_of = (r: Result<Candidate, NoSolutionOrRerunNonErased>) => (r.$ === "Ok" ? r._0.result.value.certainty : undefined);

// ---- tests -------------------------------------------------------------------------------------------------------

describe("GoalKind for TraitClause: accessors", () => {
  const tcx = mk_tcx();
  const goal = trait_goal(tcx, [tcx.types.u8, tcx.types.bool]);
  test("self_ty / trait_ref / trait_def_id / with_replaced_self_ty / additional alias assumptions", () => {
    expect(GoalKind_TraitClause.self_ty(goal.predicate)).toBe(tcx.types.u8);
    expect(GoalKind_TraitClause.trait_ref(goal.predicate, tcx)).toBe(goal.predicate.trait_ref);
    expect(DefId_eq(GoalKind_TraitClause.trait_def_id(goal.predicate, tcx), TRAIT)).toBe(true);
    const replaced = GoalKind_TraitClause.with_replaced_self_ty(goal.predicate, tcx, tcx.types.char);
    expect([...replaced.trait_ref.args]).toEqual([tcx.types.char, tcx.types.bool]);
    expect(replaced.polarity).toBe("Positive");
    const { ecx } = mk_ecx(tcx);
    expect(GoalKind_TraitClause.consider_additional_alias_assumptions(ecx, goal, {} as never)).toEqual([]);
  });

  test("trait_predicate_with_def_id swaps the trait and keeps args and polarity", () => {
    const pred = trait_goal(tcx, [tcx.types.u8], "Negative").predicate;
    const clause = trait_predicate_with_def_id(tcx, Binder.bind_with_vars(pred, RawList.empty() as unknown as BoundVarKinds), did(7));
    const k = Binder.skip_binder(clause.kind());
    expect(k.$).toBe("Trait");
    if (k.$ === "Trait") {
      expect(DefId_eq(k._0.trait_ref.def_id, did(7))).toBe(true);
      expect(k._0.trait_ref.args).toBe(pred.trait_ref.args);
      expect(k._0.polarity).toBe("Negative");
    }
  });
});

describe("builtin candidates", () => {
  const tcx = mk_tcx();
  const neg = (self_ty: Ty) => trait_goal(tcx, [self_ty], "Negative");

  test("negative goals are rejected by every positive-only builtin candidate", () => {
    const { ecx } = mk_ecx(tcx);
    const g = neg(tcx.types.u8);
    const G = GoalKind_TraitClause;
    for (const r of [
      G.consider_auto_trait_candidate(ecx, g),
      G.consider_trait_alias_candidate(ecx, g),
      G.consider_builtin_sizedness_candidates(ecx, g, "Sized"),
      G.consider_builtin_copy_clone_candidate(ecx, g),
      G.consider_builtin_fn_trait_candidates(ecx, g, "Fn"),
      G.consider_builtin_async_fn_trait_candidates(ecx, g, "Fn"),
      G.consider_builtin_tuple_candidate(ecx, g),
      G.consider_builtin_pointee_candidate(ecx, g),
      G.consider_builtin_future_candidate(ecx, g),
      G.consider_builtin_iterator_candidate(ecx, g),
      G.consider_builtin_fused_iterator_candidate(ecx, g),
      G.consider_builtin_async_iterator_candidate(ecx, g),
      G.consider_builtin_coroutine_candidate(ecx, g),
      G.consider_builtin_discriminant_kind_candidate(ecx, g),
      G.consider_builtin_destruct_candidate(ecx, g),
      G.consider_builtin_transmute_candidate(ecx, g),
      G.consider_builtin_bikeshed_guaranteed_no_drop_candidate(ecx, g),
      G.consider_builtin_try_as_dyn_candidate(ecx, g),
      G.consider_builtin_field_candidate(ecx, g),
    ]) {
      expect(r).toEqual(NO_SOLUTION);
    }
    expect(G.consider_structural_builtin_unsize_candidates(ecx, g)).toEqual(Ok([]));
  });

  test("Tuple holds for tuples (incl. `()`) and not for `u8`", () => {
    for (const self_ty of [tcx.types.unit, Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool])]) {
      const { ecx, log } = mk_ecx(tcx);
      const r = GoalKind_TraitClause.consider_builtin_tuple_candidate(ecx, trait_goal(tcx, [self_ty]));
      expect(r.$).toBe("Ok");
      expect(certainty_of(r)).toEqual(Certainty.Yes);
      expect(log.probes).toEqual([{ $: "BuiltinImpl", _0: { $: "Misc" } }]);
    }
    const { ecx } = mk_ecx(tcx);
    expect(GoalKind_TraitClause.consider_builtin_tuple_candidate(ecx, trait_goal(tcx, [tcx.types.u8]))).toEqual(NO_SOLUTION);
  });

  test("Pointee, DiscriminantKind and Destruct hold for every type", () => {
    const { ecx } = mk_ecx(tcx);
    const g = trait_goal(tcx, [tcx.types.str_]);
    expect(certainty_of(GoalKind_TraitClause.consider_builtin_pointee_candidate(ecx, g))).toEqual(Certainty.Yes);
    expect(certainty_of(GoalKind_TraitClause.consider_builtin_discriminant_kind_candidate(ecx, g))).toEqual(Certainty.Yes);
    expect(certainty_of(GoalKind_TraitClause.consider_builtin_destruct_candidate(ecx, g))).toEqual(Certainty.Yes);
  });

  test("FnPtr: `u8: FnPtr` fails, `u8: !FnPtr` holds (rigid), `?0: !FnPtr` fails", () => {
    const { ecx } = mk_ecx(tcx);
    expect(GoalKind_TraitClause.consider_builtin_fn_ptr_trait_candidate(ecx, trait_goal(tcx, [tcx.types.u8]))).toEqual(NO_SOLUTION);
    expect(certainty_of(GoalKind_TraitClause.consider_builtin_fn_ptr_trait_candidate(ecx, neg(tcx.types.u8)))).toEqual(Certainty.Yes);
    expect(GoalKind_TraitClause.consider_builtin_fn_ptr_trait_candidate(ecx, neg(tcx.types.ty_vars[0]!))).toEqual(NO_SOLUTION);
  });

  test("Future / Iterator / FusedIterator / AsyncIterator / Coroutine need a coroutine self type", () => {
    const { ecx } = mk_ecx(tcx);
    const g = trait_goal(tcx, [tcx.types.u8]);
    for (const r of [
      GoalKind_TraitClause.consider_builtin_future_candidate(ecx, g),
      GoalKind_TraitClause.consider_builtin_iterator_candidate(ecx, g),
      GoalKind_TraitClause.consider_builtin_fused_iterator_candidate(ecx, g),
      GoalKind_TraitClause.consider_builtin_async_iterator_candidate(ecx, g),
      GoalKind_TraitClause.consider_builtin_coroutine_candidate(ecx, g),
    ]) {
      expect(r).toEqual(NO_SOLUTION);
    }
  });

  test("AsyncFnKindHelper compares the closure kinds encoded as i8 / i16 / i32", () => {
    const { ecx } = mk_ecx(tcx);
    const [Fn, FnMut, FnOnce] = [tcx.types.i8, tcx.types.i16, tcx.types.i32];
    const helper = (a: Ty, b: Ty) => GoalKind_TraitClause.consider_builtin_async_fn_kind_helper_candidate(ecx, trait_goal(tcx, [a, b]));
    expect(certainty_of(helper(Fn, FnOnce))).toEqual(Certainty.Yes);
    expect(certainty_of(helper(FnMut, FnMut))).toEqual(Certainty.Yes);
    expect(helper(FnOnce, Fn)).toEqual(NO_SOLUTION);
    expect(helper(tcx.types.ty_vars[0]!, Fn)).toEqual(NO_SOLUTION);
    expect(() => GoalKind_TraitClause.consider_builtin_async_fn_kind_helper_candidate(ecx, trait_goal(tcx, [Fn]))).toThrow(
      new Panic("explicit panic"),
    );
  });

  test("Sized of a primitive holds trivially (no constituent goals)", () => {
    const { ecx, log } = mk_ecx(tcx);
    const r = GoalKind_TraitClause.consider_builtin_sizedness_candidates(ecx, trait_goal(tcx, [tcx.types.u8]), "Sized");
    expect(certainty_of(r)).toEqual(Certainty.Yes);
    // the probe was entered with the trivial builtin source
    expect(log.probes).toEqual([{ $: "BuiltinImpl", _0: { $: "Trivial" } }]);
    expect(log.goals).toEqual([]);
  });

  test("probe_and_evaluate_goal_for_constituent_tys adds one goal per constituent type with the self type replaced", () => {
    const { ecx, log } = mk_ecx(tcx);
    const goal = trait_goal(tcx, [Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool]), tcx.types.char]);
    const r = ecx.probe_and_evaluate_goal_for_constituent_tys({ $: "BuiltinImpl", _0: { $: "Misc" } }, goal, (_ecx, ty) => {
      const k = ty.kind();
      if (k.$ !== "Tuple") return Err({});
      return Ok(Binder.bind_with_vars([...k._0], RawList.empty() as unknown as BoundVarKinds));
    });
    expect(certainty_of(r)).toEqual(Certainty.Yes);
    expect(log.goals.map(([s]) => s)).toEqual(["ImplWhereBound", "ImplWhereBound"]);
    expect(log.goals.map(([, g]) => g.predicate)).toEqual([
      Predicate_upcast_from_TraitClause(trait_goal(tcx, [tcx.types.u8, tcx.types.char]).predicate, tcx),
      Predicate_upcast_from_TraitClause(trait_goal(tcx, [tcx.types.bool, tcx.types.char]).predicate, tcx),
    ]);
    // a failing constituent fn is `NoSolution`
    expect(ecx.probe_and_evaluate_goal_for_constituent_tys({ $: "BuiltinImpl", _0: { $: "Misc" } }, trait_goal(tcx, [tcx.types.u8]), () => Err({}))).toEqual(NO_SOLUTION);
  });
});

describe("auto traits", () => {
  test("disqualify_auto_trait_candidate_due_to_possible_impl", () => {
    let impls: DefId[] = [];
    const tcx = mk_tcx({
      ir_for_each_relevant_impl: (_tr: unknown, f: (d: DefId) => void) => {
        for (const d of impls) f(d);
      },
      is_default_trait: () => false,
      is_trait_lang_item: () => false,
    });
    const { ecx, log } = mk_ecx(tcx);
    const tup = Ty.new_tup(tcx, [tcx.types.u8]);
    // rigid type without an impl: no disqualification
    expect(ecx.disqualify_auto_trait_candidate_due_to_possible_impl(trait_goal(tcx, [tup]))).toBeUndefined();
    // rigid type with an impl: disqualified
    impls = [did(9)];
    expect(ecx.disqualify_auto_trait_candidate_due_to_possible_impl(trait_goal(tcx, [tup]))).toEqual(NO_SOLUTION);
    // `{integer}` is ambiguous
    const int_var = Ty.new_int_var(tcx, 0 as never);
    expect(certainty_of(ecx.disqualify_auto_trait_candidate_due_to_possible_impl(trait_goal(tcx, [int_var]))!)).toEqual(Certainty.AMBIGUOUS);
    expect(log.ambiguities).toEqual([MaybeInfoC.AMBIGUOUS]);
    // `?0t` is a bug
    expect(() => ecx.disqualify_auto_trait_candidate_due_to_possible_impl(trait_goal(tcx, [tcx.types.ty_vars[0]!]))).toThrow(
      new Panic("unexpected type `?0t`"),
    );
  });

  test("auto trait on a tuple: one ImplWhereBound goal per element", () => {
    const tcx = mk_tcx({ ir_for_each_relevant_impl: () => undefined, trait_is_unsafe: () => false, is_default_trait: () => false });
    const { ecx, log } = mk_ecx(tcx);
    const goal = trait_goal(tcx, [Ty.new_tup(tcx, [tcx.types.u8, tcx.types.bool])]);
    const r = GoalKind_TraitClause.consider_auto_trait_candidate(ecx, goal);
    expect(certainty_of(r)).toEqual(Certainty.Yes);
    expect(log.probes).toEqual([{ $: "BuiltinImpl", _0: { $: "Misc" } }]);
    expect(log.goals.map(([s]) => s)).toEqual(["ImplWhereBound", "ImplWhereBound"]);
    expect(log.goals.map(([, g]) => g.predicate)).toEqual([
      Predicate_upcast_from_TraitClause(trait_goal(tcx, [tcx.types.u8]).predicate, tcx),
      Predicate_upcast_from_TraitClause(trait_goal(tcx, [tcx.types.bool]).predicate, tcx),
    ]);
  });

  test("try_stall_coroutine: only coroutines being inferred in `Typeck` stall", () => {
    const tcx = mk_tcx();
    const local = did(5);
    const coroutine = Ty.new(tcx, { $: "Coroutine", _0: local, _1: tcx.mk_args([]) });
    const typeck: TypingMode = { $: "Typeck", defining_opaque_types_and_generators: [LocalDefId.of(5 as DefIndex)] as never };
    const { ecx, log } = mk_ecx(tcx, typeck);
    expect(ecx.try_stall_coroutine(tcx.types.u8)).toBeUndefined();
    const r = ecx.try_stall_coroutine(coroutine)!;
    expect(certainty_of(r)).toEqual({ $: "Maybe", _0: { cause: { $: "Ambiguity" }, opaque_types_jank: "AllGood", stalled_on_coroutines: "Yes" } });
    expect(log.ambiguities.length).toBe(1);
    expect(mk_ecx(tcx).ecx.try_stall_coroutine(coroutine)).toBeUndefined();
  });
});

describe("merging trait candidates", () => {
  const tcx = mk_tcx({ trait_is_marker: () => false, is_sizedness_trait: () => false, trait_is_auto: () => false, is_default_trait: () => false });
  const cand = (source: CandidateSource, c: Certainty = Certainty.Yes): Candidate => ({ source, result: response(c), head_usages: HEAD_USAGES });
  const info: FailedCandidateInfo = { param_env_head_usages: HEAD_USAGES };
  const impl_ = (n: number) => cand({ $: "Impl", _0: did(n) });

  test("no candidates is NoSolution", () => {
    const { ecx } = mk_ecx(tcx);
    expect(ecx.merge_trait_candidates(TRAIT, [], info)).toEqual(Err({}));
  });

  test("a trivial builtin candidate wins; two of them hit upstream's assertion", () => {
    const { ecx } = mk_ecx(tcx);
    const trivial = cand({ $: "BuiltinImpl", _0: { $: "Trivial" } });
    const r = ecx.merge_trait_candidates(TRAIT, [cand({ $: "ParamEnv", _0: "NonGlobal" }), trivial], info);
    expect(r).toEqual(ok_merged([trivial.result, "Misc"]));
    expect(() => ecx.merge_trait_candidates(TRAIT, [trivial, impl_(3), trivial], info)).toThrow(
      new Panic("assertion failed: trivial_builtin_impls.next().is_none()"),
    );
  });

  test("non-global where-bounds are extracted and merged first (ParamEnv)", () => {
    const merged: (readonly Candidate[])[] = [];
    const ignored: unknown[] = [];
    const { ecx } = mk_ecx(tcx, { $: "PostAnalysis" }, {
      try_merge_candidates: (cs: readonly Candidate[]) => {
        merged.push([...cs]);
        return [cs[0]!.result, { $: "AlwaysApplicable", _0: 0 }];
      },
      ignore_candidate_head_usages: (u: unknown) => ignored.push(u),
    });
    const where_a = cand({ $: "ParamEnv", _0: "NonGlobal" });
    const where_b = cand({ $: "ParamEnv", _0: "Global" }, Certainty.AMBIGUOUS);
    const candidates = [impl_(3), where_a, where_b];
    expect(ecx.merge_trait_candidates(TRAIT, candidates, info)).toEqual(ok_merged([where_a.result, "ParamEnv"]));
    expect(merged).toEqual([[where_a, where_b]]);
    expect(candidates).toEqual([impl_(3)]);
    // the other where-bound, then the failed param-env candidates
    expect(ignored.length).toBe(2);
  });

  test("impls: one is used as is (Misc), two bail with ambiguity", () => {
    const { ecx, log } = mk_ecx(tcx, { $: "PostAnalysis" }, { filter_specialized_impls: () => undefined });
    expect(ecx.merge_trait_candidates(TRAIT, [impl_(3)], info)).toEqual(ok_merged([impl_(3).result, "Misc"]));
    const r = ecx.merge_trait_candidates(TRAIT, [impl_(3), impl_(4)], info);
    expect(r).toEqual(ok_merged([response(Certainty.AMBIGUOUS), undefined]));
    expect(log.bailed).toBe(1);
  });

  test("coherence merges impls without preferring where-bounds", () => {
    const { ecx, log } = mk_ecx(tcx, { $: "Coherence" });
    expect(ecx.merge_trait_candidates(TRAIT, [impl_(3)], info)).toEqual(ok_merged([impl_(3).result, "Misc"]));
    expect(ecx.merge_trait_candidates(TRAIT, [impl_(3), cand({ $: "ParamEnv", _0: "NonGlobal" })], info)).toEqual(
      ok_merged([response(Certainty.AMBIGUOUS), undefined]),
    );
    expect(log.bailed).toBe(1);
  });

  // compute_trait_goal end to end needs a real `SolverDelegate` (wave 17 trait-sel-solve); the fake EvalCtxt has none.
});
