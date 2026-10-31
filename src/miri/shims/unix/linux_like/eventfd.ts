// Port of src/tools/miri/src/shims/unix/linux_like/eventfd.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-e` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into eventfd.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Scalar } from "../../../lib.ts";
import { type DynMachineCallback, type MiriInterpCx } from "../../../machine.ts";
import { type FileDescriptionRef } from "../../files.ts";
import { type IoError } from "../../io_error.ts";
import { type EventFd } from "./eventfd.gen.ts";
import { stub_methods } from "../../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type Result } from "../../../../std/result.ts";
export * from "./eventfd.gen.ts";

declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/linux_like/eventfd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/linux_like/eventfd.rs:144
    eventfd(this: MiriInterpCx, val: OpTy, flags: OpTy): InterpResult<Scalar>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl FileDescription for EventFd (shims/unix/linux_like/eventfd.rs:36): name (:37), metadata (:41), read (:49), write (:82), readiness_watched (:104), readiness (:108), as_unix (:119)
// impl UnixFileDescription for EventFd (shims/unix/linux_like/eventfd.rs:124)
// fn eventfd_write (shims/unix/linux_like/eventfd.rs:190)
// fn eventfd_read (shims/unix/linux_like/eventfd.rs:264)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::linux_like::eventfd::EvalContextExt", "src/tools/miri/src/shims/unix/linux_like/eventfd.rs", "miri-shims-e", () => InterpCx.prototype, ["eventfd"]);
