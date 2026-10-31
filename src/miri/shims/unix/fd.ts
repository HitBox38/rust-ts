// Port of src/tools/miri/src/shims/unix/fd.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into fd.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { type DynMachineCallback, type MiriInterpCx } from "../../machine.ts";
import { type DynFileDescriptionRef, type FdNum, type FileDescriptionRef } from "../files.ts";
import { type IoError } from "../io_error.ts";
import { type Varargs } from "../sig.ts";
import { type FlockOp } from "./fd.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../../std/io.ts";
import { type Result } from "../../../std/result.ts";
export * from "./fd.gen.ts";

/** `trait UnixFileDescription` (src/tools/miri/src/shims/unix/fd.rs): implemented by the file description / sync object types; `(provided)`
 * members are the trait's default methods (PORTING §8: a `<Trait>_provided` helper holds them once ported). */
export interface UnixFileDescription {
  // shims/unix/fd.rs:30 (provided)
  pread(_communicate_allowed: boolean, _offset: bigint, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/unix/fd.rs:46 (provided)
  pwrite(_communicate_allowed: boolean, _ptr: Pointer, _len: number, _offset: bigint, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/unix/fd.rs:58 (provided)
  flock(_communicate_allowed: boolean, _op: FlockOp): InterpResult<Result<null, io_Error>>;
  // shims/unix/fd.rs:67 (provided)
  get_flags(_ecx: MiriInterpCx): InterpResult<Scalar>;
  // shims/unix/fd.rs:72 (provided)
  set_flags(_flag: number, _ecx: MiriInterpCx): InterpResult<Scalar>;
  // shims/unix/fd.rs:85 (provided)
  ioctl(_op: Scalar, _args: Varargs, _ecx: MiriInterpCx): InterpResult<number>;
  // shims/unix/fd.rs:95 (provided) // self: FileDescriptionRef<Self>
  as_socket(): FileDescriptionRef<Pending<"dyn UnixSocketFileDescription">> | undefined;
}

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/fd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fd.rs:109
    close(this: MiriInterpCx, fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:138
    dup(this: MiriInterpCx, old_fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:147
    dup2(this: MiriInterpCx, old_fd_num: FdNum, new_fd_num: FdNum): InterpResult<Scalar>;
    // shims/unix/fd.rs:166
    flock(this: MiriInterpCx, fd_num: FdNum, op: number): InterpResult<Scalar>;
    // shims/unix/fd.rs:199
    ioctl(this: MiriInterpCx, fd: OpTy, op: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fd.rs:228
    fcntl(this: MiriInterpCx, fd_num: OpTy, cmd: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fd.rs:346
    read(this: MiriInterpCx, fd_num: number, buf: Pointer, count: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:405
    write(this: MiriInterpCx, fd_num: number, buf: Pointer, count: bigint, offset: bigint | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:461
    readv(this: MiriInterpCx, fd: OpTy, iov: OpTy, iovcnt: OpTy, offset: OpTy | undefined, dest: MPlaceTy): InterpResult;
    // shims/unix/fd.rs:584
    writev(this: MiriInterpCx, fd: OpTy, iov: OpTy, iovcnt: OpTy, offset: OpTy | undefined, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/fd.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fd.rs:699
    read_from_fd(this: MiriInterpCx, fd: DynFileDescriptionRef, ptr: Pointer, len: number, offset: bigint | undefined, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
    // shims/unix/fd.rs:747
    write_to_fd(this: MiriInterpCx, fd: DynFileDescriptionRef, ptr: Pointer, len: number, offset: bigint | undefined, finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl UnixFileDescription for shims::files::Stdin (shims/unix/fd.rs:102)
// impl UnixFileDescription for shims::files::Stdout (shims/unix/fd.rs:103)
// impl UnixFileDescription for shims::files::Stderr (shims/unix/fd.rs:104)
// impl UnixFileDescription for shims::files::NullOutput (shims/unix/fd.rs:105)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::fd::EvalContextExt", "src/tools/miri/src/shims/unix/fd.rs", "miri-shims-d", () => InterpCx.prototype, ["close", "dup", "dup2", "flock", "ioctl", "fcntl", "read", "write", "readv", "writev"]);
stub_methods("miri::shims::unix::fd::EvalContextPrivExt", "src/tools/miri/src/shims/unix/fd.rs", "miri-shims-d", () => InterpCx.prototype, ["read_from_fd", "write_to_fd"]);
