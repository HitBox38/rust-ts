// Port of compiler/rustc_lint/src/for_loops_over_fallibles.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (for_loops_over_fallibles.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it, the
// `enclosing_body` field and `typing_env()` as `unknown`, so the call sites cast them (`TypeckResults`, `BodyId`,
// `TypingEnv`).
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import { Mutability as MutabilityC } from "../rustc_ast_ir/lib.ts";
import type { Expr, Pat } from "../rustc_hir/hir.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { ObligationCause, ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { GenericArgs } from "../rustc_middle/ty/decls.ts";
import { type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import type { LateContext } from "./context.ts";
import {
  ForLoopsOverFalliblesDiag_diagnostic,
  type ForLoopsOverFalliblesLoopSub,
  type ForLoopsOverFalliblesQuestionMark,
} from "./diagnostics.ts";
import { FOR_LOOPS_OVER_FALLIBLES, ForLoopsOverFallibles } from "./for_loops_over_fallibles.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./for_loops_over_fallibles.lints.gen.ts";

declare module "./for_loops_over_fallibles.lints.gen.ts" {
  interface ForLoopsOverFallibles extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for ForLoopsOverFallibles
// rustc: compiler/rustc_lint/src/for_loops_over_fallibles.rs:50 check_expr
ForLoopsOverFallibles.prototype.check_expr = function (this: ForLoopsOverFallibles, cx: LateContext, expr: Expr): void {
  const for_loop = extract_for_loop(expr);
  if (for_loop === undefined) return;
  const [pat, arg] = for_loop;

  // Do not put suggestions for external macros.
  if (Span.from_expansion(pat.span)) {
    return;
  }

  const arg_span = Span.source_callsite(arg.span);

  const ty = (cx.typeck_results_() as TypeckResults).expr_ty(arg);

  let adt: AdtDef;
  let args: GenericArgs;
  let ref_mutability: Mutability | undefined;
  const ty_kind = ty.kind();
  switch (ty_kind.$) {
    case "Adt":
      [adt, args, ref_mutability] = [ty_kind._0, ty_kind._1, undefined];
      break;
    case "Ref": {
      const inner = ty_kind._1.kind();
      if (inner.$ === "Adt") {
        [adt, args, ref_mutability] = [inner._0, inner._1, ty_kind._2];
      } else {
        return;
      }
      break;
    }
    default:
      return;
  }

  let article: string;
  let ty_: string;
  let var_: string;
  const did = adt.did();
  if (cx.tcx.is_diagnostic_item(sym.Option, did) && ref_mutability !== undefined) {
    [article, ty_, var_] = ["a", "Option", "Some"];
  } else if (cx.tcx.is_diagnostic_item(sym.Option, did)) {
    [article, ty_, var_] = ["an", "Option", "Some"];
  } else if (cx.tcx.is_diagnostic_item(sym.Result, did)) {
    [article, ty_, var_] = ["a", "Result", "Ok"];
  } else {
    return;
  }

  const ref_prefix = ref_mutability === undefined ? "" : MutabilityC.ref_prefix_str(ref_mutability);

  let sub: ForLoopsOverFalliblesLoopSub;
  const recv = extract_iterator_next_call(cx, arg);
  let recv_snip: string | undefined;
  if (
    recv !== undefined &&
    Span.can_be_used_for_suggestions(recv.span) &&
    Span.can_be_used_for_suggestions(Span.between(recv.span, Span.shrink_to_hi(arg_span))) &&
    (recv_snip = snippet(cx, recv.span)) !== undefined
  ) {
    sub = {
      $: "RemoveNext",
      suggestion: Span.between(recv.span, Span.shrink_to_hi(arg_span)),
      recv_snip,
    };
  } else {
    sub = {
      $: "UseWhileLet",
      start_span: Span.with_hi(expr.span, Span.lo(pat.span)),
      end_span: Span.between(pat.span, arg_span),
      var: var_,
    };
  }
  const question_mark: ForLoopsOverFalliblesQuestionMark | undefined = suggest_question_mark(cx, adt, args, expr.span)
    ? { suggestion: Span.shrink_to_hi(arg_span) }
    : undefined;
  const suggestion = {
    var: var_,
    start_span: Span.with_hi(expr.span, Span.lo(pat.span)),
    end_span: Span.between(pat.span, arg_span),
  };

  cx.emit_span_lint(
    FOR_LOOPS_OVER_FALLIBLES,
    arg_span,
    ForLoopsOverFalliblesDiag_diagnostic({ article, ref_prefix, ty: ty_, sub, question_mark, suggestion }),
  );
};

/** PORT: `let Ok(recv_snip) = cx.sess().source_map().span_to_snippet(recv.span)` (a let-chain binding of check_expr). */
function snippet(cx: LateContext, span: Span): string | undefined {
  const r = cx.sess().source_map().span_to_snippet(span);
  return r.$ === "Ok" ? r._0.toString() : undefined;
}

// rustc: compiler/rustc_lint/src/for_loops_over_fallibles.rs:117 extract_for_loop
function extract_for_loop(expr: Expr): [Pat, Expr] | undefined {
  if (expr.kind.$ !== "DropTemps") return undefined;
  const e = expr.kind._0;
  if (!(e.kind.$ === "Match" && e.kind._1.length === 1 && e.kind._2.$ === "ForLoopDesugar")) return undefined;
  const iterexpr = e.kind._0;
  const arm = e.kind._1[0]!;
  if (!(iterexpr.kind.$ === "Call" && iterexpr.kind._1.length === 1)) return undefined;
  const arg = iterexpr.kind._1[0]!;
  if (arm.body.kind.$ !== "Loop") return undefined;
  const block = arm.body.kind._0;
  if (block.stmts.length !== 1) return undefined;
  const stmt = block.stmts[0]!;
  if (stmt.kind.$ !== "Expr") return undefined;
  const e2 = stmt.kind._0;
  if (!(e2.kind.$ === "Match" && e2.kind._1.length === 2)) return undefined;
  const some_arm = e2.kind._1[1]!;
  if (!(some_arm.pat.kind.$ === "Struct" && some_arm.pat.kind._1.length === 1)) return undefined;
  const field = some_arm.pat.kind._1[0]!;
  return [field.pat, arg];
}

// rustc: compiler/rustc_lint/src/for_loops_over_fallibles.rs:133 extract_iterator_next_call
function extract_iterator_next_call(cx: LateContext, expr: Expr): Expr | undefined {
  // This won't work for `Iterator::next(iter)`, is this an issue?
  if (expr.kind.$ === "MethodCall") {
    const recv = expr.kind._1;
    const def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
    if (def_id !== undefined && cx.tcx.is_lang_item(def_id, "IteratorNext")) {
      return recv;
    }
  }
  return undefined;
}

// rustc: compiler/rustc_lint/src/for_loops_over_fallibles.rs:150 suggest_question_mark
function suggest_question_mark(cx: LateContext, adt: AdtDef, args: GenericArgs, span: Span): boolean {
  const body_id = cx.enclosing_body as hir.BodyId | undefined;
  if (body_id === undefined) return false;
  const into_iterator_did = cx.tcx.get_diagnostic_item(sym.IntoIterator);
  if (into_iterator_did === undefined) {
    return false;
  }

  if (!cx.tcx.is_diagnostic_item(sym.Result, adt.did())) {
    return false;
  }

  // Check that the function/closure/constant we are in has a `Result` type.
  // Otherwise suggesting using `?` may not be a good idea.
  {
    const ty = (cx.typeck_results_() as TypeckResults).expr_ty(cx.tcx.hir_body(body_id).value);
    const k = ty.kind();
    if (k.$ !== "Adt") return false;
    const ret_adt = k._0;
    if (!cx.tcx.is_diagnostic_item(sym.Result, ret_adt.did())) {
      return false;
    }
  }

  const ty = args.type_at(0);
  const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(cx.typing_env() as TypingEnv);
  const ocx = ObligationCtxt.new(infcx);

  const body_def_id = cx.tcx.hir_body_owner_def_id(body_id);
  const cause = ObligationCause.new(span, body_def_id, ObligationCauseCode.Misc);

  ocx.register_bound(
    cause,
    param_env,
    // Erase any region vids from the type, which may not be resolved
    infcx.tcx.erase_and_anonymize_regions(ty, fold_Ty),
    into_iterator_did,
  );

  return TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
}
