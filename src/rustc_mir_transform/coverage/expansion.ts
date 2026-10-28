// Port of compiler/rustc_mir_transform/src/coverage/expansion.rs (lane mt-coverage).
//
// PORT: `FxIndexMap<SyntaxContext, ExpnNode>` is an insertion-ordered `Map` (SyntaxContext is a branded number);
// `nodes.sort_by_key(..)` rebuilds the map in the sorted order (a stable sort, like `IndexMap::sort_by_key`), and
// positional access `nodes[i]` goes through `[...nodes.values()]`. `FxIndexSet<SyntaxContext>` is a `Set`. The
// `entry(..).or_insert_with_key(..)` calls are `get` + `set`.
// PORT: itertools' `minmax_by` (first minimum, last maximum) is a fold with those tie rules; `into_option()` of a
// one-element `MinMax` is `(x, x)`.
// PORT: `#[derive(Debug)]` on `SpanWithBcb` / `ExpnTree` / `ExpnNode` / `MinMaxBcbs` is only reached by tracing and is
// not ported; `tracing::debug!` calls are kept as comments.
import type { BasicCoverageBlock, BranchSpan } from "../../rustc_middle/mir/coverage.ts";
import { clone_BranchSpan } from "../../rustc_middle/mir/coverage.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import { type ExpnKind, SyntaxContext } from "../../rustc_span/hygiene.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as from_mir from "./from_mir.ts";
import type { CoverageGraph } from "./graph.ts";
import type { ExtractedHirInfo } from "./hir_info.ts";
import { MappingsError } from "./mappings.ts";

// rustc-type: compiler/rustc_mir_transform/src/coverage/expansion.rs:13 SpanWithBcb
export interface SpanWithBcb {
  span: Span;
  bcb: BasicCoverageBlock;
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/expansion.rs:19 ExpnTree
export class ExpnTree {
  constructor(public nodes: Map<SyntaxContext, ExpnNode>) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/expansion.rs:24 get
  get(context: SyntaxContext): ExpnNode | undefined {
    return this.nodes.get(context);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/expansion.rs:30 ExpnNode
export class ExpnNode {
  constructor(
    /// Storing the syntax context in its own node is not strictly necessary,
    /// but is helpful for debugging and might be useful later.
    // #[expect(dead_code)]
    public context: SyntaxContext,
    /// Index of this node in a depth-first traversal from the root.
    public dfs_rank: number,

    // Useful info extracted from `ExpnData`.
    public expn_kind: ExpnKind,
    /// Non-dummy `ExpnData::call_site` span.
    public call_site: Span | undefined,
    /// Syntax context of `call_site`, if present.
    /// This links an expansion node to its parent in the tree.
    public call_site_context: SyntaxContext | undefined,

    /// Holds the function signature span, if it belongs to this expansion.
    /// Used by special-case code in span refinement.
    public fn_sig_span: Span | undefined,
    /// Holds the function body span, if it belongs to this expansion.
    /// Used by special-case code in span refinement.
    public body_span: Span | undefined,

    /// Spans (and their associated BCBs) belonging to this expansion.
    public spans: SpanWithBcb[],
    /// Expansions whose call-site is in this expansion.
    public child_contexts: Set<SyntaxContext>,
    /// The "minimum" and "maximum" BCBs (in dominator order) of ordinary spans
    /// belonging to this tree node and all of its descendants. Used when
    /// creating a single code mapping representing an entire child expansion.
    public minmax_bcbs: MinMaxBcbs | undefined,

    /// Branch spans (recorded during MIR building) belonging to this expansion.
    public branch_spans: BranchSpan[],

    /// Hole spans belonging to this expansion, to be carved out from the
    /// code spans during span refinement.
    public hole_spans: Span[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/expansion.rs:71 for_context
  static for_context(context: SyntaxContext): ExpnNode {
    const expn_data = SyntaxContext.outer_expn_data(context);

    const call_site = !Span.is_dummy(expn_data.call_site) ? expn_data.call_site : undefined;
    const call_site_context = call_site === undefined ? undefined : Span.ctxt(call_site);

    return new ExpnNode(
      context,
      Number.MAX_SAFE_INTEGER, // PORT: `usize::MAX` (a sentinel; only compared with ranks < num nodes)

      expn_data.kind,
      call_site,
      call_site_context,

      undefined,
      undefined,

      [],
      new Set(),
      undefined,

      [],

      [],
    );
  }
}

/// Extracts raw span/BCB pairs from potentially-different syntax contexts, and
/// arranges them into an "expansion tree" based on their expansion call-sites.
// rustc: compiler/rustc_mir_transform/src/coverage/expansion.rs:101 build_expn_tree
export function build_expn_tree(mir_body: Body, hir_info: ExtractedHirInfo, graph: CoverageGraph): Result<ExpnTree, MappingsError> {
  const raw_spans = from_mir.extract_raw_spans_from_mir(mir_body, hir_info, graph);

  let nodes = new Map<SyntaxContext, ExpnNode>();
  const new_node = (context: SyntaxContext): ExpnNode => ExpnNode.for_context(context);
  const entry_or_insert = (context: SyntaxContext): ExpnNode => {
    let node = nodes.get(context);
    if (node === undefined) {
      node = new_node(context);
      nodes.set(context, node);
    }
    return node;
  };

  for (const { raw_span, bcb } of raw_spans) {
    const span_with_bcb: SpanWithBcb = { span: raw_span, bcb };

    // Create a node for this span's enclosing expansion, and add the span to it.
    const context = Span.ctxt(span_with_bcb.span);
    const node = entry_or_insert(context);
    node.spans.push(span_with_bcb);

    // Now walk up the expansion call-site chain, creating nodes and registering children.
    let prev = context;
    let curr_context = node.call_site_context;
    while (curr_context !== undefined) {
      const context = curr_context;
      const node_existed = nodes.has(context);

      const node = entry_or_insert(context);
      node.child_contexts.add(prev);

      if (node_existed) {
        break;
      }

      prev = context;
      curr_context = node.call_site_context;
    }
  }

  // Sort the tree nodes into depth-first order.
  const r = sort_nodes_depth_first(nodes);
  if (r.$ === "Err") return r;
  nodes = r._0;

  // For each node, determine its "minimum" and "maximum" BCBs, based on its
  // own spans and its immediate children. This relies on the nodes having
  // been sorted, so that each node's children are processed before the node
  // itself.
  const node_list = [...nodes.values()];
  for (let i = node_list.length - 1; i >= 0; i--) {
    // Computing a node's min/max BCBs requires a shared ref to other nodes.
    const minmax_bcbs = minmax_bcbs_for_expn_tree_node(graph, nodes, node_list[i]!);
    // Now we can mutate the current node to set its min/max BCBs.
    node_list[i]!.minmax_bcbs = minmax_bcbs;
  }

  // If we have a span for the function signature, associate it with the
  // corresponding expansion tree node.
  const fn_sig_span = hir_info.fn_sig_span;
  if (fn_sig_span !== undefined) {
    const node = nodes.get(Span.ctxt(fn_sig_span));
    if (node !== undefined) {
      node.fn_sig_span = fn_sig_span;
    }
  }

  // Also associate the body span with its expansion tree node.
  const body_span = hir_info.body_span;
  {
    const node = nodes.get(Span.ctxt(body_span));
    if (node !== undefined) {
      node.body_span = body_span;
    }
  }

  // Associate each hole span (extracted from HIR) with its corresponding
  // expansion tree node.
  for (const hole_span of hir_info.hole_spans) {
    const context = Span.ctxt(hole_span);
    const node = nodes.get(context);
    if (node === undefined) continue;
    node.hole_spans.push(hole_span);
  }

  // Associate each branch span (recorded during MIR building) with its
  // corresponding expansion tree node.
  const early_info = mir_body.coverage_early_info;
  if (early_info !== undefined) {
    for (const branch_span of early_info.branch_spans) {
      const node = nodes.get(Span.ctxt(branch_span.span));
      if (node !== undefined) {
        node.branch_spans.push(clone_BranchSpan(branch_span));
      }
    }
  }

  return Ok(new ExpnTree(nodes));
}

/// Sorts the tree nodes in the map into depth-first order.
///
/// This allows subsequent operations to iterate over all nodes, while assuming
/// that every node occurs before all of its descendants.
// PORT: `nodes: &mut FxIndexMap<..>` is returned re-sorted (a new `Map` with the same node objects).
// rustc: compiler/rustc_mir_transform/src/coverage/expansion.rs:191 sort_nodes_depth_first
function sort_nodes_depth_first(nodes: Map<SyntaxContext, ExpnNode>): Result<Map<SyntaxContext, ExpnNode>, MappingsError> {
  const dfs_stack: SyntaxContext[] = [SyntaxContext.root()];
  let next_dfs_rank = 0;
  let context: SyntaxContext | undefined;
  while ((context = dfs_stack.pop()) !== undefined) {
    const node = nodes.get(context);
    if (node !== undefined) {
      node.dfs_rank = next_dfs_rank;
      next_dfs_rank += 1;
      dfs_stack.push(...[...node.child_contexts].reverse());
    }
  }
  const sorted = new Map([...nodes.entries()].sort((a, b) => a[1].dfs_rank - b[1].dfs_rank));

  // Verify that the depth-first search visited each node exactly once.
  let i = 0;
  for (const { dfs_rank } of sorted.values()) {
    if (dfs_rank !== i) {
      // tracing::debug!(dfs_rank, i, "expansion tree node's rank does not match its index");
      return Err(MappingsError.TreeSortFailure);
    }
    i++;
  }

  return Ok(sorted);
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/expansion.rs:217 MinMaxBcbs
export interface MinMaxBcbs {
  min: BasicCoverageBlock;
  max: BasicCoverageBlock;
}

/// For a single node in the expansion tree, compute its "minimum" and "maximum"
/// BCBs (in dominator order), from among the BCBs of its immediate spans,
/// and the min/max of its immediate children.
// rustc: compiler/rustc_mir_transform/src/coverage/expansion.rs:225 minmax_bcbs_for_expn_tree_node
function minmax_bcbs_for_expn_tree_node(graph: CoverageGraph, nodes: Map<SyntaxContext, ExpnNode>, node: ExpnNode): MinMaxBcbs | undefined {
  const immediate_span_bcbs = node.spans.map((sp: SpanWithBcb) => sp.bcb);
  const child_minmax_bcbs: BasicCoverageBlock[] = [];
  for (const id of node.child_contexts) {
    const child = nodes.get(id);
    if (child === undefined) continue;
    const mm = child.minmax_bcbs;
    if (mm === undefined) continue;
    child_minmax_bcbs.push(mm.min, mm.max);
  }

  let min: BasicCoverageBlock | undefined;
  let max: BasicCoverageBlock | undefined;
  for (const x of [...immediate_span_bcbs, ...child_minmax_bcbs]) {
    if (min === undefined || max === undefined) {
      min = x;
      max = x;
      continue;
    }
    if (graph.cmp_in_dominator_order(x, min) < 0) min = x;
    if (graph.cmp_in_dominator_order(x, max) >= 0) max = x;
  }
  if (min === undefined || max === undefined) return undefined;
  return { min, max };
}
