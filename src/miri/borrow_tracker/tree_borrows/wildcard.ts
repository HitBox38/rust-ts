// Port of src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into wildcard.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind, type BorTag, type GlobalState } from "../mod.ts";
import { type Node, Tree } from "./tree.ts";
import { type UniIndex, type UniValMap } from "./unimap.ts";
import { ExposedCache, type WildcardAccessLevel, type WildcardAccessRelatedness } from "./wildcard.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
export * from "./wildcard.gen.ts";

declare module "./wildcard.gen.ts" {
  interface ExposedCache {
    // borrow_tracker/tree_borrows/wildcard.rs:85
    access_relatedness(root: UniIndex, id: UniIndex, kind: AccessKind, is_wildcard_tree: boolean, only_foreign: boolean): WildcardAccessRelatedness | undefined;
    // borrow_tracker/tree_borrows/wildcard.rs:150
    update_exposure(nodes: UniValMap<Node>, id: UniIndex, from: WildcardAccessLevel, to: WildcardAccessLevel): void;
    // borrow_tracker/tree_borrows/wildcard.rs:186
    remove(idx: UniIndex): void;
  }
}
declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/wildcard.rs:195
    expose_tag(tag: BorTag, protected_: boolean): void;
    // borrow_tracker/tree_borrows/wildcard.rs:225
    update_exposure_for_protector_release(tag: BorTag): void;
    // borrow_tracker/tree_borrows/wildcard.rs:251
    verify_wildcard_consistency(global: GlobalState): void;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl WildcardAccessLevel (borrow_tracker/tree_borrows/wildcard.rs:22) [WildcardAccessLevel is not a generated class: companion fns / hand type, lane decides]: allows (:24)
// impl WildcardAccessRelatedness (borrow_tracker/tree_borrows/wildcard.rs:43) [WildcardAccessRelatedness is not a generated class: companion fns / hand type, lane decides]: to_relatedness (:44)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::wildcard::ExposedCache", "src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs", "miri-tb-a", () => ExposedCache.prototype, ["access_relatedness", "update_exposure", "remove"]);
stub_methods("miri::borrow_tracker::tree_borrows::wildcard::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs", "miri-tb-a", () => Tree.prototype, ["expose_tag", "update_exposure_for_protector_release", "verify_wildcard_consistency"]);
