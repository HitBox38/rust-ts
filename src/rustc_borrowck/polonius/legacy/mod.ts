// Port of compiler/rustc_borrowck/src/polonius/legacy/mod.rs (lane borrowck-contract: declarations; fill lanes bck-nll
// (`emit_facts`, main path: it returns at once without facts) and bck-polonius-legacy (the rest; wave 26, plan-m4 D7)).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Functions dedicated to fact generation for the `-Zpolonius=legacy` datalog implementation.
//!
//! Will be removed in the future, once the in-tree `-Zpolonius=next` implementation reaches feature
//! parity.
// PORT: `pub use self::location::*` / `pub use self::facts::*` are not re-exported (location.ts / facts.ts assign
// prototypes / companions at load; lib.ts header, init order): import from ./location.ts / ./facts.ts.
// PORT: `facts: &mut Option<PoloniusFacts>` is `PoloniusFacts | undefined` (the `Option` is only read, the facts are
// changed in place).
import type { Body, Local } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { MoveData } from "../../../rustc_mir_dataflow/move_paths/mod.ts";
import { unported } from "../../../std/panic.ts";
import { emit_access_facts } from "./accesses.ts";
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
// stub: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:69 emit_move_facts (lane bck-polonius-legacy)
export function emit_move_facts(facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, move_data: MoveData): void {
  return unported("rustc_borrowck::polonius::legacy::emit_move_facts");
}

/// Emit universal regions facts, and their relations.
// stub: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:140 emit_universal_region_facts (lane bck-polonius-legacy)
export function emit_universal_region_facts(facts: PoloniusFacts, borrow_set: BorrowSet, universal_region_relations: UniversalRegionRelations): void {
  return unported("rustc_borrowck::polonius::legacy::emit_universal_region_facts");
}

/// For every potentially drop()-touched region `region` in `local`'s type
/// (`kind`), emit a `drop_of_var_derefs_origin(local, origin)` fact.
// stub: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:184 emit_drop_facts (lane bck-polonius-legacy)
export function emit_drop_facts(tcx: TyCtxt, local: Local, kind: GenericArg, universal_regions: UniversalRegions, facts: PoloniusFacts | undefined): void {
  return unported("rustc_borrowck::polonius::legacy::emit_drop_facts");
}

/// Emit facts about the outlives constraints: the `subset` base relation, i.e. not a transitive
/// closure.
// stub: compiler/rustc_borrowck/src/polonius/legacy/mod.rs:202 emit_outlives_facts (lane bck-polonius-legacy)
export function emit_outlives_facts(facts: PoloniusFacts, location_table: PoloniusLocationTable, constraints: LoweredConstraints): void {
  return unported("rustc_borrowck::polonius::legacy::emit_outlives_facts");
}
