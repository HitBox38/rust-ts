// Port of compiler/rustc_builtin_macros/src/pattern_type.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, token } from "../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../rustc_ast/node_id.ts";
import type { PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { exp } from "../rustc_parse/parser/token_type.ts";
import { CommaRecoveryMode, RecoverColon, RecoverComma } from "../rustc_parse/parser/pat.gen.ts";
import { Span } from "../rustc_span/lib.ts";
import { Ok } from "../std/result.ts";

// rustc: compiler/rustc_builtin_macros/src/pattern_type.rs:9 expand
export function expand(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_pat_ty(cx, tts);
  if (r.$ === "Err") {
    return { $: "Ready", _0: DummyResult.any(sp, r._0.emit_err()) };
  }
  const [ty, pat] = r._0;

  return { $: "Ready", _0: MacEager.ty(cx.ty(sp, { $: "Pat", _0: ty, _1: pat })) };
}

// rustc: compiler/rustc_builtin_macros/src/pattern_type.rs:24 parse_pat_ty
function parse_pat_ty(cx: ExtCtxt, stream: TokenStream): PResult<[ast.Ty, ast.TyPat]> {
  const parser = cx.new_parser_from_tts(stream);

  const tr = parser.parse_ty();
  if (tr.$ === "Err") return tr;
  const ty = tr._0;
  const k = parser.expect_keyword(exp.Is);
  if (k.$ === "Err") return k;

  const start = parser.token.span;
  let pat: ast.TyPat;
  if (parser.eat(exp.Bang)) {
    const k2 = parser.expect_keyword(exp.Null);
    if (k2.$ === "Err") return k2;
    pat = ty_pat(ast.TyPatKind.NotNull, Span.to(start, parser.token.span));
  } else {
    const pr = parser.parse_pat_no_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.EitherTupleOrPipe);
    if (pr.$ === "Err") return pr;
    pat = pat_to_ty_pat(cx, pr._0);
  }

  if (!parser.token.eq(token.TokenKind.Eof)) {
    const u = parser.unexpected();
    if (u.$ === "Err") return u;
  }

  return Ok([ty, pat]);
}

// rustc: compiler/rustc_builtin_macros/src/pattern_type.rs:56 ty_pat
function ty_pat(kind: ast.TyPatKind, span: Span): ast.TyPat {
  return { id: DUMMY_NODE_ID, kind, span };
}

// rustc: compiler/rustc_builtin_macros/src/pattern_type.rs:60 pat_to_ty_pat
function pat_to_ty_pat(cx: ExtCtxt, pat: ast.Pat): ast.TyPat {
  let kind: ast.TyPatKind;
  const pk = pat.kind;
  switch (pk.$) {
    case "Range": {
      const [start, end, include_end] = [pk._0, pk._1, pk._2];
      kind = {
        $: "Range",
        _0: start === undefined ? undefined : { id: DUMMY_NODE_ID, value: start },
        _1: end === undefined ? undefined : { id: DUMMY_NODE_ID, value: end },
        _2: include_end,
      };
      break;
    }
    case "Or": {
      const variants = pk._0;
      kind = { $: "Or", _0: variants.map((pat) => pat_to_ty_pat(cx, pat)) };
      break;
    }
    case "Err":
      kind = { $: "Err", _0: pk._0 };
      break;
    case "Paren":
      kind = pat_to_ty_pat(cx, pk._0).kind;
      break;
    default:
      kind = { $: "Err", _0: cx.dcx().span_err(pat.span, "pattern not supported in pattern types") };
  }
  return ty_pat(kind, pat.span);
}
