// Port of src/tools/miri/src/shims/panic.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
//! Helper functions for causing panics.
//
// PORT: `this.tcx.lang_items().x().unwrap()` is `unwrap(..)`; `this.tcx.tcx` is `this.tcx.deref()`.
import { type MiriInterpCx } from "../machine.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type AssertMessage } from "../../rustc_middle/mir/syntax.gen.ts";
import { AssertKind } from "../../rustc_middle/mir/syntax.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { unwrap } from "../../std/panic.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/panic.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/panic.rs:11
    start_panic(this: MiriInterpCx, msg: string, unwind: UnwindAction): InterpResult;
    // shims/panic.rs:30
    start_panic_nounwind(this: MiriInterpCx, msg: string): InterpResult;
    // shims/panic.rs:48
    assert_panic(this: MiriInterpCx, msg: AssertMessage, unwind: UnwindAction): InterpResult;
  }
}

/// Start a panic in the interpreter with the given message as payload.
// rustc: src/tools/miri/src/shims/panic.rs:11 start_panic
InterpCx.prototype.start_panic = function (this: MiriInterpCx, msg: string, unwind: UnwindAction): InterpResult {
  const this_ = this.eval_context_mut();

  // First arg: message.
  const msg_ = this_.allocate_str_dedup(msg);
  if (msg_.$ === "Err") return msg_;

  // Call the lang item.
  const tcx = this_.tcx.deref();
  const panic_ = Instance.mono(tcx, unwrap(tcx.lang_items().panic_fn()));
  const arg = this_.mplace_to_imm_ptr(msg_._0, undefined);
  if (arg.$ === "Err") return arg;
  return this_.call_function(panic_, ExternAbi.Rust, [arg._0], undefined, { $: "Goto", ret: undefined, unwind });
};

/// Start a non-unwinding panic in the interpreter with the given message as payload.
// rustc: src/tools/miri/src/shims/panic.rs:30 start_panic_nounwind
InterpCx.prototype.start_panic_nounwind = function (this: MiriInterpCx, msg: string): InterpResult {
  const this_ = this.eval_context_mut();

  // First arg: message.
  const msg_ = this_.allocate_str_dedup(msg);
  if (msg_.$ === "Err") return msg_;

  // Call the lang item.
  const tcx = this_.tcx.deref();
  const panic_ = Instance.mono(tcx, unwrap(tcx.lang_items().panic_nounwind()));
  const arg = this_.mplace_to_imm_ptr(msg_._0, undefined);
  if (arg.$ === "Err") return arg;
  return this_.call_function(panic_, ExternAbi.Rust, [arg._0], undefined, {
    $: "Goto",
    ret: undefined,
    unwind: UnwindAction.Unreachable,
  });
};

// rustc: src/tools/miri/src/shims/panic.rs:48 assert_panic
InterpCx.prototype.assert_panic = function (this: MiriInterpCx, msg: AssertMessage, unwind: UnwindAction): InterpResult {
  // use rustc_middle::mir::AssertKind::*;
  const this_ = this.eval_context_mut();
  const tcx = this_.tcx.deref();

  switch (msg.$) {
    case "BoundsCheck": {
      const { index, len } = msg;
      // Forward to `panic_bounds_check` lang item.

      // First arg: index.
      const index_op = this_.eval_operand(index, undefined);
      if (index_op.$ === "Err") return index_op;
      const index_ = this_.read_immediate(index_op._0);
      if (index_.$ === "Err") return index_;
      // Second arg: len.
      const len_op = this_.eval_operand(len, undefined);
      if (len_op.$ === "Err") return len_op;
      const len_ = this_.read_immediate(len_op._0);
      if (len_.$ === "Err") return len_;

      // Call the lang item.
      const panic_bounds_check = Instance.mono(tcx, unwrap(tcx.lang_items().panic_bounds_check_fn()));
      const r = this_.call_function(panic_bounds_check, ExternAbi.Rust, [index_._0, len_._0], undefined, {
        $: "Goto",
        ret: undefined,
        unwind,
      });
      if (r.$ === "Err") return r;
      break;
    }
    case "MisalignedPointerDereference": {
      const { required, found } = msg;
      // Forward to `panic_misaligned_pointer_dereference` lang item.

      // First arg: required.
      const required_op = this_.eval_operand(required, undefined);
      if (required_op.$ === "Err") return required_op;
      const required_ = this_.read_immediate(required_op._0);
      if (required_.$ === "Err") return required_;
      // Second arg: found.
      const found_op = this_.eval_operand(found, undefined);
      if (found_op.$ === "Err") return found_op;
      const found_ = this_.read_immediate(found_op._0);
      if (found_.$ === "Err") return found_;

      // Call the lang item.
      const panic_misaligned_pointer_dereference = Instance.mono(
        tcx,
        unwrap(tcx.lang_items().panic_misaligned_pointer_dereference_fn()),
      );
      const r = this_.call_function(
        panic_misaligned_pointer_dereference,
        ExternAbi.Rust,
        [required_._0, found_._0],
        undefined,
        { $: "Goto", ret: undefined, unwind },
      );
      if (r.$ === "Err") return r;
      break;
    }

    default: {
      // Call the lang item associated with this message.
      const fn_item = tcx.require_lang_item(AssertKind.panic_function(msg), this_.tcx.span);
      const instance = Instance.mono(tcx, fn_item);
      const r = this_.call_function(instance, ExternAbi.Rust, [], undefined, { $: "Goto", ret: undefined, unwind });
      if (r.$ === "Err") return r;
      break;
    }
  }
  return interp_ok(undefined);
};
