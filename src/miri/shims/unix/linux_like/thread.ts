// Port of src/tools/miri/src/shims/unix/linux_like/thread.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-shims-e`
// (plan-m6 wave 37).
//
// PORT: `shim_sig!(..)` / `shim_varargs![..]` as in syscall.ts (shims/sig.ts).
import { type MPlaceTy, type OpTy } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import { shim_sig, shim_varargs } from "../../sig.ts";
import { type ShimSig } from "../../sig.ts";
import { type ThreadNameResult } from "../thread.ts"; // use crate::shims::unix::thread::{EvalContextExt as _, ThreadNameResult};
import { Size } from "../../../../rustc_abi/lib.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, type Scalar, Scalar as ScalarNs } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../../../rustc_span/symbol.ts";
import { panic } from "../../../../std/panic.ts";
import { Err } from "../../../../std/result.ts";
import { type Provenance } from "../../../machine.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `assert_eq!(res, ThreadNameResult::Ok)` */
function assert_eq_ThreadNameResult(left: ThreadNameResult, right: ThreadNameResult): void {
  if (left !== right) panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
}

const TASK_COMM_LEN = 16n;

// rustc: src/tools/miri/src/shims/unix/linux_like/thread.rs:11 prctl
export function prctl(ecx: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult {
  const c = ecx.check_shim_sig_variadic(shim_sig("C", ["i32", "..."], "i32"), [link_name, abi, args]);
  if (c.$ === "Err") return c;
  const [[op_op], varargs] = [c._0[0], c._0[1]];

  const pr_set_name = ecx.eval_libc_i32("PR_SET_NAME");
  const pr_get_name = ecx.eval_libc_i32("PR_GET_NAME");

  const o = ecx.read_scalar(op_op);
  if (o.$ === "Err") return o;
  const oi = ScalarNs.to_i32(o._0);
  if (oi.$ === "Err") return oi;
  const op = oi._0;
  let res: Scalar<Provenance>;
  if (op === pr_set_name) {
    const v = ecx.check_varargs(shim_varargs("*libc::c_char"), varargs, "prctl(PR_SET_NAME, ...)");
    if (v.$ === "Err") return v;
    const [name_op] = v._0[0];

    const n = ecx.read_scalar(name_op);
    if (n.$ === "Err") return n;
    const name = n._0;
    const t = ecx.pthread_self();
    if (t.$ === "Err") return t;
    const thread = t._0;
    // The Linux kernel silently truncates long names.
    // https://www.man7.org/linux/man-pages/man2/PR_SET_NAME.2const.html
    const r = ecx.pthread_setname_np(thread, name, TASK_COMM_LEN, /* truncate */ true);
    if (r.$ === "Err") return r;
    assert_eq_ThreadNameResult(r._0, "Ok");
    res = ScalarNs.from_u32(0);
  } else if (op === pr_get_name) {
    const v = ecx.check_varargs(shim_varargs("*libc::c_char"), varargs, "prctl(PR_GET_NAME, ...)");
    if (v.$ === "Err") return v;
    const [name_op] = v._0[0];

    const n = ecx.read_scalar(name_op);
    if (n.$ === "Err") return n;
    const name = n._0;
    const t = ecx.pthread_self();
    if (t.$ === "Err") return t;
    const thread = t._0;
    const len = ScalarNs.from_target_usize<Provenance>(TASK_COMM_LEN, ecx);
    const a = ecx.check_ptr_access(ScalarNs.to_pointer(name, ecx), Size.from_bytes(TASK_COMM_LEN), { $: "MemoryAccess" });
    if (a.$ === "Err") return a;
    const r = ecx.pthread_getname_np(thread, name, len, /* truncate*/ false);
    if (r.$ === "Err") return r;
    assert_eq_ThreadNameResult(r._0, "Ok");
    res = ScalarNs.from_u32(0);
  } else {
    return throw_unsup_format(`Miri does not support \`prctl\` syscall with op=${op}`);
  }
  const w = ecx.write_scalar(res, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
}
