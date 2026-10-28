// Port of compiler/rustc_graphviz/src/lib.rs (lane driver-m4, wave 25).
//
// PORT: `Cow<'a, str>` is `string`; `Nodes<'a, N>` / `Edges<'a, E>` (`Cow<'a, [N]>`) are `readonly N[]`. The traits `Labeller` and
// `GraphWalk` are interfaces generic over their associated `Node` / `Edge` types; `Labeller`'s provided methods are
// optional members with their defaults in `Labeller_provided` (PORTING §8). `W: io::Write` is vendor/anstream's `Write`.
//! Generate files suitable for use with [Graphviz](https://www.graphviz.org/)
//!
//! The `render` function generates output (e.g., an `output.dot` file) for
//! use with [Graphviz](https://www.graphviz.org/) by walking a labeled
//! graph. (Graphviz can then automatically lay out the nodes and edges
//! of the graph, and also optionally render the graph as an image or
//! other [output formats](https://www.graphviz.org/docs/outputs), such as SVG.)
//!
//! Rather than impose some particular graph data structure on clients,
//! this library exposes two traits that clients can implement on their
//! own structs before handing them over to the rendering function.
//!
//! Note: This library does not yet provide access to the full
//! expressiveness of the [DOT language](https://www.graphviz.org/doc/info/lang.html).
//! For example, there are many [attributes](https://www.graphviz.org/doc/info/attrs.html)
//! related to providing layout hints (e.g., left-to-right versus top-down, which
//! algorithm to use, etc). The current intention of this library is to
//! emit a human-readable .dot file with very regular structure suitable
//! for easy post-processing.
//!
//! # Examples
//!
//! The first example uses a very simple graph representation: a list of
//! pairs of ints, representing the edges (the node set is implicit).
//! Each node label is derived directly from the int representing the node,
//! while the edge labels are all empty strings.
//!
//! This example also illustrates how to use `Cow<[T]>` to return
//! an owned vector or a borrowed slice as appropriate: we construct the
//! node vector from scratch, but borrow the edge list (rather than
//! constructing a copy of all the edges from scratch).
//!
//! The output from this example renders five nodes, with the first four
//! forming a diamond-shaped acyclic graph and then pointing to the fifth
//! which is cyclic.
//!
//! ```rust
//! #![feature(rustc_private)]
//!
//! use std::io::Write;
//! use rustc_graphviz as dot;
//!
//! type Nd = isize;
//! type Ed = (isize,isize);
//! struct Edges(Vec<Ed>);
//!
//! pub fn render_to<W: Write>(output: &mut W) {
//!     let edges = Edges(vec![(0,1), (0,2), (1,3), (2,3), (3,4), (4,4)]);
//!     dot::render(&edges, output).unwrap()
//! }
//!
//! impl<'a> dot::Labeller<'a> for Edges {
//!     type Node = Nd;
//!     type Edge = Ed;
//!     fn graph_id(&'a self) -> dot::Id<'a> { dot::Id::new("example1").unwrap() }
//!
//!     fn node_id(&'a self, n: &Nd) -> dot::Id<'a> {
//!         dot::Id::new(format!("N{}", *n)).unwrap()
//!     }
//! }
//!
//! impl<'a> dot::GraphWalk<'a> for Edges {
//!     type Node = Nd;
//!     type Edge = Ed;
//!     fn nodes(&self) -> dot::Nodes<'a,Nd> {
//!         // (assumes that |N| \approxeq |E|)
//!         let &Edges(ref v) = self;
//!         let mut nodes = Vec::with_capacity(v.len());
//!         for &(s,t) in v {
//!             nodes.push(s); nodes.push(t);
//!         }
//!         nodes.sort();
//!         nodes.dedup();
//!         nodes.into()
//!     }
//!
//!     fn edges(&'a self) -> dot::Edges<'a,Ed> {
//!         let &Edges(ref edges) = self;
//!         (&edges[..]).into()
//!     }
//!
//!     fn source(&self, e: &Ed) -> Nd { let &(s,_) = e; s }
//!
//!     fn target(&self, e: &Ed) -> Nd { let &(_,t) = e; t }
//! }
//!
//! # pub fn main() { render_to(&mut Vec::new()) }
//! ```
//!
//! ```no_run
//! # pub fn render_to<W:std::io::Write>(output: &mut W) { unimplemented!() }
//! pub fn main() {
//!     use std::fs::File;
//!     let mut f = File::create("example1.dot").unwrap();
//!     render_to(&mut f)
//! }
//! ```
//!
//! Output from first example (in `example1.dot`):
//!
//! ```dot
//! digraph example1 {
//!     N0[label="N0"];
//!     N1[label="N1"];
//!     N2[label="N2"];
//!     N3[label="N3"];
//!     N4[label="N4"];
//!     N0 -> N1[label=""];
//!     N0 -> N2[label=""];
//!     N1 -> N3[label=""];
//!     N2 -> N3[label=""];
//!     N3 -> N4[label=""];
//!     N4 -> N4[label=""];
//! }
//! ```
//!
//! The second example illustrates using `node_label` and `edge_label` to
//! add labels to the nodes and edges in the rendered graph. The graph
//! here carries both `nodes` (the label text to use for rendering a
//! particular node), and `edges` (again a list of `(source,target)`
//! indices).
//!
//! This example also illustrates how to use a type (in this case the edge
//! type) that shares substructure with the graph: the edge type here is a
//! direct reference to the `(source,target)` pair stored in the graph's
//! internal vector (rather than passing around a copy of the pair
//! itself). Note that this implies that `fn edges(&'a self)` must
//! construct a fresh `Vec<&'a (usize,usize)>` from the `Vec<(usize,usize)>`
//! edges stored in `self`.
//!
//! Since both the set of nodes and the set of edges are always
//! constructed from scratch via iterators, we use the `collect()` method
//! from the `Iterator` trait to collect the nodes and edges into freshly
//! constructed growable `Vec` values (rather than using `Cow` as in the
//! first example above).
//!
//! The output from this example renders four nodes that make up the
//! Hasse-diagram for the subsets of the set `{x, y}`. Each edge is
//! labeled with the &sube; character (specified using the HTML character
//! entity `&sube`).
//!
//! ```rust
//! #![feature(rustc_private)]
//!
//! use std::io::Write;
//! use rustc_graphviz as dot;
//!
//! type Nd = usize;
//! type Ed<'a> = &'a (usize, usize);
//! struct Graph { nodes: Vec<&'static str>, edges: Vec<(usize,usize)> }
//!
//! pub fn render_to<W: Write>(output: &mut W) {
//!     let nodes = vec!["{x,y}","{x}","{y}","{}"];
//!     let edges = vec![(0,1), (0,2), (1,3), (2,3)];
//!     let graph = Graph { nodes: nodes, edges: edges };
//!
//!     dot::render(&graph, output).unwrap()
//! }
//!
//! impl<'a> dot::Labeller<'a> for Graph {
//!     type Node = Nd;
//!     type Edge = Ed<'a>;
//!     fn graph_id(&'a self) -> dot::Id<'a> { dot::Id::new("example2").unwrap() }
//!     fn node_id(&'a self, n: &Nd) -> dot::Id<'a> {
//!         dot::Id::new(format!("N{}", n)).unwrap()
//!     }
//!     fn node_label(&self, n: &Nd) -> dot::LabelText<'_> {
//!         dot::LabelText::LabelStr(self.nodes[*n].into())
//!     }
//!     fn edge_label(&self, _: &Ed<'_>) -> dot::LabelText<'_> {
//!         dot::LabelText::LabelStr("&sube;".into())
//!     }
//! }
//!
//! impl<'a> dot::GraphWalk<'a> for Graph {
//!     type Node = Nd;
//!     type Edge = Ed<'a>;
//!     fn nodes(&self) -> dot::Nodes<'a,Nd> { (0..self.nodes.len()).collect() }
//!     fn edges(&'a self) -> dot::Edges<'a,Ed<'a>> { self.edges.iter().collect() }
//!     fn source(&self, e: &Ed<'_>) -> Nd { let & &(s,_) = e; s }
//!     fn target(&self, e: &Ed<'_>) -> Nd { let & &(_,t) = e; t }
//! }
//!
//! # pub fn main() { render_to(&mut Vec::new()) }
//! ```
//!
//! ```no_run
//! # pub fn render_to<W:std::io::Write>(output: &mut W) { unimplemented!() }
//! pub fn main() {
//!     use std::fs::File;
//!     let mut f = File::create("example2.dot").unwrap();
//!     render_to(&mut f)
//! }
//! ```
//!
//! The third example is similar to the second, except now each node and
//! edge now carries a reference to the string label for each node as well
//! as that node's index. (This is another illustration of how to share
//! structure with the graph itself, and why one might want to do so.)
//!
//! The output from this example is the same as the second example: the
//! Hasse-diagram for the subsets of the set `{x, y}`.
//!
//! ```rust
//! #![feature(rustc_private)]
//!
//! use std::io::Write;
//! use rustc_graphviz as dot;
//!
//! type Nd<'a> = (usize, &'a str);
//! type Ed<'a> = (Nd<'a>, Nd<'a>);
//! struct Graph { nodes: Vec<&'static str>, edges: Vec<(usize,usize)> }
//!
//! pub fn render_to<W: Write>(output: &mut W) {
//!     let nodes = vec!["{x,y}","{x}","{y}","{}"];
//!     let edges = vec![(0,1), (0,2), (1,3), (2,3)];
//!     let graph = Graph { nodes: nodes, edges: edges };
//!
//!     dot::render(&graph, output).unwrap()
//! }
//!
//! impl<'a> dot::Labeller<'a> for Graph {
//!     type Node = Nd<'a>;
//!     type Edge = Ed<'a>;
//!     fn graph_id(&'a self) -> dot::Id<'a> { dot::Id::new("example3").unwrap() }
//!     fn node_id(&'a self, n: &Nd<'a>) -> dot::Id<'a> {
//!         dot::Id::new(format!("N{}", n.0)).unwrap()
//!     }
//!     fn node_label(&self, n: &Nd<'_>) -> dot::LabelText<'_> {
//!         let &(i, _) = n;
//!         dot::LabelText::LabelStr(self.nodes[i].into())
//!     }
//!     fn edge_label(&self, _: &Ed<'_>) -> dot::LabelText<'_> {
//!         dot::LabelText::LabelStr("&sube;".into())
//!     }
//! }
//!
//! impl<'a> dot::GraphWalk<'a> for Graph {
//!     type Node = Nd<'a>;
//!     type Edge = Ed<'a>;
//!     fn nodes(&'a self) -> dot::Nodes<'a,Nd<'a>> {
//!         self.nodes.iter().map(|s| &s[..]).enumerate().collect()
//!     }
//!     fn edges(&'a self) -> dot::Edges<'a,Ed<'a>> {
//!         self.edges.iter()
//!             .map(|&(i,j)|((i, &self.nodes[i][..]),
//!                           (j, &self.nodes[j][..])))
//!             .collect()
//!     }
//!     fn source(&self, e: &Ed<'a>) -> Nd<'a> { let &(s,_) = e; s }
//!     fn target(&self, e: &Ed<'a>) -> Nd<'a> { let &(_,t) = e; t }
//! }
//!
//! # pub fn main() { render_to(&mut Vec::new()) }
//! ```
//!
//! ```no_run
//! # pub fn render_to<W:std::io::Write>(output: &mut W) { unimplemented!() }
//! pub fn main() {
//!     use std::fs::File;
//!     let mut f = File::create("example3.dot").unwrap();
//!     render_to(&mut f)
//! }
//! ```
//!
//! # References
//!
//! * [Graphviz](https://www.graphviz.org/)
//!
//! * [DOT language](https://www.graphviz.org/doc/info/lang.html)

// tidy-alphabetical-start
// #![doc(test(attr(allow(unused_variables), deny(warnings))))]
// tidy-alphabetical-end

import { is_ascii_alphabetic, is_ascii_alphanumeric } from "../std/char.ts";
import type { IoResult } from "../std/io.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { Write } from "../vendor/anstream/stream.ts";

// use LabelText::*;

/// The text for a graphviz label on a node or edge.
export type LabelText =
  /// This kind of label preserves the text directly as is.
  ///
  /// Occurrences of backslashes (`\`) are escaped, and thus appear
  /// as backslashes in the rendered label.
  | { readonly $: "LabelStr"; readonly _0: string }
  /// This kind of label uses the graphviz label escString type:
  /// <https://www.graphviz.org/docs/attr-types/escString>
  ///
  /// Occurrences of backslashes (`\`) are not escaped; instead they
  /// are interpreted as initiating an escString escape sequence.
  ///
  /// Escape sequences of particular interest: in addition to `\n`
  /// to break a line (centering the line preceding the `\n`), there
  /// are also the escape sequences `\l` which left-justifies the
  /// preceding line and `\r` which right-justifies it.
  | { readonly $: "EscStr"; readonly _0: string }
  /// This uses a graphviz [HTML string label][html]. The string is
  /// printed exactly as given, but between `<` and `>`. **No
  /// escaping is performed.**
  ///
  /// [html]: https://www.graphviz.org/doc/info/shapes.html#html
  | { readonly $: "HtmlStr"; readonly _0: string };

/// The style for a node or edge.
/// See <https://www.graphviz.org/docs/attr-types/style/> for descriptions.
/// Note that some of these are not valid for edges.
export type Style = "None" | "Solid" | "Dashed" | "Dotted" | "Bold" | "Rounded" | "Diagonals" | "Filled" | "Striped" | "Wedged";
export const Style = {
  None: "None",
  Solid: "Solid",
  Dashed: "Dashed",
  Dotted: "Dotted",
  Bold: "Bold",
  Rounded: "Rounded",
  Diagonals: "Diagonals",
  Filled: "Filled",
  Striped: "Striped",
  Wedged: "Wedged",

  // rustc: compiler/rustc_graphviz/src/lib.rs:328 as_slice
  as_slice(self: Style): string {
    switch (self) {
      case "None":
        return "";
      case "Solid":
        return "solid";
      case "Dashed":
        return "dashed";
      case "Dotted":
        return "dotted";
      case "Bold":
        return "bold";
      case "Rounded":
        return "rounded";
      case "Diagonals":
        return "diagonals";
      case "Filled":
        return "filled";
      case "Striped":
        return "striped";
      case "Wedged":
        return "wedged";
    }
  },
} as const;

// There is a tension in the design of the labelling API.
//
// For example, I considered making a `Labeller<T>` trait that
// provides labels for `T`, and then making the graph type `G`
// implement `Labeller<Node>` and `Labeller<Edge>`. However, this is
// not possible without functional dependencies. (One could work
// around that, but I did not explore that avenue heavily.)
//
// Another approach that I actually used for a while was to make a
// `Label<Context>` trait that is implemented by the client-specific
// Node and Edge types (as well as an implementation on Graph itself
// for the overall name for the graph). The main disadvantage of this
// second approach (compared to having the `G` type parameter
// implement a Labelling service) that I have encountered is that it
// makes it impossible to use types outside of the current crate
// directly as Nodes/Edges; you need to wrap them in newtype'd
// structs. See e.g., the `No` and `Ed` structs in the examples. (In
// practice clients using a graph in some other crate would need to
// provide some sort of adapter shim over the graph anyway to
// interface with this library).
//
// Another approach would be to make a single `Labeller<N,E>` trait
// that provides three methods (graph_label, node_label, edge_label),
// and then make `G` implement `Labeller<N,E>`. At first this did not
// appeal to me, since I had thought I would need separate methods on
// each data variant for dot-internal identifiers versus user-visible
// labels. However, the identifier/label distinction only arises for
// nodes; graphs themselves only have identifiers, and edges only have
// labels.
//
// So in the end I decided to use the third approach described above.

/// `Id` is a Graphviz `ID`.
export class Id {
  constructor(public name: string) {}

  /// Creates an `Id` named `name`.
  ///
  /// The caller must ensure that the input conforms to an
  /// identifier format: it must be a non-empty string made up of
  /// alphanumeric or underscore characters, not beginning with a
  /// digit (i.e., the regular expression `[a-zA-Z_][a-zA-Z_0-9]*`).
  ///
  /// (Note: this format is a strict subset of the `ID` format
  /// defined by the DOT language. This function may change in the
  /// future to accept a broader subset, or the entirety, of DOT's
  /// `ID` format.)
  ///
  /// Passing an invalid string (containing spaces, brackets,
  /// quotes, ...) will return an empty `Err` value.
  // rustc: compiler/rustc_graphviz/src/lib.rs:396 new
  static new(name: string): Result<Id, null> {
    const c = name.codePointAt(0);
    if (!(c !== undefined && (is_ascii_alphabetic(c) || c === 0x5f /* '_' */))) {
      return Err(null);
    }
    for (const ch of name) {
      const c = ch.codePointAt(0)!;
      if (!(is_ascii_alphanumeric(c) || c === 0x5f /* '_' */)) {
        return Err(null);
      }
    }

    return Ok(new Id(name));
  }

  // rustc: compiler/rustc_graphviz/src/lib.rs:409 as_slice
  as_slice(): string {
    return this.name;
  }
}

/// Each instance of a type that implements `Label<C>` maps to a
/// unique identifier with respect to `C`, which is used to identify
/// it in the generated .dot file. They can also provide more
/// elaborate (and non-unique) label text that is used in the graphviz
/// rendered output.
///
/// The graph instance is responsible for providing the DOT compatible
/// identifiers for the nodes and (optionally) rendered labels for the nodes and
/// edges, as well as an identifier for the graph itself.
export interface Labeller<Node, Edge> {
  /// Must return a DOT compatible identifier naming the graph.
  // rustc: compiler/rustc_graphviz/src/lib.rs:428 graph_id
  graph_id(): Id;

  /// Maps `n` to a unique identifier with respect to `self`. The
  /// implementor is responsible for ensuring that the returned name
  /// is a valid DOT identifier.
  // rustc: compiler/rustc_graphviz/src/lib.rs:433 node_id
  node_id(n: Node): Id;

  /// Maps `n` to one of the [graphviz `shape` names][1]. If `None`
  /// is returned, no `shape` attribute is specified.
  ///
  /// [1]: https://www.graphviz.org/doc/info/shapes.html
  node_shape?(node: Node): LabelText | undefined; // (provided)

  /// Maps `n` to a label that will be used in the rendered output.
  /// The label need not be unique, and may be the empty string; the
  /// default is just the output from `node_id`.
  node_label?(n: Node): LabelText; // (provided)

  /// Maps `e` to a label that will be used in the rendered output.
  /// The label need not be unique, and may be the empty string; the
  /// default is in fact the empty string.
  edge_label?(e: Edge): LabelText; // (provided)

  /// Maps `n` to a style that will be used in the rendered output.
  node_style?(n: Node): Style; // (provided)

  /// Maps `e` to a style that will be used in the rendered output.
  edge_style?(e: Edge): Style; // (provided)
}

/** The provided methods of `Labeller` (PORTING §8): the implementor's override, else upstream's default body. */
export const Labeller_provided = {
  // rustc: compiler/rustc_graphviz/src/lib.rs:439 node_shape
  node_shape<N, E>(self: Labeller<N, E>, node: N): LabelText | undefined {
    if (self.node_shape !== undefined) return self.node_shape(node);
    return undefined;
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:446 node_label
  node_label<N, E>(self: Labeller<N, E>, n: N): LabelText {
    if (self.node_label !== undefined) return self.node_label(n);
    return { $: "LabelStr", _0: self.node_id(n).name };
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:453 edge_label
  edge_label<N, E>(self: Labeller<N, E>, e: E): LabelText {
    if (self.edge_label !== undefined) return self.edge_label(e);
    return { $: "LabelStr", _0: "" };
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:458 node_style
  node_style<N, E>(self: Labeller<N, E>, n: N): Style {
    if (self.node_style !== undefined) return self.node_style(n);
    return "None";
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:463 edge_style
  edge_style<N, E>(self: Labeller<N, E>, e: E): Style {
    if (self.edge_style !== undefined) return self.edge_style(e);
    return "None";
  },
} as const;

/// Escape tags in such a way that it is suitable for inclusion in a
/// Graphviz HTML label.
// rustc: compiler/rustc_graphviz/src/lib.rs:470 escape_html
export function escape_html(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", '<br align="left"/>');
}

/**
 * `char::escape_default` (library/core/src/char/methods.rs): `\t`, `\r`, `\n`, `\'`, `\"`, `\\`, the printable ASCII
 * range 0x20..=0x7e as is, everything else `\u{<lowercase hex>}`.
 */
function char_escape_default(c: number): string {
  switch (c) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x27:
      return "\\'";
    case 0x22:
      return '\\"';
    case 0x5c:
      return "\\\\";
    default:
      if (c >= 0x20 && c <= 0x7e) return String.fromCodePoint(c);
      return `\\u{${c.toString(16)}}`;
  }
}

/** `str::escape_default`: `char::escape_default` of every char. */
function str_escape_default(s: string): string {
  let out = "";
  for (const ch of s) out += char_escape_default(ch.codePointAt(0)!);
  return out;
}

export const LabelText = {
  // rustc: compiler/rustc_graphviz/src/lib.rs:479 label
  label(s: string): LabelText {
    return { $: "LabelStr", _0: s };
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:483 html
  html(s: string): LabelText {
    return { $: "HtmlStr", _0: s };
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:487 escape_char
  escape_char(c: number, f: (c: string) => void): void {
    switch (c) {
      // not escaping \\, since Graphviz escString needs to
      // interpret backslashes; see EscStr above.
      case 0x5c /* '\\' */:
        f(String.fromCodePoint(c));
        break;
      default:
        // PORT: `c.escape_default()` yields chars; its whole text is passed in one call (same output).
        f(char_escape_default(c));
        break;
    }
  },

  // rustc: compiler/rustc_graphviz/src/lib.rs:502 escape_str
  escape_str(s: string): string {
    let out = "";
    for (const ch of s) {
      LabelText.escape_char(ch.codePointAt(0)!, (c) => {
        out += c;
      });
    }
    return out;
  },

  /// Renders text as string suitable for a label in a .dot file.
  /// This includes quotes or suitable delimiters.
  // rustc: compiler/rustc_graphviz/src/lib.rs:512 to_dot_string
  to_dot_string(self: LabelText): string {
    switch (self.$) {
      case "LabelStr":
        return `"${str_escape_default(self._0)}"`;
      case "EscStr":
        return `"${LabelText.escape_str(self._0)}"`;
      case "HtmlStr":
        return `<${self._0}>`;
    }
  },
} as const;

export type Nodes<N> = readonly N[];
export type Edges<E> = readonly E[];

// (The type parameters in GraphWalk should be associated items,
// when/if Rust supports such.)

/// GraphWalk is an abstraction over a directed graph = (nodes,edges)
/// made up of node handles `N` and edge handles `E`, where each `E`
/// can be mapped to its source and target nodes.
///
/// The lifetime parameter `'a` is exposed in this trait (rather than
/// introduced as a generic parameter on each method declaration) so
/// that a client impl can choose `N` and `E` that have substructure
/// that is bound by the self lifetime `'a`.
///
/// The `nodes` and `edges` method each return instantiations of
/// `Cow<[T]>` to leave implementors the freedom to create
/// entirely new vectors or to pass back slices into internally owned
/// vectors.
export interface GraphWalk<Node, Edge> {
  /// Returns all the nodes in this graph.
  // rustc: compiler/rustc_graphviz/src/lib.rs:545 nodes
  nodes(): Nodes<Node>;
  /// Returns all of the edges in this graph.
  // rustc: compiler/rustc_graphviz/src/lib.rs:547 edges
  edges(): Edges<Edge>;
  /// The source node for `edge`.
  // rustc: compiler/rustc_graphviz/src/lib.rs:549 source
  source(edge: Edge): Node;
  /// The target node for `edge`.
  // rustc: compiler/rustc_graphviz/src/lib.rs:551 target
  target(edge: Edge): Node;
}

export type RenderOption =
  | { readonly $: "NoEdgeLabels" }
  | { readonly $: "NoNodeLabels" }
  | { readonly $: "NoEdgeStyles" }
  | { readonly $: "NoNodeStyles" }
  | { readonly $: "Fontname"; readonly _0: string }
  | { readonly $: "DarkTheme" };
export const RenderOption = {
  NoEdgeLabels: Object.freeze({ $: "NoEdgeLabels" }),
  NoNodeLabels: Object.freeze({ $: "NoNodeLabels" }),
  NoEdgeStyles: Object.freeze({ $: "NoEdgeStyles" }),
  NoNodeStyles: Object.freeze({ $: "NoNodeStyles" }),
  DarkTheme: Object.freeze({ $: "DarkTheme" }),
} as const satisfies Record<string, RenderOption>;

/** `#[derive(PartialEq)]` of `RenderOption`. */
export function RenderOption_eq(a: RenderOption, b: RenderOption): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Fontname" && b.$ === "Fontname") return a._0 === b._0;
  return true;
}

/** `options.contains(&option)` */
function contains(options: readonly RenderOption[], option: RenderOption): boolean {
  return options.some((o) => RenderOption_eq(o, option));
}

const encoder = new TextEncoder();

/// Renders directed graph `g` into the writer `w` in DOT syntax.
/// (Simple wrapper around `render_opts` that passes a default set of options.)
// rustc: compiler/rustc_graphviz/src/lib.rs:567 render
export function render<N, E>(g: Labeller<N, E> & GraphWalk<N, E>, w: Write): IoResult<void> {
  return render_opts(g, w, []);
}

/// Renders directed graph `g` into the writer `w` in DOT syntax.
/// (Main entry point for the library.)
// rustc: compiler/rustc_graphviz/src/lib.rs:579 render_opts
export function render_opts<N, E>(g: Labeller<N, E> & GraphWalk<N, E>, w: Write, options: readonly RenderOption[]): IoResult<void> {
  let r: IoResult<void>;
  if ((r = w.write_fmt([`digraph ${g.graph_id().as_slice()} {\n`])).$ === "Err") return r;

  // Global graph properties
  const graph_attrs: string[] = [];
  const content_attrs: string[] = [];
  let font: string;
  let fontname: string | undefined;
  for (const option of options) {
    if (option.$ === "Fontname") {
      fontname = option._0;
      break;
    }
  }
  if (fontname !== undefined) {
    font = `fontname="${fontname}"`;
    graph_attrs.push(font);
    content_attrs.push(font);
  }
  if (contains(options, RenderOption.DarkTheme)) {
    graph_attrs.push(`bgcolor="black"`);
    graph_attrs.push(`fontcolor="white"`);
    content_attrs.push(`color="white"`);
    content_attrs.push(`fontcolor="white"`);
  }
  if (!(graph_attrs.length === 0 && content_attrs.length === 0)) {
    if ((r = w.write_fmt([`    graph[${graph_attrs.join(" ")}];\n`])).$ === "Err") return r;
    const content_attrs_str = content_attrs.join(" ");
    if ((r = w.write_fmt([`    node[${content_attrs_str}];\n`])).$ === "Err") return r;
    if ((r = w.write_fmt([`    edge[${content_attrs_str}];\n`])).$ === "Err") return r;
  }

  // PORT: the `Vec<u8>` buffer `text` is a string, written with one `write_all` of its UTF-8 bytes.
  let text = "";
  for (const n of g.nodes()) {
    if ((r = w.write_fmt(["    "])).$ === "Err") return r;
    const id = g.node_id(n);

    const escaped = LabelText.to_dot_string(Labeller_provided.node_label(g, n));

    text += id.as_slice();

    if (!contains(options, RenderOption.NoNodeLabels)) {
      text += `[label=${escaped}]`;
    }

    const style = Labeller_provided.node_style(g, n);
    if (!contains(options, RenderOption.NoNodeStyles) && style !== "None") {
      text += `[style="${Style.as_slice(style)}"]`;
    }

    const s = Labeller_provided.node_shape(g, n);
    if (s !== undefined) {
      text += `[shape=${LabelText.to_dot_string(s)}]`;
    }

    text += ";\n";
    if ((r = w.write_all(encoder.encode(text))).$ === "Err") return r;

    text = "";
  }

  for (const e of g.edges()) {
    const escaped_label = LabelText.to_dot_string(Labeller_provided.edge_label(g, e));
    if ((r = w.write_fmt(["    "])).$ === "Err") return r;
    const source = g.source(e);
    const target = g.target(e);
    const source_id = g.node_id(source);
    const target_id = g.node_id(target);

    text += `${source_id.as_slice()} -> ${target_id.as_slice()}`;

    if (!contains(options, RenderOption.NoEdgeLabels)) {
      text += `[label=${escaped_label}]`;
    }

    const style = Labeller_provided.edge_style(g, e);
    if (!contains(options, RenderOption.NoEdgeStyles) && style !== "None") {
      text += `[style="${Style.as_slice(style)}"]`;
    }

    text += ";\n";
    if ((r = w.write_all(encoder.encode(text))).$ === "Err") return r;

    text = "";
  }

  return w.write_fmt(["}\n"]);
}

// #[cfg(test)]
// mod tests; (tests.test.ts)
