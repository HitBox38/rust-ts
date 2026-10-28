// Port of compiler/rustc_mir_transform/src/post_analysis_normalize.rs (lane mt-cleanup).
//
// PORT: `PostAnalysisNormalizeVisitor` `extends MutVisitor` (mir/visit.ts, D4): `&mut Ty` / `&mut GenericArgsRef` are
// `MutRef`s, `&mut Place` / `&mut ConstOperand` the objects (edited in place).
//! Normalizes MIR in `TypingMode::PostAnalysis` mode, most notably revealing
//! its opaques. We also only normalize specializable associated items once in
//! `PostAnalysis` mode.
import { type Body, type ConstOperand, fold_Const, type Location, type Place } from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, type TyContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArgsRef } from "../rustc_middle/ty/generic_args.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { set_aliases_to_non_rigid } from "../rustc_type_ir/fold.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:11 PostAnalysisNormalize
export class PostAnalysisNormalize extends MirPass {
  readonly type_name = "rustc_mir_transform::post_analysis_normalize::PostAnalysisNormalize";

  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:14 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // FIXME(#132279): This is used during the phase transition from analysis
    // to runtime, so we have to manually specify the correct typing mode.
    const typing_env = TypingEnv.post_analysis(tcx, body.source.def_id());
    new PostAnalysisNormalizeVisitor(tcx, typing_env).visit_body_preserves_cfg(body);
  }

  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:21 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Reveals opaque types and normalizes MIR while transitioning to the runtime dialect.
    return PassPolicy.Required;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:27 PostAnalysisNormalizeVisitor
class PostAnalysisNormalizeVisitor extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public typing_env: TypingEnv,
  ) {
    super();
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:34 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:39 visit_place
  override visit_place(place: Place, _context: PlaceContext, _location: Location): void {
    if (!this.tcx_.next_trait_solver_globally()) {
      // `OpaqueCast` projections are only needed if there are opaque types on which projections
      // are performed. After the `PostAnalysisNormalize` pass, all opaque types are replaced with their
      // hidden types, so we don't need these projections anymore.
      //
      // Performance optimization: don't reintern if there is no `OpaqueCast` to remove.
      if (place.projection.some((elem) => elem.$ === "OpaqueCast")) {
        place.projection = this.tcx_.mk_place_elems(place.projection.filter((elem) => !(elem.$ === "OpaqueCast")));
      }
    }
    this.super_place(place, _context, _location);
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:65 visit_const_operand
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    // We have to use `try_normalize_erasing_regions` here, since it's
    // possible that we visit impossible-to-satisfy where clauses here,
    // see #91745
    const r = this.tcx_.try_normalize_erasing_regions(
      this.typing_env,
      set_aliases_to_non_rigid(this.tcx_, constant.const_, fold_Const),
      fold_Const,
    );
    if (r.$ === "Ok") {
      constant.const_ = r._0;
    }
    this.super_const_operand(constant, location);
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:79 visit_ty
  override visit_ty(ty: MutRef<Ty>, _: TyContext): void {
    // We have to use `try_normalize_erasing_regions` here, since it's
    // possible that we visit impossible-to-satisfy where clauses here,
    // see #91745
    const r = this.tcx_.try_normalize_erasing_regions(this.typing_env, set_aliases_to_non_rigid(this.tcx_, ty.value, fold_Ty), fold_Ty);
    if (r.$ === "Ok") {
      ty.value = r._0;
    }
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/post_analysis_normalize.rs:92 visit_args
  override visit_args(args: MutRef<GenericArgsRef>, _: Location): void {
    const r = this.tcx_.try_normalize_erasing_regions(
      this.typing_env,
      set_aliases_to_non_rigid(this.tcx_, args.value, fold_GenericArgs),
      fold_GenericArgs,
    );
    if (r.$ === "Ok") {
      args.value = r._0;
    }
  }
}
