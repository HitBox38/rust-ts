// Port of compiler/rustc_hir_analysis/src/collect/item_bounds.rs (STUB, lane collect-b):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { EarlyBinder, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { PredicateFilter } from "../hir_ty_lowering/mod.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./item_bounds.gen.ts";

// item_bounds.rs:242 `struct MapAndCompressBoundVars` (+ `impl TypeFolder`, :256..:349) and :545 `struct AssocTyToOpaque` (+ `impl
// TypeFolder`, :551, :555): hand classes (types.sets.json `hand`). PORT: `unknown` until lane collect-b writes them.
export type MapAndCompressBoundVars = unknown;
export type AssocTyToOpaque = unknown;

// collect/item_bounds.rs:25 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function associated_type_bounds(_tcx: TyCtxt, _assoc_item_def_id: LocalDefId, _hir_bounds: readonly hir.GenericBound[], _span: Span, _filter: PredicateFilter): readonly [Clause, Span][] {
  return unported("rustc_hir_analysis::collect::item_bounds::associated_type_bounds");
}

// collect/item_bounds.rs:129 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function remap_gat_vars_and_recurse_into_nested_projections(_tcx: TyCtxt, _filter: PredicateFilter, _item_trait_ref: TraitRef, _assoc_item_def_id: LocalDefId, _span: Span, _clause: Clause): [Clause, Span] | undefined {
  return unported("rustc_hir_analysis::collect::item_bounds::remap_gat_vars_and_recurse_into_nested_projections");
}

// collect/item_bounds.rs:359 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function opaque_type_bounds(_tcx: TyCtxt, _opaque_def_id: LocalDefId, _hir_bounds: readonly hir.GenericBound[], _item_ty: Ty, _span: Span, _filter: PredicateFilter): readonly [Clause, Span][] {
  return unported("rustc_hir_analysis::collect::item_bounds::opaque_type_bounds");
}

// collect/item_bounds.rs:408 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function explicit_item_bounds(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::item_bounds::explicit_item_bounds");
}

// collect/item_bounds.rs:415 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function explicit_item_self_bounds(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::item_bounds::explicit_item_self_bounds");
}

// collect/item_bounds.rs:422 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function explicit_item_bounds_with_filter(_tcx: TyCtxt, _def_id: LocalDefId, _filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::item_bounds::explicit_item_bounds_with_filter");
}

// collect/item_bounds.rs:493 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function item_bounds(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Clauses> {
  return unported("rustc_hir_analysis::collect::item_bounds::item_bounds");
}

// collect/item_bounds.rs:499 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function item_self_bounds(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Clauses> {
  return unported("rustc_hir_analysis::collect::item_bounds::item_self_bounds");
}

// collect/item_bounds.rs:512 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function item_non_self_bounds(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Clauses> {
  return unported("rustc_hir_analysis::collect::item_bounds::item_non_self_bounds");
}

// collect/item_bounds.rs:530 (stub; final signature: decls.ts `Fns_collect_item_bounds`)
export function impl_super_outlives(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Clauses> {
  return unported("rustc_hir_analysis::collect::item_bounds::impl_super_outlives");
}
