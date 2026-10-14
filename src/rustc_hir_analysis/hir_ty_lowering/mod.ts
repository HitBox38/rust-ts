// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs (STUB, lanes hir-ty-lowering-a (lines 1..2185) and
// hir-ty-lowering-b (lines 2186..3915): see docs/handoff/hirtylowerer-contract.md "How to fill a stub").
//
//! HIR ty lowering: Lowers type-system entities[^1] from the [HIR][hir] to
//! the [`rustc_middle::ty`] representation.
//!
//! Not to be confused with *AST lowering* which lowers AST constructs to HIR ones
//! or with *THIR* / *MIR* *lowering* / *building* which lowers HIR *bodies*
//! (i.e., “executable code”) to THIR / MIR.
//!
//! Most lowering routines are defined on [`dyn HirTyLowerer`](HirTyLowerer) directly,
//! like the main routine of this module, `lower_ty`.
//!
//! This module used to be called `astconv`.
//!
//! [^1]: This includes types, lifetimes / regions, constants in type positions,
//! trait references and bounds.
//
// mod.rs is ported by two lanes: hir-ty-lowering-a owns lines 1..2185 (the types, the trait, `impl dyn HirTyLowerer` up to
// `probe_generic_path_segments`), hir-ty-lowering-b owns lines 2186..3915 (`lower_resolved_ty_path` to the end). Each lane
// edits only its region and its own import block; contract.test.ts checks that the two `unported_methods` lists split the
// `impl dyn HirTyLowerer` methods at line 2186.
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
// ---- lane hir-ty-lowering-a imports ----
// (none yet)
// ---- lane hir-ty-lowering-b imports ----
// (none yet)
// ---- shared ----
import { HirTyLowerer, type HirTyLowererImpl } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

export * from "./mod.gen.ts";

// mod bounds;
import "./bounds.ts";
// mod cmse;
import "./cmse.ts";
// mod dyn_trait;
import "./dyn_trait.ts";
// pub mod errors;
export * as errors from "./errors.ts";
// pub mod generics;
export * as generics from "./generics.ts";

export { HirTyLowerer } from "../decls.ts";
export type { GenericArgsLowerer, HirTyLowererImpl } from "../decls.ts";

// ==== lane hir-ty-lowering-a: mod.rs:1..2185 ====

// mod.rs:401 `struct ForbidParamUsesFolder` (+ `error`, :410, and `impl TypeFolder`, :461..:479): hand class (types.sets.json
// `hand`). PORT: `unknown` until lane hir-ty-lowering-a writes it.
export type ForbidParamUsesFolder = unknown;

// mod.rs:261 `AssocItemQSelf::to_string`, :277 / :285 / :292 `LowerTypeRelativePathMode::{assoc_tag, def_kind_for_diagnostics,
// permit_variants}`: enum methods on the generated companion consts (PORTING §8), lane hir-ty-lowering-a.

/**
 * The provided methods of `trait HirTyLowerer` (mod.rs:138; PORTING §8). `lowerer` takes the implementor's vtable as well:
 * it builds the trait object (upstream's unsizing coercion `self` -> `&dyn HirTyLowerer`).
 */
export const HirTyLowerer_provided = {
  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:239 lowerer
  lowerer<S>(self_: S, impl_: HirTyLowererImpl<S>): HirTyLowerer {
    return new HirTyLowerer(self_, impl_ as HirTyLowererImpl<unknown>);
  },
};

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer", [
  "check_param_res_if_mcg_for_instantiate_value_path", "anon_const_forbids_generic_params",
  "check_param_uses_if_mcg", "lower_lifetime", "lower_resolved_lifetime", "lower_generic_args_of_path_segment",
  "lower_generic_args_of_path", "lower_generic_args_of_assoc_item", "lower_impl_trait_ref", "lower_poly_trait_ref",
  "lower_mono_trait_ref", "probe_trait_that_defines_assoc_item", "lower_path_segment",
  "probe_single_ty_param_bound_for_assoc_item", "collapse_candidates_to_subtrait_pick",
  "probe_single_bound_for_assoc_item", "lower_type_relative_ty_path", "lower_type_relative_const_path",
  "lower_type_relative_path", "resolve_type_relative_path", "probe_inherent_assoc_item", "probe_assoc_item",
  "probe_assoc_item_unchecked", "check_assoc_item", "probe_traits_that_match_assoc_ty",
  "lower_resolved_assoc_ty_path", "lower_resolved_assoc_const_path", "lower_resolved_assoc_item_path",
  "prohibit_generic_args", "probe_generic_path_segments",
]);

// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer", [
  "lower_resolved_ty_path", "lower_ty_param", "lower_const_param", "lower_const_arg", "lower_const_arg_array",
  "try_recover_misrepresented_function_call", "lower_const_arg_tuple_call", "lower_const_arg_tup",
  "lower_const_arg_struct", "lower_path_for_struct_expr", "lower_resolved_const_path", "lower_const_arg_anon",
  "lower_const_arg_literal", "try_lower_anon_const_lit", "check_const_item_in_type_system", "lower_delegation_ty",
  "lower_ty", "lower_pat_ty_pat", "lower_field_of", "lower_opaque_ty", "lower_fn_ty",
  "suggest_trait_fn_ty_for_impl_fn_infer", "validate_late_bound_regions", "construct_const_ctor_value", "lower_view",
]);
