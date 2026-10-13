// Port of compiler/rustc_expand/src/mbe/metavar_expr.rs
//
// Derives: `Debug` hand-written below; `PartialEq` unused by ported code; `Encodable`/`Decodable` (metadata,
// out of scope until M5) not ported.

import { ast, token, type tokenstream } from "../../rustc_ast/lib.ts";
import type { IdentKind, Token } from "../../rustc_ast/token.ts";
import { type TokenStream, TokenStreamIter, TokenTree } from "../../rustc_ast/tokenstream.ts";
import "../../rustc_ast/util/literal.ts";
import { token_to_string } from "../../rustc_ast_pretty/pprust/mod.ts";
import { Applicability, type Diag, type DiagCtxtHandle, type PResult } from "../../rustc_errors/lib.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { Span } from "../../rustc_span/lib.ts";
import { debug_Ident, debug_Symbol, display_Ident, display_Symbol, type Ident, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_int, debug_list, debug_tuple } from "../../std/fmt.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { type MveExtraTokens, MveExtraTokens_diagnostic, type MveMissingParen, MveMissingParen_diagnostic, type MveUnrecognizedExpr, MveUnrecognizedExpr_diagnostic, default_MveExtraTokens } from "../diagnostics.ts";


const { TokenKind_eq } = token;

export const UNSUPPORTED_CONCAT_ELEM_ERR: string = "expected identifier or string literal";

/// A meta-variable expression, for expansions based on properties of meta-variables.
// rustc-type: compiler/rustc_expand/src/mbe/metavar_expr.rs:16 MetaVarExpr
export type MetaVarExpr =
  /// Unification of two or more identifiers/literals/metavariables into an identifier.
  | { readonly $: "ConcatIdent"; _0: MetaVarExprConcatElem[] }
  /// Unification of two or more identifiers/literals/metavariables into a string literal.
  | { readonly $: "ConcatStr"; _0: MetaVarExprConcatElem[] }
  /// The number of repetitions of an identifier.
  | { readonly $: "Count"; _0: Ident; _1: number }
  /// Ignore a meta-variable for repetition without expansion.
  | { readonly $: "Ignore"; _0: Ident }
  /// The index of the repetition at a particular depth, where 0 is the innermost
  /// repetition. The `usize` is the depth.
  | { readonly $: "Index"; _0: number }
  /// The length of the repetition at a particular depth, where 0 is the innermost
  /// repetition. The `usize` is the depth.
  | { readonly $: "Len"; _0: number };
export const debug_MetaVarExpr: Debug<MetaVarExpr> = (v, f) => {
  switch (v.$) {
    case "ConcatIdent":
      return debug_tuple(f, "ConcatIdent", [debug_list(f, v._0.map((e) => debug_MetaVarExprConcatElem(e, f)))]);
    case "ConcatStr":
      return debug_tuple(f, "ConcatStr", [debug_list(f, v._0.map((e) => debug_MetaVarExprConcatElem(e, f)))]);
    case "Count":
      return debug_tuple(f, "Count", [debug_Ident(v._0, f), debug_int(v._1, f)]);
    case "Ignore":
      return debug_tuple(f, "Ignore", [debug_Ident(v._0, f)]);
    case "Index":
      return debug_tuple(f, "Index", [debug_int(v._0, f)]);
    case "Len":
      return debug_tuple(f, "Len", [debug_int(v._0, f)]);
  }
};

// impl MetaVarExpr (methods on the companion, PORTING §8)
export const MetaVarExpr = {
  /// Attempt to parse a meta-variable expression from a token stream.
  // rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:40 parse
  parse(input: TokenStream, outer_span: Span, psess: ParseSess): PResult<MetaVarExpr> {
    let iter = input.iter();
    const r_ident = parse_ident(iter, psess, outer_span);
    if (r_ident.$ === "Err") return r_ident;
    const ident = r_ident._0;
    const next = iter.next();
    if (!(next !== undefined && next.$ === "Delimited" && next._2.$ === "Parenthesis")) {
      // No `()`; wrong or no delimiters. Point at a problematic span or a place to
      // add parens if it makes sense.
      let unexpected_span: Span | undefined;
      let insert_span: Span | undefined;
      if (next !== undefined && next.$ === "Delimited") {
        [unexpected_span, insert_span] = [undefined, undefined];
      } else if (next !== undefined) {
        [unexpected_span, insert_span] = [TokenTree.span(next), undefined];
      } else {
        [unexpected_span, insert_span] = [undefined, Span.shrink_to_hi(ident.span)];
      }
      const err: MveMissingParen = {
        ident_span: ident.span,
        unexpected_span,
        insert_span,
      };
      return Err(psess.dcx().create_err(MveMissingParen_diagnostic(err)));
    }
    const args = next._3;

    // Ensure there are no trailing tokens in the braces, e.g. `${foo() extra}`
    if (iter.peek() !== undefined) {
      const span = iter_span(iter);
      if (span === undefined) panic("checked is_some above");
      const err: MveExtraTokens = {
        ...default_MveExtraTokens(),
        span,
        ident_span: ident.span,
        extra_count: iter_count(iter),
      };
      return Err(psess.dcx().create_err(MveExtraTokens_diagnostic(err)));
    }

    iter = args.iter();
    let rslt: MetaVarExpr;
    switch (ident.name) {
      case sym.concat: {
        const r = parse_concat(iter, psess, outer_span, ident.span);
        if (r.$ === "Err") return r;
        rslt = { $: "ConcatIdent", _0: r._0 };
        break;
      }
      case sym.concat_str: {
        const r = parse_concat(iter, psess, outer_span, ident.span);
        if (r.$ === "Err") return r;
        rslt = { $: "ConcatStr", _0: r._0 };
        break;
      }
      case sym.count: {
        const r = parse_count(iter, psess, ident.span);
        if (r.$ === "Err") return r;
        rslt = r._0;
        break;
      }
      case sym.ignore: {
        const r1 = eat_dollar(iter, psess, ident.span);
        if (r1.$ === "Err") return r1;
        const r2 = parse_ident(iter, psess, ident.span);
        if (r2.$ === "Err") return r2;
        rslt = { $: "Ignore", _0: r2._0 };
        break;
      }
      case sym.index: {
        const r = parse_depth(iter, psess, ident.span);
        if (r.$ === "Err") return r;
        rslt = { $: "Index", _0: r._0 };
        break;
      }
      case sym.len: {
        const r = parse_depth(iter, psess, ident.span);
        if (r.$ === "Err") return r;
        rslt = { $: "Len", _0: r._0 };
        break;
      }
      default: {
        const err: MveUnrecognizedExpr = {
          span: ident.span,
          valid_expr_list: "`count`, `ignore`, `index`, `len`, and `concat`",
        };
        return Err(psess.dcx().create_err(MveUnrecognizedExpr_diagnostic(err)));
      }
    }
    const r = check_trailing_tokens(iter, psess, ident);
    if (r.$ === "Err") return r;
    return Ok(rslt);
  },

  // rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:103 for_each_metavar
  for_each_metavar<A>(self: MetaVarExpr, aux: A, cb: (aux: A, ident: Ident) => A): A {
    switch (self.$) {
      case "ConcatIdent":
      case "ConcatStr": {
        for (const elem of self._0) {
          if (elem.$ === "Var") {
            aux = cb(aux, elem._0);
          }
        }
        return aux;
      }
      case "Count":
      case "Ignore":
        return cb(aux, self._0);
      case "Index":
      case "Len":
        return aux;
    }
  },
};

/** `Iterator::count` on a `TokenStreamIter` (consumes it). */
function iter_count(iter: TokenStreamIter): number {
  let n = 0;
  while (iter.next() !== undefined) n++;
  return n;
}

/// Checks if there are any remaining tokens (for example, `${ignore($valid, extra)}`) and create
/// a diag with the correct arg count if so.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:121 check_trailing_tokens
function check_trailing_tokens(iter: TokenStreamIter, psess: ParseSess, ident: Ident): PResult<undefined> {
  if (iter.peek() === undefined) {
    // All tokens consumed, as expected
    return Ok(undefined);
  }

  // `None` for max indicates the arg count must be exact, `Some` indicates a range is accepted.
  let min_or_exact_args: number;
  let max_args: number | undefined;
  switch (ident.name) {
    case sym.concat:
      return panic("concat takes unlimited tokens but didn't eat them all");
    case sym.ignore:
      [min_or_exact_args, max_args] = [1, undefined];
      break;
    // 1 or 2 args
    case sym.count:
      [min_or_exact_args, max_args] = [1, 2];
      break;
    // 0 or 1 arg
    case sym.index:
    case sym.len:
      [min_or_exact_args, max_args] = [0, 1];
      break;
    default:
      return unreachable(`internal error: entered unreachable code: unknown MVEs should be rejected earlier (got \`${display_Symbol(ident.name)}\`)`);
  }

  const span = iter_span(iter);
  if (span === undefined) panic("checked is_none above");
  const err: MveExtraTokens = {
    span,
    ident_span: ident.span,
    extra_count: iter_count(iter),

    exact_args_note: max_args !== undefined ? undefined : null,
    range_args_note: max_args !== undefined ? null : undefined,
    min_or_exact_args,
    max_args: max_args ?? 0,
    name: display_Ident(ident),
  };
  return Err(psess.dcx().create_err(MveExtraTokens_diagnostic(err)));
}

/// Returns a span encompassing all tokens in the iterator if there is at least one item.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:157 iter_span
function iter_span(iter_: TokenStreamIter): Span | undefined {
  const iter = iter_.clone(); // cloning is cheap
  const first = iter.next();
  if (first === undefined) return undefined;
  const first_sp = TokenTree.span(first);
  let last: tokenstream.TokenTree | undefined;
  for (let tt = iter.next(); tt !== undefined; tt = iter.next()) last = tt;
  const last_sp = last !== undefined ? TokenTree.span(last) : first_sp;
  const span = Span.with_hi(first_sp, Span.hi(last_sp));
  return span;
}

/// Indicates what is placed in a `concat` parameter. For example, literals
/// (`${concat("foo", "bar")}`) or adhoc identifiers (`${concat(foo, bar)}`).
// rustc-type: compiler/rustc_expand/src/mbe/metavar_expr.rs:168 MetaVarExprConcatElem
export type MetaVarExprConcatElem =
  /// Identifier WITHOUT a preceding dollar sign, which means that this identifier should be
  /// interpreted as a literal.
  | { readonly $: "Ident"; _0: Ident }
  /// For example, a number or a string.
  | { readonly $: "Literal"; _0: Symbol }
  /// Identifier WITH a preceding dollar sign, which means that this identifier should be
  /// expanded and interpreted as a variable.
  | { readonly $: "Var"; _0: Ident };
export const debug_MetaVarExprConcatElem: Debug<MetaVarExprConcatElem> = (v, f) => {
  switch (v.$) {
    case "Ident":
      return debug_tuple(f, "Ident", [debug_Ident(v._0, f)]);
    case "Literal":
      return debug_tuple(f, "Literal", [debug_Symbol(v._0, f)]);
    case "Var":
      return debug_tuple(f, "Var", [debug_Ident(v._0, f)]);
  }
};

/// Parse a meta-variable `concat` expression: `concat($metavar, ident, ...)`.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:180 parse_concat
function parse_concat(
  iter: TokenStreamIter,
  psess: ParseSess,
  outer_span: Span,
  expr_ident_span: Span,
): PResult<MetaVarExprConcatElem[]> {
  const result: MetaVarExprConcatElem[] = [];
  for (;;) {
    const is_var = try_eat_dollar(iter);
    const r_token = parse_token(iter, psess, outer_span);
    if (r_token.$ === "Err") return r_token;
    const token_ = r_token._0;
    let element: MetaVarExprConcatElem;
    if (is_var) {
      const r = parse_ident_from_token(psess, token_);
      if (r.$ === "Err") return r;
      element = { $: "Var", _0: r._0 };
    } else if (token_.kind.$ === "Literal" && token_.kind._0.kind.$ === "Str" && token_.kind._0.suffix === undefined) {
      const symbol = token_.kind._0.symbol;
      element = { $: "Literal", _0: symbol };
    } else {
      const r = parse_ident_from_token(psess, token_);
      if (r.$ === "Err") {
        const err = r._0;
        // FIXME: Canceling this error means we emit a worse message when encountering
        //        raw identifiers (`r#ident`). However, we also don't want to forward
        //        (the current version of) this error as is since we also want to
        //        mentioning string literals as a valid token kind.
        err.cancel();
        return Err(psess.dcx().struct_span_err(token_.span, UNSUPPORTED_CONCAT_ELEM_ERR));
      } else {
        element = { $: "Ident", _0: r._0 };
      }
    }
    result.push(element);
    if (iter.peek() === undefined) {
      break;
    }
    if (!try_eat_comma(iter)) {
      return Err(psess.dcx().struct_span_err(outer_span, "expected comma"));
    }
  }
  if (result.length < 2) {
    return Err(psess.dcx().struct_span_err(expr_ident_span, "`concat` must have at least two elements"));
  }
  return Ok(result);
}

/// Parse a meta-variable `count` expression: `count(ident[, depth])`
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:228 parse_count
function parse_count(iter: TokenStreamIter, psess: ParseSess, span: Span): PResult<MetaVarExpr> {
  const r1 = eat_dollar(iter, psess, span);
  if (r1.$ === "Err") return r1;
  const r2 = parse_ident(iter, psess, span);
  if (r2.$ === "Err") return r2;
  const ident = r2._0;
  let depth: number;
  if (try_eat_comma(iter)) {
    if (iter.peek() === undefined) {
      return Err(
        psess.dcx().struct_span_err(span, "`count` followed by a comma must have an associated index indicating its depth"),
      );
    }
    const r = parse_depth(iter, psess, span);
    if (r.$ === "Err") return r;
    depth = r._0;
  } else {
    depth = 0;
  }
  return Ok({ $: "Count", _0: ident, _1: depth });
}

/// Parses the depth used by index(depth) and len(depth).
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:250 parse_depth
function parse_depth(iter: TokenStreamIter, psess: ParseSess, span: Span): PResult<number> {
  const tt = iter.next();
  if (tt === undefined) return Ok(0);
  if (!(tt.$ === "Token" && tt._0.kind.$ === "Literal")) {
    return Err(psess.dcx().struct_span_err(span, "meta-variable expression depth must be a literal"));
  }
  const lit = tt._0.kind._0;
  const lit_kind = ast.LitKind.from_token_lit(lit);
  if (lit_kind.$ === "Ok" && lit_kind._0.$ === "Int" && lit_kind._0._1.$ === "Unsuffixed" && lit_kind._0._0 <= USIZE_MAX) {
    const n_u128 = lit_kind._0._0;
    // PORT: `usize` depth as a JS number; a depth above 2^53 (still a valid `usize`) cannot be
    // represented exactly, so it stops instead of guessing.
    if (n_u128 > BigInt(Number.MAX_SAFE_INTEGER)) unported("rustc_expand::mbe::metavar_expr::parse_depth (usize > 2^53)");
    const n_usize = Number(n_u128);
    return Ok(n_usize);
  } else {
    const msg = "only unsuffixes integer literals are supported in meta-variable expressions";
    return Err(psess.dcx().struct_span_err(span, msg));
  }
}
// PORT: `usize::try_from(u128)` on a 64-bit target (the oracle hosts are 64-bit).
const USIZE_MAX = (1n << 64n) - 1n;

/// Parses an generic ident
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:273 parse_ident
function parse_ident(iter: TokenStreamIter, psess: ParseSess, fallback_span: Span): PResult<Ident> {
  const token_ = parse_token(iter, psess, fallback_span);
  if (token_.$ === "Err") return token_;
  return parse_ident_from_token(psess, token_._0);
}

// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:282 parse_ident_from_token
function parse_ident_from_token(psess: ParseSess, token_: Token): PResult<Ident> {
  const id = token_.ident();
  if (id !== undefined) {
    const [elem, kind] = id;
    const r = validate_ident_kind(psess.dcx(), kind, elem.span);
    if (r.$ === "Err") return r;
    return Ok(elem);
  }
  const token_str = token_to_string(token_);
  const err: Diag = psess.dcx().struct_span_err(token_.span, `expected identifier, found \`${token_str}\``);
  err.span_suggestion_short(token_.span, `try removing \`${token_str}\``, "", Applicability.MaybeIncorrect);
  return Err(err);
}

// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:303 parse_token
function parse_token(iter: TokenStreamIter, psess: ParseSess, fallback_span: Span): PResult<Token> {
  const tt = iter.next();
  if (tt === undefined) {
    return Err(psess.dcx().struct_span_err(fallback_span, UNSUPPORTED_CONCAT_ELEM_ERR));
  }
  if (tt.$ !== "Token") {
    return Err(psess.dcx().struct_span_err(TokenTree.span(tt), UNSUPPORTED_CONCAT_ELEM_ERR));
  }
  const token_ = tt._0;
  return Ok(token_);
}

/// Tries to move the iterator forward returning `true` if there is a comma. If not, then the
/// iterator is not modified and the result is `false`.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:319 try_eat_comma
function try_eat_comma(iter: TokenStreamIter): boolean {
  const p = iter.peek();
  if (p !== undefined && p.$ === "Token" && TokenKind_eq(p._0.kind, token.TokenKind.Comma)) {
    void iter.next();
    return true;
  }
  return false;
}

/// Tries to move the iterator forward returning `true` if there is a dollar sign. If not, then the
/// iterator is not modified and the result is `false`.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:329 try_eat_dollar
function try_eat_dollar(iter: TokenStreamIter): boolean {
  const p = iter.peek();
  if (p !== undefined && p.$ === "Token" && TokenKind_eq(p._0.kind, token.TokenKind.Dollar)) {
    void iter.next();
    return true;
  }
  return false;
}

/// Expects that the next item is a dollar sign.
// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:338 eat_dollar
function eat_dollar(iter: TokenStreamIter, psess: ParseSess, span: Span): PResult<undefined> {
  if (try_eat_dollar(iter)) {
    return Ok(undefined);
  }
  return Err(
    psess
      .dcx()
      .struct_span_err(span, "meta-variables within meta-variable expressions must be referenced using a dollar sign"),
  );
}

// rustc: compiler/rustc_expand/src/mbe/metavar_expr.rs:352 validate_ident_kind
export function validate_ident_kind(dcx: DiagCtxtHandle, kind: IdentKind, span: Span): PResult<undefined> {
  let kind_: string;
  switch (kind) {
    case "Normal":
      return Ok(undefined);
    case "Raw":
      kind_ = "raw identifiers";
      break;
    case "ForcedKeyword":
      kind_ = "forced keywords";
      break;
  }
  return Err(dcx.struct_span_err(span, `\`\${concat(..)}\` currently does not support ${kind_}`));
}
