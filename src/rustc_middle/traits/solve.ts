// Contract stub for compiler/rustc_middle/src/traits/solve.rs (merge-w13; the file belongs to the next-solver lanes of
// plan-m3).
//
// `ExternalConstraints` (solve.rs:44, hash-consed) is pending (ty/decls.ts); its manual `TypeFoldable` (:61) /
// `TypeVisitable` (:103) impls are stubs here, as tools/codegen's generated code calls them (type_fold.json).
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { ExternalConstraints } from "../ty/decls.ts";

/** Stub: `impl TypeVisitable for ExternalConstraints` (solve.rs:103). */
export function visit_with_ExternalConstraints<R>(_self: ExternalConstraints, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::traits::solve::ExternalConstraints: TypeVisitable::visit_with (solve.rs:103)");
}
/** Stub: `impl TypeFoldable for ExternalConstraints` (solve.rs:61). */
export function try_fold_with_ExternalConstraints<E>(_self: ExternalConstraints, _folder: FallibleTypeFolder<E>): Result<ExternalConstraints, E> {
  return unported("rustc_middle::traits::solve::ExternalConstraints: TypeFoldable::try_fold_with (solve.rs:61)");
}
export function fold_with_ExternalConstraints(_self: ExternalConstraints, _folder: TypeFolder): ExternalConstraints {
  return unported("rustc_middle::traits::solve::ExternalConstraints: TypeFoldable::fold_with (solve.rs:61)");
}
