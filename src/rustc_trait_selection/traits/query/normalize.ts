//! Code for the 'normalization' query. This consists of a wrapper
//! which folds deeply, invoking the underlying
//! `normalize_canonicalized_projection` query when it encounters projections.
//
// Port of compiler/rustc_trait_selection/src/traits/query/normalize.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lanes infcx-contract, selcx-contract):
// - `#[extension(pub trait QueryNormalizeExt)] impl At` puts `query_normalize` on `At.prototype` (declared in
//   ../../decls.ts); it is an `unported` placeholder below.
// - `MaxEscapingBoundVarVisitor` (`impl TypeVisitor`) and `QueryNormalizer` (`impl FallibleTypeFolder`) are generated in
//   ./normalize.gen.ts; the lane makes them implement rustc_type_ir's `TypeVisitor` / `FallibleTypeFolder` (a
//   `declare module "./normalize.gen.ts"` here; precedent rustc_infer freshen.ts) and assigns their methods:
//     normalize.rs:148 visit_binder / :155 visit_ty / :164 visit_region / :176 visit_const   (MaxEscapingBoundVarVisitor)
//     normalize.rs:198 cx / :202 try_fold_binder / :213 try_fold_ty / :285 try_fold_const / :312 try_fold_predicate
//     normalize.rs:325 try_fold_free_or_assoc                                                  (QueryNormalizer)
//   `QueryNormalizer.cache` (`SsoHashMap<Ty, Ty>`) is a `Map` keyed by the interned `Ty`.
// Fill: assign each method onto the prototype (marker `// rustc: compiler/rustc_trait_selection/src/traits/query/normalize.rs:<line> <name>`
// directly above) and delete its name from the `unported_methods` lists.
// Init order: top-level code here may touch only rustc_infer (loaded first by ../../lib.ts), ./normalize.gen.ts and other
// crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { At } from "../../../rustc_infer/decls.ts";
import { QueryNormalizer } from "./normalize.gen.ts";

export * from "./normalize.gen.ts";
// `pub use rustc_middle::traits::query::NormalizationResult;`
export type { NormalizationResult } from "../../../rustc_middle/traits/query.ts";

unported_methods(At.prototype, "rustc_trait_selection::traits::query::normalize::At", ["query_normalize"]);

unported_methods(QueryNormalizer.prototype, "rustc_trait_selection::traits::query::normalize::QueryNormalizer", [
  "cx",
  "try_fold_binder",
  "try_fold_ty",
  "try_fold_const",
  "try_fold_predicate",
  "try_fold_free_or_assoc",
]);
