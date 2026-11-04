// Port of compiler/rustc_monomorphize/src/graph_checks/statics.rs (lane mono-partition).
//
// PORT: `StaticNodeIdx(usize)` (`Idx`, `From<usize>`) and `StaticSccIdx` (`newtype_index!`) are numbers.
// PORT: `FxIndexSet<DefId>` is `StaticsSet`: a `DefId[]` (index -> `DefId`) with a `DefIdMap` (`get_index_of`).
import { DirectedGraph_provided, type Successors } from "../../rustc_data_structures/graph/mod.ts";
import { Sccs } from "../../rustc_data_structures/graph/scc/mod.ts";
import type { MonoItem } from "../../rustc_middle/mono.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { KeyedMap } from "../../rust_ts/keyed.ts";
import { type DefId, DefIdMap } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { panic } from "../../std/panic.ts";
import { StaticInitializerCyclic_diagnostic, type UsageMap } from "../pending_mono_collector.ts";

// rustc-type: compiler/rustc_monomorphize/src/graph_checks/statics.rs:14 StaticNodeIdx
// #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
type StaticNodeIdx = number & { readonly __brand: "StaticNodeIdx" };

// impl Idx for StaticNodeIdx
// rustc-skip: compiler/rustc_monomorphize/src/graph_checks/statics.rs:17 new `StaticNodeIdx` is a number
// rustc-skip: compiler/rustc_monomorphize/src/graph_checks/statics.rs:21 index `StaticNodeIdx` is a number

// impl From<usize> for StaticNodeIdx
// rustc-skip: compiler/rustc_monomorphize/src/graph_checks/statics.rs:27 from `StaticNodeIdx` is a number

// newtype_index! {
//     #[orderable]
//     struct StaticSccIdx {}
// }
type StaticSccIdx = number & { readonly __brand: "StaticSccIdx" };

/** `FxIndexSet<DefId>` */
class StaticsSet {
  readonly list: DefId[] = [];
  private readonly index = new DefIdMap<number>();

  insert(def_id: DefId): void {
    if (!this.index.has(def_id)) {
      this.index.set(def_id, this.list.length);
      this.list.push(def_id);
    }
  }

  get_index_of(def_id: DefId): number | undefined {
    return this.index.get(def_id);
  }
}

// Adjacency-list graph for statics using `StaticNodeIdx` as node type.
// We cannot use `DefId` as the node type directly because each node must be
// represented by an index in the range `0..num_nodes`.
class StaticRefGraph implements Successors<StaticNodeIdx> {
  constructor(
    // maps from `StaticNodeIdx` to `DefId` and vice versa
    readonly statics: StaticsSet,
    // contains for each `MonoItem` the `MonoItem`s it uses
    readonly used_map: KeyedMap<MonoItem, MonoItem[]>,
  ) {}

  // rustc: compiler/rustc_monomorphize/src/graph_checks/statics.rs:50 num_nodes
  num_nodes(): number {
    return this.statics.list.length;
  }

  // rustc: compiler/rustc_monomorphize/src/graph_checks/statics.rs:56 successors
  successors(node_idx: StaticNodeIdx): StaticNodeIdx[] {
    const def_id = this.statics.list[node_idx]!;
    const used = this.used_map.get({ $: "Static", _0: def_id });
    // `IndexMap`'s `Index` panics on a missing key.
    if (used === undefined) panic("no entry found for key");
    const out: StaticNodeIdx[] = [];
    for (const mono_item of used) {
      if (mono_item.$ === "Static") {
        const idx = this.statics.get_index_of(mono_item._0);
        if (idx !== undefined) out.push(idx as StaticNodeIdx);
      }
    }
    return out;
  }
}

// rustc: compiler/rustc_monomorphize/src/graph_checks/statics.rs:65 check_static_initializers_are_acyclic
export function check_static_initializers_are_acyclic(tcx: TyCtxt, mono_items: readonly MonoItem[], usage_map: UsageMap): void {
  // Collect statics
  const statics = new StaticsSet();
  for (const mono_item of mono_items) {
    if (mono_item.$ === "Static") statics.insert(mono_item._0);
  }

  // If we don't have any statics the check is not necessary
  if (statics.list.length === 0) {
    return;
  }
  // Create a subgraph from the mono item graph, which only contains statics
  const graph = new StaticRefGraph(statics, usage_map.used_map);
  // Calculate its SCCs
  const sccs: Sccs<StaticNodeIdx, StaticSccIdx> = Sccs.new(graph);
  // Group statics by SCCs
  const nodes_of_sccs: StaticNodeIdx[][] = [];
  for (let i = 0; i < sccs.num_sccs(); i++) nodes_of_sccs.push([]);
  for (const i of DirectedGraph_provided.iter_nodes<StaticNodeIdx>(graph)) {
    nodes_of_sccs[sccs.scc(i)]!.push(i);
  }
  const is_cyclic = (nodes_of_scc: readonly StaticNodeIdx[]): boolean => {
    switch (nodes_of_scc.length) {
      case 0:
        return false;
      case 1:
        return graph.successors(nodes_of_scc[0]!).some((x) => x === nodes_of_scc[0]);
      default:
        return true;
    }
  };
  // Emit errors for all cycles
  for (const nodes of nodes_of_sccs.filter((nodes) => is_cyclic(nodes))) {
    // We sort the nodes by their Span to have consistent error line numbers
    nodes.sort((a, b) => {
      const [a_lo, a_hi] = Span.lo_hi(tcx.def_span(statics.list[a]!));
      const [b_lo, b_hi] = Span.lo_hi(tcx.def_span(statics.list[b]!));
      if (a_lo !== b_lo) return a_lo < b_lo ? -1 : 1;
      if (a_hi !== b_hi) return a_hi < b_hi ? -1 : 1;
      return 0;
    });

    const head_def = statics.list[nodes[0]!]!;
    const head_span = tcx.def_span(head_def);

    tcx.dcx().emit_err(
      StaticInitializerCyclic_diagnostic({
        span: head_span,
        labels: nodes.map((n) => tcx.def_span(statics.list[n]!)),
        head: tcx.def_path_str(head_def),
        target: tcx.sess.target.llvm_target,
      }),
    );
  }
}
