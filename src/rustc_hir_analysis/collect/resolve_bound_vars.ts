// Port of compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs (STUB, lane collect-rbv):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// Resolution of early vs late bound lifetimes.
//
// Name resolution for lifetimes is performed on the AST and embedded into HIR. From this information, typechecking needs
// to transform the lifetime parameters into bound lifetimes. Lifetimes can be early-bound or late-bound. Construction of
// bound lifetimes is a bit more involved; see the `resolve_bound_vars` query. The types of this file are not generated:
// the typedefs probe cannot parse its `gen` block (types.sets.json `files_note`).
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type * as hir from "../../rustc_hir/lib.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { BoundVariableKind } from "../../rustc_type_ir/decls.ts";
import type { ObjectLifetimeDefault, ResolveBoundVars, ResolvedArg } from "../decls.ts";
import { unported } from "../../std/panic.ts";

// collect/resolve_bound_vars.rs:234 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
// PORT(stub): installs nothing yet (it runs at provider setup, so it must not stop): `resolve_bound_vars`,
// `named_variable_map`, `is_late_bound_map`, `object_lifetime_default`, `late_bound_vars_map` and
// `opaque_captured_lifetimes` keep rustc_interface's placeholder providers (UNPORTED) until lane collect-rbv ports this fn
// (its closures read `ResolveBoundVars`' fields: rustc_middle middle/resolve_bound_vars.rs, see decls.ts).
export function provide(_providers: Providers): void {}

// collect/resolve_bound_vars.rs:257 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function resolve_bound_vars(_tcx: TyCtxt, _local_def_id: hir.OwnerId): ResolveBoundVars {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::resolve_bound_vars");
}

// collect/resolve_bound_vars.rs:291 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function late_arg_as_bound_arg(_param: hir.GenericParam): BoundVariableKind {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::late_arg_as_bound_arg");
}

// collect/resolve_bound_vars.rs:305 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function generic_param_def_as_bound_arg(_param: GenericParamDef): BoundVariableKind {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::generic_param_def_as_bound_arg");
}

// collect/resolve_bound_vars.rs:322 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function opaque_captures_all_in_scope_lifetimes(_opaque: hir.OpaqueTy): boolean {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::opaque_captures_all_in_scope_lifetimes");
}

// collect/resolve_bound_vars.rs:1181 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function object_lifetime_default(_tcx: TyCtxt, _param_def_id: LocalDefId): ObjectLifetimeDefault {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::object_lifetime_default");
}

// collect/resolve_bound_vars.rs:2587 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function is_late_bound_map(_tcx: TyCtxt, _owner_id: hir.OwnerId): Set<hir.ItemLocalId> | undefined {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::is_late_bound_map");
}

// collect/resolve_bound_vars.rs:2807 (stub; final signature: decls.ts `Fns_collect_resolve_bound_vars`)
export function deny_non_region_late_bound(_tcx: TyCtxt, _bound_vars: Map<LocalDefId, ResolvedArg>, _where_: string): void {
  return unported("rustc_hir_analysis::collect::resolve_bound_vars::deny_non_region_late_bound");
}
