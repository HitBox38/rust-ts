// Port of compiler/rustc_mir_transform/src/unreachable_enum_branching.rs (lane mt-opt1).
//
// PORT: `FxHashSet<u128>` is a `Set<bigint>`; its iteration order (`allowed_variants.iter().next()`, only read when the
// set has exactly one element) is insertion order.
//! A pass that eliminates branches on uninhabited or unreachable enum variants.
import type { VariantIdx } from "../rustc_abi/lib.ts";
import {
  type BasicBlock,
  type BasicBlockData,
  type Body,
  clone_Operand,
  clone_SwitchTargets,
  type Local,
  type TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

// rustc: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:18 get_discriminant_local
function get_discriminant_local(terminator: TerminatorKind): Local | undefined {
  if (terminator.$ === "SwitchInt" && terminator.discr.$ === "Move") {
    return terminator.discr._0.as_local();
  } else {
    return undefined;
  }
}

/// If the basic block terminates by switching on a discriminant, this returns the `Ty` the
/// discriminant is read from. Otherwise, returns None.
// rustc: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:28 get_switched_on_type
function get_switched_on_type(block_data: BasicBlockData, tcx: TyCtxt, body: Body): Ty | undefined {
  const terminator = block_data.terminator_();

  // Only bother checking blocks which terminate by switching on a local.
  const local = get_discriminant_local(terminator.kind);
  if (local === undefined) return undefined;

  const stmt_before_term = block_data.statements.at(-1);
  if (stmt_before_term === undefined) return undefined;

  const sk = stmt_before_term.kind;
  if (sk.$ === "Assign" && sk._0[1].$ === "Discriminant" && sk._0[0].as_local() === local) {
    const place = sk._0[1]._0;
    const ty = place.ty(body, tcx).ty;
    if (ty.is_enum()) {
      return ty;
    }
  }

  return undefined;
}

// rustc: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:52 variant_discriminants
function variant_discriminants(layout: TyAndLayout, ty: Ty, tcx: TyCtxt): Set<bigint> {
  const variants = layout.variants;
  switch (variants.$) {
    case "Empty": {
      // Uninhabited, no valid discriminant.
      return new Set();
    }
    case "Single": {
      const index = variants.index;
      const res = new Set<bigint>();
      const discr = ty.discriminant_for_variant(tcx, index);
      res.add(discr === undefined ? BigInt(index) : discr.val);
      return res;
    }
    case "Multiple": {
      const res = new Set<bigint>();
      variants.variants.forEach((layout, idx) => {
        if (!layout.is_uninhabited()) {
          res.add(unwrap(ty.discriminant_for_variant(tcx, idx as VariantIdx)).val);
        }
      });
      return res;
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:16 UnreachableEnumBranching
export class UnreachableEnumBranching extends MirPass {
  readonly type_name = "rustc_mir_transform::unreachable_enum_branching::UnreachableEnumBranching";

  // rustc: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:81 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/unreachable_enum_branching.rs:85 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("UnreachableEnumBranching starting for {:?}", body.source);

    const unreachable_targets: number[] = [];
    const patch = MirPatch.new(body);

    const blocks = body.basic_blocks.deref();
    for (let bb_ = 0; bb_ < blocks.length; bb_++) {
      const bb = bb_ as BasicBlock;
      const bb_data = blocks[bb]!;
      // trace!("processing block {:?}", bb);

      if (bb_data.is_cleanup) {
        continue;
      }

      const discriminant_ty = get_switched_on_type(bb_data, tcx, body);
      if (discriminant_ty === undefined) continue;

      const layout = tcx.layout_of(body.typing_env(tcx).as_query_input(discriminant_ty));

      let allowed_variants: Set<bigint>;
      let variant_range;
      if (layout.$ === "Ok") {
        // Find allowed variants based on uninhabited.
        allowed_variants = variant_discriminants(layout._0, discriminant_ty, tcx);
      } else if ((variant_range = discriminant_ty.variant_range(tcx)) !== undefined) {
        // If there are some generics, we can still get the allowed variants.
        allowed_variants = new Set();
        for (let variant = variant_range.start; variant < variant_range.end; variant = (variant + 1) as VariantIdx) {
          allowed_variants.add(unwrap(discriminant_ty.discriminant_for_variant(tcx, variant)).val);
        }
      } else {
        continue;
      }

      // trace!("allowed_variants = {:?}", allowed_variants);

      unreachable_targets.length = 0;
      const kind = bb_data.terminator_().kind;
      if (kind.$ !== "SwitchInt") {
        return bug();
      }
      const targets_ = kind.targets;
      const discr = kind.discr;

      let index = 0;
      for (const [val, _] of targets_.iter()) {
        if (!allowed_variants.delete(val)) {
          unreachable_targets.push(index);
        }
        index++;
      }

      // If and only if there is a variant that does not have a branch set, change the
      // current of otherwise as the variant branch and set otherwise to unreachable. It
      // transforms the following code
      // ```rust
      // match c {
      //     Ordering::Less => 1,
      //     Ordering::Equal => 2,
      //     _ => 3,
      // }
      // ```
      // to
      // ```rust
      // match c {
      //     Ordering::Less => 1,
      //     Ordering::Equal => 2,
      //     Ordering::Greater => 3,
      // }
      // ```
      const replace_otherwise_to_unreachable =
        allowed_variants.size <= 1 && !body.basic_blocks.deref()[targets_.otherwise()]!.is_empty_unreachable();
      if (unreachable_targets.length === 0 && !replace_otherwise_to_unreachable) {
        continue;
      }

      const unreachable_block = patch.unreachable_no_cleanup_block_();
      const targets = clone_SwitchTargets(targets_);
      if (replace_otherwise_to_unreachable) {
        const otherwise_is_last_variant = allowed_variants.size === 1;
        if (otherwise_is_last_variant) {
          // We have checked that `allowed_variants` has only one element.
          // #[allow(rustc::potential_query_instability)]
          const last_variant = unwrap(allowed_variants.values().next().value);
          targets.add_target(last_variant, targets.otherwise());
        }
        unreachable_targets.push([...targets.iter()].length);
      }
      for (const index of unreachable_targets) {
        targets.all_targets_mut()[index] = unreachable_block;
      }
      const new_kind: TerminatorKind = { $: "SwitchInt", targets, discr: clone_Operand(discr) };
      patch.patch_terminator(bb, new_kind);
    }

    patch.apply(body);
  }
}
