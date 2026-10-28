// Port of gsgdt 0.1.2 (the version in upstream's Cargo.lock), src/multi_graph.rs.
//
// PORT: `#[derive(Deserialize, Serialize)]` (serde) is not ported.
import type { IoResult } from "../../std/io.ts";
import { Ok } from "../../std/result.ts";
import type { Write } from "../anstream/stream.ts";
import type { Graph, GraphvizSettings } from "./graph.ts";

/// A collection of graphs.
export class MultiGraph {
  constructor(
    public name: string,
    public graphs: Graph[],
  ) {}

  // crate: gsgdt-0.1.2/src/multi_graph.rs:13 new
  static new(name: string, graphs: Graph[]): MultiGraph {
    return new MultiGraph(name, graphs);
  }

  // crate: gsgdt-0.1.2/src/multi_graph.rs:17 to_dot
  to_dot(w: Write, settings: GraphvizSettings): IoResult<void> {
    let r: IoResult<void>;
    const subgraphs = this.graphs.length > 1;
    if (subgraphs) {
      if ((r = w.write_fmt([`digraph ${this.name} {\n`])).$ === "Err") return r;
    }

    for (const graph of this.graphs) {
      if ((r = graph.to_dot(w, settings, subgraphs)).$ === "Err") return r;
    }

    if (subgraphs) {
      if ((r = w.write_fmt(["}\n"])).$ === "Err") return r;
    }

    return Ok(undefined);
  }
}
