// Port of compiler/rustc_ast_lowering/src/expr.rs
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//
// PORT: arenas are erased (contract, "How to fill a stub" 7): `self.arena.alloc(x)` is `x`,
// `alloc_from_iter` / `arena_vec!` build a fresh array. Copies of `Copy` HIR values are identity
// (no HIR MutVisitor; hir-visit decision); AST values cloned upstream (`.clone()`) are `clone_<T>`.
// PORT: closures `|this| ..` are `(this_) => ..` (`this` is reserved). A Rust `let x = ..x..` that shadows a
// binding of the same scope (a parameter, or a destructured field) gets a trailing `_` on one of the two
// names (`head_`, `kind_`, `rest_`); `let`-else / `if let` chains are early returns or nested `if`s.
import {
  type AngleBracketedArg,
  type AnonConst,
  type Arm,
  type AssignOp,
  AttrStyle,
  type Attribute,
  attr,
  type BinOp,
  BindingMode,
  type Block,
  type CaptureBy,
  clone_Expr,
  Expr,
  type ExprField,
  type ForLoopKind,
  type Item,
  type Label,
  LitKind,
  type NodeId,
  type Pat,
  type Path,
  type QSelf,
  type RangeLimits,
  StrStyle,
  type Ty,
  token,
  type UnOp,
  visit,
  YieldKind,
} from "../rustc_ast/lib.ts";
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { type Attribute as HirAttribute, LangItem } from "../rustc_attr_ir/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { msg } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { feature_err, report_lit_error } from "../rustc_session/diagnostics.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { debug_Span, DUMMY_SP, type ErrorGuaranteed, respan, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { type ByteSymbol, Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { LoweringContext } from "./decls.ts";
import * as diagnostics from "./diagnostics.ts";
// PORT (init order): read inside function bodies only.
import {
  ALLOW_ASYNC_GEN,
  ALLOW_FOR_AWAIT,
  ALLOW_TRY_TRAIT,
  ResolverAstLowering_legacy_const_generic_args,
} from "./lib.ts";

// mod closure;
import "./expr/closure.ts";

/** `impl Index for HashMap`: `map[&key]` (std `HashMap`'s message on a missing key). */
function map_index<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) panic("no entry found for key");
  return v as V;
}

// The data types of expr.rs (`MoveExprInitializer`, `MoveExprState`, `MoveExprOccurrence`, `FutureKind`) come from
// expr.gen.ts. `WillCreateDefIdsVisitor` and `MoveExprInitializerFinder` implement `Visitor`: they are hand classes
// extending the rustc_ast `Visitor` base class (as rustc_resolve's visitors), listed under `hand` in the codegen set.
export * from "./expr.gen.ts";
import { FutureKind, type MoveExprInitializer, type MoveExprState } from "./expr.gen.ts";
import type { TryBlockScope } from "./lib.ts";

// rustc-type: compiler/rustc_ast_lowering/src/expr.rs:34 WillCreateDefIdsVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type).
export class WillCreateDefIdsVisitor extends visit.Visitor<ControlFlow<Span>> {
  override Result = VisitorResult.ControlFlow<Span>();

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:93 visit_anon_const
  override visit_anon_const(c: AnonConst): ControlFlow<Span> {
    return ControlFlow.Break(c.value.span);
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:97 visit_item
  override visit_item(item: Item): ControlFlow<Span> {
    return ControlFlow.Break(item.span);
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:101 visit_expr
  override visit_expr(ex: Expr): ControlFlow<Span> {
    switch (ex.kind.$) {
      case "Gen":
      case "ConstBlock":
      case "Closure":
        return ControlFlow.Break(ex.span);
      default:
        return visit.walk_expr(this, ex);
    }
  }
}

// (expr.rs:37..50 `MoveExprInitializer`, `MoveExprState`, `MoveExprOccurrence`: expr.gen.ts)

// rustc-type: compiler/rustc_ast_lowering/src/expr.rs:57 MoveExprInitializerFinder
/// Looks up the initializer expression for each `move(...)` occurrence.
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type).
export class MoveExprInitializerFinder extends visit.Visitor {
  constructor(public initializers: MoveExprInitializer[]) {
    super();
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:62 collect
  static collect(expr: Expr): MoveExprInitializer[] {
    const this_ = new MoveExprInitializerFinder([]);
    this_.visit_expr(expr);
    return this_.initializers;
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:68 collect_block
  static collect_block(block: Block): MoveExprInitializer[] {
    const this_ = new MoveExprInitializerFinder([]);
    this_.visit_block(block);
    return this_.initializers;
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:76 visit_expr
  override visit_expr(expr: Expr): undefined {
    const kind = expr.kind;
    switch (kind.$) {
      case "Move": {
        const inner = kind._0;
        this.visit_expr(inner);
        this.initializers.push({ id: expr.id, expr: inner });
        break;
      }
      case "ConstBlock":
        break;
      default:
        visit.walk_expr(this, expr);
    }
    return undefined;
  }

  // rustc: compiler/rustc_ast_lowering/src/expr.rs:87 visit_item
  override visit_item(_: Item): undefined {
    return undefined;
  }
}

// rustc: compiler/rustc_ast_lowering/src/expr.rs:112 with_move_expr_bindings
LoweringContext.prototype.with_move_expr_bindings = function <T>(
  this: LoweringContext,
  state: MoveExprState | undefined,
  f: (this_: LoweringContext) => T,
): [T, MoveExprState | undefined] {
  this.move_expr_bindings.push(state);
  const result = f(this);
  if (this.move_expr_bindings.length === 0) {
    span_bug(DUMMY_SP, "`move_expr_bindings` stack was empty after lowering");
  }
  const state_ = this.move_expr_bindings.pop();
  return [result, state_];
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:125 with_move_expr_initializer
LoweringContext.prototype.with_move_expr_initializer = function <T>(this: LoweringContext, f: (this_: LoweringContext) => T): T {
  const old = this.lowering_move_expr_initializer;
  this.lowering_move_expr_initializer = true;
  const result = f(this);
  this.lowering_move_expr_initializer = old;
  return result;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:133 record_move_expr
LoweringContext.prototype.record_move_expr = function (this: LoweringContext, id: NodeId, inner: Expr, move_kw_span: Span): [Ident, HirId] {
  const last = this.move_expr_bindings.length > 0 ? this.move_expr_bindings[this.move_expr_bindings.length - 1] : undefined;
  const index = last !== undefined ? last.occurrences.length : 0;
  const ident = Ident.from_str_and_span(`__move_expr_${index}`, move_kw_span);
  const [pat, binding] = this.pat_ident(inner.span, ident);
  const state = this.move_expr_bindings.length > 0 ? this.move_expr_bindings[this.move_expr_bindings.length - 1] : undefined;
  if (state === undefined) {
    span_bug(move_kw_span, "`move(...)` lowered without a closure-like body state");
  }
  state.occurrences.push({ id, pat, binding });
  return [ident, binding];
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:149 lower_expr_with_move_exprs
LoweringContext.prototype.lower_expr_with_move_exprs = function (
  this: LoweringContext,
  expr: hir.Expr,
  move_expr_state: MoveExprState,
  body: Expr,
  whole_span: Span,
): hir.Expr {
  const initializers = MoveExprInitializerFinder.collect(body);
  return this.lower_expr_with_move_expr_initializers(expr, move_expr_state, initializers, whole_span);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:160 lower_expr_with_move_exprs_in_block
LoweringContext.prototype.lower_expr_with_move_exprs_in_block = function (
  this: LoweringContext,
  expr: hir.Expr,
  move_expr_state: MoveExprState,
  body: Block,
  whole_span: Span,
): hir.Expr {
  const initializers = MoveExprInitializerFinder.collect_block(body);
  return this.lower_expr_with_move_expr_initializers(expr, move_expr_state, initializers, whole_span);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:171 lower_expr_with_move_expr_initializers
LoweringContext.prototype.lower_expr_with_move_expr_initializers = function (
  this: LoweringContext,
  expr: hir.Expr,
  move_expr_state: MoveExprState,
  initializers_: MoveExprInitializer[],
  whole_span: Span,
): hir.Expr {
  if (move_expr_state.occurrences.length === 0) {
    return expr;
  }

  // PORT: `NodeMap` (FxHashMap) keyed by `NodeId`; only indexed, so iteration order is irrelevant.
  const initializers = new Map<NodeId, Expr>(initializers_.map((initializer) => [initializer.id, initializer.expr]));
  const stmts: hir.Stmt[] = [];
  for (const occurrence of move_expr_state.occurrences) {
    // Evaluate the expression inside `move(...)` before creating the
    // closure/coroutine and store it in a synthetic local:
    // `|| move(foo).bar` becomes roughly
    // `let __move_expr_0 = foo; || __move_expr_0.bar`.
    const expr = map_index(initializers, occurrence.id);
    // This state has already been popped, so a nested `move(...)` in
    // the initializer is recorded by the immediately enclosing
    // closure-like body instead of this one.
    const init = this.with_move_expr_initializer((this_) => this_.lower_expr(expr));
    stmts.push(this.stmt_let_pat(undefined, expr.span, init, occurrence.pat, hir.LocalSource.Normal));
  }

  const block = this.block_all(whole_span, stmts, expr);
  return this.expr(whole_span, { $: "Block", _0: block, _1: undefined });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:211 lower_exprs
LoweringContext.prototype.lower_exprs = function (this: LoweringContext, exprs: readonly Expr[]): readonly hir.Expr[] {
  return exprs.map((x) => this.lower_expr_mut(x));
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:215 lower_expr
LoweringContext.prototype.lower_expr = function (this: LoweringContext, e: Expr): hir.Expr {
  return this.lower_expr_mut(e);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:219 lower_expr_mut
LoweringContext.prototype.lower_expr_mut = function (this: LoweringContext, e: Expr): hir.Expr {
  let span = this.lower_span(e.span);
  const k0 = e.kind;
  switch (k0.$) {
    // Parenthesis expression does not have a HirId and is handled specially.
    case "Paren": {
      const ex = this.lower_expr_mut(k0._0);
      // Include parens in span, but only if it is a super-span.
      if (Span.contains(e.span, ex.span)) {
        ex.span = this.lower_span(Span.with_ctxt(e.span, Span.ctxt(ex.span)));
      }
      // Merge attributes into the inner expression.
      if (e.attrs.length !== 0) {
        const old_attrs = this.curr_owner.attrs.get(ex.hir_id.local_id) ?? [];
        const new_attrs_ = [
          ...this.lower_attrs_vec(e.attrs, e.span, ex.hir_id, Target.from_expr(e), undefined),
          ...old_attrs,
        ];
        const new_attrs: readonly HirAttribute[] = new_attrs_;
        if (new_attrs.length === 0) {
          return ex;
        }
        this.curr_owner.attrs.insert(ex.hir_id.local_id, new_attrs);
      }
      return ex;
    }
    // Desugar `ExprForLoop`
    // from: `[opt_ident]: for await? <pat> in <iter> <body>`
    //
    // This also needs special handling because the HirId of the returned `hir::Expr` will not
    // correspond to the `e.id`, so `lower_expr_for` handles attribute lowering itself.
    case "ForLoop": {
      const { pat, iter, body, label, kind } = k0._0;
      return this.lower_expr_for(e, pat, iter, body, label, kind);
    }
    case "Closure":
      return this.lower_expr_closure_expr(e, k0._0);
    default:
      break;
  }

  const expr_hir_id = this.lower_node_id(e.id);
  this.lower_attrs(expr_hir_id, e.attrs, e.span, Target.from_expr(e));

  let kind: hir.ExprKind;
  const k = e.kind;
  switch (k.$) {
    case "Array":
      kind = { $: "Array", _0: this.lower_exprs(k._0) };
      break;
    case "ConstBlock":
      kind = { $: "ConstBlock", _0: this.lower_const_block(k._0) };
      break;
    case "Repeat": {
      const expr = this.lower_expr(k._0);
      const count = this.lower_array_length_to_const_arg(k._1);
      kind = { $: "Repeat", _0: expr, _1: count };
      break;
    }
    case "Tup":
      kind = { $: "Tup", _0: this.lower_exprs(k._0) };
      break;
    case "Call": {
      const f = k._0;
      const args = k._1;
      const legacy_args = ResolverAstLowering_legacy_const_generic_args(this.resolver, f, this.tcx);
      if (legacy_args !== undefined) {
        kind = this.lower_legacy_const_generics(clone_Expr(f), args.map(clone_Expr), legacy_args);
      } else {
        const f_ = this.lower_expr(f);
        kind = { $: "Call", _0: f_, _1: this.lower_exprs(args) };
      }
      break;
    }
    case "MethodCall": {
      const mc = k._0;
      const hir_seg = this.lower_path_segment(
        e.span,
        mc.seg,
        "Optional",
        "Err",
        { $: "Disallowed", _0: "Path" },
        // Method calls can't have bound modifiers
        undefined,
      );
      const receiver = this.lower_expr(mc.receiver);
      const args = mc.args.map((x) => this.lower_expr_mut(x));
      kind = { $: "MethodCall", _0: hir_seg, _1: receiver, _2: args, _3: this.lower_span(mc.span) };
      break;
    }
    case "Binary": {
      const binop = this.lower_binop(k._0);
      const lhs = this.lower_expr(k._1);
      const rhs = this.lower_expr(k._2);
      kind = { $: "Binary", _0: binop, _1: lhs, _2: rhs };
      break;
    }
    case "Unary": {
      const op = this.lower_unop(k._0);
      const ohs = this.lower_expr(k._1);
      kind = { $: "Unary", _0: op, _1: ohs };
      break;
    }
    case "Lit":
      kind = { $: "Lit", _0: this.lower_lit(k._0, e.span) };
      break;
    case "IncludedBytes": {
      const lit = respan<LitKind>(this.lower_span(e.span), { $: "ByteStr", _0: k._0, _1: StrStyle.Cooked });
      kind = { $: "Lit", _0: lit };
      break;
    }
    case "Cast": {
      const expr = this.lower_expr(k._0);
      const ty = this.lower_ty_alloc(k._1, { $: "Disallowed", _0: "Cast" });
      kind = { $: "Cast", _0: expr, _1: ty };
      break;
    }
    case "Type": {
      const expr = this.lower_expr(k._0);
      const ty = this.lower_ty_alloc(k._1, { $: "Disallowed", _0: "Cast" });
      kind = { $: "Type", _0: expr, _1: ty };
      break;
    }
    case "AddrOf": {
      const ohs = this.lower_expr(k._2);
      kind = { $: "AddrOf", _0: k._0, _1: k._1, _2: ohs };
      break;
    }
    case "Let": {
      const [pat, scrutinee, span_, recovered] = [k._0, k._1, k._2, k._3];
      kind = {
        $: "Let",
        _0: {
          span: this.lower_span(span_),
          pat: this.lower_pat(pat),
          ty: undefined,
          init: this.lower_expr(scrutinee),
          recovered: recovered,
        },
      };
      break;
    }
    case "If":
      kind = this.lower_expr_if(k._0, k._1, k._2);
      break;
    case "While": {
      const [cond, body, opt_label] = [k._0, k._1, k._2];
      kind = this.with_loop_scope(expr_hir_id, (this_) => {
        const span = this_.mark_span_with_reason(DesugaringKind.WhileLoop, e.span, undefined);
        const opt_label_ = this_.lower_label(opt_label, e.id, expr_hir_id);
        return this_.lower_expr_while_in_loop_scope(span, cond, body, opt_label_);
      });
      break;
    }
    case "Loop": {
      const [body, opt_label, span_] = [k._0, k._1, k._2];
      kind = this.with_loop_scope(expr_hir_id, (this_): hir.ExprKind => {
        const opt_label_ = this_.lower_label(opt_label, e.id, expr_hir_id);
        return { $: "Loop", _0: this_.lower_block(body, false), _1: opt_label_, _2: hir.LoopSource.Loop, _3: this_.lower_span(span_) };
      });
      break;
    }
    case "TryBlock":
      kind = this.lower_expr_try_block(k._0, k._1);
      break;
    case "Match": {
      const [expr, arms, match_kind] = [k._0, k._1, k._2];
      let source: hir.MatchSource;
      switch (match_kind) {
        case "Prefix":
          source = hir.MatchSource.Normal;
          break;
        case "Postfix":
          source = hir.MatchSource.Postfix;
          break;
      }
      kind = { $: "Match", _0: this.lower_expr(expr), _1: arms.map((x) => this.lower_arm(x)), _2: source };
      break;
    }
    case "Await":
      kind = this.lower_expr_await(k._1, k._0);
      break;
    case "Move": {
      const [inner, move_kw_span] = [k._0, k._1];
      if (!this.tcx.features().move_expr()) {
        return this.expr_err(move_kw_span, unwrap(this.dcx().has_errors()));
      }
      if (this.move_expr_bindings.length > 0 && this.move_expr_bindings[this.move_expr_bindings.length - 1] !== undefined) {
        const [ident, binding] = this.record_move_expr(e.id, inner, move_kw_span);
        const path_span = this.lower_span(e.span);
        const res: hir.def.Res = { $: "Local", _0: binding };
        const segment = hir.PathSegment.new(this.lower_ident(ident), this.next_id(), { $: "Local", _0: binding });
        kind = { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new hir.Path(path_span, res, [segment]) } };
      } else if (this.lowering_move_expr_initializer && this.move_expr_bindings.length === 0) {
        const guar = this.dcx().emit_err(diagnostics.NestedMoveExprWithoutEnclosingContext_diagnostic({ span: move_kw_span }));
        kind = { $: "Err", _0: guar };
      } else {
        const guar = this.dcx().emit_err(diagnostics.MoveExprOnlyInSupportedContexts_diagnostic({ span: move_kw_span }));
        kind = { $: "Err", _0: guar };
      }
      break;
    }
    case "Use":
      kind = this.lower_expr_use(k._1, k._0);
      break;
    case "Gen": {
      const [capture_clause, block, coroutine_kind, decl_span] = [k._0, k._1, k._2, k._3];
      let desugaring_kind: hir.CoroutineDesugaring;
      switch (coroutine_kind) {
        case "Async":
          desugaring_kind = hir.CoroutineDesugaring.Async;
          break;
        case "Gen":
          desugaring_kind = hir.CoroutineDesugaring.Gen;
          break;
        case "AsyncGen":
          desugaring_kind = hir.CoroutineDesugaring.AsyncGen;
          break;
      }
      const [kind_, move_expr_state] = this.with_move_expr_bindings({ occurrences: [] }, (this_) =>
        this_.make_desugared_coroutine_expr(
          capture_clause,
          e.id,
          undefined,
          decl_span,
          e.span,
          desugaring_kind,
          hir.CoroutineSource.Block,
          (this_) => this_.with_new_scopes(e.span, (this_) => this_.lower_block_expr(block)),
        ),
      );
      if (move_expr_state === undefined) {
        span_bug(decl_span, "coroutine block lowering did not return `move(...)` state");
      }
      const expr = new hir.Expr(expr_hir_id, kind_, span);
      return this.lower_expr_with_move_exprs_in_block(expr, move_expr_state, block, e.span);
    }
    case "Block": {
      const [blk, opt_label] = [k._0, k._1];
      // Different from loops, label of block resolves to block id rather than
      // expr node id.
      const block_hir_id = this.lower_node_id(blk.id);
      const opt_label_ = this.lower_label(opt_label, blk.id, block_hir_id);
      const hir_block = this.lower_block_noalloc(block_hir_id, blk, opt_label_ !== undefined);
      kind = { $: "Block", _0: hir_block, _1: opt_label_ };
      break;
    }
    case "Assign":
      kind = this.lower_expr_assign(k._0, k._1, k._2, e.span);
      break;
    case "AssignOp":
      kind = { $: "AssignOp", _0: this.lower_assign_op(k._0), _1: this.lower_expr(k._1), _2: this.lower_expr(k._2) };
      break;
    case "Field":
      kind = { $: "Field", _0: this.lower_expr(k._0), _1: this.lower_ident(k._1) };
      break;
    case "Index":
      kind = { $: "Index", _0: this.lower_expr(k._0), _1: this.lower_expr(k._1), _2: this.lower_span(k._2) };
      break;
    case "Range":
      span = this.mark_span_with_reason(DesugaringKind.RangeExpr, span, undefined);
      kind = this.lower_expr_range(span, k._0, k._1, k._2);
      break;
    case "Underscore": {
      const guar = this.dcx().emit_err(diagnostics.UnderscoreExprLhsAssign_diagnostic({ span: e.span }));
      kind = { $: "Err", _0: guar };
      break;
    }
    case "Path": {
      const qpath = this.lower_qpath(e.id, k._0, k._1, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined);
      kind = { $: "Path", _0: qpath };
      break;
    }
    case "Break": {
      const opt_expr = k._1 !== undefined ? this.lower_expr(k._1) : undefined;
      kind = { $: "Break", _0: this.lower_jump_destination(e.id, k._0), _1: opt_expr };
      break;
    }
    case "Continue":
      kind = { $: "Continue", _0: this.lower_jump_destination(e.id, k._0) };
      break;
    case "Ret": {
      const e_ = k._0;
      const expr = e_ !== undefined ? this.lower_expr(e_) : undefined;
      kind = this.checked_return(expr);
      break;
    }
    case "Yeet":
      kind = this.lower_expr_yeet(e.span, k._0);
      break;
    case "Become": {
      const sub_expr = this.lower_expr(k._0);
      kind = { $: "Become", _0: sub_expr };
      break;
    }
    case "InlineAsm":
      kind = { $: "InlineAsm", _0: this.lower_inline_asm(e.span, k._0) };
      break;
    case "FormatArgs":
      kind = this.lower_format_args(e.span, k._0);
      break;
    case "OffsetOf":
      kind = {
        $: "OffsetOf",
        _0: this.lower_ty_alloc(k._0, { $: "Disallowed", _0: "OffsetOf" }),
        _1: k._1.map((ident) => this.lower_ident(ident)),
      };
      break;
    case "Struct": {
      const se = k._0;
      let rest: hir.StructTailExpr;
      const se_rest = se.rest;
      switch (se_rest.$) {
        case "Base":
          rest = { $: "Base", _0: this.lower_expr(se_rest._0) };
          break;
        case "Rest":
          rest = { $: "DefaultFields", _0: this.lower_span(se_rest._0) };
          break;
        case "None":
          rest = hir.StructTailExpr.None;
          break;
        case "NoneWithError":
          rest = { $: "NoneWithError", _0: se_rest._0 };
          break;
      }
      kind = {
        $: "Struct",
        _0: this.lower_qpath(e.id, se.qself, se.path, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined),
        _1: se.fields.map((x) => this.lower_expr_field(x)),
        _2: rest,
      };
      break;
    }
    case "Yield":
      kind = this.lower_expr_yield(e.span, YieldKind.expr(k._0));
      break;
    case "Err":
      kind = { $: "Err", _0: k._0 };
      break;

    case "UnsafeBinderCast":
      kind = {
        $: "UnsafeBinderCast",
        _0: k._0,
        _1: this.lower_expr(k._1),
        _2: k._2 !== undefined ? this.lower_ty_alloc(k._2, { $: "Disallowed", _0: "Cast" }) : undefined,
      };
      break;

    case "Dummy":
      span_bug(e.span, "lowered ExprKind::Dummy");

    case "Try":
      kind = this.lower_expr_try(e.span, k._0);
      break;

    case "Paren":
    case "ForLoop":
    case "Closure":
      unreachable("internal error: entered unreachable code: already handled");

    case "MacCall":
      panic(`${format_debug(e.span, debug_Span, PLAIN)} shouldn't exist here`);

    case "GcaMacro": {
      const e_ = this.emit_bad_gca_macro(e.span, k._0, "expression");
      kind = { $: "Err", _0: e_ };
      break;
    }
  }

  return new hir.Expr(expr_hir_id, kind, span);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:556 lower_const_block
LoweringContext.prototype.lower_const_block = function (this: LoweringContext, c: AnonConst): hir.ConstBlock {
  return this.with_new_scopes(c.value.span, (this_) => {
    const def_id = this_.local_def_id(c.id);
    const hir_id = this_.lower_node_id(c.id);
    const [body] = this_.with_move_expr_bindings(undefined, (this_) => this_.lower_const_body(c.value.span, c.value));
    return { def_id, hir_id, body };
  });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:567 lower_lit
LoweringContext.prototype.lower_lit = function (this: LoweringContext, token_lit: token.Lit, span: Span): hir.Lit {
  let lit_kind: LitKind;
  const r = LitKind.from_token_lit(token.clone_Lit(token_lit));
  switch (r.$) {
    case "Ok":
      lit_kind = r._0;
      break;
    case "Err": {
      const guar = report_lit_error(this.tcx.sess.psess, r._0, token.clone_Lit(token_lit), span);
      lit_kind = { $: "Err", _0: guar };
      break;
    }
  }
  return respan(this.lower_span(span), lit_kind);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:578 lower_unop
LoweringContext.prototype.lower_unop = function (this: LoweringContext, u: UnOp): UnOp {
  switch (u) {
    case "Deref":
      return "Deref";
    case "Not":
      return "Not";
    case "Neg":
      return "Neg";
  }
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:586 lower_binop
LoweringContext.prototype.lower_binop = function (this: LoweringContext, b: BinOp): BinOp {
  return { node: b.node, span: this.lower_span(b.span) };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:590 lower_assign_op
LoweringContext.prototype.lower_assign_op = function (this: LoweringContext, a: AssignOp): AssignOp {
  return { node: a.node, span: this.lower_span(a.span) };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:594 lower_legacy_const_generics
LoweringContext.prototype.lower_legacy_const_generics = function (
  this: LoweringContext,
  f: Expr,
  args: Expr[],
  legacy_args_idx: readonly number[],
): hir.ExprKind {
  const fk = f.kind;
  if (!(fk.$ === "Path" && fk._0 === undefined)) {
    unreachable();
  }
  const path = fk._1;

  let error: ErrorGuaranteed | undefined = undefined;
  const invalid_expr_error = (tcx: TyCtxt, span: Span): ErrorGuaranteed => {
    // Avoid emitting the error multiple times.
    if (error === undefined) {
      const sm = tcx.sess.source_map();
      const const_args: string[] = [];
      const other_args: string[] = [];
      for (let idx = 0; idx < args.length; idx++) {
        const arg = args[idx]!;
        const snippet = sm.span_to_snippet(arg.span);
        if (snippet.$ === "Ok") {
          const arg = snippet._0.toString();
          if (legacy_args_idx.includes(idx)) {
            const_args.push(`{ ${arg} }`);
          } else {
            other_args.push(arg);
          }
        }
      }
      const suggestion = {
        end_of_fn: Span.shrink_to_hi(f.span),
        const_args: const_args.join(", "),
        other_args: other_args.join(", "),
        call_args: Span.to(args[0]!.span, unwrap(args[args.length - 1]).span),
      };
      error = tcx.dcx().emit_err(diagnostics.InvalidLegacyConstGenericArg_diagnostic({ span, suggestion }));
    }
    return unwrap(error);
  };

  // Split the arguments into const generics and normal arguments
  const real_args: Expr[] = [];
  const generic_args: AngleBracketedArg[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const arg = clone_Expr(args[idx]!);
    if (legacy_args_idx.includes(idx)) {
      const node_id = this.next_node_id();
      this.create_def(node_id, undefined, hir.def.DefKind.AnonConst, arg.span);
      let const_value: Expr;
      const cf = new WillCreateDefIdsVisitor().visit_expr(arg);
      if (cf.$ === "Break") {
        const span = cf._0;
        const id = this.next_node_id();
        const kind_err = invalid_expr_error(this.tcx, span);
        const_value = new Expr(id, { $: "Err", _0: kind_err }, f.span, [], undefined);
      } else {
        const_value = arg;
      }

      const anon_const: AnonConst = { id: node_id, value: const_value };
      generic_args.push({ $: "Arg", _0: { $: "Const", _0: anon_const } });
    } else {
      real_args.push(arg);
    }
  }

  // Add generic args to the last element of the path.
  const last_segment = unwrap(path.segments[path.segments.length - 1]);
  assert(last_segment.args === undefined, "assertion failed: last_segment.args.is_none()");
  last_segment.args = { $: "AngleBracketed", _0: { span: DUMMY_SP, args: generic_args } };

  // Now lower everything as normal.
  const f_ = this.lower_expr(f);
  return { $: "Call", _0: f_, _1: this.lower_exprs(real_args) };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:671 lower_expr_if
LoweringContext.prototype.lower_expr_if = function (this: LoweringContext, cond: Expr, then: Block, else_opt: Expr | undefined): hir.ExprKind {
  const lowered_cond = this.lower_expr(cond);
  const then_expr = this.lower_block_expr(then);
  if (else_opt !== undefined) {
    const rslt = else_opt;
    return { $: "If", _0: lowered_cond, _1: then_expr, _2: this.lower_expr(rslt) };
  } else {
    return { $: "If", _0: lowered_cond, _1: then_expr, _2: undefined };
  }
};

// We desugar: `'label: while $cond $body` into:
//
// ```
// 'label: loop {
//   if { let _t = $cond; _t } {
//     $body
//   }
//   else {
//     break;
//   }
// }
// ```
//
// Wrap in a construct equivalent to `{ let _t = $cond; _t }`
// to preserve drop semantics since `while $cond { ... }` does not
// let temporaries live outside of `cond`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:706 lower_expr_while_in_loop_scope
LoweringContext.prototype.lower_expr_while_in_loop_scope = function (
  this: LoweringContext,
  span: Span,
  cond: Expr,
  body: Block,
  opt_label: Label | undefined,
): hir.ExprKind {
  const lowered_cond = this.with_loop_condition_scope((t) => t.lower_expr(cond));
  const then = this.lower_block_expr(body);
  const expr_break = this.expr_break(span);
  const stmt_break = this.stmt_expr(span, expr_break);
  const else_blk = this.block_all(span, [stmt_break], undefined);
  const else_expr = this.expr_block(else_blk);
  const if_kind: hir.ExprKind = { $: "If", _0: lowered_cond, _1: then, _2: else_expr };
  const if_expr = this.expr(span, if_kind);
  const block = this.block_expr(if_expr);
  const span_ = this.lower_span(Span.with_hi(span, Span.hi(cond.span)));
  return { $: "Loop", _0: block, _1: opt_label, _2: hir.LoopSource.While, _3: span_ };
};

/// Desugar `try { <stmts>; <expr> }` into `{ <stmts>; ::std::ops::Try::from_output(<expr>) }`,
/// `try { <stmts>; }` into `{ <stmts>; ::std::ops::Try::from_output(()) }`
/// and save the block id to use it as a break target for desugaring of the `?` operator.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:729 lower_expr_try_block
LoweringContext.prototype.lower_expr_try_block = function (this: LoweringContext, body: Block, opt_ty: Ty | undefined): hir.ExprKind {
  const body_hir_id = this.lower_node_id(body.id);
  let new_scope: TryBlockScope;
  if (opt_ty !== undefined) {
    new_scope = { $: "Heterogeneous", _0: body_hir_id };
  } else {
    new_scope = { $: "Homogeneous", _0: body_hir_id };
  }
  const whole_block = this.with_try_block_scope(new_scope, (this_) => {
    const block = this_.lower_block_noalloc(body_hir_id, body, true);

    // Final expression of the block (if present) or `()` with span at the end of block
    let try_span: Span;
    let tail_expr: hir.Expr;
    const expr = block.expr;
    block.expr = undefined;
    if (expr !== undefined) {
      try_span = this_.mark_span_with_reason(DesugaringKind.TryBlock, expr.span, ALLOW_TRY_TRAIT);
      tail_expr = expr;
    } else {
      const try_span_ = this_.mark_span_with_reason(
        DesugaringKind.TryBlock,
        this_.tcx.sess.source_map().end_point(body.span),
        ALLOW_TRY_TRAIT,
      );

      try_span = try_span_;
      tail_expr = this_.expr_unit(try_span_);
    }

    const ok_wrapped_span = this_.mark_span_with_reason(DesugaringKind.TryBlock, tail_expr.span, undefined);

    // `::std::ops::Try::from_output($tail_expr)`
    block.expr = this_.wrap_in_try_constructor(LangItem.TryTraitFromOutput, try_span, tail_expr, ok_wrapped_span);

    return block;
  });

  if (opt_ty !== undefined) {
    const ty = this.lower_ty_alloc(opt_ty, { $: "Disallowed", _0: "Path" });
    const block_expr = this.expr_block(whole_block);
    return { $: "Type", _0: block_expr, _1: ty };
  } else {
    return { $: "Block", _0: whole_block, _1: undefined };
  }
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:782 wrap_in_try_constructor
LoweringContext.prototype.wrap_in_try_constructor = function (
  this: LoweringContext,
  lang_item: LangItem,
  method_span: Span,
  expr: hir.Expr,
  overall_span: Span,
): hir.Expr {
  const constructor = this.expr_lang_item_path(method_span, lang_item);
  return this.expr_call(overall_span, constructor, [expr]);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:793 lower_arm
LoweringContext.prototype.lower_arm = function (this: LoweringContext, arm: Arm): hir.Arm {
  const pat = this.lower_pat(arm.pat);
  const guard = arm.guard !== undefined ? this.lower_expr(arm.guard.cond) : undefined;
  const hir_id = this.next_id();
  const span = this.lower_span(arm.span);
  this.lower_attrs(hir_id, arm.attrs, arm.span, Target.Arm);
  const is_never_pattern = pat.is_never_pattern();
  // We need to lower the body even if it's unneeded for never pattern in match,
  // ensure that we can get HirId for DefId if need (issue #137708).
  const body_ = arm.body !== undefined ? this.lower_expr(arm.body) : undefined;
  let body: hir.Expr;
  if (body_ !== undefined && !is_never_pattern) {
    body = body_;
  } else {
    // Either `body.is_none()` or `is_never_pattern` here.
    if (!is_never_pattern) {
      if (this.tcx.features().never_patterns()) {
        // If the feature is off we already emitted the error after parsing.
        const suggestion = Span.shrink_to_hi(span);
        this.dcx().emit_err(diagnostics.MatchArmWithNoBody_diagnostic({ span, suggestion }));
      }
    } else if (arm.body !== undefined) {
      const body = arm.body;
      this.dcx().emit_err(diagnostics.NeverPatternWithBody_diagnostic({ span: body.span }));
    } else if (arm.guard !== undefined) {
      const g = arm.guard;
      this.dcx().emit_err(diagnostics.NeverPatternWithGuard_diagnostic({ span: g.span() }));
    }

    // We add a fake `loop {}` arm body so that it typecks to `!`. The mir lowering of never
    // patterns ensures this loop is not reachable.
    const block = new hir.Block([], undefined, this.next_id(), hir.BlockCheckMode.DefaultBlock, span, false);
    body = new hir.Expr(this.next_id(), { $: "Loop", _0: block, _1: undefined, _2: hir.LoopSource.Loop, _3: span }, span);
  }
  return { hir_id, pat, guard, body, span };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:840 lower_capture_clause
LoweringContext.prototype.lower_capture_clause = function (this: LoweringContext, capture_clause: CaptureBy): CaptureBy {
  switch (capture_clause.$) {
    case "Ref":
      return { $: "Ref" };
    case "Use":
      return { $: "Use", use_kw: this.lower_span(capture_clause.use_kw) };
    case "Value":
      return { $: "Value", move_kw: this.lower_span(capture_clause.move_kw) };
  }
};

/// Lower/desugar a coroutine construct.
///
/// In particular, this creates the correct async resume argument and `_task_context`.
///
/// This results in:
///
/// ```text
/// static move? |<_task_context?>| -> <return_ty> {
///     <body>
/// }
/// ```
// rustc: compiler/rustc_ast_lowering/src/expr.rs:859 make_desugared_coroutine_expr
LoweringContext.prototype.make_desugared_coroutine_expr = function (
  this: LoweringContext,
  capture_clause: CaptureBy,
  closure_node_id: NodeId,
  return_ty: hir.FnRetTy | undefined,
  fn_decl_span: Span,
  span: Span,
  desugaring_kind: hir.CoroutineDesugaring,
  coroutine_source: hir.CoroutineSource,
  body: (this_: LoweringContext) => hir.Expr,
): hir.ExprKind {
  const closure_def_id = this.local_def_id(closure_node_id);
  const coroutine_kind: hir.CoroutineKind = { $: "Desugared", _0: desugaring_kind, _1: coroutine_source };

  // The `async` desugaring takes a resume argument and maintains a `task_context`,
  // whereas a generator does not.
  let inputs: readonly hir.Ty[];
  let params: readonly hir.Param[];
  let task_context: HirId | undefined;
  switch (desugaring_kind) {
    case "Async":
    case "AsyncGen": {
      // Resume argument type: `ResumeTy`
      const unstable_span = this.mark_span_with_reason(DesugaringKind.Async, this.lower_span(span), this.allow_gen_future());
      const resume_ty = this.make_lang_item_qpath(LangItem.ResumeTy, unstable_span, undefined);
      const input_ty = new hir.Ty<null>(this.next_id(), unstable_span, { $: "Path", _0: resume_ty });
      const inputs_ = [input_ty];

      // Lower the argument pattern/ident. The ident is used again in the `.await` lowering.
      const [pat, task_context_hid] = this.pat_ident_binding_mode(span, Ident.with_dummy_span(sym._task_context), BindingMode.MUT);
      const param: hir.Param = {
        hir_id: this.next_id(),
        pat,
        ty_span: this.lower_span(span),
        span: this.lower_span(span),
      };
      const params_ = [param];

      inputs = inputs_;
      params = params_;
      task_context = task_context_hid;
      break;
    }
    case "Gen":
      inputs = [];
      params = [];
      task_context = undefined;
      break;
  }

  const output: hir.FnRetTy = return_ty ?? { $: "DefaultReturn", _0: this.lower_span(span) };

  const fn_decl = new hir.FnDecl(inputs, output, hir.FnDeclFlags.default_());

  const body_ = this.lower_body((this_) => {
    this_.coroutine_kind = coroutine_kind;

    const old_ctx = this_.task_context;
    if (task_context !== undefined) {
      this_.task_context = task_context;
    }
    const res = body(this_);
    this_.task_context = old_ctx;

    return [params, res];
  });

  let explicit_captures: readonly hir.ExplicitCapture[];
  const move_expr_state =
    coroutine_source === "Block" && this.move_expr_bindings.length > 0
      ? this.move_expr_bindings[this.move_expr_bindings.length - 1]
      : undefined;
  if (coroutine_source === "Block" && move_expr_state !== undefined) {
    explicit_captures = move_expr_state.occurrences.map((occurrence): hir.ExplicitCapture => ({ var_hir_id: occurrence.binding }));
  } else {
    explicit_captures = [];
  }

  // `static |<_task_context?>| -> <return_ty> { <body> }`:
  return {
    $: "Closure",
    _0: {
      def_id: closure_def_id,
      binder: hir.ClosureBinder.Default,
      capture_clause: this.lower_capture_clause(capture_clause),
      bound_generic_params: [],
      fn_decl,
      body: body_,
      fn_decl_span: this.lower_span(fn_decl_span),
      fn_arg_span: undefined,
      kind: { $: "Coroutine", _0: coroutine_kind },
      constness: hir.Constness.NotConst,
      explicit_captures,
    },
  };
};

/// Forwards a possible `#[track_caller]` annotation from `outer_hir_id` to
/// `inner_hir_id` in case the `async_fn_track_caller` feature is enabled.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:965 maybe_forward_track_caller
LoweringContext.prototype.maybe_forward_track_caller = function (this: LoweringContext, outer_hir_id: HirId, inner_hir_id: HirId): void {
  if (!this.tcx.features().async_fn_track_caller()) return;
  const curr_owner = this.curr_owner;
  const attrs = curr_owner.attrs.get(outer_hir_id.local_id);
  if (attrs === undefined) return;
  const t = attrs.find((a) => a.$ === "Parsed" && a._0.$ === "TrackCaller");
  if (t === undefined) return;
  curr_owner.attrs.insert(inner_hir_id.local_id, [t]);
};

/// Desugar `<expr>.await` into:
/// ```ignore (pseudo-rust)
/// match ::std::future::IntoFuture::into_future(<expr>) {
///     mut __awaitee => loop {
///         match unsafe { ::std::future::Future::poll(
///             <::std::pin::Pin>::new_unchecked(&mut __awaitee),
///             ::std::future::get_context(task_context),
///         ) } {
///             ::std::task::Poll::Ready(result) => break result,
///             ::std::task::Poll::Pending => {}
///         }
///         task_context = yield ();
///     }
/// }
/// ```
// rustc: compiler/rustc_ast_lowering/src/expr.rs:994 lower_expr_await
LoweringContext.prototype.lower_expr_await = function (this: LoweringContext, await_kw_span: Span, expr: Expr): hir.ExprKind {
  const expr_ = this.lower_expr_mut(expr);
  return this.make_lowered_await(await_kw_span, expr_, FutureKind.Future);
};

/// Takes an expr that has already been lowered and generates a desugared await loop around it
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1000 make_lowered_await
LoweringContext.prototype.make_lowered_await = function (
  this: LoweringContext,
  await_kw_span: Span,
  expr: hir.Expr,
  await_kind: FutureKind,
): hir.ExprKind {
  const full_span = Span.to(expr.span, await_kw_span);

  let is_async_gen: boolean;
  const ck = this.coroutine_kind;
  if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "Async") {
    is_async_gen = false;
  } else if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "AsyncGen") {
    is_async_gen = true;
  } else {
    // Some(hir::CoroutineKind::Coroutine(_))
    // | Some(hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::Gen, _))
    // | None
    // Lower to a block `{ EXPR; <error> }` so that the awaited expr
    // is not accidentally orphaned.
    const stmt_id = this.next_id();
    const expr_err = this.expr(expr.span, {
      $: "Err",
      _0: this.dcx().emit_err(
        diagnostics.AwaitOnlyInAsyncFnAndBlocks_diagnostic({ await_kw_span, item_span: this.current_item_span }),
      ),
    });
    return {
      $: "Block",
      _0: this.block_all(expr.span, [{ hir_id: stmt_id, kind: { $: "Semi", _0: expr }, span: expr.span }], expr_err),
      _1: undefined,
    };
  }

  let features: readonly Symbol[] | undefined;
  switch (await_kind) {
    case "Future":
      features = is_async_gen ? ALLOW_ASYNC_GEN : undefined;
      break;
    case "AsyncIterator":
      features = ALLOW_FOR_AWAIT;
      break;
  }
  const span = this.mark_span_with_reason(DesugaringKind.Await, await_kw_span, features);
  const gen_future_span = this.mark_span_with_reason(DesugaringKind.Await, full_span, this.allow_gen_future());
  const expr_hir_id = expr.hir_id;

  // Note that the name of this binding must not be changed to something else because
  // debuggers and debugger extensions expect it to be called `__awaitee`. They use
  // this name to identify what is being awaited by a suspended async functions.
  const awaitee_ident = Ident.with_dummy_span(sym.__awaitee);
  const [awaitee_pat, awaitee_pat_hid] = this.pat_ident_binding_mode(gen_future_span, awaitee_ident, BindingMode.MUT);

  const task_context_ident = Ident.with_dummy_span(sym._task_context);

  // unsafe {
  //     ::std::future::Future::poll(
  //         ::std::pin::Pin::new_unchecked(&mut __awaitee),
  //         ::std::future::get_context(task_context),
  //     )
  // }
  let poll_expr: hir.Expr;
  {
    const awaitee = this.expr_ident(span, awaitee_ident, awaitee_pat_hid);
    const ref_mut_awaitee = this.expr_mut_addr_of(span, awaitee);

    const task_context_hid = this.task_context;
    if (task_context_hid === undefined) {
      unreachable("internal error: entered unreachable code: use of `await` outside of an async context.");
    }

    const task_context = this.expr_ident_mut(span, task_context_ident, task_context_hid);

    const new_unchecked = this.expr_call_lang_item_fn_mut(span, LangItem.PinNewUnchecked, [ref_mut_awaitee]);
    const get_context = this.expr_call_lang_item_fn_mut(gen_future_span, LangItem.GetContext, [task_context]);
    let call: hir.Expr;
    switch (await_kind) {
      case "Future":
        call = this.expr_call_lang_item_fn(span, LangItem.FuturePoll, [new_unchecked, get_context]);
        break;
      case "AsyncIterator":
        call = this.expr_call_lang_item_fn(span, LangItem.AsyncIteratorPollNext, [new_unchecked, get_context]);
        break;
    }
    poll_expr = this.expr_unsafe(span, call);
  }

  // `::std::task::Poll::Ready(result) => break result`
  const loop_node_id = this.next_node_id();
  const loop_hir_id = this.lower_node_id(loop_node_id);
  let ready_arm: hir.Arm;
  {
    const x_ident = Ident.with_dummy_span(sym.result);
    const [x_pat, x_pat_hid] = this.pat_ident(gen_future_span, x_ident);
    const x_expr = this.expr_ident(gen_future_span, x_ident, x_pat_hid);
    const ready_field = this.single_pat_field(gen_future_span, x_pat);
    const ready_pat = this.pat_lang_item_variant(span, LangItem.PollReady, ready_field);
    const break_x = this.with_loop_scope(loop_hir_id, (this_) => {
      const expr_break: hir.ExprKind = { $: "Break", _0: this_.lower_loop_destination(undefined), _1: x_expr };
      return this_.expr(gen_future_span, expr_break);
    });
    ready_arm = this.arm(ready_pat, break_x, span);
  }

  // `::std::task::Poll::Pending => {}`
  let pending_arm: hir.Arm;
  {
    const pending_pat = this.pat_lang_item_variant(span, LangItem.PollPending, []);
    const empty_block = this.expr_block_empty(span);
    pending_arm = this.arm(pending_pat, empty_block, span);
  }

  let inner_match_stmt: hir.Stmt;
  {
    const match_expr = this.expr_match(span, poll_expr, [ready_arm, pending_arm], hir.MatchSource.AwaitDesugar);
    inner_match_stmt = this.stmt_expr(span, match_expr);
  }

  // Depending on `async` of `async gen`:
  // async     - task_context = yield ();
  // async gen - task_context = yield ASYNC_GEN_PENDING;
  let yield_stmt: hir.Stmt;
  {
    let yielded: hir.Expr;
    if (is_async_gen) {
      yielded = this.expr_lang_item_path(span, LangItem.AsyncGenPending);
    } else {
      yielded = this.expr_unit(span);
    }

    const yield_expr = this.expr(span, { $: "Yield", _0: yielded, _1: { $: "Await", expr: expr_hir_id } });

    const task_context_hid = this.task_context;
    if (task_context_hid === undefined) {
      unreachable("internal error: entered unreachable code: use of `await` outside of an async context.");
    }

    const lhs = this.expr_ident(span, task_context_ident, task_context_hid);
    const assign = this.expr(span, { $: "Assign", _0: lhs, _1: yield_expr, _2: this.lower_span(span) });
    yield_stmt = this.stmt_expr(span, assign);
  }

  const loop_block = this.block_all(span, [inner_match_stmt, yield_stmt], undefined);

  // loop { .. }
  const loop_expr = new hir.Expr(
    loop_hir_id,
    { $: "Loop", _0: loop_block, _1: undefined, _2: hir.LoopSource.Loop, _3: this.lower_span(span) },
    this.lower_span(span),
  );

  // mut __awaitee => loop { ... }
  const awaitee_arm = this.arm(awaitee_pat, loop_expr, span);

  // `match ::std::future::IntoFuture::into_future(<expr>) { ... }`
  let into_future_expr: hir.Expr;
  switch (await_kind) {
    case "Future":
      into_future_expr = this.expr_call_lang_item_fn(span, LangItem.IntoFutureIntoFuture, [expr]);
      break;
    // Not needed for `for await` because we expect to have already called
    // `IntoAsyncIterator::into_async_iter` on it.
    case "AsyncIterator":
      into_future_expr = expr;
      break;
  }

  // match <into_future_expr> {
  //     mut __awaitee => loop { .. }
  // }
  return { $: "Match", _0: into_future_expr, _1: [awaitee_arm], _2: hir.MatchSource.AwaitDesugar };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1201 lower_expr_use
LoweringContext.prototype.lower_expr_use = function (this: LoweringContext, use_kw_span: Span, expr: Expr): hir.ExprKind {
  return { $: "Use", _0: this.lower_expr(expr), _1: this.lower_span(use_kw_span) };
};

/// Destructure the LHS of complex assignments.
/// For instance, lower `(a, b) = t` to `{ let (lhs1, lhs2) = t; a = lhs1; b = lhs2; }`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1207 lower_expr_assign
LoweringContext.prototype.lower_expr_assign = function (
  this: LoweringContext,
  lhs: Expr,
  rhs: Expr,
  eq_sign_span: Span,
  whole_span: Span,
): hir.ExprKind {
  // Return early in case of an ordinary assignment.
  // rustc: compiler/rustc_ast_lowering/src/expr.rs:1215 is_ordinary
  function is_ordinary(lower_ctx: LoweringContext, lhs: Expr): boolean {
    const k = lhs.kind;
    switch (k.$) {
      case "Array":
      case "Struct":
      case "Tup":
      case "Underscore":
        return false;
      // Check for unit struct constructor.
      case "Path":
        return lower_ctx.extract_unit_struct_path(lhs) === undefined;
      // Check for tuple struct constructor.
      case "Call":
        return lower_ctx.extract_tuple_struct_path(k._0) === undefined;
      case "Paren": {
        const e = k._0;
        const ek = e.kind;
        // We special-case `(..)` for consistency with patterns.
        if (ek.$ === "Range" && ek._0 === undefined && ek._1 === undefined && ek._2 === "HalfOpen") {
          return false;
        }
        return is_ordinary(lower_ctx, e);
      }
      default:
        return true;
    }
  }
  if (is_ordinary(this, lhs)) {
    return { $: "Assign", _0: this.lower_expr(lhs), _1: this.lower_expr(rhs), _2: this.lower_span(eq_sign_span) };
  }

  const assignments: hir.Stmt[] = [];

  // The LHS becomes a pattern: `(lhs1, lhs2)`.
  const pat = this.destructure_assign(lhs, eq_sign_span, assignments);
  const rhs_ = this.lower_expr(rhs);

  // Introduce a `let` for destructuring: `let (lhs1, lhs2) = t`.
  const destructure_let = this.stmt_let_pat(undefined, whole_span, rhs_, pat, hir.LocalSource.AssignDesugar);

  // `a = lhs1; b = lhs2;`.
  const stmts = [destructure_let, ...assignments];

  // Wrap everything in a block.
  return { $: "Block", _0: this.block_all(whole_span, stmts, undefined), _1: undefined };
};

/// If the given expression is a path to a tuple struct, returns that path.
/// It is not a complete check, but just tries to reject most paths early
/// if they are not tuple structs.
/// Type checking will take care of the full validation later.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1264 extract_tuple_struct_path
LoweringContext.prototype.extract_tuple_struct_path = function (this: LoweringContext, expr: Expr): [QSelf | undefined, Path] | undefined {
  const k = expr.kind;
  if (k.$ === "Path") {
    // Does the path resolve to something disallowed in a tuple struct/variant pattern?
    const partial_res = this.get_partial_res(expr.id);
    if (partial_res !== undefined) {
      const res = partial_res.full_res();
      if (res !== undefined && !hir.def.Res.expected_in_tuple_struct_pat(res)) {
        return undefined;
      }
    }
    return [k._0, k._1];
  }
  return undefined;
};

/// If the given expression is a path to a unit struct, returns that path.
/// It is not a complete check, but just tries to reject most paths early
/// if they are not unit structs.
/// Type checking will take care of the full validation later.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1286 extract_unit_struct_path
LoweringContext.prototype.extract_unit_struct_path = function (this: LoweringContext, expr: Expr): [QSelf | undefined, Path] | undefined {
  const k = expr.kind;
  if (k.$ === "Path") {
    // Does the path resolve to something disallowed in a unit struct/variant pattern?
    const partial_res = this.get_partial_res(expr.id);
    if (partial_res !== undefined) {
      const res = partial_res.full_res();
      if (res !== undefined && !hir.def.Res.expected_in_unit_struct_pat(res)) {
        return undefined;
      }
    }
    return [k._0, k._1];
  }
  return undefined;
};

/// Convert the LHS of a destructuring assignment to a pattern.
/// Each sub-assignment is recorded in `assignments`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1306 destructure_assign
LoweringContext.prototype.destructure_assign = function (
  this: LoweringContext,
  lhs: Expr,
  eq_sign_span: Span,
  assignments: hir.Stmt[],
): hir.Pat {
  return this.destructure_assign_mut(lhs, eq_sign_span, assignments);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1315 destructure_assign_mut
LoweringContext.prototype.destructure_assign_mut = function (
  this: LoweringContext,
  lhs: Expr,
  eq_sign_span: Span,
  assignments: hir.Stmt[],
): hir.Pat {
  const k = lhs.kind;
  switch (k.$) {
    // Underscore pattern.
    case "Underscore":
      return this.pat_without_dbm(lhs.span, hir.PatKind.Wild);
    // Slice patterns.
    case "Array": {
      const elements = k._0;
      const [pats, rest] = this.destructure_sequence(elements, "slice", eq_sign_span, assignments);
      let slice_pat: hir.PatKind;
      if (rest !== undefined) {
        const [i, span] = rest;
        const [before, after] = [pats.slice(0, i), pats.slice(i)];
        slice_pat = { $: "Slice", _0: before, _1: this.pat_without_dbm(span, hir.PatKind.Wild), _2: after };
      } else {
        slice_pat = { $: "Slice", _0: pats, _1: undefined, _2: [] };
      }
      return this.pat_without_dbm(lhs.span, slice_pat);
    }
    // Tuple structs.
    case "Call": {
      const [callee, args] = [k._0, k._1];
      const extracted = this.extract_tuple_struct_path(callee);
      if (extracted !== undefined) {
        const [qself, path] = extracted;
        const [pats, rest] = this.destructure_sequence(args, "tuple struct or variant", eq_sign_span, assignments);
        const qpath = this.lower_qpath(callee.id, qself, path, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined);
        // Destructure like a tuple struct.
        const tuple_struct_pat: hir.PatKind = {
          $: "TupleStruct",
          _0: qpath,
          _1: pats,
          _2: hir.DotDotPos.new(rest !== undefined ? rest[0] : undefined),
        };
        return this.pat_without_dbm(lhs.span, tuple_struct_pat);
      }
      break;
    }
    // Unit structs and enum variants.
    case "Path": {
      const extracted = this.extract_unit_struct_path(lhs);
      if (extracted !== undefined) {
        const [qself, path] = extracted;
        const qpath = this.lower_qpath(lhs.id, qself, path, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined);
        // Destructure like a unit struct.
        const unit_struct_pat: hir.PatKind = {
          $: "Expr",
          _0: {
            kind: { $: "Path", _0: qpath },
            hir_id: this.next_id(),
            span: this.lower_span(lhs.span),
          },
        };
        return this.pat_without_dbm(lhs.span, unit_struct_pat);
      }
      break;
    }
    // Structs.
    case "Struct": {
      const se = k._0;
      const field_pats = se.fields.map((f): hir.PatField => {
        const pat = this.destructure_assign(f.expr, eq_sign_span, assignments);
        return {
          hir_id: this.next_id(),
          ident: this.lower_ident(f.ident),
          pat,
          is_shorthand: f.is_shorthand,
          span: this.lower_span(f.span),
        };
      });
      const qpath = this.lower_qpath(lhs.id, se.qself, se.path, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined);
      let fields_omitted: Span | undefined;
      const se_rest = se.rest;
      switch (se_rest.$) {
        case "Base": {
          const e = se_rest._0;
          this.dcx().emit_err(diagnostics.FunctionalRecordUpdateDestructuringAssignment_diagnostic({ span: e.span }));
          fields_omitted = this.lower_span(e.span);
          break;
        }
        case "Rest":
          fields_omitted = this.lower_span(se_rest._0);
          break;
        case "None":
        case "NoneWithError":
          fields_omitted = undefined;
          break;
      }
      const struct_pat: hir.PatKind = { $: "Struct", _0: qpath, _1: field_pats, _2: fields_omitted };
      return this.pat_without_dbm(lhs.span, struct_pat);
    }
    // Tuples.
    case "Tup": {
      const elements = k._0;
      const [pats, rest] = this.destructure_sequence(elements, "tuple", eq_sign_span, assignments);
      const tuple_pat: hir.PatKind = { $: "Tuple", _0: pats, _1: hir.DotDotPos.new(rest !== undefined ? rest[0] : undefined) };
      return this.pat_without_dbm(lhs.span, tuple_pat);
    }
    case "Paren": {
      const e = k._0;
      const ek = e.kind;
      // We special-case `(..)` for consistency with patterns.
      if (ek.$ === "Range" && ek._0 === undefined && ek._1 === undefined && ek._2 === "HalfOpen") {
        const tuple_pat: hir.PatKind = { $: "Tuple", _0: [], _1: hir.DotDotPos.new(0) };
        return this.pat_without_dbm(lhs.span, tuple_pat);
      } else {
        return this.destructure_assign_mut(e, eq_sign_span, assignments);
      }
    }
    default:
      break;
  }
  // Treat all other cases as normal lvalue.
  const ident = Ident.new(sym.lhs, this.lower_span(lhs.span));
  const [pat, binding] = this.pat_ident_mut(lhs.span, ident);
  const ident_ = this.expr_ident(lhs.span, ident, binding);
  const assign: hir.ExprKind = { $: "Assign", _0: this.lower_expr(lhs), _1: ident_, _2: this.lower_span(eq_sign_span) };
  const expr = this.expr(lhs.span, assign);
  assignments.push(this.stmt_expr(lhs.span, expr));
  return pat;
};

/// Destructure a sequence of expressions occurring on the LHS of an assignment.
/// Such a sequence occurs in a tuple (struct)/slice.
/// Return a sequence of corresponding patterns, and the index and the span of `..` if it
/// exists.
/// Each sub-assignment is recorded in `assignments`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1458 destructure_sequence
LoweringContext.prototype.destructure_sequence = function (
  this: LoweringContext,
  elements: readonly Expr[],
  ctx: string,
  eq_sign_span: Span,
  assignments: hir.Stmt[],
): [readonly hir.Pat[], [number, Span] | undefined] {
  let rest: [number, Span] | undefined = undefined;
  const elements_: hir.Pat[] = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    const ek = e.kind;
    // Check for `..` pattern.
    if (ek.$ === "Range" && ek._0 === undefined && ek._1 === undefined && ek._2 === "HalfOpen") {
      if (rest !== undefined) {
        const [, prev_span] = rest;
        this.ban_extra_rest_pat(e.span, prev_span, ctx);
      } else {
        rest = [i, e.span];
      }
    } else {
      elements_.push(this.destructure_assign_mut(e, eq_sign_span, assignments));
    }
  }
  return [elements_, rest];
};

/// Desugar `<start>..=<end>` into `std::ops::RangeInclusive::new(<start>, <end>)`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1484 lower_expr_range_closed
LoweringContext.prototype.lower_expr_range_closed = function (this: LoweringContext, span: Span, e1: Expr, e2: Expr): hir.ExprKind {
  const e1_ = this.lower_expr_mut(e1);
  const e2_ = this.lower_expr_mut(e2);
  const fn_path = this.make_lang_item_qpath(LangItem.RangeInclusiveNew, span, undefined);
  const fn_expr = this.expr(span, { $: "Path", _0: fn_path });
  return { $: "Call", _0: fn_expr, _1: [e1_, e2_] };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1492 lower_expr_range
LoweringContext.prototype.lower_expr_range = function (
  this: LoweringContext,
  span: Span,
  e1: Expr | undefined,
  e2: Expr | undefined,
  lims: RangeLimits,
): hir.ExprKind {
  let lang_item: LangItem;
  if (e1 === undefined && e2 === undefined && lims === "HalfOpen") {
    lang_item = LangItem.RangeFull;
  } else if (e1 !== undefined && e2 === undefined && lims === "HalfOpen") {
    if (this.tcx.features().new_range()) {
      lang_item = LangItem.RangeFromCopy;
    } else {
      lang_item = LangItem.RangeFrom;
    }
  } else if (e1 === undefined && e2 !== undefined && lims === "HalfOpen") {
    lang_item = LangItem.RangeTo;
  } else if (e1 !== undefined && e2 !== undefined && lims === "HalfOpen") {
    if (this.tcx.features().new_range()) {
      lang_item = LangItem.RangeCopy;
    } else {
      lang_item = LangItem.Range;
    }
  } else if (e1 === undefined && e2 !== undefined && lims === "Closed") {
    if (this.tcx.features().new_range()) {
      lang_item = LangItem.RangeToInclusiveCopy;
    } else {
      lang_item = LangItem.RangeToInclusive;
    }
  } else if (e1 !== undefined && e2 !== undefined && lims === "Closed") {
    if (this.tcx.features().new_range()) {
      lang_item = LangItem.RangeInclusiveCopy;
    } else {
      return this.lower_expr_range_closed(span, e1, e2);
    }
  } else {
    // (start, None, Closed)
    const start = e1;
    this.dcx().emit_err(diagnostics.InclusiveRangeWithNoEnd_diagnostic({ span }));
    if (start !== undefined) {
      if (this.tcx.features().new_range()) {
        lang_item = LangItem.RangeFromCopy;
      } else {
        lang_item = LangItem.RangeFrom;
      }
    } else {
      lang_item = LangItem.RangeFull;
    }
  }

  const named: [Symbol, Expr][] = [];
  if (e1 !== undefined) named.push([sym.start, e1]);
  if (e2 !== undefined) {
    named.push([
      lang_item === LangItem.RangeInclusiveCopy || lang_item === LangItem.RangeToInclusiveCopy ? sym.last : sym.end,
      e2,
    ]);
  }
  const fields = named.map(([s, e]) => {
    const span = this.lower_span(e.span);
    const span_ = this.mark_span_with_reason(DesugaringKind.RangeExpr, span, undefined);
    const expr = this.lower_expr(e);
    const ident = Ident.new(s, span_);
    return this.expr_field(ident, expr, span_);
  });

  return {
    $: "Struct",
    _0: this.make_lang_item_qpath(lang_item, span, undefined),
    _1: fields,
    _2: hir.StructTailExpr.None,
  };
};

// Record labelled expr's HirId so that we can retrieve it in `lower_jump_destination` without
// lowering node id again.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1581 lower_label
LoweringContext.prototype.lower_label = function (
  this: LoweringContext,
  opt_label: Label | undefined,
  dest_id: NodeId,
  dest_hir_id: HirId,
): Label | undefined {
  if (opt_label === undefined) return undefined;
  const label = opt_label;
  this.curr_owner.ident_and_label_to_local_id.set(dest_id, dest_hir_id.local_id);
  return { ident: this.lower_ident(label.ident) };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1592 lower_loop_destination
LoweringContext.prototype.lower_loop_destination = function (this: LoweringContext, destination: [NodeId, Label] | undefined): hir.Destination {
  let target_id: Result<HirId, hir.LoopIdError>;
  if (destination !== undefined) {
    const [id] = destination;
    const curr_owner = this.curr_owner;
    const loop_id = curr_owner.owner.get_label_res(id);
    if (loop_id !== undefined) {
      const local_id = map_index(curr_owner.ident_and_label_to_local_id, loop_id);
      const loop_hir_id = new HirId(curr_owner.owner_id(), local_id);
      target_id = Ok(loop_hir_id);
    } else {
      target_id = Err(hir.LoopIdError.UnresolvedLabel);
    }
  } else {
    target_id = this.loop_scope !== undefined ? Ok(this.loop_scope) : Err(hir.LoopIdError.OutsideLoopScope);
  }
  const label: Label | undefined = destination !== undefined ? { ident: this.lower_ident(destination[1].ident) } : undefined;
  return { label, target_id };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1613 lower_jump_destination
LoweringContext.prototype.lower_jump_destination = function (this: LoweringContext, id: NodeId, opt_label: Label | undefined): hir.Destination {
  if (this.is_in_loop_condition && opt_label === undefined) {
    return { label: undefined, target_id: Err(hir.LoopIdError.UnlabeledCfInWhileCondition) };
  } else {
    return this.lower_loop_destination(opt_label !== undefined ? [id, opt_label] : undefined);
  }
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1624 with_try_block_scope
LoweringContext.prototype.with_try_block_scope = function <T>(
  this: LoweringContext,
  scope: TryBlockScope,
  f: (this_: LoweringContext) => T,
): T {
  const old_scope = this.try_block_scope;
  this.try_block_scope = scope;
  const result = f(this);
  this.try_block_scope = old_scope;
  return result;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1635 with_loop_scope
LoweringContext.prototype.with_loop_scope = function <T>(this: LoweringContext, loop_id: HirId, f: (this_: LoweringContext) => T): T {
  // We're no longer in the base loop's condition; we're in another loop.
  const was_in_loop_condition = this.is_in_loop_condition;
  this.is_in_loop_condition = false;

  const old_scope = this.loop_scope;
  this.loop_scope = loop_id;
  const result = f(this);
  this.loop_scope = old_scope;

  this.is_in_loop_condition = was_in_loop_condition;

  return result;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1649 with_loop_condition_scope
LoweringContext.prototype.with_loop_condition_scope = function <T>(this: LoweringContext, f: (this_: LoweringContext) => T): T {
  const was_in_loop_condition = this.is_in_loop_condition;
  this.is_in_loop_condition = true;

  const result = f(this);

  this.is_in_loop_condition = was_in_loop_condition;

  return result;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1660 lower_expr_field
LoweringContext.prototype.lower_expr_field = function (this: LoweringContext, f: ExprField): hir.ExprField {
  const hir_id = this.lower_node_id(f.id);
  this.lower_attrs(hir_id, f.attrs, f.span, Target.ExprField);
  return {
    hir_id,
    ident: this.lower_ident(f.ident),
    expr: this.lower_expr(f.expr),
    span: this.lower_span(f.span),
    is_shorthand: f.is_shorthand,
  };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:1672 lower_expr_yield
LoweringContext.prototype.lower_expr_yield = function (this: LoweringContext, span: Span, opt_expr: Expr | undefined): hir.ExprKind {
  const yielded = opt_expr !== undefined ? this.lower_expr(opt_expr) : this.expr_unit(span);

  if (!this.tcx.features().yield_expr() && !this.tcx.features().coroutines() && !this.tcx.features().gen_blocks()) {
    feature_err(this.tcx.sess, sym.yield_expr, span, msg("yield syntax is experimental")).emit();
  }

  let is_async_gen: boolean;
  const ck = this.coroutine_kind;
  if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "Gen") {
    is_async_gen = false;
  } else if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "AsyncGen") {
    is_async_gen = true;
  } else if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "Async") {
    // Lower to a block `{ EXPR; <error> }` so that the awaited expr
    // is not accidentally orphaned.
    const stmt_id = this.next_id();
    const expr_err = this.expr(yielded.span, {
      $: "Err",
      _0: this.dcx().emit_err(diagnostics.AsyncCoroutinesNotSupported_diagnostic({ span })),
    });
    return {
      $: "Block",
      _0: this.block_all(yielded.span, [{ hir_id: stmt_id, kind: { $: "Semi", _0: yielded }, span: yielded.span }], expr_err),
      _1: undefined,
    };
  } else if (ck !== undefined && ck.$ === "Coroutine") {
    is_async_gen = false;
  } else {
    const suggestion = this.current_item_span !== undefined ? Span.shrink_to_lo(this.current_item_span) : undefined;
    this.dcx().emit_err(diagnostics.YieldInClosure_diagnostic({ span, suggestion }));
    this.coroutine_kind = { $: "Coroutine", _0: "Movable" };

    is_async_gen = false;
  }

  if (is_async_gen) {
    // `yield $expr` is transformed into `task_context = yield async_gen_ready($expr)`.
    // This ensures that we store our resumed `ResumeContext` correctly, and also that
    // the apparent value of the `yield` expression is `()`.
    const desugar_span = this.mark_span_with_reason(DesugaringKind.Async, span, ALLOW_ASYNC_GEN);
    const wrapped_yielded = this.expr_call_lang_item_fn(desugar_span, LangItem.AsyncGenReady, [yielded]);
    const yield_expr = this.expr(span, { $: "Yield", _0: wrapped_yielded, _1: hir.YieldSource.Yield });

    const task_context_hid = this.task_context;
    if (task_context_hid === undefined) {
      unreachable("internal error: entered unreachable code: use of `await` outside of an async context.");
    }
    const task_context_ident = Ident.with_dummy_span(sym._task_context);
    const lhs = this.expr_ident(desugar_span, task_context_ident, task_context_hid);

    return { $: "Assign", _0: lhs, _1: yield_expr, _2: this.lower_span(span) };
  } else {
    return { $: "Yield", _0: yielded, _1: hir.YieldSource.Yield };
  }
};

/// Desugar `ExprForLoop` from: `[opt_ident]: for <pat> in <head> <body>` into:
/// ```ignore (pseudo-rust)
/// {
///     let result = match IntoIterator::into_iter(<head>) {
///         mut iter => {
///             [opt_ident]: loop {
///                 match Iterator::next(&mut iter) {
///                     None => break,
///                     Some(<pat>) => <body>,
///                 };
///             }
///         }
///     };
///     result
/// }
/// ```
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1769 lower_expr_for
LoweringContext.prototype.lower_expr_for = function (
  this: LoweringContext,
  e: Expr,
  pat_: Pat,
  head_: Expr,
  body: Block,
  opt_label: Label | undefined,
  loop_kind: ForLoopKind,
): hir.Expr {
  const head = this.lower_expr_mut(head_);
  const pat = this.lower_pat(pat_);
  const for_span = this.mark_span_with_reason(DesugaringKind.ForLoop, this.lower_span(e.span), undefined);
  const for_ctxt = Span.ctxt(for_span);

  // Try to point both the head and pat spans to their position in the for loop
  // rather than inside a macro.
  const head_span = Span.with_ctxt(Span.find_ancestor_in_same_ctxt(head.span, e.span) ?? head.span, for_ctxt);
  const pat_span = Span.with_ctxt(Span.find_ancestor_in_same_ctxt(pat.span, e.span) ?? pat.span, for_ctxt);

  const loop_hir_id = this.lower_node_id(e.id);
  const label = this.lower_label(opt_label, e.id, loop_hir_id);

  // `None => break`
  let none_arm: hir.Arm;
  {
    const break_expr = this.with_loop_scope(loop_hir_id, (this_) => this_.expr_break_alloc(for_span));
    const pat = this.pat_none(for_span);
    none_arm = this.arm(pat, break_expr, for_span);
  }

  // Some(<pat>) => <body>,
  let some_arm: hir.Arm;
  {
    const some_pat = this.pat_some(pat_span, pat);
    const body_block = this.with_loop_scope(loop_hir_id, (this_) => this_.lower_block(body, false));
    const body_expr = this.expr_block(body_block);
    some_arm = this.arm(some_pat, body_expr, for_span);
  }

  // `mut iter`
  const iter = Ident.with_dummy_span(sym.iter);
  const [iter_pat, iter_pat_nid] = this.pat_ident_binding_mode(head_span, iter, BindingMode.MUT);

  let match_expr: hir.Expr;
  {
    const iter_ = this.expr_ident(head_span, iter, iter_pat_nid);
    let next_expr: hir.Expr;
    switch (loop_kind) {
      case "For": {
        // `Iterator::next(&mut iter)`
        const ref_mut_iter = this.expr_mut_addr_of(head_span, iter_);
        next_expr = this.expr_call_lang_item_fn(head_span, LangItem.IteratorNext, [ref_mut_iter]);
        break;
      }
      case "ForAwait": {
        // we'll generate `unsafe { Pin::new_unchecked(&mut iter) })` and then pass this
        // to make_lowered_await with `FutureKind::AsyncIterator` which will generator
        // calls to `poll_next`. In user code, this would probably be a call to
        // `Pin::as_mut` but here it's easy enough to do `new_unchecked`.

        // `&mut iter`
        const iter1 = this.expr_mut_addr_of(head_span, iter_);
        // `Pin::new_unchecked(...)`
        const iter2 = this.expr_call_lang_item_fn_mut(head_span, LangItem.PinNewUnchecked, [iter1]);
        // `unsafe { ... }`
        const iter3 = this.expr_unsafe(head_span, iter2);
        const kind = this.make_lowered_await(head_span, iter3, FutureKind.AsyncIterator);
        next_expr = new hir.Expr(this.next_id(), kind, head_span);
        break;
      }
    }
    const arms = [none_arm, some_arm];

    // `match $next_expr { ... }`
    match_expr = this.expr_match(head_span, next_expr, arms, hir.MatchSource.ForLoopDesugar);
  }
  const match_stmt = this.stmt_expr(for_span, match_expr);

  const loop_block = this.block_all(for_span, [match_stmt], undefined);

  // `[opt_ident]: loop { ... }`
  const kind: hir.ExprKind = {
    $: "Loop",
    _0: loop_block,
    _1: label,
    _2: hir.LoopSource.ForLoop,
    _3: this.lower_span(Span.with_hi(for_span, Span.hi(head.span))),
  };
  const loop_expr = new hir.Expr(loop_hir_id, kind, for_span);

  // `mut iter => { ... }`
  const iter_arm = this.arm(iter_pat, loop_expr, for_span);

  let match_expr_: hir.Expr;
  switch (loop_kind) {
    case "For": {
      // `::std::iter::IntoIterator::into_iter(<head>)`
      const into_iter_expr = this.expr_call_lang_item_fn(head_span, LangItem.IntoIterIntoIter, [head]);

      match_expr_ = this.expr_match(for_span, into_iter_expr, [iter_arm], hir.MatchSource.ForLoopDesugar);
      break;
    }
    // `match into_async_iter(<head>) { ref mut iter => match unsafe { Pin::new_unchecked(iter) } { ... } }`
    case "ForAwait": {
      const iter_ident = iter;
      const [async_iter_pat, async_iter_pat_id] = this.pat_ident_binding_mode(head_span, iter_ident, BindingMode.REF_MUT);
      const iter1 = this.expr_ident_mut(head_span, iter_ident, async_iter_pat_id);
      // `Pin::new_unchecked(...)`
      const iter2 = this.expr_call_lang_item_fn_mut(head_span, LangItem.PinNewUnchecked, [iter1]);
      // `unsafe { ... }`
      const iter3 = this.expr_unsafe(head_span, iter2);
      const inner_match_expr = this.expr_match(for_span, iter3, [iter_arm], hir.MatchSource.ForLoopDesugar);

      // `::core::async_iter::IntoAsyncIterator::into_async_iter(<head>)`
      const iter4 = this.expr_call_lang_item_fn(head_span, LangItem.IntoAsyncIterIntoIter, [head]);
      const iter_arm_ = this.arm(async_iter_pat, inner_match_expr, for_span);
      match_expr_ = this.expr_match(for_span, iter4, [iter_arm_], hir.MatchSource.ForLoopDesugar);
      break;
    }
  }

  // This is effectively `{ let _result = ...; _result }`.
  // The construct was introduced in #21984 and is necessary to make sure that
  // temporaries in the `head` expression are dropped and do not leak to the
  // surrounding scope of the `match` since the `match` is not a terminating scope.
  //
  // Also, add the attributes to the outer returned expr node.
  const expr = this.expr_drop_temps_mut(for_span, match_expr_);
  this.lower_attrs(expr.hir_id, e.attrs, e.span, Target.from_expr(e));
  return expr;
};

/// Desugar `ExprKind::Try` from: `<expr>?` into:
/// ```ignore (pseudo-rust)
/// match Try::branch(<expr>) {
///     ControlFlow::Continue(val) => #[allow(unreachable_code)] val,,
///     ControlFlow::Break(residual) =>
///         #[allow(unreachable_code)]
///         // If there is an enclosing `try {...}`:
///         break 'catch_target Residual::into_try_type(residual),
///         // Otherwise:
///         return Try::from_residual(residual),
/// }
/// ```
// rustc: compiler/rustc_ast_lowering/src/expr.rs:1945 lower_expr_try
LoweringContext.prototype.lower_expr_try = function (this: LoweringContext, span: Span, sub_expr: Expr): hir.ExprKind {
  const unstable_span = this.mark_span_with_reason(DesugaringKind.QuestionMark, span, ALLOW_TRY_TRAIT);
  const try_span_ = this.tcx.sess.source_map().end_point(span);
  const try_span = this.mark_span_with_reason(DesugaringKind.QuestionMark, try_span_, ALLOW_TRY_TRAIT);

  // `Try::branch(<expr>)`
  let scrutinee: hir.Expr;
  {
    // expand <expr>
    const sub_expr_ = this.lower_expr_mut(sub_expr);

    scrutinee = this.expr_call_lang_item_fn(unstable_span, LangItem.TryTraitBranch, [sub_expr_]);
  }

  const attrs: Attribute[] = [this.unreachable_code_attr(try_span)];

  // `ControlFlow::Continue(val) => #[allow(unreachable_code)] val,`
  let continue_arm: hir.Arm;
  {
    const val_ident = Ident.with_dummy_span(sym.val);
    const [val_pat, val_pat_nid] = this.pat_ident(span, val_ident);
    const val_expr = this.expr_ident(span, val_ident, val_pat_nid);
    this.lower_attrs(val_expr.hir_id, attrs, span, Target.Expression);
    const continue_pat = this.pat_cf_continue(unstable_span, val_pat);
    continue_arm = this.arm(continue_pat, val_expr, try_span);
  }

  // `ControlFlow::Break(residual) =>
  //     #[allow(unreachable_code)]
  //     return Try::from_residual(residual),`
  let break_arm: hir.Arm;
  {
    const residual_ident = Ident.with_dummy_span(sym.residual);
    const [residual_local, residual_local_nid] = this.pat_ident(try_span, residual_ident);
    const residual_expr = this.expr_ident_mut(try_span, residual_ident, residual_local_nid);

    let constructor_item: LangItem;
    let target_id: Result<HirId, hir.LoopIdError>;
    const scope = this.try_block_scope;
    switch (scope.$) {
      case "Function":
        [constructor_item, target_id] = [LangItem.TryTraitFromResidual, Err(hir.LoopIdError.OutsideLoopScope)];
        break;
      case "Homogeneous":
        [constructor_item, target_id] = [LangItem.ResidualIntoTryType, Ok(scope._0)];
        break;
      case "Heterogeneous":
        [constructor_item, target_id] = [LangItem.TryTraitFromResidual, Ok(scope._0)];
        break;
    }
    const from_residual_expr = this.wrap_in_try_constructor(constructor_item, try_span, residual_expr, unstable_span);
    let ret_expr: hir.Expr;
    if (target_id.$ === "Ok") {
      ret_expr = this.expr(try_span, { $: "Break", _0: { label: undefined, target_id }, _1: from_residual_expr });
    } else {
      const ret_expr_ = this.checked_return(from_residual_expr);
      ret_expr = this.expr(try_span, ret_expr_);
    }
    this.lower_attrs(ret_expr.hir_id, attrs, span, Target.Expression);

    const break_pat = this.pat_cf_break(try_span, residual_local);
    break_arm = this.arm(break_pat, ret_expr, try_span);
  }

  return { $: "Match", _0: scrutinee, _1: [break_arm, continue_arm], _2: { $: "TryDesugar", _0: scrutinee.hir_id } };
};

/// Desugar `ExprKind::Yeet` from: `do yeet <expr>` into:
/// ```ignore(illustrative)
/// // If there is an enclosing `try {...}`:
/// break 'catch_target FromResidual::from_residual(Yeet(residual));
/// // Otherwise:
/// return FromResidual::from_residual(Yeet(residual));
/// ```
/// But to simplify this, there's a `from_yeet` lang item function which
/// handles the combined `FromResidual::from_residual(Yeet(residual))`.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:2041 lower_expr_yeet
LoweringContext.prototype.lower_expr_yeet = function (this: LoweringContext, span: Span, sub_expr: Expr | undefined): hir.ExprKind {
  // The expression (if present) or `()` otherwise.
  let yeeted_span: Span;
  let yeeted_expr: hir.Expr;
  if (sub_expr !== undefined) {
    [yeeted_span, yeeted_expr] = [sub_expr.span, this.lower_expr(sub_expr)];
  } else {
    yeeted_span = this.mark_span_with_reason(DesugaringKind.YeetExpr, span, undefined);
    yeeted_expr = this.expr_unit(span);
  }

  const unstable_span = this.mark_span_with_reason(DesugaringKind.YeetExpr, span, ALLOW_TRY_TRAIT);

  const from_yeet_expr = this.wrap_in_try_constructor(LangItem.TryTraitFromYeet, unstable_span, yeeted_expr, yeeted_span);

  const scope = this.try_block_scope;
  switch (scope.$) {
    case "Homogeneous":
    case "Heterogeneous": {
      const block_id = scope._0;
      return { $: "Break", _0: { label: undefined, target_id: Ok(block_id) }, _1: from_yeet_expr };
    }
    case "Function":
      return this.checked_return(from_yeet_expr);
  }
};

// =========================================================================
// Helper methods for building HIR.
// =========================================================================

/// Wrap the given `expr` in a terminating scope using `hir::ExprKind::DropTemps`.
///
/// In terms of drop order, it has the same effect as wrapping `expr` in
/// `{ let _t = $expr; _t }` but should provide better compile-time performance.
///
/// The drop order can be important, e.g. to drop temporaries from an `async fn`
/// body before its parameters.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:2084 expr_drop_temps
LoweringContext.prototype.expr_drop_temps = function (this: LoweringContext, span: Span, expr: hir.Expr): hir.Expr {
  return this.expr_drop_temps_mut(span, expr);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2092 expr_drop_temps_mut
LoweringContext.prototype.expr_drop_temps_mut = function (this: LoweringContext, span: Span, expr: hir.Expr): hir.Expr {
  return this.expr(span, { $: "DropTemps", _0: expr });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2100 expr_match
LoweringContext.prototype.expr_match = function (
  this: LoweringContext,
  span: Span,
  arg: hir.Expr,
  arms: readonly hir.Arm[],
  source: hir.MatchSource,
): hir.Expr {
  return this.expr(span, { $: "Match", _0: arg, _1: arms, _2: source });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2110 expr_break
LoweringContext.prototype.expr_break = function (this: LoweringContext, span: Span): hir.Expr {
  const expr_break: hir.ExprKind = { $: "Break", _0: this.lower_loop_destination(undefined), _1: undefined };
  return this.expr(span, expr_break);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2115 expr_break_alloc
LoweringContext.prototype.expr_break_alloc = function (this: LoweringContext, span: Span): hir.Expr {
  const expr_break = this.expr_break(span);
  return expr_break;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2120 expr_mut_addr_of
LoweringContext.prototype.expr_mut_addr_of = function (this: LoweringContext, span: Span, e: hir.Expr): hir.Expr {
  return this.expr(span, { $: "AddrOf", _0: "Ref", _1: "Mut", _2: e });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2124 expr_unit
LoweringContext.prototype.expr_unit = function (this: LoweringContext, sp: Span): hir.Expr {
  return this.expr(sp, { $: "Tup", _0: [] });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2128 expr_str
LoweringContext.prototype.expr_str = function (this: LoweringContext, sp: Span, value: Symbol): hir.Expr {
  const lit: hir.Lit = {
    span: this.lower_span(sp),
    node: { $: "Str", _0: value, _1: StrStyle.Cooked },
  };
  return this.expr(sp, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2136 expr_byte_str
LoweringContext.prototype.expr_byte_str = function (this: LoweringContext, sp: Span, value: ByteSymbol): hir.Expr {
  const lit: hir.Lit = {
    span: this.lower_span(sp),
    node: { $: "ByteStr", _0: value, _1: StrStyle.Cooked },
  };
  return this.expr(sp, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2144 expr_call_mut
LoweringContext.prototype.expr_call_mut = function (this: LoweringContext, span: Span, e: hir.Expr, args: readonly hir.Expr[]): hir.Expr {
  return this.expr(span, { $: "Call", _0: e, _1: args });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2153 expr_struct
LoweringContext.prototype.expr_struct = function (
  this: LoweringContext,
  span: Span,
  path: hir.QPath,
  fields: readonly hir.ExprField[],
): hir.Expr {
  return this.expr(span, { $: "Struct", _0: path, _1: fields, _2: hir.StructTailExpr.None });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2162 expr_enum_variant
LoweringContext.prototype.expr_enum_variant = function (
  this: LoweringContext,
  span: Span,
  path: hir.QPath,
  fields_: readonly hir.Expr[],
): hir.Expr {
  const fields = fields_.map(
    (f, i): hir.ExprField => ({
      hir_id: this.next_id(),
      ident: Ident.from_str(String(i)),
      expr: f,
      span: f.span,
      is_shorthand: false,
    }),
  );
  return this.expr_struct(span, path, fields);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2180 expr_enum_variant_lang_item
LoweringContext.prototype.expr_enum_variant_lang_item = function (
  this: LoweringContext,
  span: Span,
  lang_item: LangItem,
  fields: readonly hir.Expr[],
): hir.Expr {
  const path = this.make_lang_item_qpath(lang_item, span, undefined);
  return this.expr_enum_variant(span, path, fields);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2190 expr_call
LoweringContext.prototype.expr_call = function (this: LoweringContext, span: Span, e: hir.Expr, args: readonly hir.Expr[]): hir.Expr {
  return this.expr_call_mut(span, e, args);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2199 expr_call_lang_item_fn_mut
LoweringContext.prototype.expr_call_lang_item_fn_mut = function (
  this: LoweringContext,
  span: Span,
  lang_item: LangItem,
  args: readonly hir.Expr[],
): hir.Expr {
  const path = this.expr_lang_item_path(span, lang_item);
  return this.expr_call_mut(span, path, args);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2209 expr_call_lang_item_fn
LoweringContext.prototype.expr_call_lang_item_fn = function (
  this: LoweringContext,
  span: Span,
  lang_item: LangItem,
  args: readonly hir.Expr[],
): hir.Expr {
  return this.expr_call_lang_item_fn_mut(span, lang_item, args);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2218 expr_lang_item_path
LoweringContext.prototype.expr_lang_item_path = function (this: LoweringContext, span: Span, lang_item: LangItem): hir.Expr {
  const qpath = this.make_lang_item_qpath(lang_item, this.lower_span(span), undefined);
  return this.expr(span, { $: "Path", _0: qpath });
};

/// `<LangItem>::name`
// rustc: compiler/rustc_ast_lowering/src/expr.rs:2228 expr_lang_item_type_relative
LoweringContext.prototype.expr_lang_item_type_relative = function (
  this: LoweringContext,
  span: Span,
  lang_item: LangItem,
  name: Symbol,
): hir.Expr {
  const qpath = this.make_lang_item_qpath(lang_item, this.lower_span(span), undefined);
  const path: hir.ExprKind = {
    $: "Path",
    _0: {
      $: "TypeRelative",
      _0: this.ty(span, { $: "Path", _0: qpath }),
      _1: hir.PathSegment.new(Ident.new(name, this.lower_span(span)), this.next_id(), hir.def.Res.Err),
    },
  };
  return this.expr(span, path);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2246 expr_ident
LoweringContext.prototype.expr_ident = function (this: LoweringContext, sp: Span, ident: Ident, binding: HirId): hir.Expr {
  return this.expr_ident_mut(sp, ident, binding);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2255 expr_ident_mut
LoweringContext.prototype.expr_ident_mut = function (this: LoweringContext, span: Span, ident: Ident, binding: HirId): hir.Expr {
  const hir_id = this.next_id();
  const res: hir.def.Res = { $: "Local", _0: binding };
  const path_span = this.lower_span(span);
  const expr_path: hir.ExprKind = {
    $: "Path",
    _0: {
      $: "Resolved",
      _0: undefined,
      _1: new hir.Path(path_span, res, [hir.PathSegment.new(this.lower_ident(ident), hir_id, res)]),
    },
  };

  return this.expr(span, expr_path);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2275 expr_unsafe
LoweringContext.prototype.expr_unsafe = function (this: LoweringContext, span: Span, expr: hir.Expr): hir.Expr {
  const hir_id = this.next_id();
  return this.expr(span, {
    $: "Block",
    _0: new hir.Block([], expr, hir_id, { $: "UnsafeBlock", _0: hir.UnsafeSource.CompilerGenerated }, this.lower_span(span), false),
    _1: undefined,
  });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2297 expr_block_empty
LoweringContext.prototype.expr_block_empty = function (this: LoweringContext, span: Span): hir.Expr {
  const blk = this.block_all(span, [], undefined);
  const expr = this.expr_block(blk);
  return expr;
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2303 expr_block
LoweringContext.prototype.expr_block = function (this: LoweringContext, b: hir.Block): hir.Expr {
  return this.expr(b.span, { $: "Block", _0: b, _1: undefined });
};

/// Wrap an expression in a block, and wrap that block in an expression again.
/// Useful for constructing if-expressions, which require expressions of
/// kind block.
// rustc: compiler/rustc_ast_lowering/src/expr.rs:2310 block_expr_block
LoweringContext.prototype.block_expr_block = function (this: LoweringContext, expr: hir.Expr): hir.Expr {
  const b = this.block_expr(expr);
  return this.expr_block(b);
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2318 expr_ref
LoweringContext.prototype.expr_ref = function (this: LoweringContext, span: Span, expr: hir.Expr): hir.Expr {
  return this.expr(span, { $: "AddrOf", _0: "Ref", _1: "Not", _2: expr });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2322 expr_bool_literal
LoweringContext.prototype.expr_bool_literal = function (this: LoweringContext, span: Span, val: boolean): hir.Expr {
  return this.expr(span, { $: "Lit", _0: { node: { $: "Bool", _0: val }, span } });
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2326 expr
LoweringContext.prototype.expr = function (this: LoweringContext, span: Span, kind: hir.ExprKind): hir.Expr {
  const hir_id = this.next_id();
  return new hir.Expr(hir_id, kind, this.lower_span(span));
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2331 expr_field
LoweringContext.prototype.expr_field = function (this: LoweringContext, ident: Ident, expr: hir.Expr, span: Span): hir.ExprField {
  return {
    hir_id: this.next_id(),
    ident,
    span: this.lower_span(span),
    expr,
    is_shorthand: false,
  };
};

// rustc: compiler/rustc_ast_lowering/src/expr.rs:2346 arm
LoweringContext.prototype.arm = function (this: LoweringContext, pat: hir.Pat, expr: hir.Expr, span: Span): hir.Arm {
  return {
    hir_id: this.next_id(),
    pat,
    guard: undefined,
    span: this.lower_span(span),
    body: expr,
  };
};

/// `#[allow(unreachable_code)]`
// rustc: compiler/rustc_ast_lowering/src/expr.rs:2362 unreachable_code_attr
LoweringContext.prototype.unreachable_code_attr = function (this: LoweringContext, span: Span): Attribute {
  const attr_ = attr.mk_attr_nested_word(
    this.tcx.sess.psess.attr_id_generator,
    AttrStyle.Outer,
    sym.allow,
    sym.unreachable_code,
    span,
  );
  return attr_;
};

// (expr.rs:2377 `FutureKind`: expr.gen.ts)
