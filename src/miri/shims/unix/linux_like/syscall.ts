// Port of src/tools/miri/src/shims/unix/linux_like/syscall.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e`
// (plan-m6 wave 37).
//
// PORT: `shim_sig!(..)` / `shim_varargs![..]` are shims/sig.ts's `shim_sig(abi, args, ret)` / `shim_varargs(..tys)` (lane
// miri-shims-b, agreed contract: string type specs), called through the module namespace when the `check_*` fn evaluates
// the closure (macro expansion at the call site).
import { type MPlaceTy, type OpTy } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import * as sig from "../../sig.ts";
import { type ShimSig } from "../../sig.ts";
import "../env.ts"; // use crate::shims::unix::env::EvalContextExt;
import "./eventfd.ts"; // use crate::shims::unix::linux_like::eventfd::EvalContextExt as _;
import { futex } from "./sync.ts";
import "../socket.ts"; // use crate::shims::unix::socket::EvalContextExt as _;
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as ScalarNs } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../../../rustc_span/symbol.ts";
import { Err } from "../../../../std/result.ts";

/** `shim_sig!(extern "<abi>" fn(<args>) -> <ret>)` */
function shim_sig_(abi: string, args: readonly string[], ret: string): (this_: MiriInterpCx) => ShimSig {
  return (this_) => sig.shim_sig(abi, args, ret)(this_);
}
/** `shim_varargs![..]` */
function shim_varargs_(...tys: string[]): (this_: MiriInterpCx) => Ty[] {
  return (this_) => sig.shim_varargs(...tys)(this_);
}
/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

// rustc: src/tools/miri/src/shims/unix/linux_like/syscall.rs:11 syscall
export function syscall(ecx: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult {
  const c = ecx.check_shim_sig_variadic(shim_sig_("C", ["isize", "..."], "isize"), [link_name, abi, args]);
  if (c.$ === "Err") return c;
  const [[op], varargs] = [c._0[0], c._0[1]];
  // The syscall variadic function is legal to call with more arguments than needed,
  // extra arguments are simply ignored. The important check is that when we use an
  // argument, we have to also check all arguments *before* it to ensure that they
  // have the right type.

  const s1 = ScalarNs.to_target_usize(ecx.eval_libc("SYS_getrandom"), ecx);
  if (s1.$ === "Err") return s1;
  const sys_getrandom = s1._0;
  const s2 = ScalarNs.to_target_usize(ecx.eval_libc("SYS_futex"), ecx);
  if (s2.$ === "Err") return s2;
  const sys_futex = s2._0;
  const s3 = ScalarNs.to_target_usize(ecx.eval_libc("SYS_eventfd2"), ecx);
  if (s3.$ === "Err") return s3;
  const sys_eventfd2 = s3._0;
  const s4 = ScalarNs.to_target_usize(ecx.eval_libc("SYS_gettid"), ecx);
  if (s4.$ === "Err") return s4;
  const sys_gettid = s4._0;
  const s5 = ScalarNs.to_target_usize(ecx.eval_libc("SYS_accept4"), ecx);
  if (s5.$ === "Err") return s5;
  const sys_accept4 = s5._0;

  const n = ecx.read_target_usize(op);
  if (n.$ === "Err") return n;
  const num = n._0;
  // `libc::syscall(NR_GETRANDOM, buf.as_mut_ptr(), buf.len(), GRND_NONBLOCK)`
  // is called if a `HashMap` is created the regular way (e.g. HashMap<K, V>).
  if (num === sys_getrandom) {
    // Used by getrandom 0.1
    // The first argument is the syscall id, so skip over it.
    const v = ecx.check_varargs(shim_varargs_("*libc::c_void", "usize", "i32"), varargs, "syscall(SYS_getrandom, ...)");
    if (v.$ === "Err") return v;
    const [ptr_op, len_op, flags_op] = v._0[0];

    const p = ecx.read_pointer(ptr_op);
    if (p.$ === "Err") return p;
    const ptr = p._0;
    const l = ecx.read_target_usize(len_op);
    if (l.$ === "Err") return l;
    const len = l._0;
    // The only supported flags are GRND_RANDOM and GRND_NONBLOCK,
    // neither of which have any effect on our current PRNG.
    // See <https://github.com/rust-lang/rust/pull/79196> for a discussion of argument sizes.
    const f = ecx.read_scalar(flags_op);
    if (f.$ === "Err") return f;
    const fi = ScalarNs.to_i32(f._0);
    if (fi.$ === "Err") return fi;
    const _flags = fi._0;

    const g = ecx.gen_random(ptr, len);
    if (g.$ === "Err") return g;
    const w = ecx.write_scalar(ScalarNs.from_target_usize(len, ecx), dest);
    if (w.$ === "Err") return w;
  }
  // `futex` is used by some synchronization primitives.
  else if (num === sys_futex) {
    const r = futex(ecx, varargs, dest);
    if (r.$ === "Err") return r;
  } else if (num === sys_eventfd2) {
    const v = ecx.check_varargs(shim_varargs_("u32", "i32"), varargs, "syscall(SYS_evetfd2, ...)");
    if (v.$ === "Err") return v;
    const [initval, flags] = v._0[0];

    const r = ecx.eventfd(initval, flags);
    if (r.$ === "Err") return r;
    const ri = ScalarNs.to_i32(r._0);
    if (ri.$ === "Err") return ri;
    const w = ecx.write_int(BigInt(ri._0), dest);
    if (w.$ === "Err") return w;
  } else if (num === sys_gettid) {
    const r = ecx.unix_gettid("SYS_gettid");
    if (r.$ === "Err") return r;
    const ru = ScalarNs.to_u32(r._0);
    if (ru.$ === "Err") return ru;
    const w = ecx.write_int(BigInt(ru._0), dest);
    if (w.$ === "Err") return w;
  } else if (num === sys_accept4) {
    // Used on Android.
    const v = ecx.check_varargs(shim_varargs_("i32", "*libc::sockaddr", "*libc::socklen_t", "i32"), varargs, "syscall(SYS_accept4, ...)");
    if (v.$ === "Err") return v;
    const [socket, address, address_len, flags] = v._0[0];
    const r = ecx.accept4(socket, address, address_len, flags, dest);
    if (r.$ === "Err") return r;
  } else {
    return throw_unsup_format(`syscall: unsupported syscall number ${num}`);
  }

  return interp_ok(undefined);
}
