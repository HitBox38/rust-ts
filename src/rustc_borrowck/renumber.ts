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
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { Const as ty_Const } from "../rustc_type_ir/sty/consts.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { BorrowckInferCtxt } from "./lib.gen.ts";
import * as gen from "./renumber.gen.ts";

export * from "./renumber.gen.ts";

/// Replaces all free regions appearing in the MIR with fresh
/// inference variables, returning the number of variables created.
// stub: compiler/rustc_borrowck/src/renumber.rs:14 renumber_mir (lane bck-nll)
export function renumber_mir(infcx: BorrowckInferCtxt, body: Body, promoted: Body[]): void {
  return unported("rustc_borrowck::renumber::renumber_mir");
}

export interface RegionCtxt_methods {
  // renumber.rs:45 (lane bck-nll)
  preference_value(self: RegionCtxt): number;
}
export type RegionCtxt = gen.RegionCtxt;
export const RegionCtxt = gen.RegionCtxt as typeof gen.RegionCtxt & RegionCtxt_methods;

/// Used to determine the representative of a component in the strongly connected
/// constraint graph
// stub: compiler/rustc_borrowck/src/renumber.rs:45 preference_value (lane bck-nll)
RegionCtxt.preference_value = function (self: RegionCtxt): number {
  return unported("rustc_borrowck::renumber::RegionCtxt::preference_value");
};

// rustc-type: compiler/rustc_borrowck/src/renumber.rs:57 RegionRenumberer
export class RegionRenumberer extends MutVisitor {
  constructor(public infcx: BorrowckInferCtxt) {
    super();
  }

  /// Replaces all regions appearing in `value` with fresh inference
  /// variables.
  // stub: compiler/rustc_borrowck/src/renumber.rs:64 renumber_regions (lane bck-nll)
  renumber_regions<T>(value: T, region_ctxt_fn: () => RegionCtxt, d_T: TypeFoldable<T>): T {
    return unported("rustc_borrowck::renumber::RegionRenumberer::renumber_regions");
  }

  // impl MutVisitor for RegionRenumberer
  // stub: compiler/rustc_borrowck/src/renumber.rs:77 tcx (lane bck-nll)
  tcx(): TyCtxt {
    return unported("rustc_borrowck::renumber::RegionRenumberer::tcx");
  }

  // stub: compiler/rustc_borrowck/src/renumber.rs:82 visit_ty (lane bck-nll)
  override visit_ty(ty: MutRef<Ty>, ty_context: TyContext): void {
    return unported("rustc_borrowck::renumber::RegionRenumberer::visit_ty");
  }

  // stub: compiler/rustc_borrowck/src/renumber.rs:93 visit_args (lane bck-nll)
  override visit_args(args: MutRef<GenericArgsRef>, location: Location): void {
    return unported("rustc_borrowck::renumber::RegionRenumberer::visit_args");
  }

  // stub: compiler/rustc_borrowck/src/renumber.rs:100 visit_region (lane bck-nll)
  override visit_region(region: MutRef<Region>, location: Location): void {
    return unported("rustc_borrowck::renumber::RegionRenumberer::visit_region");
  }

  // stub: compiler/rustc_borrowck/src/renumber.rs:108 visit_ty_const (lane bck-nll)
  override visit_ty_const(ct: MutRef<ty_Const>, location: Location): void {
    return unported("rustc_borrowck::renumber::RegionRenumberer::visit_ty_const");
  }

  // stub: compiler/rustc_borrowck/src/renumber.rs:116 visit_const_operand (lane bck-nll)
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_borrowck::renumber::RegionRenumberer::visit_const_operand");
  }
}
