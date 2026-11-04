// Lane checks of the wildcard tracking (lane miri-tb-a). Upstream wildcard.rs has no `#[cfg(test)]`; the expected values follow
// from its code, and `verify_wildcard_consistency` (upstream's own invariant, behind `expensive-consistency-checks`) checks
// the counters after each step.
//
// lane miri-tb-b's `LocationState` constructors, `permission_` and `default_location_state` (tree.rs:64 / :73 / :89 / :1192):
// while they are still `unported` placeholders this file installs their upstream bodies for the duration of the tests and
// restores them afterwards (the weak_memory.test.ts precedent). Once tb-b lands, the tests run against tb-b's.
import { afterAll, beforeAll, expect, test } from "bun:test";
import "../../lib.ts";
import { type BorTag, type GlobalState } from "../mod.ts";
import { DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { Permission } from "./perms.ts";
import { LocationState, LocationTree, Node, Tree } from "./tree.ts";
import { type UniIndex, UniKeyMap, UniValMap } from "./unimap.ts";
import { ExposedCache, ExposedCache_eq, WildcardAccessLevel, WildcardAccessRelatedness } from "./wildcard.ts";
import { Size } from "../../../rustc_abi/lib.ts";

const saved: [object, string, PropertyDescriptor | undefined][] = [];
function ensure(target: object, name: string, impl: unknown): void {
  const cur = (target as Record<string, unknown>)[name];
  if (typeof cur === "function" && !String(cur).includes("unported(")) return;
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { value: impl, writable: true, configurable: true });
}
beforeAll(() => {
  ensure(LocationState, "new_non_accessed", (permission: Permission, sifa: LocationState["idempotent_foreign_access"]) => new LocationState(false, permission, sifa));
  ensure(LocationState, "new_accessed", (permission: Permission, sifa: LocationState["idempotent_foreign_access"]) => new LocationState(true, permission, sifa));
  ensure(LocationState.prototype, "permission_", function (this: LocationState) {
    return this.permission;
  });
  ensure(Node.prototype, "default_location_state", function (this: Node) {
    return (LocationState.new_non_accessed as unknown as (p: Permission, s: LocationState["idempotent_foreign_access"]) => LocationState)(
      this.default_initial_perm,
      this.default_initial_idempotent_foreign_access,
    );
  });
});
afterAll(() => {
  for (const [target, name, desc] of saved.reverse()) {
    if (desc === undefined) delete (target as Record<string, unknown>)[name];
    else Object.defineProperty(target, name, desc);
  }
});

const I = (idx: number): UniIndex => ({ idx });
const T = (n: number) => n as BorTag;

function node(tag: number, parent: number | undefined, children: number[], perm: Permission = Permission.new_frozen()): Node {
  return new Node(T(tag), parent === undefined ? undefined : I(parent), children.map(I), perm, "None", false, undefined as never);
}

/** root 0 -> 1 -> { 2, 3 }, with tags `index + 1` and `size` bytes. */
function small_tree(size = 8): Tree {
  const tag_mapping = UniKeyMap.default<BorTag>();
  const nodes = UniValMap.default<Node>();
  const shape: [number | undefined, number[]][] = [
    [undefined, [1]],
    [0, [2, 3]],
    [1, []],
    [1, []],
  ];
  shape.forEach(([parent, children], i) => {
    expect(tag_mapping.insert(T(i + 1)).idx).toBe(i);
    nodes.insert(I(i), node(i + 1, parent, children));
  });
  const locations = DedupRangeMap.new(Size.from_bytes(size), new LocationTree(UniValMap.default(), ExposedCache.default()));
  return new Tree(tag_mapping, nodes, locations, [I(0)]);
}

const global = (protected_: number[] = []): GlobalState => ({ protected_tags: new Map(protected_.map((t) => [T(t), "StrongProtector"])) }) as unknown as GlobalState;

function counts(c: ExposedCache, idx: number): [number, number] | undefined {
  const n = c._0.get(I(idx));
  return n === undefined ? undefined : [n.local_reads, n.local_writes];
}

test("WildcardAccessLevel::allows", () => {
  const A = WildcardAccessLevel.allows;
  expect([A("None", "Read"), A("None", "Write"), A("Read", "Read"), A("Read", "Write"), A("Write", "Read"), A("Write", "Write")]).toEqual([false, false, true, false, true, true]);
});

test("WildcardAccessRelatedness::to_relatedness", () => {
  const R = WildcardAccessRelatedness.to_relatedness;
  expect([R("LocalAccess"), R("ForeignAccess"), R("EitherAccess")]).toEqual(["LocalAccess", "ForeignAccess", undefined]);
});

test("update_exposure walks to the root and counts each level", () => {
  const nodes = small_tree().nodes;
  const c = ExposedCache.default();
  c.update_exposure(nodes, I(2), "None", "None"); // no change: no entry either
  expect(c._0.is_empty()).toBe(true);

  c.update_exposure(nodes, I(2), "None", "Write");
  for (const i of [2, 1, 0]) expect(counts(c, i)).toEqual([1, 1]);
  expect(counts(c, 3)).toBeUndefined();

  c.update_exposure(nodes, I(3), "None", "Read");
  expect(counts(c, 3)).toEqual([1, 0]);
  expect(counts(c, 1)).toEqual([2, 1]);
  expect(counts(c, 0)).toEqual([2, 1]);
  expect(counts(c, 2)).toEqual([1, 1]);

  c.update_exposure(nodes, I(3), "Read", "Write");
  expect(counts(c, 0)).toEqual([2, 2]);
  c.update_exposure(nodes, I(2), "Write", "Read");
  expect(counts(c, 2)).toEqual([1, 0]);
  expect(counts(c, 0)).toEqual([2, 1]);
  c.update_exposure(nodes, I(2), "Read", "None");
  expect(counts(c, 2)).toEqual([0, 0]);
  expect(counts(c, 0)).toEqual([1, 1]);
  c.update_exposure(nodes, I(3), "Write", "None");
  expect(counts(c, 0)).toEqual([0, 0]);

  // An emptied entry is still an entry, but `equivalent` compares it with its value: only a `remove` drops it.
  expect(ExposedCache_eq(c, ExposedCache.default())).toBe(false);
  for (const i of [3, 2, 1, 0]) c.remove(I(i));
  expect(ExposedCache_eq(c, ExposedCache.default())).toBe(true);
});

test("the counters are u16 and wrap in the release oracle", () => {
  const nodes = small_tree().nodes;
  const c = ExposedCache.default();
  c._0.insert(I(0), { local_writes: 0xffff, local_reads: 0 });
  c.update_exposure(nodes, I(0), "None", "Write");
  expect(counts(c, 0)).toEqual([1, 0]);
  c.update_exposure(nodes, I(0), "Write", "None");
  expect(counts(c, 0)).toEqual([0, 0xffff]);
  // The count itself is 0xffff, so without the wildcard tree's extra one the root is local to all of them ...
  expect(c.access_relatedness(I(0), I(0), "Write", false, false)).toBe("LocalAccess");
  // ... and with it, `total_num + 1` wraps to 0: the tree has "no exposed nodes".
  expect(c.access_relatedness(I(0), I(0), "Write", true, false)).toBeUndefined();
});

test("access_relatedness", () => {
  const nodes = small_tree().nodes;
  const c = ExposedCache.default();
  const rel = (id: number, kind: "Read" | "Write", wildcard = false, only_foreign = false) => c.access_relatedness(I(0), I(id), kind, wildcard, only_foreign);

  // Nothing exposed: None, unless it is a wildcard tree, where a foreign node always exists.
  expect(rel(0, "Read")).toBeUndefined();
  expect(rel(2, "Write")).toBeUndefined();
  expect(rel(2, "Read", true)).toBe("ForeignAccess");
  expect(rel(0, "Read", true)).toBe("ForeignAccess");

  c.update_exposure(nodes, I(2), "None", "Read");
  // One exposed node (2), for reads only.
  expect(rel(2, "Read")).toBe("LocalAccess");
  expect(rel(1, "Read")).toBe("LocalAccess");
  expect(rel(0, "Read")).toBe("LocalAccess");
  expect(rel(3, "Read")).toBe("ForeignAccess");
  expect(rel(2, "Write")).toBeUndefined();

  // A wildcard tree has one foreign exposed node more, so local-to-everything is no longer certain.
  expect(rel(2, "Read", true)).toBe("EitherAccess");
  expect(rel(3, "Read", true)).toBe("ForeignAccess");

  c.update_exposure(nodes, I(3), "None", "Write");
  expect(rel(2, "Read")).toBe("EitherAccess");
  expect(rel(3, "Read")).toBe("EitherAccess");
  expect(rel(1, "Read")).toBe("LocalAccess");
  expect(rel(2, "Write")).toBe("ForeignAccess");
  expect(rel(3, "Write")).toBe("LocalAccess");

  // `only_foreign` clamps.
  expect(rel(3, "Write", false, true)).toBeUndefined(); // LocalAccess
  expect(rel(2, "Write", false, true)).toBe("ForeignAccess"); // ForeignAccess
  expect(rel(2, "Read", false, true)).toBe("ForeignAccess"); // EitherAccess
  expect(c.access_relatedness(I(9), I(9), "Read", false, true)).toBeUndefined(); // None
});

test("Tree::expose_tag marks the node once and uses each location's permission", () => {
  const t = small_tree(8);
  // Split the locations: byte 0..4 has an accessed Frozen for node 3, 4..8 the node's default (a Reserved).
  const elems = t.locations.iter_mut(Size.from_bytes(0), Size.from_bytes(4), (l) => new LocationTree(UniValMap.default(), ExposedCache.default()), () => false);
  expect(elems.length).toBe(1);
  const frozen_loc = elems[0]![1];
  frozen_loc.perms.insert(I(3), new LocationState(true, Permission.new_frozen(), "Read"));
  const reserved_loc = t.locations.iter_all()[1]![1];
  expect(reserved_loc).not.toBe(frozen_loc);
  t.nodes.get(I(3))!.default_initial_perm = Permission.new_reserved_frz();

  t.expose_tag(T(4), false);
  expect(t.nodes.get(I(3))!.is_exposed).toBe(true);
  for (const i of [3, 1, 0]) {
    expect(counts(frozen_loc.exposed_cache, i)).toEqual([1, 0]);
    expect(counts(reserved_loc.exposed_cache, i)).toEqual([1, 1]);
  }
  expect(counts(frozen_loc.exposed_cache, 2)).toBeUndefined();
  t.verify_wildcard_consistency(global());

  // Exposing it again changes nothing.
  t.expose_tag(T(4), false);
  expect(counts(reserved_loc.exposed_cache, 0)).toEqual([1, 1]);
  t.verify_wildcard_consistency(global());
});

test("the protector's release upgrades a protected conflicted Reserved from Read to Write", () => {
  const t = small_tree(4);
  const loc = t.locations.iter_all()[0]![1];
  loc.perms.insert(I(2), new LocationState(true, new Permission({ $: "ReservedFrz", conflicted: true }), "Read"));
  t.expose_tag(T(3), true);
  expect(counts(loc.exposed_cache, 2)).toEqual([1, 0]);
  t.verify_wildcard_consistency(global([3]));

  t.update_exposure_for_protector_release(T(3));
  expect(counts(loc.exposed_cache, 2)).toEqual([1, 1]);
  expect(counts(loc.exposed_cache, 0)).toEqual([1, 1]);
  t.verify_wildcard_consistency(global());
});

test("a protector's release on an unexposed tag touches nothing", () => {
  const t = small_tree(4);
  const loc = t.locations.iter_all()[0]![1];
  t.update_exposure_for_protector_release(T(2));
  expect(loc.exposed_cache._0.is_empty()).toBe(true);
});

test("verify_wildcard_consistency reports a wrong counter with upstream's text", () => {
  const t = small_tree(4);
  t.expose_tag(T(3), false);
  const loc = t.locations.iter_all()[0]![1];
  loc.exposed_cache._0.get(I(1))!.local_reads = 5;
  expect(() => t.verify_wildcard_consistency(global())).toThrow(
    "assertion `left == right` failed: expected <1>'s (id:0) local_reads to be 5 instead of 1 (child_reads: 5, exposed_as: None)\n  left: 1\n right: 5",
  );
  const unsorted = small_tree(4);
  unsorted.roots = [I(1), I(0)];
  expect(() => unsorted.verify_wildcard_consistency(global())).toThrow("assertion failed: self.roots.is_sorted_by_key(|idx| self.nodes.get(*idx).unwrap().tag)");
});
