// Port of compiler/rustc_type_ir/src/ty_info.rs (lane tyir-misc, sub-lane lib-sty). The type with its derived Debug is
// generated into ty_info.gen.ts (set rustc_ty of tools/codegen/types.ts); this file holds the manual trait impls.
// PORT: the trait impls over `T` take `T`'s impl fn last (PORTING §5 "pass function tables"): `eq_T`, `cmp_T`, `hash_T`.
// The interned classes (`Ty`, `Const`, `Predicate`) embed this struct's fields (ty-contract "Representation" 1), so
// these fns serve code that handles a `WithCachedTypeInfo` value directly.
import type { Ordering } from "../rustc_data_structures/stable_hash.ts";
import type { WithCachedTypeInfo } from "./ty_info.gen.ts";

export * from "./ty_info.gen.ts";

// rustc: compiler/rustc_type_ir/src/ty_info.rs:50 eq
export function WithCachedTypeInfo_eq<T>(self: WithCachedTypeInfo<T>, other: WithCachedTypeInfo<T>, eq_T: (a: T, b: T) => boolean): boolean {
  return eq_T(self.internee, other.internee);
}

// rustc: compiler/rustc_type_ir/src/ty_info.rs:58 partial_cmp
export function WithCachedTypeInfo_partial_cmp<T>(self: WithCachedTypeInfo<T>, other: WithCachedTypeInfo<T>, cmp_T: (a: T, b: T) => Ordering): Ordering | undefined {
  return cmp_T(self.internee, other.internee);
}

// rustc: compiler/rustc_type_ir/src/ty_info.rs:64 cmp
export function WithCachedTypeInfo_cmp<T>(self: WithCachedTypeInfo<T>, other: WithCachedTypeInfo<T>, cmp_T: (a: T, b: T) => Ordering): Ordering {
  return cmp_T(self.internee, other.internee);
}

// rustc: compiler/rustc_type_ir/src/ty_info.rs:73 deref
export function WithCachedTypeInfo_deref<T>(self: WithCachedTypeInfo<T>): T {
  return self.internee;
}

// rustc: compiler/rustc_type_ir/src/ty_info.rs:80 hash
export function hash_WithCachedTypeInfo<T, H>(self: WithCachedTypeInfo<T>, s: H, hash_T: (v: T, s: H) => void): void {
  hash_T(self.internee, s);
}

// rustc-skip: compiler/rustc_type_ir/src/ty_info.rs:87 stable_hash StableHash impl (incremental, M5)
