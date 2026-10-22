// Port of compiler/rustc_borrowck/src/handle_placeholders.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `impl scc::Annotation for RegionTracker` is the impl table `Annotation_RegionTracker` (rustc_data_structures
// graph/scc's `Annotation<A>` is a table whose methods take `self: MutRef<A>`). `impl scc::Annotations<RegionVid> for
// SccAnnotations<'_, '_, RegionTracker>` is prototype methods of the generated class (`"new"` / `annotate_scc`) plus the
// associated type `type Ann = RegionTracker` as the prototype member `Ann` (the table); `type SccIdx` is type-level only.
// PORT: `RegionTracker::max_nameable_universe()` is `max_nameable_universe_()`: the field has the same name.
import type { Annotation } from "../rustc_data_structures/graph/scc/mod.ts";
import type { Sccs } from "../rustc_data_structures/graph/scc/mod.ts";
import type { UniverseIndex } from "../rustc_type_ir/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import type { Debug } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { ConstraintSccIndex, OutlivesConstraintSet } from "./constraints/mod.gen.ts";
import type { BorrowckInferCtxt } from "./lib.gen.ts";
import type { RegionDefinition } from "./region_infer/mod.gen.ts";
import type { UniversalRegionRelations } from "./type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "./type_check/mod.gen.ts";
import type { UniversalRegions } from "./universal_regions.gen.ts";
import {
  debug_RegionTracker,
  type LoweredConstraints,
  PlaceholderReachability,
  RegionTracker,
  SccAnnotations,
} from "./handle_placeholders.gen.ts";

export * from "./handle_placeholders.gen.ts";

declare module "./handle_placeholders.gen.ts" {
  interface SccAnnotations<A> {
    // handle_placeholders.rs:51 (lane bck-regions-b): `impl scc::Annotations<RegionVid> for SccAnnotations<RegionTracker>`
    "new"(this: SccAnnotations<RegionTracker>, element: RegionVid): RegionTracker;
    // handle_placeholders.rs:55 (lane bck-regions-b)
    annotate_scc(this: SccAnnotations<RegionTracker>, scc: ConstraintSccIndex, annotation: RegionTracker): void;
    /** `type Ann = RegionTracker` (the `Annotation` impl table). */
    readonly Ann: Annotation<RegionTracker>;
  }
  namespace SccAnnotations {
    // handle_placeholders.rs:45 (lane bck-regions-b)
    function init<A>(definitions: RegionDefinition[]): SccAnnotations<A>;
  }
  interface PlaceholderReachability {
    // handle_placeholders.rs:78 (lane bck-regions-b)
    merge(other: PlaceholderReachability): void;
  }
  interface RegionTracker {
    // handle_placeholders.rs:123 (lane bck-regions-b); `max_nameable_universe_`: the field has the same name
    max_nameable_universe_(): UniverseIndex;
    // handle_placeholders.rs:127 (lane bck-regions-b)
    max_placeholder_universe_reached(): UniverseIndex;
    // handle_placeholders.rs:133 (lane bck-regions-b)
    placeholders_can_be_named_by(from: UniverseIndex): boolean;
    // handle_placeholders.rs:138 (lane bck-regions-b)
    can_name_all_placeholders(other: RegionTracker): boolean;
    // handle_placeholders.rs:147 (lane bck-regions-b)
    unnameable_placeholder(): [UniverseIndex, RegionVid] | undefined;
  }
  namespace RegionTracker {
    // handle_placeholders.rs:101 (lane bck-regions-b)
    function new_(rvid: RegionVid, definition: RegionDefinition): RegionTracker;
    export { new_ as new };
  }
}

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:45 init (lane bck-regions-b)
(SccAnnotations as unknown as { init: typeof SccAnnotations.init }).init = function <A>(definitions: RegionDefinition[]): SccAnnotations<A> {
  return unported("rustc_borrowck::handle_placeholders::SccAnnotations::init");
};

// impl scc::Annotations<RegionVid> for SccAnnotations<'_, '_, RegionTracker>
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:51 new (lane bck-regions-b)
SccAnnotations.prototype.new = function (this: SccAnnotations<RegionTracker>, element: RegionVid): RegionTracker {
  return unported("rustc_borrowck::handle_placeholders::SccAnnotations::new");
};

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:55 annotate_scc (lane bck-regions-b)
SccAnnotations.prototype.annotate_scc = function (this: SccAnnotations<RegionTracker>, scc: ConstraintSccIndex, annotation: RegionTracker): void {
  return unported("rustc_borrowck::handle_placeholders::SccAnnotations::annotate_scc");
};

/// Merge the reachable placeholders of two graph components.
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:78 merge (lane bck-regions-b)
PlaceholderReachability.prototype.merge = function (this: PlaceholderReachability, other: PlaceholderReachability): void {
  return unported("rustc_borrowck::handle_placeholders::PlaceholderReachability::merge");
};

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:101 new (lane bck-regions-b)
(RegionTracker as unknown as { new: typeof RegionTracker.new }).new = function (rvid: RegionVid, definition: RegionDefinition): RegionTracker {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::new");
};

/// The largest universe this SCC can name. It's the smallest
/// max-nameable-universe of any reachable region, or
/// `max_nameable(r) = min (max_nameable(r') for r' reachable from r)`
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:123 max_nameable_universe (lane bck-regions-b)
RegionTracker.prototype.max_nameable_universe_ = function (this: RegionTracker): UniverseIndex {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::max_nameable_universe");
};

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:127 max_placeholder_universe_reached (lane bck-regions-b)
RegionTracker.prototype.max_placeholder_universe_reached = function (this: RegionTracker): UniverseIndex {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::max_placeholder_universe_reached");
};

/// Can all reachable placeholders be named from `from`?
/// True vacuously in case no placeholders were reached.
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:133 placeholders_can_be_named_by (lane bck-regions-b)
RegionTracker.prototype.placeholders_can_be_named_by = function (this: RegionTracker, from: UniverseIndex): boolean {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::placeholders_can_be_named_by");
};

/// Determine if we can name all the placeholders in `other`.
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:138 can_name_all_placeholders (lane bck-regions-b)
RegionTracker.prototype.can_name_all_placeholders = function (this: RegionTracker, other: RegionTracker): boolean {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::can_name_all_placeholders");
};

/// If this SCC reaches a placeholder it can't name, return it.
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:147 unnameable_placeholder (lane bck-regions-b)
RegionTracker.prototype.unnameable_placeholder = function (this: RegionTracker): [UniverseIndex, RegionVid] | undefined {
  return unported("rustc_borrowck::handle_placeholders::RegionTracker::unnameable_placeholder");
};

// impl scc::Annotation for RegionTracker
export const Annotation_RegionTracker: Annotation<RegionTracker> = {
  /** The `Debug` supertrait (derived). */
  debug: debug_RegionTracker as Debug<RegionTracker>,

  // stub: compiler/rustc_borrowck/src/handle_placeholders.rs:155 update_scc (lane bck-regions-b)
  update_scc(self: MutRef<RegionTracker>, other: RegionTracker): void {
    return unported("rustc_borrowck::handle_placeholders::RegionTracker::update_scc");
  },

  // stub: compiler/rustc_borrowck/src/handle_placeholders.rs:161 update_reachable (lane bck-regions-b)
  update_reachable(self: MutRef<RegionTracker>, other: RegionTracker): void {
    return unported("rustc_borrowck::handle_placeholders::RegionTracker::update_reachable");
  },
};

// `type Ann = RegionTracker;` of `impl scc::Annotations<RegionVid> for SccAnnotations<RegionTracker>`
Object.defineProperty(SccAnnotations.prototype, "Ann", { value: Annotation_RegionTracker, writable: false, enumerable: false, configurable: true });

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:174 region_definitions (lane bck-regions-b)
export function region_definitions(infcx: BorrowckInferCtxt, universal_regions: UniversalRegions): [RegionDefinition[], boolean] {
  return unported("rustc_borrowck::handle_placeholders::region_definitions");
}

/// This method handles placeholders by rewriting the constraint
/// graph. For each strongly connected component in the constraint
/// graph such that there is a series of constraints
///    A: B: C: ... : X  where
/// A contains a placeholder whose universe cannot be named by X,
/// add a constraint that X: 'static. This is a safe upper bound
/// in the face of borrow checker/trait solver limitations that will
/// eventually go away.
///
/// For a more precise definition, see the documentation for
/// [`RegionTracker`] and its methods!
///
/// This edge case used to be handled during constraint propagation.
/// It was rewritten as part of the Polonius project with the goal of moving
/// higher-kindedness concerns out of the path of the borrow checker,
/// for two reasons:
///
/// 1. Implementing Polonius is difficult enough without also
///     handling them.
/// 2. The long-term goal is to handle higher-kinded concerns
///     in the trait solver, where they belong. This avoids
///     logic duplication and allows future trait solvers
///     to compute better bounds than for example our
///     "must outlive 'static" here.
///
/// This code is a stop-gap measure in preparation for the future trait solver.
///
/// Every constraint added by this method is an internal `IllegalUniverse` constraint.
// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:234 compute_sccs_applying_placeholder_outlives_constraints (lane bck-regions-b)
export function compute_sccs_applying_placeholder_outlives_constraints(
  constraints: MirTypeckRegionConstraints,
  universal_region_relations: UniversalRegionRelations,
  infcx: BorrowckInferCtxt,
): LoweredConstraints {
  return unported("rustc_borrowck::handle_placeholders::compute_sccs_applying_placeholder_outlives_constraints");
}

// stub: compiler/rustc_borrowck/src/handle_placeholders.rs:316 rewrite_placeholder_outlives (lane bck-regions-b)
export function rewrite_placeholder_outlives(
  sccs: Sccs<RegionVid, ConstraintSccIndex>,
  annotations: SccAnnotations<RegionTracker>,
  fr_static: RegionVid,
  outlives_constraints: OutlivesConstraintSet,
): boolean {
  return unported("rustc_borrowck::handle_placeholders::rewrite_placeholder_outlives");
}

