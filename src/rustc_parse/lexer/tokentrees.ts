// Port of compiler/rustc_parse/src/lexer/tokentrees.rs.
//
// PORT: `impl Lexer` extension module (PORTING §5 "Methods defined in another file"): mod.ts
// must not import this file; the crate root (src/rustc_parse/lib.ts) imports it for its side
// effects after mod.ts.
import { token, tokenstream } from "../../rustc_ast/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_eq, unported, unwrap } from "../../std/panic.ts";
import { type Result, Err, Ok } from "../../std/result.ts";
import { report_missing_open_delim, report_suspicious_mismatch_block, same_indentation_level } from "./diagnostics.ts";
import { Lexer, type UnmatchedDelim } from "./mod.ts";

type Delimiter = token.Delimiter;
type Token = token.Token;
type Spacing = tokenstream.Spacing;
type TokenStream = tokenstream.TokenStream;
type TokenTree = tokenstream.TokenTree;
const { DelimSpacing, DelimSpan, Spacing, TokenStream } = tokenstream;

// PORT: pending rustc_ast_pretty (pprust-state lane). `use rustc_ast_pretty::pprust::token_to_string;`
// Replace with the real import once it lands.
// PORT: pending rustc_ast_pretty
function token_to_string(_token: Token): string {
  return unported("rustc_ast_pretty::pprust::token_to_string (pending pprust-state)");
}

declare module "./mod.ts" {
  interface Lexer {
    lex_token_trees(is_delimited: boolean): Result<[Spacing, TokenStream], Diag>;
    lex_token_tree_open_delim(open_delim: Delimiter): Result<TokenTree, Diag>;
    bump(): [Token, Spacing];
    bump_minimal(): Spacing;
    calculate_spacing(next_tok: Token): Spacing;
    eof_err(): Diag;
    close_delim_err(delim: Delimiter): Diag;
  }
}

// Lex into a token stream. The `Spacing` in the result is that of the
// opening delimiter.
// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:14 lex_token_trees
Lexer.prototype.lex_token_trees = function (this: Lexer, is_delimited: boolean): Result<[Spacing, TokenStream], Diag> {
  // Move past the opening delimiter.
  const open_spacing = this.bump_minimal();

  const buf: TokenTree[] = [];
  for (;;) {
    let delim: Delimiter | undefined;
    if ((delim = token.TokenKind.open_delim(this.token.kind)) !== undefined) {
      // Invisible delimiters cannot occur here because `TokenTreesReader` parses
      // code directly from strings, with no macro expansion involved.
      // debug_assert!(!matches!(delim, Delimiter::Invisible(_)));
      const r = this.lex_token_tree_open_delim(delim);
      if (r.$ === "Err") return Err(r._0);
      buf.push(r._0);
    } else if ((delim = token.TokenKind.close_delim(this.token.kind)) !== undefined) {
      // Invisible delimiters cannot occur here because `TokenTreesReader` parses
      // code directly from strings, with no macro expansion involved.
      // debug_assert!(!matches!(delim, Delimiter::Invisible(_)));
      return is_delimited ? Ok([open_spacing, TokenStream.new(buf)]) : Err(this.close_delim_err(delim));
    } else if (this.token.kind.$ === "Eof") {
      return is_delimited ? Err(this.eof_err()) : Ok([open_spacing, TokenStream.new(buf)]);
    } else {
      // Get the next normal token.
      const [this_tok, this_spacing] = this.bump();
      buf.push({ $: "Token", _0: this_tok, _1: this_spacing });
    }
  }
};

// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:54 lex_token_tree_open_delim
Lexer.prototype.lex_token_tree_open_delim = function (this: Lexer, open_delim: Delimiter): Result<TokenTree, Diag> {
  // The span for beginning of the delimited section.
  const pre_span = this.token.span;

  this.diag_info.open_delimiters.push([open_delim, this.token.span]);

  // Lex the token trees within the delimiters.
  // We stop at any delimiter so we can try to recover if the user
  // uses an incorrect delimiter.
  const r = this.lex_token_trees(/* is_delimited */ true);
  if (r.$ === "Err") return r;
  const [open_spacing, tts] = r._0;

  // Expand to cover the entire delimited token tree.
  const delim_span = DelimSpan.from_pair(pre_span, this.token.span);
  const sm = this.psess.source_map();

  let close_spacing: Spacing;
  const close_delim = token.TokenKind.close_delim(this.token.kind);
  if (close_delim !== undefined) {
    if (token.Delimiter_eq(close_delim, open_delim)) {
      // Correct delimiter.
      unwrap(this.diag_info.open_delimiters.pop());
      const close_delimiter_span = this.token.span;

      if (tts.is_empty() && close_delim.$ === "Brace") {
        const empty_block_span = Span.to(pre_span, close_delimiter_span);
        if (!sm.is_multiline(empty_block_span)) {
          // Only track if the block is in the form of `{}`, otherwise it is
          // likely that it was written on purpose.
          this.diag_info.empty_block_spans.push(empty_block_span);
        }
      }

      // only add braces
      if (open_delim.$ === "Brace") {
        // Add all the matching spans, we will sort by span later
        this.diag_info.matching_block_spans.push([pre_span, close_delimiter_span]);
      }

      // A brace-delimited block whose first token is `&&`/`||` usually means
      // the user meant to continue an if-let chain, e.g. `if let P = e { && cond {`.
      let first: TokenTree | undefined;
      if (
        open_delim.$ === "Brace" &&
        (first = tts.iter().next()) !== undefined &&
        first.$ === "Token" &&
        (first._0.kind.$ === "AndAnd" || first._0.kind.$ === "OrOr")
      ) {
        this.diag_info.if_let_chain_hint_spans.push(first._0.span);
      }

      // Move past the closing delimiter.
      close_spacing = this.bump_minimal();
    } else {
      // Incorrect delimiter.
      let unclosed_delimiter: Span | undefined = undefined;
      let candidate: Span | undefined = undefined;

      if (this.diag_info.last_unclosed_found_span !== this.token.span) {
        // do not complain about the same unclosed delimiter multiple times
        this.diag_info.last_unclosed_found_span = this.token.span;
        // This is a conservative error: only report the last unclosed
        // delimiter. The previous unclosed delimiters could actually be
        // closed! The lexer just hasn't gotten to them yet.
        const last = this.diag_info.open_delimiters[this.diag_info.open_delimiters.length - 1];
        if (last !== undefined) {
          unclosed_delimiter = last[1];
        }
        for (const [delimiter, delimiter_span] of this.diag_info.open_delimiters) {
          if (same_indentation_level(sm, this.token.span, delimiter_span) && token.Delimiter_eq(delimiter, close_delim)) {
            // high likelihood of these two corresponding
            candidate = delimiter_span;
          }
        }
        unwrap(this.diag_info.open_delimiters.pop());
        const unmatched: UnmatchedDelim = {
          found_delim: close_delim,
          found_span: this.token.span,
          unclosed_span: unclosed_delimiter,
          candidate_span: candidate,
        };
        this.diag_info.unmatched_delims.push(unmatched);
      } else {
        this.diag_info.open_delimiters.pop();
      }

      // If the incorrect delimiter matches an earlier opening
      // delimiter, then don't consume it (it can be used to
      // close the earlier one). Otherwise, consume it.
      // E.g., we try to recover from:
      // fn foo() {
      //     bar(baz(
      // }  // Incorrect delimiter but matches the earlier `{`
      if (!this.diag_info.open_delimiters.some(([d, _]) => token.Delimiter_eq(d, close_delim))) {
        close_spacing = this.bump_minimal();
      } else {
        // The choice of value here doesn't matter.
        close_spacing = Spacing.Alone;
      }
    }
  } else {
    assert_eq(this.token.kind, token.TokenKind.Eof, (k) => token.debug_TokenKind(k, PLAIN), token.TokenKind_eq);
    // Silently recover, the EOF token will be seen again
    // and an error emitted then. Thus we don't pop from
    // self.open_delimiters here. The choice of spacing value here
    // doesn't matter.
    close_spacing = Spacing.Alone;
  }

  const spacing = DelimSpacing.new(open_spacing, close_spacing);

  return Ok({ $: "Delimited", _0: delim_span, _1: spacing, _2: open_delim, _3: tts });
};

// Move on to the next token, returning the current token and its spacing.
// Will glue adjacent single-char tokens together.
// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:167 bump
Lexer.prototype.bump = function (this: Lexer): [Token, Spacing] {
  let this_spacing: Spacing;
  let next_tok: Token;
  for (;;) {
    const [next_tok_, is_next_tok_preceded_by_whitespace] = this.next_token_from_cursor();

    let glued: Token | undefined;
    if (is_next_tok_preceded_by_whitespace) {
      [this_spacing, next_tok] = [Spacing.Alone, next_tok_];
      break;
    } else if ((glued = this.token.glue(next_tok_)) !== undefined) {
      this.token = glued;
    } else {
      const this_spacing_ = this.calculate_spacing(next_tok_);
      [this_spacing, next_tok] = [this_spacing_, next_tok_];
      break;
    }
  }
  // std::mem::replace(&mut self.token, next_tok)
  const this_tok = this.token;
  this.token = next_tok;
  return [this_tok, this_spacing];
};

// Cut-down version of `bump` used when the token kind is known in advance.
// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:185 bump_minimal
Lexer.prototype.bump_minimal = function (this: Lexer): Spacing {
  const [next_tok, is_next_tok_preceded_by_whitespace] = this.next_token_from_cursor();
  const this_spacing = is_next_tok_preceded_by_whitespace ? Spacing.Alone : this.calculate_spacing(next_tok);
  this.token = next_tok;
  return this_spacing;
};

// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:196 calculate_spacing
Lexer.prototype.calculate_spacing = function (this: Lexer, next_tok: Token): Spacing {
  if (next_tok.is_punct()) {
    return Spacing.Joint;
  } else if (next_tok.eq(token.TokenKind.Eof)) {
    return Spacing.Alone;
  } else {
    return Spacing.JointHidden;
  }
};

// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:206 eof_err
Lexer.prototype.eof_err = function (this: Lexer): Diag {
  const UNCLOSED_DELIMITER_SHOW_LIMIT = 5;
  const msg = "this file contains an unclosed delimiter";
  const err = this.dcx().struct_span_err(this.token.span, msg);

  const len = Math.min(UNCLOSED_DELIMITER_SHOW_LIMIT, this.diag_info.open_delimiters.length);
  for (const [_, span] of this.diag_info.open_delimiters.slice(0, len)) {
    err.span_label(span, "unclosed delimiter");
    this.diag_info.unmatched_delims.push({
      found_delim: undefined,
      found_span: this.token.span,
      unclosed_span: span,
      candidate_span: undefined,
    });
  }

  const at_limit = this.diag_info.open_delimiters[UNCLOSED_DELIMITER_SHOW_LIMIT];
  if (at_limit !== undefined && this.diag_info.open_delimiters.length >= UNCLOSED_DELIMITER_SHOW_LIMIT + 2) {
    const span = at_limit[1];
    err.span_label(
      span,
      `another ${this.diag_info.open_delimiters.length - UNCLOSED_DELIMITER_SHOW_LIMIT} unclosed delimiters begin from here`,
    );
  }

  const last = this.diag_info.open_delimiters[this.diag_info.open_delimiters.length - 1];
  if (last !== undefined) {
    const delim = last[0];
    report_suspicious_mismatch_block(err, this.diag_info, this.psess.source_map(), delim);
  }
  return err;
};

// rustc: compiler/rustc_parse/src/lexer/tokentrees.rs:245 close_delim_err
Lexer.prototype.close_delim_err = function (this: Lexer, delim: Delimiter): Diag {
  // An unexpected closing delimiter (i.e., there is no matching opening delimiter).
  const token_str = token_to_string(this.token);
  const msg = `unexpected closing delimiter: \`${token_str}\``;
  const err = this.dcx().struct_span_err(this.token.span, msg);

  // if there is no missing open delim, report suspicious mismatch block
  if (!report_missing_open_delim(err, this.diag_info.unmatched_delims)) {
    report_suspicious_mismatch_block(err, this.diag_info, this.psess.source_map(), delim);
  }

  err.span_label(this.token.span, "unexpected closing delimiter");
  return err;
};
