// `std::io::Error` (library/core/src/io/error.rs at the pin) as far as rust-ts needs it.
//
// PORT: the repr is a tagged union of the `ErrorData` variants rust-ts produces. OS errors carry the
// raw OS error code (`errno`) plus Node's error-code name (`code`, e.g. "ENOENT", used by callers that
// test for one errno). `decode_error_kind` and `format_os_error` are the unix ones from
// library/std/src/sys/io/error/unix.rs; on Windows (raw codes are `GetLastError` values, which Node
// does not expose) they call `unported`. `ErrorData::Simple` is not produced yet.
import { writeSync } from "node:fs";
import { constants } from "node:os";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { debug_str, debug_struct, type Debug } from "./fmt.ts";
import { panic, unported } from "./panic.ts";
import { Err, Ok, type Result } from "./result.ts";

/** `std::io::ErrorKind` (library/core/src/io/error.rs:769), in declaration order. */
export type ErrorKind =
  | "NotFound"
  | "PermissionDenied"
  | "ConnectionRefused"
  | "ConnectionReset"
  | "HostUnreachable"
  | "NetworkUnreachable"
  | "ConnectionAborted"
  | "NotConnected"
  | "AddrInUse"
  | "AddrNotAvailable"
  | "NetworkDown"
  | "BrokenPipe"
  | "AlreadyExists"
  | "WouldBlock"
  | "NotADirectory"
  | "IsADirectory"
  | "DirectoryNotEmpty"
  | "ReadOnlyFilesystem"
  | "FilesystemLoop"
  | "StaleNetworkFileHandle"
  | "InvalidInput"
  | "InvalidData"
  | "TimedOut"
  | "WriteZero"
  | "StorageFull"
  | "NotSeekable"
  | "QuotaExceeded"
  | "FileTooLarge"
  | "ResourceBusy"
  | "ExecutableFileBusy"
  | "Deadlock"
  | "CrossesDevices"
  | "TooManyLinks"
  | "InvalidFilename"
  | "ArgumentListTooLong"
  | "Interrupted"
  | "Unsupported"
  | "UnexpectedEof"
  | "OutOfMemory"
  | "InProgress"
  | "TooManyOpenFiles"
  | "InputOutputError"
  | "Other"
  | "Uncategorized";

/** `ErrorKind::as_str` (library/core/src/io/error.rs:1008), the `Display` of an `ErrorKind`. */
export function ErrorKind_as_str(k: ErrorKind): string {
  switch (k) {
    case "AddrInUse": return "address in use";
    case "AddrNotAvailable": return "address not available";
    case "AlreadyExists": return "entity already exists";
    case "ArgumentListTooLong": return "argument list too long";
    case "BrokenPipe": return "broken pipe";
    case "ConnectionAborted": return "connection aborted";
    case "ConnectionRefused": return "connection refused";
    case "ConnectionReset": return "connection reset";
    case "CrossesDevices": return "cross-device link or rename";
    case "Deadlock": return "deadlock";
    case "DirectoryNotEmpty": return "directory not empty";
    case "ExecutableFileBusy": return "executable file busy";
    case "FileTooLarge": return "file too large";
    case "FilesystemLoop": return "filesystem loop or indirection limit (e.g. symlink loop)";
    case "HostUnreachable": return "host unreachable";
    case "InProgress": return "in progress";
    case "InputOutputError": return "input/output error";
    case "Interrupted": return "operation interrupted";
    case "InvalidData": return "invalid data";
    case "InvalidFilename": return "invalid filename";
    case "InvalidInput": return "invalid input parameter";
    case "IsADirectory": return "is a directory";
    case "NetworkDown": return "network down";
    case "NetworkUnreachable": return "network unreachable";
    case "NotADirectory": return "not a directory";
    case "NotConnected": return "not connected";
    case "NotFound": return "entity not found";
    case "NotSeekable": return "seek on unseekable file";
    case "Other": return "other error";
    case "OutOfMemory": return "out of memory";
    case "PermissionDenied": return "permission denied";
    case "QuotaExceeded": return "quota exceeded";
    case "ReadOnlyFilesystem": return "read-only filesystem or storage medium";
    case "ResourceBusy": return "resource busy";
    case "StaleNetworkFileHandle": return "stale network file handle";
    case "StorageFull": return "no storage space";
    case "TimedOut": return "timed out";
    case "TooManyLinks": return "too many links";
    case "TooManyOpenFiles": return "too many open files";
    case "Uncategorized": return "uncategorized error";
    case "UnexpectedEof": return "unexpected end of file";
    case "Unsupported": return "unsupported";
    case "WouldBlock": return "operation would block";
    case "WriteZero": return "write zero";
  }
}

/** `std::io::Error` */
export type IoError =
  /** `ErrorData::Os(errno)`. `code` is Node's error-code name for the same error (e.g. "ENOENT"). */
  | { readonly $: "Os"; readonly errno: number | undefined; readonly code: string }
  /** `io::Error::new(kind, String)` / `io::Error::other(String)`: a boxed `StringError`. */
  | { readonly $: "Custom"; readonly kind: ErrorKind; readonly error: string }
  /** `const_error!(kind, "message")` (e.g. `io::Error::INVALID_UTF8`). */
  | { readonly $: "SimpleMessage"; readonly kind: ErrorKind; readonly message: string };

/** `std::io::Result<T>` */
export type IoResult<T> = Result<T, IoError>;

/** `io::Error::other(error)` */
export function io_error_other(error: string): IoError {
  return { $: "Custom", kind: "Other", error };
}

/** `io::Error::INVALID_UTF8` (core/src/io/error.rs:103) */
export const INVALID_UTF8: IoError = { $: "SimpleMessage", kind: "InvalidData", message: "stream did not contain valid UTF-8" };

/** An OS error from a failed Node fs call (`io::Error::from_raw_os_error(errno)`).
 *  PORT: on unix libuv reports `-errno`; on Windows its codes are not `GetLastError` values, so
 *  `errno` is left `undefined` there (using it calls `unported`). */
export function io_error_from_node(e: unknown): IoError {
  const err = e as { code?: string; errno?: number };
  const errno = process.platform !== "win32" && typeof err.errno === "number" ? -err.errno : undefined;
  return { $: "Os", errno, code: err.code ?? "UNKNOWN" };
}

function os_errno(e: { readonly errno: number | undefined; readonly code: string }): number {
  if (e.errno === undefined) return unported(`std::io::Error raw OS error (${process.platform}, ${e.code})`);
  return e.errno;
}

/** `io::Error::kind` (library/core/src/io/error.rs:470) */
export function IoError_kind(e: IoError): ErrorKind {
  switch (e.$) {
    case "Os":
      return decode_error_kind(os_errno(e));
    case "Custom":
      return e.kind;
    case "SimpleMessage":
      return e.kind;
  }
}

/** `io::Error::raw_os_error` (library/core/src/io/error.rs:317) */
export function IoError_raw_os_error(e: IoError): number | undefined {
  return e.$ === "Os" ? os_errno(e) : undefined;
}

const E = constants.errno as Record<string, number | undefined>;

/** `std::sys::io::error::unix::decode_error_kind` (library/std/src/sys/io/error/unix.rs:138).
 *  PORT: the `libc::E*` constants are the host's, from `node:os` `constants.errno`. */
export function decode_error_kind(errno: number): ErrorKind {
  if (process.platform === "win32") return unported("std::sys::io::error::windows::decode_error_kind");
  const x = errno;
  if (x === E.E2BIG) return "ArgumentListTooLong";
  if (x === E.EADDRINUSE) return "AddrInUse";
  if (x === E.EADDRNOTAVAIL) return "AddrNotAvailable";
  if (x === E.EBUSY) return "ResourceBusy";
  if (x === E.ECONNABORTED) return "ConnectionAborted";
  if (x === E.ECONNREFUSED) return "ConnectionRefused";
  if (x === E.ECONNRESET) return "ConnectionReset";
  if (x === E.EDEADLK) return "Deadlock";
  if (x === E.EDQUOT) return "QuotaExceeded";
  if (x === E.EEXIST) return "AlreadyExists";
  if (x === E.EFBIG) return "FileTooLarge";
  if (x === E.EHOSTUNREACH) return "HostUnreachable";
  if (x === E.EINTR) return "Interrupted";
  if (x === E.EINVAL) return "InvalidInput";
  if (x === E.EISDIR) return "IsADirectory";
  if (x === E.ELOOP) return "FilesystemLoop";
  if (x === E.ENOENT) return "NotFound";
  if (x === E.ENOMEM) return "OutOfMemory";
  if (x === E.ENOSPC) return "StorageFull";
  if (x === E.EMLINK) return "TooManyLinks";
  if (x === E.ENAMETOOLONG) return "InvalidFilename";
  if (x === E.ENETDOWN) return "NetworkDown";
  if (x === E.ENETUNREACH) return "NetworkUnreachable";
  if (x === E.ENOTCONN) return "NotConnected";
  if (x === E.ENOTDIR) return "NotADirectory";
  // #[cfg(not(target_os = "aix"))]
  if (x === E.ENOTEMPTY) return "DirectoryNotEmpty";
  if (x === E.EPIPE) return "BrokenPipe";
  if (x === E.EROFS) return "ReadOnlyFilesystem";
  if (x === E.ESPIPE) return "NotSeekable";
  if (x === E.ESTALE) return "StaleNetworkFileHandle";
  if (x === E.ETIMEDOUT) return "TimedOut";
  if (x === E.ETXTBSY) return "ExecutableFileBusy";
  if (x === E.EXDEV) return "CrossesDevices";
  if (x === E.EINPROGRESS) return "InProgress";
  if (x === E.EMFILE || x === E.ENFILE) return "TooManyOpenFiles";
  if (x === E.EIO) return "InputOutputError";

  if (x === E.EACCES || x === E.EPERM) return "PermissionDenied";

  if (x === E.ENOSYS) return "Unsupported";
  // EOPNOTSUPP and ENOTSUP can have the same value on some systems,
  // but different values on others (e.g. Apple), so we can't use a
  // match clause
  if (x === E.EOPNOTSUPP || x === E.ENOTSUP) return "Unsupported";

  // These two constants can have the same value on some systems,
  // but different values on others, so we can't use a match
  // clause
  if (x === E.EAGAIN || x === E.EWOULDBLOCK) return "WouldBlock";

  return "Uncategorized";
}

let STRERROR_R: ((errnum: number, buf: Uint8Array, buflen: number) => number) | undefined;

/** Gets a detailed string description for the given error number.
 *  `std::sys::io::error::unix::format_error` (library/std/src/sys/io/error/unix.rs:197).
 *  PORT: calls the host libc's `strerror_r` (`__xpg_strerror_r` on Linux) through `bun:ffi`, like
 *  upstream; `CStr::display()` is a lossy UTF-8 decode. */
export function format_os_error(errno: number): string {
  if (process.platform === "win32") return unported("std::sys::io::error::windows::format_error");
  if (STRERROR_R === undefined) {
    const linux = process.platform === "linux";
    const name = linux ? "__xpg_strerror_r" : "strerror_r";
    const lib = dlopen(linux ? "libc.so.6" : "libSystem.B.dylib", {
      [name]: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    });
    const f = lib.symbols[name]!;
    STRERROR_R = (errnum, buf, buflen) => f(errnum, ptr(buf), buflen) as number;
  }
  const TMPBUF_SZ = 128;
  const buf = new Uint8Array(TMPBUF_SZ);
  if (STRERROR_R(errno, buf, buf.length) < 0) {
    panic("strerror_r failure");
  }
  const n = buf.indexOf(0);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf.subarray(0, n < 0 ? buf.length : n));
}

/** `impl fmt::Display for io::Error` (core/src/io/error.rs:520) */
export function display_IoError(e: IoError): string {
  switch (e.$) {
    case "Os": {
      const code = os_errno(e);
      const detail = format_os_error(code);
      return `${detail} (os error ${code})`;
    }
    case "Custom":
      return e.error;
    case "SimpleMessage":
      return e.message;
  }
}

/** `impl fmt::Debug for Repr` (core/src/io/error.rs:494); `Custom` is `#[derive(Debug)]` with a
 *  `StringError` whose Debug is the string's. */
export const debug_IoError: Debug<IoError> = (e, f) => {
  switch (e.$) {
    case "Os": {
      const code = os_errno(e);
      return debug_struct(f, "Os", [
        ["code", String(code)],
        ["kind", decode_error_kind(code)],
        ["message", `"${format_os_error(code)}"`],
      ]);
    }
    case "Custom":
      return debug_struct(f, "Custom", [
        ["kind", e.kind],
        ["error", debug_str(e.error)],
      ]);
    case "SimpleMessage":
      return debug_struct(f, "Error", [
        ["kind", e.kind],
        ["message", debug_str(e.message)],
      ]);
  }
};

// ---- stdout (library/std/src/io/stdio.rs) ----

/** `io::Error::WRITE_ALL_EOF` (library/core/src/io/error.rs:125), the error of `Write::write_all` (core/src/io/write.rs:214) on a zero-length write. */
const WRITE_ALL_EOF: IoError = { $: "SimpleMessage", kind: "WriteZero", message: "failed to write whole buffer" };

/** `std::sys::stdio::unix::is_ebadf` (library/std/src/sys/stdio/unix.rs:92).
 *  PORT: the unix one (`EBADF` is the host's, from `node:os`); on Windows `raw_os_error` is unported. */
export function is_ebadf(err: IoError): boolean {
  return IoError_raw_os_error(err) === E.EBADF;
}

/** `std::io::stdio::handle_ebadf` (library/std/src/io/stdio.rs:224) */
export function handle_ebadf<T>(r: IoResult<T>, default_: () => IoResult<T>): IoResult<T> {
  if (r.$ === "Err" && is_ebadf(r._0)) return default_();
  return r;
}

/** `<StdoutRaw as Write>::write_all` (library/std/src/io/stdio.rs:179): `handle_ebadf(self.0.write_all(buf), || Ok(()))`,
 *  so a closed or unwritable fd 1 swallows the output, as rustc's `io::stdout()` does.
 *  The inner `write_all` is `Write::write_all` (library/std/src/io/mod.rs) over `write(2)` on fd 1.
 *  PORT: `Stdout` is line-buffered (`LineWriter<StdoutRaw>`); every byte goes through `StdoutRaw` either way, so the
 *  bytes written and the errors swallowed are the same. `EAGAIN` is retried: Bun may leave a pipe on fd 1
 *  non-blocking, which rustc's stdout never is. */
export function stdout_write_all(buf: Uint8Array): IoResult<null> {
  const inner = (): IoResult<null> => {
    let off = 0;
    while (off < buf.length) {
      let n: number;
      try {
        n = writeSync(1, buf, off, buf.length - off);
      } catch (e) {
        const code = (e as { code?: string }).code;
        // Err(ref e) if e.is_interrupted() => {}
        if (code === "EINTR" || code === "EAGAIN") continue;
        return Err(io_error_from_node(e));
      }
      if (n === 0) return Err(WRITE_ALL_EOF);
      off += n;
    }
    return Ok(null);
  };
  return handle_ebadf(inner(), () => Ok(null));
}
