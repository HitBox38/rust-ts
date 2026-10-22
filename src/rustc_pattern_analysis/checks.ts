//! Contains checks that must be run to validate matches before performing usefulness analysis.
//
// Port of compiler/rustc_pattern_analysis/src/checks.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-a's
// (how to fill a stub: usefulness.ts header). Conventions: lib.ts header.
import type { MatchArm, PatCx, PatCxTypes } from "./lib.ts";
import type { PatternColumn } from "./pat_column.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// Validate that deref patterns and normal constructors aren't used to match on the same place.
// stub: compiler/rustc_pattern_analysis/src/checks.rs:8 detect_mixed_deref_pat_ctors (lane pat-a)
export function detect_mixed_deref_pat_ctors<Cx extends PatCxTypes>(
  _cx: PatCx<Cx>,
  _arms: readonly MatchArm<Cx>[],
): Result<null, Cx["Error"]> {
  return unported("rustc_pattern_analysis::checks::detect_mixed_deref_pat_ctors");
}

// stub: compiler/rustc_pattern_analysis/src/checks.rs:16 detect_mixed_deref_pat_ctors_inner (lane pat-a)
function detect_mixed_deref_pat_ctors_inner<Cx extends PatCxTypes>(
  _cx: PatCx<Cx>,
  _column: PatternColumn<Cx>,
): Result<null, Cx["Error"]> {
  return unported("rustc_pattern_analysis::checks::detect_mixed_deref_pat_ctors_inner");
}
