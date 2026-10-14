// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs (STUB, lane hir-ty-lowering-d):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { HirTyLowerer } from "../decls.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { AssocTag } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";

export * from "./errors.gen.ts";

// rustc-type: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1794 GenericsArgsErrExtend
// PORT: hand-written (types.sets.json `hand`): its variants name both `hir::Ty` and `ty::Ty`, which the generator would import
// under the same TS name. No derives.
/// Used for generics args error extend.
export type GenericsArgsErrExtend =
  | { readonly $: "EnumVariant"; qself: hir.Ty; assoc_segment: hir.PathSegment; adt_def: AdtDef }
  | { readonly $: "OpaqueTy" }
  | { readonly $: "PrimTy"; _0: hir.PrimTy }
  | { readonly $: "SelfTyAlias"; def_id: DefId; span: Span }
  | { readonly $: "SelfTyParam"; _0: Span }
  | { readonly $: "Param"; _0: DefId }
  | { readonly $: "DefVariant"; _0: readonly hir.PathSegment[] }
  | { readonly $: "None" };
/** Unit variants of `GenericsArgsErrExtend`, shared frozen singletons. */
export const GenericsArgsErrExtend = {
  OpaqueTy: Object.freeze({ $: "OpaqueTy" as const }),
  None: Object.freeze({ $: "None" as const }),
};

// errors.rs:2031 `impl Diagnostic for AmbiguityBetweenVariantAndAssocItem` (manual): `AmbiguityBetweenVariantAndAssocItem_into_diag`
// + `_diagnostic`, lane hir-ty-lowering-d.

// hir_ty_lowering/errors.rs:1566 (stub; final signature: decls.ts `Fns_hir_ty_lowering_errors`)
export function prohibit_assoc_item_constraint(_cx: HirTyLowerer, _constraint: hir.AssocItemConstraint, _segment: [DefId, hir.PathSegment, Span] | undefined): ErrorGuaranteed {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::prohibit_assoc_item_constraint");
}

// hir_ty_lowering/errors.rs:1744 (stub; final signature: decls.ts `Fns_hir_ty_lowering_errors`)
export function fn_trait_to_string(_tcx: TyCtxt, _trait_segment: hir.PathSegment, _parenthesized: boolean): string {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::fn_trait_to_string");
}

// hir_ty_lowering/errors.rs:1812 (stub; final signature: decls.ts `Fns_hir_ty_lowering_errors`)
export function generics_args_err_extend(_tcx: TyCtxt, _segments: Iterable<hir.PathSegment>, _err: Diag, _err_extend: GenericsArgsErrExtend): void {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::generics_args_err_extend");
}

// hir_ty_lowering/errors.rs:2071 (stub; final signature: decls.ts `Fns_hir_ty_lowering_errors`)
export function assoc_tag_str(_assoc_tag: AssocTag): string {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::assoc_tag_str");
}

// hir_ty_lowering/errors.rs:2083 (stub; final signature: decls.ts `Fns_hir_ty_lowering_errors`)
export function eq_ctxt_suggestion_span(_pat: Span, _ty: Span): Span | undefined {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::eq_ctxt_suggestion_span");
}

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::errors::HirTyLowerer", [
  "report_missing_generic_params", "report_internal_fn_trait", "report_unresolved_assoc_item",
  "report_assoc_kind_mismatch", "report_ambiguous_assoc_item", "report_missing_self_ty_for_resolved_path",
  "report_unresolved_type_relative_path", "report_ambiguous_assoc_item_path", "report_ambiguous_inherent_assoc_item",
  "note_ambiguous_inherent_assoc_item", "report_unresolved_inherent_assoc_item", "check_for_required_assoc_items",
  "maybe_report_similar_assoc_fn", "report_prohibited_generic_args", "report_trait_object_addition_traits",
  "report_trait_object_with_no_traits",
]);
