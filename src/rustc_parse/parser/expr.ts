// Port of compiler/rustc_parse/src/parser/expr.rs
// Types (`DestructuredFloat`, `LetChainsPolicy`, `CondChecker`, ...) are generated into expr.gen.ts.
//
// PORT: `impl Parser` methods are assigned onto `Parser.prototype` (declared in ./decls.ts).
// Init order (parser/mod.ts): this module's top-level code touches only `Parser`, its own
// `.gen.ts` and non-parser modules; other extension modules are used inside fn bodies only.
import { ast, token, HasAttrs, HasTokens } from "../../rustc_ast/lib.ts";
import type {
  AnonConst,
  Arm,
  AssignOp,
  AttrVec,
  BinOp,
  Block,
  BlockCheckMode,
  CaptureBy,
  Expr,
  ExprField,
  ExprKind,
  FnDecl,
  Guard,
  Label,
  MatchKind,
  MetaItemLit,
  Param,
  Pat,
  Path,
  QSelf,
  RangeLimits,
  StrLit,
  StructRest,
  Ty,
  UnOp,
  UnsafeBinderCastKind,
} from "../../rustc_ast/lib.ts";
import type { Lit, MetaVarKind, Token, TokenKind } from "../../rustc_ast/token.ts";
import { MetaItemLit as MetaItemLitC } from "../../rustc_ast/util/literal.ts";
import { Visitor, walk_expr } from "../../rustc_ast/visit.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { BREAK_WITH_LABEL_AND_LOOP } from "../../rustc_lint_defs/builtin.ts";
import { report_lit_error } from "../../rustc_session/diagnostics.ts";
import { clone_ExprKind, DUMMY_NODE_ID, GenericArgs } from "../../rustc_ast/ast.ts";
import * as classify from "../../rustc_ast/util/classify.ts";
import { AssocOp, ExprPrecedence, ExprPrecedence_discriminant, type Fixity } from "../../rustc_ast/util/parser.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { type Diag, type PResult, StashKey } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { BytePos, type ErrorGuaranteed, Span, type SpanSnippetError, type Spanned, respan } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { is_ascii_alphanumeric } from "../../std/char.ts";
import { debug_char, debug_str, debug_tuple, debug_vec, PLAIN, type Fmt } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { type Str, utf8_len } from "../../std/str.ts";
import * as crate_diagnostics from "../diagnostics.ts";
import { AttrWrapper, UsePreAttrPos } from "./attr_wrapper.ts";
import { RecoverQPath, type SnapshotParser } from "./diagnostics.ts";
import * as diagnostics from "./expr/diagnostics.ts";
import * as gen from "./expr.gen.ts";
import type { DestructuredFloat, LetChainsPolicy } from "./expr.gen.ts";
import { clone_Parser, ForceCollect, Parser, Restrictions, SeqSep, token_descr, Trailing } from "./mod.ts";
import { PathStyle } from "./path.ts";
import { exp, type ExpTokenPair, TokenType } from "./token_type.ts";

export * from "./expr.gen.ts";

const { TokenKind: TK, IdentKind } = token;

/// PORT: `std::ops::Bound<T>` (used by `parse_expr_assoc_with`); belongs in src/std (root).
export type Bound<T> = { readonly $: "Included"; _0: T } | { readonly $: "Excluded"; _0: T } | { readonly $: "Unbounded" };
const Bound_Unbounded: Bound<never> = Object.freeze({ $: "Unbounded" as const });

/// PORT: `ExprPrecedence: PartialOrd` (derived; declaration order).
function prec_lt(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] < ExprPrecedence_discriminant[b];
}

/// PORT: `mem::replace(self, new)` for `&mut Parser`: the current state moves into a fresh
/// `Parser` object (returned) and `self` takes the fields of `new_`.
function mem_replace_parser(self: Parser, new_: Parser): Parser {
  const old = Object.assign(Object.create(Parser.prototype) as Parser, self);
  Object.assign(self, new_);
  return old;
}

/// PORT: the `RecoverQPath` impl table for `Box<Expr>` (the `T` of `maybe_recover_from_bad_qpath*`
/// calls on `Box<Expr>` values). Built per call: the table lives in ./diagnostics.ts (init order).
function expr_recover_qpath(): RecoverQPath<Expr> {
  return RecoverQPath.Box(RecoverQPath.Expr);
}

// ---- impl<'a> Parser<'a> ----

/// Parses an expression.
// rustc: compiler/rustc_parse/src/parser/expr.rs:56 parse_expr
Parser.prototype.parse_expr = function (this: Parser): PResult<Expr> {
  this.current_closure = undefined;
  return this.parse_expr_res(Restrictions.empty());
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:61 parse_expr_in_let
Parser.prototype.parse_expr_in_let = function (this: Parser): PResult<Expr> {
  this.current_closure = undefined;
  return this.parse_expr_res(Restrictions.IN_LET);
};

/// Parses an expression, forcing tokens to be collected.
// rustc: compiler/rustc_parse/src/parser/expr.rs:66 parse_expr_force_collect
Parser.prototype.parse_expr_force_collect = function (this: Parser): PResult<Expr> {
  this.current_closure = undefined;

  // If the expression is associative (e.g. `1 + 2`), then any preceding
  // outer attribute actually belongs to the first inner sub-expression.
  // In which case we must use the pre-attr pos to include the attribute
  // in the collected tokens for the outer expression.
  const pre_attr_pos = this.collect_pos();
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  return this.collect_tokens(
    pre_attr_pos,
    AttrWrapper.empty(),
    ForceCollect.Yes,
    (this_, _empty_attrs) => {
      const r = this_.parse_expr_res_after_attrs(Restrictions.empty(), attrs);
      if (r.$ === "Err") return r;
      const [expr, is_assoc] = r._0;
      const use_pre_attr_pos = is_assoc ? UsePreAttrPos.Yes : UsePreAttrPos.No;
      return Ok([expr, Trailing.No, use_pre_attr_pos]);
    },
    HasTokens.Expr,
    HasAttrs.Expr,
  );
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:89 parse_expr_anon_const
Parser.prototype.parse_expr_anon_const = function (this: Parser): PResult<AnonConst> {
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  return Ok({ id: DUMMY_NODE_ID, value: r._0 });
};

/// Parses a sequence of expressions delimited by parentheses.
// rustc: compiler/rustc_parse/src/parser/expr.rs:94 parse_expr_paren_seq
Parser.prototype.parse_expr_paren_seq = function (this: Parser): PResult<Expr[]> {
  const r = this.parse_paren_comma_seq((this_) => this_.parse_expr());
  if (r.$ === "Err") return r;
  return Ok(r._0[0]);
};

/// Parses an expression, subject to the given restrictions.
// rustc: compiler/rustc_parse/src/parser/expr.rs:100 parse_expr_res
Parser.prototype.parse_expr_res = function (this: Parser, r: Restrictions): PResult<Expr> {
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  const res = this.parse_expr_res_after_attrs(r, attrs);
  if (res.$ === "Err") return res;
  return Ok(res._0[0]);
};

/// Same as `parse_expr_res`, but with attributes already pre-parsed.
/// The `bool` in the return value indicates if it was an assoc expr, i.e. with an operator
/// followed by a subexpression (e.g. `1 + 2`).
// rustc: compiler/rustc_parse/src/parser/expr.rs:109 parse_expr_res_after_attrs
Parser.prototype.parse_expr_res_after_attrs = function (
  this: Parser,
  r: Restrictions,
  attrs: AttrWrapper,
): PResult<[Expr, boolean]> {
  return this.with_res(r, (this_) => this_.parse_expr_assoc_after_attrs(Bound_Unbounded, attrs));
};

/// Parses an associative expression with operators of at least `min_prec` precedence.
// rustc: compiler/rustc_parse/src/parser/expr.rs:118 parse_expr_assoc
Parser.prototype.parse_expr_assoc = function (this: Parser, min_prec: Bound<ExprPrecedence>): PResult<Expr> {
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  const r = this.parse_expr_assoc_after_attrs(min_prec, attrs);
  if (r.$ === "Err") return r;
  return Ok(r._0[0]);
};

/// Same as `parse_expr_assoc`, but with attributes already pre-parsed.
/// The `bool` in the return value indicates if it was an assoc expr, i.e. with an operator
/// followed by a subexpression (e.g. `1 + 2`).
// rustc: compiler/rustc_parse/src/parser/expr.rs:129 parse_expr_assoc_after_attrs
Parser.prototype.parse_expr_assoc_after_attrs = function (
  this: Parser,
  min_prec: Bound<ExprPrecedence>,
  attrs: AttrWrapper,
): PResult<[Expr, boolean]> {
  let lhs: Expr;
  if (this.token.is_range_separator()) {
    const r = this.parse_expr_prefix_range(attrs);
    if (r.$ === "Err") return r;
    return Ok([r._0, false]);
  } else {
    const r = this.parse_expr_prefix(attrs);
    if (r.$ === "Err") return r;
    lhs = r._0;
  }
  return this.parse_expr_assoc_rest(min_prec, false, lhs);
};

/// Parses the rest of an associative expression (i.e. the part after the lhs) with operators
/// of at least `min_prec` precedence. The `bool` in the return value indicates if something
/// was actually parsed.
// rustc: compiler/rustc_parse/src/parser/expr.rs:145 parse_expr_assoc_rest
Parser.prototype.parse_expr_assoc_rest = function (
  this: Parser,
  min_prec: Bound<ExprPrecedence>,
  starts_stmt: boolean,
  lhs: Expr,
): PResult<[Expr, boolean]> {
  let parsed_something = false;
  if (this.expr_is_complete(lhs) && !this.recover_from_bin_op_after_complete_stmt_expr(lhs)) {
    return Ok([lhs, parsed_something]);
  }

  this.expected_token_types.insert(TokenType.Operator);
  let op: Spanned<AssocOp> | undefined;
  while ((op = this.check_assoc_op()) !== undefined) {
    const op_ = op;
    const lhs_span = this.interpolated_or_expr_span(lhs);
    const restrictions = AssocOp.is_assign_like(op_.node)
      ? Restrictions.intersection(this.restrictions, Restrictions.NO_STRUCT_LITERAL)
      : this.restrictions;
    const prec = AssocOp.precedence(op_.node);
    let stop: boolean;
    switch (min_prec.$) {
      case "Included":
        stop = prec_lt(prec, min_prec._0);
        break;
      case "Excluded":
        stop = prec_lt(prec, min_prec._0) || prec === min_prec._0;
        break;
      case "Unbounded":
        stop = false;
        break;
    }
    if (stop) {
      break;
    }

    this.reject_dotdotdot_expr_op();
    this.reject_larrow_expr_op();

    parsed_something = true;
    this.bump();

    if (AssocOp.is_comparison(op_.node)) {
      const r = this.check_no_chained_comparison(lhs, op_);
      if (r.$ === "Err") return r;
      const expr = r._0;
      if (expr !== undefined) {
        return Ok([expr, parsed_something]);
      }
    }

    this.recover_from_strict_eq_op(op_);
    this.recover_from_diamond_ne_op();
    this.recover_from_spaceship_cmp_op();
    const r1 = this.recover_from_postfix_inc_op(lhs, starts_stmt);
    if (r1.$ === "Err") return r1;
    const r2 = this.recover_from_postfix_dec_op(lhs, starts_stmt);
    if (r2.$ === "Err") return r2;

    let min_prec_: Bound<ExprPrecedence>;
    const fixity: Fixity = AssocOp.fixity(op_.node);
    switch (fixity) {
      case "Right":
        min_prec_ = { $: "Included", _0: prec };
        break;
      case "Left":
      case "None":
        min_prec_ = { $: "Excluded", _0: prec };
        break;
    }

    const lhs_ = lhs;
    const finish_parsing_bin_op = (this_: Parser): PResult<[Expr, Span]> => {
      const r = this_.with_res(Restrictions.difference(restrictions, Restrictions.STMT_EXPR), (this__) =>
        this__.parse_expr_assoc(min_prec_),
      );
      if (r.$ === "Err") return r;
      const rhs = r._0;
      const span = this_.mk_expr_sp(lhs_, lhs_span, op_.span, rhs.span);
      return Ok([rhs, span]);
    };

    const node = op_.node;
    switch (node.$) {
      case "Binary": {
        const ast_op = node._0;
        const r = finish_parsing_bin_op(this);
        if (r.$ === "Err") return r;
        const [rhs, span] = r._0;
        lhs = this.mk_expr(span, this.mk_binary(respan(op_.span, ast_op), lhs, rhs));
        break;
      }
      case "AssignOp": {
        const aop = node._0;
        const r = finish_parsing_bin_op(this);
        if (r.$ === "Err") return r;
        const [rhs, span] = r._0;
        lhs = this.mk_expr(span, this.mk_assign_op(respan(op_.span, aop), lhs, rhs));
        break;
      }
      case "Assign": {
        const r = finish_parsing_bin_op(this);
        if (r.$ === "Err") return r;
        const [rhs, span] = r._0;
        lhs = this.mk_expr(span, { $: "Assign", _0: lhs, _1: rhs, _2: op_.span });
        break;
      }
      case "Cast": {
        const r = this.parse_assoc_op_cast(lhs, lhs_span, op_.span);
        if (r.$ === "Err") return r;
        lhs = r._0;
        break;
      }
      case "Range": {
        const limits = node._0;
        const r = this.parse_expr_range(min_prec_, lhs, limits, op_.span);
        if (r.$ === "Err") return r;
        lhs = r._0;
        break;
      }
    }

    if (op_.node.$ === "Range") {
      break;
    }
  }

  return Ok([lhs, parsed_something]);
};

/// Possibly translate the current token to an associative operator.
/// The method does not advance the current token.
// rustc: compiler/rustc_parse/src/parser/expr.rs:231 check_assoc_op
Parser.prototype.check_assoc_op = function (this: Parser): Spanned<AssocOp> | undefined {
  const op = AssocOp.from_token(this.token);

  // When parsing const expressions, stop parsing when encountering `>`.
  if (
    Restrictions.contains(this.restrictions, Restrictions.CONST_EXPR) &&
    op !== undefined &&
    ((op.$ === "Binary" && (op._0 === "Shr" || op._0 === "Gt" || op._0 === "Ge")) ||
      (op.$ === "AssignOp" && op._0 === "ShrAssign"))
  ) {
    return undefined;
  }

  // When recovering patterns as expressions, stop parsing when encountering an
  // assignment `=`, an alternative `|`, or a range `..`.
  if (
    Restrictions.contains(this.restrictions, Restrictions.IS_PAT) &&
    op !== undefined &&
    (op.$ === "Assign" || op.$ === "AssignOp" || (op.$ === "Binary" && op._0 === "BitOr") || op.$ === "Range")
  ) {
    return undefined;
  }

  if (op !== undefined) {
    return respan(this.token.span, op);
  }

  return this.recover_from_alpha_logic_op();
};

/// Checks if this expression is a successfully parsed statement.
// rustc: compiler/rustc_parse/src/parser/expr.rs:263 expr_is_complete
Parser.prototype.expr_is_complete = function (this: Parser, e: Expr): boolean {
  return Restrictions.contains(this.restrictions, Restrictions.STMT_EXPR) && classify.expr_is_complete(e);
};

/// Parses `x..y`, `x..=y`, and `x..`/`x..=`.
/// The other two variants are handled in `parse_prefix_range_expr` below.
// rustc: compiler/rustc_parse/src/parser/expr.rs:269 parse_expr_range
Parser.prototype.parse_expr_range = function (
  this: Parser,
  min_prec: Bound<ExprPrecedence>,
  lhs: Expr,
  limits: RangeLimits,
  cur_op_span: Span,
): PResult<Expr> {
  let rhs: Expr | undefined;
  if (this.is_at_start_of_range_notation_rhs()) {
    const maybe_lt = this.token;
    const r = this.parse_expr_assoc(min_prec);
    if (r.$ === "Err") return Err(this.maybe_err_dotdotlt_syntax(maybe_lt, r._0));
    rhs = r._0;
  } else {
    rhs = undefined;
  }
  const rhs_span = rhs === undefined ? cur_op_span : rhs.span;
  const span = this.mk_expr_sp(lhs, lhs.span, cur_op_span, rhs_span);
  const range = this.mk_range(lhs, rhs, limits);
  return Ok(this.mk_expr(span, range));
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:291 is_at_start_of_range_notation_rhs
Parser.prototype.is_at_start_of_range_notation_rhs = function (this: Parser): boolean {
  if (this.token.can_begin_expr()) {
    // Parse `for i in 1.. { }` as infinite loop, not as `for i in (1..{})`.
    if (this.token.eq(TK.OpenBrace)) {
      return !Restrictions.contains(this.restrictions, Restrictions.NO_STRUCT_LITERAL);
    }
    return true;
  } else {
    return false;
  }
};

/// Parses prefix-forms of range notation: `..expr`, `..`, `..=expr`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:304 parse_expr_prefix_range
Parser.prototype.parse_expr_prefix_range = function (this: Parser, attrs: AttrWrapper): PResult<Expr> {
  if (!attrs.is_empty()) {
    const err: crate_diagnostics.DotDotRangeAttribute = { span: this.token.span };
    this.dcx().emit_err(crate_diagnostics.DotDotRangeAttribute_diagnostic(err));
  }

  this.reject_dotdotdot_expr_op();

  // debug_assert!(
  //     self.token.is_range_separator(),
  //     "parse_prefix_range_expr: token {:?} is not DotDot/DotDotEq",
  //     self.token
  // );

  const limits: RangeLimits = this.token.kind.$ === "DotDot" ? ast.RangeLimits.HalfOpen : ast.RangeLimits.Closed;
  const op = AssocOp.from_token(this.token);
  return this.collect_tokens_for_expr(AttrWrapper.empty(), (this_, _empty_attrs) => {
    const lo = this_.token.span;
    const maybe_lt = this_.look_ahead(1, (t) => t);
    this_.bump();
    let span: Span;
    let opt_end: Expr | undefined;
    if (this_.is_at_start_of_range_notation_rhs()) {
      // RHS must be parsed with more associativity than the dots.
      const r = this_.parse_expr_assoc({ $: "Excluded", _0: AssocOp.precedence(unwrap(op)) });
      if (r.$ === "Err") return Err(this_.maybe_err_dotdotlt_syntax(maybe_lt, r._0));
      const expr = r._0;
      span = Span.to(lo, expr.span);
      opt_end = expr;
    } else {
      span = lo;
      opt_end = undefined;
    }
    const range = this_.mk_range(undefined, opt_end, limits);
    return Ok(this_.mk_expr(span, range));
  });
};

/// Parses a prefix-unary-operator expr.
// rustc: compiler/rustc_parse/src/parser/expr.rs:341 parse_expr_prefix
Parser.prototype.parse_expr_prefix = function (this: Parser, attrs: AttrWrapper): PResult<Expr> {
  const lo = this.token.span;

  // PORT: `macro_rules! make_it` -> a local closure.
  const make_it = (this_: Parser, attrs_: AttrWrapper, body: (this_: Parser) => PResult<[Span, ExprKind]>) =>
    this_.collect_tokens_for_expr(attrs_, (this__, attrs__) => {
      const r = body(this__);
      if (r.$ === "Err") return r;
      const [hi, ex] = r._0;
      return Ok(this__.mk_expr_with_attrs(Span.to(lo, hi), ex, attrs__));
    });

  const this_ = this;

  // Note: when adding new unary operators, don't forget to adjust TokenKind::can_begin_expr()
  const kind = this_.token.uninterpolate().kind;
  switch (kind.$) {
    // `!expr`
    case "Bang":
      return make_it(this_, attrs, (this__) => this__.parse_expr_unary(lo, ast.UnOp.Not));
    // `~expr`
    case "Tilde":
      return make_it(this_, attrs, (this__) => this__.recover_tilde_expr(lo));
    // `-expr`
    case "Minus":
      return make_it(this_, attrs, (this__) => this__.parse_expr_unary(lo, ast.UnOp.Neg));
    // `*expr`
    case "Star":
      return make_it(this_, attrs, (this__) => this__.parse_expr_unary(lo, ast.UnOp.Deref));
    // `&expr` and `&&expr`
    case "And":
    case "AndAnd":
      return make_it(this_, attrs, (this__) => this__.parse_expr_borrow(lo));
  }
  // `+lit`
  if (kind.$ === "Plus" && this_.look_ahead(1, (tok) => tok.is_numeric_lit())) {
    const err: crate_diagnostics.LeadingPlusNotSupported = {
      span: lo,
      remove_plus: undefined,
      add_parentheses: undefined,
    };

    // a block on the LHS might have been intended to be an expression instead
    const sp = this_.psess.complete_stmt_exprs_before_bin_op_lookalike.get(lo);
    if (sp !== undefined) {
      err.add_parentheses = crate_diagnostics.ExprParenthesesNeeded.surrounding(sp);
    } else {
      err.remove_plus = lo;
    }
    this_.dcx().emit_err(crate_diagnostics.LeadingPlusNotSupported_diagnostic(err));

    this_.bump(); // `+`
    const r = this_.parse_expr_prefix_common(lo);
    if (r.$ === "Err") return r;
    return Ok(r._0[1]);
  }
  // Recover from `++x`:
  if (kind.$ === "Plus" && this_.look_ahead(1, (t) => t.eq(TK.Plus))) {
    const starts_stmt = this_.prev_token.eq(TK.Semi) || this_.prev_token.eq(TK.CloseBrace);
    const pre_span = Span.to(
      this_.token.span,
      this_.look_ahead(1, (t) => t.span),
    );
    // Eat both `+`s.
    this_.bump();
    this_.bump();

    const r = this_.parse_expr_dot_or_call(attrs);
    if (r.$ === "Err") return r;
    const operand = r._0;
    return Err(
      this_.report_inc_dec_op(operand, starts_stmt, diagnostics.IncOrDec.Inc, diagnostics.UnaryFixity.Pre, pre_span),
    );
  }
  if (kind.$ === "Ident" && this_.token.is_keyword(kw.Move) && this_.look_ahead(1, (t) => t.eq(TK.OpenParen))) {
    return make_it(this_, attrs, (this__) => this__.parse_expr_move(lo));
  }
  if (kind.$ === "Ident" && this_.may_recover() && this_.is_mistaken_not_ident_negation()) {
    return make_it(this_, attrs, (this__) => this__.recover_not_expr(lo));
  }
  return this_.parse_expr_dot_or_call(attrs);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:426 parse_expr_prefix_common
Parser.prototype.parse_expr_prefix_common = function (this: Parser, lo: Span): PResult<[Span, Expr]> {
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  const r = this.token.is_range_separator() ? this.parse_expr_prefix_range(attrs) : this.parse_expr_prefix(attrs);
  if (r.$ === "Err") return r;
  const expr = r._0;
  const span = this.interpolated_or_expr_span(expr);
  return Ok([Span.to(lo, span), expr]);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:437 parse_expr_unary
Parser.prototype.parse_expr_unary = function (this: Parser, lo: Span, op: UnOp): PResult<[Span, ExprKind]> {
  this.bump(); // `op`
  const r = this.parse_expr_prefix_common(lo);
  if (r.$ === "Err") return r;
  const [span, expr] = r._0;
  return Ok([span, this.mk_unary(op, expr)]);
};

/// Recover on `~expr` in favor of `!expr`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:444 recover_tilde_expr
Parser.prototype.recover_tilde_expr = function (this: Parser, lo: Span): PResult<[Span, ExprKind]> {
  this.dcx().emit_err(crate_diagnostics.TildeAsUnaryOperator_diagnostic({ _0: lo }));

  return this.parse_expr_unary(lo, ast.UnOp.Not);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:450 parse_expr_move
Parser.prototype.parse_expr_move = function (this: Parser, move_kw: Span): PResult<[Span, ExprKind]> {
  this.bump();
  this.psess.gated_spans.gate(sym.move_expr, move_kw);
  const r1 = this.expect(exp.OpenParen);
  if (r1.$ === "Err") return r1;
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  const expr = r._0;
  const r2 = this.expect(exp.CloseParen);
  if (r2.$ === "Err") return r2;
  const span = Span.to(move_kw, this.prev_token.span);
  return Ok([span, { $: "Move", _0: expr, _1: move_kw }]);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:460 is_mistaken_not_ident_negation
Parser.prototype.is_mistaken_not_ident_negation = function (this: Parser): boolean {
  const token_cannot_continue_expr = (t: Token): boolean => {
    const k = t.uninterpolate().kind;
    switch (k.$) {
      // These tokens can start an expression after `!`, but
      // can't continue an expression after an ident
      case "Ident":
        return token.ident_can_begin_expr(k._0, t.span, k._1);
      case "Literal":
      case "Pound":
        return true;
      default:
        return t.is_metavar_expr();
    }
  };
  return this.token.is_ident_named(sym.not) && this.look_ahead(1, token_cannot_continue_expr);
};

/// Recover on `not expr` in favor of `!expr`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:472 recover_not_expr
Parser.prototype.recover_not_expr = function (this: Parser, lo: Span): PResult<[Span, ExprKind]> {
  const negated_token = this.look_ahead(1, (t) => t);

  let sub_diag: (s: Span) => crate_diagnostics.NotAsNegationOperatorSub;
  if (negated_token.is_numeric_lit()) {
    sub_diag = (_0) => ({ $: "SuggestNotBitwise", _0 });
  } else if (negated_token.is_bool_lit()) {
    sub_diag = (_0) => ({ $: "SuggestNotLogical", _0 });
  } else {
    sub_diag = (_0) => ({ $: "SuggestNotDefault", _0 });
  }

  this.dcx().emit_err(
    crate_diagnostics.NotAsNegationOperator_diagnostic({
      negated: negated_token.span,
      negated_desc: token_descr(negated_token),
      // Span the `not` plus trailing whitespace to avoid
      // trailing whitespace after the `!` in our suggestion
      sub: sub_diag(this.psess.source_map().span_until_non_whitespace(Span.to(lo, negated_token.span))),
    }),
  );

  return this.parse_expr_unary(lo, ast.UnOp.Not);
};

/// Returns the span of expr if it was not interpolated, or the span of the interpolated token.
// rustc: compiler/rustc_parse/src/parser/expr.rs:497 interpolated_or_expr_span
Parser.prototype.interpolated_or_expr_span = function (this: Parser, expr: Expr): Span {
  const k = this.prev_token.kind;
  switch (k.$) {
    case "NtIdent":
    case "NtLifetime":
      return this.prev_token.span;
    case "CloseInvisible":
      if (k._0.$ === "MetaVar") {
        // `expr.span` is the interpolated span, because invisible open
        // and close delims both get marked with the same span, one
        // that covers the entire thing between them. (See
        // `rustc_expand::mbe::transcribe::transcribe`.)
        return this.prev_token.span;
      }
      return expr.span;
    default:
      return expr.span;
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:511 parse_assoc_op_cast
Parser.prototype.parse_assoc_op_cast = function (
  this: Parser,
  lhs: Expr,
  lhs_span: Span,
  op_span: Span,
): PResult<Expr> {
  const mk_expr = (this_: Parser, rhs: Ty): Expr => {
    const span = this_.mk_expr_sp(lhs, lhs_span, op_span, rhs.span);
    return this_.mk_expr(span, { $: "Cast", _0: lhs, _1: rhs });
  };

  // Save the state of the parser before parsing type normally, in case there is a
  // LessThan comparison after this cast.
  const parser_snapshot_before_type = clone_Parser(this);
  let cast_expr: Expr;
  const rt = this.parse_as_cast_ty();
  if (rt.$ === "Ok") {
    cast_expr = mk_expr(this, rt._0);
  } else {
    const type_err = rt._0;
    if (!this.may_recover()) {
      return Err(type_err);
    }

    // Rewind to before attempting to parse the type with generics, to recover
    // from situations like `x as usize < y` in which we first tried to parse
    // `usize < y` as a type with generic arguments.
    const parser_snapshot_after_type = mem_replace_parser(this, parser_snapshot_before_type);

    const rp = this.parse_path(PathStyle.Expr);
    if (rp.$ === "Ok") {
      const path = rp._0;
      const span_after_type = parser_snapshot_after_type.token.span;
      const expr = mk_expr(this, this.mk_ty(path.span, { $: "Path", _0: undefined, _1: ast.clone_Path(path) }));

      const args_span = Span.to(
        this.look_ahead(1, (t) => t.span),
        span_after_type,
      );
      switch (this.token.kind.$) {
        case "Lt":
          this.dcx().emit_err(
            crate_diagnostics.ComparisonInterpretedAsGeneric_diagnostic({
              comparison: this.token.span,
              type: pprust.path_to_string(path),
              args: args_span,
              suggestion: {
                left: Span.shrink_to_lo(expr.span),
                right: Span.shrink_to_hi(expr.span),
              },
            }),
          );
          break;
        case "Shl":
          this.dcx().emit_err(
            crate_diagnostics.ShiftInterpretedAsGeneric_diagnostic({
              shift: this.token.span,
              type: pprust.path_to_string(path),
              args: args_span,
              suggestion: {
                left: Span.shrink_to_lo(expr.span),
                right: Span.shrink_to_hi(expr.span),
              },
            }),
          );
          break;
        default:
          // We can end up here even without `<` being the next token, for
          // example because `parse_ty_no_plus` returns `Err` on keywords,
          // but `parse_path` returns `Ok` on them due to error recovery.
          // Return original error and parser state.
          Object.assign(this, parser_snapshot_after_type);
          return Err(type_err);
      }

      // Successfully parsed the type path leaving a `<` yet to parse.
      type_err.cancel();

      // Keep `x as usize` as an expression in AST and continue parsing.
      cast_expr = expr;
    } else {
      const path_err = rp._0;
      // Couldn't parse as a path, return original error and parser state.
      path_err.cancel();
      Object.assign(this, parser_snapshot_after_type);
      return Err(type_err);
    }
  }

  // Try to parse a postfix operator such as `.`, `?`, or index (`[]`)
  // after a cast. If one is present, emit an error then return a valid
  // parse tree; For something like `&x as T[0]` will be as if it was
  // written `((&x) as T)[0]`.

  const span = cast_expr.span;
  const rw = this.parse_expr_dot_or_call_with([], cast_expr, span);
  if (rw.$ === "Err") return rw;
  const with_postfix = rw._0;

  // Check if an illegal postfix operator has been added after the cast.
  // If the resulting expression is not a cast, it is an illegal postfix operator.
  if (with_postfix.kind.$ !== "Cast") {
    let kind: string;
    const k = with_postfix.kind;
    switch (k.$) {
      case "Index":
        kind = "indexing";
        break;
      case "Try":
        kind = "`?`";
        break;
      case "Field":
        kind = "a field access";
        break;
      case "MethodCall":
        kind = "a method call";
        break;
      case "Call":
        kind = "a function call";
        break;
      case "Await":
        kind = "`.await`";
        break;
      case "Use":
        kind = "`.use`";
        break;
      case "Err":
        return Ok(with_postfix);
      default:
        if (k.$ === "Yield" && k._0.$ === "Postfix") {
          kind = "`.yield`";
          break;
        }
        if (k.$ === "Match" && k._2 === ast.MatchKind.Postfix) {
          kind = "a postfix match";
          break;
        }
        return unreachable(
          `internal error: entered unreachable code: did not expect ${ast.debug_ExprKind(k, PLAIN)} as an illegal postfix operator following cast`,
        );
    }
    this.dcx()
      .struct_span_err(span, `cast cannot be followed by ${kind}`)
      .with_multipart_suggestion(
        "try surrounding the expression in parentheses",
        [
          [Span.shrink_to_lo(span), "("],
          [Span.shrink_to_hi(span), ")"],
        ],
        Applicability.MachineApplicable,
      )
      .emit();
  }
  return Ok(with_postfix);
};

/// Parse `& mut? <expr>` or `& raw [ const | mut ] <expr>`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:637 parse_expr_borrow
Parser.prototype.parse_expr_borrow = function (this: Parser, lo: Span): PResult<[Span, ExprKind]> {
  const r0 = this.expect_and();
  if (r0.$ === "Err") return r0;
  const has_lifetime = this.token.is_lifetime() && this.look_ahead(1, (t) => !t.eq(TK.Colon));
  const lifetime = has_lifetime ? this.expect_lifetime() : undefined; // For recovery, see below.
  const [borrow_kind, mutbl] = this.parse_borrow_modifiers();
  const r = this.parse_expr_prefix_common(lo);
  if (r.$ === "Err") return r;
  const [span, expr] = r._0;
  if (lifetime !== undefined) {
    const lt = lifetime;
    this.error_remove_borrow_lifetime(span, Span.until(lt.ident.span, expr.span));
  }

  // Add expected tokens if we parsed `&raw` as an expression.
  // This will make sure we see "expected `const`, `mut`", and
  // guides recovery in case we write `&raw expr`.
  if (
    borrow_kind === ast.BorrowKind.Ref &&
    mutbl === ast.Mutability.Not &&
    expr.kind.$ === "Path" &&
    expr.kind._0 === undefined &&
    expr.kind._1.eq_Symbol(kw.Raw)
  ) {
    this.expected_token_types.insert(TokenType.KwMut);
    this.expected_token_types.insert(TokenType.KwConst);
  }

  return Ok([span, { $: "AddrOf", _0: borrow_kind, _1: mutbl, _2: expr }]);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:661 error_remove_borrow_lifetime
Parser.prototype.error_remove_borrow_lifetime = function (this: Parser, span: Span, lt_span: Span): void {
  this.dcx().emit_err(
    crate_diagnostics.LifetimeInBorrowExpression_diagnostic({
      span,
      lifetime_span: lt_span,
    }),
  );
};

/// Parse `mut?` or `[ raw | pin ] [ const | mut ]`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:669 parse_borrow_modifiers
Parser.prototype.parse_borrow_modifiers = function (this: Parser): [ast.BorrowKind, ast.Mutability] {
  if (this.check_keyword(exp.Raw) && this.look_ahead(1, (t) => t.is_mutability())) {
    // `raw [ const | mut ]`.
    const found_raw = this.eat_keyword(exp.Raw);
    assert(found_raw, "assertion failed: found_raw");
    const mutability = unwrap(this.parse_mut_or_const());
    return [ast.BorrowKind.Raw, mutability];
  } else {
    const [pinnedness, mutbl] = this.parse_pin_and_mut();
    switch (pinnedness) {
      // `mut?`
      case ast.Pinnedness.Not:
        return [ast.BorrowKind.Ref, mutbl];
      // `pin [ const | mut ]`.
      // `pin` has been gated in `self.parse_pin_and_mut()` so we don't
      // need to gate it here.
      case ast.Pinnedness.Pinned:
        return [ast.BorrowKind.Pin, mutbl];
    }
  }
};

/// Parses `a.b` or `a(13)` or `a[4]` or just `a`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:689 parse_expr_dot_or_call
Parser.prototype.parse_expr_dot_or_call = function (this: Parser, attrs: AttrWrapper): PResult<Expr> {
  return this.collect_tokens_for_expr(attrs, (this_, attrs_) => {
    const r = this_.parse_expr_bottom();
    if (r.$ === "Err") return r;
    const base = r._0;
    const span = this_.interpolated_or_expr_span(base);
    return this_.parse_expr_dot_or_call_with(attrs_, base, span);
  });
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:697 parse_expr_dot_or_call_with
Parser.prototype.parse_expr_dot_or_call_with = function (
  this: Parser,
  attrs: AttrVec,
  e: Expr,
  lo: Span,
): PResult<Expr> {
  let res: PResult<Expr>;
  for (;;) {
    let has_question: boolean;
    if (this.prev_token.is_keyword(kw.Return)) {
      // We are using noexpect here because we don't expect a `?` directly after
      // a `return` which could be suggested otherwise.
      has_question = this.eat_noexpect(TK.Question);
    } else {
      has_question = this.eat(exp.Question);
    }
    if (has_question) {
      // `expr?`
      e = this.mk_expr(Span.to(lo, this.prev_token.span), { $: "Try", _0: e });
      continue;
    }
    let has_dot: boolean;
    if (this.prev_token.is_keyword(kw.Return)) {
      // We are using noexpect here because we don't expect a `.` directly after
      // a `return` which could be suggested otherwise.
      has_dot = this.eat_noexpect(TK.Dot);
    } else if (this.token.eq(TK.RArrow) && this.may_recover()) {
      // Recovery for `expr->suffix`.
      this.bump();
      const span = this.prev_token.span;
      this.dcx().emit_err(crate_diagnostics.ExprRArrowCall_diagnostic({ span }));
      has_dot = true;
    } else {
      has_dot = this.eat(exp.Dot);
    }
    if (has_dot) {
      // expr.f
      const r = this.parse_dot_suffix_expr(lo, e);
      if (r.$ === "Err") return r;
      e = r._0;
      continue;
    }
    if (this.expr_is_complete(e)) {
      res = Ok(e);
      break;
    }
    if (this.token.kind.$ === "OpenParen") {
      e = this.parse_expr_fn_call(lo, e);
    } else if (this.token.kind.$ === "OpenBracket") {
      const r = this.parse_expr_index(lo, e);
      if (r.$ === "Err") return r;
      e = r._0;
    } else {
      res = Ok(e);
      break;
    }
  }

  // Stitch the list of outer attributes onto the return value. A little
  // bit ugly, but the best way given the current code structure.
  if (attrs.length !== 0 && res.$ === "Ok") {
    const expr = res._0;
    // mem::swap(&mut expr.attrs, &mut attrs); expr.attrs.extend(attrs)
    const old = expr.attrs;
    expr.attrs = attrs;
    expr.attrs.push(...old);
  }
  return res;
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:755 parse_dot_suffix_expr
Parser.prototype.parse_dot_suffix_expr = function (this: Parser, lo: Span, base: Expr): PResult<Expr> {
  // At this point we've consumed something like `expr.` and `self.token` holds the token
  // after the dot.
  const k = this.token.uninterpolate().kind;
  if (k.$ === "Ident") {
    return this.parse_dot_suffix(base, lo);
  } else if (k.$ === "Literal" && k._0.kind.$ === "Integer") {
    const { symbol, suffix } = k._0;
    const ident_span = this.token.span;
    this.bump();
    return Ok(this.mk_expr_tuple_field_access(lo, ident_span, base, symbol, suffix));
  } else if (k.$ === "Literal" && k._0.kind.$ === "Float") {
    const { symbol, suffix } = k._0;
    const df = this.break_up_float(symbol, this.token.span);
    switch (df.$) {
      // 1e2
      case "Single": {
        const sym_ = df._0;
        // `foo.1e2`: a single complete dot access, fully consumed. We end up with
        // the `1e2` token in `self.prev_token` and the following token in
        // `self.token`.
        const ident_span = this.token.span;
        this.bump();
        return Ok(this.mk_expr_tuple_field_access(lo, ident_span, base, sym_, suffix));
      }
      // 1.
      case "TrailingDot": {
        const [sym_, ident_span, dot_span] = [df._0, df._1, df._2];
        // `foo.1.`: a single complete dot access and the start of another.
        // We end up with the `sym` (`1`) token in `self.prev_token` and a dot in
        // `self.token`.
        assert(suffix === undefined, "assertion failed: suffix.is_none()");
        this.token = token.Token.new({ $: "Ident", _0: sym_, _1: IdentKind.Normal }, ident_span);
        this.bump_with([token.Token.new(TK.Dot, dot_span), this.token_spacing]);
        return Ok(this.mk_expr_tuple_field_access(lo, ident_span, base, sym_, undefined));
      }
      // 1.2 | 1.2e3
      case "MiddleDot": {
        const [sym1, ident1_span, _dot_span, sym2, ident2_span] = [df._0, df._1, df._2, df._3, df._4];
        // `foo.1.2` (or `foo.1.2e3`): two complete dot accesses. We end up with
        // the `sym2` (`2` or `2e3`) token in `self.prev_token` and the following
        // token in `self.token`.
        const next_token2 = token.Token.new({ $: "Ident", _0: sym2, _1: IdentKind.Normal }, ident2_span);
        this.bump_with([next_token2, this.token_spacing]);
        this.bump();
        const base1 = this.mk_expr_tuple_field_access(lo, ident1_span, base, sym1, undefined);
        return Ok(this.mk_expr_tuple_field_access(lo, ident2_span, base1, sym2, suffix));
      }
      case "Error":
        return Ok(base);
    }
  } else {
    this.error_unexpected_after_dot();
    return Ok(base);
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:819 error_unexpected_after_dot
Parser.prototype.error_unexpected_after_dot = function (this: Parser): void {
  const actual0 = token_descr(this.token);
  const span0 = this.token.span;
  const sm = this.psess.source_map();
  let span: Span;
  let actual: string;
  const k = this.token.kind;
  let snippet: Result<Str, SpanSnippetError> | undefined;
  if (
    k.$ === "Eof" &&
    this.subparser_name !== undefined &&
    (snippet = sm.span_to_snippet(sm.next_point(span0))).$ === "Ok"
  ) {
    span = Span.shrink_to_hi(span0);
    actual = `\`${snippet._0.toString()}\``;
  } else if (k.$ === "CloseInvisible" && k._0.$ === "MetaVar") {
    // No need to report an error. This case will only occur when parsing a pasted
    // metavariable, and we should have emitted an error when parsing the macro call in
    // the first place. E.g. in this code:
    // ```
    // macro_rules! m { ($e:expr) => { $e }; }
    //
    // fn main() {
    //     let f = 1;
    //     m!(f.);
    // }
    // ```
    // we'll get an error "unexpected token: `)` when parsing the `m!(f.)`, so we don't
    // want to issue a second error when parsing the expansion `«f.»` (where `«`/`»`
    // represent the invisible delimiters).
    this.dcx().span_delayed_bug(span0, "bad dot expr in metavariable");
    return;
  } else {
    span = span0;
    actual = actual0;
  }
  this.dcx().emit_err(crate_diagnostics.UnexpectedTokenAfterDot_diagnostic({ span, actual }));
};

/// PORT: the local `#[derive(Debug)] enum FloatComponent` of `break_up_float`.
type FloatComponent = { readonly $: "IdentLike"; _0: string } | { readonly $: "Punct"; _0: number };
function debug_FloatComponent(v: FloatComponent, f: Fmt): string {
  switch (v.$) {
    case "IdentLike":
      return debug_tuple(f, "IdentLike", [debug_str(v._0)]);
    case "Punct":
      return debug_tuple(f, "Punct", [debug_char(v._0)]);
  }
}
const C_DOT = 0x2e;
const C_PLUS = 0x2b;
const C_MINUS = 0x2d;
const C_UNDERSCORE = 0x5f;

/// We need an identifier or integer, but the next token is a float.
/// Break the float into components to extract the identifier or integer.
///
/// See also [`TokenKind::break_two_token_op`] which does similar splitting of `>>` into `>`.
//
// FIXME: With current `TokenCursor` it's hard to break tokens into more than 2
//  parts unless those parts are processed immediately. `TokenCursor` should either
//  support pushing "future tokens" (would be also helpful to `break_and_eat`), or
//  we should break everything including floats into more basic proc-macro style
//  tokens in the lexer (probably preferable).
// rustc: compiler/rustc_parse/src/parser/expr.rs:860 break_up_float
Parser.prototype.break_up_float = function (this: Parser, float: Symbol, span: Span): DestructuredFloat {
  const float_str = Symbol.as_str(float);
  const components: FloatComponent[] = [];
  let ident_like = "";
  for (const ch of float_str) {
    const c = ch.codePointAt(0)!;
    if (c === C_UNDERSCORE || is_ascii_alphanumeric(c)) {
      ident_like += ch;
    } else if (c === C_DOT || c === C_PLUS || c === C_MINUS) {
      if (ident_like.length !== 0) {
        components.push({ $: "IdentLike", _0: ident_like });
        ident_like = "";
      }
      components.push({ $: "Punct", _0: c });
    } else {
      return panic(`unexpected character in a float token: ${debug_char(c)}`);
    }
  }
  if (ident_like.length !== 0) {
    components.push({ $: "IdentLike", _0: ident_like });
  }

  // With proc macros the span can refer to anything, the source may be too short,
  // or too long, or non-ASCII. It only makes sense to break our span into components
  // if its underlying text is identical to our float literal.
  const can_take_span_apart = (): boolean => {
    const s = this.span_to_snippet(span);
    return s.$ === "Ok" && s._0 === float_str;
  };

  const c = components;
  const is_ident = (i: number) => c[i]!.$ === "IdentLike";
  const is_punct = (i: number, ...chars: number[]) => {
    const x = c[i]!;
    return x.$ === "Punct" && chars.includes(x._0);
  };
  // 1e2
  if (c.length === 1 && is_ident(0)) {
    return { $: "Single", _0: Symbol.intern((c[0] as { _0: string })._0), _1: span };
  }
  // 1.
  if (c.length === 2 && is_ident(0) && is_punct(1, C_DOT)) {
    const left = (c[0] as { _0: string })._0;
    let left_span: Span;
    let dot_span: Span;
    if (can_take_span_apart()) {
      left_span = Span.with_hi(span, BytePos.add(Span.lo(span), BytePos.from_usize(utf8_len(left))));
      dot_span = Span.with_lo(span, Span.hi(left_span));
    } else {
      left_span = span;
      dot_span = span;
    }
    const left_sym = Symbol.intern(left);
    return { $: "TrailingDot", _0: left_sym, _1: left_span, _2: dot_span };
  }
  // 1.2 | 1.2e3
  if (c.length === 3 && is_ident(0) && is_punct(1, C_DOT) && is_ident(2)) {
    const left = (c[0] as { _0: string })._0;
    const right = (c[2] as { _0: string })._0;
    let left_span: Span;
    let dot_span: Span;
    let right_span: Span;
    if (can_take_span_apart()) {
      left_span = Span.with_hi(span, BytePos.add(Span.lo(span), BytePos.from_usize(utf8_len(left))));
      dot_span = Span.with_hi(Span.with_lo(span, Span.hi(left_span)), BytePos.add(Span.hi(left_span), BytePos(1)));
      right_span = Span.with_lo(span, Span.hi(dot_span));
    } else {
      left_span = span;
      dot_span = span;
      right_span = span;
    }
    const left_sym = Symbol.intern(left);
    const right_sym = Symbol.intern(right);
    return { $: "MiddleDot", _0: left_sym, _1: left_span, _2: dot_span, _3: right_sym, _4: right_span };
  }
  if (
    // 1e+ | 1e- (recovered)
    (c.length === 2 && is_ident(0) && is_punct(1, C_PLUS, C_MINUS)) ||
    // 1e+2 | 1e-2
    (c.length === 3 && is_ident(0) && is_punct(1, C_PLUS, C_MINUS) && is_ident(2)) ||
    // 1.2e+ | 1.2e-
    (c.length === 4 && is_ident(0) && is_punct(1, C_DOT) && is_ident(2) && is_punct(3, C_PLUS, C_MINUS)) ||
    // 1.2e+3 | 1.2e-3
    (c.length === 5 &&
      is_ident(0) &&
      is_punct(1, C_DOT) &&
      is_ident(2) &&
      is_punct(3, C_PLUS, C_MINUS) &&
      is_ident(4))
  ) {
    // See the FIXME about `TokenCursor` above.
    this.error_unexpected_after_dot();
    return gen.DestructuredFloat.Error;
  }
  return panic(`unexpected components in a float token: ${debug_vec(components, PLAIN, debug_FloatComponent)}`);
};

/// Parse the field access used in offset_of, matched by `$(e:expr)+`.
/// Currently returns a list of idents. However, it should be possible in
/// future to also do array indices, which might be arbitrary expressions.
// rustc: compiler/rustc_parse/src/parser/expr.rs:942 parse_floating_field_access
Parser.prototype.parse_floating_field_access = function (this: Parser): PResult<Ident[]> {
  const fields: Ident[] = [];
  let trailing_dot: Span | undefined = undefined;

  for (;;) {
    // This is expected to use a metavariable $(args:expr)+, but the builtin syntax
    // could be called directly. Calling `parse_expr` allows this function to only
    // consider `Expr`s.
    const r = this.parse_expr();
    if (r.$ === "Err") return r;
    const expr = r._0;
    let current = expr;
    const start_idx = fields.length;
    for (;;) {
      const k = current.kind;
      if (k.$ === "Field") {
        const [left, right] = [k._0, k._1];
        // Field access is read right-to-left.
        fields.splice(start_idx, 0, right);
        trailing_dot = undefined;
        current = left;
      }
      // Parse this both to give helpful error messages and to
      // verify it can be done with this parser setup.
      else if (k.$ === "Index") {
        const [left, span] = [k._0, k._2];
        this.dcx().emit_err(crate_diagnostics.ArrayIndexInOffsetOf_diagnostic({ _0: span }));
        current = left;
      } else if (k.$ === "Lit" && (k._0.kind.$ === "Float" || k._0.kind.$ === "Integer")) {
        const { symbol, suffix } = k._0;
        if (suffix !== undefined) {
          this.dcx().emit_err(
            crate_diagnostics.InvalidLiteralSuffixOnTupleIndex_diagnostic({
              span: current.span,
              suffix,
            }),
          );
        }
        const df = this.break_up_float(symbol, current.span);
        switch (df.$) {
          // 1e2
          case "Single": {
            const [sym_, sp] = [df._0, df._1];
            trailing_dot = undefined;
            fields.splice(start_idx, 0, Ident.new(sym_, sp));
            break;
          }
          // 1.
          case "TrailingDot": {
            const [sym_, sym_span, dot_span] = [df._0, df._1, df._2];
            assert(suffix === undefined, "assertion failed: suffix.is_none()");
            trailing_dot = dot_span;
            fields.splice(start_idx, 0, Ident.new(sym_, sym_span));
            break;
          }
          // 1.2 | 1.2e3
          case "MiddleDot": {
            const [symbol1, span1, _dot_span, symbol2, span2] = [df._0, df._1, df._2, df._3, df._4];
            trailing_dot = undefined;
            fields.splice(start_idx, 0, Ident.new(symbol2, span2));
            fields.splice(start_idx, 0, Ident.new(symbol1, span1));
            break;
          }
          case "Error":
            trailing_dot = undefined;
            fields.splice(start_idx, 0, Ident.new(symbol, this.prev_token.span));
            break;
        }
        break;
      } else if (k.$ === "Path" && k._0 === undefined) {
        const segments = k._1.segments;
        if (segments.length === 1 && segments[0]!.args === undefined) {
          const ident = segments[0]!.ident;
          trailing_dot = undefined;
          fields.splice(start_idx, 0, ident);
        } else {
          this.dcx().emit_err(crate_diagnostics.InvalidOffsetOf_diagnostic({ _0: current.span }));
          break;
        }
        break;
      } else {
        this.dcx().emit_err(crate_diagnostics.InvalidOffsetOf_diagnostic({ _0: current.span }));
        break;
      }
    }

    if (token.TokenKind.close_delim(this.token.kind) !== undefined || this.token.kind.$ === "Comma") {
      break;
    } else if (trailing_dot === undefined) {
      // This loop should only repeat if there is a trailing dot.
      this.dcx().emit_err(crate_diagnostics.InvalidOffsetOf_diagnostic({ _0: this.token.span }));
      break;
    }
  }
  if (trailing_dot !== undefined) {
    const dot = trailing_dot;
    this.dcx().emit_err(crate_diagnostics.InvalidOffsetOf_diagnostic({ _0: dot }));
  }
  return Ok(fields);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1046 mk_expr_tuple_field_access
Parser.prototype.mk_expr_tuple_field_access = function (
  this: Parser,
  lo: Span,
  ident_span: Span,
  base: Expr,
  field: Symbol,
  suffix: Symbol | undefined,
): Expr {
  if (suffix !== undefined) {
    this.dcx().emit_err(
      crate_diagnostics.InvalidLiteralSuffixOnTupleIndex_diagnostic({
        span: ident_span,
        suffix,
      }),
    );
  }
  return this.mk_expr(Span.to(lo, ident_span), { $: "Field", _0: base, _1: Ident.new(field, ident_span) });
};

/// Parse a function call expression, `expr(...)`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1064 parse_expr_fn_call
Parser.prototype.parse_expr_fn_call = function (this: Parser, lo: Span, fun: Expr): Expr {
  const snapshot: [SnapshotParser, ExprKind] | undefined = this.token.eq(TK.OpenParen)
    ? [this.create_snapshot_for_diagnostic(), clone_ExprKind(fun.kind)]
    : undefined;
  const open_paren = this.token.span;
  const call_depth = this.token_cursor.depth();

  let seq: PResult<Expr>;
  const r = this.parse_expr_paren_seq();
  if (r.$ === "Ok") {
    const args = r._0;
    seq = Ok(this.mk_expr(Span.to(lo, this.prev_token.span), this.mk_call(fun, args)));
  } else if (this.is_expected_raw_ref_mut() && this.token_cursor.depth() === call_depth) {
    const err = r._0;
    const guar = err.emit_err();
    // Preserve the call expression so later passes can still diagnose the callee,
    // while treating the malformed `&raw <expr>` argument as an error expression.
    const args = this.recover_raw_ref_call_args(guar);
    return this.mk_expr(Span.to(lo, this.prev_token.span), this.mk_call(fun, args));
  } else {
    seq = r;
  }
  const res = this.maybe_recover_struct_lit_bad_delims(lo, open_paren, seq, snapshot);
  if (res.$ === "Ok") {
    return res._0;
  } else {
    return this.recover_seq_parse_error(exp.OpenParen, exp.CloseParen, lo, res._0);
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1092 recover_raw_ref_call_args
Parser.prototype.recover_raw_ref_call_args = function (this: Parser, guar: ErrorGuaranteed): Expr[] {
  const err_span = Span.to(this.prev_token.span, this.token.span);
  const args = [this.mk_expr_err(err_span, guar)];
  while (!token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
    if (this.eat(exp.Comma)) {
      if (!token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
        args.push(this.mk_expr_err(Span.shrink_to_hi(this.prev_token.span), guar));
      }
    } else {
      this.parse_token_tree();
    }
  }
  this.eat(exp.CloseParen);
  return args;
};

/// If we encounter a parser state that looks like the user has written a `struct` literal with
/// parentheses instead of braces, recover the parser state and provide suggestions.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1111 maybe_recover_struct_lit_bad_delims
Parser.prototype.maybe_recover_struct_lit_bad_delims = function (
  this: Parser,
  lo: Span,
  open_paren: Span,
  seq: PResult<Expr>,
  snapshot: [SnapshotParser, ExprKind] | undefined,
): PResult<Expr> {
  if (
    this.may_recover() &&
    seq.$ === "Err" &&
    snapshot !== undefined &&
    snapshot[1].$ === "Path" &&
    snapshot[1]._0 === undefined
  ) {
    const err = seq._0;
    const snapshot_ = snapshot[0];
    const path = snapshot[1]._1;
    snapshot_.parser.bump(); // `(`
    const r = snapshot_.parser.parse_struct_fields(ast.clone_Path(path), false, exp.CloseParen);
    if (r.$ === "Ok" && snapshot_.parser.eat(exp.CloseParen)) {
      const fields0 = r._0[0];
      // We are certain we have `Enum::Foo(a: 3, b: 4)`, suggest
      // `Enum::Foo { a: 3, b: 4 }` or `Enum::Foo(3, 4)`.
      this.restore_snapshot(snapshot_);
      const close_paren = this.prev_token.span;
      const span = Span.to(lo, close_paren);
      // filter shorthand fields
      const fields = fields0.filter((field) => !field.is_shorthand);

      let guar: ErrorGuaranteed;
      let snippet: Result<string, unknown>;
      if (
        fields.length !== 0 &&
        // `token.kind` should not be compared here.
        // This is because the `snapshot.token.kind` is treated as the same as
        // that of the open delim in `TokenTreesReader::parse_token_tree`, even
        // if they are different.
        (snippet = this.span_to_snippet(close_paren)).$ === "Ok" &&
        snippet._0 === ")"
      ) {
        err.cancel();
        const type_str = pprust.path_to_string(path);
        guar = this.dcx().emit_err(
          crate_diagnostics.ParenthesesWithStructFields_diagnostic({
            span,
            braces_for_struct: {
              first: open_paren,
              second: close_paren,
              type: type_str,
            },
            no_fields_for_fn: {
              type: type_str,
              fields: fields.map((field) => Span.until(field.span, field.expr.span)),
            },
          }),
        );
      } else {
        guar = err.emit_err();
      }
      return Ok(this.mk_expr_err(span, guar));
    } else if (r.$ === "Ok") {
      return Err(err);
    } else {
      const err2 = r._0;
      err2.cancel();
      return Err(err);
    }
  }
  return seq;
};

/// Parse an indexing expression `expr[...]`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1173 parse_expr_index
Parser.prototype.parse_expr_index = function (this: Parser, lo: Span, base: Expr): PResult<Expr> {
  const prev_token = this.prev_token;
  const open_delim_span = this.token.span;
  this.bump(); // `[`
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  const index = r._0;
  const r2 = this.suggest_missing_semicolon_before_array(prev_token.span, open_delim_span);
  if (r2.$ === "Err") return r2;
  const r3 = this.expect(exp.CloseBracket);
  if (r3.$ === "Err") {
    const err = r3._0;
    if (prev_token.is_non_reserved_ident()) {
      err.span_suggestion_verbose(
        Span.shrink_to_hi(prev_token.span),
        "you might have meant to call a macro",
        "!",
        Applicability.MaybeIncorrect,
      );
    }
    return Err(err);
  }
  return Ok(
    this.mk_expr(
      Span.to(lo, this.prev_token.span),
      this.mk_index(base, index, Span.to(open_delim_span, this.prev_token.span)),
    ),
  );
};

/// Assuming we have just parsed `.`, continue parsing into an expression.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1197 parse_dot_suffix
Parser.prototype.parse_dot_suffix = function (this: Parser, self_arg: Expr, lo: Span): PResult<Expr> {
  if (Span.at_least_rust_2018(this.token_uninterpolated_span()) && this.eat_keyword(exp.Await)) {
    return Ok(this.mk_await_expr(self_arg, lo));
  }

  if (this.eat_keyword(exp.Use)) {
    const use_span = this.prev_token.span;
    this.psess.gated_spans.gate(sym.ergonomic_clones, use_span);
    return Ok(this.mk_use_expr(self_arg, lo));
  }

  // Post-fix match
  if (this.eat_keyword(exp.Match)) {
    const match_span = this.prev_token.span;
    this.psess.gated_spans.gate(sym.postfix_match, match_span);
    return this.parse_match_block(lo, match_span, self_arg, ast.MatchKind.Postfix);
  }

  // Parse a postfix `yield`.
  if (this.eat_keyword(exp.Yield)) {
    const yield_span = this.prev_token.span;
    this.psess.gated_spans.gate(sym.yield_expr, yield_span);
    return Ok(this.mk_expr(Span.to(lo, yield_span), { $: "Yield", _0: { $: "Postfix", _0: self_arg } }));
  }

  const fn_span_lo = this.token.span;
  const rs = this.parse_path_segment(PathStyle.Expr, undefined);
  if (rs.$ === "Err") return rs;
  const seg = rs._0;
  this.check_trailing_angle_brackets(seg, [exp.OpenParen]);
  this.check_turbofish_missing_angle_brackets(seg);

  if (this.check(exp.OpenParen)) {
    // Method call `expr.f()`
    const r = this.parse_expr_paren_seq();
    if (r.$ === "Err") return r;
    const args = r._0;
    const fn_span = Span.to(fn_span_lo, this.prev_token.span);
    const span = Span.to(lo, this.prev_token.span);
    return Ok(
      this.mk_expr(span, {
        $: "MethodCall",
        _0: {
          seg,
          receiver: self_arg,
          args,
          span: fn_span,
        },
      }),
    );
  } else {
    // Field access `expr.f`
    const span = Span.to(lo, this.prev_token.span);
    if (seg.args !== undefined) {
      const args = seg.args;
      // See `StashKey::GenericInFieldExpr` for more info on why we stash this.
      this.dcx()
        .create_err(crate_diagnostics.FieldExpressionWithGeneric_diagnostic({ _0: GenericArgs.span(args) }))
        .stash(seg.ident.span, StashKey.GenericInFieldExpr);
    }

    return Ok(this.mk_expr(span, { $: "Field", _0: self_arg, _1: seg.ident }));
  }
};

/// At the bottom (top?) of the precedence hierarchy,
/// Parses things like parenthesized exprs, macros, `return`, etc.
///
/// N.B., this does not parse outer attributes, and is private because it only works
/// correctly if called from `parse_expr_dot_or_call`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1262 parse_expr_bottom
Parser.prototype.parse_expr_bottom = function (this: Parser): PResult<Expr> {
  // PORT: `maybe_recover_from_interpolated_ty_qpath!(self, true)` (parser/mod.rs:165), expanded.
  {
    let mv_kind: MetaVarKind | undefined;
    if (
      true &&
      this.may_recover() &&
      (mv_kind = this.token.is_metavar_seq()) !== undefined &&
      mv_kind.$ === "Ty" &&
      this.check_noexpect_past_close_delim(TK.PathSep)
    ) {
      // Reparse the type, then move to recovery.
      const ty = this.eat_metavar_seq(mv_kind, (this_) => this_.parse_ty_no_question_mark_recover());
      if (ty === undefined) return panic("metavar seq ty");

      return this.maybe_recover_from_bad_qpath_stage_2(this.prev_token.span, ty, expr_recover_qpath());
    }
  }

  const span = this.token.span;
  let expr: Expr | undefined;
  let lit: Expr | undefined;
  let block: Block | undefined;
  let path: Path | undefined;
  if (
    (expr = this.eat_metavar_seq_with_matcher(
      (mv_kind) => mv_kind.$ === "Expr",
      (this_) => {
        // Force collection (as opposed to just `parse_expr`) is required to avoid the
        // attribute duplication seen in #138478.
        const expr = this_.parse_expr_force_collect();
        // FIXME(nnethercote) Sometimes with expressions we get a trailing comma, possibly
        // related to the FIXME in `collect_tokens_for_expr`. Examples are the multi-line
        // `assert_eq!` calls involving arguments annotated with `#[rustfmt::skip]` in
        // `compiler/rustc_index/src/bit_set/tests.rs`.
        if (this_.token.kind.$ === "Comma") {
          this_.bump();
        }
        return expr;
      },
    )) !== undefined
  ) {
    return Ok(expr);
  } else if (
    (lit = this.eat_metavar_seq(token.MetaVarKind.Literal, (this_) => this_.parse_literal_maybe_minus())) !==
    undefined
  ) {
    return Ok(lit);
  } else if ((block = this.eat_metavar_seq(token.MetaVarKind.Block, (this_) => this_.parse_block())) !== undefined) {
    return Ok(this.mk_expr(span, { $: "Block", _0: block, _1: undefined }));
  } else if (
    (path = this.eat_metavar_seq(token.MetaVarKind.Path, (this_) => this_.parse_path(PathStyle.Type))) !== undefined
  ) {
    return Ok(this.mk_expr(span, { $: "Path", _0: undefined, _1: path }));
  }

  // Outer attributes are already parsed and will be
  // added to the return value after the fact.

  const restrictions = this.restrictions;
  return this.with_res(Restrictions.difference(restrictions, Restrictions.ALLOW_LET), (this_): PResult<Expr> => {
    // Note: adding new syntax here? Don't forget to adjust `TokenKind::can_begin_expr()`.
    const lo = this_.token.span;
    if (this_.token.kind.$ === "Literal") {
      // This match arm is a special-case of the `_` match arm below and
      // could be removed without changing functionality, but it's faster
      // to have it here, especially for programs with large constants.
      return this_.parse_expr_lit();
    } else if (this_.check(exp.OpenParen)) {
      return this_.parse_expr_tuple_parens(restrictions);
    } else if (this_.check(exp.OpenBrace)) {
      const r = this_.maybe_recover_bad_struct_literal_path(false);
      if (r.$ === "Err") return r;
      if (r._0 !== undefined) {
        return Ok(r._0);
      }
      const arr = this_.recover_from_c_array(lo);
      if (arr !== undefined) {
        return Ok(arr);
      }
      return this_.parse_expr_block(undefined, lo, ast.BlockCheckMode.Default);
    } else if (this_.check(exp.Or) || this_.check(exp.OrOr)) {
      const r = this_.parse_expr_closure();
      if (r.$ === "Err") {
        const err = r._0;
        // If the input is something like `if a { 1 } else { 2 } | if a { 3 } else { 4 }`
        // then suggest parens around the lhs.
        const sp = this_.psess.complete_stmt_exprs_before_bin_op_lookalike.get(lo);
        if (sp !== undefined) {
          err.subdiagnostic(
            crate_diagnostics.ExprParenthesesNeeded_subdiagnostic(crate_diagnostics.ExprParenthesesNeeded.surrounding(sp)),
          );
        }
        return Err(err);
      }
      return r;
    } else if (this_.check(exp.OpenBracket)) {
      return this_.parse_expr_array_or_repeat(exp.CloseBracket);
    } else if (this_.is_builtin()) {
      return this_.parse_expr_builtin();
    } else if (this_.check_path()) {
      return this_.parse_expr_path_start();
    } else if (
      this_.check_keyword(exp.Move) ||
      this_.check_keyword(exp.Use) ||
      this_.check_keyword(exp.Static) ||
      this_.check_const_closure()
    ) {
      return this_.parse_expr_closure();
    } else if (this_.eat_keyword(exp.If)) {
      return this_.parse_expr_if();
    } else if (this_.check_keyword(exp.For)) {
      if (this_.choose_generics_over_qpath(1)) {
        return this_.parse_expr_closure();
      } else {
        assert(this_.eat_keyword(exp.For), "assertion failed: this.eat_keyword(exp!(For))");
        return this_.parse_expr_for(undefined, lo);
      }
    } else if (this_.eat_keyword(exp.While)) {
      return this_.parse_expr_while(undefined, lo);
    }
    let label: Label | undefined;
    if ((label = this_.eat_label()) !== undefined) {
      return this_.parse_expr_labeled(label, true);
    } else if (this_.eat_keyword(exp.Loop)) {
      const r = this_.parse_expr_loop(undefined, lo);
      if (r.$ === "Err") {
        r._0.span_label(lo, "while parsing this `loop` expression");
      }
      return r;
    } else if (this_.eat_keyword(exp.Match)) {
      const r = this_.parse_expr_match();
      if (r.$ === "Err") {
        r._0.span_label(lo, "while parsing this `match` expression");
      }
      return r;
    } else if (this_.eat_keyword(exp.Unsafe)) {
      const r = this_.parse_expr_block(undefined, lo, { $: "Unsafe", _0: ast.UnsafeSource.UserProvided });
      if (r.$ === "Err") {
        r._0.span_label(lo, "while parsing this `unsafe` expression");
      }
      return r;
    } else if (this_.check_inline_const(0)) {
      return this_.parse_const_block(lo, false);
    } else if (this_.may_recover() && this_.is_do_catch_block()) {
      return this_.recover_do_catch();
    } else if (this_.is_try_block()) {
      const r = this_.expect_keyword(exp.Try);
      if (r.$ === "Err") return r;
      return this_.parse_try_block(lo);
    } else if (this_.eat_keyword(exp.Return)) {
      return this_.parse_expr_return();
    } else if (this_.eat_keyword(exp.Continue)) {
      return this_.parse_expr_continue(lo);
    } else if (this_.eat_keyword(exp.Break)) {
      return this_.parse_expr_break();
    } else if (this_.eat_keyword(exp.Yield)) {
      return this_.parse_expr_yield();
    } else if (this_.is_do_yeet()) {
      return this_.parse_expr_yeet();
    } else if (this_.eat_keyword(exp.Become)) {
      return this_.parse_expr_become();
    } else if (this_.check_keyword(exp.Let)) {
      return this_.parse_expr_let(restrictions);
    } else if (this_.eat_keyword(exp.Underscore)) {
      const r = this_.maybe_recover_bad_struct_literal_path(true);
      if (r.$ === "Err") return r;
      if (r._0 !== undefined) {
        return Ok(r._0);
      }
      return Ok(this_.mk_expr(this_.prev_token.span, ast.ExprKind.Underscore));
    } else if (Span.at_least_rust_2018(this_.token_uninterpolated_span())) {
      // `Span::at_least_rust_2018()` is somewhat expensive; don't get it repeatedly.
      const at_async = this_.check_keyword(exp.Async);
      // check for `gen {}` and `gen move {}`
      // or `async gen {}` and `async gen move {}`
      // FIXME: (async) gen closures aren't yet parsed.
      // FIXME(gen_blocks): Parse `gen async` and suggest swap
      // FIXME(forced_keywords): Allow k#gen blocks prior to Rust 2024, too!
      if (Span.at_least_rust_2024(this_.token_uninterpolated_span()) && this_.is_gen_block(kw.Gen, at_async ? 1 : 0)) {
        return this_.parse_gen_block();
        // Check for `async {` and `async move {`,
      } else if (this_.is_gen_block(kw.Async, 0)) {
        return this_.parse_gen_block();
      } else if (at_async) {
        return this_.parse_expr_closure();
      } else if (this_.eat_keyword_noexpect(kw.Await)) {
        return this_.recover_incorrect_await_syntax(lo);
      } else {
        return this_.parse_expr_lit();
      }
    } else {
      return this_.parse_expr_lit();
    }
  });
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1428 parse_expr_lit
Parser.prototype.parse_expr_lit = function (this: Parser): PResult<Expr> {
  const lo = this.token.span;
  const r = this.parse_opt_token_lit();
  if (r !== undefined) {
    const [token_lit, _] = r;
    const expr = this.mk_expr(Span.to(lo, this.prev_token.span), { $: "Lit", _0: token_lit });
    return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
  } else {
    return this.try_macro_suggestion();
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1439 parse_expr_tuple_parens
Parser.prototype.parse_expr_tuple_parens = function (this: Parser, restrictions: Restrictions): PResult<Expr> {
  const lo = this.token.span;
  const r0 = this.expect(exp.OpenParen);
  if (r0.$ === "Err") return r0;
  const r = this.parse_seq_to_end(exp.CloseParen, SeqSep.trailing_allowed(exp.Comma), (p) =>
    p.parse_expr_res(Restrictions.intersection(restrictions, Restrictions.ALLOW_LET)),
  );
  if (r.$ === "Err") {
    const err = r._0;
    return Ok(this.recover_seq_parse_error(exp.OpenParen, exp.CloseParen, lo, err));
  }
  const [es, trailing_comma] = r._0;
  let kind: ExprKind;
  if (es.length === 1 && trailing_comma === Trailing.No) {
    // `(e)` is parenthesized `e`.
    kind = { $: "Paren", _0: es[0]! };
  } else {
    // `(e,)` is a tuple with only one field, `e`.
    kind = { $: "Tup", _0: es };
  }
  const expr = this.mk_expr(Span.to(lo, this.prev_token.span), kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1468 parse_expr_array_or_repeat
Parser.prototype.parse_expr_array_or_repeat = function (this: Parser, close: ExpTokenPair): PResult<Expr> {
  const lo = this.token.span;
  this.bump(); // `[` or other open delim

  let kind: ExprKind;
  if (this.eat(close)) {
    // Empty vector
    kind = { $: "Array", _0: [] };
  } else {
    // Non-empty vector
    const r = this.parse_expr();
    if (r.$ === "Err") return r;
    const first_expr = r._0;
    if (this.eat(exp.Semi)) {
      // Repeating array syntax: `[ 0; 512 ]`
      const rc = this.parse_expr_anon_const();
      if (rc.$ === "Err") return rc;
      const count = rc._0;
      const re = this.expect(close);
      if (re.$ === "Err") return re;
      kind = { $: "Repeat", _0: first_expr, _1: count };
    } else if (this.eat(exp.Comma)) {
      // Vector with two or more elements.
      const sep = SeqSep.trailing_allowed(exp.Comma);
      const rs = this.parse_seq_to_end(close, sep, (p) => p.parse_expr());
      if (rs.$ === "Err") return rs;
      const exprs = rs._0[0];
      exprs.splice(0, 0, first_expr);
      kind = { $: "Array", _0: exprs };
    } else {
      // Vector with one element
      const re = this.expect(close);
      if (re.$ === "Err") return re;
      kind = { $: "Array", _0: [first_expr] };
    }
  }
  const expr = this.mk_expr(Span.to(lo, this.prev_token.span), kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1499 parse_expr_path_start
Parser.prototype.parse_expr_path_start = function (this: Parser): PResult<Expr> {
  const maybe_eq_tok = this.prev_token;
  let qself: QSelf | undefined;
  let path: Path;
  if (this.eat_lt()) {
    const lt_span = this.prev_token.span;
    const r = this.parse_qpath(PathStyle.Expr);
    if (r.$ === "Err") {
      const err = r._0;
      // Suggests using '<=' if there is an error parsing qpath when the previous token
      // is an '=' token. Only emits suggestion if the '<' token and '=' token are
      // directly adjacent (i.e. '=<')
      if (maybe_eq_tok.eq(TK.Eq) && Span.hi(maybe_eq_tok.span) === Span.lo(lt_span)) {
        const eq_lt = Span.to(maybe_eq_tok.span, lt_span);
        err.span_suggestion_verbose(
          eq_lt,
          'you might have meant to write a "less than or equal to" comparison',
          "<=",
          Applicability.Unspecified,
        );
      }
      return Err(err);
    }
    [qself, path] = r._0;
  } else {
    qself = undefined;
    const r = this.parse_path(PathStyle.Expr);
    if (r.$ === "Err") return r;
    path = r._0;
  }

  // `!`, as an operator, is prefix, so we know this isn't that.
  let span: Span;
  let kind: ExprKind;
  let expr_: PResult<Expr> | undefined;
  if (this.eat(exp.Bang)) {
    // MACRO INVOCATION expression
    if (qself !== undefined) {
      this.dcx().emit_err(crate_diagnostics.MacroInvocationWithQualifiedPath_diagnostic({ _0: path.span }));
    }
    const lo = path.span;
    const ra = this.parse_delim_args();
    if (ra.$ === "Err") return ra;
    const mac = new ast.MacCall(path, ra._0);
    span = Span.to(lo, this.prev_token.span);
    kind = { $: "MacCall", _0: mac };
  } else if (this.check(exp.OpenBrace) && (expr_ = this.maybe_parse_struct_expr(qself, path)) !== undefined) {
    if (qself !== undefined) {
      this.psess.gated_spans.gate(sym.more_qualified_paths, path.span);
    }
    return expr_;
  } else {
    span = path.span;
    kind = { $: "Path", _0: qself, _1: path };
  }

  const expr = this.mk_expr(span, kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `'label: $expr`. The label is already parsed.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1549 parse_expr_labeled
Parser.prototype.parse_expr_labeled = function (this: Parser, label_: Label, consume_colon: boolean): PResult<Expr> {
  const lo = label_.ident.span;
  const label: Label | undefined = label_;
  const ate_colon = this.eat(exp.Colon);
  const tok_sp = this.token.span;
  let res: PResult<Expr>;
  if (this.eat_keyword(exp.While)) {
    res = this.parse_expr_while(label, lo);
  } else if (this.eat_keyword(exp.For)) {
    res = this.parse_expr_for(label, lo);
  } else if (this.eat_keyword(exp.Loop)) {
    res = this.parse_expr_loop(label, lo);
  } else if (this.check_noexpect(TK.OpenBrace) || this.token.is_metavar_block()) {
    res = this.parse_expr_block(label, lo, ast.BlockCheckMode.Default);
  } else if (
    !ate_colon &&
    this.may_recover() &&
    (token.TokenKind.close_delim(this.token.kind) !== undefined || this.token.is_punct()) &&
    could_be_unclosed_char_literal(label_.ident)
  ) {
    const [lit, _] = this.recover_unclosed_char(label_.ident, mk_token_lit_char, (self_) =>
      self_.dcx().create_err(
        crate_diagnostics.UnexpectedTokenAfterLabel_diagnostic({
          span: self_.token.span,
          remove_label: undefined,
          enclose_in_block: undefined,
        }),
      ),
    );
    consume_colon = false;
    res = Ok(this.mk_expr(lo, { $: "Lit", _0: lit }));
  } else if (!ate_colon && (this.check_noexpect(TK.Comma) || this.check_noexpect(TK.Gt))) {
    // We're probably inside of a `Path<'a>` that needs a turbofish
    const guar = this.dcx().emit_err(
      crate_diagnostics.UnexpectedTokenAfterLabel_diagnostic({
        span: this.token.span,
        remove_label: undefined,
        enclose_in_block: undefined,
      }),
    );
    consume_colon = false;
    res = Ok(this.mk_expr_err(lo, guar));
  } else {
    const err: crate_diagnostics.UnexpectedTokenAfterLabel = {
      span: this.token.span,
      remove_label: undefined,
      enclose_in_block: undefined,
    };

    // Continue as an expression in an effort to recover on `'label: non_block_expr`.
    const r = this.parse_expr();
    let expr: PResult<Expr>;
    if (r.$ === "Err") {
      expr = r;
    } else {
      expr = Ok(
        ((expr: Expr): Expr => {
          const span = expr.span;

          let found_labeled_breaks: boolean;
          {
            class FindLabeledBreaksVisitor extends Visitor<ControlFlow<null>> {
              override Result = VisitorResult.ControlFlow<null>();
              override visit_expr(ex: Expr): ControlFlow<null> {
                if (ex.kind.$ === "Break" && ex.kind._0 !== undefined) {
                  return ControlFlow.Break(null);
                } else {
                  return walk_expr(this, ex);
                }
              }
            }

            found_labeled_breaks = new FindLabeledBreaksVisitor().visit_expr(expr).$ === "Break";
          }

          // Suggestion involves adding a labeled block.
          //
          // If there are no breaks that may use this label, suggest removing the label and
          // recover to the unmodified expression.
          if (!found_labeled_breaks) {
            err.remove_label = Span.until(lo, span);

            return expr;
          }

          err.enclose_in_block = {
            left: Span.shrink_to_lo(span),
            right: Span.shrink_to_hi(span),
          };

          // Replace `'label: non_block_expr` with `'label: {non_block_expr}` in order to suppress future errors about `break 'label`.
          const stmt = this.mk_stmt(span, { $: "Expr", _0: expr });
          const blk = this.mk_block([stmt], ast.BlockCheckMode.Default, span);
          return this.mk_expr(span, { $: "Block", _0: blk, _1: label });
        })(r._0),
      );
    }

    this.dcx().emit_err(crate_diagnostics.UnexpectedTokenAfterLabel_diagnostic(err));
    res = expr;
  }
  if (res.$ === "Err") return res;
  const expr = res._0;

  if (!ate_colon && consume_colon) {
    this.dcx().emit_err(
      crate_diagnostics.RequireColonAfterLabeledExpression_diagnostic({
        span: expr.span,
        label: lo,
        label_end: Span.between(lo, tok_sp),
      }),
    );
  }

  return Ok(expr);
};

/// Emit an error when a char is parsed as a lifetime or label because of a missing quote.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1657 recover_unclosed_char
Parser.prototype.recover_unclosed_char = function <L>(
  this: Parser,
  ident: Ident,
  mk_lit_char: (a0: Symbol, a1: Span) => L,
  err: (a0: Parser) => Diag,
): L {
  assert(could_be_unclosed_char_literal(ident), "assertion failed: could_be_unclosed_char_literal(ident)");
  const r = this.dcx().try_steal_modify_and_emit_err(ident.span, StashKey.LifetimeIsChar, (err_) => {
    err_.span_suggestion_verbose(
      Span.shrink_to_hi(ident.span),
      "add `'` to close the char literal",
      "'",
      Applicability.MaybeIncorrect,
    );
  });
  if (r === undefined) {
    err(this)
      .with_span_suggestion_verbose(
        Span.shrink_to_hi(ident.span),
        "add `'` to close the char literal",
        "'",
        Applicability.MaybeIncorrect,
      )
      .emit_err();
  }
  const name = ident.without_first_quote().name;
  return mk_lit_char(name, ident.span);
};

/// Recover on the syntax `do catch { ... }` suggesting `try { ... }` instead.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1688 recover_do_catch
Parser.prototype.recover_do_catch = function (this: Parser): PResult<Expr> {
  const lo = this.token.span;

  this.bump(); // `do`
  this.bump(); // `catch`

  const span = Span.to(lo, this.prev_token.span);
  this.dcx().emit_err(crate_diagnostics.DoCatchSyntaxRemoved_diagnostic({ span }));

  return this.parse_try_block(lo);
};

/// Parse an expression if the token can begin one.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1701 parse_expr_opt
Parser.prototype.parse_expr_opt = function (this: Parser): PResult<Expr | undefined> {
  if (this.token.can_begin_expr()) {
    const r = this.parse_expr();
    if (r.$ === "Err") return r;
    return Ok(r._0);
  } else {
    return Ok(undefined);
  }
};

/// Parse `"return" expr?`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1706 parse_expr_return
Parser.prototype.parse_expr_return = function (this: Parser): PResult<Expr> {
  const lo = this.prev_token.span;
  const r = this.parse_expr_opt();
  if (r.$ === "Err") return r;
  const kind: ExprKind = { $: "Ret", _0: r._0 };
  const expr = this.mk_expr(Span.to(lo, this.prev_token.span), kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `"do" "yeet" expr?`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1714 parse_expr_yeet
Parser.prototype.parse_expr_yeet = function (this: Parser): PResult<Expr> {
  const lo = this.token.span;

  this.bump(); // `do`
  this.bump(); // `yeet`

  const r = this.parse_expr_opt();
  if (r.$ === "Err") return r;
  const kind: ExprKind = { $: "Yeet", _0: r._0 };

  const span = Span.to(lo, this.prev_token.span);
  this.psess.gated_spans.gate(sym.yeet_expr, span);
  const expr = this.mk_expr(span, kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `"become" expr`, with `"become"` token already eaten.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1729 parse_expr_become
Parser.prototype.parse_expr_become = function (this: Parser): PResult<Expr> {
  const lo = this.prev_token.span;
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  const kind: ExprKind = { $: "Become", _0: r._0 };
  const span = Span.to(lo, this.prev_token.span);
  this.psess.gated_spans.gate(sym.explicit_tail_calls, span);
  const expr = this.mk_expr(span, kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `"break" (('label (:? expr)?) | expr?)` with `"break"` token already eaten.
/// If the label is followed immediately by a `:` token, the label and `:` are
/// parsed as part of the expression (i.e. a labeled loop). The language team has
/// decided in #87026 to require parentheses as a visual aid to avoid confusion if
/// the break expression of an unlabeled break is a labeled loop (as in
/// `break 'lbl: loop {}`); a labeled break with an unlabeled loop as its value
/// expression only gets a warning for compatibility reasons; and a labeled break
/// with a labeled loop does not even get a warning because there is no ambiguity.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1746 parse_expr_break
Parser.prototype.parse_expr_break = function (this: Parser): PResult<Expr> {
  const lo = this.prev_token.span;
  let label = this.eat_label();
  let kind: Expr | undefined;
  if (this.token.kind.$ === "Colon" && label !== undefined) {
    const label_ = label;
    label = undefined;
    // The value expression can be a labeled loop, see issue #86948, e.g.:
    // `loop { break 'label: loop { break 'label 42; }; }`
    const r = this.parse_expr_labeled(label_, true);
    if (r.$ === "Err") return r;
    const lexpr = r._0;
    this.dcx().emit_err(
      crate_diagnostics.LabeledLoopInBreak_diagnostic({
        span: lexpr.span,
        sub: {
          $: "Expression",
          left: Span.shrink_to_lo(lexpr.span),
          right: Span.shrink_to_hi(lexpr.span),
        },
      }),
    );
    kind = lexpr;
  } else if (
    !this.token.eq(TK.OpenBrace) ||
    !Restrictions.contains(this.restrictions, Restrictions.NO_STRUCT_LITERAL)
  ) {
    const r = this.parse_expr_opt();
    if (r.$ === "Err") return r;
    let expr = r._0;
    if (expr !== undefined) {
      const ek = expr.kind;
      let is_unlabeled_loop: boolean;
      switch (ek.$) {
        case "While":
          is_unlabeled_loop = ek._2 === undefined;
          break;
        case "ForLoop":
          is_unlabeled_loop = ek._0.label === undefined;
          break;
        case "Loop":
          is_unlabeled_loop = ek._1 === undefined;
          break;
        case "Block":
          is_unlabeled_loop = ek._1 === undefined && ek._0.rules.$ === "Default";
          break;
        default:
          is_unlabeled_loop = false;
      }
      if (label !== undefined && is_unlabeled_loop) {
        const span = expr.span;
        this.psess.buffer_lint(
          BREAK_WITH_LABEL_AND_LOOP,
          Span.to(lo, expr.span),
          ast.CRATE_NODE_ID,
          crate_diagnostics.BreakWithLabelAndLoop_diagnostic({
            sub: {
              left: Span.shrink_to_lo(span),
              right: Span.shrink_to_hi(span),
            },
          }),
        );
      }

      // Recover `break label aaaaa`
      if (this.may_recover() && expr.kind.$ === "Path" && expr.kind._0 === undefined) {
        const p = expr.kind._1;
        if (p.segments.length === 1) {
          const segment = p.segments[0]!;
          if (segment.args === undefined) {
            const ident = segment.ident;
            const rn = this.parse_expr_opt();
            if (rn.$ === "Err") return rn;
            const next = rn._0;
            if (next !== undefined) {
              label = this.recover_ident_into_label(ident);
              expr = next;
            }
          }
        }
      }
    }

    kind = expr;
  } else {
    kind = undefined;
  }
  const expr = this.mk_expr(Span.to(lo, this.prev_token.span), { $: "Break", _0: label, _1: kind });
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `"continue" label?`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1814 parse_expr_continue
Parser.prototype.parse_expr_continue = function (this: Parser, lo: Span): PResult<Expr> {
  let label = this.eat_label();

  // Recover `continue label` -> `continue 'label`
  let id: [Ident, token.IdentKind] | undefined;
  if (this.may_recover() && label === undefined && (id = this.token.ident()) !== undefined) {
    const [ident, _] = id;
    this.bump();
    label = this.recover_ident_into_label(ident);
  }

  const kind: ExprKind = { $: "Continue", _0: label };
  return Ok(this.mk_expr(Span.to(lo, this.prev_token.span), kind));
};

/// Parse `"yield" expr?`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1831 parse_expr_yield
Parser.prototype.parse_expr_yield = function (this: Parser): PResult<Expr> {
  const lo = this.prev_token.span;
  const r = this.parse_expr_opt();
  if (r.$ === "Err") return r;
  const kind: ExprKind = { $: "Yield", _0: { $: "Prefix", _0: r._0 } };
  const span = Span.to(lo, this.prev_token.span);
  this.psess.gated_spans.gate(sym.yield_expr, span);
  const expr = this.mk_expr(span, kind);
  return this.maybe_recover_from_bad_qpath(expr, expr_recover_qpath());
};

/// Parse `builtin # ident(args,*)`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1841 parse_expr_builtin
Parser.prototype.parse_expr_builtin = function (this: Parser): PResult<Expr> {
  return this.parse_builtin((this_, lo, ident): PResult<Expr | undefined> => {
    let r: PResult<Expr>;
    switch (ident.name) {
      case sym.offset_of:
        r = this_.parse_expr_offset_of(lo);
        break;
      case sym.type_ascribe:
        r = this_.parse_expr_type_ascribe(lo);
        break;
      case sym.wrap_binder:
        r = this_.parse_expr_unsafe_binder_cast(lo, ast.UnsafeBinderCastKind.Wrap);
        break;
      case sym.unwrap_binder:
        r = this_.parse_expr_unsafe_binder_cast(lo, ast.UnsafeBinderCastKind.Unwrap);
        break;
      default:
        return Ok(undefined);
    }
    if (r.$ === "Err") return r;
    return Ok(r._0);
  });
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1857 parse_builtin
Parser.prototype.parse_builtin = function <T>(
  this: Parser,
  parse: (this_: Parser, a1: Span, a2: Ident) => PResult<T | undefined>,
): PResult<T> {
  const lo = this.token.span;

  this.bump(); // `builtin`
  this.bump(); // `#`

  const id = this.token.ident();
  if (!(id !== undefined && id[1] === IdentKind.Normal)) {
    const err = this.dcx().create_err(crate_diagnostics.ExpectedBuiltinIdent_diagnostic({ span: this.token.span }));
    return Err(err);
  }
  const ident = id[0];
  this.psess.gated_spans.gate(sym.builtin_syntax, ident.span);
  this.bump();

  const r0 = this.expect(exp.OpenParen);
  if (r0.$ === "Err") return r0;
  let ret: PResult<T>;
  const rp = parse(this, lo, ident);
  if (rp.$ === "Err") return rp;
  if (rp._0 !== undefined) {
    ret = Ok(rp._0);
  } else {
    const err = this.dcx().create_err(
      crate_diagnostics.UnknownBuiltinConstruct_diagnostic({
        span: Span.to(lo, ident.span),
        name: ident,
      }),
    );
    return Err(err);
  }
  const r1 = this.expect(exp.CloseParen);
  if (r1.$ === "Err") return r1;

  return ret;
};

/// Built-in macro for `offset_of!` expressions.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1891 parse_expr_offset_of
Parser.prototype.parse_expr_offset_of = function (this: Parser, lo: Span): PResult<Expr> {
  const rt = this.parse_ty();
  if (rt.$ === "Err") return rt;
  const container = rt._0;
  const rc = this.expect(exp.Comma);
  if (rc.$ === "Err") return rc;

  const rf = this.parse_floating_field_access();
  if (rf.$ === "Err") return rf;
  const fields = rf._0;
  const trailing_comma = this.eat_noexpect(TK.Comma);

  const re = this.expect_one_of([], [exp.CloseParen]);
  if (re.$ === "Err") {
    const e = re._0;
    if (trailing_comma) {
      e.note("unexpected third argument to offset_of");
    } else {
      e.note("offset_of expects dot-separated field and variant names");
    }
    e.emit();
  }

  // Eat tokens until the macro call ends.
  if (this.may_recover()) {
    while (!token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
      this.bump();
    }
  }

  const span = Span.to(lo, this.token.span);
  return Ok(this.mk_expr(span, { $: "OffsetOf", _0: container, _1: fields }));
};

/// Built-in macro for type ascription expressions.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1919 parse_expr_type_ascribe
Parser.prototype.parse_expr_type_ascribe = function (this: Parser, lo: Span): PResult<Expr> {
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  const expr = r._0;
  const rc = this.expect(exp.Comma);
  if (rc.$ === "Err") return rc;
  const rt = this.parse_ty();
  if (rt.$ === "Err") return rt;
  const ty = rt._0;
  const span = Span.to(lo, this.token.span);
  return Ok(this.mk_expr(span, { $: "Type", _0: expr, _1: ty }));
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1927 parse_expr_unsafe_binder_cast
Parser.prototype.parse_expr_unsafe_binder_cast = function (
  this: Parser,
  lo: Span,
  kind: UnsafeBinderCastKind,
): PResult<Expr> {
  const r = this.parse_expr();
  if (r.$ === "Err") return r;
  const expr = r._0;
  let ty: Ty | undefined;
  if (this.eat(exp.Comma)) {
    const rt = this.parse_ty();
    if (rt.$ === "Err") return rt;
    ty = rt._0;
  } else {
    ty = undefined;
  }
  const span = Span.to(lo, this.token.span);
  return Ok(this.mk_expr(span, { $: "UnsafeBinderCast", _0: kind, _1: expr, _2: ty }));
};

/// Returns a string literal if the next token is a string literal.
/// In case of error returns `Some(lit)` if the next token is a literal with a wrong kind,
/// and returns `None` if the next token is not literal at all.
// rustc: compiler/rustc_parse/src/parser/expr.rs:1941 parse_str_lit
Parser.prototype.parse_str_lit = function (this: Parser): Result<StrLit, MetaItemLit | undefined> {
  const lit = this.parse_opt_meta_item_lit();
  if (lit !== undefined) {
    if (lit.kind.$ === "Str") {
      const [symbol_unescaped, style] = [lit.kind._0, lit.kind._1];
      return Ok(new ast.StrLit(lit.symbol, lit.suffix, symbol_unescaped, style, lit.span));
    } else {
      return Err(lit);
    }
  } else {
    return Err(undefined);
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1957 mk_token_lit_char
export function mk_token_lit_char(name: Symbol, span: Span): [Lit, Span] {
  return [token.Lit.new(token.LitKind.Char, name, undefined), span];
}

// rustc: compiler/rustc_parse/src/parser/expr.rs:1961 mk_meta_item_lit_char
export function mk_meta_item_lit_char(name: Symbol, span: Span): MetaItemLit {
  const first = Symbol.as_str(name).codePointAt(0);
  return new ast.MetaItemLit(name, undefined, { $: "Char", _0: first ?? C_UNDERSCORE }, span);
}

// rustc: compiler/rustc_parse/src/parser/expr.rs:1970 handle_missing_lit
Parser.prototype.handle_missing_lit = function <L>(this: Parser, mk_lit_char: (a0: Symbol, a1: Span) => L): PResult<L> {
  const token_ = this.token;
  const err = (self_: Parser): Diag => {
    const msg = `unexpected token: ${token_descr(token_)}`;
    return self_.dcx().struct_span_err(token_.span, msg);
  };
  // On an error path, eagerly consider a lifetime to be an unclosed character lit, if that
  // makes sense.
  const lt0 = this.token.lifetime();
  if (lt0 !== undefined && lt0[1] === IdentKind.Normal && could_be_unclosed_char_literal(lt0[0])) {
    const lt = this.expect_lifetime();
    return Ok(this.recover_unclosed_char(lt.ident, mk_lit_char, err));
  } else {
    return Err(err(this));
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1991 parse_token_lit
Parser.prototype.parse_token_lit = function (this: Parser): PResult<[Lit, Span]> {
  const r = this.parse_opt_token_lit();
  if (r !== undefined) return Ok(r);
  return this.handle_missing_lit(mk_token_lit_char);
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:1997 parse_meta_item_lit
Parser.prototype.parse_meta_item_lit = function (this: Parser): PResult<MetaItemLit> {
  const r = this.parse_opt_meta_item_lit();
  if (r !== undefined) return Ok(r);
  return this.handle_missing_lit(mk_meta_item_lit_char);
};

/// PORT: `char::is_numeric` (general categories Nd, Nl, No), via the JS Unicode property `N`.
const IS_NUMERIC = /^\p{N}$/u;

// rustc: compiler/rustc_parse/src/parser/expr.rs:2003 recover_after_dot
Parser.prototype.recover_after_dot = function (this: Parser): void {
  if (this.token.kind.$ === "Dot") {
    // Attempt to recover `.4` as `0.4`. We don't currently have any syntax where
    // dot would follow an optional literal, so we do this unconditionally.
    const recovered = this.look_ahead(1, (next_token): Token | undefined => {
      // If it's an integer that looks like a float, then recover as such.
      //
      // We will never encounter the exponent part of a floating
      // point literal here, since there's no use of the exponent
      // syntax that also constitutes a valid integer, so we need
      // not check for that.
      const k = next_token.kind;
      if (
        k.$ === "Literal" &&
        k._0.kind.$ === "Integer" &&
        (k._0.suffix === undefined || k._0.suffix === sym.f32 || k._0.suffix === sym.f64) &&
        [...Symbol.as_str(k._0.symbol)].every((c) => IS_NUMERIC.test(c) || c === "_") &&
        Span.hi(this.token.span) === Span.lo(next_token.span)
      ) {
        const { symbol, suffix } = k._0;
        const s = "0." + Symbol.as_str(symbol);
        const kind = token.TokenKind.lit(token.LitKind.Float, Symbol.intern(s), suffix);
        return token.Token.new(kind, Span.to(this.token.span, next_token.span));
      } else {
        return undefined;
      }
    });
    if (recovered !== undefined) {
      this.dcx().emit_err(
        crate_diagnostics.FloatLiteralRequiresIntegerPart_diagnostic({
          span: recovered.span,
          suggestion: Span.shrink_to_lo(recovered.span),
        }),
      );
      this.bump();
      this.token = recovered;
    }
  }
};

/// Keep this in sync with `Token::can_begin_literal_maybe_minus` and
/// `Lit::from_token` (excluding unary negation).
// rustc: compiler/rustc_parse/src/parser/expr.rs:2040 eat_token_lit
Parser.prototype.eat_token_lit = function (this: Parser): Lit | undefined {
  const check_expr = (expr: Expr): Lit | undefined => {
    const ek = expr.kind;
    if (ek.$ === "Lit") {
      return ek._0;
    } else if (ek.$ === "Unary" && ek._0 === ast.UnOp.Neg && ek._1.kind.$ === "Lit") {
      return undefined;
    } else {
      return panic(`unexpected reparsed expr/literal: ${ast.debug_ExprKind(expr.kind, PLAIN)}`);
    }
  };
  const k = this.token.uninterpolate().kind;
  if (
    k.$ === "Ident" &&
    (k._1 === IdentKind.Normal || k._1 === IdentKind.ForcedKeyword) &&
    Symbol.is_bool_lit(k._0)
  ) {
    const name = k._0;
    this.bump();
    return token.Lit.new(token.LitKind.Bool, name, undefined);
  } else if (k.$ === "Literal") {
    const token_lit = k._0;
    this.bump();
    return token_lit;
  } else if (k.$ === "OpenInvisible" && k._0.$ === "MetaVar" && k._0._0.$ === "Literal") {
    const lit = this.eat_metavar_seq(token.MetaVarKind.Literal, (this_) => this_.parse_literal_maybe_minus());
    if (lit === undefined) return panic("metavar seq literal");
    return check_expr(lit);
  } else if (
    k.$ === "OpenInvisible" &&
    k._0.$ === "MetaVar" &&
    k._0._0.$ === "Expr" &&
    k._0._0.can_begin_literal_maybe_minus
  ) {
    const mv_kind = k._0._0;
    const expr = this.eat_metavar_seq(mv_kind, (this_) => this_.parse_expr());
    if (expr === undefined) return panic("metavar seq expr");
    return check_expr(expr);
  } else {
    return undefined;
  }
};

/// Matches `lit = true | false | token_lit`.
/// Returns `None` if the next token is not a literal.
// rustc: compiler/rustc_parse/src/parser/expr.rs:2083 parse_opt_token_lit
Parser.prototype.parse_opt_token_lit = function (this: Parser): [Lit, Span] | undefined {
  this.recover_after_dot();
  const span = this.token.span;
  const token_lit = this.eat_token_lit();
  return token_lit === undefined ? undefined : [token_lit, span];
};

/// Matches `lit = true | false | token_lit`.
/// Returns `None` if the next token is not a literal.
// rustc: compiler/rustc_parse/src/parser/expr.rs:2091 parse_opt_meta_item_lit
Parser.prototype.parse_opt_meta_item_lit = function (this: Parser): MetaItemLit | undefined {
  this.recover_after_dot();
  const span = this.token.span;
  const uninterpolated_span = this.token_uninterpolated_span();
  const token_lit0 = this.eat_token_lit();
  if (token_lit0 === undefined) return undefined;
  const token_lit = token_lit0;
  const r = MetaItemLitC.from_token_lit(token_lit, span);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const err = r._0;
    const guar = report_lit_error(this.psess, err, token_lit, uninterpolated_span);
    // Pack possible quotes and prefixes from the original literal into
    // the error literal's symbol so they can be pretty-printed faithfully.
    const suffixless_lit = token.Lit.new(token_lit.kind, token_lit.symbol, undefined);
    const symbol = Symbol.intern(token.display_Lit(suffixless_lit));
    const token_lit2 = token.Lit.new({ $: "Err", _0: guar }, symbol, token_lit.suffix);
    return unwrap_result(MetaItemLitC.from_token_lit(token_lit2, uninterpolated_span));
  }
};

/// Matches `'-' lit | lit` (cf. `ast_validation::AstValidator::check_expr_within_pat`).
/// Keep this in sync with `Token::can_begin_literal_maybe_minus`.
// rustc: compiler/rustc_parse/src/parser/expr.rs:2113 parse_literal_maybe_minus
Parser.prototype.parse_literal_maybe_minus = function (this: Parser): PResult<Expr> {
  let expr: Expr | undefined;
  let lit: Expr | undefined;
  if (
    (expr = this.eat_metavar_seq_with_matcher(
      (mv_kind) => mv_kind.$ === "Expr",
      (this_) => {
        // FIXME(nnethercote) The `expr` case should only match if
        // `e` is an `ExprKind::Lit` or an `ExprKind::Unary` containing
        // an `UnOp::Neg` and an `ExprKind::Lit`, like how
        // `can_begin_literal_maybe_minus` works. But this method has
        // been over-accepting for a long time, and to make that change
        // here requires also changing some `parse_literal_maybe_minus`
        // call sites to accept additional expression kinds. E.g.
        // `ExprKind::Path` must be accepted when parsing range
        // patterns. That requires some care. So for now, we continue
        // being less strict here than we should be.
        return this_.parse_expr();
      },
    )) !== undefined
  ) {
    return Ok(expr);
  } else if (
    (lit = this.eat_metavar_seq(token.MetaVarKind.Literal, (this_) => this_.parse_literal_maybe_minus())) !==
    undefined
  ) {
    return Ok(lit);
  }

  const lo = this.token.span;
  const minus_present = this.eat(exp.Minus);
  const r = this.parse_token_lit();
  if (r.$ === "Err") return r;
  const [token_lit, span] = r._0;
  const expr2 = this.mk_expr(span, { $: "Lit", _0: token_lit });

  if (minus_present) {
    return Ok(this.mk_expr(Span.to(lo, this.prev_token.span), this.mk_unary(ast.UnOp.Neg, expr2)));
  } else {
    return Ok(expr2);
  }
};

// rustc: compiler/rustc_parse/src/parser/expr.rs:2149 suggest_missing_semicolon_before_array
Parser.prototype.suggest_missing_semicolon_before_array = function (
  this: Parser,
  prev_span: Span,
  open_delim_span: Span,
): PResult<undefined> {
  if (!this.may_recover()) {
    return Ok(undefined);
  }

  if (this.token.kind.$ === "Comma") {
    if (!this.psess.source_map().is_multiline(Span.until(prev_span, this.token.span))) {
      return Ok(undefined);
    }
    const snapshot = this.create_snapshot_for_diagnostic();
    snapshot.parser.bump();
    const r = snapshot.parser.parse_seq_to_before_end(exp.CloseBracket, SeqSep.trailing_allowed(exp.Comma), (p) =>
      p.parse_expr(),
    );
    let snippet: Result<string, SpanSnippetError>;
    if (
      r.$ === "Ok" &&
      // When the close delim is `)`, `token.kind` is expected to be `token::CloseParen`,
      // but the actual `token.kind` is `token::CloseBracket`.
      // This is because the `token.kind` of the close delim is treated as the same as
      // that of the open delim in `TokenTreesReader::parse_token_tree`, even if the delimiters of them are different.
      // Therefore, `token.kind` should not be compared here.
      (snippet = snapshot.parser.span_to_snippet(snapshot.parser.token.span)).$ === "Ok" &&
      snippet._0 === "]"
    ) {
      return Err(
        this.dcx().create_err(
          crate_diagnostics.MissingSemicolonBeforeArray_diagnostic({
            open_delim: open_delim_span,
            semicolon: Span.shrink_to_hi(prev_span),
          }),
        ),
      );
    } else if (r.$ === "Ok") {
      // ()
    } else {
      r._0.cancel();
    }
  }
  return Ok(undefined);
};

/// Parses a block or unsafe block.
// rustc: compiler/rustc_parse/src/parser/expr.rs:2192 parse_expr_block
Parser.prototype.parse_expr_block = function (
  this: Parser,
  opt_label: Label | undefined,
  lo: Span,
  blk_mode: BlockCheckMode,
): PResult<Expr> {
  if (this.token.is_metavar_block()) {
    this.dcx().emit_err(
      crate_diagnostics.InvalidBlockMacroSegment_diagnostic({
        span: this.token.span,
        context: Span.to(lo, this.token.span),
        wrap: {
          lo: Span.shrink_to_lo(this.token.span),
          hi: Span.shrink_to_hi(this.token.span),
        },
      }),
    );
  }

  const r = this.parse_block_common(lo, blk_mode, undefined);
  if (r.$ === "Err") return r;
  const [attrs, blk] = r._0;
  return Ok(this.mk_expr_with_attrs(blk.span, { $: "Block", _0: blk, _1: opt_label }, attrs));
};

/// Parse a block which takes no attributes and has no label
// rustc: compiler/rustc_parse/src/parser/expr.rs:2214 parse_simple_block
Parser.prototype.parse_simple_block = function (this: Parser): PResult<Expr> {
  const r = this.parse_block();
  if (r.$ === "Err") return r;
  const blk = r._0;
  return Ok(this.mk_expr(blk.span, { $: "Block", _0: blk, _1: undefined }));
};

// ---- STUB TAIL ----
// pub(crate) fn could_be_unclosed_char_literal(ident: Ident) -> bool (expr.rs:4080)
export function could_be_unclosed_char_literal(_ident: import("../../rustc_span/symbol.ts").Ident): boolean {
  return unported("rustc_parse::parser::expr::could_be_unclosed_char_literal");
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::expr::Parser", [
  "parse_expr_closure",
  "parse_closure_block_body",
  "parse_capture_clause",
  "parse_fn_block_decl",
  "parse_fn_block_param",
  "parse_expr_if",
  "parse_if_after_cond",
  "parse_expr_cond",
  "parse_expr_let",
  "parse_expr_else",
  "error_on_if_block_attrs",
  "error_on_extra_if",
  "parse_for_head",
  "parse_expr_for",
  "recover_loop_else",
  "error_missing_in_for_loop",
  "for_loop_head_has_in",
  "parse_expr_while",
  "parse_expr_loop",
  "eat_label",
  "parse_expr_match",
  "parse_match_block",
  "parse_arm_body_missing_braces",
  "parse_arm",
  "eat_metavar_guard",
  "parse_match_arm_guard",
  "expect_match_arm_guard",
  "expect_match_arm_guard_cond",
  "parse_match_arm_pat_and_guard",
  "parse_match_guard_condition",
  "is_builtin",
  "parse_try_block",
  "is_do_catch_block",
  "is_do_yeet",
  "is_try_block",
  "parse_gen_block",
  "is_gen_block",
  "is_async_gen_block",
  "is_likely_struct_lit",
  "maybe_parse_struct_expr",
  "maybe_recover_bad_struct_literal_path",
  "parse_struct_fields",
  "parse_expr_struct",
  "recover_struct_comma_after_dotdot",
  "recover_struct_field_dots",
  "recover_ident_into_label",
  "parse_expr_field",
  "error_on_eq_field_init",
  "mk_assign_op",
  "mk_range",
  "mk_unary",
  "mk_binary",
  "mk_index",
  "mk_call",
  "mk_await_expr",
  "mk_use_expr",
  "mk_expr_with_attrs",
  "mk_expr",
  "mk_expr_err",
  "mk_unit_expr",
  "mk_closure_expr",
  "mk_expr_sp",
  "collect_tokens_for_expr",
]);
