// Port of compiler/rustc_lint/src/non_fmt_panic.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (non_fmt_panic.lints.gen.ts).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()` and `LateContext::typing_env` returns `unknown` until
// context.rs's `LateContext` is ported: their results are cast here.
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { bool_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, IntoDiagArg, type Level, msg } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { Ty_into_diag_arg } from "../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { type ParseMode, Parser, type Piece } from "../rustc_parse_format/lib.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { InnerSpan, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { Str, str_find_pred, str_rfind_pred } from "../std/str.ts";
import type { LateContext } from "./context.ts";
import { NonFmtPanicUnused_diagnostic } from "./diagnostics.ts";
import { NonFmtPanicBraces_diagnostic } from "./diagnostics.gen.ts";
import { NON_FMT_PANICS, NonPanicFmt } from "./non_fmt_panic.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./non_fmt_panic.lints.gen.ts";

declare module "./non_fmt_panic.lints.gen.ts" {
  interface NonPanicFmt extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for NonPanicFmt
// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:50 check_expr
NonPanicFmt.prototype.check_expr = function (this: NonPanicFmt, cx: LateContext, expr: hir.Expr): void {
  let fk;
  if (
    expr.kind.$ === "Call" &&
    expr.kind._1.length === 1 &&
    (fk = (cx.typeck_results_() as TypeckResults).expr_ty(expr.kind._0).kind()).$ === "FnDef"
  ) {
    const f = expr.kind._0;
    const arg = expr.kind._1[0]!;
    const def_id = fk._0;
    const f_diagnostic_name = cx.tcx.get_diagnostic_name(def_id);

    if (
      cx.tcx.is_lang_item(def_id, LangItem.BeginPanic) ||
      cx.tcx.is_lang_item(def_id, LangItem.Panic) ||
      f_diagnostic_name === sym.panic_str_2015
    ) {
      const id = SyntaxContext.outer_expn_data(Span.ctxt(f.span)).macro_def_id;
      if (id !== undefined) {
        const name = cx.tcx.get_diagnostic_name(id);
        if (name === sym.core_panic_2015_macro || name === sym.std_panic_2015_macro) {
          check_panic(cx, f, arg);
        }
      }
    } else if (f_diagnostic_name === sym.unreachable_display) {
      const id = SyntaxContext.outer_expn_data(Span.ctxt(f.span)).macro_def_id;
      if (id !== undefined && cx.tcx.is_diagnostic_item(sym.unreachable_2015_macro, id)) {
        check_panic(
          cx,
          f,
          // This is safe because we checked above that the callee is indeed
          // unreachable_display
          // Get the borrowed arg not the borrow
          arg.kind.$ === "AddrOf" && arg.kind._0 === "Ref" ? arg.kind._2 : bug("call to unreachable_display without borrow"),
        );
      }
    }
  }
};

// struct PanicMessageNotLiteral<'a, 'tcx>
class PanicMessageNotLiteral {
  constructor(
    public arg_span: Span,
    public symbol: Symbol,
    public span: Span,
    public arg_macro: DefId | undefined,
    public cx: LateContext,
    public arg: hir.Expr,
    public panic: Symbol | undefined,
  ) {}

  // impl<'a, 'b, 'tcx> Diagnostic<'a> for PanicMessageNotLiteral<'b, 'tcx>
  // rustc: compiler/rustc_lint/src/non_fmt_panic.rs:100 into_diag
  into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
    const { arg_span, symbol, span, arg_macro, cx, arg, panic } = this;
    const lint = Diag.new(dcx, level, "panic message is not a string literal")
      .with_arg("name", IntoDiagArg.of(symbol, Symbol_into_diag_arg))
      .with_note(msg("this usage of `{$name}!()` is deprecated; it will be a hard error in Rust 2021"))
      .with_note("for more information, see <https://doc.rust-lang.org/edition-guide/rust-2021/panic-macro-consistency.html>");
    if (!is_arg_inside_call(arg_span, span)) {
      // No clue where this argument is coming from.
      return lint;
    }
    if (arg_macro !== undefined && cx.tcx.is_diagnostic_item(sym.format_macro, arg_macro)) {
      // A case of `panic!(format!(..))`.
      lint.note(msg("the `{$name}!()` macro supports formatting, so there's no need for the `format!()` macro here"));
      const d = find_delimiters(cx, arg_span);
      if (d !== undefined) {
        const [open, close] = d;
        lint.multipart_suggestion(
          msg("remove the `format!(..)` macro call"),
          [
            [Span.until(arg_span, Span.shrink_to_hi(open)), ""],
            [Span.until(close, Span.shrink_to_hi(arg_span)), ""],
          ],
          "MachineApplicable",
        );
      }
    } else {
      const ty = (cx.typeck_results_() as TypeckResults).expr_ty(arg);
      // If this is a &str or String, we can confidently give the `"{}", ` suggestion.
      const tk = ty.kind();
      const ty_def = ty.ty_adt_def();
      const is_str =
        (tk.$ === "Ref" && tk._1.is_str()) || (ty_def !== undefined && cx.tcx.is_lang_item(ty_def.did(), LangItem.String));

      const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(cx.typing_env() as TypingEnv);
      let t: DefId | undefined;
      const suggest_display =
        is_str ||
        ((t = cx.tcx.get_diagnostic_item(sym.Display)) !== undefined &&
          EvaluationResult.may_apply(infcx.type_implements_trait(t, [GenericArg.from_Ty(ty)], param_env)));
      const suggest_debug =
        !suggest_display &&
        (t = cx.tcx.get_diagnostic_item(sym.Debug)) !== undefined &&
        EvaluationResult.may_apply(infcx.type_implements_trait(t, [GenericArg.from_Ty(ty)], param_env));

      let suggest_panic_any = false;
      if (!is_str && panic === sym.std_panic_macro) {
        for (const name of cx.tcx.all_diagnostic_items(null).name_to_id.keys()) {
          if (Symbol.as_str(name) === "panic_any") {
            suggest_panic_any = true;
            break;
          }
        }
      }

      const fmt_applicability = suggest_panic_any
        ? // If we can use panic_any, use that as the MachineApplicable suggestion.
          "MaybeIncorrect"
        : // If we don't suggest panic_any, using a format string is our best bet.
          "MachineApplicable";

      if (suggest_display) {
        lint.span_suggestion_verbose(
          Span.shrink_to_lo(arg_span),
          msg(`add a "{"{"}{"}"}" format string to \`Display\` the message`),
          '"{}", ',
          fmt_applicability,
        );
      } else if (suggest_debug) {
        lint.arg("ty", IntoDiagArg.of(ty, Ty_into_diag_arg));
        lint.span_suggestion_verbose(
          Span.shrink_to_lo(arg_span),
          msg(`add a "{"{"}:?{"}"}" format string to use the \`Debug\` implementation of \`{$ty}\``),
          '"{:?}", ',
          fmt_applicability,
        );
      }

      if (suggest_panic_any) {
        const d = find_delimiters(cx, span);
        if (d !== undefined) {
          const [open, close, del] = d;
          lint.arg("already_suggested", IntoDiagArg.of(suggest_display || suggest_debug, bool_into_diag_arg));
          lint.multipart_suggestion(
            msg(
              `{$already_suggested ->
                                [true] or use
                                *[false] use
                            } std::panic::panic_any instead`,
            ),
            del === 0x28 /* '(' */
              ? [[Span.until(span, open), "std::panic::panic_any"]]
              : [
                  [Span.until(span, Span.shrink_to_hi(open)), "std::panic::panic_any("],
                  [close, ")"],
                ],
            "MachineApplicable",
          );
        }
      }
    }
    return lint;
  }
}

/** `PanicMessageNotLiteral` as a `Diagnostic` trait object. */
function PanicMessageNotLiteral_diagnostic(self: PanicMessageNotLiteral): Diagnostic {
  return { into_diag: (dcx, level) => self.into_diag(dcx, level) };
}

// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:207 check_panic
function check_panic(cx: LateContext, f: hir.Expr, arg: hir.Expr): void {
  if (arg.kind.$ === "Lit") {
    const lit = arg.kind._0;
    if (lit.node.$ === "Str") {
      // The argument is a string literal.
      check_panic_str(cx, f, arg, Symbol.as_str(lit.node._0));
      return;
    }
  }

  // The argument is *not* a string literal.

  const [span, panic, symbol] = panic_call(cx, f);

  if (Span.in_external_macro(span, cx.sess().source_map())) {
    // Nothing that can be done about it in the current crate.
    return;
  }

  // Find the span of the argument to `panic!()` or `unreachable!`, before expansion in the
  // case of `panic!(some_macro!())` or `unreachable!(some_macro!())`.
  // We don't use source_callsite(), because this `panic!(..)` might itself
  // be expanded from another macro, in which case we want to stop at that
  // expansion.
  let arg_span = arg.span;
  let arg_macro: DefId | undefined = undefined;
  while (!Span.contains(span, arg_span)) {
    const ctxt = Span.ctxt(arg_span);
    if (SyntaxContext.is_root(ctxt)) {
      break;
    }
    const expn = SyntaxContext.outer_expn_data(ctxt);
    arg_macro = expn.macro_def_id;
    arg_span = expn.call_site;
  }

  cx.emit_span_lint(
    NON_FMT_PANICS,
    arg_span,
    PanicMessageNotLiteral_diagnostic(new PanicMessageNotLiteral(arg_span, symbol, span, arg_macro, cx, arg, panic)),
  );
}

// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:249 check_panic_str
function check_panic_str(cx: LateContext, f: hir.Expr, arg: hir.Expr, fmt: string): void {
  if (!(fmt.includes("{") || fmt.includes("}"))) {
    // No brace, no problem.
    return;
  }

  const [span] = panic_call(cx, f);

  const sm = cx.sess().source_map();
  if (Span.in_external_macro(span, sm) && Span.in_external_macro(arg.span, sm)) {
    // Nothing that can be done about it in the current crate.
    return;
  }

  const fmt_span = Span.source_callsite(arg.span);

  let snippet: Str | undefined;
  let style: number | undefined;
  const r = sm.span_to_snippet(fmt_span);
  if (r.$ === "Ok") {
    // Count the number of `#`s between the `r` and `"`.
    snippet = r._0;
    style = r._0.starts_with("r") ? r._0.slice(1).find('"') : undefined;
  } else {
    [snippet, style] = [undefined, undefined];
  }

  const fmt_parser = Parser.new(Str.from(fmt), style, snippet, false, "Format" satisfies ParseMode);
  let n_arguments = 0;
  for (let a: Piece | undefined = fmt_parser.next(); a !== undefined; a = fmt_parser.next()) {
    if (a.$ === "NextArgument") n_arguments++;
  }

  if (n_arguments > 0 && fmt_parser.errors.length === 0) {
    const arg_spans: Span[] =
      fmt_parser.arg_places.length === 0
        ? [fmt_span]
        : fmt_parser.arg_places.map((span) => Span.from_inner(fmt_span, InnerSpan.new(span.start, span.end)));
    cx.emit_span_lint(
      NON_FMT_PANICS,
      arg_spans,
      NonFmtPanicUnused_diagnostic({
        count: n_arguments,
        suggestion: is_arg_inside_call(arg.span, span) ? arg.span : undefined,
      }),
    );
  } else {
    let brace_spans: Span[] | undefined;
    if (snippet !== undefined && (snippet.starts_with('"') || snippet.starts_with("r#"))) {
      const s = snippet;
      brace_spans = [];
      const chars = s.chars();
      for (let pos = chars.pos, c = chars.next(); c !== undefined; pos = chars.pos, c = chars.next()) {
        if (c === 0x7b /* '{' */ || c === 0x7d /* '}' */) {
          const i = pos - s.lo;
          brace_spans.push(Span.from_inner(fmt_span, new InnerSpan(i, i + 1)));
        }
      }
    }
    const count = brace_spans !== undefined ? brace_spans.length : /* any number >1 */ 2;
    cx.emit_span_lint(
      NON_FMT_PANICS,
      brace_spans ?? [span],
      NonFmtPanicBraces_diagnostic({
        count,
        suggestion: is_arg_inside_call(arg.span, span) ? Span.shrink_to_lo(arg.span) : undefined,
      }),
    );
  }
}

/// Given the span of `some_macro!(args);`, gives the span of `(` and `)`,
/// and the type of (opening) delimiter used.
// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:320 find_delimiters
function find_delimiters(cx: LateContext, span: Span): [Span, Span, number] | undefined {
  const r = cx.sess().source_map().span_to_snippet(span);
  if (r.$ !== "Ok") return undefined;
  const snippet = r._0;
  const is_open = (c: number): boolean => c === 0x28 /* '(' */ || c === 0x5b /* '[' */ || c === 0x7b; /* '{' */
  const open = str_find_pred(snippet, is_open);
  if (open === undefined) return undefined;
  const open_ch = snippet.slice(open).chars().next()!;
  const close_r = str_rfind_pred(snippet, (c) => c === 0x29 /* ')' */ || c === 0x5d /* ']' */ || c === 0x7d /* '}' */);
  if (close_r === undefined) return undefined;
  const close = close_r[0];
  return [Span.from_inner(span, new InnerSpan(open, open + 1)), Span.from_inner(span, new InnerSpan(close, close + 1)), open_ch];
}

// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:331 panic_call
function panic_call(cx: LateContext, f: hir.Expr): [Span, Symbol | undefined, Symbol] {
  let expn = SyntaxContext.outer_expn_data(Span.ctxt(f.span));

  let panic_macro: Symbol | undefined = undefined;

  // Unwrap more levels of macro expansion, as panic_2015!()
  // was likely expanded from panic!() and possibly from
  // [debug_]assert!().
  for (;;) {
    const parent = SyntaxContext.outer_expn_data(Span.ctxt(expn.call_site));
    const id = parent.macro_def_id;
    if (id === undefined) break;
    const name = cx.tcx.get_diagnostic_name(id);
    if (name === undefined) break;
    if (
      !(
        name === sym.core_panic_macro ||
        name === sym.std_panic_macro ||
        name === sym.assert_macro ||
        name === sym.debug_assert_macro ||
        name === sym.unreachable_macro
      )
    ) {
      break;
    }
    expn = parent;
    panic_macro = name;
  }

  const macro_symbol = expn.kind.$ === "Macro" ? expn.kind._1 : sym.panic;
  return [expn.call_site, panic_macro, macro_symbol];
}

// rustc: compiler/rustc_lint/src/non_fmt_panic.rs:365 is_arg_inside_call
function is_arg_inside_call(arg: Span, call: Span): boolean {
  // We only add suggestions if the argument we're looking at appears inside the
  // panic call in the source file, to avoid invalid suggestions when macros are involved.
  // We specifically check for the spans to not be identical, as that happens sometimes when
  // proc_macros lie about spans and apply the same span to all the tokens they produce.
  const [a_lo, a_hi] = Span.lo_hi(arg);
  const [c_lo, c_hi] = Span.lo_hi(call);
  return Span.contains(call, arg) && !(c_lo === a_lo && c_hi === a_hi);
}
