//! Code which is used by built-in goals that match "structurally", such a auto
//! traits, `Copy`/`Clone`.
//
// Port of compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs (lane nts-assembly; contract by
// lane evalctxt-contract). Extension module (docs/handoff/evalctxt-contract.md "Init order"): its top-level code touches
// only other crates.
//
// PORT: `#[derive(TypeVisitable_Generic, TypeFoldable_Generic)]` on `AsyncCallableRelevantTypes` is codegen's
// (PORTING §5): `fold_AsyncCallableRelevantTypes` below is a stand-in until root adds the type to a tools/codegen set.
// PORT: `impl From<RerunNonErased> for AmbiguousOrRerunNonErased` is `AmbiguousOrRerunNonErased.from_RerunNonErased`
// (tyir-solve decision 7).
// PORT: `ReplaceProjectionWith::mapping: &HashMap<I::TraitAssocTermId, Vec<..>>` is keyed by `DefId`: a `DefIdMap`
// (only looked up, never iterated, so its order is irrelevant).
// PORT (D3): `cx: I` is `TyCtxt`; `Interner` methods go through rustc_type_ir predicate.ts's `as_interner`. In these
// generic fns `Ty::new_*` / `ty.fn_sig(cx)` are `inherent::Ty`'s: the required ones are rustc_middle's `Ty` statics,
// the provided ones `Ty_provided` (inherent.ts header).
// PORT: `#[instrument(.., ret)]` (tracing) produces no output in the oracle: kept as comments.
// PORT: `EarlyBinder<impl IntoIterator>` values iterated with `iter_instantiated` (`AdtDef::all_field_tys`, the
// `Interner::*bounds` / `explicit_super_clauses_of` queries) go through `iter_instantiated_iter` below.
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { BoundExistentialPredicates, Clause, Clauses, GenericArg, GenericArgs, ParamEnv, Predicate, Term, Ty } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs, GenericArg as GenericArgC } from "../../../rustc_middle/ty/generic_args.ts";
import { Ty as TyC } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_PolyTraitRef, Predicate_upcast_from_TraitRef } from "../../../rustc_middle/ty/predicate.ts";
import { debug_Ty, fold_Clause, fold_Span, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { inherent_Features } from "../../../rustc_middle/ty/context.ts";
import { DefIdMap, type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { Binder as BinderC, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type {
  Binder,
  ClosureKind,
  CoroutineClosureArgs,
  CoroutineWitnessTypes,
  FnSig,
  ProjectionClause,
  TraitRef,
} from "../../../rustc_type_ir/decls.ts";
import { Elaboratable_Clause, elaborate } from "../../../rustc_type_ir/elaborate.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  fold_tuple2,
  fold_Vec,
  type PredicateProxy,
  try_fold_with_Vec,
  type TypeFoldable,
} from "../../../rustc_type_ir/fold.ts";
import { Term_provided, Ty_provided } from "../../../rustc_type_ir/inherent.ts";
import { ClosureKind as ClosureKindC } from "../../../rustc_type_ir/lib.ts";
import {
  as_interner,
  ExistentialProjection,
  fold_with_ProjectionClause,
  PolyProjectionClause,
  ProjectionClause as ProjectionClauseImpl,
  TraitRef as TraitRefC,
  try_fold_with_ProjectionClause,
  visit_with_ProjectionClause,
} from "../../../rustc_type_ir/predicate.ts";
import { relate_AliasTerm } from "../../../rustc_type_ir/relate.ts";
import { ProbeKind } from "../../../rustc_type_ir/solve/inspect.ts";
import type { Goal, NoSolution, NoSolutionOrRerunNonErased, RerunNonErased, SizedTraitKind } from "../../../rustc_type_ir/solve/mod.ts";
import { Goal as GoalC } from "../../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Region, type Region as RegionT } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import { debug_AliasTermKind } from "../../../rustc_type_ir/term_kind.gen.ts";
import { type AliasTerm as AliasTermT, debug_Alias } from "../../../rustc_type_ir/ty/alias.ts";
import {
  ClosureArgs,
  CoroutineArgs,
  CoroutineClosureArgs as CoroutineClosureArgsC,
  type CoroutineClosureSignature,
  CoroutineClosureSignature as CoroutineClosureSignatureC,
} from "../../../rustc_type_ir/ty_kind/closure.ts";
import {
  fold_FnSig,
  FnSig as FnSigC,
  PolyFnSig,
  PolyFnSigTys,
  UnsafeBinderInner,
  visit_with_CoroutineWitnessTypes,
  try_fold_with_CoroutineWitnessTypes,
  fold_with_CoroutineWitnessTypes,
} from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import type { UpcastFrom } from "../../../rustc_type_ir/upcast.ts";
import type { TypeVisitable } from "../../../rustc_type_ir/visit.ts";
import { type Debug, debug_struct, PLAIN } from "../../../std/fmt.ts";
import { panic, unported, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { EvalCtxt } from "../../decls.ts";

// Calculates the constituent types of a type for `auto trait` purposes.
// #[instrument(level = "trace", skip(ecx), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:24 instantiate_constituent_tys_for_auto_trait
export function instantiate_constituent_tys_for_auto_trait(ecx: EvalCtxt, ty: Ty): Result<Binder<Ty[]>, NoSolution> {
  const cx = ecx.cx();
  const kind = ty.kind();
  switch (kind.$) {
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "Error":
    case "Never":
    case "Char":
      return Ok(BinderC.dummy<Ty[]>([], d_VecTy));

    // This branch is only for `experimental_default_bounds`.
    // Other foreign types were rejected earlier in
    // `disqualify_auto_trait_candidate_due_to_possible_impl`.
    case "Foreign":
      return Ok(BinderC.dummy<Ty[]>([], d_VecTy));

    // Treat `str` like it's defined as `struct str([u8]);`
    case "Str":
      return Ok(BinderC.dummy([TyC.new_slice(cx, TyC.new_u8(cx))], d_VecTy));

    case "Dynamic":
    case "Param":
    case "Alias":
    case "Placeholder":
    case "Bound":
    case "Infer":
      return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);

    case "RawPtr":
      return Ok(BinderC.dummy([kind._0], d_VecTy));
    case "Ref":
      return Ok(BinderC.dummy([kind._1], d_VecTy));

    case "Pat":
    case "Array":
    case "Slice":
      return Ok(BinderC.dummy([kind._0], d_VecTy));

    case "Tuple":
      // (T1, ..., Tn) -- meets any bound that all of T1...Tn meet
      return Ok(BinderC.dummy([...kind._0], d_VecTy));

    case "Closure":
      return Ok(BinderC.dummy([ClosureArgs.tupled_upvars_ty(kind._1.as_closure())], d_VecTy));

    case "CoroutineClosure":
      return Ok(BinderC.dummy([CoroutineClosureArgsC.tupled_upvars_ty(kind._1.as_coroutine_closure())], d_VecTy));

    case "Coroutine": {
      const [def_id, args] = [kind._0, kind._1];
      return Ok(
        BinderC.dummy(
          [CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), TyC.new_coroutine_witness_for_coroutine(ecx.cx(), def_id, args)],
          d_VecTy,
        ),
      );
    }

    case "CoroutineWitness": {
      const [def_id, args] = [kind._0, kind._1];
      return Ok(
        BinderC.map_bound(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(as_interner(ecx.cx()).coroutine_hidden_types(def_id), cx, args, d_Binder_CoroutineWitnessTypes()),
          ),
          (bound) => [...bound.types],
        ),
      );
    }

    case "UnsafeBinder":
      return Ok(BinderC.map_bound(UnsafeBinderInner.into_Binder(kind._0), (ty) => [ty]));

    case "Adt": {
      const [def, args] = [kind._0, kind._1];
      // For `PhantomData<T>`, we pass `T`.
      if (def.is_phantom_data()) {
        return Ok(BinderC.dummy([args.type_at(0)], d_VecTy));
      }

      return Ok(
        BinderC.dummy(
          [...iter_instantiated_iter(cx, def.all_field_tys(cx), args, fold_Ty)].map((u) => Unnormalized.skip_norm_wip(u)),
          d_VecTy,
        ),
      );
    }
  }
}

// #[instrument(level = "trace", skip(ecx), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:114 instantiate_constituent_tys_for_sizedness_trait
export function instantiate_constituent_tys_for_sizedness_trait(
  ecx: EvalCtxt,
  sizedness: SizedTraitKind,
  ty: Ty,
): Result<Binder<Ty[]>, NoSolution> {
  const kind = ty.kind();
  switch (kind.$) {
    // impl {Meta,}Sized for u*, i*, bool, f*, FnDef, FnPtr, *(const/mut) T, char
    // impl {Meta,}Sized for &mut? T, [T; N], dyn* Trait, !, Coroutine, CoroutineWitness
    // impl {Meta,}Sized for Closure, CoroutineClosure
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "FnDef":
    case "FnPtr":
    case "RawPtr":
    case "Char":
    case "Ref":
    case "Coroutine":
    case "CoroutineWitness":
    case "Array":
    case "Pat":
    case "Closure":
    case "CoroutineClosure":
    case "Never":
    case "Error":
      return Ok(BinderC.dummy<Ty[]>([], d_VecTy));

    // impl {Meta,}Sized for str, [T], dyn Trait
    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        case "Sized":
          return Err(NoSolution);
        case "MetaSized":
          return Ok(BinderC.dummy<Ty[]>([], d_VecTy));
      }
    // falls through (unreachable: the inner switch is exhaustive)

    // impl {} for extern type
    case "Foreign":
      return Err(NoSolution);

    case "Alias":
    case "Param":
    case "Placeholder":
      return Err(NoSolution);

    case "Bound":
      return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
    case "Infer":
      switch (kind._0.$) {
        case "IntVar":
        case "FloatVar":
          return Ok(BinderC.dummy<Ty[]>([], d_VecTy));
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)

    case "UnsafeBinder":
      return Ok(BinderC.map_bound(UnsafeBinderInner.into_Binder(kind._0), (ty) => [ty]));

    // impl {Meta,}Sized for ()
    // impl {Meta,}Sized for (T1, T2, .., Tn) where Tn: {Meta,}Sized if n >= 1
    case "Tuple": {
      const tys = kind._0;
      const last = tys[tys.length - 1];
      return Ok(BinderC.dummy(last === undefined ? [] : [last], d_VecTy));
    }

    // impl {Meta,}Sized for Adt<Args...>
    //   where {meta,pointee,}sized_constraint(Adt)<Args...>: {Meta,}Sized
    //
    //   `{meta,pointee,}sized_constraint(Adt)` is the deepest struct trail that can be
    //   determined by the definition of `Adt`, independent of the generic args.
    //
    // impl {Meta,}Sized for Adt<Args...>
    //   if {meta,pointee,}sized_constraint(Adt) == None
    //
    //   As a performance optimization, `{meta,pointee,}sized_constraint(Adt)` can return `None`
    //   if the ADTs definition implies that it is {meta,}sized by for all possible args.
    //   In this case, the builtin impl will have no nested subgoals. This is a
    //   "best effort" optimization and `{meta,pointee,}sized_constraint` may return `Some`,
    //   even if the ADT is {meta,pointee,}sized for all possible args.
    case "Adt": {
      const [def, args] = [kind._0, kind._1];
      const crit = def.sizedness_constraint(ecx.cx(), sizedness);
      if (crit !== undefined) {
        return Ok(BinderC.dummy([Unnormalized.skip_norm_wip(EarlyBinder.instantiate(crit, ecx.cx(), args, fold_Ty))], d_VecTy));
      } else {
        return Ok(BinderC.dummy<Ty[]>([], d_VecTy));
      }
    }
  }
}

// #[instrument(level = "trace", skip(ecx), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:193 instantiate_constituent_tys_for_copy_clone_trait
export function instantiate_constituent_tys_for_copy_clone_trait(ecx: EvalCtxt, ty: Ty): Result<Binder<Ty[]>, NoSolution> {
  const kind = ty.kind();
  switch (kind.$) {
    // impl Copy/Clone for FnDef, FnPtr
    case "FnDef":
    case "FnPtr":
    case "Error":
      return Ok(BinderC.dummy<Ty[]>([], d_VecTy));

    // Implementations are provided in core
    case "Uint":
    case "Int":
    case "Bool":
    case "Float":
    case "Char":
    case "RawPtr":
    case "Never":
    case "Array":
      return Err(NoSolution);

    case "Ref":
      switch (kind._2) {
        // Implementations are provided in core
        case "Not":
          return Err(NoSolution);
        case "Mut":
          return Err(NoSolution);
      }
    // falls through (unreachable: the inner switch is exhaustive)

    // Cannot implement in core, as we can't be generic over patterns yet,
    // so we'd have to list all patterns and type combinations.
    case "Pat":
      return Ok(BinderC.dummy([kind._0], d_VecTy));

    case "Dynamic":
    case "Str":
    case "Slice":
    case "Foreign":
    case "Adt":
    case "Param":
    case "Placeholder":
      return Err(NoSolution);

    case "Alias":
      switch (kind._0) {
        case "Yes":
          return Err(NoSolution);
        case "No":
          return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)

    // impl Copy/Clone for (T1, T2, .., Tn) where T1: Copy/Clone, T2: Copy/Clone, .. Tn: Copy/Clone
    case "Tuple":
      return Ok(BinderC.dummy([...kind._0], d_VecTy));

    // impl Copy/Clone for Closure where Self::TupledUpvars: Copy/Clone
    case "Closure":
      return Ok(BinderC.dummy([ClosureArgs.tupled_upvars_ty(kind._1.as_closure())], d_VecTy));

    // impl Copy/Clone for CoroutineClosure where Self::TupledUpvars: Copy/Clone
    case "CoroutineClosure":
      return Ok(
        BinderC.dummy(
          [CoroutineClosureArgsC.tupled_upvars_ty(kind._1.as_coroutine_closure())],
          d_VecTy,
        ),
      );

    // only when `coroutine_clone` is enabled and the coroutine is movable
    // impl Copy/Clone for Coroutine where T: Copy/Clone forall T in (upvars, witnesses)
    case "Coroutine": {
      const [def_id, args] = [kind._0, kind._1];
      switch (as_interner(ecx.cx()).coroutine_movability(def_id)) {
        case "Static":
          return Err(NoSolution);
        case "Movable":
          if (inherent_Features.coroutine_clone(as_interner(ecx.cx()).features())) {
            return Ok(
              BinderC.dummy(
                [CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), TyC.new_coroutine_witness_for_coroutine(ecx.cx(), def_id, args)],
                d_VecTy,
              ),
            );
          } else {
            return Err(NoSolution);
          }
      }
    }
    // falls through (unreachable: the inner switch is exhaustive)

    case "UnsafeBinder":
      return Err(NoSolution);

    // impl Copy/Clone for CoroutineWitness where T: Copy/Clone forall T in coroutine_hidden_types
    case "CoroutineWitness": {
      const [def_id, args] = [kind._0, kind._1];
      return Ok(
        BinderC.map_bound(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(as_interner(ecx.cx()).coroutine_hidden_types(def_id), ecx.cx(), args, d_Binder_CoroutineWitnessTypes()),
          ),
          (bound) => [...bound.types],
        ),
      );
    }

    case "Infer":
      switch (kind._0.$) {
        // Implementations are provided in core
        case "IntVar":
        case "FloatVar":
          return Err(NoSolution);
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)

    case "Bound":
      return panic(`unexpected type \`${debug_Ty(ty, PLAIN)}\``);
  }
}

// Returns a binder of the tupled inputs types and output type from a builtin callable type.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:277 extract_tupled_inputs_and_output_from_callable
export function extract_tupled_inputs_and_output_from_callable(
  cx: TyCtxt,
  self_ty: Ty,
  goal_kind: ClosureKind,
): Result<Binder<[Ty, Ty]> | undefined, NoSolution> {
  const icx = as_interner(cx);
  const kind = self_ty.kind();
  switch (kind.$) {
    // keep this in sync with assemble_fn_pointer_candidates until the old solver is removed.
    case "FnDef": {
      const [def_id, args] = [kind._0, kind._1];
      const sig = icx.fn_sig(def_id);
      if (PolyFnSig.is_fn_trait_compatible(EarlyBinder.skip_binder(sig)) && !icx.has_target_features(def_id)) {
        return Ok(
          BinderC.map_bound(
            Unnormalized.skip_norm_wip(
              EarlyBinder.instantiate(sig, cx, unwrap(BinderC.no_bound_vars(args, fold_GenericArgs)), fold_Binder(fold_FnSig)),
            ),
            (sig): [Ty, Ty] => [TyC.new_tup(cx, FnSigC.inputs(sig)), FnSigC.output(sig)],
          ),
        );
      } else {
        return Err(NoSolution);
      }
    }
    // keep this in sync with assemble_fn_pointer_candidates until the old solver is removed.
    case "FnPtr": {
      const sig = PolyFnSigTys.with(kind._0, kind._1);
      if (PolyFnSig.is_fn_trait_compatible(sig)) {
        return Ok(BinderC.map_bound(sig, (sig): [Ty, Ty] => [TyC.new_tup(cx, FnSigC.inputs(sig)), FnSigC.output(sig)]));
      } else {
        return Err(NoSolution);
      }
    }
    case "Closure": {
      const closure_args = kind._1.as_closure();
      const closure_kind = ClosureArgs.kind_ty(closure_args).to_opt_closure_kind();
      if (closure_kind !== undefined) {
        // If the closure's kind doesn't extend the goal kind,
        // then the closure doesn't implement the trait.
        if (!ClosureKindC.extends(closure_kind, goal_kind)) {
          return Err(NoSolution);
        }
      } else {
        // Closure kind is not yet determined, so we return ambiguity unless
        // the expected kind is `FnOnce` as that is always implemented.
        if (goal_kind !== "FnOnce") {
          return Ok(undefined);
        }
      }
      return Ok(BinderC.map_bound(ClosureArgs.sig(closure_args), (sig): [Ty, Ty] => [unwrap(FnSigC.inputs(sig)[0]), FnSigC.output(sig)]));
    }

    // Coroutine-closures don't implement `Fn` traits the normal way.
    // Instead, they always implement `FnOnce`, but only implement
    // `FnMut`/`Fn` if they capture no upvars, since those may borrow
    // from the closure.
    case "CoroutineClosure": {
      const def_id = kind._0;
      const args = kind._1.as_coroutine_closure();
      const kind_ty = CoroutineClosureArgsC.kind_ty(args);
      const sig = BinderC.skip_binder(CoroutineClosureArgsC.coroutine_closure_sig(args));

      let coroutine_ty: Ty;
      const kind_ = kind_ty.to_opt_closure_kind();
      if (kind_ !== undefined && !Ty_provided.is_ty_var(CoroutineClosureArgsC.tupled_upvars_ty(args))) {
        if (!ClosureKindC.extends(kind_, goal_kind)) {
          return Err(NoSolution);
        }

        // A coroutine-closure implements `FnOnce` *always*, since it may
        // always be called once. It additionally implements `Fn`/`FnMut`
        // only if it has no upvars referencing the closure-env lifetime,
        // and if the closure kind permits it.
        if (goal_kind !== "FnOnce" && CoroutineClosureArgsC.has_self_borrows(args)) {
          return Err(NoSolution);
        }

        coroutine_ty = coroutine_closure_to_certain_coroutine(
          cx,
          goal_kind,
          // No captures by ref, so this doesn't matter.
          Region.new_static(cx),
          def_id,
          args,
          sig,
        );
      } else {
        // Closure kind is not yet determined, so we return ambiguity unless
        // the expected kind is `FnOnce` as that is always implemented.
        if (goal_kind !== "FnOnce") {
          return Ok(undefined);
        }

        coroutine_ty = coroutine_closure_to_ambiguous_coroutine(
          cx,
          goal_kind, // No captures by ref, so this doesn't matter.
          Region.new_static(cx),
          def_id,
          args,
          sig,
        );
      }

      return Ok(BinderC.rebind<CoroutineClosureSignature, [Ty, Ty]>(CoroutineClosureArgsC.coroutine_closure_sig(args), [sig.tupled_inputs_ty, coroutine_ty]));
    }

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "Dynamic":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Pat":
    case "UnsafeBinder":
    case "Param":
    case "Placeholder":
    case "Error":
      return Err(NoSolution);

    case "Alias":
      switch (kind._0) {
        case "Yes":
          return Err(NoSolution);
        case "No":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Infer":
      switch (kind._0.$) {
        case "IntVar":
        case "FloatVar":
          return Err(NoSolution);
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
  }
}

/// Relevant types for an async callable, including its inputs, output,
/// and the return type you get from awaiting the output.
// PORT: `#[derive_where(Clone, Copy, Debug; I: Interner)]` plain struct (Copy of interned fields: no clone needed).
export interface AsyncCallableRelevantTypes {
  tupled_inputs_ty: Ty;
  /// Type returned by calling the closure
  /// i.e. `f()`.
  output_coroutine_ty: Ty;
  /// Type returned by `await`ing the output
  /// i.e. `f().await`.
  coroutine_return_ty: Ty;
}
export const debug_AsyncCallableRelevantTypes: Debug<AsyncCallableRelevantTypes> = (v, f) =>
  debug_struct(f, "AsyncCallableRelevantTypes", [
    ["tupled_inputs_ty", debug_Ty(v.tupled_inputs_ty, f)],
    ["output_coroutine_ty", debug_Ty(v.output_coroutine_ty, f)],
    ["coroutine_return_ty", debug_Ty(v.coroutine_return_ty, f)],
  ]);
/** PORT: stand-in for the codegen'd `TypeVisitable_Generic` / `TypeFoldable_Generic` derive (header). */
export const fold_AsyncCallableRelevantTypes: TypeFoldable<AsyncCallableRelevantTypes> = {
  visit_with<R>(): R {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeVisitable (derive, codegen)");
  },
  try_fold_with<E>(): Result<AsyncCallableRelevantTypes, E> {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeFoldable (derive, codegen)");
  },
  fold_with(): AsyncCallableRelevantTypes {
    return unported("rustc_next_trait_solver::solve::assembly::structural_traits::AsyncCallableRelevantTypes: TypeFoldable (derive, codegen)");
  },
};

// Returns a binder of the tupled inputs types, output type, and coroutine type
// from a builtin coroutine-closure type. If we don't yet know the closure kind of
// the coroutine-closure, emit an additional trait predicate for `AsyncFnKindHelper`
// which enforces the closure is actually callable with the given trait. When we
// know the kind already, we can short-circuit this check.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:435 extract_tupled_inputs_and_output_from_async_callable
export function extract_tupled_inputs_and_output_from_async_callable(
  cx: TyCtxt,
  self_ty: Ty,
  goal_kind: ClosureKind,
  env_region: RegionT,
): Result<[Binder<AsyncCallableRelevantTypes>, Predicate[]], NoSolution> {
  const icx = as_interner(cx);
  const kind = self_ty.kind();
  switch (kind.$) {
    case "CoroutineClosure": {
      const def_id = kind._0;
      const args = kind._1.as_coroutine_closure();
      const kind_ty = CoroutineClosureArgsC.kind_ty(args);
      const sig = BinderC.skip_binder(CoroutineClosureArgsC.coroutine_closure_sig(args));
      const nested: Predicate[] = [];

      let coroutine_ty: Ty;
      const kind_ = kind_ty.to_opt_closure_kind();
      if (kind_ !== undefined && !Ty_provided.is_ty_var(CoroutineClosureArgsC.tupled_upvars_ty(args))) {
        if (!ClosureKindC.extends(kind_, goal_kind)) {
          return Err(NoSolution);
        }

        coroutine_ty = coroutine_closure_to_certain_coroutine(cx, goal_kind, env_region, def_id, args, sig);
      } else {
        // When we don't know the closure kind (and therefore also the closure's upvars,
        // which are computed at the same time), we must delay the computation of the
        // generator's upvars. We do this using the `AsyncFnKindHelper`, which as a trait
        // goal functions similarly to the old `ClosureKind` predicate, and ensures that
        // the goal kind <= the closure kind. As a projection `AsyncFnKindHelper::Upvars`
        // will project to the right upvars for the generator, appending the inputs and
        // coroutine upvars respecting the closure kind.
        nested.push(
          Predicate_upcast_from_TraitRef(
            TraitRefC.new(icx, icx.require_trait_lang_item("AsyncFnKindHelper"), [
              GenericArgC.from_Ty(kind_ty),
              GenericArgC.from_Ty(TyC.from_closure_kind(cx, goal_kind)),
            ]),
            cx,
          ),
        );

        coroutine_ty = coroutine_closure_to_ambiguous_coroutine(cx, goal_kind, env_region, def_id, args, sig);
      }

      return Ok<[Binder<AsyncCallableRelevantTypes>, Predicate[]]>([
        BinderC.rebind<CoroutineClosureSignature, AsyncCallableRelevantTypes>(CoroutineClosureArgsC.coroutine_closure_sig(args), {
          tupled_inputs_ty: sig.tupled_inputs_ty,
          output_coroutine_ty: coroutine_ty,
          coroutine_return_ty: sig.return_ty,
        }),
        nested,
      ]);
    }

    case "FnDef": {
      const def_id = kind._0;
      const sig = Ty_provided.fn_sig(self_ty, cx);
      if (PolyFnSig.is_fn_trait_compatible(sig) && !icx.has_target_features(def_id)) {
        return fn_item_to_async_callable(cx, sig);
      } else {
        return Err(NoSolution);
      }
    }
    case "FnPtr": {
      const sig = Ty_provided.fn_sig(self_ty, cx);
      if (PolyFnSig.is_fn_trait_compatible(sig)) {
        return fn_item_to_async_callable(cx, sig);
      } else {
        return Err(NoSolution);
      }
    }

    case "Closure": {
      const args = kind._1.as_closure();
      const bound_sig = ClosureArgs.sig(args);
      const sig = BinderC.skip_binder(bound_sig);
      const future_trait_def_id = icx.require_trait_lang_item("Future");
      // `Closure`s only implement `AsyncFn*` when their return type
      // implements `Future`.
      const nested: Predicate[] = [
        Predicate_upcast_from_PolyTraitRef(
          BinderC.rebind(bound_sig, TraitRefC.new(icx, future_trait_def_id, [GenericArgC.from_Ty(FnSigC.output(sig))])),
          cx,
        ),
      ];

      // Additionally, we need to check that the closure kind
      // is still compatible.
      const kind_ty = ClosureArgs.kind_ty(args);
      const closure_kind = kind_ty.to_opt_closure_kind();
      if (closure_kind !== undefined) {
        if (!ClosureKindC.extends(closure_kind, goal_kind)) {
          return Err(NoSolution);
        }
      } else {
        const async_fn_kind_trait_def_id = icx.require_trait_lang_item("AsyncFnKindHelper");
        // When we don't know the closure kind (and therefore also the closure's upvars,
        // which are computed at the same time), we must delay the computation of the
        // generator's upvars. We do this using the `AsyncFnKindHelper`, which as a trait
        // goal functions similarly to the old `ClosureKind` predicate, and ensures that
        // the goal kind <= the closure kind. As a projection `AsyncFnKindHelper::Upvars`
        // will project to the right upvars for the generator, appending the inputs and
        // coroutine upvars respecting the closure kind.
        nested.push(
          Predicate_upcast_from_TraitRef(
            TraitRefC.new(icx, async_fn_kind_trait_def_id, [
              GenericArgC.from_Ty(kind_ty),
              GenericArgC.from_Ty(TyC.from_closure_kind(cx, goal_kind)),
            ]),
            cx,
          ),
        );
      }

      const future_output_def_id = icx.require_projection_lang_item("FutureOutput");
      const future_output_ty = Ty_provided.new_projection(cx, "No", future_output_def_id, [GenericArgC.from_Ty(FnSigC.output(sig))]);
      return Ok<[Binder<AsyncCallableRelevantTypes>, Predicate[]]>([
        BinderC.rebind<FnSig, AsyncCallableRelevantTypes>(bound_sig, {
          tupled_inputs_ty: unwrap(FnSigC.inputs(sig)[0]),
          output_coroutine_ty: FnSigC.output(sig),
          coroutine_return_ty: future_output_ty,
        }),
        nested,
      ]);
    }

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Pat":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "Dynamic":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "UnsafeBinder":
    case "Tuple":
    case "Param":
    case "Placeholder":
    case "Error":
      return Err(NoSolution);

    case "Alias":
      switch (kind._0) {
        case "Yes":
          return Err(NoSolution);
        case "No":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Infer":
      switch (kind._0.$) {
        case "IntVar":
        case "FloatVar":
          return Err(NoSolution);
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
  }
}

// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:592 fn_item_to_async_callable
export function fn_item_to_async_callable(
  cx: TyCtxt,
  bound_sig: Binder<FnSig>,
): Result<[Binder<AsyncCallableRelevantTypes>, Predicate[]], NoSolution> {
  const icx = as_interner(cx);
  const sig = BinderC.skip_binder(bound_sig);
  const future_trait_def_id = icx.require_trait_lang_item("Future");
  // `FnDef` and `FnPtr` only implement `AsyncFn*` when their
  // return type implements `Future`.
  const nested: Predicate[] = [
    Predicate_upcast_from_PolyTraitRef(
      BinderC.rebind(bound_sig, TraitRefC.new(icx, future_trait_def_id, [GenericArgC.from_Ty(FnSigC.output(sig))])),
      cx,
    ),
  ];
  const future_output_def_id = icx.require_projection_lang_item("FutureOutput");
  const future_output_ty = Ty_provided.new_projection(cx, "No", future_output_def_id, [GenericArgC.from_Ty(FnSigC.output(sig))]);
  return Ok<[Binder<AsyncCallableRelevantTypes>, Predicate[]]>([
    BinderC.rebind<FnSig, AsyncCallableRelevantTypes>(bound_sig, {
      tupled_inputs_ty: TyC.new_tup(cx, FnSigC.inputs(sig)),
      output_coroutine_ty: FnSigC.output(sig),
      coroutine_return_ty: future_output_ty,
    }),
    nested,
  ]);
}

/// Given a coroutine-closure, project to its returned coroutine when we are *certain*
/// that the closure's kind is compatible with the goal.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:619 coroutine_closure_to_certain_coroutine
export function coroutine_closure_to_certain_coroutine(
  cx: TyCtxt,
  goal_kind: ClosureKind,
  goal_region: RegionT,
  def_id: DefId,
  args: CoroutineClosureArgs,
  sig: CoroutineClosureSignature,
): Ty {
  return CoroutineClosureSignatureC.to_coroutine_given_kind_and_upvars(
    sig,
    cx,
    CoroutineClosureArgsC.parent_args(args),
    as_interner(cx).coroutine_for_closure(def_id),
    goal_kind,
    goal_region,
    CoroutineClosureArgsC.tupled_upvars_ty(args),
    CoroutineClosureArgsC.coroutine_captures_by_ref_ty(args),
  );
}

/// Given a coroutine-closure, project to its returned coroutine when we are *not certain*
/// that the closure's kind is compatible with the goal, and therefore also don't know
/// yet what the closure's upvars are.
///
/// Note that we do not also push a `AsyncFnKindHelper` goal here.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:643 coroutine_closure_to_ambiguous_coroutine
export function coroutine_closure_to_ambiguous_coroutine(
  cx: TyCtxt,
  goal_kind: ClosureKind,
  goal_region: RegionT,
  def_id: DefId,
  args: CoroutineClosureArgs,
  sig: CoroutineClosureSignature,
): Ty {
  const icx = as_interner(cx);
  const upvars_projection_def_id = icx.require_projection_lang_item("AsyncFnKindUpvars");
  const tupled_upvars_ty = Ty_provided.new_projection(cx, "No", upvars_projection_def_id, [
    GenericArgC.from_Ty(CoroutineClosureArgsC.kind_ty(args)),
    GenericArgC.from_Ty(TyC.from_closure_kind(cx, goal_kind)),
    GenericArgC.from_Region(goal_region),
    GenericArgC.from_Ty(sig.tupled_inputs_ty),
    GenericArgC.from_Ty(CoroutineClosureArgsC.tupled_upvars_ty(args)),
    GenericArgC.from_Ty(CoroutineClosureArgsC.coroutine_captures_by_ref_ty(args)),
  ]);
  return CoroutineClosureSignatureC.to_coroutine(
    sig,
    cx,
    CoroutineClosureArgsC.parent_args(args),
    TyC.from_closure_kind(cx, goal_kind),
    icx.coroutine_for_closure(def_id),
    tupled_upvars_ty,
  );
}

/// This duplicates `extract_tupled_inputs_and_output_from_callable` but needs
/// to return different information (namely, the def id and args) so that we can
/// create const conditions.
///
/// Doing so on all calls to `extract_tupled_inputs_and_output_from_callable`
/// would be wasteful.
// #[instrument(level = "trace", skip(cx), ret)]
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:682 extract_fn_def_from_const_callable
export function extract_fn_def_from_const_callable(
  cx: TyCtxt,
  self_ty: Ty,
): Result<[Binder<[Ty, Ty]>, DefId, GenericArgs], NoSolution> {
  const icx = as_interner(cx);
  const kind = self_ty.kind();
  switch (kind.$) {
    case "FnDef": {
      const def_id = kind._0;
      // FIXME
      const args = unwrap(BinderC.no_bound_vars(kind._1, fold_GenericArgs));

      const sig = icx.fn_sig(def_id);
      if (PolyFnSig.is_fn_trait_compatible(EarlyBinder.skip_binder(sig)) && !icx.has_target_features(def_id) && icx.fn_is_const(def_id)) {
        return Ok<[Binder<[Ty, Ty]>, DefId, GenericArgs]>([
          BinderC.map_bound(
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate(sig, cx, args, fold_Binder(fold_FnSig))),
            (sig): [Ty, Ty] => [TyC.new_tup(cx, FnSigC.inputs(sig)), FnSigC.output(sig)],
          ),
          def_id,
          args,
        ]);
      } else {
        return Err(NoSolution);
      }
    }
    // `FnPtr`s are not const for now.
    case "FnPtr": {
      return Err(NoSolution);
    }
    case "Closure": {
      const [def, args] = [kind._0, kind._1];
      if (icx.closure_is_const(def)) {
        const closure_args = args.as_closure();
        return Ok<[Binder<[Ty, Ty]>, DefId, GenericArgs]>([
          BinderC.map_bound(ClosureArgs.sig(closure_args), (sig): [Ty, Ty] => [unwrap(FnSigC.inputs(sig)[0]), FnSigC.output(sig)]),
          def,
          args,
        ]);
      } else {
        return Err(NoSolution);
      }
    }
    // `CoroutineClosure`s are not const for now.
    case "CoroutineClosure": {
      return Err(NoSolution);
    }

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Str":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "Dynamic":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Pat":
    case "Param":
    case "Placeholder":
    case "Error":
    case "UnsafeBinder":
      return Err(NoSolution);

    case "Alias":
      switch (kind._0) {
        case "Yes":
          return Err(NoSolution);
        case "No":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Infer":
      switch (kind._0.$) {
        case "IntVar":
        case "FloatVar":
          return Err(NoSolution);
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
  }
}

// NOTE: Keep this in sync with `evaluate_host_effect_for_destruct_goal` in
// the old solver, for as long as that exists.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:765 const_conditions_for_destruct
export function const_conditions_for_destruct(cx: TyCtxt, self_ty: Ty): Result<TraitRef[], NoSolution> {
  const icx = as_interner(cx);
  const destruct_def_id = icx.require_trait_lang_item("Destruct");

  const kind = self_ty.kind();
  switch (kind.$) {
    case "Adt": {
      const [adt_def, args] = [kind._0, kind._1];
      // `ManuallyDrop` is trivially `[const] Destruct` as we do not run any drop glue on it.
      if (adt_def.is_manually_drop()) return Ok<TraitRef[]>([]);

      // An ADT is `[const] Destruct` only if all of the fields are,
      // *and* if there is a `Drop` impl, that `Drop` impl is also `[const]`.
      const const_conditions: TraitRef[] = [...iter_instantiated_iter(cx, adt_def.all_field_tys(cx), args, fold_Ty)]
        .map((u) => Unnormalized.skip_norm_wip(u))
        .map((field_ty) => TraitRefC.new(icx, destruct_def_id, [GenericArgC.from_Ty(field_ty)]));
      switch (adt_def.ir_destructor(cx)) {
        // `Drop` impl exists, but it's not const. Type cannot be `[const] Destruct`.
        case "NotConst":
          return Err(NoSolution);
        // `Drop` impl exists, and it's const. Require `Ty: [const] Drop` to hold.
        case "Const": {
          const drop_def_id = icx.require_trait_lang_item("Drop");
          const drop_trait_ref = TraitRefC.new(icx, drop_def_id, [GenericArgC.from_Ty(self_ty)]);
          const_conditions.push(drop_trait_ref);
          break;
        }
        // No `Drop` impl, no need to require anything else.
        case undefined:
          break;
      }
      return Ok(const_conditions);
    }

    case "Array":
    case "Pat":
    case "Slice":
      return Ok<TraitRef[]>([TraitRefC.new(icx, destruct_def_id, [GenericArgC.from_Ty(kind._0)])]);

    case "Tuple":
      return Ok<TraitRef[]>([...kind._0].map((field_ty) => TraitRefC.new(icx, destruct_def_id, [GenericArgC.from_Ty(field_ty)])));

    // Trivially implement `[const] Destruct`
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Never":
    case "Error":
      return Ok<TraitRef[]>([]);

    // Closures are [const] Destruct when all of their upvars (captures) are [const] Destruct.
    case "Closure": {
      const closure_args = kind._1.as_closure();
      return Ok<TraitRef[]>([TraitRefC.new(icx, destruct_def_id, [GenericArgC.from_Ty(ClosureArgs.tupled_upvars_ty(closure_args))])]);
    }
    // Coroutines could implement `[const] Drop`,
    // but they don't really need to right now.
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
      return Err(NoSolution);

    // FIXME(unsafe_binders): Unsafe binders could implement `[const] Drop`
    // if their inner type implements it.
    case "UnsafeBinder":
      return Err(NoSolution);

    case "Dynamic":
    case "Param":
    case "Alias":
    case "Placeholder":
    case "Foreign":
      return Err(NoSolution);

    case "Infer":
      switch (kind._0.$) {
        case "FloatVar":
        case "IntVar":
          return Ok<TraitRef[]>([]);
        case "TyVar":
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
      }
    // falls through (unreachable: the inner switch is exhaustive)
    case "Bound":
      return panic(`unexpected type \`${debug_Ty(self_ty, PLAIN)}\``);
  }
}

/// Assemble a list of predicates that would be present on a theoretical
/// user impl for an object type. These predicates must be checked any time
/// we assemble a built-in object candidate for an object type, since they
/// are not implied by the well-formedness of the type.
///
/// For example, given the following traits:
///
/// ```rust,ignore (theoretical code)
/// trait Foo: Baz {
///     type Bar: Copy;
/// }
///
/// trait Baz {}
/// ```
///
/// For the dyn type `dyn Foo<Item = Ty>`, we can imagine there being a
/// pair of theoretical impls:
///
/// ```rust,ignore (theoretical code)
/// impl Foo for dyn Foo<Item = Ty>
/// where
///     Self: Baz,
///     <Self as Foo>::Bar: Copy,
/// {
///     type Bar = Ty;
/// }
///
/// impl Baz for dyn Foo<Item = Ty> {}
/// ```
///
/// However, in order to make such impls non-cyclical, we need to do an
/// additional step of eagerly folding the associated types in the where
/// clauses of the impl. In this example, that means replacing
/// `<Self as Foo>::Bar` with `Ty` in the first impl.
// rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:883 predicates_for_object_candidate
export function predicates_for_object_candidate(
  ecx: EvalCtxt,
  param_env: ParamEnv,
  trait_ref: TraitRef,
  object_bounds: BoundExistentialPredicates,
): Result<Goal<Predicate>[], AmbiguousOrRerunNonErased> {
  const cx = ecx.cx();
  const icx = as_interner(cx);
  const requirements: Clause[] = [];
  // Elaborating all supertrait outlives obligations here is not soundness critical,
  // since if we just used the unelaborated set, then the transitive supertraits would
  // be reachable when proving the former. However, since we elaborate all supertrait
  // outlives obligations when confirming impls, we would end up with a different set
  // of outlives obligations here if we didn't do the same, leading to ambiguity.
  // FIXME(-Znext-solver=coinductive): Adding supertraits here can be removed once we
  // make impls coinductive always, since they'll always need to prove their supertraits.
  requirements.push(
    ...elaborate(
      cx,
      (function* (): Generator<Clause> {
        for (const u of iter_instantiated_iter(cx, icx.explicit_super_clauses_of(trait_ref.def_id), trait_ref.args, d_Clause_Span())) {
          const [pred] = Unnormalized.skip_norm_wip(u);
          yield pred;
        }
      })(),
      Elaboratable_Clause,
    ),
  );

  // FIXME(mgca): Also add associated consts to
  // the requirements here.
  for (const associated_type_def_id of icx.associated_type_def_ids(trait_ref.def_id)) {
    // associated types that require `Self: Sized` do not show up in the built-in
    // implementation of `Trait for dyn Trait`, and can be dropped here.
    if (icx.generics_require_sized_self(associated_type_def_id)) {
      continue;
    }

    for (const u of iter_instantiated_iter(cx, icx.item_bounds(associated_type_def_id), trait_ref.args, fold_Clause)) {
      requirements.push(Unnormalized.skip_norm_wip(u));
    }
  }

  const replace_projection_with = new DefIdMap<Binder<ProjectionClause>[]>();
  for (const bound of object_bounds) {
    const pred = BinderC.skip_binder(bound);
    if (pred.$ === "Projection") {
      // FIXME: We *probably* should replace this with a dummy placeholder,
      // b/c don't want to replace literal instances of this dyn type that
      // show up in the bounds, but just ones that come from substituting
      // `Self` with the dyn type.
      const proj = ExistentialProjection.with_self_ty(pred._0, cx, TraitRefC.self_ty(trait_ref));
      const key = ProjectionClauseImpl.def_id(proj);
      let entry = replace_projection_with.get(key);
      if (entry === undefined) {
        entry = [];
        replace_projection_with.set(key, entry);
      }
      entry.push(BinderC.rebind(bound, proj));
    }
  }

  const folder = new ReplaceProjectionWith(ecx, param_env, TraitRefC.self_ty(trait_ref), replace_projection_with, []);

  const folded = try_fold_with_Vec(requirements, folder, fold_Clause.try_fold_with);
  if (folded.$ === "Err") return folded;
  const requirements_ = folded._0;
  return Ok([
    ...folder.nested,
    ...requirements_.map((clause) => GoalC.new(icx, param_env, clause, upcast_tcx(Predicate_upcast_from_Clause))),
  ]);
}

export class ReplaceProjectionWith implements FallibleTypeFolder<AmbiguousOrRerunNonErased> {
  constructor(
    public ecx: EvalCtxt,
    public param_env: ParamEnv,
    public self_ty: Ty,
    public mapping: DefIdMap<Binder<ProjectionClause>[]>,
    public nested: Goal<Predicate>[],
  ) {}

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:967 projection_may_match
  projection_may_match(source_projection: Binder<ProjectionClause>, target_projection: AliasTermT): Result<boolean, RerunNonErased> {
    if (!DefId_eq(PolyProjectionClause.item_def_id(source_projection), AliasTerm.expect_projection_def_id(target_projection))) {
      return Ok(false);
    }
    const r = this.ecx
      .probe<unknown>(() => ProbeKind.ProjectionCompatibility)
      .enter_without_propagated_nested_goals((ecx): Result<unknown, NoSolutionOrRerunNonErased> => {
        const source_projection_ = ecx.instantiate_binder_with_infer(source_projection, d_ProjectionClause());
        const eq = ecx.eq(this.param_env, source_projection_.projection_term, target_projection, relate_AliasTerm);
        if (eq.$ === "Err") return eq;
        return ecx.try_evaluate_added_goals();
      });
    if (r.$ === "Ok") return Ok(true);
    switch (r._0.$) {
      case "NoSolution":
        return Ok(false);
      case "RerunNonErased":
        return Err(r._0._0);
    }
  }

  /// Try to replace an alias with the term present in the projection bounds of the self type.
  /// Returns `Ok<None>` if this alias is not eligible to be replaced, or bail with
  /// `Err(Ambiguous)` if it's uncertain which projection bound to replace the term with due
  /// to multiple bounds applying, or with `Err(RerunNonErased)` if we have to rerun the
  /// goal in original `TypingMode`.
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:994 try_eagerly_replace_alias
  try_eagerly_replace_alias(alias_term: AliasTermT): Result<Term | undefined, AmbiguousOrRerunNonErased> {
    if (AliasTerm.self_ty(alias_term) !== this.self_ty) {
      return Ok(undefined);
    }

    const replacements = this.mapping.get(AliasTerm.expect_projection_def_id(alias_term));
    if (replacements === undefined) {
      return Ok(undefined);
    }

    // This is quite similar to the `projection_may_match` we use in unsizing,
    // but here we want to unify a projection predicate against an alias term
    // so we can replace it with the projection predicate's term.
    let matching_projection: Binder<ProjectionClause> | undefined = undefined;
    for (const source_projection of replacements) {
      const may_match = this.projection_may_match(source_projection, alias_term);
      if (may_match.$ === "Err") return Err(AmbiguousOrRerunNonErased.from_RerunNonErased(may_match._0));
      if (may_match._0) {
        // FIXME: This *may* have issues with duplicated projections.
        if (matching_projection !== undefined) {
          // If there's more than one projection that we can unify here, then we
          // need to stall until inference constrains things so that there's only
          // one choice.
          return Err(AmbiguousOrRerunNonErased.Ambiguous);
        }
        matching_projection = source_projection;
      }
    }

    const matching = matching_projection;
    if (matching === undefined) {
      // This shouldn't happen.
      return panic(
        `could not replace ${debug_Alias(alias_term, PLAIN, debug_AliasTermKind)} with term from from ${debug_Ty(this.self_ty, PLAIN)}`,
      );
    }

    const replacement = this.ecx.instantiate_binder_with_infer(matching, d_ProjectionClause());
    const goals = this.ecx.eq_and_get_goals(this.param_env, alias_term, replacement.projection_term, relate_AliasTerm);
    if (goals.$ === "Err") {
      return panic("expected to be able to unify goal projection with dyn's projection: NoSolution");
    }
    this.nested.push(...goals._0);

    return Ok(replacement.term);
  }

  // ---- impl FallibleTypeFolder for ReplaceProjectionWith ----
  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:1058 cx
  cx(): TyCtxt {
    return this.ecx.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:1062 try_fold_ty
  try_fold_ty(ty: Ty): Result<Ty, AmbiguousOrRerunNonErased> {
    const kind = ty.kind();
    if (kind.$ === "Alias" && kind._1.kind.$ === "Projection") {
      const alias_ty = kind._1;
      const term = this.try_eagerly_replace_alias(AliasTerm.from_AliasTy(alias_ty));
      if (term.$ === "Err") return term;
      if (term._0 !== undefined) {
        return Ok(Term_provided.expect_ty(term._0));
      }
    }
    return fold_Ty.try_super_fold_with(ty, this);
  }

  // PORT: the provided `FallibleTypeFolder` methods it does not override.
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }

  try_fold_region(r: RegionT): Result<RegionT, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }

  try_fold_const(c: Const): Result<Const, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_const(this, c);
  }

  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, AmbiguousOrRerunNonErased> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

// PORT: no derives upstream (no Debug); the companion holds the `From` impl (header).
export type AmbiguousOrRerunNonErased =
  /// Marker for bailing with ambiguity.
  | { readonly $: "Ambiguous" }
  | { readonly $: "RerunNonErased"; readonly _0: RerunNonErased };
export const AmbiguousOrRerunNonErased = {
  Ambiguous: Object.freeze({ $: "Ambiguous" }) as AmbiguousOrRerunNonErased,

  // rustc: compiler/rustc_next_trait_solver/src/solve/assembly/structural_traits.rs:1046 from
  from_RerunNonErased(rerun: RerunNonErased): AmbiguousOrRerunNonErased {
    return { $: "RerunNonErased", _0: rerun };
  },
} as const;

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** `NoSolution` (unit struct value). */
const NoSolution: NoSolution = Object.freeze({});

/** D4 descriptor of `Vec<I::Ty>` (only `Binder::dummy`'s escaping-bound-vars check visits it). */
const d_VecTy: TypeVisitable<Ty[]> = {
  visit_with: (s, v) => fold_Vec(fold_Ty).visit_with(s, v),
};

/** D4 descriptor of `ty::Binder<I, CoroutineWitnessTypes<I>>` (built lazily: init order). */
function d_Binder_CoroutineWitnessTypes(): TypeFoldable<Binder<CoroutineWitnessTypes>> {
  return fold_Binder<CoroutineWitnessTypes>({
    visit_with: visit_with_CoroutineWitnessTypes,
    try_fold_with: try_fold_with_CoroutineWitnessTypes,
    fold_with: fold_with_CoroutineWitnessTypes,
  });
}

/** D4 descriptor of `ty::ProjectionClause<I>`. */
function d_ProjectionClause(): TypeFoldable<ProjectionClause> {
  return { visit_with: visit_with_ProjectionClause, try_fold_with: try_fold_with_ProjectionClause, fold_with: fold_with_ProjectionClause };
}

/** D4 descriptor of `(I::Clause, I::Span)`. */
function d_Clause_Span(): TypeFoldable<[Clause, Span]> {
  return fold_tuple2(fold_Clause, fold_Span);
}

/**
 * `EarlyBinder<impl IntoIterator<Item = T>>::iter_instantiated(cx, args)`.
 * PORT: rustc_type_ir binder.ts's `iter_instantiated` takes the slice its double-ended iterator needs; the values here
 * (`AdtDef::all_field_tys`'s iterator, the `Interner` bound queries declared `impl IntoIterator`) are collected into
 * one first. Instantiation is per element and pure, so the items are the same as upstream's lazy iterator.
 */
function iter_instantiated_iter<T>(
  cx: TyCtxt,
  binder: EarlyBinder<Iterable<T>>,
  args: readonly GenericArg[],
  d: TypeFoldable<T>,
): Iterable<Unnormalized<T>> {
  return EarlyBinder.iter_instantiated<T>(
    EarlyBinder.map_bound(binder, (it) => Array.from(it)),
    cx,
    args,
    d,
  );
}

/**
 * PORT (D3): an `UpcastFrom` impl of rustc_middle written over `TyCtxt` (`Predicate_upcast_from_*`) used where
 * rustc_type_ir's `Goal::new` wants it over `Interner`; `TyCtxt` is the only `Interner` (nts-eval precedent).
 */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): UpcastFrom<T, P>["upcast_from"] {
  return f as unknown as UpcastFrom<T, P>["upcast_from"];
}
