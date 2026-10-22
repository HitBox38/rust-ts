// Port of compiler/rustc_mir_build/src/builder/custom/parse.rs (lane mb-custom-tail; declared by lane builder-contract).
import { type AdtExpr, type Block, debug_PatKind, debug_Stmt, debug_StmtKind, type ExprId, type ExprKind, type LocalVarId, type Param, type Pat, type StmtId } from "../../../rustc_middle/thir.ts";
import { debug_LitKind, LitKind } from "../../../rustc_ast/lib.ts";
import { type Lit } from "../../../rustc_hir/lib.ts";
import { BasicBlock, BasicBlockData, Local, LocalDecl, SourceInfo, Statement, Terminator, type VarDebugInfoContents } from "../../../rustc_middle/mir/mod.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { debug_Spanned, type Span } from "../../../rustc_span/lib.ts";
import { sym, type Symbol } from "../../../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../../../std/fmt.ts";
import { unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import { ParseCtxt, type PResult } from "./mod.gen.ts";

/// Helper macro for parsing custom MIR.
///
/// Example usage looks something like:
/// ```rust,ignore (incomplete example)
/// parse_by_kind!(
///     self, // : &ParseCtxt
///     expr_id, // what you're matching against
///     "assignment", // the thing you're trying to parse
///     @call("mir_assign", args) => { args[0] }, // match invocations of the `mir_assign` special function
///     ExprKind::Assign { lhs, .. } => { lhs }, // match thir assignment expressions
///     // no need for fallthrough case - reasonable error is automatically generated
/// )
/// ```
// PORT: `macro_rules! parse_by_kind` is expanded at each use: `const expr_id = this.preparse(<expr_id>); const expr =
// this.thir.index_ExprId(expr_id);` (the macro's `tracing::debug!` is a comment), then an if-chain over the arms in the
// macro's order (`@call` arms, `@variant` arms, then the patterns), ending in the macro's fallthrough
// `return Err(this.expr_error(expr_id, <expected>))`. The guards of the `@call` / `@variant` arms are
// `parse_by_kind_call` / `parse_by_kind_variant` (the arm's bindings, or `undefined` when the arm does not match).
// Macro hygiene: the macro's own `expr_id` / `expr` are not visible in the arms, so an `expr_id` written in an arm is
// the caller's (the fn parameter, `expr_id_` in the ports), and `expr` only where the use binds `$expr_name` to it.

/** The `@call($name, $args)` arm of `parse_by_kind!`: `ExprKind::Call { ty, fun: _, args: $args, .. }` whose `ty` is the
 *  `FnDef` of the diagnostic item `$name`; returns `$args`. */
export function parse_by_kind_call(pctxt: ParseCtxt, kind: ExprKind, name: Symbol): readonly ExprId[] | undefined {
  if (kind.$ !== "Call") return undefined;
  const k = kind.ty.kind();
  const is = k.$ === "FnDef" ? pctxt.tcx.is_diagnostic_item(name, k._0) : false;
  return is ? kind.args : undefined;
}

/** The `@variant($adt, $variant)` arm of `parse_by_kind!`: `ExprKind::Adt(AdtExpr { adt_def, variant_index, .. })` of
 *  the diagnostic item `$adt` and its variant named `$variant`; returns the `AdtExpr`. */
export function parse_by_kind_variant(pctxt: ParseCtxt, kind: ExprKind, adt: Symbol, variant: Symbol): AdtExpr | undefined {
  if (kind.$ !== "Adt") return undefined;
  const { adt_def, variant_index } = kind._0;
  const is = pctxt.tcx.is_diagnostic_item(adt, adt_def.did()) && adt_def.variants()[variant_index]!.name === variant;
  return is ? kind._0 : undefined;
}

declare module "./mod.gen.ts" {
  interface ParseCtxt {
    // parse.rs:74 (lane mb-custom-tail)
    preparse(expr_id: ExprId): ExprId;
    // parse.rs:82 (lane mb-custom-tail)
    statement_as_expr(stmt_id: StmtId): PResult<ExprId>;
    // parse.rs:93 (lane mb-custom-tail)
    parse_args(params: readonly Param[]): PResult<null>;
    // parse.rs:151 (lane mb-custom-tail)
    parse_body(expr_id: ExprId): PResult<null>;
    // parse.rs:191 (lane mb-custom-tail)
    parse_block_decls(stmts: Iterable<StmtId>): PResult<null>;
    // parse.rs:198 (lane mb-custom-tail)
    parse_basic_block_decl(stmt: StmtId): PResult<null>;
    // parse.rs:217 (lane mb-custom-tail)
    parse_local_decls(stmts: Iterable<StmtId>): PResult<null>;
    // parse.rs:231 (lane mb-custom-tail)
    parse_debuginfo(stmts: Iterable<StmtId>): PResult<null>;
    // parse.rs:279 (lane mb-custom-tail)
    parse_let_statement(stmt_id: StmtId): PResult<[LocalVarId, Ty, Span]>;
    // parse.rs:290 (lane mb-custom-tail)
    parse_var(pat: Pat): PResult<[LocalVarId, Ty, Span]>;
    // parse.rs:301 (lane mb-custom-tail)
    parse_block_def(expr_id: ExprId, is_cleanup: boolean): PResult<BasicBlockData>;
  }
}

/// Expressions should only ever be matched on after preparsing them. This removes extra scopes
/// we don't care about.
// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:74 preparse
ParseCtxt.prototype.preparse = function (this: ParseCtxt, expr_id: ExprId): ExprId {
  const expr = this.thir.index_ExprId(expr_id);
  switch (expr.kind.$) {
    case "Scope":
      return this.preparse(expr.kind.value);
    default:
      return expr_id;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:82 statement_as_expr
ParseCtxt.prototype.statement_as_expr = function (this: ParseCtxt, stmt_id: StmtId): PResult<ExprId> {
  const kind = this.thir.index_StmtId(stmt_id).kind;
  switch (kind.$) {
    case "Expr":
      return Ok(kind.expr);
    case "Let":
      return Err({
        span: kind.pattern.span,
        item_description: format_debug(kind, debug_StmtKind, PLAIN),
        expected: "expression",
      });
  }
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:93 parse_args
ParseCtxt.prototype.parse_args = function (this: ParseCtxt, params: readonly Param[]): PResult<null> {
  for (const param of params) {
    let var_: LocalVarId;
    let span: Span;
    {
      const pat = unwrap(param.pat);
      switch (pat.kind.$) {
        case "Binding":
          [var_, span] = [pat.kind.var, pat.span];
          break;
        default: {
          return Err({
            span: pat.span,
            item_description: format_debug(pat.kind, debug_PatKind, PLAIN),
            expected: "local",
          });
        }
      }
    }
    const decl = LocalDecl.new(param.ty, span);
    // `IndexVec::push` returns the index of the new element.
    const local = Local.from_usize(this.body.local_decls.push(decl) - 1);
    this.local_map.set(var_, local);
  }

  return Ok(null);
};

/// Bodies are of the form:
///
/// ```text
/// {
///     let bb1: BasicBlock;
///     let bb2: BasicBlock;
///     {
///         let RET: _;
///         let local1;
///         let local2;
///
///         {
///             { // entry block
///                 statement1;
///                 terminator1
///             };
///
///             bb1 = {
///                 statement2;
///                 terminator2
///             };
///
///             bb2 = {
///                 statement3;
///                 terminator3
///             }
///
///             RET
///         }
///     }
/// }
/// ```
///
/// This allows us to easily parse the basic blocks declarations, local declarations, and
/// basic block definitions in order.
// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:151 parse_body
ParseCtxt.prototype.parse_body = function (this: ParseCtxt, expr_id_: ExprId): PResult<null> {
  let body: ExprId;
  {
    const expr_id = this.preparse(expr_id_);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "whole body");
    if (expr.kind.$ === "Block") {
      body = unwrap(this.thir.index_BlockId(expr.kind.block).expr);
    } else {
      return Err(this.expr_error(expr_id, "whole body"));
    }
  }
  let block_decls: readonly StmtId[];
  let rest: ExprId;
  {
    const expr_id = this.preparse(body);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "body with block decls");
    if (expr.kind.$ === "Block") {
      const block = this.thir.index_BlockId(expr.kind.block);
      [block_decls, rest] = [block.stmts, unwrap(block.expr)];
    } else {
      return Err(this.expr_error(expr_id, "body with block decls"));
    }
  }
  let r = this.parse_block_decls(block_decls.values());
  if (r.$ === "Err") return r;

  let local_decls: readonly StmtId[];
  {
    const expr_id = this.preparse(rest);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "body with local decls");
    if (expr.kind.$ === "Block") {
      const block = this.thir.index_BlockId(expr.kind.block);
      [local_decls, rest] = [block.stmts, unwrap(block.expr)];
    } else {
      return Err(this.expr_error(expr_id, "body with local decls"));
    }
  }
  r = this.parse_local_decls(local_decls.values());
  if (r.$ === "Err") return r;

  let debuginfo: readonly StmtId[];
  {
    const expr_id = this.preparse(rest);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "body with debuginfo");
    if (expr.kind.$ === "Block") {
      const block = this.thir.index_BlockId(expr.kind.block);
      [debuginfo, rest] = [block.stmts, unwrap(block.expr)];
    } else {
      return Err(this.expr_error(expr_id, "body with debuginfo"));
    }
  }
  r = this.parse_debuginfo(debuginfo.values());
  if (r.$ === "Err") return r;

  let block_defs: readonly StmtId[];
  {
    const expr_id = this.preparse(rest);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "body with block defs");
    if (expr.kind.$ === "Block") {
      block_defs = this.thir.index_BlockId(expr.kind.block).stmts;
    } else {
      return Err(this.expr_error(expr_id, "body with block defs"));
    }
  }
  for (const [i, block_def] of block_defs.entries()) {
    const is_cleanup = this.body.basic_blocks_mut()[BasicBlock.from_usize(i)]!.is_cleanup;
    const e = this.statement_as_expr(block_def);
    if (e.$ === "Err") return e;
    const block = this.parse_block_def(e._0, is_cleanup);
    if (block.$ === "Err") return block;
    this.body.basic_blocks_mut()[BasicBlock.from_usize(i)] = block._0;
  }

  return Ok(null);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:191 parse_block_decls
ParseCtxt.prototype.parse_block_decls = function (this: ParseCtxt, stmts: Iterable<StmtId>): PResult<null> {
  for (const stmt of stmts) {
    const r = this.parse_basic_block_decl(stmt);
    if (r.$ === "Err") return r;
  }
  return Ok(null);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:198 parse_basic_block_decl
ParseCtxt.prototype.parse_basic_block_decl = function (this: ParseCtxt, stmt: StmtId): PResult<null> {
  const kind = this.thir.index_StmtId(stmt).kind;
  if (kind.$ === "Let" && kind.initializer !== undefined) {
    const { pattern, initializer } = kind;
    const v = this.parse_var(pattern);
    if (v.$ === "Err") return v;
    const [var_] = v._0;
    let is_cleanup: boolean;
    {
      const expr_id = this.preparse(initializer);
      const expr = this.thir.index_ExprId(expr_id);
      // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "basic block declaration");
      if (parse_by_kind_variant(this, expr.kind, sym.mir_basic_block, sym.Normal) !== undefined) {
        is_cleanup = false;
      } else if (parse_by_kind_variant(this, expr.kind, sym.mir_basic_block, sym.Cleanup) !== undefined) {
        is_cleanup = true;
      } else {
        return Err(this.expr_error(expr_id, "basic block declaration"));
      }
    }
    const data = BasicBlockData.new(undefined, is_cleanup);
    // `IndexVec::push` returns the index of the new element.
    const block = BasicBlock.from_usize(this.body.basic_blocks_mut().push(data) - 1);
    this.block_map.set(var_, block);
    return Ok(null);
  }
  return Err(this.stmt_error(stmt, "let statement with an initializer"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:217 parse_local_decls
ParseCtxt.prototype.parse_local_decls = function (this: ParseCtxt, stmts_: Iterable<StmtId>): PResult<null> {
  const stmts = stmts_[globalThis.Symbol.iterator]();
  const first = stmts.next();
  const r = this.parse_let_statement(unwrap(first.done ? undefined : first.value));
  if (r.$ === "Err") return r;
  const [ret_var] = r._0;
  this.local_map.set(ret_var, Local.ZERO);

  for (let it = stmts.next(); !it.done; it = stmts.next()) {
    const stmt = it.value;
    const l = this.parse_let_statement(stmt);
    if (l.$ === "Err") return l;
    const [var_, ty, span] = l._0;
    const decl = LocalDecl.new(ty, span);
    // `IndexVec::push` returns the index of the new element.
    const local = Local.from_usize(this.body.local_decls.push(decl) - 1);
    this.local_map.set(var_, local);
  }

  return Ok(null);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:231 parse_debuginfo
ParseCtxt.prototype.parse_debuginfo = function (this: ParseCtxt, stmts: Iterable<StmtId>): PResult<null> {
  for (const stmt_ of stmts) {
    const stmt = this.thir.index_StmtId(stmt_);
    let expr_: ExprId;
    switch (stmt.kind.$) {
      case "Let": {
        return Err({
          span: stmt.kind.span,
          item_description: format_debug(stmt, debug_Stmt, PLAIN),
          expected: "debuginfo",
        });
      }
      case "Expr":
        expr_ = stmt.kind.expr;
        break;
    }
    const span = this.thir.index_ExprId(expr_).span;
    let name_: ExprId;
    let operand_: ExprId;
    {
      const expr_id = this.preparse(expr_);
      const expr = this.thir.index_ExprId(expr_id);
      // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "debuginfo");
      let args: readonly ExprId[] | undefined;
      if ((args = parse_by_kind_call(this, expr.kind, sym.mir_debuginfo)) !== undefined) {
        [name_, operand_] = [args[0]!, args[1]!];
      } else {
        return Err(this.expr_error(expr_id, "debuginfo"));
      }
    }
    let name: Lit;
    {
      const expr_id = this.preparse(name_);
      const expr = this.thir.index_ExprId(expr_id);
      // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "debuginfo");
      if (expr.kind.$ === "Literal" && expr.kind.neg === false) {
        name = expr.kind.lit;
      } else {
        return Err(this.expr_error(expr_id, "debuginfo"));
      }
    }
    const name_sym = LitKind.str(name.node);
    if (name_sym === undefined) {
      return Err({
        span,
        item_description: format_debug(name, (v, f) => debug_Spanned(v, f, debug_LitKind), PLAIN),
        expected: "string",
      });
    }
    const operand = this.parse_operand(operand_);
    if (operand.$ === "Err") return operand;
    let value: VarDebugInfoContents;
    switch (operand._0.$) {
      case "Constant":
        value = { $: "Const", _0: operand._0._0 };
        break;
      case "Copy":
      case "Move":
        value = { $: "Place", _0: operand._0._0 };
        break;
      case "RuntimeChecks":
        return unreachable();
    }
    const dbginfo = {
      name: name_sym,
      source_info: new SourceInfo(span, this.source_scope),
      composite: undefined,
      argument_index: undefined,
      value,
    };
    this.body.var_debug_info.push(dbginfo);
  }

  return Ok(null);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:279 parse_let_statement
ParseCtxt.prototype.parse_let_statement = function (this: ParseCtxt, stmt_id: StmtId): PResult<[LocalVarId, Ty, Span]> {
  const kind = this.thir.index_StmtId(stmt_id).kind;
  let pattern: Pat;
  switch (kind.$) {
    case "Let":
      pattern = kind.pattern;
      break;
    case "Expr": {
      return Err(this.expr_error(kind.expr, "let statement"));
    }
  }

  return this.parse_var(pattern);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:290 parse_var
ParseCtxt.prototype.parse_var = function (this: ParseCtxt, pat: Pat): PResult<[LocalVarId, Ty, Span]> {
  switch (pat.kind.$) {
    case "Binding":
      return Ok([pat.kind.var, pat.kind.ty, pat.span]);
    default:
      return Err({
        span: pat.span,
        item_description: format_debug(pat.kind, debug_PatKind, PLAIN),
        expected: "local",
      });
  }
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse.rs:301 parse_block_def
ParseCtxt.prototype.parse_block_def = function (this: ParseCtxt, expr_id_: ExprId, is_cleanup: boolean): PResult<BasicBlockData> {
  let block: Block;
  {
    const expr_id = this.preparse(expr_id_);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "basic block");
    if (expr.kind.$ === "Block") {
      block = this.thir.index_BlockId(expr.kind.block);
    } else {
      return Err(this.expr_error(expr_id, "basic block"));
    }
  }

  const data = BasicBlockData.new(undefined, is_cleanup);
  for (const stmt_id of block.stmts) {
    const stmt = this.statement_as_expr(stmt_id);
    if (stmt.$ === "Err") return stmt;
    const span = this.thir.index_ExprId(stmt._0).span;
    const statement = this.parse_statement(stmt._0);
    if (statement.$ === "Err") return statement;
    data.statements.push(Statement.new(new SourceInfo(span, this.source_scope), statement._0));
  }

  const trailing = block.expr;
  if (trailing === undefined) return Err(this.expr_error(expr_id_, "terminator"));
  const span = this.thir.index_ExprId(trailing).span;
  const terminator = this.parse_terminator(trailing);
  if (terminator.$ === "Err") return terminator;
  data.terminator = new Terminator(new SourceInfo(span, this.source_scope), terminator._0);

  return Ok(data);
};
