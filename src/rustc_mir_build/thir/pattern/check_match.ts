// Port of compiler/rustc_mir_build/src/thir/pattern/check_match.rs: STUB (lanes thir-cx-print / thir-pattern; ported
// with rustc_pattern_analysis in a later lane).
//
// ## How to fill this stub
// 1. The types and signatures here are final: `check_match(tcx, def_id)` is what lib.ts registers. Keep them; a wrong
//    one goes in your handoff.
// 2. Methods: write `MatchVisitor.prototype.<name> = function (this: MatchVisitor, ..) { .. }` in upstream order with
//    the marker `// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:<line> <name>` directly above it,
//    then delete the name from the `unported_methods(..)` list (and the call when the list is empty).
// 3. Free fns: replace the `unported(..)` body of the exported stub function with the port and add the marker.
// 4. diagnostics.rs is generated (tools/codegen set rustc_mir_build; manual impls in diagnostics.ts) except
//    `PatternNotCovered`, skipped in the set until rustc_pattern_analysis's `Uncovered` (its `#[subdiagnostic]`) exists:
//    drop the skip and add a type-map entry for `Uncovered` then.
//
// PORT (stub): rustc_pattern_analysis (`DeconstructedPat`, `RustcPatCtxt` imported as `PatCtxt`, `MatchArm`,
// `UsefulnessReport`, `WitnessPat`, `RedundancyExplanation`, `RevealedTy`) and rustc_arena are not ported: the
// signatures below type them `unknown`.
import type { MatchSource } from "../../../rustc_hir/hir.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { ArmId, Expr, ExprId, Pat, Thir } from "../../../rustc_middle/thir.ts";
import { Visitor } from "../../../rustc_middle/thir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { AdtDef, TypeckResults } from "../../../rustc_middle/ty/decls.ts";
import type { Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";

/** `rustc_pattern_analysis::rustc::RustcPatCtxt` (imported as `PatCtxt` upstream; not ported). */
type RustcPatCtxt = unknown;
/** `rustc_pattern_analysis::rustc::{DeconstructedPat, MatchArm, UsefulnessReport, WitnessPat, RedundancyExplanation,
 *  RevealedTy}` and `crate::diagnostics::{LetElseReplacementSuggestion, Inform, UnreachablePatternInner,
 *  AdtDefinedHere}` (not ported). */
type Pending = unknown;

// (check_match.rs:30 check_match: stub; the `check_match` query provider)
export function check_match(_tcx: TyCtxt, _def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  return unported("rustc_mir_build::thir::pattern::check_match::check_match (lane thir-pattern)");
}

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:67 RefutableFlag
export type RefutableFlag = "Irrefutable" | "Refutable";
export const RefutableFlag = { Irrefutable: "Irrefutable", Refutable: "Refutable" } as const;

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:74 LetSource
export type LetSource = "None" | "PlainLet" | "IfLet" | "IfLetGuard" | "LetElse" | "WhileLet" | "Else" | "ElseIfLet";
export const LetSource = {
  None: "None",
  PlainLet: "PlainLet",
  IfLet: "IfLet",
  IfLetGuard: "IfLetGuard",
  LetElse: "LetElse",
  WhileLet: "WhileLet",
  Else: "Else",
  ElseIfLet: "ElseIfLet",
} as const;

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:85 MatchVisitor
// Visitor for a thir body. This calls `check_match` and `check_let` as appropriate.
export class MatchVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public typeck_results: TypeckResults,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
    public hir_source: HirId,
    public let_source: LetSource,
    public pattern_arena: unknown,
    public dropless_arena: unknown,
    /// Tracks if we encountered an error while checking this body. That the first function to
    /// report it stores it here. Some functions return `Result` to allow callers to short-circuit
    /// on error, but callers don't need to store it here again.
    public error: Result<null, ErrorGuaranteed>,
  ) {
    super();
  }

  // PORT (stub): `thir()` is abstract in `Visitor`; the placeholder below (unported_methods) stands in for it.
  thir(): Thir {
    return unported("rustc_mir_build::thir::pattern::check_match::MatchVisitor::thir");
  }
}

export interface MatchVisitor {
  // `with_let_source` / `with_hir_source` take `f: impl FnOnce(&mut Self) -> T`.
  with_let_source(let_source: LetSource, f: (this_: MatchVisitor) => void): void;
  with_hir_source<T>(new_hir_source: HirId, f: (this_: MatchVisitor) => T): T;
  visit_land(ex: Expr, accumulator: ([Span, RefutableFlag] | undefined)[]): Result<null, ErrorGuaranteed>;
  visit_land_rhs(ex: Expr): Result<[Span, RefutableFlag] | undefined, ErrorGuaranteed>;
  lower_pattern(cx: RustcPatCtxt, pat: Pat): Result<Pending, ErrorGuaranteed>;
  is_known_valid_scrutinee(scrutinee: Expr): boolean;
  new_cx(refutability: RefutableFlag, whole_match_span: Span | undefined, scrutinee: Expr | undefined, scrut_span: Span): RustcPatCtxt;
  analyze_patterns(cx: RustcPatCtxt, arms: readonly Pending[], scrut_ty: Ty): Result<Pending, ErrorGuaranteed>;
  check_let(pat: Pat, scrutinee: ExprId | undefined, span: Span): void;
  check_irrefutable_option_some(pat: Pat, initializer: Expr | undefined, span: Span): Pending | undefined;
  check_match(scrut: ExprId, arms: readonly ArmId[], source: MatchSource, expr_span: Span): void;
  lint_single_let(let_span: Span, else_keyword_span: Span | undefined, let_else_span: Pending | undefined): void;
  analyze_binding(pat: Pat, refutability: RefutableFlag, scrut: Expr | undefined): Result<[RustcPatCtxt, Pending], ErrorGuaranteed>;
  is_let_irrefutable(pat: Pat, scrut: Expr | undefined): Result<RefutableFlag, ErrorGuaranteed>;
  check_binding_is_irrefutable(pat: Pat, origin: string, inform: Pending | undefined, scrut: Expr | undefined, sp: Span | undefined): void;
}

unported_methods(MatchVisitor.prototype, "rustc_mir_build::thir::pattern::check_match::MatchVisitor", [
  // impl Visitor for MatchVisitor
  "visit_arm",
  "visit_expr",
  "visit_stmt",
  // impl MatchVisitor
  "with_let_source",
  "with_hir_source",
  "visit_land",
  "visit_land_rhs",
  "lower_pattern",
  "is_known_valid_scrutinee",
  "new_cx",
  "analyze_patterns",
  "check_let",
  "check_irrefutable_option_some",
  "check_match",
  "lint_single_let",
  "analyze_binding",
  "is_let_irrefutable",
  "check_binding_is_irrefutable",
]);

/// Check if a by-value binding is by-value. That is, check if the binding's type is not `Copy`.
/// Check that there are no borrow or move conflicts in `binding @ subpat` patterns.
///
/// For example, this would reject:
/// - `ref x @ Some(ref mut y)`,
/// - `ref mut x @ Some(ref y)`,
/// - `ref mut x @ Some(ref mut y)`,
/// - `ref mut? x @ Some(y)`, and
/// - `x @ Some(ref mut? y)`.
///
/// This analysis is *not* subsumed by NLL.
// (check_match.rs:770 check_borrow_conflicts_in_at_patterns: stub)
export function check_borrow_conflicts_in_at_patterns(_cx: MatchVisitor, _pat: Pat): void {
  return unported("rustc_mir_build::thir::pattern::check_match::check_borrow_conflicts_in_at_patterns (lane thir-pattern)");
}

// (check_match.rs:865 check_for_bindings_named_same_as_variants: stub)
export function check_for_bindings_named_same_as_variants(_cx: MatchVisitor, _pat: Pat, _rf: RefutableFlag): void {
  return unported("rustc_mir_build::thir::pattern::check_match::check_for_bindings_named_same_as_variants (lane thir-pattern)");
}

/// Check that never patterns are only used on inhabited types.
// (check_match.rs:907 check_never_pattern: stub)
export function check_never_pattern(_cx: RustcPatCtxt, _pat: Pat): Result<null, ErrorGuaranteed> {
  return unported("rustc_mir_build::thir::pattern::check_match::check_never_pattern (lane thir-pattern)");
}

// (check_match.rs:919 report_irrefutable_let_patterns: stub)
export function report_irrefutable_let_patterns(
  _tcx: TyCtxt,
  _id: HirId,
  _source: LetSource,
  _count: number,
  _span: Span,
  _else_keyword_span: Span | undefined,
  _let_else_span: Pending | undefined,
): void {
  return unported("rustc_mir_build::thir::pattern::check_match::report_irrefutable_let_patterns (lane thir-pattern)");
}

/// Report unreachable arms, if any.
// (check_match.rs:963 report_unreachable_pattern: stub)
export function report_unreachable_pattern(
  _cx: RustcPatCtxt,
  _hir_id: HirId,
  _pat: Pending,
  _explanation: Pending,
  _whole_arm_span: Span | undefined,
): void {
  return unported("rustc_mir_build::thir::pattern::check_match::report_unreachable_pattern (lane thir-pattern)");
}

/// Detect typos that were meant to be a `const` but were interpreted as a new pattern binding.
// (check_match.rs:1043 find_fallback_pattern_typo: stub)
export function find_fallback_pattern_typo(_cx: RustcPatCtxt, _hir_id: HirId, _pat: Pat, _lint: Pending): void {
  return unported("rustc_mir_build::thir::pattern::check_match::find_fallback_pattern_typo (lane thir-pattern)");
}

/// Report unreachable arms, if any.
// (check_match.rs:1190 report_arm_reachability: stub)
export function report_arm_reachability(_cx: RustcPatCtxt, _report: Pending, _is_match_arm: boolean): void {
  return unported("rustc_mir_build::thir::pattern::check_match::report_arm_reachability (lane thir-pattern)");
}

/// Checks for common cases of "catchall" patterns that may not be intended as such.
// (check_match.rs:1216 pat_is_catchall: stub)
export function pat_is_catchall(_pat: Pending): boolean {
  return unported("rustc_mir_build::thir::pattern::check_match::pat_is_catchall (lane thir-pattern)");
}

/// If the given pattern is a named constant that looks like it could have been
/// intended to be a binding, returns the `DefId` of the named constant.
///
/// Diagnostics use this to give more detailed suggestions for non-exhaustive
/// matches.
// (check_match.rs:1231 is_const_pat_that_looks_like_binding: stub)
export function is_const_pat_that_looks_like_binding(_tcx: TyCtxt, _pat: Pat): DefId | undefined {
  return unported("rustc_mir_build::thir::pattern::check_match::is_const_pat_that_looks_like_binding (lane thir-pattern)");
}

/// Report that a match is not exhaustive.
// (check_match.rs:1250 report_non_exhaustive_match: stub)
export function report_non_exhaustive_match(
  _cx: RustcPatCtxt,
  _thir: Thir,
  _scrut_ty: Ty,
  _sp: Span,
  _witnesses: Pending[],
  _arms: readonly ArmId[],
  _braces_span: Span | undefined,
  _would_be_exhaustive_without_guards: boolean,
): ErrorGuaranteed {
  return unported("rustc_mir_build::thir::pattern::check_match::report_non_exhaustive_match (lane thir-pattern)");
}

// (check_match.rs:1482 joined_uncovered_patterns: stub)
export function joined_uncovered_patterns(_cx: RustcPatCtxt, _witnesses: readonly Pending[]): string {
  return unported("rustc_mir_build::thir::pattern::check_match::joined_uncovered_patterns (lane thir-pattern)");
}

/// Collect types that require specific explanations when they show up in witnesses.
// (check_match.rs:1504 collect_special_tys: stub)
export function collect_special_tys(_cx: RustcPatCtxt, _pat: Pending, _special_tys: Set<Pending>): void {
  return unported("rustc_mir_build::thir::pattern::check_match::collect_special_tys (lane thir-pattern)");
}

// (check_match.rs:1521 report_adt_defined_here: stub)
export function report_adt_defined_here(_tcx: TyCtxt, _ty: Ty, _witnesses: readonly Pending[], _point_at_non_local_ty: boolean): Pending | undefined {
  return unported("rustc_mir_build::thir::pattern::check_match::report_adt_defined_here (lane thir-pattern)");
}

// (check_match.rs:1546 maybe_point_at_variant: stub)
export function maybe_point_at_variant(_tcx: TyCtxt, _def: AdtDef, _patterns: Iterable<Pending>): Span[] {
  return unported("rustc_mir_build::thir::pattern::check_match::maybe_point_at_variant (lane thir-pattern)");
}
