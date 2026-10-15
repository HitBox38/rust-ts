// Port of compiler/rustc_hir_analysis/src/autoderef.rs (lane small-gaps-17).
//
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.
//
// PORT notes (file-wide):
// - `debug!` / `#[instrument]` are tracing only and stay as comments; `debug_assert_eq!` is a comment (PORTING §3).
// - `impl Iterator for Autoderef` is the method `next()` plus the JS iterator protocol (`[Symbol.iterator]`), so callers
//   can `for (const [ty, steps] of autoderef)` where upstream iterates.
// - The builder methods taking `mut self` and returning `Self` set the flag on `this` and return `this`.
// - `ObligationCtxt` (rustc_trait_selection traits/engine.rs, lane trait-sel-traits-a) is not on this branch: the members
//   `normalize_ty` calls are a stand-in at the end of this file ("Stand-ins") that stops as UNPORTED; root repoints it at
//   rustc_trait_selection's `ObligationCtxt` when the lanes are integrated. `predicate_may_hold_opaque_types_jank` is the
//   `InferCtxtExt` extension declared by rustc_trait_selection/decls.ts (its stub stops as UNPORTED).
import type { InferCtxt } from "../rustc_infer/decls.ts";
import { Obligation, type PredicateObligation, type PredicateObligations, type TraitErrors } from "../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_PolyTraitRef } from "../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { LOCAL_CRATE, type LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Limit, Limit_mul } from "../rustc_structures/limit.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import { visit_with_TraitRef } from "../rustc_type_ir/predicate.gen.ts";
import { as_interner, type TraitRef, TraitRef as TraitRefC } from "../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { unported } from "../std/panic.ts";
import { AutoDerefReachedRecursionLimit_diagnostic } from "./diagnostics.ts";

// #[derive(Copy, Clone, Debug)]
export type AutoderefKind =
  /// A true pointer type, such as `&T` and `*mut T`.
  | "Builtin"
  /// A type which must dispatch to a `Deref` implementation.
  | "Overloaded";
export const AutoderefKind = { Builtin: "Builtin", Overloaded: "Overloaded" } as const;

interface AutoderefSnapshot {
  at_start: boolean;
  reached_recursion_limit: boolean;
  steps: [Ty, AutoderefKind][];
  cur_ty: Ty;
  obligations: PredicateObligations;
}

/// Recursively dereference a type, considering both built-in
/// dereferences (`*`) and the `Deref` trait.
/// Although called `Autoderef` it can be configured to use the
/// `Receiver` trait instead of the `Deref` trait.
export class Autoderef implements Iterable<[Ty, number]> {
  constructor(
    // Meta infos:
    public infcx: InferCtxt,
    public span_: Span,
    public body_def_id: LocalDefId,
    public param_env: ParamEnv,

    // Current state:
    public state: AutoderefSnapshot,

    // Configurations:
    // PORT: the three flags are named `*_` because methods of the same names exist (`include_raw_pointers()`, ...);
    // `span_` likewise (`span()`).
    public include_raw_pointers_: boolean,
    public use_receiver_trait_: boolean,
    public silence_errors_: boolean,
  ) {}

  // ---- impl Iterator for Autoderef ----

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:52 next
  next(): [Ty, number] | undefined {
    const tcx = this.infcx.tcx;

    // debug!("autoderef: steps={:?}, cur_ty={:?}", self.state.steps, self.state.cur_ty);
    if (this.state.at_start) {
      this.state.at_start = false;
      // debug!("autoderef stage #0 is {:?}", self.state.cur_ty);
      return [this.state.cur_ty, 0];
    }

    // If we have reached the recursion limit, error gracefully.
    if (!tcx.recursion_limit().value_within_limit(this.state.steps.length)) {
      if (!this.silence_errors_) {
        report_autoderef_recursion_limit_error(tcx, this.span_, this.state.cur_ty);
      }
      this.state.reached_recursion_limit = true;
      return undefined;
    }

    // We want to support method and function calls for `impl Deref<Target = ..>`.
    //
    // To do so we don't eagerly bail if the current type is the hidden type of an
    // opaque type and instead return `None` in `fn overloaded_deref_ty` if the
    // opaque does not have a `Deref` item-bound.
    const k = this.state.cur_ty.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar" && !this.infcx.has_opaques_with_sub_unified_hidden_type(k._0._0)) {
      return undefined;
    }

    // Otherwise, deref if type is derefable:
    // NOTE: in the case of self.use_receiver_trait = true, you might think it would
    // be better to skip this clause and use the Overloaded case only, since &T
    // and &mut T implement Receiver. But built-in derefs apply equally to Receiver
    // and Deref, and this has benefits for const and the emitted MIR.
    let kind: AutoderefKind;
    let new_ty: Ty;
    const builtin = this.state.cur_ty.builtin_deref(this.include_raw_pointers_);
    if (builtin !== undefined) {
      const ty = builtin;
      // debug_assert_eq!(ty, self.infcx.deeply_resolve_ignoring_regions(ty));
      [kind, new_ty] = [AutoderefKind.Builtin, ty];
    } else {
      const overloaded = this.overloaded_deref_ty(this.state.cur_ty);
      if (overloaded !== undefined) {
        // The overloaded deref check already normalizes the pointee type.
        [kind, new_ty] = [AutoderefKind.Overloaded, overloaded];
      } else {
        return undefined;
      }
    }

    this.state.steps.push([this.state.cur_ty, kind]);
    // debug!(
    //     "autoderef stage #{:?} is {:?} from {:?}",
    //     self.step_count(),
    //     new_ty,
    //     (self.state.cur_ty, kind)
    // );
    this.state.cur_ty = new_ty;

    return [this.state.cur_ty, this.step_count()];
  }

  /** PORT: the JS iterator protocol over `next()` (see the file header). */
  *[Symbol.iterator](): Iterator<[Ty, number]> {
    for (;;) {
      const step = this.next();
      if (step === undefined) return;
      yield step;
    }
  }

  // ---- impl Autoderef ----

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:112 new
  static new(infcx: InferCtxt, param_env: ParamEnv, body_def_id: LocalDefId, span: Span, base_ty: Ty): Autoderef {
    return new Autoderef(
      infcx,
      span,
      body_def_id,
      param_env,
      {
        steps: [],
        cur_ty: infcx.deeply_resolve_ignoring_regions(base_ty, fold_Ty),
        obligations: [],
        at_start: true,
        reached_recursion_limit: false,
      },
      false,
      false,
      false,
    );
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:137 overloaded_deref_ty
  overloaded_deref_ty(ty: Ty): Ty | undefined {
    // debug!("overloaded_deref_ty({:?})", ty);
    const tcx = this.infcx.tcx;

    if (TypeVisitableExt.references_error(ty, fold_Ty)) {
      return undefined;
    }

    // <ty as Deref>, or whatever the equivalent trait is that we've been asked to walk.
    let trait_def_id;
    let trait_target_def_id;
    if (this.use_receiver_trait_) {
      const t = tcx.lang_items().receiver_trait();
      if (t === undefined) return undefined;
      const tt = tcx.lang_items().receiver_target();
      if (tt === undefined) return undefined;
      [trait_def_id, trait_target_def_id] = [t, tt];
    } else {
      const t = tcx.lang_items().deref_trait();
      if (t === undefined) return undefined;
      const tt = tcx.lang_items().deref_target();
      if (tt === undefined) return undefined;
      [trait_def_id, trait_target_def_id] = [t, tt];
    }
    const trait_ref = TraitRefC.new(as_interner(tcx), trait_def_id, [GenericArg.from_Ty(ty)]);
    const cause = ObligationCause.misc(this.span_, this.body_def_id);
    const obligation: PredicateObligation = Obligation.new(
      tcx,
      cause,
      this.param_env,
      Binder.dummy(trait_ref, d_TraitRef),
      upcast_tcx(Predicate_upcast_from_PolyTraitRef),
    );
    // We detect whether the self type implements `Deref` before trying to
    // structurally normalize. We use `predicate_may_hold_opaque_types_jank`
    // to support not-yet-defined opaque types. It will succeed for `impl Deref`
    // but fail for `impl OtherTrait`.
    if (!this.infcx.predicate_may_hold_opaque_types_jank(obligation)) {
      // debug!("overloaded_deref_ty: cannot match obligation");
      return undefined;
    }

    const r = this.normalize_ty(Unnormalized.new(Ty.new_projection(tcx, "No", trait_target_def_id, [GenericArg.from_Ty(ty)])));
    if (r === undefined) return undefined;
    const [normalized_ty, obligations] = r;
    // debug!("overloaded_deref_ty({:?}) = ({:?}, {:?})", ty, normalized_ty, obligations);
    this.state.obligations.push(...obligations);

    return this.infcx.deeply_resolve_ignoring_regions(normalized_ty, fold_Ty);
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:178 normalize_ty
  normalize_ty(ty: Unnormalized<Ty>): [Ty, PredicateObligations] | undefined {
    const ocx = ObligationCtxt_new(this.infcx);
    const normalized_ty = ocx.normalize(ObligationCause.misc(this.span_, this.body_def_id), this.param_env, ty, fold_Ty);
    const errors = ocx.try_evaluate_obligations();
    if (!(errors.$ === "NoErrors")) {
      // We shouldn't have errors here in the old solver, except for
      // evaluate/fulfill mismatches, but that's not a reason for an ICE.
      // debug!(?errors, "encountered errors while fulfilling");
      return undefined;
    }

    return [normalized_ty, ocx.into_pending_obligations()];
  }

  /// Returns the final type we ended up with, which may be an unresolved
  /// inference variable.
  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:201 final_ty
  final_ty(): Ty {
    return this.state.cur_ty;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:205 step_count
  step_count(): number {
    return this.state.steps.length;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:209 into_obligations
  into_obligations(): PredicateObligations {
    return this.state.obligations;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:213 current_obligations
  current_obligations(): PredicateObligations {
    // PORT: `PredicateObligations::clone` copies the vector (the obligations are not mutated through it).
    return [...this.state.obligations];
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:217 steps
  steps(): readonly [Ty, AutoderefKind][] {
    return this.state.steps;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:221 span
  span(): Span {
    return this.span_;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:225 reached_recursion_limit
  reached_recursion_limit(): boolean {
    return this.state.reached_recursion_limit;
  }

  /// also dereference through raw pointer types
  /// e.g., assuming ptr_to_Foo is the type `*const Foo`
  /// fcx.autoderef(span, ptr_to_Foo)  => [*const Foo]
  /// fcx.autoderef(span, ptr_to_Foo).include_raw_ptrs() => [*const Foo, Foo]
  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:233 include_raw_pointers
  include_raw_pointers(): Autoderef {
    this.include_raw_pointers_ = true;
    return this;
  }

  /// Use `core::ops::Receiver` and `core::ops::Receiver::Target` as
  /// the trait and associated type to iterate, instead of
  /// `core::ops::Deref` and `core::ops::Deref::Target`
  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:241 use_receiver_trait
  use_receiver_trait(): Autoderef {
    this.use_receiver_trait_ = true;
    return this;
  }

  // rustc: compiler/rustc_hir_analysis/src/autoderef.rs:246 silence_errors
  silence_errors(): Autoderef {
    this.silence_errors_ = true;
    return this;
  }
}

// rustc: compiler/rustc_hir_analysis/src/autoderef.rs:252 report_autoderef_recursion_limit_error
export function report_autoderef_recursion_limit_error(tcx: TyCtxt, span: Span, ty: Ty): ErrorGuaranteed {
  // We've reached the recursion limit, error gracefully.
  const limit = tcx.recursion_limit();
  const suggested_limit = limit._0 === 0 ? Limit.new(2) : Limit_mul(limit, 2);
  return tcx.dcx().emit_err(
    AutoDerefReachedRecursionLimit_diagnostic({
      span,
      ty,
      suggested_limit,
      crate_name: tcx.crate_name(LOCAL_CRATE),
    }),
  );
}

// ==== helpers ==========================================================================================================

/** `TypeVisitable for TraitRef` (generated) as a D4 descriptor (`Binder::dummy` only visits). */
const d_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };

/** `Upcast<TyCtxt, P>` descriptors are typed over `Interner` (precedent: rustc_infer opaque_types/mod.ts). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

// ==== Stand-ins (PORT: lane trait-sel-traits-a; see the file header) ===================================================

/** `ObligationCtxt<'_, 'tcx, ScrubbedTraitError>` (rustc_trait_selection traits/engine.rs): the members this file calls. */
interface ObligationCtxt {
  normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): T;
  try_evaluate_obligations(): TraitErrors<unknown>;
  into_pending_obligations(): PredicateObligations;
}

/** `ObligationCtxt::new` (rustc_trait_selection traits/engine.rs:162, lane trait-sel-traits-a). */
function ObligationCtxt_new(_infcx: InferCtxt): ObligationCtxt {
  return unported("rustc_trait_selection::traits::ObligationCtxt::new");
}
