// Port of compiler/rustc_builtin_macros/src/view_type.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { type ast, token } from "../rustc_ast/lib.ts";
import type { PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { TokenType } from "../rustc_parse/parser/token_type.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Err, Ok } from "../std/result.ts";

// rustc: compiler/rustc_builtin_macros/src/view_type.rs:10 expand
export function expand(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_view_ty(cx, tts);
  if (r.$ === "Err") {
    return { $: "Ready", _0: DummyResult.any(sp, r._0.emit_err()) };
  }
  const [ty, pat] = r._0;

  return { $: "Ready", _0: MacEager.ty(cx.ty(sp, { $: "View", _0: ty, _1: pat })) };
}

// rustc: compiler/rustc_builtin_macros/src/view_type.rs:25 parse_view_ty
function parse_view_ty(cx: ExtCtxt, stream: TokenStream): PResult<[ast.Ty, Ident[]]> {
  const parser = cx.new_parser_from_tts(stream);

  const tr = parser.parse_ty();
  if (tr.$ === "Err") return tr;
  const ty = tr._0;

  const e = parser.expect({ tok: token.TokenKind.Dot, token_type: TokenType.Dot });
  if (e.$ === "Err") return e;

  let fields: Ident[];
  const r = parser.parse_delim_comma_seq(
    { tok: token.TokenKind.OpenBrace, token_type: TokenType.OpenBrace },
    { tok: token.TokenKind.CloseBrace, token_type: TokenType.CloseBrace },
    (p) => p.parse_field_name(),
  );
  if (r.$ === "Ok") {
    fields = r._0[0];
  } else {
    const diag = r._0;
    return Err(diag);
  }

  return Ok([ty, fields]);
}
