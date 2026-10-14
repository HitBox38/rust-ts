// Port of compiler/rustc_type_ir/src/relate/combine.rs (lane tyir-relate).
//
// PORT (D3/D4): `Infcx: InferCtxtLike<Interner = I>` is the interface `InferCtxtLike` below, `I` is erased (`TyCtxt`),
// `R: PredicateEmittingRelation<Infcx>` is the interface `PredicateEmittingRelation`. `impl Upcast<I, I::Predicate>`
// items are passed with their upcast function (`Upcast<T, Predicate>`, the `UpcastFrom` impl that `.upcast(cx)`
// selects). `debug!` / `debug_assert!` stay comments (see ../relate.ts header).
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArg, type GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Term, Ty } from "../../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import type { Binder } from "../binder.ts";
import type { ConstVid } from "../const_kind.ts";
import { ExpectedFound } from "../error.ts";
import type { TypeFoldable, VisitWith } from "../fold.ts";
import type { TypingMode } from "../infer_ctxt.ts";
import { CollectAndApply_Result } from "../interner.ts";
import type { Variance } from "../lib.ts";
import type { ProjectionClause } from "../predicate.ts";
import { type ClauseKind, type PredicateKind, visit_with_PredicateKind } from "../predicate_kind.ts";
import { interner, relate_GenericArg, type RelateResult, structurally_relate_consts, structurally_relate_tys, type TypeRelation, VarianceDiagInfo } from "../relate.ts";
import type { Goal, VisibleForLeakCheck } from "../solve/mod.ts";
import { type Const, debug_Const } from "../sty/consts.ts";
import type { Region } from "../sty/mod.ts";
import { AliasTerm } from "../term_kind.ts";
import type { FloatVarValue, FloatVid, IntVarValue, IntVid, TyVid } from "../ty_kind.ts";

// ---- PORT(pending): contract pieces of other lanes' files that do not exist yet ------------------------------------

/**
 * PORT(pending): the slice of `trait InferCtxtLike` (infer_ctxt.rs:387, lane tyir-misc) that the relate code calls,
 * with the D4 conventions (descriptors last, `R: PredicateEmittingRelation` as the interface, `I` erased).
 * Root replaces it with the real interface when infer_ctxt.rs lands.
 */
export interface InferCtxtLike {
  cx(): TyCtxt;
  /** (provided upstream: `self.cx().next_trait_solver_globally()`) */
  next_trait_solver(): boolean;
  typing_mode_raw(): TypingMode;
  next_ty_infer(): Ty;
  instantiate_binder_with_infer<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;
  enter_forall_with_empty_assumptions<T, U>(value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U;
  equate_ty_vids_raw(a: TyVid, b: TyVid): void;
  equate_int_vids_raw(a: IntVid, b: IntVid): void;
  equate_float_vids_raw(a: FloatVid, b: FloatVid): void;
  equate_const_vids_raw(a: ConstVid, b: ConstVid): void;
  instantiate_ty_var(relation: PredicateEmittingRelation, target_is_expected: boolean, target_vid: TyVid, instantiation_variance: Variance, source_ty: Ty): RelateResult<null>;
  instantiate_int_var_raw(vid: IntVid, value: IntVarValue): void;
  instantiate_float_var_raw(vid: FloatVid, value: FloatVarValue): void;
  instantiate_const_var(relation: PredicateEmittingRelation, target_is_expected: boolean, target_vid: ConstVid, source_ct: Const): RelateResult<null>;
  set_tainted_by_errors(e: ErrorGuaranteed): void;
  shallow_resolve(ty: Ty): Ty;
  shallow_resolve_const(ty: Const): Const;
  deeply_resolve_ignoring_regions<T>(value: T, d_T: TypeFoldable<T>): T;
  sub_regions(sub: Region, sup: Region, vis: VisibleForLeakCheck, span: Span): void;
  equate_regions(a: Region, b: Region, vis: VisibleForLeakCheck, span: Span): void;
}

/** PORT(pending): `trait Upcast<I, T>` (upcast.rs:2, lane tyir-misc) as the function its `UpcastFrom` impl provides. */
export type Upcast<T, U> = (from: T, interner: TyCtxt) => U;

/** PORT: stand-in for `Goal::new` (solve/mod.rs:401, lane tyir-solve). */
export function Goal_new<P, T>(cx: TyCtxt, param_env: ParamEnv, predicate: T, upcast: Upcast<T, P>): Goal<P> {
  return { param_env, predicate: upcast(predicate, cx) };
}

/** PORT: stand-in for `Binder::dummy` (binder.rs:47, lane tyir-binder): its `assert!` needs
 *  `TypeVisitableExt::has_escaping_bound_vars`. */
export function Binder_dummy<T>(_value: T, _visit_with_T: VisitWith<T>): Binder<T> {
  return unported("rustc_type_ir::binder::Binder::dummy (TypeVisitableExt::has_escaping_bound_vars, lane tyir-binder)");
}

/** PORT: stand-in for `TypeVisitableExt::has_non_region_infer` on `GenericArg` (visit.rs, lane tyir-binder). */
function GenericArg_has_non_region_infer(_self: GenericArg): boolean {
  return unported("rustc_type_ir::visit::TypeVisitableExt::has_non_region_infer (lane tyir-binder)");
}

/** PORT: stand-in for `TypingMode::assert_not_erased` (infer_ctxt.rs:285, lane tyir-misc). */
function TypingMode_assert_not_erased(self: TypingMode): TypingMode {
  if (self.$ === "ErasedNotCoherence") {
    return panic(
      "Called `assert_not_erased` from a place that can be called by the trait solver in `TypingMode::ErasedNotCoherence`. `TypingMode` is `ErasedNotCoherence` in a place where that should be impossible",
    );
  }
  return self;
}

// PORT: stand-ins for the `UpcastFrom` impls of rustc_middle ty/predicate.rs (lane ty-args), named
// `upcast_<From>_<To>`. Bodies are upstream's.

/** `impl UpcastFrom<TyCtxt, PredicateKind> for Predicate` (rustc_middle ty/predicate.rs:455). */
export function upcast_PredicateKind_Predicate(from: PredicateKind, tcx: TyCtxt): Predicate {
  return upcast_Binder_PredicateKind_Predicate(Binder_dummy(from, visit_with_PredicateKind), tcx);
}

/** `impl UpcastFrom<TyCtxt, Binder<PredicateKind>> for Predicate` (rustc_middle ty/predicate.rs:461). */
export function upcast_Binder_PredicateKind_Predicate(from: Binder<PredicateKind>, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(from);
}

/** `impl UpcastFrom<TyCtxt, ClauseKind> for Predicate` (rustc_middle ty/predicate.rs:467). */
export function upcast_ClauseKind_Predicate(from: ClauseKind, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(Binder_dummy<PredicateKind>({ $: "Clause", _0: from }, visit_with_PredicateKind));
}

/** `impl UpcastFrom<TyCtxt, ProjectionClause> for Predicate` (rustc_middle ty/predicate.rs:575). */
export function upcast_ProjectionClause_Predicate(from: ProjectionClause, tcx: TyCtxt): Predicate {
  return upcast_Binder_PredicateKind_Predicate(Binder_dummy<PredicateKind>({ $: "Clause", _0: { $: "Projection", _0: from } }, visit_with_PredicateKind), tcx);
}

// ---- combine.rs ---------------------------------------------------------------------------------------------------

// rustc-trait: compiler/rustc_type_ir/src/relate/combine.rs:15 PredicateEmittingRelation
export interface PredicateEmittingRelation extends TypeRelation {
  // rustc: compiler/rustc_type_ir/src/relate/combine.rs:21 span
  span(): Span;

  // rustc: compiler/rustc_type_ir/src/relate/combine.rs:23 param_env
  param_env(): ParamEnv;

  /// Register obligations that must hold in order for this relation to hold
  // rustc: compiler/rustc_type_ir/src/relate/combine.rs:26 register_goals
  register_goals(obligations: Iterable<Goal<Predicate>>): void;

  /// Register predicates that must hold in order for this relation to hold.
  /// This uses the default `param_env` of the obligation.
  // PORT: `impl IntoIterator<Item: Upcast<I, I::Predicate>>` takes the items' upcast function.
  // rustc: compiler/rustc_type_ir/src/relate/combine.rs:30 register_predicates
  register_predicates<T>(obligations: Iterable<T>, upcast: Upcast<T, Predicate>): void;
}

// rustc: compiler/rustc_type_ir/src/relate/combine.rs:36 super_combine_tys
export function super_combine_tys(infcx: InferCtxtLike, relation: PredicateEmittingRelation, a: Ty, b: Ty): RelateResult<Ty> {
  // debug!("super_combine_tys::<{}>({:?}, {:?})", std::any::type_name::<R>(), a, b);
  // debug_assert!(!a.has_escaping_bound_vars());
  // debug_assert!(!b.has_escaping_bound_vars());

  const ak = a.kind();
  const bk = b.kind();
  if (ak.$ === "Error" || bk.$ === "Error") {
    const e = ak.$ === "Error" ? ak._0 : (bk as { _0: ErrorGuaranteed })._0;
    infcx.set_tainted_by_errors(e);
    return Ok(Ty.new_error(infcx.cx(), e));
  }

  // Relate integral variables to other types
  if (ak.$ === "Infer" && ak._0.$ === "IntVar" && bk.$ === "Infer" && bk._0.$ === "IntVar") {
    infcx.equate_int_vids_raw(ak._0._0, bk._0._0);
    return Ok(a);
  }
  if (ak.$ === "Infer" && ak._0.$ === "IntVar" && bk.$ === "Int") {
    infcx.instantiate_int_var_raw(ak._0._0, { $: "IntType", _0: bk._0 });
    return Ok(b);
  }
  if (ak.$ === "Int" && bk.$ === "Infer" && bk._0.$ === "IntVar") {
    infcx.instantiate_int_var_raw(bk._0._0, { $: "IntType", _0: ak._0 });
    return Ok(a);
  }
  if (ak.$ === "Infer" && ak._0.$ === "IntVar" && bk.$ === "Uint") {
    infcx.instantiate_int_var_raw(ak._0._0, { $: "UintType", _0: bk._0 });
    return Ok(b);
  }
  if (ak.$ === "Uint" && bk.$ === "Infer" && bk._0.$ === "IntVar") {
    infcx.instantiate_int_var_raw(bk._0._0, { $: "UintType", _0: ak._0 });
    return Ok(a);
  }

  // Relate floating-point variables to other types
  if (ak.$ === "Infer" && ak._0.$ === "FloatVar" && bk.$ === "Infer" && bk._0.$ === "FloatVar") {
    infcx.equate_float_vids_raw(ak._0._0, bk._0._0);
    return Ok(a);
  }
  if (ak.$ === "Infer" && ak._0.$ === "FloatVar" && bk.$ === "Float") {
    infcx.instantiate_float_var_raw(ak._0._0, { $: "Known", _0: bk._0 });
    return Ok(b);
  }
  if (ak.$ === "Float" && bk.$ === "Infer" && bk._0.$ === "FloatVar") {
    infcx.instantiate_float_var_raw(bk._0._0, { $: "Known", _0: ak._0 });
    return Ok(a);
  }

  // We don't expect `TyVar` or `Fresh*` vars at this point with lazy norm.
  if (((ak.$ === "Alias" && bk.$ === "Infer" && bk._0.$ === "TyVar") || (ak.$ === "Infer" && ak._0.$ === "TyVar" && bk.$ === "Alias")) && infcx.next_trait_solver()) {
    return panic("We do not expect to encounter `TyVar` this late in combine -- they should have been handled earlier");
  }
  const is_fresh = (k: typeof ak): boolean => k.$ === "Infer" && (k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy");
  if ((is_fresh(bk) || is_fresh(ak)) && infcx.next_trait_solver()) {
    return panic("We do not expect to encounter `Fresh` variables in the new solver");
  }
  if (((ak.$ === "Alias" && ak._0 === "No") || (bk.$ === "Alias" && bk._0 === "No")) && infcx.next_trait_solver()) {
    return panic("non-rigid aliases should be handled in the caller of super_combine_tys");
  }

  // All other cases of inference are errors
  if (ak.$ === "Infer" || bk.$ === "Infer") return Err({ $: "Sorts", _0: ExpectedFound.new(a, b) });

  if (((ak.$ === "Alias" && ak._1.kind.$ === "Opaque") || (bk.$ === "Alias" && bk._1.kind.$ === "Opaque")) && !infcx.next_trait_solver()) {
    const mode = TypingMode_assert_not_erased(infcx.typing_mode_raw());
    switch (mode.$) {
      // During coherence, opaque types should be treated as *possibly*
      // equal to any other type. This is an
      // extremely heavy hammer, but can be relaxed in a forwards-compatible
      // way later.
      case "Coherence":
        relation.register_predicates([Binder_dummy<PredicateKind>({ $: "Ambiguous" }, visit_with_PredicateKind)], upcast_Binder_PredicateKind_Predicate);
        return Ok(a);
      case "Typeck":
      case "Reflection":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
      case "PostAnalysis":
      case "Codegen":
      case "ErasedNotCoherence": // PORT: unreachable (`assert_not_erased` panicked); `CantBeErased` is uninhabited
        return structurally_relate_tys(relation, a, b);
    }
  }

  return structurally_relate_tys(relation, a, b);
}

// rustc: compiler/rustc_type_ir/src/relate/combine.rs:143 super_combine_consts
export function super_combine_consts(infcx: InferCtxtLike, relation: PredicateEmittingRelation, a: Const, b: Const): RelateResult<Const> {
  // debug!("super_combine_consts::<{}>({:?}, {:?})", std::any::type_name::<R>(), a, b);
  // debug_assert!(!a.has_escaping_bound_vars());
  // debug_assert!(!b.has_escaping_bound_vars());

  if (a === b) {
    return Ok(a);
  }

  a = infcx.shallow_resolve_const(a);
  b = infcx.shallow_resolve_const(b);

  const ak = a.kind();
  const bk = b.kind();
  const is_var = (k: typeof ak): k is { $: "Infer"; _0: { $: "Var"; _0: ConstVid } } => k.$ === "Infer" && k._0.$ === "Var";
  if (is_var(ak) && is_var(bk)) {
    infcx.equate_const_vids_raw(ak._0._0, bk._0._0);
    return Ok(a);
  }

  // All other cases of inference with other variables are errors.
  if ((is_var(ak) && bk.$ === "Infer") || (ak.$ === "Infer" && is_var(bk))) {
    return panic(`tried to combine ConstKind::Infer/ConstKind::Infer(InferConst::Var): ${debug_Const(a, PLAIN)} and ${debug_Const(b, PLAIN)}`);
  }

  if (ak.$ === "Alias" && ak._0 === "No" && infcx.next_trait_solver()) {
    const alias = ak._1;
    const clause: ProjectionClause = {
      projection_term: AliasTerm.from_AliasConst(alias),
      term: Term.from_Const(b),
    };
    relation.register_predicates([clause], upcast_ProjectionClause_Predicate);
    return Ok(b);
  }
  if (bk.$ === "Alias" && bk._0 === "No" && infcx.next_trait_solver()) {
    const alias = bk._1;
    const clause: ProjectionClause = {
      projection_term: AliasTerm.from_AliasConst(alias),
      term: Term.from_Const(a),
    };
    relation.register_predicates([clause], upcast_ProjectionClause_Predicate);
    return Ok(b);
  }

  if (is_var(ak)) {
    const r = infcx.instantiate_const_var(relation, true, ak._0._0, b);
    if (r.$ === "Err") return r;
    return Ok(b);
  }

  if (is_var(bk)) {
    const r = infcx.instantiate_const_var(relation, false, bk._0._0, a);
    if (r.$ === "Err") return r;
    return Ok(a);
  }

  if (((ak.$ === "Alias" && ak._0 === "No") || (bk.$ === "Alias" && bk._0 === "No")) && infcx.cx().features().generic_const_exprs()) {
    relation.register_predicates<PredicateKind>([{ $: "ConstEquate", _0: a, _1: b }], upcast_PredicateKind_Predicate);
    return Ok(b);
  }

  return structurally_relate_consts(relation, a, b);
}

// rustc: compiler/rustc_type_ir/src/relate/combine.rs:219 combine_ty_args
export function combine_ty_args(
  infcx: InferCtxtLike,
  relation: PredicateEmittingRelation,
  a_ty: Ty,
  b_ty: Ty,
  variances: readonly Variance[],
  a_args: GenericArgs,
  b_args: GenericArgs,
  mk: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  const cx = infcx.cx();
  let has_unconstrained_bivariant_arg = false;
  const args_iter = (function* () {
    const n = Math.min(a_args.length, b_args.length);
    for (let i = 0; i < n; i++) {
      const [a, b] = [a_args[i], b_args[i]];
      const variance = unwrap(variances[i]);
      let variance_info: VarianceDiagInfo;
      switch (variance) {
        case "Invariant":
          // PORT: `i.try_into().unwrap()` (usize -> u32) cannot fail for a slice index here.
          variance_info = { $: "Invariant", ty: a_ty, param_index: i };
          break;
        case "Covariant":
        case "Contravariant":
          variance_info = VarianceDiagInfo.None;
          break;
        case "Bivariant": {
          const has_non_region_infer = (arg: GenericArg): boolean =>
            GenericArg_has_non_region_infer(arg) && GenericArg_has_non_region_infer(infcx.deeply_resolve_ignoring_regions(arg, fold_GenericArg));
          if (has_non_region_infer(a) || has_non_region_infer(b)) {
            has_unconstrained_bivariant_arg = true;
          }
          variance_info = VarianceDiagInfo.None;
          break;
        }
      }
      yield relation.relate_with_variance(variance, variance_info, a, b, relate_GenericArg);
    }
  })();
  const args = interner(cx).mk_args_from_iter(args_iter, CollectAndApply_Result);
  if (args.$ === "Err") return args;

  // In general, we do not check whether all types which occur during
  // type checking are well-formed. We only check wf of user-provided types
  // and when actually using a type, e.g. for method calls.
  //
  // This means that when subtyping, we may end up with unconstrained
  // inference variables if a generalized type has bivariant parameters.
  // A parameter may only be bivariant if it is constrained by a projection
  // bound in a where-clause. As an example, imagine a type:
  //
  //     struct Foo<A, B> where A: Iterator<Item = B> {
  //         data: A
  //     }
  //
  // here, `A` will be covariant, but `B` is unconstrained. However, whatever it is,
  // for `Foo` to be WF, it must be equal to `A::Item`.
  //
  // If we have an input `Foo<?A, ?B>`, then after generalization we will wind
  // up with a type like `Foo<?C, ?D>`. When we enforce `Foo<?A, ?B> <: Foo<?C, ?D>`,
  // we will wind up with the requirement that `?A <: ?C`, but no particular
  // relationship between `?B` and `?D` (after all, these types may be completely
  // different). If we do nothing else, this may mean that `?D` goes unconstrained
  // (as in #41677). To avoid this we emit a `WellFormed` when relating types with
  // bivariant arguments.
  if (has_unconstrained_bivariant_arg) {
    relation.register_predicates<ClauseKind>(
      [
        { $: "WellFormed", _0: Term.from_Ty(a_ty) },
        { $: "WellFormed", _0: Term.from_Ty(b_ty) },
      ],
      upcast_ClauseKind_Predicate,
    );
  }

  if (a_args === args._0) {
    return Ok(a_ty);
  } else {
    return Ok(mk(args._0));
  }
}
