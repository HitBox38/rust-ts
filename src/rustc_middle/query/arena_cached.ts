// Port of compiler/rustc_middle/src/query/arena_cached.rs.
//
// PORT: arenas are erased (PORTING §5: `&'tcx T` is `T`), so allocating a provided value "in the arena"
// returns it unchanged: `T`, `Option<T>` and `Result<T, ErrorGuaranteed>` are already the query's value.
import type { TyCtxt } from "../ty/context.ts";

/// Helper trait that allows `arena_cache` queries to return:
/// - `Option<&T>` instead of `&Option<T>`, and avoid allocating `None` in the arena; or
/// - `Result<&T, ErrorGuaranteed>` instead of `&Result<T, ErrorGuaranteed>`, and avoid allocating
///   `Err(ErrorGuaranteed)` in the arena.
///
/// An arena-cached query must be declared to return a type that implements this trait, i.e.
/// `&'tcx T`, `Option<&'tcx T>`, or `Result<&'tcx T, ErrorGuaranteed>`. This trait then determines
/// the types returned by the provider and stored in the arena, and provides a function to bridge
/// between the three types.
export const ArenaCached = {
  /// Takes a provided value, and allocates it in an appropriate arena,
  /// unless the particular value doesn't need allocation (e.g. `None`).
  // rustc: compiler/rustc_middle/src/query/arena_cached.rs:25 alloc_in_arena
  alloc_in_arena<V>(tcx: TyCtxt, value: V): V {
    return do_alloc(tcx, value);
  },
};

// rustc: compiler/rustc_middle/src/query/arena_cached.rs:36 alloc_in_arena
export function alloc_in_arena_ref<T>(tcx: TyCtxt, value: T): T {
  // Just allocate in the arena normally.
  return do_alloc(tcx, value);
}

// rustc: compiler/rustc_middle/src/query/arena_cached.rs:47 alloc_in_arena
export function alloc_in_arena_option<T>(tcx: TyCtxt, value: T | undefined): T | undefined {
  // Don't store None in the arena, and wrap the allocated reference in Some.
  return value === undefined ? undefined : do_alloc(tcx, value);
}

// rustc: compiler/rustc_middle/src/query/arena_cached.rs:62 alloc_in_arena
export function alloc_in_arena_result<T, E>(tcx: TyCtxt, value: { $: "Ok"; _0: T } | { $: "Err"; _0: E }): { $: "Ok"; _0: T } | { $: "Err"; _0: E } {
  // Don't store Err(ErrorGuaranteed) in the arena, and wrap the allocated reference in Ok.
  return value.$ === "Ok" ? { $: "Ok", _0: do_alloc(tcx, value._0) } : value;
}

/// Allocates a value in either its dedicated arena, or in the common dropless
/// arena, depending on whether it needs to be dropped.
// rustc: compiler/rustc_middle/src/query/arena_cached.rs:74 do_alloc
function do_alloc<T>(_tcx: TyCtxt, value: T): T {
  // PORT: `typed_arena.alloc(value)` / `tcx.arena.dropless.alloc(value)`: the value itself.
  return value;
}
