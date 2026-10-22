// Port of compiler/rustc_mir_build/src/builder/custom/parse.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-custom-tail; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type BasicBlockData } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type LocalVarId, type Param, type Pat, type StmtId } from "../../../rustc_middle/thir.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { ParseCtxt, type PResult } from "./mod.gen.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";

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

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:74 preparse (lane mb-custom-tail)
ParseCtxt.prototype.preparse = function (this: ParseCtxt, expr_id: ExprId): ExprId {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::preparse");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:82 statement_as_expr (lane mb-custom-tail)
ParseCtxt.prototype.statement_as_expr = function (this: ParseCtxt, stmt_id: StmtId): PResult<ExprId> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::statement_as_expr");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:93 parse_args (lane mb-custom-tail)
ParseCtxt.prototype.parse_args = function (this: ParseCtxt, params: readonly Param[]): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_args");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:151 parse_body (lane mb-custom-tail)
ParseCtxt.prototype.parse_body = function (this: ParseCtxt, expr_id: ExprId): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_body");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:191 parse_block_decls (lane mb-custom-tail)
ParseCtxt.prototype.parse_block_decls = function (this: ParseCtxt, stmts: Iterable<StmtId>): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_block_decls");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:198 parse_basic_block_decl (lane mb-custom-tail)
ParseCtxt.prototype.parse_basic_block_decl = function (this: ParseCtxt, stmt: StmtId): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_basic_block_decl");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:217 parse_local_decls (lane mb-custom-tail)
ParseCtxt.prototype.parse_local_decls = function (this: ParseCtxt, stmts: Iterable<StmtId>): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_local_decls");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:231 parse_debuginfo (lane mb-custom-tail)
ParseCtxt.prototype.parse_debuginfo = function (this: ParseCtxt, stmts: Iterable<StmtId>): PResult<null> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_debuginfo");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:279 parse_let_statement (lane mb-custom-tail)
ParseCtxt.prototype.parse_let_statement = function (this: ParseCtxt, stmt_id: StmtId): PResult<[LocalVarId, Ty, Span]> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_let_statement");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:290 parse_var (lane mb-custom-tail)
ParseCtxt.prototype.parse_var = function (this: ParseCtxt, pat: Pat): PResult<[LocalVarId, Ty, Span]> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_var");
};

// stub: compiler/rustc_mir_build/src/builder/custom/parse.rs:301 parse_block_def (lane mb-custom-tail)
ParseCtxt.prototype.parse_block_def = function (this: ParseCtxt, expr_id: ExprId, is_cleanup: boolean): PResult<BasicBlockData> {
  return unported("rustc_mir_build::builder::custom::parse::ParseCtxt::parse_block_def");
};
