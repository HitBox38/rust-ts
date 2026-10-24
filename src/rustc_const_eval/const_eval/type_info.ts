// Port of compiler/rustc_const_eval/src/const_eval/type_info.rs (declared by lane interp-contract, ported by lane ctfe-b,
// plan-m4 wave 23c). The conventions are interpret/eval_context.ts's header (docs/handoff/interp-contract.md).
// `mod adt;` is type_info/adt.ts (loaded by const_eval/mod.ts).
import { type CompileTimeInterpCx } from "./machine.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { type Machine } from "../interpret/machine.ts";
import { type Writeable } from "../interpret/place.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { type FnHeader } from "../../rustc_type_ir/ty_kind.ts";
import { assert_eq, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Immediate } from "../interpret/operand.ts";
import { MemoryKind } from "../interpret/memory.gen.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { FieldIdx, FieldsShape, type VariantIdx } from "../../rustc_abi/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { CtfeProvenance, InterpErrorInfo_from_InterpErrorKind, interp_ok, Scalar, Scalar_from_ScalarInt } from "../../rustc_middle/mir/interpret/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { fold_GenericArgs, type GenericArg, type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { display_Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { FnSigKind, FnSigTys, UnsafeBinderInner_deref } from "../../rustc_type_ir/ty_kind.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

declare module "../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // type_info.rs:19 (lane ctfe-b)
    allocate_fill_and_write_slice_ptr(slice_place: Writeable, len: bigint, writer: (a0: CompileTimeInterpCx, a1: bigint, a2: MPlaceTy) => InterpResult): InterpResult;
    // type_info.rs:50 (lane ctfe-b)
    write_type_info<P extends Writeable<P>>(ty: Ty, dest: P): InterpResult;
    // type_info.rs:172 (lane ctfe-b)
    write_field(field_ty: Ty, place: MPlaceTy, layout: TyAndLayout, name: Symbol | undefined, idx: bigint): InterpResult;
    // type_info.rs:213 (lane ctfe-b)
    write_tuple_type_info<P extends Writeable<P>>(tuple_place: P, fields: readonly Ty[], tuple_ty: Ty): InterpResult;
    // type_info.rs:231 (lane ctfe-b)
    write_type_id_generics(place: Writeable, ty: Ty): InterpResult;
    // type_info.rs:274 (lane ctfe-b)
    write_fn_ptr_type_info<P extends Writeable<P>>(place: P, sig: FnSigTys, fn_header: FnHeader): InterpResult;
  }
}

// A general method to write an array to a static slice place.
// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:19 allocate_fill_and_write_slice_ptr
InterpCx.prototype.allocate_fill_and_write_slice_ptr = function (
  this: CompileTimeInterpCx,
  slice_place: Writeable,
  len: bigint,
  writer: (a0: CompileTimeInterpCx, /* index */ a1: bigint, a2: MPlaceTy) => InterpResult,
): InterpResult {
  // Array element type
  const field_ty = unwrap(slice_place.layout_().ty.builtin_deref(false)).sequence_element_type(this.tcx.tcx);

  // Allocate an array
  // PORT: `Ty::new_array`'s `n: u64` is a number here (the array is built in memory, far below 2^53).
  const al = this.layout_of(Ty.new_array(this.tcx.tcx, field_ty, Number(len)));
  if (al.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(al._0));
  const array_layout = al._0;
  const ap = this.allocate(array_layout, MemoryKind.Stack);
  if (ap.$ === "Err") return ap;
  let array_place = ap._0;

  // Fill the array fields
  const fp = this.project_array_fields(array_place);
  if (fp.$ === "Err") return fp;
  const field_places = fp._0;
  for (;;) {
    const n = field_places.next(this);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) break;
    const [i, place] = n._0;
    const r = writer(this, i, place);
    if (r.$ === "Err") return r;
  }

  // Write the slice pointing to the array
  array_place = array_place.map_provenance(CtfeProvenance.as_immutable);
  const ptr = Immediate.new_slice(array_place.ptr(), len, this);
  return this.write_immediate(ptr, slice_place);
};

/// Writes a `core::mem::type_info::TypeInfo` for a given type, `ty` to the given place.
// PORT: `impl Writeable` (projected here) is the type parameter `P extends Writeable<P>`.
// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:50 write_type_info
InterpCx.prototype.write_type_info = function <P extends Writeable<P>>(this: CompileTimeInterpCx, ty: Ty, dest: P): InterpResult {
  const ty_struct_ = this.tcx.tcx.require_lang_item(LangItem.Type, this.tcx.span);
  const ty_struct = unwrap(EarlyBinder.no_bound_vars(this.tcx.type_of(ty_struct_) as EarlyBinder<Ty>, fold_Ty));
  assert_eq(ty_struct, dest.layout_().ty, (t) => debug_Ty(t, PLAIN));
  const ty_struct_variant = unwrap(ty_struct.ty_adt_def()).non_enum_variant();
  // Fill all fields of the `TypeInfo` struct.
  const fields = ty_struct_variant.fields;
  for (let i = 0; i < fields.length; i++) {
    const idx = i as FieldIdx;
    const field = fields[i]!;
    const fd = this.project_field(dest, idx);
    if (fd.$ === "Err") return fd;
    const field_dest = fd._0;
    switch (field.name) {
      case sym.kind: {
        let variant_index: VariantIdx;
        const k = ty.kind();
        switch (k.$) {
          case "Tuple": {
            const fields = k._0;
            const d = this.project_downcast_named(field_dest, sym.Tuple);
            if (d.$ === "Err") return d;
            const [variant, variant_place] = d._0;
            // project to the single tuple variant field of `type_info::Tuple` struct type
            const tp = this.project_field(variant_place, FieldIdx.ZERO);
            if (tp.$ === "Err") return tp;
            const tuple_place = tp._0;
            assert_eq(1, unwrap(tuple_place.layout_().ty.ty_adt_def()).non_enum_variant().fields.length, (v) => String(v));
            const r = this.write_tuple_type_info(tuple_place, fields, ty);
            if (r.$ === "Err") return r;
            variant_index = variant;
            break;
          }
          case "Array": {
            const d = this.project_downcast_named(field_dest, sym.Array);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Slice": {
            const d = this.project_downcast_named(field_dest, sym.Slice);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Adt": {
            const r = this.write_adt_type_info(field_dest, k._0);
            if (r.$ === "Err") return r;
            variant_index = r._0;
            break;
          }
          case "Bool": {
            const d = this.project_downcast_named(field_dest, sym.Bool);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Char": {
            const d = this.project_downcast_named(field_dest, sym.Char);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Int": {
            const d = this.project_downcast_named(field_dest, sym.Int);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Uint": {
            const d = this.project_downcast_named(field_dest, sym.Int);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Float": {
            const d = this.project_downcast_named(field_dest, sym.Float);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Str": {
            const d = this.project_downcast_named(field_dest, sym.Str);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Ref": {
            const d = this.project_downcast_named(field_dest, sym.Reference);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "RawPtr": {
            const d = this.project_downcast_named(field_dest, sym.Pointer);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Dynamic": {
            const predicates = k._0;
            const region = k._1;
            const d = this.project_downcast_named(field_dest, sym.DynTrait);
            if (d.$ === "Err") return d;
            const [variant, variant_place] = d._0;
            const dp = this.project_field(variant_place, FieldIdx.ZERO);
            if (dp.$ === "Err") return dp;
            const r = this.write_dyn_trait_type_info(dp._0, predicates, region);
            if (r.$ === "Err") return r;
            variant_index = variant;
            break;
          }
          case "FnPtr": {
            const d = this.project_downcast_named(field_dest, sym.FnPtr);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
          case "Foreign":
          case "Pat":
          case "FnDef":
          case "UnsafeBinder":
          case "Closure":
          case "CoroutineClosure":
          case "Coroutine":
          case "CoroutineWitness":
          case "Never":
          case "Alias":
          case "Param":
          case "Bound":
          case "Placeholder":
          case "Infer":
          case "Error": {
            const d = this.project_downcast_named(field_dest, sym.Other);
            if (d.$ === "Err") return d;
            variant_index = d._0[0];
            break;
          }
        }
        const r = this.write_discriminant(variant_index, field_dest);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field.name;
        return span_bug(this.tcx.span, `unknown \`Type\` field ${display_Symbol(other)}`);
      }
    }
  }

  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:172 write_field
InterpCx.prototype.write_field = function (
  this: CompileTimeInterpCx,
  field_ty_: Ty,
  place: MPlaceTy,
  layout: TyAndLayout,
  name_: Symbol | undefined,
  idx: bigint,
): InterpResult {
  const fields = unwrap(place.layout.ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field_ty_field = fields[i]!;
    const fp = this.project_field(place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field_ty_field.name) {
      case sym.name: {
        let name: string;
        if (name_ !== undefined) {
          name = Symbol.as_str(name_);
        } else {
          name = idx.toString(); // For tuples
        }
        const np = this.allocate_str_dedup(name);
        if (np.$ === "Err") return np;
        const name_place = np._0;
        const ptr = this.mplace_to_imm_ptr(name_place, undefined);
        if (ptr.$ === "Err") return ptr;
        const r = this.write_immediate(ptr._0.imm, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.ty: {
        const field_ty = this.tcx.tcx.erase_and_anonymize_regions(field_ty_, fold_Ty);
        const r = this.write_type_id(field_ty, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.offset: {
        const offset = FieldsShape.offset(layout.fields, Number(idx));
        const r = this.write_scalar(Scalar_from_ScalarInt(unwrap(ScalarInt.try_from_target_usize(BigInt(offset.bytes()), this.tcx.tcx))), field_place);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field_ty_field.name;
        return span_bug(this.tcx.tcx.def_span(field_ty_field.did), `unimplemented field ${display_Symbol(other)}`);
      }
    }
  }
  return interp_ok(undefined);
};

// PORT: `impl Writeable` (projected here) is the type parameter `P extends Writeable<P>`.
// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:213 write_tuple_type_info
InterpCx.prototype.write_tuple_type_info = function <P extends Writeable<P>>(this: CompileTimeInterpCx, tuple_place: P, fields: readonly Ty[], tuple_ty: Ty): InterpResult {
  const tl = this.layout_of(tuple_ty);
  if (tl.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(tl._0));
  const tuple_layout = tl._0;
  const fsp = this.project_field(tuple_place, FieldIdx.ZERO);
  if (fsp.$ === "Err") return fsp;
  const fields_slice_place = fsp._0;
  return this.allocate_fill_and_write_slice_ptr(fields_slice_place, BigInt(fields.length), (this_, i, place) => {
    const field_ty = fields[Number(i)]!;
    return this_.write_field(field_ty, place, tuple_layout, undefined, i);
  });
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:231 write_type_id_generics
InterpCx.prototype.write_type_id_generics = function (this: CompileTimeInterpCx, place: Writeable, ty: Ty): InterpResult {
  let generics_: Binder<GenericArgsRef>;
  const k = ty.kind();
  switch (k.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Foreign":
    case "Str":
    case "Array":
    case "Pat":
    case "RawPtr":
    case "Ref":
    case "FnPtr":
    case "Dynamic":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
    case "Error":
    case "Slice":
      generics_ = Binder.dummy(RawList.empty<GenericArg>(), fold_GenericArgs);
      break;
    case "Adt":
      generics_ = Binder.dummy(k._1, fold_GenericArgs);
      break;
    case "FnDef":
      generics_ = k._1;
      break;
    case "UnsafeBinder":
      generics_ = Binder.rebind(UnsafeBinderInner_deref(k._0), RawList.empty<GenericArg>());
      break;
    case "Closure":
      generics_ = Binder.dummy(k._1, fold_GenericArgs);
      break;
    case "CoroutineClosure":
      generics_ = Binder.dummy(k._1, fold_GenericArgs);
      break;
    case "Coroutine":
      generics_ = Binder.dummy(k._1, fold_GenericArgs);
      break;
  }

  // FIXME(type_info): also provide the late bound vars to reflection
  const generics = Binder.skip_binder(generics_);

  return this.write_generics(place, generics);
};

// PORT: `impl Writeable` (projected here) is the type parameter `P extends Writeable<P>`.
// rustc: compiler/rustc_const_eval/src/const_eval/type_info.rs:274 write_fn_ptr_type_info
InterpCx.prototype.write_fn_ptr_type_info = function <P extends Writeable<P>>(this: CompileTimeInterpCx, place: P, sig: FnSigTys, fn_header: FnHeader): InterpResult {
  const { fn_sig_kind } = fn_header;

  const fields = unwrap(place.layout_().ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field = fields[i]!;
    const fp = this.project_field(place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;

    switch (field.name) {
      case sym.is_unsafe: {
        const r = this.write_scalar(Scalar.from_bool(!FnSigKind.is_safe(fn_sig_kind)), field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.abi: {
        const abi = FnSigKind.abi(fn_sig_kind);
        switch (abi.$) {
          case "C": {
            const d = this.project_downcast_named(field_place, sym.ExternC);
            if (d.$ === "Err") return d;
            const [rust_variant, _rust_place] = d._0;
            const r = this.write_discriminant(rust_variant, field_place);
            if (r.$ === "Err") return r;
            break;
          }
          case "Rust": {
            const d = this.project_downcast_named(field_place, sym.ExternRust);
            if (d.$ === "Err") return d;
            const [rust_variant, _rust_place] = d._0;
            const r = this.write_discriminant(rust_variant, field_place);
            if (r.$ === "Err") return r;
            break;
          }
          default: {
            const other_abi = abi;
            const d = this.project_downcast_named(field_place, sym.Named);
            if (d.$ === "Err") return d;
            const [variant, variant_place] = d._0;
            const sp = this.allocate_str_dedup(ExternAbi.as_str(other_abi));
            if (sp.$ === "Err") return sp;
            const str_place = sp._0;
            const sr = this.mplace_to_imm_ptr(str_place, undefined);
            if (sr.$ === "Err") return sr;
            const str_ref = sr._0;
            const pl = this.project_field(variant_place, FieldIdx.ZERO);
            if (pl.$ === "Err") return pl;
            const payload = pl._0;
            const r1 = this.write_immediate(str_ref.imm, payload);
            if (r1.$ === "Err") return r1;
            const r2 = this.write_discriminant(variant, field_place);
            if (r2.$ === "Err") return r2;
            break;
          }
        }
        break;
      }
      case sym.inputs: {
        const inputs = FnSigTys.inputs(sig);
        const r = this.allocate_fill_and_write_slice_ptr(field_place, BigInt(inputs.length), (this_, i, place) => this_.write_type_id(inputs[Number(i)]!, place));
        if (r.$ === "Err") return r;
        break;
      }
      case sym.output: {
        const output = FnSigTys.output(sig);
        const r = this.write_type_id(output, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.variadic: {
        const r = this.write_scalar(Scalar.from_bool(FnSigKind.c_variadic(fn_sig_kind)), field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.is_splatted: {
        const r = this.write_scalar(Scalar.from_bool(FnSigKind.splatted(fn_sig_kind) !== undefined), field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.splatted_index: {
        const r = this.write_scalar(
          Scalar.from_u8(
            // Currently the same encoding as FnSigKind.splatted
            // FIXME(splat): make these two fields into a single Option<u8/u16>, or choose a stable encoding
            FnSigKind.splatted(fn_sig_kind) ?? FnSigKind.NO_SPLATTED_ARG_INDEX,
          ),
          field_place,
        );
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field.name;
        return span_bug(this.tcx.tcx.def_span(field.did), `unimplemented field ${display_Symbol(other)}`);
      }
    }
  }

  return interp_ok(undefined);
};
