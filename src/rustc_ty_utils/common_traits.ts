// Port of compiler/rustc_ty_utils/src/common_traits.rs (lane small-gaps-19).
//! Queries for checking whether a type implements one of a few common traits.
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { PseudoCanonicalInput, Ty } from "../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import "../rustc_infer/lib.ts";
import "../rustc_trait_selection/lib.ts";
import { type_known_to_meet_bound_modulo_regions } from "../rustc_trait_selection/traits/mod.ts";

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:10 is_copy_raw
function is_copy_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "Copy");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:14 is_use_cloned_raw
function is_use_cloned_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "UseCloned");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:21 is_sized_raw
function is_sized_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "Sized");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:25 is_freeze_raw
function is_freeze_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "Freeze");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:29 is_unsafe_unpin_raw
function is_unsafe_unpin_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "UnsafeUnpin");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:36 is_unpin_raw
function is_unpin_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "Unpin");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:40 is_async_drop_raw
function is_async_drop_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  return is_trait_raw(tcx, query, "AsyncDrop");
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:47 is_trait_raw
function is_trait_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>, item: LangItem): boolean {
  const [infcx, param_env] = tcx.infer_ctxt().ignoring_regions().build_with_typing_env(query.typing_env);
  const trait_def_id = tcx.require_lang_item(item, DUMMY_SP);
  return type_known_to_meet_bound_modulo_regions(infcx, param_env, query.value, trait_def_id);
}

// rustc: compiler/rustc_ty_utils/src/common_traits.rs:58 provide
export function provide(providers: Providers): void {
  providers.is_copy_raw = is_copy_raw;
  providers.is_use_cloned_raw = is_use_cloned_raw;
  providers.is_sized_raw = is_sized_raw;
  providers.is_freeze_raw = is_freeze_raw;
  providers.is_unsafe_unpin_raw = is_unsafe_unpin_raw;
  providers.is_unpin_raw = is_unpin_raw;
  providers.is_async_drop_raw = is_async_drop_raw;
}
