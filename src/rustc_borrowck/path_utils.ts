// Port of compiler/rustc_borrowck/src/path_utils.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `each_borrow_involving_path<F, I, S>`: `s: &mut S` is the shared object `s`; `F` / `I` are arrow types.
import type { FieldIdx } from "../rustc_abi/lib.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import type { BasicBlock, Body, Location, Place, PlaceRef } from "../rustc_middle/mir/mod.ts";
import type { CapturedPlace } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { BorrowData, BorrowSet } from "./borrow_set.gen.ts";
import type { BorrowIndex } from "./dataflow.gen.ts";
import type { AccessDepth } from "./lib.gen.ts";
import { borrow_conflicts_with_place, PlaceConflictBias } from "./places_conflict.ts";
export {};

/// Encapsulates the idea of iterating over every borrow that involves a particular path
// rustc: compiler/rustc_borrowck/src/path_utils.rs:13 each_borrow_involving_path
export function each_borrow_involving_path<S>(
  s: S,
  tcx: TyCtxt,
  body: Body,
  access_place: [AccessDepth, Place],
  borrow_set: BorrowSet,
  is_candidate: (i: BorrowIndex) => boolean,
  op: (s: S, i: BorrowIndex, borrowed: BorrowData) => ControlFlow<null>,
): void {
  const [access, place] = access_place;

  // The number of candidates can be large, but borrows for different locals cannot conflict with
  // each other, so we restrict the working set a priori.
  const borrows_for_place_base = borrow_set.borrows_on_local(place.local);
  if (borrows_for_place_base === undefined) return;

  // check for loan restricting path P being used. Accounts for
  // borrows of P, P.a.b, etc.
  for (const i of borrows_for_place_base) {
    if (!is_candidate(i)) {
      continue;
    }
    const borrowed = borrow_set.index(i);

    if (
      borrow_conflicts_with_place(tcx, body, borrowed.borrowed_place, borrowed.kind, place.as_ref(), access, PlaceConflictBias.Overlap)
    ) {
      // debug!("each_borrow_involving_path: {:?} @ {:?} vs. {:?}/{:?}", i, borrowed, place, access);
      const ctrl = op(s, i, borrowed);
      if (ctrl.$ === "Break") {
        return;
      }
    }
  }
}

// rustc: compiler/rustc_borrowck/src/path_utils.rs:60 is_active
export function is_active(dominators: Dominators<BasicBlock>, borrow_data: BorrowData, location: Location): boolean {
  // debug!("is_active(borrow_data={:?}, location={:?})", borrow_data, location);

  let activation_location: Location;
  switch (borrow_data.activation_location.$) {
    // If this is not a 2-phase borrow, it is always active.
    case "NotTwoPhase":
      return true;
    // And if the unique 2-phase use is not an activation, then it is *never* active.
    case "NotActivated":
      return false;
    // Otherwise, we derive info from the activation point `loc`:
    case "ActivatedAt":
      activation_location = borrow_data.activation_location._0;
      break;
  }

  // Otherwise, it is active for every location *except* in between
  // the reservation and the activation:
  //
  //       X
  //      /
  //     R      <--+ Except for this
  //    / \        | diamond
  //    \ /        |
  //     A  <------+
  //     |
  //     Z
  //
  // Note that we assume that:
  // - the reservation R dominates the activation A
  // - the activation A post-dominates the reservation R (ignoring unwinding edges).
  //
  // This means that there can't be an edge that leaves A and
  // comes back into that diamond unless it passes through R.
  //
  // Suboptimal: In some cases, this code walks the dominator
  // tree twice when it only has to be walked once. I am
  // lazy. -nmatsakis

  // If dominated by the activation A, then it is active. The
  // activation occurs upon entering the point A, so this is
  // also true if location == activation_location.
  if (activation_location.dominates(location, dominators)) {
    return true;
  }

  // The reservation starts *on exiting* the reservation block,
  // so check if the location is dominated by R.successor. If so,
  // this point falls in between the reservation and location.
  const reserve_location = borrow_data.reserve_location.successor_within_block();
  if (reserve_location.dominates(location, dominators)) {
    return false;
  } else {
    // Otherwise, this point is outside the diamond, so
    // consider the borrow active. This could happen for
    // example if the borrow remains active around a loop (in
    // which case it would be active also for the point R,
    // which would generate an error).
    return true;
  }
}

/// Determines if a given borrow is borrowing local data
/// This is called for all Yield expressions on movable coroutines
// rustc: compiler/rustc_borrowck/src/path_utils.rs:124 borrow_of_local_data
export function borrow_of_local_data(place: Place): boolean {
  // Reborrow of already borrowed data is ignored
  // Any errors will be caught on the initial borrow
  return !place.is_indirect();
}

/// If `place` is a field projection, and the field is being projected from a closure type,
/// then returns the index of the field being projected. Note that this closure will always
/// be `self` in the current MIR, because that is the only time we directly access the fields
/// of a closure type.
// rustc: compiler/rustc_borrowck/src/path_utils.rs:134 is_upvar_field_projection
export function is_upvar_field_projection(
  tcx: TyCtxt,
  upvars: readonly CapturedPlace[],
  place_ref: PlaceRef,
  body: Body,
): FieldIdx | undefined {
  let by_ref = false;

  const last = place_ref.last_projection();
  if (last !== undefined && last[1].$ === "Deref") {
    place_ref = last[0];
    by_ref = true;
  }

  const last2 = place_ref.last_projection();
  if (last2 !== undefined && last2[1].$ === "Field") {
    const place_base = last2[0];
    const field = last2[1]._0;
    const base_ty = place_base.ty(body, tcx).ty;
    if ((base_ty.is_closure() || base_ty.is_coroutine() || base_ty.is_coroutine_closure()) && (!by_ref || upvars[field]!.is_by_ref())) {
      return field;
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}
