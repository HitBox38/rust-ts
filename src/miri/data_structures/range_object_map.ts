// Port of src/tools/miri/src/data_structures/range_object_map.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into range_object_map.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessType, type Position, RangeObjectMap } from "./range_object_map.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { type Size } from "../../rustc_abi/lib.ts";
import { type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type Result } from "../../std/result.ts";
export * from "./range_object_map.gen.ts";

declare module "./range_object_map.gen.ts" {
  interface RangeObjectMap<T> {
    // data_structures/range_object_map.rs:44
    find_offset(offset: Size): Result<Position, Position>;
    // data_structures/range_object_map.rs:62
    access_type(range: AllocRange): AccessType;
    // data_structures/range_object_map.rs:105
    insert_at_pos(pos: Position, range: AllocRange, data: T): void;
    // data_structures/range_object_map.rs:117
    remove_pos_range(pos_range: Pending<"Range<Position>">): void;
    // data_structures/range_object_map.rs:121
    remove_from_pos(pos: Position): void;
    // data_structures/range_object_map.rs:125
    iter(): Iterable<T>;
  }
  namespace RangeObjectMap {
    // data_structures/range_object_map.rs:37
    function new_<T>(): RangeObjectMap<T>;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Index<Position> for RangeObjectMap<T> (data_structures/range_object_map.rs:130): index (:133)
// impl IndexMut<Position> for RangeObjectMap<T> (data_structures/range_object_map.rs:138): index_mut (:139)
// #[cfg(test)] mod tests (data_structures/range_object_map.rs:145): unit tests (port into a `.test.ts` next to this file)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::data_structures::range_object_map::RangeObjectMap", "src/tools/miri/src/data_structures/range_object_map.rs", "miri-driver", () => RangeObjectMap.prototype, ["find_offset", "access_type", "insert_at_pos", "remove_pos_range", "remove_from_pos", "iter"]);
stub_statics("miri::data_structures::range_object_map::RangeObjectMap", "src/tools/miri/src/data_structures/range_object_map.rs", "miri-driver", () => RangeObjectMap, ["new"]);
