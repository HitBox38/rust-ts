// Port of compiler/rustc_const_eval/src/interpret/cast.rs (declared by lane interp-contract, filled by lane interp-ops).
import { BackendRepr, FieldIdx, FieldsShape, Integer, Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type Writeable } from "./place.ts";
import {
  type CtfeProvenance,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  type InterpResult,
  interp_ok,
  PointerArithmetic_provided,
  Pointer_Option_from_Pointer,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type CastKind, debug_CastKind } from "../../rustc_middle/mir/mod.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { debug_TyAndLayout_Ty, IntegerExt, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_AdtDef, debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_ExistentialTraitRef } from "../../rustc_type_ir/ir_print.ts";
import { ClosureKind } from "../../rustc_type_ir/lib.ts";
import { ExistentialTraitRef, type ExistentialTraitRef as ExistentialTraitRefT } from "../../rustc_type_ir/predicate.ts";
import { fold_with_ExistentialTraitRef, try_fold_with_ExistentialTraitRef, visit_with_ExistentialTraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { ClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { intern_key_eq } from "../../rust_ts/intern_key.ts";
import type { Float, FloatConvert } from "../../vendor/rustc_apfloat/lib.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import type { Double as ApDouble, Half as ApHalf, Quad as ApQuad, Single as ApSingle } from "../../vendor/rustc_apfloat/ieee.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import { debug_Immediate, Immediate } from "./operand.ts";
import { PlaceTy } from "./place.gen.ts";
import { ensure_monomorphic_enough } from "./util.ts";

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
    cast_from_float<F extends Float<F> & FloatConvert>(f: F, dest_ty: Ty): Scalar;
    // cast.rs:434 (lane interp-ops)
    unsize_into_ptr(src: OpTy, dest: Writeable, source_ty: Ty, cast_ty: Ty): InterpResult;
    // cast.rs:531 (lane interp-ops)
    unsize_into(src: OpTy, cast_ty: TyAndLayout, dest: Writeable): InterpResult;
  }
}

/** PORT: an `&impl Writeable` passed on to a generic `P: Projectable` fn (`P` = the value's own type). */
interface AnyWriteable extends Writeable<AnyWriteable> {}

/** `throw_ub!(..)` of this file. */
function ub<T>(info: Extract<InterpErrorKind, { $: "UndefinedBehavior" }>["_0"]): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: info }));
}

/** PORT: rustc_middle's mir/interpret/value.ts types `Scalar::to_f16..` / `from_f16..` with placeholders
 * (`Pending<"rustc_apfloat::ieee::..">`); the values are the vendored rustc_apfloat floats (D9). */
function ap<T>(f: unknown): T {
  return f as T;
}

const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRefT> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:24 cast
InterpCx.prototype.cast = function (this: InterpCx, src: OpTy, cast_kind: CastKind, cast_ty: Ty, dest: PlaceTy): InterpResult {
  // `cast_ty` will often be the same as `dest.ty`, but not always, since subtyping is still
  // possible.
  let cast_layout: TyAndLayout;
  if (cast_ty === dest.layout.ty) {
    cast_layout = dest.layout;
  } else {
    const l = this.layout_of(cast_ty);
    if (l.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(l._0));
    cast_layout = l._0;
  }

  // Check that the input is valid.
  // Can be skipped for transmuts and unsizing as those do validation below.
  if (
    !(
      cast_kind.$ === "Transmute" ||
      cast_kind.$ === "Subtype" ||
      cast_kind.$ === "BoxDerefTransmute" ||
      (cast_kind.$ === "PointerCoercion" && cast_kind._0.$ === "Unsize")
    ) &&
    this.machine.enforce_validity(this, src.layout)
  ) {
    const kind = src.layout.ty.kind();
    switch (kind.$) {
      case "RawPtr": {
        // We only need to check anything for wide pointers.
        if (src.layout.backend_repr.$ === "ScalarPair") {
          const r = this.deref_pointer(src);
          if (r.$ === "Err") return r;
        }
        break;
      }
      case "FnPtr": {
        const ptr = this.read_pointer(src);
        if (ptr.$ === "Err") return ptr;
        const r = this.get_ptr_fn(ptr._0);
        if (r.$ === "Err") return r;
        break;
      }
      case "Closure": {
        // Can only happen for non-capturing closures, which have nothing to validate.
        const args = kind._1.as_closure();
        assert(ClosureArgs.upvar_tys(args).length === 0, "assertion failed: args.upvar_tys().is_empty()");
        break;
      }
      // Types that have no requirements or whose requirements are checked by the actual
      // cast operation.
      case "Int":
      case "Uint":
      case "Float":
      case "Bool":
      case "Char":
      case "FnDef":
        break;

      default:
        return span_bug(this.cur_span(), `unexpected input type in non-transmute/unsize cast: ${display_Ty(src.layout.ty)}`);
    }
  }

  switch (cast_kind.$) {
    case "PointerExposeProvenance": {
      const s = this.read_immediate(src);
      if (s.$ === "Err") return s;
      const res = this.pointer_expose_provenance_cast(s._0, cast_layout);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "PointerWithExposedProvenance": {
      const s = this.read_immediate(src);
      if (s.$ === "Err") return s;
      const res = this.pointer_with_exposed_provenance_cast(s._0, cast_layout);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "IntToInt":
    case "IntToFloat": {
      const s = this.read_immediate(src);
      if (s.$ === "Err") return s;
      const res = this.int_to_int_or_float(s._0, cast_layout);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "FloatToFloat":
    case "FloatToInt": {
      const s = this.read_immediate(src);
      if (s.$ === "Err") return s;
      const res = this.float_to_float_or_int(s._0, cast_layout);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "FnPtrToPtr":
    case "PtrToPtr": {
      const s = this.read_immediate(src);
      if (s.$ === "Err") return s;
      const res = this.ptr_to_ptr(s._0, cast_layout);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case "PointerCoercion": {
      const coercion = cast_kind._0;
      switch (coercion.$) {
        case "Unsize": {
          const u = this.unsize_into(src, cast_layout, dest);
          if (u.$ === "Err") return u;
          // Validate the entire thing and reset any padding in the output.
          // It is enough to validate the output because we are only adding metadata,
          // not discarding anything from the input that may have been invalid.
          if (this.machine.enforce_validity(this, dest.layout_())) {
            const v = this.validate_place(dest, this.machine.enforce_validity_recursively(this, dest.layout_()), /*reset_provenance_and_padding*/ true);
            if (v.$ === "Err") return v;
          }
          break;
        }

        case "MutToConstPointer":
        case "ArrayToPointer":
          return bug(`${debug_CastKind(cast_kind, PLAIN)} casts are for borrowck only, not runtime MIR`);

        case "ReifyFnPointer": {
          // All reifications must be monomorphic, bail out otherwise.
          const m = ensure_monomorphic_enough(src.layout.ty, fold_Ty);
          if (m.$ === "Err") return m;

          // The src operand does not matter, just its type
          const kind = src.layout.ty.kind();
          if (kind.$ === "FnDef") {
            const def_id = kind._0;
            const args = kind._1;
            // let _trace = enter_trace_span!(M, resolve::resolve_for_fn_ptr, ?def_id);
            const instance = Instance.resolve_for_fn_ptr(this.tcx.deref(), this.typing_env, def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)));
            if (instance === undefined) {
              // err_inval!(TooGeneric)
              return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } }));
            }

            const fn_ptr = this.fn_ptr({ $: "Instance", _0: instance });
            const w = this.write_pointer(Pointer_Option_from_Pointer(fn_ptr), dest);
            if (w.$ === "Err") return w;
          } else {
            return span_bug(this.cur_span(), `reify fn pointer on ${display_Ty(src.layout.ty)}`);
          }
          break;
        }

        case "UnsafeFnPointer": {
          const s = this.read_immediate(src);
          if (s.$ === "Err") return s;
          if (cast_ty.kind().$ === "FnPtr") {
            // No change to value
            const w = this.write_immediate(s._0.imm, dest);
            if (w.$ === "Err") return w;
          } else {
            return span_bug(this.cur_span(), `fn to unsafe fn cast on ${display_Ty(cast_ty)}`);
          }
          break;
        }

        case "ClosureFnPointer": {
          // All reifications must be monomorphic, bail out otherwise.
          const m = ensure_monomorphic_enough(src.layout.ty, fold_Ty);
          if (m.$ === "Err") return m;

          // The src operand does not matter, just its type
          const kind = src.layout.ty.kind();
          if (kind.$ === "Closure") {
            const def_id = kind._0;
            const args = kind._1;
            // let _trace = enter_trace_span!(M, resolve::resolve_closure, ?def_id);
            const instance = Instance.resolve_closure(this.tcx.deref(), def_id, args, ClosureKind.FnOnce);
            const fn_ptr = this.fn_ptr({ $: "Instance", _0: instance });
            const w = this.write_pointer(Pointer_Option_from_Pointer(fn_ptr), dest);
            if (w.$ === "Err") return w;
          } else {
            return span_bug(this.cur_span(), `closure fn pointer on ${display_Ty(src.layout.ty)}`);
          }
          break;
        }
      }
      break;
    }

    case "Transmute":
    case "Subtype":
    case "BoxDerefTransmute": {
      assert(src.layout.is_sized(), "assertion failed: src.layout.is_sized()");
      assert(dest.layout.is_sized(), "assertion failed: dest.layout.is_sized()");
      assert_eq(cast_ty, dest.layout.ty, (v) => debug_Ty(v, PLAIN)); // we otherwise ignore `cast_ty` enirely...
      if (src.layout.size.bytes() !== dest.layout.size.bytes()) {
        // throw_ub_format!(..)
        return ub({
          $: "Ub",
          _0: `transmuting from ${src.layout.size.bytes()}-byte type to ${dest.layout.size.bytes()}-byte type: \`${display_Ty(src.layout.ty)}\` -> \`${display_Ty(dest.layout.ty)}\``,
        });
      }

      if (cast_kind.$ === "BoxDerefTransmute") {
        // Do the extra UB checking by making the input an actual `Box<T>` pointer
        // and dereferencing it.
        const ptr = this.read_immediate(src);
        if (ptr.$ === "Err") return ptr;
        const pointee_ty = unwrap(cast_ty.builtin_deref(true));
        const box_ty = Ty.new_box(this.tcx.deref(), pointee_ty);
        const box_layout = this.layout_of(box_ty);
        if (box_layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(box_layout._0));
        const ptr_ = ptr._0.transmute(box_layout._0, this);
        if (ptr_.$ === "Err") return ptr_;
        const d = this.deref_pointer(ptr_._0);
        if (d.$ === "Err") return d;
      }

      // This does validation at `src` and `dest` type.
      const c = this.copy_op_allow_transmute(src, dest);
      if (c.$ === "Err") return c;
      break;
    }
  }
  return interp_ok(undefined);
};

/// Handles 'IntToInt' and 'IntToFloat' casts.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:225 int_to_int_or_float
InterpCx.prototype.int_to_int_or_float = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  assert(src.layout.ty.is_integral() || src.layout.ty.is_char() || src.layout.ty.is_bool(), "assertion failed: src.layout.ty.is_integral() || src.layout.ty.is_char() || src.layout.ty.is_bool()");
  assert(cast_to.ty.is_floating_point() || cast_to.ty.is_integral() || cast_to.ty.is_char(), "assertion failed: cast_to.ty.is_floating_point() || cast_to.ty.is_integral() || cast_to.ty.is_char()");

  const s = this.cast_from_int_like(Immediate.to_scalar(src.imm), src.layout, cast_to.ty);
  if (s.$ === "Err") return s;
  return interp_ok(ImmTy.from_scalar(s._0, cast_to));
};

/// Handles 'FloatToFloat' and 'FloatToInt' casts.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:240 float_to_float_or_int
InterpCx.prototype.float_to_float_or_int = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  const kind = src.layout.ty.kind();
  if (kind.$ !== "Float") {
    return bug(`FloatToFloat/FloatToInt cast: source type ${display_Ty(src.layout.ty)} is not a float type`);
  }
  const s = Immediate.to_scalar(src.imm);
  let val: Scalar;
  switch (kind._0) {
    case "F16": {
      const f = Scalar.to_f16(s);
      if (f.$ === "Err") return f;
      val = this.cast_from_float(ap<ApHalf>(f._0), cast_to.ty);
      break;
    }
    case "F32": {
      const f = Scalar.to_f32(s);
      if (f.$ === "Err") return f;
      val = this.cast_from_float(ap<ApSingle>(f._0), cast_to.ty);
      break;
    }
    case "F64": {
      const f = Scalar.to_f64(s);
      if (f.$ === "Err") return f;
      val = this.cast_from_float(ap<ApDouble>(f._0), cast_to.ty);
      break;
    }
    case "F128": {
      const f = Scalar.to_f128(s);
      if (f.$ === "Err") return f;
      val = this.cast_from_float(ap<ApQuad>(f._0), cast_to.ty);
      break;
    }
  }
  return interp_ok(ImmTy.from_scalar(val, cast_to));
};

/// Handles 'FnPtrToPtr' and 'PtrToPtr' casts.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:258 ptr_to_ptr
InterpCx.prototype.ptr_to_ptr = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  assert(src.layout.ty.is_any_ptr(), "assertion failed: src.layout.ty.is_any_ptr()");
  assert(cast_to.ty.is_raw_ptr(), "assertion failed: cast_to.ty.is_raw_ptr()");
  // Handle casting any ptr to raw ptr (might be a wide ptr).
  if (cast_to.size.bytes() === src.layout.size.bytes()) {
    // Thin or wide pointer that just has the ptr kind of target type changed.
    return interp_ok(ImmTy.from_immediate(src.imm, cast_to));
  } else {
    // Casting the metadata away from a wide ptr.
    const ptr_size = PointerArithmetic_provided.pointer_size(this);
    assert_eq(src.layout.size, Size.u64_mul(2, ptr_size), (v) => `Size(${v.bytes()} bytes)`, (a, b) => a.bytes() === b.bytes());
    assert_eq(cast_to.size, ptr_size, (v) => `Size(${v.bytes()} bytes)`, (a, b) => a.bytes() === b.bytes());
    assert(src.layout.ty.is_raw_ptr(), "assertion failed: src.layout.ty.is_raw_ptr()");
    const imm = src.imm;
    switch (imm.$) {
      case "ScalarPair":
        return interp_ok(ImmTy.from_scalar(imm._0, cast_to));
      case "Scalar":
        return span_bug(
          this.cur_span(),
          `${debug_Immediate(imm, PLAIN)} input to a fat-to-thin cast (${display_Ty(src.layout.ty)} -> ${display_Ty(cast_to.ty)})`,
        );
      case "Uninit":
        return ub({ $: "InvalidUninitBytes", _0: undefined });
    }
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:288 pointer_expose_provenance_cast
InterpCx.prototype.pointer_expose_provenance_cast = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  const k = src.layout.ty.kind();
  if (!(k.$ === "RawPtr" || k.$ === "FnPtr")) {
    panic(`assertion \`left matches right\` failed\n  left: ${debug_Ty(src.layout.ty, PLAIN)}\n right: ty::RawPtr(_, _) | ty::FnPtr(..)`);
  }
  assert(cast_to.ty.is_integral(), "assertion failed: cast_to.ty.is_integral()");

  const scalar = Immediate.to_scalar(src.imm);
  const ptr = Scalar.to_pointer(scalar, this);
  const p = ptr.into_pointer_or_addr();
  if (p.$ === "Ok") {
    const r = this.machine.expose_provenance(this, p._0.provenance);
    if (r.$ === "Err") return r;
  } else {
    // Do nothing, exposing an invalid pointer (`None` provenance) is a NOP.
  }
  const s = this.cast_from_int_like(scalar, src.layout, cast_to.ty);
  if (s.$ === "Err") return s;
  return interp_ok(ImmTy.from_scalar(s._0, cast_to));
};

// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:308 pointer_with_exposed_provenance_cast
InterpCx.prototype.pointer_with_exposed_provenance_cast = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout): InterpResult<ImmTy> {
  assert(src.layout.ty.is_integral(), "assertion failed: src.layout.ty.is_integral()");
  if (cast_to.ty.kind().$ !== "RawPtr") {
    panic(`assertion \`left matches right\` failed\n  left: ${debug_Ty(cast_to.ty, PLAIN)}\n right: ty::RawPtr(_, _)`);
  }

  // First cast to usize.
  const scalar = Immediate.to_scalar(src.imm);
  const addr_s = this.cast_from_int_like(scalar, src.layout, this.tcx.deref().types.usize);
  if (addr_s.$ === "Err") return addr_s;
  const addr = Scalar.to_target_usize(addr_s._0, this);
  if (addr.$ === "Err") return addr;

  // Then turn address into pointer.
  const ptr = this.machine.ptr_from_addr_cast(this, addr._0);
  if (ptr.$ === "Err") return ptr;
  return interp_ok(ImmTy.from_scalar(Scalar.from_maybe_pointer<CtfeProvenance>(ptr._0, this), cast_to));
};

/// Low-level cast helper function. This works directly on scalars and can take 'int-like' input
/// type (basically everything with a scalar layout) to int/float/char types.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:328 cast_from_int_like
InterpCx.prototype.cast_from_int_like = function (this: InterpCx, scalar: Scalar, src_layout: TyAndLayout, cast_ty: Ty): InterpResult<Scalar> {
  // Let's make sure v is sign-extended *if* it has a signed type.
  const signed = BackendRepr.is_signed(src_layout.backend_repr); // Also asserts that abi is `Scalar`.

  // We go through the actual type of `src` to ensure the value is valid.
  let v: bigint;
  switch (src_layout.ty.kind().$) {
    case "Uint":
    case "RawPtr":
    case "FnPtr": {
      const r = Scalar.to_uint(scalar, src_layout.size);
      if (r.$ === "Err") return r;
      v = r._0;
      break;
    }
    case "Int": {
      const r = Scalar.to_int(scalar, src_layout.size);
      if (r.$ === "Err") return r;
      v = BigInt.asUintN(128, r._0); // we will cast back to `i128` below if the sign matters
      break;
    }
    case "Bool": {
      const r = Scalar.to_bool(scalar);
      if (r.$ === "Err") return r;
      v = r._0 ? 1n : 0n;
      break;
    }
    case "Char": {
      const r = Scalar.to_char(scalar);
      if (r.$ === "Err") return r;
      v = BigInt(r._0);
      break;
    }
    default:
      return span_bug(this.cur_span(), `invalid int-like cast from ${display_Ty(src_layout.ty)}`);
  }

  const kind = cast_ty.kind();
  switch (kind.$) {
    // int -> int
    case "Int":
    case "Uint": {
      const size = kind.$ === "Int" ? Integer.size(IntegerExt.from_int_ty(this, kind._0)) : Integer.size(IntegerExt.from_uint_ty(this, kind._0));
      const v_ = size.truncate(v);
      return interp_ok(Scalar.from_uint(v_, size));
    }

    case "Float": {
      const fty = kind._0;
      if (signed) {
        // signed int -> float
        const vi = BigInt.asIntN(128, v);
        switch (fty) {
          case "F16":
            return interp_ok(Scalar.from_f16(Half.from_i128(vi).value as never));
          case "F32":
            return interp_ok(Scalar.from_f32(Single.from_i128(vi).value as never));
          case "F64":
            return interp_ok(Scalar.from_f64(Double.from_i128(vi).value as never));
          case "F128":
            return interp_ok(Scalar.from_f128(Quad.from_i128(vi).value as never));
        }
      }
      // unsigned int -> float
      switch (fty) {
        case "F16":
          return interp_ok(Scalar.from_f16(Half.from_u128(v).value as never));
        case "F32":
          return interp_ok(Scalar.from_f32(Single.from_u128(v).value as never));
        case "F64":
          return interp_ok(Scalar.from_f64(Double.from_u128(v).value as never));
        case "F128":
          return interp_ok(Scalar.from_f128(Quad.from_u128(v).value as never));
      }
    }
    // falls through (unreachable: every arm above returns)

    // u8 -> char
    case "Char": {
      // `u8::try_from(v).unwrap()`
      if (v > 255n) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
      return interp_ok(Scalar.from_u32(Number(v)));
    }

    // Casts to bool are not permitted by rustc, no need to handle them here.
    default:
      return span_bug(this.cur_span(), `invalid int to ${display_Ty(cast_ty)} cast`);
  }
};

/// Low-level cast helper function. Converts an apfloat `f` into int or float types.
// PORT: `F: Float + Into<Scalar> + FloatConvert<Half/Single/Double/Quad>`: the target float type is passed to
// `convert` as its `FloatType` (rustc_apfloat lib.ts `FloatConvert`); `F`'s own type is `f.Self()`.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:385 cast_from_float
InterpCx.prototype.cast_from_float = function <F extends Float<F> & FloatConvert>(this: InterpCx, f: F, dest_ty: Ty): Scalar {
  const kind = dest_ty.kind();
  switch (kind.$) {
    // float -> uint
    case "Uint": {
      const size = Integer.size(IntegerExt.from_uint_ty(this, kind._0));
      // `to_u128` is a saturating cast, which is what we need
      // (https://doc.rust-lang.org/nightly/nightly-rustc/rustc_apfloat/trait.Float.html#method.to_i128_r).
      const v = f.to_u128(size.bits_usize()).value;
      // This should already fit the bit width
      return Scalar.from_uint(v, size);
    }
    // float -> int
    case "Int": {
      const size = Integer.size(IntegerExt.from_int_ty(this, kind._0));
      // `to_i128` is a saturating cast, which is what we need
      // (https://doc.rust-lang.org/nightly/nightly-rustc/rustc_apfloat/trait.Float.html#method.to_i128_r).
      const v = f.to_i128(size.bits_usize()).value;
      return Scalar.from_int(v, size);
    }
    // float -> float
    case "Float":
      switch (kind._0) {
        case "F16":
          return Scalar.from_f16(this.adjust_nan(f.convert(Half, { value: false }).value, [f], Half) as never);
        case "F32":
          return Scalar.from_f32(this.adjust_nan(f.convert(Single, { value: false }).value, [f], Single) as never);
        case "F64":
          return Scalar.from_f64(this.adjust_nan(f.convert(Double, { value: false }).value, [f], Double) as never);
        case "F128":
          return Scalar.from_f128(this.adjust_nan(f.convert(Quad, { value: false }).value, [f], Quad) as never);
      }
    // falls through (unreachable)
    // That's it.
    default:
      return span_bug(this.cur_span(), `invalid float to ${display_Ty(dest_ty)} cast`);
  }
};

/// `src` is a *pointer to* a `source_ty`, and in `dest` we should store a pointer to th same
/// data at type `cast_ty`.
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:434 unsize_into_ptr
InterpCx.prototype.unsize_into_ptr = function (this: InterpCx, src: OpTy, dest: Writeable, source_ty: Ty, cast_ty: Ty): InterpResult {
  // A<Struct> -> A<Trait> conversion
  const [src_pointee_ty, dest_pointee_ty] = this.tcx.deref().struct_lockstep_tails_for_codegen(source_ty, cast_ty, this.typing_env);

  const sk = src_pointee_ty.kind();
  const dk = dest_pointee_ty.kind();
  if (sk.$ === "Array" && dk.$ === "Slice") {
    const length = sk._1;
    const ptr = this.read_pointer(src);
    if (ptr.$ === "Err") return ptr;
    const len = length.try_to_target_usize(this.tcx.deref());
    if (len === undefined) panic("expected monomorphic const in const eval");
    const val = Immediate.new_slice(ptr._0, BigInt(len), this);
    return this.write_immediate(val, dest);
  } else if (sk.$ === "Dynamic" && dk.$ === "Dynamic") {
    const data_a = sk._0;
    const data_b = dk._0;
    const val = this.read_immediate(src);
    if (val.$ === "Err") return val;
    // MIR building generates odd NOP casts, prevent them from causing unexpected trouble.
    // See <https://github.com/rust-lang/rust/issues/128880>.
    // FIXME: ideally we wouldn't have to do this.
    if (data_a === data_b) {
      return this.write_immediate(val._0.imm, dest);
    }
    // Take apart the old pointer, and find the dynamic type.
    const [old_data_s, old_vptr_s] = Immediate.to_scalar_pair(val._0.imm);
    const old_data = Scalar.to_pointer(old_data_s, this);
    const old_vptr = Scalar.to_pointer(old_vptr_s, this);
    const ty_r = this.get_ptr_vtable_ty(old_vptr, data_a);
    if (ty_r.$ === "Err") return ty_r;
    const ty = ty_r._0;

    // Sanity-check that `supertrait_vtable_slot` in this type's vtable indeed produces
    // our destination trait.
    const vptr_entry_idx = this.tcx.deref().supertrait_vtable_slot([src_pointee_ty, dest_pointee_ty]);
    const vtable_entries = this.vtable_entries(data_a.principal(), ty);
    if (vptr_entry_idx !== undefined) {
      const entry_idx = vptr_entry_idx;
      const entry: VtblEntry | undefined = vtable_entries[entry_idx];
      if (entry === undefined || entry.$ !== "TraitVPtr") {
        return span_bug(this.cur_span(), `invalid vtable entry index in ${display_Ty(src_pointee_ty)} -> ${display_Ty(dest_pointee_ty)} upcast`);
      }
      const upcast_trait_ref = entry._0;
      const erased_trait_ref = ExistentialTraitRef.erase_self_ty(as_interner(this.tcx.deref()), upcast_trait_ref);
      const b = data_b.principal();
      const left = b === undefined ? undefined : this.tcx.deref().normalize_erasing_late_bound_regions(this.typing_env, b, d_ExistentialTraitRef);
      assert_eq<ExistentialTraitRefT | undefined>(
        left,
        erased_trait_ref,
        (v) => (v === undefined ? "None" : `Some(${debug_ExistentialTraitRef(v, PLAIN)})`),
        (x, y) => x !== undefined && y !== undefined && intern_key_eq(x, y),
      );
    } else {
      // In this case codegen would keep using the old vtable. We don't want to do
      // that as it has the wrong trait. The reason codegen can do this is that
      // one vtable is a prefix of the other, so we double-check that.
      const vtable_entries_b = this.vtable_entries(data_b.principal(), ty);
      // `vtable_entries[..vtable_entries_b.len()]` (panics when out of range)
      if (vtable_entries_b.length > vtable_entries.length) {
        panic(`range end index ${vtable_entries_b.length} out of range for slice of length ${vtable_entries.length}`);
      }
      assert(
        intern_key_eq(vtable_entries.slice(0, vtable_entries_b.length), [...vtable_entries_b]),
        "assertion failed: &vtable_entries[..vtable_entries_b.len()] == vtable_entries_b",
      );
    }

    // Get the destination trait vtable and return that.
    const new_vptr = this.get_vtable_ptr(ty, data_b);
    if (new_vptr.$ === "Err") return new_vptr;
    return this.write_immediate(Immediate.new_dyn_trait(old_data, new_vptr._0, this), dest);
  } else if (dk.$ === "Dynamic") {
    const data = dk._0;
    // Initial cast from sized to dyn trait
    const vtable = this.get_vtable_ptr(src_pointee_ty, data);
    if (vtable.$ === "Err") return vtable;
    const ptr = this.read_pointer(src);
    if (ptr.$ === "Err") return ptr;
    const val = Immediate.new_dyn_trait(ptr._0, vtable._0, this.tcx.deref());
    return this.write_immediate(val, dest);
  } else {
    // Do not ICE if we are not monomorphic enough.
    const m1 = ensure_monomorphic_enough(src.layout.ty, fold_Ty);
    if (m1.$ === "Err") return m1;
    const m2 = ensure_monomorphic_enough(cast_ty, fold_Ty);
    if (m2.$ === "Err") return m2;

    return span_bug(this.cur_span(), `invalid pointer unsizing ${display_Ty(src.layout.ty)} -> ${display_Ty(cast_ty)}`);
  }
};

/// Perform an unsizing coercion. The caller is responsible for checking validity afterwards!
// rustc: compiler/rustc_const_eval/src/interpret/cast.rs:531 unsize_into
InterpCx.prototype.unsize_into = function (this: InterpCx, src: OpTy, cast_ty: TyAndLayout, dest: Writeable): InterpResult {
  // trace!("Unsizing {:?} of type {} into {}", *src, src.layout.ty, cast_ty.ty);
  const sk = src.layout.ty.kind();
  const ck = cast_ty.ty.kind();
  if (sk.$ === "Pat" && ck.$ === "Pat" && sk._1 === ck._1) {
    const src_ = this.project_field(src, FieldIdx.ZERO);
    if (src_.$ === "Err") return src_;
    const dest_ = this.project_field(dest as AnyWriteable, FieldIdx.ZERO);
    if (dest_.$ === "Err") return dest_;
    const cast_ty_ = this.layout_of(ck._0);
    if (cast_ty_.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(cast_ty_._0));
    return this.unsize_into(src_._0, cast_ty_._0, dest_._0);
  }
  if ((sk.$ === "Ref" && (ck.$ === "Ref" || ck.$ === "RawPtr")) || (sk.$ === "RawPtr" && ck.$ === "RawPtr")) {
    const s = sk.$ === "Ref" ? sk._1 : sk._0;
    const c = ck.$ === "Ref" ? ck._1 : ck._0;
    return this.unsize_into_ptr(src, dest, s, c);
  }
  if (sk.$ === "Adt" && ck.$ === "Adt") {
    const def_a = sk._0;
    const def_b = ck._0;
    assert_eq(def_a, def_b, (v) => debug_AdtDef(v, PLAIN)); // implies same number of fields

    // Unsizing of generic struct with pointer fields, like `Arc<T>` -> `Arc<Trait>`.
    // There can be extra fields as long as they don't change their type or are 1-ZST.
    // There might also be no field that actually needs unsizing.
    let found_cast_field = false;
    for (let i_ = 0; i_ < FieldsShape.count(src.layout.fields); i_++) {
      const cast_ty_field = cast_ty.field(this, i_);
      const i = FieldIdx.from_usize(i_);
      const src_field = this.project_field(src, i);
      if (src_field.$ === "Err") return src_field;
      const dst_field = this.project_field(dest as AnyWriteable, i);
      if (dst_field.$ === "Err") return dst_field;
      if (src_field._0.layout.is_1zst() && cast_ty_field.is_1zst()) {
        // Skip 1-ZST fields.
      } else if (src_field._0.layout.ty === cast_ty_field.ty) {
        // The caller performs validation.
        const c = this.copy_op_no_validate(src_field._0, dst_field._0, /* allow_transmute */ false);
        if (c.$ === "Err") return c;
      } else {
        if (found_cast_field) {
          span_bug(this.cur_span(), "unsize_into: more than one field to cast");
        }
        found_cast_field = true;
        const u = this.unsize_into(src_field._0, cast_ty_field, dst_field._0);
        if (u.$ === "Err") return u;
      }
    }
    return interp_ok(undefined);
  }
  // Do not ICE if we are not monomorphic enough.
  const m1 = ensure_monomorphic_enough(src.layout.ty, fold_Ty);
  if (m1.$ === "Err") return m1;
  const m2 = ensure_monomorphic_enough(cast_ty.ty, fold_Ty);
  if (m2.$ === "Err") return m2;

  return span_bug(
    this.cur_span(),
    `unsize_into: invalid conversion: ${debug_TyAndLayout_Ty(src.layout, PLAIN)} -> ${debug_TyAndLayout_Ty(dest.layout_(), PLAIN)}`,
  );
};
