// Port of compiler/rustc_middle/src/hir/nested_filter.rs (no fns: two `NestedFilter` impls).
// PORT: a `NestedFilter` impl is its consts object (rustc_hir/intravisit.ts); `type MaybeTyCtxt = TyCtxt<'tcx>` is
// erased (a visitor using these filters overrides `maybe_tcx()` to return the `TyCtxt` as a `HirTyCtxt`).
import type { NestedFilter } from "../../rustc_hir/intravisit.ts";

// rustc-type: compiler/rustc_middle/src/hir/nested_filter.rs:16 OnlyBodies
/// Do not visit nested item-like things, but visit nested things
/// that are inside of an item-like.
///
/// Notably, possible occurrences of bodies in non-item-like things
/// include: closures/coroutines, inline `const {}` blocks, and
/// constant arguments of types, e.g. in `let _: [(); /* HERE */];`.
///
/// **This is the most common choice.** A very common pattern is
/// to use `visit_all_item_likes_in_crate()` as an outer loop,
/// and to have the visitor that visits the contents of each item
/// using this setting.
export const OnlyBodies: NestedFilter = Object.freeze({
  INTER: false,
  INTRA: true,
});

// rustc-type: compiler/rustc_middle/src/hir/nested_filter.rs:28 All
/// Visits all nested things, including item-likes.
///
/// **This is an unusual choice.** It is used when you want to
/// process everything within their lexical context. Typically you
/// kick off the visit by doing `walk_krate()`.
export const All: NestedFilter = Object.freeze({
  INTER: true,
  INTRA: true,
});
