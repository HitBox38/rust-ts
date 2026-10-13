// Port of compiler/rustc_expand/src/diagnostics.rs.
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl (`<T>_into_diag` +
// `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) and `default_MveExtraTokens`
// (`#[derive(Default)]`) are generated into diagnostics.gen.ts by tools/codegen/types.ts (set
// `rustc_expand`). This module holds the hand-written fns of the file.
//
// PORT: same conventions as src/rustc_parse/diagnostics.ts: inherent fns of generated types live on a
// companion const defined here (`InvalidIdentReason.new(..)`). The inline `mod metavar_exprs` is
// generated as a namespace; `pub(crate) use metavar_exprs::*;` is the explicit re-export list below.
import { is_id_continue, is_id_start } from "../rustc_lexer/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import { metavar_exprs } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// pub(crate) use metavar_exprs::*;
export type MveExtraTokens = metavar_exprs.MveExtraTokens;
export const MveExtraTokens_into_diag = metavar_exprs.MveExtraTokens_into_diag;
export const MveExtraTokens_diagnostic = metavar_exprs.MveExtraTokens_diagnostic;
export const default_MveExtraTokens = metavar_exprs.default_MveExtraTokens;
export type MveMissingParen = metavar_exprs.MveMissingParen;
export const MveMissingParen_into_diag = metavar_exprs.MveMissingParen_into_diag;
export const MveMissingParen_diagnostic = metavar_exprs.MveMissingParen_diagnostic;
export type MveUnrecognizedExpr = metavar_exprs.MveUnrecognizedExpr;
export const MveUnrecognizedExpr_into_diag = metavar_exprs.MveUnrecognizedExpr_into_diag;
export const MveUnrecognizedExpr_diagnostic = metavar_exprs.MveUnrecognizedExpr_diagnostic;
export type MveUnrecognizedVar = metavar_exprs.MveUnrecognizedVar;
export const MveUnrecognizedVar_into_diag = metavar_exprs.MveUnrecognizedVar_into_diag;
export const MveUnrecognizedVar_diagnostic = metavar_exprs.MveUnrecognizedVar_diagnostic;
export type ConcatInvalidIdent = metavar_exprs.ConcatInvalidIdent;
export const ConcatInvalidIdent_into_diag = metavar_exprs.ConcatInvalidIdent_into_diag;
export const ConcatInvalidIdent_diagnostic = metavar_exprs.ConcatInvalidIdent_diagnostic;
export type InvalidIdentReason = metavar_exprs.InvalidIdentReason;
export const InvalidIdentReason_add_to_diag = metavar_exprs.InvalidIdentReason_add_to_diag;
export const InvalidIdentReason_subdiagnostic = metavar_exprs.InvalidIdentReason_subdiagnostic;

export const InvalidIdentReason = {
  ...metavar_exprs.InvalidIdentReason,

  // rustc: compiler/rustc_expand/src/diagnostics.rs:532 new
  new(symbol: Symbol): InvalidIdentReason {
    // PORT: `symbol.as_str().chars()` as an iterator over the code points.
    const chars = Array.from(Symbol.as_str(symbol), (c) => c.codePointAt(0)!)[Symbol_iterator]();
    const first = chars.next();
    if (!first.done) {
      const start = first.value;
      if (is_id_start(start)) {
        let not_continue: number | undefined;
        for (let n = chars.next(); !n.done; n = chars.next()) {
          if (!is_id_continue(n.value)) {
            not_continue = n.value;
            break;
          }
        }
        if (not_continue === undefined) panic("InvalidIdentReason: cannot find invalid ident reason");
        return { $: "InvalidContinue", symbol, not_continue };
      } else {
        return { $: "InvalidStart", symbol, start };
      }
    } else {
      return InvalidIdentReason.Empty;
    }
  },
};

// PORT: the global `Symbol` is shadowed by rustc_span's `Symbol` in this module.
const Symbol_iterator: typeof globalThis.Symbol.iterator = globalThis.Symbol.iterator;
