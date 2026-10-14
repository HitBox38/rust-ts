// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs (STUB, lane hir-ty-lowering-c):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { HirTyLowerer } from "../decls.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";

// hir_ty_lowering/dyn_trait.rs:1098 (stub; final signature: decls.ts `Fns_hir_ty_lowering_dyn_trait`)
export function replace_dummy_self_with_error<T>(_tcx: TyCtxt, _t: T, _guar: ErrorGuaranteed, _d_T: TypeFoldable<T>): T {
  return unported("rustc_hir_analysis::hir_ty_lowering::dyn_trait::replace_dummy_self_with_error");
}

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::dyn_trait::HirTyLowerer", [
  "lower_trait_object_ty", "lower_trait_object_lifetime", "check_elaborated_projection_mentions_input_lifetimes",
  "compute_object_lifetime_bound", "prohibit_or_lint_bare_trait_object_ty", "maybe_suggest_add_generic_impl_trait",
  "maybe_suggest_blanket_trait_impl", "maybe_suggest_dyn_trait", "add_generic_param_suggestion",
  "maybe_suggest_impl_trait", "maybe_suggest_assoc_ty_bound", "maybe_suggest_typoed_method",
]);
