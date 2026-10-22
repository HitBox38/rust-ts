// Port of compiler/rustc_borrowck/src/consumers.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! This file provides API for compiler consumers.
// PORT: the `pub use` re-exports of consumers.rs (borrow_set, constraints, dataflow, place_ext, places_conflict,
// polonius legacy, region_infer, type_check items) are not repeated here: import them from their defining modules
// (lib.ts header, init order).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";
import { BorrowckConsumer, type BodyWithBorrowckFacts, type ConsumerOptions } from "./consumers.gen.ts";

export * from "./consumers.gen.ts";

declare module "./consumers.gen.ts" {
  interface BorrowckConsumer {
    // consumers.rs:34 (lane bck-nll)
    insert_body(def_id: LocalDefId, body: BodyWithBorrowckFacts): void;
    // consumers.rs:41 (lane bck-nll)
    polonius_input(): boolean;
    // consumers.rs:49 (lane bck-nll)
    polonius_output(): boolean;
  }
  namespace BorrowckConsumer {
    // consumers.rs:30 (lane bck-nll)
    function new_(options: ConsumerOptions): BorrowckConsumer;
    export { new_ as new };
  }
}

// stub: compiler/rustc_borrowck/src/consumers.rs:30 new (lane bck-nll)
(BorrowckConsumer as unknown as { new: typeof BorrowckConsumer.new }).new = function (options: ConsumerOptions): BorrowckConsumer {
  return unported("rustc_borrowck::consumers::BorrowckConsumer::new");
};

// stub: compiler/rustc_borrowck/src/consumers.rs:34 insert_body (lane bck-nll)
BorrowckConsumer.prototype.insert_body = function (this: BorrowckConsumer, def_id: LocalDefId, body: BodyWithBorrowckFacts): void {
  return unported("rustc_borrowck::consumers::BorrowckConsumer::insert_body");
};

/// Should the Polonius input facts be computed?
// stub: compiler/rustc_borrowck/src/consumers.rs:41 polonius_input (lane bck-nll)
BorrowckConsumer.prototype.polonius_input = function (this: BorrowckConsumer): boolean {
  return unported("rustc_borrowck::consumers::BorrowckConsumer::polonius_input");
};

/// Should we run Polonius and collect the output facts?
// stub: compiler/rustc_borrowck/src/consumers.rs:49 polonius_output (lane bck-nll)
BorrowckConsumer.prototype.polonius_output = function (this: BorrowckConsumer): boolean {
  return unported("rustc_borrowck::consumers::BorrowckConsumer::polonius_output");
};

/// This function computes borrowck facts for the given def id and all its nested bodies.
/// It must be called with a typeck root which will then borrowck all nested bodies as well.
/// The [`ConsumerOptions`] determine which facts are returned. This function makes a copy
/// of the bodies because it needs to regenerate the region identifiers. It should never be
/// invoked during a typical compilation session due to the unnecessary overhead of
/// returning [`BodyWithBorrowckFacts`].
// stub: compiler/rustc_borrowck/src/consumers.rs:123 get_bodies_with_borrowck_facts (lane bck-nll)
export function get_bodies_with_borrowck_facts(tcx: TyCtxt, root_def_id: LocalDefId, options: ConsumerOptions): Map<LocalDefId, BodyWithBorrowckFacts> {
  return unported("rustc_borrowck::consumers::get_bodies_with_borrowck_facts");
}
