// Port of compiler/rustc_middle/src/mir/generic_graph.rs (lane driver-m4, wave 25).
//
// PORT (init order): as every mir/ module, this one starts with `import "./mod.ts"`; it is reached only through
// graphviz.ts (mod.rs's `mod generic_graph;` is private).
import "./mod.ts";
import { BasicBlock, type Body } from "./mod.ts";
import { debug_Statement, StringFmtWrite } from "./pretty.ts";
import { TerminatorKind } from "./syntax.ts";
import { CrateNum, DefIndex, type DefId } from "../../rustc_span/def_id.ts";
import { Edge, Graph, Node, NodeStyle } from "../../vendor/gsgdt/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";

/// Convert an MIR function into a gsgdt Graph
// rustc: compiler/rustc_middle/src/mir/generic_graph.rs:6 mir_fn_to_generic_graph
export function mir_fn_to_generic_graph(tcx: TyCtxt, body: Body): Graph {
  const def_id = body.source.def_id();
  const def_name = graphviz_safe_def_name(def_id);
  const graph_name = `Mir_${def_name}`;
  const dark_mode = tcx.sess.opts.unstable_opts.graphviz_dark_mode;

  // Nodes
  const blocks = body.basic_blocks.deref();
  const nodes: Node[] = blocks.map((_, block) => bb_to_graph_node(BasicBlock.from_usize(block), body, dark_mode));

  // Edges
  const edges: Edge[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const source = BasicBlock.from_usize(i);
    const def_id = body.source.def_id();
    const terminator = blocks[i]!.terminator_();
    const labels = TerminatorKind.fmt_successor_labels(terminator.kind);

    // `terminator.successors().zip(labels)`
    let j = 0;
    for (const target of terminator.successors()) {
      if (j >= labels.length) break;
      const label = labels[j++]!;
      const src = node(def_id, source);
      const trg = node(def_id, target);
      edges.push(Edge.new(src, trg, label));
    }
  }

  return Graph.new(graph_name, nodes, edges);
}

// rustc: compiler/rustc_middle/src/mir/generic_graph.rs:36 bb_to_graph_node
function bb_to_graph_node(block: BasicBlock, body: Body, dark_mode: boolean): Node {
  const def_id = body.source.def_id();
  const data = body.basic_blocks.deref()[BasicBlock.index(block)]!;
  const label = node(def_id, block);

  let title: string;
  let bgcolor: string;
  if (data.is_cleanup) {
    const color = dark_mode ? "royalblue" : "lightblue";
    [title, bgcolor] = [`${BasicBlock.index(block)} (cleanup)`, color];
  } else {
    const color = dark_mode ? "dimgray" : "gray";
    [title, bgcolor] = [`${BasicBlock.index(block)}`, color];
  }

  const default_ = NodeStyle.default();
  const style = new NodeStyle(bgcolor, default_.last_stmt_sep);
  const stmts: string[] = data.statements.map((x) => debug_Statement(x, PLAIN));

  // add the terminator to the stmts, gsgdt can print it out separately
  const terminator_head = new StringFmtWrite();
  if (TerminatorKind.fmt_head(data.terminator_().kind, terminator_head).$ === "Err") {
    panic("called `Result::unwrap()` on an `Err` value: Error");
  }
  stmts.push(terminator_head.buf);

  return Node.new(stmts, label, title, style);
}

// Must match `[0-9A-Za-z_]*`. This does not appear in the rendered graph, so
// it does not have to be user friendly.
// rustc: compiler/rustc_middle/src/mir/generic_graph.rs:62 graphviz_safe_def_name
export function graphviz_safe_def_name(def_id: DefId): string {
  return `${CrateNum.index(def_id.krate)}_${DefIndex.index(def_id.index)}`;
}

// rustc: compiler/rustc_middle/src/mir/generic_graph.rs:66 node
function node(def_id: DefId, block: BasicBlock): string {
  return `bb${BasicBlock.index(block)}__${graphviz_safe_def_name(def_id)}`;
}
