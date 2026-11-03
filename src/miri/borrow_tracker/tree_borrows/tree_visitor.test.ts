// Lane checks of the tree traversals (lane miri-tb-a). Upstream tree_visitor.rs has no `#[cfg(test)]`: its doc comment gives
// the visitation order as a graphic, checked here on a hand-built tree with the same shape. Node names are the numbers of
// that graphic. The traversal pops from the stack's end, so of two children the one listed *last* is visited first: the
// graphic's 4-before-6 and 7-before-9 mean `children: [6, 4]` and `[9, 2]` / `[1, 7]` here (the reverse also runs below).
import { expect, test } from "bun:test";
import { type BorTag } from "../mod.ts";
import { Permission } from "./perms.ts";
import { type AccessRelatedness, Node } from "./tree.ts";
import { TreeVisitor } from "./tree_visitor.ts";
import { type UniIndex, UniValMap } from "./unimap.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";

const I = (idx: number): UniIndex => ({ idx });

/** The nodes `{ parent: children }`, in the given child order. */
function tree(shape: Record<number, number[]>): UniValMap<Node> {
  const nodes = UniValMap.default<Node>();
  const parent = new Map<number, number>();
  for (const [p, cs] of Object.entries(shape)) for (const c of cs) parent.set(c, Number(p));
  const all = new Set<number>([...Object.keys(shape).map(Number), ...parent.keys()]);
  for (const n of all) {
    const p = parent.get(n);
    nodes.insert(
      I(n),
      new Node(n as BorTag, p === undefined ? undefined : I(p), (shape[n] ?? []).map(I), Permission.new_frozen(), "None", false, undefined as never),
    );
  }
  return nodes;
}

const GRAPHIC = { 3: [9, 2], 9: [8], 2: [1, 7], 1: [6, 4], 6: [5] };

type Log = { visited: [number, AccessRelatedness][]; continued: number[] };
const log = (): Log => ({ visited: [], continued: [] });
const f_continue =
  (skip: number[] = []) =>
  (a: { idx: UniIndex; data: Log }) => {
    a.data.continued.push(a.idx.idx);
    return skip.includes(a.idx.idx) ? ("SkipSelfAndChildren" as const) : ("Recurse" as const);
  };
const f_propagate = (a: { idx: UniIndex; rel_pos: AccessRelatedness; data: Log }): Result<null, string> => {
  a.data.visited.push([a.idx.idx, a.rel_pos]);
  return Ok(null);
};
const names = (l: Log): number[] => l.visited.map(([n]) => n);

test("traverse_this_parents_children_other visits in the graphic's order", () => {
  const data = log();
  const r = new TreeVisitor(tree(GRAPHIC), data).traverse_this_parents_children_other(I(1), f_continue(), f_propagate);
  expect(r).toEqual(Ok(I(3))); // the root of the accessed tree
  expect(names(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Nodes 1, 2, 3 undergo a child access (`LocalAccess`), the rest a foreign one.
  expect(data.visited.filter(([, rel]) => rel === "LocalAccess").map(([n]) => n)).toEqual([1, 2, 3]);
  // `f_continue` is only asked about foreign nodes, parents before children.
  expect(data.continued).toEqual([4, 6, 5, 7, 9, 8]);
});

test("the child listed last goes first", () => {
  const data = log();
  new TreeVisitor(tree({ 3: [2, 9], 9: [8], 2: [7, 1], 1: [4, 6], 6: [5] }), data).traverse_this_parents_children_other(I(1), f_continue(), f_propagate);
  expect(names(data)).toEqual([1, 2, 3, 5, 6, 4, 7, 8, 9]);
});

test("f_continue skipping node 6 leaves out nodes 5 and 6", () => {
  const data = log();
  new TreeVisitor(tree(GRAPHIC), data).traverse_this_parents_children_other(I(1), f_continue([6]), f_propagate);
  expect(names(data)).toEqual([1, 2, 3, 4, 7, 8, 9]);
  expect(data.continued).toEqual([4, 6, 7, 9, 8]);
});

test("traverse_nonchildren skips the children of the start node", () => {
  const data = log();
  const r = new TreeVisitor(tree(GRAPHIC), data).traverse_nonchildren(I(1), f_continue(), f_propagate);
  expect(r).toEqual(Ok(I(3)));
  expect(names(data)).toEqual([1, 2, 3, 7, 8, 9]);
});

test("traverse_children_this visits the subtree bottom-up, all as foreign", () => {
  const data = log();
  const r = new TreeVisitor(tree(GRAPHIC), data).traverse_children_this(I(1), f_continue(), f_propagate);
  expect(r).toEqual(Ok(null));
  expect(names(data)).toEqual([4, 5, 6, 1]);
  expect(data.visited.every(([, rel]) => rel === "ForeignAccess")).toBe(true);
  // The start node itself goes through `f_continue`, so it can skip the whole subtree.
  const skipped = log();
  new TreeVisitor(tree(GRAPHIC), skipped).traverse_children_this(I(1), f_continue([1]), f_propagate);
  expect(names(skipped)).toEqual([]);
});

test("an Err from f_propagate stops the traversal at once, in either phase", () => {
  const stop_at = (n: number) => (a: { idx: UniIndex; rel_pos: AccessRelatedness; data: Log }): Result<null, string> => {
    a.data.visited.push([a.idx.idx, a.rel_pos]);
    return a.idx.idx === n ? Err(`stop ${n}`) : Ok(null);
  };
  for (const [n, seen] of [
    [1, [1]],
    [2, [1, 2]],
    [5, [1, 2, 3, 4, 5]],
  ] as const) {
    const data = log();
    const r = new TreeVisitor(tree(GRAPHIC), data).traverse_this_parents_children_other(I(1), f_continue(), stop_at(n));
    expect(r).toEqual(Err(`stop ${n}`));
    expect(names(data)).toEqual([...seen]);
  }
  const data = log();
  expect(new TreeVisitor(tree(GRAPHIC), data).traverse_children_this(I(1), f_continue(), stop_at(5))).toEqual(Err("stop 5"));
  expect(names(data)).toEqual([4, 5]);
});

test("a root with no parent and no children", () => {
  const data = log();
  expect(new TreeVisitor(tree({ 0: [] }), data).traverse_this_parents_children_other(I(0), f_continue(), f_propagate)).toEqual(Ok(I(0)));
  expect(data.visited).toEqual([[0, "LocalAccess"]]);
});
