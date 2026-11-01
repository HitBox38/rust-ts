// Port of src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-tb-a` (plan-m6 wave 38). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into tree_visitor.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type AccessRelatedness } from "./tree.ts";
import { type ChildrenVisitMode, type ContinueTraversal, type NodeAppArgs, TreeVisitor, TreeVisitorStack } from "./tree_visitor.gen.ts";
import { type UniIndex } from "./unimap.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { type Result } from "../../../std/result.ts";
export * from "./tree_visitor.gen.ts";

declare module "./tree_visitor.gen.ts" {
  interface TreeVisitorStack<NodeContinue, NodeApp, T> {
    // borrow_tracker/tree_borrows/tree_visitor.rs:69
    should_continue_at<Err>(this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): ContinueTraversal;
    // borrow_tracker/tree_borrows/tree_visitor.rs:79
    propagate_at<Err>(this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): Result<null, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:89
    go_upwards_from_accessed<Err>(this_: TreeVisitor<T>, accessed_node: UniIndex, visit_children: ChildrenVisitMode): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:142
    finish_foreign_accesses<Err>(this_: TreeVisitor<T>): Result<null, Err>;
  }
  namespace TreeVisitorStack {
    // borrow_tracker/tree_borrows/tree_visitor.rs:178
    function new_<NodeContinue, NodeApp, T, Err>(f_continue: NodeContinue, f_propagate: NodeApp): TreeVisitorStack<NodeContinue, NodeApp, T>;
    export { new_ as new };
  }
}
declare module "./tree_visitor.gen.ts" {
  interface TreeVisitor<T> {
    // borrow_tracker/tree_borrows/tree_visitor.rs:222
    traverse_this_parents_children_other<Err>(start_idx: UniIndex, f_continue: ((_0: NodeAppArgs<T>) => ContinueTraversal), f_propagate: ((_0: NodeAppArgs<T>) => Result<null, Err>)): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:248
    traverse_nonchildren<Err>(start_idx: UniIndex, f_continue: ((_0: NodeAppArgs<T>) => ContinueTraversal), f_propagate: ((_0: NodeAppArgs<T>) => Result<null, Err>)): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:274
    traverse_children_this<Err>(start_idx: UniIndex, f_continue: ((_0: NodeAppArgs<T>) => ContinueTraversal), f_propagate: ((_0: NodeAppArgs<T>) => Result<null, Err>)): Result<null, Err>;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::borrow_tracker::tree_borrows::tree_visitor::TreeVisitorStack", "src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs", "miri-tb-a", () => TreeVisitorStack.prototype, ["should_continue_at", "propagate_at", "go_upwards_from_accessed", "finish_foreign_accesses"]);
stub_statics("miri::borrow_tracker::tree_borrows::tree_visitor::TreeVisitorStack", "src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs", "miri-tb-a", () => TreeVisitorStack, ["new"]);
stub_methods("miri::borrow_tracker::tree_borrows::tree_visitor::TreeVisitor", "src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs", "miri-tb-a", () => TreeVisitor.prototype, ["traverse_this_parents_children_other", "traverse_nonchildren", "traverse_children_this"]);
