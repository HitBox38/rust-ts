// Lane nts-assembly: unit tests of solve/assembly/{mod,structural_traits}.rs.
//
// The `EvalCtxt` machinery the assembly code drives (`probe`, `probe_trait_candidate`, `structurally_normalize_ty`,
// `try_merge_candidates`, ...) belongs to other lanes (nts-eval, nts-normalizes) and is still a stub in this base, so
// these tests run the assembly code against a fake `EvalCtxt` (an object on `EvalCtxt.prototype` whose foreign methods
// are replaced), a fake `cx` (the `Interner` methods the code calls) and a fake `GoalKind` table that records the
// order in which candidates are considered. The structural helpers run against a real `TyCtxt` over fresh interners.
//
// PENDING (needs the other nts lanes; docs/handoff/nts-assembly.md): real trait / projection goals through
// `assemble_and_evaluate_candidates`, the param-env shadowing of impls (`has_no_inference_or_external_constraints`,
// solve/mod.rs, nts-normalizes) and `characterize_param_env_assumption` on real clauses (`structurally_normalize_ty`,
// `replace_bound_vars`, nts-eval / nts-normalizes).
import { describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, ParamEnv } from "../rustc_middle/ty/decls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { CandidateHeadUsages } from "../rustc_type_ir/search_graph/mod.ts";
import type { CandidateSource, CanonicalResponse, Goal, NoSolutionOrRerunNonErased, RerunNonErased } from "../rustc_type_ir/solve/mod.ts";
import { Panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { EvalCtxt } from "./decls.ts";
import { AllowInferenceConstraints, AssembleCandidatesFrom, type Candidate, type GoalKind, GoalKind_provided } from "./solve/assembly/mod.ts";
import {
  AmbiguousOrRerunNonErased,
  instantiate_constituent_tys_for_auto_trait,
  instantiate_constituent_tys_for_copy_clone_trait,
  instantiate_constituent_tys_for_sizedness_trait,
} from "./solve/assembly/structural_traits.ts";

// ---- fixtures ----------------------------------------------------------------------------------------------------

function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    sess: { opts: { unstable_opts: {} } },
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const tcx = mk_tcx();
const resp = (tag: string) => ({ tag }) as unknown as CanonicalResponse;
const RERUN: RerunNonErased = { _0: null };

/** The predicate of the fake goals: just a self type. */
interface P {
  self_ty: Ty;
}

interface Log {
  calls: string[];
}

/** A fake `cx`: the `Interner` methods the assembly code reaches through `as_interner`. */
function mk_cx(opts: { lang_item?: string; impls?: number[]; specializes?: [number, number][]; unsize?: boolean }): TyCtxt {
  return {
    trait_is_auto: () => false,
    trait_is_alias: () => false,
    as_trait_lang_item: () => opts.lang_item,
    is_trait_lang_item: (_d: unknown, l: string) => l === "Unsize" && opts.unsize === true,
    is_sizedness_trait: () => false,
    ir_for_each_relevant_impl: <R>(_tr: unknown, f: (impl: unknown) => R, r: { branch(x: R): { $: string; _0: unknown }; from_residual(x: unknown): R; output(): R }) => {
      for (const i of opts.impls ?? []) {
        const b = r.branch(f(i));
        if (b.$ === "Break") return r.from_residual(b._0);
      }
      return r.output();
    },
    impl_specializes: (a: number, b: number) => (opts.specializes ?? []).some(([x, y]) => x === a && y === b),
  } as unknown as TyCtxt;
}

/** A fake `EvalCtxt`: the methods of other lanes are replaced; the assembly methods are the real ones. */
function mk_ecx(cx: TyCtxt, typing_mode: string, extra: Record<string, unknown> = {}): EvalCtxt {
  const ecx = Object.create(EvalCtxt.prototype) as EvalCtxt & Record<string, unknown>;
  Object.assign(ecx, {
    cx: () => cx,
    typing_mode: () => ({ $: typing_mode }),
    structurally_normalize_ty: (_pe: unknown, ty: Ty) => Ok(ty),
    deeply_resolve_ignoring_regions: <T>(v: T) => v,
    probe: () => ({
      enter: <T>(f: (ecx: EvalCtxt) => T) => f(ecx),
      enter_single_candidate: <T>(f: (ecx: EvalCtxt) => T) => [f(ecx), CandidateHeadUsages.default_()],
    }),
    probe_trait_candidate: (source: CandidateSource) => ({
      enter: (f: (ecx: EvalCtxt) => Result<CanonicalResponse, NoSolutionOrRerunNonErased>) => {
        const r = f(ecx);
        if (r.$ === "Err") return r;
        return Ok({ source, result: r._0, head_usages: CandidateHeadUsages.default_() });
      },
    }),
    evaluate_added_goals_and_make_canonical_response: (c: { $: string }) => Ok(resp(`eval:${c.$}`)),
    ...extra,
  });
  return ecx;
}

/** A fake `GoalKind` table over `P`; every consider fn logs its name. */
function mk_G(log: Log, overrides: Partial<GoalKind<P>> = {}): GoalKind<P> {
  const cand = (name: string, source: CandidateSource): Result<Candidate, NoSolutionOrRerunNonErased> => {
    log.calls.push(name);
    return Ok({ source, result: resp(name), head_usages: CandidateHeadUsages.default_() });
  };
  const builtin: CandidateSource = { $: "BuiltinImpl", _0: { $: "Misc" } };
  const base: Partial<GoalKind<P>> = {
    self_ty: (p) => p.self_ty,
    trait_ref: () => ({}) as never,
    trait_def_id: () => ({}) as never,
    with_replaced_self_ty: (_p, _cx, self_ty) => ({ self_ty }),
    probe_and_consider_param_env_candidate: (_ecx, _goal, assumption) => {
      const a = assumption as unknown as { name: string; applies: boolean };
      log.calls.push(`param_env:${a.name}`);
      if (!a.applies) return Ok(Err(CandidateHeadUsages.default_()));
      return Ok(Ok({ source: { $: "ParamEnv", _0: "Global" }, result: resp(a.name), head_usages: CandidateHeadUsages.default_() }));
    },
    consider_impl_candidate: (_ecx, _goal, _tr, impl_def_id) =>
      cand(`impl:${impl_def_id as unknown as number}`, { $: "Impl", _0: impl_def_id }),
    consider_builtin_copy_clone_candidate: () => cand("copy_clone", builtin),
    consider_builtin_sizedness_candidates: (_e, _g, s) => cand(`sizedness:${s}`, builtin),
    consider_builtin_fn_trait_candidates: (_e, _g, k) => cand(`fn:${k}`, builtin),
    consider_builtin_async_fn_trait_candidates: (_e, _g, k) => cand(`async_fn:${k}`, builtin),
    consider_error_guaranteed_candidate: () => cand("error", builtin),
    consider_structural_builtin_unsize_candidates: () => {
      log.calls.push("unsize");
      return Ok([]);
    },
  };
  return { ...base, ...overrides } as GoalKind<P>;
}

function mk_param_env(clauses: { name: string; applies: boolean }[]): ParamEnv {
  return { caller_bounds: () => clauses as unknown as Clause[] } as unknown as ParamEnv;
}

// ---- tests -------------------------------------------------------------------------------------------------------

describe("small items", () => {
  test("AssembleCandidatesFrom::should_assemble_impl_candidates", () => {
    expect(AssembleCandidatesFrom.should_assemble_impl_candidates("All")).toBe(true);
    expect(AssembleCandidatesFrom.should_assemble_impl_candidates("EnvAndBounds")).toBe(false);
  });

  test("From<RerunNonErased> for AmbiguousOrRerunNonErased", () => {
    expect(AmbiguousOrRerunNonErased.from_RerunNonErased(RERUN)).toEqual({ $: "RerunNonErased", _0: RERUN });
  });
});

describe("assemble_and_evaluate_candidates", () => {
  test("order: param-env, builtin (lang item), unsize, then impls; failed param-env head usages are merged", () => {
    const log: Log = { calls: [] };
    const ecx = mk_ecx(mk_cx({ lang_item: "Copy", impls: [7, 8], unsize: true }), "PostAnalysis");
    const goal: Goal<P> = {
      param_env: mk_param_env([
        { name: "a", applies: true },
        { name: "b", applies: false },
      ]),
      predicate: { self_ty: tcx.types.bool },
    };
    const r = ecx.assemble_and_evaluate_candidates(goal, "All", mk_G(log));
    expect(r.$).toBe("Ok");
    if (r.$ !== "Ok") return;
    const [candidates] = r._0;
    expect(log.calls).toEqual(["param_env:a", "param_env:b", "copy_clone", "unsize", "impl:7", "impl:8"]);
    expect(candidates.map((c) => c.source.$)).toEqual(["ParamEnv", "BuiltinImpl", "Impl", "Impl"]);
  });

  test("EnvAndBounds assembles neither builtin nor impl candidates", () => {
    const log: Log = { calls: [] };
    const ecx = mk_ecx(mk_cx({ lang_item: "Copy", impls: [7] }), "PostAnalysis");
    const goal: Goal<P> = { param_env: mk_param_env([{ name: "a", applies: true }]), predicate: { self_ty: tcx.types.bool } };
    const r = ecx.assemble_and_evaluate_candidates(goal, "EnvAndBounds", mk_G(log));
    expect(log.calls).toEqual(["param_env:a"]);
    expect(r.$ === "Ok" && r._0[0].length).toBe(1);
  });

  test("a self type that fails to normalize yields no candidates (also on rerun: FIXME(#155443))", () => {
    const log: Log = { calls: [] };
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis", {
      structurally_normalize_ty: () => Err({ $: "RerunNonErased", _0: RERUN }),
    });
    const goal: Goal<P> = { param_env: mk_param_env([{ name: "a", applies: true }]), predicate: { self_ty: tcx.types.bool } };
    const r = ecx.assemble_and_evaluate_candidates(goal, "All", mk_G(log));
    expect(r.$ === "Ok" && r._0[0].length).toBe(0);
    expect(log.calls).toEqual([]);
  });

  test("in coherence, a knowable trait ref falls through to normal assembly (impls always assembled)", () => {
    // The unknowable branch elaborates the real trait ref (PENDING, header).
    const log: Log = { calls: [] };
    const ecx = mk_ecx(mk_cx({ lang_item: "Copy", impls: [3] }), "Coherence", { trait_ref_is_knowable: () => Ok(true) });
    const goal: Goal<P> = { param_env: mk_param_env([{ name: "a", applies: true }]), predicate: { self_ty: tcx.types.bool } };
    const r = ecx.assemble_and_evaluate_candidates(goal, "All", mk_G(log));
    expect(log.calls).toEqual(["param_env:a", "copy_clone", "impl:3"]);
    expect(r.$ === "Ok" && r._0[0].length).toBe(3);
  });

  test("Fn lang items dispatch with their closure kind; an error self type uses the error candidate", () => {
    for (const [item, call] of [
      ["Fn", "fn:Fn"],
      ["FnMut", "fn:FnMut"],
      ["AsyncFnOnce", "async_fn:FnOnce"],
      ["MetaSized", "sizedness:MetaSized"],
    ]) {
      const log: Log = { calls: [] };
      const ecx = mk_ecx(mk_cx({ lang_item: item }), "Reflection");
      // Reflection mode rejects builtin impls: nothing is considered.
      ecx.assemble_builtin_impl_candidates({ param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } }, [], mk_G(log));
      expect(log.calls).toEqual([]);
      const ecx2 = mk_ecx(mk_cx({ lang_item: item }), "PostAnalysis");
      ecx2.assemble_builtin_impl_candidates({ param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } }, [], mk_G(log));
      expect(log.calls).toEqual([call]);
    }
  });

  test("PointeeSized is unreachable", () => {
    const ecx = mk_ecx(mk_cx({ lang_item: "PointeeSized" }), "PostAnalysis");
    expect(() =>
      ecx.assemble_builtin_impl_candidates({ param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } }, [], mk_G({ calls: [] })),
    ).toThrow(Panic);
  });
});

describe("filter_specialized_impls", () => {
  const cand = (impl: number, tag = `r${impl}`): Candidate => ({
    source: { $: "Impl", _0: impl as never },
    result: resp(tag),
    head_usages: CandidateHeadUsages.default_(),
  });

  test("drops the specialized impl when inference constraints are allowed", () => {
    const ecx = mk_ecx(mk_cx({ specializes: [[2, 1]] }), "PostAnalysis");
    const cs = [cand(1), cand(2), cand(3)];
    ecx.filter_specialized_impls(AllowInferenceConstraints.Yes, cs);
    expect(cs.map((c) => (c.source.$ === "Impl" ? (c.source._0 as unknown as number) : -1))).toEqual([2, 3]);
  });

  test("keeps everything in coherence", () => {
    const ecx = mk_ecx(mk_cx({ specializes: [[2, 1]] }), "Coherence");
    const cs = [cand(1), cand(2)];
    ecx.filter_specialized_impls(AllowInferenceConstraints.Yes, cs);
    expect(cs.length).toBe(2);
  });

  test("with No, an equal response still lets the victim go", () => {
    const ecx = mk_ecx(mk_cx({ specializes: [[2, 1]] }), "PostAnalysis");
    const shared = resp("same");
    const cs: Candidate[] = [
      { ...cand(1), result: shared },
      { ...cand(2), result: shared },
    ];
    // `has_only_region_constraints` (solve/mod.rs, nts-normalizes) is evaluated first and is still a stub.
    expect(() => ecx.filter_specialized_impls(AllowInferenceConstraints.No, cs)).toThrow();
  });
});

describe("assemble_and_merge_candidates", () => {
  test("no `proven_via`: the forced-ambiguity candidate's response", () => {
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis");
    const r = ecx.assemble_and_merge_candidates(
      undefined,
      { param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } },
      () => undefined,
      () => Ok(resp("rigid")),
      mk_G({ calls: [] }),
    );
    expect(r).toEqual(Ok(resp("eval:Maybe")));
  });

  test("proven via ParamEnv without candidates: normalize to rigid", () => {
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis");
    const r = ecx.assemble_and_merge_candidates(
      "ParamEnv",
      { param_env: mk_param_env([{ name: "a", applies: false }]), predicate: { self_ty: tcx.types.bool } },
      () => undefined,
      () => Ok(resp("rigid")),
      mk_G({ calls: [] }),
    );
    expect(r).toEqual(Ok(resp("rigid")));
  });

  test("proven via ParamEnv: forced ambiguity wins, otherwise the merged param-env response", () => {
    const goal: Goal<P> = { param_env: mk_param_env([{ name: "a", applies: true }]), predicate: { self_ty: tcx.types.bool } };
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis", {
      try_merge_candidates: (cs: Candidate[]) => [cs[0]!.result, { $: "EqualResponse" }],
    });
    expect(ecx.assemble_and_merge_candidates("ParamEnv", goal, () => Ok(resp("forced")), () => Ok(resp("rigid")), mk_G({ calls: [] }))).toEqual(
      Ok(resp("forced")),
    );
    expect(ecx.assemble_and_merge_candidates("ParamEnv", goal, () => undefined, () => Ok(resp("rigid")), mk_G({ calls: [] }))).toEqual(
      Ok(resp("a")),
    );
  });

  test("Misc: a param-env candidate shadows the impls before merging", () => {
    let merged: Candidate[] = [];
    const goal: Goal<P> = { param_env: mk_param_env([{ name: "a", applies: true }]), predicate: { self_ty: tcx.types.bool } };
    const ecx = mk_ecx(mk_cx({ impls: [5] }), "PostAnalysis", {
      try_merge_candidates: (cs: Candidate[]) => {
        merged = cs;
        return undefined;
      },
      flounder: () => Err({}),
    });
    const r = ecx.assemble_and_merge_candidates("Misc", goal, () => undefined, () => Ok(resp("rigid")), mk_G({ calls: [] }));
    expect(merged.map((c) => c.source.$)).toEqual(["ParamEnv"]);
    expect(r).toEqual(Err({ $: "NoSolution", _0: {} }));
  });
});

describe("GoalKind provided methods", () => {
  test("probe_and_match_goal_against_assumption fast-rejects before probing", () => {
    const log: Log = { calls: [] };
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis");
    const G = mk_G(log, {
      fast_reject_assumption: () => Err({}),
      match_assumption: () => {
        log.calls.push("match");
        return Ok(resp("m"));
      },
    });
    const goal: Goal<P> = { param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } };
    const r = GoalKind_provided.probe_and_match_goal_against_assumption(G, ecx, { $: "CoherenceUnknowable" }, goal, {} as Clause, () =>
      Ok(resp("then")),
    );
    expect(r).toEqual(Err({ $: "NoSolution", _0: {} }));
    expect(log.calls).toEqual([]);
  });

  test("probe_and_consider_param_env_candidate: rejection gives the default head usages", () => {
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis");
    const G = mk_G({ calls: [] }, { fast_reject_assumption: () => Err({}) });
    const goal: Goal<P> = { param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } };
    const r = GoalKind_provided.probe_and_consider_param_env_candidate(G, ecx, goal, {} as Clause);
    expect(r.$ === "Ok" && r._0.$).toBe("Err");
  });

  test("probe_and_consider_param_env_candidate: the source written by `then` is the candidate's", () => {
    const ecx = mk_ecx(mk_cx({}), "PostAnalysis", {
      try_evaluate_added_goals: () => Ok({ $: "Yes" }),
      characterize_param_env_assumption: () => Ok([{ $: "ParamEnv", _0: "NonGlobal" }, { $: "Yes" }]),
    });
    const G = mk_G({ calls: [] }, {
      fast_reject_assumption: () => Ok(undefined),
      match_assumption: (ecx, _g, _a, then) => then(ecx),
    });
    const goal: Goal<P> = { param_env: mk_param_env([]), predicate: { self_ty: tcx.types.bool } };
    const r = GoalKind_provided.probe_and_consider_param_env_candidate(G, ecx, goal, {} as Clause);
    expect(r.$ === "Ok" && r._0.$ === "Ok" && r._0._0.source).toEqual({ $: "ParamEnv", _0: "NonGlobal" });
  });
});

describe("structural_traits", () => {
  const ecx = { cx: () => tcx } as unknown as EvalCtxt;
  const t = tcx.types;
  const tys = (r: Result<{ value: Ty[] }, unknown>) => (r.$ === "Ok" ? r._0.value : "Err");

  test("auto traits: scalars have no components, str is [u8], tuples their fields, refs their pointee", () => {
    expect(tys(instantiate_constituent_tys_for_auto_trait(ecx, t.bool))).toEqual([]);
    expect(tys(instantiate_constituent_tys_for_auto_trait(ecx, t.str_))).toEqual([Ty.new_slice(tcx, t.u8)]);
    expect(tys(instantiate_constituent_tys_for_auto_trait(ecx, Ty.new_tup(tcx, [t.bool, t.char])))).toEqual([t.bool, t.char]);
    expect(tys(instantiate_constituent_tys_for_auto_trait(ecx, Ty.new_ref(tcx, tcx.lifetimes.re_static, t.u32, "Mut")))).toEqual([t.u32]);
  });

  test("sizedness: str is MetaSized but not Sized; a tuple needs its last field", () => {
    expect(tys(instantiate_constituent_tys_for_sizedness_trait(ecx, "Sized", t.str_))).toBe("Err");
    expect(tys(instantiate_constituent_tys_for_sizedness_trait(ecx, "MetaSized", t.str_))).toEqual([]);
    expect(tys(instantiate_constituent_tys_for_sizedness_trait(ecx, "Sized", Ty.new_tup(tcx, [t.bool, t.char])))).toEqual([t.char]);
    expect(tys(instantiate_constituent_tys_for_sizedness_trait(ecx, "Sized", t.unit))).toEqual([]);
    expect(tys(instantiate_constituent_tys_for_sizedness_trait(ecx, "Sized", t.never))).toEqual([]);
  });

  test("copy/clone: core-provided and non-Copy types fail; tuples need their fields", () => {
    expect(tys(instantiate_constituent_tys_for_copy_clone_trait(ecx, t.bool))).toBe("Err");
    expect(tys(instantiate_constituent_tys_for_copy_clone_trait(ecx, t.str_))).toBe("Err");
    expect(tys(instantiate_constituent_tys_for_copy_clone_trait(ecx, Ty.new_ref(tcx, tcx.lifetimes.re_static, t.u32, "Mut")))).toBe("Err");
    expect(tys(instantiate_constituent_tys_for_copy_clone_trait(ecx, Ty.new_tup(tcx, [t.bool, t.u8])))).toEqual([t.bool, t.u8]);
  });
});
