// Port of compiler/rustc_type_ir/src/upcast.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT (D4 style): the traits over the *value* type are descriptors over `T` (as `TypeFoldable<T>`, fold.ts header):
// `Upcast<T, U>` / `UpcastFrom<T, Self>` are interfaces of fns taking the value first. A concrete
// `impl UpcastFrom<I, X> for Y` is `Y.upcast_from_X(from, interner)` (convention: tyir-misc lane brief). The blanket
// `impl<T, U: UpcastFrom<I, T>> Upcast<I, U> for T` is the free fn `upcast(self, interner, upcast_from_U)`, the reflexive
// `impl<T> UpcastFrom<I, T> for T` the free fn `upcast_from_self`. `I` is erased (D3).
import type { Interner } from "./interner.ts";

/// An `Into`-like trait that takes `TyCtxt` to perform interner-specific transformations.
// rustc-trait: compiler/rustc_type_ir/src/upcast.rs:2 Upcast
export interface Upcast<T, U> {
  // rustc: compiler/rustc_type_ir/src/upcast.rs:3 upcast
  upcast(self: T, interner: Interner): U;
}

// PORT: `U: UpcastFrom<I, T>` is the impl fn `upcast_from_U` (`U::upcast_from`).
// rustc: compiler/rustc_type_ir/src/upcast.rs:10 upcast
export function upcast<T, U>(self: T, interner: Interner, upcast_from_U: (from: T, interner: Interner) => U): U {
  return upcast_from_U(self, interner);
}

/// A `From`-like trait that takes `TyCtxt` to perform interner-specific transformations.
// rustc-trait: compiler/rustc_type_ir/src/upcast.rs:16 UpcastFrom
export interface UpcastFrom<T, Self> {
  // rustc: compiler/rustc_type_ir/src/upcast.rs:17 upcast_from
  upcast_from(from: T, interner: Interner): Self;
}

// rustc: compiler/rustc_type_ir/src/upcast.rs:21 upcast_from
export function upcast_from_self<T>(from: T, _tcx: Interner): T {
  return from;
}
