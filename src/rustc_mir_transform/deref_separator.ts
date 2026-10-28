// Port of compiler/rustc_mir_transform/src/deref_separator.rs (lane mt-cleanup).
//
// PORT: `DerefChecker` `extends MutVisitor` (mir/visit.ts, D4); `*place = temp_place` replaces the visited `Place`
// object's fields in place (`replace_in_place`). `local_decls: &'a LocalDecls` is the body's `local_decls` array.
import {
  type BasicBlock,
  type Body,
  type LocalDecl,
  LocalInfo,
  type Location,
  type Place,
  Place_from_Local,
  type Rvalue,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

// rustc-type: compiler/rustc_mir_transform/src/deref_separator.rs:9 Derefer
export class Derefer extends MirPass {
  readonly type_name = "rustc_mir_transform::deref_separator::Derefer";

  // rustc: compiler/rustc_mir_transform/src/deref_separator.rs:101 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    deref_finder(tcx, body, true);
  }

  // rustc: compiler/rustc_mir_transform/src/deref_separator.rs:105 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Later MIR stages expect derefs to only appear as the first place projection.
    return PassPolicy.Required;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/deref_separator.rs:11 DerefChecker
class DerefChecker extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public patcher: MirPatch,
    public local_decls: readonly LocalDecl[],
    public add_deref_metadata: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/deref_separator.rs:19 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/deref_separator.rs:23 visit_place
  override visit_place(place: Place, cntxt: PlaceContext, loc: Location): void {
    if (
      place.projection.length !== 0 &&
      !(cntxt.$ === "NonUse" && cntxt._0.$ === "VarDebugInfo") &&
      place.projection.slice(1).some((e) => e.$ === "Deref")
    ) {
      let place_local = place.local;
      let last_len = 0;
      let last_deref_idx = 0;

      for (let idx = 0; idx < place.projection.length; idx++) {
        const elem = place.projection[idx]!;
        if (elem.$ === "Deref") {
          last_deref_idx = idx;
        }
      }

      const iter = place.iter_projections();
      for (let idx = 0; idx < iter.length; idx++) {
        const [p_ref, p_elem] = iter[idx]!;
        if (p_ref.projection.length !== 0 && p_elem.$ === "Deref") {
          const ty = p_ref.ty(this.local_decls as LocalDecl[], this.tcx_).ty;
          const temp = this.patcher.new_local_with_info(
            ty,
            this.local_decls[p_ref.local]!.source_info.span,
            this.add_deref_metadata ? LocalInfo.DerefTemp : LocalInfo.Boring,
          );

          // We are adding current p_ref's projections to our
          // temp value, excluding projections we already covered.
          const deref_place = Place_from_Local(place_local).project_deeper(p_ref.projection.slice(last_len), this.tcx_);

          const rv: Rvalue = this.add_deref_metadata
            ? { $: "CopyForDeref", _0: deref_place }
            : // FIXME: Unfortunately, `add_deref_metadata` is not documented. So who
              // knows what is supposed to happen here -- retag or not? `CopyForDeref`
              // later turns into a no-retag assignment so probably maybe that's also
              // what we need here.
              { $: "Use", _0: { $: "Copy", _0: deref_place }, _1: "No" };
          this.patcher.add_assign(loc, Place_from_Local(temp), rv);
          place_local = temp;
          last_len = p_ref.projection.length;

          // Change `Place` only if we are actually at the Place's last deref
          if (idx === last_deref_idx) {
            const temp_place = Place_from_Local(temp).project_deeper(place.projection.slice(idx), this.tcx_);
            replace_in_place(place, temp_place);
          }
        }
      }
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/deref_separator.rs:84 deref_finder
export function deref_finder(tcx: TyCtxt, body: Body, add_deref_metadata: boolean): void {
  const patch = MirPatch.new(body);
  const checker = new DerefChecker(tcx, patch, body.local_decls, add_deref_metadata);

  const blocks = body.basic_blocks.as_mut_preserves_cfg();
  for (let i = 0; i < blocks.length; i++) {
    checker.visit_basic_block_data(i as BasicBlock, blocks[i]!);
  }

  checker.patcher.apply(body);
}
