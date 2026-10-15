//! # Minimal Specialization
//!
//! This module contains the checks for sound specialization used when the
//! `min_specialization` feature is enabled. This requires that the impl is
//! *always applicable*.
//!
//! If `impl1` specializes `impl2` then `impl1` is always applicable if we know
//! that all the bounds of `impl2` are satisfied, and all of the bounds of
//! `impl1` are satisfied for some choice of lifetimes then we know that
//! `impl1` applies for any choice of lifetimes.
//!
//! ## Basic approach
//!
//! To enforce this requirement on specializations we take the following
//! approach:
//!
//! 1. Match up the args for `impl2` so that the implemented trait and
//!    self-type match those for `impl1`.
//! 2. Check for any direct use of `'static` in the args of `impl2`.
//! 3. Check that all of the generic parameters of `impl1` occur at most once
//!    in the *unconstrained* args for `impl2`. A parameter is constrained if
//!    its value is completely determined by an associated type projection
//!    predicate.
//! 4. Check that all predicates on `impl1` either exist on `impl2` (after
//!    matching args), or are well-formed predicates for the trait's type
//!    arguments.
//!
//! ## Example
//!
//! Suppose we have the following always applicable impl:
//!
//! ```ignore (illustrative)
//! impl<T> SpecExtend<T> for std::vec::IntoIter<T> { /* specialized impl */ }
//! impl<T, I: Iterator<Item=T>> SpecExtend<T> for I { /* default impl */ }
//! ```
//!
//! We get that the generic parameters for `impl2` are `[T, std::vec::IntoIter<T>]`.
//! `T` is constrained to be `<I as Iterator>::Item`, so we check only
//! `std::vec::IntoIter<T>` for repeated parameters, which it doesn't have. The
//! predicates of `impl1` are only `T: Sized`, which is also a predicate of
//! `impl2`. So this specialization is sound.
//!
//! ## Extensions
//!
//! Unfortunately not all specializations in the standard library are allowed
//! by this. So there are two extensions to these rules that allow specializing
//! on some traits: that is, using them as bounds on the specializing impl,
//! even when they don't occur in the base impl.
//!
//! ### rustc_specialization_trait
//!
//! If a trait is always applicable, then it's sound to specialize on it. We
//! check trait is always applicable in the same way as impls, except that step
//! 4 is now "all predicates on `impl1` are always applicable". We require that
//! `specialization` or `min_specialization` is enabled to implement these
//! traits.
//!
//! ### rustc_allow_lifetime_dependent_specialization
//!
//! There are also some specialization on traits with no methods, including the
//! stable `FusedIterator` trait. We allow marking marker traits with an
//! unstable attribute that means we ignore them in point 3 of the checks
//! above. This is unsound, in the sense that the specialized impl may be used
//! when it doesn't apply, but we allow it in the short term since it can't
//! cause use after frees with purely safe code in the same way as specializing
//! on traits with methods can.
//
// Port of compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`; `Result::and` is `and` (eager argument).
// - `FxHashSet<Parameter>` / `FxHashSet<u32>` are `Set`s (only probed; `Parameter` is a branded number).
// - `unbound_trait_ref == impl_trait_ref` compares the derived `PartialEq` of `TraitRef` (`def_id` by value, the
//   interned `args` by identity; `_use_trait_ref_new_instead` is `()`).
// - `<[T]>::partition_dedup` is std's algorithm (`partition_dedup` below): which duplicate comes first depends on its
//   swaps, so it is ported, not approximated.
// - `impl Elaboratable for (Clause, Span)` (rustc_middle ty/elaborate_impl.rs, not ported) is a local stand-in at the
//   end of the file that stops as UNPORTED. `traits::elaborate(..)` over `Clause` / `PredicateObligation` uses
//   rustc_type_ir elaborate.ts's `Elaboratable_Clause` / rustc_infer's `Elaboratable_PredicateObligation`;
//   `InferCtxtErrorExt::err_ctxt` (wave 19) is rustc_trait_selection traits/mod.ts's view.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import type { PredicateObligation } from "../../rustc_infer/traits/mod.ts";
import { Elaboratable_PredicateObligation } from "../../rustc_infer/traits/util.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { err_ctxt } from "../../rustc_trait_selection/traits/mod.ts";
import { translate_args_with_cause } from "../../rustc_trait_selection/traits/specialize/mod.ts";
import * as wf from "../../rustc_trait_selection/traits/wf.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArg, GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { GenericClauses, type GenericClauses as GenericClausesT } from "../../rustc_middle/ty/generics.ts";
import { type Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Clause, display_GenericArg, display_Term } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause } from "../../rustc_middle/ty/structural_impls.ts";
import type { ParamEnv } from "../../rustc_middle/ty/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { Node, type Ancestors } from "../../rustc_middle/traits/specialization_graph.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { TraitSpecializationKind } from "../../rustc_middle/ty/trait_def.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { fold_Vec } from "../../rustc_type_ir/fold.ts";
import { Elaboratable_Clause, elaborate } from "../../rustc_type_ir/elaborate.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { display_AliasTerm } from "../../rustc_type_ir/ir_print.ts";
import type { TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as cgp from "../constrained_generic_params.ts";
import { EmptySpecialization_diagnostic, GenericArgsOnOverriddenImpl_diagnostic, StaticSpecialize_diagnostic } from "../diagnostics.ts";

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:85 check_min_specialization
export function check_min_specialization(tcx: TyCtxt, impl_def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const node = parent_specialization_node(tcx, impl_def_id);
  if (node !== undefined) {
    const r = check_always_applicable(tcx, impl_def_id, node);
    if (r.$ === "Err") return r;
  }
  return Ok(null);
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:95 parent_specialization_node
function parent_specialization_node(tcx: TyCtxt, impl1_def_id: LocalDefId): Node | undefined {
  const trait_ref = tcx.impl_trait_ref(impl1_def_id);
  const trait_def = tcx.trait_def(EarlyBinder.skip_binder(trait_ref).def_id) as TraitDef;

  const ancestors = trait_def.ancestors(tcx, LocalDefId.to_def_id(impl1_def_id));
  if (ancestors.$ === "Err") return undefined;
  const impl2_node = nth(ancestors._0, 1);
  if (impl2_node === undefined) return undefined;

  const always_applicable_trait = trait_def.specialization_kind === TraitSpecializationKind.AlwaysApplicable;
  if (Node.is_from_trait(impl2_node) && !always_applicable_trait) {
    // Implementing a normal trait isn't a specialization.
    return undefined;
  }
  if (trait_def.is_marker) {
    // Overlapping marker implementations are not really specializations.
    return undefined;
  }
  return impl2_node;
}

/// Check that `impl1` is a sound specialization
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:116 check_always_applicable
function check_always_applicable(tcx: TyCtxt, impl1_def_id: LocalDefId, impl2_node: Node): Result<null, ErrorGuaranteed> {
  const span = tcx.def_span(impl1_def_id);

  const r = get_impl_args(tcx, impl1_def_id, impl2_node);
  if (r.$ === "Err") return r;
  const [impl1_args, impl2_args] = r._0;
  const impl2_def_id = Node.def_id(impl2_node);
  // debug!(?impl2_def_id, ?impl2_args);

  let parent_args: GenericArg[];
  if (Node.is_from_trait(impl2_node)) {
    parent_args = [...impl2_args];
  } else {
    parent_args = unconstrained_parent_impl_args(tcx, impl2_def_id, impl2_args);
  }

  return and(
    and(and(check_has_items(tcx, impl1_def_id, impl2_node, span), check_static_lifetimes(tcx, parent_args, span)), check_duplicate_params(tcx, impl1_args, parent_args, span)),
    check_predicates(tcx, impl1_def_id, impl1_args, impl2_node, impl2_args, span),
  );
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:139 check_has_items
function check_has_items(tcx: TyCtxt, impl1_def_id: LocalDefId, impl2_node: Node, span: Span): Result<null, ErrorGuaranteed> {
  if (impl2_node.$ === "Impl" && tcx.associated_item_def_ids(impl1_def_id).length === 0) {
    const impl2_id = impl2_node._0;
    const base_impl_span = tcx.def_span(impl2_id);
    return Err(tcx.dcx().emit_err(EmptySpecialization_diagnostic({ span, base_impl_span })));
  }
  return Ok(null);
}

/// Given a specializing impl `impl1`, and the base impl `impl2`, returns two
/// generic parameters `(S1, S2)` that equate their trait references.
/// The returned types are expressed in terms of the generics of `impl1`.
///
/// Example
///
/// ```ignore (illustrative)
/// impl<A, B> Foo<A> for B { /* impl2 */ }
/// impl<C> Foo<Vec<C>> for C { /* impl1 */ }
/// ```
///
/// Would return `S1 = [C]` and `S2 = [Vec<C>, C]`.
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:166 get_impl_args
function get_impl_args(tcx: TyCtxt, impl1_def_id: LocalDefId, impl2_node: Node): Result<[GenericArgs, GenericArgs], ErrorGuaranteed> {
  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const param_env = tcx.param_env(impl1_def_id) as ParamEnv;
  const impl1_span = tcx.def_span(impl1_def_id);

  const impl1_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(impl1_def_id));
  const impl2_args_ = translate_args_with_cause(infcx, param_env, LocalDefId.to_def_id(impl1_def_id), impl1_args, impl2_node, ObligationCause.misc(impl1_span, impl1_def_id));

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    const guar = err_ctxt(ocx.infcx).report_fulfillment_errors(errors._0);
    return Err(guar);
  }

  const assumed_wf_types = ocx.assumed_wf_types_and_report_errors(param_env, impl1_def_id);
  if (assumed_wf_types.$ === "Err") return assumed_wf_types;
  const r = ocx.resolve_regions_and_report_errors(impl1_def_id, param_env, assumed_wf_types._0);
  if (r.$ === "Err") return r;
  const impl2_args = infcx.deeply_resolve_via_region_graph(impl2_args_, fold_GenericArgs);
  if (impl2_args.$ === "Err") {
    const span = tcx.def_span(impl1_def_id);
    const guar = tcx.dcx().emit_err(GenericArgsOnOverriddenImpl_diagnostic({ span }));
    return Err(guar);
  }
  return Ok([impl1_args, impl2_args._0]);
}

/// Returns a list of all of the unconstrained generic parameters of the given impl.
///
/// For example given the impl:
///
/// impl<'a, T, I> ... where &'a I: IntoIterator<Item=&'a T>
///
/// This would return the args corresponding to `['a, I]`, because knowing
/// `'a` and `I` determines the value of `T`.
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:210 unconstrained_parent_impl_args
function unconstrained_parent_impl_args(tcx: TyCtxt, impl_def_id: DefId, impl_args: GenericArgs): GenericArg[] {
  const impl_generic_clauses = tcx.clauses_of(impl_def_id) as GenericClausesT;
  const unconstrained_parameters = new Set<cgp.Parameter>();
  const constrained_params = new Set<number>();
  const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id)));

  // Unfortunately the functions in `constrained_generic_parameters` don't do
  // what we want here. We want only a list of constrained parameters while
  // the functions in `cgp` add the constrained parameters to a list of
  // unconstrained parameters.
  for (const [clause, _] of impl_generic_clauses.clauses) {
    const k = Binder.skip_binder(clause.kind());
    if (k.$ === "Projection") {
      const proj = k._0;
      const unbound_trait_ref = AliasTerm.trait_ref(proj.projection_term, as_interner(tcx));
      if (TraitRef_eq(unbound_trait_ref, impl_trait_ref)) {
        continue;
      }

      for (const p of cgp.parameters_for(tcx, proj.projection_term, true, cgp.d_AliasTerm)) unconstrained_parameters.add(p);

      for (const param of cgp.parameters_for(tcx, proj.term, false, cgp.d_Term)) {
        if (!unconstrained_parameters.has(param)) {
          constrained_params.add(param);
        }
      }

      for (const p of cgp.parameters_for(tcx, proj.term, true, cgp.d_Term)) unconstrained_parameters.add(p);
    }
  }

  const out: GenericArg[] = [];
  impl_args.forEach((arg, idx) => {
    if (!constrained_params.has(idx)) out.push(arg);
  });
  return out;
}

/// Check that parameters of the derived impl don't occur more than once in the
/// equated args of the base impl.
///
/// For example forbid the following:
///
/// ```ignore (illustrative)
/// impl<A> Tr for A { }
/// impl<B> Tr for (B, B) { }
/// ```
///
/// Note that only consider the unconstrained parameters of the base impl:
///
/// ```ignore (illustrative)
/// impl<S, I: IntoIterator<Item = S>> Tr<S> for I { }
/// impl<T> Tr<T> for Vec<T> { }
/// ```
///
/// The args for the parent impl here are `[T, Vec<T>]`, which repeats `T`,
/// but `S` is constrained in the parent impl, so `parent_args` is only
/// `[Vec<T>]`. This means we allow this impl.
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:271 check_duplicate_params
function check_duplicate_params(tcx: TyCtxt, impl1_args: GenericArgs, parent_args: GenericArg[], span: Span): Result<null, ErrorGuaranteed> {
  const base_params = cgp.parameters_for(tcx, parent_args, true, fold_Vec(fold_GenericArg));
  base_params.sort((a, b) => a - b);
  const [, duplicates] = partition_dedup(base_params);
  if (duplicates.length !== 0) {
    const duplicate = duplicates[0]!;
    const param = impl1_args[duplicate]!;
    return Err(tcx.dcx().struct_span_err(span, `specializing impl repeats parameter \`${display_GenericArg(param)}\``).emit_err());
  }
  return Ok(null);
}

/// Check that `'static` lifetimes are not introduced by the specializing impl.
///
/// For example forbid the following:
///
/// ```ignore (illustrative)
/// impl<A> Tr for A { }
/// impl Tr for &'static i32 { }
/// ```
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:297 check_static_lifetimes
function check_static_lifetimes(tcx: TyCtxt, parent_args: GenericArg[], span: Span): Result<null, ErrorGuaranteed> {
  if (tcx.any_free_region_meets(parent_args, (r) => r.is_static(), fold_Vec(fold_GenericArg))) {
    return Err(tcx.dcx().emit_err(StaticSpecialize_diagnostic({ span })));
  }
  return Ok(null);
}

/// Check whether predicates on the specializing impl (`impl1`) are allowed.
///
/// Each predicate `P` must be one of:
///
/// * Global (not reference any parameters).
/// * A `T: Tr` predicate where `Tr` is an always-applicable trait.
/// * Present on the base impl `impl2`.
///     * This check is done using the `trait_predicates_eq` function below.
/// * A well-formed predicate of a type argument of the trait being implemented,
///   including the `Self`-type.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:319 check_predicates
function check_predicates(
  tcx: TyCtxt,
  impl1_def_id: LocalDefId,
  impl1_args: GenericArgs,
  impl2_node: Node,
  impl2_args: GenericArgs,
  span: Span,
): Result<null, ErrorGuaranteed> {
  const impl1_clauses: [Clause, Span][] = elaborate_Clause_Span(
    tcx,
    [...GenericClauses.instantiate(tcx.clauses_of(impl1_def_id) as GenericClausesT, tcx, impl1_args)].map(([c, s]) => [Unnormalized.skip_norm_wip(c), s] as [Clause, Span]),
  );

  let impl2_clauses: Clause[];
  if (Node.is_from_trait(impl2_node)) {
    // Always applicable traits have to be always applicable without any
    // assumptions.
    impl2_clauses = [];
  } else {
    impl2_clauses = elaborate_Clause(
      tcx,
      [...GenericClauses.instantiate(tcx.clauses_of(Node.def_id(impl2_node)) as GenericClausesT, tcx, impl2_args)].map(([c, _s]) => Unnormalized.skip_norm_wip(c)),
    );
  }
  // debug!(?impl1_clauses, ?impl2_clauses);

  // Since impls of always applicable traits don't get to assume anything, we
  // can also assume their supertraits apply.
  //
  // For example, we allow:
  //
  // #[rustc_specialization_trait]
  // trait AlwaysApplicable: Debug { }
  //
  // impl<T> Tr for T { }
  // impl<T: AlwaysApplicable> Tr for T { }
  //
  // Specializing on `AlwaysApplicable` allows also specializing on `Debug`
  // which is sound because we forbid impls like the following
  //
  // impl<D: Debug> AlwaysApplicable for D { }
  const always_applicable_traits = impl1_clauses.filter(([clause, _span]) => trait_specialization_kind(tcx, clause) === TraitSpecializationKind.AlwaysApplicable).map(([c, _span]) => c);

  // Include the well-formed predicates of the type parameters of the impl.
  for (const arg of Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl1_def_id))).args) {
    const term = GenericArg.as_term(arg);
    if (term === undefined) {
      continue;
    }
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const obligations = unwrap(wf.obligations(infcx, tcx.param_env(impl1_def_id) as ParamEnv, impl1_def_id, 0, term, span));

    // assert!(!obligations.has_infer());
    impl2_clauses.push(...elaborate_PredicateObligation_as_clause(tcx, obligations));
  }
  impl2_clauses.push(...elaborate_Clause(tcx, always_applicable_traits));

  let res: Result<null, ErrorGuaranteed> = Ok(null);
  for (const [clause1, span] of impl1_clauses) {
    if (!impl2_clauses.some((clause2) => clause1 === clause2)) {
      res = and(res, check_specialization_on(tcx, clause1, span));
    }
  }
  return res;
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:406 check_specialization_on
function check_specialization_on(tcx: TyCtxt, clause: Clause, span: Span): Result<null, ErrorGuaranteed> {
  const k = Binder.skip_binder(clause.kind());
  // Global predicates are either always true or always false, so we
  // are fine to specialize on.
  if (TypeVisitableExt.is_global(clause, fold_Clause)) {
    return Ok(null);
  }
  switch (k.$) {
    // We allow specializing on explicitly marked traits with no associated
    // items.
    case "Trait": {
      const trait_ref = k._0.trait_ref;
      if (trait_specialization_kind(tcx, clause) === TraitSpecializationKind.Marker) {
        return Ok(null);
      } else {
        return Err(tcx.dcx().struct_span_err(span, `cannot specialize on trait \`${tcx.def_path_str(trait_ref.def_id)}\``).emit_err());
      }
    }
    case "Projection": {
      const { projection_term, term } = k._0;
      return Err(tcx.dcx().struct_span_err(span, `cannot specialize on associated type \`${display_AliasTerm(projection_term)} == ${display_Term(term)}\``).emit_err());
    }
    case "ConstArgHasType":
      // FIXME(min_specialization), FIXME(const_generics):
      // It probably isn't right to allow _every_ `ConstArgHasType` but I am somewhat unsure
      // about the actual rules that would be sound. Can't just always error here because otherwise
      // std/core doesn't even compile as they have `const N: usize` in some specializing impls.
      //
      // While we do not support constructs like `<T, const N: T>` there is probably no risk of
      // soundness bugs, but when we support generic const parameter types this will need to be
      // revisited.
      return Ok(null);
    default:
      return Err(tcx.dcx().struct_span_err(span, `cannot specialize on predicate \`${display_Clause(clause)}\``).emit_err());
  }
}

// rustc: compiler/rustc_hir_analysis/src/impl_wf_check/min_specialization.rs:461 trait_specialization_kind
function trait_specialization_kind(tcx: TyCtxt, clause: Clause): TraitSpecializationKind | undefined {
  const k = Binder.skip_binder(clause.kind());
  switch (k.$) {
    case "Trait": {
      const trait_ref = k._0.trait_ref;
      return (tcx.trait_def(trait_ref.def_id) as TraitDef).specialization_kind;
    }
    case "RegionOutlives":
    case "TypeOutlives":
    case "Projection":
    case "ConstArgHasType":
    case "WellFormed":
    case "ConstEvaluatable":
    case "UnstableFeature":
    case "HostEffect":
      return undefined;
  }
}

// ---- std / derive helpers -------------------------------------------------------------------------------------------

/** `Iterator::nth` */
function nth(it: Ancestors, n: number): Node | undefined {
  for (let i = 0; i < n; i++) {
    if (it.next() === undefined) return undefined;
  }
  return it.next();
}

/** `#[derive(PartialEq)]` of `TraitRef` (`_use_trait_ref_new_instead: ()` is always equal). */
function TraitRef_eq(a: TraitRef, b: TraitRef): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}

/**
 * `<[T]>::partition_dedup` (core slice/mod.rs `partition_dedup_by` with `|a, b| a == b`): moves all but the first of
 * consecutive equal elements to the end, in place, and returns `(dedup, duplicates)`.
 */
function partition_dedup<T>(self: T[]): [T[], T[]] {
  const len = self.length;
  if (len <= 1) {
    return [self, []];
  }
  let next_read = 1;
  let next_write = 1;
  while (next_read < len) {
    if (!(self[next_read] === self[next_write - 1])) {
      if (next_read !== next_write) {
        const t = self[next_read]!;
        self[next_read] = self[next_write]!;
        self[next_write] = t;
      }
      next_write += 1;
    }
    next_read += 1;
  }
  return [self.slice(0, next_write), self.slice(next_write)];
}

// ---- PORT stand-ins for items of files / lanes that are not ported yet -------------------------------------------------

/** PORT: stand-in for `traits::elaborate(tcx, iter).collect()` over `(Clause, Span)` (`impl Elaboratable for (Clause, Span)`, rustc_middle ty/elaborate_impl.rs:66, not ported). */
function elaborate_Clause_Span(_tcx: TyCtxt, _obligations: Iterable<[Clause, Span]>): [Clause, Span][] {
  return unported("rustc_middle::ty::elaborate_impl: impl Elaboratable for (Clause, Span)");
}

/** `traits::elaborate(tcx, iter).collect()` over `Clause` (rustc_type_ir elaborate.ts's `Elaboratable_Clause`). */
function elaborate_Clause(tcx: TyCtxt, obligations: Iterable<Clause>): Clause[] {
  return [...elaborate(tcx, obligations, Elaboratable_Clause)];
}

/** `traits::elaborate(tcx, obligations).filter_map(|o| o.predicate.as_clause())` (`impl Elaboratable for PredicateObligation`, rustc_infer traits/util.ts). */
function elaborate_PredicateObligation_as_clause(tcx: TyCtxt, obligations: Iterable<PredicateObligation>): Clause[] {
  const out: Clause[] = [];
  for (const obligation of elaborate(tcx, obligations, Elaboratable_PredicateObligation)) {
    const c = obligation.predicate.as_clause();
    if (c !== undefined) out.push(c);
  }
  return out;
}
