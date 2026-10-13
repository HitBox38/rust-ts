// Port of compiler/rustc_builtin_macros/src/iter.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { type ast, token } from "../rustc_ast/lib.ts";
import { CoroutineMarker } from "../rustc_ast/lib.ts";
import type { PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { panic } from "../std/panic.ts";
import { Err, Ok } from "../std/result.ts";

// rustc: compiler/rustc_builtin_macros/src/iter.rs:7 expand
export function expand(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_closure(cx, sp, tts);
  if (r.$ === "Err") {
    return { $: "Ready", _0: DummyResult.any(sp, r._0.emit_err()) };
  }
  const closure = r._0;

  return { $: "Ready", _0: MacEager.expr(closure) };
}

// rustc: compiler/rustc_builtin_macros/src/iter.rs:22 parse_closure
function parse_closure(cx: ExtCtxt, span: Span, stream: TokenStream): PResult<ast.Expr> {
  const closure_parser = cx.new_parser_from_tts(stream);

  const coroutine_marker = CoroutineMarker.new("Gen", span);

  const r = closure_parser.parse_expr();
  if (r.$ === "Err") return r;
  const closure = r._0;
  const kind = closure.kind;
  if (kind.$ === "Closure") {
    const c = kind._0;
    if (c.coroutine_marker !== undefined) {
      const marker = c.coroutine_marker;
      cx.dcx().span_err(marker.span, "only plain closures allowed in `iter!`");
    }
    c.coroutine_marker = coroutine_marker;
    if (!closure_parser.token.eq(token.TokenKind.Eof)) {
      const u = closure_parser.unexpected();
      if (u.$ === "Err") return u;
    }
    return Ok(closure);
  } else {
    cx.dcx().span_err(closure.span, "`iter!` body must be a closure");
    const u = closure_parser.unexpected();
    // `.unwrap_err()`
    if (u.$ === "Ok") return panic_unwrap_err();
    return Err(u._0);
  }
}

function panic_unwrap_err(): never {
  return panic("called `Result::unwrap_err()` on an `Ok` value: ()");
}
