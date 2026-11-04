//! General management of file descriptors, and support for
//! standard file descriptors (stdin/stdout/stderr).
// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/fd.rs (crate `miri`, plan-m6 D2). Its types are generated into fd.gen.ts
// (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` / `EvalContextPrivExt` (impl for `MiriInterpCx`) are `declare module` augmentations of
//   `InterpCx` (decision C2). `trait UnixFileDescription: FileDescription` is the interface below; its provided methods
//   live in `UnixFileDescription_provided` (PORTING §8). The empty impls for `Stdin` / `Stdout` / `Stderr` /
//   `NullOutput` (files.rs's types, lane miri-shims-b) install those provided methods on their prototypes through
//   `port_methods` (C10: another module's classes).
// - `FileDescriptionRef<T>`'s `Deref` (files.rs:52) is `ref.deref()` (`deref` below). The trait methods whose receiver
//   is `self: FileDescriptionRef<Self>` (`FileDescription::read` / `write` / `as_unix`, `UnixFileDescription::as_socket`)
//   take the ref as a leading `self_` argument (files.ts header); the calls go through `fd_read` / `fd_write` /
//   `fd_as_unix` below.
// - A `FileDescriptionRef` from `FdTable::get` / `remove` is a strong `Rc` handle; one Rust drops (not moved on) is
//   released with `.drop()` at the same point (`drop_fd_ref` / `with_drop`; shims-b's refcount protocol).
// - `usize` lengths are numbers: every `count` / `len` here has passed `check_ptr_access` for that many bytes (or is a
//   sum of `iov_len`s that each passed `mem_copy`), so it is an allocation size (< 2^53). `u64` / `i128` values are
//   bigints (C5).
// - `callback!(@capture { .. } |this, result| ..)` is machine.ts's `callback({ name: [value, VisitProvenance impl], .. },
//   (this_, result, { .. }) => ..)` (thread.ts precedent).
// - `{:#x}` of an `i32` prints its two's-complement bits (`fmt::LowerHex` of a signed integer).
// - `trace!(..)` stays a comment (docs/handoff/miri-log.md).
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { callback, type DynMachineCallback, type MiriInterpCx } from "../../machine.ts";
import { VisitProvenance_MPlaceTy, VisitProvenance_no_provenance, VisitProvenance_Pointer, VisitProvenance_tuple2, VisitProvenance_Vec } from "../../provenance_gc.ts";
import { type DynFileDescriptionRef, type FdNum, type FileDescription, type FileDescriptionRef, NullOutput, Stderr, Stdin, Stdout } from "../files.ts";
import { type IoError, IoError_from_ErrorKind } from "../io_error.ts";
import { shim_varargs, type Varargs } from "../sig.ts";
import { type FlockOp } from "./fd.gen.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { Align, Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { MemoryKind } from "../../../rustc_const_eval/interpret/memory.ts";
import { Pointer_Option_from_Pointer } from "../../../rustc_middle/mir/interpret/pointer.ts";
import {
  CheckInAllocMsg,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { PointerArithmetic_provided } from "../../../rustc_middle/mir/interpret/pointer.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../../std/io.ts";
import { assert, panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { StandardUniform_bool } from "../../../vendor/rand/distr/other.ts";
import { RngExt } from "../../../vendor/rand/rng.ts";
export * from "./fd.gen.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `{:#x}` of an `i32`. */
function hex_i32(x: number): string {
  return `0x${(x >>> 0).toString(16)}`;
}

const U64_MAX = (1n << 64n) - 1n;
/** `isize::MAX` of the host (64-bit). */
const HOST_ISIZE_MAX = (1n << 63n) - 1n;

/// Represents unix-specific file descriptions.
export interface UnixFileDescription extends FileDescription {
  /// Reads as much as possible into the given buffer `ptr` from a given offset.
  /// `len` indicates how many bytes we should try to read.
  /// `dest` is where the return value should be stored: number of bytes read, or `-1` in case of error.
  // shims/unix/fd.rs:30 (provided)
  pread(_communicate_allowed: boolean, _offset: bigint, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  /// Writes as much as possible from the given buffer `ptr` starting at a given offset.
  /// `ptr` is the pointer to the user supplied read buffer.
  /// `len` indicates how many bytes we should try to write.
  /// `dest` is where the return value should be stored: number of bytes written, or `-1` in case of error.
  // shims/unix/fd.rs:46 (provided)
  pwrite(_communicate_allowed: boolean, _ptr: Pointer, _len: number, _offset: bigint, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/unix/fd.rs:58 (provided)
  flock(_communicate_allowed: boolean, _op: FlockOp): InterpResult<Result<null, io_Error>>;
  /// Implementation of fcntl(F_GETFL) for this FD.
  // shims/unix/fd.rs:67 (provided)
  get_flags(_ecx: MiriInterpCx): InterpResult<Scalar>;
  /// Implementation of fcntl(F_SETFL) for this FD.
  // shims/unix/fd.rs:72 (provided)
  set_flags(_flag: number, _ecx: MiriInterpCx): InterpResult<Scalar>;
  /// Modifies device parameters.
  /// `op` is the device-dependent operation code. It's either a `c_long` or `c_int`, depending on
  /// the target and whether it uses glibc or musl.
  /// `arg` is the optional third argument which exists depending on the operation code. It's either
  /// an integer or a pointer.
  // shims/unix/fd.rs:85 (provided)
  ioctl(_op: Scalar, _args: Varargs, _ecx: MiriInterpCx): InterpResult<number>;
  /// Returns this file description as a Unix socket, if it represents one.
  // shims/unix/fd.rs:95 (provided) // self: FileDescriptionRef<Self>
  as_socket(self_: FileDescriptionRef<UnixFileDescription>): FileDescriptionRef<Pending<"dyn UnixSocketFileDescription">> | undefined;
}

/** The provided methods of `UnixFileDescription` (PORTING §8); `this` is the description (`&self`). */
export const UnixFileDescription_provided = {
  // rustc: src/tools/miri/src/shims/unix/fd.rs:30 pread
  pread(
    this: FileDescription,
    _communicate_allowed: boolean,
    _offset: bigint,
    _ptr: Pointer,
    _len: number,
    _ecx: MiriInterpCx,
    _finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    return throw_unsup_format(`cannot pread from ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:46 pwrite
  pwrite(
    this: FileDescription,
    _communicate_allowed: boolean,
    _ptr: Pointer,
    _len: number,
    _offset: bigint,
    _ecx: MiriInterpCx,
    _finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    return throw_unsup_format(`cannot pwrite to ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:58 flock
  flock(this: FileDescription, _communicate_allowed: boolean, _op: FlockOp): InterpResult<Result<null, io_Error>> {
    return throw_unsup_format(`cannot flock ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:67 get_flags
  get_flags(this: FileDescription, _ecx: MiriInterpCx): InterpResult<Scalar> {
    return throw_unsup_format(`fcntl: ${this.name()} is not supported for F_GETFL`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:72 set_flags
  set_flags(this: FileDescription, _flag: number, _ecx: MiriInterpCx): InterpResult<Scalar> {
    return throw_unsup_format(`fcntl: ${this.name()} is not supported for F_SETFL`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:85 ioctl
  ioctl(this: FileDescription, _op: Scalar, _args: Varargs, _ecx: MiriInterpCx): InterpResult<number> {
    return throw_unsup_format(`cannot use ioctl on ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/unix/fd.rs:95 as_socket
  as_socket(this: FileDescription, self_: FileDescriptionRef<UnixFileDescription>): FileDescriptionRef<Pending<"dyn UnixSocketFileDescription">> | undefined {
    self_.drop();
    return undefined;
  },
};

// impl UnixFileDescription for shims::files::Stdin {}
port_methods("miri::shims::unix::fd::UnixFileDescription for Stdin", () => Stdin.prototype, UnixFileDescription_provided);
// impl UnixFileDescription for shims::files::Stdout {}
port_methods("miri::shims::unix::fd::UnixFileDescription for Stdout", () => Stdout.prototype, UnixFileDescription_provided);
// impl UnixFileDescription for shims::files::Stderr {}
port_methods("miri::shims::unix::fd::UnixFileDescription for Stderr", () => Stderr.prototype, UnixFileDescription_provided);
// impl UnixFileDescription for shims::files::NullOutput {}
port_methods("miri::shims::unix::fd::UnixFileDescription for NullOutput", () => NullOutput.prototype, UnixFileDescription_provided);

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/fd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fd.rs:109
    close(this: MiriInterpCx, fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:138
    dup(this: MiriInterpCx, old_fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:147
    dup2(this: MiriInterpCx, old_fd_num: FdNum, new_fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:166
    flock(this: MiriInterpCx, fd_num: FdNum, op: number): InterpResult<Scalar>;
    // shims/unix/fd.rs:199
    ioctl(this: MiriInterpCx, fd: OpTy, op: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fd.rs:228
    fcntl(this: MiriInterpCx, fd_num: OpTy, cmd: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fd.rs:346
    read(this: MiriInterpCx, fd_num: number, buf: Pointer, count: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:405
    write(this: MiriInterpCx, fd_num: number, buf: Pointer, count: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:461
    readv(this: MiriInterpCx, fd: OpTy, iov: OpTy, iovcnt: OpTy, offset: OpTy | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:584
    writev(this: MiriInterpCx, fd: OpTy, iov: OpTy, iovcnt: OpTy, offset: OpTy | undefined, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/fd.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fd.rs:699
    read_from_fd(this: MiriInterpCx, fd: DynFileDescriptionRef, ptr: Pointer, len: number, offset: bigint | undefined, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
    // shims/unix/fd.rs:747
    write_to_fd(this: MiriInterpCx, fd: DynFileDescriptionRef, ptr: Pointer, len: number, offset: bigint | undefined, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  }
}

// rustc: src/tools/miri/src/shims/unix/fd.rs:109 close
InterpCx.prototype.close = function (this: MiriInterpCx, fd_num: FdNum): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_ = this_.machine.fds.remove(fd_num);
  if (fd_ === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }
  const fd = fd_as_unix(fd_); // sanity-check
  if (this_.tcx.deref().sess.target.os.$ === "Illumos") {
    // Illumos didn't like the Linux semantics of epoll tracking file *descriptions*
    // rather than file *descriptors*. So on Illumos, when a file description is closed,
    // de-register it from everything watching it.
    // > While a best effort has been made to mimic the Linux semantics, there are
    // > some semantics that are too peculiar or ill-conceived to merit
    // > accommodation. In particular, the Linux epoll facility will -- by design
    // > -- continue to generate events for closed file descriptors where/when the
    // > underlying file description remains open. [...]
    // > This epoll facility refuses to honor these semantics;
    // > closing the EPOLL_CTL_ADD'd file descriptor will always result in no
    // > further events being generated for that event description.
    const watched = deref(fd).readiness_watched();
    if (watched !== undefined) {
      watched.remove_file_num_interests(fd.id(), fd_num);
    }
  }
  drop_fd_ref(fd);
  // Our close is always successful. Close does not reliably return errors anyway so it is
  // not worth the effort to try and return anything here.
  return interp_ok(interp_Scalar.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:138 dup
InterpCx.prototype.dup = function (this: MiriInterpCx, old_fd_num: FdNum): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd = this_.machine.fds.get(old_fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }
  return interp_ok(interp_Scalar.from_i32(this_.machine.fds.insert(fd)));
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:147 dup2
InterpCx.prototype.dup2 = function (this: MiriInterpCx, old_fd_num: FdNum, new_fd_num: FdNum): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd = this_.machine.fds.get(old_fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }
  if (new_fd_num !== old_fd_num) {
    const existing = this_.machine.fds.get(new_fd_num);
    if (existing !== undefined) drop_fd_ref(existing);
    if (existing !== undefined) {
      // Close the FD currently holding this spot.
      const ret = this_.close(new_fd_num);
      if (ret.$ === "Err") return ret;
      const ret_i32 = interp_Scalar.to_i32(ret._0);
      if (ret_i32.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
      assert(ret_i32._0 === 0, "assertion failed: ret.to_i32().unwrap() == 0");
    }
    // Insert new FD in this spot.
    const actual_fd_num = this_.machine.fds.insert_with_min_num(fd, new_fd_num);
    if (actual_fd_num !== new_fd_num) {
      panic(`assertion \`left == right\` failed\n  left: ${actual_fd_num}\n right: ${new_fd_num}`);
    }
  } else {
    drop_fd_ref(fd);
  }
  return interp_ok(interp_Scalar.from_i32(new_fd_num));
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:166 flock
InterpCx.prototype.flock = function (this: MiriInterpCx, fd_num: FdNum, op: number): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }

  // We need to check that there aren't unsupported options in `op`.
  const lock_sh = this_.eval_libc_i32("LOCK_SH");
  const lock_ex = this_.eval_libc_i32("LOCK_EX");
  const lock_nb = this_.eval_libc_i32("LOCK_NB");
  const lock_un = this_.eval_libc_i32("LOCK_UN");

  // use FlockOp::*;
  let parsed_op: FlockOp;
  if (op === lock_sh) {
    parsed_op = { $: "SharedLock", nonblocking: false };
  } else if (op === (lock_sh | lock_nb)) {
    parsed_op = { $: "SharedLock", nonblocking: true };
  } else if (op === lock_ex) {
    parsed_op = { $: "ExclusiveLock", nonblocking: false };
  } else if (op === (lock_ex | lock_nb)) {
    parsed_op = { $: "ExclusiveLock", nonblocking: true };
  } else if (op === lock_un) {
    parsed_op = { $: "Unlock" };
  } else {
    drop_fd_ref(fd);
    return throw_unsup_format(`unsupported flags ${hex_i32(op)}`);
  }

  const unix = fd_as_unix(fd);
  const result_r = deref(unix).flock(this_.machine.communicate(), parsed_op);
  drop_fd_ref(unix);
  if (result_r.$ === "Err") return result_r;
  // return `0` if flock is successful
  const result: Result<number, io_Error> = result_r._0.$ === "Ok" ? Ok(0) : result_r._0;
  const v = this_.try_unwrap_io_result(result, (v: number) => v);
  if (v.$ === "Err") return v;
  return interp_ok(interp_Scalar.from_i32(v._0));
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:199 ioctl
InterpCx.prototype.ioctl = function (this: MiriInterpCx, fd_op: OpTy, op_op: OpTy, varargs: Varargs): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const op_r = this_.read_scalar(op_op as never);
  if (op_r.$ === "Err") return op_r;
  const op = op_r._0 as Scalar;

  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
  }

  // Handle common opcodes.
  const fioclex = this_.eval_libc("FIOCLEX");
  const fionclex = this_.eval_libc("FIONCLEX");
  if (Scalar_eq(op, fioclex) || Scalar_eq(op, fionclex)) {
    // Since we don't support `exec`, those are NOPs.
    drop_fd_ref(fd);
    return interp_ok(interp_Scalar.from_i32(0));
  }

  // Since some ioctl operations use the return value as an output parameter, we cannot strictly use the convention of
  // zero indicating success and -1 indicating an error.
  const unix = fd_as_unix(fd);
  const return_value = deref(unix).ioctl(op, varargs, this_);
  drop_fd_ref(unix);
  if (return_value.$ === "Err") return return_value;
  return interp_ok(interp_Scalar.from_i32(return_value._0));
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:228 fcntl
InterpCx.prototype.fcntl = function (this: MiriInterpCx, fd_num_op: OpTy, cmd_op: OpTy, varargs: Varargs): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const fd_num_r = read_i32(this_, fd_num_op);
  if (fd_num_r.$ === "Err") return fd_num_r;
  const fd_num = fd_num_r._0;
  const cmd_r = read_i32(this_, cmd_op);
  if (cmd_r.$ === "Err") return cmd_r;
  const cmd = cmd_r._0;

  const f_getfd = this_.eval_libc_i32("F_GETFD");
  const f_dupfd = this_.eval_libc_i32("F_DUPFD");
  const f_dupfd_cloexec = this_.eval_libc_i32("F_DUPFD_CLOEXEC");
  const f_getfl = this_.eval_libc_i32("F_GETFL");
  const f_setfl = this_.eval_libc_i32("F_SETFL");

  // We only support getting the flags for a descriptor.
  // PORT: the `match cmd` guard arms, in order.
  if (cmd === f_getfd) {
    // Currently this is the only flag that `F_GETFD` returns. It is OK to just return the
    // `FD_CLOEXEC` value without checking if the flag is set for the file because `std`
    // always sets this flag when opening a file. However we still need to check that the
    // file itself is open.
    if (!this_.machine.fds.is_fd_num(fd_num)) {
      return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
    } else {
      return interp_ok(this_.eval_libc("FD_CLOEXEC"));
    }
  } else if (cmd === f_dupfd || cmd === f_dupfd_cloexec) {
    // Note that we always assume the FD_CLOEXEC flag is set for every open file, in part
    // because exec() isn't supported. The F_DUPFD and F_DUPFD_CLOEXEC commands only
    // differ in whether the FD_CLOEXEC flag is pre-set on the new file descriptor,
    // thus they can share the same implementation here.
    const cmd_name = cmd === f_dupfd ? "fcntl(fd, F_DUPFD, ...)" : "fcntl(fd, F_DUPFD_CLOEXEC, ...)";

    const c = this_.check_varargs(shim_varargs_i32, varargs, cmd_name);
    if (c.$ === "Err") return c;
    const [start_op] = c._0[0] as [OpTy];
    const start = read_i32(this_, start_op);
    if (start.$ === "Err") return start;

    const fd = this_.machine.fds.get(fd_num);
    if (fd !== undefined) {
      return interp_ok(interp_Scalar.from_i32(this_.machine.fds.insert_with_min_num(fd, start._0)));
    } else {
      return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
    }
  } else if (cmd === f_getfl) {
    // Check if this is a valid open file descriptor.
    const fd = this_.machine.fds.get(fd_num);
    if (fd === undefined) {
      return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
    }

    const unix = fd_as_unix(fd);
    return with_drop(unix, deref(unix).get_flags(this_));
  } else if (cmd === f_setfl) {
    // Check if this is a valid open file descriptor.
    const fd = this_.machine.fds.get(fd_num);
    if (fd === undefined) {
      return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EBADF" });
    }

    const c = this_.check_varargs(shim_varargs_i32, varargs, "fcntl(fd, F_SETFL, ...)");
    if (c.$ === "Err") return with_drop(fd, c);
    const [flag_op] = c._0[0] as [OpTy];
    const flag = read_i32(this_, flag_op);
    if (flag.$ === "Err") return with_drop(fd, flag);

    // Ignore flags that never get stored by SETFL.
    // "File access mode (O_RDONLY, O_WRONLY, O_RDWR) and file
    // creation flags (i.e., O_CREAT, O_EXCL, O_NOCTTY, O_TRUNC)
    // in arg are ignored."
    const ignored_flags =
      this_.eval_libc_i32("O_RDONLY") |
      this_.eval_libc_i32("O_WRONLY") |
      this_.eval_libc_i32("O_RDWR") |
      this_.eval_libc_i32("O_CREAT") |
      this_.eval_libc_i32("O_EXCL") |
      this_.eval_libc_i32("O_NOCTTY") |
      this_.eval_libc_i32("O_TRUNC");

    const unix = fd_as_unix(fd);
    return with_drop(unix, deref(unix).set_flags(flag._0 & ~ignored_flags, this_));
  } else if (this_.tcx.deref().sess.target.os.$ === "MacOs" && cmd === this_.eval_libc_i32("F_FULLFSYNC")) {
    // Reject if isolation is enabled.
    const isolated_op = this_.machine.isolated_op;
    if (isolated_op.$ === "Reject") {
      const reject_with = isolated_op._0;
      const r = this_.reject_in_isolation("`fcntl`", reject_with);
      if (r.$ === "Err") return r;
      return this_.set_errno_and_return_neg1_i32(IoError_from_ErrorKind("PermissionDenied"));
    }

    return this_.ffullsync_fd(fd_num);
  } else if (this_.tcx.deref().sess.target.os.$ === "MacOs" && this_.frame_in_std() && cmd === this_.eval_libc_i32("F_GETPATH")) {
    // Std uses this when debug-printing `File`. We stub it out by returning an error.
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EOPNOTSUPP" });
  } else if (this_.tcx.deref().sess.target.os.$ === "FreeBsd" && this_.frame_in_std() && cmd === this_.eval_libc_i32("F_KINFO")) {
    // Std uses this when debug-printing `File`. We stub it out by returning an error.
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EOPNOTSUPP" });
  } else {
    return throw_unsup_format(`fcntl: unsupported command ${hex_i32(cmd)}`);
  }
};

/// Read data from `fd` into buffer specified by `buf` and `count`.
///
/// If `offset` is `None`, reads data from current cursor position associated with `fd`
/// and updates cursor position on completion. Otherwise, reads from the specified offset
/// and keeps the cursor unchanged.
// rustc: src/tools/miri/src/shims/unix/fd.rs:346 read
InterpCx.prototype.read = function (this: MiriInterpCx, fd_num: number, buf: Pointer, count_: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Isolation check is done via `FileDescription` trait.

  // trace!("Reading from FD {}, size {}", fd_num, count);

  // Check that the *entire* buffer is actually valid memory.
  const a = this_.check_ptr_access(buf as never, Size.from_bytes(count_), CheckInAllocMsg.MemoryAccess);
  if (a.$ === "Err") return a;

  // We cap the number of read bytes to the largest value that we are able to fit in both the
  // host's and target's `isize`. This saves us from having to handle overflows later.
  const count = Number(u64_min(u64_min(count_, PointerArithmetic_provided.target_isize_max(this_)), HOST_ISIZE_MAX)); // now it fits in a `usize`

  // Get the FD.
  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    // trace!("read: FD not found");
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }

  // trace!("read: FD mapped to {fd:?}");
  // We want to read at most `count` bytes. We are sure that `count` is not negative
  // because it was a target's `usize`. Also we are sure that it's smaller than
  // `usize::MAX` because it is bounded by the host's `isize`.

  return this_.read_from_fd(
    fd,
    buf,
    count,
    offset,
    callback<{ count: number; dest: MPlaceTy }, Result<number, IoError>>(
      {
        count: [count, VisitProvenance_no_provenance],
        dest: [dest, VisitProvenance_MPlaceTy],
      },
      (this_, result, { count, dest }) => {
        switch (result.$) {
          case "Ok": {
            const read_size = result._0;
            assert(read_size <= count, "assertion failed: read_size <= count");
            // This must fit since `count` fits.
            return this_.write_int(BigInt(read_size), dest);
          }
          case "Err":
            return this_.set_errno_and_return_neg1(result._0, dest);
        }
      },
    ),
  );
};

// rustc: src/tools/miri/src/shims/unix/fd.rs:405 write
InterpCx.prototype.write = function (this: MiriInterpCx, fd_num: number, buf: Pointer, count_: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  // Isolation check is done via `FileDescription` trait.

  // Check that the *entire* buffer is actually valid memory.
  const a = this_.check_ptr_access(buf as never, Size.from_bytes(count_), CheckInAllocMsg.MemoryAccess);
  if (a.$ === "Err") return a;

  // We cap the number of written bytes to the largest value that we are able to fit in both the
  // host's and target's `isize`. This saves us from having to handle overflows later.
  const count = Number(u64_min(u64_min(count_, PointerArithmetic_provided.target_isize_max(this_)), HOST_ISIZE_MAX)); // now it fits in a `usize`

  // We temporarily dup the FD to be able to retain mutable access to `this`.
  const fd = this_.machine.fds.get(fd_num);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }

  return this_.write_to_fd(
    fd,
    buf,
    count,
    offset,
    callback<{ count: number; dest: MPlaceTy }, Result<number, IoError>>(
      {
        count: [count, VisitProvenance_no_provenance],
        dest: [dest, VisitProvenance_MPlaceTy],
      },
      (this_, result, { count, dest }) => {
        switch (result.$) {
          case "Ok": {
            const write_size = result._0;
            assert(write_size <= count, "assertion failed: write_size <= count");
            // This must fit since `count` fits.
            return this_.write_int(BigInt(write_size), dest);
          }
          case "Err":
            return this_.set_errno_and_return_neg1(result._0, dest);
        }
      },
    ),
  );
};

/// Vectored reads are implemented by first reading bytes from `fd`
/// into a temporary buffer which has the combined size of all buffers in
/// `iov`. After that we split the bytes of the combined buffer into the
/// buffers of `iov`. This ensures that the vectored read occurs atomically.
// rustc: src/tools/miri/src/shims/unix/fd.rs:461 readv
InterpCx.prototype.readv = function (this: MiriInterpCx, fd_op: OpTy, iov: OpTy, iovcnt_op: OpTy, offset_op: OpTy | undefined, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const iov_ptr_r = this_.read_pointer(iov as never);
  if (iov_ptr_r.$ === "Err") return iov_ptr_r;
  const iov_ptr = iov_ptr_r._0 as Pointer;
  const iovcnt = read_iovcnt(this_, iovcnt_op);
  if (iovcnt.$ === "Err") return iovcnt;
  // `readv` is the same as `preadv` without an offset.
  let offset: bigint | undefined;
  if (offset_op !== undefined) {
    if (this_.tcx.deref().sess.target.os.$ === "Solaris") {
      return throw_unsup_format("preadv: vectored reads with offsets aren't supported on Solaris");
    }
    const o = read_int(this_, offset_op);
    if (o.$ === "Err") return o;
    offset = o._0;
  } else {
    offset = undefined;
  }

  // Check that the FD exists.
  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }

  const buffers_r = read_iovecs(this_, iov_ptr, iovcnt._0);
  if (buffers_r.$ === "Err") return with_drop(fd, buffers_r);
  // Read list of buffers from `iov`.
  const buffers = buffers_r._0;

  const total_bytes = u64_sum(buffers.map(([, len]) => len));

  // Allocate a temporary buffer which has the combined size of all buffers provided in `iov`.
  const tmp_r = this_.allocate_ptr(Size.from_bytes(total_bytes), Align.ONE, MemoryKind.Stack, "Uninit");
  if (tmp_r.$ === "Err") return with_drop(fd, tmp_r);
  const tmp_ptr: Pointer = Pointer_Option_from_Pointer(tmp_r._0) as Pointer;

  return this_.read_from_fd(
    fd,
    tmp_ptr,
    usize_from_u64(total_bytes),
    offset,
    callback<{ tmp_ptr: Pointer; buffers: [Pointer, bigint][]; dest: MPlaceTy }, Result<number, IoError>>(
      {
        tmp_ptr: [tmp_ptr, VisitProvenance_Pointer],
        buffers: [buffers, VisitProvenance_buffers],
        dest: [dest, VisitProvenance_MPlaceTy],
      },
      (this_, result, { tmp_ptr, buffers, dest }) => {
        let bytes_read: bigint;
        switch (result.$) {
          case "Ok": {
            const size = result._0;
            const w = this_.write_scalar(interp_Scalar.from_target_isize(BigInt(size), this_) as never, dest as never);
            if (w.$ === "Err") return w;
            bytes_read = BigInt(size);
            break;
          }
          case "Err": {
            const e = result._0;
            const d = this_.deallocate_ptr(tmp_ptr as never, undefined, MemoryKind.Stack);
            if (d.$ === "Err") return d;
            return this_.set_errno_and_return_neg1(e, dest);
          }
        }
        let remaining_bytes = bytes_read;

        // Split the bytes from the temporary buffer into the buffers provided in `iov`.
        // We start at the first buffer and fill them in order, until we reach the end of the
        // initialized bytes in the temporary buffer.
        for (const [buffer_ptr, buffer_len] of buffers) {
          // Offset temporary buffer by the amount of bytes we already copied into previous buffers.
          const tmp_ptr_with_offset = this_.ptr_offset_inbounds(tmp_ptr as never, i64_from_u64(u64_strict_sub(bytes_read, remaining_bytes)));
          if (tmp_ptr_with_offset.$ === "Err") return tmp_ptr_with_offset;

          // Copy at most as many bytes as the buffer fits but without reading
          // any uninitialized bytes from the temporary buffer.
          const copy_amount = u64_min(buffer_len, remaining_bytes);
          const c = this_.mem_copy(
            tmp_ptr_with_offset._0,
            buffer_ptr as never,
            Size.from_bytes(copy_amount),
            // The buffers are guaranteed to not overlap because we just newly allocated
            // the `tmp_ptr`, and `tmp_ptr_with_offset` is guaranteed to be
            // within those boundaries.
            true,
          );
          if (c.$ === "Err") return c;

          remaining_bytes = u64_strict_sub(remaining_bytes, copy_amount);
          if (remaining_bytes === 0n) {
            // We don't have anything left to copy; exit the loop.
            break;
          }
        }

        return this_.deallocate_ptr(tmp_ptr as never, undefined, MemoryKind.Stack);
      },
    ),
  );
};

/// Vectored writes are implemented by first writing the bytes from all
/// buffers of `iov` into a combined temporary buffer and then writing this
/// combined buffer into `fd`. This ensures that the vectored write occurs atomically.
// rustc: src/tools/miri/src/shims/unix/fd.rs:584 writev
InterpCx.prototype.writev = function (this: MiriInterpCx, fd_op: OpTy, iov: OpTy, iovcnt_op: OpTy, offset_op: OpTy | undefined, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();

  const fd_num = read_i32(this_, fd_op);
  if (fd_num.$ === "Err") return fd_num;
  const iov_ptr_r = this_.read_pointer(iov as never);
  if (iov_ptr_r.$ === "Err") return iov_ptr_r;
  const iov_ptr = iov_ptr_r._0 as Pointer;
  const iovcnt = read_iovcnt(this_, iovcnt_op);
  if (iovcnt.$ === "Err") return iovcnt;
  // `writev` is the same as `pwritev` without an offset.
  let offset: bigint | undefined;
  if (offset_op !== undefined) {
    if (this_.tcx.deref().sess.target.os.$ === "Solaris") {
      return throw_unsup_format("pwritev: vectored writes with offsets aren't supported on Solaris");
    }
    const o = read_int(this_, offset_op);
    if (o.$ === "Err") return o;
    offset = o._0;
  } else {
    offset = undefined;
  }

  // Check that the FD exists.
  const fd = this_.machine.fds.get(fd_num._0);
  if (fd === undefined) {
    return this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EBADF" }, dest);
  }

  const buffers_r = read_iovecs(this_, iov_ptr, iovcnt._0);
  if (buffers_r.$ === "Err") return with_drop(fd, buffers_r);
  // Read list of buffers from `iov`.
  const buffers = buffers_r._0;

  const total_bytes = u64_sum(buffers.map(([, len]) => len));

  // Allocate a temporary buffer which has the combined size of all buffers provided in `iov`.
  const tmp_r = this_.allocate_ptr(Size.from_bytes(total_bytes), Align.ONE, MemoryKind.Stack, "Uninit");
  if (tmp_r.$ === "Err") return with_drop(fd, tmp_r);
  const tmp_ptr: Pointer = Pointer_Option_from_Pointer(tmp_r._0) as Pointer;

  // Copy the bytes from all buffers provided in `iov` into the temporary buffer.
  // We start at the first buffer and then continue buffer by buffer.
  let bytes_copied = 0n;
  for (const [buffer_ptr, buffer_len] of buffers) {
    // Offset temporary buffer by the amount of bytes we already copied from previous buffers.
    const tmp_ptr_with_offset = this_.ptr_offset_inbounds(tmp_ptr as never, i64_from_u64(bytes_copied));
    if (tmp_ptr_with_offset.$ === "Err") return with_drop(fd, tmp_ptr_with_offset);

    const c = this_.mem_copy(
      buffer_ptr as never,
      tmp_ptr_with_offset._0,
      Size.from_bytes(buffer_len),
      // The buffers are guaranteed to not overlap because we just newly allocated
      // the `tmp_ptr`, and `tmp_ptr_with_offset` is guaranteed to be
      // within those boundaries.
      true,
    );
    if (c.$ === "Err") return with_drop(fd, c);

    bytes_copied = u64_strict_add(bytes_copied, buffer_len);
  }

  // Write bytes from the temporary buffer. This ensures the write is atomic.
  return this_.write_to_fd(
    fd,
    tmp_ptr,
    usize_from_u64(total_bytes),
    offset,
    callback<{ tmp_ptr: Pointer; dest: MPlaceTy }, Result<number, IoError>>(
      {
        tmp_ptr: [tmp_ptr, VisitProvenance_Pointer],
        dest: [dest, VisitProvenance_MPlaceTy],
      },
      (this_, result, { tmp_ptr, dest }) => {
        const d = this_.deallocate_ptr(tmp_ptr as never, undefined, MemoryKind.Stack);
        if (d.$ === "Err") return d;
        switch (result.$) {
          case "Ok":
            return this_.write_scalar(interp_Scalar.from_target_isize(BigInt(result._0), this_) as never, dest as never);
          case "Err":
            return this_.set_errno_and_return_neg1(result._0, dest);
        }
      },
    ),
  );
};

/// Read `len` bytes from the `fd` file description at `offset` into the buffer
/// pointed to by `ptr`.
/// If `offset` is [`Some`], the read occurs at the given absolute position rather
/// than the current file position (`read_at` semantics rather than `read`).
/// `finish` will be invoked when the read is done (which might be way after
/// this function returns as the read may block).
// rustc: src/tools/miri/src/shims/unix/fd.rs:699 read_from_fd
InterpCx.prototype.read_from_fd = function (
  this: MiriInterpCx,
  fd: DynFileDescriptionRef,
  ptr: Pointer,
  len_: number,
  offset: bigint | undefined,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Handle the zero-sized case. The man page says:
  // > If count is zero, read() may detect the errors described below.  In the absence of any
  // > errors, or if read() does not check for errors, a read() with a count of 0 returns zero
  // > and has no other effects.
  if (len_ === 0) {
    return with_drop(fd, finish.call(this_, Ok(0)));
  }

  // Non-deterministically decide to further reduce the length, simulating a partial read (but
  // never to 0, that would indicate EOF).
  const len =
    this_.machine.short_fd_operations && deref(fd).short_fd_operations() && len_ >= 2 && RngExt.random(this_.machine.rng, StandardUniform_bool)
      ? Math.floor(len_ / 2) // since `len` is at least 2, the result is still at least 1
      : len_;

  if (offset === undefined) {
    const r = fd_read(fd, this_.machine.communicate(), ptr, len, this_, finish);
    if (r.$ === "Err") return r;
  } else {
    if (offset < 0n || offset > U64_MAX) {
      return with_drop(fd, finish.call(this_, Err({ $: "LibcError", _0: "EINVAL" })));
    }
    const unix = fd_as_unix(fd);
    const r = with_drop(unix, deref(unix).pread(this_.machine.communicate(), offset, ptr, len, this_, finish));
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// Write `len` bytes at `offset` from the buffer pointed to by `ptr` into the `fd`
/// file description.
/// If `offset` is [`Some`], the write occurs at the given absolute position rather
/// than the current file position (`write_at` semantics rather than `write`).
/// `finish` will be invoked when the write is done (which might be way after
/// this function returns as the write may block).
// rustc: src/tools/miri/src/shims/unix/fd.rs:747 write_to_fd
InterpCx.prototype.write_to_fd = function (
  this: MiriInterpCx,
  fd: DynFileDescriptionRef,
  ptr: Pointer,
  len_: number,
  offset: bigint | undefined,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Handle the zero-sized case. The man page says:
  // > If count is zero and fd refers to a regular file, then write() may return a failure
  // > status if one of the errors below is detected.  If no errors are detected, or error
  // > detection is not performed, 0 is returned without causing any other effect.   If  count
  // > is  zero  and  fd refers to a file other than a regular file, the results are not
  // > specified.
  if (len_ === 0) {
    // For now let's not open the can of worms of what exactly "not specified" could mean...
    return with_drop(fd, finish.call(this_, Ok(0)));
  }

  // Non-deterministically decide to further reduce the length, simulating a partial write.
  // We avoid reducing the write size to 0: the docs seem to be entirely fine with that,
  // but the standard library is not (https://github.com/rust-lang/rust/issues/145959).
  const len =
    this_.machine.short_fd_operations && deref(fd).short_fd_operations() && len_ >= 2 && RngExt.random(this_.machine.rng, StandardUniform_bool)
      ? Math.floor(len_ / 2)
      : len_;

  if (offset === undefined) {
    const r = fd_write(fd, this_.machine.communicate(), ptr, len, this_, finish);
    if (r.$ === "Err") return r;
  } else {
    if (offset < 0n || offset > U64_MAX) {
      return with_drop(fd, finish.call(this_, Err({ $: "LibcError", _0: "EINVAL" })));
    }
    const unix = fd_as_unix(fd);
    const r = with_drop(unix, deref(unix).pwrite(this_.machine.communicate(), ptr, len, offset, this_, finish));
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

// ---------------------------------------------------------------- private glue of this module ----

// The `self: FileDescriptionRef<Self>` methods take the ref as a leading `self_` argument (shims-b's files.ts); a
// `FileDescriptionRef` from `FdTable::get` / `remove` is a strong handle: one that is not moved on (`insert`, `read`,
// `write`, `as_unix`) is released with `drop()` where Rust drops it.

/** `fd.as_unix()` (`FileDescription::as_unix(self: FileDescriptionRef<Self>)`, files.rs:200; moves `fd`). */
function fd_as_unix(fd: DynFileDescriptionRef): FileDescriptionRef<UnixFileDescription> {
  return fd.deref().as_unix(fd) as FileDescriptionRef<UnixFileDescription>;
}
/** `fd.read(..)` (`FileDescription::read(self: FileDescriptionRef<Self>, ..)`, files.rs:140; moves `fd`). */
function fd_read(fd: DynFileDescriptionRef, communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  return fd.deref().read(fd, communicate_allowed, ptr, len, ecx, finish);
}
/** `fd.write(..)` (`FileDescription::write(self: FileDescriptionRef<Self>, ..)`, files.rs:157; moves `fd`). */
function fd_write(fd: DynFileDescriptionRef, communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  return fd.deref().write(fd, communicate_allowed, ptr, len, ecx, finish);
}
/** `*fd` (`impl Deref for FileDescriptionRef<T>`, files.rs:52). */
function deref<T>(fd: FileDescriptionRef<T>): T {
  return fd.deref();
}
/** `drop(fd)`: releases a strong `FileDescriptionRef` handle (the last ref closes the description). */
function drop_fd_ref(fd: FileDescriptionRef<unknown>): void {
  fd.drop();
}
/** Drops `fd` after the value of the expression it was used in has been computed (Rust drops temporaries / locals there). */
function with_drop<T>(fd: FileDescriptionRef<unknown>, value: T): T {
  drop_fd_ref(fd);
  return value;
}

/** `Scalar`'s derived `PartialEq` (`op == fioclex`). The right side is always an integer from `eval_libc`, so a pointer
 *  `op` (`Ptr` vs `Int`, different variants) is unequal, as derived `PartialEq` says. */
function Scalar_eq(a: Scalar, b: Scalar): boolean {
  if (a.$ === "Int" && b.$ === "Int") return a._0.size().bytes_u64() === b._0.size().bytes_u64() && a._0.to_bits_unchecked() === b._0.to_bits_unchecked();
  if (a.$ === "Ptr" && b.$ === "Ptr") {
    // PORT: unreachable here (`b` comes from `eval_libc`); `Pointer<Provenance>`'s derived `PartialEq` is not needed.
    return unported("miri::shims::unix::fd::ioctl: `Scalar == Scalar` with two pointer operands");
  }
  return false;
}

/** `shim_varargs![i32]` (shims/sig.rs:46). */
const shim_varargs_i32 = shim_varargs("i32");

/** `this.read_scalar(op)?.to_i32()?`. */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0 as Scalar);
}

/** `this.read_scalar(op)?.to_int(op.layout.size)?`. */
function read_int(this_: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_int(s._0 as Scalar, op.layout.size);
}

/** `let iovcnt: u64 = this.read_scalar(iovcnt)?.to_i32()?.try_into().unwrap();` */
function read_iovcnt(this_: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  const i = read_i32(this_, op);
  if (i.$ === "Err") return i;
  if (i._0 < 0) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return interp_ok(BigInt(i._0));
}

/** The `iov` loop of `readv` / `writev` (fd.rs:491-510 / :614-633, identical): the `(iov_base, iov_len)` list. */
function read_iovecs(this_: MiriInterpCx, iov_ptr: Pointer, iovcnt: bigint): InterpResult<[Pointer, bigint][]> {
  const iovec_layout = this_.libc_array_ty_layout("iovec", iovcnt);
  const iov_ptr_mplace = this_.ptr_to_mplace(iov_ptr as never, iovec_layout);

  // Read list of buffers from `iov`.
  const buffers: [Pointer, bigint][] = [];

  const array_r = this_.project_array_fields(iov_ptr_mplace);
  if (array_r.$ === "Err") return array_r;
  const array = array_r._0;
  for (;;) {
    const n = array.next(this_ as never);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) break;
    const [_idx, iovec] = n._0;
    const iov_len_field = this_.project_field_named(iovec as never, "iov_len");
    if (iov_len_field.$ === "Err") return iov_len_field;
    const iov_len_r = read_int(this_, iov_len_field._0 as unknown as OpTy);
    if (iov_len_r.$ === "Err") return iov_len_r;
    const iov_len = iov_len_r._0;
    if (iov_len < 0n || iov_len > U64_MAX) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");

    const iov_base_field = this_.project_field_named(iovec as never, "iov_base");
    if (iov_base_field.$ === "Err") return iov_base_field;
    const iov_base_ptr = this_.read_pointer(iov_base_field._0 as never);
    if (iov_base_ptr.$ === "Err") return iov_base_ptr;

    buffers.push([iov_base_ptr._0 as Pointer, iov_len]);
  }
  return interp_ok(buffers);
}

/** `VisitProvenance for Vec<(Pointer, u64)>`. */
const VisitProvenance_buffers = {
  visit_provenance(self: [Pointer, bigint][], visit: Parameters<typeof VisitProvenance_Pointer.visit_provenance>[1]): void {
    VisitProvenance_Vec.visit_provenance(self, visit, {
      visit_provenance: (el: [Pointer, bigint], v) => VisitProvenance_tuple2.visit_provenance(el, v, VisitProvenance_Pointer, VisitProvenance_no_provenance),
    });
  },
};

/** `u64::min`. */
function u64_min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
/** `Iterator::sum::<u64>()` (release build: wrapping `+`). */
function u64_sum(xs: readonly bigint[]): bigint {
  let s = 0n;
  for (const x of xs) s = BigInt.asUintN(64, s + x);
  return s;
}
/** `u64::strict_sub`. */
function u64_strict_sub(a: bigint, b: bigint): bigint {
  if (b > a) panic("attempt to subtract with overflow");
  return a - b;
}
/** `u64::strict_add`. */
function u64_strict_add(a: bigint, b: bigint): bigint {
  const s = a + b;
  if (s > U64_MAX) panic("attempt to add with overflow");
  return s;
}
/** `i64::try_from(u64).unwrap()`. */
function i64_from_u64(x: bigint): bigint {
  if (x > (1n << 63n) - 1n) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return x;
}
/** `usize::try_from(u64).unwrap()` (an allocation size here; module header). */
function usize_from_u64(x: bigint): number {
  return Number(x);
}
