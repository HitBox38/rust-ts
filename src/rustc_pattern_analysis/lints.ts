// Port of compiler/rustc_pattern_analysis/src/lints.rs: DECLARATIONS (lane pat-b); the bodies are lane pat-a's
// (how to fill a stub: usefulness.ts header). Conventions: lib.ts header.
import type { MatchArm } from "./lib.ts";
import type { PatternColumn } from "./pat_column.ts";
import type { RevealedTy, RustcPatCtxt, RustcPatCtxtTypes, WitnessPat } from "./rustc.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// Traverse the patterns to collect any variants of a non_exhaustive enum that fail to be mentioned
/// in a given column.
// #[instrument(level = "debug", skip(cx), ret)]
// stub: compiler/rustc_pattern_analysis/src/lints.rs:16 collect_nonexhaustive_missing_variants (lane pat-a)
function collect_nonexhaustive_missing_variants(
  _cx: RustcPatCtxt,
  _column: PatternColumn<RustcPatCtxtTypes>,
): Result<WitnessPat[], ErrorGuaranteed> {
  return unported("rustc_pattern_analysis::lints::collect_nonexhaustive_missing_variants");
}

// stub: compiler/rustc_pattern_analysis/src/lints.rs:62 lint_nonexhaustive_missing_variants (lane pat-a)
export function lint_nonexhaustive_missing_variants(
  _rcx: RustcPatCtxt,
  _arms: readonly MatchArm<RustcPatCtxtTypes>[],
  _pat_column: PatternColumn<RustcPatCtxtTypes>,
  _scrut_ty: RevealedTy,
): Result<null, ErrorGuaranteed> {
  return unported("rustc_pattern_analysis::lints::lint_nonexhaustive_missing_variants");
}
