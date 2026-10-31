// Port of src/tools/miri/src/shims/io_error.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into io_error.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type IoError } from "./io_error.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type IoError as io_Error } from "../../std/io.ts";
import { type Result } from "../../std/result.ts";
export * from "./io_error.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/io_error.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/io_error.rs:273
    last_error_place(this: MiriInterpCx): InterpResult<MPlaceTy>;
    // shims/io_error.rs:287
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
    // shims/io_error.rs:433
    try_unwrap_io_result<T>(this: MiriInterpCx, result: Result<T, io_Error>): InterpResult<T>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl IoError (shims/io_error.rs:17) [IoError is not a generated class: companion fns / hand type, lane decides]: into_ntstatus (:18)
// impl From<io::Error> for IoError (shims/io_error.rs:40): from (:41)
// impl From<io::ErrorKind> for IoError (shims/io_error.rs:46): from (:47)
// impl From<Scalar> for IoError (shims/io_error.rs:52): from (:53)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::io_error::EvalContextExt", "src/tools/miri/src/shims/io_error.rs", "miri-shims-b", () => InterpCx.prototype, ["last_error_place", "io_error_to_errnum", "set_last_error", "set_errno_and_return_neg1", "set_errno_and_return_neg1_i32", "set_errno_and_return_neg1_i64", "get_last_error", "host_error_to_errnum", "try_errnum_to_io_error", "try_unwrap_io_result"]);
