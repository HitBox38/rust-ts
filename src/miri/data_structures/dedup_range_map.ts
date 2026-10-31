// Port of src/tools/miri/src/data_structures/dedup_range_map.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into dedup_range_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
// PORT (decision miri-contract C5 amendment, lane interp-miri-reconcile): `Elem.range: ops::Range<u64>` is
// `{ start: number; end: number }` (typemap `fields`): the ranges are byte offsets into one allocation, whose size is a
// `Size` (a number), and every Stacked Borrows / data-race / weak-memory range lookup goes through them.
import { DedupRangeMap } from "./dedup_range_map.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./dedup_range_map.gen.ts";

declare module "./dedup_range_map.gen.ts" {
  interface DedupRangeMap<T> {
    // data_structures/dedup_range_map.rs:34
    size(): Size;
    // data_structures/dedup_range_map.rs:40
    find_offset(offset: bigint): number;
    // data_structures/dedup_range_map.rs:65
    iter(offset: Size, len: Size): Iterable<[Pending<"ops::Range<u64>">, T]>;
    // data_structures/dedup_range_map.rs:90
    iter_mut_all(): Iterable<[Pending<"ops::Range<u64>">, T]>;
    // data_structures/dedup_range_map.rs:98
    iter_all(): Iterable<[Pending<"ops::Range<u64>">, T]>;
    // data_structures/dedup_range_map.rs:105
    split_index(index: number, split_offset: bigint): boolean;
    // data_structures/dedup_range_map.rs:137
    iter_mut(offset: Size, len: Size): Iterable<[Pending<"ops::Range<u64>">, T]>;
    // data_structures/dedup_range_map.rs:226
    merge_adjacent_thorough(): void;
  }
  namespace DedupRangeMap {
    // data_structures/dedup_range_map.rs:28
    function new_<T>(size: Size, init: T): DedupRangeMap<T>;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// #[cfg(test)] mod tests (data_structures/dedup_range_map.rs:245): unit tests (port into a `.test.ts` next to this file)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::data_structures::dedup_range_map::DedupRangeMap", "src/tools/miri/src/data_structures/dedup_range_map.rs", "miri-driver", () => DedupRangeMap.prototype, ["size", "find_offset", "iter", "iter_mut_all", "iter_all", "split_index", "iter_mut", "merge_adjacent_thorough"]);
stub_statics("miri::data_structures::dedup_range_map::DedupRangeMap", "src/tools/miri/src/data_structures/dedup_range_map.rs", "miri-driver", () => DedupRangeMap, ["new"]);
