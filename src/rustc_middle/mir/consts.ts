// Port of compiler/rustc_middle/src/mir/consts.rs (lane mir-contract, plan-m4 D3). `ConstAlloc`, `ConstValue`, `Const`
// (mir's) and `UnevaluatedConst` are generated (consts.gen.ts, set rustc_middle_mir; `ty::Const` is imported there as
// `ty_Const`); this module declares (and stubs, for lane mir-body-b) the file's fns: companions of `ConstValue` / `Const`,
// `UnevaluatedConst`'s methods and the `impl TyCtxt` method (installed by `install_TyCtxt_methods`, see below).
// docs/handoff/mir-contract.md has the conventions ("How to fill a stub").
// PORT (init order): mir/ is in ty/context.ts's import closure (infer/canonical.gen.ts -> mir/query.ts), so no mir module
// touches `TyCtxt` at load: the `impl TyCtxt` methods of mir files are put on `TyCtxt.prototype` by their module's
// `install_TyCtxt_methods()`, which rustc_middle/lib.ts calls after its ty imports.
// PORT (init order): this module is evaluated while syntax.gen.ts is (ConstOperand's `const_`): read statement.ts /
// terminator.ts / pretty.ts / traversal.ts / basic_blocks.ts / visit.ts lazily (`require`), never at load.
import "./mod.ts";
import type { HasDataLayout, Size } from "../../rustc_abi/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { Result } from "../../std/result.ts";
import { unported } from "../../std/panic.ts";
import { TyCtxt } from "../ty/context.ts";
import type { AliasConst } from "../ty/consts.ts";
import type { ScalarInt } from "../ty/consts/int.ts";
import type { Value } from "../ty/consts/valtree.ts";
import type { Instance, Ty, TypingEnv } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import * as gen from "./consts.gen.ts";
import { UnevaluatedConst } from "./consts.gen.ts";
import type { ErrorHandled } from "./interpret/error.ts";
import type { Scalar } from "./interpret/value.ts";
export * from "./consts.gen.ts";

export interface ConstValue_methods {
    // consts.rs:80 (lane mir-body-b)
    try_to_scalar(self: ConstValue): Scalar | undefined;
    // consts.rs:87 (lane mir-body-b)
    try_to_scalar_int(self: ConstValue): ScalarInt | undefined;
    // consts.rs:91 (lane mir-body-b)
    try_to_bits(self: ConstValue, size: Size): bigint | undefined;
    // consts.rs:95 (lane mir-body-b)
    try_to_bool(self: ConstValue): boolean | undefined;
    // consts.rs:99 (lane mir-body-b)
    try_to_target_usize(self: ConstValue, tcx: TyCtxt): number | undefined;
    // consts.rs:103 (lane mir-body-b)
    try_to_bits_for_ty(self: ConstValue, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): bigint | undefined;
    // consts.rs:116 (lane mir-body-b)
    from_bool(b: boolean): ConstValue;
    // consts.rs:120 (lane mir-body-b)
    from_u64(i: number): ConstValue;
    // consts.rs:124 (lane mir-body-b)
    from_u128(i: bigint): ConstValue;
    // consts.rs:128 (lane mir-body-b)
    from_target_usize(i: number, cx: HasDataLayout): ConstValue;
    // consts.rs:133 (lane mir-body-b)
    try_get_slice_bytes_for_diagnostics(self: ConstValue, tcx: TyCtxt): readonly number[] | undefined;
    // consts.rs:187 (lane mir-body-b)
    all_bytes_uninit(self: ConstValue, tcx: TyCtxt): boolean;
}
export type ConstValue = gen.ConstValue;
export const ConstValue = gen.ConstValue as typeof gen.ConstValue & ConstValue_methods;

export interface Const_methods {
    // consts.rs:240 (lane mir-body-b)
    from_unevaluated(tcx: TyCtxt, def_id: DefId): EarlyBinder<Const>;
    // consts.rs:258 (lane mir-body-b)
    ty(self: Const): Ty;
    // consts.rs:276 (lane mir-body-b)
    is_required_const(self: Const): boolean;
    // consts.rs:288 (lane mir-body-b)
    try_to_scalar(self: Const): Scalar | undefined;
    // consts.rs:297 (lane mir-body-b)
    try_to_scalar_int(self: Const): ScalarInt | undefined;
    // consts.rs:307 (lane mir-body-b)
    try_to_bits(self: Const, size: Size): bigint | undefined;
    // consts.rs:312 (lane mir-body-b)
    try_to_bool(self: Const): boolean | undefined;
    // consts.rs:317 (lane mir-body-b)
    eval(self: Const, tcx: TyCtxt, typing_env: TypingEnv, span: Span): Result<ConstValue, ErrorHandled>;
    // consts.rs:355 (lane mir-body-b)
    try_eval_scalar(self: Const, tcx: TyCtxt, typing_env: TypingEnv): Scalar | undefined;
    // consts.rs:370 (lane mir-body-b)
    try_eval_scalar_int(self: Const, tcx: TyCtxt, typing_env: TypingEnv): ScalarInt | undefined;
    // consts.rs:379 (lane mir-body-b)
    try_eval_bits(self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint | undefined;
    // consts.rs:394 (lane mir-body-b)
    eval_bits(self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint;
    // consts.rs:400 (lane mir-body-b)
    try_eval_target_usize(self: Const, tcx: TyCtxt, typing_env: TypingEnv): number | undefined;
    // consts.rs:410 (lane mir-body-b)
    eval_target_usize(self: Const, tcx: TyCtxt, typing_env: TypingEnv): number;
    // consts.rs:416 (lane mir-body-b)
    try_eval_bool(self: Const, tcx: TyCtxt, typing_env: TypingEnv): boolean | undefined;
    // consts.rs:421 (lane mir-body-b)
    from_value(val: ConstValue, ty: Ty): Const;
    // consts.rs:426 (lane mir-body-b)
    from_ty_value(tcx: TyCtxt, val: Value): Const;
    // consts.rs:430 (lane mir-body-b)
    from_bits(tcx: TyCtxt, bits: bigint, typing_env: TypingEnv, ty: Ty): Const;
    // consts.rs:446 (lane mir-body-b)
    from_bool(tcx: TyCtxt, v: boolean): Const;
    // consts.rs:452 (lane mir-body-b)
    zero_sized(ty: Ty): Const;
    // consts.rs:457 (lane mir-body-b)
    from_usize(tcx: TyCtxt, n: number): Const;
    // consts.rs:464 (lane mir-body-b)
    from_scalar(_tcx: TyCtxt, s: Scalar, ty: Ty): Const;
}
export type Const = gen.Const;
export const Const = {} as Const_methods;

declare module "./consts.gen.ts" {
  interface UnevaluatedConst {
    // consts.rs:481 (lane mir-body-b)
    shrink(tcx: TyCtxt): AliasConst;
  }
}

declare module "./consts.gen.ts" {
  namespace UnevaluatedConst {
    // consts.rs:503 (lane mir-body-b)
    function new_(def: DefId, args: GenericArgsRef): UnevaluatedConst;
    export { new_ as new };
    // consts.rs:508 (lane mir-body-b)
    export function from_instance(instance: Instance): UnevaluatedConst;
  }
}

declare module "../ty/context.ts" {
  interface TyCtxt {
    // consts.rs:540 (lane mir-body-b)
    span_as_caller_location(span: Span): ConstValue;
  }
}

// stub: compiler/rustc_middle/src/mir/consts.rs:80 try_to_scalar (lane mir-body-b)
ConstValue.try_to_scalar = function (self: ConstValue): Scalar | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_scalar");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:87 try_to_scalar_int (lane mir-body-b)
ConstValue.try_to_scalar_int = function (self: ConstValue): ScalarInt | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:91 try_to_bits (lane mir-body-b)
ConstValue.try_to_bits = function (self: ConstValue, size: Size): bigint | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_bits");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:95 try_to_bool (lane mir-body-b)
ConstValue.try_to_bool = function (self: ConstValue): boolean | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_bool");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:99 try_to_target_usize (lane mir-body-b)
ConstValue.try_to_target_usize = function (self: ConstValue, tcx: TyCtxt): number | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_target_usize");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:103 try_to_bits_for_ty (lane mir-body-b)
ConstValue.try_to_bits_for_ty = function (self: ConstValue, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): bigint | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_to_bits_for_ty");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:116 from_bool (lane mir-body-b)
ConstValue.from_bool = function (b: boolean): ConstValue {
  return unported("rustc_middle::mir::consts::ConstValue::from_bool");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:120 from_u64 (lane mir-body-b)
ConstValue.from_u64 = function (i: number): ConstValue {
  return unported("rustc_middle::mir::consts::ConstValue::from_u64");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:124 from_u128 (lane mir-body-b)
ConstValue.from_u128 = function (i: bigint): ConstValue {
  return unported("rustc_middle::mir::consts::ConstValue::from_u128");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:128 from_target_usize (lane mir-body-b)
ConstValue.from_target_usize = function (i: number, cx: HasDataLayout): ConstValue {
  return unported("rustc_middle::mir::consts::ConstValue::from_target_usize");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:133 try_get_slice_bytes_for_diagnostics (lane mir-body-b)
ConstValue.try_get_slice_bytes_for_diagnostics = function (self: ConstValue, tcx: TyCtxt): readonly number[] | undefined {
  return unported("rustc_middle::mir::consts::ConstValue::try_get_slice_bytes_for_diagnostics");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:187 all_bytes_uninit (lane mir-body-b)
ConstValue.all_bytes_uninit = function (self: ConstValue, tcx: TyCtxt): boolean {
  return unported("rustc_middle::mir::consts::ConstValue::all_bytes_uninit");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:240 from_unevaluated (lane mir-body-b)
Const.from_unevaluated = function (tcx: TyCtxt, def_id: DefId): EarlyBinder<Const> {
  return unported("rustc_middle::mir::consts::Const::from_unevaluated");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:258 ty (lane mir-body-b)
Const.ty = function (self: Const): Ty {
  return unported("rustc_middle::mir::consts::Const::ty");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:276 is_required_const (lane mir-body-b)
Const.is_required_const = function (self: Const): boolean {
  return unported("rustc_middle::mir::consts::Const::is_required_const");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:288 try_to_scalar (lane mir-body-b)
Const.try_to_scalar = function (self: Const): Scalar | undefined {
  return unported("rustc_middle::mir::consts::Const::try_to_scalar");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:297 try_to_scalar_int (lane mir-body-b)
Const.try_to_scalar_int = function (self: Const): ScalarInt | undefined {
  return unported("rustc_middle::mir::consts::Const::try_to_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:307 try_to_bits (lane mir-body-b)
Const.try_to_bits = function (self: Const, size: Size): bigint | undefined {
  return unported("rustc_middle::mir::consts::Const::try_to_bits");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:312 try_to_bool (lane mir-body-b)
Const.try_to_bool = function (self: Const): boolean | undefined {
  return unported("rustc_middle::mir::consts::Const::try_to_bool");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:317 eval (lane mir-body-b)
Const.eval = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv, span: Span): Result<ConstValue, ErrorHandled> {
  return unported("rustc_middle::mir::consts::Const::eval");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:355 try_eval_scalar (lane mir-body-b)
Const.try_eval_scalar = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): Scalar | undefined {
  return unported("rustc_middle::mir::consts::Const::try_eval_scalar");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:370 try_eval_scalar_int (lane mir-body-b)
Const.try_eval_scalar_int = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): ScalarInt | undefined {
  return unported("rustc_middle::mir::consts::Const::try_eval_scalar_int");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:379 try_eval_bits (lane mir-body-b)
Const.try_eval_bits = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint | undefined {
  return unported("rustc_middle::mir::consts::Const::try_eval_bits");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:394 eval_bits (lane mir-body-b)
Const.eval_bits = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint {
  return unported("rustc_middle::mir::consts::Const::eval_bits");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:400 try_eval_target_usize (lane mir-body-b)
Const.try_eval_target_usize = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): number | undefined {
  return unported("rustc_middle::mir::consts::Const::try_eval_target_usize");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:410 eval_target_usize (lane mir-body-b)
Const.eval_target_usize = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): number {
  return unported("rustc_middle::mir::consts::Const::eval_target_usize");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:416 try_eval_bool (lane mir-body-b)
Const.try_eval_bool = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): boolean | undefined {
  return unported("rustc_middle::mir::consts::Const::try_eval_bool");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:421 from_value (lane mir-body-b)
Const.from_value = function (val: ConstValue, ty: Ty): Const {
  return unported("rustc_middle::mir::consts::Const::from_value");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:426 from_ty_value (lane mir-body-b)
Const.from_ty_value = function (tcx: TyCtxt, val: Value): Const {
  return unported("rustc_middle::mir::consts::Const::from_ty_value");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:430 from_bits (lane mir-body-b)
Const.from_bits = function (tcx: TyCtxt, bits: bigint, typing_env: TypingEnv, ty: Ty): Const {
  return unported("rustc_middle::mir::consts::Const::from_bits");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:446 from_bool (lane mir-body-b)
Const.from_bool = function (tcx: TyCtxt, v: boolean): Const {
  return unported("rustc_middle::mir::consts::Const::from_bool");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:452 zero_sized (lane mir-body-b)
Const.zero_sized = function (ty: Ty): Const {
  return unported("rustc_middle::mir::consts::Const::zero_sized");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:457 from_usize (lane mir-body-b)
Const.from_usize = function (tcx: TyCtxt, n: number): Const {
  return unported("rustc_middle::mir::consts::Const::from_usize");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:464 from_scalar (lane mir-body-b)
Const.from_scalar = function (_tcx: TyCtxt, s: Scalar, ty: Ty): Const {
  return unported("rustc_middle::mir::consts::Const::from_scalar");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:481 shrink (lane mir-body-b)
UnevaluatedConst.prototype.shrink = function (this: UnevaluatedConst, tcx: TyCtxt): AliasConst {
  return unported("rustc_middle::mir::consts::UnevaluatedConst::shrink");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:503 new (lane mir-body-b)
(UnevaluatedConst as unknown as { new: typeof UnevaluatedConst.new }).new = function (def: DefId, args: GenericArgsRef): UnevaluatedConst {
  return unported("rustc_middle::mir::consts::UnevaluatedConst::new");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:508 from_instance (lane mir-body-b)
(UnevaluatedConst as unknown as { from_instance: typeof UnevaluatedConst.from_instance }).from_instance = function (instance: Instance): UnevaluatedConst {
  return unported("rustc_middle::mir::consts::UnevaluatedConst::from_instance");
};


// stub: compiler/rustc_middle/src/mir/consts.rs:514 fmt (lane mir-body-b)
export function display_Const(self: Const): string {
  return unported("rustc_middle::mir::consts::<Const as Display>::fmt");
}


/** PORT (init order): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (called by rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  // stub: compiler/rustc_middle/src/mir/consts.rs:540 span_as_caller_location (lane mir-body-b)
  TyCtxt.prototype.span_as_caller_location = function (this: TyCtxt, span: Span): ConstValue {
    return unported("rustc_middle::mir::consts::TyCtxt::span_as_caller_location");
  };
}
