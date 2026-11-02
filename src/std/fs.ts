// `std::fs` stand-ins (plan-m6 D14: host-dependent Miri code goes through src/std stand-ins), created by lane miri-fs for
// Miri's shims/unix/fs.rs (record: docs/handoff/miri-fs.md, for a root decision as miri-eval's src/std/time.ts was).
// Port of the subset of library/std/src/fs.rs (+ the unix extension traits of library/std/src/os/unix/fs.rs, and
// `std::path::absolute`) that Miri's file-system shims call.
//
// PORT:
// - The pure builders are ported with their data: `OpenOptions` (the unix `sys::fs::OpenOptions` fields:
//   library/std/src/sys/fs/unix.rs), `FileTimes`, `Permissions`, `DirBuilder`. Miri's `open` and `mkstemp` build an
//   `OpenOptions` *before* the isolation check, so these run with isolation on.
// - Every operation that touches the host file system (`File`, `Dir`, `ReadDir`, `DirEntry`, `Metadata`, `FileType`
//   values, and the free fns) stops with `unported`: Miri only reaches them with isolation off
//   (`-Zmiri-disable-isolation`), which the gated suites never use (D14; harness-w36 skips those cases). A host
//   implementation (node:fs) is a root decision (docs/handoff/miri-fs.md); the types are opaque classes so that the
//   callers type-check against the upstream method names.
// - `Path`/`PathBuf` are strings (src/std/path.ts); `OsString` names are strings.
// - `std::path::absolute` belongs in src/std/path.ts; it is here because this lane may only create src/std/fs.ts.
//   It reads the host cwd for a relative path (`env::current_dir`, D14: the port runs with the oracle's cwd).
import { type IoError, type IoResult } from "./io.ts";
import { unported } from "./panic.ts";
import { path_components, path_is_absolute, path_join, type Component } from "./path.ts";
import { Err, Ok } from "./result.ts";
import { type SystemTime } from "./time.ts";

/** A host file-system operation (isolation off): not available in the port yet (D14). */
function host(what: string): never {
  return unported(`${what} (host file system access, isolation off; plan-m6 D14: src/std/fs.ts has no host implementation)`);
}

/// An object providing access to an open file on the filesystem.
export class File {
  private constructor() {}

  // std: library/std/src/fs.rs:790 sync_all
  sync_all(): IoResult<null> {
    return host("std::fs::File::sync_all");
  }
  // std: library/std/src/fs.rs:822 sync_data
  sync_data(): IoResult<null> {
    return host("std::fs::File::sync_data");
  }
  // std: library/std/src/fs.rs:992 try_lock
  try_lock(): TryLockResult {
    return host("std::fs::File::try_lock");
  }
  // std: library/std/src/fs.rs:1056 try_lock_shared
  try_lock_shared(): TryLockResult {
    return host("std::fs::File::try_lock_shared");
  }
  // std: library/std/src/fs.rs:1093 unlock
  unlock(): IoResult<null> {
    return host("std::fs::File::unlock");
  }
  // std: library/std/src/fs.rs:1131 set_len
  set_len(_size: bigint): IoResult<null> {
    return host("std::fs::File::set_len");
  }
  // std: library/std/src/fs.rs:1149 metadata
  metadata(): IoResult<Metadata> {
    return host("std::fs::File::metadata");
  }
  // std: library/std/src/fs.rs:1231 set_permissions
  set_permissions(_perm: Permissions): IoResult<null> {
    return host("std::fs::File::set_permissions");
  }
  // std: library/std/src/fs.rs:1278 set_times
  set_times(_times: FileTimes): IoResult<null> {
    return host("std::fs::File::set_times");
  }
  // impl Read for &File
  // std: library/std/src/fs.rs:1345 read
  read(_buf: Uint8Array): IoResult<number> {
    return host("<&std::fs::File as std::io::Read>::read");
  }
  // impl Write for &File
  // std: library/std/src/fs.rs:1412 write
  write(_buf: Uint8Array): IoResult<number> {
    return host("<&std::fs::File as std::io::Write>::write");
  }
  // impl Seek for &File
  // std: library/std/src/fs.rs:1476 seek
  seek(_pos: SeekFrom): IoResult<bigint> {
    return host("<&std::fs::File as std::io::Seek>::seek");
  }
  // std: library/std/src/fs.rs:1498 stream_position
  stream_position(): IoResult<bigint> {
    return host("<&std::fs::File as std::io::Seek>::stream_position");
  }
}

/** `std::io::SeekFrom` (library/std/src/io/mod.rs). PORT: here rather than in src/std/io.ts (not this lane's file). */
export type SeekFrom = { readonly $: "Start"; _0: bigint } | { readonly $: "End"; _0: bigint } | { readonly $: "Current"; _0: bigint };

/** `std::fs::TryLockError` */
export type TryLockError = { readonly $: "Error"; _0: IoError } | { readonly $: "WouldBlock" };
type TryLockResult = { $: "Ok"; _0: null } | { $: "Err"; _0: TryLockError };

/// An open directory (unstable `std::fs::Dir`, feature `dirfd`).
export class Dir {
  private constructor() {}

  // std: library/std/src/fs.rs:1583 open
  static open(_path: string): IoResult<Dir> {
    return host("std::fs::Dir::open");
  }
  // std: library/std/src/fs.rs:1662 self_metadata
  self_metadata(): IoResult<Metadata> {
    return host("std::fs::Dir::self_metadata");
  }
  // std: library/std/src/fs.rs:1900 try_clone
  try_clone(): IoResult<Dir> {
    return host("std::fs::Dir::try_clone");
  }
  // std: library/std/src/fs.rs:1924 metadata
  metadata(_path: string): IoResult<Metadata> {
    return host("std::fs::Dir::metadata");
  }
  // std: library/std/src/fs.rs:1948 symlink_metadata
  symlink_metadata(_path: string): IoResult<Metadata> {
    return host("std::fs::Dir::symlink_metadata");
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
  open(_path: string): IoResult<File> {
    return host("std::fs::OpenOptions::open");
  }
  // impl OpenOptionsExt for OpenOptions
  // std: library/std/src/os/unix/fs.rs:548 mode
  mode(mode: number): this {
    this.mode_ = mode;
    return this;
  }
  // std: library/std/src/os/unix/fs.rs:553 custom_flags
  custom_flags(flags: number): this {
    this.custom_flags_ = flags;
    return this;
  }
}

/// Metadata information about a file.
export class Metadata {
  private constructor() {}

  // std: library/std/src/fs.rs:2256 file_type
  file_type(): FileType {
    return host("std::fs::Metadata::file_type");
  }
  // std: library/std/src/fs.rs:2334 is_symlink
  is_symlink(): boolean {
    return host("std::fs::Metadata::is_symlink");
  }
  // std: library/std/src/fs.rs:2354 len
  len(): bigint {
    return host("std::fs::Metadata::len");
  }
  // std: library/std/src/fs.rs:2374 permissions
  permissions(): Permissions {
    return host("std::fs::Metadata::permissions");
  }
  // std: library/std/src/fs.rs:2406 modified
  modified(): IoResult<SystemTime> {
    return host("std::fs::Metadata::modified");
  }
  // std: library/std/src/fs.rs:2442 accessed
  accessed(): IoResult<SystemTime> {
    return host("std::fs::Metadata::accessed");
  }
  // std: library/std/src/fs.rs:2475 created
  created(): IoResult<SystemTime> {
    return host("std::fs::Metadata::created");
  }
  // impl MetadataExt for fs::Metadata
  // std: library/std/src/os/unix/fs.rs:869 dev
  dev(): bigint {
    return host("std::os::unix::fs::MetadataExt::dev");
  }
  // std: library/std/src/os/unix/fs.rs:872 ino
  ino(): bigint {
    return host("std::os::unix::fs::MetadataExt::ino");
  }
  // std: library/std/src/os/unix/fs.rs:878 nlink
  nlink(): bigint {
    return host("std::os::unix::fs::MetadataExt::nlink");
  }
  // std: library/std/src/os/unix/fs.rs:881 uid
  uid(): number {
    return host("std::os::unix::fs::MetadataExt::uid");
  }
  // std: library/std/src/os/unix/fs.rs:884 gid
  gid(): number {
    return host("std::os::unix::fs::MetadataExt::gid");
  }
  // std: library/std/src/os/unix/fs.rs:911 blksize
  blksize(): bigint {
    return host("std::os::unix::fs::MetadataExt::blksize");
  }
  // std: library/std/src/os/unix/fs.rs:914 blocks
  blocks(): bigint {
    return host("std::os::unix::fs::MetadataExt::blocks");
  }
}

/// Representation of the various timestamps on a file.
export class FileTimes {
  constructor(
    public accessed: SystemTime | undefined,
    public modified: SystemTime | undefined,
  ) {}

  // std: library/std/src/fs.rs:2524 new
  static new(): FileTimes {
    return new FileTimes(undefined, undefined);
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
  // impl PermissionsExt for Permissions
  // std: library/std/src/os/unix/fs.rs:479 mode
  mode(): number {
    return this.mode_;
  }
  // std: library/std/src/os/unix/fs.rs:487 from_mode
  static from_mode(mode: number): Permissions {
    return new Permissions(mode);
  }
}

/// A structure representing a type of file with accessors for each file type.
export class FileType {
  private constructor() {}

  // std: library/std/src/fs.rs:2695 is_dir
  is_dir(): boolean {
    return host("std::fs::FileType::is_dir");
  }
  // std: library/std/src/fs.rs:2728 is_file
  is_file(): boolean {
    return host("std::fs::FileType::is_file");
  }
  // std: library/std/src/fs.rs:2764 is_symlink
  is_symlink(): boolean {
    return host("std::fs::FileType::is_symlink");
  }
  // impl FileTypeExt for fs::FileType
  // std: library/std/src/os/unix/fs.rs:1009 is_block_device
  is_block_device(): boolean {
    return host("std::os::unix::fs::FileTypeExt::is_block_device");
  }
  // std: library/std/src/os/unix/fs.rs:1012 is_char_device
  is_char_device(): boolean {
    return host("std::os::unix::fs::FileTypeExt::is_char_device");
  }
  // std: library/std/src/os/unix/fs.rs:1015 is_fifo
  is_fifo(): boolean {
    return host("std::os::unix::fs::FileTypeExt::is_fifo");
  }
  // std: library/std/src/os/unix/fs.rs:1018 is_socket
  is_socket(): boolean {
    return host("std::os::unix::fs::FileTypeExt::is_socket");
  }
}

/// Iterator over the entries in a directory.
export class ReadDir {
  private constructor() {}

  // impl Iterator for ReadDir
  // std: library/std/src/fs.rs:2804 next
  next(): IoResult<DirEntry> | undefined {
    return host("<std::fs::ReadDir as Iterator>::next");
  }
}

/// Entries returned by the [`ReadDir`] iterator.
export class DirEntry {
  private constructor() {}

  // std: library/std/src/fs.rs:2913 file_type
  file_type(): IoResult<FileType> {
    return host("std::fs::DirEntry::file_type");
  }
  // std: library/std/src/fs.rs:2942 file_name
  file_name(): string {
    return host("std::fs::DirEntry::file_name");
  }
  // impl DirEntryExt for fs::DirEntry
  // std: library/std/src/os/unix/fs.rs:1051 ino
  ino(): bigint {
    return host("std::os::unix::fs::DirEntryExt::ino");
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
  create(_path: string): IoResult<null> {
    return host("std::fs::DirBuilder::create");
  }
  // impl DirBuilderExt for fs::DirBuilder
  // std: library/std/src/os/unix/fs.rs:1133 mode
  mode(mode: number): this {
    this.mode_ = mode;
    return this;
  }
}

// std: library/std/src/fs.rs:477 set_times
export function set_times(_path: string, _times: FileTimes): IoResult<null> {
  return host("std::fs::set_times");
}

// std: library/std/src/fs.rs:518 set_times_nofollow
export function set_times_nofollow(_path: string, _times: FileTimes): IoResult<null> {
  return host("std::fs::set_times_nofollow");
}

// std: library/std/src/fs.rs:3002 remove_file
export function remove_file(_path: string): IoResult<null> {
  return host("std::fs::remove_file");
}

// std: library/std/src/fs.rs:3044 metadata
export function metadata(_path: string): IoResult<Metadata> {
  return host("std::fs::metadata");
}

// std: library/std/src/fs.rs:3085 symlink_metadata
export function symlink_metadata(_path: string): IoResult<Metadata> {
  return host("std::fs::symlink_metadata");
}

// std: library/std/src/fs.rs:3134 rename
export function rename(_from: string, _to: string): IoResult<null> {
  return host("std::fs::rename");
}

// std: library/std/src/fs.rs:3245 hard_link
export function hard_link(_original: string, _link: string): IoResult<null> {
  return host("std::fs::hard_link");
}

// std: library/std/src/fs.rs:3312 read_link
export function read_link(_path: string): IoResult<string> {
  return host("std::fs::read_link");
}

// std: library/std/src/fs.rs:3356 canonicalize
export function canonicalize(_path: string): IoResult<string> {
  return host("std::fs::canonicalize");
}

// std: library/std/src/fs.rs:3491 remove_dir
export function remove_dir(_path: string): IoResult<null> {
  return host("std::fs::remove_dir");
}

// std: library/std/src/fs.rs:3637 read_dir
export function read_dir(_path: string): IoResult<ReadDir> {
  return host("std::fs::read_dir");
}

// std: library/std/src/fs.rs:3689 set_permissions
export function set_permissions(_path: string, _perm: Permissions): IoResult<null> {
  return host("std::fs::set_permissions");
}

/// `std::os::unix::fs::symlink`
// std: library/std/src/os/unix/fs.rs:1107 symlink
export function unix_symlink(_original: string, _link: string): IoResult<null> {
  return host("std::os::unix::fs::symlink");
}

/// `std::path::absolute` (PORT: belongs in src/std/path.ts; see the header).
// std: library/std/src/path.rs:4148 absolute
export function absolute(path: string): IoResult<string> {
  if (path === "") {
    return Err({ $: "SimpleMessage", kind: "InvalidInput", message: "cannot make an empty path absolute" });
  } else {
    return sys_path_absolute(path);
  }
}

/** `Component::as_os_str` (library/std/src/path.rs), on unix. */
function component_as_os_str(c: Component): string {
  switch (c.$) {
    case "Prefix":
      return c.raw;
    case "RootDir":
      return "/";
    case "CurDir":
      return ".";
    case "ParentDir":
      return "..";
    case "Normal":
      return c._0;
  }
}

// std: library/std/src/sys/path/unix.rs:20 absolute
function sys_path_absolute(path: string): IoResult<string> {
  if (process.platform === "win32") return unported("std::sys::path::windows::absolute (std::path::absolute on a Windows host)");
  // This is mostly a wrapper around collecting `Path::components`, with
  // exceptions made where this conflicts with the POSIX specification.
  // See 4.16 Pathname Resolution, IEEE Std 1003.1-2024
  // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html#tag_04_16

  // Get the components, skipping the redundant leading "." component if it exists.
  // PORT: `path.strip_prefix(".")` succeeds exactly when the first component is `.` (`CurDir`).
  const all = path_components(path);
  const first = all.clone().next();
  const components = first !== undefined && first.$ === "CurDir" ? (all.next(), all) : all;
  const path_os = path;

  let normalized: string;
  if (path_is_absolute(path)) {
    // "If a pathname begins with two successive <slash> characters, the
    // first component following the leading <slash> characters may be
    // interpreted in an implementation-defined manner, although more than
    // two leading <slash> characters shall be treated as a single <slash>
    // character."
    if (path_os.startsWith("//") && !path_os.startsWith("///")) {
      components.next();
      normalized = "//";
    } else {
      normalized = "";
    }
  } else {
    // env::current_dir()?  (PORT: the host cwd, D14)
    normalized = process.cwd();
  }
  // normalized.extend(components);
  for (let c = components.next(); c !== undefined; c = components.next()) {
    normalized = path_join(normalized, component_as_os_str(c));
  }

  // "Interfaces using pathname resolution may specify additional constraints
  // when a pathname that does not name an existing directory contains at
  // least one non- <slash> character and contains one or more trailing
  // <slash> characters".
  // A trailing <slash> is also meaningful if "a symbolic link is
  // encountered during pathname resolution".
  if (path_os.endsWith("/")) {
    normalized = path_join(normalized, "");
  }

  return Ok(normalized);
}
