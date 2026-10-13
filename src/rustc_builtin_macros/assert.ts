// Port of compiler/rustc_builtin_macros/src/assert.rs
// mod context;
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, token } from "../rustc_ast/lib.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import type { PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { parser } from "../rustc_parse/lib.ts";
import { exp } from "../rustc_parse/parser/token_type.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, sym, Symbol } from "../rustc_span/symbol.ts";
import { Err, Ok } from "../std/result.ts";
import * as context from "./assert/context.ts";
import * as diagnostics from "./diagnostics.ts";
import { use_panic_2021 } from "./edition_panic.ts";

// rustc: compiler/rustc_builtin_macros/src/assert.rs:17 expand_assert
export function expand_assert(cx: ExtCtxt, span: Span, tts: TokenStream): MacroExpanderResult {
  const pr = parse_assert(cx, span, tts);
  if (pr.$ === "Err") {
    const guar = pr._0.emit_err();
    return { $: "Ready", _0: DummyResult.any(span, guar) };
  }
  const { cond_expr, custom_message } = pr._0;

  // `core::panic` and `std::panic` are different macros, so we use call-site
  // context to pick up whichever is currently in scope.
  const call_site_span = cx.with_call_site_ctxt(span);

  const panic_path = (): ast.Path => {
    if (use_panic_2021(span)) {
      // On edition 2021, we always call `$crate::panic::panic_2021!()`.
      return cx.path(call_site_span, cx.std_path([sym.panic, sym.panic_2021]));
    } else {
      // Before edition 2021, we call `panic!()` unqualified,
      // such that it calls either `std::panic!()` or `core::panic!()`.
      return ast.Path.from_ident(Ident.new(sym.panic, call_site_span));
    }
  };

  // Simply uses the user provided message instead of generating custom outputs
  let expr: ast.Expr;
  if (custom_message !== undefined) {
    const tokens = custom_message;
    const then = cx.expr_macro_call(call_site_span, cx.macro_call(call_site_span, panic_path(), token.Delimiter.Parenthesis, tokens));
    expr = expr_if_not(cx, call_site_span, cond_expr, then, undefined);
  }
  // If `generic_assert` is enabled, generates rich captured outputs
  //
  // FIXME(c410-f3r) See https://github.com/rust-lang/rust/issues/96949
  else if (cx.ecfg.features.generic_assert()) {
    expr = context.Context.new(cx, call_site_span).build(cond_expr, panic_path());
  }
  // If `generic_assert` is not enabled, only outputs a literal "assertion failed: ..."
  // string
  else {
    // Pass our own message directly to $crate::panicking::panic(),
    // because it might contain `{` and `}` that should always be
    // passed literally.
    const then = cx.expr_call_global(call_site_span, cx.std_path([sym.panicking, sym.panic]), [
      cx.expr_str(DUMMY_SP, Symbol.intern(`assertion failed: ${pprust.expr_to_string(cond_expr)}`)),
    ]);
    expr = expr_if_not(cx, call_site_span, cond_expr, then, undefined);
  }

  return { $: "Ready", _0: MacEager.expr(expr) };
}

interface Assert {
  cond_expr: ast.Expr;
  custom_message: TokenStream | undefined;
}

// if !{ ... } { ... } else { ... }
// rustc: compiler/rustc_builtin_macros/src/assert.rs:88 expr_if_not
function expr_if_not(cx: ExtCtxt, span: Span, cond: ast.Expr, then: ast.Expr, els: ast.Expr | undefined): ast.Expr {
  return cx.expr_if(span, cx.expr(span, { $: "Unary", _0: ast.UnOp.Not, _1: cond }), then, els);
}

// rustc: compiler/rustc_builtin_macros/src/assert.rs:98 parse_assert
function parse_assert(cx: ExtCtxt, sp: Span, stream: TokenStream): PResult<Assert> {
  const parser = cx.new_parser_from_tts(stream);

  if (parser.token.eq(token.TokenKind.Eof)) {
    return Err(cx.dcx().create_err(diagnostics.AssertRequiresBoolean_diagnostic({ span: sp })));
  }

  const cr = parser.parse_expr();
  if (cr.$ === "Err") return cr;
  const cond_expr = cr._0;

  // Some crates use the `assert!` macro in the following form (note extra semicolon):
  //
  // assert!(
  //     my_function();
  // );
  //
  // Emit an error about semicolon and suggest removing it.
  if (parser.token.eq(token.TokenKind.Semi)) {
    cx.dcx().emit_err(diagnostics.AssertRequiresExpression_diagnostic({ span: sp, token: parser.token.span }));
    parser.bump();
  }

  // Some crates use the `assert!` macro in the following form (note missing comma before
  // message):
  //
  // assert!(true "error message");
  //
  // Emit an error and suggest inserting a comma.
  let custom_message: TokenStream | undefined;
  const k = parser.token.kind;
  if (k.$ === "Literal" && k._0.kind.$ === "Str") {
    const comma = Span.shrink_to_hi(parser.prev_token.span);
    cx.dcx().emit_err(diagnostics.AssertMissingComma_diagnostic({ span: parser.token.span, comma }));

    custom_message = parse_custom_message(parser);
  } else if (parser.eat(exp.Comma)) {
    custom_message = parse_custom_message(parser);
  } else {
    custom_message = undefined;
  }

  if (!parser.token.eq(token.TokenKind.Eof)) {
    const r = parser.unexpected();
    if (r.$ === "Err") return r;
  }

  return Ok({ cond_expr, custom_message });
}

// rustc: compiler/rustc_builtin_macros/src/assert.rs:145 parse_custom_message
function parse_custom_message(parser: parser.Parser): TokenStream | undefined {
  const ts = parser.parse_tokens();
  return !ts.is_empty() ? ts : undefined;
}
