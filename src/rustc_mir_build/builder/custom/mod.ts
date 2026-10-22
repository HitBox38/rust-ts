// Port of compiler/rustc_mir_build/src/builder/custom/mod.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-custom-tail; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type MirDialect, type MirPhase as attrs_MirPhase } from "../../../rustc_attr_ir/lib.ts";
import { type HirId } from "../../../rustc_hir_id/lib.ts";
import { type Body, type MirPhase } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type Param, type StmtId, type Thir } from "../../../rustc_middle/thir.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { ParseCtxt, type ParseError } from "./mod.gen.ts";
import { type DefId } from "../../../rustc_span/def_id.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface ParseCtxt {
    // mod.rs:152 (lane mb-custom-tail)
    expr_error(expr: ExprId, expected: string): ParseError;
    // mod.rs:161 (lane mb-custom-tail)
    stmt_error(stmt: StmtId, expected: string): ParseError;
  }
}

// stub: compiler/rustc_mir_build/src/builder/custom/mod.rs:31 build_custom_mir (lane mb-custom-tail)
export function build_custom_mir(tcx: TyCtxt, did: DefId, hir_id: HirId, thir: Thir, expr: ExprId, params: readonly Param[], return_ty: Ty, return_ty_span: Span, span: Span, dialect: MirDialect | undefined, phase: attrs_MirPhase | undefined): Body {
  return unported("rustc_mir_build::builder::custom::build_custom_mir");
}

// stub: compiler/rustc_mir_build/src/builder/custom/mod.rs:103 parse_attribute (lane mb-custom-tail)
export function parse_attribute(dialect: MirDialect | undefined, phase: attrs_MirPhase | undefined): MirPhase {
  return unported("rustc_mir_build::builder::custom::parse_attribute");
}

// stub: compiler/rustc_mir_build/src/builder/custom/mod.rs:152 expr_error (lane mb-custom-tail)
ParseCtxt.prototype.expr_error = function (this: ParseCtxt, expr: ExprId, expected: string): ParseError {
  return unported("rustc_mir_build::builder::custom::ParseCtxt::expr_error");
};

// stub: compiler/rustc_mir_build/src/builder/custom/mod.rs:161 stmt_error (lane mb-custom-tail)
ParseCtxt.prototype.stmt_error = function (this: ParseCtxt, stmt: StmtId, expected: string): ParseError {
  return unported("rustc_mir_build::builder::custom::ParseCtxt::stmt_error");
};
