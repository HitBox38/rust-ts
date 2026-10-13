// Port of compiler/rustc_builtin_macros/src/util.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, attr, token } from "../rustc_ast/lib.ts";
import type { Attribute, MetaItem } from "../rustc_ast/lib.ts";
import { AttributeTemplate, validate_attr } from "../rustc_attr_parsing/lib.ts";
import type { Diag, ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { Applicability } from "../rustc_lint_defs/lib.ts";
import { DUPLICATE_MACRO_ATTRIBUTES } from "../rustc_lint_defs/builtin.ts";
import { type Annotatable, ExpandResult, type ExtCtxt } from "../rustc_expand/base.ts";
import { AstFragment } from "../rustc_expand/expand.ts";
import type { parser } from "../rustc_parse/lib.ts";
import { exp } from "../rustc_parse/parser/token_type.ts";
import { report_lit_error } from "../rustc_session/diagnostics.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/util.rs:14 check_builtin_macro_attribute
export function check_builtin_macro_attribute(ecx: ExtCtxt, meta_item: MetaItem, name: Symbol): void {
  // All the built-in macro attributes are "words" at the moment.
  // `AttributeTemplate { word: true, ..Default::default() }`
  const template = new AttributeTemplate(true, undefined, [], undefined, undefined);
  validate_attr.check_builtin_meta_item(ecx.sess.psess, meta_item, ast.AttrStyle.Outer, name, template, true);
}

/// Emit a warning if the item is annotated with the given attribute. This is used to diagnose when
/// an attribute may have been mistakenly duplicated.
// rustc: compiler/rustc_builtin_macros/src/util.rs:29 warn_on_duplicate_attribute
export function warn_on_duplicate_attribute(ecx: ExtCtxt, item: Annotatable, name: Symbol): void {
  let attrs: readonly Attribute[] | undefined;
  switch (item.$) {
    case "Item":
      attrs = item._0.attrs;
      break;
    case "AssocItem":
      attrs = item._0.attrs;
      break;
    case "ForeignItem":
      attrs = item._0.attrs;
      break;
    case "Expr":
      attrs = item._0.attrs;
      break;
    case "Arm":
      attrs = item._0.attrs;
      break;
    case "ExprField":
      attrs = item._0.attrs;
      break;
    case "PatField":
      attrs = item._0.attrs;
      break;
    case "GenericParam":
      attrs = item._0.attrs;
      break;
    case "Param":
      attrs = item._0.attrs;
      break;
    case "FieldDef":
      attrs = item._0.attrs;
      break;
    case "Variant":
      attrs = item._0.attrs;
      break;
    default:
      attrs = undefined;
  }
  if (attrs !== undefined) {
    const attr_ = attr.find_by_name(attrs, name);
    if (attr_ !== undefined) {
      ecx.psess().buffer_lint(
        DUPLICATE_MACRO_ATTRIBUTES,
        attr_.span,
        ecx.current_expansion.lint_node_id,
        diagnostics.DuplicateMacroAttribute_diagnostic({}),
      );
    }
  }
}

/// `Ok` represents successfully retrieving the string literal at the correct
/// position, e.g., `println("abc")`.
export type ExprToSpannedStringResult = Result<ExprToSpannedString, UnexpectedExprKind>;

export interface ExprToSpannedString {
  symbol: Symbol;
  style: ast.StrStyle;
  span: Span;
  /// The raw string literal, with no escaping or processing.
  ///
  /// Generally only useful for lints that care about the raw bytes the user wrote.
  uncooked_symbol: [token.LitKind, Symbol];
}

/// - `Ok` is returned when the conversion to a string literal is unsuccessful,
/// but another type of expression is obtained instead.
/// - `Err` is returned when the conversion process fails.
type UnexpectedExprKind = Result<[Diag, boolean /* has_suggestions */], ErrorGuaranteed>;

/// Extracts a string literal from the macro expanded version of `expr`,
/// returning a diagnostic error of `err_msg` if `expr` is not a string literal.
/// The returned bool indicates whether an applicable suggestion has already been
/// added to the diagnostic to avoid emitting multiple suggestions. `Err(Err(ErrorGuaranteed))`
/// indicates that an ast error was encountered.
// rustc: compiler/rustc_builtin_macros/src/util.rs:80 expr_to_spanned_string
export function expr_to_spanned_string(
  cx: ExtCtxt,
  expr_: ast.Expr,
  err_msg: string,
): ExpandResult<ExprToSpannedStringResult, null> {
  if (!cx.force_mode) {
    const k = expr_.kind;
    if (k.$ === "MacCall" && cx.resolver.macro_accessible(cx.current_expansion.id, k._0.path).$ === "Err") {
      return { $: "Retry", _0: null };
    }
  }

  // Perform eager expansion on the expression.
  // We want to be able to handle e.g., `concat!("foo", "bar")`.
  const expr = AstFragment.make_expr(cx.expander().fully_expand_fragment({ $: "Expr", _0: expr_ }));

  let r: UnexpectedExprKind;
  const kind = expr.kind;
  switch (kind.$) {
    case "Lit": {
      const token_lit = kind._0;
      const lk = ast.LitKind.from_token_lit(token_lit);
      if (lk.$ === "Ok" && lk._0.$ === "Str") {
        const [s, style] = [lk._0._0, lk._0._1];
        return {
          $: "Ready",
          _0: Ok({
            symbol: s,
            style,
            span: expr.span,
            uncooked_symbol: [token_lit.kind, token_lit.symbol],
          }),
        };
      } else if (lk.$ === "Ok" && lk._0.$ === "ByteStr") {
        const err = cx.dcx().struct_span_err(expr.span, err_msg);
        const span = Span.shrink_to_lo(expr.span);
        err.span_suggestion_short(
          Span.with_hi(span, BytePos.add(Span.lo(span), BytePos(1))),
          "consider removing the leading `b`",
          "",
          Applicability.MaybeIncorrect,
        );
        r = Ok([err, true]);
      } else if (lk.$ === "Ok" && lk._0.$ === "Err") {
        r = Err(lk._0._0);
      } else if (lk.$ === "Err") {
        r = Err(report_lit_error(cx.sess.psess, lk._0, token_lit, expr.span));
      } else {
        r = Ok([cx.dcx().struct_span_err(expr.span, err_msg), false]);
      }
      break;
    }
    case "Err":
      r = Err(kind._0);
      break;
    case "Dummy":
      return cx.dcx().span_bug(expr.span, "tried to get a string literal from `ExprKind::Dummy`");
    default:
      r = Ok([cx.dcx().struct_span_err(expr.span, err_msg), false]);
  }
  return { $: "Ready", _0: Err(r) };
}

/// Extracts a string literal from the macro expanded version of `expr`,
/// emitting `err_msg` if `expr` is not a string literal. This does not stop
/// compilation on error, merely emits a non-fatal error and returns `Err`.
// rustc: compiler/rustc_builtin_macros/src/util.rs:132 expr_to_string
export function expr_to_string(
  cx: ExtCtxt,
  expr: ast.Expr,
  err_msg: string,
): ExpandResult<Result<[Symbol, ast.StrStyle], ErrorGuaranteed>, null> {
  return ExpandResult.map(expr_to_spanned_string(cx, expr, err_msg), (res): Result<[Symbol, ast.StrStyle], ErrorGuaranteed> => {
    if (res.$ === "Err") {
      const err = res._0;
      return Err(err.$ === "Ok" ? err._0[0].emit_err() : err._0);
    }
    const { symbol, style } = res._0;
    return Ok([symbol, style]);
  });
}

/// Non-fatally assert that `tts` is empty. Note that this function
/// returns even when `tts` is non-empty, macros that *need* to stop
/// compilation should call `cx.diagnostic().abort_if_errors()`
/// (this should be done as rarely as possible).
// rustc: compiler/rustc_builtin_macros/src/util.rs:150 check_zero_tts
export function check_zero_tts(cx: ExtCtxt, span: Span, tts: TokenStream, name: string): void {
  if (!tts.is_empty()) {
    cx.dcx().emit_err(diagnostics.TakesNoArguments_diagnostic({ span, name }));
  }
}

/// Parse an expression. On error, emit it, advancing to `Eof`, and return `Err`.
// rustc: compiler/rustc_builtin_macros/src/util.rs:157 parse_expr
export function parse_expr(p: parser.Parser): Result<ast.Expr, ErrorGuaranteed> {
  const r = p.parse_expr();
  if (r.$ === "Ok") return Ok(r._0);
  const guar = r._0.emit_err();
  while (!p.token.eq(token.TokenKind.Eof)) {
    p.bump();
  }
  return Err(guar);
}

/// Interpreting `tts` as a comma-separated sequence of expressions,
/// expect exactly one string literal, or emit an error and return `Err`.
// rustc: compiler/rustc_builtin_macros/src/util.rs:170 get_single_str_from_tts
export function get_single_str_from_tts(
  cx: ExtCtxt,
  span: Span,
  tts: TokenStream,
  name: string,
): ExpandResult<Result<Symbol, ErrorGuaranteed>, null> {
  return ExpandResult.map(get_single_str_spanned_from_tts(cx, span, tts, name), (res): Result<Symbol, ErrorGuaranteed> =>
    res.$ === "Ok" ? Ok(res._0[0]) : res,
  );
}

// rustc: compiler/rustc_builtin_macros/src/util.rs:179 get_single_str_spanned_from_tts
export function get_single_str_spanned_from_tts(
  cx: ExtCtxt,
  span: Span,
  tts: TokenStream,
  name: string,
): ExpandResult<Result<[Symbol, Span], ErrorGuaranteed>, null> {
  const r = get_single_expr_from_tts(cx, span, tts, name);
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const ret_ = r._0;
  if (ret_.$ === "Err") return { $: "Ready", _0: Err(ret_._0) };
  const ret = ret_._0;
  return ExpandResult.map(
    expr_to_spanned_string(cx, ret, "argument must be a string literal"),
    (res): Result<[Symbol, Span], ErrorGuaranteed> => {
      if (res.$ === "Err") {
        const err = res._0;
        return Err(err.$ === "Ok" ? err._0[0].emit_err() : err._0);
      }
      const { symbol, span } = res._0;
      return Ok([symbol, span]);
    },
  );
}

/// Interpreting `tts` as a comma-separated sequence of expressions,
/// expect exactly one expression, or emit an error and return `Err`.
// rustc: compiler/rustc_builtin_macros/src/util.rs:203 get_single_expr_from_tts
export function get_single_expr_from_tts(
  cx: ExtCtxt,
  span: Span,
  tts: TokenStream,
  name: string,
): ExpandResult<Result<ast.Expr, ErrorGuaranteed>, null> {
  const p = cx.new_parser_from_tts(tts);
  if (p.token.eq(token.TokenKind.Eof)) {
    const guar = cx.dcx().emit_err(diagnostics.OnlyOneArgument_diagnostic({ span, name }));
    return { $: "Ready", _0: Err(guar) };
  }
  const r = parse_expr(p);
  if (r.$ === "Err") return { $: "Ready", _0: Err(r._0) };
  const ret = r._0;
  p.eat(exp.Comma);

  if (!p.token.eq(token.TokenKind.Eof)) {
    cx.dcx().emit_err(diagnostics.OnlyOneArgument_diagnostic({ span, name }));
  }
  return { $: "Ready", _0: Ok(ret) };
}

/// Extracts comma-separated expressions from `tts`.
/// On error, emit it, and return `Err`.
// rustc: compiler/rustc_builtin_macros/src/util.rs:228 get_exprs_from_tts
export function get_exprs_from_tts(cx: ExtCtxt, tts: TokenStream): ExpandResult<Result<ast.Expr[], ErrorGuaranteed>, null> {
  const p = cx.new_parser_from_tts(tts);
  const es: ast.Expr[] = [];
  while (!p.token.eq(token.TokenKind.Eof)) {
    const r = parse_expr(p);
    if (r.$ === "Err") return { $: "Ready", _0: Err(r._0) };
    const expr_ = r._0;
    if (!cx.force_mode) {
      const k = expr_.kind;
      if (k.$ === "MacCall" && cx.resolver.macro_accessible(cx.current_expansion.id, k._0.path).$ === "Err") {
        return { $: "Retry", _0: null };
      }
    }

    // Perform eager expansion on the expression.
    // We want to be able to handle e.g., `concat!("foo", "bar")`.
    const expr = AstFragment.make_expr(cx.expander().fully_expand_fragment({ $: "Expr", _0: expr_ }));

    es.push(expr);
    if (p.eat(exp.Comma)) {
      continue;
    }
    if (!p.token.eq(token.TokenKind.Eof)) {
      const guar = cx.dcx().emit_err(diagnostics.ExpectedCommaInList_diagnostic({ span: p.token.span }));
      return { $: "Ready", _0: Err(guar) };
    }
  }
  return { $: "Ready", _0: Ok(es) };
}
