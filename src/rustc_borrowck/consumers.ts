// Port of compiler/rustc_borrowck/src/consumers.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! This file provides API for compiler consumers.
// PORT: the `pub use` re-exports of consumers.rs (borrow_set, constraints, dataflow, place_ext, places_conflict,
// polonius legacy, region_infer, type_check items) are not repeated here: import them from their defining modules
// (lib.ts header, init order).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { debug_LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { BorrowCheckRootCtxt } from "./root_cx.gen.ts";
import "./root_cx.ts";
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

// rustc: compiler/rustc_borrowck/src/consumers.rs:30 new
(BorrowckConsumer as unknown as { new: typeof BorrowckConsumer.new }).new = function (options: ConsumerOptions): BorrowckConsumer {
  return new BorrowckConsumer(options, new Map<LocalDefId, BodyWithBorrowckFacts>());
};

// rustc: compiler/rustc_borrowck/src/consumers.rs:34 insert_body
BorrowckConsumer.prototype.insert_body = function (this: BorrowckConsumer, def_id: LocalDefId, body: BodyWithBorrowckFacts): void {
  const had = this.bodies.has(def_id);
  this.bodies.set(def_id, body);
  if (had) {
    bug(`unexpected previous body for ${format_debug(def_id, debug_LocalDefId, PLAIN)}`);
  }
};

/// Should the Polonius input facts be computed?
// rustc: compiler/rustc_borrowck/src/consumers.rs:41 polonius_input
BorrowckConsumer.prototype.polonius_input = function (this: BorrowckConsumer): boolean {
  return this.options === "PoloniusInputFacts" || this.options === "PoloniusOutputFacts";
};

/// Should we run Polonius and collect the output facts?
// rustc: compiler/rustc_borrowck/src/consumers.rs:49 polonius_output
BorrowckConsumer.prototype.polonius_output = function (this: BorrowckConsumer): boolean {
  return this.options === "PoloniusOutputFacts";
};

/// This function computes borrowck facts for the given def id and all its nested bodies.
/// It must be called with a typeck root which will then borrowck all nested bodies as well.
/// The [`ConsumerOptions`] determine which facts are returned. This function makes a copy
/// of the bodies because it needs to regenerate the region identifiers. It should never be
/// invoked during a typical compilation session due to the unnecessary overhead of
/// returning [`BodyWithBorrowckFacts`].
///
/// Note:
/// *   This function will panic if the required bodies were already stolen. This
///     can, for example, happen when requesting a body of a `const` function
///     because they are evaluated during typechecking. The panic can be avoided
///     by overriding the `mir_borrowck` query. You can find a complete example
///     that shows how to do this at `tests/ui-fulldeps/obtain-borrowck.rs`.
///
/// *   Polonius is highly unstable, so expect regular changes in its signature or other details.
// rustc: compiler/rustc_borrowck/src/consumers.rs:123 get_bodies_with_borrowck_facts
export function get_bodies_with_borrowck_facts(tcx: TyCtxt, root_def_id: LocalDefId, options: ConsumerOptions): Map<LocalDefId, BodyWithBorrowckFacts> {
  // PORT: `let tainted_by_errors = Default::default()` (a `Cell<Option<ErrorGuaranteed>>`) is the root context's own
  // field (root_cx.ts header).
  const tainted_by_errors: ErrorGuaranteed | undefined = undefined;
  const root_cx = BorrowCheckRootCtxt.new(tcx, root_def_id, BorrowckConsumer.new(options), tainted_by_errors);
  root_cx.do_mir_borrowck();
  return unwrap(root_cx.consumer).bodies;
}
