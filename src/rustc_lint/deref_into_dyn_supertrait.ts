// Port of compiler/rustc_lint/src/deref_into_dyn_supertrait.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (deref_into_dyn_supertrait.lints.gen.ts).
//
// PORT: context.ts types `LateContext::get_associated_type` as returning `unknown`; the result is cast to
// `Ty | undefined`. `T: TypeFoldable` arguments take their descriptor (`erase_and_anonymize_regions(value, d)`);
// the `TraitRef` / `ExistentialTraitRef` descriptors are local consts (as traits/vtable.ts).
import type * as hir from "../rustc_hir/hir.ts";
import { AssocItems } from "../rustc_middle/ty/assoc.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Ident, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { supertraits } from "../rustc_type_ir/elaborate.ts";
import { type TypeFoldable, fold_tuple3 } from "../rustc_type_ir/fold.ts";
import {
  ExistentialTraitRef,
  PolyExistentialTraitRef,
  PolyTraitRef,
  type TraitRef,
  as_interner,
  fold_with_ExistentialTraitRef,
  fold_with_TraitRef,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_TraitRef,
  visit_with_ExistentialTraitRef,
  visit_with_TraitRef,
} from "../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { DefId_eq } from "../rustc_span/def_id.ts";
import type { LateContext } from "./context.ts";
import { DEREF_INTO_DYN_SUPERTRAIT, DerefIntoDynSupertrait } from "./deref_into_dyn_supertrait.lints.gen.ts";
import { SupertraitAsDerefTarget_diagnostic } from "./diagnostics.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./deref_into_dyn_supertrait.lints.gen.ts";

declare module "./deref_into_dyn_supertrait.lints.gen.ts" {
  interface DerefIntoDynSupertrait extends LateLintPass {}
}

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

// impl<'tcx> LateLintPass<'tcx> for DerefIntoDynSupertrait
// rustc: compiler/rustc_lint/src/deref_into_dyn_supertrait.rs:60 check_item
DerefIntoDynSupertrait.prototype.check_item = function (this: DerefIntoDynSupertrait, cx: LateContext, item: hir.Item): void {
  const tcx = cx.tcx;
  // `Deref` is being implemented for `t`
  if (item.kind.$ !== "Impl") return;
  const impl_ = item.kind._0;
  // the trait is a `Deref` implementation
  const of_trait = impl_.of_trait;
  if (of_trait === undefined) return;
  const did = of_trait.trait_ref.trait_def_id();
  if (did === undefined) return;
  if (!tcx.is_lang_item(did, "Deref")) return;
  // the self type is `dyn t_principal`
  const self_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item.owner_id.to_def_id()) as EarlyBinder<Ty>));
  const self_kind = self_ty_.kind();
  if (self_kind.$ !== "Dynamic") return;
  const self_principal = self_kind._0.principal();
  if (self_principal === undefined) return;
  // `<T as Deref>::Target` is `dyn target_principal`
  const target = cx.get_associated_type(self_ty_, did, sym.Target) as Ty | undefined;
  if (target === undefined) return;
  const target_kind = target.kind();
  if (target_kind.$ !== "Dynamic") return;
  const target_principal_ = target_kind._0.principal();
  if (target_principal_ === undefined) return;
  // `target_principal` is a supertrait of `t_principal`
  const it = supertraits(tcx, PolyExistentialTraitRef.with_self_ty(self_principal, as_interner(tcx), self_ty_));
  let supertrait_principal_: Binder<TraitRef> | undefined;
  for (let supertrait = it.next(); supertrait !== undefined; supertrait = it.next()) {
    if (DefId_eq(PolyTraitRef.def_id(supertrait), PolyExistentialTraitRef.def_id(target_principal_))) {
      supertrait_principal_ = supertrait;
      break;
    }
  }
  if (supertrait_principal_ === undefined) return;

  // erase regions in self type for better diagnostic presentation
  const [self_ty, target_principal, supertrait_principal] = tcx.erase_and_anonymize_regions(
    [self_ty_, target_principal_, supertrait_principal_],
    fold_tuple3(fold_Ty, fold_Binder(d_ExistentialTraitRef), fold_Binder(d_TraitRef)),
  );
  const label_ = AssocItems.find_by_ident_and_kind(
    tcx.associated_items(item.owner_id.to_def_id()) as AssocItems,
    tcx,
    Ident.with_dummy_span(sym.Target),
    "Type",
    item.owner_id.to_def_id(),
  );
  const label2 =
    label_ !== undefined
      ? {
          label: tcx.def_span(label_.def_id),
          self_ty,
        }
      : undefined;
  const span = tcx.def_span(item.owner_id.to_def_id());
  cx.emit_span_lint(
    DEREF_INTO_DYN_SUPERTRAIT,
    span,
    SupertraitAsDerefTarget_diagnostic({
      self_ty,
      supertrait_principal: Binder.map_bound(supertrait_principal, (trait_ref) => ExistentialTraitRef.erase_self_ty(as_interner(tcx), trait_ref)),
      target_principal,
      label: span,
      label2,
    }),
  );
};
