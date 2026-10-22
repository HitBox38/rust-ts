// Port of compiler/rustc_borrowck/src/borrow_set.rs (lane borrowck-contract: declarations; fill lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `BorrowData`'s accessors share their names with its fields (`reserve_location`, `kind`, ...): the methods get a
// trailing `_` (`reserve_location_()`, ...), as `BorrowSet.locals_state_at_exit_()` (lib.ts header).
// PORT: `LocalsStateAtExit::build`'s fn-local `struct HasStorageDead(DenseBitSet<Local>)` and its `Visitor` impl are
// the module-level class `HasStorageDead` until the fill lane moves them inside `build`.
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Body, BorrowKind, Local, Location, Place, Rvalue } from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { unported } from "../std/panic.ts";
import * as gen from "./borrow_set.gen.ts";
import { BorrowData, BorrowSet, type TwoPhaseActivation } from "./borrow_set.gen.ts";
import type { BorrowIndex } from "./dataflow.gen.ts";
export * from "./borrow_set.gen.ts";

declare module "./borrow_set.gen.ts" {
  interface BorrowSet {
    // borrow_set.rs:86 (lane bck-core)
    iter(): Iterable<BorrowData>;
    // borrow_set.rs:91 (lane bck-core)
    locals_state_at_exit_(): LocalsStateAtExit;
    // borrow_set.rs:96 (lane bck-core)
    len(): number;
    // borrow_set.rs:100 (lane bck-core)
    iter_enumerated(): Iterable<[BorrowIndex, BorrowData]>;
    // borrow_set.rs:105 (lane bck-core)
    activations_at_location(location: Location): readonly BorrowIndex[];
    // borrow_set.rs:110 (lane bck-core)
    borrows_at_location(location: Location): readonly BorrowIndex[] | undefined;
    // borrow_set.rs:115 (lane bck-core)
    borrows_on_local(local: Local): Set<BorrowIndex> | undefined;
    // borrow_set.rs:123 (lane bck-core) `impl Index<BorrowIndex> for BorrowSet`
    index(index: BorrowIndex): BorrowData;
  }
  namespace BorrowSet {
    // borrow_set.rs:50 (lane bck-core)
    function build(tcx: TyCtxt, body: Body, locals_are_invalidated_at_exit: boolean, move_data: MoveData): BorrowSet;
  }
  interface BorrowData {
    // borrow_set.rs:156 (lane bck-core)
    reserve_location_(): Location;
    // borrow_set.rs:160 (lane bck-core)
    activation_location_(): TwoPhaseActivation;
    // borrow_set.rs:164 (lane bck-core)
    kind_(): BorrowKind;
    // borrow_set.rs:168 (lane bck-core)
    region_(): RegionVid;
    // borrow_set.rs:172 (lane bck-core)
    borrowed_place_(): Place;
    // borrow_set.rs:176 (lane bck-core)
    assigned_place_(): Place;
  }
}

// Public method to support Aquascope.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:50 build (lane bck-core)
(BorrowSet as unknown as { build: typeof BorrowSet.build }).build = function (
  tcx: TyCtxt,
  body: Body,
  locals_are_invalidated_at_exit: boolean,
  move_data: MoveData,
): BorrowSet {
  return unported("rustc_borrowck::borrow_set::BorrowSet::build");
};

// Public method to support Aquascope and Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:86 iter (lane bck-core)
BorrowSet.prototype.iter = function (this: BorrowSet): Iterable<BorrowData> {
  return unported("rustc_borrowck::borrow_set::BorrowSet::iter");
};

// Public method to support Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:91 locals_state_at_exit (lane bck-core)
BorrowSet.prototype.locals_state_at_exit_ = function (this: BorrowSet): LocalsStateAtExit {
  return unported("rustc_borrowck::borrow_set::BorrowSet::locals_state_at_exit");
};

// Public method to support Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:96 len (lane bck-core)
BorrowSet.prototype.len = function (this: BorrowSet): number {
  return unported("rustc_borrowck::borrow_set::BorrowSet::len");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:100 iter_enumerated (lane bck-core)
BorrowSet.prototype.iter_enumerated = function (this: BorrowSet): Iterable<[BorrowIndex, BorrowData]> {
  return unported("rustc_borrowck::borrow_set::BorrowSet::iter_enumerated");
};

// Public method to support Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:105 activations_at_location (lane bck-core)
BorrowSet.prototype.activations_at_location = function (this: BorrowSet, location: Location): readonly BorrowIndex[] {
  return unported("rustc_borrowck::borrow_set::BorrowSet::activations_at_location");
};

// Public method to support Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:110 borrows_at_location (lane bck-core)
BorrowSet.prototype.borrows_at_location = function (this: BorrowSet, location: Location): readonly BorrowIndex[] | undefined {
  return unported("rustc_borrowck::borrow_set::BorrowSet::borrows_at_location");
};

// Public method to support Creusot.
// stub: compiler/rustc_borrowck/src/borrow_set.rs:115 borrows_on_local (lane bck-core)
BorrowSet.prototype.borrows_on_local = function (this: BorrowSet, local: Local): Set<BorrowIndex> | undefined {
  return unported("rustc_borrowck::borrow_set::BorrowSet::borrows_on_local");
};

// impl<'tcx> Index<BorrowIndex> for BorrowSet<'tcx>
// stub: compiler/rustc_borrowck/src/borrow_set.rs:123 index (lane bck-core)
BorrowSet.prototype.index = function (this: BorrowSet, index: BorrowIndex): BorrowData {
  return unported("rustc_borrowck::borrow_set::BorrowSet::index");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:156 reserve_location (lane bck-core)
BorrowData.prototype.reserve_location_ = function (this: BorrowData): Location {
  return unported("rustc_borrowck::borrow_set::BorrowData::reserve_location");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:160 activation_location (lane bck-core)
BorrowData.prototype.activation_location_ = function (this: BorrowData): TwoPhaseActivation {
  return unported("rustc_borrowck::borrow_set::BorrowData::activation_location");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:164 kind (lane bck-core)
BorrowData.prototype.kind_ = function (this: BorrowData): BorrowKind {
  return unported("rustc_borrowck::borrow_set::BorrowData::kind");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:168 region (lane bck-core)
BorrowData.prototype.region_ = function (this: BorrowData): RegionVid {
  return unported("rustc_borrowck::borrow_set::BorrowData::region");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:172 borrowed_place (lane bck-core)
BorrowData.prototype.borrowed_place_ = function (this: BorrowData): Place {
  return unported("rustc_borrowck::borrow_set::BorrowData::borrowed_place");
};

// stub: compiler/rustc_borrowck/src/borrow_set.rs:176 assigned_place (lane bck-core)
BorrowData.prototype.assigned_place_ = function (this: BorrowData): Place {
  return unported("rustc_borrowck::borrow_set::BorrowData::assigned_place");
};

// impl<'tcx> fmt::Display for BorrowData<'tcx>
// stub: compiler/rustc_borrowck/src/borrow_set.rs:182 fmt (lane bck-core)
export function display_BorrowData(self: BorrowData): string {
  return unported("rustc_borrowck::borrow_set::BorrowData::fmt");
}

export interface LocalsStateAtExit_methods {
  // borrow_set.rs:203 (lane bck-core)
  build(locals_are_invalidated_at_exit: boolean, body: Body, move_data: MoveData): LocalsStateAtExit;
}
export type LocalsStateAtExit = gen.LocalsStateAtExit;
export const LocalsStateAtExit = gen.LocalsStateAtExit as typeof gen.LocalsStateAtExit & LocalsStateAtExit_methods;

// stub: compiler/rustc_borrowck/src/borrow_set.rs:203 build (lane bck-core)
LocalsStateAtExit.build = function (locals_are_invalidated_at_exit: boolean, body: Body, move_data: MoveData): LocalsStateAtExit {
  return unported("rustc_borrowck::borrow_set::LocalsStateAtExit::build");
};

// struct HasStorageDead(DenseBitSet<Local>); (fn-local in `LocalsStateAtExit::build`)
class HasStorageDead extends Visitor {
  constructor(public _0: DenseBitSet<Local>) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for HasStorageDead
  // stub: compiler/rustc_borrowck/src/borrow_set.rs:211 visit_local (lane bck-core)
  override visit_local(local: Local, ctx: PlaceContext, _2: Location): void {
    return unported("rustc_borrowck::borrow_set::LocalsStateAtExit::build::HasStorageDead::visit_local");
  }
}

// rustc-type: compiler/rustc_borrowck/src/borrow_set.rs:233 GatherBorrows
export class GatherBorrows extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public borrows: BorrowData[],
    public location_map: Map<Location, BorrowIndex[]>,
    public activation_map: Map<Location, BorrowIndex[]>,
    public local_map: Map<Local, Set<BorrowIndex>>,
    /// When we encounter a 2-phase borrow statement, it will always
    /// be assigning into a temporary TEMP:
    ///
    ///    TEMP = &foo
    ///
    /// We add TEMP into this map with `b`, where `b` is the index of
    /// the borrow. When we find a later use of this activation, we
    /// remove from the map (and add to the "tombstone" set below).
    public pending_activations: Map<Local, BorrowIndex>,
    public locals_state_at_exit: LocalsStateAtExit,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/borrow_set.rs:255 insert_borrow (lane bck-core)
  insert_borrow(location: Location, borrow: BorrowData): BorrowIndex {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::insert_borrow");
  }

  // stub: compiler/rustc_borrowck/src/borrow_set.rs:270 insert_borrows (lane bck-core)
  insert_borrows(location: Location, borrows: BorrowData[]): BorrowIndex[] {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::insert_borrows");
  }

  // stub: compiler/rustc_borrowck/src/borrow_set.rs:293 gather_reborrows (lane bck-core)
  gather_reborrows(
    v: BorrowData[],
    kind: BorrowKind,
    location: Location,
    target_adt: AdtDef,
    target_args: GenericArgs,
    target_place: Place,
    source_adt: AdtDef,
    source_args: GenericArgs,
    source_place: Place,
  ): void {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::gather_reborrows");
  }

  // impl<'a, 'tcx> Visitor<'tcx> for GatherBorrows<'a, 'tcx>
  // stub: compiler/rustc_borrowck/src/borrow_set.rs:421 visit_assign (lane bck-core)
  override visit_assign(assigned_place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::visit_assign");
  }

  // stub: compiler/rustc_borrowck/src/borrow_set.rs:524 visit_local (lane bck-core)
  override visit_local(temp: Local, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::visit_local");
  }

  // stub: compiler/rustc_borrowck/src/borrow_set.rs:571 visit_rvalue (lane bck-core)
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_borrowck::borrow_set::GatherBorrows::visit_rvalue");
  }
}
