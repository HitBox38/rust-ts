// Port of compiler/rustc_mir_dataflow/src/value_analysis.rs: DECLARED (lane dataflow-contract). The types are declared
// here with their final shape; every fn is a stub for lane `mt-opt2-a` (plan-m4 §5 wave 26: the level >= 2 passes,
// `dataflow_const_prop` / `jump_threading`, are its only users).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub-df: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Representation (fill lanes keep it):
// - `PlaceIndex` / `ValueIndex` are branded numbers with `newtype_index!` companions (no `debug_format`: `{}`).
// - `State<V>` is the upstream enum as a mutable tagged union (a dataflow domain, mutated in place like `MaybeReachable`,
//   framework/lattice.ts header): `Unreachable` is a fresh `{ $: "Unreachable" }` (`State.Unreachable()`), `*self = v`
//   is `State.assign_(self, v)` (upstream `State::assign` exists); its inherent methods are on the `State` companion (PORTING §8). `StateData<V>` is a
//   class (fields `bottom`, `map`), mutated in place.
// - Trait bounds on `V` are impl tables passed last (`V_`): `V: HasBottom + Clone` is `V_: HasBottom<V> & Clone<V>`,
//   `+ HasTop` adds `HasTop<V>`, `JoinSemiLattice` adds `JoinSemiLattice<V>` (its `eq` is the `Eq` bound), `Debug` is
//   `Debug<V>`. `impl Clone / JoinSemiLattice for StateData<V> / State<V>` are the functions `Clone_StateData(V_)`,
//   `JoinSemiLattice_StateData(V_)`, `Clone_State(V_)`, `JoinSemiLattice_State(V_)`; the derived `PartialEq` is
//   `StateData_eq` / `State_eq`.
// - The upstream struct `Map` shadows the JS global `Map` in this module: `FxHashMap`s are `globalThis.Map`.
//   `FxHashMap<(PlaceIndex, TrackElem), PlaceIndex>` is keyed by `TrackElem_key(place, elem)` (PORTING §5 composite
//   keys); `FxHashMap<ValueIndex, V>` keys on the handle. `Range<usize>` is `Range` (`{ start, end }`).
// - `impl Visitor for PlaceCollector` / for `excluded_locals`'s local `Collector` are classes with `visit_place`; they
//   extend mir-contract's `Visitor` (D4) when it lands. `TryFrom<ProjectionElem<V, T>> for TrackElem` is
//   `TrackElem.try_from(value)` returning `Result<TrackElem, null>`. `impl FnMut(..)` parameters are closures;
//   `-> impl Iterator` is an `Iterable`.
// - `debug_with_context(_rec)` write into a `Formatter`: they return the written string (std/fmt.ts).

import type { FieldIdx, VariantIdx } from "../rustc_abi/layout.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Debug, Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { HasBottom, HasTop, JoinSemiLattice } from "./framework/lattice.ts";
import type { Clone } from "./framework/mod.ts";
import type { Body, Local, Location, Place, PlaceRef } from "./pending.ts";

// PORT(contract): pending mir-contract
type PlaceContext = { readonly __pending_mir: "PlaceContext" };
type ProjectionElem<_V, _T> = { readonly __pending_mir: "ProjectionElem" };
// PORT(contract): pending index-ds (`rustc_index::bit_set::GrowableBitSet`)
type GrowableBitSet<T> = { readonly __pending_index_ds: "GrowableBitSet"; readonly __t?: T };

/** `std::ops::Range<usize>`. */
interface Range {
  start: number;
  end: number;
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

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:39 new (lane mt-opt2-a)
  static new<V>(_V_: HasBottom<V>): StateData<V> {
    return unported("rustc_mir_dataflow::value_analysis::StateData::new");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:43 get (lane mt-opt2-a)
  get(_idx: ValueIndex): V {
    return unported("rustc_mir_dataflow::value_analysis::StateData::get");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:47 insert (lane mt-opt2-a)
  insert(_idx: ValueIndex, _elem: V, _V_: HasBottom<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::StateData::insert");
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
export function Clone_StateData<V>(_V_: Clone<V>): Clone<StateData<V>> {
  return {
    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:57 clone (lane mt-opt2-a)
    clone(_self: StateData<V>): StateData<V> {
      return unported("rustc_mir_dataflow::value_analysis::StateData::clone");
    },

    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:61 clone_from (lane mt-opt2-a)
    clone_from(_self: StateData<V>, _source: StateData<V>): void {
      return unported("rustc_mir_dataflow::value_analysis::StateData::clone_from");
    },
  };
}

/** `impl<V: JoinSemiLattice + Clone> JoinSemiLattice for StateData<V>`. */
export function JoinSemiLattice_StateData<V>(V_: JoinSemiLattice<V> & Clone<V>): JoinSemiLattice<StateData<V>> {
  return {
    eq: StateData_eq(V_.eq),

    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:67 join (lane mt-opt2-a)
    join(_self: StateData<V>, _other: StateData<V>): boolean {
      return unported("rustc_mir_dataflow::value_analysis::StateData::join");
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
export function Clone_State<V>(_V_: Clone<V>): Clone<State<V>> {
  return {
    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:100 clone (lane mt-opt2-a)
    clone(_self: State<V>): State<V> {
      return unported("rustc_mir_dataflow::value_analysis::State::clone");
    },

    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:107 clone_from (lane mt-opt2-a)
    clone_from(_self: State<V>, _source: State<V>): void {
      return unported("rustc_mir_dataflow::value_analysis::State::clone_from");
    },
  };
}

/** `V: Clone + HasBottom` (the bound of the inherent `impl State<V>` block). */
type StateV<V> = HasBottom<V> & Clone<V>;

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

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:118 new_reachable (lane mt-opt2-a)
  new_reachable<V>(_V_: StateV<V>): State<V> {
    return unported("rustc_mir_dataflow::value_analysis::State::new_reachable");
  },

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:122 is_reachable (lane mt-opt2-a)
  is_reachable<V>(_self: State<V>): boolean {
    return unported("rustc_mir_dataflow::value_analysis::State::is_reachable");
  },

  /// Assign `value` to all places that are contained in `place` or may alias one.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:127 flood_with (lane mt-opt2-a)
  flood_with<V>(_self: State<V>, _place: PlaceRef, _map: Map, _value: V, _V_: StateV<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::flood_with");
  },

  /// Assign `TOP` to all places that are contained in `place` or may alias one.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:132 flood (lane mt-opt2-a)
  flood<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V> & HasTop<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::flood");
  },

  /// Assign `value` to the discriminant of `place` and all places that may alias it.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:140 flood_discr_with (lane mt-opt2-a)
  flood_discr_with<V>(_self: State<V>, _place: PlaceRef, _map: Map, _value: V, _V_: StateV<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::flood_discr_with");
  },

  /// Assign `TOP` to the discriminant of `place` and all places that may alias it.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:145 flood_discr (lane mt-opt2-a)
  flood_discr<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V> & HasTop<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::flood_discr");
  },

  /// This method is the most general version of the `flood_*` method.
  ///
  /// Assign `value` on the given place and all places that may alias it. In particular, when
  /// the given place has a variant downcast, we invoke the function on all the other variants.
  ///
  /// `tail_elem` allows to support discriminants that are not a place in MIR, but that we track
  /// as such.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:159 flood_with_tail_elem (lane mt-opt2-a)
  flood_with_tail_elem<V>(
    _self: State<V>,
    _place: PlaceRef,
    _tail_elem: TrackElem | undefined,
    _map: Map,
    _value: V,
    _V_: StateV<V>,
  ): void {
    return unported("rustc_mir_dataflow::value_analysis::State::flood_with_tail_elem");
  },

  /// Low-level method that assigns to a place.
  /// This does nothing if the place is not tracked.
  ///
  /// The target place must have been flooded before calling this method.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:174 insert_idx (lane mt-opt2-a)
  insert_idx<V>(_self: State<V>, _target: PlaceIndex, _result: ValueOrPlace<V>, _map: Map, _V_: StateV<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::insert_idx");
  },

  /// Low-level method that assigns a value to a place.
  /// This does nothing if the place is not tracked.
  ///
  /// The target place must have been flooded before calling this method.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:185 insert_value_idx (lane mt-opt2-a)
  insert_value_idx<V>(_self: State<V>, _target: PlaceIndex, _value: V, _map: Map, _V_: StateV<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::insert_value_idx");
  },

  /// Copies `source` to `target`, including all tracked places beneath.
  ///
  /// If `target` contains a place that is not contained in `source`, it will be overwritten with
  /// Top. Also, because this will copy all entries one after another, it may only be used for
  /// places that are non-overlapping or identical.
  ///
  /// The target place must have been flooded before calling this method.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:199 insert_place_idx (lane mt-opt2-a)
  insert_place_idx<V>(_self: State<V>, _target: PlaceIndex, _source: PlaceIndex, _map: Map, _V_: StateV<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::insert_place_idx");
  },

  /// Helper method to interpret `target = result`.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:207 assign (lane mt-opt2-a)
  assign<V>(_self: State<V>, _target: PlaceRef, _result: ValueOrPlace<V>, _map: Map, _V_: StateV<V> & HasTop<V>): void {
    return unported("rustc_mir_dataflow::value_analysis::State::assign");
  },

  /// Retrieve the value stored for a place, or `None` if it is not tracked.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:218 try_get (lane mt-opt2-a)
  try_get<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V>): V | undefined {
    return unported("rustc_mir_dataflow::value_analysis::State::try_get");
  },

  /// Retrieve the discriminant stored for a place, or `None` if it is not tracked.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:224 try_get_discr (lane mt-opt2-a)
  try_get_discr<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V>): V | undefined {
    return unported("rustc_mir_dataflow::value_analysis::State::try_get_discr");
  },

  /// Retrieve the value stored for a place index, or `None` if it is not tracked.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:230 try_get_idx (lane mt-opt2-a)
  try_get_idx<V>(_self: State<V>, _place: PlaceIndex, _map: Map, _V_: StateV<V>): V | undefined {
    return unported("rustc_mir_dataflow::value_analysis::State::try_get_idx");
  },

  /// Retrieve the value stored for a place, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ if the place is tracked and the state is unreachable.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:242 get (lane mt-opt2-a)
  get<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V> & HasTop<V>): V {
    return unported("rustc_mir_dataflow::value_analysis::State::get");
  },

  /// Retrieve the value stored for a place, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ the current state is unreachable.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:256 get_discr (lane mt-opt2-a)
  get_discr<V>(_self: State<V>, _place: PlaceRef, _map: Map, _V_: StateV<V> & HasTop<V>): V {
    return unported("rustc_mir_dataflow::value_analysis::State::get_discr");
  },

  /// Retrieve the value stored for a place index, or ⊤ if it is not tracked.
  ///
  /// This method returns ⊥ the current state is unreachable.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:270 get_idx (lane mt-opt2-a)
  get_idx<V>(_self: State<V>, _place: PlaceIndex, _map: Map, _V_: StateV<V> & HasTop<V>): V {
    return unported("rustc_mir_dataflow::value_analysis::State::get_idx");
  },
};

/** `impl<V: JoinSemiLattice + Clone> JoinSemiLattice for State<V>`. */
export function JoinSemiLattice_State<V>(V_: JoinSemiLattice<V> & Clone<V>): JoinSemiLattice<State<V>> {
  return {
    eq: State_eq(V_.eq),

    // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:287 join (lane mt-opt2-a)
    join(_self: State<V>, _other: State<V>): boolean {
      return unported("rustc_mir_dataflow::value_analysis::State::join");
    },
  };
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
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:330 new (lane mt-opt2-a)
  static new(_tcx: TyCtxt, _body: Body, _mode: PlaceCollectionMode): Map {
    return unported("rustc_mir_dataflow::value_analysis::Map::new");
  }

  /// Register all non-excluded places that have scalar layout.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:358 register_locals (lane mt-opt2-a)
  register_locals(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_locals");
  }

  /// Collect syntactic places from body, and create `PlaceIndex` for them.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:379 collect_places (lane mt-opt2-a)
  collect_places(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::collect_places");
  }

  /// Just collecting syntactic places is not enough. We may need to propagate this pattern:
  ///      _1 = (const 5u32, const 13i64);
  ///      _2 = _1;
  ///      _3 = (_2.0 as u32);
  ///
  /// `_1.0` does not appear, but we still need to track it. This is achieved by propagating
  /// projections from assignments. We recorded an assignment between `_2` and `_1`, so we
  /// want `_1` and `_2` to have the same sub-places.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:393 propagate_assignments (lane mt-opt2-a)
  propagate_assignments(_tcx: TyCtxt, _body: Body): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::propagate_assignments");
  }

  /// Create values for places whose type have scalar layout.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:493 create_values (lane mt-opt2-a)
  create_values(_tcx: TyCtxt, _body: Body, _value_limit: number | undefined): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::create_values");
  }

  /// Trim useless places.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:534 trim_useless_places (lane mt-opt2-a)
  trim_useless_places(): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::trim_useless_places");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:548 register_place_index (lane mt-opt2-a)
  register_place_index(_ty: Ty, _base: PlaceIndex, _elem: TrackElem): PlaceIndex {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_place_index");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:563 register_place (lane mt-opt2-a)
  register_place(_tcx: TyCtxt, _body: Body, _place: Place, _tail: TrackElem | undefined): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_place");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:595 register_place_and_discr (lane mt-opt2-a)
  register_place_and_discr(_tcx: TyCtxt, _body: Body, _place: Place): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_place_and_discr");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:617 register_value (lane mt-opt2-a)
  register_value(_tcx: TyCtxt, _typing_env: TypingEnv, _place: PlaceIndex): ValueIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:646 register_copy_tree (lane mt-opt2-a)
  register_copy_tree(
    // Tree to copy.
    _source: PlaceIndex,
    // Tree to build.
    _target: PlaceIndex,
    _f: (source: ValueIndex, target: ValueIndex) => void,
  ): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::register_copy_tree");
  }

  /// Precompute the list of values inside `root` and store it inside
  /// as a slice within `inner_values_buffer`.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:680 cache_preorder_invoke (lane mt-opt2-a)
  cache_preorder_invoke(_root: PlaceIndex): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::cache_preorder_invoke");
  }

  // ---- impl<'tcx> Map<'tcx> (value_analysis.rs:716; PORTING §8: a later impl block inside the class body) ----

  /// Applies a single projection element, yielding the corresponding child.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:718 apply (lane mt-opt2-a)
  apply(_place: PlaceIndex, _elem: TrackElem): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::apply");
  }

  /// Locates the given place, if it exists in the tree.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:723 find_extra (lane mt-opt2-a)
  find_extra(_place: PlaceRef, _extra: Iterable<TrackElem>): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::find_extra");
  }

  /// Locates the given place, if it exists in the tree.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:741 find (lane mt-opt2-a)
  find(_place: PlaceRef): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::find");
  }

  /// Locates the given place and applies `Discriminant`, if it exists in the tree.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:746 find_discr (lane mt-opt2-a)
  find_discr(_place: PlaceRef): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::find_discr");
  }

  /// Locates the given place and applies `DerefLen`, if it exists in the tree.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:751 find_len (lane mt-opt2-a)
  find_len(_place: PlaceRef): PlaceIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::find_len");
  }

  /// Locates the value corresponding to the given place.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:756 value (lane mt-opt2-a)
  value(_place: PlaceIndex): ValueIndex | undefined {
    return unported("rustc_mir_dataflow::value_analysis::Map::value");
  }

  /// Iterate over all direct children.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:761 children (lane mt-opt2-a)
  children(_parent: PlaceIndex): Iterable<PlaceIndex> {
    return unported("rustc_mir_dataflow::value_analysis::Map::children");
  }

  /// Invoke a function on the given place and all places that may alias it.
  ///
  /// In particular, when the given place has a variant downcast, we invoke the function on all
  /// the other variants.
  ///
  /// `tail_elem` allows to support discriminants that are not a place in MIR, but that we track
  /// as such.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:773 for_each_aliasing_place (lane mt-opt2-a)
  for_each_aliasing_place(_place: PlaceRef, _tail_elem: TrackElem | undefined, _f: (value: ValueIndex) => void): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::for_each_aliasing_place");
  }

  /// Invoke the given function on all the descendants of the given place, except one branch.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:808 for_each_variant_sibling (lane mt-opt2-a)
  for_each_variant_sibling(_parent: PlaceIndex, _preserved_child: PlaceIndex | undefined, _f: (value: ValueIndex) => void): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::for_each_variant_sibling");
  }

  /// Invoke a function on each value in the given place and all descendants.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:829 for_each_value_inside (lane mt-opt2-a)
  for_each_value_inside(_root: PlaceIndex, _f: (value: ValueIndex) => void): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::for_each_value_inside");
  }

  /// Invoke a function on each value in the given place and all descendants.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:848 for_each_projection_value (lane mt-opt2-a)
  for_each_projection_value<O>(
    _root: PlaceIndex,
    _value: O,
    _project: (elem: TrackElem, value: O) => O | undefined,
    _f: (place: PlaceIndex, value: O) => void,
  ): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::for_each_projection_value");
  }

  /// Recursively iterates on each value contained in `target`, paired with matching projection
  /// inside `source`.
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:876 for_each_value_pair (lane mt-opt2-a)
  for_each_value_pair(_target: PlaceIndex, _source: PlaceIndex, _f: (target: ValueIndex, source: ValueIndex) => void): void {
    return unported("rustc_mir_dataflow::value_analysis::Map::for_each_value_pair");
  }
}

// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:318 PlaceCollectionMode
export type PlaceCollectionMode =
  | { readonly $: "Full"; readonly value_limit: number | undefined }
  | { readonly $: "OnDemand" };

// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:699 PlaceCollector
class PlaceCollector {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public map: Map,
  ) {}

  /** `impl<'tcx> Visitor<'tcx> for PlaceCollector<'_, 'tcx>`. */
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:707 visit_place (lane mt-opt2-a)
  visit_place(_place: Place, _ctxt: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::value_analysis::PlaceCollector::visit_place");
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

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:923 new (lane mt-opt2-a)
  static new(_ty: Ty, _proj_elem: TrackElem | undefined): PlaceInfo {
    return unported("rustc_mir_dataflow::value_analysis::PlaceInfo::new");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/value_analysis.rs:928 Children
class Children implements IterableIterator<PlaceIndex> {
  constructor(
    public map: Map,
    public next_: PlaceIndex | undefined,
  ) {}

  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:934 new (lane mt-opt2-a)
  static new(_map: Map, _parent: PlaceIndex): Children {
    return unported("rustc_mir_dataflow::value_analysis::Children::new");
  }

  /** `impl Iterator for Children<'_, '_>` (`type Item = PlaceIndex`). */
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:942 next (lane mt-opt2-a)
  next(): IteratorResult<PlaceIndex> {
    return unported("rustc_mir_dataflow::value_analysis::Children::next");
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
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:979 try_from (lane mt-opt2-a)
  try_from<V, T>(_value: ProjectionElem<V, T>): Result<TrackElem, null> {
    return unported("rustc_mir_dataflow::value_analysis::TrackElem::try_from");
  },
};

/** The key of `(PlaceIndex, TrackElem)` in `Map.projections` (derived `Hash` + `Eq`). */
export function TrackElem_key(place: PlaceIndex, elem: TrackElem): string {
  return elem.$ === "Field" || elem.$ === "Variant" ? `${place}:${elem.$}:${elem._0}` : `${place}:${elem.$}`;
}

/// Invokes `f` on all direct fields of `ty`.
// stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:989 iter_fields (lane mt-opt2-a)
export function iter_fields(
  _ty: Ty,
  _tcx: TyCtxt,
  _typing_env: TypingEnv,
  _f: (variant: VariantIdx | undefined, field: FieldIdx, ty: Ty) => void,
): void {
  return unported("rustc_mir_dataflow::value_analysis::iter_fields");
}

/// Returns all locals with projections that have their reference or address taken.
// stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:1031 excluded_locals (lane mt-opt2-a)
export function excluded_locals(_body: Body): GrowableBitSet<Local> {
  return unported("rustc_mir_dataflow::value_analysis::excluded_locals");
}

/** `struct Collector` local to `excluded_locals` (hoisted; the fill lane may move it inside). */
class excluded_locals_Collector {
  constructor(public result: GrowableBitSet<Local>) {}

  /** `impl<'tcx> Visitor<'tcx> for Collector`. */
  // stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:1037 visit_place (lane mt-opt2-a)
  visit_place(_place: Place, _context: PlaceContext, _location: Location): void {
    return unported("rustc_mir_dataflow::value_analysis::excluded_locals::Collector::visit_place");
  }
}

/** `V: Debug + Eq + HasBottom`. */
type DebugV<V> = HasBottom<V> & { eq(a: V, b: V): boolean; fmt: Debug<V> };

// stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:1051 debug_with_context_rec (lane mt-opt2-a)
function debug_with_context_rec<V>(
  _place: PlaceIndex,
  _place_str: string,
  _new: StateData<V>,
  _old: StateData<V> | undefined,
  _map: Map,
  _f: Fmt,
  _V_: DebugV<V>,
): string {
  return unported("rustc_mir_dataflow::value_analysis::debug_with_context_rec");
}

// stub-df: compiler/rustc_mir_dataflow/src/value_analysis.rs:1097 debug_with_context (lane mt-opt2-a)
export function debug_with_context<V>(_new: StateData<V>, _old: StateData<V> | undefined, _map: Map, _f: Fmt, _V_: DebugV<V>): string {
  return unported("rustc_mir_dataflow::value_analysis::debug_with_context");
}

/** The declarations above are module-private upstream; keep them referenced for the fill lane. */
export const _value_analysis_decls = { PlaceCollector, PlaceInfo, Children, excluded_locals_Collector, debug_with_context_rec };
