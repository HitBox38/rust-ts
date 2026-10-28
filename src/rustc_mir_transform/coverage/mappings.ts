// Port of compiler/rustc_mir_transform/src/coverage/mappings.rs (lane mt-coverage).
//
// PORT: `IndexVec<BlockMarkerId, Option<BasicBlock>>` is `(BasicBlock | undefined)[]`; the `try { .. }` block in
// `extract_branch_mappings` returns `undefined` at each `?`. `tracing::debug!` calls are kept as comments.
import type { BlockMarkerId, CoverageEarlyInfo, Mapping } from "../../rustc_middle/mir/coverage.ts";
import { type BasicBlock, type Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { build_expn_tree, type ExpnTree } from "./expansion.ts";
import type { BasicCoverageBlock, CoverageGraph } from "./graph.ts";
import type { ExtractedHirInfo } from "./hir_info.ts";
import { extract_refined_covspans } from "./spans.ts";

/// Indicates why mapping extraction failed, for debug-logging purposes.
// rustc-type: compiler/rustc_mir_transform/src/coverage/mappings.rs:16 MappingsError
export type MappingsError = "NoMappings" | "TreeSortFailure";
export const MappingsError = { NoMappings: "NoMappings", TreeSortFailure: "TreeSortFailure" } as const;

// rustc-type: compiler/rustc_mir_transform/src/coverage/mappings.rs:22 ExtractedMappings
export interface ExtractedMappings {
  mappings: Mapping[];
}

/// Extracts coverage-relevant spans from MIR, and uses them to create
/// coverage mapping data for inclusion in MIR.
// rustc: compiler/rustc_mir_transform/src/coverage/mappings.rs:28 extract_mappings_from_mir
export function extract_mappings_from_mir(
  tcx: TyCtxt,
  mir_body: Body,
  hir_info: ExtractedHirInfo,
  graph: CoverageGraph,
): Result<ExtractedMappings, MappingsError> {
  const r = build_expn_tree(mir_body, hir_info, graph);
  if (r.$ === "Err") return r;
  const expn_tree = r._0;

  const mappings: Mapping[] = [];

  // Extract ordinary code mappings from MIR statement/terminator spans.
  extract_refined_covspans(tcx, hir_info, graph, expn_tree, mappings);

  extract_branch_mappings(mir_body, hir_info, graph, expn_tree, mappings);

  if (mappings.length === 0) {
    // tracing::debug!("no mappings were extracted");
    return Err(MappingsError.NoMappings);
  }
  return Ok({ mappings });
}

// rustc: compiler/rustc_mir_transform/src/coverage/mappings.rs:50 resolve_block_markers
function resolve_block_markers(early_info: CoverageEarlyInfo, mir_body: Body): (BasicBlock | undefined)[] {
  const block_markers: (BasicBlock | undefined)[] = Array.from({ length: early_info.num_block_markers }, () => undefined);

  // Fill out the mapping from block marker IDs to their enclosing blocks.
  const blocks = mir_body.basic_blocks.deref();
  for (let bb = 0; bb < blocks.length; bb++) {
    for (const statement of blocks[bb]!.statements) {
      const kind = statement.kind;
      if (kind.$ === "Coverage" && kind._0.$ === "BlockMarker") {
        block_markers[kind._0.id] = bb as BasicBlock;
      }
    }
  }

  return block_markers;
}

// rustc: compiler/rustc_mir_transform/src/coverage/mappings.rs:71 extract_branch_mappings
function extract_branch_mappings(mir_body: Body, hir_info: ExtractedHirInfo, graph: CoverageGraph, expn_tree: ExpnTree, mappings: Mapping[]): void {
  const early_info = mir_body.coverage_early_info;
  if (early_info === undefined) return;
  const block_markers = resolve_block_markers(early_info, mir_body);

  // For now, ignore any branch span that was introduced by
  // expansion. This makes things like assert macros less noisy.
  const node = expn_tree.get(Span.ctxt(hir_info.body_span));
  if (node === undefined) return;
  if (node.expn_kind.$ !== "Root") {
    return;
  }

  for (const { span, true_marker, false_marker } of node.branch_spans) {
    const bcb_from_marker = (marker: BlockMarkerId): BasicCoverageBlock | undefined => {
      const bb = block_markers[marker];
      if (bb === undefined) return undefined;
      return graph.bcb_from_bb(bb);
    };

    const true_bcb = bcb_from_marker(true_marker);
    if (true_bcb === undefined) continue;
    const false_bcb = bcb_from_marker(false_marker);
    if (false_bcb === undefined) continue;

    mappings.push({ span, kind: { $: "Branch", true_bcb, false_bcb } });
  }
}
