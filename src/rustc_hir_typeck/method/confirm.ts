// Port of compiler/rustc_hir_typeck/src/method/confirm.rs (lane typeck-method).
//
// `ConfirmContext` and `ConfirmResult` are generated (confirm.gen.ts); `ConfirmContext`'s methods are assigned onto its
// prototype (declared in ../decls.ts), `impl Deref for ConfirmContext` is the `register_deref` below (decls.ts "Deref").
// - `ConfirmContext::instantiate_binder_with_fresh_vars` shadows `FnCtxt`'s (decls.ts `ConfirmContext_shadowed`): inside
//   a ConfirmContext method `this.instantiate_binder_with_fresh_vars(v, d)` is the own one, `this.fcx.<..>` FnCtxt's.
// - The local `struct GenericArgsCtxt` (`impl GenericArgsLowerer`) of `instantiate_method_args` is a class local to it.
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only ../decls.ts, this file's .gen.ts and other crates.
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { DiagDecorator } from "../../rustc_errors/diagnostic.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { debug_GenericArg as debug_hir_GenericArg } from "../../rustc_hir/hir.gen.ts";
import type { GenericArgsLowerer } from "../../rustc_hir_analysis/decls.ts";
import { check_generic_arg_count_for_value_path, lower_generic_args } from "../../rustc_hir_analysis/hir_ty_lowering/generics.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.ts";
import { AMBIGUOUS_GLOB_IMPORTED_TRAITS, RESOLVING_TO_ITEMS_SHADOWING_SUPERTRAIT_ITEMS } from "../../rustc_lint_defs/builtin.gen.ts";
import type { ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import { type Adjustment, AutoBorrowMutability, Mutability_from_AutoBorrowMutability } from "../../rustc_middle/ty/adjustment.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { fold_GenericArgs, GenericArg, type GenericArgs, type UserArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_GenericParamDefKind, type GenericParamDef, GenericClauses, type Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type InstantiatedClauses, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { UserType } from "../../rustc_middle/ty/typeck_results.ts";
import { debug_DefId, type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { DiagSymbolList_from } from "../../rustc_errors/diagnostic_impls.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Symbol, type Symbol } from "../../rustc_span/symbol.ts";
import { predicates_for_generics, upcast_choices } from "../../rustc_trait_selection/traits/mod.ts";
import { Binder, debug_Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyExistentialTraitRef as PolyExistentialTraitRefT, PolyFnSig, PolyTraitRef, TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { Elaboratable_Clause, elaborate } from "../../rustc_type_ir/elaborate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, fold_with_TraitRef, PolyExistentialTraitRef, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { debug_TyKind, fold_FnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { check_legal_trait_for_method_call } from "../callee.ts";
import { FnCtxt, register_deref } from "../decls.ts";
import type { SupertraitItemShadowee, SupertraitItemShadower } from "../diagnostics.gen.ts";
import { SupertraitItemShadowing_diagnostic } from "../diagnostics.gen.ts";
import type { MethodCallee } from "./mod.gen.ts";
import type { Pick } from "./probe.gen.ts";
import { ConfirmContext, type ConfirmResult } from "./confirm.gen.ts";

export * from "./confirm.gen.ts";

/** The `TypeFoldable` descriptor of `ty::PolyFnSig` (`Binder<FnSig>`). */
const fold_PolyFnSig = fold_Binder(fold_FnSig);
/** The `TypeFoldable` descriptor of `ty::TraitRef` (its derived impls). */
const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// impl<'a, 'tcx> Deref for ConfirmContext<'a, 'tcx> { type Target = FnCtxt<'a, 'tcx>; }
// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:47 deref
ConfirmContext.prototype.deref = function (this: ConfirmContext): FnCtxt {
  return this.fcx;
};
// The forwarders of the `Deref` are installed by lib.ts (decls.ts `register_deref`).
register_deref(ConfirmContext, "fcx", FnCtxt);

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:59 confirm_method
FnCtxt.prototype.confirm_method = function (this: FnCtxt, span: Span, self_expr: hir.Expr, call_expr: hir.Expr, unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult {
  // debug!(
  //     "confirm(unadjusted_self_ty={:?}, pick={:?}, generic_args={:?})",
  //     unadjusted_self_ty, pick, segment.args,
  // );

  const confirm_cx = ConfirmContext.new(this, span, self_expr, call_expr);
  return confirm_cx.confirm(unadjusted_self_ty, pick, segment);
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:77 confirm_method_for_diagnostic
FnCtxt.prototype.confirm_method_for_diagnostic = function (this: FnCtxt, span: Span, self_expr: hir.Expr, call_expr: hir.Expr, unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult {
  const confirm_cx = ConfirmContext.new(this, span, self_expr, call_expr);
  confirm_cx.skip_record_for_diagnostics = true;
  return confirm_cx.confirm(unadjusted_self_ty, pick, segment);
};
// }

// impl<'a, 'tcx> ConfirmContext<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:93 new
(ConfirmContext as unknown as { new: typeof ConfirmContext.new }).new = function (fcx: FnCtxt, span: Span, self_expr: hir.Expr, call_expr: hir.Expr): ConfirmContext {
  return new ConfirmContext(fcx, span, self_expr, call_expr, false);
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:102 confirm
ConfirmContext.prototype.confirm = function (this: ConfirmContext, unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult {
  // Adjust the self expression the user provided and obtain the adjusted type.
  const self_ty = this.adjust_self_ty(unadjusted_self_ty, pick);

  // Create generic args for the method's type parameters.
  const rcvr_args = this.fresh_receiver_args(self_ty, pick);
  const all_args = this.instantiate_method_args(pick, segment, rcvr_args);

  // debug!("rcvr_args={rcvr_args:?}, all_args={all_args:?}");

  // Create the final signature for the method, replacing late-bound regions.
  const [method_sig_u, method_clauses] = this.instantiate_method_sig(pick, all_args);

  // If there is a `Self: Sized` bound and `Self` is a trait object, it is possible that
  // something which derefs to `Self` actually implements the trait and the caller
  // wanted to make a static dispatch on it but forgot to import the trait.
  // See test `tests/ui/issues/issue-35976.rs`.
  //
  // In that case, we'll error anyway, but we'll also re-run the search with all traits
  // in scope, and if we find another method which can be used, we'll output an
  // appropriate hint suggesting to import the trait.
  const filler_args = rcvr_args.extend_to(this.tcx, pick.item.def_id, (def, _) => this.tcx.mk_param_from_def(def));
  const illegal_sized_bound = this.clauses_require_illegal_sized_bound(
    GenericClauses.instantiate(this.tcx.clauses_of(pick.item.def_id) as GenericClauses, this.tcx, filler_args),
  );

  // Unify the (adjusted) self type with what the method expects.
  //
  // SUBTLE: if we want good error messages, because of "guessing" while matching
  // traits, no trait system method can be called before this point because they
  // could alter our Self-type, except for normalizing the receiver from the
  // signature (which is also done during probing).
  const method_sig_rcvr = this.normalize(this.span, Unnormalized.new_wip(FnSig.inputs(method_sig_u)[0]!), fold_Ty);
  // debug!(
  //     "confirm: self_ty={:?} method_sig_rcvr={:?} method_sig={:?} method_clauses={:?}",
  //     self_ty, method_sig_rcvr, method_sig, method_clauses
  // );
  this.unify_receivers(self_ty, method_sig_rcvr, pick);

  const method_sig = this.normalize(this.span, Unnormalized.new_wip(method_sig_u), fold_FnSig);

  // Make sure nobody calls `drop()` explicitly.
  this.check_for_illegal_method_calls(pick);

  // Lint when an item is shadowing a supertrait item.
  this.lint_shadowed_supertrait_items(pick, segment);

  // Lint when a trait is ambiguously imported
  this.lint_ambiguously_glob_imported_traits(pick, segment);

  // Add any trait/regions obligations specified on the method's type parameters.
  // We won't add these if we encountered an illegal sized bound, so that we can use
  // a custom error in that case.
  if (illegal_sized_bound === undefined) {
    this.add_obligations(method_sig, all_args, method_clauses, pick.item.def_id);
  }

  // Create the final `MethodCallee`.
  const callee: MethodCallee = { def_id: pick.item.def_id, args: all_args, sig: method_sig };
  return { callee, illegal_sized_bound };
};

///////////////////////////////////////////////////////////////////////////
// ADJUSTMENTS

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:174 adjust_self_ty
ConfirmContext.prototype.adjust_self_ty = function (this: ConfirmContext, unadjusted_self_ty: Ty, pick: Pick): Ty {
  // Commit the autoderefs by calling `autoderef` again, but this
  // time writing the results into the various typeck results.
  const [target, adjustments] = this.create_ty_adjustments_from_pick(unadjusted_self_ty, pick);

  // Write out the final adjustments.
  if (!this.skip_record_for_diagnostics) {
    this.apply_adjustments(this.self_expr, adjustments);
  }

  return target;
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:191 create_ty_adjustments_from_pick
ConfirmContext.prototype.create_ty_adjustments_from_pick = function (this: ConfirmContext, unadjusted_self_ty: Ty, pick: Pick): [Ty, Adjustment[]] {
  const autoderef = this.autoderef(this.call_expr.span, unadjusted_self_ty);
  // `autoderef.nth(pick.autoderefs)`
  let step: [Ty, number] | undefined;
  for (let i = 0; i <= pick.autoderefs; i++) {
    step = autoderef.next();
    if (step === undefined) break;
  }
  if (step === undefined) {
    const error_ty = Ty.new_error_with_message(this.tcx, MultiSpan.from_span(DUMMY_SP), `failed autoderef ${pick.autoderefs}`);

    return [error_ty, []];
  }
  let target = step[0];
  const n = step[1];

  if (n !== pick.autoderefs) {
    panic(`assertion \`left == right\` failed\n  left: ${n}\n right: ${pick.autoderefs}`);
  }

  const adjustments = this.adjust_steps(autoderef);
  const adj = pick.autoref_or_ptr_adjustment;
  if (adj !== undefined && adj.$ === "Autoref") {
    const { mutbl: mutbl_, unsize } = adj;
    const region = this.next_region_var({ $: "Autoref", _0: this.span });
    // Type we're wrapping in a reference, used later for unsizing
    const base_ty = target;

    target = Ty.new_ref(this.tcx, region, target, mutbl_);

    // Method call receivers are the primary use case
    // for two-phase borrows.
    const mutbl = AutoBorrowMutability.new(mutbl_, "Yes");

    adjustments.push({ kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } }, target });

    if (unsize) {
      const bk = base_ty.kind();
      let unsized_ty: Ty;
      if (bk.$ === "Array") {
        unsized_ty = Ty.new_slice(this.tcx, bk._0);
      } else {
        unsized_ty = bug(`AutorefOrPtrAdjustment's unsize flag should only be set for array ty, found ${display_Ty(base_ty)}`);
      }
      target = Ty.new_ref(this.tcx, region, unsized_ty, Mutability_from_AutoBorrowMutability(mutbl));
      adjustments.push({
        kind: { $: "Pointer", _0: { $: "Unsize" } },
        target,
      });
    }
  } else if (adj !== undefined && adj.$ === "ToConstPtr") {
    const k = target.kind();
    if (k.$ === "RawPtr") {
      const [ty, mutbl] = [k._0, k._1];
      assert(Mutability.is_mut(mutbl), "assertion failed: mutbl.is_mut()");
      target = Ty.new_imm_ptr(this.tcx, ty);
    } else {
      const other = k;
      target = panic(`Cannot adjust receiver type ${debug_TyKind(other, PLAIN)} to const ptr`);
    }

    adjustments.push({
      kind: { $: "Pointer", _0: { $: "MutToConstPointer" } },
      target,
    });
  } else if (adj !== undefined && adj.$ === "ReborrowPin") {
    const mutbl = adj._0;
    const region = this.next_region_var({ $: "Autoref", _0: this.span });

    const k = target.kind();
    if (k.$ === "Adt" && this.tcx.is_lang_item(k._0.did(), "Pin")) {
      const args = k._1;
      const ik = GenericArg.expect_ty(args[0]!).kind();
      let inner_ty: Ty;
      if (ik.$ === "Ref") {
        inner_ty = ik._1;
      } else {
        inner_ty = bug("Expected a reference type for argument to Pin");
      }
      adjustments.push({
        kind: { $: "Deref", _0: { $: "Pin" } },
        target: inner_ty,
      });
      target = Ty.new_pinned_ref(this.tcx, region, inner_ty, mutbl);
    } else {
      target = bug(`Cannot adjust receiver type for reborrowing pin of ${display_Ty(target)}`);
    }
    adjustments.push({ kind: { $: "Borrow", _0: { $: "Pin", _0: mutbl } }, target });
  } else {
    // None => {}
  }

  this.register_predicates(autoderef.into_obligations());

  return [target, adjustments];
};

/// Returns a set of generic parameters for the method *receiver* where all type and region
/// parameters are instantiated with fresh variables. This generic parameters does not include any
/// parameters declared on the method itself.
///
/// Note that this generic parameters may include late-bound regions from the impl level. If so,
/// these are instantiated later in the `instantiate_method_sig` routine.
// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:290 fresh_receiver_args
ConfirmContext.prototype.fresh_receiver_args = function (this: ConfirmContext, self_ty: Ty, pick: Pick): GenericArgs {
  switch (pick.kind.$) {
    case "InherentImplPick": {
      const impl_def_id = AssocItem.container_id(pick.item, this.tcx);
      assert(pick.item.container.$ === "InherentImpl", `impl ${debug_DefId(impl_def_id, PLAIN)} is not an inherent impl`);
      return this.fresh_args_for_item(this.span, impl_def_id);
    }

    case "ObjectPick": {
      const trait_def_id = AssocItem.container_id(pick.item, this.tcx);

      // If the trait is not object safe (specifically, we care about when
      // the receiver is not valid), then there's a chance that we will not
      // actually be able to recover the object by derefing the receiver like
      // we should if it were valid.
      if (!(this.tcx.is_dyn_compatible(trait_def_id) as boolean)) {
        return RawList.extend_with_error(this.tcx, trait_def_id, []);
      }

      // This shouldn't happen for non-region error kinds, but may occur
      // when we have error regions. Specifically, since we canonicalize
      // during method steps, we may successfully deref when we assemble
      // the pick, but fail to deref when we try to extract the object
      // type from the pick during confirmation. This is fine, we're basically
      // already doomed by this point.
      if (TypeVisitableExt.references_error(self_ty, fold_Ty)) {
        return RawList.extend_with_error(this.tcx, trait_def_id, []);
      }

      return this.extract_existential_trait_ref(self_ty, (this_, object_ty, principal) => {
        // The object data has no entry for the Self
        // Type. For the purposes of this method call, we
        // instantiate the object type itself. This
        // wouldn't be a sound instantiation in all cases,
        // since each instance of the object type is a
        // different existential and hence could match
        // distinct types (e.g., if `Self` appeared as an
        // argument type), but those cases have already
        // been ruled out when we deemed the trait to be
        // "dyn-compatible".
        const original_poly_trait_ref = PolyExistentialTraitRef.with_self_ty(principal, as_interner(this_.tcx), object_ty);
        const upcast_poly_trait_ref = this_.upcast(original_poly_trait_ref, trait_def_id);
        const upcast_trait_ref = this_.instantiate_binder_with_fresh_vars(upcast_poly_trait_ref, d_TraitRef);
        // debug!(
        //     "original_poly_trait_ref={:?} upcast_trait_ref={:?} target_trait={:?}",
        //     original_poly_trait_ref, upcast_trait_ref, trait_def_id
        // );
        return upcast_trait_ref.args;
      });
    }

    case "TraitPick": {
      const trait_def_id = AssocItem.container_id(pick.item, this.tcx);

      // Make a trait reference `$0 : Trait<$1...$n>`
      // consisting entirely of type variables. Later on in
      // the process we will unify the transformed-self-type
      // of the method with the actual type in order to
      // unify some of these variables.
      return this.fresh_args_for_item(this.span, trait_def_id);
    }

    case "WhereClausePick": {
      const poly_trait_ref = pick.kind._0;
      // Where clauses can have bound regions in them. We need to instantiate
      // those to convert from a poly-trait-ref to a trait-ref.
      return this.instantiate_binder_with_fresh_vars(poly_trait_ref, d_TraitRef).args;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:368 extract_existential_trait_ref
ConfirmContext.prototype.extract_existential_trait_ref = function <R>(this: ConfirmContext, self_ty: Ty, closure: (_1: ConfirmContext, _2: Ty, _3: PolyExistentialTraitRefT) => R): R {
  // If we specified that this is an object method, then the
  // self-type ought to be something that can be dereferenced to
  // yield an object-type (e.g., `&Object` or `Box<Object>`
  // etc).

  let autoderef = this.fcx.autoderef(this.span, self_ty);

  // We don't need to gate this behind arbitrary self types
  // per se, but it does make things a bit more gated.
  if (this.tcx.features().arbitrary_self_types() || this.tcx.features().arbitrary_self_types_pointers()) {
    autoderef = autoderef.use_receiver_trait();
  }

  autoderef = autoderef.include_raw_pointers();
  // `.find_map(..)`
  for (let step = autoderef.next(); step !== undefined; step = autoderef.next()) {
    const [ty, _] = step;
    const k = ty.kind();
    if (k.$ === "Dynamic") {
      const data = k._0;
      const principal = data.principal();
      return closure(this, ty, principal !== undefined ? principal : span_bug(this.span, "calling trait method on empty object?"));
    }
  }
  return span_bug(this.span, `self-type \`${display_Ty(self_ty)}\` for ObjectPick never dereferenced to an object`);
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:408 instantiate_method_args
ConfirmContext.prototype.instantiate_method_args = function (this: ConfirmContext, pick: Pick, seg: hir.PathSegment, parent_args: GenericArgs): GenericArgs {
  // Determine the values for the generic parameters of the method.
  // If they were not explicitly supplied, just construct fresh
  // variables.
  const generics = this.tcx.generics_of(pick.item.def_id) as Generics;

  const arg_count_correct = check_generic_arg_count_for_value_path(this.fcx.lowerer(), pick.item.def_id, generics, seg, "Yes");

  // Create generic parameters for early-bound lifetime parameters,
  // combining parameters from the type and those from the method.
  if (generics.parent_count !== parent_args.length) {
    panic(`assertion \`left == right\` failed\n  left: ${generics.parent_count}\n right: ${parent_args.length}`);
  }

  // struct GenericArgsCtxt<'a, 'tcx> { cfcx, pick, seg }
  class GenericArgsCtxt implements GenericArgsLowerer {
    constructor(
      public cfcx: ConfirmContext,
      public pick: Pick,
      public seg: hir.PathSegment,
    ) {}

    // impl<'a, 'tcx> GenericArgsLowerer<'a, 'tcx> for GenericArgsCtxt<'a, 'tcx>
    // rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:437 args_for_def_id
    args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean] {
      if (DefId_eq(def_id, this.pick.item.def_id)) {
        const data = this.seg.args;
        if (data !== undefined) {
          return [data, false];
        }
      }
      return [undefined, false];
    }

    // rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:449 provided_kind
    provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg {
      const kind = param.kind;
      if (kind.$ === "Lifetime" && arg.$ === "Lifetime") {
        return GenericArg.from_Region(this.cfcx.fcx.lowerer().lower_lifetime(arg._0, { $: "Param", _0: param }));
      } else if (kind.$ === "Type" && arg.$ === "Type") {
        // We handle the ambig portions of `Ty` in the match arms below
        return GenericArg.from_Ty(this.cfcx.lower_ty(arg._0.as_unambig_ty()).raw);
      } else if (kind.$ === "Type" && arg.$ === "Infer") {
        return GenericArg.from_Ty(this.cfcx.lower_ty(arg._0.to_ty()).raw);
      } else if (kind.$ === "Const" && arg.$ === "Const") {
        return GenericArg.from_Const(
          this.cfcx
            // We handle the ambig portions of `ConstArg` in the match arms below
            .lower_const_arg(
              arg._0.as_unambig_ct(),
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.cfcx.tcx.type_of(param.def_id) as EarlyBinder<Ty>, this.cfcx.tcx, preceding_args, fold_Ty)),
            ),
        );
      } else if (kind.$ === "Const" && arg.$ === "Infer") {
        // PORT: `self.cfcx.ct_infer(..)` is `<FnCtxt as HirTyLowerer>::ct_infer` through the Deref (the lowerer vtable).
        return GenericArg.from_Const(this.cfcx.fcx.lowerer().ct_infer(param, arg._0.span));
      } else {
        return bug(`mismatched method arg kind ${debug_GenericParamDefKind(kind, PLAIN)} in turbofish: ${debug_hir_GenericArg(arg, PLAIN)}`);
      }
    }

    // rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:490 inferred_kind
    inferred_kind(_preceding_args: readonly GenericArg[], param: GenericParamDef, _infer_args: boolean): GenericArg {
      return this.cfcx.var_for_def(this.cfcx.span, param);
    }
  }

  const args = lower_generic_args(this.fcx.lowerer(), pick.item.def_id, parent_args, false, undefined, arg_count_correct, new GenericArgsCtxt(this, pick, seg));

  // When the method is confirmed, the `args` includes
  // parameters from not just the method, but also the impl of
  // the method -- in particular, the `Self` type will be fully
  // resolved. However, those are not something that the "user
  // specified" -- i.e., those types come from the inferred type
  // of the receiver, not something the user wrote. So when we
  // create the user-args, we want to replace those earlier
  // types with just the types that the user actually wrote --
  // that is, those that appear on the *method itself*.
  //
  // As an example, if the user wrote something like
  // `foo.bar::<u32>(...)` -- the `Self` type here will be the
  // type of `foo` (possibly adjusted), but we don't want to
  // include that. We want just the `[_, u32]` part.
  if (args.length !== 0 && !generics.is_own_empty()) {
    const user_type_annotation = this.probe((_) => {
      const user_args: UserArgs = {
        args: RawList.for_item(this.tcx, pick.item.def_id, (param, _) => {
          const i = param.index;
          if (i < generics.parent_count) {
            return this.fcx.var_for_def(DUMMY_SP, param);
          } else {
            return args[i]!;
          }
        }),
        user_self_ty: undefined, // not relevant here
      };

      const user_type = UserType.new({ $: "TypeOf", _0: pick.item.def_id, _1: user_args });
      void user_type;
      // PORT: `canonicalize_user_type_annotation<V: TypeFoldable>` needs `UserType`'s derived `TypeFoldable`, which
      // codegen does not generate yet (rustc_middle ty/typeck_results.rs `UserType` / `UserTypeKind`; as
      // gather_locals.ts `GatherLocalsVisitor::declare`).
      return unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType (derive not generated)") as never;
    });

    // debug!("instantiate_method_args: user_type_annotation={:?}", user_type_annotation);

    if (!this.skip_record_for_diagnostics) {
      this.fcx.write_user_type_annotation(this.call_expr.hir_id, user_type_annotation);
    }
  }

  return this.normalize(this.span, Unnormalized.new_wip(args), fold_GenericArgs);
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:553 unify_receivers
ConfirmContext.prototype.unify_receivers = function (this: ConfirmContext, self_ty: Ty, method_self_ty: Ty, pick: Pick): void {
  void pick;
  // debug!(
  //     "unify_receivers: self_ty={:?} method_self_ty={:?} span={:?} pick={:?}",
  //     self_ty, method_self_ty, self.span, pick
  // );
  const cause = this.cause(this.self_expr.span, { $: "Misc" });
  const r = this.at(cause, this.param_env).sup("Yes", method_self_ty, self_ty, ToTrace_Ty);
  if (r.$ === "Ok") {
    const { obligations } = r._0;
    this.register_predicates(obligations);
  } else {
    const terr = r._0;
    if (this.tcx.features().arbitrary_self_types()) {
      // PORT: `self.err_ctxt().report_mismatched_types(&cause, self.param_env, method_self_ty, self_ty, terr).emit()`:
      // `err_ctxt` stops (TypeErrCtxt is wave 19); `report_mismatched_types` is not declared on the pending type yet.
      this.err_ctxt();
      void terr;
      unported("rustc_trait_selection::error_reporting::TypeErrCtxt::report_mismatched_types");
    } else {
      // This has/will have errored in wfcheck, which we cannot depend on from here, as typeck on functions
      // may run before wfcheck if the function is used in const eval.
      this.dcx().span_delayed_bug(cause.span, `${display_Ty(self_ty)} was a subtype of ${display_Ty(method_self_ty)} but now is not?`);
    }
  }
};

// NOTE: this returns the *unnormalized* predicates and method sig. Because of
// inference guessing, the predicates and method signature can't be normalized
// until we unify the `Self` type.
// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:594 instantiate_method_sig
ConfirmContext.prototype.instantiate_method_sig = function (this: ConfirmContext, pick: Pick, all_args: GenericArgs): [FnSig, InstantiatedClauses] {
  // debug!("instantiate_method_sig(pick={:?}, all_args={:?})", pick, all_args);

  // Instantiate the bounds on the method with the
  // type/early-bound-regions instantiations performed. There can
  // be no late-bound regions appearing here.
  const def_id = pick.item.def_id;
  const method_clauses = GenericClauses.instantiate(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx, all_args);

  // debug!("method_clauses after instantiation = {:?}", method_clauses);

  const sig_b = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>, this.tcx, all_args, fold_PolyFnSig));
  // debug!("type scheme instantiated, sig={:?}", sig);

  const sig = this.instantiate_binder_with_fresh_vars(sig_b, fold_FnSig);
  // debug!("late-bound lifetimes from method instantiated, sig={:?}", sig);

  return [sig, method_clauses];
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:618 add_obligations
ConfirmContext.prototype.add_obligations = function (this: ConfirmContext, sig: FnSig, all_args: GenericArgs, method_clauses: InstantiatedClauses, def_id: DefId): void {
  // debug!(
  //     "add_obligations: sig={:?} all_args={:?} method_clauses={:?} def_id={:?}",
  //     sig, all_args, method_clauses, def_id
  // );

  // FIXME: could replace with the following, but we already calculated `method_clauses`,
  // so we just call `predicates_for_generics` directly to avoid redoing work.
  // `self.add_required_obligations(self.span, def_id, &all_args);`
  for (const obligation of predicates_for_generics(
    (idx, span) => {
      const code: ObligationCauseCode = { $: "WhereClauseInExpr", _0: def_id, _1: span, _2: this.call_expr.hir_id, _3: idx };
      return this.cause(this.span, code);
    },
    (clause: Unnormalized<Clause>): Clause => this.normalize(this.call_expr.span, clause, fold_Clause),
    this.param_env,
    method_clauses,
  )) {
    this.register_predicate(obligation);
  }

  // this is a projection from a trait reference, so we have to
  // make sure that the trait reference inputs are well-formed.
  this.add_wf_bounds(all_args, this.call_expr.span, this.call_expr.hir_id);

  // the function type must also be well-formed (this is not
  // implied by the args being well-formed because of inherent
  // impls and late-bound regions - see issue #28609).
  for (const ty of sig.inputs_and_output) {
    this.register_wf_obligation(ty, this.span, { $: "WellFormed", _0: { $: "HirId", _0: this.call_expr.hir_id } });
  }
};

///////////////////////////////////////////////////////////////////////////
// MISCELLANY

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:669 clauses_require_illegal_sized_bound
ConfirmContext.prototype.clauses_require_illegal_sized_bound = function (this: ConfirmContext, inst_clauses: InstantiatedClauses): Span | undefined {
  const sized_def_id = this.tcx.lang_items().sized_trait();
  if (sized_def_id === undefined) return undefined;

  const elaborator = elaborate(this.tcx, inst_clauses.clauses.map(Unnormalized.skip_norm_wip), Elaboratable_Clause);
  for (const clause of elaborator) {
    // We don't care about regions here.
    // `.filter_map(..)`
    const kind = Binder.skip_binder(clause.kind());
    if (!(kind.$ === "Trait" && DefId_eq(kind._0.trait_ref.def_id, sized_def_id))) continue;
    const trait_pred = kind._0;
    let span: Span = DUMMY_SP;
    for (const [c, s] of inst_clauses.iter()) {
      if (Unnormalized.skip_norm_wip(c) === clause) {
        span = s;
        break;
      }
    }
    // `.find_map(..)`
    if (trait_pred.trait_ref.args.type_at(0).kind().$ === "Dynamic") {
      return span;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:698 check_for_illegal_method_calls
ConfirmContext.prototype.check_for_illegal_method_calls = function (this: ConfirmContext, pick: Pick): void {
  // Disallow calls to the method `drop` defined in the `Drop` trait.
  const trait_def_id = AssocItem.trait_container(pick.item, this.tcx);
  if (trait_def_id !== undefined) {
    const r = check_legal_trait_for_method_call(this.tcx, this.span, this.self_expr.span, this.call_expr.span, trait_def_id, LocalDefId.to_def_id(this.body_def_id));
    if (r.$ === "Err") {
      const e = r._0;
      this.set_tainted_by_errors(e);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:714 lint_shadowed_supertrait_items
ConfirmContext.prototype.lint_shadowed_supertrait_items = function (this: ConfirmContext, pick: Pick, segment: hir.PathSegment): void {
  if (pick.shadowed_candidates.length === 0) {
    return;
  }

  const shadower_span = this.tcx.def_span(pick.item.def_id);
  const subtrait = this.tcx.item_name(AssocItem.trait_container(pick.item, this.tcx)!);
  const shadower: SupertraitItemShadower = { span: shadower_span, subtrait };

  let shadowee: SupertraitItemShadowee;
  if (pick.shadowed_candidates.length === 1) {
    const shadowee_ = pick.shadowed_candidates[0]!;
    const shadowee_span = this.tcx.def_span(shadowee_.def_id);
    const supertrait = this.tcx.item_name(AssocItem.trait_container(shadowee_, this.tcx)!);
    shadowee = { $: "Labeled", span: shadowee_span, supertrait };
  } else {
    const traits: Symbol[] = [];
    const spans: Span[] = [];
    for (const item of pick.shadowed_candidates) {
      traits.push(this.tcx.item_name(AssocItem.trait_container(item, this.tcx)!));
      spans.push(this.tcx.def_span(item.def_id));
    }
    shadowee = { $: "Several", traits: DiagSymbolList_from(traits), spans: MultiSpan.from_Vec(spans) };
  }

  this.tcx.emit_node_span_lint(
    RESOLVING_TO_ITEMS_SHADOWING_SUPERTRAIT_ITEMS,
    segment.hir_id,
    segment.ident.span,
    SupertraitItemShadowing_diagnostic({ shadower, shadowee, item: segment.ident.name, subtrait }),
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:753 lint_ambiguously_glob_imported_traits
ConfirmContext.prototype.lint_ambiguously_glob_imported_traits = function (this: ConfirmContext, pick: Pick, segment: hir.PathSegment): void {
  if (!(pick.kind.$ === "TraitPick" && pick.kind.is_ambiguously_imported === true)) {
    return;
  }
  const trait_name = this.tcx.item_name(AssocItem.container_id(pick.item, this.tcx));
  const import_span = this.tcx.hir_span_if_local(LocalDefId.to_def_id(pick.import_ids[0]!))!;

  this.tcx.emit_node_lint(
    AMBIGUOUS_GLOB_IMPORTED_TRAITS,
    segment.hir_id,
    DiagDecorator((diag) => {
      diag
        .primary_message(`use of ambiguously glob imported trait \`${display_Symbol(trait_name)}\``)
        .span(segment.ident.span)
        .span_label(import_span, `\`${display_Symbol(trait_name)}\` imported ambiguously here`)
        .help(`import \`${display_Symbol(trait_name)}\` explicitly`);
    }),
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:778 upcast
ConfirmContext.prototype.upcast = function (this: ConfirmContext, source_trait_ref: PolyTraitRef, target_trait_def_id: DefId): PolyTraitRef {
  const upcast_trait_refs = upcast_choices(this.tcx, source_trait_ref, target_trait_def_id);

  // must be exactly one trait ref or we'd get an ambig error etc
  if (upcast_trait_refs.length === 1) {
    const upcast_trait_ref = upcast_trait_refs[0]!;
    return upcast_trait_ref;
  } else {
    this.dcx().span_delayed_bug(
      this.span,
      `cannot uniquely upcast \`${debug_Binder(source_trait_ref, PLAIN, debug_TraitRef)}\` to \`${debug_DefId(target_trait_def_id, PLAIN)}\`: \`${debug_vec(upcast_trait_refs, PLAIN, (x, f) => debug_Binder(x, f, debug_TraitRef))}\``,
    );

    return Binder.dummy(TraitRef.new_from_args(as_interner(this.tcx), target_trait_def_id, RawList.extend_with_error(this.tcx, target_trait_def_id, [])), d_TraitRef);
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/confirm.rs:806 instantiate_binder_with_fresh_vars
ConfirmContext.prototype.instantiate_binder_with_fresh_vars = function <T>(this: ConfirmContext, value: Binder<T>, d_T: TypeFoldable<T>): T {
  return this.fcx.instantiate_binder_with_fresh_vars(this.span, BoundRegionConversionTime.FnCall, value, d_T);
};
// }
