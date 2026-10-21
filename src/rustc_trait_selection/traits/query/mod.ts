//! Experimental types for the trait query interface. The methods
//! defined in this module are all based on **canonicalization**,
//! which makes a canonical query by replacing unbound inference
//! variables and regions, so that results can be reused more broadly.
//! The providers for the queries defined here can be found in
//! `rustc_traits`.
//
// Port of compiler/rustc_trait_selection/src/traits/query/mod.rs (lane selcx-contract; no fns).

// pub mod dropck_outlives;
export * as dropck_outlives from "./dropck_outlives.ts";
// pub mod evaluate_obligation;
export * as evaluate_obligation from "./evaluate_obligation.ts";
// pub mod method_autoderef;
export * as method_autoderef from "./method_autoderef.ts";
// pub mod normalize;
export * as normalize from "./normalize.ts";
// pub mod type_op;
export * as type_op from "./type_op/mod.ts";

// `pub use rustc_middle::traits::query::*;` (its `type_op` module is ./type_op/mod.ts's re-export above)
export {
  type CanonicalAliasGoal,
  type CanonicalDropckOutlivesGoal,
  type CanonicalImpliedOutlivesBoundsGoal,
  type CanonicalMethodAutoderefStepsGoal,
  type CanonicalPredicateGoal,
  type CanonicalTypeOpAscribeUserTypeGoal,
  type CanonicalTypeOpNormalizeGoal,
  type CanonicalTypeOpProvePredicateGoal,
  type CandidateStep,
  type DropckConstraint,
  type DropckOutlivesResult,
  type MethodAutoderefBadTy,
  type MethodAutoderefStepsResult,
  type MirBorrowckImpliedOutlivesBounds,
  type NormalizationResult,
  type OutlivesBound,
} from "../../../rustc_middle/traits/query.ts";
// `NoSolution` (rustc_middle::traits::query::NoSolution = rustc_type_ir::solve::NoSolution)
export type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
