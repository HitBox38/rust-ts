// Port of compiler/rustc_mir_build/src/builder/coverageinfo.rs (lanes builder-contract, mb-mod; plan-m4 wave 22). The types
// are generated (coverageinfo.gen.ts); the methods of `BlockMarkerGen` / `CoverageInfoBuilder` augment that module, the
// `impl Builder` methods are put on its prototype (builder/mod.ts header: conventions).
import { HirId } from "../../rustc_hir_id/lib.ts";
import { BlockMarkerId, type CoverageEarlyInfo, PointKind, clone_BranchSpan } from "../../rustc_middle/mir/coverage.ts";
import { type BasicBlock, type Place, SourceInfo, Statement, TerminatorKind } from "../../rustc_middle/mir/mod.ts";
import { type Expr, type ExprId, type Pat, type Thir, debug_ExprKind } from "../../rustc_middle/thir.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { BlockMarkerGen, CoverageInfoBuilder, type NotInfo } from "./coverageinfo.gen.ts";
import { Builder, type CFG } from "./mod.ts";
import { type LocalDefId } from "../../rustc_span/def_id.ts";
import { PLAIN } from "../../std/fmt.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { assert, assert_matches } from "../../std/panic.ts";
export * from "./coverageinfo.gen.ts";

declare module "./coverageinfo.gen.ts" {
  interface BlockMarkerGen {
    next_block_marker_id(): BlockMarkerId;
    inject_block_marker(cfg: CFG, source_info: SourceInfo, block: BasicBlock): BlockMarkerId;
  }
  interface CoverageInfoBuilder {
    visit_unary_not(thir: Thir, unary_not: ExprId): void;
    visit_with_not_info(thir: Thir, expr_id: ExprId, not_info: NotInfo): void;
    register_two_way_branch(cfg: CFG, source_info: SourceInfo, true_block: BasicBlock, false_block: BasicBlock): void;
    into_done(): CoverageEarlyInfo;
    as_done(): CoverageEarlyInfo;
  }
  namespace CoverageInfoBuilder {
    export function new_if_enabled(tcx: TyCtxt, def_id: LocalDefId): CoverageInfoBuilder | undefined;
  }
}

declare module "./mod.ts" {
  interface Builder {
    push_coverage_point_for_expr(block: BasicBlock, source_info: SourceInfo, hir_id: HirId): void;
    push_coverage_point_for_implicit_else(block: BasicBlock, source_info: SourceInfo, if_expr: Expr): void;
    push_coverage_point_for_fn_end(block: BasicBlock, source_info: SourceInfo, fn_hir_id: HirId): void;
    push_coverage_point_inner(block: BasicBlock, source_info: SourceInfo, point_kind: PointKind, hir_id: HirId): void;
    visit_coverage_standalone_condition(expr_id: ExprId, place: Place, block: MutRef<BasicBlock>): void;
    visit_coverage_branch_condition(expr_id: ExprId, true_block: BasicBlock, false_block: BasicBlock): void;
    visit_coverage_conditional_let(pattern: Pat, true_block: BasicBlock, false_block: BasicBlock): void;
  }
}

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:52 next_block_marker_id
BlockMarkerGen.prototype.next_block_marker_id = function (this: BlockMarkerGen): BlockMarkerId {
  const id = BlockMarkerId.from_usize(this.num_block_markers);
  this.num_block_markers += 1;
  return id;
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:58 inject_block_marker
BlockMarkerGen.prototype.inject_block_marker = function (this: BlockMarkerGen, cfg: CFG, source_info: SourceInfo, block: BasicBlock): BlockMarkerId {
  const id = this.next_block_marker_id();
  const marker_statement = Statement.new(source_info, { $: "Coverage", _0: { $: "BlockMarker", id } });
  cfg.push(block, marker_statement);

  return id;
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
    // `.then(BranchInfo::default)` (derive(Default))
    tcx.sess.instrument_coverage_branch() ? { branch_spans: [] } : undefined,
  );
};

/// Unary `!` expressions inside an `if` condition are lowered by lowering
/// their argument instead, and then reversing the then/else arms of that `if`.
///
/// That's awkward for branch coverage instrumentation, so to work around that
/// we pre-emptively visit any affected `!` expressions, and record extra
/// information that [`Builder::visit_coverage_branch_condition`] can use to
/// synthesize branch instrumentation for the enclosing `!`.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:97 visit_unary_not
CoverageInfoBuilder.prototype.visit_unary_not = function (this: CoverageInfoBuilder, thir: Thir, unary_not: ExprId): void {
  const kind = thir.index_ExprId(unary_not).kind;
  // PORT: the pattern text is `stringify!` of the pattern; only reached in an ICE message.
  assert_matches(kind, kind.$ === "Unary" && kind.op === "Not", "ExprKind::Unary { op: UnOp::Not, .. }", (v) => debug_ExprKind(v, PLAIN));

  // The information collected by this visitor is only needed when branch
  // coverage or higher is enabled.
  if (this.branch_info === undefined) {
    return;
  }

  this.visit_with_not_info(
    thir,
    unary_not,
    // Set `is_flipped: false` for the `!` itself, so that its enclosed
    // expression will have `is_flipped: true`.
    { enclosing_not: unary_not, is_flipped: false },
  );
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:115 visit_with_not_info
CoverageInfoBuilder.prototype.visit_with_not_info = function (this: CoverageInfoBuilder, thir: Thir, expr_id: ExprId, not_info: NotInfo): void {
  if (this.nots.has(expr_id)) {
    // This expression has already been marked by an enclosing `!`.
    return;
  } else {
    this.nots.set(expr_id, not_info);
  }

  const kind = thir.index_ExprId(expr_id).kind;
  switch (kind.$) {
    case "Unary":
      if (kind.op === "Not") {
        const arg = kind.arg;
        // Invert the `is_flipped` flag for the contents of this `!`.
        const not_info_: NotInfo = { ...not_info, is_flipped: !not_info.is_flipped };
        this.visit_with_not_info(thir, arg, not_info_);
      }
      break;
    case "Scope":
      this.visit_with_not_info(thir, kind.value, not_info);
      break;
    case "ValueExpr":
      this.visit_with_not_info(thir, kind.source, not_info);
      break;
    // All other expressions (including `&&` and `||`) don't need any
    // special handling of their contents, so stop visiting.
    default:
      break;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:136 register_two_way_branch
CoverageInfoBuilder.prototype.register_two_way_branch = function (this: CoverageInfoBuilder, cfg: CFG, source_info: SourceInfo, true_block: BasicBlock, false_block: BasicBlock): void {
  // Bail out if branch coverage is not enabled.
  const branch_info = this.branch_info;
  if (branch_info === undefined) return;

  const true_marker = this.markers.inject_block_marker(cfg, source_info, true_block);
  const false_marker = this.markers.inject_block_marker(cfg, source_info, false_block);

  branch_info.branch_spans.push({ span: source_info.span, true_marker, false_marker });
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:156 into_done
CoverageInfoBuilder.prototype.into_done = function (this: CoverageInfoBuilder): CoverageEarlyInfo {
  const {
    markers: { num_block_markers },
    branch_info,
  } = this;

  const branch_spans = branch_info === undefined ? [] : branch_info.branch_spans;

  // For simplicity, always return an info struct (without Option), even
  // if there's nothing interesting in it.
  return { num_block_markers, branch_spans };
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:167 as_done
CoverageInfoBuilder.prototype.as_done = function (this: CoverageInfoBuilder): CoverageEarlyInfo {
  const {
    markers: { num_block_markers },
    branch_info,
  } = this;

  // PORT: `.to_owned()` of a `[BranchSpan]` is the generated element clone.
  const branch_spans = (branch_info === undefined ? [] : branch_info.branch_spans).map(clone_BranchSpan);

  // For simplicity, always return an info struct (without Option), even
  // if there's nothing interesting in it.
  return { num_block_markers, branch_spans };
};

/// Does nothing if `-Cinstrument-coverage` is not enabled.
///
/// Otherwise, pushes a marker statement to `block` indicating that this is where
/// the HIR expression `hir_id` is being evaluated.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:188 push_coverage_point_for_expr
Builder.prototype.push_coverage_point_for_expr = function (this: Builder, block: BasicBlock, source_info: SourceInfo, hir_id: HirId): void {
  if (!this.tcx.sess.instrument_coverage()) {
    return;
  }
  this.push_coverage_point_inner(block, source_info, PointKind.Expr, hir_id);
};

/// Does nothing if `-Cinstrument-coverage` is not enabled.
///
/// Otherwise, pushes a marker statement to `block` indicating that this is where
/// the one-sided if-expression `if_expr` will generate its synthetic `else {}`
/// path, since it lacks an explicit `else` block.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:205 push_coverage_point_for_implicit_else
Builder.prototype.push_coverage_point_for_implicit_else = function (this: Builder, block: BasicBlock, source_info: SourceInfo, if_expr: Expr): void {
  if (!this.tcx.sess.instrument_coverage()) {
    return;
  }
  // Recover the full HirId by combining a local ID with the function's owner ID.
  const hir_id = new HirId(this.hir_id.owner, if_expr.temp_scope_id);
  this.push_coverage_point_inner(block, source_info, PointKind.ImplicitElse, hir_id);
};

/// Does nothing if `-Cinstrument-coverage` is not enabled.
///
/// Otherwise, pushes a marker statement to `block` indicating that this is where
/// the function `fn_hir_id` would implicitly return at the end of its body.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:223 push_coverage_point_for_fn_end
Builder.prototype.push_coverage_point_for_fn_end = function (this: Builder, block: BasicBlock, source_info: SourceInfo, fn_hir_id: HirId): void {
  if (!this.tcx.sess.instrument_coverage()) {
    return;
  }
  this.push_coverage_point_inner(block, source_info, PointKind.FunctionEnd, fn_hir_id);
};

// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:235 push_coverage_point_inner
Builder.prototype.push_coverage_point_inner = function (this: Builder, block: BasicBlock, source_info: SourceInfo, point_kind: PointKind, hir_id: HirId): void {
  assert(this.tcx.sess.instrument_coverage(), "assertion failed: self.tcx.sess.instrument_coverage()");

  const stmt = Statement.new(source_info, { $: "Coverage", _0: { $: "Point", point_kind, hir_id } });
  this.cfg.push(block, stmt);
};

/// If condition coverage is enabled, inject extra blocks and marker statements
/// that will let us track the value of the condition in `place`.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:253 visit_coverage_standalone_condition
Builder.prototype.visit_coverage_standalone_condition = function (
  this: Builder,
  expr_id: ExprId, // Expression giving the span of the condition
  place: Place, // Already holds the boolean condition value
  block: MutRef<BasicBlock>,
): void {
  // Bail out if condition coverage is not enabled for this function.
  const coverage_info = this.coverage_info;
  if (coverage_info === undefined) return;
  if (!this.tcx.sess.instrument_coverage_condition()) {
    return;
  }

  // Remove any wrappers, so that we can inspect the real underlying expression.
  for (;;) {
    const kind = this.thir.index_ExprId(expr_id).kind;
    if (kind.$ === "ValueExpr") expr_id = kind.source;
    else if (kind.$ === "Scope") expr_id = kind.value;
    else break;
  }
  // If the expression is a lazy logical op, it will naturally get branch
  // coverage as part of its normal lowering, so we can disregard it here.
  if (this.thir.index_ExprId(expr_id).kind.$ === "LogicalOp") {
    return;
  }

  const source_info = new SourceInfo(this.thir.index_ExprId(expr_id).span, this.source_scope);

  // Using the boolean value that has already been stored in `place`, set up
  // control flow in the shape of a diamond, so that we can place separate
  // marker statements in the true and false blocks. The coverage MIR pass
  // will use those markers to inject coverage counters as appropriate.
  //
  //          block
  //         /     \
  // true_block   false_block
  //  (marker)     (marker)
  //         \     /
  //        join_block

  const true_block = this.cfg.start_new_block();
  const false_block = this.cfg.start_new_block();
  this.cfg.terminate(block.value, source_info, TerminatorKind.if_({ $: "Copy", _0: place }, true_block, false_block));

  coverage_info.register_two_way_branch(this.cfg, source_info, true_block, false_block);

  const join_block = this.cfg.start_new_block();
  this.cfg.goto(true_block, source_info, join_block);
  this.cfg.goto(false_block, source_info, join_block);
  // Any subsequent codegen in the caller should use the new join block.
  block.value = join_block;
};

/// If branch coverage is enabled, inject marker statements into `true_block`
/// and `false_block`, and record their IDs in the table of branch spans.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:310 visit_coverage_branch_condition
Builder.prototype.visit_coverage_branch_condition = function (this: Builder, expr_id: ExprId, true_block: BasicBlock, false_block: BasicBlock): void {
  // Bail out if coverage is not enabled for this function.
  const coverage_info = this.coverage_info;
  if (coverage_info === undefined) return;

  // If this condition expression is nested within one or more `!` expressions,
  // replace it with the enclosing `!` collected by `visit_unary_not`.
  const not_info = coverage_info.nots.get(expr_id);
  if (not_info !== undefined) {
    const { enclosing_not, is_flipped } = not_info;
    expr_id = enclosing_not;
    if (is_flipped) {
      [true_block, false_block] = [false_block, true_block];
    }
  }

  const source_info = new SourceInfo(this.thir.index_ExprId(expr_id).span, this.source_scope);

  coverage_info.register_two_way_branch(this.cfg, source_info, true_block, false_block);
};

/// If branch coverage is enabled, inject marker statements into `true_block`
/// and `false_block`, and record their IDs in the table of branches.
///
/// Used to instrument let-else and if-let (including let-chains) for branch coverage.
// rustc: compiler/rustc_mir_build/src/builder/coverageinfo.rs:337 visit_coverage_conditional_let
Builder.prototype.visit_coverage_conditional_let = function (
  this: Builder,
  pattern: Pat, // Pattern that has been matched when the true path is taken
  true_block: BasicBlock,
  false_block: BasicBlock,
): void {
  // Bail out if coverage is not enabled for this function.
  const coverage_info = this.coverage_info;
  if (coverage_info === undefined) return;

  const source_info = new SourceInfo(pattern.span, this.source_scope);
  coverage_info.register_two_way_branch(this.cfg, source_info, true_block, false_block);
};
