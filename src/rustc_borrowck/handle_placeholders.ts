// Port of compiler/rustc_borrowck/src/handle_placeholders.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `impl scc::Annotation for RegionTracker` is the impl table `Annotation_RegionTracker` (rustc_data_structures
// graph/scc's `Annotation<A>` is a table whose methods take `self: MutRef<A>`). `impl scc::Annotations<RegionVid> for
// SccAnnotations<'_, '_, RegionTracker>` is prototype methods of the generated class (`"new"` / `annotate_scc`) plus the
// associated type `type Ann = RegionTracker` as the prototype member `Ann` (the table); `type SccIdx` is type-level only.
// PORT: `RegionTracker::max_nameable_universe()` is `max_nameable_universe_()`: the field has the same name.
import type { Annotation } from "../rustc_data_structures/graph/scc/mod.ts";
import { Sccs } from "../rustc_data_structures/graph/scc/mod.ts";
import type { NllRegionVariableOrigin } from "../rustc_infer/infer/mod.gen.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { UniverseIndex } from "../rustc_type_ir/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { VarianceDiagInfo } from "../rustc_type_ir/relate.gen.ts";
import type { Debug } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic } from "../std/panic.ts";
import type { ConstraintSccIndex, OutlivesConstraintSet } from "./constraints/mod.gen.ts";
import type { BorrowckInferCtxt } from "./lib.gen.ts";
import { type RegionDefinition, Representative } from "./region_infer/mod.ts";
import type { UniversalRegionRelations } from "./type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "./type_check/mod.gen.ts";
import type { UniversalRegions } from "./universal_regions.gen.ts";
import {
  clone_PlaceholderReachability,
  clone_RegionTracker,
  debug_RegionTracker,
  type LoweredConstraints,
  PlaceholderReachability,
  RegionTracker,
  SccAnnotations,
} from "./handle_placeholders.gen.ts";

export * from "./handle_placeholders.gen.ts";

declare module "./handle_placeholders.gen.ts" {
  interface SccAnnotations<A> {
    // handle_placeholders.rs:51: `impl scc::Annotations<RegionVid> for SccAnnotations<RegionTracker>`
    "new"(this: SccAnnotations<RegionTracker>, element: RegionVid): RegionTracker;
    // handle_placeholders.rs:55
    annotate_scc(this: SccAnnotations<RegionTracker>, scc: ConstraintSccIndex, annotation: RegionTracker): void;
    /** `type Ann = RegionTracker` (the `Annotation` impl table). */
    readonly Ann: Annotation<RegionTracker>;
  }
  namespace SccAnnotations {
    // handle_placeholders.rs:45
    function init<A>(definitions: RegionDefinition[]): SccAnnotations<A>;
  }
  interface PlaceholderReachability {
    // handle_placeholders.rs:78
    merge(other: PlaceholderReachability): void;
  }
  interface RegionTracker {
    // handle_placeholders.rs:123; `max_nameable_universe_`: the field has the same name
    max_nameable_universe_(): UniverseIndex;
    // handle_placeholders.rs:127
    max_placeholder_universe_reached(): UniverseIndex;
    // handle_placeholders.rs:133
    placeholders_can_be_named_by(from: UniverseIndex): boolean;
    // handle_placeholders.rs:138
    can_name_all_placeholders(other: RegionTracker): boolean;
    // handle_placeholders.rs:147
    unnameable_placeholder(): [UniverseIndex, RegionVid] | undefined;
  }
  namespace RegionTracker {
    // handle_placeholders.rs:101
    function new_(rvid: RegionVid, definition: RegionDefinition): RegionTracker;
    export { new_ as new };
  }
}

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:45 init
(SccAnnotations as unknown as { init: typeof SccAnnotations.init }).init = function <A>(definitions: RegionDefinition[]): SccAnnotations<A> {
  return new SccAnnotations<A>([], definitions);
};

// impl scc::Annotations<RegionVid> for SccAnnotations<'_, '_, RegionTracker>
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:51 new
SccAnnotations.prototype.new = function (this: SccAnnotations<RegionTracker>, element: RegionVid): RegionTracker {
  return RegionTracker.new(element, index_vec(this.definitions, element));
};

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:55 annotate_scc
SccAnnotations.prototype.annotate_scc = function (this: SccAnnotations<RegionTracker>, scc: ConstraintSccIndex, annotation: RegionTracker): void {
  const idx = this.scc_to_annotation.length as ConstraintSccIndex;
  this.scc_to_annotation.push(annotation);
  assert(idx === scc, "assertion failed: idx == scc");
};

/// Merge the reachable placeholders of two graph components.
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:78 merge
PlaceholderReachability.prototype.merge = function (this: PlaceholderReachability, other: PlaceholderReachability): void {
  this.max_universe = tuple_max(this.max_universe, other.max_universe);
  this.min_placeholder = Math.min(this.min_placeholder, other.min_placeholder) as RegionVid;
  this.max_placeholder = Math.max(this.max_placeholder, other.max_placeholder) as RegionVid;
};

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:101 new
(RegionTracker as unknown as { new: typeof RegionTracker.new }).new = function (rvid: RegionVid, definition: RegionDefinition): RegionTracker {
  const reachable_placeholders = definition.origin.$ === "Placeholder"
    ? new PlaceholderReachability([definition.universe, rvid], rvid, rvid)
    : undefined;

  return new RegionTracker(reachable_placeholders, [definition.universe, rvid], Representative.new(rvid, definition));
};

/// The largest universe this SCC can name. It's the smallest
/// max-nameable-universe of any reachable region, or
/// `max_nameable(r) = min (max_nameable(r') for r' reachable from r)`
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:123 max_nameable_universe
RegionTracker.prototype.max_nameable_universe_ = function (this: RegionTracker): UniverseIndex {
  return this.max_nameable_universe[0];
};

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:127 max_placeholder_universe_reached
RegionTracker.prototype.max_placeholder_universe_reached = function (this: RegionTracker): UniverseIndex {
  const pls = this.reachable_placeholders;
  return pls !== undefined ? pls.max_universe[0] : UniverseIndex.ROOT;
};

/// Can all reachable placeholders be named from `from`?
/// True vacuously in case no placeholders were reached.
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:133 placeholders_can_be_named_by
RegionTracker.prototype.placeholders_can_be_named_by = function (this: RegionTracker, from: UniverseIndex): boolean {
  const pls = this.reachable_placeholders;
  return pls === undefined || UniverseIndex.can_name(from, pls.max_universe[0]);
};

/// Determine if we can name all the placeholders in `other`.
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:138 can_name_all_placeholders
RegionTracker.prototype.can_name_all_placeholders = function (this: RegionTracker, other: RegionTracker): boolean {
  // HACK: We first check whether we can name the highest existential universe
  // of `other`. This only exists to avoid errors in case that scc already
  // depends on a placeholder it cannot name itself.
  return (
    UniverseIndex.can_name(this.max_nameable_universe_(), other.max_nameable_universe_()) ||
    other.placeholders_can_be_named_by(this.max_nameable_universe[0])
  );
};

/// If this SCC reaches a placeholder it can't name, return it.
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:147 unnameable_placeholder
RegionTracker.prototype.unnameable_placeholder = function (this: RegionTracker): [UniverseIndex, RegionVid] | undefined {
  const pls = this.reachable_placeholders;
  if (pls === undefined || UniverseIndex.can_name(this.max_nameable_universe_(), pls.max_universe[0])) return undefined;
  return pls.max_universe;
};

// impl scc::Annotation for RegionTracker
export const Annotation_RegionTracker: Annotation<RegionTracker> = {
  /** The `Debug` supertrait (derived). */
  debug: debug_RegionTracker as Debug<RegionTracker>,

  // rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:155 update_scc
  update_scc(self: MutRef<RegionTracker>, other: RegionTracker): void {
    // trace!("{:?} << {:?}", self.representative, other.representative);
    // PORT: annotations are `Copy` values shared by the SCC walk: write a modified copy through `self`.
    const next = clone_RegionTracker(self.value);
    next.representative = representative_min(next.representative, other.representative);
    self.value = next;
    Annotation_RegionTracker.update_reachable(self, other);
  },

  // rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:161 update_reachable
  update_reachable(self: MutRef<RegionTracker>, other: RegionTracker): void {
    // PORT: annotations are `Copy` values shared by the SCC walk: write a modified copy through `self`.
    const next = clone_RegionTracker(self.value);
    next.max_nameable_universe = tuple_min(next.max_nameable_universe, other.max_nameable_universe);
    const ours = next.reachable_placeholders;
    const theirs = other.reachable_placeholders;
    if ((ours === undefined && theirs === undefined) || (ours !== undefined && theirs === undefined)) {
      // ()
    } else if (ours === undefined && theirs !== undefined) {
      next.reachable_placeholders = clone_PlaceholderReachability(theirs);
    } else if (ours !== undefined && theirs !== undefined) {
      ours.merge(theirs);
    }
    self.value = next;
  },
};

// `type Ann = RegionTracker;` of `impl scc::Annotations<RegionVid> for SccAnnotations<RegionTracker>`
Object.defineProperty(SccAnnotations.prototype, "Ann", { value: Annotation_RegionTracker, writable: false, enumerable: false, configurable: true });

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:174 region_definitions
export function region_definitions(infcx: BorrowckInferCtxt, universal_regions: UniversalRegions): [RegionDefinition[], boolean] {
  const var_infos = infcx.get_region_var_infos();
  // Create a RegionDefinition for each inference variable. This happens here because
  // it allows us to sneak in a cheap check for placeholders. Otherwise, its proper home
  // is in `RegionInferenceContext::new()`, probably.
  const definitions: RegionDefinition[] = [];
  let has_placeholders = false;

  for (const info of var_infos) {
    const origin: NllRegionVariableOrigin =
      info.origin.$ === "Nll" ? info.origin._0 : { $: "Existential", name: undefined };

    const definition: RegionDefinition = { origin, universe: info.universe, external_name: undefined };

    has_placeholders ||= origin.$ === "Placeholder";
    definitions.push(definition);
  }

  // Add external names from universal regions in fun function definitions.
  // FIXME: this two-step method is annoying, but I don't know how to avoid it.
  for (const [external_name, variable] of universal_regions.named_universal_regions_iter()) {
    // debug!("region {:?} has external name {:?}", variable, external_name);
    index_vec(definitions, variable).external_name = external_name;
  }
  return [definitions, has_placeholders];
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
// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:234 compute_sccs_applying_placeholder_outlives_constraints
export function compute_sccs_applying_placeholder_outlives_constraints(
  constraints: MirTypeckRegionConstraints,
  universal_region_relations: UniversalRegionRelations,
  infcx: BorrowckInferCtxt,
): LoweredConstraints {
  const universal_regions = universal_region_relations.universal_regions;
  const [definitions, has_placeholders] = region_definitions(infcx, universal_regions);

  const {
    placeholder_indices,
    // placeholder_index_to_region: _,
    liveness_constraints,
    outlives_constraints,
    universe_causes,
    type_tests,
  } = constraints;

  const fr_static = universal_regions.fr_static;
  const compute_sccs = (
    constraints: OutlivesConstraintSet,
    annotations: SccAnnotations<RegionTracker>,
  ): Sccs<RegionVid, ConstraintSccIndex> => {
    return Sccs.new_with_annotation<RegionVid, RegionTracker, ConstraintSccIndex>(
      constraints.graph(definitions.length).region_graph(constraints, fr_static),
      annotations,
    );
  };

  const scc_annotations = SccAnnotations.init<RegionTracker>(definitions);
  const constraint_sccs = compute_sccs(outlives_constraints, scc_annotations);

  // This code structure is a bit convoluted because it allows for a planned
  // future change where the early return here has a different type of annotation
  // that does much less work.
  if (!has_placeholders) {
    // debug!("No placeholder regions found; skipping rewriting logic!");

    return {
      type_tests,
      constraint_sccs,
      scc_annotations: scc_annotations.scc_to_annotation,
      definitions,
      outlives_constraints,
      liveness_constraints,
      universe_causes,
      placeholder_indices,
    };
  }
  // debug!("Placeholders present; activating placeholder handling logic!");

  const added_constraints = rewrite_placeholder_outlives(constraint_sccs, scc_annotations, fr_static, outlives_constraints);

  let constraint_sccs_: Sccs<RegionVid, ConstraintSccIndex>;
  let scc_annotations_: RegionTracker[];
  if (added_constraints) {
    const annotations = SccAnnotations.init<RegionTracker>(definitions);

    // We changed the constraint set and so must recompute SCCs.
    // Optimisation opportunity: if we can add them incrementally (and that's
    // possible because edges to 'static always only merge SCCs into 'static),
    // we would potentially save a lot of work here.
    constraint_sccs_ = compute_sccs(outlives_constraints, annotations);
    scc_annotations_ = annotations.scc_to_annotation;
  } else {
    // If we didn't add any back-edges; no more work needs doing
    // debug!("No constraints rewritten!");
    constraint_sccs_ = constraint_sccs;
    scc_annotations_ = scc_annotations.scc_to_annotation;
  }

  return {
    constraint_sccs: constraint_sccs_,
    definitions,
    scc_annotations: scc_annotations_,
    outlives_constraints,
    type_tests,
    liveness_constraints,
    universe_causes,
    placeholder_indices,
  };
}

// rustc: compiler/rustc_borrowck/src/handle_placeholders.rs:316 rewrite_placeholder_outlives
export function rewrite_placeholder_outlives(
  sccs: Sccs<RegionVid, ConstraintSccIndex>,
  annotations: SccAnnotations<RegionTracker>,
  fr_static: RegionVid,
  outlives_constraints: OutlivesConstraintSet,
): boolean {
  // Changed to `true` if we added any constraints and need to
  // recompute SCCs.
  let added_constraints = false;

  const annotations_ = annotations.scc_to_annotation;

  for (const scc of sccs.all_sccs()) {
    // No point in adding 'static: 'static!
    if (scc === sccs.scc(fr_static)) {
      continue;
    }

    const annotation = index_vec(annotations_, scc);

    const unnameable = annotation.unnameable_placeholder();
    if (unnameable === undefined) {
      continue;
    }
    const [_max_u, max_u_rvid] = unnameable;

    // debug!(
    //     "Placeholder universe {max_u:?} is too large for its SCC, represented by {:?}",
    //     annotation.representative
    // );

    // We only add one `r: 'static` constraint per SCC, where `r` is the SCC representative.
    // That constraint is annotated with some placeholder `unnameable` where
    // `unnameable` is unnameable from `r` and there is a path in the constraint graph
    // between them.
    //
    // There is one exception; if some other region in this SCC can't name `'r`, then
    // we pick the region with the smallest universe in the SCC, so that a path can
    // always start in `'r` to find a motivation that isn't cyclic.
    let blame_to: RegionVid;
    if (Representative.rvid(annotation.representative) === max_u_rvid) {
      // Assertion: the region that lowered our universe is an existential one and we are a placeholder!

      // The SCC's representative is not nameable from some region
      // that ends up in the SCC.
      const small_universed_rvid = annotation.max_nameable_universe[1];
      // debug!(
      //     "{small_universed_rvid:?} lowered our universe to {:?}",
      //     annotation.max_nameable_universe()
      // );
      blame_to = small_universed_rvid;
    } else {
      // `max_u_rvid` is not nameable by the SCC's representative.
      blame_to = max_u_rvid;
    }

    // FIXME: if we can extract a useful blame span here, future error
    // reporting and constraint search can be simplified.

    added_constraints = true;
    outlives_constraints.push({
      sup: Representative.rvid(annotation.representative),
      sub: fr_static,
      category: { $: "OutlivesUnnameablePlaceholder", _0: blame_to },
      locations: { $: "All", _0: DUMMY_SP },
      span: DUMMY_SP,
      variance_info: VarianceDiagInfo.None,
      from_closure: false,
    });
  }
  return added_constraints;
}


/** `vec[i]` (panics out of bounds, like `Index for IndexVec`). */
function index_vec<T>(v: readonly T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// PORT: `Ord::max` / `Ord::min` on `(UniverseIndex, RegionVid)` tuples (lexicographic; `max` keeps the second, `min` the
// first on ties).
function tuple_cmp(a: readonly [UniverseIndex, RegionVid], b: readonly [UniverseIndex, RegionVid]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}
function tuple_max(a: [UniverseIndex, RegionVid], b: [UniverseIndex, RegionVid]): [UniverseIndex, RegionVid] {
  return tuple_cmp(a, b) > 0 ? a : b;
}
function tuple_min(a: [UniverseIndex, RegionVid], b: [UniverseIndex, RegionVid]): [UniverseIndex, RegionVid] {
  return tuple_cmp(a, b) <= 0 ? a : b;
}

// PORT: `Representative::min` of `#[derive(PartialOrd, Ord)]`: variant order (FreeRegion < Placeholder < Existential),
// then the `RegionVid`; the first on ties.
const REPRESENTATIVE_DISCRIMINANT = { FreeRegion: 0, Placeholder: 1, Existential: 2 } as const;
function representative_min(a: Representative, b: Representative): Representative {
  const da = REPRESENTATIVE_DISCRIMINANT[a.$];
  const db = REPRESENTATIVE_DISCRIMINANT[b.$];
  if (da !== db) return da < db ? a : b;
  return a._0 <= b._0 ? a : b;
}
