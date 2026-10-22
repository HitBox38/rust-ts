// Port of compiler/rustc_borrowck/src/places_conflict.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import type { Body, BorrowKind, Place, PlaceElem, PlaceRef } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import type { AccessDepth, Overlap } from "./lib.gen.ts";
import type { PlaceConflictBias } from "./places_conflict.gen.ts";
export * from "./places_conflict.gen.ts";

/// Helper function for checking if places conflict with a mutable borrow and deep access depth.
/// This is used to check for places conflicting outside of the borrow checking code (such as in
/// dataflow).
// stub: compiler/rustc_borrowck/src/places_conflict.rs:81 places_conflict (lane bck-core)
export function places_conflict(tcx: TyCtxt, body: Body, borrow_place: Place, access_place: Place, bias: PlaceConflictBias): boolean {
  return unported("rustc_borrowck::places_conflict::places_conflict");
}

/// Checks whether the `borrow_place` conflicts with the `access_place` given a borrow kind and
/// access depth. The `bias` parameter is used to determine how the unknowable (comparing runtime
/// array indices, for example) should be interpreted - this depends on what the caller wants in
/// order to make the conservative choice and preserve soundness.
// stub: compiler/rustc_borrowck/src/places_conflict.rs:104 borrow_conflicts_with_place (lane bck-core)
export function borrow_conflicts_with_place(
  tcx: TyCtxt,
  body: Body,
  borrow_place: Place,
  borrow_kind: BorrowKind,
  access_place: PlaceRef,
  access: AccessDepth,
  bias: PlaceConflictBias,
): boolean {
  return unported("rustc_borrowck::places_conflict::borrow_conflicts_with_place");
}

// stub: compiler/rustc_borrowck/src/places_conflict.rs:131 place_components_conflict (lane bck-core)
function place_components_conflict(
  tcx: TyCtxt,
  body: Body,
  borrow_place: Place,
  borrow_kind: BorrowKind,
  access_place: PlaceRef,
  access: AccessDepth,
  bias: PlaceConflictBias,
): boolean {
  return unported("rustc_borrowck::places_conflict::place_components_conflict");
}

// Given that the bases of `elem1` and `elem2` are always either equal
// or disjoint (and have the same type!), return the overlap situation
// between `elem1` and `elem2`.
// stub: compiler/rustc_borrowck/src/places_conflict.rs:298 place_projection_conflict (lane bck-core)
function place_projection_conflict(
  tcx: TyCtxt,
  body: Body,
  pi1: PlaceRef,
  pi1_elem: PlaceElem,
  pi2_elem: PlaceElem,
  bias: PlaceConflictBias,
): Overlap {
  return unported("rustc_borrowck::places_conflict::place_projection_conflict");
}
