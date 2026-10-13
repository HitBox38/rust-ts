// STUB for compiler/rustc_builtin_macros/src/contracts.rs (owned by lane bm-rest; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-rest lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { type AttrProcMacro, AttrProcMacro_provided, type ExtCtxt } from "../rustc_expand/base.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/** `pub(crate) struct ExpandRequires;` + `impl AttrProcMacro for ExpandRequires` */
export const ExpandRequires: AttrProcMacro = AttrProcMacro_provided({
  expand(_ecx: ExtCtxt, _span: Span, _annotation: TokenStream, _annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return unported("rustc_builtin_macros::contracts::ExpandRequires::expand (stub)");
  },
});

/** `pub(crate) struct ExpandEnsures;` + `impl AttrProcMacro for ExpandEnsures` */
export const ExpandEnsures: AttrProcMacro = AttrProcMacro_provided({
  expand(_ecx: ExtCtxt, _span: Span, _annotation: TokenStream, _annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return unported("rustc_builtin_macros::contracts::ExpandEnsures::expand (stub)");
  },
});
