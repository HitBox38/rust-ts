//! Computes a projection goal for opaque types. This goal
//! behaves differently depending on the current `TypingMode`.
//
// Port of compiler/rustc_next_trait_solver/src/solve/project_goals/opaque_types.rs (lane nts-normalizes). The
// `EvalCtxt` method is declared in ../../decls.ts (`// solve/project_goals/opaque_types.rs:<line>`). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
// PORT: `cx.type_of(..)` / `cx.type_of_opaque_hir_typeck(..)` are reached through `as_interner(cx)` (free_alias.ts
// header). `LocalDefIds::contains` is `includes` (branded numbers).
import type { GenericArg } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg as MGenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { Predicate_upcast_from_PredicateKind } from "../../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { fold_regions } from "../../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { Term_provided } from "../../../rustc_type_ir/inherent.ts";
import { CollectAndApply_Result } from "../../../rustc_type_ir/interner.ts";
import type { OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import { as_interner, type ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import type { PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { relate_Term, relate_Ty } from "../../../rustc_type_ir/relate.ts";
import type { Goal, NoSolutionOrRerunNonErased as NoSolutionOrRerunNonErasedT, QueryResultOrRerunNonErased } from "../../../rustc_type_ir/solve/mod.ts";
import { AccessedOpaques, Certainty, GoalSource, NoSolutionOrRerunNonErased, RerunReason } from "../../../rustc_type_ir/solve/mod.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { EvalCtxt } from "../../decls.ts";
import { goal_with } from "../mod.ts";

// rustc: compiler/rustc_next_trait_solver/src/solve/project_goals/opaque_types.rs:17 normalize_opaque_type
EvalCtxt.prototype.normalize_opaque_type = function (this: EvalCtxt, goal: Goal<ProjectionClause>): QueryResultOrRerunNonErased {
  const cx = this.cx();
  const opaque_ty = goal.predicate.projection_term;
  const expected = unwrap(Term_provided.as_type(goal.predicate.term), "no such thing as an opaque const");
  const def_id = AliasTerm.expect_opaque_ty_def_id(opaque_ty);

  const typing_mode = this.typing_mode();
  switch (typing_mode.$) {
    case "Coherence": {
      // An impossible opaque type bound is the only way this goal will fail
      // e.g. assigning `impl Copy := NotCopy`
      const r1 = this.add_item_bounds_for_hidden_type(def_id, opaque_ty.args, goal.param_env, expected);
      if (r1.$ === "Err") return r1;
      // Trying to normalize an opaque type during coherence is always ambiguous.
      // We add a nested ambiguous goal here instead of using `Certainty::AMBIGUOUS`.
      // This allows us to return the nested goals to the parent `AliasRelate` goal.
      // This can then allow nested goals to fail after we've constrained the `term`.
      const r2 = this.add_goal(
        GoalSource.Misc,
        goal_with(goal, cx, { $: "Ambiguous" } as PredicateKind, Predicate_upcast_from_PredicateKind),
      );
      if (r2.$ === "Err") return r2;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
    case "Typeck":
    case "PostTypeckUntilBorrowck": {
      const defining_opaque_types =
        typing_mode.$ === "Typeck" ? typing_mode.defining_opaque_types_and_generators : typing_mode.defining_opaque_types;
      const local = def_id.as_local();
      const def_id_ = local !== undefined && defining_opaque_types.includes(local) ? local : undefined;
      if (def_id_ === undefined) {
        // If we're not in the defining scope, treat the alias as rigid.
        const r = this.eq(goal.param_env, AliasTerm.to_term(opaque_ty, cx, "Yes"), goal.predicate.term, relate_Term);
        if (r.$ === "Err") return r;
        return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      }

      // We structurally normalize the args so that we're able to detect defining uses
      // later on.
      //
      // This reduces the amount of duplicate definitions in the `opaque_type_storage` and
      // strengthens inference. This causes us to subtly depend on the normalization behavior
      // when inferring the hidden type of opaques.
      //
      // E.g. it's observable that we don't normalize nested aliases with bound vars in
      // `structurally_normalize` and because we use structural lookup, we also don't
      // reuse an entry for `Tait<for<'a> fn(&'a ())>` for `Tait<for<'b> fn(&'b ())>`.
      const self_ = this;
      const normalized_args_r = as_interner(cx).mk_args_from_iter(
        (function* (): Generator<Result<GenericArg, NoSolutionOrRerunNonErasedT>> {
          for (const arg of opaque_ty.args) {
            const k = MGenericArg.kind(arg);
            switch (k.$) {
              case "Lifetime":
                yield Ok(MGenericArg.from_Region(k._0));
                break;
              case "Type": {
                const r = self_.structurally_normalize_ty(goal.param_env, k._0);
                yield r.$ === "Err" ? r : Ok(MGenericArg.from_Ty(r._0));
                break;
              }
              case "Const": {
                const r = self_.structurally_normalize_const(goal.param_env, k._0);
                yield r.$ === "Err" ? r : Ok(MGenericArg.from_Const(r._0));
                break;
              }
            }
          }
        })(),
        CollectAndApply_Result,
      );
      if (normalized_args_r.$ === "Err") return normalized_args_r;
      const normalized_args = normalized_args_r._0;

      const opaque_type_key: OpaqueTypeKey = { def_id: def_id_, args: normalized_args };
      const prev = this.register_hidden_type_in_storage(opaque_type_key, expected);
      if (prev !== undefined) {
        const r = this.eq(goal.param_env, expected, prev, relate_Ty);
        if (r.$ === "Err") return r;
      } else {
        // During HIR typeck, opaque types start out as unconstrained
        // inference variables. In borrowck we instead use the type
        // computed in HIR typeck as the initial value.
        const mode = TypingMode.assert_not_erased(this.typing_mode());
        switch (mode.$) {
          case "Typeck":
            break;
          case "PostTypeckUntilBorrowck": {
            const actual0 = EarlyBinder.instantiate(
              as_interner(cx).type_of_opaque_hir_typeck(def_id_),
              cx,
              opaque_ty.args,
              fold_Ty,
            );
            const actual1 = Unnormalized.map(actual0, (v) =>
              fold_regions(cx, v, (re, _dbi) => (re.kind().$ === "ReErased" ? self_.next_region_var() : re), fold_Ty),
            );
            const actual = this.normalize(goal.param_env, actual1, fold_Ty);
            if (actual.$ === "Err") return actual;
            const r = this.eq(goal.param_env, expected, actual._0, relate_Ty);
            if (r.$ === "Err") return r;
            break;
          }
          case "Coherence":
          case "PostBorrowck":
          case "PostAnalysis":
          case "Reflection":
          case "Codegen":
            return unreachable();
        }
      }

      const r = this.add_item_bounds_for_hidden_type(
        LocalDefId.to_def_id(def_id_),
        normalized_args,
        goal.param_env,
        expected,
      );
      if (r.$ === "Err") return r;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
    case "PostBorrowck": {
      const defined_opaque_types = typing_mode.defined_opaque_types;
      const local = def_id.as_local();
      const def_id_ = local !== undefined && defined_opaque_types.includes(local) ? local : undefined;
      if (def_id_ === undefined) {
        const r = this.eq(goal.param_env, AliasTerm.to_term(opaque_ty, cx, "Yes"), goal.predicate.term, relate_Term);
        if (r.$ === "Err") return r;
        return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
      }

      const actual0 = EarlyBinder.instantiate(
        as_interner(cx).type_of(LocalDefId.to_def_id(def_id_)),
        cx,
        opaque_ty.args,
        fold_Ty,
      );
      // FIXME: Actually use a proper binder here instead of relying on `ReErased`.
      //
      // This is also probably unsound or sth :shrug:
      const self_ = this;
      const actual1 = Unnormalized.map(actual0, (v) =>
        fold_regions(cx, v, (re, _dbi) => (re.kind().$ === "ReErased" ? self_.next_region_var() : re), fold_Ty),
      );
      const actual = this.normalize(goal.param_env, actual1, fold_Ty);
      if (actual.$ === "Err") return actual;
      const r = this.eq(goal.param_env, expected, actual._0, relate_Ty);
      if (r.$ === "Err") return r;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
    // FIXME(try_as_dyn): probably want to treat opaques opaquely and rigid
    case "Reflection":
    case "PostAnalysis":
    case "Codegen": {
      // FIXME: Add an assertion that opaque type storage is empty.
      const actual0 = EarlyBinder.instantiate(as_interner(cx).type_of(def_id), cx, opaque_ty.args, fold_Ty);
      const actual = this.normalize(goal.param_env, actual0, fold_Ty);
      if (actual.$ === "Err") return actual;
      const r = this.eq(goal.param_env, expected, actual._0, relate_Ty);
      if (r.$ === "Err") return r;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
    case "ErasedNotCoherence": {
      // If we have a local defid, in other typing modes we check whether
      // this is the defining scope, and otherwise treat it as rigid.
      // However, in `ErasedNotcoherence` we *always* treat it as rigid.
      // This is the same as other modes if def_id is None, but wrong if we do have a DefId.
      // Thus we should rerun if the opaque is in the defining scope. And we should do
      // so immediately, otherwise we might continue evaluating with rigid opaques that
      // should be revealed and trigger query cycle when leaking it for auto trait.
      // See `tests/ui/traits/next-solver/normalize/always-rerun-normalizing-opaques.rs`.
      //
      // FIXME: verify that we can get away with not rerunning immediately when
      // normalizing foreign opaques. Currently we don't do so because that would greatly
      // worsen the compilation time of `wg-grammar`.
      if (def_id.as_local() !== undefined) {
        const r = AccessedOpaques.rerun_always(this.opaque_accesses, RerunReason.NormalizeOpaqueType);
        if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
        return r._0;
      } else {
        const r = AccessedOpaques.rerun_if_in_post_analysis(this.opaque_accesses, RerunReason.NormalizeOpaqueTypeRemoteCrate);
        if (r.$ === "Err") return Err(NoSolutionOrRerunNonErased.from_RerunNonErased(r._0));
      }

      // Always treat the opaque type as rigid.
      const r = this.eq(goal.param_env, AliasTerm.to_term(opaque_ty, cx, "Yes"), goal.predicate.term, relate_Term);
      if (r.$ === "Err") return r;
      return this.evaluate_added_goals_and_make_canonical_response(Certainty.Yes);
    }
  }
};
