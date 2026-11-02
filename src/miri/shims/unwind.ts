// Port of src/tools/miri/src/shims/unwind.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into unwind.gen.ts (tools/codegen set `miri`); this module re-exports them.
//! Unwinding runtime for Miri.
//!
//! The core pieces of the runtime are:
//! - An implementation of `catch_unwind` that pushes the invoked stack frame with
//!   some extra metadata derived from the panic-catching arguments of `catch_unwind`.
//! - A hack in `libpanic_unwind` that calls the `miri_start_unwind` intrinsic instead of the
//!   target-native panic runtime. (This lives in the rustc repo.)
//! - An implementation of `miri_start_unwind` that stores its argument (the panic payload), and
//!   then immediately returns, but on the *unwind* edge (not the normal return edge), thus
//!   initiating unwinding.
//! - A hook executed each time a frame is popped, such that if the frame pushed by `catch_unwind`
//!   gets popped *during unwinding*, we take the panic payload and store it according to the extra
//!   metadata we remembered when pushing said frame.
//
// PORT:
// - `impl VisitProvenance for CatchUnwindData` is the table `VisitProvenance_CatchUnwindData` (`CatchUnwindData` is a
//   generated interface; borrowck-contract rule 5), read by machine.ts's `VisitProvenance_FrameExtra`.
// - `trace!` is compiled out of the release oracle (plan-m6 A6): kept as comments.
// - `extra.catch_unwind.take()` reads the field and sets it to `undefined`.
import { type OpTy, type PlaceTy } from "../lib.ts";
import { type FrameExtra, type MiriInterpCx, type Provenance } from "../machine.ts";
import { type Frame } from "../../rustc_const_eval/interpret/stack.gen.ts";
import { VisitProvenance_ImmTy, VisitProvenance_MPlaceTy, VisitProvenance_Pointer, type VisitWith } from "../provenance_gc.ts";
import { type CatchUnwindData } from "./unwind.gen.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type ReturnAction } from "../../rustc_const_eval/interpret/machine.gen.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { FnVal } from "../../rustc_const_eval/interpret/memory.ts";
import { type InterpResult, interp_ok, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { unwrap } from "../../std/panic.ts";
export * from "./unwind.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unwind.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unwind.rs:47
    handle_miri_start_unwind(this: MiriInterpCx, payload: OpTy): InterpResult;
    // shims/unwind.rs:60
    handle_catch_unwind(this: MiriInterpCx, try_fn: OpTy, data: OpTy, catch_fn: OpTy, dest: PlaceTy, ret: BasicBlock | undefined): InterpResult;
    // shims/unwind.rs:114
    handle_stack_pop_unwind(this: MiriInterpCx, extra: FrameExtra, unwinding: boolean): InterpResult<ReturnAction>;
  }
}

// impl VisitProvenance for CatchUnwindData<'_>
export const VisitProvenance_CatchUnwindData = {
  // rustc: src/tools/miri/src/shims/unwind.rs:35 visit_provenance
  visit_provenance(self: CatchUnwindData, visit: VisitWith): void {
    const { catch_fn, data, dest, ret: _ret } = self;
    VisitProvenance_Pointer.visit_provenance(catch_fn, visit);
    VisitProvenance_ImmTy.visit_provenance(data, visit);
    VisitProvenance_MPlaceTy.visit_provenance(dest, visit);
  },
};

/// Handles the special `miri_start_unwind` intrinsic, which is called
/// by libpanic_unwind to delegate the actual unwinding process to Miri.
// rustc: src/tools/miri/src/shims/unwind.rs:47 handle_miri_start_unwind
InterpCx.prototype.handle_miri_start_unwind = function (this: MiriInterpCx, payload: OpTy): InterpResult {
  const this_ = this.eval_context_mut();

  // trace!("miri_start_unwind: {:?}", this.frame().instance());

  const payload_ = this_.read_immediate(payload);
  if (payload_.$ === "Err") return payload_;
  const thread = this_.active_thread_mut();
  thread.unwind_payloads.push(payload_._0);

  return interp_ok(undefined);
};

/// Handles the `catch_unwind` intrinsic.
// rustc: src/tools/miri/src/shims/unwind.rs:60 handle_catch_unwind
InterpCx.prototype.handle_catch_unwind = function (
  this: MiriInterpCx,
  try_fn: OpTy,
  data: OpTy,
  catch_fn: OpTy,
  dest: PlaceTy,
  ret: BasicBlock | undefined,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Signature:
  //   fn catch_unwind(try_fn: unsafe fn(*mut Data), data: *mut Data, catch_fn: unsafe fn(*mut Data, *mut u8)) -> bool
  // Calls `try_fn` with `data` as argument. If that executes normally, returns 0.
  // If that unwinds, calls `catch_fn` with the first argument being `data` and
  // then second argument being a target-dependent `payload` (i.e. it is up to us to define
  // what that is), and returns 1.
  // The `payload` is passed (by libstd) to `__rust_panic_cleanup`, which is then expected to
  // return a `Box<dyn Any + Send + 'static>`.
  // In Miri, `miri_start_unwind` is passed exactly that type, so we make the `payload` simply
  // a pointer to `Box<dyn Any + Send + 'static>`.

  // Get all the arguments.
  const try_fn_ = this_.read_pointer(try_fn);
  if (try_fn_.$ === "Err") return try_fn_;
  const data_ = this_.read_immediate(data);
  if (data_.$ === "Err") return data_;
  const catch_fn_ = this_.read_pointer(catch_fn);
  if (catch_fn_.$ === "Err") return catch_fn_;
  const dest_ = this_.force_allocation(dest); // needs to be valid across fn calls
  if (dest_.$ === "Err") return dest_;

  // Now we make a function call, and pass `data` as first and only argument.
  const fn_r = this_.get_ptr_fn(try_fn_._0);
  if (fn_r.$ === "Err") return fn_r;
  const f_instance = FnVal.as_instance(fn_r._0);
  if (f_instance.$ === "Err") return f_instance;
  // trace!("try_fn: {:?}", f_instance);
  const c = this_.call_function(
    f_instance._0,
    ExternAbi.Rust,
    [data_._0],
    undefined,
    // Directly return to caller.
    { $: "Goto", ret, unwind: UnwindAction.Continue },
  );
  if (c.$ === "Err") return c;

  // We ourselves will return `0`, eventually (will be overwritten if we catch a panic).
  const w = this_.write_null(dest_._0);
  if (w.$ === "Err") return w;

  // In unwind mode, we tag this frame with the extra data needed to catch unwinding.
  // This lets `handle_stack_pop` (below) know that we should stop unwinding
  // when we pop this frame.
  if (this_.tcx.deref().sess.panic_strategy() === "Unwind") {
    (this_.frame_mut() as unknown as Frame<Provenance, FrameExtra>).extra.catch_unwind = { catch_fn: catch_fn_._0, data: data_._0, dest: dest_._0, ret };
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/unwind.rs:114 handle_stack_pop_unwind
InterpCx.prototype.handle_stack_pop_unwind = function (this: MiriInterpCx, extra: FrameExtra, unwinding: boolean): InterpResult<ReturnAction> {
  const this_ = this.eval_context_mut();
  // trace!("handle_stack_pop_unwind(extra = {:?}, unwinding = {})", extra, unwinding);

  // We only care about `catch_panic` if we're unwinding - if we're doing a normal
  // return, then we don't need to do anything special.
  // `if let (true, Some(catch_unwind)) = (unwinding, extra.catch_unwind.take())`: the `take()` happens either way.
  const catch_unwind = extra.catch_unwind;
  extra.catch_unwind = undefined;
  if (unwinding && catch_unwind !== undefined) {
    // We've just popped a frame that was pushed by `catch_unwind`,
    // and we are unwinding, so we should catch that.
    // trace!(
    //     "unwinding: found catch_panic frame during unwinding: {:?}",
    //     this.frame().instance()
    // );

    // We set the return value of `catch_unwind` to 1, since there was a panic.
    const w = this_.write_scalar(Scalar.from_bool(true), catch_unwind.dest);
    if (w.$ === "Err") return w;

    // The Thread's `panic_payload` holds what was passed to `miri_start_unwind`.
    // This is exactly the second argument we need to pass to `catch_fn`.
    const payload = unwrap(this_.active_thread_mut().unwind_payloads.pop());

    // Push the `catch_fn` stackframe.
    const fn_r = this_.get_ptr_fn(catch_unwind.catch_fn);
    if (fn_r.$ === "Err") return fn_r;
    const f_instance = FnVal.as_instance(fn_r._0);
    if (f_instance.$ === "Err") return f_instance;
    // trace!("catch_fn: {:?}", f_instance);
    const c = this_.call_function(
      f_instance._0,
      ExternAbi.Rust,
      [catch_unwind.data, payload],
      undefined,
      // Directly return to caller of `catch_unwind`.
      {
        $: "Goto",
        ret: catch_unwind.ret,
        // `catch_fn` must not unwind.
        unwind: UnwindAction.Unreachable,
      },
    );
    if (c.$ === "Err") return c;

    // We pushed a new stack frame, the engine should not do any jumping now!
    return interp_ok("NoJump");
  } else {
    return interp_ok("Normal");
  }
};
