//! This pass enforces various "well-formedness constraints" on impls.
//! Logically, it is part of wfcheck -- but we do it early so that we
//! can stop compilation afterwards, since part of the trait matching
//! infrastructure gets very grumpy if these conditions don't hold. In
//! particular, if there are type parameters that are not part of the
//! impl, then coherence will report strange inference ambiguity
//! errors; if impls have duplicate items, we get misleading
//! specialization errors. These things can (and probably should) be
//! fixed, but for the moment it's easier to do these checks early.
//
// Port of compiler/rustc_hir_analysis/src/impl_wf_check.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `Result::and(self, res)` evaluates `res` eagerly (it is an argument), so `res.and(f(..))` is `and(res, f(..))`
//   with the call made first.
// - `?` on a `Result<(), ErrorGuaranteed>` is `if (r.$ === "Err") return r;`.
// - `impl_trait_ref.error_reported()` on an `Option<TraitRef>` uses rustc_type_ir fold.ts's `fold_Option` descriptor.
// - `FxHashSet<Parameter>` is a `Set<Parameter>` (constrained_generic_params.ts: `Parameter` is a branded number).
// - `debug_assert_matches!` stays as a comment.
// - `suggest_to_remove_or_use_generic` (diagnostics/remove_or_use_generic.rs) is imported from its module directly:
//   diagnostics.rs's `pub(crate) mod remove_or_use_generic;` line belongs to diagnostics.ts (not this lane's file).
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.
import { Applicability, E0207 } from "../rustc_errors/lib.ts";
import { Defaultness } from "../rustc_hir/hir.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { AssocItem as AssocItemT } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type GenericClauses, GenericParamDef, type Generics } from "../rustc_middle/ty/generics.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ParamConst, ParamTy } from "../rustc_middle/ty/sty.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { display_Symbol, kw } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_Option } from "../rustc_type_ir/fold.ts";
import type { TraitRef } from "../rustc_type_ir/predicate.gen.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { Ok, type Result } from "../std/result.ts";
import * as cgp from "./constrained_generic_params.ts";
import { UnconstrainedGenericParameter_diagnostic } from "./diagnostics.ts";
import { suggest_to_remove_or_use_generic } from "./diagnostics/remove_or_use_generic.ts";
import { check_min_specialization } from "./impl_wf_check/min_specialization.ts";

// mod min_specialization;
export * as min_specialization from "./impl_wf_check/min_specialization.ts";

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/// Checks that all the type/lifetime parameters on an impl also
/// appear in the trait ref or self type (or are constrained by a
/// where-clause). These rules are needed to ensure that, given a
/// trait ref like `<T as Trait<U>>`, we can derive the values of all
/// parameters on the impl (which is needed to make specialization
/// possible).
///
/// However, in the case of lifetimes, we only enforce these rules if
/// the lifetime parameter is used in an associated type. This is a
/// concession to backwards compatibility; see comment at the end of
/// the fn for details.
///
/// Example:
///
/// ```rust,ignore (pseudo-Rust)
/// impl<T> Trait<Foo> for Bar { ... }
/// //   ^ T does not appear in `Foo` or `Bar`, error!
///
/// impl<T> Trait<Foo<T>> for Bar { ... }
/// //   ^ T appears in `Foo<T>`, ok.
///
/// impl<T> Trait<Foo> for Bar where Bar: Iterator<Item = T> { ... }
/// //   ^ T is bound to `<Bar as Iterator>::Item`, ok.
///
/// impl<'a> Trait<Foo> for Bar { }
/// //   ^ 'a is unused, but for back-compat we allow it
///
/// impl<'a> Trait<Foo> for Bar { type X = &'a i32; }
/// //   ^ 'a is unused and appears in assoc type, error
/// ```
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check.rs:58 check_impl_wf
export function check_impl_wf(tcx: TyCtxt, impl_def_id: LocalDefId, of_trait: boolean): Result<null, ErrorGuaranteed> {
  // debug_assert_matches!(tcx.def_kind(impl_def_id), DefKind::Impl { .. });

  // Check that the args are constrained. We queryfied the check for ty/const params
  // since unconstrained type/const params cause ICEs in projection, so we want to
  // detect those specifically and project those to `TyKind::Error`.
  let res = tcx.ensure_result().enforce_impl_non_lifetime_params_are_constrained(impl_def_id);
  res = and(res, enforce_impl_lifetime_params_are_constrained(tcx, impl_def_id, of_trait));

  if (of_trait && tcx.features().min_specialization()) {
    res = and(res, check_min_specialization(tcx, impl_def_id));
  }
  return res;
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check.rs:77 enforce_impl_lifetime_params_are_constrained
export function enforce_impl_lifetime_params_are_constrained(tcx: TyCtxt, impl_def_id: LocalDefId, of_trait: boolean): Result<null, ErrorGuaranteed> {
  const impl_self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>));

  // Don't complain about unconstrained type params when self ty isn't known due to errors.
  // (#36836)
  let r = TypeVisitableExt.error_reported(impl_self_ty, fold_Ty);
  if (r.$ === "Err") return r;

  const impl_generics = tcx.generics_of(impl_def_id) as Generics;
  const impl_clauses = tcx.clauses_of(impl_def_id) as GenericClauses;
  const impl_trait_ref: TraitRef | undefined = of_trait ? Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id))) : undefined;

  r = TypeVisitableExt.error_reported(impl_trait_ref, fold_Option(cgp.d_TraitRef));
  if (r.$ === "Err") return r;

  const input_parameters = cgp.parameters_for_impl(tcx, impl_self_ty, impl_trait_ref);
  cgp.identify_constrained_generic_params(tcx, impl_clauses, impl_trait_ref, input_parameters);

  // Disallow unconstrained lifetimes, but only if they appear in assoc types.
  const lifetimes_in_associated_types = new Set<cgp.Parameter>();
  for (const def_id of tcx.associated_item_def_ids(impl_def_id)) {
    const item = tcx.associated_item(def_id) as AssocItemT;
    let params: cgp.Parameter[];
    switch (item.kind.$) {
      case "Type": {
        if (Defaultness.has_value(AssocItem.defaultness(item, tcx))) {
          params = cgp.parameters_for(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)), true, cgp.d_Ty);
        } else {
          params = [];
        }
        break;
      }
      case "Fn":
      case "Const":
        params = [];
        break;
    }
    for (const p of params) lifetimes_in_associated_types.add(p);
  }

  let res: Result<null, ErrorGuaranteed> = Ok(null);
  for (const param of impl_generics.own_params) {
    switch (param.kind.$) {
      case "Lifetime": {
        // This is a horrible concession to reality. I think it'd be
        // better to just ban unconstrained lifetimes outright, but in
        // practice people do non-hygienic macros like:
        //
        // ```
        // macro_rules! __impl_slice_eq1 {
        //   ($Lhs: ty, $Rhs: ty, $Bound: ident) => {
        //     impl<'a, 'b, A: $Bound, B> PartialEq<$Rhs> for $Lhs where A: PartialEq<B> {
        //        ....
        //     }
        //   }
        // }
        // ```
        //
        // In a concession to backwards compatibility, we continue to
        // permit those, so long as the lifetimes aren't used in
        // associated types. I believe this is sound, because lifetimes
        // used elsewhere are not projected back out.
        const param_lt = cgp.Parameter.from_EarlyParamRegion(GenericParamDef.to_early_bound_region_data(param));
        if (lifetimes_in_associated_types.has(param_lt) && !input_parameters.has(param_lt)) {
          const diag = tcx.dcx().create_err(
            UnconstrainedGenericParameter_diagnostic({
              span: tcx.def_span(param.def_id),
              param_name: tcx.item_ident(param.def_id),
              param_def_kind: tcx.def_descr(param.def_id),
              const_param_note: false,
              const_param_note2: false,
            }),
          );
          diag.code(E0207);
          for (const p of impl_generics.own_params) {
            if (p.name === kw.UnderscoreLifetime) {
              const span = tcx.def_span(p.def_id);
              const snippet_r = tcx.sess.source_map().span_to_snippet(span);
              if (snippet_r.$ === "Err") {
                continue;
              }
              const snippet = snippet_r._0.toString();

              let span_: Span;
              let sugg: string;
              if (snippet === "'_") {
                [span_, sugg] = [span, display_Symbol(param.name)];
              } else {
                [span_, sugg] = [Span.shrink_to_hi(span), `${display_Symbol(param.name)} `];
              }
              diag.span_suggestion_verbose(span_, "consider using the named lifetime here instead of an implicit lifetime", sugg, Applicability.MaybeIncorrect);
            }
          }
          suggest_to_remove_or_use_generic(tcx, diag, impl_def_id, param, true);
          res = { $: "Err", _0: diag.emit_err() };
        }
        break;
      }
      case "Type":
      case "Const":
        // Enforced in `enforce_impl_non_lifetime_params_are_constrained`.
        break;
    }
  }
  return res;
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check.rs:193 enforce_impl_non_lifetime_params_are_constrained
export function enforce_impl_non_lifetime_params_are_constrained(tcx: TyCtxt, impl_def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const impl_self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>));

  // Don't complain about unconstrained type params when self ty isn't known due to errors.
  // (#36836)
  let r = TypeVisitableExt.error_reported(impl_self_ty, fold_Ty);
  if (r.$ === "Err") return r;

  const impl_generics = tcx.generics_of(impl_def_id) as Generics;
  const impl_clauses = tcx.clauses_of(impl_def_id) as GenericClauses;
  const opt = tcx.impl_opt_trait_ref(impl_def_id);
  const impl_trait_ref: TraitRef | undefined = opt === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(opt));

  r = TypeVisitableExt.error_reported(impl_trait_ref, fold_Option(cgp.d_TraitRef));
  if (r.$ === "Err") return r;

  const input_parameters = cgp.parameters_for_impl(tcx, impl_self_ty, impl_trait_ref);
  cgp.identify_constrained_generic_params(tcx, impl_clauses, impl_trait_ref, input_parameters);

  let res: Result<null, ErrorGuaranteed> = Ok(null);
  for (const param of impl_generics.own_params) {
    let err: boolean;
    switch (param.kind.$) {
      // Disallow ANY unconstrained type parameters.
      case "Type": {
        const param_ty = ParamTy.for_def(param);
        err = !input_parameters.has(cgp.Parameter.from_ParamTy(param_ty));
        break;
      }
      case "Const": {
        const param_ct = ParamConst.for_def(param);
        err = !input_parameters.has(cgp.Parameter.from_ParamConst(param_ct));
        break;
      }
      case "Lifetime":
        // Enforced in `enforce_impl_type_params_are_constrained`.
        err = false;
        break;
    }
    if (err) {
      const const_param_note = param.kind.$ === "Const";
      const diag = tcx.dcx().create_err(
        UnconstrainedGenericParameter_diagnostic({
          span: tcx.def_span(param.def_id),
          param_name: tcx.item_ident(param.def_id),
          param_def_kind: tcx.def_descr(param.def_id),
          const_param_note,
          const_param_note2: const_param_note,
        }),
      );
      diag.code(E0207);
      suggest_to_remove_or_use_generic(tcx, diag, impl_def_id, param, false);
      res = { $: "Err", _0: diag.emit_err() };
    }
  }
  return res;
}

