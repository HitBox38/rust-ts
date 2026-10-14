// Port of compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs (STUB, lane collect-a):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { DefiningScopeKind, Ty } from "../../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../../rustc_span/def_id.ts";
import type { EarlyBinder } from "../../../rustc_type_ir/decls.ts";
import { unported } from "../../../std/panic.ts";

export * from "./opaque.gen.ts";

// opaque.rs:101 `struct TaitConstraintLocator` (+ its methods :118..:140 and `impl Visitor`, :208..:229): hand class extending
// rustc_hir intravisit's `Visitor` (types.sets.json `hand`). PORT: `unknown` until lane collect-a writes it.
export type TaitConstraintLocator = unknown;

// collect/type_of/opaque.rs:15 (stub; final signature: decls.ts `Fns_collect_type_of_opaque`)
export function find_opaque_ty_constraints_for_impl_trait_in_assoc_type(_tcx: TyCtxt, _def_id: LocalDefId, _opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::opaque::find_opaque_ty_constraints_for_impl_trait_in_assoc_type");
}

// collect/type_of/opaque.rs:75 (stub; final signature: decls.ts `Fns_collect_type_of_opaque`)
export function find_opaque_ty_constraints_for_tait(_tcx: TyCtxt, _def_id: LocalDefId, _opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::opaque::find_opaque_ty_constraints_for_tait");
}

// collect/type_of/opaque.rs:237 (stub; final signature: decls.ts `Fns_collect_type_of_opaque`)
export function find_opaque_ty_constraints_for_rpit(_tcx: TyCtxt, _def_id: LocalDefId, _owner_def_id: LocalDefId, _opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::opaque::find_opaque_ty_constraints_for_rpit");
}
