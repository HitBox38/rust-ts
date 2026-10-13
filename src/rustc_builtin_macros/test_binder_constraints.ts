// Port of compiler/rustc_builtin_macros/src/test_binder_constraints.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { token } from "../rustc_ast/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/test_binder_constraints.rs:9 expand
export function expand(cx: ExtCtxt, span: Span, tts: TokenStream): MacroExpanderResult {
  const name = "test_binder_constraints!";
  const p = cx.new_parser_from_tts(tts);
  if (p.token.eq(token.TokenKind.Eof)) {
    cx.dcx().emit_err(diagnostics.OnlyOneArgument_diagnostic({ span, name }));
  }
  const r = p.parse_test_binder_constraints();
  if (r.$ === "Err") {
    const guar = r._0.emit_err();
    return { $: "Ready", _0: DummyResult.any(span, guar) };
  }
  const item_ = r._0;
  if (!p.token.eq(token.TokenKind.Eof)) {
    cx.dcx().emit_err(diagnostics.OnlyOneArgument_diagnostic({ span: p.token.span, name }));
  }
  const item = cx.item(span, [], { $: "TestBinderConstraints", _0: item_ });
  return { $: "Ready", _0: new MacEager(undefined, [item], undefined) };
}
