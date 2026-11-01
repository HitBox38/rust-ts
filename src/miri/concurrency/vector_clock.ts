// Port of src/tools/miri/src/concurrency/vector_clock.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-race` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into vector_clock.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type NaReadType } from "./data_race.ts";
import { VClock, VTimestamp, VectorIdx } from "./vector_clock.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
export * from "./vector_clock.gen.ts";

// ---- manual impls the generated modules call (stand-ins until the fill lane ports them) ----
/** `impl Clone for VClock` (src/tools/miri/src/concurrency/vector_clock.rs:240): lane miri-race. */
export function clone_VClock(_v: VClock): never {
  return unported("miri::concurrency::vector_clock::VClock: Clone (src/tools/miri/src/concurrency/vector_clock.rs:240; lane miri-race)");
}
/** `impl Debug for VTimestamp` (src/tools/miri/src/concurrency/vector_clock.rs:59): lane miri-race. */
export const debug_VTimestamp: Debug<VTimestamp> = (_v, _f) => unported("miri::concurrency::vector_clock::VTimestamp: Debug (src/tools/miri/src/concurrency/vector_clock.rs:59; lane miri-race)");

declare module "./vector_clock.gen.ts" {
  interface VectorIdx {
    // concurrency/vector_clock.rs:20
    to_u32(): number;
  }
}
declare module "./vector_clock.gen.ts" {
  interface VTimestamp {
    // concurrency/vector_clock.rs:88
    time(): number;
    // concurrency/vector_clock.rs:93
    set_time(time: number): void;
    // concurrency/vector_clock.rs:98
    read_type(): NaReadType;
    // concurrency/vector_clock.rs:103
    set_read_type(read_type: NaReadType): void;
  }
  namespace VTimestamp {
    // concurrency/vector_clock.rs:73
    export let encode_time_and_read_type: (time: number, read_type: NaReadType) => number;
    // concurrency/vector_clock.rs:83
    function new_(time: number, read_type: NaReadType, span: Span): VTimestamp;
    export { new_ as new };
  }
}
declare module "./vector_clock.gen.ts" {
  interface VClock {
    // concurrency/vector_clock.rs:159
    as_slice(): readonly VTimestamp[];
    // concurrency/vector_clock.rs:165
    index_mut(index: VectorIdx): VTimestamp;
    // concurrency/vector_clock.rs:173
    get_mut_with_min_len(min_len: number): VTimestamp[];
    // concurrency/vector_clock.rs:184
    increment_index(idx: VectorIdx, current_span: Span): void;
    // concurrency/vector_clock.rs:197
    join(other: VClock): void;
    // concurrency/vector_clock.rs:209
    set_at_index(other: VClock, idx: VectorIdx): void;
    // concurrency/vector_clock.rs:235
    set_zero_vector(): void;
  }
  namespace VClock {
    // concurrency/vector_clock.rs:147
    export let new_with_index: (index: VectorIdx, timestamp: VTimestamp) => VClock;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Idx for VectorIdx (concurrency/vector_clock.rs:25): new (:27), index (:32)
// impl From<u32> for VectorIdx (concurrency/vector_clock.rs:37): from (:39)
// impl Debug for VTimestamp (concurrency/vector_clock.rs:59): fmt (:60)
// impl PartialEq for VTimestamp (concurrency/vector_clock.rs:108): eq (:109)
// impl Eq for VTimestamp (concurrency/vector_clock.rs:114)
// impl PartialOrd for VTimestamp (concurrency/vector_clock.rs:116): partial_cmp (:117)
// impl Ord for VTimestamp (concurrency/vector_clock.rs:122): cmp (:123)
// impl Clone for VClock (concurrency/vector_clock.rs:240): clone (:241), clone_from (:249)
// impl PartialOrd for VClock (concurrency/vector_clock.rs:256): partial_cmp (:257), lt (:315), le (:347), gt (:369), ge (:401)
// impl Index<VectorIdx> for VClock (concurrency/vector_clock.rs:424): index (:428)
// #[cfg(test)] mod tests (concurrency/vector_clock.rs:437): unit tests (port into a `.test.ts` next to this file)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::vector_clock::VectorIdx", "src/tools/miri/src/concurrency/vector_clock.rs", "miri-race", () => VectorIdx.prototype, ["to_u32"]);
stub_methods("miri::concurrency::vector_clock::VTimestamp", "src/tools/miri/src/concurrency/vector_clock.rs", "miri-race", () => VTimestamp.prototype, ["time", "set_time", "read_type", "set_read_type"]);
stub_statics("miri::concurrency::vector_clock::VTimestamp", "src/tools/miri/src/concurrency/vector_clock.rs", "miri-race", () => VTimestamp, ["encode_time_and_read_type", "new"]);
stub_methods("miri::concurrency::vector_clock::VClock", "src/tools/miri/src/concurrency/vector_clock.rs", "miri-race", () => VClock.prototype, ["as_slice", "index_mut", "get_mut_with_min_len", "increment_index", "join", "set_at_index", "set_zero_vector"]);
stub_statics("miri::concurrency::vector_clock::VClock", "src/tools/miri/src/concurrency/vector_clock.rs", "miri-race", () => VClock, ["new_with_index"]);
