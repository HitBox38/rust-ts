// Contract stub for compiler/rustc_type_ir/src/visit.rs (lane ty-contract; the rest is lane tyir-binder's).
//
// PORT (docs/plan-m3.md D4; see fold.ts): `TypeVisitable<T>` / `TypeSuperVisitable<T>` are descriptors (one
// object per Rust impl, `visit_<T>` or part of `fold_<T>`); `TypeVisitor<R>` stays a trait, implemented by the
// visitor classes. `V::Result` is the type parameter `R`, and the visitor carries its `VisitorResult` impl
// object in its `Result` property, as rustc_ast's `Visitor` does (rustc_ast_ir/visit.ts):
// `Self::Result::output()` is `this.Result.output()`. Provided methods live in `TypeVisitor_provided`.
// `Flags` is a descriptor too (`Flags<T>`); the interned classes also have `flags()` /
// `outer_exclusive_binder()` methods. `TypeVisitableExt` and the container impls are lane tyir-binder's.
import type { Clauses } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { Binder, DebruijnIndex, TypeFlags } from "./decls.ts";
import type { PredicateProxy } from "./fold.ts";
import type { Const, Region } from "./sty/mod.ts";

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

/** PORT: the provided methods of `TypeVisitor` (PORTING §8), filled by lane tyir-binder. */
export const TypeVisitor_provided = {
  visit_binder<T, R>(_self: TypeVisitor<R>, _t: Binder<T>, _d: TypeVisitable<T>): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_binder (provided)");
  },
  visit_ty<R>(_self: TypeVisitor<R>, _t: Ty): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_ty (provided)");
  },
  visit_region<R>(_self: TypeVisitor<R>, _r: Region): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_region (provided)");
  },
  visit_const<R>(_self: TypeVisitor<R>, _c: Const): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_const (provided)");
  },
  visit_predicate<P, R>(_self: TypeVisitor<R>, _p: P, _d: PredicateProxy<P>): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_predicate (provided)");
  },
  visit_clauses<R>(_self: TypeVisitor<R>, _c: Clauses): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_clauses (provided)");
  },
  visit_error<R>(_self: TypeVisitor<R>, _guar: ErrorGuaranteed): R {
    return unported("rustc_type_ir::visit::TypeVisitor::visit_error (provided)");
  },
};

// PORT (D4): `pub trait Flags` as a descriptor over `T` (the interned classes also carry the two methods).
// rustc-trait: compiler/rustc_type_ir/src/visit.rs:241 Flags
export interface Flags<T> {
  // rustc: compiler/rustc_type_ir/src/visit.rs:242 flags
  flags(self: T): TypeFlags;
  // rustc: compiler/rustc_type_ir/src/visit.rs:243 outer_exclusive_binder
  outer_exclusive_binder(self: T): DebruijnIndex;
}

// ---- the container impls (visit.rs:136-240; lane tyir-binder) ----
// PORT (merge-w13): the impl fn shape of tools/codegen (type_fold.json): `<T as TypeVisitable>::visit_with` as a value
// is `VisitWith<T>`, the `visit_with` of `T`'s D4 descriptor; a generic impl takes its type arguments' impl fns after
// the visitor. Stubs moved from codegen-tyir's src/rust_ts/tyir_contract.ts.
export type VisitWith<T> = TypeVisitable<T>["visit_with"];

/** Stub: `impl TypeVisitable for (T, U)` (visit.rs:136). */
export function visit_with_tuple2<T, U, R>(_self: [T, U], _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>, _visit_with_U: VisitWith<U>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for (T, U)");
}
/** Stub: `impl TypeVisitable for (A, B, C)` (visit.rs:143). */
export function visit_with_tuple3<A, B, C, R>(_self: [A, B, C], _visitor: TypeVisitor<R>, _a: VisitWith<A>, _b: VisitWith<B>, _c: VisitWith<C>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for (A, B, C)");
}
/** Stub: `impl TypeVisitable for Option<T>` (visit.rs:153). */
export function visit_with_Option<T, R>(_self: T | undefined, _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for Option<T>");
}
/** Stub: `impl TypeVisitable for Result<T, E>` (visit.rs:162). */
export function visit_with_Result<T, U, R>(_self: Result<T, U>, _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>, _visit_with_U: VisitWith<U>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for Result<T, E>");
}
/** Stub: `impl TypeVisitable for Vec<T>` (visit.rs:189; also `ThinVec` :196, `SmallVec` :203, `IndexVec` :227). */
export function visit_with_Vec<T, R>(_self: readonly T[], _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for Vec<T>");
}
/** Stub: `impl TypeVisitable for [T]` (visit.rs:213; also `[T; N]` :220). */
export function visit_with_slice<T, R>(_self: readonly T[], _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for [T]");
}
/** Stub: `impl TypeVisitable for IndexSet<T>` (visit.rs:234). */
export function visit_with_IndexSet<T, R>(_self: Set<T>, _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>): R {
  return unported("rustc_type_ir::visit: TypeVisitable for IndexSet<T>");
}
