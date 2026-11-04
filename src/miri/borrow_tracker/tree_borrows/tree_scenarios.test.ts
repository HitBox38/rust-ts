// Tests of tree_borrows/{tree,diagnostics}.rs on real trees, against the oracle's texts (lane miri-tb-b).
//
// PENDING miri-tb-a: these need lane miri-tb-a's `UniKeyMap` / `UniValMap`, `Permission`, `TreeVisitor` and `ExposedCache`.
// Root renames this file to tree_scenarios.test.ts (drops the suffix) after merging that lane (docs/handoff/miri-tb-b.md). It has no `.ts`
// extension until then so that neither bun test nor tsc nor contract.test.ts sees it.
//
// Each scenario replays a program of oracle/ on a hand-driven `Tree`: the tags and allocation ids are the ones the oracle
// printed, and each retag is what tree_borrows/mod.rs `tb_reborrow` would do (accessed inside the reborrowed range, one
// `new_child`, the read-on-reborrow done by the caller). The UB report's title, details and every history message must equal
// the oracle's lines, byte for byte. (Spans are the interpreter's: the end-to-end suite compares those.)
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import "../../lib.ts";
import { type BorTag, GlobalStateInner, type ProtectorKind, type TreeBorrowsParams } from "../mod.ts";
import { AccessCause, DiagnosticInfo, NodeDebugInfo, TbError } from "./diagnostics.ts";
import { Permission } from "./perms.ts";
import { LocationState, LocationState_eq, LocationTree, LocationTree_eq, Tree } from "./tree.ts";
import { UniValMap } from "./unimap.ts";
import { ExposedCache } from "./wildcard.ts";
import { TerminationInfoStop } from "../../diagnostics.ts";
import { DedupRangeMap } from "../../data_structures/dedup_range_map.ts";
import { type ProvenanceExtra } from "../../machine.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { alloc_range } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, InterpErrorInfo_from_InterpErrorKind, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { Err } from "../../../std/result.ts";

const ORACLE = join(dirname(import.meta.path), "oracle");
const T = (n: number) => n as BorTag;
const C = (n: number): ProvenanceExtra => ({ $: "Concrete", _0: T(n) });
const WILDCARD: ProvenanceExtra = { $: "Wildcard" };
const SPAN = 11 as Span;
const READ: AccessCause = { $: "Explicit", _0: "Read" };
const WRITE: AccessCause = { $: "Explicit", _0: "Write" };

const TB_PARAMS: TreeBorrowsParams = { precise_interior_mut: true, implicit_writes: false };

function global_state(protected_tags: [number, ProtectorKind][] = []): GlobalStateInner {
  return new GlobalStateInner({ $: "TreeBorrows", _0: TB_PARAMS }, "Default", T(100_000), new Map(), new Map(protected_tags.map(([t, k]) => [T(t), k])), new Set());
}

/** The new tag's permissions for a reborrow of `[0, size)` (tb_reborrow: accessed if the reference is dereferenceable). */
function inside(perm: Permission, size: number, protected_: boolean, accessed = true): DedupRangeMap<LocationState> {
  const sifa = perm.strongest_idempotent_foreign_access(protected_);
  return DedupRangeMap.new(Size.from_bytes(size), accessed ? LocationState.new_accessed(perm, sifa) : LocationState.new_non_accessed(perm, sifa));
}

/** The oracle's report of `name`: the title, then every `= help:` / `help:` text after the two fixed lines. */
function oracle_report(name: string): string[] {
  const lines = readFileSync(join(ORACLE, `${name}.stderr`), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("error: Undefined Behavior: "));
  const out = [lines[start]!.slice("error: Undefined Behavior: ".length)];
  for (const l of lines.slice(start + 1)) {
    const m = /^(?:\s*= )?help: (.*)$/.exec(l);
    if (m === null || m[1]!.startsWith("this indicates a potential bug") || m[1]!.startsWith("see https://github.com/rust-lang/unsafe-code-guidelines")) continue;
    out.push(m[1]!);
  }
  return out;
}

/** The report the port built, in the order src/miri/diagnostics.ts prints it. */
function port_report(r: InterpResult<unknown>): string[] {
  if (r.$ !== "Err") throw new Error("expected a Tree Borrows error");
  const kind = r._0.kind();
  if (kind.$ !== "MachineStop") throw new Error(`expected MachineStop, got ${kind.$}`);
  const info = (kind._0 as TerminationInfoStop).info;
  if (info.$ !== "TreeBorrowsUb") throw new Error(`expected TreeBorrowsUb, got ${info.$}`);
  return [info.title, ...info.details, ...info.history.events.map(([_span, msg]) => msg)];
}

function ok(r: InterpResult<unknown>): void {
  if (r.$ === "Err") throw new Error(`unexpected error: ${port_report(r).join(" / ")}`);
}

test("LocationTree_eq is structural: `UniValMap::equivalent` with `LocationState`'s eq", () => {
  const state = () => LocationState.new_accessed(Permission.new_frozen(), "None");
  const tree = (extra: boolean) => {
    const perms = new UniValMap<LocationState>([state()]);
    if (extra) perms.data.push(undefined);
    return new LocationTree(perms, new ExposedCache(new UniValMap([])));
  };
  expect(LocationState_eq(state(), state())).toBe(true);
  expect(LocationState_eq(state(), LocationState.new_non_accessed(Permission.new_frozen(), "None"))).toBe(false);
  // Equal maps of distinct objects: `equivalent` must not compare by identity, or ranges would never merge.
  expect(LocationTree_eq(tree(false), tree(false))).toBe(true);
  // Equality up to trailing `None`s.
  expect(LocationTree_eq(tree(false), tree(true))).toBe(true);
});

test("child_forbidden_accessed", () => {
  const global = global_state();
  const alloc_id = 206 as AllocId;
  const tree = Tree.new(T(1), Size.from_bytes(8), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(473), inside(Permission.new_reserved_frz(), 6, false), Permission.new_reserved_frz(), false, SPAN));
  ok(tree.perform_access(C(1), alloc_range(Size.from_bytes(5), Size.from_bytes(1)), "Write", WRITE, global, alloc_id, SPAN));
  const r = tree.perform_access(C(473), alloc_range(Size.from_bytes(5), Size.from_bytes(1)), "Read", READ, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("child_forbidden_accessed"));
});

test("child_forbidden_conflicting", () => {
  const global = global_state();
  const alloc_id = 205 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(468), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  ok(tree.perform_access(C(1), one, "Read", READ, global, alloc_id, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(468), T(469), inside(Permission.new_reserved_frz(), 1, false), Permission.new_reserved_frz(), false, SPAN));
  const r = tree.perform_access(C(469), one, "Write", WRITE, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("child_forbidden_conflicting"));
});

test("protected_disabled", () => {
  const global = global_state([[471, "StrongProtector"]]);
  const alloc_id = 205 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(467), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(467), T(471), inside(Permission.new_reserved_frz(), 1, true), Permission.new_reserved_frz(), true, SPAN));
  ok(tree.perform_access(C(471), one, "Write", WRITE, global, alloc_id, SPAN));
  const r = tree.perform_access(C(467), one, "Write", WRITE, global, alloc_id, SPAN);
  const report = port_report(r);
  // tag 467 is not the allocation's root in the program, so its name is not printed there: drop the root's name here.
  const oracle = oracle_report("protected_disabled");
  expect(report.map((l) => l.replaceAll("<467> (root of the allocation)", "<467>"))).toEqual(oracle);
});

test("protected_dealloc", () => {
  const global = global_state([[476, "StrongProtector"]]);
  const alloc_id = 285 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(476), inside(Permission.new_reserved_frz(), 1, true), Permission.new_reserved_frz(), true, SPAN));
  const r = tree.dealloc(C(476), one, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("protected_dealloc"));
});

test("reborrow_error", () => {
  const global = global_state();
  const alloc_id = 205 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(468), inside(Permission.new_reserved_frz(), 1, false), Permission.new_reserved_frz(), false, SPAN));
  ok(tree.perform_access(C(1), one, "Write", WRITE, global, alloc_id, SPAN));
  const r = tree.perform_access(C(468), one, "Read", { $: "Reborrow", _0: "Read" }, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("reborrow_error"));
});

test("fn_exit_history: protector release, on every location previously accessed by this tag", () => {
  const global = global_state([[474, "StrongProtector"]]);
  const alloc_id = 205 as AllocId;
  const first = alloc_range(Size.from_bytes(0), Size.from_bytes(4));
  const tree = Tree.new(T(1), Size.from_bytes(8), SPAN);
  // `first`, protected, written.
  ok(tree.new_child(Size.from_bytes(0), C(1), T(474), inside(Permission.new_reserved_frz(), 4, true), Permission.new_reserved_frz(), true, SPAN));
  ok(tree.perform_access(C(474), first, "Write", WRITE, global, alloc_id, SPAN));
  // `&mut *base.add(1)`: a child of the root, on the second element only. The first element stays lazy.
  ok(tree.new_child(Size.from_bytes(4), C(1), T(475), inside(Permission.new_reserved_frz(), 4, false), Permission.new_reserved_frz(), false, SPAN));
  ok(tree.perform_protector_end_access(T(474), global, alloc_id, SPAN));
  global.protected_tags.delete(T(474));
  const r = tree.perform_access(C(475), first, "Read", READ, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("fn_exit_history"));
});

test("wildcard_no_exposed", () => {
  const global = global_state();
  const alloc_id = 205 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(Permission.new_reserved_frz(), 1, false), Permission.new_reserved_frz(), false, SPAN));
  tree.expose_tag(T(2), false);
  ok(tree.perform_access(C(1), one, "Write", WRITE, global, alloc_id, SPAN));
  const r = tree.perform_access(WILDCARD, one, "Write", WRITE, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("wildcard_no_exposed"));
});

test("wildcard_protected", () => {
  const global = global_state([[471, "StrongProtector"]]);
  const alloc_id = 205 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  tree.expose_tag(T(1), false);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(471), inside(Permission.new_reserved_frz(), 1, true), Permission.new_reserved_frz(), true, SPAN));
  ok(tree.perform_access(C(471), one, "Write", WRITE, global, alloc_id, SPAN));
  const r = tree.perform_access(WILDCARD, one, "Write", WRITE, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("wildcard_protected"));
});

test("dealloc_wildcard", () => {
  const global = global_state([[476, "StrongProtector"]]);
  const alloc_id = 285 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  tree.expose_tag(T(1), false);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(476), inside(Permission.new_reserved_frz(), 1, true), Permission.new_reserved_frz(), true, SPAN));
  const r = tree.dealloc(WILDCARD, one, global, alloc_id, SPAN);
  expect(port_report(r)).toEqual(oracle_report("dealloc_wildcard"));
});

test("GC: remove_unreachable_tags compacts a dead parent and merges the ranges", () => {
  const global = global_state();
  const tree = Tree.new(T(1), Size.from_bytes(2), SPAN);
  // root -> 2 (dead) -> 3 (live), and 4 (dead, no children), with a split at offset 1 made by 4's access.
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(Permission.new_frozen(), 2, false), Permission.new_frozen(), false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(2), T(3), inside(Permission.new_frozen(), 2, false), Permission.new_frozen(), false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(1), T(4), inside(Permission.new_reserved_frz(), 1, false), Permission.new_reserved_frz(), false, SPAN));
  ok(tree.perform_access(C(1), alloc_range(Size.from_bytes(1), Size.from_bytes(1)), "Read", READ, global, 7 as AllocId, SPAN));
  expect(tree.locations.iter_all().length).toBe(2);
  tree.remove_unreachable_tags(new Set([T(1), T(3)]));
  expect(tree.tag_mapping.contains_key(T(2))).toBe(false);
  expect(tree.tag_mapping.contains_key(T(4))).toBe(false);
  expect(tree.tag_mapping.contains_key(T(3))).toBe(true);
  const root = tree.nodes.get(tree.tag_mapping.get(T(1))!)!;
  expect(root.children.map((c) => tree.nodes.get(c)!.tag)).toEqual([T(3)]);
  expect(tree.nodes.get(tree.tag_mapping.get(T(3))!)!.parent?.idx).toBe(tree.tag_mapping.get(T(1))!.idx);
  // Once 4 is gone both ranges are equal.
  expect(tree.locations.iter_all().length).toBe(1);
});

test("new_child: each location range gets its own copy of the inside state", () => {
  const global = global_state();
  const tree = Tree.new(T(1), Size.from_bytes(2), SPAN);
  // A sibling on the first byte only keeps the two location ranges apart (they would merge otherwise).
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(1), T(3), inside(Permission.new_reserved_frz(), 2, false), Permission.new_reserved_frz(), false, SPAN));
  expect(tree.locations.iter_all().length).toBe(2);
  const idx = tree.tag_mapping.get(T(3))!;
  const [first, second] = tree.locations.iter_all().map(([_r, loc]) => loc.perms.get(idx)!);
  expect(first).not.toBe(second);
  // A write to the first byte must leave the second byte's state alone.
  ok(tree.perform_access(C(3), alloc_range(Size.from_bytes(0), Size.from_bytes(1)), "Write", WRITE, global, 7 as AllocId, SPAN));
  const after = tree.locations.iter_all().map(([_r, loc]) => loc.perms.get(idx)!.permission_().short_name());
  expect(after).toEqual(["Unq ", "Res "]);
});

test("new_child restores the SIFA invariant up the parents", () => {
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  const sifa_of = (tag: number) => {
    const idx = tree.tag_mapping.get(T(tag))!;
    return [tree.nodes.get(idx)!.default_initial_idempotent_foreign_access, tree.locations.iter_all()[0]![1].perms.get(idx)!.idempotent_foreign_access];
  };
  // perms.rs `strongest_idempotent_foreign_access`: Cell -> Write, Frozen -> Read, protected Reserved -> None.
  const cell = Permission.new_cell();
  const frozen = Permission.new_frozen();
  const reserved = Permission.new_reserved_frz();
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(cell, 1, false), cell, false, SPAN));
  expect(sifa_of(2)).toEqual(["Write", "Write"]);
  // A child of the same strength changes nothing.
  ok(tree.new_child(Size.from_bytes(0), C(2), T(3), inside(cell, 1, false), cell, false, SPAN));
  expect(sifa_of(2)).toEqual(["Write", "Write"]);
  // A weaker child weakens both SIFAs of every parent.
  ok(tree.new_child(Size.from_bytes(0), C(3), T(4), inside(frozen, 1, false), frozen, false, SPAN));
  expect(sifa_of(4)).toEqual(["Read", "Read"]);
  expect(sifa_of(3)).toEqual(["Read", "Read"]);
  expect(sifa_of(2)).toEqual(["Read", "Read"]);
  // A stronger child never strengthens a parent.
  ok(tree.new_child(Size.from_bytes(0), C(4), T(5), inside(cell, 1, false), cell, false, SPAN));
  expect(sifa_of(4)).toEqual(["Read", "Read"]);
  // The weakest of the child's locations and its outside permission counts.
  ok(tree.new_child(Size.from_bytes(0), C(4), T(6), inside(reserved, 1, true), reserved, true, SPAN));
  expect(sifa_of(6)).toEqual(["None", "None"]);
  expect(sifa_of(4)).toEqual(["None", "None"]);
  expect(sifa_of(2)).toEqual(["None", "None"]);
  // The sibling keeps its own.
  expect(sifa_of(5)).toEqual(["Write", "Write"]);
});

test("get_min_exposed_child skips subtrees above the minimum", () => {
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  const frozen = Permission.new_frozen();
  const child = (parent: number, tag: number) => ok(tree.new_child(Size.from_bytes(0), C(parent), T(tag), inside(frozen, 1, false), frozen, false, SPAN));
  child(1, 2);
  child(2, 3);
  child(1, 4);
  child(4, 5);
  const root = tree.tag_mapping.get(T(1))!;
  expect(LocationTree.get_min_exposed_child(root, tree.nodes)).toBeUndefined();
  tree.expose_tag(T(5), false);
  expect(LocationTree.get_min_exposed_child(root, tree.nodes)).toBe(T(5));
  tree.expose_tag(T(3), false);
  expect(LocationTree.get_min_exposed_child(root, tree.nodes)).toBe(T(3));
  tree.expose_tag(T(2), false);
  expect(LocationTree.get_min_exposed_child(root, tree.nodes)).toBe(T(2));
});

test("a wildcard retag makes a new root, kept by the GC and sorted after the main root", () => {
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  tree.expose_tag(T(1), false);
  const reserved = Permission.new_reserved_frz();
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(2), inside(reserved, 1, false), reserved, false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(3), inside(reserved, 1, false), reserved, false, SPAN));
  expect(tree.roots.map((r) => tree.nodes.get(r)!.tag)).toEqual([T(1), T(2), T(3)]);
  expect(tree.nodes.get(tree.tag_mapping.get(T(2))!)!.parent).toBeUndefined();
  const seen: (BorTag | undefined)[] = [];
  tree.visit_provenance((_alloc, tag) => seen.push(tag));
  expect(seen).toEqual([T(1), T(2), T(3), T(1)]);
  tree.remove_unreachable_tags(new Set());
  expect(tree.roots.length).toBe(3);
});

test("a foreign write to a protected location that was never accessed is not UB (it is, once accessed)", () => {
  const global = global_state([[2, "StrongProtector"]]);
  const alloc_id = 7 as AllocId;
  const reserved = Permission.new_reserved_frz();
  const tree = Tree.new(T(1), Size.from_bytes(2), SPAN);
  // `T(2)` covers only the first byte: the second is lazy ("future initial state").
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(reserved, 1, true), reserved, true, SPAN));
  ok(tree.perform_access(C(1), alloc_range(Size.from_bytes(1), Size.from_bytes(1)), "Write", WRITE, global, alloc_id, SPAN));
  const idx = tree.tag_mapping.get(T(2))!;
  const lazy = tree.locations.iter_all()[1]![1].perms.get(idx)!;
  expect(lazy.accessed_()).toBe(false);
  expect(lazy.permission_().is_disabled()).toBe(true);
  const r = tree.perform_access(C(1), alloc_range(Size.from_bytes(0), Size.from_bytes(1)), "Write", WRITE, global, alloc_id, SPAN);
  expect(port_report(r)[1]).toBe("the accessed tag <1> (root of the allocation) is foreign to the protected tag <2> (i.e., it is not a child)");
});

test("TbError::build with no accessed tag: `<wildcard>` is never the conflicting tag", () => {
  const info = NodeDebugInfo.new(T(5), Permission.new_frozen(), SPAN);
  const diagnostics = new DiagnosticInfo(7 as AllocId, SPAN, { start: 0n, end: 1n }, undefined, WRITE);
  const kind = new TbError({ $: "ChildAccessForbidden", _0: Permission.new_frozen() }, diagnostics, info, undefined).build();
  expect(port_report(Err(InterpErrorInfo_from_InterpErrorKind(kind)))).toEqual([
    "write access through <wildcard> at alloc7[0x0] is forbidden",
    "the accessed tag <wildcard> is a child of the conflicting tag <5>",
    "the conflicting tag <5> has state Frozen which forbids this child write access",
    "the conflicting tag <5> was created here, in the initial state Frozen",
  ]);
});

test("protector release skips the wildcard subtrees that may be children of the released tag (tree.rs:951)", () => {
  const global = global_state([[2, "StrongProtector"]]);
  const alloc_id = 7 as AllocId;
  const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
  const reserved = Permission.new_reserved_frz();
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(reserved, 1, true), reserved, true, SPAN));
  ok(tree.perform_access(C(2), one, "Write", WRITE, global, alloc_id, SPAN));
  // A wildcard root older than the exposed child can't be its child, so the release (a write: `2` is Unique) reaches it.
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(4), inside(reserved, 1, false), reserved, false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(2), T(5), inside(reserved, 1, false), reserved, false, SPAN));
  tree.expose_tag(T(5), false);
  // A wildcard root younger than the exposed child may be its child, so the release must not touch it.
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(6), inside(reserved, 1, false), reserved, false, SPAN));
  const perm_of = (tag: number) => tree.locations.iter_all()[0]![1].perms.get(tree.tag_mapping.get(T(tag))!)!.permission_().short_name();
  expect(perm_of(4)).toBe("Res ");
  expect(perm_of(6)).toBe("Res ");
  ok(tree.perform_protector_end_access(T(2), global, alloc_id, SPAN));
  expect(perm_of(4)).toBe("Dis ");
  expect(perm_of(6)).toBe("Res ");
});

test("dealloc checks the other roots in reverse order (tree.rs:603)", () => {
  // Hand-built: both wildcard roots exposed and strongly protected, and neither conflicted (a real program conflicts the
  // first at the second's retag, oracle/dealloc_wildcard_roots.rs), so the access transitions nothing.
  const global = global_state();
  const reserved = Permission.new_reserved_frz();
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(2), inside(reserved, 1, true), reserved, true, SPAN));
  ok(tree.new_child(Size.from_bytes(0), WILDCARD, T(3), inside(reserved, 1, true), reserved, true, SPAN));
  tree.expose_tag(T(1), false);
  tree.expose_tag(T(2), true);
  tree.expose_tag(T(3), true);
  global.protected_tags.set(T(2), "StrongProtector");
  global.protected_tags.set(T(3), "StrongProtector");
  const r = tree.dealloc(WILDCARD, alloc_range(Size.from_bytes(0), Size.from_bytes(1)), global, 7 as AllocId, SPAN);
  expect(port_report(r)[1]).toBe("the allocation of the accessed tag <wildcard> also contains the strongly protected tag <3>");
});

test("visit_provenance visits the roots and exposed tags", () => {
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(1), T(3), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  tree.expose_tag(T(3), false);
  const seen: (BorTag | undefined)[] = [];
  tree.visit_provenance((_alloc, tag) => seen.push(tag));
  expect(seen).toEqual([T(1), T(3)]);
});

test("nth_parent, give_pointer_debug_name, is_allocation_of", () => {
  const tree = Tree.new(T(1), Size.from_bytes(1), SPAN);
  ok(tree.new_child(Size.from_bytes(0), C(1), T(2), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  ok(tree.new_child(Size.from_bytes(0), C(2), T(3), inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, SPAN));
  expect(tree.nth_parent(T(3), 0)).toBe(T(3));
  expect(tree.nth_parent(T(3), 2)).toBe(T(1));
  expect(tree.nth_parent(T(3), 3)).toBeUndefined();
  ok(tree.give_pointer_debug_name(T(3), 1, "a"));
  ok(tree.give_pointer_debug_name(T(3), 1, "b"));
  expect(tree.nodes.get(tree.tag_mapping.get(T(2))!)!.debug_info.name).toBe("a, b");
  expect(tree.is_allocation_of(T(3))).toBe(true);
  expect(tree.is_allocation_of(T(9))).toBe(false);
});

// `print_tree` of a real tree writes to fd 2: a child replays the `conflicted` allocation of oracle/print_state.rs.
const CHILD = String.raw`
import ${JSON.stringify(join(dirname(import.meta.path), "../../lib.ts"))};
import { GlobalStateInner } from ${JSON.stringify(join(dirname(import.meta.path), "../mod.ts"))};
import { Permission } from ${JSON.stringify(join(dirname(import.meta.path), "perms.ts"))};
import { LocationState, Tree } from ${JSON.stringify(join(dirname(import.meta.path), "tree.ts"))};
import { DedupRangeMap } from ${JSON.stringify(join(dirname(import.meta.path), "../../data_structures/dedup_range_map.ts"))};
import { Size } from ${JSON.stringify(join(dirname(import.meta.path), "../../../rustc_abi/lib.ts"))};
import { alloc_range } from ${JSON.stringify(join(dirname(import.meta.path), "../../../rustc_middle/mir/interpret/allocation.ts"))};

const C = (n) => ({ $: "Concrete", _0: n });
const inside = (perm, size, protected_) => DedupRangeMap.new(Size.from_bytes(size), LocationState.new_accessed(perm, perm.strongest_idempotent_foreign_access(protected_)));
const one = alloc_range(Size.from_bytes(0), Size.from_bytes(1));
const global = new GlobalStateInner({ $: "TreeBorrows", _0: { precise_interior_mut: true, implicit_writes: false } }, "Default", 100000, new Map(), new Map([[880, "StrongProtector"]]), new Set());
const tree = Tree.new(877, Size.from_bytes(1), 11);
const R = () => Permission.new_reserved_frz();
// tb_reborrow: the read-on-reborrow goes through the parent, then the child is inserted.
tree.perform_access(C(877), one, "Read", { $: "Reborrow", _0: "Read" }, global, 7, 11);
tree.new_child(Size.from_bytes(0), C(877), 880, inside(R(), 1, true), R(), true, 11);
tree.give_pointer_debug_name(880, 0, "x");
tree.new_child(Size.from_bytes(0), C(880), 893, inside(R(), 1, false), R(), false, 11);
tree.give_pointer_debug_name(893, 0, "y");
tree.print_tree(global.protected_tags, false);
tree.perform_access(C(880), one, "Read", { $: "Reborrow", _0: "Read" }, global, 7, 11);
tree.new_child(Size.from_bytes(0), C(880), 909, inside(Permission.new_frozen(), 1, false), Permission.new_frozen(), false, 11);
tree.perform_access(C(909), one, "Read", { $: "Explicit", _0: "Read" }, global, 7, 11);
tree.give_pointer_debug_name(909, 0, "z");
tree.print_tree(global.protected_tags, false);
`;

test("print_tree of a real tree: byte-exact against the oracle", () => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { stderr: "pipe", stdout: "pipe" });
  const got = r.stderr.toString();
  expect(r.exitCode).toBe(0);
  const fixture = readFileSync(join(ORACLE, "print_state.stderr"), "utf8");
  const first = fixture.indexOf("<880=x>");
  // The two trees of `conflicted`: from the border above the first `<880=x>` to the border below `<909=z>`.
  const lines = fixture.split("\n");
  const start_line = fixture.slice(0, first).split("\n").length - 1;
  let begin = start_line;
  while (!/^─+$/.test(lines[begin]!)) begin--;
  let end = lines.findIndex((l) => l.includes("<909=z>"));
  while (!/^─+$/.test(lines[end]!)) end++;
  expect(got).toBe(`${lines.slice(begin, end + 1).join("\n")}\n`);
}, 60_000);
