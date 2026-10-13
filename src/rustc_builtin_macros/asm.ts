// STUB for compiler/rustc_builtin_macros/src/asm.rs (owned by lane bm-rest; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-rest lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import type { ExtCtxt, MacroExpanderResult } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";

export function expand_asm(_cx: ExtCtxt, _sp: Span, _tts: TokenStream): MacroExpanderResult {
  return unported("rustc_builtin_macros::asm::expand_asm (stub)");
}

export function expand_global_asm(_cx: ExtCtxt, _sp: Span, _tts: TokenStream): MacroExpanderResult {
  return unported("rustc_builtin_macros::asm::expand_global_asm (stub)");
}

export function expand_naked_asm(_cx: ExtCtxt, _sp: Span, _tts: TokenStream): MacroExpanderResult {
  return unported("rustc_builtin_macros::asm::expand_naked_asm (stub)");
}
