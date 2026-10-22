// Port of compiler/rustc_mir_build/src/builder/custom/mod.rs (lane mb-custom-tail; declared by lane builder-contract).
//
// PORT: `ParseCtxt` (generated, mod.gen.ts) holds `body: &'a mut Body` as the `Body` object (mutated in place) and its
// `FxHashMap<LocalVarId, _>` fields as `KeyedMap`s keyed by `key_LocalVarId` (builder/mod.ts; decision 6 of
// docs/handoff/builder-contract.md). Its methods are split over mod.ts / parse.ts / parse/instruction.ts like upstream's
// `impl ParseCtxt` blocks (prototype assignments, PORTING §5).
//! Provides the implementation of the `custom_mir` attribute.
//!
//! Up until MIR building, this attribute has absolutely no effect. The `mir!` macro is a normal
//! decl macro that expands like any other, and the code goes through parsing, name resolution and
//! type checking like all other code. In MIR building we finally detect whether this attribute is
//! present, and if so we branch off into this module, which implements the attribute by
//! implementing a custom lowering from THIR to MIR.
//!
//! The result of this lowering is returned "normally" from `build_mir`, with the only
//! notable difference being that the `injected` field in the body is set. Various components of the
//! MIR pipeline, like borrowck and the pass manager will then consult this field (via
//! `body.should_skip()`) to skip the parts of the MIR pipeline that precede the MIR phase the user
//! specified.
//!
//! This file defines the general framework for the custom parsing. The parsing for all the
//! "top-level" constructs can be found in the `parse` submodule, while the parsing for statements,
//! terminators, and everything below can be found in the `parse::instruction` submodule.
//!
import { type MirDialect, type MirPhase as attrs_MirPhase } from "../../../rustc_attr_ir/lib.ts";
import { type HirId } from "../../../rustc_hir_id/lib.ts";
import { BasicBlockData, BasicBlocks, Body, LocalDecl, MirPhase, MirSource, OUTERMOST_SOURCE_SCOPE, SourceScopeData } from "../../../rustc_middle/mir/mod.ts";
import { debug_ExprKind, debug_StmtKind, type ExprId, type Param, type StmtId, type Thir } from "../../../rustc_middle/thir.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type DefId } from "../../../rustc_span/def_id.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { debug_str, format_debug, PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import { key_LocalVarId } from "../mod.ts";
import { ParseCtxt, type ParseError } from "./mod.gen.ts";
export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface ParseCtxt {
    // mod.rs:152 (lane mb-custom-tail)
    expr_error(expr: ExprId, expected: string): ParseError;
    // mod.rs:161 (lane mb-custom-tail)
    stmt_error(stmt: StmtId, expected: string): ParseError;
  }
}

// rustc: compiler/rustc_mir_build/src/builder/custom/mod.rs:31 build_custom_mir
export function build_custom_mir(tcx: TyCtxt, did: DefId, hir_id: HirId, thir: Thir, expr: ExprId, params: readonly Param[], return_ty: Ty, return_ty_span: Span, span: Span, dialect: MirDialect | undefined, phase: attrs_MirPhase | undefined): Body {
  const body = new Body(
    /* basic_blocks */ BasicBlocks.new([]),
    /* phase */ MirPhase.Built,
    /* pass_count */ 0,
    /* source */ MirSource.item(did),
    /* source_scopes */ [],
    /* coroutine */ undefined,
    /* local_decls */ [],
    /* user_type_annotations */ [],
    /* arg_count */ params.length,
    /* spread_arg */ undefined,
    /* var_debug_info */ [],
    /* span */ span,
    /* required_consts */ undefined,
    /* mentioned_items */ undefined,
    /* is_polymorphic */ false,
    /* injection_phase */ undefined,
    /* tainted_by_errors */ undefined,
    /* coverage_early_info */ undefined,
    /* coverage_mir_info */ undefined,
  );

  body.local_decls.push(LocalDecl.new(return_ty, return_ty_span));
  body.basic_blocks_mut().push(BasicBlockData.new(undefined, false));
  body.source_scopes.push(new SourceScopeData(span, undefined, undefined, undefined, { $: "Set", _0: { lint_root: hir_id } }));
  body.injection_phase = parse_attribute(dialect, phase);

  const pctxt = new ParseCtxt(
    tcx,
    body.typing_env(tcx),
    thir,
    OUTERMOST_SOURCE_SCOPE,
    body,
    new KeyedMap(key_LocalVarId),
    new KeyedMap(key_LocalVarId),
  );

  // PORT: the `try { a?; b?; }` block: the first `Err` is the block's value.
  let res = pctxt.parse_args(params);
  if (res.$ === "Ok") {
    res = pctxt.parse_body(expr);
  }
  if (res.$ === "Err") {
    const err = res._0;
    tcx.dcx().span_fatal(err.span, `Could not parse ${err.expected}, found: ${debug_str(err.item_description)}`);
  }

  return body;
}

/// Turns the arguments passed to `#[custom_mir(..)]` into a proper
/// [`MirPhase`]. Panics if this isn't possible for any reason.
// rustc: compiler/rustc_mir_build/src/builder/custom/mod.rs:103 parse_attribute
export function parse_attribute(dialect: MirDialect | undefined, phase: attrs_MirPhase | undefined): MirPhase {
  if (dialect === undefined) {
    // Caught during attribute checking.
    assert(phase === undefined);
    return MirPhase.Built;
  }

  switch (dialect) {
    case "Built":
      // Caught during attribute checking.
      assert(phase === undefined, "Cannot specify a phase for `Built` MIR");
      return MirPhase.Built;
    case "Analysis":
      switch (phase) {
        case undefined:
        case "Initial":
          return { $: "Analysis", _0: "Initial" };

        case "PostCleanup":
          return { $: "Analysis", _0: "PostCleanup" };

        case "Optimized":
          // Caught during attribute checking.
          return bug("`optimized` dialect is not compatible with the `analysis` dialect");
      }
      break;

    case "Runtime":
      switch (phase) {
        case undefined:
        case "Initial":
          return { $: "Runtime", _0: "Initial" };
        case "PostCleanup":
          return { $: "Runtime", _0: "PostCleanup" };
        case "Optimized":
          return { $: "Runtime", _0: "Optimized" };
      }
  }
}

// rustc: compiler/rustc_mir_build/src/builder/custom/mod.rs:152 expr_error
ParseCtxt.prototype.expr_error = function (this: ParseCtxt, expr_: ExprId, expected: string): ParseError {
  const expr = this.thir.index_ExprId(expr_);
  return {
    span: expr.span,
    item_description: format_debug(expr.kind, debug_ExprKind, PLAIN),
    expected: expected,
  };
};

// rustc: compiler/rustc_mir_build/src/builder/custom/mod.rs:161 stmt_error
ParseCtxt.prototype.stmt_error = function (this: ParseCtxt, stmt_: StmtId, expected: string): ParseError {
  const stmt = this.thir.index_StmtId(stmt_);
  let span: Span;
  switch (stmt.kind.$) {
    case "Expr":
      span = this.thir.index_ExprId(stmt.kind.expr).span;
      break;
    case "Let":
      span = stmt.kind.span;
      break;
  }
  return {
    span,
    item_description: format_debug(stmt.kind, debug_StmtKind, PLAIN),
    expected: expected,
  };
};
