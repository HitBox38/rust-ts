// Port of compiler/rustc_borrowck/src/polonius/legacy/mod.rs (lane borrowck-contract: declarations; fill lanes bck-nll
// (`emit_facts`, `emit_drop_facts`: main path, they return at once without facts) and bck-polonius-legacy (the rest;
// wave 26/29, plan-m4 D7)).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Functions dedicated to fact generation for the `-Zpolonius=legacy` datalog implementation.
//!
//! Will be removed in the future, once the in-tree `-Zpolonius=next` implementation reaches feature
//! parity.
// PORT: `pub use self::location::*` / `pub use self::facts::*` are not re-exported (location.ts / facts.ts assign
// prototypes / companions at load; lib.ts header, init order): import from ./location.ts / ./facts.ts.
// PORT: `facts: &mut Option<PoloniusFacts>` is `PoloniusFacts | undefined` (the `Option` is only read, the facts are
// changed in place).
import { BasicBlock, type Body, type Local, Location } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { type MoveData, MovePathIndex } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { assert } from "../../../std/panic.ts";
import { fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { emit_access_facts } from "./accesses.ts";
import { PoloniusRegionVid_from_RegionVid } from "./facts.ts";
import { BorrowIndex } from "../../dataflow.gen.ts";
import { Locations } from "../../type_check/mod.ts";
import { emit_loan_invalidations } from "./loan_invalidations.ts";
import { emit_loan_kills } from "./loan_kills.ts";
import type { BorrowSet } from "../../borrow_set.gen.ts";
import type { LoweredConstraints } from "../../handle_placeholders.gen.ts";
import type { UniversalRegionRelations } from "../../type_check/free_region_relations.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { PoloniusLocationTable } from "./location.gen.ts";

export {};

/// When requested, emit most of the facts needed by polonius:
/// - moves and assignments
/// - universal regions and their relations
/// - CFG points and edges
/// - loan kills
/// - loan invalidations
/// - access facts such as variable definitions, uses, drops, and path accesses
/// - outlives constraints
///
/// The rest of the facts are emitted during typeck and liveness.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:38 emit_facts
export function emit_facts(
  facts: PoloniusFacts | undefined,
  tcx: TyCtxt,
  location_table: PoloniusLocationTable,
  body: Body,
  borrow_set: BorrowSet,
  move_data: MoveData,
  universal_region_relations: UniversalRegionRelations,
  constraints: LoweredConstraints,
): void {
  if (facts === undefined) {
    // We don't do anything if there are no facts to fill.
    return;
  }
  // PORT: `tcx.prof.generic_activity(..)` timer dropped (driver-m2 decision 8).
  emit_move_facts(facts, body, location_table, move_data);
  emit_universal_region_facts(facts, borrow_set, universal_region_relations);
  emit_loan_kills(tcx, facts, body, location_table, borrow_set);
  emit_loan_invalidations(tcx, facts, body, location_table, borrow_set);
  emit_access_facts(tcx, facts, body, location_table, move_data, universal_region_relations.universal_regions);
  emit_outlives_facts(facts, location_table, constraints);
}

/// Emit facts needed for move/init analysis: moves and assignments.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:69 emit_move_facts
export function emit_move_facts(facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, move_data: MoveData): void {
  for (const [l, r] of move_data.rev_lookup.iter_locals_enumerated()) facts.path_is_var.push([r, l]);

  for (let i = 0; i < move_data.move_paths.length; i++) {
    const child = MovePathIndex.new(i);
    const move_path = move_data.move_paths[i]!;
    const parent = move_path.parent;
    if (parent !== undefined) {
      facts.child_path.push([child, parent]);
    }
  }

  const fn_entry_start = location_table.start_index(Location.START);

  // initialized_at
  for (const init of move_data.inits) {
    switch (init.location.$) {
      case "Statement": {
        const location = init.location._0;
        const block_data = body.index(location.block);
        const is_terminator = location.statement_index === block_data.statements.length;

        if (is_terminator && init.kind === "NonPanicPathOnly") {
          // We are at the terminator of an init that has a panic path,
          // and where the init should not happen on panic

          for (const successor of block_data.terminator_().successors()) {
            if (body.index(successor).is_cleanup) {
              continue;
            }

            // The initialization happened in (or rather, when arriving at)
            // the successors, but not in the unwind block.
            const first_statement = BasicBlock.start_location(successor);
            facts.path_assigned_at_base.push([init.path, location_table.start_index(first_statement)]);
          }
        } else {
          // In all other cases, the initialization just happens at the
          // midpoint, like any other effect.
          facts.path_assigned_at_base.push([init.path, location_table.mid_index(location)]);
        }
        break;
      }
      // Arguments are initialized on function entry
      case "Argument": {
        const local = init.location._0;
        assert(body.local_kind(local) === "Arg", "assertion failed: body.local_kind(local) == LocalKind::Arg");
        facts.path_assigned_at_base.push([init.path, fn_entry_start]);
        break;
      }
    }
  }

  for (const [local, path] of move_data.rev_lookup.iter_locals_enumerated()) {
    if (body.local_kind(local) !== "Arg") {
      // Non-arguments start out deinitialised; we simulate this with an
      // initial move:
      facts.path_moved_at_base.push([path, fn_entry_start]);
    }
  }

  // moved_out_at
  // deinitialisation is assumed to always happen!
  for (const mo of move_data.move_outs) facts.path_moved_at_base.push([mo.path, location_table.mid_index(mo.source)]);
}

/// Emit universal regions facts, and their relations.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:140 emit_universal_region_facts
export function emit_universal_region_facts(facts: PoloniusFacts, borrow_set: BorrowSet, universal_region_relations: UniversalRegionRelations): void {
  // 1: universal regions are modeled in Polonius as a pair:
  // - the universal region vid itself.
  // - a "placeholder loan" associated to this universal region. Since they don't exist in
  //   the `borrow_set`, their `BorrowIndex` are synthesized as the universal region index
  //   added to the existing number of loans, as if they succeeded them in the set.
  //
  const universal_regions = universal_region_relations.universal_regions;
  for (const r of universal_regions.universal_regions_iter()) facts.universal_region.push(PoloniusRegionVid_from_RegionVid(r));
  const borrow_count = borrow_set.len();
  // debug!(
  //     "emit_universal_region_facts: polonius placeholders, num_universals={}, borrow_count={}",
  //     universal_regions.len(),
  //     borrow_count
  // );

  for (const universal_region of universal_regions.universal_regions_iter()) {
    const universal_region_idx = RegionVid.index(universal_region);
    const placeholder_loan_idx = borrow_count + universal_region_idx;
    facts.placeholder.push([PoloniusRegionVid_from_RegionVid(universal_region), BorrowIndex.from_usize(placeholder_loan_idx)]);
  }

  // 2: the universal region relations `outlives` constraints are emitted as
  //  `known_placeholder_subset` facts.
  for (const [fr1, fr2] of universal_region_relations.known_outlives()) {
    if (fr1 !== fr2) {
      // debug!(
      //     "emit_universal_region_facts: emitting polonius `known_placeholder_subset` \
      //          fr1={:?}, fr2={:?}",
      //     fr1, fr2
      // );
      facts.known_placeholder_subset.push([PoloniusRegionVid_from_RegionVid(fr1), PoloniusRegionVid_from_RegionVid(fr2)]);
    }
  }
}

/// For every potentially drop()-touched region `region` in `local`'s type
/// (`kind`), emit a `drop_of_var_derefs_origin(local, origin)` fact.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:184 emit_drop_facts
export function emit_drop_facts(tcx: TyCtxt, local: Local, kind: GenericArg, universal_regions: UniversalRegions, facts: PoloniusFacts | undefined): void {
  // debug!("emit_drop_facts(local={:?}, kind={:?}", local, kind);
  if (facts === undefined) return;
  // PORT: `tcx.prof.generic_activity(..)` timer dropped (driver-m2 decision 8).
  tcx.for_each_free_region(
    kind,
    (drop_live_region) => {
      const region_vid = universal_regions.to_region_vid(drop_live_region);
      facts.drop_of_var_derefs_origin.push([local, PoloniusRegionVid_from_RegionVid(region_vid)]);
    },
    fold_GenericArg,
  );
}

/// Emit facts about the outlives constraints: the `subset` base relation, i.e. not a transitive
/// closure.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:202 emit_outlives_facts
export function emit_outlives_facts(facts: PoloniusFacts, location_table: PoloniusLocationTable, constraints: LoweredConstraints): void {
  // PORT: `extend(iter.flat_map(..))`: each constraint's rows are pushed in iteration order.
  for (const constraint of constraints.outlives_constraints.outlives_()) {
    const from_location = Locations.from_location(constraint.locations);
    if (from_location !== undefined) {
      facts.subset_base.push([
        PoloniusRegionVid_from_RegionVid(constraint.sup),
        PoloniusRegionVid_from_RegionVid(constraint.sub),
        location_table.mid_index(from_location),
      ]);
    } else {
      for (const location of location_table.all_points()) {
        facts.subset_base.push([PoloniusRegionVid_from_RegionVid(constraint.sup), PoloniusRegionVid_from_RegionVid(constraint.sub), location]);
      }
    }
  }
}
