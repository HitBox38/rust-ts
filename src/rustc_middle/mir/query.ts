// Port of compiler/rustc_middle/src/mir/query.rs: PARTIAL (lane typeck-gaps; the duplicate set of fixer lane merge-w18c was folded into this one by merge-w18d). Only `ConstraintCategory`,
// `ReturnConstraint` and `AnnotationSource` (the region-constraint categories that typeck / regionck produce:
// `ObligationCause::to_constraint_category`, `SubregionOrigin::to_constraint_category`, `QueryRegionConstraint`) are
// generated, with their derived Debug / Clone / TypeVisitable / TypeFoldable, into query.gen.ts (tools/codegen/types.ts,
// set rustc_middle_mir_query); the other types of the file (coroutine layouts, const qualifs) are skipped in that set
// until the MIR lane (M4) ports mir/query.rs (and its fns) here.
//! Values computed by queries that use MIR.
export * from "./query.gen.ts";
