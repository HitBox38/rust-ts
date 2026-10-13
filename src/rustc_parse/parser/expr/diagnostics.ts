// Port of compiler/rustc_parse/src/parser/expr/diagnostics.rs
// Types (`IncOrDec`, `UnaryFixity`) are generated into diagnostics.gen.ts.
//
// PORT: `impl Parser` methods are assigned onto `Parser.prototype` (declared in ../decls.ts).
// Init order (parser/mod.ts): this module's top-level code touches only `Parser`, its own
// `.gen.ts` and non-parser modules.
import { ast, token } from "../../../rustc_ast/lib.ts";
import type { Expr } from "../../../rustc_ast/lib.ts";
import { AssocOp } from "../../../rustc_ast/util/parser.ts";
import * as pprust from "../../../rustc_ast_pretty/pprust/mod.ts";
import type { Diag, PResult } from "../../../rustc_errors/lib.ts";
import { Applicability } from "../../../rustc_lint_defs/lib.ts";
import { Span, type Spanned, respan } from "../../../rustc_span/lib.ts";
import { sym } from "../../../rustc_span/symbol.ts";
import { is_whitespace } from "../../../std/char.ts";
import { Err, Ok } from "../../../std/result.ts";
import * as diagnostics from "../../diagnostics.ts";
import { Parser } from "../mod.ts";
import { exp } from "../token_type.ts";
import type { IncOrDec, UnaryFixity } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

const { TokenKind: TK } = token;

// ---- impl<'a> Parser<'a> ----

/// Recover from a binary operator after complete statement expression as in `{ 4 } / 2`.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:12 recover_from_bin_op_after_complete_stmt_expr
Parser.prototype.recover_from_bin_op_after_complete_stmt_expr = function (this: Parser, lhs: Expr): boolean {
  // use BinOpKind::*;

  // Starting point: We've just parsed a *complete* stmt expr (e.g., a block like `{ 4 }`).

  const op = AssocOp.from_token(this.token);
  if (op === undefined) return false;

  // We've now encountered a token that could(!) be interpreted as a binary operator. This
  // could mean that the user intended to write a binary operation where the left operand is
  // block-like. In that case they would need to parenthesize the LHS or the entire operation
  // (e.g., `{ 4 } / 2` -> `({ 4 }) / 2` or `({ 4 } / 2)`).

  if (op_can_continue_stmt_expr_unambiguously(op)) {
    // We know that the token (e.g., `/`) can't possibly begin a new statement or pattern.
    // Instead of letting the stmt/pat parser emit a generic & rather confusing diagnostic,
    // let's emit a more targeted one, and continue parsing the expression.

    this.dcx().emit_err(
      diagnostics.FoundExprWouldBeStmt_diagnostic({
        span: this.token.span,
        token: pprust.token_to_string(this.token),
        suggestion: diagnostics.ExprParenthesesNeeded.surrounding(lhs.span),
      }),
    );
    return true;
  }

  // The token can begin a new statement or pattern; this means we're on the happy path!
  // Still, the user might've meant to write a bin op here but we can't tell at this stage of
  // compilation. So if it's a "common lookalike" let's proactively register it somewhere for
  // later stages of compilation to potentially retrieve (e.g., in typeck).
  //
  // We've left out `BitAnd` because guessing its intent is hard. We can make suggestions
  // based on the assumption that double-refs are rarely intentional, and closures are
  // distinct enough that they don't get mixed up with their return value.
  if (
    op.$ === "Binary" &&
    (op._0 === "Add" || op._0 === "And" || op._0 === "BitOr" || op._0 === "Mul" || op._0 === "Or" || op._0 === "Sub")
  ) {
    const sp = this.psess.source_map().start_point(this.token.span);
    this.psess.complete_stmt_exprs_before_bin_op_lookalike.set(sp, lhs.span);
  }

  return false;
};

/// Recover from alphabetic logic operators `and` and `or` as found in e.g., Python and PHP.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:57 recover_from_alpha_logic_op
Parser.prototype.recover_from_alpha_logic_op = function (this: Parser): Spanned<AssocOp> | undefined {
  let ident: ReturnType<typeof this.token.non_raw_ident>;
  if (this.may_recover() && (ident = this.token.non_raw_ident()) !== undefined) {
    let op: ast.BinOpKind;
    let sub: (s: Span) => diagnostics.InvalidLogicalOperatorSub;
    switch (ident.name) {
      case sym.and:
        op = ast.BinOpKind.And;
        sub = (_0) => ({ $: "Conjunction", _0 });
        break;
      case sym.or:
        op = ast.BinOpKind.Or;
        sub = (_0) => ({ $: "Disjunction", _0 });
        break;
      default:
        return undefined;
    }

    this.dcx().emit_err(
      diagnostics.InvalidLogicalOperator_diagnostic({
        span: this.token.span,
        incorrect: ident.name,
        sub: sub(this.token.span),
      }),
    );

    return respan(this.token.span, { $: "Binary", _0: op });
  } else {
    return undefined;
  }
};

/// Reject `...` being used as an expression operator.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:80 reject_dotdotdot_expr_op
Parser.prototype.reject_dotdotdot_expr_op = function (this: Parser): void {
  if (this.token.eq(TK.DotDotDot)) {
    this.dcx().emit_err(diagnostics.DotDotDotExprOp_diagnostic({ span: this.token.span }));
  }
};

/// Reject `<-` being used as an expression operator.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:87 reject_larrow_expr_op
Parser.prototype.reject_larrow_expr_op = function (this: Parser): void {
  if (this.token.eq(TK.LArrow)) {
    this.dcx().emit_err(diagnostics.LArrowExprOp_diagnostic({ span: this.token.span }));
  }
};

/// Recover from strict equality operators `===` and `!==` as found in e.g., JS and PHP.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:94 recover_from_strict_eq_op
Parser.prototype.recover_from_strict_eq_op = function (this: Parser, op: Spanned<AssocOp>): void {
  const node = op.node;
  if (
    node.$ === "Binary" &&
    (node._0 === ast.BinOpKind.Eq || node._0 === ast.BinOpKind.Ne) &&
    this.token.eq(TK.Eq) &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span)
  ) {
    const bop = node._0;
    const sp = Span.to(op.span, this.token.span);
    const sugg = ast.BinOpKind.as_str(bop);
    const invalid = `${sugg}=`;
    this.dcx().emit_err(
      diagnostics.InvalidComparisonOperator_diagnostic({
        span: sp,
        invalid: invalid,
        sub: {
          $: "Correctable",
          span: sp,
          invalid,
          correct: sugg,
        },
      }),
    );
    this.bump();
  }
};

/// Recover from inequality operator `<>` ("diamond") as found in e.g., PHP.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:116 recover_from_diamond_ne_op
Parser.prototype.recover_from_diamond_ne_op = function (this: Parser): void {
  if (
    this.prev_token.kind.$ === "Lt" &&
    this.token.kind.$ === "Gt" &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span)
  ) {
    const sp = Span.to(this.prev_token.span, this.token.span);
    this.dcx().emit_err(
      diagnostics.InvalidComparisonOperator_diagnostic({
        span: sp,
        invalid: "<>",
        sub: {
          $: "Correctable",
          span: sp,
          invalid: "<>",
          correct: "!=",
        },
      }),
    );
    this.bump();
  }
};

/// Recover from comparison operator `<=>` ("spaceship") as found in e.g., C++.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:135 recover_from_spaceship_cmp_op
Parser.prototype.recover_from_spaceship_cmp_op = function (this: Parser): void {
  if (
    this.prev_token.kind.$ === "Le" &&
    this.token.kind.$ === "Gt" &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span)
  ) {
    const sp = Span.to(this.prev_token.span, this.token.span);
    this.dcx().emit_err(
      diagnostics.InvalidComparisonOperator_diagnostic({
        span: sp,
        invalid: "<=>",
        sub: { $: "Spaceship", _0: sp },
      }),
    );
    this.bump();
  }
};

/// Recover from postfix increment operator `++` as found in many C-style languages.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:150 recover_from_postfix_inc_op
Parser.prototype.recover_from_postfix_inc_op = function (this: Parser, lhs: Expr, starts_stmt: boolean): PResult<undefined> {
  if (
    this.prev_token.kind.$ === "Plus" &&
    this.token.kind.$ === "Plus" &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span)
  ) {
    const op_span = Span.to(this.prev_token.span, this.token.span);
    this.bump(); // eat the second `+`
    return Err(this.report_inc_dec_op(lhs, starts_stmt, "Inc", "Post", op_span));
  } else {
    return Ok(undefined);
  }
};

/// Recover from postfix decrement operator `--` as found in many C-style languages.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:167 recover_from_postfix_dec_op
Parser.prototype.recover_from_postfix_dec_op = function (this: Parser, lhs: Expr, starts_stmt: boolean): PResult<undefined> {
  if (
    this.prev_token.kind.$ === "Minus" &&
    this.token.kind.$ === "Minus" &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span) &&
    !this.look_ahead(1, (tok) => tok.can_begin_expr())
  ) {
    const op_span = Span.to(this.prev_token.span, this.token.span);
    this.bump(); // eat the second `-`
    return Err(this.report_inc_dec_op(lhs, starts_stmt, "Dec", "Post", op_span));
  } else {
    return Ok(undefined);
  }
};

/// PORT: `str::trim` (Unicode `White_Space`, as `char::is_whitespace`).
function str_trim(s: string): string {
  const cs = [...s];
  let i = 0;
  let j = cs.length;
  while (i < j && is_whitespace(cs[i]!.codePointAt(0)!)) i++;
  while (j > i && is_whitespace(cs[j - 1]!.codePointAt(0)!)) j--;
  return cs.slice(i, j).join("");
}

/// Report increment operator `++` & decrement operator `--` as found in many C-style languages.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:185 report_inc_dec_op
Parser.prototype.report_inc_dec_op = function (
  this: Parser,
  base: Expr,
  starts_stmt: boolean,
  op: IncOrDec,
  fixity: UnaryFixity,
  op_span: Span,
): Diag {
  // FIXME: Don't return an error diag, emit the diag here *and* return a new expr of the form
  //        `$base += 1` / `$base -= 1` (taking `base: Expr` by value) for *proper* recovery.
  //        (Just emitting the diag would be insufficient since callers would most likely just
  //        use `$base` as the recovered AST node which would lead to annoying follow-up diags
  //        like "variable doesn't need to be mutable" getting emitted in some cases.)

  let err: Diag;
  {
    const fixity_ = fixity === "Pre" ? "prefix" : "postfix";
    const op_ = op === "Inc" ? "increment" : "decrement";
    err = this.dcx()
      .struct_span_err(op_span, `Rust has no ${fixity_} ${op_} operator`)
      .with_span_label(op_span, `not a valid ${fixity_} operator`);
  }

  const op2 = op === "Inc" ? "+= 1" : "-= 1";
  let pre_span: Span;
  let post_span: Span;
  switch (fixity) {
    case "Pre":
      [pre_span, post_span] = [op_span, Span.shrink_to_hi(base.span)];
      break;
    case "Post":
      [pre_span, post_span] = [Span.shrink_to_lo(base.span), op_span];
      break;
  }

  if (starts_stmt) {
    const patches: [Span, string][] = [];
    if (!Span.is_empty(pre_span)) {
      patches.push([pre_span, ""]);
    }
    patches.push([post_span, ` ${op2}`]);
    err.multipart_suggestion(`use \`${op2}\` instead`, patches, Applicability.MachineApplicable);
  } else {
    const r = this.span_to_snippet(base.span);
    if (r.$ !== "Ok") {
      err.help(`use \`${op2}\` instead`);
      return err;
    }
    const base_src = r._0;
    switch (fixity) {
      case "Pre":
        err.multipart_suggestion(
          `use \`${op2}\` instead`,
          [
            [pre_span, "{ "],
            [post_span, ` ${op2}; ${base_src} }`],
          ],
          Applicability.MachineApplicable,
        );
        break;
      case "Post":
        // won't suggest since we can not handle the precedences
        // for example: `a + b++` has been parsed (a + b)++ and we can not suggest here
        if (base.kind.$ !== "Binary") {
          const tmp_var = str_trim(base_src) === "tmp" ? "tmp_" : "tmp";
          err.multipart_suggestion(
            `use \`${op2}\` instead`,
            [
              [pre_span, `{ let ${tmp_var} = `],
              [post_span, `; ${base_src} ${op2}; ${tmp_var} }`],
            ],
            Applicability.HasPlaceholders,
          );
        }
        break;
    }
  }
  return err;
};

/// Recover from array expressions as found in C like `{0, 1, 2, 3}`.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:267 recover_from_c_array
Parser.prototype.recover_from_c_array = function (this: Parser, lo: Span): Expr | undefined {
  if (
    !this.may_recover() ||
    this.token.kind.$ !== "OpenBrace" ||
    this.look_ahead(1, (t) => t.kind.$ !== "Literal") ||
    this.look_ahead(2, (t) => !t.eq(TK.Comma)) ||
    this.look_ahead(3, (t) => !t.can_begin_expr())
  ) {
    return undefined;
  }

  const snapshot = this.create_snapshot_for_diagnostic();
  const r = snapshot.parser.parse_expr_array_or_repeat(exp.CloseBrace);
  if (r.$ === "Ok") {
    const arr = r._0;
    const guar = this.dcx().emit_err(
      diagnostics.ArrayBracketsInsteadOfBraces_diagnostic({
        span: arr.span,
        sub: {
          left: lo,
          right: snapshot.parser.prev_token.span,
        },
      }),
    );

    this.restore_snapshot(snapshot);
    return this.mk_expr_err(arr.span, guar);
  } else {
    const e = r._0;
    e.cancel();
    return undefined;
  }
};

/// Whether this operator could be used to follow a complete statement expression unambiguously
/// during parse error recovery.
// PORT(contract): the parser-core stub declared this over `token: &Token`; upstream takes `op: AssocOp`.
// rustc: compiler/rustc_parse/src/parser/expr/diagnostics.rs:301 op_can_continue_stmt_expr_unambiguously
export function op_can_continue_stmt_expr_unambiguously(op: AssocOp): boolean {
  // NOTE: At the time of writing, it's only safe to return `true` for tokens that don't share a
  //       prefix with statements or patterns. For context, statement lists and match arm bodies
  //       are (the only two) places that use `Restriction::STMT_EXPR` (in the happy path).

  // use BinOpKind::*;
  switch (op.$) {
    case "Assign":
    case "AssignOp":
    case "Cast":
      return true;
    case "Binary":
      switch (op._0) {
        case "BitXor":
        case "Div":
        case "Ge":
        case "Gt":
        case "Le":
        case "Rem":
        case "Shr":
          return true;
        case "Add": // unambiguous but would inhibit our recovery from unary plus
        case "And": // `&&` starts repeated borrow (e.g., `&&x`)
        case "BitAnd": // `&` starts borrow (e.g., `&x`)
        case "BitOr": // `|` starts closure (e.g., `|_| ()`) or leading vert (e.g., `| Some(_)`)
        case "Eq":
        case "Ne": // unambiguous but would inhibit our recovery from bad struct literals
        case "Lt": // `<` starts qualified path (e.g., `<T as X>::P`)
        case "Mul": // `*` starts unary deref (e.g., `*x`, `*x = 0`)
        case "Or": // `||` starts parameterless closure (e.g. `|| 0`)
        case "Shl": // `<<` starts repeated qualified path (e.g., `<<T>::Q as X>::P`)
        case "Sub":
          return false; // `-` starts unary negation (e.g, `-x`)
      }
    // falls through (exhaustive above)
    case "Range":
      return false; // `..`/`..=` start ranges w/o lower bound (e.g., `..`, `..=1`)
  }
}
