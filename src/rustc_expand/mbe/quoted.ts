// Port of compiler/rustc_expand/src/mbe/quoted.rs

import { token as token_mod, tokenstream } from "../../rustc_ast/lib.ts";
import type { NodeId } from "../../rustc_ast/node_id.ts";
import type { Token } from "../../rustc_ast/token.ts";
import { clone_DelimSpacing, clone_DelimSpan, type TokenStreamIter } from "../../rustc_ast/tokenstream.ts";
import { token_kind_to_string, token_to_string } from "../../rustc_ast_pretty/pprust/mod.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import { Applicability } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Symbol, Ident, kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type Delimited, KleeneOp, KleeneToken, MetaVarExpr, type SequenceRepetition, TokenTree } from "../mbe.ts";
import { count_metavar_decls } from "./macro_parser.ts";

// ---------------------------------------------------------------------------------------------
// PORT: pending expand-core: `crate::diagnostics` (compiler/rustc_expand/src/diagnostics.rs, generated
// into src/rustc_expand/diagnostics.gen.ts). Until it lands, these stand-ins have the generated shapes
// (field interfaces + `<T>_diagnostic`) and stop with `unported`. Replace this block with
// `import { ExpectedParenOrBrace_diagnostic, InvalidFragmentSpecifier_diagnostic, MissingFragmentSpecifier_diagnostic } from "../diagnostics.ts";`
interface MissingFragmentSpecifier {
  span: Span;
  add_span: Span;
  valid: string;
}
function MissingFragmentSpecifier_diagnostic(_self: MissingFragmentSpecifier): Diagnostic {
  return unported("rustc_expand::diagnostics::MissingFragmentSpecifier");
}
interface InvalidFragmentSpecifier {
  span: Span;
  fragment: Ident;
  help: string;
}
function InvalidFragmentSpecifier_diagnostic(_self: InvalidFragmentSpecifier): Diagnostic {
  return unported("rustc_expand::diagnostics::InvalidFragmentSpecifier");
}
interface ExpectedParenOrBrace {
  span: Span;
  token: string;
}
function ExpectedParenOrBrace_diagnostic(_self: ExpectedParenOrBrace): Diagnostic {
  return unported("rustc_expand::diagnostics::ExpectedParenOrBrace");
}
// ---------------------------------------------------------------------------------------------

const { Delimiter, NonterminalKind, Token: TokenC, TokenKind, TokenKind_eq, clone_Token } = token_mod;

// PORT: the Rust string continuations (`\` + newline + indentation) are joined without whitespace.
export const VALID_FRAGMENT_NAMES_MSG: string =
  "valid fragment specifiers are " +
  "`ident`, `block`, `stmt`, `expr`, `pat`, `ty`, `lifetime`, `literal`, `path`, " +
  "`meta`, `tt`, `item` and `vis`, along with `expr_2021` and `pat_param` for edition compatibility";

/// Which part of a macro rule we're parsing
// rustc-type: compiler/rustc_expand/src/mbe/quoted.rs:22 RulePart
export type RulePart =
  /// The left-hand side, with patterns and metavar definitions with types
  | "Pattern"
  /// The right-hand side body, with metavar references and metavar expressions
  | "Body";

// impl RulePart (methods on the companion, PORTING §8)
export const RulePart = {
  Pattern: "Pattern",
  Body: "Body",

  // #[inline(always)]
  // rustc: compiler/rustc_expand/src/mbe/quoted.rs:31 is_pattern
  is_pattern(self: RulePart): boolean {
    return self === "Pattern";
  },

  // #[inline(always)]
  // rustc: compiler/rustc_expand/src/mbe/quoted.rs:36 is_body
  is_body(self: RulePart): boolean {
    return self === "Body";
  },
} as const;

/// Takes a `tokenstream::TokenStream` and returns a `Vec<self::TokenTree>`. Specifically, this
/// takes a generic `TokenStream`, such as is used in the rest of the compiler, and returns a
/// collection of `TokenTree` for use in parsing a macro.
///
/// # Parameters
///
/// - `input`: a token stream to read from, the contents of which we are parsing.
/// - `part`: whether we're parsing the patterns or the body of a macro. Both take roughly the same
///   form _except_ that:
///   - In a pattern, metavars are declared with their "matcher" type. For example `$var:expr` or
///     `$id:ident`. In this example, `expr` and `ident` are "matchers". They are not present in the
///     body of a macro rule -- just in the pattern.
///   - Metavariable expressions are only valid in the "body", not the "pattern".
/// - `sess`: the parsing session. Any errors will be emitted to this session.
/// - `node_id`: the NodeId of the macro we are parsing.
/// - `features`: language features so we can do feature gating.
///
/// # Returns
///
/// A collection of `self::TokenTree`. There may also be some errors emitted to `sess`.
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:61 parse
export function parse(
  input: tokenstream.TokenStream,
  part: RulePart,
  sess: Session,
  node_id: NodeId,
  features: Features,
  edition: Edition,
): TokenTree[] {
  // Will contain the final collection of `self::TokenTree`
  const result: TokenTree[] = [];

  // For each token tree in `input`, parse the token into a `self::TokenTree`, consuming
  // additional trees if need be.
  const iter = input.iter();
  for (let tree_ = iter.next(); tree_ !== undefined; tree_ = iter.next()) {
    // Given the parsed tree, if there is a metavar and we are expecting matchers, actually
    // parse out the matcher (i.e., in `$id:ident` this would parse the `:` and `ident`).
    const tree = parse_tree(tree_, iter, part, sess, node_id, features, edition);

    if (RulePart.is_body(part)) {
      // No matchers allowed, nothing to process here
      result.push(tree);
      continue;
    }

    if (tree.$ !== "MetaVar") {
      // Not a metavariable, just return the tree
      result.push(tree);
      continue;
    }
    const start_sp = tree._0;
    const ident = tree._1;

    const fallback_metavar_decl = (span: Span): TokenTree => ({
      $: "MetaVarDecl",
      span,
      name: ident,
      kind: NonterminalKind.TT,
    });
    // Emit a missing-fragment diagnostic and return a `TokenTree` fallback so parsing can
    // continue.
    const missing_fragment_specifier = (span: Span, add_span: Span): TokenTree => {
      sess.dcx().emit_err(
        MissingFragmentSpecifier_diagnostic({
          span,
          add_span,
          valid: VALID_FRAGMENT_NAMES_MSG,
        }),
      );
      return fallback_metavar_decl(span);
    };

    // Not consuming the next token immediately, as it may not be a colon
    const peek = iter.peek();
    if (peek !== undefined && peek.$ === "Token" && TokenKind_eq(peek._0.kind, TokenKind.Colon)) {
      const colon_span = peek._0.span;
      // Next token is a colon; consume it
      iter.next();

      // It's ok to consume the next tree no matter how,
      // since if it's not a token then it will be an invalid declaration.
      const next = iter.next();
      if (next === undefined || next.$ !== "Token") {
        // Invalid, return a nice source location as `var:`
        result.push(missing_fragment_specifier(Span.with_lo(colon_span, Span.lo(start_sp)), Span.shrink_to_hi(colon_span)));
        continue;
      }
      const token = next._0;

      const id = token.ident();
      if (id === undefined) {
        // No identifier for the fragment specifier;
        const next2 = iter.peek();
        if (TokenKind_eq(token.kind, TokenKind.Dollar) && next2 !== undefined && next2.$ === "Token" && next2._0.ident() !== undefined) {
          const err = sess.dcx().struct_span_err(token.span, "missing fragment specifier");
          err.note("fragment specifiers must be provided");
          err.help(VALID_FRAGMENT_NAMES_MSG);
          err.span_suggestion_verbose(
            token.span,
            "fragment specifiers should not be prefixed with `$`",
            "",
            Applicability.MaybeIncorrect,
          );
          err.emit();
          result.push(fallback_metavar_decl(token.span));
        } else {
          result.push(missing_fragment_specifier(token.span, Span.shrink_to_hi(token.span)));
        }
        continue;
      }
      const fragment = id[0];

      const span = Span.with_lo(token.span, Span.lo(start_sp));
      const edition_ = (): Edition => {
        // FIXME(#85708) - once we properly decode a foreign
        // crate's `SyntaxContext::root`, then we can replace
        // this with just `span.edition()`. A
        // `SyntaxContext::root()` from the current crate will
        // have the edition of the current crate, and a
        // `SyntaxContext::root()` from a foreign crate will
        // have the edition of that crate (which we manually
        // retrieve via the `edition` parameter).
        if (!Span.from_expansion(span)) {
          return edition;
        } else {
          return Span.edition(span);
        }
      };
      let kind = NonterminalKind.from_symbol(fragment.name, edition_);
      if (kind === undefined) {
        sess.dcx().emit_err(
          InvalidFragmentSpecifier_diagnostic({
            span,
            fragment,
            help: VALID_FRAGMENT_NAMES_MSG,
          }),
        );
        kind = NonterminalKind.TT;
      }
      result.push({ $: "MetaVarDecl", span, name: ident, kind });
    } else {
      // Whether it's none or some other tree, it doesn't belong to
      // the current meta variable, returning the original span.
      result.push(missing_fragment_specifier(start_sp, Span.shrink_to_hi(start_sp)));
    }
  }
  return result;
}

/// Takes a `tokenstream::TokenTree` and returns a `self::TokenTree`. Like `parse`, but for a
/// single token tree. Emits errors to `sess` if needed.
// #[inline]
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:186 parse_one_tt
export function parse_one_tt(
  input: tokenstream.TokenTree,
  part: RulePart,
  sess: Session,
  node_id: NodeId,
  features: Features,
  edition: Edition,
): TokenTree {
  return unwrap(parse(tokenstream.TokenStream.new([input]), part, sess, node_id, features, edition).pop());
}

/// Asks for the `macro_metavar_expr` feature if it is not enabled
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:200 maybe_emit_macro_metavar_expr_feature
function maybe_emit_macro_metavar_expr_feature(features: Features, sess: Session, span: Span): void {
  if (!features.macro_metavar_expr()) {
    const msg = "meta-variable expressions are unstable";
    feature_err(sess, sym.macro_metavar_expr, span, msg).emit();
  }
}

// rustc: compiler/rustc_expand/src/mbe/quoted.rs:207 maybe_emit_macro_metavar_expr_concat_feature
function maybe_emit_macro_metavar_expr_concat_feature(features: Features, sess: Session, span: Span, what: Symbol): void {
  if (!features.macro_metavar_expr_concat()) {
    const msg = `the \`${display_Symbol(what)}\` meta-variable expression is unstable`;
    feature_err(sess, sym.macro_metavar_expr_concat, span, msg).emit();
  }
}

/// Takes a `tokenstream::TokenTree` and returns a `self::TokenTree`. Specifically, this takes a
/// generic `TokenTree`, such as is used in the rest of the compiler, and returns a `TokenTree`
/// for use in parsing a macro.
///
/// Converting the given tree may involve reading more tokens.
///
/// # Parameters
///
/// - `tree`: the tree we wish to convert.
/// - `outer_iter`: an iterator over trees. We may need to read more tokens from it in order to finish
///   converting `tree`
/// - `part`: same as [parse].
/// - `sess`: the parsing session. Any errors will be emitted to this session.
/// - `features`: language features so we can do feature gating.
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:233 parse_tree
function parse_tree(
  tree: tokenstream.TokenTree,
  outer_iter: TokenStreamIter,
  part: RulePart,
  sess: Session,
  node_id: NodeId,
  features: Features,
  edition: Edition,
): TokenTree {
  // Depending on what `tree` is, we could be parsing different parts of a macro
  if (tree.$ === "Token" && TokenKind_eq(tree._0.kind, TokenKind.Dollar)) {
    // `tree` is a `$` token. Look at the next token in `trees`
    const dollar_span = tree._0.span;
    // FIXME: Handle `Invisible`-delimited groups in a more systematic way
    // during parsing.
    let next = outer_iter.next();
    let iter: TokenStreamIter;
    if (next !== undefined && next.$ === "Delimited" && Delimiter.skip(next._2)) {
      const iter_storage = next._3.iter();
      next = iter_storage.next();
      iter = iter_storage;
    } else {
      iter = outer_iter;
    }

    if (next !== undefined && next.$ === "Delimited") {
      // `tree` is followed by a delimited set of token trees.
      const delim_span = clone_DelimSpan(next._0);
      const delim = next._2;
      const tts = next._3;
      if (RulePart.is_pattern(part)) {
        if (delim.$ !== "Parenthesis") {
          span_dollar_dollar_or_metavar_in_the_lhs_err(sess, TokenC.new(Delimiter.as_open_token_kind(delim), delim_span.entire()));
        }
      } else {
        switch (delim.$) {
          case "Brace": {
            // The delimiter is `{`. This indicates the beginning
            // of a meta-variable expression (e.g. `${count(ident)}`).
            // Try to parse the meta-variable expression.
            const r = MetaVarExpr.parse(tts, delim_span.entire(), sess.psess);
            if (r.$ === "Err") {
              const err = r._0;
              err.emit();
              // Returns early the same read `$` to avoid spanning
              // unrelated diagnostics that could be performed afterwards
              return TokenTree.token(TokenKind.Dollar, dollar_span);
            } else {
              const elem = r._0;
              if (elem.$ === "ConcatIdent") {
                maybe_emit_macro_metavar_expr_concat_feature(features, sess, delim_span.entire(), sym.concat);
              } else if (elem.$ === "ConcatStr") {
                maybe_emit_macro_metavar_expr_concat_feature(features, sess, delim_span.entire(), sym.concat_str);
              } else {
                maybe_emit_macro_metavar_expr_feature(features, sess, delim_span.entire());
              }
              return { $: "MetaVarExpr", _0: delim_span, _1: elem };
            }
          }
          case "Parenthesis":
            break;
          default: {
            const token = token_kind_to_string(Delimiter.as_open_token_kind(delim));
            sess.dcx().emit_err(
              ExpectedParenOrBrace_diagnostic({
                span: delim_span.entire(),
                token,
              }),
            );
          }
        }
      }
      // If we didn't find a metavar expression above, then we must have a
      // repetition sequence in the macro (e.g. `$(pat)*`). Parse the
      // contents of the sequence itself
      const sequence = parse(tts, part, sess, node_id, features, edition);
      // Get the Kleene operator and optional separator
      const [separator, kleene] = parse_sep_and_kleene_op(iter, delim_span.entire(), sess);
      // Count the number of captured "names" (i.e., named metavars)
      const num_captures = RulePart.is_pattern(part) ? count_metavar_decls(sequence) : 0;
      const seq: SequenceRepetition = { tts: sequence, separator, kleene, num_captures };
      return { $: "Sequence", _0: delim_span, _1: seq };
    }

    if (next !== undefined && next.$ === "Token" && next._0.ident() !== undefined) {
      // `tree` is followed by an `ident`. This could be `$meta_var` or the `$crate`
      // special metavariable that names the crate of the invocation.
      const [ident, kind] = next._0.ident()!;
      const span = Span.with_lo(ident.span, Span.lo(dollar_span));
      if (ident.name === kw.Crate && (kind === "Normal" || kind === "ForcedKeyword")) {
        return TokenTree.token({ $: "Ident", _0: kw.DollarCrate, _1: kind }, span);
      } else {
        return { $: "MetaVar", _0: span, _1: ident };
      }
    }

    if (next !== undefined && next.$ === "Token" && TokenKind_eq(next._0.kind, TokenKind.Dollar)) {
      // `tree` is followed by another `$`. This is an escaped `$`.
      const dollar_span2 = next._0.span;
      if (RulePart.is_pattern(part)) {
        span_dollar_dollar_or_metavar_in_the_lhs_err(sess, TokenC.new(TokenKind.Dollar, dollar_span2));
      } else {
        maybe_emit_macro_metavar_expr_feature(features, sess, dollar_span2);
      }
      return TokenTree.token(TokenKind.Dollar, dollar_span2);
    }

    if (next !== undefined && next.$ === "Token") {
      // `tree` is followed by some other token. This is an error.
      const token = next._0;
      const msg = `expected identifier, found \`${token_to_string(token)}\``;
      sess.dcx().span_err(token.span, msg);
      return { $: "MetaVar", _0: token.span, _1: Ident.dummy() };
    }

    // There are no more tokens. Just return the `$` we already have.
    return TokenTree.token(TokenKind.Dollar, dollar_span);
  }

  if (tree.$ === "Token") {
    // `tree` is an arbitrary token. Keep it.
    return { $: "Token", _0: clone_Token(tree._0) };
  }

  // `tree` is the beginning of a delimited set of tokens (e.g., `(` or `{`). We need to
  // descend into the delimited set and further parse it.
  const span = clone_DelimSpan(tree._0);
  const spacing = clone_DelimSpacing(tree._1);
  const delim = tree._2;
  const tts = tree._3;
  const delimited: Delimited = { delim, tts: parse(tts, part, sess, node_id, features, edition) };
  return { $: "Delimited", _0: span, _1: spacing, _2: delimited };
}

/// Takes a token and returns `Some(KleeneOp)` if the token is `+` `*` or `?`. Otherwise, return
/// `None`.
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:397 kleene_op
function kleene_op(token: Token): KleeneOp | undefined {
  switch (token.kind.$) {
    case "Star":
      return KleeneOp.ZeroOrMore;
    case "Plus":
      return KleeneOp.OneOrMore;
    case "Question":
      return KleeneOp.ZeroOrOne;
    default:
      return undefined;
  }
}

/// Parse the next token tree of the input looking for a KleeneOp. Returns
///
/// - Ok(Ok((op, span))) if the next token tree is a KleeneOp
/// - Ok(Err(tok, span)) if the next token tree is a token but not a KleeneOp
/// - Err(span) if the next token tree is not a token
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:411 parse_kleene_op
function parse_kleene_op(iter: TokenStreamIter, span: Span): Result<Result<[KleeneOp, Span], Token>, Span> {
  const tree = iter.next();
  if (tree !== undefined && tree.$ === "Token") {
    const token = tree._0;
    const op = kleene_op(token);
    if (op !== undefined) {
      return Ok(Ok([op, token.span]));
    } else {
      return Ok(Err(clone_Token(token)));
    }
  }
  return Err(tree === undefined ? span : tokenstream.TokenTree.span(tree));
}

/// Attempt to parse a single Kleene star, possibly with a separator.
///
/// For example, in a pattern such as `$(a),*`, `a` is the pattern to be repeated, `,` is the
/// separator, and `*` is the Kleene operator. This function is specifically concerned with parsing
/// the last two tokens of such a pattern: namely, the optional separator and the Kleene operator
/// itself. Note that here we are parsing the _macro_ itself, rather than trying to match some
/// stream of tokens in an invocation of a macro.
///
/// This function will take some input iterator `iter` corresponding to `span` and a parsing
/// session `sess`. If the next one (or possibly two) tokens in `iter` correspond to a Kleene
/// operator and separator, then a tuple with `(separator, KleeneOp)` is returned. Otherwise, an
/// error with the appropriate span is emitted to `sess` and a dummy value is returned.
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:436 parse_sep_and_kleene_op
function parse_sep_and_kleene_op(iter: TokenStreamIter, span_: Span, sess: Session): [Token | undefined, KleeneToken] {
  // We basically look at two token trees here, denoted as #1 and #2 below
  let span: Span;
  const r1 = parse_kleene_op(iter, span_);
  if (r1.$ === "Ok" && r1._0.$ === "Ok") {
    // #1 is a `?`, `+`, or `*` KleeneOp
    const [op, span1] = r1._0._0;
    return [undefined, KleeneToken.new(op, span1)];
  } else if (r1.$ === "Ok") {
    // #1 is a separator followed by #2, a KleeneOp
    const token = r1._0._0 as Token;
    const r2 = parse_kleene_op(iter, token.span);
    if (r2.$ === "Ok" && r2._0.$ === "Ok" && r2._0._0[0] === "ZeroOrOne") {
      // #2 is the `?` Kleene op, which does not take a separator (error)
      const span2 = r2._0._0[1];
      // Error!
      sess.dcx().span_err(token.span, "the `?` macro repetition operator does not take a separator");

      // Return a dummy
      return [undefined, KleeneToken.new(KleeneOp.ZeroOrMore, span2)];
    } else if (r2.$ === "Ok" && r2._0.$ === "Ok") {
      // #2 is a KleeneOp :D
      const [op, span2] = r2._0._0;
      return [token, KleeneToken.new(op, span2)];
    } else if (r2.$ === "Ok") {
      // #2 is a random token or not a token at all :(
      span = (r2._0._0 as Token).span;
    } else {
      span = r2._0;
    }
  } else {
    // #1 is not a token
    span = r1._0;
  }

  // If we ever get to this point, we have experienced an "unexpected token" error
  sess.dcx().span_err(span, "expected one of: `*`, `+`, or `?`");

  // Return a dummy
  return [undefined, KleeneToken.new(KleeneOp.ZeroOrMore, span)];
}

// `$$` or a meta-variable is the lhs of a macro but shouldn't.
//
// For example, `macro_rules! foo { ( ${len()} ) => {} }`
// rustc: compiler/rustc_expand/src/mbe/quoted.rs:481 span_dollar_dollar_or_metavar_in_the_lhs_err
function span_dollar_dollar_or_metavar_in_the_lhs_err(sess: Session, token: Token): void {
  sess.dcx().span_err(token.span, `unexpected token: ${token_to_string(token)}`);
  sess.dcx().span_note(token.span, "`$$` and meta-variable expressions are not allowed inside macro parameter definitions");
}
