// Port of compiler/rustc_mir_dataflow/src/un_derefer.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `UnDerefer` (`#[derive(Default)]`) is a class; `FxHashMap<Local, Vec<PlaceRef>>` is a `Map<Local, PlaceRef[]>`
//   (insertion-ordered; never iterated upstream). `UnDerefer::default()` is `new UnDerefer(new Map())`.
// - `ProjectionIter` is an `IterableIterator<[PlaceRef, PlaceElem]>` class; `SlicePlusOne<T>` keeps the slice as the
//   array plus a start offset (`&slice[1..]` is `start + 1`), `last: Option<T>` is `T | undefined`.
import { type Local, type PlaceElem, PlaceRef } from "../rustc_middle/mir/mod.ts";
import { panic } from "../std/panic.ts";

/// Used for reverting changes made by `DerefSeparator`
// #[derive(Default, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/un_derefer.rs:6 UnDerefer
export class UnDerefer {
  constructor(public deref_chains: Map<Local, PlaceRef[]>) {}

  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:12 insert
  insert(local: Local, reffed: PlaceRef): void {
    const chain = this.deref_chains.get(reffed.local) ?? [];
    this.deref_chains.delete(reffed.local);
    chain.push(reffed);
    this.deref_chains.set(local, chain);
  }

  /// Returns the chain of places behind `DerefTemp` locals
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:20 deref_chain
  deref_chain(local: Local): readonly PlaceRef[] {
    return this.deref_chains.get(local) ?? [];
  }

  /// Iterates over the projections of a place and its deref chain.
  ///
  /// See [`PlaceRef::iter_projections`]
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:28 iter_projections
  iter_projections(place: PlaceRef): IterableIterator<[PlaceRef, PlaceElem]> {
    return ProjectionIter.new(this.deref_chain(place.local), place);
  }
}

/// The iterator returned by [`UnDerefer::iter_projections`].
// rustc-type: compiler/rustc_mir_dataflow/src/un_derefer.rs:37 ProjectionIter
class ProjectionIter implements IterableIterator<[PlaceRef, PlaceElem]> {
  constructor(
    public places: SlicePlusOne<PlaceRef>,
    public proj_idx: number,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:44 new
  static new(deref_chain: readonly PlaceRef[], place: PlaceRef): ProjectionIter {
    // just return an empty iterator for a bare local
    let last: PlaceRef | undefined;
    if (place.as_local() === undefined) {
      last = place;
    } else {
      // debug_assert!(deref_chain.is_empty());
      last = undefined;
    }

    return new ProjectionIter(new SlicePlusOne(deref_chain, 0, last), 0);
  }

  /** `impl Iterator for ProjectionIter`. */
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:61 next
  next(): IteratorResult<[PlaceRef, PlaceElem]> {
    const place = this.places.read();
    if (place === undefined) return { done: true, value: undefined };

    // the projection should never be empty except for a bare local which is handled in new
    const partial_place = new PlaceRef(place.local, place.projection.slice(0, this.proj_idx));
    const elem = index_slice(place.projection, this.proj_idx);

    // PORT: `place.projection.len() - 1` (usize) never underflows here: the projection is non-empty.
    if (this.proj_idx === place.projection.length - 1) {
      this.proj_idx = 0;
      this.places.advance();
    } else {
      this.proj_idx += 1;
    }

    return { done: false, value: [partial_place, elem] };
  }

  [Symbol.iterator](): IterableIterator<[PlaceRef, PlaceElem]> {
    return this;
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/un_derefer.rs:80 SlicePlusOne
class SlicePlusOne<T> {
  constructor(
    /** `slice: &'a [T]`: `slice_[start..]`. */
    public slice_: readonly T[],
    public start: number,
    public last: T | undefined,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:87 read
  read(): T | undefined {
    return this.start < this.slice_.length ? this.slice_[this.start] : this.last;
  }

  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/un_derefer.rs:92 advance
  advance(): void {
    if (this.start < this.slice_.length) {
      // [_, remainder @ ..]
      this.start += 1;
    } else {
      // []
      this.last = undefined;
    }
  }
}

/** `slice[i]`: core's out-of-bounds panic. */
function index_slice<T>(slice: readonly T[], i: number): T {
  if (i >= slice.length) panic(`index out of bounds: the len is ${slice.length} but the index is ${i}`);
  return slice[i]!;
}
