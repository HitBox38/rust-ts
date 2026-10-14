// Port of compiler/rustc_hir_analysis/src/collect/dump.rs (STUB, lane collect-b):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";

// collect/dump.rs:11 (stub; final signature: decls.ts `Fns_collect_dump`)
export function generics(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::generics");
}

// collect/dump.rs:30 (stub; final signature: decls.ts `Fns_collect_dump`)
export function object_lifetime_defaults(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::object_lifetime_defaults");
}

// collect/dump.rs:54 (stub; final signature: decls.ts `Fns_collect_dump`)
export function opaque_hidden_types(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::opaque_hidden_types");
}

// collect/dump.rs:74 (stub; final signature: decls.ts `Fns_collect_dump`)
export function clauses_and_item_bounds(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::clauses_and_item_bounds");
}

// collect/dump.rs:118 (stub; final signature: decls.ts `Fns_collect_dump`)
export function def_parents(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::def_parents");
}

// collect/dump.rs:164 (stub; final signature: decls.ts `Fns_collect_dump`)
export function vtables(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::collect::dump::vtables");
}
