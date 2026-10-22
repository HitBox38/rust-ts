// Port of compiler/rustc_const_eval/src/interpret/cast.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type Writeable } from "./place.ts";
import { type InterpResult, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type CastKind } from "../../rustc_middle/mir/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import { PlaceTy } from "./place.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // cast.rs:24 (lane interp-ops)
    cast(src: OpTy, cast_kind: CastKind, cast_ty: Ty, dest: PlaceTy): InterpResult;
    // cast.rs:225 (lane interp-ops)
    int_to_int_or_float(src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy>;
    // cast.rs:240 (lane interp-ops)
    float_to_float_or_int(src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy>;
    // cast.rs:258 (lane interp-ops)
    ptr_to_ptr(src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy>;
    // cast.rs:288 (lane interp-ops)
    pointer_expose_provenance_cast(src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy>;
    // cast.rs:308 (lane interp-ops)
    pointer_with_exposed_provenance_cast(src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy>;
    // cast.rs:328 (lane interp-ops)
    cast_from_int_like(scalar: Scalar, src_layout: TyAndLayout, cast_ty: Ty): InterpResult<Scalar>;
    // cast.rs:385 (lane interp-ops)
    cast_from_float<F>(f: F, dest_ty: Ty): Scalar;
    // cast.rs:434 (lane interp-ops)
    unsize_into_ptr(src: OpTy, dest: Writeable, source_ty: Ty, cast_ty: Ty): InterpResult;
    // cast.rs:531 (lane interp-ops)
    unsize_into(src: OpTy, cast_ty: TyAndLayout, dest: Writeable): InterpResult;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:24 cast (lane interp-ops)
InterpCx.prototype.cast = function (this: InterpCx, src: OpTy, cast_kind: CastKind, cast_ty: Ty, dest: PlaceTy): InterpResult {
  return unported("rustc_const_eval::interpret::cast::InterpCx::cast");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:225 int_to_int_or_float (lane interp-ops)
InterpCx.prototype.int_to_int_or_float = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::int_to_int_or_float");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:240 float_to_float_or_int (lane interp-ops)
InterpCx.prototype.float_to_float_or_int = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::float_to_float_or_int");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:258 ptr_to_ptr (lane interp-ops)
InterpCx.prototype.ptr_to_ptr = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::ptr_to_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:288 pointer_expose_provenance_cast (lane interp-ops)
InterpCx.prototype.pointer_expose_provenance_cast = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::pointer_expose_provenance_cast");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:308 pointer_with_exposed_provenance_cast (lane interp-ops)
InterpCx.prototype.pointer_with_exposed_provenance_cast = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::pointer_with_exposed_provenance_cast");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:328 cast_from_int_like (lane interp-ops)
InterpCx.prototype.cast_from_int_like = function (this: InterpCx, scalar: Scalar, src_layout: TyAndLayout, cast_ty: Ty): InterpResult<Scalar> {
  return unported("rustc_const_eval::interpret::cast::InterpCx::cast_from_int_like");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:385 cast_from_float (lane interp-ops)
InterpCx.prototype.cast_from_float = function <F>(this: InterpCx, f: F, dest_ty: Ty): Scalar {
  return unported("rustc_const_eval::interpret::cast::InterpCx::cast_from_float");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:434 unsize_into_ptr (lane interp-ops)
InterpCx.prototype.unsize_into_ptr = function (this: InterpCx, src: OpTy, dest: Writeable, source_ty: Ty, cast_ty: Ty): InterpResult {
  return unported("rustc_const_eval::interpret::cast::InterpCx::unsize_into_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/cast.rs:531 unsize_into (lane interp-ops)
InterpCx.prototype.unsize_into = function (this: InterpCx, src: OpTy, cast_ty: TyAndLayout, dest: Writeable): InterpResult {
  return unported("rustc_const_eval::interpret::cast::InterpCx::unsize_into");
};
