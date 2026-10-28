// Port of compiler/rustc_graphviz/src/tests.rs (lane driver-m4, wave 25).
//
// PORT: the `Labeller` / `GraphWalk` impls of `LabelledGraph` and `LabelledGraphWithEscStrs` are methods of the two
// classes; `Edge`s are referenced as objects (`&'a Edge`).
import { expect, test } from "bun:test";
import { panic } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import { VecU8 } from "../vendor/anstream/stream.ts";
import { type Edges, type GraphWalk, Id, type LabelText, type Labeller, type Nodes, render, type Style } from "./lib.ts";

/// each node is an index in a vector in the graph.
type Node = number;
interface Edge {
  from: number;
  to: number;
  label: string;
  style: Style;
}

// rustc: compiler/rustc_graphviz/src/tests.rs:18 edge
function edge(from: number, to: number, label: string, style: Style): Edge {
  return { from, to, label, style };
}

type NodeLabels<L> =
  | { readonly $: "AllNodesLabelled"; readonly _0: L[] }
  | { readonly $: "UnlabelledNodes"; readonly _0: number }
  | { readonly $: "SomeNodesLabelled"; readonly _0: (L | undefined)[] };

type Trivial = NodeLabels<string>;

const NodeLabels = {
  // rustc: compiler/rustc_graphviz/src/tests.rs:57 to_opt_strs
  to_opt_strs(self: NodeLabels<string>): (string | undefined)[] {
    switch (self.$) {
      case "UnlabelledNodes":
        return new Array<string | undefined>(self._0).fill(undefined);
      case "AllNodesLabelled":
        return self._0.map((l) => l);
      case "SomeNodesLabelled":
        return self._0;
    }
  },

  // rustc: compiler/rustc_graphviz/src/tests.rs:65 len
  len(self: NodeLabels<string>): number {
    switch (self.$) {
      case "UnlabelledNodes":
        return self._0;
      case "AllNodesLabelled":
        return self._0.length;
      case "SomeNodesLabelled":
        return self._0.length;
    }
  },
} as const;

class LabelledGraph implements Labeller<Node, Edge>, GraphWalk<Node, Edge> {
  constructor(
    /// The name for this graph. Used for labeling generated `digraph`.
    public name: string,
    /// Each node is an index into `node_labels`; these labels are
    /// used as the label text for each node. (The node *names*,
    /// which are unique identifiers, are derived from their index
    /// in this array.)
    ///
    /// If a node maps to None here, then just use its name as its
    /// text.
    public node_labels: (string | undefined)[],
    public node_styles: Style[],
    /// Each edge relates a from-index to a to-index along with a
    /// label; `edges` collects them.
    public edges_: Edge[],
  ) {}

  // rustc: compiler/rustc_graphviz/src/tests.rs:75 new
  static new(name: string, node_labels: Trivial, edges: Edge[], node_styles: Style[] | undefined): LabelledGraph {
    const count = NodeLabels.len(node_labels);
    return new LabelledGraph(name, NodeLabels.to_opt_strs(node_labels), node_styles !== undefined ? node_styles : new Array<Style>(count).fill("None"), edges);
  }

  // rustc: compiler/rustc_graphviz/src/tests.rs:107 graph_id
  graph_id(): Id {
    return unwrap_result(Id.new(this.name));
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:110 node_id
  node_id(n: Node): Id {
    return id_name(n);
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:113 node_label
  node_label(n: Node): LabelText {
    const l = this.node_labels[n];
    if (l !== undefined) return { $: "LabelStr", _0: l };
    return { $: "LabelStr", _0: id_name(n).name };
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:119 edge_label
  edge_label(e: Edge): LabelText {
    return { $: "LabelStr", _0: e.label };
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:122 node_style
  node_style(n: Node): Style {
    return this.node_styles[n]!;
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:125 edge_style
  edge_style(e: Edge): Style {
    return e.style;
  }

  // rustc: compiler/rustc_graphviz/src/tests.rs:154 nodes
  nodes(): Nodes<Node> {
    return Array.from({ length: this.node_labels.length }, (_, i) => i);
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:157 edges
  edges(): Edges<Edge> {
    return [...this.edges_];
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:160 source
  source(edge: Edge): Node {
    return edge.from;
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:163 target
  target(edge: Edge): Node {
    return edge.to;
  }
}

// A simple wrapper around LabelledGraph that forces the labels to
// be emitted as EscStr.
class LabelledGraphWithEscStrs implements Labeller<Node, Edge>, GraphWalk<Node, Edge> {
  constructor(public graph: LabelledGraph) {}

  // rustc: compiler/rustc_graphviz/src/tests.rs:95 new
  static new(name: string, node_labels: Trivial, edges: Edge[]): LabelledGraphWithEscStrs {
    return new LabelledGraphWithEscStrs(LabelledGraph.new(name, node_labels, edges, undefined));
  }

  // rustc: compiler/rustc_graphviz/src/tests.rs:133 graph_id
  graph_id(): Id {
    return this.graph.graph_id();
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:136 node_id
  node_id(n: Node): Id {
    return this.graph.node_id(n);
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:139 node_label
  node_label(n: Node): LabelText {
    return { $: "EscStr", _0: this.graph.node_label(n)._0 };
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:144 edge_label
  edge_label(e: Edge): LabelText {
    return { $: "EscStr", _0: this.graph.edge_label(e)._0 };
  }

  // rustc: compiler/rustc_graphviz/src/tests.rs:171 nodes
  nodes(): Nodes<Node> {
    return this.graph.nodes();
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:174 edges
  edges(): Edges<Edge> {
    return this.graph.edges();
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:177 source
  source(edge: Edge): Node {
    return edge.from;
  }
  // rustc: compiler/rustc_graphviz/src/tests.rs:180 target
  target(edge: Edge): Node {
    return edge.to;
  }
}

// rustc: compiler/rustc_graphviz/src/tests.rs:100 id_name
function id_name(n: Node): Id {
  return unwrap_result(Id.new(`N${n}`));
}

// rustc: compiler/rustc_graphviz/src/tests.rs:185 test_input
function test_input(g: LabelledGraph): string {
  const writer = new VecU8();
  unwrap_result(render(g, writer));
  return new TextDecoder().decode(writer.bytes());
}

// All of the tests use raw-strings as the format for the expected outputs,
// so that you can cut-and-paste the content into a .dot file yourself to
// see what the graphviz visualizer would produce.

// rustc: compiler/rustc_graphviz/src/tests.rs:198 empty_graph
test("empty_graph", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 0 };
  const r = test_input(LabelledGraph.new("empty_graph", labels, [], undefined));
  expect(r).toBe(`digraph empty_graph {
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:210 single_node
test("single_node", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 1 };
  const r = test_input(LabelledGraph.new("single_node", labels, [], undefined));
  expect(r).toBe(`digraph single_node {
    N0[label="N0"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:223 single_node_with_style
test("single_node_with_style", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 1 };
  const styles: Style[] = ["Dashed"];
  const r = test_input(LabelledGraph.new("single_node", labels, [], styles));
  expect(r).toBe(`digraph single_node {
    N0[label="N0"][style="dashed"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:237 single_edge
test("single_edge", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 2 };
  const result = test_input(LabelledGraph.new("single_edge", labels, [edge(0, 1, "E", "None")], undefined));
  expect(result).toBe(`digraph single_edge {
    N0[label="N0"];
    N1[label="N1"];
    N0 -> N1[label="E"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:257 single_edge_with_style
test("single_edge_with_style", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 2 };
  const result = test_input(LabelledGraph.new("single_edge", labels, [edge(0, 1, "E", "Bold")], undefined));
  expect(result).toBe(`digraph single_edge {
    N0[label="N0"];
    N1[label="N1"];
    N0 -> N1[label="E"][style="bold"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:277 test_some_labelled
test("test_some_labelled", () => {
  const labels: Trivial = { $: "SomeNodesLabelled", _0: ["A", undefined] };
  const styles: Style[] = ["None", "Dotted"];
  const result = test_input(LabelledGraph.new("test_some_labelled", labels, [edge(0, 1, "A-1", "None")], styles));
  expect(result).toBe(`digraph test_some_labelled {
    N0[label="A"];
    N1[label="N1"][style="dotted"];
    N0 -> N1[label="A-1"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:298 single_cyclic_node
test("single_cyclic_node", () => {
  const labels: Trivial = { $: "UnlabelledNodes", _0: 1 };
  const r = test_input(LabelledGraph.new("single_cyclic_node", labels, [edge(0, 0, "E", "None")], undefined));
  expect(r).toBe(`digraph single_cyclic_node {
    N0[label="N0"];
    N0 -> N0[label="E"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:317 hasse_diagram
test("hasse_diagram", () => {
  const labels: Trivial = { $: "AllNodesLabelled", _0: ["{x,y}", "{x}", "{y}", "{}"] };
  const r = test_input(
    LabelledGraph.new("hasse_diagram", labels, [edge(0, 1, "", "None"), edge(0, 2, "", "None"), edge(1, 3, "", "None"), edge(2, 3, "", "None")], undefined),
  );
  expect(r).toBe(`digraph hasse_diagram {
    N0[label="{x,y}"];
    N1[label="{x}"];
    N2[label="{y}"];
    N3[label="{}"];
    N0 -> N1[label=""];
    N0 -> N2[label=""];
    N1 -> N3[label=""];
    N2 -> N3[label=""];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:347 left_aligned_text
test("left_aligned_text", () => {
  const labels: Trivial = {
    $: "AllNodesLabelled",
    _0: ["if test {\\l    branch1\\l} else {\\l    branch2\\l}\\lafterward\\l", "branch1", "branch2", "afterward"],
  };

  const writer = new VecU8();

  const g = LabelledGraphWithEscStrs.new("syntax_tree", labels, [edge(0, 1, "then", "None"), edge(0, 2, "else", "None"), edge(1, 3, ";", "None"), edge(2, 3, ";", "None")]);

  unwrap_result(render(g, writer));
  const r = new TextDecoder().decode(writer.bytes());

  expect(r).toBe(String.raw`digraph syntax_tree {
    N0[label="if test {\l    branch1\l} else {\l    branch2\l}\lafterward\l"];
    N1[label="branch1"];
    N2[label="branch2"];
    N3[label="afterward"];
    N0 -> N1[label="then"];
    N0 -> N2[label="else"];
    N1 -> N3[label=";"];
    N2 -> N3[label=";"];
}
`);
});

// rustc: compiler/rustc_graphviz/src/tests.rs:395 simple_id_construction
test("simple_id_construction", () => {
  const id1 = Id.new("hello");
  if (id1.$ === "Err") panic("'hello' is not a valid value for id anymore");
});

// rustc: compiler/rustc_graphviz/src/tests.rs:404 badly_formatted_id
test("badly_formatted_id", () => {
  const id2 = Id.new("Weird { struct : ure } !!!");
  if (id2.$ === "Ok") panic("graphviz id suddenly allows spaces, brackets and stuff");
});
