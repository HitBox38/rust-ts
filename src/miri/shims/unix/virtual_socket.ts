//! This implements "virtual" sockets, that do not correspond to anything on the host system and
//! are entirely implemented inside Miri.
//! This is used to implement `socketpair` and `pipe`.
// Fill lane: `miri-tail-b` (plan-m6 wave 38; root narrowed D2 for this file, decision "miri-tail scope"): ported by this lane.
// Port of src/tools/miri/src/shims/unix/virtual_socket.rs (crate `miri`). The file is not in the codegen set `miri`, so its
// types and their `#[derive(Debug)]` are hand-written here in the generated shape.
//
// PORT decisions (docs/handoff/miri-tail-b.md):
// - `VecDeque<u8>` is src/std/vec_deque_u8.ts, a model of the real ring buffer (library/alloc/src/collections/vec_deque). The
//   model is needed because `Read for VecDeque<u8>` only reads the front slice, so a read of a wrapped buffer comes back
//   short, and how the buffer wraps depends on the capacity growth, on `handle_capacity_increase`, and on `drain` resetting
//   the head. All of that reaches the program through the return value of `read`.
// - `VirtualSocket` is a hand class; its trait impls are installed on the prototype with `port_methods` (eventfd.ts
//   precedent, PORTING §8), with the provided methods it does not override from `FileDescription_provided` /
//   `UnixFileDescription_provided`. `Cell<_>` / `RefCell<_>` / `OnceCell<_>` fields are the plain fields, and
//   `Rc<DelayedReadinessUpdates>` is the machine's object.
// - The method `peer_fd()` is `peer_fd_()` (the field `peer_fd` exists; mir-contract rule, `active_` precedent).
// - `self: FileDescriptionRef<Self>` methods take a leading `self_` (shims-b's protocol). A `FileDescriptionRef` is one owned
//   strong handle, dropped where Rust drops it: after the return expression, locals before parameters, and moved (not
//   dropped) into `update_fd_readiness`, `callback!` captures, the recursive calls and `delayed_readiness_updates.add`.
// - `Drop for VirtualSocket` plus the field drop glue is `drop_glue()`: `drop()`, then `watched` (the only field whose drop
//   is observable).
// - `impl UnixSocketFileDescription for VirtualSocket` (`send` / `recv`) are prototype methods with a leading `self_`.
//   socket.rs's trait is not ported (socket.ts, partial scope), and its `send` / `recv` shims call these directly;
//   `as_socket` is typed through `Pending<"dyn UnixSocketFileDescription">`, as fd.ts declares it.
import { debug_ThreadId, type ThreadId, type UnblockKind, assert_eq_UnblockKind } from "../../concurrency/thread.ts";
import { VClock, debug_VClock } from "../../concurrency/vector_clock.ts";
import { type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { callback, type DynMachineCallback, type MiriInterpCx } from "../../machine.ts";
import { type VisitProvenanceImpl, VisitProvenance_no_provenance, VisitProvenance_object, VisitProvenance_Pointer } from "../../provenance_gc.ts";
import {
  type DynFileDescriptionRef,
  debug_WeakFileDescriptionRef,
  type FileDescription,
  FileDescription_provided,
  FileDescriptionRef,
  type WeakFileDescriptionRef,
} from "../files.ts";
import { debug_IoError, type IoError, IoError_from_ErrorKind, LibcError } from "../io_error.ts";
import {
  debug_DelayedReadinessUpdates,
  debug_ReadinessWatched,
  type DelayedReadinessUpdates,
  type Readiness,
  Readiness_EMPTY,
  ReadinessUpdateFlags,
  type ReadinessWatched,
  ReadinessWatched_default,
} from "../readiness.ts";
import { shim_varargs, type Varargs } from "../sig.ts";
import { type UnixFileDescription, UnixFileDescription_provided } from "./fd.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, lower_hex_Scalar, Scalar as ScalarNs } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Either } from "../../../rustc_middle/mir/mod.ts";
import { spec } from "../../../rustc_target/lib.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { type Debug, debug_bool, debug_int, debug_list, debug_option, debug_struct, debug_tuple, debug_vec, PRETTY } from "../../../std/fmt.ts";
import { type IoError as io_Error } from "../../../std/io.ts";
import { assert_eq, panic } from "../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { VecDeque_u8 } from "../../../std/vec_deque_u8.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `{:#x}` of an `i32` (two's complement, as Rust's `LowerHex` for signed ints). */
function hex_i32(v: number): string {
  return `0x${(v >>> 0).toString(16)}`;
}
/** `Scalar == Scalar` where `b` is an `eval_libc` integer: a pointer `a` is never equal to it. */
function Scalar_eq_int(a: Scalar, b: Scalar): boolean {
  return a.$ === "Int" && b.$ === "Int" && a._0.size().bytes_u64() === b._0.size().bytes_u64() && a._0.to_bits_unchecked() === b._0.to_bits_unchecked();
}
/** The `VisitProvenance` impl of a captured `FileDescriptionRef<T>` (files.rs:101). */
const VisitProvenance_FileDescriptionRef: VisitProvenanceImpl<FileDescriptionRef<VirtualSocket>> = {
  visit_provenance: (self, visit) => self.visit_provenance(visit),
};

/// The maximum capacity of the socketpair buffer in bytes.
/// This number is arbitrary as the value can always
/// be configured in the real system.
const MAX_SOCKETPAIR_BUFFER_CAPACITY = 0x34000;

/** `#[derive(Debug, PartialEq)] enum VirtualSocketType` */
type VirtualSocketType =
  // Either end of the socketpair fd.
  | "Socketpair"
  // Read end of the pipe.
  | "PipeRead"
  // Write end of the pipe.
  | "PipeWrite";
const debug_VirtualSocketType: Debug<VirtualSocketType> = (v) => v;

// #[derive(Debug)] struct Buffer
class Buffer {
  constructor(
    public buf: VecDeque_u8,
    public clock: VClock,
  ) {}

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:75 new
  static new(): Buffer {
    return new Buffer(new VecDeque_u8(), VClock.default());
  }
}
const debug_Buffer: Debug<Buffer> = (v, f) =>
  debug_struct(f, "Buffer", [
    ["buf", debug_list(f, v.buf.iter().map((b) => debug_int(b, f)))],
    ["clock", debug_VClock(v.clock, f)],
  ]);

/// One end of a pair of connected virtual sockets.
// #[derive(Debug)] struct VirtualSocket
export class VirtualSocket {
  constructor(
    /// The buffer we are reading from, or `None` if this is the writing end of a pipe.
    /// (In that case, the peer FD will be the reading end of that pipe.)
    public readbuf: Buffer | undefined,
    /// The `VirtualSocket` file descriptor that is our "peer", and that holds the buffer we are
    /// writing to. This is a weak reference because the other side may be closed before us; all
    /// future writes will then trigger EPIPE.
    public peer_fd: WeakFileDescriptionRef<VirtualSocket> | undefined,
    /// Indicates whether the peer has lost data when the file description is closed.
    /// This flag is set to `true` if the peer's `readbuf` is non-empty at the time
    /// of closure.
    public peer_lost_data: boolean,
    /// A list of thread ids blocked because the buffer was empty.
    /// Once another thread writes some bytes, these threads will be unblocked.
    public blocked_read_tid: ThreadId[],
    /// A list of thread ids blocked because the buffer was full.
    /// Once another thread reads some bytes, these threads will be unblocked.
    public blocked_write_tid: ThreadId[],
    /// Whether this fd is non-blocking or not.
    public is_nonblock: boolean,
    /// Differentiate between different virtual socket fd types.
    public fd_type: VirtualSocketType,
    /// We need to update the peer_fd readiness when we get dropped, so we keep a reference
    /// to the readiness update queue
    public delayed_readiness_updates: DelayedReadinessUpdates,
    /// State for being watched by epoll.
    public watched: ReadinessWatched,
  ) {}

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:81 peer_fd
  peer_fd_(): WeakFileDescriptionRef<VirtualSocket> {
    const peer_fd = this.peer_fd;
    if (peer_fd === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return peer_fd;
  }

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:87 drop
  drop(): void {
    const peer_fd = this.peer_fd_().upgrade();
    if (peer_fd !== undefined) {
      // If the current readbuf is non-empty when the file description is closed,
      // notify the peer that data lost has happened in current file description.
      if (this.readbuf !== undefined) {
        if (!this.readbuf.buf.is_empty()) {
          peer_fd.deref().peer_lost_data = true;
        }
      }
      // Notify peer fd that close has happened, since that can unblock reads and writes.
      this.delayed_readiness_updates.add(peer_fd as unknown as DynFileDescriptionRef);
    }
  }

  /** Drop glue of `VirtualSocket` (header). */
  drop_glue(): void {
    this.drop();
    this.watched.drop();
  }
}
export interface VirtualSocket extends UnixFileDescription {
  // impl UnixSocketFileDescription for VirtualSocket (`self: FileDescriptionRef<Self>` is `self_`, header)
  // shims/unix/virtual_socket.rs:312
  send(self_: FileDescriptionRef<VirtualSocket>, _communicate_allowed: boolean, ptr: Pointer, len: number, is_non_block: boolean, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/unix/virtual_socket.rs:324
  recv(self_: FileDescriptionRef<VirtualSocket>, _communicate_allowed: boolean, ptr: Pointer, len: number, is_peek: boolean, is_non_block: boolean, ecx: MiriInterpCx, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
}
export const debug_VirtualSocket: Debug<VirtualSocket> = (v, f) =>
  debug_struct(f, "VirtualSocket", [
    ["readbuf", debug_option(v.readbuf, f, (x, f) => debug_struct(f, "RefCell", [["value", debug_Buffer(x, f)]]))],
    ["peer_fd", debug_tuple(f, "OnceCell", [v.peer_fd === undefined ? "<uninit>" : debug_WeakFileDescriptionRef(v.peer_fd, f, debug_VirtualSocket)])],
    ["peer_lost_data", debug_struct(f, "Cell", [["value", debug_bool(v.peer_lost_data, f)]])],
    ["blocked_read_tid", debug_struct(f, "RefCell", [["value", debug_vec(v.blocked_read_tid, f, debug_ThreadId)]])],
    ["blocked_write_tid", debug_struct(f, "RefCell", [["value", debug_vec(v.blocked_write_tid, f, debug_ThreadId)]])],
    ["is_nonblock", debug_struct(f, "Cell", [["value", debug_bool(v.is_nonblock, f)]])],
    ["fd_type", debug_VirtualSocketType(v.fd_type, f)],
    ["delayed_readiness_updates", debug_DelayedReadinessUpdates(v.delayed_readiness_updates, f)],
    ["watched", debug_ReadinessWatched(v.watched, f)],
  ]);

// impl FileDescription for VirtualSocket (the provided methods it does not override are `FileDescription_provided`'s)
port_methods("miri::shims::unix::virtual_socket::FileDescription for VirtualSocket", () => VirtualSocket.prototype, {
  ...FileDescription_provided,

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:103 name
  name(this: VirtualSocket): string {
    switch (this.fd_type) {
      case "Socketpair":
        return "socketpair";
      case "PipeRead":
      case "PipeWrite":
        return "pipe";
    }
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:110 metadata
  metadata(this: VirtualSocket): InterpResult<Either<Result<Pending<"fs::Metadata">, io_Error>, string>> {
    let mode_name: string;
    switch (this.fd_type) {
      case "Socketpair":
        mode_name = "S_IFSOCK";
        break;
      case "PipeRead":
      case "PipeWrite":
        mode_name = "S_IFIFO";
        break;
    }
    return interp_ok({ $: "Right", _0: mode_name });
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:120 read
  read(
    this: VirtualSocket,
    self_: FileDescriptionRef<VirtualSocket>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    return ecx.virtual_socket_read(self_, ptr, len, /* is_non_block */ false, finish);
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:131 write
  write(
    this: VirtualSocket,
    self_: FileDescriptionRef<VirtualSocket>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    return ecx.virtual_socket_write(self_, ptr, len, /* is_non_block */ false, finish);
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:142 short_fd_operations
  short_fd_operations(this: VirtualSocket): boolean {
    // Linux guarantees that when a read/write on a streaming socket comes back short,
    // the kernel buffer is empty/full:
    // See <https://man7.org/linux/man-pages/man7/epoll.7.html> in Q&A section.
    // So we can't do short reads/writes here.
    return false;
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:150 as_unix
  as_unix(this: VirtualSocket, self_: FileDescriptionRef<FileDescription>): FileDescriptionRef<UnixFileDescription> {
    // PORT: the unsizing `FileDescriptionRef<Self> -> FileDescriptionRef<dyn UnixFileDescription>` (a move).
    return self_ as unknown as FileDescriptionRef<UnixFileDescription>;
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:154 readiness_watched
  readiness_watched(this: VirtualSocket): ReadinessWatched | undefined {
    return this.watched;
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:158 readiness
  readiness(this: VirtualSocket): Readiness {
    // We only check the "readable", "writable", "read closed" and "write closed" readiness.
    // If other event flags need to be supported in the future, the check should be added here.

    const readiness = { ...Readiness_EMPTY };

    // Check if it is readable.
    if (this.readbuf !== undefined) {
      if (!this.readbuf.buf.is_empty()) {
        readiness.readable = true;
      }
    } else {
      // Without a read buffer, reading never blocks, so we are always ready.
      readiness.readable = true;
    }

    // Check if is writable.
    const peer_fd = this.peer_fd_().upgrade();
    if (peer_fd !== undefined) {
      const writebuf = peer_fd.deref().readbuf;
      if (writebuf !== undefined) {
        const data_size = writebuf.buf.len;
        const available_space = strict_sub_usize(MAX_SOCKETPAIR_BUFFER_CAPACITY, data_size);
        if (available_space !== 0) {
          readiness.writable = true;
        }
      } else {
        // Without a write buffer, writing never blocks.
        readiness.writable = true;
      }
      peer_fd.drop();
    } else {
      // Peer FD has been closed. This always sets both the "read closed" and "write closed" flags
      // as we do not support `shutdown` that could be used to partially close the stream.
      readiness.read_closed = true;
      readiness.write_closed = true;
      // Since the peer is closed, even if no data is available reads will return EOF and
      // writes will return EPIPE. In other words, they won't block, so we mark this as ready
      // for read and write.
      readiness.readable = true;
      readiness.writable = true;
      // If there is data lost in peer_fd, set error readiness.
      if (this.peer_lost_data) {
        readiness.error = true;
      }
    }
    return readiness;
  },
} satisfies FileDescription & ThisType<VirtualSocket>);

// impl UnixFileDescription for VirtualSocket (the provided methods it does not override are `UnixFileDescription_provided`'s)
port_methods("miri::shims::unix::virtual_socket::UnixFileDescription for VirtualSocket", () => VirtualSocket.prototype, {
  ...UnixFileDescription_provided,

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:206 get_flags
  get_flags(this: VirtualSocket, ecx: MiriInterpCx): InterpResult<Scalar> {
    let flags = 0;

    // Get flag for file access mode.
    // The flag for both socketpair and pipe will remain the same even when the peer
    // fd is closed, so we need to look at the original type of this socket, not at whether
    // the peer socket still exists.
    switch (this.fd_type) {
      case "Socketpair":
        flags |= ecx.eval_libc_i32("O_RDWR");
        break;
      case "PipeRead":
        flags |= ecx.eval_libc_i32("O_RDONLY");
        break;
      case "PipeWrite":
        flags |= ecx.eval_libc_i32("O_WRONLY");
        break;
    }

    // Get flag for blocking status.
    if (this.is_nonblock) {
      flags |= ecx.eval_libc_i32("O_NONBLOCK");
    }

    return interp_ok(ScalarNs.from_i32(flags));
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:233 set_flags
  set_flags(this: VirtualSocket, flag_: number, ecx: MiriInterpCx): InterpResult<Scalar> {
    let flag = flag_;
    const o_nonblock = ecx.eval_libc_i32("O_NONBLOCK");

    // O_NONBLOCK flag can be set / unset by user.
    if ((flag & o_nonblock) === o_nonblock) {
      this.is_nonblock = true;
      flag &= ~o_nonblock;
    } else {
      this.is_nonblock = false;
    }

    // Throw error if there is any unsupported flag.
    if (flag !== 0) {
      return throw_unsup_format("fcntl: only O_NONBLOCK is supported for F_SETFL on socketpairs and pipes");
    }

    return interp_ok(ScalarNs.from_i32(0));
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:258 ioctl
  ioctl(this: VirtualSocket, op: Scalar, args: Varargs, ecx: MiriInterpCx): InterpResult<number> {
    switch (this.fd_type) {
      case "Socketpair":
        /* fall-through to below */
        break;
      case "PipeRead":
      case "PipeWrite":
        // The standard library only uses ioctl for changing the blocking mode
        // of Unix sockets. Thus, since using ioctl isn't the preferred way of
        // changing the blocking mode, we don't support it on pipes.
        return throw_unsup_format("cannot use ioctl on pipe");
    }

    const fionbio = ecx.eval_libc("FIONBIO");

    if (Scalar_eq_int(op, fionbio)) {
      // On these OSes, Rust uses the ioctl, so we trust that it is reasonable and controls
      // the same internal flag as fcntl.
      const os = ecx.tcx.deref().sess.target.os;
      if (!(os.$ === "Linux" || os.$ === "Android" || os.$ === "MacOs" || os.$ === "FreeBsd")) {
        // FIONBIO cannot be used to change the blocking mode of a socket on solarish targets:
        // <https://github.com/rust-lang/rust/commit/dda5c97675b4f5b1f6fdab64606c8a1f21021b0a>
        // Since there might be more targets which do weird things with this option, we use
        // an allowlist instead of just denying solarish targets.
        return throw_unsup_format(`ioctl: setting FIONBIO on sockets is unsupported on target ${spec.Os.display(os)}`);
      }

      // shim_varargs![*i32]
      const c = ecx.check_varargs(shim_varargs("*i32"), args, "ioctl");
      if (c.$ === "Err") return c;
      const value_ptr = c._0[0][0]!;
      const value = ecx.deref_pointer_as(value_ptr, ecx.machine.layouts.i32);
      if (value.$ === "Err") return value;
      const s = ecx.read_scalar(value._0);
      if (s.$ === "Err") return s;
      const i = ScalarNs.to_i32(s._0);
      if (i.$ === "Err") return i;
      const non_block = i._0 !== 0;
      this.is_nonblock = non_block;
      return interp_ok(0);
    }

    return throw_unsup_format(`ioctl: unsupported operation ${lower_hex_Scalar(op, PRETTY)} on socket`);
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:301 as_socket
  as_socket(this: VirtualSocket, self_: FileDescriptionRef<UnixFileDescription>): FileDescriptionRef<Pending<"dyn UnixSocketFileDescription">> | undefined {
    switch (this.fd_type) {
      case "Socketpair":
        return self_ as unknown as FileDescriptionRef<Pending<"dyn UnixSocketFileDescription">>;
      case "PipeRead":
      case "PipeWrite":
        self_.drop();
        return undefined;
    }
  },
} satisfies Partial<UnixFileDescription> & ThisType<VirtualSocket>);

// impl UnixSocketFileDescription for VirtualSocket
port_methods("miri::shims::unix::virtual_socket::UnixSocketFileDescription for VirtualSocket", () => VirtualSocket.prototype, {
  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:312 send
  send(
    this: VirtualSocket,
    self_: FileDescriptionRef<VirtualSocket>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    is_non_block: boolean,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    return ecx.virtual_socket_write(self_, ptr, len, is_non_block, finish);
  },

  // rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:324 recv
  recv(
    this: VirtualSocket,
    self_: FileDescriptionRef<VirtualSocket>,
    _communicate_allowed: boolean,
    ptr: Pointer,
    len: number,
    is_peek: boolean,
    is_non_block: boolean,
    ecx: MiriInterpCx,
    finish: DynMachineCallback<Result<number, IoError>>,
  ): InterpResult {
    if (is_peek) {
      self_.drop();
      return throw_unsup_format("socketpair: virtual sockets don't support peeking");
    }

    return ecx.virtual_socket_read(self_, ptr, len, is_non_block, finish);
  },
});

/** `usize::strict_sub` (`MAX_SOCKETPAIR_BUFFER_CAPACITY` bounds every buffer, so this never panics in a real run). */
function strict_sub_usize(a: number, b: number): number {
  if (b > a) panic("attempt to subtract with overflow");
  return a - b;
}

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/virtual_socket.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/virtual_socket.rs:349
    virtual_socket_write(this: MiriInterpCx, socket: FileDescriptionRef<VirtualSocket>, ptr: Pointer, len: number, is_non_block: boolean, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
    // shims/unix/virtual_socket.rs:442
    virtual_socket_read(this: MiriInterpCx, socket: FileDescriptionRef<VirtualSocket>, ptr: Pointer, len: number, is_non_block: boolean, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
    // ---- shims/unix/virtual_socket.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/virtual_socket.rs:551
    socketpair(this: MiriInterpCx, domain: OpTy, type_: OpTy, protocol: OpTy, sv: OpTy): InterpResult<Scalar>;
    // shims/unix/virtual_socket.rs:651
    pipe2(this: MiriInterpCx, pipefd: OpTy, flags: OpTy | undefined): InterpResult<Scalar>;
  }
}

/// Attempt two write `len` bytes from the buffer pointed to by `ptr` into the
/// virtual socket `socket`.
/// `is_non_block` specifies whether the operation should be performed as if the
/// socket was non-blocking.
/// After a successful write, `finish` is called with the amount of bytes written.
// rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:349 virtual_socket_write
InterpCx.prototype.virtual_socket_write = function (
  this: MiriInterpCx,
  socket: FileDescriptionRef<VirtualSocket>,
  ptr: Pointer,
  len: number,
  is_non_block: boolean,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Always succeed on write size 0.
  // ("If count is zero and fd refers to a file other than a regular file, the results are not specified.")
  if (len === 0) {
    const r = finish.call(this_, Ok(0));
    socket.drop();
    return r;
  }

  // We are writing to our peer's readbuf.
  const peer_fd = socket.deref().peer_fd_().upgrade();
  if (peer_fd === undefined) {
    // If the upgrade from Weak to Rc fails, it indicates that all read ends have been
    // closed. It is an error to write even if there would be space.
    const r = finish.call(this_, Err(IoError_from_ErrorKind("BrokenPipe")));
    socket.drop();
    return r;
  }

  const writebuf = peer_fd.deref().readbuf;
  if (writebuf === undefined) {
    // Writing to the read end of a pipe.
    const r = finish.call(this_, Err(LibcError("EBADF")));
    peer_fd.drop();
    socket.drop();
    return r;
  }

  // Let's see if we can write.
  const available_space = strict_sub_usize(MAX_SOCKETPAIR_BUFFER_CAPACITY, writebuf.buf.len);
  if (available_space === 0) {
    if (socket.deref().is_nonblock || is_non_block) {
      // Non-blocking socketpair with a full buffer.
      const r = finish.call(this_, Err(IoError_from_ErrorKind("WouldBlock")));
      peer_fd.drop();
      socket.drop();
      return r;
    } else {
      socket.deref().blocked_write_tid.push(this_.active_thread());
      this_.block_thread(
        { $: "VirtualSocket" },
        undefined,
        // callback!(@capture<'tcx> { socket: FileDescriptionRef<VirtualSocket>, ptr: Pointer, len: usize,
        //     is_non_block: bool, finish: DynMachineCallback<'tcx, Result<usize, IoError>> }
        //     |this, unblock: UnblockKind| { .. })
        callback<{ socket: FileDescriptionRef<VirtualSocket>; ptr: Pointer; len: number; is_non_block: boolean; finish: DynMachineCallback<Result<number, IoError>> }, UnblockKind>(
          {
            socket: [socket, VisitProvenance_FileDescriptionRef],
            ptr: [ptr, VisitProvenance_Pointer],
            len: [len, VisitProvenance_no_provenance],
            is_non_block: [is_non_block, VisitProvenance_no_provenance],
            finish: [finish, VisitProvenance_object],
          },
          (this_, unblock, { socket, ptr, len, is_non_block, finish }) => {
            assert_eq_UnblockKind(unblock, "Ready");
            return this_.virtual_socket_write(socket, ptr, len, is_non_block, finish);
          },
        ),
      );
    }
  } else {
    // There is space to write!
    // Remember this clock so `read` can synchronize with us.
    const rc = this_.release_clock((clock) => {
      writebuf.clock.join(clock);
    });
    if (rc.$ === "Err") {
      peer_fd.drop();
      socket.drop();
      return rc;
    }
    // Do full write / partial write based on the space available.
    const write_size = Math.min(len, available_space);
    const w = this_.write_to_host(writebuf.buf, write_size, ptr);
    if (w.$ === "Err") {
      peer_fd.drop();
      socket.drop();
      return w;
    }
    const actual_write_size = unwrap_result(w._0, debug_IoError);
    assert_eq(actual_write_size, write_size, String);

    // Need to stop accessing peer_fd so that it can be notified.

    // Unblock all threads that are currently blocked on peer_fd's read.
    const peer = peer_fd.deref();
    const waiting_threads = peer.blocked_read_tid;
    peer.blocked_read_tid = [];
    // FIXME: We can randomize the order of unblocking.
    for (const thread_id of waiting_threads) {
      const u = this_.unblock_thread(thread_id, { $: "VirtualSocket" });
      if (u.$ === "Err") {
        peer_fd.drop();
        socket.drop();
        return u;
      }
    }
    // Notify readiness watchers: we might be no longer writable, peer might now be readable.
    // The notification to the peer seems to be always sent on Linux, even if the
    // FD was readable before.
    const up0 = this_.update_fd_readiness(socket as unknown as DynFileDescriptionRef, ReadinessUpdateFlags.DEFAULT);
    if (up0.$ === "Err") {
      peer_fd.drop();
      return up0;
    }
    const up1 = this_.update_fd_readiness(peer_fd as unknown as DynFileDescriptionRef, ReadinessUpdateFlags.FORCE_EDGE);
    if (up1.$ === "Err") return up1;

    return finish.call(this_, Ok(write_size));
  }
  peer_fd.drop();
  return interp_ok(undefined);
};

/// Attempt to read `len` bytes from the virtual socket `socket` into the buffer
/// pointed to by `ptr`.
/// `is_non_block` specifies whether the operation should be performed as if the
/// socket was non-blocking.
/// After a successful read, `finish` is called with the amount of bytes read.
// rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:442 virtual_socket_read
InterpCx.prototype.virtual_socket_read = function (
  this: MiriInterpCx,
  socket: FileDescriptionRef<VirtualSocket>,
  ptr: Pointer,
  len: number,
  is_non_block: boolean,
  finish: DynMachineCallback<Result<number, IoError>>,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Always succeed on read size 0.
  if (len === 0) {
    const r = finish.call(this_, Ok(0));
    socket.drop();
    return r;
  }

  const readbuf = socket.deref().readbuf;
  if (readbuf === undefined) {
    // FIXME: This should return EBADF, but there's no nice way to do that as there's no
    // corresponding ErrorKind variant.
    socket.drop();
    return throw_unsup_format("reading from the write end of a pipe");
  }

  if (readbuf.buf.is_empty()) {
    const peer = socket.deref().peer_fd_().upgrade();
    const peer_is_none = peer === undefined;
    if (peer !== undefined) peer.drop(); // the temporary of the `if` condition
    if (peer_is_none) {
      // Socketpair with no peer and empty buffer.
      // 0 bytes successfully read indicates end-of-file.
      const r = finish.call(this_, Ok(0));
      socket.drop();
      return r;
    } else if (socket.deref().is_nonblock || is_non_block) {
      // Non-blocking socketpair with writer and empty buffer.
      // https://linux.die.net/man/2/read
      // EAGAIN or EWOULDBLOCK can be returned for socket,
      // POSIX.1-2001 allows either error to be returned for this case.
      // Since there is no ErrorKind for EAGAIN, WouldBlock is used.
      const r = finish.call(this_, Err(IoError_from_ErrorKind("WouldBlock")));
      socket.drop();
      return r;
    } else {
      socket.deref().blocked_read_tid.push(this_.active_thread());
      this_.block_thread(
        { $: "VirtualSocket" },
        undefined,
        // callback!(@capture<'tcx> { socket: FileDescriptionRef<VirtualSocket>, ptr: Pointer, len: usize,
        //     is_non_block: bool, finish: DynMachineCallback<'tcx, Result<usize, IoError>> }
        //     |this, unblock: UnblockKind| { .. })
        callback<{ socket: FileDescriptionRef<VirtualSocket>; ptr: Pointer; len: number; is_non_block: boolean; finish: DynMachineCallback<Result<number, IoError>> }, UnblockKind>(
          {
            socket: [socket, VisitProvenance_FileDescriptionRef],
            ptr: [ptr, VisitProvenance_Pointer],
            len: [len, VisitProvenance_no_provenance],
            is_non_block: [is_non_block, VisitProvenance_no_provenance],
            finish: [finish, VisitProvenance_object],
          },
          (this_, unblock, { socket, ptr, len, is_non_block, finish }) => {
            assert_eq_UnblockKind(unblock, "Ready");
            return this_.virtual_socket_read(socket, ptr, len, is_non_block, finish);
          },
        ),
      );
    }
  } else {
    // There's data to be read!
    // Synchronize with all previous writes to this buffer.
    // FIXME: this over-synchronizes; a more precise approach would be to
    // only sync with the writes whose data we will read.
    const a = this_.acquire_clock(readbuf.clock);
    if (a.$ === "Err") {
      socket.drop();
      return a;
    }

    // Do full read / partial read based on the space available.
    // Conveniently, `read` exists on `VecDeque` and has exactly the desired behavior.
    const r = this_.read_from_host((buf) => readbuf.buf.read(buf), len, ptr);
    if (r.$ === "Err") {
      socket.drop();
      return r;
    }
    const read_size = unwrap_result(r._0, debug_IoError);
    const readbuf_now_empty = readbuf.buf.is_empty();

    // Need to drop before others can access the readbuf again.

    // A notification should be provided for the peer file description even when it can
    // only write 1 byte. This implementation is not compliant with the actual Linux kernel
    // implementation. For optimization reasons, the kernel will only mark the file description
    // as "writable" when it can write more than a certain number of bytes. Since we
    // don't know what that *certain number* is, we will provide a notification every time
    // a read is successful. This might result in our readiness emulation providing more
    // events than the real system.
    const peer_fd = socket.deref().peer_fd_().upgrade();
    if (peer_fd !== undefined) {
      // Unblock all threads that are currently blocked on peer_fd's write.
      const peer = peer_fd.deref();
      const waiting_threads = peer.blocked_write_tid;
      peer.blocked_write_tid = [];
      // FIXME: We can randomize the order of unblocking.
      for (const thread_id of waiting_threads) {
        const u = this_.unblock_thread(thread_id, { $: "VirtualSocket" });
        if (u.$ === "Err") {
          peer_fd.drop();
          socket.drop();
          return u;
        }
      }
      // Notify readiness watchers: peer is now writable.
      // Linux seems to always notify the peer if the read buffer is now empty.
      // (Linux also does that if this was a "big" read, but to avoid some arbitrary
      // threshold, we do not match that.)
      const up = this_.update_fd_readiness(peer_fd as unknown as DynFileDescriptionRef, readbuf_now_empty ? ReadinessUpdateFlags.FORCE_EDGE : ReadinessUpdateFlags.DEFAULT);
      if (up.$ === "Err") {
        socket.drop();
        return up;
      }
    }
    // Notify readiness watchers: we might be no longer readable.
    const up = this_.update_fd_readiness(socket as unknown as DynFileDescriptionRef, ReadinessUpdateFlags.DEFAULT);
    if (up.$ === "Err") return up;

    return finish.call(this_, Ok(read_size));
  }
  return interp_ok(undefined);
};

/// For more information on the arguments see the socketpair manpage:
/// <https://linux.die.net/man/2/socketpair>
// rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:551 socketpair
InterpCx.prototype.socketpair = function (this: MiriInterpCx, domain_op: OpTy, type_op: OpTy, protocol_op: OpTy, sv_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const domain = read_i32(this_, domain_op);
  if (domain.$ === "Err") return domain;
  const flags_r = read_i32(this_, type_op);
  if (flags_r.$ === "Err") return flags_r;
  let flags = flags_r._0;
  const protocol = read_i32(this_, protocol_op);
  if (protocol.$ === "Err") return protocol;
  // This is really a pointer to `[i32; 2]` but we use a ptr-to-first-element representation.
  const sv_r = this_.deref_pointer_as(sv_op, this_.machine.layouts.i32);
  if (sv_r.$ === "Err") return sv_r;
  const sv = sv_r._0;

  let is_sock_nonblock = false;

  // Interpret the flag. Every flag we recognize is "subtracted" from `flags`, so
  // if there is anything left at the end, that's an unsupported flag.
  const os = this_.tcx.deref().sess.target.os.$;
  if (os === "Linux" || os === "Android" || os === "FreeBsd" || os === "Solaris" || os === "Illumos") {
    // SOCK_NONBLOCK and SOCK_CLOEXEC only exist on Linux, Android, FreeBSD,
    // Solaris, and Illumos targets.
    const sock_nonblock = this_.eval_libc_i32("SOCK_NONBLOCK");
    const sock_cloexec = this_.eval_libc_i32("SOCK_CLOEXEC");
    if ((flags & sock_nonblock) === sock_nonblock) {
      is_sock_nonblock = true;
      flags &= ~sock_nonblock;
    }
    if ((flags & sock_cloexec) === sock_cloexec) {
      flags &= ~sock_cloexec;
    }
  }

  // Fail on unsupported input.
  // AF_UNIX and AF_LOCAL are synonyms, so we accept both in case
  // their values differ.
  if (domain._0 !== this_.eval_libc_i32("AF_UNIX") && domain._0 !== this_.eval_libc_i32("AF_LOCAL")) {
    return throw_unsup_format(`socketpair: domain ${hex_i32(domain._0)} is unsupported, only AF_UNIX and AF_LOCAL are allowed`);
  } else if (flags !== this_.eval_libc_i32("SOCK_STREAM")) {
    return throw_unsup_format(`socketpair: type ${hex_i32(flags)} is unsupported, only SOCK_STREAM, SOCK_CLOEXEC and SOCK_NONBLOCK are allowed`);
  } else if (protocol._0 !== 0) {
    return throw_unsup_format(`socketpair: socket protocol ${protocol._0} is unsupported, only 0 is allowed`);
  }

  // Generate file descriptions.
  const fds = this_.machine.fds;
  const fd0 = fds.new_ref(
    new VirtualSocket(
      Buffer.new(),
      undefined,
      false,
      [],
      [],
      is_sock_nonblock,
      "Socketpair",
      this_.machine.delayed_readiness_updates,
      ReadinessWatched_default(),
    ),
  );
  const fd1 = fds.new_ref(
    new VirtualSocket(
      Buffer.new(),
      undefined,
      false,
      [],
      [],
      is_sock_nonblock,
      "Socketpair",
      this_.machine.delayed_readiness_updates,
      ReadinessWatched_default(),
    ),
  );

  // Make the file descriptions point to each other.
  // PORT: `OnceCell::set(..).unwrap()` on fresh cells: it cannot fail.
  fd0.deref().peer_fd = FileDescriptionRef.downgrade(fd1);
  fd1.deref().peer_fd = FileDescriptionRef.downgrade(fd0);

  // Insert the file description to the fd table, generating the file descriptors.
  const sv0_ = fds.insert(fd0 as unknown as DynFileDescriptionRef);
  const sv1_ = fds.insert(fd1 as unknown as DynFileDescriptionRef);

  // Return socketpair file descriptors to the caller.
  const sv0 = ScalarNs.from_int(BigInt(sv0_), sv.layout.size) as Scalar;
  const sv1 = ScalarNs.from_int(BigInt(sv1_), sv.layout.size) as Scalar;
  const w0 = this_.write_scalar(sv0, sv);
  if (w0.$ === "Err") return w0;
  const sv_1 = sv.offset(sv.layout.size, sv.layout, this_ as never);
  if (sv_1.$ === "Err") return sv_1;
  const w1 = this_.write_scalar(sv1, sv_1._0);
  if (w1.$ === "Err") return w1;

  return interp_ok(ScalarNs.from_i32(0));
};

// rustc: src/tools/miri/src/shims/unix/virtual_socket.rs:651 pipe2
InterpCx.prototype.pipe2 = function (this: MiriInterpCx, pipefd_op: OpTy, flags_op: OpTy | undefined): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const pipefd_r = this_.deref_pointer_as(pipefd_op, this_.machine.layouts.i32);
  if (pipefd_r.$ === "Err") return pipefd_r;
  const pipefd = pipefd_r._0;
  let flags: number;
  if (flags_op !== undefined) {
    const f = read_i32(this_, flags_op);
    if (f.$ === "Err") return f;
    flags = f._0;
  } else {
    flags = 0;
  }

  const cloexec = this_.eval_libc_i32("O_CLOEXEC");
  const o_nonblock = this_.eval_libc_i32("O_NONBLOCK");

  // Interpret the flag. Every flag we recognize is "subtracted" from `flags`, so
  // if there is anything left at the end, that's an unsupported flag.
  let is_nonblock = false;
  if ((flags & o_nonblock) === o_nonblock) {
    is_nonblock = true;
    flags &= ~o_nonblock;
  }
  // As usual we ignore CLOEXEC.
  if ((flags & cloexec) === cloexec) {
    flags &= ~cloexec;
  }
  if (flags !== 0) {
    return throw_unsup_format("unsupported flags in `pipe2`");
  }

  // Generate file descriptions.
  // pipefd[0] refers to the read end of the pipe.
  const fds = this_.machine.fds;
  const fd0 = fds.new_ref(
    new VirtualSocket(
      Buffer.new(),
      undefined,
      false,
      [],
      [],
      is_nonblock,
      "PipeRead",
      this_.machine.delayed_readiness_updates,
      ReadinessWatched_default(),
    ),
  );
  const fd1 = fds.new_ref(
    new VirtualSocket(
      undefined,
      undefined,
      false,
      [],
      [],
      is_nonblock,
      "PipeWrite",
      this_.machine.delayed_readiness_updates,
      ReadinessWatched_default(),
    ),
  );

  // Make the file descriptions point to each other.
  // PORT: `OnceCell::set(..).unwrap()` on fresh cells: it cannot fail.
  fd0.deref().peer_fd = FileDescriptionRef.downgrade(fd1);
  fd1.deref().peer_fd = FileDescriptionRef.downgrade(fd0);

  // Insert the file description to the fd table, generating the file descriptors.
  const pipefd0_ = fds.insert(fd0 as unknown as DynFileDescriptionRef);
  const pipefd1_ = fds.insert(fd1 as unknown as DynFileDescriptionRef);

  // Return file descriptors to the caller.
  const pipefd0 = ScalarNs.from_int(BigInt(pipefd0_), pipefd.layout.size) as Scalar;
  const pipefd1 = ScalarNs.from_int(BigInt(pipefd1_), pipefd.layout.size) as Scalar;
  const w0 = this_.write_scalar(pipefd0, pipefd);
  if (w0.$ === "Err") return w0;
  const pipefd_1 = pipefd.offset(pipefd.layout.size, pipefd.layout, this_ as never);
  if (pipefd_1.$ === "Err") return pipefd_1;
  const w1 = this_.write_scalar(pipefd1, pipefd_1._0);
  if (w1.$ === "Err") return w1;

  return interp_ok(ScalarNs.from_i32(0));
};

/** `this.read_scalar(op)?.to_i32()?`. */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return ScalarNs.to_i32(s._0);
}
