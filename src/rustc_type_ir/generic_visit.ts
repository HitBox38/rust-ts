// Port of compiler/rustc_type_ir/src/generic_visit.rs (lane tyir-binder).
//
//! Special visiting used by rust-analyzer only.
//!
//! It is different from `TypeVisitable` in two ways:
//!
//!  - The visitor is a generic of the trait and not the method, allowing types to attach
//!    special behavior to visitors (as long as they know it; we don't use this capability
//!    in rustc crates, but rust-analyzer needs it).
//!  - It **must visit** every field. This is why we don't have an attribute like `#[type_visitable(ignore)]`
//!    for this visit. The reason for this is soundness: rust-analyzer uses this visit to
//!    garbage collect types, so a missing field can mean a use after free
//
// PORT (D4): the trait is a descriptor over the value type (`GenericTypeVisitable<T, V>`); the impls below are free
// fns in tools/codegen's shape (`generic_visit_with_<C>(self, visitor, <impl fns of the type arguments>)`).
// `#[derive(GenericTypeVisitable)]` generates nothing (codegen-tyir decision 5: rust-analyzer only), so nothing in
// rustc reaches these; they are ported for completeness.
import type { Result } from "../std/result.ts";
import type { FnSigKind } from "./ty_kind.ts";

/// This trait is implemented for every type that can be visited,
/// providing the skeleton of the traversal.
///
/// ## Safety
///
/// A manual implementation **must visit** every field.
///
/// Therefore, it is advised to instead derive this using the derive
/// macro located in `rustc_macros`.
// rustc-trait: compiler/rustc_type_ir/src/generic_visit.rs:30 GenericTypeVisitable
export interface GenericTypeVisitable<T, V> {
  // rustc: compiler/rustc_type_ir/src/generic_visit.rs:31 generic_visit_with
  generic_visit_with(self: T, visitor: V): void;
}

/** PORT: `<T as GenericTypeVisitable<V>>::generic_visit_with` as a value. */
export type GenericVisitWith<T, V> = GenericTypeVisitable<T, V>["generic_visit_with"];

///////////////////////////////////////////////////////////////////////////
// Traversal implementations.

/** `unsafe impl GenericTypeVisitable<V> for &T` (PORT: `&T` is `T`) */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:38 generic_visit_with
export function generic_visit_with_Ref<T, V>(self: T, visitor: V, g_T: GenericVisitWith<T, V>): void {
  g_T(self, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for (T, U)` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:46 generic_visit_with
export function generic_visit_with_tuple2<T, U, V>(self: readonly [T, U], visitor: V, g_T: GenericVisitWith<T, V>, g_U: GenericVisitWith<U, V>): void {
  g_T(self[0], visitor);
  g_U(self[1], visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for (A, B, C)` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:55 generic_visit_with
export function generic_visit_with_tuple3<A, B, C, V>(self: readonly [A, B, C], visitor: V, g_A: GenericVisitWith<A, V>, g_B: GenericVisitWith<B, V>, g_C: GenericVisitWith<C, V>): void {
  g_A(self[0], visitor);
  g_B(self[1], visitor);
  g_C(self[2], visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for Option<T>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:63 generic_visit_with
export function generic_visit_with_Option<T, V>(self: T | undefined, visitor: V, g_T: GenericVisitWith<T, V>): void {
  if (self !== undefined) {
    const v = self;
    g_T(v, visitor);
  }
}

/** `unsafe impl GenericTypeVisitable<V> for Result<T, E>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:74 generic_visit_with
export function generic_visit_with_Result<T, E, V>(self: Result<T, E>, visitor: V, g_T: GenericVisitWith<T, V>, g_E: GenericVisitWith<E, V>): void {
  switch (self.$) {
    case "Ok":
      g_T(self._0, visitor);
      break;
    case "Err":
      g_E(self._0, visitor);
      break;
  }
}

/** `unsafe impl GenericTypeVisitable<V> for Arc<T>` (PORT: the `Arc` is its `T`) */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:83 generic_visit_with
export function generic_visit_with_Arc<T, V>(self: T, visitor: V, g_T: GenericVisitWith<T, V>): void {
  g_T(self, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for Box<T>` (PORT: the `Box` is its `T`) */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:89 generic_visit_with
export function generic_visit_with_Box<T, V>(self: T, visitor: V, g_T: GenericVisitWith<T, V>): void {
  g_T(self, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for Vec<T>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:95 generic_visit_with
export function generic_visit_with_Vec<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for ThinVec<T>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:101 generic_visit_with
export function generic_visit_with_ThinVec<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for SmallVec<[T; N]>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:109 generic_visit_with
export function generic_visit_with_SmallVec<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for [T]` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:115 generic_visit_with
export function generic_visit_with_slice<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for [T; N]` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:121 generic_visit_with
export function generic_visit_with_array<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for IndexVec<Ix, T>` (PORTING §5: `T[]`) */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:127 generic_visit_with
export function generic_visit_with_IndexVec<T, V>(self: readonly T[], visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
}

/** `unsafe impl GenericTypeVisitable<V> for std::hash::BuildHasherDefault<S>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:133 generic_visit_with
export function generic_visit_with_BuildHasherDefault<V>(_self: unknown, _visitor: V): void {}

// PORT: a JS `Map` / `Set` carries no hasher value; the `S` of every rustc map is a `BuildHasherDefault` (whose impl
// visits nothing), so `self.hasher().generic_visit_with(visitor)` is `generic_visit_with_BuildHasherDefault`.

/** `unsafe impl GenericTypeVisitable<Visitor> for std::collections::HashMap<Key, Value, S>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:144 generic_visit_with
export function generic_visit_with_HashMap<K, Val, V>(self: ReadonlyMap<K, Val>, visitor: V, g_K: GenericVisitWith<K, V>, g_Val: GenericVisitWith<Val, V>): void {
  self.forEach((value, key) => generic_visit_with_tuple2<K, Val, V>([key, value], visitor, g_K, g_Val));
  generic_visit_with_BuildHasherDefault(undefined, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for std::collections::HashSet<T, S>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:154 generic_visit_with
export function generic_visit_with_HashSet<T, V>(self: ReadonlySet<T>, visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
  generic_visit_with_BuildHasherDefault(undefined, visitor);
}

/** `unsafe impl GenericTypeVisitable<Visitor> for indexmap::IndexMap<Key, Value, S>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:167 generic_visit_with
export function generic_visit_with_IndexMap<K, Val, V>(self: ReadonlyMap<K, Val>, visitor: V, g_K: GenericVisitWith<K, V>, g_Val: GenericVisitWith<Val, V>): void {
  self.forEach((value, key) => generic_visit_with_tuple2<K, Val, V>([key, value], visitor, g_K, g_Val));
  generic_visit_with_BuildHasherDefault(undefined, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for indexmap::IndexSet<T, S>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:176 generic_visit_with
export function generic_visit_with_IndexSet<T, V>(self: ReadonlySet<T>, visitor: V, g_T: GenericVisitWith<T, V>): void {
  self.forEach((it) => g_T(it, visitor));
  generic_visit_with_BuildHasherDefault(undefined, visitor);
}

/** `unsafe impl GenericTypeVisitable<V> for std::marker::PhantomData<T>` (PORTING §5: erased, `undefined`) */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:183 generic_visit_with
export function generic_visit_with_PhantomData<V>(_self: undefined, _visitor: V): void {}

// SAFETY: `FnSigKind` is a packed representation, therefore visiting its fields doesn't make sense
/** `unsafe impl GenericTypeVisitable<V> for crate::FnSigKind<I>` */
// rustc: compiler/rustc_type_ir/src/generic_visit.rs:188 generic_visit_with
export function generic_visit_with_FnSigKind<V>(_self: FnSigKind, _visitor: V): void {}
