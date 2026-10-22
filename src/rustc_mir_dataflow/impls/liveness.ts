// Port of compiler/rustc_mir_dataflow/src/impls/liveness.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls).
//
// Notes:
// - `MaybeLiveLocals` (unit struct) and `MaybeTransitiveLiveLocals` extend `AnalysisBase<DenseBitSet<Local>>` with
//   `Direction = Backward`; the unit value `MaybeLiveLocals` is `new MaybeLiveLocals()`.
// - `LivenessTransferFunction<'a, I>(pub &'a mut I)` with `I: GenKill<Local>` keeps `_0: I` and takes the impl table
//   `I_: GenKill<I, Local>` last (PORTING §5 trait tables); `YieldResumeEffect(&mut DenseBitSet<Local>)` is `_0`.
//   Both extend rustc_middle mir/visit.ts's `Visitor` (D4).
// - `DefUse` is a fieldless enum (string union + companion holding `apply` / `for_place`).

import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { unreachable } from "../../std/panic.ts";
import { Backward, type Direction } from "../framework/direction.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet, type GenKill, GenKill_DenseBitSet } from "../framework/mod.ts";
import {
  type BasicBlock,
  type Body,
  CallReturnPlaces,
  type Local,
  Location,
  type Place,
  Place_from_Local,
  Rvalue,
  type Statement,
  StatementKind,
  type Terminator,
} from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";

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

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:32 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = not live
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:37 initialize_start_block
  initialize_start_block(_1: Body, _2: DenseBitSet<Local>): void {
    // No variables are live until we observe a use
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:41 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, statement: Statement, location: Location): void {
    new LivenessTransferFunction(state, GenKill_DenseBitSet<Local>()).visit_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:50 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, location: Location): void {
    new LivenessTransferFunction(state, GenKill_DenseBitSet<Local>()).visit_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:59 apply_call_return_effect
  override apply_call_return_effect(state: DenseBitSet<Local>, _block: BasicBlock, return_places: CallReturnPlaces): void {
    if (return_places.$ === "Yield") {
      const resume_place = return_places._0;
      new YieldResumeEffect(state).visit_place(
        resume_place,
        { $: "MutatingUse", _0: "Yield" },
        Location.START,
      );
    } else {
      CallReturnPlaces.for_each(return_places, (place) => {
        const local = place.as_local();
        if (local !== undefined) {
          GenKill_DenseBitSet<Local>().kill(state, local);
        }
      });
    }
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:81 LivenessTransferFunction
export class LivenessTransferFunction<I> extends Visitor {
  constructor(
    public _0: I,
    /** `I: GenKill<Local>`. */
    public I_: GenKill<I, Local>,
  ) {
    super();
  }

  // ---- impl Visitor for LivenessTransferFunction ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:87 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    if (context.$ === "MutatingUse" && context._0 === "Yield") {
      // The resume place is evaluated and assigned to only after coroutine resumes, so its
      // effect is handled separately in `call_resume_effect`.
      return;
    }

    switch (DefUse.for_place(place, context)) {
      case "Def": {
        if (context.$ === "MutatingUse" && (context._0 === "Call" || context._0 === "AsmOutput")) {
          // For the associated terminators, this is only a `Def` when the terminator
          // returns "successfully." As such, we handle this case separately in
          // `call_return_effect` above. However, if the place looks like `*_5`, this is
          // still unconditionally a use of `_5`.
        } else {
          this.I_.kill(this._0, place.local);
        }
        break;
      }
      case "Use":
        this.I_.gen_(this._0, place.local);
        break;
      case "PartialWrite":
      case "NonUse":
        break;
    }

    this.visit_projection(place.as_ref(), context, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:115 visit_local
  override visit_local(local: Local, context: PlaceContext, _2: Location): void {
    DefUse.apply(this._0, Place_from_Local(local), context, this.I_);
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/liveness.rs:120 YieldResumeEffect
class YieldResumeEffect extends Visitor {
  constructor(public _0: DenseBitSet<Local>) {
    super();
  }

  // ---- impl Visitor for YieldResumeEffect ----

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:123 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    DefUse.apply(this._0, place, context, GenKill_DenseBitSet<Local>());
    this.visit_projection(place.as_ref(), context, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:128 visit_local
  override visit_local(local: Local, context: PlaceContext, _2: Location): void {
    DefUse.apply(this._0, Place_from_Local(local), context, GenKill_DenseBitSet<Local>());
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
  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:145 apply
  apply<S>(state: S, place: Place, context: PlaceContext, S_: GenKill<S, Local>): void {
    switch (DefUse.for_place(place, context)) {
      case "Def":
        S_.kill(state, place.local);
        break;
      case "Use":
        S_.gen_(state, place.local);
        break;
      case "PartialWrite":
      case "NonUse":
        break;
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:153 for_place
  for_place(place: Place, context: PlaceContext): DefUse {
    switch (context.$) {
      case "NonUse":
        return "NonUse";

      case "MutatingUse":
        switch (context._0) {
          case "Call":
          case "Yield":
          case "AsmOutput":
          case "Store":
            // Treat derefs as a use of the base local. `*p = 4` is not a def of `p` but a use.
            if (place.is_indirect()) {
              return "Use";
            } else if (place.projection.length === 0) {
              return "Def";
            } else {
              return "PartialWrite";
            }

          // Setting the discriminant is not a use because it does no reading, but it is also not
          // a def because it does not overwrite the whole place
          case "SetDiscriminant":
            return place.is_indirect() ? "Use" : "PartialWrite";

          // All other contexts are uses...
          case "RawBorrow":
          case "Borrow":
          case "Drop":
            return "Use";

          case "Projection":
            return unreachable("A projection could be a def or a use and must be handled separately");
        }
        break;

      case "NonMutatingUse":
        switch (context._0) {
          case "RawBorrow":
          case "Copy":
          case "Inspect":
          case "Move":
          case "PlaceMention":
          case "FakeBorrow":
          case "SharedBorrow":
            return "Use";

          case "Projection":
            return unreachable("A projection could be a def or a use and must be handled separately");
        }
        break;
    }
    return unreachable(); // PORT: the match is exhaustive upstream
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
  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:219 new
  static new(always_live: DenseBitSet<Local>, debuginfo_locals: DenseBitSet<Local>): MaybeTransitiveLiveLocals {
    return new MaybeTransitiveLiveLocals(always_live, debuginfo_locals);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:226 can_be_removed_if_dead
  static can_be_removed_if_dead(
    stmt_kind: StatementKind,
    always_live: DenseBitSet<Local>,
    debuginfo_locals: DenseBitSet<Local>,
  ): Place | undefined {
    // Compute the place that we are storing to, if any
    let destination: Place | undefined;
    switch (stmt_kind.$) {
      case "Assign": {
        const [place, rvalue] = stmt_kind._0;
        destination =
          Rvalue.is_safe_to_remove(rvalue) &&
          // FIXME: We are not sure how we should represent this debugging information for some statements,
          // keep it for now.
          (!debuginfo_locals.contains(place.local) ||
            (place.as_local() !== undefined && StatementKind.as_debuginfo(stmt_kind) !== undefined))
            ? place
            : undefined;
        break;
      }
      case "SetDiscriminant": {
        const place = stmt_kind.place;
        destination = !debuginfo_locals.contains(place.local) ? place : undefined;
        break;
      }
      case "FakeRead":
      case "StorageLive":
      case "StorageDead":
      case "AscribeUserType":
      case "PlaceMention":
      case "Coverage":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        destination = undefined;
        break;
    }
    if (destination !== undefined && !destination.is_indirect() && !always_live.contains(destination.local)) {
      return destination;
    }
    return undefined;
  }

  // ---- impl Analysis for MaybeTransitiveLiveLocals ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);
  // type Direction = Backward;
  override readonly Direction: Direction = Backward;

  readonly NAME = "transitive liveness";

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:269 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    return new MaybeLiveLocals().bottom_value(body);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:273 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    new MaybeLiveLocals().initialize_start_block(body, state);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:277 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, statement: Statement, location: Location): void {
    // This is the one part of `MaybeTransitiveLiveLocals` that differs from `MaybeLiveLocals`.
    const destination = MaybeTransitiveLiveLocals.can_be_removed_if_dead(statement.kind, this.always_live, this.debuginfo_locals);
    if (destination !== undefined && !state.contains(destination.local)) {
      // This store is dead
      return;
    }

    new MaybeLiveLocals().apply_primary_statement_effect(state, statement, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:295 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, location: Location): void {
    new MaybeLiveLocals().apply_primary_terminator_effect(state, terminator, location);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/liveness.rs:304 apply_call_return_effect
  override apply_call_return_effect(state: DenseBitSet<Local>, block: BasicBlock, return_places: CallReturnPlaces): void {
    new MaybeLiveLocals().apply_call_return_effect(state, block, return_places);
  }
}
