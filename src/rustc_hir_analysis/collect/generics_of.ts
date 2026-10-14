// Port of compiler/rustc_hir_analysis/src/collect/generics_of.rs (STUB, lane collect-a):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { ParamDefaultPolicy } from "./generics_of.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./generics_of.gen.ts";

// generics_of.rs:520 `struct AnonConstInParamTyDetector` (+ `impl Visitor`, :528, :540): hand class extending rustc_hir intravisit's
// `Visitor` (types.sets.json `hand`). PORT: `unknown` until lane collect-a writes it.
export type AnonConstInParamTyDetector = unknown;

// collect/generics_of.rs:17 (stub; final signature: decls.ts `Fns_collect_generics_of`)
export function generics_of(_tcx: TyCtxt, _def_id: LocalDefId): Generics {
  return unported("rustc_hir_analysis::collect::generics_of::generics_of");
}

// collect/generics_of.rs:412 (stub; final signature: decls.ts `Fns_collect_generics_of`)
export function param_default_policy(_node: hir.Node): ParamDefaultPolicy | undefined {
  return unported("rustc_hir_analysis::collect::generics_of::param_default_policy");
}

// collect/generics_of.rs:446 (stub; final signature: decls.ts `Fns_collect_generics_of`)
export function has_late_bound_regions(_tcx: TyCtxt, _node: hir.Node): Span | undefined {
  return unported("rustc_hir_analysis::collect::generics_of::has_late_bound_regions");
}
