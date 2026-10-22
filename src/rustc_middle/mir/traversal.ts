// Port of compiler/rustc_middle/src/mir/traversal.rs (lane mir-contract, plan-m4 D3): `Preorder`, `Postorder` and
// `MonoReachable` are generated classes (traversal.gen.ts, set rustc_middle_mir, with the structs' doc comments); the fns
// are ported below (lane mir-body-a).
// PORT: the `Iterator` impls are JS iterators (precedent rustc_data_structures graph/iterate DepthFirstSearch): `next()`
// returns an `IteratorResult` (`{ done: true }` for `None`) and the classes are iterable (`[Symbol.iterator]` returns
// `this`); `size_hint` stays a method. Iterator-returning fns with `ExactSizeIterator + DoubleEndedIterator` return arrays.
import "./mod.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Instance } from "../ty/decls.ts";
import { type BasicBlock, type BasicBlockData, type Body, START_BLOCK } from "./mod.gen.ts";
import type { Successors } from "./terminator.ts";
import { MonoReachable, Postorder, Preorder } from "./traversal.gen.ts";
export * from "./traversal.gen.ts";

declare module "./traversal.gen.ts" {
  interface Preorder extends IterableIterator<[BasicBlock, BasicBlockData]> {}
  interface Postorder extends IterableIterator<BasicBlock> {}
  interface MonoReachable extends IterableIterator<[BasicBlock, BasicBlockData]> {}
}
// PORT: `IntoIterator` of the `Iterator` impls (JS iteration over `next()`).
for (const C of [Preorder, Postorder, MonoReachable]) {
  (C.prototype as unknown as { [Symbol.iterator](): unknown })[Symbol.iterator] = function (this: unknown): unknown {
    return this;
  };
}

declare module "./traversal.gen.ts" {
  namespace Preorder {
    // traversal.rs:29 (lane mir-body-a)
    function new_(body: Body, root: BasicBlock): Preorder;
    export { new_ as new };
  }
}

declare module "./traversal.gen.ts" {
  interface Preorder {
    // traversal.rs:49 (lane mir-body-a) impl Iterator
    next(): IteratorResult<[BasicBlock, BasicBlockData]>;
    // traversal.rs:67 (lane mir-body-a) impl Iterator
    size_hint(): [number, number | undefined];
  }
}

declare module "./traversal.gen.ts" {
  namespace Postorder {
    // traversal.rs:106 (lane mir-body-a)
    function new_(basic_blocks: readonly BasicBlockData[], root: BasicBlock, extra: [TyCtxt, Instance] | undefined): Postorder;
    export { new_ as new };
  }
}

declare module "./traversal.gen.ts" {
  interface Postorder {
    // traversal.rs:124 (lane mir-body-a)
    visit(bb: BasicBlock): void;
    // traversal.rs:137 (lane mir-body-a)
    traverse_successor(): void;
    // traversal.rs:194 (lane mir-body-a) impl Iterator
    next(): IteratorResult<BasicBlock>;
    // traversal.rs:201 (lane mir-body-a) impl Iterator
    size_hint(): [number, number | undefined];
  }
}

declare module "./traversal.gen.ts" {
  namespace MonoReachable {
    // traversal.rs:331 (lane mir-body-a)
    function new_(body: Body, tcx: TyCtxt, instance: Instance): MonoReachable;
    export { new_ as new };
  }
}

declare module "./traversal.gen.ts" {
  interface MonoReachable {
    // traversal.rs:347 (lane mir-body-a)
    add_work(blocks: Iterable<BasicBlock>): void;
    // traversal.rs:359 (lane mir-body-a) impl Iterator
    next(): IteratorResult<[BasicBlock, BasicBlockData]>;
  }
}

// rustc: compiler/rustc_middle/src/mir/traversal.rs:29 new
(Preorder as unknown as { new: typeof Preorder.new }).new = function (body: Body, root: BasicBlock): Preorder {
  const worklist = [root];

  return new Preorder(body, DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length), worklist);
};

/// Preorder traversal of a graph.
///
/// This function creates an iterator over the `Body`'s basic blocks, that
/// returns basic blocks in a preorder.
///
/// See [`Preorder`]'s docs to learn what is preorder traversal.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:42 preorder
export function preorder(body: Body): Preorder {
  return Preorder.new(body, START_BLOCK);
}

// impl Iterator for Preorder
// rustc: compiler/rustc_middle/src/mir/traversal.rs:49 next
Preorder.prototype.next = function (this: Preorder): IteratorResult<[BasicBlock, BasicBlockData]> {
  let idx: BasicBlock | undefined;
  while ((idx = this.worklist.pop()) !== undefined) {
    if (!this.visited.insert(idx)) {
      continue;
    }

    const data = this.body.index(idx);

    if (data.terminator !== undefined) {
      const term = data.terminator;
      this.worklist.push(...term.successors());
    }

    return { done: false, value: [idx, data] };
  }

  return { done: true, value: undefined };
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:67 size_hint
Preorder.prototype.size_hint = function (this: Preorder): [number, number | undefined] {
  // The worklist might be only things already visited.
  const lower = 0;

  // This is extremely loose, but it's not worth a popcnt loop to do better.
  const upper = this.body.basic_blocks.deref().length;

  return [lower, upper];
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:106 new
(Postorder as unknown as { new: typeof Postorder.new }).new = function (basic_blocks: readonly BasicBlockData[], root: BasicBlock, extra: [TyCtxt, Instance] | undefined): Postorder {
  // PORT: the generated field is `BasicBlockData[]` for upstream's `&'a IndexSlice` (only read here).
  const po = new Postorder(basic_blocks as BasicBlockData[], DenseBitSet.new_empty<BasicBlock>(basic_blocks.length), [], extra);

  po.visit(root);
  po.traverse_successor();

  return po;
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:124 visit
Postorder.prototype.visit = function (this: Postorder, bb: BasicBlock): void {
  if (!this.visited.insert(bb)) {
    return;
  }
  const data = this.basic_blocks[bb]!;
  let successors: Successors;
  if (this.extra !== undefined) {
    const extra = this.extra;
    successors = data.mono_successors(extra[0], extra[1]);
  } else {
    successors = data.terminator_().successors();
  }
  this.visit_stack.push([bb, successors]);
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:137 traverse_successor
Postorder.prototype.traverse_successor = function (this: Postorder): void {
  // This is quite a complex loop due to 1. the borrow checker not liking it much
  // and 2. what exactly is going on is not clear
  //
  // It does the actual traversal of the graph, while the `next` method on the iterator
  // just pops off of the stack. `visit_stack` is a stack containing pairs of nodes and
  // iterators over the successors of those nodes. Each iteration attempts to get the next
  // node from the top of the stack, then pushes that node and an iterator over the
  // successors to the top of the stack. This loop only grows `visit_stack`, stopping when
  // we reach a child that has no children that we haven't already visited.
  //
  // For a graph that looks like this:
  //
  //         A
  //        / \
  //       /   \
  //      B     C
  //      |     |
  //      |     |
  //      |     D
  //       \   /
  //        \ /
  //         E
  //
  // The state of the stack starts out with just the root node (`A` in this case);
  //     [(A, [B, C])]
  //
  // When the first call to `traverse_successor` happens, the following happens:
  //
  //     [(C, [D]),  // `C` taken from the successors of `A`, pushed to the
  //                 // top of the stack along with the successors of `C`
  //      (A, [B])]
  //
  //     [(D, [E]),  // `D` taken from successors of `C`, pushed to stack
  //      (C, []),
  //      (A, [B])]
  //
  //     [(E, []),   // `E` taken from successors of `D`, pushed to stack
  //      (D, []),
  //      (C, []),
  //      (A, [B])]
  //
  // Now that the top of the stack has no successors we can traverse, each item will
  // be popped off during iteration until we get back to `A`. This yields [E, D, C].
  //
  // When we yield `C` and call `traverse_successor`, we push `B` to the stack, but
  // since we've already visited `E`, that child isn't added to the stack. The last
  // two iterations yield `B` and finally `A` for a final traversal of [E, D, C, B, A]
  for (;;) {
    const top = this.visit_stack[this.visit_stack.length - 1];
    if (top === undefined) break;
    const r = top[1].next_back();
    if (r.done) break;
    const bb = r.value;
    this.visit(bb);
  }
};

// impl Iterator for Postorder
// rustc: compiler/rustc_middle/src/mir/traversal.rs:194 next
Postorder.prototype.next = function (this: Postorder): IteratorResult<BasicBlock> {
  const top = this.visit_stack.pop();
  if (top === undefined) return { done: true, value: undefined };
  const [bb] = top;
  this.traverse_successor();

  return { done: false, value: bb };
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:201 size_hint
Postorder.prototype.size_hint = function (this: Postorder): [number, number | undefined] {
  // These bounds are not at all tight, but that's fine.
  // It's not worth a popcnt loop in `DenseBitSet` to improve the upper,
  // and in mono-reachable we can't be precise anyway.
  // Leaning on amortized growth is fine.

  const lower = this.visit_stack.length;
  const upper = this.basic_blocks.length;
  return [lower, upper];
};

/// Postorder traversal of a graph.
///
/// This function creates an iterator over the `Body`'s basic blocks, that:
/// - returns basic blocks in a postorder,
/// - traverses the `BasicBlocks` CFG cache's reverse postorder backwards, and does not cache the
///   postorder itself.
///
/// See [`Postorder`]'s docs to learn what is postorder traversal.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:221 postorder
export function postorder(body: Body): readonly [BasicBlock, BasicBlockData][] {
  return reverse_postorder(body).slice().reverse();
}

// rustc: compiler/rustc_middle/src/mir/traversal.rs:228 mono_reachable_reverse_postorder
export function mono_reachable_reverse_postorder(body: Body, tcx: TyCtxt, instance: Instance): BasicBlock[] {
  const iter = Postorder.new(body.basic_blocks.deref(), START_BLOCK, [tcx, instance]);
  const items: BasicBlock[] = [];
  for (let r = iter.next(); !r.done; r = iter.next()) {
    const block = r.value;
    items.push(block);
  }
  items.reverse();
  return items;
}

/// Returns an iterator over all basic blocks reachable from the `START_BLOCK` in no particular
/// order.
///
/// This is clearer than writing `preorder` in cases where the order doesn't matter.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:246 reachable
export function reachable(body: Body): IterableIterator<[BasicBlock, BasicBlockData]> {
  return preorder(body);
}

/// Returns a `DenseBitSet` containing all basic blocks reachable from the `START_BLOCK`.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:253 reachable_as_bitset
export function reachable_as_bitset(body: Body): DenseBitSet<BasicBlock> {
  const iter = preorder(body);
  while (!iter.next().done) {}
  return iter.visited;
}

/// Reverse postorder traversal of a graph.
///
/// This function creates an iterator over the `Body`'s basic blocks, that:
/// - returns basic blocks in a reverse postorder,
/// - makes use of the `BasicBlocks` CFG cache's reverse postorder.
///
/// Reverse postorder is the reverse order of a postorder traversal.
/// This is different to a preorder traversal and represents a natural
/// linearization of control-flow.
///
/// ```text
///
///         A
///        / \
///       /   \
///      B     C
///       \   /
///        \ /
///         D
/// ```
///
/// A reverse postorder traversal of this graph is either `A B C D` or `A C B D`
/// Note that for a graph containing no loops (i.e., A DAG), this is equivalent to
/// a topological sort.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:283 reverse_postorder
export function reverse_postorder(body: Body): readonly [BasicBlock, BasicBlockData][] {
  return body.basic_blocks.reverse_postorder().map((bb): [BasicBlock, BasicBlockData] => [bb, body.basic_blocks.deref()[bb]!]);
}

/// Traversal of a [`Body`] that tries to avoid unreachable blocks in a monomorphized [`Instance`].
///
/// This is allowed to have false positives; blocks may be visited even if they are not actually
/// reachable.
///
/// Such a traversal is mostly useful because it lets us skip lowering the `false` side
/// of `if <T as Trait>::CONST`, as well as [`Operand::RuntimeChecks`].
///
/// [`Operand::RuntimeChecks`]: rustc_middle::mir::Operand::RuntimeChecks
// rustc: compiler/rustc_middle/src/mir/traversal.rs:299 mono_reachable
export function mono_reachable(body: Body, tcx: TyCtxt, instance: Instance): MonoReachable {
  return MonoReachable.new(body, tcx, instance);
}

/// [`MonoReachable`] internally accumulates a [`DenseBitSet`] of visited blocks. This is just a
/// convenience function to run that traversal then extract its set of reached blocks.
// rustc: compiler/rustc_middle/src/mir/traversal.rs:309 mono_reachable_as_bitset
export function mono_reachable_as_bitset(body: Body, tcx: TyCtxt, instance: Instance): DenseBitSet<BasicBlock> {
  const iter = mono_reachable(body, tcx, instance);
  while (!iter.next().done) {}
  return iter.visited;
}

// rustc: compiler/rustc_middle/src/mir/traversal.rs:331 new
(MonoReachable as unknown as { new: typeof MonoReachable.new }).new = function (body: Body, tcx: TyCtxt, instance: Instance): MonoReachable {
  const worklist = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
  worklist.insert(START_BLOCK);
  return new MonoReachable(body, tcx, instance, DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length), worklist);
};

// rustc: compiler/rustc_middle/src/mir/traversal.rs:347 add_work
MonoReachable.prototype.add_work = function (this: MonoReachable, blocks: Iterable<BasicBlock>): void {
  for (const block of blocks) {
    if (!this.visited.contains(block)) {
      this.worklist.insert(block);
    }
  }
};

// impl Iterator for MonoReachable
// rustc: compiler/rustc_middle/src/mir/traversal.rs:359 next
MonoReachable.prototype.next = function (this: MonoReachable): IteratorResult<[BasicBlock, BasicBlockData]> {
  for (;;) {
    const r = this.worklist.iter().next();
    if (r.done) break;
    const idx = r.value;
    this.worklist.remove(idx);
    if (!this.visited.insert(idx)) {
      continue;
    }

    const data = this.body.index(idx);

    const targets = data.mono_successors(this.tcx, this.instance);
    this.add_work(targets);

    return { done: false, value: [idx, data] };
  }

  return { done: true, value: undefined };
};
