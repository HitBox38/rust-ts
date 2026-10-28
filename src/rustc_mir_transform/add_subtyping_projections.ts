// Port of compiler/rustc_mir_transform/src/add_subtyping_projections.rs (lane mt-cleanup).
//
// PORT: `SubTypeChecker` `extends MutVisitor` (mir/visit.ts, D4); `*rvalue = ..` replaces the visited `Rvalue` object
// in place (`replace_in_place`), after `rvalue.clone()` (`clone_Rvalue`) was queued by the patch.
import {
  type BasicBlock,
  type Body,
  CastKind,
  clone_Rvalue,
  type LocalDecl,
  type Location,
  type Place,
  Place_from_Local,
  Rvalue,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

// rustc-type: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:8 Subtyper
export class Subtyper extends MirPass {
  readonly type_name = "rustc_mir_transform::add_subtyping_projections::Subtyper";

  // Aim here is to do this kind of transformation:
  //
  // let place: place_ty = rval;
  // // gets transformed to
  // let temp: rval_ty = rval;
  // let place: place_ty = temp as place_ty;
  // rustc: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:59 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const patch = MirPatch.new(body);
    const checker = new SubTypeChecker(tcx, patch, body.local_decls);

    const blocks = body.basic_blocks.as_mut_preserves_cfg();
    for (let i = 0; i < blocks.length; i++) {
      checker.visit_basic_block_data(i as BasicBlock, blocks[i]!);
    }
    checker.patcher.apply(body);
  }

  // rustc: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:69 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Later MIR phases expect all subtyping to be explicit.
    return PassPolicy.Required;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:10 SubTypeChecker
class SubTypeChecker extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public patcher: MirPatch,
    public local_decls: LocalDecl[],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:17 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/add_subtyping_projections.rs:21 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    if (Rvalue.is_generic_reborrow(rvalue)) {
      return;
    }
    // We don't need to do anything for deref temps as they are
    // not part of the source code, but used for desugaring purposes.
    if (this.local_decls[place.local]!.is_deref_temp()) {
      return;
    }
    let place_ty = place.ty(this.local_decls, this.tcx_).ty;
    let rval_ty = Rvalue.ty(rvalue, this.local_decls, this.tcx_);
    // Not erasing this causes `Free Regions` errors in validator,
    // when rval is `ReStatic`.
    rval_ty = this.tcx_.erase_and_anonymize_regions(rval_ty, fold_Ty);
    place_ty = this.tcx_.erase_and_anonymize_regions(place_ty, fold_Ty);
    if (place_ty !== rval_ty) {
      const temp = this.patcher.new_temp(rval_ty, this.local_decls[place.as_ref().local]!.source_info.span);
      const new_place = Place_from_Local(temp);
      this.patcher.add_assign(location, new_place, clone_Rvalue(rvalue));
      replace_in_place<Rvalue>(rvalue, { $: "Cast", _0: CastKind.Subtype, _1: { $: "Move", _0: new_place }, _2: place_ty });
    }
  }
}
