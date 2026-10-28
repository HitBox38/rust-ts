// Port of gsgdt 0.1.2 (the version in upstream's Cargo.lock), src/node.rs.
//
// PORT: `#[derive(Serialize, Deserialize)]` (serde) is not ported: rustc never serializes these graphs. `W: Write`
// is vendor/anstream's `Write`; `write!(w, ..)` is `w.write_fmt([text])`.
import type { IoResult } from "../../std/io.ts";
import type { Write } from "../anstream/stream.ts";
import { escape_html } from "./util.ts";

/// NodeStyle defines some style of [Node](struct.Node.html)
export class NodeStyle {
  constructor(
    /// Override the title color of the title
    /// To color the title of the node differently in graphviz
    public title_bg: string | undefined,

    /// Print a seperator b/w the rest of the statements and the last one
    public last_stmt_sep: boolean,
  ) {}

  // crate: gsgdt-0.1.2/src/node.rs:17 default
  static default(): NodeStyle {
    return new NodeStyle(undefined, false);
  }
}

/// A graph node
export class Node {
  constructor(
    /// A list of statements.
    public stmts: string[],

    /// A unique identifier for the given node.
    public label: string,

    /// The title is printed on the top of BB, the index of the basic block
    public title: string,

    /// Can be used to override the default styles
    public style: NodeStyle,
  ) {}

  // crate: gsgdt-0.1.2/src/node.rs:42 new
  static new(stmts: string[], label: string, title: string, style: NodeStyle): Node {
    return new Node(stmts, label, title, style);
  }

  // crate: gsgdt-0.1.2/src/node.rs:51 to_dot
  to_dot(w: Write): IoResult<void> {
    let r: IoResult<void>;
    if ((r = w.write_fmt([`<table border="0" cellborder="1" cellspacing="0">`])).$ === "Err") return r;

    const color = this.style.title_bg;
    const bg_attr = color !== undefined ? `bgcolor="${color}"` : "";
    // TODO: Not sure what this is for (`colspan = 1`)
    if ((r = w.write_fmt([`<tr><td ${bg_attr} ${`align="center"`} colspan="${1}">${this.title}</td></tr>`])).$ === "Err") return r;

    const stmts_len = this.stmts.length;
    if (this.stmts.length !== 0) {
      if (this.stmts.length > 1) {
        if ((r = w.write_fmt([`<tr><td align="left" balign="left">`])).$ === "Err") return r;
        for (const statement of this.stmts.slice(0, stmts_len - 1)) {
          if ((r = w.write_fmt([`${escape_html(statement)}<br/>`])).$ === "Err") return r;
        }
        if ((r = w.write_fmt(["</td></tr>"])).$ === "Err") return r;
      }

      if (!this.style.last_stmt_sep) {
        if ((r = w.write_fmt([`<tr><td align="left">`])).$ === "Err") return r;
        if ((r = w.write_fmt([escape_html(this.stmts[stmts_len - 1]!)])).$ === "Err") return r;
      } else {
        if ((r = w.write_fmt([`<tr><td align="left" balign="left">`])).$ === "Err") return r;
        if ((r = w.write_fmt([escape_html(this.stmts[stmts_len - 1]!)])).$ === "Err") return r;
      }
      if ((r = w.write_fmt(["</td></tr>"])).$ === "Err") return r;
    }

    return w.write_fmt(["</table>"]);
  }
}

/// A directed graph edge
// PORT: `#[derive(Debug)]` is not ported (nothing formats an `Edge`).
export class Edge {
  constructor(
    /// The label of the source node of the edge.
    public from: string,

    /// The label of the target node of the edge.
    public to: string,

    /// The label (title) of the edge. This doesn't have to unique.
    // TODO: Rename this to title?
    public label: string,
  ) {}

  // crate: gsgdt-0.1.2/src/node.rs:107 new
  static new(from: string, to: string, label: string): Edge {
    return new Edge(from, to, label);
  }

  // crate: gsgdt-0.1.2/src/node.rs:111 to_dot
  to_dot(w: Write): IoResult<void> {
    return w.write_fmt([`    ${this.from} -> ${this.to} [label="${this.label}"];\n`]);
  }
}
