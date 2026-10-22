// Port of compiler/rustc_borrowck/src/polonius/dump.rs (lane borrowck-contract: declarations; fill lane bck-polonius, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `&mut dyn io::Write` is vendor/anstream's `Write` (the `std::io::Write` port) and `io::Result<T>` src/std's
// `IoResult<T>` (mir-contract, rustc_middle mir/pretty.ts header). `writeln!` / `write!` are `write_fmt` of the rendered
// text; `?` returns the `Err`.
// PORT: `CachedLivenessSource` / `MirDumpCollector` are data-only structs (generated interfaces); their trait impls are
// the impl tables `LivenessSource_CachedLivenessSource` / `LocalizedConstraintGraphVisitor_MirDumpCollector`.
// PORT: the `BufWriter<File>` of `MirDumper::create_dump_file` is rustc_middle mir/pretty.ts's unexported `DumpFile`: its
// `drop()` (flush + close, the end of the `try` block's scope) is reached through a structural cast (as nll.ts).
import type { Body, Location } from "../../rustc_middle/mir/mod.ts";
import { debug_Location } from "../../rustc_middle/mir/mod.ts";
import type { PassWhere } from "../../rustc_middle/mir/pretty.gen.ts";
import { MirDumper, PrettyPrintMirOptions } from "../../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
// PORT: rustc_session is entered through its lib.ts (config.ts is not a fresh entry point; lib.ts of this crate).
import "../../rustc_session/lib.ts";
import { Polonius } from "../../rustc_session/config.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { debug_UniverseIndex, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { debug_RegionVid } from "../../rustc_type_ir/region_kind.gen.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { debug_str, format_debug, PLAIN } from "../../std/fmt.ts";
import type { IoResult } from "../../std/io.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { VecU8, type Write } from "../../vendor/anstream/stream.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { BorrowIndex } from "../dataflow.gen.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "../lib.gen.ts";
import { emit_nll_mir } from "../nll.ts";
import type { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { LocalizedNode } from "./constraints.gen.ts";
import { type LocalizedConstraintGraphVisitor, LocalizedConstraintGraphVisitor_provided } from "./constraints.ts";
import type { CachedLivenessSource, LocalizedOutlivesConstraint, MirDumpCollector } from "./dump.gen.ts";
import { RegionLiveness } from "./liveness.gen.ts";
import type { LivenessSource } from "./liveness.ts";
import type { PoloniusContext } from "./mod.gen.ts";
export * from "./dump.gen.ts";

/// The polonius MIR dump template: a regular HTML file for easy editing, with special dummy
/// sections to be replaced by real contents.
// rustc-const: compiler/rustc_borrowck/src/polonius/dump.rs:26 TEMPLATE = include_str!("./dump/polonius-mir-dump.template.html")
// PORT: the text of compiler/rustc_borrowck/src/polonius/dump/polonius-mir-dump.template.html at the pin, byte for byte
// (a template literal: only `` ` `` and `${` are escaped; polonius_dump.test.ts compares it with the upstream file).
// The marker is `rustc-const:`, not `rustc:`: `coverage.ts --check` accepts `// rustc:` only on upstream fns.
export const TEMPLATE: string = `<!DOCTYPE html>
<html>
<head>
<title>Polonius MIR dump</title>
<style>
pre {
    margin-top: 0;
    white-space: pre-wrap;
}

.section + .section {
    margin-top: 20px;
    border-top: 1px solid #aaa;
    padding-top: 10px;
}

.section-header {
    margin-bottom: 6px;
}

.trace + .trace {
    margin-top: 15px;
}

.trace ul {
    margin: 5px 0px;
    padding-left: 15px;
}

.trace-suffix {
    opacity: 0.8;
    margin-left: 10px;
}

.hidden {
    display: none;
}
</style>
</head>

<body>

<!-- Links to the other sections -->
<div class="section">
    <div class="section-header">Quick links</div>
    <a href="#mir">Polonius MIR</a>
    <a href="#polonius-region-graph">Polonius constraint graph</a>
    <a href="#loan-traces">Loan traces</a>
    <a href="#cfg-graph">Control-flow graph</a>
    <a href="#nll-region-graph">NLL region graph</a>
    <a href="#nll-scc-graph">NLL SCC graph</a>
</div>

<!-- The NLL + Polonius MIR -->
<div class="section" id="mir">
    <div class="section-header">Raw MIR dump</div>
    <pre><code>$SECTION_MIR</code></pre>
</div>

<!-- Mermaid visualization of the polonius constraint graph -->
<div class="section" id="polonius-region-graph">
    <div class="section-header">Polonius constraint graph</div>
    <pre class='mermaid'>$SECTION_POLONIUS_CONSTRAINTS</pre>
</div>

<!-- The reachability of loans while traversing the polonius constraint graph -->
<div class="section traces" id="loan-traces">
    <div class="section-header">Loan Traces</div>
    $SECTION_POLONIUS_REACHABILITY
</div>

<!-- Mermaid visualization of the CFG -->
<div class="section" id="cfg-graph">
    <div class="section-header">Control-flow graph</div>
    <pre class='mermaid'>$SECTION_CFG</pre>
</div>

<!-- Mermaid visualization of the NLL region graph -->
<div class="section" id="nll-region-graph">
    <div class="section-header">NLL regions</div>
    <pre class='mermaid'>$SECTION_NLL_CONSTRAINTS</pre>
</div>

<!-- Mermaid visualization of the NLL SCC graph -->
<div class="section" id="nll-scc-graph">
    <div class="section-header">NLL SCCs</div>
    <pre class='mermaid'>$SECTION_NLL_SCCS</pre>
</div>

<script src='https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js'></script>
$SECTION_INITIALIZATION
<script>
// Set up the loan traces buttons.
document.querySelectorAll(".traces button").forEach(button => {
    button.addEventListener("click", e => {
        // We remove the class hiding the trace by default.
        let loan = button.getAttribute("data-loan");
        let trace = document.getElementById(\`trace-\${loan}\`);
        trace.classList.remove("hidden");

        // And we also remove the button's container.
        button.parentElement.remove();
    });
});
</script>
</body>
</html>
`;

// impl<'a, 'tcx> LivenessSource for CachedLivenessSource<'a, 'tcx>
export const LivenessSource_CachedLivenessSource: LivenessSource<CachedLivenessSource> = {
  // rustc: compiler/rustc_borrowck/src/polonius/dump.rs:36 liveness_for_region
  liveness_for_region(self: CachedLivenessSource, region: RegionVid): RegionLiveness {
    return RegionLiveness.new(region, self.live_region_variances, self.universal_regions, self.liveness.points());
  },
};

/// `-Zdump-mir=polonius` dumps MIR annotated with NLL and polonius specific information.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:47 dump_polonius_mir
export function dump_polonius_mir(
  infcx: BorrowckInferCtxt,
  body: Body,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  polonius_context: PoloniusContext | undefined,
): void {
  const tcx = infcx.tcx;
  if (!Polonius.is_next_enabled(tcx.sess.opts.unstable_opts.polonius)) {
    return;
  }

  const dumper_ = MirDumper.new(tcx, "polonius", body);
  if (dumper_ === undefined) return;

  const polonius_context_ = unwrap(polonius_context, "missing polonius context with `-Zpolonius=next`");

  // If we have a polonius graph to dump along the rest of the MIR and NLL info, we extract its
  // constraints here.
  const liveness_source: CachedLivenessSource = {
    live_region_variances: polonius_context_.live_region_variances,
    universal_regions: regioncx.universal_regions(),
    liveness: regioncx.liveness_constraints_(),
  };
  // `MirDumpCollector::default()`
  const collector: MirDumpCollector = { constraints: [], reachability: new Map() };
  const graph = polonius_context_.graph;
  if (graph !== undefined) {
    const location_map = regioncx.liveness_constraints_().location_map_();
    graph.traverse(
      body,
      borrow_set,
      location_map,
      liveness_source,
      collector,
      LivenessSource_CachedLivenessSource,
      LocalizedConstraintGraphVisitor_MirDumpCollector,
    );
  }

  const extra_data = (pass_where: PassWhere, out: Write): IoResult<void> => {
    return emit_polonius_mir(tcx, regioncx, closure_region_requirements, borrow_set, collector.constraints, pass_where, out);
  };
  // We want the NLL extra comments printed by default in NLL MIR dumps. Specifying `-Z
  // mir-include-spans` on the CLI still has priority.
  const mir_include_spans = tcx.sess.opts.unstable_opts.mir_include_spans;
  const options = new PrettyPrintMirOptions(mir_include_spans === "On" || mir_include_spans === "Nll");

  const dumper = dumper_.set_extra_data(extra_data).set_options(options);

  // let _ = try { .. };
  {
    const file = dumper.create_dump_file("html", body);
    if (file.$ === "Ok") {
      try {
        emit_polonius_dump(dumper, body, regioncx, borrow_set, collector, file._0);
      } finally {
        (file._0 as Write & { drop(): void }).drop();
      }
    }
  }
}

// impl LocalizedConstraintGraphVisitor for MirDumpCollector
export const LocalizedConstraintGraphVisitor_MirDumpCollector: LocalizedConstraintGraphVisitor<MirDumpCollector> = {
  ...LocalizedConstraintGraphVisitor_provided,
  // rustc: compiler/rustc_borrowck/src/polonius/dump.rs:123 on_node_traversed
  on_node_traversed(self: MirDumpCollector, loan: BorrowIndex, node: LocalizedNode, _is_live: boolean): void {
    // `self.reachability.entry(loan).or_default().push(node)`
    let nodes = self.reachability.get(loan);
    if (nodes === undefined) {
      nodes = [];
      self.reachability.set(loan, nodes);
    }
    nodes.push(node);
  },

  // rustc: compiler/rustc_borrowck/src/polonius/dump.rs:127 on_successor_discovered
  on_successor_discovered(self: MirDumpCollector, current_node: LocalizedNode, successor: LocalizedNode): void {
    self.constraints.push({
      source: current_node.region,
      from: current_node.point,
      target: successor.region,
      to: successor.point,
    });
  },
};

/// The polonius dump consists of:
/// - the NLL MIR
/// - the list of polonius localized constraints
/// - a mermaid graph of the CFG
/// - a mermaid graph of the NLL regions and the constraints between them
/// - a mermaid graph of the NLL SCCs and the constraints between them
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:143 emit_polonius_dump
function emit_polonius_dump(
  dumper: MirDumper,
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
  collector: MirDumpCollector,
  out: Write,
): IoResult<void> {
  let r: IoResult<unknown>;
  let edge_count = 0;

  // We replace the dummy $SECTION tokens from the HTML polonius dump template, and emit the
  // result into the given writer.
  for (const chunk of TEMPLATE.split("$SECTION")) {
    const section = chunk.startsWith("_") ? chunk.slice(1) : undefined;
    if (section === undefined) {
      // We're at the beginning of the template: this is the prologue to emit as-is.
      if ((r = out.write_fmt([`${chunk}\n`])).$ === "Err") return r;
    } else {
      // This is the start of a prefixed section, we look for its identifier.
      const dummy_section_end = section.indexOf("<");
      if (dummy_section_end < 0) {
        return panic("the template section end boundary needs to be present");
      }
      const section_identifier = section.slice(0, dummy_section_end).trim();

      // Emit the real section instead of the dummy token.
      switch (section_identifier) {
        case "MIR": {
          if ((r = emit_html_mir(dumper, body, out)).$ === "Err") return r;
          break;
        }
        case "POLONIUS_CONSTRAINTS": {
          const e = emit_mermaid_constraint_graph(borrow_set, regioncx.liveness_constraints_().location_map_(), collector.constraints, out);
          if (e.$ === "Err") return e;
          edge_count = e._0;
          break;
        }
        case "POLONIUS_REACHABILITY": {
          if ((r = emit_loan_reachability(borrow_set, regioncx.liveness_constraints_(), collector.reachability, out)).$ === "Err") return r;
          break;
        }
        case "CFG": {
          if ((r = emit_mermaid_cfg(body, out)).$ === "Err") return r;
          break;
        }
        case "NLL_CONSTRAINTS": {
          if ((r = emit_mermaid_nll_regions(dumper.tcx(), regioncx, out)).$ === "Err") return r;
          break;
        }
        case "NLL_SCCS": {
          if ((r = emit_mermaid_nll_sccs(dumper.tcx(), regioncx, out)).$ === "Err") return r;
          break;
        }
        case "INITIALIZATION": {
          if ((r = out.write_fmt(["<script>\n"])).$ === "Err") return r;
          if ((r = out.write_fmt([`mermaid.initialize({ startOnLoad: false, maxEdges: ${Math.max(edge_count, 100)} });\n`])).$ === "Err") return r;
          if ((r = out.write_fmt(["mermaid.run({ querySelector: '.mermaid' })\n"])).$ === "Err") return r;
          if ((r = out.write_fmt(["</script>\n"])).$ === "Err") return r;
          break;
        }

        default: {
          return unreachable(`internal error: entered unreachable code: unexpected dummy section identifier ${debug_str(section_identifier)}`);
        }
      }

      // And finally, emit the contents that followed the dummy token.
      if ((r = out.write_fmt([`${section.slice(dummy_section_end)}\n`])).$ === "Err") return r;
    }
  }

  return Ok(undefined);
}

/** PORT: `String::from_utf8_lossy` (WHATWG decoding replaces maximal invalid subparts with U+FFFD, as std does). */
function String_from_utf8_lossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
}

/// Emits the polonius MIR, as escaped HTML.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:224 emit_html_mir
function emit_html_mir(dumper: MirDumper, body: Body, out: Write): IoResult<void> {
  let r: IoResult<unknown>;
  // Buffer the regular MIR dump to be able to escape it.
  const buffer_ = new VecU8();

  if ((r = dumper.dump_mir_to_writer(body, buffer_)).$ === "Err") return r;

  // Escape the handful of characters that need it. We don't need to be particularly efficient:
  // we're actually writing into a buffered writer already. Note that MIR dumps are valid UTF-8.
  const buffer = String_from_utf8_lossy(buffer_.bytes());
  for (const ch of buffer) {
    let escaped: string;
    switch (ch) {
      case ">":
        escaped = "&gt;";
        break;
      case "<":
        escaped = "&lt;";
        break;
      case "&":
        escaped = "&amp;";
        break;
      case "'":
        escaped = "&#39;";
        break;
      case '"':
        escaped = "&quot;";
        break;
      default: {
        // The common case, no escaping needed.
        if ((r = out.write_fmt([ch])).$ === "Err") return r;
        continue;
      }
    }
    if ((r = out.write_fmt([escaped])).$ === "Err") return r;
  }
  return Ok(undefined);
}

/// Produces the actual NLL + Polonius MIR sections to emit during the dumping process.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:256 emit_polonius_mir
function emit_polonius_mir(
  tcx: TyCtxt,
  regioncx: RegionInferenceContext,
  closure_region_requirements: ClosureRegionRequirements | undefined,
  borrow_set: BorrowSet,
  localized_outlives_constraints: readonly LocalizedOutlivesConstraint[],
  pass_where: PassWhere,
  out: Write,
): IoResult<void> {
  let r: IoResult<unknown>;
  // Emit the regular NLL front-matter
  if ((r = emit_nll_mir(tcx, regioncx, closure_region_requirements, borrow_set, pass_where, out)).$ === "Err") return r;

  const location_map = regioncx.liveness_constraints_().location_map_();

  // Add localized outlives constraints
  switch (pass_where.$) {
    case "BeforeCFG": {
      if (localized_outlives_constraints.length > 0) {
        if ((r = out.write_fmt(["| Localized constraints\n"])).$ === "Err") return r;

        for (const constraint of localized_outlives_constraints) {
          const { source, from: from_, target, to: to_ } = constraint;
          const from = location_map.to_location(from_);
          const to = location_map.to_location(to_);
          if (
            (r = out.write_fmt([
              `| ${format_debug(source, debug_RegionVid, PLAIN)} at ${format_debug(from, debug_Location, PLAIN)} -> ${format_debug(target, debug_RegionVid, PLAIN)} at ${format_debug(to, debug_Location, PLAIN)}\n`,
            ])).$ === "Err"
          )
            return r;
        }
        if ((r = out.write_fmt(["|\n"])).$ === "Err") return r;
      }
      break;
    }
    default:
      break;
  }

  return Ok(undefined);
}

/// Emits a mermaid flowchart of the CFG blocks and edges, similar to the graphviz version.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:299 emit_mermaid_cfg
function emit_mermaid_cfg(body: Body, out: Write): IoResult<void> {
  // use rustc_middle::mir::{TerminatorEdges, TerminatorKind};
  let r: IoResult<unknown>;

  // The mermaid chart type: a top-down flowchart.
  if ((r = out.write_fmt(["flowchart TD\n"])).$ === "Err") return r;

  const basic_blocks = body.basic_blocks.deref();

  // Emit the block nodes.
  for (const [block_idx, block] of basic_blocks.entries()) {
    const cleanup = block.is_cleanup ? " (cleanup)" : "";
    if ((r = out.write_fmt([`${block_idx}["bb${block_idx}${cleanup}"]\n`])).$ === "Err") return r;
  }

  // Emit the edges between blocks, from the terminator edges.
  for (const [block_idx, block] of basic_blocks.entries()) {
    const terminator = block.terminator_();
    const edges = terminator.edges();
    switch (edges.$) {
      case "None":
        break;
      case "Single": {
        if ((r = out.write_fmt([`${block_idx} --> ${edges._0}\n`])).$ === "Err") return r;
        break;
      }
      case "Double": {
        const bb1 = edges._0;
        const bb2 = edges._1;
        if (terminator.kind.$ === "FalseEdge") {
          if ((r = out.write_fmt([`${block_idx} --> ${bb1}\n`])).$ === "Err") return r;
          if ((r = out.write_fmt([`${block_idx} -- imaginary --> ${bb2}\n`])).$ === "Err") return r;
        } else {
          if ((r = out.write_fmt([`${block_idx} --> ${bb1}\n`])).$ === "Err") return r;
          if ((r = out.write_fmt([`${block_idx} -- unwind --> ${bb2}\n`])).$ === "Err") return r;
        }
        break;
      }
      case "AssignOnReturn": {
        const { return_, cleanup } = edges;
        for (const to_idx of return_) {
          if ((r = out.write_fmt([`${block_idx} --> ${to_idx}\n`])).$ === "Err") return r;
        }

        if (cleanup !== undefined) {
          const to_idx = cleanup;
          if ((r = out.write_fmt([`${block_idx} -- unwind --> ${to_idx}\n`])).$ === "Err") return r;
        }
        break;
      }
      case "SwitchInt": {
        const { targets } = edges;
        for (const to_idx of targets.all_targets()) {
          if ((r = out.write_fmt([`${block_idx} --> ${to_idx}\n`])).$ === "Err") return r;
        }
        break;
      }
    }
  }

  return Ok(undefined);
}

/// Emits a region's label: index, universe, external name.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:351 render_region
function render_region(tcx: TyCtxt, region: RegionVid, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  let r: IoResult<unknown>;
  const def = regioncx.region_definition(region);
  const universe = def.universe;

  if ((r = out.write_fmt([`'${region}`])).$ === "Err") return r;
  if (!UniverseIndex.is_root(universe)) {
    if ((r = out.write_fmt([`/${format_debug(universe, debug_UniverseIndex, PLAIN)}`])).$ === "Err") return r;
  }
  const name = def.external_name !== undefined ? def.external_name.get_name(tcx) : undefined;
  if (name !== undefined) {
    if ((r = out.write_fmt([` (${display_Symbol(name)})`])).$ === "Err") return r;
  }
  return Ok(undefined);
}

/// Emits a mermaid flowchart of the NLL regions and the outlives constraints between them, similar
/// to the graphviz version.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:372 emit_mermaid_nll_regions
function emit_mermaid_nll_regions(tcx: TyCtxt, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  let r: IoResult<unknown>;
  // The mermaid chart type: a top-down flowchart.
  if ((r = out.write_fmt(["flowchart TD\n"])).$ === "Err") return r;

  // Emit the region nodes.
  for (let region_ = 0; region_ < regioncx.definitions.length; region_++) {
    const region = region_ as RegionVid;
    if ((r = out.write_fmt([`${region}["`])).$ === "Err") return r;
    if ((r = render_region(tcx, region, regioncx, out)).$ === "Err") return r;
    if ((r = out.write_fmt(['"]\n'])).$ === "Err") return r;
  }

  // Get a set of edges to check for the reverse edge being present.
  // PORT: `FxHashSet<(RegionVid, RegionVid)>` keyed by the pair's text (membership only).
  const edges = new Set<string>();
  for (const c of regioncx.outlives_constraints()) edges.add(`${c.sup},${c.sub}`);

  // Order (and deduplicate) edges for traversal, to display them in a generally increasing order.
  const constraint_key = (c: OutlivesConstraint): [RegionVid, RegionVid] => {
    const min = Math.min(c.sup, c.sub) as RegionVid;
    const max = Math.max(c.sup, c.sub) as RegionVid;
    return [min, max];
  };
  const ordered_edges: OutlivesConstraint[] = [...regioncx.outlives_constraints()];
  // `sort_by_key` (stable, as `Array.prototype.sort`) on the `(min, max)` tuple.
  ordered_edges.sort((a, b) => {
    const ka = constraint_key(a);
    const kb = constraint_key(b);
    return ka[0] !== kb[0] ? ka[0] - kb[0] : ka[1] - kb[1];
  });
  // `dedup_by_key`: drops consecutive elements whose key equals the last kept one.
  {
    let w = 0;
    for (let i = 0; i < ordered_edges.length; i++) {
      if (w > 0) {
        const kp = constraint_key(ordered_edges[w - 1]!);
        const ki = constraint_key(ordered_edges[i]!);
        if (kp[0] === ki[0] && kp[1] === ki[1]) continue;
      }
      ordered_edges[w++] = ordered_edges[i]!;
    }
    ordered_edges.length = w;
  }

  for (const outlives of ordered_edges) {
    // Source node.
    if ((r = out.write_fmt([`${outlives.sup} `])).$ === "Err") return r;

    // The kind of arrow: bidirectional if the opposite edge exists in the set.
    if (edges.has(`${outlives.sub},${outlives.sup}`)) {
      if ((r = out.write_fmt(["&lt;"])).$ === "Err") return r;
    }
    if ((r = out.write_fmt(["-- "])).$ === "Err") return r;

    // Edge label from its `Locations`.
    const locations = outlives.locations;
    switch (locations.$) {
      case "All":
        if ((r = out.write_fmt(["All"])).$ === "Err") return r;
        break;
      case "Single":
        if ((r = out.write_fmt([format_debug(locations._0, debug_Location, PLAIN)])).$ === "Err") return r;
        break;
    }

    // Target node.
    if ((r = out.write_fmt([` --> ${outlives.sub}\n`])).$ === "Err") return r;
  }
  return Ok(undefined);
}

/// Emits a mermaid flowchart of the NLL SCCs and the outlives constraints between them, similar
/// to the graphviz version.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:424 emit_mermaid_nll_sccs
function emit_mermaid_nll_sccs(tcx: TyCtxt, regioncx: RegionInferenceContext, out: Write): IoResult<void> {
  let r: IoResult<unknown>;
  // The mermaid chart type: a top-down flowchart.
  if ((r = out.write_fmt(["flowchart TD\n"])).$ === "Err") return r;

  // Gather and emit the SCC nodes.
  const nodes_per_scc: RegionVid[][] = regioncx
    .constraint_sccs_()
    .all_sccs()
    .map((): RegionVid[] => []);
  for (let region_ = 0; region_ < regioncx.definitions.length; region_++) {
    const region = region_ as RegionVid;
    const scc = regioncx.constraint_sccs_().scc(region);
    nodes_per_scc[scc]!.push(region);
  }
  for (const [scc, regions] of nodes_per_scc.entries()) {
    // The node label: the regions contained in the SCC.
    if ((r = out.write_fmt([`${scc}["SCC(${scc}) = {`])).$ === "Err") return r;
    for (const [idx, region] of regions.entries()) {
      if ((r = render_region(tcx, region, regioncx, out)).$ === "Err") return r;
      if (idx < regions.length - 1) {
        if ((r = out.write_fmt([","])).$ === "Err") return r;
      }
    }
    if ((r = out.write_fmt(['}"]\n'])).$ === "Err") return r;
  }

  // Emit the edges between SCCs.
  const sccs = regioncx.constraint_sccs_();
  for (const source of sccs.all_sccs()) {
    for (const target of sccs.successors(source)) {
      if ((r = out.write_fmt([`${source} --> ${target}\n`])).$ === "Err") return r;
    }
  }

  return Ok(undefined);
}

/// Emits a mermaid flowchart of the polonius localized outlives constraints, with subgraphs per
/// region, and loan introductions.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:464 emit_mermaid_constraint_graph
function emit_mermaid_constraint_graph(
  borrow_set: BorrowSet,
  location_map: DenseLocationMap,
  localized_outlives_constraints: readonly LocalizedOutlivesConstraint[],
  out: Write,
): IoResult<number> {
  let r: IoResult<unknown>;
  const node_label = (region: RegionVid, point: PointIndex): string => {
    const location = location_map.to_location(point);
    return node_name(region, location);
  };

  // The mermaid chart type: a top-down flowchart, which supports subgraphs.
  if ((r = out.write_fmt(["flowchart TD\n"])).$ === "Err") return r;

  // The loans subgraph: a node per loan.
  if ((r = out.write_fmt(['    subgraph "Loans"\n'])).$ === "Err") return r;
  for (let loan_idx = 0; loan_idx < borrow_set.len(); loan_idx++) {
    if ((r = out.write_fmt([`        L${loan_idx}\n`])).$ === "Err") return r;
  }
  if ((r = out.write_fmt(["    end\n\n"])).$ === "Err") return r;

  // And an edge from that loan node to where it enters the constraint graph.
  for (const [loan_idx, loan] of borrow_set.iter_enumerated()) {
    if ((r = out.write_fmt([`    L${BorrowIndex.index(loan_idx)} --> ${region_name(loan.region)}_${location_name(loan.reserve_location)}\n`])).$ === "Err") return r;
  }
  if ((r = out.write_fmt(["\n"])).$ === "Err") return r;

  // The regions subgraphs containing the region/point nodes.
  // PORT: `FxIndexMap<RegionVid, FxIndexSet<PointIndex>>`: insertion-ordered `Map` / `Set`.
  const points_per_region = new Map<RegionVid, Set<PointIndex>>();
  const entry_or_default = (region: RegionVid): Set<PointIndex> => {
    let points = points_per_region.get(region);
    if (points === undefined) {
      points = new Set();
      points_per_region.set(region, points);
    }
    return points;
  };
  for (const constraint of localized_outlives_constraints) {
    entry_or_default(constraint.source).add(constraint.from);
    entry_or_default(constraint.target).add(constraint.to);
  }
  for (const [region, points] of points_per_region) {
    if ((r = out.write_fmt([`    subgraph "${region_name(region)}"\n`])).$ === "Err") return r;
    for (const point of points) {
      if ((r = out.write_fmt([`        ${node_label(region, point)}\n`])).$ === "Err") return r;
    }
    if ((r = out.write_fmt(["    end\n\n"])).$ === "Err") return r;
  }

  // The constraint graph edges.
  for (const constraint of localized_outlives_constraints) {
    // FIXME: add killed loans and constraint kind as edge labels.
    if ((r = out.write_fmt([`    ${node_label(constraint.source, constraint.from)} --> ${node_label(constraint.target, constraint.to)}\n`])).$ === "Err") return r;
  }

  // Return the number of edges: this is the biggest graph in the dump and its edge count will be
  // mermaid's max edge count to support.
  const edge_count = borrow_set.len() + localized_outlives_constraints.length;
  return Ok(edge_count);
}

/// Emits the reachability of loans: a list of all nodes reached while traversing the polonius
/// constraint graph.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:531 emit_loan_reachability
function emit_loan_reachability(
  borrow_set: BorrowSet,
  liveness: LivenessValues,
  reachability: Map<BorrowIndex, LocalizedNode[]>,
  out: Write,
): IoResult<void> {
  let r: IoResult<unknown>;
  const location_map = liveness.location_map_();
  for (const [loan_, _] of borrow_set.iter_enumerated()) {
    const reachability_ = reachability.get(loan_);
    if (reachability_ === undefined) {
      continue;
    }
    const loan = `L${BorrowIndex.index(loan_)}`;

    // The button to display the loan trace. The javascript event listener is hooked up in the
    // template itself.
    if ((r = out.write_fmt([`<div class='trace'><button data-loan='${loan}'>Trace for loan ${loan}</button></div>\n`])).$ === "Err") return r;

    // The actual trace contents, hidden by default.
    if ((r = out.write_fmt([`<div id='trace-${loan}' class='trace hidden'>\n`])).$ === "Err") return r;
    if ((r = out.write_fmt([`<div>Trace for loan ${loan}</div>\n`])).$ === "Err") return r;
    if ((r = out.write_fmt(["<ul>\n"])).$ === "Err") return r;
    for (const [idx, node] of reachability_.entries()) {
      if ((r = out.write_fmt(["<li>\n"])).$ === "Err") return r;

      const location = location_map.to_location(node.point);
      const kind = idx === 0 ? "starts in" : "reaches";
      if ((r = out.write_fmt([`<code>${loan}</code> ${kind} <code>${node_name(node.region, location)}</code>\n`])).$ === "Err") return r;

      // It's useful to know whether the region we're reaching is live at this point.
      const node_liveness = liveness.is_live_at(node.region, location) ? "live" : "not live";
      if ((r = out.write_fmt(["<span class='trace-suffix'>\n"])).$ === "Err") return r;
      if ((r = out.write_fmt([`/ at <code>${format_debug(location, debug_Location, PLAIN)}</code>: <code>'${node.region}</code> is ${node_liveness}\n`])).$ === "Err") return r;
      if ((r = out.write_fmt(["</span>\n"])).$ === "Err") return r;
      if ((r = out.write_fmt(["</li>\n"])).$ === "Err") return r;
    }
    if ((r = out.write_fmt(["</ul>\n"])).$ === "Err") return r;
    if ((r = out.write_fmt(["</div>\n"])).$ === "Err") return r;
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:587 region_name
function region_name(region: RegionVid): string {
  return `'${region}`;
}
/// A MIR location looks like `bb5[2]`. As that is not a syntactically valid mermaid node id,
/// transform it into `BB5_2`.
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:592 location_name
function location_name(location: Location): string {
  return `BB${location.block}_${location.statement_index}`;
}
// rustc: compiler/rustc_borrowck/src/polonius/dump.rs:595 node_name
function node_name(region: RegionVid, location: Location): string {
  return `${region_name(region)}_${location_name(location)}`;
}
