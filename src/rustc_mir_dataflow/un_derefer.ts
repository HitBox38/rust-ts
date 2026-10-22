// Port of compiler/rustc_mir_dataflow/src/un_derefer.rs: DECLARED (lane dataflow-contract). Every fn is a stub for
// lane `dataflow-move-paths` (plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `UnDerefer` (`#[derive(Default)]`) is a class; `FxHashMap<Local, Vec<PlaceRef>>` is a `Map<Local, PlaceRef[]>`
//   (insertion-ordered; never iterated upstream). `UnDerefer::default()` is `new UnDerefer(new Map())`.
// - `ProjectionIter` is an `IterableIterator<[PlaceRef, PlaceElem]>` class; `SlicePlusOne<T>` keeps the slice as the
//   array plus a start offset (`&slice[1..]` is `start + 1`), `last: Option<T>` is `T | undefined`.
import { unported } from "../std/panic.ts";
import type { Local, PlaceElem, PlaceRef } from "./pending.ts";

/// Used for reverting changes made by `DerefSeparator`
// #[derive(Default, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/un_derefer.rs:6 UnDerefer
export class UnDerefer {
  constructor(public deref_chains: Map<Local, PlaceRef[]>) {}

  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:12 insert (lane dataflow-move-paths)
  insert(_local: Local, _reffed: PlaceRef): void {
    return unported("rustc_mir_dataflow::un_derefer::UnDerefer::insert");
  }

  /// Returns the chain of places behind `DerefTemp` locals
  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:20 deref_chain (lane dataflow-move-paths)
  deref_chain(_local: Local): readonly PlaceRef[] {
    return unported("rustc_mir_dataflow::un_derefer::UnDerefer::deref_chain");
  }

  /// Iterates over the projections of a place and its deref chain.
  ///
  /// See [`PlaceRef::iter_projections`]
  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:28 iter_projections (lane dataflow-move-paths)
  iter_projections(_place: PlaceRef): IterableIterator<[PlaceRef, PlaceElem]> {
    return unported("rustc_mir_dataflow::un_derefer::UnDerefer::iter_projections");
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
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:44 new (lane dataflow-move-paths)
  static new(_deref_chain: readonly PlaceRef[], _place: PlaceRef): ProjectionIter {
    return unported("rustc_mir_dataflow::un_derefer::ProjectionIter::new");
  }

  /** `impl Iterator for ProjectionIter`. */
  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:61 next (lane dataflow-move-paths)
  next(): IteratorResult<[PlaceRef, PlaceElem]> {
    return unported("rustc_mir_dataflow::un_derefer::ProjectionIter::next");
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
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:87 read (lane dataflow-move-paths)
  read(): T | undefined {
    return unported("rustc_mir_dataflow::un_derefer::SlicePlusOne::read");
  }

  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/un_derefer.rs:92 advance (lane dataflow-move-paths)
  advance(): void {
    return unported("rustc_mir_dataflow::un_derefer::SlicePlusOne::advance");
  }
}

/** Keeps the module-private types referenced for the fill lane. */
export const _un_derefer_decls = { ProjectionIter, SlicePlusOne };
