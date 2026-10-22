// Port of compiler/rustc_middle/src/mir/basic_blocks.rs (lane mir-contract, plan-m4 D3). `BasicBlocks` and `Cache` are
// generated into basic_blocks.gen.ts (set rustc_middle_mir); the fns are ported here.
//
// PORT: `cache: Arc<Cache>` is the `Cache` object itself, shared by `clone_BasicBlocks` (as the `Arc` is); its
// `OnceLock` fields are `T | undefined`, set once and never mutated in place. `invalidate_cfg_cache` always gives the
// blocks a fresh `Cache` (upstream clears the cache in place when the `Arc` is unique and replaces it otherwise: either
// way the other clones keep their cache and this one starts empty).
// PORT: `impl Deref<Target = IndexSlice<BasicBlock, BasicBlockData>>` is `deref()` (the array): `body.basic_blocks[bb]`
// is `body.basic_blocks.deref()[bb]`, `.len()` is `.deref().length`.
// PORT: the graph traits (`DirectedGraph`, `StartNode`, `Successors`, `Predecessors`; rustc_data_structures
// graph/mod.ts) are implemented on the class, so `&body.basic_blocks` is passed to graph algorithms as is; the trait's
// `predecessors(node)` and the inherent `predecessors()` share the prototype slot (overloads, dispatched on the
// argument).
import "./mod.ts";
import { dominators, type Dominators } from "../../rustc_data_structures/graph/dominators/mod.ts";
import type { ControlFlowGraph } from "../../rustc_data_structures/graph/mod.ts";
import type { StableHashCtxt, StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import type { TyDecoder } from "../ty/codec.ts";
import { BasicBlocks, type Cache, type Predecessors } from "./basic_blocks.gen.ts";
import { type BasicBlock, type BasicBlockData, START_BLOCK } from "./mod.gen.ts";
import { Postorder } from "./traversal.ts";
export * from "./basic_blocks.gen.ts";

/** `Cache::default()` (derive(Default): every `OnceLock` empty). */
function default_Cache(): Cache {
  return { predecessors: undefined, reverse_postorder: undefined, dominators: undefined };
}

declare module "./basic_blocks.gen.ts" {
  namespace BasicBlocks {
    // basic_blocks.rs:33
    function new_(basic_blocks: BasicBlockData[]): BasicBlocks;
    export { new_ as new };
  }
  interface BasicBlocks {
    // basic_blocks.rs:38
    dominators(): Dominators<BasicBlock>;
    // basic_blocks.rs:44
    predecessors(): Predecessors;
    // basic_blocks.rs:64
    reverse_postorder(): readonly BasicBlock[];
    // basic_blocks.rs:74
    as_mut(): BasicBlockData[];
    // basic_blocks.rs:91
    as_mut_preserves_cfg(): BasicBlockData[];
    // basic_blocks.rs:100
    invalidate_cfg_cache(): void;
    // basic_blocks.rs:116 impl Deref
    deref(): readonly BasicBlockData[];
    // basic_blocks.rs:125 impl graph::DirectedGraph (`type Node = BasicBlock`)
    readonly __node?: BasicBlock;
    num_nodes(): number;
    // basic_blocks.rs:132 impl graph::StartNode
    start_node(): BasicBlock;
    // basic_blocks.rs:139 impl graph::Successors
    successors(node: BasicBlock): Iterable<BasicBlock>;
    // basic_blocks.rs:146 impl graph::Predecessors
    predecessors(node: BasicBlock): Iterable<BasicBlock>;
  }
}

// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:33 new
(BasicBlocks as unknown as { new: typeof BasicBlocks.new }).new = function (basic_blocks: BasicBlockData[]): BasicBlocks {
  return new BasicBlocks(basic_blocks, default_Cache());
};

// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:38 dominators
BasicBlocks.prototype.dominators = function (this: BasicBlocks): Dominators<BasicBlock> {
  // PORT: the class implements the graph traits (header); the cast is for the overloaded `predecessors` slot.
  return (this.cache.dominators ??= dominators(this as unknown as ControlFlowGraph<BasicBlock>));
};

/// Returns predecessors for each basic block.
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:44 predecessors
function predecessors(self: BasicBlocks): Predecessors {
  return (self.cache.predecessors ??= (() => {
    const preds: BasicBlock[][] = self.basic_blocks.map(() => []);
    for (let bb = 0; bb < self.basic_blocks.length; bb++) {
      const data = self.basic_blocks[bb]!;
      if (data.terminator !== undefined) {
        const term = data.terminator;
        for (const succ of term.successors()) {
          preds[succ]!.push(bb as BasicBlock);
        }
      }
    }
    return preds;
  })());
}

/// Returns basic blocks in a reverse postorder.
///
/// See [`traversal::reverse_postorder`]'s docs to learn what is postorder traversal.
///
/// [`traversal::reverse_postorder`]: crate::mir::traversal::reverse_postorder
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:64 reverse_postorder
BasicBlocks.prototype.reverse_postorder = function (this: BasicBlocks): readonly BasicBlock[] {
  return (this.cache.reverse_postorder ??= (() => {
    const rpo: BasicBlock[] = [...Postorder.new(this.basic_blocks, START_BLOCK, undefined)];
    rpo.reverse();
    return rpo;
  })());
};

/// Returns mutable reference to basic blocks. Invalidates CFG cache.
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:74 as_mut
BasicBlocks.prototype.as_mut = function (this: BasicBlocks): BasicBlockData[] {
  this.invalidate_cfg_cache();
  return this.basic_blocks;
};

/// Get mutable access to basic blocks without invalidating the CFG cache.
///
/// By calling this method instead of e.g. [`BasicBlocks::as_mut`] you promise not to change
/// the CFG. This means that
///
///  1) The number of basic blocks remains unchanged
///  2) The set of successors of each terminator remains unchanged.
///  3) For each `TerminatorKind::SwitchInt`, the `targets` remains the same and the terminator
///     kind is not changed.
///
/// If any of these conditions cannot be upheld, you should call [`BasicBlocks::invalidate_cfg_cache`].
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:91 as_mut_preserves_cfg
BasicBlocks.prototype.as_mut_preserves_cfg = function (this: BasicBlocks): BasicBlockData[] {
  return this.basic_blocks;
};

/// Invalidates cached information about the CFG.
///
/// You will only ever need this if you have also called [`BasicBlocks::as_mut_preserves_cfg`].
/// All other methods that allow you to mutate the basic blocks also call this method
/// themselves, thereby avoiding any risk of accidentally cache invalidation.
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:100 invalidate_cfg_cache
BasicBlocks.prototype.invalidate_cfg_cache = function (this: BasicBlocks): void {
  // PORT: `Arc::get_mut` (a unique cache is cleared in place) is not observable here: a fresh cache in both cases (see
  // the header).
  this.cache = default_Cache();
};

// impl Deref for BasicBlocks
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:116 deref
BasicBlocks.prototype.deref = function (this: BasicBlocks): readonly BasicBlockData[] {
  return this.basic_blocks;
};

// impl graph::DirectedGraph for BasicBlocks
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:125 num_nodes
BasicBlocks.prototype.num_nodes = function (this: BasicBlocks): number {
  return this.basic_blocks.length;
};

// impl graph::StartNode for BasicBlocks
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:132 start_node
BasicBlocks.prototype.start_node = function (this: BasicBlocks): BasicBlock {
  return START_BLOCK;
};

// impl graph::Successors for BasicBlocks
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:139 successors
BasicBlocks.prototype.successors = function (this: BasicBlocks, node: BasicBlock): Iterable<BasicBlock> {
  return this.basic_blocks[node]!.terminator_().successors();
};

// impl graph::Predecessors for BasicBlocks
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:146 predecessors
function graph_predecessors(self: BasicBlocks, node: BasicBlock): Iterable<BasicBlock> {
  return predecessors(self)[node]!;
}

// PORT: the inherent `predecessors()` (:44) and `graph::Predecessors::predecessors(node)` (:146) on one slot.
BasicBlocks.prototype.predecessors = function (this: BasicBlocks, node?: BasicBlock): Predecessors & Iterable<BasicBlock> {
  return (node === undefined ? predecessors(this) : graph_predecessors(this, node)) as Predecessors & Iterable<BasicBlock>;
} as BasicBlocks["predecessors"];

// Done here instead of in `structural_impls.rs` because `Cache` is private, as is `basic_blocks`.
// TrivialTypeTraversalImpls! { Cache } (tools/codegen/type_fold.json `trivial`)

// rustc-skip: compiler/rustc_middle/src/mir/basic_blocks.rs:156 encode Encodable (metadata encoding, M5)

// impl<D: Decoder> Decodable<D> for Cache
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:161 decode
export function decode_Cache(_d: TyDecoder): Cache {
  return default_Cache();
}

// impl StableHash for Cache
// rustc: compiler/rustc_middle/src/mir/basic_blocks.rs:168 stable_hash
export function stable_hash_Cache(_self: Cache, _hcx: StableHashCtxt, _hasher: StableHasher): void {}
