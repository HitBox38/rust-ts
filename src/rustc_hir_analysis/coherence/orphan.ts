//! Orphan checker: every impl either implements a trait defined in this
//! crate or pertains to a type defined in this crate.
//
// Port of compiler/rustc_hir_analysis/src/coherence/orphan.rs (lane coherence).
//
// PORT notes (file-wide):
// - `rustc_trait_selection::traits::{IsFirstInputType, OrphanCheckErr, OrphanCheckMode, UncoveredTyParams, InCrate,
//   orphan_check_trait_ref}` are rustc_trait_selection traits/coherence.rs's `pub use rustc_next_trait_solver::coherence::*`,
//   so they are imported from rustc_next_trait_solver/coherence.ts directly.
// - `FxIndexSet<DefId>` is a `DefIdSet` (a `KeyedSet`, insertion-ordered).
// - `#[instrument]` and `debug!` are tracing only and stay as comments.
// - `lazily_normalize_ty` has error type `!`, so `.into_ok()` takes the `Ok`.
// Init order: top-level code here touches only other crates.
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { DefineOpaqueTypes } from "../../rustc_infer/infer/at.gen.ts";
import { ToTrace_GenericArg } from "../../rustc_infer/infer/at.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import "../../rustc_infer/lib.ts";
import { UNCOVERED_PARAM_IN_PROJECTION } from "../../rustc_lint_defs/builtin.gen.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { RawList, type Clauses } from "../../rustc_middle/ty/list.ts";
import { ParamEnv, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { fold_tuple2, fold_Vec, type PredicateProxy, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { fold_with_TraitRef, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { type Const, fold_Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import {
  fold_IsFirstInputType,
  type IsFirstInputType,
  type OrphanCheckErr,
  type OrphanCheckMode,
  orphan_check_trait_ref,
} from "../../rustc_next_trait_solver/coherence.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";

const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/coherence/orphan.rs:22 orphan_check_impl
export function orphan_check_impl(tcx: TyCtxt, impl_def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id)));
  const r = TypeVisitableExt.error_reported(trait_ref, d_TraitRef);
  if (r.$ === "Err") return r;

  const proper = orphan_check(tcx, impl_def_id, "Proper");
  if (proper.$ === "Ok") {
    // Ok(()) => {}
  } else {
    const err = proper._0;
    const compat = orphan_check(tcx, impl_def_id, "Compat");
    if (compat.$ === "Ok") {
      switch (err.$) {
        case "UncoveredTyParams": {
          const uncovered_ty_params = err._0;
          const hir_id = tcx.local_def_id_to_hir_id(impl_def_id);

          for (const param_def_id of uncovered_ty_params.uncovered) {
            const ident = tcx.item_ident(param_def_id);

            tcx.emit_node_span_lint(
              UNCOVERED_PARAM_IN_PROJECTION,
              hir_id,
              ident.span,
              diagnostics.UncoveredTyParam_diagnostic({
                param: ident,
                local_ty: uncovered_ty_params.local_ty,
              }),
            );
          }
          break;
        }
        case "NonLocalInputType":
          bug("orphanck: shouldn't've gotten non-local input tys in compat mode");
      }
    } else {
      return Err(emit_orphan_check_error(tcx, trait_ref, impl_def_id, compat._0));
    }
  }

  const trait_def_id = trait_ref.def_id;

  // In addition to the above rules, we restrict impls of auto traits
  // so that they can only be implemented on nominal types, such as structs,
  // enums or foreign types. To see why this restriction exists, consider the
  // following example (#22978). Imagine that crate A defines an auto trait
  // `Foo` and a fn that operates on pairs of types:
  //
  // ```
  // // Crate A
  // auto trait Foo { }
  // fn two_foos<A:Foo,B:Foo>(..) {
  //     one_foo::<(A,B)>(..)
  // }
  // fn one_foo<T:Foo>(..) { .. }
  // ```
  //
  // This type-checks fine; in particular the fn
  // `two_foos` is able to conclude that `(A,B):Foo`
  // because `A:Foo` and `B:Foo`.
  //
  // Now imagine that crate B comes along and does the following:
  //
  // ```
  // struct A { }
  // struct B { }
  // impl Foo for A { }
  // impl Foo for B { }
  // impl !Foo for (A, B) { }
  // ```
  //
  // This final impl is legal according to the orphan
  // rules, but it invalidates the reasoning from
  // `two_foos` above.
  // debug!(
  //     "trait_ref={:?} trait_def_id={:?} trait_is_auto={}",
  //     trait_ref,
  //     trait_def_id,
  //     tcx.trait_is_auto(trait_def_id)
  // );

  if (tcx.trait_is_auto(trait_def_id)) {
    // Expand free alias types (e.g. lazy type aliases) so that the checks below operate
    // on the type the alias resolves to rather than the alias itself. Otherwise an impl
    // whose self type is an alias expanding to an otherwise valid nominal type would be
    // wrongly rejected, e.g. `unsafe impl Sync for Alias {}` where `type Alias = Local;`.
    // Expansion also reveals genuinely problematic self types (trait objects, opaque
    // types, type parameters), so those keep being rejected. See issue #157756.
    const self_ty = tcx.expand_free_alias_tys(TraitRef.self_ty(trait_ref), fold_Ty);

    // If the impl is in the same crate as the auto-trait, almost anything
    // goes.
    //
    //     impl MyAuto for Rc<Something> {}  // okay
    //     impl<T> !MyAuto for *const T {}   // okay
    //     impl<T> MyAuto for T {}           // okay
    //
    // But there is one important exception: implementing for a trait object
    // is not allowed.
    //
    //     impl MyAuto for dyn Trait {}      // NOT OKAY
    //     impl<T: ?Sized> MyAuto for T {}   // NOT OKAY
    //
    // With this restriction, it's guaranteed that an auto-trait is
    // implemented for a trait object if and only if the auto-trait is one
    // of the trait object's trait bounds (or a supertrait of a bound). In
    // other words `dyn Trait + AutoTrait` always implements AutoTrait,
    // while `dyn Trait` never implements AutoTrait.
    //
    // This is necessary in order for autotrait bounds on methods of trait
    // objects to be sound.
    //
    //     auto trait AutoTrait {}
    //
    //     trait DynCompatibleTrait {
    //         fn f(&self) where Self: AutoTrait;
    //     }
    //
    // We can allow f to be called on `dyn DynCompatibleTrait + AutoTrait`.
    //
    // If we didn't deny `impl AutoTrait for dyn Trait`, it would be unsound
    // for the `DynCompatibleTrait` shown above to be dyn-compatible because someone
    // could take some type implementing `DynCompatibleTrait` but not `AutoTrait`,
    // unsize it to `dyn DynCompatibleTrait`, and call `.f()` which has no
    // concrete implementation (issue #50781).
    type LocalImpl = { $: "Allow" } | { $: "Disallow"; problematic_kind: string };

    // If the auto-trait is from a dependency, it must only be getting
    // implemented for a nominal type, and specifically one local to the
    // current crate.
    //
    //     impl<T> Sync for MyStruct<T> {}   // okay
    //
    //     impl Sync for Rc<MyStruct> {}     // NOT OKAY
    type NonlocalImpl = "Allow" | "DisallowBecauseNonlocal" | "DisallowOther";

    // Exhaustive match considering that this logic is essential for
    // soundness.
    let local_impl: LocalImpl;
    let nonlocal_impl: NonlocalImpl;
    const k = self_ty.kind();
    switch (k.$) {
      // struct Struct<T>;
      // impl AutoTrait for Struct<Foo> {}
      case "Adt": {
        const self_def = k._0;
        local_impl = { $: "Allow" };
        nonlocal_impl = self_def.did().is_local() ? "Allow" : "DisallowBecauseNonlocal";
        break;
      }

      // extern { type OpaqueType; }
      // impl AutoTrait for OpaqueType {}
      case "Foreign": {
        const did = k._0;
        local_impl = { $: "Allow" };
        nonlocal_impl = did.is_local() ? "Allow" : "DisallowBecauseNonlocal";
        break;
      }

      // impl AutoTrait for dyn Trait {}
      case "Dynamic":
        local_impl = { $: "Disallow", problematic_kind: "trait object" };
        nonlocal_impl = "DisallowOther";
        break;

      // impl<T> AutoTrait for T {}
      // impl<T: ?Sized> AutoTrait for T {}
      case "Param":
        local_impl = self_ty.is_sized(tcx, TypingEnv.non_body_analysis(tcx, impl_def_id)) ? { $: "Allow" } : { $: "Disallow", problematic_kind: "generic type" };
        nonlocal_impl = "DisallowOther";
        break;

      case "Alias": {
        const kind = k._1.kind;
        let problematic_kind: string;
        switch (kind.$) {
          // trait Id { type This: ?Sized; }
          // impl<T: ?Sized> Id for T {
          //     type This = T;
          // }
          // impl<T: ?Sized> AutoTrait for <T as Id>::This {}
          case "Projection":
            problematic_kind = "associated type";
            break;
          // type Foo = (impl Sized, bool)
          // impl AutoTrait for Foo {}
          case "Free":
            problematic_kind = "type alias";
            break;
          // type Opaque = impl Trait;
          // impl AutoTrait for Opaque {}
          case "Opaque":
            problematic_kind = "opaque type";
            break;
          // ```
          // struct S<T>(T);
          // impl<T: ?Sized> S<T> {
          //     type This = T;
          // }
          // impl<T: ?Sized> AutoTrait for S<T>::This {}
          // ```
          // FIXME(inherent_associated_types): The example code above currently leads to a cycle
          case "Inherent":
            problematic_kind = "associated type";
            break;
        }
        local_impl = { $: "Disallow", problematic_kind };
        nonlocal_impl = "DisallowOther";
        break;
      }

      case "Bool":
      case "Pat":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "FnPtr":
      case "Never":
      case "Tuple":
      case "UnsafeBinder":
        local_impl = { $: "Allow" };
        nonlocal_impl = "DisallowOther";
        break;

      case "FnDef":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Bound":
      case "Placeholder":
      case "Infer": {
        const sp = tcx.def_span(impl_def_id);
        return span_bug(sp, "weird self type for autotrait impl");
      }

      case "Error":
        local_impl = { $: "Allow" };
        nonlocal_impl = "Allow";
        break;
    }

    if (trait_def_id.is_local()) {
      switch (local_impl.$) {
        case "Allow":
          break;
        case "Disallow": {
          const problematic_kind = local_impl.problematic_kind;
          return Err(
            tcx.dcx().emit_err(
              diagnostics.TraitsWithDefaultImpl_diagnostic({
                span: tcx.def_span(impl_def_id),
                traits: tcx.def_path_str(trait_def_id),
                problematic_kind,
                self_ty,
              }),
            ),
          );
        }
      }
    } else {
      switch (nonlocal_impl) {
        case "Allow":
          break;
        case "DisallowBecauseNonlocal":
          return Err(
            tcx.dcx().emit_err(
              diagnostics.CrossCrateTraitsDefined_diagnostic({
                span: tcx.def_span(impl_def_id),
                traits: tcx.def_path_str(trait_def_id),
              }),
            ),
          );
        case "DisallowOther":
          return Err(
            tcx.dcx().emit_err(
              diagnostics.CrossCrateTraits_diagnostic({
                span: tcx.def_span(impl_def_id),
                traits: tcx.def_path_str(trait_def_id),
                self_ty,
              }),
            ),
          );
      }
    }
  }

  return Ok(null);
}

/// Checks the coherence orphan rules.
///
/// `impl_def_id` should be the `DefId` of a trait impl.
///
/// To pass, either the trait must be local, or else two conditions must be satisfied:
///
/// 1. All type parameters in `Self` must be "covered" by some local type constructor.
/// 2. Some local type must appear in `Self`.
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_hir_analysis/src/coherence/orphan.rs:305 orphan_check
function orphan_check(tcx: TyCtxt, impl_def_id: LocalDefId, mode: OrphanCheckMode): Result<null, OrphanCheckErr<DefIdSet>> {
  // We only accept this routine to be invoked on implementations
  // of a trait, not inherent implementations.
  const trait_ref0 = tcx.impl_trait_ref(impl_def_id);
  // debug!(trait_ref = ?trait_ref.skip_binder());

  // If the *trait* is local to the crate, ok.
  const def_id = EarlyBinder.skip_binder(trait_ref0).def_id.as_local();
  if (def_id !== undefined) {
    // debug!("trait {def_id:?} is local to current crate");
    return Ok(null);
  }

  // (1)  Instantiate all generic params with fresh inference vars.
  const infcx = tcx.infer_ctxt().with_next_trait_solver(true).enable_next_solver_overflow_fcw(false).build(TypingMode.Coherence);
  const cause = ObligationCause.dummy();
  const args = infcx.fresh_args_for_item(cause.span, LocalDefId.to_def_id(impl_def_id));
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(trait_ref0, tcx, args, d_TraitRef));

  const lazily_normalize_ty = (user_ty: Ty): Result<Ty, never> => {
    if (user_ty.kind().$ !== "Alias") return Ok(user_ty);

    const ocx = ObligationCtxt.new(infcx);
    let ty = ocx.normalize(cause, ParamEnv.empty(), Unnormalized.new_wip(user_ty), fold_Ty);
    ty = infcx.deeply_resolve_ignoring_regions(ty, fold_Ty);
    const errors = ocx.try_evaluate_obligations();
    if (!TraitErrors.no_errors(errors)) {
      return Ok(user_ty);
    }

    return Ok(ty);
  };

  const result0 = orphan_check_trait_ref(infcx, trait_ref, { $: "Local", mode }, lazily_normalize_ty);
  // `.into_ok()`
  const result = (result0 as { $: "Ok"; _0: Result<undefined, OrphanCheckErr<Ty>> })._0;

  // (2)  Try to map the remaining inference vars back to generic params.
  if (result.$ === "Ok") return Ok(null);
  const err = result._0;
  switch (err.$) {
    case "UncoveredTyParams": {
      const { uncovered, local_ty } = err._0;
      const collector = new UncoveredTyParamCollector(infcx, new DefIdSet());
      fold_Ty.visit_with(uncovered, collector);
      // FIXME(fmease): This is very likely reachable.
      // debug_assert!(!collector.uncovered_params.is_empty());

      return Err({ $: "UncoveredTyParams", _0: { uncovered: collector.uncovered_params, local_ty } });
    }
    case "NonLocalInputType": {
      const tys0 = err._0;
      const tys = infcx.probe(() => {
        // Map the unconstrained args back to their params,
        // ignoring any type unification errors.
        const id_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(impl_def_id));
        const n = Math.min(args.length, id_args.length);
        for (let i = 0; i < n; i++) {
          const arg = args[i]!;
          const id_arg = id_args[i]!;
          void infcx.at(cause, ParamEnv.empty()).eq(DefineOpaqueTypes.No, arg, id_arg, ToTrace_GenericArg);
        }
        return infcx.deeply_resolve_ignoring_regions(tys0, fold_Vec(fold_tuple2(fold_Ty, fold_IsFirstInputType)));
      });
      return Err({ $: "NonLocalInputType", _0: tys as [Ty, IsFirstInputType][] });
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/coherence/orphan.rs:387 emit_orphan_check_error
function emit_orphan_check_error(tcx: TyCtxt, trait_ref: TraitRefT, impl_def_id: LocalDefId, err: OrphanCheckErr<DefIdSet>): ErrorGuaranteed {
  switch (err.$) {
    case "NonLocalInputType": {
      const tys = err._0;
      const item = tcx.hir_expect_item(impl_def_id);
      const impl_ = item.expect_impl();
      const of_trait = impl_.of_trait;
      if (of_trait === undefined) return bug("called `Option::unwrap()` on a `None` value");

      const span = tcx.def_span(impl_def_id);
      const self_kind = TraitRef.self_ty(trait_ref).kind();
      let d: diagnostics.OnlyCurrentTraits;
      if (self_kind.$ === "Adt") {
        d = { $: "Outside", span, note: null };
      } else if (TraitRef.self_ty(trait_ref).is_primitive()) {
        d = { $: "Primitive", span, note: null };
      } else {
        d = { $: "Arbitrary", span, note: null };
      }
      const diag = tcx.dcx().create_err(diagnostics.OnlyCurrentTraits_diagnostic(d));

      for (const [ty0, is_target_ty] of tys) {
        let ty = ty0;
        let span: Span;
        if (is_target_ty === "Yes") {
          // Point at `D<A>` in `impl<A, B> for C<B> in D<A>`
          span = impl_.self_ty.span;
        } else {
          // Point at `C<B>` in `impl<A, B> for C<B> in D<A>`
          span = of_trait.trait_ref.path.span;
        }

        ty = tcx.erase_and_anonymize_regions(ty, fold_Ty);

        const is_foreign = !trait_ref.def_id.is_local() && is_target_ty === "No";

        /** The `_` arm. */
        const other_arm = (ty: Ty): void => {
          if (is_foreign) {
            diag.subdiagnostic(diagnostics.OnlyCurrentTraitsForeign_subdiagnostic({ span }));
          } else {
            diag.subdiagnostic(diagnostics.OnlyCurrentTraitsTy_subdiagnostic({ span, ty }));
          }
        };

        const k = ty.kind();
        switch (k.$) {
          case "Slice":
            if (is_foreign) {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsForeign_subdiagnostic({ span }));
            } else {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsName_subdiagnostic({ span, name: "slices" }));
            }
            break;
          case "Array":
            if (is_foreign) {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsForeign_subdiagnostic({ span }));
            } else {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsName_subdiagnostic({ span, name: "arrays" }));
            }
            break;
          case "Tuple":
            if (is_foreign) {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsForeign_subdiagnostic({ span }));
            } else {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsName_subdiagnostic({ span, name: "tuples" }));
            }
            break;
          case "Alias":
            if (k._1.kind.$ === "Opaque") {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsOpaque_subdiagnostic({ span }));
              break;
            }
            other_arm(ty);
            break;
          case "RawPtr": {
            const [ptr_ty, mutbl] = [k._0, k._1];
            if (!TypeVisitableExt.has_param(TraitRef.self_ty(trait_ref), fold_Ty)) {
              diag.subdiagnostic(
                diagnostics.OnlyCurrentTraitsPointerSugg_subdiagnostic({
                  wrapper_span: impl_.self_ty.span,
                  struct_span: Span.shrink_to_lo(item.span),
                  mut_key: Mutability.prefix_str(mutbl),
                  ptr_ty,
                }),
              );
            }
            diag.subdiagnostic(diagnostics.OnlyCurrentTraitsPointer_subdiagnostic({ span, pointer: ty }));
            break;
          }
          case "Adt": {
            const adt_def = k._0;
            if (is_foreign) {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsForeign_subdiagnostic({ span }));
            } else {
              diag.subdiagnostic(diagnostics.OnlyCurrentTraitsAdt_subdiagnostic({ span, name: tcx.def_path_str(adt_def.did()) }));
            }
            break;
          }
          default:
            other_arm(ty);
            break;
        }
      }

      return diag.emit_err();
    }
    case "UncoveredTyParams": {
      const { uncovered, local_ty } = err._0;
      let guar: ErrorGuaranteed | undefined = undefined;
      for (const param_def_id of uncovered) {
        // `guar.get_or_insert(..)`: the argument is evaluated (and the error emitted) on every iteration.
        const g = tcx.dcx().emit_err(
          diagnostics.UncoveredTyParam_diagnostic({
            param: tcx.item_ident(param_def_id),
            local_ty,
          }),
        );
        if (guar === undefined) guar = g;
      }
      if (guar === undefined) return bug("called `Option::unwrap()` on a `None` value");
      return guar;
    }
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/coherence/orphan.rs:505 UncoveredTyParamCollector
class UncoveredTyParamCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public infcx: InferCtxt,
    public uncovered_params: DefIdSet,
  ) {}

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/orphan.rs:511 visit_ty
  visit_ty(ty: Ty): undefined {
    if (!TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_TY_INFER, fold_Ty)) {
      return undefined;
    }
    const k = ty.kind();
    if (!(k.$ === "Infer" && k._0.$ === "TyVar")) {
      return fold_Ty.super_visit_with(ty, this);
    }
    const vid = k._0._0;
    const origin = this.infcx.type_var_origin(vid);
    const def_id = origin.param_def_id;
    if (def_id !== undefined) {
      this.uncovered_params.add(def_id);
    }
    return undefined;
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/orphan.rs:524 visit_const
  visit_const(ct: Const): undefined {
    if (TypeVisitableExt.has_type_flags(ct, TypeFlags.HAS_TY_INFER, fold_Const)) {
      return fold_Const.super_visit_with(ct, this);
    }
    return undefined;
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}
