//! Migration code for the `expr_fragment_specifier_2024` rule.
// compiler/rustc_lint/src/macro_expr_fragment_specifier_2024_migration.rs. The lint static and the
// `declare_lint_pass!` expansion are generated (macro_expr_fragment_specifier_2024_migration.lints.gen.ts).
import type { ast } from "../rustc_ast/lib.ts";
import type { Token } from "../rustc_ast/token.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { into_MultiSpan } from "../rustc_errors/lib.ts";
import { type Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import type { EarlyContext } from "./context.ts";
import { MacroExprFragment2024_diagnostic } from "./diagnostics.gen.ts";
import { EDITION_2024_EXPR_FRAGMENT_SPECIFIER, Expr2024 } from "./macro_expr_fragment_specifier_2024_migration.lints.gen.ts";
import type { EarlyLintPass } from "./passes.ts";

export * from "./macro_expr_fragment_specifier_2024_migration.lints.gen.ts";

declare module "./macro_expr_fragment_specifier_2024_migration.lints.gen.ts" {
  interface Expr2024 extends EarlyLintPass {
    check_tokens(cx: EarlyContext, tokens: TokenStream): void;
    check_ident_token(cx: EarlyContext, token: Token): void;
  }
}

// impl Expr2024
// rustc: compiler/rustc_lint/src/macro_expr_fragment_specifier_2024_migration.rs:81 check_tokens
Expr2024.prototype.check_tokens = function (this: Expr2024, cx: EarlyContext, tokens: TokenStream): void {
  let prev_colon = false;
  let prev_identifier = false;
  let prev_dollar = false;
  const it = tokens.iter();
  for (let tt = it.next(); tt !== undefined; tt = it.next()) {
    // debug!(
    //     "check_tokens: {:?} - colon {prev_dollar} - ident {prev_identifier} - colon {prev_colon}",
    //     tt
    // );
    switch (tt.$) {
      case "Token": {
        const token = tt._0;
        switch (token.kind.$) {
          case "Dollar":
            prev_dollar = true;
            continue;
          case "Ident":
          case "NtIdent":
            if (prev_colon && prev_identifier && prev_dollar) {
              this.check_ident_token(cx, token);
            } else if (prev_dollar) {
              prev_identifier = true;
              continue;
            }
            break;
          case "Colon":
            if (prev_dollar && prev_identifier) {
              prev_colon = true;
              continue;
            }
            break;
          default:
            break;
        }
        break;
      }
      case "Delimited":
        this.check_tokens(cx, tt._3);
        break;
    }
    prev_colon = false;
    prev_identifier = false;
    prev_dollar = false;
  }
};

// rustc: compiler/rustc_lint/src/macro_expr_fragment_specifier_2024_migration.rs:120 check_ident_token
Expr2024.prototype.check_ident_token = function (this: Expr2024, cx: EarlyContext, token: Token): void {
  // debug!("check_ident_token: {:?}", token);
  if (token.kind.$ !== "Ident") return;
  const sym_ = token.kind._0;
  const edition: Edition = "Edition2024";

  // debug!("token.span.edition(): {:?}", token.span.edition());
  if (Edition_discriminant[Span.edition(token.span)] >= Edition_discriminant[edition]) {
    return;
  }

  if (sym_ !== sym.expr) {
    return;
  }

  // debug!("emitting lint");
  cx.builder.emit_span_lint(
    EDITION_2024_EXPR_FRAGMENT_SPECIFIER,
    into_MultiSpan(token.span),
    MacroExprFragment2024_diagnostic({ suggestion: token.span }),
  );
};

// impl EarlyLintPass for Expr2024
// rustc: compiler/rustc_lint/src/macro_expr_fragment_specifier_2024_migration.rs:144 check_mac_def
Expr2024.prototype.check_mac_def = function (this: Expr2024, cx: EarlyContext, mc: ast.MacroDef): void {
  this.check_tokens(cx, mc.body.tokens);
};
