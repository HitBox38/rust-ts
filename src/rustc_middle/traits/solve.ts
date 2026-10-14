// Port of compiler/rustc_middle/src/traits/solve.rs (lane middle-traits-thir; merge-w13 left the contract stubs of
// the `ExternalConstraints` impls here). `PredefinedOpaques` is generated (solve.gen.ts, set rustc_middle_traits_thir);
// the two hash-consed newtypes are hand-written classes (types.sets.json `hand`).
//
// PORT (D2): `CanonicalInput(Interned<'tcx, CanonicalInputData>)` and `ExternalConstraints(Interned<'tcx,
// ExternalConstraintsData>)` are frozen objects extending `Interned`, unique per value, made only by the
// `direct_interners!` methods of `TyCtxt` (`intern_canonical_input` / `mk_external_constraints`, ty/context.ts). The
// tuple field `_0` is the interned data (`Deref`); equality is `===`.
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import { Interned } from "../../rustc_data_structures/intern.ts";
import type * as ir from "../../rustc_type_ir/solve/mod.ts";
import {
  type CanonicalInputData,
  ExternalConstraintsData,
  fold_with_ExternalRegionConstraints,
  fold_with_NestedNormalizationGoals,
  try_fold_with_ExternalRegionConstraints,
  try_fold_with_NestedNormalizationGoals,
  visit_with_ExternalRegionConstraints,
  visit_with_NestedNormalizationGoals,
} from "../../rustc_type_ir/solve/mod.ts";
import {
  type FallibleTypeFolder,
  fold_with_tuple2,
  try_fold_with_tuple2,
  type TypeFolder,
} from "../../rustc_type_ir/fold.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.ts";
import { type TypeVisitor, visit_with_tuple2, visit_with_Vec } from "../../rustc_type_ir/visit.ts";
import { Ok, type Result } from "../../std/result.ts";
import type { OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.ts";
import { fold_with_Ty, try_fold_with_Ty, type Ty, visit_with_Ty } from "../ty/mod.ts";

// `pub use rustc_type_ir::solve::*;`
export * from "../../rustc_type_ir/solve/mod.ts";
export * from "./solve.gen.ts";

// PORT: the `pub type X<'tcx, ..> = ir::solve::X<TyCtxt<'tcx>, ..>` aliases are the same TS types as the glob re-export
// (D3 erases the interner); they shadow it, as upstream (types.sets.json skips them in the generated file).
export type Goal<P> = ir.Goal<P>;
export type QueryInput<P> = ir.QueryInput<P>;
export type QueryResult = ir.QueryResult;
export type CandidateSource = ir.CandidateSource;
export type CanonicalResponse = ir.CanonicalResponse;
export type FetchEligibleAssocItemResponse = ir.FetchEligibleAssocItemResponse;
export type ComputeGoalFastPathOutcome = ir.ComputeGoalFastPathOutcome;
export type GoalStalledOn = ir.GoalStalledOn;
export type GoalStalledOnOpaques = ir.GoalStalledOnOpaques;
export type SucceededInErased = ir.SucceededInErased;

// Interning CanonicalInput drastically reduces max memory usage when compiling a crate that has
// trait solver recursion depth overflows with next-solver deduplicating individual inputs.
// This mostly fixes #161748 where it reduced the memory usage for compiling bevy_render from
// ~14GiB to ~4GiB
// Main improved types:
//   - rustc_type_ir::search_graph::GlobalCache
//   - rustc_type_ir::search_graph::NestedGoals
export class CanonicalInput extends Interned {
  /** PORT: the interned `CanonicalInputData` (module comment). */
  readonly _0: CanonicalInputData;

  /** PORT: only `TyCtxt::intern_canonical_input` constructs (D2). */
  constructor(_0: CanonicalInputData) {
    super();
    this._0 = Object.freeze(_0);
    Object.freeze(this);
  }
}

// `impl Deref for CanonicalInput` (PORT: a free fn, as `Interned.deref` returns the object itself; precedent ty_info.ts
// `WithCachedTypeInfo_deref`)
// rustc: compiler/rustc_middle/src/traits/solve.rs:38 deref
export function CanonicalInput_deref(self: CanonicalInput): CanonicalInputData {
  return self._0;
}

export class ExternalConstraints extends Interned {
  /** PORT: the interned `ExternalConstraintsData` (module comment). */
  readonly _0: ExternalConstraintsData;

  /** PORT: only `TyCtxt::mk_external_constraints` constructs (D2). */
  constructor(_0: ExternalConstraintsData) {
    super();
    this._0 = Object.freeze(_0);
    Object.freeze(this);
  }
}

// `impl Deref for ExternalConstraints` (PORT: a free fn, as `Interned.deref` returns the object itself; precedent ty_info.ts
// `WithCachedTypeInfo_deref`)
// rustc: compiler/rustc_middle/src/traits/solve.rs:51 deref
export function ExternalConstraints_deref(self: ExternalConstraints): ExternalConstraintsData {
  return self._0;
}

// FIXME: Having to clone `region_constraints` for folding feels bad and
// probably isn't great wrt performance.
//
// Not sure how to fix this, maybe we should also intern `opaque_types` and
// `region_constraints` here or something.
// `impl TypeFoldable<TyCtxt<'tcx>> for ExternalConstraints<'tcx>`
// PORT: `.clone()` before folding is dropped: folding never mutates its input (it builds new values).
// rustc: compiler/rustc_middle/src/traits/solve.rs:62 try_fold_with
export function try_fold_with_ExternalConstraints<E>(self: ExternalConstraints, folder: FallibleTypeFolder<E>): Result<ExternalConstraints, E> {
  // Perf testing has found that this check is slightly faster than
  // folding and re-interning an empty `ExternalConstraintsData`.
  // See: <https://github.com/rust-lang/rust/pull/142430>.
  if (ExternalConstraintsData.is_empty(self._0)) {
    return Ok(self);
  }

  const region_constraints = try_fold_with_ExternalRegionConstraints(self._0.region_constraints, folder);
  if (region_constraints.$ === "Err") return region_constraints;
  const opaque_types: [OpaqueTypeKey, Ty][] = [];
  for (const opaque of self._0.opaque_types) {
    const r = try_fold_with_tuple2(opaque, folder, try_fold_with_OpaqueTypeKey, try_fold_with_Ty);
    if (r.$ === "Err") return r;
    opaque_types.push(r._0);
  }
  const normalization_nested_goals = try_fold_with_NestedNormalizationGoals(self._0.normalization_nested_goals, folder);
  if (normalization_nested_goals.$ === "Err") return normalization_nested_goals;
  return Ok(
    folder.cx().mk_external_constraints({
      region_constraints: region_constraints._0,
      opaque_types,
      normalization_nested_goals: normalization_nested_goals._0,
    }),
  );
}

// rustc: compiler/rustc_middle/src/traits/solve.rs:87 fold_with
export function fold_with_ExternalConstraints(self: ExternalConstraints, folder: TypeFolder): ExternalConstraints {
  // Perf testing has found that this check is slightly faster than
  // folding and re-interning an empty `ExternalConstraintsData`.
  // See: <https://github.com/rust-lang/rust/pull/142430>.
  if (ExternalConstraintsData.is_empty(self._0)) {
    return self;
  }

  return folder.cx().mk_external_constraints({
    region_constraints: fold_with_ExternalRegionConstraints(self._0.region_constraints, folder),
    opaque_types: self._0.opaque_types.map((opaque) => fold_with_tuple2(opaque, folder, fold_with_OpaqueTypeKey, fold_with_Ty)),
    normalization_nested_goals: fold_with_NestedNormalizationGoals(self._0.normalization_nested_goals, folder),
  });
}

// `impl TypeVisitable<TyCtxt<'tcx>> for ExternalConstraints<'tcx>`
// rustc: compiler/rustc_middle/src/traits/solve.rs:104 visit_with
export function visit_with_ExternalConstraints<R>(self: ExternalConstraints, visitor: TypeVisitor<R>): R {
  const { region_constraints, opaque_types, normalization_nested_goals } = self._0;

  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visit_with_ExternalRegionConstraints(region_constraints, visitor))) !== undefined) return r;
  if (
    (r = try_visit(
      visitor.Result,
      visit_with_Vec(opaque_types, visitor, (x, v) => visit_with_tuple2(x, v, visit_with_OpaqueTypeKey, visit_with_Ty)),
    )) !== undefined
  )
    return r;
  return visit_with_NestedNormalizationGoals(normalization_nested_goals, visitor);
}

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// (`mod size_asserts`, `#[cfg(target_pointer_width = "64")]`: no TS counterpart.)
