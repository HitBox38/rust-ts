// Port of compiler/rustc_hir_typeck/src/callee.rs (lane typeck-callee-cast).
//
// The `impl FnCtxt` methods of this file are assigned onto `FnCtxt.prototype` (declared in ./decls.ts);
// `DeferredCallResolution::resolve` onto the generated class's prototype (callee.gen.ts).
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates; every other
// rustc_hir_typeck export is read inside function bodies only.
export * from "./callee.gen.ts";
import { CanonAbi } from "../rustc_abi/canon_abi.ts";
import { display_ExternAbi, type ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ExprPrecedence_discriminant } from "../rustc_ast/util/parser.gen.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { str_into_diag_arg, String_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { type Diag, IntoDiagArg, msg, StashKey } from "../rustc_errors/lib.ts";
import type { DiagMessage } from "../rustc_error_messages/lib.ts";
import type { Autoderef } from "../rustc_hir_analysis/autoderef.ts";
import { DefKind, Namespace, type Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq, HirIdMap } from "../rustc_hir_id/lib.ts";
import { qpath_to_string } from "../rustc_hir_pretty/lib.ts";
import { BoundRegionConversionTime, DefineOpaqueTypes } from "../rustc_infer/infer/mod.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import { ObligationCause, type ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import { AutoBorrowMutability, type Adjustment } from "../rustc_middle/ty/adjustment.ts";
import { AllowTwoPhase } from "../rustc_middle/ty/adjustment.gen.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Ty_into_diag_arg } from "../rustc_middle/ty/diagnostics.ts";
import { ConstConditions, type ConstConditions as ConstConditionsT, GenericClauses, type GenericClauses as GenericClausesT } from "../rustc_middle/ty/generics.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, Term, Ty } from "../rustc_middle/ty/mod.ts";
import { type Clause, type Predicate, Predicate_upcast_from_Clause } from "../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { print_Ty } from "../rustc_middle/ty/print/mod.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { fold_Vec } from "../rustc_type_ir/fold.ts";
import { AssocItem, type AssocItem as AssocItemT } from "../rustc_middle/ty/assoc.ts";
import { debug_EvaluationResult, debug_OverflowError } from "../rustc_middle/traits/select.gen.ts";
import { DefId, LocalDefId as LocalDefIdC, type LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import { AbiMap } from "../rustc_target/spec/abi_map.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { FnHeader, FnSig, FnSigKind, fold_FnSig, PolyFnSigTys, type FnSig as FnSigT } from "../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../rustc_type_ir/ty_kind/closure.ts";
import { type CoroutineClosureSignature as CoroutineClosureSignatureT, fold_with_CoroutineClosureSignature, try_fold_with_CoroutineClosureSignature, visit_with_CoroutineClosureSignature } from "../rustc_type_ir/ty_kind/closure.gen.ts";
import { Unnormalized, UnnormalizedPolyTraitRef } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { debug_result } from "../std/result.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, type Result } from "../std/result.ts";
import { FnCtxt } from "./decls.ts";
import type { DefIdOrName } from "./decls.ts";
import { type CallStep, DeferredCallResolution, type SplatLoweringInfo } from "./callee.gen.ts";
import { FnCtxt_as_PpAnn } from "./fn_ctxt/mod.ts";
import * as diagnostics from "./diagnostics.ts";
import { Expectation } from "./expectation.ts";
import { TupleArgumentsFlag } from "./lib.ts";
import { ConfirmContext } from "./method/confirm.gen.ts";
import { type MethodCallee, TreatNotYetDefinedOpaques } from "./method/mod.gen.ts";
import { Mode, ProbeScope } from "./method/probe.gen.ts";

/** PORT: `impl Upcast<TyCtxt, Predicate> for Clause` takes `TyCtxt` where `Obligation::new` names the `Interner`. */
const upcast_Clause: (from: Clause, tcx: Interner) => Predicate = Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: Interner) => Predicate;

/** PORT (D4): the `TypeFoldable` descriptor of `CoroutineClosureSignature` over its derived impls (closure.gen.ts), for
 *  `instantiate_binder_with_fresh_vars`. */
const fold_CoroutineClosureSignature: TypeFoldable<CoroutineClosureSignatureT> = {
  visit_with: (self, visitor) => visit_with_CoroutineClosureSignature(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_CoroutineClosureSignature(self, folder),
  fold_with: (self, folder) => fold_with_CoroutineClosureSignature(self, folder),
};


/// Checks that it is legal to call methods of the trait corresponding
/// to `trait_id` (this only cares about the trait, not the specific
/// method that is called).
// rustc: compiler/rustc_hir_typeck/src/callee.rs:50 check_legal_trait_for_method_call
export function check_legal_trait_for_method_call(tcx: TyCtxt, span: Span, receiver: Span | undefined, expr_span: Span, trait_id: DefId, body_def_id: DefId): Result<undefined, ErrorGuaranteed> {
  if (
    tcx.is_lang_item(trait_id, "Drop") &&
    // Allow calling `Drop::pin_drop` in `Drop::drop`
    !tcx.is_lang_item(tcx.parent(body_def_id), "Drop")
  ) {
    const receiver_ = receiver !== undefined && !Span.is_empty(receiver) ? receiver : undefined;
    let sugg: diagnostics.ExplicitDestructorCallSugg;
    if (receiver_ !== undefined) {
      sugg = {
        $: "Snippet",
        lo: Span.to(Span.shrink_to_lo(expr_span), Span.shrink_to_lo(receiver_)),
        hi: Span.to(Span.shrink_to_hi(receiver_), Span.shrink_to_hi(expr_span)),
      };
    } else {
      sugg = { $: "Empty", _0: span };
    }
    return Err(tcx.dcx().emit_err(diagnostics.ExplicitDestructorCall_diagnostic({ span, sugg })));
  }
  const r = tcx.ensure_result().coherent_trait(trait_id);
  return r.$ === "Ok" ? { $: "Ok", _0: undefined } : r;
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// #[tracing::instrument(skip(self))]
// rustc: compiler/rustc_hir_typeck/src/callee.rs:89 check_expr_call
FnCtxt.prototype.check_expr_call = function (this: FnCtxt, call_expr: hir.Expr, callee_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation): Ty {
  let original_callee_ty: Ty;
  const ck = callee_expr.kind;
  if (ck.$ === "Path" && (ck._0.$ === "Resolved" || ck._0.$ === "TypeRelative")) {
    original_callee_ty = this.check_expr_with_expectation_and_args(callee_expr, Expectation.NoExpectation, [call_expr, arg_exprs]);
  } else {
    original_callee_ty = this.check_expr(callee_expr);
  }

  const expr_ty = this.deeply_resolve_ignoring_regions_with_obligations(original_callee_ty, fold_Ty);

  const autoderef = this.autoderef(callee_expr.span, expr_ty);
  let result: CallStep | undefined = undefined;
  while (result === undefined && autoderef.next() !== undefined) {
    result = this.try_overloaded_call_step(call_expr, callee_expr, arg_exprs, autoderef);
  }

  const fk = autoderef.final_ty().kind();
  switch (fk.$) {
    case "FnDef": {
      const abi = FnSig.abi(Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(fk._0) as EarlyBinder<PolyFnSig>)));
      this.check_call_abi(abi, call_expr.span);
      break;
    }
    case "FnPtr": {
      this.check_call_abi(FnHeader.abi(fk._1), call_expr.span);
      break;
    }
    default: {
      /* cannot have a non-rust abi */
    }
  }

  if (this.is_scalable_vector_ctor(autoderef.final_ty())) {
    const err = this.dcx().create_err(
      diagnostics.ScalableVectorCtor_diagnostic({
        span: callee_expr.span,
        ty: autoderef.final_ty(),
      }),
    );
    err.span_label(callee_expr.span, "you can create scalable vectors using intrinsics");
    Ty.new_error(this.tcx, err.emit_err());
  }

  this.register_predicates(autoderef.into_obligations());

  let output: Ty;
  if (result === undefined) {
    // Check all of the arg expressions, but with no expectations
    // since we don't have a signature to compare them to.
    for (const arg of arg_exprs) {
      this.check_expr(arg);
    }

    if (callee_expr.kind.$ === "Path" && callee_expr.kind._0.$ === "Resolved" && callee_expr.kind._0._1.segments.length === 1) {
      const segment = callee_expr.kind._0._1.segments[0]!;
      this.dcx().try_steal_modify_and_emit_err(segment.ident.span, StashKey.CallIntoMethod, (err) => {
        // Try suggesting `foo(a)` -> `a.foo()` if possible.
        this.suggest_call_as_method(err, segment, arg_exprs, call_expr, expected);
      });
    }

    const guar = this.report_invalid_callee(call_expr, callee_expr, expr_ty, arg_exprs);
    output = Ty.new_error(this.tcx, guar);
  } else {
    switch (result.$) {
      case "Builtin":
        output = this.confirm_builtin_call(call_expr, callee_expr, result._0, arg_exprs, expected);
        break;

      case "DeferredClosure":
        output = this.confirm_deferred_closure_call(call_expr, arg_exprs, expected, result._0, result._1);
        break;

      case "Overloaded":
        output = this.confirm_overloaded_call(call_expr, arg_exprs, expected, result._0);
        break;
    }
  }

  // we must check that return type of called functions is WF:
  this.register_wf_obligation(Term.from_Ty(output), call_expr.span, { $: "WellFormed", _0: { $: "HirId", _0: call_expr.hir_id } });

  return output;
};

/// Can a function with this ABI be called with a rust call expression?
///
/// Some ABIs cannot be called from rust, either because rust does not know how to generate
/// code for the call, or because a call does not semantically make sense.
// rustc: compiler/rustc_hir_typeck/src/callee.rs:190 check_call_abi
FnCtxt.prototype.check_call_abi = function (this: FnCtxt, abi: ExternAbi, span: Span): void {
  let canon_abi: CanonAbi;
  const mapping = AbiMap.from_target(this.sess().target).canonize_abi(abi, false);
  switch (mapping.$) {
    case "Direct":
    case "Deprecated":
      canon_abi = mapping._0;
      break;
    case "Invalid": {
      // This should be reported elsewhere, but we want to taint this body
      // so that we don't try to evaluate calls to ABIs that are invalid.
      const guar = this.dcx().span_delayed_bug(span, `invalid abi for platform should have reported an error: ${display_ExternAbi(abi)}`);
      this.set_tainted_by_errors(guar);
      return;
    }
  }

  switch (canon_abi.$) {
    // Rust doesn't know how to call functions with this ABI.
    case "Custom":
    // The interrupt ABIs should only be called by the CPU. They have complex
    // pre- and postconditions, and can use non-standard instructions like `iret` on x86.
    case "Interrupt": {
      const err = diagnostics.AbiCannotBeCalled_diagnostic({ span, abi });
      this.tcx.dcx().emit_err(err);
      break;
    }

    // This is an entry point for the host, and cannot be called directly.
    case "GpuKernel": {
      const err = diagnostics.GpuKernelAbiCannotBeCalled_diagnostic({ span });
      this.tcx.dcx().emit_err(err);
      break;
    }

    case "C":
    case "Rust":
    case "RustCold":
    case "RustPreserveNone":
    case "RustTail":
    case "Swift":
    case "Arm":
    case "X86":
      break;
  }
};

// #[instrument(level = "debug", skip(self, call_expr, callee_expr, arg_exprs, autoderef), ret)]
// rustc: compiler/rustc_hir_typeck/src/callee.rs:233 try_overloaded_call_step
FnCtxt.prototype.try_overloaded_call_step = function (this: FnCtxt, call_expr: hir.Expr, callee_expr: hir.Expr, arg_exprs: readonly hir.Expr[], autoderef: Autoderef): CallStep | undefined {
  const adjusted_ty = this.deeply_resolve_ignoring_regions_with_obligations(autoderef.final_ty(), fold_Ty);

  // If the callee is a function pointer or a closure, then we're all set.
  const k = adjusted_ty.kind();
  switch (k.$) {
    case "FnDef":
    case "FnPtr": {
      const adjustments = this.adjust_steps(autoderef);
      this.apply_adjustments(callee_expr, adjustments);
      return { $: "Builtin", _0: adjusted_ty };
    }

    // Check whether this is a call to a closure where we
    // haven't yet decided on whether the closure is fn vs
    // fnmut vs fnonce. If so, we have to defer further processing.
    case "Closure": {
      if (this.closure_kind(adjusted_ty) !== undefined) break;
      const def_id = k._0.expect_local();
      const closure_sig_ = ClosureArgs.sig(k._1.as_closure());
      const closure_sig = this.instantiate_binder_with_fresh_vars(call_expr.span, BoundRegionConversionTime.FnCall, closure_sig_, fold_FnSig);
      const adjustments = this.adjust_steps(autoderef);
      this.record_deferred_call_resolution(def_id, new DeferredCallResolution(call_expr, callee_expr, adjusted_ty, adjustments, closure_sig));
      return { $: "DeferredClosure", _0: def_id, _1: closure_sig };
    }

    // When calling a `CoroutineClosure` that is local to the body, we will
    // not know what its `closure_kind` is yet. Instead, just fill in the
    // signature with an infer var for the `tupled_upvars_ty` of the coroutine,
    // and record a deferred call resolution which will constrain that var
    // as part of `AsyncFn*` trait confirmation.
    case "CoroutineClosure": {
      if (this.closure_kind(adjusted_ty) !== undefined) break;
      const def_id = k._0.expect_local();
      const closure_args = k._1.as_coroutine_closure();
      const coroutine_closure_sig = this.instantiate_binder_with_fresh_vars(
        call_expr.span,
        BoundRegionConversionTime.FnCall,
        CoroutineClosureArgs.coroutine_closure_sig(closure_args),
        fold_CoroutineClosureSignature,
      );
      const tupled_upvars_ty = this.next_ty_var(callee_expr.span);
      // We may actually receive a coroutine back whose kind is different
      // from the closure that this dispatched from. This is because when
      // we have no captures, we automatically implement `FnOnce`. This
      // impl forces the closure kind to `FnOnce` i.e. `u8`.
      const kind_ty = this.next_ty_var(callee_expr.span);
      const call_sig = this.tcx.mk_fn_sig(
        [coroutine_closure_sig.tupled_inputs_ty],
        CoroutineClosureSignature.to_coroutine(
          coroutine_closure_sig,
          this.tcx,
          CoroutineClosureArgs.parent_args(closure_args),
          kind_ty,
          this.tcx.coroutine_for_closure(LocalDefIdC.to_def_id(def_id)),
          tupled_upvars_ty,
        ),
        coroutine_closure_sig.fn_sig_kind,
      );
      const adjustments = this.adjust_steps(autoderef);
      this.record_deferred_call_resolution(def_id, new DeferredCallResolution(call_expr, callee_expr, adjusted_ty, adjustments, call_sig));
      return { $: "DeferredClosure", _0: def_id, _1: call_sig };
    }

    // Hack: we know that there are traits implementing Fn for &F
    // where F:Fn and so forth. In the particular case of types
    // like `f: &mut FnMut()`, if there is a call `f()`, we would
    // normally translate to `FnMut::call_mut(&mut f, ())`, but
    // that winds up potentially requiring the user to mark their
    // variable as `mut` which feels unnecessary and unexpected.
    //
    //     fn foo(f: &mut impl FnMut()) { f() }
    //            ^ without this hack `f` would have to be declared as mutable
    //
    // The simplest fix by far is to just ignore this case and deref again,
    // so we wind up with `FnMut::call_mut(&mut *f, ())`.
    case "Ref": {
      if (autoderef.step_count() === 0) {
        return undefined;
      }
      break;
    }

    case "Infer": {
      if (k._0.$ === "TyVar") {
        const vid = k._0._0;
        // If we end up with an inference variable which is not the hidden type of
        // an opaque, emit an error.
        if (!this.has_opaques_with_sub_unified_hidden_type(vid)) {
          this.type_must_be_known_at_this_point(autoderef.span(), adjusted_ty);
          return undefined;
        }
      }
      break;
    }

    case "Error": {
      return undefined;
    }

    default:
      break;
  }

  // Now, we look for the implementation of a Fn trait on the object's type.
  // We first do it with the explicit instruction to look for an impl of
  // `Fn<Tuple>`, with the tuple `Tuple` having an arity corresponding
  // to the number of call parameters.
  // If that fails (or_else branch), we try again without specifying the
  // shape of the tuple (hence the None). This allows to detect an Fn trait
  // is implemented, and use this information for diagnostic.
  const r = this.try_overloaded_call_traits(call_expr, adjusted_ty, arg_exprs) ?? this.try_overloaded_call_traits(call_expr, adjusted_ty, undefined);
  if (r === undefined) return undefined;
  const [autoref, method] = r;
  const adjustments = this.adjust_steps(autoderef);
  if (autoref !== undefined) adjustments.push(autoref);
  this.apply_adjustments(callee_expr, adjustments);
  return { $: "Overloaded", _0: method };
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:369 try_overloaded_call_traits
FnCtxt.prototype.try_overloaded_call_traits = function (this: FnCtxt, call_expr: hir.Expr, adjusted_ty: Ty, opt_arg_exprs: readonly hir.Expr[] | undefined): [Adjustment | undefined, MethodCallee] | undefined {
  // HACK(async_closures): For async closures, prefer `AsyncFn*`
  // over `Fn*`, since all async closures implement `FnOnce`, but
  // choosing that over `AsyncFn`/`AsyncFnMut` would be more restrictive.
  // For other callables, just prefer `Fn*` for perf reasons.
  //
  // The order of trait choices here is not that big of a deal,
  // since it just guides inference (and our choice of autoref).
  // Though in the future, I'd like typeck to choose:
  // `Fn > AsyncFn > FnMut > AsyncFnMut > FnOnce > AsyncFnOnce`
  // ...or *ideally*, we just have `LendingFn`/`LendingFnMut`, which
  // would naturally unify these two trait hierarchies in the most
  // general way.
  let call_trait_choices: [DefId | undefined, Symbol, boolean][];
  if (this.shallow_resolve(adjusted_ty).is_coroutine_closure()) {
    call_trait_choices = [
      [this.tcx.lang_items().async_fn_trait(), sym.async_call, true],
      [this.tcx.lang_items().async_fn_mut_trait(), sym.async_call_mut, true],
      [this.tcx.lang_items().async_fn_once_trait(), sym.async_call_once, false],
      [this.tcx.lang_items().fn_trait(), sym.call, true],
      [this.tcx.lang_items().fn_mut_trait(), sym.call_mut, true],
      [this.tcx.lang_items().fn_once_trait(), sym.call_once, false],
    ];
  } else {
    call_trait_choices = [
      [this.tcx.lang_items().fn_trait(), sym.call, true],
      [this.tcx.lang_items().fn_mut_trait(), sym.call_mut, true],
      [this.tcx.lang_items().fn_once_trait(), sym.call_once, false],
      [this.tcx.lang_items().async_fn_trait(), sym.async_call, true],
      [this.tcx.lang_items().async_fn_mut_trait(), sym.async_call_mut, true],
      [this.tcx.lang_items().async_fn_once_trait(), sym.async_call_once, false],
    ];
  }

  // Try the options that are least restrictive on the caller first.
  for (const [opt_trait_def_id, method_name, borrow] of call_trait_choices) {
    if (opt_trait_def_id === undefined) continue;
    const trait_def_id = opt_trait_def_id;

    const opt_input_type =
      opt_arg_exprs !== undefined
        ? Ty.new_tup_from_iter(
            this.tcx,
            opt_arg_exprs.map((e) => this.next_ty_var(e.span)),
          )
        : undefined;

    // We use `TreatNotYetDefinedOpaques::AsRigid` here so that if the `adjusted_ty`
    // is `Box<impl FnOnce()>` we choose  `FnOnce` instead of `Fn`.
    //
    // We try all the different call traits in order and choose the first
    // one which may apply. So if we treat opaques as inference variables
    // `Box<impl FnOnce()>: Fn` is considered ambiguous and chosen.
    const ok = this.lookup_method_for_operator(this.misc(call_expr.span), method_name, trait_def_id, adjusted_ty, opt_input_type, TreatNotYetDefinedOpaques.AsRigid);
    if (ok !== undefined) {
      const method = this.register_infer_ok_obligations(ok);
      let autoref: Adjustment | undefined = undefined;
      if (borrow) {
        // Check for &self vs &mut self in the method signature. Since this is either
        // the Fn or FnMut trait, it should be one of those.
        const rk = unwrap(FnSig.inputs(method.sig)[0]).kind();
        if (rk.$ !== "Ref") {
          return bug("Expected `FnMut`/`Fn` to take receiver by-ref/by-mut");
        }
        const mutbl_ = rk._2;

        // For initial two-phase borrow
        // deployment, conservatively omit
        // overloaded function call ops.
        const mutbl = AutoBorrowMutability.new(mutbl_, AllowTwoPhase.No);

        autoref = {
          kind: { $: "Borrow", _0: { $: "Ref", _0: mutbl } },
          target: unwrap(FnSig.inputs(method.sig)[0]),
        };
      }

      return [autoref, method];
    }
  }

  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:456 is_scalable_vector_ctor
FnCtxt.prototype.is_scalable_vector_ctor = function (this: FnCtxt, callee_ty: Ty): boolean {
  const k = callee_ty.kind();
  let dk: DefKind;
  if (k.$ === "FnDef" && (dk = this.tcx.def_kind(k._0)).$ === "Ctor" && dk._0 === "Struct") {
    const id = this.tcx.opt_parent(k._0);
    return (id !== undefined ? (this.tcx.adt_def(id) as AdtDef).repr().scalable : undefined) !== undefined;
  } else {
    return false;
  }
};

/// Give appropriate suggestion when encountering `||{/* not callable */}()`, where the
/// likely intention is to call the closure, suggest `(||{})()`. (#55851)
// rustc: compiler/rustc_hir_typeck/src/callee.rs:471 identify_bad_closure_def_and_call
FnCtxt.prototype.identify_bad_closure_def_and_call = function (this: FnCtxt, err: Diag, hir_id: HirId, callee_node: hir.ExprKind, callee_span: Span): void {
  if (callee_node.$ !== "Block") {
    // Only calls on blocks suggested here.
    return;
  }

  let fn_decl_span: Span;
  const parent = this.tcx.parent_hir_node(hir_id);
  if (parent.$ === "Expr" && parent._0.kind.$ === "Closure") {
    fn_decl_span = parent._0.kind._0.fn_decl_span;
  } else {
    // `self.tcx.hir_parent_iter(hir_id).nth(3)`
    let nth: [HirId, hir.Node] | undefined = undefined;
    let i = 0;
    for (const item of this.tcx.hir_parent_iter(hir_id)) {
      if (i === 3) {
        nth = item;
        break;
      }
      i += 1;
    }
    let ck: hir.ClosureKind;
    if (
      nth !== undefined &&
      nth[1].$ === "Expr" &&
      nth[1]._0.kind.$ === "Closure" &&
      (ck = nth[1]._0.kind._0.kind).$ === "Coroutine" &&
      ck._0.$ === "Desugared" &&
      ck._0._0 === "Async" &&
      ck._0._1 === "Closure"
    ) {
      const parent_hir_id = nth[1]._0.hir_id;
      // Actually need to unwrap one more layer of HIR to get to
      // the _real_ closure...
      const p = this.tcx.parent_hir_node(parent_hir_id);
      if (!(p.$ === "Expr" && p._0.kind.$ === "Closure")) {
        return;
      }
      fn_decl_span = p._0.kind._0.fn_decl_span;
    } else {
      return;
    }
  }

  const start = Span.shrink_to_lo(fn_decl_span);
  const end = Span.shrink_to_hi(callee_span);
  err.multipart_suggestion(
    "if you meant to create this closure and immediately call it, surround the \
closure with parentheses",
    [
      [start, "("],
      [end, ")"],
    ],
    "MaybeIncorrect",
  );
};

/// Give appropriate suggestion when encountering `[("a", 0) ("b", 1)]`, where the
/// likely intention is to create an array containing tuples.
// rustc: compiler/rustc_hir_typeck/src/callee.rs:532 maybe_suggest_bad_array_definition
FnCtxt.prototype.maybe_suggest_bad_array_definition = function (this: FnCtxt, err: Diag, call_expr: hir.Expr, callee_expr: hir.Expr): boolean {
  const parent_node = this.tcx.parent_hir_node(call_expr.hir_id);
  if (
    parent_node.$ === "Expr" &&
    parent_node._0.kind.$ === "Array" &&
    callee_expr.kind.$ === "Tup" &&
    call_expr.kind.$ === "Call" &&
    call_expr.kind._1.length === callee_expr.kind._0.length
  ) {
    const start = Span.shrink_to_hi(callee_expr.span);
    err.span_suggestion(start, "consider separating array elements with a comma", ",", "MaybeIncorrect");
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:558 confirm_builtin_call
FnCtxt.prototype.confirm_builtin_call = function (this: FnCtxt, call_expr: hir.Expr, callee_expr: hir.Expr, callee_ty: Ty, arg_exprs: readonly hir.Expr[], expected: Expectation): Ty {
  let fn_sig_: PolyFnSig;
  let def_id: DefId | undefined;
  let callee_generic_args: GenericArgs | undefined;
  const k = callee_ty.kind();
  switch (k.$) {
    case "FnDef": {
      const def_id_ = k._0;
      const args = unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs));
      this.enforce_context_effects(call_expr.hir_id, call_expr.span, def_id_, args);
      const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.fn_sig(def_id_) as EarlyBinder<PolyFnSig>, this.tcx, args, fold_Binder(fold_FnSig)));

      // Unit testing: function items annotated with
      // `#[rustc_evaluate_where_clauses]` trigger special output
      // to let us test the trait evaluation system.
      if (this.has_rustc_attrs && find_attr(HasAttrs_DefId.get_attrs(def_id_, this.tcx), (a) => (a.$ === "RustcEvaluateWhereClauses" ? null : undefined)) !== undefined) {
        const clauses_ = this.tcx.clauses_of(def_id_) as GenericClausesT;
        const clauses = GenericClauses.instantiate(clauses_, this.tcx, args);
        for (const [clause_, clause_span] of clauses) {
          const clause = Unnormalized.skip_norm_wip(clause_);
          const obligation = Obligation.new(this.tcx, ObligationCause.dummy_with_span(callee_expr.span), this.param_env, clause, upcast_Clause);
          const result = this.evaluate_obligation(obligation);
          this.dcx()
            .struct_span_err(
              callee_expr.span,
              `evaluate(${format_debug(clause, debug_Clause, PLAIN)}) = ${debug_result(result, PLAIN, debug_EvaluationResult, debug_OverflowError)}`,
            )
            .with_span_label(clause_span, "predicate")
            .emit();
        }
      }
      fn_sig_ = fn_sig;
      def_id = def_id_;
      callee_generic_args = args;
      break;
    }

    // FIXME(const_trait_impl): these arms should error because we can't enforce them
    case "FnPtr":
      fn_sig_ = PolyFnSigTys.with(k._0, k._1);
      def_id = undefined;
      callee_generic_args = undefined;
      break;

    default:
      return unreachable();
  }

  // Replace any late-bound regions that appear in the function
  // signature with region variables. We also have to
  // renormalize the associated types at this point, since they
  // previously appeared within a `Binder<>` and hence would not
  // have been normalized before.
  const fn_sig_i = this.instantiate_binder_with_fresh_vars(call_expr.span, BoundRegionConversionTime.FnCall, fn_sig_, fold_FnSig);
  const fn_sig = this.normalize(call_expr.span, Unnormalized.new_wip(fn_sig_i), fold_FnSig);

  // Splatted FnDefs use the DefId to look up the type, FnPtrs need it directly
  const fn_id: SplatLoweringInfo = def_id !== undefined ? { $: "FnDef", _0: def_id } : { $: "FnPtr", _0: callee_ty };

  this.check_argument_types_maybe_method_like(fn_sig, call_expr, arg_exprs, expected, TupleArgumentsFlag.with_fn_sig_kind(fn_sig.fn_sig_kind, false), fn_id, callee_generic_args);

  // Splatting is currently incompatible with RustCall.
  if (FnSig.abi(fn_sig).$ === "RustCall") {
    const last_arg = arg_exprs[arg_exprs.length - 1];
    const sp = last_arg === undefined ? call_expr.span : last_arg.span;
    const inputs = FnSig.inputs(fn_sig);
    const ty = inputs[inputs.length - 1];
    if (ty !== undefined && FnSig.splatted(fn_sig) === undefined) {
      this.register_bound(ty, this.tcx.require_lang_item("Tuple", sp), this.cause(sp, { $: "RustCall" }));
      this.require_type_is_sized(ty, sp, { $: "RustCall" });
    } else {
      this.dcx().emit_err(diagnostics.RustCallIncorrectArgs_diagnostic({ span: sp }));
    }
  }

  return FnSig.output(fn_sig);
};

/// Performs arguments check with an additional routine of adjusting the first argument,
/// (and possibly other arguments) so it corresponds to the first parameter of the function.
/// We reuse adjustments that are obtained from `probe_for_name`, where the first argument pretends to be
/// a receiver like in a method call. At this point this routine is used for delegations,
/// as from this moment we always generate a call (earlier method calls were generated),
/// so we can both propagate parent generics and get benefits from adjustments from method call.
// rustc: compiler/rustc_hir_typeck/src/callee.rs:659 check_argument_types_maybe_method_like
FnCtxt.prototype.check_argument_types_maybe_method_like = function (
  this: FnCtxt,
  fn_sig: FnSigT,
  call_expr: hir.Expr,
  arg_exprs: readonly hir.Expr[],
  expected: Expectation,
  tuple_arguments_flag: TupleArgumentsFlag,
  fn_id: SplatLoweringInfo,
  callee_generic_args: GenericArgs | undefined,
): void {
  const do_check = (): void => {
    this.check_argument_types(
      call_expr.span,
      call_expr,
      FnSig.inputs(fn_sig),
      FnSig.output(fn_sig),
      expected,
      arg_exprs,
      FnSig.c_variadic(fn_sig),
      tuple_arguments_flag,
      fn_id,
      callee_generic_args,
    );
  };

  const info = this.get_info_for_method_call_adjustments(call_expr, arg_exprs);
  if (info === undefined) {
    return do_check();
  }
  const [candidate_res, args_to_map_] = info;

  // After we found pick for first argument we need to resolve inference variables
  // in order to find adjustments for other mapped arguments.
  let resolved_inputs: readonly Ty[] = [];
  const prev_types = new HirIdMap<[Ty, Adjustment[]]>();
  const formal_input_tys = FnSig.inputs(fn_sig);

  const args_to_map: [number, hir.Expr][] = arg_exprs.map((arg, idx): [number, hir.Expr] => [idx, arg]).filter(([idx, _]) => args_to_map_.has(idx));

  for (const [idx, arg] of args_to_map) {
    const is_first_arg = idx === 0;
    const self_ty_override = is_first_arg ? undefined : unwrap(resolved_inputs[idx], `index out of bounds: the len is ${resolved_inputs.length} but the index is ${idx}`);
    const scope: ProbeScope = { $: "Single", _0: candidate_res, _1: self_ty_override };
    const arg_type = this.check_expr(arg);

    // Reuse method probing that is used during method call, as all this code pretends that
    // we generated method call.
    const pick_ = this.probe_for_name(Mode.MethodCall, Ident.dummy(), undefined, { _0: false }, arg_type, call_expr.hir_id, scope);

    if (pick_.$ !== "Ok") return do_check();
    const pick = pick_._0;

    const ctx = ConfirmContext.new(this, arg.span, arg, arg);
    const [adjusted_arg_type, method_adjustments] = ctx.create_ty_adjustments_from_pick(arg_type, pick);

    if (is_first_arg && args_to_map.length > 1) {
      // We successfully found a pick and adjustments for first argument,
      // now we have to unify it with signature input in order to resolve
      // all inference variables. After that we update input signature for
      // adjustments search for mapped arguments.
      const cause = this.cause(call_expr.span, { $: "WellFormed", _0: { $: "HirId", _0: call_expr.hir_id } });
      if (this.at(cause, this.param_env).sup(DefineOpaqueTypes.Yes, unwrap(formal_input_tys[0]), adjusted_arg_type, ToTrace_Ty).$ === "Err") {
        return do_check();
      }

      resolved_inputs = this.deeply_resolve_ignoring_regions([...formal_input_tys], fold_Vec(fold_Ty));
    }

    // Fool typechecker by placing an adjusted type of the first arg to avoid errors.
    // We already wrote type of `first_expr` during `self.check_expr(first_expr)` above.
    const node_types = this.typeck_results.node_types_mut();
    const prev = node_types.insert(arg.hir_id, adjusted_arg_type);
    prev_types.set(arg.hir_id, [unwrap(prev, "must be set"), method_adjustments]);
  }

  do_check();

  for (const [_, arg] of args_to_map) {
    const results = this.typeck_results;
    const adjustments = results.adjustments_mut();

    const entry = prev_types.get(arg.hir_id);
    prev_types.delete(arg.hir_id);
    const [prev_type, method_adjustments] = unwrap(entry, "must be in a map");

    // Remove any added adjustments for arg expression during `do_check` and replace them with ours.
    // PORT: `*adjustments.entry(id).or_default() = method_adjustments` is an insert.
    adjustments.insert(arg.hir_id, method_adjustments);

    // Restore original first provided arg type.
    results.node_types_mut().insert(arg.hir_id, prev_type);
  }
};

/// Gets scope for method-call like adjustments for the first argument of the call.
/// Now only delegations are processed this way.
// rustc: compiler/rustc_hir_typeck/src/callee.rs:781 get_info_for_method_call_adjustments
FnCtxt.prototype.get_info_for_method_call_adjustments = function (this: FnCtxt, call_expr: hir.Expr, arg_exprs: readonly hir.Expr[]): [DefId, Set<number>] | undefined {
  // Check that we are inside delegation and processing its call. First, we check that
  // the parent of call expr. is delegation and then make sure that it is compiler-generated
  // by comparing their hir ids (otherwise we will encounter errors in nested delegations,
  // see tests\ui\delegation\impl-reuse-pass.rs:237).
  const parent_def = this.tcx.hir_get_parent_item(call_expr.hir_id).def_id;
  const info = this.tcx.hir_opt_delegation_info(parent_def);
  if (info === undefined) {
    return undefined;
  }

  if (!HirId_eq(call_expr.hir_id, info.call_expr_id)) {
    return undefined;
  }

  // Check that delegation has first provided arg and that the call path
  // resolves to a trait method (inherent methods are not yet supported).
  if (arg_exprs.length === 0 || !((i) => i !== undefined && AssocItem.is_method(i))(this.tcx.opt_associated_item(info.call_path_res))) {
    return undefined;
  }

  return [info.call_path_res, info.arguments_to_map];
};

/// Attempts to reinterpret `method(rcvr, args...)` as `rcvr.method(args...)`
/// and suggesting the fix if the method probe is successful.
// rustc: compiler/rustc_hir_typeck/src/callee.rs:812 suggest_call_as_method
FnCtxt.prototype.suggest_call_as_method = function (this: FnCtxt, diag: Diag, segment: hir.PathSegment, arg_exprs: readonly hir.Expr[], call_expr: hir.Expr, expected: Expectation): void {
  if (arg_exprs.length >= 1) {
    const callee_expr = arg_exprs[0]!;
    const rest = arg_exprs.slice(1);
    const callee_ty = this.typeck_results.expr_ty_adjusted_opt(callee_expr);
    if (callee_ty === undefined) {
      return;
    }

    // First, do a probe with `IsSuggestion(true)` to avoid emitting
    // any strange errors. If it's successful, then we'll do a true
    // method lookup.
    const pick_ = this.lookup_probe_for_diagnostic(
      segment.ident,
      callee_ty,
      call_expr,
      // We didn't record the in scope traits during late resolution
      // so we need to probe AllTraits unfortunately
      ProbeScope.AllTraits,
      Expectation.only_has_type(expected, this),
    );
    if (pick_.$ !== "Ok") {
      return;
    }

    const pick = this.confirm_method_for_diagnostic(call_expr.span, callee_expr, call_expr, callee_ty, pick_._0, segment);
    if (pick.illegal_sized_bound !== undefined) {
      return;
    }

    const callee_expr_span = Span.find_ancestor_inside(callee_expr.span, call_expr.span);
    if (callee_expr_span === undefined) {
      return;
    }
    const up_to_rcvr_span = Span.until(segment.ident.span, callee_expr_span);
    const rest_span = Span.to(Span.shrink_to_hi(callee_expr_span), Span.shrink_to_hi(call_expr.span));
    const first = rest[0];
    let rest_snippet: Result<string, unknown>;
    if (first !== undefined) {
      const r = this.tcx.sess.source_map().span_to_snippet(Span.to(first.span, Span.shrink_to_hi(call_expr.span)));
      rest_snippet = r.$ === "Ok" ? { $: "Ok", _0: r._0.toString() } : r;
    } else {
      rest_snippet = { $: "Ok", _0: ")" };
    }

    if (rest_snippet.$ === "Ok") {
      const rest_snippet_ = rest_snippet._0;
      const sugg: [Span, string][] =
        ExprPrecedence_discriminant[this.precedence(callee_expr)] >= ExprPrecedence_discriminant["Unambiguous"]
          ? [
              [up_to_rcvr_span, ""],
              [rest_span, `.${display_Ident(segment.ident)}(${rest_snippet_}`],
            ]
          : [
              [up_to_rcvr_span, "("],
              [rest_span, `).${display_Ident(segment.ident)}(${rest_snippet_}`],
            ];
      const self_ty = this.deeply_resolve_ignoring_regions(unwrap(FnSig.inputs(pick.callee.sig)[0]), fold_Ty);
      const trait_def_id = AssocItem.trait_container(this.tcx.associated_item(pick.callee.def_id) as AssocItemT, this.tcx);
      diag.multipart_suggestion(
        `use the \`.\` operator to call the method \`${trait_def_id === undefined ? "" : this.tcx.def_path_str(trait_def_id) + "::"}${display_Ident(segment.ident)}\` on \`${display_Ty(self_ty)}\``,
        sugg,
        "MaybeIncorrect",
      );
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:900 report_invalid_callee
FnCtxt.prototype.report_invalid_callee = function (this: FnCtxt, call_expr: hir.Expr, callee_expr: hir.Expr, callee_ty_: Ty, arg_exprs: readonly hir.Expr[]): ErrorGuaranteed {
  // Callee probe fails when APIT references errors, so suppress those
  // errors here.
  const callable_info = this.extract_callable_info(callee_ty_);
  if (callable_info !== undefined) {
    const err = TypeVisitableExt.error_reported(callable_info[2], fold_Vec(fold_Ty));
    if (err.$ === "Err") {
      return err._0;
    }
  }

  let unit_variant: [Span, string, string] | undefined = undefined;
  if (callee_expr.kind.$ === "Path") {
    const qpath = callee_expr.kind._0;
    const res = this.typeck_results.qpath_res(qpath, callee_expr.hir_id);
    if (
      res.$ === "Def" &&
      res._0.$ === "Ctor" &&
      res._0._1 === "Const" &&
      // Only suggest removing parens if there are no arguments
      arg_exprs.length === 0 &&
      Span.contains(call_expr.span, callee_expr.span)
    ) {
      const kind = res._0._0;
      let descr: string;
      switch (kind) {
        case "Struct":
          descr = "struct";
          break;
        case "Variant":
          descr = "enum variant";
          break;
      }
      const removal_span = Span.to(Span.shrink_to_hi(callee_expr.span), Span.shrink_to_hi(call_expr.span));
      unit_variant = [removal_span, descr, qpath_to_string(FnCtxt_as_PpAnn(this), qpath)];
    }
  }

  const callee_ty = this.deeply_resolve_ignoring_regions(callee_ty_, fold_Ty);
  const path: { value: string | undefined } = { value: undefined };
  const err = this.dcx().create_err(
    diagnostics.InvalidCallee_diagnostic({
      span: callee_expr.span,
      found: unit_variant !== undefined ? `${unit_variant[1]} \`${unit_variant[2]}\`` : `\`${this.tcx.short_string(callee_ty, path, print_Ty)}\``,
    }),
  );
  err.long_ty_path().value = path.value;
  if (TypeVisitableExt.references_error(callee_ty, fold_Ty)) {
    err.downgrade_to_delayed_bug();
  }

  this.identify_bad_closure_def_and_call(err, call_expr.hir_id, callee_expr.kind, callee_expr.span);

  if (unit_variant !== undefined) {
    const [removal_span, kind, path] = unit_variant;
    err.span_suggestion_verbose(removal_span, `\`${path}\` is a unit ${kind}, and does not take parentheses to be constructed`, "", "MachineApplicable");
  }

  if (callee_expr.kind.$ === "Path" && callee_expr.kind._0.$ === "Resolved" && callee_expr.kind._0._0 === undefined) {
    const path = callee_expr.kind._0._1;
    if (path.res.$ === "Local" && path.segments.length === 1) {
      const segment = path.segments[0]!;
      for (const id of this.tcx.hir_free_items()) {
        const node = this.tcx.hir_get_if_local(id.owner_id.to_def_id());
        if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Fn" && node._0.kind.ident.name === segment.ident.name) {
          err.span_label(this.tcx.def_span(id.owner_id), "this function of the same name is available here, but it's shadowed by \
the local binding");
        }
      }
    }
  }

  let inner_callee_path: hir.QPath | undefined = undefined;
  let def: Res;
  const ck = callee_expr.kind;
  switch (ck.$) {
    case "Path":
      def = this.typeck_results.qpath_res(ck._0, callee_expr.hir_id);
      break;
    case "Call": {
      const inner_callee = ck._0;
      if (inner_callee.kind.$ === "Path") {
        const inner_qpath = inner_callee.kind._0;
        inner_callee_path = inner_qpath;
        def = this.typeck_results.qpath_res(inner_qpath, inner_callee.hir_id);
      } else {
        def = { $: "Err" };
      }
      break;
    }
    default:
      def = { $: "Err" };
  }

  if (!this.maybe_suggest_bad_array_definition(err, call_expr, callee_expr)) {
    // If the call spans more than one line and the callee kind is
    // itself another `ExprCall`, that's a clue that we might just be
    // missing a semicolon (#51055, #106515).
    const call_is_multiline =
      this.tcx.sess.source_map().is_multiline(Span.with_lo(call_expr.span, Span.hi(callee_expr.span))) && Span.eq_ctxt(call_expr.span, callee_expr.span);
    if (call_is_multiline) {
      err.span_suggestion(Span.shrink_to_hi(callee_expr.span), "consider using a semicolon here to finish the statement", ";", "MaybeIncorrect");
    }
    const info = this.extract_callable_info(callee_ty);
    if (info !== undefined && !this.type_is_sized_modulo_regions(this.param_env, info[1])) {
      const [maybe_def_, output_ty, _] = info;
      const maybe_def = maybe_def_;
      const descr = maybe_def.$ === "DefId" ? this.tcx.def_descr(maybe_def._0) : maybe_def._0;
      err.span_label(callee_expr.span, `this ${descr} returns an unsized value \`${display_Ty(output_ty)}\`, so it cannot be called`);
      let def_span: Span | undefined;
      if (maybe_def.$ === "DefId" && (def_span = this.tcx.hir_span_if_local(maybe_def._0)) !== undefined) {
        err.span_label(def_span, "the callable type is defined here");
      }
    } else {
      err.span_label(call_expr.span, "call expression requires function");
    }
  }

  const span = this.tcx.hir_res_span(def);
  if (span !== undefined) {
    let label: DiagMessage | undefined;
    if (unit_variant !== undefined) {
      const [_, kind, path] = unit_variant;
      err.arg("kind", IntoDiagArg.of(kind, str_into_diag_arg));
      err.arg("path", IntoDiagArg.of(path, String_into_diag_arg));
      label = msg("{$kind} `{$path}` defined here");
    } else if (inner_callee_path !== undefined && inner_callee_path.$ === "Resolved") {
      const path = inner_callee_path._1;
      const p = this.tcx.sess.source_map().span_to_snippet(path.span);
      if (p.$ === "Ok") {
        err.arg("func", IntoDiagArg.of(p._0.toString(), String_into_diag_arg));
        err.arg("ty", IntoDiagArg.of(callee_ty, Ty_into_diag_arg));
        label = msg("`{$func}` defined here returns `{$ty}`");
      } else {
        label = undefined;
      }
    } else {
      switch (def.$) {
        // Emit a different diagnostic for local variables, as they are not
        // type definitions themselves, but rather variables *of* that type.
        case "Local": {
          err.arg("local_name", IntoDiagArg.of(this.tcx.hir_name(def._0), Symbol_into_diag_arg));
          err.arg("ty", IntoDiagArg.of(callee_ty, Ty_into_diag_arg));
          label = msg("`{$local_name}` has type `{$ty}`");
          break;
        }
        case "Def":
          if (DefKind.ns(def._0) === Namespace.ValueNS) {
            err.arg("path", IntoDiagArg.of(this.tcx.def_path_str(def._1), String_into_diag_arg));
            label = msg("`{$path}` defined here");
            break;
          }
          err.arg("path", IntoDiagArg.of(display_Ty(callee_ty), String_into_diag_arg));
          label = msg("`{$path}` defined here");
          break;
        default: {
          err.arg("path", IntoDiagArg.of(display_Ty(callee_ty), String_into_diag_arg));
          label = msg("`{$path}` defined here");
        }
      }
    }
    if (label !== undefined) {
      err.span_label(span, label);
    }
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:1079 confirm_deferred_closure_call
FnCtxt.prototype.confirm_deferred_closure_call = function (this: FnCtxt, call_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation, closure_def_id: LocalDefId, fn_sig: FnSigT): Ty {
  // `fn_sig` is the *signature* of the closure being called. We
  // don't know the full details yet (`Fn` vs `FnMut` etc), but we
  // do know the types expected for each argument and the return
  // type.
  this.check_argument_types(
    call_expr.span,
    call_expr,
    FnSig.inputs(fn_sig),
    FnSig.output(fn_sig),
    expected,
    arg_exprs,
    FnSigKind.c_variadic(fn_sig.fn_sig_kind),
    TupleArgumentsFlag.rust_fn_trait_call(),
    { $: "FnDef", _0: LocalDefIdC.to_def_id(closure_def_id) },
    undefined,
  );

  return FnSig.output(fn_sig);
};

// #[tracing::instrument(level = "debug", skip(self, span))]
// rustc: compiler/rustc_hir_typeck/src/callee.rs:1108 enforce_context_effects
FnCtxt.prototype.enforce_context_effects = function (this: FnCtxt, call_hir_id: HirId | undefined, span: Span, callee_did: DefId, callee_args: GenericArgs): void {
  const const_context = this.tcx.hir_body_const_context(this.body_def_id);

  const constness = this.tcx.constness(callee_did) as hir.Constness;
  if (constness.$ === "Const" && constness.always) {
    if (const_context !== undefined && (const_context.$ === "Const" || const_context.$ === "Static")) {
      // ok
    } else {
      this.dcx().emit_err(
        diagnostics.ComptimeFnCalledOutsideConstContext_diagnostic({
          span,
          const_block: {
            left: Span.shrink_to_lo(span),
            right: Span.shrink_to_hi(span),
          },
        }),
      );
    }
  }

  // FIXME(const_trait_impl): We should be enforcing these effects unconditionally.
  // This can be done as soon as we convert the standard library back to
  // using const traits, since if we were to enforce these conditions now,
  // we'd fail on basically every builtin trait call (i.e. `1 + 2`).
  if (!this.tcx.features().const_trait_impl()) {
    return;
  }

  // If we have `rustc_do_not_const_check`, do not check `[const]` bounds.
  if (this.has_rustc_attrs && find_attr(HasAttrs_LocalDefId.get_attrs(this.body_def_id, this.tcx), (a) => (a.$ === "RustcDoNotConstCheck" ? null : undefined)) !== undefined) {
    return;
  }

  let host: "Const" | "Maybe";
  if (const_context !== undefined && (const_context.$ === "Const" || const_context.$ === "Static")) {
    host = "Const";
  } else if (const_context !== undefined && const_context.$ === "ConstFn") {
    host = "Maybe";
  } else {
    return;
  }

  // FIXME(const_trait_impl): Should this be `is_const_fn_raw`? It depends on if we move
  // const stability checking here too, I guess.
  if (this.tcx.is_conditionally_const(callee_did)) {
    const q = this.tcx.const_conditions(callee_did) as ConstConditionsT;
    for (const [idx, [cond, pred_span]] of ConstConditions.instantiate(q, this.tcx, callee_args).entries()) {
      const code: ObligationCauseCode = call_hir_id !== undefined ? { $: "HostEffectInExpr", _0: callee_did, _1: pred_span, _2: call_hir_id, _3: idx } : { $: "WhereClause", _0: callee_did, _1: pred_span };
      const cause = this.cause(span, code);
      this.register_predicate(Obligation.new(this.tcx, cause, this.param_env, Unnormalized.skip_norm_wip(UnnormalizedPolyTraitRef.to_host_effect_clause(cond, this.tcx, host)), upcast_Clause));
    }
  } else {
    // FIXME(const_trait_impl): This should eventually be caught here.
    // For now, though, we defer some const checking to MIR.
  }
};

// rustc: compiler/rustc_hir_typeck/src/callee.rs:1181 confirm_overloaded_call
FnCtxt.prototype.confirm_overloaded_call = function (this: FnCtxt, call_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation, method: MethodCallee): Ty {
  // FIXME(splat): if we ever support splatting here, decrement the splatted index, because
  // the receiver argument is removed below.
  const splatted = FnSigKind.splatted(method.sig.fn_sig_kind);
  if (splatted !== undefined) {
    panic(`assertion \`left == right\` failed: splatting is not supported on RustCall tuples\n  left: Some(${splatted})\n right: None`);
  }
  this.check_argument_types(
    call_expr.span,
    call_expr,
    FnSig.inputs(method.sig).slice(1),
    FnSig.output(method.sig),
    expected,
    arg_exprs,
    FnSigKind.c_variadic(method.sig.fn_sig_kind),
    TupleArgumentsFlag.rust_fn_trait_call(),
    { $: "FnDef", _0: method.def_id },
    undefined,
  );

  this.write_method_call_and_enforce_effects(call_expr.hir_id, call_expr.span, method);

  return FnSig.output(method.sig);
};
// }

// impl<'a, 'tcx> DeferredCallResolution<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/callee.rs:1224 resolve
DeferredCallResolution.prototype.resolve = function (this: DeferredCallResolution, fcx: FnCtxt): void {
  // debug!("DeferredCallResolution::resolve() {:?}", self);

  // we should not be invoked until the closure kind has been
  // determined by upvar inference
  assert(fcx.closure_kind(this.closure_ty) !== undefined, "assertion failed: fcx.closure_kind(self.closure_ty).is_some()");

  // We may now know enough to figure out fn vs fnmut etc.
  const r = fcx.try_overloaded_call_traits(this.call_expr, this.closure_ty, undefined);
  if (r !== undefined) {
    const [autoref, method_callee] = r;
    // One problem is that when we get here, we are going
    // to have a newly instantiated function signature
    // from the call trait. This has to be reconciled with
    // the older function signature we had before. In
    // principle we *should* be able to fn_sigs(), but we
    // can't because of the annoying need for a TypeTrace.
    // (This always bites me, should find a way to
    // refactor it.)
    const method_sig = method_callee.sig;

    // debug!("attempt_resolution: method_callee={:?}", method_callee);

    const method_inputs = FnSig.inputs(method_sig).slice(1);
    const self_inputs = FnSig.inputs(this.fn_sig);
    for (let i = 0; i < method_inputs.length && i < self_inputs.length; i++) {
      const method_arg_ty = method_inputs[i]!;
      const self_arg_ty = self_inputs[i]!;
      fcx.demand_eqtype(this.call_expr.span, self_arg_ty, method_arg_ty);
    }

    fcx.demand_eqtype(this.call_expr.span, FnSig.output(method_sig), FnSig.output(this.fn_sig));

    const adjustments = this.adjustments;
    if (autoref !== undefined) adjustments.push(autoref);
    fcx.apply_adjustments(this.callee_expr, adjustments);

    fcx.write_method_call_and_enforce_effects(this.call_expr.hir_id, this.call_expr.span, method_callee);
  } else {
    const guar =
      fcx.tainted_by_errors() ??
      fcx.dcx().span_delayed_bug(this.call_expr.span, `Expected to find a suitable \`Fn\`/\`FnMut\`/\`FnOnce\` implementation for \`${display_Ty(this.closure_ty)}\``);
    fcx.write_resolution(this.call_expr.hir_id, Err(guar));
  }
};
// }
