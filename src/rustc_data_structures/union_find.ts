// Port of compiler/rustc_data_structures/src/union_find.rs
//
// PORT: `Key: Idx` is a number-like index (`Idx::new(i)` / `key.index()` are the identity); `IndexVec<Key, T>` is `T[]`
// (PORTING §5).
import { type Debug, debug_struct, debug_vec, type Fmt } from "../std/fmt.ts";

/// Simple implementation of a union-find data structure, i.e. a disjoint-set
/// forest.
// rustc-type: compiler/rustc_data_structures/src/union_find.rs:12 UnionFind
export class UnionFind<Key extends number> {
  constructor(public table: UnionFindEntry<Key>[]) {}

  /// Creates a new disjoint-set forest containing the keys `0..num_keys`.
  /// Initially, every key is part of its own one-element set.
  // rustc: compiler/rustc_data_structures/src/union_find.rs:31 new
  static new<Key extends number>(num_keys: number): UnionFind<Key> {
    // Initially, every key is the root of its own set, so its parent is itself.
    // `IndexVec::from_fn_n(|key| UnionFindEntry { parent: key, rank: 0 }, num_keys)`
    const table: UnionFindEntry<Key>[] = [];
    for (let key = 0; key < num_keys; key++) table.push({ parent: key as Key, rank: 0 });
    return new UnionFind<Key>(table);
  }

  /// Returns the "root" key of the disjoint-set containing the given key.
  /// If two keys have the same root, they belong to the same set.
  ///
  /// Also updates internal data structures to make subsequent `find`
  /// operations faster.
  // rustc: compiler/rustc_data_structures/src/union_find.rs:41 find
  find(key: Key): Key {
    // Loop until we find a key that is its own parent.
    let curr = key;
    for (;;) {
      const parent = this.table[curr]!.parent;
      if (!(curr !== parent)) break;
      // Perform "path compression" by peeking one layer ahead, and
      // setting the current key's parent to that value.
      // (This works even when `parent` is the root of its set, because
      // of the invariant that a root is its own parent.)
      const parent_parent = this.table[parent]!.parent;
      this.table[curr]!.parent = parent_parent;

      // Advance by one step and continue.
      curr = parent;
    }
    return curr;
  }

  /// Merges the set containing `a` and the set containing `b` into one set.
  ///
  /// Returns the common root of both keys, after the merge.
  // rustc: compiler/rustc_data_structures/src/union_find.rs:63 unify
  unify(a0: Key, b0: Key): Key {
    let a = this.find(a0);
    let b = this.find(b0);

    // If both keys have the same root, they're already in the same set,
    // so there's nothing more to do.
    if (a === b) {
      return a;
    }

    // Ensure that `a` has strictly greater rank, swapping if necessary.
    // If both keys have the same rank, increment the rank of `a` so that
    // future unifications will also prefer `a`, leading to flatter trees.
    const ra = this.table[a]!.rank;
    const rb = this.table[b]!.rank;
    if (ra < rb) {
      // `mem::swap(&mut a, &mut b)`
      const t = a;
      a = b;
      b = t;
    } else if (ra === rb) {
      this.table[a]!.rank += 1;
    } else {
      // Ordering::Greater => {}
    }

    // debug_assert!(self.table[a].rank > self.table[b].rank);
    // debug_assert_eq!(self.table[b].parent, b);

    // Make `a` the parent of `b`.
    this.table[b]!.parent = a;

    return a;
  }

  /// Takes a "snapshot" of the current state of this disjoint-set forest, in
  /// the form of a vector that directly maps each key to its current root.
  // rustc: compiler/rustc_data_structures/src/union_find.rs:93 snapshot
  snapshot(): Key[] {
    // `self.table.indices().map(|key| self.find(key)).collect()`
    const n = this.table.length;
    const out: Key[] = [];
    for (let key = 0; key < n; key++) out.push(this.find(key as Key));
    return out;
  }
}

// rustc-type: compiler/rustc_data_structures/src/union_find.rs:17 UnionFindEntry
interface UnionFindEntry<Key> {
  /// Transitively points towards the "root" of the set containing this key.
  ///
  /// Invariant: A root key is its own parent.
  parent: Key;
  /// When merging two "root" keys, their ranks determine which key becomes
  /// the new root, to prevent the parent tree from becoming unnecessarily
  /// tall. See [`UnionFind::unify`] for details.
  rank: number;
}

/** `#[derive(Debug)]` of `UnionFind<Key>` (with the derived `Debug` of `UnionFindEntry<Key>`). */
export function debug_UnionFind<Key extends number>(v: UnionFind<Key>, f: Fmt, debug_Key: Debug<Key>): string {
  const debug_entry = (e: UnionFindEntry<Key>, f: Fmt): string =>
    debug_struct(f, "UnionFindEntry", [
      ["parent", debug_Key(e.parent, f)],
      ["rank", String(e.rank)],
    ]);
  return debug_struct(f, "UnionFind", [["table", debug_vec(v.table, f, debug_entry)]]);
}
