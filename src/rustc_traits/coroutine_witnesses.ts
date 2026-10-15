// Port of compiler/rustc_traits/src/coroutine_witnesses.rs (lane selcx-contract).
//
// PORT: `mir_coroutine_witnesses` returns `Option<&CoroutineLayout>` (rustc_middle mir/query.rs, M4: the query value is
// `unknown` until MIR lands); `CoroutineLayoutFieldTys` is the view of the one field this file reads. `tcx.arena` /
// `&List::empty()` are the interned lists.

import { RawList } from "../rustc_middle/ty/list.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import type { ArgOutlivesClause } from "../rustc_middle/ty/predicate.ts";
import { fold_List_Ty } from "../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { fold_with_QueryRegionConstraint, type QueryRegionConstraint, try_fold_with_QueryRegionConstraint, visit_with_QueryRegionConstraint } from "../rustc_middle/infer/canonical.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Binder, type BoundVariableKind, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_regions, fold_Vec, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { BoundVar } from "../rustc_type_ir/lib.ts";
import { RegionConstraint } from "../rustc_type_ir/predicate.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import {
  type CoroutineWitnessTypes,
  fold_with_CoroutineWitnessTypes,
  try_fold_with_CoroutineWitnessTypes,
  visit_with_CoroutineWitnessTypes,
} from "../rustc_type_ir/ty_kind.gen.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { assert } from "../std/panic.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { Term } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind } from "../rustc_middle/ty/predicate.ts";
import { make_query_region_constraints } from "../rustc_infer/infer/canonical/query_response.ts";
import { ObligationCtxt, with_replaced_escaping_bound_vars } from "../rustc_trait_selection/traits/mod.ts";

/** PORT: the field of `CoroutineLayout` (rustc_middle mir/query.rs, M4) read here. */
interface CoroutineLayoutFieldTys {
  field_tys: readonly { ty: Ty; ignore_for_traits: boolean }[];
}

const d_CoroutineWitnessTypes: TypeFoldable<CoroutineWitnessTypes> = {
  visit_with: visit_with_CoroutineWitnessTypes,
  try_fold_with: try_fold_with_CoroutineWitnessTypes,
  fold_with: fold_with_CoroutineWitnessTypes,
};
const d_QueryRegionConstraint: TypeFoldable<QueryRegionConstraint> = {
  visit_with: visit_with_QueryRegionConstraint,
  try_fold_with: try_fold_with_QueryRegionConstraint,
  fold_with: fold_with_QueryRegionConstraint,
};

/// Return the set of types that should be taken into account when checking
/// trait bounds on a coroutine's internal state. This properly replaces
/// `ReErased` with new existential bound lifetimes.
// rustc: compiler/rustc_traits/src/coroutine_witnesses.rs:12 coroutine_hidden_types
export function coroutine_hidden_types(tcx: TyCtxt, def_id: DefId): EarlyBinder<Binder<CoroutineWitnessTypes>> {
  const coroutine_layout = tcx.mir_coroutine_witnesses(def_id) as CoroutineLayoutFieldTys | undefined;
  const vars: BoundVariableKind[] = [];
  const field_tys = coroutine_layout === undefined ? [] : coroutine_layout.field_tys;
  const bound_tys = tcx.mk_type_list_from_iter(
    (function* (): Generator<Ty> {
      for (const decl of field_tys) {
        if (decl.ignore_for_traits) continue;
        const ty = fold_regions(
          tcx,
          decl.ty,
          (re, debruijn) => {
            assert(re === tcx.lifetimes.re_erased, "assertion `left == right` failed: re == tcx.lifetimes.re_erased");
            const var_ = BoundVar.from_usize(vars.length);
            vars.push({ $: "Region", _0: { $: "Anon" } });
            return Region.new_bound(tcx, debruijn, { var: var_, kind: { $: "Anon" } });
          },
          fold_Ty,
        );
        yield ty;
      }
    })(),
  );

  const assumptions = compute_assumptions(tcx, def_id, bound_tys);

  return EarlyBinder.bind(tcx, Binder.bind_with_vars({ types: bound_tys, assumptions }, tcx.mk_bound_variable_kinds(vars)), Binder_fold(d_CoroutineWitnessTypes));
}

/** `Binder<T>: TypeFoldable` */
function Binder_fold<T>(d: TypeFoldable<T>): TypeFoldable<Binder<T>> {
  return (require("../rustc_type_ir/binder.ts") as typeof import("../rustc_type_ir/binder.ts")).fold_Binder(d);
}

// FIXME: The assumptions are only used in the old solver when `-Zhigher-ranked-assumptions`
// is true. `-Zhigher-ranked-assumptions` is superseded by `assumptions-on-binders`.
// We can remove this function soon.
// rustc: compiler/rustc_traits/src/coroutine_witnesses.rs:52 compute_assumptions
function compute_assumptions(tcx: TyCtxt, def_id: DefId, bound_tys: List<Ty>): List<ArgOutlivesClause> {
  if (!tcx.sess.opts.unstable_opts.higher_ranked_assumptions) {
    return RawList.empty<ArgOutlivesClause>();
  }

  const infcx = tcx.infer_ctxt().build({ $: "Typeck", defining_opaque_types_and_generators: RawList.empty() });
  const d_outlives: TypeFoldable<List<ArgOutlivesClause>> = (require("../rustc_middle/ty/structural_impls.ts") as typeof import("../rustc_middle/ty/structural_impls.ts"))
    .fold_RegionAssumptions as TypeFoldable<List<ArgOutlivesClause>>;
  return with_replaced_escaping_bound_vars(
    infcx,
    [undefined],
    bound_tys,
    (bound_tys) => {
      const param_env = tcx.param_env(def_id) as import("../rustc_middle/ty/decls.ts").ParamEnv;
      const ocx = ObligationCtxt.new(infcx);

      ocx.register_obligations(
        bound_tys.map((ty) => Obligation.new(tcx, ObligationCause.dummy(), param_env, { $: "WellFormed", _0: Term.from_Ty(ty) }, Predicate_upcast_from_ClauseKind as never)),
      );
      const _errors = ocx.evaluate_obligations_error_on_ambiguity();

      const region_obligations = infcx.take_registered_region_obligations();
      const region_assumptions = infcx.take_registered_region_assumptions();
      const region_constraints = infcx.take_and_reset_region_constraints();

      const constraints = infcx.deeply_resolve_via_unification_table(
        make_query_region_constraints(region_obligations, region_constraints, region_assumptions).constraints,
        fold_Vec(d_QueryRegionConstraint) as TypeFoldable<QueryRegionConstraint[]>,
      );

      const out: ArgOutlivesClause[] = [];
      for (const { constraint } of constraints) {
        for (const o of RegionConstraint.iter_outlives(constraint)) {
          // FIXME(higher_ranked_auto): We probably should deeply resolve these before
          // filtering out infers which only correspond to unconstrained infer regions
          // which we can sometimes get.
          if (!TypeVisitableExt.has_infer(o, d_ArgOutlivesClause())) out.push(o as ArgOutlivesClause);
        }
      }
      return tcx.mk_outlives_from_iter(out);
    },
    fold_List_Ty,
    d_outlives,
  );
}

/** `ArgOutlivesClause: TypeVisitable` (rustc_middle structural_impls.ts's list element impl). */
function d_ArgOutlivesClause(): import("../rustc_type_ir/visit.ts").TypeVisitable<ArgOutlivesClause> {
  const g = require("../rustc_type_ir/predicate.gen.ts") as typeof import("../rustc_type_ir/predicate.gen.ts");
  const ga = require("../rustc_middle/ty/generic_args.ts") as typeof import("../rustc_middle/ty/generic_args.ts");
  return { visit_with: (self, v) => g.visit_with_OutlivesClause(self, v, ga.visit_with_GenericArg) };
}
