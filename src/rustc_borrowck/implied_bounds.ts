// Port of compiler/rustc_borrowck/src/implied_bounds.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `mir_borrowck_implied_outlives_bounds` is the query provider (lib.ts's `provide` installs it); `&'tcx Canonical<..>`
// is the value (`tcx.arena.alloc(x)` is `x`). `SmallVec<[GenericArg; 8]>` is `GenericArg[]`; `mut is_external_region:
// impl FnMut(ty::Region) -> bool` is a callback.
import type { Canonical, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { MirBorrowckImpliedOutlivesBounds, OutlivesBound } from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArg, Ty } from "../rustc_middle/ty/decls.ts";
import { GenericArg as GenericArgC, fold_List_Ty } from "../rustc_middle/ty/generic_args.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import {
  fold_with_MirBorrowckImpliedOutlivesBounds,
  try_fold_with_MirBorrowckImpliedOutlivesBounds,
  visit_with_MirBorrowckImpliedOutlivesBounds,
} from "../rustc_middle/traits/query.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { compute_implied_outlives_bounds_inner, consider_implied_bounds_hack_for_ty } from "../rustc_trait_selection/traits/implied_outlives_bounds.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { BoundRegionKind, PlaceholderRegion } from "../rustc_type_ir/binder.ts";
import type { CanonicalVarValues } from "../rustc_type_ir/canonical.gen.ts";
import { fold_regions, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { BoundVar } from "../rustc_type_ir/lib.gen.ts";
import { UniverseIndex } from "../rustc_type_ir/lib.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { debug_Region, Region } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, type Result } from "../std/result.ts";
import { DefiningTy } from "./universal_regions.ts";

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

/** PORT: `MirBorrowckImpliedOutlivesBounds`'s derived `TypeFoldable` / `TypeVisitable` as a descriptor. */
const d_MirBorrowckImpliedOutlivesBounds: TypeFoldable<MirBorrowckImpliedOutlivesBounds> = {
  visit_with: visit_with_MirBorrowckImpliedOutlivesBounds,
  try_fold_with: try_fold_with_MirBorrowckImpliedOutlivesBounds,
  fold_with: fold_with_MirBorrowckImpliedOutlivesBounds,
};

/// Computes the implied bounds for `body_def_id`. This is a separate query
/// as it must not reveal the hidden type of opaques defined by `body_def_id`
/// for typeck roots.
///
/// However, nested bodies are checked in the scope of their parent. This means
/// we should actually normalize opaques when computing their implied bounds.
// rustc: compiler/rustc_borrowck/src/implied_bounds.rs:27 mir_borrowck_implied_outlives_bounds
export function mir_borrowck_implied_outlives_bounds(
  tcx: TyCtxt,
  body_def_id: LocalDefId,
): Result<Canonical<QueryResponse<MirBorrowckImpliedOutlivesBounds>>, NoSolution> {
  // If we're in a typeck root we don't want to reveal any opaque types. We need to
  // make sure the caller actually checks that all our implied bounds actually hold.
  // This is not the case with the hidden types of opaque types if we're a defining-scope
  // and the caller is not.
  //
  // However, for nested bodies, we always check that they are well-formed in their
  // parent body, so for these we do want to define opaque types. Not doing so can result
  // in incorrect errors when normalizing implied bounds.
  const typing_env = tcx.is_typeck_child(LocalDefId.to_def_id(body_def_id))
    ? TypingEnv.post_typeck_until_borrowck(tcx, body_def_id)
    : TypingEnv.non_body_analysis(tcx, body_def_id);

  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
  const ocx = ObligationCtxt.new(infcx);

  const defining_ty = DefiningTy.new_(tcx, body_def_id);

  const inputs_and_output0 = DefiningTy.inputs_and_output(defining_ty, tcx);
  const inputs_and_output1 = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(body_def_id), inputs_and_output0, fold_List_Ty);
  const inputs_and_output = replace_erased_regions_with_placeholders(tcx, inputs_and_output1);

  const outlives_bounds: OutlivesBound[] = [];
  // Need to return the normalized signature used to compute implied bounds back to borrowck
  // to deal with unconstrained regions due to #136547.
  const normalized_inputs_and_output: Ty[] = [];
  for (const ty of inputs_and_output) {
    const num_registered_region_obligations = infcx.num_registered_region_obligations();
    const n = ocx.deeply_normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(ty), fold_Ty);
    if (n.$ === "Err") return Err(NO_SOLUTION);
    const normalized_ty = n._0;

    const b = compute_implied_outlives_bounds_inner(ocx, param_env, ty, normalized_ty, DUMMY_SP);
    if (b.$ === "Err") return b;
    outlives_bounds.push(...b._0);

    outlives_bounds.push(
      ...consider_implied_bounds_hack_for_ty(ocx, normalized_ty, () => infcx.registered_region_obligations_since(num_registered_region_obligations)),
    );

    normalized_inputs_and_output.push(normalized_ty);
  }

  // Add implied bounds from impl header.
  //
  // We don't use `assumed_wf_types` to source the entire set of implied bounds for
  // a few reasons:
  // - `DefiningTy` for closure has the `&'env Self` type while `assumed_wf_types` doesn't
  // - We compute implied bounds from the unnormalized types in the `DefiningTy` but do not
  //   do so for types in impl headers
  // - We must compute the normalized signature and then compute implied bounds from that
  //   in order to connect any unconstrained region vars created during normalization to
  //   the types of the locals corresponding to the inputs and outputs of the item. #136547
  const dk = tcx.def_kind(body_def_id);
  if (dk.$ === "AssocFn" || dk.$ === "AssocConst") {
    for (const [ty] of tcx.assumed_wf_types(tcx.local_parent(body_def_id))) {
      const n = ocx.deeply_normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(ty), fold_Ty);
      if (n.$ === "Err") return Err(NO_SOLUTION);
      const normalized_ty = n._0;

      // We don't consider the constraints from normalizing the impl header
      // for the bevy implied bounds hack.
      const num_registered_region_obligations = infcx.num_registered_region_obligations();
      const b = compute_implied_outlives_bounds_inner(ocx, param_env, normalized_ty, normalized_ty, DUMMY_SP);
      if (b.$ === "Err") return b;
      outlives_bounds.push(...b._0);

      outlives_bounds.push(
        ...consider_implied_bounds_hack_for_ty(ocx, normalized_ty, () => infcx.registered_region_obligations_since(num_registered_region_obligations)),
      );
    }
  }

  const var_values = implied_bounds_query_var_values(tcx, inputs_and_output, (r) => {
    const rk = r.kind();
    switch (rk.$) {
      case "RePlaceholder":
        return true;
      case "ReEarlyParam":
      case "ReLateParam":
      case "ReBound":
      case "ReStatic":
      case "ReError":
        return false;
      case "ReVar":
      case "ReErased":
        return unreachable();
    }
  });
  const input_values: CanonicalVarValues = { var_values: tcx.mk_args(var_values) };

  return ocx.make_canonicalized_query_response(input_values, { outlives_bounds, normalized_inputs_and_output }, d_MirBorrowckImpliedOutlivesBounds);
}

/// This computes the `var_values` used by the `mir_borrowck_implied_outlives_bounds` query.
/// The old solver canonicalization does not replace early and late bound parameters,
/// so the only `var_values` we need are external regions from the signature of the nested
/// body as we don't have a shared representation between this query and MIR borrowck.
///
/// These are not all external regions of the nested body, only the external regions
/// which may get accessed by this query. We only need to add things to the `var_values`
/// which can be referenced by both this query and MIR borrowck. MIR borrowck currently
/// creates external regions for late-bound regions of parent items as these can be
/// explicitly mentioned in user types. We do not encounter these in this query, as all
/// free regions in the signature of nested bodies get replaced with `'erased` at the end
/// of HIR typeck, so we don't care about them.
// #[instrument(level = "debug", skip(tcx, is_external_region), ret)]
// rustc: compiler/rustc_borrowck/src/implied_bounds.rs:152 implied_bounds_query_var_values
export function implied_bounds_query_var_values(
  tcx: TyCtxt,
  unnormalized_inputs_and_output: readonly Ty[],
  is_external_region: (a0: Region) => boolean,
): GenericArg[] {
  const values: GenericArg[] = [];

  for (const ty of unnormalized_inputs_and_output) {
    tcx.for_each_free_region(
      ty,
      (region) => {
        if (is_external_region(region)) {
          values.push(GenericArgC.from_Region(region));
        }
      },
      fold_Ty,
    );
  }

  return values;
}

/// This replaces all external regions in the signature of the current item with
/// a unique placeholder to collect its implied bounds. This mirrors the way MIR
/// borrowck replaces all of them with unique NLL vars.
// rustc: compiler/rustc_borrowck/src/implied_bounds.rs:173 replace_erased_regions_with_placeholders
function replace_erased_regions_with_placeholders(tcx: TyCtxt, inputs_and_output: readonly Ty[]): Ty[] {
  // debug_assert!(!inputs_and_output.has_placeholders());
  let next_placeholder = 0;
  return inputs_and_output.map((ty) =>
    fold_regions(
      tcx,
      ty,
      (r, _) => {
        const rk = r.kind();
        switch (rk.$) {
          case "ReErased": {
            const var_ = BoundVar.from_usize(next_placeholder);
            next_placeholder += 1;
            return Region.new_placeholder(tcx, PlaceholderRegion.new(UniverseIndex.ROOT, { var: var_, kind: BoundRegionKind.Anon }));
          }
          case "ReEarlyParam":
          case "ReLateParam":
          case "ReBound":
          case "ReStatic":
          case "ReError":
            return r;
          case "ReVar":
          case "RePlaceholder":
            return panic(`unexpected region: ${debug_Region(r, PLAIN)}`);
        }
      },
      fold_Ty,
    ),
  );
}
