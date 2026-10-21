//! # Type Coercion
//!
//! Under certain circumstances we will coerce from one type to another,
//! for example by auto-borrowing. This occurs in situations where the
//! compiler has a firm 'expected type' that was supplied from the user,
//! and where the actual type is similar to that expected type in purpose
//! but not in representation (so actual subtyping is inappropriate).
//!
//! ## Reborrowing
//!
//! Note that if we are expecting a reference, we will *reborrow*
//! even if the argument provided was already a reference. This is
//! useful for freezing mut things (that is, when the expected type is &T
//! but you have &mut T) and also for avoiding the linearity
//! of mut things (when the expected is &mut T and you have &mut T). See
//! the various `tests/ui/coerce/*.rs` tests for
//! examples of where this is useful.
//!
//! ## Subtle note
//!
//! When inferring the generic arguments of functions, the argument
//! order is relevant, which can lead to the following edge case:
//!
//! ```ignore (illustrative)
//! fn foo<T>(a: T, b: T) {
//!     // ...
//! }
//!
//! foo(&7i32, &mut 7i32);
//! // This compiles, as we first infer `T` to be `&i32`,
//! // and then coerce `&mut 7i32` to `&7i32`.
//!
//! foo(&mut 7i32, &7i32);
//! // This does not compile, as we first infer `T` to be `&mut i32`
//! // and are then unable to coerce `&7i32` to `&mut i32`.
//! ```
// Port of compiler/rustc_hir_typeck/src/coercion.rs (lane typeck-coerce).
//
// - `Coerce` is generated (coercion.gen.ts); its methods are assigned onto `Coerce.prototype` here (declared in
//   decls.ts). `impl Deref for Coerce { type Target = FnCtxt }` is the field `fcx` plus the forwarders `register_deref`
//   installs: inside a `Coerce` method `self.tcx` / `self.param_env` / `self.commit_if_ok(..)` are `this.tcx` / ...
//   Coerce's own field `cause` shadows FnCtxt's method `cause(..)`, so `self.cause(span, code)` is
//   `this.fcx.cause(span, code)`.
// - `CoerceMany` is a hand class (field `expected_ty_`, see the class comment); `CoerceVisitor` is a hand class
//   implementing `ProofTreeVisitor`.
// - `debug!` / `#[instrument]` are tracing only and stay as comments; `debug_assert!` is a comment (PORTING §3).
// - `commit_if_ok(|_| ..)` / `probe(|_| ..)` take a closure that ignores the snapshot argument.
// - `coerce_unsized_old_solver` uses the old solver's `SelectionContext` (traits/select/mod.ts; its `select` is filled by
//   the wave-18b old-solver lanes).
// - `self.err_ctxt()` is rustc_trait_selection's `TypeErrCtxt` (errctxt-contract; its methods are placeholders until wave 19).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./coercion.gen.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FnCtxt, register_deref, TypeckRootCtxt } from "./decls.ts";
import { Coerce } from "./coercion.gen.ts";
import { ControlFlow, VisitorResult, type ControlFlow as ControlFlowT } from "../rustc_ast_ir/visit.ts";
import { Mutability_cmp, Mutability as MutabilityC, type Mutability, type Pinnedness } from "../rustc_ast_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { type Diag, E0069, type ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { struct_span_code_err } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId_eq, type HirId } from "../rustc_hir_id/lib.ts";
import { ToTrace_PolyFnSig, ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { InferOk, type InferResult } from "../rustc_infer/infer/mod.ts";
import { Obligation, type PredicateObligation, type PredicateObligations, TraitErrors } from "../rustc_infer/traits/mod.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { clone_ObligationCause, ImplSource, ObligationCause, type SelectionError } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import { Adjust, type Adjustment, AutoBorrowMutability, DerefAdjustKind, PointerCoercion, type AllowTwoPhase } from "../rustc_middle/ty/adjustment.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause, Predicate, Region } from "../rustc_middle/ty/decls.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { type ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import {
  Predicate_upcast_from_Binder_ClauseKind,
  Predicate_upcast_from_Binder_PredicateKind,
  Predicate_upcast_from_PolyTraitRef,
  Predicate_upcast_from_TraitRef,
} from "../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { PLAIN } from "../std/fmt.ts";
import { DefId_eq, type DefId, type LocalDefId } from "../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import type { InspectGoal, InspectConfig, ProofTreeVisitor } from "../rustc_trait_selection/solve/inspect/analyse.ts";
import { ProofTreeVisitor_provided } from "../rustc_trait_selection/solve/inspect/analyse.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { SelectionContext } from "../rustc_trait_selection/traits/select/mod.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { RelateResult } from "../rustc_type_ir/decls.ts";
import { ExpectedFound, TypeError } from "../rustc_type_ir/error.ts";
import { fold_tuple2, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import { visit_with_PredicateKind, type ClauseKind, type PredicateKind } from "../rustc_type_ir/predicate_kind.ts";
import {
  as_interner,
  fold_with_TraitClause,
  ProjectionClause,
  PolyTraitClause,
  TraitClause,
  TraitRef,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../rustc_type_ir/predicate.ts";
import { Goal } from "../rustc_type_ir/solve/mod.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { fold_FnSig, FnHeader, FnSig, PolyFnSig, PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import type { TyKind as TyKindT, TyVid } from "../rustc_type_ir/ty_kind.gen.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable } from "../rustc_type_ir/visit.ts";
import type { CoerceMaybePinnedRef, CoerceResult, ForceLeakCheck } from "./coercion.gen.ts";
import { SuggestBoxingForReturnImplTrait_subdiagnostic } from "./diagnostics.gen.ts";

type PolyFnSigT = Binder<FnSig>;

// ---- local descriptors / views ---------------------------------------------------------------------------------------

const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };
const d_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};
const fold_PolyFnSig = (): TypeFoldable<PolyFnSigT> => fold_Binder(fold_FnSig);

/** `Obligation::new`'s `Upcast` from a `TyCtxt` upcast fn (the interner is the `TyCtxt`). */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return (from, tcx) => f(from, tcx as unknown as TyCtxt);
}



// coercion.rs:92 `impl Deref for Coerce { type Target = FnCtxt }` (`&self.fcx`): forwarders installed by lib.ts (decls.ts `register_deref`).
register_deref(Coerce, "fcx", FnCtxt);

// impl<'a, 'tcx> Deref for Coerce<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:92 deref
Coerce.prototype.deref = function (this: Coerce): FnCtxt {
  return this.fcx;
};

/// Coercing a mutable reference to an immutable works, while
/// coercing `&T` to `&mut T` should be forbidden.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:101 coerce_mutbls
export function coerce_mutbls(from_mutbl: Mutability, to_mutbl: Mutability): RelateResult<null> {
  if (Mutability_cmp(from_mutbl, to_mutbl) >= 0) {
    return Ok(null);
  } else {
    return Err(TypeError.Mutability);
  }
}

/// This always returns `Ok(...)`.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:109 success
export function success(adj: Adjustment[], target: Ty, obligations: PredicateObligations): CoerceResult {
  return Ok(new InferOk<[Adjustment[], Ty]>([adj, target], obligations));
}

// impl<'f, 'tcx> Coerce<'f, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:149 new
(Coerce as unknown as { new: typeof Coerce.new }).new = function (
  fcx: FnCtxt,
  cause: ObligationCause,
  allow_two_phase: AllowTwoPhase,
  coerce_never: boolean,
): Coerce {
  return new Coerce(fcx, cause, /* use_lub */ false, allow_two_phase, coerce_never);
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:158 unify_raw
Coerce.prototype.unify_raw = function (this: Coerce, a: Ty, b: Ty, leak_check: ForceLeakCheck): InferResult<Ty> {
  // debug!("unify(a: {:?}, b: {:?}, use_lub: {})", a, b, self.use_lub);
  return this.commit_if_ok((snapshot): InferResult<Ty> => {
    const outer_universe = this.infcx.universe();

    const at = this.at(this.cause, this.fcx.param_env);

    let res: InferResult<Ty>;
    if (this.use_lub) {
      res = at.lub(b, a, ToTrace_Ty);
    } else {
      const r = at.sup("Yes", b, a, ToTrace_Ty);
      res = r.$ === "Ok" ? Ok(new InferOk(b, r._0.obligations)) : r;
    }

    // In the new solver, lazy norm may allow us to shallowly equate
    // more types, but we emit possibly impossible-to-satisfy obligations.
    // Filter these cases out to make sure our coercion is more accurate.
    if (res.$ === "Ok" && this.next_trait_solver()) {
      const { value, obligations } = res._0;
      const ocx = ObligationCtxt.new(this.infcx);
      ocx.register_obligations(obligations);
      if (TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
        res = Ok(new InferOk(value, ocx.into_pending_obligations()));
      } else {
        res = Err(TypeError.Mismatch);
      }
    }

    // We leak check here mostly because lub operations are
    // kind of scuffed around binders. Instead of computing an actual
    // lub'd binder we instead:
    // - Equate the binders
    // - Return the lhs of the lub operation
    //
    // This may lead to incomplete type inference for the resulting type
    // of a `match` or `if .. else`, etc. This is a backwards compat
    // hazard for if/when we start handling `lub` more correctly.
    //
    // In order to actually ensure that equating the binders *does*
    // result in equal binders, and that the lhs is actually a supertype
    // of the rhs, we must perform a leak check here.
    if (leak_check === "Yes") {
      const lc = this.leak_check(outer_universe, snapshot);
      if (lc.$ === "Err") return lc;
    }

    return res;
  });
};

/// Unify two types (using sub or lub).
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:215 unify
Coerce.prototype.unify = function (this: Coerce, a: Ty, b: Ty, leak_check: ForceLeakCheck): CoerceResult {
  const r = this.unify_raw(a, b, leak_check);
  if (r.$ === "Err") return r;
  const { value: ty, obligations } = r._0;
  return success([], ty, obligations);
};

/// Unify two types (using sub or lub) and produce a specific coercion.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:221 unify_and
Coerce.prototype.unify_and = function (
  this: Coerce,
  a: Ty,
  b: Ty,
  adjustments: Iterable<Adjustment>,
  final_adjustment: Adjust,
  leak_check: ForceLeakCheck,
): CoerceResult {
  const r = this.unify_raw(a, b, leak_check);
  if (r.$ === "Err") return r;
  const { value: ty, obligations } = r._0;
  return success([...adjustments, { target: ty, kind: final_adjustment }], ty, obligations);
};

// #[instrument(skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:242 coerce
Coerce.prototype.coerce = function (this: Coerce, a0: Ty, b0: Ty): CoerceResult {
  // First, remove any resolved type variables (at the top level, at least):
  const a = this.shallow_resolve(a0);
  const b = this.shallow_resolve(b0);
  // debug!("Coerce.tys({:?} => {:?})", a, b);

  // Coercing from `!` to any type is allowed:
  if (a.is_never()) {
    if (this.coerce_never) {
      return success([{ kind: Adjust.NeverToAny, target: b }], b, []);
    } else {
      // Otherwise the only coercion we can do is unification.
      return this.unify(a, b, "No");
    }
  }

  // Coercing *from* an unresolved inference variable means that
  // we have no information about the source type. This will always
  // ultimately fall back to some form of subtyping.
  if (a.is_ty_var()) {
    return this.coerce_from_inference_variable(a, b);
  }

  // Consider coercing the subtype to a DST
  //
  // NOTE: this is wrapped in a `commit_if_ok` because it creates
  // a "spurious" type variable, and we don't want to have that
  // type variable in memory if the coercion fails.
  const unsize = this.commit_if_ok((_) => this.coerce_unsized(a, b));
  switch (unsize.$) {
    case "Ok": {
      // debug!("coerce: unsize successful");
      return unsize;
    }
    case "Err": {
      // debug!(?error, "coerce: unsize failed");
      break;
    }
  }

  // Examine the target type and consider type-specific coercions, such
  // as auto-borrowing, coercing pointer mutability, pin-ergonomics, or
  // generic reborrow.
  const bk = b.kind();
  let to_pin_ref: CoerceMaybePinnedRef | undefined;
  if (bk.$ === "RawPtr") {
    const b_mutbl = bk._1;
    return this.coerce_to_raw_ptr(a, b, b_mutbl);
  } else if (bk.$ === "Ref") {
    const [r_b, mutbl_b] = [bk._0, bk._2];
    const pin_ref_to_ref = this.maybe_pin_ref_to_ref(a, b);
    if (pin_ref_to_ref !== undefined) {
      return this.coerce_pin_ref_to_ref(pin_ref_to_ref);
    }
    return this.coerce_to_ref(a, b, r_b, mutbl_b);
  } else if ((to_pin_ref = this.maybe_to_pin_ref(a, b)) !== undefined) {
    return this.coerce_to_pin_ref(to_pin_ref);
  } else if (
    bk.$ === "Adt" &&
    this.tcx.features().reborrow() &&
    EvaluationResult.must_apply_modulo_regions(
      this.fcx.infcx.type_implements_trait(
        unwrap(this.tcx.lang_items().reborrow(), "Unexpectedly using core/std without reborrow"),
        [GenericArg.from_Ty(b)],
        this.fcx.param_env,
      ),
    )
  ) {
    const reborrow_coerce = this.commit_if_ok((_) => this.coerce_reborrow(a, b));
    if (reborrow_coerce.$ === "Ok") {
      return reborrow_coerce;
    }
  } else {
    // _ => {}
  }

  const ak = a.kind();
  switch (ak.$) {
    case "FnDef": {
      // Function items are coercible to any closure
      // type; function pointers are not (that would
      // require double indirection).
      // Additionally, we permit coercion of function
      // items to drop the unsafe qualifier.
      return this.coerce_from_fn_item(a, b);
    }
    case "FnPtr": {
      const [a_sig_tys, a_hdr] = [ak._0, ak._1];
      // We permit coercion of fn pointers to drop the
      // unsafe qualifier.
      return this.coerce_from_fn_pointer(a, PolyFnSigTys.with(a_sig_tys, a_hdr), b);
    }
    case "Closure": {
      // Non-capturing closures are coercible to
      // function pointers or unsafe function pointers.
      // It cannot convert closures that require unsafe.
      return this.coerce_closure_to_fn(a, b);
    }
    default:
      break;
  }
  if (ak.$ === "Adt" && this.tcx.features().reborrow()) {
    const reborrow_coerce = this.commit_if_ok((_) => this.coerce_shared_reborrow(a, b));
    if (reborrow_coerce.$ === "Ok") {
      return reborrow_coerce;
    } else {
      return this.unify(a, b, "No");
    }
  }
  // Otherwise, just use unification rules.
  return this.unify(a, b, "No");
};

/// Coercing *from* an inference variable. In this case, we have no information
/// about the source type, so we can't really do a true coercion and we always
/// fall back to subtyping (`unify_and`).
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:362 coerce_from_inference_variable
Coerce.prototype.coerce_from_inference_variable = function (this: Coerce, a: Ty, b: Ty): CoerceResult {
  // debug!("coerce_from_inference_variable(a={:?}, b={:?})", a, b);
  // debug_assert!(a.is_ty_var() && self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  if (b.is_ty_var()) {
    const obligations: PredicateObligations = [];
    const push_coerce_obligation = (a: Ty, b: Ty): void => {
      obligations.push(
        Obligation.new(
          this.tcx,
          clone_ObligationCause(this.cause),
          this.param_env,
          Binder.dummy<PredicateKind>({ $: "Coerce", _0: { a, b } }, d_PredicateKind),
          upcast_tcx(Predicate_upcast_from_Binder_PredicateKind),
        ),
      );
    };

    let target_ty: Ty;
    if (this.use_lub) {
      // When computing the lub, we create a new target
      // and coerce both `a` and `b` to it.
      const target_ty_ = this.next_ty_var(this.cause.span);
      push_coerce_obligation(a, target_ty_);
      push_coerce_obligation(b, target_ty_);
      target_ty = target_ty_;
    } else {
      // When subtyping, we don't need to create a new target
      // as we only coerce `a` to `b`.
      push_coerce_obligation(a, b);
      target_ty = b;
    }

    // debug!(
    //     "coerce_from_inference_variable: two inference variables, target_ty={:?}, obligations={:?}",
    //     target_ty, obligations
    // );
    return success([], target_ty, obligations);
  } else {
    // One unresolved type variable: just apply subtyping, we may be able
    // to do something useful.
    return this.unify(a, b, "No");
  }
};

/// Handles coercing some arbitrary type `a` to some reference (`b`). This
/// handles a few cases:
/// - Introducing reborrows to give more flexible lifetimes
/// - Deref coercions to allow `&T` to coerce to `&T::Target`
/// - Coercing mutable references to immutable references
/// These coercions can be freely intermixed, for example we are able to
/// coerce `&mut T` to `&mut T::Target`.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:411 coerce_to_ref
Coerce.prototype.coerce_to_ref = function (this: Coerce, a: Ty, b: Ty, r_b: Region, mutbl_b: Mutability): CoerceResult {
  // debug!("coerce_to_ref(a={:?}, b={:?})", a, b);
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  let r_a: Region;
  let mt_a: { ty: Ty; mutbl: Mutability };
  const ak = a.kind();
  if (ak.$ === "Ref") {
    const [r_a_, ty, mutbl] = [ak._0, ak._1, ak._2];
    const m = coerce_mutbls(mutbl, mutbl_b);
    if (m.$ === "Err") return m;
    [r_a, mt_a] = [r_a_, { ty, mutbl }];
  } else {
    return this.unify(a, b, "No");
  }

  // Look at each step in the `Deref` chain and check if
  // any of the autoref'd `Target` types unify with the
  // coercion target.
  //
  // For example when coercing from `&mut Vec<T>` to `&M [T]` we
  // have three deref steps:
  // 1. `&mut Vec<T>`, skip autoref
  // 2. `Vec<T>`, autoref'd ty: `&M Vec<T>`
  //     - `&M Vec<T>` does not unify with `&M [T]`
  // 3. `[T]`, autoref'd ty: `&M [T]`
  //     - `&M [T]` does unify with `&M [T]`
  let first_error: TypeError | undefined = undefined;
  let r_borrow_var: Region | undefined = undefined;
  const autoderef = this.autoderef(this.cause.span, a);
  // `autoderef.by_ref().find_map(|(deref_ty, autoderefs)| { .. })`
  let found: InferOk<Ty> | undefined = undefined;
  for (let step = autoderef.next(); step !== undefined; step = autoderef.next()) {
    const [deref_ty, autoderefs] = step;
    if (autoderefs === 0) {
      // Don't autoref the first step as otherwise we'd allow
      // coercing `&T` to `&&T`.
      continue;
    }

    // The logic here really shouldn't exist. We don't care about free
    // lifetimes during HIR typeck. Unfortunately later parts of this
    // function rely on structural identity of the autoref'd deref'd ty.
    //
    // This means that what region we use here actually impacts whether
    // we emit a reborrow coercion or not which can affect diagnostics
    // and capture analysis (which in turn affects borrowck).
    let r: Region;
    if (!this.use_lub) {
      r = r_b;
    } else if (autoderefs === 1) {
      r = r_a;
    } else {
      if (r_borrow_var === undefined) {
        // create var lazily, at most once
        const coercion = { $: "Coercion" as const, _0: this.cause.span };
        const r_ = this.next_region_var(coercion);
        r_borrow_var = r_;
      }
      r = r_borrow_var;
    }

    const autorefd_deref_ty = Ty.new_ref(this.tcx, r, deref_ty, mutbl_b);

    // Note that we unify the autoref'd `Target` type with `b` rather than
    // the `Target` type with the pointee of `b`. This is necessary
    // to properly account for the differing variances of the pointees
    // of `&` vs `&mut` references.
    const u = this.unify_raw(autorefd_deref_ty, b, "No");
    if (u.$ === "Ok") {
      found = u._0;
      break;
    } else {
      if (first_error === undefined) {
        first_error = u._0;
      }
    }
  }

  // Extract type or return an error. We return the first error
  // we got, which should be from relating the "base" type
  // (e.g., in example above, the failure from relating `Vec<T>`
  // to the target type), since that should be the least
  // confusing.
  if (found === undefined) {
    if (first_error !== undefined) {
      // debug!("coerce_to_ref: failed with err = {:?}", first_error);
      return Err(first_error);
    } else {
      // This may happen in the new trait solver since autoderef requires
      // the pointee to be structurally normalizable, or else it'll just bail.
      // So when we have a type like `&<not well formed>`, then we get no
      // autoderef steps (even though there should be at least one). That means
      // we get no type mismatches, since the loop above just exits early.
      return Err(TypeError.Mismatch);
    }
  }
  const { value: coerced_a } = found;
  const obligations = found.obligations;

  if (coerced_a === a && MutabilityC.is_not(mt_a.mutbl) && autoderef.step_count() === 1) {
    // As a special case, if we would produce `&'a *x`, that's
    // a total no-op. We end up with the type `&'a T` just as
    // we started with. In that case, just skip it altogether.
    //
    // Unfortunately, this can actually effect capture analysis
    // which in turn means this effects borrow checking. This can
    // also effect diagnostics.
    // FIXME(BoxyUwU): we should always emit reborrow coercions
    //
    // Note that for `&mut`, we DO want to reborrow --
    // otherwise, this would be a move, which might be an
    // error. For example `foo(self.x)` where `self` and
    // `self.x` both have `&mut `type would be a move of
    // `self.x`, but we auto-coerce it to `foo(&mut *self.x)`,
    // which is a borrow.
    assert(MutabilityC.is_not(mutbl_b), "assertion failed: mutbl_b.is_not()"); // can only coerce &T -> &U
    return success([], coerced_a, obligations);
  }

  const { value: adjustments, obligations: o } = this.adjust_steps_as_infer_ok(autoderef);
  obligations.push(...o);
  obligations.push(...autoderef.into_obligations());

  if (coerced_a.kind().$ !== "Ref") {
    panic(`expected a ref type, got ${debug_Ty(coerced_a, PLAIN)}`);
  }

  // Now apply the autoref
  const mutbl = AutoBorrowMutability.new(mutbl_b, this.allow_two_phase);
  adjustments.push({ kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } }, target: coerced_a });

  // debug!("coerce_to_ref: succeeded coerced_a={:?} adjustments={:?}", coerced_a, adjustments);

  return success(adjustments, coerced_a, obligations);
};

/// Performs [unsized coercion] by emulating a fulfillment loop on a
/// `CoerceUnsized` goal until all `CoerceUnsized` and `Unsize` goals
/// are successfully selected.
///
/// [unsized coercion](https://doc.rust-lang.org/reference/type-coercions.html#unsized-coercions)
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:555 coerce_unsized
Coerce.prototype.coerce_unsized = function (this: Coerce, source: Ty, target: Ty): CoerceResult {
  // debug!(?source, ?target);
  // debug_assert!(self.shallow_resolve(source) == source);
  // debug_assert!(self.shallow_resolve(target) == target);

  // We don't apply any coercions incase either the source or target
  // aren't sufficiently well known but tend to instead just equate
  // them both.
  if (source.is_ty_var()) {
    // debug!("coerce_unsized: source is a TyVar, bailing out");
    return Err(TypeError.Mismatch);
  }
  if (target.is_ty_var()) {
    // debug!("coerce_unsized: target is a TyVar, bailing out");
    return Err(TypeError.Mismatch);
  }

  // This is an optimization because coercion is one of the most common
  // operations that we do in typeck, since it happens at every assignment
  // and call arg (among other positions).
  //
  // These targets are known to never be RHS in `LHS: CoerceUnsized<RHS>`.
  // That's because these are built-in types for which a core-provided impl
  // doesn't exist, and for which a user-written impl is invalid.
  //
  // This is technically incomplete when users write impossible bounds like
  // `where T: CoerceUnsized<usize>`, for example, but that trait is unstable
  // and coercion is allowed to be incomplete. The only case where this matters
  // is impossible bounds.
  //
  // Note that some of these types implement `LHS: Unsize<RHS>`, but they
  // do not implement *`CoerceUnsized`* which is the root obligation of the
  // check below.
  const tk = target.kind();
  switch (tk.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "Array":
    case "Slice":
    case "FnDef":
    case "FnPtr":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
      return Err(TypeError.Mismatch);
    case "Infer":
      if (tk._0.$ === "IntVar" || tk._0.$ === "FloatVar") return Err(TypeError.Mismatch);
      break;
    default:
      break;
  }
  // `&str: CoerceUnsized<&str>` does not hold but is encountered frequently
  // so we fast path bail out here
  {
    const sk = source.kind();
    if (sk.$ === "Ref" && sk._2 === "Not" && sk._1.is_str()) {
      if (tk.$ === "Ref" && tk._2 === "Not" && tk._1.is_str()) {
        return Err(TypeError.Mismatch);
      }
    }
  }

  const traits: [DefId | undefined, DefId | undefined] = [this.tcx.lang_items().unsize_trait(), this.tcx.lang_items().coerce_unsized_trait()];
  const [unsize_did, coerce_unsized_did] = traits;
  if (unsize_did === undefined || coerce_unsized_did === undefined) {
    // debug!("missing Unsize or CoerceUnsized traits");
    return Err(TypeError.Mismatch);
  }

  // Note, we want to avoid unnecessary unsizing. We don't want to coerce to
  // a DST unless we have to. This currently comes out in the wash since
  // we can't unify [T] with U. But to properly support DST, we need to allow
  // that, at which point we will need extra checks on the target here.

  // Handle reborrows before selecting `Source: CoerceUnsized<Target>`.
  let reborrow: [Adjustment, Adjustment] | undefined;
  {
    const sk = source.kind();
    if (sk.$ === "Ref" && tk.$ === "Ref") {
      const [ty_a, mutbl_a] = [sk._1, sk._2];
      const mutbl_b = tk._2;
      const m = coerce_mutbls(mutbl_a, mutbl_b);
      if (m.$ === "Err") return m;

      const coercion = { $: "Coercion" as const, _0: this.cause.span };
      const r_borrow = this.next_region_var(coercion);

      // We don't allow two-phase borrows here, at least for initial
      // implementation. If it happens that this coercion is a function argument,
      // the reborrow in coerce_borrowed_ptr will pick it up.
      const mutbl = AutoBorrowMutability.new(mutbl_b, "No");

      reborrow = [
        { kind: { $: "Deref", _0: DerefAdjustKind.Builtin }, target: ty_a },
        {
          kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } },
          target: Ty.new_ref(this.tcx, r_borrow, ty_a, mutbl_b),
        },
      ];
    } else if (sk.$ === "Ref" && tk.$ === "RawPtr") {
      const [ty_a, mt_a] = [sk._1, sk._2];
      const mt_b = tk._1;
      const m = coerce_mutbls(mt_a, mt_b);
      if (m.$ === "Err") return m;

      reborrow = [
        { kind: { $: "Deref", _0: DerefAdjustKind.Builtin }, target: ty_a },
        {
          kind: { $: "Borrow", _0: { $: "RawPtr", _0: mt_b } },
          target: Ty.new_ptr(this.tcx, ty_a, mt_b),
        },
      ];
    } else {
      reborrow = undefined;
    }
  }
  const coerce_source = reborrow === undefined ? source : reborrow[1].target;

  // Setup either a subtyping or a LUB relationship between
  // the `CoerceUnsized` target type and the expected type.
  // We only have the latter, so we use an inference variable
  // for the former and let type inference do the rest.
  const coerce_target = this.next_ty_var(this.cause.span);

  const c = this.unify_and(
    coerce_target,
    target,
    reborrow === undefined ? [] : [reborrow[0], reborrow[1]],
    { $: "Pointer", _0: PointerCoercion.Unsize },
    "No",
  );
  if (c.$ === "Err") return c;
  const coercion = c._0;

  // Create an obligation for `Source: CoerceUnsized<Target>`.
  const cause = this.fcx.cause(this.cause.span, { $: "Coercion", source, target });
  const pred = TraitRef.new(as_interner(this.tcx), coerce_unsized_did, [GenericArg.from_Ty(coerce_source), GenericArg.from_Ty(coerce_target)]);
  const obligation: PredicateObligation = Obligation.new(this.tcx, cause, this.fcx.param_env, pred, upcast_tcx(Predicate_upcast_from_TraitRef));

  if (this.next_trait_solver()) {
    coercion.obligations.push(obligation);

    if (
      this.infcx.visit_proof_tree(
        Goal.new(as_interner(this.tcx), this.param_env, pred, upcast_tcx(Predicate_upcast_from_TraitRef)),
        new CoerceVisitor(this.fcx, this.cause.span, false),
      ).$ === "Break"
    ) {
      return Err(TypeError.Mismatch);
    }
  } else {
    const r = this.coerce_unsized_old_solver(obligation, coercion, coerce_unsized_did, unsize_did);
    if (r.$ === "Err") return r;
  }

  return Ok(coercion);
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:711 coerce_unsized_old_solver
Coerce.prototype.coerce_unsized_old_solver = function (
  this: Coerce,
  obligation: Obligation<Predicate>,
  coercion: InferOk<[Adjustment[], Ty]>,
  coerce_unsized_did: DefId,
  unsize_did: DefId,
): Result<undefined, TypeError> {
  // PORT: `traits::SelectionContext::new(self)`: `&InferCtxt` is the deref coercion of `self`.
  const selcx = SelectionContext.new(this.infcx);
  // Use a FIFO queue for this custom fulfillment procedure.
  //
  // A Vec (or SmallVec) is not a natural choice for a queue. However,
  // this code path is hot, and this queue usually has a max length of 1
  // and almost never more than 3. By using a SmallVec we avoid an
  // allocation, at the (very small) cost of (occasionally) having to
  // shift subsequent elements down when removing the front element.
  const queue: PredicateObligation[] = [obligation];

  // Keep resolving `CoerceUnsized` and `Unsize` predicates to avoid
  // emitting a coercion in cases like `Foo<$1>` -> `Foo<$2>`, where
  // inference might unify those two inner type variables later.
  const traits = [coerce_unsized_did, unsize_did];
  while (queue.length !== 0) {
    const obligation = queue.shift()!;
    let trait_pred: TraitClause;
    const k = Binder.no_bound_vars(obligation.predicate.kind(), d_PredicateKind);
    if (k !== undefined && k.$ === "Clause" && k._0.$ === "Trait" && traits.some((t) => DefId_eq(t, TraitClause.def_id((k._0 as { _0: TraitClause })._0)))) {
      trait_pred = this.deeply_resolve_ignoring_regions(k._0._0, d_TraitClause);
    } else {
      coercion.obligations.push(obligation);
      continue;
    }
    // debug!("coerce_unsized resolve step: {:?}", trait_pred);
    const sel = selcx.select(obligation.with(selcx.tcx(), trait_pred, (p: TraitClause) => p));
    if (sel.$ === "Ok" && sel._0 === undefined) {
      // Uncertain or unimplemented.
      if (DefId_eq(TraitClause.def_id(trait_pred), unsize_did)) {
        const self_ty = TraitClause.self_ty(trait_pred);
        const unsize_ty = GenericArg.expect_ty(trait_pred.trait_ref.args[1]!);
        // debug!("coerce_unsized: ambiguous unsize case for {:?}", trait_pred);
        const sk = self_ty.kind();
        if (sk.$ === "Infer" && sk._0.$ === "TyVar" && unsize_ty.kind().$ === "Dynamic" && this.type_var_is_sized(sk._0._0)) {
          // debug!("coerce_unsized: have sized infer {:?}", v);
          coercion.obligations.push(obligation);
          // `$0: Unsize<dyn Trait>` where we know that `$0: Sized`, try going
          // for unsizing.
        } else {
          // Some other case for `$0: Unsize<Something>`. Note that we
          // hit this case even if `Something` is a sized type, so just
          // don't do the coercion.
          // debug!("coerce_unsized: ambiguous unsize");
          return Err(TypeError.Mismatch);
        }
      } else {
        // debug!("coerce_unsized: early return - ambiguous");
        return Err(TypeError.Mismatch);
      }
    } else if (sel.$ === "Err" && sel._0.$ === "Unimplemented") {
      // debug!("coerce_unsized: early return - can't prove obligation");
      return Err(TypeError.Mismatch);
    } else if (sel.$ === "Err" && sel._0.$ === "TraitDynIncompatible") {
      // Dyn compatibility errors in coercion will *always* be due to the
      // fact that the RHS of the coercion is a non-dyn compatible `dyn Trait`
      // written in source somewhere (otherwise we will never have lowered
      // the dyn trait from HIR to middle).
      //
      // There's no reason to emit yet another dyn compatibility error,
      // especially since the span will differ slightly and thus not be
      // deduplicated at all!
      this.fcx.set_tainted_by_errors(this.fcx.dcx().span_delayed_bug(this.cause.span, "dyn compatibility during coercion"));
    } else if (sel.$ === "Err") {
      const err = sel._0;
      const guar = this.fcx.err_ctxt().report_selection_error(obligation, obligation, err);
      this.fcx.set_tainted_by_errors(guar);
      // Treat this like an obligation and follow through
      // with the unsizing - the lack of a coercion should
      // be silent, as it causes a type mismatch later.
    } else if (sel._0!.$ === "UserDefined") {
      const impl_source = sel._0!._0 as { impl_def_id: DefId; nested: PredicateObligation[] };
      queue.push(...impl_source.nested);
      // Certain incoherent `CoerceUnsized` implementations may cause ICEs,
      // so check the impl's validity. Taint the body so that we don't try
      // to evaluate these invalid coercions in CTFE. We only need to do this
      // for local impls, since upstream impls should be valid.
      if (impl_source.impl_def_id.is_local()) {
        const r = this.tcx.ensure_result().coerce_unsized_info(impl_source.impl_def_id);
        if (r.$ === "Err") {
          this.fcx.set_tainted_by_errors(r._0);
        }
      }
    } else {
      queue.push(...ImplSource.nested_obligations(sel._0!));
    }
  }

  return Ok(undefined);
};

/// Create an obligation for `ty: Unpin`, where .
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:827 unpin_obligation
Coerce.prototype.unpin_obligation = function (this: Coerce, source: Ty, target: Ty, ty: Ty): PredicateObligation {
  const pred = TraitRef.new(as_interner(this.tcx), this.tcx.require_lang_item(LangItem.Unpin, this.cause.span), [GenericArg.from_Ty(ty)]);
  const cause = this.fcx.cause(this.cause.span, { $: "Coercion", source, target });
  return Obligation.new(this.tcx, cause, this.param_env, pred, upcast_tcx(Predicate_upcast_from_TraitRef));
};

/// Checks if the given types are compatible for coercion from a pinned reference to a normal reference.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:843 maybe_pin_ref_to_ref
Coerce.prototype.maybe_pin_ref_to_ref = function (this: Coerce, a: Ty, b: Ty): CoerceMaybePinnedRef | undefined {
  if (!this.tcx.features().pin_ergonomics()) {
    return undefined;
  }
  const ap = a.maybe_pinned_ref();
  if (ap !== undefined && ap[1] === "Pinned") {
    const [a_ty, a_pin, a_mut, a_r] = ap;
    const bp = b.maybe_pinned_ref();
    if (bp !== undefined && bp[1] === "Not") {
      const [, b_pin, b_mut] = bp;
      return { a, b, a_ty, a_pin, a_mut, a_r, b_pin, b_mut };
    }
  }
  // debug!("not fitting pinned ref to ref coercion (`{:?}` -> `{:?}`)", a, b);
  return undefined;
};

/// Coerces from a pinned reference to a normal reference.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:858 coerce_pin_ref_to_ref
Coerce.prototype.coerce_pin_ref_to_ref = function (this: Coerce, _0: CoerceMaybePinnedRef): CoerceResult {
  const { a: a0, b, a_ty, a_mut, a_r, b_mut } = _0;
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);
  // debug_assert!(self.tcx.features().pin_ergonomics());
  // debug_assert_eq!(a_pin, ty::Pinnedness::Pinned);
  // debug_assert_eq!(b_pin, ty::Pinnedness::Not);

  const m = coerce_mutbls(a_mut, b_mut);
  if (m.$ === "Err") return m;

  const unpin_obligation = this.unpin_obligation(a0, b, a_ty);

  const a = Ty.new_ref(this.tcx, a_r, a_ty, b_mut);
  const c = this.unify_and(
    a,
    b,
    [{ kind: { $: "Deref", _0: DerefAdjustKind.Pin }, target: a_ty }],
    { $: "Borrow", _0: { $: "Ref", _0: AutoBorrowMutability.new(b_mut, this.allow_two_phase) } },
    "No",
  );
  if (c.$ === "Err") return c;
  const coerce = c._0;
  coerce.obligations.push(unpin_obligation);
  return Ok(coerce);
};

/// Checks if the given types are compatible for coercion to a pinned reference.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:887 maybe_to_pin_ref
Coerce.prototype.maybe_to_pin_ref = function (this: Coerce, a: Ty, b: Ty): CoerceMaybePinnedRef | undefined {
  if (!this.tcx.features().pin_ergonomics()) {
    return undefined;
  }
  const ap = a.maybe_pinned_ref();
  if (ap !== undefined) {
    const [a_ty, a_pin, a_mut, a_r] = ap;
    const bp = b.maybe_pinned_ref();
    if (bp !== undefined && bp[1] === "Pinned") {
      const [, b_pin, b_mut] = bp;
      return { a, b, a_ty, a_pin, a_mut, a_r, b_pin, b_mut };
    }
  }
  // debug!("not fitting ref to pinned ref coercion (`{:?}` -> `{:?}`)", a, b);
  return undefined;
};

/// Applies reborrowing and auto-borrowing that results to `Pin<&T>` or `Pin<&mut T>`:
///
/// Currently we only support the following coercions:
/// - Reborrowing `Pin<&mut T>` -> `Pin<&mut T>`
/// - Reborrowing `Pin<&T>` -> `Pin<&T>`
/// - Auto-borrowing `&mut T` -> `Pin<&mut T>` where `T: Unpin`
/// - Auto-borrowing `&mut T` -> `Pin<&T>` where `T: Unpin`
/// - Auto-borrowing `&T` -> `Pin<&T>` where `T: Unpin`
///
/// In the future we might want to support other reborrowing coercions, such as:
/// - `Pin<Box<T>>` as `Pin<&T>`
/// - `Pin<Box<T>>` as `Pin<&mut T>`
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:913 coerce_to_pin_ref
Coerce.prototype.coerce_to_pin_ref = function (this: Coerce, _0: CoerceMaybePinnedRef): CoerceResult {
  const { a: a0, b, a_ty, a_pin, a_mut, a_r, b_mut } = _0;
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);
  // debug_assert!(self.tcx.features().pin_ergonomics());
  // debug_assert_eq!(b_pin, ty::Pinnedness::Pinned);

  // We need to deref the reference first before we reborrow it to a pinned reference.
  let deref: DerefAdjustKind;
  let unpin_obligation: PredicateObligation | undefined;
  switch (a_pin satisfies Pinnedness) {
    // no `Unpin` required when reborrowing a pinned reference to a pinned reference
    case "Pinned":
      [deref, unpin_obligation] = [DerefAdjustKind.Pin, undefined];
      break;
    // `Unpin` required when reborrowing a non-pinned reference to a pinned reference
    case "Not":
      [deref, unpin_obligation] = [DerefAdjustKind.Builtin, this.unpin_obligation(a0, b, a_ty)];
      break;
  }

  const m = coerce_mutbls(a_mut, b_mut);
  if (m.$ === "Err") return m;

  // update a with b's mutability since we'll be coercing mutability
  const a = Ty.new_pinned_ref(this.tcx, a_r, a_ty, b_mut);

  // To complete the reborrow, we need to make sure we can unify the inner types, and if so we
  // add the adjustments.
  const c = this.unify_and(a, b, [{ kind: { $: "Deref", _0: deref }, target: a_ty }], { $: "Borrow", _0: { $: "Pin", _0: b_mut } }, "No");
  if (c.$ === "Err") return c;
  const coerce = c._0;

  if (unpin_obligation !== undefined) coerce.obligations.push(unpin_obligation);
  return Ok(coerce);
};

/// Applies generic exclusive reborrowing on type implementing `Reborrow`.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:955 coerce_reborrow
Coerce.prototype.coerce_reborrow = function (this: Coerce, a: Ty, b: Ty): CoerceResult {
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  // We need to make sure the two types are compatible for reborrow.
  const [ak, bk] = [a.kind(), b.kind()];
  if (!(ak.$ === "Adt" && bk.$ === "Adt")) {
    return Err(TypeError.Mismatch);
  }
  const [a_def, b_def] = [ak._0, bk._0];
  if (DefId_eq(a_def.did(), b_def.did())) {
    // Reborrow is applicable here
    return this.unify_and(a, b, [], { $: "GenericReborrow", _0: "Mut" }, "No");
  } else {
    // FIXME: CoerceShared check goes here, error for now
    return Err(TypeError.Mismatch);
  }
};

/// Applies generic exclusive reborrowing on type implementing `Reborrow`.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:980 coerce_shared_reborrow
Coerce.prototype.coerce_shared_reborrow = function (this: Coerce, a: Ty, b: Ty): CoerceResult {
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  // We need to make sure the two types are compatible for reborrow.
  const [ak, bk] = [a.kind(), b.kind()];
  if (!(ak.$ === "Adt" && bk.$ === "Adt")) {
    return Err(TypeError.Mismatch);
  }
  const [a_def, b_def] = [ak._0, bk._0];
  if (DefId_eq(a_def.did(), b_def.did())) {
    // CoerceShared cannot be T -> T.
    return Err(TypeError.Mismatch);
  }
  const coerce_shared_trait_did = this.tcx.lang_items().coerce_shared();
  if (coerce_shared_trait_did === undefined) {
    return Err(TypeError.Mismatch);
  }
  const coerce_shared_trait_ref = TraitRef.new(as_interner(this.tcx), coerce_shared_trait_did, [GenericArg.from_Ty(a), GenericArg.from_Ty(b)]);
  const obligation: PredicateObligation = Obligation.new(
    this.tcx,
    ObligationCause.dummy(),
    this.param_env,
    Binder.dummy(coerce_shared_trait_ref, d_TraitRef),
    upcast_tcx(Predicate_upcast_from_PolyTraitRef),
  );
  const ocx = ObligationCtxt.new(this.infcx);
  ocx.register_obligation(obligation);
  const errs = ocx.evaluate_obligations_error_on_ambiguity();
  if (TraitErrors.no_errors(errs)) {
    return Ok(new InferOk<[Adjustment[], Ty]>([[{ kind: { $: "GenericReborrow", _0: "Not" }, target: b }], b], ocx.into_pending_obligations()));
  } else {
    return Err(TypeError.Mismatch);
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1021 coerce_from_fn_pointer
Coerce.prototype.coerce_from_fn_pointer = function (this: Coerce, a: Ty, a_sig: PolyFnSigT, b: Ty): CoerceResult {
  // debug!(?a_sig, ?b, "coerce_from_fn_pointer");
  // debug_assert!(self.shallow_resolve(b) == b);

  const bk = b.kind();
  if (bk.$ === "FnPtr" && hir.Safety.is_safe(PolyFnSig.safety(a_sig)) && hir.Safety.is_unsafe(FnHeader.safety(bk._1))) {
    const a = this.tcx.safe_to_unsafe_fn_ty(a_sig);
    const adjust: Adjust = { $: "Pointer", _0: PointerCoercion.UnsafeFnPointer };
    return this.unify_and(a, b, [], adjust, "Yes");
  } else {
    return this.unify(a, b, "Yes");
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1040 coerce_from_fn_item
Coerce.prototype.coerce_from_fn_item = function (this: Coerce, a0: Ty, b: Ty): CoerceResult {
  // debug!("coerce_from_fn_item(a={:?}, b={:?})", a, b);
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  const bk = b.kind();
  if (bk.$ === "FnPtr") {
    const b_hdr = bk._1;
    const s = this.fcx.sig_for_fn_def_coercion(a0, FnHeader.safety(b_hdr));
    if (s.$ === "Err") return s;
    const a_sig0 = s._0;

    const { value: a_sig, obligations } = this.at(this.cause, this.param_env).normalize(Unnormalized.new_wip(a_sig0), fold_PolyFnSig());
    const a = Ty.new_fn_ptr(this.tcx, a_sig);

    const adjust: Adjust = { $: "Pointer", _0: { $: "ReifyFnPointer", _0: FnHeader.safety(b_hdr) } };
    const u = this.unify_and(a, b, [], adjust, "Yes");
    if (u.$ === "Err") return u;
    const { value, obligations: o2 } = u._0;

    obligations.push(...o2);
    return Ok(new InferOk(value, obligations));
  } else {
    return this.unify(a0, b, "No");
  }
};

/// Attempts to coerce from a closure to a function pointer. Fails
/// if the closure has any upvars.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1066 coerce_closure_to_fn
Coerce.prototype.coerce_closure_to_fn = function (this: Coerce, a: Ty, b: Ty): CoerceResult {
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  const bk = b.kind();
  if (bk.$ === "FnPtr") {
    const hdr = bk._1;
    const safety = FnHeader.safety(hdr);
    const terr: TypeError = { $: "Sorts", _0: ExpectedFound.new(a, b) };
    const s = this.fcx.sig_for_closure_coercion(a, FnHeader.safety(hdr), terr);
    if (s.$ === "Err") return s;
    const closure_sig = s._0;
    const pointer_ty = Ty.new_fn_ptr(this.tcx, closure_sig);
    // debug!("coerce_closure_to_fn(a={:?}, b={:?}, pty={:?})", a, b, pointer_ty);

    const adjust: Adjust = { $: "Pointer", _0: { $: "ClosureFnPointer", _0: safety } };
    return this.unify_and(pointer_ty, b, [], adjust, "No");
  } else {
    return this.unify(a, b, "No");
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1085 coerce_to_raw_ptr
Coerce.prototype.coerce_to_raw_ptr = function (this: Coerce, a: Ty, b: Ty, mutbl_b: Mutability): CoerceResult {
  // debug!("coerce_to_raw_ptr(a={:?}, b={:?})", a, b);
  // debug_assert!(self.shallow_resolve(a) == a);
  // debug_assert!(self.shallow_resolve(b) == b);

  let is_ref: boolean;
  let mt_a: { ty: Ty; mutbl: Mutability };
  const ak = a.kind();
  if (ak.$ === "Ref") {
    [is_ref, mt_a] = [true, { ty: ak._1, mutbl: ak._2 }];
  } else if (ak.$ === "RawPtr") {
    [is_ref, mt_a] = [false, { ty: ak._0, mutbl: ak._1 }];
  } else {
    return this.unify(a, b, "No");
  }
  const m = coerce_mutbls(mt_a.mutbl, mutbl_b);
  if (m.$ === "Err") return m;

  // Check that the types which they point at are compatible.
  const a_raw = Ty.new_ptr(this.tcx, mt_a.ty, mutbl_b);
  // Although references and raw ptrs have the same
  // representation, we still register an Adjust::DerefRef so that
  // regionck knows that the region for `a` must be valid here.
  if (is_ref) {
    return this.unify_and(
      a_raw,
      b,
      [{ kind: { $: "Deref", _0: DerefAdjustKind.Builtin }, target: mt_a.ty }],
      { $: "Borrow", _0: { $: "RawPtr", _0: mutbl_b } },
      "No",
    );
  } else if (mt_a.mutbl !== mutbl_b) {
    return this.unify_and(a_raw, b, [], { $: "Pointer", _0: PointerCoercion.MutToConstPointer }, "No");
  } else {
    return this.unify(a_raw, b, "No");
  }
};

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
/// Attempt to coerce an expression to a type, and return the
/// adjusted type of the expression, if successful.
/// Adjustments are only recorded if the coercion succeeded.
/// The expressions *must not* have any preexisting adjustments.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1134 coerce
FnCtxt.prototype.coerce = function (
  this: FnCtxt,
  expr: hir.Expr,
  expr_ty: Ty,
  target: Ty,
  allow_two_phase: AllowTwoPhase,
  cause: ObligationCause | undefined,
): RelateResult<Ty> {
  const source = this.deeply_resolve_ignoring_regions_with_obligations(expr_ty, fold_Ty);
  // debug!("coercion::try({:?}: {:?} -> {:?})", expr, source, target);

  const cause_ = cause ?? this.cause(expr.span, { $: "ExprAssignable" });
  const coerce = Coerce.new(this, cause_, allow_two_phase, this.tcx.expr_guaranteed_to_constitute_read_for_never(expr));
  const ok = this.commit_if_ok((_) => coerce.coerce(source, target));
  if (ok.$ === "Err") return ok;

  const [adjustments] = this.register_infer_ok_obligations(ok._0);
  this.apply_adjustments(expr, adjustments);
  const e = TypeVisitableExt.error_reported(expr_ty, fold_Ty);
  return Ok(e.$ === "Err" ? Ty.new_error(this.tcx, e._0) : target);
};

/// Probe whether `expr_ty` can be coerced to `target_ty`. This has no side-effects,
/// and may return false positives if types are not yet fully constrained by inference.
///
/// Returns false if the coercion is not possible, or if the coercion creates any
/// sub-obligations that result in errors.
///
/// This should only be used for diagnostics.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1171 may_coerce
FnCtxt.prototype.may_coerce = function (this: FnCtxt, expr_ty: Ty, target_ty: Ty): boolean {
  const cause = this.cause(DUMMY_SP, { $: "ExprAssignable" });
  // We don't ever need two-phase here since we throw out the result of the coercion.
  // We also just always set `coerce_never` to true, since this is a heuristic.
  const coerce = Coerce.new(this, clone_ObligationCause(cause), "No", true);
  return this.probe((_) => {
    // Make sure to structurally resolve the types, since we use
    // the `TyKind`s heavily in coercion.
    const ocx = ObligationCtxt.new(this.infcx);
    const ok = coerce.coerce(expr_ty, target_ty);
    if (ok.$ === "Err") {
      return false;
    }
    ocx.register_obligations(ok._0.obligations);
    return TraitErrors.no_errors(ocx.try_evaluate_obligations());
  });
};

/// Like [`Self::may_coerce`], but for suggestions whose replacement must complete with a
/// value of the target type. A coercion from `!` to another type does not provide such a
/// value, so it should not by itself justify these suggestions.
///
/// This should only be used for suggestions.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1193 may_coerce_except_never
FnCtxt.prototype.may_coerce_except_never = function (this: FnCtxt, expr_ty: Ty, target_ty: Ty): boolean {
  if (expr_ty.is_never() && !target_ty.is_never()) {
    return false;
  }
  return this.may_coerce(expr_ty, target_ty);
};

/// Given a type and a target type, this function will calculate and return
/// how many dereference steps needed to coerce `expr_ty` to `target`. If
/// it's not possible, return `None`.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1203 deref_steps_for_suggestion
FnCtxt.prototype.deref_steps_for_suggestion = function (this: FnCtxt, expr_ty: Ty, target: Ty): number | undefined {
  const cause = this.cause(DUMMY_SP, { $: "ExprAssignable" });
  // We don't ever need two-phase here since we throw out the result of the coercion.
  const coerce = Coerce.new(this, cause, "No", true);
  // `coerce.autoderef(DUMMY_SP, expr_ty).find_map(|(ty, steps)| ..)`
  for (const [ty, steps] of coerce.autoderef(DUMMY_SP, expr_ty)) {
    if (this.probe((_) => coerce.unify_raw(ty, target, "No")).$ === "Ok") {
      return steps;
    }
  }
  return undefined;
};

/// Given a type, this function will calculate and return the type given
/// for `<Ty as Deref>::Target` only if `Ty` also implements `DerefMut`.
///
/// This function is for diagnostics only, since it does not register
/// trait or region sub-obligations. (presumably we could, but it's not
/// particularly important for diagnostics...)
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1222 deref_once_mutably_for_diagnostic
FnCtxt.prototype.deref_once_mutably_for_diagnostic = function (this: FnCtxt, expr_ty: Ty): Ty | undefined {
  // `.nth(1)`
  const it = this.autoderef(DUMMY_SP, expr_ty).silence_errors();
  if (it.next() === undefined) return undefined;
  const step = it.next();
  if (step === undefined) return undefined;
  const [deref_ty] = step;
  const deref_mut_trait = this.tcx.lang_items().deref_mut_trait();
  if (deref_mut_trait === undefined) return undefined;
  return EvaluationResult.may_apply(this.infcx.type_implements_trait(deref_mut_trait, [GenericArg.from_Ty(expr_ty)], this.param_env))
    ? deref_ty
    : undefined;
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1236 sig_for_coerce_lub
FnCtxt.prototype.sig_for_coerce_lub = function (this: FnCtxt, ty: Ty, closure_upvars_terr: TypeError): Result<PolyFnSigT, TypeError> {
  switch (ty.kind().$) {
    case "FnDef":
      return this.sig_for_fn_def_coercion(ty, undefined);
    case "Closure":
      return this.sig_for_closure_coercion(ty, undefined, closure_upvars_terr);
    default:
      return unreachable(`internal error: entered unreachable code: \`sig_for_fn_def_closure_coerce_lub\` called with wrong ty: ${debug_Ty(ty, PLAIN)}`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1248 sig_for_fn_def_coercion
FnCtxt.prototype.sig_for_fn_def_coercion = function (this: FnCtxt, fndef: Ty, expected_safety: hir.Safety | undefined): Result<PolyFnSigT, TypeError> {
  const tcx = this.tcx;

  const fk = fndef.kind();
  if (fk.$ !== "FnDef") {
    return unreachable(`internal error: entered unreachable code: \`sig_for_fn_def_coercion\` called with non-fndef: ${debug_Ty(fndef, PLAIN)}`);
  }
  const def_id = fk._0;

  // Intrinsics are not coercible to function pointers
  if (tcx.intrinsic(def_id) !== undefined) {
    return Err(TypeError.IntrinsicCast);
  }

  const fn_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  if (fn_attrs.inline.$ === "Force") {
    return Err(TypeError.ForceInlineCast);
  }

  const sig0 = fndef.fn_sig(tcx);
  let sig: PolyFnSigT;
  if (fn_attrs.safe_target_features) {
    // Allow the coercion if the current function has all the features that would be
    // needed to call the coercee safely.
    const adjusted_sig = tcx.adjust_target_feature_sig(def_id, sig0, LocalDefIdC.to_def_id(this.body_def_id));
    if (adjusted_sig !== undefined) {
      sig = adjusted_sig;
    } else if (expected_safety === "Safe") {
      return Err({ $: "TargetFeatureCast", _0: def_id });
    } else {
      sig = sig0;
    }
  } else {
    sig = sig0;
  }

  if (hir.Safety.is_safe(PolyFnSig.safety(sig)) && expected_safety === "Unsafe") {
    return Ok(tcx.safe_to_unsafe_sig(sig));
  } else {
    return Ok(sig);
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1291 sig_for_closure_coercion
FnCtxt.prototype.sig_for_closure_coercion = function (
  this: FnCtxt,
  closure: Ty,
  expected_safety: hir.Safety | undefined,
  closure_upvars_terr: TypeError,
): Result<PolyFnSigT, TypeError> {
  const tcx = this.tcx;

  const ck = closure.kind();
  if (ck.$ !== "Closure") {
    return unreachable(`internal error: entered unreachable code: \`sig_for_closure_coercion\` called with non closure ty: ${debug_Ty(closure, PLAIN)}`);
  }
  const [closure_def, closure_args] = [ck._0, ck._1];

  // At this point we haven't done capture analysis, which means
  // that the ClosureArgs just contains an inference variable instead
  // of tuple of captured types.
  //
  // All we care here is if any variable is being captured and not the exact paths,
  // so we check `upvars_mentioned` for root variables being captured.
  const upvars = tcx.upvars_mentioned(closure_def.expect_local());
  if (!(upvars === undefined || upvars.size === 0)) {
    return Err(closure_upvars_terr);
  }

  // We coerce the closure, which has fn type
  //     `extern "rust-call" fn((arg0,arg1,...)) -> _`
  // to
  //     `fn(arg0,arg1,...) -> _`
  // or
  //     `unsafe fn(arg0,arg1,...) -> _`
  const closure_sig = ClosureArgs.sig(closure_args.as_closure());
  return Ok(tcx.signature_unclosure(closure_sig, expected_safety ?? "Safe"));
};

/// Given some expressions, their known unified type and another expression,
/// tries to unify the types, potentially inserting coercions on any of the
/// provided expressions and returns their LUB (aka "common supertype").
///
/// This is really an internal helper. From outside the coercion
/// module, you should instantiate a `CoerceMany` instance.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1329 try_find_coercion_lub
FnCtxt.prototype.try_find_coercion_lub = function (
  this: FnCtxt,
  cause: ObligationCause,
  exprs: readonly hir.Expr[],
  prev_ty0: Ty,
  new_: hir.Expr,
  new_ty0: Ty,
): RelateResult<Ty> {
  const prev_ty = this.deeply_resolve_ignoring_regions_with_obligations(prev_ty0, fold_Ty);
  const new_ty = this.deeply_resolve_ignoring_regions_with_obligations(new_ty0, fold_Ty);
  // debug!(
  //     "coercion::try_find_coercion_lub({:?}, {:?}, exprs={:?} exprs)",
  //     prev_ty,
  //     new_ty,
  //     exprs.len()
  // );

  // Fast Path: don't go through the coercion logic if we're coercing
  // a type to itself. This is unfortunately quite perf relevant so
  // we do it even though it may mask bugs in the coercion logic.
  if (prev_ty === new_ty) {
    return Ok(prev_ty);
  }

  const terr: TypeError = { $: "Sorts", _0: ExpectedFound.new(prev_ty, new_ty) };
  let opt_sigs: [PolyFnSigT, PolyFnSigT] | undefined;
  const [pk, nk] = [prev_ty.kind().$, new_ty.kind().$];
  if ((pk === "FnDef" && nk === "FnDef") || (pk === "Closure" && nk === "Closure")) {
    // Don't coerce pairs of fndefs or pairs of closures to fn ptrs
    // if they can just be lubbed.
    //
    // See #88097 or `lub_closures_before_fnptr_coercion.rs` for where
    // we would erroneously coerce closures to fnptrs when attempting to
    // coerce a closure to itself.
    const lubbed_ty = this.commit_if_ok((snapshot): InferResult<Ty> => {
      const outer_universe = this.infcx.universe();

      // We need to eagerly handle nested obligations due to lazy norm.
      let result: InferResult<Ty>;
      if (this.next_trait_solver()) {
        const ocx = ObligationCtxt.new(this.infcx);
        const v = ocx.lub(cause, this.param_env, prev_ty, new_ty, ToTrace_Ty);
        if (v.$ === "Err") return v;
        const value = v._0;
        if (TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
          result = Ok(new InferOk(value, ocx.into_pending_obligations()));
        } else {
          result = Err(TypeError.Mismatch);
        }
      } else {
        result = this.at(cause, this.param_env).lub(prev_ty, new_ty, ToTrace_Ty);
      }

      const lc = this.leak_check(outer_universe, snapshot);
      if (lc.$ === "Err") return lc;
      return result;
    });

    if (lubbed_ty.$ === "Ok") {
      return Ok(this.register_infer_ok_obligations(lubbed_ty._0));
    } else {
      const a_sig = this.sig_for_coerce_lub(prev_ty, terr);
      if (a_sig.$ === "Err") return a_sig;
      const b_sig = this.sig_for_coerce_lub(new_ty, terr);
      if (b_sig.$ === "Err") return b_sig;
      opt_sigs = [a_sig._0, b_sig._0];
    }
  } else if ((pk === "Closure" && nk === "FnDef") || (pk === "FnDef" && nk === "Closure")) {
    const a_sig = this.sig_for_coerce_lub(prev_ty, terr);
    if (a_sig.$ === "Err") return a_sig;
    const b_sig = this.sig_for_coerce_lub(new_ty, terr);
    if (b_sig.$ === "Err") return b_sig;
    opt_sigs = [a_sig._0, b_sig._0];
  } else if (pk === "FnPtr" && nk === "FnPtr") {
    // ty::FnPtr x ty::FnPtr is fine to just be handled through a normal `unify`
    // call using `lub` which is what will happen on the normal path.
    opt_sigs = undefined;
  } else {
    opt_sigs = undefined;
  }

  if (opt_sigs !== undefined) {
    let [a_sig0, b_sig0] = opt_sigs;
    // Allow coercing safe sigs to unsafe sigs
    if (hir.Safety.is_safe(PolyFnSig.safety(a_sig0)) && hir.Safety.is_unsafe(PolyFnSig.safety(b_sig0))) {
      a_sig0 = this.tcx.safe_to_unsafe_sig(a_sig0);
    } else if (hir.Safety.is_safe(PolyFnSig.safety(b_sig0)) && hir.Safety.is_unsafe(PolyFnSig.safety(a_sig0))) {
      b_sig0 = this.tcx.safe_to_unsafe_sig(b_sig0);
    }

    // The signature must match.
    const [a_sig, b_sig] = this.normalize(new_.span, Unnormalized.new_wip<[PolyFnSigT, PolyFnSigT]>([a_sig0, b_sig0]), fold_tuple2(fold_PolyFnSig(), fold_PolyFnSig()));
    const l = this.at(cause, this.param_env).lub(a_sig, b_sig, ToTrace_PolyFnSig);
    if (l.$ === "Err") return l;
    const sig = this.register_infer_ok_obligations(l._0);

    // Reify both sides and return the reified fn pointer type.
    const fn_ptr = Ty.new_fn_ptr(this.tcx, sig);
    let prev_adjustment: Adjust;
    switch (prev_ty.kind().$) {
      case "Closure":
        prev_adjustment = { $: "Pointer", _0: { $: "ClosureFnPointer", _0: PolyFnSig.safety(sig) } };
        break;
      case "FnDef":
        prev_adjustment = { $: "Pointer", _0: { $: "ReifyFnPointer", _0: PolyFnSig.safety(sig) } };
        break;
      default:
        return span_bug(cause.span, `should not try to coerce a ${display_Ty(prev_ty)} to a fn pointer`);
    }
    let next_adjustment: Adjust;
    switch (new_ty.kind().$) {
      case "Closure":
        next_adjustment = { $: "Pointer", _0: { $: "ClosureFnPointer", _0: PolyFnSig.safety(sig) } };
        break;
      case "FnDef":
        next_adjustment = { $: "Pointer", _0: { $: "ReifyFnPointer", _0: PolyFnSig.safety(sig) } };
        break;
      default:
        return span_bug(new_.span, `should not try to coerce a ${display_Ty(new_ty)} to a fn pointer`);
    }
    for (const expr of exprs) {
      // PORT: `prev_adjustment.clone()`: a fresh copy of the (plain-data) `Adjust` per expression.
      this.apply_adjustments(expr, [{ kind: { ...prev_adjustment }, target: fn_ptr }]);
    }
    this.apply_adjustments(new_, [{ kind: next_adjustment, target: fn_ptr }]);
    return Ok(fn_ptr);
  }

  // Configure a Coerce instance to compute the LUB.
  // We don't allow two-phase borrows on any autorefs this creates since we
  // probably aren't processing function arguments here and even if we were,
  // they're going to get autorefed again anyway and we can apply 2-phase borrows
  // at that time.
  //
  // NOTE: we set `coerce_never` to `true` here because coercion LUBs only
  // operate on values and not places, so a never coercion is valid.
  const coerce = Coerce.new(this, clone_ObligationCause(cause), "No", true);
  coerce.use_lub = true;

  // First try to coerce the new expression to the type of the previous ones,
  // but only if the new expression has no coercion already applied to it.
  let first_error: TypeError | undefined = undefined;
  if (!this.typeck_results.adjustments().contains_key(new_.hir_id)) {
    const result = this.commit_if_ok((_) => coerce.coerce(new_ty, prev_ty));
    switch (result.$) {
      case "Ok": {
        const [adjustments, target] = this.register_infer_ok_obligations(result._0);
        this.apply_adjustments(new_, adjustments);
        // debug!(
        //     "coercion::try_find_coercion_lub: was able to coerce from new type {:?} to previous type {:?} ({:?})",
        //     new_ty, prev_ty, target
        // );
        return Ok(target);
      }
      case "Err":
        first_error = result._0;
        break;
    }
  }

  const r = this.commit_if_ok((_) => coerce.coerce(prev_ty, new_ty));
  // Avoid giving strange errors on failed attempts.
  if (r.$ === "Err") return Err(first_error ?? r._0);
  const ok = r._0;

  const [adjustments, target] = this.register_infer_ok_obligations(ok);
  for (const expr of exprs) {
    this.apply_adjustments(expr, [...adjustments]);
  }
  // debug!(
  //     "coercion::try_find_coercion_lub: was able to coerce previous type {:?} to new type {:?} ({:?})",
  //     prev_ty, new_ty, target
  // );
  return Ok(target);
};

/// Check whether `ty` can be coerced to `output_ty`.
/// Used from clippy.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1489 can_coerce
export function can_coerce(tcx: TyCtxt, param_env: ParamEnv, body_def_id: LocalDefId, ty: Ty, output_ty: Ty): boolean {
  const root_ctxt = TypeckRootCtxt.new(tcx, body_def_id);
  const fn_ctxt = FnCtxt.new(root_ctxt, param_env, body_def_id);
  return fn_ctxt.may_coerce(ty, output_ty);
}


// rustc-type: compiler/rustc_hir_typeck/src/coercion.rs:1565 CoerceMany
/// CoerceMany encapsulates the pattern you should use when you have
/// many expressions that are all getting coerced to a common
/// type. This arises, for example, when you have a match (the result
/// of each arm is coerced to a common type). It also arises in less
/// obvious places, such as when you have many `break foo` expressions
/// that target the same loop, or the various `return` expressions in
/// a function.
///
/// The basic protocol is as follows:
///
/// - Instantiate the `CoerceMany` with an initial `expected_ty`.
///   This will also serve as the "starting LUB". The expectation is
///   that this type is something which all of the expressions *must*
///   be coercible to. Use a fresh type variable if needed.
/// - For each expression whose result is to be coerced, invoke `coerce()` with.
///   - In some cases we wish to coerce "non-expressions" whose types are implicitly
///     unit. This happens for example if you have a `break` with no expression,
///     or an `if` with no `else`. In that case, invoke `coerce_forced_unit()`.
///   - `coerce()` and `coerce_forced_unit()` may report errors. They hide this
///     from you so that you don't have to worry your pretty head about it.
///     But if an error is reported, the final type will be `err`.
///   - Invoking `coerce()` may cause us to go and adjust the "adjustments" on
///     previously coerced expressions.
/// - When all done, invoke `complete()`. This will return the LUB of
///   all your expressions.
///   - WARNING: I don't believe this final type is guaranteed to be
///     related to your initial `expected_ty` in any particular way,
///     although it will typically be a subtype, so you should check it.
///     Check the note below for more details.
///   - Invoking `complete()` may cause us to go and adjust the "adjustments" on
///     previously coerced expressions.
///
/// Example:
///
/// ```ignore (illustrative)
/// let mut coerce = CoerceMany::new(expected_ty);
/// for expr in exprs {
///     let expr_ty = fcx.check_expr_with_expectation(expr, expected);
///     coerce.coerce(fcx, &cause, expr, expr_ty);
/// }
/// let final_ty = coerce.complete(fcx);
/// ```
///
/// NOTE: Why does the `expected_ty` participate in the LUB?
/// When coercing, each branch should use the following expectations for type inference:
/// - The branch can be coerced to the expected type of the match/if/whatever.
/// - The branch can be coercion lub'd with the types of the previous branches.
/// Ideally we'd have some sort of `Expectation::ParticipatesInCoerceLub(ongoing_lub_ty, final_ty)`,
/// but adding and using this feels very challenging.
/// What we instead do is to use the expected type of the match/if/whatever as
/// the initial coercion lub. This allows us to use the lub of "expected type of match" with
/// "types from previous branches" as the coercion target, which can contains both expectations.
///
/// Two concerns with this approach:
/// - We may have incompatible `final_ty` if that lub is different from the expected
///   type of the match. However, in this case coercing the final type of the
///   `CoerceMany` to its expected type would have error'd anyways, so we don't care.
/// - We may constrain the `expected_ty` too early. For some branches with
///   type `a` and `b`, we end up with `(a lub expected_ty) lub b` instead of
///   `(a lub b) lub expected_ty`. They should be the same type. However,
///   `a lub expected_ty` may constrain inference variables in `expected_ty`.
///   In this case the difference does matter and we get actually incorrect results.
/// FIXME: Ideally we'd compute the final type without unnecessarily constraining
/// the expected type of the match when computing the types of its branches.
// PORT: hand class (types.sets.json `hand`): the field `expected_ty` is `expected_ty_`, because the method
// `expected_ty()` (coercion.rs:1592) has the same name (infcx-contract representation 2). Methods and the associated
// fns `new` / `with_capacity` are declared in decls.ts (`declare module "./coercion.ts"`).
export class CoerceMany {
  constructor(
    public expected_ty_: Ty,
    public final_ty: Ty | undefined,
    public expressions: hir.Expr[],
  ) {}
}

// impl<'tcx> CoerceMany<'tcx> {
/// Creates a `CoerceMany` with a default capacity of 1. If the full set of
/// coercion sites is known before hand, consider `with_capacity()` instead
/// to avoid allocation.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1575 new
(CoerceMany as unknown as { new: typeof CoerceMany.new }).new = function (expected_ty: Ty): CoerceMany {
  return CoerceMany.with_capacity(expected_ty, 1);
};

/// Creates a `CoerceMany` with a given capacity.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1580 with_capacity
(CoerceMany as unknown as { with_capacity: typeof CoerceMany.with_capacity }).with_capacity = function (expected_ty: Ty, _capacity: number): CoerceMany {
  // PORT: `Vec::with_capacity(capacity)` is an empty array (capacity is an allocation hint only).
  return new CoerceMany(expected_ty, undefined, []);
};

/// Returns the "expected type" with which this coercion was
/// constructed. This represents the "downward propagated" type
/// that was given to us at the start of typing whatever construct
/// we are typing (e.g., the match expression).
///
/// Typically, this is used as the expected type when
/// type-checking each of the alternative expressions whose types
/// we are trying to merge.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1592 expected_ty
CoerceMany.prototype.expected_ty = function (this: CoerceMany): Ty {
  return this.expected_ty_;
};

/// Returns the current "merged type", representing our best-guess
/// at the LUB of the expressions we've seen so far (if any). This
/// isn't *final* until you call `self.complete()`, which will return
/// the merged type.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1600 merged_ty
CoerceMany.prototype.merged_ty = function (this: CoerceMany): Ty {
  return this.final_ty ?? this.expected_ty_;
};

/// Indicates that the value generated by `expression`, which is
/// of type `expression_ty`, is one of the possibilities that we
/// could coerce from. This will record `expression`, and later
/// calls to `coerce` may come back and add adjustments and things
/// if necessary.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1609 coerce
CoerceMany.prototype.coerce = function (this: CoerceMany, fcx: FnCtxt, cause: ObligationCause, expression: hir.Expr, expression_ty: Ty): void {
  this.coerce_inner(fcx, cause, expression, expression_ty, (_) => {}, false);
};

/// Indicates that one of the inputs is a "forced unit". This
/// occurs in a case like `if foo { ... };`, where the missing else
/// generates a "forced unit". Another example is a `loop { break;
/// }`, where the `break` has no argument expression. We treat
/// these cases slightly differently for error-reporting
/// purposes. Note that these tend to correspond to cases where
/// the `()` expression is implicit in the source, and hence we do
/// not take an expression argument.
///
/// The `augment_error` gives you a chance to extend the error
/// message, in case any results (e.g., we use this to suggest
/// removing a `;`).
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1631 coerce_forced_unit
CoerceMany.prototype.coerce_forced_unit = function (
  this: CoerceMany,
  fcx: FnCtxt,
  cause: ObligationCause,
  augment_error: (_1: Diag) => void,
  label_unit_as_expected: boolean,
): void {
  this.coerce_inner(fcx, cause, undefined, fcx.tcx.types.unit, augment_error, label_unit_as_expected);
};

/// The inner coercion "engine". If `expression` is `None`, this
/// is a forced-unit case, and hence `expression_ty` must be
/// `Nil`.
// #[instrument(skip(self, fcx, augment_error, label_expression_as_expected), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1652 coerce_inner
CoerceMany.prototype.coerce_inner = function (
  this: CoerceMany,
  fcx: FnCtxt,
  cause: ObligationCause,
  expression: hir.Expr | undefined,
  expression_ty0: Ty,
  augment_error: (_1: Diag) => void,
  label_expression_as_expected: boolean,
): void {
  let expression_ty = expression_ty0;
  // Incorporate whatever type inference information we have
  // until now; in principle we might also want to process
  // pending obligations, but doing so should only improve
  // compatibility (hopefully that is true) by helping us
  // uncover never types better.
  if (expression_ty.is_ty_var()) {
    expression_ty = fcx.infcx.shallow_resolve(expression_ty);
  }

  // If we see any error types, just propagate that error
  // upwards.
  {
    // `(expression_ty, self.merged_ty()).error_reported()`
    const e = TypeVisitableExt.error_reported<[Ty, Ty]>([expression_ty, this.merged_ty()], fold_tuple2(fold_Ty, fold_Ty));
    if (e.$ === "Err") {
      this.final_ty = Ty.new_error(fcx.tcx, e._0);
      return;
    }
  }

  let expected: Ty;
  let found: Ty;
  if (label_expression_as_expected) {
    // In the case where this is a "forced unit", like
    // `break`, we want to call the `()` "expected"
    // since it is implied by the syntax.
    // (Note: not all force-units work this way.)"
    [expected, found] = [expression_ty, this.merged_ty()];
  } else {
    // Otherwise, the "expected" type for error
    // reporting is the current unification type,
    // which is basically the LUB of the expressions
    // we've seen so far (combined with the expected
    // type)
    [expected, found] = [this.merged_ty(), expression_ty];
  }

  // Handle the actual type unification etc.
  let result: RelateResult<Ty>;
  if (expression !== undefined) {
    if (this.expressions.length === 0) {
      // Special-case the first expression we are coercing.
      // To be honest, I'm not entirely sure why we do this.
      // We don't allow two-phase borrows, see comment in try_find_coercion_lub for why
      result = fcx.coerce(expression, expression_ty, this.expected_ty_, "No", clone_ObligationCause(cause));
    } else {
      result = fcx.try_find_coercion_lub(cause, this.expressions, this.merged_ty(), expression, expression_ty);
    }
  } else {
    // this is a hack for cases where we default to `()` because
    // the expression etc has been omitted from the source. An
    // example is an `if let` without an else:
    //
    //     if let Some(x) = ... { }
    //
    // we wind up with a second match arm that is like `_ =>
    // ()`. That is the case we are considering here. We take
    // a different path to get the right "expected, found"
    // message and so forth (and because we know that
    // `expression_ty` will be unit).
    //
    // Another example is `break` with no argument expression.
    assert(expression_ty.is_unit(), "if let hack without unit type");
    const r = fcx
      .at(cause, fcx.param_env)
      .eq(
        // needed for tests/ui/type-alias-impl-trait/issue-65679-inst-opaque-ty-from-val-twice.rs
        "Yes",
        expected,
        found,
        ToTrace_Ty,
      );
    if (r.$ === "Ok") {
      fcx.register_infer_ok_obligations(r._0);
      result = Ok(expression_ty);
    } else {
      result = r;
    }
  }

  // debug!(?result);
  switch (result.$) {
    case "Ok": {
      const v = result._0;
      this.final_ty = v;
      if (expression !== undefined) {
        this.expressions.push(expression);
      }
      break;
    }
    case "Err": {
      const coercion_error = result._0;
      // Mark that we've failed to coerce the types here to suppress
      // any superfluous errors we might encounter while trying to
      // emit or provide suggestions on how to fix the initial error.
      fcx.set_tainted_by_errors(fcx.dcx().span_delayed_bug(cause.span, "coercion error but no error emitted"));
      [expected, found] = fcx.deeply_resolve_ignoring_regions<[Ty, Ty]>([expected, found], fold_tuple2(fold_Ty, fold_Ty));

      let err: Diag;
      let unsized_return = false;
      const code = cause.code_();
      if (code.$ === "ReturnNoExpression") {
        err = struct_span_code_err(fcx.dcx(), cause.span, E0069, "`return;` in a function whose return type is not `()`");
        const value = fcx.err_ctxt().ty_kind_suggestion(fcx.param_env, found);
        if (value !== undefined) {
          err.span_suggestion_verbose(Span.shrink_to_hi(cause.span), "give the `return` a value of the expected type", ` ${value}`, "HasPlaceholders");
        }
        err.span_label(cause.span, "return type is not `()`");
      } else if (code.$ === "BlockTailExpression") {
        const blk_id = code._0;
        err = this.report_return_mismatched_types(cause, expected, found, coercion_error, fcx, blk_id, expression);
        unsized_return = this.is_return_ty_definitely_unsized(fcx);
      } else if (code.$ === "ReturnValue") {
        const return_expr_id = code._0;
        err = this.report_return_mismatched_types(cause, expected, found, coercion_error, fcx, return_expr_id, expression);
        unsized_return = this.is_return_ty_definitely_unsized(fcx);
      } else if (code.$ === "MatchExpressionArm" && code._0.tail_defines_return_position_impl_trait !== undefined) {
        const { arm_span, arm_ty, prior_arm_ty, prior_non_diverging_arms } = code._0;
        const rpit_def_id = code._0.tail_defines_return_position_impl_trait;
        err = fcx.err_ctxt().report_mismatched_types(cause, fcx.param_env, expected, found, coercion_error);
        // Check that we're actually in the second or later arm
        if (prior_non_diverging_arms.length > 0) {
          this.suggest_boxing_tail_for_return_position_impl_trait(fcx, err, rpit_def_id, arm_ty, prior_arm_ty, [...prior_non_diverging_arms, arm_span]);
        }
      } else if (code.$ === "IfExpression" && code.tail_defines_return_position_impl_trait !== undefined) {
        const { expr_id } = code;
        const rpit_def_id = code.tail_defines_return_position_impl_trait;
        const node = fcx.tcx.hir_node(expr_id);
        if (!(node.$ === "Expr" && node._0.kind.$ === "If" && node._0.kind._2 !== undefined)) {
          return unreachable();
        }
        const [then_expr, else_expr] = [node._0.kind._1, node._0.kind._2];
        err = fcx.err_ctxt().report_mismatched_types(cause, fcx.param_env, expected, found, coercion_error);
        const then_span = fcx.find_block_span_from_hir_id(then_expr.hir_id);
        const else_span = fcx.find_block_span_from_hir_id(else_expr.hir_id);
        // Don't suggest wrapping whole block in `Box::new`.
        if (then_span !== then_expr.span && else_span !== else_expr.span) {
          const then_ty = fcx.typeck_results.expr_ty(then_expr);
          const else_ty = fcx.typeck_results.expr_ty(else_expr);
          this.suggest_boxing_tail_for_return_position_impl_trait(fcx, err, rpit_def_id, then_ty, else_ty, [then_span, else_span]);
        }
      } else {
        err = fcx.err_ctxt().report_mismatched_types(cause, fcx.param_env, expected, found, coercion_error);
      }

      augment_error(err);

      if (expression !== undefined) {
        const expr = expression;
        const ek = expr.kind;
        if (ek.$ === "Loop" && (ek._2 === "While" || ek._2 === "ForLoop")) {
          const [block, loop_src] = [ek._0, ek._2];
          const loop_type = loop_src === "While" ? "`while` loops" : "`for` loops";

          err.note(`${loop_type} evaluate to unit type \`()\``);
          if (loop_src === "While") {
            const pat = irrefutable_if_let_expr(block);
            if (pat !== undefined) {
              err.span_label(pat.span, "this pattern always matches, consider using `loop` instead");
            }
          }
        }

        fcx.emit_coerce_suggestions(err, expr, found, expected, undefined, coercion_error);
      }

      const guar = err.emit_err_unless_delay(unsized_return);

      this.final_ty = Ty.new_error(fcx.tcx, guar);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1923 suggest_boxing_tail_for_return_position_impl_trait
CoerceMany.prototype.suggest_boxing_tail_for_return_position_impl_trait = function (
  this: CoerceMany,
  fcx: FnCtxt,
  err: Diag,
  rpit_def_id: LocalDefId,
  a_ty: Ty,
  b_ty: Ty,
  arm_spans: Iterable<Span>,
): void {
  const compatible = (ty: Ty): boolean =>
    fcx.probe((_) => {
      const ocx = ObligationCtxt.new(fcx.infcx);
      const bounds = fcx.tcx.item_self_bounds(LocalDefIdC.to_def_id(rpit_def_id)) as EarlyBinder<Iterable<Clause>>;
      const obligations: PredicateObligation[] = [];
      for (const u of EarlyBinder.iter_identity(bounds)) {
        const clause = Unnormalized.skip_norm_wip(u);
        const mapped = Binder.map_bound(clause.kind(), (clause: ClauseKind): ClauseKind | undefined => {
          switch (clause.$) {
            case "Trait":
              return { $: "Trait", _0: TraitClause.with_replaced_self_ty(clause._0, as_interner(fcx.tcx), ty) };
            case "Projection":
              return { $: "Projection", _0: ProjectionClause.with_replaced_self_ty(clause._0, fcx.tcx, ty) };
            default:
              return undefined;
          }
        });
        const predicate = Binder.transpose(mapped);
        if (predicate === undefined) continue;
        obligations.push(Obligation.new(fcx.tcx, ObligationCause.dummy(), fcx.param_env, predicate, upcast_tcx(Predicate_upcast_from_Binder_ClauseKind)));
      }
      ocx.register_obligations(obligations);
      return TraitErrors.no_errors(ocx.try_evaluate_obligations());
    });

  if (!compatible(a_ty) || !compatible(b_ty)) {
    return;
  }

  const rpid_def_span = fcx.tcx.def_span(LocalDefIdC.to_def_id(rpit_def_id));
  err.subdiagnostic(
    SuggestBoxingForReturnImplTrait_subdiagnostic({
      $: "ChangeReturnType",
      start_sp: Span.with_hi(rpid_def_span, BytePos(Span.lo(rpid_def_span) + 4)),
      end_sp: Span.shrink_to_hi(rpid_def_span),
    }),
  );

  const starts: Span[] = [];
  const ends: Span[] = [];
  for (const span of arm_spans) {
    starts.push(Span.shrink_to_lo(span));
    ends.push(Span.shrink_to_hi(span));
  }
  err.subdiagnostic(SuggestBoxingForReturnImplTrait_subdiagnostic({ $: "BoxReturnExpr", starts, ends }));
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:1984 report_return_mismatched_types
CoerceMany.prototype.report_return_mismatched_types = function (
  this: CoerceMany,
  cause: ObligationCause,
  expected: Ty,
  found: Ty,
  ty_err: TypeError,
  fcx: FnCtxt,
  block_or_return_id: HirId,
  expression: hir.Expr | undefined,
): Diag {
  const err = fcx.err_ctxt().report_mismatched_types(cause, fcx.param_env, expected, found, ty_err);

  const due_to_block = fcx.tcx.hir_node(block_or_return_id).$ === "Block";
  const parent = fcx.tcx.parent_hir_node(block_or_return_id);
  if (expression !== undefined && parent.$ === "Expr" && parent._0.kind.$ === "Closure") {
    const expr = expression;
    const body = parent._0.kind._0.body;
    const needs_block = fcx.tcx.hir_body(body).value.kind.$ !== "Block";
    fcx.suggest_missing_semicolon(err, expr, expected, needs_block, true);
  }
  // Verify that this is a tail expression of a function, otherwise the
  // label pointing out the cause for the type coercion will be wrong
  // as prior return coercions would not be relevant (#57664).
  if (expression !== undefined && due_to_block) {
    const expr = expression;
    fcx.suggest_missing_semicolon(err, expr, expected, false, false);
    const pointing_at_return_type = fcx.suggest_mismatched_types_on_tail(err, expr, expected, found, block_or_return_id);
    const cond_expr = fcx.tcx.hir_get_if_cause(expr.hir_id);
    if (
      cond_expr !== undefined &&
      expected.is_unit() &&
      !pointing_at_return_type &&
      // If the block is from an external macro or try (`?`) desugaring, then
      // do not suggest adding a semicolon, because there's nowhere to put it.
      // See issues #81943 and #87051.
      // Similarly, if the block is from a loop desugaring, then also do not
      // suggest adding a semicolon. See issue #150850.
      Span.desugaring_kind(cond_expr.span) === undefined &&
      !Span.in_external_macro(cond_expr.span, fcx.tcx.sess.source_map()) &&
      !(cond_expr.kind.$ === "Match" && cond_expr.kind._2.$ === "TryDesugar")
    ) {
      const code = cause.code_();
      let labelled = false;
      if (code.$ === "BlockTailExpression" && code._1.$ === "Normal") {
        const hir_id = code._0;
        const bn = fcx.tcx.hir_node(hir_id);
        if (bn.$ === "Block") {
          const block = bn._0;
          const en = fcx.tcx.parent_hir_node(block.hir_id);
          if (en.$ === "Expr") {
            const ifn = fcx.tcx.parent_hir_node(en._0.hir_id);
            if (ifn.$ === "Expr" && ifn._0.kind.$ === "If" && ifn._0.kind._2 === undefined) {
              err.span_label(cond_expr.span, "`if` expressions without `else` arms expect their inner expression to be `()`");
              labelled = true;
            }
          }
        }
      }
      if (!labelled) {
        err.span_label(cond_expr.span, "expected this to be `()`");
      }
      if (expr.can_have_side_effects()) {
        // Don't suggest semicolon after if expressions as it does not fix the issue
        if (cond_expr.kind.$ !== "If") {
          fcx.suggest_semicolon_at_end(cond_expr.span, err);
        }
      }
    }
  }

  // If this is due to an explicit `return`, suggest adding a return type.
  {
    const r = fcx.get_fn_decl(block_or_return_id);
    if (r !== undefined && !due_to_block) {
      const [fn_id, fn_decl] = r;
      fcx.suggest_missing_return_type(err, fn_decl, expected, found, fn_id);
    }
  }

  // If this is due to a block, then maybe we forgot a `return`/`break`.
  if (due_to_block && expression !== undefined) {
    const expr = expression;
    const parent_fn_decl = fcx.tcx.hir_fn_decl_by_hir_id(fcx.tcx.local_def_id_to_hir_id(fcx.body_def_id));
    if (parent_fn_decl !== undefined) {
      fcx.suggest_missing_break_or_return_expr(err, expr, parent_fn_decl, expected, found, block_or_return_id, fcx.body_def_id);
    }
  }

  const fn_id = fcx.tcx.hir_get_fn_id_for_return_block(block_or_return_id);
  const is_return_position = fn_id !== undefined && HirId_eq(fn_id, fcx.tcx.local_def_id_to_hir_id(fcx.body_def_id));

  if (is_return_position) {
    const sp = fcx.ret_coercion_span;
    if (sp !== undefined) {
      // If the closure has an explicit return type annotation, or if
      // the closure's return type has been inferred from outside
      // requirements (such as an Fn* trait bound), then a type error
      // may occur at the first return expression we see in the closure
      // (if it conflicts with the declared return type). Skip adding a
      // note in this case, since it would be incorrect.
      const fn_sig = fcx.fn_sig();
      if (fn_sig !== undefined && FnSig.output(fn_sig).is_ty_var()) {
        err.span_note(sp, `return type inferred to be \`${display_Ty(expected)}\` here`);
      }
    }
  }

  return err;
};

/// Checks whether the return type is unsized via an obligation, which makes
/// sure we consider `dyn Trait: Sized` where clauses, which are trivially
/// false but technically valid for typeck.
// rustc: compiler/rustc_hir_typeck/src/coercion.rs:2110 is_return_ty_definitely_unsized
CoerceMany.prototype.is_return_ty_definitely_unsized = function (this: CoerceMany, fcx: FnCtxt): boolean {
  const sig = fcx.fn_sig();
  if (sig !== undefined) {
    return !fcx.infcx.predicate_may_hold(
      Obligation.new(
        fcx.tcx,
        ObligationCause.dummy(),
        fcx.param_env,
        TraitRef.new(as_interner(fcx.tcx), fcx.tcx.require_lang_item(LangItem.Sized, DUMMY_SP), [GenericArg.from_Ty(FnSig.output(sig))]),
        upcast_tcx(Predicate_upcast_from_TraitRef),
      ),
    );
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:2127 complete
CoerceMany.prototype.complete = function (this: CoerceMany, fcx: FnCtxt): Ty {
  const final_ty = this.final_ty;
  if (final_ty !== undefined) {
    return final_ty;
  } else {
    // If we only had inputs that were of type `!` (or no
    // inputs at all), then the final type is `!`.
    assert(this.expressions.length === 0, "assertion failed: self.expressions.is_empty()");
    return fcx.tcx.types.never;
  }
};

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:2139 irrefutable_if_let_expr
export function irrefutable_if_let_expr(block: hir.Block): hir.Pat | undefined {
  const e = block.expr;
  if (e === undefined) return undefined;
  if (e.kind.$ !== "If") {
    return undefined;
  }
  const cond = e.kind._0;
  if (cond.kind.$ !== "Let") {
    return undefined;
  }
  const let_expr = cond.kind._0;
  return simple_irrefutable_pattern(let_expr.pat) ? let_expr.pat : undefined;
}

// rustc: compiler/rustc_hir_typeck/src/coercion.rs:2149 simple_irrefutable_pattern
export function simple_irrefutable_pattern(pat: hir.Pat): boolean {
  const k = pat.kind;
  switch (k.$) {
    case "Wild":
      return true;
    case "Binding":
      return k._3 === undefined;
    case "Tuple":
      return k._0.every(simple_irrefutable_pattern);
    default:
      return false;
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/coercion.rs:2160 CoerceVisitor
/// Recursively visit goals to decide whether an unsizing is possible.
/// `Break`s when it isn't, and an error should be raised.
/// `Continue`s when an unsizing ok based on an implementation of the `Unsize` trait / lang item.
export class CoerceVisitor implements ProofTreeVisitor<ControlFlowT<null>> {
  /** `type Result = ControlFlow<()>;` */
  readonly Result = VisitorResult.ControlFlow<null>();

  // PORT: the field `span` is `span_` (the trait method `span()` has the same name; CoerceMany precedent).
  constructor(
    public fcx: FnCtxt,
    public span_: Span,
    /// Whether the coercion is impossible. If so we sometimes still try to
    /// coerce in these cases to emit better errors. This changes the behavior
    /// when hitting the recursion limit.
    public errored: boolean,
  ) {}

  // impl<'tcx> ProofTreeVisitor<'tcx> for CoerceVisitor<'_, 'tcx> {
  // rustc: compiler/rustc_hir_typeck/src/coercion.rs:2172 span
  span(): Span {
    return this.span_;
  }

  // (provided) ProofTreeVisitor::config, not overridden.
  config(): InspectConfig {
    return ProofTreeVisitor_provided.config(this);
  }

  // rustc: compiler/rustc_hir_typeck/src/coercion.rs:2176 visit_goal
  visit_goal(goal: InspectGoal): ControlFlowT<null> {
    const pred = goal.goal().predicate.as_trait_clause();
    if (pred === undefined) {
      return ControlFlow.CONTINUE;
    }

    // Make sure this predicate is referring to either an `Unsize` or `CoerceUnsized` trait,
    // Otherwise there's nothing to do.
    if (
      !this.fcx.tcx.is_lang_item(PolyTraitClause.def_id(pred), LangItem.Unsize) &&
      !this.fcx.tcx.is_lang_item(PolyTraitClause.def_id(pred), LangItem.CoerceUnsized)
    ) {
      return ControlFlow.CONTINUE;
    }

    const res = goal.result();
    if (res.$ === "Ok" && res._0.$ === "Yes") {
      // If we prove the `Unsize` or `CoerceUnsized` goal, continue recursing.
      return ControlFlow.CONTINUE;
    } else if (res.$ === "Err") {
      this.errored = true;
      // Even if we find no solution, continue recursing if we find a single candidate
      // for which we're shallowly certain it holds to get the right error source.
      const candidates = goal.candidates();
      if (candidates.length === 1 && candidates[0]!.shallow_certainty().$ === "Yes") {
        const only_candidate = candidates[0]!;
        return only_candidate.visit_nested_no_probe(this);
      } else {
        return ControlFlow.Break(null);
      }
    } else {
      // FIXME: structurally normalize?
      let self_kind: TyKindT | undefined;
      if (
        this.fcx.tcx.is_lang_item(PolyTraitClause.def_id(pred), LangItem.Unsize) &&
        Binder.skip_binder(pred).trait_ref.args.type_at(1).kind().$ === "Dynamic" &&
        (self_kind = Binder.skip_binder(PolyTraitClause.self_ty(pred)).kind()).$ === "Infer" &&
        self_kind._0.$ === "TyVar" &&
        this.fcx.type_var_is_sized(self_kind._0._0 satisfies TyVid)
      ) {
        // We get here when trying to unsize a type variable to a `dyn Trait`,
        // knowing that that variable is sized. Unsizing definitely has to happen in that case.
        // If the variable weren't sized, we may not need an unsizing coercion.
        // In general, we don't want to add coercions too eagerly since it makes error messages much worse.
        return ControlFlow.CONTINUE;
      } else {
        const cand = goal.unique_applicable_candidate();
        if (cand !== undefined && cand.shallow_certainty().$ === "Yes") {
          return cand.visit_nested_no_probe(this);
        } else {
          return ControlFlow.Break(null);
        }
      }
    }
  }

  // rustc: compiler/rustc_hir_typeck/src/coercion.rs:2227 on_recursion_limit
  on_recursion_limit(): ControlFlowT<null> {
    if (this.errored) {
      // This prevents accidentally committing unfulfilled unsized coercions while trying to
      // find the error source for diagnostics.
      // See https://github.com/rust-lang/trait-system-refactor-initiative/issues/266.
      return ControlFlow.Break(null);
    } else {
      return ControlFlow.CONTINUE;
    }
  }
}
