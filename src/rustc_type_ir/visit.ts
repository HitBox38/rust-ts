// Port of compiler/rustc_type_ir/src/visit.rs (lane tyir-binder; the trait declarations are lane ty-contract's).
//
//! A visiting traversal mechanism for complex data structures that contain type
//! information.
//!
//! This is a read-only traversal of the data structure.
//!
//! This traversal has limited flexibility. Only a small number of "types of
//! interest" within the complex data structures can receive custom
//! visitation. These are the ones containing the most important type-related
//! information, such as `Ty`, `Predicate`, `Region`, and `Const`.
//!
//! There are three traits involved in each traversal.
//! - `TypeVisitable`. This is implemented once for many types, including:
//!   - Types of interest, for which the methods delegate to the visitor.
//!   - All other types, including generic containers like `Vec` and `Option`.
//!     It defines a "skeleton" of how they should be visited.
//! - `TypeSuperVisitable`. This is implemented only for recursive types of
//!   interest, and defines the visiting "skeleton" for these types. (This
//!   excludes `Region` because it is non-recursive, i.e. it never contains
//!   other types of interest.)
//! - `TypeVisitor`. This is implemented for each visitor. This defines how
//!   types of interest are visited.
//!
//! This means each visit is a mixture of (a) generic visiting operations, and (b)
//! custom visit operations that are specific to the visitor.
//! - The `TypeVisitable` impls handle most of the traversal, and call into
//!   `TypeVisitor` when they encounter a type of interest.
//! - A `TypeVisitor` may call into another `TypeVisitable` impl, because some of
//!   the types of interest are recursive and can contain other types of interest.
//! - A `TypeVisitor` may also call into a `TypeSuperVisitable` impl, because each
//!   visitor might provide custom handling only for some types of interest, or
//!   only for some variants of each type of interest, and then use default
//!   traversal for the remaining cases.
//!
//! For example, if you have `struct S(Ty, U)` where `S: TypeVisitable` and `U:
//! TypeVisitable`, and an instance `s = S(ty, u)`, it would be visited like so:
//! ```text
//! s.visit_with(visitor) calls
//! - ty.visit_with(visitor) calls
//!   - visitor.visit_ty(ty) may call
//!     - ty.super_visit_with(visitor)
//! - u.visit_with(visitor)
//! ```
//
// PORT (docs/plan-m3.md D4; see fold.ts): `TypeVisitable<T>` / `TypeSuperVisitable<T>` are descriptors (one
// object per Rust impl, `visit_<T>` or part of `fold_<T>`); `TypeVisitor<R>` stays a trait, implemented by the
// visitor classes. `V::Result` is the type parameter `R`, and the visitor carries its `VisitorResult` impl
// object in its `Result` property, as rustc_ast's `Visitor` does (rustc_ast_ir/visit.ts):
// `Self::Result::output()` is `this.Result.output()`. Provided methods live in `TypeVisitor_provided`
// (PORTING §8); a visitor class implements every method and forwards the ones it does not override.
// `Flags` is a descriptor too (`Flags<T>`); the interned classes also have `flags()` /
// `outer_exclusive_binder()` methods.
// PORT: the container impls (`(T, U)`, `Option`, `Vec`, ...) are free fns in tools/codegen's shape
// (type_fold.json): `visit_with_<C>(self, visitor, visit_with_T, ..)`, taking the impl fns of the type arguments
// after the visitor. `fold.ts` has descriptor adapters over them (`fold_Vec(d)`, ...).
// PORT: `TypeVisitableExt` has exactly one impl, the blanket `impl<T: TypeVisitable> TypeVisitableExt for T`
// (:385), so the trait and its impl are one companion object of functions taking `self` first and the
// descriptor of `T` last (D4). The required methods carry two markers (declaration and blanket impl).
import { ControlFlow, try_visit, type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { Fmt } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Binder, visit_Binder } from "./binder.ts";
import { type PredicateProxy, standin_fold_Clauses, standin_fold_Ty } from "./fold.ts";
import { debug_TypeFlags, TypeFlags } from "./flags.ts";
import { type DebruijnIndex, INNERMOST } from "./lib.ts";
import { type Const, fold_Const, type Region } from "./sty/mod.ts";
import { DebruijnIndex_shifted_in, DebruijnIndex_shifted_out } from "./ty_kind.ts";

/// This trait is implemented for every type that can be visited,
/// providing the skeleton of the traversal.
///
/// To implement this conveniently, use the derive macro located in
/// `rustc_macros`.
// rustc-trait: compiler/rustc_type_ir/src/visit.rs:63 TypeVisitable
export interface TypeVisitable<T> {
  /// The entry point for visiting. To visit a value `t` with a visitor `v`
  /// call: `t.visit_with(v)`.
  ///
  /// For most types, this just traverses the value, calling `visit_with` on
  /// each field/element.
  ///
  /// For types of interest (such as `Ty`), the implementation of this method
  /// calls a visitor method specifically for that type (such as
  /// `V::visit_ty`). This is where control transfers from `TypeVisitable` to
  /// `TypeVisitor`.
  // rustc: compiler/rustc_type_ir/src/visit.rs:74 visit_with
  visit_with<R>(self: T, visitor: TypeVisitor<R>): R;
}

// This trait is implemented for types of interest.
// rustc-trait: compiler/rustc_type_ir/src/visit.rs:78 TypeSuperVisitable
export interface TypeSuperVisitable<T> extends TypeVisitable<T> {
  /// Provides a default visit for a recursive type of interest. This should
  /// only be called within `TypeVisitor` methods, when a non-custom
  /// traversal is desired for the value of the type of interest passed to
  /// that method. For example, in `MyVisitor::visit_ty(ty)`, it is valid to
  /// call `ty.super_visit_with(self)`, but any other visiting should be done
  /// with `xyz.visit_with(self)`.
  // rustc: compiler/rustc_type_ir/src/visit.rs:85 super_visit_with
  super_visit_with<R>(self: T, visitor: TypeVisitor<R>): R;
}

/// This trait is implemented for every visiting traversal. There is a visit
/// method defined for every type of interest. Each such method has a default
/// that recurses into the type's fields in a non-custom fashion.
// rustc-trait: compiler/rustc_type_ir/src/visit.rs:91 TypeVisitor
export interface TypeVisitor<R> {
  /** `type Result: VisitorResult = ()`: the impl object (module comment). */
  readonly Result: VisitorResult<R, unknown>;
  // (provided) visit.rs:98 visit_binder -> TypeVisitor_provided.visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): R;
  // (provided) visit.rs:102 visit_ty
  visit_ty(t: Ty): R;
  // (provided) visit.rs:108 visit_region
  visit_region(r: Region): R;
  // (provided) visit.rs:116 visit_const
  visit_const(c: Const): R;
  // (provided) visit.rs:120 visit_predicate
  visit_predicate<P>(p: P, d: PredicateProxy<P>): R;
  // (provided) visit.rs:124 visit_clauses
  visit_clauses(c: Clauses): R;
  // (provided) visit.rs:128 visit_error
  visit_error(guar: ErrorGuaranteed): R;
}

/** PORT: the provided methods of `TypeVisitor` (PORTING §8). */
export const TypeVisitor_provided = {
  // rustc: compiler/rustc_type_ir/src/visit.rs:98 visit_binder
  visit_binder<T, R>(self: TypeVisitor<R>, t: Binder<T>, d: TypeVisitable<T>): R {
    return visit_Binder(d).super_visit_with(t, self);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:102 visit_ty
  visit_ty<R>(self: TypeVisitor<R>, t: Ty): R {
    return standin_fold_Ty.super_visit_with(t, self);
  },

  // `Region` is non-recursive so the default region visitor has no
  // `super_visit_with` method to call.
  // rustc: compiler/rustc_type_ir/src/visit.rs:108 visit_region
  visit_region<R>(self: TypeVisitor<R>, r: Region): R {
    const k = r.kind();
    if (k.$ === "ReError") {
      const guar = k._0;
      return self.visit_error(guar);
    } else {
      return self.Result.output();
    }
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:116 visit_const
  visit_const<R>(self: TypeVisitor<R>, c: Const): R {
    return fold_Const.super_visit_with(c, self);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:120 visit_predicate
  visit_predicate<P, R>(self: TypeVisitor<R>, p: P, d: PredicateProxy<P>): R {
    return d.super_visit_with(p, self);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:124 visit_clauses
  visit_clauses<R>(self: TypeVisitor<R>, c: Clauses): R {
    return standin_fold_Clauses.super_visit_with(c, self);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:128 visit_error
  visit_error<R>(self: TypeVisitor<R>, _guar: ErrorGuaranteed): R {
    return self.Result.output();
  },
};

///////////////////////////////////////////////////////////////////////////
// Traversal implementations.

/** PORT: `<T as TypeVisitable>::visit_with` as a value (tools/codegen type_fold.json): the `visit_with` of `T`'s
 *  D4 descriptor. */
export type VisitWith<T> = TypeVisitable<T>["visit_with"];

/** `impl TypeVisitable for (T, U)` */
// rustc: compiler/rustc_type_ir/src/visit.rs:137 visit_with
export function visit_with_tuple2<T, U, R>(self: readonly [T, U], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>, visit_with_U: VisitWith<U>): R {
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visit_with_T(self[0], visitor))) !== undefined) return r;
  return visit_with_U(self[1], visitor);
}

/** `impl TypeVisitable for (A, B, C)` */
// rustc: compiler/rustc_type_ir/src/visit.rs:146 visit_with
export function visit_with_tuple3<A, B, C, R>(self: readonly [A, B, C], visitor: TypeVisitor<R>, visit_with_A: VisitWith<A>, visit_with_B: VisitWith<B>, visit_with_C: VisitWith<C>): R {
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visit_with_A(self[0], visitor))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visit_with_B(self[1], visitor))) !== undefined) return r;
  return visit_with_C(self[2], visitor);
}

/** `impl TypeVisitable for Option<T>` */
// rustc: compiler/rustc_type_ir/src/visit.rs:154 visit_with
export function visit_with_Option<T, R>(self: T | undefined, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  if (self !== undefined) {
    const v = self;
    return visit_with_T(v, visitor);
  } else {
    return visitor.Result.output();
  }
}

/** `impl TypeVisitable for Result<T, E>` */
// rustc: compiler/rustc_type_ir/src/visit.rs:163 visit_with
export function visit_with_Result<T, U, R>(self: Result<T, U>, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>, visit_with_U: VisitWith<U>): R {
  switch (self.$) {
    case "Ok": {
      const v = self._0;
      return visit_with_T(v, visitor);
    }
    case "Err": {
      const e = self._0;
      return visit_with_U(e, visitor);
    }
  }
}

/** `impl TypeVisitable for &T` (PORT: TS has no references; the impl of `T`, kept for the marker). */
// rustc: compiler/rustc_type_ir/src/visit.rs:172 visit_with
export function visit_with_Ref<T, R>(self: T, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  return visit_with_T(self, visitor);
}

/** `impl TypeVisitable for Arc<T>` (PORT: TS has no `Arc`; the impl of `T`). */
// rustc: compiler/rustc_type_ir/src/visit.rs:178 visit_with
export function visit_with_Arc<T, R>(self: T, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  return visit_with_T(self, visitor);
}

/** `impl TypeVisitable for Box<T>` (PORT: TS has no `Box`; the impl of `T`). */
// rustc: compiler/rustc_type_ir/src/visit.rs:184 visit_with
export function visit_with_Box<T, R>(self: T, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  return visit_with_T(self, visitor);
}

// PORT: `walk_visitable_list!(visitor, self.iter())` (rustc_ast_ir) is `for elem in iter { try_visit!(elem.visit_with(visitor)) }`,
// expanded inline in each impl below.

/** `impl TypeVisitable for Vec<T>` */
// rustc: compiler/rustc_type_ir/src/visit.rs:190 visit_with
export function visit_with_Vec<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

/** `impl TypeVisitable for ThinVec<T>` */
// rustc: compiler/rustc_type_ir/src/visit.rs:197 visit_with
export function visit_with_ThinVec<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

/** `impl TypeVisitable for SmallVec<[T; N]>` */
// rustc: compiler/rustc_type_ir/src/visit.rs:204 visit_with
export function visit_with_SmallVec<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// `TypeFoldable` isn't impl'd for `&[T]`. It doesn't make sense in the general
// case, because we can't return a new slice. But note that there are a couple
// of trivial impls of `TypeFoldable` for specific slice types elsewhere.
/** `impl TypeVisitable for [T]` */
// rustc: compiler/rustc_type_ir/src/visit.rs:214 visit_with
export function visit_with_slice<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

/** `impl TypeVisitable for [T; N]` */
// rustc: compiler/rustc_type_ir/src/visit.rs:221 visit_with
export function visit_with_array<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

/** `impl TypeVisitable for IndexVec<Ix, T>` (PORTING §5: `T[]`) */
// rustc: compiler/rustc_type_ir/src/visit.rs:228 visit_with
export function visit_with_IndexVec<T, R>(self: readonly T[], visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

/** `impl TypeVisitable for indexmap::IndexSet<T, S>` (PORTING §5: `Set`) */
// rustc: compiler/rustc_type_ir/src/visit.rs:235 visit_with
export function visit_with_IndexSet<T, R>(self: ReadonlySet<T>, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  let r: R | undefined;
  for (const elem of self) {
    if ((r = try_visit(visitor.Result, visit_with_T(elem, visitor))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// PORT (D4): `pub trait Flags` as a descriptor over `T` (the interned classes also carry the two methods).
// rustc-trait: compiler/rustc_type_ir/src/visit.rs:241 Flags
export interface Flags<T> {
  // rustc: compiler/rustc_type_ir/src/visit.rs:242 flags
  flags(self: T): TypeFlags;
  // rustc: compiler/rustc_type_ir/src/visit.rs:243 outer_exclusive_binder
  outer_exclusive_binder(self: T): DebruijnIndex;
}

// rustc-trait: compiler/rustc_type_ir/src/visit.rs:246 TypeVisitableExt
// PORT: trait + blanket impl (:385) as one companion object; `d` is `T`'s D4 descriptor (module comment).
export const TypeVisitableExt = {
  // rustc: compiler/rustc_type_ir/src/visit.rs:247 has_type_flags
  // rustc: compiler/rustc_type_ir/src/visit.rs:386 has_type_flags
  has_type_flags<T>(self: T, flags: TypeFlags, d: TypeVisitable<T>): boolean {
    const r = d.visit_with(self, new HasTypeFlagsVisitor(flags));
    return r.$ === "Break" && r._0 === FoundFlags;
  },

  /// Returns `true` if `self` has any late-bound regions that are either
  /// bound by `binder` or bound by some binder outside of `binder`.
  /// If `binder` is `ty::INNERMOST`, this indicates whether
  /// there are any late-bound regions that appear free.
  // rustc: compiler/rustc_type_ir/src/visit.rs:253 has_vars_bound_at_or_above
  // rustc: compiler/rustc_type_ir/src/visit.rs:390 has_vars_bound_at_or_above
  has_vars_bound_at_or_above<T>(self: T, binder: DebruijnIndex, d: TypeVisitable<T>): boolean {
    const r = d.visit_with(self, new HasEscapingVarsVisitor(binder));
    return r.$ === "Break" && r._0 === FoundEscapingVars;
  },

  /// Returns `true` if this type has any regions that escape `binder` (and
  /// hence are not bound by it).
  // rustc: compiler/rustc_type_ir/src/visit.rs:257 has_vars_bound_above
  has_vars_bound_above<T>(self: T, binder: DebruijnIndex, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_vars_bound_at_or_above(self, DebruijnIndex_shifted_in(binder, 1), d);
  },

  /// Returns `true` if this type has regions that are not a part of the
  /// type. For example, given a `for<'a> fn(&'a i32)` this function returns
  /// `false`, while given a `fn(&'a i32)` it returns `true`. The latter can
  /// occur when traversing through the former.
  ///
  /// See [`HasEscapingVarsVisitor`] for more information.
  // rustc: compiler/rustc_type_ir/src/visit.rs:267 has_escaping_bound_vars
  has_escaping_bound_vars<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_vars_bound_at_or_above(self, INNERMOST, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:271 has_aliases
  has_aliases<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_ALIAS, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:275 has_opaque_types
  has_opaque_types<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_TY_OPAQUE, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:279 has_coroutines
  has_coroutines<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_TY_CORO, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:283 references_error
  references_error<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_ERROR, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:287 error_reported
  // rustc: compiler/rustc_type_ir/src/visit.rs:395 error_reported
  error_reported<T>(self: T, d: TypeVisitable<T>): Result<null, ErrorGuaranteed> {
    if (TypeVisitableExt.references_error(self, d)) {
      const r = d.visit_with(self, new HasErrorVisitor());
      if (r.$ === "Break") {
        const guar = r._0;
        return Err(guar);
      } else {
        return panic("type flags said there was an error, but now there is not");
      }
    } else {
      return Ok(null);
    }
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:289 non_region_error_reported
  // rustc: compiler/rustc_type_ir/src/visit.rs:407 non_region_error_reported
  non_region_error_reported<T>(self: T, d: TypeVisitable<T>): Result<null, ErrorGuaranteed> {
    if (TypeVisitableExt.has_non_region_error(self, d)) {
      const r = d.visit_with(self, new HasErrorVisitor());
      if (r.$ === "Break") {
        const guar = r._0;
        return Err(guar);
      } else {
        return panic("type flags said there was an non region error, but now there is not");
      }
    } else {
      return Ok(null);
    }
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:291 has_non_region_param
  has_non_region_param<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.difference(TypeFlags.HAS_PARAM, TypeFlags.HAS_RE_PARAM), d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:295 has_regions
  has_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_REGIONS, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:299 has_infer_regions
  has_infer_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_RE_INFER, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:303 has_infer_types
  has_infer_types<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_TY_INFER, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:307 has_non_region_infer
  has_non_region_infer<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.difference(TypeFlags.HAS_INFER, TypeFlags.HAS_RE_INFER), d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:311 has_infer
  has_infer<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_INFER, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:315 has_placeholders
  has_placeholders<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_PLACEHOLDER, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:319 has_non_region_placeholders
  has_non_region_placeholders<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.difference(TypeFlags.HAS_PLACEHOLDER, TypeFlags.HAS_RE_PLACEHOLDER), d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:323 has_param
  has_param<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_PARAM, d);
  },

  /// "Free" regions in this context means that it has any region
  /// that is not (a) erased or (b) late-bound.
  // rustc: compiler/rustc_type_ir/src/visit.rs:329 has_free_regions
  has_free_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_FREE_REGIONS, d);
  },

  // rustc: compiler/rustc_type_ir/src/visit.rs:333 has_erased_regions
  has_erased_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_RE_ERASED, d);
  },

  /// True if there are any un-erased free regions.
  // rustc: compiler/rustc_type_ir/src/visit.rs:338 has_erasable_regions
  has_erasable_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_FREE_REGIONS, d);
  },

  /// Indicates whether this value references only 'global'
  /// generic parameters that are the same regardless of what fn we are
  /// in. This is used for caching.
  // rustc: compiler/rustc_type_ir/src/visit.rs:345 is_global
  is_global<T>(self: T, d: TypeVisitable<T>): boolean {
    return !TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_FREE_LOCAL_NAMES, d);
  },

  /// True if there are any late-bound regions
  // rustc: compiler/rustc_type_ir/src/visit.rs:350 has_bound_regions
  has_bound_regions<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_RE_BOUND, d);
  },
  /// True if there are any late-bound non-region variables
  // rustc: compiler/rustc_type_ir/src/visit.rs:354 has_non_region_bound_vars
  has_non_region_bound_vars<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.difference(TypeFlags.HAS_BOUND_VARS, TypeFlags.HAS_RE_BOUND), d);
  },
  /// True if there are any bound variables
  // rustc: compiler/rustc_type_ir/src/visit.rs:358 has_bound_vars
  has_bound_vars<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_BOUND_VARS, d);
  },

  /// Indicates whether this value still has parameters/placeholders/inference variables
  /// which could be replaced later, in a way that would change the results of `impl`
  /// specialization.
  // rustc: compiler/rustc_type_ir/src/visit.rs:365 still_further_specializable
  still_further_specializable<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.STILL_FURTHER_SPECIALIZABLE, d);
  },

  /// True if a type or const error is reachable
  // rustc: compiler/rustc_type_ir/src/visit.rs:370 has_non_region_error
  has_non_region_error<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_NON_REGION_ERROR, d);
  },

  /// True if an alias has `IsRigid::Yes`. Used for skipping normalization.
  // rustc: compiler/rustc_type_ir/src/visit.rs:375 has_rigid_aliases
  has_rigid_aliases<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_RIGID_ALIAS, d);
  },

  /// True if an alias has `IsRigid::No`.
  // rustc: compiler/rustc_type_ir/src/visit.rs:380 has_non_rigid_aliases
  has_non_rigid_aliases<T>(self: T, d: TypeVisitable<T>): boolean {
    return TypeVisitableExt.has_type_flags(self, TypeFlags.HAS_NON_RIGID_ALIAS, d);
  },
};

// PORT: the unit struct is its name (`#[derive(PartialEq)]` of a ZST: always equal).
// rustc-type: compiler/rustc_type_ir/src/visit.rs:421 FoundFlags
type FoundFlags = "FoundFlags";
const FoundFlags: FoundFlags = "FoundFlags";

// FIXME: Optimize for checking for infer flags
// rustc-type: compiler/rustc_type_ir/src/visit.rs:424 HasTypeFlagsVisitor
// Note: this visitor traverses values down to the level of
// `Ty`/`Const`/`Predicate`, but not within those types. This is because the
// type flags at the outer layer are enough. So it's faster than it first
// looks, particular for `Ty`/`Predicate` where it's just a field access.
//
// N.B. The only case where this isn't totally true is binders, which also
// add `HAS_BINDER_VARS` flag depending on the *bound variables* that
// are present, regardless of whether those bound variables are used. This
// is important for anonymization of binders in `TyCtxt::erase_and_anonymize_regions`. We
// specifically detect this case in `visit_binder`.
class HasTypeFlagsVisitor implements TypeVisitor<ControlFlow<FoundFlags>> {
  readonly Result: VisitorResult<ControlFlow<FoundFlags>, unknown> = VisitorResultC.ControlFlow<FoundFlags>();

  constructor(public flags: TypeFlags) {}

  // rustc: compiler/rustc_type_ir/src/visit.rs:447 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<FoundFlags> {
    // If we're looking for the HAS_BINDER_VARS flag, check if the
    // binder has vars. This won't be present in the binder's bound
    // value, so we need to check here too.
    if (TypeFlags.intersects(this.flags, TypeFlags.HAS_BINDER_VARS) && !(Binder.bound_vars(t).length === 0)) {
      return ControlFlow.Break(FoundFlags);
    }

    return visit_Binder(d).super_visit_with(t, this);
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:459 visit_ty
  visit_ty(t: Ty): ControlFlow<FoundFlags> {
    // Note: no `super_visit_with` call.
    if (TypeFlags.intersects(t.flags(), this.flags)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:469 visit_region
  visit_region(r: Region): ControlFlow<FoundFlags> {
    // Note: no `super_visit_with` call, as usual for `Region`.
    if (TypeFlags.intersects(r.flags(), this.flags)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:479 visit_const
  visit_const(c: Const): ControlFlow<FoundFlags> {
    // Note: no `super_visit_with` call.
    if (TypeFlags.intersects(c.flags(), this.flags)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:489 visit_predicate
  visit_predicate<P>(predicate: P, d: PredicateProxy<P>): ControlFlow<FoundFlags> {
    // Note: no `super_visit_with` call.
    if (TypeFlags.intersects(d.flags.flags(predicate), this.flags)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:499 visit_clauses
  visit_clauses(clauses: Clauses): ControlFlow<FoundFlags> {
    // Note: no `super_visit_with` call.
    if (TypeFlags.intersects(clauses.flags(), this.flags)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:509 visit_error
  visit_error(_guar: ErrorGuaranteed): ControlFlow<FoundFlags> {
    if (TypeFlags.intersects(this.flags, TypeFlags.HAS_ERROR)) {
      return ControlFlow.Break(FoundFlags);
    } else {
      return ControlFlow.CONTINUE;
    }
  }
}

/** `impl std::fmt::Debug for HasTypeFlagsVisitor` */
// rustc: compiler/rustc_type_ir/src/visit.rs:429 fmt
export function debug_HasTypeFlagsVisitor(self: HasTypeFlagsVisitor, fmt: Fmt): string {
  return debug_TypeFlags(self.flags, fmt);
}

// PORT: the unit struct is its name (as `FoundFlags`).
// rustc-type: compiler/rustc_type_ir/src/visit.rs:519 FoundEscapingVars
type FoundEscapingVars = "FoundEscapingVars";
const FoundEscapingVars: FoundEscapingVars = "FoundEscapingVars";

/// An "escaping var" is a bound var whose binder is not part of `t`. A bound var can be a
/// bound region or a bound type.
///
/// So, for example, consider a type like the following, which has two binders:
///
///    for<'a> fn(x: for<'b> fn(&'a isize, &'b isize))
///    ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ outer scope
///                  ^~~~~~~~~~~~~~~~~~~~~~~~~~~~  inner scope
///
/// This type has *bound regions* (`'a`, `'b`), but it does not have escaping regions, because the
/// binders of both `'a` and `'b` are part of the type itself. However, if we consider the *inner
/// fn type*, that type has an escaping region: `'a`.
///
/// Note that what I'm calling an "escaping var" is often just called a "free var". However,
/// we already use the term "free var". It refers to the regions or types that we use to represent
/// bound regions or type params on a fn definition while we are type checking its body.
///
/// To clarify, conceptually there is no particular difference between
/// an "escaping" var and a "free" var. However, there is a big
/// difference in practice. Basically, when "entering" a binding
/// level, one is generally required to do some sort of processing to
/// a bound var, such as replacing it with a fresh/placeholder
/// var, or making an entry in the environment to represent the
/// scope to which it is attached, etc. An escaping var represents
/// a bound var for which this processing has not yet been done.
// rustc-type: compiler/rustc_type_ir/src/visit.rs:546 HasEscapingVarsVisitor
class HasEscapingVarsVisitor implements TypeVisitor<ControlFlow<FoundEscapingVars>> {
  readonly Result: VisitorResult<ControlFlow<FoundEscapingVars>, unknown> = VisitorResultC.ControlFlow<FoundEscapingVars>();

  constructor(
    /// Anything bound by `outer_index` or "above" is escaping.
    public outer_index: DebruijnIndex,
  ) {}

  // rustc: compiler/rustc_type_ir/src/visit.rs:554 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<FoundEscapingVars> {
    this.outer_index = DebruijnIndex_shifted_in(this.outer_index, 1);
    const result = visit_Binder(d).super_visit_with(t, this);
    this.outer_index = DebruijnIndex_shifted_out(this.outer_index, 1);
    return result;
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:562 visit_ty
  visit_ty(t: Ty): ControlFlow<FoundEscapingVars> {
    // If the outer-exclusive-binder is *strictly greater* than
    // `outer_index`, that means that `t` contains some content
    // bound at `outer_index` or above (because
    // `outer_exclusive_binder` is always 1 higher than the
    // content in `t`). Therefore, `t` has some escaping vars.
    if (t.outer_exclusive_binder() > this.outer_index) {
      return ControlFlow.Break(FoundEscapingVars);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:576 visit_region
  visit_region(r: Region): ControlFlow<FoundEscapingVars> {
    // If the region is bound by `outer_index` or anything outside
    // of outer index, then it escapes the binders we have
    // visited.
    if (r.outer_exclusive_binder() > this.outer_index) {
      return ControlFlow.Break(FoundEscapingVars);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:587 visit_const
  visit_const(ct: Const): ControlFlow<FoundEscapingVars> {
    // If the outer-exclusive-binder is *strictly greater* than
    // `outer_index`, that means that `ct` contains some content
    // bound at `outer_index` or above (because
    // `outer_exclusive_binder` is always 1 higher than the
    // content in `ct`). Therefore, `ct` has some escaping vars.
    if (ct.outer_exclusive_binder() > this.outer_index) {
      return ControlFlow.Break(FoundEscapingVars);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:601 visit_predicate
  visit_predicate<P>(predicate: P, d: PredicateProxy<P>): ControlFlow<FoundEscapingVars> {
    if (d.flags.outer_exclusive_binder(predicate) > this.outer_index) {
      return ControlFlow.Break(FoundEscapingVars);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:610 visit_clauses
  visit_clauses(clauses: Clauses): ControlFlow<FoundEscapingVars> {
    if (clauses.outer_exclusive_binder() > this.outer_index) {
      return ControlFlow.Break(FoundEscapingVars);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<FoundEscapingVars> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_type_ir/src/visit.rs:619 HasErrorVisitor
class HasErrorVisitor implements TypeVisitor<ControlFlow<ErrorGuaranteed>> {
  readonly Result: VisitorResult<ControlFlow<ErrorGuaranteed>, unknown> = VisitorResultC.ControlFlow<ErrorGuaranteed>();

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_ty(t: Ty): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_ty(this, t);
  }

  visit_region(r: Region): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  visit_const(c: Const): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<ErrorGuaranteed> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  // rustc: compiler/rustc_type_ir/src/visit.rs:624 visit_error
  visit_error(guar: ErrorGuaranteed): ControlFlow<ErrorGuaranteed> {
    return ControlFlow.Break(guar);
  }
}
