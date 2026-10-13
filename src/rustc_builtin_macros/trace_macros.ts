// Port of compiler/rustc_builtin_macros/src/trace_macros.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { DummyResult, type ExtCtxt, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/trace_macros.rs:7 expand_trace_macros
export function expand_trace_macros(cx: ExtCtxt, sp: Span, tt: TokenStream): MacroExpanderResult {
  const iter = tt.iter();
  let err = false;
  let value: boolean;
  const first = iter.next();
  if (first !== undefined && first.$ === "Token" && first._0.is_keyword(kw.True)) {
    value = true;
  } else if (first !== undefined && first.$ === "Token" && first._0.is_keyword(kw.False)) {
    value = false;
  } else {
    err = true;
    value = false;
  }
  err ||= iter.next() !== undefined;
  if (err) {
    cx.dcx().emit_err(diagnostics.TraceMacros_diagnostic({ span: sp }));
  } else {
    cx.set_trace_macros(value);
  }

  return { $: "Ready", _0: DummyResult.any_valid(sp) };
}
