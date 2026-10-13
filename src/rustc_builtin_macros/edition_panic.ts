// Port of compiler/rustc_builtin_macros/src/edition_panic.rs
import { token } from "../rustc_ast/lib.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";

/// This expands to either
/// - `$crate::panic::panic_2015!(...)` or
/// - `$crate::panic::panic_2021!(...)`
/// depending on the edition.
///
/// This is used for both std::panic!() and core::panic!().
///
/// `$crate` will refer to either the `std` or `core` crate depending on which
/// one we're expanding from.
// rustc: compiler/rustc_builtin_macros/src/edition_panic.rs:16 expand_panic
export function expand_panic(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const mac = use_panic_2021(sp) ? sym.panic_2021 : sym.panic_2015;
  return expand(mac, cx, sp, tts);
}

/// This expands to either
/// - `$crate::panic::unreachable_2015!(...)` or
/// - `$crate::panic::unreachable_2021!(...)`
/// depending on the edition.
// rustc: compiler/rustc_builtin_macros/src/edition_panic.rs:29 expand_unreachable
export function expand_unreachable(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const mac = use_panic_2021(sp) ? sym.unreachable_2021 : sym.unreachable_2015;
  return expand(mac, cx, sp, tts);
}

// rustc: compiler/rustc_builtin_macros/src/edition_panic.rs:38 expand
function expand(mac: Symbol, cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const sp = cx.with_call_site_ctxt(sp_);

  return {
    $: "Ready",
    _0: MacEager.expr(
      cx.expr_macro_call(sp, cx.macro_call(sp, cx.path(sp, cx.std_path([sym.panic, mac])), token.Delimiter.Parenthesis, tts)),
    ),
  };
}

// rustc: compiler/rustc_builtin_macros/src/edition_panic.rs:57 use_panic_2021
export function use_panic_2021(span_: Span): boolean {
  let span = span_;
  // To determine the edition, we check the first span up the expansion
  // stack that does not have #[allow_internal_unstable(edition_panic)].
  // (To avoid using the edition of e.g. the assert!() or debug_assert!() definition.)
  for (;;) {
    const expn = SyntaxContext.outer_expn_data(Span.ctxt(span));
    const features = expn.allow_internal_unstable;
    if (features !== undefined && features.includes(sym.edition_panic)) {
      span = expn.call_site;
      continue;
    }
    return Edition_discriminant[expn.edition] >= Edition_discriminant[Edition.Edition2021];
  }
}
