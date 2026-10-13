// Port of compiler/rustc_expand/src/mbe.rs
//! This module implements declarative macros: old `macro_rules` and the newer
//! `macro`. Declarative macros are also known as "macro by example", and that's
//! why we call this module `mbe`. For external documentation, prefer the
//! official terminology: "declarative macros".
//
// PORT: the private `mod` declarations (`diagnostics`, `macro_rules`, `macro_check`, `macro_parser`,
// `metavar_expr`, `quoted`, `transcribe`) have no TS counterpart here: every file under `./mbe/`
// imports what it uses directly, and this module does not import them (no init-order cycle).
// `use metavar_expr::MetaVarExpr;` is re-exported below because sibling files name it as
// `crate::mbe::MetaVarExpr`.
//
// Derives: `PartialEq` (unused by the ported code; no `_eq` helpers), `Encodable`/`Decodable`
// (metadata, out of scope until M5) are not ported. `Debug` is hand-written (`debug_<Type>`).

import { token, tokenstream } from "../rustc_ast/lib.ts";
import type { Delimiter, NonterminalKind, Token, TokenKind } from "../rustc_ast/token.ts";
import type { DelimSpacing, DelimSpan } from "../rustc_ast/tokenstream.ts";
import { debug_Span, type Span } from "../rustc_span/lib.ts";
import { debug_Ident, type Ident } from "../rustc_span/symbol.ts";
import { type Debug, debug_int, debug_option, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { debug_MetaVarExpr, type MetaVarExpr } from "./mbe/metavar_expr.ts";

export { debug_MetaVarExpr, MetaVarExpr } from "./mbe/metavar_expr.ts";

const { debug_Delimiter, debug_NonterminalKind, debug_Token, TokenKind_eq } = token;
const { debug_DelimSpacing, debug_DelimSpan } = tokenstream;

/// Contains the sub-token-trees of a "delimited" token tree such as `(a b c)`.
/// The delimiters are not represented explicitly in the `tts` vector.
// rustc-type: compiler/rustc_expand/src/mbe.rs:24 Delimited
export interface Delimited {
  delim: Delimiter;
  /// FIXME: #67062 has details about why this is sub-optimal.
  tts: TokenTree[];
}
export const debug_Delimited: Debug<Delimited> = (v, f) =>
  debug_struct(f, "Delimited", [
    ["delim", debug_Delimiter(v.delim, f)],
    ["tts", debug_vec(v.tts, f, debug_TokenTree)],
  ]);

// rustc-type: compiler/rustc_expand/src/mbe.rs:31 SequenceRepetition
export interface SequenceRepetition {
  /// The sequence of token trees
  tts: TokenTree[];
  /// The optional separator
  separator: Token | undefined;
  /// Whether the sequence can be repeated zero (*), or one or more times (+)
  kleene: KleeneToken;
  /// The number of `Match`s that appear in the sequence (and subsequences)
  num_captures: number;
}
export const debug_SequenceRepetition: Debug<SequenceRepetition> = (v, f) =>
  debug_struct(f, "SequenceRepetition", [
    ["tts", debug_vec(v.tts, f, debug_TokenTree)],
    ["separator", debug_option(v.separator, f, debug_Token)],
    ["kleene", debug_KleeneToken(v.kleene, f)],
    ["num_captures", debug_int(v.num_captures, f)],
  ]);

// PORT: `Copy` struct of two `Copy` scalars: an immutable class, shared freely.
// rustc-type: compiler/rustc_expand/src/mbe.rs:43 KleeneToken
export class KleeneToken {
  constructor(
    public readonly span: Span,
    public readonly op: KleeneOp,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe.rs:49 new
  static new(op: KleeneOp, span: Span): KleeneToken {
    return new KleeneToken(span, op);
  }
}
export const debug_KleeneToken: Debug<KleeneToken> = (v, f) =>
  debug_struct(f, "KleeneToken", [
    ["span", debug_Span(v.span, f)],
    ["op", debug_KleeneOp(v.op, f)],
  ]);

/// A Kleene-style [repetition operator](https://en.wikipedia.org/wiki/Kleene_star)
/// for token sequences.
// rustc-type: compiler/rustc_expand/src/mbe.rs:57 KleeneOp
export type KleeneOp =
  /// Kleene star (`*`) for zero or more repetitions
  | "ZeroOrMore"
  /// Kleene plus (`+`) for one or more repetitions
  | "OneOrMore"
  /// Kleene optional (`?`) for zero or one repetitions
  | "ZeroOrOne";
export const KleeneOp = { ZeroOrMore: "ZeroOrMore", OneOrMore: "OneOrMore", ZeroOrOne: "ZeroOrOne" } as const;
export const debug_KleeneOp: Debug<KleeneOp> = (v) => v;

/// Similar to `tokenstream::TokenTree`, except that `Sequence`, `MetaVar`, `MetaVarDecl`, and
/// `MetaVarExpr` are "first-class" token trees. Useful for parsing macros.
// rustc-type: compiler/rustc_expand/src/mbe.rs:69 TokenTree
export type TokenTree =
  /// A token. Unlike `tokenstream::TokenTree::Token` this lacks a `Spacing`.
  /// See the comments about `Spacing` in the `transcribe` function.
  | { readonly $: "Token"; _0: Token }
  /// A delimited sequence, e.g. `($e:expr)` (RHS) or `{ $e }` (LHS).
  | { readonly $: "Delimited"; _0: DelimSpan; _1: DelimSpacing; _2: Delimited }
  /// A kleene-style repetition sequence, e.g. `$($e:expr)*` (RHS) or `$($e),*` (LHS).
  | { readonly $: "Sequence"; _0: DelimSpan; _1: SequenceRepetition }
  /// e.g., `$var`. The span covers the leading dollar and the ident. (The span within the ident
  /// only covers the ident, e.g. `var`.)
  | { readonly $: "MetaVar"; _0: Span; _1: Ident }
  /// e.g., `$var:expr`. Only appears on the LHS.
  | {
      readonly $: "MetaVarDecl";
      span: Span;
      /// Name to bind.
      name: Ident;
      /// The fragment specifier.
      kind: NonterminalKind;
    }
  /// A meta-variable expression inside `${...}`.
  | { readonly $: "MetaVarExpr"; _0: DelimSpan; _1: MetaVarExpr };
export const debug_TokenTree: Debug<TokenTree> = (v, f) => {
  switch (v.$) {
    case "Token":
      return debug_tuple(f, "Token", [debug_Token(v._0, f)]);
    case "Delimited":
      return debug_tuple(f, "Delimited", [debug_DelimSpan(v._0, f), debug_DelimSpacing(v._1, f), debug_Delimited(v._2, f)]);
    case "Sequence":
      return debug_tuple(f, "Sequence", [debug_DelimSpan(v._0, f), debug_SequenceRepetition(v._1, f)]);
    case "MetaVar":
      return debug_tuple(f, "MetaVar", [debug_Span(v._0, f), debug_Ident(v._1, f)]);
    case "MetaVarDecl":
      return debug_struct(f, "MetaVarDecl", [
        ["span", debug_Span(v.span, f)],
        ["name", debug_Ident(v.name, f)],
        ["kind", debug_NonterminalKind(v.kind, f)],
      ]);
    case "MetaVarExpr":
      return debug_tuple(f, "MetaVarExpr", [debug_DelimSpan(v._0, f), debug_MetaVarExpr(v._1, f)]);
  }
};

// impl TokenTree (methods on the companion, PORTING §8)
export const TokenTree = {
  /// Returns `true` if the given token tree is delimited.
  // rustc: compiler/rustc_expand/src/mbe.rs:94 is_delimited
  is_delimited(self: TokenTree): boolean {
    return self.$ === "Delimited";
  },

  /// Returns `true` if the given token tree is a token of the given kind.
  // rustc: compiler/rustc_expand/src/mbe.rs:99 is_token
  is_token(self: TokenTree, expected_kind: TokenKind): boolean {
    switch (self.$) {
      case "Token":
        return TokenKind_eq(self._0.kind, expected_kind);
      default:
        return false;
    }
  },

  /// Retrieves the `TokenTree`'s span.
  // rustc: compiler/rustc_expand/src/mbe.rs:107 span
  span(self: TokenTree): Span {
    switch (self.$) {
      case "Token":
        return self._0.span;
      case "MetaVar":
        return self._0;
      case "MetaVarDecl":
        return self.span;
      case "Delimited":
      case "MetaVarExpr":
      case "Sequence":
        return self._0.entire();
    }
  },

  // rustc: compiler/rustc_expand/src/mbe.rs:118 token
  token(kind: TokenKind, span: Span): TokenTree {
    return { $: "Token", _0: token.Token.new(kind, span) };
  },

  // Used only in diagnostics.
  // rustc: compiler/rustc_expand/src/mbe.rs:123 meta_vars
  meta_vars(self: TokenTree, vars: Ident[]): void {
    switch (self.$) {
      case "Token":
        break;
      case "MetaVar":
        vars.push(self._1);
        break;
      case "MetaVarDecl":
        vars.push(self.name);
        break;
      case "Delimited":
        for (const tt of self._2.tts) {
          TokenTree.meta_vars(tt, vars);
        }
        break;
      case "Sequence":
        for (const tt of self._1.tts) {
          TokenTree.meta_vars(tt, vars);
        }
        break;
      case "MetaVarExpr":
        break;
    }
  },
};
