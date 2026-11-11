// `std::fs` stand-ins (plan-m6 D14: host-dependent Miri code goes through src/std stand-ins), created by lane miri-fs for
// Miri's shims/unix/fs.rs (record: docs/handoff/miri-fs.md), with the host implementation of lane miri-host-fs
// (docs/handoff/miri-host-fs.md).
// Port of the subset of library/std/src/fs.rs (+ the unix extension traits of library/std/src/os/unix/fs.rs) that
// Miri's file-system shims call, over the unix `sys::fs` (library/std/src/sys/fs/unix.rs, sys/fs/unix/dir.rs,
// sys/fs/mod.rs) that `std` uses on the host.
//
// PORT:
// - The pure builders are ported with their data: `OpenOptions` (the unix `sys::fs::OpenOptions` fields), `FileTimes`,
//   `Permissions`, `DirBuilder`. Their std newtypes over the `sys` value are collapsed into one class (no name of the two
//   layers collides). Miri's `open` and `mkstemp` build an `OpenOptions` *before* the isolation check, so these run with
//   isolation on.
// - Host operations (Miri reaches them only with isolation off, `-Zmiri-disable-isolation`) call the host libc through
//   `bun:ffi`, as `std` does: the same functions with the same arguments (`open` with `O_CLOEXEC`, `fstat`, `lseek`,
//   `flock`, `opendir`/`readdir`, `setattrlist`, ...), `errno` read right after the call (`io::Error::last_os_error`).
//   That gives the host's own results: error numbers, permissions, timestamps, inode numbers and the `readdir` order.
//   Struct layouts (`struct stat`, `struct dirent`, `struct attrlist`) and `libc::` constants are those of
//   `aarch64-apple-darwin` (the root host, AGENTS.md §5); on any other host every host operation stops `unported`.
// - Variadic C functions (`open`, `openat`, `fcntl` with an argument): Apple's arm64 ABI passes variadic arguments on
//   the stack, and `bun:ffi` cannot declare a variadic call. The declaration fills the eight argument registers with
//   zero padding so that the variadic argument is the first stack slot, where the callee's `va_arg` reads it (the
//   9-argument form of `open_libc`; checked by the unit tests: a created file gets the requested mode).
// - Ownership: an `OwnedFd` closes its fd on drop, a `DirStream` its `DIR*`. JS has no destructors, so the owners call
//   `drop()` where Rust drops the value (Miri's `FileHandle` / `DirHandle` drop glue, `closedir`); a dropped or moved
//   value panics if used again.
// - `Path`/`PathBuf` are strings (src/std/path.ts): a path goes to libc as its UTF-8 bytes, and the paths and names
//   libc returns are decoded lossily (`OsString` names are strings); APFS keeps names UTF-8.
import { dlopen, FFIType, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";
import { read_cstr, to_string_lossy } from "./env.ts";
import { PLAIN } from "./fmt.ts";
import { debug_IoError, type ErrorKind, type IoError, type IoResult, IoError_kind, io_error_from_raw_os_error, type SeekFrom } from "./io.ts";
import { panic, unported } from "./panic.ts";
import { host_canonicalize } from "./path.ts";
import { Err, Ok, type Result } from "./result.ts";
import { SystemTime } from "./time.ts";

/** A host file-system operation on a host whose libc this file does not describe. */
function host(what: string): never {
  return unported(`${what} (host file system access, isolation off; plan-m6 D14: src/std/fs.ts ports the aarch64-apple-darwin libc only, host ${process.platform}-${process.arch})`);
}

// ---- the host libc (aarch64-apple-darwin) ---------------------------------------------------------------------------

/** The host whose libc this file describes. */
const HOST_LIBC = process.platform === "darwin" && process.arch === "arm64";

// `libc::` constants of the libc crate for aarch64-apple-darwin.
const O_RDONLY = 0x0000;
const O_WRONLY = 0x0001;
const O_RDWR = 0x0002;
const O_ACCMODE = 0x0003;
const O_APPEND = 0x0008;
const O_CREAT = 0x0200;
const O_TRUNC = 0x0400;
const O_EXCL = 0x0800;
const O_DIRECTORY = 0x100000;
const O_CLOEXEC = 0x1000000;
const F_FULLFSYNC = 51;
const F_DUPFD_CLOEXEC = 67;
const LOCK_SH = 1;
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;
const AT_FDCWD = -2;
const AT_SYMLINK_NOFOLLOW = 0x0020;
const S_IFMT = 0o170000;
const S_IFIFO = 0o010000;
const S_IFCHR = 0o020000;
const S_IFDIR = 0o040000;
const S_IFBLK = 0o060000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;
const DT_FIFO = 1;
const DT_CHR = 2;
const DT_DIR = 4;
const DT_BLK = 6;
const DT_REG = 8;
const DT_LNK = 10;
const DT_SOCK = 12;
const EINTR = 4;
const UTIME_OMIT = -2;
const ATTR_BIT_MAP_COUNT = 5;
const ATTR_CMN_CRTIME = 0x00000200;
const ATTR_CMN_MODTIME = 0x00000400;
const ATTR_CMN_ACCTIME = 0x00001000;
const FSOPT_NOFOLLOW = 0x00000001;
/** `size_of::<libc::stat>()` */
const STAT_SIZE = 144;
/** `size_of::<libc::timespec>()` */
const TIMESPEC_SIZE = 16;
/** `size_of::<libc::attrlist>()` */
const ATTRLIST_SIZE = 24;
/** `offset_of!(libc::dirent, d_name)` */
const DIRENT_D_NAME = 21;

/** Zero padding for the argument registers x2..x7 (or x3..x7) before a variadic argument (header). */
const PAD = FFIType.i64;
const pad = (n: number): FFIType[] => Array<FFIType>(n).fill(PAD);
const I32 = FFIType.i32;
const PTR = FFIType.ptr;

const open_libc = () =>
  dlopen("libSystem.B.dylib", {
    // int open(const char *path, int oflag, ...)
    open: { args: [PTR, I32, ...pad(6), FFIType.i64], returns: I32 },
    // int openat(int fd, const char *path, int oflag, ...)
    openat: { args: [I32, PTR, I32, ...pad(5), FFIType.i64], returns: I32 },
    // int fcntl(int fd, int cmd, ...)
    fcntl: { args: [I32, I32, ...pad(6), FFIType.i64], returns: I32 },
    close: { args: [I32], returns: I32 },
    read: { args: [I32, PTR, FFIType.u64], returns: FFIType.i64_fast },
    write: { args: [I32, PTR, FFIType.u64], returns: FFIType.i64_fast },
    lseek: { args: [I32, FFIType.i64, I32], returns: FFIType.i64 },
    fstat: { args: [I32, PTR], returns: I32 },
    stat: { args: [PTR, PTR], returns: I32 },
    lstat: { args: [PTR, PTR], returns: I32 },
    fstatat: { args: [I32, PTR, PTR, I32], returns: I32 },
    flock: { args: [I32, I32], returns: I32 },
    ftruncate: { args: [I32, FFIType.i64], returns: I32 },
    fchmod: { args: [I32, FFIType.u16], returns: I32 },
    chmod: { args: [PTR, FFIType.u16], returns: I32 },
    mkdir: { args: [PTR, FFIType.u16], returns: I32 },
    unlink: { args: [PTR], returns: I32 },
    rmdir: { args: [PTR], returns: I32 },
    rename: { args: [PTR, PTR], returns: I32 },
    symlink: { args: [PTR, PTR], returns: I32 },
    linkat: { args: [I32, PTR, I32, PTR, I32], returns: I32 },
    readlink: { args: [PTR, PTR, FFIType.u64], returns: FFIType.i64_fast },
    opendir: { args: [PTR], returns: PTR },
    readdir: { args: [PTR], returns: PTR },
    closedir: { args: [PTR], returns: I32 },
    dirfd: { args: [PTR], returns: I32 },
    isatty: { args: [I32], returns: I32 },
    setattrlist: { args: [PTR, PTR, PTR, FFIType.u64, FFIType.u32], returns: I32 },
    fsetattrlist: { args: [I32, PTR, PTR, FFIType.u64, FFIType.u32], returns: I32 },
    __error: { args: [], returns: PTR },
  });
let LIBC: ReturnType<typeof open_libc>["symbols"] | undefined;
/** The host libc's symbols; `undefined` on a host this file does not describe. */
// PORT: exported for src/std/fs.test.ts only, which calls the variadic declarations directly (docs/reviews/miri-host-fs.md
// N3: `fcntl`'s variadic minimum); upstream has no such item.
export function libc(what: string): ReturnType<typeof open_libc>["symbols"] {
  if (!HOST_LIBC) return host(what);
  return (LIBC ??= open_libc().symbols);
}
let ERRNO_PTR: Pointer | undefined;
/** `errno()` (library/std/src/sys/io/error/unix.rs): this thread's `errno` (`__error()` is per thread and fixed). */
function errno(): number {
  return read.i32((ERRNO_PTR ??= libc("errno").__error() as Pointer), 0);
}
/** `set_errno(e)` */
function set_errno(e: number): void {
  new Int32Array(toArrayBuffer((ERRNO_PTR ??= libc("errno").__error() as Pointer), 0, 4))[0] = e;
}
/** `io::Error::last_os_error()` */
function last_os_error(): IoError {
  return io_error_from_raw_os_error(errno());
}
/** `io::Error::is_interrupted` */
function is_interrupted(e: IoError): boolean {
  return e.$ === "Os" && e.errno === EINTR;
}
/** `ptr.is_null()` (bun:ffi gives `null` for a NULL pointer). */
const is_null = (p: Pointer | null): p is null => p === null || (p as unknown as number) === 0;

/// Converts native return values to Result using the *-1 means error is in `errno`*  convention.
/// Non-error values are `Ok`-wrapped.
// std: library/std/src/sys/pal/unix/mod.rs:239 cvt
function cvt<T extends number | bigint>(t: T): IoResult<T> {
  // PORT: `errno` is read before anything else runs (no FFI call in between).
  if (t === -1 || t === -1n) return Err(last_os_error());
  return Ok(t);
}

/// `-1` → look at `errno` → retry on `EINTR`. Otherwise `Ok()`-wrap the closure return value.
// std: library/std/src/sys/pal/unix/mod.rs:244 cvt_r
function cvt_r<T extends number | bigint>(f: () => T): IoResult<T> {
  for (;;) {
    const r = cvt(f());
    if (r.$ === "Err" && is_interrupted(r._0)) continue;
    return r;
  }
}

const NUL_ERR: IoError = { $: "SimpleMessage", kind: "InvalidInput", message: "file name contained an unexpected NUL byte" };
const utf8_encoder = new TextEncoder();

// std: library/std/src/sys/helpers/small_c_string.rs:17 run_path_with_cstr
function run_path_with_cstr<T>(path: string, f: (p: Uint8Array) => IoResult<T>): IoResult<T> {
  // PORT: `path.as_os_str().as_encoded_bytes()`: the path string's UTF-8 bytes (header).
  return run_with_cstr(utf8_encoder.encode(path), f);
}

// std: library/std/src/sys/helpers/small_c_string.rs:22 run_with_cstr
function run_with_cstr<T>(bytes: Uint8Array, f: (p: Uint8Array) => IoResult<T>): IoResult<T> {
  // PORT: the stack and the heap copy (`run_with_cstr_stack` / `run_with_cstr_allocating`) differ only in where the
  // NUL-terminated copy lives; both fail with `NUL_ERR` on an interior NUL.
  if (bytes.includes(0)) return Err(NUL_ERR);
  const c = new Uint8Array(bytes.length + 1);
  c.set(bytes);
  return f(c);
}

/** `CStr::to_bytes` of a NUL-terminated buffer (the bytes before the NUL). */
const cstr_bytes = (c: Uint8Array): Uint8Array => c.subarray(0, c.length - 1);
const lossy = (b: Uint8Array): string => to_string_lossy(b);

// ---- sys::fs (library/std/src/sys/fs/unix.rs) -----------------------------------------------------------------------

/** `struct stat` (aarch64-apple-darwin, 64-bit inodes): the fields `std` reads. */
interface stat64 {
  st_dev: number;
  st_mode: number;
  st_nlink: number;
  st_ino: bigint;
  st_uid: number;
  st_gid: number;
  st_rdev: number;
  st_atime: bigint;
  st_atime_nsec: bigint;
  st_mtime: bigint;
  st_mtime_nsec: bigint;
  st_ctime: bigint;
  st_ctime_nsec: bigint;
  st_birthtime: bigint;
  st_birthtime_nsec: bigint;
  st_size: bigint;
  st_blocks: bigint;
  st_blksize: number;
  st_flags: number;
  st_gen: number;
}

/** Reads a `struct stat` the host libc filled. */
function read_stat(buf: Uint8Array): stat64 {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    st_dev: v.getInt32(0, true),
    st_mode: v.getUint16(4, true),
    st_nlink: v.getUint16(6, true),
    st_ino: v.getBigUint64(8, true),
    st_uid: v.getUint32(16, true),
    st_gid: v.getUint32(20, true),
    st_rdev: v.getInt32(24, true),
    st_atime: v.getBigInt64(32, true),
    st_atime_nsec: v.getBigInt64(40, true),
    st_mtime: v.getBigInt64(48, true),
    st_mtime_nsec: v.getBigInt64(56, true),
    st_ctime: v.getBigInt64(64, true),
    st_ctime_nsec: v.getBigInt64(72, true),
    st_birthtime: v.getBigInt64(80, true),
    st_birthtime_nsec: v.getBigInt64(88, true),
    st_size: v.getBigInt64(96, true),
    st_blocks: v.getBigInt64(104, true),
    st_blksize: v.getInt32(112, true),
    st_flags: v.getUint32(116, true),
    st_gen: v.getUint32(120, true),
  };
}

/** `sys::fs::FileAttr` (no `statx` on Apple): `struct FileAttr { stat: stat64 }`. */
class FileAttr {
  constructor(public stat: stat64) {}

  // std: library/std/src/sys/fs/unix.rs:520 from_stat64
  static from_stat64(stat: stat64): FileAttr {
    return new FileAttr(stat);
  }

  // std: library/std/src/sys/fs/unix.rs:527 size
  size(): bigint {
    return BigInt.asUintN(64, this.stat.st_size);
  }
  // std: library/std/src/sys/fs/unix.rs:530 perm
  perm(): Permissions {
    return new Permissions(this.stat.st_mode);
  }

  // std: library/std/src/sys/fs/unix.rs:534 file_type
  file_type(): fs_imp_FileType {
    return new fs_imp_FileType(this.stat.st_mode);
  }

  // std: library/std/src/sys/fs/unix.rs:587 modified
  modified(): IoResult<SystemTime> {
    return SystemTime.new(this.stat.st_mtime, this.stat.st_mtime_nsec);
  }

  // std: library/std/src/sys/fs/unix.rs:627 accessed
  accessed(): IoResult<SystemTime> {
    return SystemTime.new(this.stat.st_atime, this.stat.st_atime_nsec);
  }

  // std: library/std/src/sys/fs/unix.rs:664 created
  created(): IoResult<SystemTime> {
    return SystemTime.new(this.stat.st_birthtime, this.stat.st_birthtime_nsec);
  }
}

/** `sys::fs::FileType { mode: mode_t }` */
class fs_imp_FileType {
  constructor(public mode: number) {}

  // std: library/std/src/sys/fs/unix.rs:760 is_dir
  is_dir(): boolean {
    return this.is(S_IFDIR);
  }
  // std: library/std/src/sys/fs/unix.rs:763 is_file
  is_file(): boolean {
    return this.is(S_IFREG);
  }
  // std: library/std/src/sys/fs/unix.rs:766 is_symlink
  is_symlink(): boolean {
    return this.is(S_IFLNK);
  }

  // std: library/std/src/sys/fs/unix.rs:770 is
  is(mode: number): boolean {
    return this.masked() === mode;
  }

  // std: library/std/src/sys/fs/unix.rs:774 masked
  masked(): number {
    return this.mode & S_IFMT;
  }
}

/** `OwnedFd` (library/std/src/os/fd/owned.rs): the fd, or `-1` once dropped or moved out. */
class OwnedFd {
  constructor(public fd: number) {}

  /** `as_raw_fd()`; panics on a dropped / moved value (header). */
  as_raw_fd(): number {
    if (this.fd < 0) panic("rust-ts: use of a dropped or moved OwnedFd");
    return this.fd;
  }

  /** Moves the fd out (`into_raw_fd` / `From<..> for OwnedFd`): this value no longer owns it. */
  take(): OwnedFd {
    const fd = this.as_raw_fd();
    this.fd = -1;
    return new OwnedFd(fd);
  }

  // std: library/std/src/os/fd/owned.rs:203 drop
  drop(): void {
    // Note that errors are ignored when closing a file descriptor. According to POSIX 2024,
    // we can and indeed should retry `close` on `EINTR`
    // (https://pubs.opengroup.org/onlinepubs/9799919799/functions/close.html),
    // but it is not clear yet how well widely-used implementations are conforming with this
    // mandate since older versions of POSIX left the state of the FD after an `EINTR`
    // unspecified. Ignoring errors is "fine" because some of the major Unices (in
    // particular, Linux) do make sure to always close the FD, even when `close()` is
    // interrupted, and the scenario is rare to begin with. If we retried on a
    // not-POSIX-compliant implementation, the consequences could be really bad since we may
    // close the wrong FD. Helpful link to an epic discussion by POSIX workgroup that led to
    // the latest POSIX wording: http://austingroupbugs.net/view.php?id=529
    // crate::sys::fs::debug_assert_fd_is_open(self.fd.as_inner());  (no-op: std ships without UB checks)
    const fd = this.as_raw_fd();
    this.fd = -1;
    libc("std::os::fd::OwnedFd::drop").close(fd);
  }

  // std: library/std/src/os/fd/owned.rs:99 try_clone
  try_clone(): IoResult<OwnedFd> {
    return this.try_clone_to_owned();
  }

  /// Creates a new `OwnedFd` instance that shares the same underlying file
  /// description as the existing `BorrowedFd` instance.
  // std: library/std/src/os/fd/owned.rs:114 try_clone_to_owned
  try_clone_to_owned(): IoResult<OwnedFd> {
    // We want to atomically duplicate this file descriptor and set the
    // CLOEXEC flag, and currently that's done via F_DUPFD_CLOEXEC. This
    // is a POSIX flag that was added to Linux in 2.6.24.
    const cmd = F_DUPFD_CLOEXEC;

    // Avoid using file descriptors below 3 as they are used for stdio
    const c = libc("std::os::fd::BorrowedFd::try_clone_to_owned");
    const fd = cvt(c.fcntl(this.as_raw_fd(), cmd, 0, 0, 0, 0, 0, 0, 3));
    if (fd.$ === "Err") return fd;
    return Ok(new OwnedFd(fd._0));
  }
}

/** `sys::fs::File(FileDesc)`; PORT: `FileDesc(OwnedFd)` is the `OwnedFd` itself. */
class fs_imp_File {
  constructor(public _0: OwnedFd) {}

  as_raw_fd(): number {
    return this._0.as_raw_fd();
  }

  // std: library/std/src/sys/fs/unix.rs:1207 open
  static open(path: string, opts: OpenOptions): IoResult<fs_imp_File> {
    return run_path_with_cstr(path, (path) => fs_imp_File.open_c(path, opts));
  }

  // std: library/std/src/sys/fs/unix.rs:1211 open_c
  static open_c(path: Uint8Array, opts: OpenOptions): IoResult<fs_imp_File> {
    const access = opts.get_access_mode();
    if (access.$ === "Err") return access;
    const creation = opts.get_creation_mode();
    if (creation.$ === "Err") return creation;
    const flags = O_CLOEXEC | access._0 | creation._0 | (opts.custom_flags_ & ~O_ACCMODE);
    // The third argument of `open64` is documented to have type `mode_t`. On
    // some platforms (like macOS, where `open64` is actually `open`), `mode_t` is `u16`.
    // However, since this is a variadic function, C integer promotion rules mean that on
    // the ABI level, this still gets passed as `c_int` (aka `u32` on Unix platforms).
    const c = libc("std::sys::fs::File::open_c");
    const fd = cvt_r(() => c.open(ptr(path), flags, 0, 0, 0, 0, 0, 0, opts.mode_ | 0));
    if (fd.$ === "Err") return fd;
    return Ok(new fs_imp_File(new OwnedFd(fd._0)));
  }

  // std: library/std/src/sys/fs/unix.rs:1224 file_attr
  file_attr(): IoResult<FileAttr> {
    const fd = this.as_raw_fd();

    const stat = new Uint8Array(STAT_SIZE);
    const r = cvt(libc("std::sys::fs::File::file_attr").fstat(fd, ptr(stat)));
    if (r.$ === "Err") return r;
    return Ok(FileAttr.from_stat64(read_stat(stat)));
  }

  // std: library/std/src/sys/fs/unix.rs:1243 fsync
  fsync(): IoResult<null> {
    const r = cvt_r(() => os_fsync(this.as_raw_fd()));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1257 datasync
  datasync(): IoResult<null> {
    const r = cvt_r(() => os_datasync(this.as_raw_fd()));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1300 lock
  lock(): IoResult<null> {
    const r = cvt(libc("std::sys::fs::File::lock").flock(this.as_raw_fd(), LOCK_EX));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1323 lock_shared
  lock_shared(): IoResult<null> {
    const r = cvt(libc("std::sys::fs::File::lock_shared").flock(this.as_raw_fd(), LOCK_SH));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1346 try_lock
  try_lock(): Result<null, TryLockError> {
    const result = cvt(libc("std::sys::fs::File::try_lock").flock(this.as_raw_fd(), LOCK_EX | LOCK_NB));
    if (result.$ === "Err") {
      const err = result._0;
      if (IoError_kind(err) === "WouldBlock") {
        return Err({ $: "WouldBlock" });
      } else {
        return Err({ $: "Error", _0: err });
      }
    } else {
      return Ok(null);
    }
  }

  // std: library/std/src/sys/fs/unix.rs:1381 try_lock_shared
  try_lock_shared(): Result<null, TryLockError> {
    const result = cvt(libc("std::sys::fs::File::try_lock_shared").flock(this.as_raw_fd(), LOCK_SH | LOCK_NB));
    if (result.$ === "Err") {
      const err = result._0;
      if (IoError_kind(err) === "WouldBlock") {
        return Err({ $: "WouldBlock" });
      } else {
        return Err({ $: "Error", _0: err });
      }
    } else {
      return Ok(null);
    }
  }

  // std: library/std/src/sys/fs/unix.rs:1416 unlock
  unlock(): IoResult<null> {
    const r = cvt(libc("std::sys::fs::File::unlock").flock(this.as_raw_fd(), LOCK_UN));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1439 truncate
  truncate(size: bigint): IoResult<null> {
    // let size: off64_t = size.try_into().map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    if (size > (1n << 63n) - 1n) {
      // `TryFromIntError`'s Display.
      return Err({ $: "Custom", kind: "InvalidInput", error: "out of range integral type conversion attempted" });
    }
    const c = libc("std::sys::fs::File::truncate");
    const r = cvt_r(() => c.ftruncate(this.as_raw_fd(), size));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1445 read
  read(buf: Uint8Array): IoResult<number> {
    return FileDesc_read(this._0, buf);
  }

  // std: library/std/src/sys/fs/unix.rs:1474 write
  write(buf: Uint8Array): IoResult<number> {
    return FileDesc_write(this._0, buf);
  }

  // std: library/std/src/sys/fs/unix.rs:1500 seek
  seek(pos: SeekFrom): IoResult<bigint> {
    let whence: number, off: bigint;
    switch (pos.$) {
      // Casting to `i64` is fine, too large values will end up as
      // negative which will cause an error in `lseek64`.
      case "Start":
        [whence, off] = [SEEK_SET, BigInt.asIntN(64, pos._0)];
        break;
      case "End":
        [whence, off] = [SEEK_END, pos._0];
        break;
      case "Current":
        [whence, off] = [SEEK_CUR, pos._0];
        break;
    }
    const n = cvt(BigInt(libc("std::sys::fs::File::seek").lseek(this.as_raw_fd(), off, whence)));
    if (n.$ === "Err") return n;
    return Ok(BigInt.asUintN(64, n._0));
  }

  // std: library/std/src/sys/fs/unix.rs:1521 tell
  tell(): IoResult<bigint> {
    return this.seek({ $: "Current", _0: 0n });
  }

  // std: library/std/src/sys/fs/unix.rs:1525 duplicate
  duplicate(): IoResult<fs_imp_File> {
    // `self.0.duplicate().map(File)`: `FileDesc::duplicate` (library/std/src/sys/fd/unix.rs:653) is
    // `Ok(Self(self.0.try_clone()?))`.
    const fd = this._0.try_clone();
    if (fd.$ === "Err") return fd;
    return Ok(new fs_imp_File(fd._0));
  }

  // std: library/std/src/sys/fs/unix.rs:1529 set_permissions
  set_permissions(perm: Permissions): IoResult<null> {
    const c = libc("std::sys::fs::File::set_permissions");
    const r = cvt_r(() => c.fchmod(this.as_raw_fd(), perm.mode_));
    if (r.$ === "Err") return r;
    return Ok(null);
  }

  // std: library/std/src/sys/fs/unix.rs:1534 set_times
  set_times(times: FileTimes): IoResult<null> {
    // target_vendor = "apple"
    const ta = TimesAttrlist.from_times(times);
    if (ta.$ === "Err") return ta;
    const r = cvt(libc("std::sys::fs::File::set_times").fsetattrlist(this.as_raw_fd(), ptr(ta._0.attrlist()), ptr(ta._0.times_buf()), ta._0.times_buf_size(), 0));
    if (r.$ === "Err") return r;
    return Ok(null);
  }
}

// std: library/std/src/sys/fs/unix.rs:1248 os_fsync
function os_fsync(fd: number): number {
  return libc("std::sys::fs::File::fsync").fcntl(fd, F_FULLFSYNC, 0, 0, 0, 0, 0, 0, 0);
}

// std: library/std/src/sys/fs/unix.rs:1262 os_datasync
function os_datasync(fd: number): number {
  return libc("std::sys::fs::File::datasync").fcntl(fd, F_FULLFSYNC, 0, 0, 0, 0, 0, 0, 0);
}

/** `READ_LIMIT` (library/std/src/sys/fd/unix.rs:80): `c_int::MAX` on Apple. */
const READ_LIMIT = 0x7fffffff;

// std: library/std/src/sys/fd/unix.rs:137 read
function FileDesc_read(fd: OwnedFd, buf: Uint8Array): IoResult<number> {
  const ret = cvt(libc("std::sys::fd::FileDesc::read").read(fd.as_raw_fd(), buf.length === 0 ? null : ptr(buf), Math.min(buf.length, READ_LIMIT)) as number);
  if (ret.$ === "Err") return ret;
  return Ok(ret._0);
}

// std: library/std/src/sys/fd/unix.rs:373 write
function FileDesc_write(fd: OwnedFd, buf: Uint8Array): IoResult<number> {
  const ret = cvt(libc("std::sys::fd::FileDesc::write").write(fd.as_raw_fd(), buf.length === 0 ? null : ptr(buf), Math.min(buf.length, READ_LIMIT)) as number);
  if (ret.$ === "Err") return ret;
  return Ok(ret._0);
}

// std: library/std/src/sys/fs/unix.rs:1630 file_time_to_timespec
function file_time_to_timespec(time: SystemTime | undefined): IoResult<[bigint, bigint]> {
  // PORT: `libc::timespec { tv_sec, tv_nsec }` as a pair. `to_timespec` (sys/pal/unix/time.rs:171) always succeeds
  // with Apple's 64-bit `time_t`.
  if (time !== undefined) return Ok([time.t.tv_sec, BigInt(time.t.tv_nsec)]);
  return Ok([0n, BigInt(UTIME_OMIT)]);
}

/** `struct TimesAttrlist` (target_vendor = "apple") */
class TimesAttrlist {
  constructor(
    public buf: Uint8Array,
    public attrlist_: Uint8Array,
    public num_times: number,
  ) {}

  // std: library/std/src/sys/fs/unix.rs:1659 from_times
  static from_times(times: FileTimes): IoResult<TimesAttrlist> {
    const this_ = new TimesAttrlist(new Uint8Array(3 * TIMESPEC_SIZE), new Uint8Array(ATTRLIST_SIZE), 0);
    const buf = new DataView(this_.buf.buffer);
    const attrlist = new DataView(this_.attrlist_.buffer);
    let commonattr = 0;
    const write = (ts: [bigint, bigint]) => {
      buf.setBigInt64(this_.num_times * TIMESPEC_SIZE, ts[0], true);
      buf.setBigInt64(this_.num_times * TIMESPEC_SIZE + 8, ts[1], true);
    };
    // this.attrlist.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    attrlist.setUint16(0, ATTR_BIT_MAP_COUNT, true);
    if (times.created !== undefined) {
      const t = file_time_to_timespec(times.created);
      if (t.$ === "Err") return t;
      write(t._0);
      this_.num_times += 1;
      commonattr |= ATTR_CMN_CRTIME;
    }
    if (times.modified !== undefined) {
      const t = file_time_to_timespec(times.modified);
      if (t.$ === "Err") return t;
      write(t._0);
      this_.num_times += 1;
      commonattr |= ATTR_CMN_MODTIME;
    }
    if (times.accessed !== undefined) {
      const t = file_time_to_timespec(times.accessed);
      if (t.$ === "Err") return t;
      write(t._0);
      this_.num_times += 1;
      commonattr |= ATTR_CMN_ACCTIME;
    }
    // `attrlist.commonattr` (offset 4)
    attrlist.setUint32(4, commonattr, true);
    return Ok(this_);
  }

  // std: library/std/src/sys/fs/unix.rs:1684 attrlist
  attrlist(): Uint8Array {
    return this.attrlist_;
  }

  // std: library/std/src/sys/fs/unix.rs:1688 times_buf
  times_buf(): Uint8Array {
    return this.buf;
  }

  // std: library/std/src/sys/fs/unix.rs:1692 times_buf_size
  times_buf_size(): number {
    return this.num_times * TIMESPEC_SIZE;
  }
}

/** `sys::fs::Dir(OwnedFd)` (library/std/src/sys/fs/unix/dir.rs) */
class fs_imp_Dir {
  constructor(public _0: OwnedFd) {}

  // std: library/std/src/sys/fs/unix/dir.rs:42 open
  static open(path: string, opts: OpenOptions): IoResult<fs_imp_Dir> {
    return run_path_with_cstr(path, (path) => fs_imp_Dir.open_with_c(path, opts));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:50 duplicate
  duplicate(): IoResult<fs_imp_Dir> {
    const fd = this._0.try_clone();
    if (fd.$ === "Err") return fd;
    return Ok(new fs_imp_Dir(fd._0));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:54 open_file
  open_file(path: string, opts: OpenOptions): IoResult<fs_imp_File> {
    const r = run_path_with_cstr(path, (path) => this.open_file_c(path, opts, 0));
    if (r.$ === "Err") return r;
    return Ok(new fs_imp_File(r._0));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:60 self_metadata
  self_metadata(): IoResult<FileAttr> {
    // Reuse the implementation for files, which should work for all FDs.
    // PORT: the `ManuallyDrop<File>` borrowing the fd is a `File` over a non-owning `OwnedFd` copy that is never dropped.
    const f = new fs_imp_File(new OwnedFd(this._0.as_raw_fd()));
    return f.file_attr();
  }

  // std: library/std/src/sys/fs/unix/dir.rs:80 open_dir
  open_dir(path: string, opts: OpenOptions): IoResult<fs_imp_Dir> {
    const r = run_path_with_cstr(path, (path) => this.open_file_c(path, opts, O_DIRECTORY));
    if (r.$ === "Err") return r;
    return Ok(new fs_imp_Dir(r._0));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:92 metadata
  metadata(path: string): IoResult<FileAttr> {
    return run_path_with_cstr(path, (path) => this.metadata_c(path, /* symlink_nofollow */ false));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:98 symlink_metadata
  symlink_metadata(path: string): IoResult<FileAttr> {
    return run_path_with_cstr(path, (path) => this.metadata_c(path, /* symlink_nofollow */ true));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:102 open_with_c
  static open_with_c(path: Uint8Array, opts: OpenOptions): IoResult<fs_imp_Dir> {
    const access = opts.get_access_mode();
    if (access.$ === "Err") return access;
    const creation = opts.get_creation_mode();
    if (creation.$ === "Err") return creation;
    const flags = O_CLOEXEC | O_DIRECTORY | access._0 | creation._0 | (opts.custom_flags_ & ~O_ACCMODE);
    const c = libc("std::sys::fs::Dir::open_with_c");
    const fd = cvt_r(() => c.open(ptr(path), flags, 0, 0, 0, 0, 0, 0, opts.mode_ | 0));
    if (fd.$ === "Err") return fd;
    return Ok(new fs_imp_Dir(new OwnedFd(fd._0)));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:118 open_file_c
  open_file_c(path: Uint8Array, opts: OpenOptions, extra_flags: number): IoResult<OwnedFd> {
    const access = opts.get_access_mode();
    if (access.$ === "Err") return access;
    const creation = opts.get_creation_mode();
    if (creation.$ === "Err") return creation;
    const flags = O_CLOEXEC | access._0 | creation._0 | (opts.custom_flags_ & ~O_ACCMODE) | extra_flags;
    const c = libc("std::sys::fs::Dir::open_file_c");
    const fd = cvt_r(() => c.openat(this._0.as_raw_fd(), ptr(path), flags, 0, 0, 0, 0, 0, opts.mode_ | 0));
    if (fd.$ === "Err") return fd;
    return Ok(new OwnedFd(fd._0));
  }

  // std: library/std/src/sys/fs/unix/dir.rs:157 metadata_c
  metadata_c(path: Uint8Array, symlink_nofollow: boolean): IoResult<FileAttr> {
    const fd = this._0.as_raw_fd();
    const flag = symlink_nofollow ? AT_SYMLINK_NOFOLLOW : 0;

    const stat = new Uint8Array(STAT_SIZE);
    const r = cvt(libc("std::sys::fs::Dir::metadata_c").fstatat(fd, ptr(path), ptr(stat), flag));
    if (r.$ === "Err") return r;
    return Ok(FileAttr.from_stat64(read_stat(stat)));
  }
}

/** `struct InnerReadDir { dirp: DirStream, root: PathBuf }`; `DirStream(*mut libc::DIR)` is `dirp` (NULL once
 *  dropped). PORT: the `Arc` shared with the entries is the object; `closedir` runs when the `ReadDir` is dropped. */
interface InnerReadDir {
  dirp: Pointer | null;
  root: string;
}

/** `sys::fs::ReadDir` */
class fs_imp_ReadDir {
  constructor(
    public inner: InnerReadDir,
    public end_of_stream: boolean,
  ) {}

  // std: library/std/src/sys/fs/unix.rs:268 new
  static new(inner: InnerReadDir): fs_imp_ReadDir {
    return new fs_imp_ReadDir(inner, false);
  }

  // impl Iterator for ReadDir
  // std: library/std/src/sys/fs/unix.rs:810 next
  next(): IoResult<fs_imp_DirEntry> | undefined {
    if (this.end_of_stream) {
      return undefined;
    }
    const dirp = this.inner.dirp;
    if (is_null(dirp)) return panic("rust-ts: use of a dropped ReadDir");
    const c = libc("std::sys::fs::ReadDir::next");

    for (;;) {
      set_errno(0);
      const entry_ptr = c.readdir(dirp) as Pointer | null;
      if (is_null(entry_ptr)) {
        // We either encountered an error, or reached the end. Either way,
        // the next call to next() should return None.
        this.end_of_stream = true;

        // To distinguish between errors and end-of-directory, we had to clear
        // errno beforehand to check for an error now.
        const e = errno();
        return e === 0 ? undefined : Err(io_error_from_raw_os_error(e));
      }

      // d_name is guaranteed to be null-terminated.
      const name = read_cstr((entry_ptr + DIRENT_D_NAME) as Pointer);
      if ((name.length === 1 && name[0] === 0x2e) || (name.length === 2 && name[0] === 0x2e && name[1] === 0x2e)) {
        continue;
      }

      const entry: dirent64_min = {
        d_ino: read.u64(entry_ptr, 0),
        d_type: read.u8(entry_ptr, 20),
      };

      return Ok(new fs_imp_DirEntry(this.inner, entry, name));
    }
  }

  /** Drop of the last `Arc<InnerReadDir>`: the `DirStream`'s. PORT: entries do not keep the stream open (header). */
  drop(): void {
    DirStream_drop(this.inner);
  }
}

// impl Drop for DirStream
// std: library/std/src/sys/fs/unix.rs:986 drop
function DirStream_drop(inner: InnerReadDir): void {
  const dirp = inner.dirp;
  if (is_null(dirp)) return panic("rust-ts: DirStream dropped twice");
  inner.dirp = null;
  // dirfd isn't supported everywhere
  // let fd = unsafe { libc::dirfd(self.0) }; debug_assert_fd_is_open(fd);  (no-op: std ships without UB checks)
  const r = libc("std::sys::fs::DirStream::drop").closedir(dirp);
  if (!(r === 0 || is_interrupted(last_os_error()))) {
    panic(`unexpected error during closedir: ${debug_IoError(last_os_error(), PLAIN)}`);
  }
}

/** `struct dirent64_min { d_ino: u64, d_type: u8 }` */
interface dirent64_min {
  d_ino: bigint;
  d_type: number;
}

/** `sys::fs::DirEntry { dir: Arc<InnerReadDir>, entry: dirent64_min, name: CString }` (`name` without its NUL). */
class fs_imp_DirEntry {
  constructor(
    public dir: InnerReadDir,
    public entry: dirent64_min,
    public name: Uint8Array,
  ) {}

  // std: library/std/src/sys/fs/unix.rs:1023 file_name
  file_name(): Uint8Array {
    return this.file_name_os_str().slice();
  }

  // std: library/std/src/sys/fs/unix.rs:1027 metadata
  metadata(): IoResult<FileAttr> {
    // Use directory handle where possible (target_vendor = "apple")
    const dirp = this.dir.dirp;
    if (is_null(dirp)) return panic("rust-ts: DirEntry::metadata after its ReadDir was dropped (PORT: Arc not modelled)");
    const fd = cvt(libc("std::sys::fs::DirEntry::metadata").dirfd(dirp));
    if (fd.$ === "Err") return fd;

    // Make this FD into a directory handle. We don't actually drop it,
    // so having an `OwnedFd` is fine.
    const dir_handle = new fs_imp_Dir(new OwnedFd(fd._0));

    const name = new Uint8Array(this.name.length + 1);
    name.set(this.name);
    return dir_handle.metadata_c(name, /* symlink_nofollow */ true);
  }

  // std: library/std/src/sys/fs/unix.rs:1053 file_type
  file_type(): IoResult<fs_imp_FileType> {
    // Use `entry.d_type` if available.
    switch (this.entry.d_type) {
      case DT_CHR:
        return Ok(new fs_imp_FileType(S_IFCHR));
      case DT_FIFO:
        return Ok(new fs_imp_FileType(S_IFIFO));
      case DT_LNK:
        return Ok(new fs_imp_FileType(S_IFLNK));
      case DT_REG:
        return Ok(new fs_imp_FileType(S_IFREG));
      case DT_SOCK:
        return Ok(new fs_imp_FileType(S_IFSOCK));
      case DT_DIR:
        return Ok(new fs_imp_FileType(S_IFDIR));
      case DT_BLK:
        return Ok(new fs_imp_FileType(S_IFBLK));
      default:
        break;
    }

    // Fall back to loading the metadata.
    const m = this.metadata();
    return m.$ === "Ok" ? Ok(m._0.file_type()) : m;
  }

  // std: library/std/src/sys/fs/unix.rs:1081 ino
  ino(): bigint {
    return this.entry.d_ino;
  }

  // std: library/std/src/sys/fs/unix.rs:1085 file_name_os_str
  file_name_os_str(): Uint8Array {
    return this.name;
  }
}

// std: library/std/src/sys/fs/unix.rs:1846 readdir
function readdir(path: string): IoResult<fs_imp_ReadDir> {
  const c = libc("std::sys::fs::readdir");
  const p = run_path_with_cstr(path, (p) => Ok(c.opendir(ptr(p)) as Pointer | null));
  if (p.$ === "Err") return p;
  if (is_null(p._0)) {
    return Err(last_os_error());
  } else {
    const root = path;
    const inner: InnerReadDir = { dirp: p._0, root };
    return Ok(fs_imp_ReadDir.new(inner));
  }
}

// std: library/std/src/sys/fs/unix.rs:1857 unlink
function unlink(p: Uint8Array): IoResult<null> {
  const r = cvt(libc("std::sys::fs::unlink").unlink(ptr(p)));
  return r.$ === "Ok" ? Ok(null) : r;
}

// std: library/std/src/sys/fs/unix.rs:1861 rename
function imp_rename(old: Uint8Array, new_: Uint8Array): IoResult<null> {
  const r = cvt(libc("std::sys::fs::rename").rename(ptr(old), ptr(new_)));
  return r.$ === "Ok" ? Ok(null) : r;
}

// std: library/std/src/sys/fs/unix.rs:1865 set_perm
function set_perm(p: Uint8Array, perm: Permissions): IoResult<null> {
  const c = libc("std::sys::fs::set_perm");
  const r = cvt_r(() => c.chmod(ptr(p), perm.mode_));
  return r.$ === "Ok" ? Ok(null) : r;
}

// std: library/std/src/sys/fs/unix.rs:1956 rmdir
function rmdir(p: Uint8Array): IoResult<null> {
  const r = cvt(libc("std::sys::fs::rmdir").rmdir(ptr(p)));
  return r.$ === "Ok" ? Ok(null) : r;
}

// std: library/std/src/sys/fs/unix.rs:1960 readlink
function readlink(c_path: Uint8Array): IoResult<string> {
  const p = ptr(c_path);
  const c = libc("std::sys::fs::readlink");

  // PORT: `Vec::with_capacity(256)`, and `reserve(1)` on a full buffer, grow the capacity as `Vec` does for bytes
  // (`max(2 * cap, cap + 1, 8)`).
  let buf = new Uint8Array(256);

  for (;;) {
    const buf_read_r = cvt(c.readlink(p, ptr(buf), buf.length) as number);
    if (buf_read_r.$ === "Err") return buf_read_r;
    const buf_read = buf_read_r._0;

    if (buf_read !== buf.length) {
      return Ok(lossy(buf.subarray(0, buf_read)));
    }

    // Trigger the internal buffer resizing logic of `Vec` by requiring
    // more space than the current capacity. The length is guaranteed to be
    // the same as the capacity due to the if statement above.
    buf = new Uint8Array(Math.max(2 * buf.length, buf.length + 1, 8));
  }
}

// std: library/std/src/sys/fs/unix.rs:1986 symlink
function imp_symlink(original: Uint8Array, link: Uint8Array): IoResult<null> {
  const r = cvt(libc("std::sys::fs::symlink").symlink(ptr(original), ptr(link)));
  return r.$ === "Ok" ? Ok(null) : r;
}

// std: library/std/src/sys/fs/unix.rs:1990 link
function link(original: Uint8Array, link: Uint8Array): IoResult<null> {
  // Where we can, use `linkat` instead of `link`; see the comment above
  // this one for details on why.
  const r = cvt(libc("std::sys::fs::link").linkat(AT_FDCWD, ptr(original), AT_FDCWD, ptr(link), 0));
  if (r.$ === "Err") return r;
  return Ok(null);
}

// std: library/std/src/sys/fs/unix.rs:2019 stat
function stat(p: Uint8Array): IoResult<FileAttr> {
  const buf = new Uint8Array(STAT_SIZE);
  const r = cvt(libc("std::sys::fs::stat").stat(ptr(p), ptr(buf)));
  if (r.$ === "Err") return r;
  return Ok(FileAttr.from_stat64(read_stat(buf)));
}

// std: library/std/src/sys/fs/unix.rs:2036 lstat
function lstat(p: Uint8Array): IoResult<FileAttr> {
  const buf = new Uint8Array(STAT_SIZE);
  const r = cvt(libc("std::sys::fs::lstat").lstat(ptr(p), ptr(buf)));
  if (r.$ === "Err") return r;
  return Ok(FileAttr.from_stat64(read_stat(buf)));
}

// std: library/std/src/sys/fs/unix.rs:2077 set_times_impl
function set_times_impl(p: Uint8Array, times: FileTimes, follow_symlinks: boolean): IoResult<null> {
  // target_vendor = "apple": Apple platforms use setattrlist which supports setting times on symlinks
  const ta = TimesAttrlist.from_times(times);
  if (ta.$ === "Err") return ta;
  const options = follow_symlinks ? 0 : FSOPT_NOFOLLOW;

  const r = cvt(libc("std::sys::fs::set_times_impl").setattrlist(ptr(p), ptr(ta._0.attrlist()), ptr(ta._0.times_buf()), ta._0.times_buf_size(), options));
  if (r.$ === "Err") return r;
  return Ok(null);
}

// ---- sys::fs (library/std/src/sys/fs/mod.rs): the dispatch with `with_native_path` (`run_path_with_cstr` on unix) ----

// std: library/std/src/sys/fs/mod.rs:68 read_dir
function imp_read_dir(path: string): IoResult<fs_imp_ReadDir> {
  // FIXME: use with_native_path on all platforms
  return readdir(path);
}

// std: library/std/src/sys/fs/mod.rs:73 remove_file
function imp_remove_file(path: string): IoResult<null> {
  return run_path_with_cstr(path, unlink);
}

// std: library/std/src/sys/fs/mod.rs:77 rename
function imp_rename_path(old: string, new_: string): IoResult<null> {
  return run_path_with_cstr(old, (old) => run_path_with_cstr(new_, (new_) => imp_rename(old, new_)));
}

// std: library/std/src/sys/fs/mod.rs:81 remove_dir
function imp_remove_dir(path: string): IoResult<null> {
  return run_path_with_cstr(path, rmdir);
}

// std: library/std/src/sys/fs/mod.rs:93 read_link
function imp_read_link(path: string): IoResult<string> {
  return run_path_with_cstr(path, readlink);
}

// std: library/std/src/sys/fs/mod.rs:97 symlink
function imp_symlink_path(original: string, link: string): IoResult<null> {
  // FIXME: use with_native_path on all platforms
  return run_path_with_cstr(original, (original) => run_path_with_cstr(link, (link) => imp_symlink(original, link)));
}

// std: library/std/src/sys/fs/mod.rs:107 hard_link
function imp_hard_link(original: string, link_: string): IoResult<null> {
  return run_path_with_cstr(original, (original) => run_path_with_cstr(link_, (l) => link(original, l)));
}

// std: library/std/src/sys/fs/mod.rs:113 metadata
function imp_metadata(path: string): IoResult<FileAttr> {
  return run_path_with_cstr(path, stat);
}

// std: library/std/src/sys/fs/mod.rs:117 symlink_metadata
function imp_symlink_metadata(path: string): IoResult<FileAttr> {
  return run_path_with_cstr(path, lstat);
}

// std: library/std/src/sys/fs/mod.rs:121 set_permissions
function imp_set_permissions(path: string, perm: Permissions): IoResult<null> {
  return run_path_with_cstr(path, (path) => set_perm(path, perm.clone()));
}

// std: library/std/src/sys/fs/mod.rs:129 canonicalize
function imp_canonicalize(path: string): IoResult<string> {
  // PORT: `with_native_path(path, &imp::canonicalize)`: src/std/path.ts `host_canonicalize` is that call
  // (`realpath(3)` on the path's bytes through src/std/env.ts `libc_canonicalize`, the sys fn's marker).
  return host_canonicalize(path);
}

// std: library/std/src/sys/fs/mod.rs:149 set_times
function imp_set_times(path: string, times: FileTimes): IoResult<null> {
  return run_path_with_cstr(path, (path) => set_times_impl(path, times.clone(), true));
}

// std: library/std/src/sys/fs/mod.rs:153 set_times_nofollow
function imp_set_times_nofollow(path: string, times: FileTimes): IoResult<null> {
  return run_path_with_cstr(path, (path) => set_times_impl(path, times.clone(), false));
}

// ---- std::fs (library/std/src/fs.rs) ---------------------------------------------------------------------------------

/// An object providing access to an open file on the filesystem.
export class File {
  constructor(public inner: fs_imp_File) {}

  /** Rust's drop of the `File`: its `OwnedFd` closes the fd. */
  drop(): void {
    if (!HOST_LIBC) return host("std::fs::File::drop");
    this.inner._0.drop();
  }

  // std: library/std/src/fs.rs:584 open
  static open(path: string): IoResult<File> {
    return OpenOptions.new().read(true).open(path);
  }

  // std: library/std/src/fs.rs:790 sync_all
  sync_all(): IoResult<null> {
    return this.inner.fsync();
  }
  // std: library/std/src/fs.rs:822 sync_data
  sync_data(): IoResult<null> {
    return this.inner.datasync();
  }
  // std: library/std/src/fs.rs:875 lock
  lock(): IoResult<null> {
    return this.inner.lock();
  }
  // std: library/std/src/fs.rs:927 lock_shared
  lock_shared(): IoResult<null> {
    return this.inner.lock_shared();
  }
  // std: library/std/src/fs.rs:992 try_lock
  try_lock(): TryLockResult {
    return this.inner.try_lock();
  }
  // std: library/std/src/fs.rs:1056 try_lock_shared
  try_lock_shared(): TryLockResult {
    return this.inner.try_lock_shared();
  }
  // std: library/std/src/fs.rs:1093 unlock
  unlock(): IoResult<null> {
    return this.inner.unlock();
  }
  // std: library/std/src/fs.rs:1131 set_len
  set_len(size: bigint): IoResult<null> {
    return this.inner.truncate(size);
  }
  // std: library/std/src/fs.rs:1149 metadata
  metadata(): IoResult<Metadata> {
    const r = this.inner.file_attr();
    return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1193 try_clone
  try_clone(): IoResult<File> {
    const r = this.inner.duplicate();
    return r.$ === "Ok" ? Ok(new File(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1231 set_permissions
  set_permissions(perm: Permissions): IoResult<null> {
    return this.inner.set_permissions(perm);
  }
  // std: library/std/src/fs.rs:1278 set_times
  set_times(times: FileTimes): IoResult<null> {
    return this.inner.set_times(times);
  }
  // impl Read for &File
  // std: library/std/src/fs.rs:1345 read
  read(buf: Uint8Array): IoResult<number> {
    return this.inner.read(buf);
  }
  // impl Write for &File
  // std: library/std/src/fs.rs:1412 write
  write(buf: Uint8Array): IoResult<number> {
    return this.inner.write(buf);
  }
  // impl Seek for &File
  // std: library/std/src/fs.rs:1476 seek
  seek(pos: SeekFrom): IoResult<bigint> {
    return this.inner.seek(pos);
  }
  // std: library/std/src/fs.rs:1498 stream_position
  stream_position(): IoResult<bigint> {
    return this.inner.tell();
  }

  /** `impl IsTerminal for File`: `crate::sys::io::is_terminal(self)`. */
  is_terminal(): boolean {
    return is_terminal(this.inner._0);
  }

  /** `OwnedFd::from(file)` (library/std/src/os/fd/owned.rs:332): moves the fd out of this `File`. */
  // std: library/std/src/os/fd/owned.rs:332 from
  into_owned_fd(): OwnedFd {
    return this.inner._0.take();
  }
}

// std: library/std/src/sys/io/is_terminal/isatty.rs:3 is_terminal
function is_terminal(fd: OwnedFd): boolean {
  return libc("std::sys::io::is_terminal").isatty(fd.as_raw_fd()) !== 0;
}

/** `std::fs::TryLockError` */
export type TryLockError = { readonly $: "Error"; _0: IoError } | { readonly $: "WouldBlock" };
type TryLockResult = { $: "Ok"; _0: null } | { $: "Err"; _0: TryLockError };

/// An open directory (unstable `std::fs::Dir`, feature `dirfd`).
export class Dir {
  constructor(public inner: fs_imp_Dir) {}

  /** Rust's drop of the `Dir`: its `OwnedFd` closes the fd. */
  drop(): void {
    if (!HOST_LIBC) return host("std::fs::Dir::drop");
    this.inner._0.drop();
  }

  // std: library/std/src/fs.rs:1583 open
  static open(path: string): IoResult<Dir> {
    const r = fs_imp_Dir.open(path, OpenOptions.new().read(true));
    return r.$ === "Ok" ? Ok(new Dir(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1612 open_with
  static open_with(path: string, opts: OpenOptions): IoResult<Dir> {
    const r = fs_imp_Dir.open(path, opts);
    return r.$ === "Ok" ? Ok(new Dir(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1662 self_metadata
  self_metadata(): IoResult<Metadata> {
    const r = this.inner.self_metadata();
    return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1725 open_file_with
  open_file_with(path: string, opts: OpenOptions): IoResult<File> {
    const r = this.inner.open_file(path, opts);
    return r.$ === "Ok" ? Ok(new File(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1900 try_clone
  try_clone(): IoResult<Dir> {
    const r = this.inner.duplicate();
    return r.$ === "Ok" ? Ok(new Dir(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1924 metadata
  metadata(path: string): IoResult<Metadata> {
    const r = this.inner.metadata(path);
    return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
  }
  // std: library/std/src/fs.rs:1948 symlink_metadata
  symlink_metadata(path: string): IoResult<Metadata> {
    const r = this.inner.symlink_metadata(path);
    return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
  }

  /** `fs::Dir::from(OwnedFd)` */
  // std: library/std/src/sys/fs/unix/dir.rs:223 from
  static from_owned_fd(value: OwnedFd): Dir {
    return new Dir(new fs_imp_Dir(value));
  }
}

/// Options and flags which can be used to configure how a file is opened.
/// PORT: the fields are the unix `sys::fs::OpenOptions` (library/std/src/sys/fs/unix.rs) that `std::fs::OpenOptions`
/// wraps; `mode` defaults to `0o666`.
export class OpenOptions {
  constructor(
    // generic
    public read_: boolean,
    public write_: boolean,
    public append_: boolean,
    public truncate_: boolean,
    public create_: boolean,
    public create_new_: boolean,
    // system-specific
    public custom_flags_: number,
    public mode_: number,
  ) {}

  // std: library/std/src/fs.rs:1993 new
  static new(): OpenOptions {
    return new OpenOptions(false, false, false, false, false, false, 0, 0o666);
  }
  // std: library/std/src/fs.rs:2010 read
  read(read: boolean): this {
    this.read_ = read;
    return this;
  }
  // std: library/std/src/fs.rs:2031 write
  write(write: boolean): this {
    this.write_ = write;
    return this;
  }
  // std: library/std/src/fs.rs:2084 append
  append(append: boolean): this {
    this.append_ = append;
    return this;
  }
  // std: library/std/src/fs.rs:2104 truncate
  truncate(truncate: boolean): this {
    this.truncate_ = truncate;
    return this;
  }
  // std: library/std/src/fs.rs:2129 create
  create(create: boolean): this {
    this.create_ = create;
    return this;
  }
  // std: library/std/src/fs.rs:2167 create_new
  create_new(create_new: boolean): this {
    this.create_new_ = create_new;
    return this;
  }
  // std: library/std/src/fs.rs:2216 open
  open(path: string): IoResult<File> {
    return this._open(path);
  }
  // std: library/std/src/fs.rs:2220 _open
  _open(path: string): IoResult<File> {
    const r = fs_imp_File.open(path, this);
    return r.$ === "Ok" ? Ok(new File(r._0)) : r;
  }
  // impl OpenOptionsExt for OpenOptions
  // std: library/std/src/os/unix/fs.rs:548 mode
  mode(mode: number): this {
    // PORT: `self.as_inner_mut().mode(mode)` stores `mode as mode_t`: Apple's `mode_t` is `u16`.
    this.mode_ = HOST_LIBC ? mode & 0xffff : mode;
    return this;
  }
  // std: library/std/src/os/unix/fs.rs:553 custom_flags
  custom_flags(flags: number): this {
    this.custom_flags_ = flags;
    return this;
  }

  // std: library/std/src/sys/fs/unix.rs:1133 get_access_mode
  get_access_mode(): IoResult<number> {
    const { read_: read, write_: write, append_: append } = this;
    if (read && !write && !append) return Ok(O_RDONLY);
    if (!read && write && !append) return Ok(O_WRONLY);
    if (read && write && !append) return Ok(O_RDWR);
    if (!read && append) return Ok(O_WRONLY | O_APPEND);
    if (read && append) return Ok(O_RDWR | O_APPEND);
    // (false, false, false)
    // If no access mode is set, check if any creation flags are set
    // to provide a more descriptive error message
    if (this.create_ || this.create_new_ || this.truncate_) {
      return Err(io_error_new("InvalidInput", "creating or truncating a file requires write or append access"));
    } else {
      return Err(io_error_new("InvalidInput", "must specify at least one of read, write, or append access"));
    }
  }

  // std: library/std/src/sys/fs/unix.rs:1158 get_creation_mode
  get_creation_mode(): IoResult<number> {
    const { write_: write, append_: append } = this;
    if (write && !append) {
      // (true, false) => {}
    } else if (!write && !append) {
      if (this.truncate_ || this.create_ || this.create_new_) {
        return Err(io_error_new("InvalidInput", "creating or truncating a file requires write or append access"));
      }
    } else {
      // (_, true)
      if (this.truncate_ && !this.create_new_) {
        return Err(io_error_new("InvalidInput", "append and truncate cannot both be enabled"));
      }
    }

    const { create_: create, truncate_: truncate, create_new_: create_new } = this;
    if (create_new) return Ok(O_CREAT | O_EXCL);
    if (!create && !truncate) return Ok(0);
    if (create && !truncate) return Ok(O_CREAT);
    if (!create && truncate) return Ok(O_TRUNC);
    return Ok(O_CREAT | O_TRUNC);
  }
}

/** `io::Error::new(kind, &str)`: a boxed `StringError`. */
function io_error_new(kind: ErrorKind, error: string): IoError {
  return { $: "Custom", kind, error };
}

/// Metadata information about a file.
export class Metadata {
  constructor(public _0: FileAttr) {}

  // std: library/std/src/fs.rs:2256 file_type
  file_type(): FileType {
    return new FileType(this._0.file_type());
  }
  // std: library/std/src/fs.rs:2279 is_dir
  is_dir(): boolean {
    return this.file_type().is_dir();
  }
  // std: library/std/src/fs.rs:2308 is_file
  is_file(): boolean {
    return this.file_type().is_file();
  }
  // std: library/std/src/fs.rs:2334 is_symlink
  is_symlink(): boolean {
    return this.file_type().is_symlink();
  }
  // std: library/std/src/fs.rs:2354 len
  len(): bigint {
    return this._0.size();
  }
  // std: library/std/src/fs.rs:2374 permissions
  permissions(): Permissions {
    return this._0.perm();
  }
  // std: library/std/src/fs.rs:2406 modified
  modified(): IoResult<SystemTime> {
    return this._0.modified();
  }
  // std: library/std/src/fs.rs:2442 accessed
  accessed(): IoResult<SystemTime> {
    return this._0.accessed();
  }
  // std: library/std/src/fs.rs:2475 created
  created(): IoResult<SystemTime> {
    return this._0.created();
  }
  // impl MetadataExt for fs::Metadata
  // PORT: the values are those of `std::os::macos::fs::MetadataExt::st_*` (the host's `stat` fields widened with `as`).
  // std: library/std/src/os/unix/fs.rs:869 dev
  dev(): bigint {
    return BigInt.asUintN(64, BigInt(this._0.stat.st_dev));
  }
  // std: library/std/src/os/unix/fs.rs:872 ino
  ino(): bigint {
    return this._0.stat.st_ino;
  }
  // std: library/std/src/os/unix/fs.rs:878 nlink
  nlink(): bigint {
    return BigInt(this._0.stat.st_nlink);
  }
  // std: library/std/src/os/unix/fs.rs:881 uid
  uid(): number {
    return this._0.stat.st_uid;
  }
  // std: library/std/src/os/unix/fs.rs:884 gid
  gid(): number {
    return this._0.stat.st_gid;
  }
  // std: library/std/src/os/unix/fs.rs:911 blksize
  blksize(): bigint {
    return BigInt.asUintN(64, BigInt(this._0.stat.st_blksize));
  }
  // std: library/std/src/os/unix/fs.rs:914 blocks
  blocks(): bigint {
    return BigInt.asUintN(64, this._0.stat.st_blocks);
  }
}

/// Representation of the various timestamps on a file.
/// PORT: the unix `sys::fs::FileTimes` (`created` exists on Apple hosts only, and only `set_created` sets it).
export class FileTimes {
  constructor(
    public accessed: SystemTime | undefined,
    public modified: SystemTime | undefined,
    public created: SystemTime | undefined,
  ) {}

  // std: library/std/src/fs.rs:2524 new
  static new(): FileTimes {
    return new FileTimes(undefined, undefined, undefined);
  }
  // std: library/std/src/fs.rs:2530 set_accessed
  set_accessed(t: SystemTime): FileTimes {
    this.accessed = t;
    return this;
  }
  // std: library/std/src/fs.rs:2537 set_modified
  set_modified(t: SystemTime): FileTimes {
    this.modified = t;
    return this;
  }

  /** `#[derive(Clone)]` (`Copy`) */
  clone(): FileTimes {
    return new FileTimes(this.accessed, this.modified, this.created);
  }
}

/// Representation of the various permissions on a file.
/// PORT: the unix `sys::fs::FilePermissions { mode: mode_t }`.
export class Permissions {
  constructor(public mode_: number) {}

  // std: library/std/src/fs.rs:2599 readonly
  readonly(): boolean {
    // check if any class (owner, group, others) has write permission
    return (this.mode_ & 0o222) === 0;
  }
  // std: library/std/src/fs.rs:2666 set_readonly
  set_readonly(readonly: boolean): void {
    if (readonly) {
      // remove write permission for all classes; equivalent to `chmod a-w <file>`
      this.mode_ &= ~0o222;
    } else {
      // add write permission for all classes; equivalent to `chmod a+w <file>`
      this.mode_ |= 0o222;
    }
  }
  // impl PermissionsExt for Permissions
  // std: library/std/src/os/unix/fs.rs:479 mode
  mode(): number {
    return this.mode_;
  }
  // std: library/std/src/os/unix/fs.rs:487 from_mode
  static from_mode(mode: number): Permissions {
    // PORT: `mode as mode_t`: Apple's `mode_t` is `u16`.
    return new Permissions(HOST_LIBC ? mode & 0xffff : mode);
  }

  /** `#[derive(Clone)]` */
  clone(): Permissions {
    return new Permissions(this.mode_);
  }
}

/// A structure representing a type of file with accessors for each file type.
export class FileType {
  constructor(public _0: fs_imp_FileType) {}

  // std: library/std/src/fs.rs:2695 is_dir
  is_dir(): boolean {
    return this._0.is_dir();
  }
  // std: library/std/src/fs.rs:2728 is_file
  is_file(): boolean {
    return this._0.is_file();
  }
  // std: library/std/src/fs.rs:2764 is_symlink
  is_symlink(): boolean {
    return this._0.is_symlink();
  }
  // impl FileTypeExt for fs::FileType
  // std: library/std/src/os/unix/fs.rs:1009 is_block_device
  is_block_device(): boolean {
    return this._0.is(S_IFBLK);
  }
  // std: library/std/src/os/unix/fs.rs:1012 is_char_device
  is_char_device(): boolean {
    return this._0.is(S_IFCHR);
  }
  // std: library/std/src/os/unix/fs.rs:1015 is_fifo
  is_fifo(): boolean {
    return this._0.is(S_IFIFO);
  }
  // std: library/std/src/os/unix/fs.rs:1018 is_socket
  is_socket(): boolean {
    return this._0.is(S_IFSOCK);
  }
}

/// Iterator over the entries in a directory.
export class ReadDir {
  constructor(public _0: fs_imp_ReadDir) {}

  /** Rust's drop of the `ReadDir` (its `DirStream` calls `closedir`). */
  drop(): void {
    if (!HOST_LIBC) return host("std::fs::ReadDir::drop");
    this._0.drop();
  }

  // impl Iterator for ReadDir
  // std: library/std/src/fs.rs:2804 next
  next(): IoResult<DirEntry> | undefined {
    const r = this._0.next();
    if (r === undefined) return undefined;
    return r.$ === "Ok" ? Ok(new DirEntry(r._0)) : r;
  }
}

/// Entries returned by the [`ReadDir`] iterator.
export class DirEntry {
  constructor(public _0: fs_imp_DirEntry) {}

  // std: library/std/src/fs.rs:2878 metadata
  metadata(): IoResult<Metadata> {
    const r = this._0.metadata();
    return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
  }
  // std: library/std/src/fs.rs:2913 file_type
  file_type(): IoResult<FileType> {
    const r = this._0.file_type();
    return r.$ === "Ok" ? Ok(new FileType(r._0)) : r;
  }
  // std: library/std/src/fs.rs:2942 file_name
  file_name(): string {
    return lossy(this._0.file_name());
  }
  // impl DirEntryExt for fs::DirEntry
  // std: library/std/src/os/unix/fs.rs:1051 ino
  ino(): bigint {
    return this._0.ino();
  }
}

/// A builder used to create directories in various manners.
/// PORT: the unix `sys::fs::DirBuilder { mode: mode_t }` (default `0o777`) and `recursive`.
export class DirBuilder {
  constructor(
    public mode_: number,
    public recursive: boolean,
  ) {}

  // std: library/std/src/fs.rs:3766 new
  static new(): DirBuilder {
    return new DirBuilder(0o777, false);
  }
  // std: library/std/src/fs.rs:3809 create
  create(path: string): IoResult<null> {
    return this._create(path);
  }
  // std: library/std/src/fs.rs:3813 _create
  _create(path: string): IoResult<null> {
    if (this.recursive) {
      return unported("std::fs::DirBuilder::create_dir_all (recursive; Miri's mkdir never sets it)");
    } else {
      return this.mkdir(path);
    }
  }
  // std: library/std/src/sys/fs/unix.rs:1702 mkdir
  mkdir(p: string): IoResult<null> {
    const c = libc("std::sys::fs::DirBuilder::mkdir");
    return run_path_with_cstr(p, (p) => {
      const r = cvt(c.mkdir(ptr(p), this.mode_));
      return r.$ === "Ok" ? Ok(null) : r;
    });
  }
  // impl DirBuilderExt for fs::DirBuilder
  // std: library/std/src/os/unix/fs.rs:1133 mode
  mode(mode: number): this {
    // PORT: `set_mode(mode)`: `mode as mode_t` (Apple's `mode_t` is `u16`).
    this.mode_ = HOST_LIBC ? mode & 0xffff : mode;
    return this;
  }
}

// std: library/std/src/fs.rs:477 set_times
export function set_times(path: string, times: FileTimes): IoResult<null> {
  return imp_set_times(path, times);
}

// std: library/std/src/fs.rs:518 set_times_nofollow
export function set_times_nofollow(path: string, times: FileTimes): IoResult<null> {
  return imp_set_times_nofollow(path, times);
}

// std: library/std/src/fs.rs:3002 remove_file
export function remove_file(path: string): IoResult<null> {
  return imp_remove_file(path);
}

// std: library/std/src/fs.rs:3044 metadata
export function metadata(path: string): IoResult<Metadata> {
  const r = imp_metadata(path);
  return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
}

// std: library/std/src/fs.rs:3085 symlink_metadata
export function symlink_metadata(path: string): IoResult<Metadata> {
  const r = imp_symlink_metadata(path);
  return r.$ === "Ok" ? Ok(new Metadata(r._0)) : r;
}

// std: library/std/src/fs.rs:3134 rename
export function rename(from: string, to: string): IoResult<null> {
  return imp_rename_path(from, to);
}

// std: library/std/src/fs.rs:3245 hard_link
export function hard_link(original: string, link: string): IoResult<null> {
  return imp_hard_link(original, link);
}

// std: library/std/src/fs.rs:3312 read_link
export function read_link(path: string): IoResult<string> {
  return imp_read_link(path);
}

// std: library/std/src/fs.rs:3356 canonicalize
export function canonicalize(path: string): IoResult<string> {
  if (!HOST_LIBC) return host("std::fs::canonicalize");
  return imp_canonicalize(path);
}

// std: library/std/src/fs.rs:3491 remove_dir
export function remove_dir(path: string): IoResult<null> {
  return imp_remove_dir(path);
}

// std: library/std/src/fs.rs:3637 read_dir
export function read_dir(path: string): IoResult<ReadDir> {
  const r = imp_read_dir(path);
  return r.$ === "Ok" ? Ok(new ReadDir(r._0)) : r;
}

// std: library/std/src/fs.rs:3689 set_permissions
export function set_permissions(path: string, perm: Permissions): IoResult<null> {
  return imp_set_permissions(path, perm);
}

/// `std::os::unix::fs::symlink`
// std: library/std/src/os/unix/fs.rs:1107 symlink
export function unix_symlink(original: string, link: string): IoResult<null> {
  return imp_symlink_path(original, link);
}
