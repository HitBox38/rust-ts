// Fill lane: `miri-shims-c` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/shims/unix/foreign_items.rs (crate `miri`, plan-m6 D2): the Unix foreign-item dispatcher.
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`): `sysconf` / `strerror_r` are `InterpCx` methods (decision C2);
//   `emulate_foreign_item_inner` is a module fn taking `this_` (decision C9: the trait is called by path).
// - `match link_name.as_str() { .. }` is a `switch` in upstream arm order; `_ => { return match target_os {..} }` is the
//   `platform_specific` closure (also the target of a failed guard). An arm with a guard (`"x" if
//   this.frame_in_std() => ..`) falls through to the `_` arm when the guard is false (`platform_specific()`).
// - `shim_sig!(extern "C" fn(A, B) -> R)` (shims/sig.rs:30, lane miri-shims-b) is `shim_sig("C", ["A", "B"], "R")`: the
//   macro's argument and return tokens as strings (`"*_"`, `"i32"`, `"libc::off_t"`, `"fn(..) -> _"`, `"()"`, a trailing
//   `"..."` for C varargs). It is a `PORT(contract): pending miri-shims-b` declaration below (`unported` until it
//   exists); `check_shim_sig` / `check_shim_sig_variadic` are declared in sig.ts.
// - The other-OS dispatch arms (android, freebsd, macos, solarish, netbsd) and their `is_dyn_sym` stop `unported`
//   (plan-m6 D2: only x86_64-unknown-linux-gnu). The Linux arm calls linux/foreign_items.ts (lane miri-shims-d).
// - `socketpair` / `pipe` / `pipe2` (shims/unix/virtual_socket.rs) and `getaddrinfo` / `freeaddrinfo`
//   (shims/unix/socket_address.rs) live in files without a module (D2 sockets exclusion, miri-contract "Scope"): their
//   arms check the signature, then stop `unported`.
// - `trace!(..)` calls are comments (only `info!` is ported, plan-m6 A6).
// - `std::env::home_dir()` (`getpwuid_r`, isolation off only) is a host stand-in (`$HOME`, else `os.homedir()`,
//   plan-m6 D14).
import { homedir } from "node:os";
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type EmulateItemResult } from "../mod.ts";
import { DynSym } from "../foreign_items.ts";
import * as sig from "../sig.ts";
import * as linux from "./linux/foreign_items.ts";
import { UID } from "./mod.ts";
import { type CanonAbi } from "../../../rustc_abi/canon_abi.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { FnVal } from "../../../rustc_const_eval/interpret/memory.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  PointerArithmetic_provided,
  Scalar as interp_Scalar,
} from "../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { type Os } from "../../../rustc_target/spec/mod.ts";
import { display_IoError } from "../../../std/io.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Duration } from "../../../std/time.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { unported } from "../../../std/panic.ts";
import { Err } from "../../../std/result.ts";
import { display_Scalar } from "../../../rustc_middle/mir/interpret/value.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/foreign_items.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/foreign_items.rs:55
    sysconf(this: MiriInterpCx, val: OpTy): InterpResult<Scalar>;
    // shims/unix/foreign_items.rs:87
    strerror_r(this: MiriInterpCx, errnum: OpTy, buf: OpTy, buflen: OpTy): InterpResult<Scalar>;
  }
}

/** `fn(&MiriInterpCx<'tcx>) -> ShimSig<'tcx, N>`: what `shim_sig!` expands to (sig.ts's `check_shim_sig` parameter). */
type ShimSigFn = Parameters<MiriInterpCx["check_shim_sig"]>[0];

// PORT(contract): pending miri-shims-b — `shim_sig!` (shims/sig.rs:30) has no TS form in the skeleton; miri-shims-b
// exports it as `shim_sig(abi, args, ret)` with the macro's tokens as strings (module header). It is read from the
// module namespace at call time (no declaration here, so this file type-checks with and without that export).
/** `shim_sig!(extern "<abi>" fn(<args>) -> <ret>)` through the pending shims-b export (`unported` until it lands). */
function shim_sig(abi: string, args: readonly string[], ret: string): ShimSigFn {
  const f = (sig as unknown as { shim_sig?: (abi: string, args: readonly string[], ret: string) => ShimSigFn }).shim_sig;
  if (typeof f !== "function") {
    return unported("miri::shims::sig::shim_sig! (src/tools/miri/src/shims/sig.rs:30; lane miri-shims-b)");
  }
  return f(abi, args, ret);
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `this.read_scalar(op)?.to_i32()` */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0);
}

/** `this.read_scalar(op)?.to_int(size)` */
function read_int(this_: MiriInterpCx, op: OpTy, size: Size): InterpResult<bigint> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_int(s._0, size);
}

/** `CanonAbi::C` */
const CANON_C: CanonAbi = { $: "C" };

/**
 * `this.check_shim_sig_deprecated(abi, CanonAbi::C, link_name, args)` destructured into `N` operands: miri-shims-b's
 * sig.ts takes Rust's `const N` as a trailing `n` (the skeleton's declaration has no `n`; the extra argument is passed
 * through so the call is right on both sides of that merge).
 */
function check_shim_sig_deprecated(this_: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], n: number): InterpResult<readonly OpTy[]> {
  const f = this_.check_shim_sig_deprecated as unknown as (...a: unknown[]) => InterpResult<readonly OpTy[]>;
  return f.call(this_, abi, CANON_C, link_name, args, n);
}

/** `Os::X` values for `check_target_os`. */
function oses(...names: string[]): Os[] {
  return names.map((n) => ({ $: n }) as Os);
}

// rustc: src/tools/miri/src/shims/unix/foreign_items.rs:22 is_dyn_sym
export function is_dyn_sym(name: string, target_os: Os): boolean {
  switch (name) {
    // Used for (std and Miri) tests.
    case "strlen":
      return true;
    // `signal` is set up as a weak symbol in `init_extern_statics` (on Android) so we might as
    // well allow it in `dlsym`.
    case "signal":
      return true;
    // needed at least on macOS to avoid file-based fallback in getrandom
    case "getentropy":
    case "getrandom":
      return true;
    // `futimens` is set up as a weak symbol in `init_extern_statics` (on Android), so we
    // allow it here too (it exists on all our Unix targets).
    case "futimens":
      return true;
  }
  // `preadv`/`pwritev` are set up as weak symbols in `init_extern_statics` (on Android,
  // where std uses them via `weak!` since bionic only gained them in API level 24), so
  // we allow them here too. They do not exist on Solaris.
  if ((name === "preadv" || name === "pwritev") && target_os.$ !== "Solaris") {
    return true;
  }
  // Give specific OSes a chance to allow their symbols.
  switch (target_os.$) {
    case "Android":
      return unported("miri::shims::unix::android::foreign_items::is_dyn_sym (plan-m6 D2: other-OS unix shims)");
    case "FreeBsd":
      return unported("miri::shims::unix::freebsd::foreign_items::is_dyn_sym (plan-m6 D2: other-OS unix shims)");
    case "Linux":
      return linux.is_dyn_sym(name);
    case "MacOs":
      return unported("miri::shims::unix::macos::foreign_items::is_dyn_sym (plan-m6 D2: other-OS unix shims)");
    case "Solaris":
    case "Illumos":
      return unported("miri::shims::unix::solarish::foreign_items::is_dyn_sym (plan-m6 D2: other-OS unix shims)");
    case "NetBsd":
      return unported("miri::shims::unix::netbsd::foreign_items::is_dyn_sym (plan-m6 D2: other-OS unix shims)");
    default:
      return false;
  }
}

/** The `SYSCONFS` table of `sysconf` (foreign_items.rs:61). */
const SYSCONFS: readonly (readonly [string, (this_: MiriInterpCx) => bigint])[] = [
  ["_SC_PAGESIZE", (this_) => this_.machine.page_size],
  ["_SC_PAGE_SIZE", (this_) => this_.machine.page_size],
  ["_SC_NPROCESSORS_CONF", (this_) => BigInt(this_.machine.num_cpus)],
  ["_SC_NPROCESSORS_ONLN", (this_) => BigInt(this_.machine.num_cpus)],
  // 512 seems to be a reasonable default. The value is not critical, in
  // the sense that getpwuid_r takes and checks the buffer length.
  ["_SC_GETPW_R_SIZE_MAX", (_this) => 512n],
  // Miri doesn't have a fixed limit on FDs, but we may be limited in terms of how
  // many *host* FDs we can open. Just use some arbitrary, pretty big value;
  // this can be adjusted if it causes problems.
  // The spec imposes a minimum of `_POSIX_OPEN_MAX` (20).
  ["_SC_OPEN_MAX", (_this) => 2n ** 16n],
  // Our hard-coded hostname is just 4 bytes so we don't need anything big here.
  ["_SC_HOST_NAME_MAX", (_this) => 255n],
];

// Querying system information
// rustc: src/tools/miri/src/shims/unix/foreign_items.rs:55 sysconf
InterpCx.prototype.sysconf = function (this: MiriInterpCx, val: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const name = read_i32(this_, val);
  if (name.$ === "Err") return name;
  // FIXME: Which of these are POSIX, and which are GNU/Linux?
  // At least the names seem to all also exist on macOS.
  for (const [sysconf_name_str, value] of SYSCONFS) {
    const sysconf_name = this_.eval_libc_i32(sysconf_name_str);
    if (sysconf_name === name._0) {
      const v: Scalar = interp_Scalar.from_target_isize(value(this_), this_);
      return interp_ok(v);
    }
  }
  return throw_unsup_format(`unimplemented sysconf name: ${name._0}`);
};

// rustc: src/tools/miri/src/shims/unix/foreign_items.rs:87 strerror_r
InterpCx.prototype.strerror_r = function (this: MiriInterpCx, errnum: OpTy, buf: OpTy, buflen: OpTy): InterpResult<Scalar> {
  const this_ = this.eval_context_mut();

  const errnum_ = this_.read_scalar(errnum);
  if (errnum_.$ === "Err") return errnum_;
  const buf_ = this_.read_pointer(buf);
  if (buf_.$ === "Err") return buf_;
  const buflen_ = this_.read_target_usize(buflen);
  if (buflen_.$ === "Err") return buflen_;
  const error = this_.try_errnum_to_io_error(errnum_._0);
  if (error.$ === "Err") return error;
  let formatted: string;
  if (error._0 !== undefined) {
    formatted = display_IoError(error._0);
  } else {
    formatted = `<unknown errnum in strerror_r: ${display_Scalar(errnum_._0, PLAIN)}>`;
  }
  const w = this_.write_os_str_to_c_str(formatted, buf_._0, buflen_._0);
  if (w.$ === "Err") return w;
  const [complete, _] = w._0;
  if (complete) {
    return interp_ok(interp_Scalar.from_i32(0));
  } else {
    return interp_ok(interp_Scalar.from_i32(this_.eval_libc_i32("ERANGE")));
  }
};

// rustc: src/tools/miri/src/shims/unix/foreign_items.rs:111 emulate_foreign_item_inner
export function emulate_foreign_item_inner(self_: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  const this_ = self_.eval_context_mut();

  if (this_.machine.communicate()) {
    // When isolation is disabled we need to check for new host I/O events before
    // running any shimmed function. This is needed to ensure that the shim we
    // execute has up-to-date information about host readiness (as reflected
    // e.g. by epoll) even if the current thread never yields.

    // Perform a non-blocking poll for newly available I/O events from the OS.
    const r = this_.poll_and_unblock(Duration.ZERO);
    if (r.$ === "Err") return r;
  }

  // Platform-specific shims
  const platform_specific = (): InterpResult<EmulateItemResult> => {
    const target_os = this_.tcx.deref().sess.target.os;
    switch (target_os.$) {
      case "Android":
        return unported("miri::shims::unix::android::foreign_items::EvalContextExt::emulate_foreign_item_inner (plan-m6 D2: other-OS unix shims)");
      case "FreeBsd":
        return unported("miri::shims::unix::freebsd::foreign_items::EvalContextExt::emulate_foreign_item_inner (plan-m6 D2: other-OS unix shims)");
      case "Linux":
        return linux.emulate_foreign_item_inner(this_, link_name, abi, args, dest);
      case "MacOs":
        return unported("miri::shims::unix::macos::foreign_items::EvalContextExt::emulate_foreign_item_inner (plan-m6 D2: other-OS unix shims)");
      case "Solaris":
      case "Illumos":
        return unported("miri::shims::unix::solarish::foreign_items::EvalContextExt::emulate_foreign_item_inner (plan-m6 D2: other-OS unix shims)");
      case "NetBsd":
        return unported("miri::shims::unix::netbsd::foreign_items::EvalContextExt::emulate_foreign_item_inner (plan-m6 D2: other-OS unix shims)");
      default:
        return interp_ok("NotSupported");
    }
  };
  const sig_args = [link_name, abi, args] as [Symbol, FnAbi<Ty>, readonly OpTy[]];

  // See `fn emulate_foreign_item_inner` in `shims/foreign_items.rs` for the general pattern.
  switch (Symbol.as_str(link_name)) {
    // Environment related shims
    case "getenv": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [name] = a._0;
      const result = this_.getenv(name);
      if (result.$ === "Err") return result;
      const w = this_.write_pointer(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "unsetenv": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [name] = a._0;
      const result = this_.unsetenv(name);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "setenv": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [name, value, overwrite] = a._0;
      const o = read_i32(this_, overwrite);
      if (o.$ === "Err") return o;
      const result = this_.setenv(name, value);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getcwd": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [buf, size] = a._0;
      const result = this_.getcwd(buf, size);
      if (result.$ === "Err") return result;
      const w = this_.write_pointer(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "gethostname": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [name, len] = a._0;
      const result = this_.gethostname(name, len);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "chdir": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path] = a._0;
      const result = this_.chdir(path);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getpid": {
      const a = this_.check_shim_sig(shim_sig("C", [], "libc::pid_t"), sig_args);
      if (a.$ === "Err") return a;
      const result = this_.getpid();
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "uname": {
      // Not all Unixes have the `uname` symbol, e.g. FreeBSD does not.
      const c = this_.check_target_os(oses("Linux", "Android", "MacOs", "Solaris", "Illumos"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [uname] = a._0;
      const result = this_.uname(uname, undefined);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "sysconf": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [val] = a._0;
      const result = this_.sysconf(val);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    // File descriptors
    case "read": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "usize"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, buf, count] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const count_ = this_.read_target_usize(count);
      if (count_.$ === "Err") return count_;
      const r = this_.read(fd_._0, buf_._0, count_._0, undefined, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "write": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "usize"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, buf, n] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const count = this_.read_target_usize(n);
      if (count.$ === "Err") return count;
      // trace!("Called write({:?}, {:?}, {:?})", fd, buf, count);
      const r = this_.write(fd_._0, buf_._0, count._0, undefined, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "readv": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "i32"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, iov, iovcnt] = a._0;
      const r = this_.readv(fd, iov, iovcnt, undefined, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "writev": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "i32"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, iov, iovcnt] = a._0;
      const r = this_.writev(fd, iov, iovcnt, undefined, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pread": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "usize", "libc::off_t"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, buf, count, offset] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const count_ = this_.read_target_usize(count);
      if (count_.$ === "Err") return count_;
      const offset_ = read_int(this_, offset, offset.layout.size);
      if (offset_.$ === "Err") return offset_;
      const r = this_.read(fd_._0, buf_._0, count_._0, offset_._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pwrite": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "usize", "libc::off_t"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, buf, n, offset] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const count = this_.read_target_usize(n);
      if (count.$ === "Err") return count;
      const offset_ = read_int(this_, offset, offset.layout.size);
      if (offset_.$ === "Err") return offset_;
      // trace!("Called pwrite({:?}, {:?}, {:?}, {:?})", fd, buf, count, offset);
      const r = this_.write(fd_._0, buf_._0, count._0, offset_._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "preadv": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "i32", "libc::off_t"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, iov, iovcnt, offset] = a._0;
      const r = this_.readv(fd, iov, iovcnt, offset, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pwritev": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "i32", "libc::off_t"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, iov, iovcnt, offset] = a._0;
      const r = this_.writev(fd, iov, iovcnt, offset, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "close": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const result = this_.close(fd_._0);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fcntl": {
      const a = this_.check_shim_sig_variadic(shim_sig("C", ["i32", "i32", "..."], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [[fd_num, cmd], varargs] = a._0;
      const result = this_.fcntl(fd_num, cmd, varargs);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "dup": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [old_fd] = a._0;
      const old_fd_ = read_i32(this_, old_fd);
      if (old_fd_.$ === "Err") return old_fd_;
      const new_fd = this_.dup(old_fd_._0);
      if (new_fd.$ === "Err") return new_fd;
      const w = this_.write_scalar(new_fd._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "dup2": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [old_fd, new_fd] = a._0;
      const old_fd_ = read_i32(this_, old_fd);
      if (old_fd_.$ === "Err") return old_fd_;
      const new_fd_ = read_i32(this_, new_fd);
      if (new_fd_.$ === "Err") return new_fd_;
      const result = this_.dup2(old_fd_._0, new_fd_._0);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "flock": {
      // Currently this function does not exist on all Unixes, e.g. on Solaris.
      const c = this_.check_target_os(oses("Linux", "Android", "FreeBsd", "MacOs", "Illumos"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, op] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const op_ = read_i32(this_, op);
      if (op_.$ === "Err") return op_;
      const result = this_.flock(fd_._0, op_._0);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "ioctl": {
      // The type of `op` depends on the libc. :(
      // glibc, BSD use `unsigned long`, the rest uses `int`.
      const target = this_.tcx.deref().sess.target;
      let op_is_ulong: boolean;
      switch (target.os.$) {
        case "FreeBsd":
        case "NetBsd":
        case "MacOs":
          op_is_ulong = true;
          break;
        case "Linux":
          op_is_ulong = target.env.$ === "Gnu";
          break;
        default:
          op_is_ulong = false;
      }
      const a = this_.check_shim_sig_variadic(
        op_is_ulong ? shim_sig("C", ["i32", "usize", "..."], "i32") : shim_sig("C", ["i32", "i32", "..."], "i32"),
        sig_args,
      );
      if (a.$ === "Err") return a;
      const [[fd, op], varargs] = a._0;
      const result = this_.ioctl(fd, op, varargs);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    // File and file system access
    case "open": {
      // `open` is variadic, the third argument is only present when the second argument
      // has O_CREAT (or on linux O_TMPFILE, but miri doesn't support that) set
      const a = this_.check_shim_sig_variadic(shim_sig("C", ["*_", "i32", "..."], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [[path_raw, flag], varargs] = a._0;
      const result = this_.open(undefined, path_raw, flag, varargs);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "openat": {
      const a = this_.check_shim_sig_variadic(shim_sig("C", ["i32", "*_", "i32", "..."], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [[dirfd, path_raw, flag], varargs] = a._0;
      const result = this_.open(dirfd, path_raw, flag, varargs);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "unlink": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path] = a._0;
      const result = this_.unlink(path);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "symlink": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [target, linkpath] = a._0;
      const result = this_.symlink(target, linkpath);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "linkat": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "i32", "*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [oldfd, oldpath, newfd, newpath, flags] = a._0;
      const result = this_.linkat(oldfd, oldpath, newfd, newpath, flags);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fstat": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, buf] = a._0;
      const result = this_.fstat(fd, buf, "stat");
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "lstat": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path, buf] = a._0;
      const result = this_.lstat(path, buf);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "stat": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path, buf] = a._0;
      const result = this_.stat(path, buf);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fstatat": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [dirfd, path, buf, flags] = a._0;
      const result = this_.fstatat(dirfd, path, buf, flags);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "chmod": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "libc::mode_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path, mode] = a._0;
      const result = this_.chmod(path, mode);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fchmod": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "libc::mode_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, mode] = a._0;
      const result = this_.fchmod(fd, mode);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "rename": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [oldpath, newpath] = a._0;
      const result = this_.rename(oldpath, newpath);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "mkdir": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "libc::mode_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path, mode] = a._0;
      const result = this_.mkdir(path, mode);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "rmdir": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [path] = a._0;
      const result = this_.rmdir(path);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "opendir": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [name] = a._0;
      const result = this_.opendir(name);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "closedir": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [dirp] = a._0;
      const result = this_.closedir(dirp);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "readdir": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [dirp] = a._0;
      const r = this_.readdir(dirp, dest, "dirent");
      if (r.$ === "Err") return r;
      break;
    }
    case "dirfd": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [dirp] = a._0;
      const r = this_.dirfd(dirp, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "lseek": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "libc::off_t", "i32"], "libc::off_t"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, offset, whence] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const offset_ = read_int(this_, offset, offset.layout.size);
      if (offset_.$ === "Err") return offset_;
      const whence_ = read_i32(this_, whence);
      if (whence_.$ === "Err") return whence_;
      const r = this_.lseek(fd_._0, offset_._0, whence_._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "ftruncate": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "libc::off_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, length] = a._0;
      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      const length_ = read_int(this_, length, length.layout.size);
      if (length_.$ === "Err") return length_;
      const result = this_.ftruncate64(fd_._0, length_._0);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fsync": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd] = a._0;
      const result = this_.fsync(fd);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "fdatasync": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd] = a._0;
      const result = this_.fdatasync(fd);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "futimens": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, times] = a._0;
      const result = this_.futimens(fd, times);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "utimensat": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [dirfd, path, times, flags] = a._0;
      const result = this_.utimensat(dirfd, path, times, flags);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "readlink": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_", "usize"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [pathname, buf, bufsize] = a._0;
      const result = this_.readlink(pathname, buf, bufsize);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(interp_Scalar.from_target_isize(result._0, this_), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "posix_fadvise": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "libc::off_t", "libc::off_t", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, offset, len, advice] = a._0;
      const r1 = read_i32(this_, fd);
      if (r1.$ === "Err") return r1;
      const r2 = read_int(this_, offset, offset.layout.size);
      if (r2.$ === "Err") return r2;
      const r3 = read_int(this_, len, len.layout.size);
      if (r3.$ === "Err") return r3;
      const r4 = read_i32(this_, advice);
      if (r4.$ === "Err") return r4;
      // fadvise is only informational, we can ignore it.
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "posix_fallocate": {
      // posix_fallocate is not supported by macos.
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Solaris", "Illumos", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["i32", "libc::off_t", "libc::off_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd, offset, len] = a._0;

      const fd_ = read_i32(this_, fd);
      if (fd_.$ === "Err") return fd_;
      // We don't support platforms which have libc::off_t bigger than 64 bits.
      const offset_ = read_int(this_, offset, offset.layout.size);
      if (offset_.$ === "Err") return offset_;
      const len_ = read_int(this_, len, len.layout.size);
      if (len_.$ === "Err") return len_;
      // PORT: `i64::try_from(..).unwrap()` holds: `off_t` is at most 64 bits on the supported targets.

      const result = this_.posix_fallocate(fd_._0, offset_._0, len_._0);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "realpath": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [path, resolved_path] = a._0;
      const result = this_.realpath(path, resolved_path);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "mkstemp": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [template] = a._0;
      const result = this_.mkstemp(template);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Poll
    case "poll": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "libc::nfds_t", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fds, nfds, timeout] = a._0;
      const r = this_.poll(fds, nfds, timeout, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Sockets and pipes
    case "socketpair": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32", "i32", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      return unported("miri::shims::unix::virtual_socket::EvalContextExt::socketpair (plan-m6 D2: sockets)");
    }
    case "pipe": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      return unported("miri::shims::unix::virtual_socket::EvalContextExt::pipe2 (plan-m6 D2: sockets)");
    }
    case "pipe2": {
      // Currently this function does not exist on all Unixes, e.g. on macOS.
      const c = this_.check_target_os(oses("Linux", "Android", "FreeBsd", "Solaris", "Illumos"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      return unported("miri::shims::unix::virtual_socket::EvalContextExt::pipe2 (plan-m6 D2: sockets)");
    }

    // Network sockets
    case "socket": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [domain, type_, protocol] = a._0;
      const result = this_.socket(domain, type_, protocol);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "bind": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "libc::socklen_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len] = a._0;
      const result = this_.bind(socket, address, address_len);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "listen": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, backlog] = a._0;
      const result = this_.listen(socket, backlog);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "accept": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len] = a._0;
      const r = this_.accept4(socket, address, address_len, /* flags */ undefined, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "accept4": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len, flags] = a._0;
      const r = this_.accept4(socket, address, address_len, flags, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "connect": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "libc::socklen_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len] = a._0;
      const r = this_.connect(socket, address, address_len, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "send": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "libc::size_t", "i32"], "libc::ssize_t"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, buffer, length, flags] = a._0;
      const r = this_.send(socket, buffer, length, flags, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "recv": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "libc::size_t", "i32"], "libc::ssize_t"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, buffer, length, flags] = a._0;
      const r = this_.recv(socket, buffer, length, flags, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "setsockopt": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32", "i32", "*_", "libc::socklen_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, level, option_name, option_value, option_len] = a._0;
      const result = this_.setsockopt(socket, level, option_name, option_value, option_len);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getsockopt": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32", "i32", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, level, option_name, option_value, option_len] = a._0;
      const result = this_.getsockopt(socket, level, option_name, option_value, option_len);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getsockname": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len] = a._0;
      const result = this_.getsockname(socket, address, address_len);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getpeername": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [socket, address, address_len] = a._0;
      const r = this_.getpeername(socket, address, address_len, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "shutdown": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [sockfd, how] = a._0;
      const result = this_.shutdown(sockfd, how);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getaddrinfo": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      return unported("miri::shims::unix::socket_address::EvalContextExt::getaddrinfo (plan-m6 D2: sockets)");
    }
    case "freeaddrinfo": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "()"), sig_args);
      if (a.$ === "Err") return a;
      return unported("miri::shims::unix::socket_address::EvalContextExt::freeaddrinfo (plan-m6 D2: sockets)");
    }

    // Time
    case "gettimeofday": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [tv, tz] = a._0;
      const result = this_.gettimeofday(tv, tz);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "localtime_r": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [timep, result_op] = a._0;
      const result = this_.localtime_r(timep, result_op);
      if (result.$ === "Err") return result;
      const w = this_.write_pointer(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "clock_gettime": {
      const a = this_.check_shim_sig(shim_sig("C", ["libc::clockid_t", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [clk_id, tp] = a._0;
      const r = this_.clock_gettime(clk_id, tp, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Allocation
    case "posix_memalign": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "usize"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [memptr, align, size] = a._0;
      const result = this_.posix_memalign(memptr, align, size);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "mmap": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "i32", "i32", "i32", "libc::off_t"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [addr, length, prot, flags, fd, offset] = a._0;
      const offset_ = read_int(this_, offset, this_.libc_ty_layout("off_t").size);
      if (offset_.$ === "Err") return offset_;
      const ptr = this_.mmap(addr, length, prot, flags, fd, offset_._0);
      if (ptr.$ === "Err") return ptr;
      const w = this_.write_scalar(ptr._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "munmap": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [addr, length] = a._0;
      const result = this_.munmap(addr, length);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "mprotect": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [addr, length, prot] = a._0;
      const result = this_.mprotect(addr, length, prot);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "madvise": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [addr, length, advice] = a._0;
      const result = this_.madvise(addr, length, advice);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "reallocarray": {
      // Currently this function does not exist on all Unixes, e.g. on macOS.
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "usize"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [ptr, nmemb, size] = a._0;
      const ptr_ = this_.read_pointer(ptr);
      if (ptr_.$ === "Err") return ptr_;
      const nmemb_ = this_.read_target_usize(nmemb);
      if (nmemb_.$ === "Err") return nmemb_;
      const size_ = this_.read_target_usize(size);
      if (size_.$ === "Err") return size_;
      // reallocarray checks a possible overflow and returns ENOMEM
      // if that happens.
      //
      // Linux: https://www.unix.com/man-page/linux/3/reallocarray/
      // FreeBSD: https://man.freebsd.org/cgi/man.cgi?query=reallocarray
      const len = this_.compute_size_in_bytes(Size.from_bytes(size_._0), nmemb_._0);
      if (len === undefined) {
        const r1 = this_.set_last_error({ $: "LibcError", _0: "ENOMEM" });
        if (r1.$ === "Err") return r1;
        const r2 = this_.write_null(dest);
        if (r2.$ === "Err") return r2;
      } else {
        const res = this_.realloc(ptr_._0, len.bytes_u64());
        if (res.$ === "Err") return res;
        const w = this_.write_pointer(res._0, dest);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case "aligned_alloc": {
      // This is a C11 function, we assume all Unixes have it.
      // (MSVC explicitly does not support this.)
      const a = this_.check_shim_sig(shim_sig("C", ["usize", "usize"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [align, size] = a._0;
      const res = this_.aligned_alloc(align, size);
      if (res.$ === "Err") return res;
      const w = this_.write_pointer(res._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Dynamic symbol loading
    case "dlsym": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [handle, symbol] = a._0;
      const h = this_.read_target_usize(handle);
      if (h.$ === "Err") return h;
      const symbol_ = this_.read_pointer(symbol);
      if (symbol_.$ === "Err") return symbol_;
      const name_bytes = this_.read_c_str(symbol_._0);
      if (name_bytes.$ === "Err") return name_bytes;
      let name: string;
      try {
        name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(name_bytes._0);
      } catch {
        return throw_unsup_format("dlsym: non UTF-8 symbol name not supported");
      }
      if (is_dyn_sym(name, this_.tcx.deref().sess.target.os)) {
        const ptr = this_.fn_ptr({ $: "Other", _0: DynSym.from_str(name) });
        const w = this_.write_pointer(ptr, dest);
        if (w.$ === "Err") return w;
      } else {
        const ptr = this_.machine.extern_statics.get(Symbol.intern(name));
        if (ptr !== undefined) {
          const w = this_.write_pointer(ptr, dest);
          if (w.$ === "Err") return w;
        } else {
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
      }
      break;
    }

    // Thread-local storage
    case "pthread_key_create": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "fn(..) -> _"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [key, dtor] = a._0;
      const key_place = this_.deref_pointer_as(key, this_.libc_ty_layout("pthread_key_t"));
      if (key_place.$ === "Err") return key_place;
      const dtor_ptr = this_.read_pointer(dtor);
      if (dtor_ptr.$ === "Err") return dtor_ptr;

      // Extract the function type out of the signature (that seems easier than constructing it ourselves).
      const is_null = this_.ptr_is_null(dtor_ptr._0);
      if (is_null.$ === "Err") return is_null;
      let dtor_;
      if (!is_null._0) {
        const fn_val = this_.get_ptr_fn(dtor_ptr._0);
        if (fn_val.$ === "Err") return fn_val;
        const instance = FnVal.as_instance(fn_val._0);
        if (instance.$ === "Err") return instance;
        dtor_ = [instance._0, this_.machine.current_user_relevant_span()] as const;
      } else {
        dtor_ = undefined;
      }

      // Figure out how large a pthread TLS key actually is.
      // To this end, deref the argument type. This is `libc::pthread_key_t`.
      const key_type = key.layout.ty.builtin_deref(true);
      if (key_type === undefined) {
        return Err(
          InterpErrorInfo_from_InterpErrorKind({
            $: "UndefinedBehavior",
            _0: { $: "Ub", _0: "wrong signature used for `pthread_key_create`: first argument must be a raw pointer." },
          }),
        );
      }
      const key_layout = this_.layout_of(key_type);
      if (key_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(key_layout._0));

      // Create key and write it into the memory where `key_ptr` wants it.
      const new_key = this_.machine.tls.create_tls_key(dtor_ === undefined ? undefined : [dtor_[0], dtor_[1]], key_layout._0.size);
      if (new_key.$ === "Err") return new_key;
      const w = this_.write_scalar(interp_Scalar.from_uint(new_key._0, key_layout._0.size), key_place._0);
      if (w.$ === "Err") return w;

      // Return success (`0`).
      const w2 = this_.write_null(dest);
      if (w2.$ === "Err") return w2;
      break;
    }
    case "pthread_key_delete": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["libc::pthread_key_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [key] = a._0;
      const key_s = this_.read_scalar(key);
      if (key_s.$ === "Err") return key_s;
      const key_ = interp_Scalar.to_bits(key_s._0, key.layout.size);
      if (key_.$ === "Err") return key_;
      const d = this_.machine.tls.delete_tls_key(key_._0);
      if (d.$ === "Err") return d;
      // Return success (0)
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_getspecific": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["libc::pthread_key_t"], "*_"), sig_args);
      if (a.$ === "Err") return a;
      const [key] = a._0;
      const key_s = this_.read_scalar(key);
      if (key_s.$ === "Err") return key_s;
      const key_ = interp_Scalar.to_bits(key_s._0, key.layout.size);
      if (key_.$ === "Err") return key_;
      const active_thread = this_.active_thread();
      const ptr = this_.machine.tls.load_tls(key_._0, active_thread, this_);
      if (ptr.$ === "Err") return ptr;
      const w = this_.write_scalar(ptr._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_setspecific": {
      const a = this_.check_shim_sig(shim_sig("C", ["libc::pthread_key_t", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [key, new_ptr] = a._0;
      const key_s = this_.read_scalar(key);
      if (key_s.$ === "Err") return key_s;
      const key_ = interp_Scalar.to_bits(key_s._0, key.layout.size);
      if (key_.$ === "Err") return key_;
      const active_thread = this_.active_thread();
      const new_data = this_.read_scalar(new_ptr);
      if (new_data.$ === "Err") return new_data;
      const s = this_.machine.tls.store_tls(key_._0, active_thread, new_data._0, this_.tcx.deref());
      if (s.$ === "Err") return s;

      // Return success (`0`).
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Synchronization primitives
    case "pthread_mutexattr_init": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr] = a._0;
      const r = this_.pthread_mutexattr_init(attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutexattr_settype": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr, kind] = a._0;
      const result = this_.pthread_mutexattr_settype(attr, kind);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutexattr_destroy": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr] = a._0;
      const r = this_.pthread_mutexattr_destroy(attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutex_init": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [mutex, attr] = a._0;
      const r = this_.pthread_mutex_init(mutex, attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutex_lock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [mutex] = a._0;
      const r = this_.pthread_mutex_lock(mutex, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_mutex_trylock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [mutex] = a._0;
      const result = this_.pthread_mutex_trylock(mutex);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutex_unlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [mutex] = a._0;
      const result = this_.pthread_mutex_unlock(mutex);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_mutex_destroy": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [mutex] = a._0;
      const r = this_.pthread_mutex_destroy(mutex);
      if (r.$ === "Err") return r;
      const w = this_.write_int(0n, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_rwlock_rdlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const r = this_.pthread_rwlock_rdlock(rwlock, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_rwlock_tryrdlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const result = this_.pthread_rwlock_tryrdlock(rwlock);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_rwlock_wrlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const r = this_.pthread_rwlock_wrlock(rwlock, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_rwlock_trywrlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const result = this_.pthread_rwlock_trywrlock(rwlock);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_rwlock_unlock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const r = this_.pthread_rwlock_unlock(rwlock);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_rwlock_destroy": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [rwlock] = a._0;
      const r = this_.pthread_rwlock_destroy(rwlock);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_condattr_init": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr] = a._0;
      const r = this_.pthread_condattr_init(attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_condattr_setclock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr, clock_id] = a._0;
      const result = this_.pthread_condattr_setclock(attr, clock_id);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_condattr_getclock": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr, clock_id] = a._0;
      const r = this_.pthread_condattr_getclock(attr, clock_id);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_condattr_destroy": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [attr] = a._0;
      const r = this_.pthread_condattr_destroy(attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_cond_init": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond, attr] = a._0;
      const r = this_.pthread_cond_init(cond, attr);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_cond_signal": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond] = a._0;
      const r = this_.pthread_cond_signal(cond);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_cond_broadcast": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond] = a._0;
      const r = this_.pthread_cond_broadcast(cond);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_cond_wait": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond, mutex] = a._0;
      const r = this_.pthread_cond_wait(cond, mutex, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_cond_timedwait": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond, mutex, abstime] = a._0;
      const r = this_.pthread_cond_timedwait(cond, mutex, abstime, dest, /* macos_relative_np */ false);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_cond_destroy": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [cond] = a._0;
      const r = this_.pthread_cond_destroy(cond);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Threading
    case "pthread_create": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_", "fn(..) -> _", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [thread, attr, start, arg] = a._0;
      const r = this_.pthread_create(thread, attr, start, arg);
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_join": {
      const a = this_.check_shim_sig(shim_sig("C", ["libc::pthread_t", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [thread, retval] = a._0;
      const r = this_.pthread_join(thread, retval, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "pthread_detach": {
      const a = this_.check_shim_sig(shim_sig("C", ["libc::pthread_t"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [thread] = a._0;
      const res = this_.pthread_detach(thread);
      if (res.$ === "Err") return res;
      const w = this_.write_scalar(res._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_self": {
      const a = this_.check_shim_sig(shim_sig("C", [], "libc::pthread_t"), sig_args);
      if (a.$ === "Err") return a;
      const res = this_.pthread_self();
      if (res.$ === "Err") return res;
      const w = this_.write_scalar(res._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "sched_yield": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", [], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const r = this_.sched_yield();
      if (r.$ === "Err") return r;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "nanosleep": {
      const a = this_.check_shim_sig(shim_sig("C", ["*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [duration, rem] = a._0;
      const result = this_.nanosleep(duration, rem);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "clock_nanosleep": {
      // Currently this function does not exist on all Unixes, e.g. on macOS.
      const c = this_.check_target_os(oses("FreeBsd", "Linux", "Android", "Solaris", "Illumos"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["libc::clockid_t", "i32", "*_", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [clock_id, flags, req, rem] = a._0;
      const result = this_.clock_nanosleep(clock_id, flags, req, rem);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "sched_getaffinity": {
      // Currently this function does not exist on all Unixes, e.g. on macOS.
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["libc::pid_t", "usize", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [pid, cpusetsize, mask] = a._0;
      const r = this_.sched_getaffinity(pid, cpusetsize, mask, dest);
      if (r.$ === "Err") return r;
      break;
    }
    case "sched_setaffinity": {
      // Currently this function does not exist on all Unixes, e.g. on macOS.
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["libc::pid_t", "usize", "*_"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [pid, cpusetsize, mask] = a._0;
      const r = this_.sched_setaffinity(pid, cpusetsize, mask, dest);
      if (r.$ === "Err") return r;
      break;
    }

    // Miscellaneous
    case "isatty": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [fd] = a._0;
      const result = this_.isatty(fd);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_atfork": {
      // FIXME: This does not have a direct test (#3179).
      const a = this_.check_shim_sig(shim_sig("C", ["fn(..) -> _", "fn(..) -> _", "fn(..) -> _"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [prepare, parent, child] = a._0;
      const r1 = this_.read_pointer(prepare);
      if (r1.$ === "Err") return r1;
      const r2 = this_.read_pointer(parent);
      if (r2.$ === "Err") return r2;
      const r3 = this_.read_pointer(child);
      if (r3.$ === "Err") return r3;
      // We do not support forking, so there is nothing to do here.
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "strerror_r": {
      const a = this_.check_shim_sig(shim_sig("C", ["i32", "*_", "usize"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [errnum, buf, buflen] = a._0;
      const result = this_.strerror_r(errnum, buf, buflen);
      if (result.$ === "Err") return result;
      const w = this_.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "getentropy": {
      // This function is non-standard but exists with the same signature and behavior on
      // Linux, macOS, FreeBSD and Solaris/Illumos.
      const c = this_.check_target_os(oses("Linux", "MacOs", "FreeBsd", "Illumos", "Solaris", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize"], "i32"), sig_args);
      if (a.$ === "Err") return a;
      const [buf, bufsize] = a._0;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const bufsize_ = this_.read_target_usize(bufsize);
      if (bufsize_.$ === "Err") return bufsize_;

      // getentropy sets errno to EIO when the buffer size exceeds 256 bytes.
      // FreeBSD: https://man.freebsd.org/cgi/man.cgi?query=getentropy&sektion=3&format=html
      // Linux: https://man7.org/linux/man-pages/man3/getentropy.3.html
      // macOS: https://keith.github.io/xcode-man-pages/getentropy.2.html
      // Solaris/Illumos: https://illumos.org/man/3C/getentropy
      if (bufsize_._0 > 256n) {
        const r = this_.set_errno_and_return_neg1({ $: "LibcError", _0: "EIO" }, dest);
        if (r.$ === "Err") return r;
      } else {
        const r = this_.gen_random(buf_._0, bufsize_._0);
        if (r.$ === "Err") return r;
        const w = this_.write_null(dest);
        if (w.$ === "Err") return w;
      }
      break;
    }
    case "getrandom": {
      // This function is non-standard but exists with the same signature and behavior on
      // Linux, FreeBSD and Solaris/Illumos.
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Illumos", "Solaris", "Android"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize", "u32"], "isize"), sig_args);
      if (a.$ === "Err") return a;
      const [ptr, len, flags] = a._0;
      const ptr_ = this_.read_pointer(ptr);
      if (ptr_.$ === "Err") return ptr_;
      const len_ = this_.read_target_usize(len);
      if (len_.$ === "Err") return len_;
      const _flags = read_i32(this_, flags);
      if (_flags.$ === "Err") return _flags;
      // We ignore the flags, just always use the same PRNG / host RNG.
      const r = this_.gen_random(ptr_._0, len_._0);
      if (r.$ === "Err") return r;
      const w = this_.write_scalar(interp_Scalar.from_target_usize(len_._0, this_), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "arc4random_buf": {
      // This function is non-standard but exists with the same signature and
      // same behavior (eg never fails) on FreeBSD and Solaris/Illumos.
      const c = this_.check_target_os(oses("FreeBsd", "Illumos", "Solaris"), link_name);
      if (c.$ === "Err") return c;

      const a = this_.check_shim_sig(shim_sig("C", ["*_", "usize"], "()"), sig_args);
      if (a.$ === "Err") return a;
      const [ptr, len] = a._0;
      const ptr_ = this_.read_pointer(ptr);
      if (ptr_.$ === "Err") return ptr_;
      const len_ = this_.read_target_usize(len);
      if (len_.$ === "Err") return len_;
      const r = this_.gen_random(ptr_._0, len_._0);
      if (r.$ === "Err") return r;
      break;
    }
    case "_Unwind_RaiseException": {
      // This is not formally part of POSIX, but it is very wide-spread on POSIX systems.
      // It was originally specified as part of the Itanium C++ ABI:
      // https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html#base-throw.
      // On Linux it is
      // documented as part of the LSB:
      // https://refspecs.linuxfoundation.org/LSB_5.0.0/LSB-Core-generic/LSB-Core-generic/baselib--unwind-raiseexception.html
      // Basically every other UNIX uses the exact same api though. Arm also references
      // back to the Itanium C++ ABI for the definition of `_Unwind_RaiseException` for
      // arm64:
      // https://github.com/ARM-software/abi-aa/blob/main/cppabi64/cppabi64.rst#toc-entry-35
      // For arm32 they did something custom, but similar enough that the same
      // `_Unwind_RaiseException` impl in miri should work:
      // https://github.com/ARM-software/abi-aa/blob/main/ehabi32/ehabi32.rst
      const c = this_.check_target_os(oses("Linux", "FreeBsd", "Illumos", "Solaris", "Android", "MacOs"), link_name);
      if (c.$ === "Err") return c;

      // This function looks and behaves exactly like miri_start_unwind.
      const a = this_.check_shim_sig(
        // Look up the return type via `panic_unwind::`, not via `unwind::`, as
        // the latter it not always unique.
        shim_sig("C", ["*_"], "panic_unwind::imp::uw::_Unwind_Reason_Code"),
        sig_args,
      );
      if (a.$ === "Err") return a;
      const [payload] = a._0;
      const r = this_.handle_miri_start_unwind(payload);
      if (r.$ === "Err") return r;
      return interp_ok("NeedsUnwind");
    }
    case "getuid":
    case "geteuid": {
      const a = this_.check_shim_sig(shim_sig("C", [], "libc::uid_t"), sig_args);
      if (a.$ === "Err") return a;
      // For now, just pretend we always have this fixed UID.
      const w = this_.write_int(BigInt(UID), dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Incomplete shims that we "stub out" just to get pre-main initialization code to work.
    // These shims are enabled only when the caller is in the standard library.
    case "pthread_attr_getguardsize": {
      if (!this_.frame_in_std()) return platform_specific();
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 2);
      if (a.$ === "Err") return a;
      const [_attr, guard_size] = a._0;
      const guard_size_layout = this_.machine.layouts.usize;
      const guard_size_ = this_.deref_pointer_as(guard_size, guard_size_layout);
      if (guard_size_.$ === "Err") return guard_size_;
      const w = this_.write_scalar(interp_Scalar.from_uint(this_.machine.page_size, guard_size_layout.size), guard_size_._0);
      if (w.$ === "Err") return w;

      // Return success (`0`).
      const w2 = this_.write_null(dest);
      if (w2.$ === "Err") return w2;
      break;
    }

    case "pthread_attr_init":
    case "pthread_attr_destroy": {
      if (!this_.frame_in_std()) return platform_specific();
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 1);
      if (a.$ === "Err") return a;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "pthread_attr_setstacksize": {
      if (!this_.frame_in_std()) return platform_specific();
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 2);
      if (a.$ === "Err") return a;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "pthread_attr_getstack": {
      if (!this_.frame_in_std()) return platform_specific();
      // We don't support "pthread_attr_setstack", so we just pretend all stacks have the same values here.
      // Hence we can mostly ignore the input `attr_place`.
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 3);
      if (a.$ === "Err") return a;
      const [attr_place, addr_place, size_place] = a._0;
      const _attr_place = this_.deref_pointer_as(attr_place, this_.libc_ty_layout("pthread_attr_t"));
      if (_attr_place.$ === "Err") return _attr_place;
      const addr_place_ = this_.deref_pointer_as(addr_place, this_.machine.layouts.usize);
      if (addr_place_.$ === "Err") return addr_place_;
      const size_place_ = this_.deref_pointer_as(size_place, this_.machine.layouts.usize);
      if (size_place_.$ === "Err") return size_place_;

      const w1 = this_.write_scalar(interp_Scalar.from_uint(this_.machine.stack_addr, PointerArithmetic_provided.pointer_size(this_)), addr_place_._0);
      if (w1.$ === "Err") return w1;
      const w2 = this_.write_scalar(interp_Scalar.from_uint(this_.machine.stack_size, PointerArithmetic_provided.pointer_size(this_)), size_place_._0);
      if (w2.$ === "Err") return w2;

      // Return success (`0`).
      const w3 = this_.write_null(dest);
      if (w3.$ === "Err") return w3;
      break;
    }

    case "signal":
    case "sigaltstack": {
      if (!this_.frame_in_std()) return platform_specific();
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 2);
      if (a.$ === "Err") return a;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }
    case "sigaction": {
      if (!this_.frame_in_std()) return platform_specific();
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 3);
      if (a.$ === "Err") return a;
      const w = this_.write_null(dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "getpwuid_r":
    case "__posix_getpwuid_r": {
      if (!this_.frame_in_std()) return platform_specific();
      // getpwuid_r is the standard name, __posix_getpwuid_r is used on solarish
      const a = check_shim_sig_deprecated(this_, abi, link_name, args, 5);
      if (a.$ === "Err") return a;
      const [uid, pwd, buf, buflen, result] = a._0;
      const c = this_.check_no_isolation("`getpwuid_r`");
      if (c.$ === "Err") return c;

      const uid_s = this_.read_scalar(uid);
      if (uid_s.$ === "Err") return uid_s;
      const uid_ = interp_Scalar.to_u32(uid_s._0);
      if (uid_.$ === "Err") return uid_;
      const pwd_ = this_.deref_pointer_as(pwd, this_.libc_ty_layout("passwd"));
      if (pwd_.$ === "Err") return pwd_;
      const buf_ = this_.read_pointer(buf);
      if (buf_.$ === "Err") return buf_;
      const buflen_ = this_.read_target_usize(buflen);
      if (buflen_.$ === "Err") return buflen_;
      const result_ = this_.deref_pointer_as(result, this_.machine.layouts.unit_ptr_mut);
      if (result_.$ === "Err") return result_;

      // Must be for "us".
      if (uid_._0 !== UID) {
        return throw_unsup_format("`getpwuid_r` on other users is not supported");
      }

      // Reset all fields to `uninit` to make sure nobody reads them.
      // (This is a std-only shim so we are okay with such hacks.)
      const u = this_.write_uninit(pwd_._0);
      if (u.$ === "Err") return u;

      // We only set the home_dir field.
      // #[allow(deprecated)]
      const home_dir = process.env.HOME ?? homedir();
      const w = this_.write_path_to_c_str(home_dir, buf_._0, buflen_._0);
      if (w.$ === "Err") return w;
      const [written, _] = w._0;
      const pw_dir = this_.project_field_named(pwd_._0, "pw_dir");
      if (pw_dir.$ === "Err") return pw_dir;
      const w2 = this_.write_pointer(buf_._0, pw_dir._0);
      if (w2.$ === "Err") return w2;

      if (written) {
        const w3 = this_.write_pointer(pwd_._0.ptr(), result_._0);
        if (w3.$ === "Err") return w3;
        const w4 = this_.write_null(dest);
        if (w4.$ === "Err") return w4;
      } else {
        const w3 = this_.write_null(result_._0);
        if (w3.$ === "Err") return w3;
        const w4 = this_.write_scalar(this_.eval_libc("ERANGE"), dest);
        if (w4.$ === "Err") return w4;
      }
      break;
    }

    // Platform-specific shims
    default:
      return platform_specific();
  }

  return interp_ok("NeedsReturn");
}
