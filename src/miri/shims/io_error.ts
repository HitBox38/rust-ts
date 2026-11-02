// Port of src/tools/miri/src/shims/io_error.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
// Its types are generated into io_error.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `pub use self::IoError::*`: the variant constructors are the functions `LibcError`, `WindowsError`, `HostError`, `Raw`
//   below (root: re-export `LibcError` & co. from lib.ts, like upstream's prelude).
// - `err: impl Into<IoError>`: the TS methods take an `IoError`; callers convert with the `From` impls below
//   (`IoError_from_io_Error`, `IoError_from_ErrorKind`, `IoError_from_Scalar`), which is what `.into()` does upstream.
// - `UNIX_ERRNO_TABLE` holds *host* libc constants (`#[cfg(unix)]` on the host Miri was built for). They are the values of
//   the pinned libc crate (libc-0.2.189, the rust workspace's Cargo.lock) for the host: `src/unix/bsd/apple/mod.rs` on
//   macOS, the x86_64/aarch64 glibc values (`linux_l4re_shared.rs` + `gnu/b64/*`) on Linux. Other unix hosts stop
//   `unported`; on Windows hosts the table does not exist (`#[cfg(unix)]`). io_error.test.ts checks both tables against
//   the libc source and the darwin one against the host (`node:os` errno constants).
import { type MPlaceTy, type Scalar } from "../lib.ts";
import { MemoryKind_from_MiriMemoryKind, type MiriInterpCx } from "../machine.ts";
import * as gen from "./io_error.gen.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { spec } from "../../rustc_target/lib.ts";
import { display_IoError, type ErrorKind, ErrorKind_as_str, type IoError as io_Error, IoError_kind, IoError_raw_os_error } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import { Err, type Result } from "../../std/result.ts";
export * from "./io_error.gen.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `IoError::LibcError(name)` (`pub use self::IoError::*`). */
export function LibcError(name: string): IoError {
  return { $: "LibcError", _0: name };
}
/** `IoError::WindowsError(name)` (`pub use self::IoError::*`). */
export function WindowsError(name: string): IoError {
  return { $: "WindowsError", _0: name };
}
/** `IoError::HostError(e)` (`pub use self::IoError::*`). */
export function HostError(e: io_Error): IoError {
  return { $: "HostError", _0: e };
}
/** `IoError::Raw(val)` (`pub use self::IoError::*`). */
export function Raw(val: Scalar): IoError {
  return { $: "Raw", _0: val };
}

/** `IoError` with its companion: the variant constructors and `impl IoError` (shims/io_error.rs:17, PORTING §8). */
export type IoError = gen.IoError;
export const IoError = {
  LibcError,
  WindowsError,
  HostError,
  Raw,
  // rustc: src/tools/miri/src/shims/io_error.rs:18 into_ntstatus
  into_ntstatus(self: IoError): number {
    let raw: number;
    switch (self.$) {
      case "HostError":
        switch (IoError_kind(self._0)) {
          // STATUS_MEDIA_WRITE_PROTECTED
          case "ReadOnlyFilesystem":
            raw = 0xc00000a2;
            break;
          // STATUS_FILE_INVALID
          case "InvalidInput":
            raw = 0xc0000098;
            break;
          // STATUS_DISK_FULL
          case "QuotaExceeded":
            raw = 0xc000007f;
            break;
          // STATUS_ACCESS_DENIED
          case "PermissionDenied":
            raw = 0xc0000022;
            break;
          // For the default error code we arbitrarily pick 0xC0000185, STATUS_IO_DEVICE_ERROR.
          default:
            raw = 0xc0000185;
            break;
        }
        break;
      // For the default error code we arbitrarily pick 0xC0000185, STATUS_IO_DEVICE_ERROR.
      default:
        raw = 0xc0000185;
        break;
    }
    // raw.cast_signed()
    return raw | 0;
  },
};

// rustc: src/tools/miri/src/shims/io_error.rs:41 from
/** `impl From<io::Error> for IoError` */
export function IoError_from_io_Error(value: io_Error): IoError {
  return { $: "HostError", _0: value };
}

// rustc: src/tools/miri/src/shims/io_error.rs:47 from
/** `impl From<io::ErrorKind> for IoError` */
export function IoError_from_ErrorKind(value: ErrorKind): IoError {
  return { $: "HostError", _0: io_Error_from_ErrorKind(value) };
}

// rustc: src/tools/miri/src/shims/io_error.rs:53 from
/** `impl From<Scalar> for IoError` */
export function IoError_from_Scalar(value: Scalar): IoError {
  return { $: "Raw", _0: value };
}

/** `impl From<ErrorKind> for io::Error` (library/core/src/io/error.rs: `ErrorData::Simple(kind)`).
 *  PORT: src/std/io.ts has no `Simple` repr yet (its header: "`ErrorData::Simple` is not produced yet"; src/std is not
 *  this lane's: root). Stand-in: a `SimpleMessage` with `message = kind.as_str()`. `kind()`, `raw_os_error()` (None) and
 *  Display (`Simple` displays `kind.as_str()`) are exact, so the errno mapping (`host_error_to_errnum`) is; only the
 *  io::Error's Debug differs (`Simple` prints `Kind(..)`), which only an `unwrap` panic message would show. */
function io_Error_from_ErrorKind(kind: ErrorKind): io_Error {
  return { $: "SimpleMessage", kind, message: ErrorKind_as_str(kind) };
}

// This mapping should match `decode_error_kind` in
// <https://github.com/rust-lang/rust/blob/HEAD/library/std/src/sys/io/error/unix.rs>.
const UNIX_IO_ERROR_TABLE: readonly (readonly [string, ErrorKind])[] = [
  ["E2BIG", "ArgumentListTooLong"],
  ["EADDRINUSE", "AddrInUse"],
  ["EADDRNOTAVAIL", "AddrNotAvailable"],
  ["EBUSY", "ResourceBusy"],
  ["ECONNABORTED", "ConnectionAborted"],
  ["ECONNREFUSED", "ConnectionRefused"],
  ["ECONNRESET", "ConnectionReset"],
  ["EDEADLK", "Deadlock"],
  ["EDQUOT", "QuotaExceeded"],
  ["EEXIST", "AlreadyExists"],
  ["EFBIG", "FileTooLarge"],
  ["EHOSTUNREACH", "HostUnreachable"],
  ["EINTR", "Interrupted"],
  ["EINVAL", "InvalidInput"],
  ["EISDIR", "IsADirectory"],
  ["ELOOP", "FilesystemLoop"],
  ["ENOENT", "NotFound"],
  ["ENOMEM", "OutOfMemory"],
  ["ENOSPC", "StorageFull"],
  ["EMLINK", "TooManyLinks"],
  ["ENAMETOOLONG", "InvalidFilename"],
  ["ENETDOWN", "NetworkDown"],
  ["ENETUNREACH", "NetworkUnreachable"],
  ["ENOTCONN", "NotConnected"],
  ["ENOTDIR", "NotADirectory"],
  ["ENOTEMPTY", "DirectoryNotEmpty"],
  ["EPIPE", "BrokenPipe"],
  ["EROFS", "ReadOnlyFilesystem"],
  ["ESPIPE", "NotSeekable"],
  ["ESTALE", "StaleNetworkFileHandle"],
  ["ETIMEDOUT", "TimedOut"],
  ["ETXTBSY", "ExecutableFileBusy"],
  ["EXDEV", "CrossesDevices"],
  ["EINPROGRESS", "InProgress"],
  ["EIO", "InputOutputError"],
  // The following have two valid options. We have both for the forwards mapping; only the
  // first one will be used for the backwards mapping.
  ["EPERM", "PermissionDenied"],
  ["EACCES", "PermissionDenied"],
  ["EWOULDBLOCK", "WouldBlock"],
  ["EAGAIN", "WouldBlock"],
  ["ENOSYS", "Unsupported"],
  ["EOPNOTSUPP", "Unsupported"],
  ["ENOTSUP", "Unsupported"],
  ["EMFILE", "TooManyOpenFiles"],
  ["ENFILE", "TooManyOpenFiles"],
];

/** The names of `UNIX_ERRNO_TABLE`, in upstream order. */
export const UNIX_ERRNO_NAMES: readonly string[] = [
  "E2BIG", "EACCES", "EADDRINUSE", "EADDRNOTAVAIL", "EAFNOSUPPORT", "EAGAIN", "EALREADY", "EBADF", "EBADMSG", "EBUSY",
  "ECANCELED", "ECHILD", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EDEADLK", "EDESTADDRREQ", "EDOM", "EDQUOT",
  "EEXIST", "EFAULT", "EFBIG", "EHOSTUNREACH", "EIDRM", "EILSEQ", "EINPROGRESS", "EINTR", "EINVAL", "EIO", "EISCONN",
  "EISDIR", "ELOOP", "EMFILE", "EMLINK", "EMSGSIZE", "EMULTIHOP", "ENAMETOOLONG", "ENETDOWN", "ENETRESET",
  "ENETUNREACH", "ENFILE", "ENOBUFS", "ENODEV", "ENOENT", "ENOEXEC", "ENOLCK", "ENOLINK", "ENOMEM", "ENOMSG",
  "ENOPROTOOPT", "ENOSPC", "ENOSYS", "ENOTCONN", "ENOTDIR", "ENOTEMPTY", "ENOTRECOVERABLE", "ENOTSOCK", "ENOTSUP",
  "ENOTTY", "ENXIO", "EOPNOTSUPP", "EOVERFLOW", "EOWNERDEAD", "EPERM", "EPIPE", "EPROTO", "EPROTONOSUPPORT",
  "EPROTOTYPE", "ERANGE", "EROFS", "ESOCKTNOSUPPORT", "ESPIPE", "ESRCH", "ESTALE", "ETIMEDOUT", "ETXTBSY",
  "EWOULDBLOCK", "EXDEV",
];

/** libc-0.2.189 `src/unix/bsd/apple/mod.rs`: the values of `UNIX_ERRNO_NAMES` on an Apple host. */
export const LIBC_ERRNO_APPLE: readonly number[] = [
  7, 13, 48, 49, 47, 35, 37, 9, 94, 16,
  89, 10, 53, 61, 54, 11, 39, 33, 69,
  17, 14, 27, 65, 90, 92, 36, 4, 22, 5, 56,
  21, 62, 24, 31, 40, 95, 63, 50, 52,
  51, 23, 55, 19, 2, 8, 77, 97, 12, 91,
  42, 28, 78, 57, 20, 66, 104, 38, 45,
  25, 6, 102, 84, 105, 1, 32, 100, 43,
  41, 34, 30, 44, 29, 3, 70, 60, 26,
  35, 18,
];

/** libc-0.2.189 `src/unix/linux_like/linux_l4re_shared.rs` + `linux/gnu/b64/{x86_64,aarch64}`: the values of
 *  `UNIX_ERRNO_NAMES` on a glibc x86_64 / aarch64 Linux host (also the x86_64-unknown-linux-gnu target's). */
export const LIBC_ERRNO_LINUX_GNU: readonly number[] = [
  7, 13, 98, 99, 97, 11, 114, 9, 74, 16,
  125, 10, 103, 111, 104, 35, 89, 33, 122,
  17, 14, 27, 113, 43, 84, 115, 4, 22, 5, 106,
  21, 40, 24, 31, 90, 72, 36, 100, 102,
  101, 23, 105, 19, 2, 8, 37, 67, 12, 42,
  92, 28, 38, 107, 20, 39, 131, 88, 95,
  25, 6, 95, 75, 130, 1, 32, 71, 93,
  91, 34, 30, 94, 29, 3, 116, 110, 26,
  11, 18,
];

// On Unix hosts are can avoid round-tripping via `ErrorKind`, which can preserve more
// details and leads to nicer output in `strerror_r`.
// #[cfg(unix)]
let UNIX_ERRNO_TABLE_: readonly (readonly [string, number])[] | null | undefined;
/** `UNIX_ERRNO_TABLE` (`#[cfg(unix)]`): `undefined` on a non-unix host (the `cfg` is off). */
function UNIX_ERRNO_TABLE(): readonly (readonly [string, number])[] | undefined {
  if (UNIX_ERRNO_TABLE_ === undefined) {
    let values: readonly number[] | undefined;
    switch (process.platform) {
      case "darwin":
        values = LIBC_ERRNO_APPLE;
        break;
      case "linux":
        if (process.arch !== "x64" && process.arch !== "arm64") return unported(`miri::shims::io_error::UNIX_ERRNO_TABLE (libc errno values of a linux-${process.arch} host)`);
        values = LIBC_ERRNO_LINUX_GNU;
        break;
      case "win32":
        values = undefined;
        break;
      default:
        return unported(`miri::shims::io_error::UNIX_ERRNO_TABLE (libc errno values of a ${process.platform} host)`);
    }
    UNIX_ERRNO_TABLE_ = values === undefined ? null : UNIX_ERRNO_NAMES.map((n, i) => [n, values[i]!] as const);
  }
  return UNIX_ERRNO_TABLE_ ?? undefined;
}

// This mapping should match `decode_error_kind` in
// <https://github.com/rust-lang/rust/blob/HEAD/library/std/src/sys/io/error/windows.rs>.
// It's common for multiple error codes to map to the same io::ErrorKind. We have all for the
// forwards mapping; only the first one will be used for the backwards mapping.
// Slightly arbitrarily, we prefer non-WSA and the most generic sounding variant for backwards
// mapping.
const WINDOWS_IO_ERROR_TABLE: readonly (readonly [string, ErrorKind])[] = [
  ["WSAEADDRINUSE", "AddrInUse"],
  ["WSAEADDRNOTAVAIL", "AddrNotAvailable"],
  ["ERROR_FILE_EXISTS", "AlreadyExists"],
  ["ERROR_ALREADY_EXISTS", "AlreadyExists"],
  ["ERROR_NO_DATA", "BrokenPipe"],
  ["WSAECONNABORTED", "ConnectionAborted"],
  ["WSAECONNREFUSED", "ConnectionRefused"],
  ["WSAECONNRESET", "ConnectionReset"],
  ["ERROR_NOT_SAME_DEVICE", "CrossesDevices"],
  ["ERROR_POSSIBLE_DEADLOCK", "Deadlock"],
  ["ERROR_DIR_NOT_EMPTY", "DirectoryNotEmpty"],
  ["ERROR_CANT_RESOLVE_FILENAME", "FilesystemLoop"],
  ["ERROR_DISK_QUOTA_EXCEEDED", "QuotaExceeded"],
  ["WSAEDQUOT", "QuotaExceeded"],
  ["ERROR_FILE_TOO_LARGE", "FileTooLarge"],
  ["ERROR_HOST_UNREACHABLE", "HostUnreachable"],
  ["WSAEHOSTUNREACH", "HostUnreachable"],
  ["ERROR_INVALID_NAME", "InvalidFilename"],
  ["ERROR_BAD_PATHNAME", "InvalidFilename"],
  ["ERROR_FILENAME_EXCED_RANGE", "InvalidFilename"],
  ["ERROR_INVALID_PARAMETER", "InvalidInput"],
  ["WSAEINVAL", "InvalidInput"],
  ["ERROR_DIRECTORY_NOT_SUPPORTED", "IsADirectory"],
  ["WSAENETDOWN", "NetworkDown"],
  ["ERROR_NETWORK_UNREACHABLE", "NetworkUnreachable"],
  ["WSAENETUNREACH", "NetworkUnreachable"],
  ["ERROR_DIRECTORY", "NotADirectory"],
  ["WSAENOTCONN", "NotConnected"],
  ["ERROR_FILE_NOT_FOUND", "NotFound"],
  ["ERROR_PATH_NOT_FOUND", "NotFound"],
  ["ERROR_INVALID_DRIVE", "NotFound"],
  ["ERROR_BAD_NETPATH", "NotFound"],
  ["ERROR_BAD_NET_NAME", "NotFound"],
  ["ERROR_SEEK_ON_DEVICE", "NotSeekable"],
  ["ERROR_NOT_ENOUGH_MEMORY", "OutOfMemory"],
  ["ERROR_OUTOFMEMORY", "OutOfMemory"],
  ["ERROR_ACCESS_DENIED", "PermissionDenied"],
  ["WSAEACCES", "PermissionDenied"],
  ["ERROR_WRITE_PROTECT", "ReadOnlyFilesystem"],
  ["ERROR_BUSY", "ResourceBusy"],
  ["ERROR_DISK_FULL", "StorageFull"],
  ["ERROR_HANDLE_DISK_FULL", "StorageFull"],
  ["WAIT_TIMEOUT", "TimedOut"],
  ["WSAETIMEDOUT", "TimedOut"],
  ["ERROR_DRIVER_CANCEL_TIMEOUT", "TimedOut"],
  ["ERROR_OPERATION_ABORTED", "TimedOut"],
  ["ERROR_SERVICE_REQUEST_TIMEOUT", "TimedOut"],
  ["ERROR_COUNTER_TIMEOUT", "TimedOut"],
  ["ERROR_TIMEOUT", "TimedOut"],
  ["ERROR_RESOURCE_CALL_TIMED_OUT", "TimedOut"],
  ["ERROR_CTX_MODEM_RESPONSE_TIMEOUT", "TimedOut"],
  ["ERROR_CTX_CLIENT_QUERY_TIMEOUT", "TimedOut"],
  ["FRS_ERR_SYSVOL_POPULATE_TIMEOUT", "TimedOut"],
  ["ERROR_DS_TIMELIMIT_EXCEEDED", "TimedOut"],
  ["DNS_ERROR_RECORD_TIMED_OUT", "TimedOut"],
  ["ERROR_IPSEC_IKE_TIMED_OUT", "TimedOut"],
  ["ERROR_RUNLEVEL_SWITCH_TIMEOUT", "TimedOut"],
  ["ERROR_RUNLEVEL_SWITCH_AGENT_TIMEOUT", "TimedOut"],
  ["ERROR_TOO_MANY_LINKS", "TooManyLinks"],
  ["ERROR_CALL_NOT_IMPLEMENTED", "Unsupported"],
  ["WSAEWOULDBLOCK", "WouldBlock"],
  ["ERROR_TOO_MANY_OPEN_FILES", "TooManyOpenFiles"],
  ["ERROR_IO_DEVICE", "InputOutputError"],
];

/** `io::Error::from_raw_os_error(code)` (an `ErrorData::Os`; the Node code name is unknown here). */
function io_Error_from_raw_os_error(errno: number): io_Error {
  return { $: "Os", errno, code: "UNKNOWN" };
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/io_error.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/io_error.rs:273
    last_error_place(this: MiriInterpCx): InterpResult<MPlaceTy>;
    // shims/io_error.rs:287 (`err: impl Into<IoError>`: callers convert with the `IoError_from_*` fns)
    io_error_to_errnum(this: MiriInterpCx, err: IoError): InterpResult<Scalar>;
    // shims/io_error.rs:298
    set_last_error(this: MiriInterpCx, err: IoError): InterpResult;
    // shims/io_error.rs:306
    set_errno_and_return_neg1(this: MiriInterpCx, err: IoError, dest: MPlaceTy): InterpResult;
    // shims/io_error.rs:318
    set_errno_and_return_neg1_i32(this: MiriInterpCx, err: IoError): InterpResult<Scalar>;
    // shims/io_error.rs:328
    set_errno_and_return_neg1_i64(this: MiriInterpCx, err: IoError): InterpResult<Scalar>;
    // shims/io_error.rs:338
    get_last_error(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/io_error.rs:346
    host_error_to_errnum(this: MiriInterpCx, err: io_Error): InterpResult<Scalar>;
    // shims/io_error.rs:387
    try_errnum_to_io_error(this: MiriInterpCx, target_errnum: Scalar): InterpResult<io_Error | undefined>;
    // shims/io_error.rs:433 (`T: From<i32>`: `from_i32` converts `-1`, e.g. `BigInt` for an i64 result)
    try_unwrap_io_result<T>(this: MiriInterpCx, result: Result<T, io_Error>, from_i32: (v: number) => T): InterpResult<T>;
  }
}

/// Get last error variable as a place, lazily allocating thread-local storage for it if
/// necessary.
// rustc: src/tools/miri/src/shims/io_error.rs:273 last_error_place
InterpCx.prototype.last_error_place = function (this: MiriInterpCx): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_mut();
  const errno_place = this_.active_thread_ref().last_error;
  if (errno_place !== undefined) {
    return interp_ok(errno_place);
  } else {
    // Allocate new place, set initial value to 0.
    const errno_layout = this_.machine.layouts.u32;
    const errno_place = this_.allocate(errno_layout, MemoryKind_from_MiriMemoryKind("Machine"));
    if (errno_place.$ === "Err") return errno_place;
    const w = this_.write_scalar(interp_Scalar.from_u32(0), errno_place._0);
    if (w.$ === "Err") return w;
    this_.active_thread_mut().last_error = errno_place._0;
    return interp_ok(errno_place._0);
  }
};

// rustc: src/tools/miri/src/shims/io_error.rs:287 io_error_to_errnum
InterpCx.prototype.io_error_to_errnum = function (this: MiriInterpCx, err: IoError): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  switch (err.$) {
    case "HostError":
      return this_.host_error_to_errnum(err._0);
    case "LibcError":
      return interp_ok(this_.eval_libc(err._0));
    case "WindowsError":
      return interp_ok(this_.eval_windows("c", err._0));
    case "Raw":
      return interp_ok(err._0);
  }
};

/// Sets the last error variable.
// rustc: src/tools/miri/src/shims/io_error.rs:298 set_last_error
InterpCx.prototype.set_last_error = function (this: MiriInterpCx, err: IoError): InterpResult {
  const this_ = this.eval_context_mut();
  const errno = this_.io_error_to_errnum(err);
  if (errno.$ === "Err") return errno;
  const errno_place = this_.last_error_place();
  if (errno_place.$ === "Err") return errno_place;
  return this_.write_scalar(errno._0, errno_place._0);
};

/// Sets the last OS error and writes -1 to dest place.
// rustc: src/tools/miri/src/shims/io_error.rs:306 set_errno_and_return_neg1
InterpCx.prototype.set_errno_and_return_neg1 = function (this: MiriInterpCx, err: IoError, dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const r = this_.set_last_error(err);
  if (r.$ === "Err") return r;
  const w = this_.write_int(-1n, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

/// Sets the last OS error and return `-1` as a `i32`-typed Scalar
// rustc: src/tools/miri/src/shims/io_error.rs:318 set_errno_and_return_neg1_i32
InterpCx.prototype.set_errno_and_return_neg1_i32 = function (this: MiriInterpCx, err: IoError): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const r = this_.set_last_error(err);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i32(-1));
};

/// Sets the last OS error and return `-1` as a `i64`-typed Scalar
// rustc: src/tools/miri/src/shims/io_error.rs:328 set_errno_and_return_neg1_i64
InterpCx.prototype.set_errno_and_return_neg1_i64 = function (this: MiriInterpCx, err: IoError): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const r = this_.set_last_error(err);
  if (r.$ === "Err") return r;
  return interp_ok(interp_Scalar.from_i64(-1n));
};

/// Gets the last error variable.
// rustc: src/tools/miri/src/shims/io_error.rs:338 get_last_error
InterpCx.prototype.get_last_error = function (this: MiriInterpCx): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();
  const errno_place = this_.last_error_place();
  if (errno_place.$ === "Err") return errno_place;
  return this_.read_scalar(errno_place._0);
};

/// This function converts host errors to target errors. It tries to produce the most similar OS
/// error from the `std::io::ErrorKind` as a platform-specific errnum.
// rustc: src/tools/miri/src/shims/io_error.rs:346 host_error_to_errnum
InterpCx.prototype.host_error_to_errnum = function (this: MiriInterpCx, err: io_Error): InterpResult<Scalar> {
  const this_ = this.eval_context_ref();
  const target = this_.tcx.deref().sess.target;

  if (target.families.some((f) => f === "unix")) {
    // If the host is also Unix, we can use the raw OS error and avoid a potentially lossy
    // trip through `ErrorKind`.
    // #[cfg(unix)]
    const table = UNIX_ERRNO_TABLE();
    if (table !== undefined) {
      const host_errno = IoError_raw_os_error(err);
      if (host_errno !== undefined) {
        for (const [name, errno] of table) {
          if (host_errno === errno) {
            return interp_ok(this_.eval_libc(name));
          }
        }
      }
    }
    // For other hosts or other constants, we fall back to translating via `ErrorKind`.
    for (const [name, kind] of UNIX_IO_ERROR_TABLE) {
      if (IoError_kind(err) === kind) {
        return interp_ok(this_.eval_libc(name));
      }
    }
    return throw_unsup_format(`unsupported io error: ${display_IoError(err)}`);
  } else if (target.families.some((f) => f === "windows")) {
    for (const [name, kind] of WINDOWS_IO_ERROR_TABLE) {
      if (IoError_kind(err) === kind) {
        return interp_ok(this_.eval_windows("c", name));
      }
    }
    return throw_unsup_format(`unsupported io error: ${display_IoError(err)}`);
  } else {
    return throw_unsup_format(`converting io::Error into errnum is unsupported for OS ${spec.Os.display(target.os)}`);
  }
};

/// The inverse of `io_error_to_errnum`: it converts target errors to host errors.
/// This is used to render such errors as user-visible strings.
/// This is done in a best-effort way.
// #[expect(clippy::needless_return)]
// rustc: src/tools/miri/src/shims/io_error.rs:387 try_errnum_to_io_error
InterpCx.prototype.try_errnum_to_io_error = function (this: MiriInterpCx, target_errnum: Scalar): InterpResult<io_Error | undefined> {
  const this_ = this.eval_context_ref();
  const target = this_.tcx.deref().sess.target;
  if (target.families.some((f) => f === "unix")) {
    const target_errnum_r = interp_Scalar.to_i32(target_errnum);
    if (target_errnum_r.$ === "Err") return target_errnum_r;
    const target_errnum_ = target_errnum_r._0;
    // If the host is also unix, we try to translate the errno directly.
    // That lets us use `Error::from_raw_os_error`, which has a much better `Display`
    // impl than what we get by going through `ErrorKind`.
    // #[cfg(unix)]
    const table = UNIX_ERRNO_TABLE();
    if (table !== undefined) {
      for (const [name, errno] of table) {
        if (target_errnum_ === this_.eval_libc_i32(name)) {
          return interp_ok(io_Error_from_raw_os_error(errno));
        }
      }
    }
    // For other hosts or other constants, we fall back to translating via `ErrorKind`.
    for (const [name, kind] of UNIX_IO_ERROR_TABLE) {
      if (target_errnum_ === this_.eval_libc_i32(name)) {
        return interp_ok(io_Error_from_ErrorKind(kind));
      }
    }
    return interp_ok(undefined);
  } else if (target.families.some((f) => f === "windows")) {
    const target_errnum_r = interp_Scalar.to_u32(target_errnum);
    if (target_errnum_r.$ === "Err") return target_errnum_r;
    const target_errnum_ = target_errnum_r._0;
    for (const [name, kind] of WINDOWS_IO_ERROR_TABLE) {
      const v = interp_Scalar.to_u32(this_.eval_windows("c", name));
      if (v.$ === "Err") return v;
      if (target_errnum_ === v._0) {
        return interp_ok(io_Error_from_ErrorKind(kind));
      }
    }
    return interp_ok(undefined);
  } else {
    return throw_unsup_format(`converting errnum into io::Error is unsupported for OS ${spec.Os.display(target.os)}`);
  }
};

/// Helper function that consumes an `std::io::Result<T>` and returns an
/// `InterpResult<'tcx,T>::Ok` instead. In case the result is an error, this function returns
/// `Ok(-1)` and sets the last OS error accordingly.
///
/// This function uses `T: From<i32>` instead of `i32` directly because some IO related
/// functions return different integer types (like `read`, that returns an `i64`).
// rustc: src/tools/miri/src/shims/io_error.rs:433 try_unwrap_io_result
InterpCx.prototype.try_unwrap_io_result = function <T>(this: MiriInterpCx, result: Result<T, io_Error>, from_i32: (v: number) => T): InterpResult<T> {
  switch (result.$) {
    case "Ok":
      return interp_ok(result._0);
    case "Err": {
      const r = this.eval_context_mut().set_last_error(IoError_from_io_Error(result._0));
      if (r.$ === "Err") return r;
      return interp_ok(from_i32(-1));
    }
  }
};
