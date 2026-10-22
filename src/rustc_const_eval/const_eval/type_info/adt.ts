// Port of compiler/rustc_const_eval/src/const_eval/type_info/adt.rs (declared by lane interp-contract, ported by lane
// ctfe-b, plan-m4 wave 23c). The conventions are interpret/eval_context.ts's header (docs/handoff/interp-contract.md).
import { FieldIdx, type VariantIdx } from "../../../rustc_abi/lib.ts";
import { type CompileTimeInterpCx } from "../machine.ts";
import { InterpCx } from "../../interpret/eval_context.ts";
import { type Machine } from "../../interpret/machine.ts";
import { type Writeable } from "../../interpret/place.ts";
import { type InterpResult, interp_ok } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type AdtDef } from "../../../rustc_middle/ty/adt.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type Region } from "../../../rustc_middle/ty/region.ts";
import { unwrap } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { display_Symbol, sym } from "../../../rustc_span/symbol.ts";
import { debug_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { MPlaceTy } from "../../interpret/place.gen.ts";
import type { Const } from "../../../rustc_middle/ty/consts.gen.ts";

declare module "../../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // adt.rs:14 (lane ctfe-b)
    write_adt_type_info<P extends Writeable<P>>(place: P, adt_def: AdtDef): InterpResult<VariantIdx>;
    // adt.rs:36 (lane ctfe-b)
    write_generics(place: Writeable, generics: GenericArgs): InterpResult;
    // adt.rs:50 (lane ctfe-b)
    write_generic_lifetime(_region: Region, place: MPlaceTy): InterpResult;
    // adt.rs:60 (lane ctfe-b)
    write_generic_type(ty: Ty, place: MPlaceTy): InterpResult;
    // adt.rs:84 (lane ctfe-b)
    write_generic_const(c: Const, place: MPlaceTy): InterpResult;
  }
}

// FIXME(type_info): No semver considerations for now
// PORT: `&impl Writeable` (projected here) is the type parameter `P extends Writeable<P>`.
// rustc: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:14 write_adt_type_info
InterpCx.prototype.write_adt_type_info = function <P extends Writeable<P>>(this: CompileTimeInterpCx, place: P, adt_def: AdtDef): InterpResult<VariantIdx> {
  let variant_idx: VariantIdx;
  switch (adt_def.adt_kind()) {
    case "Struct": {
      const d = this.project_downcast_named(place, sym.Struct);
      if (d.$ === "Err") return d;
      const [variant] = d._0;
      variant_idx = variant;
      break;
    }
    case "Union": {
      const d = this.project_downcast_named(place, sym.Union);
      if (d.$ === "Err") return d;
      const [variant] = d._0;
      variant_idx = variant;
      break;
    }
    case "Enum": {
      const d = this.project_downcast_named(place, sym.Enum);
      if (d.$ === "Err") return d;
      const [variant] = d._0;
      variant_idx = variant;
      break;
    }
  }
  return interp_ok(variant_idx);
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:36 write_generics
InterpCx.prototype.write_generics = function (this: CompileTimeInterpCx, place: Writeable, generics: GenericArgs): InterpResult {
  return this.allocate_fill_and_write_slice_ptr(place, BigInt(generics.length), (this_, i, place) => {
    const k = GenericArg.kind(generics[Number(i)]!);
    switch (k.$) {
      case "Lifetime":
        return this_.write_generic_lifetime(k._0, place);
      case "Type":
        return this_.write_generic_type(k._0, place);
      case "Const":
        return this_.write_generic_const(k._0, place);
    }
  });
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:50 write_generic_lifetime
InterpCx.prototype.write_generic_lifetime = function (this: CompileTimeInterpCx, _region: Region, place: MPlaceTy): InterpResult {
  const d = this.project_downcast_named(place, sym.Lifetime);
  if (d.$ === "Err") return d;
  const [variant_idx] = d._0;
  const r = this.write_discriminant(variant_idx, place);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:60 write_generic_type
InterpCx.prototype.write_generic_type = function (this: CompileTimeInterpCx, ty: Ty, place: MPlaceTy): InterpResult {
  const d = this.project_downcast_named(place, sym.Type);
  if (d.$ === "Err") return d;
  const [variant_idx, variant_place] = d._0;
  const gp = this.project_field(variant_place, FieldIdx.ZERO);
  if (gp.$ === "Err") return gp;
  const generic_type_place = gp._0;

  const fields = unwrap(generic_type_place.layout_().ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field_def = fields[i]!;
    const fp = this.project_field(generic_type_place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field_def.name) {
      case sym.ty: {
        const r = this.write_type_id(ty, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field_def.name;
        return span_bug(this.tcx.tcx.def_span(field_def.did), `unimplemented field ${display_Symbol(other)}`);
      }
    }
  }

  const r = this.write_discriminant(variant_idx, place);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/const_eval/type_info/adt.rs:84 write_generic_const
InterpCx.prototype.write_generic_const = function (this: CompileTimeInterpCx, c_: Const, place: MPlaceTy): InterpResult {
  const ck = c_.kind();
  if (ck.$ !== "Value") {
    return bug(`expected a computed const, got ${debug_Const(c_, PLAIN)}`);
  }
  const c = ck._0;

  const d = this.project_downcast_named(place, sym.Const);
  if (d.$ === "Err") return d;
  const [variant_idx, variant_place] = d._0;
  const cp = this.project_field(variant_place, FieldIdx.ZERO);
  if (cp.$ === "Err") return cp;
  const const_place = cp._0;

  const fields = unwrap(const_place.layout_().ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field_def = fields[i]!;
    const fp = this.project_field(const_place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field_def.name) {
      case sym.ty: {
        const r = this.write_type_id(c.ty, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field_def.name;
        return span_bug(this.tcx.tcx.def_span(field_def.did), `unimplemented field ${display_Symbol(other)}`);
      }
    }
  }

  const r = this.write_discriminant(variant_idx, place);
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};
