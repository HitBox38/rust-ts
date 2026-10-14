//! Routine to compute the strongly connected components (SCCs) of a graph.
//!
//! Also computes as the resulting DAG if each SCC is replaced with a
//! node in the graph. This uses [Tarjan's algorithm](
//! https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm)
//! that completes in *O*(*n*) time.
//! Optionally, also annotate the SCC nodes with some commutative data.
//! Typical examples would include: minimum element in SCC, maximum element
//! reachable from it, etc.
//
// Port of compiler/rustc_data_structures/src/graph/scc/mod.rs
//
// PORT: traits with associated types:
// - `Annotation` (`Debug + Copy`, `&mut self` merges) is a function table `Annotation<A>` over immutable annotation
//   values: a merge writes the merged value through a `MutRef<A>` (so copies made by `*annotation` never alias).
//   `()` is `null` (stored-`()` encoding, rustc_ast_ir visit.ts).
// - `Annotations<N>` is an object with `Ann` (the `type Ann: Annotation` impl table), `new` and `annotate_scc`;
//   `type SccIdx` is the type parameter `S`.
// - `N` / `S` (`Idx`) are numbers or branded handles; `Idx::new(i)` / `.index()` are the identity.
// `debug!` / `trace!` / `#[instrument]` are kept as comments.
import { type Debug, debug_int, debug_struct, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { field_mut, type MutRef } from "../../../std/mut_ref.ts";
import { assert, panic, unreachable } from "../../../std/panic.ts";
import { DirectedGraph_provided, type NumEdges, type Successors } from "../mod.ts";
import { VecGraph } from "../vec_graph/mod.ts";

/// An annotation for an SCC. This can be a representative,
/// the max/min element of the SCC, or all of the above.
///
/// Concretely, the both merge operations must commute, e.g. where `merge`
/// is `update_scc` and `update_reachable`: `a.merge(b) == b.merge(a)`
///
/// In general, what you want is probably always min/max according
/// to some ordering, potentially with side constraints (min x such
/// that P holds).
// rustc-trait: compiler/rustc_data_structures/src/graph/scc/mod.rs:35 Annotation
export interface Annotation<A> {
  /** The `Debug` supertrait. */
  readonly debug: Debug<A>;

  /// Merge two existing annotations into one during
  /// path compression.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:38 update_scc
  update_scc(self: MutRef<A>, other: A): void;

  /// Merge a successor into this annotation.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:41 update_reachable
  update_reachable(self: MutRef<A>, other: A): void;
}

/// An accumulator for annotations.
// rustc-trait: compiler/rustc_data_structures/src/graph/scc/mod.rs:45 Annotations
export interface Annotations<N extends number, Ann, S extends number> {
  /** `type Ann: Annotation`: the impl table of the annotation type. */
  readonly Ann: Annotation<Ann>;
  /** `type SccIdx: Idx + Ord` (type-level only). */
  readonly __scc_idx?: S;

  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:49 new
  "new"(element: N): Ann;
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:50 annotate_scc
  annotate_scc(scc: S, annotation: Ann): void;
}

/// The empty annotation, which does nothing.
// impl Annotation for ()
export const Annotation_unit: Annotation<null> = {
  debug: () => "()",
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:65 update_reachable
  update_reachable(_self: MutRef<null>, _other: null): void {},
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:66 update_scc
  update_scc(_self: MutRef<null>, _other: null): void {},
};

/// The nil annotation accumulator, which does nothing.
// struct NoAnnotations<S: Idx + Ord>(PhantomData<S>);
// impl<N: Idx, S: Idx + Ord> Annotations<N> for NoAnnotations<S>
function NoAnnotations<N extends number, S extends number>(): Annotations<N, null, S> {
  return {
    Ann: Annotation_unit,
    // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:59 new
    new(_element: N): null {
      return null;
    },
    // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:60 annotate_scc
    annotate_scc(_scc: S, _annotation: null): void {},
  };
}

/// Strongly connected components (SCC) of a graph. The type `N` is
/// the index type for the graph nodes and `S` is the index type for
/// the SCCs. We can map from each node to the SCC that it
/// participates in, and we also have the successors of each SCC.
// rustc-type: compiler/rustc_data_structures/src/graph/scc/mod.rs:73 Sccs
export class Sccs<N extends number, S extends number> implements Successors<S>, NumEdges<S> {
  /** `N` (type-level only). */
  declare readonly __n?: N;

  constructor(
    /// For each node, what is the SCC index of the SCC to which it
    /// belongs.
    // PORT: the field `scc_indices` is `scc_indices_` (the method `scc_indices` has the same name).
    public scc_indices_: S[],

    /// Data about all the SCCs.
    public scc_data: SccData<S>,
  ) {}

  /// Compute SCCs without annotations.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:108 new
  static new<N extends number, S extends number>(graph: Successors<N>): Sccs<N, S> {
    return Sccs.new_with_annotation<N, null, S>(graph, NoAnnotations<N, S>());
  }

  /// Compute SCCs and annotate them with a user-supplied annotation
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:113 new_with_annotation
  static new_with_annotation<N extends number, Ann, S extends number>(graph: Successors<N>, annotations: Annotations<N, Ann, S>): Sccs<N, S> {
    return SccsConstruction.construct(graph, annotations);
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:120 scc_indices
  scc_indices(): readonly S[] {
    return this.scc_indices_;
  }

  /// Returns the number of SCCs in the graph.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:125 num_sccs
  num_sccs(): number {
    return this.scc_data.len();
  }

  /// Returns an iterator over the SCCs in the graph.
  ///
  /// The SCCs will be iterated in **dependency order** (or **post order**),
  /// meaning that if `S1 -> S2`, we will visit `S2` first and `S1` after.
  /// This is convenient when the edges represent dependencies: when you visit
  /// `S1`, the value for `S2` will already have been computed.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:135 all_sccs
  all_sccs(): S[] {
    const out: S[] = [];
    for (let i = 0; i < this.scc_data.len(); i++) out.push(i as S);
    return out;
  }

  /// Returns the SCC to which a node `r` belongs.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:140 scc
  scc(r: N): S {
    return this.scc_indices_[r]!;
  }

  /// Returns the successors of the given SCC.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:145 successors
  // impl<N: Idx, S: Idx + Ord> Successors for Sccs<N, S>
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:177 successors
  successors(scc: S): readonly S[] {
    // PORT: the trait method (`self.successors(node).iter().cloned()`) is this inherent method.
    return this.scc_data.successors(scc);
  }

  /// Construct the reverse graph of the SCC graph.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:150 reverse
  reverse(): VecGraph<S> {
    const edge_pairs: [S, S][] = [];
    for (const source of this.all_sccs()) {
      for (const target of this.successors(source)) edge_pairs.push([target, source]);
    }
    return VecGraph.new<S>(this.num_sccs(), edge_pairs);
  }

  // impl<N: Idx, S: Idx + Ord> DirectedGraph for Sccs<N, S>
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:165 num_nodes
  num_nodes(): number {
    return this.num_sccs();
  }

  // impl<N: Idx, S: Idx + Ord> NumEdges for Sccs<N, S>
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:171 num_edges
  num_edges(): number {
    return this.scc_data.all_successors.length;
  }
}

/// Information about an invidividual SCC node.
interface SccDetails {
  /// For this SCC, the range of `all_successors` where its
  /// successors can be found.
  range: [number, number];
}

// The name of this struct should discourage you from making it public and leaking
// its representation. This message was left here by one who came before you,
// who learnt the hard way that making even small changes in representation
// is difficult when it's publicly inspectable.
//
// Obey the law of Demeter!
// rustc-type: compiler/rustc_data_structures/src/graph/scc/mod.rs:95 SccData
class SccData<S extends number> {
  constructor(
    /// Maps SCC indices to their metadata, including
    /// offsets into `all_successors`.
    public scc_details: SccDetails[],

    /// Contains the successors for all the Sccs, concatenated. The
    /// range of indices corresponding to a given SCC is found in its
    /// `scc_details.range`.
    public all_successors: S[],
  ) {}

  /// Number of SCCs,
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:184 len
  len(): number {
    return this.scc_details.length;
  }

  /// Returns the successors of the given SCC.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:189 successors
  successors(scc: S): readonly S[] {
    const [start, end] = this.scc_details[scc]!.range;
    return this.all_successors.slice(start, end);
  }

  /// Creates a new SCC with `successors` as its successors and
  /// returns the resulting index.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:195 create_scc
  create_scc(successors: Iterable<S>): S {
    // Store the successors on `scc_successors_vec`, remembering
    // the range of indices.
    const all_successors_start = this.all_successors.length;
    for (const s of successors) this.all_successors.push(s);
    const all_successors_end = this.all_successors.length;

    // debug!(
    //     "create_scc({:?}) successors={:?}",
    //     self.len(),
    //     &self.all_successors[all_successors_start..all_successors_end],
    // );

    const range: [number, number] = [all_successors_start, all_successors_end];
    const metadata: SccDetails = { range };
    // `IndexVec::push` returns the new index.
    this.scc_details.push(metadata);
    return (this.scc_details.length - 1) as S;
  }
}

/// PORT: `#[derive(Copy, Clone, Debug)] enum NodeState<N, S, A: Annotation>`. Values are never mutated (copies
/// share them).
type NodeState<N, S, A> =
  /// This node has not yet been visited as part of the DFS.
  ///
  /// After SCC construction is complete, this state ought to be
  /// impossible.
  | { readonly $: "NotVisited" }
  /// This node is currently being walked as part of our DFS. It is on
  /// the stack at the depth `depth` and its current annotation is
  /// `annotation`.
  ///
  /// After SCC construction is complete, this state ought to be
  /// impossible.
  | { readonly $: "BeingVisited"; readonly depth: number; readonly annotation: A }
  /// Indicates that this node is a member of the given cycle where
  /// the merged annotation is `annotation`.
  /// Note that an SCC can have several cycles, so its final annotation
  /// is the merged value of all its member annotations.
  | { readonly $: "InCycle"; readonly scc_index: S; readonly annotation: A }
  /// Indicates that this node is a member of whatever cycle
  /// `parent` is a member of. This state is transient: whenever we
  /// see it, we try to overwrite it with the current state of
  /// `parent` (this is the "path compression" step of a union-find
  /// algorithm).
  | { readonly $: "InCycleWith"; readonly parent: N };

const NodeState_NotVisited = Object.freeze({ $: "NotVisited" as const });

/** `#[derive(Debug)]` for `NodeState` (`N` / `S` print as integers, as for `usize` and the `Idx` newtypes' numbers). */
function debug_NodeState<N extends number, S extends number, A>(v: NodeState<N, S, A>, f: Fmt, debug_A: Debug<A>): string {
  switch (v.$) {
    case "NotVisited":
      return "NotVisited";
    case "BeingVisited":
      return debug_struct(f, "BeingVisited", [
        ["depth", debug_int(v.depth, f)],
        ["annotation", debug_A(v.annotation, f)],
      ]);
    case "InCycle":
      return debug_struct(f, "InCycle", [
        ["scc_index", debug_int(v.scc_index, f)],
        ["annotation", debug_A(v.annotation, f)],
      ]);
    case "InCycleWith":
      return debug_struct(f, "InCycleWith", [["parent", debug_int(v.parent, f)]]);
  }
}

/// The state of walking a given node.
// #[derive(Copy, Clone, Debug)]
type WalkReturn<S, A> =
  /// The walk found a cycle, but the entire component is not known to have
  /// been fully walked yet. We only know the minimum depth of this
  /// component in a minimum spanning tree of the graph. This component
  /// is tentatively represented by the state of the first node of this
  /// cycle we met, which is at `min_depth`.
  | { readonly $: "Cycle"; readonly min_depth: number; readonly annotation: A }
  /// The SCC and everything reachable from it have been fully walked.
  /// At this point we know what is inside the SCC as we have visited every
  /// node reachable from it. The SCC can now be fully represented by its ID.
  | { readonly $: "Complete"; readonly scc_index: S; readonly annotation: A };

// rustc-type: compiler/rustc_data_structures/src/graph/scc/mod.rs:214 SccsConstruction
class SccsConstruction<N extends number, Ann, S extends number> {
  constructor(
    public graph: Successors<N>,

    /// The state of each node; used during walk to record the stack
    /// and after walk to record what cycle each node ended up being
    /// in.
    public node_states: NodeState<N, S, Ann>[],

    /// The stack of nodes that we are visiting as part of the DFS.
    public node_stack: N[],

    /// The stack of successors: as we visit a node, we mark our
    /// position in this stack, and when we encounter a successor SCC,
    /// we push it on the stack. When we complete an SCC, we can pop
    /// everything off the stack that was found along the way.
    public successors_stack: S[],

    /// A set used to strip duplicates. As we accumulate successors
    /// into the successors_stack, we sometimes get duplicate entries.
    /// We use this set to remove those -- we also keep its storage
    /// around between successors to amortize memory allocation costs.
    // PORT: an `FxHashSet` used only for membership (never iterated): a JS `Set`.
    public duplicate_set: Set<S>,

    public scc_data: SccData<S>,

    public annotations: Annotations<N, Ann, S>,
  ) {}

  /// Identifies SCCs in the graph `G` and computes the resulting
  /// DAG. This uses a variant of [Tarjan's
  /// algorithm][wikipedia]. The high-level summary of the algorithm
  /// is that we do a depth-first search. Along the way, we keep a
  /// stack of each node whose successors are being visited. We
  /// track the depth of each node on this stack (there is no depth
  /// if the node is not on the stack). When we find that some node
  /// N with depth D can reach some other node N' with lower depth
  /// D' (i.e., D' < D), we know that N, N', and all nodes in
  /// between them on the stack are part of an SCC.
  ///
  /// Additionally, we keep track of a current annotation of the SCC.
  ///
  /// [wikipedia]: https://bit.ly/2EZIx84
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:310 construct
  static construct<N extends number, Ann, S extends number>(graph: Successors<N>, annotations: Annotations<N, Ann, S>): Sccs<N, S> {
    const num_nodes = graph.num_nodes();

    const this_ = new SccsConstruction<N, Ann, S>(
      graph,
      new Array<NodeState<N, S, Ann>>(num_nodes).fill(NodeState_NotVisited),
      [],
      [],
      new Set<S>(),
      new SccData<S>([], []),
      annotations,
    );

    const scc_indices = DirectedGraph_provided.iter_nodes(graph).map((node) => {
      const walk = this_.start_walk_from(node);
      switch (walk.$) {
        case "Complete":
          return walk.scc_index;
        case "Cycle":
          // PORT: `{node:?}` / `{min_depth:?}` print the indices as integers.
          return panic(`\`start_walk_node(${node})\` returned cycle with depth ${walk.min_depth}`);
      }
    });

    return new Sccs<N, S>(scc_indices, this_.scc_data);
  }

  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:336 start_walk_from
  start_walk_from(node: N): WalkReturn<S, Ann> {
    return this.inspect_node(node) ?? this.walk_unvisited_node(node);
  }

  /// Inspect a node during the DFS. We first examine its current
  /// state -- if it is not yet visited (`NotVisited`), return `None` so
  /// that the caller might push it onto the stack and start walking its
  /// successors.
  ///
  /// If it is already on the DFS stack it will be in the state
  /// `BeingVisited`. In that case, we have found a cycle and we
  /// return the depth from the stack.
  ///
  /// Otherwise, we are looking at a node that has already been
  /// completely visited. We therefore return `WalkReturn::Complete`
  /// with its associated SCC index.
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:352 inspect_node
  inspect_node(node: N): WalkReturn<S, Ann> | undefined {
    const state = this.find_state(node);
    switch (state.$) {
      case "InCycle": {
        const { scc_index, annotation } = state;
        return { $: "Complete", scc_index, annotation };
      }

      case "BeingVisited": {
        const { depth: min_depth, annotation } = state;
        return { $: "Cycle", min_depth, annotation };
      }

      case "NotVisited":
        return undefined;

      case "InCycleWith":
        // PORT: `{parent:?}` prints the index as an integer.
        return panic(`\`find_state\` returned \`InCycleWith(${state.parent})\`, which ought to be impossible`);
    }
  }

  /// Fetches the state of the node `r`. If `r` is recorded as being
  /// in a cycle with some other node `r2`, then fetches the state
  /// of `r2` (and updates `r` to reflect current result). This is
  /// basically the "find" part of a standard union-find algorithm
  /// (with path compression).
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:375 find_state
  find_state(node: N): NodeState<N, S, Ann> {
    // To avoid recursion we temporarily reuse the `parent` of each
    // InCycleWith link to encode a downwards link while compressing
    // the path. After we have found the root or deepest node being
    // visited, we traverse the reverse links and correct the node
    // states on the way.
    //
    // **Note**: This mutation requires that this is a leaf function
    // or at least that none of the called functions inspects the
    // current node states. Luckily, we are a leaf.

    // Remember one previous link. The termination condition when
    // following links downwards is then simply as soon as we have
    // found the initial self-loop.
    let previous_node = node;

    // Ultimately propagated to all the transitive parents when following
    // `InCycleWith` upwards.
    // This loop performs the downward link encoding mentioned above. Details below!
    // Note that there are two different states being assigned: the root state, and
    // a potentially derived version of the root state for non-root nodes in the chain.
    let root_state: NodeState<N, S, Ann>;
    let assigned_state: NodeState<N, S, Ann>;
    for (;;) {
      // trace!("find_state(r = {node:?} in state {:?})", self.node_states[node]);
      const s = this.node_states[node]!;
      if (s.$ === "NotVisited") {
        // This must have been the first and only state since it is unexplored*;
        // no update needed! * Unless there is a bug :')
        return s;
      } else if (s.$ === "InCycle") {
        // We are in a completely discovered SCC; every node on our path is in that SCC:
        root_state = s;
        assigned_state = s;
        break;
      } else if (s.$ === "BeingVisited") {
        // The Interesting Third Base Case: we are a path back to a root node
        // still being explored. Now we need that node to keep its state and
        // every other node to be recorded as being in whatever component that
        // ends up in.
        root_state = s;
        assigned_state = { $: "InCycleWith", parent: this.node_stack[s.depth]! };
        break;
      } else {
        // We are not at the head of a path; keep compressing it!
        const parent = s.parent;
        // We test this, to be extremely sure that we never
        // ever break our termination condition for the
        // reverse iteration loop.
        assert(node !== parent, "Node can not be in cycle with itself");

        // Store the previous node as an inverted list link
        this.node_states[node] = { $: "InCycleWith", parent: previous_node };
        // Update to parent node.
        previous_node = node;
        node = parent;
      }
    }

    // The states form a graph where up to one outgoing link is stored at
    // each node. Initially in general,
    //
    //                                                  E
    //                                                  ^
    //                                                  |
    //                                InCycleWith/BeingVisited/NotVisited
    //                                                  |
    //   A-InCycleWith->B-InCycleWith…>C-InCycleWith->D-+
    //   |
    //   = node, previous_node
    //
    // After the first loop, this will look like
    //                                                  E
    //                                                  ^
    //                                                  |
    //                                InCycleWith/BeingVisited/NotVisited
    //                                                  |
    // +>A<-InCycleWith-B<…InCycleWith-C<-InCycleWith-D-+
    // | |                             |              |
    // | InCycleWith                   |              = node
    // +-+                             =previous_node
    //
    // Note in particular that A will be linked to itself in a self-cycle
    // and no other self-cycles occur due to how InCycleWith is assigned in
    // the find phase implemented by `walk_unvisited_node`.
    //
    // We now want to compress the path, that is assign the state of the
    // link D-E to all other links.
    //
    // We can then walk backwards, starting from `previous_node`, and assign
    // each node in the list with the updated state. The loop terminates
    // when we reach the self-cycle.

    // Move backwards until we found the node where we started. We
    // will know when we hit the state where previous_node == node.
    for (;;) {
      // Back at the beginning, we can return. Note that we return the root state.
      // This is because for components being explored, we would otherwise get a
      // `node_state[n] = InCycleWith{ parent: n }` and that's wrong.
      if (previous_node === node) {
        return root_state;
      }
      // trace!("Compressing {node:?} down to {previous_node:?} with state {assigned_state:?}");

      // Update to previous node in the link.
      const other = this.node_states[previous_node]!;
      if (other.$ === "InCycleWith") {
        const previous = other.parent;
        node = previous_node;
        previous_node = previous;
      } else {
        // Only InCycleWith nodes were added to the reverse linked list.
        unreachable(
          `internal error: entered unreachable code: Invalid previous link while compressing cycle: ${debug_NodeState(other, PLAIN, this.annotations.Ann.debug)}`,
        );
      }

      // Update the node state to the (potentially derived) state.
      // If the root is still being explored, this is
      // `InCycleWith{ parent: <root node>}`, otherwise
      // `assigned_state == root_state`.
      this.node_states[node] = assigned_state;
    }
  }

  /// Walks a node that has never been visited before.
  ///
  /// Call this method when `inspect_node` has returned `None`. Having the
  /// caller decide avoids mutual recursion between the two methods and allows
  /// us to maintain an allocated stack for nodes on the path between calls.
  // #[instrument(skip(self, initial), level = "trace")]
  // rustc: compiler/rustc_data_structures/src/graph/scc/mod.rs:498 walk_unvisited_node
  walk_unvisited_node(initial: N): WalkReturn<S, Ann> {
    // trace!("Walk unvisited node: {initial:?}");
    // struct VisitingNodeFrame<G: DirectedGraph, Successors, A>
    interface VisitingNodeFrame {
      node: N;
      successors: Iterator<N> | undefined;
      depth: number;
      min_depth: number;
      successors_len: number;
      min_cycle_root: N;
      successor_node: N;
      /// The annotation for the SCC starting in `node`. It may or may
      /// not contain other nodes.
      current_component_annotation: Ann;
    }

    const Ann = this.annotations.Ann;

    // Move the stack to a local variable. We want to utilize the existing allocation and
    // mutably borrow it without borrowing self at the same time.
    const successors_stack = this.successors_stack;
    this.successors_stack = [];

    // debug_assert_eq!(successors_stack.len(), 0);

    const stack: VisitingNodeFrame[] = [
      {
        node: initial,
        depth: 0,
        min_depth: 0,
        successors: undefined,
        successors_len: 0,
        min_cycle_root: initial,
        successor_node: initial,
        current_component_annotation: this.annotations.new(initial),
      },
    ];

    // PORT: `Option<WalkReturn>`: `WalkReturn` is never `undefined`.
    let return_value: WalkReturn<S, Ann> | undefined = undefined;

    recurse: while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const node = frame.node;
      const depth = frame.depth;

      // trace!(
      //     "Visiting {node:?} at depth {depth:?}, annotation: {current_component_annotation:?}"
      // );

      let successors: Iterator<N>;
      if (frame.successors !== undefined) {
        successors = frame.successors;
      } else {
        // This None marks that we still have the initialize this node's frame.
        // trace!(?depth, ?node);

        // debug_assert_matches!(self.node_states[node], NodeState::NotVisited);

        // Push `node` onto the stack.
        this.node_states[node] = {
          $: "BeingVisited",
          depth,
          annotation: frame.current_component_annotation,
        };
        this.node_stack.push(node);

        // Walk each successor of the node, looking to see if any of
        // them can reach a node that is presently on the stack. If
        // so, that means they can also reach us.
        frame.successors_len = successors_stack.length;
        // Set and return a reference, this is currently empty.
        successors = frame.successors = this.graph.successors(node)[Symbol.iterator]();
      }

      // Now that the successors iterator is initialized, this is a constant for this frame.
      const successors_len = frame.successors_len;

      // Construct iterators for the nodes and walk results. There are two cases:
      // * The walk of a successor node returned.
      // * The remaining successor nodes.
      // PORT: `returned_walk.chain(successor_walk)` is the loop below: first the taken `return_value` (paired with
      // `frame.successor_node`), then the remaining successors, each inspected when it is pulled.
      let returned_walk: WalkReturn<S, Ann> | undefined = return_value;
      return_value = undefined;

      for (;;) {
        let successor_node: N;
        let walk: WalkReturn<S, Ann> | undefined;
        if (returned_walk !== undefined) {
          successor_node = frame.successor_node;
          walk = returned_walk;
          returned_walk = undefined;
        } else {
          const next = successors.next();
          if (next.done) break;
          successor_node = next.value;
          // trace!(?node, ?successor_node);
          walk = this.inspect_node(successor_node);
        }

        if (walk === undefined) {
          // `node` has no more (direct) successors; search recursively.
          const depth_ = depth + 1;
          // trace!("Recursing down into {successor_node:?} at depth {depth:?}");
          // trace!(?depth, ?successor_node);
          // Remember which node the return value will come from.
          frame.successor_node = successor_node;
          // Start a new stack frame, then step into it.
          stack.push({
            node: successor_node,
            depth: depth_,
            successors: undefined,
            successors_len: 0,
            min_depth: depth_,
            min_cycle_root: successor_node,
            successor_node,
            current_component_annotation: this.annotations.new(successor_node),
          });
          continue recurse;
        }

        switch (walk.$) {
          // The starting node `node` leads to a cycle whose earliest node,
          // `successor_node`, is at `min_depth`. There may be more cycles.
          case "Cycle": {
            const successor_min_depth = walk.min_depth;
            const successor_annotation = walk.annotation;
            // trace!(
            //     "Cycle found from {node:?}, minimum depth: {successor_min_depth:?}, annotation: {successor_annotation:?}"
            // );
            // Track the minimum depth we can reach.
            assert(successor_min_depth <= depth, "assertion failed: successor_min_depth <= depth");
            if (successor_min_depth < frame.min_depth) {
              // trace!(?node, ?successor_min_depth);
              frame.min_depth = successor_min_depth;
              frame.min_cycle_root = successor_node;
            }
            Ann.update_scc(field_mut(frame, "current_component_annotation"), successor_annotation);
            break;
          }
          // The starting node `node` is succeeded by a fully identified SCC
          // which is now added to the set under `scc_index`.
          case "Complete": {
            const successor_scc_index = walk.scc_index;
            const successor_annotation = walk.annotation;
            // trace!(
            //     "Complete; {node:?} is root of complete-visited SCC idx {successor_scc_index:?} with annotation {successor_annotation:?}"
            // );
            // Push the completed SCC indices onto
            // the `successors_stack` for later.
            // trace!(?node, ?successor_scc_index);
            successors_stack.push(successor_scc_index);
            Ann.update_reachable(field_mut(frame, "current_component_annotation"), successor_annotation);
            break;
          }
        }
      }

      // trace!("Finished walk from {node:?} with annotation: {current_component_annotation:?}");

      // Completed walk, remove `node` from the stack.
      this.node_stack.pop();
      // debug_assert_eq!(r, Some(node));

      // Remove the frame, it's done.
      const frame_ = stack.pop()!;
      const current_component_annotation = frame_.current_component_annotation;
      // debug_assert_eq!(frame.node, node);

      // If `min_depth == depth`, then we are the root of the
      // cycle: we can't reach anyone further down the stack.

      // Pass the 'return value' down the stack.
      // We return one frame at a time so there can't be another return value.
      // debug_assert!(return_value.is_none());
      if (frame_.min_depth === depth) {
        // We are at the head of the component.

        // Note that successor stack may have duplicates, so we
        // want to remove those:
        const duplicate_set = this.duplicate_set;
        duplicate_set.clear();
        const deduplicated_successors = successors_stack.splice(successors_len).filter((i) => {
          if (duplicate_set.has(i)) return false;
          duplicate_set.add(i);
          return true;
        });

        // debug!("Creating SCC rooted in {node:?} with successor {:?}", frame.successor_node);

        const scc_index = this.scc_data.create_scc(deduplicated_successors);

        this.annotations.annotate_scc(scc_index, current_component_annotation);

        this.node_states[node] = { $: "InCycle", scc_index, annotation: current_component_annotation };

        return_value = { $: "Complete", scc_index, annotation: current_component_annotation };
      } else {
        // We are not the head of the cycle. Return back to our
        // caller. They will take ownership of the
        // `self.successors` data that we pushed.
        this.node_states[node] = { $: "InCycleWith", parent: frame_.min_cycle_root };
        return_value = {
          $: "Cycle",
          min_depth: frame_.min_depth,
          annotation: current_component_annotation,
        };
      }
    }

    // Keep the allocation we used for successors_stack.
    this.successors_stack = successors_stack;
    // debug_assert_eq!(self.successors_stack.len(), 0);

    if (return_value === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return return_value;
  }
}
