// Port of compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs (lane old-query-typeops, wave 18c).
//
// PORT: `E: FromSolverError<NextSolverError> + FromSolverError<OldSolverError>` is engine.ts's `FulfillmentErrorKinds<E>`,
// carried by the `ObligationCtxt` (`ocx.d_E`); `constraints: &mut DropckConstraint` is mutated in place.
// PORT: `Vec::append(&mut other)` moves the elements and empties `other`; `drain(..)` likewise (the vectors of the
// reused `constraints` are emptied in place). `FxHashSet<Ty>` is a `Set` (interned `Ty`).
// PORT: `TypingEnv: TypeFoldable` is the local `d_TypingEnv` (precedent rustc_mir_build const_to_pat.ts).
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.

import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { DropckConstraint, DropckOutlivesResult, type type_op } from "../../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArg, GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { fold_with_ParamEnv, type ParamEnvAnd, try_fold_with_ParamEnv, TypingEnv, visit_with_ParamEnv } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { ObligationCtxt } from "../engine.ts";
import type { ScrubbedTraitError } from "../../../rustc_infer/traits/engine.ts";

/** `NoSolution` (a unit struct; every value compares equal). */
const NO_SOLUTION: NoSolution = Object.freeze({}) as NoSolution;

/// This returns true if the type `ty` is "trivial" for
/// dropck-outlives -- that is, if it doesn't require any types to
/// outlive. This is similar but not *quite* the same as the
/// `needs_drop` test in the compiler already -- that is, for every
/// type T for which this function return true, needs-drop would
/// return `false`. But the reverse does not hold: in particular,
/// `needs_drop` returns false for `PhantomData`, but it is not
/// trivial for dropck-outlives.
///
/// Note also that `needs_drop` requires a "global" type (i.e., one
/// with erased regions), but this function does not.
///
// FIXME(@lcnr): remove this module and move this function somewhere else.
// rustc: compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs:29 trivial_dropck_outlives
export function trivial_dropck_outlives(tcx: TyCtxt, ty: Ty): boolean {
  const k = ty.kind();
  switch (k.$) {
    // None of these types have a destructor and hence they do not
    // require anything in particular to outlive the dtor's
    // execution.
    case "Infer":
      if (k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy") {
        return true;
      }
      // The following *might* require a destructor: needs deeper inspection.
      return false;
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Never":
    case "FnDef":
    case "FnPtr":
    case "Char":
    case "CoroutineWitness":
    case "RawPtr":
    case "Ref":
    case "Str":
    case "Foreign":
    case "Error":
      return true;

    // `T is PAT` and `[T]` have same properties as T.
    case "Pat":
    case "Slice":
      return trivial_dropck_outlives(tcx, k._0);
    case "Array": {
      const ty = k._0;
      const size = k._1;
      // Empty array never has a dtor. See issue #110288.
      if (size.try_to_target_usize(tcx) === 0n) {
        return true;
      } else {
        return trivial_dropck_outlives(tcx, ty);
      }
    }

    // (T1..Tn) and closures have same properties as T1..Tn --
    // check if *all* of them are trivial.
    case "Tuple":
      return k._0.every((t) => trivial_dropck_outlives(tcx, t));

    case "Closure":
      return trivial_dropck_outlives(tcx, ClosureArgs.tupled_upvars_ty(k._1.as_closure()));
    case "CoroutineClosure":
      return trivial_dropck_outlives(tcx, CoroutineClosureArgs.tupled_upvars_ty(k._1.as_coroutine_closure()));

    case "Adt": {
      const def = k._0;
      if (def.is_manually_drop()) {
        // `ManuallyDrop` never has a dtor.
        return true;
      } else {
        // Other types might. Moreover, PhantomData doesn't
        // have a dtor, but it is considered to own its
        // content, so it is non-trivial. Unions can have `impl Drop`,
        // and hence are non-trivial as well.
        return false;
      }
    }

    // The following *might* require a destructor: needs deeper inspection.
    case "Dynamic":
    case "Alias":
    case "Param":
    case "Placeholder":
    case "Bound":
    case "Coroutine":
    case "UnsafeBinder":
      return false;
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs:95 compute_dropck_outlives_inner
export function compute_dropck_outlives_inner(
  ocx: ObligationCtxt<ScrubbedTraitError>,
  goal: ParamEnvAnd<type_op.DropckOutlives>,
  span: Span,
): Result<DropckOutlivesResult, NoSolution> {
  const r = compute_dropck_outlives_with_errors(ocx, goal, span);
  switch (r.$) {
    case "Ok":
      return Ok(r._0);
    case "Err":
      return Err(NO_SOLUTION);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs:106 compute_dropck_outlives_with_errors
export function compute_dropck_outlives_with_errors<E>(
  ocx: ObligationCtxt<E>,
  goal: ParamEnvAnd<type_op.DropckOutlives>,
  span: Span,
): Result<DropckOutlivesResult, E[]> {
  const tcx = ocx.infcx.tcx;
  const {
    param_env,
    value: { dropped_ty },
  } = goal;

  const result = new DropckOutlivesResult([], []);

  // A stack of types left to process. Each round, we pop
  // something from the stack and invoke
  // `dtorck_constraint_for_ty_inner`. This may produce new types that
  // have to be pushed on the stack. This continues until we have explored
  // all the reachable types from the type `dropped_ty`.
  //
  // Example: Imagine that we have the following code:
  //
  // ```rust
  // struct A {
  //     value: B,
  //     children: Vec<A>,
  // }
  //
  // struct B {
  //     value: u32
  // }
  //
  // fn f() {
  //   let a: A = ...;
  //   ..
  // } // here, `a` is dropped
  // ```
  //
  // at the point where `a` is dropped, we need to figure out
  // which types inside of `a` contain region data that may be
  // accessed by any destructors in `a`. We begin by pushing `A`
  // onto the stack, as that is the type of `a`. We will then
  // invoke `dtorck_constraint_for_ty_inner` which will expand `A`
  // into the types of its fields `(B, Vec<A>)`. These will get
  // pushed onto the stack. Eventually, expanding `Vec<A>` will
  // lead to us trying to push `A` a second time -- to prevent
  // infinite recursion, we notice that `A` was already pushed
  // once and stop.
  const ty_stack: [Ty, number][] = [[dropped_ty, 0]];

  // Set used to detect infinite recursion.
  const ty_set = new Set<Ty>();

  const cause = ObligationCause.dummy_with_span(span);
  const constraints = DropckConstraint.empty();
  for (let entry = ty_stack.pop(); entry !== undefined; entry = ty_stack.pop()) {
    const [ty0, depth] = entry;
    // debug!("{} kinds, {} overflows, {} ty_stack", result.kinds.len(), result.overflows.len(), ty_stack.len());
    dtorck_constraint_for_ty_inner(tcx, ocx.infcx.typing_env(param_env), span, depth, ty0, constraints);

    // "outlives" represent types/regions that may be touched
    // by a destructor.
    result.kinds.push(...constraints.outlives.splice(0));
    result.overflows.push(...constraints.overflows.splice(0));

    // If we have even one overflow, we should stop trying to evaluate further --
    // chances are, the subsequent overflows for this evaluation won't provide useful
    // information and will just decrease the speed at which we can emit these errors
    // (since we'll be printing for just that much longer for the often enormous types
    // that result here).
    if (result.overflows.length !== 0) {
      break;
    }

    // dtorck types are "types that will get dropped but which
    // do not themselves define a destructor", more or less. We have
    // to push them onto the stack to be expanded.
    for (const ty_ of constraints.dtorck_types.splice(0)) {
      let ty: Ty;
      const n = ocx.infcx.at(cause, param_env).query_normalize(ty_, fold_Ty);
      if (n.$ === "Ok") {
        const { value: ty1, obligations } = n._0;
        ocx.register_obligations(obligations);

        // debug!("dropck_outlives: ty from dtorck_types = {:?}", ty);
        ty = ty1;
      } else {
        // Flush errors b/c `deeply_normalize` doesn't expect pending
        // obligations, and we may have pending obligations from the
        // branch above (from other types).
        const errors = ocx.evaluate_obligations_error_on_ambiguity();
        if (errors.$ === "HasErrors") {
          return Err(errors._0);
        }

        // When query normalization fails, we don't get back an interesting
        // reason that we could use to report an error in borrowck. In order to turn
        // this into a reportable error, we deeply normalize again. We don't expect
        // this to succeed, so delay a bug if it does.
        const d = ocx.deeply_normalize(cause, param_env, Unnormalized.new_wip(ty_), fold_Ty);
        switch (d.$) {
          case "Ok":
            tcx.dcx().span_delayed_bug(span, `query normalize succeeded of ${display_Ty(ty_)}, but deep normalize failed`);
            ty = ty_;
            break;
          case "Err":
            return Err(d._0);
        }
      }

      const k = ty.kind();
      switch (k.$) {
        // All parameters live for the duration of the
        // function.
        case "Param":
          break;

        // A projection that we couldn't resolve - it
        // might have a destructor.
        case "Alias":
          result.kinds.push(GenericArg.from_Ty(ty));
          break;

        default:
          if (!ty_set.has(ty)) {
            ty_set.add(ty);
            ty_stack.push([ty, depth + 1]);
          }
      }
    }
  }

  // debug!("dropck_outlives: result = {:#?}", result);
  return Ok(result);
}

/// Returns a set of constraints that needs to be satisfied in
/// order for `ty` to be valid for destruction.
// #[instrument(level = "debug", skip(tcx, typing_env, span, constraints))]
// rustc: compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs:256 dtorck_constraint_for_ty_inner
export function dtorck_constraint_for_ty_inner(
  tcx: TyCtxt,
  typing_env_: TypingEnv,
  span: Span,
  depth: number,
  ty: Ty,
  constraints: DropckConstraint,
): void {
  if (!tcx.recursion_limit().value_within_limit(depth)) {
    constraints.overflows.push(ty);
    return;
  }

  if (trivial_dropck_outlives(tcx, ty)) {
    return;
  }

  const k = ty.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "Never":
    case "Foreign":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "CoroutineWitness":
      // these types never have a destructor
      break;

    case "Pat":
    case "Array":
    case "Slice": {
      const ety = k._0;
      // single-element containers, behave like their element
      dtorck_constraint_for_ty_inner(tcx, typing_env_, span, depth + 1, ety, constraints);
      break;
    }

    case "Tuple": {
      const tys = k._0;
      for (const ty of tys) {
        dtorck_constraint_for_ty_inner(tcx, typing_env_, span, depth + 1, ty, constraints);
      }
      break;
    }

    case "Closure": {
      const args = k._1;
      for (const ty of ClosureArgs.upvar_tys(args.as_closure())) {
        dtorck_constraint_for_ty_inner(tcx, typing_env_, span, depth + 1, ty, constraints);
      }
      break;
    }

    case "CoroutineClosure": {
      const args = k._1;
      for (const ty of CoroutineClosureArgs.upvar_tys(args.as_coroutine_closure())) {
        dtorck_constraint_for_ty_inner(tcx, typing_env_, span, depth + 1, ty, constraints);
      }
      break;
    }

    case "Coroutine": {
      const def_id = k._0;
      // rust-lang/rust#49918: Locals can be stored across await points in the coroutine,
      // called interior/witness types. Since we do not compute these witnesses until after
      // building MIR, we consider all coroutines to unconditionally require a drop during
      // MIR building. However, considering the coroutine to unconditionally require a drop
      // here may unnecessarily require its upvars' regions to be live when they don't need
      // to be, leading to borrowck errors: <https://github.com/rust-lang/rust/issues/116242>.
      //
      // Here, we implement a more precise approximation for the coroutine's dtorck constraint
      // by considering whether any of the interior types needs drop. Note that this is still
      // an approximation because the coroutine interior has its regions erased, so we must add
      // *all* of the upvars to live types set if we find that *any* interior type needs drop.
      // This is because any of the regions captured in the upvars may be stored in the interior,
      // which then has its regions replaced by a binder (conceptually erasing the regions),
      // so there's no way to enforce that the precise region in the interior type is live
      // since we've lost that information by this point.
      //
      // Note also that this check requires that the coroutine's upvars are use-live, since
      // a region from a type that does not have a destructor that was captured in an upvar
      // may flow into an interior type with a destructor. This is stronger than requiring
      // the upvars are drop-live.
      //
      // For example, if we capture two upvar references `&'1 (), &'2 ()` and have some type
      // in the interior, `for<'r> { NeedsDrop<'r> }`, we have no way to tell whether the
      // region `'r` came from the `'1` or `'2` region, so we require both are live. This
      // could even be unnecessary if `'r` was actually a `'static` region or some region
      // local to the coroutine! That's why it's an approximation.
      const args = k._1.as_coroutine();

      // Note that we don't care about whether the resume type has any drops since this is
      // redundant; there is no storage for the resume type, so if it is actually stored
      // in the interior, we'll already detect the need for a drop by checking the interior.
      //
      // FIXME(@lcnr): Why do we erase regions in the env here? Seems odd
      const typing_env = tcx.erase_and_anonymize_regions(typing_env_, d_TypingEnv);
      const witness = tcx.mir_coroutine_witnesses(def_id);
      const needs_drop = witness !== undefined && witness.field_tys.some((field) => field.ty.needs_drop(tcx, typing_env));
      if (needs_drop) {
        // Pushing types directly to `constraints.outlives` is equivalent
        // to requiring them to be use-live, since if we were instead to
        // recurse on them like we do below, we only end up collecting the
        // types that are relevant for drop-liveness.
        constraints.outlives.push(...CoroutineArgs.upvar_tys(args).map(GenericArg.from_Ty));
        constraints.outlives.push(GenericArg.from_Ty(CoroutineArgs.resume_ty(args)));
      } else {
        // Even if a witness type doesn't need a drop, we still require that
        // the upvars are drop-live. This is only needed if we aren't already
        // counting *all* of the upvars as use-live above, since use-liveness
        // is a *stronger requirement* than drop-liveness. Recursing here
        // unconditionally would just be collecting duplicated types for no
        // reason.
        for (const ty of CoroutineArgs.upvar_tys(args)) {
          dtorck_constraint_for_ty_inner(tcx, typing_env, span, depth + 1, ty, constraints);
        }
      }
      break;
    }

    case "Adt": {
      const def = k._0;
      const args = k._1;
      const { dtorck_types, outlives, overflows } = tcx.at(span).adt_dtorck_constraint(def.did()) as DropckConstraint;
      // FIXME: we can try to recursively `dtorck_constraint_on_ty`
      // there, but that needs some way to handle cycles.
      constraints.dtorck_types.push(...dtorck_types.map((t) => Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, t, fold_Ty), tcx, args, fold_Ty))));
      constraints.outlives.push(
        ...outlives.map((t) => Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, t, fold_GenericArg), tcx, args, fold_GenericArg))),
      );
      constraints.overflows.push(...overflows.map((t) => Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, t, fold_Ty), tcx, args, fold_Ty))));
      break;
    }

    // Objects must be alive in order for their destructor
    // to be called.
    case "Dynamic":
      constraints.outlives.push(GenericArg.from_Ty(ty));
      break;

    // Types that can't be resolved. Pass them forward.
    case "Alias":
    case "Param":
      constraints.dtorck_types.push(ty);
      break;

    // Can't instantiate binder here.
    case "UnsafeBinder":
      constraints.dtorck_types.push(ty);
      break;

    case "Placeholder":
    case "Bound":
    case "Infer":
    case "Error":
      // By the time this code runs, all type variables ought to
      // be fully resolved.
      tcx.dcx().span_delayed_bug(span, `Unresolved type in dropck: ${debug_Ty(ty, PLAIN)}.`);
      break;
  }
}

// ---- PORT: views and descriptors ---------------------------------------------------------------------------------------

/** PORT: `TypeFoldable for ty::TypingEnv` (`#[derive(TypeVisitable, TypeFoldable)]`, rustc_middle ty/mod.rs; no generated
 *  impl yet): `typing_mode` is `#[type_foldable(identity)] #[type_visitable(ignore)]`, `param_env` folds. */
const d_TypingEnv: TypeFoldable<TypingEnv> = {
  visit_with: (self, visitor) => visit_with_ParamEnv(self.param_env, visitor),
  try_fold_with: (self, folder) => {
    const r = try_fold_with_ParamEnv(self.param_env, folder);
    if (r.$ === "Err") return r;
    return Ok(new TypingEnv(self.typing_mode_, r._0));
  },
  fold_with: (self, folder) => new TypingEnv(self.typing_mode_, fold_with_ParamEnv(self.param_env, folder)),
};

