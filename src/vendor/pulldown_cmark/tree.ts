// Port of pulldown-cmark-0.11.3/src/tree.rs.
//
// PORT: `TreeIndex(NonZeroUsize)` is a branded `number` (≥ 1); `Add`/`Sub` are `TreeIndex.add/sub`.
// `Index`/`IndexMut<TreeIndex>` (`tree[ix]`) are `tree.at(ix)`, returning the (mutable) `Node`.
// `Node<T>` and `Item` are `Copy` upstream: code that keeps a copy across a mutation of the tree copies
// it explicitly (`clone_Item`, parse.ts).
// Init order: imports parse.ts for `ItemBody`/`Item` types only.
import type { Fmt } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import type { Item } from "./parse.ts";

export type TreeIndex = number & { readonly __brand: "TreeIndex" };

export const TreeIndex = {
  // crate: pulldown-cmark-0.11.3/src/tree.rs:18 new
  new(i: number): TreeIndex {
    // `NonZeroUsize::new(i).unwrap()`
    assert(i !== 0, "called `Option::unwrap()` on a `None` value");
    return i as TreeIndex;
  },

  // crate: pulldown-cmark-0.11.3/src/tree.rs:22 get
  get(self: TreeIndex): number {
    return self;
  },

  // crate: pulldown-cmark-0.11.3/src/tree.rs:30 add
  add(self: TreeIndex, rhs: number): TreeIndex {
    const inner = self + rhs;
    return TreeIndex.new(inner);
  },

  // crate: pulldown-cmark-0.11.3/src/tree.rs:39 sub
  sub(self: TreeIndex, rhs: number): TreeIndex {
    // `checked_sub(rhs).unwrap()`
    assert(self >= rhs, "called `Option::unwrap()` on a `None` value");
    const inner = self - rhs;
    return TreeIndex.new(inner);
  },
};

export interface Node<T> {
  child: TreeIndex | undefined;
  next: TreeIndex | undefined;
  item: T;
}

/// A tree abstraction, intended for fast building as a preorder traversal.
export class Tree<T> {
  constructor(
    public nodes: Node<T>[],
    public spine: TreeIndex[], // indices of nodes on path to current node
    public cur_: TreeIndex | undefined,
  ) {}

  // Indices start at one, so we place a dummy value at index zero.
  // The alternative would be subtracting one from every TreeIndex
  // every time we convert it to usize to index our nodes.
  // PORT: `T: Default` is the `T_default` argument.
  // crate: pulldown-cmark-0.11.3/src/tree.rs:64 with_capacity
  static with_capacity<T>(_cap: number, T_default: () => T): Tree<T> {
    const nodes: Node<T>[] = [];
    nodes.push({
      child: undefined,
      next: undefined,
      item: T_default(),
    });
    return new Tree(nodes, [], undefined);
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:79 cur
  /// Returns the index of the element currently in focus.
  cur(): TreeIndex | undefined {
    return this.cur_;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:84 append
  /// Append one item to the current position in the tree.
  append(item: T): TreeIndex {
    const ix = this.create_node(item);
    const this_ = ix;

    if (this.cur_ !== undefined) {
      this.at(this.cur_).next = this_;
    } else if (this.spine.length > 0) {
      const parent = this.spine[this.spine.length - 1]!;
      this.at(parent).child = this_;
    }
    this.cur_ = this_;
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:98 create_node
  /// Create an isolated node.
  create_node(item: T): TreeIndex {
    const this_ = this.nodes.length;
    this.nodes.push({
      child: undefined,
      next: undefined,
      item,
    });
    return TreeIndex.new(this_);
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:110 push
  /// Push down one level, so that new items become children of the current node.
  /// The new focus index is returned.
  push(): TreeIndex {
    const cur_ix = this.cur_!;
    assert(cur_ix !== undefined, "called `Option::unwrap()` on a `None` value");
    this.spine.push(cur_ix);
    this.cur_ = this.at(cur_ix).child;
    return cur_ix;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:118 pop
  /// Pop back up a level.
  pop(): TreeIndex | undefined {
    const ix = this.spine.pop();
    if (ix === undefined) return undefined;
    this.cur_ = ix;
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:125 remove_node
  /// Remove the last node, as `pop` but removing it.
  remove_node(): TreeIndex | undefined {
    const ix = this.spine.pop();
    if (ix === undefined) return undefined;
    this.cur_ = ix;
    if (this.nodes.length === 0) return undefined;
    this.nodes.pop();
    this.at(ix).child = undefined;
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:134 peek_up
  /// Look at the parent node.
  peek_up(): TreeIndex | undefined {
    return this.spine[this.spine.length - 1];
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:139 peek_grandparent
  /// Look at grandparent node.
  peek_grandparent(): TreeIndex | undefined {
    if (this.spine.length >= 2) {
      return this.spine[this.spine.length - 2];
    } else {
      return undefined;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:149 is_empty
  /// Returns true when there are no nodes other than the root node
  /// in the tree, false otherwise.
  is_empty(): boolean {
    return this.nodes.length <= 1;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:154 spine_len
  /// Returns the length of the spine.
  spine_len(): number {
    return this.spine.length;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:159 reset
  /// Resets the focus to the first node added to the tree, if it exists.
  reset(): void {
    this.cur_ = this.is_empty() ? undefined : TreeIndex.new(1);
    this.spine.length = 0;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:169 walk_spine
  /// Walks the spine from a root node up to, but not including, the current node.
  /// PORT: the iterator is the spine array itself (callers iterate it, or a reversed copy for `.rev()`).
  walk_spine(): readonly TreeIndex[] {
    return this.spine;
  }

  // crate: pulldown-cmark-0.11.3/src/tree.rs:174 next_sibling
  /// Moves focus to the next sibling of the given node.
  next_sibling(cur_ix: TreeIndex): TreeIndex | undefined {
    this.cur_ = this.at(cur_ix).next;
    return this.cur_;
  }

  /// `tree[ix]` (`Index` / `IndexMut<TreeIndex>`).
  // crate: pulldown-cmark-0.11.3/src/tree.rs:276 index
  // crate: pulldown-cmark-0.11.3/src/tree.rs:282 index_mut
  at(ix: TreeIndex): Node<T> {
    const n = this.nodes[TreeIndex.get(ix)];
    if (n === undefined) throw new RangeError(`index out of bounds: the len is ${this.nodes.length} but the index is ${ix}`);
    return n;
  }
}

declare module "./tree.ts" {
  interface Tree<T> {
    truncate_siblings(this: Tree<Item>, end_byte_ix: number): void;
  }
}

// crate: pulldown-cmark-0.11.3/src/tree.rs:183 truncate_siblings
/// Truncates the preceding siblings to the given end position,
/// and returns the new current node.
Tree.prototype.truncate_siblings = function (this: Tree<Item>, end_byte_ix: number): void {
  const parent_ix = this.peek_up()!;
  assert(parent_ix !== undefined, "called `Option::unwrap()` on a `None` value");
  let next_child_ix = this.at(parent_ix).child;
  let prev_child_ix: TreeIndex | undefined = undefined;

  // drop or truncate children based on its range
  while (next_child_ix !== undefined) {
    const child_ix: TreeIndex = next_child_ix;
    const child_end = this.at(child_ix).item.end;
    if (child_end < end_byte_ix) {
      // preserve this node, and go to the next
      prev_child_ix = child_ix;
      next_child_ix = this.at(child_ix).next;
      continue;
    } else if (child_end === end_byte_ix) {
      // this will be the last node
      this.at(child_ix).next = undefined;
      // focus to the new last child (this node)
      this.cur_ = child_ix;
    } else if (this.at(child_ix).item.start === end_byte_ix) {
      // check whether the previous character is a backslash
      const body = this.at(child_ix).item.body;
      const is_previous_char_backslash_escape = body.$ === "Text" ? body.backslash_escaped : false;
      if (is_previous_char_backslash_escape) {
        // rescue the backslash as a plain text content
        const last_byte_ix = end_byte_ix - 1;
        this.at(child_ix).item.start = last_byte_ix;
        this.at(child_ix).item.end = end_byte_ix;
        this.cur_ = child_ix;
      } else if (prev_child_ix !== undefined) {
        // the node will become empty. drop the node
        // a preceding sibling exists
        this.at(prev_child_ix).next = undefined;
        this.cur_ = prev_child_ix;
      } else {
        // no preceding siblings. remove the node from the parent
        this.at(parent_ix).child = undefined;
        this.cur_ = undefined;
      }
    } else {
      // debug_assert!(self[child_ix].item.start < end_byte_ix);
      // debug_assert!(end_byte_ix < child_end);
      // truncate the node
      this.at(child_ix).item.end = end_byte_ix;
      this.at(child_ix).next = undefined;
      // focus to the new last child
      this.cur_ = child_ix;
    }
    break;
  }
};

// crate: pulldown-cmark-0.11.3/src/tree.rs:241 fmt
/// `impl Debug for Tree<T>` (the `debug_tree` walk). `item_debug` is `T: Debug`.
export function debug_Tree<T>(tree: Tree<T>, f: Fmt, item_debug: (v: T, f: Fmt) => string): string {
  let out = "";
  // crate: pulldown-cmark-0.11.3/src/tree.rs:242 debug_tree
  const debug_tree = (cur: TreeIndex, indent: number): void => {
    for (let i = 0; i < indent; i++) {
      out += "  ";
    }
    out += item_debug(tree.at(cur).item, f) + "\n";
    const child_ix = tree.at(cur).child;
    if (child_ix !== undefined) {
      debug_tree(child_ix, indent + 1);
    }
    const next_ix = tree.at(cur).next;
    if (next_ix !== undefined) {
      debug_tree(next_ix, indent);
    }
  };

  if (tree.nodes.length > 1) {
    const cur = 1 as TreeIndex;
    debug_tree(cur, 0);
    return out;
  } else {
    return "Empty tree";
  }
}
