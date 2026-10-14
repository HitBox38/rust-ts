// Port of compiler/rustc_hir_analysis/src/collect/clauses_of.rs (STUB, lane collect-b):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { ItemCtxt } from "../decls.ts";
import type { KeyedSet } from "../../rust_ts/keyed.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ConstConditions, GenericClauses, GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { EarlyBinder, PolyTraitRef } from "../../rustc_type_ir/decls.ts";
import type { PredicateFilter } from "../hir_ty_lowering/mod.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";

// collect/clauses_of.rs:28 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function clauses_of(_tcx: TyCtxt, _def_id: DefId): GenericClauses {
  return unported("rustc_hir_analysis::collect::clauses_of::clauses_of");
}

// collect/clauses_of.rs:82 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function gather_explicit_clauses_of(_tcx: TyCtxt, _def_id: LocalDefId): GenericClauses {
  return unported("rustc_hir_analysis::collect::clauses_of::gather_explicit_clauses_of");
}

// collect/clauses_of.rs:318 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function where_predicate_clauses(_icx: ItemCtxt, _predicate: hir.WherePredicate, _clauses: KeyedSet<[Clause, Span]>): void {
  return unported("rustc_hir_analysis::collect::clauses_of::where_predicate_clauses");
}

// collect/clauses_of.rs:384 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function compute_bidirectional_outlives_clauses(_tcx: TyCtxt, _opaque_own_params: readonly GenericParamDef[], _clauses: [Clause, Span][]): void {
  return unported("rustc_hir_analysis::collect::clauses_of::compute_bidirectional_outlives_clauses");
}

// collect/clauses_of.rs:412 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function const_evaluatable_clauses_of(_tcx: TyCtxt, _def_id: LocalDefId, _clauses: KeyedSet<[Clause, Span]>): KeyedSet<[Clause, Span]> {
  return unported("rustc_hir_analysis::collect::clauses_of::const_evaluatable_clauses_of");
}

// collect/clauses_of.rs:497 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function trait_explicit_clauses_and_bounds(_tcx: TyCtxt, _def_id: LocalDefId): GenericClauses {
  return unported("rustc_hir_analysis::collect::clauses_of::trait_explicit_clauses_and_bounds");
}

// collect/clauses_of.rs:505 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function explicit_clauses_of(_tcx: TyCtxt, _def_id: LocalDefId): GenericClauses {
  return unported("rustc_hir_analysis::collect::clauses_of::explicit_clauses_of");
}

// collect/clauses_of.rs:618 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function explicit_super_clauses_of(_tcx: TyCtxt, _trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::explicit_super_clauses_of");
}

// collect/clauses_of.rs:625 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function explicit_supertraits_containing_assoc_item(_tcx: TyCtxt, _0: [DefId, Ident]): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::explicit_supertraits_containing_assoc_item");
}

// collect/clauses_of.rs:636 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function explicit_implied_clauses_of(_tcx: TyCtxt, _trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::explicit_implied_clauses_of");
}

// collect/clauses_of.rs:654 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function implied_clauses_with_filter(_tcx: TyCtxt, _trait_def_id: DefId, _filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::implied_clauses_with_filter");
}

// collect/clauses_of.rs:756 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function assert_only_contains_clauses_from(_filter: PredicateFilter, _bounds: readonly [Clause, Span][], _ty: Ty): void {
  return unported("rustc_hir_analysis::collect::clauses_of::assert_only_contains_clauses_from");
}

// collect/clauses_of.rs:891 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function type_param_clauses(_tcx: TyCtxt, _0: [LocalDefId, LocalDefId, Ident]): EarlyBinder<readonly [Clause, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::type_param_clauses");
}

// collect/clauses_of.rs:1053 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function const_conditions(_tcx: TyCtxt, _def_id: LocalDefId): ConstConditions {
  return unported("rustc_hir_analysis::collect::clauses_of::const_conditions");
}

// collect/clauses_of.rs:1175 (stub; final signature: decls.ts `Fns_collect_clauses_of`)
export function explicit_implied_const_bounds(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<readonly [PolyTraitRef, Span][]> {
  return unported("rustc_hir_analysis::collect::clauses_of::explicit_implied_const_bounds");
}

unported_methods(ItemCtxt.prototype, "rustc_hir_analysis::collect::clauses_of::ItemCtxt", [
  "probe_ty_param_bounds_in_generics",
]);
