// Port of compiler/rustc_borrowck/src/borrow_set.rs (lane borrowck-contract: declarations; filled by lane bck-core, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `BorrowData`'s accessors share their names with its fields (`reserve_location`, `kind`, ...): the methods get a
// trailing `_` (`reserve_location_()`, ...), as `BorrowSet.locals_state_at_exit_()` (lib.ts header).
// PORT: `location_map` / `activation_map` (`FxHashMap<Location, SmallVec<[BorrowIndex; 1]>>`) are `KeyedMap`s keyed by
// `Location_key` (PORTING §5 composite keys); `local_map` (`FxIndexMap<Local, FxIndexSet<BorrowIndex>>`) and
// `pending_activations` are plain `Map`s / `Set`s (number keys). `.entry(k).or_default()` gets-or-inserts the empty value.
// PORT: `Place` / `BorrowKind` / `TwoPhaseActivation` / `Location` equality (`==`, `assert_eq!`) is the derived `PartialEq`
// written out (`Place_eq`: same local and the same interned projection list).
import { KeyedMap } from "../rust_ts/keyed.ts";
import { FieldIdx } from "../rustc_abi/lib.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import {
  type Body,
  BorrowKind,
  debug_BorrowKind,
  debug_Local,
  debug_Location,
  debug_Place,
  type Local,
  type Location,
  type Place,
  type PlaceElem,
  ProjectionElem,
  type Rvalue,
} from "../rustc_middle/mir/mod.ts";
import { preorder } from "../rustc_middle/mir/traversal.ts";
import { PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { debug_RegionVid, type RegionVid } from "../rustc_type_ir/region_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_option, debug_struct_non_exhaustive, debug_vec, PLAIN } from "../std/fmt.ts";
import { Panic, unreachable } from "../std/panic.ts";
import * as gen from "./borrow_set.gen.ts";
import { BorrowData, BorrowSet, debug_TwoPhaseActivation, TwoPhaseActivation } from "./borrow_set.gen.ts";
import { BorrowIndex, debug_BorrowIndex } from "./dataflow.gen.ts";
export * from "./borrow_set.gen.ts";

/** PORT: the canonical key of a `Location` (its derived `Hash`/`Eq`) for `KeyedMap<Location, _>`. */
export function Location_key(loc: Location): number {
  return loc.block * 0x1_0000_0000 + loc.statement_index;
}

/** PORT: the derived `PartialEq` of `Location`. */
function Location_eq(a: Location, b: Location): boolean {
  return a.block === b.block && a.statement_index === b.statement_index;
}

/** PORT: the derived `PartialEq` of `mir::Place` (the projection list is interned: identity). */
function Place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** PORT: the derived `PartialEq` of `mir::BorrowKind`. */
function BorrowKind_eq(a: BorrowKind, b: BorrowKind): boolean {
  switch (a.$) {
    case "Shared":
      return b.$ === "Shared";
    case "Fake":
      return b.$ === "Fake" && a._0 === b._0;
    case "Mut":
      return b.$ === "Mut" && a.kind === b.kind;
  }
}

/** PORT: the derived `PartialEq` of `TwoPhaseActivation`. */
function TwoPhaseActivation_eq(a: TwoPhaseActivation, b: TwoPhaseActivation): boolean {
  if (a.$ === "ActivatedAt") return b.$ === "ActivatedAt" && Location_eq(a._0, b._0);
  return a.$ === b.$;
}

/** `assert_eq!(left, right, "<msg>")` (core's `assert_failed_inner` text with `Some(args)`). */
function assert_eq_msg<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean, msg: string): void {
  if (!eq(left, right)) {
    throw new Panic(`assertion \`left == right\` failed: ${msg}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/** `assert_eq!(left, right)` (core's `assert_failed_inner` text without args). */
function assert_eq_<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean): void {
  if (!eq(left, right)) {
    throw new Panic(`assertion \`left == right\` failed\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

declare module "./borrow_set.gen.ts" {
  interface BorrowSet {
    // borrow_set.rs:86
    iter(): Iterable<BorrowData>;
    // borrow_set.rs:91
    locals_state_at_exit_(): LocalsStateAtExit;
    // borrow_set.rs:96
    len(): number;
    // borrow_set.rs:100
    iter_enumerated(): Iterable<[BorrowIndex, BorrowData]>;
    // borrow_set.rs:105
    activations_at_location(location: Location): readonly BorrowIndex[];
    // borrow_set.rs:110
    borrows_at_location(location: Location): readonly BorrowIndex[] | undefined;
    // borrow_set.rs:115
    borrows_on_local(local: Local): Set<BorrowIndex> | undefined;
    // borrow_set.rs:123 `impl Index<BorrowIndex> for BorrowSet`
    index(index: BorrowIndex): BorrowData;
  }
  namespace BorrowSet {
    // borrow_set.rs:50
    function build(tcx: TyCtxt, body: Body, locals_are_invalidated_at_exit: boolean, move_data: MoveData): BorrowSet;
  }
  interface BorrowData {
    // borrow_set.rs:156
    reserve_location_(): Location;
    // borrow_set.rs:160
    activation_location_(): TwoPhaseActivation;
    // borrow_set.rs:164
    kind_(): BorrowKind;
    // borrow_set.rs:168
    region_(): RegionVid;
    // borrow_set.rs:172
    borrowed_place_(): Place;
    // borrow_set.rs:176
    assigned_place_(): Place;
  }
}

// Public method to support Aquascope.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:50 build
(BorrowSet as unknown as { build: typeof BorrowSet.build }).build = function (
  tcx: TyCtxt,
  body: Body,
  locals_are_invalidated_at_exit: boolean,
  move_data: MoveData,
): BorrowSet {
  const visitor = new GatherBorrows(
    tcx,
    body,
    [],
    new KeyedMap<Location, BorrowIndex[]>(Location_key),
    new KeyedMap<Location, BorrowIndex[]>(Location_key),
    new Map(),
    new Map(),
    LocalsStateAtExit.build(locals_are_invalidated_at_exit, body, move_data),
  );

  for (const [block, block_data] of preorder(body)) {
    visitor.visit_basic_block_data(block, block_data);
  }

  return new BorrowSet(visitor.borrows, visitor.location_map, visitor.activation_map, visitor.local_map, visitor.locals_state_at_exit);
};

// Public method to support Aquascope and Creusot.
/// Iterate through all BorrowData in the BorrowSet.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:86 iter
BorrowSet.prototype.iter = function (this: BorrowSet): Iterable<BorrowData> {
  return this.borrows;
};

// Public method to support Creusot.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:91 locals_state_at_exit
BorrowSet.prototype.locals_state_at_exit_ = function (this: BorrowSet): LocalsStateAtExit {
  return this.locals_state_at_exit;
};

// Public method to support Creusot.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:96 len
BorrowSet.prototype.len = function (this: BorrowSet): number {
  return this.borrows.length;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:100 iter_enumerated
BorrowSet.prototype.iter_enumerated = function* (this: BorrowSet): Generator<[BorrowIndex, BorrowData]> {
  const borrows = this.borrows;
  for (let i = 0; i < borrows.length; i++) yield [BorrowIndex.from_usize(i), borrows[i]!];
};

// Public method to support Creusot.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:105 activations_at_location
BorrowSet.prototype.activations_at_location = function (this: BorrowSet, location: Location): readonly BorrowIndex[] {
  return this.activation_map.get(location) ?? [];
};

// Public method to support Creusot.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:110 borrows_at_location
BorrowSet.prototype.borrows_at_location = function (this: BorrowSet, location: Location): readonly BorrowIndex[] | undefined {
  return this.location_map.get(location);
};

// Public method to support Creusot.
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:115 borrows_on_local
BorrowSet.prototype.borrows_on_local = function (this: BorrowSet, local: Local): Set<BorrowIndex> | undefined {
  return this.local_map.get(local);
};

// impl<'tcx> Index<BorrowIndex> for BorrowSet<'tcx>
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:123 index
BorrowSet.prototype.index = function (this: BorrowSet, index: BorrowIndex): BorrowData {
  const b = this.borrows[index];
  if (b === undefined) {
    throw new Panic(`index out of bounds: the len is ${this.borrows.length} but the index is ${index}`);
  }
  return b;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:156 reserve_location
BorrowData.prototype.reserve_location_ = function (this: BorrowData): Location {
  return this.reserve_location;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:160 activation_location
BorrowData.prototype.activation_location_ = function (this: BorrowData): TwoPhaseActivation {
  return this.activation_location;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:164 kind
BorrowData.prototype.kind_ = function (this: BorrowData): BorrowKind {
  return this.kind;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:168 region
BorrowData.prototype.region_ = function (this: BorrowData): RegionVid {
  return this.region;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:172 borrowed_place
BorrowData.prototype.borrowed_place_ = function (this: BorrowData): Place {
  return this.borrowed_place;
};

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:176 assigned_place
BorrowData.prototype.assigned_place_ = function (this: BorrowData): Place {
  return this.assigned_place;
};

// impl<'tcx> fmt::Display for BorrowData<'tcx>
// rustc: compiler/rustc_borrowck/src/borrow_set.rs:182 fmt
export function display_BorrowData(self: BorrowData): string {
  let kind: string;
  const k = self.kind;
  if (k.$ === "Shared") {
    kind = "";
  } else if (k.$ === "Fake" && k._0 === "Deep") {
    kind = "fake ";
  } else if (k.$ === "Fake" && k._0 === "Shallow") {
    kind = "fake shallow ";
  } else if (k.$ === "Mut" && k.kind === "ClosureCapture") {
    kind = "uniq ";
  } else {
    // FIXME: differentiate `TwoPhaseBorrow`
    // mir::BorrowKind::Mut { kind: mir::MutBorrowKind::Default | mir::MutBorrowKind::TwoPhaseBorrow }
    kind = "mut ";
  }
  return `&${debug_RegionVid(self.region, PLAIN)} ${kind}${debug_Place(self.borrowed_place, PLAIN)}`;
}

export interface LocalsStateAtExit_methods {
  // borrow_set.rs:203
  build(locals_are_invalidated_at_exit: boolean, body: Body, move_data: MoveData): LocalsStateAtExit;
}
export type LocalsStateAtExit = gen.LocalsStateAtExit;
export const LocalsStateAtExit = gen.LocalsStateAtExit as typeof gen.LocalsStateAtExit & LocalsStateAtExit_methods;

// rustc: compiler/rustc_borrowck/src/borrow_set.rs:203 build
LocalsStateAtExit.build = function (locals_are_invalidated_at_exit: boolean, body: Body, move_data: MoveData): LocalsStateAtExit {
  // struct HasStorageDead(DenseBitSet<Local>);
  class HasStorageDead extends Visitor {
    constructor(public _0: DenseBitSet<Local>) {
      super();
    }

    // impl<'tcx> Visitor<'tcx> for HasStorageDead
    // rustc: compiler/rustc_borrowck/src/borrow_set.rs:211 visit_local
    override visit_local(local: Local, ctx: PlaceContext, _2: Location): void {
      if (ctx.$ === "NonUse" && ctx._0.$ === "StorageDead") {
        this._0.insert(local);
      }
    }
  }

  if (locals_are_invalidated_at_exit) {
    return LocalsStateAtExit.AllAreInvalidated;
  } else {
    const has_storage_dead = new HasStorageDead(DenseBitSet.new_empty<Local>(body.local_decls.length));
    has_storage_dead.visit_body(body);
    const has_storage_dead_or_moved = has_storage_dead._0;
    for (const move_out of move_data.move_outs) {
      has_storage_dead_or_moved.insert(move_data.base_local(move_out.path));
    }
    return { $: "SomeAreInvalidated", has_storage_dead_or_moved };
  }
};

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

  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:255 insert_borrow
  insert_borrow(location: Location, borrow: BorrowData): BorrowIndex {
    const idx = BorrowIndex.from_usize(this.borrows.length);
    this.borrows.push(borrow);
    const entry = this.location_map.get(location);
    if (entry !== undefined) {
      return bug(
        `Inserting a borrow ${debug_BorrowIndex(idx, PLAIN)} at ${debug_Location(location, PLAIN)} attempted to override an existing list ${debug_OccupiedEntry(location, entry)}`,
      );
    } else {
      this.location_map.set(location, [idx]);
    }
    return idx;
  }

  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:270 insert_borrows
  insert_borrows(location: Location, borrows: BorrowData[]): BorrowIndex[] {
    const idxs: BorrowIndex[] = [];
    // FIXME(reborrow): why doesn't SmallVec offer reserve?
    for (const borrow of borrows) {
      idxs.push(BorrowIndex.from_usize(this.borrows.length));
      this.borrows.push(borrow);
    }
    const entry = this.location_map.get(location);
    if (entry !== undefined) {
      return bug(
        `Inserting borrows ${debug_vec(idxs, PLAIN, debug_BorrowIndex)} at ${debug_Location(location, PLAIN)} attempted to override an existing list ${debug_OccupiedEntry(location, entry)}`,
      );
    } else {
      this.location_map.set(location, [...idxs]);
    }
    return idxs;
  }

  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:293 gather_reborrows
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
    let did_reborrow = false;
    let source_idx = -1;
    for (const source_field of source_adt.all_fields()) {
      source_idx++;
      const source_field_ty = Unnormalized.skip_norm_wip(source_field.ty(this.tcx, source_args));
      const k = source_field_ty.kind();
      if (k.$ === "Ref" && k._2 === "Mut") {
        const source_region = k._0;
        if (source_region.is_static()) {
          return bug("Cannot implement Reborrow on a type containing a &'static mut T field");
        }
        const found = find_field_by_name(target_adt, source_field.name);
        if (found === undefined) {
          // Reborrow dropped this field.
          continue;
        }
        const [target_idx, target_field] = found;
        const tk = Unnormalized.skip_norm_wip(target_field.ty(this.tcx, target_args)).kind();
        if (tk.$ !== "Ref") {
          return bug("Reborrow source field type is &mut T but target field is not a reference");
        }
        const target_region = tk._0;

        did_reborrow = true;
        const source_field_deref_place = source_place.project_deeper(
          [{ $: "Field", _0: FieldIdx.from_usize(source_idx), _1: source_field_ty }, ProjectionElem.Deref] as PlaceElem[],
          this.tcx,
        );
        const target_field_place = target_place.project_to_field(FieldIdx.from_usize(target_idx), this.body.local_decls, this.tcx);
        v.push(new BorrowData(location, TwoPhaseActivation.NotTwoPhase, kind, target_region.as_var(), source_field_deref_place, target_field_place));
      } else if (
        k.$ === "Adt" &&
        k._1[0] !== undefined &&
        GenericArg.as_region(k._1[0]) !== undefined &&
        !this.tcx.type_is_copy_modulo_regions(this.body.typing_env(this.tcx), this.tcx.erase_and_anonymize_regions(source_field_ty, fold_Ty))
      ) {
        const source_field_adt = k._0;
        const source_field_args = k._1;
        const found = find_field_by_name(target_adt, source_field.name);
        if (found === undefined) {
          // Reborrow dropped this field.
          continue;
        }
        const [target_idx, target_field] = found;
        const tk = Unnormalized.skip_norm_wip(target_field.ty(this.tcx, target_args)).kind();
        if (tk.$ !== "Adt") {
          return bug("Reborrow source field type is a !Copy ADT but target field is not");
        }
        const target_field_adt = tk._0;
        const target_field_args = tk._1;

        did_reborrow = true;
        const source_field_place = source_place.project_to_field(FieldIdx.from_usize(source_idx), this.body.local_decls, this.tcx);
        const target_field_place = target_place.project_to_field(FieldIdx.from_usize(target_idx), this.body.local_decls, this.tcx);
        this.gather_reborrows(
          v,
          kind,
          location,
          target_field_adt,
          target_field_args,
          target_field_place,
          source_field_adt,
          source_field_args,
          source_field_place,
        );
      } else {
        continue;
      }
    }
    if (!did_reborrow) {
      // Key point: if source contained no reference, a phantom dereference must be performed
      // to avoid capturing the local variable's place.
      const source_phantom_deref_place = source_place.project_deeper([ProjectionElem.PhantomDeref] as PlaceElem[], this.tcx);
      const regions = [...target_args.regions()];
      if (regions.length !== 1) {
        return bug("ADT containing no '&mut T' or 'T: Reborrow' fields must only have one lifetime to implement Reborrow");
      }
      const target_region = regions[0]!;
      v.push(new BorrowData(location, TwoPhaseActivation.NotTwoPhase, kind, target_region.as_var(), source_phantom_deref_place, target_place));
    }
  }

  // impl<'a, 'tcx> Visitor<'tcx> for GatherBorrows<'a, 'tcx>
  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:421 visit_assign
  override visit_assign(assigned_place: Place, rvalue: Rvalue, location: Location): void {
    if (rvalue.$ === "Ref") {
      const region_ = rvalue._0;
      const kind = rvalue._1;
      const borrowed_place = rvalue._2;
      if (borrowed_place.ignore_borrow(this.tcx, this.body, this.locals_state_at_exit)) {
        // debug!("ignoring_borrow of {:?}", borrowed_place);
        return;
      }

      const region = region_.as_var();
      const borrow = (activation_location: TwoPhaseActivation): BorrowData =>
        new BorrowData(location, activation_location, kind, region, borrowed_place, assigned_place);

      let idx: BorrowIndex;
      if (!BorrowKind.is_two_phase_borrow(kind)) {
        // debug!("  -> {:?}", location);
        idx = this.insert_borrow(location, borrow(TwoPhaseActivation.NotTwoPhase));
      } else {
        // When we encounter a 2-phase borrow statement, it will always
        // be assigning into a temporary TEMP:
        //
        //    TEMP = &foo
        //
        // so extract `temp`.
        const temp = assigned_place.as_local();
        if (temp === undefined) {
          return span_bug(
            this.body.source_info(location).span,
            `expected 2-phase borrow to assign to a local, not \`${debug_Place(assigned_place, PLAIN)}\``,
          );
        }

        // Consider the borrow not activated to start. When we find an activation, we'll update
        // this field.
        const idx_ = this.insert_borrow(location, borrow(TwoPhaseActivation.NotActivated));

        // Insert `temp` into the list of pending activations. From
        // now on, we'll be on the lookout for a use of it. Note that
        // we are guaranteed that this use will come after the
        // assignment.
        const prev = this.pending_activations.get(temp);
        this.pending_activations.set(temp, idx_);
        assert_eq_msg<BorrowIndex | undefined>(
          prev,
          undefined,
          (v) => debug_option(v, PLAIN, debug_BorrowIndex),
          (a, b) => a === b,
          "temporary associated with multiple two phase borrows",
        );

        idx = idx_;
      }

      let set = this.local_map.get(borrowed_place.local);
      if (set === undefined) this.local_map.set(borrowed_place.local, (set = new Set()));
      set.add(idx);
    } else if (rvalue.$ === "Reborrow") {
      const target = rvalue._0;
      const mutability = rvalue._1;
      const source_place = rvalue._2;
      const source_ty = source_place.ty(this.body, this.tcx).ty;
      const sk = source_ty.kind();
      if (sk.$ !== "Adt") return unreachable();
      const source_adt = sk._0;
      const source_args = sk._1;
      const tk = target.kind();
      if (tk.$ !== "Adt") return unreachable();
      const target_adt = tk._0;
      const target_args = tk._1;

      let kind: BorrowKind;
      if (mutability === "Mut") {
        // Reborrow
        if (target_adt.did() !== source_adt.did()) {
          bug(`hir-typeck passed but Reborrow involves mismatching types at ${debug_Location(location, PLAIN)}`);
        }

        kind = { $: "Mut", kind: "Default" };
      } else {
        // CoerceShared
        if (target_adt.did() === source_adt.did()) {
          bug(`hir-typeck passed but CoerceShared involves matching types at ${debug_Location(location, PLAIN)}`);
        }
        kind = BorrowKind.Shared;
      }

      const reborrows: BorrowData[] = [];
      this.gather_reborrows(reborrows, kind, location, target_adt, target_args, assigned_place, source_adt, source_args, source_place);

      const idxs = this.insert_borrows(location, reborrows);

      let locals = this.local_map.get(source_place.local);
      if (locals === undefined) this.local_map.set(source_place.local, (locals = new Set()));
      for (const idx of idxs) {
        locals.add(idx);
      }
    }

    this.super_assign(assigned_place, rvalue, location);
  }

  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:524 visit_local
  override visit_local(temp: Local, context: PlaceContext, location: Location): void {
    if (!PlaceContext.is_use(context)) {
      return;
    }

    // We found a use of some temporary TMP
    // check whether we (earlier) saw a 2-phase borrow like
    //
    //     TMP = &mut place
    const borrow_index = this.pending_activations.get(temp);
    if (borrow_index === undefined) {
      return;
    }
    const borrow_data = this.borrows[borrow_index]!;

    // Watch out: the use of TMP in the borrow itself
    // doesn't count as an activation. =)
    if (Location_eq(borrow_data.reserve_location, location) && context.$ === "MutatingUse" && context._0 === "Store") {
      return;
    }

    if (borrow_data.activation_location.$ === "ActivatedAt") {
      const other_location = borrow_data.activation_location._0;
      return span_bug(
        this.body.source_info(location).span,
        `found two uses for 2-phase borrow temporary ${debug_Local(temp, PLAIN)}: ${debug_Location(location, PLAIN)} and ${debug_Location(other_location, PLAIN)}`,
      );
    }

    // Otherwise, this is the unique later use that we expect.
    // Double check: This borrow is indeed a two-phase borrow (that is,
    // we are 'transitioning' from `NotActivated` to `ActivatedAt`) and
    // we've not found any other activations (checked above).
    assert_eq_msg(
      borrow_data.activation_location,
      TwoPhaseActivation.NotActivated,
      (v) => debug_TwoPhaseActivation(v, PLAIN),
      TwoPhaseActivation_eq,
      "never found an activation for this borrow!",
    );
    let activations = this.activation_map.get(location);
    if (activations === undefined) this.activation_map.set(location, (activations = []));
    activations.push(borrow_index);

    borrow_data.activation_location = { $: "ActivatedAt", _0: location };
  }

  // rustc: compiler/rustc_borrowck/src/borrow_set.rs:571 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    if (rvalue.$ === "Ref") {
      const region = rvalue._0;
      const kind = rvalue._1;
      const place = rvalue._2;
      // double-check that we already registered a BorrowData for this

      const idxs = this.location_map.get(location);
      if (idxs === undefined) throw new Panic("no entry found for key");
      for (const idx of idxs) {
        const borrow_data = this.borrows[idx]!;
        assert_eq_(borrow_data.reserve_location, location, (v) => debug_Location(v, PLAIN), Location_eq);
        assert_eq_(borrow_data.kind, kind, (v) => debug_BorrowKind(v, PLAIN), BorrowKind_eq);
        assert_eq_(borrow_data.region, region.as_var(), (v) => debug_RegionVid(v, PLAIN), (a, b) => a === b);
        assert_eq_(borrow_data.borrowed_place, place, (v) => debug_Place(v, PLAIN), Place_eq);
      }
    }

    this.super_rvalue(rvalue, location);
  }
}

/** `target_adt.all_fields().enumerate().find(|(_, f)| f.name == name)` (both `gather_reborrows` arms). */
function find_field_by_name(adt: AdtDef, name: Symbol_): [number, FieldDef_] | undefined {
  let i = 0;
  for (const f of adt.all_fields()) {
    if (f.name === name) return [i, f];
    i++;
  }
  return undefined;
}
type FieldDef_ = ReturnType<AdtDef["all_fields"]> extends Generator<infer F> ? F : never;
type Symbol_ = FieldDef_["name"];

/** std's `impl Debug for hash_map::OccupiedEntry` (`OccupiedEntry { key: .., value: .., .. }`), for the `bug!`s above. */
function debug_OccupiedEntry(key: Location, value: readonly BorrowIndex[]): string {
  return debug_struct_non_exhaustive(PLAIN, "OccupiedEntry", [
    ["key", debug_Location(key, PLAIN)],
    ["value", debug_vec(value, PLAIN, debug_BorrowIndex)],
  ]);
}
