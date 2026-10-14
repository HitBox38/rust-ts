// Contract stub for compiler/rustc_type_ir/src/fold.rs (lane ty-contract; the rest is lane tyir-binder's).
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
//   (`fold_Binder<T>(d: TypeFoldable<T>): TypeFoldable<Binder<T>>`, `fold_Vec`, `fold_Option`, tuples).
//   tools/codegen generates them from `derive(TypeFoldable[_Generic], TypeVisitable[_Generic])` (honouring
//   `#[type_foldable(identity)]` / `#[type_visitable(ignore)]`); `super_*` impls are hand-ported.
// - A generic fn `fn f<T: TypeFoldable<I>>(.., value: T)` gains a trailing `d: TypeFoldable<T>` parameter,
//   with a `// PORT: D4 descriptor` note. `value.fold_with(folder)` is `d.fold_with(value, folder)`.
// - The folder traits stay traits: `TypeFolder` / `FallibleTypeFolder<E>` are interfaces implemented by
//   the folder classes. `I` is erased (rustc_middle's `TyCtxt`); `F::Error` is the type parameter `E`.
//   Methods generic over a foldable take its descriptor: `fold_binder<T>(t, d)`, `fold_predicate<P>(p, d)`.
//   Provided (default) methods live in `TypeFolder_provided` / `FallibleTypeFolder_provided` (PORTING §8);
//   a folder that keeps a default assigns the helper's function.
// - The blanket `impl<F: TypeFolder> FallibleTypeFolder for F` (`Error = !`) and the container impls
//   (tuples, `Option`, `Result`, `Arc`, `Box`, `Vec`, `ThinVec`, `Box<[T]>`, `IndexVec`), `Shifter`,
//   `shift_region`, `shift_vars`, `fold_regions`, `RegionFolder`, the rigidness folders: lane tyir-binder.
import type { Clauses } from "../rustc_middle/ty/list.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { Binder, ClauseKind, ProjectionClause } from "./decls.ts";
import type { Const, Region } from "./sty/mod.ts";
import type { Flags, TypeSuperVisitable, TypeVisitable } from "./visit.ts";

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

/** PORT: the provided methods of `TypeFolder` (PORTING §8), filled by lane tyir-binder. */
export const TypeFolder_provided = {
  fold_binder<T>(_self: TypeFolder, _t: Binder<T>, _d: TypeFoldable<T>): Binder<T> {
    return unported("rustc_type_ir::fold::TypeFolder::fold_binder (provided)");
  },
  fold_ty(_self: TypeFolder, _t: Ty): Ty {
    return unported("rustc_type_ir::fold::TypeFolder::fold_ty (provided)");
  },
  fold_region(_self: TypeFolder, _r: Region): Region {
    return unported("rustc_type_ir::fold::TypeFolder::fold_region (provided)");
  },
  fold_const(_self: TypeFolder, _c: Const): Const {
    return unported("rustc_type_ir::fold::TypeFolder::fold_const (provided)");
  },
  fold_predicate<P>(_self: TypeFolder, _p: P, _d: PredicateProxy<P>): P {
    return unported("rustc_type_ir::fold::TypeFolder::fold_predicate (provided)");
  },
  fold_clauses(_self: TypeFolder, _c: Clauses): Clauses {
    return unported("rustc_type_ir::fold::TypeFolder::fold_clauses (provided)");
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

/** PORT: the provided methods of `FallibleTypeFolder` (PORTING §8), filled by lane tyir-binder. */
export const FallibleTypeFolder_provided = {
  try_fold_binder<T, E>(_self: FallibleTypeFolder<E>, _t: Binder<T>, _d: TypeFoldable<T>): Result<Binder<T>, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_binder (provided)");
  },
  try_fold_ty<E>(_self: FallibleTypeFolder<E>, _t: Ty): Result<Ty, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_ty (provided)");
  },
  try_fold_region<E>(_self: FallibleTypeFolder<E>, _r: Region): Result<Region, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_region (provided)");
  },
  try_fold_const<E>(_self: FallibleTypeFolder<E>, _c: Const): Result<Const, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_const (provided)");
  },
  try_fold_predicate<P, E>(_self: FallibleTypeFolder<E>, _p: P, _d: PredicateProxy<P>): Result<P, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_predicate (provided)");
  },
  try_fold_clauses<E>(_self: FallibleTypeFolder<E>, _c: Clauses): Result<Clauses, E> {
    return unported("rustc_type_ir::fold::FallibleTypeFolder::try_fold_clauses (provided)");
  },
};

// ---- the container impls (fold.rs:232-392; lane tyir-binder) and the tools/codegen facade ----
// PORT (merge-w13): generated code (tools/codegen type_fold.json, `module`) imports the traversal names from this
// module: the folder / visitor traits, the impl fn types (`<T as TypeFoldable>::try_fold_with` as a value is
// `TryFoldWith<T>`, the method of `T`'s D4 descriptor), the `TrivialTypeTraversalImpls!` fns and the container
// impls of visit.rs / fold.rs. A generic impl takes the impl fns of its type arguments after the folder. Stubs moved
// from codegen-tyir's src/rust_ts/tyir_contract.ts.
export type { TypeVisitor, VisitWith } from "./visit.ts";
export { visit_with_IndexSet, visit_with_Option, visit_with_Result, visit_with_slice, visit_with_tuple2, visit_with_tuple3, visit_with_Vec } from "./visit.ts";
export { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "./macros.ts";
export type TryFoldWith<T> = TypeFoldable<T>["try_fold_with"];
export type FoldWith<T> = TypeFoldable<T>["fold_with"];

/** Stub: `impl TypeFoldable for (T, U)` (fold.rs:232). */
export function try_fold_with_tuple2<T, U, E>(_self: [T, U], _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>, _try_fold_with_U: TryFoldWith<U>): Result<[T, U], E> {
  return unported("rustc_type_ir::fold: TypeFoldable for (T, U)");
}
export function fold_with_tuple2<T, U>(_self: [T, U], _folder: TypeFolder, _fold_with_T: FoldWith<T>, _fold_with_U: FoldWith<U>): [T, U] {
  return unported("rustc_type_ir::fold: TypeFoldable for (T, U)");
}
/** Stub: `impl TypeFoldable for (A, B, C)` (fold.rs:242). */
export function try_fold_with_tuple3<A, B, C, E>(_self: [A, B, C], _folder: FallibleTypeFolder<E>, _a: TryFoldWith<A>, _b: TryFoldWith<B>, _c: TryFoldWith<C>): Result<[A, B, C], E> {
  return unported("rustc_type_ir::fold: TypeFoldable for (A, B, C)");
}
export function fold_with_tuple3<A, B, C>(_self: [A, B, C], _folder: TypeFolder, _a: FoldWith<A>, _b: FoldWith<B>, _c: FoldWith<C>): [A, B, C] {
  return unported("rustc_type_ir::fold: TypeFoldable for (A, B, C)");
}
/** Stub: `impl TypeFoldable for Option<T>` (fold.rs:261). */
export function try_fold_with_Option<T, E>(_self: T | undefined, _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>): Result<T | undefined, E> {
  return unported("rustc_type_ir::fold: TypeFoldable for Option<T>");
}
export function fold_with_Option<T>(_self: T | undefined, _folder: TypeFolder, _fold_with_T: FoldWith<T>): T | undefined {
  return unported("rustc_type_ir::fold: TypeFoldable for Option<T>");
}
/** Stub: `impl TypeFoldable for Result<T, E>` (fold.rs:274). */
export function try_fold_with_Result<T, U, E>(_self: Result<T, U>, _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>, _try_fold_with_U: TryFoldWith<U>): Result<Result<T, U>, E> {
  return unported("rustc_type_ir::fold: TypeFoldable for Result<T, E>");
}
export function fold_with_Result<T, U>(_self: Result<T, U>, _folder: TypeFolder, _fold_with_T: FoldWith<T>, _fold_with_U: FoldWith<U>): Result<T, U> {
  return unported("rustc_type_ir::fold: TypeFoldable for Result<T, E>");
}
/** Stub: `impl TypeFoldable for Vec<T>` (fold.rs:352; also `ThinVec` :362, `IndexVec` :382). */
export function try_fold_with_Vec<T, E>(_self: T[], _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  return unported("rustc_type_ir::fold: TypeFoldable for Vec<T>");
}
export function fold_with_Vec<T>(_self: T[], _folder: TypeFolder, _fold_with_T: FoldWith<T>): T[] {
  return unported("rustc_type_ir::fold: TypeFoldable for Vec<T>");
}
/** Stub: `impl TypeFoldable for Box<[T]>` (fold.rs:372). */
export function try_fold_with_slice<T, E>(_self: T[], _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>): Result<T[], E> {
  return unported("rustc_type_ir::fold: TypeFoldable for Box<[T]>");
}
export function fold_with_slice<T>(_self: T[], _folder: TypeFolder, _fold_with_T: FoldWith<T>): T[] {
  return unported("rustc_type_ir::fold: TypeFoldable for Box<[T]>");
}
