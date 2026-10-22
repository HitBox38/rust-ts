// Port of compiler/rustc_const_eval/src/const_eval/dyn_trait.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-b; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type CompileTimeInterpCx } from "./machine.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { type Machine } from "../interpret/machine.ts";
import { type Writeable } from "../interpret/place.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type ExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type Region } from "../../rustc_middle/ty/region.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { type Binder } from "../../rustc_type_ir/binder.ts";
import { unported } from "../../std/panic.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

declare module "../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // dyn_trait.rs:10 (lane ctfe-b)
    write_dyn_trait_type_info(dyn_place: Writeable, data: List<Binder<ExistentialPredicate>>, region: Region): InterpResult;
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

// stub: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:10 write_dyn_trait_type_info (lane ctfe-b)
InterpCx.prototype.write_dyn_trait_type_info = function (this: CompileTimeInterpCx, dyn_place: Writeable, data: List<Binder<ExistentialPredicate>>, region: Region): InterpResult {
  return unported("rustc_const_eval::const_eval::dyn_trait::InterpCx::write_dyn_trait_type_info");
};

// stub: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:64 mk_dyn_principal_auto_trait_ty (lane ctfe-b)
InterpCx.prototype.mk_dyn_principal_auto_trait_ty = function (this: CompileTimeInterpCx, auto_trait_def_id: Binder<DefId>, region: Region): Ty {
  return unported("rustc_const_eval::const_eval::dyn_trait::InterpCx::mk_dyn_principal_auto_trait_ty");
};

// stub: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:79 write_dyn_trait_predicates_slice (lane ctfe-b)
InterpCx.prototype.write_dyn_trait_predicates_slice = function (this: CompileTimeInterpCx, slice_place: Writeable, principal_ty: Ty | undefined, auto_trait_def_ids: readonly Binder<DefId>[], region: Region): InterpResult {
  return unported("rustc_const_eval::const_eval::dyn_trait::InterpCx::write_dyn_trait_predicates_slice");
};

// stub: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:121 write_dyn_trait_predicate (lane ctfe-b)
InterpCx.prototype.write_dyn_trait_predicate = function (this: CompileTimeInterpCx, predicate_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult {
  return unported("rustc_const_eval::const_eval::dyn_trait::InterpCx::write_dyn_trait_predicate");
};

// stub: compiler/rustc_const_eval/src/const_eval/dyn_trait.rs:153 write_trait (lane ctfe-b)
InterpCx.prototype.write_trait = function (this: CompileTimeInterpCx, trait_place: MPlaceTy, trait_ty: Ty, is_auto: boolean): InterpResult {
  return unported("rustc_const_eval::const_eval::dyn_trait::InterpCx::write_trait");
};
