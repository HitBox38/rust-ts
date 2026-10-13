// Port of compiler/rustc_builtin_macros/src/gca.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast } from "../rustc_ast/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { get_single_expr_from_tts } from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/gca.rs:8 expand
export function expand(cx: ExtCtxt, span: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_single_expr_from_tts(cx, span, tts, "gca!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const er = r._0;
  if (er.$ === "Err") return { $: "Ready", _0: DummyResult.any(span, er._0) };
  const expr = er._0;

  // `base::MacEager { expr: Some(..), ty: Some(..), ..Default::default() }`
  return {
    $: "Ready",
    _0: new MacEager(cx.expr(span, { $: "GcaMacro", _0: ast.clone_Expr(expr) }), undefined, cx.ty(span, { $: "GcaMacro", _0: expr })),
  };
}
