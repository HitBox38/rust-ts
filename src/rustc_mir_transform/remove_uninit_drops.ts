// Port of compiler/rustc_mir_transform/src/remove_uninit_drops.rs (lane mt-cleanup).
//
// PORT: the closure `field_needs_drop_and_init` takes its `(f, f_ty, mpi)` tuple as three parameters; `.any(..)` over
// the mapped iterators is `Array.prototype.some` in the same order.
import { FieldIdx, type VariantIdx } from "../rustc_abi/layout.ts";
import type { MixedBitSet } from "../rustc_index/bit_set.ts";
import { MixedBitSet as MixedBitSetC } from "../rustc_index/bit_set.ts";
import { type BasicBlock, BasicBlock as BasicBlockC, type Body, ProjectionElem, TerminatorKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArgsRef } from "../rustc_middle/ty/generic_args.ts";
import type { Ty, TypingEnv, VariantDef } from "../rustc_middle/ty/mod.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import type { MaybeReachable } from "../rustc_mir_dataflow/framework/lattice.ts";
import { MaybeInitializedPlaces } from "../rustc_mir_dataflow/impls/initialized.ts";
import { MoveData, type MovePathIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { move_path_children_matching } from "../rustc_mir_dataflow/drop_flag_effects.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unreachable } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/// Removes `Drop` terminators whose target is known to be uninitialized at
/// that point.
///
/// This is redundant with drop elaboration, but we need to do it prior to const-checking, and
/// running const-checking after drop elaboration makes it optimization dependent, causing issues
/// like [#90770].
///
/// [#90770]: https://github.com/rust-lang/rust/issues/90770
// rustc-type: compiler/rustc_mir_transform/src/remove_uninit_drops.rs:19 RemoveUninitDrops
export class RemoveUninitDrops extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_uninit_drops::RemoveUninitDrops";

  // rustc: compiler/rustc_mir_transform/src/remove_uninit_drops.rs:22 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const typing_env = body.typing_env(tcx);
    const move_data = MoveData.gather_moves(body, tcx, (ty) => ty.needs_drop(tcx, typing_env));

    const maybe_inits = MaybeInitializedPlaces.new(tcx, body, move_data)
      .exclude_inactive_in_otherwise()
      .iterate_to_fixpoint(tcx, body, "remove_uninit_drops")
      .into_results_cursor(body) as ResultsCursor<MaybeReachable<MixedBitSet<MovePathIndex>>, MaybeInitializedPlaces>;

    const to_remove: BasicBlock[] = [];
    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlockC.new(i);
      const block = blocks[i]!;
      const terminator = block.terminator_();
      const kind = terminator.kind;
      if (kind.$ !== "Drop") continue;
      const place = kind.place;

      maybe_inits.seek_before_primary_effect(body.terminator_loc(bb));
      const mi = maybe_inits.get();
      if (mi.$ !== "Reachable") continue;
      const maybe_inits_ = mi._0;

      // If there's no move path for the dropped place, it's probably a `Deref`. Let it alone.
      const lr = move_data.rev_lookup.find(place.as_ref());
      if (lr.$ !== "Exact") {
        continue;
      }
      const mpi = lr._0;

      const should_keep = is_needs_drop_and_init(tcx, typing_env, maybe_inits_, move_data, place.ty(body, tcx).ty, mpi);
      if (!should_keep) {
        to_remove.push(bb);
      }
    }

    for (const bb of to_remove) {
      const block = body.basic_blocks_mut()[bb]!;

      const k = block.terminator_().kind;
      if (k.$ !== "Drop") {
        return unreachable();
      }
      const target = k.target;

      // Replace block terminator with `Goto`.
      block.terminator_mut().kind = TerminatorKind.goto(target);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_uninit_drops.rs:69 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Const checking relies on uninitialized drops being removed before drop elaboration.
    return PassPolicy.Required;
  }
}

// rustc: compiler/rustc_mir_transform/src/remove_uninit_drops.rs:75 is_needs_drop_and_init
function is_needs_drop_and_init(
  tcx: TyCtxt,
  typing_env: TypingEnv,
  maybe_inits: MixedBitSet<MovePathIndex>,
  move_data: MoveData,
  ty: Ty,
  mpi: MovePathIndex,
): boolean {
  // No need to look deeper if the root is definitely uninit or if it has no `Drop` impl.
  if (!MixedBitSetC.contains(maybe_inits, mpi) || !ty.needs_drop(tcx, typing_env)) {
    return false;
  }

  const field_needs_drop_and_init = (f: FieldIdx, f_ty: Ty, mpi: MovePathIndex): boolean => {
    const child = move_path_children_matching(move_data, mpi, (x) => ProjectionElem.is_field_to(x, f));
    if (child === undefined) {
      return f_ty.needs_drop(tcx, typing_env);
    }
    const mpi_ = child;

    return is_needs_drop_and_init(tcx, typing_env, maybe_inits, move_data, f_ty, mpi_);
  };

  // This pass is only needed for const-checking, so it doesn't handle as many cases as
  // `DropCtxt::open_drop`, since they aren't relevant in a const-context.
  const kind = ty.kind();
  switch (kind.$) {
    case "Adt": {
      const adt = kind._0;
      const args = kind._1;
      const dont_elaborate = adt.is_union() || adt.is_manually_drop() || adt.has_dtor(tcx);
      if (dont_elaborate) {
        return true;
      }

      // Look at all our fields, or if we are an enum all our variants and their fields.
      //
      // If a field's projection *is not* present in `MoveData`, it has the same
      // initializedness as its parent (maybe init).
      //
      // If its projection *is* present in `MoveData`, then the field may have been moved
      // from separate from its parent. Recurse.
      return adt.variants().some((variant, i) => {
        const vid = i as VariantIdx;
        // Enums have multiple variants, which are discriminated with a `Downcast`
        // projection. Structs have a single variant, and don't use a `Downcast`
        // projection.
        let mpi_: MovePathIndex;
        if (adt.is_enum()) {
          const downcast = move_path_children_matching(move_data, mpi, (x) => ProjectionElem.is_downcast_to(x, vid));
          if (downcast === undefined) {
            return variant_needs_drop(tcx, typing_env, args, variant);
          }
          const dc_mpi = downcast;

          mpi_ = dc_mpi;
        } else {
          mpi_ = mpi;
        }

        return variant.fields.some((field, f) =>
          field_needs_drop_and_init(FieldIdx.from_usize(f), Unnormalized.skip_norm_wip(field.ty(tcx, args)), mpi_),
        );
      });
    }

    case "Tuple": {
      const fields = kind._0;
      return fields.some((f_ty, f) => field_needs_drop_and_init(FieldIdx.from_usize(f), f_ty, mpi));
    }

    default:
      return true;
  }
}

// rustc: compiler/rustc_mir_transform/src/remove_uninit_drops.rs:150 variant_needs_drop
function variant_needs_drop(tcx: TyCtxt, typing_env: TypingEnv, args: GenericArgsRef, variant: VariantDef): boolean {
  return variant.fields.some((field) => {
    const f_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
    return f_ty.needs_drop(tcx, typing_env);
  });
}
