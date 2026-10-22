//! Contains checks that must be run to validate matches before performing usefulness analysis.
//
// Port of compiler/rustc_pattern_analysis/src/checks.rs (declarations: lane pat-b; bodies: lane pat-a).
// Conventions: lib.ts header.
import type { DeconstructedPat } from "./pat.ts";
import type { MatchArm, PatCx, PatCxTypes } from "./lib.ts";
import { PatternColumn } from "./pat_column.ts";
import { Err, Ok, type Result } from "../std/result.ts";

// use crate::constructor::Constructor::*;

/// Validate that deref patterns and normal constructors aren't used to match on the same place.
// rustc: compiler/rustc_pattern_analysis/src/checks.rs:8 detect_mixed_deref_pat_ctors
export function detect_mixed_deref_pat_ctors<Cx extends PatCxTypes>(
  cx: PatCx<Cx>,
  arms: readonly MatchArm<Cx>[],
): Result<null, Cx["Error"]> {
  const pat_column = PatternColumn.new(arms);
  return detect_mixed_deref_pat_ctors_inner(cx, pat_column);
}

// rustc: compiler/rustc_pattern_analysis/src/checks.rs:16 detect_mixed_deref_pat_ctors_inner
function detect_mixed_deref_pat_ctors_inner<Cx extends PatCxTypes>(
  cx: PatCx<Cx>,
  column: PatternColumn<Cx>,
): Result<null, Cx["Error"]> {
  const ty = column.head_ty();
  // PORT: `let Some(ty) = column.head_ty() else`: every implementor's `Ty` is an object, never `undefined`.
  if (ty === undefined) {
    return Ok(null);
  }

  // Check for a mix of deref patterns and normal constructors.
  let deref_pat: DeconstructedPat<Cx> | undefined = undefined;
  let normal_pat: DeconstructedPat<Cx> | undefined = undefined;
  for (const pat of column.iter()) {
    switch (pat.ctor().$) {
      // The analysis can handle mixing deref patterns with wildcards and opaque patterns.
      case "Wildcard":
      case "Opaque":
        break;
      case "DerefPattern":
        deref_pat = pat;
        break;
      // Nothing else can be compared to deref patterns in `Constructor::is_covered_by`.
      default:
        normal_pat = pat;
        break;
    }
  }
  if (deref_pat !== undefined && normal_pat !== undefined) {
    return Err(cx.report_mixed_deref_pat_ctors(deref_pat, normal_pat));
  }

  // Specialize and recurse into the patterns' fields.
  const set = column.analyze_ctors(cx, ty);
  if (set.$ === "Err") return set;
  for (const ctor of set._0.present) {
    for (const specialized_column of column.specialize(cx, ty, ctor)) {
      const r = detect_mixed_deref_pat_ctors_inner(cx, specialized_column);
      if (r.$ === "Err") return r;
    }
  }
  return Ok(null);
}
