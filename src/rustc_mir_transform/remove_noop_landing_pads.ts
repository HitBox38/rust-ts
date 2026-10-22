// Port of compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs (lane mt-cleanup).
//
// PORT: `RemoveNoopLandingPads.is_nop_landing_pad(..)` (a method of the unit struct, called on the value
// `RemoveNoopLandingPads`) is a method of the pass class, called on a fresh instance (the unit value).
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { BasicBlock, type BasicBlockData, type Body, UnwindAction, traversal } from "../rustc_middle/mir/mod.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PanicStrategy } from "../rustc_target/spec/mod.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

/// A pass that removes noop landing pads and replaces jumps to them with
/// `UnwindAction::Continue`. This is important because otherwise LLVM generates
/// terrible code for these.
// rustc-type: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:12 RemoveNoopLandingPads
export class RemoveNoopLandingPads extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_noop_landing_pads::RemoveNoopLandingPads";

  // rustc: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:15 policy
  policy(ctx: PassCtx): PassPolicy {
    // FIXME: Should this really run on opt-level 0? Or is the LLVM code so terrible we want this even with
    // "no" optimizations?
    return PassPolicy.optional(PanicStrategy.unwinds(ctx.deref().panic_strategy()));
  }

  // #[instrument(level = "debug", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:22 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const _def_id = body.source.def_id();
    // debug!(?def_id);

    // Skip the pass if there are no blocks with a resume terminator.
    const has_resume = body.basic_blocks.deref().some((block) => block.terminator_().kind.$ === "UnwindResume");
    if (!has_resume) {
      // debug!("no resume block in MIR");
      return;
    }

    const nop_landing_pads = find_noop_landing_pads(tcx, body, undefined);

    if (nop_landing_pads.is_empty()) {
      // debug!("no nop landing pads in MIR");
      return;
    }

    // make sure there's a resume block without any statements
    let resume_block: BasicBlock;
    {
      const patch = MirPatch.new(body);
      const resume_block_ = patch.resume_block_();
      patch.apply(body);
      resume_block = resume_block_;
    }
    // debug!(?resume_block);

    const basic_blocks = body.basic_blocks.as_mut();
    for (let i = 0; i < basic_blocks.length; i++) {
      const _bb = BasicBlock.from_usize(i);
      const bbdata = basic_blocks[i]!;
      // debug!("processing {:?}", bb);

      const unwind = bbdata.terminator_mut().unwind_mut();
      if (unwind !== undefined) {
        const u = unwind.value;
        if (u.$ === "Cleanup" && nop_landing_pads.contains(u._0)) {
          // debug!("    removing noop landing pad");
          unwind.value = UnwindAction.Continue;
        }
      }

      bbdata.terminator_mut().successors_mut((target) => {
        if (target.value !== resume_block && nop_landing_pads.contains(target.value)) {
          // debug!("    folding noop jump to {:?} to resume block", target);
          target.value = resume_block;
        }
      });
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:75 is_nop_landing_pad
  is_nop_landing_pad(
    tcx: TyCtxt,
    bbdata: BasicBlockData,
    body: Body,
    nop_landing_pads: DenseBitSet<BasicBlock>,
    // Extra post-monomorphization info that allows more cases to be identified.
    extra: [Instance, TypingEnv] | undefined,
  ): boolean {
    for (const stmt of bbdata.statements) {
      const kind = stmt.kind;
      switch (kind.$) {
        case "FakeRead":
        case "StorageLive":
        case "StorageDead":
        case "PlaceMention":
        case "AscribeUserType":
        case "Coverage":
        case "ConstEvalCounter":
        case "BackwardIncompatibleDropHint":
        case "Nop": {
          // These are all noops in a landing pad
          break;
        }

        case "Assign":
        case "SetDiscriminant":
        case "Intrinsic": {
          if (kind.$ === "Assign" && (kind._0[1].$ === "Use" || kind._0[1].$ === "Discriminant")) {
            const place = kind._0[0];
            if (place.as_local() !== undefined) {
              // Writing to a local (e.g., a drop flag) does not
              // turn a landing pad to a non-nop
            } else {
              return false;
            }
            break;
          }

          return false;
        }
      }
    }

    const terminator = bbdata.terminator_();
    const tk = terminator.kind;
    switch (tk.$) {
      case "Goto":
      case "UnwindResume":
      case "SwitchInt":
      case "FalseEdge":
      case "FalseUnwind": {
        for (const succ of terminator.successors()) {
          if (!nop_landing_pads.contains(succ)) return false;
        }
        return true;
      }
      case "Drop": {
        const place = tk.place;
        if (extra !== undefined) {
          const [instance, typing_env] = extra;
          let ty = place.ty(body, tcx).ty;
          // debug!("monomorphize: instance={instance:?}");
          ty = Instance.instantiate_mir_and_normalize_erasing_regions(
            instance,
            tcx,
            typing_env,
            EarlyBinder.bind(tcx, ty, fold_Ty),
            fold_Ty,
          );
          const drop_fn = Instance.resolve_drop_glue(tcx, ty);
          if (drop_fn.def.$ === "Shim" && drop_fn.def._0.$ === "DropGlue" && drop_fn.def._0._1 === undefined) {
            // no need to drop anything, if all of our successors are also no-op then we
            // can be skipped.
            for (const succ of terminator.successors()) {
              if (!nop_landing_pads.contains(succ)) return false;
            }
            return true;
          }
        }

        return false;
      }
      case "CoroutineDrop":
      case "Yield":
      case "Return":
      case "UnwindTerminate":
      case "Unreachable":
      case "Call":
      case "TailCall":
      case "Assert":
      case "InlineAsm":
        return false;
    }
  }
}

/// Hook impl for [`TyCtxt::find_noop_landing_pads_for_instance`].
// rustc: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:157 find_noop_landing_pads_for_instance
export function find_noop_landing_pads_for_instance(tcx: TyCtxt, body: Body, instance: Instance, typing_env: TypingEnv): DenseBitSet<BasicBlock> {
  return find_noop_landing_pads(tcx, body, [instance, typing_env]);
}

// rustc: compiler/rustc_mir_transform/src/remove_noop_landing_pads.rs:166 find_noop_landing_pads
function find_noop_landing_pads(tcx: TyCtxt, body: Body, extra: [Instance, TypingEnv] | undefined): DenseBitSet<BasicBlock> {
  const nop_landing_pads = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);

  // This is a post-order traversal, so that if A post-dominates B
  // then A will be visited before B.
  const postorder: BasicBlock[] = traversal.postorder(body).map(([bb, _]) => bb);
  for (const bb of postorder) {
    const is_nop_landing_pad = new RemoveNoopLandingPads().is_nop_landing_pad(
      tcx,
      body.basic_blocks.deref()[bb]!,
      body,
      nop_landing_pads,
      extra,
    );
    if (is_nop_landing_pad) {
      nop_landing_pads.insert(bb);
    }
    // debug!("    is_nop_landing_pad({:?}) = {}", bb, is_nop_landing_pad);
  }

  return nop_landing_pads;
}
