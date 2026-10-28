// Port of gsgdt 0.1.2, tests/test_graph.rs.
import { expect, test } from "bun:test";
import { VecU8 } from "../../anstream/stream.ts";
import { GraphvizSettings } from "../lib.ts";
import { read_graph_from_file } from "./helpers.ts";

// crate: gsgdt-0.1.2/tests/test_graph.rs:6 test_graph_render
test("test_graph_render", () => {
  const g1 = read_graph_from_file("tests/small_graph.json");
  const settings = GraphvizSettings.default();
  const buf = new VecU8();
  const expected = `digraph small {
    bb0 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb0</td></tr><tr><td align="left" balign="left">StorageLive(_1)<br/></td></tr><tr><td align="left">_1 = Vec::&lt;i32&gt;::new()</td></tr></table>>];
    bb1 [shape="none", label=<<table border="0" cellborder="1" cellspacing="0"><tr><td  align="center" colspan="1">bb1</td></tr><tr><td align="left">resume</td></tr></table>>];
    bb0 -> bb1 [label="return"];
}
`;
  expect(g1.to_dot(buf, settings, false).$).toBe("Ok");
  expect(new TextDecoder().decode(buf.bytes())).toBe(expected);
});
