// Port of src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-b` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into tree.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessKind, type BorTag, type GlobalState } from "../mod.ts";
import { type AccessCause, type DiagnosticInfo, type TransitionError } from "./diagnostics.ts";
import { type IdempotentForeignAccess } from "./foreign_access_skipping.ts";
import { type PermTransition } from "./perms.ts";
import { type AccessRelatedness, LocationState, LocationTree, Node, Tree } from "./tree.gen.ts";
import { type ChildrenVisitMode, type ContinueTraversal } from "./tree_visitor.ts";
import { type UniIndex, type UniValMap } from "./unimap.ts";
import { type ExposedCache } from "./wildcard.ts";
import { type DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { type ProvenanceExtra } from "../../machine.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Size } from "../../../rustc_abi/lib.ts";
import { type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { type Result } from "../../../std/result.ts";
export * from "./tree.gen.ts";

declare module "./tree.gen.ts" {
  interface LocationState {
    // borrow_tracker/tree_borrows/tree.rs:78
    possible(): boolean;
    // borrow_tracker/tree_borrows/tree.rs:85 // PORT: `accessed_` (a field `accessed` exists; mir-contract rule)
    accessed_(): boolean;
    // borrow_tracker/tree_borrows/tree.rs:89 // PORT: `permission_` (a field `permission` exists; mir-contract rule)
    permission_(): Pending<"Permission">;
    // borrow_tracker/tree_borrows/tree.rs:95
    perform_transition(idx: UniIndex, nodes: UniValMap<Node>, exposed_cache: ExposedCache, access_kind: AccessKind, relatedness: AccessRelatedness, protected_: boolean, diagnostics: DiagnosticInfo): Result<null, TransitionError>;
    // borrow_tracker/tree_borrows/tree.rs:132
    perform_access(access_kind: AccessKind, rel_pos: AccessRelatedness, protected_: boolean): Result<PermTransition, TransitionError>;
    // borrow_tracker/tree_borrows/tree.rs:168
    perform_access_no_fluff(access_kind: AccessKind, rel_pos: AccessRelatedness, protected_: boolean): LocationState | undefined;
    // borrow_tracker/tree_borrows/tree.rs:182
    skip_if_known_noop(access_kind: AccessKind, rel_pos: AccessRelatedness): ContinueTraversal;
    // borrow_tracker/tree_borrows/tree.rs:240
    record_new_access(access_kind: AccessKind, rel_pos: AccessRelatedness): void;
  }
  namespace LocationState {
    // borrow_tracker/tree_borrows/tree.rs:64
    export let new_non_accessed: (permission: Pending<"Permission">, sifa: IdempotentForeignAccess) => LocationState;
    // borrow_tracker/tree_borrows/tree.rs:73
    export let new_accessed: (permission: Pending<"Permission">, sifa: IdempotentForeignAccess) => LocationState;
  }
}
declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/tree.rs:391
    new_child(base_offset: Size, parent_prov: ProvenanceExtra, new_tag: BorTag, inside_perms: DedupRangeMap<LocationState>, outside_perm: Pending<"Permission">, protected_: boolean, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:477
    update_idempotent_foreign_access_after_retag(current: UniIndex, strongest_allowed: IdempotentForeignAccess): void;
    // borrow_tracker/tree_borrows/tree.rs:522
    dealloc(prov: ProvenanceExtra, access_range: AllocRange, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:623
    perform_access(prov: ProvenanceExtra, access_range: AllocRange, access_kind: AccessKind, access_cause: AccessCause, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:671
    perform_protector_end_access(tag: BorTag, global: GlobalState, alloc_id: AllocId, span: Span): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:732
    remove_unreachable_tags(live_tags: Set<BorTag>): void;
    // borrow_tracker/tree_borrows/tree.rs:745
    is_useless(idx: UniIndex, live: Set<BorTag>): boolean;
    // borrow_tracker/tree_borrows/tree.rs:753
    can_be_replaced_by_single_child(idx: UniIndex, live: Set<BorTag>): UniIndex | undefined;
    // borrow_tracker/tree_borrows/tree.rs:796
    remove_useless_node(this_: UniIndex): void;
    // borrow_tracker/tree_borrows/tree.rs:823
    remove_useless_children(root: UniIndex, live: Set<BorTag>): void;
  }
  namespace Tree {
    // borrow_tracker/tree_borrows/tree.rs:338
    function new_(root_tag: BorTag, size: Size, span: Span): Tree;
    export { new_ as new };
  }
}
declare module "./tree.gen.ts" {
  interface LocationTree {
    // borrow_tracker/tree_borrows/tree.rs:913
    perform_access(roots: Iterable<UniIndex>, nodes: UniValMap<Node>, access_source: UniIndex | undefined, access_kind: AccessKind, global: GlobalState, visit_children: ChildrenVisitMode, diagnostics: DiagnosticInfo, min_exposed_child: BorTag | undefined): InterpResult;
    // borrow_tracker/tree_borrows/tree.rs:991
    perform_normal_access(access_source: UniIndex, nodes: UniValMap<Node>, access_kind: AccessKind, global: GlobalState, visit_children: ChildrenVisitMode, diagnostics: DiagnosticInfo): InterpResult<UniIndex>;
    // borrow_tracker/tree_borrows/tree.rs:1064
    perform_wildcard_access(root: UniIndex, access_source: UniIndex | undefined, max_local_tag: BorTag | undefined, nodes: UniValMap<Node>, access_kind: AccessKind, global: GlobalState, diagnostics: DiagnosticInfo, is_wildcard_tree: boolean): InterpResult;
  }
  namespace LocationTree {
    // borrow_tracker/tree_borrows/tree.rs:884
    export let get_min_exposed_child: (root: UniIndex, nodes: UniValMap<Node>) => BorTag | undefined;
  }
}
declare module "./tree.gen.ts" {
  interface Node {
    // borrow_tracker/tree_borrows/tree.rs:1192
    default_location_state(): LocationState;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl fmt::Display for LocationState (borrow_tracker/tree_borrows/tree.rs:250): fmt (:251)
// impl VisitProvenance for Tree (borrow_tracker/tree_borrows/tree.rs:1200): visit_provenance (:1201)
// impl AccessRelatedness (borrow_tracker/tree_borrows/tree.rs:1228) [AccessRelatedness is not a generated class: companion fns / hand type, lane decides]: is_foreign (:1231)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::tree::LocationState", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => LocationState.prototype, ["possible", "accessed_", "permission_", "perform_transition", "perform_access", "perform_access_no_fluff", "skip_if_known_noop", "record_new_access"]);
stub_statics("miri::borrow_tracker::tree_borrows::tree::LocationState", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => LocationState, ["new_non_accessed", "new_accessed"]);
stub_methods("miri::borrow_tracker::tree_borrows::tree::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => Tree.prototype, ["new_child", "update_idempotent_foreign_access_after_retag", "dealloc", "perform_access", "perform_protector_end_access", "remove_unreachable_tags", "is_useless", "can_be_replaced_by_single_child", "remove_useless_node", "remove_useless_children"]);
stub_statics("miri::borrow_tracker::tree_borrows::tree::Tree", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => Tree, ["new"]);
stub_methods("miri::borrow_tracker::tree_borrows::tree::LocationTree", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => LocationTree.prototype, ["perform_access", "perform_normal_access", "perform_wildcard_access"]);
stub_statics("miri::borrow_tracker::tree_borrows::tree::LocationTree", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => LocationTree, ["get_min_exposed_child"]);
stub_methods("miri::borrow_tracker::tree_borrows::tree::Node", "src/tools/miri/src/borrow_tracker/tree_borrows/tree.rs", "miri-tb-b", () => Node.prototype, ["default_location_state"]);
