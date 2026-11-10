// Port of compiler/rustc_middle/src/mir/generic_graphviz.rs (lane dataflow-graphviz, wave 40i).
//
// PORT: nothing calls `GraphvizWriter` at the pin (mod.rs's `pub mod generic_graphviz;` has no user); it is ported for
// completeness. `G: DirectedGraph + Successors + StartNode` is the graph object; `G::Node`'s `Debug` (the `{:?}` of a
// node) is the extra `debug_node` argument of `new`. `W: Write` is vendor/anstream's `Write`; `writeln!(w, ..)` is
// `w.write_fmt([text])`, as in pretty.ts.
import "./mod.ts";
import type { Successors, StartNode } from "../../rustc_data_structures/graph/mod.ts";
import * as iterate from "../../rustc_data_structures/graph/iterate/mod.ts";
import { escape_html } from "../../rustc_graphviz/lib.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { Ok } from "../../std/result.ts";
import type { Write } from "../../vendor/anstream/stream.ts";
import type { TyCtxt } from "../ty/context.ts";

// rustc-type: compiler/rustc_middle/src/mir/generic_graphviz.rs:8 GraphvizWriter
export class GraphvizWriter<N extends number, G extends Successors<N> & StartNode<N>> {
  constructor(
    public graph: G,
    public is_subgraph: boolean,
    public graphviz_name: string,
    public graph_label: string | undefined,
    public node_content_fn: (node: N) => string[],
    public edge_labels_fn: (node: N) => string[],
    /** PORT: `G::Node: Debug`. */
    public debug_node: Debug<N>,
  ) {}

  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:29 new
  static new<N extends number, G extends Successors<N> & StartNode<N>>(
    graph: G,
    graphviz_name: string,
    node_content_fn: (node: N) => string[],
    edge_labels_fn: (node: N) => string[],
    debug_node: Debug<N>,
  ): GraphvizWriter<N, G> {
    return new GraphvizWriter<N, G>(graph, false, graphviz_name, undefined, node_content_fn, edge_labels_fn, debug_node);
  }

  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:45 set_graph_label
  set_graph_label(graph_label: string): void {
    this.graph_label = graph_label;
  }

  /// Write a graphviz DOT of the graph
  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:50 write_graphviz
  write_graphviz(tcx: TyCtxt, w: Write): IoResult<void> {
    let r: IoResult<void>;
    const kind = this.is_subgraph ? "subgraph" : "digraph";
    const cluster = this.is_subgraph ? "cluster_" : ""; // Print border around graph
    // FIXME(richkadel): If/when migrating the MIR graphviz to this generic implementation,
    // prepend "Mir_" to the graphviz_safe_def_name(def_id)
    if ((r = w.write_fmt([`${kind} ${cluster}${this.graphviz_name} {\n`])).$ === "Err") return r;

    // Global graph properties
    const font = `fontname="${tcx.sess.opts.unstable_opts.graphviz_font}"`;
    const graph_attrs: string[] = [font];
    const content_attrs: string[] = [font];

    const dark_mode = tcx.sess.opts.unstable_opts.graphviz_dark_mode;
    if (dark_mode) {
      graph_attrs.push(`bgcolor="black"`);
      graph_attrs.push(`fontcolor="white"`);
      content_attrs.push(`color="white"`);
      content_attrs.push(`fontcolor="white"`);
    }

    if ((r = w.write_fmt([`    graph [${graph_attrs.join(" ")}];\n`])).$ === "Err") return r;
    const content_attrs_str = content_attrs.join(" ");
    if ((r = w.write_fmt([`    node [${content_attrs_str}];\n`])).$ === "Err") return r;
    if ((r = w.write_fmt([`    edge [${content_attrs_str}];\n`])).$ === "Err") return r;

    // Graph label
    if (this.graph_label !== undefined) {
      const graph_label = this.graph_label;
      if ((r = this.write_graph_label(graph_label, w)).$ === "Err") return r;
    }

    // Nodes
    for (const node of iterate.post_order_from(this.graph, this.graph.start_node())) {
      if ((r = this.write_node(node, dark_mode, w)).$ === "Err") return r;
    }

    // Edges
    for (const source of iterate.post_order_from(this.graph, this.graph.start_node())) {
      if ((r = this.write_edges(source, w)).$ === "Err") return r;
    }
    return w.write_fmt(["}\n"]);
  }

  /// Write a graphviz DOT node for the given node.
  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:96 write_node
  write_node(node: N, dark_mode: boolean, w: Write): IoResult<void> {
    let r: IoResult<void>;
    // Start a new node with the label to follow, in one of DOT's pseudo-HTML tables.
    if ((r = w.write_fmt([`    ${this.node(node)} [shape="none", label=<`])).$ === "Err") return r;

    if ((r = w.write_fmt([`<table border="0" cellborder="1" cellspacing="0">`])).$ === "Err") return r;

    // FIXME(richkadel): If/when migrating the MIR graphviz to this generic implementation,
    // we need generic way to know if node header should have a different color. For example,
    // for MIR:
    //
    // let (blk, bgcolor) = if data.is_cleanup {
    //     let color = if dark_mode { "royalblue" } else { "lightblue" };
    //     (format!("{:?} (cleanup)", node), color)
    // } else {
    //     let color = if dark_mode { "dimgray" } else { "gray" };
    //     (format!("{:?}", node), color)
    // };
    const color = dark_mode ? "dimgray" : "gray";
    const [blk, bgcolor] = [this.debug_node(node, PLAIN), color];
    const attrs = `align="center"`;
    const colspan = 1;
    if ((r = w.write_fmt([`<tr><td bgcolor="${bgcolor}" ${attrs} colspan="${colspan}">${blk}</td></tr>`])).$ === "Err") return r;

    for (const section of this.node_content_fn(node)) {
      if ((r = w.write_fmt([`<tr><td align="left" balign="left">${escape_html(section)}</td></tr>`])).$ === "Err") return r;
    }

    // Close the table
    if ((r = w.write_fmt(["</table>"])).$ === "Err") return r;

    // Close the node label and the node itself.
    return w.write_fmt([">];\n"]);
  }

  /// Write graphviz DOT edges with labels between the given node and all of its successors.
  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:143 write_edges
  write_edges(source: N, w: Write): IoResult<void> {
    let r: IoResult<void>;
    const edge_labels = this.edge_labels_fn(source);
    let index = 0;
    for (const target of this.graph.successors(source)) {
      const src = this.node(source);
      const trg = this.node(target);
      const edge_label = edge_labels[index];
      const escaped_edge_label = edge_label !== undefined ? escape_html(edge_label) : "";
      if ((r = w.write_fmt([`    ${src} -> ${trg} [label=<${escaped_edge_label}>];\n`])).$ === "Err") return r;
      index++;
    }
    return Ok(undefined);
  }

  /// Write the graphviz DOT label for the overall graph. This is essentially a block of text that
  /// will appear below the graph.
  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:163 write_graph_label
  write_graph_label(label: string, w: Write): IoResult<void> {
    const escaped_label = escape_html(label);
    return w.write_fmt([`    label=<<br/><br/>${escaped_label}<br align="left"/><br/><br/><br/>>;\n`]);
  }

  // rustc: compiler/rustc_middle/src/mir/generic_graphviz.rs:171 node
  node(node: N): string {
    return `${this.debug_node(node, PLAIN)}__${this.graphviz_name}`;
  }
}
