//! From the NLL RFC:
//! "Shallow prefixes are found by stripping away fields, but stop at
//! any dereference. So: writing a path like `a` is illegal if `a.b`
//! is borrowed. But: writing `a` is legal if `*a` is borrowed,
//! whether or not `a` is a shared or mutable reference. [...] "
// Port of compiler/rustc_borrowck/src/prefixes.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Prefixes` is a plain generated interface (no inherent impl), so `impl Iterator for Prefixes` is the impl table
// `Iterator_Prefixes`, whose `next` returns `Option<PlaceRef>` (`PlaceRef | undefined`; a `PlaceRef` is an object).
import type { PlaceRef } from "../rustc_middle/mir/mod.ts";
import { unreachable } from "../std/panic.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
import type { PrefixSet, Prefixes } from "./prefixes.gen.ts";
export * from "./prefixes.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // prefixes.rs:29
    prefixes(place_ref: PlaceRef, kind: PrefixSet): Prefixes;
  }
}

/// Returns an iterator over the prefixes of `place`
/// (inclusive) from longest to smallest, potentially
/// terminating the iteration early based on `kind`.
// rustc: compiler/rustc_borrowck/src/prefixes.rs:29 prefixes
MirBorrowckCtxt.prototype.prefixes = function (this: MirBorrowckCtxt, place_ref: PlaceRef, kind: PrefixSet): Prefixes {
  return { next: place_ref, kind };
};

// impl<'tcx> Iterator for Prefixes<'tcx>
export const Iterator_Prefixes = {
  // rustc: compiler/rustc_borrowck/src/prefixes.rs:36 next
  next(self: Prefixes): PlaceRef | undefined {
    if (self.next === undefined) return undefined;
    let cursor = self.next;

    // Post-processing `place`: Enqueue any remaining
    // work. Also, `place` may not be a prefix itself, but
    // may hold one further down (e.g., we never return
    // downcasts here, but may return a base of a downcast).

    for (;;) {
      const last = cursor.last_projection();
      if (last === undefined) {
        self.next = undefined;
        return cursor;
      } else {
        const [cursor_base, elem] = last;
        switch (elem.$) {
          case "Field": {
            // FIXME: add union handling
            self.next = cursor_base;
            return cursor;
          }
          case "UnwrapUnsafeBinder": {
            self.next = cursor_base;
            return cursor;
          }
          case "Downcast":
          case "Subslice":
          case "OpaqueCast":
          case "ConstantIndex":
          case "Index": {
            cursor = cursor_base;
            break;
          }
          case "PhantomDeref": {
            return unreachable("internal error: entered unreachable code: PhantomDeref should not be present in prefixes");
          }
          case "Deref": {
            switch (self.kind) {
              case "Shallow": {
                // Shallow prefixes are found by stripping away
                // fields, but stop at *any* dereference.
                // So we can just stop the traversal now.
                self.next = undefined;
                return cursor;
              }
              case "All": {
                // All prefixes: just blindly enqueue the base
                // of the projection.
                self.next = cursor_base;
                return cursor;
              }
            }
          }
        }
      }
    }
  },
};
