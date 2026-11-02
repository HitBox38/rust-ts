// Port of src/tools/miri/src/shims/unix/linux_like/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e` (plan-m6
// wave 37). The module has no fns: `pub mod epoll; pub mod eventfd; pub mod sync; pub mod syscall; pub mod thread;` (the
// submodules are loaded by src/miri/lib.ts).
import { type OpTy } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import { type VisitWith } from "../../../provenance_gc.ts";
import { type FileDescription } from "../../files.ts";
import { type IoError } from "../../io_error.ts";
import { type Readiness, type ReadinessWatched, type ReadinessWatcher } from "../../readiness.ts";
import { type ShimSig, type Varargs } from "../../sig.ts";
import { type ErrorKind } from "../../../../std/io.ts";
import { type AnyMachine, type Machine } from "../../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../../../rustc_span/symbol.ts";

// PORT(contract): pending miri-shims-b — the shims/sig.rs contract agreed with that lane (2026-11-02), used by this
// module's files: `shim_sig!` / `shim_varargs!` are the helpers `shim_sig(abi, args, ret)` / `shim_varargs(..tys)` with
// string type specs, and `check_shim_sig_variadic` / `check_varargs` take those closures. Delete this block when sig.ts
// exports and declares them.
declare module "../../sig.ts" {
  export const shim_sig: (abi: string, args: readonly string[], ret: string) => (this_: MiriInterpCx) => ShimSig;
  export const shim_varargs: (...tys: string[]) => (this_: MiriInterpCx) => Ty[];
}
declare module "../../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    check_shim_sig_variadic(this: MiriInterpCx, shim_sig: (this_: MiriInterpCx) => ShimSig, _1: [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<[readonly OpTy[], Varargs]>;
    check_varargs(this: MiriInterpCx, tys: (this_: MiriInterpCx) => Ty[], varargs: Varargs, fn_name: string): InterpResult<[readonly OpTy[], Varargs]>;
  }
}

/** The type of a provided trait method copied by an implementor (`<Trait>_provided` tables, PORTING §8). */
type Provided<R> = (this: unknown, ...args: readonly never[]) => R;

// PORT(contract): pending miri-shims-b — shims/files.rs and shims/io_error.rs as agreed with that lane (2026-11-02):
// `FileDescriptionRef` is one owned strong handle (`clone` adds one, `drop` releases it, `deref` is the inner description);
// `downcast(is_T)` takes over the handle (an exact `instanceof` test; on failure it releases it); trait methods with
// `self: FileDescriptionRef<Self>` take a leading `self_`; `FileDescription_provided` holds the trait's default methods;
// the inner's optional `drop_glue()` runs when the last strong handle drops. Delete these blocks when files.ts /
// io_error.ts declare them.
declare module "../../files.gen.ts" {
  interface FileDescriptionRef<T> {
    deref(): T;
    clone(): FileDescriptionRef<T>;
    drop(): void;
    downcast<U extends object>(is_T: (v: object) => v is U): FileDescriptionRef<U> | undefined;
    visit_provenance(visit: VisitWith): void;
  }
}
declare module "../../files.ts" {
  export const FileDescription_provided: {
    read: Provided<InterpResult>;
    write: Provided<InterpResult>;
    short_fd_operations: Provided<boolean>;
    seek: Provided<InterpResult<unknown>>;
    is_tty: Provided<boolean>;
    readiness_watched: Provided<ReadinessWatched | undefined>;
    readiness: Provided<Readiness>;
  };
}
declare module "../../io_error.ts" {
  export const IoError_from_ErrorKind: (kind: ErrorKind) => IoError;
}

// PORT(contract): pending miri-shims-d — `UnixFileDescription_provided` (shims/unix/fd.rs's default methods, PORTING §8).
declare module "../fd.ts" {
  export const UnixFileDescription_provided: {
    pread: Provided<InterpResult>;
    pwrite: Provided<InterpResult>;
    flock: Provided<InterpResult<unknown>>;
    get_flags: Provided<InterpResult<unknown>>;
    set_flags: Provided<InterpResult<unknown>>;
    ioctl: Provided<InterpResult<number>>;
    as_socket: Provided<unknown>;
  };
}

// PORT(contract): pending miri-shims-c — shims/readiness.rs as agreed with that lane (2026-11-02): `Readiness::EMPTY`,
// the derived `ReadinessWatched::default()`, the `Rc<ReadinessWatcher>` protocol (`Rc::new(ReadinessWatcher::default())`,
// `Rc::clone`, drop of an `Rc` running `Drop for ReadinessWatcher` at 0) and `Drop for ReadinessWatched` (the method
// `watched.drop()`).
declare module "../../readiness.ts" {
  export const Readiness_EMPTY: Readiness;
  export const ReadinessWatched_default: () => ReadinessWatched;
  export const Rc_new_ReadinessWatcher: () => ReadinessWatcher;
  export const Rc_clone_ReadinessWatcher: (w: ReadinessWatcher) => ReadinessWatcher;
  export const Rc_drop_ReadinessWatcher: (w: ReadinessWatcher) => void;
}
declare module "../../readiness.gen.ts" {
  interface ReadinessWatched {
    drop(): void;
  }
}
