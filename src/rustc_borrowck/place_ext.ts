// Port of compiler/rustc_borrowck/src/place_ext.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the extension trait `#[extension(pub trait PlaceExt)] impl Place` augments rustc_middle's mir `Place` class
// (mir/syntax.gen.ts) with `ignore_borrow` (errctxt-contract `ObligationCauseExt` precedent).
import { type Body, Place } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { unported } from "../std/panic.ts";
import type { LocalsStateAtExit } from "./borrow_set.gen.ts";
export {};

declare module "../rustc_middle/mir/syntax.gen.ts" {
  interface Place {
    // place_ext.rs:15 (lane bck-core) `PlaceExt::ignore_borrow`
    ignore_borrow(tcx: TyCtxt, body: Body, locals_state_at_exit: LocalsStateAtExit): boolean;
  }
}

/// Returns `true` if we can safely ignore borrows of this place.
/// This is true whenever there is no action that the user can do
/// to the place `self` that would invalidate the borrow. This is true
/// for borrows of raw pointer dereferents as well as shared references.
// stub: compiler/rustc_borrowck/src/place_ext.rs:15 ignore_borrow (lane bck-core)
Place.prototype.ignore_borrow = function (this: Place, tcx: TyCtxt, body: Body, locals_state_at_exit: LocalsStateAtExit): boolean {
  return unported("rustc_borrowck::place_ext::Place::ignore_borrow");
};
