// Port of compiler/rustc_mir_transform/src/erase_deref_temps.rs (lane mt-cleanup).
//
// PORT: `*rvalue = ..` replaces the visited `Rvalue` object in place (`replace_in_place`). `**info = LocalInfo::Boring`
// (the `Box<LocalInfo>` behind `ClearCrossCrate::Set`) stores a fresh `Set(Boring)` in the decl's `local_info` slot,
// after `unwrap_crate_local` (which still ICEs on `Clear`, as upstream).
//! This pass converts all `DerefTemp` locals into normal temporaries
//! and turns their `CopyForDeref` rvalues into normal copies.
import { type Body, ClearCrossCrate, type Local, type LocalDecl, LocalInfo, type Location, type Rvalue } from "../rustc_middle/mir/mod.ts";
import { MutVisitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/erase_deref_temps.rs:10 EraseDerefTempsVisitor
class EraseDerefTempsVisitor extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/erase_deref_temps.rs:15 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/erase_deref_temps.rs:19 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, _: Location): void {
    if (rvalue.$ === "CopyForDeref") {
      const place = rvalue._0;
      // We do *NOT* want a retag here! This assignment might copy a mutable reference we
      // can't actually copy, we just need it temporarily to create another pointer.
      replace_in_place<Rvalue>(rvalue, { $: "Use", _0: { $: "Copy", _0: place }, _1: "No" });
    }
  }

  // rustc: compiler/rustc_mir_transform/src/erase_deref_temps.rs:27 visit_local_decl
  override visit_local_decl(_: Local, local_decl: LocalDecl): void {
    if (local_decl.is_deref_temp()) {
      const _info = ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_mut(local_decl.local_info));
      local_decl.local_info = { $: "Set", _0: LocalInfo.Boring };
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/erase_deref_temps.rs:35 EraseDerefTemps
export class EraseDerefTemps extends MirPass {
  readonly type_name = "rustc_mir_transform::erase_deref_temps::EraseDerefTemps";

  // rustc: compiler/rustc_mir_transform/src/erase_deref_temps.rs:38 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    new EraseDerefTempsVisitor(tcx).visit_body_preserves_cfg(body);
  }

  // rustc: compiler/rustc_mir_transform/src/erase_deref_temps.rs:42 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Later MIR stages assume that CopyForDeref is gone.
    return PassPolicy.Required;
  }
}
