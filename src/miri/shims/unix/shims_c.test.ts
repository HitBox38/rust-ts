// Unit tests of lane miri-shims-c (wave 37): shims/unix/{env, mem, thread, foreign_items}.rs and shims/readiness.rs.
// The shims need a running Miri machine for an end-to-end run (the Miri suites cover that once the wave lands); here
// each shim runs on a stand-in `InterpCx` (`Object.create(InterpCx.prototype)` plus the few members it reads), as
// concurrency/threads.test.ts does. Expected values come from the oracle Miri (the isolated toolchain, `bun scripts/miri.ts
// status`) on tiny programs: $RUST_TS_DATA/tmp/miri-shims-c/{envorder,getcwd,mmap}.rs, run with `run.sh` there
// (x86_64-unknown-linux-gnu, Miri's default flags); the outputs are quoted next to each test.
import { expect, test } from "bun:test";
import "../../lib.ts";
import { type MiriInterpCx, type Provenance, Provenance_Provenance } from "../../machine.ts";
import { TerminationInfoStop } from "../../diagnostics.ts";
import { ThreadId } from "../../concurrency/thread.ts";
import { FdId } from "../files.ts";
import {
  InterestMap,
  Readiness_EMPTY,
  ReadinessInterest,
  type ReadinessInterestKey,
  ReadinessWatched_default,
  Rc_clone_ReadinessWatcher,
  Rc_drop_ReadinessWatcher,
  Rc_new_ReadinessWatcher,
  type Readiness,
} from "../readiness.ts";
import { OsString_key, UnixEnvVars } from "./env.ts";
import { emulate_foreign_item_inner, is_dyn_sym } from "./foreign_items.ts";
import { HOSTNAME, UID } from "./mod.ts";
import { FxHashMap, LAYOUT_VEC, String_key } from "../../../rust_ts/hash_map.ts";
import { Align, Size, TargetDataLayout } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Pointer, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { Unported } from "../../../std/panic.ts";
import { IoError_kind } from "../../../std/io.ts";
import { Err, unwrap_result } from "../../../std/result.ts";

// ---- helpers ----

type Rec = Record<string, unknown>;

/** A stand-in `MiriInterpCx`: the real prototype (so the ported shims and helpers run) with `members` overriding. */
function fake_cx(members: Rec): MiriInterpCx {
  const ecx = Object.create(InterpCx.prototype) as MiriInterpCx;
  Object.assign(ecx, members);
  return ecx;
}

/** A stand-in operand: the fake cx's `read_*` read `v` back. */
function op(v: bigint | number, size = 8): never {
  return { v, layout: { size: Size.from_bytes(size) } } as never;
}

/** `unsupported operation` message of an `InterpResult`'s error, or the result itself. */
function unsup_msg(r: InterpResult<unknown>): string | undefined {
  if (r.$ !== "Err") return undefined;
  const k = r._0.kind();
  if (k.$ !== "Unsupported") return `not unsupported: ${k.$}`;
  return (k._0 as { _0: string })._0;
}

function ub_msg(r: InterpResult<unknown>): string | undefined {
  if (r.$ !== "Err") return undefined;
  const k = r._0.kind();
  if (k.$ !== "UndefinedBehavior") return `not UB: ${k.$}`;
  return (k._0 as { _0: string })._0;
}

/** x86_64 (64-bit pointers): rustc_abi's default data layout. */
const DL = TargetDataLayout.default();

/** The libc constants of x86_64-unknown-linux-gnu that the shims evaluate (libc crate). */
const LIBC: Record<string, number> = {
  MAP_PRIVATE: 2,
  MAP_ANONYMOUS: 0x20,
  MAP_SHARED: 1,
  MAP_FIXED: 0x10,
  PROT_READ: 1,
  PROT_WRITE: 2,
  MADV_NORMAL: 0,
  MADV_RANDOM: 1,
  MADV_SEQUENTIAL: 2,
  MADV_WILLNEED: 3,
};

function mem_cx(extra: Rec = {}) {
  const log: string[] = [];
  const cx = fake_cx({
    data_layout: () => DL,
    machine: { page_size: 4096n, page_align: () => unwrap_result(Align.from_bytes(4096), () => "align"), Provenance: Provenance_Provenance },
    tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" }, env: { $: "Gnu" } } } }) },
    frame_in_std: () => false,
    read_target_usize: (o: { v: bigint }) => interp_ok(BigInt(o.v)),
    read_scalar: (o: { v: number }) => interp_ok(Scalar.from_i32(Number(o.v))),
    read_pointer: (o: { v: bigint }) => interp_ok(Pointer.without_provenance(BigInt(o.v))),
    eval_libc_i32: (n: string) => LIBC[n]!,
    eval_libc: (n: string) => (n === "MAP_FAILED" ? Scalar.from_int(-1n, Size.from_bytes(8)) : Scalar.from_i32(LIBC[n]!)),
    set_last_error: (e: { $: string; _0: string }) => {
      log.push(`errno ${e._0}`);
      return interp_ok(undefined);
    },
    set_errno_and_return_neg1_i32: (e: { $: string; _0: string }) => {
      log.push(`errno ${e._0}`);
      return interp_ok(Scalar.from_i32(-1));
    },
    allocate_ptr: (size: Size, align: Align, kind: unknown, init: string) => {
      log.push(`alloc ${size.bytes()} align ${align.bytes()} ${JSON.stringify(kind)} ${init}`);
      return interp_ok(Pointer.without_provenance(0x10000n));
    },
    deallocate_ptr: (_p: unknown, sa: [Size, Align], kind: unknown) => {
      log.push(`dealloc ${sa[0].bytes()} align ${sa[1].bytes()} ${JSON.stringify(kind)}`);
      return interp_ok(undefined);
    },
    ...extra,
  });
  return { cx, log };
}

// ---- unix/mem.rs ----

// Oracle (mmap.rs): `both: -1 errno 22` / `len0: -1 errno 22` / `huge: -1 errno 22` / `ok: null=false aligned=true` /
// `zeroed: 0` / `munmap misaligned: -1 errno 22` / `munmap: 0`.
test("mmap argument validation: EINVAL + MAP_FAILED for bad flags, zero and overflowing lengths", () => {
  const { cx, log } = mem_cx();
  const rw = op(3);
  const anon_priv = 0x22;
  const failed = (r: InterpResult<unknown>) => r.$ === "Ok" && Scalar.to_int(r._0 as never, Size.from_bytes(8)).$ === "Ok" && unwrap_result(Scalar.to_int(r._0 as never, Size.from_bytes(8)), () => "") === -1n;
  expect(failed(cx.mmap(op(0), op(4096), rw, op(0x23), op(-1), 0n))).toBe(true); // MAP_PRIVATE | MAP_SHARED
  expect(failed(cx.mmap(op(0), op(0), rw, op(anon_priv), op(-1), 0n))).toBe(true);
  expect(failed(cx.mmap(op(0), op(0xffff_ffff_ffff_ffffn), rw, op(anon_priv), op(-1), 0n))).toBe(true);
  expect(log).toEqual(["errno EINVAL", "errno EINVAL", "errno EINVAL"]);
});

test("mmap success: page-rounded, page-aligned, zero-initialised Mmap allocation", () => {
  const { cx, log } = mem_cx();
  const r = cx.mmap(op(0), op(10), op(3), op(0x22), op(-1), 0n);
  expect(r.$).toBe("Ok");
  expect(log).toEqual([`alloc 4096 align 4096 {"$":"Machine","_0":"Mmap"} Zero`]);
});

// Oracle (mmap.rs fd/fixed/prot/flags/offset): the five `error: unsupported operation: ..` lines below.
test("mmap unsupported operations: the oracle's messages, in upstream's check order", () => {
  const { cx } = mem_cx();
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(3), op(2), op(3), 0n))).toBe("Miri does not support file-backed memory mappings");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(3), op(0x32), op(-1), 0n))).toBe("Miri does not support calls to mmap with MAP_FIXED as part of the flags argument");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(1), op(0x22), op(-1), 0n))).toBe("Miri does not support calls to mmap/mprotect with protections other than PROT_READ|PROT_WRITE");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(3), op(0x122), op(-1), 0n))).toBe("Miri only supports calls to mmap which set the flags argument to MAP_PRIVATE|MAP_ANONYMOUS");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(3), op(0x22), op(-1), 4096n))).toBe("Miri does not support non-zero offsets to mmap");
  // fd is checked before MAP_FIXED, MAP_FIXED before the protection, the protection before the flags.
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(1), op(0x132), op(3), 1n))).toBe("Miri does not support file-backed memory mappings");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(1), op(0x132), op(-1), 1n))).toBe("Miri does not support calls to mmap with MAP_FIXED as part of the flags argument");
  expect(unsup_msg(cx.mmap(op(0), op(4096), op(1), op(0x122), op(-1), 1n))).toBe("Miri does not support calls to mmap/mprotect with protections other than PROT_READ|PROT_WRITE");
});

test("munmap: EINVAL on a misaligned address, else a page-rounded Mmap deallocation", () => {
  const { cx, log } = mem_cx();
  const bad = cx.munmap(op(0x10001), op(10));
  expect(bad.$ === "Ok" && Scalar.to_i32(bad._0)).toEqual({ $: "Ok", _0: -1 });
  const ok = cx.munmap(op(0x10000), op(10));
  expect(ok.$ === "Ok" && Scalar.to_i32(ok._0)).toEqual({ $: "Ok", _0: 0 });
  expect(log).toEqual(["errno EINVAL", `dealloc 4096 align 4096 {"$":"Machine","_0":"Mmap"}`]);
});

test("madvise / mprotect: unsupported advice and protections, ENOMEM on overflowing lengths", () => {
  const { cx, log } = mem_cx({ check_ptr_access: () => interp_ok(undefined) });
  expect(unsup_msg(cx.madvise(op(0x10000), op(10), op(4)))).toBe(
    "Miri does not support calls to madvise with advice other than MADV_NORMAL, MADV_RANDOM, MADV_SEQUENTIAL, or MADV_WILLNEED",
  );
  expect(unsup_msg(cx.mprotect(op(0x10000), op(10), op(1)))).toBe("Miri does not support calls to mmap/mprotect with protections other than PROT_READ|PROT_WRITE");
  expect(cx.mprotect(op(0x10000), op(0xffff_ffff_ffff_ffffn), op(3)).$).toBe("Ok");
  expect(cx.madvise(op(0x10000), op(10), op(3)).$).toBe("Ok");
  expect(log).toEqual(["errno ENOMEM"]);
  const { cx: cx2 } = mem_cx({
    check_ptr_access: () => Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "dangling" } })),
  });
  // `map_err_kind` replaces the error with the shim's own UB message.
  expect(ub_msg(cx2.mprotect(op(0x10000), op(10), op(3)))).toBe("`mprotect` called on out-of-bounds memory");
  expect(ub_msg(cx2.madvise(op(0x10000), op(10), op(0)))).toBe("`madvise` called on out-of-bounds memory");
});

// ---- unix/env.rs ----

// Oracle (envorder.rs with `-Zmiri-env-set=A=1 -Zmiri-env-set=B=2 -Zmiri-env-set=CC=3 -Zmiri-env-set=HOME=/h
// -Zmiri-env-set=Z=26`): `std::env::vars()` walks `environ` in the order HOME, B, A, CC, Z; after `set_var("NEWVAR")`
// and `remove_var("A")`: NEWVAR, HOME, B, CC, Z. `getenv B=Ok("2")`, `getenv MISSING=Err(NotPresent)`.
test("UnixEnvVars::new / update_environ lay out the environ block in hashbrown (OsString-keyed Fx) order", () => {
  create_default_session_globals_then(() => {
    // `MiriConfig.set_env_vars` (FxHashMap<String, String>, argv order) → `EnvVars::init`'s FxHashMap<OsString, OsString>.
    const set_env_vars = FxHashMap.default<string, string>(String_key, LAYOUT_VEC);
    for (const [k, v] of [["A", "1"], ["B", "2"], ["CC", "3"], ["HOME", "/h"], ["Z", "26"]] as const) set_env_vars.set(k, v);
    const env_vars = FxHashMap.default<string, string>(OsString_key, LAYOUT_VEC);
    for (const [k, v] of set_env_vars) env_vars.set(k, v);

    let next = 0x1000n;
    const strings = new Map<bigint, string>();
    const blocks: string[][] = [];
    const memory = new Map<unknown, Pointer>();
    const new_array = Ty.new_array;
    (Ty as { new_array: unknown }).new_array = (_tcx: unknown, _ty: unknown, n: number) => ({ n });
    try {
      const cx = fake_cx({
        data_layout: () => DL,
        machine: { layouts: { unit_ptr_mut: { ty: "ptr" } }, env_vars: undefined },
        tcx: { deref: () => ({}) },
        alloc_os_str_as_c_str: (s: string) => {
          const p = Pointer.without_provenance(next);
          strings.set(next, s);
          next += 0x100n;
          return interp_ok(p);
        },
        layout_of: (t: { n: number }) => interp_ok({ n: t.n }),
        allocate: (l: { n?: number }) => {
          const place = { n: l.n, slots: [] as string[], ptr: () => Pointer.without_provenance(0x9000n) };
          if (l.n !== undefined) blocks.push(place.slots);
          return interp_ok(place);
        },
        project_field: (place: { slots: string[] }, idx: number) => interp_ok({ place, idx }),
        write_pointer: (p: Pointer, dest: { place?: { slots: string[] } }) => {
          if (dest.place !== undefined) dest.place.slots.push(p.provenance === undefined && p.offset.bytes_u64() === 0n ? "NULL" : strings.get(p.offset.bytes_u64())!);
          else memory.set(dest, p);
          return interp_ok(undefined);
        },
        read_pointer: (place: unknown) => interp_ok(memory.get(place) ?? Pointer.without_provenance(0x9000n)),
        read_os_str_from_c_str: (p: Pointer) => interp_ok((strings.get(p.offset.bytes_u64() - 2n) ?? "?").split("=")[1]),
        deallocate_ptr: () => interp_ok(undefined),
        assert_target_os_is_unix: () => {},
      });
      const vars = unwrap_result(UnixEnvVars.new(cx, env_vars), () => "new");
      expect(blocks).toEqual([["HOME=/h", "B=2", "A=1", "CC=3", "Z=26", "NULL"]]);

      // getenv's lookup: the pointer past "{name}=".
      const b = unwrap_result(vars.get_ptr(cx, "B"), () => "get_ptr");
      expect(b!.offset.bytes_u64() - 2n).toBe([...strings].find(([, s]) => s === "B=2")![0]);
      expect(unwrap_result(vars.get_ptr(cx, "MISSING"), () => "get_ptr")).toBeUndefined();

      // setenv("NEWVAR") / unsetenv("A") on the same map, then the re-laid environ block.
      (cx.machine as { env_vars: unknown }).env_vars = { $: "Unix", _0: vars };
      vars.map.set("NEWVAR", Pointer.without_provenance(next));
      strings.set(next, "NEWVAR=x");
      vars.map.delete("A");
      expect(cx.update_environ().$).toBe("Ok");
      expect(blocks[1]).toEqual(["NEWVAR=x", "HOME=/h", "B=2", "CC=3", "Z=26", "NULL"]);
    } finally {
      (Ty as { new_array: unknown }).new_array = new_array;
    }
  });
});

// Oracle (getcwd.rs, default isolation): `error: unsupported operation: \`getcwd\` not available when isolation is
// enabled`; with `-Zmiri-isolation-error=warn-nobacktrace`: `warning: \`getcwd\` was made to return an error due to
// isolation` and `Err(PermissionDenied)`.
test("getcwd / chdir under isolation: the oracle's abort message and warning", () => {
  const warnings: string[] = [];
  const mk = (reject_with: string) =>
    fake_cx({
      data_layout: () => DL,
      machine: { isolated_op: { $: "Reject", _0: reject_with } },
      tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" } } }, dcx: () => ({ warn: (m: string) => warnings.push(m) }) }) },
      assert_target_os_is_unix: () => {},
      read_pointer: () => interp_ok(Pointer.without_provenance(0x1000n)),
      read_target_usize: () => interp_ok(512n),
      read_path_from_c_str: () => interp_ok("/tmp"),
    });
  for (const [f, name] of [
    [(cx: MiriInterpCx) => cx.getcwd(op(0), op(0)), "`getcwd`"],
    [(cx: MiriInterpCx) => cx.chdir(op(0)), "`chdir`"],
  ] as const) {
    const r = f(mk("Abort"));
    expect(r.$).toBe("Err");
    if (r.$ !== "Err") continue;
    const k = r._0.kind();
    expect(k.$).toBe("MachineStop");
    if (k.$ !== "MachineStop") continue;
    expect(TerminationInfoStop.downcast_ref(k._0)).toEqual({ $: "UnsupportedInIsolation", _0: `${name} not available when isolation is enabled` });
  }
  // The warning path warns once, sets errno from `IoError::from(ErrorKind::PermissionDenied)` (lane miri-shims-b; it
  // stops `unported` until that lands) and returns NULL (the oracle's `Err(PermissionDenied)`).
  const errnos: unknown[] = [];
  const warn_cx = mk("WarningWithoutBacktrace");
  Object.assign(warn_cx, {
    set_last_error: (e: unknown) => {
      errnos.push(e);
      return interp_ok(undefined);
    },
  });
  const r = warn_cx.getcwd(op(0), op(0));
  expect(warnings).toEqual(["`getcwd` was made to return an error due to isolation"]);
  // `this.set_last_error(ErrorKind::PermissionDenied)?` and a NULL return.
  expect(r.$ === "Ok" && r._0.offset.bytes_u64() === 0n && r._0.provenance === undefined).toBe(true);
  expect(errnos.length).toBe(1);
  const e = errnos[0] as { $: string; _0: unknown };
  expect(e.$).toBe("HostError");
  expect(e._0).toEqual({ $: "Simple", kind: "PermissionDenied" });
  expect(IoError_kind(e._0 as never)).toBe("PermissionDenied");
});

test("gethostname: zero length is UB; a short buffer on linux-gnu writes without the null and sets ENAMETOOLONG", () => {
  const writes: number[][] = [];
  const errs: string[] = [];
  const cx = fake_cx({
    data_layout: () => DL,
    tcx: { deref: () => ({ sess: { target: { os: { $: "Linux" }, env: { $: "Gnu" } } } }) },
    assert_target_os_is_unix: () => {},
    read_pointer: () => interp_ok(Pointer.without_provenance(0x1000n)),
    read_target_usize: (o: { v: bigint }) => interp_ok(BigInt(o.v)),
    check_ptr_access: () => interp_ok(undefined),
    write_bytes_ptr: (_p: unknown, it: Iterable<number>) => {
      writes.push([...it]);
      return interp_ok(undefined);
    },
    write_c_str: (s: Uint8Array) => {
      writes.push([...s, 0]);
      return interp_ok([true, BigInt(s.length + 1)]);
    },
    set_errno_and_return_neg1_i32: (e: { _0: string }) => {
      errs.push(e._0);
      return interp_ok(Scalar.from_i32(-1));
    },
  });
  expect(ub_msg(cx.gethostname(op(0), op(0)))).toBe("`gethostname` called with a length of zero");
  expect(cx.gethostname(op(0), op(3)).$).toBe("Ok");
  expect(cx.gethostname(op(0), op(64)).$).toBe("Ok");
  expect(writes).toEqual([[...HOSTNAME.subarray(0, 3)], [...HOSTNAME, 0]]);
  expect(errs).toEqual(["ENAMETOOLONG"]);
});

test("unix/mod.rs constants", () => {
  expect(UID).toBe(1000);
  expect(new TextDecoder().decode(HOSTNAME)).toBe("Miri");
});

// ---- unix/thread.rs ----

test("pthread_setname_np / pthread_getname_np: truncation and NameTooLong", () => {
  const names = new Map<number, number[]>();
  const written: number[][] = [];
  const cx = fake_cx({
    data_layout: () => DL,
    libc_ty_layout: () => ({ size: Size.from_bytes(8) }),
    thread_id_try_from: (id: bigint) => (id === 1n ? { $: "Ok", _0: ThreadId.new_unchecked(1) } : { $: "Err", _0: { $: "InvalidId" } }),
    read_c_str: () => interp_ok(new TextEncoder().encode("abcdefghij")),
    set_thread_name: (t: ThreadId, n: number[]) => names.set(t.to_u32(), n),
    get_thread_name: (t: ThreadId) => names.get(t.to_u32()),
    write_c_str: (s: Uint8Array, _p: unknown, size: bigint) => {
      if (size < BigInt(s.length + 1)) return interp_ok([false, BigInt(s.length + 1)]);
      written.push([...s]);
      return interp_ok([true, BigInt(s.length + 1)]);
    },
  });
  const t1 = Scalar.from_uint<Provenance>(1n, Size.from_bytes(8));
  const name = Scalar.from_uint<Provenance>(0x1000n, Size.from_bytes(8));
  expect(cx.pthread_setname_np(t1, name, 16n, false)).toEqual({ $: "Ok", _0: "Ok" });
  expect(cx.pthread_setname_np(t1, name, 10n, false)).toEqual({ $: "Ok", _0: "NameTooLong" });
  expect(cx.pthread_setname_np(t1, name, 5n, true)).toEqual({ $: "Ok", _0: "Ok" });
  expect(new TextDecoder().decode(Uint8Array.from(names.get(1)!))).toBe("abcd");
  expect(ub_msg(cx.pthread_setname_np(Scalar.from_uint<Provenance>(7n, Size.from_bytes(8)), name, 16n, false))).toBe("pthread_setname_np: invalid pthread_t handle");

  expect(cx.pthread_getname_np(t1, name, Scalar.from_uint<Provenance>(3n, Size.from_bytes(8)), false)).toEqual({ $: "Ok", _0: "NameTooLong" });
  expect(cx.pthread_getname_np(t1, name, Scalar.from_uint<Provenance>(3n, Size.from_bytes(8)), true)).toEqual({ $: "Ok", _0: "Ok" });
  expect(new TextDecoder().decode(Uint8Array.from(written[0]!))).toBe("ab");
  names.clear();
  expect(cx.pthread_getname_np(t1, name, Scalar.from_uint<Provenance>(64n, Size.from_bytes(8)), false)).toEqual({ $: "Ok", _0: "Ok" });
  expect(new TextDecoder().decode(Uint8Array.from(written[1]!))).toBe("<unnamed>");
});

// ---- unix/foreign_items.rs ----

test("is_dyn_sym: the unix names, the Solaris exception, other OSes stop unported", () => {
  const linux = { $: "Linux" } as never;
  for (const n of ["strlen", "signal", "getentropy", "getrandom", "futimens", "preadv", "pwritev"]) expect(is_dyn_sym(n, linux)).toBe(true);
  expect(is_dyn_sym("preadv", { $: "Hermit" } as never)).toBe(true);
  expect(is_dyn_sym("other", { $: "Hermit" } as never)).toBe(false);
  expect(() => is_dyn_sym("preadv", { $: "Solaris" } as never)).toThrow(Unported);
  expect(is_dyn_sym("strlen", { $: "Solaris" } as never)).toBe(true);
  expect(() => is_dyn_sym("x", { $: "MacOs" } as never)).toThrow(Unported);
});

test("sysconf: the SYSCONFS table, unimplemented names are unsupported", () => {
  const consts: Record<string, number> = { _SC_PAGESIZE: 30, _SC_PAGE_SIZE: 30, _SC_NPROCESSORS_CONF: 83, _SC_NPROCESSORS_ONLN: 84, _SC_GETPW_R_SIZE_MAX: 70, _SC_OPEN_MAX: 4, _SC_HOST_NAME_MAX: 180 };
  const cx = fake_cx({
    data_layout: () => DL,
    machine: { page_size: 4096n, num_cpus: 1 },
    read_scalar: (o: { v: number }) => interp_ok(Scalar.from_i32(o.v)),
    eval_libc_i32: (n: string) => consts[n]!,
  });
  const val = (n: number) => {
    const r = cx.sysconf(op(n));
    return r.$ === "Ok" ? unwrap_result(Scalar.to_int(r._0, Size.from_bytes(8)), () => "") : unsup_msg(r);
  };
  expect(val(30)).toBe(4096n);
  expect(val(84)).toBe(1n);
  expect(val(4)).toBe(65536n);
  expect(val(180)).toBe(255n);
  expect(val(70)).toBe(512n);
  expect(val(999)).toBe("unimplemented sysconf name: 999");
});

test("dispatcher: a failed `frame_in_std` guard falls to the platform arm; no OS module → NotSupported", () => {
  create_default_session_globals_then(() => {
    const cx = fake_cx({
      machine: { communicate: () => false },
      tcx: { deref: () => ({ sess: { target: { os: { $: "Hermit" } } } }) },
      frame_in_std: () => false,
    });
    for (const name of ["signal", "sigaction", "pthread_attr_init", "getpwuid_r", "no_such_fn"]) {
      expect(emulate_foreign_item_inner(cx, Symbol.intern(name), {} as never, [], {} as never)).toEqual({ $: "Ok", _0: "NotSupported" });
    }
    // Other unix OSes are out of scope (plan-m6 D2).
    const mac = fake_cx({ machine: { communicate: () => false }, tcx: { deref: () => ({ sess: { target: { os: { $: "MacOs" } } } }) }, frame_in_std: () => false });
    expect(() => emulate_foreign_item_inner(mac, Symbol.intern("no_such_fn"), {} as never, [], {} as never)).toThrow(Unported);
  });
});

// ---- shims/readiness.rs ----

const fdid = (n: number) => new FdId(n);
const key = (id: number, num: number): ReadinessInterestKey => [fdid(id), num];
const R = (o: Partial<Readiness>): Readiness => ({ ...Readiness_EMPTY, ...o });

test("InterestMap iterates in BTreeMap order ((FdId, FdNum) tuple Ord) and looks tuples up by value", () => {
  const m = new InterestMap();
  const mk = () => new ReadinessInterest({} as never, R({}), false, 0n, R({}));
  for (const k of [key(2, 5), key(1, 7), key(1, 3), key(10, 0), key(1, 0x7fff_ffff)]) m.set(k, mk());
  expect([...m.keys()].map(([i, n]) => `${i._0}:${n}`)).toEqual(["1:3", "1:7", "1:2147483647", "2:5", "10:0"]);
  expect(m.has(key(1, 7))).toBe(true);
  expect(m.range([key(1, 0), key(1, 0x7fff_ffff)]).map(([[i, n]]) => `${i._0}:${n}`)).toEqual(["1:3", "1:7", "1:2147483647"]);
  m.retain(([i]) => i._0 !== 1);
  expect([...m.keys()].map(([i, n]) => `${i._0}:${n}`)).toEqual(["2:5", "10:0"]);
});

test("update_readiness: edge detection, de-duplicated ready queue, un-triggering, waking blocked threads", () => {
  const woken: number[] = [];
  const cx = fake_cx({
    unblock_thread: (t: ThreadId, reason: { $: string }) => {
      woken.push(t.to_u32());
      expect(reason.$).toBe("Readiness");
      return interp_ok(undefined);
    },
  });
  const w = Rc_new_ReadinessWatcher();
  const i1 = new ReadinessInterest({} as never, R({ readable: true }), true, 1n, R({}));
  const k1 = key(1, 3);
  const each = (cb: (k: ReadinessInterestKey, i: ReadinessInterest) => InterpResult<undefined>) => cb(k1, i1);
  // A new readable bit is an edge: queued once even if reported twice with `force_edge`.
  expect(cx.update_readiness(w, R({ readable: true, writable: true }), false, each).$).toBe("Ok");
  expect(i1.active_()).toEqual(R({ readable: true }));
  expect(w.ready_count()).toBe(1);
  expect(cx.update_readiness(w, R({ readable: true }), true, each).$).toBe("Ok");
  expect(w.ready_count()).toBe(1);
  // Nothing relevant active: un-triggered.
  expect(cx.update_readiness(w, R({ writable: true }), false, each).$).toBe("Ok");
  expect(w.ready_count()).toBe(0);
  // Blocked threads are woken while events are ready.
  w.add_blocked_thread(ThreadId.new_unchecked(4));
  w.add_blocked_thread(ThreadId.new_unchecked(5));
  w.remove_blocked_thread(ThreadId.new_unchecked(5));
  w.add_blocked_thread(ThreadId.new_unchecked(6));
  expect(cx.update_readiness(w, R({ readable: true }), false, each).$).toBe("Ok");
  expect(woken).toEqual([4, 6]);
});

test("Rc<ReadinessWatcher> / Drop: dead watchers leave the watched FD's list; a closed FD's interests leave the watcher", () => {
  const watched = ReadinessWatched_default();
  // `upgrade()` hands out an owned strong handle (files.ts's Rc protocol); readiness.rs drops each one.
  const inner = { readiness_watched: () => watched };
  let live = 0;
  const upgrade = () => {
    live += 1;
    let dropped = false;
    return {
      _0: { id: fdid(1), inner },
      deref: () => inner,
      drop: () => {
        expect(dropped).toBe(false);
        dropped = true;
        live -= 1;
      },
    };
  };
  const weak_fd = { upgrade, is_closed: () => false };
  const w1 = Rc_new_ReadinessWatcher();
  const w2 = Rc_new_ReadinessWatcher();
  for (const w of [w1, w2]) {
    w.interests.set(key(1, 3), new ReadinessInterest(weak_fd as never, R({ readable: true }), false, 0n, R({})));
    watched.insert(w);
  }
  expect(watched.watchers.length).toBe(2);
  // A clone keeps w1 alive; dropping both runs `Drop`, which prunes it from the FD's list.
  Rc_clone_ReadinessWatcher(w1);
  Rc_drop_ReadinessWatcher(w1);
  expect(watched.watchers.length).toBe(2);
  Rc_drop_ReadinessWatcher(w1);
  expect(watched.watchers.length).toBe(1);
  expect(watched.has_watcher_with_blocked_thread()).toBe(false);
  w2.add_blocked_thread(ThreadId.new_unchecked(2));
  expect(watched.has_watcher_with_blocked_thread()).toBe(true);
  // Dropping the watched FD (its description closed) removes its interests (and ready events) from live watchers.
  w2.ready.push(key(1, 3));
  (weak_fd as { is_closed: () => boolean }).is_closed = () => true;
  watched.drop();
  expect(w2.interests.size).toBe(0);
  expect(w2.ready).toEqual([]);
  // Every upgraded handle was released.
  expect(live).toBe(0);
});
