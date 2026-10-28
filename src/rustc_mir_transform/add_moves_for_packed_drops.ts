// Port of compiler/rustc_mir_transform/src/add_moves_for_packed_drops.rs (lane mt-cleanup).
//
// PORT: `crate::util` is rustc_const_eval's util (`place_unalignment`: util/alignment.ts). Copies of the `Copy` MIR
// objects `SourceInfo` / `Place` are `clone_*` (PORTING §8).
import { place_unalignment } from "../rustc_const_eval/util/alignment.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  clone_Place,
  clone_SourceInfo,
  clone_UnwindAction,
  Location,
  Place_from_Local,
  Statement,
  type Terminator,
  Terminator as TerminatorC,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { unreachable } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

/// This pass moves values being dropped that are within a packed
/// struct to a separate local before dropping them, to ensure that
/// they are dropped from an aligned address.
///
/// For example, if we have something like
///
/// ```ignore (illustrative)
/// #[repr(packed)]
/// struct Foo {
///     dealign: u8,
///     data: Vec<u8>
/// }
///
/// let foo = ...;
/// ```
///
/// We want to call `drop_glue::<Vec<u8>>` with a reference to `data`, which must be aligned.
/// This means we can't simply drop `foo.data` directly, because its address is not aligned.
///
/// Instead, we move `foo.data` to a local and drop that:
/// ```ignore (illustrative)
///     storage.live(drop_temp)
///     drop_temp = foo.data;
///     drop(drop_temp) -> next
/// next:
///     storage.dead(drop_temp)
/// ```
///
/// The storage instructions are required to avoid stack space
/// blowup.
// rustc-type: compiler/rustc_mir_transform/src/add_moves_for_packed_drops.rs:38 AddMovesForPackedDrops
export class AddMovesForPackedDrops extends MirPass {
  readonly type_name = "rustc_mir_transform::add_moves_for_packed_drops::AddMovesForPackedDrops";

  // rustc: compiler/rustc_mir_transform/src/add_moves_for_packed_drops.rs:41 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!("add_moves_for_packed_drops({:?} @ {:?})", body.source, body.span);
    const patch = MirPatch.new(body);
    // FIXME(#132279): This is used during the phase transition from analysis
    // to runtime, so we have to manually specify the correct typing mode.
    const typing_env = TypingEnv.post_analysis(tcx, body.source.def_id());

    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const data = blocks[i]!;
      const loc = new Location(bb, data.statements.length);
      const terminator = data.terminator_();

      const kind = terminator.kind;
      if (kind.$ === "Drop" && place_unalignment(tcx, body, typing_env, kind.place) !== undefined) {
        add_move_for_packed_drop(tcx, body, patch, terminator, loc, data.is_cleanup);
      }
    }

    patch.apply(body);
  }

  // rustc: compiler/rustc_mir_transform/src/add_moves_for_packed_drops.rs:72 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements part of MIR semantics by making implicit packed-drop handling explicit.
    return PassPolicy.Required;
  }
}

// rustc: compiler/rustc_mir_transform/src/add_moves_for_packed_drops.rs:78 add_move_for_packed_drop
function add_move_for_packed_drop(tcx: TyCtxt, body: Body, patch: MirPatch, terminator: Terminator, loc: Location, is_cleanup: boolean): void {
  // debug!("add_move_for_packed_drop({:?} @ {:?})", terminator, loc);
  const k = terminator.kind;
  if (k.$ !== "Drop") {
    return unreachable();
  }
  const place = k.place;
  const target = k.target;
  const unwind = k.unwind;
  const replace = k.replace;
  const drop = k.drop;

  const source_info = terminator.source_info;
  const ty = place.ty(body, tcx).ty;
  const temp = patch.new_temp(ty, source_info.span);

  const storage_dead_block = patch.new_block(
    BasicBlockData.new_stmts(
      [Statement.new(clone_SourceInfo(source_info), { $: "StorageDead", _0: temp })],
      new TerminatorC(clone_SourceInfo(source_info), TerminatorKind.goto(target)),
      is_cleanup,
    ),
  );

  patch.add_statement(loc, { $: "StorageLive", _0: temp });
  patch.add_assign(loc, Place_from_Local(temp), { $: "Use", _0: { $: "Move", _0: clone_Place(place) }, _1: "Yes" });
  patch.patch_terminator(loc.block, {
    $: "Drop",
    place: Place_from_Local(temp),
    target: storage_dead_block,
    unwind: clone_UnwindAction(unwind),
    replace,
    drop,
  });
}
