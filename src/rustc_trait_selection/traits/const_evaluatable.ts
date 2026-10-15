//! Checking that constant values used in types can be successfully evaluated.
//!
//! For concrete constants, this is fairly simple as we can just try and evaluate it.
//!
//! When dealing with polymorphic constants, for example `size_of::<T>() - 1`,
//! this is not as easy.
//!
//! In this case we try to build an abstract representation of this constant using
//! `thir_abstract_const` which can then be checked for structural equality with other
//! generic constants mentioned in the `caller_bounds` of the current environment.
//
// Port of compiler/rustc_trait_selection/src/traits/const_evaluatable.rs (lane trait-sel-traits-c).
//
// PORT notes (file-wide):
// - `rustc_middle::ty::abstract_const::NotConstEvaluatable` is not ported in rustc_middle yet (abstract_const.rs only has
//   its `TyCtxt` stub); its shape is declared here (`PORT(merge)`) for root to move.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.

import { evaluate_const, try_evaluate_const } from "./mod.ts";
import { ObligationCtxt } from "./engine.ts";
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { Applicability } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/infer/mod.ts";
import { ToTrace_Const } from "../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { ScrubbedTraitError } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { Binder as BinderC } from "../../rustc_type_ir/binder.ts";
import { AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { relate_AliasConst } from "../../rustc_type_ir/relate.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Unnormalized as UnnormalizedC } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

/** PORT(merge): `rustc_middle::ty::abstract_const::NotConstEvaluatable` (abstract_const.rs:14, not ported in rustc_middle). */
export type NotConstEvaluatable = { readonly $: "Error"; readonly _0: ErrorGuaranteed } | { readonly $: "MentionsInfer" } | { readonly $: "MentionsParam" };
const NotConstEvaluatable = {
  MentionsInfer: Object.freeze({ $: "MentionsInfer" as const }),
  MentionsParam: Object.freeze({ $: "MentionsParam" as const }),
};

/// Check if a given constant can be evaluated.
// #[instrument(skip(infcx), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/const_evaluatable.rs:24 is_const_evaluatable
export function is_const_evaluatable(infcx: InferCtxt, unexpanded_ct: Const, param_env: ParamEnv, span: Span): Result<null, NotConstEvaluatable> {
  const tcx = infcx.tcx;
  switch (tcx.expand_abstract_consts(unexpanded_ct, fold_Const).kind().$) {
    case "Alias":
    case "Expr":
      break;
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Value":
    case "Error":
      return Ok(null);
    case "Infer":
      return Err(NotConstEvaluatable.MentionsInfer);
  }

  if (tcx.features().generic_const_exprs()) {
    const ct = tcx.expand_abstract_consts(unexpanded_ct, fold_Const);

    const k = ct.kind();
    const is_anon_ct = k.$ === "Alias" && k._1.kind.$ === "Anon";

    if (!is_anon_ct) {
      if (satisfied_from_param_env(tcx, infcx, ct, param_env)) {
        return Ok(null);
      }
      if (TypeVisitableExt.has_non_region_infer(ct, fold_Const)) {
        return Err(NotConstEvaluatable.MentionsInfer);
      } else if (TypeVisitableExt.has_non_region_param(ct, fold_Const)) {
        return Err(NotConstEvaluatable.MentionsParam);
      }
    }

    switch (unexpanded_ct.kind().$) {
      case "Expr":
        // FIXME(generic_const_exprs): we have a fully concrete `ConstKind::Expr`, but
        // haven't implemented evaluating `ConstKind::Expr` yet, so we are unable to tell
        // if it is evaluatable or not. As this is unreachable for now, we can simple ICE
        // here.
        return tcx.dcx().span_bug(span, "evaluating `ConstKind::Expr` is not currently supported");
      case "Alias": {
        const r = try_evaluate_const(infcx, unexpanded_ct, param_env, (ty) => Ok(UnnormalizedC.skip_norm_wip(ty)));
        if (r.$ === "Err" && r._0.$ === "HasGenericsOrInfers") {
          return Err({ $: "Error", _0: infcx.dcx().span_delayed_bug(span, "Missing value for constant, but no error reported?") });
        } else if (r.$ === "Err" && (r._0.$ === "EvaluationFailure" || r._0.$ === "InvalidConstParamTy")) {
          const e = r._0._0;
          return Err({ $: "Error", _0: e });
        } else if (r.$ === "Ok") {
          return Ok(null);
        }
        // PORT: `Err(FailedNormalization(!))` is uninhabited (the closure's error type is `!`).
        return unreachable_never();
      }
      default:
        return bug(`unexpected constkind in \`is_const_evalautable: ${debug_Const(unexpanded_ct, PLAIN)}\``);
    }
  } else if (tcx.features().gca()) {
    // This is a sanity check to make sure that non-generics consts are checked to
    // be evaluatable in case they aren't cchecked elsewhere. This will NOT error
    // if the const uses generics, as desired.
    evaluate_const(infcx, unexpanded_ct, param_env);
    return Ok(null);
  } else {
    const uk = unexpanded_ct.kind();
    let alias_const;
    if (uk.$ === "Alias") {
      alias_const = uk._1;
    } else if (uk.$ === "Expr") {
      return bug("`ConstKind::Expr` without `feature(generic_const_exprs)` enabled");
    } else {
      return bug(`unexpected constkind in \`is_const_evalautable: ${debug_Const(unexpanded_ct, PLAIN)}\``);
    }

    const r = try_evaluate_const(infcx, unexpanded_ct, param_env, (ty) => Ok(UnnormalizedC.skip_norm_wip(ty)));
    // If we're evaluating a generic foreign constant, under a nightly compiler while
    // the current crate does not enable `feature(generic_const_exprs)`, abort
    // compilation with a useful error.
    if (r.$ === "Err" && tcx.sess.is_nightly_build() && satisfied_from_param_env(tcx, infcx, tcx.expand_abstract_consts(unexpanded_ct, fold_Const), param_env)) {
      return tcx
        .dcx()
        .struct_span_fatal(
          // Slightly better span than just using `span` alone
          span === DUMMY_SP ? AliasConstKind.def_span(alias_const.kind, as_interner(tcx)) : span,
          "failed to evaluate generic const expression",
        )
        .with_note("the crate this constant originates from uses `#![feature(generic_const_exprs)]`")
        .with_span_suggestion_verbose(DUMMY_SP, "consider enabling this feature", "#![feature(generic_const_exprs)]\n", Applicability.MaybeIncorrect)
        .emit_fatal();
    } else if (r.$ === "Err" && r._0.$ === "HasGenericsOrInfers") {
      let err: NotConstEvaluatable;
      if (TypeVisitableExt.has_non_region_infer(alias_const, relate_AliasConst)) {
        err = NotConstEvaluatable.MentionsInfer;
      } else if (TypeVisitableExt.has_non_region_param(alias_const, relate_AliasConst)) {
        err = NotConstEvaluatable.MentionsParam;
      } else {
        const guar = infcx.dcx().span_delayed_bug(span, "Missing value for constant, but no error reported?");
        err = { $: "Error", _0: guar };
      }

      return Err(err);
    } else if (r.$ === "Err" && (r._0.$ === "EvaluationFailure" || r._0.$ === "InvalidConstParamTy")) {
      const e = r._0._0;
      return Err({ $: "Error", _0: e });
    } else if (r.$ === "Ok") {
      return Ok(null);
    }
    // PORT: `Err(FailedNormalization(!))` is uninhabited (the closure's error type is `!`).
    return unreachable_never();
  }
}

// #[instrument(skip(infcx, tcx), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/traits/const_evaluatable.rs:157 satisfied_from_param_env
function satisfied_from_param_env(tcx: TyCtxt, infcx: InferCtxt, ct: Const, param_env: ParamEnv): boolean {
  let single_match: Result<Const, null> | undefined = undefined;

  for (const clause of param_env.caller_bounds()) {
    const k = BinderC.skip_binder(clause.kind());
    if (k.$ === "ConstEvaluatable") {
      const ce = k._0;
      const b_ct = tcx.expand_abstract_consts(ce, fold_Const);
      const v = new Visitor(ct, param_env, infcx, single_match);
      fold_Const.visit_with(b_ct, v);

      single_match = v.single_match;
    } else {
      // don't care
    }
  }

  if (single_match !== undefined && single_match.$ === "Ok") {
    const c = single_match._0;
    const ocx = ObligationCtxt.new(infcx);
    assert(ocx.eq(ObligationCause.dummy(), param_env, c, ct, ToTrace_Const).$ === "Ok", "assertion failed: ocx.eq(&ObligationCause::dummy(), param_env, c, ct).is_ok()");
    assert(TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity()), "assertion failed: ocx.evaluate_obligations_error_on_ambiguity().no_errors()");
    return true;
  }

  // debug!("is_const_evaluatable: no");
  return false;
}

// Try to unify with each subtree in the AbstractConst to allow for
// `N + 1` being const evaluatable even if theres only a `ConstEvaluatable`
// predicate for `(N + 1) * 2`
// PORT: the fn-local `struct Visitor` of `satisfied_from_param_env`, at module level.
class Visitor implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result = VisitorResult.unit;

  constructor(
    public ct: Const,
    public param_env: ParamEnv,

    public infcx: InferCtxt,
    public single_match: Result<Const, null> | undefined,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/traits/const_evaluatable.rs:175 visit_const
  visit_const(c: Const): undefined {
    // debug!("is_const_evaluatable: candidate={:?}", c);
    if (
      this.infcx.probe((_) => {
        const ocx = ObligationCtxt.new(this.infcx);
        return ocx.eq(ObligationCause.dummy(), this.param_env, c, this.ct, ToTrace_Const).$ === "Ok" && TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
      })
    ) {
      const m = this.single_match;
      if (m === undefined) {
        this.single_match = Ok(c);
      } else if (m.$ === "Ok" && m._0 === c) {
        this.single_match = Ok(c);
      } else {
        this.single_match = Err(null);
      }
    }

    const k = c.kind();
    if (k.$ === "Expr") {
      const e = k._0;
      fold_Expr().visit_with(e, this);
    } else {
      // FIXME(generic_const_exprs): This doesn't recurse into `<T as Trait<U>>::ASSOC`'s args.
      // This is currently unobservable as `<T as Trait<{ U + 1 }>>::ASSOC` creates an anon const
      // with its own `ConstEvaluatable` bound in the param env which we will visit separately.
      //
      // If we start allowing directly writing `ConstKind::Expr` without an intermediate anon const
      // this will be incorrect. It might be worth investigating making `clauses_of` elaborate
      // all of the `ConstEvaluatable` bounds rather than having a visitor here.
    }
  }

  // (provided) the methods `Visitor` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_ty(t: Ty): undefined {
    return TypeVisitor_provided.visit_ty(this, t);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** An uninhabited match arm (`!`). */
function unreachable_never(): never {
  return bug("unreachable: uninhabited `!`");
}

/** `ty::Expr`'s `TypeVisitable` as a D4 descriptor. */
function fold_Expr(): TypeVisitable<import("../../rustc_middle/ty/consts/kind.ts").Expr> {
  const m = require("../../rustc_middle/ty/consts/kind.ts") as typeof import("../../rustc_middle/ty/consts/kind.ts");
  return { visit_with: m.visit_with_Expr };
}
