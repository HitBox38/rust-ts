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
import { assert_eq, panic } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { PLAIN } from "../../std/fmt.ts";
import { BackendRepr_eq, debug_BackendRepr } from "../../rustc_abi/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { InterpErrorInfo_from_InterpErrorKind, interp_ok, type MachineStopType, MachineStopType_provided, PointerArithmetic_provided, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_BinOp, debug_RuntimeChecks } from "../../rustc_middle/mir/mod.ts";
import { span_bug } from "../../rustc_span/macros.ts";
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

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:50 enforce_alignment
  enforce_alignment(_ecx: InterpCx): boolean {
    return false; // no reason to enforce alignment
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:54 enforce_validity
  enforce_validity(_ecx: InterpCx, _layout: TyAndLayout): boolean {
    return false;
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:58 before_access_global
  override before_access_global(_tcx: TyCtxtAt, _machine: DummyMachine, _alloc_id: AllocId, alloc: ConstAllocation, _static_def_id: DefId | undefined, is_write: boolean): InterpResult {
    if (is_write) {
      // throw_machine_stop_str!("can't write to global");
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: new Zst("can't write to global") }));
    }

    // If the static allocation is mutable, then we can't const prop it as its content
    // might be different at runtime.
    if (Mutability.is_mut(alloc.inner().mutability)) {
      // throw_machine_stop_str!("can't access mutable globals in ConstProp");
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: new Zst("can't access mutable globals in ConstProp") }));
    }

    return interp_ok(undefined);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:79 find_mir_or_eval_fn
  find_mir_or_eval_fn(_ecx: InterpCx, _instance: Instance, _abi: FnAbi<Ty>, _args: readonly FnArg[], _destination: PlaceTy, _target: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<[Body, Instance] | undefined> {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:91 panic_nounwind
  panic_nounwind(_ecx: InterpCx, _msg: string): InterpResult {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:98 call_intrinsic
  call_intrinsic(_ecx: InterpCx, _instance: Instance, _args: readonly OpTy[], _destination: PlaceTy, _target: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<Instance | undefined> {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:109 call_llvm_intrinsic
  call_llvm_intrinsic(_ecx: InterpCx, _instance: Instance, _args: readonly OpTy[], _destination: PlaceTy, _target: BasicBlock | undefined): InterpResult {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:119 assert_panic
  assert_panic(_ecx: InterpCx, _msg: AssertMessage, _unwind: UnwindAction): InterpResult {
    return panic("not implemented");
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:128 runtime_checks
  runtime_checks(_ecx: InterpCx, r: RuntimeChecks): InterpResult<boolean> {
    // Runtime checks have different value depending on the crate they are codegenned in.
    // Verify we aren't trying to evaluate them in mir-optimizations.
    return panic(`compiletime machine evaluated ${debug_RuntimeChecks(r, PLAIN)}`);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:134 binary_ptr_op
  binary_ptr_op(ecx: InterpCx, bin_op: BinOp, left: ImmTy, right: ImmTy): InterpResult<ImmTy> {
    // use rustc_middle::mir::BinOp::*;
    let res_: ImmTy;
    switch (bin_op) {
      case "Eq":
      case "Ne":
      case "Lt":
      case "Le":
      case "Gt":
      case "Ge": {
        // Types can differ, e.g. fn ptrs with different `for`.
        assert_eq(left.layout.backend_repr, right.layout.backend_repr, (v) => debug_BackendRepr(v, PLAIN), BackendRepr_eq);
        const size = PointerArithmetic_provided.pointer_size(ecx);
        // Just compare the bits. ScalarPairs are compared lexicographically.
        // We thus always compare pairs and simply fill scalars up with 0.
        // If the pointer has provenance, `to_bits` will return `Err` and we bail out.
        let left_: [bigint, bigint];
        const l = left.imm;
        switch (l.$) {
          case "Scalar": {
            const b = Scalar.to_bits(l._0, size);
            if (b.$ === "Err") return b;
            left_ = [b._0, 0n];
            break;
          }
          case "ScalarPair": {
            const b1 = Scalar.to_bits(l._0, size);
            if (b1.$ === "Err") return b1;
            const b2 = Scalar.to_bits(l._1, size);
            if (b2.$ === "Err") return b2;
            left_ = [b1._0, b2._0];
            break;
          }
          case "Uninit":
            return panic("we should never see uninit data here");
        }
        let right_: [bigint, bigint];
        const r = right.imm;
        switch (r.$) {
          case "Scalar": {
            const b = Scalar.to_bits(r._0, size);
            if (b.$ === "Err") return b;
            right_ = [b._0, 0n];
            break;
          }
          case "ScalarPair": {
            const b1 = Scalar.to_bits(r._0, size);
            if (b1.$ === "Err") return b1;
            const b2 = Scalar.to_bits(r._1, size);
            if (b2.$ === "Err") return b2;
            right_ = [b1._0, b2._0];
            break;
          }
          case "Uninit":
            return panic("we should never see uninit data here");
        }
        // PORT: tuple `PartialOrd` is lexicographic.
        const cmp = left_[0] < right_[0] ? -1 : left_[0] > right_[0] ? 1 : left_[1] < right_[1] ? -1 : left_[1] > right_[1] ? 1 : 0;
        let res: boolean;
        switch (bin_op) {
          case "Eq":
            res = cmp === 0;
            break;
          case "Ne":
            res = cmp !== 0;
            break;
          case "Lt":
            res = cmp < 0;
            break;
          case "Le":
            res = cmp <= 0;
            break;
          case "Gt":
            res = cmp > 0;
            break;
          case "Ge":
            res = cmp >= 0;
            break;
        }
        res_ = ImmTy.from_bool(res, ecx.tcx.tcx);
        break;
      }

      // Some more operations are possible with atomics.
      // The return value always has the provenance of the *left* operand.
      case "Add":
      case "Sub":
      case "BitOr":
      case "BitAnd":
      case "BitXor": {
        // throw_machine_stop_str!("pointer arithmetic is not handled")
        return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: new Zst("pointer arithmetic is not handled") }));
      }

      default:
        return span_bug(ecx.cur_span(), `Invalid operator on pointers: ${debug_BinOp(bin_op, PLAIN)}`);
    }
    return interp_ok(res_);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:181 expose_provenance
  expose_provenance(_ecx: InterpCx, _provenance: CtfeProvenance): InterpResult {
    return panic("not implemented");
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
// PORT: `impl rustc_middle::mir::interpret::MachineStopType for Zst {}`: the class is the `Box<dyn MachineStopType>`
// (`display` is its `Display`, `debug` the derived `Debug`, `with_validation_path` the provided method).
export class Zst implements MachineStopType {
  constructor(readonly msg: string) {}

  display(): string {
    return display_Zst(this, PLAIN);
  }

  debug(_f: Fmt): string {
    return "Zst";
  }

  with_validation_path(path: string): void {
    MachineStopType_provided.with_validation_path(this, path);
  }
}

// impl Display for Zst
// rustc: compiler/rustc_const_eval/src/const_eval/dummy_machine.rs:25 fmt
export function display_Zst(self: Zst, f: Fmt): string {
  return self.msg;
}
