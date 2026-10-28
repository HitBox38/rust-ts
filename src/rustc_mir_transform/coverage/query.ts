// Port of compiler/rustc_mir_transform/src/coverage/query.rs (lane mt-coverage).
//
// PORT: `find_attr!(tcx, def_id, Coverage(kind) => kind)` is `find_attr(HasAttrs_LocalDefId.get_attrs(..), ..)`
// (precedent cross_crate_inline.ts). The query values typed `unknown` by queries.gen.ts (`codegen_fn_attrs`,
// `constness`) are cast to their upstream types. `trace!` calls are kept as comments.
// PORT: `priority_list[1..].sort_by_key(|&bcb| !bcbs_seen.contains(bcb))` sorts a copy of the tail with the stable
// `Array.prototype.sort` (a boolean key is a total preorder) and writes it back.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { Constness } from "../../rustc_hir/hir.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type CodegenFnAttrs, CodegenFnAttrFlags } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { BasicCoverageBlock, CoverageCodegenInfo, CoverageKind } from "../../rustc_middle/mir/coverage.ts";
import type { Body, Statement } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { HasAttrs_LocalDefId } from "../../rustc_middle/ty/mod.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { assert } from "../../std/panic.ts";
import { make_node_counters } from "./counters/node_flow.ts";
import { transcribe_counters } from "./counters.ts";

/// Registers query/hook implementations related to coverage.
// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:19 provide
export function provide(providers: Providers): void {
  providers.queries.is_eligible_for_coverage = is_eligible_for_coverage;
  providers.queries.coverage_attr_on = coverage_attr_on;
  providers.queries.coverage_codegen_info = coverage_codegen_info;
}

/// Query implementation for [`TyCtxt::is_eligible_for_coverage`].
// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:26 is_eligible_for_coverage
function is_eligible_for_coverage(tcx: TyCtxt, def_id: LocalDefId): boolean {
  // Only instrument functions, methods, and closures (not constants since they are evaluated
  // at compile time by Miri).
  // FIXME(#73156): Handle source code coverage in const eval, but note, if and when const
  // expressions get coverage spans, we will probably have to "carve out" space for const
  // expressions from coverage spans in enclosing MIR's, like we do for closures. (That might
  // be tricky if const expressions have no corresponding statements in the enclosing MIR.
  // Closures are carved out by their initial `Assign` statement.)
  const def_kind = tcx.def_kind(def_id);
  if (!DefKind.is_fn_like(def_kind)) {
    // trace!("InstrumentCoverage skipped for {def_id:?} (not an fn-like)");
    return false;
  }

  // Comptime functions can't exist at runtime, so instrumenting them is useless.
  // This also avoids an ICE when getting the symbol name for an unused-function record
  // (due to <https://github.com/rust-lang/rust/pull/159777>).
  // We check `def_kind` first to avoid any unexpected panics from merely asking for constness.
  if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
    const constness = tcx.constness(def_id) as Constness;
    if (constness.$ === "Const" && constness.always === true) {
      // trace!("InstrumentCoverage skipped for {def_id:?} (comptime)");
      return false;
    }
  }

  if (CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.NAKED)) {
    // trace!("InstrumentCoverage skipped for {def_id:?} (`#[naked]`)");
    return false;
  }

  if (!tcx.coverage_attr_on(def_id)) {
    // trace!("InstrumentCoverage skipped for {def_id:?} (`#[coverage(off)]`)");
    return false;
  }

  return true;
}

/// Query implementation for `coverage_attr_on`.
// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:65 coverage_attr_on
function coverage_attr_on(tcx: TyCtxt, def_id: LocalDefId): boolean {
  // Check for a `#[coverage(..)]` attribute on this def.
  const kind = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Coverage" ? k._0 : undefined));
  if (kind !== undefined) {
    switch (kind) {
      case "On":
        return true;
      case "Off":
        return false;
    }
  }

  // Treat `#[automatically_derived]` as an implied `#[coverage(off)]`, on
  // the assumption that most users won't want coverage for derived impls.
  //
  // This affects not just the associated items of an impl block, but also
  // any closures and other nested functions within those associated items.
  if (tcx.is_automatically_derived(LocalDefId.to_def_id(def_id))) {
    return false;
  }

  // Check the parent def (and so on recursively) until we find an
  // enclosing attribute or reach the crate root.
  const parent = tcx.opt_local_parent(def_id);
  if (parent !== undefined) {
    return tcx.coverage_attr_on(parent);
  } else {
    // We reached the crate root without seeing a coverage attribute, so
    // allow coverage instrumentation by default.
    return true;
  }
}

/// Query implementation for [`TyCtxt::coverage_codegen_info`].
// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:94 coverage_codegen_info
function coverage_codegen_info(tcx: TyCtxt, instance_def: InstanceKind): CoverageCodegenInfo | undefined {
  const mir_body = tcx.instance_mir(instance_def);
  const mir_info = mir_body.coverage_mir_info;
  if (mir_info === undefined) return undefined;

  // Scan through the final MIR to see which BCBs survived MIR opts.
  // Any BCB not in this set was optimized away.
  const bcbs_seen = DenseBitSet.new_empty<BasicCoverageBlock>(mir_info.priority_list.length);
  for (const kind of all_coverage_in_mir_body(mir_body)) {
    switch (kind.$) {
      case "VirtualCounter": {
        bcbs_seen.insert(kind.bcb);
        break;
      }
      default:
        break;
    }
  }

  // Determine the set of BCBs that are referred to by mappings, and therefore
  // need a counter. Any node not in this set will only get a counter if it
  // is part of the counter expression for a node that is in the set.
  const bcb_needs_counter = DenseBitSet.new_empty<BasicCoverageBlock>(mir_info.priority_list.length);
  for (const mapping of mir_info.mappings) {
    const kind = mapping.kind;
    switch (kind.$) {
      case "Code": {
        bcb_needs_counter.insert(kind.bcb);
        break;
      }
      case "Branch": {
        bcb_needs_counter.insert(kind.true_bcb);
        bcb_needs_counter.insert(kind.false_bcb);
        break;
      }
    }
  }

  // Clone the priority list so that we can re-sort it.
  const priority_list = mir_info.priority_list.slice();
  // The first ID in the priority list represents the synthetic "sink" node,
  // and must remain first so that it _never_ gets a physical counter.
  // debug_assert_eq!(priority_list[0], priority_list.iter().copied().max().unwrap());
  assert(!bcbs_seen.contains(priority_list[0]!), "assertion failed: !bcbs_seen.contains(priority_list[0])");
  // Partition the priority list, so that unreachable nodes (removed by MIR opts)
  // are sorted later and therefore are _more_ likely to get a physical counter.
  // This is counter-intuitive, but it means that `transcribe_counters` can
  // easily skip those unused physical counters and replace them with zero.
  // (The original ordering remains in effect within both partitions.)
  const tail = priority_list.slice(1).sort((a, b) => Number(!bcbs_seen.contains(a)) - Number(!bcbs_seen.contains(b)));
  priority_list.splice(1, tail.length, ...tail);

  const node_counters = make_node_counters(mir_info.node_flow_data, priority_list);
  const coverage_counters = transcribe_counters(node_counters, bcb_needs_counter, bcbs_seen);

  const { phys_counter_for_node, next_counter_id, node_counters: term_for_bcb, expressions } = coverage_counters;

  return {
    num_counters: next_counter_id,
    phys_counter_for_node,
    term_for_bcb,
    expressions,
  };
}

// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:158 all_coverage_in_mir_body
function all_coverage_in_mir_body(body: Body): CoverageKind[] {
  const out: CoverageKind[] = [];
  for (const bb_data of body.basic_blocks.deref()) {
    for (const statement of bb_data.statements) {
      const kind = statement.kind;
      if (kind.$ === "Coverage" && !is_inlined(body, statement)) {
        out.push(kind._0);
      }
    }
  }
  return out;
}

// rustc: compiler/rustc_mir_transform/src/coverage/query.rs:169 is_inlined
function is_inlined(body: Body, statement: Statement): boolean {
  const scope_data = body.source_scopes[statement.source_info.scope]!;
  return scope_data.inlined !== undefined || scope_data.inlined_parent_scope !== undefined;
}
