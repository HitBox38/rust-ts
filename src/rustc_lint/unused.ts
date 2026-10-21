// compiler/rustc_lint/src/unused.rs. The lint statics and `declare_lint_pass!` / `impl_lint_pass!` expansions are
// generated (unused.lints.gen.ts). The early passes (the `UnusedDelimLint` machinery, UnusedParens, UnusedBraces,
// UnusedImportBraces) and the late passes (PathStatements, UnusedAllocation) are ported.
import { type ast, HasAttrs, LocalKind, type NodeId } from "../rustc_ast/lib.ts";
import * as classify from "../rustc_ast/util/classify.ts";
import * as parser from "../rustc_ast/util/parser.ts";
import { MultiSpan } from "../rustc_errors/lib.ts";
import type { Lint, LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { is_alphanumeric } from "../std/char.ts";
import { assert, panic } from "../std/panic.ts";
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { EarlyContext, LateContext } from "./context.ts";
import {
  PathStatementDrop_diagnostic,
  type PathStatementDropSub,
  PathStatementNoEffect_diagnostic,
  UnusedAllocationDiag_diagnostic,
  UnusedAllocationMutDiag_diagnostic,
  UnusedDelim_diagnostic,
  type UnusedDelimSuggestion,
  UnusedImportBracesDiag_diagnostic,
} from "./diagnostics.gen.ts";
import type { EarlyLintPass, LateLintPass } from "./passes.ts";
import {
  PATH_STATEMENTS,
  PathStatements,
  UNUSED_ALLOCATION,
  UNUSED_BRACES,
  UNUSED_IMPORT_BRACES,
  UNUSED_PARENS,
  UnusedAllocation,
  UnusedBraces,
  UnusedImportBraces,
  UnusedParens_impl_lint_pass,
} from "./unused.lints.gen.ts";

export * from "./unused.lints.gen.ts";

declare module "./unused.lints.gen.ts" {
  interface PathStatements extends LateLintPass {}
  interface UnusedAllocation extends LateLintPass {}
}

// impl LateLintPass for PathStatements
// rustc: compiler/rustc_lint/src/unused.rs:43 check_stmt
PathStatements.prototype.check_stmt = function (this: PathStatements, cx: LateContext, s: hir.Stmt): void {
  if (s.kind.$ === "Semi" && s.kind._0.kind.$ === "Path") {
    const expr = s.kind._0;
    const ty = (cx.typeck_results_() as TypeckResults).expr_ty(expr);
    if (ty.needs_drop(cx.tcx, cx.typing_env() as TypingEnv)) {
      const snippet = cx.sess().source_map().span_to_snippet(expr.span);
      let sub: PathStatementDropSub;
      if (snippet.$ === "Ok") {
        sub = { $: "Suggestion", span: s.span, snippet: snippet._0.toString() };
      } else {
        sub = { $: "Help", span: s.span };
      }
      cx.emit_span_lint(PATH_STATEMENTS, s.span, PathStatementDrop_diagnostic({ sub }));
    } else {
      cx.emit_span_lint(PATH_STATEMENTS, s.span, PathStatementNoEffect_diagnostic({}));
    }
  }
};

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
type UnusedDelimsCtx =
  | "FunctionArg"
  | "MethodArg"
  | "AssignedValue"
  | "AssignedValueLetElse"
  | "IfCond"
  | "WhileCond"
  | "ForIterExpr"
  | "MatchScrutineeExpr"
  | "ReturnValue"
  | "BlockRetValue"
  | "BreakValue"
  | "LetScrutineeExpr"
  | "ArrayLenExpr"
  | "AnonConst"
  | "MatchArmExpr"
  | "IndexExpr"
  | "ClosureBody";

/** `impl From<UnusedDelimsCtx> for &'static str` */
// rustc: compiler/rustc_lint/src/unused.rs:84 from
function str_from_UnusedDelimsCtx(ctx: UnusedDelimsCtx): string {
  switch (ctx) {
    case "FunctionArg":
      return "function argument";
    case "MethodArg":
      return "method argument";
    case "AssignedValue":
    case "AssignedValueLetElse":
      return "assigned value";
    case "IfCond":
      return "`if` condition";
    case "WhileCond":
      return "`while` condition";
    case "ForIterExpr":
      return "`for` iterator expression";
    case "MatchScrutineeExpr":
      return "`match` scrutinee expression";
    case "ReturnValue":
      return "`return` value";
    case "BlockRetValue":
      return "block return value";
    case "BreakValue":
      return "`break` value";
    case "LetScrutineeExpr":
      return "`let` scrutinee expression";
    case "ArrayLenExpr":
    case "AnonConst":
      return "const expression";
    case "MatchArmExpr":
      return "match arm expression";
    case "IndexExpr":
      return "index expression";
    case "ClosureBody":
      return "closure body";
  }
}

/// Used by both `UnusedParens` and `UnusedBraces` to prevent code duplication.
// PORT: the trait's associated consts are read-only properties of the implementing pass; its provided methods
// live in `UnusedDelimLint_provided` (they take the implementor as `self`, `Self::f(..)` as `f(self, ..)`), since
// the passes' `EarlyLintPass` methods of the same names (`check_expr`, `check_stmt`, `check_item`) occupy the
// class slots and call these explicitly (`<Self as UnusedDelimLint>::check_expr(self, ..)`).
interface UnusedDelimLint {
  readonly DELIM_STR: string;

  /// Due to `ref` pattern, there can be a difference between using
  /// `{ expr }` and `expr` in pattern-matching contexts. This means
  /// that we should only lint `unused_parens` and not `unused_braces`
  /// in this case.
  ///
  /// ```rust
  /// let mut a = 7;
  /// let ref b = { a }; // We actually borrow a copy of `a` here.
  /// a += 1; // By mutating `a` we invalidate any borrows of `a`.
  /// assert_eq!(b + 1, a); // `b` does not borrow `a`, so we can still use it here.
  /// ```
  readonly LINT_EXPR_IN_PATTERN_MATCHING_CTX: boolean;

  // this cannot be a constant is it refers to a static.
  // rustc: compiler/rustc_lint/src/unused.rs:125 lint
  lint(): Lint;

  // rustc: compiler/rustc_lint/src/unused.rs:127 check_unused_delims_expr
  check_unused_delims_expr(
    cx: EarlyContext,
    value: ast.Expr,
    ctx: UnusedDelimsCtx,
    followed_by_block: boolean,
    left_pos: BytePos | undefined,
    right_pos: BytePos | undefined,
    is_kw: boolean,
  ): void;

  // (provided) expr_allows_remove_arg_block
  // (provided) needs_arg_block_to_preserve_temporaries
  // (provided) is_expr_delims_necessary
  // (provided) emit_unused_delims_expr
  // (provided) emit_unused_delims
  // (provided) check_expr
  // (provided) check_stmt
  // (provided) check_item
  // (provided) block_wraps_expanded_expr
}

/** The provided methods of `UnusedDelimLint`. */
const UnusedDelimLint_provided = {
  /// Returns whether the outer braces of a single-expression function/method
  /// argument block can be removed.
  ///
  /// In Rust 2024, `{ expr }` can drop tail-expression temporaries before the
  /// call starts. Removing the block may extend those temporaries, so lint only
  /// expression forms that are harmless here.
  // rustc: compiler/rustc_lint/src/unused.rs:144 expr_allows_remove_arg_block
  expr_allows_remove_arg_block(expr: ast.Expr): boolean {
    // use ast::ExprKind::*;
    const f = UnusedDelimLint_provided.expr_allows_remove_arg_block;

    const kind = expr.peel_parens().kind;
    switch (kind.$) {
      case "Lit":
      case "IncludedBytes":
      case "Path":
        return true;
      case "Unary":
        return f(kind._1);
      case "Cast":
      case "Type":
      case "Use":
      case "Await":
      case "Try":
      case "Move":
        return f(kind._0);
      case "AddrOf":
        return f(kind._2);
      case "UnsafeBinderCast":
        return f(kind._1);
      case "Array":
      case "Tup":
        return kind._0.every((expr) => f(expr));
      case "Binary":
        return f(kind._1) && f(kind._2);
      case "Assign":
        return f(kind._0) && f(kind._1);
      case "AssignOp":
        return f(kind._1) && f(kind._2);
      case "Index": {
        const base = kind._0;
        const index = kind._1;
        return f(base) && f(index);
      }
      case "Range": {
        const start = kind._0;
        const end = kind._1;
        return (start === undefined || f(start)) && (end === undefined || f(end));
      }
      case "Struct": {
        const expr = kind._0;
        if (!expr.fields.every((field) => f(field.expr))) return false;
        switch (expr.rest.$) {
          case "Base":
            return f(expr.rest._0);
          case "Rest":
          case "None":
            return true;
          case "NoneWithError":
            return false;
        }
        break;
      }
      case "Repeat":
        return f(kind._0);
      case "ConstBlock":
      case "If":
      case "While":
      case "ForLoop":
      case "Loop":
      case "Match":
      case "Closure":
      case "Block":
      case "Gen":
      case "TryBlock":
      case "Break":
      case "Continue":
      case "Ret":
      case "InlineAsm":
      case "OffsetOf":
      case "Yield":
      case "Yeet":
      case "Paren":
      case "Become":
        return true;
      case "Call":
      case "MethodCall":
      case "Let":
      case "Field":
      case "MacCall":
      case "FormatArgs":
        return false;
      // `gca!()` is invalid in function/method argument position.
      case "GcaMacro":
        return false;
      // don't lint for placeholder/error-recovery
      case "Underscore":
      case "Err":
      case "Dummy":
        return false;
    }
  },

  /// Returns whether `{ expr }` must be kept in function/method argument
  /// position to avoid changing temporary lifetime semantics.
  // rustc: compiler/rustc_lint/src/unused.rs:210 needs_arg_block_to_preserve_temporaries
  needs_arg_block_to_preserve_temporaries(ctx: UnusedDelimsCtx, arg_block: ast.Expr, expr: ast.Expr): boolean {
    return (
      (ctx === "FunctionArg" || ctx === "MethodArg") &&
      Span.at_least_rust_2024(arg_block.span) &&
      !UnusedDelimLint_provided.expr_allows_remove_arg_block(expr)
    );
  },

  // rustc: compiler/rustc_lint/src/unused.rs:220 is_expr_delims_necessary
  is_expr_delims_necessary(inner: ast.Expr, ctx: UnusedDelimsCtx, followed_by_block: boolean): boolean {
    const followed_by_else = ctx === "AssignedValueLetElse";

    if (followed_by_else) {
      if (inner.kind.$ === "Binary" && BinOpKind_is_lazy(inner.kind._0.node)) {
        return true;
      } else if (classify.expr_trailing_brace(inner) !== undefined) {
        return true;
      }
    }

    // Check it's range in LetScrutineeExpr
    if (inner.kind.$ === "Range" && ctx === "LetScrutineeExpr") {
      return true;
    }

    // Do not lint against parentheses around `&raw [const|mut] expr`.
    // These parentheses will have to be added e.g. when calling a method on the result of this
    // expression, and we want to avoid churn wrt adding and removing parentheses.
    if (inner.kind.$ === "AddrOf" && inner.kind._0 === "Raw") {
      return true;
    }

    // Check if LHS needs parens to prevent false-positives in cases like
    // `fn x() -> u8 { ({ 0 } + 1) }`.
    //
    // FIXME: https://github.com/rust-lang/rust/issues/119426
    // The syntax tree in this code is from after macro expansion, so the
    // current implementation has both false negatives and false positives
    // related to expressions containing macros.
    //
    //     macro_rules! m1 {
    //         () => {
    //             1
    //         };
    //     }
    //
    //     fn f1() -> u8 {
    //         // Lint says parens are not needed, but they are.
    //         (m1! {} + 1)
    //     }
    //
    //     macro_rules! m2 {
    //         () => {
    //             loop { break 1; }
    //         };
    //     }
    //
    //     fn f2() -> u8 {
    //         // Lint says parens are needed, but they are not.
    //         (m2!() + 1)
    //     }
    {
      let innermost = inner;
      for (;;) {
        const k = innermost.kind;
        if (k.$ === "Binary") innermost = k._1;
        else if (k.$ === "Call") innermost = k._0;
        else if (k.$ === "Cast") innermost = k._0;
        else if (k.$ === "Type") innermost = k._0;
        else if (k.$ === "Index") innermost = k._0;
        else break;
        if (!classify.expr_requires_semi_to_be_stmt(innermost)) {
          return true;
        }
      }
    }

    // Check if RHS needs parens to prevent false-positives in cases like `if (() == return)
    // {}`.
    if (!followed_by_block) {
      return false;
    }

    // Check if we need parens for `match &( Struct { field:  }) {}`.
    {
      let innermost = inner;
      for (;;) {
        if (innermost.kind.$ === "AddrOf") {
          innermost = innermost.kind._2;
        } else {
          if (parser.contains_exterior_struct_lit(innermost)) {
            return true;
          } else {
            break;
          }
        }
      }
    }

    let innermost = inner;
    for (;;) {
      const k = innermost.kind;
      switch (k.$) {
        case "Unary":
          innermost = k._1;
          break;
        case "Binary":
          innermost = k._2;
          break;
        case "AssignOp":
          innermost = k._2;
          break;
        case "Assign":
          innermost = k._1;
          break;

        case "Ret":
        case "Yield":
        case "Yeet":
          return true;

        case "Break":
          if (k._1 === undefined) return false;
          {
            const break_expr = k._1;
            // `if (break 'label i) { ... }` removing parens would make `i { ... }`
            // be parsed as a struct literal, so keep parentheses if the break value
            // ends with a path (which could be mistaken for a struct name).
            return break_expr.kind.$ === "Block" || break_expr.kind.$ === "Path";
          }

        case "Range":
          if (k._1 !== undefined) {
            const rhs = k._1;
            return rhs.kind.$ === "Block";
          }
          return parser.contains_exterior_struct_lit(inner);

        default:
          return parser.contains_exterior_struct_lit(inner);
      }
    }
  },

  // rustc: compiler/rustc_lint/src/unused.rs:345 emit_unused_delims_expr
  emit_unused_delims_expr(
    self: UnusedDelimLint,
    cx: EarlyContext,
    value: ast.Expr,
    ctx: UnusedDelimsCtx,
    left_pos: BytePos | undefined,
    right_pos: BytePos | undefined,
    is_kw: boolean,
  ): void {
    let span_with_attrs: Span;
    if (value.kind.$ === "Block" && value.kind._1 === undefined && value.kind._0.stmts.length === 1) {
      const stmt = value.kind._0.stmts[0]!;
      // For the statements with attributes, like `{ #[allow()] println!("Hello!") }`,
      // the span should contains the attributes, or the suggestion will remove them.
      const attr_lo = min_lo(HasAttrs.Stmt.attrs(stmt));
      if (attr_lo !== undefined) {
        span_with_attrs = Span.with_lo(stmt.span, attr_lo);
      } else {
        span_with_attrs = stmt.span;
      }
    } else if (value.kind.$ === "Paren") {
      const expr = value.kind._0;
      // For the expr with attributes, like `let _ = (#[inline] || println!("Hello!"));`,
      // the span should contains the attributes, or the suggestion will remove them.
      const attr_lo = min_lo(expr.attrs);
      if (attr_lo !== undefined) {
        span_with_attrs = Span.with_lo(expr.span, attr_lo);
      } else {
        span_with_attrs = expr.span;
      }
    } else {
      return;
    }
    const ancestor = Span.find_ancestor_inside(span_with_attrs, value.span);
    const spans: [Span, Span] | undefined =
      ancestor === undefined
        ? undefined
        : [Span.with_hi(value.span, Span.lo(ancestor)), Span.with_lo(value.span, Span.hi(ancestor))];
    const keep_space: [boolean, boolean] = [
      left_pos !== undefined && left_pos >= Span.lo(value.span),
      right_pos !== undefined && right_pos <= Span.hi(value.span),
    ];
    UnusedDelimLint_provided.emit_unused_delims(self, cx, value.span, spans, str_from_UnusedDelimsCtx(ctx), keep_space, is_kw);
  },

  // rustc: compiler/rustc_lint/src/unused.rs:385 emit_unused_delims
  emit_unused_delims(
    self: UnusedDelimLint,
    cx: EarlyContext,
    value_span: Span,
    spans: [Span, Span] | undefined,
    msg: string,
    keep_space: [boolean, boolean],
    is_kw: boolean,
  ): void {
    let primary_span: MultiSpan;
    if (spans !== undefined) {
      const [lo, hi] = spans;
      if (Span.is_empty(hi)) {
        // do not point at delims that do not exist
        return;
      }
      primary_span = MultiSpan.from_spans([lo, hi]);
    } else {
      primary_span = MultiSpan.from_span(value_span);
    }
    let suggestion: UnusedDelimSuggestion | undefined = undefined;
    if (spans !== undefined) {
      const [lo, hi] = spans;
      const sm = cx.sess().source_map();
      let lo_replace: string;
      let snip;
      if ((keep_space[0] || is_kw) && (snip = sm.span_to_prev_source(lo)).$ === "Ok" && !snip._0.toString().endsWith(" ")) {
        lo_replace = " ";
      } else if ((snip = sm.span_to_prev_source(value_span)).$ === "Ok" && ends_with_alphanumeric(snip._0.toString())) {
        lo_replace = " ";
      } else {
        lo_replace = "";
      }

      let hi_replace: string;
      if (keep_space[1] && (snip = sm.span_to_next_source(hi)).$ === "Ok" && !snip._0.toString().startsWith(" ")) {
        hi_replace = " ";
      } else if ((snip = sm.span_to_next_source(value_span)).$ === "Ok" && starts_with_alphanumeric(snip._0.toString())) {
        hi_replace = " ";
      } else {
        hi_replace = "";
      }
      suggestion = {
        start_span: lo,
        start_replace: lo_replace,
        end_span: hi,
        end_replace: hi_replace,
        delim: self.DELIM_STR,
      };
    }
    cx.emit_span_lint(self.lint(), primary_span, UnusedDelim_diagnostic({ delim: self.DELIM_STR, item: msg, suggestion }));
  },

  // rustc: compiler/rustc_lint/src/unused.rs:445 check_expr
  check_expr(self: UnusedDelimLint, cx: EarlyContext, e: ast.Expr): void {
    // use rustc_ast::ExprKind::*;
    let value: ast.Expr;
    let ctx: UnusedDelimsCtx;
    let followed_by_block: boolean;
    let left_pos: BytePos | undefined;
    let right_pos: BytePos | undefined;
    let is_kw: boolean;
    const kind = e.kind;
    // Do not lint `unused_braces` in `if let` expressions.
    if (kind.$ === "If" && (kind._0.kind.$ !== "Let" || self.LINT_EXPR_IN_PATTERN_MATCHING_CTX)) {
      const cond = kind._0;
      const block = kind._1;
      const left = BytePos.add(Span.lo(e.span), BytePos(2));
      const right = Span.lo(block.span);
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [cond, "IfCond", true, left, right, true];
    }

    // Do not lint `unused_braces` in `while let` expressions.
    else if (kind.$ === "While" && (kind._0.kind.$ !== "Let" || self.LINT_EXPR_IN_PATTERN_MATCHING_CTX)) {
      const cond = kind._0;
      const block = kind._1;
      const left = BytePos.add(Span.lo(e.span), BytePos(5));
      const right = Span.lo(block.span);
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [cond, "WhileCond", true, left, right, true];
    } else if (kind.$ === "ForLoop") {
      const { iter, body } = kind._0;
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [iter, "ForIterExpr", true, undefined, Span.lo(body.span), true];
    } else if (kind.$ === "Match" && kind._2 === "Prefix" && self.LINT_EXPR_IN_PATTERN_MATCHING_CTX) {
      const head = kind._0;
      const left = BytePos.add(Span.lo(e.span), BytePos(5));
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [head, "MatchScrutineeExpr", true, left, undefined, true];
    } else if (kind.$ === "Ret" && kind._0 !== undefined) {
      const value_ = kind._0;
      const left = BytePos.add(Span.lo(e.span), BytePos(3));
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [value_, "ReturnValue", false, left, undefined, true];
    } else if (kind.$ === "Break" && kind._1 !== undefined) {
      const label = kind._0;
      const value_ = kind._1;
      // Don't lint on `break 'label ({...})` - the parens are necessary
      // to disambiguate from `break 'label {...}` which would be a syntax error.
      // This avoids conflicts with the `break_with_label_and_loop` lint.
      if (label !== undefined && value_.kind.$ === "Paren" && value_.kind._0.kind.$ === "Block") {
        return;
      }
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [value_, "BreakValue", false, undefined, undefined, true];
    } else if (kind.$ === "Index") {
      const value_ = kind._1;
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [value_, "IndexExpr", false, undefined, undefined, false];
    } else if (kind.$ === "Assign" || kind.$ === "AssignOp") {
      const value_ = kind.$ === "Assign" ? kind._1 : kind._2;
      [value, ctx, followed_by_block, left_pos, right_pos, is_kw] = [value_, "AssignedValue", false, undefined, undefined, false];
    }
    // either function/method call, or something this lint doesn't care about
    else {
      const call_or_other = kind;
      let args_to_check: readonly ast.Expr[];
      let ctx: UnusedDelimsCtx;
      let callee_from_expansion: boolean;
      if (call_or_other.$ === "Call") {
        const callee = call_or_other._0;
        const args = call_or_other._1;
        [args_to_check, ctx, callee_from_expansion] = [args, "FunctionArg", Span.from_expansion(callee.span)];
      } else if (call_or_other.$ === "MethodCall") {
        const call = call_or_other._0;
        [args_to_check, ctx, callee_from_expansion] = [call.args, "MethodArg", Span.from_expansion(call.seg.ident.span)];
      } else if (call_or_other.$ === "Closure" && call_or_other._0.fn_decl.output.$ === "Default") {
        const closure = call_or_other._0;
        // PORT: `&[closure.body.clone()][..]`: the clone is only read, so the body itself is checked.
        [args_to_check, ctx, callee_from_expansion] = [[closure.body], "ClosureBody", false];
      }
      // actual catch-all arm
      else {
        return;
      }
      // Don't lint if this is a nested macro expansion: otherwise, the lint could
      // trigger in situations that macro authors shouldn't have to care about, e.g.,
      // when a parenthesized token tree matched in one macro expansion is matched as
      // an expression in another and used as a fn/method argument (Issue #47775)
      if (Span.from_expansion(SyntaxContext.outer_expn_data(Span.ctxt(e.span)).call_site)) {
        return;
      }
      for (const arg of args_to_check) {
        // Whether an expression is wrapped in a block can change which `macro_rules!`
        // arm is taken. Don't report the braces as unused in that case. (Issue #158747)
        if (callee_from_expansion && UnusedDelimLint_provided.block_wraps_expanded_expr(arg)) {
          continue;
        }
        self.check_unused_delims_expr(cx, arg, ctx, false, undefined, undefined, false);
      }
      return;
    }
    self.check_unused_delims_expr(cx, value, ctx, followed_by_block, left_pos, right_pos, is_kw);
  },

  // rustc: compiler/rustc_lint/src/unused.rs:550 check_stmt
  check_stmt(self: UnusedDelimLint, cx: EarlyContext, s: ast.Stmt): void {
    if (s.kind.$ === "Let" && self.LINT_EXPR_IN_PATTERN_MATCHING_CTX) {
      const local = s.kind._0;
      const ie = LocalKind.init_else_opt(local.kind);
      if (ie !== undefined) {
        const [init, els] = ie;
        if (els !== undefined && init.kind.$ === "Paren" && !Span.eq_ctxt(init.span, init.kind._0.span)) {
          // This branch prevents cases where parentheses wrap an expression
          // resulting from macro expansion, such as:
          // ```
          // macro_rules! x {
          // () => { None::<i32> };
          // }
          // let Some(_) = (x!{}) else { return };
          // // -> let Some(_) = (None::<i32>) else { return };
          // //                  ~           ~ No Lint
          // ```
          return;
        }
        const ctx: UnusedDelimsCtx = els === undefined ? "AssignedValue" : "AssignedValueLetElse";
        self.check_unused_delims_expr(cx, init, ctx, false, undefined, undefined, false);
      }
    } else if (s.kind.$ === "Expr") {
      const expr = s.kind._0;
      self.check_unused_delims_expr(cx, expr, "BlockRetValue", false, undefined, undefined, false);
    }
  },

  // rustc: compiler/rustc_lint/src/unused.rs:592 check_item
  check_item(self: UnusedDelimLint, cx: EarlyContext, item: ast.Item): void {
    // use ast::ItemKind::*;

    let expr: ast.Expr;
    if (item.kind.$ === "Const" && item.kind._0.body !== undefined) {
      expr = item.kind._0.body;
    } else if (item.kind.$ === "Static" && item.kind._0.expr !== undefined) {
      expr = item.kind._0.expr;
    } else {
      return;
    }
    self.check_unused_delims_expr(cx, expr, "AssignedValue", false, undefined, undefined, false);
  },

  // Returns true for a user-written block whose only expression came from a macro expansion.
  // rustc: compiler/rustc_lint/src/unused.rs:614 block_wraps_expanded_expr
  block_wraps_expanded_expr(value: ast.Expr): boolean {
    if (
      value.kind.$ === "Block" &&
      value.kind._1 === undefined &&
      value.kind._0.rules.$ === "Default" &&
      !Span.from_expansion(value.span) &&
      value.kind._0.stmts.length === 1 &&
      value.kind._0.stmts[0]!.kind.$ === "Expr"
    ) {
      const expr = value.kind._0.stmts[0]!.kind._0;
      return Span.from_expansion(expr.span);
    } else {
      return false;
    }
  },
};

/** `attrs.iter().map(|attr| attr.span.lo()).min()` */
function min_lo(attrs: readonly ast.Attribute[]): BytePos | undefined {
  let min: BytePos | undefined = undefined;
  for (const attr of attrs) {
    const lo = Span.lo(attr.span);
    if (min === undefined || lo < min) min = lo;
  }
  return min;
}

/** `snip.ends_with(|c: char| c.is_alphanumeric())` */
function ends_with_alphanumeric(s: string): boolean {
  let i = s.length - 1;
  // A trailing low surrogate belongs to the char starting one code unit earlier.
  if (i > 0 && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff) i--;
  const last = s.codePointAt(i);
  return last !== undefined && is_alphanumeric(last);
}

/** `snip.starts_with(|c: char| c.is_alphanumeric())` */
function starts_with_alphanumeric(s: string): boolean {
  const first = s.codePointAt(0);
  return first !== undefined && is_alphanumeric(first);
}

/** `BinOpKind::is_lazy` */
function BinOpKind_is_lazy(op: ast.BinOpKind): boolean {
  return op === "And" || op === "Or";
}

/// Whether parentheses may be omitted from a type without resulting in ambiguity.
///
/// ```
/// type Example = Box<dyn Fn() -> &'static (dyn Send) + Sync>;
/// ```
///
/// Here, `&'static (dyn Send) + Sync` is a `TypeNoBounds`. As such, it may not directly
/// contain `ImplTraitType` or `TraitObjectType` which is why `(dyn Send)` is parenthesized.
/// However, an exception is made for `ImplTraitTypeOneBound` and `TraitObjectTypeOneBound`.
/// The following is accepted because there is no `+`.
///
/// ```
/// type Example = Box<dyn Fn() -> &'static dyn Send>;
/// ```
type NoBoundsException =
  /// The type must be parenthesized.
  | "None"
  /// The type is the last bound of the containing type expression. If it has exactly one bound,
  /// parentheses around the type are unnecessary.
  | "OneBound";

/** `UnusedParens` (unused.rs:650; its `impl_lint_pass!` expansion is `UnusedParens_impl_lint_pass`). */
// #[derive(Default)]
export class UnusedParens implements LintPass, UnusedDelimLint {
  constructor(
    public with_self_ty_parens: boolean,
    /// `1 as (i32) < 2` parses to ExprKind::Lt
    /// `1 as i32 < 2` parses to i32::<2[missing angle bracket]
    public parens_in_cast_in_lt: NodeId[],
    /// Ty nodes in this map are in TypeNoBounds position. Any bounds they
    /// contain may be ambiguous w/r/t trailing `+` operators.
    public in_no_bounds_pos: Map<NodeId, NoBoundsException>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): UnusedParens {
    return new UnusedParens(false, [], new Map());
  }

  name(): string {
    return UnusedParens_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return UnusedParens_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return UnusedParens_impl_lint_pass.lint_vec();
  }

  // impl UnusedDelimLint for UnusedParens
  get DELIM_STR(): string {
    return "parentheses";
  }

  get LINT_EXPR_IN_PATTERN_MATCHING_CTX(): boolean {
    return true;
  }

  // rustc: compiler/rustc_lint/src/unused.rs:689 lint
  lint(): Lint {
    return UNUSED_PARENS;
  }

  // rustc: compiler/rustc_lint/src/unused.rs:693 check_unused_delims_expr
  check_unused_delims_expr(
    cx: EarlyContext,
    value: ast.Expr,
    ctx: UnusedDelimsCtx,
    followed_by_block: boolean,
    left_pos: BytePos | undefined,
    right_pos: BytePos | undefined,
    is_kw: boolean,
  ): void {
    if (value.kind.$ === "Paren") {
      const inner = value.kind._0;
      if (
        !UnusedDelimLint_provided.is_expr_delims_necessary(inner, ctx, followed_by_block) &&
        value.attrs.length === 0 &&
        !Span.from_expansion(value.span) &&
        (ctx !== "LetScrutineeExpr" || !(inner.kind.$ === "Binary" && BinOpKind_is_lazy(inner.kind._0.node))) &&
        !((ctx === "ReturnValue" || ctx === "BreakValue") && inner.kind.$ === "Assign")
      ) {
        UnusedDelimLint_provided.emit_unused_delims_expr(this, cx, value, ctx, left_pos, right_pos, is_kw);
      }
    } else if (value.kind.$ === "Let") {
      const expr = value.kind._1;
      this.check_unused_delims_expr(cx, expr, "LetScrutineeExpr", followed_by_block, undefined, undefined, false);
    }
  }

  // impl UnusedParens
  // rustc: compiler/rustc_lint/src/unused.rs:738 check_unused_parens_pat
  check_unused_parens_pat(cx: EarlyContext, value: ast.Pat, avoid_or: boolean, avoid_mut: boolean, keep_space: [boolean, boolean]): void {
    // use ast::{BindingMode, ByRef, Mutability, PatKind, Pinnedness};

    if (value.kind.$ === "Paren") {
      const inner = value.kind._0;
      const k = inner.kind;
      // The lint visitor will visit each subpattern of `p`. We do not want to lint
      // any range pattern no matter where it occurs in the pattern. For something like
      // `&(a..=b)`, there is a recursive `check_pat` on `a` and `b`, but we will assume
      // that if there are unnecessary parens they serve a purpose of readability.
      if (k.$ === "Range") {
        return;
      }
      // Parentheses may be necessary to disambiguate precedence in guard patterns.
      else if (k.$ === "Guard") {
        return;
      }
      // Avoid `p0 | .. | pn` if we should.
      else if (k.$ === "Or" && avoid_or) {
        return;
      }
      // Avoid bindings whose own binding mutability is `mut`, like `mut x`,
      // `mut x @ p`, and `mut ref pin const x`, if we should.
      else if (k.$ === "Ident" && k._0._1 === "Mut" && avoid_mut) {
        return;
      } else if (
        ((k.$ === "Ref" && k._1 === "Pinned") || (k.$ === "Ident" && k._0._0.$ === "Yes" && k._0._0._0 === "Pinned")) &&
        // FIXME(pin_ergonomics): Remove this gate once pinned patterns are stable.
        !cx.builder.features().pin_ergonomics()
      ) {
        return;
      }
      // Otherwise proceed with linting.
      let spans: [Span, Span] | undefined;
      if (!Span.from_expansion(value.span)) {
        const inner_ = Span.find_ancestor_inside(inner.span, value.span);
        spans = inner_ === undefined ? undefined : [Span.with_hi(value.span, Span.lo(inner_)), Span.with_lo(value.span, Span.hi(inner_))];
      } else {
        spans = undefined;
      }
      UnusedDelimLint_provided.emit_unused_delims(this, cx, value.span, spans, "pattern", keep_space, false);
    }
  }

  /// A pattern that a `macro_rules!` metavariable brings in from the call site keeps the call
  /// site's syntax context, while the pattern's surroundings keep the macro's. Parentheses in
  /// such a pattern can be required by the matcher even when they are redundant in the
  /// expansion, so removing them would break the macro call. (Issue #86959)
  // rustc: compiler/rustc_lint/src/unused.rs:790 pat_is_macro_arg
  static pat_is_macro_arg(pat_span: Span, parent_span: Span): boolean {
    return !Span.eq_ctxt(pat_span, parent_span);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:794 cast_followed_by_lt
  cast_followed_by_lt(expr: ast.Expr): NodeId | undefined {
    if (expr.kind.$ === "Binary" && (expr.kind._0.node === "Lt" || expr.kind._0.node === "Shl")) {
      const lhs = expr.kind._1;
      let cur = lhs;
      while (cur.kind.$ === "Binary") {
        const rhs = cur.kind._2;
        cur = rhs;
      }

      if (cur.kind.$ === "Cast" && cur.kind._1.kind.$ === "Paren") {
        const ty = cur.kind._1;
        return ty.id;
      }
    }
    return undefined;
  }

  // impl EarlyLintPass for UnusedParens
  // #[inline]
  // rustc: compiler/rustc_lint/src/unused.rs:815 check_expr
  check_expr(cx: EarlyContext, e: ast.Expr): void {
    const ty_id = this.cast_followed_by_lt(e);
    if (ty_id !== undefined) {
      this.parens_in_cast_in_lt.push(ty_id);
    }

    const kind = e.kind;
    if (kind.$ === "Let" || kind.$ === "ForLoop") {
      const pat = kind.$ === "Let" ? kind._0 : kind._0.pat;
      const avoid_or = UnusedParens.pat_is_macro_arg(pat.span, e.span);
      this.check_unused_parens_pat(cx, pat, avoid_or, false, [true, true]);
    }
    // We ignore parens in cases like `if (((let Some(0) = Some(1))))` because we already
    // handle a hard error for them during AST lowering in `lower_expr_mut`, but we still
    // want to complain about things like `if let 42 = (42)`.
    else if (kind.$ === "If" && kind._0.peel_parens().kind.$ === "Let") {
      const cond = kind._0;
      const block = kind._1;
      const else_ = kind._2;
      this.check_unused_delims_expr(cx, cond.peel_parens(), "LetScrutineeExpr", true, undefined, undefined, true);
      for (const stmt of block.stmts) {
        UnusedDelimLint_provided.check_stmt(this, cx, stmt);
      }
      if (else_ !== undefined) {
        const e = else_;
        UnusedDelimLint_provided.check_expr(this, cx, e);
      }
      return;
    } else if (kind.$ === "Match") {
      const arm = kind._1;
      for (const a of arm) {
        if (a.body !== undefined) {
          const body = a.body;
          this.check_unused_delims_expr(cx, body, "MatchArmExpr", false, undefined, undefined, true);
        }
      }
    }

    UnusedDelimLint_provided.check_expr(this, cx, e);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:869 check_expr_post
  check_expr_post(_cx: EarlyContext, e: ast.Expr): void {
    const ty_id = this.cast_followed_by_lt(e);
    if (ty_id !== undefined) {
      const id = this.parens_in_cast_in_lt.pop();
      if (id === undefined) panic("check_expr and check_expr_post must balance");
      assert(id === ty_id, "check_expr, check_ty, and check_expr_post are called, in that order, by the visitor");
    }
  }

  // rustc: compiler/rustc_lint/src/unused.rs:882 check_pat
  check_pat(cx: EarlyContext, p: ast.Pat): void {
    // use ast::PatKind::*;
    // use ast::{Mutability, Pinnedness};
    const keep_space: [boolean, boolean] = [false, false];
    const k = p.kind;
    switch (k.$) {
      // Do not lint on `(..)` as that will result in the other arms being useless.
      case "Paren":
        break;
      // The other cases do not contain sub-patterns.
      case "Missing":
      case "Wild":
      case "Never":
      case "Rest":
      case "Expr":
      case "MacCall":
      case "Range":
      case "Path":
      case "Err":
        break;
      case "Ident":
        if (k._2 === undefined) break;
        // Avoid linting on `i @ (p0 | .. | pn)`, #64106.
        this.check_unused_parens_pat(cx, k._2, true, false, keep_space);
        break;
      // These are list-like patterns; parens can always be removed.
      case "TupleStruct":
      case "Tuple":
      case "Slice":
      case "Or": {
        const ps = k.$ === "TupleStruct" ? k._2 : k._0;
        for (const sub of ps) {
          const avoid_or = UnusedParens.pat_is_macro_arg(sub.span, p.span);
          this.check_unused_parens_pat(cx, sub, avoid_or, false, keep_space);
        }
        break;
      }
      case "Struct": {
        const fps = k._2;
        for (const f of fps) {
          const avoid_or = UnusedParens.pat_is_macro_arg(f.pat.span, p.span);
          this.check_unused_parens_pat(cx, f.pat, avoid_or, false, keep_space);
        }
        break;
      }
      // Avoid linting on `i @ (p0 | .. | pn)`, #64106.
      case "Deref":
      case "Guard":
        this.check_unused_parens_pat(cx, k._0, true, false, keep_space);
        break;
      // Avoid linting on `&(mut x)` as `&mut x` has a different meaning, #55342.
      // This only applies to plain shared reference patterns. In `&pin const (mut x)`,
      // `pin const` is consumed before parsing the subpattern, so removing the
      // parentheses preserves `mut x` as a binding pattern.
      // Also avoid linting on `& mut? (p0 | .. | pn)`, #64106.
      case "Ref": {
        const [p_, pinned, m] = [k._0, k._1, k._2];
        if (
          pinned !== "Pinned" ||
          // FIXME(pin_ergonomics): Remove this gate once pinned patterns are stable.
          cx.builder.features().pin_ergonomics()
        ) {
          this.check_unused_parens_pat(cx, p_, true, pinned === "Not" && m === "Not", keep_space);
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_lint/src/unused.rs:939 check_stmt
  check_stmt(cx: EarlyContext, s: ast.Stmt): void {
    if (s.kind.$ === "Let") {
      const local = s.kind._0;
      this.check_unused_parens_pat(cx, local.pat, true, false, [true, false]);
    }

    UnusedDelimLint_provided.check_stmt(this, cx, s);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:947 check_param
  check_param(cx: EarlyContext, param: ast.Param): void {
    this.check_unused_parens_pat(cx, param.pat, true, false, [false, false]);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:951 check_arm
  check_arm(cx: EarlyContext, arm: ast.Arm): void {
    const avoid_or = UnusedParens.pat_is_macro_arg(arm.pat.span, arm.span);
    this.check_unused_parens_pat(cx, arm.pat, avoid_or, false, [false, false]);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:956 check_ty
  check_ty(cx: EarlyContext, ty: ast.Ty): void {
    if (ty.kind.$ === "Paren" && this.parens_in_cast_in_lt.length !== 0 && ty.id === this.parens_in_cast_in_lt[this.parens_in_cast_in_lt.length - 1]) {
      return;
    }
    const k = ty.kind;
    switch (k.$) {
      case "Array": {
        const len = k._1;
        this.check_unused_delims_expr(cx, len.value, "ArrayLenExpr", false, undefined, undefined, false);
        break;
      }
      case "Paren": {
        const r = k._0;
        let unused_parens: boolean;
        if (r.kind.$ === "ImplTrait" || r.kind.$ === "TraitObject") {
          const bounds = r.kind.$ === "ImplTrait" ? r.kind._1 : r.kind._0;
          const e = this.in_no_bounds_pos.get(ty.id);
          if (e === "None") unused_parens = false;
          else if (e === "OneBound") unused_parens = bounds.length <= 1;
          else unused_parens = true;
        } else if (r.kind.$ === "FnPtr") {
          const b = r.kind._0;
          unused_parens = !this.with_self_ty_parens || b.generic_params.length === 0;
        } else {
          unused_parens = true;
        }

        if (unused_parens) {
          let spans: [Span, Span] | undefined = undefined;
          if (!Span.from_expansion(ty.span)) {
            const r_ = Span.find_ancestor_inside(r.span, ty.span);
            spans = r_ === undefined ? undefined : [Span.with_hi(ty.span, Span.lo(r_)), Span.with_lo(ty.span, Span.hi(r_))];
          }

          UnusedDelimLint_provided.emit_unused_delims(this, cx, ty.span, spans, "type", [false, false], false);
        }

        this.with_self_ty_parens = false;
        break;
      }
      case "Ref":
      case "Ptr": {
        const inner_ty = k.$ === "Ref" ? k._1 : k._0;
        // If this type itself appears in no-bounds position, we propagate its
        // potentially tighter constraint or risk a false posive (issue 143653).
        const own_constraint = this.in_no_bounds_pos.get(ty.id);
        let constraint: NoBoundsException;
        if (own_constraint === "None") constraint = "None";
        else if (own_constraint === "OneBound") constraint = "OneBound";
        else constraint = "OneBound";
        this.in_no_bounds_pos.set(inner_ty.id, constraint);
        break;
      }
      case "TraitObject":
      case "ImplTrait": {
        const bounds = k.$ === "TraitObject" ? k._0 : k._1;
        for (let i = 0; i < bounds.length; i++) {
          const is_last = i === bounds.length - 1;

          const bound = bounds[i]!;
          if (bound.$ === "Trait") {
            const poly_trait_ref = bound._0;
            const segments = poly_trait_ref.trait_ref.path.segments;
            const segment = segments.length !== 0 ? segments[segments.length - 1] : undefined;
            const args = segment?.args;
            let fn_with_explicit_ret_ty: boolean;
            if (args !== undefined && args.$ === "Parenthesized" && args._0.output.$ === "Ty") {
              const ret_ty = args._0.output._0;
              this.in_no_bounds_pos.set(ret_ty.id, is_last ? "OneBound" : "None");

              fn_with_explicit_ret_ty = true;
            } else {
              fn_with_explicit_ret_ty = false;
            }

            // In edition 2015, dyn is a contextual keyword and `dyn::foo::Bar` is
            // parsed as a path, so parens are necessary to disambiguate. See
            //  - tests/ui/lint/unused/unused-parens-trait-obj-e2015.rs and
            //  - https://doc.rust-lang.org/reference/types/trait-object.html#r-type.trait-object.syntax-edition2018
            const first = segments[0];
            const dyn2015_exception =
              cx.sess().psess.edition === "Edition2015" &&
              ty.kind.$ === "TraitObject" &&
              i === 0 &&
              (first !== undefined ? first.ident.name === kw.PathRoot : false);

            if (poly_trait_ref.parens === "Yes" && (is_last || !fn_with_explicit_ret_ty) && !dyn2015_exception) {
              const s = poly_trait_ref.span;
              // Check that the span really is wrapped in single-byte ASCII parens
              // before trimming a byte off each end, in case a macro does weird
              // things with spans or parser recovery produced multibyte parens.
              let snippet;
              if (
                !Span.from_expansion(s) &&
                (snippet = cx.sess().source_map().span_to_snippet(s)).$ === "Ok" &&
                snippet._0.toString().startsWith("(") &&
                snippet._0.toString().endsWith(")")
              ) {
                const spans: [Span, Span] = [
                  Span.with_hi(s, BytePos.add(Span.lo(s), BytePos(1))),
                  Span.with_lo(s, BytePos.sub(Span.hi(s), BytePos(1))),
                ];

                UnusedDelimLint_provided.emit_unused_delims(this, cx, poly_trait_ref.span, spans, "type", [false, false], false);
              }
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_lint/src/unused.rs:1089 check_item
  check_item(cx: EarlyContext, item: ast.Item): void {
    UnusedDelimLint_provided.check_item(this, cx, item);
  }

  // rustc: compiler/rustc_lint/src/unused.rs:1093 check_item_post
  check_item_post(_: EarlyContext, __: ast.Item): void {
    this.in_no_bounds_pos.clear();
  }

  // rustc: compiler/rustc_lint/src/unused.rs:1097 check_where_predicate
  check_where_predicate(_: EarlyContext, pred: ast.WherePredicate): void {
    // use rustc_ast::{WhereBoundPredicate, WherePredicateKind};
    if (pred.kind.$ === "BoundPredicate") {
      const { bounded_ty, bound_generic_params } = pred.kind._0;
      if (bounded_ty.kind.$ === "Paren" && bound_generic_params.length === 0) {
        this.with_self_ty_parens = true;
      }
    }
  }

  // rustc: compiler/rustc_lint/src/unused.rs:1111 check_where_predicate_post
  check_where_predicate_post(_: EarlyContext, __: ast.WherePredicate): void {
    assert(!this.with_self_ty_parens, "assertion failed: !self.with_self_ty_parens");
  }
}

declare module "./unused.lints.gen.ts" {
  interface UnusedBraces extends EarlyLintPass, UnusedDelimLint {}
  interface UnusedImportBraces extends EarlyLintPass {
    check_use_tree(cx: EarlyContext, use_tree: ast.UseTree, item: ast.Item): void;
  }
}

// impl UnusedDelimLint for UnusedBraces
Object.defineProperty(UnusedBraces.prototype, "DELIM_STR", { value: "braces" });

Object.defineProperty(UnusedBraces.prototype, "LINT_EXPR_IN_PATTERN_MATCHING_CTX", { value: false });

// rustc: compiler/rustc_lint/src/unused.rs:1146 lint
UnusedBraces.prototype.lint = function (this: UnusedBraces): Lint {
  return UNUSED_BRACES;
};

// rustc: compiler/rustc_lint/src/unused.rs:1150 check_unused_delims_expr
UnusedBraces.prototype.check_unused_delims_expr = function (
  this: UnusedBraces,
  cx: EarlyContext,
  value: ast.Expr,
  ctx: UnusedDelimsCtx,
  followed_by_block: boolean,
  left_pos: BytePos | undefined,
  right_pos: BytePos | undefined,
  is_kw: boolean,
): void {
  if (value.kind.$ === "Block" && value.kind._1 === undefined && value.kind._0.rules.$ === "Default") {
    const inner = value.kind._0;
    // emit a warning under the following conditions:
    //
    // - the block does not have a label
    // - the block is not `unsafe`
    // - the block contains exactly one expression (do not lint `{ expr; }`)
    // - `followed_by_block` is true and the internal expr may contain a `{`
    // - the block is not multiline (do not lint multiline match arms)
    //      ```
    //      match expr {
    //          Pattern => {
    //              somewhat_long_expression
    //          }
    //          // ...
    //      }
    //      ```
    // - the block has no attribute and was not created inside a macro
    // - if the block is an `anon_const`, the inner expr must be a literal
    //   not created by a macro, i.e. do not lint on:
    //      ```
    //      struct A<const N: usize>;
    //      let _: A<{ 2 + 3 }>;
    //      let _: A<{produces_literal!()}>;
    //      ```
    // FIXME(const_generics): handle paths when #67075 is fixed.
    if (inner.stmts.length === 1 && inner.stmts[0]!.kind.$ === "Expr") {
      const expr = inner.stmts[0]!.kind._0;
      if (
        !UnusedDelimLint_provided.is_expr_delims_necessary(expr, ctx, followed_by_block) &&
        // In Rust 2024, this block may drop tail-expression temporaries, such as a
        // lock guard, before the loop starts.
        !(ctx === "ForIterExpr" && Span.at_least_rust_2024(value.span)) &&
        !UnusedDelimLint_provided.needs_arg_block_to_preserve_temporaries(ctx, value, expr) &&
        (ctx !== "AnonConst" || (expr.kind.$ === "Lit" && !Span.from_expansion(expr.span))) &&
        ctx !== "ClosureBody" &&
        !cx.sess().source_map().is_multiline(value.span) &&
        value.attrs.length === 0 &&
        !Span.from_expansion(value.span) &&
        !Span.from_expansion(inner.span)
      ) {
        UnusedDelimLint_provided.emit_unused_delims_expr(this, cx, value, ctx, left_pos, right_pos, is_kw);
      }
    }
  } else if (value.kind.$ === "Let") {
    const expr = value.kind._1;
    this.check_unused_delims_expr(cx, expr, "LetScrutineeExpr", followed_by_block, undefined, undefined, false);
  }
};

// impl EarlyLintPass for UnusedBraces
// rustc: compiler/rustc_lint/src/unused.rs:1225 check_stmt
UnusedBraces.prototype.check_stmt = function (this: UnusedBraces, cx: EarlyContext, s: ast.Stmt): void {
  UnusedDelimLint_provided.check_stmt(this, cx, s);
};

// #[inline]
// rustc: compiler/rustc_lint/src/unused.rs:1230 check_expr
UnusedBraces.prototype.check_expr = function (this: UnusedBraces, cx: EarlyContext, e: ast.Expr): void {
  UnusedDelimLint_provided.check_expr(this, cx, e);

  if (e.kind.$ === "Repeat") {
    const anon_const = e.kind._1;
    this.check_unused_delims_expr(cx, anon_const.value, "AnonConst", false, undefined, undefined, false);
  }
};

// rustc: compiler/rustc_lint/src/unused.rs:1246 check_generic_arg
UnusedBraces.prototype.check_generic_arg = function (this: UnusedBraces, cx: EarlyContext, arg: ast.GenericArg): void {
  if (arg.$ === "Const") {
    const ct = arg._0;
    this.check_unused_delims_expr(cx, ct.value, "AnonConst", false, undefined, undefined, false);
  }
};

// rustc: compiler/rustc_lint/src/unused.rs:1260 check_variant
UnusedBraces.prototype.check_variant = function (this: UnusedBraces, cx: EarlyContext, v: ast.Variant): void {
  if (v.disr_expr !== undefined) {
    const anon_const = v.disr_expr;
    this.check_unused_delims_expr(cx, anon_const.value, "AnonConst", false, undefined, undefined, false);
  }
};

// rustc: compiler/rustc_lint/src/unused.rs:1274 check_ty
UnusedBraces.prototype.check_ty = function (this: UnusedBraces, cx: EarlyContext, ty: ast.Ty): void {
  switch (ty.kind.$) {
    case "Array": {
      const len = ty.kind._1;
      this.check_unused_delims_expr(cx, len.value, "ArrayLenExpr", false, undefined, undefined, false);
      break;
    }

    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/unused.rs:1292 check_item
UnusedBraces.prototype.check_item = function (this: UnusedBraces, cx: EarlyContext, item: ast.Item): void {
  UnusedDelimLint_provided.check_item(this, cx, item);
};

// impl UnusedImportBraces
// rustc: compiler/rustc_lint/src/unused.rs:1330 check_use_tree
UnusedImportBraces.prototype.check_use_tree = function (this: UnusedImportBraces, cx: EarlyContext, use_tree: ast.UseTree, item: ast.Item): void {
  if (use_tree.kind.$ === "Nested") {
    const items = use_tree.kind.items;
    // Recursively check nested UseTrees
    for (const tree of items) {
      this.check_use_tree(cx, tree.inner, item);
    }

    // Trigger the lint only if there is one nested item
    if (items.length !== 1) return;
    const tree = items[0]!;

    // Trigger the lint if the nested item is a non-self single item
    let node_name: Symbol;
    const k = tree.inner.kind;
    switch (k.$) {
      case "Simple": {
        const rename = k._0;
        const segments = tree.inner.prefix.segments;
        const last = segments[segments.length - 1];
        if (last === undefined) panic("called `Option::unwrap()` on a `None` value");
        const orig_ident = last.ident;
        if (orig_ident.name === kw.SelfLower) {
          return;
        }
        node_name = (rename ?? orig_ident).name;
        break;
      }
      case "Glob":
        node_name = sym.asterisk;
        break;
      case "Nested":
        return;
    }

    cx.emit_span_lint(UNUSED_IMPORT_BRACES, item.span, UnusedImportBracesDiag_diagnostic({ node: node_name }));
  }
};

// impl EarlyLintPass for UnusedImportBraces
// rustc: compiler/rustc_lint/src/unused.rs:1363 check_item
UnusedImportBraces.prototype.check_item = function (this: UnusedImportBraces, cx: EarlyContext, item: ast.Item): void {
  if (item.kind.$ === "Use") {
    const use_tree = item.kind._0;
    this.check_use_tree(cx, use_tree, item);
  }
};

// impl LateLintPass for UnusedAllocation
// rustc: compiler/rustc_lint/src/unused.rs:1397 check_expr
UnusedAllocation.prototype.check_expr = function (this: UnusedAllocation, cx: LateContext, e: hir.Expr): void {
  let did: DefId | undefined;
  if (
    e.kind.$ === "Call" &&
    e.kind._1.length === 1 &&
    e.kind._0.kind.$ === "Path" &&
    (did = Res.opt_def_id(cx.qpath_res(e.kind._0.kind._0, e.kind._0.hir_id) as Res)) !== undefined &&
    cx.tcx.is_diagnostic_item(sym.box_new, did)
  ) {
    // {}
  } else {
    return;
  }

  for (const adj of (cx.typeck_results_() as TypeckResults).expr_adjustments(e)) {
    if (adj.kind.$ === "Borrow" && adj.kind._0.$ === "Ref") {
      const m = adj.kind._0._0;
      const target_kind = adj.target.kind();
      if (target_kind.$ === "Ref" && target_kind._1.is_box()) {
        // If the target type is `&Box<T>` or `&mut Box<T>`, the allocation is necessary
        continue;
      }
      switch (m.$) {
        case "Not":
          cx.emit_span_lint(UNUSED_ALLOCATION, e.span, UnusedAllocationDiag_diagnostic({}));
          break;
        case "Mut":
          cx.emit_span_lint(UNUSED_ALLOCATION, e.span, UnusedAllocationMutDiag_diagnostic({}));
          break;
      }
    }
  }
};
