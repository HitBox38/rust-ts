// Port of compiler/rustc_const_eval/src/const_eval/type_info.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-b; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type CompileTimeInterpCx } from "./machine.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { type Machine } from "../interpret/machine.ts";
import { type Writeable } from "../interpret/place.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { type FnHeader, type FnSigTys } from "../../rustc_type_ir/ty_kind.ts";
import { unported } from "../../std/panic.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

declare module "../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // type_info.rs:19 (lane ctfe-b)
    allocate_fill_and_write_slice_ptr(slice_place: Writeable, len: bigint, writer: (a0: CompileTimeInterpCx, a1: bigint, a2: MPlaceTy) => InterpResult): InterpResult;
    // type_info.rs:50 (lane ctfe-b)
    write_type_info(ty: Ty, dest: Writeable): InterpResult;
    // type_info.rs:172 (lane ctfe-b)
    write_field(field_ty: Ty, place: MPlaceTy, layout: TyAndLayout, name: Symbol | undefined, idx: bigint): InterpResult;
    // type_info.rs:213 (lane ctfe-b)
    write_tuple_type_info(tuple_place: Writeable, fields: readonly Ty[], tuple_ty: Ty): InterpResult;
    // type_info.rs:231 (lane ctfe-b)
    write_type_id_generics(place: Writeable, ty: Ty): InterpResult;
    // type_info.rs:274 (lane ctfe-b)
    write_fn_ptr_type_info(place: Writeable, sig: FnSigTys, fn_header: FnHeader): InterpResult;
  }
}

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:19 allocate_fill_and_write_slice_ptr (lane ctfe-b)
InterpCx.prototype.allocate_fill_and_write_slice_ptr = function (this: CompileTimeInterpCx, slice_place: Writeable, len: bigint, writer: (a0: CompileTimeInterpCx, a1: bigint, a2: MPlaceTy) => InterpResult): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::allocate_fill_and_write_slice_ptr");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:50 write_type_info (lane ctfe-b)
InterpCx.prototype.write_type_info = function (this: CompileTimeInterpCx, ty: Ty, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::write_type_info");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:172 write_field (lane ctfe-b)
InterpCx.prototype.write_field = function (this: CompileTimeInterpCx, field_ty: Ty, place: MPlaceTy, layout: TyAndLayout, name: Symbol | undefined, idx: bigint): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::write_field");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:213 write_tuple_type_info (lane ctfe-b)
InterpCx.prototype.write_tuple_type_info = function (this: CompileTimeInterpCx, tuple_place: Writeable, fields: readonly Ty[], tuple_ty: Ty): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::write_tuple_type_info");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:231 write_type_id_generics (lane ctfe-b)
InterpCx.prototype.write_type_id_generics = function (this: CompileTimeInterpCx, place: Writeable, ty: Ty): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::write_type_id_generics");
};

// stub: compiler/rustc_const_eval/src/const_eval/type_info.rs:274 write_fn_ptr_type_info (lane ctfe-b)
InterpCx.prototype.write_fn_ptr_type_info = function (this: CompileTimeInterpCx, place: Writeable, sig: FnSigTys, fn_header: FnHeader): InterpResult {
  return unported("rustc_const_eval::const_eval::type_info::InterpCx::write_fn_ptr_type_info");
};
