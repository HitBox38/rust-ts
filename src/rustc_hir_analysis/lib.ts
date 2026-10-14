// Port of compiler/rustc_hir_analysis/src/lib.rs: the crate root (contract lane hirtylowerer-contract; see
// docs/handoff/hirtylowerer-contract.md). Only the modules of the wave-16 collect / HIR ty lowering lanes exist yet; the
// others are listed below in upstream `mod` order with their status.
/*!

# typeck

The type checker is responsible for:

1. Determining the type of each expression.
2. Resolving methods and traits.
3. Guaranteeing that most type rules are met. ("Most?", you say, "why most?"
   Well, dear reader, read on.)

The main entry point is [`check_crate()`]. Type checking operates in
several major phases:

1. The collect phase first passes over all items and determines their
   type, without examining their "innards".

2. Variance inference then runs to compute the variance of each parameter.

3. Coherence checks for overlapping or orphaned impls.

4. Finally, the check phase then checks function bodies and so forth.
   Within the check phase, we check each function body one at a time
   (bodies of function expressions are checked as part of the
   containing function). Inference is used to supply types wherever
   they are unknown. The actual checking of a function itself has
   several phases (check, regionck, writeback), as discussed in the
   documentation for the [`check`] module.

The type checker is defined into various submodules which are documented
independently:

- hir_ty_lowering: lowers type-system entities from the [HIR][hir] to the
  [`rustc_middle::ty`] representation.

- collect: computes the types of each top-level item and enters them into
  the `tcx.types` table for later use.

- coherence: enforces coherence rules, builds some tables.

- variance: variance inference

- outlives: outlives inference

- check: walks over function bodies and type checks them, inferring types for
  local variables, type parameters, etc as necessary.

- infer: finds the types to use for each type variable such that
  all subtyping and assignment constraints are met. In essence, the check
  module specifies the constraints, and the infer module solves them.

## Note

This API is completely unstable and subject to change.

*/
//
// Layout and init order (a TDZ ReferenceError at load otherwise):
// - `HirTyLowerer` (the trait object) and `ItemCtxt` are declared in ./decls.ts, the contract, which imports only types.
//   The extension modules (collect.ts, collect/clauses_of.ts, hir_ty_lowering/{mod,bounds,dyn_trait,errors}.ts) import the
//   classes from there and assign onto their prototypes at load; their top-level code touches nothing else of this crate.
// - Consumers outside the crate import this module only.

// ---- lane collect-a imports (lib.rs fns other than `provide`) ----
import { display_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Const } from "../rustc_middle/ty/decls.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import { VariadicFunctionCompatibleConvention_diagnostic } from "./diagnostics.ts";
// ---- shared ----
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as collect from "./collect.ts";

// pub mod check;            (wave 17: check-wf-a/-b, check-check, check-compare, check-region-intrinsic)
// pub mod autoderef;        (wave 17/18)
// mod check_unused;         (wave 17)
// mod coherence;            (wave 17: coherence)
// mod collect;
// mod constrained_generic_params;
import "./constrained_generic_params.ts";
// pub mod delegation;
import * as delegation from "./delegation.ts";
export { delegation };
// pub mod diagnostics;
export * as diagnostics from "./diagnostics.ts";
// PORT: `diagnostics::wrong_number_of_generic_args` (declared in diagnostics.rs upstream; lane wrong-num-args).
export * as wrong_number_of_generic_args from "./diagnostics/wrong_number_of_generic_args.ts";
// pub mod hir_ty_lowering;
export * as hir_ty_lowering from "./hir_ty_lowering/mod.ts";
// pub mod hir_wf_check;     (wave 17)
// mod impl_wf_check;        (wave 17: variance-outlives-implwf)
// mod outlives;
import * as outlives from "./outlives/mod.ts";
// mod variance;
import * as variance from "./variance/mod.ts";

// pub use crate::collect::suggest_impl_trait;
export { suggest_impl_trait } from "./collect.ts";

export { HirTyLowerer, ItemCtxt } from "./decls.ts";
export type { GenericArgsLowerer, HirTyLowererImpl } from "./decls.ts";

// rustc: compiler/rustc_hir_analysis/src/lib.rs:97 check_c_variadic_abi
export function check_c_variadic_abi(tcx: TyCtxt, decl: hir.FnDecl, abi: ExternAbi, span: Span): void {
  if (!decl.c_variadic()) {
    // Not even a variadic function.
    return;
  }

  const status = ExternAbi.supports_c_variadic(abi);
  switch (status.$) {
    case "Stable":
      break;
    case "NotSupported":
      tcx.dcx().emit_err(VariadicFunctionCompatibleConvention_diagnostic({ span, convention: display_ExternAbi(abi) }));
      break;
    case "Unstable": {
      const feature = status.feature;
      if (!tcx.features().enabled(feature)) {
        feature_err(tcx.sess, feature, span, `C-variadic functions with the ${display_ExternAbi(abi)} calling convention are unstable`).emit();
      }
      break;
    }
  }
}

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`]
// rustc: compiler/rustc_hir_analysis/src/lib.rs:126 provide
export function provide(providers: Providers): void {
  collect.provide(providers);
  // PORT: the modules below are not ported yet (wave 17), so their queries keep the placeholder providers of
  // rustc_interface's `install_unported_providers` (UNPORTED). Each lane uncomments its lines.
  // coherence::provide(providers);
  // check::provide(providers);
  // providers.check_unused_traits = check_unused.check_unused_traits;
  // providers.diagnostic_hir_wf_check = hir_wf_check.diagnostic_hir_wf_check;
  providers.inferred_outlives_crate = outlives.inferred_outlives_crate;
  providers.inferred_outlives_of = outlives.inferred_outlives_of;
  providers.inherit_sig_for_delegation_item = delegation.inherit_sig_for_delegation_item;
  providers.delegation_user_specified_args = delegation.delegation_user_specified_args;
  // providers.enforce_impl_non_lifetime_params_are_constrained = impl_wf_check.enforce_impl_non_lifetime_params_are_constrained;
  providers.crate_variances = variance.crate_variances;
  providers.variances_of = variance.variances_of;
}

// lib.rs:145 (stub, wave 17 lane check-check; final signature: decls.ts `Fns_lib`)
export function check_crate(_tcx: TyCtxt): void {
  return unported("rustc_hir_analysis::check_crate");
}

/// Lower a [`hir::Ty`] to a [`Ty`].
///
/// <div class="warning">
///
/// This function is **quasi-deprecated**. It can cause ICEs if called inside of a body
/// (of a function or constant) and especially if it contains inferred types (`_`).
///
/// It's used in rustdoc and Clippy.
///
/// </div>
// rustc: compiler/rustc_hir_analysis/src/lib.rs:242 lower_ty
export function lower_ty(tcx: TyCtxt, hir_ty: hir.Ty): Ty {
  // In case there are any projections, etc., find the "environment"
  // def-ID that will be used to determine the traits/predicates in
  // scope. This is derived from the enclosing item-like thing.
  const env_def_id = tcx.hir_get_parent_item(hir_ty.hir_id);
  return collect.ItemCtxt.new(tcx, env_def_id.def_id).lowerer().lower_ty_maybe_return_type_notation(hir_ty);
}

/// This is for rustdoc.
// FIXME(const_generics): having special methods for rustdoc in `rustc_hir_analysis` is cursed
// rustc: compiler/rustc_hir_analysis/src/lib.rs:254 lower_const_arg_for_rustdoc
export function lower_const_arg_for_rustdoc(tcx: TyCtxt, hir_ct: hir.ConstArg, ty: Ty): Const {
  const env_def_id = tcx.hir_get_parent_item(hir_ct.hir_id);
  return collect.ItemCtxt.new(tcx, env_def_id.def_id).lowerer().lower_const_arg(hir_ct, ty);
}
