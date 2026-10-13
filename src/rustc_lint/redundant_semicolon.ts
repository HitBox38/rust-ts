// compiler/rustc_lint/src/redundant_semicolon.rs. The lint static and the `declare_lint_pass!` expansion are
// generated (redundant_semicolon.lints.gen.ts).
import type { ast } from "../rustc_ast/lib.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { EarlyContext } from "./context.ts";
import { RedundantSemicolonsDiag_diagnostic, type RedundantSemicolonsSuggestion } from "./diagnostics.gen.ts";
import type { EarlyLintPass } from "./passes.ts";
import { REDUNDANT_SEMICOLONS, RedundantSemicolons } from "./redundant_semicolon.lints.gen.ts";

export * from "./redundant_semicolon.lints.gen.ts";

declare module "./redundant_semicolon.lints.gen.ts" {
  interface RedundantSemicolons extends EarlyLintPass {}
}

// impl EarlyLintPass for RedundantSemicolons
// rustc: compiler/rustc_lint/src/redundant_semicolon.rs:32 check_block
RedundantSemicolons.prototype.check_block = function (this: RedundantSemicolons, cx: EarlyContext, block: ast.Block): void {
  const seq: MutRef<[Span, boolean] | undefined> = { value: undefined };
  for (const stmt of block.stmts) {
    if (stmt.kind.$ === "Empty" && seq.value === undefined) {
      seq.value = [stmt.span, false];
    } else if (stmt.kind.$ === "Empty") {
      const s = seq.value!;
      seq.value = [Span.to(s[0], stmt.span), true];
    } else {
      maybe_lint_redundant_semis(cx, seq);
    }
  }
  maybe_lint_redundant_semis(cx, seq);
};

// rustc: compiler/rustc_lint/src/redundant_semicolon.rs:45 maybe_lint_redundant_semis
function maybe_lint_redundant_semis(cx: EarlyContext, seq: MutRef<[Span, boolean] | undefined>): void {
  const taken = seq.value;
  seq.value = undefined;
  if (taken !== undefined) {
    const [span, multiple] = taken;
    if (span === DUMMY_SP) {
      return;
    }

    // Ignore redundant semicolons inside macro expansion.(issue #142143)
    const suggestion: RedundantSemicolonsSuggestion | undefined = Span.from_expansion(span)
      ? undefined
      : { multiple_semicolons: multiple, span };

    cx.emit_span_lint(REDUNDANT_SEMICOLONS, span, RedundantSemicolonsDiag_diagnostic({ multiple, suggestion }));
  }
}
