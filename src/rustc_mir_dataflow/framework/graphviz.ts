// Port of compiler/rustc_mir_dataflow/src/framework/graphviz.rs (declarations: lane dataflow-contract; fill: lane
// dataflow-graphviz, wave 40i).
//
// PORT: the `dot::Labeller` / `dot::GraphWalk` impls for `Formatter` are methods of the class (rustc_graphviz's
// interfaces); `ResultsVisitor for StateDiffCollector` makes it implement `ResultsVisitor` with the provided
// `visit_block_exit` forwarding to `ResultsVisitor_provided`. `A::Domain: DebugWithContext<A>` is the analysis's
// `Domain` table (framework/mod.ts, plan-m4 D5); `{:?}` is `PLAIN`, `{:#?}` is `PRETTY`.
// PORT: the `Vec<u8>` buffers the node labels are written into are `string[]` (joined at the end): writing to a
// `Vec<u8>` cannot fail, so the `?` after each `write!` into one is dropped; the `?` on calls that return
// `io::Result` is kept.
//! A helpful diagram for debugging dataflow problems.

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { RustcMirKind } from "../../rustc_attr_ir/data_structures.gen.ts";
import * as dot from "../../rustc_graphviz/lib.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { graphviz_safe_def_name } from "../../rustc_middle/mir/generic_graph.ts";
import { BasicBlock, type Body, type Location, type Statement, type Terminator, TerminatorKind, traversal } from "../../rustc_middle/mir/mod.ts";
import { debug_Statement, MirDumper, StringFmtWrite } from "../../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { HasAttrs_DefId } from "../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { type Debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { debug_IoError, type IoResult, io_error_from_node } from "../../std/io.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { path_file_name, path_join, path_parent } from "../../std/path.ts";
import { Err, Ok, unwrap_result } from "../../std/result.ts";
import { VecU8, type Write } from "../../vendor/anstream/stream.ts";
import { ResultsCursor } from "./cursor.ts";
import type { DebugWithContext } from "./fmt.ts";
import type { Analysis } from "./mod.ts";
import type { Results } from "./results.ts";
import { type ResultsVisitor, ResultsVisitor_provided, visit_results } from "./visitor.ts";

/** Debug for `()`: `dot::Id::new`'s error type, for the panic message of its `.unwrap()`. */
const debug_unit: Debug<null> = () => "()";

/// Writes a DOT file containing the results of a dataflow analysis if the user requested it via
/// `rustc_mir` attributes and `-Z dump-mir-dataflow`. The `Result` in and the `Results` out are
/// the same.
// rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:27 write_graphviz_results
export function write_graphviz_results<D, A extends Analysis<D, unknown>>(
  tcx: TyCtxt,
  body: Body,
  results: Results<D, A>,
  pass_name: string | undefined,
): IoResult<null> {
  // use std::fs;
  // use std::io::Write;

  const def_id = body.source.def_id();
  const attrs = RustcMirAttrs.parse(tcx, def_id);

  let file: Write & { drop(): void };
  const path = attrs.output_path(results.analysis.NAME);
  if (path !== undefined) {
    // debug!("printing dataflow results for {:?} to {}", def_id, path.display());
    const parent = path_parent(path);
    if (parent !== undefined) {
      const r = fs_create_dir_all(parent);
      if (r.$ === "Err") return r;
    }
    const f = File_create_buffered(path);
    if (f.$ === "Err") return f;
    file = f._0;
  } else {
    const dumper = MirDumper.new(tcx, results.analysis.NAME, body);
    if (dumper === undefined) {
      return Ok(null);
    }
    const disambiguator = pass_name ?? "-----";
    const f = dumper.set_disambiguator(disambiguator).create_dump_file("dot", body);
    if (f.$ === "Err") return f;
    // PORT: `create_dump_file` returns rustc_middle mir/pretty.ts's `DumpFile` (a `BufWriter<File>`), closed by `drop`.
    file = f._0 as Write & { drop(): void };
  }

  try {
    const style = attrs.formatter ?? OutputStyle.AfterOnly;

    const buf = new VecU8();

    const graphviz = Formatter.new<D, A>(body, results, style);
    const render_opts: dot.RenderOption[] = [{ $: "Fontname", _0: tcx.sess.opts.unstable_opts.graphviz_font }];
    if (tcx.sess.opts.unstable_opts.graphviz_dark_mode) {
      render_opts.push(dot.RenderOption.DarkTheme);
    }
    const r = with_no_trimmed_paths(() => dot.render_opts(graphviz, buf, render_opts));
    if (r.$ === "Err") return r;
    const w = file.write_all(buf.bytes());
    return w.$ === "Err" ? w : Ok(null);
  } finally {
    file.drop();
  }
}

/** `fs::create_dir_all` (PORT: Node's recursive `mkdirSync`; `create_dir_all("")` is `Ok`, as in std). */
function fs_create_dir_all(path: string): IoResult<null> {
  try {
    if (path !== "") mkdirSync(path, { recursive: true });
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** `fs::File::create_buffered` (PORT: the buffer is kept in memory and written to the file on `drop`, as `BufWriter`'s). */
function File_create_buffered(path: string): IoResult<Write & { drop(): void }> {
  let fd: number;
  try {
    fd = openSync(path, "w");
  } catch (e) {
    return Err(io_error_from_node(e));
  }
  const buf = new VecU8();
  const file = Object.assign(buf, {
    drop(): void {
      // `BufWriter`'s `Drop` flushes and ignores errors; then the `File` is closed.
      try {
        const bytes = buf.bytes();
        let off = 0;
        while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
      } catch {
        // ignored, as `BufWriter`'s `Drop`
      }
      closeSync(fd);
    },
  });
  return Ok(file);
}

// #[derive(Default)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:76 RustcMirAttrs
class RustcMirAttrs {
  constructor(
    public basename_and_suffix: string | undefined,
    public formatter: OutputStyle | undefined,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:82 parse
  static parse(tcx: TyCtxt, def_id: DefId): RustcMirAttrs {
    const ret = new RustcMirAttrs(undefined, undefined);

    const rustc_mir_attrs: readonly RustcMirKind[] | undefined = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) =>
      k.$ === "RustcMir" ? k._0 : undefined,
    );
    if (rustc_mir_attrs !== undefined) {
      for (const attr of rustc_mir_attrs) {
        switch (attr.$) {
          case "BorrowckGraphvizPostflow": {
            const path = attr.path;
            ret.basename_and_suffix = path;
            break;
          }
          case "BorrowckGraphvizFormat": {
            const format = attr.format;
            switch (format) {
              case "TwoPhase":
                ret.formatter = OutputStyle.BeforeAndAfter;
                break;
            }
            break;
          }
          default:
            break;
        }
      }
    }

    return ret;
  }

  /// Returns the path where dataflow results should be written, or `None`
  /// `borrowck_graphviz_postflow` was not specified.
  ///
  /// This performs the following transformation to the argument of `borrowck_graphviz_postflow`:
  ///
  /// "path/suffix.dot" -> "path/analysis_name_suffix.dot"
  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:112 output_path
  output_path(analysis_name: string): string | undefined {
    if (this.basename_and_suffix === undefined) return undefined;
    let ret = this.basename_and_suffix;
    const suffix = unwrap(path_file_name(ret)); // Checked when parsing attrs

    let file_name = analysis_name;
    file_name += "_";
    file_name += suffix;
    // `ret.set_file_name(file_name)`: `pop` the old file name (it has one), then `push` the new one.
    ret = path_join(unwrap(path_parent(ret)), file_name);

    return ret;
  }
}

// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:126 OutputStyle
type OutputStyle = "AfterOnly" | "BeforeAndAfter";
const OutputStyle = {
  AfterOnly: "AfterOnly",
  BeforeAndAfter: "BeforeAndAfter",

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:132 num_state_columns
  num_state_columns(self: OutputStyle): number {
    switch (self) {
      case "AfterOnly":
        return 1;
      case "BeforeAndAfter":
        return 2;
    }
  },
} as const;

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:140 Formatter
class Formatter<D, A extends Analysis<D, unknown>> implements dot.Labeller<BasicBlock, CfgEdge>, dot.GraphWalk<BasicBlock, CfgEdge> {
  constructor(
    public body: Body,
    public results: Results<D, A>,
    public style: OutputStyle,
    public reachable: DenseBitSet<BasicBlock>,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:154 new
  static new<D, A extends Analysis<D, unknown>>(body: Body, results: Results<D, A>, style: OutputStyle): Formatter<D, A> {
    const reachable = traversal.reachable_as_bitset(body);
    return new Formatter<D, A>(body, results, style, reachable);
  }

  // ---- impl dot::Labeller for Formatter (type Node = BasicBlock; type Edge = CfgEdge) ----

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:184 graph_id
  graph_id(): dot.Id {
    const name = graphviz_safe_def_name(this.body.source.def_id());
    return unwrap_result(dot.Id.new(`graph_for_def_id_${name}`), debug_unit);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:189 node_id
  node_id(n: BasicBlock): dot.Id {
    return unwrap_result(dot.Id.new(`bb_${BasicBlock.index(n)}`), debug_unit);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:193 node_label
  node_label(block: BasicBlock): dot.LabelText {
    const diffs = StateDiffCollector.run<D, A>(this.body, block, this.results, this.style);

    const fmt = new BlockFormatter<D, A>(ResultsCursor.new_borrowing<D, A>(this.body, this.results), Background.Light, this.style);
    const label = unwrap_result(fmt.write_node_label(block, diffs), debug_IoError);

    return dot.LabelText.html(label);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:206 node_shape
  node_shape(_n: BasicBlock): dot.LabelText | undefined {
    return dot.LabelText.label("none");
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:210 edge_label
  edge_label(e: CfgEdge): dot.LabelText {
    const labels = TerminatorKind.fmt_successor_labels(this.body.index(e.source).terminator_().kind);
    const label = index_slice(labels, e.index);
    return dot.LabelText.label(label);
  }

  // ---- impl dot::GraphWalk for Formatter ----

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:223 nodes
  nodes(): dot.Nodes<BasicBlock> {
    const out: BasicBlock[] = [];
    const n = this.body.basic_blocks.deref().length;
    for (let i = 0; i < n; i++) {
      const idx = BasicBlock.from_usize(i);
      if (this.reachable.contains(idx)) out.push(idx);
    }
    return out;
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:232 edges
  edges(): dot.Edges<CfgEdge> {
    const out: CfgEdge[] = [];
    const n = this.body.basic_blocks.deref().length;
    for (let i = 0; i < n; i++) {
      out.push(...dataflow_successors(this.body, BasicBlock.from_usize(i)));
    }
    return out;
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:241 source
  source(edge: CfgEdge): BasicBlock {
    return edge.source;
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:245 target
  target(edge: CfgEdge): BasicBlock {
    return unwrap([...this.body.index(edge.source).terminator_().successors()][edge.index]);
  }
}

/** `slice[index]` (panics out of bounds, as Rust's indexing). */
function index_slice<T>(s: readonly T[], index: number): T {
  if (index >= s.length) {
    panic(`index out of bounds: the len is ${s.length} but the index is ${index}`);
  }
  return s[index]!;
}

/// A pair of a basic block and an index into that basic blocks `successors`.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:162 CfgEdge
interface CfgEdge {
  source: BasicBlock;
  index: number;
}

// rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:167 dataflow_successors
function dataflow_successors(body: Body, bb: BasicBlock): CfgEdge[] {
  const out: CfgEdge[] = [];
  let index = 0;
  for (const _ of body.index(bb).terminator_().successors()) {
    out.push({ source: bb, index });
    index++;
  }
  return out;
}

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:250 BlockFormatter
class BlockFormatter<D, A extends Analysis<D, unknown>> {
  constructor(
    public cursor: ResultsCursor<D, A>,
    public bg: Background,
    public style: OutputStyle,
  ) {}

  static readonly HEADER_COLOR: string = "#a0a0a0";

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:266 toggle_background
  toggle_background(): Background {
    const bg = this.bg;
    this.bg = Background.not(bg);
    return bg;
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:272 write_node_label
  write_node_label(block: BasicBlock, diffs: StateDiffCollector<D, A>): IoResult<string> {
    // use std::io::Write;

    //   Sample output:
    //   +-+-----------------------------------------------+
    // A |                      bb4                        |
    //   +-+----------------------------------+------------+
    // B |                MIR                 |   STATE    |
    //   +-+----------------------------------+------------+
    // C | | (on start)                       | {_0,_2,_3} |
    //   +-+----------------------------------+------------+
    // D |0| StorageLive(_7)                  |            |
    //   +-+----------------------------------+------------+
    //   |1| StorageLive(_8)                  |            |
    //   +-+----------------------------------+------------+
    //   |2| _8 = &mut _1                     | +_8        |
    //   +-+----------------------------------+------------+
    // E |T| _4 = const Foo::twiddle(move _2) | -_2        |
    //   +-+----------------------------------+------------+
    // F | | (on unwind)                      | {_0,_3,_8} |
    //   +-+----------------------------------+------------+
    //   | | (on successful return)           | +_4        |
    //   +-+----------------------------------+------------+

    // N.B., Some attributes (`align`, `balign`) are repeated on parent elements and their
    // children. This is because `xdot` seemed to have a hard time correctly propagating
    // attributes. Make sure to test the output before trying to remove the redundancy.
    // Notably, `align` was found to have no effect when applied only to <table>.

    const v: string[] = [];
    const w = v;
    let r: IoResult<null>;

    const table_fmt = ' border="1"' + ' cellborder="1"' + ' cellspacing="0"' + ' cellpadding="3"' + ' sides="rb"';
    w.push(`<table${table_fmt}>`);

    // A + B: Block header
    switch (this.style) {
      case "AfterOnly":
        if ((r = this.write_block_header_simple(w, block)).$ === "Err") return r;
        break;
      case "BeforeAndAfter":
        if ((r = this.write_block_header_with_state_columns(w, block, ["BEFORE", "AFTER"])).$ === "Err") return r;
        break;
    }

    // C: State at start of block
    this.bg = Background.Light;
    this.cursor.seek_to_block_start(block);
    const Domain = this.cursor.analysis().Domain;
    const block_start_state = Domain.clone(this.cursor.get());
    if ((r = this.write_row_with_full_state(w, "", "(on start)")).$ === "Err") return r;

    // D + E: Statement and terminator transfer functions
    if ((r = this.write_statements_and_terminator(w, block, diffs)).$ === "Err") return r;

    // F: State at end of block

    const terminator = this.cursor.body().index(block).terminator_();

    // Write the full dataflow state immediately after the terminator if it differs from the
    // state at block entry.
    this.cursor.seek_to_block_end(block);
    if (!Domain.eq(this.cursor.get(), block_start_state) || this.cursor.analysis().Direction.IS_BACKWARD) {
      const after_terminator_name = terminator.kind.$ === "Call" && terminator.kind.target !== undefined ? "(on unwind)" : "(on end)";

      if ((r = this.write_row_with_full_state(w, "", after_terminator_name)).$ === "Err") return r;
    }

    // Write any changes caused by terminator-specific effects.
    //
    // FIXME: These should really be printed as part of each outgoing edge rather than the node
    // for the basic block itself. That way, we could display terminator-specific effects for
    // backward dataflow analyses as well as effects for `SwitchInt` terminators.

    const edges = terminator.edges();
    if (edges.$ === "AssignOnReturn" && edges.return_.length !== 0) {
      const place = edges.place;
      let label: string;
      switch (place.$) {
        case "Call":
        case "InlineAsm":
          label = "(on successful return)";
          break;
        case "Yield":
          label = "(on yield resume)";
          break;
      }

      r = this.write_row(w, "", label, (this_, w, fmt) => {
        const state_before_effect = Domain.clone(this_.cursor.get());
        this_.cursor.apply_custom_effect((analysis, state) => {
          analysis.apply_call_return_effect(state, block, place);
        });

        w.push(
          `<td balign="left" colspan="${OutputStyle.num_state_columns(this_.style)}" ${fmt} align="left">${diff_pretty(
            this_.cursor.get(),
            state_before_effect,
            this_.cursor.analysis(),
            Domain,
          )}</td>`,
        );
        return Ok(null);
      });
      if (r.$ === "Err") return r;
    }

    w.push("</table>");

    return Ok(v.join(""));
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:393 write_block_header_simple
  write_block_header_simple(w: string[], block: BasicBlock): IoResult<null> {
    //   +-------------------------------------------------+
    // A |                      bb4                        |
    //   +-----------------------------------+-------------+
    // B |                MIR                |    STATE    |
    //   +-+---------------------------------+-------------+
    //   | |              ...                |             |

    // A
    const block_id = BasicBlock.index(block);
    w.push("<tr>" + `<td colspan="3" sides="tl">bb${block_id}</td>` + "</tr>");

    // B
    const fmt = `bgcolor="${BlockFormatter.HEADER_COLOR}" sides="tl"`;
    w.push("<tr>" + `<td colspan="2" ${fmt}>MIR</td>` + `<td ${fmt}>STATE</td>` + "</tr>");
    return Ok(null);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:425 write_block_header_with_state_columns
  write_block_header_with_state_columns(w: string[], block: BasicBlock, state_column_names: readonly string[]): IoResult<null> {
    //   +------------------------------------+-------------+
    // A |                bb4                 |    STATE    |
    //   +------------------------------------+------+------+
    // B |                MIR                 |  GEN | KILL |
    //   +-+----------------------------------+------+------+
    //   | |              ...                 |      |      |

    // A
    {
      const fmt = 'sides="tl"';
      const num_state_cols = state_column_names.length;
      const block_id = BasicBlock.index(block);
      w.push("<tr>" + `<td ${fmt} colspan="2">bb${block_id}</td>` + `<td ${fmt} colspan="${num_state_cols}">STATE</td>` + "</tr>");
    }

    // B
    const fmt = `bgcolor="${BlockFormatter.HEADER_COLOR}" sides="tl"`;
    w.push("<tr>" + `<td colspan="2" ${fmt}>MIR</td>`);

    for (const name of state_column_names) {
      w.push(`<td ${fmt}>${name}</td>`);
    }

    w.push("</tr>");
    return Ok(null);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:463 write_statements_and_terminator
  write_statements_and_terminator(w: string[], block: BasicBlock, diffs: StateDiffCollector<D, A>): IoResult<null> {
    let r: IoResult<null>;
    // PORT: the `vec::IntoIter`s are the vectors themselves, consumed from the front (`next`) or back (`next_back`).
    const diffs_before: string[] | undefined = diffs.before;
    const diffs_after: string[] = diffs.after;

    const IS_FORWARD = this.cursor.analysis().Direction.IS_FORWARD;
    const next_in_dataflow_order = (it: string[]): string => {
      return IS_FORWARD ? unwrap(it.shift()) : unwrap(it.pop());
    };

    const statements = this.cursor.body().index(block).statements;
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]!;
      const statement_str = debug_Statement(statement, PLAIN);
      const index_str = `${i}`;

      const after = next_in_dataflow_order(diffs_after);
      const before = diffs_before === undefined ? undefined : next_in_dataflow_order(diffs_before);

      r = this.write_row(w, index_str, statement_str, (_this, w, fmt) => {
        if (before !== undefined) {
          w.push(`<td ${fmt} align="left">${before}</td>`);
        }

        w.push(`<td ${fmt} align="left">${after}</td>`);
        return Ok(null);
      });
      if (r.$ === "Err") return r;
    }

    const after = next_in_dataflow_order(diffs_after);
    const before = diffs_before === undefined ? undefined : next_in_dataflow_order(diffs_before);

    assert(diffs_after.length === 0, "assertion failed: diffs_after.is_empty()");
    assert(
      diffs_before === undefined || diffs_before.length === 0,
      "assertion failed: diffs_before.as_ref().is_none_or(ExactSizeIterator::is_empty)",
    );

    const terminator = this.cursor.body().index(block).terminator_();
    const terminator_str = new StringFmtWrite();
    if (TerminatorKind.fmt_head(terminator.kind, terminator_str).$ === "Err") {
      panic("called `Result::unwrap()` on an `Err` value: Error");
    }

    return this.write_row(w, "T", terminator_str.buf, (_this, w, fmt) => {
      if (before !== undefined) {
        w.push(`<td ${fmt} align="left">${before}</td>`);
      }

      w.push(`<td ${fmt} align="left">${after}</td>`);
      return Ok(null);
    });
  }

  /// Write a row with the given index and MIR, using the function argument to fill in the
  /// "STATE" column(s).
  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:513 write_row
  write_row(w: string[], i: string, mir: string, f: (this_: this, w: string[], fmt: string) => IoResult<null>): IoResult<null> {
    const bg = this.toggle_background();
    const valign = mir.startsWith("(on ") && mir !== "(on start)" ? "bottom" : "top";

    const fmt = `valign="${valign}" sides="tl" ${Background.attr(bg)}`;

    w.push("<tr>" + `<td ${fmt} align="right">${i}</td>` + `<td ${fmt} align="left">${dot.escape_html(mir)}</td>`);

    const r = f(this, w, fmt);
    if (r.$ === "Err") return r;
    w.push("</tr>");
    return Ok(null);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:541 write_row_with_full_state
  write_row_with_full_state(w: string[], i: string, mir: string): IoResult<null> {
    return this.write_row(w, i, mir, (this_, w, fmt) => {
      const state = this_.cursor.get();
      const analysis = this_.cursor.analysis();

      // FIXME: The full state vector can be quite long. It would be nice to split on commas
      // and use some text wrapping algorithm.
      w.push(
        `<td colspan="${OutputStyle.num_state_columns(this_.style)}" ${fmt} align="left">${dot.escape_html(
          // format!("{:?}", DebugWithAdapter { this: state, ctxt: analysis })
          analysis.Domain.fmt_with(state, analysis, PLAIN),
        )}</td>`,
      );
      return Ok(null);
    });
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:567 StateDiffCollector
class StateDiffCollector<D, A extends Analysis<D, unknown>> implements ResultsVisitor<D, A> {
  constructor(
    public analysis: A,
    public prev_state: D,
    public before: string[] | undefined,
    public after: string[],
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:575 run
  static run<D, A extends Analysis<D, unknown>>(body: Body, block: BasicBlock, results: Results<D, A>, style: OutputStyle): StateDiffCollector<D, A> {
    const collector = new StateDiffCollector<D, A>(
      results.analysis,
      results.analysis.Domain.clone(results.entry_states[block]!),
      style === OutputStyle.BeforeAndAfter ? [] : undefined,
      [],
    );

    visit_results(body, [block], results, collector);
    return collector;
  }

  // ---- impl ResultsVisitor for StateDiffCollector ----

  // (provided) visitor.rs:42 visit_block_exit -> ResultsVisitor_provided.visit_block_exit
  visit_block_exit(state: D, block: BasicBlock): void {
    ResultsVisitor_provided.visit_block_exit(this, state, block);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:601 visit_after_early_statement_effect
  visit_after_early_statement_effect(state: D, _statement: Statement, _location: Location): void {
    const before = this.before;
    if (before !== undefined) {
      before.push(diff_pretty(state, this.prev_state, this.analysis, this.analysis.Domain));
      this.analysis.Domain.clone_from(this.prev_state, state);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:613 visit_after_primary_statement_effect
  visit_after_primary_statement_effect(state: D, _statement: Statement, _location: Location): void {
    this.after.push(diff_pretty(state, this.prev_state, this.analysis, this.analysis.Domain));
    this.analysis.Domain.clone_from(this.prev_state, state);
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:623 visit_after_early_terminator_effect
  visit_after_early_terminator_effect(state: D, _terminator: Terminator, _location: Location): void {
    const before = this.before;
    if (before !== undefined) {
      before.push(diff_pretty(state, this.prev_state, this.analysis, this.analysis.Domain));
      this.analysis.Domain.clone_from(this.prev_state, state);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:635 visit_after_primary_terminator_effect
  visit_after_primary_terminator_effect(state: D, _terminator: Terminator, _location: Location): void {
    this.after.push(diff_pretty(state, this.prev_state, this.analysis, this.analysis.Domain));
    this.analysis.Domain.clone_from(this.prev_state, state);
  }
}

/** `static RE: LazyLock<Regex> = Regex::new("\t?\u{001f}([+-])")` (global: `replace_all`). */
const RE = /\t?\u001f([+-])/g;

// PORT: `T: DebugWithContext<C>` is passed as the impl table `T_` (plan-m4 D5); `new == old` is `T_.eq`.
// rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:646 diff_pretty
export function diff_pretty<T, C>(new_: T, old: T, ctxt: C, T_: DebugWithContext<T, C>): string {
  if (T_.eq(new_, old)) {
    return "";
  }

  // format!("{:#?}", DebugDiffWithAdapter { new, old, ctxt })
  let raw_diff = T_.fmt_diff_with(new_, old, ctxt, PRETTY);
  raw_diff = dot.escape_html(raw_diff);

  // Replace newlines in the `Debug` output with `<br/>`
  raw_diff = raw_diff.replaceAll("\n", '<br align="left"/>');

  let inside_font_tag = false;
  // PORT: `Regex::replace_all` returns `Cow::Borrowed` when nothing matched; `matched` records which one it was.
  let matched = false;
  let html_diff = raw_diff.replace(RE, (_m: string, g1: string): string => {
    matched = true;
    let ret = "";
    if (inside_font_tag) {
      ret += "</font>";
    }

    let tag: string;
    switch (g1) {
      case "+":
        tag = '<font color="darkgreen">+';
        break;
      case "-":
        tag = '<font color="red">-';
        break;
      default:
        return unreachable();
    }

    inside_font_tag = true;
    ret += tag;
    return ret;
  });

  if (!matched) {
    return raw_diff;
  }

  if (inside_font_tag) {
    html_diff += "</font>";
  }

  return html_diff;
}

/// The background color used for zebra-striping the table.
// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:693 Background
type Background = "Light" | "Dark";
const Background = {
  Light: "Light",
  Dark: "Dark",

  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:699 attr
  attr(self: Background): string {
    switch (self) {
      case "Dark":
        return 'bgcolor="#f0f0f0"';
      case "Light":
        return "";
    }
  },

  /** `impl ops::Not for Background`. */
  // rustc: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:710 not
  not(self: Background): Background {
    switch (self) {
      case "Light":
        return "Dark";
      case "Dark":
        return "Light";
    }
  },
} as const;
