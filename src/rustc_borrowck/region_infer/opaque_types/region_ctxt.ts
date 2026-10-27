// Port of compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: this `RegionCtxt` (a struct) is not renumber.rs's `RegionCtxt` (an enum); importers name the module.
// `Rc<DenseLocationMap>` is the shared `DenseLocationMap`; `Frozen<UniversalRegionRelations>` is the value.
import { clone_OutlivesConstraintSet, type ConstraintSccIndex, type OutlivesConstraintSet } from "../../constraints/mod.ts";
import { region_definitions, type RegionTracker, rewrite_placeholder_outlives, SccAnnotations } from "../../handle_placeholders.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import type { UniversalRegionRelations } from "../../type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "../../type_check/mod.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { ConstraintSccs, Representative } from "../mod.ts";
import { ReverseSccGraph } from "../reverse_sccs.ts";
import { default_PlaceholderIndices, RegionValues } from "../values.ts";
import { Sccs } from "../../../rustc_data_structures/graph/scc/mod.ts";
import type { DenseLocationMap } from "../../../rustc_mir_dataflow/points.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { panic } from "../../../std/panic.ts";
import { RegionCtxt } from "./region_ctxt.gen.ts";

export * from "./region_ctxt.gen.ts";

declare module "./region_ctxt.gen.ts" {
  interface RegionCtxt {
    // region_ctxt.rs:103
    representative(vid: RegionVid): Representative;
    // region_ctxt.rs:108
    max_placeholder_universe_reached(scc: ConstraintSccIndex): UniverseIndex;
    // region_ctxt.rs:115
    universal_regions(): UniversalRegions;
    // region_ctxt.rs:119
    eval_equal(r1_vid: RegionVid, r2_vid: RegionVid): boolean;
  }
  namespace RegionCtxt {
    // region_ctxt.rs:38
    function new_(
      infcx: BorrowckInferCtxt,
      universal_region_relations: UniversalRegionRelations,
      location_map: DenseLocationMap,
      constraints: MirTypeckRegionConstraints,
    ): RegionCtxt;
    export { new_ as new };
  }
}

/// Creates a new `RegionCtxt` used to compute defining opaque type uses.
///
/// This does not yet propagate region values. This is instead done lazily
/// when applying member constraints.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:38 new
(RegionCtxt as unknown as { new: typeof RegionCtxt.new }).new = function (
  infcx: BorrowckInferCtxt,
  universal_region_relations: UniversalRegionRelations,
  location_map: DenseLocationMap,
  constraints: MirTypeckRegionConstraints,
): RegionCtxt {
  const outlives_constraints = clone_OutlivesConstraintSet(constraints.outlives_constraints);
  const universal_regions = universal_region_relations.universal_regions;
  const [definitions, _has_placeholders] = region_definitions(infcx, universal_regions);

  const compute_sccs = (
    outlives_constraints: OutlivesConstraintSet,
    annotations: SccAnnotations<RegionTracker>,
  ): ConstraintSccs => {
    return Sccs.new_with_annotation<RegionVid, RegionTracker, ConstraintSccIndex>(
      outlives_constraints.graph(definitions.length).region_graph(outlives_constraints, universal_regions.fr_static),
      annotations,
    );
  };

  let scc_annotations = SccAnnotations.init<RegionTracker>(definitions);
  let constraint_sccs = compute_sccs(outlives_constraints, scc_annotations);

  const added_constraints = rewrite_placeholder_outlives(
    constraint_sccs,
    scc_annotations,
    universal_regions.fr_static,
    outlives_constraints,
  );

  if (added_constraints) {
    scc_annotations = SccAnnotations.init<RegionTracker>(definitions);
    constraint_sccs = compute_sccs(outlives_constraints, scc_annotations);
  }

  const scc_annotations_ = scc_annotations.scc_to_annotation;

  // Unlike the `RegionInferenceContext`, we only care about free regions
  // and fully ignore liveness and placeholders.
  const placeholder_indices = default_PlaceholderIndices();
  const scc_values = RegionValues.new<ConstraintSccIndex>(location_map, universal_regions.len(), placeholder_indices);
  for (let i = 0; i < definitions.length; i++) {
    const variable = i as RegionVid;
    const definition = definitions[i]!;
    const scc = constraint_sccs.scc(variable);
    switch (definition.origin.$) {
      case "FreeRegion": {
        scc_values.add_free_region(scc, variable);
        break;
      }
      default: {
        break;
      }
    }
  }

  const rev_scc_graph = ReverseSccGraph.compute(constraint_sccs, universal_regions);
  return new RegionCtxt(
    infcx,
    definitions,
    universal_region_relations,
    constraint_sccs,
    scc_annotations_,
    rev_scc_graph,
    scc_values,
  );
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:103 representative
RegionCtxt.prototype.representative = function (this: RegionCtxt, vid: RegionVid): Representative {
  const scc = this.constraint_sccs.scc(vid);
  return index_vec(this.scc_annotations, scc).representative;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:108 max_placeholder_universe_reached
RegionCtxt.prototype.max_placeholder_universe_reached = function (this: RegionCtxt, scc: ConstraintSccIndex): UniverseIndex {
  return index_vec(this.scc_annotations, scc).max_placeholder_universe_reached();
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:115 universal_regions
RegionCtxt.prototype.universal_regions = function (this: RegionCtxt): UniversalRegions {
  return this.universal_region_relations.universal_regions;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:119 eval_equal
RegionCtxt.prototype.eval_equal = function (this: RegionCtxt, r1_vid: RegionVid, r2_vid: RegionVid): boolean {
  const r1 = this.constraint_sccs.scc(r1_vid);
  const r2 = this.constraint_sccs.scc(r2_vid);

  if (r1 === r2) {
    return true;
  }

  const universal_outlives = (sub: ConstraintSccIndex, sup: ConstraintSccIndex): boolean => {
    for (const r1 of this.scc_values.universal_regions_outlived_by(sub)) {
      let any = false;
      for (const r2 of this.scc_values.universal_regions_outlived_by(sup)) {
        if (this.universal_region_relations.outlives_(r2, r1)) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    return true;
  };
  return universal_outlives(r1, r2) && universal_outlives(r2, r1);
};

/** `vec[i]` (panics out of bounds, like `Index for IndexVec`). */
function index_vec<T>(v: readonly T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}
