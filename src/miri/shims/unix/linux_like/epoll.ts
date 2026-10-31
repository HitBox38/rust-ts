// Port of src/tools/miri/src/shims/unix/linux_like/epoll.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-e` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into epoll.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Scalar } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import { type FileDescriptionRef } from "../../files.ts";
import { type Readiness } from "../../readiness.ts";
import { type Epoll } from "./epoll.gen.ts";
import { stub_methods } from "../../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../../rustc_middle/mir/interpret/mod.ts";
export * from "./epoll.gen.ts";

declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/linux_like/epoll.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/epoll.rs:45
    epoll_create1(this: MiriInterpCx, flags: OpTy): InterpResult<Scalar>;
    // shims/unix/linux_like/epoll.rs:78
    epoll_ctl(this: MiriInterpCx, epfd: OpTy, op: OpTy, fd: OpTy, event: OpTy): InterpResult<Scalar>;
    // shims/unix/linux_like/epoll.rs:230
    epoll_wait(this: MiriInterpCx, epfd: OpTy, events_op: OpTy, maxevents: OpTy, timeout: OpTy, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/linux_like/epoll.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/epoll.rs:323
    readiness_to_epoll_bitflag(this: MiriInterpCx, readiness: Readiness): number;
    // shims/unix/linux_like/epoll.rs:353
    epoll_bitflag_to_readiness(this: MiriInterpCx, bitflag: number): Readiness;
    // shims/unix/linux_like/epoll.rs:373
    return_ready_list(this: MiriInterpCx, epfd: FileDescriptionRef<Epoll>, dest: MPlaceTy, events: MPlaceTy): InterpResult<number>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl FileDescription for Epoll (shims/unix/linux_like/epoll.rs:19): name (:20), metadata (:24), as_unix (:31)
// impl UnixFileDescription for Epoll (shims/unix/linux_like/epoll.rs:36)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::linux_like::epoll::EvalContextExt", "src/tools/miri/src/shims/unix/linux_like/epoll.rs", "miri-shims-e", () => InterpCx.prototype, ["epoll_create1", "epoll_ctl", "epoll_wait"]);
stub_methods("miri::shims::unix::linux_like::epoll::EvalContextPrivExt", "src/tools/miri/src/shims/unix/linux_like/epoll.rs", "miri-shims-e", () => InterpCx.prototype, ["readiness_to_epoll_bitflag", "epoll_bitflag_to_readiness", "return_ready_list"]);
