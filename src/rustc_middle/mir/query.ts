// Port of compiler/rustc_middle/src/mir/query.rs: PARTIAL (fixer lane merge-w18c). Only `ConstraintCategory` and the
// `ReturnConstraint` / `AnnotationSource` it stores are generated, with their derived Debug / Clone / TypeVisitable /
// TypeFoldable, into query.gen.ts (tools/codegen/types.ts, set rustc_middle_mir_query): the old solver's canonical query
// responses carry it (infer/canonical.rs `QueryRegionConstraint.category`). The other types of the file are skipped in
// that set until the MIR lane (M4) ports mir/query.rs (and its fns) here.
//! Values computed by queries that use MIR.
export * from "./query.gen.ts";
