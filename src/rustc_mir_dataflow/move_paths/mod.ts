// Port of compiler/rustc_mir_dataflow/src/move_paths/mod.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
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
// - PORT: `MoveSubPath::ConstantIndex(u64)` / `MoveSubPathResult::Subslice { from, to }` are `number`s, as
//   `ProjectionElem::ConstantIndex` / `Subslice` (mir syntax.gen.ts: array offsets stay < 2^53).
// - PORT: the derived `Debug` of `MoveData` / `LocationMap` / `MovePathLookup` is not ported (only `debug!` uses it,
//   compiled out of release rustc).
//! [`MovePath`]s track the initialization state of places and their sub-paths.

import type { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Span } from "../../rustc_span/span_encoding.ts";
import { type Debug, debug_tuple, type Fmt, PLAIN } from "../../std/fmt.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import {
  type BasicBlock,
  type Body,
  debug_Location,
  debug_Place,
  Local as Local_,
  type Local,
  type Location,
  type Place,
  type PlaceRef,
  ProjectionElem,
  type ProjectionKind,
} from "../../rustc_middle/mir/mod.ts";
import type { UnDerefer } from "../un_derefer.ts";
import { gather_moves as builder_gather_moves } from "./builder.ts";

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
    // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:24 index
    index(self: MovePathIndex): number {
      return MovePathIndex.index(self);
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

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:43 move_path_index
  move_path_index(self: MoveOutIndex, move_data: MoveData): MovePathIndex {
    return move_data.move_outs[self]!.path;
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
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:75 parents
  parents(move_paths: readonly MovePath[]): IterableIterator<[MovePathIndex, MovePath]> {
    const first: [MovePathIndex, MovePath] | undefined = this.parent === undefined ? undefined : [this.parent, move_paths[this.parent]!];
    return new MovePathLinearIter(first, (_, parent: MovePath) =>
      parent.parent === undefined ? undefined : [parent.parent, move_paths[parent.parent]!],
    );
  }

  /// Returns an iterator over the immediate children of `self`.
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:89 children
  children(move_paths: readonly MovePath[]): IterableIterator<[MovePathIndex, MovePath]> {
    const first: [MovePathIndex, MovePath] | undefined =
      this.first_child === undefined ? undefined : [this.first_child, move_paths[this.first_child]!];
    return new MovePathLinearIter(first, (_, child: MovePath) =>
      child.next_sibling === undefined ? undefined : [child.next_sibling, move_paths[child.next_sibling]!],
    );
  }

  /// Finds the closest descendant of `self` for which `f` returns `true` using a breadth-first
  /// search.
  ///
  /// `f` will **not** be called on `self`.
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:106 find_descendant
  find_descendant(move_paths: readonly MovePath[], f: (mpi: MovePathIndex) => boolean): MovePathIndex | undefined {
    const child = this.first_child;
    if (child === undefined) return undefined;
    const todo: MovePathIndex[] = [child];

    let mpi: MovePathIndex | undefined;
    while ((mpi = todo.pop()) !== undefined) {
      if (f(mpi)) {
        return mpi;
      }

      const move_path = move_paths[mpi]!;
      if (move_path.first_child !== undefined) {
        todo.push(move_path.first_child);
      }

      // After we've processed the original `mpi`, we should always
      // traverse the siblings of any of its children.
      if (move_path.next_sibling !== undefined) {
        todo.push(move_path.next_sibling);
      }
    }

    return undefined;
  }
}

/** `impl Debug for MovePath`. */
// rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:136 fmt
export const debug_MovePath: Debug<MovePath> = (self: MovePath, _w: Fmt): string => {
  let w = "MovePath {";
  if (self.parent !== undefined) {
    const parent = self.parent;
    w += ` parent: ${MovePathIndex.debug(parent, PLAIN)},`;
  }
  if (self.first_child !== undefined) {
    const first_child = self.first_child;
    w += ` first_child: ${MovePathIndex.debug(first_child, PLAIN)},`;
  }
  if (self.next_sibling !== undefined) {
    const next_sibling = self.next_sibling;
    w += ` next_sibling: ${MovePathIndex.debug(next_sibling, PLAIN)}`;
  }
  w += ` place: ${debug_Place(self.place, PLAIN)} }`;
  return w;
};

/** `impl Display for MovePath`. */
// rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:152 fmt
export const display_MovePath = (self: MovePath): string => {
  return debug_Place(self.place, PLAIN);
};

// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:157 MovePathLinearIter
class MovePathLinearIter implements IterableIterator<[MovePathIndex, MovePath]> {
  constructor(
    public next_: [MovePathIndex, MovePath] | undefined,
    public fetch_next: (mpi: MovePathIndex, path: MovePath) => [MovePathIndex, MovePath] | undefined,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:168 next
  next(): IteratorResult<[MovePathIndex, MovePath]> {
    const ret = this.next_;
    this.next_ = undefined;
    if (ret === undefined) return { done: true, value: undefined };
    this.next_ = this.fetch_next(ret[0], ret[1]);
    return { done: false, value: ret };
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

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:399 gather_moves
  static gather_moves(body: Body, tcx: TyCtxt, filter: (ty: Ty) => boolean): MoveData {
    return builder_gather_moves(body, tcx, filter);
  }

  /// For the move path `mpi`, returns the root local variable that starts the path.
  /// (e.g., for a path like `a.b.c` returns `a`)
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:409 base_local
  base_local(mpi: MovePathIndex): Local {
    for (;;) {
      const path = this.move_paths[mpi]!;
      const l = path.place.as_local();
      if (l !== undefined) {
        return l;
      }
      mpi = unwrap(path.parent, "root move paths should be locals");
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:419 find_in_move_path_or_its_descendants
  find_in_move_path_or_its_descendants(root: MovePathIndex, pred: (mpi: MovePathIndex) => boolean): MovePathIndex | undefined {
    if (pred(root)) {
      return root;
    }

    return this.move_paths[root]!.find_descendant(this.move_paths, pred);
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
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:217 offset
  offset(loc: Location): number {
    const offset = this.block_starts[loc.block]! + loc.statement_index;
    // if cfg!(debug_assertions) {
    //     // A block's entries run until the next block's start, or the end of
    //     // `data` for the last block.
    //     let next = loc.block.as_usize() + 1;
    //     let block_end = self.block_starts.raw.get(next).copied().unwrap_or(self.data.len());
    //     assert!(offset < block_end, "{loc:?} is out of range for its block");
    // }
    return offset;
  }

  /** `impl<T> Index<Location> for LocationMap<T>`. */
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:232 index
  index(index: Location): T {
    const offset = this.offset(index);
    // PORT: `&self.data[i]` panics out of bounds (only reachable past the last block's terminator).
    if (offset >= this.data.length) panic_oob(offset, this.data.length);
    return this.data[offset]!;
  }

  /** `impl<T> IndexMut<Location> for LocationMap<T>`: a slot view onto `data`. */
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:238 index_mut
  index_mut(index: Location): MutRef<T> {
    const offset = this.offset(index);
    if (offset >= this.data.length) panic_oob(offset, this.data.length);
    return field_mut(this.data, offset);
  }

  /** `impl<T: Default + Clone> LocationMap<T>`: `T::default()` is `default_T()`. */
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:248 new
  static new<T>(body: Body, default_T: () => T): LocationMap<T> {
    const block_starts: number[] = [];
    let total = 0;
    for (const block of body.basic_blocks.deref()) {
      block_starts.push(total);
      total += block.statements.length + 1;
    }
    // PORT: `vec![T::default(); total]` clones the default into every slot: one fresh `default_T()` each.
    const data: T[] = [];
    for (let i = 0; i < total; i++) data.push(default_T());
    return new LocationMap(data, block_starts);
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
// rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:274 fmt
export const debug_MoveOut: Debug<MoveOut> = (self: MoveOut, _fmt: Fmt): string => {
  return `${MovePathIndex.debug(self.path, PLAIN)}@${debug_Location(self.source, PLAIN)}`;
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

/** `#[derive(Debug)] InitLocation`. */
export const debug_InitLocation: Debug<InitLocation> = (v, f) =>
  v.$ === "Argument" ? debug_tuple(f, "Argument", [Local_.debug(v._0, f)]) : debug_tuple(f, "Statement", [debug_Location(v._0, f)]);

/** `#[derive(PartialEq)] InitLocation`. */
export function InitLocation_eq(a: InitLocation, b: InitLocation): boolean {
  if (a.$ === "Argument") return b.$ === "Argument" && a._0 === b._0;
  return b.$ === "Statement" && a._0.block === b._0.block && a._0.statement_index === b._0.statement_index;
}

/** `impl Debug for Init`. */
// rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:310 fmt
export const debug_Init: Debug<Init> = (self: Init, _fmt: Fmt): string => {
  return `${MovePathIndex.debug(self.path, PLAIN)}@${debug_InitLocation(self.location, PLAIN)} (${self.kind})`;
};

export const Init = {
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:316 span
  span(self: Init, body: Body): Span {
    switch (self.location.$) {
      case "Argument": {
        const local = self.location._0;
        return body.local_decls[local]!.source_info.span;
      }
      case "Statement": {
        const location = self.location._0;
        return body.source_info(location).span;
      }
    }
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
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:359 find
  find(place: PlaceRef): LookupResult {
    // Look first in the locals (roots).
    let result = this.find_local(place.local);
    if (result === undefined) {
      return { $: "Parent", _0: undefined };
    }

    // Look for a projection through the found local.
    for (const [, elem] of this.un_derefer.iter_projections(place)) {
      let subpath: MovePathIndex | undefined;
      const r = MoveSubPath.of(ProjectionElem.kind(elem));
      switch (r.$) {
        case "One": {
          const kind = r._0;
          subpath = this.projections.get(MoveSubPath_key(result, kind));
          break;
        }
        case "Subslice":
          subpath = undefined; // just use the parent MovePath
          break;
        case "Skip":
          continue;
        case "Stop":
          subpath = undefined;
          break;
      }

      if (subpath === undefined) {
        return { $: "Parent", _0: result };
      }
      result = subpath;
    }

    return { $: "Exact", _0: result };
  }

  /// For locals, which are roots.
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:385 find_local
  find_local(local: Local): MovePathIndex | undefined {
    if (local >= this.locals.length) panic_oob(local, this.locals.length);
    return this.locals[local];
  }

  /// An enumerated iterator of `local`s and their associated
  /// `MovePathIndex`es.
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:391 iter_locals_enumerated
  iter_locals_enumerated(): [Local, MovePathIndex][] {
    const out: [Local, MovePathIndex][] = [];
    this.locals.forEach((idx, l) => {
      if (idx !== undefined) out.push([Local_.new(l), idx]);
    });
    return out;
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
  | { readonly $: "ConstantIndex"; readonly _0: number }
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
  | { readonly $: "Subslice"; readonly from: number; readonly to: number }
  | { readonly $: "Skip" }
  | { readonly $: "Stop" };

/** Unit variants of `MoveSubPathResult` (shared frozen singletons); derived `PartialEq` compares by variant. */
export const MoveSubPathResult = {
  Skip: Object.freeze({ $: "Skip" as const }),
  Stop: Object.freeze({ $: "Stop" as const }),
};

export const MoveSubPath = {
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/mod.rs:451 of
  of(elem: ProjectionKind): MoveSubPathResult {
    let subpath: MoveSubPath;
    switch (elem.$) {
      // correspond to a MoveSubPath
      case "Deref":
        subpath = MoveSubPath.Deref;
        break;
      case "PhantomDeref":
        return unreachable("internal error: entered unreachable code: unexpected PhantomDeref in MoveSubPath::of");
      case "Field":
        subpath = { $: "Field", _0: elem._0 };
        break;
      case "ConstantIndex":
        if (!elem.from_end) {
          subpath = { $: "ConstantIndex", _0: elem.offset };
          break;
        }
        // these cannot be moved through
        return MoveSubPathResult.Stop;
      case "Downcast":
        subpath = { $: "Downcast", _0: elem._1 };
        break;
      case "UnwrapUnsafeBinder":
        subpath = MoveSubPath.UnwrapUnsafeBinder;
        break;

      // this should be the same move path as its parent
      // its fine to skip because it cannot have sibling move paths
      // and it is not a user visible path
      case "OpaqueCast":
        return MoveSubPathResult.Skip;

      // these cannot be moved through
      case "Index":
        return MoveSubPathResult.Stop;
      case "Subslice":
        if (elem.from_end) {
          return MoveSubPathResult.Stop;
        }
        // subslice is special.
        // it needs to be split into individual move paths
        return { $: "Subslice", from: elem.from, to: elem.to };
    }

    return { $: "One", _0: subpath };
  },

  /** Unit variants (shared frozen singletons). */
  Deref: Object.freeze({ $: "Deref" as const }),
  UnwrapUnsafeBinder: Object.freeze({ $: "UnwrapUnsafeBinder" as const }),
};

/** `BasicBlock` is used by `LocationMap.block_starts` (an `IndexVec<BasicBlock, usize>`). */
export type _LocationMapIndex = BasicBlock;

/** `IndexVec` / `Vec` indexing out of bounds: core's panic message. */
function panic_oob(index: number, len: number): never {
  return panic(`index out of bounds: the len is ${len} but the index is ${index}`);
}
