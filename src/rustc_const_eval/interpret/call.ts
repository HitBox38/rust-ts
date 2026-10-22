// Port of compiler/rustc_const_eval/src/interpret/call.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-step-call; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type FieldIdx } from "../../rustc_abi/lib.ts";

import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { FnVal } from "./memory.ts";
import { type ReturnContinuation } from "./stack.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type Body, type Place as mir_Place, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type AdtDef } from "../../rustc_middle/ty/adt.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";
import { OpTy } from "./operand.gen.ts";
import { PlaceTy } from "./place.gen.ts";
import * as gen from "./call.gen.ts";
/** PORT: rustc_target `callconv::ArgAbi` is not ported yet (lane fn-abi; `FnAbi` is the same placeholder in ty/decls.ts). */
type ArgAbi<T> = Pending1<"ArgAbi", T>;
import type { Pending1 } from "../../rustc_type_ir/decls.ts";

export * from "./call.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // call.rs:58 (lane interp-step-call)
    copy_fn_args(args: readonly FnArg[]): OpTy[];
    // call.rs:63 (lane interp-step-call)
    fn_arg_project_field(arg: FnArg, field: FieldIdx): InterpResult<FnArg>;
    // call.rs:75 (lane interp-step-call)
    has_trivial_abi(layout: TyAndLayout): InterpResult<boolean>;
    // call.rs:123 (lane interp-step-call)
    unfold_transparent(layout: TyAndLayout, may_unfold: (a0: AdtDef) => boolean): InterpResult<TyAndLayout>;
    // call.rs:165 (lane interp-step-call)
    unfold_npo(layout: TyAndLayout): InterpResult<TyAndLayout>;
    // call.rs:234 (lane interp-step-call)
    identical_c_types(caller_type: Ty, callee_type: Ty): boolean;
    // call.rs:278 (lane interp-step-call)
    layout_compat(caller: TyAndLayout, callee: TyAndLayout): InterpResult<boolean>;
    // call.rs:365 (lane interp-step-call)
    check_argument_compat(caller_abi: ArgAbi<Ty>, callee_abi: ArgAbi<Ty>): InterpResult<boolean>;
    // call.rs:387 (lane interp-step-call)
    pass_argument(caller_args: IterableIterator<[FnArg, ArgAbi<Ty>]>, callee_args_abis: IterableIterator<[number, ArgAbi<Ty>]>, callee_arg: mir_Place, callee_ty: Ty, already_live: boolean): InterpResult;
    // call.rs:452 (lane interp-step-call)
    init_stack_frame(instance: Instance, body: Body, caller_fn_abi: FnAbi<Ty>, args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, cont: ReturnContinuation): InterpResult;
    // call.rs:720 (lane interp-step-call)
    init_fn_call(fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, target: BasicBlock | undefined, unwind: UnwindAction): InterpResult;
    // call.rs:954 (lane interp-step-call)
    assert_virtual_instance_matches_concrete(dyn_ty: Ty, def_id: DefId, virtual_instance: Instance, concrete_instance: Instance): void;
    // call.rs:983 (lane interp-step-call)
    init_fn_tail_call(fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean): InterpResult;
    // call.rs:1037 (lane interp-step-call)
    init_drop_in_place_call(place: PlaceTy, instance: Instance, target: BasicBlock, unwind: UnwindAction): InterpResult;
    // call.rs:1106 (lane interp-step-call)
    return_from_current_stack_frame(unwinding: boolean): InterpResult;
  }
}

export interface FnArg_methods {
  // call.rs:38 (lane interp-step-call)
  layout(self: FnArg): TyAndLayout;
  // call.rs:47 (lane interp-step-call)
  copy_fn_arg(self: FnArg): OpTy;
}
export type FnArg = gen.FnArg;
export const FnArg = {} as FnArg_methods;

// stub: compiler/rustc_const_eval/src/interpret/call.rs:38 layout (lane interp-step-call)
FnArg.layout = function (self: FnArg): TyAndLayout {
  return unported("rustc_const_eval::interpret::call::FnArg::layout");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:47 copy_fn_arg (lane interp-step-call)
FnArg.copy_fn_arg = function (self: FnArg): OpTy {
  return unported("rustc_const_eval::interpret::call::FnArg::copy_fn_arg");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:58 copy_fn_args (lane interp-step-call)
InterpCx.prototype.copy_fn_args = function (this: InterpCx, args: readonly FnArg[]): OpTy[] {
  return unported("rustc_const_eval::interpret::call::InterpCx::copy_fn_args");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:63 fn_arg_project_field (lane interp-step-call)
InterpCx.prototype.fn_arg_project_field = function (this: InterpCx, arg: FnArg, field: FieldIdx): InterpResult<FnArg> {
  return unported("rustc_const_eval::interpret::call::InterpCx::fn_arg_project_field");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:75 has_trivial_abi (lane interp-step-call)
InterpCx.prototype.has_trivial_abi = function (this: InterpCx, layout: TyAndLayout): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::call::InterpCx::has_trivial_abi");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:123 unfold_transparent (lane interp-step-call)
InterpCx.prototype.unfold_transparent = function (this: InterpCx, layout: TyAndLayout, may_unfold: (a0: AdtDef) => boolean): InterpResult<TyAndLayout> {
  return unported("rustc_const_eval::interpret::call::InterpCx::unfold_transparent");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:165 unfold_npo (lane interp-step-call)
InterpCx.prototype.unfold_npo = function (this: InterpCx, layout: TyAndLayout): InterpResult<TyAndLayout> {
  return unported("rustc_const_eval::interpret::call::InterpCx::unfold_npo");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:234 identical_c_types (lane interp-step-call)
InterpCx.prototype.identical_c_types = function (this: InterpCx, caller_type: Ty, callee_type: Ty): boolean {
  return unported("rustc_const_eval::interpret::call::InterpCx::identical_c_types");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:278 layout_compat (lane interp-step-call)
InterpCx.prototype.layout_compat = function (this: InterpCx, caller: TyAndLayout, callee: TyAndLayout): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::call::InterpCx::layout_compat");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:365 check_argument_compat (lane interp-step-call)
InterpCx.prototype.check_argument_compat = function (this: InterpCx, caller_abi: ArgAbi<Ty>, callee_abi: ArgAbi<Ty>): InterpResult<boolean> {
  return unported("rustc_const_eval::interpret::call::InterpCx::check_argument_compat");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:387 pass_argument (lane interp-step-call)
InterpCx.prototype.pass_argument = function (this: InterpCx, caller_args: IterableIterator<[FnArg, ArgAbi<Ty>]>, callee_args_abis: IterableIterator<[number, ArgAbi<Ty>]>, callee_arg: mir_Place, callee_ty: Ty, already_live: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::pass_argument");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:452 init_stack_frame (lane interp-step-call)
InterpCx.prototype.init_stack_frame = function (this: InterpCx, instance: Instance, body: Body, caller_fn_abi: FnAbi<Ty>, args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, cont: ReturnContinuation): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::init_stack_frame");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:720 init_fn_call (lane interp-step-call)
InterpCx.prototype.init_fn_call = function (this: InterpCx, fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, target: BasicBlock | undefined, unwind: UnwindAction): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::init_fn_call");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:954 assert_virtual_instance_matches_concrete (lane interp-step-call)
InterpCx.prototype.assert_virtual_instance_matches_concrete = function (this: InterpCx, dyn_ty: Ty, def_id: DefId, virtual_instance: Instance, concrete_instance: Instance): void {
  return unported("rustc_const_eval::interpret::call::InterpCx::assert_virtual_instance_matches_concrete");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:983 init_fn_tail_call (lane interp-step-call)
InterpCx.prototype.init_fn_tail_call = function (this: InterpCx, fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::init_fn_tail_call");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:1037 init_drop_in_place_call (lane interp-step-call)
InterpCx.prototype.init_drop_in_place_call = function (this: InterpCx, place: PlaceTy, instance: Instance, target: BasicBlock, unwind: UnwindAction): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::init_drop_in_place_call");
};

// stub: compiler/rustc_const_eval/src/interpret/call.rs:1106 return_from_current_stack_frame (lane interp-step-call)
InterpCx.prototype.return_from_current_stack_frame = function (this: InterpCx, unwinding: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::call::InterpCx::return_from_current_stack_frame");
};
