// Fill lane: `miri-shims-d` (plan-m6 wave 37): partly ported by this lane (plan-m6 A3).
// Port of src/tools/miri/src/shims/unix/socket.rs (crate `miri`, plan-m6 D2).
//
// PORT (plan-m6 D2 / A3; harness/scope.json `miri.partial`):
// - Only `socket` (socket.rs:158) is in scope: its isolation-on path (`reject_in_isolation("`socket`", ..)`, then
//   `EACCES`) is what run-pass cases reach, and it is ported in full up to the host socket. With isolation off,
//   `TcpSocket::new` (shims/unix/tcp_socket.rs, `socket2`) is out of scope and stops `unported`.
// - With isolation on no socket file description can exist, so the other socket shims (`bind`, `listen`, `accept4`,
//   `connect`, `send`, `recv`, `setsockopt`, `getsockopt`, `getsockname`, `getpeername`, `shutdown`) and the
//   `UnixSocketFileDescription` trait are not ported: they stop `unported` with the D2 reason (no `rustc:` markers).
// - `socket2::Domain::{IPV4, IPV6}` is the string `"IPV4"` / `"IPV6"` (only passed on to `TcpSocket::new`).
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, Scalar as interp_Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { unported } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `{:#x}` of an `i32`. */
function hex_i32(x: number): string {
  return `0x${(x >>> 0).toString(16)}`;
}

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/socket.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/socket.rs:158
    socket(this: MiriInterpCx, domain: OpTy, type_: OpTy, protocol: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:234
    bind(this: MiriInterpCx, socket: OpTy, address: OpTy, address_len: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:263
    listen(this: MiriInterpCx, socket: OpTy, backlog: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:286
    accept4(this: MiriInterpCx, socket: OpTy, address: OpTy, address_len: OpTy, flags: OpTy | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/socket.rs:374
    connect(this: MiriInterpCx, socket: OpTy, address: OpTy, address_len: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/socket.rs:418
    send(this: MiriInterpCx, socket: OpTy, buffer: OpTy, length: OpTy, flags: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/socket.rs:497
    recv(this: MiriInterpCx, socket: OpTy, buffer: OpTy, length: OpTy, flags: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/socket.rs:589
    setsockopt(this: MiriInterpCx, socket: OpTy, level: OpTy, option_name: OpTy, option_value: OpTy, option_len: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:623
    getsockopt(this: MiriInterpCx, socket: OpTy, level: OpTy, option_name: OpTy, option_value: OpTy, option_len: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:700
    getsockname(this: MiriInterpCx, socket: OpTy, address: OpTy, address_len: OpTy): InterpResult<Scalar>;
    // shims/unix/socket.rs:730
    getpeername(this: MiriInterpCx, socket: OpTy, address: OpTy, address_len: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/socket.rs:781
    shutdown(this: MiriInterpCx, socket: OpTy, how: OpTy): InterpResult<Scalar>;
  }
}

/// For more information on the arguments see the socket manpage:
/// <https://linux.die.net/man/2/socket>
// rustc: src/tools/miri/src/shims/unix/socket.rs:158 socket
InterpCx.prototype.socket = function (this: MiriInterpCx, domain_op: OpTy, type_op: OpTy, protocol_op: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const domain = read_i32(this_, domain_op);
  if (domain.$ === "Err") return domain;
  const flags_r = read_i32(this_, type_op);
  if (flags_r.$ === "Err") return flags_r;
  let flags = flags_r._0;
  const protocol = read_i32(this_, protocol_op);
  if (protocol.$ === "Err") return protocol;

  // Reject if isolation is enabled
  const isolated_op = this_.machine.isolated_op;
  if (isolated_op.$ === "Reject") {
    const reject_with = isolated_op._0;
    const r = this_.reject_in_isolation("`socket`", reject_with);
    if (r.$ === "Err") return r;
    return this_.set_errno_and_return_neg1_i32({ $: "LibcError", _0: "EACCES" });
  }

  let is_non_block = false;

  // Interpret the flag. Every flag we recognize is "subtracted" from `flags`, so
  // if there is anything left at the end, that's an unsupported flag.
  const os = this_.tcx.deref().sess.target.os.$;
  if (os === "Linux" || os === "Android" || os === "FreeBsd" || os === "Solaris" || os === "Illumos") {
    // SOCK_NONBLOCK and SOCK_CLOEXEC only exist on Linux, Android, FreeBSD,
    // Solaris, and Illumos targets.
    const sock_nonblock = this_.eval_libc_i32("SOCK_NONBLOCK");
    const sock_cloexec = this_.eval_libc_i32("SOCK_CLOEXEC");
    if ((flags & sock_nonblock) === sock_nonblock) {
      is_non_block = true;
      flags &= ~sock_nonblock;
    }
    if ((flags & sock_cloexec) === sock_cloexec) {
      // We don't support `exec` so we can ignore this.
      flags &= ~sock_cloexec;
    }
  }

  let family: "IPV4" | "IPV6";
  if (domain._0 === this_.eval_libc_i32("AF_INET")) {
    family = "IPV4";
  } else if (domain._0 === this_.eval_libc_i32("AF_INET6")) {
    family = "IPV6";
  } else {
    return throw_unsup_format(`socket: domain ${hex_i32(domain._0)} is unsupported, only AF_INET and AF_INET6 are allowed.`);
  }

  if (flags !== this_.eval_libc_i32("SOCK_STREAM")) {
    return throw_unsup_format(`socket: type ${hex_i32(flags)} is unsupported, only SOCK_STREAM, SOCK_CLOEXEC and SOCK_NONBLOCK are allowed`);
  }
  if (protocol._0 !== 0 && protocol._0 !== this_.eval_libc_i32("IPPROTO_TCP")) {
    return throw_unsup_format(`socket: socket protocol ${protocol._0} is unsupported, only IPPROTO_TCP and 0 are allowed`);
  }

  // let socket = match TcpSocket::new(family, is_non_block) { .. };
  // let fds = &mut this.machine.fds;
  // let fd = fds.new_ref(socket);
  // interp_ok(Scalar::from_i32(fds.insert(fd)))
  void family;
  void is_non_block;
  return unported("miri::shims::unix::tcp_socket::TcpSocket::new (host sockets with isolation off; plan-m6 D2/A3: sockets are out of scope in M6)");
};

/** The socket shims outside A3's isolation-error path (module header). */
function socket_out_of_scope(name: string): never {
  return unported(`miri::shims::unix::socket::EvalContextExt::${name} (src/tools/miri/src/shims/unix/socket.rs; plan-m6 D2/A3: sockets are out of scope in M6, and with isolation on no socket fd exists)`);
}
InterpCx.prototype.bind = function (): InterpResult<Scalar> {
  return socket_out_of_scope("bind");
};
InterpCx.prototype.listen = function (): InterpResult<Scalar> {
  return socket_out_of_scope("listen");
};
InterpCx.prototype.accept4 = function (): InterpResult {
  return socket_out_of_scope("accept4");
};
InterpCx.prototype.connect = function (): InterpResult {
  return socket_out_of_scope("connect");
};
InterpCx.prototype.send = function (): InterpResult {
  return socket_out_of_scope("send");
};
InterpCx.prototype.recv = function (): InterpResult {
  return socket_out_of_scope("recv");
};
InterpCx.prototype.setsockopt = function (): InterpResult<Scalar> {
  return socket_out_of_scope("setsockopt");
};
InterpCx.prototype.getsockopt = function (): InterpResult<Scalar> {
  return socket_out_of_scope("getsockopt");
};
InterpCx.prototype.getsockname = function (): InterpResult<Scalar> {
  return socket_out_of_scope("getsockname");
};
InterpCx.prototype.getpeername = function (): InterpResult {
  return socket_out_of_scope("getpeername");
};
InterpCx.prototype.shutdown = function (): InterpResult<Scalar> {
  return socket_out_of_scope("shutdown");
};

/** `this.read_scalar(op)?.to_i32()?`. */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0 as Scalar);
}
