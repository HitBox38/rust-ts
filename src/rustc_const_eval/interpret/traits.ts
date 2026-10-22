// Port of compiler/rustc_const_eval/src/interpret/traits.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { type CtfeProvenance, type InterpResult, type Pointer } from "../../rustc_middle/mir/interpret/mod.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate, type PolyExistentialTraitRef } from "../../rustc_middle/ty/predicate.ts";
import { type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { unported } from "../../std/panic.ts";
import { MPlaceTy } from "./place.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // traits.rs:19 (lane interp-ops)
    get_vtable_ptr(ty: Ty, dyn_ty: List<PolyExistentialPredicate>): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // traits.rs:38 (lane interp-ops)
    get_vtable_size_and_align(vtable: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<[Size, Align]>;
    // traits.rs:49 (lane interp-ops)
    vtable_entries(trait_: PolyExistentialTraitRef | undefined, dyn_ty: Ty): readonly VtblEntry[];
    // traits.rs:67 (lane interp-ops)
    check_vtable_for_type(vtable_dyn_type: List<PolyExistentialPredicate>, expected_dyn_type: List<PolyExistentialPredicate>): InterpResult;
    // traits.rs:106 (lane interp-ops)
    unpack_dyn_trait(mplace: MPlaceTy, expected_trait: List<PolyExistentialPredicate>): InterpResult<MPlaceTy>;
  }
}

// stub: compiler/rustc_const_eval/src/interpret/traits.rs:19 get_vtable_ptr (lane interp-ops)
InterpCx.prototype.get_vtable_ptr = function (this: InterpCx, ty: Ty, dyn_ty: List<PolyExistentialPredicate>): InterpResult<Pointer<CtfeProvenance | undefined>> {
  return unported("rustc_const_eval::interpret::traits::InterpCx::get_vtable_ptr");
};

// stub: compiler/rustc_const_eval/src/interpret/traits.rs:38 get_vtable_size_and_align (lane interp-ops)
InterpCx.prototype.get_vtable_size_and_align = function (this: InterpCx, vtable: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<[Size, Align]> {
  return unported("rustc_const_eval::interpret::traits::InterpCx::get_vtable_size_and_align");
};

// stub: compiler/rustc_const_eval/src/interpret/traits.rs:49 vtable_entries (lane interp-ops)
InterpCx.prototype.vtable_entries = function (this: InterpCx, trait_: PolyExistentialTraitRef | undefined, dyn_ty: Ty): readonly VtblEntry[] {
  return unported("rustc_const_eval::interpret::traits::InterpCx::vtable_entries");
};

// stub: compiler/rustc_const_eval/src/interpret/traits.rs:67 check_vtable_for_type (lane interp-ops)
InterpCx.prototype.check_vtable_for_type = function (this: InterpCx, vtable_dyn_type: List<PolyExistentialPredicate>, expected_dyn_type: List<PolyExistentialPredicate>): InterpResult {
  return unported("rustc_const_eval::interpret::traits::InterpCx::check_vtable_for_type");
};

// stub: compiler/rustc_const_eval/src/interpret/traits.rs:106 unpack_dyn_trait (lane interp-ops)
InterpCx.prototype.unpack_dyn_trait = function (this: InterpCx, mplace: MPlaceTy, expected_trait: List<PolyExistentialPredicate>): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::traits::InterpCx::unpack_dyn_trait");
};
