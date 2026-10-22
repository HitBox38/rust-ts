// Port of compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: this `RegionCtxt` (a struct) is not renumber.rs's `RegionCtxt` (an enum); importers name the module.
// `Rc<DenseLocationMap>` is the shared `DenseLocationMap`; `Frozen<UniversalRegionRelations>` is the value.
import type { ConstraintSccIndex } from "../../constraints/mod.gen.ts";
import type { BorrowckInferCtxt } from "../../lib.gen.ts";
import type { UniversalRegionRelations } from "../../type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "../../type_check/mod.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { Representative } from "../mod.gen.ts";
import type { DenseLocationMap } from "../../../rustc_mir_dataflow/points.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { unported } from "../../../std/panic.ts";
import { RegionCtxt } from "./region_ctxt.gen.ts";

export * from "./region_ctxt.gen.ts";

declare module "./region_ctxt.gen.ts" {
  interface RegionCtxt {
    // region_ctxt.rs:103 (lane bck-regions-b)
    representative(vid: RegionVid): Representative;
    // region_ctxt.rs:108 (lane bck-regions-b)
    max_placeholder_universe_reached(scc: ConstraintSccIndex): UniverseIndex;
    // region_ctxt.rs:115 (lane bck-regions-b)
    universal_regions(): UniversalRegions;
    // region_ctxt.rs:119 (lane bck-regions-b)
    eval_equal(r1_vid: RegionVid, r2_vid: RegionVid): boolean;
  }
  namespace RegionCtxt {
    // region_ctxt.rs:38 (lane bck-regions-b)
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
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:38 new (lane bck-regions-b)
(RegionCtxt as unknown as { new: typeof RegionCtxt.new }).new = function (
  infcx: BorrowckInferCtxt,
  universal_region_relations: UniversalRegionRelations,
  location_map: DenseLocationMap,
  constraints: MirTypeckRegionConstraints,
): RegionCtxt {
  return unported("rustc_borrowck::region_infer::opaque_types::region_ctxt::RegionCtxt::new");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:103 representative (lane bck-regions-b)
RegionCtxt.prototype.representative = function (this: RegionCtxt, vid: RegionVid): Representative {
  return unported("rustc_borrowck::region_infer::opaque_types::region_ctxt::RegionCtxt::representative");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:108 max_placeholder_universe_reached (lane bck-regions-b)
RegionCtxt.prototype.max_placeholder_universe_reached = function (this: RegionCtxt, scc: ConstraintSccIndex): UniverseIndex {
  return unported("rustc_borrowck::region_infer::opaque_types::region_ctxt::RegionCtxt::max_placeholder_universe_reached");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:115 universal_regions (lane bck-regions-b)
RegionCtxt.prototype.universal_regions = function (this: RegionCtxt): UniversalRegions {
  return unported("rustc_borrowck::region_infer::opaque_types::region_ctxt::RegionCtxt::universal_regions");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/region_ctxt.rs:119 eval_equal (lane bck-regions-b)
RegionCtxt.prototype.eval_equal = function (this: RegionCtxt, r1_vid: RegionVid, r2_vid: RegionVid): boolean {
  return unported("rustc_borrowck::region_infer::opaque_types::region_ctxt::RegionCtxt::eval_equal");
};
