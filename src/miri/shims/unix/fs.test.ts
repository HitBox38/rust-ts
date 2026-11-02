// Unit tests of lane miri-fs (src/miri/shims/unix/fs.ts, port of src/tools/miri/src/shims/unix/fs.rs): the isolation-on
// paths of every fs entry point, with a stub interpreter (an `InterpCx` prototype object whose `machine` is a bare
// `MiriMachine` and whose calls into other wave-37 lanes are own properties). Our own test, not an upstream mirror.
//
// Expected values come from the isolated Miri oracle (plan-m6 D1; `$RUST_TS_DATA/tmp/miri-fs/`, see docs/handoff/miri-fs.md):
// - `std::fs::File::open("foo.txt")` under default isolation stops with
//   "error: unsupported operation: `open` not available when isolation is enabled";
// - a libc program calling each fs fn under `-Zmiri-isolation-error=warn-nobacktrace` printed
//   "warning: `<op>` was made to return an error due to isolation" and the errno in ERRNO below;
// - flag validation: `open(p, 3)` -> "open: unsupported access mode 0x3", `open(p, O_RDONLY | 0x10000000)` ->
//   "open: unsupported flags: 0x10000000", `O_TMPFILE` -> EOPNOTSUPP, `O_CREAT | O_DIRECTORY` -> EINVAL (no warning: these
//   precede the isolation check), NULL paths -> EFAULT (chmod, rename, utimensat, statx), `/proc/..` -> the
//   FileInProcOpened diagnostic before the isolation error.
// The libc constants are the oracle's (x86_64-unknown-linux-gnu, printed by the same Miri).
import { expect, test } from "bun:test";
import "../../lib.ts";
import { TerminationInfoStop } from "../../diagnostics.ts";
import { MiriMachine, type MiriInterpCx } from "../../machine.ts";
import { DirTable, DirStream } from "./fs.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { interp_ok, Pointer, Scalar, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { spec } from "../../../rustc_target/lib.ts";
import * as std_fs from "../../../std/fs.ts";
import { Panic, Unported } from "../../../std/panic.ts";

/** x86_64-unknown-linux-gnu libc constants (oracle). */
const LIBC: Record<string, number> = {
  O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_ACCMODE: 3, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024,
  O_DIRECTORY: 65536, O_NOFOLLOW: 131072, O_CLOEXEC: 524288, O_LARGEFILE: 0, O_TMPFILE: 4259840,
  AT_FDCWD: -100, AT_SYMLINK_NOFOLLOW: 256, AT_EMPTY_PATH: 4096, SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2,
  EPERM: 1, EACCES: 13, EBADF: 9, EINVAL: 22, EFAULT: 14, EOPNOTSUPP: 95, ENOTTY: 25, ENOENT: 2, ENOTDIR: 20,
  SYNC_FILE_RANGE_WAIT_BEFORE: 1, SYNC_FILE_RANGE_WRITE: 2, SYNC_FILE_RANGE_WAIT_AFTER: 4, TMP_MAX: 238328,
};
/** Errno the oracle printed for each op under `-Zmiri-isolation-error=warn-nobacktrace` (`std::io::ErrorKind`
 *  PermissionDenied maps to EPERM through io_error.rs's table, which runs for real here). */
const ERRNO: Record<string, number> = {
  open: 1, openat: 1, unlink: 1, symlink: 1, linkat: 1, stat: 13, lstat: 13, fstat: 9, fstatat: 13, chmod: 13,
  rename: 1, mkdir: 1, rmdir: 1, opendir: 13, readdir: 9, closedir: 9, posix_fallocate: 9, fallocate: 9, utimensat: 13,
  readlink: 13, realpath: 13, mkstemp: 13, statx: 13,
};

/** A fake operand: what `read_scalar` / `read_pointer` return for it. */
interface FakeOp {
  scalar?: Scalar<never>;
  ptr?: Pointer<never>;
}
const int = (i: number): FakeOp => ({ scalar: Scalar.from_i32(i) });
const ptr = (addr: number): FakeOp => ({ ptr: new Pointer(Size.from_bytes(addr), undefined as never) });
const NULL = ptr(0);
const PATH = ptr(0x1000);
const PATH2 = ptr(0x2000);
const PROC_PATH = ptr(0x3000);
const PATHS = new Map<number, string>([
  [0x1000, "foo.txt"],
  [0x2000, "bar.txt"],
  [0x3000, "/proc/foo"],
]);

interface Recorded {
  errno: unknown[];
  warnings: string[];
  diagnostics: unknown[];
  writes: unknown[];
}

function machine(reject_with: string, rec: Recorded): MiriMachine {
  return Object.assign(Object.create(MiriMachine.prototype) as MiriMachine, {
    isolated_op: reject_with === "Allow" ? { $: "Allow" } : { $: "Reject", _0: reject_with },
    dirs: DirTable.default(),
    fds: { get: () => undefined },
    emit_diagnostic: (e: unknown) => rec.diagnostics.push(e),
  });
}

/** A stub interpreter for the x86_64-linux target. */
function ecx(reject_with: string): [MiriInterpCx, Recorded] {
  const rec: Recorded = { errno: [], warnings: [], diagnostics: [], writes: [] };
  const sess = { target: { os: spec.Os.Linux, families: ["unix"] } };
  const tcx = { deref: () => ({ sess, dcx: () => ({ warn: (m: string) => rec.warnings.push(m) }) }) };
  const own = {
    machine: machine(reject_with, rec),
    tcx,
    eval_context_ref() {
      return this;
    },
    eval_context_mut() {
      return this;
    },
    read_scalar: (op: FakeOp): InterpResult<Scalar<never>> => interp_ok(op.scalar!),
    read_pointer: (op: FakeOp): InterpResult<Pointer<never>> => interp_ok(op.ptr!),
    read_target_usize: (op: FakeOp): InterpResult<bigint> => interp_ok(BigInt(op.ptr!.offset.bytes())),
    read_path_from_c_str: (p: Pointer): InterpResult<string> => interp_ok(PATHS.get(p.offset.bytes())!),
    read_os_str_from_c_str: (p: Pointer): InterpResult<string> => interp_ok(PATHS.get(p.offset.bytes())!),
    read_c_str: (_p: Pointer): InterpResult<Uint8Array> => interp_ok(new TextEncoder().encode("/tmp/fooXXXXXX")),
    deref_pointer_as: (op: FakeOp) => interp_ok(op.ptr),
    data_layout: () => ({ pointer_size: () => Size.from_bytes(8), pointer_offset: () => Size.from_bytes(8) }),
    ptr_is_null: (p: Pointer): InterpResult<boolean> => interp_ok(p.offset.bytes() === 0 && p.provenance === undefined),
    eval_libc: (name: string) => Scalar.from_i32(LIBC[name]!),
    eval_libc_i32: (name: string) => LIBC[name]!,
    eval_libc_u32: (name: string) => LIBC[name]!,
    libc_ty_layout: (_name: string) => ({ size: Size.from_bytes(4) }),
    check_varargs: (_tys: unknown, v: { args: FakeOp[] }) => interp_ok([v.args, { args: [], already_gone: 0 }]),
    // io_error.rs (lane miri-shims-b) runs for real down to the errno place: `last_error_place` / its write are stubs.
    last_error_place: () => interp_ok("ERRNO_PLACE"),
    write_scalar: (v: Scalar<never>, dest: unknown) => {
      if (dest === "ERRNO_PLACE") rec.errno.push(v);
      else rec.writes.push(["scalar", dest]);
      return interp_ok(undefined);
    },
    write_int: (i: bigint, dest: unknown) => {
      rec.writes.push(["int", i, dest]);
      return interp_ok(undefined);
    },
    write_null: (dest: unknown) => {
      rec.writes.push(["null", dest]);
      return interp_ok(undefined);
    },
  };
  return [Object.assign(Object.create(InterpCx.prototype) as MiriInterpCx, own), rec];
}

/** The machine stop of an `Err` (`TerminationInfo`), or the unsupported/UB message. */
function stop_of(r: InterpResult<unknown>): unknown {
  expect(r.$).toBe("Err");
  if (r.$ !== "Err") return undefined;
  const kind = r._0.kind();
  if (kind.$ === "MachineStop") return TerminationInfoStop.downcast_ref(kind._0);
  return kind;
}

/** The errno value written to the errno place. */
function errno_of(e: unknown): number {
  const r = Scalar.to_i32(e as Scalar<never>);
  if (r.$ !== "Ok") throw new Error("errno is not an i32");
  return r._0;
}

type Call = (cx: MiriInterpCx) => InterpResult<unknown>;
const any = undefined as never;
const CALLS: [string, Call][] = [
  ["open", (cx) => cx.open(undefined, PATH as never, int(LIBC.O_RDONLY!) as never, { args: [], already_gone: 2 })],
  ["openat", (cx) => cx.open(int(LIBC.AT_FDCWD!) as never, PATH as never, int(LIBC.O_RDONLY!) as never, { args: [], already_gone: 3 })],
  ["unlink", (cx) => cx.unlink(PATH as never)],
  ["symlink", (cx) => cx.symlink(PATH as never, PATH2 as never)],
  ["linkat", (cx) => cx.linkat(int(LIBC.AT_FDCWD!) as never, PATH as never, int(LIBC.AT_FDCWD!) as never, PATH2 as never, int(0) as never)],
  ["stat", (cx) => cx.stat(PATH as never, any)],
  ["lstat", (cx) => cx.lstat(PATH as never, any)],
  ["fstat", (cx) => cx.fstat(int(0) as never, any, "stat")],
  ["fstatat", (cx) => cx.fstatat(int(LIBC.AT_FDCWD!) as never, PATH as never, any, int(0) as never)],
  ["chmod", (cx) => cx.chmod(PATH as never, int(0o644) as never)],
  ["rename", (cx) => cx.rename(PATH as never, PATH2 as never)],
  ["mkdir", (cx) => cx.mkdir(PATH as never, int(0o755) as never)],
  ["rmdir", (cx) => cx.rmdir(PATH as never)],
  ["opendir", (cx) => cx.opendir(PATH as never)],
  ["readdir", (cx) => cx.readdir(ptr(1) as never, "DEST" as never, "dirent64")],
  ["closedir", (cx) => cx.closedir(ptr(1) as never)],
  ["posix_fallocate", (cx) => cx.posix_fallocate(3, 0n, 10n)],
  ["fallocate", (cx) => cx.linux_fallocate(3, 0, 0n, 10n)],
  ["utimensat", (cx) => cx.utimensat(int(LIBC.AT_FDCWD!) as never, PATH as never, NULL as never, int(0) as never)],
  ["readlink", (cx) => cx.readlink(PATH as never, ptr(0x4000) as never, { ptr: new Pointer(Size.from_bytes(16), undefined as never) } as never)],
  ["realpath", (cx) => cx.realpath(PATH as never, NULL as never)],
  ["mkstemp", (cx) => cx.mkstemp(ptr(0x5000) as never)],
  ["statx", (cx) => cx.linux_statx(int(LIBC.AT_FDCWD!) as never, PATH as never, int(0) as never, int(0) as never, ptr(0x6000) as never)],
];

test("isolation (default `Abort`): every fs entry point stops with Miri's isolation error naming the op", () => {
  for (const [op, call] of CALLS) {
    const [cx, rec] = ecx("Abort");
    expect([op, stop_of(call(cx))]).toEqual([op, { $: "UnsupportedInIsolation", _0: `\`${op}\` not available when isolation is enabled` }]);
    expect(rec.errno).toEqual([]);
  }
});

test("isolation (`warn-nobacktrace`): the oracle's warning once per op and its errno", () => {
  for (const [op, call] of CALLS) {
    const [cx, rec] = ecx("WarningWithoutBacktrace");
    const r = call(cx);
    expect([op, r.$]).toEqual([op, "Ok"]);
    expect(rec.warnings).toEqual([`\`${op}\` was made to return an error due to isolation`]);
    if (op === "posix_fallocate") {
      // returns the error code instead of setting errno
      expect(r.$ === "Ok" && Scalar.to_i32(r._0 as Scalar<never>)).toEqual({ $: "Ok", _0: ERRNO[op] });
      expect(rec.errno).toEqual([]);
      continue;
    }
    expect([op, rec.errno.map(errno_of)]).toEqual([op, [ERRNO[op]]]);
  }
  // readdir also returns NULL; opendir / realpath return a null pointer
  const [cx, rec] = ecx("NoWarning");
  expect(cx.readdir(ptr(1) as never, "DEST" as never, "dirent64").$).toBe("Ok");
  expect(rec.writes).toEqual([["null", "DEST"]]);
  expect(rec.warnings).toEqual([]);
});

test("open: flag validation precedes the isolation check (oracle messages and errnos)", () => {
  const open = (flag: number, args: FakeOp[] = []) => {
    const [cx, rec] = ecx("Abort");
    return [cx.open(undefined, PATH as never, int(flag) as never, { args: args as never, already_gone: 2 }), rec] as const;
  };
  const unsup = (msg: string) => ({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } });

  expect(stop_of(open(3)[0])).toEqual(unsup("open: unsupported access mode 0x3"));
  expect(stop_of(open(LIBC.O_RDONLY! | 0x1000_0000)[0])).toEqual(unsup("open: unsupported flags: 0x10000000"));
  expect(stop_of(open(LIBC.O_RDONLY! | 0x8000_0000)[0])).toEqual(unsup("open: unsupported flags: 0x80000000"));

  const [tmp, tmp_rec] = open(LIBC.O_RDWR! | LIBC.O_TMPFILE!, [int(0o600)]);
  expect(tmp.$).toBe("Ok");
  expect(tmp_rec.errno.map(errno_of)).toEqual([LIBC.EOPNOTSUPP]);

  const [cd, cd_rec] = open(LIBC.O_RDONLY! | LIBC.O_CREAT! | LIBC.O_DIRECTORY!, [int(0o600)]);
  expect(cd.$).toBe("Ok");
  expect(cd_rec.errno.map(errno_of)).toEqual([LIBC.EINVAL]);

  // O_DIRECTORY alone (the host's `libc::O_DIRECTORY` goes into the custom flags) reaches the isolation error.
  expect(stop_of(open(LIBC.O_RDONLY! | LIBC.O_DIRECTORY! | LIBC.O_CLOEXEC!)[0])).toEqual({ $: "UnsupportedInIsolation", _0: "`open` not available when isolation is enabled" });

  // Every supported flag is consumed, so the isolation error comes next.
  const all = LIBC.O_WRONLY! | LIBC.O_CREAT! | LIBC.O_EXCL! | LIBC.O_TRUNC! | LIBC.O_APPEND! | LIBC.O_CLOEXEC! | LIBC.O_NOFOLLOW!;
  expect(stop_of(open(all, [int(0o644)])[0])).toEqual({ $: "UnsupportedInIsolation", _0: "`open` not available when isolation is enabled" });
});

test("open: `/proc` paths emit FileInProcOpened before the isolation error", () => {
  const [cx, rec] = ecx("Abort");
  const r = cx.open(undefined, PROC_PATH as never, int(LIBC.O_RDONLY!) as never, { args: [], already_gone: 2 });
  expect(rec.diagnostics).toEqual([{ $: "FileInProcOpened" }]);
  expect(stop_of(r)).toEqual({ $: "UnsupportedInIsolation", _0: "`open` not available when isolation is enabled" });
  const [cx2, rec2] = ecx("Abort");
  stop_of(cx2.open(undefined, PATH as never, int(LIBC.O_RDONLY!) as never, { args: [], already_gone: 2 }));
  expect(rec2.diagnostics).toEqual([]);
});

test("EFAULT for NULL paths precedes the isolation check (oracle: chmod, rename, utimensat, statx)", () => {
  const cases: [string, Call][] = [
    ["chmod", (cx) => cx.chmod(NULL as never, int(0o644) as never)],
    ["rename", (cx) => cx.rename(NULL as never, PATH as never)],
    ["utimensat", (cx) => cx.utimensat(int(LIBC.AT_FDCWD!) as never, NULL as never, NULL as never, int(0) as never)],
    ["statx", (cx) => cx.linux_statx(int(LIBC.AT_FDCWD!) as never, NULL as never, int(0) as never, int(0) as never, ptr(0x6000) as never)],
  ];
  for (const [op, call] of cases) {
    const [cx, rec] = ecx("Abort");
    expect([op, call(cx).$]).toEqual([op, "Ok"]);
    expect([op, rec.errno.map(errno_of)]).toEqual([op, [LIBC.EFAULT]]);
  }
  // utimensat with a NULL path and a real dirfd is unsupported
  const [cx] = ecx("Abort");
  expect(stop_of(cx.utimensat(int(3) as never, NULL as never, NULL as never, int(0) as never))).toEqual({
    $: "Unsupported",
    _0: { $: "Unsupported", _0: "`utimensat` with a NULL path is only supported for `AT_FDCWD`" },
  });
});

test("mkstemp: a template without the XXXXXX suffix is EACCES under isolation (the check comes after it)", () => {
  const [cx, rec] = ecx("WarningWithoutBacktrace");
  expect(cx.mkstemp(ptr(0x5000) as never).$).toBe("Ok");
  expect(rec.errno.map(errno_of)).toEqual([LIBC.EACCES]);
});

test("fd-based shims check the fd before isolation (oracle: lseek, ftruncate, fsync, fdatasync, futimens, sync_file_range, isatty)", () => {
  const [cx, rec] = ecx("Abort");
  const dest = "DEST" as never;
  expect(cx.lseek(0, 0n, 77, dest).$).toBe("Ok"); // bad whence
  expect(cx.lseek(0, -1n, LIBC.SEEK_SET!, dest).$).toBe("Ok"); // negative offset
  expect(cx.lseek(99, 0n, LIBC.SEEK_SET!, dest).$).toBe("Ok"); // bad fd
  expect(cx.ftruncate64(99, 0n).$).toBe("Ok");
  expect(cx.fsync(int(99) as never).$).toBe("Ok");
  expect(cx.fdatasync(int(99) as never).$).toBe("Ok");
  expect(cx.futimens(int(99) as never, NULL as never).$).toBe("Ok");
  expect(cx.sync_file_range(int(99) as never, { scalar: Scalar.from_i64(0n) } as never, { scalar: Scalar.from_i64(0n) } as never, int(0) as never).$).toBe("Ok");
  expect(cx.sync_file_range(int(99) as never, { scalar: Scalar.from_i64(-1n) } as never, { scalar: Scalar.from_i64(0n) } as never, int(0) as never).$).toBe("Ok");
  const tty = cx.isatty(int(99) as never);
  expect(tty.$ === "Ok" && Scalar.to_i32(tty._0 as Scalar<never>)).toEqual({ $: "Ok", _0: 0 });
  expect(rec.errno.map(errno_of)).toEqual([22, 22, 9, 9, 9, 9, 9, 9, 22, 9]);
});

test("DirTable: Default skips id 0, insert_new counts up; DirStream yields `..`, `.` first", () => {
  const t = DirTable.default();
  expect(t.next_id).toBe(1n);
  const s = DirStream.new(undefined as never, 3, undefined as never);
  expect(s.special_entries).toEqual(["..", "."]);
  expect(t.insert_new(s)).toBe(1n);
  expect(t.insert_new(DirStream.new(undefined as never, 4, undefined as never))).toBe(2n);
  expect([s.next_host_entry(), s.next_host_entry()]).toEqual([
    { $: "Ok", _0: { $: "Right", _0: "." } },
    { $: "Ok", _0: { $: "Right", _0: ".." } },
  ]);
  // then the host `ReadDir` (isolation off only): unported
  expect(() => s.next_host_entry()).toThrow();
  let visited = 0;
  t.visit_provenance(() => visited++);
  expect(visited).toBe(0);
});

test("std::fs stand-in: pure builders, host operations unported; std::path::absolute", () => {
  const o = std_fs.OpenOptions.new().read(true).write(true).create_new(true).mode(0o600).custom_flags(4);
  expect([o.read_, o.write_, o.create_new_, o.create_, o.mode_, o.custom_flags_]).toEqual([true, true, true, false, 0o600, 4]);
  expect(std_fs.OpenOptions.new().mode_).toBe(0o666);
  expect(std_fs.Permissions.from_mode(0o444).readonly()).toBe(true);
  expect(std_fs.Permissions.from_mode(0o644).readonly()).toBe(false);
  expect(std_fs.DirBuilder.new().mode_).toBe(0o777);
  let err: unknown;
  try {
    std_fs.metadata("x");
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect(std_fs.absolute("/proc/self/../x")).toEqual({ $: "Ok", _0: "/proc/self/../x" });
  expect(std_fs.absolute("/a//b/./c/")).toEqual({ $: "Ok", _0: "/a/b/c/" });
  expect(std_fs.absolute("./x")).toEqual({ $: "Ok", _0: `${process.cwd()}/x` });
  expect(std_fs.absolute("")).toEqual({ $: "Err", _0: { $: "SimpleMessage", kind: "InvalidInput", message: "cannot make an empty path absolute" } });
  void Panic;
});
