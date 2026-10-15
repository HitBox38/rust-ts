//! This file builds up the `ScopeTree`, which describes
//! the parent links in the region hierarchy.
//!
//! For more information about how MIR-based region-checking works,
//! see the [rustc dev guide].
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/borrow_check.html
// Port of compiler/rustc_hir_analysis/src/check/region.rs (lane check-region-intrinsic).
//
// Init order: top-level code here touches only other crates (the `Visitor` base class of rustc_hir).
import * as hir from "../../rustc_hir/lib.ts";
import { Visitor, walk_expr, walk_pat, walk_stmt } from "../../rustc_hir/intravisit.ts";
import type { HirId, ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { TAIL_EXPR_DROP_ORDER } from "../../rustc_lint_defs/builtin.ts";
import { LintId } from "../../rustc_lint_defs/lib.ts";
import { FirstStatementIndex, Scope, ScopeData, ScopeTree } from "../../rustc_middle/middle/region.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { Span } from "../../rustc_span/lib.ts";
import { unwrap } from "../../std/panic.ts";

// rustc-type: compiler/rustc_hir_analysis/src/check/region.rs:26 Context
// #[derive(Debug, Copy, Clone)]
// PORT: a `Copy` struct that is assigned field by field: every Rust copy (`let prev_cx = visitor.cx;`,
// `visitor.cx = prev_cx;`) is `copy_Context` (a fresh object), so a later field write never reaches the copy.
interface Context {
  /// The scope that contains any new variables declared.
  var_parent: Scope | undefined;

  /// Region parent of expressions, etc.
  parent: Scope | undefined;
}

/** `Copy` of `Context` (its `Scope`s are never mutated, so they are shared). */
function copy_Context(cx: Context): Context {
  return { var_parent: cx.var_parent, parent: cx.parent };
}

/// Records the lifetime of a local variable as `cx.var_parent`
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:46 record_var_lifetime
function record_var_lifetime(visitor: ScopeResolutionVisitor, var_id: ItemLocalId): void {
  const parent_scope = visitor.cx.var_parent;
  if (parent_scope === undefined) {
    // this can happen in extern fn declarations like
    //
    // extern fn isalnum(c: c_int) -> c_int
  } else {
    visitor.scope_tree.record_var_scope(var_id, parent_scope);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/region.rs:57 resolve_block
function resolve_block(visitor: ScopeResolutionVisitor, blk: hir.Block, terminating: boolean): void {
  // debug!("resolve_block(blk.hir_id={:?})", blk.hir_id);

  const prev_cx = copy_Context(visitor.cx);

  // We treat the tail expression in the block (if any) somewhat
  // differently from the statements. The issue has to do with
  // temporary lifetimes. Consider the following:
  //
  //    quux({
  //        let inner = ... (&bar()) ...;
  //
  //        (... (&foo()) ...) // (the tail expression)
  //    }, other_argument());
  //
  // Each of the statements within the block is a terminating
  // scope, and thus a temporary (e.g., the result of calling
  // `bar()` in the initializer expression for `let inner = ...;`)
  // will be cleaned up immediately after its corresponding
  // statement (i.e., `let inner = ...;`) executes.
  //
  // On the other hand, temporaries associated with evaluating the
  // tail expression for the block are assigned lifetimes so that
  // they will be cleaned up as part of the terminating scope
  // *surrounding* the block expression. Here, the terminating
  // scope for the block expression is the `quux(..)` call; so
  // those temporaries will only be cleaned up *after* both
  // `other_argument()` has run and also the call to `quux(..)`
  // itself has returned.

  visitor.enter_node_scope_with_dtor(blk.hir_id.local_id, terminating);
  visitor.cx.var_parent = visitor.cx.parent;

  {
    // This block should be kept approximately in sync with
    // `intravisit::walk_block`. (We manually walk the block, rather
    // than call `walk_block`, in order to maintain precise
    // index information.)

    for (let i = 0; i < blk.stmts.length; i++) {
      const statement = blk.stmts[i]!;
      const kind = statement.kind;
      if (kind.$ === "Let" && kind._0.els !== undefined) {
        const els = kind._0.els;
        // let-else has a special lexical structure for variables.
        // First we take a checkpoint of the current scope context here.
        let prev_cx = copy_Context(visitor.cx);

        visitor.enter_scope(new Scope(blk.hir_id.local_id, { $: "Remainder", _0: FirstStatementIndex.new(i) }));
        visitor.cx.var_parent = visitor.cx.parent;
        visitor.visit_stmt(statement);
        // We need to back out temporarily to the last enclosing scope
        // for the `else` block, so that even the temporaries receiving
        // extended lifetime will be dropped inside this block.
        // We are visiting the `else` block in this order so that
        // the sequence of visits agree with the order in the default
        // `hir::intravisit` visitor.
        // `mem::swap(&mut prev_cx, &mut visitor.cx);`
        const tmp = visitor.cx;
        visitor.cx = prev_cx;
        prev_cx = tmp;
        resolve_block(visitor, els, true);
        // From now on, we continue normally.
        visitor.cx = prev_cx;
      } else if (kind.$ === "Let") {
        // Each declaration introduces a subscope for bindings
        // introduced by the declaration; this subscope covers a
        // suffix of the block. Each subscope in a block has the
        // previous subscope in the block as a parent, except for
        // the first such subscope, which has the block itself as a
        // parent.
        visitor.enter_scope(new Scope(blk.hir_id.local_id, { $: "Remainder", _0: FirstStatementIndex.new(i) }));
        visitor.cx.var_parent = visitor.cx.parent;
        visitor.visit_stmt(statement);
      } else if (kind.$ === "Item") {
        // Don't create scopes for items, since they won't be
        // lowered to THIR and MIR.
      } else {
        // hir::StmtKind::Expr(..) | hir::StmtKind::Semi(..)
        visitor.visit_stmt(statement);
      }
    }
    const tail_expr = blk.expr;
    if (tail_expr !== undefined) {
      const local_id = tail_expr.hir_id.local_id;
      const edition = Span.edition(blk.span);
      const terminating = Edition.at_least_rust_2024(edition);
      if (!terminating && !(visitor.tcx.skippable_lints(null) as Set<LintId>).has(LintId.of(TAIL_EXPR_DROP_ORDER))) {
        // If this temporary scope will be changing once the codebase adopts Rust 2024,
        // and we are linting about possible semantic changes that would result,
        // then record this node-id in the field `backwards_incompatible_scope`
        // for future reference.
        visitor.scope_tree.backwards_incompatible_scope.set(local_id, new Scope(local_id, ScopeData.Node));
      }
      resolve_expr(visitor, tail_expr, terminating);
    }
  }

  visitor.cx = prev_cx;
}

/// Resolve a condition from an `if` expression or match guard so that it is a terminating scope
/// if it doesn't contain `let` expressions.
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:170 resolve_cond
function resolve_cond(visitor: ScopeResolutionVisitor, cond: hir.Expr): void {
  let terminate: boolean;
  const kind = cond.kind;
  if (kind.$ === "Let") {
    // Temporaries for `let` expressions must live into the success branch.
    terminate = false;
  } else if (kind.$ === "Binary" && (kind._0.node === "And" || kind._0.node === "Or")) {
    // Logical operator chains are handled in `resolve_expr`. Since logical operator chains in
    // conditions are lowered to control-flow rather than boolean temporaries, there's no
    // temporary to drop for logical operators themselves. `resolve_expr` will also recursively
    // wrap any operands in terminating scopes, other than `let` expressions (which we shouldn't
    // terminate) and other logical operators (which don't need a terminating scope, since their
    // operands will be terminated). Any temporaries that would need to be dropped will be
    // dropped before we leave this operator's scope; terminating them here would be redundant.
    terminate = false;
  } else {
    // Otherwise, conditions should always drop their temporaries.
    terminate = true;
  }
  resolve_expr(visitor, cond, terminate);
}

// rustc: compiler/rustc_hir_analysis/src/check/region.rs:192 resolve_arm
function resolve_arm(visitor: ScopeResolutionVisitor, arm: hir.Arm): void {
  const prev_cx = copy_Context(visitor.cx);

  visitor.enter_node_scope_with_dtor(arm.hir_id.local_id, true);
  visitor.cx.var_parent = visitor.cx.parent;

  resolve_pat(visitor, arm.pat);
  const guard = arm.guard;
  if (guard !== undefined) {
    // We introduce a new scope to contain bindings and temporaries from `if let` guards, to
    // ensure they're dropped before the arm's pattern's bindings. This extends to the end of
    // the arm body and is the scope of its locals as well.
    visitor.enter_scope(new Scope(arm.hir_id.local_id, ScopeData.MatchGuard));
    visitor.cx.var_parent = visitor.cx.parent;
    resolve_cond(visitor, guard);
  }
  resolve_expr(visitor, arm.body, false);

  visitor.cx = prev_cx;
}

// #[tracing::instrument(level = "debug", skip(visitor))]
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:213 resolve_pat
function resolve_pat(visitor: ScopeResolutionVisitor, pat: hir.Pat): void {
  // If this is a binding then record the lifetime of that binding.
  if (pat.kind.$ === "Binding") {
    record_var_lifetime(visitor, pat.hir_id.local_id);
  }

  walk_pat(visitor, pat);
}

// rustc: compiler/rustc_hir_analysis/src/check/region.rs:222 resolve_stmt
function resolve_stmt(visitor: ScopeResolutionVisitor, stmt: hir.Stmt): void {
  const stmt_id = stmt.hir_id.local_id;
  // debug!("resolve_stmt(stmt.id={:?})", stmt_id);

  if (stmt.kind.$ === "Let" && stmt.kind._0.super_ !== undefined) {
    // `super let` statement does not start a new scope, such that
    //
    //     { super let x = identity(&temp()); &x }.method();
    //
    // behaves exactly as
    //
    //     (&identity(&temp()).method();
    walk_stmt(visitor, stmt);
  } else {
    // Every statement will clean up the temporaries created during
    // execution of that statement. Therefore each statement has an
    // associated destruction scope that represents the scope of the
    // statement plus its destructors, and thus the scope for which
    // regions referenced by the destructors need to survive.

    const prev_parent = visitor.cx.parent;
    visitor.enter_node_scope_with_dtor(stmt_id, true);

    walk_stmt(visitor, stmt);

    visitor.cx.parent = prev_parent;
  }
}

// #[tracing::instrument(level = "debug", skip(visitor))]
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:252 resolve_expr
function resolve_expr(visitor: ScopeResolutionVisitor, expr: hir.Expr, terminating: boolean): void {
  const prev_cx = copy_Context(visitor.cx);
  visitor.enter_node_scope_with_dtor(expr.hir_id.local_id, terminating);

  const kind = expr.kind;
  // Conditional or repeating scopes are always terminating
  // scopes, meaning that temporaries cannot outlive them.
  // This ensures fixed size stacks.
  if (kind.$ === "Binary" && (kind._0.node === "And" || kind._0.node === "Or")) {
    const left = kind._1;
    const right = kind._2;
    // expr is a short circuiting operator (|| or &&). As its
    // functionality can't be overridden by traits, it always
    // processes bool sub-expressions. bools are Copy and thus we
    // can drop any temporaries in evaluation (read) order
    // (with the exception of potentially failing let expressions).
    // We achieve this by enclosing the operands in a terminating
    // scope, both the LHS and the RHS.

    // We optimize this a little in the presence of chains.
    // Chains like a && b && c get lowered to AND(AND(a, b), c).
    // In here, b and c are RHS, while a is the only LHS operand in
    // that chain. This holds true for longer chains as well: the
    // leading operand is always the only LHS operand that is not a
    // binop itself. Putting a binop like AND(a, b) into a
    // terminating scope is not useful, thus we only put the LHS
    // into a terminating scope if it is not a binop.

    let terminate_lhs: boolean;
    const left_kind = left.kind;
    if (left_kind.$ === "Let") {
      // let expressions can create temporaries that live on
      terminate_lhs = false;
    } else if (left_kind.$ === "Binary" && (left_kind._0.node === "And" || left_kind._0.node === "Or")) {
      // binops already drop their temporaries, so there is no
      // need to put them into a terminating scope.
      // This is purely an optimization to reduce the number of
      // terminating scopes.
      terminate_lhs = false;
    } else {
      // otherwise: mark it as terminating
      terminate_lhs = true;
    }

    // `Let` expressions (in a let-chain) shouldn't be terminating, as their temporaries
    // should live beyond the immediate expression
    const terminate_rhs = !(right.kind.$ === "Let");

    resolve_expr(visitor, left, terminate_lhs);
    resolve_expr(visitor, right, terminate_rhs);
  } else if (kind.$ === "Closure") {
    // Manually recurse over closures, because they are nested bodies
    // that share the parent environment. We handle const blocks in
    // `visit_inline_const`.
    const body = visitor.tcx.hir_body(kind._0.body);
    visitor.visit_body(body);
  } else if (kind.$ === "AssignOp") {
    // Ordinarily, we can rely on the visit order of HIR intravisit
    // to correspond to the actual execution order of statements.
    // However, there's a weird corner case with compound assignment
    // operators (e.g. `a += b`). The evaluation order depends on whether
    // or not the operator is overloaded (e.g. whether or not a trait
    // like AddAssign is implemented).
    //
    // For primitive types (which, despite having a trait impl, don't actually
    // end up calling it), the evaluation order is right-to-left. For example,
    // the following code snippet:
    //
    //    let y = &mut 0;
    //    *{println!("LHS!"); y} += {println!("RHS!"); 1};
    //
    // will print:
    //
    // RHS!
    // LHS!
    //
    // However, if the operator is used on a non-primitive type,
    // the evaluation order will be left-to-right, since the operator
    // actually get desugared to a method call. For example, this
    // nearly identical code snippet:
    //
    //     let y = &mut String::new();
    //    *{println!("LHS String"); y} += {println!("RHS String"); "hi"};
    //
    // will print:
    // LHS String
    // RHS String
    //
    // To determine the actual execution order, we need to perform
    // trait resolution. Fortunately, we don't need to know the actual execution order.
    const left_expr = kind._1;
    const right_expr = kind._2;
    visitor.visit_expr(right_expr);
    visitor.visit_expr(left_expr);
  } else if (kind.$ === "If" && kind._2 !== undefined) {
    const cond = kind._0;
    const then = kind._1;
    const otherwise = kind._2;
    const expr_cx = copy_Context(visitor.cx);
    const data = Span.at_least_rust_2024(expr.span) ? ScopeData.IfThenRescope : ScopeData.IfThen;
    visitor.enter_scope(new Scope(then.hir_id.local_id, data));
    visitor.cx.var_parent = visitor.cx.parent;
    resolve_cond(visitor, cond);
    resolve_expr(visitor, then, true);
    visitor.cx = copy_Context(expr_cx);
    resolve_expr(visitor, otherwise, true);
  } else if (kind.$ === "If") {
    // hir::ExprKind::If(cond, then, None)
    const cond = kind._0;
    const then = kind._1;
    const expr_cx = copy_Context(visitor.cx);
    const data = Span.at_least_rust_2024(expr.span) ? ScopeData.IfThenRescope : ScopeData.IfThen;
    visitor.enter_scope(new Scope(then.hir_id.local_id, data));
    visitor.cx.var_parent = visitor.cx.parent;
    resolve_cond(visitor, cond);
    resolve_expr(visitor, then, true);
    visitor.cx = copy_Context(expr_cx);
  } else if (kind.$ === "Loop") {
    resolve_block(visitor, kind._0, true);
  } else if (kind.$ === "DropTemps") {
    // `DropTemps(expr)` does not denote a conditional scope.
    // Rather, we want to achieve the same behavior as `{ let _t = expr; _t }`.
    resolve_expr(visitor, kind._0, true);
  } else {
    walk_expr(visitor, expr);
  }

  visitor.cx = prev_cx;
}

// rustc-type: compiler/rustc_hir_analysis/src/check/region.rs:399 LetKind
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
type LetKind = "Regular" | "Super";

// rustc: compiler/rustc_hir_analysis/src/check/region.rs:404 resolve_local
function resolve_local(visitor: ScopeResolutionVisitor, pat: hir.Pat | undefined, init: hir.Expr | undefined, let_kind: LetKind): void {
  // debug!("resolve_local(pat={:?}, init={:?}, let_kind={:?})", pat, init, let_kind);

  // As an exception to the normal rules governing temporary
  // lifetimes, initializers in a let have a temporary lifetime
  // of the enclosing block. This means that e.g., a program
  // like the following is legal:
  //
  //     let ref x = HashMap::new();
  //
  // Because the hash map will be freed in the enclosing block.
  //
  // We express the rules more formally based on 3 grammars (defined
  // fully in the helpers below that implement them):
  //
  // 1. `E&`, which matches expressions like `&<rvalue>` that
  //    own a pointer into the stack.
  //
  // 2. `P&`, which matches patterns like `ref x` or `(ref x, ref
  //    y)` that produce ref bindings into the value they are
  //    matched against or something (at least partially) owned by
  //    the value they are matched against. (By partially owned,
  //    I mean that creating a binding into a ref-counted or managed value
  //    would still count.)
  //
  // 3. `ET`, which matches both rvalues like `foo()` as well as places
  //    based on rvalues like `foo().x[2].y`.
  //
  // A subexpression `<rvalue>` that appears in a let initializer
  // `let pat [: ty] = expr` has an extended temporary lifetime if
  // any of the following conditions are met:
  //
  // A. `pat` matches `P&` and `expr` matches `ET`
  //    (covers cases where `pat` creates ref bindings into an rvalue
  //     produced by `expr`)
  // B. `ty` is a borrowed pointer and `expr` matches `ET`
  //    (covers cases where coercion creates a borrow)
  // C. `expr` matches `E&`
  //    (covers cases `expr` borrows an rvalue that is then assigned
  //     to memory (at least partially) owned by the binding)
  //
  // Here are some examples hopefully giving an intuition where each
  // rule comes into play and why:
  //
  // Rule A. `let (ref x, ref y) = (foo().x, 44)`. The rvalue `(22, 44)`
  // would have an extended lifetime, but not `foo()`.
  //
  // Rule B. `let x = &foo().x`. The rvalue `foo()` would have extended
  // lifetime.
  //
  // In some cases, multiple rules may apply (though not to the same
  // rvalue). For example:
  //
  //     let ref x = [&a(), &b()];
  //
  // Here, the expression `[...]` has an extended lifetime due to rule
  // A, but the inner rvalues `a()` and `b()` have an extended lifetime
  // due to rule C.

  let extend_initializer: boolean;
  if (let_kind === "Regular") {
    extend_initializer = true;
  } else {
    // PORT: the guard `if let Some(scope) = visitor.extended_super_lets.remove(..)` of the first `LetKind::Super`
    // arm: the removal happens whether or not it matches.
    const key = unwrap(pat).hir_id.local_id;
    const had = visitor.extended_super_lets.has(key);
    const scope = visitor.extended_super_lets.get(key);
    visitor.extended_super_lets.delete(key);
    if (had) {
      // This expression was lifetime-extended by a parent let binding. E.g.
      //
      //     let a = {
      //         super let b = temp();
      //         &b
      //     };
      //
      // (Which needs to behave exactly as: let a = &temp();)
      //
      // Processing of `let a` will have already decided to extend the lifetime of this
      // `super let` to its own var_scope. We use that scope.
      visitor.cx.var_parent = scope;
      // Extend temporaries to live in the same scope as the parent `let`'s bindings.
      extend_initializer = true;
    } else {
      // This `super let` is not subject to lifetime extension from a parent let binding. E.g.
      //
      //     identity({ super let x = temp(); &x }).method();
      //
      // (Which needs to behave exactly as: identity(&temp()).method();)
      //
      // Iterate up to the enclosing destruction scope to find the same scope that will also
      // be used for the result of the block itself.
      const inner_scope = visitor.cx.var_parent;
      if (inner_scope !== undefined) {
        visitor.cx.var_parent = visitor.scope_tree.default_temporary_scope(inner_scope)[0];
      }
      // Don't lifetime-extend child `super let`s or block tail expressions' temporaries in
      // the initializer when this `super let` is not itself extended by a parent `let`
      // (#145784). Block tail expressions are temporary drop scopes in Editions 2024 and
      // later, their temps shouldn't outlive the block in e.g. `f(pin!({ &temp() }))`.
      extend_initializer = false;
    }
  }

  if (init !== undefined && extend_initializer) {
    const expr = init;
    record_rvalue_scope_if_borrow_expr(visitor, expr, visitor.cx.var_parent);

    if (pat !== undefined) {
      if (is_binding_pat(pat)) {
        record_subexpr_extended_temp_scopes(visitor.scope_tree, expr, visitor.cx.var_parent);
      }
    }
  }

  // Make sure we visit the initializer first.
  // The correct order, as shared between drop_ranges and intravisitor,
  // is to walk initializer, followed by pattern bindings, finally followed by the `else` block.
  if (init !== undefined) {
    visitor.visit_expr(init);
  }

  if (pat !== undefined) {
    visitor.visit_pat(pat);
  }

  /// Returns `true` if `pat` match the `P&` non-terminal.
  ///
  /// ```text
  ///     P& = ref X
  ///        | StructName { ..., P&, ... }
  ///        | VariantName(..., P&, ...)
  ///        | [ ..., P&, ... ]
  ///        | ( ..., P&, ... )
  ///        | ... "|" P& "|" ...
  ///        | box P&
  ///        | P& if ...
  /// ```
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:549 is_binding_pat
  function is_binding_pat(pat: hir.Pat): boolean {
    // Note that the code below looks for *explicit* refs only, that is, it won't
    // know about *implicit* refs as introduced in #42640.
    //
    // This is not a problem. For example, consider
    //
    //      let (ref x, ref y) = (Foo { .. }, Bar { .. });
    //
    // Due to the explicit refs on the left hand side, the below code would signal
    // that the temporary value on the right hand side should live until the end of
    // the enclosing block (as opposed to being dropped after the let is complete).
    //
    // To create an implicit ref, however, you must have a borrowed value on the RHS
    // already, as in this example (which won't compile before #42640):
    //
    //      let Foo { x, .. } = &Foo { x: ..., ... };
    //
    // in place of
    //
    //      let Foo { ref x, .. } = Foo { ... };
    //
    // In the former case (the implicit ref version), the temporary is created by the
    // & expression, and its lifetime would be extended to the end of the block (due
    // to a different rule, not the below code).
    const kind = pat.kind;
    switch (kind.$) {
      case "Binding":
        // PatKind::Binding(hir::BindingMode(hir::ByRef::Yes(..), _), ..) => true,
        // PatKind::Binding(hir::BindingMode(hir::ByRef::No, _), ..) => false (below)
        return kind._0._0.$ === "Yes";

      case "Struct":
        return kind._1.some((fp) => is_binding_pat(fp.pat));

      case "Slice": {
        const pats1 = kind._0;
        const pats2 = kind._1;
        const pats3 = kind._2;
        return (
          pats1.some((p) => is_binding_pat(p)) ||
          // PORT: `pats2` is an `Option<&Pat>`: `iter()` yields its value if any.
          (pats2 !== undefined && is_binding_pat(pats2)) ||
          pats3.some((p) => is_binding_pat(p))
        );
      }

      case "Or":
      case "TupleStruct":
      case "Tuple": {
        const subpats = kind.$ === "Or" ? kind._0 : kind.$ === "TupleStruct" ? kind._1 : kind._0;
        return subpats.some((p) => is_binding_pat(p));
      }

      case "Deref":
      case "Guard":
        return is_binding_pat(kind._0);

      case "Ref":
      case "Missing":
      case "Wild":
      case "Never":
      case "Expr":
      case "Range":
      case "Err":
        return false;
    }
  }

  /// If `expr` matches the `E&` grammar, then records an extended temporary scope as appropriate:
  ///
  /// ```text
  ///     E& = & ET
  ///        | StructName { ..., f: E&, ... }
  ///        | [ ..., E&, ... ]
  ///        | ( ..., E&, ... )
  ///        | {...; E&}
  ///        | { super let ... = E&; ... }
  ///        | if _ { ...; E& } else { ...; E& }
  ///        | match _ { ..., _ => E&, ... }
  ///        | box E&
  ///        | E& as ...
  ///        | ( E& )
  /// ```
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:616 record_rvalue_scope_if_borrow_expr
  function record_rvalue_scope_if_borrow_expr(visitor: ScopeResolutionVisitor, expr: hir.Expr, blk_id: Scope | undefined): void {
    const kind = expr.kind;
    switch (kind.$) {
      case "AddrOf": {
        const subexpr = kind._2;
        record_rvalue_scope_if_borrow_expr(visitor, subexpr, blk_id);
        record_subexpr_extended_temp_scopes(visitor.scope_tree, subexpr, blk_id);
        break;
      }
      case "Struct": {
        for (const field of kind._1) {
          record_rvalue_scope_if_borrow_expr(visitor, field.expr, blk_id);
        }
        break;
      }
      case "Array":
      case "Tup": {
        for (const subexpr of kind._0) {
          record_rvalue_scope_if_borrow_expr(visitor, subexpr, blk_id);
        }
        break;
      }
      case "Cast": {
        record_rvalue_scope_if_borrow_expr(visitor, kind._0, blk_id);
        break;
      }
      case "Block": {
        const block = kind._0;
        const subexpr = block.expr;
        if (subexpr !== undefined) {
          record_rvalue_scope_if_borrow_expr(visitor, subexpr, blk_id);
        }
        for (const stmt of block.stmts) {
          if (stmt.kind.$ === "Let" && stmt.kind._0.super_ !== undefined) {
            const local = stmt.kind._0;
            visitor.extended_super_lets.set(local.pat.hir_id.local_id, blk_id);
          }
        }
        break;
      }
      case "If": {
        const then_block = kind._1;
        const else_block = kind._2;
        record_rvalue_scope_if_borrow_expr(visitor, then_block, blk_id);
        if (else_block !== undefined) {
          record_rvalue_scope_if_borrow_expr(visitor, else_block, blk_id);
        }
        break;
      }
      case "Match": {
        for (const arm of kind._1) {
          record_rvalue_scope_if_borrow_expr(visitor, arm.body, blk_id);
        }
        break;
      }
      case "Call": {
        const func = kind._0;
        const args = kind._1;
        // Recurse into tuple constructors, such as `Some(&temp())`.
        //
        // That way, there is no difference between `Some(..)` and `Some { 0: .. }`,
        // even though the former is syntactically a function call.
        if (func.kind.$ === "Path") {
          const path = func.kind._0;
          if (path.$ === "Resolved" && path._0 === undefined) {
            const res = path._1.res;
            if (res.$ === "SelfCtor" || (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn")) {
              for (const arg of args) {
                record_rvalue_scope_if_borrow_expr(visitor, arg, blk_id);
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
}

/// Applied to an expression `expr` if `expr` -- or something owned or partially owned by
/// `expr` -- is going to be indirectly referenced by a variable in a let statement. In that
/// case, the "temporary lifetime" of `expr` is extended to be the block enclosing the `let`
/// statement.
///
/// More formally, if `expr` matches the grammar `ET`, record the temporary scope of the matching
/// `<rvalue>` as `lifetime`:
///
/// ```text
///     ET = *ET
///        | ET[...]
///        | ET.f
///        | (ET)
///        | <rvalue>
/// ```
///
/// Note: ET is intended to match "rvalues or places based on rvalues".
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:698 record_subexpr_extended_temp_scopes
function record_subexpr_extended_temp_scopes(scope_tree: ScopeTree, expr: hir.Expr, lifetime: Scope | undefined): void {
  // Note: give all the expressions matching `ET` with the
  // extended temporary lifetime, not just the innermost rvalue,
  // because in MIR building if we must compile e.g., `*rvalue()`
  // into a temporary, we request the temporary scope of the
  // outer expression.

  scope_tree.record_extended_temp_scope(expr.hir_id.local_id, lifetime);

  const kind = expr.kind;
  switch (kind.$) {
    case "AddrOf":
      record_subexpr_extended_temp_scopes(scope_tree, kind._2, lifetime);
      break;
    case "Unary":
      if (kind._0 === "Deref") {
        record_subexpr_extended_temp_scopes(scope_tree, kind._1, lifetime);
      }
      break;
    case "Field":
    case "Index":
      record_subexpr_extended_temp_scopes(scope_tree, kind._0, lifetime);
      break;
    default:
      break;
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/check/region.rs:34 ScopeResolutionVisitor
// `impl<'tcx> ScopeResolutionVisitor<'tcx>` (region.rs:722) and its `Visitor` impl (:760) are the methods of the class
// below, in upstream order (PORTING §8). `type NestedFilter` keeps the default (`IgnoreNested`).
class ScopeResolutionVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    // The generated scope tree.
    public scope_tree: ScopeTree,
    public cx: Context,
    // PORT: `FxHashMap<hir::ItemLocalId, Option<Scope>>`: only inserted into and removed from (never iterated), so a
    // plain `Map` (`has` tells `Some(None)` from absent).
    public extended_super_lets: Map<ItemLocalId, Scope | undefined>,
  ) {
    super();
  }

  /// Records the current parent (if any) as the parent of `child_scope`.
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:724 record_child_scope
  record_child_scope(child_scope: Scope): void {
    const parent = this.cx.parent;
    this.scope_tree.record_scope_parent(child_scope, parent);
  }

  /// Records the current parent (if any) as the parent of `child_scope`,
  /// and sets `child_scope` as the new current parent.
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:731 enter_scope
  enter_scope(child_scope: Scope): void {
    this.record_child_scope(child_scope);
    this.cx.parent = child_scope;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:736 enter_node_scope_with_dtor
  enter_node_scope_with_dtor(id: ItemLocalId, terminating: boolean): void {
    // If node was previously marked as a terminating scope during the
    // recursive visit of its parent node in the HIR, then we need to
    // account for the destruction scope representing the scope of
    // the destructors that run immediately after it completes.
    if (terminating) {
      this.enter_scope(new Scope(id, ScopeData.Destruction));
    }
    this.enter_scope(new Scope(id, ScopeData.Node));
  }

  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:747 enter_body
  enter_body(hir_id: HirId, f: (this_: ScopeResolutionVisitor) => void): void {
    const outer_cx = copy_Context(this.cx);

    this.enter_scope(new Scope(hir_id.local_id, ScopeData.CallSite));
    this.enter_scope(new Scope(hir_id.local_id, ScopeData.Arguments));

    f(this);

    // Restore context we had at the start.
    this.cx = outer_cx;
  }

  // impl<'tcx> Visitor<'tcx> for ScopeResolutionVisitor<'tcx>

  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:761 visit_block
  override visit_block(b: hir.Block): undefined {
    resolve_block(this, b, false);
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:765 visit_body
  override visit_body(body: hir.Body): undefined {
    const body_id = body.id();
    const owner_id = this.tcx.hir_body_owner_def_id(body_id);

    // debug!(
    //     "visit_body(id={:?}, span={:?}, body.id={:?}, cx.parent={:?})",
    //     owner_id,
    //     self.tcx.sess.source_map().span_to_diagnostic_string(body.value.span),
    //     body_id,
    //     self.cx.parent
    // );

    this.enter_body(body.value.hir_id, (this_) => {
      if (hir.BodyOwnerKind.is_fn_or_closure(this_.tcx.hir_body_owner_kind(owner_id))) {
        // The arguments and `self` are parented to the fn.
        this_.cx.var_parent = this_.cx.parent;
        for (const param of body.params) {
          this_.visit_pat(param.pat);
        }

        // The body of the every fn is a root scope.
        resolve_expr(this_, body.value, true);
      } else {
        // All bodies have an outer temporary drop scope, but temporaries
        // and `super let` bindings in constant initializers may be extended
        // to have 'static lifetimes, using the same syntactical rules used
        // for `let` initializers.
        //
        // e.g., in `let x = &f();`, the temporary holding the result from
        // the `f()` call lives for the entirety of the surrounding block.
        //
        // Similarly, `const X: ... = &f();` would have the result of `f()`
        // live for `'static`, implying (if Drop restrictions on constants
        // ever get lifted) that the value *could* have a destructor, but
        // it'd get leaked instead of the destructor running during the
        // evaluation of `X` (if at all allowed by CTFE).
        //
        // However, `const Y: ... = g(&f());`, like `let y = g(&f());`,
        // would *not* let the `f()` temporary escape into an outer scope
        // (i.e., `'static`), which means that after `g` returns, it drops,
        // and all the associated destruction scope rules apply.
        this_.cx.var_parent = undefined;
        this_.enter_scope(new Scope(body.value.hir_id.local_id, ScopeData.Destruction));
        resolve_local(this_, undefined, body.value, "Regular");
      }
    });
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:816 visit_arm
  override visit_arm(a: hir.Arm): undefined {
    resolve_arm(this, a);
    return undefined;
  }
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:819 visit_pat
  override visit_pat(p: hir.Pat): undefined {
    resolve_pat(this, p);
    return undefined;
  }
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:822 visit_stmt
  override visit_stmt(s: hir.Stmt): undefined {
    resolve_stmt(this, s);
    return undefined;
  }
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:825 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    resolve_expr(this, ex, false);
    return undefined;
  }
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:828 visit_local
  override visit_local(l: hir.LetStmt): undefined {
    const let_kind: LetKind = l.super_ !== undefined ? "Super" : "Regular";
    resolve_local(this, l.pat, l.init, let_kind);
    return undefined;
  }
  // rustc: compiler/rustc_hir_analysis/src/check/region.rs:835 visit_inline_const
  override visit_inline_const(c: hir.ConstBlock): undefined {
    const body = this.tcx.hir_body(c.body);
    this.visit_body(body);
    return undefined;
  }
}

/// Per-body `region::ScopeTree`. The `DefId` should be the owner `DefId` for the body;
/// in the case of closures, this will be redirected to the enclosing function.
///
/// Performance: This is a query rather than a simple function to enable
/// re-use in incremental scenarios. We may sometimes need to rerun the
/// type checker even when the HIR hasn't changed, and in those cases
/// we can avoid reconstructing the region scope tree.
// rustc: compiler/rustc_hir_analysis/src/check/region.rs:848 region_scope_tree
export function region_scope_tree(tcx: TyCtxt, def_id: LocalDefId): ScopeTree {
  const typeck_root_def_id = tcx.typeck_root_def_id_local(def_id);
  if (typeck_root_def_id !== def_id) {
    return tcx.region_scope_tree(typeck_root_def_id) as ScopeTree;
  }

  let scope_tree: ScopeTree;
  const body = tcx.hir_maybe_body_owned_by(def_id);
  if (body !== undefined) {
    const visitor = new ScopeResolutionVisitor(tcx, ScopeTree.default_(), { parent: undefined, var_parent: undefined }, new Map());

    visitor.scope_tree.root_body = body.value.hir_id;
    visitor.visit_body(body);
    scope_tree = visitor.scope_tree;
  } else {
    scope_tree = ScopeTree.default_();
  }

  // `tcx.arena.alloc(scope_tree)`
  return scope_tree;
}
