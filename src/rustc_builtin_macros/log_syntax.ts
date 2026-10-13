// Port of compiler/rustc_builtin_macros/src/log_syntax.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import { DummyResult, type ExtCtxt, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { std_print } from "../rustc_session/config.ts";
import type { Span } from "../rustc_span/lib.ts";

// rustc: compiler/rustc_builtin_macros/src/log_syntax.rs:5 expand_log_syntax
export function expand_log_syntax(_cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  // `println!("{}", ..)`
  std_print(`${pprust.tts_to_string(tts)}\n`);

  // any so that `log_syntax` can be invoked as an expression and item.
  return { $: "Ready", _0: DummyResult.any_valid(sp) };
}
