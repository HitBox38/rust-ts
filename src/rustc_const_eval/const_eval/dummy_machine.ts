// Port of compiler/rustc_const_eval/src/const_eval/dummy_machine.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { FnArg } from "../interpret/call.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { type AllocId, type ConstAllocation, type CtfeProvenance, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type AssertMessage, type BasicBlock, type BinOp, type Body, type RuntimeChecks, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { type Fmt } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import { compile_time_machine } from "../interpret/machine.ts";
import type { HasStaticRootDefId } from "../interpret/intern.ts";

export * from "./dummy_machine.gen.ts";
import { ImmTy, OpTy } from "../interpret/operand.gen.ts";
import { PlaceTy } from "../interpret/place.gen.ts";
import { Frame } from "../interpret/stack.gen.ts";

/// Macro for machine-specific `InterpError` without allocation.
/// (These will never be shown to the user, but they help diagnose ICEs.)
// pub macro throw_machine_stop_str($($tt:tt)*)
// PORT: the macro's local `struct Zst` (whose `Display` prints the message) is `Zst` below; the macro is expanded inline
// by its users (`throw_machine_stop!(Zst)` with the formatted message).

// rustc-type: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:34 DummyMachine
// PORT (D8): the unit struct is a class (`DummyMachine` is `new DummyMachine()`, precedent `MaybeLiveLocals`); `impl Machine
// for DummyMachine` (with `compile_time_machine!(<'tcx>)`) extends the macro's base class (interpret/machine.ts header).
export class DummyMachine extends compile_time_machine implements HasStaticRootDefId {
  // ---- impl HasStaticRootDefId for DummyMachine ----
  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:37 static_def_id
  static_def_id(): LocalDefId | undefined {
    return undefined;
  }

  // ---- impl<'tcx> interpret::Machine<'tcx> for DummyMachine ----
  // interpret::compile_time_machine!(<'tcx>);
  readonly PANIC_ON_ALLOC_FAIL: boolean = true;

  // We want to just eval random consts in the program, so `eval_mir_const` can fail.
  override readonly ALL_CONSTS_ARE_PRECHECKED: boolean = false;

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:50 enforce_alignment (lane ctfe-a)
  enforce_alignment(_ecx: InterpCx): boolean {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::enforce_alignment");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:54 enforce_validity (lane ctfe-a)
  enforce_validity(_ecx: InterpCx, _layout: TyAndLayout): boolean {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::enforce_validity");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:58 before_access_global (lane ctfe-a)
  override before_access_global(_tcx: TyCtxtAt, _machine: DummyMachine, _alloc_id: AllocId, alloc: ConstAllocation, _static_def_id: DefId | undefined, is_write: boolean): InterpResult {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::before_access_global");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:79 find_mir_or_eval_fn (lane ctfe-a)
  find_mir_or_eval_fn(_ecx: InterpCx, _instance: Instance, _abi: FnAbi<Ty>, _args: readonly FnArg[], _destination: PlaceTy, _target: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<[Body, Instance] | undefined> {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::find_mir_or_eval_fn");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:91 panic_nounwind (lane ctfe-a)
  panic_nounwind(_ecx: InterpCx, _msg: string): InterpResult {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::panic_nounwind");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:98 call_intrinsic (lane ctfe-a)
  call_intrinsic(_ecx: InterpCx, _instance: Instance, _args: readonly OpTy[], _destination: PlaceTy, _target: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<Instance | undefined> {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::call_intrinsic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:109 call_llvm_intrinsic (lane ctfe-a)
  call_llvm_intrinsic(_ecx: InterpCx, _instance: Instance, _args: readonly OpTy[], _destination: PlaceTy, _target: BasicBlock | undefined): InterpResult {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::call_llvm_intrinsic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:119 assert_panic (lane ctfe-a)
  assert_panic(_ecx: InterpCx, _msg: AssertMessage, _unwind: UnwindAction): InterpResult {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::assert_panic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:128 runtime_checks (lane ctfe-a)
  runtime_checks(_ecx: InterpCx, r: RuntimeChecks): InterpResult<boolean> {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::runtime_checks");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:134 binary_ptr_op (lane ctfe-a)
  binary_ptr_op(ecx: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::binary_ptr_op");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:181 expose_provenance (lane ctfe-a)
  expose_provenance(_ecx: InterpCx, _provenance: CtfeProvenance): InterpResult {
    return unported("rustc_const_eval::const_eval::dummy_machine::DummyMachine::expose_provenance");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:188 init_frame
  init_frame(_ecx: InterpCx, _frame: Frame): InterpResult<Frame> {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:196 stack
  stack_(_ecx: InterpCx): readonly Frame[] {
    // Return an empty stack instead of panicking, as `cur_span` uses it to evaluate constants.
    return [];
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:203 stack_mut
  stack_mut(_ecx: InterpCx): Frame[] {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:209 get_default_alloc_params
  get_default_alloc_params(): null {
    return null;
  }

}

/** The `throw_machine_stop_str!` macro's local `#[derive(Debug)] struct Zst` (its `Display` prints the macro's
 * format arguments, held here already formatted). */
export class Zst {
  constructor(readonly msg: string) {}
}

// impl Display for Zst
// stub: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:25 fmt (lane ctfe-a)
export function display_Zst(self: Zst, f: Fmt): string {
  return unported("rustc_const_eval::const_eval::dummy_machine::Zst::fmt");
}
