// Port of compiler/rustc_mir_transform/src/elaborate_drops.rs (lane mt-drops, wave 24), replacing mt-skeleton's stub.
//
// PORT: `ElaborateDropsCtxt` is a class implementing elaborate_drop.ts's `DropElaborator<MovePathIndex>`; its
// `IndexVec<MovePathIndex, Option<Local>>` of drop flags is `(Local | undefined)[]`. `impl fmt::Debug` is
// `debug_ElaborateDropsCtxt`.
// PORT: `InitializationData::maybe_init_uninit` reads `MaybeReachable::contains` of the init cursor's state through
// `BitSetExt_MixedBitSet` (as initialized.ts does).
// PORT: the `LookupResult` printed by `collect_drop_flags`' delayed bug uses its derived `Debug`
// (`debug_LookupResult` below; move_paths/mod.ts has none).
// PORT: `#[instrument]` / `debug!` are comments (compiled out of release rustc). `debug_assert*!` are comments.
import type { FieldIdx, VariantIdx } from "../rustc_abi/layout.ts";
import { DenseBitSet, MixedBitSet } from "../rustc_index/bit_set.ts";
import {
  BasicBlock,
  type Body,
  ConstOperand,
  Const,
  debug_BasicBlock,
  debug_Place,
  Local,
  Location,
  type Operand,
  type Place,
  type Rvalue,
  clone_Rvalue,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../rustc_middle/mir/statement.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import {
  DropFlagState,
  drop_flag_effects_for_function_entry,
  drop_flag_effects_for_location,
  move_path_children_matching,
  on_all_children_bits,
  on_lookup_result_bits,
} from "../rustc_mir_dataflow/drop_flag_effects.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import { MaybeReachable } from "../rustc_mir_dataflow/framework/lattice.ts";
import { type BitSetExt, BitSetExt_MixedBitSet } from "../rustc_mir_dataflow/framework/mod.ts";
import { MaybeInitializedPlaces, MaybeUninitializedPlaces } from "../rustc_mir_dataflow/impls/initialized.ts";
import type { MoveDataTypingEnv } from "../rustc_mir_dataflow/lib.ts";
import { type LookupResult, MoveData, MovePathIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import { debug_struct_non_exhaustive, type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import { type DropElaborator, type DropFlagMode, type DropStyle, elaborate_drop, Unwind } from "./elaborate_drop.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

type InitsCursor = ResultsCursor<MaybeReachable<MixedBitSet<MovePathIndex>>, MaybeInitializedPlaces>;
type UninitsCursor = ResultsCursor<MixedBitSet<MovePathIndex>, MaybeUninitializedPlaces>;

/// During MIR building, Drop terminators are inserted in every place where a drop may occur.
/// However, in this phase, the presence of these terminators does not guarantee that a destructor
/// will run, as the target of the drop may be uninitialized.
/// In general, the compiler cannot determine at compile time whether a destructor will run or not.
///
/// At a high level, this pass refines Drop to only run the destructor if the
/// target is initialized. The way this is achieved is by inserting drop flags for every variable
/// that may be dropped, and then using those flags to determine whether a destructor should run.
/// Once this is complete, Drop terminators in the MIR correspond to a call to the "drop glue" or
/// "drop shim" for the type of the dropped place.
///
/// This pass relies on dropped places having an associated move path, which is then used to
/// determine the initialization status of the place and its descendants.
/// It's worth noting that a MIR containing a Drop without an associated move path is probably ill
/// formed, as it would allow running a destructor on a place behind a reference:
///
/// ```text
/// fn drop_term<T>(t: &mut T) {
///     mir! {
///         {
///             Drop(*t, exit)
///         }
///         exit = {
///             Return()
///         }
///     }
/// }
/// ```
// rustc-type: compiler/rustc_mir_transform/src/elaborate_drops.rs:49 ElaborateDrops
export class ElaborateDrops extends MirPass {
  readonly type_name = "rustc_mir_transform::elaborate_drops::ElaborateDrops";

  // ---- impl crate::MirPass<'tcx> for ElaborateDrops ----

  // #[instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:53 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!("elaborate_drops({:?} @ {:?})", body.source, body.span);
    // FIXME(#132279): This is used during the phase transition from analysis
    // to runtime, so we have to manually specify the correct typing mode.
    const typing_env = TypingEnv.post_analysis(tcx, body.source.def_id());
    // For types that do not need dropping, the behaviour is trivial. So we only need to track
    // init/uninit for types that do need dropping.
    const move_data = MoveData.gather_moves(body, tcx, (ty) => ty.needs_drop(tcx, typing_env));
    let elaborate_patch: MirPatch;
    {
      const env: MoveDataTypingEnv = { move_data, typing_env };

      const inits = MaybeInitializedPlaces.new(tcx, body, env.move_data)
        .exclude_inactive_in_otherwise()
        .skipping_unreachable_unwind()
        .iterate_to_fixpoint(tcx, body, "elaborate_drops")
        .into_results_cursor(body) as InitsCursor;
      const dead_unwinds = compute_dead_unwinds(body, inits);

      const uninits = MaybeUninitializedPlaces.new(tcx, body, env.move_data)
        .mark_inactive_variants_as_uninit()
        .skipping_unreachable_unwind(dead_unwinds)
        .iterate_to_fixpoint(tcx, body, "elaborate_drops")
        .into_results_cursor(body) as UninitsCursor;

      const drop_flags: (Local | undefined)[] = Array.from({ length: env.move_data.move_paths.length }, () => undefined);
      elaborate_patch = new ElaborateDropsCtxt(tcx, body, env, new InitializationData(inits, uninits), drop_flags, MirPatch.new(body)).elaborate();
    }
    elaborate_patch.apply(body);
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:91 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements MIR drop semantics.
    return PassPolicy.Required;
  }
}

/// Records unwind edges which are known to be unreachable, because they are in `drop` terminators
/// that can't drop anything.
// #[instrument(level = "trace", skip(body, flow_inits), ret)]
// rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:100 compute_dead_unwinds
function compute_dead_unwinds(body: Body, flow_inits: InitsCursor): DenseBitSet<BasicBlock> {
  // We only need to do this pass once, because unwind edges can only
  // reach cleanup blocks, which can't have unwind edges themselves.
  const blocks = body.basic_blocks.deref();
  const dead_unwinds = DenseBitSet.new_empty<BasicBlock>(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const bb = BasicBlock.new(i);
    const bb_data = blocks[i]!;
    const kind = bb_data.terminator_().kind;
    if (!(kind.$ === "Drop" && kind.unwind.$ === "Cleanup")) {
      continue;
    }
    const place = kind.place;

    flow_inits.seek_before_primary_effect(body.terminator_loc(bb));
    if (flow_inits.analysis().is_unwind_dead(place, flow_inits.get())) {
      dead_unwinds.insert(bb);
    }
  }

  return dead_unwinds;
}

// rustc-type: compiler/rustc_mir_transform/src/elaborate_drops.rs:123 InitializationData
class InitializationData {
  constructor(
    public inits: InitsCursor,
    public uninits: UninitsCursor,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:129 seek_before
  seek_before(loc: Location): void {
    this.inits.seek_before_primary_effect(loc);
    this.uninits.seek_before_primary_effect(loc);
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:134 maybe_init_uninit
  maybe_init_uninit(path: MovePathIndex): [boolean, boolean] {
    return [
      MaybeReachable.contains(this.inits.get(), path, BitSetExt_MixedBitSet as BitSetExt<MixedBitSet<MovePathIndex>, MovePathIndex>),
      MixedBitSet.contains(this.uninits.get(), path),
    ];
  }
}

// rustc-type: compiler/rustc_mir_transform/src/elaborate_drops.rs:247 ElaborateDropsCtxt
class ElaborateDropsCtxt implements DropElaborator<MovePathIndex> {
  constructor(
    public tcx_: TyCtxt,
    public body_: Body,
    public env: MoveDataTypingEnv,
    public init_data: InitializationData,
    public drop_flags: (Local | undefined)[],
    public patch_: MirPatch,
  ) {}

  // ---- impl<'a, 'tcx> DropElaborator<'a, 'tcx> for ElaborateDropsCtxt<'a, 'tcx> ----
  // PORT: the trait impl (elaborate_drops.rs:139) comes before the struct upstream; its methods are in the class body
  // (PORTING §8). Fields colliding with the trait's accessors get a `_` (`tcx_`, `body_`, `patch_`).

  // type Path = MovePathIndex;

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:142 patch_ref
  patch_ref(): MirPatch {
    return this.patch_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:146 patch
  patch(): MirPatch {
    return this.patch_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:150 body
  body(): Body {
    return this.body_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:154 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:158 typing_env
  typing_env(): TypingEnv {
    return this.env.typing_env;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:162 allow_async_drops
  allow_async_drops(): boolean {
    return true;
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:167 drop_style
  drop_style(path: MovePathIndex, mode: DropFlagMode): DropStyle {
    let maybe_init: boolean;
    let maybe_uninit: boolean;
    let multipart: boolean;
    switch (mode) {
      case "Shallow":
        [[maybe_init, maybe_uninit], multipart] = [this.init_data.maybe_init_uninit(path), false];
        break;
      case "Deep": {
        let some_maybe_init = false;
        let some_maybe_uninit = false;
        let children_count = 0;
        on_all_children_bits(this.move_data(), path, (child) => {
          const [maybe_init, maybe_uninit] = this.init_data.maybe_init_uninit(child);
          // debug!("elaborate_drop: state({:?}) = {:?}", child, (maybe_init, maybe_uninit));
          some_maybe_init ||= maybe_init;
          some_maybe_uninit ||= maybe_uninit;
          children_count += 1;
        });
        [[maybe_init, maybe_uninit], multipart] = [[some_maybe_init, some_maybe_uninit], children_count !== 1];
        break;
      }
    }
    if (!maybe_init) {
      return "Dead";
    } else if (!maybe_uninit) {
      return "Static";
    } else if (!multipart) {
      return "Conditional";
    } else {
      return "Open";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:192 drop_flags_for
  drop_flags_for(path: MovePathIndex, mode: DropFlagMode): Place[] {
    const flags: Place[] = [];
    switch (mode) {
      case "Shallow": {
        const flag = this.drop_flags[path];
        if (flag !== undefined) {
          flags.push(Place_from_Local(flag));
        }
        break;
      }
      case "Deep": {
        on_all_children_bits(this.move_data(), path, (child) => {
          const flag = this.drop_flags[child];
          if (flag !== undefined) {
            flags.push(Place_from_Local(flag));
          }
        });
        break;
      }
    }
    return flags;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:211 field_subpath
  field_subpath(path: MovePathIndex, field: FieldIdx): MovePathIndex | undefined {
    return move_path_children_matching(this.move_data(), path, (e) => {
      if (e.$ === "Field") {
        return e._0 === field;
      }
      return false;
    });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:218 array_subpath
  array_subpath(path: MovePathIndex, index: number, _size: number): MovePathIndex | undefined {
    return move_path_children_matching(this.move_data(), path, (e) => {
      if (e.$ === "ConstantIndex") {
        // debug_assert!(size == min_length, "min_length should be exact for arrays");
        assert(!e.from_end, "from_end should not be used for array element ConstantIndex");
        return e.offset === index;
      }
      return false;
    });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:229 deref_subpath
  deref_subpath(path: MovePathIndex): MovePathIndex | undefined {
    return move_path_children_matching(this.move_data(), path, (e) => e.$ === "Deref");
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:235 downcast_subpath
  downcast_subpath(path: MovePathIndex, variant: VariantIdx): MovePathIndex | undefined {
    return move_path_children_matching(this.move_data(), path, (e) => {
      if (e.$ === "Downcast") {
        return e._1 === variant;
      }
      return false;
    });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:242 get_drop_flag
  get_drop_flag(path: MovePathIndex): Operand | undefined {
    const flag = this.drop_flag(path);
    return flag === undefined ? undefined : { $: "Copy", _0: flag };
  }

  // ---- impl<'a, 'tcx> ElaborateDropsCtxt<'a, 'tcx> ----

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:263 move_data
  move_data(): MoveData {
    return this.env.move_data;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:267 create_drop_flag
  create_drop_flag(index: MovePathIndex, span: Span): void {
    const patch = this.patch_;
    // debug!("create_drop_flag({:?})", self.body.span);
    if (this.drop_flags[index] === undefined) {
      this.drop_flags[index] = patch.new_temp(this.tcx_.types.bool, span);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:273 drop_flag
  drop_flag(index: MovePathIndex): Place | undefined {
    const flag = this.drop_flags[index];
    return flag === undefined ? undefined : Place_from_Local(flag);
  }

  /// create a patch that elaborates all drops in the input
  /// MIR.
  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:279 elaborate
  elaborate(): MirPatch {
    this.collect_drop_flags();

    this.elaborate_drops();

    this.drop_flags_on_init();
    this.drop_flags_for_fn_rets();
    this.drop_flags_for_args();
    this.drop_flags_for_locs();

    return this.patch_;
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:292 collect_drop_flags
  collect_drop_flags(): void {
    const blocks = this.body_.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const data = blocks[i]!;
      const terminator = data.terminator_();
      const kind = terminator.kind;
      if (kind.$ !== "Drop") continue;
      const place = kind.place;

      const path = this.move_data().rev_lookup.find(place.as_ref());
      // debug!("collect_drop_flags: {:?}, place {:?} ({:?})", bb, place, path);

      switch (path.$) {
        case "Exact": {
          const path_ = path._0;
          this.init_data.seek_before(this.body_.terminator_loc(bb));
          on_all_children_bits(this.move_data(), path_, (child) => {
            const [maybe_init, maybe_uninit] = this.init_data.maybe_init_uninit(child);
            // debug!(
            //     "collect_drop_flags: collecting {:?} from {:?}@{:?} - {:?}",
            //     child,
            //     place,
            //     path,
            //     (maybe_init, maybe_uninit)
            // );
            if (maybe_init && maybe_uninit) {
              this.create_drop_flag(child, terminator.source_info.span);
            }
          });
          break;
        }
        case "Parent": {
          if (path._0 === undefined) {
            break;
          }
          const parent = path._0;
          if (this.body_.local_decls[place.local]!.is_deref_temp()) {
            continue;
          }

          this.init_data.seek_before(this.body_.terminator_loc(bb));
          const [_maybe_init, maybe_uninit] = this.init_data.maybe_init_uninit(parent);
          if (maybe_uninit) {
            this.tcx_
              .dcx()
              .span_delayed_bug(
                terminator.source_info.span,
                `drop of untracked, uninitialized value ${debug_BasicBlock(bb, PLAIN)}, place ${debug_Place(place, PLAIN)} (${debug_LookupResult(path, PLAIN)})`,
              );
          }
          break;
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:338 elaborate_drops
  elaborate_drops(): void {
    // This function should mirror what `collect_drop_flags` does.
    const blocks = this.body_.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const data = blocks[i]!;
      const terminator = data.terminator_();
      const kind = terminator.kind;
      if (kind.$ !== "Drop") {
        continue;
      }
      const { place, target, unwind, replace, drop } = kind;

      // This place does not need dropping. It does not have an associated move-path, so the
      // match below will conservatively keep an unconditional drop. As that drop is useless,
      // just remove it here and now.
      if (!place.ty(this.body_.local_decls, this.tcx_).ty.needs_drop(this.tcx_, this.typing_env())) {
        this.patch_.patch_terminator(bb, TerminatorKind.goto(target));
        continue;
      }

      const path = this.move_data().rev_lookup.find(place.as_ref());
      switch (path.$) {
        case "Exact": {
          let unwind_: Unwind;
          if (data.is_cleanup) {
            unwind_ = Unwind.InCleanup;
          } else {
            switch (unwind.$) {
              case "Cleanup":
                unwind_ = Unwind.To(unwind._0);
                break;
              case "Continue":
                unwind_ = Unwind.To(this.patch_.resume_block_());
                break;
              case "Unreachable":
                unwind_ = Unwind.To(this.patch_.unreachable_cleanup_block_());
                break;
              case "Terminate": {
                const reason = unwind._0;
                // debug_assert_ne!(
                //     reason,
                //     UnwindTerminateReason::InCleanup,
                //     "we are not in a cleanup block, InCleanup reason should be impossible"
                // );
                unwind_ = Unwind.To(this.patch_.terminate_block_(reason));
                break;
              }
            }
          }
          this.init_data.seek_before(this.body_.terminator_loc(bb));
          elaborate_drop<MovePathIndex>(this, terminator.source_info, place, path._0, target, unwind_, bb, drop);
          break;
        }
        case "Parent": {
          if (path._0 === undefined) {
            break;
          }
          if (!replace) {
            this.tcx_.dcx().span_bug(terminator.source_info.span, `drop of untracked value ${debug_BasicBlock(bb, PLAIN)}`);
          }
          // A drop and replace behind a pointer/array/whatever.
          // The borrow checker requires that these locations are initialized before the
          // assignment, so we just leave an unconditional drop.
          assert(!data.is_cleanup, "assertion failed: !data.is_cleanup");
          break;
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:407 constant_bool
  constant_bool(span: Span, val: boolean): Rvalue {
    return { $: "Use", _0: { $: "Constant", _0: new ConstOperand(span, undefined, Const.from_bool(this.tcx_, val)) }, _1: "Yes" };
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:418 set_drop_flag
  set_drop_flag(loc: Location, path: MovePathIndex, val: DropFlagState): void {
    const flag = this.drop_flags[path];
    if (flag !== undefined) {
      const span = this.patch_.source_info_for_location(this.body_, loc).span;
      const val_ = this.constant_bool(span, DropFlagState.value(val));
      this.patch_.add_assign(loc, Place_from_Local(flag), val_);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:426 drop_flags_on_init
  drop_flags_on_init(): void {
    const loc = Location.START;
    const span = this.patch_.source_info_for_location(this.body_, loc).span;
    const false_ = this.constant_bool(span, false);
    for (const flag of this.drop_flags) {
      if (flag === undefined) continue;
      this.patch_.add_assign(loc, Place_from_Local(flag), clone_Rvalue(false_));
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:435 drop_flags_for_fn_rets
  drop_flags_for_fn_rets(): void {
    const blocks = this.body_.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const data = blocks[i]!;
      const kind = data.terminator_().kind;
      if (kind.$ === "Call" && kind.target !== undefined && kind.unwind.$ === "Cleanup") {
        const destination = kind.destination;
        const tgt = kind.target;
        assert(!this.patch_.is_term_patched(bb), "assertion failed: !self.patch.is_term_patched(bb)");

        const loc = BasicBlock.start_location(tgt);
        const path = this.move_data().rev_lookup.find(destination.as_ref());
        on_lookup_result_bits(this.move_data(), path, (child) => this.set_drop_flag(loc, child, DropFlagState.Present));
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:455 drop_flags_for_args
  drop_flags_for_args(): void {
    const loc = Location.START;
    drop_flag_effects_for_function_entry(this.body_, this.env.move_data, (path, ds) => {
      this.set_drop_flag(loc, path, ds);
    });
  }

  // rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:466 drop_flags_for_locs
  drop_flags_for_locs(): void {
    // We intentionally iterate only over the *old* basic blocks.
    //
    // Basic blocks created by drop elaboration update their
    // drop flags by themselves, to avoid the drop flags being
    // clobbered before they are read.

    const blocks = this.body_.basic_blocks.deref();
    for (let b = 0; b < blocks.length; b++) {
      const bb = BasicBlock.new(b);
      const data = blocks[b]!;
      // debug!("drop_flags_for_locs({:?})", data);
      for (let i = 0; i < data.statements.length + 1; i++) {
        // debug!("drop_flag_for_locs: stmt {}", i);
        if (i === data.statements.length) {
          const kind = data.terminator_().kind;
          if (kind.$ === "Drop") {
            // drop elaboration should handle that by itself
            continue;
          } else if (kind.$ === "UnwindResume") {
            // It is possible for `Resume` to be patched
            // (in particular it can be patched to be replaced with
            // a Goto; see `MirPatch::new`).
          } else {
            assert(!this.patch_.is_term_patched(bb), "assertion failed: !self.patch.is_term_patched(bb)");
          }
        }
        const loc = new Location(bb, i);
        drop_flag_effects_for_location(this.body_, this.env.move_data, loc, (path, ds) => this.set_drop_flag(loc, path, ds));
      }

      // There may be a critical edge after this call,
      // so mark the return as initialized *before* the
      // call.
      const kind = data.terminator_().kind;
      if (
        kind.$ === "Call" &&
        kind.target !== undefined &&
        (kind.unwind.$ === "Continue" || kind.unwind.$ === "Unreachable" || kind.unwind.$ === "Terminate")
      ) {
        const destination = kind.destination;
        assert(!this.patch_.is_term_patched(bb), "assertion failed: !self.patch.is_term_patched(bb)");

        const loc = new Location(bb, data.statements.length);
        const path = this.move_data().rev_lookup.find(destination.as_ref());
        on_lookup_result_bits(this.move_data(), path, (child) => this.set_drop_flag(loc, child, DropFlagState.Present));
      }
    }
  }
}

// impl fmt::Debug for ElaborateDropsCtxt<'_, '_>
// rustc: compiler/rustc_mir_transform/src/elaborate_drops.rs:257 fmt
export const debug_ElaborateDropsCtxt: Debug<ElaborateDropsCtxt> = (_v, f) => debug_struct_non_exhaustive(f, "ElaborateDropsCtxt", []);

/** The derived `Debug` of `LookupResult` (move_paths/mod.rs:342 `#[derive(Copy, Clone, Debug)]`). */
function debug_LookupResult(v: LookupResult, f: Fmt): string {
  switch (v.$) {
    case "Exact":
      return `Exact(${MovePathIndex.debug(v._0, f)})`;
    case "Parent":
      return `Parent(${v._0 === undefined ? "None" : `Some(${MovePathIndex.debug(v._0, f)})`})`;
  }
}
