// Port of gsgdt 0.1.2 (the version in upstream's Cargo.lock), src/graph.rs.
//
// PORT: `#[derive(Serialize, Deserialize)]` (serde) is not ported: rustc never serializes these graphs.
// `AdjList<'a>` (`HashMap<&str, Vec<&str>>`) is a `Map<string, string[]>`.
import type { IoResult } from "../../std/io.ts";
import type { Write } from "../anstream/stream.ts";
import type { Edge, Node } from "./node.ts";

export type GraphKind = "Digraph" | "Subgraph";
export const GraphKind = { Digraph: "Digraph", Subgraph: "Subgraph" } as const;

export type AdjList = Map<string, string[]>;

/// Graph represents a directed graph as a list of nodes and list of edges.
export class Graph {
  constructor(
    /// Identifier for the graph
    public name: string,

    /// The Vector containing the Nodes
    public nodes: Node[],

    /// The Vector containing the Edges
    public edges: Edge[],
  ) {}

  // crate: gsgdt-0.1.2/src/graph.rs:55 new
  static new(name: string, nodes: Node[], edges: Edge[]): Graph {
    return new Graph(name, nodes, edges);
  }

  /// Returns the adjacency list representation of the graph.
  /// Adjacency list can be used to easily find the childern of a given node.
  /// If the a node does not have any childern, then the list correspoding to that node
  /// will be empty.
  // crate: gsgdt-0.1.2/src/graph.rs:63 adj_list
  adj_list(): AdjList {
    const m: AdjList = new Map();
    for (const node of this.nodes) {
      m.set(node.label, []);
    }
    for (const edge of this.edges) {
      let v = m.get(edge.from);
      if (v === undefined) m.set(edge.from, (v = []));
      v.push(edge.to);
    }
    return m;
  }

  /// Returns the reverse adjacency list representation of the graph.
  /// Reverse adjacency list represents the adjacency list of a directed graph where
  /// the edges have been reversed.
  /// Reverse adjacency list can be used to easily find the parents of a given node.
  /// If the a node does not have any childern, then the list correspoding to that node
  /// will be empty.
  // crate: gsgdt-0.1.2/src/graph.rs:80 rev_adj_list
  rev_adj_list(): AdjList {
    const m: AdjList = new Map();
    for (const node of this.nodes) {
      m.set(node.label, []);
    }
    for (const edge of this.edges) {
      let v = m.get(edge.to);
      if (v === undefined) m.set(edge.to, (v = []));
      v.push(edge.from);
    }
    return m;
  }

  /// Returns the node with the given label, if found.
  // crate: gsgdt-0.1.2/src/graph.rs:92 get_node_by_label
  get_node_by_label(label: string): Node | undefined {
    return this.nodes.find((node) => node.label === label);
  }

  /// Returns the dot representation of the given graph.
  /// This can rendered using the graphviz program.
  // crate: gsgdt-0.1.2/src/graph.rs:98 to_dot
  to_dot(w: Write, settings: GraphvizSettings, as_subgraph: boolean): IoResult<void> {
    let r: IoResult<void>;
    if (as_subgraph) {
      if ((r = w.write_fmt([`subgraph cluster_${this.name}`])).$ === "Err") return r;
    } else {
      if ((r = w.write_fmt([`digraph ${this.name}`])).$ === "Err") return r;
    }

    if ((r = w.write_fmt([" {\n"])).$ === "Err") return r;

    const graph_attrs = settings.graph_attrs;
    if (graph_attrs !== undefined) {
      if ((r = w.write_fmt([`    graph [${graph_attrs}];\n`])).$ === "Err") return r;
    }
    const node_attrs = settings.node_attrs;
    if (node_attrs !== undefined) {
      if ((r = w.write_fmt([`    node [${node_attrs}];\n`])).$ === "Err") return r;
    }
    const edge_attrs = settings.edge_attrs;
    if (edge_attrs !== undefined) {
      if ((r = w.write_fmt([`    edge [${edge_attrs}];\n`])).$ === "Err") return r;
    }
    const label = settings.graph_label;
    if (label !== undefined) {
      if ((r = w.write_fmt([`    label=<${label}>;\n`])).$ === "Err") return r;
    }

    for (const node of this.nodes) {
      if ((r = w.write_fmt([`    ${node.label} [shape="none", label=<`])).$ === "Err") return r;
      if ((r = node.to_dot(w)).$ === "Err") return r;
      if ((r = w.write_fmt([">];\n"])).$ === "Err") return r;
    }

    for (const edge of this.edges) {
      if ((r = edge.to_dot(w)).$ === "Err") return r;
    }

    return w.write_fmt(["}\n"]);
  }
}

export class GraphvizSettings {
  constructor(
    /// The attributes of the graph in graphviz.
    public graph_attrs: string | undefined,

    /// The attributes of the nodes in graphviz.
    public node_attrs: string | undefined,

    /// The attributes of the edges in graphviz.
    public edge_attrs: string | undefined,

    /// Label of the graph
    public graph_label: string | undefined,
  ) {}

  // crate: gsgdt-0.1.2/src/graph.rs:44 default
  static default(): GraphvizSettings {
    return new GraphvizSettings(undefined, undefined, undefined, undefined);
  }
}
