// Port of src/tools/miri/src/clock.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-eval` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into clock.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Deadline, Instant, MonotonicClock, type TimeoutClock, type TimeoutStyle } from "./clock.gen.ts";
import { MiriMachine } from "./machine.ts";
import { stub_methods, stub_statics } from "../rust_ts/miri_stub.ts";
import { type Pending } from "../rustc_type_ir/decls.ts";
export * from "./clock.gen.ts";

declare module "./clock.gen.ts" {
  interface Instant {
    // clock.rs:27
    add_lossy(duration: Pending<"Duration">): Instant;
    // clock.rs:43
    duration_since(earlier: Instant): Pending<"Duration">;
  }
}
declare module "./clock.gen.ts" {
  interface MonotonicClock {
    // clock.rs:91
    tick(): void;
    // clock.rs:103
    sleep(duration: Pending<"Duration">): void;
    // clock.rs:118
    epoch(): Instant;
    // clock.rs:126
    now(): Instant;
  }
  namespace MonotonicClock {
    // clock.rs:80
    function new_(communicate: boolean): MonotonicClock;
    export { new_ as new };
  }
}
declare module "./machine.gen.ts" {
  interface MiriMachine {
    // clock.rs:186
    timeout(clock: TimeoutClock, style: TimeoutStyle, duration: Pending<"Duration">): Deadline;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl From<Instant> for Deadline (clock.rs:143): from (:144)
// impl Deadline (clock.rs:149) [Deadline is not a generated class: companion fns / hand type, lane decides]: add_lossy (:151)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::clock::Instant", "src/tools/miri/src/clock.rs", "miri-eval", () => Instant.prototype, ["add_lossy", "duration_since"]);
stub_methods("miri::clock::MonotonicClock", "src/tools/miri/src/clock.rs", "miri-eval", () => MonotonicClock.prototype, ["tick", "sleep", "epoch", "now"]);
stub_statics("miri::clock::MonotonicClock", "src/tools/miri/src/clock.rs", "miri-eval", () => MonotonicClock, ["new"]);
stub_methods("miri::clock::MiriMachine", "src/tools/miri/src/clock.rs", "miri-eval", () => MiriMachine.prototype, ["timeout"]);
