// Port of compiler/rustc_mir_dataflow/src/impls/initialized.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls). Notes:
// - The three analyses are classes extending `AnalysisBase<Domain, SwitchIntData>` (framework/mod.ts); their fields
//   are the struct fields in declaration order. Fields that collide with a method get a trailing `_` (precedent
//   `NiceRegionError.regions_`): `move_data_` (the `HasMoveData::move_data()` method), `exclude_inactive_in_otherwise_`,
//   `mark_inactive_variants_as_uninit_`.
// - The builder-style `fn f(mut self) -> Self` methods set the field on `this` and return `this`.
// - `state.gen_(p)` / `state.kill(p)` on a `MaybeReachable<MixedBitSet<_>>` domain go through
//   `GenKill_MaybeReachable(GenKill_MixedBitSet())`; `*state = MaybeReachable::Reachable(..)` is
//   `MaybeReachable.assign(state, ..)` (lattice.ts); `state.contains(p)` is `MaybeReachable.contains(state, p,
//   BitSetExt_MixedBitSet)`.
// - `MaybePlacesSwitchIntData` is the `SwitchIntData` (`S`) of both maybe-places analyses.
// - `Place == Place` is `local === && projection ===` (interned list); `Location == Location` compares the fields;
//   `FxIndexSet<Location>` is a `KeyedSet` keyed by `block:statement_index`.

import type { VariantIdx } from "../../rustc_abi/layout.ts";
import { DenseBitSet, MixedBitSet } from "../../rustc_index/bit_set.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_matches, panic } from "../../std/panic.ts";
import {
  DropFlagState,
  drop_flag_effects_for_function_entry,
  drop_flag_effects_for_location,
  InactiveVariants,
  on_all_children_bits,
  on_all_inactive_variants,
  on_lookup_result_bits,
} from "../drop_flag_effects.ts";
import { DebugWithContext_Local, DebugWithContext_MovePathIndex } from "../framework/fmt.ts";
import { MaybeReachable } from "../framework/lattice.ts";
import {
  AnalysisBase,
  type Domain,
  Domain_DenseBitSet,
  Domain_MaybeReachable,
  Domain_MixedBitSet,
  GenKill_DenseBitSet,
  GenKill_MaybeReachable,
  GenKill_MixedBitSet,
  type BitSetExt,
  BitSetExt_MixedBitSet,
  type SwitchTargetIndex,
} from "../framework/mod.ts";
import type { HasMoveData, Init, MoveData, MovePathIndex } from "../move_paths/mod.ts";
import {
  BasicBlock,
  type Body,
  CallReturnPlaces,
  debug_UnwindAction,
  type Local,
  Location,
  Operand,
  type Place,
  type Statement,
  StatementKind,
  type SwitchTargets,
  type Terminator,
  type TerminatorEdges,
} from "../../rustc_middle/mir/mod.ts";

const GK_MaybeInit = GenKill_MaybeReachable(GenKill_MixedBitSet<MovePathIndex>());
const GK_MaybeUninit = GenKill_MixedBitSet<MovePathIndex>();
const GK_EverInit = GenKill_DenseBitSet<Local>();

// Used by both `MaybeInitializedPlaces` and `MaybeUninitializedPlaces`.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:25 MaybePlacesSwitchIntData
export class MaybePlacesSwitchIntData {
  constructor(
    public enum_place: Place,

    // Variant indices targeted by the SwitchInt. For example, if you have:
    // ```
    // enum E { A = 1, B = 3, C = 5, D = 7 }
    // ```
    // and a `SwitchInt(A -> bb1, C -> bb2, _ -> bb3)`, this vec will contain `[0, 2]` because
    // those are the variant indices for `A` and `C`.
    public variants: VariantIdx[],
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:38 new
  static new(tcx: TyCtxt, body: Body, block: BasicBlock, targets: SwitchTargets, discr_: Operand): MaybePlacesSwitchIntData | undefined {
    const discr = Operand.place(discr_);
    if (discr === undefined) return undefined;

    // Inspect a `SwitchInt`-terminated basic block to see if the condition of that `SwitchInt`
    // is an enum discriminant.
    //
    // We expect such blocks to have a call to `discriminant` as their last statement like so:
    // ```text
    // ...
    // _42 = discriminant(_1)
    // SwitchInt(_42, ..)
    // ```
    // If the basic block matches this pattern, this function gathers the place corresponding
    // to the enum (`_1` in the example above) as well as the discriminants.
    const block_data = body.index(block);
    outer: for (let i = block_data.statements.length - 1; i >= 0; i--) {
      const statement = block_data.statements[i]!;
      const kind = statement.kind;
      if (kind.$ === "Assign" && kind._0[1].$ === "Discriminant" && Place_eq(kind._0[0], discr)) {
        const enum_place = kind._0[1]._0;
        const t = enum_place.ty(body, tcx).ty;
        const ty_kind = t.kind();
        switch (ty_kind.$) {
          case "Adt": {
            const enum_def = ty_kind._0;
            // For each value in the SwitchInt, find the VariantIdx for the variant
            // with that value. This works because `discriminant_vals` and
            // `targets.all_values()` are guaranteed to list variants in the same
            // AdtDef order. (If that ever changes the `expect` will panic.)
            const discriminants = enum_def.discriminants(tcx);
            const variants = targets.all_values().map((value) => {
              // On each call to this closure `find` only consumes part of
              // the `discriminants` iterator.
              for (let d = discriminants.next(); !d.done; d = discriminants.next()) {
                if (d.value[1].val === value) return d.value[0];
              }
              return panic("SwitchInt vals should match a variant");
            });

            return new MaybePlacesSwitchIntData(enum_place, variants);
          }

          // `Rvalue::Discriminant` is also used to get the active yield point for a
          // coroutine, but we do not need edge-specific effects in that case. This
          // may change in the future.
          case "Coroutine":
            break outer;

          default:
            return bug(`\`discriminant\` called on unexpected type ${debug_Ty(t, PLAIN)}`);
        }
      } else if (kind.$ === "Coverage") {
        continue;
      } else {
        break;
      }
    }
    return undefined;
  }
}

/// `MaybeInitializedPlaces` tracks all places that might be
/// initialized upon reaching a particular point in the control flow
/// for a function.
///
/// For example, in code like the following, we have corresponding
/// dataflow information shown in the right-hand comments.
///
/// ```rust
/// struct S;
/// #[rustfmt::skip]
/// fn foo(p: bool) {                           // maybe-init:
///                                             // {p}
///     let a = S; let mut b = S; let c; let d; // {p, a, b}
///
///     if p {
///         drop(a);                            // {p,    b}
///         b = S;                              // {p,    b}
///
///     } else {
///         drop(b);                            // {p, a}
///         d = S;                              // {p, a,       d}
///
///     }                                       // {p, a, b,    d}
///
///     c = S;                                  // {p, a, b, c, d}
/// }
/// ```
///
/// To determine whether a place is *definitely* initialized at a
/// particular control-flow point, one can take the set-complement
/// of the data from `MaybeUninitializedPlaces` at the corresponding
/// control-flow point.
///
/// Similarly, at a given `drop` statement, the set-intersection
/// between this data and `MaybeUninitializedPlaces` yields the set of
/// places that would require a dynamic drop-flag at that statement.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:139 MaybeInitializedPlaces
export class MaybeInitializedPlaces
  extends AnalysisBase<MaybeReachable<MixedBitSet<MovePathIndex>>, MaybePlacesSwitchIntData>
  implements HasMoveData
{
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public move_data_: MoveData,
    public exclude_inactive_in_otherwise_: boolean,
    public skip_unreachable_unwind: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:148 new
  static new(tcx: TyCtxt, body: Body, move_data: MoveData): MaybeInitializedPlaces {
    return new MaybeInitializedPlaces(tcx, body, move_data, false, false);
  }

  /// Ensures definitely inactive variants are excluded from the set of initialized places for
  /// blocks reached through an `otherwise` edge.
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:162 exclude_inactive_in_otherwise
  exclude_inactive_in_otherwise(): this {
    this.exclude_inactive_in_otherwise_ = true;
    return this;
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:167 skipping_unreachable_unwind
  skipping_unreachable_unwind(): this {
    this.skip_unreachable_unwind = true;
    return this;
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:172 is_unwind_dead
  is_unwind_dead(place: Place, state: MaybeReachable<MixedBitSet<MovePathIndex>>): boolean {
    const r = this.move_data().rev_lookup.find(place.as_ref());
    if (r.$ === "Exact") {
      const path = r._0;
      let maybe_live = false;
      on_all_children_bits(this.move_data(), path, (child) => {
        maybe_live ||= MaybeReachable_contains(state, child);
      });
      return !maybe_live;
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:188 update_bits
  static update_bits(state: MaybeReachable<MixedBitSet<MovePathIndex>>, path: MovePathIndex, dfstate: DropFlagState): void {
    switch (dfstate) {
      case "Absent":
        GK_MaybeInit.kill(state, path);
        break;
      case "Present":
        GK_MaybeInit.gen_(state, path);
        break;
    }
  }

  // ---- impl HasMoveData for MaybeInitializedPlaces ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:201 move_data
  move_data(): MoveData {
    return this.move_data_;
  }

  // ---- impl Analysis for MaybeInitializedPlaces ----

  /// There can be many more `MovePathIndex` than there are locals in a MIR body.
  /// We use a mixed bitset to avoid paying too high a memory footprint.
  // type Domain = MaybeReachable<MixedBitSet<MovePathIndex>>;
  readonly Domain: Domain<MaybeReachable<MixedBitSet<MovePathIndex>>> = Domain_MaybeReachable(
    Domain_MixedBitSet(DebugWithContext_MovePathIndex),
  );

  // type SwitchIntData = MaybePlacesSwitchIntData<'tcx>;

  readonly NAME = "maybe_init";

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:215 bottom_value
  bottom_value(_1: Body): MaybeReachable<MixedBitSet<MovePathIndex>> {
    // bottom = uninitialized
    return MaybeReachable.Unreachable();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:220 initialize_start_block
  initialize_start_block(_1: Body, state: MaybeReachable<MixedBitSet<MovePathIndex>>): void {
    MaybeReachable.assign(state, MaybeReachable.Reachable(MixedBitSet.new_empty<MovePathIndex>(this.move_data().move_paths.length)));
    drop_flag_effects_for_function_entry(this.body, this.move_data_, (path, _s) => {
      // debug_assert!(s == DropFlagState::Present);
      GK_MaybeInit.gen_(state, path);
    });
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:229 apply_primary_statement_effect
  apply_primary_statement_effect(state: MaybeReachable<MixedBitSet<MovePathIndex>>, statement: Statement, location: Location): void {
    drop_flag_effects_for_location(this.body, this.move_data_, location, (path, s) => MaybeInitializedPlaces.update_bits(state, path, s));

    // Mark all places as "maybe init" if they are mutably borrowed. See #90752.
    if (this.tcx.sess.opts.unstable_opts.precise_enum_drop_elaboration) {
      const assign = StatementKind.as_assign(statement.kind);
      if (assign !== undefined) {
        const rvalue = assign[1];
        let place: Place | undefined;
        if (rvalue.$ === "Ref" && rvalue._1.$ === "Mut") {
          place = rvalue._2;
        } else if (rvalue.$ === "RawPtr") {
          // FIXME: Does `&raw const foo` allow mutation? See #90413.
          place = rvalue._1;
        }
        if (place !== undefined) {
          const r = this.move_data().rev_lookup.find(place.as_ref());
          if (r.$ === "Exact") {
            const mpi = r._0;
            on_all_children_bits(this.move_data(), mpi, (child) => {
              GK_MaybeInit.gen_(state, child);
            });
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:253 get_terminator_edges
  override get_terminator_edges(
    state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    terminator: Terminator,
    _location: Location,
  ): TerminatorEdges {
    // Note: this relies on `get_terminator_edges` being called before
    // `apply_primary_terminator_effect` because the result of `is_unwind_dead` is affected by
    // the `drop_flag_effects_for_location` in `apply_primary_terminator_effect`.
    let edges = terminator.edges();
    const kind = terminator.kind;
    if (
      this.skip_unreachable_unwind &&
      kind.$ === "Drop" &&
      kind.unwind.$ === "Cleanup" &&
      this.is_unwind_dead(kind.place, state)
    ) {
      edges = { $: "Single", _0: kind.target };
    }
    return edges;
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:274 apply_primary_terminator_effect
  override apply_primary_terminator_effect(
    state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _terminator: Terminator,
    location: Location,
  ): void {
    drop_flag_effects_for_location(this.body, this.move_data_, location, (path, s) => MaybeInitializedPlaces.update_bits(state, path, s));
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:285 apply_call_return_effect
  override apply_call_return_effect(
    state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _block: BasicBlock,
    return_places: CallReturnPlaces,
  ): void {
    CallReturnPlaces.for_each(return_places, (place) => {
      // when a call returns successfully, that means we need to set
      // the bits for that dest_place to 1 (initialized).
      on_lookup_result_bits(this.move_data(), this.move_data().rev_lookup.find(place.as_ref()), (mpi) => {
        GK_MaybeInit.gen_(state, mpi);
      });
    });
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:304 get_switch_int_data
  override get_switch_int_data(block: BasicBlock, targets: SwitchTargets, discr: Operand): MaybePlacesSwitchIntData | undefined {
    if (!this.tcx.sess.opts.unstable_opts.precise_enum_drop_elaboration) {
      return undefined;
    }

    return MaybePlacesSwitchIntData.new(this.tcx, this.body, block, targets, discr);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:317 apply_switch_int_edge_effect
  override apply_switch_int_edge_effect(
    state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    data: MaybePlacesSwitchIntData,
    target_idx: SwitchTargetIndex,
  ): void {
    let inactive_variants: InactiveVariants;
    if (target_idx.$ === "Normal") {
      inactive_variants = { $: "Active", _0: data.variants[target_idx._0]! };
    } else if (target_idx.$ === "Otherwise" && this.exclude_inactive_in_otherwise_) {
      inactive_variants = { $: "Inactives", _0: [...data.variants] };
    } else {
      return;
    }

    // Kill all move paths that correspond to variants we know to be inactive along this
    // particular outgoing edge of a `SwitchInt`.
    on_all_inactive_variants(this.move_data_, data.enum_place, inactive_variants, (mpi) => GK_MaybeInit.kill(state, mpi));
  }
}

/// `MaybeUninitializedPlaces` tracks all places that might be
/// uninitialized upon reaching a particular point in the control flow
/// for a function.
///
/// For example, in code like the following, we have corresponding
/// dataflow information shown in the right-hand comments.
///
/// ```rust
/// struct S;
/// #[rustfmt::skip]
/// fn foo(p: bool) {                           // maybe-uninit:
///                                             // {a, b, c, d}
///     let a = S; let mut b = S; let c; let d; // {      c, d}
///
///     if p {
///         drop(a);                            // {a,    c, d}
///         b = S;                              // {a,    c, d}
///
///     } else {
///         drop(b);                            // {   b, c, d}
///         d = S;                              // {   b, c   }
///
///     }                                       // {a, b, c, d}
///
///     c = S;                                  // {a, b,    d}
/// }
/// ```
///
/// To determine whether a place is *definitely* uninitialized at a
/// particular control-flow point, one can take the set-complement
/// of the data from `MaybeInitializedPlaces` at the corresponding
/// control-flow point.
///
/// Similarly, at a given `drop` statement, the set-intersection
/// between this data and `MaybeInitializedPlaces` yields the set of
/// places that would require a dynamic drop-flag at that statement.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:380 MaybeUninitializedPlaces
export class MaybeUninitializedPlaces
  extends AnalysisBase<MaybeUninitializedPlacesDomain, MaybePlacesSwitchIntData>
  implements HasMoveData
{
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public move_data_: MoveData,

    public mark_inactive_variants_as_uninit_: boolean,
    public skip_unreachable_unwind: DenseBitSet<BasicBlock>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:390 new
  static new(tcx: TyCtxt, body: Body, move_data: MoveData): MaybeUninitializedPlaces {
    return new MaybeUninitializedPlaces(tcx, body, move_data, false, DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length));
  }

  /// Causes inactive enum variants to be marked as "maybe uninitialized" after a switch on an
  /// enum discriminant.
  ///
  /// This is correct in a vacuum but is not the default because it causes problems in the borrow
  /// checker, where this information gets propagated along `FakeEdge`s.
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:407 mark_inactive_variants_as_uninit
  mark_inactive_variants_as_uninit(): this {
    this.mark_inactive_variants_as_uninit_ = true;
    return this;
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:412 skipping_unreachable_unwind
  skipping_unreachable_unwind(unreachable_unwind: DenseBitSet<BasicBlock>): this {
    this.skip_unreachable_unwind = unreachable_unwind;
    return this;
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:420 update_bits
  static update_bits(state: MaybeUninitializedPlacesDomain, path: MovePathIndex, dfstate: DropFlagState): void {
    switch (dfstate) {
      case "Absent":
        GK_MaybeUninit.gen_(state, path);
        break;
      case "Present":
        GK_MaybeUninit.kill(state, path);
        break;
    }
  }

  // ---- impl HasMoveData for MaybeUninitializedPlaces ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:433 move_data
  move_data(): MoveData {
    return this.move_data_;
  }

  // ---- impl Analysis for MaybeUninitializedPlaces ----

  // type Domain = MaybeUninitializedPlacesDomain;
  readonly Domain: Domain<MaybeUninitializedPlacesDomain> = Domain_MixedBitSet(DebugWithContext_MovePathIndex);

  // type SwitchIntData = MaybePlacesSwitchIntData<'tcx>;

  readonly NAME = "maybe_uninit";

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:449 bottom_value
  bottom_value(_1: Body): MaybeUninitializedPlacesDomain {
    // bottom = initialized (`initialize_start_block` overwrites this on first entry)
    return MixedBitSet.new_empty<MovePathIndex>(this.move_data().move_paths.length);
  }

  // sets state bits for Arg places
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:455 initialize_start_block
  initialize_start_block(_1: Body, state: MaybeUninitializedPlacesDomain): void {
    // set all bits to 1 (uninit) before gathering counter-evidence
    MixedBitSet.insert_all(state);

    drop_flag_effects_for_function_entry(this.body, this.move_data_, (path, _s) => {
      // debug_assert!(s == DropFlagState::Present);
      MixedBitSet.remove(state, path);
    });
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:465 apply_primary_statement_effect
  apply_primary_statement_effect(state: MaybeUninitializedPlacesDomain, _statement: Statement, location: Location): void {
    drop_flag_effects_for_location(this.body, this.move_data_, location, (path, s) => MaybeUninitializedPlaces.update_bits(state, path, s));

    // Unlike in `MaybeInitializedPlaces` above, we don't need to change the state when a
    // mutable borrow occurs. Places cannot become uninitialized through a mutable reference.
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:479 get_terminator_edges
  override get_terminator_edges(_state: MaybeUninitializedPlacesDomain, terminator: Terminator, location: Location): TerminatorEdges {
    if (this.skip_unreachable_unwind.contains(location.block)) {
      const kind = terminator.kind;
      if (kind.$ !== "Drop") return bug();
      const { target, unwind } = kind;
      assert_matches(unwind, unwind.$ === "Cleanup", "mir::UnwindAction::Cleanup(_)", (u) => debug_UnwindAction(u, PLAIN));
      return { $: "Single", _0: target };
    } else {
      return terminator.edges();
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:494 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: MaybeUninitializedPlacesDomain, _terminator: Terminator, location: Location): void {
    drop_flag_effects_for_location(this.body, this.move_data_, location, (path, s) => MaybeUninitializedPlaces.update_bits(state, path, s));
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:505 apply_call_return_effect
  override apply_call_return_effect(state: MaybeUninitializedPlacesDomain, _block: BasicBlock, return_places: CallReturnPlaces): void {
    CallReturnPlaces.for_each(return_places, (place) => {
      // when a call returns successfully, that means we need to set
      // the bits for that dest_place to 0 (initialized).
      on_lookup_result_bits(this.move_data(), this.move_data().rev_lookup.find(place.as_ref()), (mpi) => {
        GK_MaybeUninit.kill(state, mpi);
      });
    });
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:524 get_switch_int_data
  override get_switch_int_data(block: BasicBlock, targets: SwitchTargets, discr: Operand): MaybePlacesSwitchIntData | undefined {
    if (!this.tcx.sess.opts.unstable_opts.precise_enum_drop_elaboration) {
      return undefined;
    }

    if (!this.mark_inactive_variants_as_uninit_) {
      return undefined;
    }

    return MaybePlacesSwitchIntData.new(this.tcx, this.body, block, targets, discr);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:541 apply_switch_int_edge_effect
  override apply_switch_int_edge_effect(
    state: MaybeUninitializedPlacesDomain,
    data: MaybePlacesSwitchIntData,
    target_idx: SwitchTargetIndex,
  ): void {
    let inactive_variants: InactiveVariants;
    switch (target_idx.$) {
      case "Normal":
        inactive_variants = { $: "Active", _0: data.variants[target_idx._0]! };
        break;
      case "Otherwise":
        inactive_variants = { $: "Inactives", _0: [...data.variants] };
        break;
    }

    // Mark all move paths that correspond to variants other than this one as maybe
    // uninitialized (in reality, they are *definitely* uninitialized).
    on_all_inactive_variants(this.move_data_, data.enum_place, inactive_variants, (mpi) => GK_MaybeUninit.gen_(state, mpi));
  }
}

/// There can be many more `MovePathIndex` than there are locals in a MIR body.
/// We use a mixed bitset to avoid paying too high a memory footprint.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:440 MaybeUninitializedPlacesDomain
export type MaybeUninitializedPlacesDomain = MixedBitSet<MovePathIndex>;

/// `EverInitializedPlaces` tracks all initializations of locals that may have
/// occurred upon reaching a particular point in the control flow for a
/// function, without an intervening `StorageDead`.
///
/// This dataflow is used to determine if an immutable local variable may
/// be assigned to.
///
/// For example, in code like the following, we have corresponding
/// dataflow information shown in the right-hand comments.
///
/// ```rust
/// struct S;
/// #[rustfmt::skip]
/// fn foo(p: bool) {                           // ever-init:
///                                             // {p,           }
///     let a = S; let mut b = S; let c; let d; // {p, a, b,     }
///
///     if p {
///         drop(a);                            // {p, a, b,     }
///         b = S;                              // {p, a, b,     }
///
///     } else {
///         drop(b);                            // {p, a, b,     }
///         d = S;                              // {p, a, b,    d}
///
///     }                                       // {p, a, b,    d}
///
///     c = S;                                  // {p, a, b, c, d}
/// }
/// ```
// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:595 EverInitializedPlaces
export class EverInitializedPlaces extends AnalysisBase<EverInitializedPlacesDomain> implements HasMoveData {
  constructor(
    public body: Body,
    public move_data_: MoveData,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:601 new
  static new(body: Body, move_data: MoveData): EverInitializedPlaces {
    return new EverInitializedPlaces(body, move_data);
  }

  /// Whether the init of `local` at `init` can reach `target` via a path that doesn't pass
  /// through a `StorageDead(local)`. Mirrors the gen/kill structure of `EverInitializedPlaces`.
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:609 init_reaches_location
  static init_reaches_location(body: Body, local: Local, init: Init, target: Location): boolean {
    let init_loc: Location;
    switch (init.location.$) {
      // Arguments are initialized on entry, and `StorageDead` is never emitted for them, so
      // they reach every location.
      case "Argument":
        return true;
      case "Statement":
        init_loc = init.location._0;
        break;
    }

    // Worklist of locations to walk forward from, seeded with the location(s) following `init`.
    const queue: Location[] = [];

    const basic_blocks = body.basic_blocks.deref();
    const init_block_data = basic_blocks[init_loc.block]!;
    if (init_loc.statement_index < init_block_data.statements.length) {
      // This case mirrors `apply_primary_statement_effect`.
      queue.push(init_loc.successor_within_block());
    } else if (init.kind === "NonPanicPathOnly") {
      // This case mirrors `apply_call_return_effect`.
      const edges = init_block_data.terminator_().edges();
      if (edges.$ !== "AssignOnReturn") {
        return bug("`NonPanicPathOnly` should only be seen on terminators with return edges");
      }
      queue.push(...edges.return_.map(BasicBlock.start_location));
    } else {
      // This case mirrors `apply_primary_terminator_effect`.
      queue.push(...[...init_block_data.terminator_().successors()].map(BasicBlock.start_location));
    }

    const visited = new KeyedSet<Location>(Location_key);
    let loc: Location | undefined;
    outer: while ((loc = queue.pop()) !== undefined) {
      if (visited.has(loc)) {
        continue;
      }
      visited.add(loc);
      // Walk from `loc` to the end of its block, looking for `target` or a kill.
      const block_data = basic_blocks[loc.block]!;
      for (let statement_index = loc.statement_index; statement_index <= block_data.statements.length; statement_index++) {
        if (target.block === loc.block && target.statement_index === statement_index) {
          return true;
        }
        const stmt = block_data.statements[statement_index];
        if (stmt !== undefined && stmt.kind.$ === "StorageDead" && stmt.kind._0 === local) {
          continue outer;
        }
      }

      queue.push(...[...block_data.terminator_().successors()].map(BasicBlock.start_location));
    }
    return false;
  }

  // ---- impl HasMoveData for EverInitializedPlaces ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:669 move_data
  move_data(): MoveData {
    return this.move_data_;
  }

  // ---- impl Analysis for EverInitializedPlaces ----

  // type Domain = EverInitializedPlacesDomain;
  readonly Domain: Domain<EverInitializedPlacesDomain> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "ever_init";

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:681 bottom_value
  bottom_value(body: Body): EverInitializedPlacesDomain {
    // bottom = no initialized locals by default
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:686 initialize_start_block
  initialize_start_block(body: Body, state: EverInitializedPlacesDomain): void {
    for (const arg of body.args_iter()) {
      state.insert(arg);
    }
  }

  // #[instrument(skip(self, state), level = "debug")]
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:693 apply_primary_statement_effect
  apply_primary_statement_effect(state: EverInitializedPlacesDomain, stmt: Statement, location: Location): void {
    const move_data = this.move_data();
    const init_loc_map = move_data.init_loc_map;

    // Record inits of locals. Projections can be ignored.
    GK_EverInit.gen_all(
      state,
      filter_map(init_loc_map.index(location), (ii) => {
        const init_mpi = move_data.inits[ii]!.path;
        return move_data.move_paths[init_mpi]!.place.as_local();
      }),
    );

    // Kill on StorageDead, so that an immutable variable can
    // be reinitialized on the next iteration of the loop.
    if (stmt.kind.$ === "StorageDead") {
      const local = stmt.kind._0;
      GK_EverInit.kill(state, local);
    }
  }

  // #[instrument(skip(self, state, _terminator), level = "debug")]
  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:716 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: EverInitializedPlacesDomain, _terminator: Terminator, location: Location): void {
    const move_data = this.move_data();
    const init_loc_map = move_data.init_loc_map;

    // Record inits of locals. Projections can be ignored.
    GK_EverInit.gen_all(
      state,
      filter_map(init_loc_map.index(location), (ii) => {
        const init = move_data.inits[ii]!;
        if (init.kind !== "NonPanicPathOnly") {
          return move_data.move_paths[init.path]!.place.as_local();
        } else {
          return undefined;
        }
      }),
    );
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/initialized.rs:736 apply_call_return_effect
  override apply_call_return_effect(state: EverInitializedPlacesDomain, block: BasicBlock, _return_places: CallReturnPlaces): void {
    const move_data = this.move_data();
    const init_loc_map = move_data.init_loc_map;

    // Record inits of locals. Projections can be ignored.
    const call_loc = this.body.terminator_loc(block);
    GK_EverInit.gen_all(
      state,
      filter_map(init_loc_map.index(call_loc), (ii) => {
        const init = move_data.inits[ii]!;
        if (init.kind === "NonPanicPathOnly") {
          return move_data.move_paths[init.path]!.place.as_local();
        } else {
          return undefined;
        }
      }),
    );
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:674 EverInitializedPlacesDomain
export type EverInitializedPlacesDomain = DenseBitSet<Local>;

/** `Place == Place` (derived `PartialEq`: the local and the interned projection list). */
function Place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** The key of a `Location` in an `FxIndexSet<Location>` (derived `Hash` + `Eq`). */
function Location_key(loc: Location): string {
  return `${loc.block}:${loc.statement_index}`;
}

/** `state.contains(elem)` on a `MaybeReachable<MixedBitSet<_>>` (`MaybeReachable::contains`). */
function MaybeReachable_contains(state: MaybeReachable<MixedBitSet<MovePathIndex>>, elem: MovePathIndex): boolean {
  return MaybeReachable.contains(state, elem, BitSetExt_MixedBitSet as BitSetExt<MixedBitSet<MovePathIndex>, MovePathIndex>);
}

/** PORT: `iter.copied().filter_map(f)`, collected for `gen_all` (which takes an `IntoIterator`). */
function* filter_map<T, U>(it: Iterable<T>, f: (x: T) => U | undefined): Generator<U> {
  for (const x of it) {
    const y = f(x);
    if (y !== undefined) yield y;
  }
}
