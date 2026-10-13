// Port of compiler/rustc_parse/src/parser/pat.rs
// Types (`Expected`, `RecoverComma`, `RecoverColon`, `CommaRecoveryMode`, `EatOrResult`,
// `PatternLocation`) are generated into pat.gen.ts.
import { HasAttrs, HasTokens, ast, mut_visit, token, visit } from "../../rustc_ast/lib.ts";
import type {
  Arm,
  AttrVec,
  BindingMode as BindingModeT,
  Expr,
  ExprKind,
  Pat,
  PatField,
  PatFieldsRest,
  PatKind,
  Path,
  QSelf,
  RangeEnd,
  Stmt,
  Ty,
} from "../../rustc_ast/lib.ts";
import type { MetaVarKind, Token } from "../../rustc_ast/token.ts";
import { ExprPrecedence_discriminant } from "../../rustc_ast/util/parser.gen.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { number_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { IntoDiagArg } from "../../rustc_error_messages/lib.ts";
import type { Diag, PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { BytePos, type ErrorGuaranteed, Span, type Spanned, respan } from "../../rustc_span/lib.ts";
import { Ident, display_Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { ExprParenthesesNeeded } from "../diagnostics.ts";
import { UsePreAttrPos } from "./attr_wrapper.gen.ts";
import { RecoverQPath } from "./diagnostics.ts";
import { could_be_unclosed_char_literal, mk_token_lit_char } from "./expr.ts";
import { ForceCollect, Parser, Restrictions, Trailing, token_descr } from "./mod.ts";
import { PathStyle } from "./path.gen.ts";
import * as gen from "./pat.gen.ts";
import { CommaRecoveryMode, EatOrResult, PatternLocation, RecoverColon, RecoverComma } from "./pat.gen.ts";
import { exp } from "./token_type.ts";

export * from "./pat.gen.ts";

const { TokenKind: TK } = token;
const { BindingMode, PatKind: PatKindC, PatFieldsRest: PatFieldsRestC } = ast;

export type Expected = gen.Expected;
export const Expected = {
  ...gen.Expected,

  // FIXME(#100717): migrate users of this to proper localization
  // rustc: compiler/rustc_parse/src/parser/pat.rs:44 to_string_or_fallback
  to_string_or_fallback(expected: Expected | undefined): string {
    switch (expected) {
      case "ParameterName":
        return "parameter name";
      case "ArgumentName":
        return "argument name";
      case "Identifier":
        return "identifier";
      case "BindingPattern":
        return "binding pattern";
      case undefined:
        return "pattern";
    }
  },
};

const WHILE_PARSING_OR_MSG = "while parsing this or-pattern starting here";

// ---- impl<'a> Parser<'a> ----

/// Parses a pattern.
///
/// Corresponds to `Pattern` in RFC 3637 and admits guard patterns at the top level.
/// Used when parsing patterns in all cases where neither `PatternNoTopGuard` nor
/// `PatternNoTopAlt` (see below) are used.
// rustc: compiler/rustc_parse/src/parser/pat.rs:103 parse_pat_allow_top_guard
Parser.prototype.parse_pat_allow_top_guard = function (
  this: Parser,
  expected: Expected | undefined,
  rc: RecoverComma,
  ra: RecoverColon,
  rt: CommaRecoveryMode,
): PResult<Pat> {
  const r = this.parse_pat_no_top_guard(expected, rc, ra, rt);
  if (r.$ === "Err") return r;
  const pat = r._0;

  if (this.eat_keyword(exp.If)) {
    let guard: ast.Guard;
    const g = this.eat_metavar_guard();
    if (g !== undefined) {
      guard = g;
    } else {
      const leading_if_span = this.prev_token.span;
      const rc_ = this.parse_expr();
      if (rc_.$ === "Err") return rc_;
      const cond = rc_._0;
      const cond_span = cond.span;
      guard = new ast.Guard(cond, Span.to(leading_if_span, cond_span));
    }

    // Feature-gate guard patterns
    this.psess.gated_spans.gate(sym.guard_patterns, guard.span());
    const span = Span.to(pat.span, guard.span());
    return Ok(this.mk_pat(span, { $: "Guard", _0: pat, _1: guard }));
  } else {
    return Ok(pat);
  }
};

/// Parses a pattern.
///
/// Corresponds to `PatternNoTopAlt` in RFC 3637 and does not admit or-patterns
/// or guard patterns at the top level. Used when parsing the parameters of lambda
/// expressions, functions, function pointers, and `pat_param` macro fragments.
// rustc: compiler/rustc_parse/src/parser/pat.rs:136 parse_pat_no_top_alt
Parser.prototype.parse_pat_no_top_alt = function (
  this: Parser,
  expected: Expected | undefined,
  syntax_loc: PatternLocation | undefined,
): PResult<Pat> {
  return this.parse_pat_with_range_pat(true, expected, syntax_loc);
};

/// Parses a pattern.
///
/// Corresponds to `PatternNoTopGuard` in RFC 3637 and allows or-patterns, but not
/// guard patterns, at the top level. Used for parsing patterns in `pat` fragments (until
/// the next edition) and `let`, `if let`, and `while let` expressions.
///
/// Note that after the FCP in <https://github.com/rust-lang/rust/issues/81415>,
/// a leading vert is allowed in nested or-patterns, too. This allows us to
/// simplify the grammar somewhat.
// rustc: compiler/rustc_parse/src/parser/pat.rs:153 parse_pat_no_top_guard
Parser.prototype.parse_pat_no_top_guard = function (
  this: Parser,
  expected: Expected | undefined,
  rc: RecoverComma,
  ra: RecoverColon,
  rt: CommaRecoveryMode,
): PResult<Pat> {
  const r = this.parse_pat_no_top_guard_inner(expected, rc, ra, rt, undefined);
  if (r.$ === "Err") return r;
  return Ok(r._0[0]);
};

/// Returns the pattern and a bool indicating whether we recovered from a trailing vert (true =
/// recovered).
// rustc: compiler/rustc_parse/src/parser/pat.rs:165 parse_pat_no_top_guard_inner
Parser.prototype.parse_pat_no_top_guard_inner = function (
  this: Parser,
  expected: Expected | undefined,
  rc: RecoverComma,
  ra: RecoverColon,
  rt: CommaRecoveryMode,
  syntax_loc: PatternLocation | undefined,
): PResult<[Pat, boolean]> {
  // Keep track of whether we recovered from a trailing vert so that we can avoid duplicated
  // suggestions (which bothers rustfix).
  //
  // Allow a '|' before the pats (RFCs 1925, 2530, and 2535).
  let leading_vert_span: Span | undefined;
  let trailing_vert: boolean;
  switch (this.eat_or_separator(undefined)) {
    case "AteOr":
      [leading_vert_span, trailing_vert] = [this.prev_token.span, false];
      break;
    case "TrailingVert":
      [leading_vert_span, trailing_vert] = [undefined, true];
      break;
    case "None":
      [leading_vert_span, trailing_vert] = [undefined, false];
      break;
  }

  // Parse the first pattern (`p_0`).
  let first_pat: Pat;
  const r = this.parse_pat_no_top_alt(expected, syntax_loc);
  if (r.$ === "Ok") {
    first_pat = r._0;
  } else if (this.token.is_reserved_ident() && !this.token.is_keyword(kw.In) && !this.token.is_keyword(kw.If)) {
    const err = r._0;
    err.emit();
    this.bump();
    first_pat = this.mk_pat(this.token.span, PatKindC.Wild);
  } else {
    return r;
  }
  if (rc === RecoverComma.Yes && !first_pat.could_be_never_pattern()) {
    const r2 = this.maybe_recover_unexpected_comma(first_pat.span, rt);
    if (r2.$ === "Err") return r2;
  }

  // If the next token is not a `|`,
  // this is not an or-pattern and we should exit here.
  if (!this.check(exp.Or) && !this.token.eq(TK.OrOr)) {
    // If we parsed a leading `|` which should be gated,
    // then we should really gate the leading `|`.
    // This complicated procedure is done purely for diagnostics UX.

    // Check if the user wrote `foo:bar` instead of `foo::bar`.
    if (ra === RecoverColon.Yes && this.token.kind.$ === "Colon") {
      first_pat = this.recover_colon_colon_in_pat_typo(first_pat, expected);
    }

    if (leading_vert_span !== undefined) {
      // If there was a leading vert, treat this as an or-pattern. This improves
      // diagnostics.
      const span = Span.to(leading_vert_span, this.prev_token.span);
      return Ok([this.mk_pat(span, { $: "Or", _0: [first_pat] }), trailing_vert]);
    }

    return Ok([first_pat, trailing_vert]);
  }

  // Parse the patterns `p_1 | ... | p_n` where `n > 0`.
  const lo = leading_vert_span ?? first_pat.span;
  const pats: Pat[] = [first_pat];
  for (;;) {
    let brk = false;
    switch (this.eat_or_separator(lo)) {
      case "AteOr":
        break;
      case "None":
        brk = true;
        break;
      case "TrailingVert":
        trailing_vert = true;
        brk = true;
        break;
    }
    if (brk) break;
    const rp = this.parse_pat_no_top_alt(expected, syntax_loc);
    if (rp.$ === "Err") {
      const err = rp._0;
      err.span_label(lo, WHILE_PARSING_OR_MSG);
      return Err(err);
    }
    const pat = rp._0;
    if (rc === RecoverComma.Yes && !pat.could_be_never_pattern()) {
      const r3 = this.maybe_recover_unexpected_comma(pat.span, rt);
      if (r3.$ === "Err") return r3;
    }
    pats.push(pat);
  }
  const or_pattern_span = Span.to(lo, this.prev_token.span);

  return Ok([this.mk_pat(or_pattern_span, { $: "Or", _0: pats }), trailing_vert]);
};

/// Parse a pattern and (maybe) a `Colon` in positions where a pattern may be followed by a
/// type annotation (e.g. for `let` bindings or `fn` params).
///
/// Generally, this corresponds to `pat_no_top_alt` followed by an optional `Colon`. It will
/// eat the `Colon` token if one is present.
///
/// The return value represents the parsed pattern and `true` if a `Colon` was parsed (`false`
/// otherwise).
// rustc: compiler/rustc_parse/src/parser/pat.rs:257 parse_pat_before_ty
Parser.prototype.parse_pat_before_ty = function (
  this: Parser,
  expected: Expected | undefined,
  rc: RecoverComma,
  syntax_loc: PatternLocation,
): PResult<[Pat, boolean]> {
  // We use `parse_pat_allow_top_alt` regardless of whether we actually want top-level
  // or-patterns so that we can detect when a user tries to use it. This allows us to print a
  // better error message.
  const r = this.parse_pat_no_top_guard_inner(expected, rc, RecoverColon.No, CommaRecoveryMode.LikelyTuple, syntax_loc);
  if (r.$ === "Err") return r;
  const [pat, trailing_vert] = r._0;
  const colon = this.eat(exp.Colon);

  if (pat.kind.$ === "Or") {
    const pats = pat.kind._0;
    const span = pat.span;
    let sub: diagnostics.TopLevelOrPatternNotAllowedSugg | undefined;
    if (pats.length === 1) {
      const span_ = Span.with_hi(span, BytePos.add(Span.lo(span), BytePos(1)));
      sub = { $: "RemoveLeadingVert", span: span_ };
    } else {
      sub = {
        $: "WrapInParens",
        span,
        suggestion: { lo: Span.shrink_to_lo(span), hi: Span.shrink_to_hi(span) },
      };
    }

    let d: diagnostics.TopLevelOrPatternNotAllowed;
    switch (syntax_loc) {
      case "LetBinding":
        d = { $: "LetBinding", span, sub };
        break;
      case "FunctionParameter":
        d = { $: "FunctionParameter", span, sub };
        break;
    }
    const err = this.dcx().create_err(diagnostics.TopLevelOrPatternNotAllowed_diagnostic(d));
    if (trailing_vert) {
      err.delay_as_bug();
    } else {
      err.emit();
    }
  }

  return Ok([pat, colon]);
};

/// Parse the pattern for a function or function pointer parameter, followed by a colon.
///
/// The return value represents the parsed pattern and `true` if a `Colon` was parsed (`false`
/// otherwise).
// rustc: compiler/rustc_parse/src/parser/pat.rs:310 parse_fn_param_pat_colon
Parser.prototype.parse_fn_param_pat_colon = function (this: Parser): PResult<[Pat, boolean]> {
  // In order to get good UX, we first recover in the case of a leading vert for an illegal
  // top-level or-pat. Normally, this means recovering both `|` and `||`, but in this case,
  // a leading `||` probably doesn't indicate an or-pattern attempt, so we handle that
  // separately.
  if (this.token.kind.$ === "OrOr") {
    this.dcx().emit_err(diagnostics.UnexpectedVertVertBeforeFunctionParam_diagnostic({ span: this.token.span }));
    this.bump();
  }

  return this.parse_pat_before_ty(gen.Expected.ParameterName, RecoverComma.No, PatternLocation.FunctionParameter);
};

/// Eat the or-pattern `|` separator.
/// If instead a `||` token is encountered, recover and pretend we parsed `|`.
// rustc: compiler/rustc_parse/src/parser/pat.rs:329 eat_or_separator
Parser.prototype.eat_or_separator = function (this: Parser, lo: Span | undefined): EatOrResult {
  if (this.recover_trailing_vert(lo)) {
    return EatOrResult.TrailingVert;
  } else if (this.token.kind.$ === "OrOr") {
    // Found `||`; Recover and pretend we parsed `|`.
    this.dcx().emit_err(diagnostics.UnexpectedVertVertInPattern_diagnostic({ span: this.token.span, start: lo }));
    this.bump();
    return EatOrResult.AteOr;
  } else if (this.eat(exp.Or)) {
    return EatOrResult.AteOr;
  } else {
    return EatOrResult.None;
  }
};

/// Recover if `|` or `||` is the current token and we have one of the
/// tokens `=>`, `if`, `=`, `:`, `;`, `,`, `]`, `)`, or `}` ahead of us.
///
/// These tokens all indicate that we reached the end of the or-pattern
/// list and can now reliably say that the `|` was an illegal trailing vert.
/// Note that there are more tokens such as `@` for which we know that the `|`
/// is an illegal parse. However, the user's intent is less clear in that case.
// rustc: compiler/rustc_parse/src/parser/pat.rs:351 recover_trailing_vert
Parser.prototype.recover_trailing_vert = function (this: Parser, lo: Span | undefined): boolean {
  const is_end_ahead = this.look_ahead(1, (token_) => {
    const k = token_.uninterpolate().kind;
    switch (k.$) {
      case "FatArrow": // e.g. `a | => 0,`.
        return true;
      case "Ident": // e.g. `a | if expr`.
        return k._0 === kw.If && (k._1 === "Normal" || k._1 === "ForcedKeyword");
      case "Eq": // e.g. `let a | = 0`.
      case "Semi": // e.g. `let a |;`.
      case "Colon": // e.g. `let a | :`.
      case "Comma": // e.g. `let (a |,)`.
      case "CloseBracket": // e.g. `let [a | ]`.
      case "CloseParen": // e.g. `let (a | )`.
      case "CloseBrace": // e.g. `let A { f: a | }`.
        return true;
      default:
        return false;
    }
  });
  const k = this.token.kind;
  if (is_end_ahead && (k.$ === "Or" || k.$ === "OrOr")) {
    // A `|` or possibly `||` token shouldn't be here. Ban it.
    const token_ = pprust.token_to_string(this.token);
    this.dcx().emit_err(
      diagnostics.TrailingVertNotAllowed_diagnostic({
        span: this.token.span,
        start: lo,
        suggestion: {
          span: Span.with_hi(Span.shrink_to_hi(this.prev_token.span), Span.hi(this.token.span)),
          token: token_,
        },
        token: token_,
        note_double_vert: this.token.kind.$ === "OrOr",
      }),
    );
    this.bump();
    return true;
  } else {
    return false;
  }
};

/// Ensures that the last parsed pattern (or pattern range bound) is not followed by an expression.
///
/// `is_end_bound` indicates whether the last parsed thing was the end bound of a range pattern (see [`parse_pat_range_end`](Self::parse_pat_range_end))
/// in order to say "expected a pattern range bound" instead of "expected a pattern";
/// ```text
/// 0..=1 + 2
///     ^^^^^
/// ```
/// Only the end bound is spanned in this case, and this function has no idea if there was a `..=` before `pat_span`, hence the parameter.
///
/// This function returns `Some` if a trailing expression was recovered, and said expression's span.
// #[must_use = "the pattern must be discarded as `PatKind::Err` if this function returns Some"]
// rustc: compiler/rustc_parse/src/parser/pat.rs:399 maybe_recover_trailing_expr
Parser.prototype.maybe_recover_trailing_expr = function (
  this: Parser,
  pat_span: Span,
  is_end_bound: boolean,
): [ErrorGuaranteed, Span] | undefined {
  if (this.prev_token.is_keyword(kw.Underscore) || !this.may_recover()) {
    // Don't recover anything after an `_` or if recovery is disabled.
    return undefined;
  }

  // Returns `true` iff `token` is an unsuffixed integer.
  const is_one_tuple_index = (_: Parser, token_: Token): boolean => {
    const k = token_.kind;
    return k.$ === "Literal" && k._0.kind.$ === "Integer" && k._0.suffix === undefined;
  };

  // Returns `true` iff `token` is an unsuffixed `x.y` float.
  const is_two_tuple_indexes = (this_: Parser, token_: Token): boolean => {
    const k = token_.kind;
    if (
      k.$ === "Literal" &&
      k._0.kind.$ === "Float" &&
      k._0.suffix === undefined &&
      this_.break_up_float(k._0.symbol, token_.span).$ === "MiddleDot"
    ) {
      return true;
    } else {
      return false;
    }
  };

  // Check for `.hello` or `.0`.
  const has_dot_expr =
    this.check_noexpect(TK.Dot) && // `.`
    this.look_ahead(1, (tok) => {
      return (
        tok.is_ident() || // `hello`
        is_one_tuple_index(this, tok) || // `0`
        is_two_tuple_indexes(this, tok) // `0.0`
      );
    });

  // Check for operators.
  // `|` is excluded as it is used in pattern alternatives and lambdas,
  // `?` is included for error propagation,
  // `[` is included for indexing operations,
  // `[]` is excluded as `a[]` isn't an expression and should be recovered as `a, []` (cf. `tests/ui/parser/pat-lt-bracket-7.rs`),
  // `as` is included for type casts
  const tk = this.token.kind.$;
  const has_trailing_operator =
    tk === "Plus" ||
    tk === "Minus" ||
    tk === "Star" ||
    tk === "Slash" ||
    tk === "Percent" ||
    tk === "Caret" ||
    tk === "And" ||
    tk === "Shl" ||
    tk === "Shr" || // excludes `Or`
    this.token.eq(TK.Question) ||
    (this.token.eq(TK.OpenBracket) && this.look_ahead(1, (t) => !t.eq(TK.CloseBracket))) || // excludes `[]`
    this.token.is_keyword(kw.As);

  if (!has_dot_expr && !has_trailing_operator) {
    // Nothing to recover here.
    return undefined;
  }

  // Let's try to parse an expression to emit a better diagnostic.
  const snapshot = this.create_snapshot_for_diagnostic();
  snapshot.parser.restrictions = Restrictions.insert(snapshot.parser.restrictions, Restrictions.IS_PAT);

  // Parse `?`, `.f`, `(arg0, arg1, ...)` or `[expr]` until they've all been eaten.
  const r1 = snapshot.parser.parse_expr_dot_or_call_with(
    [],
    this.mk_expr(pat_span, ast.ExprKind.Dummy), // equivalent to transforming the parsed pattern into an `Expr`
    pat_span,
  );
  if (r1.$ === "Err") {
    r1._0.cancel();
    // We got a trailing method/operator, but that wasn't an expression.
    return undefined;
  }
  const expr0 = r1._0;

  // Parse an associative expression such as `+ expr`, `% expr`, ...
  // Assignments, ranges and `|` are disabled by [`Restrictions::IS_PAT`].
  const r2 = snapshot.parser.parse_expr_assoc_rest({ $: "Unbounded" }, false, expr0);
  if (r2.$ === "Err") {
    r2._0.cancel();
    // We got a trailing method/operator, but that wasn't an expression.
    return undefined;
  }
  const [expr] = r2._0;

  // We got a valid expression.
  this.restore_snapshot(snapshot);
  this.restrictions = Restrictions.remove(this.restrictions, Restrictions.IS_PAT);

  const is_bound =
    is_end_bound ||
    // is_start_bound: either `..` or `)..`
    this.token.is_range_separator() ||
    (this.token.eq(TK.CloseParen) && this.look_ahead(1, (t) => t.is_range_separator()));

  const span = expr.span;
  const diag = this.dcx().create_err(diagnostics.UnexpectedExpressionInPattern_diagnostic({ span, is_bound }));
  // The unexpected expr's precedence. Not used directly in the error message, but
  // needed for the stashing of this error to work correctly. We store a `u32` rather
  // than an `ExprPrecedence` to avoid having to impl `IntoDiagArg` for
  // `ExprPrecedence`.
  diag.arg("expr_precedence", IntoDiagArg.of(ExprPrecedence_discriminant[expr.precedence()], number_into_diag_arg));

  return [unwrap(diag.stash(span, "ExprInPat")), span];
};

/// Called by [`Parser::parse_stmt_without_recovery`], used to add statement-aware subdiagnostics to the errors stashed
/// by [`Parser::maybe_recover_trailing_expr`].
// rustc: compiler/rustc_parse/src/parser/pat.rs:511 maybe_augment_stashed_expr_in_pats_with_suggestions
Parser.prototype.maybe_augment_stashed_expr_in_pats_with_suggestions = function (this: Parser, stmt: Stmt): void {
  if (this.dcx().has_errors() === undefined) {
    // No need to walk the statement if there's no stashed errors.
    return;
  }

  // PORT: the fn-local `struct PatVisitor` and its `impl`s.
  class PatVisitor extends visit.Visitor {
    constructor(
      /// `self`
      public parser: Parser,
      /// The freshly-parsed statement.
      public stmt: Stmt,
      /// The current match arm (for arm guard suggestions).
      public arm: Arm | undefined,
      /// The current struct field (for variable name suggestions).
      public field: PatField | undefined,
    ) {
      super();
    }

    /// Looks for stashed [`StashKey::ExprInPat`] errors in `stash_span`, and emit them with suggestions.
    /// `stash_span` is contained in `expr_span`, the latter being larger in borrow patterns;
    /// ```txt
    /// &mut x.y
    /// -----^^^ `stash_span`
    /// |
    /// `expr_span`
    /// ```
    /// `is_range_bound` is used to exclude arm guard suggestions in range pattern bounds.
    // rustc: compiler/rustc_parse/src/parser/pat.rs:538 maybe_add_suggestions_then_emit
    maybe_add_suggestions_then_emit(stash_span: Span, expr_span: Span, is_range_bound: boolean): void {
      this.parser.dcx().try_steal_modify_and_emit_err(stash_span, "ExprInPat", (err) => {
        // Includes pre-pats (e.g. `&mut <err>`) in the diagnostic.
        err.deref_mut().span.replace(stash_span, expr_span);

        const sm = this.parser.psess.source_map();
        const stmt = this.stmt;
        const line_lo = Span.shrink_to_lo(sm.span_extend_to_line(stmt.span));
        const indentation_ = sm.indentation_before(stmt.span);
        const indentation = indentation_ === undefined ? "" : indentation_.toString();
        const snip = this.parser.span_to_snippet(expr_span);
        if (snip.$ === "Err") {
          // FIXME: some suggestions don't actually need the snippet; see PR #123877's unresolved conversations.
          return;
        }
        const expr = snip._0;

        if (stmt.kind.$ === "Let") {
          const local = stmt.kind._0;
          switch (local.kind.$) {
            case "Decl":
            case "Init":
              // It's kinda hard to guess what the user intended, so don't make suggestions.
              return;

            case "InitElse":
              break;
          }
        }

        // help: use an arm guard `if val == expr`
        // FIXME(guard_patterns): suggest this regardless of a match arm.
        const arm = this.arm;
        if (arm !== undefined && !is_range_bound) {
          let ident: string;
          let ident_span: Span;
          const field = this.field;
          if (field !== undefined) {
            [ident, ident_span] = [display_Ident(field.ident), Span.to(field.ident.span, expr_span)];
          } else {
            [ident, ident_span] = ["val", expr_span];
          }

          // Are parentheses required around `expr`?
          // HACK: a neater way would be preferable.
          const a = err.deref().args.get("expr_precedence");
          if (a === undefined) {
            // PORT: `err.args["expr_precedence"]` (IndexMap `Index`) panics on a missing key.
            return unreachable("IndexMap: key not found");
          }
          // PORT: this `expr` shadows the snippet only inside the arm-guard block (the `Const`
          // suggestion below uses the plain snippet).
          let expr_: string;
          if (a.$ === "Number") {
            const expr_precedence = a._0;
            if (expr_precedence <= ExprPrecedence_discriminant.Compare) {
              expr_ = `(${expr})`;
            } else {
              expr_ = `${expr}`;
            }
          } else {
            return unreachable();
          }

          const guard = arm.guard;
          if (guard === undefined) {
            err.subdiagnostic(
              diagnostics.UnexpectedExpressionInPatternSugg_subdiagnostic({
                $: "CreateGuard",
                ident_span,
                pat_hi: Span.shrink_to_hi(arm.pat.span),
                ident,
                expr: expr_,
              }),
            );
          } else {
            // Are parentheses required around the old guard?
            const wrap_guard =
              ExprPrecedence_discriminant[guard.cond.precedence()] <= ExprPrecedence_discriminant.LAnd;

            err.subdiagnostic(
              diagnostics.UnexpectedExpressionInPatternSugg_subdiagnostic({
                $: "UpdateGuard",
                ident_span,
                guard_lo: wrap_guard ? Span.shrink_to_lo(guard.span()) : undefined,
                guard_hi: Span.shrink_to_hi(guard.span()),
                guard_hi_paren: wrap_guard ? ")" : "",
                ident,
                expr: expr_,
              }),
            );
          }
        }

        // help: extract the expr into a `const VAL: _ = expr`
        if (!Span.overlaps(line_lo, expr_span)) {
          const field = this.field;
          // PORT: `str::to_uppercase` -> `String.prototype.toUpperCase` (both use the full Unicode
          // case mapping).
          const ident = field !== undefined ? field.ident.as_str().toUpperCase() : "VAL";
          err.subdiagnostic(
            diagnostics.UnexpectedExpressionInPatternSugg_subdiagnostic({
              $: "Const",
              stmt_lo: line_lo,
              ident_span: expr_span,
              expr,
              ident,
              indentation,
            }),
          );
        }
      });
    }

    // rustc: compiler/rustc_parse/src/parser/pat.rs:650 visit_arm
    override visit_arm(a: Arm): undefined {
      this.arm = a;
      visit.walk_arm(this, a);
      this.arm = undefined;
      return undefined;
    }

    // rustc: compiler/rustc_parse/src/parser/pat.rs:656 visit_pat_field
    override visit_pat_field(fp: PatField): undefined {
      this.field = fp;
      visit.walk_pat_field(this, fp);
      this.field = undefined;
      return undefined;
    }

    // rustc: compiler/rustc_parse/src/parser/pat.rs:662 visit_pat
    override visit_pat(p: Pat): undefined {
      const kind = p.kind;
      switch (kind.$) {
        // Base expression
        case "Err":
        case "Expr":
          this.maybe_add_suggestions_then_emit(p.span, p.span, false);
          return undefined;

        // Sub-patterns
        // FIXME: this doesn't work with recursive subpats (`&mut &mut <err>`)
        case "Ref":
          if (kind._0.kind.$ === "Err" || kind._0.kind.$ === "Expr") {
            const subpat = kind._0;
            this.maybe_add_suggestions_then_emit(subpat.span, p.span, false);
            return undefined;
          }
          break;

        // Sub-expressions
        case "Range": {
          const start = kind._0;
          const end = kind._1;
          if (start !== undefined) {
            this.maybe_add_suggestions_then_emit(start.span, start.span, true);
          }

          if (end !== undefined) {
            this.maybe_add_suggestions_then_emit(end.span, end.span, true);
          }
          return undefined;
        }

        default:
          break;
      }
      // Walk continuation
      visit.walk_pat(this, p);
      return undefined;
    }
  }

  // Starts the visit.
  new PatVisitor(this, stmt, undefined, undefined).visit_stmt(stmt);
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:698 eat_metavar_pat
Parser.prototype.eat_metavar_pat = function (this: Parser): Pat | undefined {
  // Must try both kinds of pattern nonterminals.
  let pat = this.eat_metavar_seq_with_matcher(
    (mv_kind) => mv_kind.$ === "Pat" && mv_kind._0.$ === "PatParam",
    (this_) => this_.parse_pat_no_top_alt(undefined, undefined),
  );
  if (pat !== undefined) {
    return pat;
  }
  const mv_kind: MetaVarKind = { $: "Pat", _0: token.NtPatKind.PatWithOr };
  pat = this.eat_metavar_seq(mv_kind, (this_) =>
    this_.parse_pat_no_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.EitherTupleOrPipe),
  );
  if (pat !== undefined) {
    return pat;
  } else {
    return undefined;
  }
};

/// Parses a pattern, with a setting whether modern range patterns (e.g., `a..=b`, `a..b` are
/// allowed).
// rustc: compiler/rustc_parse/src/parser/pat.rs:721 parse_pat_with_range_pat
Parser.prototype.parse_pat_with_range_pat = function (
  this: Parser,
  allow_range_pat: boolean,
  expected: Expected | undefined,
  syntax_loc: PatternLocation | undefined,
): PResult<Pat> {
  // PORT: `maybe_recover_from_interpolated_ty_qpath!(self, true)` (parser/mod.rs:165), expanded.
  if (this.may_recover()) {
    const mv_kind = this.token.is_metavar_seq();
    if (mv_kind !== undefined && mv_kind.$ === "Ty" && this.check_noexpect_past_close_delim(TK.PathSep)) {
      // Reparse the type, then move to recovery.
      const ty = unwrap(
        this.eat_metavar_seq(mv_kind, (this_) => this_.parse_ty_no_question_mark_recover()),
        "metavar seq ty",
      );

      return this.maybe_recover_from_bad_qpath_stage_2(this.prev_token.span, ty, RecoverQPath.Pat);
    }
  }

  const mp = this.eat_metavar_pat();
  if (mp !== undefined) {
    return Ok(mp);
  }

  let lo = this.token.span;

  if (
    this.token.is_keyword(kw.Let) &&
    this.look_ahead(1, (tok) => tok.can_begin_pattern({ $: "PatParam", inferred: false }))
  ) {
    this.bump();
    // Trim extra space after the `let`
    const span = Span.with_hi(lo, Span.lo(this.token.span));
    this.dcx().emit_err(diagnostics.RemoveLet_diagnostic({ span: lo, suggestion: span }));
    lo = this.token.span;
  }

  // PORT: the `if .. else if let ..` chain is a labelled block; each arm assigns `pat` and breaks.
  let pat: PatKind;
  arms: {
    if (this.check(exp.And) || this.token.eq(TK.AndAnd)) {
      const r = this.parse_pat_deref(expected);
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.check(exp.OpenParen)) {
      const r = this.parse_pat_tuple_or_parens(syntax_loc);
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.check(exp.OpenBracket)) {
      // Parse `[pat, pat,...]` as a slice pattern.
      const r = this.parse_delim_comma_seq(exp.OpenBracket, exp.CloseBracket, (p) =>
        p.parse_pat_allow_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.EitherTupleOrPipe),
      );
      if (r.$ === "Err") return r;
      const [pats] = r._0;
      pat = { $: "Slice", _0: pats };
      break arms;
    }
    if (this.check(exp.DotDot) && !this.is_pat_range_end_start(1)) {
      // A rest pattern `..`.
      this.bump(); // `..`
      pat = PatKindC.Rest;
      break arms;
    }
    if (this.check(exp.DotDotDot) && !this.is_pat_range_end_start(1)) {
      pat = this.recover_dotdotdot_rest_pat(lo, expected);
      break arms;
    }
    const form = this.parse_range_end();
    if (form !== undefined) {
      const r = this.parse_pat_range_to(form); // `..=X`, `...X`, or `..X`.
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.eat(exp.Bang)) {
      // Parse `!`
      this.psess.gated_spans.gate(sym.never_patterns, this.prev_token.span);
      pat = PatKindC.Never;
      break arms;
    }
    if (this.eat_keyword(exp.Underscore)) {
      // Parse `_`
      pat = PatKindC.Wild;
      break arms;
    }
    if (this.eat_keyword(exp.Mut)) {
      const r = this.parse_pat_ident_mut();
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.eat_keyword(exp.Ref)) {
      if (this.check_keyword(exp.Box)) {
        // Suggest `box ref`.
        const span = Span.to(this.prev_token.span, this.token.span);
        this.bump();
        this.dcx().emit_err(diagnostics.SwitchRefBoxOrder_diagnostic({ span }));
      }
      // Parse ref ident @ pat / ref mut ident @ pat / ref pin const|mut ident @ pat
      const [pinned, mutbl] = this.parse_pin_and_mut();
      const r = this.parse_pat_ident(new BindingMode({ $: "Yes", _0: pinned, _1: mutbl }, "Not"), syntax_loc);
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.eat_keyword(exp.Box)) {
      const r = this.parse_pat_box();
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.check_inline_const(0)) {
      // Parse `const pat`
      const rc = this.parse_const_block(Span.to(lo, this.token.span), true);
      if (rc.$ === "Err") return rc;
      const const_expr = rc._0;

      const re = this.parse_range_end();
      if (re !== undefined) {
        const r = this.parse_pat_range_begin_with(const_expr, re);
        if (r.$ === "Err") return r;
        pat = r._0;
      } else {
        pat = { $: "Expr", _0: const_expr };
      }
      break arms;
    }
    if (this.is_builtin()) {
      const r = this.parse_pat_builtin();
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    // Don't eagerly error on semantically invalid tokens when matching
    // declarative macros, as the input to those doesn't have to be
    // semantically valid. For attribute/derive proc macros this is not the
    // case, so doing the recovery for them is fine.
    if (this.can_be_ident_pat() || (this.is_lit_bad_ident() !== undefined && this.may_recover())) {
      // Parse `ident @ pat`
      // This can give false positives and parse nullary enums,
      // they are dealt with later in resolve.
      const r = this.parse_pat_ident(BindingMode.NONE, syntax_loc);
      if (r.$ === "Err") return r;
      pat = r._0;
      break arms;
    }
    if (this.is_start_of_pat_with_path()) {
      // Parse pattern starting with a path
      let qself: QSelf | undefined;
      let path: Path;
      if (this.eat_lt()) {
        // Parse a qualified path
        const r = this.parse_qpath(PathStyle.Pat);
        if (r.$ === "Err") return r;
        [qself, path] = r._0;
      } else {
        // Parse an unqualified path
        const r = this.parse_path(PathStyle.Pat);
        if (r.$ === "Err") return r;
        [qself, path] = [undefined, r._0];
      }
      const span = Span.to(lo, this.prev_token.span);

      let form_: Spanned<RangeEnd> | undefined;
      if (qself === undefined && this.check(exp.Bang)) {
        const r = this.parse_pat_mac_invoc(path);
        if (r.$ === "Err") return r;
        pat = r._0;
      } else if ((form_ = this.parse_range_end()) !== undefined) {
        const begin = this.mk_expr(span, { $: "Path", _0: qself, _1: path });
        const r = this.parse_pat_range_begin_with(begin, form_);
        if (r.$ === "Err") return r;
        pat = r._0;
      } else if (this.check(exp.OpenBrace)) {
        const r = this.parse_pat_struct(qself, path);
        if (r.$ === "Err") return r;
        pat = r._0;
      } else if (this.check(exp.OpenParen)) {
        const r = this.parse_pat_tuple_struct(qself, path);
        if (r.$ === "Err") return r;
        pat = r._0;
      } else {
        const rec = this.maybe_recover_trailing_expr(span, false);
        if (rec !== undefined) {
          const [guar] = rec;
          pat = { $: "Err", _0: guar };
        } else {
          pat = { $: "Path", _0: qself, _1: path };
        }
      }
      break arms;
    }
    const lt_ = this.token.lifetime();
    if (
      lt_ !== undefined &&
      lt_[1] === "Normal" &&
      // In pattern position, we're totally fine with using "next token isn't colon"
      // as a heuristic. We could probably just always try to recover if it's a lifetime,
      // because we never have `'a: label {}` in a pattern position anyways, but it does
      // keep us from suggesting something like `let 'a: Ty = ..` => `let 'a': Ty = ..`
      could_be_unclosed_char_literal(lt_[0]) &&
      !this.look_ahead(1, (token_) => token_.kind.$ === "Colon")
    ) {
      // Recover a `'a` as a `'a'` literal
      const lt = this.expect_lifetime();
      const [lit] = this.recover_unclosed_char(lt.ident, mk_token_lit_char, (self_) => {
        const expected_ = Expected.to_string_or_fallback(expected);
        const msg = `expected ${expected_}, found ${token_descr(self_.token)}`;

        return self_.dcx().struct_span_err(self_.token.span, msg).with_span_label(self_.token.span, `expected ${expected_}`);
      });
      pat = { $: "Expr", _0: this.mk_expr(lo, { $: "Lit", _0: lit }) };
      break arms;
    }
    // Try to parse everything else as literal with optional minus
    const r = this.parse_literal_maybe_minus();
    if (r.$ === "Ok") {
      let begin = r._0;
      const rec = this.maybe_recover_trailing_expr(begin.span, false);
      if (rec !== undefined) {
        const [guar, sp] = rec;
        begin = this.mk_expr_err(sp, guar);
      }

      const form2 = this.parse_range_end();
      if (form2 !== undefined) {
        const r2 = this.parse_pat_range_begin_with(begin, form2);
        if (r2.$ === "Err") return r2;
        pat = r2._0;
      } else {
        pat = { $: "Expr", _0: begin };
      }
    } else {
      return this.fatal_unexpected_non_pat(r._0, expected);
    }
  }

  let pat_ = this.mk_pat(Span.to(lo, this.prev_token.span), pat);

  const rq = this.maybe_recover_from_bad_qpath(pat_, RecoverQPath.Pat);
  if (rq.$ === "Err") return rq;
  pat_ = rq._0;
  if (this.eat_noexpect(TK.At)) {
    const ri = this.recover_intersection_pat(pat_);
    if (ri.$ === "Err") return ri;
    pat_ = ri._0;
  }

  if (!allow_range_pat) {
    this.ban_pat_range_if_ambiguous(pat_);
  }

  return Ok(pat_);
};

/// Recover from a typoed `...` pattern that was encountered
/// Ref: Issue #70388
// rustc: compiler/rustc_parse/src/parser/pat.rs:904 recover_dotdotdot_rest_pat
Parser.prototype.recover_dotdotdot_rest_pat = function (this: Parser, lo: Span, expected: Expected | undefined): PatKind {
  // A typoed rest pattern `...`.
  this.bump(); // `...`

  if (expected === "ParameterName") {
    // We have `...` in a closure argument, likely meant to be var-arg, which aren't
    // supported in closures (#146489).
    return {
      $: "Err",
      _0: this.dcx().emit_err(
        diagnostics.DotDotDotRestPattern_diagnostic({ span: lo, suggestion: undefined, var_args: null }),
      ),
    };
  } else {
    // The user probably mistook `...` for a rest pattern `..`.
    this.dcx().emit_err(diagnostics.DotDotDotRestPattern_diagnostic({ span: lo, suggestion: lo, var_args: undefined }));
    return PatKindC.Rest;
  }
};

/// Try to recover the more general form `intersect ::= $pat_lhs @ $pat_rhs`.
///
/// Allowed binding patterns generated by `binding ::= ref? mut? $ident @ $pat_rhs`
/// should already have been parsed by now at this point,
/// if the next token is `@` then we can try to parse the more general form.
///
/// Consult `parse_pat_ident` for the `binding` grammar.
///
/// The notion of intersection patterns are found in
/// e.g. [F#][and] where they are called AND-patterns.
///
/// [and]: https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/pattern-matching
// #[cold]
// rustc: compiler/rustc_parse/src/parser/pat.rs:940 recover_intersection_pat
Parser.prototype.recover_intersection_pat = function (this: Parser, lhs: Pat): PResult<Pat> {
  const r = this.parse_pat_no_top_alt(undefined, undefined);
  if (r.$ === "Err") return r;
  const rhs = r._0;
  const whole_span = Span.to(lhs.span, rhs.span);

  const k = rhs.kind;
  if (k.$ === "Ident" && k._2 === undefined) {
    // The user inverted the order, so help them fix that.
    const lhs_span = lhs.span;
    // Move the LHS into the RHS as a subpattern.
    // The RHS is now the full pattern.
    k._2 = lhs;

    this.dcx().emit_err(
      diagnostics.PatternOnWrongSideOfAt_diagnostic({
        whole_span,
        whole_pat: pprust.pat_to_string(rhs),
        pattern: lhs_span,
        binding: rhs.span,
      }),
    );
  } else {
    // The special case above doesn't apply so we may have e.g. `A(x) @ B(y)`.
    rhs.kind = PatKindC.Wild;
    this.dcx().emit_err(diagnostics.ExpectedBindingLeftOfAt_diagnostic({ whole_span, lhs: lhs.span, rhs: rhs.span }));
  }

  rhs.span = whole_span;
  return Ok(rhs);
};

/// Ban a range pattern if it has an ambiguous interpretation.
// rustc: compiler/rustc_parse/src/parser/pat.rs:972 ban_pat_range_if_ambiguous
Parser.prototype.ban_pat_range_if_ambiguous = function (this: Parser, pat: Pat): void {
  const k = pat.kind;
  if (k.$ === "Range" && k._2.node.$ === "Included" && k._2.node._0 === "DotDotDot") {
    return;
  } else if (k.$ === "Range") {
    // fallthrough
  } else {
    return;
  }

  this.dcx().emit_err(
    diagnostics.AmbiguousRangePattern_diagnostic({
      span: pat.span,
      suggestion: { lo: Span.shrink_to_lo(pat.span), hi: Span.shrink_to_hi(pat.span) },
    }),
  );
};

/// Parse `&pat` / `&mut pat` / `&pin const pat` / `&pin mut pat`.
// rustc: compiler/rustc_parse/src/parser/pat.rs:992 parse_pat_deref
Parser.prototype.parse_pat_deref = function (this: Parser, expected: Expected | undefined): PResult<PatKind> {
  const ra = this.expect_and();
  if (ra.$ === "Err") return ra;
  const lt = this.token.lifetime();
  if (lt !== undefined) {
    const [lifetime] = lt;
    this.bump(); // `'a`

    this.dcx().emit_err(
      diagnostics.UnexpectedLifetimeInPattern_diagnostic({
        span: this.prev_token.span,
        symbol: lifetime.name,
        suggestion: Span.until(this.prev_token.span, this.token.span),
      }),
    );
  }

  const [pinned, mutbl] = this.parse_pin_and_mut();
  const r = this.parse_pat_with_range_pat(false, expected, undefined);
  if (r.$ === "Err") return r;
  const subpat = r._0;
  return Ok({ $: "Ref", _0: subpat, _1: pinned, _2: mutbl });
};

/// Parse a tuple or parenthesis pattern.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1010 parse_pat_tuple_or_parens
Parser.prototype.parse_pat_tuple_or_parens = function (
  this: Parser,
  syntax_loc: PatternLocation | undefined,
): PResult<PatKind> {
  const open_paren = this.token.span;

  // The index, the span of the `:` and the type of every element written
  // with an inline type annotation, which is invalid syntax. This is kept
  // out of the element patterns themselves so that the happy path doesn't
  // have to allocate for it.
  const tys: [number, Span, Ty][] = [];
  let index = 0;

  const rs = this.parse_paren_comma_seq((p) => {
    const rp = p.parse_pat_allow_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.LikelyTuple);
    if (rp.$ === "Err") return rp;
    const pat = rp._0;
    // Recover from an inline `: <ty>` type annotation. We only do this
    // when there is whitespace after the colon, so that `(a:b)` keeps
    // the existing "maybe write a path separator here" (`a::b`)
    // suggestion, which is the more likely intent when the two are
    // written next to each other.
    if (p.may_recover() && p.token.eq(TK.Colon)) {
      const colon = p.token.span;
      if (p.look_ahead(1, (next) => Span.lo(next.span) > Span.hi(colon))) {
        p.bump(); // eat the `:`
        const rt = p.parse_ty();
        if (rt.$ === "Err") return rt;
        tys.push([index, colon, rt._0]);
      }
    }
    index += 1;
    return Ok(pat);
  });
  if (rs.$ === "Err") return rs;
  const [fields, trailing_comma] = rs._0;

  // If any element carried an inline type annotation then this is the
  // invalid `(a: bool, b: u8)` form; report it and suggest the correct
  // spelling where we can. Either way, continue on with the type
  // annotations stripped.
  if (tys.length !== 0) {
    this.recover_tuple_pat_type_ascription(open_paren, fields, tys, trailing_comma, syntax_loc);
  }

  // Here, `(pat,)` is a tuple pattern.
  // For backward compatibility, `(..)` is a tuple pattern as well.
  const paren_pattern = fields.length === 1 && !(trailing_comma === Trailing.Yes || fields[0]!.is_rest());

  let pat: PatKind;
  if (paren_pattern) {
    const pat0 = unwrap(fields[0]);
    const close_paren = this.prev_token.span;

    const k = pat0.kind;
    let form: Spanned<RangeEnd> | undefined;
    // recover ranges with parentheses around the `(start)..`
    if (k.$ === "Expr" && this.may_recover() && (form = this.parse_range_end()) !== undefined) {
      const begin = k._0;
      this.dcx().emit_err(
        diagnostics.UnexpectedParenInRangePat_diagnostic({
          span: [open_paren, close_paren],
          sugg: { start_span: open_paren, end_span: close_paren },
        }),
      );

      const r = this.parse_pat_range_begin_with(ast.clone_Expr(begin), form);
      if (r.$ === "Err") return r;
      pat = r._0;
    }
    // recover ranges with parentheses around the `(start)..`
    else if (k.$ === "Err" && this.may_recover() && (form = this.parse_range_end()) !== undefined) {
      const guar = k._0;
      this.dcx().emit_err(
        diagnostics.UnexpectedParenInRangePat_diagnostic({
          span: [open_paren, close_paren],
          sugg: { start_span: open_paren, end_span: close_paren },
        }),
      );

      const r = this.parse_pat_range_begin_with(this.mk_expr_err(pat0.span, guar), form);
      if (r.$ === "Err") return r;
      pat = r._0;
    }
    // (pat) with optional parentheses
    else {
      pat = { $: "Paren", _0: pat0 };
    }
  } else {
    pat = { $: "Tuple", _0: fields };
  }

  const rec = this.maybe_recover_trailing_expr(Span.to(open_paren, this.prev_token.span), false);
  if (rec === undefined) {
    return Ok(pat);
  } else {
    const [guar] = rec;
    return Ok({ $: "Err", _0: guar });
  }
};

/// Report a tuple or parenthesized pattern whose elements carry inline type
/// annotations, e.g. `let (a: bool, b: u8) = ...;`. This is invalid syntax;
/// the element types have to be written together as a tuple type after the
/// pattern, i.e. `let (a, b): (bool, u8) = ...;`. `tys` are the annotations
/// that were written, indexed into `fields`.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1120 recover_tuple_pat_type_ascription
Parser.prototype.recover_tuple_pat_type_ascription = function (
  this: Parser,
  open_paren: Span,
  fields: readonly Pat[],
  tys: readonly [number, Span, Ty][],
  trailing_comma: Trailing,
  syntax_loc: PatternLocation | undefined,
): void {
  const close_paren = this.prev_token.span;

  // Point at every inline type annotation.
  const ty_spans: Span[] = tys.map(([, colon, ty]) => Span.to(colon, ty.span));
  // `(a: T)` is a parenthesized pattern rather than a one element tuple.
  const paren_pattern = fields.length === 1 && trailing_comma === Trailing.No && !fields[0]!.is_rest();
  const err = this.dcx().struct_span_err(
    ty_spans.slice(),
    paren_pattern
      ? "a parenthesized pattern cannot be given a type"
      : "the elements of a tuple pattern cannot be given types individually",
  );

  // Only the top level pattern of a `let` binding can be followed by a
  // type, so that's the only place where we know how the pattern should
  // have been written instead. Anywhere else (`match` arms, function
  // parameters, nested patterns) we just recover without a suggestion.
  if (syntax_loc === PatternLocation.LetBinding) {
    if (this.token.eq(TK.Colon)) {
      // The pattern is already followed by a type, as in
      // `let (a: bool, b): (_, u8) = ...;`. Merging that type with the
      // inline ones isn't always possible, so just suggest dropping
      // the inline ones.
      err.multipart_suggestion(
        "remove the inline type annotations",
        ty_spans.map((span): [Span, string] => [span, ""]),
        Applicability.MaybeIncorrect,
      );
    } else if (!fields.some((pat) => pat.is_rest())) {
      // A rest pattern stands for any number of elements, so we can't
      // tell how many types the tuple type would have to list.
      this.suggest_tuple_pat_type(err, open_paren, close_paren, fields, tys, paren_pattern);
    }
  }
  err.emit();
};

/// Suggest rewriting `(a: bool, b: u8)` as `(a, b): (bool, u8)`, moving the
/// inline type annotations into a tuple type after the pattern.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1177 suggest_tuple_pat_type
Parser.prototype.suggest_tuple_pat_type = function (
  this: Parser,
  err: Diag,
  open_paren: Span,
  close_paren: Span,
  fields: readonly Pat[],
  tys_: readonly [number, Span, Ty][],
  paren_pattern: boolean,
): void {
  // Build the replacement from the source snippets. Elements without an
  // annotation get an inferred `_` type.
  const pat_snippets: string[] = [];
  const ty_snippets: string[] = [];
  // PORT: `tys.iter().peekable()` + `next_if` -> an index into `tys_`.
  let tys = 0;
  for (let index = 0; index < fields.length; index++) {
    const pat = fields[index]!;
    let ty_snippet;
    const next = tys_[tys];
    if (next !== undefined && next[0] === index) {
      tys += 1;
      const [, , ty] = next;
      ty_snippet = this.span_to_snippet(ty.span);
    } else {
      ty_snippet = Ok("_");
    }
    const pat_snippet = this.span_to_snippet(pat.span);
    if (pat_snippet.$ !== "Ok" || ty_snippet.$ !== "Ok") {
      // We can't rebuild the pattern from source, so don't suggest anything.
      return;
    }
    pat_snippets.push(pat_snippet._0);
    ty_snippets.push(ty_snippet._0);
  }

  // The type of a parenthesized pattern isn't a tuple type. A one element
  // tuple on the other hand keeps its trailing comma on both sides.
  let suggestion: string;
  let msg: string;
  if (paren_pattern) {
    [suggestion, msg] = [`(${pat_snippets[0]!}): ${ty_snippets[0]!}`, "write the type after the pattern"];
  } else {
    const trailing = fields.length === 1 ? "," : "";
    [suggestion, msg] = [
      `(${pat_snippets.join(", ")}${trailing}): (${ty_snippets.join(", ")}${trailing})`,
      "to annotate the types of a tuple's elements, write them as a tuple type after the pattern",
    ];
  }
  err.span_suggestion_verbose(Span.to(open_paren, close_paren), msg, suggestion, Applicability.MaybeIncorrect);
};

/// Parse a mutable binding with the `mut` token already eaten.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1233 parse_pat_ident_mut
Parser.prototype.parse_pat_ident_mut = function (this: Parser): PResult<PatKind> {
  const mut_span = this.prev_token.span;

  this.recover_additional_muts();

  const byref = this.parse_byref();

  this.recover_additional_muts();

  // Make sure we don't allow e.g. `let mut $p;` where `$p:pat`.
  const mvk = this.token.is_metavar_seq();
  if (mvk !== undefined && mvk.$ === "Pat") {
    this.expected_ident_found_err().emit();
  }

  // Parse the pattern we hope to be an identifier.
  const r = this.parse_pat_no_top_alt(gen.Expected.Identifier, undefined);
  if (r.$ === "Err") return r;
  const pat = r._0;

  // If we don't have `mut $ident (@ pat)?`, error.
  const k = pat.kind;
  if (k.$ === "Ident" && k._0._0.$ === "No" && k._0._1 === "Not") {
    // Don't recurse into the subpattern.
    // `mut` on the outer binding doesn't affect the inner bindings.
    // PORT: `*br = byref; *m = Mutability::Mut;` writes a new `BindingMode` (the old one may be the
    // shared `BindingMode::NONE` constant).
    k._0 = new BindingMode(byref, "Mut");
  } else {
    // Add `mut` to any binding in the parsed pattern.
    const changed_any_binding = make_all_value_bindings_mutable(pat);
    this.ban_mut_general_pat(mut_span, pat, changed_any_binding);
  }

  const k2 = pat.kind;
  if (k2.$ === "Ident" && k2._0._0.$ === "Yes" && k2._0._1 === "Mut") {
    this.psess.gated_spans.gate(sym.mut_ref, pat.span);
  }
  return Ok(pat.kind);
};

/// Turn all by-value immutable bindings in a pattern into mutable bindings.
/// Returns `true` if any change was made.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1271 make_all_value_bindings_mutable
export function make_all_value_bindings_mutable(pat: Pat): boolean {
  // PORT: the fn-local `struct AddMut(bool)` and its `impl MutVisitor`.
  class AddMut extends mut_visit.MutVisitor {
    constructor(public _0: boolean) {
      super();
    }

    // rustc: compiler/rustc_parse/src/parser/pat.rs:1274 visit_pat
    override visit_pat(pat: Pat): void {
      const k = pat.kind;
      if (k.$ === "Ident" && k._0._0.$ === "No" && k._0._1 === "Not") {
        this._0 = true;
        // PORT: `*m = Mutability::Mut` writes a new `BindingMode` (see parse_pat_ident_mut).
        k._0 = new BindingMode(k._0._0, "Mut");
      }
      mut_visit.walk_pat(this, pat);
    }
  }

  const add_mut = new AddMut(false);
  add_mut.visit_pat(pat);
  return add_mut._0;
}

/// Error on `mut $pat` where `$pat` is not an ident.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1291 ban_mut_general_pat
Parser.prototype.ban_mut_general_pat = function (this: Parser, lo: Span, pat: Pat, changed_any_binding: boolean): void {
  this.dcx().emit_err(
    diagnostics.InvalidMutInPattern_diagnostic(
      changed_any_binding
        ? { $: "NestedIdent", span: Span.to(lo, pat.span), pat: pprust.pat_to_string(pat) }
        : { $: "NonIdent", span: Span.until(lo, pat.span) },
    ),
  );
};

/// Eat any extraneous `mut`s and error + recover if we ate any.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1303 recover_additional_muts
Parser.prototype.recover_additional_muts = function (this: Parser): void {
  const lo = this.token.span;
  while (this.eat_keyword(exp.Mut)) {}
  if (lo === this.token.span) {
    return;
  }

  const span = Span.to(lo, this.prev_token.span);
  const suggestion = Span.with_hi(span, Span.lo(this.token.span));
  this.dcx().emit_err(diagnostics.RepeatedMutInPattern_diagnostic({ span, suggestion }));
};

/// Parse macro invocation
// rustc: compiler/rustc_parse/src/parser/pat.rs:1316 parse_pat_mac_invoc
Parser.prototype.parse_pat_mac_invoc = function (this: Parser, path: Path): PResult<PatKind> {
  this.bump();
  const r = this.parse_delim_args();
  if (r.$ === "Err") return r;
  const args = r._0;
  const mac = new ast.MacCall(path, args);
  return Ok({ $: "MacCall", _0: mac });
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1323 fatal_unexpected_non_pat
Parser.prototype.fatal_unexpected_non_pat = function (this: Parser, err: Diag, expected: Expected | undefined): PResult<Pat> {
  err.cancel();

  const expected_ = Expected.to_string_or_fallback(expected);
  const msg = `expected ${expected_}, found ${token_descr(this.token)}`;

  const err_ = this.dcx().struct_span_err(this.token.span, msg);
  err_.span_label(this.token.span, `expected ${expected_}`);

  const sp = this.psess.source_map().start_point(this.token.span);
  const sp2 = this.psess.complete_stmt_exprs_before_bin_op_lookalike.get(sp);
  if (sp2 !== undefined) {
    err_.subdiagnostic(diagnostics.ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded.surrounding(sp2)));
  }

  return Err(err_);
};

/// Parses the range pattern end form `".." | "..." | "..=" ;`.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1345 parse_range_end
Parser.prototype.parse_range_end = function (this: Parser): Spanned<RangeEnd> | undefined {
  let re: RangeEnd;
  if (this.eat(exp.DotDotDot)) {
    re = { $: "Included", _0: "DotDotDot" };
  } else if (this.eat(exp.DotDotEq)) {
    re = { $: "Included", _0: "DotDotEq" };
  } else if (this.eat(exp.DotDot)) {
    re = ast.RangeEnd.Excluded;
  } else {
    return undefined;
  }
  return respan(this.prev_token.span, re);
};

/// Parse a range pattern `$begin $form $end?` where `$form = ".." | "..." | "..=" ;`.
/// `$begin $form` has already been parsed.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1360 parse_pat_range_begin_with
Parser.prototype.parse_pat_range_begin_with = function (this: Parser, begin: Expr, re: Spanned<RangeEnd>): PResult<PatKind> {
  let end: Expr | undefined;
  if (this.is_pat_range_end_start(0)) {
    // Parsing e.g. `X..=Y`.
    const r = this.parse_pat_range_end();
    if (r.$ === "Err") return r;
    end = r._0;
  } else {
    // Parsing e.g. `X..`.
    if (re.node.$ === "Included") {
      // FIXME(Centril): Consider semantic errors instead in `ast_validation`.
      this.inclusive_range_with_incorrect_end();
    }
    end = undefined;
  }
  return Ok({ $: "Range", _0: begin, _1: end, _2: re });
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1379 inclusive_range_with_incorrect_end
Parser.prototype.inclusive_range_with_incorrect_end = function (this: Parser): ErrorGuaranteed {
  const tok = this.token;
  const span = this.prev_token.span;
  // If the user typed "..==" or "...=" instead of "..=", we want to give them
  // a specific error message telling them to use "..=".
  // If they typed "..=>", suggest they use ".. =>".
  // Otherwise, we assume that they meant to type a half open exclusive
  // range and give them an error telling them to do that instead.
  const no_space = Span.lo(tok.span) === Span.hi(span);
  if (tok.kind.$ === "Eq" && no_space) {
    const span_with_eq = Span.to(span, tok.span);

    // Ensure the user doesn't receive unhelpful unexpected token errors
    this.bump();
    if (this.is_pat_range_end_start(0)) {
      const r = this.parse_pat_range_end();
      if (r.$ === "Err") r._0.cancel();
    }

    return this.dcx().emit_err(diagnostics.InclusiveRangeExtraEquals_diagnostic({ span: span_with_eq }));
  } else if (tok.kind.$ === "Gt" && this.prev_token.kind.$ === "DotDotEq" && no_space) {
    return this.dcx().emit_err(diagnostics.InclusiveRangeMatchArrow_diagnostic({ span, arrow: tok.span }));
  } else {
    return this.dcx().emit_err(diagnostics.InclusiveRangeNoEnd_diagnostic({ span }));
  }
};

/// Parse a range-to pattern, `..X` or `..=X` where `X` remains to be parsed.
///
/// The form `...X` is prohibited to reduce confusion with the potential
/// expression syntax `...expr` for splatting in expressions.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1411 parse_pat_range_to
Parser.prototype.parse_pat_range_to = function (this: Parser, re: Spanned<RangeEnd>): PResult<PatKind> {
  const r = this.parse_pat_range_end();
  if (r.$ === "Err") return r;
  const end = r._0;
  if (re.node.$ === "Included" && re.node._0 === "DotDotDot") {
    // PORT: `*syn = RangeSyntax::DotDotEq` writes a new `RangeEnd` into `re.node`.
    re.node = { $: "Included", _0: "DotDotEq" };
    this.dcx().emit_err(diagnostics.DotDotDotRangeToPatternNotAllowed_diagnostic({ span: re.span }));
  }
  return Ok({ $: "Range", _0: undefined, _1: end, _2: re });
};

/// Is the token `dist` away from the current suitable as the start of a range patterns end?
// rustc: compiler/rustc_parse/src/parser/pat.rs:1421 is_pat_range_end_start
Parser.prototype.is_pat_range_end_start = function (this: Parser, dist: number): boolean {
  return (
    this.check_inline_const(dist) ||
    this.look_ahead(dist, (t) => {
      return (
        t.is_path_start() || // e.g. `MY_CONST`;
        t.eq(TK.Dot) || // e.g. `.5` for recovery;
        t.kind.$ === "Literal" ||
        t.kind.$ === "Minus" ||
        t.is_bool_lit() ||
        t.is_metavar_expr() ||
        t.is_lifetime() || // recover `'a` instead of `'a'`
        (this.may_recover() && // recover leading `(`
          t.eq(TK.OpenParen) &&
          this.look_ahead(dist + 1, (t) => !t.eq(TK.OpenParen)) &&
          this.is_pat_range_end_start(dist + 1))
      );
    })
  );
};

/// Parse a range pattern end bound
// rustc: compiler/rustc_parse/src/parser/pat.rs:1438 parse_pat_range_end
Parser.prototype.parse_pat_range_end = function (this: Parser): PResult<Expr> {
  // recover leading `(`
  const open_paren = this.may_recover() && this.eat_noexpect(TK.OpenParen) ? this.prev_token.span : undefined;

  let rb: PResult<Expr>;
  if (this.check_inline_const(0)) {
    rb = this.parse_const_block(this.token.span, true);
  } else if (this.check_path()) {
    const lo = this.token.span;
    let qself: QSelf | undefined;
    let path: Path;
    if (this.eat_lt()) {
      // Parse a qualified path
      const r = this.parse_qpath(PathStyle.Pat);
      if (r.$ === "Err") return r;
      [qself, path] = r._0;
    } else {
      // Parse an unqualified path
      const r = this.parse_path(PathStyle.Pat);
      if (r.$ === "Err") return r;
      [qself, path] = [undefined, r._0];
    }
    const hi = this.prev_token.span;
    rb = Ok(this.mk_expr(Span.to(lo, hi), { $: "Path", _0: qself, _1: path }));
  } else {
    rb = this.parse_literal_maybe_minus();
  }
  if (rb.$ === "Err") return rb;
  const bound = rb._0;

  const recovered = this.maybe_recover_trailing_expr(bound.span, true);

  // recover trailing `)`
  if (open_paren !== undefined) {
    const re = this.expect(exp.CloseParen);
    if (re.$ === "Err") return re;

    this.dcx().emit_err(
      diagnostics.UnexpectedParenInRangePat_diagnostic({
        span: [open_paren, this.prev_token.span],
        sugg: { start_span: open_paren, end_span: this.prev_token.span },
      }),
    );
  }

  if (recovered !== undefined) {
    const [guar, sp] = recovered;
    return Ok(this.mk_expr_err(sp, guar));
  } else {
    return Ok(bound);
  }
};

/// Is this the start of a pattern beginning with a path?
// rustc: compiler/rustc_parse/src/parser/pat.rs:1483 is_start_of_pat_with_path
Parser.prototype.is_start_of_pat_with_path = function (this: Parser): boolean {
  return (
    this.check_path() ||
    // Just for recovery (see `can_be_ident`).
    (this.token.is_ident() && !this.token.is_bool_lit() && !this.token.is_keyword(kw.In))
  );
};

/// Would `parse_pat_ident` be appropriate here?
// rustc: compiler/rustc_parse/src/parser/pat.rs:1490 can_be_ident_pat
Parser.prototype.can_be_ident_pat = function (this: Parser): boolean {
  return (
    this.check_ident() &&
    !this.token.is_bool_lit() && // Avoid `true` or `false` as a binding as it is a literal.
    !this.token.is_path_segment_keyword() && // Avoid e.g. `Self` as it is a path.
    // Avoid `in`. Due to recovery in the list parser this messes with `for ( $pat in $expr )`.
    !this.token.is_keyword(kw.In) &&
    // Try to do something more complex?
    this.look_ahead(1, (t) => {
      switch (t.kind.$) {
        case "OpenParen": // A tuple struct pattern.
        case "OpenBrace": // A struct pattern.
        case "DotDotDot":
        case "DotDotEq":
        case "DotDot": // A range pattern.
        case "PathSep": // A tuple / struct variant pattern.
        case "Bang": // A macro expanding to a pattern.
          return false;
        default:
          return true;
      }
    })
  );
};

/// Parses `ident` or `ident @ pat`.
/// Used by the copy foo and ref foo patterns to give a good
/// error message when parsing mistakes like `ref foo(a, b)`.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1507 parse_pat_ident
Parser.prototype.parse_pat_ident = function (
  this: Parser,
  binding_annotation: BindingModeT,
  syntax_loc: PatternLocation | undefined,
): PResult<PatKind> {
  const ri = this.parse_ident_common(false);
  if (ri.$ === "Err") return ri;
  const ident = ri._0;

  if (
    this.may_recover() &&
    syntax_loc !== PatternLocation.FunctionParameter &&
    this.check_noexpect(TK.Lt) &&
    this.look_ahead(1, (t) => t.can_begin_type())
  ) {
    return Err(
      this.dcx().create_err(
        diagnostics.GenericArgsInPatRequireTurbofishSyntax_diagnostic({
          span: this.token.span,
          suggest_turbofish: Span.shrink_to_lo(this.token.span),
        }),
      ),
    );
  }

  let sub: Pat | undefined;
  if (this.eat(exp.At)) {
    const r = this.parse_pat_no_top_alt(gen.Expected.BindingPattern, undefined);
    if (r.$ === "Err") return r;
    sub = r._0;
  } else {
    sub = undefined;
  }

  // Just to be friendly, if they write something like `ref Some(i)`,
  // we end up here with `(` as the current token.
  // This shortly leads to a parse error. Note that if there is no explicit
  // binding mode then we do not end up here, because the lookahead
  // will direct us over to `parse_enum_variant()`.
  if (this.token.eq(TK.OpenParen)) {
    return Err(this.dcx().create_err(diagnostics.EnumPatternInsteadOfIdentifier_diagnostic({ span: this.prev_token.span })));
  }

  // Check for method calls after the `ident`,
  // but not `ident @ subpat` as `subpat` was already checked and `ident` continues with `@`.

  let rec: [ErrorGuaranteed, Span] | undefined;
  let pat: PatKind;
  if (sub === undefined && (rec = this.maybe_recover_trailing_expr(ident.span, false)) !== undefined) {
    const [guar] = rec;
    pat = { $: "Err", _0: guar };
  } else {
    pat = { $: "Ident", _0: binding_annotation, _1: ident, _2: sub };
  }
  return Ok(pat);
};

/// Parse a struct ("record") pattern (e.g. `Foo { ... }` or `Foo::Bar { ... }`).
// rustc: compiler/rustc_parse/src/parser/pat.rs:1556 parse_pat_struct
Parser.prototype.parse_pat_struct = function (this: Parser, qself: QSelf | undefined, path: Path): PResult<PatKind> {
  if (qself !== undefined) {
    // Feature gate the use of qualified paths in patterns
    this.psess.gated_spans.gate(sym.more_qualified_paths, path.span);
  }
  this.bump();
  let fields: PatField[];
  let etc: PatFieldsRest;
  const r = this.parse_pat_fields();
  if (r.$ === "Ok") {
    [fields, etc] = r._0;
  } else {
    const e = r._0;
    e.span_label(path.span, "while parsing the fields for this pattern");
    const guar = e.emit_err();
    this.recover_stmt();
    // When recovering, pretend we had `Foo { .. }`, to avoid cascading errors.
    [fields, etc] = [[], { $: "Recovered", _0: guar }];
  }
  this.bump();
  return Ok({ $: "Struct", _0: qself, _1: path, _2: fields, _3: etc });
};

/// Parse tuple struct or tuple variant pattern (e.g. `Foo(...)` or `Foo::Bar(...)`).
// rustc: compiler/rustc_parse/src/parser/pat.rs:1574 parse_pat_tuple_struct
Parser.prototype.parse_pat_tuple_struct = function (this: Parser, qself: QSelf | undefined, path: Path): PResult<PatKind> {
  const r = this.parse_paren_comma_seq((p) =>
    p.parse_pat_allow_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.EitherTupleOrPipe),
  );
  if (r.$ === "Err") return r;
  const [fields] = r._0;
  if (qself !== undefined) {
    this.psess.gated_spans.gate(sym.more_qualified_paths, path.span);
  }
  return Ok({ $: "TupleStruct", _0: qself, _1: path, _2: fields });
};

/// Are we sure this could not possibly be the start of a pattern?
///
/// Currently, this only accounts for tokens that can follow identifiers
/// in patterns, but this can be extended as necessary.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1597 isnt_pattern_start
Parser.prototype.isnt_pattern_start = function (this: Parser): boolean {
  return [TK.Eq, TK.Colon, TK.Comma, TK.Semi, TK.At, TK.OpenBrace, TK.CloseBrace, TK.CloseParen].some((k) =>
    token.TokenKind_eq(k, this.token.kind),
  );
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1611 parse_pat_builtin
Parser.prototype.parse_pat_builtin = function (this: Parser): PResult<PatKind> {
  return this.parse_builtin<PatKind>((self_, _lo, ident) => {
    switch (ident.name) {
      // builtin#deref(PAT)
      case sym.deref: {
        const r = self_.parse_pat_allow_top_guard(
          undefined,
          RecoverComma.Yes,
          RecoverColon.Yes,
          CommaRecoveryMode.LikelyTuple,
        );
        if (r.$ === "Err") return r;
        return Ok({ $: "Deref", _0: r._0 });
      }
      default:
        return Ok(undefined);
    }
  });
};

// FIXME: remove this entirely eventually
/// Parses the removed `box pat` syntax to provide a more helpful error message.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1630 parse_pat_box
Parser.prototype.parse_pat_box = function (this: Parser): PResult<PatKind> {
  const box_span = this.prev_token.span;

  if (this.isnt_pattern_start()) {
    const descr = token_descr(this.token);
    this.dcx().emit_err(
      diagnostics.BoxNotPat_diagnostic({
        span: this.token.span,
        kw: box_span,
        lo: Span.shrink_to_lo(box_span),
        descr,
      }),
    );

    // We cannot use `parse_pat_ident()` since it will complain `box`
    // is not an identifier.
    let sub: Pat | undefined;
    if (this.eat(exp.At)) {
      const r = this.parse_pat_no_top_alt(gen.Expected.BindingPattern, undefined);
      if (r.$ === "Err") return r;
      sub = r._0;
    } else {
      sub = undefined;
    }

    return Ok({ $: "Ident", _0: BindingMode.NONE, _1: Ident.new(kw.Box, box_span), _2: sub });
  } else {
    const r = this.parse_pat_with_range_pat(false, undefined, undefined);
    if (r.$ === "Err") return r;
    const pat = r._0;
    const before_span = Span.until(box_span, pat.span);
    this.dcx().emit_err(
      diagnostics.BoxPatsRemoved_diagnostic({
        span: box_span,
        sugg_deref_macro_call: {
          field: undefined,
          before: before_span,
          after: Span.shrink_to_hi(pat.span),
        },
        sugg_removal: before_span,
      }),
    );
    // Treat the box pattern like a deref pattern to avoid lots of "value not found" errors.
    return Ok({ $: "Deref", _0: pat });
  }
};

/// Parses the fields of a struct-like pattern.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1669 parse_pat_fields
Parser.prototype.parse_pat_fields = function (this: Parser): PResult<[PatField[], PatFieldsRest]> {
  const fields: PatField[] = [];
  let etc: PatFieldsRest = PatFieldsRestC.None;
  let ate_comma = true;
  let delayed_err: Diag | undefined = undefined;
  let first_etc_and_maybe_comma_span: Span | undefined = undefined;
  let last_non_comma_dotdot_span: Span | undefined = undefined;

  while (!this.token.eq(TK.CloseBrace)) {
    // check that a comma comes after every field
    if (!ate_comma) {
      let err: Diag;
      if (this.token.eq(TK.At)) {
        const prev_field = unwrap(fields[fields.length - 1], "Unreachable on first iteration, not empty otherwise").ident;
        err = this.report_misplaced_at_in_struct_pat(prev_field);
      } else {
        const err_ = this.dcx().create_err(diagnostics.ExpectedCommaAfterPatternField_diagnostic({ span: this.token.span }));
        this.recover_misplaced_pattern_modifiers(fields, err_);
        err = err_;
      }
      if (delayed_err !== undefined) {
        const delayed = delayed_err;
        delayed.emit();
      }
      return Err(err);
    }
    ate_comma = false;

    if (this.check(exp.DotDot) || this.check_noexpect(TK.DotDotDot) || this.check_keyword(exp.Underscore)) {
      etc = { $: "Rest", _0: this.token.span };
      let etc_sp = this.token.span;
      if (first_etc_and_maybe_comma_span === undefined) {
        const comma_tok = this.look_ahead(1, (t) => (t.eq(TK.Comma) ? t : undefined));
        if (comma_tok !== undefined) {
          const sm = this.psess.source_map();
          const s = Span.trim_start(sm.span_extend_to_line(comma_tok.span), Span.shrink_to_lo(comma_tok.span));
          const nw_span = s === undefined ? undefined : this.psess.source_map().span_until_non_whitespace(s);
          first_etc_and_maybe_comma_span = nw_span === undefined ? undefined : Span.to(etc_sp, nw_span);
        } else {
          first_etc_and_maybe_comma_span = this.psess.source_map().span_until_non_whitespace(etc_sp);
        }
      }

      this.recover_bad_dot_dot();
      this.bump(); // `..` || `...` || `_`

      if (this.token.eq(TK.CloseBrace)) {
        break;
      }
      const token_str = token_descr(this.token);
      const msg = `expected \`}\`, found ${token_str}`;
      const err = this.dcx().struct_span_err(this.token.span, msg);

      err.span_label(this.token.span, "expected `}`");
      let comma_sp: Span | undefined = undefined;
      if (this.token.eq(TK.Comma)) {
        // Issue #49257
        const nw_span = this.psess.source_map().span_until_non_whitespace(this.token.span);
        etc_sp = Span.to(etc_sp, nw_span);
        err.span_label(etc_sp, "`..` must be at the end and cannot have a trailing comma");
        comma_sp = this.token.span;
        this.bump();
        ate_comma = true;
      }

      if (this.token.eq(TK.CloseBrace)) {
        // If the struct looks otherwise well formed, recover and continue.
        if (comma_sp !== undefined) {
          const sp = comma_sp;
          err.span_suggestion_short(sp, "remove this comma", "", Applicability.MachineApplicable);
        }
        err.emit();
        break;
      } else if (this.token.is_ident() && ate_comma) {
        // Accept fields coming after `..,`.
        // This way we avoid "pattern missing fields" errors afterwards.
        // We delay this error until the end in order to have a span for a
        // suggested fix.
        if (delayed_err !== undefined) {
          delayed_err.emit();
          return Err(err);
        } else {
          delayed_err = err;
        }
      } else {
        if (delayed_err !== undefined) {
          delayed_err.emit();
        }
        return Err(err);
      }
    }

    const ra = this.parse_outer_attributes();
    let attrs;
    if (ra.$ === "Ok") {
      attrs = ra._0;
    } else {
      const err = ra._0;
      if (delayed_err !== undefined) {
        delayed_err.emit();
      }
      return Err(err);
    }
    const lo = this.token.span;

    const rf = this.collect_tokens<PatField>(
      undefined,
      attrs,
      ForceCollect.No,
      (this_, attrs) => {
        let field: PatField;
        const r = this_.parse_pat_field(lo, attrs);
        if (r.$ === "Ok") {
          field = r._0;
        } else {
          const err = r._0;
          // PORT: `delayed_err.take()`.
          const d = delayed_err;
          delayed_err = undefined;
          if (d !== undefined) {
            d.emit();
          }
          return Err(err);
        }
        ate_comma = this_.eat(exp.Comma);

        last_non_comma_dotdot_span = this_.prev_token.span;

        // We just ate a comma, so there's no need to capture a trailing token.
        return Ok([field, Trailing.No, UsePreAttrPos.No]);
      },
      HasTokens.PatField,
      HasAttrs.PatField,
    );
    if (rf.$ === "Err") return rf;
    const field = rf._0;

    fields.push(field);
  }

  if (delayed_err !== undefined) {
    const err: Diag = delayed_err;
    if (first_etc_and_maybe_comma_span !== undefined) {
      const first_etc_span: Span = first_etc_and_maybe_comma_span;
      if (this.prev_token.eq(TK.DotDot)) {
        // We have `.., x, ..`.
        err.multipart_suggestion("remove the starting `..`", [[first_etc_span, ""]], Applicability.MachineApplicable);
      } else if (last_non_comma_dotdot_span !== undefined) {
        const last: Span = last_non_comma_dotdot_span;
        // We have `.., x`.
        err.multipart_suggestion(
          "move the `..` to the end of the field list",
          [
            [first_etc_span, ""],
            [Span.to(this.token.span, Span.shrink_to_hi(last)), `${ate_comma ? "" : ","} .. }`],
          ],
          Applicability.MachineApplicable,
        );
      }
    }
    err.emit();
  }
  return Ok([fields, etc]);
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1841 report_misplaced_at_in_struct_pat
Parser.prototype.report_misplaced_at_in_struct_pat = function (this: Parser, prev_field: Ident): Diag {
  // debug_assert_eq!(self.token, token::At);
  const span = Span.to(prev_field.span, this.token.span);
  const dot_dot_span = this.look_ahead(1, (t) => (t.eq(TK.DotDot) ? t.span : undefined));
  if (dot_dot_span !== undefined) {
    return this.dcx().create_err(
      diagnostics.AtDotDotInStructPattern_diagnostic({
        span: Span.to(span, dot_dot_span),
        remove: Span.until(span, dot_dot_span),
        ident: prev_field,
      }),
    );
  } else {
    return this.dcx().create_err(diagnostics.AtInStructPattern_diagnostic({ span }));
  }
};

/// If the user writes `S { ref field: name }` instead of `S { field: ref name }`, we suggest
/// the correct code.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1859 recover_misplaced_pattern_modifiers
Parser.prototype.recover_misplaced_pattern_modifiers = function (this: Parser, fields: PatField[], err: Diag): void {
  const last = fields[fields.length - 1];
  if (last === undefined || !last.is_shorthand) return;
  const k = last.pat.kind;
  if (k.$ !== "Ident" || k._2 !== undefined) return;
  const binding = k._0;
  const ident = k._1;
  if (ast.BindingMode_eq(binding, BindingMode.NONE) || !this.token.eq(TK.Colon)) return;
  // We found `ref mut? ident:`, try to parse a `name,` or `name }`.
  const name_span = this.look_ahead(1, (t) => (t.is_ident() ? t.span : undefined));
  if (name_span !== undefined && this.look_ahead(2, (t) => t.eq(TK.Comma) || t.eq(TK.CloseBrace))) {
    const span = Span.with_hi(last.pat.span, Span.lo(ident.span));
    // We have `S { ref field: name }` instead of `S { field: ref name }`
    err.multipart_suggestion(
      "the pattern modifiers belong after the `:`",
      [
        [span, ""],
        [Span.shrink_to_lo(name_span), binding.prefix_str()],
      ],
      Applicability.MachineApplicable,
    );
  }
};

/// Recover on `...` or `_` as if it were `..` to avoid further errors.
/// See issue #46718.
// rustc: compiler/rustc_parse/src/parser/pat.rs:1886 recover_bad_dot_dot
Parser.prototype.recover_bad_dot_dot = function (this: Parser): void {
  if (this.token.eq(TK.DotDot)) {
    return;
  }

  const token_str = pprust.token_to_string(this.token);
  this.dcx().emit_err(diagnostics.DotDotDotForRemainingFields_diagnostic({ span: this.token.span, token_str }));
};

/// Parse a field in a struct pattern.
///
/// ```ebnf
/// PatField = FieldName ":" Pat | "mut"? ByRef? Ident
/// ```
// rustc: compiler/rustc_parse/src/parser/pat.rs:1900 parse_pat_field
Parser.prototype.parse_pat_field = function (this: Parser, lo: Span, attrs: AttrVec): PResult<PatField> {
  let hi: Span;
  let subpat: Pat;
  let fieldname: Ident;
  let is_shorthand: boolean;
  if (this.look_ahead(1, (t) => t.eq(TK.Colon))) {
    const rf = this.parse_field_name();
    if (rf.$ === "Err") return rf;
    const fieldname_ = rf._0;
    this.bump();
    const rp = this.parse_pat_allow_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.EitherTupleOrPipe);
    if (rp.$ === "Err") return rp;
    const pat = rp._0;
    hi = pat.span;
    [subpat, fieldname, is_shorthand] = [pat, fieldname_, false];
  } else {
    // FIXME: remove the recovery for parsing box patterrns entirely
    let is_box: Span | undefined;
    if (this.eat_keyword(exp.Box)) {
      const span = this.prev_token.span;
      this.dcx().span_delayed_bug(span, "box patterns have been removed");
      is_box = span;
    } else {
      is_box = undefined;
    }
    const boxed_span = this.token.span;
    const mutability = this.parse_mutability();
    const by_ref = this.parse_byref();

    const rf = this.parse_ident_common(false);
    if (rf.$ === "Err") return rf;
    const fieldname_ = rf._0;
    hi = this.prev_token.span;
    const ann = new BindingMode(by_ref, mutability);
    const fieldpat = this.mk_pat_ident(Span.to(boxed_span, hi), ann, fieldname_);
    const fk = fieldpat.kind;
    if (fk.$ === "Ident" && fk._0._0.$ === "Yes" && fk._0._1 === "Mut") {
      this.psess.gated_spans.gate(sym.mut_ref, fieldpat.span);
    }
    let subpat_: Pat;
    if (is_box !== undefined) {
      const box_span = is_box;
      const prefix_span = Span.until(box_span, boxed_span);

      this.dcx().emit_err(
        diagnostics.BoxPatsRemoved_diagnostic({
          span: box_span,
          sugg_deref_macro_call: {
            field: [prefix_span, fieldname_],
            before: Span.shrink_to_lo(boxed_span),
            after: Span.shrink_to_hi(hi),
          },
          sugg_removal: prefix_span,
        }),
      );

      subpat_ = this.mk_pat(Span.to(lo, hi), { $: "Deref", _0: fieldpat });
    } else {
      subpat_ = fieldpat;
    }
    [subpat, fieldname, is_shorthand] = [subpat_, fieldname_, true];
  }

  return Ok({
    ident: fieldname,
    pat: subpat,
    is_shorthand,
    attrs,
    id: ast.DUMMY_NODE_ID,
    span: Span.to(lo, hi),
    is_placeholder: false,
  });
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1967 mk_pat_ident
Parser.prototype.mk_pat_ident = function (this: Parser, span: Span, ann: BindingModeT, ident: Ident): Pat {
  return this.mk_pat(span, { $: "Ident", _0: ann, _1: ident, _2: undefined });
};

// rustc: compiler/rustc_parse/src/parser/pat.rs:1971 mk_pat
Parser.prototype.mk_pat = function (this: Parser, span: Span, kind: PatKind): Pat {
  return new ast.Pat(ast.DUMMY_NODE_ID, kind, span);
};
