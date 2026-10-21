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
import { type HasDataLayout, Size } from "../../rustc_abi/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP, FileName, RemapPathScopeComponents, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { AliasConstKind } from "../../rustc_type_ir/const_kind.gen.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_option, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert_eq, panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { TyCtxt } from "../ty/context.ts";
import type { AliasConst } from "../ty/consts.ts";
import type { ScalarInt } from "../ty/consts/int.ts";
import type { Value } from "../ty/consts/valtree.ts";
import type { Instance, Ty, TypingEnv } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import { debug_Ty } from "../ty/mod.ts";
import * as gen from "./consts.gen.ts";
import { debug_Const, UnevaluatedConst } from "./consts.gen.ts";
import type { ErrorHandled } from "./interpret/error.ts";
import type { AllocId } from "./interpret/mod.ts";
import type { Scalar } from "./interpret/value.ts";
import { debug_Promoted } from "./mod.ts";
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

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:80 try_to_scalar
ConstValue.try_to_scalar = function (self: ConstValue): Scalar | undefined {
  switch (self.$) {
    case "Indirect":
    case "Slice":
    case "ZeroSized":
      return undefined;
    case "Scalar":
      return self._0;
  }
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:87 try_to_scalar_int
ConstValue.try_to_scalar_int = function (self: ConstValue): ScalarInt | undefined {
  const s = ConstValue.try_to_scalar(self);
  if (s === undefined) return undefined;
  const r = interp_value().Scalar.try_to_scalar_int(s);
  return r.$ === "Ok" ? r._0 : undefined;
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:91 try_to_bits
ConstValue.try_to_bits = function (self: ConstValue, size: Size): bigint | undefined {
  const int = ConstValue.try_to_scalar_int(self);
  if (int === undefined) return undefined;
  return int.to_bits(size);
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:95 try_to_bool
ConstValue.try_to_bool = function (self: ConstValue): boolean | undefined {
  const int = ConstValue.try_to_scalar_int(self);
  if (int === undefined) return undefined;
  const r = scalar_int().ScalarInt.try_into_bool(int);
  return r.$ === "Ok" ? r._0 : undefined;
};

// PORT: the `u64` is `number` (decision of the declaration); converted from `ScalarInt::to_target_usize`'s `bigint`.
// rustc: compiler/rustc_middle/src/mir/consts.rs:99 try_to_target_usize
ConstValue.try_to_target_usize = function (self: ConstValue, tcx: TyCtxt): number | undefined {
  const int = ConstValue.try_to_scalar_int(self);
  if (int === undefined) return undefined;
  return u64_to_number(int.to_target_usize(tcx), "ConstValue::try_to_target_usize");
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:103 try_to_bits_for_ty
ConstValue.try_to_bits_for_ty = function (self: ConstValue, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): bigint | undefined {
  const layout = tcx.layout_of(typing_env.with_post_analysis_normalized(tcx).as_query_input(ty));
  if (layout.$ === "Err") return undefined;
  const size = layout._0.size;
  return ConstValue.try_to_bits(self, size);
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:116 from_bool
ConstValue.from_bool = function (b: boolean): ConstValue {
  return { $: "Scalar", _0: interp_value().Scalar.from_bool(b) };
};

// PORT: `u64` parameters are `number` here (declaration); `Scalar::from_u64` takes the `bigint`.
// rustc: compiler/rustc_middle/src/mir/consts.rs:120 from_u64
ConstValue.from_u64 = function (i: number): ConstValue {
  return { $: "Scalar", _0: interp_value().Scalar.from_u64(BigInt(i)) };
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:124 from_u128
ConstValue.from_u128 = function (i: bigint): ConstValue {
  return { $: "Scalar", _0: interp_value().Scalar.from_u128(i) };
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:128 from_target_usize
ConstValue.from_target_usize = function (i: number, cx: HasDataLayout): ConstValue {
  return { $: "Scalar", _0: interp_value().Scalar.from_target_usize(BigInt(i), cx) };
};

/// Must only be called on constants of type `&str` or `&[u8]`!
// PORT: `&'tcx [u8]` is a `readonly number[]` (the declaration's type) copied out of the allocation bytes.
// rustc: compiler/rustc_middle/src/mir/consts.rs:133 try_get_slice_bytes_for_diagnostics
ConstValue.try_get_slice_bytes_for_diagnostics = function (self: ConstValue, tcx: TyCtxt): readonly number[] | undefined {
  let alloc_id: AllocId;
  let start: number;
  let len: number;
  switch (self.$) {
    case "Scalar":
    case "ZeroSized":
      return bug("`try_get_slice_bytes` on non-slice constant");
    case "Slice":
      [alloc_id, start, len] = [self.alloc_id, 0, self.meta];
      break;
    case "Indirect": {
      const offset = self.offset;
      // The reference itself is stored behind an indirection.
      // Load the reference, and then load the actual slice contents.
      const a = interp_mod().GlobalAlloc.unwrap_memory(tcx.global_alloc(self.alloc_id)).inner();
      const ptr_size = tcx.data_layout().pointer_size();
      if (a.size().bytes() < offset.add(ptr_size.mul(2)).bytes()) {
        // (partially) dangling reference
        return undefined;
      }
      // Read the wide pointer components.
      const ptr_r = a.read_scalar(tcx, interp_alloc().alloc_range(offset, ptr_size), /* read_provenance */ true);
      if (ptr_r.$ === "Err") return undefined;
      const ptr = interp_value().Scalar.to_pointer(ptr_r._0, tcx);
      const len_r = a.read_scalar(tcx, interp_alloc().alloc_range(offset.add(ptr_size), ptr_size), /* read_provenance */ false);
      if (len_r.$ === "Err") return undefined;
      const len_ = interp_error().InterpResult.discard_err(interp_value().Scalar.to_target_usize(len_r._0, tcx));
      if (len_ === undefined) return undefined;
      if (len_ === 0n) {
        return [];
      }
      // Non-empty slice, must have memory. We know this is a relative pointer.
      const p = ptr.into_pointer_or_addr();
      if (p.$ === "Err") return undefined;
      const [inner_prov, offset_] = p._0.prov_and_relative_offset();
      [alloc_id, start, len] = [interp_pointer().CtfeProvenance.alloc_id(inner_prov), offset_.bytes(), u64_to_number(len_, "try_get_slice_bytes_for_diagnostics")];
      break;
    }
  }

  const data = interp_mod().GlobalAlloc.unwrap_memory(tcx.global_alloc(alloc_id));

  // This is for diagnostics only, so we are okay to use `inspect_with_uninit_and_ptr_outside_interpreter`.
  const end = start + len;
  return Array.from(data.inner().inspect_with_uninit_and_ptr_outside_interpreter({ start, end }));
};

/// Check if a constant only contains uninitialized bytes.
// rustc: compiler/rustc_middle/src/mir/consts.rs:187 all_bytes_uninit
ConstValue.all_bytes_uninit = function (self: ConstValue, tcx: TyCtxt): boolean {
  if (self.$ !== "Indirect") {
    return false;
  }
  const alloc_id = self.alloc_id;
  const alloc = tcx.global_alloc(alloc_id);
  if (alloc.$ !== "Memory") {
    return false;
  }
  const a = alloc._0.inner();
  const init_mask = a.init_mask_();
  const init_range = init_mask.is_range_initialized(new (interp_alloc().AllocRange)(Size.ZERO, Size.from_bytes(a.len())));
  if (init_range.$ === "Err") {
    const range = init_range._0;
    if (range.size.bytes() === a.size().bytes()) {
      return true;
    }
  }
  return false;
};

/// Creates an unevaluated const from a `DefId` for a const item.
/// The binders of the const item still need to be instantiated.
// rustc: compiler/rustc_middle/src/mir/consts.rs:240 from_unevaluated
Const.from_unevaluated = function (tcx: TyCtxt, def_id: DefId): EarlyBinder<Const> {
  return binder().EarlyBinder.bind(
    tcx,
    {
      $: "Unevaluated",
      _0: new UnevaluatedConst(def_id, ty_decls_RawList().identity_for_item(tcx, def_id), undefined),
      _1: binder().EarlyBinder.skip_binder(tcx.type_of(def_id) as EarlyBinder<Ty>),
    },
    fold_Const,
  );
};

// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/consts.rs:258 ty
Const.ty = function (self: Const): Ty {
  switch (self.$) {
    case "Ty": {
      const [ty, ct] = [self._0, self._1];
      const k = ct.kind();
      switch (k.$) {
        // Dont use the outer ty as on invalid code we can wind up with them not being the same.
        // this then results in allowing const eval to add `1_i64 + 1_usize` in cases where the mir
        // was originally `({N: usize} + 1_usize)` under `generic_const_exprs`.
        case "Value":
          return k._0.ty;
        default:
          return ty;
      }
    }
    case "Val":
    case "Unevaluated":
      return self._1;
  }
};

/// Determines whether we need to add this const to `required_consts`. This is the case if and
/// only if evaluating it may error.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:276 is_required_const
Const.is_required_const = function (self: Const): boolean {
  switch (self.$) {
    case "Ty":
      switch (self._1.kind().$) {
        case "Value":
          return false; // already a value, cannot error
        default:
          return true;
      }
    case "Val":
      return false; // already a value, cannot error
    case "Unevaluated":
      return true;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:288 try_to_scalar
Const.try_to_scalar = function (self: Const): Scalar | undefined {
  switch (self.$) {
    case "Ty":
      // PORT: ty/decls.ts still types `ty::Const::try_to_scalar` with its `Pending<"Scalar">` stand-in.
      return self._1.try_to_scalar() as Scalar | undefined;
    case "Val":
      return ConstValue.try_to_scalar(self._0);
    case "Unevaluated":
      return undefined;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:297 try_to_scalar_int
Const.try_to_scalar_int = function (self: Const): ScalarInt | undefined {
  // This is equivalent to `self.try_to_scalar()?.try_to_int().ok()`, but measurably faster.
  if (self.$ === "Val" && self._0.$ === "Scalar" && self._0._0.$ === "Int") {
    return self._0._0._0;
  } else if (self.$ === "Ty") {
    return self._1.try_to_leaf();
  } else {
    return undefined;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:307 try_to_bits
Const.try_to_bits = function (self: Const, size: Size): bigint | undefined {
  const int = Const.try_to_scalar_int(self);
  if (int === undefined) return undefined;
  return int.to_bits(size);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:312 try_to_bool
Const.try_to_bool = function (self: Const): boolean | undefined {
  const int = Const.try_to_scalar_int(self);
  if (int === undefined) return undefined;
  const r = scalar_int().ScalarInt.try_into_bool(int);
  return r.$ === "Ok" ? r._0 : undefined;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:317 eval
Const.eval = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv, span: Span): Result<ConstValue, ErrorHandled> {
  switch (self.$) {
    case "Ty": {
      const c = self._1;
      const fold_ty_Const = ty_consts().fold_Const;
      const er = visit().TypeVisitableExt.error_reported(c, fold_ty_Const);
      if (er.$ === "Err") {
        const e = er._0;
        return Err(interp_error().ErrorHandled_from_ReportedErrorInfo(interp_error().ReportedErrorInfo.non_const_eval_error(e)));
      }

      // FIXME(generic_const_exprs): We shouldn't encounter placeholders here
      // and could change this to ICE when encountering them instead.
      if (visit().TypeVisitableExt.has_non_region_param(c, fold_ty_Const) || visit().TypeVisitableExt.has_non_region_placeholders(c, fold_ty_Const)) {
        return Err({ $: "TooGeneric", _0: span });
      }

      const k = c.kind();
      switch (k.$) {
        case "Value":
          return Ok(tcx.valtree_to_const_val(k._0));
        case "Expr":
          return bug("Normalization of `ty::ConstKind::Expr` is unimplemented");
        default:
          return Err(
            interp_error().ErrorHandled_from_ReportedErrorInfo(
              interp_error().ReportedErrorInfo.non_const_eval_error(tcx.dcx().delayed_bug("Unevaluated `ty::Const` in MIR body")),
            ),
          );
      }
    }
    case "Unevaluated": {
      const uneval = self._0;
      // FIXME: We might want to have a `try_eval`-like function on `Unevaluated`
      return tcx.const_eval_resolve(typing_env, uneval, span);
    }
    case "Val":
      return Ok(self._0);
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:355 try_eval_scalar
Const.try_eval_scalar = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): Scalar | undefined {
  if (self.$ === "Ty") {
    const c = self._1;
    // We don't evaluate anything for type system constants as normalizing
    // the MIR will handle this for us
    // PORT: ty/decls.ts's `Pending<"Scalar">` stand-in (see `try_to_scalar`).
    return c.try_to_scalar() as Scalar | undefined;
  } else {
    const r = Const.eval(self, tcx, typing_env, DUMMY_SP);
    if (r.$ === "Err") return undefined;
    return ConstValue.try_to_scalar(r._0);
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:370 try_eval_scalar_int
Const.try_eval_scalar_int = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): ScalarInt | undefined {
  const s = Const.try_eval_scalar(self, tcx, typing_env);
  if (s === undefined) return undefined;
  const r = interp_value().Scalar.try_to_scalar_int(s);
  return r.$ === "Ok" ? r._0 : undefined;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:379 try_eval_bits
Const.try_eval_bits = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint | undefined {
  const int = Const.try_eval_scalar_int(self, tcx, typing_env);
  if (int === undefined) return undefined;
  const layout = tcx.layout_of(typing_env.with_post_analysis_normalized(tcx).as_query_input(Const.ty(self)));
  if (layout.$ === "Err") return undefined;
  const size = layout._0.size;
  return int.to_bits(size);
};

/// Panics if the value cannot be evaluated or doesn't contain a valid integer of the given type.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:394 eval_bits
Const.eval_bits = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): bigint {
  const r = Const.try_eval_bits(self, tcx, typing_env);
  return r !== undefined ? r : bug(`expected bits of ${format_debug(Const.ty(self), debug_Ty, PRETTY)}, got ${format_debug(self, debug_Const, PRETTY)}`);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:400 try_eval_target_usize
Const.try_eval_target_usize = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): number | undefined {
  const int = Const.try_eval_scalar_int(self, tcx, typing_env);
  if (int === undefined) return undefined;
  return u64_to_number(int.to_target_usize(tcx), "Const::try_eval_target_usize");
};

// #[inline]
/// Panics if the value cannot be evaluated or doesn't contain a valid `usize`.
// rustc: compiler/rustc_middle/src/mir/consts.rs:410 eval_target_usize
Const.eval_target_usize = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): number {
  const r = Const.try_eval_target_usize(self, tcx, typing_env);
  return r !== undefined ? r : bug(`expected usize, got ${format_debug(self, debug_Const, PRETTY)}`);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:416 try_eval_bool
Const.try_eval_bool = function (self: Const, tcx: TyCtxt, typing_env: TypingEnv): boolean | undefined {
  const int = Const.try_eval_scalar_int(self, tcx, typing_env);
  if (int === undefined) return undefined;
  const r = scalar_int().ScalarInt.try_into_bool(int);
  return r.$ === "Ok" ? r._0 : undefined;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:421 from_value
Const.from_value = function (val: ConstValue, ty: Ty): Const {
  return { $: "Val", _0: val, _1: ty };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:426 from_ty_value
Const.from_ty_value = function (tcx: TyCtxt, val: Value): Const {
  return { $: "Ty", _0: val.ty, _1: ty_consts().Const.new_value(tcx, val.valtree, val.ty) };
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:430 from_bits
Const.from_bits = function (tcx: TyCtxt, bits: bigint, typing_env: TypingEnv, ty: Ty): Const {
  const layout = tcx.layout_of(typing_env.as_query_input(ty));
  if (layout.$ === "Err") {
    const e = layout._0;
    return bug(`could not compute layout for ${debug_Ty(ty, PLAIN)}: ${ty_layout().debug_LayoutError(e, PLAIN)}`);
  }
  const size = layout._0.size;
  const cv: ConstValue = { $: "Scalar", _0: interp_value().Scalar.from_uint(bits, size) };

  return { $: "Val", _0: cv, _1: ty };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:446 from_bool
Const.from_bool = function (tcx: TyCtxt, v: boolean): Const {
  const cv = ConstValue.from_bool(v);
  return { $: "Val", _0: cv, _1: tcx.types.bool };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:452 zero_sized
Const.zero_sized = function (ty: Ty): Const {
  const cv = ConstValue.ZeroSized;
  return { $: "Val", _0: cv, _1: ty };
};

// rustc: compiler/rustc_middle/src/mir/consts.rs:457 from_usize
Const.from_usize = function (tcx: TyCtxt, n: number): Const {
  const ty = tcx.types.usize;
  const typing_env = ty_mod().TypingEnv.fully_monomorphized();
  return Const.from_bits(tcx, BigInt(n), typing_env, ty);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:464 from_scalar
Const.from_scalar = function (_tcx: TyCtxt, s: Scalar, ty: Ty): Const {
  const val: ConstValue = { $: "Scalar", _0: s };
  return { $: "Val", _0: val, _1: ty };
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:481 shrink
UnevaluatedConst.prototype.shrink = function (this: UnevaluatedConst, tcx: TyCtxt): AliasConst {
  assert_eq(this.promoted, undefined, (p) => debug_option(p, PLAIN, debug_Promoted));

  let kind: AliasConstKind;
  const dk = tcx.def_kind(this.def);
  switch (dk.$) {
    case "AssocConst": {
      const pk = tcx.def_kind(tcx.parent(this.def));
      if (pk.$ === "Impl" && pk.of_trait === false) {
        kind = { $: "InherentImpl", def_id: this.def };
      } else {
        kind = { $: "Projection", def_id: this.def };
      }
      break;
    }
    case "Const":
      kind = { $: "Free", def_id: this.def };
      break;
    case "AnonConst":
      kind = { $: "Anon", def_id: this.def };
      break;
    default:
      return bug(`unexpected DefKind in MIR UnevaluatedConst: ${def().debug_DefKind(dk, PLAIN)}`);
  }

  return const_kind().AliasConst.new(tcx, kind, this.args);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:503 new
(UnevaluatedConst as unknown as { new: typeof UnevaluatedConst.new }).new = function (def: DefId, args: GenericArgsRef): UnevaluatedConst {
  return new UnevaluatedConst(def, args, undefined);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/consts.rs:508 from_instance
(UnevaluatedConst as unknown as { from_instance: typeof UnevaluatedConst.from_instance }).from_instance = function (instance: Instance): UnevaluatedConst {
  return UnevaluatedConst.new(ty_instance().Instance.def_id(instance), instance.args);
};

// impl<'tcx> Display for Const<'tcx>
// PORT: `fmt: &mut Formatter` is the output (the fn returns the text); `fmt::Error` cannot happen (a `String` sink).
// rustc: compiler/rustc_middle/src/mir/consts.rs:514 fmt
export function display_Const(self: Const): string {
  switch (self.$) {
    case "Ty":
      return print_pretty().pretty_print_const(self._1, PLAIN, true);
    case "Val":
      return mir_pretty().pretty_print_const_value(self._0, self._1, PLAIN);
    // FIXME(valtrees): Correctly print mir constants.
    case "Unevaluated": {
      const c_ = self._0;
      return tls().with_((tcx) => {
        const c = tcx.lift(c_);
        // Matches `GlobalId` printing.
        const instance = print_pretty().with_no_trimmed_paths(() => tcx.def_path_str_with_args(c.def, c.args));
        let fmt = `${instance}`;
        if (c.promoted !== undefined) {
          const promoted = c.promoted;
          fmt += `::${debug_Promoted(promoted, PLAIN)}`;
        }
        return fmt;
      });
    }
  }
}

///////////////////////////////////////////////////////////////////////////
// Const-related utilities

/** PORT (init order): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (called by rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  // PORT: the `const_caller_location` hook's value is typed `unknown` in hooks.ts (its `mir::ConstValue` was not ported).
  // rustc: compiler/rustc_middle/src/mir/consts.rs:540 span_as_caller_location
  TyCtxt.prototype.span_as_caller_location = function (this: TyCtxt, span: Span): ConstValue {
    const topmost = SyntaxContext.outer_expn(Span.ctxt(span)).expansion_cause() ?? span;
    const caller = this.sess.source_map().lookup_char_pos(Span.lo(topmost));
    return this.const_caller_location(
      Symbol.intern(FileName.display(caller.file.name, RemapPathScopeComponents.MACRO).to_string_lossy()),
      caller.line,
      caller.col_display + 1,
    ) as ConstValue;
  };
}

// ---- helpers (not upstream fns) ----

/**
 * The `TypeFoldable` / `TypeVisitable` descriptor of `mir::Const` (PORT D4: the derives are consts.gen.ts's
 * `*_with_Const`), for `EarlyBinder<mir::Const>` (`from_unevaluated`, statement.rs `Operand::unevaluated_constant`).
 */
export const fold_Const: TypeFoldable<Const> = {
  try_fold_with(self, folder) {
    return gen.try_fold_with_Const(self, folder);
  },
  fold_with(self, folder) {
    return gen.fold_with_Const(self, folder);
  },
  visit_with(self, visitor) {
    return gen.visit_with_Const(self, visitor);
  },
};

/** A target `u64` as a `number` (the declarations' type); an ICE above 2^53 (precedent ty/consts.ts). */
function u64_to_number(n: bigint, what: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) panic(`rust-ts: target usize ${n} exceeds 2^53 (${what})`);
  return Number(n);
}

// Lazily read modules (init order R4: this module is evaluated while syntax.gen.ts is).
function interp_value(): typeof import("./interpret/value.ts") {
  return (interp_value__m ??= require("./interpret/value.ts") as typeof import("./interpret/value.ts"));
}
var interp_value__m: typeof import("./interpret/value.ts") | undefined;
function interp_error(): typeof import("./interpret/error.ts") {
  return (interp_error__m ??= require("./interpret/error.ts") as typeof import("./interpret/error.ts"));
}
var interp_error__m: typeof import("./interpret/error.ts") | undefined;
function interp_mod(): typeof import("./interpret/mod.ts") {
  return (interp_mod__m ??= require("./interpret/mod.ts") as typeof import("./interpret/mod.ts"));
}
var interp_mod__m: typeof import("./interpret/mod.ts") | undefined;
function interp_alloc(): typeof import("./interpret/allocation.ts") {
  return (interp_alloc__m ??= require("./interpret/allocation.ts") as typeof import("./interpret/allocation.ts"));
}
var interp_alloc__m: typeof import("./interpret/allocation.ts") | undefined;
function interp_pointer(): typeof import("./interpret/pointer.ts") {
  return (interp_pointer__m ??= require("./interpret/pointer.ts") as typeof import("./interpret/pointer.ts"));
}
var interp_pointer__m: typeof import("./interpret/pointer.ts") | undefined;
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;
function print_pretty(): typeof import("../ty/print/pretty.ts") {
  return (print_pretty__m ??= require("../ty/print/pretty.ts") as typeof import("../ty/print/pretty.ts"));
}
var print_pretty__m: typeof import("../ty/print/pretty.ts") | undefined;
function tls(): typeof import("../ty/context/tls.ts") {
  return (tls__m ??= require("../ty/context/tls.ts") as typeof import("../ty/context/tls.ts"));
}
var tls__m: typeof import("../ty/context/tls.ts") | undefined;
function scalar_int(): typeof import("../ty/consts/int.ts") {
  return (scalar_int__m ??= require("../ty/consts/int.ts") as typeof import("../ty/consts/int.ts"));
}
var scalar_int__m: typeof import("../ty/consts/int.ts") | undefined;
function ty_mod(): typeof import("../ty/mod.ts") {
  return (ty_mod__m ??= require("../ty/mod.ts") as typeof import("../ty/mod.ts"));
}
var ty_mod__m: typeof import("../ty/mod.ts") | undefined;
function ty_layout(): typeof import("../ty/layout.ts") {
  return (ty_layout__m ??= require("../ty/layout.ts") as typeof import("../ty/layout.ts"));
}
var ty_layout__m: typeof import("../ty/layout.ts") | undefined;
function ty_consts(): typeof import("../../rustc_type_ir/sty/consts.ts") {
  return (ty_consts__m ??= require("../../rustc_type_ir/sty/consts.ts") as typeof import("../../rustc_type_ir/sty/consts.ts"));
}
var ty_consts__m: typeof import("../../rustc_type_ir/sty/consts.ts") | undefined;
function ty_decls_RawList(): typeof import("../ty/list.ts").RawList {
  return (ty_list__m ??= require("../ty/list.ts") as typeof import("../ty/list.ts")).RawList;
}
var ty_list__m: typeof import("../ty/list.ts") | undefined;
function binder(): typeof import("../../rustc_type_ir/binder.ts") {
  return (binder__m ??= require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts"));
}
var binder__m: typeof import("../../rustc_type_ir/binder.ts") | undefined;
function visit(): typeof import("../../rustc_type_ir/visit.ts") {
  return (visit__m ??= require("../../rustc_type_ir/visit.ts") as typeof import("../../rustc_type_ir/visit.ts"));
}
var visit__m: typeof import("../../rustc_type_ir/visit.ts") | undefined;
function const_kind(): typeof import("../../rustc_type_ir/const_kind.ts") {
  return (const_kind__m ??= require("../../rustc_type_ir/const_kind.ts") as typeof import("../../rustc_type_ir/const_kind.ts"));
}
var const_kind__m: typeof import("../../rustc_type_ir/const_kind.ts") | undefined;
function ty_instance(): typeof import("../ty/instance.ts") {
  return (ty_instance__m ??= require("../ty/instance.ts") as typeof import("../ty/instance.ts"));
}
var ty_instance__m: typeof import("../ty/instance.ts") | undefined;
function def(): typeof import("../../rustc_hir/def.ts") {
  return (def__m ??= require("../../rustc_hir/def.ts") as typeof import("../../rustc_hir/def.ts"));
}
var def__m: typeof import("../../rustc_hir/def.ts") | undefined;
