// Port of compiler/rustc_parse/src/lexer/diagnostics.rs.
import { token } from "../../rustc_ast/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import { unported, unreachable } from "../../std/panic.ts";
import { MismatchedClosingDelimiter_diagnostic } from "../diagnostics.ts";
import type { ParseSess, UnmatchedDelim } from "./mod.ts";

type Delimiter = token.Delimiter;
type TokenKind = token.TokenKind;

// PORT: pending rustc_ast_pretty (pprust-state lane). `use crate::pprust;` is
// `rustc_ast_pretty::pprust`; replace this shim with
// `import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts"` once it lands.
const pprust = {
  // PORT: pending rustc_ast_pretty
  token_kind_to_string(_tok: TokenKind): string {
    return unported("rustc_ast_pretty::pprust::token_kind_to_string (pending pprust-state)");
  },
};

/** `#[derive(Default)]` */
export class TokenTreeDiagInfo {
  constructor(
    /// Stack of open delimiters and their spans. Used for error message.
    public open_delimiters: [Delimiter, Span][],
    public unmatched_delims: UnmatchedDelim[],

    /// Used only for error recovery when arriving to EOF with mismatched braces.
    public last_unclosed_found_span: Span | undefined,

    /// Collect empty block spans that might have been auto-inserted by editors.
    public empty_block_spans: Span[],

    /// Spans of `&&`/`||` tokens that directly open a brace-delimited block,
    /// which usually means the user meant to continue an if-let chain.
    public if_let_chain_hint_spans: Span[],

    /// Collect the spans of braces (Open, Close). Used only
    /// for detecting if blocks are empty and only braces.
    public matching_block_spans: [Span, Span][],
  ) {}

  /** `#[derive(Default)]` */
  static default(): TokenTreeDiagInfo {
    return new TokenTreeDiagInfo([], [], undefined, [], [], []);
  }
}

// rustc: compiler/rustc_parse/src/lexer/diagnostics.rs:32 same_indentation_level
export function same_indentation_level(sm: SourceMap, open_sp: Span, close_sp: Span): boolean {
  const open_padding = sm.span_to_margin(open_sp);
  const close_padding = sm.span_to_margin(close_sp);
  if (open_padding !== undefined && close_padding !== undefined) {
    return open_padding === close_padding;
  } else {
    return false;
  }
}

// When we get a `)` or `]` for `{`, we should emit help message here
// it's more friendly compared to report `unmatched error` in later phase
// rustc: compiler/rustc_parse/src/lexer/diagnostics.rs:41 report_missing_open_delim
export function report_missing_open_delim(err: Diag, unmatched_delims: UnmatchedDelim[]): boolean {
  let reported_missing_open = false;
  // unmatched_delims.retain(|unmatch_brace| { .. })
  let kept = 0;
  for (let i = 0; i < unmatched_delims.length; i++) {
    const unmatch_brace = unmatched_delims[i]!;
    let keep: boolean;
    const delim = unmatch_brace.found_delim;
    if (delim !== undefined && (delim.$ === "Parenthesis" || delim.$ === "Bracket")) {
      let missed_open: string;
      switch (delim.$) {
        case "Parenthesis":
          missed_open = "(";
          break;
        case "Bracket":
          missed_open = "[";
          break;
        default:
          unreachable();
      }

      const unclosed_span = unmatch_brace.unclosed_span;
      if (unclosed_span !== undefined) {
        err.span_label(unclosed_span, "the nearest open delimiter");
      }
      err.span_label(Span.shrink_to_lo(unmatch_brace.found_span), `missing open \`${missed_open}\` for this delimiter`);
      reported_missing_open = true;
      keep = false;
    } else {
      keep = true;
    }
    if (keep) unmatched_delims[kept++] = unmatch_brace;
  }
  unmatched_delims.length = kept;
  return reported_missing_open;
}

// rustc: compiler/rustc_parse/src/lexer/diagnostics.rs:72 report_suspicious_mismatch_block
export function report_suspicious_mismatch_block(err: Diag, diag_info: TokenTreeDiagInfo, sm: SourceMap, delim: Delimiter): void {
  const matched_spans: [Span, boolean][] = diag_info.matching_block_spans.map(([open, close]) => [
    Span.with_hi(open, Span.lo(close)),
    same_indentation_level(sm, open, close),
  ]);

  // sort by `lo`, so the large block spans in the front
  // PORT: `sort_by_key` is a stable sort, as is `Array.prototype.sort`.
  matched_spans.sort((a, b) => Span.lo(a[0]) - Span.lo(b[0]));

  // We use larger block whose indentation is well to cover those inner mismatched blocks
  // O(N^2) here, but we are on error reporting path, so it is fine
  for (let i = 0; i < matched_spans.length; i++) {
    const [block_span, same_ident] = matched_spans[i]!;
    if (same_ident) {
      for (let j = i + 1; j < matched_spans.length; j++) {
        const [inner_block, inner_same_ident] = matched_spans[j]!;
        if (Span.contains(block_span, inner_block) && !inner_same_ident) {
          matched_spans[j] = [inner_block, true];
        }
      }
    }
  }

  // Find the innermost span candidate for final report
  let candidate_span: Span | undefined = undefined;
  for (let k = matched_spans.length - 1; k >= 0; k--) {
    const [span, same_ident] = matched_spans[k]!;
    if (!same_ident) {
      candidate_span = span;
      break;
    }
  }

  if (candidate_span !== undefined) {
    const block_span = candidate_span;
    err.span_label(Span.shrink_to_lo(block_span), "this delimiter might not be properly closed...");
    err.span_label(Span.shrink_to_hi(block_span), "...as it matches this but it has different indentation");

    // If there is a empty block in the mismatched span, note it
    if (token.Delimiter_eq(delim, token.Delimiter.Brace)) {
      for (const span of diag_info.empty_block_spans) {
        if (Span.contains(block_span, span)) {
          err.span_label(span, "block is empty, you might have not meant to close it");
          break;
        }
      }
    }
  } else {
    // If there is no suspicious span, give the last properly closed block may help
    const parent = diag_info.matching_block_spans[diag_info.matching_block_spans.length - 1];
    if (
      parent !== undefined &&
      diag_info.open_delimiters[diag_info.open_delimiters.length - 1] === undefined &&
      diag_info.empty_block_spans.every((sp) => sp !== Span.to(parent[0], parent[1]))
    ) {
      err.span_label(parent[0], "this opening brace...");
      err.span_label(parent[1], "...matches this closing brace");
    }
  }

  for (const span of diag_info.if_let_chain_hint_spans) {
    err.span_label(span, "you might have meant to continue an if-let chain here");
  }
}

// rustc: compiler/rustc_parse/src/lexer/diagnostics.rs:137 make_errors_for_mismatched_closing_delims
export function make_errors_for_mismatched_closing_delims(unmatcheds: readonly UnmatchedDelim[], psess: ParseSess): Diag[] {
  const out: Diag[] = [];
  for (const unmatched of unmatcheds) {
    // `None` here means an `Eof` was found. We already emit those errors elsewhere, we add them to
    // `unmatched_delims` only for error recovery in the `Parser`.
    const found_delim = unmatched.found_delim;
    if (found_delim === undefined) continue;
    const spans = [unmatched.found_span];
    const sp = unmatched.unclosed_span;
    if (sp !== undefined) {
      spans.push(sp);
    }
    const err = psess.dcx().create_err(
      MismatchedClosingDelimiter_diagnostic({
        spans,
        delimiter: pprust.token_kind_to_string(token.Delimiter.as_close_token_kind(found_delim)),
        unmatched: unmatched.found_span,
        opening_candidate: unmatched.candidate_span,
        unclosed: unmatched.unclosed_span,
      }),
    );
    out.push(err);
  }
  return out;
}
