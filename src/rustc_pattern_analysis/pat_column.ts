// Port of compiler/rustc_pattern_analysis/src/pat_column.rs (declarations: lane pat-b; bodies: lane pat-a).
// Conventions: lib.ts header.
import { Constructor, ConstructorSet, type SplitConstructorSet } from "./constructor.ts";
import type { MatchArm, PatCx, PatCxTypes } from "./lib.ts";
import type { DeconstructedPat } from "./pat.ts";
import { PatOrWild } from "./pat.ts";
import type { Result } from "../std/result.ts";
import { Ok } from "../std/result.ts";

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

  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:20 new
  static new<Cx extends PatCxTypes>(arms: readonly MatchArm<Cx>[]): PatternColumn<Cx> {
    const patterns: DeconstructedPat<Cx>[] = [];
    const column = new PatternColumn<Cx>(patterns);
    for (const arm of arms) {
      column.expand_and_push({ $: "Pat", _0: arm.pat });
    }
    return column;
  }
  /// Pushes a pattern onto the column, expanding any or-patterns into its subpatterns.
  /// Internal method, prefer [`PatternColumn::new`].
  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:30 expand_and_push
  expand_and_push(pat: PatOrWild<Cx>): void {
    // We flatten or-patterns and skip algorithm-generated wildcards.
    if (PatOrWild.is_or_pat(pat)) {
      for (const pat_or_wild of PatOrWild.flatten_or_pat(pat)) {
        const p = PatOrWild.as_pat(pat_or_wild);
        if (p !== undefined) this.patterns.push(p);
      }
    } else {
      const p = PatOrWild.as_pat(pat);
      if (p !== undefined) {
        this.patterns.push(p);
      }
    }
  }

  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:41 head_ty
  head_ty(): Cx["Ty"] | undefined {
    return this.patterns[0]?.ty();
  }
  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:44 iter
  iter(): readonly DeconstructedPat<Cx>[] {
    return this.patterns;
  }

  /// Do constructor splitting on the constructors of the column.
  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:49 analyze_ctors
  analyze_ctors(cx: PatCx<Cx>, ty: Cx["Ty"]): Result<SplitConstructorSet<Cx>, Cx["Error"]> {
    const column_ctors = this.patterns.map((p) => p.ctor());
    const ctors_for_ty = cx.ctors_for_ty(ty);
    if (ctors_for_ty.$ === "Err") return ctors_for_ty;
    return Ok(ConstructorSet.split(ctors_for_ty._0, column_ctors));
  }

  /// Does specialization: given a constructor, this takes the patterns from the column that match
  /// the constructor, and outputs their fields.
  /// This returns one column per field of the constructor. They usually all have the same length
  /// (the number of patterns in `self` that matched `ctor`), except that we expand or-patterns
  /// which may change the lengths.
  // rustc: compiler/rustc_pattern_analysis/src/pat_column.rs:64 specialize
  specialize(cx: PatCx<Cx>, ty: Cx["Ty"], ctor: Constructor<Cx>): PatternColumn<Cx>[] {
    const arity = Constructor.arity(ctor, cx, ty);
    if (arity === 0) {
      return [];
    }

    // We specialize the column by `ctor`. This gives us `arity`-many columns of patterns. These
    // columns may have different lengths in the presence of or-patterns (this is why we can't
    // reuse `Matrix`).
    const specialized_columns: PatternColumn<Cx>[] = [];
    for (let i = 0; i < arity; i++) specialized_columns.push(new PatternColumn<Cx>([]));
    const relevant_patterns = this.patterns.filter((pat) => {
      // `ctor.is_covered_by(cx, pat.ctor()).unwrap_or(false)`
      const r = Constructor.is_covered_by(ctor, cx, pat.ctor());
      return r.$ === "Ok" ? r._0 : false;
    });
    for (const pat of relevant_patterns) {
      const specialized = pat.specialize(ctor, arity);
      // `zip`: stops at the shorter of the two.
      const n = Math.min(specialized.length, specialized_columns.length);
      for (let i = 0; i < n; i++) {
        specialized_columns[i]!.expand_and_push(specialized[i]!);
      }
    }
    return specialized_columns;
  }
}
