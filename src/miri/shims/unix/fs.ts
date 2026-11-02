//! File and file system access
// Fill lane: `miri-fs` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/fs.rs (crate `miri`, plan-m6 D2; skeleton by miri-contract, wave 35).
// Its types are generated into fs.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - Isolation (plan-m6 D14). Every entry point does what upstream does before its `IsolatedOp::Reject` check (argument
//   reads, flag validation, `EFAULT` / `EINVAL` / `EBADF` checks, the `/proc` diagnostic) and then rejects through
//   `reject_in_isolation` (helpers.rs) exactly as upstream: that is the gated (run-pass) path. What runs after the check
//   (isolation off) calls the host `std::fs` through src/std/fs.ts, whose host operations stop `unported` (D14; no host
//   implementation yet, a root decision).
// - `cfg(unix)` / `cfg(windows)` blocks of Miri's own build are host cfgs: they are selected with `process.platform`
//   (the oracle Miri is built for the host it runs on); `libc::O_*` in those blocks are the *host's* constants
//   (node:fs `constants`). `cfg(bootstrap)` is off for the pinned component (the `fallback` path field does not exist).
// - Calls into other wave-37 lanes go through the skeleton's declared signatures; the gaps are marked
//   `PORT(contract): pending <lane>` below and listed in docs/handoff/miri-fs.md.
import { constants as host_fs_constants } from "node:fs";
import { type MPlaceTy, type OpTy, type Pointer, type Scalar, type StrictPointer } from "../../lib.ts";
import { type DynMachineCallback, type MiriInterpCx, MemoryKind_from_MiriMemoryKind } from "../../machine.ts";
import { type VisitWith, VisitProvenance_Option, VisitProvenance_Pointer, VisitProvenance_str, VisitProvenance_tuple2 } from "../../provenance_gc.ts";
import { type DirHandle, FdId, type FdNum, type FileDescription, FileDescription_DirHandle, FileDescription_FileHandle, FileDescription_provided, type FileDescriptionRef, type FileHandle, open_file_or_dir, type SeekFrom } from "../files.ts";
import { type IoError, IoError_from_ErrorKind, IoError_from_io_Error, LibcError } from "../io_error.ts";
import { bytes_to_os_str } from "../os_str.ts";
import { shim_varargs, type Varargs } from "../sig.ts";
import { system_time_to_duration } from "../time.ts";
import { type FlockOp } from "./fd.ts";
import { type DirEntry, DirStream, DirTable, debug_DirStream, FileMetadata, type TimeUpdate } from "./fs.gen.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { FieldIdx, FieldsShape, Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type Either } from "../../../rustc_middle/mir/mod.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  interp_ok,
  Pointer as interp_Pointer,
  Pointer_Option_from_Pointer,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { spec } from "../../../rustc_target/lib.ts";
import { debug_int, debug_struct, type Fmt } from "../../../std/fmt.ts";
import * as fs from "../../../std/fs.ts";
import { type ErrorKind, debug_IoError as debug_io_Error, type IoError as io_Error, IoError_kind } from "../../../std/io.ts";
import { assert, panic, unported } from "../../../std/panic.ts";
import { path_is_absolute, path_strip_prefix } from "../../../std/path.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { utf8 } from "../../../std/str.ts";
import { SystemTime } from "../../../std/time.ts";
export * from "./fs.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/fs.rs: `trait EvalContextExtPrivate` (impl for `MiriInterpCx`) ----
    // shims/unix/fs.rs:269
    parse_utimens_timespec(this: MiriInterpCx, tp: MPlaceTy): InterpResult<TimeUpdate | undefined>;
    // shims/unix/fs.rs:297
    parse_utimens_times(this: MiriInterpCx, times_ptr: Pointer): InterpResult<[TimeUpdate, TimeUpdate] | undefined>;
    // shims/unix/fs.rs:320
    write_stat_buf(this: MiriInterpCx, metadata: FileMetadata, buf_op: OpTy, buf_type: string): InterpResult<number>;
    // shims/unix/fs.rs:377
    file_type_to_d_type(this: MiriInterpCx, file_type: Result<fs.FileType, io_Error>): InterpResult<number>;
    // shims/unix/fs.rs:413
    dir_entry_fields(this: MiriInterpCx, entry: Either<fs.DirEntry, string>): InterpResult<DirEntry>;
    // shims/unix/fs.rs:440
    host_permissions_from_mode(this: MiriInterpCx, mode: number): InterpResult<fs.Permissions>;
    // ---- shims/unix/fs.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fs.rs:456
    open(this: MiriInterpCx, dirfd: OpTy | undefined, path_raw: OpTy, flag: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fs.rs:742
    lseek(this: MiriInterpCx, fd_num: number, offset: bigint, whence: number, dest: MPlaceTy): InterpResult;
    // shims/unix/fs.rs:781
    unlink(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:811
    symlink(this: MiriInterpCx, target_op: OpTy, linkpath_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:850
    linkat(this: MiriInterpCx, oldfd_op: OpTy, oldpath_op: OpTy, newfd_op: OpTy, newpath_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:903
    stat(this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:931
    lstat(this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:958
    fstat(this: MiriInterpCx, fd_op: OpTy, buf_op: OpTy, buf_type: string): InterpResult<Scalar>;
    // shims/unix/fs.rs:989
    fstatat(this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, buf_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1043
    linux_statx(this: MiriInterpCx, dirfd_op: OpTy, pathname_op: OpTy, flags_op: OpTy, mask_op: OpTy, statxbuf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1207
    chmod(this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1232
    fchmod(this: MiriInterpCx, fd_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1260
    rename(this: MiriInterpCx, oldpath_op: OpTy, newpath_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1288
    mkdir(this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1322
    rmdir(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1353
    opendir(this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1405
    readdir(this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy, buf_type: string): InterpResult;
    // shims/unix/fs.rs:1556
    dirfd(this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/fs.rs:1575
    closedir(this: MiriInterpCx, dirp_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1606
    ftruncate64(this: MiriInterpCx, fd_num: number, length: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1634
    posix_fallocate(this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1655
    linux_fallocate(this: MiriInterpCx, fd: number, mode: number, offset: bigint, size: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1685
    fallocate_impl(this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Result<null, IoError>>;
    // shims/unix/fs.rs:1734
    fsync(this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1747
    ffullsync_fd(this: MiriInterpCx, fd_num: number): InterpResult<Scalar>;
    // shims/unix/fs.rs:1762
    fdatasync(this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1782
    futimens(this: MiriInterpCx, fd_op: OpTy, times_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1809
    utimensat(this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, times_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1872
    sync_file_range(this: MiriInterpCx, fd_op: OpTy, offset_op: OpTy, nbytes_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1909
    readlink(this: MiriInterpCx, pathname_op: OpTy, buf_op: OpTy, bufsize_op: OpTy): InterpResult<bigint>;
    // shims/unix/fs.rs:1975
    isatty(this: MiriInterpCx, miri_fd: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1994
    realpath(this: MiriInterpCx, path_op: OpTy, processed_path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:2052
    mkstemp(this: MiriInterpCx, template_op: OpTy): InterpResult<Scalar>;
  }
}

declare module "./fs.gen.ts" {
  interface DirStream {
    // shims/unix/fs.rs:46
    next_host_entry(): Result<Either<fs.DirEntry, string>, io_Error> | undefined;
  }
  namespace DirStream {
    // shims/unix/fs.rs:42
    function new_(read_dir: fs.ReadDir, fd_num: FdNum, fd_id: FdId): DirStream;
    export { new_ as new };
  }
}
declare module "./fs.gen.ts" {
  interface DirTable {
    // shims/unix/fs.rs:210
    insert_new(stream: DirStream): bigint;
    // impl VisitProvenance for DirTable (shims/unix/fs.rs:228)
    visit_provenance(visit: VisitWith): void;
  }
  namespace DirTable {
    // impl Default for DirTable (shims/unix/fs.rs:218)
    export let default_: () => DirTable;
    export { default_ as default };
  }
}
declare module "./fs.gen.ts" {
  namespace FileMetadata {
    // shims/unix/fs.rs:2242
    export let at: (ecx: MiriInterpCx, dirfd: FdNum, path: string, symlink_nofollow_flag: boolean, empty_path_flag: boolean) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2294
    export let from_fd_num: (ecx: MiriInterpCx, fd_num: FdNum) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2307
    export let synthetic: (ecx: MiriInterpCx, mode_name: string) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2331
    export let from_host: (ecx: MiriInterpCx, metadata: Result<fs.Metadata, io_Error>) => InterpResult<Result<FileMetadata, IoError>>;
  }
}

// ---- local helpers (macros and std conversions the file uses) ----

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_unsup_format(msg)));
}
/** `err_unsup_format!(..)` */
function err_unsup_format(msg: string): InterpErrorKind {
  return { $: "Unsupported", _0: { $: "Unsupported", _0: msg } };
}
/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(msg)));
}
/** `err_ub_format!(..)` */
function err_ub_format(msg: string): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } };
}

/** `io::Error::from(kind)` (`ErrorKind::WouldBlock.into()`, `ErrorKind::NotFound.into()`): the `HostError` payload of
 *  shims-b's `IoError_from_ErrorKind` (io_error.rs:47). */
function io_Error_from_ErrorKind(kind: ErrorKind): io_Error {
  return (IoError_from_ErrorKind(kind) as { _0: io_Error })._0;
}

/** `{:#x}` of an `i32` (two's complement bits, like Rust's `LowerHex` for signed integers). */
function hex_i32(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}
/** `{:o}` of a `u32` */
function oct_u32(n: number): string {
  return (n >>> 0).toString(8);
}

/** `<uN/iN>::try_from(v).unwrap()` of an integer that must fit in `[min, max]`. */
function try_from_unwrap(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min || v > max) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return v;
}
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffff_ffffn;

/** `ptr == Pointer::null()` (derived `PartialEq` of `Pointer<Option<Provenance>>`). */
function is_null_pointer(ptr: Pointer): boolean {
  return ptr.provenance === undefined && ptr.offset.bytes_u64() === 0n;
}

/** `FdId`'s derived `PartialEq`. */
function FdId_eq(a: FdId, b: FdId): boolean {
  return a._0 === b._0;
}

/**
 * The description of a downcast handle, for the rest of the fn. PORT: Rust drops the `FileDescriptionRef<FileHandle>` /
 * `<DirHandle>` local at the end of the fn; it is dropped here right away. The table still holds the description until
 * the fn returns (none of these fns closes it), so the strong count cannot reach 0 at either point: the drop point is
 * not observable.
 */
function into_inner<T>(r: FileDescriptionRef<T>): T {
  const inner = r.deref();
  r.drop();
  return inner;
}

/** `this.machine.fds.get(open_dir.fd_num).is_none_or(|fd| fd.id() != open_dir.fd_id)`: the temporary handle is dropped at
 *  the end of the `if` condition. */
function backing_fd_tampered(this_: MiriInterpCx, open_dir: DirStream): boolean {
  const fd = this_.machine.fds.get(open_dir.fd_num);
  if (fd === undefined) return true;
  const tampered = !FdId_eq(fd.id(), open_dir.fd_id);
  fd.drop();
  return tampered;
}

/** Runs `f` with an owned handle and drops it after (Rust drops a `FileDescriptionRef` local at the end of its scope;
 *  files.ts makes `Drop` explicit). */
function with_ref<T, R>(r: FileDescriptionRef<T>, f: (r: FileDescriptionRef<T>) => R): R {
  try {
    return f(r);
  } finally {
    r.drop();
  }
}

/**
 * The `FileHandle` / `DirHandle` values fs.rs builds (`FileHandle { file, writable, readable }`, `DirHandle { dir }`).
 * PORT: the generated types are records; their trait impls are tables (`impl FileDescription for FileHandle/DirHandle`:
 * files.rs:432 / :521, `FileDescription_FileHandle` / `FileDescription_DirHandle` of lane miri-shims-b, over
 * `FileDescription_provided`; `impl UnixFileDescription for FileHandle/DirHandle`: this file's tables below). These
 * classes carry them on their prototypes, installed on first construction (C10: another module's values are not read at
 * load). `downcast::<FileHandle>()` / `::<DirHandle>()` are the exact class tests `is_FileHandle` / `is_DirHandle`.
 * PORT(contract): pending miri-shims-d: `UnixFileDescription`'s provided methods (fd.rs) are not installed yet.
 */
export class FileHandleDesc implements FileHandle {
  constructor(
    public file: FileHandle["file"],
    public readable: boolean,
    public writable: boolean,
  ) {}
}
export class DirHandleDesc implements DirHandle {
  constructor(public dir: DirHandle["dir"]) {}
}
let desc_impls_installed = false;
function install_desc_impls(): void {
  if (desc_impls_installed) return;
  desc_impls_installed = true;
  Object.assign(FileHandleDesc.prototype, FileDescription_provided, FileDescription_FileHandle, UnixFileDescription_FileHandle);
  Object.assign(DirHandleDesc.prototype, FileDescription_provided, FileDescription_DirHandle, UnixFileDescription_DirHandle);
}
/** `FileHandle { file, writable, readable }` */
function new_FileHandle(file: fs.File, writable: boolean, readable: boolean): FileHandleDesc & FileDescription {
  install_desc_impls();
  return new FileHandleDesc(file as never, readable, writable) as FileHandleDesc & FileDescription;
}
/** `DirHandle { dir }` */
function new_DirHandle(dir: fs.Dir): DirHandleDesc & FileDescription {
  install_desc_impls();
  return new DirHandleDesc(dir as never) as DirHandleDesc & FileDescription;
}
/** The `TypeId` test of `downcast::<FileHandle>()`. */
function is_FileHandle(v: FileDescription): v is FileDescription & FileHandle {
  return v.constructor === FileHandleDesc;
}
/** The `TypeId` test of `downcast::<DirHandle>()`. */
function is_DirHandle(v: FileDescription): v is FileDescription & DirHandle {
  return v.constructor === DirHandleDesc;
}

/** The host's `libc::O_*` (Miri's `cfg(unix)` blocks; node:fs `constants`). */
function host_libc(name: "O_DIRECTORY" | "O_NOFOLLOW" | "O_EXCL"): number {
  const v = (host_fs_constants as Record<string, number | undefined>)[name];
  if (v === undefined) return unported(`host libc::${name} (node:fs constants on ${process.platform})`);
  return v;
}
/** `cfg(unix)` of Miri's build (the host). */
function cfg_unix(): boolean {
  return process.platform !== "win32";
}
/** `cfg(windows)` of Miri's build (the host). */
function cfg_windows(): boolean {
  return process.platform === "win32";
}

/** `matches!(&this.tcx.sess.target.os, ...)` */
function target_os_in(this_: MiriInterpCx, oses: readonly string[]): boolean {
  return oses.includes(this_.tcx.deref().sess.target.os.$);
}
/** `{}` of the target OS */
function display_target_os(this_: MiriInterpCx): string {
  return spec.Os.display(this_.tcx.deref().sess.target.os);
}

/** `path::absolute(&path).is_ok_and(|path| path.starts_with("/proc"))` */
function is_in_proc(path: string): boolean {
  const abs = fs.absolute(path);
  return abs.$ === "Ok" && path_strip_prefix(abs._0, "/proc") !== undefined;
}

/** `if let IsolatedOp::Reject(reject_with) = this.machine.isolated_op { this.reject_in_isolation(name, reject_with)?; .. }`:
 *  `undefined` when isolation is off, else the result of `reject_in_isolation` (an `Err` stops the shim). */
function reject_if_isolated(this_: MiriInterpCx, op_name: string): InterpResult | undefined {
  const isolated_op = this_.machine.isolated_op;
  if (isolated_op.$ === "Reject") {
    const reject_with = isolated_op._0;
    return this_.reject_in_isolation(op_name, reject_with);
  }
  return undefined;
}

/** `this.read_scalar(op)?.to_i32()?` */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0);
}
/** `this.read_scalar(op)?.to_u32()?` */
function read_u32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_u32(s._0);
}
/** `this.read_scalar(op)?.to_i64()?` */
function read_i64(this_: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i64(s._0);
}
/** `this.read_path_from_c_str(this.read_pointer(op)?)?` */
function read_path_op(this_: MiriInterpCx, op: OpTy): InterpResult<string> {
  const p = this_.read_pointer(op);
  if (p.$ === "Err") return p;
  return this_.read_path_from_c_str(p._0);
}
/** `this.eval_libc(name).to_u8()?.into()` */
function libc_u8(this_: MiriInterpCx, name: string): InterpResult<number> {
  return interp_Scalar.to_u8(this_.eval_libc(name));
}

// ---- end of local helpers ----

// impl DirStream
// rustc: src/tools/miri/src/shims/unix/fs.rs:42 new
port_methods("miri::shims::unix::fs::DirStream", () => DirStream, {
new: function (read_dir: fs.ReadDir, fd_num: FdNum, fd_id: FdId): DirStream {
  return new DirStream(read_dir as never, fd_num, fd_id, ["..", "."], undefined);
}});

// rustc: src/tools/miri/src/shims/unix/fs.rs:46 next_host_entry
port_methods("miri::shims::unix::fs::DirStream", () => DirStream.prototype, {
next_host_entry: function (this: DirStream): Result<Either<fs.DirEntry, string>, io_Error> | undefined {
  const special = this.special_entries.pop();
  if (special !== undefined) {
    return Ok({ $: "Right", _0: special });
  }
  // PORT: `read_dir` is the host `fs::ReadDir` (a `Pending` field in the typemap; src/std/fs.ts stand-in).
  const entry = (this.read_dir as unknown as fs.ReadDir).next();
  if (entry === undefined) return undefined;
  return entry.$ === "Ok" ? Ok({ $: "Left", _0: entry._0 }) : entry;
}});

// impl UnixFileDescription for FileHandle
// PORT: an impl table (borrowck-contract rules 4-5) of `this` methods, installed on `FileHandleDesc.prototype` (above);
// the trait's provided methods (fd.rs, lane miri-shims-d) fill the rest. `this.file` is the host `fs::File` (`Pending` in
// the typemap; src/std/fs.ts stand-in).
export const UnixFileDescription_FileHandle = {
  // rustc: src/tools/miri/src/shims/unix/fs.rs:70 pread
  pread(
    this: FileHandle,
    communicate_allowed: boolean,
    offset: bigint,
    ptr: Pointer,
    len: number,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    assert(communicate_allowed, "isolation should have prevented even opening a file");
    if (!this.readable) {
      return finish.call(ecx, Err(LibcError("EBADF")));
    }

    const bytes = new Uint8Array(len);
    // Emulates pread using seek + read + seek to restore cursor position.
    // Correctness of this emulation relies on sequential nature of Miri execution.
    // The closure is used to emulate `try` block, since we "bubble" `io::Error` using `?`.
    const file = this.file as unknown as fs.File;
    const f = (): Result<number, io_Error> => {
      const cursor_pos = file.stream_position();
      if (cursor_pos.$ === "Err") return cursor_pos;
      const s = file.seek({ $: "Start", _0: offset });
      if (s.$ === "Err") return s;
      const res = file.read(bytes);
      // Attempt to restore cursor position even if the read has failed
      const restore = file.seek({ $: "Start", _0: cursor_pos._0 });
      if (restore.$ === "Err") panic(`failed to restore file position, this shouldn't be possible: ${debug_io_Error(restore._0, PLAIN_)}`);
      return res;
    };
    let result: Result<number, IoError>;
    const r = f();
    if (r.$ === "Ok") {
      const read_size = r._0;
      // If reading to `bytes` did not fail, we write those bytes to the buffer.
      // Crucially, if fewer than `bytes.len()` bytes were read, only write
      // that much into the output buffer!
      const w = ecx.write_bytes_ptr(ptr, bytes.subarray(0, read_size).values());
      if (w.$ === "Err") return w;
      result = Ok(read_size);
    } else {
      result = Err({ $: "HostError", _0: r._0 });
    }
    return finish.call(ecx, result);
  },

  // rustc: src/tools/miri/src/shims/unix/fs.rs:111 pwrite
  pwrite(
    this: FileHandle,
    communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    offset: bigint,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    assert(communicate_allowed, "isolation should have prevented even opening a file");
    if (!this.writable) {
      return finish.call(ecx, Err(LibcError("EBADF")));
    }

    // Emulates pwrite using seek + write + seek to restore cursor position.
    // Correctness of this emulation relies on sequential nature of Miri execution.
    // The closure is used to emulate `try` block, since we "bubble" `io::Error` using `?`.
    const file = this.file as unknown as fs.File;
    const bytes = ecx.read_bytes_ptr_strip_provenance(ptr, Size.from_bytes(len));
    if (bytes.$ === "Err") return bytes;
    const f = (): Result<number, io_Error> => {
      const cursor_pos = file.stream_position();
      if (cursor_pos.$ === "Err") return cursor_pos;
      const s = file.seek({ $: "Start", _0: offset });
      if (s.$ === "Err") return s;
      const res = file.write(bytes._0);
      // Attempt to restore cursor position even if the write has failed
      const restore = file.seek({ $: "Start", _0: cursor_pos._0 });
      if (restore.$ === "Err") panic(`failed to restore file position, this shouldn't be possible: ${debug_io_Error(restore._0, PLAIN_)}`);
      return res;
    };
    const result = f();
    return finish.call(ecx, result.$ === "Ok" ? result : Err(IoError_from_io_Error(result._0)));
  },

  // rustc: src/tools/miri/src/shims/unix/fs.rs:143 flock
  flock(this: FileHandle, communicate_allowed: boolean, op: FlockOp): InterpResult<Result<null, io_Error>> {
    assert(communicate_allowed, "isolation should have prevented even opening a file");

    const file = this.file as unknown as fs.File;
    // We must not block the interpreter loop, so we always `try_lock`.
    let res: Result<null, fs.TryLockError>;
    let nonblocking: boolean;
    switch (op.$) {
      case "SharedLock":
        [res, nonblocking] = [file.try_lock_shared(), op.nonblocking];
        break;
      case "ExclusiveLock":
        [res, nonblocking] = [file.try_lock(), op.nonblocking];
        break;
      case "Unlock":
        return interp_ok(file.unlock());
    }

    if (res.$ === "Ok") {
      return interp_ok(Ok(null));
    } else if (res._0.$ === "Error") {
      return interp_ok(Err(res._0._0));
    } else {
      if (nonblocking) {
        return interp_ok(Err(io_Error_from_ErrorKind("WouldBlock")));
      } else {
        return throw_unsup_format("blocking `flock` is not currently supported");
      }
    }
  },

  // rustc: src/tools/miri/src/shims/unix/fs.rs:172 get_flags
  get_flags(this: FileHandle, ecx: MiriInterpCx): InterpResult<Scalar> {
    if (this.readable && this.writable) return interp_ok(ecx.eval_libc("O_RDWR"));
    if (this.readable && !this.writable) return interp_ok(ecx.eval_libc("O_RDONLY"));
    if (!this.readable && this.writable) return interp_ok(ecx.eval_libc("O_WRONLY"));
    return panic("internal error: entered unreachable code");
  },
};
const PLAIN_: Fmt = { alternate: false };

// impl UnixFileDescription for DirHandle
export const UnixFileDescription_DirHandle = {
  // rustc: src/tools/miri/src/shims/unix/fs.rs:183 get_flags
  get_flags(this: DirHandle, ecx: MiriInterpCx): InterpResult<Scalar> {
    // Directories are always readonly on Unix.
    return interp_ok(ecx.eval_libc("O_RDONLY"));
  },
};

// impl DirTable
// rustc: src/tools/miri/src/shims/unix/fs.rs:210 insert_new
port_methods("miri::shims::unix::fs::DirTable", () => DirTable.prototype, {
insert_new: function (this: DirTable, stream: DirStream): bigint {
  const id = this.next_id;
  this.next_id += 1n;
  // self.streams.try_insert(id, stream).unwrap();
  if (this.streams.has(id)) {
    const old_value = this.streams.get(id)!;
    panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_OccupiedError(id, old_value, stream, PLAIN_)}`);
  }
  this.streams.set(id, stream);
  return id;
}});

/** `Debug` of `std::collections::hash_map::OccupiedError<'_, u64, DirStream>` (library/std/src/collections/hash/map.rs). */
function debug_OccupiedError(key: bigint, old_value: DirStream, value: DirStream, f: Fmt): string {
  return debug_struct(f, "OccupiedError", [
    ["key", debug_int(key, f)],
    ["old_value", debug_DirStream(old_value, f)],
    ["value", debug_DirStream(value, f)],
  ]);
}

// impl Default for DirTable
// rustc: src/tools/miri/src/shims/unix/fs.rs:219 default
port_methods("miri::shims::unix::fs::DirTable", () => DirTable, {
default: function (): DirTable {
  return new DirTable(
    new Map(),
    // Skip 0 as an ID, because it looks like a null pointer to libc
    1n,
  );
}});

// impl VisitProvenance for DirTable
// rustc: src/tools/miri/src/shims/unix/fs.rs:229 visit_provenance
port_methods("miri::shims::unix::fs::DirTable", () => DirTable.prototype, {
visit_provenance: function (this: DirTable, visit: VisitWith): void {
  const { streams } = this;

  for (const dir of streams.values()) {
    // dir.entry.visit_provenance(visit);  (`Option<(Pointer, &'static str)>`)
    VisitProvenance_Option.visit_provenance(dir.entry, visit, {
      visit_provenance: (e: [Pointer, string], visit: VisitWith) => VisitProvenance_tuple2.visit_provenance(e, visit, VisitProvenance_Pointer, VisitProvenance_str),
    });
  }
}});

// rustc: src/tools/miri/src/shims/unix/fs.rs:238 maybe_sync_file
function maybe_sync_file(file: FileHandle, operation: (f: fs.File) => Result<null, io_Error>): Result<number, io_Error> {
  if (!file.writable && cfg_windows()) {
    // sync_all() and sync_data() will return an error on Windows hosts if the file is not opened
    // for writing. (FlushFileBuffers requires that the file handle have the
    // GENERIC_WRITE right)
    return Ok(0);
  } else {
    const result = operation(file.file as unknown as fs.File);
    return result.$ === "Ok" ? Ok(0) : result;
  }
}

/// The host `FileTimes` that applies the given access and modification time updates.
// rustc: src/tools/miri/src/shims/unix/fs.rs:254 host_file_times_from_updates
function host_file_times_from_updates(access: TimeUpdate, modified: TimeUpdate): fs.FileTimes {
  let filetimes = fs.FileTimes.new();
  if (access.$ === "Set") {
    filetimes = filetimes.set_accessed(access._0);
  }
  if (modified.$ === "Set") {
    filetimes = filetimes.set_modified(modified._0);
  }
  return filetimes;
}

// impl<'tcx> EvalContextExtPrivate<'tcx> for crate::MiriInterpCx<'tcx> {}

/// Decode one `futimens` `timespec`, handling the `UTIME_NOW`/`UTIME_OMIT` `tv_nsec` values.
/// `None` means the `timespec` is invalid and the caller should report `EINVAL`.
// rustc: src/tools/miri/src/shims/unix/fs.rs:269 parse_utimens_timespec
InterpCx.prototype.parse_utimens_timespec = function (this: MiriInterpCx, tp: MPlaceTy): InterpResult<TimeUpdate | undefined> {
  const this_ = this.eval_context_ref();
  // `UTIME_NOW` reads the host clock, which we must not do under isolation.
  assert(this_.machine.communicate(), "isolation should have prevented reaching this");

  // `tv_nsec` and the `UTIME_*` constants are `c_long`, i.e. the target's `isize`.
  const nsec_place = this_.project_field(tp, FieldIdx.ONE);
  if (nsec_place.$ === "Err") return nsec_place;
  const nsec_s = this_.read_scalar(nsec_place._0);
  if (nsec_s.$ === "Err") return nsec_s;
  const nsec = interp_Scalar.to_target_isize(nsec_s._0, this_);
  if (nsec.$ === "Err") return nsec;

  const omit = interp_Scalar.to_target_isize(this_.eval_libc("UTIME_OMIT"), this_);
  if (omit.$ === "Err") return omit;
  if (nsec._0 === omit._0) {
    return interp_ok({ $: "Omit" });
  }
  const now = interp_Scalar.to_target_isize(this_.eval_libc("UTIME_NOW"), this_);
  if (now.$ === "Err") return now;
  if (nsec._0 === now._0) {
    return interp_ok({ $: "Set", _0: SystemTime.now() });
  }

  const duration = this_.read_timespec(tp);
  if (duration.$ === "Err") return duration;
  if (duration._0 === undefined) {
    return interp_ok(undefined);
  }
  const t = SystemTime.UNIX_EPOCH.checked_add(duration._0);
  return interp_ok(t === undefined ? undefined : { $: "Set", _0: t });
};

/// Decode the `times` argument of `futimens`/`utimensat`: `[atime, mtime]`, or NULL to set both
/// to now, as `(access, modified)`.
/// `None` means a `timespec` is invalid and the caller should report `EINVAL`.
// rustc: src/tools/miri/src/shims/unix/fs.rs:297 parse_utimens_times
InterpCx.prototype.parse_utimens_times = function (this: MiriInterpCx, times_ptr: Pointer): InterpResult<[TimeUpdate, TimeUpdate] | undefined> {
  const this_ = this.eval_context_ref();

  const is_null = this_.ptr_is_null(times_ptr);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    const now: TimeUpdate = { $: "Set", _0: SystemTime.now() };
    return interp_ok([now, now]);
  } else {
    const timespec = this_.libc_ty_layout("timespec");
    const access_place = this_.ptr_to_mplace(times_ptr, timespec);
    const modified_place = access_place.offset(timespec.size, timespec, this_ as never);
    if (modified_place.$ === "Err") return modified_place;
    const access = this_.parse_utimens_timespec(access_place);
    if (access.$ === "Err") return access;
    if (access._0 === undefined) {
      return interp_ok(undefined);
    }
    const modified = this_.parse_utimens_timespec(modified_place._0 as MPlaceTy);
    if (modified.$ === "Err") return modified;
    if (modified._0 === undefined) {
      return interp_ok(undefined);
    }
    return interp_ok([access._0, modified._0]);
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:320 write_stat_buf
InterpCx.prototype.write_stat_buf = function (this: MiriInterpCx, metadata: FileMetadata, buf_op: OpTy, buf_type: string): InterpResult<number> {
  const this_ = this.eval_context_mut();

  const [access_sec, access_nsec] = metadata.accessed ?? [0n, 0];
  const [created_sec, created_nsec] = metadata.created ?? [0n, 0];
  const [modified_sec, modified_nsec] = metadata.modified ?? [0n, 0];

  const buf = this_.deref_pointer_as(buf_op, this_.libc_ty_layout(buf_type));
  if (buf.$ === "Err") return buf;

  const w = this_.write_int_fields_named(
    [
      ["st_dev", metadata.dev ?? 0n],
      ["st_mode", BigInt(metadata.mode)],
      ["st_nlink", metadata.nlink ?? 0n],
      ["st_ino", metadata.ino ?? 0n],
      ["st_uid", BigInt(metadata.uid ?? 0)],
      ["st_gid", BigInt(metadata.gid ?? 0)],
      ["st_rdev", 0n],
      ["st_atime", access_sec],
      ["st_atime_nsec", BigInt(access_nsec)],
      ["st_mtime", modified_sec],
      ["st_mtime_nsec", BigInt(modified_nsec)],
      ["st_ctime", 0n],
      ["st_ctime_nsec", 0n],
      ["st_size", metadata.size],
      ["st_blocks", metadata.blocks ?? 0n],
      ["st_blksize", metadata.blksize ?? 0n],
    ],
    buf._0,
  );
  if (w.$ === "Err") return w;

  if (target_os_in(this_, ["MacOs", "FreeBsd"])) {
    const w2 = this_.write_int_fields_named(
      [
        ["st_birthtime", created_sec],
        ["st_birthtime_nsec", BigInt(created_nsec)],
        ["st_flags", 0n],
        ["st_gen", 0n],
      ],
      buf._0,
    );
    if (w2.$ === "Err") return w2;
  }

  if (target_os_in(this_, ["Solaris", "Illumos"])) {
    const st_fstype = this_.project_field_named(buf._0, "st_fstype");
    if (st_fstype.$ === "Err") return st_fstype;
    // This is an array; write 0 into first element so that it encodes the empty string.
    const el = this_.project_index(st_fstype._0, 0n);
    if (el.$ === "Err") return el;
    const w3 = this_.write_int(0n, el._0);
    if (w3.$ === "Err") return w3;
  }

  return interp_ok(0);
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:377 file_type_to_d_type
InterpCx.prototype.file_type_to_d_type = function (this: MiriInterpCx, file_type: Result<fs.FileType, io_Error>): InterpResult<number> {
  const this_ = this.eval_context_ref();
  if (file_type.$ === "Ok") {
    const ft = file_type._0;
    if (ft.is_dir()) return libc_u8(this_, "DT_DIR");
    if (ft.is_file()) return libc_u8(this_, "DT_REG");
    if (ft.is_symlink()) return libc_u8(this_, "DT_LNK");
    // Certain file types are only supported when the host is a Unix system.
    if (cfg_unix()) {
      if (ft.is_block_device()) return libc_u8(this_, "DT_BLK");
      if (ft.is_char_device()) return libc_u8(this_, "DT_CHR");
      if (ft.is_fifo()) return libc_u8(this_, "DT_FIFO");
      if (ft.is_socket()) return libc_u8(this_, "DT_SOCK");
    }
    // Fallback
    return libc_u8(this_, "DT_UNKNOWN");
  } else {
    // Fallback on error
    return libc_u8(this_, "DT_UNKNOWN");
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:413 dir_entry_fields
InterpCx.prototype.dir_entry_fields = function (this: MiriInterpCx, entry: Either<fs.DirEntry, string>): InterpResult<DirEntry> {
  const this_ = this.eval_context_ref();
  switch (entry.$) {
    case "Left": {
      const dir_entry = entry._0;
      const name = dir_entry.file_name();
      const d_type = this_.file_type_to_d_type(dir_entry.file_type());
      if (d_type.$ === "Err") return d_type;
      return interp_ok({
        name,
        d_type: d_type._0,
        // If the host is a Unix system, fill in the inode number with its real value.
        // If not, use 0 as a fallback value.
        ino: cfg_unix() ? dir_entry.ino() : 0n,
      });
    }
    case "Right": {
      const special = entry._0;
      const d_type = libc_u8(this_, "DT_DIR");
      if (d_type.$ === "Err") return d_type;
      return interp_ok({
        name: special,
        d_type: d_type._0,
        ino: 0n,
      });
    }
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:440 host_permissions_from_mode
InterpCx.prototype.host_permissions_from_mode = function (this: MiriInterpCx, mode: number): InterpResult<fs.Permissions> {
  if (cfg_unix()) {
    return interp_ok(fs.Permissions.from_mode(mode));
  } else {
    return throw_unsup_format("setting file permissions is only supported on Unix hosts");
  }
};

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}

// rustc: src/tools/miri/src/shims/unix/fs.rs:456 open
InterpCx.prototype.open = function (this: MiriInterpCx, dirfd_op: OpTy | undefined, path_raw_op: OpTy, flag_op: OpTy, varargs: Varargs): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const open_name = dirfd_op !== undefined ? "openat" : "open";

  let dirfd_num: number | undefined;
  if (dirfd_op !== undefined) {
    const d = read_i32(this_, dirfd_op);
    if (d.$ === "Err") return d;
    dirfd_num = d._0;
  } else {
    dirfd_num = undefined;
  }
  const path_raw = this_.read_pointer(path_raw_op);
  if (path_raw.$ === "Err") return path_raw;
  const flag_r = read_i32(this_, flag_op);
  if (flag_r.$ === "Err") return flag_r;

  const path_r = this_.read_path_from_c_str(path_raw._0);
  if (path_r.$ === "Err") return path_r;
  const path = path_r._0;
  // Files in `/proc` won't work properly.
  if (target_os_in(this_, ["Linux", "Android", "Illumos", "Solaris"]) && is_in_proc(path)) {
    this_.machine.emit_diagnostic({ $: "FileInProcOpened" });
  }

  // Helper for those flags that read the `mode` parameter.
  const read_mode = (this_: MiriInterpCx, options: fs.OpenOptions, fn_name: string): InterpResult => {
    const r = this_.check_varargs(
      this_.libc_ty_layout("mode_t").size.bytes() >= 4
        ? // `mode_t` is big enough, no C integer promotion.
          shim_varargs("libc::mode_t")
        : // Types smaller than int get promoted to int
          // (see https://github.com/rust-lang/rust/issues/71915).
          shim_varargs("i32"),
      varargs,
      fn_name,
    );
    if (r.$ === "Err") return r;
    const [[mode]] = r._0;
    const mode_r = read_u32(this_, mode!);
    if (mode_r.$ === "Err") return mode_r;
    const mode_ = mode_r._0;

    if (cfg_unix()) {
      // Support all modes on UNIX host
      options.mode(mode_);
    } else {
      // Only support default mode for non-UNIX (i.e. Windows) host
      if (mode_ !== 0o666) {
        return throw_unsup_format(`${open_name}: non-default mode 0o${oct_u32(mode_)} is not supported on non-Unix hosts`);
      }
    }

    return interp_ok(undefined);
  };

  // We will "subtract" supported flags from this and at the end check that no bits are left.
  let flag = flag_r._0;

  const options = fs.OpenOptions.new();
  let custom_flags = 0;

  const o_rdonly = this_.eval_libc_i32("O_RDONLY");
  const o_wronly = this_.eval_libc_i32("O_WRONLY");
  const o_rdwr = this_.eval_libc_i32("O_RDWR");
  // The first two bits of the flag correspond to the access mode in linux, macOS and
  // windows. We need to check that in fact the access mode flags for the current target
  // only use these two bits, otherwise we are in an unsupported target and should error.
  if (((o_rdonly | o_wronly | o_rdwr) & ~0b11) !== 0) {
    return throw_unsup_format(`${open_name}: access mode flags on this target are unsupported`);
  }
  let writable = true;
  let readable = true;

  // Now we check the access mode
  const access_mode = flag & this_.eval_libc_i32("O_ACCMODE");
  flag &= ~access_mode;

  if (access_mode === o_rdonly) {
    writable = false;
    options.read(true);
  } else if (access_mode === o_wronly) {
    readable = false;
    options.write(true);
  } else if (access_mode === o_rdwr) {
    options.read(true).write(true);
  } else {
    return throw_unsup_format(`${open_name}: unsupported access mode ${hex_i32(access_mode)}`);
  }

  if (this_.tcx.deref().sess.target.os.$ === "Linux") {
    const o_largefile = this_.eval_libc_i32("O_LARGEFILE");
    if ((flag & o_largefile) === o_largefile) {
      flag &= ~o_largefile;
      // `fs::File` always opens in largefile mode so this is a NOP.
    }
    const o_tmpfile = this_.eval_libc_i32("O_TMPFILE");
    // Note that this overaps with O_DIRECTORY! So we have to check O_TMPFILE first.
    if ((flag & o_tmpfile) === o_tmpfile) {
      // This flag requires a mode.
      const m = read_mode(this_, options, dirfd_num !== undefined ? "openat(dirfd, pathname, O_TMPFILE, ...)" : "open(pathname, O_TMPFILE, ...)");
      if (m.$ === "Err") return m;

      // We don't currently support this, error gracefully.
      return this_.set_errno_and_return_neg1_i32(LibcError("EOPNOTSUPP"));
    }
  }
  const o_directory = this_.eval_libc_i32("O_DIRECTORY");
  let want_directory = false;
  if ((flag & o_directory) === o_directory) {
    flag &= ~o_directory;
    want_directory = true;
    // On Unix we can ask the host to only open directories. That's helpful especially in
    // combination with O_NOFOLLOW as it affects which error we get when the final component
    // is a symlink. Fixing the error up ourselves is non-trivial so we make the host
    // generate the right error.
    if (cfg_unix()) {
      custom_flags |= host_libc("O_DIRECTORY");
    }
  }
  const o_append = this_.eval_libc_i32("O_APPEND");
  if ((flag & o_append) === o_append) {
    flag &= ~o_append;
    options.append(true);
  }
  const o_trunc = this_.eval_libc_i32("O_TRUNC");
  if ((flag & o_trunc) === o_trunc) {
    flag &= ~o_trunc;
    options.truncate(true);
  }
  const o_creat = this_.eval_libc_i32("O_CREAT");
  if ((flag & o_creat) === o_creat) {
    flag &= ~o_creat;
    // Get the mode.
    const m = read_mode(this_, options, dirfd_num !== undefined ? "openat(dirfd, pathname, O_CREAT, ...)" : "open(pathname, O_CREAT, ...)");
    if (m.$ === "Err") return m;

    if (want_directory) {
      // O_CREAT + O_DIRECTORY is invalid.
      return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
    }

    // O_EXCL is only allowed if O_CREAT is set.
    const o_excl = this_.eval_libc_i32("O_EXCL");
    if ((flag & o_excl) === o_excl) {
      flag &= ~o_excl;
      options.create_new(true);
    } else {
      options.create(true);
    }
  }
  const o_cloexec = this_.eval_libc_i32("O_CLOEXEC");
  if ((flag & o_cloexec) === o_cloexec) {
    flag &= ~o_cloexec;
    // We do not need to do anything for this flag because `std` already sets it.
    // (Technically we do not support *not* setting this flag, but we ignore that.)
  }
  const o_nofollow = this_.eval_libc_i32("O_NOFOLLOW");
  let nofollow = false;
  if ((flag & o_nofollow) === o_nofollow) {
    flag &= ~o_nofollow;
    nofollow = true;
    if (cfg_unix()) {
      custom_flags |= host_libc("O_NOFOLLOW");
    } else if (cfg_windows()) {
      if (dirfd_num !== undefined) {
        return throw_unsup_format("openat: `O_NOFOLLOW` is not supported on Windows hosts");
      }
      // windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT
      custom_flags |= 0x0020_0000;
    }
  }

  // If `flag` has any bits left set, those are not supported.
  if (flag !== 0) {
    return throw_unsup_format(`${open_name}: unsupported flags: ${hex_i32(flag)}`);
  }

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, `\`${open_name}\``);
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  let dirfd_ref: FileDescriptionRef<DirHandle> | undefined;
  if (dirfd_num !== undefined) {
    if (path_is_absolute(path) || dirfd_num === this_.eval_libc_i32("AT_FDCWD")) {
      dirfd_ref = undefined;
    } else {
      // relative to dirfd, which must be a directory handle
      const fd = this_.machine.fds.get(dirfd_num);
      if (fd === undefined) {
        return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
      }
      const dir = fd.downcast(is_DirHandle);
      if (dir === undefined) {
        return this_.set_errno_and_return_neg1_i32(LibcError("ENOTDIR"));
      }
      dirfd_ref = dir;
    }
  } else {
    dirfd_ref = undefined;
  }
  // `dirfd` (an `Option<FileDescriptionRef<DirHandle>>`) is dropped at the end of the fn.
  try {
    return open_tail(this_, dirfd_ref?.deref(), path, options, custom_flags, writable, readable, want_directory, nofollow);
  } finally {
    dirfd_ref?.drop();
  }
};

/** The rest of `open` (fs.rs:690-739), while `dirfd` is alive. */
function open_tail(
  this_: MiriInterpCx,
  dirfd: DirHandle | undefined,
  path: string,
  options: fs.OpenOptions,
  custom_flags: number,
  writable: boolean,
  readable: boolean,
  want_directory: boolean,
  nofollow: boolean,
): InterpResult<Scalar> {

  // Let's see what we get when we open this!
  options.custom_flags(custom_flags);
  // Windows does not by itself treat `.` correctly so we do that by hand.
  // (https://github.com/rust-lang/rust/issues/163032)
  let f_or_d: Result<Either<fs.File, fs.Dir>, io_Error>;
  if (dirfd !== undefined && path === ".") {
    // Using `try_clone` here means that on the host, we have the same underlying file
    // description, even when it would be separate natively. That should be fine since
    // std never gives us an `fs::Dir` whose internal state (e.g. for iteration) matters.
    const d = (dirfd.dir as unknown as fs.Dir).try_clone();
    f_or_d = d.$ === "Ok" ? Ok({ $: "Right", _0: d._0 }) : d;
  } else {
    // PORT(contract): pending miri-shims-b: `open_file_or_dir` takes / returns `Pending` host types.
    f_or_d = open_file_or_dir(dirfd?.dir as never, path, options as never) as unknown as Result<Either<fs.File, fs.Dir>, io_Error>;
  }
  if (f_or_d.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(IoError_from_io_Error(f_or_d._0));
  }
  if (f_or_d._0.$ === "Right") {
    const dir = f_or_d._0._0;
    // This means it cannot be a symlink, so `nofollow` is fine.
    if (writable) {
      // On Windows, opening a folder writable can succeed.
      // But here we want it to always fail.
      return this_.set_errno_and_return_neg1_i32(LibcError("EISDIR"));
    }

    const fd = this_.machine.fds.insert_new(new_DirHandle(dir));
    return interp_ok(interp_Scalar.from_i32(fd));
  } else {
    const file = f_or_d._0._0;
    if (want_directory) {
      return this_.set_errno_and_return_neg1_i32(LibcError("ENOTDIR"));
    }
    if (unwrap_result(file.metadata(), debug_io_Error).is_symlink()) {
      if (nofollow) {
        // On Windows, FILE_FLAG_OPEN_REPARSE_POINT makes opening still succeed, it
        // just opens the symlink rather than the target. Turn that into an error.
        return this_.set_errno_and_return_neg1_i32(LibcError("ELOOP"));
      }
      return panic("we should not get a symlink here");
    }

    const fd = this_.machine.fds.insert_new(new_FileHandle(file, writable, readable));
    return interp_ok(interp_Scalar.from_i32(fd));
  }
}

// rustc: src/tools/miri/src/shims/unix/fs.rs:742 lseek
InterpCx.prototype.lseek = function (this: MiriInterpCx, fd_num: number, offset: bigint, whence: number, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Isolation check is done via `FileDescription` trait.

  let seek_from: SeekFrom;
  if (whence === this_.eval_libc_i32("SEEK_SET")) {
    if (offset < 0n) {
      // Negative offsets return `EINVAL`.
      return this_.set_errno_and_return_neg1(LibcError("EINVAL"), dest);
    } else {
      seek_from = { $: "Start", _0: try_from_unwrap(offset, 0n, U64_MAX) };
    }
  } else if (whence === this_.eval_libc_i32("SEEK_CUR")) {
    seek_from = { $: "Current", _0: try_from_unwrap(offset, I64_MIN, I64_MAX) };
  } else if (whence === this_.eval_libc_i32("SEEK_END")) {
    seek_from = { $: "End", _0: try_from_unwrap(offset, I64_MIN, I64_MAX) };
  } else {
    return this_.set_errno_and_return_neg1(LibcError("EINVAL"), dest);
  }

  const communicate = this_.machine.communicate();

  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1(LibcError("EBADF"), dest);
  }
  const seek = with_ref(fd, (fd) => fd.deref().seek(communicate, seek_from));
  if (seek.$ === "Err") return seek;
  const result: Result<bigint, io_Error> = seek._0.$ === "Ok" ? Ok(try_from_unwrap(seek._0._0, I64_MIN, I64_MAX)) : seek._0;
  // drop(fd);  (with_ref)

  const result_ = this_.try_unwrap_io_result(result, (v) => BigInt(v));
  if (result_.$ === "Err") return result_;
  const w = this_.write_int(result_._0, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:781 unlink
InterpCx.prototype.unlink = function (this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const path = read_path_op(this_, path_op);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`unlink`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  let result: Result<null, io_Error>;
  if (cfg_unix()) {
    result = fs.remove_file(path._0);
  } else {
    // This should be able to remove symlinks to dirs, but on Windows that requires
    // `remove_dir`. Our work-around is racy but there's not a lot we can do about that.
    // FIXME: maybe we can retry based on the error code?
    result = unported("miri::shims::unix::fs unlink: the cfg(windows) host branch (FileTypeExt::is_symlink_dir)");
  }
  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:811 symlink
InterpCx.prototype.symlink = function (this: MiriInterpCx, target_op: OpTy, linkpath_op: OpTy): InterpResult<Scalar> {
  // rustc: src/tools/miri/src/shims/unix/fs.rs:816 create_link
  function create_link(target: string, link: string): Result<null, io_Error> {
    if (cfg_unix()) {
      return fs.unix_symlink(target, link);
    } else {
      // The target filename is interpreted relative to where `link` is located,
      // but we need it relative to where we are.
      return unported("miri::shims::unix::fs symlink: the cfg(windows) host branch (symlink_dir / symlink_file)");
    }
  }

  const this_ = this.eval_context_mut();
  const target = read_path_op(this_, target_op);
  if (target.$ === "Err") return target;
  const linkpath = read_path_op(this_, linkpath_op);
  if (linkpath.$ === "Err") return linkpath;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`symlink`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  const result = create_link(target._0, linkpath._0);
  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:850 linkat
InterpCx.prototype.linkat = function (this: MiriInterpCx, oldfd_op: OpTy, oldpath_op: OpTy, newfd_op: OpTy, newpath_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  // Load all arguments
  const flags = read_i32(this_, flags_op);
  if (flags.$ === "Err") return flags;
  const oldfd = read_i32(this_, oldfd_op);
  if (oldfd.$ === "Err") return oldfd;
  const newfd = read_i32(this_, newfd_op);
  if (newfd.$ === "Err") return newfd;
  const oldpath_ptr = this_.read_pointer(oldpath_op);
  if (oldpath_ptr.$ === "Err") return oldpath_ptr;
  const newpath_ptr = this_.read_pointer(newpath_op);
  if (newpath_ptr.$ === "Err") return newpath_ptr;

  // Relevant libc constants
  const at_fdcwd = this_.eval_libc_i32("AT_FDCWD");

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`linkat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  // Read flags - only support 0.
  if (flags._0 !== 0) {
    return throw_unsup_format(`unsupported linkat flags ${hex_i32(flags._0)}`);
  }

  // Resolve oldpath
  if (oldfd._0 !== at_fdcwd) {
    return throw_unsup_format("linkat with `olddirfd` not equal to `AT_FDCWD` is not supported");
  }
  if (is_null_pointer(oldpath_ptr._0)) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }
  const oldpath = this_.read_path_from_c_str(oldpath_ptr._0);
  if (oldpath.$ === "Err") return oldpath;

  // Resolve newpath
  if (newfd._0 !== at_fdcwd) {
    return throw_unsup_format("linkat with `newdirfd` not equal to `AT_FDCWD` is not supported");
  }
  if (is_null_pointer(newpath_ptr._0)) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }
  const newpath = this_.read_path_from_c_str(newpath_ptr._0);
  if (newpath.$ === "Err") return newpath;

  const result = fs.hard_link(oldpath._0, newpath._0);
  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:903 stat
InterpCx.prototype.stat = function (this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  if (!target_os_in(this_, ["MacOs", "FreeBsd", "Solaris", "Illumos", "Android", "Linux"])) {
    return panic(`\`stat\` should not be called on ${display_target_os(this_)}`);
  }

  const path = read_path_op(this_, path_op);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`stat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  const metadata = FileMetadata.from_host(this_, fs.metadata(path._0));
  if (metadata.$ === "Err") return metadata;
  if (metadata._0.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(metadata._0._0);
  }

  const w = this_.write_stat_buf(metadata._0._0, buf_op, "stat");
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(w._0));
};

// `lstat` is used to get symlink metadata.
// rustc: src/tools/miri/src/shims/unix/fs.rs:931 lstat
InterpCx.prototype.lstat = function (this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  if (!target_os_in(this_, ["MacOs", "FreeBsd", "Solaris", "Illumos", "Android", "Linux"])) {
    return panic(`\`lstat\` should not be called on ${display_target_os(this_)}`);
  }

  const path = read_path_op(this_, path_op);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`lstat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  const metadata = FileMetadata.from_host(this_, fs.symlink_metadata(path._0));
  if (metadata.$ === "Err") return metadata;
  if (metadata._0.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(metadata._0._0);
  }

  const w = this_.write_stat_buf(metadata._0._0, buf_op, "stat");
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(w._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:958 fstat
InterpCx.prototype.fstat = function (this: MiriInterpCx, fd_op: OpTy, buf_op: OpTy, buf_type: string): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  if (!target_os_in(this_, ["MacOs", "FreeBsd", "Solaris", "Illumos", "Linux", "Android"])) {
    return panic(`\`fstat\` should not be called on ${display_target_os(this_)}`);
  }

  const fd = read_i32(this_, fd_op);
  if (fd.$ === "Err") return fd;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`fstat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    // Set error code as "EBADF" (bad fd); "EACCESS" does not make much sense here.
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }

  const metadata = FileMetadata.from_fd_num(this_, fd._0);
  if (metadata.$ === "Err") return metadata;
  if (metadata._0.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(metadata._0._0);
  }
  const w = this_.write_stat_buf(metadata._0._0, buf_op, buf_type);
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(w._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:989 fstatat
InterpCx.prototype.fstatat = function (this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, buf_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  if (!target_os_in(this_, ["MacOs", "FreeBsd", "Solaris", "Illumos", "Linux", "Android"])) {
    return panic(`\`fstatat\` should not be called on ${display_target_os(this_)}`);
  }

  const dirfd = read_i32(this_, dirfd_op);
  if (dirfd.$ === "Err") return dirfd;
  const path_ptr = this_.read_pointer(path_op);
  if (path_ptr.$ === "Err") return path_ptr;
  const flags_r = read_i32(this_, flags_op);
  if (flags_r.$ === "Err") return flags_r;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`fstatat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  // Parse flags.
  let flags = flags_r._0;
  // AT_SYMLINK_NOFOLLOW
  const at_symlink_nofollow = this_.eval_libc_i32("AT_SYMLINK_NOFOLLOW");
  const symlink_nofollow_flag = (flags & at_symlink_nofollow) === at_symlink_nofollow;
  flags &= ~at_symlink_nofollow;
  // Complain about unknown flags.
  if (flags !== 0) {
    return throw_unsup_format(`unsupported flags for \`fstatat\`: ${hex_i32(flags)}`);
  }

  const path = this_.read_path_from_c_str(path_ptr._0);
  if (path.$ === "Err") return path;
  // Resolve dirfd + path to metadata.
  const metadata = FileMetadata.at(this_, dirfd._0, path._0, symlink_nofollow_flag, /* empty_path_flag */ false);
  if (metadata.$ === "Err") return metadata;

  if (metadata._0.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(metadata._0._0);
  }
  const w = this_.write_stat_buf(metadata._0._0, buf_op, "stat");
  if (w.$ === "Err") return w;
  return interp_ok(interp_Scalar.from_i32(w._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1043 linux_statx
InterpCx.prototype.linux_statx = function (
  this: MiriInterpCx,
  dirfd_op: OpTy, // Should be an `int`
  pathname_op: OpTy, // Should be a `const char *`
  flags_op: OpTy, // Should be an `int`
  mask_op: OpTy, // Should be an `unsigned int`
  statxbuf_op: OpTy, // Should be a `struct statx *`
): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  this_.assert_target_os(spec.Os.Linux, "statx");

  const dirfd = read_i32(this_, dirfd_op);
  if (dirfd.$ === "Err") return dirfd;
  const pathname_ptr = this_.read_pointer(pathname_op);
  if (pathname_ptr.$ === "Err") return pathname_ptr;
  const flags_r = read_i32(this_, flags_op);
  if (flags_r.$ === "Err") return flags_r;
  const _mask = read_u32(this_, mask_op);
  if (_mask.$ === "Err") return _mask;
  const statxbuf_ptr = this_.read_pointer(statxbuf_op);
  if (statxbuf_ptr.$ === "Err") return statxbuf_ptr;

  // If the statxbuf or pathname pointers are null, the function fails with `EFAULT`.
  const n1 = this_.ptr_is_null(statxbuf_ptr._0);
  if (n1.$ === "Err") return n1;
  let is_null = n1._0;
  if (!is_null) {
    const n2 = this_.ptr_is_null(pathname_ptr._0);
    if (n2.$ === "Err") return n2;
    is_null = n2._0;
  }
  if (is_null) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }

  const statxbuf = this_.deref_pointer_as(statxbuf_op, this_.libc_ty_layout("statx"));
  if (statxbuf.$ === "Err") return statxbuf;
  const path = this_.read_path_from_c_str(pathname_ptr._0);
  if (path.$ === "Err") return path;

  // Parse flags.
  let flags = flags_r._0;
  // AT_EMPTY_PATH
  const at_empty_path = this_.eval_libc_i32("AT_EMPTY_PATH");
  const empty_path_flag = (flags & at_empty_path) === at_empty_path;
  flags &= ~at_empty_path;
  // AT_SYMLINK_NOFOLLOW
  const at_symlink_nofollow = this_.eval_libc_i32("AT_SYMLINK_NOFOLLOW");
  const symlink_nofollow_flag = (flags & at_symlink_nofollow) === at_symlink_nofollow;
  flags &= ~at_symlink_nofollow;
  // Complain about unknown flags.
  if (flags !== 0) {
    return throw_unsup_format(`unsupported flags for \`statx\`: ${hex_i32(flags)}`);
  }

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`statx`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  // Resolve dirfd + path to metadata.
  const metadata_r = FileMetadata.at(this_, dirfd._0, path._0, symlink_nofollow_flag, empty_path_flag);
  if (metadata_r.$ === "Err") return metadata_r;

  if (metadata_r._0.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(metadata_r._0._0);
  }
  const metadata = metadata_r._0._0;

  // The `_mask_op` parameter specifies the file information that the caller requested.
  // However, `statx` is allowed to return information that was not requested or to not
  // return information that was requested. This `mask` represents the information we can
  // actually provide for any target.
  let mask = (this_.eval_libc_u32("STATX_TYPE") | this_.eval_libc_u32("STATX_MODE") | this_.eval_libc_u32("STATX_SIZE")) >>> 0;

  // Check which pieces of metadata we acquired, and set the appropriate flags in the mask.
  if (metadata.ino !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_INO")) >>> 0;
  }
  if (metadata.nlink !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_NLINK")) >>> 0;
  }
  if (metadata.uid !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_UID")) >>> 0;
  }
  if (metadata.gid !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_GID")) >>> 0;
  }
  if (metadata.blocks !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_BLOCKS")) >>> 0;
  }

  // We need to set the corresponding bits of `mask` if the access, creation and modification
  // times were available. Otherwise we let them be zero.
  let access_sec = 0n;
  let access_nsec = 0;
  if (metadata.accessed !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_ATIME")) >>> 0;
    [access_sec, access_nsec] = metadata.accessed;
  }

  let created_sec = 0n;
  let created_nsec = 0;
  if (metadata.created !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_BTIME")) >>> 0;
    [created_sec, created_nsec] = metadata.created;
  }

  let modified_sec = 0n;
  let modified_nsec = 0;
  if (metadata.modified !== undefined) {
    mask = (mask | this_.eval_libc_u32("STATX_MTIME")) >>> 0;
    [modified_sec, modified_nsec] = metadata.modified;
  }

  // Now we write everything to `statxbuf`. We write a zero for the unavailable fields.
  const w = this_.write_int_fields_named(
    [
      ["stx_mask", BigInt(mask)],
      ["stx_mode", BigInt(metadata.mode)],
      ["stx_blksize", metadata.blksize ?? 0n],
      ["stx_attributes", 0n],
      ["stx_nlink", metadata.nlink ?? 0n],
      ["stx_uid", BigInt(metadata.uid ?? 0)],
      ["stx_gid", BigInt(metadata.gid ?? 0)],
      ["stx_ino", metadata.ino ?? 0n],
      ["stx_size", metadata.size],
      ["stx_blocks", metadata.blocks ?? 0n],
      ["stx_attributes_mask", 0n],
      ["stx_rdev_major", 0n],
      ["stx_rdev_minor", 0n],
      ["stx_dev_major", 0n],
      ["stx_dev_minor", 0n],
    ],
    statxbuf._0,
  );
  if (w.$ === "Err") return w;
  for (const [field, sec, nsec] of [
    ["stx_atime", access_sec, access_nsec],
    ["stx_btime", created_sec, created_nsec],
    ["stx_ctime", 0n, 0],
    ["stx_mtime", modified_sec, modified_nsec],
  ] as const) {
    const place = this_.project_field_named(statxbuf._0, field);
    if (place.$ === "Err") return place;
    const wt = this_.write_int_fields_named(
      [
        ["tv_sec", sec],
        ["tv_nsec", BigInt(nsec)],
      ],
      place._0,
    );
    if (wt.$ === "Err") return wt;
  }

  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1207 chmod
InterpCx.prototype.chmod = function (this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const path_ptr = this_.read_pointer(path_op);
  if (path_ptr.$ === "Err") return path_ptr;
  const mode_s = this_.read_scalar(mode_op);
  if (mode_s.$ === "Err") return mode_s;
  const mode = interp_Scalar.to_uint(mode_s._0, this_.libc_ty_layout("mode_t").size);
  if (mode.$ === "Err") return mode;

  const is_null = this_.ptr_is_null(path_ptr._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }
  const path = this_.read_path_from_c_str(path_ptr._0);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`chmod`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  const permissions = this_.host_permissions_from_mode(Number(try_from_unwrap(mode._0, 0n, U32_MAX)));
  if (permissions.$ === "Err") return permissions;
  const err = fs.set_permissions(path._0, permissions._0);
  if (err.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(IoError_from_io_Error(err._0));
  }

  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1232 fchmod
InterpCx.prototype.fchmod = function (this: MiriInterpCx, fd_op: OpTy, mode_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const mode_s = this_.read_scalar(mode_op);
  if (mode_s.$ === "Err") return mode_s;
  const mode = interp_Scalar.to_uint(mode_s._0, this_.libc_ty_layout("mode_t").size);
  if (mode.$ === "Err") return mode;

  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    // The docs don't talk about what happens for non-regular files...
    return throw_unsup_format("`fchmod` is only supported on regular files");
  }
  const file = into_inner(file_ref);
  if (!file.writable && !file.readable) {
    // Apparently, `fchmod` on a read-only file is fine. But let's not allow it on a
    // path-only file.
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  const permissions = this_.host_permissions_from_mode(Number(try_from_unwrap(mode._0, 0n, U32_MAX)));
  if (permissions.$ === "Err") return permissions;
  const err = (file.file as unknown as fs.File).set_permissions(permissions._0);
  if (err.$ === "Err") {
    return this_.set_errno_and_return_neg1_i32(IoError_from_io_Error(err._0));
  }

  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1260 rename
InterpCx.prototype.rename = function (this: MiriInterpCx, oldpath_op: OpTy, newpath_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const oldpath_ptr = this_.read_pointer(oldpath_op);
  if (oldpath_ptr.$ === "Err") return oldpath_ptr;
  const newpath_ptr = this_.read_pointer(newpath_op);
  if (newpath_ptr.$ === "Err") return newpath_ptr;

  const n1 = this_.ptr_is_null(oldpath_ptr._0);
  if (n1.$ === "Err") return n1;
  let is_null = n1._0;
  if (!is_null) {
    const n2 = this_.ptr_is_null(newpath_ptr._0);
    if (n2.$ === "Err") return n2;
    is_null = n2._0;
  }
  if (is_null) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }

  const oldpath = this_.read_path_from_c_str(oldpath_ptr._0);
  if (oldpath.$ === "Err") return oldpath;
  const newpath = this_.read_path_from_c_str(newpath_ptr._0);
  if (newpath.$ === "Err") return newpath;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`rename`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  const result = fs.rename(oldpath._0, newpath._0);

  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1288 mkdir
InterpCx.prototype.mkdir = function (this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  let mode: number;
  if (target_os_in(this_, ["MacOs", "FreeBsd"])) {
    const s = this_.read_scalar(mode_op);
    if (s.$ === "Err") return s;
    const m = interp_Scalar.to_u16(s._0);
    if (m.$ === "Err") return m;
    mode = m._0;
  } else {
    const m = read_u32(this_, mode_op);
    if (m.$ === "Err") return m;
    mode = m._0;
  }

  const path = read_path_op(this_, path_op);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`mkdir`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  const builder = fs.DirBuilder.new();

  // If the host supports it, forward on the mode of the directory
  // (i.e. permission bits and the sticky bit)
  if (cfg_unix()) {
    builder.mode(mode);
  }

  const result = builder.create(path._0);

  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1322 rmdir
InterpCx.prototype.rmdir = function (this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const path = read_path_op(this_, path_op);
  if (path.$ === "Err") return path;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`rmdir`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
  }

  let result: Result<null, io_Error>;
  if (cfg_unix()) {
    result = fs.remove_dir(path._0);
  } else {
    // This should *not* be able to remove symlinks to dirs, but on Windows it is. Our
    // work-around is racy (it might change to being a directory symlink after we
    // checked it), but there's not a lot we can do about that.
    result = unported("miri::shims::unix::fs rmdir: the cfg(windows) host branch (FileTypeExt::is_symlink_dir)");
  }

  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1353 opendir
InterpCx.prototype.opendir = function (this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const name = read_path_op(this_, name_op);
  if (name.$ === "Err") return name;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`opendir`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    const e = this_.set_last_error(LibcError("EACCES"));
    if (e.$ === "Err") return e;
    return interp_ok(interp_Scalar.null_ptr(this_));
  }

  const result = fs.read_dir(name._0);

  if (result.$ === "Ok") {
    const read_dir = result._0;
    // Also open the same directory as a directory handle, so we have
    // an underlying FD.
    // FIXME(https://github.com/rust-lang/miri/issues/5326): This is racy! We can't even
    // verify whether there was a race. We just trust that the directory did not change
    // in between above and here. One day, the standard library will support converting
    // between `Dir` and `ReadDir` (one of the two directions would suffice for our
    // needs), then we'll use that.
    const dir_r = fs.Dir.open(name._0);
    if (dir_r.$ === "Err") {
      return throw_unsup_format("cannot `opendir` this directory: failed to create directory handle");
    }
    const dir = this_.machine.fds.new_ref(new_DirHandle(dir_r._0));
    const dir_fd_id = dir.id();
    const dir_fd_num = this_.machine.fds.insert(dir);

    const stream = DirStream.new(read_dir, dir_fd_num, dir_fd_id);
    const id = this_.machine.dirs.insert_new(stream);

    // The libc API for opendir says that this method returns a pointer to an opaque
    // structure, but we are returning an ID number. Thus, pass it as a scalar of
    // pointer width. This also conveniently means that any attempt to access
    // memory via this pointer raises UB.
    return interp_ok(interp_Scalar.from_target_usize(id, this_));
  } else {
    const e = this_.set_last_error(IoError_from_io_Error(result._0));
    if (e.$ === "Err") return e;
    return interp_ok(interp_Scalar.null_ptr(this_));
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1405 readdir
InterpCx.prototype.readdir = function (this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy, buf_type: string): InterpResult {
  const this_ = this.eval_context_mut();

  if (!target_os_in(this_, ["Linux", "Android", "Solaris", "Illumos", "FreeBsd", "MacOs"])) {
    return throw_unsup_format(`\`readdir\` is not yet supported on ${display_target_os(this_)}`);
  }

  const dirp_r = this_.read_target_usize(dirp_op);
  if (dirp_r.$ === "Err") return dirp_r;
  const dirp = dirp_r._0;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`readdir`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    const e = this_.set_last_error(LibcError("EBADF"));
    if (e.$ === "Err") return e;
    const w = this_.write_null(dest);
    if (w.$ === "Err") return w;
    return interp_ok(undefined);
  }

  const open_dir = this_.machine.dirs.streams.get(dirp);
  if (open_dir === undefined) {
    return throw_ub_format("the DIR pointer passed to `readdir` did not come from opendir");
  }

  // Check that the backing FD is still valid.
  if (backing_fd_tampered(this_, open_dir)) {
    return throw_ub_format("the backing FD for this DIR stream has been tampered with");
  }

  let entry: Pointer | undefined;
  const next = open_dir.next_host_entry();
  if (next !== undefined && next.$ === "Ok") {
    const dir_entry_r = this_.dir_entry_fields(next._0);
    if (dir_entry_r.$ === "Err") return dir_entry_r;
    const dir_entry = dir_entry_r._0;

    // Write the directory entry into a newly allocated buffer.
    // The name is written with write_bytes, while the rest of the
    // dirent64 (or dirent) struct is written using write_int_fields.

    // For reference:
    // On Linux:
    // pub struct dirent64 {
    //     pub d_ino: ino64_t,
    //     pub d_off: off64_t,
    //     pub d_reclen: c_ushort,
    //     pub d_type: c_uchar,
    //     pub d_name: [c_char; 256],
    // }
    //
    // On Solaris:
    // pub struct dirent {
    //     pub d_ino: ino64_t,
    //     pub d_off: off64_t,
    //     pub d_reclen: c_ushort,
    //     pub d_name: [c_char; 3],
    // }
    //
    // On FreeBSD:
    // pub struct dirent {
    //     pub d_fileno: uint32_t,
    //     pub d_reclen: uint16_t,
    //     pub d_type: uint8_t,
    //     pub d_namlen: uint8_t,
    //     pub d_name: [c_char; 256],
    // }
    //
    // On macOS:
    // pub struct dirent {
    //     pub d_ino: u64,
    //     pub d_seekoff: u64,
    //     pub d_reclen: u16,
    //     pub d_namlen: u16,
    //     pub d_type: u8,
    //     pub d_name: [c_char; 1024],
    // }

    const dirent_layout = this_.libc_ty_layout(buf_type);
    const fields = dirent_layout.fields;
    const count = FieldsShape.count(fields);
    assert(count >= 1, "attempt to subtract with overflow");
    const d_name_offset = FieldsShape.offset(fields, count - 1).bytes_u64();

    // Determine the size of the buffer we have to allocate.
    const name = dir_entry.name + "\0"; // not a Path as there are no separators! / Add a NUL terminator
    const name_bytes = utf8(name);
    const name_len = BigInt(name_bytes.length);
    const size = d_name_offset + name_len;

    const entry_r = this_.allocate_ptr(Size.from_bytes(size), dirent_layout.align.abi, MemoryKind_from_MiriMemoryKind("Runtime"), "Uninit");
    if (entry_r.$ === "Err") return entry_r;
    const entry_place = this_.ptr_to_mplace(Pointer_Option_from_Pointer(entry_r._0 as StrictPointer), dirent_layout);

    // Write the name.
    // The name is not a normal field, we already computed the offset above.
    const name_ptr = entry_place.ptr().wrapping_offset(Size.from_bytes(d_name_offset), this_);
    const wn = this_.write_bytes_ptr(name_ptr, name_bytes.values());
    if (wn.$ === "Err") return wn;

    // Write common fields.
    const ino_name = this_.tcx.deref().sess.target.os.$ === "FreeBsd" ? "d_fileno" : "d_ino";
    const wc = this_.write_int_fields_named(
      [
        [ino_name, dir_entry.ino],
        ["d_reclen", size],
      ],
      entry_place,
    );
    if (wc.$ === "Err") return wc;

    // Write "optional" fields.
    const d_off = this_.try_project_field_named(entry_place, "d_off");
    if (d_off.$ === "Err") return d_off;
    if (d_off._0 !== undefined) {
      const w = this_.write_null(d_off._0);
      if (w.$ === "Err") return w;
    }
    const d_seekoff = this_.try_project_field_named(entry_place, "d_seekoff");
    if (d_seekoff.$ === "Err") return d_seekoff;
    if (d_seekoff._0 !== undefined) {
      const w = this_.write_null(d_seekoff._0);
      if (w.$ === "Err") return w;
    }
    const d_namlen = this_.try_project_field_named(entry_place, "d_namlen");
    if (d_namlen.$ === "Err") return d_namlen;
    if (d_namlen._0 !== undefined) {
      assert(name_len >= 1n, "attempt to subtract with overflow");
      const w = this_.write_int(name_len - 1n, d_namlen._0);
      if (w.$ === "Err") return w;
    }
    const d_type = this_.try_project_field_named(entry_place, "d_type");
    if (d_type.$ === "Err") return d_type;
    if (d_type._0 !== undefined) {
      const w = this_.write_int(BigInt(dir_entry.d_type), d_type._0);
      if (w.$ === "Err") return w;
    }

    entry = entry_place.ptr();
  } else if (next === undefined) {
    // end of stream: return NULL
    entry = undefined;
  } else {
    const e = this_.set_last_error(IoError_from_io_Error(next._0));
    if (e.$ === "Err") return e;
    entry = undefined;
  }

  const open_dir2 = this_.machine.dirs.streams.get(dirp);
  if (open_dir2 === undefined) return panic("called `Option::unwrap()` on a `None` value");
  // std::mem::replace(&mut open_dir.entry, entry.map(|e| (e, buf_type)))
  const old = open_dir2.entry;
  open_dir2.entry = entry === undefined ? undefined : [entry, buf_type];
  if (old !== undefined) {
    const [old_entry, old_type] = old;
    if (old_type !== buf_type) {
      return throw_ub_format("mixing different `readdir` variants on the same `DIR` instance");
    }
    const d = this_.deallocate_ptr(old_entry, undefined, MemoryKind_from_MiriMemoryKind("Runtime"));
    if (d.$ === "Err") return d;
  }

  const w = this_.write_pointer(entry ?? interp_Pointer.null(), dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1556 dirfd
InterpCx.prototype.dirfd = function (this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const dirp = this_.read_target_usize(dirp_op);
  if (dirp.$ === "Err") return dirp;

  const open_dir = this_.machine.dirs.streams.get(dirp._0);
  if (open_dir === undefined) {
    return throw_ub_format("the DIR pointer passed to `readdir` did not come from opendir");
  }

  // Check that the backing FD is still valid.
  if (backing_fd_tampered(this_, open_dir)) {
    return throw_ub_format("the backing FD for this DIR stream has been tampered with");
  }

  const fd_num = open_dir.fd_num;
  const w = this_.write_int(BigInt(fd_num), dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1575 closedir
InterpCx.prototype.closedir = function (this: MiriInterpCx, dirp_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const dirp = this_.read_target_usize(dirp_op);
  if (dirp.$ === "Err") return dirp;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`closedir`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }

  const open_dir = this_.machine.dirs.streams.get(dirp._0);
  if (open_dir === undefined) {
    return throw_ub_format("the DIR pointer passed to `closedir` did not come from opendir");
  }
  this_.machine.dirs.streams.delete(dirp._0);

  // Check that the backing FD is still valid.
  if (backing_fd_tampered(this_, open_dir)) {
    return throw_ub_format("the backing FD for this DIR stream has been tampered with");
  }
  // And close it.
  const c = this_.close(open_dir.fd_num);
  if (c.$ === "Err") return c;

  const taken = open_dir.entry;
  open_dir.entry = undefined;
  if (taken !== undefined) {
    const [entry, _type] = taken;
    const d = this_.deallocate_ptr(entry, undefined, MemoryKind_from_MiriMemoryKind("Runtime"));
    if (d.$ === "Err") return d;
  }
  // We drop the `open_dir`, which will close the host dir handle.
  // drop(open_dir);

  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1606 ftruncate64
InterpCx.prototype.ftruncate64 = function (this: MiriInterpCx, fd_num: number, length: bigint): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    // The docs say that EINVAL is returned when the FD "does not reference a regular file
    // or a POSIX shared memory object" (and we don't support shmem objects).
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  const file = into_inner(file_ref);
  if (!file.writable) {
    // man page says "EBADF or EINVAL", Linux seems to use EINVAL.
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  // if let Ok(length) = length.try_into()  (i128 -> u64)
  if (length >= 0n && length <= U64_MAX) {
    const result = (file.file as unknown as fs.File).set_len(length);
    const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
    if (r.$ === "Err") return r;
    return interp_ok(interp_Scalar.from_i32(r._0));
  } else {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
};

/// NOTE: According to the man page of `possix_fallocate`, it returns the error code instead
/// of setting `errno`.
// rustc: src/tools/miri/src/shims/unix/fs.rs:1634 posix_fallocate
InterpCx.prototype.posix_fallocate = function (this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`posix_fallocate`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    // Return error code "EBADF" (bad fd).
    return interp_ok(this_.eval_libc("EBADF"));
  }

  const r = this_.fallocate_impl(fd_num, offset, len);
  if (r.$ === "Err") return r;
  if (r._0.$ === "Ok") {
    return interp_ok(interp_Scalar.from_i32(0));
  } else {
    return this_.io_error_to_errnum(r._0._0);
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1655 linux_fallocate
InterpCx.prototype.linux_fallocate = function (this: MiriInterpCx, fd: number, mode: number, offset: bigint, size: bigint): InterpResult<Scalar> {
  // This is mostly a copy of `posix_fallocate` except that errors are returned via errno.
  const this_ = this.eval_context_mut();

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`fallocate`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    // Set error code "EBADF" (bad fd).
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }

  // We only support `fallocate` as a replacement for `posix_fallocate` on linux,
  // so a non-default `mode` is not supported.
  if (mode !== 0) {
    return throw_unsup_format(`unsupported flags for \`fallocate\` in \`mode\` argument: ${hex_i32(mode)}`);
  }

  const r = this_.fallocate_impl(fd, offset, size);
  if (r.$ === "Err") return r;
  if (r._0.$ === "Ok") {
    return interp_ok(interp_Scalar.from_i32(0));
  } else {
    return this_.set_errno_and_return_neg1_i32(r._0._0);
  }
};

/// Shared logic between `posix_fallocate` and `linux_fallocate`.
// rustc: src/tools/miri/src/shims/unix/fs.rs:1685 fallocate_impl
InterpCx.prototype.fallocate_impl = function (this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Result<null, IoError>> {
  const this_ = this.eval_context_mut();

  // EINVAL is returned/set when: "offset was less than 0, or len was less than or equal to 0".
  if (offset < 0n || len <= 0n) {
    return interp_ok(Err(LibcError("EINVAL")));
  }

  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return interp_ok(Err(LibcError("EBADF")));
  }
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    // Man page specifies to return ENODEV if `fd` is not a regular file.
    return interp_ok(Err(LibcError("ENODEV")));
  }
  const file = into_inner(file_ref);

  if (!file.writable) {
    return interp_ok(Err(LibcError("EBADF")));
  }

  const host_file = file.file as unknown as fs.File;
  const md = host_file.metadata();
  if (md.$ === "Err") return interp_ok(Err(IoError_from_io_Error(md._0)));
  const current_size = md._0.len();

  // Checked i64 addition, to ensure the result does not exceed the max file size.
  const sum = offset + len;
  if (sum > I64_MAX) {
    return interp_ok(Err(LibcError("EFBIG"))); // new size too big
  }
  // `new_size` is definitely non-negative, so we can cast to `u64`.
  const new_size = try_from_unwrap(sum, 0n, U64_MAX);

  // If the size of the file is less than offset+size, then the file is increased to this
  // size; otherwise the file size is left unchanged.
  if (current_size < new_size) {
    const r = host_file.set_len(new_size);
    if (r.$ === "Ok") return interp_ok(Ok(null));
    return interp_ok(Err(IoError_from_io_Error(r._0)));
  } else {
    return interp_ok(Ok(null));
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1734 fsync
InterpCx.prototype.fsync = function (this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar> {
  // On macOS, `fsync` (unlike `fcntl(F_FULLFSYNC)`) does not wait for the
  // underlying disk to finish writing. In the interest of host compatibility,
  // we conservatively implement this with `sync_all`, which
  // *does* wait for the disk.

  const this_ = this.eval_context_mut();

  const fd = read_i32(this_, fd_op);
  if (fd.$ === "Err") return fd;

  return this.ffullsync_fd(fd._0);
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1747 ffullsync_fd
InterpCx.prototype.ffullsync_fd = function (this: MiriInterpCx, fd_num: number): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  // Only regular files support synchronization.
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    return throw_unsup_format("`fsync` is only supported on file-backed file descriptors");
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  const io_result = maybe_sync_file(into_inner(file_ref), (f) => f.sync_all());
  const r = this_.try_unwrap_io_result(io_result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1762 fdatasync
InterpCx.prototype.fdatasync = function (this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;

  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  // Only regular files support synchronization.
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    return throw_unsup_format("`fdatasync` is only supported on file-backed file descriptors");
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  const io_result = maybe_sync_file(into_inner(file_ref), (f) => f.sync_data());
  const r = this_.try_unwrap_io_result(io_result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

/// `futimens(fd, times)`: set `fd`'s access/modification times. `times` is `[atime, mtime]`, or
/// NULL to set both to now.
// rustc: src/tools/miri/src/shims/unix/fs.rs:1782 futimens
InterpCx.prototype.futimens = function (this: MiriInterpCx, fd_op: OpTy, times_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const times_ptr = this_.read_pointer(times_op);
  if (times_ptr.$ === "Err") return times_ptr;

  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    return throw_unsup_format("`futimens` is only supported on file-backed file descriptors");
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  const times = this_.parse_utimens_times(times_ptr._0);
  if (times.$ === "Err") return times;
  if (times._0 === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  const [access, modified] = times._0;
  const result = (into_inner(file_ref).file as unknown as fs.File).set_times(host_file_times_from_updates(access, modified));
  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

/// `utimensat(dirfd, path, times, flags)`: like `futimens`, but for the file at `path`. With
/// `AT_SYMLINK_NOFOLLOW`, a symlink at `path` is updated itself rather than its target.
// rustc: src/tools/miri/src/shims/unix/fs.rs:1809 utimensat
InterpCx.prototype.utimensat = function (this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, times_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const dirfd = read_i32(this_, dirfd_op);
  if (dirfd.$ === "Err") return dirfd;
  const path_ptr = this_.read_pointer(path_op);
  if (path_ptr.$ === "Err") return path_ptr;
  const times_ptr = this_.read_pointer(times_op);
  if (times_ptr.$ === "Err") return times_ptr;
  const flags_r = read_i32(this_, flags_op);
  if (flags_r.$ === "Err") return flags_r;

  const is_null = this_.ptr_is_null(path_ptr._0);
  if (is_null.$ === "Err") return is_null;
  if (is_null._0) {
    // With `AT_FDCWD` this is a bad address on all systems. With any other `dirfd`, Linux
    // operates on `dirfd` itself (like `futimens`) while macOS still fails.
    if (dirfd._0 !== this_.eval_libc_i32("AT_FDCWD")) {
      return throw_unsup_format("`utimensat` with a NULL path is only supported for `AT_FDCWD`");
    }
    return this_.set_errno_and_return_neg1_i32(LibcError("EFAULT"));
  }
  const path = this_.read_path_from_c_str(path_ptr._0);
  if (path.$ === "Err") return path;

  const rej = reject_if_isolated(this_, "`utimensat`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  let flags = flags_r._0;
  // Parse known flags and subtract them from `flags`.
  const at_symlink_nofollow = this_.eval_libc_i32("AT_SYMLINK_NOFOLLOW");
  const symlink_nofollow_flag = (flags & at_symlink_nofollow) === at_symlink_nofollow;
  flags &= ~at_symlink_nofollow;

  if (flags !== 0) {
    return throw_unsup_format(`unsupported flags for \`utimensat\`: ${hex_i32(flags)}`);
  }

  if (!(path_is_absolute(path._0) || dirfd._0 === this_.eval_libc_i32("AT_FDCWD"))) {
    return throw_unsup_format("`utimensat` with a path relative to a `dirfd` is not supported");
  }

  const times = this_.parse_utimens_times(times_ptr._0);
  if (times.$ === "Err") return times;
  if (times._0 === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  const [access, modified] = times._0;
  if (access.$ === "Omit" && modified.$ === "Omit") {
    // Nothing to do. Behavior in this case differs between platforms: Linux always
    // succeeds, macOS/FreeBSD check whether the file exists. POSIX arguably allows both.
    // We decide to follow Linux.
    return interp_ok(interp_Scalar.from_i32(0));
  }
  const filetimes = host_file_times_from_updates(access, modified);
  const result = symlink_nofollow_flag ? fs.set_times_nofollow(path._0, filetimes) : fs.set_times(path._0, filetimes);
  const r = this_.try_unwrap_io_result(result.$ === "Ok" ? Ok(0) : result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1872 sync_file_range
InterpCx.prototype.sync_file_range = function (this: MiriInterpCx, fd_op: OpTy, offset_op: OpTy, nbytes_op: OpTy, flags_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const offset = read_i64(this_, offset_op);
  if (offset.$ === "Err") return offset;
  const nbytes = read_i64(this_, nbytes_op);
  if (nbytes.$ === "Err") return nbytes;
  const flags = read_i32(this_, flags_op);
  if (flags.$ === "Err") return flags;

  if (offset._0 < 0n || nbytes._0 < 0n) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }
  const allowed_flags =
    this_.eval_libc_i32("SYNC_FILE_RANGE_WAIT_BEFORE") | this_.eval_libc_i32("SYNC_FILE_RANGE_WRITE") | this_.eval_libc_i32("SYNC_FILE_RANGE_WAIT_AFTER");
  if ((flags._0 & allowed_flags) !== flags._0) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }

  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EBADF"));
  }
  // Only regular files support synchronization.
  const file_ref = fd.downcast(is_FileHandle);
  if (file_ref === undefined) {
    return throw_unsup_format("`sync_data_range` is only supported on file-backed file descriptors");
  }
  assert(this_.machine.communicate(), "isolation should have prevented even opening a file");

  const io_result = maybe_sync_file(into_inner(file_ref), (f) => f.sync_data());
  const r = this_.try_unwrap_io_result(io_result, (v) => v);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(r._0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1909 readlink
InterpCx.prototype.readlink = function (this: MiriInterpCx, pathname_op: OpTy, buf_op: OpTy, bufsize_op: OpTy): InterpResult<bigint> {
  const this_ = this.eval_context_mut();

  const pathname_ptr = this_.read_pointer(pathname_op);
  if (pathname_ptr.$ === "Err") return pathname_ptr;
  const pathname_r = this_.read_os_str_from_c_str(pathname_ptr._0);
  if (pathname_r.$ === "Err") return pathname_r;
  const pathname = pathname_r._0;
  const buf = this_.read_pointer(buf_op);
  if (buf.$ === "Err") return buf;
  const bufsize = this_.read_target_usize(bufsize_op);
  if (bufsize.$ === "Err") return bufsize;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`readlink`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    const e = this_.set_last_error(LibcError("EACCES"));
    if (e.$ === "Err") return e;
    return interp_ok(-1n);
  }

  // Special case the procfs link to the current executable so that
  // `std::env::current_exe` works in cross-execution.
  let self_exe: string | undefined;
  switch (this_.tcx.deref().sess.target.os.$) {
    case "Linux":
    case "Android":
      self_exe = "/proc/self/exe";
      break;
    case "Solaris":
    case "Illumos":
      self_exe = "/proc/self/path/a.out";
      break;
    default:
      self_exe = undefined;
  }
  let result: Result<string, io_Error>;
  if (self_exe !== undefined && pathname === self_exe) {
    const current_exe = this_.machine.current_exe;
    result = current_exe !== undefined ? Ok(current_exe) : Err(io_Error_from_ErrorKind("NotFound"));
  } else if (target_os_in(this_, ["Linux", "Android", "Illumos", "Solaris"]) && is_in_proc(pathname)) {
    // Trying to read a symlink inside `/proc` is likely going to be nonsense, e.g.
    // `/proc/self/fd/N` doesn't use the same FD numbering. So we pretend nothing exists.
    const e = this_.set_last_error(IoError_from_ErrorKind("NotFound"));
    if (e.$ === "Err") return e;
    return interp_ok(-1n);
  } else {
    // We read `pathname` as `OsStr` above so we could do the /proc/self/exe check.
    // But now we need a (host) path.
    const host_pathname = this_.convert_path(pathname, "TargetToHost");
    result = fs.read_link(host_pathname);
  }

  if (result.$ === "Ok") {
    // 'readlink' truncates the resolved path if the provided buffer is not large
    // enough, and does *not* add a null terminator. That means we cannot use the usual
    // `write_path_to_c_str` and have to re-implement parts of it ourselves.
    const resolved = this_.convert_path(result._0, "HostToTarget");
    let path_bytes = utf8(resolved);
    const bufsize_ = Number(bufsize._0); // bufsize.try_into().unwrap() (u64 -> usize)
    if (path_bytes.length > bufsize_) {
      path_bytes = path_bytes.subarray(0, bufsize_);
    }
    const w = this_.write_bytes_ptr(buf._0, path_bytes.values());
    if (w.$ === "Err") return w;
    return interp_ok(BigInt(path_bytes.length));
  } else {
    const e = this_.set_last_error(IoError_from_io_Error(result._0));
    if (e.$ === "Err") return e;
    return interp_ok(-1n);
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1975 isatty
InterpCx.prototype.isatty = function (this: MiriInterpCx, miri_fd: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  // "returns 1 if fd is an open file descriptor referring to a terminal;
  // otherwise 0 is returned, and errno is set to indicate the error"
  const fd_num = read_i32(this_, miri_fd);
  if (fd_num.$ === "Err") return fd_num;
  let error: IoError;
  const fd = this_.machine.fds.get(fd_num._0);
  if (fd !== undefined) {
    if (with_ref(fd, (fd) => fd.deref().is_tty(this_.machine.communicate()))) {
      return interp_ok(interp_Scalar.from_i32(1));
    } else {
      error = LibcError("ENOTTY");
    }
  } else {
    // FD does not exist
    error = LibcError("EBADF");
  }
  const e = this_.set_last_error(error);
  if (e.$ === "Err") return e;
  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:1994 realpath
InterpCx.prototype.realpath = function (this: MiriInterpCx, path_op: OpTy, processed_path_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("realpath");

  const pathname = read_path_op(this_, path_op);
  if (pathname.$ === "Err") return pathname;
  const processed_ptr = this_.read_pointer(processed_path_op);
  if (processed_ptr.$ === "Err") return processed_ptr;

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`realpath`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    const e = this_.set_last_error(LibcError("EACCES"));
    if (e.$ === "Err") return e;
    return interp_ok(interp_Scalar.from_target_usize(0n, this_));
  }

  const result = fs.canonicalize(pathname._0);
  if (result.$ === "Ok") {
    const resolved = result._0;
    const path_max_i32 = this_.eval_libc_i32("PATH_MAX");
    if (path_max_i32 < 0) panic("PATH_MAX does not fit in u64: TryFromIntError(())");
    const path_max = BigInt(path_max_i32);
    let dest: Pointer;
    const is_null = this_.ptr_is_null(processed_ptr._0);
    if (is_null.$ === "Err") return is_null;
    if (is_null._0) {
      // POSIX says behavior when passing a null pointer is implementation-defined,
      // but GNU/linux, freebsd, netbsd, bionic/android, and macos all treat a null pointer
      // similarly to:
      //
      // "If resolved_path is specified as NULL, then realpath() uses
      // malloc(3) to allocate a buffer of up to PATH_MAX bytes to hold
      // the resolved pathname, and returns a pointer to this buffer.  The
      // caller should deallocate this buffer using free(3)."
      // <https://man7.org/linux/man-pages/man3/realpath.3.html>
      const a = this_.alloc_path_as_c_str(resolved, MemoryKind_from_MiriMemoryKind("C") as never);
      if (a.$ === "Err") return a;
      dest = a._0;
    } else {
      const wr = this_.write_path_to_c_str(resolved, processed_ptr._0, path_max);
      if (wr.$ === "Err") return wr;
      const [wrote_path, _] = wr._0;

      if (!wrote_path) {
        // Note that we do not explicitly handle `FILENAME_MAX`
        // (different from `PATH_MAX` above) as it is Linux-specific and
        // seems like a bit of a mess anyway: <https://eklitzke.org/path-max-is-tricky>.
        const e = this_.set_last_error(LibcError("ENAMETOOLONG"));
        if (e.$ === "Err") return e;
        return interp_ok(interp_Scalar.from_target_usize(0n, this_));
      }
      dest = processed_ptr._0;
    }

    return interp_ok(interp_Scalar.from_maybe_pointer(dest, this_));
  } else {
    const e = this_.set_last_error(IoError_from_io_Error(result._0));
    if (e.$ === "Err") return e;
    return interp_ok(interp_Scalar.from_target_usize(0n, this_));
  }
};

// rustc: src/tools/miri/src/shims/unix/fs.rs:2052 mkstemp
InterpCx.prototype.mkstemp = function (this: MiriInterpCx, template_op: OpTy): InterpResult<Scalar> {
  // use rand::seq::IndexedRandom;

  // POSIX defines the template string.
  const TEMPFILE_TEMPLATE_STR = "XXXXXX";

  const this_ = this.eval_context_mut();
  this_.assert_target_os_is_unix("mkstemp");

  // POSIX defines the maximum number of attempts before failure.
  //
  // `mkstemp()` relies on `tmpnam()` which in turn relies on `TMP_MAX`.
  // POSIX says this about `TMP_MAX`:
  // * Minimum number of unique filenames generated by `tmpnam()`.
  // * Maximum number of times an application can call `tmpnam()` reliably.
  //   * The value of `TMP_MAX` is at least 25.
  //   * On XSI-conformant systems, the value of `TMP_MAX` is at least 10000.
  // See <https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/stdio.h.html>.
  const max_attempts = this_.eval_libc_u32("TMP_MAX");

  // Get the raw bytes from the template -- as a byte slice, this is a string in the target
  // (and the target is unix, so a byte slice is the right representation).
  const template_ptr = this_.read_pointer(template_op);
  if (template_ptr.$ === "Err") return template_ptr;
  const template_r = this_.eval_context_ref().read_c_str(template_ptr._0);
  if (template_r.$ === "Err") return template_r;
  const template_bytes = template_r._0.slice();

  // Reject if isolation is enabled.
  const rej = reject_if_isolated(this_, "`mkstemp`");
  if (rej !== undefined) {
    if (rej.$ === "Err") return rej;
    return this_.set_errno_and_return_neg1_i32(LibcError("EACCES"));
  }

  // Get the bytes of the suffix we expect in _target_ encoding.
  const suffix_bytes = utf8(TEMPFILE_TEMPLATE_STR);

  // At this point we have one `&[u8]` that represents the template and one `&[u8]`
  // that represents the expected suffix.

  // Now we figure out the index of the slice we expect to contain the suffix.
  const start_pos = Math.max(template_bytes.length - suffix_bytes.length, 0);
  const end_pos = template_bytes.length;
  const last_six_char_bytes = template_bytes.subarray(start_pos, end_pos);

  // If we don't find the suffix, it is an error.
  if (last_six_char_bytes.length !== suffix_bytes.length || last_six_char_bytes.some((b, i) => b !== suffix_bytes[i])) {
    return this_.set_errno_and_return_neg1_i32(LibcError("EINVAL"));
  }

  // At this point we know we have 6 ASCII 'X' characters as a suffix.

  // From <https://github.com/lattera/glibc/blob/895ef79e04a953cac1493863bcae29ad85657ee1/sysdeps/posix/tempname.c#L175>
  const SUBSTITUTIONS: readonly string[] = [
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q",
    "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H",
    "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
    "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ];

  // The file is opened with specific options, which Rust does not expose in a portable way.
  // So we use specific APIs depending on the host OS.
  const fopts = fs.OpenOptions.new();
  fopts.read(true).write(true).create_new(true);

  if (cfg_unix()) {
    // Do not allow others to read or modify this file.
    fopts.mode(0o600);
    fopts.custom_flags(host_libc("O_EXCL"));
  } else if (cfg_windows()) {
    // Do not allow others to read or modify this file.
    return unported("std::os::windows::fs::OpenOptionsExt::share_mode (mkstemp on a Windows host)");
  } else {
    return throw_unsup_format("`mkstemp` is not supported on this host OS");
  }

  // If the generated file already exists, we will try again `max_attempts` many times.
  for (let i = 0; i < max_attempts; i++) {
    const rng = this_.machine.rng;

    // Generate a random unique suffix.
    let unique_suffix = "";
    for (let j = 0; j < 6; j++) unique_suffix += IndexedRandom_choose(SUBSTITUTIONS, rng);

    // Replace the template string with the random string.
    template_bytes.set(utf8(unique_suffix), start_pos);

    // Write the modified template back to the passed in pointer to maintain POSIX semantics.
    const w = this_.write_bytes_ptr(template_ptr._0, template_bytes.values());
    if (w.$ === "Err") return w;

    // See if we can create and open this file.
    const os_str = bytes_to_os_str(template_bytes);
    if (os_str.$ === "Err") return os_str;
    const file = fopts.open(os_str._0);
    if (file.$ === "Ok") {
      const fd = this_.machine.fds.insert_new(new_FileHandle(file._0, true, true));
      return interp_ok(interp_Scalar.from_i32(fd));
    } else {
      const e = file._0;
      // If the random file already exists, keep trying.
      if (IoError_kind(e) === "AlreadyExists") continue;
      // Any other errors are returned to the caller.
      // "On error, -1 is returned, and errno is set to
      // indicate the error"
      return this_.set_errno_and_return_neg1_i32(IoError_from_io_Error(e));
    }
  }

  // We ran out of attempts to create the file, return an error.
  return this_.set_errno_and_return_neg1_i32(LibcError("EEXIST"));
};

/** `SUBSTITUTIONS.choose(rng).unwrap()` (`rand::seq::IndexedRandom::choose`, rand 0.10.1 src/seq/slice.rs): not in the
 *  vendored rand subset (src/vendor/rand; plan-m6 D5 ported the `StdRng` path only). Reached only with isolation off. */
function IndexedRandom_choose(_slice: readonly string[], _rng: unknown): string {
  return unported("rand::seq::IndexedRandom::choose (rand 0.10.1 src/seq/slice.rs; not in the vendored subset, src/vendor/rand)");
}

/// Extracts the number of seconds and nanoseconds elapsed between `time` and the unix epoch when
/// `time` is Ok. Returns `None` if `time` is an error. Fails if `time` happens before the unix
/// epoch.
// rustc: src/tools/miri/src/shims/unix/fs.rs:2179 extract_sec_and_nsec
function extract_sec_and_nsec(time: Result<SystemTime, io_Error>): InterpResult<[bigint, number] | undefined> {
  if (time.$ === "Ok") {
    const duration = system_time_to_duration(time._0);
    if (duration.$ === "Err") return duration;
    return interp_ok([duration._0.as_secs(), duration._0.subsec_nanos()]);
  } else {
    return interp_ok(undefined);
  }
}

// rustc: src/tools/miri/src/shims/unix/fs.rs:2191 file_type_to_mode_name
function file_type_to_mode_name(file_type: fs.FileType): string {
  if (file_type.is_file()) {
    return "S_IFREG";
  } else if (file_type.is_dir()) {
    return "S_IFDIR";
  } else if (file_type.is_symlink()) {
    return "S_IFLNK";
  } else {
    // Certain file types are only available when the host is a Unix system.
    if (cfg_unix()) {
      if (file_type.is_socket()) {
        return "S_IFSOCK";
      } else if (file_type.is_fifo()) {
        return "S_IFIFO";
      } else if (file_type.is_char_device()) {
        return "S_IFCHR";
      } else if (file_type.is_block_device()) {
        return "S_IFBLK";
      }
    }
    return "S_IFREG";
  }
}

// impl FileMetadata
/// Implements the shared "metadata at" semantics of `fstatat` and `statx`.
// rustc: src/tools/miri/src/shims/unix/fs.rs:2242 at
port_methods("miri::shims::unix::fs::FileMetadata", () => FileMetadata, {
at: function (ecx: MiriInterpCx, dirfd: FdNum, path: string, symlink_nofollow_flag: boolean, empty_path_flag: boolean): InterpResult<Result<FileMetadata, IoError>> {
  // If the path is empty, and the AT_EMPTY_PATH flag is set, we query the open file
  // represented by dirfd, whether it's a directory or otherwise.
  if (path === "") {
    // no path: invalid by default, load metadata about dirfd with flag
    if (!empty_path_flag) {
      return interp_ok(Err(LibcError("ENOENT")));
    }
    return FileMetadata.from_fd_num(ecx, dirfd);
  } else if (path_is_absolute(path) || dirfd === ecx.eval_libc_i32("AT_FDCWD")) {
    // Either absolute path (dirfd is ignored) or relative to working directory.
    return FileMetadata.from_host(ecx, symlink_nofollow_flag ? fs.symlink_metadata(path) : fs.metadata(path));
  } else {
    // relative to dirfd, which must be a directory handle
    const fd = ecx.machine.fds.get(dirfd);
    if (fd === undefined) {
      return interp_ok(Err(LibcError("EBADF")));
    }
    const dir_ref = fd.downcast(is_DirHandle);
    if (dir_ref === undefined) {
      return interp_ok(Err(LibcError("ENOTDIR")));
    }
    const dir = into_inner(dir_ref).dir as unknown as fs.Dir;

    // Windows does not by itself treat `.` correctly so we do that by hand.
    // (https://github.com/rust-lang/rust/issues/163032)
    // #[cfg(not(bootstrap))]
    let metadata: Result<fs.Metadata, io_Error>;
    if (path === ".") {
      metadata = dir.self_metadata();
    } else if (symlink_nofollow_flag) {
      metadata = dir.symlink_metadata(path);
    } else {
      metadata = dir.metadata(path);
    }
    return FileMetadata.from_host(ecx, metadata);
  }
}});

// rustc: src/tools/miri/src/shims/unix/fs.rs:2294 from_fd_num
port_methods("miri::shims::unix::fs::FileMetadata", () => FileMetadata, {
from_fd_num: function (ecx: MiriInterpCx, fd_num: FdNum): InterpResult<Result<FileMetadata, IoError>> {
  const fd = ecx.machine.fds.get(fd_num);
  if (fd === undefined) {
    return interp_ok(Err(LibcError("EBADF")));
  }
  const md = with_ref(fd, (fd) => fd.deref().metadata());
  if (md.$ === "Err") return md;
  const either = md._0 as unknown as Either<Result<fs.Metadata, io_Error>, string>;
  switch (either.$) {
    case "Left":
      return FileMetadata.from_host(ecx, either._0);
    case "Right":
      return FileMetadata.synthetic(ecx, either._0);
  }
}});

// rustc: src/tools/miri/src/shims/unix/fs.rs:2307 synthetic
port_methods("miri::shims::unix::fs::FileMetadata", () => FileMetadata, {
synthetic: function (ecx: MiriInterpCx, mode_name: string): InterpResult<Result<FileMetadata, IoError>> {
  const mode_s = ecx.eval_libc(mode_name);
  const mode_u = interp_Scalar.to_uint(mode_s, ecx.libc_ty_layout("mode_t").size);
  if (mode_u.$ === "Err") return mode_u;
  let mode = Number(try_from_unwrap(mode_u._0, 0n, U32_MAX));
  // We observed 0x777 on sockets and 0x600 on pipes...
  mode = (mode | 0o666) >>> 0;
  return interp_ok(
    Ok(
      new FileMetadata(
        mode,
        /* size */ 0n,
        /* created */ undefined,
        /* accessed */ undefined,
        /* modified */ undefined,
        /* dev */ undefined,
        /* ino */ undefined,
        /* nlink */ undefined,
        /* uid */ undefined,
        /* gid */ undefined,
        /* blksize */ undefined,
        /* blocks */ undefined,
      ),
    ),
  );
}});

// rustc: src/tools/miri/src/shims/unix/fs.rs:2331 from_host
port_methods("miri::shims::unix::fs::FileMetadata", () => FileMetadata, {
from_host: function (ecx: MiriInterpCx, metadata_r: Result<fs.Metadata, io_Error>): InterpResult<Result<FileMetadata, IoError>> {
  if (metadata_r.$ === "Err") {
    return interp_ok(Err(IoError_from_io_Error(metadata_r._0)));
  }
  const metadata = metadata_r._0;

  const file_type = metadata.file_type();
  const mode_s = ecx.eval_libc(file_type_to_mode_name(file_type));
  const mode_u = interp_Scalar.to_uint(mode_s, ecx.libc_ty_layout("mode_t").size);
  if (mode_u.$ === "Err") return mode_u;
  let mode = Number(try_from_unwrap(mode_u._0, 0n, U32_MAX));

  const size = metadata.len();

  const created = extract_sec_and_nsec(metadata.created());
  if (created.$ === "Err") return created;
  const accessed = extract_sec_and_nsec(metadata.accessed());
  if (accessed.$ === "Err") return accessed;
  const modified = extract_sec_and_nsec(metadata.modified());
  if (modified.$ === "Err") return modified;

  // FIXME: Provide more fields using platform specific methods.

  if (cfg_unix()) {
    const dev = metadata.dev();
    const ino = metadata.ino();
    const nlink = metadata.nlink();
    const uid = metadata.uid();
    const gid = metadata.gid();
    const blksize = metadata.blksize();
    const blocks = metadata.blocks();

    mode = (mode | metadata.permissions().mode()) >>> 0;

    return interp_ok(Ok(new FileMetadata(mode, size, created._0, accessed._0, modified._0, dev, ino, nlink, uid, gid, blksize, blocks)));
  } else {
    // Emulate "everyone can read" or "everyone can read and write".
    mode = (mode | (metadata.permissions().readonly() ? 0o111 : 0o333)) >>> 0;

    return interp_ok(
      Ok(new FileMetadata(mode, size, created._0, accessed._0, modified._0, undefined, undefined, undefined, undefined, undefined, undefined, undefined)),
    );
  }
}});

// ---- placeholders (src/rust_ts/miri_stub.ts) ----
// Every fn of the file is ported; no placeholders remain.
