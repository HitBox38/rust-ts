// Port of src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a`
// (plan-m6 wave 38). Its types are generated into tree_visitor.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: the `where NodeContinue: Fn(..), NodeApp: FnMut(..)` bounds of `impl TreeVisitorStack` are the `this` type of its
// methods (the generated class has unconstrained parameters). `Result<(), Err>` is `Result<null, Err>`.
// PORT: `NodeAppArgs.nodes` / `.data` are the `&mut` references themselves (the objects of the `TreeVisitor`).
import { type AccessRelatedness } from "./tree.ts";
import { type ChildrenVisitMode, type ContinueTraversal, type NodeAppArgs, type RecursionState, TreeVisitor, TreeVisitorStack } from "./tree_visitor.gen.ts";
import { type UniIndex, UniIndex_eq } from "./unimap.ts";
import { assert, unwrap } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
export * from "./tree_visitor.gen.ts";

/** `NodeContinue: Fn(&NodeAppArgs<'_, T>) -> ContinueTraversal` */
type FContinue<T> = (args: NodeAppArgs<T>) => ContinueTraversal;
/** `NodeApp: FnMut(NodeAppArgs<'_, T>) -> Result<(), Err>` */
type FPropagate<T, Err> = (args: NodeAppArgs<T>) => Result<null, Err>;

declare module "./tree_visitor.gen.ts" {
  interface TreeVisitorStack<NodeContinue, NodeApp, T> {
    // borrow_tracker/tree_borrows/tree_visitor.rs:69
    should_continue_at<Err>(this: TreeVisitorStack<FContinue<T>, FPropagate<T, Err>, T>, this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): ContinueTraversal;
    // borrow_tracker/tree_borrows/tree_visitor.rs:79
    propagate_at<Err>(this: TreeVisitorStack<FContinue<T>, FPropagate<T, Err>, T>, this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): Result<null, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:89
    go_upwards_from_accessed<Err>(this: TreeVisitorStack<FContinue<T>, FPropagate<T, Err>, T>, this_: TreeVisitor<T>, accessed_node: UniIndex, visit_children: ChildrenVisitMode): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:142
    finish_foreign_accesses<Err>(this: TreeVisitorStack<FContinue<T>, FPropagate<T, Err>, T>, this_: TreeVisitor<T>): Result<null, Err>;
  }
  namespace TreeVisitorStack {
    // borrow_tracker/tree_borrows/tree_visitor.rs:178
    function new_<NodeContinue, NodeApp, T>(f_continue: NodeContinue, f_propagate: NodeApp): TreeVisitorStack<NodeContinue, NodeApp, T>;
    export { new_ as new };
  }
}
declare module "./tree_visitor.gen.ts" {
  interface TreeVisitor<T> {
    // borrow_tracker/tree_borrows/tree_visitor.rs:222
    traverse_this_parents_children_other<Err>(start_idx: UniIndex, f_continue: FContinue<T>, f_propagate: FPropagate<T, Err>): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:248
    traverse_nonchildren<Err>(start_idx: UniIndex, f_continue: FContinue<T>, f_propagate: FPropagate<T, Err>): Result<UniIndex, Err>;
    // borrow_tracker/tree_borrows/tree_visitor.rs:274
    traverse_children_this<Err>(start_idx: UniIndex, f_continue: FContinue<T>, f_propagate: FPropagate<T, Err>): Result<null, Err>;
  }
}

/** The receiver of `impl<NodeContinue, NodeApp, T, Err> TreeVisitorStack<NodeContinue, NodeApp, T> where ..` */
type Stack<T, Err> = TreeVisitorStack<FContinue<T>, FPropagate<T, Err>, T>;

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:69 should_continue_at
TreeVisitorStack.prototype.should_continue_at = function <T, Err>(this: Stack<T, Err>, this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): ContinueTraversal {
  const args: NodeAppArgs<T> = { idx, rel_pos, nodes: this_.nodes, data: this_.data };
  return this.f_continue(args);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:79 propagate_at
TreeVisitorStack.prototype.propagate_at = function <T, Err>(this: Stack<T, Err>, this_: TreeVisitor<T>, idx: UniIndex, rel_pos: AccessRelatedness): Result<null, Err> {
  return this.f_propagate({ idx, rel_pos, nodes: this_.nodes, data: this_.data });
};

/// Returns the root of this tree.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:89 go_upwards_from_accessed
TreeVisitorStack.prototype.go_upwards_from_accessed = function <T, Err>(
  this: Stack<T, Err>,
  this_: TreeVisitor<T>,
  accessed_node: UniIndex,
  visit_children: ChildrenVisitMode,
): Result<UniIndex, Err> {
  // We want to visit the accessed node's children first.
  // However, we will below walk up our parents and push their children (our cousins)
  // onto the stack. To ensure correct iteration order, this method thus finishes
  // by reversing the stack. This only works if the stack is empty initially.
  assert(this.stack.length === 0, "assertion failed: self.stack.is_empty()");
  // First, handle accessed node. A bunch of things need to
  // be handled differently here compared to the further parents
  // of `accessesed_node`.
  {
    const r = this.propagate_at(this_, accessed_node, "LocalAccess");
    if (r.$ === "Err") return r;
    if (visit_children === "VisitChildrenOfAccessed") {
      const accessed_node_ = unwrap(this_.nodes.get(accessed_node));
      // We `rev()` here because we reverse the entire stack later.
      for (let i = accessed_node_.children.length - 1; i >= 0; i--) {
        const child = accessed_node_.children[i]!;
        this.stack.push([child, "ForeignAccess", "BeforeChildren"]);
      }
    }
  }
  // Then, handle the accessed node's parents. Here, we need to
  // make sure we only mark the "cousin" subtrees for later visitation,
  // not the subtree that contains the accessed node.
  let last_node = accessed_node;
  for (;;) {
    const current = unwrap(this_.nodes.get(last_node)).parent;
    if (current === undefined) break;
    const r = this.propagate_at(this_, current, "LocalAccess");
    if (r.$ === "Err") return r;
    const node = unwrap(this_.nodes.get(current));
    // We `rev()` here because we reverse the entire stack later.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]!;
      if (UniIndex_eq(last_node, child)) {
        continue;
      }
      this.stack.push([child, "ForeignAccess", "BeforeChildren"]);
    }
    last_node = current;
  }
  // Reverse the stack, as discussed above.
  this.stack.reverse();
  return Ok(last_node);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:142 finish_foreign_accesses
TreeVisitorStack.prototype.finish_foreign_accesses = function <T, Err>(this: Stack<T, Err>, this_: TreeVisitor<T>): Result<null, Err> {
  for (;;) {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) break;
    const idx = top[0];
    const rel_pos = top[1];
    const step: RecursionState = top[2];
    switch (step) {
      // How to do bottom-up traversal, 101: Before you handle a node, you handle all children.
      // For this, you must first find the children, which is what this code here does.
      case "BeforeChildren": {
        // Next time we come back will be when all the children are handled.
        top[2] = "AfterChildren";
        // Now push the children, except if we are told to skip this subtree.
        const handle_children = this.should_continue_at(this_, idx, rel_pos);
        switch (handle_children) {
          case "Recurse": {
            const node = unwrap(this_.nodes.get(idx));
            for (const child of node.children) {
              this.stack.push([child, rel_pos, "BeforeChildren"]);
            }
            break;
          }
          case "SkipSelfAndChildren": {
            // skip self
            this.stack.pop();
            continue;
          }
        }
        break;
      }
      // All the children are handled, let's actually visit this node
      case "AfterChildren": {
        this.stack.pop();
        const r = this.propagate_at(this_, idx, rel_pos);
        if (r.$ === "Err") return r;
        break;
      }
    }
  }
  return Ok(null);
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:178 new
TreeVisitorStack.new = function <NodeContinue, NodeApp, T>(f_continue: NodeContinue, f_propagate: NodeApp): TreeVisitorStack<NodeContinue, NodeApp, T> {
  return new TreeVisitorStack(f_continue, f_propagate, [], undefined);
};

// impl<'tree, T> TreeVisitor<'tree, T>
/// Applies `f_propagate` to every vertex of the tree in a piecewise bottom-up way: First, visit
/// all ancestors of `start_idx` (starting with `start_idx` itself), then children of `start_idx`, then the rest,
/// going bottom-up in each of these two "pieces" / sections.
/// This ensures that errors are triggered in the following order
/// - first invalid accesses with insufficient permissions, closest to the accessed node first,
/// - then protector violations, bottom-up, starting with the children of the accessed node, and then
///   going upwards and outwards.
///
/// The following graphic visualizes it, with numbers indicating visitation order and `start_idx` being
/// the node that is visited first ("1"):
///
/// ```text
///         3
///        /|
///       / |
///      9  2
///      |  |\
///      |  | \
///      8  1  7
///        / \
///       4   6
///           |
///           5
/// ```
///
/// `f_propagate` should follow the following format: for a given `Node` it updates its
/// `Permission` depending on the position relative to `start_idx` (given by an
/// `AccessRelatedness`).
/// `f_continue` is called earlier on foreign nodes, and describes whether to even start
/// visiting the subtree at that node. If it e.g. returns `SkipSelfAndChildren` on node 6
/// above, then nodes 5 _and_ 6 would not be visited by `f_propagate`. It is not used for
/// notes having a child access (nodes 1, 2, 3).
///
/// Finally, remember that the iteration order is not relevant for UB, it only affects
/// diagnostics. It also affects tree traversal optimizations built on top of this, so
/// those need to be reviewed carefully as well whenever this changes.
///
/// Returns the index of the root of the accessed tree.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:222 traverse_this_parents_children_other
TreeVisitor.prototype.traverse_this_parents_children_other = function <T, Err>(
  this: TreeVisitor<T>,
  start_idx: UniIndex,
  f_continue: FContinue<T>,
  f_propagate: FPropagate<T, Err>,
): Result<UniIndex, Err> {
  const stack = TreeVisitorStack.new<FContinue<T>, FPropagate<T, Err>, T>(f_continue, f_propagate);
  // Visits the accessed node itself, and all its parents, i.e. all nodes
  // undergoing a child access. Also pushes the children and the other
  // cousin nodes (i.e. all nodes undergoing a foreign access) to the stack
  // to be processed later.
  const r = stack.go_upwards_from_accessed(this, start_idx, "VisitChildrenOfAccessed");
  if (r.$ === "Err") return r;
  const root = r._0;
  // Now visit all the foreign nodes we remembered earlier.
  // For this we go bottom-up, but also allow f_continue to skip entire
  // subtrees from being visited if it would be a NOP.
  const f = stack.finish_foreign_accesses(this);
  if (f.$ === "Err") return f;
  return Ok(root);
};

/// Like `traverse_this_parents_children_other`, but skips the children of `start_idx`.
///
/// Returns the index of the root of the accessed tree.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:248 traverse_nonchildren
TreeVisitor.prototype.traverse_nonchildren = function <T, Err>(
  this: TreeVisitor<T>,
  start_idx: UniIndex,
  f_continue: FContinue<T>,
  f_propagate: FPropagate<T, Err>,
): Result<UniIndex, Err> {
  const stack = TreeVisitorStack.new<FContinue<T>, FPropagate<T, Err>, T>(f_continue, f_propagate);
  // Visits the accessed node itself, and all its parents, i.e. all nodes
  // undergoing a child access. Also pushes the other cousin nodes to the
  // stack, but not the children of the accessed node.
  const r = stack.go_upwards_from_accessed(this, start_idx, "SkipChildrenOfAccessed");
  if (r.$ === "Err") return r;
  const root = r._0;
  // Now visit all the foreign nodes we remembered earlier.
  // For this we go bottom-up, but also allow f_continue to skip entire
  // subtrees from being visited if it would be a NOP.
  const f = stack.finish_foreign_accesses(this);
  if (f.$ === "Err") return f;
  return Ok(root);
};

/// Traverses all children of `start_idx` including `start_idx` itself.
/// Uses `f_continue` to filter out subtrees and then processes each node
/// with `f_propagate` so that the children get processed before their
/// parents.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/tree_visitor.rs:274 traverse_children_this
TreeVisitor.prototype.traverse_children_this = function <T, Err>(
  this: TreeVisitor<T>,
  start_idx: UniIndex,
  f_continue: FContinue<T>,
  f_propagate: FPropagate<T, Err>,
): Result<null, Err> {
  const stack = TreeVisitorStack.new<FContinue<T>, FPropagate<T, Err>, T>(f_continue, f_propagate);

  stack.stack.push([start_idx, "ForeignAccess", "BeforeChildren"]);
  return stack.finish_foreign_accesses(this);
};
