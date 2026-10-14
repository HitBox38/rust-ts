// Port of compiler/rustc_type_ir/src/fold.rs (lane tyir-binder; the trait declarations are lane ty-contract's).
//
//! A folding traversal mechanism for complex data structures that contain type
//! information.
//!
//! This is a modifying traversal. It consumes the data structure, producing a
//! (possibly) modified version of it. Both fallible and infallible versions are
//! available. The name is potentially confusing, because this traversal is more
//! like `Iterator::map` than `Iterator::fold`.
//!
//! This traversal has limited flexibility. Only a small number of "types of
//! interest" within the complex data structures can receive custom
//! modification. These are the ones containing the most important type-related
//! information, such as `Ty`, `Predicate`, `Region`, and `Const`.
//!
//! There are three traits involved in each traversal.
//! - `TypeFoldable`. This is implemented once for many types, including:
//!   - Types of interest, for which the methods delegate to the folder.
//!   - All other types, including generic containers like `Vec` and `Option`.
//!     It defines a "skeleton" of how they should be folded.
//! - `TypeSuperFoldable`. This is implemented only for recursive types of
//!   interest, and defines the folding "skeleton" for these types. (This
//!   excludes `Region` because it is non-recursive, i.e. it never contains
//!   other types of interest.)
//! - `TypeFolder`/`FallibleTypeFolder`. One of these is implemented for each
//!   folder. This defines how types of interest are folded.
//!
//! This means each fold is a mixture of (a) generic folding operations, and (b)
//! custom fold operations that are specific to the folder.
//! - The `TypeFoldable` impls handle most of the traversal, and call into
//!   `TypeFolder`/`FallibleTypeFolder` when they encounter a type of interest.
//! - A `TypeFolder`/`FallibleTypeFolder` may call into another `TypeFoldable`
//!   impl, because some of the types of interest are recursive and can contain
//!   other types of interest.
//! - A `TypeFolder`/`FallibleTypeFolder` may also call into a `TypeSuperFoldable`
//!   impl, because each folder might provide custom handling only for some types
//!   of interest, or only for some variants of each type of interest, and then
//!   use default traversal for the remaining cases.
//!
//! For example, if you have `struct S(Ty, U)` where `S: TypeFoldable` and `U:
//! TypeFoldable`, and an instance `s = S(ty, u)`, it would be folded like so:
//! ```text
//! s.fold_with(folder) calls
//! - ty.fold_with(folder) calls
//!   - folder.fold_ty(ty) may call
//!     - ty.super_fold_with(folder)
//! - u.fold_with(folder)
//! ```
//
// PORT (docs/plan-m3.md D4): the traits over the *value* type become **descriptors**, one object per Rust
// impl, passed explicitly wherever upstream is generic over `T: TypeFoldable<I>` (PORTING §5 "pass function
// tables"):
// - `TypeFoldable<T>` / `TypeSuperFoldable<T>` (and visit.ts's `TypeVisitable<T>` / `TypeSuperVisitable<T>`)
//   are interfaces of functions taking the value as `self`. Naming: the descriptor of `T` is `fold_<T>` (it is
//   also `T`'s `TypeVisitable` descriptor, since `TypeFoldable: TypeVisitable`); a type that is only visitable
//   has `visit_<T>`. Generic impls are functions from descriptors to descriptors
//   (`fold_Binder<T>(d: TypeFoldable<T>): TypeSuperFoldable<Binder<T>>`, `fold_Vec`, `fold_Option`, tuples).
//   tools/codegen generates the derived impls as free fns (`visit_with_<T>` / `try_fold_with_<T>` /
//   `fold_with_<T>`, taking the impl fns of the type arguments after the visitor / folder); `super_*` impls are
//   hand-ported.
// - A generic fn `fn f<T: TypeFoldable<I>>(.., value: T)` gains a trailing `d: TypeFoldable<T>` parameter,
//   with a `// PORT: D4 descriptor` note. `value.fold_with(folder)` is `d.fold_with(value, folder)`.
// - The folder traits stay traits: `TypeFolder` / `FallibleTypeFolder<E>` are interfaces implemented by
//   the folder classes. `I` is erased (rustc_middle's `TyCtxt`); `F::Error` is the type parameter `E`.
//   Methods generic over a foldable take its descriptor: `fold_binder<T>(t, d)`, `fold_predicate<P>(p, d)`.
//   Provided (default) methods live in `TypeFolder_provided` / `FallibleTypeFolder_provided` (PORTING §8);
//   a folder class implements every method and forwards the ones it does not override to the helper.
//   (Not abstract base classes: binder.ts's folders/visitors and fold.ts / visit.ts import each other's values,
//   and an `extends` across that cycle would read a class in its TDZ at module evaluation.)
// - Upstream has no blanket `impl<F: TypeFolder> FallibleTypeFolder for F` at the pin: a `try_fold_with` takes
//   a `FallibleTypeFolder` only.
// PORT (D4): `I::Ty` and `I::Clauses` impls live in rustc_middle (ty/structural_impls.rs), not ported yet:
// `fold_Ty` / `fold_Clauses` at the end of this file stand in for their descriptors.
// PORT: `#[instrument]` / `debug!` (tracing) produce no output in the oracle and are left out.
import { type AliasConstKind, fold_with_AliasConstKind } from "./const_kind.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Clauses, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { Binder, fold_Binder, visit_Binder } from "./binder.ts";
import type { ClauseKind, ProjectionClause } from "./decls.ts";
import { TypeFlags } from "./flags.ts";
import { DebruijnIndex, INNERMOST } from "./lib.ts";
import { Const, fold_Const, Region } from "./sty/mod.ts";
import { fold_with_Alias } from "./ty/alias.ts";
import { type AliasTyKind, fold_with_AliasTyKind, IsRigid } from "./ty_kind.ts";
import { Unnormalized } from "./unnormalized.ts";
import { type Flags, type TypeSuperVisitable, type TypeVisitable, TypeVisitableExt, type TypeVisitor, visit_with_Option, visit_with_tuple2, visit_with_tuple3, visit_with_Vec } from "./visit.ts";

/// This trait is implemented for every type that can be folded,
/// providing the skeleton of the traversal.
///
/// To implement this conveniently, use the derive macro located in
/// `rustc_macros`.
///
/// This trait is a sub-trait of `TypeVisitable`. This is because many
/// `TypeFolder` instances use the methods in `TypeVisitableExt` while folding,
/// which means in practice almost every foldable type needs to also be
/// visitable. (However, there are some types that are visitable without being
/// foldable.)
// rustc-trait: compiler/rustc_type_ir/src/fold.rs:74 TypeFoldable
export interface TypeFoldable<T> extends TypeVisitable<T> {
  /// The entry point for folding. To fold a value `t` with a folder `f`
  /// call: `t.try_fold_with(f)`.
  ///
  /// For most types, this just traverses the value, calling `try_fold_with`
  /// on each field/element.
  ///
  /// For types of interest (such as `Ty`), the implementation of this method
  /// calls a folder method specifically for that type (such as
  /// `F::try_fold_ty`). This is where control transfers from [`TypeFoldable`]
  /// to [`FallibleTypeFolder`].
  // rustc: compiler/rustc_type_ir/src/fold.rs:85 try_fold_with
  try_fold_with<E>(self: T, folder: FallibleTypeFolder<E>): Result<T, E>;

  /// The entry point for folding. To fold a value `t` with a folder `f`
  /// call: `t.fold_with(f)`.
  ///
  /// For most types, this just traverses the value, calling `fold_with`
  /// on each field/element.
  ///
  /// For types of interest (such as `Ty`), the implementation of this method
  /// calls a folder method specifically for that type (such as
  /// `F::fold_ty`). This is where control transfers from `TypeFoldable`
  /// to `TypeFolder`.
  ///
  /// Same as [`TypeFoldable::try_fold_with`], but not fallible. Make sure to keep
  /// the behavior in sync across functions.
  // rustc: compiler/rustc_type_ir/src/fold.rs:100 fold_with
  fold_with(self: T, folder: TypeFolder): T;
}

// This trait is implemented for types of interest.
// rustc-trait: compiler/rustc_type_ir/src/fold.rs:104 TypeSuperFoldable
export interface TypeSuperFoldable<T> extends TypeFoldable<T> {
  /// Provides a default fold for a recursive type of interest. This should
  /// only be called within `TypeFolder` methods, when a non-custom traversal
  /// is desired for the value of the type of interest passed to that method.
  /// For example, in `MyFolder::try_fold_ty(ty)`, it is valid to call
  /// `ty.try_super_fold_with(self)`, but any other folding should be done
  /// with `xyz.try_fold_with(self)`.
  // rustc: compiler/rustc_type_ir/src/fold.rs:111 try_super_fold_with
  try_super_fold_with<E>(self: T, folder: FallibleTypeFolder<E>): Result<T, E>;

  /// A convenient alternative to `try_super_fold_with` for use with
  /// infallible folders. Do not override this method, to ensure coherence
  /// with `try_super_fold_with`.
  // rustc: compiler/rustc_type_ir/src/fold.rs:119 super_fold_with
  super_fold_with(self: T, folder: TypeFolder): T;
}

/// This trait is implemented for every infallible folding traversal. There is
/// a fold method defined for every type of interest. Each such method has a
/// default that does an "identity" fold. Implementations of these methods
/// often fall back to a `super_fold_with` method if the primary argument
/// doesn't satisfy a particular condition.
// rustc-trait: compiler/rustc_type_ir/src/fold.rs:127 TypeFolder
export interface TypeFolder {
  // rustc: compiler/rustc_type_ir/src/fold.rs:128 cx
  cx(): TyCtxt;
  // (provided) fold.rs:130 fold_binder -> TypeFolder_provided.fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T>;
  // (provided) fold.rs:137 fold_ty
  fold_ty(t: Ty): Ty;
  // (provided) fold.rs:143 fold_region
  fold_region(r: Region): Region;
  // (provided) fold.rs:147 fold_const
  fold_const(c: Const): Const;
  // (provided) fold.rs:151 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P;
  // (provided) fold.rs:155 fold_clauses
  fold_clauses(c: Clauses): Clauses;
}

/** PORT: the provided methods of `TypeFolder` (PORTING §8). */
export const TypeFolder_provided = {
  // rustc: compiler/rustc_type_ir/src/fold.rs:130 fold_binder
  fold_binder<T>(self: TypeFolder, t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return fold_Binder(d).super_fold_with(t, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:137 fold_ty
  fold_ty(self: TypeFolder, t: Ty): Ty {
    return fold_Ty.super_fold_with(t, self);
  },

  // The default region folder is a no-op because `Region` is non-recursive
  // and has no `super_fold_with` method to call.
  // rustc: compiler/rustc_type_ir/src/fold.rs:143 fold_region
  fold_region(_self: TypeFolder, r: Region): Region {
    return r;
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:147 fold_const
  fold_const(self: TypeFolder, c: Const): Const {
    return fold_Const.super_fold_with(c, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:151 fold_predicate
  fold_predicate<P>(self: TypeFolder, p: P, d: PredicateProxy<P>): P {
    return d.super_fold_with(p, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:155 fold_clauses
  fold_clauses(self: TypeFolder, c: Clauses): Clauses {
    return fold_Clauses.super_fold_with(c, self);
  },
};

/// [Fold predicate](TypeFolder::fold_predicate) deliberately doesn't get access
/// to an actual predicate. This way, we can compress lists of predicates, and hide
/// this detail to folders. Instead, some type implementing this trait, [`PredicateProxy`]
/// is passed, with its limited API.
///
/// Most [`TypeFolder`]s only use `fold_predicate` to inspect type flags.
// PORT (D4): a descriptor over the proxy type `P` (`TypeSuperFoldable + TypeSuperVisitable + Flags + Copy`).
// rustc-trait: compiler/rustc_type_ir/src/fold.rs:166 PredicateProxy
export interface PredicateProxy<P> extends TypeSuperFoldable<P>, TypeSuperVisitable<P> {
  /** `Flags::flags` / `Flags::outer_exclusive_binder` of `P` (supertrait `Flags`). */
  flags: Flags<P>;
  // rustc: compiler/rustc_type_ir/src/fold.rs:169 allow_normalization
  allow_normalization(self: P): boolean;
  /// Gets the underlying clause kind (if this predicate is a clause, otherwise `None`).
  /// The fact that it's `unchecked`, is because no attempt is made to hide implementation
  /// details. For example, in the future we may compress clauses together. Code calling
  /// `clause_kind_unchecked` will have to correctly deal with these implementation details,
  /// and have code handling any edgecase arising as a result.
  // rustc: compiler/rustc_type_ir/src/fold.rs:176 clause_kind_unchecked
  clause_kind_unchecked(self: P): Binder<ClauseKind> | undefined;
  /// If self is a projection clause, call `f` with it. The result will be rebound and returned as `Some`.
  /// Otherwise, when self is not a projection clause, `None` is returned.
  // rustc: compiler/rustc_type_ir/src/fold.rs:180 map_projection
  map_projection(self: P, cx: TyCtxt, f: (b: Binder<ProjectionClause>) => Binder<ProjectionClause>): P | undefined;
}

/// This trait is implemented for every folding traversal. There is a fold
/// method defined for every type of interest. Each such method has a default
/// that does an "identity" fold.
///
/// A blanket implementation of this trait (that defers to the relevant
/// method of [`TypeFolder`]) is provided for all infallible folders in
/// order to ensure the two APIs are coherent.
// PORT: `type Error` is the type parameter `E`.
// rustc-trait: compiler/rustc_type_ir/src/fold.rs:194 FallibleTypeFolder
export interface FallibleTypeFolder<E> {
  // rustc: compiler/rustc_type_ir/src/fold.rs:197 cx
  cx(): TyCtxt;
  // (provided) fold.rs:199 try_fold_binder -> FallibleTypeFolder_provided.try_fold_binder
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, E>;
  // (provided) fold.rs:206 try_fold_ty
  try_fold_ty(t: Ty): Result<Ty, E>;
  // (provided) fold.rs:212 try_fold_region
  try_fold_region(r: Region): Result<Region, E>;
  // (provided) fold.rs:216 try_fold_const
  try_fold_const(c: Const): Result<Const, E>;
  // (provided) fold.rs:220 try_fold_predicate
  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, E>;
  // (provided) fold.rs:224 try_fold_clauses
  try_fold_clauses(c: Clauses): Result<Clauses, E>;
}

/** PORT: the provided methods of `FallibleTypeFolder` (PORTING §8). */
export const FallibleTypeFolder_provided = {
  // rustc: compiler/rustc_type_ir/src/fold.rs:199 try_fold_binder
  try_fold_binder<T, E>(self: FallibleTypeFolder<E>, t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, E> {
    return fold_Binder(d).try_super_fold_with(t, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:206 try_fold_ty
  try_fold_ty<E>(self: FallibleTypeFolder<E>, t: Ty): Result<Ty, E> {
    return fold_Ty.try_super_fold_with(t, self);
  },

  // The default region folder is a no-op because `Region` is non-recursive
  // and has no `super_fold_with` method to call.
  // rustc: compiler/rustc_type_ir/src/fold.rs:212 try_fold_region
  try_fold_region<E>(_self: FallibleTypeFolder<E>, r: Region): Result<Region, E> {
    return Ok(r);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:216 try_fold_const
  try_fold_const<E>(self: FallibleTypeFolder<E>, c: Const): Result<Const, E> {
    return fold_Const.try_super_fold_with(c, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:220 try_fold_predicate
  try_fold_predicate<P, E>(self: FallibleTypeFolder<E>, p: P, d: PredicateProxy<P>): Result<P, E> {
    return d.try_super_fold_with(p, self);
  },

  // rustc: compiler/rustc_type_ir/src/fold.rs:224 try_fold_clauses
  try_fold_clauses<E>(self: FallibleTypeFolder<E>, c: Clauses): Result<Clauses, E> {
    return fold_Clauses.try_super_fold_with(c, self);
  },
};

///////////////////////////////////////////////////////////////////////////
// Traversal implementations.

// PORT (merge-w13): generated code (tools/codegen type_fold.json, `module`) imports the traversal names from this
// module: the folder / visitor traits, the impl fn types (`<T as TypeFoldable>::try_fold_with` as a value is
// `TryFoldWith<T>`, the method of `T`'s D4 descriptor), the `TrivialTypeTraversalImpls!` fns and the container
// impls of visit.rs / fold.rs. A generic impl takes the impl fns of its type arguments after the folder.
export type { TypeVisitor, VisitWith } from "./visit.ts";
export { visit_with_IndexSet, visit_with_Option, visit_with_Result, visit_with_slice, visit_with_tuple2, visit_with_tuple3, visit_with_Vec } from "./visit.ts";
export { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "./macros.ts";
export type TryFoldWith<T> = TypeFoldable<T>["try_fold_with"];
export type FoldWith<T> = TypeFoldable<T>["fold_with"];

/** `impl TypeFoldable for (T, U)` */
// rustc: compiler/rustc_type_ir/src/fold.rs:233 try_fold_with
export function try_fold_with_tuple2<T, U, E>(self: readonly [T, U], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>, try_fold_with_U: TryFoldWith<U>): Result<[T, U], E> {
  const a = try_fold_with_T(self[0], folder);
  if (a.$ === "Err") return a;
  const b = try_fold_with_U(self[1], folder);
  if (b.$ === "Err") return b;
  return Ok([a._0, b._0]);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:237 fold_with
export function fold_with_tuple2<T, U>(self: readonly [T, U], folder: TypeFolder, fold_with_T: FoldWith<T>, fold_with_U: FoldWith<U>): [T, U] {
  return [fold_with_T(self[0], folder), fold_with_U(self[1], folder)];
}

/** `impl TypeFoldable for (A, B, C)` */
// rustc: compiler/rustc_type_ir/src/fold.rs:245 try_fold_with
export function try_fold_with_tuple3<A, B, C, E>(self: readonly [A, B, C], folder: FallibleTypeFolder<E>, try_fold_with_A: TryFoldWith<A>, try_fold_with_B: TryFoldWith<B>, try_fold_with_C: TryFoldWith<C>): Result<[A, B, C], E> {
  const a = try_fold_with_A(self[0], folder);
  if (a.$ === "Err") return a;
  const b = try_fold_with_B(self[1], folder);
  if (b.$ === "Err") return b;
  const c = try_fold_with_C(self[2], folder);
  if (c.$ === "Err") return c;
  return Ok([a._0, b._0, c._0]);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:256 fold_with
export function fold_with_tuple3<A, B, C>(self: readonly [A, B, C], folder: TypeFolder, fold_with_A: FoldWith<A>, fold_with_B: FoldWith<B>, fold_with_C: FoldWith<C>): [A, B, C] {
  return [fold_with_A(self[0], folder), fold_with_B(self[1], folder), fold_with_C(self[2], folder)];
}

/** `impl TypeFoldable for Option<T>` */
// rustc: compiler/rustc_type_ir/src/fold.rs:262 try_fold_with
export function try_fold_with_Option<T, E>(self: T | undefined, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T | undefined, E> {
  if (self !== undefined) {
    const v = try_fold_with_T(self, folder);
    if (v.$ === "Err") return v;
    return Ok(v._0);
  } else {
    return Ok(undefined);
  }
}

// rustc: compiler/rustc_type_ir/src/fold.rs:269 fold_with
export function fold_with_Option<T>(self: T | undefined, folder: TypeFolder, fold_with_T: FoldWith<T>): T | undefined {
  if (self === undefined) return undefined;
  return fold_with_T(self, folder);
}

/** `impl TypeFoldable for Result<T, E>` */
// rustc: compiler/rustc_type_ir/src/fold.rs:275 try_fold_with
export function try_fold_with_Result<T, U, E>(self: Result<T, U>, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>, try_fold_with_U: TryFoldWith<U>): Result<Result<T, U>, E> {
  switch (self.$) {
    case "Ok": {
      const v = try_fold_with_T(self._0, folder);
      if (v.$ === "Err") return v;
      return Ok(Ok(v._0));
    }
    case "Err": {
      const e = try_fold_with_U(self._0, folder);
      if (e.$ === "Err") return e;
      return Ok({ $: "Err", _0: e._0 });
    }
  }
}

// rustc: compiler/rustc_type_ir/src/fold.rs:282 fold_with
export function fold_with_Result<T, U>(self: Result<T, U>, folder: TypeFolder, fold_with_T: FoldWith<T>, fold_with_U: FoldWith<U>): Result<T, U> {
  switch (self.$) {
    case "Ok": {
      const v = self._0;
      return Ok(fold_with_T(v, folder));
    }
    case "Err": {
      const e = self._0;
      return { $: "Err", _0: fold_with_U(e, folder) };
    }
  }
}

// PORT: TS has no `Arc`: an `Arc<T>` is its `T` (PORTING §5), so there is no allocation to reuse and no clone to
// avoid; `Arc::make_mut` and the `ManuallyDrop` dance reduce to folding the value.
// rustc: compiler/rustc_type_ir/src/fold.rs:290 fold_arc
function fold_arc<T, E>(arc: T, fold: (t: T) => Result<T, E>): Result<T, E> {
  // We merely want to replace the contained `T`, if at all possible,
  // so that we don't needlessly allocate a new `Arc` or indeed clone
  // the contained type.
  const owned = arc;
  const folded = fold(owned);
  if (folded.$ === "Err") return folded;
  return Ok(folded._0);
}

/** `impl TypeFoldable for Arc<T>` (PORT: the `Arc` is its `T`) */
// rustc: compiler/rustc_type_ir/src/fold.rs:329 try_fold_with
export function try_fold_with_Arc<T, E>(self: T, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T, E> {
  return fold_arc(self, (t) => try_fold_with_T(t, folder));
}

// rustc: compiler/rustc_type_ir/src/fold.rs:333 fold_with
export function fold_with_Arc<T>(self: T, folder: TypeFolder, fold_with_T: FoldWith<T>): T {
  // PORT: `Infallible`: the `Err` arm cannot occur.
  const r = fold_arc<T, never>(self, (t) => Ok(fold_with_T(t, folder)));
  return r._0 as T;
}

/** `impl TypeFoldable for Box<T>` (PORT: the `Box` is its `T`) */
// rustc: compiler/rustc_type_ir/src/fold.rs:341 try_fold_with
export function try_fold_with_Box<T, E>(self: T, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T, E> {
  const r = try_fold_with_T(self, folder);
  if (r.$ === "Err") return r;
  self = r._0;
  return Ok(self);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:346 fold_with
export function fold_with_Box<T>(self: T, folder: TypeFolder, fold_with_T: FoldWith<T>): T {
  self = fold_with_T(self, folder);
  return self;
}

/** `impl TypeFoldable for Vec<T>` */
// rustc: compiler/rustc_type_ir/src/fold.rs:353 try_fold_with
export function try_fold_with_Vec<T, E>(self: readonly T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  // `collect` into `Result<Vec<_>, _>` stops at the first `Err`.
  const out: T[] = [];
  for (const t of self) {
    const r = try_fold_with_T(t, folder);
    if (r.$ === "Err") return r;
    out.push(r._0);
  }
  return Ok(out);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:357 fold_with
export function fold_with_Vec<T>(self: readonly T[], folder: TypeFolder, fold_with_T: FoldWith<T>): T[] {
  return self.map((t) => fold_with_T(t, folder));
}

/** `impl TypeFoldable for ThinVec<T>` */
// rustc: compiler/rustc_type_ir/src/fold.rs:363 try_fold_with
export function try_fold_with_ThinVec<T, E>(self: readonly T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  const out: T[] = [];
  for (const t of self) {
    const r = try_fold_with_T(t, folder);
    if (r.$ === "Err") return r;
    out.push(r._0);
  }
  return Ok(out);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:367 fold_with
export function fold_with_ThinVec<T>(self: readonly T[], folder: TypeFolder, fold_with_T: FoldWith<T>): T[] {
  return self.map((t) => fold_with_T(t, folder));
}

/** `impl TypeFoldable for Box<[T]>` */
// rustc: compiler/rustc_type_ir/src/fold.rs:373 try_fold_with
export function try_fold_with_slice<T, E>(self: readonly T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  // `Vec::from(self)` / `Vec::into_boxed_slice` are the identity on `T[]`.
  return try_fold_with_Vec(self, folder, try_fold_with_T);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:377 fold_with
export function fold_with_slice<T>(self: readonly T[], folder: TypeFolder, fold_with_T: FoldWith<T>): T[] {
  return fold_with_Vec(self, folder, fold_with_T);
}

/** `impl TypeFoldable for IndexVec<Ix, T>` (PORTING §5: `T[]`) */
// rustc: compiler/rustc_type_ir/src/fold.rs:383 try_fold_with
export function try_fold_with_IndexVec<T, E>(self: readonly T[], folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  // `self.raw` / `IndexVec::from_raw` are the identity on `T[]`.
  return try_fold_with_Vec(self, folder, try_fold_with_T);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:387 fold_with
export function fold_with_IndexVec<T>(self: readonly T[], folder: TypeFolder, fold_with_T: FoldWith<T>): T[] {
  return fold_with_Vec(self, folder, fold_with_T);
}

// PORT (D4): descriptor adapters over the container impls above (and visit.ts's), for generic code that takes a
// descriptor (`shift_vars(cx, [a, b], n, fold_tuple2(fold_A, fold_B))`). No upstream counterpart: in Rust the
// impls are found by the trait solver.
export function fold_tuple2<T, U>(d_T: TypeFoldable<T>, d_U: TypeFoldable<U>): TypeFoldable<[T, U]> {
  return {
    visit_with: (self, visitor) => visit_with_tuple2(self, visitor, d_T.visit_with, d_U.visit_with),
    try_fold_with: (self, folder) => try_fold_with_tuple2(self, folder, d_T.try_fold_with, d_U.try_fold_with),
    fold_with: (self, folder) => fold_with_tuple2(self, folder, d_T.fold_with, d_U.fold_with),
  };
}
export function fold_tuple3<A, B, C>(d_A: TypeFoldable<A>, d_B: TypeFoldable<B>, d_C: TypeFoldable<C>): TypeFoldable<[A, B, C]> {
  return {
    visit_with: (self, visitor) => visit_with_tuple3(self, visitor, d_A.visit_with, d_B.visit_with, d_C.visit_with),
    try_fold_with: (self, folder) => try_fold_with_tuple3(self, folder, d_A.try_fold_with, d_B.try_fold_with, d_C.try_fold_with),
    fold_with: (self, folder) => fold_with_tuple3(self, folder, d_A.fold_with, d_B.fold_with, d_C.fold_with),
  };
}
export function fold_Option<T>(d_T: TypeFoldable<T>): TypeFoldable<T | undefined> {
  return {
    visit_with: (self, visitor) => visit_with_Option(self, visitor, d_T.visit_with),
    try_fold_with: (self, folder) => try_fold_with_Option(self, folder, d_T.try_fold_with),
    fold_with: (self, folder) => fold_with_Option(self, folder, d_T.fold_with),
  };
}
export function fold_Vec<T>(d_T: TypeFoldable<T>): TypeFoldable<readonly T[]> {
  return {
    visit_with: (self, visitor) => visit_with_Vec(self, visitor, d_T.visit_with),
    try_fold_with: (self, folder) => try_fold_with_Vec(self, folder, d_T.try_fold_with),
    fold_with: (self, folder) => fold_with_Vec(self, folder, d_T.fold_with),
  };
}

///////////////////////////////////////////////////////////////////////////
// Shifter
//
// Shifts the De Bruijn indices on all escaping bound vars by a
// fixed amount. Useful in instantiation or when otherwise introducing
// a binding level that is not intended to capture the existing bound
// vars. See comment on `shift_vars_through_binders` method in
// `rustc_middle/src/ty/generic_args.rs` for more details.

// rustc-type: compiler/rustc_type_ir/src/fold.rs:401 Shifter
class Shifter implements TypeFolder {
  constructor(
    public cx_: TyCtxt,
    public current_index: DebruijnIndex,
    public amount: number,
  ) {}

  // rustc: compiler/rustc_type_ir/src/fold.rs:408 new
  static new(cx: TyCtxt, amount: number): Shifter {
    return new Shifter(cx, INNERMOST, amount);
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:414 cx
  cx(): TyCtxt {
    return this.cx_;
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:418 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.current_index = DebruijnIndex.shifted_in(this.current_index, 1);
    const t_ = fold_Binder(d).super_fold_with(t, this);
    this.current_index = DebruijnIndex.shifted_out(this.current_index, 1);
    return t_;
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:425 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const br = k._1;
      const debruijn = DebruijnIndex.shifted_in(k._0._0, this.amount);
      return Region.new_bound(this.cx_, debruijn, br);
    } else {
      return r;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:437 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const bound_ty = k._1;
      const debruijn = DebruijnIndex.shifted_in(k._0._0, this.amount);
      return Ty.new_bound(this.cx_, debruijn, bound_ty);
    } else if (TypeVisitableExt.has_vars_bound_at_or_above(ty, this.current_index, fold_Ty)) {
      return fold_Ty.super_fold_with(ty, this);
    } else {
      return ty;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:451 fold_const
  fold_const(ct: Const): Const {
    const k = ct.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const bound_ct = k._1;
      const debruijn = DebruijnIndex.shifted_in(k._0._0, this.amount);
      return Const.new_bound(this.cx_, debruijn, bound_ct);
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:463 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_vars_bound_at_or_above(p, this.current_index, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:467 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_vars_bound_at_or_above(c, this.current_index, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }
}

// rustc: compiler/rustc_type_ir/src/fold.rs:472 shift_region
export function shift_region(cx: TyCtxt, region: Region, amount: number): Region {
  const k = region.kind();
  if (k.$ === "ReBound" && k._0.$ === "Bound" && amount > 0) {
    const br = k._1;
    return Region.new_bound(cx, DebruijnIndex.shifted_in(k._0._0, amount), br);
  } else {
    return region;
  }
}

// PORT: D4 descriptor `d` of `T`.
// rustc: compiler/rustc_type_ir/src/fold.rs:482 shift_vars
export function shift_vars<T>(cx: TyCtxt, value: T, amount: number, d: TypeFoldable<T>): T {
  if (amount === 0 || !TypeVisitableExt.has_escaping_bound_vars(value, d)) {
    return value;
  } else {
    return d.fold_with(value, Shifter.new(cx, amount));
  }
}

///////////////////////////////////////////////////////////////////////////
// Region folder

// PORT: D4 descriptor `d` of `T`.
// rustc: compiler/rustc_type_ir/src/fold.rs:496 fold_regions
export function fold_regions<T>(cx: TyCtxt, value: T, f: (r: Region, debruijn: DebruijnIndex) => Region, d: TypeFoldable<T>): T {
  return d.fold_with(value, RegionFolder.new(cx, f));
}

/// Folds over the substructure of a type, visiting its component
/// types and all regions that occur *free* within it.
///
/// That is, function pointer types and trait objects can introduce
/// new bound regions which are not visited by this visitor as
/// they are not free; only regions that occur free will be
/// visited by `fold_region_fn`.
// rustc-type: compiler/rustc_type_ir/src/fold.rs:514 RegionFolder
export class RegionFolder implements TypeFolder {
  constructor(
    public cx_: TyCtxt,

    /// Stores the index of a binder *just outside* the stuff we have
    /// visited. So this begins as INNERMOST; when we pass through a
    /// binder, it is incremented (via `shift_in`).
    public current_index: DebruijnIndex,

    /// Callback invoked for each free region. The `DebruijnIndex`
    /// points to the binder *just outside* the ones we have passed
    /// through.
    public fold_region_fn: (r: Region, debruijn: DebruijnIndex) => Region,
  ) {}

  // rustc: compiler/rustc_type_ir/src/fold.rs:530 new
  static new(cx: TyCtxt, fold_region_fn: (r: Region, debruijn: DebruijnIndex) => Region): RegionFolder {
    return new RegionFolder(cx, INNERMOST, fold_region_fn);
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:540 cx
  cx(): TyCtxt {
    return this.cx_;
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:544 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.current_index = DebruijnIndex.shifted_in(this.current_index, 1);
    const t_ = fold_Binder(d).super_fold_with(t, this);
    this.current_index = DebruijnIndex.shifted_out(this.current_index, 1);
    return t_;
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:552 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 < this.current_index) {
      // debug!(?self.current_index, "skipped bound region");
      return r;
    } else if (k.$ === "ReBound" && k._0.$ === "Canonical") {
      // debug!(?self.current_index, "skipped bound region");
      return r;
    } else {
      // debug!(?self.current_index, "folding free region");
      return this.fold_region_fn(r, this.current_index);
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:571 fold_ty
  fold_ty(t: Ty): Ty {
    if (TypeVisitableExt.has_regions(t, fold_Ty)) {
      return fold_Ty.super_fold_with(t, this);
    } else {
      return t;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:575 fold_const
  fold_const(ct: Const): Const {
    if (TypeVisitableExt.has_regions(ct, fold_Const)) {
      return fold_Const.super_fold_with(ct, this);
    } else {
      return ct;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:579 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_regions(p, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:583 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_regions(c, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }
}

/// This function should ideally only be used if either the `TypingMode`
/// or the `ParamEnv` differs from the environment the aliases were normalized
/// in.
///
/// Cases outside these two should consider whether the problem can be
/// fixed at the root instead.
// PORT: D4 descriptor `d` of `T`.
// rustc: compiler/rustc_type_ir/src/fold.rs:594 set_aliases_to_non_rigid
export function set_aliases_to_non_rigid<T>(cx: TyCtxt, value: T, d: TypeFoldable<T>): Unnormalized<T> {
  const folded = set_aliases_rigidness_with_mode(cx, value, RigidnessFoldMode.AllToNonRigid, d);
  return Unnormalized.new(folded);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:602 set_opaques_to_non_rigid
export function set_opaques_to_non_rigid<T>(cx: TyCtxt, value: T, d: TypeFoldable<T>): Unnormalized<T> {
  const folded = set_aliases_rigidness_with_mode(cx, value, RigidnessFoldMode.OpaqueToNonRigid, d);
  return Unnormalized.new(folded);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:610 set_aliases_to_rigid
export function set_aliases_to_rigid<T>(cx: TyCtxt, value: T, d: TypeFoldable<T>): T {
  return set_aliases_rigidness_with_mode(cx, value, RigidnessFoldMode.AllToRigid, d);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:617 set_type_aliases_to_rigid
export function set_type_aliases_to_rigid<T>(cx: TyCtxt, value: T, d: TypeFoldable<T>): T {
  return set_aliases_rigidness_with_mode(cx, value, RigidnessFoldMode.TypeToRigid, d);
}

// rustc: compiler/rustc_type_ir/src/fold.rs:624 set_aliases_rigidness_with_mode
function set_aliases_rigidness_with_mode<T>(cx: TyCtxt, value: T, mode: RigidnessFoldMode, d: TypeFoldable<T>): T {
  if (!RigidnessFoldMode.needs_change(mode, value, d)) {
    return value;
  }

  const folder = new RigidnessFolder(cx, mode);
  return d.fold_with(value, folder);
}

// rustc-type: compiler/rustc_type_ir/src/fold.rs:636 RigidnessFoldMode
type RigidnessFoldMode = "AllToRigid" | "AllToNonRigid" | "TypeToRigid" | "OpaqueToNonRigid";
const RigidnessFoldMode = {
  AllToRigid: "AllToRigid",
  AllToNonRigid: "AllToNonRigid",
  TypeToRigid: "TypeToRigid",
  OpaqueToNonRigid: "OpaqueToNonRigid",

  // rustc: compiler/rustc_type_ir/src/fold.rs:644 needs_change
  needs_change<T>(self: RigidnessFoldMode, v: T, d: TypeVisitable<T>): boolean {
    switch (self) {
      case "AllToRigid":
        return TypeVisitableExt.has_non_rigid_aliases(v, d);
      case "AllToNonRigid":
        return TypeVisitableExt.has_rigid_aliases(v, d);
      case "TypeToRigid": {
        return TypeVisitableExt.has_non_rigid_aliases(v, d) && TypeVisitableExt.has_type_flags(v, TypeFlags.difference(TypeFlags.HAS_ALIAS, TypeFlags.HAS_CONST_ALIAS), d);
      }
      case "OpaqueToNonRigid":
        return TypeVisitableExt.has_rigid_aliases(v, d) && TypeVisitableExt.has_opaque_types(v, d);
    }
  },
} as const;

// Set aliases to be rigid or non-rigid according to the mode.
// rustc-type: compiler/rustc_type_ir/src/fold.rs:658 RigidnessFolder
class RigidnessFolder implements TypeFolder {
  constructor(
    public cx_: TyCtxt,
    public mode: RigidnessFoldMode,
  ) {}

  // rustc: compiler/rustc_type_ir/src/fold.rs:665 cx
  cx(): TyCtxt {
    return this.cx_;
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:669 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    if (RigidnessFoldMode.needs_change(this.mode, t, visit_Binder(d))) {
      return fold_Binder(d).super_fold_with(t, this);
    } else {
      return t;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:673 fold_ty
  fold_ty(t: Ty): Ty {
    if (!RigidnessFoldMode.needs_change(this.mode, t, fold_Ty)) {
      return t;
    }

    const k = t.kind();
    if (k.$ === "Alias") {
      const is_rigid = k._0;
      const alias_ty = fold_with_Alias<AliasTyKind>(k._1, this, fold_with_AliasTyKind);
      switch (this.mode) {
        case "AllToRigid":
        case "TypeToRigid":
          return Ty.new_alias(this.cx(), IsRigid.Yes, alias_ty);
        case "AllToNonRigid":
          return Ty.new_alias(this.cx(), IsRigid.No, alias_ty);
        case "OpaqueToNonRigid": {
          if (alias_ty.kind.$ === "Opaque") {
            return Ty.new_alias(this.cx(), IsRigid.No, alias_ty);
          } else {
            return Ty.new_alias(this.cx(), is_rigid, alias_ty);
          }
        }
      }
    } else {
      return fold_Ty.super_fold_with(t, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:701 fold_const
  fold_const(c: Const): Const {
    if (!RigidnessFoldMode.needs_change(this.mode, c, fold_Const)) {
      return c;
    }

    const k = c.kind();
    if (k.$ === "Alias") {
      const is_rigid = k._0;
      const alias_const = fold_with_Alias<AliasConstKind>(k._1, this, fold_with_AliasConstKind);
      switch (this.mode) {
        case "AllToRigid":
          return Const.new_alias(this.cx_, IsRigid.Yes, alias_const);
        case "AllToNonRigid":
          return Const.new_alias(this.cx(), IsRigid.No, alias_const);
        case "OpaqueToNonRigid":
        case "TypeToRigid":
          return Const.new_alias(this.cx(), is_rigid, alias_const);
      }
    } else {
      return fold_Const.super_fold_with(c, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:725 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (RigidnessFoldMode.needs_change(this.mode, p, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fold.rs:729 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (RigidnessFoldMode.needs_change(this.mode, c, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }

  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
}
