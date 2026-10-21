// Port of compiler/rustc_ty_utils/src/layout/invariant.rs (lane layout-contract: a `// stub:` declaration of every fn
// for lane ty-utils-layout, docs/handoff/layout-contract.md "How to fill a stub"). The three nested fns of
// `layout_sanity_check` are module-level stubs until the fill lane ports them inside it (they follow its
// `if !cfg!(debug_assertions) { return; }`, which is always taken: rustc ships without debug assertions).
import type { Size } from "../../rustc_abi/lib.ts";
import type { LayoutCx, TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { unported } from "../../std/panic.ts";

/// Enforce some basic invariants on layouts.
// stub: compiler/rustc_ty_utils/src/layout/invariant.rs:10 layout_sanity_check (lane ty-utils-layout)
export function layout_sanity_check(_cx: LayoutCx, _layout: TyAndLayout): void {
  return unported("rustc_ty_utils::layout::invariant::layout_sanity_check");
}

/// Yields non-ZST fields of the type
// (nested in `layout_sanity_check`)
// PORT (layout-contract): `impl Iterator<Item = (Size, TyAndLayout)>` is an array.
// stub: compiler/rustc_ty_utils/src/layout/invariant.rs:50 non_zst_fields (lane ty-utils-layout)
export function non_zst_fields(_cx: LayoutCx, _layout: TyAndLayout): [Size, TyAndLayout][] {
  return unported("rustc_ty_utils::layout::invariant::layout_sanity_check::non_zst_fields");
}

// (nested in `layout_sanity_check`)
// stub: compiler/rustc_ty_utils/src/layout/invariant.rs:65 skip_newtypes (lane ty-utils-layout)
export function skip_newtypes(_cx: LayoutCx, _layout: TyAndLayout): TyAndLayout {
  return unported("rustc_ty_utils::layout::invariant::layout_sanity_check::skip_newtypes");
}

// (nested in `layout_sanity_check`)
// stub: compiler/rustc_ty_utils/src/layout/invariant.rs:96 check_layout_abi (lane ty-utils-layout)
export function check_layout_abi(_cx: LayoutCx, _layout: TyAndLayout): void {
  return unported("rustc_ty_utils::layout::invariant::layout_sanity_check::check_layout_abi");
}
