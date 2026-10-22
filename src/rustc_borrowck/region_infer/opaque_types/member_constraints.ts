// Port of compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `CollectMemberConstraintsVisitor` (generated class) implements rustc_type_ir's `TypeVisitor<undefined>`
// (`type Result = ()`) by prototype methods; its `Result` member and the provided `visit_*` methods are the fill
// lane's (precedent rustc_trait_selection error_reporting `ParamFinder`). `&'a mut FxHashMap<..>` is the shared map.
import type { ConstraintSccIndex } from "../../constraints/mod.gen.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../../std/panic.ts";
import { CollectMemberConstraintsVisitor } from "./member_constraints.gen.ts";
import type { DefiningUse } from "./mod.gen.ts";
import type { RegionCtxt } from "./region_ctxt.gen.ts";

export * from "./member_constraints.gen.ts";

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:14 apply_member_constraints (lane bck-regions-b)
export function apply_member_constraints(rcx: RegionCtxt, defining_uses: readonly DefiningUse[]): void {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::apply_member_constraints");
}

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:59 apply_member_constraint (lane bck-regions-b)
function apply_member_constraint(rcx: RegionCtxt, member: ConstraintSccIndex, arg_regions: readonly RegionVid[]): void {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::apply_member_constraint");
}
void apply_member_constraint;

declare module "./member_constraints.gen.ts" {
  interface CollectMemberConstraintsVisitor {
    // member_constraints.rs:147 (lane bck-regions-b)
    cx(): TyCtxt;
    // member_constraints.rs:150 (lane bck-regions-b)
    visit_closure_args(def_id: DefId, args: GenericArgsRef): void;
    // member_constraints.rs:158 (lane bck-regions-b): `impl TypeVisitor<TyCtxt> for CollectMemberConstraintsVisitor`
    visit_region(r: Region): undefined;
    // member_constraints.rs:169 (lane bck-regions-b)
    visit_ty(ty: Ty): undefined;
  }
}

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:147 cx (lane bck-regions-b)
CollectMemberConstraintsVisitor.prototype.cx = function (this: CollectMemberConstraintsVisitor): TyCtxt {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::CollectMemberConstraintsVisitor::cx");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:150 visit_closure_args (lane bck-regions-b)
CollectMemberConstraintsVisitor.prototype.visit_closure_args = function (
  this: CollectMemberConstraintsVisitor,
  def_id: DefId,
  args: GenericArgsRef,
): void {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::CollectMemberConstraintsVisitor::visit_closure_args");
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for CollectMemberConstraintsVisitor<'_, '_, 'tcx>
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:158 visit_region (lane bck-regions-b)
CollectMemberConstraintsVisitor.prototype.visit_region = function (this: CollectMemberConstraintsVisitor, r: Region): undefined {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::CollectMemberConstraintsVisitor::visit_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/member_constraints.rs:169 visit_ty (lane bck-regions-b)
CollectMemberConstraintsVisitor.prototype.visit_ty = function (this: CollectMemberConstraintsVisitor, ty: Ty): undefined {
  return unported("rustc_borrowck::region_infer::opaque_types::member_constraints::CollectMemberConstraintsVisitor::visit_ty");
};
