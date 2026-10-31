// Port of src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into unimap.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { UniEntry, type UniIndex, UniKeyMap, UniValMap } from "./unimap.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { type Debug } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
export * from "./unimap.gen.ts";

// ---- manual impls the generated modules call (stand-ins until the fill lane ports them) ----
/** `impl Debug for UniIndex` (src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:28): lane miri-tb-a. */
export const debug_UniIndex: Debug<UniIndex> = (_v, _f) => unported("miri::borrow_tracker::tree_borrows::unimap::UniIndex: Debug (src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs:28; lane miri-tb-a)");

declare module "./unimap.gen.ts" {
  interface UniValMap<V> {
    // borrow_tracker/tree_borrows/unimap.rs:59
    identical(other: UniValMap<V>): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:65
    equivalent(other: UniValMap<V>): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:168
    contains_idx(idx: UniIndex): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:173
    extend_to_length(len: number): void;
    // borrow_tracker/tree_borrows/unimap.rs:184
    insert(idx: UniIndex, val: V): void;
    // borrow_tracker/tree_borrows/unimap.rs:190
    get(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:195
    get_mut(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:202
    remove(idx: UniIndex): V | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:212
    is_empty(): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:217
    iter(): Iterable<[UniIndex, V]>;
    // borrow_tracker/tree_borrows/unimap.rs:232
    entry(idx: UniIndex): UniEntry<V>;
  }
}
declare module "./unimap.gen.ts" {
  interface UniKeyMap<K> {
    // borrow_tracker/tree_borrows/unimap.rs:95
    len(): number;
    // borrow_tracker/tree_borrows/unimap.rs:100
    contains_key(key: K): boolean;
    // borrow_tracker/tree_borrows/unimap.rs:108
    insert(key: K): UniIndex;
    // borrow_tracker/tree_borrows/unimap.rs:125
    get(key: K): UniIndex | undefined;
    // borrow_tracker/tree_borrows/unimap.rs:131
    get_or_insert(key: K): UniIndex;
    // borrow_tracker/tree_borrows/unimap.rs:159
    remove(key: K): void;
  }
}
declare module "./unimap.gen.ts" {
  interface UniEntry<V> {
    // borrow_tracker/tree_borrows/unimap.rs:240
    or_insert(default_: V): V;
    // borrow_tracker/tree_borrows/unimap.rs:247
    get(): V | undefined;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Debug for UniIndex (borrow_tracker/tree_borrows/unimap.rs:28): fmt (:29)
// impl PartialEq for UniValMap<V> (borrow_tracker/tree_borrows/unimap.rs:73): eq (:79)
// impl Default for UniValMap<V> (borrow_tracker/tree_borrows/unimap.rs:84): default (:85)
// #[cfg(test)] mod tests (borrow_tracker/tree_borrows/unimap.rs:252): unit tests (port into a `.test.ts` next to this file)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::unimap::UniValMap", "src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs", "miri-tb-a", () => UniValMap.prototype, ["identical", "equivalent", "contains_idx", "extend_to_length", "insert", "get", "get_mut", "remove", "is_empty", "iter", "entry"]);
stub_methods("miri::borrow_tracker::tree_borrows::unimap::UniKeyMap", "src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs", "miri-tb-a", () => UniKeyMap.prototype, ["len", "contains_key", "insert", "get", "get_or_insert", "remove"]);
stub_methods("miri::borrow_tracker::tree_borrows::unimap::UniEntry", "src/tools/miri/src/borrow_tracker/tree_borrows/unimap.rs", "miri-tb-a", () => UniEntry.prototype, ["or_insert", "get"]);
