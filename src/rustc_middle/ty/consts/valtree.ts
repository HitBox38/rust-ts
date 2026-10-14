// Contract stub for compiler/rustc_middle/src/ty/consts/valtree.rs (merge-w13; the file belongs to lane ty-results).
//
// `ty::Value` (`#[derive(TypeFoldable, TypeVisitable)]`, valtree.rs:103) is pending (ty/decls.ts); its derived
// impls are stubs here, as tools/codegen's generated code calls them (type_fold.json), until valtree.rs joins a
// codegen set.
import type { FallibleTypeFolder, TypeFolder } from "../../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { Value } from "../decls.ts";

/** Stub: `#[derive(TypeVisitable)]` of `ty::Value` (valtree.rs:103). */
export function visit_with_Value<R>(_self: Value, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Value: TypeVisitable::visit_with (valtree.rs:103 derive)");
}
/** Stub: `#[derive(TypeFoldable)]` of `ty::Value` (valtree.rs:103). */
export function try_fold_with_Value<E>(_self: Value, _folder: FallibleTypeFolder<E>): Result<Value, E> {
  return unported("rustc_middle::ty::Value: TypeFoldable::try_fold_with (valtree.rs:103 derive)");
}
export function fold_with_Value(_self: Value, _folder: TypeFolder): Value {
  return unported("rustc_middle::ty::Value: TypeFoldable::fold_with (valtree.rs:103 derive)");
}
