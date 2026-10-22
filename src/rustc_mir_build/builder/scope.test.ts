// Unit tests of builder/scope.ts (lane mb-scope) on hand-built `Builder` states: the scope stack, breakable scopes and
// their exit drop trees (`ExitScopes`), and the unwind drop tree (`Unwind`) built by `build_drop_trees`. The expected
// CFGs follow upstream's algorithms step by step (comments).
import { expect, test } from "bun:test";
import "../../rustc_middle/lib.ts";
import { type ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { Scope as RegionScope, ScopeData } from "../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Local, OUTERMOST_SOURCE_SCOPE, Place, SourceInfo, type StatementKind } from "../../rustc_middle/mir/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Panic } from "../../std/panic.ts";
import "../lib.ts";
import { and, BlockContext, Builder, CFG } from "./mod.ts";
import { DropIdx, DropTree, DropTreeBuilder_ExitScopes, Scopes, type DropData } from "./scope.ts";

const S = (n: number, data: ScopeData = ScopeData.Node) => new RegionScope(n as ItemLocalId, data);
const L = (n: number) => n as Local;
const si = () => SourceInfo.outermost(DUMMY_SP);
const storage = (n: number): DropData => ({ source_info: si(), local: L(n), kind: "Storage" });
const value = (n: number): DropData => ({ source_info: si(), local: L(n), kind: "Value" });

/** A `Builder` with only the fields scope.rs reads outside `tcx` (hand-built test state). */
function builder(): Builder {
  const b = Object.create(Builder.prototype) as Builder;
  Object.assign(b, {
    cfg: new CFG([]),
    scopes: Scopes.new(),
    source_scope: OUTERMOST_SOURCE_SCOPE,
    coroutine: undefined,
    arg_count: 0,
    fn_span: DUMMY_SP,
    block_context: new BlockContext([]),
    infcx: { typing_env: () => undefined },
  });
  return b;
}
const stmts = (b: Builder, bb: BasicBlock): unknown => b.cfg.block_data(bb).statements.map((s) => s.kind as StatementKind);
const term = (b: Builder, bb: BasicBlock): unknown => b.cfg.block_data(bb).terminator?.kind;

test("Scopes: push / topmost / stack_index / pop_scope", () => {
  const scopes = Scopes.new();
  scopes.push_scope(S(1), OUTERMOST_SOURCE_SCOPE);
  scopes.push_scope(S(2, ScopeData.Destruction), OUTERMOST_SOURCE_SCOPE);
  scopes.push_scope(S(1), OUTERMOST_SOURCE_SCOPE);
  expect(scopes.topmost()).toEqual(S(1));
  // `rposition`: the innermost match
  expect(scopes.stack_index(S(1), DUMMY_SP)).toBe(2);
  expect(scopes.stack_index(S(2, ScopeData.Destruction), DUMMY_SP)).toBe(1);
  expect(() => scopes.stack_index(S(2), DUMMY_SP)).toThrow();
  expect(() => scopes.pop_scope(S(3))).toThrow(Panic);
  scopes.push_scope(S(4), OUTERMOST_SOURCE_SCOPE);
  scopes.pop_scope(S(4));
  expect(scopes.scopes.length).toBe(2); // the failed pop_scope popped S(1) before asserting
});

test("DropTree::add_drop dedups on (next, local)", () => {
  const t = DropTree.new();
  const a = t.add_drop(storage(1), DropIdx.ZERO);
  const b = t.add_drop(storage(2), a);
  expect([a, b]).toEqual([1 as DropIdx, 2 as DropIdx]);
  expect(t.add_drop(value(1), DropIdx.ZERO)).toBe(a); // same key, existing node
  expect(t.add_drop(storage(1), b)).toBe(3 as DropIdx);
  expect(t.drop_nodes.length).toBe(4);
});

test("ExitScopes drop tree: StorageDeads share one block, the dummy terminator becomes a goto", () => {
  const b = builder();
  const bb0 = b.cfg.start_new_block();
  b.cfg.terminate(bb0, si(), { $: "UnwindResume" });
  const t = DropTree.new();
  const i2 = t.add_drop(storage(2), t.add_drop(storage(1), DropIdx.ZERO));
  t.add_entry_point(bb0, i2);
  const blocks = t.build_mir(b.cfg, undefined, DropTreeBuilder_ExitScopes);
  // idx2 gets a block (entry point); idx1 and the root share it (only reached through a StorageDead)
  expect(blocks as unknown).toEqual([1, 1, 1]);
  expect(term(b, bb0)).toEqual({ $: "Goto", target: 1, loop_hint_attrs: [] });
  expect(stmts(b, 1 as BasicBlock)).toEqual([
    { $: "StorageDead", _0: 2 },
    { $: "StorageDead", _0: 1 },
  ]);
  expect(term(b, 1 as BasicBlock)).toBeUndefined();
});

test("in_scope + in_breakable_scope + break_scope(Continue): drops go to the loop block", () => {
  const b = builder();
  const loop_block = b.cfg.start_new_block(); // bb0
  const start = b.cfg.start_new_block(); // bb1
  b.push_scope(S(10));
  const [after] = b.in_breakable_scope(loop_block, Place.return_place(), DUMMY_SP, (this_) => {
    const [blk] = this_.in_scope([S(11), si()], { $: "Inherited" }, (this_) => {
      this_.scopes.scopes[this_.scopes.scopes.length - 1]!.drops.push(storage(1));
      // `continue` leaves S(11): its StorageDead goes on the continue path
      const r = this_.break_scope(start, undefined, { $: "Continue", _0: S(10) }, si());
      // the scope's own exit (pop_scope) emits its StorageDead in the fresh block
      return r;
    });
    expect(stmts(this_, blk)).toEqual([{ $: "StorageDead", _0: 1 }]);
    return undefined; // no normal exit
  });
  // break_scope: bb1 -> (dummy) ; fresh bb2 returned and dropped by pop_scope
  // build_exit_tree(continue drops, root = bb0): node 1 gets bb3 (StorageDead(_1); goto bb0); bb1's dummy -> goto bb3
  expect(term(b, start)).toEqual({ $: "Goto", target: 3, loop_hint_attrs: [] });
  expect(stmts(b, 3 as BasicBlock)).toEqual([{ $: "StorageDead", _0: 1 }]);
  const t3 = b.cfg.block_data(3 as BasicBlock).terminator!;
  expect(t3.kind).toEqual({ $: "Goto", target: loop_block, loop_hint_attrs: [] });
  expect(t3.source_info.span).toBe(DUMMY_SP);
  // (None, None) => a fresh block
  expect(after).toBe(4 as BasicBlock);
  expect(b.scopes.breakable_scopes.length).toBe(0);
  expect(b.scopes.scopes.length).toBe(1);
  expect(b.cfg.basic_blocks.length).toBe(5);
});

test("in_if_then_scope: no else drops -> fresh false block; break_from_if_then_scope -> drop tree", () => {
  const b = builder();
  const bb0 = b.cfg.start_new_block();
  b.push_scope(S(20));
  const [t1, f1] = b.in_if_then_scope(S(20), DUMMY_SP, (this_) => and(bb0, null));
  expect([t1, f1] as unknown).toEqual([0, 1]);

  const c = builder();
  const cb0 = c.cfg.start_new_block();
  c.push_scope(S(20));
  c.push_scope(S(21));
  c.scopes.scopes[1]!.drops.push(storage(3));
  const [t2, f2] = c.in_if_then_scope(S(20), DUMMY_SP, (this_) => {
    this_.break_from_if_then_scope(cb0, si());
    return and(this_.cfg.start_new_block(), null); // bb1
  });
  // else tree: node 1 (StorageDead(_3)) and the root share bb2, which is the false block
  expect([t2, f2] as unknown).toEqual([1, 2]);
  expect(term(c, cb0)).toEqual({ $: "Goto", target: 2, loop_hint_attrs: [] });
  expect(stmts(c, 2 as BasicBlock)).toEqual([{ $: "StorageDead", _0: 3 }]);
  expect(c.scopes.if_then_scope).toBeUndefined();
});

test("leave_top_scope with a value drop + build_drop_trees: Drop terminator unwinding to a resume block", () => {
  const b = builder();
  const bb0 = b.cfg.start_new_block();
  b.push_scope(S(30));
  b.scopes.scopes[0]!.drops.push(storage(1), value(1));
  const [out] = b.pop_scope(S(30), bb0);
  // diverge_cleanup: unwind node 1 = Value(_1); build_scope_drops: Drop(_1) bb0 -> bb1, StorageDead(_1) in bb1
  expect(out).toBe(1 as BasicBlock);
  expect(term(b, bb0)).toEqual({
    $: "Drop",
    place: new Place(L(1), Place.return_place().projection),
    target: 1,
    unwind: { $: "Continue" },
    replace: false,
    drop: undefined,
  });
  expect(stmts(b, 1 as BasicBlock)).toEqual([{ $: "StorageDead", _0: 1 }]);
  expect(b.scopes.unwind_drops.entry_points as unknown).toEqual([[0, 0]]); // unwind_to moved past the dropped value: the root

  b.build_drop_trees();
  // the root of the unwind tree gets cleanup block bb2 (UnwindResume); bb0's Drop unwinds to it
  expect((term(b, bb0) as { unwind: unknown }).unwind).toEqual({ $: "Cleanup", _0: 2 });
  expect(b.cfg.block_data(2 as BasicBlock).is_cleanup).toBe(true);
  expect(term(b, 2 as BasicBlock)).toEqual({ $: "UnwindResume" });
  expect(b.cfg.basic_blocks.length).toBe(3);
});

test("record_operands_moved suppresses the drop on the normal path only", () => {
  const b = builder();
  const bb0 = b.cfg.start_new_block();
  b.push_scope(S(40));
  b.scopes.scopes[0]!.drops.push(value(2));
  b.record_operands_moved([{ node: { $: "Move", _0: new Place(L(2), Place.return_place().projection) }, span: DUMMY_SP }]);
  expect(b.scopes.scopes[0]!.moved_locals).toEqual([L(2)]);
  const [out] = b.pop_scope(S(40), bb0);
  expect(out).toBe(bb0); // no Drop terminator
  expect(term(b, bb0)).toBeUndefined();
  // the unwind path still has the drop cached
  expect(b.scopes.unwind_drops.drop_nodes.length).toBe(2);
});

test("clear_match_arm_and_guard_scopes clears the top two scopes", () => {
  const b = builder();
  b.push_scope(S(50));
  b.push_scope(S(50, ScopeData.MatchGuard));
  b.scopes.scopes[0]!.drops.push(storage(1));
  b.scopes.scopes[1]!.drops.push(storage(2));
  b.scopes.scopes[1]!.cached_unwind_block = 1 as DropIdx;
  b.clear_match_arm_and_guard_scopes(S(50));
  expect(b.scopes.scopes.map((s) => s.drops.length)).toEqual([0, 0]);
  expect(b.scopes.scopes[1]!.cached_unwind_block).toBeUndefined();
  expect(() => b.clear_match_arm_and_guard_scopes(S(51))).toThrow(Panic);
});
