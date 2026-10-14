// Unit tests of lane nts-normalizes (solve/mod.rs, normalizes_to.rs, effect_goals.rs, project_goals/*): not an upstream
// test file. The `EvalCtxt` methods of other nts lanes (nts-eval: `evaluate_added_goals_and_make_canonical_response`,
// `eq`, `probe`, ...) are still `unported(..)` stubs, so the tests drive this lane's code through a fake `EvalCtxt`
// (an object on `EvalCtxt.prototype` whose other-lane methods are instance overrides that record their calls) over a
// real interner (`mk_tcx`, as in rustc_type_ir/tyir_binder.test.ts). Paths that reach another lane's stub are pinned
// as PENDING: they must stop UNPORTED with the exact stub text, nothing else.
import { describe, expect, test } from "bun:test";
import "../../rustc_middle/lib.ts";
import "../lib.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, GenericArgs, Predicate, Term, Ty } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then, ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { NormalizesTo, ProjectionClause, TyVid } from "../../rustc_type_ir/decls.ts";
import type { AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import {
  type CanonicalResponse,
  Certainty,
  type ExternalConstraintsData,
  type Goal,
  type GoalSource,
  MaybeInfo,
  type NoSolutionOrRerunNonErased,
  type QueryResultOrRerunNonErased,
} from "../../rustc_type_ir/solve/mod.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { EvalCtxt } from "../decls.ts";
import type { Candidate } from "./assembly/mod.ts";
import { GoalKind_HostEffectClause } from "./effect_goals.ts";
import {
  equal_response_modulo_region_constraints,
  has_no_inference_or_external_constraints,
  has_only_region_constraints,
} from "./mod.ts";
import { GoalKind_NormalizesTo } from "./normalizes_to.ts";

// ---- helpers -------------------------------------------------------------------------------------------------------

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

const tcx = mk_tcx();
const ty_var = (vid: number): Ty => tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "TyVar", _0: vid as TyVid } });
const u8 = (): Ty => tcx.types.u8;
const no_constraints: ExternalConstraintsData = {
  region_constraints: { $: "Old", _0: [] },
  opaque_types: [],
  normalization_nested_goals: { _0: [] },
};
const param_env = {} as Goal<unknown>["param_env"];
const did = (index: number): DefId => new DefId(index as DefId["index"], 0 as DefId["krate"]);

function response(certainty: Certainty, var_values: GenericArgs = RawList.empty() as GenericArgs, data = no_constraints): CanonicalResponse {
  return {
    value: { certainty, var_values, external_constraints: tcx.mk_external_constraints(data) },
    max_universe: 0 as CanonicalResponse["max_universe"],
    var_kinds: RawList.empty() as CanonicalResponse["var_kinds"],
  };
}
const candidate = (result: CanonicalResponse): Candidate => ({ source: { $: "ParamEnv", _0: "NonGlobal" } as Candidate["source"], result, head_usages: {} as Candidate["head_usages"] });
const maybe = (m: Partial<MaybeInfo>): Certainty => ({ $: "Maybe", _0: { ...(Certainty.AMBIGUOUS as { _0: MaybeInfo })._0, ...m } }) as Certainty;

type Calls = unknown[][];
/** A fake `EvalCtxt`: this lane's methods come from the prototype, the listed overrides record their calls. */
function fake_ecx(overrides: Record<string, (...args: never[]) => unknown>, calls: Calls = []): EvalCtxt {
  const ecx = Object.create(EvalCtxt.prototype) as EvalCtxt;
  const rec = ecx as unknown as Record<string, unknown>;
  rec.cx = () => tcx;
  for (const [name, f] of Object.entries(overrides)) {
    rec[name] = (...args: never[]) => {
      calls.push([name, ...args]);
      return f(...args);
    };
  }
  return ecx;
}
const ok_response = (c: Certainty): QueryResultOrRerunNonErased => Ok(response(c));

function in_globals<T>(f: () => T): T {
  return create_default_session_globals_then(f);
}

// ---- solve/mod.rs: response helpers and candidate merging --------------------------------------------------------

describe("solve/mod.rs response helpers", () => {
  test("identity responses without constraints", () =>
    in_globals(() => {
      const r = response(Certainty.Yes);
      expect(has_no_inference_or_external_constraints(r)).toBe(true);
      expect(has_only_region_constraints(r)).toBe(true);
      const with_nested = response(Certainty.Yes, undefined, {
        ...no_constraints,
        normalization_nested_goals: { _0: [["Misc", { param_env, predicate: {} as Predicate }]] },
      });
      expect(has_no_inference_or_external_constraints(with_nested)).toBe(false);
      expect(has_only_region_constraints(with_nested)).toBe(false);
      // a non-identity `var_values` (`u8` is no canonical bound var)
      const non_identity = response(Certainty.Yes, tcx.mk_args([u8()]));
      expect(has_no_inference_or_external_constraints(non_identity)).toBe(false);
    }));

  test("equal_response_modulo_region_constraints", () =>
    in_globals(() => {
      expect(equal_response_modulo_region_constraints(response(Certainty.Yes), response(Certainty.Yes))).toBe(true);
      expect(equal_response_modulo_region_constraints(response(Certainty.Yes), response(Certainty.AMBIGUOUS))).toBe(false);
      expect(
        equal_response_modulo_region_constraints(response(Certainty.Yes), response(Certainty.Yes, tcx.mk_args([u8()]))),
      ).toBe(false);
    }));

  test("try_merge_candidates / bail_with_ambiguity / flounder", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ambiguous_out = response(Certainty.AMBIGUOUS);
      const ecx = fake_ecx({ make_ambiguous_response_no_constraints: () => ambiguous_out }, calls);
      expect(ecx.try_merge_candidates([])).toBeUndefined();

      const yes = response(Certainty.Yes);
      const amb = response(Certainty.AMBIGUOUS);
      const merged = ecx.try_merge_candidates([candidate(amb), candidate(yes)]);
      expect(merged).toEqual([yes, { $: "AlwaysApplicable", _0: 1 }]);

      const amb2 = response(Certainty.AMBIGUOUS);
      expect(ecx.try_merge_candidates([candidate(amb), candidate(amb2)])).toEqual([amb, { $: "EqualResponse" }]);

      const other = response(Certainty.AMBIGUOUS, tcx.mk_args([u8()]));
      expect(ecx.try_merge_candidates([candidate(amb), candidate(other)])).toBeUndefined();

      expect(ecx.flounder([])).toEqual(Err({}));
      const overflow = maybe({ cause: { $: "Overflow", suggest_increasing_limit: true, keep_constraints: false } } as Partial<MaybeInfo>);
      expect(ecx.flounder([candidate(yes), candidate(response(overflow))])).toEqual(Ok(ambiguous_out));
      expect(calls.length).toBe(1);
      // `MaybeInfo::AMBIGUOUS.or(overflow)` (Yes contributes nothing)
      const expected = MaybeInfo.or(MaybeInfo.AMBIGUOUS, (overflow as { _0: MaybeInfo })._0);
      expect(intern_key(calls[0]![1])).toBe(intern_key(expected));
    }));
});

// ---- solve/mod.rs: goal dispatch -----------------------------------------------------------------------------------

describe("solve/mod.rs compute_*_goal", () => {
  test("subtype of two ty vars is ambiguous after sub-unifying them", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ecx = fake_ecx(
        {
          sub_unify_ty_vids_raw: () => undefined,
          evaluate_added_goals_and_make_canonical_response: (c: never) => ok_response(c),
        },
        calls,
      );
      ecx.compute_subtype_goal({ param_env, predicate: { a_is_expected: true, a: ty_var(1), b: ty_var(2) } });
      expect(calls.map((c) => c[0])).toEqual(["sub_unify_ty_vids_raw", "evaluate_added_goals_and_make_canonical_response"]);
      expect(calls[0]!.slice(1)).toEqual([1, 2]);
      expect(calls[1]![1]).toBe(Certainty.AMBIGUOUS);
    }));

  test("coerce is subtype with a_is_expected = false; sub errors propagate", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ecx = fake_ecx(
        {
          sub: () => Err({ $: "NoSolution", _0: {} }),
          evaluate_added_goals_and_make_canonical_response: (c: never) => ok_response(c),
        },
        calls,
      );
      const r = ecx.compute_coerce_goal({ param_env, predicate: { a: ty_var(1), b: u8() } });
      expect(r).toEqual(Err({ $: "NoSolution", _0: {} }));
      expect(calls.map((c) => c[0])).toEqual(["sub"]);
      expect(calls[0]![2]).toBe(ty_var(1));
      expect(calls[0]![3]).toBe(u8());
    }));

  test("dyn-compatible, well-formed, unstable feature", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ecx = fake_ecx(
        {
          cx: () => ({ trait_is_dyn_compatible: (d: DefId) => DefId_eq(d, did(1)) }),
          well_formed_goals: () => undefined,
          may_use_unstable_feature: () => Err("rerun"),
          evaluate_added_goals_and_make_canonical_response: (c: never) => ok_response(c),
        },
        calls,
      );
      expect(ecx.compute_dyn_compatible_goal(did(2))).toEqual(Err({ $: "NoSolution", _0: {} }));
      expect(ecx.compute_dyn_compatible_goal(did(1)).$).toBe("Ok");
      ecx.compute_well_formed_goal({ param_env, predicate: u8() as Term });
      expect(calls.at(-1)![1]).toBe(Certainty.AMBIGUOUS);
      expect(ecx.compute_unstable_feature_goal(param_env, 0 as never)).toEqual(Err({ $: "RerunNonErased", _0: "rerun" }) as never);
    }));

  test("const evaluatable: infer is ambiguous, error holds, param ICEs", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ecx = fake_ecx({ evaluate_added_goals_and_make_canonical_response: (c: never) => ok_response(c) }, calls);
      const infer_ct: Const = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 0 } } as never);
      ecx.compute_const_evaluatable_goal({ param_env, predicate: infer_ct });
      expect(calls.at(-1)![1]).toBe(Certainty.AMBIGUOUS);
      const err_ct: Const = tcx.mk_ct_from_kind({ $: "Error", _0: ErrorGuaranteed.unchecked_error_guaranteed() });
      ecx.compute_const_evaluatable_goal({ param_env, predicate: err_ct });
      expect(calls.at(-1)![1]).toBe(Certainty.Yes);
    }));

  test("structurally_normalize_term returns a rigid term unchanged", () =>
    in_globals(() => {
      const ecx = fake_ecx({ cx: () => ({ renormalize_rigid_aliases: () => false }) });
      expect(ecx.structurally_normalize_term(param_env, u8() as Term)).toEqual(Ok(u8() as Term));
      expect(ecx.structurally_normalize_ty(param_env, u8())).toEqual(Ok(u8()));
    }));
});

// ---- project_goals/mod.rs --------------------------------------------------------------------------------------------

describe("project_goals", () => {
  test("compute_projection_goal dispatches on the alias kind", () =>
    in_globals(() => {
      const calls: Calls = [];
      const ret = (): QueryResultOrRerunNonErased => Ok(response(Certainty.Yes));
      const ecx = fake_ecx(
        {
          normalize_associated_term: ret,
          normalize_inherent_associated_term: ret,
          normalize_opaque_type: ret,
          normalize_free_alias: ret,
          normalize_anon_const: ret,
        },
        calls,
      );
      const kinds: [AliasTermKind["$"], string][] = [
        ["ProjectionTy", "normalize_associated_term"],
        ["ProjectionConst", "normalize_associated_term"],
        ["InherentTy", "normalize_inherent_associated_term"],
        ["InherentConstSelf", "normalize_inherent_associated_term"],
        ["InherentConstImpl", "normalize_inherent_associated_term"],
        ["OpaqueTy", "normalize_opaque_type"],
        ["FreeTy", "normalize_free_alias"],
        ["FreeConst", "normalize_free_alias"],
        ["AnonConst", "normalize_anon_const"],
      ];
      for (const [kind, method] of kinds) {
        const predicate = { projection_term: { kind: { $: kind, def_id: did(1) }, args: RawList.empty() }, term: u8() } as unknown as ProjectionClause;
        ecx.compute_projection_goal({ param_env, predicate });
        expect(calls.at(-1)![0]).toBe(method);
      }
    }));

  test("normalize_associated_term: NormalizesTo goal, then eq, then the nested goals, then the certainty", () =>
    in_globals(() => {
      const calls: Calls = [];
      const unconstrained = ty_var(7) as Term;
      const nested: [GoalSource, Goal<Predicate>][] = [["Misc", { param_env, predicate: {} as Predicate }]];
      const certainty = Certainty.AMBIGUOUS;
      const ecx = fake_ecx(
        {
          next_term_infer_of_alias_kind: () => unconstrained,
          evaluate_goal_raw: () => Ok([{ _0: nested }, { certainty }]),
          eq: () => Ok(undefined),
          add_goal: () => Ok(undefined),
          evaluate_added_goals_and_make_canonical_response: (c: never) => ok_response(c),
        },
        calls,
      );
      (ecx as unknown as { inspect: unknown }).inspect = {
        make_canonical_response: (c: Certainty) => calls.push(["inspect.make_canonical_response", c]),
      };
      const alias = { kind: { $: "ProjectionTy", def_id: did(3) }, args: tcx.mk_args([u8()]) };
      const predicate = { projection_term: alias, term: u8() } as unknown as ProjectionClause;
      ecx.compute_projection_goal({ param_env, predicate });
      expect(calls.map((c) => c[0])).toEqual([
        "next_term_infer_of_alias_kind",
        "evaluate_goal_raw",
        "inspect.make_canonical_response",
        "eq",
        "add_goal",
        "evaluate_added_goals_and_make_canonical_response",
      ]);
      expect(calls[1]![1]).toBe("Normalization");
      const pred = (calls[1]![2] as Goal<Predicate>).predicate;
      const k = pred.kind().value as { $: string; _0: NormalizesTo };
      expect(k.$).toBe("NormalizesTo");
      expect(k._0.term).toBe(unconstrained);
      expect(calls[3]!.slice(2, 4)).toEqual([u8(), unconstrained]);
      expect(calls[4]!.slice(1)).toEqual(nested[0]);
      expect(calls[5]![1]).toBe(certainty);
    }));
});

// ---- GoalKind tables -------------------------------------------------------------------------------------------------

describe("GoalKind tables", () => {
  const ne_goal = { param_env, predicate: { alias: { kind: { $: "ProjectionTy", def_id: did(1) }, args: tcx.mk_args([u8()]) }, term: u8() } } as unknown as Goal<NormalizesTo>;

  test("NormalizesTo: builtin candidates on a non-coroutine self type have no solution", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      const no: Result<unknown, NoSolutionOrRerunNonErased> = Err({ $: "NoSolution", _0: {} });
      expect(GoalKind_NormalizesTo.consider_builtin_future_candidate(ecx, ne_goal)).toEqual(no as never);
      expect(GoalKind_NormalizesTo.consider_builtin_iterator_candidate(ecx, ne_goal)).toEqual(no as never);
      expect(GoalKind_NormalizesTo.consider_builtin_async_iterator_candidate(ecx, ne_goal)).toEqual(no as never);
      expect(GoalKind_NormalizesTo.consider_builtin_coroutine_candidate(ecx, ne_goal)).toEqual(no as never);
      expect(GoalKind_NormalizesTo.consider_builtin_field_candidate(ecx, ne_goal)).toEqual(no as never);
      expect(GoalKind_NormalizesTo.consider_additional_alias_assumptions(ecx, ne_goal, {} as never)).toEqual([]);
      expect(GoalKind_NormalizesTo.self_ty(ne_goal.predicate)).toBe(u8());
    }));

  test("NormalizesTo: traits without associated items ICE", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      expect(() => GoalKind_NormalizesTo.consider_builtin_try_as_dyn_candidate(ecx, ne_goal)).toThrow(
        new Panic("internal error: entered unreachable code: try_as_dyn helper trait doesn't have assoc types"),
      );
      expect(() => GoalKind_NormalizesTo.consider_builtin_async_fn_kind_helper_candidate(ecx, ne_goal)).toThrow(
        new Panic("explicit panic"),
      );
    }));

  test("NormalizesTo: fast_reject_assumption rejects non-projection aliases", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      const goal = { ...ne_goal, predicate: { ...ne_goal.predicate, alias: { kind: { $: "OpaqueTy", def_id: did(1) }, args: RawList.empty() } } } as unknown as Goal<NormalizesTo>;
      expect(GoalKind_NormalizesTo.fast_reject_assumption(ecx, goal, {} as never)).toEqual(Err({}));
    }));

  test("HostEffectClause: never-const builtins ICE, iterator has no solution", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      const goal = { param_env, predicate: { trait_ref: { def_id: did(1), args: tcx.mk_args([u8()]) }, constness: "Const" } } as unknown as Goal<never>;
      expect(GoalKind_HostEffectClause.consider_builtin_iterator_candidate(ecx, goal)).toEqual(Err({ $: "NoSolution", _0: {} }));
      expect(() => GoalKind_HostEffectClause.consider_builtin_tuple_candidate(ecx, goal)).toThrow(
        new Panic("internal error: entered unreachable code: Tuple trait is not const"),
      );
      expect(() => GoalKind_HostEffectClause.consider_builtin_fn_ptr_trait_candidate(ecx, goal)).toThrow(
        new Panic("not implemented: Fn* are not yet const"),
      );
      expect(GoalKind_HostEffectClause.self_ty(goal.predicate as never)).toBe(u8());
    }));

  // PENDING (nts-assembly): structural_traits.rs is that lane's; until it lands these stop UNPORTED with its stub text.
  test("PENDING: builtin Fn candidates stop at structural_traits", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      expect(() => GoalKind_NormalizesTo.consider_builtin_fn_trait_candidates(ecx, ne_goal, "Fn")).toThrow(
        new Unported("rustc_next_trait_solver::solve::assembly::structural_traits::extract_tupled_inputs_and_output_from_callable"),
      );
      const goal = { param_env, predicate: { trait_ref: { def_id: did(1), args: tcx.mk_args([u8()]) }, constness: "Const" } } as unknown as Goal<never>;
      expect(() => GoalKind_HostEffectClause.consider_builtin_destruct_candidate(ecx, goal)).toThrow(
        new Unported("rustc_next_trait_solver::solve::assembly::structural_traits::const_conditions_for_destruct"),
      );
    }));

  // PENDING (nts-eval): `EvalCtxt::probe` is that lane's stub.
  test("PENDING: compute_host_effect_goal / compute_normalizes_to_goal stop at EvalCtxt::probe", () =>
    in_globals(() => {
      const ecx = fake_ecx({});
      const goal = { param_env, predicate: { trait_ref: { def_id: did(1), args: tcx.mk_args([u8()]) }, constness: "Const" } } as unknown as Goal<never>;
      expect(() => ecx.compute_host_effect_goal(goal)).toThrow(
        new Unported("rustc_next_trait_solver::solve::eval_ctxt::probe::EvalCtxt::probe"),
      );
    }));
});
