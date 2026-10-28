// Port of gsgdt 0.1.2, tests/test_multigraph.rs.
import { expect, test } from "bun:test";
import { VecU8 } from "../../anstream/stream.ts";
import { GraphvizSettings, MultiGraph } from "../lib.ts";
import { read_graph_from_file } from "./helpers.ts";

// crate: gsgdt-0.1.2/tests/test_multigraph.rs:6 test_multigraph_render
test("test_multigraph_render", () => {
  const g1 = read_graph_from_file("tests/small_graph.json");
  const g2 = read_graph_from_file("tests/small_graph.json");
  const settings = GraphvizSettings.default();

  const mg = MultiGraph.new("testgraph", [g1, g2]);
  const buf = new VecU8();
  const expected = `digraph testgraph {
subgraph cluster_small {
    bb0 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb0</td></tr><tr><td align="left" balign="left">StorageLive(_1)<br/></td></tr><tr><td align="left">_1 = Vec::&lt;i32&gt;::new()</td></tr></table>>];
    bb1 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb1</td></tr><tr><td align="left">resume</td></tr></table>>];
    bb0 -> bb1 [label="return"];
}
subgraph cluster_small {
    bb0 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb0</td></tr><tr><td align="left" balign="left">StorageLive(_1)<br/></td></tr><tr><td align="left">_1 = Vec::&lt;i32&gt;::new()</td></tr></table>>];
    bb1 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb1</td></tr><tr><td align="left">resume</td></tr></table>>];
    bb0 -> bb1 [label="return"];
}
}
`;
  expect(mg.to_dot(buf, settings).$).toBe("Ok");
  expect(new TextDecoder().decode(buf.bytes())).toBe(expected);
});
