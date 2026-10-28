// Port of the `#[cfg(test)] mod tests` of gsgdt 0.1.2, src/graph.rs.
import { expect, test } from "bun:test";
import { Edge, Graph, Node, NodeStyle } from "./lib.ts";

// crate: gsgdt-0.1.2/src/graph.rs:142 get_test_graph
function get_test_graph(): Graph {
  let stmts: string[] = ["hi", "hell"];
  const label1 = "bb0__0_3";
  const style = NodeStyle.default();
  const node1 = Node.new(stmts, label1, "0", new NodeStyle(style.title_bg, style.last_stmt_sep));

  stmts = ["_1 = const 1_i32", "_2 = const 2_i32"];
  const label2 = "bb0__1_3";
  const node2 = Node.new(stmts, label2, "1", new NodeStyle(style.title_bg, style.last_stmt_sep));

  return Graph.new("Mir_0_3", [node1, node2], [Edge.new(label1, label2, "return")]);
}

// crate: gsgdt-0.1.2/src/graph.rs:160 test_adj_list
test("test_adj_list", () => {
  const g = get_test_graph();
  const adj_list = g.adj_list();
  const expected = new Map<string, string[]>([
    ["bb0__0_3", ["bb0__1_3"]],
    ["bb0__1_3", []],
  ]);
  expect(adj_list).toEqual(expected);
});

// crate-skip: gsgdt-0.1.2/src/graph.rs:171 test_json_ser serde_json serialization (serde derives are not ported)
// crate-skip: gsgdt-0.1.2/src/graph.rs:216 test_json_deser serde_json deserialization (serde derives are not ported)

// Not upstream: a rendering check of `Graph::to_dot` as `-Zunpretty=mir-cfg` uses it.
test("to_dot (subgraph, settings, cleanup style)", async () => {
  const { VecU8 } = await import("../anstream/stream.ts");
  const { GraphvizSettings } = await import("./graph.ts");
  const g = get_test_graph();
  g.nodes[0]!.style.title_bg = "gray";
  const w = new VecU8();
  const r = g.to_dot(w, new GraphvizSettings(`fontname="Courier, monospace"`, undefined, undefined, "fn f() -&gt; ()"), true);
  expect(r.$).toBe("Ok");
  expect(new TextDecoder().decode(w.bytes())).toBe(
    `subgraph cluster_Mir_0_3 {
    graph [fontname="Courier, monospace"];
    label=<fn f() -&gt; ()>;
    bb0__0_3 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td bgcolor="gray" align="center" colspan="1">0</td></tr><tr><td align="left" balign="left">hi<br/></td></tr><tr><td align="left">hell</td></tr></table>>];
    bb0__1_3 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">1</td></tr><tr><td align="left" balign="left">_1 = const 1_i32<br/></td></tr><tr><td align="left">_2 = const 2_i32</td></tr></table>>];
    bb0__0_3 -> bb0__1_3 [label="return"];
}
`,
  );
});
