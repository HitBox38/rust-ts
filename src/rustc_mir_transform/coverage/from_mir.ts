// Port of compiler/rustc_mir_transform/src/coverage/from_mir.rs (lane mt-coverage).
//
// PORT: the `filter_map(..).map(..)` chain is a loop; `#[derive(Debug)]` on `RawSpanFromMir` is only reached by tracing
// and is not ported.
import type { Body, Statement } from "../../rustc_middle/mir/mod.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { BasicCoverageBlock, CoverageGraph } from "./graph.ts";
import type { ExtractedHirInfo } from "./hir_info.ts";

// rustc-type: compiler/rustc_mir_transform/src/coverage/from_mir.rs:9 RawSpanFromMir
export interface RawSpanFromMir {
  /// A span that has been extracted from a MIR marker statement, but
  /// hasn't been "unexpanded", so it might not lie within the function body
  /// span and might be part of an expansion with a different context.
  raw_span: Span;
  bcb: BasicCoverageBlock;
}

/// Generates an initial set of coverage spans from marker statements in the function's
/// MIR body, each associated with its corresponding node in the coverage graph.
///
/// FIXME(Zalathar): This extraction is currently in a transitional state, since we're
/// no longer trying to heuristically recover meaningful spans from MIR soup, but we
/// haven't yet fully embraced the possibilities of HIR-aware analysis.
// rustc: compiler/rustc_mir_transform/src/coverage/from_mir.rs:23 extract_raw_spans_from_mir
export function extract_raw_spans_from_mir(mir_body: Body, hir_info: ExtractedHirInfo, graph: CoverageGraph): RawSpanFromMir[] {
  const raw_spans: RawSpanFromMir[] = [];

  // We only care about blocks that are part of the coverage graph.
  for (const [bcb, bcb_data] of graph.iter_enumerated()) {
    // A coverage graph node can consist of multiple basic blocks.
    for (const bb of bcb_data.basic_blocks) {
      const statements = mir_body.index(bb).statements;
      for (const stmt of statements) {
        const raw_span = filtered_statement_span(hir_info, stmt);
        if (raw_span === undefined) continue;
        raw_spans.push({ raw_span, bcb });
      }
    }
  }

  return raw_spans;
}

/// If the MIR `Statement` has a span contributive to computing coverage spans,
/// return it; otherwise return `None`.
// rustc: compiler/rustc_mir_transform/src/coverage/from_mir.rs:48 filtered_statement_span
function filtered_statement_span(hir_info: ExtractedHirInfo, statement: Statement): Span | undefined {
  const kind = statement.kind;
  if (!(kind.$ === "Coverage" && kind._0.$ === "Point")) {
    return undefined;
  }
  const { point_kind, hir_id } = kind._0;
  switch (point_kind) {
    // These PointKind variants contribute to normal code spans.
    // (Other variants added in the future might want to return None here.)
    case "Expr":
    case "ImplicitElse":
    case "FunctionEnd":
      break;
  }
  if (hir_info.nodes_to_ignore.has(hir_id)) {
    return undefined;
  }

  return statement.source_info.span;
}
