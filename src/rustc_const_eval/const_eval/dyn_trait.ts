// Port of compiler/rustc_const_eval/src/const_eval/dyn_trait.rs (declared by lane interp-contract, ported by lane ctfe-b,
// plan-m4 wave 23c). The conventions are interpret/eval_context.ts's header (docs/handoff/interp-contract.md).
import { type CompileTimeInterpCx } from "./machine.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { type Machine } from "../interpret/machine.ts";
import { type Writeable } from "../interpret/place.ts";
import { Immediate } from "../interpret/operand.ts";
import { MemoryKind } from "../interpret/memory.gen.ts";
import { type FieldIdx } from "../../rustc_abi/lib.ts";
import { CtfeProvenance, InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { display_Symbol, sym } from "../../rustc_span/symbol.ts";
import { type ExistentialProjection, type ExistentialTraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { type ExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type Region } from "../../rustc_middle/ty/region.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

declare module "../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // dyn_trait.rs:10 (lane ctfe-b)
    write_dyn_trait_type_info<P extends Writeable<P>>(dyn_place: P, data: List<Binder<ExistentialPredicate>>, region: Region): InterpResult;
    // dyn_trait.rs:64 (lane ctfe-b)
    mk_dyn_principal_auto_trait_ty(auto_trait_def_id: Binder<DefId>, region: Region): Ty;
    // dyn_trait.rs:79 (lane ctfe-b)
    write_dyn_trait_predicates_slice(slice_place: Writeable, principal_ty: Ty | undefined, auto_trait_def_ids: readonly Binder<DefId>[], region: Region): InterpResult;
    // dyn_trait.rs:121 (lane ctfe-b)
    write_dyn_trait_predicate(predicate_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult;
    // dyn_trait.rs:153 (lane ctfe-b)
    write_trait(trait_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult;
  }
}

// rustc: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:10 write_dyn_trait_type_info
// PORT: `impl Writeable` (projected here) is the type parameter `P extends Writeable<P>`.
InterpCx.prototype.write_dyn_trait_type_info = function <P extends Writeable<P>>(
  this: CompileTimeInterpCx,
  dyn_place: P,
  data: List<Binder<ExistentialPredicate>>,
  region: Region,
): InterpResult {
  const tcx = this.tcx.tcx;

  // Find the principal trait ref (for super trait collection), collect auto traits,
  // and collect all projection predicates (used when computing TypeId for each supertrait).
  let principal: Binder<ExistentialTraitRef> | undefined = undefined;
  const auto_traits_def_ids: Binder<DefId>[] = [];
  const projections: Binder<ExistentialProjection>[] = [];

  for (const b of data) {
    const p = Binder.skip_binder(b);
    switch (p.$) {
      case "Trait":
        principal = Binder.rebind(b, p._0);
        break;
      case "AutoTrait":
        auto_traits_def_ids.push(Binder.rebind(b, p._0));
        break;
      case "Projection":
        projections.push(Binder.rebind(b, p._0));
        break;
    }
  }

  // This is to make principal dyn type include Trait and projection predicates, excluding auto traits.
  let principal_ty: Ty | undefined = undefined;
  if (principal !== undefined) {
    const preds = tcx.mk_poly_existential_predicates_from_iter(data.filter((b) => !(Binder.skip_binder(b).$ === "AutoTrait")));
    principal_ty = Ty.new_dynamic(tcx, preds, region);
  }

  // DynTrait { predicates: &'static [Trait] }
  const fields = unwrap(dyn_place.layout_().ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field = fields[i]!;
    const fp = this.project_field(dyn_place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field.name) {
      case sym.predicates: {
        const r = this.write_dyn_trait_predicates_slice(field_place, principal_ty, auto_traits_def_ids, region);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field.name;
        return span_bug(this.tcx.tcx.def_span(field.did), `unimplemented DynTrait field ${display_Symbol(other)}`);
      }
    }
  }

  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:64 mk_dyn_principal_auto_trait_ty
InterpCx.prototype.mk_dyn_principal_auto_trait_ty = function (this: CompileTimeInterpCx, auto_trait_def_id: Binder<DefId>, region: Region): Ty {
  const tcx = this.tcx.tcx;

  // Preserve the binder vars from the original auto-trait predicate.
  const pred_inner: ExistentialPredicate = { $: "AutoTrait", _0: Binder.skip_binder(auto_trait_def_id) };
  const pred = Binder.bind_with_vars(pred_inner, Binder.bound_vars(auto_trait_def_id));

  const preds = tcx.mk_poly_existential_predicates_from_iter([pred]);
  return Ty.new_dynamic(tcx, preds, region);
};

// rustc: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:79 write_dyn_trait_predicates_slice
InterpCx.prototype.write_dyn_trait_predicates_slice = function (
  this: CompileTimeInterpCx,
  slice_place: Writeable,
  principal_ty: Ty | undefined,
  auto_trait_def_ids: readonly Binder<DefId>[],
  region: Region,
): InterpResult {
  const tcx = this.tcx.tcx;

  // total entries in DynTrait predicates
  const total_len = (principal_ty !== undefined ? 1 : 0) + auto_trait_def_ids.length;

  // element type = DynTraitPredicate
  const slice_ty = unwrap(slice_place.layout_().ty.builtin_deref(false)); // [DynTraitPredicate]
  const elem_ty = slice_ty.sequence_element_type(tcx); // DynTraitPredicate

  const al = this.layout_of(Ty.new_array(tcx, elem_ty, total_len));
  if (al.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(al._0));
  const arr_layout = al._0;
  const ap = this.allocate(arr_layout, MemoryKind.Stack);
  if (ap.$ === "Err") return ap;
  let arr_place = ap._0;
  const ei = this.project_array_fields(arr_place);
  if (ei.$ === "Err") return ei;
  const elems = ei._0;

  // principal entry (if any) - NOT an auto trait
  if (principal_ty !== undefined) {
    const n = elems.next(this);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) {
      return span_bug(this.tcx.span, "DynTrait.predicates length computed wrong (principal)");
    }
    const [_i, elem_place] = n._0;
    const r = this.write_dyn_trait_predicate(elem_place, principal_ty, false);
    if (r.$ === "Err") return r;
  }

  // auto trait entries - these ARE auto traits
  for (const auto of auto_trait_def_ids) {
    const n = elems.next(this);
    if (n.$ === "Err") return n;
    if (n._0 === undefined) {
      return span_bug(this.tcx.span, "DynTrait.predicates length computed wrong (auto)");
    }
    const [_i, elem_place] = n._0;
    const auto_ty = this.mk_dyn_principal_auto_trait_ty(auto, region);
    const r = this.write_dyn_trait_predicate(elem_place, auto_ty, true);
    if (r.$ === "Err") return r;
  }

  arr_place = arr_place.map_provenance(CtfeProvenance.as_immutable);
  const imm = Immediate.new_slice(arr_place.ptr(), BigInt(total_len), this);
  return this.write_immediate(imm, slice_place);
};

// rustc: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:121 write_dyn_trait_predicate
InterpCx.prototype.write_dyn_trait_predicate = function (this: CompileTimeInterpCx, predicate_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult {
  // DynTraitPredicate { trait_ty: Trait }
  const fields = unwrap(predicate_place.layout.ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field = fields[i]!;
    const fp = this.project_field(predicate_place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field.name) {
      case sym.trait_ty: {
        // Now write the Trait struct
        const r = this.write_trait(field_place, trait_ty, is_auto);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field.name;
        return span_bug(this.tcx.tcx.def_span(field.did), `unimplemented DynTraitPredicate field ${display_Symbol(other)}`);
      }
    }
  }
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:153 write_trait
InterpCx.prototype.write_trait = function (this: CompileTimeInterpCx, trait_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult {
  // Trait { ty: TypeId, is_auto: bool }
  const fields = unwrap(trait_place.layout.ty.ty_adt_def()).non_enum_variant().fields;
  for (let i = 0; i < fields.length; i++) {
    const field_idx = i as FieldIdx;
    const field = fields[i]!;
    const fp = this.project_field(trait_place, field_idx);
    if (fp.$ === "Err") return fp;
    const field_place = fp._0;
    switch (field.name) {
      case sym.ty: {
        const r = this.write_type_id(trait_ty, field_place);
        if (r.$ === "Err") return r;
        break;
      }
      case sym.is_auto: {
        const r = this.write_scalar(Scalar.from_bool(is_auto), field_place);
        if (r.$ === "Err") return r;
        break;
      }
      default: {
        const other = field.name;
        return span_bug(this.tcx.tcx.def_span(field.did), `unimplemented Trait field ${display_Symbol(other)}`);
      }
    }
  }
  return interp_ok(undefined);
};
