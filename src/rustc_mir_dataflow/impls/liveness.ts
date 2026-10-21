// Port of compiler/rustc_mir_dataflow/src/impls/liveness.rs: DECLARED (lane dataflow-contract). Every fn is a stub for
// lane `dataflow-impls` (plan-m4 §5 wave 22).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub-df: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
// - `MaybeLiveLocals` (unit struct) and `MaybeTransitiveLiveLocals` extend `AnalysisBase<DenseBitSet<Local>>` with
//   `Direction = Backward`; `MaybeLiveLocals.bottom_value(body)` (the unit value) is `new MaybeLiveLocals().
//   bottom_value(body)`.
// - `LivenessTransferFunction<'a, I>(pub &'a mut I)` with `I: GenKill<Local>` keeps `_0: I` and takes the impl table
//   `I_: GenKill<I, Local>` last (PORTING §5 trait tables); `YieldResumeEffect(&mut DenseBitSet<Local>)` is `_0`.
// - PORT(contract): extends mir Visitor (pending mir-contract, D4): `LivenessTransferFunction` / `YieldResumeEffect`
//   override `visit_place` / `visit_local` of mir-contract's `Visitor` class; until it exists they are plain classes
//   (`self.visit_projection(..)` / `visit_statement` / `visit_terminator` come from it).
// - `DefUse` is a fieldless enum (string union + companion holding `apply` / `for_place`).

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { unported } from "../../std/panic.ts";
import { Backward, type Direction } from "../framework/direction.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet, type GenKill } from "../framework/mod.ts";
import type { BasicBlock, Body, CallReturnPlaces, Local, Location, Place, Statement, StatementKind, Terminator } from "../pending.ts";

// PORT(contract): pending mir-contract (mir/visit.rs `PlaceContext`).
type PlaceContext = { readonly __pending_mir: "PlaceContext" };

/// A [live-variable dataflow analysis][liveness].
///
/// This analysis considers references as being used only at the point of the
/// borrow. In other words, this analysis does not track uses because of references that already
/// exist. See [this `mir-dataflow` test][flow-test] for an example. You almost never want to use
/// this analysis without also looking at the results of [`MaybeBorrowedLocals`].
///
/// ## Field-(in)sensitivity
///
/// As the name suggests, this analysis is field insensitive. If a projection of a variable `x` is
/// assigned to (e.g. `x.0 = 42`), it does not "define" `x` as far as liveness is concerned. In fact,
/// such an assignment is currently marked as a "use" of `x` in an attempt to be maximally
/// conservative.
///
/// [`MaybeBorrowedLocals`]: super::MaybeBorrowedLocals
/// [flow-test]: https://github.com/rust-lang/rust/blob/a08c47310c7d49cbdc5d7afb38408ba519967ecd/src/test/ui/mir-dataflow/liveness-ptr.rs
/// [liveness]: https://en.wikipedia.org/wiki/Live_variable_analysis
// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:24 MaybeLiveLocals
export class MaybeLiveLocals extends AnalysisBase<DenseBitSet<Local>> {
  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);
  // type Direction = Backward;
  override readonly Direction: Direction = Backward;

  readonly NAME = "liveness";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:32 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:37 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:41 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::apply_primary_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:50 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:59 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: DenseBitSet<Local>, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeLiveLocals::apply_call_return_effect");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:81 LivenessTransferFunction
export class LivenessTransferFunction<I> {
  constructor(
    public _0: I,
    /** `I: GenKill<Local>`. */
    public I_: GenKill<I, Local>,
  ) {}

  // ---- impl Visitor for LivenessTransferFunction ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:87 visit_place (lane dataflow-impls)
  visit_place(_place: Place, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::LivenessTransferFunction::visit_place");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:115 visit_local (lane dataflow-impls)
  visit_local(_local: Local, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::LivenessTransferFunction::visit_local");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:120 YieldResumeEffect
class YieldResumeEffect {
  constructor(public _0: DenseBitSet<Local>) {}

  // ---- impl Visitor for YieldResumeEffect ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:123 visit_place (lane dataflow-impls)
  visit_place(_place: Place, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::YieldResumeEffect::visit_place");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:128 visit_local (lane dataflow-impls)
  visit_local(_local: Local, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::YieldResumeEffect::visit_local");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:133 DefUse
export type DefUse =
  /// Full write to the local.
  | "Def"
  /// Read of any part of the local.
  | "Use"
  /// Partial write to the local.
  | "PartialWrite"
  /// Non-use, like debuginfo.
  | "NonUse";

export const DefUse = {
  Def: "Def",
  Use: "Use",
  PartialWrite: "PartialWrite",
  NonUse: "NonUse",

  /** `state: &mut impl GenKill<Local>`: the impl table `S_` comes last. */
  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:145 apply (lane dataflow-impls)
  apply<S>(_state: S, _place: Place, _context: PlaceContext, _S_: GenKill<S, Local>): void {
    return unported("rustc_mir_dataflow::impls::liveness::DefUse::apply");
  },

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:153 for_place (lane dataflow-impls)
  for_place(_place: Place, _context: PlaceContext): DefUse {
    return unported("rustc_mir_dataflow::impls::liveness::DefUse::for_place");
  },
} as const;

/// Like `MaybeLiveLocals` (and layered on top of `MaybeLiveLocals`), but does not mark locals as
/// live if they are used in a dead assignment.
///
/// This is basically written for dead store elimination and nothing else.
///
/// All of the caveats of `MaybeLiveLocals` apply.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:209 MaybeTransitiveLiveLocals
export class MaybeTransitiveLiveLocals extends AnalysisBase<DenseBitSet<Local>> {
  constructor(
    public always_live: DenseBitSet<Local>,
    public debuginfo_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  /// The `always_live` set is the set of locals to which all stores should unconditionally be
  /// considered live.
  ///
  /// This should include at least all locals that are ever borrowed.
  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:219 new (lane dataflow-impls)
  static new(_always_live: DenseBitSet<Local>, _debuginfo_locals: DenseBitSet<Local>): MaybeTransitiveLiveLocals {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::new");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:226 can_be_removed_if_dead (lane dataflow-impls)
  static can_be_removed_if_dead(
    _stmt_kind: StatementKind,
    _always_live: DenseBitSet<Local>,
    _debuginfo_locals: DenseBitSet<Local>,
  ): Place | undefined {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::can_be_removed_if_dead");
  }

  // ---- impl Analysis for MaybeTransitiveLiveLocals ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);
  // type Direction = Backward;
  override readonly Direction: Direction = Backward;

  readonly NAME = "transitive liveness";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:269 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:273 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:277 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::apply_primary_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:295 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/liveness.rs:304 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: DenseBitSet<Local>, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::liveness::MaybeTransitiveLiveLocals::apply_call_return_effect");
  }
}

/** Keeps the module-private visitor referenced for the fill lane. */
export const _liveness_decls = { YieldResumeEffect };
