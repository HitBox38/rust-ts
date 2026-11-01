// Unit tests of lane miri-machine (src/miri/machine.ts, port of src/tools/miri/src/machine.rs): the self-contained parts of
// the file, with a stub interpreter (an `InterpCx` prototype object whose `machine` is a bare `MiriMachine` object and
// whose calls into other wave-36 lanes are own properties). Our own test, not an upstream mirror.
import { expect, test } from "bun:test";
import "./lib.ts";
import { Align, Size } from "../rustc_abi/lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { alloc_range, type AllocId, CtfeProvenance_from_AllocId, type InterpResult, interp_ok, Pointer } from "../rustc_middle/mir/interpret/mod.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Panic, Unported } from "../std/panic.ts";
import { BorTag } from "./borrow_tracker/mod.ts";
import type { SyncObj } from "./concurrency/sync.ts";
import type { VisitProvenanceImpl, VisitWith } from "./provenance_gc.ts";
import {
  callback,
  display_MiriMemoryKind,
  MayLeak_MiriMemoryKind,
  type MiriInterpCx,
  MiriMachine,
  MiriMemoryKind,
  new_sync_objs,
  PrimitiveLayouts,
  type Provenance,
  SIGRTMAX,
  SIGRTMIN,
} from "./machine.ts";
import { FrameState as data_race_FrameState } from "./concurrency/data_race.ts";
import type { StrictPointer } from "./lib.ts";

const KINDS: MiriMemoryKind[] = ["Rust", "Miri", "C", "WinHeap", "WinLocal", "Machine", "Runtime", "Global", "ExternStatic", "Tls", "Mmap", "SocketAddress"];

/** A bare `MiriMachine` object with the given fields (the constructor needs a full config). */
function machine(fields: Partial<MiriMachine>): MiriMachine {
  return Object.assign(Object.create(MiriMachine.prototype) as MiriMachine, fields);
}
/** A stub interpreter over `m`; `own` overrides `InterpCx` methods (other lanes' stubs). */
function ecx(m: MiriMachine, own: Record<string, unknown> = {}): MiriInterpCx {
  return Object.assign(Object.create(InterpCx.prototype) as MiriInterpCx, { machine: m }, own);
}
function catch_err(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic || e instanceof Unported) return `${e.constructor.name}: ${e.message}`;
    throw e;
  }
  return "no error";
}

test("constants (machine.rs:49-58)", () => {
  expect([SIGRTMIN, SIGRTMAX]).toEqual([34, 42]);
});

test("MiriMemoryKind: Display, MayLeak, should_save_allocation_span (machine.rs:220-262)", () => {
  expect(KINDS.map((k) => display_MiriMemoryKind(k))).toEqual([
    "Rust heap",
    "Miri bare-metal heap",
    "C heap",
    "Windows heap",
    "Windows local memory",
    "machine-managed memory",
    "language runtime memory",
    "global (static or const)",
    "extern static",
    "thread-local static",
    "mmap",
    "socket address",
  ]);
  expect(KINDS.filter((k) => MayLeak_MiriMemoryKind.may_leak(k))).toEqual(["Machine", "Global", "ExternStatic", "Tls", "Mmap", "SocketAddress"]);
  expect(KINDS.filter((k) => MiriMemoryKind.should_save_allocation_span(k))).toEqual(["Rust", "Miri", "C", "WinHeap", "WinLocal", "Mmap"]);
});

test("PrimitiveLayouts::uint / int (machine.rs:484, :495)", () => {
  const names = ["unit", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "bool", "unit_ptr_mut", "unit_ptr_const", "void_ptr_mut", "void_ptr_const", "fn_ptr"];
  const l = new PrimitiveLayouts(...(names.map((n) => n as unknown as TyAndLayout) as ConstructorParameters<typeof PrimitiveLayouts>));
  const sizes = [1, 2, 4, 8, 16, 3, 0].map((b) => Size.from_bytes(b));
  expect(sizes.map((s) => l.uint(s) as unknown as string | undefined)).toEqual(["u8", "u16", "u32", "u64", "u128", undefined, undefined]);
  expect(sizes.map((s) => l.int(s) as unknown as string | undefined)).toEqual(["i8", "i16", "i32", "i64", "i128", undefined, undefined]);
});

test("simple accessors: communicate, page_align, allocation spans, validity / alignment switches", () => {
  const span_a = 11 as never;
  const span_b = 12 as never;
  const m = machine({
    isolated_op: { $: "Reject", _0: "Abort" },
    page_size: 4096n,
    allocation_spans: new Map([
      [1 as AllocId, [span_a, undefined]],
      [2 as AllocId, [span_a, span_b]],
    ]),
    validation: "Shallow",
    check_alignment: "Symbolic",
  });
  expect(m.communicate()).toBe(false);
  expect(machine({ isolated_op: { $: "Allow" } }).communicate()).toBe(true);
  expect(m.page_align().bytes()).toBe(4096);
  expect([m.allocated_span(1 as AllocId), m.deallocated_span(1 as AllocId), m.deallocated_span(2 as AllocId), m.allocated_span(3 as AllocId)]).toEqual([
    span_a,
    undefined,
    span_b,
    undefined,
  ]);
  const e = ecx(m);
  expect([m.enforce_validity(e, undefined as never), m.enforce_validity_recursively(e, undefined as never), m.enforce_alignment(e)]).toEqual([true, false, true]);
  const deep = ecx(machine({ validation: "Deep", check_alignment: "None" }));
  expect([m.enforce_validity_recursively(deep, undefined as never), m.enforce_alignment(deep)]).toEqual([true, false]);
  m.handle_abnormal_termination();
  expect(m.profiler).toBeUndefined();
});

test("alignment_check: symbolic alignment (machine.rs:1157)", () => {
  const A = (n: number): Align => {
    const r = Align.from_bytes(n);
    if (r.$ === "Err") throw new Error("bad align");
    return r._0;
  };
  const id = 7 as AllocId;
  const m = machine({ check_alignment: "Symbolic", symbolic_alignment: new Map([[id, [Size.from_bytes(2), A(8)]]]) });
  const e = ecx(m);
  const check = (alloc_align: number, kind: "LiveData" | "Function", offset: number, align: number, alloc_id = id) => {
    const r = m.alignment_check(e, alloc_id, A(alloc_align), kind, Size.from_bytes(offset), A(align));
    return r === undefined ? undefined : [r.has.bytes(), r.required.bytes()];
  };
  // promised (offset 2, align 8)
  expect(check(1, "LiveData", 10, 8)).toBeUndefined(); // distance 8
  expect(check(1, "LiveData", 6, 4)).toBeUndefined(); // distance 4
  expect(check(1, "LiveData", 4, 4)).toEqual([2, 4]); // distance 2
  expect(check(1, "LiveData", 1, 2)).toEqual([1, 2]); // distance wraps: 2^64 - 1
  expect(check(1, "LiveData", 2, 16)).toEqual([8, 16]); // promised alignment too small
  expect(check(1, "Function", 4, 4)).toBeUndefined(); // not live data
  // not tracked: (0, alloc_align)
  expect(check(4, "LiveData", 6, 4, 8 as AllocId)).toEqual([2, 4]);
  expect(check(4, "LiveData", 8, 4, 8 as AllocId)).toBeUndefined();
  // other modes use the built-in check
  const m2 = machine({ check_alignment: "Int", symbolic_alignment: new Map() });
  expect(m2.alignment_check(ecx(m2), id, A(1), "LiveData", Size.from_bytes(1), A(16))).toBeUndefined();
});

test("ptr_get_alloc: the extra provenance (machine.rs:1654)", () => {
  const conc: Provenance = { $: "Concrete", alloc_id: 3 as AllocId, tag: 9 as BorTag };
  let seen: [StrictPointer, bigint] | undefined;
  const m = machine({});
  const e = ecx(m, {
    ptr_get_alloc(ptr: StrictPointer, size: bigint) {
      seen = [ptr, size];
      return size < 0n ? undefined : ([4 as AllocId, Size.from_bytes(16)] as [AllocId, Size]);
    },
  });
  const p = Pointer.new(conc, Size.from_bytes(0x1010));
  const r = m.ptr_get_alloc(e, p, 8n);
  expect(seen).toEqual([p, 8n]);
  expect(r && [r[0], r[1].bytes(), r[2]]).toEqual([4 as AllocId, 16, { $: "Concrete", _0: 9 as BorTag }]);
  const w = m.ptr_get_alloc(e, Pointer.new<Provenance>({ $: "Wildcard" }, Size.from_bytes(0x1010)), 1n);
  expect(w?.[2]).toEqual({ $: "Wildcard" });
  expect(m.ptr_get_alloc(e, p, -1n)).toBeUndefined();
});

test("adjust_alloc_root_pointer: root tag without a borrow tracker (machine.rs:1597)", () => {
  let seen: unknown[] = [];
  const m = machine({ borrow_tracker: undefined });
  const e = ecx(m, {
    adjust_alloc_root_pointer(...args: unknown[]) {
      seen = args;
      return interp_ok("adjusted");
    },
  });
  const ptr = Pointer.new(CtfeProvenance_from_AllocId(5 as AllocId), Size.ZERO);
  const hook = m.adjust_alloc_root_pointer as unknown as (ecx: MiriInterpCx, ptr: unknown, kind: unknown) => InterpResult<unknown>;
  const r = hook.call(m, e, ptr, { $: "Machine", _0: "Global" });
  expect(r).toEqual(interp_ok("adjusted"));
  expect(seen).toEqual([ptr, BorTag.default(), { $: "Machine", _0: "Global" }]);
  expect(catch_err(() => hook.call(m, e, ptr, undefined))).toBe("Panic: we set our GLOBAL_KIND so this cannot be None");
});

test("init_local_allocation rejects global memory (machine.rs:1586)", () => {
  const m = machine({});
  expect(catch_err(() => m.init_local_allocation(ecx(m), 1 as AllocId, { $: "Machine", _0: "Global" }, Size.ZERO, Align.ONE))).toBe(
    "Panic: assertion failed: kind != MiriMemoryKind::Global.into()",
  );
});

test("before_memory_read / write: sync objects in key order, deleted on write (machine.rs:1695, :1736)", () => {
  const log: string[] = [];
  const obj = (name: string, del: boolean): SyncObj => ({
    on_access(kind) {
      log.push(`${name}:${kind}`);
      return interp_ok(undefined);
    },
    delete_on_write: () => del,
  });
  const sync_objs = new_sync_objs();
  for (const [k, v] of [
    [Size.from_bytes(12), obj("c12", true)],
    [Size.from_bytes(4), obj("a4", false)],
    [Size.from_bytes(8), obj("b8", true)],
    [Size.from_bytes(16), obj("d16", true)],
  ] as const) {
    sync_objs.set(k, v);
  }
  const extra = { borrow_tracker: undefined, data_race: { $: "None" }, backtrace: undefined, sync_objs } as never;
  const m = machine({ track_alloc_accesses: false, tracked_alloc_ids: new Set(), data_race: { $: "None" } });
  const ptr = Pointer.new<Provenance | undefined>(undefined, Size.ZERO);
  const range = alloc_range(Size.from_bytes(4), Size.from_bytes(12)); // [4, 16)
  expect(m.before_memory_read(undefined as never, m, extra, ptr, [1 as AllocId, { $: "Wildcard" }], range)).toEqual(interp_ok(undefined));
  expect(log).toEqual(["a4:Read", "b8:Read", "c12:Read"]);
  log.length = 0;
  expect(m.before_memory_write(undefined as never, m, extra, ptr, [1 as AllocId, { $: "Wildcard" }], range)).toEqual(interp_ok(undefined));
  expect(log).toEqual(["a4:Write", "b8:Write", "c12:Write"]);
  expect([...sync_objs.keys()].map((k) => k.bytes()).sort((a, b) => a - b)).toEqual([4, 16]);
});

test("cached_union_data_range caches per type; get_default_alloc_params (machine.rs:2110, :2118)", () => {
  const m = machine({ union_data_ranges: new Map(), allocator: undefined });
  const e = ecx(m);
  let calls = 0;
  const ty = {} as never;
  const compute = () => {
    calls++;
    return { v: [] } as never;
  };
  const r1 = m.cached_union_data_range(e, ty, compute);
  const r2 = m.cached_union_data_range(e, ty, compute);
  expect(r1).toBe(r2);
  expect(calls).toBe(1);
  expect(m.get_default_alloc_params()).toEqual({ $: "Global" });
  expect(m.enter_trace_span(() => 1)).toBeUndefined();
});

test("before_terminator: block counter, GC interval, preemption point, clock tick (machine.rs:1927)", () => {
  const log: string[] = [];
  const m = machine({
    basic_block_count: 0,
    since_gc: 0,
    gc_interval: 2,
    report_progress: undefined,
    blocking_io: { run_gc: () => log.push("io_gc") } as never,
    monotonic_clock: { tick: () => log.push("tick") } as never,
  });
  const e = ecx(m, {
    run_provenance_gc: () => log.push("gc"),
    maybe_preempt_active_thread: () => log.push("preempt"),
  });
  for (let i = 0; i < 3; i++) expect(m.before_terminator(e)).toEqual(interp_ok(undefined));
  expect([m.basic_block_count, m.since_gc]).toEqual([3, 1]);
  expect(log).toEqual(["preempt", "tick", "gc", "io_gc", "preempt", "tick", "preempt", "tick"]);
});

test("float_fuse_mul_add without float non-determinism draws nothing; the anonymous-global salt (machine.rs:1450, :2069)", () => {
  const m = machine({ float_nondet: false, rng: undefined as never });
  expect(m.float_fuse_mul_add(ecx(m))).toBe(false);
  // Non-functions are never unique: a draw in 0..ADDRS_PER_ANON_GLOBAL (32) from the seeded generator.
  const { StdRng } = require("../vendor/rand/rngs/std.ts") as typeof import("../vendor/rand/rngs/std.ts");
  const m2 = machine({ rng: StdRng.seed_from_u64(0n) });
  const salts = Array.from({ length: 64 }, () => m2.get_global_alloc_salt(ecx(m2), undefined));
  expect(salts.every((s) => Number.isInteger(s) && s >= 0 && s < 32)).toBe(true);
  const m3 = machine({ rng: StdRng.seed_from_u64(0n) });
  expect(Array.from({ length: 64 }, () => m3.get_global_alloc_salt(ecx(m3), undefined))).toEqual(salts);
});

test("callback!: one capture list gives the visit (in capture order) and the body's values; call consumes it (machine.rs:2171)", () => {
  const visited: [AllocId | undefined, BorTag | undefined][] = [];
  const visit_id: VisitProvenanceImpl<AllocId> = { visit_provenance: (id, visit) => visit(id, undefined) };
  const visit_tag: VisitProvenanceImpl<BorTag> = { visit_provenance: (tag, visit) => visit(undefined, tag) };
  const no_provenance: VisitProvenanceImpl<number> = { visit_provenance: () => {} };
  const seen: unknown[] = [];
  const cb = callback<{ id: AllocId; n: number; tag: BorTag }, string>(
    { id: [5 as AllocId, visit_id], n: [2, no_provenance], tag: [9 as BorTag, visit_tag] },
    (_this, arg, { id, n, tag }) => interp_ok(void seen.push(id, n, tag, arg)),
  );
  const visit: VisitWith = (a, t) => visited.push([a, t]);
  // `VisitProvenance::visit_provenance(&self.$name, _visit)` for every capture, in capture order
  cb.visit_provenance(visit);
  expect(visited).toEqual([
    [5 as AllocId, undefined],
    [undefined, 9 as BorTag],
  ]);
  // `let Callback { $($name,)* .. } = *self; $body`
  expect(cb.call(undefined as never, "abc")).toEqual(interp_ok(undefined));
  expect(seen).toEqual([5, 2, 9, "abc"]);
  // `self: Box<Self>`: the callback is moved into its call
  expect(() => cb.call(undefined as never, "again")).toThrow(Panic);
  expect(seen).toEqual([5, 2, 9, "abc"]);
});

test("init_frame builds FrameExtra (machine.rs:1879): data_race FrameState iff data-race detection is on", () => {
  const frame_with = (data_race: unknown) => {
    const m = machine({ data_race, borrow_tracker: undefined, user_relevance: () => 7 } as never);
    const r = m.init_frame(ecx(m), { with_extra: (x: unknown) => x } as never);
    expect(r.$).toBe("Ok");
    return (r as unknown as { $: "Ok"; _0: { borrow_tracker: unknown; catch_unwind: unknown; timing: unknown; user_relevance: number; data_race: unknown } })._0;
  };
  // `GlobalDataRaceHandler::Vclocks`: `Some(data_race::FrameState::default())`, an empty local-clocks map.
  const on = frame_with({ $: "Vclocks", _0: {} });
  expect(on.data_race).toBeInstanceOf(data_race_FrameState);
  expect((on.data_race as { local_clocks: Map<unknown, unknown> }).local_clocks.size).toBe(0);
  expect([on.borrow_tracker, on.catch_unwind, on.timing, on.user_relevance]).toEqual([undefined, undefined, undefined, 7]);
  // `GlobalDataRaceHandler::None`: no data-race frame state.
  expect(frame_with({ $: "None" }).data_race).toBeUndefined();
});
