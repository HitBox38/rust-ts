// Port of compiler/rustc_pattern_analysis/src/lints.rs (declarations: lane pat-b; bodies: lane pat-a).
// Conventions: lib.ts header.
import { NON_EXHAUSTIVE_OMITTED_PATTERNS } from "../rustc_lint_defs/builtin.gen.ts";
import { Level } from "../rustc_lint_defs/lib.ts";
import { LintLevelSource } from "../rustc_middle/lint.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { MatchArm } from "./lib.ts";
import {
  NonExhaustiveOmittedPattern_diagnostic,
  NonExhaustiveOmittedPatternLintOnArm_diagnostic,
  Uncovered_new,
} from "./diagnostics.ts";
import type { PatternColumn } from "./pat_column.ts";
import { WitnessPat as WitnessPat_ } from "./pat.ts";
// PORT: `RevealedTy` is a value import of a module that imports this one; it is only read at call time.
import { RevealedTy, type RustcPatCtxt, type RustcPatCtxtTypes, type WitnessPat } from "./rustc.ts";
import { Ok, type Result } from "../std/result.ts";

/// Traverse the patterns to collect any variants of a non_exhaustive enum that fail to be mentioned
/// in a given column.
// #[instrument(level = "debug", skip(cx), ret)]
// rustc: compiler/rustc_pattern_analysis/src/lints.rs:16 collect_nonexhaustive_missing_variants
function collect_nonexhaustive_missing_variants(
  cx: RustcPatCtxt,
  column: PatternColumn<RustcPatCtxtTypes>,
): Result<WitnessPat[], ErrorGuaranteed> {
  const ty = column.head_ty();
  if (ty === undefined) {
    return Ok([]);
  }

  const set_r = column.analyze_ctors(cx, ty);
  if (set_r.$ === "Err") return set_r;
  const set = set_r._0;
  if (set.present.length === 0) {
    // We can't consistently handle the case where no constructors are present (since this would
    // require digging deep through any type in case there's a non_exhaustive enum somewhere),
    // so for consistency we refuse to handle the top-level case, where we could handle it.
    return Ok([]);
  }

  const witnesses: WitnessPat[] = [];
  if (cx.is_foreign_non_exhaustive_enum(ty)) {
    for (const missing_ctor of set.missing) {
      // This will list missing visible variants.
      if (missing_ctor.$ === "Hidden" || missing_ctor.$ === "NonExhaustive") continue;
      witnesses.push(WitnessPat_.wild_from_ctor(cx, missing_ctor, ty));
    }
  }

  // Recurse into the fields.
  for (const ctor of set.present) {
    const specialized_columns = column.specialize(cx, ty, ctor);
    const wild_pat = WitnessPat_.wild_from_ctor(cx, ctor, ty);
    for (let i = 0; i < specialized_columns.length; i++) {
      const col_i = specialized_columns[i]!;
      // Compute witnesses for each column.
      const wits_for_col_i = collect_nonexhaustive_missing_variants(cx, col_i);
      if (wits_for_col_i.$ === "Err") return wits_for_col_i;
      // For each witness, we build a new pattern in the shape of `ctor(_, _, wit, _, _)`,
      // adding enough wildcards to match `arity`.
      for (const wit of wits_for_col_i._0) {
        const pat = wild_pat.clone();
        pat.fields[i] = wit;
        witnesses.push(pat);
      }
    }
  }
  return Ok(witnesses);
}

// rustc: compiler/rustc_pattern_analysis/src/lints.rs:62 lint_nonexhaustive_missing_variants
export function lint_nonexhaustive_missing_variants(
  rcx: RustcPatCtxt,
  arms: readonly MatchArm<RustcPatCtxtTypes>[],
  pat_column: PatternColumn<RustcPatCtxtTypes>,
  scrut_ty: RevealedTy,
): Result<null, ErrorGuaranteed> {
  if (!rcx.tcx.lint_level_spec_at_node(NON_EXHAUSTIVE_OMITTED_PATTERNS, rcx.match_lint_level).is_allow()) {
    const witnesses = collect_nonexhaustive_missing_variants(rcx, pat_column);
    if (witnesses.$ === "Err") return witnesses;
    if (witnesses._0.length !== 0) {
      // Report that a match of a `non_exhaustive` enum marked with `non_exhaustive_omitted_patterns`
      // is not exhaustive enough.
      //
      // NB: The partner lint for structs lives in `compiler/rustc_hir_analysis/src/check/pat.rs`.
      rcx.tcx.emit_node_span_lint(
        NON_EXHAUSTIVE_OMITTED_PATTERNS,
        rcx.match_lint_level,
        rcx.scrut_span,
        NonExhaustiveOmittedPattern_diagnostic({
          scrut_ty: RevealedTy.inner(scrut_ty),
          uncovered: Uncovered_new(rcx.scrut_span, rcx, witnesses._0),
        }),
      );
    }
  } else {
    // We used to allow putting the `#[allow(non_exhaustive_omitted_patterns)]` on a match
    // arm. This no longer makes sense so we warn users, to avoid silently breaking their
    // usage of the lint.
    for (const arm of arms) {
      const level_spec = rcx.tcx.lint_level_spec_at_node(NON_EXHAUSTIVE_OMITTED_PATTERNS, arm.arm_data);
      const level = level_spec.level_();
      if (level !== "Allow") {
        rcx.tcx.dcx().emit_warn(
          NonExhaustiveOmittedPatternLintOnArm_diagnostic({
            span: arm.pat.data().span,
            lint_span: LintLevelSource.span(level_spec.src),
            suggest_lint_on_match: rcx.whole_match_span === undefined ? undefined : Span.shrink_to_lo(rcx.whole_match_span),
            lint_level: Level.as_str(level),
            lint_name: "non_exhaustive_omitted_patterns",
          }),
        );
      }
    }
  }
  return Ok(null);
}
