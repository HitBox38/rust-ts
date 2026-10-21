// Port of compiler/rustc_mir_dataflow/src/framework/graphviz.rs: DECLARED (lane dataflow-contract). Every fn is a
// stub for lane `dataflow-graphviz` (plan-m4 §5 wave 26, M4d): `-Zdump-mir-dataflow` / `#[rustc_mir(borrowck_graphviz_
// postflow)]` output, which needs rustc_graphviz (not ported), `MirDumper` (mir-pretty) and `traversal::
// reachable_as_bitset` (mir-body-a). The only caller is `iterate_to_fixpoint`, behind `-Zdump-mir-dataflow`.
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. The `dot::Labeller` / `dot::GraphWalk` impls become methods of
// `Formatter` (or tables, as rustc_graphviz's port decides); `ResultsVisitor for StateDiffCollector` makes
// `StateDiffCollector` extend `ResultsVisitorBase`.
//! A helpful diagram for debugging dataflow problems.

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import type { BasicBlock, Body, Location, Statement, Terminator } from "../pending.ts";
import type { ResultsCursor } from "./cursor.ts";
import type { Analysis } from "./mod.ts";
import type { Results } from "./results.ts";

/// Writes a DOT file containing the results of a dataflow analysis if the user requested it via
/// `rustc_mir` attributes and `-Z dump-mir-dataflow`. The `Result` in and the `Results` out are
/// the same.
// stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:27 write_graphviz_results (lane dataflow-graphviz)
export function write_graphviz_results<D, A extends Analysis<D, unknown>>(
  _tcx: TyCtxt,
  _body: Body,
  _results: Results<D, A>,
  _pass_name: string | undefined,
): IoResult<null> {
  return unported("rustc_mir_dataflow::framework::graphviz::write_graphviz_results");
}

// #[derive(Default)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:76 RustcMirAttrs
class RustcMirAttrs {
  constructor(
    public basename_and_suffix: string | undefined,
    public formatter: OutputStyle | undefined,
  ) {}

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:82 parse (lane dataflow-graphviz)
  static parse(_tcx: TyCtxt, _def_id: DefId): RustcMirAttrs {
    return unported("rustc_mir_dataflow::framework::graphviz::RustcMirAttrs::parse");
  }

  /// Returns the path where dataflow results should be written, or `None`
  /// `borrowck_graphviz_postflow` was not specified.
  ///
  /// This performs the following transformation to the argument of `borrowck_graphviz_postflow`:
  ///
  /// "path/suffix.dot" -> "path/analysis_name_suffix.dot"
  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:112 output_path (lane dataflow-graphviz)
  output_path(_analysis_name: string): string | undefined {
    return unported("rustc_mir_dataflow::framework::graphviz::RustcMirAttrs::output_path");
  }
}

// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:126 OutputStyle
type OutputStyle = "AfterOnly" | "BeforeAndAfter";
const OutputStyle = {
  AfterOnly: "AfterOnly",
  BeforeAndAfter: "BeforeAndAfter",

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:132 num_state_columns (lane dataflow-graphviz)
  num_state_columns(_self: OutputStyle): number {
    return unported("rustc_mir_dataflow::framework::graphviz::OutputStyle::num_state_columns");
  },
} as const;

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:140 Formatter
class Formatter<D, A extends Analysis<D, unknown>> {
  constructor(
    public body: Body,
    public results: Results<D, A>,
    public style: OutputStyle,
    public reachable: DenseBitSet<BasicBlock>,
  ) {}

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:154 new (lane dataflow-graphviz)
  static new<D, A extends Analysis<D, unknown>>(_body: Body, _results: Results<D, A>, _style: OutputStyle): Formatter<D, A> {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::new");
  }

  // ---- impl dot::Labeller for Formatter (type Node = BasicBlock; type Edge = CfgEdge) ----

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:184 graph_id (lane dataflow-graphviz)
  graph_id(): string {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::graph_id");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:189 node_id (lane dataflow-graphviz)
  node_id(_n: BasicBlock): string {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::node_id");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:193 node_label (lane dataflow-graphviz)
  node_label(_block: BasicBlock): unknown {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::node_label");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:206 node_shape (lane dataflow-graphviz)
  node_shape(_n: BasicBlock): unknown {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::node_shape");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:210 edge_label (lane dataflow-graphviz)
  edge_label(_e: CfgEdge): unknown {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::edge_label");
  }

  // ---- impl dot::GraphWalk for Formatter ----

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:223 nodes (lane dataflow-graphviz)
  nodes(): BasicBlock[] {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::nodes");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:232 edges (lane dataflow-graphviz)
  edges(): CfgEdge[] {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::edges");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:241 source (lane dataflow-graphviz)
  source(_edge: CfgEdge): BasicBlock {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::source");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:245 target (lane dataflow-graphviz)
  target(_edge: CfgEdge): BasicBlock {
    return unported("rustc_mir_dataflow::framework::graphviz::Formatter::target");
  }
}

/// A pair of a basic block and an index into that basic blocks `successors`.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:162 CfgEdge
interface CfgEdge {
  source: BasicBlock;
  index: number;
}

// stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:167 dataflow_successors (lane dataflow-graphviz)
function dataflow_successors(_body: Body, _bb: BasicBlock): CfgEdge[] {
  return unported("rustc_mir_dataflow::framework::graphviz::dataflow_successors");
}

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:250 BlockFormatter
class BlockFormatter<D, A extends Analysis<D, unknown>> {
  constructor(
    public cursor: ResultsCursor<D, A>,
    public bg: Background,
    public style: OutputStyle,
  ) {}

  static readonly HEADER_COLOR: string = "#a0a0a0";

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:266 toggle_background (lane dataflow-graphviz)
  toggle_background(): Background {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::toggle_background");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:272 write_node_label (lane dataflow-graphviz)
  write_node_label(_block: BasicBlock, _diffs: StateDiffCollector<D, A>): IoResult<Uint8Array> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_node_label");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:393 write_block_header_simple (lane dataflow-graphviz)
  write_block_header_simple(_w: string[], _block: BasicBlock): IoResult<null> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_block_header_simple");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:425 write_block_header_with_state_columns (lane dataflow-graphviz)
  write_block_header_with_state_columns(_w: string[], _block: BasicBlock, _state_column_names: readonly string[]): IoResult<null> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_block_header_with_state_columns");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:463 write_statements_and_terminator (lane dataflow-graphviz)
  write_statements_and_terminator(_w: string[], _block: BasicBlock, _diffs: StateDiffCollector<D, A>): IoResult<null> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_statements_and_terminator");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:513 write_row (lane dataflow-graphviz)
  write_row(_w: string[], _i: string, _mir: string, _f: (self: this, w: string[], fmt: string) => IoResult<null>): IoResult<null> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_row");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:541 write_row_with_full_state (lane dataflow-graphviz)
  write_row_with_full_state(_w: string[], _i: string, _mir: string): IoResult<null> {
    return unported("rustc_mir_dataflow::framework::graphviz::BlockFormatter::write_row_with_full_state");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:567 StateDiffCollector
class StateDiffCollector<D, A extends Analysis<D, unknown>> {
  constructor(
    public analysis: A,
    public prev_state: D,
    public before: string[] | undefined,
    public after: string[],
  ) {}

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:575 run (lane dataflow-graphviz)
  static run<D, A extends Analysis<D, unknown>>(
    _body: Body,
    _block: BasicBlock,
    _results: Results<D, A>,
    _style: OutputStyle,
  ): StateDiffCollector<D, A> {
    return unported("rustc_mir_dataflow::framework::graphviz::StateDiffCollector::run");
  }

  // ---- impl ResultsVisitor for StateDiffCollector (visit_block_exit is the provided no-op) ----

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:601 visit_after_early_statement_effect (lane dataflow-graphviz)
  visit_after_early_statement_effect(_state: D, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::framework::graphviz::StateDiffCollector::visit_after_early_statement_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:613 visit_after_primary_statement_effect (lane dataflow-graphviz)
  visit_after_primary_statement_effect(_state: D, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::framework::graphviz::StateDiffCollector::visit_after_primary_statement_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:623 visit_after_early_terminator_effect (lane dataflow-graphviz)
  visit_after_early_terminator_effect(_state: D, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::framework::graphviz::StateDiffCollector::visit_after_early_terminator_effect");
  }

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:635 visit_after_primary_terminator_effect (lane dataflow-graphviz)
  visit_after_primary_terminator_effect(_state: D, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::framework::graphviz::StateDiffCollector::visit_after_primary_terminator_effect");
  }
}

// stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:646 diff_pretty (lane dataflow-graphviz)
function diff_pretty<T, C>(_new: T, _old: T, _ctxt: C): string {
  return unported("rustc_mir_dataflow::framework::graphviz::diff_pretty");
}

// #[derive(Clone, Copy)]
// rustc-type: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:693 Background
type Background = "Light" | "Dark";
const Background = {
  Light: "Light",
  Dark: "Dark",

  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:699 attr (lane dataflow-graphviz)
  attr(_self: Background): string {
    return unported("rustc_mir_dataflow::framework::graphviz::Background::attr");
  },

  /** `impl ops::Not for Background`. */
  // stub: compiler/rustc_mir_dataflow/src/framework/graphviz.rs:710 not (lane dataflow-graphviz)
  not(_self: Background): Background {
    return unported("rustc_mir_dataflow::framework::graphviz::Background::not");
  },
} as const;

/** The declarations above are module-private upstream; keep them referenced for the fill lane. */
export const _graphviz_decls = { RustcMirAttrs, OutputStyle, Formatter, dataflow_successors, BlockFormatter, StateDiffCollector, diff_pretty, Background };
