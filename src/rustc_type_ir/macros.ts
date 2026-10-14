// Port of compiler/rustc_type_ir/src/macros.rs (partial).
//
// PORT: `TrivialTypeTraversalImpls!` expands to `TypeVisitable` / `TypeFoldable` impls that do nothing. With D4's
// impl fns (tools/codegen type_fold.json `trivial_fns`) they are these three generic functions, passed wherever a
// trivially traversable type is a type argument. Moved here from codegen-tyir's src/rust_ts/tyir_contract.ts by
// merge-w13.
import { Ok, type Result } from "../std/result.ts";
import type { FallibleTypeFolder, TypeFolder } from "./fold.ts";
import type { TypeVisitor } from "./visit.ts";

// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (visit_with: `output()`)
export function visit_with_trivial<T, R>(_self: T, visitor: TypeVisitor<R>): R {
  return visitor.Result.output();
}
// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (try_fold_with: `Ok(self)`)
export function try_fold_with_trivial<T, E>(self: T, _folder: FallibleTypeFolder<E>): Result<T, E> {
  return Ok(self);
}
// rustc-macro: compiler/rustc_type_ir/src/macros.rs:4 TrivialTypeTraversalImpls (fold_with: `self`)
export function fold_with_trivial<T>(self: T, _folder: TypeFolder): T {
  return self;
}
