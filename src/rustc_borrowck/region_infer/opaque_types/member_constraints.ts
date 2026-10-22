// Port of compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `CollectMemberConstraintsVisitor` (generated class) implements rustc_type_ir's `TypeVisitor<undefined>`
// (`type Result = ()`) by prototype methods; its `Result` member and the provided `visit_*` methods are the fill
// lane's (precedent rustc_trait_selection error_reporting `ParamFinder`). `&'a mut FxHashMap<..>` is the shared map.
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { fold_GenericArg, type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../../rustc_middle/ty/list.ts";
import type { Const } from "../../../rustc_middle/ty/decls.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import type { Binder } from "../../../rustc_type_ir/binder.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import type { PredicateProxy } from "../../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { type TypeVisitable, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { unreachable } from "../../../std/panic.ts";
import type { ConstraintSccIndex } from "../../constraints/mod.ts";
import { Representative } from "../mod.ts";
import { CollectMemberConstraintsVisitor } from "./member_constraints.gen.ts";
import type { DefiningUse } from "./mod.gen.ts";
import type { RegionCtxt } from "./region_ctxt.gen.ts";

export * from "./member_constraints.gen.ts";

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:14 apply_member_constraints
export function apply_member_constraints(rcx: RegionCtxt, defining_uses: readonly DefiningUse[]): void {
  // Start by collecting the member constraints of all defining uses.
  //
  // Applying member constraints can influence other member constraints,
  // so we first collect and then apply them.
  const member_constraints = new Map<ConstraintSccIndex, DefiningUse[]>();
  for (const defining_use of defining_uses) {
    const visitor = new CollectMemberConstraintsVisitor(rcx, defining_use, member_constraints);
    fold_Ty.visit_with(defining_use.hidden_type.ty, visitor);
  }

  // Now walk over the region graph, visiting the smallest regions first and then all
  // regions which have to outlive that one.
  //
  // Whenever we encounter a member region, we mutate the value of this SCC. This is
  // as if we'd introduce new outlives constraints. However, we discard these region
  // values after we've inferred the hidden types of opaques and apply the region
  // constraints by simply equating the actual hidden type with the inferred one.
  // debug!(?member_constraints);
  for (const scc_a of rcx.constraint_sccs.all_sccs()) {
    // debug!(?scc_a);
    // Start by adding the region values required by outlives constraints. This
    // matches how we compute the final region values in `fn compute_regions`.
    //
    // We need to do this here to get a lower bound when applying member constraints.
    // This propagates the region values added by previous member constraints.
    for (const scc_b of rcx.constraint_sccs.successors(scc_a)) {
      // debug!(?scc_b);
      rcx.scc_values.add_region(scc_a, scc_b);
    }

    for (const defining_use of member_constraints.get(scc_a) ?? []) {
      apply_member_constraint(rcx, scc_a, defining_use.arg_regions);
    }
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:59 apply_member_constraint
function apply_member_constraint(rcx: RegionCtxt, member: ConstraintSccIndex, arg_regions: readonly RegionVid[]): void {
  // If the member region lives in a higher universe, we currently choose
  // the most conservative option by leaving it unchanged.
  if (!UniverseIndex.is_root(rcx.max_placeholder_universe_reached(member))) {
    // debug!("member region reached non root universe, bailing");
    return;
  }

  // The existing value of `'member` is a lower-bound. If its is already larger than
  // some universal region, we cannot equate it with that region. Said differently, we
  // ignore choice regions which are smaller than this member region.
  let choice_regions: RegionVid[] = [];
  for (const r of arg_regions) {
    const choice_region = Representative.rvid(rcx.representative(r));
    let all = true;
    for (const lower_bound of rcx.scc_values.universal_regions_outlived_by(member)) {
      if (!rcx.universal_region_relations.outlives_(choice_region, lower_bound)) {
        all = false;
        break;
      }
    }
    if (all) choice_regions.push(choice_region);
  }
  // debug!(?choice_regions, "after enforcing lower-bound");

  // Now find all the *upper bounds* -- that is, each UB is a
  // free region that must outlive the member region `R0` (`UB:
  // R0`). Therefore, we need only keep an option `O` if `UB: O`
  // for all UB.
  //
  // If we have a requirement `'upper_bound: 'member`, equating `'member`
  // with some region `'choice` means we now also require `'upper_bound: 'choice`.
  // Avoid choice regions for which this does not hold.
  for (const ub of rcx.rev_scc_graph.upper_bounds(member)) {
    choice_regions = choice_regions.filter((choice_region) => rcx.universal_region_relations.outlives_(ub, choice_region));
  }
  // debug!(?choice_regions, "after enforcing upper-bound");

  // At this point we can pick any member of `choice_regions` and would like to choose
  // it to be a small as possible. To avoid potential non-determinism we will pick the
  // smallest such choice.
  //
  // Because universal regions are only partially ordered (i.e, not every two regions are
  // comparable), we will ignore any region that doesn't compare to all others when picking
  // the minimum choice.
  //
  // For example, consider `choice_regions = ['static, 'a, 'b, 'c, 'd, 'e]`, where
  // `'static: 'a, 'static: 'b, 'a: 'c, 'b: 'c, 'c: 'd, 'c: 'e`.
  // `['d, 'e]` are ignored because they do not compare - the same goes for `['a, 'b]`.
  const totally_ordered_subset = choice_regions.filter((r1) =>
    choice_regions.every(
      (r2) => rcx.universal_region_relations.outlives_(r1, r2) || rcx.universal_region_relations.outlives_(r2, r1),
    ),
  );
  // Now we're left with `['static, 'c]`. Pick `'c` as the minimum!
  let min_choice: RegionVid | undefined;
  for (const r2 of totally_ordered_subset) {
    if (min_choice === undefined) {
      min_choice = r2;
      continue;
    }
    const r1 = min_choice;
    const r1_outlives_r2 = rcx.universal_region_relations.outlives_(r1, r2);
    const r2_outlives_r1 = rcx.universal_region_relations.outlives_(r2, r1);
    if (r1_outlives_r2 && r2_outlives_r1) {
      min_choice = (r1 <= r2 ? r1 : r2);
    } else if (r1_outlives_r2 && !r2_outlives_r1) {
      min_choice = r2;
    } else if (!r1_outlives_r2 && r2_outlives_r1) {
      min_choice = r1;
    } else {
      bug("incomparable regions in total order");
    }
  }
  if (min_choice === undefined) {
    // debug!("no unique minimum choice");
    return;
  }

  // debug!(?min_choice);
  // Lift the member region to be at least as large as this `min_choice` by directly
  // mutating the `scc_values` as we compute it. This acts as if we've added a
  // `'member: 'min_choice` while not recomputing sccs. This means different sccs
  // may now actually be equal.
  const min_choice_scc = rcx.constraint_sccs.scc(min_choice);
  rcx.scc_values.add_region(member, min_choice_scc);
}

declare module "./member_constraints.gen.ts" {
  interface CollectMemberConstraintsVisitor {
    // member_constraints.rs:147
    cx(): TyCtxt;
    // member_constraints.rs:150
    visit_closure_args(def_id: DefId, args: GenericArgsRef): void;
    // member_constraints.rs:158: `impl TypeVisitor<TyCtxt> for CollectMemberConstraintsVisitor`
    visit_region(r: Region): undefined;
    // member_constraints.rs:169
    visit_ty(ty: Ty): undefined;
    /** `type Result = ()`. */
    readonly Result: VisitorResult<undefined, never>;
    // (provided) the `TypeVisitor` methods `CollectMemberConstraintsVisitor` does not override.
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined;
    visit_const(c: Const): undefined;
    visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined;
    visit_clauses(c: Clauses): undefined;
    visit_error(guar: ErrorGuaranteed): undefined;
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:147 cx
CollectMemberConstraintsVisitor.prototype.cx = function (this: CollectMemberConstraintsVisitor): TyCtxt {
  return this.rcx.infcx.tcx;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:150 visit_closure_args
CollectMemberConstraintsVisitor.prototype.visit_closure_args = function (
  this: CollectMemberConstraintsVisitor,
  def_id: DefId,
  args: GenericArgsRef,
): void {
  const generics = this.cx().generics_of(def_id) as Generics;
  for (let i = generics.parent_count; i < args.length; i++) {
    const arg = args[i]!;
    fold_GenericArg.visit_with(arg, this);
  }
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for CollectMemberConstraintsVisitor<'_, '_, 'tcx>
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:158 visit_region
CollectMemberConstraintsVisitor.prototype.visit_region = function (this: CollectMemberConstraintsVisitor, r: Region): undefined {
  const k = r.kind();
  switch (k.$) {
    case "ReBound":
      return undefined;
    case "ReVar": {
      const vid = k._0;
      const scc = this.rcx.constraint_sccs.scc(vid);
      let entry = this.member_constraints.get(scc);
      if (entry === undefined) {
        entry = [];
        this.member_constraints.set(scc, entry);
      }
      entry.push(this.defining_use);
      break;
    }
    default:
      return unreachable();
  }
  return undefined;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:169 visit_ty
CollectMemberConstraintsVisitor.prototype.visit_ty = function (this: CollectMemberConstraintsVisitor, ty: Ty): undefined {
  if (!TypeFlags.intersects(ty.flags(), TypeFlags.HAS_FREE_REGIONS)) {
    return undefined;
  }

  const k = ty.kind();
  switch (k.$) {
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine": {
      const def_id = k._0;
      const args = k._1;
      this.visit_closure_args(def_id, args);
      return undefined;
    }
    case "Alias": {
      const { kind, args } = k._1;
      const variances = this.cx().opt_alias_variances(AliasTermKind.from_AliasTyKind(kind));
      if (variances !== undefined) {
        // Skip lifetime parameters that are not captured, since they do
        // not need member constraints registered for them; we'll erase
        // them (and hopefully in the future replace them with placeholders).
        const n = Math.min(variances.length, args.length);
        for (let i = 0; i < n; i++) {
          const v = variances[i]!;
          const arg = args[i]!;
          if (v !== "Bivariant") {
            fold_GenericArg.visit_with(arg, this);
          }
        }
        return undefined;
      }
      break;
    }
  }
  fold_Ty.super_visit_with(ty, this);
  return undefined;
};

// `type Result = ()` and the provided methods of `impl TypeVisitor<TyCtxt<'tcx>> for CollectMemberConstraintsVisitor`.
Object.defineProperty(CollectMemberConstraintsVisitor.prototype, "Result", { value: VisitorResult.unit, writable: false, enumerable: false, configurable: true });
CollectMemberConstraintsVisitor.prototype.visit_binder = function <T>(this: CollectMemberConstraintsVisitor, t: Binder<T>, d: TypeVisitable<T>): undefined {
  return TypeVisitor_provided.visit_binder(this, t, d);
};
CollectMemberConstraintsVisitor.prototype.visit_const = function (this: CollectMemberConstraintsVisitor, c: Const): undefined {
  return TypeVisitor_provided.visit_const(this, c);
};
CollectMemberConstraintsVisitor.prototype.visit_predicate = function <P>(this: CollectMemberConstraintsVisitor, p: P, d: PredicateProxy<P>): undefined {
  return TypeVisitor_provided.visit_predicate(this, p, d);
};
CollectMemberConstraintsVisitor.prototype.visit_clauses = function (this: CollectMemberConstraintsVisitor, c: Clauses): undefined {
  return TypeVisitor_provided.visit_clauses(this, c);
};
CollectMemberConstraintsVisitor.prototype.visit_error = function (this: CollectMemberConstraintsVisitor, guar: ErrorGuaranteed): undefined {
  return TypeVisitor_provided.visit_error(this, guar);
};
