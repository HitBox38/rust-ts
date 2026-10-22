// Port of compiler/rustc_borrowck/src/dataflow.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `Borrowck` and `Borrows` implement `rustc_mir_dataflow::Analysis`: hand classes extending `AnalysisBase`
// (dataflow-contract D5); `type Domain` / `const NAME` are the `Domain` descriptor / `NAME` members.
// PORT: `impl JoinSemiLattice for BorrowckDomain` is the impl table `JoinSemiLattice_BorrowckDomain`; its `eq` is the
// derived `PartialEq` (`BorrowckDomain_eq`). `Clone_BorrowckDomain` is the derived `Clone` (`clone_from` copies each
// field in place: domains are changed in place, dataflow-contract decision 4). `impl<C> DebugWithContext<C> for
// BorrowIndex {}` (only provided methods) is `DebugWithContext_BorrowIndex`.
import { DenseBitSet_eq, MixedBitSet, MixedBitSet_eq } from "../rustc_index/bit_set.ts";
import type { BasicBlock, Body, CallReturnPlaces, Location, Place, Statement, Terminator } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DebugWithContext_impl } from "../rustc_mir_dataflow/framework/fmt.ts";
import type { JoinSemiLattice } from "../rustc_mir_dataflow/framework/lattice.ts";
import { AnalysisBase, type Clone, type Domain, Domain_MixedBitSet, Domain_of } from "../rustc_mir_dataflow/framework/mod.ts";
import type { EverInitializedPlaces, MaybeUninitializedPlaces } from "../rustc_mir_dataflow/impls/mod.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { unported } from "../std/panic.ts";
import type { BorrowSet } from "./borrow_set.gen.ts";
import {
  type BorrowckDomain,
  BorrowIndex,
  type BorrowsDomain,
  clone_BorrowckDomain,
  debug_BorrowckDomain,
  debug_BorrowIndex,
  OutOfScopePrecomputer,
  PoloniusOutOfScopePrecomputer,
} from "./dataflow.gen.ts";
import type { RegionInferenceContext } from "./region_infer/region_context.gen.ts";
export * from "./dataflow.gen.ts";

/** `impl<C> DebugWithContext<C> for BorrowIndex {}` (dataflow.rs:571): the provided methods only. */
export const DebugWithContext_BorrowIndex = DebugWithContext_impl<BorrowIndex, unknown>((a, b) => a === b, debug_BorrowIndex);

/** The derived `PartialEq` of `BorrowckDomain`. */
export function BorrowckDomain_eq(a: BorrowckDomain, b: BorrowckDomain): boolean {
  return MixedBitSet_eq(a.borrows, b.borrows) && MixedBitSet_eq(a.uninits, b.uninits) && DenseBitSet_eq(a.ever_inits, b.ever_inits);
}

/** The derived `Clone` of `BorrowckDomain`. */
export const Clone_BorrowckDomain: Clone<BorrowckDomain> = {
  clone: clone_BorrowckDomain,
  clone_from(self: BorrowckDomain, source: BorrowckDomain): void {
    MixedBitSet.clone_from(self.borrows, source.borrows);
    MixedBitSet.clone_from(self.uninits, source.uninits);
    self.ever_inits.clone_from(source.ever_inits);
  },
};

// rustc-type: compiler/rustc_borrowck/src/dataflow.rs:19 Borrowck
/// The results of the dataflow analyses used by the borrow checker.
export class Borrowck extends AnalysisBase<BorrowckDomain> {
  constructor(
    public borrows: Borrows,
    public uninits: MaybeUninitializedPlaces,
    public ever_inits: EverInitializedPlaces,
  ) {
    super();
  }

  // impl<'a, 'tcx> Analysis<'tcx> for Borrowck<'a, 'tcx>
  // type Domain = BorrowckDomain;
  readonly Domain: Domain<BorrowckDomain> = Domain_of(
    Clone_BorrowckDomain,
    JoinSemiLattice_BorrowckDomain,
    DebugWithContext_impl<BorrowckDomain, unknown>(BorrowckDomain_eq, debug_BorrowckDomain),
  );

  readonly NAME = "borrowck";

  // stub: compiler/rustc_borrowck/src/dataflow.rs:30 bottom_value (lane bck-core)
  bottom_value(body: Body): BorrowckDomain {
    return unported("rustc_borrowck::dataflow::Borrowck::bottom_value");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:38 initialize_start_block (lane bck-core)
  initialize_start_block(_body: Body, _state: BorrowckDomain): void {
    return unported("rustc_borrowck::dataflow::Borrowck::initialize_start_block");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:43 apply_early_statement_effect (lane bck-core)
  override apply_early_statement_effect(state: BorrowckDomain, stmt: Statement, loc: Location): void {
    return unported("rustc_borrowck::dataflow::Borrowck::apply_early_statement_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:54 apply_primary_statement_effect (lane bck-core)
  apply_primary_statement_effect(state: BorrowckDomain, stmt: Statement, loc: Location): void {
    return unported("rustc_borrowck::dataflow::Borrowck::apply_primary_statement_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:65 apply_early_terminator_effect (lane bck-core)
  override apply_early_terminator_effect(state: BorrowckDomain, term: Terminator, loc: Location): void {
    return unported("rustc_borrowck::dataflow::Borrowck::apply_early_terminator_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:76 apply_primary_terminator_effect (lane bck-core)
  override apply_primary_terminator_effect(state: BorrowckDomain, term: Terminator, loc: Location): void {
    return unported("rustc_borrowck::dataflow::Borrowck::apply_primary_terminator_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:87 apply_call_return_effect (lane bck-core)
  override apply_call_return_effect(_state: BorrowckDomain, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_borrowck::dataflow::Borrowck::apply_call_return_effect");
  }
}

// impl JoinSemiLattice for BorrowckDomain
export const JoinSemiLattice_BorrowckDomain: JoinSemiLattice<BorrowckDomain> = {
  eq: BorrowckDomain_eq,
  // stub: compiler/rustc_borrowck/src/dataflow.rs:99 join (lane bck-core)
  join(self: BorrowckDomain, _other: BorrowckDomain): boolean {
    return unported("rustc_borrowck::dataflow::BorrowckDomain::join");
  },
};

declare module "./dataflow.gen.ts" {
  interface OutOfScopePrecomputer {
    // dataflow.rs:163 (lane bck-core)
    precompute_borrows_out_of_scope(borrow_index: BorrowIndex, borrow_region: RegionVid, first_location: Location): void;
  }
  namespace OutOfScopePrecomputer {
    // dataflow.rs:142 (lane bck-core)
    function compute(body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Map<Location, BorrowIndex[]>;
  }
  interface PoloniusOutOfScopePrecomputer {
    // dataflow.rs:281 (lane bck-core)
    precompute_loans_out_of_scope(loan_idx: BorrowIndex, loan_issued_at: Location): void;
    // dataflow.rs:341 (lane bck-core)
    loan_kill_location(loan_idx: BorrowIndex, loan_issued_at: Location, block: BasicBlock, start: number, end: number): Location | undefined;
  }
  namespace PoloniusOutOfScopePrecomputer {
    // dataflow.rs:256 (lane bck-core)
    function compute(body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Map<Location, BorrowIndex[]>;
  }
}

// stub: compiler/rustc_borrowck/src/dataflow.rs:142 compute (lane bck-core)
(OutOfScopePrecomputer as unknown as { compute: typeof OutOfScopePrecomputer.compute }).compute = function (
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  return unported("rustc_borrowck::dataflow::OutOfScopePrecomputer::compute");
};

// stub: compiler/rustc_borrowck/src/dataflow.rs:163 precompute_borrows_out_of_scope (lane bck-core)
OutOfScopePrecomputer.prototype.precompute_borrows_out_of_scope = function (
  this: OutOfScopePrecomputer,
  borrow_index: BorrowIndex,
  borrow_region: RegionVid,
  first_location: Location,
): void {
  return unported("rustc_borrowck::dataflow::OutOfScopePrecomputer::precompute_borrows_out_of_scope");
};

// This is `pub` because it's used by unstable external borrowck data users, see `consumers.rs`.
// stub: compiler/rustc_borrowck/src/dataflow.rs:238 calculate_borrows_out_of_scope_at_location (lane bck-core)
export function calculate_borrows_out_of_scope_at_location(
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  return unported("rustc_borrowck::dataflow::calculate_borrows_out_of_scope_at_location");
}

// stub: compiler/rustc_borrowck/src/dataflow.rs:256 compute (lane bck-core)
(PoloniusOutOfScopePrecomputer as unknown as { compute: typeof PoloniusOutOfScopePrecomputer.compute }).compute = function (
  body: Body,
  regioncx: RegionInferenceContext,
  borrow_set: BorrowSet,
): Map<Location, BorrowIndex[]> {
  return unported("rustc_borrowck::dataflow::PoloniusOutOfScopePrecomputer::compute");
};

/// Loans are in scope while they are live: whether they are contained within any live region.
/// In the location-insensitive analysis, a loan will be contained in a region if the issuing
/// region can reach it in the subset graph. So this is a reachability problem.
// stub: compiler/rustc_borrowck/src/dataflow.rs:281 precompute_loans_out_of_scope (lane bck-core)
PoloniusOutOfScopePrecomputer.prototype.precompute_loans_out_of_scope = function (
  this: PoloniusOutOfScopePrecomputer,
  loan_idx: BorrowIndex,
  loan_issued_at: Location,
): void {
  return unported("rustc_borrowck::dataflow::PoloniusOutOfScopePrecomputer::precompute_loans_out_of_scope");
};

/// Returns the lowest statement in `start..=end`, where the loan goes out of scope, if any.
/// This is the statement where the issuing region can't reach any of the regions that are live
/// at this point.
// stub: compiler/rustc_borrowck/src/dataflow.rs:341 loan_kill_location (lane bck-core)
PoloniusOutOfScopePrecomputer.prototype.loan_kill_location = function (
  this: PoloniusOutOfScopePrecomputer,
  loan_idx: BorrowIndex,
  loan_issued_at: Location,
  block: BasicBlock,
  start: number,
  end: number,
): Location | undefined {
  return unported("rustc_borrowck::dataflow::PoloniusOutOfScopePrecomputer::loan_kill_location");
};

// rustc-type: compiler/rustc_borrowck/src/dataflow.rs:126 Borrows
/// `Borrows` stores the data used in the analyses that track the flow
/// of borrows.
///
/// It uniquely identifies every borrow (`Rvalue::Ref`) by a
/// `BorrowIndex`, and maps each such index to a `BorrowData`
/// describing the borrow. These indexes are used for representing the
/// borrows in compact bitvectors.
export class Borrows extends AnalysisBase<BorrowsDomain> {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public borrow_set: BorrowSet,
    public borrows_out_of_scope_at_location: Map<Location, BorrowIndex[]>,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:381 new (lane bck-core)
  static new(tcx: TyCtxt, body: Body, regioncx: RegionInferenceContext, borrow_set: BorrowSet): Borrows {
    return unported("rustc_borrowck::dataflow::Borrows::new");
  }

  /// Add all borrows to the kill set, if those borrows are out of scope at `location`.
  /// That means they went out of a nonlexical scope
  // stub: compiler/rustc_borrowck/src/dataflow.rs:398 kill_loans_out_of_scope_at_location (lane bck-core)
  kill_loans_out_of_scope_at_location(state: BorrowsDomain, location: Location): void {
    return unported("rustc_borrowck::dataflow::Borrows::kill_loans_out_of_scope_at_location");
  }

  /// Kill any borrows that conflict with `place`.
  // stub: compiler/rustc_borrowck/src/dataflow.rs:420 kill_borrows_on_place (lane bck-core)
  kill_borrows_on_place(state: BorrowsDomain, place: Place): void {
    return unported("rustc_borrowck::dataflow::Borrows::kill_borrows_on_place");
  }

  // impl<'tcx> rustc_mir_dataflow::Analysis<'tcx> for Borrows<'_, 'tcx>
  // type Domain = BorrowsDomain;
  readonly Domain: Domain<BorrowsDomain> = Domain_MixedBitSet(DebugWithContext_BorrowIndex);

  readonly NAME = "borrows";

  // stub: compiler/rustc_borrowck/src/dataflow.rs:475 bottom_value (lane bck-core)
  bottom_value(_0: Body): BorrowsDomain {
    return unported("rustc_borrowck::dataflow::Borrows::bottom_value");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:480 initialize_start_block (lane bck-core)
  initialize_start_block(_0: Body, _1: BorrowsDomain): void {
    return unported("rustc_borrowck::dataflow::Borrows::initialize_start_block");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:485 apply_early_statement_effect (lane bck-core)
  override apply_early_statement_effect(state: BorrowsDomain, _statement: Statement, location: Location): void {
    return unported("rustc_borrowck::dataflow::Borrows::apply_early_statement_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:494 apply_primary_statement_effect (lane bck-core)
  apply_primary_statement_effect(state: BorrowsDomain, stmt: Statement, location: Location): void {
    return unported("rustc_borrowck::dataflow::Borrows::apply_primary_statement_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:544 apply_early_terminator_effect (lane bck-core)
  override apply_early_terminator_effect(state: BorrowsDomain, _terminator: Terminator, location: Location): void {
    return unported("rustc_borrowck::dataflow::Borrows::apply_early_terminator_effect");
  }

  // stub: compiler/rustc_borrowck/src/dataflow.rs:553 apply_primary_terminator_effect (lane bck-core)
  override apply_primary_terminator_effect(state: BorrowsDomain, terminator: Terminator, _location: Location): void {
    return unported("rustc_borrowck::dataflow::Borrows::apply_primary_terminator_effect");
  }
}
