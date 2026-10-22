//! From the NLL RFC:
//! "Shallow prefixes are found by stripping away fields, but stop at
//! any dereference. So: writing a path like `a` is illegal if `a.b`
//! is borrowed. But: writing `a` is legal if `*a` is borrowed,
//! whether or not `a` is a shared or mutable reference. [...] "
// Port of compiler/rustc_borrowck/src/prefixes.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Prefixes` is a plain generated interface (no inherent impl), so `impl Iterator for Prefixes` is the impl table
// `Iterator_Prefixes`, whose `next` returns `Option<PlaceRef>` (`PlaceRef | undefined`; a `PlaceRef` is an object).
import type { PlaceRef } from "../rustc_middle/mir/mod.ts";
import { unported } from "../std/panic.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
import type { PrefixSet, Prefixes } from "./prefixes.gen.ts";
export * from "./prefixes.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // prefixes.rs:29 (lane bck-core)
    prefixes(place_ref: PlaceRef, kind: PrefixSet): Prefixes;
  }
}

/// Returns an iterator over the prefixes of `place`
/// (inclusive) from longest to smallest, potentially
/// terminating the iteration early based on `kind`.
// stub: compiler/rustc_borrowck/src/prefixes.rs:29 prefixes (lane bck-core)
MirBorrowckCtxt.prototype.prefixes = function (this: MirBorrowckCtxt, place_ref: PlaceRef, kind: PrefixSet): Prefixes {
  return unported("rustc_borrowck::prefixes::MirBorrowckCtxt::prefixes");
};

// impl<'tcx> Iterator for Prefixes<'tcx>
export const Iterator_Prefixes = {
  // stub: compiler/rustc_borrowck/src/prefixes.rs:36 next (lane bck-core)
  next(self: Prefixes): PlaceRef | undefined {
    return unported("rustc_borrowck::prefixes::Prefixes::next");
  },
};
