// Lane miri-shims-e (plan-m6 wave 37; not a port): unit tests of shims/unix/sync.ts and shims/unix/linux_like/*.ts.
//
// Expected values come from the pinned Miri (the isolated oracle, x86_64-unknown-linux-gnu): `sync.oracle.txt`, made by
// docs/handoff/miri-shims-e-probe/{probe.rs,ub.sh}: the bytes of libc's pthread static initializers, the libc constants,
// the return codes of the mutex kinds / rwlock / condattr / futex calls, and the first error line of the UB programs.
//
// The `MiriInterpCx` is a stand-in (threads.test.ts precedent): an object on `InterpCx.prototype` with a byte memory
// (allocations of bytes + an init mask + a real `AllocExtra` for the sync objects), the real `ThreadManager`, virtual
// `MonotonicClock`, and the real concurrency/sync.ts machinery (`get_immovable_sync_with_static_init`,
// `init_immovable_sync`, `get_sync_or_init`, mutex/rwlock/condvar/futex). Methods owned by other wave-37 lanes that the
// shims call (`read_timespec`, `parse_clockid`, `set_errno_and_return_neg1`, `check_varargs`, the fd table, readiness)
// are replaced by minimal stand-ins named in each test.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../../lib.ts";
import { MonotonicClock } from "../../clock.ts";
import { TerminationInfoStop, TerminationInfo_into_machine_stop } from "../../diagnostics.ts";
import { type MiriConfig } from "../../eval.ts";
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { AllocExtra, type MiriInterpCx, MiriMachine, new_sync_objs } from "../../machine.ts";
import { BlockingIoManager } from "../../concurrency/blocking_io.ts";
import { GlobalDataRaceHandler } from "../../concurrency/data_race_handler.ts";
import { type StackEmptyCallback, ThreadId, ThreadManager } from "../../concurrency/thread.ts";
import { DelayedReadinessUpdates, type Readiness, ReadinessInterest } from "../readiness.ts";
import { type FileDescription } from "../files.ts";
import { type Varargs } from "../sig.ts";
import { Epoll, is_Epoll } from "./linux_like/epoll.ts";
import { EventFd } from "./linux_like/eventfd.ts";
import { VClock } from "../../concurrency/vector_clock.ts";
import { type Result } from "../../../std/result.ts";
import { type IoError } from "../io_error.ts";
import { futex } from "./linux_like/sync.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type ImmTy } from "../../../rustc_const_eval/interpret/operand.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, type MachineStopType, Scalar as ScalarNs } from "../../../rustc_middle/mir/interpret/mod.ts";
import { debug_InterpErrorKind } from "../../../rustc_middle/mir/interpret/error.gen.ts";
import { TargetDataLayout } from "../../../rustc_abi/lib.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Err } from "../../../std/result.ts";
import { Poll } from "../../../std/task.ts";
import { Duration } from "../../../std/time.ts";
import { StdRng } from "../../../vendor/rand/rngs/std.ts";

// ---------------------------------------------------------------- the oracle fixture ----

const ORACLE = readFileSync(join(import.meta.dir, "sync.oracle.txt"), "utf8")
  .split("\n")
  .filter((l) => l !== "" && !l.startsWith("#"));
/** The rest of the oracle line starting with `prefix`. */
function oracle(prefix: string): string {
  const l = ORACLE.find((l) => l.startsWith(prefix));
  if (l === undefined) throw new Error(`no oracle line ${prefix}`);
  return l.slice(prefix.length);
}
/** `name=v` pairs of the constant lines (decimal or 0x). */
const CONST = new Map<string, number>();
for (const l of ORACLE) {
  if (!/^[A-Z_]+=/.test(l) || l.includes(",")) continue;
  for (const [, k, v] of l.matchAll(/([A-Za-z_0-9]+)=(0x[0-9a-f]+|-?\d+)/g)) CONST.set(k!, Number(v));
}
/** The static initializers' bytes. */
const INIT = new Map<string, number[]>();
for (const l of ORACLE) {
  const m = /^(PTHREAD_[A-Z_]+)=([\d,]+)$/.exec(l);
  if (m) INIT.set(m[1]!, m[2]!.split(",").map(Number));
}
const SIZES = (() => {
  const s = oracle("size ");
  const m = new Map<string, number>();
  for (const [, k, v] of s.matchAll(/([a-z_]+)=(\d+)/g)) m.set(k!, Number(v));
  m.set("pthread_mutex_t", INIT.get("PTHREAD_MUTEX_INITIALIZER")!.length);
  m.set("pthread_rwlock_t", INIT.get("PTHREAD_RWLOCK_INITIALIZER")!.length);
  m.set("pthread_cond_t", INIT.get("PTHREAD_COND_INITIALIZER")!.length);
  m.set("epoll_event", 12); // packed `{ events: u32, u64: u64 }` on x86_64 (libc: `#[repr(packed)]` there)
  return m;
})();
const c = (name: string): number => {
  const v = CONST.get(name);
  if (v === undefined) throw new Error(`no oracle constant ${name}`);
  return v;
};

// ---------------------------------------------------------------- the stand-in machine ----

interface Ptr {
  alloc: number; // 0: null
  off: number;
}
interface Layout {
  size: Size;
  layout: { size(): Size };
}
const layout = (n: number): Layout => ({ size: Size.from_bytes(n), layout: { size: () => Size.from_bytes(n) } });
class Place {
  constructor(
    public alloc: number,
    public off: number,
    public layout: Layout,
  ) {}
  ptr(): Ptr {
    return { alloc: this.alloc, off: this.off };
  }
  offset(o: Size, l: Layout): InterpResult<Place> {
    return interp_ok(new Place(this.alloc, this.off + Number(o.bytes()), l));
  }
}
type Arg = { op: "ptr"; p: Ptr } | { op: "scalar"; s: Scalar };
const ptr_arg = (p: Ptr | Place): OpTy => ({ op: "ptr", p: p instanceof Place ? p.ptr() : p }) as unknown as OpTy;
const int_arg = (s: Scalar): OpTy => ({ op: "scalar", s }) as unknown as OpTy;
const NULL = ptr_arg({ alloc: 0, off: 0 });

const ub = <T>(msg: string): InterpResult<T> => Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
const EXIT: StackEmptyCallback = () => Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop({ $: "Exit", code: 0, leak_check: false })));
const READY: StackEmptyCallback = () => interp_ok(Poll.Ready_unit);

interface Alloc {
  bytes: Uint8Array;
  init: Uint8Array;
  extra: AllocExtra;
}
interface Cx extends MiriInterpCx {
  allocs: Map<number, Alloc>;
  errno: number[];
  log: string[];
  programs: ((ecx: Cx) => boolean)[];
  alloc(n: number, bytes?: readonly number[], init?: boolean): Place;
  bytes(p: Place): number[];
}

let orig_process: typeof DelayedReadinessUpdates.process;
beforeAll(() => {
  orig_process = DelayedReadinessUpdates.process;
  // shims/readiness.rs:465 with no delayed updates (lane miri-shims-c)
  DelayedReadinessUpdates.process = () => interp_ok(undefined);
});
afterAll(() => {
  DelayedReadinessUpdates.process = orig_process;
});

function make_ecx(): Cx {
  const monotonic_clock = MonotonicClock.new(false);
  const layouts = { u8: layout(1), i32: layout(4), u64: layout(8) };
  const statics = new Map<string, Place>();
  const machine = {
    threads: ThreadManager.new({ fixed_scheduling: true } as MiriConfig),
    data_race: GlobalDataRaceHandler.None,
    rng: StdRng.seed_from_u64(0n),
    preemption_rate: 0,
    monotonic_clock,
    blocking_io: (BlockingIoManager.new(false) as { _0: BlockingIoManager })._0,
    static_roots: [],
    thread_cpu_affinity: undefined,
    communicate: () => false,
    handle_abnormal_termination: () => {},
    current_user_relevant_span: () => DUMMY_SP,
    layouts,
    pthread_mutex_sanity: false,
    pthread_rwlock_sanity: false,
    pthread_condvar_sanity: false,
    timeout: MiriMachine.prototype.timeout,
  };
  const ecx = Object.create(InterpCx.prototype) as Cx;
  const allocs = new Map<number, Alloc>();
  const mem = (p: Ptr): Alloc => {
    const a = allocs.get(p.alloc);
    if (a === undefined) throw new Error(`no allocation ${p.alloc}`);
    return a;
  };
  const read_bits = (place: Place): InterpResult<bigint> => {
    const a = mem(place.ptr());
    const n = Number(place.layout.size.bytes());
    let bits = 0n;
    for (let i = n - 1; i >= 0; i--) {
      if (a.init[place.off + i] === 0) return ub("using uninitialized data");
      bits = (bits << 8n) | BigInt(a.bytes[place.off + i]!);
    }
    return interp_ok(bits);
  };
  const write_bits = (place: Place, bits: bigint): InterpResult => {
    const a = mem(place.ptr());
    const n = Number(place.layout.size.bytes());
    for (let i = 0; i < n; i++) {
      a.bytes[place.off + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
      a.init[place.off + i] = 1;
    }
    return interp_ok(undefined);
  };
  const scalar_of = (bits: bigint, n: number): Scalar =>
    (n === 1 ? ScalarNs.from_u8(Number(bits)) : n === 4 ? ScalarNs.from_u32(Number(bits)) : ScalarNs.from_u64(bits)) as Scalar;
  const read_scalar = (x: Place | Arg): InterpResult<Scalar> => {
    if (x instanceof Place) {
      const b = read_bits(x);
      if (b.$ === "Err") return b;
      return interp_ok(scalar_of(b._0, Number(x.layout.size.bytes())));
    }
    if (x.op === "scalar") return interp_ok(x.s);
    throw new Error("read_scalar of a pointer argument");
  };
  Object.assign(ecx, {
    machine,
    tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" } } } }) },
    allocs,
    errno: [],
    log: [],
    programs: [],
    data_layout: () => TargetDataLayout.default(),
    alloc(this: Cx, n: number, bytes?: readonly number[], init = true): Place {
      const id = allocs.size + 1;
      const extra = Object.create(AllocExtra.prototype) as AllocExtra;
      extra.sync_objs = new_sync_objs();
      const b = new Uint8Array(n);
      if (bytes) b.set(bytes);
      allocs.set(id, { bytes: b, init: new Uint8Array(n).fill(init ? 1 : 0), extra });
      return new Place(id, 0, layout(n));
    },
    bytes(p: Place): number[] {
      return [...mem(p.ptr()).bytes.slice(p.off, p.off + Number(p.layout.size.bytes()))];
    },
    // ---- memory (rustc_const_eval interpret / helpers.rs) ----
    read_scalar,
    read_pointer: (op: Arg) => interp_ok((op as { p: Ptr }).p),
    ptr_is_null: (p: Ptr) => interp_ok(p.alloc === 0),
    ptr_to_mplace: (p: Ptr, l: Layout) => new Place(p.alloc, p.off, l),
    deref_pointer_as: (op: Arg, l: Layout) => interp_ok(new Place((op as { p: Ptr }).p.alloc, (op as { p: Ptr }).p.off, l)),
    deref_pointer_and_read: (op: Arg, offset: bigint, _base: Layout, value: Layout) => read_scalar(new Place((op as { p: Ptr }).p.alloc, (op as { p: Ptr }).p.off + Number(offset), value)),
    deref_pointer_and_write: (op: Arg, offset: bigint, s: Scalar, _base: Layout, value: Layout) => {
      const place = new Place((op as { p: Ptr }).p.alloc, (op as { p: Ptr }).p.off + Number(offset), value);
      return write_bits(place, ScalarNs.to_bits(s, value.size)._0 as bigint);
    },
    write_scalar: (s: Scalar, place: Place) => write_bits(place, ScalarNs.to_bits(s, place.layout.size)._0 as bigint),
    write_int: (i: bigint, place: Place) => write_bits(place, BigInt.asUintN(Number(place.layout.size.bytes()) * 8, i)),
    write_null: (place: Place) => write_bits(place, 0n),
    write_uninit: (place: Place) => {
      const a = mem(place.ptr());
      const end = place.off + Number(place.layout.size.bytes());
      a.init.fill(0, place.off, end);
      // The machine's write hook (machine.rs `before_memory_write`): sync objects in the range with
      // `delete_on_write()` are deleted.
      for (let o = place.off; o < end; o++) {
        const obj = a.extra.sync_objs.get(Size.from_bytes(o));
        if (obj?.delete_on_write()) a.extra.sync_objs.delete(Size.from_bytes(o));
      }
      return interp_ok(undefined);
    },
    write_bytes_ptr: (p: Ptr, it: Iterable<number>) => {
      const a = mem(p);
      let i = p.off;
      for (const b of it) {
        a.bytes[i] = b;
        a.init[i++] = 1;
      }
      return interp_ok(undefined);
    },
    read_bytes_ptr_strip_provenance: (p: Ptr, size: Size) => {
      const a = mem(p);
      const n = Number(size.bytes());
      for (let i = 0; i < n; i++) if (a.init[p.off + i] === 0) return ub("using uninitialized data");
      return interp_ok(a.bytes.slice(p.off, p.off + n));
    },
    check_ptr_access: () => interp_ok(undefined),
    ptr_get_alloc_id: (p: Ptr) => interp_ok([p.alloc, Size.from_bytes(p.off)]),
    ptr_try_get_alloc_id: (p: Ptr) => (p.alloc === 0 ? Err(p) : interp_ok([p.alloc, Size.from_bytes(p.off)])),
    get_alloc_info: (id: number) => ({ kind: "LiveData", mutbl: "Mut", size: Size.from_bytes(allocs.get(id)!.bytes.length) }),
    get_alloc_extra_mut: (id: number) => interp_ok([allocs.get(id)!.extra, machine]),
    atomic_compare_exchange: (place: Place, expect_old: ImmTy, new_: Scalar) => {
      const old = read_scalar(place);
      if (old.$ === "Err") return old;
      const exp = (expect_old.imm as { _0: Scalar })._0;
      const eq = ScalarNs.to_bits(old._0, place.layout.size)._0 === ScalarNs.to_bits(exp, place.layout.size)._0;
      if (eq) write_bits(place, ScalarNs.to_bits(new_, place.layout.size)._0 as bigint);
      return interp_ok([old._0, eq]);
    },
    atomic_fence: () => interp_ok(undefined),
    read_scalar_atomic: (place: Place) => read_scalar(place),
    acquire_clock: () => interp_ok(undefined),
    release_clock: () => interp_ok(undefined),
    // ---- libc (helpers.rs), from the oracle ----
    eval_path(this: Cx, path: readonly string[]): Place {
      const name = path[1]!;
      let p = statics.get(name);
      if (p === undefined) {
        p = this.alloc(INIT.get(name)!.length, INIT.get(name)!);
        statics.set(name, p);
      }
      return p;
    },
    libc_ty_layout: (name: string) => layout(SIZES.get(name)!),
    libc_array_ty_layout: (name: string, n: bigint) => layout(SIZES.get(name)! * Number(n)),
    eval_libc_i32: c,
    eval_libc_u32: c,
    eval_libc: (name: string) => ScalarNs.from_i32(c(name)),
    // ---- stand-ins for other wave-37 lanes ----
    /** time.rs `parse_clockid` (lane miri-shims-b), the two clocks of the oracle. */
    parse_clockid: (s: Scalar) => {
      const v = ScalarNs.to_i32(s)._0;
      return v === c("CLOCK_REALTIME") ? "RealTime" : v === c("CLOCK_MONOTONIC") ? "Monotonic" : undefined;
    },
    /** time.rs `read_timespec` (lane miri-shims-b): `{ tv_sec: i64, tv_nsec: i64 }`, `None` if out of range. */
    read_timespec: (place: Place) => {
      const sec = read_bits(new Place(place.alloc, place.off, layout(8)));
      const nsec = read_bits(new Place(place.alloc, place.off + 8, layout(8)));
      if (sec.$ === "Err") return sec;
      if (nsec.$ === "Err") return nsec;
      return interp_ok(nsec._0 >= 1_000_000_000n ? undefined : Duration.new(sec._0, Number(nsec._0)));
    },
    check_no_isolation: () => interp_ok(undefined),
    /** io_error.rs `set_errno_and_return_neg1` (lane miri-shims-b): records the errno, writes -1. */
    set_errno_and_return_neg1(this: Cx, err: { _0: string }, dest: Place) {
      this.errno.push(c(err._0));
      return this.write_int(-1n, dest as unknown as MPlaceTy);
    },
    set_errno_and_return_neg1_i32(this: Cx, err: { _0: string }) {
      this.errno.push(c(err._0));
      return interp_ok(ScalarNs.from_i32(-1));
    },
    /** sig.rs `check_varargs` (lane miri-shims-b) without the type check: futex's first call takes `(addr, op, val)`
     *  after the syscall number, every later call takes the rest. */
    check_varargs: (_tys: unknown, v: Varargs) => {
      const n = v.already_gone === 1 ? 3 : v.args.length;
      return interp_ok([v.args.slice(0, n), { args: v.args.slice(n), already_gone: v.already_gone + n }]);
    },
    step(this: Cx) {
      const p = this.programs[this.active_thread().index()];
      return interp_ok(p === undefined ? false : p(this));
    },
  });
  return ecx;
}

/** A place stand-in as an `MPlaceTy`. */
const mp = (p: Place): MPlaceTy => p as unknown as MPlaceTy;
/** An `InterpResult` as `ok:<value>` / the UB message / the machine stop. */
function show<T>(r: InterpResult<T>, f: (v: T) => string = (v) => `${v}`): string {
  if (r.$ === "Ok") return `ok:${f(r._0)}`;
  const kind = r._0.kind();
  if (kind.$ === "UndefinedBehavior" && kind._0.$ === "Ub") return `Undefined Behavior: ${kind._0._0}`;
  if (kind.$ === "Unsupported" && kind._0.$ === "Unsupported") return `unsupported operation: ${kind._0._0}`;
  if (kind.$ === "MachineStop") return `stop:${TerminationInfoStop.downcast_ref(kind._0 as MachineStopType)?.$}`;
  return debug_InterpErrorKind(kind, PLAIN);
}
/** The i32 an `InterpResult<Scalar>` returned. */
const i32 = (r: InterpResult<Scalar>): number => {
  if (r.$ === "Err") throw new Error(show(r));
  return ScalarNs.to_i32(r._0)._0 as number;
};
/** The oracle's first error line of the one-line program `name`, without `error: `. */
const ub_line = (name: string): string => oracle(`ub ${name}: error: `);

// ---------------------------------------------------------------- pthread_mutex ----

test("static initializers: the oracle's libc bytes pass the sanity check at offset 0; only MUTEX/RECURSIVE/ERRORCHECK are recognized", () => {
  // The four mutex initializers and the rwlock/cond ones all have PTHREAD_UNINIT (0) at the init offset (0 on Linux).
  for (const [name, bytes] of INIT) expect([name, bytes[0]]).toEqual([name, 0]);
  expect(SIZES.get("pthread_mutex_t")).toBe(40);
  expect(INIT.get("PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP")![16]).toBe(c("PTHREAD_MUTEX_RECURSIVE"));
  expect(INIT.get("PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP")![16]).toBe(c("PTHREAD_MUTEX_ERRORCHECK"));

  // recursive-static / errorcheck-static: lock, lock, unlock, unlock on a copy of the initializer.
  for (const [name, init] of [
    ["recursive-static", "PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP"],
    ["errorcheck-static", "PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP"],
  ] as const) {
    const ecx = make_ecx();
    ThreadManager.init(ecx, EXIT);
    const m = ptr_arg(ecx.alloc(40, INIT.get(init)));
    const dest = ecx.alloc(4);
    const lock = (): number => (ecx.pthread_mutex_lock(m, mp(dest)), ScalarNs.to_i32(ecx.read_scalar(mp(dest))._0 as Scalar)._0 as number);
    const got = [lock(), lock(), i32(ecx.pthread_mutex_unlock(m)), i32(ecx.pthread_mutex_unlock(m))].join(" ");
    expect(`${name}: ${got}`).toBe(`${name}: ${oracle(`${name}: `)}`);
    // The sanity flag is set once.
    expect(ecx.machine.pthread_mutex_sanity).toBe(true);
  }

  // PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP is checked by the sanity check but not recognized.
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const a = ptr_arg(ecx.alloc(40, INIT.get("PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP")));
  expect(show(ecx.pthread_mutex_lock(a, mp(ecx.alloc(4))))).toBe(ub_line("adaptive"));
});

test("mutex kinds through pthread_mutexattr: relock / trylock / unlock return codes match the oracle", () => {
  for (const [name, kind] of [
    ["errorcheck", "PTHREAD_MUTEX_ERRORCHECK"],
    ["recursive", "PTHREAD_MUTEX_RECURSIVE"],
    ["normal", "PTHREAD_MUTEX_NORMAL"],
  ] as const) {
    const ecx = make_ecx();
    ThreadManager.init(ecx, EXIT);
    const attr = ptr_arg(ecx.alloc(4, [], false));
    expect(show(ecx.pthread_mutexattr_init(attr))).toBe("ok:undefined");
    const st = i32(ecx.pthread_mutexattr_settype(attr, int_arg(ScalarNs.from_i32(c(kind)))));
    const m = ptr_arg(ecx.alloc(40, [], false));
    expect(show(ecx.pthread_mutex_init(m, attr))).toBe("ok:undefined");
    const dest = ecx.alloc(4);
    const lock = (): number => {
      const r = ecx.pthread_mutex_lock(m, mp(dest));
      if (r.$ === "Err") throw new Error(show(r));
      return ScalarNs.to_i32(ecx.read_scalar(mp(dest))._0 as Scalar)._0 as number;
    };
    const l1 = lock();
    const l2 = name === "normal" ? -999 : lock();
    const t = i32(ecx.pthread_mutex_trylock(m));
    const u1 = i32(ecx.pthread_mutex_unlock(m));
    const u2 = name === "normal" ? -999 : i32(ecx.pthread_mutex_unlock(m));
    const u3 = name === "normal" ? -999 : i32(ecx.pthread_mutex_unlock(m));
    const u4 = name === "recursive" ? i32(ecx.pthread_mutex_unlock(m)) : -999;
    expect(`${name}: settype=${st} lock=${l1} relock=${l2} trylock=${t} unlock=${u1},${u2},${u3},${u4}`).toBe(`${name}: ${oracle(`${name}: `)}`);
    if (name === "normal") {
      // A normal mutex: unlocking when not locked is UB (oracle probe run 1), relocking deadlocks (ub.sh normal_relock).
      expect(show(ecx.pthread_mutex_unlock(m))).toBe("Undefined Behavior: unlocked a PTHREAD_MUTEX_NORMAL mutex that was not locked by the current thread");
      lock();
      expect(show(ecx.pthread_mutex_lock(m, mp(dest)))).toBe("stop:LocalDeadlock");
    }
  }
  // An invalid kind: EINVAL.
  const ecx = make_ecx();
  const attr = ptr_arg(ecx.alloc(4));
  expect(`settype(1234)=${i32(ecx.pthread_mutexattr_settype(attr, int_arg(ScalarNs.from_i32(1234))))}`).toBe(`settype(1234)=${oracle("settype(1234)=")}`);
});

test("default mutex UB and destroy: the oracle's messages; destroy de-initializes the memory; a moved mutex is detected", () => {
  const fresh = (): [Cx, OpTy, MPlaceTy] => {
    const ecx = make_ecx();
    ThreadManager.init(ecx, EXIT);
    return [ecx, ptr_arg(ecx.alloc(40, INIT.get("PTHREAD_MUTEX_INITIALIZER"))), mp(ecx.alloc(4))];
  };
  {
    const [ecx, m, d] = fresh();
    ecx.pthread_mutex_lock(m, d);
    expect(show(ecx.pthread_mutex_lock(m, d))).toBe(ub_line("default_relock"));
  }
  {
    const [ecx, m] = fresh();
    expect(show(ecx.pthread_mutex_unlock(m))).toBe(ub_line("default_unlock"));
  }
  {
    const [ecx, m, d] = fresh();
    ecx.pthread_mutex_lock(m, d);
    expect(show(ecx.pthread_mutex_destroy(m))).toBe(ub_line("destroy_locked"));
  }
  {
    // double destroy: the second reads uninitialized memory (the oracle names the allocation; the stand-in memory
    // only reports UB).
    const [ecx, m] = fresh();
    expect(show(ecx.pthread_mutex_destroy(m))).toBe("ok:undefined");
    expect(ub_line("double_destroy")).toStartWith("Undefined Behavior: reading memory at alloc");
    expect(show(ecx.pthread_mutex_destroy(m))).toStartWith("Undefined Behavior:");
  }
  {
    // moved: lock+unlock marks byte 0 PTHREAD_INIT and registers the sync object; a byte copy has init=1 and no object.
    const [ecx, m, d] = fresh();
    ecx.pthread_mutex_lock(m, d);
    ecx.pthread_mutex_unlock(m);
    const orig = (m as unknown as { p: Ptr }).p;
    const copy = ecx.alloc(40, [...ecx.allocs.get(orig.alloc)!.bytes]);
    expect(ecx.bytes(copy)[0]).toBe(1);
    expect(show(ecx.pthread_mutex_lock(ptr_arg(copy), d))).toBe(ub_line("moved"));
  }
});

test("a blocked mutex waiter makes accesses to the pthread_mutex_t UB (SyncObj::on_access), and the sync object is the exact class", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const t1 = ecx.machine.threads.create_thread(READY);
  const place = ecx.alloc(40, INIT.get("PTHREAD_MUTEX_INITIALIZER"));
  const m = ptr_arg(place);
  const d = mp(ecx.alloc(4));
  ecx.pthread_mutex_lock(m, d);
  ecx.machine.threads.set_active_thread(t1);
  expect(show(ecx.pthread_mutex_lock(m, d))).toBe("ok:undefined"); // blocked
  const obj = ecx.allocs.get(place.alloc)!.extra.sync_objs.get(Size.ZERO)!;
  expect(obj.constructor.name).toBe("PthreadMutex");
  expect(show(obj.on_access("Write"))).toBe("Undefined Behavior: write of `pthread_mutex_t` is forbidden while the queue is non-empty");
  expect(obj.delete_on_write()).toBe(true);
});

// ---------------------------------------------------------------- rwlock / condattr / cond ----

test("rwlock: rd / tryrd / trywr / unlock sequence matches the oracle; unlocking an unlocked rwlock is UB", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const l = ptr_arg(ecx.alloc(56, INIT.get("PTHREAD_RWLOCK_INITIALIZER")));
  const d = mp(ecx.alloc(4));
  const rd = (): number => (ecx.pthread_rwlock_rdlock(l, d), ScalarNs.to_i32(ecx.read_scalar(d)._0 as Scalar)._0 as number);
  const un = (): number => (show(ecx.pthread_rwlock_unlock(l)) === "ok:undefined" ? 0 : -1);
  const got = `rd=${rd()} tryrd=${i32(ecx.pthread_rwlock_tryrdlock(l))} trywr=${i32(ecx.pthread_rwlock_trywrlock(l))} un=${un()} un=${un()} trywr=${i32(ecx.pthread_rwlock_trywrlock(l))} tryrd=${i32(ecx.pthread_rwlock_tryrdlock(l))} un=${un()}`;
  expect(got).toBe(oracle("rwlock: "));
  expect(show(ecx.pthread_rwlock_unlock(l))).toBe(ub_line("rwlock_unlock"));
});

test("condattr clock: default CLOCK_REALTIME, set CLOCK_MONOTONIC, invalid clock EINVAL; cond_timedwait times out on the virtual clock", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const ca = ptr_arg(ecx.alloc(4, [], false));
  ecx.pthread_condattr_init(ca);
  const clk = ecx.alloc(4);
  ecx.pthread_condattr_getclock(ca, ptr_arg(clk));
  const dflt = i32(ecx.read_scalar(mp(clk)));
  const s1 = i32(ecx.pthread_condattr_setclock(ca, int_arg(ScalarNs.from_i32(c("CLOCK_MONOTONIC")))));
  ecx.pthread_condattr_getclock(ca, ptr_arg(clk));
  const now = i32(ecx.read_scalar(mp(clk)));
  const s2 = i32(ecx.pthread_condattr_setclock(ca, int_arg(ScalarNs.from_i32(77))));
  expect(`default=${dflt} set_mono=${s1} now=${now} set77=${s2}`).toBe(oracle("condattr: "));

  // cond_timedwait with the monotonic clock: absolute deadline now+1ms; the scheduler sleeps the virtual clock to it.
  const cond = ptr_arg(ecx.alloc(48, [], false));
  ecx.pthread_cond_init(cond, ca);
  const m = ptr_arg(ecx.alloc(40, INIT.get("PTHREAD_MUTEX_INITIALIZER")));
  const d = ecx.alloc(4);
  const ts = ecx.alloc(16);
  const bad = ecx.alloc(16);
  ecx.write_int(1_000_000_000n, mp(new Place(bad.alloc, 8, layout(8))));
  ecx.write_int(0n, mp(new Place(bad.alloc, 0, layout(8))));
  const results: number[] = [];
  let step = 0;
  ecx.programs[0] = (e) => {
    if (step === 0) {
      e.pthread_mutex_lock(m, mp(d));
      const kind = e.machine.monotonic_clock.kind as { nanoseconds: number };
      const t = BigInt(kind.nanoseconds) + 1_000_000n;
      e.write_int(t / 1_000_000_000n, mp(new Place(ts.alloc, 0, layout(8))));
      e.write_int(t % 1_000_000_000n, mp(new Place(ts.alloc, 8, layout(8))));
      e.pthread_cond_timedwait(cond, m, ptr_arg(ts), mp(d), false);
    } else if (step === 1) {
      results.push(i32(e.read_scalar(mp(d))));
      e.pthread_cond_timedwait(cond, m, ptr_arg(bad), mp(d), false);
      results.push(i32(e.read_scalar(mp(d))));
    } else return false;
    step++;
    return true;
  };
  const r = ecx.run_threads();
  expect(show(r)).toBe("stop:Exit");
  expect(`${results[0]} invalid=${results[1]}`).toBe(oracle("cond_timedwait: "));
  expect((ecx.machine.monotonic_clock.kind as { nanoseconds: number }).nanoseconds).toBe(1_000_000);
});

// ---------------------------------------------------------------- futex ----

/** `syscall(SYS_futex, args..)`'s varargs after the syscall number (`already_gone: 1`). */
const varargs = (...args: OpTy[]): Varargs => ({ args, already_gone: 1 });

test("futex: value mismatch EAGAIN, wake with no waiters 0, relative timeout ETIMEDOUT on the virtual clock, bitset 0 EINVAL", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const word = ecx.alloc(4, [5, 0, 0, 0]);
  const dest = ecx.alloc(8);
  const ret = (): bigint => ScalarNs.to_i64(ecx.read_scalar(mp(dest))._0 as Scalar)._0 as bigint;
  const u32 = (v: number): OpTy => int_arg(ScalarNs.from_u32(v));
  const op = (v: number): OpTy => int_arg(ScalarNs.from_i32(v));
  const to = ecx.alloc(16);
  ecx.write_int(2_000n, mp(new Place(to.alloc, 8, layout(8))));
  const out: string[] = [];
  let step = 0;
  ecx.programs[0] = (e) => {
    if (step === 0) {
      futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAIT")), u32(4), NULL), mp(dest));
      out.push(`mismatch=${ret()}/${e.errno.at(-1)}`);
      futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAKE")), u32(10)), mp(dest));
      out.push(`wake=${ret()}`);
      // FUTEX_PRIVATE_FLAG is ignored; blocks until the 2µs relative timeout.
      futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAIT") | c("FUTEX_PRIVATE_FLAG")), u32(5), ptr_arg(to)), mp(dest));
    } else if (step === 1) {
      out.push(`timeout=${ret()}/${e.errno.at(-1)}`);
      out.push(`at=${(e.machine.monotonic_clock.kind as { nanoseconds: number }).nanoseconds}`);
      futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAIT_BITSET")), u32(5), NULL, NULL, u32(0)), mp(dest));
      out.push(`bitset0=${ret()}/${e.errno.at(-1)}`);
    } else return false;
    step++;
    return true;
  };
  expect(show(ecx.run_threads())).toBe("stop:Exit");
  const at = out.splice(3, 1)[0];
  expect(out.join(" ")).toBe(oracle("futex: "));
  expect(at).toBe("at=2000");
  // Errors: FUTEX_WAIT_BITSET with a non-null uaddr2, an unknown op.
  expect(show(futex(ecx, varargs(ptr_arg(word), op(c("FUTEX_WAIT_BITSET")), u32(0), NULL, ptr_arg(word), u32(1)), mp(dest)))).toBe(ub_line("futex_bitset_uaddr2"));
  expect(show(futex(ecx, varargs(ptr_arg(word), op(5), u32(0)), mp(dest)))).toBe(ub_line("futex_badop"));
});

test("futex: a FUTEX_WAKE from another thread before the deadline wakes the waiter with 0 and returns 1", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const word = ecx.alloc(4, [7, 0, 0, 0]);
  const d0 = ecx.alloc(8);
  const d1 = ecx.alloc(8);
  const to = ecx.alloc(16);
  ecx.write_int(1n, mp(new Place(to.alloc, 0, layout(8)))); // 1 s
  const u32 = (v: number): OpTy => int_arg(ScalarNs.from_u32(v));
  const op = (v: number): OpTy => int_arg(ScalarNs.from_i32(v));
  const log: string[] = [];
  let s0 = 0;
  ecx.programs[0] = (e) => {
    if (s0 === 0) {
      const t1 = e.machine.threads.create_thread(READY);
      let s1 = 0;
      e.programs[t1.index()] = (e) => {
        if (s1++ > 0) return false;
        futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAKE") | c("FUTEX_PRIVATE_FLAG")), u32(1)), mp(d1));
        log.push(`woken=${ScalarNs.to_i64(e.read_scalar(mp(d1))._0 as Scalar)._0}`);
        return true;
      };
      futex(e, varargs(ptr_arg(word), op(c("FUTEX_WAIT")), u32(7), ptr_arg(to)), mp(d0));
      log.push("main blocked");
    } else if (s0 === 1) {
      log.push(`main ret=${ScalarNs.to_i64(e.read_scalar(mp(d0))._0 as Scalar)._0}`);
    } else return false;
    s0++;
    return true;
  };
  expect(show(ecx.run_threads())).toBe("stop:Exit");
  expect(log).toEqual(["main blocked", "woken=1", "main ret=0"]);
  expect((ecx.machine.monotonic_clock.kind as { nanoseconds: number }).nanoseconds).toBe(0);
  expect(ecx.errno).toEqual([]);
});

// ---------------------------------------------------------------- epoll ----

test("epoll: readiness <-> bitflag with the oracle's constants; return_ready_list fills the events array in the watcher's ready order", () => {
  const ecx = make_ecx();
  const all: Readiness = { readable: true, writable: true, read_closed: true, write_closed: true, error: true };
  expect(ecx.readiness_to_epoll_bitflag(all)).toBe(c("EPOLLIN") | c("EPOLLOUT") | c("EPOLLRDHUP") | c("EPOLLHUP") | c("EPOLLERR"));
  // EPOLLET (bit 31) is not a readiness flag; the result stays an unsigned u32.
  expect(ecx.epoll_bitflag_to_readiness((c("EPOLLET") | c("EPOLLOUT")) >>> 0)).toEqual({ readable: false, writable: true, read_closed: false, write_closed: false, error: false });
  expect(ecx.readiness_to_epoll_bitflag(ecx.epoll_bitflag_to_readiness(0x2015))).toBe(0x2015);

  // return_ready_list: the watcher (lane miri-shims-c) hands out interests in its ready-queue order; each goes to the
  // next array slot as `{ events, u64: data }`, and the count to `dest`.
  const mk = (data: bigint, r: Partial<Readiness>): ReadinessInterest => {
    const i = Object.create(ReadinessInterest.prototype) as ReadinessInterest;
    i.data = data;
    i.active_ = () => ({ readable: false, writable: false, read_closed: false, write_closed: false, error: false, ...r });
    return i;
  };
  const ready = [mk(30n, { writable: true }), mk(10n, { readable: true }), mk(20n, { readable: true, error: true })];
  const watcher = { get_ready_interests: (max: number) => interp_ok(ready.slice(0, max)) };
  const epfd = { deref: () => ({ watcher }) } as never;
  const events = ecx.alloc(12 * 4);
  const fields: [string, bigint][][] = [];
  const slots: number[] = [];
  Object.assign(ecx, {
    project_array_fields: (base: Place) => {
      let i = 0;
      return interp_ok({ next: () => interp_ok(i * 12 < Number(base.layout.size.bytes()) ? [BigInt(i), new Place(base.alloc, 12 * i++, layout(12))] : undefined) });
    },
    write_int_fields_named: (values: [string, bigint][], slot: Place) => (fields.push(values), slots.push(slot.off), interp_ok(undefined)),
  });
  (events as unknown as { len: () => InterpResult<bigint> }).len = () => interp_ok(4n);
  const dest = ecx.alloc(4);
  expect(show(ecx.return_ready_list(epfd, mp(dest), mp(events)))).toBe("ok:3");
  expect(i32(ecx.read_scalar(mp(dest)))).toBe(3);
  expect(slots).toEqual([0, 12, 24]);
  expect(fields).toEqual([
    [["events", BigInt(c("EPOLLOUT"))], ["u64", 30n]],
    [["events", BigInt(c("EPOLLIN"))], ["u64", 10n]],
    [["events", BigInt(c("EPOLLIN") | c("EPOLLERR"))], ["u64", 20n]],
  ]);
});

test("epoll_ctl: EPOLLET is stripped (unsigned bit 31), EPOLLHUP|EPOLLERR always added, unknown flags unsupported; every fd handle is dropped once", () => {
  const ecx = make_ecx();
  const added: unknown[][] = [];
  const watcher = {
    add_interest: (...a: unknown[]) => (added.push(a.slice(0, 4)), interp_ok({ $: "Ok", _0: null })),
  };
  const epoll = Object.create(Epoll.prototype) as Epoll;
  (epoll as unknown as { watcher: unknown }).watcher = watcher;
  const drops: string[] = [];
  const handle = (name: string, inner: object) => ({
    deref: () => inner,
    id: () => ({ _0: 9 }),
    drop: () => drops.push(name),
    downcast(is_T: (v: object) => boolean) {
      if (is_T(inner)) return this;
      drops.push(name);
      return undefined;
    },
  });
  (ecx.machine as unknown as { fds: unknown }).fds = { get: (n: number) => (n === 3 ? handle("epfd", epoll) : n === 4 ? handle("fd", {}) : undefined) };
  const ev = ecx.alloc(12);
  const event_fields = (events: number, data: bigint): void => {
    ecx.write_int(BigInt(events), mp(new Place(ev.alloc, 0, layout(4))));
    ecx.write_int(data, mp(new Place(ev.alloc, 4, layout(8))));
  };
  Object.assign(ecx, { project_field: (p: Place, i: number) => interp_ok(i === 0 ? new Place(p.alloc, 0, layout(4)) : new Place(p.alloc, 4, layout(8))) });
  const ctl = (op: string, fd: number) => ecx.epoll_ctl(int_arg(ScalarNs.from_i32(3)), int_arg(ScalarNs.from_i32(c(op))), int_arg(ScalarNs.from_i32(fd)), ptr_arg(ev));

  event_fields((c("EPOLLIN") | c("EPOLLET")) >>> 0, 0xdead_beef_0000_0001n);
  expect(show(ctl("EPOLL_CTL_ADD", 4), (s) => `${ScalarNs.to_i32(s)._0}`)).toBe("ok:0");
  expect(added).toEqual([[4, { readable: true, writable: false, read_closed: false, write_closed: true, error: true }, true, 0xdead_beef_0000_0001n]]);
  expect(drops).toEqual(["fd", "epfd"]);

  drops.length = 0;
  event_fields(0x40, 0n); // EPOLLPRI: unsupported
  expect(show(ctl("EPOLL_CTL_ADD", 4))).toBe("unsupported operation: epoll_ctl: encountered unknown unsupported flags 0x40");
  expect(drops).toEqual(["fd", "epfd"]);

  drops.length = 0;
  expect(show(ctl("EPOLL_CTL_ADD", 5), (s) => `${ScalarNs.to_i32(s)._0}`)).toBe("ok:-1");
  expect(ecx.errno.at(-1)).toBe(9); // EBADF stand-in mapping below
  expect(drops).toEqual(["epfd"]);

  // A non-epoll fd as epfd: downcast releases the handle; unsupported.
  drops.length = 0;
  (ecx.machine as unknown as { fds: unknown }).fds = { get: () => handle("other", {}) };
  expect(show(ctl("EPOLL_CTL_ADD", 4))).toBe("unsupported operation: non-epoll FD passed to `epoll_ctl`");
  expect(drops).toEqual(["other"]);
  expect(is_Epoll(epoll)).toBe(true);
  expect(is_Epoll({ watcher } as unknown as FileDescription)).toBe(false);
});

// ---------------------------------------------------------------- eventfd ----

test("eventfd: writes add to the counter, a read returns and clears it; a read on 0 blocks until a write unblocks it", () => {
  const ecx = make_ecx();
  ThreadManager.init(ecx, EXIT);
  const efd = new EventFd(0n, false, new VClock([]), [], [], undefined as never);
  let strong = 1;
  const handle = () => ({ deref: () => efd, drop: () => strong--, visit_provenance() {} }) as never;
  const updates: number[] = [];
  Object.assign(ecx, {
    ptr_to_mplace_unaligned: (p: Ptr, l: Layout) => new Place(p.alloc, p.off, l),
    /** readiness.rs `update_fd_readiness` (lane miri-shims-c): takes the handle by value. */
    update_fd_readiness: (fd: { drop(): void }, flags: number) => (updates.push(flags), fd.drop(), interp_ok(undefined)),
  });
  const buf = ecx.alloc(8);
  const results: string[] = [];
  const finish = (name: string) => ({
    visit_provenance() {},
    call: (_e: MiriInterpCx, r: Result<number, IoError>) => (results.push(`${name}:${r.$ === "Ok" ? r._0 : "err"}`), interp_ok(undefined)),
  });
  const write = (v: bigint): void => {
    ecx.write_int(v, mp(buf));
    strong++;
    efd.write(handle(), false, buf.ptr() as never, 8, ecx, finish("w"));
  };
  write(3n);
  write(4n);
  expect(efd.counter).toBe(7n);
  expect(efd.readiness()).toMatchObject({ readable: true, writable: true });
  strong++;
  efd.read(handle(), false, buf.ptr() as never, 8, ecx, finish("r"));
  expect(ecx.read_scalar(mp(buf))._0).toEqual(ScalarNs.from_u64(7n));
  expect(efd.counter).toBe(0n);
  expect(efd.readiness()).toMatchObject({ readable: false, writable: true });
  expect(results).toEqual(["w:8", "w:8", "r:8"]);
  expect(updates).toEqual([1, 1, 1]); // ReadinessUpdateFlags::FORCE_EDGE
  expect(strong).toBe(1); // every handle passed in was moved on (update_fd_readiness) or dropped

  // Blocking read: the main thread blocks on Eventfd, thread 1 writes 5, the main thread is woken and reads 5.
  results.length = 0;
  let s0 = 0;
  ecx.programs[0] = (e) => {
    if (s0 === 0) {
      const t1 = e.machine.threads.create_thread(READY);
      let s1 = 0;
      e.programs[t1.index()] = () => (s1++ === 0 ? (write(5n), true) : false);
      strong++;
      efd.read(handle(), false, buf.ptr() as never, 8, e, finish("r"));
      results.push(`blocked=${efd.blocked_read_tid.length}`);
    } else if (s0 > 1) return false;
    s0++;
    return true;
  };
  expect(show(ecx.run_threads())).toBe("stop:Exit");
  // `unblock_thread` runs the reader's callback at once (thread.rs), inside the write, before the write's `finish`.
  expect(results).toEqual(["blocked=1", "r:8", "w:8"]);
  expect(ecx.read_scalar(mp(buf))._0).toEqual(ScalarNs.from_u64(5n));
  expect(strong).toBe(1);
});
CONST.set("EBADF", 9); // not in the probe: only the identity of the recorded errno matters above
