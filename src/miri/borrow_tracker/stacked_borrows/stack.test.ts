// Unit tests of the Stacked Borrows stacks (lane miri-sb): grant / access / dealloc sequences on hand-built stacks with the
// stack outcome upstream's rules give, the `stack-cache` paths against a cache-free linear search (upstream's own
// `verify_cache_consistency` after every step), wildcard / unknown-bottom handling, protectors, tracked tags, and the
// byte-exact history texts (`get_logs_relevant_to`, incl. the split creation event of a freeze-sensitive retag).
// Upstream stack.rs / mod.rs / diagnostics.rs have no `#[cfg(test)]` tests.
//
// The machine is a stand-in with the three `MiriMachine` methods the diagnostics call (`current_user_relevant_span`,
// `caller_span`, `emit_diagnostic`; lanes miri-eval / miri-driver). Error paths return the real
// `Err(MachineStop(TerminationInfo::StackedBorrowsUb))` (lane miri-wire: miri-alloc's `Display for AccessKind` and
// miri-driver's `TerminationInfo_into_machine_stop` are wired in); `sb_ub` asserts it and returns the message.
import { expect, test } from "bun:test";
import { BorrowTrackerMethod, type BorTag, GlobalStateInner, type ProtectorKind } from "../mod.ts";
import { AllocHistory, type DiagnosticCx, DiagnosticCxBuilder, error_cause, RetagInfo, type RetagCause } from "./diagnostics.ts";
import { debug_Item, Item, type Permission } from "./item.ts";
import { Permission_grants, Stack_access, Stack_dealloc, Stack_grant } from "./mod.ts";
import { Stack } from "./stack.ts";
import { type MiriMachine, type ProvenanceExtra } from "../../machine.ts";
import { type NonHaltingDiagnostic, TerminationInfoStop } from "../../diagnostics.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { alloc_range } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";

const T = (n: number) => n as BorTag;
const C = (n: number): ProvenanceExtra => ({ $: "Concrete", _0: T(n) });
const WILDCARD: ProvenanceExtra = { $: "Wildcard" };
const SPAN = 11 as Span;
const CALLER = 22 as Span;
const ALLOC = 7 as AllocId;

interface Cx {
  stack: Stack;
  history: AllocHistory;
  global: GlobalStateInner;
  exposed: Set<BorTag>;
  machine: MiriMachine;
  diags: NonHaltingDiagnostic[];
}

function cx(root: Permission, protected_tags: [number, ProtectorKind][] = [], tracked: number[] = []): Cx {
  const diags: NonHaltingDiagnostic[] = [];
  const machine = {
    current_user_relevant_span: () => SPAN,
    caller_span: () => CALLER,
    emit_diagnostic: (d: NonHaltingDiagnostic) => void diags.push(d),
  } as unknown as MiriMachine;
  const item = Item.new(T(1), root, false);
  const global = new GlobalStateInner(
    BorrowTrackerMethod.StackedBorrows,
    "Default",
    T(100),
    new Map(),
    new Map(protected_tags.map(([t, k]) => [T(t), k])),
    new Set(tracked.map(T)),
  );
  return { stack: Stack.new(item), history: AllocHistory.new(ALLOC, Item.new(T(1), root, false), machine), global, exposed: new Set(), machine, diags };
}

const RANGE = alloc_range(Size.from_bytes(0), Size.from_bytes(4));

function dcx_of(c: Cx, b: DiagnosticCxBuilder, offset = 0): DiagnosticCx {
  return b.build(c.history, Size.from_bytes(offset));
}

/** A retag as `sb_reborrow` does it for one location: log the creation, then grant through a second builder. */
function retag(c: Cx, tag: number, from: ProvenanceExtra, perm: Permission, access: "Read" | "Write" | undefined, protect = false, cause: RetagCause = "Normal") {
  const info = new RetagInfo(cause);
  dcx_of(c, DiagnosticCxBuilder.retag(c.machine, info, T(tag), from, RANGE)).log_creation();
  const d = dcx_of(c, DiagnosticCxBuilder.retag(c.machine, info, T(tag), from, RANGE));
  return Stack_grant(c.stack, from, Item.new(T(tag), perm, protect), access, c.global, d, c.exposed);
}

function read(c: Cx, tag: ProvenanceExtra) {
  return Stack_access(c.stack, "Read", tag, c.global, dcx_of(c, DiagnosticCxBuilder.read(c.machine, tag, RANGE)), c.exposed);
}
function write(c: Cx, tag: ProvenanceExtra) {
  return Stack_access(c.stack, "Write", tag, c.global, dcx_of(c, DiagnosticCxBuilder.write(c.machine, tag, RANGE)), c.exposed);
}

/** Asserts `Err(MachineStop(TerminationInfo::StackedBorrowsUb { .. }))` and returns its `msg`. */
function sb_ub(r: InterpResult<unknown>): string {
  if (r.$ !== "Err") throw new Error("expected a Stacked Borrows error");
  const kind = r._0.kind();
  if (kind.$ !== "MachineStop") throw new Error(`expected MachineStop, got ${kind.$}`);
  const info = TerminationInfoStop.downcast_ref(kind._0);
  if (info?.$ !== "StackedBorrowsUb") throw new Error(`expected StackedBorrowsUb, got ${info?.$}`);
  return info.msg;
}

const show = (s: Stack) => s.borrows.map((i) => debug_Item(i, PLAIN)).join(" ");
const ok = (r: { $: string }) => expect(r.$).toBe("Ok");

test("Permission::grants", () => {
  expect(Permission_grants("Unique", "Write")).toBe(true);
  expect(Permission_grants("SharedReadWrite", "Write")).toBe(true);
  expect(Permission_grants("SharedReadOnly", "Write")).toBe(false);
  expect(Permission_grants("SharedReadOnly", "Read")).toBe(true);
  expect(Permission_grants("Disabled", "Read")).toBe(false);
});

test("Stack::new and AllocHistory::new copy the root Item (stack.rs:342, diagnostics.rs:217: `Item` is `Copy`)", () => {
  const machine = { current_user_relevant_span: () => SPAN } as unknown as MiriMachine;
  const item = Item.new(T(1), "Unique", false);
  const stack = Stack.new(item);
  const history = AllocHistory.new(ALLOC, item, machine);
  // the caller keeps its copy: changing it touches neither the stack nor the history's root
  item.set_permission("Disabled");
  expect(show(stack)).toBe("[Unique for <1>]");
  expect(debug_Item(history.root[0], PLAIN)).toBe("[Unique for <1>]");
  expect(stack.borrows[0]).not.toBe(history.root[0]);
});

test("grant / access sequence on a heap location", () => {
  const c = cx("SharedReadWrite");
  ok(retag(c, 2, C(1), "Unique", "Write"));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Unique for <2>]");
  ok(retag(c, 3, C(2), "SharedReadOnly", "Read"));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Unique for <2>] [SharedReadOnly for <3>]");
  // An SRW without an access goes just above the write-compatible items of its parent (below the SRO).
  ok(retag(c, 4, C(2), "SharedReadWrite", undefined));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Unique for <2>] [SharedReadWrite for <4>] [SharedReadOnly for <3>]");
  ok(read(c, C(3)));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Unique for <2>] [SharedReadWrite for <4>] [SharedReadOnly for <3>]");
  // A write through <4> pops the SharedReadOnly above its SRW group.
  ok(write(c, C(4)));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Unique for <2>] [SharedReadWrite for <4>]");
  // A read through <1> disables (not pops) the Unique above it.
  ok(read(c, C(1)));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>] [Disabled for <2>] [SharedReadWrite for <4>]");
  expect(c.stack.find_granting("Read", C(2), c.exposed).$).toBe("Err");
  expect(error_cause(c.stack, C(2))).toBe(", but that tag does not exist in the borrow stack for this location");
  // A write through <1> pops everything above its SRW group (the Disabled ends it).
  ok(write(c, C(1)));
  expect(show(c.stack)).toBe("[SharedReadWrite for <1>]");
  expect(c.history.invalidations.map((i) => i.tag)).toEqual([T(3), T(2), T(4), T(2)]);
  expect(c.stack.unique_range).toEqual({ start: 0, end: 0 });
});

test("error_cause texts", () => {
  const c = cx("Unique");
  ok(retag(c, 2, C(1), "SharedReadOnly", "Read"));
  expect(error_cause(c.stack, C(2))).toBe(", but that tag only grants SharedReadOnly permission for this location");
  expect(error_cause(c.stack, C(9))).toBe(", but that tag does not exist in the borrow stack for this location");
  expect(error_cause(c.stack, WILDCARD)).toBe(", but no exposed tags have suitable permission in the borrow stack for this location");
  // The failing write itself (diagnostics.rs:405 `access_error`, with `error_cause`).
  expect(sb_ub(write(c, C(2)))).toBe(
    "attempting a write access using <2> at alloc7[0x0], but that tag only grants SharedReadOnly permission for this location",
  );
  expect(show(c.stack)).toBe("[Unique for <1>] [SharedReadOnly for <2>]");
});

test("history texts are byte-exact (creation, retag invalidation, FnEntry, root, protector)", () => {
  const c = cx("SharedReadWrite");
  ok(retag(c, 2, C(1), "Unique", "Write", true, "FnEntry"));
  ok(retag(c, 3, C(1), "Unique", "Write")); // pops <2> (unprotected in `global`), a Unique retag
  const d = dcx_of(c, DiagnosticCxBuilder.read(c.machine, C(2), RANGE));
  const h2 = d.get_logs_relevant_to(T(2), undefined)!;
  expect(h2.created).toEqual(["<2> was created by a Unique retag at offsets [0x0..0x4]", SPAN]);
  expect(h2.invalidated).toEqual(["<2> was later invalidated at offsets [0x0..0x4] by a Unique retag", SPAN]);
  expect(h2.protected).toBeUndefined();
  const h1 = d.get_logs_relevant_to(T(1), undefined)!;
  expect(h1.created).toEqual(["<1> was created here, as the root tag for alloc7", SPAN]);
  expect(d.get_logs_relevant_to(T(42), undefined)).toBeUndefined();

  // A FnEntry retag that invalidates: the span is the caller's and the text says "inside this call".
  ok(retag(c, 4, C(1), "Unique", "Write", false, "FnEntry"));
  const h3 = d.get_logs_relevant_to(T(3), undefined)!;
  expect(h3.invalidated).toEqual(["<3> was later invalidated at offsets [0x0..0x4] by a Unique function-entry retag inside this call", CALLER]);

  // log_protector + the protected line.
  const b = DiagnosticCxBuilder.retag(c.machine, new RetagInfo("FnEntry"), T(5), C(4), RANGE);
  const dp = dcx_of(c, b);
  dp.log_creation();
  dp.log_protector();
  expect(d.get_logs_relevant_to(T(4), T(5))!.protected).toEqual(["<5> is this argument", SPAN]);

  expect(["Normal", "FnEntry", "InPlaceFnPassing", "TwoPhase"].map((x) => new RetagInfo(x as RetagCause).summary())).toEqual([
    "retag",
    "function-entry retag",
    "in-place function argument/return passing protection",
    "two-phase retag",
  ]);
});

test("a freeze-sensitive retag splits its creation event (upstream's ranges, size = previous end)", () => {
  const c = cx("SharedReadWrite");
  const r8 = alloc_range(Size.from_bytes(0), Size.from_bytes(8));
  const info = new RetagInfo("Normal");
  dcx_of(c, DiagnosticCxBuilder.retag(c.machine, info, T(5), C(1), r8)).log_creation();
  const b = DiagnosticCxBuilder.retag(c.machine, info, T(5), C(1), r8);
  b.build(c.history, Size.from_bytes(0)).start_grant("SharedReadOnly");
  b.build(c.history, Size.from_bytes(4)).start_grant("SharedReadWrite");
  const msgs = c.history.creations.map((e) => e.generate_diagnostic()[0]);
  expect(msgs).toEqual([
    "<5> was created by a SharedReadOnly retag at offsets [0x0..0x4]",
    "<5> was created by a SharedReadWrite retag at offsets [0x4..0xc]",
  ]);
  // The offset picks the matching event.
  expect(dcx_of(c, DiagnosticCxBuilder.read(c.machine, C(5), r8), 4).get_logs_relevant_to(T(5), undefined)!.created[0]).toBe(msgs[1]!);
  expect(dcx_of(c, DiagnosticCxBuilder.read(c.machine, C(5), r8), 2).get_logs_relevant_to(T(5), undefined)!.created[0]).toBe(msgs[0]!);
});

test("zero-size creation text", () => {
  const c = cx("SharedReadWrite");
  const r0 = alloc_range(Size.from_bytes(16), Size.ZERO);
  dcx_of(c, DiagnosticCxBuilder.retag(c.machine, new RetagInfo("Normal"), T(6), C(1), r0)).log_creation();
  expect(c.history.creations[0]!.generate_diagnostic()[0]).toBe(
    "<6> would have been created here, but this is a zero-size retag ([0x10..0x10]) so the tag in question does not exist anywhere",
  );
});

test("wildcard accesses collapse the stack into an unknown bottom", () => {
  const c = cx("SharedReadWrite");
  ok(retag(c, 2, C(1), "Unique", "Write"));
  ok(retag(c, 3, C(2), "SharedReadWrite", undefined));
  c.exposed.add(T(3));
  ok(write(c, WILDCARD));
  expect(c.stack.borrows.length).toBe(0);
  expect(c.stack.unknown_bottom_()).toBe(T(4));
  expect(c.stack.find_granting("Read", C(3), c.exposed)).toEqual({ $: "Ok", _0: undefined });
  expect(c.stack.find_granting("Read", C(4), c.exposed).$).toBe("Err");
  // The provenance GC on a collapsed stack: `retain`'s `truncate(1)` leaves it empty, with no hole (miri-perf O1).
  c.stack.retain(new Set());
  expect(c.stack.borrows.length).toBe(0);
  // A SRW retag from the unknown part forgets everything up to `next_ptr_tag`.
  ok(retag(c, 7, C(2), "SharedReadWrite", undefined));
  expect(c.stack.unknown_bottom_()).toBe(T(100));
  // A Unique retag on top of the unknown part: access, then push.
  ok(retag(c, 8, C(5), "Unique", "Write"));
  expect(show(c.stack)).toBe("[Unique for <8>]");
});

test("protectors: strong ones stop a conflicting write, weak ones allow dealloc through their own tag", () => {
  const strong = cx("SharedReadWrite", [[2, "StrongProtector"]]);
  ok(retag(strong, 2, C(1), "Unique", "Write", true));
  // protector_error (diagnostics.rs:435)
  expect(sb_ub(write(strong, C(1)))).toBe(
    "not granting access to tag <1> because that would remove [Unique for <2>] which is strongly protected",
  );
  const weak = cx("SharedReadWrite", [[2, "WeakProtector"]]);
  ok(retag(weak, 2, C(1), "Unique", "Write", true));
  ok(Stack_dealloc(weak.stack, C(2), weak.global, dcx_of(weak, DiagnosticCxBuilder.dealloc(weak.machine, C(2))), weak.exposed));
  const weak2 = cx("SharedReadWrite", [[2, "WeakProtector"]]);
  ok(retag(weak2, 2, C(1), "Unique", "Write", true));
  // Deallocating through the parent pops the weakly protected item: a Conflict, UB.
  // (protector_error of a `Dealloc` operation, diagnostics.rs:431)
  expect(sb_ub(Stack_dealloc(weak2.stack, C(1), weak2.global, dcx_of(weak2, DiagnosticCxBuilder.dealloc(weak2.machine, C(1))), weak2.exposed))).toBe(
    "deallocating while item [Unique for <2>] is weakly protected",
  );
});

test("tracked tags report their popping", () => {
  const c = cx("SharedReadWrite", [], [3]);
  ok(retag(c, 2, C(1), "SharedReadWrite", "Write"));
  ok(retag(c, 3, C(2), "SharedReadOnly", "Read"));
  ok(write(c, C(2)));
  expect(c.diags).toEqual([{ $: "PoppedPointerTag", _0: Item.new(T(3), "SharedReadOnly", false), _1: " due to Write access for <2>" }]);
  ok(retag(c, 4, C(1), "SharedReadOnly", "Read"));
  c.global.tracked_pointer_tags.add(T(4));
  ok(retag(c, 5, C(1), "Unique", "Write"));
  expect(c.diags[1]).toEqual({ $: "PoppedPointerTag", _0: Item.new(T(4), "SharedReadOnly", false), _1: " due to Unique retag from <1> (that retag created <5>)" });
});

// ---- the stack cache against a cache-free model ----

/** A deterministic xorshift PRNG. */
function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}

/** `find_granting_tagged` without the cache: the linear search of stack.rs:245. */
function linear(s: Stack, access: "Read" | "Write", tag: BorTag): number | undefined {
  for (let i = s.borrows.length - 1; i >= 0; i--) {
    const it = s.borrows[i]!;
    if (it.tag() === tag && Permission_grants(it.perm(), access)) return i;
  }
  return undefined;
}

test("a long SRW group uses the cache (> CACHE_LEN items) and agrees with the linear search", () => {
  const c = cx("SharedReadWrite");
  for (let t = 2; t < 60; t++) ok(retag(c, t, C(t - 1), "SharedReadWrite", "Write"));
  expect(c.stack.len()).toBe(59);
  for (const t of [58, 57, 1, 30, 30, 2, 59, 45, 45, 44]) {
    expect(c.stack.find_granting_tagged("Write", T(t))).toBe(linear(c.stack, "Write", T(t)));
    c.stack.verify_cache_consistency();
  }
  expect(c.stack.find_granting_cache("Write", T(30))).toBe(29);
});

test("random grant / access / GC sequences keep the cache consistent and equal to the linear search", () => {
  const PERMS: Permission[] = ["Unique", "SharedReadWrite", "SharedReadOnly"];
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = prng(seed * 7919);
    const c = cx(seed % 2 === 0 ? "Unique" : "SharedReadWrite");
    let next = 2;
    for (let step = 0; step < 400; step++) {
      const r = rnd();
      const live = c.stack.borrows.map((i) => i.tag());
      const pick = (): number => (live.length > 0 && rnd() < 0.9 ? live[Math.floor(rnd() * live.length)]! : 1 + Math.floor(rnd() * next));
      let model_ok: boolean;
      let run: () => InterpResult<unknown>;
      if (r < 0.55) {
        const from = pick();
        const perm = PERMS[Math.floor(rnd() * 3)]!;
        const access = perm === "Unique" ? "Write" : perm === "SharedReadOnly" ? "Read" : rnd() < 0.5 ? "Write" : undefined;
        model_ok = linear(c.stack, access ?? "Write", T(from)) !== undefined;
        const tag = next++;
        run = () => retag(c, tag, C(from), perm, access);
      } else if (r < 0.8) {
        const tag = pick();
        model_ok = linear(c.stack, "Read", T(tag)) !== undefined;
        run = () => read(c, C(tag));
      } else if (r < 0.97) {
        const tag = pick();
        model_ok = linear(c.stack, "Write", T(tag)) !== undefined;
        run = () => write(c, C(tag));
      } else {
        const keep = new Set(live.filter(() => rnd() < 0.6));
        c.stack.retain(keep);
        c.stack.verify_cache_consistency();
        continue;
      }
      if (model_ok) {
        ok(run());
      } else {
        const before = show(c.stack);
        sb_ub(run());
        expect(show(c.stack)).toBe(before);
      }
      c.stack.verify_cache_consistency();
      for (const t of [pick(), pick()]) {
        for (const a of ["Read", "Write"] as const) {
          expect(c.stack.find_granting_tagged(a, T(t))).toBe(linear(c.stack, a, T(t)));
        }
      }
      c.stack.verify_cache_consistency();
    }
  }
});
