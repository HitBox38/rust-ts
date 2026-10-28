// Port of compiler/rustc_mir_dataflow/src/value_analysis.rs (types declared by lane dataflow-contract; bodies by lane
// mt-opt2-b). Its users are the level >= 2 passes `dataflow_const_prop` / `jump_threading`.
//
// Representation:
// - `PlaceIndex` / `ValueIndex` are branded numbers with `newtype_index!` companions (no `debug_format`: `{}`).
// - `State<V>` is the upstream enum as a mutable tagged union (a dataflow domain, mutated in place like `MaybeReachable`,
//   framework/lattice.ts header): `Unreachable` is a fresh `{ $: "Unreachable" }` (`State.Unreachable()`), `*self = v`
//   is `State.assign_(self, v)` (upstream `State::assign` exists); its inherent methods are on the `State` companion (PORTING §8). `StateData<V>` is a
//   class (fields `bottom`, `map`), mutated in place.
// - Trait bounds on `V` are impl tables passed last (`V_`): `V: HasBottom + Clone` is `V_: HasBottom<V> & CloneV<V>`,
//   `+ HasTop` adds `HasTop<V>`, `JoinSemiLattice` is `ValueJoinSemiLattice<V>` (its `eq` is the `Eq` bound), `Debug` is
//   `Debug<V>`. `impl Clone / JoinSemiLattice for StateData<V> / State<V>` are the functions `Clone_StateData(V_)`,
//   `JoinSemiLattice_StateData(V_)`, `Clone_State(V_)`, `JoinSemiLattice_State(V_)`; the derived `PartialEq` is
//   `StateData_eq` / `State_eq`.
// - PORT: the values `V` of a `State` are `Copy` lattices in practice (`FlatSet<Scalar>`), represented as immutable
//   values. So `V: Clone` only needs `clone` (`CloneV<V>`; `StateData::clone_from` clones the map's values, never calls
//   `V::clone_from`), and `V: JoinSemiLattice` writes through a slot: `ValueJoinSemiLattice<V>.join(self: MutRef<V>, ..)`
//   (the shape of lattice.ts's `JoinSemiLattice_FlatSet`); `e.into_mut().join(v)` is a `MutRef` view onto the map entry.
// - The upstream struct `Map` shadows the JS global `Map` in this module: `FxHashMap`s are `globalThis.Map`.
//   `FxHashMap<(PlaceIndex, TrackElem), PlaceIndex>` is keyed by `TrackElem_key(place, elem)` (PORTING §5 composite
//   keys); `FxHashMap<ValueIndex, V>` keys on the handle. `Range<usize>` is `Range` (`{ start, end }`).
//   `FxIndexSet<(PlaceIndex, PlaceIndex)>` (`propagate_assignments`) is an array plus a key set (`PairIndexSet`).
// - `impl Visitor for PlaceCollector` / for `excluded_locals`'s local `Collector` are classes extending rustc_middle
//   mir/visit.ts's `Visitor` (D4). `TryFrom<ProjectionElem<V, T>> for TrackElem` is `TrackElem.try_from(value)` returning
//   `Result<TrackElem, null>`. `impl FnMut(..)` parameters are closures; `-> impl Iterator` is an `Iterable`.
// - `debug_with_context(_rec)` write into a `Formatter`: they return the written string (std/fmt.ts).

import type { FieldIdx, VariantIdx } from "../rustc_abi/layout.ts";
import { FieldIdx as FieldIdxC } from "../rustc_abi/layout.ts";
import { BackendRepr } from "../rustc_abi/lib.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { HasBottom, HasTop } from "./framework/lattice.ts";
import type { Clone } from "./framework/mod.ts";
import { type Body, debug_Local, type Local, type Location, type Place, type PlaceRef, PlaceTy, type ProjectionElem } from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../rustc_middle/mir/visit.ts";
import { GrowableBitSet } from "../rustc_index/bit_set.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";

/** `std::ops::Range<usize>`. */
interface Range {
  start: number;
  end: number;
}

/** `V: Clone` for the `Copy` value lattices of a `State` (header). */
export type CloneV<V> = Pick<Clone<V>, "clone">;

/** `V: JoinSemiLattice` for the `Copy` value lattices of a `State`: `join` writes through the slot (header). */
export interface ValueJoinSemiLattice<V> {
  /** The `Eq` supertrait (`==`). */
  eq(a: V, b: V): boolean;
  join(self: MutRef<V>, other: V): boolean;
}

// rustc_index::newtype_index!(
//     /// This index uniquely identifies a place.
//     ///
//     /// Not every place has a `PlaceIndex`, and not every `PlaceIndex` corresponds to a tracked
//     /// place. However, every tracked place and all places along its projection have a `PlaceIndex`.
//     pub struct PlaceIndex {}
// );
/// This index uniquely identifies a place.
///
/// Not every place has a `PlaceIndex`, and not every `PlaceIndex` corresponds to a tracked
/// place. However, every tracked place and all places along its projection have a `PlaceIndex`.
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:22 PlaceIndex
export type PlaceIndex = number & { readonly __brand: "PlaceIndex" };
export const PlaceIndex = newtype_index<PlaceIndex>((n) => `${n}`);

// rustc_index::newtype_index!(
//     /// This index uniquely identifies a tracked place and therefore a slot in [`State`].
//     pub struct ValueIndex {}
// );
/// This index uniquely identifies a tracked place and therefore a slot in [`State`].
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:27 ValueIndex
export type ValueIndex = number & { readonly __brand: "ValueIndex" };
export const ValueIndex = newtype_index<ValueIndex>((n) => `${n}`);

/// See [`State`].
// #[derive(PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:32 StateData
export class StateData<V> {
  constructor(
    public bottom: V,
    /// This map only contains values that are not `⊥`.
    public map: globalThis.Map<ValueIndex, V>,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:39 new
  static new<V>(V_: HasBottom<V>): StateData<V> {
    return new StateData(V_.BOTTOM, new globalThis.Map());
  }

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:43 get
  get(idx: ValueIndex): V {
    return this.map.has(idx) ? (this.map.get(idx) as V) : this.bottom;
  }

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:47 insert
  insert(idx: ValueIndex, elem: V, V_: HasBottom<V>): void {
    if (V_.is_bottom(elem)) {
      this.map.delete(idx);
    } else {
      this.map.set(idx, elem);
    }
  }
}

/** The derived `PartialEq` of `StateData<V>` (`bottom`, then `map` as a hash map: same keys, equal values). */
export function StateData_eq<V>(eq_V: (a: V, b: V) => boolean): (a: StateData<V>, b: StateData<V>) => boolean {
  return (a, b) => {
    if (!eq_V(a.bottom, b.bottom)) return false;
    if (a.map.size !== b.map.size) return false;
    for (const [k, v] of a.map) {
      if (!b.map.has(k) || !eq_V(v, b.map.get(k)!)) return false;
    }
    return true;
  };
}

/** `impl<V: Clone> Clone for StateData<V>`. */
export function Clone_StateData<V>(V_: CloneV<V>): Clone<StateData<V>> {
  return {
    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:57 clone
    clone(self: StateData<V>): StateData<V> {
      const map = new globalThis.Map<ValueIndex, V>();
      for (const [k, v] of self.map) map.set(k, V_.clone(v));
      return new StateData(V_.clone(self.bottom), map);
    },

    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:61 clone_from
    clone_from(self: StateData<V>, source: StateData<V>): void {
      // `self.map.clone_from(&source.map)`
      self.map.clear();
      for (const [k, v] of source.map) self.map.set(k, V_.clone(v));
    },
  };
}

/** `impl<V: JoinSemiLattice + Clone> JoinSemiLattice for StateData<V>`. */
export function JoinSemiLattice_StateData<V>(V_: ValueJoinSemiLattice<V> & CloneV<V>): {
  eq(a: StateData<V>, b: StateData<V>): boolean;
  join(self: StateData<V>, other: StateData<V>): boolean;
} {
  return {
    eq: StateData_eq(V_.eq),

    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:67 join
    join(self: StateData<V>, other: StateData<V>): boolean {
      let changed = false;
      // #[allow(rustc::potential_query_instability)]
      for (const [i, v] of other.map) {
        if (!self.map.has(i)) {
          // StdEntry::Vacant(e)
          self.map.set(i, V_.clone(v));
          changed = true;
        } else {
          // StdEntry::Occupied(e) => changed |= e.into_mut().join(v)
          const slot: MutRef<V> = {
            get value(): V {
              return self.map.get(i) as V;
            },
            set value(nv: V) {
              self.map.set(i, nv);
            },
          };
          changed = V_.join(slot, v) || changed;
        }
      }
      return changed;
    },
  };
}

/// Dataflow state.
///
/// Every instance specifies a lattice that represents the possible values of a single tracked
/// place. If we call this lattice `V` and set of tracked places `P`, then a [`State`] is an
/// element of `{unreachable} ∪ (P -> V)`. This again forms a lattice, where the bottom element is
/// `unreachable` and the top element is the mapping `p ↦ ⊤`. Note that the mapping `p ↦ ⊥` is not
/// the bottom element (because joining an unreachable and any other reachable state yields a
/// reachable state). All operations on unreachable states are ignored.
///
/// Flooding means assigning a value (by default `⊤`) to all tracked projections of a given place.
// #[derive(PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:94 State
export type State<V> = { $: "Unreachable" } | { $: "Reachable"; _0: StateData<V> };

/** The derived `PartialEq` of `State<V>`. */
export function State_eq<V>(eq_V: (a: V, b: V) => boolean): (a: State<V>, b: State<V>) => boolean {
  const data_eq = StateData_eq(eq_V);
  return (a, b) => (a.$ === "Reachable" && b.$ === "Reachable" ? data_eq(a._0, b._0) : a.$ === b.$);
}

/** `impl<V: Clone> Clone for State<V>`. */
export function Clone_State<V>(V_: CloneV<V>): Clone<State<V>> {
  const data = Clone_StateData(V_);
  const impl: Clone<State<V>> = {
    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:100 clone
    clone(self: State<V>): State<V> {
      switch (self.$) {
        case "Reachable":
          return State.Reachable(data.clone(self._0));
        case "Unreachable":
          return State.Unreachable();
      }
    },

    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:107 clone_from
    clone_from(self: State<V>, source: State<V>): void {
      if (self.$ === "Reachable" && source.$ === "Reachable") {
        data.clone_from(self._0, source._0);
      } else {
        State.assign_(self, impl.clone(source));
      }
    },
  };
  return impl;
}

/** `V: Clone + HasBottom` (the bound of the inherent `impl State<V>` block). */
type StateV<V> = HasBottom<V> & CloneV<V>;

/** The inherent methods of `State<V>` (`impl<V: Clone + HasBottom> State<V>`; `V_` last). */
export const State = {
  /** A fresh `State::Unreachable` (domain values are mutated in place; see the header). */
  Unreachable<V>(): State<V> {
    return { $: "Unreachable" };
  },
  Reachable<V>(_0: StateData<V>): State<V> {
    return { $: "Reachable", _0 };
  },
  /** `*self = source` (a move: `self` takes `source`'s payload). */
  assign_<V>(self: State<V>, source: State<V>): void {
    const s = self as { $: "Unreachable" | "Reachable"; _0?: StateData<V> };
    if (source.$ === "Reachable") {
      s.$ = "Reachable";
      s._0 = source._0;
    } else {
      s.$ = "Unreachable";
      delete s._0;
    }
  },

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:118 new_reachable
  new_reachable<V>(V_: StateV<V>): State<V> {
    return State.Reachable(StateData.new(V_));
  },

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:122 is_reachable
  is_reachable<V>(self: State<V>): boolean {
    return self.$ === "Reachable";
  },

  /// Assign `value` to all places that are contained in `place` or may alias one.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:127 flood_with
  flood_with<V>(self: State<V>, place: PlaceRef, map: Map, value: V, V_: StateV<V>): void {
    State.flood_with_tail_elem(self, place, undefined, map, value, V_);
  },

  /// Assign `TOP` to all places that are contained in `place` or may alias one.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:132 flood
  flood<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V> & HasTop<V>): void {
    State.flood_with(self, place, map, V_.TOP, V_);
  },

  /// Assign `value` to the discriminant of `place` and all places that may alias it.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:140 flood_discr_with
  flood_discr_with<V>(self: State<V>, place: PlaceRef, map: Map, value: V, V_: StateV<V>): void {
    State.flood_with_tail_elem(self, place, TrackElem.Discriminant, map, value, V_);
  },

  /// Assign `TOP` to the discriminant of `place` and all places that may alias it.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:145 flood_discr
  flood_discr<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V> & HasTop<V>): void {
    State.flood_discr_with(self, place, map, V_.TOP, V_);
  },

  /// This method is the most general version of the `flood_*` method.
  ///
  /// Assign `value` on the given place and all places that may alias it. In particular, when
  /// the given place has a variant downcast, we invoke the function on all the other variants.
  ///
  /// `tail_elem` allows to support discriminants that are not a place in MIR, but that we track
  /// as such.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:159 flood_with_tail_elem
  flood_with_tail_elem<V>(
    self: State<V>,
    place: PlaceRef,
    tail_elem: TrackElem | undefined,
    map: Map,
    value: V,
    V_: StateV<V>,
  ): void {
    if (self.$ !== "Reachable") return;
    const values = self._0;
    map.for_each_aliasing_place(place, tail_elem, (vi) => values.insert(vi, V_.clone(value), V_));
  },

  /// Low-level method that assigns to a place.
  /// This does nothing if the place is not tracked.
  ///
  /// The target place must have been flooded before calling this method.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:174 insert_idx
  insert_idx<V>(self: State<V>, target: PlaceIndex, result: ValueOrPlace<V>, map: Map, V_: StateV<V>): void {
    switch (result.$) {
      case "Value":
        return State.insert_value_idx(self, target, result._0, map, V_);
      case "Place":
        return State.insert_place_idx(self, target, result._0, map, V_);
    }
  },

  /// Low-level method that assigns a value to a place.
  /// This does nothing if the place is not tracked.
  ///
  /// The target place must have been flooded before calling this method.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:185 insert_value_idx
  insert_value_idx<V>(self: State<V>, target: PlaceIndex, value: V, map: Map, V_: StateV<V>): void {
    if (self.$ !== "Reachable") return;
    const values = self._0;
    const value_index = map.places[target]!.value_index;
    if (value_index !== undefined) {
      values.insert(value_index, value, V_);
    }
  },

  /// Copies `source` to `target`, including all tracked places beneath.
  ///
  /// If `target` contains a place that is not contained in `source`, it will be overwritten with
  /// Top. Also, because this will copy all entries one after another, it may only be used for
  /// places that are non-overlapping or identical.
  ///
  /// The target place must have been flooded before calling this method.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:199 insert_place_idx
  insert_place_idx<V>(self: State<V>, target: PlaceIndex, source: PlaceIndex, map: Map, V_: StateV<V>): void {
    if (self.$ !== "Reachable") return;
    const values = self._0;
    map.for_each_value_pair(target, source, (target, source) => {
      values.insert(target, V_.clone(values.get(source)), V_);
    });
  },

  /// Helper method to interpret `target = result`.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:207 assign
  assign<V>(self: State<V>, target: PlaceRef, result: ValueOrPlace<V>, map: Map, V_: StateV<V> & HasTop<V>): void {
    State.flood(self, target, map, V_);
    const target_ = map.find(target);
    if (target_ !== undefined) {
      State.insert_idx(self, target_, result, map, V_);
    }
  },

  /// Retrieve the value stored for a place, or `None` if it is not tracked.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:218 try_get
  try_get<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V>): V | undefined {
    const place_ = map.find(place);
    if (place_ === undefined) return undefined;
    return State.try_get_idx(self, place_, map, V_);
  },

  /// Retrieve the discriminant stored for a place, or `None` if it is not tracked.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:224 try_get_discr
  try_get_discr<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V>): V | undefined {
    const place_ = map.find_discr(place);
    if (place_ === undefined) return undefined;
    return State.try_get_idx(self, place_, map, V_);
  },

  /// Retrieve the value stored for a place index, or `None` if it is not tracked.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:230 try_get_idx
  try_get_idx<V>(self: State<V>, place: PlaceIndex, map: Map, V_: StateV<V>): V | undefined {
    switch (self.$) {
      case "Reachable": {
        const values = self._0;
        const v = map.places[place]!.value_index;
        return v === undefined ? undefined : V_.clone(values.get(v));
      }
      case "Unreachable":
        return undefined;
    }
  },

  /// Retrieve the value stored for a place, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ if the place is tracked and the state is unreachable.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:242 get
  get<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V> & HasTop<V>): V {
    switch (self.$) {
      case "Reachable": {
        const v = State.try_get(self, place, map, V_);
        return v === undefined ? V_.TOP : v;
      }
      // Because this is unreachable, we can return any value we want.
      case "Unreachable":
        return V_.BOTTOM;
    }
  },

  /// Retrieve the value stored for a place, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ the current state is unreachable.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:256 get_discr
  get_discr<V>(self: State<V>, place: PlaceRef, map: Map, V_: StateV<V> & HasTop<V>): V {
    switch (self.$) {
      case "Reachable": {
        const v = State.try_get_discr(self, place, map, V_);
        return v === undefined ? V_.TOP : v;
      }
      // Because this is unreachable, we can return any value we want.
      case "Unreachable":
        return V_.BOTTOM;
    }
  },

  /// Retrieve the value stored for a place index, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ the current state is unreachable.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:270 get_idx
  get_idx<V>(self: State<V>, place: PlaceIndex, map: Map, V_: StateV<V> & HasTop<V>): V {
    switch (self.$) {
      case "Reachable": {
        const values = self._0;
        const v = map.places[place]!.value_index;
        return v === undefined ? V_.TOP : V_.clone(values.get(v));
      }
      case "Unreachable":
        // Because this is unreachable, we can return any value we want.
        return V_.BOTTOM;
    }
  },
};

/** `impl<V: JoinSemiLattice + Clone> JoinSemiLattice for State<V>`. */
export function JoinSemiLattice_State<V>(V_: ValueJoinSemiLattice<V> & CloneV<V>): {
  eq(a: State<V>, b: State<V>): boolean;
  join(self: State<V>, other: State<V>): boolean;
} {
  const clone = Clone_State(V_);
  const data = JoinSemiLattice_StateData(V_);
  return {
    eq: State_eq(V_.eq),

    // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:287 join
    join(self: State<V>, other: State<V>): boolean {
      if (other.$ === "Unreachable") {
        return false;
      } else if (self.$ === "Unreachable") {
        State.assign_(self, clone.clone(other));
        return true;
      } else {
        return data.join(self._0, other._0);
      }
    },
  };
}

/** `FxIndexSet<(PlaceIndex, PlaceIndex)>`: insertion-ordered, indexable (header). */
class PairIndexSet {
  readonly items: [PlaceIndex, PlaceIndex][] = [];
  readonly keys = new Set<string>();

  insert(pair: [PlaceIndex, PlaceIndex]): boolean {
    const key = `${pair[0]},${pair[1]}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.items.push(pair);
    return true;
  }

  get_index(i: number): [PlaceIndex, PlaceIndex] | undefined {
    return this.items[i];
  }
}

/// Partial mapping from [`Place`] to [`PlaceIndex`], where some places also have a [`ValueIndex`].
///
/// This data structure essentially maintains a tree of places and their projections. Some
/// additional bookkeeping is done, to speed up traversal over this tree:
/// - For iteration, every [`PlaceInfo`] contains an intrusive linked list of its children.
/// - To directly get the child for a specific projection, there is a `projections` map.
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:306 Map
export class Map {
  constructor(
    public locals: (PlaceIndex | undefined)[],
    // PORT: `FxHashMap<(PlaceIndex, TrackElem), PlaceIndex>`, keyed by `TrackElem_key(place, elem)`.
    public projections: globalThis.Map<string, PlaceIndex>,
    public places: PlaceInfo[],
    public value_count: number,
    public mode: PlaceCollectionMode,
    // The Range corresponds to a slice into `inner_values_buffer`.
    public inner_values: Range[],
    public inner_values_buffer: ValueIndex[],
  ) {}

  /// Returns a map that only tracks places whose type has scalar layout.
  ///
  /// This is currently the only way to create a [`Map`]. The way in which the tracked places are
  /// chosen is an implementation detail and may not be relied upon (other than that their type
  /// are scalars).
  // #[tracing::instrument(level = "trace", skip(tcx, body))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:330 new
  static new(tcx: TyCtxt, body: Body, mode: PlaceCollectionMode): Map {
    // tracing::trace!(def_id=?body.source.def_id());
    // let capacity = 4 * body.local_decls.len();
    const map = new Map(
      body.local_decls.map(() => undefined),
      new globalThis.Map(),
      [],
      0,
      mode,
      [],
      [],
    );
    map.register_locals(tcx, body);
    switch (mode.$) {
      case "Full": {
        const value_limit = mode.value_limit;
        map.collect_places(tcx, body);
        map.propagate_assignments(tcx, body);
        map.create_values(tcx, body, value_limit);
        map.trim_useless_places();
        break;
      }
      case "OnDemand":
        break;
    }
    // debug!("registered {} places ({} nodes in total)", map.value_count, map.places.len());
    return map;
  }

  /// Register all non-excluded places that have scalar layout.
  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:358 register_locals
  register_locals(tcx: TyCtxt, body: Body): void {
    const exclude = excluded_locals(body);

    // Start by constructing the places for each bare local.
    for (let i = 0; i < body.local_decls.length; i++) {
      const local = i as Local;
      const decl = body.local_decls[i]!;
      if (exclude.contains(local)) {
        continue;
      }
      if (decl.ty.is_async_drop_in_place_coroutine(tcx)) {
        continue;
      }

      // Create a place for the local.
      // debug_assert!(self.locals[local].is_none());
      const place = this.places.length as PlaceIndex;
      this.places.push(PlaceInfo.new(decl.ty, undefined));
      this.locals[local] = place;
    }
  }

  /// Collect syntactic places from body, and create `PlaceIndex` for them.
  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:379 collect_places
  collect_places(tcx: TyCtxt, body: Body): void {
    const collector = new PlaceCollector(tcx, body, this);
    collector.visit_body(body);
  }

  /// Just collecting syntactic places is not enough. We may need to propagate this pattern:
  ///      _1 = (const 5u32, const 13i64);
  ///      _2 = _1;
  ///      _3 = (_2.0 as u32);
  ///
  /// `_1.0` does not appear, but we still need to track it. This is achieved by propagating
  /// projections from assignments. We recorded an assignment between `_2` and `_1`, so we
  /// want `_1` and `_2` to have the same sub-places.
  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:393 propagate_assignments
  propagate_assignments(tcx: TyCtxt, body: Body): void {
    // Collect syntactic places and assignments between them.
    const assignments = new PairIndexSet();

    for (const bbdata of body.basic_blocks.deref()) {
      for (const stmt of bbdata.statements) {
        const assign = stmt.kind.$ === "Assign" ? stmt.kind._0 : undefined;
        if (assign === undefined) continue;
        const [lhs_, rhs_] = assign;
        if ((rhs_.$ === "Use" && (rhs_._0.$ === "Move" || rhs_._0.$ === "Copy")) || rhs_.$ === "CopyForDeref") {
          const rhs_place = rhs_.$ === "Use" ? (rhs_._0 as { _0: Place })._0 : rhs_._0;
          const lhs = this.register_place_and_discr(tcx, body, lhs_);
          if (lhs === undefined) {
            continue;
          }
          const rhs = this.register_place_and_discr(tcx, body, rhs_place);
          if (rhs === undefined) {
            continue;
          }
          assignments.insert([lhs, rhs]);
        } else if (rhs_.$ === "Aggregate") {
          const [kind, fields] = [rhs_._0, rhs_._1];
          let lhs = this.register_place_and_discr(tcx, body, lhs_);
          if (lhs === undefined) {
            continue;
          }
          switch (kind.$) {
            case "Adt": {
              // Do not propagate unions.
              if (kind._4 !== undefined) continue;
              const variant = kind._1;
              const ty = this.places[lhs]!.ty;
              if (ty.is_enum()) {
                lhs = this.register_place_index(ty, lhs, { $: "Variant", _0: variant });
              }
              break;
            }
            case "RawPtr":
            case "Array":
            case "Tuple":
            case "Closure":
            case "Coroutine":
            case "CoroutineClosure":
              break;
          }
          for (let index = 0; index < fields.length; index++) {
            const field = fields[index]!;
            const rhs_place = field.$ === "Copy" || field.$ === "Move" ? field._0 : undefined;
            if (rhs_place !== undefined) {
              const rhs = this.register_place_and_discr(tcx, body, rhs_place);
              if (rhs !== undefined) {
                const lhs_f = this.register_place_index(this.places[rhs]!.ty, lhs, { $: "Field", _0: FieldIdxC.from_usize(index) });
                assignments.insert([lhs_f, rhs]);
              }
            }
          }
        }
      }
    }

    // This is a fixpoint loop does. While we are still creating places, run through
    // all the assignments, and register places for children.
    let num_places = 0;
    while (num_places < this.places.length) {
      num_places = this.places.length;

      for (let assign = 0; ; assign++) {
        const pair = assignments.get_index(assign);
        if (pair === undefined) break;
        const [lhs, rhs] = pair;

        // Mirror children from `lhs` in `rhs`.
        let child = this.places[lhs]!.first_child;
        while (child !== undefined) {
          const lhs_child = child;
          const { ty, proj_elem, next_sibling } = this.places[lhs_child]!;
          const rhs_child = this.register_place_index(ty, rhs, unwrap(proj_elem, "child is not a projection"));
          assignments.insert([lhs_child, rhs_child]);
          child = next_sibling;
        }

        // Conversely, mirror children from `rhs` in `lhs`.
        child = this.places[rhs]!.first_child;
        while (child !== undefined) {
          const rhs_child = child;
          const { ty, proj_elem, next_sibling } = this.places[rhs_child]!;
          const lhs_child = this.register_place_index(ty, lhs, unwrap(proj_elem, "child is not a projection"));
          assignments.insert([lhs_child, rhs_child]);
          child = next_sibling;
        }
      }
    }
  }

  /// Create values for places whose type have scalar layout.
  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:493 create_values
  create_values(tcx: TyCtxt, body: Body, value_limit: number | undefined): void {
    // debug_assert_matches!(self.mode, PlaceCollectionMode::Full { .. });
    const typing_env = body.typing_env(tcx);
    for (const place_info of this.places) {
      // The user requires a bound on the number of created values.
      if (value_limit !== undefined && this.value_count >= value_limit) {
        break;
      }

      const ty = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(place_info.ty), fold_Ty);
      if (ty.$ === "Ok") {
        place_info.ty = ty._0;
      }

      // Allocate a value slot if it doesn't have one, and the user requested one.
      if (place_info.value_index !== undefined) panic("assertion failed: place_info.value_index.is_none()");
      const layout = tcx.layout_of(typing_env.as_query_input(place_info.ty));
      if (layout.$ === "Ok" && BackendRepr.is_scalar(layout._0.backend_repr)) {
        place_info.value_index = this.value_count as ValueIndex;
        this.value_count += 1;
      }
    }

    // Pre-compute the tree of ValueIndex nested in each PlaceIndex.
    // `inner_values_buffer[inner_values[place]]` is the set of all the values
    // reachable by projecting `place`.
    this.inner_values_buffer = [];
    this.inner_values = this.places.map(() => ({ start: 0, end: 0 }));
    for (let local = 0; local < body.local_decls.length; local++) {
      const place = this.locals[local];
      if (place !== undefined) {
        this.cache_preorder_invoke(place);
      }
    }
  }

  /// Trim useless places.
  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:534 trim_useless_places
  trim_useless_places(): void {
    // debug_assert_matches!(self.mode, PlaceCollectionMode::Full { .. });
    for (let i = 0; i < this.locals.length; i++) {
      const place = this.locals[i];
      if (place !== undefined && range_is_empty(this.inner_values[place]!)) {
        this.locals[i] = undefined;
      }
    }
    // #[allow(rustc::potential_query_instability)]
    for (const [key, child] of [...this.projections]) {
      if (range_is_empty(this.inner_values[child]!)) this.projections.delete(key);
    }
  }

  // #[tracing::instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:548 register_place_index
  register_place_index(ty: Ty, base: PlaceIndex, elem: TrackElem): PlaceIndex {
    const key = TrackElem_key(base, elem);
    const existing = this.projections.get(key);
    if (existing !== undefined) return existing;
    const next = this.places.length as PlaceIndex;
    this.places.push(PlaceInfo.new(ty, elem));
    this.places[next]!.next_sibling = this.places[base]!.first_child;
    this.places[base]!.first_child = next;
    this.projections.set(key, next);
    return next;
  }

  // #[tracing::instrument(level = "trace", skip(self, tcx, body), ret)]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:563 register_place
  register_place(tcx: TyCtxt, body: Body, place: Place, tail: TrackElem | undefined): PlaceIndex | undefined {
    // Create a place for this projection.
    let place_index = this.locals[place.local];
    if (place_index === undefined) return undefined;
    let ty = PlaceTy.from_ty(body.local_decls[place.local]!.ty);
    // tracing::trace!(?place_index, ?ty);

    for (const proj of place.projection) {
      const track_elem = TrackElem.try_from(proj);
      if (track_elem.$ !== "Ok") return undefined;
      ty = ty.projection_ty(tcx, proj, debug_Local);
      place_index = this.register_place_index(ty.ty, place_index, track_elem._0);
      // tracing::trace!(?proj, ?place_index, ?ty);
    }

    if (tail !== undefined) {
      let ty_: Ty;
      switch (tail.$) {
        case "Discriminant":
          ty_ = ty.ty.discriminant_ty(tcx);
          break;
        case "Variant":
        case "Field":
          return panic("not implemented");
        case "DerefLen":
          ty_ = tcx.types.usize;
          break;
      }
      place_index = this.register_place_index(ty_, place_index, tail);
    }

    return place_index;
  }

  // #[tracing::instrument(level = "trace", skip(self, tcx, body), ret)]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:595 register_place_and_discr
  register_place_and_discr(tcx: TyCtxt, body: Body, place: Place): PlaceIndex | undefined {
    const place_ = this.register_place(tcx, body, place, undefined);
    if (place_ === undefined) return undefined;
    const ty = this.places[place_]!.ty;

    const k = ty.kind();
    const ref_ty = k.$ === "Ref" ? k._1 : k.$ === "RawPtr" ? k._0 : undefined;
    if (ref_ty !== undefined && ref_ty.kind().$ === "Slice") {
      this.register_place_index(tcx.types.usize, place_, TrackElem.DerefLen);
    } else if (ty.is_enum()) {
      const discriminant_ty = ty.discriminant_ty(tcx);
      this.register_place_index(discriminant_ty, place_, TrackElem.Discriminant);
    }

    return place_;
  }

  // #[tracing::instrument(level = "trace", skip(self, tcx, typing_env), ret)]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:617 register_value
  register_value(tcx: TyCtxt, typing_env: TypingEnv, place: PlaceIndex): ValueIndex | undefined {
    const place_info = this.places[place]!;
    if (place_info.value_index !== undefined) {
      return place_info.value_index;
    }

    const ty = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(place_info.ty), fold_Ty);
    if (ty.$ === "Ok") {
      place_info.ty = ty._0;
    }

    // Allocate a value slot if it doesn't have one, and the user requested one.
    const layout = tcx.layout_of(typing_env.as_query_input(place_info.ty));
    if (layout.$ === "Ok" && BackendRepr.is_scalar(layout._0.backend_repr)) {
      place_info.value_index = this.value_count as ValueIndex;
      this.value_count += 1;
    }

    return place_info.value_index;
  }

  // #[tracing::instrument(level = "trace", skip(self, f))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:646 register_copy_tree
  register_copy_tree(
    // Tree to copy.
    source: PlaceIndex,
    // Tree to build.
    target: PlaceIndex,
    f: (source: ValueIndex, target: ValueIndex) => void,
  ): void {
    const source_value = this.places[source]!.value_index;
    if (source_value !== undefined) {
      const target_info = this.places[target]!;
      if (target_info.value_index === undefined) {
        const value_index = this.value_count as ValueIndex;
        this.value_count += 1;
        target_info.value_index = value_index;
      }
      const target_value = target_info.value_index;
      f(source_value, target_value);
    }

    // Iterate over `source` children and recurse.
    let source_child_iter = this.places[source]!.first_child;
    while (source_child_iter !== undefined) {
      const source_child = source_child_iter;
      source_child_iter = this.places[source_child]!.next_sibling;

      // Try to find corresponding child and recurse. Reasoning is similar as above.
      const source_info = this.places[source_child]!;
      const source_ty = source_info.ty;
      const source_elem = unwrap(source_info.proj_elem);
      const target_child = this.register_place_index(source_ty, target, source_elem);
      this.register_copy_tree(source_child, target_child, f);
    }
  }

  /// Precompute the list of values inside `root` and store it inside
  /// as a slice within `inner_values_buffer`.
  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:680 cache_preorder_invoke
  cache_preorder_invoke(root: PlaceIndex): void {
    // debug_assert_matches!(self.mode, PlaceCollectionMode::Full { .. });
    const start = this.inner_values_buffer.length;
    const vi = this.places[root]!.value_index;
    if (vi !== undefined) {
      this.inner_values_buffer.push(vi);
    }

    // We manually iterate instead of using `children` as we need to mutate `self`.
    let next_child = this.places[root]!.first_child;
    while (next_child !== undefined) {
      const child = next_child;
      this.cache_preorder_invoke(child);
      next_child = this.places[child]!.next_sibling;
    }

    const end = this.inner_values_buffer.length;
    this.inner_values[root] = { start, end };
  }

  // ---- impl<'tcx> Map<'tcx> (value_analysis.rs:716; PORTING §8: a later impl block inside the class body) ----

  /// Applies a single projection element, yielding the corresponding child.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:718 apply
  apply(place: PlaceIndex, elem: TrackElem): PlaceIndex | undefined {
    return this.projections.get(TrackElem_key(place, elem));
  }

  /// Locates the given place, if it exists in the tree.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:723 find_extra
  find_extra(place: PlaceRef, extra: Iterable<TrackElem>): PlaceIndex | undefined {
    let index = this.locals[place.local];
    if (index === undefined) return undefined;

    for (const elem of place.projection) {
      const e = TrackElem.try_from(elem);
      if (e.$ !== "Ok") return undefined;
      index = this.apply(index, e._0);
      if (index === undefined) return undefined;
    }
    for (const elem of extra) {
      index = this.apply(index, elem);
      if (index === undefined) return undefined;
    }

    return index;
  }

  /// Locates the given place, if it exists in the tree.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:741 find
  find(place: PlaceRef): PlaceIndex | undefined {
    return this.find_extra(place, []);
  }

  /// Locates the given place and applies `Discriminant`, if it exists in the tree.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:746 find_discr
  find_discr(place: PlaceRef): PlaceIndex | undefined {
    return this.find_extra(place, [TrackElem.Discriminant]);
  }

  /// Locates the given place and applies `DerefLen`, if it exists in the tree.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:751 find_len
  find_len(place: PlaceRef): PlaceIndex | undefined {
    return this.find_extra(place, [TrackElem.DerefLen]);
  }

  /// Locates the value corresponding to the given place.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:756 value
  value(place: PlaceIndex): ValueIndex | undefined {
    return this.places[place]!.value_index;
  }

  /// Iterate over all direct children.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:761 children
  children(parent: PlaceIndex): Iterable<PlaceIndex> {
    return Children.new(this, parent);
  }

  /// Invoke a function on the given place and all places that may alias it.
  ///
  /// In particular, when the given place has a variant downcast, we invoke the function on all
  /// the other variants.
  ///
  /// `tail_elem` allows to support discriminants that are not a place in MIR, but that we track
  /// as such.
  // #[tracing::instrument(level = "trace", skip(self, f))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:773 for_each_aliasing_place
  for_each_aliasing_place(place: PlaceRef, tail_elem: TrackElem | undefined, f: (value: ValueIndex) => void): void {
    if (place.is_indirect_first_projection()) {
      // We do not track indirect places.
      return;
    }
    let index = this.locals[place.local];
    if (index === undefined) {
      // The local is not tracked at all, so it does not alias anything.
      return;
    }
    const elems: Result<TrackElem, null>[] = place.projection.map((elem) => TrackElem.try_from(elem));
    if (tail_elem !== undefined) elems.push(Ok(tail_elem));
    for (const elem_ of elems) {
      // A field aliases the parent place.
      const vi = this.places[index]!.value_index;
      if (vi !== undefined) {
        f(vi);
      }

      if (elem_.$ !== "Ok") return;
      const elem = elem_._0;
      const sub = this.apply(index, elem);
      if (elem.$ === "Variant" || elem.$ === "Discriminant") {
        // Enum variant fields and enum discriminants alias each another.
        this.for_each_variant_sibling(index, sub, f);
      }
      if (sub === undefined) return;
      index = sub;
    }
    this.for_each_value_inside(index, f);
  }

  /// Invoke the given function on all the descendants of the given place, except one branch.
  // #[tracing::instrument(level = "trace", skip(self, f))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:808 for_each_variant_sibling
  for_each_variant_sibling(parent: PlaceIndex, preserved_child: PlaceIndex | undefined, f: (value: ValueIndex) => void): void {
    for (const sibling of this.children(parent)) {
      const elem = this.places[sibling]!.proj_elem;
      // Only invalidate variants and discriminant. Fields (for coroutines) are not
      // invalidated by assignment to a variant.
      if (
        elem !== undefined &&
        (elem.$ === "Variant" || elem.$ === "Discriminant") &&
        // Only invalidate the other variants, the current one is fine.
        sibling !== preserved_child
      ) {
        this.for_each_value_inside(sibling, f);
      }
    }
  }

  /// Invoke a function on each value in the given place and all descendants.
  // #[tracing::instrument(level = "trace", skip(self, f))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:829 for_each_value_inside
  for_each_value_inside(root: PlaceIndex, f: (value: ValueIndex) => void): void {
    const range = this.inner_values[root];
    if (range !== undefined) {
      // Optimized path: we have cached the inner values.
      for (let i = range.start; i < range.end; i++) {
        f(this.inner_values_buffer[i]!);
      }
    } else {
      const root_ = this.places[root]!.value_index;
      if (root_ !== undefined) {
        f(root_);
      }

      for (const child of this.children(root)) {
        this.for_each_value_inside(child, f);
      }
    }
  }

  /// Invoke a function on each value in the given place and all descendants.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:848 for_each_projection_value
  for_each_projection_value<O>(
    root: PlaceIndex,
    value: O,
    project: (elem: TrackElem, value: O) => O | undefined,
    f: (place: PlaceIndex, value: O) => void,
  ): void {
    // Fast path is there is nothing to do.
    const value_range = this.inner_values[root];
    if (value_range !== undefined && range_is_empty(value_range)) {
      return;
    }

    if (this.places[root]!.value_index !== undefined) {
      f(root, value);
    }

    for (const child of this.children(root)) {
      const elem = unwrap(this.places[child]!.proj_elem);
      const value_ = project(elem, value);
      if (value_ !== undefined) {
        this.for_each_projection_value(child, value_, project, f);
      }
    }
  }

  /// Recursively iterates on each value contained in `target`, paired with matching projection
  /// inside `source`.
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:876 for_each_value_pair
  for_each_value_pair(target: PlaceIndex, source: PlaceIndex, f: (target: ValueIndex, source: ValueIndex) => void): void {
    // If both places are tracked, we copy the value to the target.
    // If the target is tracked, but the source is not, we do nothing, as invalidation has
    // already been performed.
    const target_value = this.places[target]!.value_index;
    const source_value = this.places[source]!.value_index;
    if (target_value !== undefined && source_value !== undefined) {
      f(target_value, source_value);
    }
    for (const target_child of this.children(target)) {
      // Try to find corresponding child and recurse. Reasoning is similar as above.
      const projection = unwrap(this.places[target_child]!.proj_elem);
      const source_child = this.projections.get(TrackElem_key(source, projection));
      if (source_child !== undefined) {
        this.for_each_value_pair(target_child, source_child, f);
      }
    }
  }
}

/** `Range::is_empty`. */
function range_is_empty(r: Range): boolean {
  return !(r.start < r.end);
}

// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:318 PlaceCollectionMode
export type PlaceCollectionMode =
  | { readonly $: "Full"; readonly value_limit: number | undefined }
  | { readonly $: "OnDemand" };

// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:699 PlaceCollector
class PlaceCollector extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public map: Map,
  ) {
    super();
  }

  /** `impl<'tcx> Visitor<'tcx> for PlaceCollector<'_, 'tcx>`. */
  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:707 visit_place
  override visit_place(place: Place, ctxt: PlaceContext, _location: Location): void {
    if (!PlaceContextC.is_use(ctxt)) {
      return;
    }

    this.map.register_place_and_discr(this.tcx, this.body, place);
  }
}

/// This is the information tracked for every [`PlaceIndex`] and is stored by [`Map`].
///
/// Together, `first_child` and `next_sibling` form an intrusive linked list, which is used to
/// model a tree structure (a replacement for a member like `children: Vec<PlaceIndex>`).
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:905 PlaceInfo
class PlaceInfo {
  constructor(
    /// Type of the referenced place.
    public ty: Ty,

    /// We store a [`ValueIndex`] if and only if the placed is tracked by the analysis.
    public value_index: ValueIndex | undefined,

    /// The projection used to go from parent to this node (only None for root).
    public proj_elem: TrackElem | undefined,

    /// The leftmost child.
    public first_child: PlaceIndex | undefined,

    /// Index of the sibling to the right of this node.
    public next_sibling: PlaceIndex | undefined,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:923 new
  static new(ty: Ty, proj_elem: TrackElem | undefined): PlaceInfo {
    return new PlaceInfo(ty, undefined, proj_elem, undefined, undefined);
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:928 Children
class Children implements IterableIterator<PlaceIndex> {
  constructor(
    public map: Map,
    public next_: PlaceIndex | undefined,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:934 new
  static new(map: Map, parent: PlaceIndex): Children {
    return new Children(map, map.places[parent]!.first_child);
  }

  /** `impl Iterator for Children<'_, '_>` (`type Item = PlaceIndex`). */
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:942 next
  next(): IteratorResult<PlaceIndex> {
    const child = this.next_;
    if (child !== undefined) {
      this.next_ = this.map.places[child]!.next_sibling;
      return { done: false, value: child };
    } else {
      return { done: true, value: undefined };
    }
  }

  [Symbol.iterator](): IterableIterator<PlaceIndex> {
    return this;
  }
}

/// Used as the result of an operand or r-value.
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:955 ValueOrPlace
export type ValueOrPlace<V> = { readonly $: "Value"; readonly _0: V } | { readonly $: "Place"; readonly _0: PlaceIndex };

export const ValueOrPlace = {
  /** `impl<V: HasTop> ValueOrPlace<V> { pub const TOP: Self = ValueOrPlace::Value(V::TOP); }` */
  TOP<V>(V_: HasTop<V>): ValueOrPlace<V> {
    return { $: "Value", _0: V_.TOP };
  },
};

/// The set of projection elements that can be used by a tracked place.
///
/// Although only field projections are currently allowed, this could change in the future.
// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:968 TrackElem
export type TrackElem =
  | { readonly $: "Field"; readonly _0: FieldIdx }
  | { readonly $: "Variant"; readonly _0: VariantIdx }
  | { readonly $: "Discriminant" }
  // Length of a slice.
  | { readonly $: "DerefLen" };

export const TrackElem = {
  Discriminant: Object.freeze({ $: "Discriminant" }) as TrackElem,
  DerefLen: Object.freeze({ $: "DerefLen" }) as TrackElem,

  /** `impl<V, T> TryFrom<ProjectionElem<V, T>> for TrackElem` (`type Error = ()`). */
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:979 try_from
  try_from<V, T>(value: ProjectionElem<V, T>): Result<TrackElem, null> {
    switch (value.$) {
      case "Field":
        return Ok({ $: "Field", _0: value._0 });
      case "Downcast":
        return Ok({ $: "Variant", _0: value._1 });
      default:
        return Err(null);
    }
  },
};

/** The key of `(PlaceIndex, TrackElem)` in `Map.projections` (derived `Hash` + `Eq`). */
export function TrackElem_key(place: PlaceIndex, elem: TrackElem): string {
  return elem.$ === "Field" || elem.$ === "Variant" ? `${place}:${elem.$}:${elem._0}` : `${place}:${elem.$}`;
}

/** The derived `PartialEq` of `TrackElem`. */
export function TrackElem_eq(a: TrackElem, b: TrackElem): boolean {
  return a.$ === b.$ && ((a.$ !== "Field" && a.$ !== "Variant") || a._0 === (b as typeof a)._0);
}

/// Invokes `f` on all direct fields of `ty`.
// rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:989 iter_fields
export function iter_fields(
  ty: Ty,
  tcx: TyCtxt,
  typing_env: TypingEnv,
  f: (variant: VariantIdx | undefined, field: FieldIdx, ty: Ty) => void,
): void {
  const k = ty.kind();
  switch (k.$) {
    case "Tuple": {
      const list = k._0;
      list.forEach((ty, field) => {
        f(undefined, FieldIdxC.from_usize(field), ty);
      });
      break;
    }
    case "Adt": {
      const [def, args] = [k._0, k._1];
      if (def.is_union()) {
        return;
      }
      def.variants().forEach((v_def, v_index_) => {
        const v_index = v_index_ as VariantIdx;
        const variant = def.is_struct() ? undefined : v_index;
        v_def.fields.forEach((f_def, f_index) => {
          const field_ty = f_def.ty(tcx, args);
          const r = tcx.try_normalize_erasing_regions(typing_env, field_ty, fold_Ty);
          const field_ty_ = r.$ === "Ok" ? r._0 : tcx.erase_and_anonymize_regions(Unnormalized.skip_norm_wip(field_ty), fold_Ty);
          f(variant, FieldIdxC.from_usize(f_index), field_ty_);
        });
      });
      break;
    }
    case "Closure": {
      const args = k._1;
      iter_fields(ClosureArgs.tupled_upvars_ty(args.as_closure()), tcx, typing_env, f);
      break;
    }
    case "Coroutine": {
      const args = k._1;
      iter_fields(CoroutineArgs.tupled_upvars_ty(args.as_coroutine()), tcx, typing_env, f);
      break;
    }
    case "CoroutineClosure": {
      const args = k._1;
      iter_fields(CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()), tcx, typing_env, f);
      break;
    }
    default:
      break;
  }
}

/// Returns all locals with projections that have their reference or address taken.
// rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:1031 excluded_locals
export function excluded_locals(body: Body): GrowableBitSet<Local> {
  const collector = new excluded_locals_Collector(GrowableBitSet.new_empty());
  collector.visit_body(body);
  return collector.result;
}

/** `struct Collector` local to `excluded_locals` (hoisted). */
class excluded_locals_Collector extends Visitor {
  constructor(public result: GrowableBitSet<Local>) {
    super();
  }

  /** `impl<'tcx> Visitor<'tcx> for Collector`. */
  // rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:1037 visit_place
  override visit_place(place: Place, context: PlaceContext, _location: Location): void {
    if (PlaceContextC.may_observe_address(context) && !place.is_indirect()) {
      // A pointer to a place could be used to access other places with the same local,
      // hence we have to exclude the local completely.
      this.result.insert(place.local);
    }
  }
}

/** `V: Debug + Eq + HasBottom`. */
type DebugV<V> = HasBottom<V> & { eq(a: V, b: V): boolean; fmt: Debug<V> };

// rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:1051 debug_with_context_rec
function debug_with_context_rec<V>(
  place: PlaceIndex,
  place_str: string,
  new_: StateData<V>,
  old: StateData<V> | undefined,
  map: Map,
  f: Fmt,
  V_: DebugV<V>,
): string {
  let out = "";
  const value = map.places[place]!.value_index;
  if (value !== undefined) {
    if (old === undefined) {
      out += `${place_str}: ${V_.fmt(new_.get(value), PLAIN)}\n`;
    } else {
      if (!V_.eq(new_.get(value), old.get(value))) {
        out += `\u{001f}-${place_str}: ${V_.fmt(old.get(value), PLAIN)}\n`;
        out += `\u{001f}+${place_str}: ${V_.fmt(new_.get(value), PLAIN)}\n`;
      }
    }
  }

  for (const child of map.children(place)) {
    const info_elem = unwrap(map.places[child]!.proj_elem);
    let child_place_str: string;
    switch (info_elem.$) {
      case "Discriminant":
        child_place_str = `discriminant(${place_str})`;
        break;
      case "Variant":
        // `{idx:?}`: `VariantIdx` has no `debug_format` (the number).
        child_place_str = `(${place_str} as ${info_elem._0})`;
        break;
      case "Field": {
        const field = info_elem._0;
        if (place_str.startsWith("*")) {
          child_place_str = `(${place_str}).${field}`;
        } else {
          child_place_str = `${place_str}.${field}`;
        }
        break;
      }
      case "DerefLen":
        child_place_str = `Len(*${place_str})`;
        break;
    }
    out += debug_with_context_rec(child, child_place_str, new_, old, map, f, V_);
  }

  return out;
}

// rustc: compiler/rustc_mir_dataflow/src/value_analysis.rs:1097 debug_with_context
export function debug_with_context<V>(new_: StateData<V>, old: StateData<V> | undefined, map: Map, f: Fmt, V_: DebugV<V>): string {
  let out = "";
  map.locals.forEach((place, local) => {
    if (place !== undefined) {
      out += debug_with_context_rec(place, debug_Local(local as Local, PLAIN), new_, old, map, f, V_);
    }
  });
  return out;
}
