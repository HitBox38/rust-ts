// Port of compiler/rustc_borrowck/src/renumber.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `RegionRenumberer` is a hand class extending mir/visit.ts's `MutVisitor` (plan-m4 D4: the `&mut` Copy leaves
// `Ty`, `GenericArgsRef`, `Region`, `ty::Const` are `MutRef<T>`). `T: TypeFoldable` adds the descriptor `d_T`
// (errctxt-contract signature rule).
import type { Body, ConstOperand, Location } from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type TyContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Region, Ty } from "../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../rustc_middle/ty/generic_args.ts";
import { fold_Const as fold_mir_Const } from "../rustc_middle/mir/consts.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { NllRegionVariableOrigin } from "../rustc_infer/infer/mod.ts";
import { fold_regions, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import { type Const as ty_Const, fold_Const as fold_ty_Const } from "../rustc_type_ir/sty/consts.ts";
import { fold_Region } from "../rustc_type_ir/sty/mod.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { BorrowckInferCtxt } from "./lib.gen.ts";
import * as gen from "./renumber.gen.ts";

export * from "./renumber.gen.ts";

/// Replaces all free regions appearing in the MIR with fresh
/// inference variables, returning the number of variables created.
// #[instrument(skip(infcx, body, promoted), level = "debug")]
// rustc: compiler/rustc_borrowck/src/renumber.rs:14 renumber_mir
export function renumber_mir(infcx: BorrowckInferCtxt, body: Body, promoted: Body[]): void {
  // debug!(?body.arg_count);

  const renumberer = new RegionRenumberer(infcx);

  for (const body of promoted) {
    renumberer.visit_body_preserves_cfg(body);
  }

  renumberer.visit_body_preserves_cfg(body);
}

export interface RegionCtxt_methods {
  // renumber.rs:45 (lane bck-nll)
  preference_value(self: RegionCtxt): number;
}
export type RegionCtxt = gen.RegionCtxt;
export const RegionCtxt = gen.RegionCtxt as typeof gen.RegionCtxt & RegionCtxt_methods;

/// Used to determine the representative of a component in the strongly connected
/// constraint graph
// rustc: compiler/rustc_borrowck/src/renumber.rs:45 preference_value
RegionCtxt.preference_value = function (self: RegionCtxt): number {
  switch (self.$) {
    case "Unknown":
      return 1;
    case "Existential":
      if (self._0 === undefined) return 2;
      return 2;
    case "Free":
      return 2;
    case "Location":
      return 3;
    case "TyContext":
      return 4;
    default:
      return 5;
  }
};

// rustc-type: compiler/rustc_borrowck/src/renumber.rs:57 RegionRenumberer
export class RegionRenumberer extends MutVisitor {
  constructor(public infcx: BorrowckInferCtxt) {
    super();
  }

  /// Replaces all regions appearing in `value` with fresh inference
  /// variables.
  // rustc: compiler/rustc_borrowck/src/renumber.rs:64 renumber_regions
  renumber_regions<T>(value: T, region_ctxt_fn: () => RegionCtxt, d_T: TypeFoldable<T>): T {
    const origin: NllRegionVariableOrigin = { $: "Existential", name: undefined };
    return fold_regions(
      this.infcx.tcx,
      value,
      (_region, _depth) => {
        return this.infcx.next_nll_region_var(origin, () => region_ctxt_fn());
      },
      d_T,
    );
  }

  // impl MutVisitor for RegionRenumberer
  // rustc: compiler/rustc_borrowck/src/renumber.rs:77 tcx
  tcx(): TyCtxt {
    return this.infcx.tcx;
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_borrowck/src/renumber.rs:82 visit_ty
  override visit_ty(ty: MutRef<Ty>, ty_context: TyContext): void {
    if (ty_context.$ === "ReturnTy") {
      // We will renumber the return ty when called again with `TyContext::LocalDecl`
      return;
    }
    ty.value = this.renumber_regions(ty.value, () => ({ $: "TyContext", _0: ty_context }), fold_Ty);

    // debug!(?ty);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_borrowck/src/renumber.rs:93 visit_args
  override visit_args(args: MutRef<GenericArgsRef>, location: Location): void {
    args.value = this.renumber_regions(args.value, () => ({ $: "Location", _0: location }), fold_GenericArgs);

    // debug!(?args);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_borrowck/src/renumber.rs:100 visit_region
  override visit_region(region: MutRef<Region>, location: Location): void {
    const old_region = region.value;
    region.value = this.renumber_regions(old_region, () => ({ $: "Location", _0: location }), fold_Region);

    // debug!(?region);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_borrowck/src/renumber.rs:108 visit_ty_const
  override visit_ty_const(ct: MutRef<ty_Const>, location: Location): void {
    const old_ct = ct.value;
    ct.value = this.renumber_regions(old_ct, () => ({ $: "Location", _0: location }), fold_ty_Const);

    // debug!(?ct);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_borrowck/src/renumber.rs:116 visit_const_operand
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    const const_ = constant.const_;
    constant.const_ = this.renumber_regions(const_, () => ({ $: "Location", _0: location }), fold_mir_Const);
    // debug!("constant: {:#?}", constant);
  }
}
