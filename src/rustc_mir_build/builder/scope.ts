// Port of compiler/rustc_mir_build/src/builder/scope.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Ported here
// (what `Builder::new` needs): `DropTree::new`, `Scopes::new`, `Builder::new_source_scope`, `Builder::source_info`, and the
// `DropTreeBuilder` trait declaration. Every other fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-scope; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type HirId } from "../../rustc_hir_id/lib.ts";
import { type Scope as region_Scope } from "../../rustc_middle/middle/region.ts";
import { type ErrorHandled } from "../../rustc_middle/mir/interpret/mod.ts";
import { type AssertMessage, type BasicBlock, ClearCrossCrate, type ConstOperand, Local, type LocalDecl, type Operand, type Place, type Rvalue, SourceInfo, type SourceScope, SourceScopeData, type SourceScopeLocalData } from "../../rustc_middle/mir/mod.ts";
import { type ArmId, type ExprId } from "../../rustc_middle/thir.ts";
import { type ValTree } from "../../rustc_middle/ty/consts/valtree.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { type BuiltMatchTree } from "./matches/mod.gen.ts";
import { Builder, type BlockAnd, type CFG } from "./mod.ts";
import { DropIdx, DropKind, DropTree, Scope, Scopes, type BreakableTarget, type DropData, type DropNode, type DropNodeKey, type LintLevel } from "./scope.gen.ts";
import { DUMMY_SP, type Span, type Spanned } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { type Result } from "../../std/result.ts";
import { unported } from "../../std/panic.ts";
export * from "./scope.gen.ts";

declare module "./scope.gen.ts" {
  interface Scope {
    // scope.rs:268 (lane mb-scope)
    needs_cleanup(): boolean;
    // scope.rs:275 (lane mb-scope)
    invalidate_cache(): void;
  }
  interface DropTree {
    // scope.rs:310 (lane mb-scope)
    add_drop(data: DropData, next: DropIdx): DropIdx;
    // scope.rs:323 (lane mb-scope)
    add_entry_point(from: BasicBlock, to: DropIdx): void;
    // scope.rs:329 (lane mb-scope)
    build_mir(cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[];
    // scope.rs:343 (lane mb-scope)
    assign_blocks(cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[];
    // scope.rs:414 (lane mb-scope)
    link_blocks(cfg: CFG, blocks: readonly (BasicBlock | undefined)[]): void;
  }
  namespace DropTree {
    // scope.rs:294 (lane mb-scope)
    function new_(): DropTree;
    export { new_ as new };
  }
  interface Scopes {
    // scope.rs:491 (lane mb-scope)
    push_scope(region_scope: region_Scope, vis_scope: SourceScope): void;
    // scope.rs:503 (lane mb-scope)
    pop_scope(region_scope: region_Scope): void;
    // scope.rs:509 (lane mb-scope)
    stack_index(region_scope: region_Scope, span: Span): number;
    // scope.rs:518 (lane mb-scope)
    topmost(): region_Scope;
  }
  namespace Scopes {
    // scope.rs:480 (lane mb-scope)
    function new_(): Scopes;
    export { new_ as new };
  }
}

declare module "./mod.ts" {
  interface Builder {
    // scope.rs:537 (lane mb-scope)
    in_breakable_scope(loop_block: BasicBlock | undefined, break_destination: Place, span: Span, f: (this_: Builder) => BlockAnd<null> | undefined): BlockAnd<null>;
    // scope.rs:586 (lane mb-scope)
    in_const_continuable_scope(arms: ArmId[], built_match_tree: BuiltMatchTree, state_place: Place, span: Span, f: (this_: Builder) => BlockAnd<null>): BlockAnd<null>;
    // scope.rs:655 (lane mb-scope)
    in_if_then_scope(region_scope: region_Scope, span: Span, f: (this_: Builder) => BlockAnd<null>): [BasicBlock, BasicBlock];
    // scope.rs:683 (lane mb-scope)
    in_scope<R>([region_scope, source_info]: [region_Scope, SourceInfo], lint_level: LintLevel, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R>;
    // scope.rs:709 (lane mb-scope)
    opt_in_scope<R>(opt_region_scope: [region_Scope, SourceInfo] | undefined, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R>;
    // scope.rs:725 (lane mb-scope)
    push_scope(region_scope: region_Scope): void;
    // scope.rs:732 (lane mb-scope)
    pop_scope(region_scope: region_Scope, block: BasicBlock): BlockAnd<null>;
    // scope.rs:746 (lane mb-scope)
    break_scope(block: BasicBlock, value: ExprId | undefined, target: BreakableTarget, source_info: SourceInfo): BlockAnd<null>;
    // scope.rs:834 (lane mb-scope)
    eval_unevaluated_mir_constant_to_valtree(constant: ConstOperand): Result<[ValTree, Ty], ErrorHandled>;
    // scope.rs:870 (lane mb-scope)
    break_const_continuable_scope(block: BasicBlock, value: ExprId, scope: region_Scope, source_info: SourceInfo): BlockAnd<null>;
    // scope.rs:1058 (lane mb-scope)
    break_from_if_then_scope(block: BasicBlock, source_info: SourceInfo): void;
    // scope.rs:1091 (lane mb-scope)
    break_for_tail_call(block: BasicBlock, args: readonly Spanned<Operand>[], source_info: SourceInfo): BlockAnd<null>;
    // scope.rs:1212 (lane mb-scope)
    is_async_drop(local: Local): boolean;
    // scope.rs:1216 (lane mb-scope)
    leave_top_scope(block: BasicBlock): BasicBlock;
    // scope.rs:1246 (lane mb-scope)
    maybe_new_source_scope(span: Span, current_id: HirId, parent_id: HirId): void;
    // scope.rs:1284 (lane mb-scope)
    maybe_lint_level_root_bounded(orig_id: HirId): HirId;
    // scope.rs:1331 (lane mb-scope)
    new_source_scope(span: Span, lint_level: LintLevel): SourceScope;
    // scope.rs:1357 (lane mb-scope)
    source_info(span: Span): SourceInfo;
    // scope.rs:1383 (lane mb-scope)
    local_scope(): region_Scope;
    // scope.rs:1394 (lane mb-scope)
    schedule_drop(span: Span, region_scope: region_Scope, local: Local, drop_kind: DropKind): void;
    // scope.rs:1477 (lane mb-scope)
    schedule_drop_storage(span: Span, region_scope: region_Scope, local: Local): void;
    // scope.rs:1495 (lane mb-scope)
    schedule_drop_value(span: Span, region_scope: region_Scope, local: Local): void;
    // scope.rs:1510 (lane mb-scope)
    schedule_backwards_incompatible_drop(span: Span, region_scope: region_Scope, local: Local): void;
    // scope.rs:1557 (lane mb-scope)
    record_operands_moved(operands: readonly Spanned<Operand>[]): void;
    // scope.rs:1585 (lane mb-scope)
    diverge_cleanup(): DropIdx;
    // scope.rs:1595 (lane mb-scope)
    diverge_cleanup_target(target_scope: region_Scope, span: Span): DropIdx;
    // scope.rs:1628 (lane mb-scope)
    diverge_from(start: BasicBlock): void;
    // scope.rs:1647 (lane mb-scope)
    diverge_dropline(): DropIdx;
    // scope.rs:1654 (lane mb-scope)
    diverge_dropline_target(target_scope: region_Scope, span: Span): DropIdx;
    // scope.rs:1688 (lane mb-scope)
    coroutine_drop_cleanup(yield_block: BasicBlock): void;
    // scope.rs:1702 (lane mb-scope)
    build_drop_and_replace(block: BasicBlock, span: Span, place: Place, value: Rvalue): BlockAnd<null>;
    // scope.rs:1738 (lane mb-scope)
    assert(block: BasicBlock, cond: Operand, expected: boolean, msg: AssertMessage, span: Span): BasicBlock;
    // scope.rs:1770 (lane mb-scope)
    clear_match_arm_and_guard_scopes(region_scope: region_Scope): void;
    // scope.rs:1969 (lane mb-scope)
    build_exit_tree(drops: DropTree, else_scope: region_Scope, span: Span, continue_block: BasicBlock | undefined): BlockAnd<null> | undefined;
    // scope.rs:2041 (lane mb-scope)
    build_drop_trees(): void;
    // scope.rs:2054 (lane mb-scope)
    build_coroutine_drop_trees(): void;
  }
  namespace Builder {
    // scope.rs:1200 (lane mb-scope)
    export function is_async_drop_impl(tcx: TyCtxt, local_decls: LocalDecl[], typing_env: TypingEnv, local: Local): boolean;
    // scope.rs:2091 (lane mb-scope)
    export function build_unwind_tree(cfg: CFG, drops: DropTree, fn_span: Span, resume_block: MutRef<BasicBlock | undefined>): void;
  }
}

// stub: compiler/rustc_mir_build/src/builder/scope.rs:268 needs_cleanup (lane mb-scope)
Scope.prototype.needs_cleanup = function (this: Scope): boolean {
  return unported("rustc_mir_build::builder::scope::Scope::needs_cleanup");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:275 invalidate_cache (lane mb-scope)
Scope.prototype.invalidate_cache = function (this: Scope): void {
  return unported("rustc_mir_build::builder::scope::Scope::invalidate_cache");
};

/// A trait that determined how [DropTree] creates its blocks and
/// links to any entry nodes.
// PORT: a trait of associated fns (no `self`) implemented by unit structs: an impl table (`DropTreeBuilder_ExitScopes`,
// `DropTreeBuilder_CoroutineDrop`, `DropTreeBuilder_Unwind`); `T: DropTreeBuilder` type parameters are a `T_` parameter.
export interface DropTreeBuilder {
  /// Create a new block for the tree. This should call either
  /// `cfg.start_new_block()` or `cfg.start_new_cleanup_block()`.
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:286 make_block
  make_block(cfg: CFG): BasicBlock;

  /// Links a block outside the drop tree, `from`, to the block `to` inside
  /// the drop tree.
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:290 link_entry_point
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void;
}

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:294 new
(DropTree as unknown as { new: typeof DropTree.new }).new = function (): DropTree {
  // The root node of the tree doesn't represent a drop, but instead
  // represents the block in the tree that should be jumped to once all
  // of the required drops have been performed.
  const fake_source_info = SourceInfo.outermost(DUMMY_SP);
  const fake_data: DropData = { source_info: fake_source_info, local: Local.MAX, kind: DropKind.Storage };
  const drop_nodes: DropNode[] = [{ data: fake_data, next: DropIdx.MAX }];
  // PORT: `existing_drops_map: FxHashMap<DropNodeKey, DropIdx>` is a `KeyedMap` keyed by `key_DropNodeKey`.
  return new DropTree(drop_nodes, new KeyedMap(key_DropNodeKey), []);
};

/** `FxHashMap<DropNodeKey, DropIdx>` key (derived `Hash` + `Eq` of `DropNodeKey { next, local }`). */
export function key_DropNodeKey(k: DropNodeKey): string {
  return `${k.next},${k.local}`;
}

// stub: compiler/rustc_mir_build/src/builder/scope.rs:310 add_drop (lane mb-scope)
DropTree.prototype.add_drop = function (this: DropTree, data: DropData, next: DropIdx): DropIdx {
  return unported("rustc_mir_build::builder::scope::DropTree::add_drop");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:323 add_entry_point (lane mb-scope)
DropTree.prototype.add_entry_point = function (this: DropTree, from: BasicBlock, to: DropIdx): void {
  return unported("rustc_mir_build::builder::scope::DropTree::add_entry_point");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:329 build_mir (lane mb-scope)
DropTree.prototype.build_mir = function (this: DropTree, cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[] {
  return unported("rustc_mir_build::builder::scope::DropTree::build_mir");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:343 assign_blocks (lane mb-scope)
DropTree.prototype.assign_blocks = function (this: DropTree, cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[] {
  return unported("rustc_mir_build::builder::scope::DropTree::assign_blocks");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:414 link_blocks (lane mb-scope)
DropTree.prototype.link_blocks = function (this: DropTree, cfg: CFG, blocks: readonly (BasicBlock | undefined)[]): void {
  return unported("rustc_mir_build::builder::scope::DropTree::link_blocks");
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:480 new
(Scopes as unknown as { new: typeof Scopes.new }).new = function (): Scopes {
  return new Scopes([], [], [], undefined, DropTree.new(), DropTree.new());
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:491 push_scope (lane mb-scope)
Scopes.prototype.push_scope = function (this: Scopes, region_scope: region_Scope, vis_scope: SourceScope): void {
  return unported("rustc_mir_build::builder::scope::Scopes::push_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:503 pop_scope (lane mb-scope)
Scopes.prototype.pop_scope = function (this: Scopes, region_scope: region_Scope): void {
  return unported("rustc_mir_build::builder::scope::Scopes::pop_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:509 stack_index (lane mb-scope)
Scopes.prototype.stack_index = function (this: Scopes, region_scope: region_Scope, span: Span): number {
  return unported("rustc_mir_build::builder::scope::Scopes::stack_index");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:518 topmost (lane mb-scope)
Scopes.prototype.topmost = function (this: Scopes): region_Scope {
  return unported("rustc_mir_build::builder::scope::Scopes::topmost");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:537 in_breakable_scope (lane mb-scope)
Builder.prototype.in_breakable_scope = function (this: Builder, loop_block: BasicBlock | undefined, break_destination: Place, span: Span, f: (this_: Builder) => BlockAnd<null> | undefined): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::in_breakable_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:586 in_const_continuable_scope (lane mb-scope)
Builder.prototype.in_const_continuable_scope = function (this: Builder, arms: ArmId[], built_match_tree: BuiltMatchTree, state_place: Place, span: Span, f: (this_: Builder) => BlockAnd<null>): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::in_const_continuable_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:655 in_if_then_scope (lane mb-scope)
Builder.prototype.in_if_then_scope = function (this: Builder, region_scope: region_Scope, span: Span, f: (this_: Builder) => BlockAnd<null>): [BasicBlock, BasicBlock] {
  return unported("rustc_mir_build::builder::scope::Builder::in_if_then_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:683 in_scope (lane mb-scope)
Builder.prototype.in_scope = function <R>(this: Builder, [region_scope, source_info]: [region_Scope, SourceInfo], lint_level: LintLevel, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R> {
  return unported("rustc_mir_build::builder::scope::Builder::in_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:709 opt_in_scope (lane mb-scope)
Builder.prototype.opt_in_scope = function <R>(this: Builder, opt_region_scope: [region_Scope, SourceInfo] | undefined, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R> {
  return unported("rustc_mir_build::builder::scope::Builder::opt_in_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:725 push_scope (lane mb-scope)
Builder.prototype.push_scope = function (this: Builder, region_scope: region_Scope): void {
  return unported("rustc_mir_build::builder::scope::Builder::push_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:732 pop_scope (lane mb-scope)
Builder.prototype.pop_scope = function (this: Builder, region_scope: region_Scope, block: BasicBlock): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::pop_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:746 break_scope (lane mb-scope)
Builder.prototype.break_scope = function (this: Builder, block: BasicBlock, value: ExprId | undefined, target: BreakableTarget, source_info: SourceInfo): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::break_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:834 eval_unevaluated_mir_constant_to_valtree (lane mb-scope)
Builder.prototype.eval_unevaluated_mir_constant_to_valtree = function (this: Builder, constant: ConstOperand): Result<[ValTree, Ty], ErrorHandled> {
  return unported("rustc_mir_build::builder::scope::Builder::eval_unevaluated_mir_constant_to_valtree");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:870 break_const_continuable_scope (lane mb-scope)
Builder.prototype.break_const_continuable_scope = function (this: Builder, block: BasicBlock, value: ExprId, scope: region_Scope, source_info: SourceInfo): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::break_const_continuable_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1058 break_from_if_then_scope (lane mb-scope)
Builder.prototype.break_from_if_then_scope = function (this: Builder, block: BasicBlock, source_info: SourceInfo): void {
  return unported("rustc_mir_build::builder::scope::Builder::break_from_if_then_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1091 break_for_tail_call (lane mb-scope)
Builder.prototype.break_for_tail_call = function (this: Builder, block: BasicBlock, args: readonly Spanned<Operand>[], source_info: SourceInfo): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::break_for_tail_call");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1200 is_async_drop_impl (lane mb-scope)
(Builder as unknown as { is_async_drop_impl: typeof Builder.is_async_drop_impl }).is_async_drop_impl = function (tcx: TyCtxt, local_decls: LocalDecl[], typing_env: TypingEnv, local: Local): boolean {
  return unported("rustc_mir_build::builder::scope::Builder::is_async_drop_impl");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1212 is_async_drop (lane mb-scope)
Builder.prototype.is_async_drop = function (this: Builder, local: Local): boolean {
  return unported("rustc_mir_build::builder::scope::Builder::is_async_drop");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1216 leave_top_scope (lane mb-scope)
Builder.prototype.leave_top_scope = function (this: Builder, block: BasicBlock): BasicBlock {
  return unported("rustc_mir_build::builder::scope::Builder::leave_top_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1246 maybe_new_source_scope (lane mb-scope)
Builder.prototype.maybe_new_source_scope = function (this: Builder, span: Span, current_id: HirId, parent_id: HirId): void {
  return unported("rustc_mir_build::builder::scope::Builder::maybe_new_source_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1284 maybe_lint_level_root_bounded (lane mb-scope)
Builder.prototype.maybe_lint_level_root_bounded = function (this: Builder, orig_id: HirId): HirId {
  return unported("rustc_mir_build::builder::scope::Builder::maybe_lint_level_root_bounded");
};

/// Creates a new source scope, nested in the current one.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1331 new_source_scope
Builder.prototype.new_source_scope = function (this: Builder, span: Span, lint_level: LintLevel): SourceScope {
  const parent = this.source_scope;
  // debug!(
  //     "new_source_scope({:?}, {:?}) - parent({:?})={:?}",
  //     span,
  //     lint_level,
  //     parent,
  //     self.source_scopes.get(parent)
  // );
  const scope_local_data: SourceScopeLocalData = {
    lint_root:
      lint_level.$ === "Explicit"
        ? lint_level._0
        : ClearCrossCrate.unwrap_crate_local(this.source_scopes[parent]!.local_data).lint_root,
  };
  // `IndexVec::push` returns the index of the new element.
  this.source_scopes.push(new SourceScopeData(span, parent, undefined, undefined, { $: "Set", _0: scope_local_data }));
  return (this.source_scopes.length - 1) as SourceScope;
};

/// Given a span and the current source scope, make a SourceInfo.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1357 source_info
Builder.prototype.source_info = function (this: Builder, span: Span): SourceInfo {
  return new SourceInfo(span, this.source_scope);
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1383 local_scope (lane mb-scope)
Builder.prototype.local_scope = function (this: Builder): region_Scope {
  return unported("rustc_mir_build::builder::scope::Builder::local_scope");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1394 schedule_drop (lane mb-scope)
Builder.prototype.schedule_drop = function (this: Builder, span: Span, region_scope: region_Scope, local: Local, drop_kind: DropKind): void {
  return unported("rustc_mir_build::builder::scope::Builder::schedule_drop");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1477 schedule_drop_storage (lane mb-scope)
Builder.prototype.schedule_drop_storage = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  return unported("rustc_mir_build::builder::scope::Builder::schedule_drop_storage");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1495 schedule_drop_value (lane mb-scope)
Builder.prototype.schedule_drop_value = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  return unported("rustc_mir_build::builder::scope::Builder::schedule_drop_value");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1510 schedule_backwards_incompatible_drop (lane mb-scope)
Builder.prototype.schedule_backwards_incompatible_drop = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  return unported("rustc_mir_build::builder::scope::Builder::schedule_backwards_incompatible_drop");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1557 record_operands_moved (lane mb-scope)
Builder.prototype.record_operands_moved = function (this: Builder, operands: readonly Spanned<Operand>[]): void {
  return unported("rustc_mir_build::builder::scope::Builder::record_operands_moved");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1585 diverge_cleanup (lane mb-scope)
Builder.prototype.diverge_cleanup = function (this: Builder): DropIdx {
  return unported("rustc_mir_build::builder::scope::Builder::diverge_cleanup");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1595 diverge_cleanup_target (lane mb-scope)
Builder.prototype.diverge_cleanup_target = function (this: Builder, target_scope: region_Scope, span: Span): DropIdx {
  return unported("rustc_mir_build::builder::scope::Builder::diverge_cleanup_target");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1628 diverge_from (lane mb-scope)
Builder.prototype.diverge_from = function (this: Builder, start: BasicBlock): void {
  return unported("rustc_mir_build::builder::scope::Builder::diverge_from");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1647 diverge_dropline (lane mb-scope)
Builder.prototype.diverge_dropline = function (this: Builder): DropIdx {
  return unported("rustc_mir_build::builder::scope::Builder::diverge_dropline");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1654 diverge_dropline_target (lane mb-scope)
Builder.prototype.diverge_dropline_target = function (this: Builder, target_scope: region_Scope, span: Span): DropIdx {
  return unported("rustc_mir_build::builder::scope::Builder::diverge_dropline_target");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1688 coroutine_drop_cleanup (lane mb-scope)
Builder.prototype.coroutine_drop_cleanup = function (this: Builder, yield_block: BasicBlock): void {
  return unported("rustc_mir_build::builder::scope::Builder::coroutine_drop_cleanup");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1702 build_drop_and_replace (lane mb-scope)
Builder.prototype.build_drop_and_replace = function (this: Builder, block: BasicBlock, span: Span, place: Place, value: Rvalue): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::Builder::build_drop_and_replace");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1738 assert (lane mb-scope)
Builder.prototype.assert = function (this: Builder, block: BasicBlock, cond: Operand, expected: boolean, msg: AssertMessage, span: Span): BasicBlock {
  return unported("rustc_mir_build::builder::scope::Builder::assert");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1770 clear_match_arm_and_guard_scopes (lane mb-scope)
Builder.prototype.clear_match_arm_and_guard_scopes = function (this: Builder, region_scope: region_Scope): void {
  return unported("rustc_mir_build::builder::scope::Builder::clear_match_arm_and_guard_scopes");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1800 build_scope_drops (lane mb-scope)
export function build_scope_drops(cfg: CFG, unwind_drops: DropTree, coroutine_drops: DropTree, scope: Scope, block: BasicBlock, unwind_to: DropIdx, dropline_to: DropIdx | undefined, storage_dead_on_unwind: boolean, arg_count: number, is_async_drop: (a0: Local) => boolean): BlockAnd<null> {
  return unported("rustc_mir_build::builder::scope::build_scope_drops");
}

// stub: compiler/rustc_mir_build/src/builder/scope.rs:1969 build_exit_tree (lane mb-scope)
Builder.prototype.build_exit_tree = function (this: Builder, drops: DropTree, else_scope: region_Scope, span: Span, continue_block: BasicBlock | undefined): BlockAnd<null> | undefined {
  return unported("rustc_mir_build::builder::scope::Builder::build_exit_tree");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:2041 build_drop_trees (lane mb-scope)
Builder.prototype.build_drop_trees = function (this: Builder): void {
  return unported("rustc_mir_build::builder::scope::Builder::build_drop_trees");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:2054 build_coroutine_drop_trees (lane mb-scope)
Builder.prototype.build_coroutine_drop_trees = function (this: Builder): void {
  return unported("rustc_mir_build::builder::scope::Builder::build_coroutine_drop_trees");
};

// stub: compiler/rustc_mir_build/src/builder/scope.rs:2091 build_unwind_tree (lane mb-scope)
(Builder as unknown as { build_unwind_tree: typeof Builder.build_unwind_tree }).build_unwind_tree = function (cfg: CFG, drops: DropTree, fn_span: Span, resume_block: MutRef<BasicBlock | undefined>): void {
  return unported("rustc_mir_build::builder::scope::Builder::build_unwind_tree");
};

// DropTreeBuilder implementations.

// struct ExitScopes; (scope.gen.ts)
export const DropTreeBuilder_ExitScopes: DropTreeBuilder = {
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2111 make_block (lane mb-scope)
  make_block(cfg: CFG): BasicBlock {
    return unported("rustc_mir_build::builder::scope::ExitScopes::make_block");
  },
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2114 link_entry_point (lane mb-scope)
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    return unported("rustc_mir_build::builder::scope::ExitScopes::link_entry_point");
  },
};

// struct CoroutineDrop; (scope.gen.ts)
export const DropTreeBuilder_CoroutineDrop: DropTreeBuilder = {
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2130 make_block (lane mb-scope)
  make_block(cfg: CFG): BasicBlock {
    return unported("rustc_mir_build::builder::scope::CoroutineDrop::make_block");
  },
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2133 link_entry_point (lane mb-scope)
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    return unported("rustc_mir_build::builder::scope::CoroutineDrop::link_entry_point");
  },
};

// struct Unwind; (scope.gen.ts)
export const DropTreeBuilder_Unwind: DropTreeBuilder = {
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2152 make_block (lane mb-scope)
  make_block(cfg: CFG): BasicBlock {
    return unported("rustc_mir_build::builder::scope::Unwind::make_block");
  },
  // stub: compiler/rustc_mir_build/src/builder/scope.rs:2155 link_entry_point (lane mb-scope)
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    return unported("rustc_mir_build::builder::scope::Unwind::link_entry_point");
  },
};
