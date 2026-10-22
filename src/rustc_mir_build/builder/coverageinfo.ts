// Port of compiler/rustc_mir_build/src/builder/coverageinfo.rs: DECLARED (lane builder-contract, plan-m4 wave 22).
// `CoverageInfoBuilder::new_if_enabled` is ported (`Builder::new` calls it); every other fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-mod; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type HirId } from "../../rustc_hir_id/lib.ts";
import { type BlockMarkerId, type CoverageEarlyInfo, type PointKind } from "../../rustc_middle/mir/coverage.ts";
import { type BasicBlock, type Place, type SourceInfo } from "../../rustc_middle/mir/mod.ts";
import { type Expr, type ExprId, type Pat, type Thir } from "../../rustc_middle/thir.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { BlockMarkerGen, CoverageInfoBuilder, type NotInfo } from "./coverageinfo.gen.ts";
import { Builder, type CFG } from "./mod.ts";
import { type LocalDefId } from "../../rustc_span/def_id.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
export * from "./coverageinfo.gen.ts";

declare module "./coverageinfo.gen.ts" {
  interface BlockMarkerGen {
    // coverageinfo.rs:52 (lane mb-mod)
    next_block_marker_id(): BlockMarkerId;
    // coverageinfo.rs:58 (lane mb-mod)
    inject_block_marker(cfg: CFG, source_info: SourceInfo, block: BasicBlock): BlockMarkerId;
  }
  interface CoverageInfoBuilder {
    // coverageinfo.rs:97 (lane mb-mod)
    visit_unary_not(thir: Thir, unary_not: ExprId): void;
    // coverageinfo.rs:115 (lane mb-mod)
    visit_with_not_info(thir: Thir, expr_id: ExprId, not_info: NotInfo): void;
    // coverageinfo.rs:136 (lane mb-mod)
    register_two_way_branch(cfg: CFG, source_info: SourceInfo, true_block: BasicBlock, false_block: BasicBlock): void;
    // coverageinfo.rs:156 (lane mb-mod)
    into_done(): CoverageEarlyInfo;
    // coverageinfo.rs:167 (lane mb-mod)
    as_done(): CoverageEarlyInfo;
  }
  namespace CoverageInfoBuilder {
    // coverageinfo.rs:78 (lane mb-mod)
    export function new_if_enabled(tcx: TyCtxt, def_id: LocalDefId): CoverageInfoBuilder | undefined;
  }
}

declare module "./mod.ts" {
  interface Builder {
    // coverageinfo.rs:188 (lane mb-mod)
    push_coverage_point_for_expr(block: BasicBlock, source_info: SourceInfo, hir_id: HirId): void;
    // coverageinfo.rs:205 (lane mb-mod)
    push_coverage_point_for_implicit_else(block: BasicBlock, source_info: SourceInfo, if_expr: Expr): void;
    // coverageinfo.rs:223 (lane mb-mod)
    push_coverage_point_for_fn_end(block: BasicBlock, source_info: SourceInfo, fn_hir_id: HirId): void;
    // coverageinfo.rs:235 (lane mb-mod)
    push_coverage_point_inner(block: BasicBlock, source_info: SourceInfo, point_kind: PointKind, hir_id: HirId): void;
    // coverageinfo.rs:253 (lane mb-mod)
    visit_coverage_standalone_condition(expr_id: ExprId, place: Place, block: MutRef<BasicBlock>): void;
    // coverageinfo.rs:310 (lane mb-mod)
    visit_coverage_branch_condition(expr_id: ExprId, true_block: BasicBlock, false_block: BasicBlock): void;
    // coverageinfo.rs:337 (lane mb-mod)
    visit_coverage_conditional_let(pattern: Pat, true_block: BasicBlock, false_block: BasicBlock): void;
  }
}

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:52 next_block_marker_id (lane mb-mod)
BlockMarkerGen.prototype.next_block_marker_id = function (this: BlockMarkerGen): BlockMarkerId {
  return unported("rustc_mir_build::builder::coverageinfo::BlockMarkerGen::next_block_marker_id");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:58 inject_block_marker (lane mb-mod)
BlockMarkerGen.prototype.inject_block_marker = function (this: BlockMarkerGen, cfg: CFG, source_info: SourceInfo, block: BasicBlock): BlockMarkerId {
  return unported("rustc_mir_build::builder::coverageinfo::BlockMarkerGen::inject_block_marker");
};

/// Creates a new coverage info builder, but only if coverage instrumentation
/// is enabled and `def_id` represents a function that is eligible for coverage.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:78 new_if_enabled
(CoverageInfoBuilder as unknown as { new_if_enabled: typeof CoverageInfoBuilder.new_if_enabled }).new_if_enabled = function (tcx: TyCtxt, def_id: LocalDefId): CoverageInfoBuilder | undefined {
  if (!tcx.sess.instrument_coverage() || !tcx.is_eligible_for_coverage(def_id)) {
    return undefined;
  }

  return new CoverageInfoBuilder(
    new Map(),
    // `BlockMarkerGen::default()` (derive(Default))
    new BlockMarkerGen(0),
    // PORT: `Session::instrument_coverage_branch` (rustc_session) is not ported; reached only under
    // `-Cinstrument-coverage` for a body that is eligible for coverage.
    unported("rustc_session::session::Session::instrument_coverage_branch"),
  );
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:97 visit_unary_not (lane mb-mod)
CoverageInfoBuilder.prototype.visit_unary_not = function (this: CoverageInfoBuilder, thir: Thir, unary_not: ExprId): void {
  return unported("rustc_mir_build::builder::coverageinfo::CoverageInfoBuilder::visit_unary_not");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:115 visit_with_not_info (lane mb-mod)
CoverageInfoBuilder.prototype.visit_with_not_info = function (this: CoverageInfoBuilder, thir: Thir, expr_id: ExprId, not_info: NotInfo): void {
  return unported("rustc_mir_build::builder::coverageinfo::CoverageInfoBuilder::visit_with_not_info");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:136 register_two_way_branch (lane mb-mod)
CoverageInfoBuilder.prototype.register_two_way_branch = function (this: CoverageInfoBuilder, cfg: CFG, source_info: SourceInfo, true_block: BasicBlock, false_block: BasicBlock): void {
  return unported("rustc_mir_build::builder::coverageinfo::CoverageInfoBuilder::register_two_way_branch");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:156 into_done (lane mb-mod)
CoverageInfoBuilder.prototype.into_done = function (this: CoverageInfoBuilder): CoverageEarlyInfo {
  return unported("rustc_mir_build::builder::coverageinfo::CoverageInfoBuilder::into_done");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:167 as_done (lane mb-mod)
CoverageInfoBuilder.prototype.as_done = function (this: CoverageInfoBuilder): CoverageEarlyInfo {
  return unported("rustc_mir_build::builder::coverageinfo::CoverageInfoBuilder::as_done");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:188 push_coverage_point_for_expr (lane mb-mod)
Builder.prototype.push_coverage_point_for_expr = function (this: Builder, block: BasicBlock, source_info: SourceInfo, hir_id: HirId): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::push_coverage_point_for_expr");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:205 push_coverage_point_for_implicit_else (lane mb-mod)
Builder.prototype.push_coverage_point_for_implicit_else = function (this: Builder, block: BasicBlock, source_info: SourceInfo, if_expr: Expr): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::push_coverage_point_for_implicit_else");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:223 push_coverage_point_for_fn_end (lane mb-mod)
Builder.prototype.push_coverage_point_for_fn_end = function (this: Builder, block: BasicBlock, source_info: SourceInfo, fn_hir_id: HirId): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::push_coverage_point_for_fn_end");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:235 push_coverage_point_inner (lane mb-mod)
Builder.prototype.push_coverage_point_inner = function (this: Builder, block: BasicBlock, source_info: SourceInfo, point_kind: PointKind, hir_id: HirId): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::push_coverage_point_inner");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:253 visit_coverage_standalone_condition (lane mb-mod)
Builder.prototype.visit_coverage_standalone_condition = function (this: Builder, expr_id: ExprId, place: Place, block: MutRef<BasicBlock>): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::visit_coverage_standalone_condition");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:310 visit_coverage_branch_condition (lane mb-mod)
Builder.prototype.visit_coverage_branch_condition = function (this: Builder, expr_id: ExprId, true_block: BasicBlock, false_block: BasicBlock): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::visit_coverage_branch_condition");
};

// stub: compiler/rustc_mir_build/src/builder/coverageinfo.rs:337 visit_coverage_conditional_let (lane mb-mod)
Builder.prototype.visit_coverage_conditional_let = function (this: Builder, pattern: Pat, true_block: BasicBlock, false_block: BasicBlock): void {
  return unported("rustc_mir_build::builder::coverageinfo::Builder::visit_coverage_conditional_let");
};
