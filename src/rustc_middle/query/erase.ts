//! To improve compile times and code size for the compiler itself, query
//! values are "erased" in some contexts (e.g. inside in-memory cache types),
//! to reduce the number of generic instantiations created during codegen.
//!
//! See <https://github.com/rust-lang/rust/pull/151715> for some bootstrap-time
//! and performance benchmarks.
// Port of compiler/rustc_middle/src/query/erase.rs.
//
// PORT: erasure is a codegen-size optimisation with no observable behaviour; in TS `Erased<T>` is `T`
// and both conversions are identities. The `Erasable` impls (storage sizes) have no counterpart.

/** `pub type Erased<T: Erasable> = ErasedData<impl Copy>` */
export type Erased<T> = T;

/// Erases a value of type `T` into `Erased<T>`.
///
/// `Erased<T>` and `Erased<U>` are type-checked as distinct types, but codegen
/// can see whether they actually have the same storage type.
// rustc: compiler/rustc_middle/src/query/erase.rs:76 erase_val
export function erase_val<T>(value: T): Erased<T> {
  return value;
}

/// Restores an erased value to its real type.
///
/// This relies on the fact that `Erased<T>` and `Erased<U>` are type-checked
/// as distinct types, even if they use the same storage type.
// rustc: compiler/rustc_middle/src/query/erase.rs:104 restore_val
export function restore_val<T>(erased_value: Erased<T>): T {
  return erased_value;
}
