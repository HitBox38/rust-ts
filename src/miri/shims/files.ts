// Port of src/tools/miri/src/shims/files.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
// Its types are generated into files.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (representations; docs/handoff/miri-shims-b.md has the contract for other lanes):
// - `FileDescriptionRef<T>(Rc<FdIdWith<T>>)`: each `FileDescriptionRef` object is ONE owned strong handle of a shared
//   `FdIdWith<T>` box. The strong count lives in `RC_STRONG` (keyed by the box). Rust's implicit operations are explicit:
//   `clone()` makes another handle (+1), `drop()` releases this one (-1; a second `drop()` or any use of a released handle
//   panics), passing a handle by value moves it (the callee owns it). When the count reaches 0 the inner value's
//   `drop_in_place` runs: its optional `drop_glue()` (the type's `Drop` impl plus its fields' drop glue). The count is
//   only observable through `WeakFileDescriptionRef::{upgrade, is_closed}` and the drop glue.
// - `WeakFileDescriptionRef<T>(Weak<FdIdWith<T>>)`: holds the same box (`_0`, typed `Pending1<"std::rc::Weak", ..>` by the
//   generator, so it is cast here); `upgrade` makes a new strong handle while the count is > 0.
// - `fn ...(self: FileDescriptionRef<Self>, ..)` trait methods (`read`, `write`, `as_unix`) take the handle as a leading
//   `self_` parameter; `this` is the inner description. Call sites write `fd.deref().read(fd, ..)`.
// - `FileDescriptionRef<dyn FileDescription>::downcast::<T>` takes an exact type test `is_T` (`Rc<dyn Any>::downcast`).
// - `FdTable.fds` is a `BTreeMap`; the generated `Map` is not key-ordered, so ordered walks sort the keys.
// - Host I/O (D14): stdin / stdout / stderr are the host's fds 0 / 1 / 2 through `node:fs` (`readSync` / `writeSync`, one
//   read(2) / write(2) each), with std's buffering on top (`Stdin`'s `BufReader`, `Stdout`'s `LineWriter`), see
//   `HostStdin` / `HostStdout` / `HostStderr` below. `std::fs::File` / `Dir` (FileHandle / DirHandle, isolation off) stop
//   `unported` (miri-fs, plan-m6 D14).
import { readSync, writeSync } from "node:fs";
import { isatty } from "node:tty";
import { type Pointer } from "../lib.ts";
import { type DynMachineCallback, type MiriInterpCx } from "../machine.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { type DirHandle, type DynFileDescriptionRef, FdId, type FdIdWith, type FdNum, FdTable, type FileHandle, FileDescriptionRef, NullOutput, Stderr, Stdin, Stdout, WeakFileDescriptionRef } from "./files.gen.ts";
import { HostError, type IoError, IoError_from_ErrorKind, LibcError } from "./io_error.ts";
import { type Readiness, Readiness_EMPTY, type ReadinessWatched, ReadinessWatched_default } from "./readiness.ts";
import { type UnixFileDescription } from "./unix/fd.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Either } from "../../rustc_middle/mir/mod.ts";
import { type Pending, type Pending1 } from "../../rustc_type_ir/decls.ts";
import { debug_IoError as debug_io_Error, handle_ebadf, io_error_from_node, type IoError as io_Error, type IoResult, type SeekFrom } from "../../std/io.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
export * from "./files.gen.ts";

/** PORT(C10): helpers.ts assigns `MiriMachine.prototype` methods at load (helpers.ts:1297-1328), so a module that
 *  machine.ts imports cannot import helpers.ts statically (helpers would run before machine.ts defines `MiriMachine`);
 *  it is read on first use instead (everything is loaded by then: src/miri/lib.ts). */
function helpers(): typeof import("../helpers.ts") {
  return require("../helpers.ts") as typeof import("../helpers.ts");
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `impl io::Write` / `impl io::Read` of a host handle (the subset `read_from_host` / `write_to_host` call). */
export interface HostWrite {
  write(buf: Uint8Array): IoResult<number>;
}

// ---- Rc / Weak (header) ----

/** Strong counts of the shared `FdIdWith` boxes (`Rc::strong_count`). */
const RC_STRONG = new WeakMap<object, { strong: number }>();
/** Handles that were dropped or moved out (`into_rc_any`, `downcast`); using one again panics. */
const RELEASED = new WeakSet<object>();

function rc_count(box: object): { strong: number } {
  const c = RC_STRONG.get(box);
  if (c === undefined) return panic("FileDescriptionRef: not an Rc box");
  return c;
}

function check_live(r: FileDescriptionRef<unknown>): void {
  if (RELEASED.has(r)) panic("FileDescriptionRef: use of a dropped or moved handle");
}

/** `Rc::new(FdIdWith { id, inner })` wrapped in `FileDescriptionRef` (files.rs:609). */
function rc_new<T>(value: FdIdWith<T>): FileDescriptionRef<T> {
  RC_STRONG.set(value, { strong: 1 });
  return new FileDescriptionRef(value);
}

/** `drop_in_place::<FdIdWith<T>>`: the inner value's drop glue, if its type has one (header). */
function drop_in_place_inner(inner: unknown): void {
  const glue = (inner as { drop_glue?: () => void }).drop_glue;
  if (typeof glue === "function") glue.call(inner);
}

/** A `FileDescription` implementor's drop glue (header): the type's `Drop` impl and its fields' drop glue. */
export interface DropGlue {
  drop_glue?(): void;
}

// ---- manual impls the generated modules call ----

// rustc: src/tools/miri/src/shims/files.rs:78 clone
/** `impl Clone for WeakFileDescriptionRef` (`Weak::clone`: the same box, no strong count change). */
export function clone_WeakFileDescriptionRef<T>(v: WeakFileDescriptionRef<T>, _clone_T: (v: T) => T): WeakFileDescriptionRef<T> {
  return new WeakFileDescriptionRef<T>(v._0);
}

/** Represents an open file description. (`trait FileDescription: std::fmt::Debug + FileDescriptionExt`; the provided
 *  methods are `FileDescription_provided`'s, which an implementor copies for the ones it does not override.) */
export interface FileDescription extends DropGlue {
  // rustc: src/tools/miri/src/shims/files.rs:132 name
  name(): string;
  /// Reads as much as possible into the given buffer `ptr`.
  /// `len` indicates how many bytes we should try to read.
  ///
  /// When the read is done, `finish` will be called. Note that `read` itself may return before
  /// that happens! Everything that should happen "after" the `read` needs to happen inside
  /// `finish`.
  // shims/files.rs:140 (provided) // self: FileDescriptionRef<Self> (`self_`, header)
  read(self_: FileDescriptionRef<FileDescription>, communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  /// Writes as much as possible from the given buffer `ptr`.
  /// `len` indicates how many bytes we should try to write.
  ///
  /// When the write is done, `finish` will be called. Note that `write` itself may return before
  /// that happens! Everything that should happen "after" the `write` needs to happen inside
  /// `finish`.
  // shims/files.rs:157 (provided) // self: FileDescriptionRef<Self> (`self_`, header)
  write(self_: FileDescriptionRef<FileDescription>, communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  /// Determines whether this FD non-deterministically has its reads and writes shortened.
  // shims/files.rs:169 (provided)
  short_fd_operations(): boolean;
  /// Seeks to the given offset (which can be relative to the beginning, end, or current position).
  /// Returns the new position from the start of the stream.
  // shims/files.rs:176 (provided)
  seek(communicate_allowed: boolean, offset: SeekFrom): InterpResult<Result<bigint, io_Error>>;
  /// Returns the metadata for this FD, if available.
  /// This is either host metadata, or a non-file-backed-FD type.
  /// The latter is for now represented as a string storing the `libc` name of the mode so we only
  /// support that kind of metadata on Unix targets.
  // shims/files.rs:188 (provided)
  metadata(): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>>;
  // shims/files.rs:192 (provided)
  is_tty(communicate_allowed: boolean): boolean;
  /// Converts this FD into a unix file description. Must succeed for all FD types that can be
  /// created on Unix targets!
  // shims/files.rs:200 (provided) // self: FileDescriptionRef<Self> (`self_`, header)
  as_unix(self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription>;
  /// Get the `ReadinessWatched` of the file description.
  // shims/files.rs:205 (provided)
  readiness_watched(): ReadinessWatched | undefined;
  /// Get the current I/O readiness of the file description.
  // shims/files.rs:210 (provided)
  readiness(): Readiness;
}

/** The provided methods of `trait FileDescription` (PORTING §8); `this` is the description. */
export const FileDescription_provided = {
  // rustc: src/tools/miri/src/shims/files.rs:140 read
  read(this: FileDescription, _self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    return throw_unsup_format(`cannot read from ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/files.rs:157 write
  write(this: FileDescription, _self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    return throw_unsup_format(`cannot write to ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/files.rs:169 short_fd_operations
  short_fd_operations(this: FileDescription): boolean {
    // We only enable this for FD kinds where we think short accesses gain useful test coverage.
    return false;
  },

  // rustc: src/tools/miri/src/shims/files.rs:176 seek
  seek(this: FileDescription, _communicate_allowed: boolean, _offset: SeekFrom): InterpResult<Result<bigint, io_Error>> {
    return throw_unsup_format(`cannot seek on ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/files.rs:188 metadata
  metadata(this: FileDescription): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    return throw_unsup_format("obtaining metadata is only supported on file-backed file descriptors");
  },

  // rustc: src/tools/miri/src/shims/files.rs:192 is_tty
  is_tty(this: FileDescription, _communicate_allowed: boolean): boolean {
    // Most FDs are not tty's and the consequence of a wrong `false` are minor,
    // so we use a default impl here.
    return false;
  },

  // rustc: src/tools/miri/src/shims/files.rs:200 as_unix
  as_unix(this: FileDescription, _self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    return panic(`Not a unix file description: ${this.name()}`);
  },

  // rustc: src/tools/miri/src/shims/files.rs:205 readiness_watched
  readiness_watched(this: FileDescription): ReadinessWatched | undefined {
    return undefined;
  },

  // rustc: src/tools/miri/src/shims/files.rs:210 readiness
  readiness(this: FileDescription): Readiness {
    return panic(`FD type ${this.name()} implements \`readiness_watched\` but not \`readiness\``);
  },
};

/** PORT: the `UnixFileDescription` impls of the stdio types are in shims/unix/fd.rs:102-105 (lane miri-shims-d), which
 *  give them only provided methods; the unsizing `FileDescriptionRef<Self> -> FileDescriptionRef<dyn UnixFileDescription>`
 *  is this cast. */
function as_dyn_unix<T>(self_: FileDescriptionRef<T>): FileDescriptionRef<UnixFileDescription> {
  return self_ as unknown as FileDescriptionRef<UnixFileDescription>;
}

// ---- host stdio (D14; header) ----

/** The capacity of `io::stdin()`'s `BufReader` (`STDIN_BUF_SIZE = DEFAULT_BUF_SIZE`, library/std/src/sys/io/mod.rs: 8 KiB). */
const STDIN_BUF_SIZE = 8 * 1024;
/** The capacity of `io::stdout()`'s `LineWriter` (`LineWriter::new`: 1024, library/std/src/io/buffered/linewriter.rs). */
const STDOUT_BUF_SIZE = 1024;

/** `write(2)` of the whole of `buf` at most once on host fd `fd` (`FileDesc::write`, library/std/src/sys/fd/unix.rs).
 *  PORT: `EAGAIN` is retried (Bun may leave a pipe non-blocking, which std's stdio never is; src/std/io.ts does the same). */
function host_write(fd: number, buf: Uint8Array): IoResult<number> {
  for (;;) {
    try {
      return Ok(writeSync(fd, buf, 0, buf.length));
    } catch (e) {
      if ((e as { code?: string }).code === "EAGAIN") continue;
      return Err(io_error_from_node(e));
    }
  }
}

/** `read(2)` into `buf` once on host fd `fd` (`FileDesc::read`). PORT: `EAGAIN` is retried (see `host_write`). */
function host_read(fd: number, buf: Uint8Array): IoResult<number> {
  for (;;) {
    try {
      return Ok(readSync(fd, buf, 0, buf.length, null));
    } catch (e) {
      if ((e as { code?: string }).code === "EAGAIN") continue;
      return Err(io_error_from_node(e));
    }
  }
}

/** `StdoutRaw::write` / `StderrRaw::write` (library/std/src/io/stdio.rs): `handle_ebadf(self.0.write(buf), || Ok(buf.len()))`. */
function raw_write(fd: number, buf: Uint8Array): IoResult<number> {
  return handle_ebadf(host_write(fd, buf), () => Ok(buf.length));
}

/** `io::stdin()`: a `BufReader<StdinRaw>` (library/std/src/io/stdio.rs; `BufReader::read`, library/std/src/io/buffered/bufreader.rs). */
class HostStdinImpl {
  private buf = new Uint8Array(STDIN_BUF_SIZE);
  private pos = 0;
  private filled = 0;

  /** `StdinRaw::read`: `handle_ebadf(self.0.read(buf), || Ok(0))`. */
  private raw_read(buf: Uint8Array): IoResult<number> {
    return handle_ebadf(host_read(0, buf), () => Ok(0));
  }

  /** `<&Stdin as Read>::read` → `BufReader::read`. */
  read(out: Uint8Array): IoResult<number> {
    // If we don't have any buffered data and we're doing a massive read
    // (larger than our internal buffer), bypass our internal buffer
    // entirely.
    if (this.pos === this.filled && out.length >= this.buf.length) {
      this.pos = 0;
      this.filled = 0;
      return this.raw_read(out);
    }
    // fill_buf
    if (this.pos >= this.filled) {
      const r = this.raw_read(this.buf);
      if (r.$ === "Err") return r;
      this.pos = 0;
      this.filled = r._0;
    }
    const nread = Math.min(this.filled - this.pos, out.length);
    out.set(this.buf.subarray(this.pos, this.pos + nread));
    this.pos += nread;
    return Ok(nread);
  }

  is_terminal(): boolean {
    return isatty(0);
  }
}

/** `io::stdout()`: a `LineWriter<StdoutRaw>` (`LineWriterShim::write`, library/std/src/io/buffered/linewritershim.rs).
 *  PORT: the buffer is empty whenever Miri calls `write`, because files.rs flushes after every write and a failed flush
 *  panics (`.unwrap()`); so `write` + `flush` start from an empty buffer. */
class HostStdoutImpl implements HostWrite {
  private buffered: Uint8Array = new Uint8Array(0);

  /** `<&Stdout as Write>::write` */
  write(buf: Uint8Array): IoResult<number> {
    assert(this.buffered.length === 0, "HostStdout: write with a non-empty buffer (header)");
    const newline_idx = buf.lastIndexOf(0x0a);
    if (newline_idx < 0) {
      // No newline: `flush_if_completed_line` (empty buffer: nothing), then `BufWriter::write`.
      if (buf.length < STDOUT_BUF_SIZE) {
        this.buffered = buf.slice();
        return Ok(buf.length);
      }
      // `buf.len() >= self.capacity()`: write straight through.
      return raw_write(1, buf);
    }
    const end = newline_idx + 1;
    // `self.buffer.flush_buf()?` (empty), then write the lines directly.
    const lines = buf.subarray(0, end);
    const flushed_r = raw_write(1, lines);
    if (flushed_r.$ === "Err") return flushed_r;
    const flushed = flushed_r._0;
    if (flushed === 0) return Ok(0);
    let tail: Uint8Array;
    if (flushed >= end) {
      tail = buf.subarray(flushed);
      // Avoid unnecessary short writes by not splitting the remaining bytes if they're larger than the buffer
      // (library/alloc/src/io/buffered/linewritershim.rs:199): they are written in full by the next call.
      if (tail.length >= STDOUT_BUF_SIZE) return Ok(flushed);
    } else if (end - flushed <= STDOUT_BUF_SIZE) {
      tail = buf.subarray(flushed, end);
    } else {
      const scan_area = buf.subarray(flushed).subarray(0, STDOUT_BUF_SIZE);
      const nl = scan_area.lastIndexOf(0x0a);
      tail = nl >= 0 ? scan_area.subarray(0, nl + 1) : scan_area;
    }
    // `write_to_buf`: as much of `tail` as fits.
    const buffered = Math.min(tail.length, STDOUT_BUF_SIZE);
    this.buffered = tail.slice(0, buffered);
    return Ok(flushed + buffered);
  }

  /** `io::stdout().flush()` → `BufWriter::flush_buf` (library/std/src/io/buffered/bufwriter.rs) + `StdoutRaw::flush`. */
  flush(): IoResult<null> {
    let written = 0;
    const buf = this.buffered;
    while (written < buf.length) {
      const r = raw_write(1, buf.subarray(written));
      if (r.$ === "Err") {
        this.buffered = buf.slice(written);
        return r;
      }
      if (r._0 === 0) {
        this.buffered = buf.slice(written);
        return Err({ $: "SimpleMessage", kind: "WriteZero", message: "failed to write the buffered data" });
      }
      written += r._0;
    }
    this.buffered = new Uint8Array(0);
    return Ok(null);
  }

  is_terminal(): boolean {
    return isatty(1);
  }
}

/** `io::stderr()`: unbuffered `StderrRaw`. */
class HostStderrImpl implements HostWrite {
  /** `<&Stderr as Write>::write` */
  write(buf: Uint8Array): IoResult<number> {
    return raw_write(2, buf);
  }

  is_terminal(): boolean {
    return isatty(2);
  }
}

/** The process-wide std handles (`io::stdin()` & co. return handles to these). */
const HOST_STDIN = new HostStdinImpl();
const HOST_STDOUT = new HostStdoutImpl();
const HOST_STDERR = new HostStderrImpl();

/** PORT: the generated field types are `Pending<"std::io::Stdin">` & co. (typemap); the values are the host handles above. */
function host<T>(p: unknown): T {
  return p as T;
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/files.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/files.rs:666
    read_from_host(this: MiriInterpCx, read_cb: (buf: Uint8Array) => Result<number, io_Error>, len: number, ptr: Pointer): InterpResult<Result<number, IoError>>;
    // shims/files.rs:689 (`file: impl io::Write`)
    write_to_host(this: MiriInterpCx, file: HostWrite, len: number, ptr: Pointer): InterpResult<Result<number, IoError>>;
  }
}

declare module "./files.gen.ts" {
  interface FdId {
    // shims/files.rs:23
    to_usize(): number;
  }
  namespace FdId {
    // shims/files.rs:28
    export let new_unchecked: (id: number) => FdId;
  }
}
declare module "./files.gen.ts" {
  interface FileDescriptionRef<T> {
    /** `Clone` (files.rs:47): a new strong handle (header). */
    clone(): FileDescriptionRef<T>;
    /** `Deref` (files.rs:54): the description. */
    deref(): T;
    // shims/files.rs:60
    id(): FdId;
    /** `PartialEq` (files.rs:66): same file description id. */
    eq(other: FileDescriptionRef<T>): boolean;
    /** `Drop` of the handle (header): releases this strong handle. */
    drop(): void;
    /** `VisitProvenance` (files.rs:102). */
    visit_provenance(visit: VisitWith): void;
    /** `FileDescriptionExt::into_rc_any` (files.rs:111): moves this handle out as an untyped one. */
    into_rc_any(): FileDescriptionRef<unknown>;
    // shims/files.rs:124 (`T: FileDescription + 'static`: an exact type test; consumes this handle, header)
    downcast<U>(is_T: (v: FileDescription) => v is FileDescription & U): FileDescriptionRef<U> | undefined;
  }
  namespace FileDescriptionRef {
    // shims/files.rs:84
    export let downgrade: <T>(this_: FileDescriptionRef<T>) => WeakFileDescriptionRef<T>;
  }
}
declare module "./files.gen.ts" {
  interface WeakFileDescriptionRef<T> {
    // shims/files.rs:90
    upgrade(): FileDescriptionRef<T> | undefined;
    // shims/files.rs:96
    is_closed(): boolean;
  }
}
declare module "./files.gen.ts" {
  interface Stdin extends FileDescription {}
  namespace Stdin {
    // shims/files.rs:222
    function new_(): Stdin;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  interface Stdout extends FileDescription {}
  namespace Stdout {
    // shims/files.rs:279
    function new_(): Stdout;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  interface Stderr extends FileDescription {}
  namespace Stderr {
    // shims/files.rs:336
    function new_(): Stderr;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  interface NullOutput extends FileDescription {}
  namespace NullOutput {
    // shims/files.rs:387
    function new_(): NullOutput;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  interface FdTable {
    /** `VisitProvenance` (files.rs:585). */
    visit_provenance(visit: VisitWith): void;
    // shims/files.rs:607
    new_ref<T extends FileDescription>(fd: T): FileDescriptionRef<T>;
    // shims/files.rs:615
    insert_new(fd: FileDescription): FdNum;
    // shims/files.rs:621
    insert(fd_ref: DynFileDescriptionRef): FdNum;
    // shims/files.rs:626
    insert_with_min_num(file_handle: DynFileDescriptionRef, min_fd_num: FdNum): FdNum;
    // shims/files.rs:648
    get(fd_num: FdNum): DynFileDescriptionRef | undefined;
    // shims/files.rs:653
    remove(fd_num: FdNum): DynFileDescriptionRef | undefined;
    // shims/files.rs:657
    is_fd_num(fd_num: FdNum): boolean;
  }
  namespace FdTable {
    // shims/files.rs:591
    function new_(): FdTable;
    export { new_ as new };
    // shims/files.rs:594
    export let init: (mute_stdout_stderr: boolean) => FdTable;
  }
}

// rustc: src/tools/miri/src/shims/files.rs:23 to_usize
FdId.prototype.to_usize = function (this: FdId): number {
  return this._0;
};

/// Create a new fd id from a `usize` without checking if this fd exists.
// rustc: src/tools/miri/src/shims/files.rs:28 new_unchecked
FdId.new_unchecked = function (id: number): FdId {
  return new FdId(id);
};

// rustc: src/tools/miri/src/shims/files.rs:47 clone
FileDescriptionRef.prototype.clone = function <T>(this: FileDescriptionRef<T>): FileDescriptionRef<T> {
  check_live(this);
  rc_count(this._0).strong += 1;
  return new FileDescriptionRef(this._0);
};

// rustc: src/tools/miri/src/shims/files.rs:54 deref
FileDescriptionRef.prototype.deref = function <T>(this: FileDescriptionRef<T>): T {
  check_live(this);
  return this._0.inner;
};

// rustc: src/tools/miri/src/shims/files.rs:60 id
FileDescriptionRef.prototype.id = function <T>(this: FileDescriptionRef<T>): FdId {
  check_live(this);
  return this._0.id;
};

// rustc: src/tools/miri/src/shims/files.rs:66 eq
FileDescriptionRef.prototype.eq = function <T>(this: FileDescriptionRef<T>, other: FileDescriptionRef<T>): boolean {
  return this._0.id._0 === other._0.id._0;
};

// impl<T: ?Sized> Eq for FileDescriptionRef<T> {}

/** The handle's drop (header): `Rc::drop`; the last strong handle runs the description's drop glue. */
FileDescriptionRef.prototype.drop = function <T>(this: FileDescriptionRef<T>): void {
  check_live(this);
  RELEASED.add(this);
  const c = rc_count(this._0);
  c.strong -= 1;
  if (c.strong === 0) drop_in_place_inner(this._0.inner);
};

// rustc: src/tools/miri/src/shims/files.rs:84 downgrade
FileDescriptionRef.downgrade = function <T>(this_: FileDescriptionRef<T>): WeakFileDescriptionRef<T> {
  check_live(this_);
  return new WeakFileDescriptionRef<T>(this_._0 as unknown as Pending1<"std::rc::Weak", FdIdWith<T>>);
};

// rustc: src/tools/miri/src/shims/files.rs:90 upgrade
WeakFileDescriptionRef.prototype.upgrade = function <T>(this: WeakFileDescriptionRef<T>): FileDescriptionRef<T> | undefined {
  const box = this._0 as unknown as FdIdWith<T>;
  const c = rc_count(box);
  if (c.strong === 0) return undefined;
  c.strong += 1;
  return new FileDescriptionRef(box);
};

/// Returns whether the file description that this weak reference points to
/// has been closed, i.e., there are no more strong references.
// rustc: src/tools/miri/src/shims/files.rs:96 is_closed
WeakFileDescriptionRef.prototype.is_closed = function <T>(this: WeakFileDescriptionRef<T>): boolean {
  return rc_count(this._0 as unknown as object).strong === 0;
};

// rustc: src/tools/miri/src/shims/files.rs:102 visit_provenance
FileDescriptionRef.prototype.visit_provenance = function <T>(this: FileDescriptionRef<T>, _visit: VisitWith): void {
  // All our FileDescription instances do not have any provenance.
};

/// A helper trait to indirectly allow downcasting on `Rc<FdIdWith<dyn _>>`.
/// Ideally we'd just add a `FdIdWith<Self>: Any` bound to the `FileDescription` trait,
/// but that does not allow upcasting.
/** `trait FileDescriptionExt: 'static` (files.rs:110); its only impl is the blanket one below, a method of
 *  `FileDescriptionRef` (`self: FileDescriptionRef<Self>`). */
export interface FileDescriptionExt {
  // rustc: src/tools/miri/src/shims/files.rs:111 into_rc_any
  into_rc_any(): FileDescriptionRef<unknown>;
}
// rustc: src/tools/miri/src/shims/files.rs:115 into_rc_any
FileDescriptionRef.prototype.into_rc_any = function <T>(this: FileDescriptionRef<T>): FileDescriptionRef<unknown> {
  check_live(this);
  // `self.0`: the same `Rc`, moved out of this handle.
  RELEASED.add(this);
  return new FileDescriptionRef<unknown>(this._0);
};

// rustc: src/tools/miri/src/shims/files.rs:124 downcast
FileDescriptionRef.prototype.downcast = function <U>(this: FileDescriptionRef<FileDescription>, is_T: (v: FileDescription) => v is FileDescription & U): FileDescriptionRef<U> | undefined {
  const inner = this.into_rc_any();
  // `.downcast::<FdIdWith<T>>().ok()?`: on failure the `Rc` is dropped.
  if (!is_T(inner._0.inner as FileDescription)) {
    inner.drop();
    return undefined;
  }
  return inner as FileDescriptionRef<U>;
};

// rustc: src/tools/miri/src/shims/files.rs:222 new
(Stdin as unknown as { new: () => Stdin }).new = function (): Stdin {
  return new Stdin(host<Pending<"std::io::Stdin">>(HOST_STDIN), ReadinessWatched_default());
};

// rustc: src/tools/miri/src/shims/files.rs:228 name
Stdin.prototype.name = function (this: Stdin): string {
  return "stdin";
};

// rustc: src/tools/miri/src/shims/files.rs:232 read
Stdin.prototype.read = function (this: Stdin, self_: FileDescriptionRef<FileDescription>, communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  if (!communicate_allowed) {
    // We want isolation mode to be deterministic, so we have to disallow all reads, even stdin.
    const r = helpers().isolation_abort_error("`read` from stdin");
    if (r.$ === "Err") return r;
  }

  // FIXME: this can block on the host, halting the entire interpreter.
  const stdin = host<HostStdinImpl>((self_.deref() as Stdin).stdin);
  const result = ecx.read_from_host((buf) => stdin.read(buf), len, ptr);
  self_.drop();
  if (result.$ === "Err") return result;
  return finish.call(ecx, result._0);
};

// rustc: src/tools/miri/src/shims/files.rs:250 is_tty
Stdin.prototype.is_tty = function (this: Stdin, communicate_allowed: boolean): boolean {
  return communicate_allowed && host<HostStdinImpl>(this.stdin).is_terminal();
};

// rustc: src/tools/miri/src/shims/files.rs:254 readiness_watched
Stdin.prototype.readiness_watched = function (this: Stdin): ReadinessWatched | undefined {
  return this.watched;
};

// rustc: src/tools/miri/src/shims/files.rs:258 readiness
Stdin.prototype.readiness = function (this: Stdin): Readiness {
  // Stdin is readable (we never return EWOULDBLOCK above) and also writable (since that never
  // blocks either). This matches what we see on Linux.
  const readiness = { ...Readiness_EMPTY };
  readiness.readable = true;
  readiness.writable = true;
  return readiness;
};

// rustc: src/tools/miri/src/shims/files.rs:267 as_unix
Stdin.prototype.as_unix = function (this: Stdin, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
  return as_dyn_unix(self_);
};

Stdin.prototype.write = FileDescription_provided.write;
Stdin.prototype.short_fd_operations = FileDescription_provided.short_fd_operations;
Stdin.prototype.seek = FileDescription_provided.seek;
Stdin.prototype.metadata = FileDescription_provided.metadata;
/** Drop glue of `Stdin` (header): `io::Stdin` has none, `ReadinessWatched` has a `Drop`. */
Stdin.prototype.drop_glue = function (this: Stdin): void {
  this.watched.drop();
};

// rustc: src/tools/miri/src/shims/files.rs:279 new
(Stdout as unknown as { new: () => Stdout }).new = function (): Stdout {
  return new Stdout(host<Pending<"std::io::Stdout">>(HOST_STDOUT), ReadinessWatched_default());
};

// rustc: src/tools/miri/src/shims/files.rs:285 name
Stdout.prototype.name = function (this: Stdout): string {
  return "stdout";
};

// rustc: src/tools/miri/src/shims/files.rs:289 write
Stdout.prototype.write = function (this: Stdout, self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  // We allow writing to stdout even with isolation enabled.
  const result = ecx.write_to_host(host<HostStdoutImpl>((self_.deref() as Stdout).stdout), len, ptr);
  self_.drop();
  if (result.$ === "Err") return result;
  // Stdout is buffered, flush to make sure it appears on the
  // screen.  This is the write() syscall of the interpreted
  // program, we want it to correspond to a write() syscall on
  // the host -- there is no good in adding extra buffering
  // here.
  const fl = HOST_STDOUT.flush();
  if (fl.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_io_error_plain(fl._0)}`);

  return finish.call(ecx, result._0);
};

// rustc: src/tools/miri/src/shims/files.rs:309 is_tty
Stdout.prototype.is_tty = function (this: Stdout, communicate_allowed: boolean): boolean {
  return communicate_allowed && host<HostStdoutImpl>(this.stdout).is_terminal();
};

// rustc: src/tools/miri/src/shims/files.rs:313 readiness_watched
Stdout.prototype.readiness_watched = function (this: Stdout): ReadinessWatched | undefined {
  return this.watched;
};

// rustc: src/tools/miri/src/shims/files.rs:317 readiness
Stdout.prototype.readiness = function (this: Stdout): Readiness {
  // stdout can always be written (we never return EWOULDBLOCK there) and never be read.
  const readiness = { ...Readiness_EMPTY };
  readiness.writable = true;
  return readiness;
};

// rustc: src/tools/miri/src/shims/files.rs:324 as_unix
Stdout.prototype.as_unix = function (this: Stdout, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
  return as_dyn_unix(self_);
};

Stdout.prototype.read = FileDescription_provided.read;
Stdout.prototype.short_fd_operations = FileDescription_provided.short_fd_operations;
Stdout.prototype.seek = FileDescription_provided.seek;
Stdout.prototype.metadata = FileDescription_provided.metadata;
/** Drop glue of `Stdout` (header). */
Stdout.prototype.drop_glue = function (this: Stdout): void {
  this.watched.drop();
};

// rustc: src/tools/miri/src/shims/files.rs:336 new
(Stderr as unknown as { new: () => Stderr }).new = function (): Stderr {
  return new Stderr(host<Pending<"std::io::Stderr">>(HOST_STDERR), ReadinessWatched_default());
};

// rustc: src/tools/miri/src/shims/files.rs:342 name
Stderr.prototype.name = function (this: Stderr): string {
  return "stderr";
};

// rustc: src/tools/miri/src/shims/files.rs:346 write
Stderr.prototype.write = function (this: Stderr, self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  // We allow writing to stderr even with isolation enabled.
  const result = ecx.write_to_host(host<HostStderrImpl>((self_.deref() as Stderr).stderr), len, ptr);
  self_.drop();
  if (result.$ === "Err") return result;
  // No need to flush, stderr is not buffered.
  return finish.call(ecx, result._0);
};

// rustc: src/tools/miri/src/shims/files.rs:360 is_tty
Stderr.prototype.is_tty = function (this: Stderr, communicate_allowed: boolean): boolean {
  return communicate_allowed && host<HostStderrImpl>(this.stderr).is_terminal();
};

// rustc: src/tools/miri/src/shims/files.rs:364 readiness_watched
Stderr.prototype.readiness_watched = function (this: Stderr): ReadinessWatched | undefined {
  return this.watched;
};

// rustc: src/tools/miri/src/shims/files.rs:368 readiness
Stderr.prototype.readiness = function (this: Stderr): Readiness {
  // stderr can always be written (we never return EWOULDBLOCK there) and never be read.
  const readiness = { ...Readiness_EMPTY };
  readiness.writable = true;
  return readiness;
};

// rustc: src/tools/miri/src/shims/files.rs:375 as_unix
Stderr.prototype.as_unix = function (this: Stderr, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
  return as_dyn_unix(self_);
};

Stderr.prototype.read = FileDescription_provided.read;
Stderr.prototype.short_fd_operations = FileDescription_provided.short_fd_operations;
Stderr.prototype.seek = FileDescription_provided.seek;
Stderr.prototype.metadata = FileDescription_provided.metadata;
/** Drop glue of `Stderr` (header). */
Stderr.prototype.drop_glue = function (this: Stderr): void {
  this.watched.drop();
};

// rustc: src/tools/miri/src/shims/files.rs:387 new
(NullOutput as unknown as { new: () => NullOutput }).new = function (): NullOutput {
  return new NullOutput(ReadinessWatched_default());
};

// rustc: src/tools/miri/src/shims/files.rs:393 name
NullOutput.prototype.name = function (this: NullOutput): string {
  return "null output";
};

// rustc: src/tools/miri/src/shims/files.rs:397 write
NullOutput.prototype.write = function (this: NullOutput, self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, _ptr: Pointer, len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
  self_.drop();
  // We just don't write anything, but report to the user that we did.
  return finish.call(ecx, Ok(len));
};

// rustc: src/tools/miri/src/shims/files.rs:409 readiness_watched
NullOutput.prototype.readiness_watched = function (this: NullOutput): ReadinessWatched | undefined {
  return this.watched;
};

// rustc: src/tools/miri/src/shims/files.rs:413 readiness
NullOutput.prototype.readiness = function (this: NullOutput): Readiness {
  // null output can always be written (we never return EWOULDBLOCK there) and never be read.
  const readiness = { ...Readiness_EMPTY };
  readiness.writable = true;
  return readiness;
};

// rustc: src/tools/miri/src/shims/files.rs:420 as_unix
NullOutput.prototype.as_unix = function (this: NullOutput, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
  return as_dyn_unix(self_);
};

NullOutput.prototype.read = FileDescription_provided.read;
NullOutput.prototype.short_fd_operations = FileDescription_provided.short_fd_operations;
NullOutput.prototype.seek = FileDescription_provided.seek;
NullOutput.prototype.metadata = FileDescription_provided.metadata;
NullOutput.prototype.is_tty = FileDescription_provided.is_tty;
/** Drop glue of `NullOutput` (header). */
NullOutput.prototype.drop_glue = function (this: NullOutput): void {
  this.watched.drop();
};

/** `{:?}` of an `io::Error` for an `unwrap` panic. */
function debug_io_error_plain(e: io_Error): string {
  return debug_io_Error(e, PLAIN);
}

/** `impl FileDescription for FileHandle` (files.rs:432). `FileHandle` is a generated interface (lane miri-fs builds the
 *  values); the impl is this table, which miri-fs installs on its values. `file` is a host `std::fs::File` (isolation off,
 *  D14): every host access stops `unported` until src/std has a `File` stand-in. */
export const FileDescription_FileHandle = {
  // rustc: src/tools/miri/src/shims/files.rs:433 name
  name(this: FileHandle): string {
    return "file";
  },

  // rustc: src/tools/miri/src/shims/files.rs:437 read
  read(this: FileHandle, self_: FileDescriptionRef<FileDescription>, communicate_allowed: boolean, _ptr: Pointer, _len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    assert(communicate_allowed, "isolation should have prevented even opening a file");

    if (!(self_.deref() as unknown as FileHandle).readable) {
      // Unix returns EBADF, Windows something that translates to `PermissionDenied`.
      const err = ecx.target_os_is_unix() ? LibcError("EBADF") : IoError_from_ErrorKind("PermissionDenied");
      self_.drop();
      return finish.call(ecx, Err(err));
    }

    // let mut file = &self.file;
    // let result = ecx.read_from_host(|buf| file.read(buf), len, ptr)?;
    // finish.call(ecx, result)
    return unported("std::fs::File::read (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:462 write
  write(this: FileHandle, self_: FileDescriptionRef<FileDescription>, communicate_allowed: boolean, _ptr: Pointer, _len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    assert(communicate_allowed, "isolation should have prevented even opening a file");

    if (!(self_.deref() as unknown as FileHandle).writable) {
      // Unix returns EBADF, Windows something that translates to `PermissionDenied`.
      const err = ecx.target_os_is_unix() ? LibcError("EBADF") : IoError_from_ErrorKind("PermissionDenied");
      self_.drop();
      return finish.call(ecx, Err(err));
    }
    // let result = ecx.write_to_host(&self.file, len, ptr)?;
    // finish.call(ecx, result)
    return unported("std::fs::File::write (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:485 seek
  seek(this: FileHandle, communicate_allowed: boolean, _offset: SeekFrom): InterpResult<Result<bigint, io_Error>> {
    assert(communicate_allowed, "isolation should have prevented even opening a file");
    // interp_ok((&mut &self.file).seek(offset))
    return unported("std::fs::File::seek (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:494 metadata
  metadata(this: FileHandle): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    // interp_ok(Either::Left(self.file.metadata()))
    return unported("std::fs::File::metadata (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:498 is_tty
  is_tty(this: FileHandle, communicate_allowed: boolean): boolean {
    // communicate_allowed && self.file.is_terminal()
    if (!communicate_allowed) return false;
    return unported("std::fs::File::is_terminal (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:502 short_fd_operations
  short_fd_operations(this: FileHandle): boolean {
    // While short accesses on file-backed FDs are very rare (at least for sufficiently small
    // accesses), they can realistically happen when a signal interrupts the syscall.
    // FIXME: we should return `false` if this is a named pipe...
    return true;
  },

  // rustc: src/tools/miri/src/shims/files.rs:509 as_unix
  as_unix(this: FileHandle, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    return as_dyn_unix(self_);
  },
};

/** `impl FileDescription for DirHandle` (files.rs:521): a table like `FileDescription_FileHandle`. */
export const FileDescription_DirHandle = {
  // rustc: src/tools/miri/src/shims/files.rs:522 name
  name(this: DirHandle): string {
    return "directory";
  },

  // rustc: src/tools/miri/src/shims/files.rs:526 metadata
  metadata(this: DirHandle): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    // #[cfg(not(bootstrap))]
    // return interp_ok(Either::Left(self.dir.self_metadata()));
    return unported("std::fs::Dir::self_metadata (host file I/O, isolation off; plan-m6 D14)");
  },

  // rustc: src/tools/miri/src/shims/files.rs:535 read
  read(this: DirHandle, self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, _ptr: Pointer, _len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    self_.drop();
    if (ecx.target_os_is_unix()) {
      return finish.call(ecx, Err(LibcError("EISDIR")));
    } else {
      // No idea what this should do on Windows.
      return throw_unsup_format("reading directories is not supported on this target");
    }
  },

  // rustc: src/tools/miri/src/shims/files.rs:551 write
  write(this: DirHandle, self_: FileDescriptionRef<FileDescription>, _communicate_allowed: boolean, _ptr: Pointer, _len: number, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult {
    self_.drop();
    if (ecx.target_os_is_unix()) {
      // Directories are opened for reading, so writing returns EBADF.
      return finish.call(ecx, Err(LibcError("EBADF")));
    } else {
      // No idea what this should do on Windows.
      return throw_unsup_format("writing directories is not supported on this target");
    }
  },

  // rustc: src/tools/miri/src/shims/files.rs:568 as_unix
  as_unix(this: DirHandle, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    return as_dyn_unix(self_);
  },
};

// rustc: src/tools/miri/src/shims/files.rs:585 visit_provenance
FdTable.prototype.visit_provenance = function (this: FdTable, _visit: VisitWith): void {
  // All our FileDescription instances do not have any provenance.
};

// rustc: src/tools/miri/src/shims/files.rs:591 new
(FdTable as unknown as { new: () => FdTable }).new = function (): FdTable {
  return new FdTable(new Map(), new FdId(0));
};

// rustc: src/tools/miri/src/shims/files.rs:594 init
FdTable.init = function (mute_stdout_stderr: boolean): FdTable {
  const fds = FdTable.new();
  fds.insert_new(Stdin.new());
  if (mute_stdout_stderr) {
    assert_eq(fds.insert_new(NullOutput.new()), 1, String);
    assert_eq(fds.insert_new(NullOutput.new()), 2, String);
  } else {
    assert_eq(fds.insert_new(Stdout.new()), 1, String);
    assert_eq(fds.insert_new(Stderr.new()), 2, String);
  }
  return fds;
};

// rustc: src/tools/miri/src/shims/files.rs:607 new_ref
FdTable.prototype.new_ref = function <T extends FileDescription>(this: FdTable, fd: T): FileDescriptionRef<T> {
  const file_handle = rc_new({ id: this.next_file_description_id, inner: fd });
  this.next_file_description_id = new FdId(strict_add_usize(this.next_file_description_id._0, 1));
  return file_handle;
};

/// Insert a new file description to the FdTable.
// rustc: src/tools/miri/src/shims/files.rs:615 insert_new
FdTable.prototype.insert_new = function (this: FdTable, fd: FileDescription): FdNum {
  const fd_ref = this.new_ref(fd);
  return this.insert(fd_ref);
};

/// Insert an alias to an existing file description to the FdTable.
// rustc: src/tools/miri/src/shims/files.rs:621 insert
FdTable.prototype.insert = function (this: FdTable, fd_ref: DynFileDescriptionRef): FdNum {
  return this.insert_with_min_num(fd_ref, 0);
};

/// Insert a file description, giving it a file descriptor that is at least `min_fd_num`.
// rustc: src/tools/miri/src/shims/files.rs:626 insert_with_min_num
FdTable.prototype.insert_with_min_num = function (this: FdTable, file_handle: DynFileDescriptionRef, min_fd_num: FdNum): FdNum {
  let candidate = min_fd_num;
  // `self.fds.range(min_fd_num..)`: the keys in order (header).
  const keys = [...this.fds.keys()].filter((k) => k >= min_fd_num).sort((a, b) => a - b);
  for (const fd_num of keys) {
    if (fd_num === candidate) {
      // This one is taken. Try the next one.
      candidate = strict_add_i32(candidate, 1);
    } else {
      // We found a gap! Use this candidate.
      break;
    }
  }
  // If we exhaust the loop, the table is a solid block starting at `min_fd_num` until the
  // end, and `candidate` is now the first number after that block -- exactly what we need.

  // self.fds.try_insert(candidate, file_handle).unwrap();
  // `unwrap` would print the `OccupiedError`'s real Debug (key, old and new value): not ported, so stop rather than
  // print an invented text (unreachable: `candidate` is the first free number by construction).
  if (this.fds.has(candidate)) unported("FdTable::insert_with_min_num: `unwrap` panic text (Debug of OccupiedError)");
  this.fds.set(candidate, file_handle);
  return candidate;
};

// rustc: src/tools/miri/src/shims/files.rs:648 get
FdTable.prototype.get = function (this: FdTable, fd_num: FdNum): DynFileDescriptionRef | undefined {
  const fd = this.fds.get(fd_num);
  if (fd === undefined) return undefined;
  return fd.clone();
};

// rustc: src/tools/miri/src/shims/files.rs:653 remove
FdTable.prototype.remove = function (this: FdTable, fd_num: FdNum): DynFileDescriptionRef | undefined {
  const fd = this.fds.get(fd_num);
  this.fds.delete(fd_num);
  return fd;
};

// rustc: src/tools/miri/src/shims/files.rs:657 is_fd_num
FdTable.prototype.is_fd_num = function (this: FdTable, fd_num: FdNum): boolean {
  return this.fds.has(fd_num);
};

/** `i32::strict_add` */
function strict_add_i32(a: number, b: number): number {
  const r = a + b;
  if (r > 0x7fffffff || r < -0x80000000) panic("attempt to add with overflow");
  return r;
}

/** `usize::strict_add` (64-bit target usize; ids stay far below 2^53). */
function strict_add_usize(a: number, b: number): number {
  return a + b;
}

/// Read data from a host `Read` type, store the result into machine memory,
/// and return whether that worked.
// rustc: src/tools/miri/src/shims/files.rs:666 read_from_host
InterpCx.prototype.read_from_host = function (this: MiriInterpCx, read_cb: (buf: Uint8Array) => Result<number, io_Error>, len: number, ptr: Pointer): InterpResult<Result<number, IoError>> {
  const this_ = this.eval_context_mut();

  const bytes = new Uint8Array(len);
  const result = read_cb(bytes);
  switch (result.$) {
    case "Ok": {
      const read_size = result._0;
      // If reading to `bytes` did not fail, we write those bytes to the buffer.
      // Crucially, if fewer than `bytes.len()` bytes were read, only write
      // that much into the output buffer!
      const w = this_.write_bytes_ptr(ptr, bytes.subarray(0, read_size).values());
      if (w.$ === "Err") return w;
      return interp_ok(Ok(read_size));
    }
    case "Err":
      return interp_ok(Err(HostError(result._0)));
  }
};

/// Write data to a host `Write` type, with the bytes taken from machine memory.
// rustc: src/tools/miri/src/shims/files.rs:689 write_to_host
InterpCx.prototype.write_to_host = function (this: MiriInterpCx, file: HostWrite, len: number, ptr: Pointer): InterpResult<Result<number, IoError>> {
  const this_ = this.eval_context_mut();

  const bytes = this_.read_bytes_ptr_strip_provenance(ptr, Size.from_bytes(len));
  if (bytes.$ === "Err") return bytes;
  const result = file.write(bytes._0);
  return interp_ok(result.$ === "Ok" ? result : Err(HostError(result._0)));
};

/// Open something for which we don't know ahead of time whether it is a file or a directory.
///
/// Note that on Windows hosts, `custom_flags` is ignored if `root` is `Some`!
// rustc: src/tools/miri/src/shims/files.rs:706 open_file_or_dir
export function open_file_or_dir(_root: Pending<"fs::Dir"> | undefined, _path: string, _opts: Pending<"fs::OpenOptions">): Result<Either<Pending<"fs::File">, Pending<"fs::Dir">>, io_Error> {
  // On Unix, `open`/`openat` works for files and directories.
  // On Windows, that fails with `PermissionDenied`, so we need to open an `fs::Dir` instead.
  // (But that may succeed even on a file! So we still have to check the metadata.)
  return unported("miri::shims::files::open_file_or_dir (host std::fs, isolation off; plan-m6 D14)");
}
