// Port of compiler/rustc_mir_transform/src/coverage/mod.rs (lane mt-coverage).
//
// PORT: `trace!` / `debug!` / `debug_span!` calls are kept as comments. `CoverageMirInfo::function_source_hash` is
// declared `number` by the generated type (rustc_middle/mir/coverage.gen.ts) although it is a `u64`; the `bigint` from
// hir_info.ts is stored through a cast (handoff: tools/codegen should map that field to `bigint`; no MIR dump prints it).
import { type CoverageKind } from "../../rustc_middle/mir/coverage.ts";
import { type BasicBlock, type Body, clone_SourceInfo, START_BLOCK, Statement } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { assert } from "../../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "../pass_manager.ts";
import * as counters from "./counters.ts";
import { CoverageGraph } from "./graph.ts";
import * as hir_info from "./hir_info.ts";
import * as mappings from "./mappings.ts";

// mod counters;
// mod expansion;
// mod from_mir;
// mod graph;
// mod hir_info;
// mod mappings;
// pub(super) mod query;
export * as query from "./query.ts";
// mod spans;
// #[cfg(test)]
// mod tests; (tests.test.ts)

/// Inserts `StatementKind::Coverage` statements that either instrument the binary with injected
/// counters, via intrinsic `llvm.instrprof.increment`, and/or inject metadata used during codegen
/// to construct the coverage map.
// rustc-type: compiler/rustc_mir_transform/src/coverage/mod.rs:25 InstrumentCoverage
export class InstrumentCoverage extends MirPass {
  readonly type_name = "rustc_mir_transform::coverage::InstrumentCoverage";

  // rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:28 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.deref().instrument_coverage());
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:32 run_pass
  run_pass(tcx: TyCtxt, mir_body: Body): void {
    const mir_source = mir_body.source;

    // This pass runs after MIR promotion, but before promoted MIR starts to
    // be transformed, so it should never see promoted MIR.
    assert(mir_source.promoted === undefined, "assertion failed: mir_source.promoted.is_none()");

    const def_id = mir_source.def_id().expect_local();

    if (!tcx.is_eligible_for_coverage(def_id)) {
      // trace!("InstrumentCoverage skipped for {def_id:?} (not eligible)");
      return;
    }

    // An otherwise-eligible function is still skipped if its start block
    // is known to be unreachable.
    switch (mir_body.index(START_BLOCK).terminator_().kind.$) {
      case "Unreachable": {
        // trace!("InstrumentCoverage skipped for unreachable `START_BLOCK`");
        return;
      }
      default:
        break;
    }

    instrument_function_for_coverage(tcx, mir_body);
  }
}

// rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:60 instrument_function_for_coverage
function instrument_function_for_coverage(tcx: TyCtxt, mir_body: Body): void {
  // let _span = debug_span!("instrument_function_for_coverage", def_id = ?mir_body.source.def_id()).entered();

  const hir_info_ = hir_info.extract_hir_info(tcx, mir_body);

  // Build the coverage graph, which is a simplified view of the MIR control-flow
  // graph that ignores some details not relevant to coverage instrumentation.
  const graph = CoverageGraph.from_mir(mir_body);

  ////////////////////////////////////////////////////
  // Extract coverage spans and other mapping info from MIR.
  const r = mappings.extract_mappings_from_mir(tcx, mir_body, hir_info_, graph);
  if (r.$ === "Err") {
    // tracing::debug!(?error, "mapping extraction failed; skipping this function");
    return;
  }
  const { mappings: mappings_ } = r._0;

  // Use the coverage graph to prepare intermediate data that will eventually
  // be used to assign physical counters and counter expressions to points in
  // the control-flow graph.
  const { node_flow_data, priority_list } = counters.prepare_bcb_counters_data(graph);

  // Inject coverage statements into MIR.
  inject_coverage_statements(mir_body, graph);

  mir_body.coverage_mir_info = {
    function_source_hash: hir_info_.function_source_hash as unknown as number,

    node_flow_data,
    priority_list,

    mappings: mappings_,
  };
}

/// Inject any necessary coverage statements into MIR, so that they influence codegen.
// rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:101 inject_coverage_statements
function inject_coverage_statements(mir_body: Body, graph: CoverageGraph): void {
  for (const [bcb, data] of graph.iter_enumerated()) {
    const target_bb = data.leader_bb();
    inject_statement(mir_body, { $: "VirtualCounter", bcb }, target_bb);
  }
}

// rustc: compiler/rustc_mir_transform/src/coverage/mod.rs:108 inject_statement
function inject_statement(mir_body: Body, counter_kind: CoverageKind, bb: BasicBlock): void {
  // debug!("  injecting statement {counter_kind:?} for {bb:?}");
  const data = mir_body.index_mut(bb);
  const source_info = clone_SourceInfo(data.terminator_().source_info);
  const statement = Statement.new(source_info, { $: "Coverage", _0: counter_kind });
  data.statements.splice(0, 0, statement);
}
