// Tests of lane miri-shims-d's unix/fd.ts (close / dup / dup2) and unix/socket.ts (the A3 isolation path). The other fd
// shims run end to end against the oracle in fd_ops.oracle.test.ts; flock's lock path and F_GETFL / F_SETFL's success
// path need a host file (isolation off, not ported: D14) and are tested here on a stand-in description.
//
// `FdTable` (files.rs) and the errno shims (io_error.rs) belong to lane miri-shims-b and are still placeholders on this
// branch, so the shims run on a stand-in `ecx` (`InterpCx.prototype`, Linux target) whose `machine.fds` is a test double
// with upstream `FdTable`'s semantics (files.rs:590-660: `get` clones the `Rc`, `remove` takes it, `insert` /
// `insert_with_min_num` pick the lowest free number >= min) and refcounted handles (shims-b's protocol: `deref()`,
// `drop()`, `as_unix(self_)` returns the same handle). `set_errno_and_return_neg1_i32` records the error and returns
// `-1` (io_error.rs:318). Every test also checks that the shims leak no handle (live handles == table entries).
import { expect, test } from "bun:test";
import "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { TerminationInfoStop, display_TerminationInfo } from "../../diagnostics.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { interp_ok, Scalar, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { Unported } from "../../../std/panic.ts";

interface Desc {
  name: string;
  strong: number;
  closed: boolean;
  /** The description's own unix methods (`flock`, `get_flags`, ...). */
  methods?: Record<string, unknown>;
}
class Handle {
  constructor(readonly desc: Desc) {
    desc.strong++;
  }
  live = true;
  deref(): unknown {
    expect(this.live).toBe(true);
    const self_desc = this.desc;
    return {
      name: () => self_desc.name,
      as_unix: (self_: Handle) => self_,
      readiness_watched: () => undefined,
      ...self_desc.methods,
    };
  }
  drop(): void {
    expect(this.live).toBe(true);
    this.live = false;
    if (--this.desc.strong === 0) this.desc.closed = true;
  }
  clone(): Handle {
    return new Handle(this.desc);
  }
}
class FdTableDouble {
  fds = new Map<number, Handle>();
  get(n: number): Handle | undefined {
    return this.fds.get(n)?.clone();
  }
  remove(n: number): Handle | undefined {
    const h = this.fds.get(n);
    this.fds.delete(n);
    return h;
  }
  is_fd_num(n: number): boolean {
    return this.fds.has(n);
  }
  insert(h: Handle): number {
    return this.insert_with_min_num(h, 0);
  }
  insert_with_min_num(h: Handle, min: number): number {
    let candidate = min;
    for (const n of [...this.fds.keys()].sort((a, b) => a - b)) {
      if (n < min) continue;
      if (n === candidate) candidate++;
      else break;
    }
    expect(this.fds.has(candidate)).toBe(false);
    this.fds.set(candidate, h);
    return candidate;
  }
}

function setup(isolated_op: unknown = { $: "Reject", _0: "Abort" }) {
  const descs = ["stdin", "stdout", "stderr"].map((name): Desc => ({ name, strong: 0, closed: false }));
  const fds = new FdTableDouble();
  for (const d of descs) fds.insert(new Handle(d));
  const errors: unknown[] = [];
  const ecx_ = Object.create(InterpCx.prototype) as Record<string, unknown>;
  ecx_.machine = { fds, isolated_op };
  ecx_.tcx = { deref: () => ({ sess: { target: { os: { $: "Linux" } } } }) };
  ecx_.set_errno_and_return_neg1_i32 = (err: unknown): InterpResult<Scalar> => {
    errors.push(err);
    return interp_ok(Scalar.from_i32(-1));
  };
  const live = () => descs.reduce((n, d) => n + d.strong, 0);
  const ecx = ecx_ as unknown as MiriInterpCx & Record<string, unknown>;
  return { ecx, fds, descs, errors, live };
}
const i32 = (r: InterpResult<unknown>): number => {
  expect(r.$).toBe("Ok");
  if (r.$ !== "Ok") return NaN;
  const v = Scalar.to_i32(r._0 as Scalar);
  return v.$ === "Ok" ? v._0 : NaN;
};

test("dup takes the lowest free number; both descriptors share the description", () => {
  const { ecx, fds, descs, live } = setup();
  expect(i32(ecx.dup(1))).toBe(3);
  expect(fds.fds.get(3)!.desc).toBe(descs[1]);
  expect(descs[1]!.strong).toBe(2);
  expect(i32(ecx.dup(2))).toBe(4);
  expect(live()).toBe(fds.fds.size);
});

test("close drops one descriptor; the description closes with its last descriptor", () => {
  const { ecx, fds, descs, live } = setup();
  expect(i32(ecx.dup(1))).toBe(3);
  expect(i32(ecx.close(1))).toBe(0);
  expect(descs[1]!.closed).toBe(false);
  expect(fds.is_fd_num(1)).toBe(false);
  // The freed number is reused.
  expect(i32(ecx.dup(0))).toBe(1);
  expect(i32(ecx.close(3))).toBe(0);
  expect(descs[1]!.closed).toBe(true);
  expect(live()).toBe(fds.fds.size);
});

test("dup2 closes the target, keeps the number, and is a no-op onto itself", () => {
  const { ecx, fds, descs, live } = setup();
  expect(i32(ecx.dup2(1, 0))).toBe(0);
  expect(descs[0]!.closed).toBe(true);
  expect(fds.fds.get(0)!.desc).toBe(descs[1]);
  expect(i32(ecx.dup2(2, 7))).toBe(7);
  expect(fds.fds.get(7)!.desc).toBe(descs[2]);
  expect(i32(ecx.dup2(2, 2))).toBe(2);
  expect(descs[2]!.strong).toBe(2);
  expect(live()).toBe(fds.fds.size);
});

test("close / dup / dup2 of a closed descriptor fail with EBADF", () => {
  const { ecx, fds, errors, live } = setup();
  expect(i32(ecx.close(42))).toBe(-1);
  expect(i32(ecx.dup(42))).toBe(-1);
  expect(i32(ecx.dup2(42, 1))).toBe(-1);
  expect(errors).toEqual([
    { $: "LibcError", _0: "EBADF" },
    { $: "LibcError", _0: "EBADF" },
    { $: "LibcError", _0: "EBADF" },
  ]);
  expect(live()).toBe(fds.fds.size);
});

/** An `OpTy` holding an `i32` (`read_scalar` of the stand-in returns it). */
const op_i32 = (v: number) => ({ layout: { size: Size.from_bytes(4n) }, v });
function socket_ecx(isolated_op: unknown) {
  const s = setup(isolated_op);
  (s.ecx as Record<string, unknown>).read_scalar = (op: { v: number }) => interp_ok(Scalar.from_i32(op.v));
  return s;
}

test("socket with isolation (default `Reject(Abort)`): Miri's isolation error", () => {
  const { ecx } = socket_ecx({ $: "Reject", _0: "Abort" });
  const r = ecx.socket(op_i32(2) as never, op_i32(1) as never, op_i32(0) as never);
  expect(r.$).toBe("Err");
  if (r.$ !== "Err") return;
  const kind = r._0.kind();
  expect(kind.$).toBe("MachineStop");
  if (kind.$ !== "MachineStop") return;
  const info = TerminationInfoStop.downcast_ref(kind._0)!;
  expect(info).toEqual({ $: "UnsupportedInIsolation", _0: "`socket` not available when isolation is enabled" });
  expect(display_TerminationInfo(info)).toBe("`socket` not available when isolation is enabled");
});

test("socket with `-Zmiri-isolation-error=hide`: returns -1 with EACCES", () => {
  const { ecx, errors } = socket_ecx({ $: "Reject", _0: "NoWarning" });
  expect(i32(ecx.socket(op_i32(2) as never, op_i32(1) as never, op_i32(0) as never))).toBe(-1);
  expect(errors).toEqual([{ $: "LibcError", _0: "EACCES" }]);
});

test("socket without isolation and the other socket shims stop unported (plan-m6 D2/A3)", () => {
  const { ecx } = socket_ecx({ $: "Allow" });
  ecx.eval_libc_i32 = (name: string): number =>
    ({ SOCK_NONBLOCK: 0o4000, SOCK_CLOEXEC: 0o2000000, AF_INET: 2, AF_INET6: 10, SOCK_STREAM: 1, IPPROTO_TCP: 6 })[name]!;
  expect(() => ecx.socket(op_i32(2) as never, op_i32(1) as never, op_i32(0) as never)).toThrow(Unported);
  expect(() => ecx.bind(undefined as never, undefined as never, undefined as never)).toThrow(Unported);
  // The flag checks before the host socket are ported: an unsupported domain is Miri's error.
  const r = ecx.socket(op_i32(1) as never, op_i32(1) as never, op_i32(0) as never);
  expect(r.$).toBe("Err");
  if (r.$ !== "Err") return;
  expect(r._0.kind()).toEqual({
    $: "Unsupported",
    _0: { $: "Unsupported", _0: "socket: domain 0x1 is unsupported, only AF_INET and AF_INET6 are allowed." },
  });
});

// ---- flock's lock path and F_GETFL / F_SETFL's success path on a stand-in description ----

/** The target's libc constants the shims read with `eval_libc_i32`, as `libc::*` prints them under the isolated Miri. */
const LIBC: Record<string, number> = {
  LOCK_SH: 1,
  LOCK_EX: 2,
  LOCK_NB: 4,
  LOCK_UN: 8,
  F_GETFL: 3,
  F_SETFL: 4,
  O_NONBLOCK: 2048,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
};

/** `setup` plus fd 3, a description with the given unix methods. */
function file_setup(methods: Record<string, unknown>) {
  const s = setup();
  const d: Desc = { name: "file", strong: 0, closed: false, methods };
  s.descs.push(d);
  const fd = s.fds.insert(new Handle(d));
  expect(fd).toBe(3);
  const e = s.ecx as Record<string, unknown>;
  e.eval_libc_i32 = (name: string) => LIBC[name] ?? 1000;
  e.read_scalar = (op: { v: number }) => interp_ok(Scalar.from_i32(op.v));
  (e.machine as Record<string, unknown>).communicate = () => true;
  e.try_unwrap_io_result = (r: { $: string; _0: unknown }, f: (v: never) => number) => {
    if (r.$ === "Ok") return interp_ok(f(r._0 as never));
    s.errors.push(r._0);
    return interp_ok(-1);
  };
  e.check_varargs = (_sig: unknown, varargs: OpTy[]) => interp_ok([varargs]);
  return { ...s, fd };
}
type OpTy = ReturnType<typeof op_i32>;

test("flock parses every op upstream accepts and leaks no handle", () => {
  const calls: unknown[] = [];
  const { ecx, fds, fd, live } = file_setup({
    flock: (communicate: boolean, op: unknown) => {
      calls.push([communicate, op]);
      return interp_ok({ $: "Ok", _0: null });
    },
  });
  for (const op of [LIBC.LOCK_SH!, LIBC.LOCK_SH! | LIBC.LOCK_NB!, LIBC.LOCK_EX!, LIBC.LOCK_EX! | LIBC.LOCK_NB!, LIBC.LOCK_UN!]) {
    expect(i32(ecx.flock(fd, op))).toBe(0);
  }
  expect(calls).toEqual([
    [true, { $: "SharedLock", nonblocking: false }],
    [true, { $: "SharedLock", nonblocking: true }],
    [true, { $: "ExclusiveLock", nonblocking: false }],
    [true, { $: "ExclusiveLock", nonblocking: true }],
    [true, { $: "Unlock" }],
  ]);
  expect(live()).toBe(fds.fds.size);
});

test("flock hands a host error to the io-error path; unknown flags stop with the handle released", () => {
  const { ecx, fds, fd, live, errors } = file_setup({ flock: () => interp_ok({ $: "Err", _0: "would block" }) });
  expect(i32(ecx.flock(fd, LIBC.LOCK_EX! | LIBC.LOCK_NB!))).toBe(-1);
  expect(errors).toEqual(["would block"]);
  expect(live()).toBe(fds.fds.size);
  // The text is the oracle's: see `flock-flags` in fd_ops.oracle.test.ts.
  const r = ecx.flock(fd, LIBC.LOCK_SH! | LIBC.LOCK_EX!);
  expect(r.$).toBe("Err");
  if (r.$ === "Err") {
    const kind = r._0.kind();
    expect(kind.$ === "Unsupported" && (kind._0 as { _0: string })._0).toBe("unsupported flags 0x3");
  }
  expect(live()).toBe(fds.fds.size);
});

test("fcntl F_GETFL and F_SETFL reach the description, F_SETFL drops the flags it never stores, no handle leaks", () => {
  const set: number[] = [];
  const { ecx, fds, fd, live } = file_setup({
    get_flags: () => interp_ok(Scalar.from_i32(LIBC.O_RDWR!)),
    set_flags: (flag: number) => {
      set.push(flag);
      return interp_ok(Scalar.from_i32(0));
    },
  });
  expect(i32(ecx.fcntl(op_i32(fd) as never, op_i32(LIBC.F_GETFL!) as never, [] as never))).toBe(LIBC.O_RDWR!);
  expect(live()).toBe(fds.fds.size);
  const flags = LIBC.O_NONBLOCK! | LIBC.O_RDWR! | LIBC.O_WRONLY! | LIBC.O_CREAT! | LIBC.O_EXCL! | LIBC.O_NOCTTY! | LIBC.O_TRUNC!;
  expect(i32(ecx.fcntl(op_i32(fd) as never, op_i32(LIBC.F_SETFL!) as never, [op_i32(flags)] as never))).toBe(0);
  expect(set).toEqual([LIBC.O_NONBLOCK!]);
  expect(live()).toBe(fds.fds.size);
});
