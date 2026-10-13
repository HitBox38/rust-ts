// Port of compiler/rustc_ast_pretty/src/pprust/state/expr.rs
//
// PORT: `impl<'a> State<'a>` defined in another file (PORTING §5 "Methods defined in another
// file"): the methods are declared on `State` via `declare module` and assigned to
// `State.prototype`. `rustc_ast_pretty/pprust/mod.ts` imports this module for its side effects,
// after `state.ts`.

import { ast, token } from "../../../rustc_ast/lib.ts";
import * as classify from "../../../rustc_ast/util/classify.ts";
import { escape_byte_str_symbol } from "../../../rustc_ast/util/literal.ts";
import * as parser from "../../../rustc_ast/util/parser.ts";
import { type ExprPrecedence, ExprPrecedence_discriminant } from "../../../rustc_ast/util/parser.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { ByteSymbol, Symbol } from "../../../rustc_span/symbol.ts";
import { escape_char } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import { Breaks } from "../../pp.ts";
import { INDENT_UNIT, State } from "../state.ts";
import { FixupContext } from "./fixup.ts";

// use crate::pp::Breaks::Inconsistent;
const Inconsistent: Breaks = Breaks.Inconsistent;

// PORT: `ExprPrecedence: PartialOrd` (derived) compares by discriminant.
function lt(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] < ExprPrecedence_discriminant[b];
}
function le(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] <= ExprPrecedence_discriminant[b];
}

declare module "../state.ts" {
  interface State {
    print_else(els: ast.Expr | undefined): void;
    print_if(test: ast.Expr, blk: ast.Block, elseopt: ast.Expr | undefined): void;
    print_call_post(args: readonly ast.Expr[]): void;
    print_expr_as_cond(expr: ast.Expr): void;
    print_expr_cond_paren(expr: ast.Expr, needs_par: boolean, fixup: FixupContext): void;
    print_expr_vec(exprs: readonly ast.Expr[]): void;
    print_expr_anon_const(expr: ast.AnonConst, attrs: readonly ast.Attribute[]): void;
    print_expr_repeat(element: ast.Expr, count: ast.AnonConst): void;
    print_expr_struct(
      qself: ast.QSelf | undefined,
      path: ast.Path,
      fields: readonly ast.ExprField[],
      rest: ast.StructRest,
    ): void;
    print_expr_tup(exprs: readonly ast.Expr[]): void;
    print_expr_call(func: ast.Expr, args: readonly ast.Expr[], fixup: FixupContext): void;
    print_expr_method_call(
      segment: ast.PathSegment,
      receiver: ast.Expr,
      base_args: readonly ast.Expr[],
      fixup: FixupContext,
    ): void;
    print_expr_binary(op: ast.BinOpKind, lhs: ast.Expr, rhs: ast.Expr, fixup: FixupContext): void;
    print_expr_unary(op: ast.UnOp, expr: ast.Expr, fixup: FixupContext): void;
    print_expr_addr_of(kind: ast.BorrowKind, mutability: ast.Mutability, expr: ast.Expr, fixup: FixupContext): void;
    print_expr(expr: ast.Expr, fixup: FixupContext): void;
    print_expr_outer_attr_style(expr: ast.Expr, is_inline: boolean, fixup: FixupContext): void;
    print_arm(arm: ast.Arm): void;
    print_closure_binder(binder: ast.ClosureBinder): void;
    print_movability(movability: ast.Movability): void;
    print_capture_clause(capture_clause: ast.CaptureBy): void;
  }
}

// impl<'a> State<'a>

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:17 print_else
State.prototype.print_else = function (this: State, els: ast.Expr | undefined): void {
  if (els !== undefined) {
    const _else = els;
    const kind = _else.kind;
    if (kind.$ === "If") {
      // Another `else if` block.
      const [i, then, e] = [kind._0, kind._1, kind._2];
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word(" else if ");
      this.print_expr_as_cond(i);
      this.s.space();
      this.print_block(then, cb, ib);
      this.print_else(e);
    } else if (kind.$ === "Block" && kind._1 === undefined) {
      // Final `else` block.
      const b = kind._0;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word(" else ");
      this.print_block(b, cb, ib);
    } else {
      // Constraints would be great here!
      panic("print_if saw if with weird alternative");
    }
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:45 print_if
State.prototype.print_if = function (
  this: State,
  test: ast.Expr,
  blk: ast.Block,
  elseopt: ast.Expr | undefined,
): void {
  const cb = this.s.cbox(0);
  const ib = this.s.ibox(0);
  this.s.word_nbsp("if");
  this.print_expr_as_cond(test);
  this.s.space();
  this.print_block(blk, cb, ib);
  this.print_else(elseopt);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:55 print_call_post
State.prototype.print_call_post = function (this: State, args: readonly ast.Expr[]): void {
  this.s.popen();
  this.commasep_exprs(Inconsistent, args);
  this.s.pclose();
};

/// Prints an expr using syntax that's acceptable in a condition position, such as the `cond` in
/// `if cond { ... }`.
// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:63 print_expr_as_cond
State.prototype.print_expr_as_cond = function (this: State, expr: ast.Expr): void {
  this.print_expr_cond_paren(expr, cond_needs_par(expr), FixupContext.new_cond());
};

/// Does `expr` need parentheses when printed in a condition position?
///
/// These cases need parens due to the parse error observed in #26461: `if return {}`
/// parses as the erroneous construct `if (return {})`, not `if (return) {}`.
// PORT: associated fn without `self` (`Self::cond_needs_par`) -> a module-level function (a static
// cannot be added to the `State` class from an extension module).
// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:71 cond_needs_par
function cond_needs_par(expr: ast.Expr): boolean {
  switch (expr.kind.$) {
    case "Break":
    case "Closure":
    case "Ret":
    case "Yeet":
      return true;
    default:
      return parser.contains_exterior_struct_lit(expr);
  }
}

/// Prints `expr` or `(expr)` when `needs_par` holds.
// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:82 print_expr_cond_paren
State.prototype.print_expr_cond_paren = function (
  this: State,
  expr: ast.Expr,
  needs_par: boolean,
  fixup: FixupContext,
): void {
  if (needs_par) {
    this.s.popen();

    // If we are surrounding the whole cond in parentheses, such as:
    //
    //     if (return Struct {}) {}
    //
    // then there is no need for parenthesizing the individual struct
    // expressions within. On the other hand if the whole cond is not
    // parenthesized, then print_expr must parenthesize exterior struct
    // literals.
    //
    //     if x == (Struct {}) {}
    //
    fixup = FixupContext.default();
  }

  this.print_expr(expr, fixup);

  if (needs_par) {
    this.s.pclose();
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:112 print_expr_vec
State.prototype.print_expr_vec = function (this: State, exprs: readonly ast.Expr[]): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("[");
  this.commasep_exprs(Inconsistent, exprs);
  this.s.word("]");
  this.s.end(ib);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:120 print_expr_anon_const
State.prototype.print_expr_anon_const = function (
  this: State,
  expr: ast.AnonConst,
  attrs: readonly ast.Attribute[],
): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("const");
  this.s.nbsp();
  const kind = expr.value.kind;
  if (kind.$ === "Block" && kind._1 === undefined) {
    const block = kind._0;
    const cb = this.s.cbox(0);
    const ib = this.s.ibox(0);
    this.print_block_with_attrs(block, attrs, cb, ib);
  } else {
    this.print_expr(expr.value, FixupContext.default());
  }
  this.s.end(ib);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:138 print_expr_repeat
State.prototype.print_expr_repeat = function (this: State, element: ast.Expr, count: ast.AnonConst): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("[");
  this.print_expr(element, FixupContext.default());
  this.s.word_space(";");
  this.print_expr(count.value, FixupContext.default());
  this.s.word("]");
  this.s.end(ib);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:148 print_expr_struct
State.prototype.print_expr_struct = function (
  this: State,
  qself: ast.QSelf | undefined,
  path: ast.Path,
  fields: readonly ast.ExprField[],
  rest: ast.StructRest,
): void {
  if (qself !== undefined) {
    this.print_qpath(path, qself, true);
  } else {
    this.print_path(path, true, 0);
  }
  this.s.nbsp();
  this.s.word("{");
  let has_rest: boolean;
  switch (rest.$) {
    case "Base":
    case "Rest":
      has_rest = true;
      break;
    case "None":
    case "NoneWithError":
      has_rest = false;
      break;
  }
  if (fields.length === 0 && !has_rest) {
    this.s.word("}");
    return;
  }
  const cb = this.s.cbox(0);
  for (let idx = 0; idx < fields.length; idx++) {
    const field = fields[idx]!;
    const is_first = idx === 0;
    const is_last = idx === fields.length - 1;
    this.maybe_print_comment(Span.hi(field.span));
    this.print_outer_attributes(field.attrs);
    if (is_first) {
      this.s.space_if_not_bol();
    }
    if (!field.is_shorthand) {
      this.print_ident(field.ident);
      this.s.word_nbsp(":");
    }
    this.print_expr(field.expr, FixupContext.default());
    if (!is_last || has_rest) {
      this.s.word_space(",");
    } else {
      this.s.trailing_comma_or_space();
    }
  }
  if (has_rest) {
    if (fields.length === 0) {
      this.s.space();
    }
    this.s.word("..");
    if (rest.$ === "Base") {
      const expr = rest._0;
      this.print_expr(expr, FixupContext.default());
    }
    this.s.space();
  }
  this.s.offset(-INDENT_UNIT);
  this.s.end(cb);
  this.s.word("}");
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:205 print_expr_tup
State.prototype.print_expr_tup = function (this: State, exprs: readonly ast.Expr[]): void {
  this.s.popen();
  this.commasep_exprs(Inconsistent, exprs);
  if (exprs.length === 1) {
    this.s.word(",");
  }
  this.s.pclose();
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:214 print_expr_call
State.prototype.print_expr_call = function (
  this: State,
  func: ast.Expr,
  args: readonly ast.Expr[],
  fixup: FixupContext,
): void {
  // Independent of parenthesization related to precedence, we must
  // parenthesize `func` if this is a statement context in which without
  // parentheses, a statement boundary would occur inside `func` or
  // immediately after `func`.
  //
  // Suppose `func` represents `match () { _ => f }`. We must produce:
  //
  //     (match () { _ => f })();
  //
  // instead of:
  //
  //     match () { _ => f } ();
  //
  // because the latter is valid syntax but with the incorrect meaning.
  // It's a match-expression followed by tuple-expression, not a function
  // call.
  const func_fixup = fixup.leftmost_subexpression_with_operator(true);

  let needs_paren: boolean;
  const fk = func.kind;
  if (fk.$ === "Field") {
    // In order to call a named field, needs parens: `(self.fun)()`
    // But not for an unnamed field: `self.0()`
    const name = fk._1;
    needs_paren = !name.is_numeric();
  } else {
    // Block-like expressions (block, match, if, loop, ...) never
    // parse as the callee of a call, regardless of context: the
    // closing brace ends the expression and `(args)` becomes a
    // separate tuple. Parenthesize them so the call survives a
    // pretty-print round trip.
    needs_paren = lt(func_fixup.precedence(func), "Unambiguous") || classify.expr_is_complete(func);
  }

  this.print_expr_cond_paren(func, needs_paren, func_fixup);
  this.print_call_post(args);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:252 print_expr_method_call
State.prototype.print_expr_method_call = function (
  this: State,
  segment: ast.PathSegment,
  receiver: ast.Expr,
  base_args: readonly ast.Expr[],
  fixup: FixupContext,
): void {
  // The fixup here is different than in `print_expr_call` because
  // statement boundaries never occur in front of a `.` (or `?`) token.
  //
  // Needs parens:
  //
  //     (loop { break x; })();
  //
  // Does not need parens:
  //
  //     loop { break x; }.method();
  //
  const needs_paren = lt(receiver.precedence(), "Unambiguous");
  this.print_expr_cond_paren(receiver, needs_paren, fixup.leftmost_subexpression_with_dot());

  // If the receiver is an unsuffixed float literal like `0.`, insert
  // a space so the `.` of the method call doesn't merge with the
  // trailing dot: `0. .method()` instead of `0..method()`.
  if (!needs_paren && expr_ends_with_dot(receiver)) {
    this.s.word(" ");
  }
  this.s.word(".");
  this.print_ident(segment.ident);
  if (segment.args !== undefined) {
    const args = segment.args;
    this.print_generic_args(args, true);
  }
  this.print_call_post(base_args);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:287 print_expr_binary
State.prototype.print_expr_binary = function (
  this: State,
  op: ast.BinOpKind,
  lhs: ast.Expr,
  rhs: ast.Expr,
  fixup: FixupContext,
): void {
  let operator_can_begin_expr: boolean;
  switch (op) {
    case "Sub": // -x
    case "Mul": // *x
    case "And": // &&x
    case "Or": // || x
    case "BitAnd": // &x
    case "BitOr": // |x| x
    case "Shl": // <<T as Trait>::Type as Trait>::CONST
    case "Lt": // <T as Trait>::CONST
      operator_can_begin_expr = true;
      break;
    default:
      operator_can_begin_expr = false;
  }

  const left_fixup = fixup.leftmost_subexpression_with_operator(operator_can_begin_expr);

  const binop_prec = ast.BinOpKind.precedence(op);
  const left_prec = left_fixup.precedence(lhs);
  const right_prec = fixup.precedence(rhs);

  let left_needs_paren: boolean;
  let right_needs_paren: boolean;
  switch (ast.BinOpKind.fixity(op)) {
    case "Left":
      [left_needs_paren, right_needs_paren] = [lt(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
    case "Right":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), lt(right_prec, binop_prec)];
      break;
    case "None":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
  }

  if (lhs.kind.$ === "Cast" && (op === "Lt" || op === "Shl")) {
    // These cases need parens: `x as i32 < y` has the parser thinking that `i32 < y` is
    // the beginning of a path type. It starts trying to parse `x as (i32 < y ...` instead
    // of `(x as i32) < ...`. We need to convince it _not_ to do that.
    left_needs_paren = true;
  } else if (lhs.kind.$ === "Let" && !parser.needs_par_as_let_scrutinee(binop_prec)) {
    // We are given `(let _ = a) OP b`.
    //
    // - When `OP <= LAnd` we should print `let _ = a OP b` to avoid redundant parens
    //   as the parser will interpret this as `(let _ = a) OP b`.
    //
    // - Otherwise, e.g. when we have `(let a = b) < c` in AST,
    //   parens are required since the parser would interpret `let a = b < c` as
    //   `let a = (b < c)`. To achieve this, we force parens.
    left_needs_paren = true;
  }

  this.print_expr_cond_paren(lhs, left_needs_paren, left_fixup);
  this.s.space();
  this.s.word_space(ast.BinOpKind.as_str(op));
  this.print_expr_cond_paren(rhs, right_needs_paren, fixup.rightmost_subexpression());
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:346 print_expr_unary
State.prototype.print_expr_unary = function (this: State, op: ast.UnOp, expr: ast.Expr, fixup: FixupContext): void {
  this.s.word(ast.UnOp.as_str(op));
  this.print_expr_cond_paren(expr, lt(fixup.precedence(expr), "Prefix"), fixup.rightmost_subexpression());
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:355 print_expr_addr_of
State.prototype.print_expr_addr_of = function (
  this: State,
  kind: ast.BorrowKind,
  mutability: ast.Mutability,
  expr: ast.Expr,
  fixup: FixupContext,
): void {
  this.s.word("&");
  switch (kind) {
    case "Ref":
      this.print_mutability(mutability, false);
      break;
    case "Raw": {
      this.s.word_nbsp("raw");
      this.print_mutability(mutability, true);
      break;
    }
    case "Pin": {
      this.s.word_nbsp("pin");
      this.print_mutability(mutability, true);
      break;
    }
  }
  this.print_expr_cond_paren(expr, lt(fixup.precedence(expr), "Prefix"), fixup.rightmost_subexpression());
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:381 print_expr
State.prototype.print_expr = function (this: State, expr: ast.Expr, fixup: FixupContext): void {
  this.print_expr_outer_attr_style(expr, true, fixup);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:385 print_expr_outer_attr_style
State.prototype.print_expr_outer_attr_style = function (
  this: State,
  expr: ast.Expr,
  is_inline: boolean,
  fixup: FixupContext,
): void {
  this.maybe_print_comment(Span.lo(expr.span));

  const attrs = expr.attrs;
  if (is_inline) {
    this.print_outer_attributes_inline(attrs);
  } else {
    this.print_outer_attributes(attrs);
  }

  const ib = this.s.ibox(INDENT_UNIT);

  const needs_par =
    // The Match subexpression in `match x {} - 1` must be parenthesized
    // if it is the leftmost subexpression in a statement:
    //
    //     (match x {}) - 1;
    //
    // But not otherwise:
    //
    //     let _ = match x {} - 1;
    //
    // Same applies to a small set of other expression kinds which
    // eagerly terminate a statement which opens with them.
    fixup.would_cause_statement_boundary(expr) ||
    // If a binary operation ends up with an attribute, such as
    // resulting from the following macro expansion, then parentheses
    // are required so that the attribute encompasses the right
    // subexpression and not just the left one.
    //
    //     #![feature(stmt_expr_attributes)]
    //
    //     macro_rules! add_attr {
    //         ($e:expr) => { #[attr] $e };
    //     }
    //
    //     let _ = add_attr!(1 + 1);
    //
    // We must pretty-print `#[attr] (1 + 1)` not `#[attr] 1 + 1`.
    (attrs.length !== 0 &&
      (expr.kind.$ === "Binary" ||
        expr.kind.$ === "Cast" ||
        expr.kind.$ === "Assign" ||
        expr.kind.$ === "AssignOp" ||
        expr.kind.$ === "Range"));
  if (needs_par) {
    this.s.popen();
    fixup = FixupContext.default();
  }

  this.ann.pre(this, { $: "Expr", _0: expr });

  const kind = expr.kind;
  switch (kind.$) {
    case "Array": {
      const exprs = kind._0;
      this.print_expr_vec(exprs);
      break;
    }
    case "ConstBlock": {
      const anon_const = kind._0;
      this.print_expr_anon_const(anon_const, attrs);
      break;
    }
    case "Repeat": {
      const [element, count] = [kind._0, kind._1];
      this.print_expr_repeat(element, count);
      break;
    }
    case "Struct": {
      const se = kind._0;
      this.print_expr_struct(se.qself, se.path, se.fields, se.rest);
      break;
    }
    case "Tup": {
      const exprs = kind._0;
      this.print_expr_tup(exprs);
      break;
    }
    case "Call": {
      const [func, args] = [kind._0, kind._1];
      this.print_expr_call(func, args, fixup);
      break;
    }
    case "MethodCall": {
      const { seg, receiver, args } = kind._0;
      this.print_expr_method_call(seg, receiver, args, fixup);
      break;
    }
    case "Binary": {
      const [op, lhs, rhs] = [kind._0, kind._1, kind._2];
      this.print_expr_binary(op.node, lhs, rhs, fixup);
      break;
    }
    case "Unary": {
      const [op, expr] = [kind._0, kind._1];
      this.print_expr_unary(op, expr, fixup);
      break;
    }
    case "AddrOf": {
      const [k, m, expr] = [kind._0, kind._1, kind._2];
      this.print_expr_addr_of(k, m, expr, fixup);
      break;
    }
    case "Lit": {
      const token_lit = kind._0;
      this.print_token_literal(token_lit, expr.span);
      break;
    }
    case "IncludedBytes": {
      const byte_sym = kind._0;
      const lit = token.Lit.new(
        token.LitKind.ByteStr,
        escape_byte_str_symbol(ByteSymbol.as_byte_str(byte_sym)),
        undefined,
      );
      this.print_token_literal(lit, expr.span);
      break;
    }
    case "Cast": {
      const [expr, ty] = [kind._0, kind._1];
      this.print_expr_cond_paren(expr, lt(expr.precedence(), "Cast"), fixup.leftmost_subexpression());
      this.s.space();
      this.s.word_space("as");
      this.print_type(ty);
      break;
    }
    case "Type": {
      const [expr, ty] = [kind._0, kind._1];
      this.s.word("builtin # type_ascribe");
      this.s.popen();
      const ib = this.s.ibox(0);
      this.print_expr(expr, FixupContext.default());

      this.s.word(",");
      this.s.space_if_not_bol();
      this.print_type(ty);

      this.s.end(ib);
      this.s.pclose();
      break;
    }
    case "Let": {
      const [pat, scrutinee] = [kind._0, kind._1];
      this.print_let(pat, scrutinee, fixup);
      break;
    }
    case "If": {
      const [test, blk, elseopt] = [kind._0, kind._1, kind._2];
      this.print_if(test, blk, elseopt);
      break;
    }
    case "While": {
      const [test, blk, opt_label] = [kind._0, kind._1, kind._2];
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word_nbsp("while");
      this.print_expr_as_cond(test);
      this.s.space();
      this.print_block_with_attrs(blk, attrs, cb, ib);
      break;
    }
    case "ForLoop": {
      const { pat, iter, body, label, kind: for_kind } = kind._0;
      if (label !== undefined) {
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word_nbsp("for");
      if (for_kind === "ForAwait") {
        this.s.word_nbsp("await");
      }
      this.print_pat(pat);
      this.s.space();
      this.s.word_space("in");
      this.print_expr_as_cond(iter);
      this.s.space();
      this.print_block_with_attrs(body, attrs, cb, ib);
      break;
    }
    case "Loop": {
      const [blk, opt_label] = [kind._0, kind._1];
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      this.s.word_nbsp("loop");
      this.print_block_with_attrs(blk, attrs, cb, ib);
      break;
    }
    case "Match": {
      const [expr, arms, match_kind] = [kind._0, kind._1, kind._2];
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);

      switch (match_kind) {
        case "Prefix": {
          this.s.word_nbsp("match");
          this.print_expr_as_cond(expr);
          this.s.space();
          break;
        }
        case "Postfix": {
          this.print_expr_cond_paren(
            expr,
            lt(expr.precedence(), "Unambiguous"),
            fixup.leftmost_subexpression_with_dot(),
          );
          this.s.word_nbsp(".match");
          break;
        }
      }

      this.bopen(ib);
      this.print_inner_attributes_no_trailing_hardbreak(attrs);
      for (const arm of arms) {
        this.print_arm(arm);
      }
      const empty = attrs.length === 0 && arms.length === 0;
      this.bclose(expr.span, empty, cb);
      break;
    }
    case "Closure": {
      const {
        binder,
        capture_clause,
        constness,
        coroutine_marker,
        movability,
        fn_decl,
        body,
        fn_decl_span: _fn_decl_span,
        fn_arg_span: _fn_arg_span,
      } = kind._0;
      this.print_closure_binder(binder);
      this.print_constness(constness);
      this.print_movability(movability);
      if (coroutine_marker !== undefined) {
        this.print_coroutine_marker(coroutine_marker);
      }
      this.print_capture_clause(capture_clause);

      this.print_fn_params_and_ret(fn_decl, true);
      this.s.space();
      this.print_expr(body, FixupContext.default());
      break;
    }
    case "Block": {
      const [blk, opt_label] = [kind._0, kind._1];
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      // containing cbox, will be closed by print-block at }
      const cb = this.s.cbox(0);
      // head-box, will be closed by print-block after {
      const ib = this.s.ibox(0);
      this.print_block_with_attrs(blk, attrs, cb, ib);
      break;
    }
    case "Gen": {
      const [capture_clause, blk, gen_kind] = [kind._0, kind._1, kind._2];
      this.s.word_nbsp(ast.CoroutineKind.as_str(gen_kind));
      this.print_capture_clause(capture_clause);
      // cbox/ibox in analogy to the `ExprKind::Block` arm above
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.print_block_with_attrs(blk, attrs, cb, ib);
      break;
    }
    case "Await": {
      const expr = kind._0;
      this.print_expr_cond_paren(
        expr,
        lt(expr.precedence(), "Unambiguous"),
        fixup.leftmost_subexpression_with_dot(),
      );
      this.s.word(".await");
      break;
    }
    case "Move": {
      const expr = kind._0;
      this.s.word("move(");
      this.print_expr(expr, FixupContext.default());
      this.s.word(")");
      break;
    }
    case "Use": {
      const expr = kind._0;
      this.print_expr_cond_paren(expr, lt(expr.precedence(), "Unambiguous"), fixup);
      this.s.word(".use");
      break;
    }
    case "Assign": {
      const [lhs, rhs] = [kind._0, kind._1];
      this.print_expr_cond_paren(
        lhs,
        // Ranges are allowed on the right-hand side of assignment,
        // but not the left. `(a..b) = c` needs parentheses.
        le(lhs.precedence(), "Range"),
        fixup.leftmost_subexpression(),
      );
      this.s.space();
      this.s.word_space("=");
      this.print_expr_cond_paren(rhs, lt(fixup.precedence(rhs), "Assign"), fixup.rightmost_subexpression());
      break;
    }
    case "AssignOp": {
      const [op, lhs, rhs] = [kind._0, kind._1, kind._2];
      this.print_expr_cond_paren(lhs, le(lhs.precedence(), "Range"), fixup.leftmost_subexpression());
      this.s.space();
      this.s.word_space(ast.AssignOpKind.as_str(op.node));
      this.print_expr_cond_paren(rhs, lt(fixup.precedence(rhs), "Assign"), fixup.rightmost_subexpression());
      break;
    }
    case "Field": {
      const [expr, ident] = [kind._0, kind._1];
      const needs_paren = lt(expr.precedence(), "Unambiguous");
      this.print_expr_cond_paren(expr, needs_paren, fixup.leftmost_subexpression_with_dot());
      if (!needs_paren && expr_ends_with_dot(expr)) {
        this.s.word(" ");
      }
      this.s.word(".");
      this.print_ident(ident);
      break;
    }
    case "Index": {
      const [expr, index] = [kind._0, kind._1];
      const expr_fixup = fixup.leftmost_subexpression_with_operator(true);
      this.print_expr_cond_paren(
        expr,
        lt(expr_fixup.precedence(expr), "Unambiguous") || classify.expr_is_complete(expr),
        expr_fixup,
      );
      this.s.word("[");
      this.print_expr(index, FixupContext.default());
      this.s.word("]");
      break;
    }
    case "Range": {
      const [start, end, limits] = [kind._0, kind._1, kind._2];
      // Special case for `Range`. `AssocOp` claims that `Range` has higher precedence
      // than `Assign`, but `x .. x = x` gives a parse error instead of `x .. (x = x)`.
      // Here we use a fake precedence value so that any child with lower precedence than
      // a "normal" binop gets parenthesized. (`LOr` is the lowest-precedence binop.)
      const fake_prec: ExprPrecedence = "LOr";
      if (start !== undefined) {
        const e = start;
        const start_fixup = fixup.leftmost_subexpression_with_operator(true);
        const needs_paren = lt(start_fixup.precedence(e), fake_prec);
        this.print_expr_cond_paren(e, needs_paren, start_fixup);
        // If the start expression is a float literal ending with
        // `.`, we need a space before `..` or `..=` so that the
        // dots don't merge. E.g. `0. ..45.` must not become
        // `0...45.`.
        if (!needs_paren && expr_ends_with_dot(e)) {
          this.s.word(" ");
        }
      }
      switch (limits) {
        case "HalfOpen":
          this.s.word("..");
          break;
        case "Closed":
          this.s.word("..=");
          break;
      }
      if (end !== undefined) {
        const e = end;
        this.print_expr_cond_paren(e, lt(fixup.precedence(e), fake_prec), fixup.rightmost_subexpression());
      }
      break;
    }
    case "Underscore":
      this.s.word("_");
      break;
    case "Path": {
      if (kind._0 === undefined) {
        const path = kind._1;
        this.print_path(path, true, 0);
      } else {
        const [qself, path] = [kind._0, kind._1];
        this.print_qpath(path, qself, true);
      }
      break;
    }
    case "Break": {
      const [opt_label, opt_expr] = [kind._0, kind._1];
      this.s.word("break");
      if (opt_label !== undefined) {
        const label = opt_label;
        this.s.space();
        this.print_ident(label.ident);
      }
      if (opt_expr !== undefined) {
        const expr = opt_expr;
        this.s.space();
        this.print_expr_cond_paren(
          expr,
          // Parenthesize `break 'inner: loop { break 'inner 1 } + 1`
          //                     ^---------------------------------^
          opt_label === undefined && classify.leading_labeled_expr(expr),
          fixup.rightmost_subexpression(),
        );
      }
      break;
    }
    case "Continue": {
      const opt_label = kind._0;
      this.s.word("continue");
      if (opt_label !== undefined) {
        const label = opt_label;
        this.s.space();
        this.print_ident(label.ident);
      }
      break;
    }
    case "Ret": {
      const result = kind._0;
      this.s.word("return");
      if (result !== undefined) {
        const expr = result;
        this.s.word(" ");
        this.print_expr(expr, fixup.rightmost_subexpression());
      }
      break;
    }
    case "Yeet": {
      const result = kind._0;
      this.s.word("do");
      this.s.word(" ");
      this.s.word("yeet");
      if (result !== undefined) {
        const expr = result;
        this.s.word(" ");
        this.print_expr(expr, fixup.rightmost_subexpression());
      }
      break;
    }
    case "Become": {
      const result = kind._0;
      this.s.word("become");
      this.s.word(" ");
      this.print_expr(result, fixup.rightmost_subexpression());
      break;
    }
    case "InlineAsm": {
      const a = kind._0;
      // FIXME: Print `builtin # asm` once macro `asm` uses `builtin_syntax`.
      this.s.word(`${ast.AsmMacro.macro_name(a.asm_macro)}!`);
      this.print_inline_asm(a);
      break;
    }
    case "FormatArgs": {
      const fmt = kind._0;
      // FIXME: Print `builtin # format_args` once macro `format_args` uses `builtin_syntax`.
      this.s.word("format_args!");
      this.s.popen();
      const ib = this.s.ibox(0);
      this.s.word(reconstruct_format_args_template_string(fmt.template));
      for (const arg of fmt.arguments.all_args()) {
        this.s.word_space(",");
        this.print_expr(arg.expr, FixupContext.default());
      }
      this.s.end(ib);
      this.s.pclose();
      break;
    }
    case "OffsetOf": {
      const [container, fields] = [kind._0, kind._1];
      this.s.word("builtin # offset_of");
      this.s.popen();
      const ib = this.s.ibox(0);
      this.print_type(container);
      this.s.word(",");
      this.s.space();

      if (fields.length !== 0) {
        const [first, ...rest] = fields;
        this.print_ident(first!);

        for (const field of rest) {
          this.s.word(".");
          this.print_ident(field);
        }
      }
      this.s.end(ib);
      this.s.pclose();
      break;
    }
    case "MacCall": {
      const m = kind._0;
      this.print_mac(m);
      break;
    }
    case "Paren": {
      const e = kind._0;
      this.s.popen();
      this.print_expr(e, FixupContext.default());
      this.s.pclose();
      break;
    }
    case "Yield": {
      const yk = kind._0;
      switch (yk.$) {
        case "Prefix": {
          const e = yk._0;
          this.s.word("yield");

          if (e !== undefined) {
            const expr = e;
            this.s.space();
            this.print_expr(expr, fixup.rightmost_subexpression());
          }
          break;
        }
        case "Postfix": {
          const e = yk._0;
          this.print_expr_cond_paren(
            e,
            lt(e.precedence(), "Unambiguous"),
            fixup.leftmost_subexpression_with_dot(),
          );
          this.s.word(".yield");
          break;
        }
      }
      break;
    }
    case "Try": {
      const e = kind._0;
      this.print_expr_cond_paren(e, lt(e.precedence(), "Unambiguous"), fixup.leftmost_subexpression_with_dot());
      this.s.word("?");
      break;
    }
    case "TryBlock": {
      const [blk, opt_ty] = [kind._0, kind._1];
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word_nbsp("try");
      if (opt_ty !== undefined) {
        const ty = opt_ty;
        this.s.word_nbsp("bikeshed");
        this.print_type(ty);
        this.s.space();
      }
      this.print_block_with_attrs(blk, attrs, cb, ib);
      break;
    }
    case "UnsafeBinderCast": {
      const [binder_kind, expr, ty] = [kind._0, kind._1, kind._2];
      this.s.word("builtin # ");
      switch (binder_kind) {
        case "Wrap":
          this.s.word("wrap_binder");
          break;
        case "Unwrap":
          this.s.word("unwrap_binder");
          break;
      }
      this.s.popen();
      const ib = this.s.ibox(0);
      this.print_expr(expr, FixupContext.default());

      if (ty !== undefined) {
        this.s.word(",");
        this.s.space();
        this.print_type(ty);
      }

      this.s.end(ib);
      this.s.pclose();
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
    case "Dummy": {
      this.s.popen();
      this.s.word("/*DUMMY*/");
      this.s.pclose();
      break;
    }
    case "GcaMacro": {
      const expr = kind._0;
      this.s.word_nbsp("core::gca!");
      this.s.popen();
      this.print_expr(expr, FixupContext.default());
      this.s.pclose();
      break;
    }
  }

  this.ann.post(this, { $: "Expr", _0: expr });

  if (needs_par) {
    this.s.pclose();
  }

  this.s.end(ib);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:903 print_arm
State.prototype.print_arm = function (this: State, arm: ast.Arm): void {
  // Note, I have no idea why this check is necessary, but here it is.
  if (arm.attrs.length === 0) {
    this.s.space();
  }
  const cb = this.s.cbox(INDENT_UNIT);
  const ib = this.s.ibox(0);
  this.maybe_print_comment(Span.lo(arm.pat.span));
  this.print_outer_attributes(arm.attrs);
  this.print_pat(arm.pat);
  this.s.space();
  if (arm.guard !== undefined) {
    const guard = arm.guard;
    this.s.word_space("if");
    this.print_expr(guard.cond, FixupContext.default());
    this.s.space();
  }

  if (arm.body !== undefined) {
    const body = arm.body;
    this.s.word_space("=>");

    const bk = body.kind;
    if (bk.$ === "Block") {
      const [blk, opt_label] = [bk._0, bk._1];
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }

      this.print_block_unclosed_indent(blk, ib);

      // If it is a user-provided unsafe block, print a comma after it.
      if (blk.rules.$ === "Unsafe" && blk.rules._0 === "UserProvided") {
        this.s.word(",");
      }
    } else {
      this.s.end(ib);
      this.print_expr(body, FixupContext.new_match_arm());
      this.s.word(",");
    }
  } else {
    this.s.end(ib);
    this.s.word(",");
  }
  this.s.end(cb);
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:950 print_closure_binder
State.prototype.print_closure_binder = function (this: State, binder: ast.ClosureBinder): void {
  switch (binder.$) {
    case "NotPresent":
      break;
    case "For": {
      const generic_params = binder.generic_params;
      this.print_formal_generic_params(generic_params);
      break;
    }
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:959 print_movability
State.prototype.print_movability = function (this: State, movability: ast.Movability): void {
  switch (movability) {
    case "Static":
      this.s.word_space("static");
      break;
    case "Movable":
      break;
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:966 print_capture_clause
State.prototype.print_capture_clause = function (this: State, capture_clause: ast.CaptureBy): void {
  switch (capture_clause.$) {
    case "Value":
      this.s.word_space("move");
      break;
    case "Use":
      this.s.word_space("use");
      break;
    case "Ref":
      break;
  }
};

// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:975 reconstruct_format_args_template_string
function reconstruct_format_args_template_string(pieces: readonly ast.FormatArgsPiece[]): string {
  let template = '"';
  for (const piece of pieces) {
    switch (piece.$) {
      case "Literal": {
        const s = piece._0;
        for (const c_ of Symbol.as_str(s)) {
          const c = c_.codePointAt(0)!;
          // PORT: `c.escape_debug()` = `escape_debug_ext(ESCAPE_ALL)` = src/std/fmt.ts `escape_char(c, true, true)`.
          template += escape_char(c, true, true);
          if (c === 0x7b /* '{' */ || c === 0x7d /* '}' */) {
            template += c_;
          }
        }
        break;
      }
      case "Placeholder": {
        const p = piece._0;
        template += "{";
        // let (Ok(n) | Err(n)) = p.argument.index;
        // PORT: an or-pattern binding the payload of either `Result` variant -> `._0` (both carry `usize`).
        const n = p.argument.index._0;
        template += String(n);
        if (!format_options_is_default(p.format_options) || p.format_trait !== "Display") {
          template += ":";
        }
        if (p.format_options.fill !== undefined) {
          const fill = p.format_options.fill;
          template += String.fromCodePoint(fill);
        }
        switch (p.format_options.alignment) {
          case "Left":
            template += "<";
            break;
          case "Right":
            template += ">";
            break;
          case "Center":
            template += "^";
            break;
          case undefined:
            break;
        }
        switch (p.format_options.sign) {
          case "Plus":
            template += "+";
            break;
          case "Minus":
            template += "-";
            break;
          case undefined:
            break;
        }
        if (p.format_options.alternate) {
          template += "#";
        }
        if (p.format_options.zero_pad) {
          template += "0";
        }
        if (p.format_options.width !== undefined) {
          const width = p.format_options.width;
          switch (width.$) {
            case "Literal": {
              const n = width._0;
              template += String(n);
              break;
            }
            case "Argument": {
              // PORT: `FormatCount::Argument(FormatArgPosition { index: Ok(n) | Err(n), .. })` -> `.index._0`.
              const n = width._0.index._0;
              template += `${n}$`;
              break;
            }
          }
        }
        if (p.format_options.precision !== undefined) {
          const precision = p.format_options.precision;
          template += ".";
          switch (precision.$) {
            case "Literal": {
              const n = precision._0;
              template += String(n);
              break;
            }
            case "Argument": {
              // PORT: `FormatCount::Argument(FormatArgPosition { index: Ok(n) | Err(n), .. })` -> `.index._0`.
              const n = precision._0.index._0;
              template += `${n}$`;
              break;
            }
          }
        }
        switch (p.format_options.debug_hex) {
          case "Lower":
            template += "x";
            break;
          case "Upper":
            template += "X";
            break;
          case undefined:
            break;
        }
        switch (p.format_trait) {
          case "Display":
            template += "";
            break;
          case "Debug":
            template += "?";
            break;
          case "LowerExp":
            template += "e";
            break;
          case "UpperExp":
            template += "E";
            break;
          case "Octal":
            template += "o";
            break;
          case "Pointer":
            template += "p";
            break;
          case "Binary":
            template += "b";
            break;
          case "LowerHex":
            template += "x";
            break;
          case "UpperHex":
            template += "X";
            break;
        }
        template += "}";
        break;
      }
    }
  }
  template += '"';
  return template;
}

/// Returns `true` if the printed representation of this expression ends with
/// a `.` character — specifically, an unsuffixed float literal like `0.` or
/// `45.`. This is used to insert whitespace before range operators (`..`,
/// `..=`) so that the dots don't merge (e.g. `0. ..45.` instead of `0...45.`).
// rustc: compiler/rustc_ast_pretty/src/pprust/state/expr.rs:1064 expr_ends_with_dot
function expr_ends_with_dot(expr: ast.Expr): boolean {
  const kind = expr.kind;
  switch (kind.$) {
    case "Lit": {
      const token_lit = kind._0;
      return (
        token_lit.kind.$ === "Float" && token_lit.suffix === undefined && Symbol.as_str(token_lit.symbol).endsWith(".")
      );
    }
    default:
      return false;
  }
}

// ---- local helpers (not upstream fns) ----

// PORT: `p.format_options != Default::default()`: `FormatOptions` derives `Default` (every field
// `None`/`false`) and `PartialEq`, so it equals the default iff every field is `None`/`false`.
function format_options_is_default(o: ast.FormatOptions): boolean {
  return (
    o.width === undefined &&
    o.precision === undefined &&
    o.alignment === undefined &&
    o.fill === undefined &&
    o.sign === undefined &&
    !o.alternate &&
    !o.zero_pad &&
    o.debug_hex === undefined
  );
}
