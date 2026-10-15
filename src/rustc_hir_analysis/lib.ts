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
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { AnonConstKind } from "../rustc_type_ir/const_kind.gen.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import { VariadicFunctionCompatibleConvention_diagnostic } from "./diagnostics.ts";
// ---- shared ----
import type { Providers } from "../rustc_middle/queries.gen.ts";
import * as collect from "./collect.ts";

// pub mod check;            (check/mod.rs, check/check.rs: lane check-check; the other check/ files are wave 17: check-wf-a/-b,
//                           check-compare, check-region-intrinsic)
import * as check from "./check/mod.ts";
export { check };
// pub mod autoderef;        (wave 17/18)
// mod check_unused;         (wave 17)
// mod coherence;
import * as coherence from "./coherence/mod.ts";
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
// mod impl_wf_check;
import * as impl_wf_check from "./impl_wf_check.ts";
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
  coherence.provide(providers);
  check.provide(providers);
  // PORT: the modules below are not ported yet (wave 17), so their queries keep the placeholder providers of
  // rustc_interface's `install_unported_providers` (UNPORTED). Each lane uncomments its lines.
  // providers.check_unused_traits = check_unused.check_unused_traits;
  // providers.diagnostic_hir_wf_check = hir_wf_check.diagnostic_hir_wf_check;
  providers.inferred_outlives_crate = outlives.inferred_outlives_crate;
  providers.inferred_outlives_of = outlives.inferred_outlives_of;
  providers.inherit_sig_for_delegation_item = delegation.inherit_sig_for_delegation_item;
  providers.delegation_user_specified_args = delegation.delegation_user_specified_args;
  providers.enforce_impl_non_lifetime_params_are_constrained = impl_wf_check.enforce_impl_non_lifetime_params_are_constrained;
  providers.crate_variances = variance.crate_variances;
  providers.variances_of = variance.variances_of;
}

// rustc: compiler/rustc_hir_analysis/src/lib.rs:145 check_crate
export function check_crate(tcx: TyCtxt): void {
  const _prof_timer = tcx.sess.timer("type_check_crate");

  tcx.sess.time("coherence_checking", () => {
    // When discarding query call results, use an explicit type to indicate
    // what we are intending to discard, to help future type-based refactoring.
    // type R = Result<(), ErrorGuaranteed>;

    void tcx.ensure_result().check_type_wf(null);

    for (const trait_def_id of tcx.all_local_trait_impls(null).keys()) {
      void tcx.ensure_result().coherent_trait(trait_def_id);
    }
    // these queries are executed for side-effects (error reporting):
    void tcx.ensure_result().crate_inherent_impls_validity_check(null);
    void tcx.ensure_result().crate_inherent_impls_overlap_check(null);
  });

  tcx.par_hir_body_owners((item_def_id) => {
    const def_kind = tcx.def_kind(item_def_id);
    // Make sure we evaluate all static and (non-associated) const items, even if unused.
    // If any of these fail to evaluate, we do not want this crate to pass compilation.
    if (def_kind.$ === "Static") {
      tcx.ensure_ok().eval_static_initializer(item_def_id);
      check.maybe_check_static_with_link_section(tcx, item_def_id);
    } else if (
      def_kind.$ === "Const" &&
      !(tcx.generics_of(item_def_id) as Generics).own_requires_monomorphization() &&
      tcx.const_of_item(item_def_id) === undefined
    ) {
      // FIXME(generic_const_items): Passing empty instead of identity args is fishy but
      //                             seems to be fine for now. Revisit this!
      // let instance = ty::Instance::new_raw(item_def_id.into(), ty::GenericArgs::empty());
      // let cid = GlobalId { instance, promoted: None };
      // let typing_env = ty::TypingEnv::fully_monomorphized();
      // tcx.ensure_ok().eval_to_const_value_raw(typing_env.as_query_input(cid));
      // PORT: `ty::Instance` / `mir::interpret::GlobalId` are not ported (M4).
      return unported("rustc_middle::mir::interpret::GlobalId / ty::Instance::new_raw (M4)");
    }
    // Skip `AnonConst`s and type system `InlineConst`s because we feed their `type_of` in
    // `feed_anon_const_type`.
    // Also skip items for which typeck forwards to parent typeck.
    if (
      !(
        (def_kind.$ === "AnonConst" && (tcx.anon_const_kind(item_def_id) as AnonConstKind) !== "NonTypeSystemInline") ||
        tcx.is_typeck_child(LocalDefId.to_def_id(item_def_id))
      )
    ) {
      tcx.ensure_ok().typeck(item_def_id);
    }
  });

  // This has to be a second pass over the body owners, after every body has been
  // type-checked above. `needs_coroutine_by_move_body_def_id` asks for `type_of`, and for a
  // body owner nested inside a const argument's anon const that goes through `typeck` of the
  // anon const, which needs the anon const's own type. That type is never computed, only fed
  // while the enclosing body is type-checked. Doing this in the pass above lets the parallel
  // front end reach the nested body owner first, computing (and caching) an error type for
  // the anon const that then conflicts with the type fed later on.
  //
  // This must not be parallelized since `coroutine_by_move_body_def_id` creates new `DefId`-s
  // inside, which must be done in deterministic order to have reproducible binaries.
  for (const item_def_id of tcx.hir_body_owners()) {
    // Ensure we generate the new `DefId` before finishing `check_crate`.
    // Afterwards we freeze the list of `DefId`s.
    if (tcx.needs_coroutine_by_move_body_def_id(LocalDefId.to_def_id(item_def_id))) {
      tcx.ensure_done().coroutine_by_move_body_def_id(item_def_id);
    }
  }

  if (tcx.features().rustc_attrs()) {
    tcx.sess.time("dumping_rustc_attr_data", () => {
      // tidy-alphabetical-start
      collect.dump.clauses_and_item_bounds(tcx);
      collect.dump.def_parents(tcx);
      collect.dump.generics(tcx);
      collect.dump.object_lifetime_defaults(tcx);
      collect.dump.opaque_hidden_types(tcx);
      collect.dump.vtables(tcx);
      // outlives::dump::inferred_outlives(tcx);
      // variance::dump::variances(tcx);
      // PORT: outlives/dump.rs and variance/dump.rs are lane variance-outlives-implwf's (not in this lane's base).
      unported("rustc_hir_analysis::outlives::dump::inferred_outlives / variance::dump::variances (lane variance-outlives-implwf)");
      // tidy-alphabetical-end
    });
  }

  tcx.ensure_ok().check_unused_traits(null);
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
