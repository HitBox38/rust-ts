// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-sb` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into stack.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind, type BorTag } from "../mod.ts";
import { type Item } from "./item.ts";
import { Stack, StackCache } from "./stack.gen.ts";
import { type ProvenanceExtra } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Result } from "../../../std/result.ts";
export * from "./stack.gen.ts";

declare module "./stack.gen.ts" {
  interface Stack {
    // borrow_tracker/stacked_borrows/stack.rs:45
    retain(tags: Set<BorTag>): void;
    // borrow_tracker/stacked_borrows/stack.rs:157
    verify_cache_consistency(): void;
    // borrow_tracker/stacked_borrows/stack.rs:194
    find_granting(access: AccessKind, tag: ProvenanceExtra, exposed_tags: Set<BorTag>): Result<number | undefined, null>;
    // borrow_tracker/stacked_borrows/stack.rs:237
    find_granting_tagged(access: AccessKind, tag: BorTag): number | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:256
    find_granting_cache(access: AccessKind, tag: BorTag): number | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:295
    insert(new_idx: number, new_: Item): void;
    // borrow_tracker/stacked_borrows/stack.rs:303
    insert_cache(new_idx: number, new_: Item): void;
    // borrow_tracker/stacked_borrows/stack.rs:353
    get(idx: number): Item | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:358
    len(): number;
    // borrow_tracker/stacked_borrows/stack.rs:362 // PORT: `unknown_bottom_` (a field `unknown_bottom` exists; mir-contract rule)
    unknown_bottom_(): BorTag | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:366
    set_unknown_bottom(tag: BorTag): void;
    // borrow_tracker/stacked_borrows/stack.rs:380
    disable_uniques_starting_at(disable_start: number, visitor: ((_0: Item) => InterpResult)): InterpResult;
    // borrow_tracker/stacked_borrows/stack.rs:428
    pop_items_after<V>(start: number, visitor: V): InterpResult;
  }
  namespace Stack {
    // borrow_tracker/stacked_borrows/stack.rs:342
    function new_(item: Item): Stack;
    export { new_ as new };
  }
}
declare module "./stack.gen.ts" {
  interface StackCache {
    // borrow_tracker/stacked_borrows/stack.rs:127
    add(idx: number, item: Item): void;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl PartialEq for Stack (borrow_tracker/stacked_borrows/stack.rs:135): eq (:136)
// impl Eq for Stack (borrow_tracker/stacked_borrows/stack.rs:150)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::stacked_borrows::stack::Stack", "src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs", "miri-sb", () => Stack.prototype, ["retain", "verify_cache_consistency", "find_granting", "find_granting_tagged", "find_granting_cache", "insert", "insert_cache", "get", "len", "unknown_bottom_", "set_unknown_bottom", "disable_uniques_starting_at", "pop_items_after"]);
stub_statics("miri::borrow_tracker::stacked_borrows::stack::Stack", "src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs", "miri-sb", () => Stack, ["new"]);
stub_methods("miri::borrow_tracker::stacked_borrows::stack::StackCache", "src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs", "miri-sb", () => StackCache.prototype, ["add"]);
