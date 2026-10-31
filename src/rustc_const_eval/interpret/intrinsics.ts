//! Intrinsics and other functions that the interpreter executes without
//! looking at their MIR. Intrinsics/functions supported here are shared by CTFE
//! and miri.
//
// Port of compiler/rustc_const_eval/src/interpret/intrinsics.rs (declared by lane interp-contract, ported by lane
// interp-intrinsics, plan-m4 wave 24). docs/handoff/interp-contract.md has the conventions (interpret/eval_context.ts's
// header repeats them); this file in addition:
// - `throw_ub_format!(..)` / `err_ub_format!(..)` / `err_unsup_format!(..)` / `throw_inval!(TooGeneric)` are the helpers
//   at the end of the file (the macros' expansions), the macro kept as a comment.
// - `F: rustc_apfloat::Float + FloatConvert<F> + Into<Scalar>` takes its `FloatType` dictionary as a trailing `F_`
//   parameter (contract decision 10); `<F as Into<Scalar>>::into` is `F_into_Scalar` (dispatched on the dictionary).
//   `::<Half>` / `::<Single>` / `::<Double>` / `::<Quad>` pass the vendored rustc_apfloat types.
// - An `&impl Writeable` / `&impl Projectable` passed on to a generic `P: Projectable` fn is cast to `AnyWriteable` /
//   `AnyProjectable` (`P` = the value's own type; precedent discriminant.ts / cast.ts).
// - `u128` bit operations (`count_ones`, `leading_zeros`, `trailing_zeros`, `swap_bytes`, `reverse_bits`) are the
//   bigint helpers at the end of the file.
import { FieldIdx, FieldsShape, Size, VariantIdx, BackendRepr } from "../../rustc_abi/lib.ts";
import { TyAndLayout_eq } from "../../rustc_abi/layout/ty.ts";
import { Hash128 } from "../../rustc_hashes/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { MinMax, MulAddType, VarArgCompatible } from "./intrinsics.gen.ts";
import { type Machine } from "./machine.ts";
import { MemoryKind } from "./memory.gen.ts";
import { type Projectable } from "./projection.ts";
import { PlaceTy_from_MPlaceTy, type Writeable } from "./place.ts";
import { display_ImmTy, Immediate } from "./operand.ts";
import { ensure_monomorphic_enough } from "./util.ts";
import { type_name } from "../util/type_name.ts";
import {
  type AllocId,
  CheckInAllocMsg,
  CTFE_ALLOC_SALT,
  type CtfeProvenance,
  CtfeProvenance_from_AllocId,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpErrorKind,
  InterpResult,
  interp_ok,
  Pointer,
  PointerArithmetic_provided,
  Pointer_Option_from_Pointer,
  read_target_uint,
  Scalar,
  Scalar_from_Double,
  Scalar_from_Half,
  Scalar_from_Quad,
  Scalar_from_Single,
  type UndefinedBehaviorInfo,
  write_target_uint,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, BinOp, ConstValue, debug_BinOp, type NonDivergingIntrinsic } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { debug_TyAndLayout_Ty, LayoutCx, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { type Float, type FloatType, Round, Status } from "../../vendor/rustc_apfloat/lib.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { ImmTy, OpTy } from "./operand.gen.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";

export * from "./intrinsics.gen.ts";

/** PORT: an `&impl Projectable` passed on to a generic `P: Projectable` fn (`P` = the value's own type). */
interface AnyProjectable extends Projectable<AnyProjectable> {}
/** PORT: an `&impl Writeable` passed on to a generic `P: Projectable` fn (`P` = the value's own type). */
interface AnyWriteable extends Writeable<AnyWriteable> {}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // intrinsics.rs:87
    write_type_id(ty: Ty, dest: Writeable): InterpResult<undefined>;
    // intrinsics.rs:124
    read_type_id(op: OpTy): InterpResult<Ty>;
    // intrinsics.rs:172
    eval_intrinsic(instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
    // intrinsics.rs:820
    validate_c_variadic_argument(arg_mplace: MPlaceTy, callee_type: TyAndLayout): InterpResult;
    // intrinsics.rs:868
    validate_c_variadic_compatible_ty(caller_type: Ty, callee_type: Ty): InterpResult<VarArgCompatible>;
    // intrinsics.rs:945
    eval_nondiverging_intrinsic(intrinsic: NonDivergingIntrinsic): InterpResult;
    // intrinsics.rs:971
    numeric_intrinsic(name: Symbol, val: Scalar, layout: TyAndLayout, ret_layout: TyAndLayout): InterpResult<Scalar>;
    // intrinsics.rs:1001
    exact_div(a: ImmTy, b: ImmTy, dest: PlaceTy): InterpResult;
    // intrinsics.rs:1023
    saturating_arith(mir_op: BinOp, l: ImmTy, r: ImmTy): InterpResult<Scalar>;
    // intrinsics.rs:1069
    ptr_offset_inbounds(ptr: Pointer<CtfeProvenance | undefined>, offset_bytes: bigint): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // intrinsics.rs:1085
    copy_intrinsic(src: OpTy, dst: OpTy, count: OpTy, nonoverlapping: boolean): InterpResult;
    // intrinsics.rs:1113
    typed_swap_nonoverlapping_intrinsic(left: OpTy, right: OpTy): InterpResult;
    // intrinsics.rs:1146
    write_bytes_intrinsic(dst: OpTy, byte: OpTy, count: OpTy, name: string): InterpResult;
    // intrinsics.rs:1169
    compare_bytes_intrinsic(left: OpTy, right: OpTy, byte_count: OpTy): InterpResult<Scalar>;
    // intrinsics.rs:1187
    raw_eq_intrinsic(lhs: OpTy, rhs: OpTy): InterpResult<Scalar>;
    // intrinsics.rs:1212
    unop_float_intrinsic<F extends Float<F>>(name: Symbol, arg: ImmTy, F_: FloatType<F>): InterpResult<Scalar>;
    // intrinsics.rs:1228
    float_minmax<F extends Float<F>>(a: Scalar, b: Scalar, op: MinMax, F_: FloatType<F>): InterpResult<Scalar>;
    // intrinsics.rs:1256
    float_minmax_intrinsic<F extends Float<F>>(args: readonly OpTy[], op: MinMax, dest: PlaceTy, F_: FloatType<F>): InterpResult<undefined>;
    // intrinsics.rs:1271
    float_copysign_intrinsic<F extends Float<F>>(args: readonly OpTy[], dest: PlaceTy, F_: FloatType<F>): InterpResult<undefined>;
    // intrinsics.rs:1286
    float_round<F extends Float<F>>(x: Scalar, mode: Round, F_: FloatType<F>): InterpResult<Scalar>;
    // intrinsics.rs:1300
    float_round_intrinsic<F extends Float<F>>(args: readonly OpTy[], dest: PlaceTy, mode: Round, F_: FloatType<F>): InterpResult<undefined>;
    // intrinsics.rs:1314
    float_muladd<F extends Float<F>>(a: Scalar, b: Scalar, c: Scalar, typ: MulAddType, F_: FloatType<F>): InterpResult<Scalar>;
    // intrinsics.rs:1335
    float_muladd_intrinsic<F extends Float<F>>(args: readonly OpTy[], dest: PlaceTy, typ: MulAddType, F_: FloatType<F>): InterpResult<undefined>;
    // intrinsics.rs:1356
    float_to_int_checked(src: ImmTy, cast_to: TyAndLayout, round: Round): InterpResult<ImmTy | undefined>;
    // intrinsics.rs:1416
    va_list_key_field<P extends Projectable<P>>(va_list: P): InterpResult<P>;
  }
}

/// Directly returns an `Allocation` containing an absolute path representation of the given type.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:79 alloc_type_name
export function alloc_type_name(tcx: TyCtxt, ty: Ty): [AllocId, bigint] {
  const path = type_name(tcx, ty);
  const bytes = utf8(path);
  const len = BigInt(bytes.length);
  return [tcx.allocate_bytes_dedup(bytes, CTFE_ALLOC_SALT), len];
}

/// Generates a value of `TypeId` for `ty` in-place.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:87 write_type_id
InterpCx.prototype.write_type_id = function (this: InterpCx, ty: Ty, dest: Writeable): InterpResult<undefined> {
  // debug_assert!(
  //     !ty.has_erasable_regions(),
  //     "type {ty:?} has regions that need erasing before writing a TypeId",
  // );

  const tcx = this.tcx;
  const type_id_hash = Hash128.as_u128(tcx.tcx.type_id_hash(ty));
  const op = this.const_val_to_op({ $: "Scalar", _0: Scalar.from_u128(type_id_hash) }, tcx.tcx.types.u128, undefined);
  if (op.$ === "Err") return op;
  const c = this.copy_op_allow_transmute(op._0, dest);
  if (c.$ === "Err") return c;

  // Give the each pointer-sized chunk provenance that knows about the type id.
  // Here we rely on `TypeId` being a newtype around an array of pointers, so we
  // first project to its only field and then the array elements.
  const alloc_id = tcx.tcx.reserve_and_set_type_id_alloc(ty);
  const arr = this.project_field(dest as AnyWriteable, FieldIdx.ZERO);
  if (arr.$ === "Err") return arr;
  const elem_iter_r = this.project_array_fields(arr._0);
  if (elem_iter_r.$ === "Err") return elem_iter_r;
  const elem_iter = elem_iter_r._0;
  for (;;) {
    const n = elem_iter.next(this);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) break;
    const [, elem] = n._0;
    // Decorate this part of the hash with provenance; leave the integer part unchanged.
    const s = this.read_scalar(elem);
    if (s.$ === "Err") return s;
    const hash_fragment = Scalar.to_target_usize(s._0, tcx);
    if (hash_fragment.$ === "Err") return hash_fragment;
    const ptr0 = Pointer.new(CtfeProvenance_from_AllocId(alloc_id), Size.from_bytes(hash_fragment._0));
    const ptr = this.global_root_pointer(ptr0);
    if (ptr.$ === "Err") return ptr;
    const val = Scalar.from_pointer(ptr._0, tcx);
    const w = this.write_scalar(val, elem);
    if (w.$ === "Err") return w;
  }
  return interp_ok(undefined);
};

/// Read a value of type `TypeId`, returning the type it represents.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:124 read_type_id
InterpCx.prototype.read_type_id = function (this: InterpCx, op: OpTy): InterpResult<Ty> {
  // `TypeId` is a newtype around an array of pointers. All pointers must have the same
  // provenance, and that provenance represents the type.
  const ptr_size = PointerArithmetic_provided.pointer_size(this).bytes_usize();
  const arr = this.project_field(op, FieldIdx.ZERO);
  if (arr.$ === "Err") return arr;

  let ty_and_hash: [Ty, Uint8Array] | undefined = undefined;
  const elem_iter_r = this.project_array_fields(arr._0);
  if (elem_iter_r.$ === "Err") return elem_iter_r;
  const elem_iter = elem_iter_r._0;
  for (;;) {
    const n = elem_iter.next(this);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) break;
    const [idx, elem_] = n._0;
    const elem = this.read_pointer(elem_);
    if (elem.$ === "Err") return elem;
    const t = this.get_ptr_type_id(elem._0);
    if (t.$ === "Err") return t;
    const [elem_ty, elem_hash] = t._0;
    // If this is the first element, remember the type and its hash.
    // If this is not the first element, ensure it is consistent with the previous ones.
    let full_hash: Uint8Array;
    if (ty_and_hash === undefined) {
      const hash = Hash128.as_u128(this.tcx.tcx.type_id_hash(elem_ty));
      const hash_bytes = new Uint8Array(16);
      unwrap_io(write_target_uint(this.data_layout().endian, hash_bytes, hash));
      ty_and_hash = [elem_ty, hash_bytes];
      full_hash = hash_bytes;
    } else {
      const [ty, hash_bytes] = ty_and_hash;
      if (ty !== elem_ty) {
        // throw_ub_format!("invalid `TypeId` value: not all bytes carry the same type id metadata")
        return ub_format("invalid `TypeId` value: not all bytes carry the same type id metadata");
      }
      full_hash = hash_bytes;
    }
    // Ensure the elem_hash matches the corresponding part of the full hash.
    const hash_frag = subslice(full_hash, Number(idx) * ptr_size, ptr_size);
    if (unwrap_io(read_target_uint(this.data_layout().endian, hash_frag)) !== elem_hash) {
      // throw_ub_format!("invalid `TypeId` value: the hash does not match the type id metadata")
      return ub_format("invalid `TypeId` value: the hash does not match the type id metadata");
    }
  }

  return interp_ok(unwrap(ty_and_hash)[0]);
};

/// Returns `true` if emulation happened.
/// Here we implement the intrinsics that are common to all Miri instances; individual machines can add their own
/// intrinsic handling.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:172 eval_intrinsic
InterpCx.prototype.eval_intrinsic = function (this: InterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  const instance_args = instance.args;
  const intrinsic_name = this.tcx.tcx.item_name(Instance.def_id(instance));

  if (Symbol.as_str(intrinsic_name).startsWith("atomic_")) {
    return this.eval_atomic_intrinsic(intrinsic_name, instance_args, args, dest, ret);
  }
  if (Symbol.as_str(intrinsic_name).startsWith("simd_")) {
    return this.eval_simd_intrinsic(intrinsic_name, instance_args, args, dest, ret);
  }

  const tcx = this.tcx.tcx;

  switch (intrinsic_name) {
    case sym.type_name: {
      const tp_ty = instance.args.type_at(0);
      const e = ensure_monomorphic_enough(tp_ty, fold_Ty);
      if (e.$ === "Err") return e;
      const [alloc_id, meta] = alloc_type_name(tcx, tp_ty);
      // PORT: `ConstValue::Slice`'s `meta: u64` is a number (mir consts.gen.ts); a type name is far below 2^53 bytes.
      const val0: ConstValue = { $: "Slice", alloc_id, meta: Number(meta) };
      const val = this.const_val_to_op(val0, dest.layout.ty, dest.layout);
      if (val.$ === "Err") return val;
      const c = this.copy_op(val._0, dest);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.needs_drop: {
      const tp_ty = instance.args.type_at(0);
      const e = ensure_monomorphic_enough(tp_ty, fold_Ty);
      if (e.$ === "Err") return e;
      const val0 = ConstValue.from_bool(tp_ty.needs_drop(tcx, this.typing_env));
      const val = this.const_val_to_op(val0, tcx.types.bool, dest.layout);
      if (val.$ === "Err") return val;
      const c = this.copy_op(val._0, dest);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.type_id: {
      const tp_ty = instance.args.type_at(0);
      const e = ensure_monomorphic_enough(tp_ty, fold_Ty);
      if (e.$ === "Err") return e;
      const w = this.write_type_id(tp_ty, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.type_id_eq: {
      const a_ty = this.read_type_id(args[0]!);
      if (a_ty.$ === "Err") return a_ty;
      const b_ty = this.read_type_id(args[1]!);
      if (b_ty.$ === "Err") return b_ty;
      const w = this.write_scalar(Scalar.from_bool(a_ty._0 === b_ty._0), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.size_of: {
      const tp_ty = instance.args.type_at(0);
      const layout = this.layout_of(tp_ty);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      if (!layout._0.is_sized()) {
        return span_bug(this.cur_span(), "unsized type for `size_of`");
      }
      const val = layout._0.size.bytes_u64();
      const w = this.write_scalar(Scalar.from_target_usize(val, this), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.align_of: {
      const tp_ty = instance.args.type_at(0);
      const layout = this.layout_of(tp_ty);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      if (!layout._0.is_sized()) {
        return span_bug(this.cur_span(), "unsized type for `align_of`");
      }
      // `AbiAlign` derefs to its `abi: Align`.
      const val = BigInt(layout._0.align.abi.bytes());
      const w = this.write_scalar(Scalar.from_target_usize(val, this), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.offset_of: {
      const tp_ty = instance.args.type_at(0);

      const v = this.read_scalar(args[0]!);
      if (v.$ === "Err") return v;
      const variant = Scalar.to_u32(v._0);
      if (variant.$ === "Err") return variant;
      const fs = this.read_scalar(args[1]!);
      if (fs.$ === "Err") return fs;
      const field = Scalar.to_u32(fs._0);
      if (field.$ === "Err") return field;

      const layout0 = this.layout_of(tp_ty);
      if (layout0.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout0._0));
      const cx = LayoutCx.new(this.tcx.tcx, this.typing_env);

      const layout = layout0._0.for_variant(cx, VariantIdx.from_u32(variant._0));
      const offset = FieldsShape.offset(layout.fields, field._0).bytes();

      const w = this.write_scalar(Scalar.from_target_usize(BigInt(offset), this), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.variant_count: {
      const tp_ty = instance.args.type_at(0);
      const tk = tp_ty.kind();
      let ty: Ty;
      switch (tk.$) {
        // Pattern types have the same number of variants as their base type.
        // Even if we restrict e.g. which variants are valid, the variants are essentially just uninhabited.
        // And `Result<(), !>` still has two variants according to `variant_count`.
        case "Pat":
          ty = tk._0;
          break;
        default:
          ty = tp_ty;
      }
      const k = ty.kind();
      let val0: ConstValue;
      switch (k.$) {
        // Correctly handles non-monomorphic calls, so there is no need for ensure_monomorphic_enough.
        case "Adt":
          val0 = ConstValue.from_target_usize(k._0.variants().length, tcx);
          break;
        case "Alias":
        case "Param":
        case "Placeholder":
        case "Infer":
          // throw_inval!(TooGeneric)
          return throw_too_generic();
        case "Pat":
          return unreachable();
        case "Bound":
          return bug("bound ty during ctfe");
        case "Bool":
        case "Char":
        case "Int":
        case "Uint":
        case "Float":
        case "Foreign":
        case "Str":
        case "Array":
        case "Slice":
        case "RawPtr":
        case "Ref":
        case "FnDef":
        case "FnPtr":
        case "Dynamic":
        case "Closure":
        case "CoroutineClosure":
        case "Coroutine":
        case "CoroutineWitness":
        case "UnsafeBinder":
        case "Never":
        case "Tuple":
        case "Error":
          val0 = ConstValue.from_target_usize(0, tcx);
          break;
      }
      const val = this.const_val_to_op(val0, dest.layout.ty, dest.layout);
      if (val.$ === "Err") return val;
      const c = this.copy_op(val._0, dest);
      if (c.$ === "Err") return c;
      break;
    }

    case sym.caller_location: {
      const span = this.find_closest_untracked_caller_location();
      const val0 = this.tcx.tcx.span_as_caller_location(span);
      const val = this.const_val_to_op(val0, this.tcx.tcx.caller_location_ty(), dest.layout);
      if (val.$ === "Err") return val;
      const c = this.copy_op(val._0, dest);
      if (c.$ === "Err") return c;
      break;
    }

    case sym.align_of_val:
    case sym.size_of_val: {
      // Avoid `deref_pointer` -- this is not a deref, the ptr does not have to be
      // dereferenceable!
      const imm = this.read_immediate(args[0]!);
      if (imm.$ === "Err") return imm;
      const place = this.imm_ptr_to_mplace(imm._0);
      if (place.$ === "Err") return place;
      const sa = this.size_and_align_of_val(place._0);
      if (sa.$ === "Err") return sa;
      if (sa._0 === undefined) {
        return Err(InterpErrorInfo_from_InterpErrorKind(err_unsup_format("`extern type` does not have known layout")));
      }
      const [size, align] = sa._0;

      // PORT (size-bigint): `result: u64` is exact (`bytes_u64()`: the size of an `isize::MAX`-byte slice).
      let result: bigint;
      switch (intrinsic_name) {
        case sym.align_of_val:
          result = BigInt(align.bytes());
          break;
        case sym.size_of_val:
          result = size.bytes_u64();
          break;
        default:
          return bug();
      }

      const w = this.write_scalar(Scalar.from_target_usize(result, this), dest);
      if (w.$ === "Err") return w;
      break;
    }

    case sym.fadd_algebraic:
    case sym.fsub_algebraic:
    case sym.fmul_algebraic:
    case sym.fdiv_algebraic:
    case sym.frem_algebraic: {
      const a = this.read_immediate(args[0]!);
      if (a.$ === "Err") return a;
      const b = this.read_immediate(args[1]!);
      if (b.$ === "Err") return b;

      let op: BinOp;
      switch (intrinsic_name) {
        case sym.fadd_algebraic:
          op = "Add";
          break;
        case sym.fsub_algebraic:
          op = "Sub";
          break;
        case sym.fmul_algebraic:
          op = "Mul";
          break;
        case sym.fdiv_algebraic:
          op = "Div";
          break;
        case sym.frem_algebraic:
          op = "Rem";
          break;

        default:
          return bug();
      }

      const res0 = this.binary_op(op, a._0, b._0);
      if (res0.$ === "Err") return res0;
      // `binary_op` already called `generate_nan` if needed.
      const res = this.machine.apply_float_nondet(this, res0._0);
      if (res.$ === "Err") return res;
      const w = this.write_immediate(res._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case sym.ctpop:
    case sym.cttz:
    case sym.cttz_nonzero:
    case sym.ctlz:
    case sym.ctlz_nonzero:
    case sym.bswap:
    case sym.bitreverse: {
      const ty = instance_args.type_at(0);
      const layout = this.layout_of(ty);
      if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
      const val = this.read_scalar(args[0]!);
      if (val.$ === "Err") return val;

      const out_val = this.numeric_intrinsic(intrinsic_name, val._0, layout._0, dest.layout);
      if (out_val.$ === "Err") return out_val;
      const w = this.write_scalar(out_val._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.saturating_add:
    case sym.saturating_sub: {
      const l = this.read_immediate(args[0]!);
      if (l.$ === "Err") return l;
      const r = this.read_immediate(args[1]!);
      if (r.$ === "Err") return r;
      const val = this.saturating_arith(intrinsic_name === sym.saturating_add ? "Add" : "Sub", l._0, r._0);
      if (val.$ === "Err") return val;
      const w = this.write_scalar(val._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.discriminant_value: {
      const place = this.deref_pointer(args[0]!);
      if (place.$ === "Err") return place;
      const variant = this.read_discriminant(place._0);
      if (variant.$ === "Err") return variant;
      const discr = this.discriminant_for_variant(place._0.layout.ty, variant._0);
      if (discr.$ === "Err") return discr;
      const w = this.write_immediate(discr._0.imm, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.exact_div: {
      const l = this.read_immediate(args[0]!);
      if (l.$ === "Err") return l;
      const r = this.read_immediate(args[1]!);
      if (r.$ === "Err") return r;
      const e = this.exact_div(l._0, r._0, dest);
      if (e.$ === "Err") return e;
      break;
    }
    case sym.copy: {
      const c = this.copy_intrinsic(args[0]!, args[1]!, args[2]!, /*nonoverlapping*/ false);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.write_bytes: {
      const w = this.write_bytes_intrinsic(args[0]!, args[1]!, args[2]!, "write_bytes");
      if (w.$ === "Err") return w;
      break;
    }
    case sym.compare_bytes: {
      const result = this.compare_bytes_intrinsic(args[0]!, args[1]!, args[2]!);
      if (result.$ === "Err") return result;
      const w = this.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.arith_offset: {
      const ptr = this.read_pointer(args[0]!);
      if (ptr.$ === "Err") return ptr;
      const offset_count = this.read_target_isize(args[1]!);
      if (offset_count.$ === "Err") return offset_count;
      const pointee_ty = instance_args.type_at(0);

      const pl = this.layout_of(pointee_ty);
      if (pl.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(pl._0));
      // `i64::try_from(size.bytes()).unwrap()`: a `Size` (< 2^53) always fits an `i64`.
      const pointee_size = pl._0.size.bytes_u64();
      const offset_bytes = BigInt.asIntN(64, offset_count._0 * pointee_size);
      const offset_ptr = ptr._0.wrapping_signed_offset(offset_bytes, this);
      const w = this.write_pointer(offset_ptr, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.ptr_offset_from:
    case sym.ptr_offset_from_unsigned: {
      const a_r = this.read_pointer(args[0]!);
      if (a_r.$ === "Err") return a_r;
      const a = a_r._0;
      const b_r = this.read_pointer(args[1]!);
      if (b_r.$ === "Err") return b_r;
      const b = b_r._0;

      const ul = this.layout_of(this.tcx.tcx.types.usize);
      if (ul.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(ul._0));
      const usize_layout = ul._0;
      const il = this.layout_of(this.tcx.tcx.types.isize);
      if (il.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(il._0));
      const isize_layout = il._0;

      // Get offsets for both that are at least relative to the same base.
      // With `OFFSET_IS_ADDR` this is trivial; without it we need either
      // two integers or two pointers into the same allocation.
      let a_offset: bigint;
      let b_offset: bigint;
      let is_addr: boolean;
      // PORT: `M::Provenance::OFFSET_IS_ADDR` is `CtfeProvenance`'s (false; place.ts precedent), so the `if` arm is not
      // taken: `(a.addr().bytes(), b.addr().bytes(), /*is_addr*/ true)`.
      {
        const ra = this.ptr_try_get_alloc_id(a, 0n);
        const rb = this.ptr_try_get_alloc_id(b, 0n);
        if (ra.$ === "Err" && rb.$ === "Err") {
          // Neither pointer points to an allocation, so they are both absolute.
          [a_offset, b_offset, is_addr] = [ra._0, rb._0, /*is_addr*/ true];
        } else if (ra.$ === "Ok" && rb.$ === "Ok" && ra._0[0] === rb._0[0]) {
          // Found allocation for both, and it's the same.
          // Use these offsets for distance calculation.
          [a_offset, b_offset, is_addr] = [ra._0[1].bytes_u64(), rb._0[1].bytes_u64(), /*is_addr*/ false];
        } else {
          // Not into the same allocation -- this is UB.
          // throw_ub_format!(..)
          return ub_format(
            `\`${Symbol.as_str(intrinsic_name)}\` called on two different pointers that are not both derived from the same allocation`,
          );
        }
      }

      // Compute distance: a - b.
      let dist: bigint;
      {
        // Addresses are unsigned, so this is a `usize` computation. We have to do the
        // overflow check separately anyway.
        let val: Scalar;
        let overflowed: Scalar;
        {
          const a_offset_ = ImmTy.from_uint(a_offset, usize_layout);
          const b_offset_ = ImmTy.from_uint(b_offset, usize_layout);
          const r = this.binary_op("SubWithOverflow", a_offset_, b_offset_);
          if (r.$ === "Err") return r;
          [val, overflowed] = Immediate.to_scalar_pair(r._0.imm);
        }
        const of = Scalar.to_bool(overflowed);
        if (of.$ === "Err") return of;
        if (of._0) {
          // a < b
          if (intrinsic_name === sym.ptr_offset_from_unsigned) {
            // throw_ub_format!(..)
            return ub_format(
              `\`ptr_offset_from_unsigned\` called when first pointer has smaller ${is_addr ? "address" : "offset"} than second: ${a_offset} < ${b_offset}`,
            );
          }
          // The signed form of the intrinsic allows this. If we interpret the
          // difference as isize, we'll get the proper signed difference. If that
          // seems *positive* or equal to isize::MIN, they were more than isize::MAX apart.
          const d = Scalar.to_target_isize(val, this);
          if (d.$ === "Err") return d;
          if (d._0 >= 0n || d._0 === PointerArithmetic_provided.pointer_size(this).signed_int_min()) {
            // throw_ub_format!(..)
            return ub_format(`\`${Symbol.as_str(intrinsic_name)}\` called when first pointer is too far before second`);
          }
          dist = d._0;
        } else {
          // b >= a
          const d = Scalar.to_target_isize(val, this);
          if (d.$ === "Err") return d;
          // If converting to isize produced a *negative* result, we had an overflow
          // because they were more than isize::MAX apart.
          if (d._0 < 0n) {
            // throw_ub_format!(..)
            return ub_format(`\`${Symbol.as_str(intrinsic_name)}\` called when first pointer is too far ahead of second`);
          }
          dist = d._0;
        }
      }

      // Check that the memory between them is dereferenceable at all, starting from the
      // origin pointer: `dist` is `a - b`, so it is based on `b`.
      const c1 = InterpResult.map_err_kind(this.check_ptr_access_signed(b, dist, { $: "Dereferenceable", _0: "pointer" }), (_) => {
        // This could mean they point to different allocations, or they point to the same allocation
        // but not the entire range between the pointers is in-bounds.
        const ra = this.ptr_try_get_alloc_id(a, 0n);
        const rb = ra.$ === "Ok" ? this.ptr_try_get_alloc_id(b, 0n) : undefined;
        if (ra.$ === "Ok" && rb !== undefined && rb.$ === "Ok" && ra._0[0] === rb._0[0]) {
          return err_ub_format(
            `\`${Symbol.as_str(intrinsic_name)}\` called on two different pointers where the memory range between them is not in-bounds of an allocation`,
          );
        } else {
          return err_ub_format(
            `\`${Symbol.as_str(intrinsic_name)}\` called on two different pointers that are not both derived from the same allocation`,
          );
        }
      });
      if (c1.$ === "Err") return c1;
      // Then check that this is also dereferenceable from `a`. This ensures that they are
      // derived from the same allocation.
      const c2 = InterpResult.map_err_kind(
        this.check_ptr_access_signed(
          a,
          -dist, // i64::MIN is impossible as no allocation can be that large
          { $: "Dereferenceable", _0: "pointer" },
        ),
        (_) => {
          // Make the error more specific.
          return err_ub_format(
            `\`${Symbol.as_str(intrinsic_name)}\` called on two different pointers that are not both derived from the same allocation`,
          );
        },
      );
      if (c2.$ === "Err") return c2;

      // Perform division by size to compute return value.
      let ret_layout: TyAndLayout;
      if (intrinsic_name === sym.ptr_offset_from_unsigned) {
        assert(0n <= dist && dist <= PointerArithmetic_provided.target_isize_max(this), "assertion failed: 0 <= dist && dist <= self.target_isize_max()");
        ret_layout = usize_layout;
      } else {
        assert(
          PointerArithmetic_provided.target_isize_min(this) <= dist && dist <= PointerArithmetic_provided.target_isize_max(this),
          "assertion failed: self.target_isize_min() <= dist && dist <= self.target_isize_max()",
        );
        ret_layout = isize_layout;
      }
      const pl = this.layout_of(instance_args.type_at(0));
      if (pl.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(pl._0));
      const pointee_layout = pl._0;
      // If ret_layout is unsigned, we checked that so is the distance, so we are good.
      const val = ImmTy.from_int(dist, ret_layout);
      const size = ImmTy.from_int(pointee_layout.size.bytes_u64(), ret_layout);
      const e = this.exact_div(val, size, dest);
      if (e.$ === "Err") return e;
      break;
    }

    case sym.black_box: {
      // These just return their argument
      const c = this.copy_op(args[0]!, dest);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.raw_eq: {
      const result = this.raw_eq_intrinsic(args[0]!, args[1]!);
      if (result.$ === "Err") return result;
      const w = this.write_scalar(result._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.typed_swap_nonoverlapping: {
      const s = this.typed_swap_nonoverlapping_intrinsic(args[0]!, args[1]!);
      if (s.$ === "Err") return s;
      break;
    }

    case sym.volatile_load: {
      if (args.length !== 1) {
        return span_bug(this.cur_span(), "invalid `volatile_load` call");
      }
      const ptr = args[0]!;
      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const c = this.copy_op(place._0, dest);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.volatile_store: {
      if (args.length !== 2) {
        return span_bug(this.cur_span(), "invalid `volatile_store` call");
      }
      const [ptr, val] = [args[0]!, args[1]!];
      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const c = this.copy_op(val, place._0);
      if (c.$ === "Err") return c;
      break;
    }
    case sym.volatile_set_memory: {
      if (args.length !== 3) {
        return span_bug(this.cur_span(), "invalid `volatile_set_memory` call");
      }
      const [ptr, val_byte, count] = [args[0]!, args[1]!, args[2]!];
      const w = this.write_bytes_intrinsic(ptr, val_byte, count, "volatile_set_memory");
      if (w.$ === "Err") return w;
      break;
    }

    case sym.vtable_size: {
      const ptr = this.read_pointer(args[0]!);
      if (ptr.$ === "Err") return ptr;
      // `None` because we don't know which trait to expect here; any vtable is okay.
      const sa = this.get_vtable_size_and_align(ptr._0, undefined);
      if (sa.$ === "Err") return sa;
      const [size, _align] = sa._0;
      const w = this.write_scalar(Scalar.from_target_usize(size.bytes_u64(), this), dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.vtable_align: {
      const ptr = this.read_pointer(args[0]!);
      if (ptr.$ === "Err") return ptr;
      // `None` because we don't know which trait to expect here; any vtable is okay.
      const sa = this.get_vtable_size_and_align(ptr._0, undefined);
      if (sa.$ === "Err") return sa;
      const [_size, align] = sa._0;
      const w = this.write_scalar(Scalar.from_target_usize(BigInt(align.bytes()), this), dest);
      if (w.$ === "Err") return w;
      break;
    }

    case sym.minimum_number_nsz_f16:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MinimumNumberNsz, dest, Half), ret);
    case sym.minimum_number_nsz_f32:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MinimumNumberNsz, dest, Single), ret);
    case sym.minimum_number_nsz_f64:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MinimumNumberNsz, dest, Double), ret);
    case sym.minimum_number_nsz_f128:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MinimumNumberNsz, dest, Quad), ret);

    case sym.minimumf16:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Minimum, dest, Half), ret);
    case sym.minimumf32:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Minimum, dest, Single), ret);
    case sym.minimumf64:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Minimum, dest, Double), ret);
    case sym.minimumf128:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Minimum, dest, Quad), ret);

    case sym.maximum_number_nsz_f16:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MaximumNumberNsz, dest, Half), ret);
    case sym.maximum_number_nsz_f32:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MaximumNumberNsz, dest, Single), ret);
    case sym.maximum_number_nsz_f64:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MaximumNumberNsz, dest, Double), ret);
    case sym.maximum_number_nsz_f128:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.MaximumNumberNsz, dest, Quad), ret);

    case sym.maximumf16:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Maximum, dest, Half), ret);
    case sym.maximumf32:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Maximum, dest, Single), ret);
    case sym.maximumf64:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Maximum, dest, Double), ret);
    case sym.maximumf128:
      return float_arm(this, this.float_minmax_intrinsic(args, MinMax.Maximum, dest, Quad), ret);

    case sym.copysignf16:
      return float_arm(this, this.float_copysign_intrinsic(args, dest, Half), ret);
    case sym.copysignf32:
      return float_arm(this, this.float_copysign_intrinsic(args, dest, Single), ret);
    case sym.copysignf64:
      return float_arm(this, this.float_copysign_intrinsic(args, dest, Double), ret);
    case sym.copysignf128:
      return float_arm(this, this.float_copysign_intrinsic(args, dest, Quad), ret);

    case sym.fabs: {
      const arg_r = this.read_immediate(args[0]!);
      if (arg_r.$ === "Err") return arg_r;
      const arg = arg_r._0;
      const k = arg.layout.ty.kind();
      if (k.$ !== "Float") {
        return span_bug(this.cur_span(), `non-float type for float intrinsic: ${display_Ty(arg.layout.ty)}`);
      }
      const float_ty = k._0;
      let out_val: InterpResult<Scalar>;
      switch (float_ty) {
        case "F16":
          out_val = this.unop_float_intrinsic(intrinsic_name, arg, Half);
          break;
        case "F32":
          out_val = this.unop_float_intrinsic(intrinsic_name, arg, Single);
          break;
        case "F64":
          out_val = this.unop_float_intrinsic(intrinsic_name, arg, Double);
          break;
        case "F128":
          out_val = this.unop_float_intrinsic(intrinsic_name, arg, Quad);
          break;
      }
      if (out_val.$ === "Err") return out_val;
      const w = this.write_scalar(out_val._0, dest);
      if (w.$ === "Err") return w;
      break;
    }

    case sym.floorf16:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardNegative, Half), ret);
    case sym.floorf32:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardNegative, Single), ret);
    case sym.floorf64:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardNegative, Double), ret);
    case sym.floorf128:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardNegative, Quad), ret);

    case sym.ceilf16:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardPositive, Half), ret);
    case sym.ceilf32:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardPositive, Single), ret);
    case sym.ceilf64:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardPositive, Double), ret);
    case sym.ceilf128:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardPositive, Quad), ret);

    case sym.truncf16:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardZero, Half), ret);
    case sym.truncf32:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardZero, Single), ret);
    case sym.truncf64:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardZero, Double), ret);
    case sym.truncf128:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.TowardZero, Quad), ret);

    case sym.roundf16:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToAway, Half), ret);
    case sym.roundf32:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToAway, Single), ret);
    case sym.roundf64:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToAway, Double), ret);
    case sym.roundf128:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToAway, Quad), ret);

    case sym.round_ties_even_f16:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToEven, Half), ret);
    case sym.round_ties_even_f32:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToEven, Single), ret);
    case sym.round_ties_even_f64:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToEven, Double), ret);
    case sym.round_ties_even_f128:
      return float_arm(this, this.float_round_intrinsic(args, dest, Round.NearestTiesToEven, Quad), ret);
    case sym.fmaf16:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Fused, Half), ret);
    case sym.fmaf32:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Fused, Single), ret);
    case sym.fmaf64:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Fused, Double), ret);
    case sym.fmaf128:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Fused, Quad), ret);
    case sym.fmuladdf16:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Nondeterministic, Half), ret);
    case sym.fmuladdf32:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Nondeterministic, Single), ret);
    case sym.fmuladdf64:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Nondeterministic, Double), ret);
    case sym.fmuladdf128:
      return float_arm(this, this.float_muladd_intrinsic(args, dest, MulAddType.Nondeterministic, Quad), ret);

    case sym.va_copy: {
      const va_list = this.deref_pointer(args[0]!);
      if (va_list.$ === "Err") return va_list;

      const key_mplace = this.va_list_key_field(va_list._0);
      if (key_mplace.$ === "Err") return key_mplace;
      const key = this.read_pointer(key_mplace._0);
      if (key.$ === "Err") return key;

      const varargs = this.get_ptr_va_list(key._0);
      if (varargs.$ === "Err") return varargs;
      const copy_key = this.va_list_ptr([...varargs._0]);

      // Zero the destination VaList, so it is fully initialized.
      const dest_ = this.force_allocation(dest);
      if (dest_.$ === "Err") return dest_;
      const zeros = repeat_n(0, dest_._0.layout.size.bytes_usize());
      const wb = this.write_bytes_ptr(dest_._0.ptr(), zeros);
      if (wb.$ === "Err") return wb;

      const copy_key_mplace = this.va_list_key_field(dest_._0);
      if (copy_key_mplace.$ === "Err") return copy_key_mplace;
      const w = this.write_pointer(Pointer_Option_from_Pointer(copy_key), copy_key_mplace._0);
      if (w.$ === "Err") return w;
      break;
    }

    case sym.va_end: {
      const va_list = this.deref_pointer(args[0]!);
      if (va_list.$ === "Err") return va_list;
      const key_mplace = this.va_list_key_field(va_list._0);
      if (key_mplace.$ === "Err") return key_mplace;
      const key = this.read_pointer(key_mplace._0);
      if (key.$ === "Err") return key;

      const d = this.deallocate_va_list(key._0);
      if (d.$ === "Err") return d;
      break;
    }

    case sym.va_arg: {
      const va_list = this.deref_pointer(args[0]!);
      if (va_list.$ === "Err") return va_list;
      const key_mplace = this.va_list_key_field(va_list._0);
      if (key_mplace.$ === "Err") return key_mplace;
      const key = this.read_pointer(key_mplace._0);
      if (key.$ === "Err") return key;

      // Invalidate the old list and get its content. We'll recreate the
      // new list (one element shorter) below.
      const varargs_r = this.deallocate_va_list(key._0);
      if (varargs_r.$ === "Err") return varargs_r;
      const varargs = [...varargs_r._0];

      const arg_mplace = varargs.shift();
      if (arg_mplace === undefined) {
        // throw_ub!(VaArgOutOfBounds)
        return Err(InterpErrorInfo_from_InterpErrorKind(err_ub({ $: "VaArgOutOfBounds" })));
      }

      // Error when the caller's argument is not c-variadic compatible with the type
      // requested by the callee.
      const v = this.validate_c_variadic_argument(arg_mplace, dest.layout);
      if (v.$ === "Err") return v;

      // Copy the argument, allowing a transmute and relying on the compatibility check
      // rejecting conversions between types of different size.
      const c = this.copy_op_allow_transmute(arg_mplace, dest);
      if (c.$ === "Err") return c;

      // Update the VaList pointer.
      const new_key = this.va_list_ptr(varargs);
      const w = this.write_pointer(Pointer_Option_from_Pointer(new_key), key_mplace._0);
      if (w.$ === "Err") return w;
      break;
    }

    // Unsupported intrinsic: skip the return_to_block below.
    default:
      return interp_ok(false);
  }

  // trace!("{:?}", self.dump_place(&dest));
  const r = this.return_to_block(ret);
  if (r.$ === "Err") return r;
  return interp_ok(true);
};

/** PORT: the tail of `eval_intrinsic` after a float arm whose body is an expression `self.float_*_intrinsic::<F>(..)?`
 * (`trace!` + `return_to_block(ret)` + `interp_ok(true)`). */
function float_arm(ecx: InterpCx, r: InterpResult<undefined>, ret: BasicBlock | undefined): InterpResult<boolean> {
  if (r.$ === "Err") return r;
  // trace!("{:?}", self.dump_place(&dest));
  const rb = ecx.return_to_block(ret);
  if (rb.$ === "Err") return rb;
  return interp_ok(true);
}

/// Validate whether the value and type passed by the caller are compatible with the type
/// requested by the callee. Based on section 7.16.1.1 of the C23 specification.
///
/// The callee requesting a value of a type is valid when that type is compatible with the type
/// provided by the caller (see `validate_c_variadic_compatible_ty`) and, if both types are
/// integers of the same size but different signedness, the passed value must be representable
/// in both types.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:820 validate_c_variadic_argument
InterpCx.prototype.validate_c_variadic_argument = function (this: InterpCx, arg_mplace: MPlaceTy, callee_type: TyAndLayout): InterpResult {
  const callee_ty = callee_type.ty;
  const caller_ty = arg_mplace.layout.ty;

  const c = this.validate_c_variadic_compatible_ty(arg_mplace.layout.ty, callee_type.ty);
  if (c.$ === "Err") return c;
  const compat = c._0;
  switch (compat.$) {
    case "Compatible":
      return interp_ok(undefined);
    case "Incompatible":
      // throw_ub_format!(..)
      return ub_format(
        `va_arg type mismatch: requested \`${display_Ty(callee_ty)}\` is incompatible with next argument of type \`${display_Ty(caller_ty)}\``,
      );
    case "CastIntTo": {
      const source_is_signed = compat.source_is_signed;
      // Check that the value can be represented in the target type.
      const size = arg_mplace.layout.size;
      const scalar_r = this.read_scalar(arg_mplace);
      if (scalar_r.$ === "Err") return scalar_r;
      const scalar = scalar_r._0;
      const i = Scalar.to_int(scalar, size);
      if (i.$ === "Err") return i;
      if (i._0 < 0n) {
        let value: string;
        if (source_is_signed) {
          const v = Scalar.to_int(scalar, size);
          if (v.$ === "Err") return v;
          value = v._0.toString();
        } else {
          const v = Scalar.to_uint(scalar, size);
          if (v.$ === "Err") return v;
          value = v._0.toString();
        }
        // throw_ub_format!(..)
        return ub_format(`va_arg value mismatch: value \`${value}_${display_Ty(caller_ty)}\` cannot be represented by type \`${display_Ty(callee_ty)}\``);
      }

      return interp_ok(undefined);
    }
  }
};

/// Check whether the caller and callee type are compatible for c-variadic calls. Further
/// validation of the argument value may be needed to detect all UB.
///
/// Types `T` and `U` are compatible when:
///
/// - `T` and `U` are the same type.
/// - `T` and `U` are integer types of the same size.
/// - `T` and `U` are both pointers, and their target types are compatible.
/// - `T` is a pointer to [`std::ffi::c_void`] and `U` is a pointer to [`i8`] or [`u8`],
/// or vice versa.
///
/// This is designed to match the C rules for variadics, it is incomparable to what we allow in
/// terms of ABI mismatches for regular (fixed) function arguments.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:868 validate_c_variadic_compatible_ty
InterpCx.prototype.validate_c_variadic_compatible_ty = function (this: InterpCx, caller_type: Ty, callee_type: Ty): InterpResult<VarArgCompatible> {
  // FIXME: Accepting two copies of the same repr(C) type as compatible is currently not
  // guaranteed by our `VaList::next_arg` docs, but it is needed for Miri itself when it
  // checks whether shims were called with the right arguments. We should eventually put this
  // into the docs as well.
  if (this.identical_c_types(caller_type, callee_type)) {
    return interp_ok(VarArgCompatible.Compatible);
  }

  const cl = this.layout_of(caller_type);
  if (cl.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(cl._0));
  const ce = this.layout_of(callee_type);
  if (ce.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(ce._0));
  if (cl._0.size.bytes() !== ce._0.size.bytes()) {
    return interp_ok(VarArgCompatible.Incompatible);
  }

  // Any character type (`char`, `unsigned char` and `signed char`) is compatible with
  // `void*`, so the signedness of `c_char` is irrelevant here.
  const is_c_char = (ty: Ty): boolean => {
    const k = ty.kind();
    return (k.$ === "Uint" && k._0 === "U8") || (k.$ === "Int" && k._0 === "I8");
  };

  const ck = caller_type.kind();
  const ek = callee_type.kind();
  // Some types look different but are actually the same for ABI purposes.
  if ((ck.$ === "Int" && ek.$ === "Int") || (ck.$ === "Uint" && ek.$ === "Uint")) {
    // E.g. cast between `usize` and `u64` on a 64-bit platform.
    return interp_ok(VarArgCompatible.Compatible);
  }
  // C allows different types if...
  // - "both types are pointers to qualified or unqualified versions of compatible types"
  // - "one type is pointer to qualified or unqualified void and the other is a pointer to a qualified or
  //   unqualified character type"
  //
  // As usual for the ABI, we treat references and raw pointers alike.
  if ((ck.$ === "RawPtr" || ck.$ === "Ref") && (ek.$ === "RawPtr" || ek.$ === "Ref")) {
    const caller_target_ty = ck.$ === "RawPtr" ? ck._0 : ck._1;
    const callee_target_ty = ek.$ === "RawPtr" ? ek._0 : ek._1;
    // In C, types can be qualified by a combination of `const`, `volatile` and
    // `restrict`. These properties are irrelevant for the ABI, and don't have an
    // equivalent in rust.

    // Accept the cast if one type is pointer to void, and the other is a pointer to
    // a character type (`char`, `unsigned char` and `signed char`).
    if (caller_target_ty.is_c_void(this.tcx.tcx) && is_c_char(callee_target_ty)) {
      return interp_ok(VarArgCompatible.Compatible);
    }
    if (callee_target_ty.is_c_void(this.tcx.tcx) && is_c_char(caller_target_ty)) {
      return interp_ok(VarArgCompatible.Compatible);
    }

    // Accept the cast if both types are pointers to compatible types.
    const r = this.validate_c_variadic_compatible_ty(caller_target_ty, callee_target_ty);
    if (r.$ === "Err") return r;
    switch (r._0.$) {
      case "Incompatible":
        return interp_ok(VarArgCompatible.Incompatible);
      case "Compatible":
        return interp_ok(VarArgCompatible.Compatible);
      case "CastIntTo":
        // The integer cast check is not needed when the value is behind a pointer.
        return interp_ok(VarArgCompatible.Compatible);
    }
  }
  // - "one type is a signed integer type, the other type is the corresponding unsigned integer type,
  //   and the value is representable in both types"
  if (ck.$ === "Int" && ek.$ === "Uint") {
    return interp_ok<VarArgCompatible>({ $: "CastIntTo", source_is_signed: true });
  }
  if (ck.$ === "Uint" && ek.$ === "Int") {
    return interp_ok<VarArgCompatible>({ $: "CastIntTo", source_is_signed: false });
  }
  // - "or, the type of the next argument is nullptr_t and type is a pointer type that has the same
  //   representation and alignment requirements as a pointer to a character type"
  //   This one does not have an equivalent form in Rust.
  return interp_ok(VarArgCompatible.Incompatible);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:945 eval_nondiverging_intrinsic
InterpCx.prototype.eval_nondiverging_intrinsic = function (this: InterpCx, intrinsic: NonDivergingIntrinsic): InterpResult {
  switch (intrinsic.$) {
    case "Assume": {
      const op = this.eval_operand(intrinsic._0, undefined);
      if (op.$ === "Err") return op;
      const s = this.read_scalar(op._0);
      if (s.$ === "Err") return s;
      const cond = Scalar.to_bool(s._0);
      if (cond.$ === "Err") return cond;
      if (!cond._0) {
        // throw_ub_format!("`assume` called with `false`")
        return ub_format("`assume` called with `false`");
      }
      return interp_ok(undefined);
    }
    case "CopyNonOverlapping": {
      const { count, src, dst } = intrinsic._0;
      const src_ = this.eval_operand(src, undefined);
      if (src_.$ === "Err") return src_;
      const dst_ = this.eval_operand(dst, undefined);
      if (dst_.$ === "Err") return dst_;
      const count_ = this.eval_operand(count, undefined);
      if (count_.$ === "Err") return count_;
      return this.copy_intrinsic(src_._0, dst_._0, count_._0, /* nonoverlapping */ true);
    }
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:971 numeric_intrinsic
InterpCx.prototype.numeric_intrinsic = function (this: InterpCx, name: Symbol, val: Scalar, layout: TyAndLayout, ret_layout: TyAndLayout): InterpResult<Scalar> {
  assert(layout.ty.is_integral(), () => `invalid type for numeric intrinsic: ${display_Ty(layout.ty)}`);
  const bits_r = Scalar.to_bits(val, layout.size); // these operations all ignore the sign
  if (bits_r.$ === "Err") return bits_r;
  const bits = bits_r._0;
  const extra = 128n - BigInt(layout.size.bits());
  let bits_out: bigint;
  if (name === sym.ctpop) {
    bits_out = BigInt(u128_count_ones(bits));
  } else if ((name === sym.ctlz_nonzero || name === sym.cttz_nonzero) && bits === 0n) {
    // throw_ub_format!("`{name}` called on 0")
    return ub_format(`\`${Symbol.as_str(name)}\` called on 0`);
  } else if (name === sym.ctlz || name === sym.ctlz_nonzero) {
    bits_out = BigInt(u128_leading_zeros(bits)) - extra;
  } else if (name === sym.cttz || name === sym.cttz_nonzero) {
    bits_out = BigInt(u128_trailing_zeros(u128_shl(bits, extra))) - extra;
  } else if (name === sym.bswap) {
    assert_eq(layout, ret_layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);
    bits_out = u128_swap_bytes(u128_shl(bits, extra));
  } else if (name === sym.bitreverse) {
    assert_eq(layout, ret_layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);
    bits_out = u128_reverse_bits(u128_shl(bits, extra));
  } else {
    return bug(`not a numeric intrinsic: ${Symbol.as_str(name)}`);
  }
  return interp_ok(Scalar.from_uint(bits_out, ret_layout.size));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1001 exact_div
InterpCx.prototype.exact_div = function (this: InterpCx, a: ImmTy, b: ImmTy, dest: PlaceTy): InterpResult {
  assert_eq(a.layout.ty, b.layout.ty, (v) => debug_Ty(v, PLAIN));
  const ak = a.layout.ty.kind();
  assert_matches(a.layout.ty, ak.$ === "Int" || ak.$ === "Uint", "ty::Int(..) | ty::Uint(..)", (v) => debug_Ty(v, PLAIN));

  // Performs an exact division, resulting in undefined behavior where
  // `x % y != 0` or `y == 0` or `x == T::MIN && y == -1`.
  // First, check x % y != 0 (or if that computation overflows).
  const rem = this.binary_op("Rem", a, b);
  if (rem.$ === "Err") return rem;
  // sign does not matter for 0 test, so `to_bits` is fine
  const rb = Scalar.to_bits(Immediate.to_scalar(rem._0.imm), a.layout.size);
  if (rb.$ === "Err") return rb;
  if (rb._0 !== 0n) {
    // throw_ub_format!("exact_div: {a} cannot be divided by {b} without remainder")
    return ub_format(`exact_div: ${display_ImmTy(a, PLAIN)} cannot be divided by ${display_ImmTy(b, PLAIN)} without remainder`);
  }
  // `Rem` says this is all right, so we can let `Div` do its job.
  const res = this.binary_op("Div", a, b);
  if (res.$ === "Err") return res;
  return this.write_immediate(res._0.imm, dest);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1023 saturating_arith
InterpCx.prototype.saturating_arith = function (this: InterpCx, mir_op: BinOp, l: ImmTy, r: ImmTy): InterpResult<Scalar> {
  assert_eq(l.layout.ty, r.layout.ty, (v) => debug_Ty(v, PLAIN));
  const lk = l.layout.ty.kind();
  assert_matches(l.layout.ty, lk.$ === "Int" || lk.$ === "Uint", "ty::Int(..) | ty::Uint(..)", (v) => debug_Ty(v, PLAIN));
  assert_matches(mir_op, mir_op === "Add" || mir_op === "Sub", "BinOp::Add | BinOp::Sub", (v) => debug_BinOp(v, PLAIN));

  const res = this.binary_op(unwrap(BinOp.wrapping_to_overflowing(mir_op)), l, r);
  if (res.$ === "Err") return res;
  const [val, overflowed] = Immediate.to_scalar_pair(res._0.imm);
  const of = Scalar.to_bool(overflowed);
  if (of.$ === "Err") return of;
  if (of._0) {
    const size = l.layout.size;
    if (BackendRepr.is_signed(l.layout.backend_repr)) {
      // For signed ints the saturated value depends on the sign of the first
      // term since the sign of the second term can be inferred from this and
      // the fact that the operation has overflowed (if either is 0 no
      // overflow can occur)
      const first_term = Scalar.to_int(Immediate.to_scalar(l.imm), l.layout.size);
      if (first_term.$ === "Err") return first_term;
      if (first_term._0 >= 0n) {
        // Negative overflow not possible since the positive first term
        // can only increase an (in range) negative term for addition
        // or corresponding negated positive term for subtraction.
        return interp_ok(Scalar.from_int(size.signed_int_max(), size));
      } else {
        // Positive overflow not possible for similar reason.
        return interp_ok(Scalar.from_int(size.signed_int_min(), size));
      }
    } else {
      // unsigned
      if (mir_op === "Add") {
        // max unsigned
        return interp_ok(Scalar.from_uint(size.unsigned_int_max(), size));
      } else {
        // underflow to 0
        return interp_ok(Scalar.from_uint(0n, size));
      }
    }
  } else {
    return interp_ok(val);
  }
};

/// Offsets a pointer by some multiple of its type, returning an error if the pointer leaves its
/// allocation.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1069 ptr_offset_inbounds
InterpCx.prototype.ptr_offset_inbounds = function (this: InterpCx, ptr: Pointer<CtfeProvenance | undefined>, offset_bytes: bigint): InterpResult<Pointer<CtfeProvenance | undefined>> {
  // The offset must be in bounds starting from `ptr`.
  const c = this.check_ptr_access_signed(ptr, offset_bytes, CheckInAllocMsg.InboundsPointerArithmetic);
  if (c.$ === "Err") return c;
  // This also implies that there is no overflow, so we are done.
  return interp_ok(ptr.wrapping_signed_offset(offset_bytes, this));
};

/// Copy `count*size_of::<T>()` many bytes from `*src` to `*dst`.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1085 copy_intrinsic
InterpCx.prototype.copy_intrinsic = function (this: InterpCx, src: OpTy, dst: OpTy, count: OpTy, nonoverlapping: boolean): InterpResult {
  const count_ = this.read_target_usize(count);
  if (count_.$ === "Err") return count_;
  const lr = this.layout_of(unwrap(src.layout.ty.builtin_deref(true)));
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  const layout = lr._0;
  const [size0, align] = [layout.size, layout.align.abi];

  const size = this.compute_size_in_bytes(size0, count_._0);
  if (size === undefined) {
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(`overflow computing total size of \`${nonoverlapping ? "copy_nonoverlapping" : "copy"}\``)));
  }

  const src_ = this.read_pointer(src);
  if (src_.$ === "Err") return src_;
  const dst_ = this.read_pointer(dst);
  if (dst_.$ === "Err") return dst_;

  const a1 = this.check_ptr_align(src_._0, align);
  if (a1.$ === "Err") return a1;
  const a2 = this.check_ptr_align(dst_._0, align);
  if (a2.$ === "Err") return a2;

  return this.mem_copy(src_._0, dst_._0, size, nonoverlapping);
};

/// Does a *typed* swap of `*left` and `*right`.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1113 typed_swap_nonoverlapping_intrinsic
InterpCx.prototype.typed_swap_nonoverlapping_intrinsic = function (this: InterpCx, left_: OpTy, right_: OpTy): InterpResult {
  const left_r = this.deref_pointer(left_);
  if (left_r.$ === "Err") return left_r;
  const left = left_r._0;
  const right_r = this.deref_pointer(right_);
  if (right_r.$ === "Err") return right_r;
  const right = right_r._0;
  assert_eq(left.layout, right.layout, (v) => debug_TyAndLayout_Ty(v, PLAIN), TyAndLayout_eq);
  assert(left.layout.is_sized(), "assertion failed: left.layout.is_sized()");
  const kind = MemoryKind.Stack;
  const temp_r = this.allocate(left.layout, kind);
  if (temp_r.$ === "Err") return temp_r;
  const temp = temp_r._0;
  const c1 = this.copy_op(left, temp); // checks alignment of `left`
  if (c1.$ === "Err") return c1;

  // We want to always enforce non-overlapping, even if this is a scalar type.
  // Therefore we directly use the underlying `mem_copy` here.
  const m = this.mem_copy(right.ptr(), left.ptr(), left.layout.size, /*nonoverlapping*/ true);
  if (m.$ === "Err") return m;
  // This means we also need to do the validation of the value that used to be in `right`
  // ourselves. This value is now in `left.` The one that started out in `left` already got
  // validated by the copy above.
  if (this.machine.enforce_validity(this, left.layout)) {
    const v = this.validate_place(
      PlaceTy_from_MPlaceTy(left),
      this.machine.enforce_validity_recursively(this, left.layout),
      /*reset_provenance_and_padding*/ true,
    );
    if (v.$ === "Err") return v;
  }

  const c2 = this.copy_op(temp, right); // checks alignment of `right`
  if (c2.$ === "Err") return c2;

  const d = this.deallocate_ptr(temp.ptr(), undefined, kind);
  if (d.$ === "Err") return d;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1146 write_bytes_intrinsic
InterpCx.prototype.write_bytes_intrinsic = function (this: InterpCx, dst: OpTy, byte: OpTy, count: OpTy, name: string): InterpResult {
  const lr = this.layout_of(unwrap(dst.layout.ty.builtin_deref(true)));
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  const layout = lr._0;

  const dst_ = this.read_pointer(dst);
  if (dst_.$ === "Err") return dst_;
  const bs = this.read_scalar(byte);
  if (bs.$ === "Err") return bs;
  const byte_ = Scalar.to_u8(bs._0);
  if (byte_.$ === "Err") return byte_;
  const count_ = this.read_target_usize(count);
  if (count_.$ === "Err") return count_;

  // `checked_mul` enforces a too small bound (the correct one would probably be target_isize_max),
  // but no actual allocation can be big enough for the difference to be noticeable.
  const len = this.compute_size_in_bytes(layout.size, count_._0);
  if (len === undefined) {
    return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(`overflow computing total size of \`${name}\``)));
  }

  const bytes = repeat_n(byte_._0, len.bytes_usize());
  return this.write_bytes_ptr(dst_._0, bytes);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1169 compare_bytes_intrinsic
InterpCx.prototype.compare_bytes_intrinsic = function (this: InterpCx, left_: OpTy, right_: OpTy, byte_count: OpTy): InterpResult<Scalar> {
  const left = this.read_pointer(left_);
  if (left.$ === "Err") return left;
  const right = this.read_pointer(right_);
  if (right.$ === "Err") return right;
  const nc = this.read_target_usize(byte_count);
  if (nc.$ === "Err") return nc;
  const n = Size.from_bytes(nc._0);

  const left_bytes = this.read_bytes_ptr_strip_provenance(left._0, n);
  if (left_bytes.$ === "Err") return left_bytes;
  const right_bytes = this.read_bytes_ptr_strip_provenance(right._0, n);
  if (right_bytes.$ === "Err") return right_bytes;

  // `Ordering`'s discriminants are -1/0/+1, so casting does the right thing.
  const result = bytes_cmp(left_bytes._0, right_bytes._0);
  return interp_ok(Scalar.from_i32(result));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1187 raw_eq_intrinsic
InterpCx.prototype.raw_eq_intrinsic = function (this: InterpCx, lhs: OpTy, rhs: OpTy): InterpResult<Scalar> {
  const lr = this.layout_of(unwrap(lhs.layout.ty.builtin_deref(true)));
  if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
  const layout = lr._0;
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");

  const get_bytes = (this_: InterpCx, op: OpTy): InterpResult<Uint8Array> => {
    const ptr = this_.read_pointer(op);
    if (ptr.$ === "Err") return ptr;
    const a = this_.check_ptr_align(ptr._0, layout.align.abi);
    if (a.$ === "Err") return a;
    const alloc_ref = this.get_ptr_alloc(ptr._0, layout.size);
    if (alloc_ref.$ === "Err") return alloc_ref;
    if (alloc_ref._0 === undefined) {
      // zero-sized access
      return interp_ok(new Uint8Array(0));
    }
    return alloc_ref._0.get_bytes_strip_provenance();
  };

  const lhs_bytes = get_bytes(this, lhs);
  if (lhs_bytes.$ === "Err") return lhs_bytes;
  const rhs_bytes = get_bytes(this, rhs);
  if (rhs_bytes.$ === "Err") return rhs_bytes;
  return interp_ok(Scalar.from_bool(bytes_cmp(lhs_bytes._0, rhs_bytes._0) === 0));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1212 unop_float_intrinsic
InterpCx.prototype.unop_float_intrinsic = function <F extends Float<F>>(this: InterpCx, name: Symbol, arg: ImmTy, F_: FloatType<F>): InterpResult<Scalar> {
  const x = Scalar.to_float(Immediate.to_scalar(arg.imm), F_);
  if (x.$ === "Err") return x;
  switch (name) {
    // bitwise, no NaN adjustments
    case sym.fabs:
      return interp_ok(F_into_Scalar(x._0.abs(), F_));
    default:
      return bug(`not a unary float intrinsic: ${Symbol.as_str(name)}`);
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1228 float_minmax
InterpCx.prototype.float_minmax = function <F extends Float<F>>(this: InterpCx, a_: Scalar, b_: Scalar, op: MinMax, F_: FloatType<F>): InterpResult<Scalar> {
  const ar = Scalar.to_float(a_, F_);
  if (ar.$ === "Err") return ar;
  const a = ar._0;
  const br = Scalar.to_float(b_, F_);
  if (br.$ === "Err") return br;
  const b = br._0;
  let res: F;
  if ((op === "MinimumNumberNsz" || op === "MaximumNumberNsz") && a.eq(b)) {
    // They are definitely not NaN (those are never equal), but they could be `+0` and `-0`.
    // Let the machine decide which one to return.
    res = this.machine.equal_float_min_max(this, a, b);
  } else {
    let result: F;
    switch (op) {
      case "Minimum":
        result = a.minimum(b);
        break;
      case "MinimumNumberNsz":
        result = a.min(b);
        break;
      case "Maximum":
        result = a.maximum(b);
        break;
      case "MaximumNumberNsz":
        result = a.max(b);
        break;
    }
    res = this.adjust_nan(result, [a, b], F_);
  }

  return interp_ok(F_into_Scalar(res, F_));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1256 float_minmax_intrinsic
InterpCx.prototype.float_minmax_intrinsic = function <F extends Float<F>>(this: InterpCx, args: readonly OpTy[], op: MinMax, dest: PlaceTy, F_: FloatType<F>): InterpResult<undefined> {
  const a = this.read_scalar(args[0]!);
  if (a.$ === "Err") return a;
  const b = this.read_scalar(args[1]!);
  if (b.$ === "Err") return b;
  const res = this.float_minmax(a._0, b._0, op, F_);
  if (res.$ === "Err") return res;
  const w = this.write_scalar(res._0, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1271 float_copysign_intrinsic
InterpCx.prototype.float_copysign_intrinsic = function <F extends Float<F>>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy, F_: FloatType<F>): InterpResult<undefined> {
  const as = this.read_scalar(args[0]!);
  if (as.$ === "Err") return as;
  const a = Scalar.to_float(as._0, F_);
  if (a.$ === "Err") return a;
  const bs = this.read_scalar(args[1]!);
  if (bs.$ === "Err") return bs;
  const b = Scalar.to_float(bs._0, F_);
  if (b.$ === "Err") return b;
  // bitwise, no NaN adjustments
  const w = this.write_scalar(F_into_Scalar(a._0.copy_sign(b._0), F_), dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1286 float_round
InterpCx.prototype.float_round = function <F extends Float<F>>(this: InterpCx, x_: Scalar, mode: Round, F_: FloatType<F>): InterpResult<Scalar> {
  const xr = Scalar.to_float(x_, F_);
  if (xr.$ === "Err") return xr;
  const x = xr._0;
  const res0 = x.round_to_integral(mode).value;
  const res = this.adjust_nan(res0, [x], F_);
  return interp_ok(F_into_Scalar(res, F_));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1300 float_round_intrinsic
InterpCx.prototype.float_round_intrinsic = function <F extends Float<F>>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy, mode: Round, F_: FloatType<F>): InterpResult<undefined> {
  const s = this.read_scalar(args[0]!);
  if (s.$ === "Err") return s;
  const res = this.float_round(s._0, mode, F_);
  if (res.$ === "Err") return res;
  const w = this.write_scalar(res._0, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1314 float_muladd
InterpCx.prototype.float_muladd = function <F extends Float<F>>(this: InterpCx, a_: Scalar, b_: Scalar, c_: Scalar, typ: MulAddType, F_: FloatType<F>): InterpResult<Scalar> {
  const ar = Scalar.to_float(a_, F_);
  if (ar.$ === "Err") return ar;
  const a = ar._0;
  const br = Scalar.to_float(b_, F_);
  if (br.$ === "Err") return br;
  const b = br._0;
  const cr = Scalar.to_float(c_, F_);
  if (cr.$ === "Err") return cr;
  const c = cr._0;

  const fuse = typ === "Fused" || this.machine.float_fuse_mul_add(this);

  const res0 = fuse ? a.mul_add(b, c).value : a.mul(b).value.add(c).value;
  const res = this.adjust_nan(res0, [a, b, c], F_);
  return interp_ok(F_into_Scalar(res, F_));
};

// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1335 float_muladd_intrinsic
InterpCx.prototype.float_muladd_intrinsic = function <F extends Float<F>>(this: InterpCx, args: readonly OpTy[], dest: PlaceTy, typ: MulAddType, F_: FloatType<F>): InterpResult<undefined> {
  const a = this.read_scalar(args[0]!);
  if (a.$ === "Err") return a;
  const b = this.read_scalar(args[1]!);
  if (b.$ === "Err") return b;
  const c = this.read_scalar(args[2]!);
  if (c.$ === "Err") return c;

  const res = this.float_muladd(a._0, b._0, c._0, typ, F_);
  if (res.$ === "Err") return res;
  const w = this.write_scalar(res._0, dest);
  if (w.$ === "Err") return w;
  return interp_ok(undefined);
};

/// Converts `src` from floating point to integer type `dest_ty`
/// after rounding with mode `round`.
/// Returns `None` if `f` is NaN or out of range.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1356 float_to_int_checked
InterpCx.prototype.float_to_int_checked = function (this: InterpCx, src: ImmTy, cast_to: TyAndLayout, round: Round): InterpResult<ImmTy | undefined> {
  // rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1362 float_to_int_inner
  function float_to_int_inner<F extends Float<F>>(ecx: InterpCx, src: F, cast_to: TyAndLayout, round: Round): [Scalar, Status] {
    const int_size = cast_to.size;
    switch (cast_to.ty.kind().$) {
      // Unsigned
      case "Uint": {
        const res = src.to_u128_r(int_size.bits_usize(), round, { value: false });
        return [Scalar.from_uint(res.value, int_size), res.status];
      }
      // Signed
      case "Int": {
        const res = src.to_i128_r(int_size.bits_usize(), round, { value: false });
        return [Scalar.from_int(res.value, int_size), res.status];
      }
      // Nothing else
      default:
        return span_bug(ecx.cur_span(), `attempted float-to-int conversion with non-int output type ${display_Ty(cast_to.ty)}`);
    }
  }

  const k = src.layout.ty.kind();
  if (k.$ !== "Float") {
    return bug(`float_to_int_checked: non-float input type ${display_Ty(src.layout.ty)}`);
  }
  const fty = k._0;

  let val: Scalar;
  let status: Status;
  const s = Immediate.to_scalar(src.imm);
  switch (fty) {
    case "F16": {
      const f = Scalar.to_f16(s);
      if (f.$ === "Err") return f;
      [val, status] = float_to_int_inner(this, f._0, cast_to, round);
      break;
    }
    case "F32": {
      const f = Scalar.to_f32(s);
      if (f.$ === "Err") return f;
      [val, status] = float_to_int_inner(this, f._0, cast_to, round);
      break;
    }
    case "F64": {
      const f = Scalar.to_f64(s);
      if (f.$ === "Err") return f;
      [val, status] = float_to_int_inner(this, f._0, cast_to, round);
      break;
    }
    case "F128": {
      const f = Scalar.to_f128(s);
      if (f.$ === "Err") return f;
      [val, status] = float_to_int_inner(this, f._0, cast_to, round);
      break;
    }
  }

  if (Status.intersects(status, Status.union(Status.union(Status.INVALID_OP, Status.OVERFLOW), Status.UNDERFLOW))) {
    // Floating point value is NaN (flagged with INVALID_OP) or outside the range
    // of values of the integer type (flagged with OVERFLOW or UNDERFLOW).
    return interp_ok(undefined);
  } else {
    // Floating point value can be represented by the integer type after rounding.
    // The INEXACT flag is ignored on purpose to allow rounding.
    return interp_ok(ImmTy.from_scalar(val, cast_to));
  }
};

/// Get the MPlace of the key from the place storing the VaList.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics.rs:1416 va_list_key_field
InterpCx.prototype.va_list_key_field = function <P extends Projectable<P>>(this: InterpCx, va_list: P): InterpResult<P> {
  // The struct wrapped by VaList.
  const va_list_inner_r = this.project_field(va_list, FieldIdx.ZERO);
  if (va_list_inner_r.$ === "Err") return va_list_inner_r;
  const va_list_inner = va_list_inner_r._0;

  // Find the first pointer field in this struct. The exact index is target-specific.
  const k = va_list_inner.layout_().ty.kind();
  if (k.$ !== "Adt") {
    return bug("invalid VaListImpl layout");
  }
  const [adt, substs] = [k._0, k._1];

  const fields = adt.non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (Unnormalized.skip_norm_wip(field.ty(this.tcx.tcx, substs)).is_raw_ptr()) {
      return this.project_field(va_list_inner, FieldIdx.from_usize(i));
    }
  }

  return bug("no VaListImpl field is a pointer");
};

// ---- helpers ----

/** `err_ub!(X)` */
function err_ub(info: UndefinedBehaviorInfo): InterpErrorKind {
  return { $: "UndefinedBehavior", _0: info };
}
/** `err_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function err_ub_format(msg: string): InterpErrorKind {
  return err_ub({ $: "Ub", _0: msg });
}
/** `throw_ub_format!(..)` */
function ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_ub_format(msg)));
}
/** `err_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function err_unsup_format(msg: string): InterpErrorKind {
  return { $: "Unsupported", _0: { $: "Unsupported", _0: msg } };
}
/** `throw_inval!(TooGeneric)` */
function throw_too_generic<T>(): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } }));
}

/** `<F as Into<Scalar>>::into` for the four IEEE types (`F` is dispatched on its `FloatType` dictionary). */
function F_into_Scalar<F extends Float<F>>(f: F, F_: FloatType<F>): Scalar {
  const T = F_ as unknown;
  if (T === Half) return Scalar_from_Half(f as unknown as Half);
  if (T === Single) return Scalar_from_Single(f as unknown as Single);
  if (T === Double) return Scalar_from_Double(f as unknown as Double);
  if (T === Quad) return Scalar_from_Quad(f as unknown as Quad);
  return bug("`Into<Scalar>` on a float type other than Half / Single / Double / Quad");
}

/** `.unwrap()` of the `io::Result` of `read_target_uint` / `write_target_uint` (16 bytes always suffice). */
function unwrap_io<T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T {
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
  return r._0;
}

/** `&s[start..][..len]` (panics like Rust when out of range). */
function subslice(s: Uint8Array, start: number, len: number): Uint8Array {
  if (start > s.length) panic(`range start index ${start} out of range for slice of length ${s.length}`);
  const rest = s.subarray(start);
  if (len > rest.length) panic(`range end index ${len} out of range for slice of length ${rest.length}`);
  return rest.subarray(0, len);
}

/** `std::iter::repeat_n(byte, n)` */
function* repeat_n(byte: number, n: number): IterableIterator<number> {
  for (let i = 0; i < n; i++) yield byte;
}

/** `Ord::cmp` of two byte slices (lexicographic), as `-1 | 0 | 1`. */
function bytes_cmp(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

const U128_MASK = (1n << 128n) - 1n;
/** `u128 << n` (n < 128). */
function u128_shl(v: bigint, n: bigint): bigint {
  return (v << n) & U128_MASK;
}
/** `u128::count_ones` */
function u128_count_ones(v: bigint): number {
  let n = 0;
  for (let x = v; x !== 0n; x >>= 1n) if ((x & 1n) === 1n) n++;
  return n;
}
/** `u128::leading_zeros` */
function u128_leading_zeros(v: bigint): number {
  return v === 0n ? 128 : 128 - v.toString(2).length;
}
/** `u128::trailing_zeros` */
function u128_trailing_zeros(v: bigint): number {
  if (v === 0n) return 128;
  let n = 0;
  for (let x = v; (x & 1n) === 0n; x >>= 1n) n++;
  return n;
}
/** `u128::swap_bytes` */
function u128_swap_bytes(v: bigint): bigint {
  let r = 0n;
  for (let i = 0; i < 16; i++) r = (r << 8n) | ((v >> BigInt(8 * i)) & 0xffn);
  return r;
}
/** `u128::reverse_bits` */
function u128_reverse_bits(v: bigint): bigint {
  let r = 0n;
  for (let i = 0; i < 128; i++) r = (r << 1n) | ((v >> BigInt(i)) & 1n);
  return r;
}
