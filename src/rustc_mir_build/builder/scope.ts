// Port of compiler/rustc_mir_build/src/builder/scope.rs (lanes builder-contract (declarations, `DropTree::new`,
// `Scopes::new`, `Builder::new_source_scope`, `Builder::source_info`) and mb-scope (the rest), plan-m4 wave 22).
// Conventions: docs/handoff/builder-contract.md (builder/mod.ts's header has the representation notes).
// PORT: `T: DropTreeBuilder` type parameters are a `T_: DropTreeBuilder` impl table (`DropTreeBuilder_ExitScopes`, ...).
// PORT: `DropData` is `Copy`; `*drop` copies share the object (nothing mutates a `DropData` or its `source_info` in place).
// PORT: `mir::Place`'s derived `PartialEq` is `place_eq` below (`local` and the interned `projection` list by identity).
import { type HirId, HirId_eq, debug_ItemLocalId, debug_OwnerId, OwnerId_eq } from "../../rustc_hir_id/lib.ts";
import { Attribute } from "../../rustc_attr_ir/attr.ts";
import { Level } from "../../rustc_lint_defs/lib.ts";
import { type Scope as region_Scope, Scope_eq, ScopeData, ScopeData_eq, debug_Scope as debug_region_Scope, debug_ScopeData } from "../../rustc_middle/middle/region.ts";
import { type ErrorHandled } from "../../rustc_middle/mir/interpret/mod.ts";
import {
  type AssertMessage,
  type BasicBlock,
  ClearCrossCrate,
  Const,
  ConstOperand,
  Local,
  type LocalDecl,
  type Operand,
  Place,
  Place_from_Local,
  type Rvalue,
  SourceInfo,
  type SourceScope,
  SourceScopeData,
  type SourceScopeLocalData,
  Statement,
  TerminatorKind,
  UnwindAction,
  clone_Rvalue,
  debug_Const,
  debug_Local,
  debug_TerminatorKind,
} from "../../rustc_middle/mir/mod.ts";
import { type ArmId, type ExprId } from "../../rustc_middle/thir.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { ValTree } from "../../rustc_middle/ty/consts/valtree.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Ty, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../rustc_middle/ty/decls.ts";
import { RustcPatCtxt, RustcPatCtxtState } from "../../rustc_pattern_analysis/rustc.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_ConstKind } from "../../rustc_type_ir/const_kind.ts";
import { Const as ty_Const } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import {
  ConstContinueBadConst_diagnostic,
  type ConstContinueNotMonomorphicConstReason,
  ConstContinueNotMonomorphicConst_diagnostic,
  ConstContinueUnknownJumpTarget_diagnostic,
} from "../diagnostics.ts";
import { type BuiltMatchTree } from "./matches/mod.gen.ts";
import { BlockAnd, BlockFrame, Builder, type CFG, unit } from "./mod.ts";
import { DropIdx, DropKind, DropTree, Scope, Scopes, type BreakableTarget, type DropData, type DropNode, type DropNodeKey, type LintLevel } from "./scope.gen.ts";
import { DUMMY_SP, Span, type Spanned } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
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

/** `mir::Place`'s derived `PartialEq` (`local`, then the interned `projection` list, compared by identity). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

const ROOT_NODE: DropIdx = DropIdx.ZERO;

/// Whether there's anything to do for the cleanup path, that is,
/// when unwinding through this scope. This includes destructors,
/// but not StorageDead statements, which don't get emitted at all
/// for unwinding, for several reasons:
///  * clang doesn't emit llvm.lifetime.end for C++ unwinding
///  * LLVM's memory dependency analysis can't handle it atm
///  * polluting the cleanup MIR with StorageDead creates
///    landing pads even though there's no actual destructors
///  * freeing up stack space has no effect during unwinding
/// Note that for coroutines we do emit StorageDeads, for the
/// use of optimizations in the MIR coroutine transform.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:268 needs_cleanup
Scope.prototype.needs_cleanup = function (this: Scope): boolean {
  return this.drops.some((drop) => {
    switch (drop.kind) {
      case "Value":
      case "ForLint":
        return true;
      case "Storage":
        return false;
    }
  });
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:275 invalidate_cache
Scope.prototype.invalidate_cache = function (this: Scope): void {
  this.cached_unwind_block = undefined;
  this.cached_coroutine_drop_block = undefined;
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

/// Adds a node to the drop tree, consisting of drop data and the index of
/// the "next" drop (in drop order), which could be the sentinel [`ROOT_NODE`].
///
/// If there is already an equivalent node in the tree, nothing is added, and
/// that node's index is returned. Otherwise, the new node's index is returned.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:310 add_drop
DropTree.prototype.add_drop = function (this: DropTree, data: DropData, next: DropIdx): DropIdx {
  const drop_nodes = this.drop_nodes;
  const key: DropNodeKey = { next, local: data.local };
  let idx = this.existing_drops_map.get(key);
  if (idx === undefined) {
    // Create a new node, and also add its index to the map.
    drop_nodes.push({ data, next });
    idx = (drop_nodes.length - 1) as DropIdx;
    this.existing_drops_map.set(key, idx);
  }
  return idx;
};

/// Registers `from` as an entry point to this drop tree, at `to`.
///
/// During [`Self::build_mir`], `from` will be linked to the corresponding
/// block within the drop tree.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:323 add_entry_point
DropTree.prototype.add_entry_point = function (this: DropTree, from: BasicBlock, to: DropIdx): void {
  // debug_assert!(to < self.drop_nodes.next_index());
  this.entry_points.push([to, from]);
};

/// Builds the MIR for a given drop tree.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:329 build_mir
DropTree.prototype.build_mir = function (this: DropTree, cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[] {
  // debug!("DropTree::build_mir(drops = {:#?})", self);

  const blocks = this.assign_blocks(cfg, root_node, T_);
  this.link_blocks(cfg, blocks);

  return blocks;
};

/// Assign blocks for all of the drops in the drop tree that need them.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:343 assign_blocks
DropTree.prototype.assign_blocks = function (this: DropTree, cfg: CFG, root_node: BasicBlock | undefined, T_: DropTreeBuilder): (BasicBlock | undefined)[] {
  // StorageDead statements can share blocks with each other and also with
  // a Drop terminator. We iterate through the drops to find which drops
  // need their own block.
  // #[derive(Clone, Copy)]
  type Block =
    // This drop is unreachable
    | { readonly $: "None" }
    // This drop is only reachable through the `StorageDead` with the
    // specified index.
    | { readonly $: "Shares"; _0: DropIdx }
    // This drop has more than one way of being reached, or it is
    // branched to from outside the tree, or its predecessor is a
    // `Value` drop.
    | { readonly $: "Own" };
  const Block_None: Block = { $: "None" };
  const Block_Own: Block = { $: "Own" };

  const blocks: (BasicBlock | undefined)[] = new Array<BasicBlock | undefined>(this.drop_nodes.length).fill(undefined);
  blocks[ROOT_NODE] = root_node;

  const needs_block: Block[] = new Array<Block>(this.drop_nodes.length).fill(Block_None);
  if (root_node !== undefined) {
    // In some cases (such as drops for `continue`) the root node
    // already has a block. In this case, make sure that we don't
    // override it.
    needs_block[ROOT_NODE] = Block_Own;
  }

  // Sort so that we only need to check the last value.
  const entry_points = this.entry_points;
  entry_points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  for (let i = this.drop_nodes.length - 1; i >= 0; i--) {
    const drop_idx = i as DropIdx;
    const drop_node = this.drop_nodes[i]!;
    if (entry_points.length > 0 && entry_points[entry_points.length - 1]![0] === drop_idx) {
      const block = (blocks[drop_idx] ??= T_.make_block(cfg));
      needs_block[drop_idx] = Block_Own;
      while (entry_points.length > 0 && entry_points[entry_points.length - 1]![0] === drop_idx) {
        const entry_block = unwrap(entry_points.pop())[1];
        T_.link_entry_point(cfg, entry_block, block);
      }
    }
    const nb = needs_block[drop_idx]!;
    switch (nb.$) {
      case "None":
        continue;
      case "Own":
        blocks[drop_idx] ??= T_.make_block(cfg);
        break;
      case "Shares":
        blocks[drop_idx] = blocks[nb._0];
        break;
    }
    if (drop_node.data.kind === "Value") {
      needs_block[drop_node.next] = Block_Own;
    } else if (drop_idx !== ROOT_NODE) {
      const pred = needs_block[drop_node.next]!;
      switch (pred.$) {
        case "None":
          needs_block[drop_node.next] = { $: "Shares", _0: drop_idx };
          break;
        case "Shares":
          needs_block[drop_node.next] = Block_Own;
          break;
        case "Own":
          break;
      }
    }
  }

  // debug!("assign_blocks: blocks = {:#?}", blocks);
  assert(entry_points.length === 0, "assertion failed: entry_points.is_empty()");

  return blocks;
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:414 link_blocks
DropTree.prototype.link_blocks = function (this: DropTree, cfg: CFG, blocks: readonly (BasicBlock | undefined)[]): void {
  for (let i = this.drop_nodes.length - 1; i >= 0; i--) {
    const drop_idx = i as DropIdx;
    const drop_node = this.drop_nodes[i]!;
    const block = blocks[drop_idx];
    if (block === undefined) continue;
    switch (drop_node.data.kind) {
      case "Value": {
        const terminator: TerminatorKind = {
          $: "Drop",
          target: unwrap(blocks[drop_node.next]),
          // The caller will handle this if needed.
          unwind: { $: "Terminate", _0: "InCleanup" },
          place: Place_from_Local(drop_node.data.local),
          replace: false,
          drop: undefined,
        };
        cfg.terminate(block, drop_node.data.source_info, terminator);
        break;
      }
      case "ForLint": {
        const stmt = Statement.new(drop_node.data.source_info, {
          $: "BackwardIncompatibleDropHint",
          place: Place_from_Local(drop_node.data.local),
          reason: "Edition2024",
        });
        cfg.push(block, stmt);
        const target = unwrap(blocks[drop_node.next]);
        if (target !== block) {
          // Diagnostics don't use this `Span` but debuginfo
          // might. Since we don't want breakpoints to be placed
          // here, especially when this is on an unwind path, we
          // use `DUMMY_SP`.
          const source_info = new SourceInfo(DUMMY_SP, drop_node.data.source_info.scope);
          const terminator = TerminatorKind.goto(target);
          cfg.terminate(block, source_info, terminator);
        }
        break;
      }
      case "Storage": {
        // Root nodes don't correspond to a drop.
        if (drop_idx === ROOT_NODE) break;
        const stmt = Statement.new(drop_node.data.source_info, { $: "StorageDead", _0: drop_node.data.local });
        cfg.push(block, stmt);
        const target = unwrap(blocks[drop_node.next]);
        if (target !== block) {
          // Diagnostics don't use this `Span` but debuginfo
          // might. Since we don't want breakpoints to be placed
          // here, especially when this is on an unwind path, we
          // use `DUMMY_SP`.
          const source_info = new SourceInfo(DUMMY_SP, drop_node.data.source_info.scope);
          const terminator = TerminatorKind.goto(target);
          cfg.terminate(block, source_info, terminator);
        }
        break;
      }
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:480 new
(Scopes as unknown as { new: typeof Scopes.new }).new = function (): Scopes {
  return new Scopes([], [], [], undefined, DropTree.new(), DropTree.new());
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:491 push_scope
Scopes.prototype.push_scope = function (this: Scopes, region_scope: region_Scope, vis_scope: SourceScope): void {
  // debug!("push_scope({:?})", region_scope);
  this.scopes.push(new Scope(vis_scope, region_scope, [], [], undefined, undefined));
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:503 pop_scope
Scopes.prototype.pop_scope = function (this: Scopes, region_scope: region_Scope): void {
  const scope = unwrap(this.scopes.pop());
  assert_eq(scope.region_scope, region_scope, (s) => debug_region_Scope(s, PLAIN), Scope_eq);
};

/// Returns the position in the scope stack of `region_scope`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:509 stack_index
Scopes.prototype.stack_index = function (this: Scopes, region_scope: region_Scope, span: Span): number {
  for (let i = this.scopes.length - 1; i >= 0; i--) {
    if (Scope_eq(this.scopes[i]!.region_scope, region_scope)) return i;
  }
  return span_bug(span, `region_scope ${debug_region_Scope(region_scope, PLAIN)} does not enclose`);
};

/// Returns the topmost active scope, which is known to be alive until
/// the next scope expression.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:518 topmost
Scopes.prototype.topmost = function (this: Scopes): region_Scope {
  return unwrap(this.scopes[this.scopes.length - 1], "topmost_scope: no scopes present").region_scope;
};

// Adding and removing scopes
// ==========================

///  Start a breakable scope, which tracks where `continue`, `break` and
///  `return` should branch to.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:537 in_breakable_scope
Builder.prototype.in_breakable_scope = function (this: Builder, loop_block: BasicBlock | undefined, break_destination: Place, span: Span, f: (this_: Builder) => BlockAnd<null> | undefined): BlockAnd<null> {
  const region_scope = this.scopes.topmost();
  const scope = {
    region_scope,
    break_destination,
    break_drops: DropTree.new(),
    continue_drops: loop_block !== undefined ? DropTree.new() : undefined,
  };
  this.scopes.breakable_scopes.push(scope);
  const normal_exit_block = f(this);
  const breakable_scope = unwrap(this.scopes.breakable_scopes.pop());
  assert(Scope_eq(breakable_scope.region_scope, region_scope), "assertion failed: breakable_scope.region_scope == region_scope");
  const break_block = this.build_exit_tree(breakable_scope.break_drops, region_scope, span, undefined);
  const drops = breakable_scope.continue_drops;
  if (drops !== undefined) {
    this.build_exit_tree(drops, region_scope, span, loop_block);
  }
  if (normal_exit_block !== undefined && break_block === undefined) {
    return normal_exit_block;
  } else if (normal_exit_block === undefined && break_block !== undefined) {
    return break_block;
  } else if (normal_exit_block === undefined && break_block === undefined) {
    return unit(this.cfg.start_new_block());
  } else {
    const normal_block = normal_exit_block!;
    const exit_block = break_block!;
    const target = this.cfg.start_new_block();
    const source_info = this.source_info(span);
    this.cfg.terminate(BlockAnd.into_block(normal_block), source_info, TerminatorKind.goto(target));
    this.cfg.terminate(BlockAnd.into_block(exit_block), source_info, TerminatorKind.goto(target));
    return unit(target);
  }
};

/// Start a const-continuable scope, which tracks where `#[const_continue] break` should
/// branch to.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:586 in_const_continuable_scope
Builder.prototype.in_const_continuable_scope = function (this: Builder, arms: ArmId[], built_match_tree: BuiltMatchTree, state_place: Place, span: Span, f: (this_: Builder) => BlockAnd<null>): BlockAnd<null> {
  const region_scope = this.scopes.topmost();
  const scope = {
    region_scope,
    state_place,
    const_continue_drops: DropTree.new(),
    arms,
    built_match_tree,
  };
  this.scopes.const_continuable_scopes.push(scope);
  const normal_exit_block = f(this);
  const const_continue_scope = unwrap(this.scopes.const_continuable_scopes.pop());
  assert(Scope_eq(const_continue_scope.region_scope, region_scope), "assertion failed: const_continue_scope.region_scope == region_scope");

  const break_block = this.build_exit_tree(const_continue_scope.const_continue_drops, region_scope, span, undefined);

  if (break_block === undefined) {
    return normal_exit_block;
  } else {
    const normal_block = normal_exit_block;
    const exit_block = break_block;
    const target = this.cfg.start_new_block();
    const source_info = this.source_info(span);
    this.cfg.terminate(BlockAnd.into_block(normal_block), source_info, TerminatorKind.goto(target));
    this.cfg.terminate(BlockAnd.into_block(exit_block), source_info, TerminatorKind.goto(target));
    return unit(target);
  }
};

/// Start an if-then scope which tracks drop for `if` expressions and `if`
/// guards.
///
/// For an if-let chain:
/// ```rust,ignore(illustrative)
///     if let Some(x) = a && let Some(y) = b && let Some(z) = c { ... }
/// ```
/// There are three possible ways the condition can be false and we may have
/// to drop `x`, `x` and `y`, or neither depending on which binding fails.
/// To handle this correctly we use a `DropTree` in a similar way to a
/// `loop` expression and 'break' out on all of the 'else' paths.
///
/// Notes:
/// - We don't need to keep a stack of scopes in the `Builder` because the
///   'else' paths will only leave the innermost scope.
/// - This is also used for match guards.
///
/// Returns blocks for the two condition outcomes, `(true_block, false_block)`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:655 in_if_then_scope
Builder.prototype.in_if_then_scope = function (this: Builder, region_scope: region_Scope, span: Span, f: (this_: Builder) => BlockAnd<null>): [BasicBlock, BasicBlock] {
  const scope = { region_scope, else_drops: DropTree.new() };
  const previous_scope = this.scopes.if_then_scope;
  this.scopes.if_then_scope = scope;

  const true_block = BlockAnd.into_block(f(this));

  const if_then_scope = unwrap(this.scopes.if_then_scope);
  this.scopes.if_then_scope = previous_scope;
  assert(Scope_eq(if_then_scope.region_scope, region_scope), "assertion failed: if_then_scope.region_scope == region_scope");

  // Lower any break paths (where the condition was false)
  // into a drop tree that ends in `false_block`.
  const false_block_and = this.build_exit_tree(if_then_scope.else_drops, region_scope, span, undefined);
  const false_block = false_block_and !== undefined ? BlockAnd.into_block(false_block_and) : this.cfg.start_new_block();

  return [true_block, false_block];
};

/// Convenience wrapper that pushes a scope and then executes `f`
/// to build its contents, popping the scope afterwards.
// #[instrument(skip(self, f), level = "debug")]
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:683 in_scope
Builder.prototype.in_scope = function <R>(this: Builder, [region_scope, source_info]: [region_Scope, SourceInfo], lint_level: LintLevel, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R> {
  const source_scope = this.source_scope;
  if (lint_level.$ === "Explicit") {
    const current_hir_id = lint_level._0;
    const parent_id = ClearCrossCrate.unwrap_crate_local(this.source_scopes[source_scope]!.local_data).lint_root;
    this.maybe_new_source_scope(source_info.span, current_hir_id, parent_id);
  }
  this.push_scope(region_scope);
  let block: BasicBlock;
  let rv: R;
  [block, rv] = f(this);
  block = BlockAnd.into_block(this.pop_scope(region_scope, block));
  this.source_scope = source_scope;
  // debug!(?block);
  return [block, rv];
};

/// Convenience wrapper that executes `f` either within the current scope or a new scope.
/// Used for pattern matching, which introduces an additional scope for patterns with guards.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:709 opt_in_scope
Builder.prototype.opt_in_scope = function <R>(this: Builder, opt_region_scope: [region_Scope, SourceInfo] | undefined, f: (this_: Builder) => BlockAnd<R>): BlockAnd<R> {
  if (opt_region_scope !== undefined) {
    const region_scope = opt_region_scope;
    return this.in_scope(region_scope, { $: "Inherited" }, f);
  } else {
    return f(this);
  }
};

/// Push a scope onto the stack. You can then build code in this
/// scope and call `pop_scope` afterwards. Note that these two
/// calls must be paired; using `in_scope` as a convenience
/// wrapper maybe preferable.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:725 push_scope
Builder.prototype.push_scope = function (this: Builder, region_scope: region_Scope): void {
  this.scopes.push_scope(region_scope, this.source_scope);
};

/// Pops a scope, which should have region scope `region_scope`,
/// adding any drops onto the end of `block` that are needed.
/// This must match 1-to-1 with `push_scope`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:732 pop_scope
Builder.prototype.pop_scope = function (this: Builder, region_scope: region_Scope, block: BasicBlock): BlockAnd<null> {
  // debug!("pop_scope({:?}, {:?})", region_scope, block);

  block = this.leave_top_scope(block);
  this.scopes.pop_scope(region_scope);

  return unit(block);
};

/// Sets up the drops for breaking from `block` to `target`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:746 break_scope
Builder.prototype.break_scope = function (this: Builder, block: BasicBlock, value: ExprId | undefined, target: BreakableTarget, source_info: SourceInfo): BlockAnd<null> {
  const span = source_info.span;

  const get_scope_index = (scope: region_Scope): number => {
    // find the loop-scope by its `region::Scope`.
    const breakable_scopes = this.scopes.breakable_scopes;
    for (let i = breakable_scopes.length - 1; i >= 0; i--) {
      if (Scope_eq(breakable_scopes[i]!.region_scope, scope)) return i;
    }
    return span_bug(span, "no enclosing breakable scope found");
  };
  let break_index: number;
  let destination: Place | undefined;
  switch (target.$) {
    case "Return": {
      const scope = this.scopes.breakable_scopes[0]!;
      if (!place_eq(scope.break_destination, Place.return_place())) {
        span_bug(span, "`return` in item with no return scope");
      }
      [break_index, destination] = [0, scope.break_destination];
      break;
    }
    case "Break": {
      const scope_ = target._0;
      const break_index_ = get_scope_index(scope_);
      const scope = this.scopes.breakable_scopes[break_index_]!;
      [break_index, destination] = [break_index_, scope.break_destination];
      break;
    }
    case "Continue": {
      const scope = target._0;
      const break_index_ = get_scope_index(scope);
      [break_index, destination] = [break_index_, undefined];
      break;
    }
  }

  if (destination !== undefined && value !== undefined) {
    // debug!("stmt_expr Break val block_context.push(SubExpr)");
    this.block_context.push(BlockFrame.SubExpr);
    block = BlockAnd.into_block(this.expr_into_dest(destination, block, value));
    this.block_context.pop();
  } else if (destination !== undefined && value === undefined) {
    this.cfg.push_assign_unit(block, source_info, destination, this.tcx);
  } else if (destination === undefined && value !== undefined) {
    panic("`return`, `become` and `break` with value and must have a destination");
  } else {
    // (None, None) => {}
  }

  const region_scope = this.scopes.breakable_scopes[break_index]!.region_scope;
  const stack_index = this.scopes.stack_index(region_scope, span);
  let drops: DropTree;
  if (destination !== undefined) {
    drops = this.scopes.breakable_scopes[break_index]!.break_drops;
  } else {
    const drops_ = this.scopes.breakable_scopes[break_index]!.continue_drops;
    if (drops_ === undefined) {
      this.tcx.dcx().span_delayed_bug(source_info.span, "unlabelled `continue` within labelled block");
      this.cfg.terminate(block, source_info, { $: "Unreachable" });

      return unit(this.cfg.start_new_block());
    }
    drops = drops_;
  }

  let drop_idx = ROOT_NODE;
  for (let i = stack_index + 1; i < this.scopes.scopes.length; i++) {
    const scope = this.scopes.scopes[i]!;
    for (const drop of scope.drops) {
      drop_idx = drops.add_drop(drop, drop_idx);
    }
  }
  drops.add_entry_point(block, drop_idx);

  // `build_drop_trees` doesn't have access to our source_info, so we
  // create a dummy terminator now. `TerminatorKind::UnwindResume` is used
  // because MIR type checking will panic if it hasn't been overwritten.
  // (See `<ExitScopes as DropTreeBuilder>::link_entry_point`.)
  this.cfg.terminate(block, source_info, { $: "UnwindResume" });

  return unit(this.cfg.start_new_block());
};

/// Based on `FunctionCx::eval_unevaluated_mir_constant_to_valtree`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:834 eval_unevaluated_mir_constant_to_valtree
Builder.prototype.eval_unevaluated_mir_constant_to_valtree = function (this: Builder, constant: ConstOperand): Result<[ValTree, Ty], ErrorHandled> {
  assert(!TypeVisitableExt.has_param(Const.ty(constant.const_), fold_Ty), "assertion failed: !constant.const_.ty().has_param()");
  let uv;
  let ty: Ty;
  const const_ = constant.const_;
  if (const_.$ === "Unevaluated") {
    [uv, ty] = [const_._0.shrink(this.tcx), const_._1];
  } else if (const_.$ === "Ty") {
    const c = const_._1;
    const other = c.kind();
    if (other.$ === "Value") {
      // A constant that came from a const generic but was then used as an argument to
      // old-style simd_shuffle (passing as argument instead of as a generic param).
      const cv = other._0;
      return Ok([cv.valtree, cv.ty]);
    }
    return span_bug(constant.span, debug_ConstKind(other, PRETTY));
  } else if (const_.$ === "Val" && const_._0.$ === "Scalar" && const_._0._0.$ === "Int") {
    const val = const_._0._0._0;
    return Ok([ValTree.from_scalar_int(this.tcx, val), const_._1]);
  } else {
    // We should never encounter `Const::Val` unless MIR opts (like const prop) evaluate
    // a constant and write that value back into `Operand`s. This could happen, but is
    // unlikely. Also: all users of `simd_shuffle` are on unstable and already need to take
    // a lot of care around intrinsics. For an issue to happen here, it would require a
    // macro expanding to a `simd_shuffle` call without wrapping the constant argument in a
    // `const {}` block, but the user pass through arbitrary expressions.

    // FIXME(oli-obk): Replace the magic const generic argument of `simd_shuffle` with a
    // real const generic, and get rid of this entire function.
    const other = const_;
    return span_bug(constant.span, debug_Const(other, PRETTY));
  }

  const r = this.tcx.const_eval_resolve_for_typeck(this.typing_env(), uv, constant.span);
  if (r.$ === "Ok") {
    const inner = r._0;
    if (inner.$ === "Ok") {
      const valtree = inner._0;
      return Ok([valtree, ty]);
    } else {
      const ty_ = inner._0;
      return span_bug(constant.span, `could not convert ${debug_Ty(ty_, PLAIN)} to a valtree`);
    }
  } else {
    const e = r._0;
    return Err(e);
  }
};

/// Sets up the drops for jumping from `block` to `scope`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:870 break_const_continuable_scope
Builder.prototype.break_const_continuable_scope = function (this: Builder, block: BasicBlock, value: ExprId, scope_: region_Scope, source_info: SourceInfo): BlockAnd<null> {
  const span = source_info.span;

  // A break can only break out of a scope, so the value should be a scope.
  const scope_kind = this.thir.index_ExprId(value).kind;
  if (scope_kind.$ !== "Scope") {
    return span_bug(span, "break value must be a scope");
  }
  value = scope_kind.value;

  const expr = this.thir.index_ExprId(value);
  let constant: ConstOperand;
  const kind = expr.kind;
  if (kind.$ === "Adt") {
    const { variant_index, fields, base } = kind._0;
    assert(base.$ === "None", "assertion failed: matches!(base, AdtExprBase::None)");
    assert(fields.length === 0, "assertion failed: fields.is_empty()");
    constant = new ConstOperand(
      this.thir.index_ExprId(value).span,
      undefined,
      {
        $: "Ty",
        _0: this.thir.index_ExprId(value).ty,
        _1: ty_Const.new_value(
          this.tcx,
          ValTree.from_branches(this.tcx, [
            ty_Const.new_value(this.tcx, ValTree.from_scalar_int(this.tcx, ScalarInt.from_u32(variant_index)), this.tcx.types.u32),
          ]),
          this.thir.index_ExprId(value).ty,
        ),
      },
    );
  } else if (kind.$ === "Literal" || kind.$ === "NonHirLiteral" || kind.$ === "ZstLiteral" || kind.$ === "NamedConst") {
    constant = this.as_constant(this.thir.index_ExprId(value));
  } else {
    const other = kind;
    // use crate::diagnostics::ConstContinueNotMonomorphicConstReason as Reason;

    const span = expr.span;
    let reason: ConstContinueNotMonomorphicConstReason;
    switch (other.$) {
      case "ConstParam":
        reason = { $: "ConstantParameter", span };
        break;
      case "ConstBlock":
        reason = { $: "ConstBlock", span };
        break;
      default:
        reason = { $: "Other", span };
        break;
    }

    this.tcx.dcx().emit_err(ConstContinueNotMonomorphicConst_diagnostic({ span: expr.span, reason }));
    return unit(block);
  }

  let break_index = -1;
  for (let i = this.scopes.const_continuable_scopes.length - 1; i >= 0; i--) {
    if (Scope_eq(this.scopes.const_continuable_scopes[i]!.region_scope, scope_)) {
      break_index = i;
      break;
    }
  }
  if (break_index === -1) span_bug(span, "no enclosing const-continuable scope found");

  const scope = this.scopes.const_continuable_scopes[break_index]!;

  const state_decl = this.local_decls[unwrap(scope.state_place.as_local())]!;
  const state_ty = state_decl.ty;
  let discriminant_ty: Ty;
  let rvalue: Rvalue;
  const state_kind = state_ty.kind();
  if (state_kind.$ === "Adt" && state_kind._0.is_enum()) {
    [discriminant_ty, rvalue] = [state_ty.discriminant_ty(this.tcx), { $: "Discriminant", _0: scope.state_place }];
  } else if (state_kind.$ === "Uint" || state_kind.$ === "Int" || state_kind.$ === "Float" || state_kind.$ === "Bool" || state_kind.$ === "Char") {
    [discriminant_ty, rvalue] = [state_ty, { $: "Use", _0: { $: "Copy", _0: scope.state_place }, _1: "Yes" }];
  } else {
    return span_bug(state_decl.source_info.span, "unsupported #[loop_match] state");
  }

  // The `PatCtxt` is normally used in pattern exhaustiveness checking, but reused
  // here because it performs normalization and const evaluation.
  // PORT: rustc_arena is erased (PORTING §5): the arena is `null`.
  const dropless_arena = null;
  const typeck_results = this.tcx.typeck(this.def_id) as TypeckResults;
  const cx = new RustcPatCtxt(
    this.tcx,
    typeck_results,
    this.tcx.parent_module(this.hir_id),
    TypingEnv.post_typeck_until_borrowck_for_mir_build(this.tcx, this.def_id),
    dropless_arena,
    this.hir_id,
    Span.default(),
    Span.default(),
    true,
    true,
    RustcPatCtxtState.default(),
  );

  let valtree: ValTree;
  const ev = this.eval_unevaluated_mir_constant_to_valtree(constant);
  if (ev.$ === "Ok") {
    const [valtree_, ty] = ev._0;
    // Defensively check that the type is monomorphic.
    assert(!TypeVisitableExt.has_param(ty, fold_Ty), "assertion failed: !ty.has_param()");

    valtree = valtree_;
  } else if (ev._0.$ === "Reported") {
    return unit(block);
  } else {
    // Err(ErrorHandled::TooGeneric(_))
    return this.tcx.dcx().emit_fatal(ConstContinueBadConst_diagnostic({ span: constant.span }));
  }

  const real_target = this.static_pattern_match(cx, valtree, scope.arms, scope.built_match_tree);
  if (real_target === undefined) {
    return this.tcx.dcx().emit_fatal(ConstContinueUnknownJumpTarget_diagnostic({ span }));
  }

  this.block_context.push(BlockFrame.SubExpr);
  const state_place = scope.state_place;
  block = BlockAnd.into_block(this.expr_into_dest(state_place, block, value));
  this.block_context.pop();

  const discr = this.temp(discriminant_ty, source_info.span);
  let stack_index = this.scopes.stack_index(this.scopes.const_continuable_scopes[break_index]!.region_scope, span);
  const scope_mut = this.scopes.const_continuable_scopes[break_index]!;
  this.cfg.push_assign(block, source_info, discr, rvalue);
  const drop_and_continue_block = this.cfg.start_new_block();
  const imaginary_target = this.cfg.start_new_block();
  this.cfg.terminate(block, source_info, { $: "FalseEdge", real_target: drop_and_continue_block, imaginary_target });

  const drops = scope_mut.const_continue_drops;

  let drop_idx = ROOT_NODE;
  for (let i = stack_index + 1; i < this.scopes.scopes.length; i++) {
    for (const drop of this.scopes.scopes[i]!.drops) drop_idx = drops.add_drop(drop, drop_idx);
  }

  drops.add_entry_point(imaginary_target, drop_idx);

  this.cfg.terminate(imaginary_target, source_info, { $: "UnwindResume" });

  const region_scope = scope_mut.region_scope;
  stack_index = this.scopes.stack_index(region_scope, span);
  const drops2 = DropTree.new();

  let drop_idx2 = ROOT_NODE;
  for (let i = stack_index + 1; i < this.scopes.scopes.length; i++) {
    for (const drop of this.scopes.scopes[i]!.drops) drop_idx2 = drops2.add_drop(drop, drop_idx2);
  }

  drops2.add_entry_point(drop_and_continue_block, drop_idx2);

  // `build_drop_trees` doesn't have access to our source_info, so we
  // create a dummy terminator now. `TerminatorKind::UnwindResume` is used
  // because MIR type checking will panic if it hasn't been overwritten.
  // (See `<ExitScopes as DropTreeBuilder>::link_entry_point`.)
  this.cfg.terminate(drop_and_continue_block, source_info, { $: "UnwindResume" });

  this.build_exit_tree(drops2, region_scope, span, real_target);

  return unit(this.cfg.start_new_block());
};

/// Breaks out of the enclosing [`Builder::in_if_then_scope`] due to a
/// condition being false.
///
/// This adds relevant drops in the drop tree, and adds a dummy terminator
/// that will become a real `goto` when the scope's drop tree is built.
///
/// Must be called in the context of [`Builder::in_if_then_scope`], so that
/// there is an if-then scope to tell us what the target scope is.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1058 break_from_if_then_scope
Builder.prototype.break_from_if_then_scope = function (this: Builder, block: BasicBlock, source_info: SourceInfo): void {
  let if_then_scope = this.scopes.if_then_scope;
  if (if_then_scope === undefined) span_bug(source_info.span, "no if-then scope found");

  const target = if_then_scope.region_scope;
  const stack_index = this.scopes.stack_index(target, source_info.span);

  // Upgrade `if_then_scope` to `&mut`.
  if_then_scope = unwrap(this.scopes.if_then_scope, "upgrading & to &mut");

  let drop_idx = ROOT_NODE;
  const drops = if_then_scope.else_drops;
  for (let i = stack_index + 1; i < this.scopes.scopes.length; i++) {
    const scope = this.scopes.scopes[i]!;
    for (const drop of scope.drops) {
      drop_idx = drops.add_drop(drop, drop_idx);
    }
  }
  drops.add_entry_point(block, drop_idx);

  // `build_drop_trees` doesn't have access to our source_info, so we
  // create a dummy terminator now. `TerminatorKind::UnwindResume` is used
  // because MIR type checking will panic if it hasn't been overwritten.
  // (See `<ExitScopes as DropTreeBuilder>::link_entry_point`.)
  this.cfg.terminate(block, source_info, { $: "UnwindResume" });
};

/// Sets up the drops for explicit tail calls.
///
/// Unlike other kinds of early exits, tail calls do not go through the drop tree.
/// Instead, all scheduled drops are immediately added to the CFG.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1091 break_for_tail_call
Builder.prototype.break_for_tail_call = function (this: Builder, block: BasicBlock, args: readonly Spanned<Operand>[], source_info: SourceInfo): BlockAnd<null> {
  const arg_drops: DropData[] = [];
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]!;
    const node = arg.node;
    switch (node.$) {
      case "Copy":
        bug("copy op in tail call args");
      case "Move": {
        const place = node._0;
        const local = place.as_local() ?? bug("projection in tail call args");

        if (!this.local_decls[local]!.ty.needs_drop(this.tcx, this.typing_env())) {
          continue;
        }

        arg_drops.push({ source_info, local, kind: DropKind.Value });
        break;
      }
      case "Constant":
      case "RuntimeChecks":
        break;
    }
  }

  let unwind_to = this.diverge_cleanup_target(unwrap(this.scopes.scopes[this.scopes.scopes.length - 2]).region_scope, DUMMY_SP);
  const typing_env = this.typing_env();
  const unwind_drops = this.scopes.unwind_drops;

  // the innermost scope contains only the destructors for the tail call arguments
  // we only want to drop these in case of a panic, so we skip it
  for (let i = this.scopes.scopes.length - 2; i >= 1; i--) {
    const scope = this.scopes.scopes[i]!;
    // FIXME(explicit_tail_calls) code duplication with `build_scope_drops`
    for (let j = scope.drops.length - 1; j >= 0; j--) {
      const drop_data = scope.drops[j]!;
      const source_info = drop_data.source_info;
      const local = drop_data.local;

      if (!this.local_decls[local]!.ty.needs_drop(this.tcx, typing_env)) {
        continue;
      }

      switch (drop_data.kind) {
        case "Value": {
          // `unwind_to` should drop the value that we're about to
          // schedule. If dropping this value panics, then we continue
          // with the *next* value on the unwind path.
          // debug_assert_eq!(
          //     unwind_drops.drop_nodes[unwind_to].data.local,
          //     drop_data.local
          // );
          // debug_assert_eq!(
          //     unwind_drops.drop_nodes[unwind_to].data.kind,
          //     drop_data.kind
          // );
          unwind_to = unwind_drops.drop_nodes[unwind_to]!.next;

          let unwind_entry_point = unwind_to;

          // the tail call arguments must be dropped if any of these drops panic
          for (const drop of arg_drops) {
            unwind_entry_point = unwind_drops.add_drop(drop, unwind_entry_point);
          }

          unwind_drops.add_entry_point(block, unwind_entry_point);

          const next = this.cfg.start_new_block();
          this.cfg.terminate(block, source_info, {
            $: "Drop",
            place: Place_from_Local(local),
            target: next,
            unwind: UnwindAction.Continue,
            replace: false,
            drop: undefined,
          });
          block = next;
          break;
        }
        case "ForLint": {
          this.cfg.push(
            block,
            Statement.new(source_info, {
              $: "BackwardIncompatibleDropHint",
              place: Place_from_Local(local),
              reason: "Edition2024",
            }),
          );
          break;
        }
        case "Storage": {
          // Only temps and vars need their storage dead.
          assert(Local.index(local) > this.arg_count, "assertion failed: local.index() > self.arg_count");
          this.cfg.push(block, Statement.new(source_info, { $: "StorageDead", _0: local }));
          break;
        }
      }
    }
  }

  return unit(block);
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1200 is_async_drop_impl
(Builder as unknown as { is_async_drop_impl: typeof Builder.is_async_drop_impl }).is_async_drop_impl = function (tcx: TyCtxt, local_decls: LocalDecl[], typing_env: TypingEnv, local: Local): boolean {
  const ty = local_decls[local]!.ty;
  if (ty.is_async_drop(tcx, typing_env) || ty.is_coroutine()) {
    return true;
  }
  return ty.needs_async_drop(tcx, typing_env);
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1212 is_async_drop
Builder.prototype.is_async_drop = function (this: Builder, local: Local): boolean {
  return Builder.is_async_drop_impl(this.tcx, this.local_decls, this.typing_env(), local);
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1216 leave_top_scope
Builder.prototype.leave_top_scope = function (this: Builder, block: BasicBlock): BasicBlock {
  // If we are emitting a `drop` statement, we need to have the cached
  // diverge cleanup pads ready in case that drop panics.
  const last = this.scopes.scopes[this.scopes.scopes.length - 1];
  const needs_cleanup = last !== undefined && last.needs_cleanup();
  const is_coroutine = this.coroutine !== undefined;
  const unwind_to = needs_cleanup ? this.diverge_cleanup() : DropIdx.MAX;

  let scope = unwrap(this.scopes.scopes[this.scopes.scopes.length - 1], "leave_top_scope called with no scopes");
  const has_async_drops = is_coroutine && scope.drops.some((v) => v.kind === "Value" && this.is_async_drop(v.local));
  const dropline_to = has_async_drops ? this.diverge_dropline() : undefined;
  scope = unwrap(this.scopes.scopes[this.scopes.scopes.length - 1], "leave_top_scope called with no scopes");
  const typing_env = this.typing_env();
  return BlockAnd.into_block(
    build_scope_drops(
      this.cfg,
      this.scopes.unwind_drops,
      this.scopes.coroutine_drops,
      scope,
      block,
      unwind_to,
      dropline_to,
      is_coroutine && needs_cleanup,
      this.arg_count,
      (v: Local) => Builder.is_async_drop_impl(this.tcx, this.local_decls, typing_env, v),
    ),
  );
};

/// Possibly creates a new source scope if `current_root` and `parent_root`
/// are different, or if -Zmaximal-hir-to-mir-coverage is enabled.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1246 maybe_new_source_scope
Builder.prototype.maybe_new_source_scope = function (this: Builder, span: Span, current_id: HirId, parent_id: HirId): void {
  let current_root: HirId;
  let parent_root: HirId;
  if (this.tcx.sess.opts.unstable_opts.maximal_hir_to_mir_coverage) {
    // Some consumers of rustc need to map MIR locations back to HIR nodes. Currently
    // the only part of rustc that tracks MIR -> HIR is the
    // `SourceScopeLocalData::lint_root` field that tracks lint levels for MIR
    // locations. Normally the number of source scopes is limited to the set of nodes
    // with lint annotations. The -Zmaximal-hir-to-mir-coverage flag changes this
    // behavior to maximize the number of source scopes, increasing the granularity of
    // the MIR->HIR mapping.
    [current_root, parent_root] = [current_id, parent_id];
  } else {
    // Use `maybe_lint_level_root_bounded` to avoid adding Hir dependencies on our
    // parents. We estimate the true lint roots here to avoid creating a lot of source
    // scopes.
    [current_root, parent_root] = [
      this.maybe_lint_level_root_bounded(current_id),
      HirId_eq(parent_id, this.hir_id)
        ? parent_id // this is very common
        : this.maybe_lint_level_root_bounded(parent_id),
    ];
  }

  if (!HirId_eq(current_root, parent_root)) {
    const lint_level: LintLevel = { $: "Explicit", _0: current_root };
    this.source_scope = this.new_source_scope(span, lint_level);
  }
};

/// Walks upwards from `orig_id` to find a node which might change lint levels with attributes.
/// It stops at `self.hir_id` and just returns it if reached.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1284 maybe_lint_level_root_bounded
Builder.prototype.maybe_lint_level_root_bounded = function (this: Builder, orig_id: HirId): HirId {
  // This assertion lets us just store `ItemLocalId` in the cache, rather
  // than the full `HirId`.
  assert_eq(orig_id.owner, this.hir_id.owner, (o) => debug_OwnerId(o, PLAIN), OwnerId_eq);

  let id = orig_id;
  for (;;) {
    if (HirId_eq(id, this.hir_id)) {
      // This is a moderately common case, mostly hit for previously unseen nodes.
      break;
    }

    if (this.tcx.hir_attrs(id).some((attr) => Level.from_opt_symbol(Attribute.name(attr)) !== undefined)) {
      // This is a rare case. It's for a node path that doesn't reach the root due to an
      // intervening lint level attribute. This result doesn't get cached.
      return id;
    }

    const next = this.tcx.parent_hir_id(id);
    if (HirId_eq(next, id)) {
      bug("lint traversal reached the root of the crate");
    }
    id = next;

    // This lookup is just an optimization; it can be removed without affecting
    // functionality. It might seem strange to see this at the end of this loop, but the
    // `orig_id` passed in to this function is almost always previously unseen, for which a
    // lookup will be a miss. So we only do lookups for nodes up the parent chain, where
    // cache lookups have a very high hit rate.
    if (this.lint_level_roots_cache.contains(id.local_id)) {
      break;
    }
  }

  // `orig_id` traced to `self_id`; record this fact. If `orig_id` is a leaf node it will
  // rarely (never?) subsequently be searched for, but it's hard to know if that is the case.
  // The performance wins from the cache all come from caching non-leaf nodes.
  this.lint_level_roots_cache.insert(orig_id.local_id);
  return this.hir_id;
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

// Finding scopes
// ==============

/// Returns the scope that we should use as the lifetime of an
/// operand. Basically, an operand must live until it is consumed.
/// This is similar to, but not quite the same as, the temporary
/// scope (which can be larger or smaller).
///
/// Consider:
/// ```ignore (illustrative)
/// let x = foo(bar(X, Y));
/// ```
/// We wish to pop the storage for X and Y after `bar()` is
/// called, not after the whole `let` is completed.
///
/// As another example, if the second argument diverges:
/// ```ignore (illustrative)
/// foo(Box::new(2), panic!())
/// ```
/// We would allocate the box but then free it on the unwinding
/// path; we would also emit a free on the 'success' path from
/// panic, but that will turn out to be removed as dead-code.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1383 local_scope
Builder.prototype.local_scope = function (this: Builder): region_Scope {
  return this.scopes.topmost();
};

// Scheduling drops
// ================

/// Indicates that `place` should be dropped on exit from `region_scope`.
///
/// When called with `DropKind::Storage`, `place` shouldn't be the return
/// place, or a function parameter.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1394 schedule_drop
Builder.prototype.schedule_drop = function (this: Builder, span: Span, region_scope: region_Scope, local: Local, drop_kind: DropKind): void {
  // When building drops, we try to cache chains of drops to reduce the
  // number of `DropTree::add_drop` calls. This, however, means that
  // whenever we add a drop into a scope which already had some entries
  // in the drop tree built (and thus, cached) for it, we must invalidate
  // all caches which might branch into the scope which had a drop just
  // added to it. This is necessary, because otherwise some other code
  // might use the cache to branch into already built chain of drops,
  // essentially ignoring the newly added drop.
  //
  // For example consider there’s two scopes with a drop in each. These
  // are built and thus the caches are filled:
  //
  // +--------------------------------------------------------+
  // | +---------------------------------+                    |
  // | | +--------+     +-------------+  |  +---------------+ |
  // | | | return | <-+ | drop(outer) | <-+ |  drop(middle) | |
  // | | +--------+     +-------------+  |  +---------------+ |
  // | +------------|outer_scope cache|--+                    |
  // +------------------------------|middle_scope cache|------+
  //
  // Now, a new, innermost scope is added along with a new drop into
  // both innermost and outermost scopes:
  //
  // +------------------------------------------------------------+
  // | +----------------------------------+                       |
  // | | +--------+      +-------------+  |   +---------------+   | +-------------+
  // | | | return | <+   | drop(new)   | <-+  |  drop(middle) | <--+| drop(inner) |
  // | | +--------+  |   | drop(outer) |  |   +---------------+   | +-------------+
  // | |             +-+ +-------------+  |                       |
  // | +---|invalid outer_scope cache|----+                       |
  // +----=----------------|invalid middle_scope cache|-----------+
  //
  // If, when adding `drop(new)` we do not invalidate the cached blocks for both
  // outer_scope and middle_scope, then, when building drops for the inner (rightmost)
  // scope, the old, cached blocks, without `drop(new)` will get used, producing the
  // wrong results.
  //
  // Note that this code iterates scopes from the innermost to the outermost,
  // invalidating caches of each scope visited. This way bare minimum of the
  // caches gets invalidated. i.e., if a new drop is added into the middle scope, the
  // cache of outer scope stays intact.
  //
  // Since we only cache drops for the unwind path and the coroutine drop
  // path, we only need to invalidate the cache for drops that happen on
  // the unwind or coroutine drop paths. This means that for
  // non-coroutines we don't need to invalidate caches for `DropKind::Storage`.
  let invalidate_caches: boolean;
  switch (drop_kind) {
    case "Value":
    case "ForLint":
      invalidate_caches = true;
      break;
    case "Storage":
      invalidate_caches = this.coroutine !== undefined;
      break;
  }
  for (let i = this.scopes.scopes.length - 1; i >= 0; i--) {
    const scope = this.scopes.scopes[i]!;
    if (invalidate_caches) {
      scope.invalidate_cache();
    }

    if (Scope_eq(scope.region_scope, region_scope)) {
      const region_scope_span = region_scope.span(this.tcx, this.region_scope_tree);
      // Attribute scope exit drops to scope's closing brace.
      const scope_end = this.tcx.sess.source_map().end_point(region_scope_span);

      scope.drops.push({
        source_info: new SourceInfo(scope_end, scope.source_scope),
        local,
        kind: drop_kind,
      });

      return;
    }
  }

  span_bug(span, `region scope ${debug_region_Scope(region_scope, PLAIN)} not in scope to drop ${debug_Local(local, PLAIN)}`);
};

/// Indicates that `place` should be marked `StorageDead` on exit from `region_scope`.
///
/// `place` must not be the return place, or a function parameter.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1477 schedule_drop_storage
Builder.prototype.schedule_drop_storage = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  if (Local.index(local) <= this.arg_count) {
    span_bug(span, `\`schedule_drop\` called with body argument ${debug_Local(local, PLAIN)} but its storage does not require a drop`);
  }
  this.schedule_drop(span, region_scope, local, DropKind.Storage);
};

/// Indicates that `place` should be dropped on exit from `region_scope`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1495 schedule_drop_value
Builder.prototype.schedule_drop_value = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  if (!this.local_decls[local]!.ty.needs_drop(this.tcx, this.typing_env())) {
    return;
  }
  this.schedule_drop(span, region_scope, local, DropKind.Value);
};

/// Schedule emission of a backwards incompatible drop lint hint.
/// Applicable only to temporary values for now.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1510 schedule_backwards_incompatible_drop
Builder.prototype.schedule_backwards_incompatible_drop = function (this: Builder, span: Span, region_scope: region_Scope, local: Local): void {
  // Note that we are *not* gating BIDs here on whether they have significant destructor.
  // We need to know all of them so that we can capture potential borrow-checking errors.
  this.schedule_drop(span, region_scope, local, DropKind.ForLint);
};

/// Indicates that the "local operand" stored in `local` is
/// *moved* at some point during execution (see `local_scope` for
/// more information about what a "local operand" is -- in short,
/// it's an intermediate operand created as part of preparing some
/// MIR instruction). We use this information to suppress
/// redundant drops on the non-unwind paths. This results in less
/// MIR, but also avoids spurious borrow check errors
/// (c.f. #64391).
///
/// Example: when compiling the call to `foo` here:
///
/// ```ignore (illustrative)
/// foo(bar(), ...)
/// ```
///
/// we would evaluate `bar()` to an operand `_X`. We would also
/// schedule `_X` to be dropped when the expression scope for
/// `foo(bar())` is exited. This is relevant, for example, if the
/// later arguments should unwind (it would ensure that `_X` gets
/// dropped). However, if no unwind occurs, then `_X` will be
/// unconditionally consumed by the `call`:
///
/// ```ignore (illustrative)
/// bb {
///   ...
///   _R = CALL(foo, _X, ...)
/// }
/// ```
///
/// However, `_X` is still registered to be dropped, and so if we
/// do nothing else, we would generate a `DROP(_X)` that occurs
/// after the call. This will later be optimized out by the
/// drop-elaboration code, but in the meantime it can lead to
/// spurious borrow-check errors -- the problem, ironically, is
/// not the `DROP(_X)` itself, but the (spurious) unwind pathways
/// that it creates. See #64391 for an example.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1557 record_operands_moved
Builder.prototype.record_operands_moved = function (this: Builder, operands: readonly Spanned<Operand>[]): void {
  const local_scope = this.local_scope();
  const scope = unwrap(this.scopes.scopes[this.scopes.scopes.length - 1]);

  if (!Scope_eq(scope.region_scope, local_scope)) {
    // assert_eq!(scope.region_scope, local_scope, "local scope is not the topmost scope!",);
    panic(
      `assertion \`left == right\` failed: local scope is not the topmost scope!\n  left: ${debug_region_Scope(scope.region_scope, PLAIN)}\n right: ${debug_region_Scope(local_scope, PLAIN)}`,
    );
  }

  // look for moves of a local variable, like `MOVE(_X)`
  for (const operand of operands) {
    let local: Local | undefined;
    switch (operand.node.$) {
      case "Copy":
      case "Constant":
      case "RuntimeChecks":
        local = undefined;
        break;
      case "Move":
        local = operand.node._0.as_local();
        break;
    }
    if (local === undefined) continue;
    // check if we have a Drop for this operand and -- if so
    // -- add it to the list of moved operands. Note that this
    // local might not have been an operand created for this
    // call, it could come from other places too.
    if (scope.drops.some((drop) => drop.local === local && drop.kind === "Value")) {
      scope.moved_locals.push(local);
    }
  }
};

// Other
// =====

/// Returns the [DropIdx] for the innermost drop if the function unwound at
/// this point. The `DropIdx` will be created if it doesn't already exist.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1585 diverge_cleanup
Builder.prototype.diverge_cleanup = function (this: Builder): DropIdx {
  // It is okay to use dummy span because the getting scope index on the topmost scope
  // must always succeed.
  return this.diverge_cleanup_target(this.scopes.topmost(), DUMMY_SP);
};

/// This is similar to [diverge_cleanup](Self::diverge_cleanup) except its target is set to
/// some ancestor scope instead of the current scope.
/// It is possible to unwind to some ancestor scope if some drop panics as
/// the program breaks out of a if-then scope.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1595 diverge_cleanup_target
Builder.prototype.diverge_cleanup_target = function (this: Builder, target_scope: region_Scope, span: Span): DropIdx {
  const target = this.scopes.stack_index(target_scope, span);
  let uncached_scope = 0;
  let cached_drop = ROOT_NODE;
  for (let scope_idx = target; scope_idx >= 0; scope_idx--) {
    const cached_block = this.scopes.scopes[scope_idx]!.cached_unwind_block;
    if (cached_block !== undefined) {
      [uncached_scope, cached_drop] = [scope_idx + 1, cached_block];
      break;
    }
  }

  if (uncached_scope > target) {
    return cached_drop;
  }

  const is_coroutine = this.coroutine !== undefined;
  for (let i = uncached_scope; i <= target; i++) {
    const scope = this.scopes.scopes[i]!;
    for (const drop of scope.drops) {
      if (is_coroutine || drop.kind === "Value") {
        cached_drop = this.scopes.unwind_drops.add_drop(drop, cached_drop);
      }
    }
    scope.cached_unwind_block = cached_drop;
  }

  return cached_drop;
};

/// Prepares to create a path that performs all required cleanup for a
/// terminator that can unwind at the given basic block.
///
/// This path terminates in Resume. The path isn't created until after all
/// of the non-unwind paths in this item have been lowered.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1628 diverge_from
Builder.prototype.diverge_from = function (this: Builder, start: BasicBlock): void {
  // debug_assert!(
  //     matches!(
  //         self.cfg.block_data(start).terminator().kind,
  //         TerminatorKind::Assert { .. }
  //             | TerminatorKind::Call { .. }
  //             | TerminatorKind::Drop { .. }
  //             | TerminatorKind::FalseUnwind { .. }
  //             | TerminatorKind::InlineAsm { .. }
  //     ),
  //     "diverge_from called on block with terminator that cannot unwind."
  // );

  const next_drop = this.diverge_cleanup();
  this.scopes.unwind_drops.add_entry_point(start, next_drop);
};

/// Returns the [DropIdx] for the innermost drop for dropline (coroutine drop path).
/// The `DropIdx` will be created if it doesn't already exist.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1647 diverge_dropline
Builder.prototype.diverge_dropline = function (this: Builder): DropIdx {
  // It is okay to use dummy span because the getting scope index on the topmost scope
  // must always succeed.
  return this.diverge_dropline_target(this.scopes.topmost(), DUMMY_SP);
};

/// Similar to diverge_cleanup_target, but for dropline (coroutine drop path)
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1654 diverge_dropline_target
Builder.prototype.diverge_dropline_target = function (this: Builder, target_scope: region_Scope, span: Span): DropIdx {
  // debug_assert!(
  //     self.coroutine.is_some(),
  //     "diverge_dropline_target is valid only for coroutine"
  // );
  const target = this.scopes.stack_index(target_scope, span);
  let uncached_scope = 0;
  let cached_drop = ROOT_NODE;
  for (let scope_idx = target; scope_idx >= 0; scope_idx--) {
    const cached_block = this.scopes.scopes[scope_idx]!.cached_coroutine_drop_block;
    if (cached_block !== undefined) {
      [uncached_scope, cached_drop] = [scope_idx + 1, cached_block];
      break;
    }
  }

  if (uncached_scope > target) {
    return cached_drop;
  }

  for (let i = uncached_scope; i <= target; i++) {
    const scope = this.scopes.scopes[i]!;
    for (const drop of scope.drops) {
      cached_drop = this.scopes.coroutine_drops.add_drop(drop, cached_drop);
    }
    scope.cached_coroutine_drop_block = cached_drop;
  }

  return cached_drop;
};

/// Sets up a path that performs all required cleanup for dropping a
/// coroutine, starting from the given block that ends in
/// [TerminatorKind::Yield].
///
/// This path terminates in CoroutineDrop.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1688 coroutine_drop_cleanup
Builder.prototype.coroutine_drop_cleanup = function (this: Builder, yield_block: BasicBlock): void {
  // debug_assert!(
  //     matches!(
  //         self.cfg.block_data(yield_block).terminator().kind,
  //         TerminatorKind::Yield { .. }
  //     ),
  //     "coroutine_drop_cleanup called on block with non-yield terminator."
  // );
  const cached_drop = this.diverge_dropline();
  this.scopes.coroutine_drops.add_entry_point(yield_block, cached_drop);
};

/// Utility function for *non*-scope code to build their own drops
/// Force a drop at this point in the MIR by creating a new block.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1702 build_drop_and_replace
Builder.prototype.build_drop_and_replace = function (this: Builder, block: BasicBlock, span: Span, place: Place, value: Rvalue): BlockAnd<null> {
  const source_info = this.source_info(span);

  // create the new block for the assignment
  const assign = this.cfg.start_new_block();
  this.cfg.push_assign(assign, source_info, place, clone_Rvalue(value));

  // create the new block for the assignment in the case of unwinding
  const assign_unwind = this.cfg.start_new_cleanup_block();
  this.cfg.push_assign(assign_unwind, source_info, place, clone_Rvalue(value));

  this.cfg.terminate(block, source_info, {
    $: "Drop",
    place,
    target: assign,
    unwind: { $: "Cleanup", _0: assign_unwind },
    replace: true,
    drop: undefined,
  });
  this.diverge_from(block);

  return unit(assign);
};

/// Creates an `Assert` terminator and return the success block.
/// If the boolean condition operand is not the expected value,
/// a runtime panic will be caused with the given message.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1738 assert
Builder.prototype.assert = function (this: Builder, block: BasicBlock, cond: Operand, expected: boolean, msg: AssertMessage, span: Span): BasicBlock {
  const source_info = this.source_info(span);
  const success_block = this.cfg.start_new_block();

  this.cfg.terminate(block, source_info, {
    $: "Assert",
    cond,
    expected,
    msg,
    target: success_block,
    unwind: UnwindAction.Continue,
  });
  this.diverge_from(block);

  return success_block;
};

/// Unschedules any drops in the top two scopes.
///
/// This is only needed for pattern-matches combining guards and or-patterns: or-patterns lead
/// to guards being lowered multiple times before lowering the arm body, so we unschedle drops
/// for guards' temporaries and bindings between lowering each instance of an match arm's guard.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1770 clear_match_arm_and_guard_scopes
Builder.prototype.clear_match_arm_and_guard_scopes = function (this: Builder, region_scope: region_Scope): void {
  const scopes = this.scopes.scopes;
  if (scopes.length < 2) {
    bug("matches with guards should introduce separate scopes for the pattern and guard");
  }
  const arm_scope = scopes[scopes.length - 2]!;
  const guard_scope = scopes[scopes.length - 1]!;

  assert_eq(arm_scope.region_scope, region_scope, (s) => debug_region_Scope(s, PLAIN), Scope_eq);
  assert_eq(guard_scope.region_scope.data, ScopeData.MatchGuard, (d) => debug_ScopeData(d, PLAIN), ScopeData_eq);
  assert_eq(guard_scope.region_scope.local_id, region_scope.local_id, (l) => debug_ItemLocalId(l, PLAIN));

  arm_scope.drops.length = 0;
  arm_scope.invalidate_cache();
  guard_scope.drops.length = 0;
  guard_scope.invalidate_cache();
};

/// Builds drops for `pop_scope` and `leave_top_scope`.
///
/// # Parameters
///
/// * `unwind_drops`, the drop tree data structure storing what needs to be cleaned up if unwind occurs
/// * `scope`, describes the drops that will occur on exiting the scope in regular execution
/// * `block`, the block to branch to once drops are complete (assuming no unwind occurs)
/// * `unwind_to`, describes the drops that would occur at this point in the code if a
///   panic occurred (a subset of the drops in `scope`, since we sometimes elide StorageDead and other
///   instructions on unwinding)
/// * `dropline_to`, describes the drops that would occur at this point in the code if a
///    coroutine drop occurred.
/// * `storage_dead_on_unwind`, if true, then we should emit `StorageDead` even when unwinding
/// * `arg_count`, number of MIR local variables corresponding to fn arguments (used to assert that we don't drop those)
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1800 build_scope_drops
export function build_scope_drops(cfg: CFG, unwind_drops: DropTree, coroutine_drops: DropTree, scope: Scope, block: BasicBlock, unwind_to: DropIdx, dropline_to: DropIdx | undefined, storage_dead_on_unwind: boolean, arg_count: number, is_async_drop: (a0: Local) => boolean): BlockAnd<null> {
  // debug!("build_scope_drops({:?} -> {:?}), dropline_to={:?}", block, scope, dropline_to);

  // Build up the drops in evaluation order. The end result will
  // look like:
  //
  // [SDs, drops[n]] --..> [SDs, drop[1]] -> [SDs, drop[0]] -> [[SDs]]
  //               |                    |                 |
  //               :                    |                 |
  //                                    V                 V
  // [drop[n]] -...-> [drop[1]] ------> [drop[0]] ------> [last_unwind_to]
  //
  // The horizontal arrows represent the execution path when the drops return
  // successfully. The downwards arrows represent the execution path when the
  // drops panic (panicking while unwinding will abort, so there's no need for
  // another set of arrows).
  //
  // For coroutines, we unwind from a drop on a local to its StorageDead
  // statement. For other functions we don't worry about StorageDead. The
  // drops for the unwind path should have already been generated by
  // `diverge_cleanup_gen`.

  // `unwind_to` indicates what needs to be dropped should unwinding occur.
  // This is a subset of what needs to be dropped when exiting the scope.
  // As we unwind the scope, we will also move `unwind_to` backwards to match,
  // so that we can use it should a destructor panic.
  // let mut unwind_to = unwind_to;

  // The block that we should jump to after drops complete. We start by building the final drop (`drops[n]`
  // in the diagram above) and then build the drops (e.g., `drop[1]`, `drop[0]`) that come before it.
  // block begins as the successor of `drops[n]` and then becomes `drops[n]` so that `drops[n-1]`
  // will branch to `drops[n]`.
  // let mut block = block;

  // `dropline_to` indicates what needs to be dropped should coroutine drop occur.
  // let mut dropline_to = dropline_to;

  for (let i = scope.drops.length - 1; i >= 0; i--) {
    const drop_data = scope.drops[i]!;
    const source_info = drop_data.source_info;
    const local = drop_data.local;

    switch (drop_data.kind) {
      case "Value": {
        // `unwind_to` should drop the value that we're about to
        // schedule. If dropping this value panics, then we continue
        // with the *next* value on the unwind path.
        //
        // We adjust this BEFORE we create the drop (e.g., `drops[n]`)
        // because `drops[n]` should unwind to `drops[n-1]`.
        // debug_assert_eq!(unwind_drops.drop_nodes[unwind_to].data.local, drop_data.local);
        // debug_assert_eq!(unwind_drops.drop_nodes[unwind_to].data.kind, drop_data.kind);
        unwind_to = unwind_drops.drop_nodes[unwind_to]!.next;

        if (dropline_to !== undefined) {
          const idx = dropline_to;
          // debug_assert_eq!(coroutine_drops.drop_nodes[idx].data.local, drop_data.local);
          // debug_assert_eq!(coroutine_drops.drop_nodes[idx].data.kind, drop_data.kind);
          dropline_to = coroutine_drops.drop_nodes[idx]!.next;
        }

        // If the operand has been moved, and we are not on an unwind
        // path, then don't generate the drop. (We only take this into
        // account for non-unwind paths so as not to disturb the
        // caching mechanism.)
        if (scope.moved_locals.includes(local)) {
          continue;
        }

        unwind_drops.add_entry_point(block, unwind_to);
        if (dropline_to !== undefined && is_async_drop(local)) {
          const to = dropline_to;
          coroutine_drops.add_entry_point(block, to);
        }

        const next = cfg.start_new_block();
        cfg.terminate(block, source_info, {
          $: "Drop",
          place: Place_from_Local(local),
          target: next,
          unwind: UnwindAction.Continue,
          replace: false,
          drop: undefined,
        });
        block = next;
        break;
      }
      case "ForLint": {
        // As in the `DropKind::Storage` case below:
        // normally lint-related drops are not emitted for unwind,
        // so we can just leave `unwind_to` unmodified, but in some
        // cases we emit things ALSO on the unwind path, so we need to adjust
        // `unwind_to` in that case.
        if (storage_dead_on_unwind) {
          // debug_assert_eq!(
          //     unwind_drops.drop_nodes[unwind_to].data.local,
          //     drop_data.local
          // );
          // debug_assert_eq!(unwind_drops.drop_nodes[unwind_to].data.kind, drop_data.kind);
          unwind_to = unwind_drops.drop_nodes[unwind_to]!.next;
        }

        // If the operand has been moved, and we are not on an unwind
        // path, then don't generate the drop. (We only take this into
        // account for non-unwind paths so as not to disturb the
        // caching mechanism.)
        if (scope.moved_locals.includes(local)) {
          continue;
        }

        cfg.push(
          block,
          Statement.new(source_info, {
            $: "BackwardIncompatibleDropHint",
            place: Place_from_Local(local),
            reason: "Edition2024",
          }),
        );
        break;
      }
      case "Storage": {
        // Ordinarily, storage-dead nodes are not emitted on unwind, so we don't
        // need to adjust `unwind_to` on this path. However, in some specific cases
        // we *do* emit storage-dead nodes on the unwind path, and in that case now that
        // the storage-dead has completed, we need to adjust the `unwind_to` pointer
        // so that any future drops we emit will not register storage-dead.
        if (storage_dead_on_unwind) {
          // debug_assert_eq!(
          //     unwind_drops.drop_nodes[unwind_to].data.local,
          //     drop_data.local
          // );
          // debug_assert_eq!(unwind_drops.drop_nodes[unwind_to].data.kind, drop_data.kind);
          unwind_to = unwind_drops.drop_nodes[unwind_to]!.next;
        }
        if (dropline_to !== undefined) {
          const idx = dropline_to;
          // debug_assert_eq!(coroutine_drops.drop_nodes[idx].data.local, drop_data.local);
          // debug_assert_eq!(coroutine_drops.drop_nodes[idx].data.kind, drop_data.kind);
          dropline_to = coroutine_drops.drop_nodes[idx]!.next;
        }
        // Only temps and vars need their storage dead.
        assert(Local.index(local) > arg_count, "assertion failed: local.index() > arg_count");
        cfg.push(block, Statement.new(source_info, { $: "StorageDead", _0: local }));
        break;
      }
    }
  }
  return unit(block);
}

/// Build a drop tree for a breakable scope.
///
/// If `continue_block` is `Some`, then the tree is for `continue` inside a
/// loop. Otherwise this is for `break`, `return`, or `if`.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:1969 build_exit_tree
Builder.prototype.build_exit_tree = function (this: Builder, drops: DropTree, else_scope: region_Scope, span: Span, continue_block: BasicBlock | undefined): BlockAnd<null> | undefined {
  const blocks = drops.build_mir(this.cfg, continue_block, DropTreeBuilder_ExitScopes);
  const is_coroutine = this.coroutine !== undefined;

  // Link the exit drop tree to unwind drop tree.
  if (drops.drop_nodes.some((drop_node) => drop_node.data.kind === "Value")) {
    const unwind_target = this.diverge_cleanup_target(else_scope, span);
    const unwind_indices: DropIdx[] = [unwind_target];
    for (let i = 1; i < drops.drop_nodes.length; i++) {
      const drop_idx = i as DropIdx;
      const drop_node = drops.drop_nodes[i]!;
      switch (drop_node.data.kind) {
        case "Storage":
        case "ForLint": {
          if (is_coroutine) {
            const unwind_drop = this.scopes.unwind_drops.add_drop(drop_node.data, unwind_indices[drop_node.next]!);
            unwind_indices.push(unwind_drop);
          } else {
            unwind_indices.push(unwind_indices[drop_node.next]!);
          }
          break;
        }
        case "Value": {
          const unwind_drop = this.scopes.unwind_drops.add_drop(drop_node.data, unwind_indices[drop_node.next]!);
          this.scopes.unwind_drops.add_entry_point(unwrap(blocks[drop_idx]), unwind_indices[drop_node.next]!);
          unwind_indices.push(unwind_drop);
          break;
        }
      }
    }
  }
  // Link the exit drop tree to dropline drop tree (coroutine drop path) for async drops
  if (is_coroutine && drops.drop_nodes.some(({ data }) => data.kind === "Value" && this.is_async_drop(data.local))) {
    const dropline_target = this.diverge_dropline_target(else_scope, span);
    const dropline_indices: DropIdx[] = [dropline_target];
    for (let i = 1; i < drops.drop_nodes.length; i++) {
      const drop_idx = i as DropIdx;
      const drop_data = drops.drop_nodes[i]!;
      const coroutine_drop = this.scopes.coroutine_drops.add_drop(drop_data.data, dropline_indices[drop_data.next]!);
      switch (drop_data.data.kind) {
        case "Storage":
        case "ForLint":
          break;
        case "Value": {
          if (this.is_async_drop(drop_data.data.local)) {
            this.scopes.coroutine_drops.add_entry_point(unwrap(blocks[drop_idx]), dropline_indices[drop_data.next]!);
          }
          break;
        }
      }
      dropline_indices.push(coroutine_drop);
    }
  }
  const root = blocks[ROOT_NODE];
  return root === undefined ? undefined : unit(root);
};

/// Build the unwind and coroutine drop trees.
// rustc: compiler/rustc_mir_build/src/builder/scope.rs:2041 build_drop_trees
Builder.prototype.build_drop_trees = function (this: Builder): void {
  if (this.coroutine !== undefined) {
    this.build_coroutine_drop_trees();
  } else {
    Builder.build_unwind_tree(this.cfg, this.scopes.unwind_drops, this.fn_span, { value: undefined });
  }
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:2054 build_coroutine_drop_trees
Builder.prototype.build_coroutine_drop_trees = function (this: Builder): void {
  // Build the drop tree for dropping the coroutine while it's suspended.
  const drops = this.scopes.coroutine_drops;
  const cfg = this.cfg;
  const fn_span = this.fn_span;
  const blocks = drops.build_mir(cfg, undefined, DropTreeBuilder_CoroutineDrop);
  const root_block = blocks[ROOT_NODE];
  if (root_block !== undefined) {
    cfg.terminate(root_block, SourceInfo.outermost(fn_span), { $: "CoroutineDrop" });
  }

  // Build the drop tree for unwinding in the normal control flow paths.
  const resume_block: MutRef<BasicBlock | undefined> = { value: undefined };
  const unwind_drops = this.scopes.unwind_drops;
  Builder.build_unwind_tree(cfg, unwind_drops, fn_span, resume_block);

  // Build the drop tree for unwinding when dropping a suspended
  // coroutine.
  //
  // This is a different tree to the standard unwind paths here to
  // prevent drop elaboration from creating drop flags that would have
  // to be captured by the coroutine. I'm not sure how important this
  // optimization is, but it is here.
  for (let i = 0; i < drops.drop_nodes.length; i++) {
    const drop_idx = i as DropIdx;
    const drop_node = drops.drop_nodes[i]!;
    const bb = blocks[drop_idx];
    if (drop_node.data.kind === "Value" && bb !== undefined) {
      // debug_assert!(drop_node.next < drops.drop_nodes.next_index());
      drops.entry_points.push([drop_node.next, bb]);
    }
  }
  Builder.build_unwind_tree(cfg, drops, fn_span, resume_block);
};

// rustc: compiler/rustc_mir_build/src/builder/scope.rs:2091 build_unwind_tree
(Builder as unknown as { build_unwind_tree: typeof Builder.build_unwind_tree }).build_unwind_tree = function (cfg: CFG, drops: DropTree, fn_span: Span, resume_block: MutRef<BasicBlock | undefined>): void {
  const blocks = drops.build_mir(cfg, resume_block.value, DropTreeBuilder_Unwind);
  const resume = blocks[ROOT_NODE];
  if (resume_block.value === undefined && resume !== undefined) {
    cfg.terminate(resume, SourceInfo.outermost(fn_span), { $: "UnwindResume" });

    resume_block.value = blocks[ROOT_NODE];
  }
};

// DropTreeBuilder implementations.

// struct ExitScopes; (scope.gen.ts)
export const DropTreeBuilder_ExitScopes: DropTreeBuilder = {
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2111 make_block
  make_block(cfg: CFG): BasicBlock {
    return cfg.start_new_block();
  },
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2114 link_entry_point
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    // There should be an existing terminator with real source info and a
    // dummy TerminatorKind. Replace it with a proper goto.
    // (The dummy is added by `break_scope` and `break_from_if_then_scope`.)
    const term = cfg.block_data_mut(from).terminator_mut();
    if (term.kind.$ === "UnwindResume") {
      term.kind = TerminatorKind.goto(to);
    } else {
      span_bug(term.source_info.span, `unexpected dummy terminator kind: ${debug_TerminatorKind(term.kind, PLAIN)}`);
    }
  },
};

// struct CoroutineDrop; (scope.gen.ts)
export const DropTreeBuilder_CoroutineDrop: DropTreeBuilder = {
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2130 make_block
  make_block(cfg: CFG): BasicBlock {
    return cfg.start_new_block();
  },
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2133 link_entry_point
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    const term = cfg.block_data_mut(from).terminator_mut();
    if (term.kind.$ === "Yield") {
      term.kind.drop = to;
    } else if (term.kind.$ === "Drop") {
      term.kind.drop = to;
    } else {
      span_bug(term.source_info.span, `cannot enter coroutine drop tree from ${debug_TerminatorKind(term.kind, PLAIN)}`);
    }
  },
};

// struct Unwind; (scope.gen.ts)
export const DropTreeBuilder_Unwind: DropTreeBuilder = {
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2152 make_block
  make_block(cfg: CFG): BasicBlock {
    return cfg.start_new_cleanup_block();
  },
  // rustc: compiler/rustc_mir_build/src/builder/scope.rs:2155 link_entry_point
  link_entry_point(cfg: CFG, from: BasicBlock, to: BasicBlock): void {
    const term = cfg.block_data_mut(from).terminator_mut();
    const kind = term.kind;
    switch (kind.$) {
      case "Drop": {
        const unwind = kind.unwind;
        if (unwind.$ === "Cleanup") {
          const source_info = term.source_info;
          cfg.terminate(unwind._0, source_info, TerminatorKind.goto(to));
        } else {
          kind.unwind = { $: "Cleanup", _0: to };
        }
        break;
      }
      case "FalseUnwind":
      case "Call":
      case "Assert":
      case "InlineAsm":
        kind.unwind = { $: "Cleanup", _0: to };
        break;
      case "Goto":
      case "SwitchInt":
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "TailCall":
      case "Unreachable":
      case "Yield":
      case "CoroutineDrop":
      case "FalseEdge":
        span_bug(term.source_info.span, `cannot unwind from ${debug_TerminatorKind(term.kind, PLAIN)}`);
    }
  },
};
