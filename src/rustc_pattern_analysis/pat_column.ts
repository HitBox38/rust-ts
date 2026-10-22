// Port of compiler/rustc_pattern_analysis/src/pat_column.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-a's
// (how to fill a stub: usefulness.ts header). Conventions: lib.ts header.
import type { Constructor, SplitConstructorSet } from "./constructor.ts";
import type { MatchArm, PatCx, PatCxTypes } from "./lib.ts";
import type { DeconstructedPat, PatOrWild } from "./pat.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// A column of patterns in a match, where a column is the intuitive notion of "subpatterns that
/// inspect the same subvalue/place".
/// This is used to traverse patterns column-by-column for lints. Despite similarities with the
/// algorithm in [`crate::usefulness`], this does a different traversal. Notably this is linear in
/// the depth of patterns, whereas `compute_exhaustiveness_and_usefulness` is worst-case exponential
/// (exhaustiveness is NP-complete). The core difference is that we treat sub-columns separately.
///
/// This is not used in the usefulness algorithm; only in lints.
// #[derive(Debug)]
// rustc-type: compiler/rustc_pattern_analysis/src/pat_column.rs:14 PatternColumn
export class PatternColumn<Cx extends PatCxTypes> {
  constructor(
    /// This must not contain an or-pattern. `expand_and_push` takes care to expand them.
    public patterns: DeconstructedPat<Cx>[],
  ) {}

  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:20 new (lane pat-a)
  static new<Cx extends PatCxTypes>(_arms: readonly MatchArm<Cx>[]): PatternColumn<Cx> {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::new");
  }
  /// Pushes a pattern onto the column, expanding any or-patterns into its subpatterns.
  /// Internal method, prefer [`PatternColumn::new`].
  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:30 expand_and_push (lane pat-a)
  expand_and_push(_pat: PatOrWild<Cx>): void {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::expand_and_push");
  }

  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:41 head_ty (lane pat-a)
  head_ty(): Cx["Ty"] | undefined {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::head_ty");
  }
  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:44 iter (lane pat-a)
  iter(): readonly DeconstructedPat<Cx>[] {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::iter");
  }

  /// Do constructor splitting on the constructors of the column.
  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:49 analyze_ctors (lane pat-a)
  analyze_ctors(_cx: PatCx<Cx>, _ty: Cx["Ty"]): Result<SplitConstructorSet<Cx>, Cx["Error"]> {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::analyze_ctors");
  }

  /// Does specialization: given a constructor, this takes the patterns from the column that match
  /// the constructor, and outputs their fields.
  /// This returns one column per field of the constructor. They usually all have the same length
  /// (the number of patterns in `self` that matched `ctor`), except that we expand or-patterns
  /// which may change the lengths.
  // stub: compiler/rustc_pattern_analysis/src/pat_column.rs:64 specialize (lane pat-a)
  specialize(_cx: PatCx<Cx>, _ty: Cx["Ty"], _ctor: Constructor<Cx>): PatternColumn<Cx>[] {
    return unported("rustc_pattern_analysis::pat_column::PatternColumn::specialize");
  }
}
