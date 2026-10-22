// Port of compiler/rustc_mir_dataflow/src/points.rs: DECLARED (lane dataflow-contract). Every fn is a stub for lane
// `dataflow-move-paths` (plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it): `DenseLocationMap` is a class (fields in declaration order); the `IndexVec`s
// are arrays indexed by the handle number (PORTING §5); `PointIndex` is a branded number with its `newtype_index!`
// companion (`PointIndex.new(i)`, `PointIndex.index(p)`; Debug `PointIndex({})`).
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { unported } from "../std/panic.ts";
import type { BasicBlock, Body, Location } from "../rustc_middle/mir/mod.ts";

/// Maps between a `Location` and a `PointIndex` (and vice versa).
// rustc-type: compiler/rustc_mir_dataflow/src/points.rs:5 DenseLocationMap
export class DenseLocationMap {
  constructor(
    /// For each basic block, how many points are contained within?
    public statements_before_block: number[],

    /// Map backward from each point to the basic block that it
    /// belongs to.
    public basic_blocks: BasicBlock[],

    public num_points_: number,
  ) {}

  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:18 new (lane dataflow-move-paths)
  static new(_body: Body): DenseLocationMap {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::new");
  }

  /// Total number of point indices
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:41 num_points (lane dataflow-move-paths)
  num_points(): number {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::num_points");
  }

  /// Converts a `Location` into a `PointIndex`. O(1).
  /// [[`Self::point_in_range()`]] guaranteed for the returned index.
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:48 point_from_location (lane dataflow-move-paths)
  point_from_location(_location: Location): PointIndex {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::point_from_location");
  }

  /// Returns the `PointIndex` for the first statement in the given `BasicBlock`. O(1).
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:59 entry_point (lane dataflow-move-paths)
  entry_point(_block: BasicBlock): PointIndex {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::entry_point");
  }

  /// Return the PointIndex for the block start of this index.
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:66 to_block_start (lane dataflow-move-paths)
  to_block_start(_index: PointIndex): PointIndex {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::to_block_start");
  }

  /// Converts a `PointIndex` back to a location. O(1).
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:72 to_location (lane dataflow-move-paths)
  to_location(_index: PointIndex): Location {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::to_location");
  }

  /// Sometimes we get point-indices back from bitsets that may be
  /// out of range (because they round up to the nearest 2^N number
  /// of bits). Use this function to filter such points out if you
  /// like.
  // #[inline]
  // stub: compiler/rustc_mir_dataflow/src/points.rs:85 point_in_range (lane dataflow-move-paths)
  point_in_range(_index: PointIndex): boolean {
    return unported("rustc_mir_dataflow::points::DenseLocationMap::point_in_range");
  }
}

// rustc_index::newtype_index! {
//     /// A single integer representing a `Location` in the MIR control-flow
//     /// graph. Constructed efficiently from `DenseLocationMap`.
//     #[orderable]
//     #[debug_format = "PointIndex({})"]
//     pub struct PointIndex {}
// }
/// A single integer representing a `Location` in the MIR control-flow
/// graph. Constructed efficiently from `DenseLocationMap`.
// rustc-type: compiler/rustc_mir_dataflow/src/points.rs:95 PointIndex
export type PointIndex = number & { readonly __brand: "PointIndex" };
export const PointIndex = newtype_index<PointIndex>((n) => `PointIndex(${n})`);
