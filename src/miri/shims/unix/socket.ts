// Port of src/tools/miri/src/shims/unix/socket.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
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

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// trait UnixSocketFileDescription (shims/unix/socket.rs:16): bind (:18), listen (:30), accept (:44), connect (:55), recv (:71), send (:88), setsockopt (:103), getsockopt (:115), getsockname (:125), getpeername (:134), shutdown (:144)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::socket::EvalContextExt", "src/tools/miri/src/shims/unix/socket.rs", "miri-shims-d", () => InterpCx.prototype, ["socket", "bind", "listen", "accept4", "connect", "send", "recv", "setsockopt", "getsockopt", "getsockname", "getpeername", "shutdown"]);
