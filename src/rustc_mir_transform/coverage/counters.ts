// Port of compiler/rustc_mir_transform/src/coverage/counters.rs (lane mt-coverage).
//
// PORT: `FxIndexMap<BasicCoverageBlock, CounterId>` is an insertion-ordered `Map`; `expressions_memo:
// FxHashMap<Expression, CovTerm>` is a `KeyedMap` keyed by `intern_key` (the derived `Hash + Eq` of `Expression`).
// `IndexVec<_, Option<CovTerm>>` is `(CovTerm | undefined)[]`. `Ord` on `bool` (false < true) is `Number(b)`.
// The sorts use `Array.prototype.sort` (stable): every comparator here is a consistent total preorder.
import { DirectedGraph_provided } from "../../rustc_data_structures/graph/mod.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { CounterId, type CovTerm, CovTerm as CovTerm_, debug_CovTerm, type Expression, type ExpressionId, Op } from "../../rustc_middle/mir/coverage.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { assert_eq } from "../../std/panic.ts";
import { debug_option, PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { BalancedFlowGraph } from "./counters/balanced_flow.ts";
import { type CounterTerm, type NodeCounters, type NodeFlowData, node_flow_data_for_balanced_graph } from "./counters/node_flow.ts";
import { type BasicCoverageBlock, type CoverageGraph, debug_BasicCoverageBlock } from "./graph.ts";

// mod balanced_flow;
// pub(crate) mod node_flow;
export * as node_flow from "./counters/node_flow.ts";

/// Struct containing the results of [`prepare_bcb_counters_data`].
// rustc-type: compiler/rustc_mir_transform/src/coverage/counters.rs:21 BcbCountersData
export interface BcbCountersData {
  node_flow_data: NodeFlowData<BasicCoverageBlock>;
  priority_list: BasicCoverageBlock[];
}

/// Analyzes the coverage graph to create intermediate data structures that
/// will later be used (during codegen) to create physical counters or counter
/// expressions for each BCB node that needs one.
// rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:29 prepare_bcb_counters_data
export function prepare_bcb_counters_data(graph: CoverageGraph): BcbCountersData {
  // Create the derived graphs that are necessary for subsequent steps.
  const balanced_graph = BalancedFlowGraph.for_graph(graph, (n) => !graph.index(n).is_out_summable);
  const node_flow_data = node_flow_data_for_balanced_graph(balanced_graph);

  // Also create a "priority list" of coverage graph nodes, to help determine
  // which ones get physical counters or counter expressions. This needs to
  // be done now, because the later parts of the counter-creation process
  // won't have access to the original coverage graph.
  const priority_list = make_node_flow_priority_list(graph, balanced_graph);

  return { node_flow_data, priority_list };
}

/// Arranges the nodes in `balanced_graph` into a list, such that earlier nodes
/// take priority in being given a counter expression instead of a physical counter.
// rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:45 make_node_flow_priority_list
function make_node_flow_priority_list(graph: CoverageGraph, balanced_graph: BalancedFlowGraph<BasicCoverageBlock>): BasicCoverageBlock[] {
  // A "reloop" node has exactly one out-edge, which jumps back to the top
  // of an enclosing loop. Reloop nodes are typically visited more times
  // than loop-exit nodes, so try to avoid giving them physical counters.
  const is_reloop_node: boolean[] = [];
  for (let i = 0; i < graph.num_nodes(); i++) {
    const node = i as BasicCoverageBlock;
    const succs = graph.successors_[node]!;
    is_reloop_node.push(succs.length === 1 ? graph.dominates(succs[0]!, node) : false);
  }

  const nodes = DirectedGraph_provided.iter_nodes<BasicCoverageBlock>(balanced_graph).reverse();
  // The first node is the sink, which must not get a physical counter.
  assert_eq(nodes[0], balanced_graph.sink, (v) => debug_BasicCoverageBlock(v!, PLAIN));
  // Sort the real nodes, such that earlier (lesser) nodes take priority
  // in being given a counter expression instead of a physical counter.
  const rest = nodes.slice(1).sort((a, b) => {
    // Start with a dummy `Equal` to make the actual tests line up nicely.
    let o = 0;
    // Prefer a physical counter for return/yield nodes.
    if (o === 0) o = Number(graph.index(a).is_out_summable) - Number(graph.index(b).is_out_summable);
    // Prefer an expression for reloop nodes (see definition above).
    if (o === 0) o = -(Number(is_reloop_node[a]!) - Number(is_reloop_node[b]!));
    // Otherwise, prefer a physical counter for dominating nodes.
    if (o === 0) o = -graph.cmp_in_dominator_order(a, b);
    return o;
  });
  nodes.splice(1, rest.length, ...rest);
  return nodes;
}

// Converts node counters into a form suitable for embedding into MIR.
// rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:79 transcribe_counters
export function transcribe_counters(
  old: NodeCounters<BasicCoverageBlock>,
  bcb_needs_counter: DenseBitSet<BasicCoverageBlock>,
  bcbs_seen: DenseBitSet<BasicCoverageBlock>,
): CoverageCounters {
  const new_ = CoverageCounters.with_num_bcbs(bcb_needs_counter.domain_size());

  for (const bcb of bcb_needs_counter.iter()) {
    if (!bcbs_seen.contains(bcb)) {
      // This BCB's code was removed by MIR opts, so its counter is always zero.
      new_.set_node_counter(bcb, CovTerm_.Zero);
      continue;
    }

    // Our counter-creation algorithm doesn't guarantee that a node's list
    // of terms starts or ends with a positive term, so partition the
    // counters into "positive" and "negative" lists for easier handling.
    const pos0: BasicCoverageBlock[] = [];
    const neg0: BasicCoverageBlock[] = [];
    for (const term of old.counter_terms[bcb]!) {
      // Filter out any BCBs that were removed by MIR opts;
      // this treats them as having an execution count of 0.
      if (!bcbs_seen.contains(term.node)) continue;
      const { node, op }: CounterTerm<BasicCoverageBlock> = term;
      switch (op) {
        case "Add":
          pos0.push(node);
          break;
        case "Subtract":
          neg0.push(node);
          break;
      }
    }

    // These intermediate sorts are not strictly necessary, but were helpful
    // in reducing churn when switching to the current counter-creation scheme.
    // They also help to slightly decrease the overall size of the expression
    // table, due to more subexpressions being shared.
    pos0.sort((a, b) => a - b);
    neg0.sort((a, b) => a - b);

    const new_counters_for_sites = (sites: BasicCoverageBlock[]): CovTerm[] => sites.map((node) => new_.ensure_phys_counter(node));
    const pos = new_counters_for_sites(pos0);
    const neg = new_counters_for_sites(neg0);

    const pos_counter = new_.make_sum(pos) ?? CovTerm_.Zero;
    const new_counter = new_.make_subtracted_sum(pos_counter, neg);
    new_.set_node_counter(bcb, new_counter);
  }

  return new_;
}

/// Generates and stores coverage counter and coverage expression information
/// associated with nodes in the coverage graph.
// rustc-type: compiler/rustc_mir_transform/src/coverage/counters.rs:129 CoverageCounters
export class CoverageCounters {
  constructor(
    /// List of places where a counter-increment statement should be injected
    /// into MIR, each with its corresponding counter ID.
    public phys_counter_for_node: Map<BasicCoverageBlock, CounterId>,
    public next_counter_id: CounterId,

    /// Coverage counters/expressions that are associated with individual BCBs.
    public node_counters: (CovTerm | undefined)[],

    /// Table of expression data, associating each expression ID with its
    /// corresponding operator (+ or -) and its LHS/RHS operands.
    public expressions: Expression[],
    /// Remember expressions that have already been created (or simplified),
    /// so that we don't create unnecessary duplicates.
    public expressions_memo: KeyedMap<Expression, CovTerm>,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:147 with_num_bcbs
  static with_num_bcbs(num_bcbs: number): CoverageCounters {
    return new CoverageCounters(
      new Map(),
      CounterId.ZERO,
      Array.from({ length: num_bcbs }, () => undefined),
      [],
      new KeyedMap<Expression, CovTerm>((e) => intern_key(e)),
    );
  }

  /// Returns the physical counter for the given node, creating it if necessary.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:158 ensure_phys_counter
  ensure_phys_counter(bcb: BasicCoverageBlock): CovTerm {
    let id = this.phys_counter_for_node.get(bcb);
    if (id === undefined) {
      const id_ = this.next_counter_id;
      this.next_counter_id = CounterId.from_u32(id_ + 1);
      id = id_;
      this.phys_counter_for_node.set(bcb, id);
    }
    return { $: "Counter", _0: id };
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:167 make_expression
  make_expression(lhs: CovTerm, op: Op, rhs: CovTerm): CovTerm {
    const new_expr: Expression = { lhs, op, rhs };
    let term = this.expressions_memo.get(new_expr);
    if (term === undefined) {
      const id = this.expressions.length as ExpressionId;
      this.expressions.push(new_expr);
      term = { $: "Expression", _0: id };
      this.expressions_memo.set({ lhs, op, rhs }, term);
    }
    return term;
  }

  /// Creates a counter that is the sum of the given counters.
  ///
  /// Returns `None` if the given list of counters was empty.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:178 make_sum
  make_sum(counters: readonly CovTerm[]): CovTerm | undefined {
    let accum: CovTerm | undefined;
    for (const counter of counters) {
      accum = accum === undefined ? counter : this.make_expression(accum, Op.Add, counter);
    }
    return accum;
  }

  /// Creates a counter whose value is `lhs - SUM(rhs)`.
  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:186 make_subtracted_sum
  make_subtracted_sum(lhs: CovTerm, rhs: readonly CovTerm[]): CovTerm {
    const rhs_sum = this.make_sum(rhs);
    if (rhs_sum === undefined) return lhs;
    return this.make_expression(lhs, Op.Subtract, rhs_sum);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/counters.rs:191 set_node_counter
  set_node_counter(bcb: BasicCoverageBlock, counter: CovTerm): CovTerm {
    const existing = this.node_counters[bcb];
    this.node_counters[bcb] = counter;
    assert(
      existing === undefined,
      () =>
        `node ${debug_BasicCoverageBlock(bcb, PLAIN)} already has a counter: ${debug_option(existing, PLAIN, debug_CovTerm)} => ${debug_CovTerm(counter, PLAIN)}`,
    );
    return counter;
  }
}
