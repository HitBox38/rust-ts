// Port of compiler/rustc_data_structures/src/transitive_relation.rs
//
// PORT:
// - `elements: FxIndexSet<T>` is `FxIndexSet<T>` below: insertion-ordered elements with their indices (a JS `Map`
//   from element to index plus the element array). Elements are keyed by JS identity, which is `Eq` for the `T`s
//   rustc uses (interned `Region`s, numbers, strings).
// - `edges: FxHashSet<Edge>` is an `FxHashSet` (rust_ts/hash_map.ts) driven by the vendored hashbrown table with
//   `Edge`'s derived `Hash`, so `base_edges` and `maybe_map` visit the edges in rustc's (hashbrown bucket) order. The
//   set holds each `Edge` packed into one number (`edge_key`), since a JS `Set` compares objects by identity.
// - `Frozen<T>` (crate::frozen, a read-only wrapper) is the inner value; `Frozen::freeze(x)` is `x`.
// - `impl Deref for TransitiveRelation<T>` (to `Frozen<TransitiveRelationBuilder<T>>`) is the `deref()` method; the
//   builder methods callers reach through auto-deref (`is_empty`, `elements`, `index`) forward to it.
// - `Option<T>` is `T | undefined` (no `T` used with this relation is `undefined`).
import { BitMatrix, debug_BitMatrix } from "../rustc_index/bit_set.ts";
import { debug_HashSet, FxHashSet, type KeyType } from "../rust_ts/hash_map.ts";
import { type Debug, debug_set, debug_struct, debug_tuple, type Fmt } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";

/** PORT: `FxIndexSet<T>` (indexmap's `IndexSet` with `FxBuildHasher`): insertion order and positional indices. */
class FxIndexSet<T> {
  constructor(
    readonly indices: Map<T, number> = new Map(),
    readonly entries: T[] = [],
  ) {}

  /** `IndexSet::get_index_of` */
  get_index_of(a: T): number | undefined {
    return this.indices.get(a);
  }

  /** `IndexSet::insert_full` */
  insert_full(a: T): [number, boolean] {
    const i = this.indices.get(a);
    if (i !== undefined) return [i, false];
    const index = this.entries.length;
    this.indices.set(a, index);
    this.entries.push(a);
    return [index, true];
  }

  /** `IndexSet::len` */
  len(): number {
    return this.entries.length;
  }

  /** `self.elements[i]` (`Index<usize>`; panics when out of bounds). */
  get(i: number): T {
    if (i >= this.entries.length) panic("IndexSet: index out of bounds");
    return this.entries[i]!;
  }

  /** `#[derive(Clone)]` */
  clone(): FxIndexSet<T> {
    return new FxIndexSet<T>(new Map(this.indices), this.entries.slice());
  }
}

// rustc-type: compiler/rustc_data_structures/src/transitive_relation.rs:15 TransitiveRelationBuilder
export class TransitiveRelationBuilder<T> {
  constructor(
    // List of elements. This is used to map from a T to a usize.
    public elements_: FxIndexSet<T>,

    // List of base edges in the graph. Require to compute transitive
    // closure.
    public edges: FxHashSet<number>,
  ) {}

  // HACK(eddyb) manual impl avoids `Default` bound on `T`.
  // impl<T: Eq + Hash> Default for TransitiveRelationBuilder<T>
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:52 default
  static default<T>(): TransitiveRelationBuilder<T> {
    return new TransitiveRelationBuilder<T>(new FxIndexSet<T>(), FxHashSet.default(Edge_key));
  }

  /** `#[derive(Clone)]`: the edge set keeps its buckets (and so its iteration order). */
  clone(): TransitiveRelationBuilder<T> {
    return new TransitiveRelationBuilder<T>(this.elements_.clone(), this.edges.clone());
  }

  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:67 is_empty
  is_empty(): boolean {
    return this.edges.size === 0;
  }

  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:71 elements
  elements(): readonly T[] {
    // PORT: the field is `elements_` (this method has its name); the iterator is the insertion-ordered elements.
    return this.elements_.entries;
  }

  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:75 index
  index(a: T): Index | undefined {
    return this.elements_.get_index_of(a);
  }

  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:79 add_index
  add_index(a: T): Index {
    const [index, _added] = this.elements_.insert_full(a);
    return index;
  }

  /// Applies the (partial) function to each edge and returns a new
  /// relation builder. If `f` returns `None` for any end-point,
  /// returns `None`.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:87 maybe_map
  maybe_map<U>(f: (t: T) => U | undefined): TransitiveRelationBuilder<U> | undefined {
    const result = TransitiveRelationBuilder.default<U>();
    for (const edge of this.edges) {
      const a = f(this.elements_.get(Edge_source(edge)));
      if (a === undefined) return undefined;
      const b = f(this.elements_.get(Edge_target(edge)));
      if (b === undefined) return undefined;
      result.add(a, b);
    }
    return result;
  }

  /// Indicate that `a < b` (where `<` is this relation)
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:100 add
  add(a: T, b: T): void {
    const a_ = this.add_index(a);
    const b_ = this.add_index(b);
    const edge = Edge(a_, b_);
    this.edges.add(edge);
  }

  /// Compute the transitive closure derived from the edges, and converted to
  /// the final result. After this, all elements will be immutable to maintain
  /// the correctness of the result.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:110 freeze
  freeze(): TransitiveRelation<T> {
    const matrix = BitMatrix.new<number, number>(this.elements_.len(), this.elements_.len());
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of this.edges) {
        // add an edge from S -> T
        changed = matrix.insert(Edge_source(edge), Edge_target(edge)) || changed;

        // add all outgoing edges from T into S
        changed = matrix.union_rows(Edge_target(edge), Edge_source(edge)) || changed;
      }
    }
    return new TransitiveRelation<T>(this, matrix);
  }
}

// rustc-type: compiler/rustc_data_structures/src/transitive_relation.rs:25 TransitiveRelation
export class TransitiveRelation<T> {
  constructor(
    // Frozen transitive relation elements and edges.
    public builder: TransitiveRelationBuilder<T>,

    // Cached transitive closure derived from the edges.
    public closure: BitMatrix<number, number>,
  ) {}

  // impl<T> Deref for TransitiveRelation<T>
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:36 deref
  deref(): TransitiveRelationBuilder<T> {
    return this.builder;
  }

  // impl<T: Clone> Clone for TransitiveRelation<T>
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:42 clone
  clone(): TransitiveRelation<T> {
    return new TransitiveRelation<T>(this.builder.clone(), this.closure.clone());
  }

  /** PORT: `TransitiveRelationBuilder::is_empty` through `Deref`. */
  is_empty(): boolean {
    return this.deref().is_empty();
  }

  /** PORT: `TransitiveRelationBuilder::elements` through `Deref`. */
  elements(): readonly T[] {
    return this.deref().elements();
  }

  /** PORT: `TransitiveRelationBuilder::index` through `Deref` (module-private upstream). */
  index(a: T): Index | undefined {
    return this.deref().index(a);
  }

  /// Applies the (partial) function to each edge and returns a new
  /// relation including transitive closures.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:130 maybe_map
  maybe_map<U>(f: (t: T) => U | undefined): TransitiveRelation<U> | undefined {
    const builder = this.builder.maybe_map(f);
    if (builder === undefined) return undefined;
    return builder.freeze();
  }

  /// Checks whether `a < target` (transitively)
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:139 contains
  contains(a: T, b: T): boolean {
    const a_ = this.index(a);
    const b_ = this.index(b);
    if (a_ !== undefined && b_ !== undefined) {
      return this.with_closure((closure) => closure.contains(a_, b_));
    } else {
      return false;
    }
  }

  /// Thinking of `x R y` as an edge `x -> y` in a graph, this
  /// returns all things reachable from `a`.
  ///
  /// Really this probably ought to be `impl Iterator<Item = &T>`, but
  /// I'm too lazy to make that work, and -- given the caching
  /// strategy -- it'd be a touch tricky anyhow.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:152 reachable_from
  reachable_from(a: T): T[] {
    const a_ = this.index(a);
    if (a_ !== undefined) {
      return this.with_closure((closure) => [...closure.iter(a_)].map((i) => this.builder.elements_.get(i)));
    } else {
      return [];
    }
  }

  /// Picks what I am referring to as the "postdominating"
  /// upper-bound for `a` and `b`. This is usually the least upper
  /// bound, but in cases where there is no single least upper
  /// bound, it is the "mutual immediate postdominator", if you
  /// imagine a graph where `a < b` means `a -> b`.
  ///
  /// This function is needed because region inference currently
  /// requires that we produce a single "UB", and there is no best
  /// choice for the LUB. Rather than pick arbitrarily, I pick a
  /// less good, but predictable choice. This should help ensure
  /// that region inference yields predictable results (though it
  /// itself is not fully sufficient).
  ///
  /// Examples are probably clearer than any prose I could write
  /// (there are corresponding tests below, btw). In each case,
  /// the query is `postdom_upper_bound(a, b)`:
  ///
  /// ```text
  /// // Returns Some(x), which is also LUB.
  /// a -> a1 -> x
  ///            ^
  ///            |
  /// b -> b1 ---+
  ///
  /// // Returns `Some(x)`, which is not LUB (there is none)
  /// // diagonal edges run left-to-right.
  /// a -> a1 -> x
  ///   \/       ^
  ///   /\       |
  /// b -> b1 ---+
  ///
  /// // Returns `None`.
  /// a -> a1
  /// b -> b1
  /// ```
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:196 postdom_upper_bound
  postdom_upper_bound(a: T, b: T): T | undefined {
    const mubs = this.minimal_upper_bounds(a, b);
    return this.mutual_immediate_postdominator(mubs);
  }

  /// Viewing the relation as a graph, computes the "mutual
  /// immediate postdominator" of a set of points (if one
  /// exists). See `postdom_upper_bound` for details.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:204 mutual_immediate_postdominator
  mutual_immediate_postdominator(mubs: T[]): T | undefined {
    for (;;) {
      switch (mubs.length) {
        case 0:
          return undefined;
        case 1:
          return mubs[0]!;
        default: {
          const m = mubs.pop()!;
          const n = mubs.pop()!;
          mubs.push(...this.minimal_upper_bounds(n, m));
        }
      }
    }
  }

  /// Returns the set of bounds `X` such that:
  ///
  /// - `a < X` and `b < X`
  /// - there is no `Y != X` such that `a < Y` and `Y < X`
  ///   - except for the case where `X < a` (i.e., a strongly connected
  ///     component in the graph). In that case, the smallest
  ///     representative of the SCC is returned (as determined by the
  ///     internal indices).
  ///
  /// Note that this set can, in principle, have any size.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:228 minimal_upper_bounds
  minimal_upper_bounds(a_: T, b_: T): T[] {
    let a = this.index(a_);
    let b = this.index(b_);
    if (a === undefined || b === undefined) {
      return [];
    }

    // in some cases, there are some arbitrary choices to be made;
    // it doesn't really matter what we pick, as long as we pick
    // the same thing consistently when queried, so ensure that
    // (a, b) are in a consistent relative order
    if (a > b) {
      [a, b] = [b, a];
    }
    const a0 = a;
    const b0 = b;

    const lub_indices = this.with_closure((closure) => {
      // Easy case is when either a < b or b < a:
      if (closure.contains(a0, b0)) {
        return [b0];
      }
      if (closure.contains(b0, a0)) {
        return [a0];
      }

      // Otherwise, the tricky part is that there may be some c
      // where a < c and b < c. In fact, there may be many such
      // values. So here is what we do:
      //
      // 1. Find the vector `[X | a < X && b < X]` of all values
      //    `X` where `a < X` and `b < X`. In terms of the
      //    graph, this means all values reachable from both `a`
      //    and `b`. Note that this vector is also a set, but we
      //    use the term vector because the order matters
      //    to the steps below.
      //    - This vector contains upper bounds, but they are
      //      not minimal upper bounds. So you may have e.g.
      //      `[x, y, tcx, z]` where `x < tcx` and `y < tcx` and
      //      `z < x` and `z < y`:
      //
      //           z --+---> x ----+----> tcx
      //               |           |
      //               |           |
      //               +---> y ----+
      //
      //      In this case, we really want to return just `[z]`.
      //      The following steps below achieve this by gradually
      //      reducing the list.
      // 2. Pare down the vector using `pare_down`. This will
      //    remove elements from the vector that can be reached
      //    by an earlier element.
      //    - In the example above, this would convert `[x, y,
      //      tcx, z]` to `[x, y, z]`. Note that `x` and `y` are
      //      still in the vector; this is because while `z < x`
      //      (and `z < y`) holds, `z` comes after them in the
      //      vector.
      // 3. Reverse the vector and repeat the pare down process.
      //    - In the example above, we would reverse to
      //      `[z, y, x]` and then pare down to `[z]`.
      // 4. Reverse once more just so that we yield a vector in
      //    increasing order of index. Not necessary, but why not.
      //
      // I believe this algorithm yields a minimal set. The
      // argument is that, after step 2, we know that no element
      // can reach its successors (in the vector, not the graph).
      // After step 3, we know that no element can reach any of
      // its predecessors (because of step 2) nor successors
      // (because we just called `pare_down`)
      //
      // This same algorithm is used in `parents` below.

      const candidates = closure.intersect_rows(a0, b0); // (1)
      pare_down(candidates, closure); // (2)
      candidates.reverse(); // (3a)
      pare_down(candidates, closure); // (3b)
      return candidates;
    });

    return lub_indices
      .reverse() // (4)
      .map((i) => this.builder.elements_.get(i));
  }

  /// Given an element A, returns the maximal set {B} of elements B
  /// such that
  ///
  /// - A != B
  /// - A R B is true
  /// - for each i, j: `B[i]` R `B[j]` does not hold
  ///
  /// The intuition is that this moves "one step up" through a lattice
  /// (where the relation is encoding the `<=` relation for the lattice).
  /// So e.g., if the relation is `->` and we have
  ///
  /// ```text
  /// a -> b -> d -> f
  /// |              ^
  /// +--> c -> e ---+
  /// ```
  ///
  /// then `parents(a)` returns `[b, c]`. The `postdom_parent` function
  /// would further reduce this to just `f`.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:329 parents
  parents(a_: T): T[] {
    const a = this.index(a_);
    if (a === undefined) {
      return [];
    }

    // Steal the algorithm for `minimal_upper_bounds` above, but
    // with a slight tweak. In the case where `a R a`, we remove
    // that from the set of candidates.
    const ancestors = this.with_closure((closure) => {
      let ancestors = closure.intersect_rows(a, a);

      // Remove anything that can reach `a`. If this is a
      // reflexive relation, this will include `a` itself.
      ancestors = ancestors.filter((e) => !closure.contains(e, a));

      pare_down(ancestors, closure); // (2)
      ancestors.reverse(); // (3a)
      pare_down(ancestors, closure); // (3b)
      return ancestors;
    });

    return ancestors
      .reverse() // (4)
      .map((i) => this.builder.elements_.get(i));
  }

  /// Given an element A, elements B with the lowest index such that `A R B`
  /// and `B R A`, or `A` if no such element exists.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:359 minimal_scc_representative
  minimal_scc_representative(a: T): T {
    const a_i = this.index(a);
    if (a_i !== undefined) {
      return this.with_closure((closure) => {
        for (const i of closure.iter(a_i)) {
          if (closure.contains(i, a_i)) return this.builder.elements_.get(i);
        }
        return a;
      });
    } else {
      return a;
    }
  }

  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:371 with_closure
  with_closure<R>(op: (closure: BitMatrix<number, number>) => R): R {
    return op(this.closure);
  }

  /// Lists all the base edges in the graph: the initial _non-transitive_ set of element
  /// relations, which will be later used as the basis for the transitive closure computation.
  // rustc: compiler/rustc_data_structures/src/transitive_relation.rs:380 base_edges
  *base_edges(): Generator<[T, T]> {
    for (const edge of this.builder.edges) {
      yield [this.builder.elements_.get(Edge_source(edge)), this.builder.elements_.get(Edge_target(edge))];
    }
  }
}

// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Debug, Hash)]
// struct Index(usize);
/** PORT: `Index(usize)` is the `usize`. */
type Index = number;

/** `#[derive(Debug)]` for `Index`. */
function debug_Index(v: Index, f: Fmt): string {
  return debug_tuple(f, "Index", [String(v)]);
}

// #[derive(Clone, PartialEq, Eq, Debug, Hash)]
// struct Edge { source: Index, target: Index }
/**
 * PORT: an `Edge` is packed into one number, `source * 2^32 + target`, so that equal edges are equal JS values (the
 * `FxHashSet<Edge>` is a JS `Set`). Indices are below 2^21 (asserted), so the packing is exact.
 */
type Edge = number;
const EDGE_SHIFT = 2 ** 32;

/** `Edge { source, target }` */
function Edge(source: Index, target: Index): Edge {
  assert(source < 2 ** 21 && target < EDGE_SHIFT, "transitive_relation: edge index too large to pack");
  return source * EDGE_SHIFT + target;
}

function Edge_source(edge: Edge): Index {
  return Math.floor(edge / EDGE_SHIFT);
}

function Edge_target(edge: Edge): Index {
  return edge % EDGE_SHIFT;
}

/** `#[derive(Hash)]` for `Edge` (`source.hash()`, `target.hash()`: two `write_usize`) and its layout (16, 8). */
const Edge_key: KeyType<Edge> = {
  hash: (edge, state) => {
    state.write_usize(Edge_source(edge));
    state.write_usize(Edge_target(edge));
  },
  size: 16,
  align: 8,
};

/** `#[derive(Debug)]` for `Edge`. */
function debug_Edge(edge: Edge, f: Fmt): string {
  return debug_struct(f, "Edge", [
    ["source", debug_Index(Edge_source(edge), f)],
    ["target", debug_Index(Edge_target(edge), f)],
  ]);
}

/** `#[derive(Debug)]` for `TransitiveRelationBuilder<T>` (`elements` is an `IndexSet`: a set). */
export function debug_TransitiveRelationBuilder<T>(v: TransitiveRelationBuilder<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "TransitiveRelationBuilder", [
    [
      "elements",
      debug_set(
        f,
        v.elements_.entries.map((t) => debug_T(t, f)),
      ),
    ],
    ["edges", debug_HashSet(v.edges, f, debug_Edge)],
  ]);
}

/** `#[derive(Debug)]` for `TransitiveRelation<T>` (`Frozen<T>` derives `Debug` as a tuple struct). */
export function debug_TransitiveRelation<T>(v: TransitiveRelation<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "TransitiveRelation", [
    ["builder", debug_tuple(f, "Frozen", [debug_TransitiveRelationBuilder(v.builder, f, debug_T)])],
    ["closure", debug_tuple(f, "Frozen", [debug_BitMatrix(v.closure, f)])],
  ]);
}

/// Pare down is used as a step in the LUB computation. It edits the
/// candidates array in place by removing any element j for which
/// there exists an earlier element i<j such that i -> j. That is,
/// after you run `pare_down`, you know that for all elements that
/// remain in candidates, they cannot reach any of the elements that
/// come after them.
///
/// Examples follow. Assume that a -> b -> c and x -> y -> z.
///
/// - Input: `[a, b, x]`. Output: `[a, x]`.
/// - Input: `[b, a, x]`. Output: `[b, a, x]`.
/// - Input: `[a, x, b, y]`. Output: `[a, x]`.
// rustc: compiler/rustc_data_structures/src/transitive_relation.rs:399 pare_down
function pare_down(candidates: number[], closure: BitMatrix<number, number>): void {
  let i = 0;
  while (i < candidates.length) {
    const candidate_i = candidates[i]!;
    i += 1;

    let j = i;
    let dead = 0;
    while (j < candidates.length) {
      const candidate_j = candidates[j]!;
      if (closure.contains(candidate_i, candidate_j)) {
        // If `i` can reach `j`, then we can remove `j`. So just
        // mark it as dead and move on; subsequent indices will be
        // shifted into its place.
        dead += 1;
      } else {
        candidates[j - dead] = candidate_j;
      }
      j += 1;
    }
    candidates.length = j - dead;
  }
}
