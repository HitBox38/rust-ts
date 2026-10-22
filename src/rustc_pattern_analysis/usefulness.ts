// Port of compiler/rustc_pattern_analysis/src/usefulness.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-a's.
// The module doc comment (usefulness.rs:1-709) comes with the port.
//
// ## How to fill a stub (lane pat-a)
// The types (fields in declaration order) and signatures are final. Replace the `unported(..)` body in place and turn
// `// stub: <path>:<line> <name> (lane pat-a)` into `// rustc: <path>:<line> <name>`; then lower the counts in
// src/rustc_pattern_analysis/contract.test.ts. Conventions: lib.ts header.
import type { Constructor, IntRange } from "./constructor.ts";
import type { MatchArm, PatCx, PatCxStatic, PatCxTypes } from "./lib.ts";
import type { DeconstructedPat, PatId, PatOrWild, WitnessPat } from "./pat.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// A pattern is a "branch" if it is the immediate child of an or-pattern, or if it is the whole
/// pattern of a match arm. These are the patterns that can be meaningfully considered "redundant",
/// since e.g. `0` in `(0, 1)` cannot be redundant on its own.
///
/// We track for each branch pattern whether it is useful, and if not why.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:728 BranchPatUsefulness
class BranchPatUsefulness<Cx extends PatCxTypes> {
  constructor(
    /// Whether this pattern is useful.
    public useful: boolean,
    /// A set of patterns that:
    /// - come before this one in the match;
    /// - intersect this one;
    /// - at the end of the algorithm, if `!self.useful`, their union covers this pattern.
    // PORT: `FxHashSet<&DeconstructedPat>` keys on the object (one per `uid`, the `Hash` / `Eq` of `DeconstructedPat`).
    public covered_by: Set<DeconstructedPat<Cx>>,
  ) {}

  /// Update `self` with the usefulness information found in `row`.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:740 update (lane pat-a)
  update(_row: MatrixRow<Cx>, _matrix: Matrix<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::BranchPatUsefulness::update");
  }

  /// Check whether this pattern is redundant, and if so explain why.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:766 is_redundant (lane pat-a)
  is_redundant(): RedundancyExplanation<Cx> | undefined {
    return unported("rustc_pattern_analysis::usefulness::BranchPatUsefulness::is_redundant");
  }

  // impl<'p, Cx: PatCx> Default for BranchPatUsefulness<'p, Cx>
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:781 default (lane pat-a)
  static default<Cx extends PatCxTypes>(): BranchPatUsefulness<Cx> {
    return unported("rustc_pattern_analysis::usefulness::BranchPatUsefulness::default");
  }
}

/// Context that provides information for usefulness checking.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:787 UsefulnessCtxt
class UsefulnessCtxt<Cx extends PatCxTypes> {
  constructor(
    /// The context for type information.
    readonly tycx: PatCx<Cx>,
    /// Track information about the usefulness of branch patterns (see definition of "branch
    /// pattern" at [`BranchPatUsefulness`]).
    readonly branch_usefulness: Map<PatId, BranchPatUsefulness<Cx>>,
    // Ideally this field would have type `Limit`, but this crate is used by
    // rust-analyzer which cannot have a dependency on `Limit`, because `Limit`
    // is from crate `rustc_session` which uses unstable Rust features.
    readonly complexity_limit: number,
    public complexity_level: number,
  ) {}

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:801 increase_complexity_level (lane pat-a)
  increase_complexity_level(_complexity_add: number): Result<null, Cx["Error"]> {
    return unported("rustc_pattern_analysis::usefulness::UsefulnessCtxt::increase_complexity_level");
  }
}

/// Context that provides information local to a place under investigation.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:812 PlaceCtxt
class PlaceCtxt<Cx extends PatCxTypes> {
  constructor(
    readonly cx: PatCx<Cx>,
    /// Type of the place under investigation.
    readonly ty: Cx["Ty"],
  ) {}

  // impl<'a, Cx: PatCx> Clone for PlaceCtxt<'a, Cx> (and `Copy`)
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:820 clone (lane pat-a)
  clone(): PlaceCtxt<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PlaceCtxt::clone");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:832 ctor_arity (lane pat-a)
  ctor_arity(_ctor: Constructor<Cx>): number {
    return unported("rustc_pattern_analysis::usefulness::PlaceCtxt::ctor_arity");
  }
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:835 wild_from_ctor (lane pat-a)
  wild_from_ctor(_ctor: Constructor<Cx>): WitnessPat<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PlaceCtxt::wild_from_ctor");
  }
}

// impl<'a, Cx: PatCx> fmt::Debug for PlaceCtxt<'a, Cx>
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:826 fmt (lane pat-a)
function debug_PlaceCtxt<Cx extends PatCxTypes>(_cx: PatCxStatic<Cx>): Debug<PlaceCtxt<Cx>> {
  return unported("rustc_pattern_analysis::usefulness::PlaceCtxt::fmt");
}

/// Track whether a given place (aka column) is known to contain a valid value or not.
// #[derive(Debug, Copy, Clone, PartialEq, Eq)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:842 PlaceValidity
export type PlaceValidity = "ValidOnly" | "MaybeInvalid";

export const PlaceValidity = {
  ValidOnly: "ValidOnly",
  MaybeInvalid: "MaybeInvalid",

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:848 from_bool (lane pat-a)
  from_bool(_is_valid_only: boolean): PlaceValidity {
    return unported("rustc_pattern_analysis::usefulness::PlaceValidity::from_bool");
  },

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:852 is_known_valid (lane pat-a)
  is_known_valid(_self: PlaceValidity): boolean {
    return unported("rustc_pattern_analysis::usefulness::PlaceValidity::is_known_valid");
  },

  /// If the place has validity given by `self` and we read that the value at the place has
  /// constructor `ctor`, this computes what we can assume about the validity of the constructor
  /// fields.
  ///
  /// Pending further opsem decisions, the current behavior is: validity is preserved, except
  /// inside `&` and union fields where validity is reset to `MaybeInvalid`.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:862 specialize (lane pat-a)
  specialize<Cx extends PatCxTypes>(_self: PlaceValidity, _ctor: Constructor<Cx>): PlaceValidity {
    return unported("rustc_pattern_analysis::usefulness::PlaceValidity::specialize");
  },
} as const;
/** The derived `Debug` of `PlaceValidity`. */
export const debug_PlaceValidity: Debug<PlaceValidity> = (v) => v;

// impl fmt::Display for PlaceValidity
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:875 fmt (lane pat-a)
export function display_PlaceValidity(_self: PlaceValidity): string {
  return unported("rustc_pattern_analysis::usefulness::PlaceValidity::fmt");
}

/// Data about a place under investigation. Its methods contain a lot of the logic used to analyze
/// the constructors in the matrix.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:886 PlaceInfo
class PlaceInfo<Cx extends PatCxTypes> {
  constructor(
    /// The type of the place.
    readonly ty: Cx["Ty"],
    /// Whether the place is a private uninhabited field. If so we skip this field during analysis
    /// so that we don't observe its emptiness.
    readonly private_uninhabited: boolean,
    /// Whether the place is known to contain valid data.
    readonly validity: PlaceValidity,
    /// Whether the place is the scrutinee itself or a subplace of it.
    readonly is_scrutinee: boolean,
  ) {}

  /// Given a constructor for the current place, we return one `PlaceInfo` for each field of the
  /// constructor.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:901 specialize (lane pat-a)
  specialize(_cx: PatCx<Cx>, _ctor: Constructor<Cx>): PlaceInfo<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::PlaceInfo::specialize");
  }

  /// This analyzes a column of constructors corresponding to the current place. It returns a pair
  /// `(split_ctors, missing_ctors)`.
  ///
  /// `split_ctors` is a splitted list of constructors that cover the whole type. This will be
  /// used to specialize the matrix.
  ///
  /// `missing_ctors` is a list of the constructors not found in the column, for reporting
  /// purposes.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:924 split_column_ctors (lane pat-a)
  split_column_ctors(
    _cx: PatCx<Cx>,
    _ctors: readonly Constructor<Cx>[],
  ): Result<[Constructor<Cx>[], Constructor<Cx>[]], Cx["Error"]> {
    return unported("rustc_pattern_analysis::usefulness::PlaceInfo::split_column_ctors");
  }

  // impl<Cx: PatCx> Clone for PlaceInfo<Cx>
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1004 clone (lane pat-a)
  clone(): PlaceInfo<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PlaceInfo::clone");
  }
}

/// Represents a pattern-tuple under investigation.
// The three lifetimes are:
// - 'p coming from the input
// - Cx global compilation context
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1018 PatStack
class PatStack<Cx extends PatCxTypes> {
  constructor(
    // Rows of len 1 are very common, which is why `SmallVec[_; 2]` works well.
    public pats: PatOrWild<Cx>[],
    /// Sometimes we know that as far as this row is concerned, the current case is already handled
    /// by a different, more general, case. When the case is irrelevant for all rows this allows us
    /// to skip a case entirely. This is purely an optimization. See at the top for details.
    public relevant: boolean,
  ) {}

  // impl<'p, Cx: PatCx> Clone for PatStack<'p, Cx>
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1028 clone (lane pat-a)
  clone(): PatStack<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PatStack::clone");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1034 from_pattern (lane pat-a)
  static from_pattern<Cx extends PatCxTypes>(_pat: DeconstructedPat<Cx>): PatStack<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PatStack::from_pattern");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1038 len (lane pat-a)
  len(): number {
    return unported("rustc_pattern_analysis::usefulness::PatStack::len");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1042 head (lane pat-a)
  head(): PatOrWild<Cx> {
    return unported("rustc_pattern_analysis::usefulness::PatStack::head");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1046 iter (lane pat-a)
  iter(): readonly PatOrWild<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::PatStack::iter");
  }

  // Expand the first or-pattern into its subpatterns. Only useful if the pattern is an
  // or-pattern. Panics if `self` is empty.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1052 expand_or_pat (lane pat-a)
  expand_or_pat(): PatStack<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::PatStack::expand_or_pat");
  }

  /// This computes `specialize(ctor, self)`. See top of the file for explanations.
  /// Only call if `ctor.is_covered_by(self.head().ctor())` is true.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1062 pop_head_constructor (lane pat-a)
  pop_head_constructor(
    _cx: PatCx<Cx>,
    _ctor: Constructor<Cx>,
    _ctor_arity: number,
    _ctor_is_relevant: boolean,
  ): Result<PatStack<Cx>, Cx["Error"]> {
    return unported("rustc_pattern_analysis::usefulness::PatStack::pop_head_constructor");
  }
}

// impl<'p, Cx: PatCx> fmt::Debug for PatStack<'p, Cx>
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1090 fmt (lane pat-a)
function debug_PatStack<Cx extends PatCxTypes>(_cx: PatCxStatic<Cx>): Debug<PatStack<Cx>> {
  return unported("rustc_pattern_analysis::usefulness::PatStack::fmt");
}

/// A row of the matrix.
// #[derive(Clone)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1102 MatrixRow
class MatrixRow<Cx extends PatCxTypes> {
  constructor(
    // The patterns in the row.
    public pats: PatStack<Cx>,
    /// Whether the original arm had a guard. This is inherited when specializing.
    public is_under_guard: boolean,
    /// When we specialize, we remember which row of the original matrix produced a given row of the
    /// specialized matrix. When we unspecialize, we use this to propagate usefulness back up the
    /// callstack. On creation, this stores the index of the original match arm.
    public parent_row: number,
    /// False when the matrix is just built. This is set to `true` by
    /// [`compute_exhaustiveness_and_usefulness`] if the arm is found to be useful.
    /// This is reset to `false` when specializing.
    public useful: boolean,
    /// Tracks some rows above this one that have an intersection with this one, i.e. such that
    /// there is a value that matches both rows.
    /// Because of relevancy we may miss some intersections. The intersections we do find are
    /// correct. In other words, this is an underapproximation of the real set of intersections.
    ///
    /// For example:
    /// ```rust,ignore(illustrative)
    /// match ... {
    ///     (true, _, _) => {} // `intersects_at_least = []`
    ///     (_, true, 0..=10) => {} // `intersects_at_least = []`
    ///     (_, true, 5..15) => {} // `intersects_at_least = [1]`
    /// }
    /// ```
    /// Here the `(true, true)` case is irrelevant. Since we skip it, we will not detect that row 0
    /// intersects rows 1 and 2.
    public intersects_at_least: DenseBitSet<number>,
    /// Whether the head pattern is a branch (see definition of "branch pattern" at
    /// [`BranchPatUsefulness`])
    public head_is_branch: boolean,
  ) {}

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1137 new (lane pat-a)
  static new<Cx extends PatCxTypes>(_arm: MatchArm<Cx>, _arm_id: number): MatrixRow<Cx> {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::new");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1149 len (lane pat-a)
  len(): number {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::len");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1153 head (lane pat-a)
  head(): PatOrWild<Cx> {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::head");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1157 iter (lane pat-a)
  iter(): readonly PatOrWild<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::iter");
  }

  // Expand the first or-pattern (if any) into its subpatterns. Panics if `self` is empty.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1162 expand_or_pat (lane pat-a)
  expand_or_pat(_parent_row: number): MatrixRow<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::expand_or_pat");
  }

  /// This computes `specialize(ctor, self)`. See top of the file for explanations.
  /// Only call if `ctor.is_covered_by(self.head().ctor())` is true.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1176 pop_head_constructor (lane pat-a)
  pop_head_constructor(
    _cx: PatCx<Cx>,
    _ctor: Constructor<Cx>,
    _ctor_arity: number,
    _ctor_is_relevant: boolean,
    _parent_row: number,
  ): Result<MatrixRow<Cx>, Cx["Error"]> {
    return unported("rustc_pattern_analysis::usefulness::MatrixRow::pop_head_constructor");
  }
}

// impl<'p, Cx: PatCx> fmt::Debug for MatrixRow<'p, Cx>
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1196 fmt (lane pat-a)
function debug_MatrixRow<Cx extends PatCxTypes>(_cx: PatCxStatic<Cx>): Debug<MatrixRow<Cx>> {
  return unported("rustc_pattern_analysis::usefulness::MatrixRow::fmt");
}

/// A 2D matrix. Represents a list of pattern-tuples under investigation.
///
/// Invariant: each row must have the same length, and each column must have the same type.
///
/// Invariant: the first column must not contain or-patterns. This is handled by
/// [`Matrix::push`].
///
/// In fact each column corresponds to a place inside the scrutinee of the match. E.g. after
/// specializing `(,)` and `Some` on a pattern of type `(Option<u32>, bool)`, the first column of
/// the matrix will correspond to `scrutinee.0.Some.0` and the second column to `scrutinee.1`.
// #[derive(Clone)]
// PORT: `rows()` is `rows_()`: the class has a field `rows` of the same name.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1212 Matrix
class Matrix<Cx extends PatCxTypes> {
  constructor(
    /// Vector of rows. The rows must form a rectangular 2D array. Moreover, all the patterns of
    /// each column must have the same type. Each column corresponds to a place within the
    /// scrutinee.
    public rows: MatrixRow<Cx>[],
    /// Track info about each place. Each place corresponds to a column in `rows`, and their types
    /// must match.
    public place_info: PlaceInfo<Cx>[],
    /// Track whether the virtual wildcard row used to compute exhaustiveness is relevant. See top
    /// of the file for details on relevancy.
    public wildcard_row_is_relevant: boolean,
  ) {}

  /// Pushes a new row to the matrix. Internal method, prefer [`Matrix::new`].
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1227 push (lane pat-a)
  push(_row: MatrixRow<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::Matrix::push");
  }

  /// Build a new matrix from an iterator of `MatchArm`s.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1233 new (lane pat-a)
  static new<Cx extends PatCxTypes>(
    _arms: readonly MatchArm<Cx>[],
    _scrut_ty: Cx["Ty"],
    _scrut_validity: PlaceValidity,
  ): Matrix<Cx> {
    return unported("rustc_pattern_analysis::usefulness::Matrix::new");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1251 head_place (lane pat-a)
  head_place(): PlaceInfo<Cx> | undefined {
    return unported("rustc_pattern_analysis::usefulness::Matrix::head_place");
  }
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1254 column_count (lane pat-a)
  column_count(): number {
    return unported("rustc_pattern_analysis::usefulness::Matrix::column_count");
  }

  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1258 rows (lane pat-a)
  rows_(): readonly MatrixRow<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::Matrix::rows");
  }
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1264 rows_mut (lane pat-a)
  rows_mut(): MatrixRow<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::Matrix::rows_mut");
  }

  /// Iterate over the first pattern of each row.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1272 heads (lane pat-a)
  heads(): PatOrWild<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::Matrix::heads");
  }

  /// This computes `specialize(ctor, self)`. See top of the file for explanations.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1277 specialize_constructor (lane pat-a)
  specialize_constructor(
    _pcx: PlaceCtxt<Cx>,
    _ctor: Constructor<Cx>,
    _ctor_is_relevant: boolean,
  ): Result<Matrix<Cx>, Cx["Error"]> {
    return unported("rustc_pattern_analysis::usefulness::Matrix::specialize_constructor");
  }

  /// Recover row usefulness and intersection information from a processed specialized matrix.
  /// `specialized` must come from `self.specialize_constructor`.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1319 unspecialize (lane pat-a)
  unspecialize(_specialized: Matrix<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::Matrix::unspecialize");
  }
}

/// Pretty-printer for matrices of patterns, example:
///
/// ```text
/// + _     + []                +
/// + true  + [First]           +
/// + true  + [Second(true)]    +
/// + false + [_]               +
/// + _     + [_, _, tail @ ..] +
/// | ✓     | ?                 | // validity
/// ```
// impl<'p, Cx: PatCx> fmt::Debug for Matrix<'p, Cx>
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1348 fmt (lane pat-a)
function debug_Matrix<Cx extends PatCxTypes>(_cx: PatCxStatic<Cx>): Debug<Matrix<Cx>> {
  return unported("rustc_pattern_analysis::usefulness::Matrix::fmt");
}

/// A witness-tuple of non-exhaustiveness for error reporting, represented as a list of patterns (in
/// reverse order of construction).
///
/// This mirrors `PatStack`: they function similarly, except `PatStack` contains user patterns we
/// are inspecting, and `WitnessStack` contains witnesses we are constructing.
/// FIXME(Nadrieril): use the same order of patterns for both.
///
/// A `WitnessStack` should have the same types and length as the `PatStack`s we are inspecting
/// (except we store the patterns in reverse order). The same way `PatStack` starts with length 1,
/// at the end of the algorithm this will have length 1. In the middle of the algorithm, it can
/// contain multiple patterns.
///
/// (Example: usefulness.rs:1396-1434.)
// #[derive(Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1438 WitnessStack
class WitnessStack<Cx extends PatCxTypes> {
  constructor(public _0: WitnessPat<Cx>[]) {}

  // impl<Cx: PatCx> Clone for WitnessStack<Cx>
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1441 clone (lane pat-a)
  clone(): WitnessStack<Cx> {
    return unported("rustc_pattern_analysis::usefulness::WitnessStack::clone");
  }

  /// Asserts that the witness contains a single pattern, and returns it.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1448 single_pattern (lane pat-a)
  single_pattern(): WitnessPat<Cx> {
    return unported("rustc_pattern_analysis::usefulness::WitnessStack::single_pattern");
  }

  /// Reverses specialization by the `Missing` constructor by pushing a whole new pattern.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1454 push_pattern (lane pat-a)
  push_pattern(_pat: WitnessPat<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::WitnessStack::push_pattern");
  }

  /// Reverses specialization. Given a witness obtained after specialization, this constructs a
  /// new witness valid for before specialization. See the section on `unspecialize` at the top of
  /// the file.
  ///
  /// Examples:
  /// ```text
  /// ctor: tuple of 2 elements
  /// pats: [false, "foo", _, true]
  /// result: [(false, "foo"), _, true]
  ///
  /// ctor: Enum::Variant { a: (bool, &'static str), b: usize}
  /// pats: [(false, "foo"), _, true]
  /// result: [Enum::Variant { a: (false, "foo"), b: _ }, true]
  /// ```
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1472 apply_constructor (lane pat-a)
  apply_constructor(_pcx: PlaceCtxt<Cx>, _ctor: Constructor<Cx>): WitnessStack<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::WitnessStack::apply_constructor");
  }
}

/// Represents a set of pattern-tuples that are witnesses of non-exhaustiveness for error
/// reporting. This has similar invariants as `Matrix` does.
///
/// The `WitnessMatrix` returned by [`compute_exhaustiveness_and_usefulness`] obeys the invariant
/// that the union of the input `Matrix` and the output `WitnessMatrix` together matches the type
/// exhaustively.
///
/// Just as the `Matrix` starts with a single column, by the end of the algorithm, this has a single
/// column, which contains the patterns that are missing for the match to be exhaustive.
// #[derive(Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1514 WitnessMatrix
class WitnessMatrix<Cx extends PatCxTypes> {
  constructor(public _0: WitnessStack<Cx>[]) {}

  // impl<Cx: PatCx> Clone for WitnessMatrix<Cx>
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1517 clone (lane pat-a)
  clone(): WitnessMatrix<Cx> {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::clone");
  }

  /// New matrix with no witnesses.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1524 empty (lane pat-a)
  static empty<Cx extends PatCxTypes>(): WitnessMatrix<Cx> {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::empty");
  }
  /// New matrix with one `()` witness, i.e. with no columns.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1528 unit_witness (lane pat-a)
  static unit_witness<Cx extends PatCxTypes>(): WitnessMatrix<Cx> {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::unit_witness");
  }

  /// Whether this has any witnesses.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1533 is_empty (lane pat-a)
  is_empty(): boolean {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::is_empty");
  }
  /// Asserts that there is a single column and returns the patterns in it.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1537 single_column (lane pat-a)
  single_column(): WitnessPat<Cx>[] {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::single_column");
  }

  /// Reverses specialization by the `Missing` constructor by pushing a whole new pattern.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1542 push_pattern (lane pat-a)
  push_pattern(_pat: WitnessPat<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::push_pattern");
  }

  /// Reverses specialization by `ctor`. See the section on `unspecialize` at the top of the file.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1549 apply_constructor (lane pat-a)
  apply_constructor(_pcx: PlaceCtxt<Cx>, _missing_ctors: readonly Constructor<Cx>[], _ctor: Constructor<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::apply_constructor");
  }

  /// Merges the witnesses of two matrices. Their column types must match.
  // stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1582 extend (lane pat-a)
  extend(_other: WitnessMatrix<Cx>): void {
    return unported("rustc_pattern_analysis::usefulness::WitnessMatrix::extend");
  }
}

/// Collect ranges that overlap like `lo..=overlap`/`overlap..=hi`. Must be called during
/// exhaustiveness checking, if we find a singleton range after constructor splitting. This reuses
/// row intersection information to only detect ranges that truly overlap.
///
/// If two ranges overlapped, the split set will contain their intersection as a singleton.
/// Specialization will then select rows that match the overlap, and exhaustiveness will compute
/// which rows have an intersection that includes the overlap. That gives us all the info we need to
/// compute overlapping ranges without false positives.
///
/// We can however get false negatives because exhaustiveness does not explore all cases. See the
/// section on relevancy at the top of the file.
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1598 collect_overlapping_range_endpoints (lane pat-a)
function collect_overlapping_range_endpoints<Cx extends PatCxTypes>(
  _cx: PatCx<Cx>,
  _overlap_range: IntRange,
  _matrix: Matrix<Cx>,
  _specialized_matrix: Matrix<Cx>,
): void {
  return unported("rustc_pattern_analysis::usefulness::collect_overlapping_range_endpoints");
}

/// Collect ranges that have a singleton gap between them.
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1657 collect_non_contiguous_range_endpoints (lane pat-a)
function collect_non_contiguous_range_endpoints<Cx extends PatCxTypes>(
  _cx: PatCx<Cx>,
  _gap_range: IntRange,
  _matrix: Matrix<Cx>,
): void {
  return unported("rustc_pattern_analysis::usefulness::collect_non_contiguous_range_endpoints");
}

/// The core of the algorithm.
///
/// This recursively computes witnesses of the non-exhaustiveness of `matrix` (if any). Also tracks
/// usefulness of each row in the matrix (in `row.useful`). We track usefulness of subpatterns in
/// `mcx.branch_usefulness`.
///
/// The input `Matrix` and the output `WitnessMatrix` together match the type exhaustively.
///
/// The key steps are:
/// - specialization, where we dig into the rows that have a specific constructor and call ourselves
///     recursively;
/// - unspecialization, where we lift the results from the previous step into results for this step
///     (using `apply_constructor` and by updating `row.useful` for each parent row).
/// This is all explained at the top of the file.
// #[instrument(level = "debug", skip(mcx), ret)]
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1698 compute_exhaustiveness_and_usefulness (lane pat-a)
function compute_exhaustiveness_and_usefulness<Cx extends PatCxTypes>(
  _mcx: UsefulnessCtxt<Cx>,
  _matrix: Matrix<Cx>,
): Result<WitnessMatrix<Cx>, Cx["Error"]> {
  return unported("rustc_pattern_analysis::usefulness::compute_exhaustiveness_and_usefulness");
}

/// Indicates why a given pattern is considered redundant.
// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1794 RedundancyExplanation
export interface RedundancyExplanation<Cx extends PatCxTypes> {
  /// All the values matched by this pattern are already matched by the given set of patterns.
  /// This list is not guaranteed to be minimal but the contained patterns are at least guaranteed
  /// to intersect this pattern.
  covered_by: DeconstructedPat<Cx>[];
}

/// Indicates whether or not a given arm is useful.
// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1803 Usefulness
export type Usefulness<Cx extends PatCxTypes> =
  /// The arm is useful. This additionally carries a set of or-pattern branches that have been
  /// found to be redundant despite the overall arm being useful. Used only in the presence of
  /// or-patterns, otherwise it stays empty.
  | { readonly $: "Useful"; readonly _0: [DeconstructedPat<Cx>, RedundancyExplanation<Cx>][] }
  /// The arm is redundant and can be removed without changing the behavior of the match
  /// expression.
  | { readonly $: "Redundant"; readonly _0: RedundancyExplanation<Cx> };

/// The output of checking a match for exhaustiveness and arm usefulness.
// rustc-type: compiler/rustc_pattern_analysis/src/usefulness.rs:1814 UsefulnessReport
export interface UsefulnessReport<Cx extends PatCxTypes> {
  /// For each arm of the input, whether that arm is useful after the arms above it.
  arm_usefulness: [MatchArm<Cx>, Usefulness<Cx>][];
  /// If the match is exhaustive, this is empty. If not, this contains witnesses for the lack of
  /// exhaustiveness.
  non_exhaustiveness_witnesses: WitnessPat<Cx>[];
  /// For each arm, a set of indices of arms above it that have non-empty intersection, i.e. there
  /// is a value matched by both arms. This may miss real intersections.
  arm_intersections: DenseBitSet<number>[];
}

/// Computes whether a match is exhaustive and which of its arms are useful.
// #[instrument(skip(tycx, arms), level = "debug")]
// stub: compiler/rustc_pattern_analysis/src/usefulness.rs:1827 compute_match_usefulness (lane pat-a)
export function compute_match_usefulness<Cx extends PatCxTypes>(
  _tycx: PatCx<Cx>,
  _arms: readonly MatchArm<Cx>[],
  _scrut_ty: Cx["Ty"],
  _scrut_validity: PlaceValidity,
  _complexity_limit: number,
): Result<UsefulnessReport<Cx>, Cx["Error"]> {
  return unported("rustc_pattern_analysis::usefulness::compute_match_usefulness");
}
