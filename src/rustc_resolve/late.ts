// Port of compiler/rustc_resolve/src/late.rs
//! "Late resolution" is the pass that resolves most of names in a crate beside imports and macros.
//! It runs when the crate is fully expanded and its module structure is fully built.
//! So it just walks through the crate and resolves all the expressions, types, etc.
//!
//! If you wonder why there's no `early.rs`, that's because it's split into three files -
//! `build_reduced_graph.rs`, `macros.rs` and `imports.rs`.
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts (the
// `LateResolutionVisitor` class lives there too: its `impl` is split with late/diagnostics.rs) and
// installed below as `unported(..)` placeholders; free fns, companions and statics have their final
// signatures and `unported` bodies, without markers. The lane that ports late.rs replaces each stub
// in place (adding its `// rustc: ` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports (late/diagnostics.ts included) are read inside
// function bodies only; this module must not import late/diagnostics.ts at runtime except for
// such uses (lib.ts loads both).
import { type Generics, visit } from "../rustc_ast/lib.ts";
import type { DiagArgValue, ErrCode } from "../rustc_errors/lib.ts";
import type { Namespace } from "../rustc_hir/def.ts";
import type { LifetimeRes } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { LateResolutionVisitor, Resolver } from "./decls.ts";
import * as gen from "./late.gen.ts";
import type { Res } from "./lib.ts";

export * from "./late.gen.ts";
export { LateResolutionVisitor };

// rustc-type: compiler/rustc_resolve/src/late.rs:5729 ItemInfoCollector
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class ItemInfoCollector extends visit.Visitor {
  constructor(public r: Resolver) {
    super();
  }
}

/** Stub (lane res-lib): `late.rs:5741` `required_generic_args_suggestion` (unported). */
export function required_generic_args_suggestion(generics: Generics): string | undefined {
  return unported("rustc_resolve::late::required_generic_args_suggestion");
}
/** Stub (lane res-lib): `late.rs:5864` `def_id_matches_path` (unported). */
export function def_id_matches_path(tcx: TyCtxt, def_id: DefId, expected_path: readonly string[]): boolean {
  return unported("rustc_resolve::late::def_id_matches_path");
}
export type PatternSource = gen.PatternSource;
export const PatternSource = {
  ...gen.PatternSource,
  /** Stub: `late.rs:90` `PatternSource::descr` (unported). */
  descr(self: PatternSource): string {
    return unported("rustc_resolve::late::PatternSource::descr");
  },
};

// impl IntoDiagArg for PatternSource
/** Stub: `late.rs:101` `<PatternSource as IntoDiagArg>::into_diag_arg` (unported). */
export function PatternSource_into_diag_arg(self: PatternSource, _: MutRef<string | undefined>): DiagArgValue {
  return unported("rustc_resolve::late::<PatternSource as IntoDiagArg>::into_diag_arg");
}
export type ConstantHasGenerics = gen.ConstantHasGenerics;
export const ConstantHasGenerics = {
  ...gen.ConstantHasGenerics,
  /** Stub: `late.rs:152` `ConstantHasGenerics::force_yes_if` (unported). */
  force_yes_if(self: ConstantHasGenerics, b: boolean): ConstantHasGenerics {
    return unported("rustc_resolve::late::ConstantHasGenerics::force_yes_if");
  },
};
export type ConstantItemKind = gen.ConstantItemKind;
export const ConstantItemKind = {
  ...gen.ConstantItemKind,
  /** Stub: `late.rs:185` `ConstantItemKind::as_str` (unported). */
  as_str(self: ConstantItemKind): string {
    return unported("rustc_resolve::late::ConstantItemKind::as_str");
  },
};
export type RibKind = gen.RibKind;
export const RibKind = {
  ...gen.RibKind,
  /** Stub: `late.rs:262` `RibKind::contains_params` (unported). */
  contains_params(self: RibKind): boolean {
    return unported("rustc_resolve::late::RibKind::contains_params");
  },
  /** Stub: `late.rs:279` `RibKind::is_label_barrier` (unported). */
  is_label_barrier(self: RibKind): boolean {
    return unported("rustc_resolve::late::RibKind::is_label_barrier");
  },
};
export type LifetimeRibKind = gen.LifetimeRibKind;
export const LifetimeRibKind = {
  ...gen.LifetimeRibKind,
  /** Stub: `late.rs:388` `LifetimeRibKind::elided` (unported). */
  elided(res: LifetimeRes): LifetimeRibKind {
    return unported("rustc_resolve::late::LifetimeRibKind::elided");
  },
};
export type LifetimeBinderKind = gen.LifetimeBinderKind;
export const LifetimeBinderKind = {
  ...gen.LifetimeBinderKind,
  /** Stub: `late.rs:410` `LifetimeBinderKind::descr` (unported). */
  descr(self: LifetimeBinderKind): string {
    return unported("rustc_resolve::late::LifetimeBinderKind::descr");
  },
};
export type PathSource = gen.PathSource;
export const PathSource = {
  ...gen.PathSource,
  /** Stub: `late.rs:482` `PathSource::namespace` (unported). */
  namespace(self: PathSource): Namespace {
    return unported("rustc_resolve::late::PathSource::namespace");
  },
  /** Stub: `late.rs:502` `PathSource::defer_to_typeck` (unported). */
  defer_to_typeck(self: PathSource): boolean {
    return unported("rustc_resolve::late::PathSource::defer_to_typeck");
  },
  /** Stub: `late.rs:522` `PathSource::descr_expected` (unported). */
  descr_expected(self: PathSource): string {
    return unported("rustc_resolve::late::PathSource::descr_expected");
  },
  /** Stub: `late.rs:567` `PathSource::is_call` (unported). */
  is_call(self: PathSource): boolean {
    return unported("rustc_resolve::late::PathSource::is_call");
  },
  /** Stub: `late.rs:571` `PathSource::is_expected` (unported). */
  is_expected(self: PathSource, res: Res): boolean {
    return unported("rustc_resolve::late::PathSource::is_expected");
  },
  /** Stub: `late.rs:694` `PathSource::error_code` (unported). */
  error_code(self: PathSource, has_unexpected_resolution: boolean): ErrCode {
    return unported("rustc_resolve::late::PathSource::error_code");
  },
};
export type MaybeExported = gen.MaybeExported;
export const MaybeExported = {

  /** Stub: `late.rs:737` `MaybeExported::eval` (unported). */
  eval(self: MaybeExported, r: Resolver): boolean {
    return unported("rustc_resolve::late::MaybeExported::eval");
  },
};
export type Rib<R = Res> = gen.Rib<R>;
export const Rib = gen.Rib as typeof gen.Rib & {
  "new": <R>(kind: RibKind) => Rib<R>;
};
/** Stub: `late.rs:309` `Rib::new` (unported). */
Rib.new = function <R>(kind: RibKind): Rib<R> {
  return unported("rustc_resolve::late::Rib::new");
};
export type LifetimeRib = gen.LifetimeRib;
export const LifetimeRib = gen.LifetimeRib as typeof gen.LifetimeRib & {
  "new": (kind: LifetimeRibKind) => LifetimeRib;
};
/** Stub: `late.rs:433` `LifetimeRib::new` (unported). */
LifetimeRib.new = function (kind: LifetimeRibKind): LifetimeRib {
  return unported("rustc_resolve::late::LifetimeRib::new");
};
unported_methods(LateResolutionVisitor.prototype, "rustc_resolve::late::LateResolutionVisitor", ["as_ref", "as_mut", "visit_attribute", "visit_item", "visit_arm", "visit_block", "visit_anon_const", "visit_expr", "visit_pat", "visit_local", "visit_ty", "visit_ty_pat", "visit_poly_trait_ref", "visit_foreign_item", "visit_fn", "visit_lifetime", "visit_precise_capturing_arg", "visit_generics", "visit_closure_binder", "visit_generic_arg", "visit_assoc_item_constraint", "visit_path_segment", "visit_where_predicate", "visit_inline_asm", "visit_inline_asm_sym", "visit_variant", "visit_field_def", "visit_test_binder_forall", "visit_test_binder_exists", "visit_test_binder_bound_type_constraint", "maybe_resolve_ident_in_lexical_scope", "resolve_ident_in_lexical_scope", "resolve_path", "with_rib", "visit_generic_params", "with_lifetime_rib", "resolve_lifetime", "resolve_anonymous_lifetime", "point_at_impl_lifetimes", "resolve_elided_lifetime", "create_fresh_lifetime", "resolve_elided_lifetimes_in_path", "record_lifetime_use", "record_lifetime_err", "record_lifetime_def", "resolve_fn_signature", "resolve_fn_params", "find_lifetime_for_self", "resolve_label", "is_label_valid_from_rib", "resolve_adt", "future_proof_import", "resolve_item", "with_generic_param_rib", "with_label_rib", "with_static_rib", "with_constant_rib", "with_current_self_type", "with_current_self_item", "resolve_trait_items", "resolve_trait_item", "with_optional_trait_ref", "with_self_rib_ns", "with_self_rib", "resolve_implementation", "resolve_test_binder_constraints", "resolve_impl_item", "fill_delegation_inherent_fn_map", "check_trait_item", "resolve_static_body", "resolve_const_item_rhs", "resolve_delegation", "resolve_params", "resolve_local", "compute_and_check_binding_map", "is_base_res_local", "compute_and_check_or_pat_binding_map", "check_consistent_bindings", "resolve_arm", "resolve_pattern_top", "apply_pattern_bindings", "resolve_pattern", "resolve_pattern_inner", "record_patterns_with_skipped_bindings", "fresh_binding", "innermost_rib_bindings", "try_resolve_as_non_binding", "resolve_restriction_path", "smart_resolve_path", "smart_resolve_path_fragment", "self_type_is_available", "self_value_is_available", "report_error", "should_report_errs", "resolve_qpath_anywhere", "resolve_qpath", "with_resolved_label", "resolve_labeled_block", "resolve_block", "resolve_anon_const", "resolve_anon_const_manual", "resolve_expr_field", "resolve_expr", "record_candidate_traits_for_expr_if_necessary", "record_traits_in_scope", "resolve_and_cache_rustdoc_path", "is_invalid_proc_macro_item_for_doc", "resolve_doc_links", "lint_unused_qualifications", "resolve_define_opaques", "resolve_eii"]);
unported_methods(ItemInfoCollector.prototype, "rustc_resolve::late::ItemInfoCollector", ["collect_fn_info", "visit_item", "visit_assoc_item"]);
unported_methods(Resolver.prototype, "rustc_resolve::late::Resolver", ["late_resolve_crate"]);
