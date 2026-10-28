// Port of datafrog =2.0.1 `src/lib.rs` (the version in upstream's Cargo.lock; used by polonius-engine 0.13.0,
// which rustc_borrowck's legacy Polonius (`-Zpolonius=legacy`) drives).
//
// PORT: generics.
// - `Tuple: Ord` is an `Ord` value: a number (an `Atom` handle or integer), `undefined` (`()`), or a Rust
//   tuple as an array of `Ord` values. `cmp` below is the derived lexicographic `Ord` of those tuples, the
//   only order datafrog's users (polonius-engine, rustc) instantiate it with. Tuples are immutable values
//   (Rust copies them); arrays of tuples are never shared between owners where Rust moves or clones them.
// - `Rc<RefCell<T>>` fields of `Variable` are the shared value itself (`stable`, `to_add`: arrays mutated in
//   place) or a `MutRef` cell (`recent`, which `changed` replaces), so `Variable::clone` shares them as `Rc`
//   clones do.
// - `impl JoinInput` parameters are `Variable | Relation` (join.ts `join_input` dispatches); `impl Leapers`
//   parameters are a single leaper or an array of 2..7 leapers (the tuple impls; treefrog.ts `into_leapers`).
// - `&[T]` sub-slices are index ranges `[lo, hi)` over the backing array (join.ts `gallop`).
// - `#![forbid(missing_docs)]` is a lint attribute; it has no runtime effect.
//
//! A lightweight Datalog engine in Rust
//!
//! The intended design is that one has static `Relation` types that are sets
//! of tuples, and `Variable` types that represent monotonically increasing
//! sets of tuples.
//!
//! The types are mostly wrappers around `Vec<Tuple>` indicating sorted-ness,
//! and the intent is that this code can be dropped in the middle of an otherwise
//! normal Rust program, run to completion, and then the results extracted as
//! vectors again.

import type { MutRef } from "../../std/mut_ref.ts";
import { assert } from "../../std/panic.ts";
import * as join from "./join.ts";
import * as map from "./map.ts";
import * as treefrog from "./treefrog.ts";
import type { LeapersArg } from "./treefrog.ts";

// mod join;
// mod map;
// mod test;
// mod treefrog;
export { type JoinInput, JoinInput_for_Relation, JoinInput_for_Variable } from "./join.ts";
export {
  ExtendAnti,
  ExtendWith,
  FilterAnti,
  FilterWith,
  type Leaper,
  type Leapers,
  type LeapersArg,
  PrefixFilter,
  type RelationLeaper,
  ValueFilter,
} from "./treefrog.ts";

/** PORT: a `Tuple: Ord` value (see the header). */
export type Ord = number | undefined | readonly Ord[];

/**
 * PORT: `Ord::cmp` of `Ord` values as a number (< 0, 0, > 0): numbers numerically, `()` always equal,
 * tuples lexicographically (the derived `Ord` of Rust tuples). Both sides have the same Rust type.
 */
export function cmp(a: Ord, b: Ord): number {
  if (typeof a === "number") {
    const bn = b as number;
    return a < bn ? -1 : a > bn ? 1 : 0;
  }
  if (a === undefined) return 0;
  const bt = b as readonly Ord[];
  for (let i = 0; i < a.length; i++) {
    const c = cmp(a[i], bt[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/// A static, ordered list of key-value pairs.
///
/// A relation represents a fixed set of key-value pairs. In many places in a
/// Datalog computation we want to be sure that certain relations are not able
/// to vary (for example, in antijoins).
// #[derive(Clone)]
export class Relation<Tuple extends Ord> implements treefrog.RelationLeaper<Tuple> {
  constructor(
    /// Sorted list of distinct tuples.
    public elements: Tuple[],
  ) {}

  /** PORT: `#[derive(Clone)]` (the tuples are immutable values; the `Vec` is copied). */
  clone(): Relation<Tuple> {
    return new Relation(this.elements.slice());
  }

  /// Merges two relations into their union.
  // crate: datafrog-2.0.1/src/lib.rs:46 merge
  merge(other: Relation<Tuple>): Relation<Tuple> {
    let elements1 = this.elements;
    let elements2 = other.elements;

    // If one of the element lists is zero-length, we don't need to do any work
    if (elements1.length === 0) {
      return new Relation(elements2);
    }

    if (elements2.length === 0) {
      return new Relation(elements1);
    }

    // Make sure that elements1 starts with the lower element
    // Will not panic since both collections must have at least 1 element at this point
    if (cmp(elements1[0]!, elements2[0]!) > 0) {
      const tmp = elements1;
      elements1 = elements2;
      elements2 = tmp;
    }

    // Fast path for when all the new elements are after the exiting ones
    if (cmp(elements1[elements1.length - 1]!, elements2[0]!) < 0) {
      for (const e of elements2) elements1.push(e);
      // println!("fast path");
      return new Relation(elements1);
    }

    const elements: Tuple[] = [];
    // PORT: the `drain(..)` iterators (and `peekable`) are indices into the two lists.
    let i1 = 0;
    let i2 = 0;

    elements.push(elements1[i1++]!);
    if (i2 < elements2.length && cmp(elements[0]!, elements2[i2]!) === 0) {
      i2++;
    }

    for (; i1 < elements1.length; i1++) {
      const elem = elements1[i1]!;
      while (i2 < elements2.length && cmp(elements2[i2]!, elem) < 0) {
        elements.push(elements2[i2++]!);
      }
      if (i2 < elements2.length && cmp(elements2[i2]!, elem) === 0) {
        i2++;
      }
      elements.push(elem);
    }

    // Finish draining second list
    for (; i2 < elements2.length; i2++) elements.push(elements2[i2]!);

    return new Relation(elements);
  }

  /// Creates a `Relation` from the elements of the `iterator`.
  ///
  /// Same as the `from_iter` method from `std::iter::FromIterator` trait.
  // crate: datafrog-2.0.1/src/lib.rs:110 from_iter
  static from_iter<Tuple extends Ord>(iterator: Iterable<Tuple>): Relation<Tuple> {
    return Relation.collect(iterator);
  }

  /// Creates a `Relation` using the `leapjoin` logic;
  /// see [`Variable::from_leapjoin`]
  // crate: datafrog-2.0.1/src/lib.rs:119 from_leapjoin
  static from_leapjoin<SourceTuple extends Ord, Val, Tuple extends Ord>(
    source: Relation<SourceTuple>,
    leapers: LeapersArg<SourceTuple, Val>,
    logic: (tuple: SourceTuple, val: Val) => Tuple,
  ): Relation<Tuple> {
    return treefrog.leapjoin(source.elements, leapers, logic);
  }

  /// Creates a `Relation` by joining the values from `input1` and
  /// `input2` and then applying `logic`. Like
  /// [`Variable::from_join`] except for use where the inputs are
  /// not varying across iterations.
  // crate: datafrog-2.0.1/src/lib.rs:131 from_join
  static from_join<Key extends Ord, Val1 extends Ord, Val2 extends Ord, Tuple extends Ord>(
    input1: Relation<readonly [Key, Val1]>,
    input2: Relation<readonly [Key, Val2]>,
    logic: (key: Key, val1: Val1, val2: Val2) => Tuple,
  ): Relation<Tuple> {
    return join.join_into_relation(input1, input2, logic);
  }

  /// Creates a `Relation` by removing all values from `input1` that
  /// share a key with `input2`, and then transforming the resulting
  /// tuples with the `logic` closure. Like
  /// [`Variable::from_antijoin`] except for use where the inputs
  /// are not varying across iterations.
  // crate: datafrog-2.0.1/src/lib.rs:144 from_antijoin
  static from_antijoin<Key extends Ord, Val1 extends Ord, Tuple extends Ord>(
    input1: Relation<readonly [Key, Val1]>,
    input2: Relation<Key>,
    logic: (key: Key, val1: Val1) => Tuple,
  ): Relation<Tuple> {
    return join.antijoin(input1, input2, logic);
  }

  /// Construct a new relation by mapping another one. Equivalent to
  /// creating an iterator but perhaps more convenient. Analogous to
  /// `Variable::from_map`.
  // crate: datafrog-2.0.1/src/lib.rs:155 from_map
  static from_map<T2 extends Ord, Tuple extends Ord>(input: Relation<T2>, logic: (t: T2) => Tuple): Relation<Tuple> {
    return Relation.collect(input.iter().map((t) => logic(t)));
  }

  /// Creates a `Relation` from a vector of tuples.
  // crate: datafrog-2.0.1/src/lib.rs:160 from_vec
  static from_vec<Tuple extends Ord>(elements: Tuple[]): Relation<Tuple> {
    elements.sort(cmp);
    // `elements.dedup()`
    let w = 0;
    for (let r = 0; r < elements.length; r++) {
      if (w === 0 || cmp(elements[r]!, elements[w - 1]!) !== 0) elements[w++] = elements[r]!;
    }
    elements.length = w;
    return new Relation(elements);
  }

  // impl<Tuple: Ord> From<Vec<Tuple>> for Relation<Tuple>
  // crate: datafrog-2.0.1/src/lib.rs:168 from
  static from<Tuple extends Ord>(iterator: Tuple[]): Relation<Tuple> {
    return Relation.from_vec(iterator);
  }

  // impl<Tuple: Ord> FromIterator<Tuple> for Relation<Tuple>
  // impl<'tuple, Tuple: 'tuple + Copy + Ord> FromIterator<&'tuple Tuple> for Relation<Tuple>
  // PORT: both `FromIterator` impls are this one `collect` (`.cloned()` of an immutable tuple is the
  // tuple itself); `iterator.collect::<Relation<_>>()` is `Relation.collect(iterator)`.
  // crate: datafrog-2.0.1/src/lib.rs:174 from_iter
  // crate: datafrog-2.0.1/src/lib.rs:183 from_iter
  static collect<Tuple extends Ord>(iterator: Iterable<Tuple>): Relation<Tuple> {
    return Relation.from_vec(Array.from(iterator));
  }

  // impl<Tuple: Ord> std::ops::Deref for Relation<Tuple> { type Target = [Tuple]; }
  // crate: datafrog-2.0.1/src/lib.rs:193 deref
  deref(): readonly Tuple[] {
    return this.elements;
  }

  /** `<[Tuple]>::iter` through `Deref`. */
  iter(): readonly Tuple[] {
    return this.elements;
  }

  /** `<[Tuple]>::len` through `Deref`. */
  len(): number {
    return this.elements.length;
  }

  /** `<[Tuple]>::is_empty` through `Deref`. */
  is_empty(): boolean {
    return this.elements.length === 0;
  }

  // impl<Key: Ord, Val: Ord> RelationLeaper<Key, Val> for Relation<(Key, Val)> (treefrog.rs:275)

  // crate: datafrog-2.0.1/src/treefrog.rs:276 extend_with
  extend_with<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => Key,
  ): treefrog.ExtendWith<Key, Val, T> {
    return treefrog.ExtendWith.from(this, key_func);
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:286 extend_anti
  extend_anti<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => Key,
  ): treefrog.ExtendAnti<Key, Val, T> {
    return treefrog.ExtendAnti.from(this, key_func);
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:296 filter_with
  filter_with<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => readonly [Key, Val],
  ): treefrog.FilterWith<Key, Val, T> {
    return treefrog.FilterWith.from(this, key_func);
  }
  // crate: datafrog-2.0.1/src/treefrog.rs:306 filter_anti
  filter_anti<Key extends Ord, Val extends Ord, T extends Ord>(
    this: Relation<readonly [Key, Val]>,
    key_func: (tuple: T) => readonly [Key, Val],
  ): treefrog.FilterAnti<Key, Val, T> {
    return treefrog.FilterAnti.from(this, key_func);
  }
}

/// An iterative context for recursive evaluation.
///
/// An `Iteration` tracks monotonic variables, and monitors their progress.
/// It can inform the user if they have ceased changing, at which point the
/// computation should be done.
export class Iteration {
  constructor(public variables: VariableTrait[]) {}

  /// Create a new iterative context.
  // crate: datafrog-2.0.1/src/lib.rs:209 new
  static new(): Iteration {
    return new Iteration([]);
  }
  /// Reports whether any of the monitored variables have changed since
  /// the most recent call.
  // crate: datafrog-2.0.1/src/lib.rs:216 changed
  changed(): boolean {
    let result = false;
    for (const variable of this.variables) {
      if (variable.changed()) {
        result = true;
      }
    }
    return result;
  }
  /// Creates a new named variable associated with the iterative context.
  // crate: datafrog-2.0.1/src/lib.rs:226 variable
  variable<Tuple extends Ord>(name: string): Variable<Tuple> {
    const variable = Variable.new<Tuple>(name);
    this.variables.push(variable.clone());
    return variable;
  }
  /// Creates a new named variable associated with the iterative context.
  ///
  /// This variable will not be maintained distinctly, and may advertise tuples as
  /// recent multiple times (perhaps unboundedly many times).
  // crate: datafrog-2.0.1/src/lib.rs:235 variable_indistinct
  variable_indistinct<Tuple extends Ord>(name: string): Variable<Tuple> {
    const variable = Variable.new<Tuple>(name);
    variable.distinct = false;
    this.variables.push(variable.clone());
    return variable;
  }
}

/// A type that can report on whether it has changed.
interface VariableTrait {
  /// Reports whether the variable has changed since it was last asked.
  // crate: datafrog-2.0.1/src/lib.rs:246 changed
  changed(): boolean;
}

/// An monotonically increasing set of `Tuple`s.
///
/// There are three stages in the lifecycle of a tuple:
///
///   1. A tuple is added to `self.to_add`, but is not yet visible externally.
///   2. Newly added tuples are then promoted to `self.recent` for one iteration.
///   3. After one iteration, recent tuples are moved to `self.tuples` for posterity.
///
/// Each time `self.changed()` is called, the `recent` relation is folded into `tuples`,
/// and the `to_add` relations are merged, potentially deduplicated against `tuples`, and
/// then made  `recent`. This way, across calls to `changed()` all added tuples are in
/// `recent` at least once and eventually all are in `tuples`.
///
/// A `Variable` may optionally be instructed not to de-duplicate its tuples, for reasons
/// of performance. Such a variable cannot be relied on to terminate iterative computation,
/// and it is important that any cycle of derivations have at least one de-duplicating
/// variable on it.
export class Variable<Tuple extends Ord> implements VariableTrait {
  constructor(
    /// Should the variable be maintained distinctly.
    public distinct: boolean,
    /// A useful name for the variable.
    public name: string,
    /// A list of relations whose union are the accepted tuples.
    public stable: Relation<Tuple>[],
    /// A list of recent tuples, still to be processed.
    public recent: MutRef<Relation<Tuple>>,
    /// A list of future tuples, to be introduced.
    public to_add: Relation<Tuple>[],
  ) {}

  // Operator implementations.

  /// Adds tuples that result from joining `input1` and `input2` --
  /// each of the inputs must be a set of (Key, Value) tuples. Both
  /// `input1` and `input2` must have the same type of key (`K`) but
  /// they can have distinct value types (`V1` and `V2`
  /// respectively). The `logic` closure will be invoked for each
  /// key that appears in both inputs; it is also given the two
  /// values, and from those it should construct the resulting
  /// value.
  ///
  /// Note that `input1` must be a variable, but `input2` can be a
  /// relation or a variable. Therefore, you cannot join two
  /// relations with this method. This is not because the result
  /// would be wrong, but because it would be inefficient: the
  /// result from such a join cannot vary across iterations (as
  /// relations are fixed), so you should prefer to invoke `insert`
  /// on a relation created by `Relation::from_join` instead.
  ///
  /// # Examples
  ///
  /// This example starts a collection with the pairs (x, x+1) and (x+1, x) for x in 0 .. 10.
  /// It then adds pairs (y, z) for which (x, y) and (x, z) are present. Because the initial
  /// pairs are symmetric, this should result in all pairs (x, y) for x and y in 0 .. 11.
  ///
  /// ```
  /// use datafrog::{Iteration, Relation};
  ///
  /// let mut iteration = Iteration::new();
  /// let variable = iteration.variable::<(usize, usize)>("source");
  /// variable.extend((0 .. 10).map(|x| (x, x + 1)));
  /// variable.extend((0 .. 10).map(|x| (x + 1, x)));
  ///
  /// while iteration.changed() {
  ///     variable.from_join(&variable, &variable, |&key, &val1, &val2| (val1, val2));
  /// }
  ///
  /// let result = variable.complete();
  /// assert_eq!(result.len(), 121);
  /// ```
  // crate: datafrog-2.0.1/src/lib.rs:319 from_join
  from_join<K extends Ord, V1 extends Ord, V2 extends Ord>(
    input1: Variable<readonly [K, V1]>,
    input2: Variable<readonly [K, V2]> | Relation<readonly [K, V2]>,
    logic: (key: K, val1: V1, val2: V2) => Tuple,
  ): void {
    join.join_into(input1, input2, this, logic);
  }

  /// Adds tuples from `input1` whose key is not present in `input2`.
  ///
  /// Note that `input1` must be a variable: if you have a relation
  /// instead, you can use `Relation::from_antijoin` and then
  /// `Variable::insert`.  Note that the result will not vary during
  /// the iteration.
  ///
  /// # Examples
  ///
  /// This example starts a collection with the pairs (x, x+1) for x in 0 .. 10. It then
  /// adds any pairs (x+1,x) for which x is not a multiple of three. That excludes four
  /// pairs (for 0, 3, 6, and 9) which should leave us with 16 total pairs.
  ///
  /// ```
  /// use datafrog::{Iteration, Relation};
  ///
  /// let mut iteration = Iteration::new();
  /// let variable = iteration.variable::<(usize, usize)>("source");
  /// variable.extend((0 .. 10).map(|x| (x, x + 1)));
  ///
  /// let relation: Relation<_> = (0 .. 10).filter(|x| x % 3 == 0).collect();
  ///
  /// while iteration.changed() {
  ///     variable.from_antijoin(&variable, &relation, |&key, &val| (val, key));
  /// }
  ///
  /// let result = variable.complete();
  /// assert_eq!(result.len(), 16);
  /// ```
  // crate: datafrog-2.0.1/src/lib.rs:357 from_antijoin
  from_antijoin<K extends Ord, V extends Ord>(
    input1: Variable<readonly [K, V]>,
    input2: Relation<K>,
    logic: (key: K, val: V) => Tuple,
  ): void {
    this.insert(join.antijoin(input1, input2, logic));
  }

  /// Adds tuples that result from mapping `input`.
  ///
  /// # Examples
  ///
  /// This example starts a collection with the pairs (x, x) for x in 0 .. 10. It then
  /// repeatedly adds any pairs (x, z) for (x, y) in the collection, where z is the Collatz
  /// step for y: it is y/2 if y is even, and 3*y + 1 if y is odd. This produces all of the
  /// pairs (x, y) where x visits y as part of its Collatz journey.
  ///
  /// ```
  /// use datafrog::{Iteration, Relation};
  ///
  /// let mut iteration = Iteration::new();
  /// let variable = iteration.variable::<(usize, usize)>("source");
  /// variable.extend((0 .. 10).map(|x| (x, x)));
  ///
  /// while iteration.changed() {
  ///     variable.from_map(&variable, |&(key, val)|
  ///         if val % 2 == 0 {
  ///             (key, val/2)
  ///         }
  ///         else {
  ///             (key, 3*val + 1)
  ///         });
  /// }
  ///
  /// let result = variable.complete();
  /// assert_eq!(result.len(), 74);
  /// ```
  // crate: datafrog-2.0.1/src/lib.rs:395 from_map
  from_map<T2 extends Ord>(input: Variable<T2>, logic: (t: T2) => Tuple): void {
    map.map_into(input, this, logic);
  }

  /// Adds tuples that result from combining `source` with the
  /// relations given in `leapers`. This operation is very flexible
  /// and can be used to do a combination of joins and anti-joins.
  /// The main limitation is that the things being combined must
  /// consist of one dynamic variable (`source`) and then several
  /// fixed relations (`leapers`).
  ///
  /// The idea is as follows:
  ///
  /// - You will be inserting new tuples that result from joining (and anti-joining)
  ///   some dynamic variable `source` of source tuples (`SourceTuple`)
  ///   with some set of values (of type `Val`).
  /// - You provide these values by combining `source` with a set of leapers
  ///   `leapers`, each of which is derived from a fixed relation. The `leapers`
  ///   should be either a single leaper (of suitable type) or else a tuple of leapers.
  ///   You can create a leaper in one of two ways:
  ///   - Extension: In this case, you have a relation of type `(K, Val)` for some
  ///     type `K`. You provide a closure that maps from `SourceTuple` to the key
  ///     `K`. If you use `relation.extend_with`, then any `Val` values the
  ///     relation provides will be added to the set of values; if you use
  ///     `extend_anti`, then the `Val` values will be removed.
  ///   - Filtering: In this case, you have a relation of type `K` for some
  ///     type `K` and you provide a closure that maps from `SourceTuple` to
  ///     the key `K`. Filters don't provide values but they remove source
  ///     tuples.
  /// - Finally, you get a callback `logic` that accepts each `(SourceTuple, Val)`
  ///   that was successfully joined (and not filtered) and which maps to the
  ///   type of this variable.
  // crate: datafrog-2.0.1/src/lib.rs:427 from_leapjoin
  from_leapjoin<SourceTuple extends Ord, Val>(
    source: Variable<SourceTuple>,
    leapers: LeapersArg<SourceTuple, Val>,
    logic: (tuple: SourceTuple, val: Val) => Tuple,
  ): void {
    this.insert(treefrog.leapjoin(source.recent.value.elements, leapers, logic));
  }

  // impl<Tuple: Ord> Clone for Variable<Tuple>
  // crate: datafrog-2.0.1/src/lib.rs:438 clone
  clone(): Variable<Tuple> {
    return new Variable(this.distinct, this.name, this.stable, this.recent, this.to_add);
  }

  // crate: datafrog-2.0.1/src/lib.rs:450 new
  static new<Tuple extends Ord>(name: string): Variable<Tuple> {
    return new Variable<Tuple>(true, name, [], { value: Relation.from<Tuple>([]) }, []);
  }

  /// Inserts a relation into the variable.
  ///
  /// This is most commonly used to load initial values into a variable.
  /// it is not obvious that it should be commonly used otherwise, but
  /// it should not be harmful.
  // crate: datafrog-2.0.1/src/lib.rs:465 insert
  insert(relation: Relation<Tuple>): void {
    if (!relation.is_empty()) {
      this.to_add.push(relation);
    }
  }

  /// Extend the variable with values from the iterator.
  ///
  /// This is most commonly used to load initial values into a variable.
  /// it is not obvious that it should be commonly used otherwise, but
  /// it should not be harmful.
  // crate: datafrog-2.0.1/src/lib.rs:476 extend
  extend(iterator: Iterable<Tuple>): void {
    this.insert(Relation.collect(iterator));
  }

  /// Consumes the variable and returns a relation.
  ///
  /// This method removes the ability for the variable to develop, and
  /// flattens all internal tuples down to one relation. The method
  /// asserts that iteration has completed, in that `self.recent` and
  /// `self.to_add` should both be empty.
  // crate: datafrog-2.0.1/src/lib.rs:489 complete
  complete(): Relation<Tuple> {
    assert(this.recent.value.is_empty(), "assertion failed: self.recent.borrow().is_empty()");
    assert(this.to_add.length === 0, "assertion failed: self.to_add.borrow().is_empty()");
    let result: Relation<Tuple> = Relation.from<Tuple>([]);
    let batch: Relation<Tuple> | undefined;
    while ((batch = this.stable.pop()) !== undefined) {
      result = result.merge(batch);
    }
    return result;
  }

  // impl<Tuple: Ord> VariableTrait for Variable<Tuple>
  // crate: datafrog-2.0.1/src/lib.rs:501 changed
  changed(): boolean {
    // 1. Merge self.recent into self.stable.
    if (!this.recent.value.is_empty()) {
      let recent = this.recent.value;
      this.recent.value = Relation.from<Tuple>([]);
      while (this.stable.length > 0 && this.stable[this.stable.length - 1]!.len() <= 2 * recent.len()) {
        const last = this.stable.pop()!;
        recent = recent.merge(last);
      }
      this.stable.push(recent);
    }

    // 2. Move self.to_add into self.recent.
    let to_add = this.to_add.pop();
    if (to_add !== undefined) {
      let to_add_more: Relation<Tuple> | undefined;
      while ((to_add_more = this.to_add.pop()) !== undefined) {
        to_add = to_add.merge(to_add_more);
      }
      // 2b. Restrict `to_add` to tuples not in `self.stable`.
      if (this.distinct) {
        for (const batch of this.stable) {
          // PORT: `slice` is the index range `[lo, hi)` of `batch`; `retain` is an in-place filter
          // that visits the elements in order, as `Vec::retain` does.
          const slice = batch.elements;
          let lo = 0;
          const hi = slice.length;
          const elements = to_add.elements;
          let w = 0;
          // Only gallop if the slice is relatively large.
          if (hi - lo > 4 * elements.length) {
            for (let r = 0; r < elements.length; r++) {
              const x = elements[r]!;
              lo = join.gallop(slice, lo, hi, (y) => cmp(y, x) < 0);
              if (lo === hi || cmp(slice[lo]!, x) !== 0) elements[w++] = x;
            }
          } else {
            for (let r = 0; r < elements.length; r++) {
              const x = elements[r]!;
              while (lo !== hi && cmp(slice[lo]!, x) < 0) {
                lo += 1;
              }
              if (lo === hi || cmp(slice[lo]!, x) !== 0) elements[w++] = x;
            }
          }
          elements.length = w;
        }
      }
      this.recent.value = to_add;
    }

    // let mut total = 0;
    // for tuple in self.stable.borrow().iter() {
    //     total += tuple.len();
    // }

    // println!("Variable\t{}\t{}\t{}", self.name, total, self.recent.borrow().len());

    return !this.recent.value.is_empty();
  }
}

// impl<Tuple: Ord> Drop for Variable<Tuple> {
//     fn drop(&mut self) {
//         let mut total = 0;
//         for batch in self.stable.borrow().iter() {
//             total += batch.len();
//         }
//         println!("FINAL: {:?}\t{:?}", self.name, total);
//     }
// }

// crate-skip: datafrog-2.0.1/examples/borrow_check.rs:8 main example binary, not library code
// crate-skip: datafrog-2.0.1/examples/graspan1.rs:4 main example binary, not library code
