// Port of compiler/rustc_borrowck/src/path_utils.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `each_borrow_involving_path<F, I, S>`: `s: &mut S` is the shared object `s`; `F` / `I` are arrow types.
import type { FieldIdx } from "../rustc_abi/lib.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import type { BasicBlock, Body, Location, Place, PlaceRef } from "../rustc_middle/mir/mod.ts";
import type { CapturedPlace } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import type { BorrowData, BorrowSet } from "./borrow_set.gen.ts";
import type { BorrowIndex } from "./dataflow.gen.ts";
import type { AccessDepth } from "./lib.gen.ts";
export {};

/// Encapsulates the idea of iterating over every borrow that involves a particular path
// stub: compiler/rustc_borrowck/src/path_utils.rs:13 each_borrow_involving_path (lane bck-core)
export function each_borrow_involving_path<S>(
  s: S,
  tcx: TyCtxt,
  body: Body,
  access_place: [AccessDepth, Place],
  borrow_set: BorrowSet,
  is_candidate: (i: BorrowIndex) => boolean,
  op: (s: S, i: BorrowIndex, borrowed: BorrowData) => ControlFlow<null>,
): void {
  return unported("rustc_borrowck::path_utils::each_borrow_involving_path");
}

// stub: compiler/rustc_borrowck/src/path_utils.rs:60 is_active (lane bck-core)
export function is_active(dominators: Dominators<BasicBlock>, borrow_data: BorrowData, location: Location): boolean {
  return unported("rustc_borrowck::path_utils::is_active");
}

/// Determines if a given borrow is borrowing local data
/// This is called for all Yield expressions on movable coroutines
// stub: compiler/rustc_borrowck/src/path_utils.rs:124 borrow_of_local_data (lane bck-core)
export function borrow_of_local_data(place: Place): boolean {
  return unported("rustc_borrowck::path_utils::borrow_of_local_data");
}

/// If `place` is a field projection, and the field is being projected from a closure type,
/// then returns the index of the field being projected. Note that this closure will always
/// be `self` in the current MIR, because that is the only time we directly access the fields
/// of a closure type.
// stub: compiler/rustc_borrowck/src/path_utils.rs:134 is_upvar_field_projection (lane bck-core)
export function is_upvar_field_projection(
  tcx: TyCtxt,
  upvars: readonly CapturedPlace[],
  place_ref: PlaceRef,
  body: Body,
): FieldIdx | undefined {
  return unported("rustc_borrowck::path_utils::is_upvar_field_projection");
}
