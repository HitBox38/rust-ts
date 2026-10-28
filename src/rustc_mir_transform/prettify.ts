// Port of compiler/rustc_mir_transform/src/prettify.rs (lane mt-opt1).
//
// PORT: `permute`'s `*data = ..` refills the same array (`body.basic_blocks.as_mut()` / `body.local_decls` are the
// body's own arrays). `sort_by_key` is stable, as JS's `Array.prototype.sort`.
//! These two passes provide no value to the compiler, so are off at every level.
//!
//! However, they can be enabled on the command line
//! (`-Zmir-enable-passes=+ReorderBasicBlocks,+ReorderLocals`)
//! to make the MIR easier to read for humans.
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { invert_bijective_mapping } from "../rustc_index/slice.ts";
import { type BasicBlock, type Body, type Local, type Location, type Terminator } from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/// Rearranges the basic blocks into a *reverse post-order*.
///
/// Thus after this pass, all the successors of a block are later than it in the
/// `IndexVec`, unless that successor is a back-edge (such as from a loop).
// rustc-type: compiler/rustc_mir_transform/src/prettify.rs:19 ReorderBasicBlocks
export class ReorderBasicBlocks extends MirPass {
  readonly type_name = "rustc_mir_transform::prettify::ReorderBasicBlocks";

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:22 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(false);
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:26 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const rpo: BasicBlock[] = [...body.basic_blocks.reverse_postorder()];
    if (is_sorted(rpo)) {
      return;
    }

    const updater = new BasicBlockUpdater(invert_bijective_mapping<BasicBlock, BasicBlock>(rpo), tcx);
    // debug_assert_eq!(updater.map[START_BLOCK], START_BLOCK);
    updater.visit_body(body);

    permute(body.basic_blocks.as_mut(), updater.map);
  }
}

/// Rearranges the locals into *use* order.
///
/// Thus after this pass, a local with a smaller [`Location`] where it was first
/// assigned or referenced will have a smaller number.
///
/// (Does not reorder arguments nor the [`RETURN_PLACE`].)
// rustc-type: compiler/rustc_mir_transform/src/prettify.rs:47 ReorderLocals
export class ReorderLocals extends MirPass {
  readonly type_name = "rustc_mir_transform::prettify::ReorderLocals";

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:50 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(false);
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:54 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const finder = new LocalFinder([], DenseBitSet.new_empty<Local>(body.local_decls.length));

    // We can't reorder the return place or the arguments
    for (let local = 0; local <= body.arg_count; local++) {
      finder.track(local as Local);
    }

    const blocks = body.basic_blocks.deref();
    for (let bb = 0; bb < blocks.length; bb++) {
      finder.visit_basic_block_data(bb as BasicBlock, blocks[bb]!);
    }

    // Track everything in case there are some locals that we never saw,
    // such as in non-block things like debug info or in non-uses.
    for (let local = 0; local < body.local_decls.length; local++) {
      finder.track(local as Local);
    }

    if (is_sorted(finder.map)) {
      return;
    }

    const updater = new LocalUpdater(invert_bijective_mapping<Local, Local>(finder.map), tcx);

    // for local in (0..=body.arg_count).map(Local::from_usize) {
    //     debug_assert_eq!(updater.map[local], local);
    // }

    updater.visit_body_preserves_cfg(body);

    permute(body.local_decls, updater.map);
  }
}

/** `Iterator::is_sorted` over indices. */
function is_sorted(v: readonly number[]): boolean {
  for (let i = 1; i < v.length; i++) if (v[i - 1]! > v[i]!) return false;
  return true;
}

// rustc: compiler/rustc_mir_transform/src/prettify.rs:91 permute
function permute<I extends number, T>(data: T[], map: readonly I[]): void {
  // FIXME: It would be nice to have a less-awkward way to apply permutations,
  // but I don't know one that exists. `sort_by_cached_key` has logic for it
  // internally, but not in a way that we're allowed to use here.
  const enumerated: [I, T][] = data.map((t, i) => [i as I, t]);
  data.length = 0;
  enumerated.sort((a, b) => map[a[0]]! - map[b[0]]!);
  for (const p of enumerated) data.push(p[1]);
}

// rustc-type: compiler/rustc_mir_transform/src/prettify.rs:100 BasicBlockUpdater
class BasicBlockUpdater extends MutVisitor {
  constructor(
    public map: BasicBlock[],
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:106 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:110 visit_terminator
  override visit_terminator(terminator: Terminator, _location: Location): void {
    terminator.successors_mut((succ) => {
      succ.value = this.map[succ.value]!;
    });
  }
}

// rustc-type: compiler/rustc_mir_transform/src/prettify.rs:115 LocalFinder
class LocalFinder extends Visitor {
  constructor(
    public map: Local[],
    public seen: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:121 track
  track(l: Local): void {
    if (this.seen.insert(l)) {
      this.map.push(l);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:129 visit_local
  override visit_local(l: Local, context: PlaceContext, _location: Location): void {
    // Exclude non-uses to keep `StorageLive` from controlling where we put
    // a `Local`, since it might not actually be assigned until much later.
    if (PlaceContextC.is_use(context)) {
      this.track(l);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/prettify.rs:138 LocalUpdater
class LocalUpdater extends MutVisitor {
  constructor(
    public map: Local[],
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:144 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/prettify.rs:148 visit_local
  override visit_local(l: MutRef<Local>, _: PlaceContext, _2: Location): void {
    l.value = this.map[l.value]!;
  }
}
