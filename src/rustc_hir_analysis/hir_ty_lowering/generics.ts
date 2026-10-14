// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs (STUB, lane hir-ty-lowering-c):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type * as hir from "../../rustc_hir/lib.ts";
import type { GenericArg, GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { GenericArgsLowerer, HirTyLowerer } from "../decls.ts";
import type { ExplicitLateBound, GenericArgCountResult, GenericArgPosition, IsMethodCall } from "./mod.gen.ts";
import { unported } from "../../std/panic.ts";

// hir_ty_lowering/generics.rs:29 (stub; final signature: decls.ts `Fns_hir_ty_lowering_generics`)
export function generic_arg_mismatch_err(_cx: HirTyLowerer, _arg: hir.GenericArg, _param: GenericParamDef, _possible_ordering_error: boolean, _help: string | undefined): ErrorGuaranteed {
  return unported("rustc_hir_analysis::hir_ty_lowering::generics::generic_arg_mismatch_err");
}

// hir_ty_lowering/generics.rs:190 (stub; final signature: decls.ts `Fns_hir_ty_lowering_generics`)
export function lower_generic_args(_cx: HirTyLowerer, _def_id: DefId, _parent_args: readonly GenericArg[], _has_self: boolean, _self_ty: Ty | undefined, _arg_count: GenericArgCountResult, _ctx: GenericArgsLowerer): GenericArgs {
  return unported("rustc_hir_analysis::hir_ty_lowering::generics::lower_generic_args");
}

// hir_ty_lowering/generics.rs:405 (stub; final signature: decls.ts `Fns_hir_ty_lowering_generics`)
export function check_generic_arg_count_for_value_path(_cx: HirTyLowerer, _def_id: DefId, _generics: Generics, _seg: hir.PathSegment, _is_method_call: IsMethodCall): GenericArgCountResult {
  return unported("rustc_hir_analysis::hir_ty_lowering::generics::check_generic_arg_count_for_value_path");
}

// hir_ty_lowering/generics.rs:419 (stub; final signature: decls.ts `Fns_hir_ty_lowering_generics`)
export function check_generic_arg_count(_cx: HirTyLowerer, _def_id: DefId, _seg: hir.PathSegment, _gen_params: Generics, _gen_pos: GenericArgPosition, _has_self: boolean): GenericArgCountResult {
  return unported("rustc_hir_analysis::hir_ty_lowering::generics::check_generic_arg_count");
}

// hir_ty_lowering/generics.rs:662 (stub; final signature: decls.ts `Fns_hir_ty_lowering_generics`)
export function prohibit_explicit_late_bound_lifetimes(_cx: HirTyLowerer, _def: Generics, _args: hir.GenericArgs, _position: GenericArgPosition): ExplicitLateBound {
  return unported("rustc_hir_analysis::hir_ty_lowering::generics::prohibit_explicit_late_bound_lifetimes");
}
