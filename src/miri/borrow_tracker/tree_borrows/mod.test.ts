// Lane checks of src/miri/borrow_tracker/tree_borrows/mod.ts (lane miri-tb-a). Upstream mod.rs has no `#[cfg(test)]`; the expected
// values follow from its code. The interpreter around the fns is a test double with only the members they read (the
// borrow_tracker/mod.test.ts precedent), and `Tree` is a recording double, so this checks the retag's own decisions; the
// end-to-end comparison with the oracle needs lane miri-tb-b's tree (root runs it after merging).
//
// lane miri-tb-b's `LocationState` constructors and `permission_` (tree.rs:64 / :73 / :89): while they are still `unported`
// placeholders this file installs their upstream bodies for the duration of the tests and restores them afterwards.
import { afterAll, beforeAll, expect, test } from "bun:test";
import "../../lib.ts";
import { type BorTag, type GlobalStateInner } from "../mod.ts";
import { NewPermission } from "./mod.ts";
import { debug_Permission, Permission } from "./perms.ts";
import { LocationState, Tree } from "./tree.ts";
import { type MiriInterpCx, type MiriMachine } from "../../machine.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type RetagMode } from "../../../rustc_const_eval/interpret/machine.gen.ts";
import { alloc_range, type AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, interp_ok } from "../../../rustc_middle/mir/interpret/mod.ts";
import { HasAttrs_DefId, type Ty } from "../../../rustc_middle/ty/mod.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Err, Ok } from "../../../std/result.ts";

type Sifa = LocationState["idempotent_foreign_access"];
const saved: [object, string, PropertyDescriptor | undefined][] = [];
function ensure(target: object, name: string, impl: unknown): void {
  const cur = (target as Record<string, unknown>)[name];
  if (typeof cur === "function" && !String(cur).includes("unported(")) return;
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { value: impl, writable: true, configurable: true });
}
beforeAll(() => {
  ensure(LocationState, "new_non_accessed", (permission: Permission, sifa: Sifa) => new LocationState(false, permission, sifa));
  ensure(LocationState, "new_accessed", (permission: Permission, sifa: Sifa) => new LocationState(true, permission, sifa));
  ensure(LocationState.prototype, "permission_", function (this: LocationState) {
    return this.permission;
  });
});
afterAll(() => {
  for (const [target, name, desc] of saved.reverse()) {
    if (desc === undefined) delete (target as Record<string, unknown>)[name];
    else Object.defineProperty(target, name, desc);
  }
});

const P = (p: Permission | undefined): string => (p === undefined ? "-" : p.short_name().trim());

function pointee(opts: { unpin?: boolean; unsafe_unpin?: boolean; freeze?: boolean } = {}): Ty {
  return {
    is_unpin: () => opts.unpin ?? true,
    is_unsafe_unpin: () => opts.unsafe_unpin ?? true,
    is_freeze: () => opts.freeze ?? true,
  } as unknown as Ty;
}

function cx(implicit_writes = false): MiriInterpCx {
  return {
    tcx: { tcx: {} },
    typing_env_: () => ({}),
    get_tree_borrows_params: () => ({ implicit_writes, precise_interior_mut: true }),
    frame: () => ({ instance_: () => ({ def: { $: "Item", _0: { krate: 0, index: 0 } }, args: [] }) }),
  } as unknown as MiriInterpCx;
}

function np(ty: Ty, m: Mutability | undefined, mode: RetagMode, c: MiriInterpCx = cx()): string {
  const p = NewPermission.new(ty, m, mode, c);
  return p === undefined ? "none" : `${P(p.freeze_perm)} ${P(p.nonfreeze_perm)} ${P(p.outside_perm)} ${p.protector ?? "-"}`;
}

test("NewPermission::new: RetagMode::None and pinning types", () => {
  expect(np(pointee(), "Not", "None")).toBe("none");
  // Mutable reference / Box to a pinning type: a NOP. A shared reference does not care.
  for (const ty of [pointee({ unpin: false }), pointee({ unsafe_unpin: false })]) {
    expect(np(ty, "Mut", "Default")).toBe("none");
    expect(np(ty, undefined, "Default")).toBe("none");
    expect(np(ty, "Not", "Default")).toBe("Frz Cel Frz -");
  }
});

test("NewPermission::new: shared references", () => {
  expect(np(pointee({ freeze: true }), "Not", "Default")).toBe("Frz Cel Frz -");
  expect(np(pointee({ freeze: false }), "Not", "Default")).toBe("Frz Cel Cel -");
  expect(np(pointee({ freeze: true }), "Not", "FnEntry")).toBe("Frz Cel Frz StrongProtector");
  expect(np(pointee({ freeze: false }), "Not", "FnEntry")).toBe("Frz Cel Cel StrongProtector");
});

test("NewPermission::new: mutable references and boxes, without implicit writes", () => {
  for (const [m, prot] of [
    ["Mut", "StrongProtector"],
    [undefined, "WeakProtector"],
  ] as const) {
    expect(np(pointee({ freeze: true }), m, "Default")).toBe("Res ReIM Res -");
    expect(np(pointee({ freeze: false }), m, "Default")).toBe("Res ReIM ReIM -");
    expect(np(pointee({ freeze: true }), m, "TwoPhase")).toBe("Res ReIM Res -");
    // Protected: never `ReservedIM`.
    expect(np(pointee({ freeze: true }), m, "FnEntry")).toBe(`Res Res Res ${prot}`);
    expect(np(pointee({ freeze: false }), m, "FnEntry")).toBe(`Res Res Res ${prot}`);
  }
});

test("NewPermission::new: implicit writes and #[rustc_no_writable]", () => {
  const original = HasAttrs_DefId.get_attrs;
  let attrs: unknown[] = [];
  (HasAttrs_DefId as { get_attrs: unknown }).get_attrs = () => attrs;
  try {
    for (const [m, prot] of [
      ["Mut", "StrongProtector"],
      [undefined, "WeakProtector"],
    ] as const) {
      // Only under a protector, and never for the outside part.
      expect(np(pointee(), m, "FnEntry", cx(true))).toBe(`Unq Unq Res ${prot}`);
      expect(np(pointee(), m, "Default", cx(true))).toBe("Res ReIM Res -");
    }
    expect(np(pointee(), "Not", "FnEntry", cx(true))).toBe("Frz Cel Frz StrongProtector");
    attrs = [{ $: "Parsed", _0: { $: "RustcNoWritable" } }];
    expect(np(pointee(), "Mut", "FnEntry", cx(true))).toBe("Res Res Res StrongProtector");
  } finally {
    (HasAttrs_DefId as { get_attrs: unknown }).get_attrs = original;
  }
});

const ALLOC = 7 as unknown as AllocId;
const PARENT = { $: "Concrete", _0: 2 as BorTag } as const;
const NEW_TAG = 9 as BorTag;

type Call = { kind: string; range: [number, number]; cause: string };

/** An interpreter double around one allocation: `base` bytes in, `ranges` from `visit_freeze_sensitive`. */
function retag_cx(opts: {
  size: number;
  base?: number;
  ranges?: [number, number, boolean][];
  precise?: boolean;
  alloc_kind?: string;
  mutability?: Mutability;
  no_alloc?: boolean;
}) {
  const calls: Call[] = [];
  const data_race: string[] = [];
  const diags: unknown[] = [];
  const children: { tag: BorTag; perms: LocationState[]; outside: Permission; protected_: boolean; base: number }[] = [];
  const protected_frame: unknown[] = [];
  const global = { protected_tags: new Map(), tracked_pointer_tags: new Set(), new_ptr: () => NEW_TAG };
  const tree = {
    perform_access: (prov: unknown, range: AllocRange, kind: string, cause: { $: string; _0: string }) => {
      expect(prov).toBe(PARENT);
      calls.push({ kind, range: [range.start.bytes(), range.size.bytes()], cause: `${cause.$}(${cause._0})` });
      return interp_ok(undefined);
    },
    new_child: (base: Size, prov: unknown, tag: BorTag, perms: { iter_all(): [unknown, LocationState][] }, outside: Permission, protected_: boolean) => {
      expect(prov).toBe(PARENT);
      children.push({ tag, perms: perms.iter_all().map(([, s]) => s), outside, protected_, base: base.bytes() });
      return interp_ok(undefined);
    },
  };
  const machine = { borrow_tracker: global, current_user_relevant_span: () => 0 };
  const alloc_extra = {
    data_race: { $: "Vclocks", _0: { read_non_atomic: () => (data_race.push("read"), interp_ok(undefined)), write_non_atomic: () => (data_race.push("write"), interp_ok(undefined)) } },
    borrow_tracker_tb: () => tree,
  };
  const ecx = {
    eval_context_mut() {
      return this;
    },
    eval_context_ref() {
      return this;
    },
    tcx: { tcx: {} },
    typing_env_: () => ({}),
    machine,
    check_ptr_access: () => interp_ok(undefined),
    ptr_try_get_alloc_id: () => (opts.no_alloc ? Err(0n) : Ok([ALLOC, Size.from_bytes(opts.base ?? 0), PARENT])),
    emit_diagnostic: (d: unknown) => diags.push(d),
    frame_mut: () => ({ extra: { borrow_tracker: { protected_tags: protected_frame } } }),
    get_alloc_info: () => ({ kind: opts.alloc_kind ?? "LiveData" }),
    get_tree_borrows_params: () => ({ implicit_writes: false, precise_interior_mut: opts.precise ?? true }),
    visit_freeze_sensitive: (_place: unknown, _size: Size, action: (range: AllocRange, frozen: boolean) => unknown) => {
      for (const [start, size, frozen] of opts.ranges ?? []) action(alloc_range(Size.from_bytes(start), Size.from_bytes(size)), frozen);
      return interp_ok(undefined);
    },
    get_alloc_extra: () => interp_ok(alloc_extra),
    get_alloc_mutability: () => interp_ok(opts.mutability ?? "Mut"),
  };
  const place = {
    ptr: () => ({ provenance: { $: "Wildcard" } }),
    layout: { ty: { is_freeze: () => true, toString: () => "T" } },
  };
  const reborrow = (perm: NewPermission, size = opts.size) =>
    InterpCx.prototype.tb_reborrow.call(ecx as unknown as MiriInterpCx, place as never, Size.from_bytes(size), perm, NEW_TAG);
  return { calls, data_race, diags, children, global, protected_frame, reborrow };
}

const shared = () => new NewPermission(Permission.new_frozen(), Permission.new_cell(), Permission.new_frozen(), undefined);
const unique = () => new NewPermission(Permission.new_unique(), Permission.new_unique(), Permission.new_reserved_frz(), "StrongProtector");

test("tb_reborrow, no AllocId: keeps the provenance", () => {
  const t = retag_cx({ size: 0, no_alloc: true });
  expect(t.reborrow(shared())).toEqual(interp_ok({ $: "Wildcard" }));
  expect(t.calls).toEqual([]);
  expect(t.children).toEqual([]);
  // ... and only a zero-size retag can get here.
  expect(() => retag_cx({ size: 4, no_alloc: true }).reborrow(shared())).toThrow("assertion `left == right` failed\n  left: Size(4 bytes)\n right: Size(0 bytes)");
});

test("tb_reborrow, an allocation without data: registers the protector, no tree update", () => {
  const t = retag_cx({ size: 0, alloc_kind: "Function" });
  const r = t.reborrow(unique());
  expect(r).toEqual(interp_ok({ $: "Concrete", alloc_id: ALLOC, tag: NEW_TAG }));
  expect(t.protected_frame).toEqual([[ALLOC, NEW_TAG]]);
  expect([...t.global.protected_tags]).toEqual([[NEW_TAG, "StrongProtector"]]);
  expect(t.children).toEqual([]);
});

test("tb_reborrow, precise interior mutability: per-range access and state, shifted by the base offset", () => {
  const t = retag_cx({
    size: 12,
    base: 100,
    ranges: [
      [0, 4, true],
      [4, 4, false],
      [8, 4, true],
    ],
  });
  expect(t.reborrow(shared())).toEqual(interp_ok({ $: "Concrete", alloc_id: ALLOC, tag: NEW_TAG }));
  // `Cell` has no associated access; `Frozen` a read.
  expect(t.calls).toEqual([
    { kind: "Read", range: [100, 4], cause: "Reborrow(Read)" },
    { kind: "Read", range: [108, 4], cause: "Reborrow(Read)" },
  ]);
  expect(t.children.length).toBe(1);
  const child = t.children[0]!;
  expect(child.tag).toBe(NEW_TAG);
  expect(child.base).toBe(100);
  expect(child.protected_).toBe(false);
  expect(P(child.outside)).toBe("Frz");
  expect(child.perms.map((s) => `${P(s.permission)} ${s.accessed} ${s.idempotent_foreign_access}`)).toEqual([
    "Frz true Read",
    "Cel false Write",
    "Frz true Read",
  ]);
  // `*loc = state` copies a `Copy` value: no two elements may share a mutable `LocationState`.
  expect(new Set(child.perms).size).toBe(3);
  // The outside permission is a copy, too.
  const perm = shared();
  const again = retag_cx({ size: 0 });
  again.reborrow(perm);
  expect(again.children[0]!.outside).not.toBe(perm.outside_perm);
  expect(debug_Permission(again.children[0]!.outside, PLAIN)).toBe(debug_Permission(perm.outside_perm, PLAIN));
});

test("tb_reborrow, adjacent equal ranges merge exactly when upstream's iter_mut merges them", () => {
  const t = retag_cx({
    size: 8,
    ranges: [
      [0, 4, true],
      [4, 4, true],
    ],
  });
  t.reborrow(shared());
  // `iter_mut` splits at 4 for the first range and yields the second part unmerged: two elements, two accesses.
  expect(t.calls.map((c) => c.range)).toEqual([
    [0, 4],
    [4, 4],
  ]);
  expect(t.children[0]!.perms.length).toBe(2);
});

test("tb_reborrow, without precise interior mutability: one state from the whole type", () => {
  const t = retag_cx({ size: 8, precise: false });
  t.reborrow(shared());
  expect(t.calls).toEqual([{ kind: "Read", range: [0, 8], cause: "Reborrow(Read)" }]);
  expect(t.children[0]!.perms.map((s) => P(s.permission))).toEqual(["Frz"]);
  // The data race model hears about each access that touches bytes.
  expect(t.data_race).toEqual(["read"]);
});

test("tb_reborrow, an implicit write: protector, write access, and UB on a read-only allocation", () => {
  const t = retag_cx({ size: 4, ranges: [[0, 4, true]] });
  t.reborrow(unique());
  expect(t.calls).toEqual([{ kind: "Write", range: [0, 4], cause: "Reborrow(Write)" }]);
  expect(t.children[0]!.protected_).toBe(true);
  expect(t.children[0]!.perms.map((s) => `${P(s.permission)} ${s.accessed} ${s.idempotent_foreign_access}`)).toEqual(["Unq true None"]);
  expect(t.data_race).toEqual(["write"]);

  const ro = retag_cx({ size: 4, ranges: [[0, 4, true]], mutability: "Not" });
  const r = ro.reborrow(unique());
  expect(r.$).toBe("Err");
  expect(ro.calls).toEqual([]);
  expect(ro.children).toEqual([]);
});

test("tb_reborrow, an untracked tag emits no diagnostic", () => {
  // The tracked-tag text needs `display_Ty`, i.e. a real `TyCtxt`: end-to-end, with `-Zmiri-track-pointer-tag` (handoff).
  const t = retag_cx({ size: 4, ranges: [[0, 4, true]] });
  t.reborrow(shared());
  expect(t.diags).toEqual([]);
});

test("Tree's methods are installed on the class of tree.gen.ts", () => {
  expect(typeof Tree.new_allocation).toBe("function");
  for (const name of ["before_memory_access", "before_memory_deallocation", "release_protector", "expose_tag", "update_exposure_for_protector_release", "verify_wildcard_consistency"] as const) {
    expect(String(Tree.prototype[name]).includes("unported(")).toBe(false);
  }
});

test("Tree::new_allocation / before_memory_* / release_protector forward to tb-b's Tree with upstream's arguments", () => {
  const span = 77;
  const global = {} as GlobalStateInner;
  const machine = { borrow_tracker: global, current_user_relevant_span: () => span } as unknown as MiriMachine;
  const seen: unknown[][] = [];
  const tree = Object.create(Tree.prototype) as Tree;
  Object.defineProperties(tree, {
    perform_access: { value: (...a: unknown[]) => (seen.push(["perform_access", ...a]), interp_ok(undefined)) },
    dealloc: { value: (...a: unknown[]) => (seen.push(["dealloc", ...a]), interp_ok(undefined)) },
    perform_protector_end_access: { value: (...a: unknown[]) => (seen.push(["perform_protector_end_access", ...a]), interp_ok(undefined)) },
    update_exposure_for_protector_release: { value: (...a: unknown[]) => seen.push(["update_exposure_for_protector_release", ...a]) },
  });
  const range = alloc_range(Size.from_bytes(1), Size.from_bytes(2));
  tree.before_memory_access("Write", ALLOC, PARENT, range, machine);
  expect(seen.pop()).toEqual(["perform_access", PARENT, range, "Write", { $: "Explicit", _0: "Write" }, global, ALLOC, span]);
  tree.before_memory_deallocation(ALLOC, PARENT, Size.from_bytes(8), machine);
  const d = seen.pop()!;
  expect(d[0]).toBe("dealloc");
  expect((d[2] as AllocRange).start.bytes()).toBe(0);
  expect((d[2] as AllocRange).size.bytes()).toBe(8);
  tree.release_protector(machine, global, NEW_TAG, ALLOC);
  expect(seen.splice(0)).toEqual([
    ["perform_protector_end_access", NEW_TAG, global, ALLOC, span],
    ["update_exposure_for_protector_release", NEW_TAG],
  ]);
  // A failing end access does not touch the exposure.
  const failing = Object.create(Tree.prototype) as Tree;
  const fail = Err("ub");
  Object.defineProperties(failing, {
    perform_protector_end_access: { value: () => fail },
    update_exposure_for_protector_release: { value: () => seen.push(["no"]) },
  });
  expect(failing.release_protector(machine, global, NEW_TAG, ALLOC) as unknown).toBe(fail);
  expect(seen).toEqual([]);
});
