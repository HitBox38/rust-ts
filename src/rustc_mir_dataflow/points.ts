// Port of compiler/rustc_mir_dataflow/src/points.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it): `DenseLocationMap` is a class (fields in declaration order); the `IndexVec`s
// are arrays indexed by the handle number (PORTING §5); `PointIndex` is a branded number with its `newtype_index!`
// companion (`PointIndex.new(i)`, `PointIndex.index(p)`; Debug `PointIndex({})`).
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { assert, panic } from "../std/panic.ts";
import { BasicBlock, type Body, Location } from "../rustc_middle/mir/mod.ts";

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
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:18 new
  static new(body: Body): DenseLocationMap {
    let num_points = 0;
    const statements_before_block: number[] = body.basic_blocks.deref().map((block_data) => {
      const v = num_points;
      num_points += block_data.statements.length + 1;
      return v;
    });

    const basic_blocks: BasicBlock[] = [];
    body.basic_blocks.deref().forEach((bb_data, bb_) => {
      const bb = BasicBlock.new(bb_);
      for (let i = 0; i <= bb_data.statements.length; i++) basic_blocks.push(bb);
    });
    // Invariant: no block is preceded by more than all statements.
    // debug_assert!(*statements_before_block.iter().max().unwrap() < num_points);
    return new DenseLocationMap(statements_before_block, basic_blocks, num_points);
  }

  /// Total number of point indices
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:41 num_points
  num_points(): number {
    return this.num_points_;
  }

  /// Converts a `Location` into a `PointIndex`. O(1).
  /// [[`Self::point_in_range()`]] guaranteed for the returned index.
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:48 point_from_location
  point_from_location(location: Location): PointIndex {
    const { block, statement_index } = location;
    const start_index = index_vec(this.statements_before_block, block);
    // Note the invariant in [`Self::new()`]; if the indexing
    // operation above did not panic then this holds by construction.
    // debug_assert!(start_index < self.num_points);
    return PointIndex.new(start_index + statement_index);
  }

  /// Returns the `PointIndex` for the first statement in the given `BasicBlock`. O(1).
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:59 entry_point
  entry_point(block: BasicBlock): PointIndex {
    const start_index = index_vec(this.statements_before_block, block);
    return PointIndex.new(start_index);
  }

  /// Return the PointIndex for the block start of this index.
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:66 to_block_start
  to_block_start(index: PointIndex): PointIndex {
    return PointIndex.new(index_vec(this.statements_before_block, index_vec(this.basic_blocks, index)));
  }

  /// Converts a `PointIndex` back to a location. O(1).
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:72 to_location
  to_location(index: PointIndex): Location {
    assert(PointIndex.index(index) < this.num_points_, "assertion failed: index.index() < self.num_points");
    const block = index_vec(this.basic_blocks, index);
    const start_index = index_vec(this.statements_before_block, block);
    const statement_index = PointIndex.index(index) - start_index;
    return new Location(block, statement_index);
  }

  /// Sometimes we get point-indices back from bitsets that may be
  /// out of range (because they round up to the nearest 2^N number
  /// of bits). Use this function to filter such points out if you
  /// like.
  // #[inline]
  // rustc: compiler/rustc_mir_dataflow/src/points.rs:85 point_in_range
  point_in_range(index: PointIndex): boolean {
    return PointIndex.index(index) < this.num_points_;
  }
}

/** `IndexVec` indexing: core's out-of-bounds panic. */
function index_vec<T>(v: readonly T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
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
