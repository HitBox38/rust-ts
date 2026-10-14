// Port of compiler/rustc_data_structures/src/graph/iterate/mod.rs
//
// PORT: iterators that upstream keeps suspended across loop iterations (`frame.iter.by_ref()`) are JS iterators
// advanced with explicit `next()` calls: a `for..of` that is left early would close (`return()`) them.
import { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import { DenseBitSet } from "../../../rustc_index/bit_set.ts";
import { type Debug, debug_int, debug_set, type Fmt } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import type { StartNode, Successors } from "../mod.ts";

// rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:11 post_order_from
export function post_order_from<N extends number>(graph: Successors<N>, start_node: N): N[] {
  return post_order_from_to(graph, start_node, undefined);
}

// rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:18 post_order_from_to
export function post_order_from_to<N extends number>(graph: Successors<N>, start_node: N, end_node: N | undefined): N[] {
  const visited: boolean[] = new Array<boolean>(graph.num_nodes()).fill(false);
  const result: N[] = [];
  if (end_node !== undefined) {
    visited[end_node] = true;
  }
  post_order_walk(graph, start_node, result, visited);
  return result;
}

// rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:32 post_order_walk
function post_order_walk<N extends number>(graph: Successors<N>, node: N, result: N[], visited: boolean[]): void {
  // struct PostOrderFrame<Node, Iter> { node: Node, iter: Iter }
  interface PostOrderFrame {
    node: N;
    iter: Iterator<N>;
  }

  if (visited[node]) {
    return;
  }

  const stack: PostOrderFrame[] = [{ node, iter: graph.successors(node)[Symbol.iterator]() }];

  recurse: while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const node = frame.node;
    visited[node] = true;

    for (let next = frame.iter.next(); !next.done; next = frame.iter.next()) {
      const successor = next.value;
      if (!visited[successor]) {
        stack.push({ node: successor, iter: graph.successors(successor)[Symbol.iterator]() });
        continue recurse;
      }
    }

    stack.pop();
    result.push(node);
  }
}

// rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:65 reverse_post_order
export function reverse_post_order<N extends number>(graph: Successors<N>, start_node: N): N[] {
  const vec = post_order_from(graph, start_node);
  vec.reverse();
  return vec;
}

/// A "depth-first search" iterator for a directed graph.
// rustc-type: compiler/rustc_data_structures/src/graph/iterate/mod.rs:75 DepthFirstSearch
export class DepthFirstSearch<N extends number> implements IterableIterator<N> {
  constructor(
    public graph: Successors<N>,
    public stack: N[],
    // PORT: the field `visited` is `visited_` (the method `visited` has the same name).
    public visited_: DenseBitSet<N>,
  ) {}

  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:88 new
  static new<N extends number>(graph: Successors<N>): DepthFirstSearch<N> {
    return new DepthFirstSearch<N>(graph, [], DenseBitSet.new_empty<N>(graph.num_nodes()));
  }

  /// Version of `push_start_node` that is convenient for chained
  /// use.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:94 with_start_node
  with_start_node(start_node: N): this {
    this.push_start_node(start_node);
    return this;
  }

  /// Pushes another start node onto the stack. If the node
  /// has not already been visited, then you will be able to
  /// walk its successors (and so forth) after the current
  /// contents of the stack are drained. If multiple start nodes
  /// are added into the walk, then their mutual successors
  /// will all be walked. You can use this method once the
  /// iterator has been completely drained to add additional
  /// start nodes.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:107 push_start_node
  push_start_node(start_node: N): void {
    if (this.visited_.insert(start_node)) {
      this.stack.push(start_node);
    }
  }

  /// Searches all nodes reachable from the current start nodes.
  /// This is equivalent to just invoke `next` repeatedly until
  /// you get a `None` result.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:116 complete_search
  complete_search(): void {
    while (!this.next().done) {}
  }

  /// Returns true if node has been visited thus far.
  /// A node is considered "visited" once it is pushed
  /// onto the internal stack; it may not yet have been yielded
  /// from the iterator. This method is best used after
  /// the iterator is completely drained.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:125 visited
  visited(node: N): boolean {
    return this.visited_.contains(node);
  }

  /// Returns a reference to the set of nodes that have been visited, with
  /// the same caveats as [`Self::visited`].
  ///
  /// When incorporating the visited nodes into another bitset, using bulk
  /// operations like `union` or `intersect` can be more efficient than
  /// processing each node individually.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:135 visited_set
  visited_set(): DenseBitSet<N> {
    return this.visited_;
  }

  // impl<G> Iterator for DepthFirstSearch<G>
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:159 next
  next(): IteratorResult<N> {
    const { stack, visited_: visited, graph } = this;
    const n = stack.pop();
    if (n === undefined) return { done: true, value: undefined };
    for (const m of graph.successors(n)) {
      if (visited.insert(m)) stack.push(m);
    }
    return { done: false, value: n };
  }

  [Symbol.iterator](): this {
    return this;
  }
}

// impl<G> std::fmt::Debug for DepthFirstSearch<G>
// rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:144 fmt
export function debug_DepthFirstSearch<N extends number>(self: DepthFirstSearch<N>, fmt: Fmt, debug_N: Debug<N> = debug_int): string {
  const f: string[] = [];
  for (const n of self.visited_.iter()) {
    f.push(debug_N(n, fmt));
  }
  return debug_set(fmt, f);
}

/// The status of a node in the depth-first search.
///
/// See the documentation of `TriColorDepthFirstSearch` to see how a node's status is updated
/// during DFS.
export type NodeStatus =
  /// This node has been examined by the depth-first search but is not yet `Settled`.
  ///
  /// Also referred to as "gray" or "discovered" nodes in [CLR].
  ///
  /// [CLR]: https://en.wikipedia.org/wiki/Introduction_to_Algorithms
  | "Visited"
  /// This node and all nodes reachable from it have been examined by the depth-first search.
  ///
  /// Also referred to as "black" or "finished" nodes in [CLR].
  ///
  /// [CLR]: https://en.wikipedia.org/wiki/Introduction_to_Algorithms
  | "Settled";
export const NodeStatus = { Visited: "Visited", Settled: "Settled" } as const;

/** `#[derive(Debug)]` */
export const debug_NodeStatus: Debug<NodeStatus> = (v) => v;

// struct Event<N> { node: N, becomes: NodeStatus }
interface Event<N> {
  node: N;
  becomes: NodeStatus;
}

/// A depth-first search that also tracks when all successors of a node have been examined.
///
/// This is based on the DFS described in [Introduction to Algorithms (1st ed.)][CLR], hereby
/// referred to as **CLR**. However, we use the terminology in [`NodeStatus`] above instead of
/// "discovered"/"finished" or "white"/"grey"/"black". Each node begins the search with no status,
/// becomes `Visited` when it is first examined by the DFS and is `Settled` when all nodes
/// reachable from it have been examined. This allows us to differentiate between "tree", "back"
/// and "forward" edges (see [`TriColorVisitor::node_examined`]).
///
/// Unlike the pseudocode in [CLR], this implementation is iterative and does not use timestamps.
/// We accomplish this by storing `Event`s on the stack that result in a (possible) state change
/// for each node. A `Visited` event signifies that we should examine this node if it has not yet
/// been `Visited` or `Settled`. When a node is examined for the first time, we mark it as
/// `Visited` and push a `Settled` event for it on stack followed by `Visited` events for all of
/// its predecessors, scheduling them for examination. Multiple `Visited` events for a single node
/// may exist on the stack simultaneously if a node has multiple predecessors, but only one
/// `Settled` event will ever be created for each node. After all `Visited` events for a node's
/// successors have been popped off the stack (as well as any new events triggered by visiting
/// those successors), we will pop off that node's `Settled` event.
///
/// [CLR]: https://en.wikipedia.org/wiki/Introduction_to_Algorithms
// rustc-type: compiler/rustc_data_structures/src/graph/iterate/mod.rs:214 TriColorDepthFirstSearch
export class TriColorDepthFirstSearch<N extends number> {
  constructor(
    public graph: Successors<N>,
    public stack: Event<N>[],
    public visited: DenseBitSet<N>,
    public settled: DenseBitSet<N>,
  ) {}

  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:228 new
  static new<N extends number>(graph: Successors<N>): TriColorDepthFirstSearch<N> {
    return new TriColorDepthFirstSearch<N>(graph, [], DenseBitSet.new_empty<N>(graph.num_nodes()), DenseBitSet.new_empty<N>(graph.num_nodes()));
  }

  /// Performs a depth-first search, starting from the given `root`.
  ///
  /// This won't visit nodes that are not reachable from `root`.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:240 run_from
  run_from<B>(root: N, visitor: TriColorVisitor<N, B>): B | undefined {
    // use NodeStatus::{Settled, Visited};

    this.stack.push({ node: root, becomes: "Visited" });

    for (;;) {
      const event = this.stack.pop();
      if (event === undefined) return undefined;
      switch (event.becomes) {
        case "Settled": {
          const node = event.node;
          const not_previously_settled = this.settled.insert(node);
          assert(not_previously_settled, "A node should be settled exactly once");
          const cf = visitor.node_settled(node);
          if (cf.$ === "Break") {
            return cf._0;
          }
          break;
        }

        case "Visited": {
          const node = event.node;
          const not_previously_visited = this.visited.insert(node);
          const prior_status: NodeStatus | undefined = not_previously_visited ? undefined : this.settled.contains(node) ? "Settled" : "Visited";

          const cf = visitor.node_examined(node, prior_status);
          if (cf.$ === "Break") {
            return cf._0;
          }

          // If this node has already been examined, we are done.
          if (prior_status !== undefined) {
            continue;
          }

          // Otherwise, push a `Settled` event for this node onto the stack, then
          // schedule its successors for examination.
          this.stack.push({ node, becomes: "Settled" });
          for (const succ of this.graph.successors(node)) {
            if (!visitor.ignore_edge(node, succ)) {
              this.stack.push({ node: succ, becomes: "Visited" });
            }
          }
          break;
        }
      }
    }
  }

  // impl<G> TriColorDepthFirstSearch<'_, G> where G: ?Sized + DirectedGraph + Successors + StartNode
  /// Performs a depth-first search, starting from `G::start_node()`.
  ///
  /// This won't visit nodes that are not reachable from the start node.
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:298 run_from_start
  run_from_start<B>(visitor: TriColorVisitor<N, B>): B | undefined {
    const root = (this.graph as Successors<N> & StartNode<N>).start_node();
    return this.run_from(root, visitor);
  }
}

/// What to do when a node is examined or becomes `Settled` during DFS.
// rustc-trait: compiler/rustc_data_structures/src/graph/iterate/mod.rs:308 TriColorVisitor
// PORT: `type BreakVal` is the type parameter `B` (`()` is `null`, PORTING's stored-`()` encoding); the provided
// methods are in `TriColorVisitor_provided`, which an implementor spreads in for the ones it does not override.
export interface TriColorVisitor<N extends number, B> {
  /// Called when a node is examined by the depth-first search.
  ///
  /// By checking the value of `prior_status`, this visitor can determine whether the edge
  /// leading to this node was a tree edge (`None`), forward edge (`Some(Settled)`) or back edge
  /// (`Some(Visited)`). For a full explanation of each edge type, see the "Depth-first Search"
  /// chapter in [CLR] or [wikipedia].
  ///
  /// If you want to know *both* nodes linked by each edge, you'll need to modify
  /// `TriColorDepthFirstSearch` to store a `source` node for each `Visited` event.
  ///
  /// [wikipedia]: https://en.wikipedia.org/wiki/Depth-first_search#Output_of_a_depth-first_search
  /// [CLR]: https://en.wikipedia.org/wiki/Introduction_to_Algorithms
  node_examined(node: N, prior_status: NodeStatus | undefined): ControlFlow<B>;
  // (provided)

  /// Called after all nodes reachable from this one have been examined.
  node_settled(node: N): ControlFlow<B>;
  // (provided)

  /// Behave as if no edges exist from `source` to `target`.
  ignore_edge(source: N, target: N): boolean;
  // (provided)
}

/** PORT: the provided methods of `TriColorVisitor` (PORTING §8). */
export const TriColorVisitor_provided = {
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:327 node_examined
  node_examined<N extends number, B>(_node: N, _prior_status: NodeStatus | undefined): ControlFlow<B> {
    return ControlFlow.CONTINUE;
  },

  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:336 node_settled
  node_settled<N extends number, B>(_node: N): ControlFlow<B> {
    return ControlFlow.CONTINUE;
  },

  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:341 ignore_edge
  ignore_edge<N extends number>(_source: N, _target: N): boolean {
    return false;
  },
};

/// This `TriColorVisitor` looks for back edges in a graph, which indicate that a cycle exists.
// pub struct CycleDetector;
// impl<G> TriColorVisitor<G> for CycleDetector { type BreakVal = (); }
export const CycleDetector: TriColorVisitor<number, null> = {
  // rustc: compiler/rustc_data_structures/src/graph/iterate/mod.rs:355 node_examined
  node_examined(_node: number, prior_status: NodeStatus | undefined): ControlFlow<null> {
    switch (prior_status) {
      case "Visited":
        return ControlFlow.Break(null);
      default:
        return ControlFlow.CONTINUE;
    }
  },
  node_settled: TriColorVisitor_provided.node_settled,
  ignore_edge: TriColorVisitor_provided.ignore_edge,
};
