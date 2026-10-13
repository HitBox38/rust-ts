// Port of compiler/rustc_builtin_macros/src/compile_error.rs
// The compiler code necessary to support the compile_error! extension.

import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { DummyResult, type ExtCtxt, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { get_single_str_from_tts } from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/compile_error.rs:9 expand_compile_error
export function expand_compile_error(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_single_str_from_tts(cx, sp, tts, "compile_error!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const var_ = mac._0;

  const guar = cx.dcx().span_err(sp, Symbol.as_str(var_));
  cx.resolver.mark_scope_with_compile_error(cx.current_expansion.lint_node_id);

  return { $: "Ready", _0: DummyResult.any(sp, guar) };
}
