// Port of compiler/rustc_hir_analysis/src/collect.rs (STUB, lane collect-a):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
//! "Collection" is the process of determining the type and other external
//! details of each item in Rust. Collection is specifically concerned
//! with *inter-procedural* things -- for example, for a function
//! definition, collection will figure out the type and signature of the
//! function, but it will not visit the *body* of the function in any way,
//! nor examine type annotations on local variables (that's the job of
//! type *checking*).
//!
//! Collecting is ultimately defined by a bundle of queries that
//! inquire after various facts about the items in the crate (e.g.,
//! `type_of`, `generics_of`, `clauses_of`, etc). See the `provide` function
//! for the full set.
//!
//! At present, however, we do run collection across all items in the
//! crate as a kind of pass. This should eventually be factored away.
//
// Contract: `ItemCtxt` is declared in ./decls.ts; its inherent methods are assigned onto `ItemCtxt.prototype` here (and
// in collect/clauses_of.ts), its `impl HirTyLowerer` is the vtable object `HirTyLowerer_ItemCtxt` below. Until a method is
// ported, the `unported_methods(..)` calls install an `unported(..)` placeholder for it.
// Init order: top-level code here may touch only ./decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { ItemCtxt, type HirTyLowerer, type HirTyLowererImpl, type InferCtxt } from "./decls.ts";
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { AdtDef, AdtKind } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Const } from "../rustc_middle/ty/decls.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { ImplTraitHeader, ParamEnv, Ty, VariantDef, VariantDiscr } from "../rustc_middle/ty/mod.ts";
import type { TraitDef } from "../rustc_middle/ty/trait_def.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import type { AnonConstKind, Binder, BoundVariableKind, EarlyBinder, ImplPolarity, PolyFnSig, PolyTraitRef } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import * as clauses_of from "./collect/clauses_of.ts";
import * as generics_of from "./collect/generics_of.ts";
import * as item_bounds from "./collect/item_bounds.ts";
import * as resolve_bound_vars from "./collect/resolve_bound_vars.ts";
import * as type_of from "./collect/type_of.ts";
import { HirTyLowerer_provided } from "./hir_ty_lowering/mod.ts";

export * from "./collect.gen.ts";
export { ItemCtxt } from "./decls.ts";

// mod clauses_of;
// pub(crate) mod dump;
export * as dump from "./collect/dump.ts";
// mod generics_of;
// mod item_bounds;
// mod resolve_bound_vars;
// mod type_of;

// rustc: compiler/rustc_hir_analysis/src/collect.rs:65 provide
export function provide(providers: Providers): void {
  resolve_bound_vars.provide(providers);
  providers.type_of = type_of.type_of;
  providers.type_of_opaque = type_of.type_of_opaque;
  providers.type_of_opaque_hir_typeck = type_of.type_of_opaque_hir_typeck;
  providers.type_alias_is_checked = type_of.type_alias_is_checked;
  providers.item_bounds = item_bounds.item_bounds;
  providers.explicit_item_bounds = item_bounds.explicit_item_bounds;
  providers.item_self_bounds = item_bounds.item_self_bounds;
  providers.explicit_item_self_bounds = item_bounds.explicit_item_self_bounds;
  providers.item_non_self_bounds = item_bounds.item_non_self_bounds;
  providers.impl_super_outlives = item_bounds.impl_super_outlives;
  providers.generics_of = generics_of.generics_of;
  providers.clauses_of = clauses_of.clauses_of;
  providers.explicit_clauses_of = clauses_of.explicit_clauses_of;
  providers.explicit_super_clauses_of = clauses_of.explicit_super_clauses_of;
  providers.explicit_implied_clauses_of = clauses_of.explicit_implied_clauses_of;
  providers.explicit_supertraits_containing_assoc_item = clauses_of.explicit_supertraits_containing_assoc_item;
  providers.trait_explicit_clauses_and_bounds = clauses_of.trait_explicit_clauses_and_bounds;
  providers.const_conditions = clauses_of.const_conditions;
  providers.explicit_implied_const_bounds = clauses_of.explicit_implied_const_bounds;
  providers.type_param_clauses = clauses_of.type_param_clauses;
  providers.trait_def = trait_def;
  providers.adt_def = adt_def;
  providers.fn_sig = fn_sig;
  providers.impl_trait_header = impl_trait_header;
  providers.impl_is_fully_generic_for_reflection = impl_is_fully_generic_for_reflection;
  providers.coroutine_kind = coroutine_kind;
  providers.coroutine_for_closure = coroutine_for_closure;
  providers.opaque_ty_origin = opaque_ty_origin;
  providers.rendered_precise_capturing_args = rendered_precise_capturing_args;
  providers.const_param_default = const_param_default;
  providers.anon_const_kind = anon_const_kind;
  providers.const_of_item = const_of_item;
}

// collect.rs:144 `struct HirPlaceholderCollector` (+ `impl Visitor`, collect.rs:152): hand class extending rustc_hir
// intravisit's `Visitor` (types.sets.json `hand`). PORT: `unknown` until lane collect-a writes it.
export type HirPlaceholderCollector = unknown;

// collect.rs:161 (stub; final signature: decls.ts `Fns_collect`)
export function placeholder_type_error_diag(_cx: HirTyLowerer, _generics: hir.Generics | undefined, _placeholder_types: Span[], _additional_spans: Span[], _suggest: boolean, _hir_ty: hir.Ty | undefined, _kind: string): Diag {
  return unported("rustc_hir_analysis::collect::placeholder_type_error_diag");
}

// collect.rs:236 (stub; final signature: decls.ts `Fns_collect`)
export function bad_placeholder(_cx: HirTyLowerer, _spans: Span[], _kind: string): Diag {
  return unported("rustc_hir_analysis::collect::bad_placeholder");
}

// collect.rs:766 (stub; final signature: decls.ts `Fns_collect`)
export function get_new_lifetime_name(_tcx: TyCtxt, _poly_trait_ref: PolyTraitRef, _generics: hir.Generics): string {
  return unported("rustc_hir_analysis::collect::get_new_lifetime_name");
}

// collect.rs:796 (stub; final signature: decls.ts `Fns_collect`)
export function check_ctor(_tcx: TyCtxt, _def_id: LocalDefId): void {
  return unported("rustc_hir_analysis::collect::check_ctor");
}

// collect.rs:802 (stub; final signature: decls.ts `Fns_collect`)
export function check_enum_variant_types(_tcx: TyCtxt, _def_id: LocalDefId): void {
  return unported("rustc_hir_analysis::collect::check_enum_variant_types");
}

// collect.rs:980 (stub; final signature: decls.ts `Fns_collect`)
export function lower_variant(_tcx: TyCtxt, _variant_did: LocalDefId | undefined, _ident: Ident, _discr: VariantDiscr, _def: hir.VariantData, _adt_kind: AdtKind, _parent_did: LocalDefId): VariantDef {
  return unported("rustc_hir_analysis::collect::lower_variant");
}

// collect.rs:1028 (stub; final signature: decls.ts `Fns_collect`)
export function adt_def(_tcx: TyCtxt, _def_id: LocalDefId): AdtDef {
  return unported("rustc_hir_analysis::collect::adt_def");
}

// collect.rs:1088 (stub; final signature: decls.ts `Fns_collect`)
export function trait_def(_tcx: TyCtxt, _def_id: LocalDefId): TraitDef {
  return unported("rustc_hir_analysis::collect::trait_def");
}

// collect.rs:1168 (stub; final signature: decls.ts `Fns_collect`)
export function fn_sig(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<PolyFnSig> {
  return unported("rustc_hir_analysis::collect::fn_sig");
}

// collect.rs:1254 (stub; final signature: decls.ts `Fns_collect`)
export function lower_fn_sig_recovering_infer_ret_ty(_icx: ItemCtxt, _sig: hir.FnSig, _generics: hir.Generics, _def_id: LocalDefId): PolyFnSig {
  return unported("rustc_hir_analysis::collect::lower_fn_sig_recovering_infer_ret_ty");
}

// collect.rs:1275 (stub; final signature: decls.ts `Fns_collect`)
export function late_param_regions_to_bound<T>(_tcx: TyCtxt, _scope: DefId, _bound_vars: List<BoundVariableKind>, _value: T, _d_T: TypeFoldable<T>): Binder<T> {
  return unported("rustc_hir_analysis::collect::late_param_regions_to_bound");
}

// collect.rs:1338 (stub; final signature: decls.ts `Fns_collect`)
export function recover_infer_ret_ty(_icx: ItemCtxt, _infer_ret_ty: hir.Ty, _generics: hir.Generics, _def_id: LocalDefId): PolyFnSig {
  return unported("rustc_hir_analysis::collect::recover_infer_ret_ty");
}

// collect.rs:1429 (stub; final signature: decls.ts `Fns_collect`)
export function suggest_impl_trait(_infcx: InferCtxt, _param_env: ParamEnv, _ret_ty: Ty): string | undefined {
  return unported("rustc_hir_analysis::collect::suggest_impl_trait");
}

// collect.rs:1561 (stub; final signature: decls.ts `Fns_collect`)
export function impl_is_fully_generic_for_reflection(_tcx: TyCtxt, _def_id: LocalDefId): boolean {
  return unported("rustc_hir_analysis::collect::impl_is_fully_generic_for_reflection");
}

// collect.rs:1566 (stub; final signature: decls.ts `Fns_collect`)
export function impl_trait_header(_tcx: TyCtxt, _def_id: LocalDefId): ImplTraitHeader {
  return unported("rustc_hir_analysis::collect::impl_trait_header");
}

// collect.rs:1587 (stub; final signature: decls.ts `Fns_collect`)
export function check_impl_constness(_tcx: TyCtxt, _constness: hir.Constness, _hir_trait_ref: hir.TraitRef): void {
  return unported("rustc_hir_analysis::collect::check_impl_constness");
}

// collect.rs:1629 (stub; final signature: decls.ts `Fns_collect`)
export function polarity_of_impl(_of_trait: hir.TraitImplHeader): ImplPolarity {
  return unported("rustc_hir_analysis::collect::polarity_of_impl");
}

// collect.rs:1641 (stub; final signature: decls.ts `Fns_collect`)
export function early_bound_lifetimes_from_generics(_tcx: TyCtxt, _generics: hir.Generics): Iterable<hir.GenericParam> {
  return unported("rustc_hir_analysis::collect::early_bound_lifetimes_from_generics");
}

// collect.rs:1651 (stub; final signature: decls.ts `Fns_collect`)
export function compute_sig_of_foreign_fn_decl(_tcx: TyCtxt, _def_id: LocalDefId, _decl: hir.FnDecl, _abi: ExternAbi, _safety: hir.Safety): PolyFnSig {
  return unported("rustc_hir_analysis::collect::compute_sig_of_foreign_fn_decl");
}

// collect.rs:1687 (stub; final signature: decls.ts `Fns_collect`)
export function coroutine_kind(_tcx: TyCtxt, _def_id: LocalDefId): hir.CoroutineKind | undefined {
  return unported("rustc_hir_analysis::collect::coroutine_kind");
}

// collect.rs:1701 (stub; final signature: decls.ts `Fns_collect`)
export function coroutine_for_closure(_tcx: TyCtxt, _def_id: LocalDefId): DefId {
  return unported("rustc_hir_analysis::collect::coroutine_for_closure");
}

// collect.rs:1724 (stub; final signature: decls.ts `Fns_collect`)
export function opaque_ty_origin(_tcx: TyCtxt, _def_id: LocalDefId): hir.OpaqueTyOrigin<DefId> {
  return unported("rustc_hir_analysis::collect::opaque_ty_origin");
}

// collect.rs:1738 (stub; final signature: decls.ts `Fns_collect`)
export function rendered_precise_capturing_args(_tcx: TyCtxt, _def_id: LocalDefId): readonly hir.PreciseCapturingArgKind<Symbol, Symbol>[] | undefined {
  return unported("rustc_hir_analysis::collect::rendered_precise_capturing_args");
}

// collect.rs:1761 (stub; final signature: decls.ts `Fns_collect`)
export function const_param_default(_tcx: TyCtxt, _param_def_id: LocalDefId): EarlyBinder<Const> {
  return unported("rustc_hir_analysis::collect::const_param_default");
}

// collect.rs:1787 (stub; final signature: decls.ts `Fns_collect`)
export function anon_const_kind(_tcx: TyCtxt, _def: LocalDefId): AnonConstKind {
  return unported("rustc_hir_analysis::collect::anon_const_kind");
}

// collect.rs:1818 (stub; final signature: decls.ts `Fns_collect`)
export function const_of_item(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<Const> | undefined {
  return unported("rustc_hir_analysis::collect::const_of_item");
}

// ItemCtxt statics (collect.rs:248, :252, :265; stubs: final signatures are the `declare static`s in decls.ts)
ItemCtxt.new = function (_tcx, _item_def_id) {
  return unported("rustc_hir_analysis::collect::ItemCtxt::new");
};
ItemCtxt.new_internal = function (_tcx, _item_def_id, _delegation) {
  return unported("rustc_hir_analysis::collect::ItemCtxt::new_internal");
};
ItemCtxt.new_for_delegation = function (_tcx, _item_def_id) {
  return unported("rustc_hir_analysis::collect::ItemCtxt::new_for_delegation");
};

unported_methods(ItemCtxt.prototype, "rustc_hir_analysis::collect::ItemCtxt", [
  "lower_ty", "hir_id", "node", "check_tainted_by_errors", "report_placeholder_type_error", "lower_test_binder_body",
  "lower_test_binder_forall", "lower_test_binder_exists", "lower_test_binder_assumptions",
  "lower_test_binder_constraint",
]);

// The provided method `HirTyLowerer::lowerer` (hir_ty_lowering/mod.rs:239) for `ItemCtxt`: the trait object over this
// impl. Not a port of its own (the marker sits on `HirTyLowerer_provided.lowerer`).
ItemCtxt.prototype.lowerer = function (this: ItemCtxt): HirTyLowerer {
  return HirTyLowerer_provided.lowerer(this, HirTyLowerer_ItemCtxt);
};

/**
 * collect.rs:480 `impl<'tcx> HirTyLowerer<'tcx> for ItemCtxt<'tcx>`: the vtable of `ItemCtxt`'s trait objects. Lane collect-a
 * assigns each method (`HirTyLowerer_ItemCtxt.tcx = function (this: ItemCtxt): TyCtxt { .. }`, marker above it) and drops its
 * name from the list.
 */
export const HirTyLowerer_ItemCtxt = {} as HirTyLowererImpl<ItemCtxt>;
unported_methods(HirTyLowerer_ItemCtxt, "rustc_hir_analysis::collect::<ItemCtxt as HirTyLowerer>", [
  "tcx", "dcx", "item_def_id", "mod_id", "re_infer", "ty_infer", "ct_infer", "register_trait_ascription_bounds",
  "probe_ty_param_bounds", "select_inherent_assoc_candidates", "lower_assoc_item_path", "probe_adt", "record_ty",
  "infcx", "lower_fn_sig", "dyn_compatibility_violations",
]);
