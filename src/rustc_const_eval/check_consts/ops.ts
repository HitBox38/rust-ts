// Port of compiler/rustc_const_eval/src/check_consts/ops.rs (lane const-check).
//
// PORT: `trait NonConstOp` is an interface; its provided methods (`status_in_item`, `importance`) live in
// `NonConstOp_provided` (PORTING §8) and every op class calls them unless upstream overrides them. The ops are classes
// (unit structs: no fields, `ops::FnCallIndirect` is `new FnCallIndirect()`); their `#[derive(Debug)]` (the
// `NonConstOp: Debug` bound, used only by `tracing`) is not ported.
// PORT: `ccx.const_kind()` is `ccx.const_kind_()` (mod.ts: the field holds the name).
//! Concrete error types for all operations which may be invalid in a certain const context.

import { add_feature_diagnostics } from "../../rustc_session/diagnostics.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Applicability, type Diag, E0658 } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type Constness, type CoroutineKind, CoroutineKind as CoroutineKindC, display_ConstContext } from "../../rustc_hir/hir.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { CallSource } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { suggest_constraining_type_param } from "../../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { display_TraitRefPrintSugared, TraitRef_print_trait_sugared, with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { sym, Symbol, type Symbol as SymbolT } from "../../rustc_span/symbol.ts";
import { is_whitespace } from "../../std/char.ts";
import { assert } from "../../std/panic.ts";
import { str_find_pred } from "../../std/str.ts";
import { type CallKind, call_kind } from "../../rustc_trait_selection/error_reporting/traits/call_kind.ts";
import { SelectionContext } from "../../rustc_trait_selection/traits/select/mod.ts";
import { as_interner, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import * as diagnostics from "../diagnostics.ts";
import type { ConstCx } from "./mod.ts";

// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:29 Status
export type Status =
  | {
      readonly $: "Unstable";
      /// The feature that must be enabled to use this operation.
      gate: SymbolT;
      /// Whether the feature gate was already checked (because the logic is a bit more
      /// complicated than just checking a single gate).
      gate_already_checked: boolean;
      /// Whether it is allowed to use this operation from stable `const fn`.
      /// This will usually be `false`.
      safe_to_expose_on_stable: boolean;
      /// We indicate whether this is a function call, since we can use targeted
      /// diagnostics for "callee is not safe to expose om stable".
      is_function_call: boolean;
    }
  | { readonly $: "Forbidden" };
export const Status = {
  Forbidden: Object.freeze({ $: "Forbidden" }) as Status,
} as const;

// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:47 DiagImportance
export type DiagImportance =
  /// An operation that must be removed for const-checking to pass.
  | "Primary"
  /// An operation that causes const-checking to fail, but is usually a side-effect of a `Primary` operation elsewhere.
  | "Secondary";
export const DiagImportance = { Primary: "Primary", Secondary: "Secondary" } as const;

/// An operation that is *not allowed* in a const context.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:56 NonConstOp
export interface NonConstOp {
  /// Returns an enum indicating whether this operation can be enabled with a feature gate.
  // (provided) ops.rs:58 status_in_item -> NonConstOp_provided.status_in_item
  status_in_item(ccx: ConstCx): Status;

  // (provided) ops.rs:62 importance -> NonConstOp_provided.importance
  importance(): DiagImportance;

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:66 build_error
  build_error(ccx: ConstCx, span: Span): Diag;
}

/** The provided methods of `NonConstOp` (PORTING §8). */
export const NonConstOp_provided = {
  /// Returns an enum indicating whether this operation can be enabled with a feature gate.
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:58 status_in_item
  status_in_item(_self: NonConstOp, _ccx: ConstCx): Status {
    return Status.Forbidden;
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:62 importance
  importance(_self: NonConstOp): DiagImportance {
    return DiagImportance.Primary;
  },
};

/** Base class giving an op the provided methods of `NonConstOp`. */
abstract class NonConstOpBase implements NonConstOp {
  status_in_item(ccx: ConstCx): Status {
    return NonConstOp_provided.status_in_item(this, ccx);
  }
  importance(): DiagImportance {
    return NonConstOp_provided.importance(this);
  }
  abstract build_error(ccx: ConstCx, span: Span): Diag;
}

/// A function call where the callee is a pointer.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:71 FnCallIndirect
export class FnCallIndirect extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:73 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.UnallowedFnPointerCall_diagnostic({ span, kind: ccx.const_kind_() }));
  }
}

/// A c-variadic function call.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:80 FnCallCVariadic
export class FnCallCVariadic extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:82 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    return {
      $: "Unstable",
      gate: sym.const_c_variadic,
      gate_already_checked: false,
      safe_to_expose_on_stable: false,
      is_function_call: true,
    };
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:91 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.tcx.sess.create_feature_err(
      diagnostics.NonConstCVariadicCall_diagnostic({ span, kind: ccx.const_kind_() }),
      sym.const_c_variadic,
    );
  }
}

/// A call to a function that is in a trait, or has trait bounds that make it conditionally-const.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:101 ConditionallyConstCall
export class ConditionallyConstCall extends NonConstOpBase {
  constructor(
    public callee: DefId,
    public args: GenericArgs,
    public span: Span,
    public call_source: CallSource,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:109 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    // We use the `const_trait_impl` gate for all conditionally-const calls.
    return {
      $: "Unstable",
      gate: sym.const_trait_impl,
      gate_already_checked: false,
      safe_to_expose_on_stable: false,
      // We don't want the "mark the callee as `#[rustc_const_stable_indirect]`" hint
      is_function_call: false,
    };
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:120 build_error
  build_error(ccx: ConstCx, _: Span): Diag {
    const diag = build_error_for_const_call(ccx, this.callee, this.args, this.span, this.call_source, "conditionally", (_, _1, _2) => {});

    // Override code and mention feature.
    diag.code(E0658);
    add_feature_diagnostics(diag, ccx.tcx.sess, sym.const_trait_impl);

    return diag;
  }
}

/// A function call where the callee is not marked as `const`.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:141 FnCallNonConst
export class FnCallNonConst extends NonConstOpBase {
  constructor(
    public callee: DefId,
    public args: GenericArgs,
    public span: Span,
    public call_source: CallSource,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:149 build_error
  build_error(ccx: ConstCx, _: Span): Diag {
    const tcx = ccx.tcx;
    const caller = ccx.def_id();

    const err = build_error_for_const_call(ccx, this.callee, this.args, this.span, this.call_source, "non", (err, self_ty, trait_id) => {
      // FIXME(const_trait_impl): Do we need any of this on the non-const codepath?

      const trait_ref = TraitRef.from_assoc(as_interner(tcx), trait_id, this.args);

      const k = self_ty.kind();
      switch (k.$) {
        case "Param": {
          const param_ty = k._0;
          // debug!(?param_ty);
          const generics = hir.Node.generics(tcx.hir_node_by_def_id(caller));
          if (generics !== undefined) {
            const constraint = with_no_trimmed_paths(() => `[const] ${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref))}`);
            suggest_constraining_type_param(tcx, generics, err, Symbol.as_str(param_ty.name), constraint, trait_ref.def_id, undefined);
          }
          break;
        }
        case "Adt": {
          const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(ccx.typing_env);
          const obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, trait_ref, TraitClause.upcast_from_TraitRef);
          const selcx = SelectionContext.new(infcx);
          const implsrc = selcx.select(obligation);
          if (implsrc.$ === "Ok" && implsrc._0 !== undefined && implsrc._0.$ === "UserDefined") {
            const data = implsrc._0._0;
            // FIXME(const_trait_impl) revisit this
            if (!tcx.is_const_trait_impl(data.impl_def_id)) {
              const span = tcx.def_span(data.impl_def_id);
              err.subdiagnostic(diagnostics.NonConstImplNote_subdiagnostic({ span }));
            }
          }
          break;
        }
        default:
          break;
      }
    });

    if (ccx.const_kind_().$ === "Static") {
      err.note("consider wrapping this expression in `std::sync::LazyLock::new(|| ...)`");
    }

    return err;
  }
}

/// Build an error message reporting that a function call is not const (or only
/// conditionally const). In case that this call is desugared (like an operator
/// or sugar from something like a `for` loop), try to build a better error message
/// that doesn't call it a method.
// rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:218 build_error_for_const_call
function build_error_for_const_call(
  ccx: ConstCx,
  callee: DefId,
  args: GenericArgs,
  span: Span,
  call_source: CallSource,
  non_or_conditionally: string,
  note_trait_if_possible: (err: Diag, self_ty: Ty, trait_id: DefId) => void,
): Diag {
  const tcx = ccx.tcx;

  const call_kind_: CallKind = call_kind(tcx, ccx.typing_env, callee, args, span, CallSource.from_hir_call(call_source), undefined);

  // debug!(?call_kind);

  let err: Diag;
  if (call_kind_.$ === "Normal" && call_kind_.desugaring !== undefined) {
    const [kind, self_ty] = call_kind_.desugaring;
    // macro_rules! error { ($err:ident) => { tcx.dcx().create_err(diagnostics::$err { span, ty: self_ty, kind: ccx.const_kind(), non_or_conditionally }) } }
    const fields = { span, ty: self_ty, kind: ccx.const_kind_(), non_or_conditionally };

    // Don't point at the trait if this is a desugaring...
    // FIXME(const_trait_impl): we could perhaps do this for `Iterator`.
    switch (kind) {
      case "ForLoopIntoIter":
      case "ForLoopIntoAsyncIter":
      case "ForLoopNext":
        err = tcx.dcx().create_err(diagnostics.NonConstForLoopIntoIter_diagnostic(fields));
        break;
      case "QuestionBranch":
        err = tcx.dcx().create_err(diagnostics.NonConstQuestionBranch_diagnostic(fields));
        break;
      case "QuestionFromResidual":
        err = tcx.dcx().create_err(diagnostics.NonConstQuestionFromResidual_diagnostic(fields));
        break;
      case "TryBlockFromOutput":
        err = tcx.dcx().create_err(diagnostics.NonConstTryBlockFromOutput_diagnostic(fields));
        break;
      case "Await":
        err = tcx.dcx().create_err(diagnostics.NonConstAwait_diagnostic(fields));
        break;
    }
  } else if (call_kind_.$ === "FnCall") {
    const { fn_trait_id, self_ty } = call_kind_;
    const kind = ccx.const_kind_();
    let note: diagnostics.NonConstClosureNote | undefined;
    const k = self_ty.kind();
    switch (k.$) {
      case "FnDef": {
        const def_id = k._0;
        const span = tcx.def_span(def_id);
        if (ccx.tcx.is_const_fn(def_id)) {
          span_bug(span, "calling const FnDef errored when it shouldn't");
        }

        note = { $: "FnDef", span };
        break;
      }
      case "FnPtr":
        note = { $: "FnPtr", kind };
        break;
      case "Closure":
        note = { $: "Closure", kind };
        break;
      default:
        note = undefined;
        break;
    }

    err = tcx.dcx().create_err(
      diagnostics.NonConstClosure_diagnostic({ span, kind: ccx.const_kind_(), note, non_or_conditionally }),
    );

    note_trait_if_possible(err, self_ty, fn_trait_id);
  } else if (call_kind_.$ === "Operator") {
    const { trait_id, self_ty } = call_kind_;
    if (call_source === "MatchCmp") {
      err = tcx.dcx().create_err(
        diagnostics.NonConstMatchEq_diagnostic({ span, kind: ccx.const_kind_(), ty: self_ty, non_or_conditionally }),
      );
    } else {
      let sugg: diagnostics.ConsiderDereferencing | undefined;

      if (ccx.tcx.is_lang_item(trait_id, LangItem.PartialEq)) {
        const a0 = GenericArg.kind(args[0]!);
        const a1 = GenericArg.kind(args[1]!);
        if (a0.$ === "Type" && a1.$ === "Type") {
          const self_ty = a0._0;
          const rhs_ty = a1._0;
          if (self_ty === rhs_ty && self_ty.is_ref() && self_ty.peel_refs().is_primitive()) {
            let num_refs = 0;
            let tmp_ty = self_ty;
            for (let tk = tmp_ty.kind(); tk.$ === "Ref"; tk = tmp_ty.kind()) {
              num_refs += 1;
              tmp_ty = tk._1;
            }
            const deref = "*".repeat(num_refs);

            const call_str = ccx.tcx.sess.source_map().span_to_snippet(span);
            let eq_idx: number | undefined;
            let rhs_idx: number | undefined;
            if (
              call_str.$ === "Ok" &&
              (eq_idx = call_str._0.find("==")) !== undefined &&
              (rhs_idx = str_find_pred(call_str._0.slice(eq_idx + 2), (c) => !is_whitespace(c))) !== undefined
            ) {
              const rhs_pos = BytePos.add(Span.lo(span), BytePos.from_usize(eq_idx + 2 + rhs_idx));
              const rhs_span = Span.with_hi(Span.with_lo(span, rhs_pos), rhs_pos);
              sugg = { deref, span: Span.shrink_to_lo(span), rhs_span };
            }
          }
        }
      }
      err = tcx.dcx().create_err(
        diagnostics.NonConstOperator_diagnostic({ span, kind: ccx.const_kind_(), sugg, non_or_conditionally }),
      );
    }

    note_trait_if_possible(err, self_ty, trait_id);
  } else if (call_kind_.$ === "DerefCoercion") {
    const { deref_target_span, deref_target_ty, self_ty } = call_kind_;
    // Check first whether the source is accessible (issue #87060)
    const target =
      deref_target_span !== undefined && tcx.sess.source_map().is_span_accessible(deref_target_span)
        ? deref_target_span
        : undefined;

    err = tcx.dcx().create_err(
      diagnostics.NonConstDerefCoercion_diagnostic({
        span,
        ty: self_ty,
        kind: ccx.const_kind_(),
        target_ty: deref_target_ty,
        deref_target: target,
        non_or_conditionally,
      }),
    );

    note_trait_if_possible(err, self_ty, tcx.require_lang_item(LangItem.Deref, span));
  } else if (opt_DefId_eq(tcx.opt_parent(callee), tcx.get_diagnostic_item(sym.FmtArgumentsNew))) {
    err = ccx.dcx().create_err(
      diagnostics.NonConstFmtMacroCall_diagnostic({ span, kind: ccx.const_kind_(), non_or_conditionally }),
    );
  } else {
    const def_descr = ccx.tcx.def_descr(callee);
    err = ccx.dcx().create_err(
      diagnostics.NonConstFnCall_diagnostic({
        span,
        def_descr,
        def_path_str: ccx.tcx.def_path_str_with_args(callee, args),
        kind: ccx.const_kind_(),
        non_or_conditionally,
      }),
    );
    const item = ccx.tcx.opt_associated_item(callee);
    if (item !== undefined) {
      let parent: DefId;
      if (item.container.$ === "Trait" && ((parent = AssocItem.container_id(item, ccx.tcx)), !ccx.tcx.is_const_trait(parent))) {
        const assoc_span = ccx.tcx.def_span(callee);
        const assoc_name = ccx.tcx.item_name(callee);
        const span: MultiSpan = MultiSpan.from_Span(ccx.tcx.def_span(parent));
        span.push_span_label(assoc_span, `this ${def_descr} is not const`);
        const trait_descr = ccx.tcx.def_descr(parent);
        const trait_span = ccx.tcx.def_span(parent);
        const trait_name = ccx.tcx.item_name(parent);
        span.push_span_label(trait_span, `this ${trait_descr} is not const`);
        err.span_note(
          span,
          `${def_descr} \`${Symbol.as_str(assoc_name)}\` is not const because ${trait_descr} \`${Symbol.as_str(trait_name)}\` is not const`,
        );
        const parent_local = parent.as_local();
        if (parent_local !== undefined && ccx.tcx.sess.is_nightly_build()) {
          if (!ccx.tcx.features().const_trait_impl()) {
            err.help("add `#![feature(const_trait_impl)]` to the crate attributes to enable const traits");
          }
          let span = ccx.tcx.hir_expect_item(parent_local).vis_span;
          span = ccx.tcx.sess.source_map().span_extend_while_whitespace(span);
          err.span_suggestion_verbose(
            Span.shrink_to_hi(span),
            `consider making trait \`${Symbol.as_str(trait_name)}\` const`,
            "const ",
            Applicability.MaybeIncorrect,
          );
        } else if (!ccx.tcx.sess.is_nightly_build()) {
          err.help("const traits are not yet supported on stable Rust");
        }
      }
    } else {
      const c = ccx.tcx.constness(callee) as Constness; // PORT: the query value is `unknown` in queries.gen.ts
      if (!(c.$ === "Const" && c.always === false)) {
        const name = ccx.tcx.item_name(callee);
        err.span_note(ccx.tcx.def_span(callee), `${def_descr} \`${Symbol.as_str(name)}\` is not const`);
      }
    }
  }

  err.note(`calls in ${display_ConstContext(ccx.const_kind_())}s are limited to constant functions, tuple structs and tuple variants`);

  return err;
}

/// A call to an `#[unstable]` const fn, `#[rustc_const_unstable]` function or trait.
///
/// Contains the name of the feature that would allow the use of this function/trait.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:452 CallUnstable
export class CallUnstable extends NonConstOpBase {
  constructor(
    public def_id: DefId,
    public feature: SymbolT,
    /// If this is true, then the feature is enabled, but we need to still check if it is safe to
    /// expose on stable.
    public feature_enabled: boolean,
    public safe_to_expose_on_stable: boolean,
    /// true if `def_id` is the function we are calling, false if `def_id` is an unstable trait.
    public is_function_call: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:464 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    return {
      $: "Unstable",
      gate: this.feature,
      gate_already_checked: this.feature_enabled,
      safe_to_expose_on_stable: this.safe_to_expose_on_stable,
      is_function_call: this.is_function_call,
    };
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:473 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    assert(!this.feature_enabled, "assertion failed: !self.feature_enabled");
    const err = this.is_function_call
      ? ccx.dcx().create_err(diagnostics.UnstableConstFn_diagnostic({ span, def_path: ccx.tcx.def_path_str(this.def_id) }))
      : ccx.dcx().create_err(diagnostics.UnstableConstTrait_diagnostic({ span, def_path: ccx.tcx.def_path_str(this.def_id) }));
    ccx.tcx.disabled_nightly_features(err, [["", this.feature]]);
    return err;
  }
}

/// A call to an intrinsic that is just not const-callable at all.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:493 IntrinsicNonConst
export class IntrinsicNonConst extends NonConstOpBase {
  constructor(public name: SymbolT) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:498 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.NonConstIntrinsic_diagnostic({ span, name: this.name, kind: ccx.const_kind_() }));
  }
}

/// A call to an intrinsic that is just not const-callable at all.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:509 IntrinsicUnstable
export class IntrinsicUnstable extends NonConstOpBase {
  constructor(
    public name: SymbolT,
    public feature: SymbolT,
    public const_stable_indirect: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:516 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    return {
      $: "Unstable",
      gate: this.feature,
      gate_already_checked: false,
      safe_to_expose_on_stable: this.const_stable_indirect,
      // We do *not* want to suggest to mark the intrinsic as `const_stable_indirect`,
      // that's not a trivial change!
      is_function_call: false,
    };
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:527 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(
      diagnostics.UnstableIntrinsic_diagnostic({
        span,
        name: this.name,
        feature: this.feature,
        suggestion: ccx.tcx.crate_level_attribute_injection_span(),
      }),
    );
  }
}

// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:538 Coroutine
export class Coroutine extends NonConstOpBase {
  constructor(public _0: CoroutineKind) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:540 status_in_item
  override status_in_item(_: ConstCx): Status {
    const k = this._0;
    if ((k.$ === "Desugared" && k._0 === "Async" && k._1 === "Block") || k.$ === "Coroutine") {
      // FIXME(coroutines): eventually we want to gate const coroutine coroutines behind a
      // different feature.
      return {
        $: "Unstable",
        gate: sym.const_async_blocks,
        gate_already_checked: false,
        safe_to_expose_on_stable: false,
        is_function_call: false,
      };
    } else {
      return Status.Forbidden;
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:558 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    const msg = `${CoroutineKindC.to_plural_string(this._0)} are not allowed in ${display_ConstContext(ccx.const_kind_())}s`;
    const status = this.status_in_item(ccx);
    if (status.$ === "Unstable") {
      const gate = status.gate;
      return ccx.tcx.sess.create_feature_err(diagnostics.UnallowedOpInConstContext_diagnostic({ span, msg }), gate);
    } else {
      return ccx.dcx().create_err(diagnostics.UnallowedOpInConstContext_diagnostic({ span, msg }));
    }
  }
}

// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:571 InlineAsm
export class InlineAsm extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:573 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.UnallowedInlineAsm_diagnostic({ span, kind: ccx.const_kind_() }));
  }
}

// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:579 LiveDrop
export class LiveDrop extends NonConstOpBase {
  constructor(
    public dropped_at: Span,
    public dropped_ty: Ty,
    public needs_non_const_drop: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:585 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    if (this.needs_non_const_drop) {
      return Status.Forbidden;
    } else {
      return {
        $: "Unstable",
        gate: sym.const_destruct,
        gate_already_checked: false,
        safe_to_expose_on_stable: false,
        is_function_call: false,
      };
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:598 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    const err = this.needs_non_const_drop
      ? ccx.dcx().create_err(
          diagnostics.LiveDrop_diagnostic({ span, dropped_ty: this.dropped_ty, kind: ccx.const_kind_(), dropped_at: this.dropped_at }),
        )
      : ccx.tcx.sess.create_feature_err(
          diagnostics.LiveDrop_diagnostic({ span, dropped_ty: this.dropped_ty, kind: ccx.const_kind_(), dropped_at: this.dropped_at }),
          sym.const_destruct,
        );

    // If the dropped type is a type parameter, suggest adding a `[const] Destruct` bound.
    // The suggestion is only offered on nightly, since `[const]` bounds are unstable.
    const k = this.dropped_ty.kind();
    if (k.$ === "Param" && ccx.tcx.sess.is_nightly_build()) {
      const param_ty = k._0;
      const tcx = ccx.tcx;
      const caller = ccx.def_id();
      const generics = hir.Node.generics(tcx.hir_node_by_def_id(caller));
      if (generics !== undefined) {
        const destruct_def_id = tcx.lang_items().destruct_trait();
        suggest_constraining_type_param(tcx, generics, err, Symbol.as_str(param_ty.name), "[const] Destruct", destruct_def_id, undefined);
      }
    }

    return err;
  }
}

/// A borrow of a type that contains an `UnsafeCell` somewhere. The borrow might escape to
/// the final value of the constant, and thus we cannot allow this (for now). We may allow
/// it in the future for static items.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:647 EscapingCellBorrow
export class EscapingCellBorrow extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:649 importance
  override importance(): DiagImportance {
    // Most likely the code will try to do mutation with these borrows, which
    // triggers its own errors. Only show this one if that does not happen.
    return DiagImportance.Secondary;
  }
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:654 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.InteriorMutableBorrowEscaping_diagnostic({ span, kind: ccx.const_kind_() }));
  }
}

/// This op is for `&mut` borrows in the trailing expression of a constant
/// which uses the "enclosing scopes rule" to leak its locals into anonymous
/// static or const items.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:664 EscapingMutBorrow
export class EscapingMutBorrow extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:667 status_in_item
  override status_in_item(_ccx: ConstCx): Status {
    return Status.Forbidden;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:671 importance
  override importance(): DiagImportance {
    // Most likely the code will try to do mutation with these borrows, which
    // triggers its own errors. Only show this one if that does not happen.
    return DiagImportance.Secondary;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:677 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.MutableBorrowEscaping_diagnostic({ span, kind: ccx.const_kind_() }));
  }
}

/// A call to a `panic()` lang item where the first argument is _not_ a `&str`.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:684 PanicNonStr
export class PanicNonStr extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:686 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.PanicNonStrErr_diagnostic({ span }));
  }
}

/// Comparing raw pointers for equality.
/// Not currently intended to ever be allowed, even behind a feature gate: operation depends on
/// allocation base addresses that are not known at compile-time.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:695 RawPtrComparison
export class RawPtrComparison extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:697 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    // FIXME(const_trait_impl): revert to span_bug?
    return ccx.dcx().create_err(diagnostics.RawPtrComparisonErr_diagnostic({ span }));
  }
}

/// Casting raw pointer or function pointer to an integer.
/// Not currently intended to ever be allowed, even behind a feature gate: operation depends on
/// allocation base addresses that are not known at compile-time.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:707 RawPtrToIntCast
export class RawPtrToIntCast extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:709 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.RawPtrToIntErr_diagnostic({ span }));
  }
}

/// An access to a thread-local `static`.
// rustc-type: compiler/rustc_const_eval/src/check_consts/ops.rs:716 ThreadLocalAccess
export class ThreadLocalAccess extends NonConstOpBase {
  // rustc: compiler/rustc_const_eval/src/check_consts/ops.rs:718 build_error
  build_error(ccx: ConstCx, span: Span): Diag {
    return ccx.dcx().create_err(diagnostics.ThreadLocalAccessErr_diagnostic({ span }));
  }
}

/** `Option<DefId> == Option<DefId>` (derived `PartialEq`). */
function opt_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : DefId_eq(a, b);
}
