// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/bounds.rs (STUB, lane hir-ty-lowering-c):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { HirTyLowerer } from "../decls.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { Binder } from "../../rustc_type_ir/decls.ts";
import type { CollectedBound, CollectedSizednessBounds } from "./bounds.gen.ts";
import type { ImpliedBoundsContext } from "./mod.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";

export * from "./bounds.gen.ts";

// bounds.rs:906 `struct GenericParamAndBoundVarCollector` (+ `impl TypeVisitor`, :916..:974): hand class (types.sets.json `hand`).
// PORT: `unknown` until lane hir-ty-lowering-c writes it.
export type GenericParamAndBoundVarCollector = unknown;

// hir_ty_lowering/bounds.rs:61 (stub; final signature: decls.ts `Fns_hir_ty_lowering_bounds`)
export function search_bounds_for(_hir_bounds: readonly hir.GenericBound[], _context: ImpliedBoundsContext, _f: (_1: hir.PolyTraitRef) => void): void {
  return unported("rustc_hir_analysis::hir_ty_lowering::bounds::search_bounds_for");
}

// hir_ty_lowering/bounds.rs:88 (stub; final signature: decls.ts `Fns_hir_ty_lowering_bounds`)
export function collect_bounds(_hir_bounds: readonly hir.GenericBound[], _context: ImpliedBoundsContext, _target_did: DefId): CollectedBound {
  return unported("rustc_hir_analysis::hir_ty_lowering::bounds::collect_bounds");
}

// hir_ty_lowering/bounds.rs:108 (stub; final signature: decls.ts `Fns_hir_ty_lowering_bounds`)
export function collect_sizedness_bounds(_tcx: TyCtxt, _hir_bounds: readonly hir.GenericBound[], _context: ImpliedBoundsContext, _span: Span): CollectedSizednessBounds {
  return unported("rustc_hir_analysis::hir_ty_lowering::bounds::collect_sizedness_bounds");
}

// hir_ty_lowering/bounds.rs:127 (stub; final signature: decls.ts `Fns_hir_ty_lowering_bounds`)
export function add_trait_bound(_tcx: TyCtxt, _bounds: [Clause, Span][], _self_ty: Ty, _did: DefId, _span: Span): void {
  return unported("rustc_hir_analysis::hir_ty_lowering::bounds::add_trait_bound");
}

// hir_ty_lowering/bounds.rs:834 (stub; final signature: decls.ts `Fns_hir_ty_lowering_bounds`)
export function check_assoc_const_binding_type(_cx: HirTyLowerer, _assoc_const: Ident, _ty: Binder<Ty>, _hir_id: hir.HirId): Ty {
  return unported("rustc_hir_analysis::hir_ty_lowering::bounds::check_assoc_const_binding_type");
}

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::bounds::HirTyLowerer", [
  "add_implicit_sizedness_bounds", "add_default_traits", "add_default_trait", "should_add_default_traits",
  "require_bound_to_relax_default_trait", "lower_bounds", "lower_assoc_item_constraint",
  "lower_ty_maybe_return_type_notation", "lower_return_type_notation_ty",
]);
