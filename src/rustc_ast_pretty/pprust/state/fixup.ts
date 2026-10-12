// Port of compiler/rustc_ast_pretty/src/pprust/state/fixup.rs
import "../../../rustc_ast/lib.ts";
import type { Expr } from "../../../rustc_ast/ast.ts";
import { expr_is_complete, expr_requires_semi_to_be_stmt } from "../../../rustc_ast/util/classify.ts";
import { ExprPrecedence, contains_exterior_struct_lit, needs_par_as_let_scrutinee } from "../../../rustc_ast/util/parser.ts";
import { type Debug, debug_bool, debug_struct } from "../../../std/fmt.ts";

// The default amount of fixing is minimal fixing, so all fixups are set to `false` by `Default`.
// Fixups should be turned on in a targeted fashion where needed.
// PORT: `#[derive(Copy, Clone)]` struct -> immutable-by-convention class; every transform builds a
// new value (`FixupContext { .., ..self }`), so sharing instances is safe.
export class FixupContext {
  constructor(
    /// Print expression such that it can be parsed back as a statement
    /// consisting of the original expression.
    ///
    /// The effect of this is for binary operators in statement position to set
    /// `leftmost_subexpression_in_stmt` when printing their left-hand operand.
    ///
    /// ```ignore (illustrative)
    /// (match x {}) - 1;  // match needs parens when LHS of binary operator
    ///
    /// match x {};  // not when its own statement
    /// ```
    readonly stmt: boolean,

    /// This is the difference between:
    ///
    /// ```ignore (illustrative)
    /// (match x {}) - 1;  // subexpression needs parens
    ///
    /// let _ = match x {} - 1;  // no parens
    /// ```
    ///
    /// There are 3 distinguishable contexts in which `print_expr` might be
    /// called with the expression `$match` as its argument, where `$match`
    /// represents an expression of kind `ExprKind::Match`:
    ///
    ///   - stmt=false leftmost_subexpression_in_stmt=false
    ///
    ///     Example: `let _ = $match - 1;`
    ///
    ///     No parentheses required.
    ///
    ///   - stmt=false leftmost_subexpression_in_stmt=true
    ///
    ///     Example: `$match - 1;`
    ///
    ///     Must parenthesize `($match)`, otherwise parsing back the output as a
    ///     statement would terminate the statement after the closing brace of
    ///     the match, parsing `-1;` as a separate statement.
    ///
    ///   - stmt=true leftmost_subexpression_in_stmt=false
    ///
    ///     Example: `$match;`
    ///
    ///     No parentheses required.
    readonly leftmost_subexpression_in_stmt: boolean,

    /// Print expression such that it can be parsed as a match arm.
    ///
    /// This is almost equivalent to `stmt`, but the grammar diverges a tiny bit
    /// between statements and match arms when it comes to braced macro calls.
    /// Macro calls with brace delimiter terminate a statement without a
    /// semicolon, but do not terminate a match-arm without comma.
    ///
    /// ```ignore (illustrative)
    /// m! {} - 1;  // two statements: a macro call followed by -1 literal
    ///
    /// match () {
    ///     _ => m! {} - 1,  // binary subtraction operator
    /// }
    /// ```
    readonly match_arm: boolean,

    /// This is almost equivalent to `leftmost_subexpression_in_stmt`, other
    /// than for braced macro calls.
    ///
    /// If we have `m! {} - 1` as an expression, the leftmost subexpression
    /// `m! {}` will need to be parenthesized in the statement case but not the
    /// match-arm case.
    ///
    /// ```ignore (illustrative)
    /// (m! {}) - 1;  // subexpression needs parens
    ///
    /// match () {
    ///     _ => m! {} - 1,  // no parens
    /// }
    /// ```
    readonly leftmost_subexpression_in_match_arm: boolean,

    /// This is the difference between:
    ///
    /// ```ignore (illustrative)
    /// if let _ = (Struct {}) {}  // needs parens
    ///
    /// match () {
    ///     () if let _ = Struct {} => {}  // no parens
    /// }
    /// ```
    readonly parenthesize_exterior_struct_lit: boolean,

    /// This is the difference between:
    ///
    /// ```ignore (illustrative)
    /// let _ = (return) - 1;  // without paren, this would return -1
    ///
    /// let _ = return + 1;  // no paren because '+' cannot begin expr
    /// ```
    readonly next_operator_can_begin_expr: boolean,

    /// This is the difference between:
    ///
    /// ```ignore (illustrative)
    /// let _ = 1 + return 1;  // no parens if rightmost subexpression
    ///
    /// let _ = 1 + (return 1) + 1;  // needs parens
    /// ```
    readonly next_operator_can_continue_expr: boolean,
  ) {}

  /** `#[derive(Default)]` */
  static default(): FixupContext {
    return new FixupContext(false, false, false, false, false, false, false);
  }

  /** `FixupContext { <overrides>, ..base }` (struct update syntax). */
  private static update(base: FixupContext, o: Partial<FixupContextFields>): FixupContext {
    return new FixupContext(
      o.stmt ?? base.stmt,
      o.leftmost_subexpression_in_stmt ?? base.leftmost_subexpression_in_stmt,
      o.match_arm ?? base.match_arm,
      o.leftmost_subexpression_in_match_arm ?? base.leftmost_subexpression_in_match_arm,
      o.parenthesize_exterior_struct_lit ?? base.parenthesize_exterior_struct_lit,
      o.next_operator_can_begin_expr ?? base.next_operator_can_begin_expr,
      o.next_operator_can_continue_expr ?? base.next_operator_can_continue_expr,
    );
  }

  /// Create the initial fixup for printing an expression in statement
  /// position.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:120 new_stmt
  static new_stmt(): FixupContext {
    return FixupContext.update(FixupContext.default(), { stmt: true });
  }

  /// Create the initial fixup for printing an expression as the right-hand
  /// side of a match arm.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:126 new_match_arm
  static new_match_arm(): FixupContext {
    return FixupContext.update(FixupContext.default(), { match_arm: true });
  }

  /// Create the initial fixup for printing an expression as the "condition"
  /// of an `if` or `while`. There are a few other positions which are
  /// grammatically equivalent and also use this, such as the iterator
  /// expression in `for` and the scrutinee in `match`.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:134 new_cond
  static new_cond(): FixupContext {
    return FixupContext.update(FixupContext.default(), { parenthesize_exterior_struct_lit: true });
  }

  /// Transform this fixup into the one that should apply when printing the
  /// leftmost subexpression of the current expression.
  ///
  /// The leftmost subexpression is any subexpression that has the same first
  /// token as the current expression, but has a different last token.
  ///
  /// For example in `$a + $b` and `$a.method()`, the subexpression `$a` is a
  /// leftmost subexpression.
  ///
  /// Not every expression has a leftmost subexpression. For example neither
  /// `-$a` nor `[$a]` have one.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:149 leftmost_subexpression
  leftmost_subexpression(): FixupContext {
    return FixupContext.update(this, {
      stmt: false,
      leftmost_subexpression_in_stmt: this.stmt || this.leftmost_subexpression_in_stmt,
      match_arm: false,
      leftmost_subexpression_in_match_arm: this.match_arm || this.leftmost_subexpression_in_match_arm,
      next_operator_can_begin_expr: false,
      next_operator_can_continue_expr: true,
    });
  }

  /// Transform this fixup into the one that should apply when printing a
  /// leftmost subexpression followed by a `.` or `?` token, which confer
  /// different statement boundary rules compared to other leftmost
  /// subexpressions.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:166 leftmost_subexpression_with_dot
  leftmost_subexpression_with_dot(): FixupContext {
    return FixupContext.update(this, {
      stmt: this.stmt || this.leftmost_subexpression_in_stmt,
      leftmost_subexpression_in_stmt: false,
      match_arm: this.match_arm || this.leftmost_subexpression_in_match_arm,
      leftmost_subexpression_in_match_arm: false,
      next_operator_can_begin_expr: false,
      next_operator_can_continue_expr: true,
    });
  }

  /// Transform this fixup into the one that should apply when printing a
  /// leftmost subexpression followed by punctuation that is legal as the
  /// first token of an expression.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:181 leftmost_subexpression_with_operator
  leftmost_subexpression_with_operator(next_operator_can_begin_expr: boolean): FixupContext {
    return FixupContext.update(this.leftmost_subexpression(), { next_operator_can_begin_expr });
  }

  /// Transform this fixup into the one that should apply when printing the
  /// rightmost subexpression of the current expression.
  ///
  /// The rightmost subexpression is any subexpression that has a different
  /// first token than the current expression, but has the same last token.
  ///
  /// For example in `$a + $b` and `-$b`, the subexpression `$b` is a
  /// rightmost subexpression.
  ///
  /// Not every expression has a rightmost subexpression. For example neither
  /// `[$b]` nor `$a.f($b)` have one.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:199 rightmost_subexpression
  rightmost_subexpression(): FixupContext {
    return FixupContext.update(this, {
      stmt: false,
      leftmost_subexpression_in_stmt: false,
      match_arm: false,
      leftmost_subexpression_in_match_arm: false,
    });
  }

  /// Determine whether parentheses are needed around the given expression to
  /// head off an unintended statement boundary.
  ///
  /// The documentation on `FixupContext::leftmost_subexpression_in_stmt` has
  /// examples.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:214 would_cause_statement_boundary
  would_cause_statement_boundary(expr: Expr): boolean {
    return (
      (this.leftmost_subexpression_in_stmt && !expr_requires_semi_to_be_stmt(expr)) ||
      (this.leftmost_subexpression_in_match_arm && expr_is_complete(expr))
    );
  }

  /// Determine whether parentheses are needed around the given `let`
  /// scrutinee.
  ///
  /// In `if let _ = $e {}`, some examples of `$e` that would need parentheses
  /// are:
  ///
  ///   - `Struct {}.f()`, because otherwise the `{` would be misinterpreted
  ///     as the opening of the if's then-block.
  ///
  ///   - `true && false`, because otherwise this would be misinterpreted as a
  ///     "let chain".
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:230 needs_par_as_let_scrutinee
  needs_par_as_let_scrutinee(expr: Expr): boolean {
    return (
      (this.parenthesize_exterior_struct_lit && contains_exterior_struct_lit(expr)) ||
      needs_par_as_let_scrutinee(this.precedence(expr))
    );
  }

  /// Determines the effective precedence of a subexpression. Some expressions
  /// have higher or lower precedence when adjacent to particular operators.
  // rustc: compiler/rustc_ast_pretty/src/pprust/state/fixup.rs:237 precedence
  precedence(expr: Expr): ExprPrecedence {
    if (this.next_operator_can_begin_expr) {
      // Decrease precedence of value-less jumps when followed by an
      // operator that would otherwise get interpreted as beginning a
      // value for the jump.
      const k = expr.kind;
      if (
        k.$ === "Break" ||
        k.$ === "Ret" ||
        k.$ === "Yeet" ||
        (k.$ === "Yield" && k._0.$ === "Prefix")
      ) {
        return ExprPrecedence.Jump;
      }
    }

    if (!this.next_operator_can_continue_expr) {
      // Increase precedence of expressions that extend to the end of
      // current statement or group.
      const k = expr.kind;
      if (
        k.$ === "Break" ||
        k.$ === "Closure" ||
        k.$ === "Ret" ||
        k.$ === "Yeet" ||
        (k.$ === "Yield" && k._0.$ === "Prefix") ||
        (k.$ === "Range" && k._0 === undefined)
      ) {
        return ExprPrecedence.Prefix;
      }
    }

    return expr.precedence();
  }
}

type FixupContextFields = {
  stmt: boolean;
  leftmost_subexpression_in_stmt: boolean;
  match_arm: boolean;
  leftmost_subexpression_in_match_arm: boolean;
  parenthesize_exterior_struct_lit: boolean;
  next_operator_can_begin_expr: boolean;
  next_operator_can_continue_expr: boolean;
};

/** `#[derive(Debug)]` */
export const debug_FixupContext: Debug<FixupContext> = (v, f) =>
  debug_struct(f, "FixupContext", [
    ["stmt", debug_bool(v.stmt, f)],
    ["leftmost_subexpression_in_stmt", debug_bool(v.leftmost_subexpression_in_stmt, f)],
    ["match_arm", debug_bool(v.match_arm, f)],
    ["leftmost_subexpression_in_match_arm", debug_bool(v.leftmost_subexpression_in_match_arm, f)],
    ["parenthesize_exterior_struct_lit", debug_bool(v.parenthesize_exterior_struct_lit, f)],
    ["next_operator_can_begin_expr", debug_bool(v.next_operator_can_begin_expr, f)],
    ["next_operator_can_continue_expr", debug_bool(v.next_operator_can_continue_expr, f)],
  ]);
