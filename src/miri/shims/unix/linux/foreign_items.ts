// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/linux/foreign_items.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt::emulate_foreign_item_inner` is a module fn taking `this_` (decision C9: called by path).
// - `shim_sig!(extern "C" fn(..) -> ..)` (shims/sig.rs:30, lane miri-shims-b) is the closure the macro expands to:
//   `shim_sig(abi, args, ret, c_variadic)` below builds `|this| ShimSig { .. }` from the same type list
//   (`shim_sig_arg!`: `*_` = `layouts.void_ptr_mut.ty`, `iN`/`uN` = `tcx.types.*`, `libc::T` =
//   `helpers::path_ty_layout(this, ["libc", "T"]).ty`). PORT(contract): pending miri-shims-b — swap for their helper.
// - `trace!(..)` stays a comment (docs/handoff/miri-log.md).
import { type MPlaceTy, type OpTy, type Scalar } from "../../../lib.ts";
import { type MiriInterpCx, SIGRTMAX, SIGRTMIN } from "../../../machine.ts";
import { path_ty_layout } from "../../../helpers.ts";
import { EmulateItemResult } from "../../mod.ts";
import { ShimSig } from "../../sig.ts";
import { prctl } from "../linux_like/thread.ts";
import { syscall } from "../linux_like/syscall.ts";
import { ExternAbi } from "../../../../rustc_abi/extern_abi.ts";
import { CanonAbi } from "../../../../rustc_abi/canon_abi.ts";
import { Immediate } from "../../../../rustc_const_eval/interpret/operand.ts";
import { type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { type Pending } from "../../../../rustc_type_ir/decls.ts";
import { panic, unreachable } from "../../../../std/panic.ts";

// The documentation of glibc complains that the kernel never exposes
// TASK_COMM_LEN through the headers, so it's assumed to always be 16 bytes
// long including a null terminator.
const TASK_COMM_LEN = 16n;

// rustc: src/tools/miri/src/shims/unix/linux/foreign_items.rs:21 is_dyn_sym
export function is_dyn_sym(name: string): boolean {
  return name === "gettid" || name === "statx";
}

// rustc: src/tools/miri/src/shims/unix/linux/foreign_items.rs:27 emulate_foreign_item_inner
export function emulate_foreign_item_inner(this__: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = this__.eval_context_mut();

  // See `fn emulate_foreign_item_inner` in `shims/foreign_items.rs` for the general pattern.

  const sig = (s: ShimSigFn) => this_.check_shim_sig(s, [link_name, abi, args]);
  const sig_variadic = (s: ShimSigFn) => this_.check_shim_sig_variadic(s, [link_name, abi, args]);
  const sig_deprecated = () => this_.check_shim_sig_deprecated(abi, CanonAbi.C, link_name, args);

  switch (Symbol.as_str(link_name)) {
    // File related shims
    case "open64": {
      // FIXME: This does not have a direct test (#3179).
      // "open64" means that the file is opened with O_LARGEFILE, which we always do.
      const c = sig_variadic(shim_sig("C", [ptr_, i32_], i32_, true));
      if (c.$ === "Err") return c;
      const [[path_raw, flag], varargs] = c._0 as [[OpTy, OpTy], typeof c._0[1]];
      const result = this_.open(undefined, path_raw, flag, varargs);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "openat64": {
      // FIXME: This does not have a direct test (#3179).
      // "openat64" means that the file is opened with O_LARGEFILE, which we always do.
      const c = sig_variadic(shim_sig("C", [i32_, ptr_, i32_], i32_, true));
      if (c.$ === "Err") return c;
      const [[dirfd, path_raw, flag], varargs] = c._0 as [[OpTy, OpTy, OpTy], typeof c._0[1]];
      const result = this_.open(dirfd, path_raw, flag, varargs);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pread64": {
      // FIXME: This does not have a direct test (#3179).
      const c = sig(shim_sig("C", [i32_, ptr_, usize_, libc("off64_t")], isize_, false));
      if (c.$ === "Err") return c;
      const [fd_op, buf_op, count_op, offset_op] = c._0 as [OpTy, OpTy, OpTy, OpTy];
      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const buf = this_.read_pointer(buf_op as never);
      if (buf.$ === "Err") return buf;
      const count = this_.read_target_usize(count_op as never);
      if (count.$ === "Err") return count;
      const offset = read_int(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const r = this_.read(fd._0, buf._0 as never, count._0, offset._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pwrite64": {
      // FIXME: This does not have a direct test (#3179).
      const c = sig(shim_sig("C", [i32_, ptr_, usize_, libc("off64_t")], isize_, false));
      if (c.$ === "Err") return c;
      const [fd_op, buf_op, n_op, offset_op] = c._0 as [OpTy, OpTy, OpTy, OpTy];
      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const buf = this_.read_pointer(buf_op as never);
      if (buf.$ === "Err") return buf;
      const count = this_.read_target_usize(n_op as never);
      if (count.$ === "Err") return count;
      const offset = read_int(this_, offset_op);
      if (offset.$ === "Err") return offset;
      // trace!("Called pwrite64({:?}, {:?}, {:?}, {:?})", fd, buf, count, offset);
      const r = this_.write(fd._0, buf._0 as never, count._0, offset._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "lseek64": {
      // FIXME: This does not have a direct test (#3179).
      const c = sig(shim_sig("C", [i32_, libc("off64_t"), i32_], libc("off64_t"), false));
      if (c.$ === "Err") return c;
      const [fd_op, offset_op, whence_op] = c._0 as [OpTy, OpTy, OpTy];
      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const offset = read_int(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const whence = read_i32(this_, whence_op);
      if (whence.$ === "Err") return whence;
      const r = this_.lseek(fd._0, offset._0, whence._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "posix_fallocate64": {
      const c = sig(shim_sig("C", [i32_, libc("off64_t"), libc("off64_t")], i32_, false));
      if (c.$ === "Err") return c;
      const [fd_op, offset_op, len_op] = c._0 as [OpTy, OpTy, OpTy];

      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const offset = read_i64(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const len = read_i64(this_, len_op);
      if (len.$ === "Err") return len;

      const result = this_.posix_fallocate(fd._0, offset._0, len._0);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fallocate": {
      const c = sig(shim_sig("C", [i32_, i32_, libc("off_t"), libc("off_t")], i32_, false));
      if (c.$ === "Err") return c;
      const [fd_op, mode_op, offset_op, len_op] = c._0 as [OpTy, OpTy, OpTy, OpTy];

      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const mode = read_i32(this_, mode_op);
      if (mode.$ === "Err") return mode;
      // We don't support platforms which have libc::off_t bigger than 64 bits.
      const offset = read_int(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const len = read_int(this_, len_op);
      if (len.$ === "Err") return len;

      const result = this_.linux_fallocate(fd._0, mode._0, i64_try_from(offset._0), i64_try_from(len._0));
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fallocate64": {
      const c = sig(shim_sig("C", [i32_, i32_, libc("off64_t"), libc("off64_t")], i32_, false));
      if (c.$ === "Err") return c;
      const [fd_op, mode_op, offset_op, len_op] = c._0 as [OpTy, OpTy, OpTy, OpTy];

      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const mode = read_i32(this_, mode_op);
      if (mode.$ === "Err") return mode;
      const offset = read_i64(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const len = read_i64(this_, len_op);
      if (len.$ === "Err") return len;

      const result = this_.linux_fallocate(fd._0, mode._0, offset._0, len._0);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "ftruncate64": {
      const c = sig(shim_sig("C", [i32_, libc("off64_t")], i32_, false));
      if (c.$ === "Err") return c;
      const [fd_op, length_op] = c._0 as [OpTy, OpTy];
      const fd = read_i32(this_, fd_op);
      if (fd.$ === "Err") return fd;
      const length = read_int(this_, length_op);
      if (length.$ === "Err") return length;
      const result = this_.ftruncate64(fd._0, length._0);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "sync_file_range": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [fd, offset, nbytes, flags] = c._0 as [OpTy, OpTy, OpTy, OpTy];
      const result = this_.sync_file_range(fd, offset, nbytes, flags);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "statx": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [dirfd, pathname, flags, mask, statxbuf] = c._0 as [OpTy, OpTy, OpTy, OpTy, OpTy];
      const result = this_.linux_statx(dirfd, pathname, flags, mask, statxbuf);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fstat64": {
      const c = sig(shim_sig("C", [i32_, ptr_], i32_, false));
      if (c.$ === "Err") return c;
      const [fd, buf] = c._0 as [OpTy, OpTy];
      const result = this_.fstat(fd, buf, "stat64");
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "readdir64": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [dirp] = c._0 as [OpTy];
      const r = this_.readdir(dirp, dest, "dirent64");
      if (r.$ === "Err") return r;
      break;
    }

    // epoll, eventfd
    case "epoll_create1": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [flag] = c._0 as [OpTy];
      const result = this_.epoll_create1(flag);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "epoll_ctl": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [epfd, op, fd, event] = c._0 as [OpTy, OpTy, OpTy, OpTy];
      const result = this_.epoll_ctl(epfd, op, fd, event);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "epoll_wait": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [epfd, events, maxevents, timeout] = c._0 as [OpTy, OpTy, OpTy, OpTy];
      const r = this_.epoll_wait(epfd, events, maxevents, timeout, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "eventfd": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [val, flag] = c._0 as [OpTy, OpTy];
      const result = this_.eventfd(val, flag);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Threading
    case "pthread_setname_np": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [thread_op, name_op] = c._0 as [OpTy, OpTy];
      const thread = this_.read_scalar(thread_op as never);
      if (thread.$ === "Err") return thread;
      const name = this_.read_scalar(name_op as never);
      if (name.$ === "Err") return name;
      const r = this_.pthread_setname_np(thread._0 as Scalar, name._0 as Scalar, TASK_COMM_LEN, /* truncate */ false);
      if (r.$ === "Err") return r;
      let res: Scalar;
      switch (r._0) {
        case "Ok":
          res = interp_Scalar.from_u32(0);
          break;
        case "NameTooLong":
          res = this_.eval_libc("ERANGE");
          break;
      }
      const w = write_scalar(this_, res, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_getname_np": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [thread_op, name_op, len_op] = c._0 as [OpTy, OpTy, OpTy];
      // The function's behavior isn't portable between platforms.
      // In case of glibc, the length of the output buffer must
      // be not shorter than TASK_COMM_LEN.
      const len_r = this_.read_scalar(len_op as never);
      if (len_r.$ === "Err") return len_r;
      const len = len_r._0 as Scalar;
      const len_u = interp_Scalar.to_target_usize(len, this_);
      if (len_u.$ === "Err") return len_u;
      let res: Scalar;
      if (len_u._0 >= TASK_COMM_LEN) {
        const thread = this_.read_scalar(thread_op as never);
        if (thread.$ === "Err") return thread;
        const name = this_.read_scalar(name_op as never);
        if (name.$ === "Err") return name;
        const r = this_.pthread_getname_np(thread._0 as Scalar, name._0 as Scalar, len, /* truncate*/ false);
        if (r.$ === "Err") return r;
        switch (r._0) {
          case "Ok":
            res = interp_Scalar.from_u32(0);
            break;
          case "NameTooLong":
            return unreachable("internal error: entered unreachable code");
        }
      } else {
        res = this_.eval_libc("ERANGE");
      }
      const w = write_scalar(this_, res, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "gettid": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const result = this_.unix_gettid(Symbol.as_str(link_name));
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "prctl": {
      const r = prctl(this_, link_name, abi, args, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Dynamically invoked syscalls
    case "syscall": {
      const r = syscall(this_, link_name, abi, args, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Miscellaneous
    case "mmap64": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [addr, length, prot, flags, fd, offset_op] = c._0 as [OpTy, OpTy, OpTy, OpTy, OpTy, OpTy];
      const offset = read_i64(this_, offset_op);
      if (offset.$ === "Err") return offset;
      const ptr = this_.mmap(addr, length, prot, flags, fd, offset._0);
      if (ptr.$ === "Err") return ptr;
      const w = write_scalar(this_, ptr._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "mremap": {
      const c = sig_variadic(shim_sig("C", [ptr_, usize_, usize_, i32_], ptr_, true));
      if (c.$ === "Err") return c;
      const [[old_address, old_size, new_size, flags]] = c._0 as [[OpTy, OpTy, OpTy, OpTy], unknown];
      const ptr = this_.mremap(old_address, old_size, new_size, flags);
      if (ptr.$ === "Err") return ptr;
      const w = write_scalar(this_, ptr._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "__xpg_strerror_r": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const [errnum, buf, buflen] = c._0 as [OpTy, OpTy, OpTy];
      const result = this_.strerror_r(errnum, buf, buflen);
      if (result.$ === "Err") return result;
      const w = write_scalar(this_, result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "__errno_location": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const errno_place = this_.last_error_place();
      if (errno_place.$ === "Err") return errno_place;
      const imm = errno_place._0.to_ref(this_);
      const w = write_scalar(this_, Immediate.to_scalar(imm as never) as unknown as Scalar, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "__libc_current_sigrtmin": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;

      const w = this_.write_int(BigInt(SIGRTMIN), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "__libc_current_sigrtmax": {
      const c = sig_deprecated();
      if (c.$ === "Err") return c;

      const w = this_.write_int(BigInt(SIGRTMAX), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Incomplete shims that we "stub out" just to get pre-main initialization code to work.
    // These shims are enabled only when the caller is in the standard library.
    case "pthread_getattr_np": {
      if (!this_.frame_in_std()) return interp_ok(EmulateItemResult.NotSupported);
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "gnu_get_libc_version": {
      if (!(this_.frame_in_std() && this_.tcx.deref().sess.target.env.$ === "Gnu")) return interp_ok(EmulateItemResult.NotSupported);
      const c = sig_deprecated();
      if (c.$ === "Err") return c;
      // We have to be at least version 2.26 so that std does not call `res_init`.
      // This returns a C string, so we have to add a null terminator.
      const version = "2.26\0";
      const version_place = this_.allocate_str_dedup(version);
      if (version_place.$ === "Err") return version_place;
      const w = this_.write_pointer(version_place._0.ptr(), dest as never);
      if (w.$ === "Err") return w;
      break;
    }

    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }

  return interp_ok(EmulateItemResult.NeedsReturn);
}

// ---------------------------------------------------------------- private glue of this module ----

/** The skeleton's `check_shim_sig` parameter type (sig.ts). */
type ShimSigFn = Pending<"fn(&MiriInterpCx<'tcx>) -> ShimSig<'tcx, N>">;
/** One `shim_sig_arg!` type. */
type SigTy = (this_: MiriInterpCx) => Ty;

/** `shim_sig!(extern $abi fn($args) -> $ret)` (module header). PORT(contract): pending miri-shims-b. */
function shim_sig(abi: string, args: readonly SigTy[], ret: SigTy, c_variadic: boolean): ShimSigFn {
  return ((this_: MiriInterpCx): ShimSig => {
    const a = ExternAbi.from_str(abi);
    if (a.$ === "Err") return panic("incorrect abi specified");
    return new ShimSig(a._0, args.map((t) => t(this_)), ret(this_), c_variadic);
  }) as unknown as ShimSigFn;
}
const ptr_: SigTy = (this_) => this_.machine.layouts.void_ptr_mut.ty; // `*_`
const i32_: SigTy = (this_) => this_.tcx.deref().types.i32;
const isize_: SigTy = (this_) => this_.tcx.deref().types.isize;
const usize_: SigTy = (this_) => this_.tcx.deref().types.usize;
/** `libc::$ty` (`helpers::path_ty_layout($this, &["libc", "$ty"]).ty`). */
function libc(ty: string): SigTy {
  return (this_) => path_ty_layout(this_ as never, ["libc", ty]).ty;
}

/** `this.write_scalar(v, dest)?`. */
function write_scalar(this_: MiriInterpCx, v: Scalar, dest: MPlaceTy): InterpResult {
  return this_.write_scalar(v as never, dest as never);
}
/** `this.read_scalar(op)?.to_i32()?`. */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0 as Scalar);
}
/** `this.read_scalar(op)?.to_i64()?`. */
function read_i64(this_: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i64(s._0 as Scalar);
}
/** `this.read_scalar(op)?.to_int(op.layout.size)?`. */
function read_int(this_: MiriInterpCx, op: OpTy): InterpResult<bigint> {
  const s = this_.read_scalar(op as never);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_int(s._0 as Scalar, op.layout.size);
}
/** `i64::try_from(i128).unwrap()`. */
function i64_try_from(x: bigint): bigint {
  if (x < -(1n << 63n) || x >= 1n << 63n) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return x;
}
