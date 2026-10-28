// Port of gsgdt 0.1.2, tests/helpers.rs.
//
// PORT: `serde_json::from_str::<Graph>` is `JSON.parse` plus the construction of the classes from the derived
// field layout (the serde derives are not ported). The JSON fixture is the crate's tests/small_graph.json, copied.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Edge, Graph, Node, NodeStyle } from "../lib.ts";

interface NodeJson {
  stmts: string[];
  label: string;
  title: string;
  style: { title_bg: string | null; last_stmt_sep: boolean };
}
interface GraphJson {
  name: string;
  nodes: NodeJson[];
  edges: { from: string; to: string; label: string }[];
}

// crate: gsgdt-0.1.2/tests/helpers.rs:9 read_graph_from_file
export function read_graph_from_file(file: string): Graph {
  const contents = readFileSync(join(import.meta.dir, "..", file), "utf8");
  const g = JSON.parse(contents) as GraphJson;
  return new Graph(
    g.name,
    g.nodes.map((n) => new Node(n.stmts, n.label, n.title, new NodeStyle(n.style.title_bg ?? undefined, n.style.last_stmt_sep))),
    g.edges.map((e) => new Edge(e.from, e.to, e.label)),
  );
}
