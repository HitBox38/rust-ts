// Port of compiler/rustc_data_structures/src/graph/dominators/mod.rs
//
// PORT: `Node: Idx` is a number-like index (`Idx::new(i)` / `node.index()` are the identity, as in graph/mod.ts);
// `IndexVec<I, T>` / `IndexSlice<I, T>` are `T[]` (PORTING §5). `Option<Node>` is `Node | undefined`.

//! Finding the dominators in a control-flow graph.
//!
//! Algorithm based on Loukas Georgiadis,
//! "Linear-Time Algorithms for Dominators and Related Problems",
//! <https://www.cs.princeton.edu/techreports/2005/737.pdf>
//!
//! Additionally useful is the original Lengauer-Tarjan paper on this subject,
//! "A Fast Algorithm for Finding Dominators in a Flowgraph"
//! Thomas Lengauer and Robert Endre Tarjan.
//! <https://www.cs.princeton.edu/courses/archive/spr03/cs423/download/dominators.pdf>

import { type Debug, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import { newtype_index } from "../../../rustc_index/newtype_index.ts";
import type { ControlFlowGraph } from "../mod.ts";

// rustc-type: compiler/rustc_data_structures/src/graph/dominators/mod.rs:19 PreOrderFrame
interface PreOrderFrame<Iter> {
  pre_order_idx: PreorderIndex;
  iter: Iter;
}

// rustc_index::newtype_index! {
//     #[orderable]
//     struct PreorderIndex {}
// }
type PreorderIndex = number & { readonly __brand: "PreorderIndex" };
const PreorderIndex = newtype_index<PreorderIndex>((n) => String(n));


// rustc-type: compiler/rustc_data_structures/src/graph/dominators/mod.rs:35 Kind
type Kind<Node extends number> =
  /// A representation optimized for a small path graphs.
  | { readonly $: "Path" }
  | { readonly $: "General"; _0: Inner<Node> };

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:41 dominators
export function dominators<N extends number>(g: ControlFlowGraph<N>): Dominators<N> {
  // We often encounter MIR bodies with 1 or 2 basic blocks. Special case the dominators
  // computation and representation for those cases.
  if (is_small_path_graph(g)) {
    return new Dominators<N>({ $: "Path" });
  } else {
    return new Dominators<N>({ $: "General", _0: dominators_impl(g) });
  }
}

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:51 is_small_path_graph
function is_small_path_graph<N extends number>(g: ControlFlowGraph<N>): boolean {
  if (g.start_node() !== 0) {
    return false;
  }
  if (g.num_nodes() === 1) {
    return true;
  }
  if (g.num_nodes() === 2) {
    // `g.successors(g.start_node()).any(|n| n.index() == 1)`
    for (const n of g.successors(g.start_node())) {
      if (n === 1) return true;
    }
    return false;
  }
  return false;
}

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:64 dominators_impl
function dominators_impl<N extends number>(graph: ControlFlowGraph<N>): Inner<N> {
  // We allocate capacity for the full set of nodes, because most of the time
  // most of the nodes *are* reachable.
  const parent: PreorderIndex[] = [];

  const stack: PreOrderFrame<Iterator<N>>[] = [
    {
      pre_order_idx: PreorderIndex.ZERO,
      iter: graph.successors(graph.start_node())[Symbol.iterator](),
    },
  ];
  const pre_order_to_real: N[] = [];
  const real_to_pre_order: (PreorderIndex | undefined)[] = new Array<PreorderIndex | undefined>(graph.num_nodes()).fill(undefined);
  pre_order_to_real.push(graph.start_node());
  parent.push(PreorderIndex.ZERO); // the parent of the root node is the root for now.
  real_to_pre_order[graph.start_node()] = PreorderIndex.ZERO;

  // Traverse the graph, collecting a number of things:
  //
  // * Preorder mapping (to it, and back to the actual ordering)
  // * Parents for each vertex in the preorder tree
  //
  // These are all done here rather than through one of the 'standard'
  // graph traversals to help make this fast.
  recurse: while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    // PORT: `for successor in frame.iter.by_ref()` pulls with `next()` by hand, so that leaving the loop
    // (`continue 'recurse`) does not close the iterator (a JS `for..of` would call `return()`).
    for (;;) {
      const r = frame.iter.next();
      if (r.done) break;
      const successor = r.value;
      if (real_to_pre_order[successor] === undefined) {
        // `IndexVec::push` returns the index of the pushed element.
        const pre_order_idx = PreorderIndex.new(pre_order_to_real.length);
        pre_order_to_real.push(successor);
        real_to_pre_order[successor] = pre_order_idx;
        parent.push(frame.pre_order_idx);
        stack.push({ pre_order_idx, iter: graph.successors(successor)[Symbol.iterator]() });

        continue recurse;
      }
    }

    stack.pop();
  }

  const reachable_vertices = pre_order_to_real.length;

  const idom: PreorderIndex[] = new Array<PreorderIndex>(reachable_vertices).fill(PreorderIndex.ZERO);
  // `IndexVec::from_fn_n(std::convert::identity, reachable_vertices)`
  const semi: PreorderIndex[] = [];
  for (let i = 0; i < reachable_vertices; i++) semi.push(PreorderIndex.new(i));
  const label = semi.slice();
  const bucket: PreorderIndex[][] = [];
  for (let i = 0; i < reachable_vertices; i++) bucket.push([]);
  let lastlinked: PreorderIndex | undefined = undefined;

  // We loop over vertices in reverse preorder. This implements the pseudocode
  // of the simple Lengauer-Tarjan algorithm. A few key facts are noted here
  // which are helpful for understanding the code (full proofs and such are
  // found in various papers, including one cited at the top of this file).
  //
  // For each vertex w (which is not the root),
  //  * semi[w] is a proper ancestor of the vertex w (i.e., semi[w] != w)
  //  * idom[w] is an ancestor of semi[w] (i.e., idom[w] may equal semi[w])
  //
  // An immediate dominator of w (idom[w]) is a vertex v where v dominates w
  // and every other dominator of w dominates v. (Every vertex except the root has
  // a unique immediate dominator.)
  //
  // A semidominator for a given vertex w (semi[w]) is the vertex v with minimum
  // preorder number such that there exists a path from v to w in which all elements (other than w) have
  // preorder numbers greater than w (i.e., this path is not the tree path to
  // w).
  const w_start = PreorderIndex.new(1);
  const w_end = PreorderIndex.new(reachable_vertices);
  for (let w = (w_end - 1) as PreorderIndex; w >= w_start; w = (w - 1) as PreorderIndex) {
    // Optimization: process buckets just once, at the start of the
    // iteration. Do not explicitly empty the bucket (even though it will
    // not be used again), to save some instructions.
    //
    // The bucket here contains the vertices whose semidominator is the
    // vertex w, which we are guaranteed to have found: all vertices who can
    // be semidominated by w must have a preorder number exceeding w, so
    // they have been placed in the bucket.
    //
    // We compute a partial set of immediate dominators here.
    for (const v of bucket[w]!) {
      // This uses the result of Lemma 5 from section 2 from the original
      // 1979 paper, to compute either the immediate or relative dominator
      // for a given vertex v.
      //
      // eval returns a vertex y, for which semi[y] is minimum among
      // vertices semi[v] +> y *> v. Note that semi[v] = w as we're in the
      // w bucket.
      //
      // Given such a vertex y, semi[y] <= semi[v] and idom[y] = idom[v].
      // If semi[y] = semi[v], though, idom[v] = semi[v].
      //
      // Using this, we can either set idom[v] to be:
      //  * semi[v] (i.e. w), if semi[y] is w
      //  * idom[y], otherwise
      //
      // We don't directly set to idom[y] though as it's not necessarily
      // known yet. The second preorder traversal will cleanup by updating
      // the idom for any that were missed in this pass.
      const y = eval_(parent, lastlinked, semi, label, v);
      idom[v] = semi[y]! < w ? y : w;
    }

    // This loop computes the semi[w] for w.
    semi[w] = w;
    for (const v0 of graph.predecessors(pre_order_to_real[w]!)) {
      // TL;DR: Reachable vertices may have unreachable predecessors, so ignore any of them.
      //
      // Ignore blocks which are not connected to the entry block.
      //
      // The algorithm that was used to traverse the graph and build the
      // `pre_order_to_real` and `real_to_pre_order` vectors does so by
      // starting from the entry block and following the successors.
      // Therefore, any blocks not reachable from the entry block will be
      // set to `None` in the `pre_order_to_real` vector.
      //
      // For example, in this graph, A and B should be skipped:
      //
      //           ┌─────┐
      //           │     │
      //           └──┬──┘
      //              │
      //           ┌──▼──┐              ┌─────┐
      //           │     │              │  A  │
      //           └──┬──┘              └──┬──┘
      //              │                    │
      //      ┌───────┴───────┐            │
      //      │               │            │
      //   ┌──▼──┐         ┌──▼──┐      ┌──▼──┐
      //   │     │         │     │      │  B  │
      //   └──┬──┘         └──┬──┘      └──┬──┘
      //      │               └──────┬─────┘
      //   ┌──▼──┐                   │
      //   │     │                   │
      //   └──┬──┘                ┌──▼──┐
      //      │                   │     │
      //      │                   └─────┘
      //   ┌──▼──┐
      //   │     │
      //   └──┬──┘
      //      │
      //   ┌──▼──┐
      //   │     │
      //   └─────┘
      //
      // ...this may be the case if a MirPass modifies the CFG to remove
      // or rearrange certain blocks/edges.
      const v = real_to_pre_order[v0];
      if (v === undefined) continue;

      // eval returns a vertex x from which semi[x] is minimum among
      // vertices semi[v] +> x *> v.
      //
      // From Lemma 4 from section 2, we know that the semidominator of a
      // vertex w is the minimum (by preorder number) vertex of the
      // following:
      //
      //  * direct predecessors of w with preorder number less than w
      //  * semidominators of u such that u > w and there exists (v, w)
      //    such that u *> v
      //
      // This loop therefore identifies such a minima. Note that any
      // semidominator path to w must have all but the first vertex go
      // through vertices numbered greater than w, so the reverse preorder
      // traversal we are using guarantees that all of the information we
      // might need is available at this point.
      //
      // The eval call will give us semi[x], which is either:
      //
      //  * v itself, if v has not yet been processed
      //  * A possible 'best' semidominator for w.
      const x = eval_(parent, lastlinked, semi, label, v);
      semi[w] = Math.min(semi[w]!, semi[x]!) as PreorderIndex;
    }
    // semi[w] is now semidominator(w) and won't change any more.

    // Optimization: Do not insert into buckets if parent[w] = semi[w], as
    // we then immediately know the idom.
    //
    // If we don't yet know the idom directly, then push this vertex into
    // our semidominator's bucket, where it will get processed at a later
    // stage to compute its immediate dominator.
    const z = parent[w]!;
    if (z !== semi[w]) {
      bucket[semi[w]!]!.push(w);
    } else {
      idom[w] = z;
    }

    // Optimization: We share the parent array between processed and not
    // processed elements; lastlinked represents the divider.
    lastlinked = w;
  }

  // Finalize the idoms for any that were not fully settable during initial
  // traversal.
  //
  // If idom[w] != semi[w] then we know that we've stored vertex y from above
  // into idom[w]. It is known to be our 'relative dominator', which means
  // that it's one of w's ancestors and has the same immediate dominator as w,
  // so use that idom.
  for (let w = w_start; w < w_end; w = (w + 1) as PreorderIndex) {
    if (idom[w] !== semi[w]) {
      idom[w] = idom[idom[w]!]!;
    }
  }

  const immediate_dominators: (N | undefined)[] = new Array<N | undefined>(graph.num_nodes()).fill(undefined);
  for (let idx = 0; idx < pre_order_to_real.length; idx++) {
    const node = pre_order_to_real[idx]!;
    immediate_dominators[node] = pre_order_to_real[idom[idx]!]!;
  }

  const start_node = graph.start_node();
  immediate_dominators[start_node] = undefined;

  const time = compute_access_time(start_node, immediate_dominators);

  return { immediate_dominators, time };
}

/// Evaluate the link-eval virtual forest, providing the currently minimum semi
/// value for the passed `node` (which may be itself).
///
/// This maintains that for every vertex v, `label[v]` is such that:
///
/// ```text
/// semi[eval(v)] = min { semi[label[u]] | root_in_forest(v) +> u *> v }
/// ```
///
/// where `+>` is a proper ancestor and `*>` is just an ancestor.
// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:290 eval
function eval_(
  ancestor: PreorderIndex[],
  lastlinked: PreorderIndex | undefined,
  semi: readonly PreorderIndex[],
  label: PreorderIndex[],
  node: PreorderIndex,
): PreorderIndex {
  // PORT: named `eval_` (`eval` is not a valid binding name in strict mode).
  if (is_processed(node, lastlinked)) {
    compress(ancestor, lastlinked, semi, label, node);
    return label[node]!;
  } else {
    return node;
  }
}

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:306 is_processed
function is_processed(v: PreorderIndex, lastlinked: PreorderIndex | undefined): boolean {
  if (lastlinked !== undefined) {
    return v >= lastlinked;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:311 compress
function compress(
  ancestor: PreorderIndex[],
  lastlinked: PreorderIndex | undefined,
  semi: readonly PreorderIndex[],
  label: PreorderIndex[],
  v: PreorderIndex,
): void {
  assert(is_processed(v, lastlinked), "assertion failed: is_processed(v, lastlinked)");
  // Compute the processed list of ancestors
  //
  // We use a heap stack here to avoid recursing too deeply, exhausting the
  // stack space.
  const stack: PreorderIndex[] = [v];
  let u = ancestor[v]!;
  while (is_processed(u, lastlinked)) {
    stack.push(u);
    u = ancestor[u]!;
  }

  // Then in reverse order, popping the stack
  // `for &[v, u] in stack.array_windows().rev()`
  for (let i = stack.length - 2; i >= 0; i--) {
    const v = stack[i]!;
    const u = stack[i + 1]!;
    if (semi[label[u]!]! < semi[label[v]!]!) {
      label[v] = label[u]!;
    }
    ancestor[v] = ancestor[u]!;
  }
}

/// Tracks the list of dominators for each node.
// rustc-type: compiler/rustc_data_structures/src/graph/dominators/mod.rs:341 Inner
interface Inner<N extends number> {
  // Even though we track only the immediate dominator of each node, it's
  // possible to get its full list of dominators by looking up the dominator
  // of each dominator.
  immediate_dominators: (N | undefined)[];
  time: Time[];
}

// rustc-type: compiler/rustc_data_structures/src/graph/dominators/mod.rs:30 Dominators
// PORT: declared here, after `Inner`, so the class body follows upstream's `impl<Node: Idx> Dominators<Node>`
// (PORTING §8: methods from a later impl block live in the class body).
export class Dominators<Node extends number> {
  constructor(public kind: Kind<Node>) {}

  /// Returns true if node is reachable from the start node.
  // rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:351 is_reachable
  is_reachable(node: Node): boolean {
    const kind = this.kind;
    switch (kind.$) {
      case "Path":
        return true;
      case "General":
        return kind._0.time[node]!.start !== 0;
    }
  }

  /// Returns the immediate dominator of node, if any.
  // rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:359 immediate_dominator
  immediate_dominator(node: Node): Node | undefined {
    const kind = this.kind;
    switch (kind.$) {
      case "Path":
        if (0 < node) {
          return (node - 1) as Node;
        } else {
          return undefined;
        }
      case "General":
        return kind._0.immediate_dominators[node];
    }
  }

  /// Returns true if `a` dominates `b`.
  ///
  /// # Panics
  ///
  /// Panics if `b` is unreachable.
  // rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:378 dominates
  dominates(a0: Node, b0: Node): boolean {
    const kind = this.kind;
    switch (kind.$) {
      case "Path":
        return a0 <= b0;
      case "General": {
        const a = kind._0.time[a0]!;
        const b = kind._0.time[b0]!;
        // PORT: `{b:?}` is the shadowing `Time` binding, as upstream.
        assert(b.start !== 0, `node ${debug_Time(b)} is not reachable`);
        return a.start <= b.start && b.finish <= a.finish;
      }
    }
  }

  /// Returns true if `a` **strictly** dominates `b`
  ///
  /// # Panics
  ///
  /// Panics if `b` is unreachable
  // rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:396 strictly_dominates
  strictly_dominates(a0: Node, b0: Node): boolean {
    const kind = this.kind;
    switch (kind.$) {
      case "Path":
        return a0 < b0;
      case "General": {
        const a = kind._0.time[a0]!;
        const b = kind._0.time[b0]!;
        assert(b.start !== 0, `node ${debug_Time(b)} is not reachable`);
        return a.start < b.start && b.finish < a.finish;
      }
    }
  }
}

/// Describes the number of vertices discovered at the time when processing of a particular vertex
/// started and when it finished. Both values are zero for unreachable vertices.
// rustc-type: compiler/rustc_data_structures/src/graph/dominators/mod.rs:412 Time
interface Time {
  start: number;
  finish: number;
}

/** `#[derive(Debug)]` of `Time` (always printed on one line: only used in the `assert!` messages above). */
function debug_Time(t: Time, f: Fmt = { alternate: false }): string {
  return debug_struct(f, "Time", [
    ["start", String(t.start)],
    ["finish", String(t.finish)],
  ]);
}

// rustc: compiler/rustc_data_structures/src/graph/dominators/mod.rs:417 compute_access_time
function compute_access_time<N extends number>(start_node: N, immediate_dominators: readonly (N | undefined)[]): Time[] {
  // Transpose the dominator tree edges, so that child nodes of vertex v are stored in
  // node[edges[v].start..edges[v].end].
  // PORT: `std::ops::Range<u32>` is `{ start, end }`; `IndexVec::from_elem(0..0, ..)` clones it per element.
  const edges: { start: number; end: number }[] = immediate_dominators.map(() => ({ start: 0, end: 0 }));
  for (const idom of immediate_dominators) {
    if (idom !== undefined) {
      edges[idom]!.end += 1;
    }
  }
  let m = 0;
  for (const e of edges) {
    m += e.end;
    e.start = m;
    e.end = m;
  }
  const node: N[] = new Array<N>(m).fill(0 as N);
  for (let i = 0; i < immediate_dominators.length; i++) {
    const idom = immediate_dominators[i];
    if (idom !== undefined) {
      edges[idom]!.start -= 1;
      node[edges[idom]!.start] = i as N;
    }
  }

  // Perform a depth-first search of the dominator tree. Record the number of vertices discovered
  // when vertex v is discovered first as time[v].start, and when its processing is finished as
  // time[v].finish.
  const time: Time[] = immediate_dominators.map(() => ({ start: 0, finish: 0 }));
  const stack: N[] = [];

  let discovered = 1;
  stack.push(start_node);
  time[start_node]!.start = discovered;

  while (stack.length > 0) {
    const i = stack[stack.length - 1]!;
    const e = edges[i]!;
    if (e.start === e.end) {
      // Finish processing vertex i.
      time[i]!.finish = discovered;
      stack.pop();
    } else {
      const j = node[e.start]!;
      e.start += 1;
      // Start processing vertex j.
      discovered += 1;
      time[j]!.start = discovered;
      stack.push(j);
    }
  }

  return time;
}

/** `#[derive(Debug)]` of `Dominators<Node>` (with the derived `Debug` of `Kind`, `Inner` and `Time`). */
export function debug_Dominators<Node extends number>(v: Dominators<Node>, f: Fmt, debug_Node: Debug<Node>): string {
  const kind = v.kind;
  const kind_s =
    kind.$ === "Path"
      ? "Path"
      : debug_tuple(f, "General", [
          debug_struct(f, "Inner", [
            ["immediate_dominators", debug_vec(kind._0.immediate_dominators, f, (n, f) => debug_option(n, f, debug_Node))],
            ["time", debug_vec(kind._0.time, f, debug_Time)],
          ]),
        ]);
  return debug_struct(f, "Dominators", [["kind", kind_s]]);
}
