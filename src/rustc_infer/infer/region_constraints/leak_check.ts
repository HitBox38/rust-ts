// Port of compiler/rustc_infer/src/infer/region_constraints/leak_check.rs (lane infer-regions).
//
// `LeakCheck`, `SccUniverse`, `LeakCheckNode`, `LeakCheckScc` and `MiniGraph` are generated into leak_check.gen.ts; their
// methods are assigned onto the generated classes here (`new` / `iterate_region_constraints` / `add_node` as statics).
//
// PORT: rustc_data_structures `graph::scc::Sccs` and `graph::vec_graph::VecGraph` are not ported (no lane owns them):
// `MiniGraph.sccs` is seen through the `Sccs` view below, and building one (`VecGraph::new` / `Sccs::new`) stops as
// UNPORTED. So `leak_check` is complete when `outer_universe == max_universe`; otherwise it stops after collecting the
// graph's nodes and edges.
//
// Init order: top-level code here may touch only ../../decls.ts, this file's .gen.ts and other crates.

import { intern_key } from "../../../rust_ts/intern_key.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { debug_BoundRegion, debug_Placeholder, type PlaceholderRegion } from "../../../rustc_type_ir/binder.ts";
import type { RelateResult } from "../../../rustc_type_ir/decls.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import { SubregionOrigin } from "../mod.ts";
import type { CombinedSnapshot } from "../snapshot/mod.ts";
import { LeakCheck, LeakCheckNode, type LeakCheckScc, MiniGraph, SccUniverse } from "./leak_check.gen.ts";
import { type Constraint, RegionConstraintCollector } from "./mod.ts";

export * from "./leak_check.gen.ts";

declare module "./leak_check.gen.ts" {
  interface LeakCheck {
    // leak_check.rs:144
    assign_placeholder_values(): RelateResult<null>;
    // leak_check.rs:184
    propagate_scc_value(): RelateResult<null>;
    // leak_check.rs:259
    placeholder_error(placeholder1: PlaceholderRegion, placeholder2: PlaceholderRegion): TypeError;
    // leak_check.rs:267
    error(placeholder: PlaceholderRegion, other_region: Region): TypeError;
  }
  namespace LeakCheck {
    // leak_check.rs:123
    function new_(tcx: TyCtxt, outer_universe: UniverseIndex, max_universe: UniverseIndex, mini_graph: MiniGraph, rcc: RegionConstraintCollector): LeakCheck;
    export { new_ as new };
  }
  interface SccUniverse {
    // leak_check.rs:328
    take_min(universe: UniverseIndex, region: Region): void;
  }
  namespace MiniGraph {
    // leak_check.rs:361
    function new_(region_constraints: RegionConstraintCollector, only_consider_snapshot: CombinedSnapshot | undefined): MiniGraph;
    export { new_ as new };
    // leak_check.rs:384
    export let iterate_region_constraints: (
      region_constraints: RegionConstraintCollector,
      only_consider_snapshot: CombinedSnapshot | undefined,
      each_edge: (r1: Region, r2: Region) => void,
    ) => void;
    // leak_check.rs:428
    export let add_node: (nodes: Map<Region, LeakCheckNode>, r: Region) => LeakCheckNode;
  }
}

/**
 * PORT: the `Sccs<LeakCheckNode, LeakCheckScc>` methods this file calls (rustc_data_structures graph/scc/mod.rs, not
 * ported), as a view of `MiniGraph.sccs`. `all_sccs` is in dependency (post) order: if `S1 -> S2`, `S2` comes first.
 */
export interface Sccs {
  num_sccs(): number;
  scc(r: LeakCheckNode): LeakCheckScc;
  all_sccs(): Iterable<LeakCheckScc>;
  successors(scc: LeakCheckScc): readonly LeakCheckScc[];
}

/** `mini_graph.sccs` through the `Sccs` view. */
function sccs_of(mini_graph: MiniGraph): Sccs {
  return mini_graph.sccs as Sccs;
}

/** PORT: stand-in for `VecGraph::<LeakCheckNode, false>::new(num_nodes, edges)` (rustc_data_structures graph/vec_graph). */
function VecGraph_new(_num_nodes: number, _edge_pairs: [LeakCheckNode, LeakCheckNode][]): unknown {
  return unported("rustc_data_structures::graph::vec_graph::VecGraph::new");
}

/** PORT: stand-in for `Sccs::<LeakCheckNode, LeakCheckScc>::new(&graph)` (rustc_data_structures graph/scc). */
function Sccs_new(_graph: unknown): Sccs {
  return unported("rustc_data_structures::graph::scc::Sccs::new");
}

/** `IndexVec` indexing (panics out of bounds). */
function at<T>(v: readonly T[], i: number): T {
  assert(i < v.length, `index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/// Searches new universes created during `snapshot`, looking for
/// placeholders that may "leak" out from the universes they are contained
/// in. If any leaking placeholders are found, then an `Err` is returned
/// (typically leading to the snapshot being reversed). This algorithm
/// only looks at placeholders which cannot be named by `outer_universe`,
/// as this is the universe we're currently checking for a leak.
///
/// The leak check *used* to be the only way we had to handle higher-ranked
/// obligations. Now that we have integrated universes into the region
/// solvers, this is no longer the case, but we retain the leak check for
/// backwards compatibility purposes. In particular, it lets us make "early"
/// decisions about whether a region error will be reported that are used in
/// coherence and elsewhere -- see #56105 and #59490 for more details. The
/// eventual fate of the leak checker is not yet settled.
///
/// The leak checker works by searching for the following error patterns:
///
/// * P1: P2, where P1 != P2
/// * P1: R, where R is in some universe that cannot name P1
///
/// The idea here is that each of these patterns represents something that
/// the region solver would eventually report as an error, so we can detect
/// the error early. There is a fly in the ointment, though, in that this is
/// not entirely true. In particular, in the future, we may extend the
/// environment with implied bounds or other info about how placeholders
/// relate to regions in outer universes. In that case, `P1: R` for example
/// might become solvable.
///
/// # Summary of the implementation
///
/// The leak checks as follows. First, we construct a graph where `R2: R1`
/// implies `R2 -> R1`, and we compute the SCCs.
///
/// For each SCC S, we compute:
///
/// * what placeholder P it must be equal to, if any
///   * if there are multiple placeholders that must be equal, report an error because `P1: P2`
/// * the minimum universe of its constituents
///
/// Then we walk the SCCs in dependency order and compute
///
/// * what placeholder they must outlive transitively
///   * if they must also be equal to a placeholder, report an error because `P1: P2`
/// * minimum universe U of all SCCs they must outlive
///   * if they must also be equal to a placeholder P, and U cannot name P, report an error, as
///     that indicates `P: R` and `R` is in an incompatible universe
///
/// To improve performance and for the old trait solver caching to be sound, this takes
/// an optional snapshot in which case we only look at region constraints added in that
/// snapshot. If we were to not do that the `leak_check` during evaluation can rely on
/// region constraints added outside of that evaluation. As that is not reflected in the
/// cache key this would be unsound.
///
/// # Historical note
///
/// Older variants of the leak check used to report errors for these
/// patterns, but we no longer do:
///
/// * R: P1, even if R cannot name P1, because R = 'static is a valid sol'n
/// * R: P1, R: P2, as above
// #[instrument(level = "debug", skip(self, tcx, only_consider_snapshot), ret)]
// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:75 leak_check
RegionConstraintCollector.prototype.leak_check = function (
  this: RegionConstraintCollector,
  tcx: TyCtxt,
  outer_universe: UniverseIndex,
  max_universe: UniverseIndex,
  only_consider_snapshot: CombinedSnapshot | undefined,
): RelateResult<null> {
  if (outer_universe === max_universe) {
    return Ok(null);
  }

  const mini_graph = MiniGraph.new(this, only_consider_snapshot);

  const leak_check = LeakCheck.new(tcx, outer_universe, max_universe, mini_graph, this);
  let r = leak_check.assign_placeholder_values();
  if (r.$ === "Err") return r;
  r = leak_check.propagate_scc_value();
  if (r.$ === "Err") return r;
  return Ok(null);
};

// ---- impl LeakCheck ----------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:123 new
(LeakCheck as unknown as { new: typeof LeakCheck.new }).new = function (
  tcx: TyCtxt,
  outer_universe: UniverseIndex,
  max_universe: UniverseIndex,
  mini_graph: MiniGraph,
  rcc: RegionConstraintCollector,
): LeakCheck {
  const num_sccs = sccs_of(mini_graph).num_sccs();
  // `IndexVec::from_elem_n(dummy_scc_universe, num_sccs)`: each element is a copy of the `Copy` value.
  const scc_universes: SccUniverse[] = [];
  for (let i = 0; i < num_sccs; i++) scc_universes.push(new SccUniverse(max_universe, undefined));
  const scc_placeholders: (PlaceholderRegion | undefined)[] = new Array<PlaceholderRegion | undefined>(num_sccs).fill(undefined);
  return new LeakCheck(tcx, outer_universe, mini_graph, rcc, scc_placeholders, scc_universes);
};

/// Compute what placeholders (if any) each SCC must be equal to.
/// Also compute the minimum universe of all the regions in each SCC.
// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:144 assign_placeholder_values
LeakCheck.prototype.assign_placeholder_values = function (this: LeakCheck): RelateResult<null> {
  // First walk: find each placeholder that is from a newly created universe.
  for (const [region, leak_check_node] of this.mini_graph.nodes) {
    const scc = sccs_of(this.mini_graph).scc(leak_check_node);

    // Set the universe of each SCC to be the minimum of its constituent universes
    const universe = this.rcc.universe(region);
    // debug!("assign_placeholder_values: scc={:?} universe={:?} region={:?}", scc, universe, region);
    at(this.scc_universes, scc).take_min(universe, region);

    // Detect those SCCs that directly contain a placeholder
    const kind = region.kind();
    if (kind.$ === "RePlaceholder") {
      const placeholder = kind._0;
      if (UniverseIndex.cannot_name(this.outer_universe, placeholder.universe)) {
        // Update `scc_placeholders` to account for the fact that `P: S` must hold.
        const p = at(this.scc_placeholders, scc);
        if (p !== undefined) {
          assert_ne_placeholder(p, placeholder);
          return Err(this.placeholder_error(p, placeholder));
        } else {
          this.scc_placeholders[scc] = placeholder;
        }
      }
    }
  }

  return Ok(null);
};

/** `assert_ne!(left, right)` on two `PlaceholderRegion`s (derived `PartialEq`). */
function assert_ne_placeholder(left: PlaceholderRegion, right: PlaceholderRegion): void {
  if (intern_key(left) === intern_key(right)) {
    const d = (p: PlaceholderRegion): string => debug_Placeholder(p, PLAIN, debug_BoundRegion);
    panic(`assertion \`left != right\` failed\n  left: ${d(left)}\n right: ${d(right)}`);
  }
}

/// For each SCC S, iterate over each successor S1 where `S: S1`:
///
/// * Compute
/// Iterate over each SCC `S` and ensure that, for each `S1` where `S1: S`,
/// `universe(S) <= universe(S1)`. This executes after
/// `assign_placeholder_values`, so `universe(S)` is already the minimum
/// universe of any of its direct constituents.
// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:184 propagate_scc_value
LeakCheck.prototype.propagate_scc_value = function (this: LeakCheck): RelateResult<null> {
  // Loop invariants:
  //
  // On start of the loop iteration for `scc1`:
  //
  // * `scc_universes[scc1]` contains the minimum universe of the
  //   constituents of `scc1`
  // * `scc_placeholder[scc1]` stores the placeholder that `scc1` must
  //   be equal to (if any)
  //
  // For each successor `scc2` where `scc1: scc2`:
  //
  // * `scc_placeholder[scc2]` stores some placeholder `P` where
  //   `scc2: P` (if any)
  // * `scc_universes[scc2]` contains the minimum universe of the
  //   constituents of `scc2` and any of its successors
  const sccs = sccs_of(this.mini_graph);
  for (const scc1 of sccs.all_sccs()) {
    // debug!("propagate_scc_value: scc={:?} with universe {:?}", scc1, self.scc_universes[scc1]);

    // Walk over each `scc2` such that `scc1: scc2` and compute:
    //
    // * `scc1_universe`: the minimum universe of `scc2` and the constituents of `scc1`
    // * `succ_bound`: placeholder `P` that the successors must outlive, if any (if there
    //   are multiple, we pick one arbitrarily)
    const u1 = at(this.scc_universes, scc1);
    // PORT: `SccUniverse` is `Copy`: a local copy.
    const scc1_universe = new SccUniverse(u1.universe, u1.region);
    let succ_bound: PlaceholderRegion | undefined = undefined;
    for (const scc2 of sccs.successors(scc1)) {
      const { universe: scc2_universe, region: scc2_region } = at(this.scc_universes, scc2);

      scc1_universe.take_min(scc2_universe, unwrap(scc2_region));

      const b = at(this.scc_placeholders, scc2);
      if (b !== undefined) {
        succ_bound = b;
      }
    }

    // Update minimum universe of scc1.
    this.scc_universes[scc1] = scc1_universe;

    // At this point, `scc_placeholders[scc1]` stores the placeholder that
    // `scc1` must be equal to, if any.
    const scc1_placeholder = at(this.scc_placeholders, scc1);
    if (scc1_placeholder !== undefined) {
      // debug!("propagate_scc_value: scc1={:?} placeholder={:?} scc1_universe={:?}", scc1, scc1_placeholder, scc1_universe);

      // Check if `P1: R` for some `R` in a universe that cannot name
      // P1. That's an error.
      if (UniverseIndex.cannot_name(scc1_universe.universe, scc1_placeholder.universe)) {
        return Err(this.error(scc1_placeholder, unwrap(scc1_universe.region)));
      }

      // Check if we have some placeholder where `S: P2`
      // (transitively). In that case, since `S = P1`, that implies
      // `P1: P2`, which is an error condition.
      if (succ_bound !== undefined) {
        const scc2_placeholder = succ_bound;
        assert_ne_placeholder(scc1_placeholder, scc2_placeholder);
        return Err(this.placeholder_error(scc1_placeholder, scc2_placeholder));
      }
    } else {
      // Otherwise, we can reach a placeholder if some successor can.
      this.scc_placeholders[scc1] = succ_bound;
    }

    // At this point, `scc_placeholder[scc1]` stores some placeholder that `scc1` must
    // outlive (if any).
  }
  return Ok(null);
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:259 placeholder_error
LeakCheck.prototype.placeholder_error = function (this: LeakCheck, placeholder1: PlaceholderRegion, placeholder2: PlaceholderRegion): TypeError {
  return this.error(placeholder1, Region.new_placeholder(this.tcx, placeholder2));
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:267 error
LeakCheck.prototype.error = function (this: LeakCheck, placeholder: PlaceholderRegion, other_region: Region): TypeError {
  // debug!("error: placeholder={:?}, other_region={:?}", placeholder, other_region);
  return { $: "RegionsInsufficientlyPolymorphic", _0: placeholder.bound, _1: other_region };
};

// States we need to distinguish:
//
// * must be equal to a placeholder (i.e., a placeholder is in the SCC)
//     * it could conflict with some other regions in the SCC in different universes
//     * or a different placeholder
// * `P1: S` and `S` must be equal to a placeholder
// * `P1: S` and `S` is in an incompatible universe
//
// So if we
//
// (a) compute which placeholder (if any) each SCC must be equal to
// (b) compute its minimum universe
// (c) compute *some* placeholder where `S: P1` (any one will do)
//
// then we get an error if:
//
// - it must be equal to a placeholder `P1` and minimum universe cannot name `P1`
// - `S: P1` and minimum universe cannot name `P1`
// - `S: P1` and we must be equal to `P2`
//
// So we want to track:
//
// * Equal placeholder (if any)
// * Some bounding placeholder (if any)
// * Minimum universe
//
// * We compute equal placeholder + minimum universe of constituents in first pass
// * Then we walk in order and compute from our dependencies `S1` where `S: S1` (`S -> S1`)
//   * bounding placeholder (if any)
//   * minimum universe
// * And if we must be equal to a placeholder then we check it against
//   * minimum universe
//   * no bounding placeholder

// ---- impl SccUniverse --------------------------------------------------------------------------------------------------

/// If `universe` is less than our current universe, then update
/// `self.universe` and `self.region`.
// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:328 take_min
SccUniverse.prototype.take_min = function (this: SccUniverse, universe: UniverseIndex, region: Region): void {
  if (universe < this.universe || this.region === undefined) {
    this.universe = universe;
    this.region = region;
  }
};

// ---- impl MiniGraph ----------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:361 new
(MiniGraph as unknown as { new: typeof MiniGraph.new }).new = function (
  region_constraints: RegionConstraintCollector,
  only_consider_snapshot: CombinedSnapshot | undefined,
): MiniGraph {
  const nodes = new Map<Region, LeakCheckNode>();
  const edges: [LeakCheckNode, LeakCheckNode][] = [];

  // Note that if `R2: R1`, we get a callback `r1, r2`, so `target` is first parameter.
  MiniGraph.iterate_region_constraints(region_constraints, only_consider_snapshot, (target, source) => {
    const source_node = MiniGraph.add_node(nodes, source);
    const target_node = MiniGraph.add_node(nodes, target);
    edges.push([source_node, target_node]);
  });
  const graph = VecGraph_new(nodes.size, edges);
  const sccs = Sccs_new(graph);
  return new MiniGraph(nodes, sccs);
};

/** `match visible_for_leak_check { Yes => each_edge(sub, sup), No => {}, Unreachable => unreachable!() }` */
function each_visible_edge(c: Constraint, each_edge: (r1: Region, r2: Region) => void): void {
  const { sub, sup, visible_for_leak_check } = c;
  switch (visible_for_leak_check) {
    case "Yes":
      each_edge(sub, sup);
      break;
    case "No":
      break;
    case "Unreachable":
      unreachable();
  }
}

/// Invokes `each_edge(R1, R2)` for each edge where `R2: R1`
// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:384 iterate_region_constraints
MiniGraph.iterate_region_constraints = function (
  region_constraints: RegionConstraintCollector,
  only_consider_snapshot: CombinedSnapshot | undefined,
  each_edge: (r1: Region, r2: Region) => void,
): void {
  if (only_consider_snapshot !== undefined) {
    const snapshot = only_consider_snapshot;
    for (const undo_entry of region_constraints.undo_log.region_constraints_in_snapshot(snapshot.undo_snapshot)) {
      switch (undo_entry.$) {
        case "AddConstraint": {
          const i = undo_entry._0;
          for (const c of at(region_constraints.data().constraints, i)[0].iter_outlives()) {
            each_visible_edge(c, each_edge);
          }
          break;
        }
        case "AddVerify": {
          const i = undo_entry._0;
          span_bug(SubregionOrigin.span(at(region_constraints.data().verifys, i).origin), "we never add verifications while doing higher-ranked things");
          break;
        }
        case "AddCombination":
        case "AddVar":
          break;
      }
    }
  } else {
    for (const [c] of region_constraints.data().constraints) {
      for (const c2 of c.iter_outlives()) {
        each_visible_edge(c2, each_edge);
      }
    }
  }
};

// rustc: compiler/rustc_infer/src/infer/region_constraints/leak_check.rs:428 add_node
MiniGraph.add_node = function (nodes: Map<Region, LeakCheckNode>, r: Region): LeakCheckNode {
  const l = nodes.size;
  // `*nodes.entry(r).or_insert(LeakCheckNode::new(l))`
  const existing = nodes.get(r);
  if (existing !== undefined) return existing;
  const n = LeakCheckNode.new(l);
  nodes.set(r, n);
  return n;
};
