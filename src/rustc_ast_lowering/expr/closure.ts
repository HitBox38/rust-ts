// Port of compiler/rustc_ast_lowering/src/expr/closure.rs
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//
// PORT: arenas are erased and closures `|this| ..` are `(this_) => ..`, as in ../expr.ts.
import {
  type CaptureBy,
  type Closure,
  type ClosureBinder,
  clone_Param,
  type Const,
  type CoroutineMarker,
  type Expr,
  FnDecl,
  type GenericParam,
  type Movability,
  type NodeId,
} from "../../rustc_ast/lib.ts";
import { type Attribute as HirAttribute, find_attr } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import type { Diagnostic } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { panic } from "../../std/panic.ts";
import { LoweringContext } from "../decls.ts";
import * as diagnostics from "../diagnostics.ts";
import type { MoveExprState } from "../expr.ts";

// PORT(gen): pending root, as in ../expr.ts: the generator's signatures of the diagnostic structs this file
// emits (diagnostics.gen.ts, codegen set rustc_ast_lowering). Delete once diagnostics.ts re-exports it.
declare module "../diagnostics.ts" {
  export function ClosureCannotBeStatic_diagnostic(self: { fn_decl_span: Span }): Diagnostic;
  export function CoroutineTooManyParameters_diagnostic(self: { fn_decl_span: Span }): Diagnostic;
}

// Entry point for `ExprKind::Closure`. Plain closures go through
// `lower_expr_plain_closure_with_move_exprs`, which can wrap the lowered
// closure in `let` initializers for `move(...)`. Coroutine closures use the
// same wrapper after building their coroutine-specific body shape.
// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:17 lower_expr_closure_expr
LoweringContext.prototype.lower_expr_closure_expr = function (this: LoweringContext, e: Expr, closure: Closure): hir.Expr {
  const expr_hir_id = this.lower_node_id(e.id);
  const attrs = this.lower_attrs(expr_hir_id, e.attrs, e.span, Target.from_expr(e));

  const coroutine_marker = closure.coroutine_marker;
  if (coroutine_marker !== undefined) {
    return this.lower_expr_coroutine_closure_with_move_exprs(
      expr_hir_id,
      attrs,
      closure.binder,
      closure.capture_clause,
      e.id,
      coroutine_marker,
      closure.constness,
      closure.fn_decl,
      closure.body,
      closure.fn_decl_span,
      closure.fn_arg_span,
      e.span,
    );
  } else {
    return this.lower_expr_plain_closure_with_move_exprs(
      expr_hir_id,
      attrs,
      closure.binder,
      closure.capture_clause,
      e.id,
      closure.constness,
      closure.movability,
      closure.fn_decl,
      closure.body,
      closure.fn_decl_span,
      closure.fn_arg_span,
      e.span,
    );
  }
};

// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:57 lower_expr_coroutine_closure_with_move_exprs
LoweringContext.prototype.lower_expr_coroutine_closure_with_move_exprs = function (
  this: LoweringContext,
  expr_hir_id: HirId,
  attrs: readonly HirAttribute[],
  binder: ClosureBinder,
  capture_clause: CaptureBy,
  closure_id: NodeId,
  coroutine_marker: CoroutineMarker,
  constness: Const,
  decl: FnDecl,
  body: Expr,
  fn_decl_span: Span,
  fn_arg_span: Span,
  whole_span: Span,
): hir.Expr {
  const [kind, move_expr_state] = this.with_move_expr_bindings({ occurrences: [] }, (this_) =>
    this_.lower_expr_coroutine_closure(
      binder,
      capture_clause,
      closure_id,
      expr_hir_id,
      coroutine_marker,
      constness,
      decl,
      body,
      fn_decl_span,
      fn_arg_span,
      attrs,
    ),
  );
  if (move_expr_state === undefined) {
    span_bug(fn_decl_span, "coroutine closure lowering did not return `move(...)` state");
  }
  const closure_expr = new hir.Expr(expr_hir_id, kind, this.lower_span(whole_span));

  return this.lower_expr_with_move_exprs(closure_expr, move_expr_state, body, whole_span);
};

/// Lowers a plain closure expression and wraps it in an outer block if the
/// closure body used `move(...)`.
///
/// The lowering is split this way because `move(...)` initializers must be
/// evaluated before the closure is created, but the closure body must still
/// lower each `move(...)` occurrence as a use of the synthetic local that
/// will be introduced by that outer block. For example,
/// `|| move(foo.clone()).len()` becomes roughly:
///
/// ```ignore (illustrative)
/// {
///     let __move_expr_0 = foo.clone();
///     || __move_expr_0.len()
/// }
/// ```
///
/// If the initializer contains another `move(...)`, it is lowered after
/// this closure's state is popped and therefore belongs to the immediately
/// enclosing closure-like body.
// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:116 lower_expr_plain_closure_with_move_exprs
LoweringContext.prototype.lower_expr_plain_closure_with_move_exprs = function (
  this: LoweringContext,
  expr_hir_id: HirId,
  attrs: readonly HirAttribute[],
  binder: ClosureBinder,
  capture_clause: CaptureBy,
  closure_id: NodeId,
  constness: Const,
  movability: Movability,
  decl: FnDecl,
  body: Expr,
  fn_decl_span: Span,
  fn_arg_span: Span,
  whole_span: Span,
): hir.Expr {
  const [closure_kind, move_expr_state] = this.lower_expr_closure(
    attrs,
    binder,
    capture_clause,
    closure_id,
    expr_hir_id,
    constness,
    movability,
    decl,
    body,
    fn_decl_span,
    fn_arg_span,
  );

  const closure_expr = new hir.Expr(expr_hir_id, closure_kind, this.lower_span(whole_span));

  return this.lower_expr_with_move_exprs(closure_expr, move_expr_state, body, whole_span);
};

// Lowers the actual plain closure node and body. The body is lowered while a
// `MoveExprState` is active, so `move(...)` occurrences become synthetic
// local uses and the caller can later add the matching initializers.
// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:157 lower_expr_closure
LoweringContext.prototype.lower_expr_closure = function (
  this: LoweringContext,
  attrs: readonly HirAttribute[],
  binder: ClosureBinder,
  capture_clause: CaptureBy,
  closure_id: NodeId,
  closure_hir_id: HirId,
  constness: Const,
  movability: Movability,
  decl: FnDecl,
  body: Expr,
  fn_decl_span: Span,
  fn_arg_span: Span,
): [hir.ExprKind, MoveExprState] {
  const closure_def_id = this.local_def_id(closure_id);
  const [binder_clause, generic_params] = this.lower_closure_binder(binder);

  const [[body_id, closure_kind], move_expr_state] = this.with_new_scopes(fn_decl_span, (this_) => {
    let coroutine_kind = find_attr(attrs, (k): hir.CoroutineKind | undefined =>
      k.$ === "Coroutine" ? { $: "Coroutine", _0: "Movable" } : undefined,
    );

    return this_.with_move_expr_bindings({ occurrences: [] }, (this_): [hir.BodyId, hir.ClosureKind] => {
      // FIXME(contracts): Support contracts on closures?
      const body_id = this_.lower_fn_body(decl, undefined, (this_) => {
        this_.coroutine_kind = coroutine_kind;
        const e = this_.lower_expr_mut(body);
        coroutine_kind = this_.coroutine_kind;
        return e;
      });
      const coroutine_option = this_.closure_movability_for_fn(decl, fn_decl_span, coroutine_kind, movability);
      return [body_id, coroutine_option];
    });
  });
  if (move_expr_state === undefined) {
    span_bug(fn_decl_span, "plain closure lowering did not return `move(...)` state");
  }
  const explicit_captures: readonly hir.ExplicitCapture[] = move_expr_state.occurrences.map(
    (occurrence): hir.ExplicitCapture => ({ var_hir_id: occurrence.binding }),
  );

  const bound_generic_params = this.lower_lifetime_binder(closure_id, generic_params);
  // Lower outside new scope to preserve `is_in_loop_condition`.
  const fn_decl = this.lower_fn_decl(decl, closure_id, closure_hir_id, "Closure", undefined, "No");

  const c: hir.Closure = {
    def_id: closure_def_id,
    binder: binder_clause,
    capture_clause: this.lower_capture_clause(capture_clause),
    bound_generic_params,
    fn_decl,
    body: body_id,
    fn_decl_span: this.lower_span(fn_decl_span),
    fn_arg_span: this.lower_span(fn_arg_span),
    kind: closure_kind,
    constness: this.lower_constness(attrs, constness),
    explicit_captures,
  };

  return [{ $: "Closure", _0: c }, move_expr_state];
};

// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:236 closure_movability_for_fn
LoweringContext.prototype.closure_movability_for_fn = function (
  this: LoweringContext,
  decl: FnDecl,
  fn_decl_span: Span,
  coroutine_kind: hir.CoroutineKind | undefined,
  movability: Movability,
): hir.ClosureKind {
  if (coroutine_kind !== undefined && coroutine_kind.$ === "Coroutine") {
    if (decl.inputs.length > 1) {
      this.dcx().emit_err(diagnostics.CoroutineTooManyParameters_diagnostic({ fn_decl_span }));
    }
    return { $: "Coroutine", _0: { $: "Coroutine", _0: movability } };
  } else if (coroutine_kind !== undefined) {
    // Some(Desugared(Gen | Async | AsyncGen, _))
    panic("non-`async`/`gen` closure body turned `async`/`gen` during lowering");
  } else {
    if (movability === "Static") {
      this.dcx().emit_err(diagnostics.ClosureCannotBeStatic_diagnostic({ fn_decl_span }));
    }
    return hir.ClosureKind.Closure;
  }
};

// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:266 lower_closure_binder
LoweringContext.prototype.lower_closure_binder = function (
  this: LoweringContext,
  binder_: ClosureBinder,
): [hir.ClosureBinder, readonly GenericParam[]] {
  let binder: hir.ClosureBinder;
  let params: readonly GenericParam[];
  switch (binder_.$) {
    case "NotPresent":
      [binder, params] = [hir.ClosureBinder.Default, []];
      break;
    case "For": {
      const span = this.lower_span(binder_.span);
      [binder, params] = [{ $: "For", span }, binder_.generic_params];
      break;
    }
  }

  return [binder, params];
};

// Coroutine closures are lowered separately because they build a different
// body shape. The source body is lowered with the caller's `MoveExprState`
// active, so `move(...)` occurrences are collected and hoisted into a block
// around the outer closure expression.
// rustc: compiler/rustc_ast_lowering/src/expr/closure.rs:285 lower_expr_coroutine_closure
LoweringContext.prototype.lower_expr_coroutine_closure = function (
  this: LoweringContext,
  binder: ClosureBinder,
  capture_clause: CaptureBy,
  closure_id: NodeId,
  closure_hir_id: HirId,
  coroutine_marker: CoroutineMarker,
  constness: Const,
  decl: FnDecl,
  body: Expr,
  fn_decl_span: Span,
  fn_arg_span: Span,
  attrs: readonly HirAttribute[],
): hir.ExprKind {
  const closure_def_id = this.local_def_id(closure_id);
  const [binder_clause, generic_params] = this.lower_closure_binder(binder);

  let coroutine_desugaring: hir.CoroutineDesugaring;
  switch (coroutine_marker.kind) {
    case "Async":
      coroutine_desugaring = hir.CoroutineDesugaring.Async;
      break;
    case "Gen":
      coroutine_desugaring = hir.CoroutineDesugaring.Gen;
      break;
    case "AsyncGen":
      span_bug(coroutine_marker.span, "only async closures and `iter!` closures are supported currently");
  }

  const body_ = this.with_new_scopes(fn_decl_span, (this_) => {
    const inner_decl = new FnDecl(decl.inputs.map(clone_Param), { $: "Default", _0: fn_decl_span });

    // Transform `async |x: u8| -> X { ... }` into
    // `|x: u8| || -> X { ... }`.
    const body_id = this_.lower_body((this_) => {
      const [parameters, expr] = this_.lower_coroutine_body_with_moved_arguments(
        inner_decl,
        (this_) => this_.with_new_scopes(fn_decl_span, (this_) => this_.lower_expr_mut(body)),
        fn_decl_span,
        body.span,
        coroutine_marker,
        hir.CoroutineSource.Closure,
      );

      this_.maybe_forward_track_caller(closure_hir_id, expr.hir_id);

      return [parameters, expr];
    });
    return body_id;
  });

  const bound_generic_params = this.lower_lifetime_binder(closure_id, generic_params);
  // We need to lower the declaration outside the new scope, because we
  // have to conserve the state of being inside a loop condition for the
  // closure argument types.
  const fn_decl = this.lower_fn_decl(decl, closure_id, closure_hir_id, "Closure", undefined, "No");

  if (constness.$ === "Yes") {
    const span = constness._0;
    this.dcx().span_err(span, "const coroutines are not supported");
  }

  const last = this.move_expr_bindings.length > 0 ? this.move_expr_bindings[this.move_expr_bindings.length - 1] : undefined;
  const explicit_captures: readonly hir.ExplicitCapture[] = (last !== undefined ? last.occurrences : []).map(
    (occurrence): hir.ExplicitCapture => ({ var_hir_id: occurrence.binding }),
  );

  const c: hir.Closure = {
    def_id: closure_def_id,
    binder: binder_clause,
    capture_clause: this.lower_capture_clause(capture_clause),
    bound_generic_params,
    fn_decl,
    body: body_,
    fn_decl_span: this.lower_span(fn_decl_span),
    fn_arg_span: this.lower_span(fn_arg_span),
    // Lower this as a `CoroutineClosure`. That will ensure that HIR typeck
    // knows that a `FnDecl` output type like `-> &str` actually means
    // "coroutine that returns &str", rather than directly returning a `&str`.
    kind: { $: "CoroutineClosure", _0: coroutine_desugaring },
    constness: this.lower_constness(attrs, constness),
    explicit_captures,
  };
  return { $: "Closure", _0: c };
};
