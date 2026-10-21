// Port of compiler/rustc_middle/src/mir/traversal.rs (lane mir-contract, plan-m4 D3): `Preorder`, `Postorder` and
// `MonoReachable` are generated classes (traversal.gen.ts, set rustc_middle_mir); every fn is declared below as a stub
// for lane mir-body-a (docs/handoff/mir-contract.md "How to fill a stub").
// PORT: the `Iterator` impls are JS iterators (precedent rustc_data_structures graph/iterate DepthFirstSearch): `next()`
// returns an `IteratorResult` (`{ done: true }` for `None`) and the classes are iterable (`[Symbol.iterator]` returns
// `this`); `size_hint` stays a method. Iterator-returning fns with `ExactSizeIterator + DoubleEndedIterator` return arrays.
import "./mod.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { unported } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Instance } from "../ty/decls.ts";
import type { BasicBlock, BasicBlockData, Body } from "./mod.gen.ts";
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

// stub: compiler/rustc_middle/src/mir/traversal.rs:29 new (lane mir-body-a)
(Preorder as unknown as { new: typeof Preorder.new }).new = function (body: Body, root: BasicBlock): Preorder {
  return unported("rustc_middle::mir::traversal::Preorder::new");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:42 preorder (lane mir-body-a)
export function preorder(body: Body): Preorder {
  return unported("rustc_middle::mir::traversal::preorder");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:49 next (lane mir-body-a)
Preorder.prototype.next = function (this: Preorder): IteratorResult<[BasicBlock, BasicBlockData]> {
  return unported("rustc_middle::mir::traversal::<Preorder as Iterator>::next");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:67 size_hint (lane mir-body-a)
Preorder.prototype.size_hint = function (this: Preorder): [number, number | undefined] {
  return unported("rustc_middle::mir::traversal::<Preorder as Iterator>::size_hint");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:106 new (lane mir-body-a)
(Postorder as unknown as { new: typeof Postorder.new }).new = function (basic_blocks: readonly BasicBlockData[], root: BasicBlock, extra: [TyCtxt, Instance] | undefined): Postorder {
  return unported("rustc_middle::mir::traversal::Postorder::new");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:124 visit (lane mir-body-a)
Postorder.prototype.visit = function (this: Postorder, bb: BasicBlock): void {
  return unported("rustc_middle::mir::traversal::Postorder::visit");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:137 traverse_successor (lane mir-body-a)
Postorder.prototype.traverse_successor = function (this: Postorder): void {
  return unported("rustc_middle::mir::traversal::Postorder::traverse_successor");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:194 next (lane mir-body-a)
Postorder.prototype.next = function (this: Postorder): IteratorResult<BasicBlock> {
  return unported("rustc_middle::mir::traversal::<Postorder as Iterator>::next");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:201 size_hint (lane mir-body-a)
Postorder.prototype.size_hint = function (this: Postorder): [number, number | undefined] {
  return unported("rustc_middle::mir::traversal::<Postorder as Iterator>::size_hint");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:221 postorder (lane mir-body-a)
export function postorder(body: Body): readonly [BasicBlock, BasicBlockData][] {
  return unported("rustc_middle::mir::traversal::postorder");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:228 mono_reachable_reverse_postorder (lane mir-body-a)
export function mono_reachable_reverse_postorder(body: Body, tcx: TyCtxt, instance: Instance): BasicBlock[] {
  return unported("rustc_middle::mir::traversal::mono_reachable_reverse_postorder");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:246 reachable (lane mir-body-a)
export function reachable(body: Body): IterableIterator<[BasicBlock, BasicBlockData]> {
  return unported("rustc_middle::mir::traversal::reachable");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:253 reachable_as_bitset (lane mir-body-a)
export function reachable_as_bitset(body: Body): DenseBitSet<BasicBlock> {
  return unported("rustc_middle::mir::traversal::reachable_as_bitset");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:283 reverse_postorder (lane mir-body-a)
export function reverse_postorder(body: Body): readonly [BasicBlock, BasicBlockData][] {
  return unported("rustc_middle::mir::traversal::reverse_postorder");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:299 mono_reachable (lane mir-body-a)
export function mono_reachable(body: Body, tcx: TyCtxt, instance: Instance): MonoReachable {
  return unported("rustc_middle::mir::traversal::mono_reachable");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:309 mono_reachable_as_bitset (lane mir-body-a)
export function mono_reachable_as_bitset(body: Body, tcx: TyCtxt, instance: Instance): DenseBitSet<BasicBlock> {
  return unported("rustc_middle::mir::traversal::mono_reachable_as_bitset");
}


// stub: compiler/rustc_middle/src/mir/traversal.rs:331 new (lane mir-body-a)
(MonoReachable as unknown as { new: typeof MonoReachable.new }).new = function (body: Body, tcx: TyCtxt, instance: Instance): MonoReachable {
  return unported("rustc_middle::mir::traversal::MonoReachable::new");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:347 add_work (lane mir-body-a)
MonoReachable.prototype.add_work = function (this: MonoReachable, blocks: Iterable<BasicBlock>): void {
  return unported("rustc_middle::mir::traversal::MonoReachable::add_work");
};


// stub: compiler/rustc_middle/src/mir/traversal.rs:359 next (lane mir-body-a)
MonoReachable.prototype.next = function (this: MonoReachable): IteratorResult<[BasicBlock, BasicBlockData]> {
  return unported("rustc_middle::mir::traversal::<MonoReachable as Iterator>::next");
};
