// Port of compiler/rustc_mir_dataflow/src/move_paths/mod.rs: DECLARED (lane dataflow-contract). The types are
// declared here with their final shape; every fn is a stub for lane `dataflow-move-paths` (plan-m4 §5 wave 22) except
// the trait declaration `HasMoveData::move_data`.
//
// Representation (fill lanes keep it):
// - `MovePathIndex` / `MoveOutIndex` / `InitIndex` are branded numbers with `newtype_index!` companions (PORTING §5);
//   `MoveOutIndex::move_path_index` is on the companion.
// - `MovePath` (inherent methods) is a class with its fields in declaration order; `MoveOut` / `Init` (`Copy`, no
//   mutation) are interfaces + object literals, `Init::span` is on the `Init` companion; `MoveData`, `LocationMap<T>`,
//   `MovePathLookup` are classes. `IndexVec` / `SmallVec` are arrays; `FxHashMap<(MovePathIndex, MoveSubPath), ..>` is
//   a `KeyedMap` keyed by `MoveSubPath_key` (PORTING §5 composite keys).
// - `impl Index<Location> / IndexMut<Location> for LocationMap<T>` are `index(loc)` / `index_mut(loc)` (the latter
//   returns a `MutRef<T>` slot view onto `data`, PORTING §8).
// - `impl Debug` / `Display for MovePath` are `debug_MovePath` / `display_MovePath`; `Debug for MoveOut` / `Init` are
//   `debug_MoveOut` / `debug_Init`.
// - `HasMoveData<'tcx>` is an interface (`move_data()`); `impl Fn(..)` parameters are closures.
//! [`MovePath`]s track the initialization state of places and their sub-paths.

import type { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Span } from "../../rustc_span/span_encoding.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { BasicBlock, Body, Local, Location, Place, PlaceRef, ProjectionKind } from "../pending.ts";
import type { UnDerefer } from "../un_derefer.ts";

// rustc_index::newtype_index! {
//     /// Index identifying a `MovePath`.
//     #[orderable]
//     #[debug_format = "mp{}"]
//     pub struct MovePathIndex {}
// }
/// Index identifying a `MovePath`.
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:20 MovePathIndex
export type MovePathIndex = number & { readonly __brand: "MovePathIndex" };
export const MovePathIndex = {
  ...newtype_index<MovePathIndex>((n) => `mp${n}`),

  /** `impl polonius_engine::Atom for MovePathIndex`. */
  Atom: {
    // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:24 index (lane dataflow-move-paths)
    index(_self: MovePathIndex): number {
      return unported("rustc_mir_dataflow::move_paths::MovePathIndex::Atom::index");
    },
  },
};

// rustc_index::newtype_index! {
//     /// Index identifying a `MoveOut`.
//     #[orderable]
//     #[debug_format = "mo{}"]
//     pub struct MoveOutIndex {}
// }
/// Index identifying a `MoveOut`.
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:33 MoveOutIndex
export type MoveOutIndex = number & { readonly __brand: "MoveOutIndex" };
export const MoveOutIndex = {
  ...newtype_index<MoveOutIndex>((n) => `mo${n}`),

  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:43 move_path_index (lane dataflow-move-paths)
  move_path_index(_self: MoveOutIndex, _move_data: MoveData): MovePathIndex {
    return unported("rustc_mir_dataflow::move_paths::MoveOutIndex::move_path_index");
  },
};

// rustc_index::newtype_index! {
//     /// Index identifying an `Init`.
//     #[debug_format = "in{}"]
//     pub struct InitIndex {}
// }
/// Index identifying an `Init`.
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:39 InitIndex
export type InitIndex = number & { readonly __brand: "InitIndex" };
export const InitIndex = newtype_index<InitIndex>((n) => `in${n}`);

/// `MovePath` is a canonicalized representation of a place that is of
/// interest to dataflow analysis, as identified by `gather_moves`. This
/// is primarily places that are moved or inited (assigned). Each
/// `MovePath` is assigned a `MovePathIndex` by which it can be referred
/// to.
///
/// `MovePath` follows a tree structure.
///
/// Given `struct X { m: M, n: N }` and `x: X`, moves like `drop x.m;`
/// move *out* of the place `x.m`.
///
/// The MovePaths representing `x.m` and `x.n` are siblings (that is,
/// one of them will link to the other via the `next_sibling` field,
/// and the other will have no entry in its `next_sibling` field), and
/// they both have the MovePath representing `x` as their parent.
/// (All tree roots are locals). This structure allows easy traversal
/// between related paths `x` and `x.m` and `x.n`.
// #[derive(Clone)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:66 MovePath
export class MovePath {
  constructor(
    public next_sibling: MovePathIndex | undefined,
    public first_child: MovePathIndex | undefined,
    public parent: MovePathIndex | undefined,
    public place: Place,
  ) {}

  /// Returns an iterator over the parents of `self`.
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:75 parents (lane dataflow-move-paths)
  parents(_move_paths: readonly MovePath[]): Iterable<[MovePathIndex, MovePath]> {
    return unported("rustc_mir_dataflow::move_paths::MovePath::parents");
  }

  /// Returns an iterator over the immediate children of `self`.
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:89 children (lane dataflow-move-paths)
  children(_move_paths: readonly MovePath[]): Iterable<[MovePathIndex, MovePath]> {
    return unported("rustc_mir_dataflow::move_paths::MovePath::children");
  }

  /// Finds the closest descendant of `self` for which `f` returns `true` using a breadth-first
  /// search.
  ///
  /// `f` will **not** be called on `self`.
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:106 find_descendant (lane dataflow-move-paths)
  find_descendant(_move_paths: readonly MovePath[], _f: (mpi: MovePathIndex) => boolean): MovePathIndex | undefined {
    return unported("rustc_mir_dataflow::move_paths::MovePath::find_descendant");
  }
}

/** `impl Debug for MovePath`. */
// stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:136 fmt (lane dataflow-move-paths)
export const debug_MovePath: Debug<MovePath> = (_self: MovePath, _w: Fmt): string => {
  return unported("rustc_mir_dataflow::move_paths::MovePath::fmt (Debug)");
};

/** `impl Display for MovePath`. */
// stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:152 fmt (lane dataflow-move-paths)
export const display_MovePath = (_self: MovePath): string => {
  return unported("rustc_mir_dataflow::move_paths::MovePath::fmt (Display)");
};

// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:157 MovePathLinearIter
class MovePathLinearIter implements IterableIterator<[MovePathIndex, MovePath]> {
  constructor(
    public next_: [MovePathIndex, MovePath] | undefined,
    public fetch_next: (mpi: MovePathIndex, path: MovePath) => [MovePathIndex, MovePath] | undefined,
  ) {}

  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:168 next (lane dataflow-move-paths)
  next(): IteratorResult<[MovePathIndex, MovePath]> {
    return unported("rustc_mir_dataflow::move_paths::MovePathLinearIter::next");
  }

  [Symbol.iterator](): IterableIterator<[MovePathIndex, MovePath]> {
    return this;
  }
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:176 MoveData
export class MoveData {
  constructor(
    /// All the gathered `MovePath`s.
    public move_paths: MovePath[],

    /// All the `MoveOut`s.
    public move_outs: MoveOut[],
    /// Map from locations to `MoveOut`s. `SmallVec` because each location might cause more than
    /// one `MoveOut`. Used during analysis and diagnostics.
    public move_out_loc_map: LocationMap<MoveOutIndex[]>,
    /// Map from `MovePath`s (places) to `MoveOuts`. `SmallVec` because each `MovePath` may be
    /// moved-out of more than once. Used mostly for diagnostics.
    public move_out_path_map: MoveOutIndex[][],

    /// Map from places/locals to `MovePath`s.
    public rev_lookup: MovePathLookup,

    /// All the `Init`s.
    public inits: Init[],
    /// Map from locations to `Init`s. `SmallVec` because each location might cause more than one
    /// `Init`, though more than one is very rare (e.g. inline asm).
    public init_loc_map: LocationMap<InitIndex[]>,
    /// Map from `MovePath`s (places) to `Init`s. `SmallVec` because each `MovePath` (place) might
    /// be inited more than once.
    public init_path_map: InitIndex[][],
  ) {}

  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:399 gather_moves (lane dataflow-move-paths)
  static gather_moves(_body: Body, _tcx: TyCtxt, _filter: (ty: Ty) => boolean): MoveData {
    return unported("rustc_mir_dataflow::move_paths::MoveData::gather_moves");
  }

  /// For the move path `mpi`, returns the root local variable that starts the path.
  /// (e.g., for a path like `a.b.c` returns `a`)
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:409 base_local (lane dataflow-move-paths)
  base_local(_mpi: MovePathIndex): Local {
    return unported("rustc_mir_dataflow::move_paths::MoveData::base_local");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:419 find_in_move_path_or_its_descendants (lane dataflow-move-paths)
  find_in_move_path_or_its_descendants(_root: MovePathIndex, _pred: (mpi: MovePathIndex) => boolean): MovePathIndex | undefined {
    return unported("rustc_mir_dataflow::move_paths::MoveData::find_in_move_path_or_its_descendants");
  }
}

// rustc-trait: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:202 HasMoveData
export interface HasMoveData {
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:203 move_data
  move_data(): MoveData;
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:207 LocationMap
export class LocationMap<T> {
  constructor(
    /// All per-location entries live in the single flat `data` vector.
    /// `block_starts[bb]` gives the index in `data` where block `bb`'s entries
    /// start; each block has one entry per statement plus one for its terminator.
    public data: T[],
    public block_starts: number[],
  ) {}

  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:217 offset (lane dataflow-move-paths)
  offset(_loc: Location): number {
    return unported("rustc_mir_dataflow::move_paths::LocationMap::offset");
  }

  /** `impl<T> Index<Location> for LocationMap<T>`. */
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:232 index (lane dataflow-move-paths)
  index(_index: Location): T {
    return unported("rustc_mir_dataflow::move_paths::LocationMap::index");
  }

  /** `impl<T> IndexMut<Location> for LocationMap<T>`: a slot view onto `data`. */
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:238 index_mut (lane dataflow-move-paths)
  index_mut(_index: Location): MutRef<T> {
    return unported("rustc_mir_dataflow::move_paths::LocationMap::index_mut");
  }

  /** `impl<T: Default + Clone> LocationMap<T>`: `T::default()` is `default_T()`. */
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:248 new (lane dataflow-move-paths)
  static new<T>(_body: Body, _default_T: () => T): LocationMap<T> {
    return unported("rustc_mir_dataflow::move_paths::LocationMap::new");
  }
}

/// `MoveOut` represents a point in a program that moves out of some
/// L-value; i.e., "creates" uninitialized memory. The dual of `Init`.
///
/// With respect to dataflow analysis:
/// - Generated by moves and declaration of uninitialized variables.
/// - Killed by assignments to the memory.
// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:266 MoveOut
export interface MoveOut {
  /// path being moved
  readonly path: MovePathIndex;
  /// location of move
  readonly source: Location;
}

/** `impl Debug for MoveOut`. */
// stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:274 fmt (lane dataflow-move-paths)
export const debug_MoveOut: Debug<MoveOut> = (_self: MoveOut, _fmt: Fmt): string => {
  return unported("rustc_mir_dataflow::move_paths::MoveOut::fmt");
};

/// `Init` represents a point in a program that initializes some L-value. The dual of `MoveOut`.
// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:281 Init
export interface Init {
  /// path being initialized
  readonly path: MovePathIndex;
  /// location of initialization
  readonly location: InitLocation;
  /// Extra information about this initialization
  readonly kind: InitKind;
}

/// Initializations can be from an argument or from a statement. Arguments
/// do not have locations, in those cases the `Local` is kept.
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:293 InitLocation
export type InitLocation = { readonly $: "Argument"; readonly _0: Local } | { readonly $: "Statement"; readonly _0: Location };

/// Additional information about the initialization.
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:300 InitKind
export type InitKind =
  /// Deep init, even on panic
  | "Deep"
  /// Only does a shallow init
  | "Shallow"
  /// This doesn't initialize the variable on panic (and a panic is possible).
  | "NonPanicPathOnly";
export const InitKind = { Deep: "Deep", Shallow: "Shallow", NonPanicPathOnly: "NonPanicPathOnly" } as const;

/** `impl Debug for Init`. */
// stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:310 fmt (lane dataflow-move-paths)
export const debug_Init: Debug<Init> = (_self: Init, _fmt: Fmt): string => {
  return unported("rustc_mir_dataflow::move_paths::Init::fmt");
};

export const Init = {
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:316 span (lane dataflow-move-paths)
  span(_self: Init, _body: Body): Span {
    return unported("rustc_mir_dataflow::move_paths::Init::span");
  },
};

/// Tables mapping from a place to its `MovePathIndex`.
// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:326 MovePathLookup
export class MovePathLookup {
  constructor(
    public locals: (MovePathIndex | undefined)[],

    /// projections are made from a base-place and a projection
    /// elem. The base-place will have a unique MovePathIndex; we use
    /// the latter as the index into the outer vector (narrowing
    /// subsequent search so that it is solely relative to that
    /// base-place). For the remaining lookup, we map the projection
    /// elem to the associated MovePathIndex.
    // PORT: `FxHashMap<(MovePathIndex, MoveSubPath), MovePathIndex>`, keyed by `MoveSubPath_key(mpi, sub)`.
    public projections: Map<string, MovePathIndex>,

    public un_derefer: UnDerefer,
  ) {}

  // Unlike the builder `fn move_path_for` below, this lookup
  // alternative will *not* create a MovePath on the fly for an
  // unknown place, but will rather return the nearest available
  // parent.
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:359 find (lane dataflow-move-paths)
  find(_place: PlaceRef): LookupResult {
    return unported("rustc_mir_dataflow::move_paths::MovePathLookup::find");
  }

  /// For locals, which are roots.
  // #[inline]
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:385 find_local (lane dataflow-move-paths)
  find_local(_local: Local): MovePathIndex | undefined {
    return unported("rustc_mir_dataflow::move_paths::MovePathLookup::find_local");
  }

  /// An enumerated iterator of `local`s and their associated
  /// `MovePathIndex`es.
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:391 iter_locals_enumerated (lane dataflow-move-paths)
  iter_locals_enumerated(): [Local, MovePathIndex][] {
    return unported("rustc_mir_dataflow::move_paths::MovePathLookup::iter_locals_enumerated");
  }
}

// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:343 LookupResult
export type LookupResult =
  /// This exact thing has a move path. E.g. we looked up `x` or `x.m` and it has been moved.
  | { readonly $: "Exact"; readonly _0: MovePathIndex }

  /// - If the field is `None`, neither the exact thing nor any ancestor of it has a move path.
  ///   E.g. we looked up `x.m` and neither it nor `x` have a move path.
  /// - If the field is `Some`, the exact thing has no move path, but an ancestor does. E.g. we
  ///   looked up `x.m` which has no move path but `x` has one. Not possible for locals.
  | { readonly $: "Parent"; readonly _0: MovePathIndex | undefined };

/// A projection into a move path producing a child path
// #[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:434 MoveSubPath
export type MoveSubPath =
  | { readonly $: "Deref" }
  | { readonly $: "Field"; readonly _0: FieldIdx }
  | { readonly $: "ConstantIndex"; readonly _0: bigint }
  | { readonly $: "Downcast"; readonly _0: VariantIdx }
  | { readonly $: "UnwrapUnsafeBinder" };

/** The key of `(MovePathIndex, MoveSubPath)` in `MovePathLookup.projections` (derived `Hash` + `Eq`). */
export function MoveSubPath_key(mpi: MovePathIndex, sub: MoveSubPath): string {
  return sub.$ === "Deref" || sub.$ === "UnwrapUnsafeBinder" ? `${mpi}:${sub.$}` : `${mpi}:${sub.$}:${sub._0}`;
}

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:443 MoveSubPathResult
export type MoveSubPathResult =
  | { readonly $: "One"; readonly _0: MoveSubPath }
  | { readonly $: "Subslice"; readonly from: bigint; readonly to: bigint }
  | { readonly $: "Skip" }
  | { readonly $: "Stop" };

export const MoveSubPath = {
  // stub-df: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:451 of (lane dataflow-move-paths)
  of(_elem: ProjectionKind): MoveSubPathResult {
    return unported("rustc_mir_dataflow::move_paths::MoveSubPath::of");
  },
};

/** `BasicBlock` is used by `LocationMap.block_starts` (an `IndexVec<BasicBlock, usize>`). */
export type _LocationMapIndex = BasicBlock;
/** Keeps the module-private iterator referenced for the fill lane. */
export const _move_paths_decls = { MovePathLinearIter };
