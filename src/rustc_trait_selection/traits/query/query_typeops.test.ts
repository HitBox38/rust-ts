// Tests of lane old-query-typeops: traits/query/{normalize,dropck_outlives}.rs and traits/query/type_op/** on a real
// `InferCtxt` over fresh interners (as ../../traits_a.test.ts), with `-Znext-solver=coherence` (the old solver outside
// coherence, as the compiletest-argv suites).
//
// PORT(test): the mock `TyCtxt` has no query system: `recursion_limit` (`limits(())`) is stubbed with rustc's default
// limit (128); the fast paths that need lang items are kept out of the way by choosing predicates they reject first.
import { describe, expect, test } from "bun:test";
import "../../lib.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import type { RegionVariableOrigin } from "../../../rustc_infer/infer/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { DropckConstraint } from "../../../rustc_middle/traits/query.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../../rustc_middle/ty/context.ts";
import * as tls from "../../../rustc_middle/ty/context/tls.ts";
import { ParamEnv, Term, Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind } from "../../../rustc_middle/ty/predicate.ts";
import { CRATE_DEF_ID } from "../../../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Symbol as Sym } from "../../../rustc_span/symbol.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN, PRETTY } from "../../../std/fmt.ts";
import { Ok } from "../../../std/result.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { compute_dropck_outlives_inner, dtorck_constraint_for_ty_inner, trivial_dropck_outlives } from "./dropck_outlives.ts";
import { ObligationCtxt } from "../engine.ts";
import { CustomTypeOp, debug_CustomTypeOp, TypeOp_CustomTypeOp } from "./type_op/custom.ts";
import { TypeOp_ParamEnvAnd } from "./type_op/mod.ts";
import { Normalizable_PolyTypeOutlivesClause, Normalizable_Ty, QueryTypeOp_Normalize } from "./type_op/normalize.ts";
import { QueryTypeOp_DropckOutlives } from "./type_op/outlives.ts";
import { QueryTypeOp_ProvePredicate, type_op_prove_predicate_with_cause } from "./type_op/prove_predicate.ts";
import { QueryTypeOp_AscribeUserType } from "./type_op/ascribe_user_type.ts";

/** A `TyCtxt` over fresh interners (as ../../traits_a.test.ts), old solver outside coherence. */
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
      opts: { trimmed_def_paths: false, actually_rustdoc: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => false;
  (tcx as unknown as { renormalize_rigid_aliases: () => boolean }).renormalize_rigid_aliases = () => false;
  // PORT(test): `limits(())` is a query; rustc's default recursion limit.
  (tcx as unknown as { recursion_limit: () => Limit }).recursion_limit = () => Limit.new(128);
  return tcx;
}

const sg = (f: (tcx: TyCtxt) => void) => () =>
  create_default_session_globals_then(() => {
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });

const misc: RegionVariableOrigin = { $: "Misc", _0: DUMMY_SP };
const param = (tcx: TyCtxt, i: number): Ty => Ty.new_param(tcx, i, Sym.intern(`T${i}`));

describe("dropck_outlives.rs", () => {
  test(
    "trivial_dropck_outlives: scalars, refs, str, never and tuples/slices of them are trivial; params are not",
    sg((tcx) => {
      const { u8, bool, char, str_, never } = tcx.types as unknown as Record<string, Ty>;
      for (const t of [u8, bool, char, str_, never, Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, param(tcx, 0))]) {
        expect(trivial_dropck_outlives(tcx, t)).toBe(true);
      }
      expect(trivial_dropck_outlives(tcx, Ty.new_tup(tcx, [u8, bool]))).toBe(true);
      expect(trivial_dropck_outlives(tcx, Ty.new_tup(tcx, []))).toBe(true);
      expect(trivial_dropck_outlives(tcx, Ty.new_slice(tcx, u8))).toBe(true);
      expect(trivial_dropck_outlives(tcx, param(tcx, 0))).toBe(false);
      expect(trivial_dropck_outlives(tcx, Ty.new_tup(tcx, [u8, param(tcx, 0)]))).toBe(false);
      expect(trivial_dropck_outlives(tcx, Ty.new_slice(tcx, param(tcx, 0)))).toBe(false);
    }),
  );

  test(
    "dtorck_constraint_for_ty_inner: params are passed forward as dtorck types; past the recursion limit the type overflows",
    sg((tcx) => {
      const typing_env = TypingEnv.fully_monomorphized();
      const t0 = param(tcx, 0);
      const t1 = param(tcx, 1);
      const c = DropckConstraint.empty();
      dtorck_constraint_for_ty_inner(tcx, typing_env, DUMMY_SP, 0, Ty.new_tup(tcx, [tcx.types.u8, t0, Ty.new_slice(tcx, t1)]), c);
      expect(c.dtorck_types).toEqual([t0, t1]);
      expect(c.outlives).toEqual([]);
      expect(c.overflows).toEqual([]);

      const c2 = DropckConstraint.empty();
      dtorck_constraint_for_ty_inner(tcx, typing_env, DUMMY_SP, 129, t0, c2);
      expect(c2.overflows).toEqual([t0]);
      expect(c2.dtorck_types).toEqual([]);
      // `value_within_limit(128)` holds (`<=`).
      const c3 = DropckConstraint.empty();
      dtorck_constraint_for_ty_inner(tcx, typing_env, DUMMY_SP, 128, t0, c3);
      expect(c3.dtorck_types).toEqual([t0]);
    }),
  );

  test(
    "compute_dropck_outlives_inner: params live for the whole function, so `(u8, T)` needs nothing",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const ocx = ObligationCtxt.new(infcx);
      const r = compute_dropck_outlives_inner(ocx, ParamEnv.empty().and({ dropped_ty: Ty.new_tup(tcx, [tcx.types.u8, param(tcx, 0)]) }), DUMMY_SP);
      expect(r.$).toBe("Ok");
      if (r.$ === "Ok") {
        expect(r._0.kinds).toEqual([]);
        expect(r._0.overflows).toEqual([]);
      }
      expect(ocx.engine.has_pending_obligations()).toBe(false);
    }),
  );

  test(
    "QueryTypeOp for DropckOutlives: the fast path answers trivial types with the default result",
    sg((tcx) => {
      const r = QueryTypeOp_DropckOutlives.try_fast_path(tcx, ParamEnv.empty().and({ dropped_ty: tcx.types.u8 }));
      expect(r).toBeDefined();
      expect(r!.kinds).toEqual([]);
      expect(r!.overflows).toEqual([]);
      expect(QueryTypeOp_DropckOutlives.try_fast_path(tcx, ParamEnv.empty().and({ dropped_ty: param(tcx, 0) }))).toBeUndefined();
    }),
  );
});

describe("query/normalize.rs", () => {
  test(
    "query_normalize (old solver): a value without aliases comes back unchanged with no obligations",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      expect(infcx.next_trait_solver()).toBe(false);
      const ty = Ty.new_tup(tcx, [tcx.types.u8, param(tcx, 0)]);
      const r = infcx.at(ObligationCause.dummy(), ParamEnv.empty()).query_normalize(ty, fold_Ty);
      expect(r.$).toBe("Ok");
      if (r.$ === "Ok") {
        expect(r._0.value).toBe(ty);
        expect(r._0.obligations).toEqual([]);
      }
    }),
  );
});

describe("type_op/normalize.rs", () => {
  test(
    "QueryTypeOp for Normalize<Ty>: the fast path returns alias-free values; PolyTypeOutlivesClause is never normalized",
    sg((tcx) => {
      const d = QueryTypeOp_Normalize(Normalizable_Ty);
      const ty = Ty.new_tup(tcx, [tcx.types.u8]);
      expect(d.try_fast_path(tcx, ParamEnv.empty().and({ value: Unnormalized.new_wip(ty) }))).toBe(ty);
      expect(() => Normalizable_PolyTypeOutlivesClause.type_op_method(tcx, undefined as never)).toThrow(
        "internal error: entered unreachable code: we never normalize PolyTypeOutlivesClause",
      );
    }),
  );
});

describe("type_op/{mod,custom,prove_predicate,ascribe_user_type}.rs", () => {
  test(
    "CustomTypeOp: Debug prints the description as a str; fully_perform scrapes no constraints from a trivial op",
    sg((tcx) => {
      const op = CustomTypeOp.new((_ocx) => Ok(tcx.types.u8), "trivial op");
      expect(debug_CustomTypeOp(op, PLAIN)).toBe('"trivial op"');
      expect(debug_CustomTypeOp(op, PRETTY)).toBe('"trivial op"');

      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const r = TypeOp_CustomTypeOp(fold_Ty).fully_perform(op, infcx, CRATE_DEF_ID, DUMMY_SP);
      expect(r.$).toBe("Ok");
      if (r.$ === "Ok") {
        expect(r._0.output).toBe(tcx.types.u8);
        expect(r._0.constraints).toBeUndefined();
        expect(r._0.error_info).toBeUndefined();
      }
    }),
  );

  test(
    "CustomTypeOp: equating `&'?0 u8` with `&'?1 u8` reaches make_query_region_constraints (pinned M4 stop)",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const r0 = infcx.next_region_var(misc);
      const r1 = infcx.next_region_var(misc);
      const a = Ty.new_imm_ref(tcx, r0, tcx.types.u8);
      const b = Ty.new_imm_ref(tcx, r1, tcx.types.u8);
      const op = CustomTypeOp.new((ocx) => {
        const e = ocx.eq(ObligationCause.dummy(), ParamEnv.empty(), a, b, ToTrace_Ty);
        return e.$ === "Ok" ? Ok(null) : (e as never);
      }, "eq refs");
      const d_unit = { visit_with: (_s: null, v: { Result: { output(): unknown } }) => v.Result.output(), try_fold_with: (s: null) => Ok(s), fold_with: (s: null) => s };
      // The op succeeds and its region constraints are scraped; turning them into query region constraints needs
      // `SubregionOrigin::to_constraint_category` (rustc_middle `mir::ConstraintCategory`, M4): the pinned stop.
      expect(() => TypeOp_CustomTypeOp(d_unit as never).fully_perform(op, infcx, 0 as never, DUMMY_SP)).toThrow(
        /rustc_middle::mir::ConstraintCategory \(mir, M4\): BoringNoLocation/,
      );
    }),
  );

  test(
    "ParamEnvAnd<ProvePredicate>::fully_perform: `WellFormed(u8)` is answered by the fast path (no query, no constraints)",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const predicate = Predicate_upcast_from_ClauseKind({ $: "WellFormed", _0: Term.from_Ty(tcx.types.u8) }, tcx);
      const key = ParamEnv.empty().and({ predicate });
      expect(QueryTypeOp_ProvePredicate.try_fast_path(tcx, key)).toBe(null);
      const r = TypeOp_ParamEnvAnd(QueryTypeOp_ProvePredicate).fully_perform(key, infcx, 0 as never, DUMMY_SP);
      expect(r.$).toBe("Ok");
      if (r.$ === "Ok") {
        expect(r._0.output).toBe(null);
        expect(r._0.constraints).toBeUndefined();
        // The fast path produced no canonical query, hence no error info.
        expect(r._0.error_info).toBeUndefined();
      }
      // `WellFormed(?0)` is not trivially WF: the fast path declines.
      const p2 = Predicate_upcast_from_ClauseKind({ $: "WellFormed", _0: Term.from_Ty(infcx.next_ty_var(DUMMY_SP)) }, tcx);
      expect(QueryTypeOp_ProvePredicate.try_fast_path(tcx, ParamEnv.empty().and({ predicate: p2 }))).toBeUndefined();
    }),
  );

  test(
    "type_op_prove_predicate_with_cause registers the predicate with the given cause; AscribeUserType has no fast path",
    sg((tcx) => {
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const ocx = ObligationCtxt.new(infcx);
      const predicate = Predicate_upcast_from_ClauseKind({ $: "WellFormed", _0: Term.from_Ty(param(tcx, 0)) }, tcx);
      const cause = ObligationCause.dummy_with_span(DUMMY_SP);
      const env = ParamEnv.empty();
      type_op_prove_predicate_with_cause(ocx, env.and({ predicate }), cause);
      const pending = ocx.engine.pending_obligations();
      expect(pending.length).toBe(1);
      expect(pending[0]!.predicate).toBe(predicate);
      expect(pending[0]!.cause.span).toBe(cause.span);
      expect(pending[0]!.param_env).toBe(env);
      expect(QueryTypeOp_AscribeUserType.try_fast_path(tcx, undefined as never)).toBeUndefined();
    }),
  );
});
