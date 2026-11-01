// Unit tests of src/miri/borrow_tracker/mod.ts (lane miri-alloc): the borrow tracker's global state (tag generation, root
// tags, protectors, the GC hook, the retag mode), the dispatch to Stacked / Tree Borrows, and the per-allocation helpers.
// Upstream has no unit tests for this file; the expected values follow from upstream's code (borrow_tracker/mod.rs).
// The interpreter / machine around the fns are test doubles with only the fields the fns read.
import { expect, test } from "bun:test";
import "../lib.ts";
import {
  AllocState,
  BorrowTrackerMethod,
  BorTag,
  debug_GlobalStateInner,
  display_AccessKind,
  type FrameState,
  GlobalStateInner,
  VisitProvenance_AllocState,
  VisitProvenance_FrameState,
} from "./mod.ts";
import { AllocExtra, type FrameExtra, type MiriInterpCx, type MiriMachine } from "../machine.ts";
import { type LiveAllocs } from "../provenance_gc.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AllocId, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";

const id = (n: number) => n as AllocId;
const tag = (n: number) => n as BorTag;

function panic_msg(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  return "no panic";
}

test("AccessKind Display", () => {
  expect(display_AccessKind("Read")).toBe("read access");
  expect(display_AccessKind("Write")).toBe("write access");
});

test("GlobalStateInner::new, new_ptr, root_ptr_tag (cached per allocation), tracked tags", () => {
  const gs = GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set([tag(3)]));
  expect(debug_GlobalStateInner(gs, PLAIN)).toBe(
    "GlobalStateInner { borrow_tracker_method: StackedBorrows, retag_mode: Default, next_ptr_tag: <1>, root_ptr_tags: {}, protected_tags: {}, tracked_pointer_tags: {<3>} }",
  );
  expect(gs.new_ptr()).toBe(tag(1));
  expect(gs.new_ptr()).toBe(tag(2));
  const emitted: unknown[] = [];
  const machine = { emit_diagnostic: (d: unknown) => emitted.push(d) } as unknown as MiriMachine;
  // The next tag (3) is tracked: its creation is reported.
  expect(gs.root_ptr_tag(id(7), machine)).toBe(tag(3));
  expect(emitted).toEqual([{ $: "CreatedPointerTag", _0: 3n, _1: undefined, _2: undefined }]);
  // Cached: no new tag, no new diagnostic.
  expect(gs.root_ptr_tag(id(7), machine)).toBe(tag(3));
  expect(gs.root_ptr_tag(id(8), machine)).toBe(tag(4));
  expect(emitted.length).toBe(1);
  expect(gs.next_ptr_tag).toBe(tag(5));
  expect(gs.borrow_tracker_method_()).toBe(BorrowTrackerMethod.StackedBorrows);
});

test("remove_unreachable_allocs keeps only live root tags", () => {
  const gs = GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set());
  const machine = { emit_diagnostic: () => {} } as unknown as MiriMachine;
  for (const n of [1, 2, 3, 4]) gs.root_ptr_tag(id(n), machine);
  gs.remove_unreachable_allocs({ is_live: (a: AllocId) => a % 2 === 0 } as unknown as LiveAllocs);
  expect([...gs.root_ptr_tags.keys()]).toEqual([id(2), id(4)]);
});

test("new_frame / end_call: the frame's protected tags leave the global protector set", () => {
  const gs = GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set());
  const frame: FrameState = gs.new_frame();
  expect(frame.protected_tags).toEqual([]);
  frame.protected_tags.push([id(1), tag(5)], [id(2), tag(6)]);
  gs.protected_tags.set(tag(5), "StrongProtector");
  gs.protected_tags.set(tag(6), "WeakProtector");
  gs.protected_tags.set(tag(9), "StrongProtector");
  gs.end_call({ borrow_tracker: frame } as unknown as FrameExtra);
  expect([...gs.protected_tags.keys()]).toEqual([tag(9)]);
  expect(panic_msg(() => gs.end_call({ borrow_tracker: undefined } as unknown as FrameExtra))).toBe("we should have borrow tracking data");
  // VisitProvenance for FrameState visits every protected tag with its allocation.
  const seen: [unknown, unknown][] = [];
  VisitProvenance_FrameState.visit_provenance(frame, (a, t) => seen.push([a, t]));
  expect(seen).toEqual([[id(1), tag(5)], [id(2), tag(6)]]);
});

test("BorrowTrackerMethod: instantiate_global_state copies the tracked tags; get_tree_borrows_params", () => {
  const tracked = new Set([tag(2)]);
  const gs = BorrowTrackerMethod.instantiate_global_state(BorrowTrackerMethod.StackedBorrows, { tracked_pointer_tags: tracked } as never);
  expect(gs.tracked_pointer_tags).toEqual(tracked);
  expect(gs.tracked_pointer_tags).not.toBe(tracked);
  const params = { precise_interior_mut: true, implicit_writes: false };
  expect(BorrowTrackerMethod.get_tree_borrows_params({ $: "TreeBorrows", _0: params })).toBe(params);
  expect(panic_msg(() => BorrowTrackerMethod.get_tree_borrows_params(BorrowTrackerMethod.StackedBorrows))).toBe(
    "can only be called when `BorrowTrackerMethod` is `TreeBorrows`",
  );
});

/** An interpreter double with a borrow tracker, recording the Stacked / Tree Borrows calls it dispatches to. */
function ecx_with(gs: GlobalStateInner | undefined, calls: string[]): MiriInterpCx {
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.length})`);
    return interp_ok(undefined);
  };
  return {
    machine: { borrow_tracker: gs },
    eval_context_mut() {
      return this;
    },
    eval_context_ref() {
      return this;
    },
    sb_retag_ptr_value: rec("sb_retag_ptr_value"),
    tb_retag_ptr_value: rec("tb_retag_ptr_value"),
    sb_protect_place: rec("sb_protect_place"),
    tb_protect_place: rec("tb_protect_place"),
    sb_expose_tag: rec("sb_expose_tag"),
    tb_expose_tag: rec("tb_expose_tag"),
    print_stacks: rec("print_stacks"),
    print_tree: rec("print_tree"),
    tb_give_pointer_debug_name: rec("tb_give_pointer_debug_name"),
  } as unknown as MiriInterpCx;
}

test("with_retag_mode sets the mode for the callback and restores it", () => {
  const gs = GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set());
  const ecx = ecx_with(gs, []);
  let inner: unknown;
  const r = InterpCx.prototype.with_retag_mode.call(ecx, "Raw", (e: MiriInterpCx) => {
    inner = e.machine.borrow_tracker!.retag_mode;
    return interp_ok(42);
  });
  expect(r).toEqual(interp_ok(42));
  expect(inner).toBe("Raw");
  expect(gs.retag_mode).toBe("Default");
});

test("EvalContextExt dispatches on the borrow tracker method", () => {
  const calls: string[] = [];
  const sb = ecx_with(GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set()), calls);
  const tb = ecx_with(GlobalStateInner.new({ $: "TreeBorrows", _0: { precise_interior_mut: false, implicit_writes: false } }, new Set()), calls);
  for (const ecx of [sb, tb]) {
    InterpCx.prototype.retag_ptr_value.call(ecx, {} as never, {} as never);
    InterpCx.prototype.protect_place.call(ecx, {} as never);
    InterpCx.prototype.expose_tag.call(ecx, id(1), tag(1));
    InterpCx.prototype.print_borrow_state.call(ecx, id(1), true);
  }
  InterpCx.prototype.give_pointer_debug_name.call(tb, {} as never, 0, "x");
  expect(calls).toEqual([
    "sb_retag_ptr_value(3)",
    "sb_protect_place(1)",
    "sb_expose_tag(2)",
    "print_stacks(1)",
    "tb_retag_ptr_value(3)",
    "tb_protect_place(1)",
    "tb_expose_tag(2)",
    "print_tree(2)",
    "tb_give_pointer_debug_name(3)",
  ]);
  // No borrow tracker: printing the state is a no-op (with a message on stderr).
  expect(InterpCx.prototype.print_borrow_state.call(ecx_with(undefined, calls), id(1), false)).toEqual(interp_ok(undefined));
});

test("on_stack_pop releases the protectors of live allocations and ends the call", () => {
  const gs = GlobalStateInner.new(BorrowTrackerMethod.StackedBorrows, new Set());
  gs.protected_tags.set(tag(5), "StrongProtector");
  gs.protected_tags.set(tag(6), "StrongProtector");
  const looked: AllocId[] = [];
  const ecx = {
    ...ecx_with(gs, []),
    eval_context_ref() {
      return this;
    },
    get_alloc_info: (a: AllocId) => ({ kind: a === id(1) ? "LiveData" : "Dead" }),
    get_alloc_extra: (a: AllocId) => {
      looked.push(a);
      return interp_ok({ borrow_tracker: { $: "StackedBorrows", _0: {} } });
    },
  } as unknown as MiriInterpCx;
  const frame = { extra: { borrow_tracker: { protected_tags: [[id(1), tag(5)], [id(2), tag(6)]] } } };
  expect(InterpCx.prototype.on_stack_pop.call(ecx, frame as never)).toEqual(interp_ok(undefined));
  expect(looked).toEqual([id(1)]);
  expect(gs.protected_tags.size).toBe(0);
});

test("AllocExtra::borrow_tracker_{sb,sb_mut,tb} (deferred ports) and AllocState", () => {
  const stacks = {};
  const sb = Object.assign(Object.create(AllocExtra.prototype), { borrow_tracker: { $: "StackedBorrows", _0: stacks } }) as AllocExtra;
  expect(sb.borrow_tracker_sb()).toBe(stacks as never);
  expect(sb.borrow_tracker_sb_mut()).toBe(stacks as never);
  expect(panic_msg(() => sb.borrow_tracker_tb())).toBe("expected Tree Borrows borrow tracking, got something else");
  const none = Object.assign(Object.create(AllocExtra.prototype), { borrow_tracker: undefined }) as AllocExtra;
  expect(panic_msg(() => none.borrow_tracker_sb())).toBe("expected Stacked Borrows borrow tracking, got something else");
  // Stacked Borrows needs no protector release.
  const st: AllocState = { $: "StackedBorrows", _0: stacks as never };
  expect(AllocState.release_protector(st, {} as never, {} as never, tag(1), id(1))).toEqual(interp_ok(undefined));
  const visited: string[] = [];
  VisitProvenance_AllocState.visit_provenance({ $: "StackedBorrows", _0: { visit_provenance: () => visited.push("sb") } as never }, () => {});
  expect(visited).toEqual(["sb"]);
});
