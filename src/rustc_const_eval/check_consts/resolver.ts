// Port of compiler/rustc_const_eval/src/check_consts/resolver.rs (lane mt-promote).
//
// PORT: `Q: Qualif` (`PhantomData<Q>`) is the impl table `Q_` (qualifs.ts header), stored in the field `_qualif`.
// PORT (plan-m4 D5): `impl Analysis for FlowSensitiveAnalysis` extends `AnalysisBase<State>`; `type Domain = State` is
// the descriptor `Domain_State` (its `Clone`, `JoinSemiLattice` and `DebugWithContext` impls below); `const NAME:
// &str = Q::ANALYSIS_NAME` is a getter reading `Q_`. `State` is a class (mutable domain value, changed in place).
//! Propagate `Qualif`s between locals and query the results.
//!
//! This contains the dataflow analysis used to track `Qualif`s on complex control-flow graphs.

import { MixedBitSet, MixedBitSet_eq } from "../../rustc_index/bit_set.ts";
import {
  type BasicBlock,
  type Body,
  CallReturnPlaces,
  type Local,
  type Location,
  type Operand,
  type Place,
  type Rvalue,
  type Statement,
  type Terminator,
  type BorrowKind,
} from "../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../rustc_middle/mir/visit.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { DebugWithContext_Local, DebugWithContext_MixedBitSet, type DebugWithContext } from "../../rustc_mir_dataflow/framework/fmt.ts";
import { JoinSemiLattice_MixedBitSet } from "../../rustc_mir_dataflow/framework/lattice.ts";
import { AnalysisBase, type Domain, Domain_of } from "../../rustc_mir_dataflow/framework/mod.ts";
import { type Debug, debug_struct, type Fmt } from "../../std/fmt.ts";
import type { ConstCx } from "./mod.ts";
import * as qualifs from "./qualifs.ts";
import type { Qualif } from "./qualifs.ts";

/** `DebugWithContext<C> for MixedBitSet<Local>` (the impl `State::fmt_with` / `fmt_diff_with` use). */
const MixedBitSet_Local: DebugWithContext<MixedBitSet<Local>, unknown> = DebugWithContext_MixedBitSet(DebugWithContext_Local);

/// A `Visitor` that propagates qualifs between locals. This defines the transfer function of
/// `FlowSensitiveAnalysis`.
///
/// To account for indirect assignments, data flow conservatively assumes that local becomes
/// qualified immediately after it is borrowed or its address escapes. The borrow must allow for
/// mutation, which includes shared borrows of places with interior mutability. The type of
/// borrowed place must contain the qualif.
// rustc-type: compiler/rustc_const_eval/src/check_consts/resolver.rs:25 TransferFunction
class TransferFunction extends Visitor {
  constructor(
    public ccx: ConstCx,
    public state: State,
    public _qualif: Qualif,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:35 new
  static new(Q_: Qualif, ccx: ConstCx, state: State): TransferFunction {
    return new TransferFunction(ccx, state, Q_);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:39 initialize_state
  initialize_state(): void {
    MixedBitSet.clear(this.state.qualif);
    MixedBitSet.clear(this.state.borrow);

    for (const arg of this.ccx.body.args_iter()) {
      const arg_ty = this.ccx.body.local_decls[arg]!.ty;
      if (this._qualif.in_any_value_of_ty(this.ccx, arg_ty)) {
        MixedBitSet.insert(this.state.qualif, arg);
      }
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:51 assign_qualif_direct
  assign_qualif_direct(place: Place, value_: boolean): void {
    let value = value_;
    // debug_assert!(!place.is_indirect());

    if (!value) {
      for (const [base, _elem] of place.iter_projections()) {
        const base_ty = base.ty(this.ccx.body, this.ccx.tcx);
        if (base_ty.ty.is_union() && this._qualif.in_any_value_of_ty(this.ccx, base_ty.ty)) {
          value = true;
          break;
        }
      }
    }

    const place_ref = place.as_ref();
    if (value) {
      const local = place_ref.local;
      MixedBitSet.insert(this.state.qualif, local);
    }

    // For now, we do not clear the qualif if a local is overwritten in full by
    // an unqualified rvalue (e.g. `y = 5`). This is to be consistent
    // with aggregates where we overwrite all fields with assignments, which would not
    // get this feature.
    else if (place_ref.projection.length === 0) {
      // self.state.qualif.remove(*local);
    } else {
      // _ => {}
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:81 apply_call_return_effect
  apply_call_return_effect(_block: BasicBlock, return_places: CallReturnPlaces): void {
    CallReturnPlaces.for_each(return_places, (place) => {
      // We cannot reason about another function's internals, so use conservative type-based
      // qualification for the result of a function call.
      const return_ty = place.ty(this.ccx.body, this.ccx.tcx).ty;
      const qualif = this._qualif.in_any_value_of_ty(this.ccx, return_ty);

      if (!place.is_indirect()) {
        this.assign_qualif_direct(place, qualif);
      }
    });
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:98 address_of_allows_mutation
  address_of_allows_mutation(): boolean {
    // Exact set of permissions granted by RawPtr is undecided. Conservatively assume that
    // it might allow mutation until resolution of #56604.
    return true;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:104 ref_allows_mutation
  ref_allows_mutation(kind: BorrowKind, place: Place): boolean {
    switch (kind.$) {
      case "Mut":
        return true;
      case "Shared":
      case "Fake":
        return this.shared_borrow_allows_mutation(place);
    }
  }

  /// `&` only allow mutation if the borrowed place is `!Freeze`.
  ///
  /// This assumes that it is UB to take the address of a struct field whose type is
  /// `Freeze`, then use pointer arithmetic to derive a pointer to a *different* field of
  /// that same struct whose type is `!Freeze`. If we decide that this is not UB, we will
  /// have to check the type of the borrowed **local** instead of the borrowed **place**
  /// below. See [rust-lang/unsafe-code-guidelines#134].
  ///
  /// [rust-lang/unsafe-code-guidelines#134]: https://github.com/rust-lang/unsafe-code-guidelines/issues/134
  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:122 shared_borrow_allows_mutation
  shared_borrow_allows_mutation(place: Place): boolean {
    return !place.ty(this.ccx.body, this.ccx.tcx).ty.is_freeze(this.ccx.tcx, this.ccx.typing_env);
  }

  // impl<'tcx, Q> Visitor<'tcx> for TransferFunction<'_, 'tcx, Q>

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:131 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    this.super_operand(operand, location);

    if (!this._qualif.IS_CLEARED_ON_MOVE) {
      return;
    }

    // If a local with no projections is moved from (e.g. `x` in `y = x`), record that
    // it no longer needs to be dropped.
    let local: Local | undefined;
    if (operand.$ === "Move" && (local = operand._0.as_local()) !== undefined) {
      // For backward compatibility with the MaybeMutBorrowedLocals used in an earlier
      // implementation we retain qualif if a local had been borrowed before. This might
      // not be strictly necessary since the local is no longer initialized.
      if (!MixedBitSet.contains(this.state.borrow, local)) {
        MixedBitSet.remove(this.state.qualif, local);
      }
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:152 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    const qualif = qualifs.in_rvalue(this._qualif, this.ccx, (l) => MixedBitSet.contains(this.state.qualif, l), rvalue);
    if (!place.is_indirect()) {
      this.assign_qualif_direct(place, qualif);
    }

    // We need to assign qualifs to the left-hand side before visiting `rvalue` since
    // qualifs can be cleared on move.
    this.super_assign(place, rvalue, location);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:169 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);

    switch (rvalue.$) {
      case "RawPtr": {
        const borrowed_place = rvalue._1;
        if (!borrowed_place.is_indirect() && this.address_of_allows_mutation()) {
          const place_ty = borrowed_place.ty(this.ccx.body, this.ccx.tcx).ty;
          if (this._qualif.in_any_value_of_ty(this.ccx, place_ty)) {
            MixedBitSet.insert(this.state.qualif, borrowed_place.local);
            MixedBitSet.insert(this.state.borrow, borrowed_place.local);
          }
        }
        break;
      }

      case "Ref": {
        const kind = rvalue._1;
        const borrowed_place = rvalue._2;
        if (!borrowed_place.is_indirect() && this.ref_allows_mutation(kind, borrowed_place)) {
          const place_ty = borrowed_place.ty(this.ccx.body, this.ccx.tcx).ty;
          if (this._qualif.in_any_value_of_ty(this.ccx, place_ty)) {
            MixedBitSet.insert(this.state.qualif, borrowed_place.local);
            MixedBitSet.insert(this.state.borrow, borrowed_place.local);
          }
        }
        break;
      }

      case "Reborrow": {
        const target = rvalue._0;
        const mutability = rvalue._1;
        const borrowed_place = rvalue._2;
        // A Reborrow allows mutation if it is Reborrow or if the CoerceShared target isn't
        // Freeze.
        if (!borrowed_place.is_indirect() && (Mutability.is_mut(mutability) || !target.is_freeze(this.ccx.tcx, this.ccx.typing_env))) {
          if (this._qualif.in_any_value_of_ty(this.ccx, target)) {
            MixedBitSet.insert(this.state.qualif, borrowed_place.local);
            MixedBitSet.insert(this.state.borrow, borrowed_place.local);
          }
        }
        break;
      }

      case "Cast":
      case "Use":
      case "CopyForDeref":
      case "ThreadLocalRef":
      case "Repeat":
      case "BinaryOp":
      case "UnaryOp":
      case "Discriminant":
      case "Aggregate":
      case "WrapUnsafeBinder":
        break;
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:220 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "StorageDead": {
        const local = kind._0;
        MixedBitSet.remove(this.state.qualif, local);
        MixedBitSet.remove(this.state.borrow, local);
        break;
      }
      default:
        this.super_statement(statement, location);
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:230 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // The effect of assignment to the return place in `TerminatorKind::Call` is not applied
    // here; that occurs in `apply_call_return_effect`.

    // We ignore borrow on drop because custom drop impls are not allowed in consts.
    // FIXME: Reconsider if accounting for borrows in drops is necessary for const drop.
    this.super_terminator(terminator, location);
  }
}

/// The dataflow analysis used to propagate qualifs on arbitrary CFGs.
// rustc-type: compiler/rustc_const_eval/src/check_consts/resolver.rs:241 FlowSensitiveAnalysis
export class FlowSensitiveAnalysis extends AnalysisBase<State> {
  constructor(
    public ccx: ConstCx,
    public _qualif: Qualif,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:250 new
  static new(Q_: Qualif, ccx: ConstCx): FlowSensitiveAnalysis {
    return new FlowSensitiveAnalysis(ccx, Q_);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:254 transfer_function
  transfer_function(state: State): TransferFunction {
    return TransferFunction.new(this._qualif, this.ccx, state);
  }

  // ---- impl Analysis for FlowSensitiveAnalysis ----

  // type Domain = State;
  readonly Domain: Domain<State> = Domain_State;

  // const NAME: &'static str = Q::ANALYSIS_NAME;
  get NAME(): string {
    return this._qualif.ANALYSIS_NAME;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:334 bottom_value
  bottom_value(body: Body): State {
    return new State(MixedBitSet.new_empty(body.local_decls.length), MixedBitSet.new_empty(body.local_decls.length));
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:341 initialize_start_block
  initialize_start_block(_body: Body, state: State): void {
    this.transfer_function(state).initialize_state();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:345 apply_primary_statement_effect
  apply_primary_statement_effect(state: State, statement: Statement, location: Location): void {
    this.transfer_function(state).visit_statement(statement, location);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:354 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: State, terminator: Terminator, location: Location): void {
    this.transfer_function(state).visit_terminator(terminator, location);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:363 apply_call_return_effect
  override apply_call_return_effect(state: State, block: BasicBlock, return_places: CallReturnPlaces): void {
    this.transfer_function(state).apply_call_return_effect(block, return_places);
  }
}

// #[derive(Debug, PartialEq, Eq)]
/// The state for the `FlowSensitiveAnalysis` dataflow analysis. This domain is likely homogeneous,
/// and has a big size, so we use a bitset that can be sparse (c.f. issue #134404).
// rustc-type: compiler/rustc_const_eval/src/check_consts/resolver.rs:262 State
export class State {
  constructor(
    /// Describes whether a local contains qualif.
    public qualif: MixedBitSet<Local>,
    /// Describes whether a local's address escaped and it might become qualified as a result an
    /// indirect mutation.
    public borrow: MixedBitSet<Local>,
  ) {}

  // impl Clone for State

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:271 clone
  clone(): State {
    return new State(MixedBitSet.clone(this.qualif), MixedBitSet.clone(this.borrow));
  }

  // Data flow engine when possible uses `clone_from` for domain values.
  // Providing an implementation will avoid some intermediate memory allocations.
  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:277 clone_from
  clone_from(other: State): void {
    MixedBitSet.clone_from(this.qualif, other.qualif);
    MixedBitSet.clone_from(this.borrow, other.borrow);
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:285 contains
  contains(local: Local): boolean {
    return MixedBitSet.contains(this.qualif, local);
  }
}

/** `#[derive(PartialEq)]` of `State`. */
export function State_eq(a: State, b: State): boolean {
  return MixedBitSet_eq(a.qualif, b.qualif) && MixedBitSet_eq(a.borrow, b.borrow);
}

/** `#[derive(Debug)]` of `State`. */
export const debug_State: Debug<State> = (v, f) =>
  debug_struct(f, "State", [
    ["qualif", MixedBitSet_Local.fmt(v.qualif, f)],
    ["borrow", MixedBitSet_Local.fmt(v.borrow, f)],
  ]);

/** `impl<C> DebugWithContext<C> for State`. */
export const DebugWithContext_State: DebugWithContext<State, unknown> = {
  eq: State_eq,
  fmt: debug_State,

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:291 fmt_with
  fmt_with(self: State, ctxt: unknown, f: Fmt): string {
    let out = "";
    out += "qualif: ";
    out += MixedBitSet_Local.fmt_with(self.qualif, ctxt, f);
    out += " borrow: ";
    out += MixedBitSet_Local.fmt_with(self.borrow, ctxt, f);
    return out;
  },

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:299 fmt_diff_with
  fmt_diff_with(self: State, old: State, ctxt: unknown, f: Fmt): string {
    if (State_eq(self, old)) {
      return "";
    }

    let out = "";
    if (!MixedBitSet_eq(self.qualif, old.qualif)) {
      out += "qualif: ";
      out += MixedBitSet_Local.fmt_diff_with(self.qualif, old.qualif, ctxt, f);
      out += "\n";
    }

    if (!MixedBitSet_eq(self.borrow, old.borrow)) {
      out += "borrow: ";
      out += MixedBitSet_Local.fmt_diff_with(self.borrow, old.borrow, ctxt, f);
      out += "\n";
    }

    return out;
  },
};

/** `impl JoinSemiLattice for State`. */
export const JoinSemiLattice_State = {
  eq: State_eq,

  // rustc: compiler/rustc_const_eval/src/check_consts/resolver.rs:321 join
  join(self: State, other: State): boolean {
    return JoinSemiLattice_MixedBitSet.join(self.qualif, other.qualif) || JoinSemiLattice_MixedBitSet.join(self.borrow, other.borrow);
  },
};

/** `impl Clone for State` as an impl table (PORT D5). */
const Clone_State = {
  clone: (self: State): State => self.clone(),
  clone_from: (self: State, source: State): void => self.clone_from(source),
};

/** The domain descriptor of `State` (PORT D5). */
export const Domain_State: Domain<State> = Domain_of<State>(Clone_State, JoinSemiLattice_State, DebugWithContext_State);
