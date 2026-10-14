// Port of compiler/rustc_type_ir/src/macros.rs (lane tyir-misc, sub-lane lib-sty; the three traversal fns were moved
// here from codegen-tyir's src/rust_ts/tyir_contract.ts by merge-w13).
//
// PORT: `TrivialTypeTraversalImpls!` expands to `TypeVisitable` / `TypeFoldable` / `GenericTypeVisitable` impls that do
// nothing, for each listed type (`()`, `bool`, the integers, `BoundVar`, `DebruijnIndex`, `InferTy`, `Variance`, ...).
// With D4's impl fns (tools/codegen type_fold.json `trivial_fns`) they are these generic functions, passed wherever a
// trivially traversable type is a type argument; the markers sit on the macro's fns.
import { Ok, type Result } from "../std/result.ts";
import type { FallibleTypeFolder, TypeFolder } from "./fold.ts";
import type { TypeVisitor } from "./visit.ts";

/// Used for types that are `Copy` and which **do not care arena
/// allocated data** (i.e., don't need to be folded).
// rustc: compiler/rustc_type_ir/src/macros.rs:8 try_fold_with
export function try_fold_with_trivial<T, E>(self: T, _folder: FallibleTypeFolder<E>): Result<T, E> {
  return Ok(self);
}

// rustc: compiler/rustc_type_ir/src/macros.rs:16 fold_with
export function fold_with_trivial<T>(self: T, _folder: TypeFolder): T {
  return self;
}

// rustc: compiler/rustc_type_ir/src/macros.rs:26 visit_with
export function visit_with_trivial<T, R>(_self: T, visitor: TypeVisitor<R>): R {
  return visitor.Result.output();
}

// NOTE: this deliberately avoids adding an `I: Interner` generic, because that would
// allow creating a trivial impl for arena-allocating types, which would be incorrect.
// rustc: compiler/rustc_type_ir/src/macros.rs:38 generic_visit_with
export function generic_visit_with_trivial<T, V>(_self: T, _visitor: V): void {}

// `TrivialLiftImpls! { crate::LateParamRegion<I> }`
// rustc-skip: compiler/rustc_type_ir/src/macros.rs:92 lift_to_interner Lift (PORTING §3, D4)
