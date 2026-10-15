// Port of compiler/rustc_traits/src/dropck_outlives.rs (lane selcx-contract).
//
// PORT: `tcx.arena.alloc(x)` is `x`; `FxHashSet::replace(val).is_none()` keeps the first occurrence (interned keys).

import type { Canonical, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import {
  type CanonicalDropckOutlivesGoal,
  DropckConstraint,
  type DropckOutlivesResult,
  fold_with_DropckOutlivesResult,
  try_fold_with_DropckOutlivesResult,
  type_op,
  visit_with_DropckOutlivesResult,
} from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArg, Ty } from "../rustc_middle/ty/decls.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { assert_eq } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { ScrubbedTraitError } from "../rustc_infer/traits/engine.ts";
import type { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { compute_dropck_outlives_inner, dtorck_constraint_for_ty_inner } from "../rustc_trait_selection/traits/query/dropck_outlives.ts";
import { fold_ParamEnvAnd } from "../rust_ts/fold_param_env_and.ts";

const d_DropckOutlives: TypeFoldable<type_op.DropckOutlives> = {
  visit_with: type_op.visit_with_DropckOutlives,
  try_fold_with: type_op.try_fold_with_DropckOutlives,
  fold_with: type_op.fold_with_DropckOutlives,
};
const d_DropckOutlivesResult: TypeFoldable<DropckOutlivesResult> = {
  visit_with: visit_with_DropckOutlivesResult,
  try_fold_with: try_fold_with_DropckOutlivesResult,
  fold_with: fold_with_DropckOutlivesResult,
};

// rustc: compiler/rustc_traits/src/dropck_outlives.rs:16 provide
export function provide(p: Providers): void {
  p.dropck_outlives = dropck_outlives;
  p.adt_dtorck_constraint = adt_dtorck_constraint;
}

// rustc: compiler/rustc_traits/src/dropck_outlives.rs:20 dropck_outlives
function dropck_outlives(tcx: TyCtxt, canonical_goal: CanonicalDropckOutlivesGoal): Result<Canonical<QueryResponse<DropckOutlivesResult>>, NoSolution> {
  // debug!("dropck_outlives(goal={:#?})", canonical_goal);

  return tcx
    .infer_ctxt()
    .enter_canonical_trait_query(
      canonical_goal,
      (ocx, goal) => compute_dropck_outlives_inner(ocx as ObligationCtxt<ScrubbedTraitError>, goal, DUMMY_SP),
      fold_ParamEnvAnd(d_DropckOutlives),
      d_DropckOutlivesResult,
    );
}

/// Calculates the dtorck constraint for a type.
// rustc: compiler/rustc_traits/src/dropck_outlives.rs:32 adt_dtorck_constraint
export function adt_dtorck_constraint(tcx: TyCtxt, def_id: DefId): DropckConstraint {
  const def = tcx.adt_def(def_id) as AdtDef;
  const span = tcx.def_span(def_id);
  const typing_env = TypingEnv.non_body_analysis(tcx, def_id);
  // debug!("dtorck_constraint: {:?}", def);

  if (def.is_manually_drop()) {
    return bug("`ManuallyDrop` should have been handled by `trivial_dropck_outlives`");
  } else if (def.is_phantom_data()) {
    // The first generic parameter here is guaranteed to be a type because it's
    // `PhantomData`.
    const args = RawList.identity_for_item(tcx, def_id);
    assert_eq(args.length, 1, String);
    const result = new DropckConstraint([], [args.type_at(0)], []);
    // debug!("dtorck_constraint: {:?} => {:?}", def, result);
    return result;
  }

  const result = DropckConstraint.empty();
  for (const field of def.all_fields()) {
    const fty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>));
    dtorck_constraint_for_ty_inner(tcx, typing_env, span, 0, fty, result);
  }
  result.outlives.push(...tcx.destructor_constraints(def));
  dedup_dtorck_constraint(result);

  // debug!("dtorck_constraint: {:?} => {:?}", def, result);

  return result;
}

// rustc: compiler/rustc_traits/src/dropck_outlives.rs:67 dedup_dtorck_constraint
function dedup_dtorck_constraint(c: DropckConstraint): void {
  const outlives = new Set<GenericArg>();
  const dtorck_types = new Set<Ty>();

  c.outlives = c.outlives.filter((val) => {
    const fresh = !outlives.has(val);
    outlives.add(val);
    return fresh;
  });
  c.dtorck_types = c.dtorck_types.filter((val) => {
    const fresh = !dtorck_types.has(val);
    dtorck_types.add(val);
    return fresh;
  });
}
