// Port of compiler/rustc_mir_transform/src/coverage/graph.rs (lane mt-coverage).
//
// PORT: `CoverageGraph` implements the graph traits (rustc_data_structures/graph/mod.ts) as methods, so its
// `pub(crate)` fields `successors` / `predecessors` (which share the trait methods' names) are `successors_` /
// `predecessors_`. `Index<BasicCoverageBlock>` / `IndexMut` are `index(bcb)` / `index_mut(bcb)`. `IndexVec`s are arrays
// (PORTING §5); `CoverageSuccessors::targets: &[BasicBlock]` is a readonly array, its `IntoIterator` impl the array
// itself. `Ordering` results are `-1 | 0 | 1`.
import { Dominators, dominators as dominators_ } from "../../rustc_data_structures/graph/dominators/mod.ts";
import { reverse_post_order } from "../../rustc_data_structures/graph/iterate/mod.ts";
import { type ControlFlowGraph, depth_first_search, type Successors } from "../../rustc_data_structures/graph/mod.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { BasicCoverageBlock, START_BCB } from "../../rustc_middle/mir/coverage.ts";
import { type BasicBlock, type BasicBlocks, type Body, debug_BasicBlock, START_BLOCK, type Terminator } from "../../rustc_middle/mir/mod.ts";
import { type Debug, debug_struct, debug_vec } from "../../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../../std/panic.ts";

// pub(crate) use rustc_middle::mir::coverage::{BasicCoverageBlock, START_BCB};
export { BasicCoverageBlock, START_BCB };
export { debug_BasicCoverageBlock } from "../../rustc_middle/mir/coverage.ts";

/// A coverage-specific simplification of the MIR control flow graph (CFG). The `CoverageGraph`s
/// nodes are `BasicCoverageBlock`s, which encompass one or more MIR `BasicBlock`s.
// rustc-type: compiler/rustc_mir_transform/src/coverage/graph.rs:17 CoverageGraph
export class CoverageGraph implements ControlFlowGraph<BasicCoverageBlock> {
  constructor(
    public bcbs: BasicCoverageBlockData[],
    public bb_to_bcb: (BasicCoverageBlock | undefined)[],
    public successors_: BasicCoverageBlock[][],
    public predecessors_: BasicCoverageBlock[][],

    public dominators_: Dominators<BasicCoverageBlock> | undefined,
    /// Allows nodes to be compared in some total order such that _if_
    /// `a` dominates `b`, then `a < b`. If neither node dominates the other,
    /// their relative order is consistent but arbitrary.
    public dominator_order_rank: number[],
    /// A loop header is a node that dominates one or more of its predecessors.
    public is_loop_header: DenseBitSet<BasicCoverageBlock>,
    /// For each node, the loop header node of its nearest enclosing loop.
    /// This forms a linked list that can be traversed to find all enclosing loops.
    public enclosing_loop_header: (BasicCoverageBlock | undefined)[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:36 from_mir
  static from_mir(mir_body: Body): CoverageGraph {
    const [bcbs, bb_to_bcb] = CoverageGraph.compute_basic_coverage_blocks(mir_body);

    // Pre-transform MIR `BasicBlock` successors and predecessors into the BasicCoverageBlock
    // equivalents. Note that since the BasicCoverageBlock graph has been fully simplified, the
    // each predecessor of a BCB leader_bb should be in a unique BCB. It is possible for a
    // `SwitchInt` to have multiple targets to the same destination `BasicBlock`, so
    // de-duplication is required. This is done without reordering the successors.

    const successors: BasicCoverageBlock[][] = [];
    for (let bcb = 0; bcb < bcbs.length; bcb++) {
      const seen_bcbs = new Set<BasicCoverageBlock>();
      const terminator = mir_body.index(bcbs[bcb]!.last_bb()).terminator_();
      const out: BasicCoverageBlock[] = [];
      for (const successor_bb of bcb_filtered_successors(terminator).into_iter()) {
        const successor_bcb = bb_to_bcb[successor_bb];
        if (successor_bcb === undefined) continue;
        // Remove duplicate successor BCBs, keeping only the first.
        if (seen_bcbs.has(successor_bcb)) continue;
        seen_bcbs.add(successor_bcb);
        out.push(successor_bcb);
      }
      successors.push(out);
    }

    const predecessors: BasicCoverageBlock[][] = bcbs.map(() => []);
    for (let bcb = 0; bcb < successors.length; bcb++) {
      for (const successor of successors[bcb]!) {
        predecessors[successor]!.push(bcb as BasicCoverageBlock);
      }
    }

    const num_nodes = bcbs.length;
    const this_ = new CoverageGraph(
      bcbs,
      bb_to_bcb,
      successors,
      predecessors,
      undefined,
      new Array<number>(num_nodes).fill(0),
      DenseBitSet.new_empty(num_nodes),
      Array.from({ length: num_nodes }, () => undefined),
    );
    assert_eq(num_nodes, this_.num_nodes(), String);

    // Set the dominators first, because later init steps rely on them.
    this_.dominators_ = dominators_(this_);

    // Iterate over all nodes, such that dominating nodes are visited before
    // the nodes they dominate. Either preorder or reverse postorder is fine.
    const dominator_order = reverse_post_order(this_, this_.start_node());
    // The coverage graph is created by traversal, so all nodes are reachable.
    assert_eq(dominator_order.length, this_.num_nodes(), String);
    for (let rank = 0; rank < dominator_order.length; rank++) {
      const bcb = dominator_order[rank]!;
      // The dominator rank of each node is its index in a dominator-order traversal.
      this_.dominator_order_rank[bcb] = rank;

      // A node is a loop header if it dominates any of its predecessors.
      if (this_.reloop_predecessors(bcb).length > 0) {
        this_.is_loop_header.insert(bcb);
      }

      // If the immediate dominator is a loop header, that's our enclosing loop.
      // Otherwise, inherit the immediate dominator's enclosing loop.
      // (Dominator order ensures that we already processed the dominator.)
      const dom = this_.dominators().immediate_dominator(bcb);
      if (dom !== undefined) {
        this_.enclosing_loop_header[bcb] = this_.is_loop_header.contains(dom) ? dom : this_.enclosing_loop_header[dom];
      }
    }

    // The coverage graph's entry-point node (bcb0) always starts with bb0,
    // which never has predecessors. Any other blocks merged into bcb0 can't
    // have multiple (coverage-relevant) predecessors, so bcb0 always has
    // zero in-edges.
    assert(this_.index(START_BCB).leader_bb() === START_BLOCK, "assertion failed: this[START_BCB].leader_bb() == mir::START_BLOCK");
    assert(this_.predecessors_[START_BCB]!.length === 0, "assertion failed: this.predecessors[START_BCB].is_empty()");

    return this_;
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:118 compute_basic_coverage_blocks
  static compute_basic_coverage_blocks(mir_body: Body): [BasicCoverageBlockData[], (BasicCoverageBlock | undefined)[]] {
    const num_basic_blocks = mir_body.basic_blocks.deref().length;
    const bcbs: BasicCoverageBlockData[] = [];
    const bb_to_bcb: (BasicCoverageBlock | undefined)[] = Array.from({ length: num_basic_blocks }, () => undefined);

    const flush_chain_into_new_bcb = (current_chain: BasicBlock[]): void => {
      // Take the accumulated list of blocks, leaving the vector empty
      // to be used by subsequent BCBs.
      const basic_blocks = current_chain.splice(0, current_chain.length);

      const bcb = bcbs.length as BasicCoverageBlock;
      for (const bb of basic_blocks) {
        bb_to_bcb[bb] = bcb;
      }

      const last = basic_blocks[basic_blocks.length - 1];
      const is_out_summable = last !== undefined && bcb_filtered_successors(mir_body.index(last).terminator_()).is_out_summable();
      const bcb_data = new BasicCoverageBlockData(basic_blocks, is_out_summable);
      // debug!("adding {bcb:?}: {bcb_data:?}");
      bcbs.push(bcb_data);
    };

    // Traverse the MIR control-flow graph, accumulating chains of blocks
    // that can be combined into a single node in the coverage graph.
    // A depth-first search ensures that if two nodes can be chained
    // together, they will be adjacent in the traversal order.

    // Accumulates a chain of blocks that will be combined into one BCB.
    const current_chain: BasicBlock[] = [];

    const subgraph = CoverageRelevantSubgraph.new(mir_body.basic_blocks);
    for (const bb of depth_first_search(subgraph, START_BLOCK)) {
      if (mir_body.index(bb).terminator_().kind.$ === "Unreachable") continue;
      const prev = current_chain[current_chain.length - 1];
      if (prev !== undefined) {
        // Adding a block to a non-empty chain is allowed if the
        // previous block permits chaining, and the current block has
        // `prev` as its sole predecessor.
        const preds = mir_body.basic_blocks.predecessors()[bb]!;
        const can_chain = subgraph.coverage_successors(prev).is_out_chainable() && preds.length === 1 && preds[0] === prev;
        if (!can_chain) {
          // The current block can't be added to the existing chain, so
          // flush that chain into a new BCB, and start a new chain.
          flush_chain_into_new_bcb(current_chain);
        }
      }

      current_chain.push(bb);
    }

    if (current_chain.length !== 0) {
      // debug!("flushing accumulated blocks into one last BCB");
      flush_chain_into_new_bcb(current_chain);
    }

    return [bcbs, bb_to_bcb];
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:183 iter_enumerated
  iter_enumerated(): [BasicCoverageBlock, BasicCoverageBlockData][] {
    return this.bcbs.map((data, i) => [i as BasicCoverageBlock, data]);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:190 bcb_from_bb
  bcb_from_bb(bb: BasicBlock): BasicCoverageBlock | undefined {
    if (bb < this.bb_to_bcb.length) {
      return this.bb_to_bcb[bb];
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:195 dominators
  dominators(): Dominators<BasicCoverageBlock> {
    return unwrap(this.dominators_);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:200 dominates
  dominates(dom: BasicCoverageBlock, node: BasicCoverageBlock): boolean {
    return this.dominators().dominates(dom, node);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:205 cmp_in_dominator_order
  cmp_in_dominator_order(a: BasicCoverageBlock, b: BasicCoverageBlock): -1 | 0 | 1 {
    const x = this.dominator_order_rank[a]!;
    const y = this.dominator_order_rank[b]!;
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /// For the given node, yields the subset of its predecessor nodes that
  /// it dominates. If that subset is non-empty, the node is a "loop header",
  /// and each of those predecessors represents an in-edge that jumps back to
  /// the top of its loop.
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:217 reloop_predecessors
  reloop_predecessors(to_bcb: BasicCoverageBlock): BasicCoverageBlock[] {
    return this.predecessors_[to_bcb]!.filter((pred) => this.dominates(to_bcb, pred));
  }

  // impl Index<BasicCoverageBlock> for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:229 index
  index(index: BasicCoverageBlock): BasicCoverageBlockData {
    return this.bcbs[index]!;
  }

  // impl IndexMut<BasicCoverageBlock> for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:236 index_mut
  index_mut(index: BasicCoverageBlock): BasicCoverageBlockData {
    return this.bcbs[index]!;
  }

  // impl graph::DirectedGraph for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:245 num_nodes
  num_nodes(): number {
    return this.bcbs.length;
  }

  // impl graph::StartNode for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:252 start_node
  start_node(): BasicCoverageBlock {
    return unwrap(this.bcb_from_bb(START_BLOCK), "mir::START_BLOCK should be in a BasicCoverageBlock");
  }

  // impl graph::Successors for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:260 successors
  successors(node: BasicCoverageBlock): Iterable<BasicCoverageBlock> {
    return this.successors_[node]!;
  }

  // impl graph::Predecessors for CoverageGraph
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:267 predecessors
  predecessors(node: BasicCoverageBlock): Iterable<BasicCoverageBlock> {
    return this.predecessors_[node]!;
  }
}

/// `BasicCoverageBlockData` holds the data indexed by a `BasicCoverageBlock`.
///
/// A `BasicCoverageBlock` (BCB) represents the maximal-length sequence of MIR `BasicBlock`s without
/// conditional branches, and form a new, simplified, coverage-specific Control Flow Graph, without
/// altering the original MIR CFG.
///
/// Note that running the MIR `SimplifyCfg` transform is not sufficient (and therefore not
/// necessary). The BCB-based CFG is a more aggressive simplification. For example:
///
///   * The BCB CFG ignores (trims) branches not relevant to coverage, such as unwind-related code,
///     that is injected by the Rust compiler but has no physical source code to count. This also
///     means a BasicBlock with a `Call` terminator can be merged into its primary successor target
///     block, in the same BCB. (But, note: Issue #78544: "MIR InstrumentCoverage: Improve coverage
///     of `#[should_panic]` tests and `catch_unwind()` handlers")
///   * Some BasicBlock terminators support Rust-specific concerns--like borrow-checking--that are
///     not relevant to coverage analysis. `FalseUnwind`, for example, can be treated the same as
///     a `Goto`, and merged with its successor into the same BCB.
///
/// Each BCB with at least one computed coverage span will have no more than one `Counter`.
/// In some cases, a BCB's execution count can be computed by `Expression`. Additional
/// disjoint coverage spans in a BCB can also be counted by `Expression` (by adding `ZERO`
/// to the BCB's primary counter or expression).
///
/// The BCB CFG is critical to simplifying the coverage analysis by ensuring graph path-based
/// queries (`dominates()`, `predecessors`, `successors`, etc.) have branch (control flow)
/// significance.
// rustc-type: compiler/rustc_mir_transform/src/coverage/graph.rs:299 BasicCoverageBlockData
export class BasicCoverageBlockData {
  constructor(
    public basic_blocks: BasicBlock[],

    /// If true, this node's execution count can be assumed to be the sum of the
    /// execution counts of all of its **out-edges** (assuming no panics).
    ///
    /// Notably, this is false for a node ending with [`TerminatorKind::Yield`],
    /// because the yielding coroutine might not be resumed.
    public is_out_summable: boolean,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:312 leader_bb
  leader_bb(): BasicBlock {
    return this.basic_blocks[0]!;
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:317 last_bb
  last_bb(): BasicBlock {
    return unwrap(this.basic_blocks[this.basic_blocks.length - 1]);
  }
}
// #[derive(Debug)]
export const debug_BasicCoverageBlockData: Debug<BasicCoverageBlockData> = (v, f) =>
  debug_struct(f, "BasicCoverageBlockData", [
    ["basic_blocks", debug_vec(v.basic_blocks, f, debug_BasicBlock)],
    ["is_out_summable", String(v.is_out_summable)],
  ]);

/// Holds the coverage-relevant successors of a basic block's terminator, and
/// indicates whether that block can potentially be combined into the same BCB
/// as its sole successor.
// rustc-type: compiler/rustc_mir_transform/src/coverage/graph.rs:326 CoverageSuccessors
class CoverageSuccessors {
  constructor(
    /// Coverage-relevant successors of the corresponding terminator.
    /// There might be 0, 1, or multiple targets.
    public targets: readonly BasicBlock[],
    /// `Yield` terminators are not chainable, because their sole out-edge is
    /// only followed if/when the generator is resumed after the yield.
    public is_yield: boolean,
  ) {}

  /// If `false`, this terminator cannot be chained into another block when
  /// building the coverage graph.
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:338 is_out_chainable
  is_out_chainable(): boolean {
    // If a terminator is out-summable and has exactly one out-edge, then
    // it is eligible to be chained into its successor block.
    return this.is_out_summable() && this.targets.length === 1;
  }

  /// Returns true if the terminator itself is assumed to have the same
  /// execution count as the sum of its out-edges (assuming no panics).
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:346 is_out_summable
  is_out_summable(): boolean {
    return !this.is_yield && this.targets.length !== 0;
  }

  // impl IntoIterator for CoverageSuccessors<'_>
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:355 into_iter
  into_iter(): readonly BasicBlock[] {
    return this.targets;
  }
}

// Returns the subset of a block's successors that are relevant to the coverage
// graph, i.e. those that do not represent unwinds or false edges.
// FIXME(#78544): MIR InstrumentCoverage: Improve coverage of `#[should_panic]` tests and
// `catch_unwind()` handlers.
// rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:364 bcb_filtered_successors
function bcb_filtered_successors(terminator: Terminator): CoverageSuccessors {
  let is_yield = false;
  let targets: readonly BasicBlock[];
  const kind = terminator.kind;
  switch (kind.$) {
    // A switch terminator can have many coverage-relevant successors.
    case "SwitchInt":
      targets = kind.targets.all_targets();
      break;

    // A yield terminator has exactly 1 successor, but should not be chained,
    // because its resume edge has a different execution count.
    case "Yield":
      is_yield = true;
      targets = [kind.resume];
      break;

    // These terminators have exactly one coverage-relevant successor,
    // and can be chained into it.
    case "Assert":
    case "Drop":
    case "Goto":
      targets = [kind.target];
      break;
    case "FalseEdge":
    case "FalseUnwind":
      targets = [kind.real_target];
      break;

    // A call terminator can normally be chained, except when it has no
    // successor because it is known to diverge.
    case "Call":
      targets = kind.target === undefined ? [] : [kind.target];
      break;

    // An inline asm terminator can normally be chained, except when it
    // diverges or uses asm goto.
    case "InlineAsm":
      targets = kind.targets;
      break;

    // These terminators have no coverage-relevant successors.
    case "CoroutineDrop":
    case "Return":
    case "TailCall":
    case "Unreachable":
    case "UnwindResume":
    case "UnwindTerminate":
      targets = [];
      break;
  }

  return new CoverageSuccessors(targets, is_yield);
}

/// Wrapper around a [`mir::BasicBlocks`] graph that restricts each node's
/// successors to only the ones considered "relevant" when building a coverage
/// graph.
// rustc-type: compiler/rustc_mir_transform/src/coverage/graph.rs:410 CoverageRelevantSubgraph
class CoverageRelevantSubgraph implements Successors<BasicBlock> {
  constructor(public basic_blocks: BasicBlocks) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:414 new
  static new(basic_blocks: BasicBlocks): CoverageRelevantSubgraph {
    return new CoverageRelevantSubgraph(basic_blocks);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:418 coverage_successors
  coverage_successors(bb: BasicBlock): CoverageSuccessors {
    return bcb_filtered_successors(this.basic_blocks.deref()[bb]!.terminator_());
  }

  // impl<'a, 'tcx> graph::DirectedGraph for CoverageRelevantSubgraph<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:425 num_nodes
  num_nodes(): number {
    return this.basic_blocks.num_nodes();
  }

  // impl<'a, 'tcx> graph::Successors for CoverageRelevantSubgraph<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/coverage/graph.rs:430 successors
  successors(bb: BasicBlock): Iterable<BasicBlock> {
    return this.coverage_successors(bb).into_iter();
  }
}
