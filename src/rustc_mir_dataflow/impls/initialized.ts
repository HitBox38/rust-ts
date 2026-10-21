// Port of compiler/rustc_mir_dataflow/src/impls/initialized.rs: DECLARED (lane dataflow-contract). Every fn is a stub
// for lane `dataflow-impls` (plan-m4 §5 wave 22).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub-df: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
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

import type { VariantIdx } from "../../rustc_abi/layout.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { unported } from "../../std/panic.ts";
import type { DropFlagState } from "../drop_flag_effects.ts";
import { DebugWithContext_Local, DebugWithContext_MovePathIndex } from "../framework/fmt.ts";
import type { MaybeReachable } from "../framework/lattice.ts";
import {
  AnalysisBase,
  type Domain,
  Domain_DenseBitSet,
  Domain_MaybeReachable,
  Domain_MixedBitSet,
  type SwitchTargetIndex,
} from "../framework/mod.ts";
import type { HasMoveData, Init, MoveData, MovePathIndex } from "../move_paths/mod.ts";
import type {
  BasicBlock,
  Body,
  CallReturnPlaces,
  Local,
  Location,
  MixedBitSet,
  Operand,
  Place,
  Statement,
  SwitchTargets,
  Terminator,
  TerminatorEdges,
} from "../pending.ts";

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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:38 new (lane dataflow-impls)
  static new(_tcx: TyCtxt, _body: Body, _block: BasicBlock, _targets: SwitchTargets, _discr: Operand): MaybePlacesSwitchIntData | undefined {
    return unported("rustc_mir_dataflow::impls::initialized::MaybePlacesSwitchIntData::new");
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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:148 new (lane dataflow-impls)
  static new(_tcx: TyCtxt, _body: Body, _move_data: MoveData): MaybeInitializedPlaces {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::new");
  }

  /// Ensures definitely inactive variants are excluded from the set of initialized places for
  /// blocks reached through an `otherwise` edge.
  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:162 exclude_inactive_in_otherwise (lane dataflow-impls)
  exclude_inactive_in_otherwise(): this {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::exclude_inactive_in_otherwise");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:167 skipping_unreachable_unwind (lane dataflow-impls)
  skipping_unreachable_unwind(): this {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::skipping_unreachable_unwind");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:172 is_unwind_dead (lane dataflow-impls)
  is_unwind_dead(_place: Place, _state: MaybeReachable<MixedBitSet<MovePathIndex>>): boolean {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::is_unwind_dead");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:188 update_bits (lane dataflow-impls)
  static update_bits(_state: MaybeReachable<MixedBitSet<MovePathIndex>>, _path: MovePathIndex, _dfstate: DropFlagState): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::update_bits");
  }

  // ---- impl HasMoveData for MaybeInitializedPlaces ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:201 move_data (lane dataflow-impls)
  move_data(): MoveData {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::move_data");
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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:215 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): MaybeReachable<MixedBitSet<MovePathIndex>> {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:220 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: MaybeReachable<MixedBitSet<MovePathIndex>>): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:229 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: MaybeReachable<MixedBitSet<MovePathIndex>>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::apply_primary_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:253 get_terminator_edges (lane dataflow-impls)
  override get_terminator_edges(
    _state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _terminator: Terminator,
    _location: Location,
  ): TerminatorEdges {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::get_terminator_edges");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:274 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(
    _state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _terminator: Terminator,
    _location: Location,
  ): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:285 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(
    _state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _block: BasicBlock,
    _return_places: CallReturnPlaces,
  ): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::apply_call_return_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:304 get_switch_int_data (lane dataflow-impls)
  override get_switch_int_data(_block: BasicBlock, _targets: SwitchTargets, _discr: Operand): MaybePlacesSwitchIntData | undefined {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::get_switch_int_data");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:317 apply_switch_int_edge_effect (lane dataflow-impls)
  override apply_switch_int_edge_effect(
    _state: MaybeReachable<MixedBitSet<MovePathIndex>>,
    _data: MaybePlacesSwitchIntData,
    _target_idx: SwitchTargetIndex,
  ): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeInitializedPlaces::apply_switch_int_edge_effect");
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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:390 new (lane dataflow-impls)
  static new(_tcx: TyCtxt, _body: Body, _move_data: MoveData): MaybeUninitializedPlaces {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::new");
  }

  /// Causes inactive enum variants to be marked as "maybe uninitialized" after a switch on an
  /// enum discriminant.
  ///
  /// This is correct in a vacuum but is not the default because it causes problems in the borrow
  /// checker, where this information gets propagated along `FakeEdge`s.
  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:407 mark_inactive_variants_as_uninit (lane dataflow-impls)
  mark_inactive_variants_as_uninit(): this {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::mark_inactive_variants_as_uninit");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:412 skipping_unreachable_unwind (lane dataflow-impls)
  skipping_unreachable_unwind(_unreachable_unwind: DenseBitSet<BasicBlock>): this {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::skipping_unreachable_unwind");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:420 update_bits (lane dataflow-impls)
  static update_bits(_state: MaybeUninitializedPlacesDomain, _path: MovePathIndex, _dfstate: DropFlagState): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::update_bits");
  }

  // ---- impl HasMoveData for MaybeUninitializedPlaces ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:433 move_data (lane dataflow-impls)
  move_data(): MoveData {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::move_data");
  }

  // ---- impl Analysis for MaybeUninitializedPlaces ----

  // type Domain = MaybeUninitializedPlacesDomain;
  readonly Domain: Domain<MaybeUninitializedPlacesDomain> = Domain_MixedBitSet(DebugWithContext_MovePathIndex);

  // type SwitchIntData = MaybePlacesSwitchIntData<'tcx>;

  readonly NAME = "maybe_uninit";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:449 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): MaybeUninitializedPlacesDomain {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:455 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: MaybeUninitializedPlacesDomain): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:465 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: MaybeUninitializedPlacesDomain, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::apply_primary_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:479 get_terminator_edges (lane dataflow-impls)
  override get_terminator_edges(_state: MaybeUninitializedPlacesDomain, _terminator: Terminator, _location: Location): TerminatorEdges {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::get_terminator_edges");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:494 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: MaybeUninitializedPlacesDomain, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:505 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: MaybeUninitializedPlacesDomain, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::apply_call_return_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:524 get_switch_int_data (lane dataflow-impls)
  override get_switch_int_data(_block: BasicBlock, _targets: SwitchTargets, _discr: Operand): MaybePlacesSwitchIntData | undefined {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::get_switch_int_data");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:541 apply_switch_int_edge_effect (lane dataflow-impls)
  override apply_switch_int_edge_effect(
    _state: MaybeUninitializedPlacesDomain,
    _data: MaybePlacesSwitchIntData,
    _target_idx: SwitchTargetIndex,
  ): void {
    return unported("rustc_mir_dataflow::impls::initialized::MaybeUninitializedPlaces::apply_switch_int_edge_effect");
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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:601 new (lane dataflow-impls)
  static new(_body: Body, _move_data: MoveData): EverInitializedPlaces {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::new");
  }

  /// Whether the init of `local` at `init` can reach `target` via a path that doesn't pass
  /// through a `StorageDead(local)`. Mirrors the gen/kill structure of `EverInitializedPlaces`.
  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:609 init_reaches_location (lane dataflow-impls)
  static init_reaches_location(_body: Body, _local: Local, _init: Init, _target: Location): boolean {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::init_reaches_location");
  }

  // ---- impl HasMoveData for EverInitializedPlaces ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:669 move_data (lane dataflow-impls)
  move_data(): MoveData {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::move_data");
  }

  // ---- impl Analysis for EverInitializedPlaces ----

  // type Domain = EverInitializedPlacesDomain;
  readonly Domain: Domain<EverInitializedPlacesDomain> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "ever_init";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:681 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): EverInitializedPlacesDomain {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:686 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: EverInitializedPlacesDomain): void {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::initialize_start_block");
  }

  // #[instrument(skip(self, state), level = "debug")]
  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:693 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: EverInitializedPlacesDomain, _stmt: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::apply_primary_statement_effect");
  }

  // #[instrument(skip(self, state, _terminator), level = "debug")]
  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:716 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: EverInitializedPlacesDomain, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/initialized.rs:736 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: EverInitializedPlacesDomain, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::initialized::EverInitializedPlaces::apply_call_return_effect");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/initialized.rs:674 EverInitializedPlacesDomain
export type EverInitializedPlacesDomain = DenseBitSet<Local>;
