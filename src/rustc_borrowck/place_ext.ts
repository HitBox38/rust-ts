// Port of compiler/rustc_borrowck/src/place_ext.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the extension trait `#[extension(pub trait PlaceExt)] impl Place` augments rustc_middle's mir `Place` class
// (mir/syntax.gen.ts) with `ignore_borrow` (errctxt-contract `ObligationCauseExt` precedent).
import { type Body, Place } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalsStateAtExit } from "./borrow_set.gen.ts";
export {};

declare module "../rustc_middle/mir/syntax.gen.ts" {
  interface Place {
    // place_ext.rs:15 `PlaceExt::ignore_borrow`
    ignore_borrow(tcx: TyCtxt, body: Body, locals_state_at_exit: LocalsStateAtExit): boolean;
  }
}

/// Returns `true` if we can safely ignore borrows of this place.
/// This is true whenever there is no action that the user can do
/// to the place `self` that would invalidate the borrow. This is true
/// for borrows of raw pointer dereferents as well as shared references.
// rustc: compiler/rustc_borrowck/src/place_ext.rs:15 ignore_borrow
Place.prototype.ignore_borrow = function (this: Place, tcx: TyCtxt, body: Body, locals_state_at_exit: LocalsStateAtExit): boolean {
  // If a local variable is immutable, then we only need to track borrows to guard
  // against two kinds of errors:
  // * The variable being dropped while still borrowed (e.g., because the fn returns
  //   a reference to a local variable)
  // * The variable being moved while still borrowed
  //
  // In particular, the variable cannot be mutated -- the "access checks" will fail --
  // so we don't have to worry about mutation while borrowed.
  if (locals_state_at_exit.$ === "SomeAreInvalidated") {
    const has_storage_dead_or_moved = locals_state_at_exit.has_storage_dead_or_moved;
    const ignore = !has_storage_dead_or_moved.contains(this.local) && body.local_decls[this.local]!.mutability === "Not";
    // debug!("ignore_borrow: local {:?} => {:?}", self.local, ignore);
    if (ignore) {
      return true;
    }
  }

  const projections = this.iter_projections();
  for (let i = 0; i < projections.length; i++) {
    const [proj_base, elem] = projections[i]!;
    if (elem.$ === "Deref") {
      const ty = proj_base.ty(body, tcx).ty;
      const kind = ty.kind();
      if (kind.$ === "Ref" && kind._2 === "Not" && i === 0) {
        // For references to thread-local statics, we do need
        // to track the borrow.
        if (body.local_decls[this.local]!.is_ref_to_thread_local()) {
          continue;
        }
        return true;
      } else if (kind.$ === "RawPtr" || (kind.$ === "Ref" && kind._2 === "Not")) {
        // For both derefs of raw pointers and `&T`
        // references, the original path is `Copy` and
        // therefore not significant. In particular,
        // there is nothing the user can do to the
        // original path that would invalidate the
        // newly created reference -- and if there
        // were, then the user could have copied the
        // original path into a new variable and
        // borrowed *that* one, leaving the original
        // path unborrowed.
        return true;
      }
    }
  }

  return false;
};
