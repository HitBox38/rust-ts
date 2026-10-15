// Port of compiler/rustc_mir_build/src/thir/pattern/mod.rs: STUB (lane thir-cx-print created it; the follow-up lane
// thir-pattern ports it).
//! Validation of patterns/matches.
//
// ## How to fill a stub (pattern/{mod,migration,const_to_pat,check_match}.ts)
// 1. The types and signatures here are final: `PatCtxt` (fields in upstream order, one class) and the exported
//    `pat_from_hir` / `check_match` are what cx/ and lib.ts already call. Keep them; a wrong one goes in your handoff.
// 2. Methods: write `PatCtxt.prototype.<name> = function (this: PatCtxt, ..) { .. }` in upstream order with the marker
//    `// rustc: compiler/rustc_mir_build/src/thir/pattern/<file>.rs:<line> <name>` directly above it, then delete the
//    name from that file's `unported_methods(..)` list (and the call when the list is empty). The `declare module`
//    block of each file already declares the method; methods of `impl PatCtxt` in another file (const_to_pat.rs) are
//    declared and stubbed in that file.
// 3. Free fns: replace the `unported(..)` body of the exported stub function with the port and add the marker.
// 4. Init order: cx/mod.ts imports this module for `pat_from_hir` (a value read inside a function body only), so this
//    module must not read cx/ values at load time; it imports cx types only. lib.ts loads pattern/*.ts after cx/*.
// 5. rustc_pattern_analysis (check_match's `DeconstructedPat`, `RustcPatCtxt`, `UsefulnessReport`, ..) and this crate's
//    diagnostics.rs (`#[derive(Diagnostic)]`, tools/codegen) are not ported: their types are `unknown` in the stub
//    signatures below; type them when they land.
import type { Ty as HirTy, Pat as HirPat, PatExpr as HirPatExpr, QPath, DotDotPos, RangeEnd } from "../../../rustc_hir/hir.ts";
import type { Res } from "../../../rustc_hir/def.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { Ascription, FieldPat, Pat, PatRangeBoundary } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/decls.ts";
import type { CanonicalUserType } from "../../../rustc_middle/ty/typeck_results.ts";
import type { Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { ThirBuildCx } from "../cx/mod.ts";
import type { PatMigration } from "./migration.ts";

// mod check_match; mod const_to_pat; mod migration;
// PORT: the submodules are loaded by the crate root (lib.ts) after this module (const_to_pat.ts extends `PatCtxt`).

// pub(crate) use self::check_match::check_match;
export { check_match } from "./check_match.ts";

/// Context for lowering HIR patterns to THIR patterns.
// rustc-type: compiler/rustc_mir_build/src/thir/pattern/mod.rs:36 PatCtxt
export class PatCtxt {
  constructor(
    public upper: ThirBuildCx,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public typeck_results: TypeckResults,

    /// Used by the Rust 2024 migration lint.
    public rust_2024_migration: PatMigration | undefined,
  ) {}
}

export interface PatCtxt {
  lower_pattern(pat: HirPat): Pat;
  lower_pattern_range_endpoint(
    pat: HirPat,
    expr: HirPatExpr | undefined,
    // Out-parameter collecting extra data to be reapplied by the caller
    ascriptions: Ascription[],
  ): Result<PatRangeBoundary | undefined, ErrorGuaranteed>;
  error_on_literal_overflow(expr: HirPatExpr | undefined, ty: Ty): Result<null, ErrorGuaranteed>;
  lower_pattern_range(pat: HirPat, lo_expr: HirPatExpr | undefined, hi_expr: HirPatExpr | undefined, end: RangeEnd): Result<Pat, ErrorGuaranteed>;
  lower_pattern_unadjusted(pat: HirPat): Pat;
  lower_tuple_subpats(pats: readonly HirPat[], expected_len: number, gap_pos: DotDotPos): FieldPat[];
  lower_patterns(pats: readonly HirPat[]): Pat[];
  lower_opt_pattern(pat: HirPat | undefined): Pat | undefined;
  slice_or_array_pattern(pat: HirPat, prefix: readonly HirPat[], slice: HirPat | undefined, suffix: readonly HirPat[]): Pat;
  lower_variant_or_leaf(pat: HirPat, expr: HirPatExpr | undefined, res: Res, subpatterns: FieldPat[]): Pat;
  user_args_applied_to_ty_of_hir_id(hir_id: HirId): CanonicalUserType | undefined;
  lower_path(pat: HirPat, expr: HirPatExpr, qpath: QPath): Pat;
  lower_pat_expr(pat: HirPat, expr: HirPatExpr): Pat;
}

// #[instrument(level = "debug", skip(upper, tcx, typing_env, typeck_results), ret)]
// (pattern/mod.rs:47 pat_from_hir: stub, lane thir-pattern)
export function pat_from_hir(
  _upper: ThirBuildCx,
  _tcx: TyCtxt,
  _typing_env: TypingEnv,
  _typeck_results: TypeckResults,
  _pat: HirPat,
  // Present if `pat` came from a let statement with an explicit type annotation
  _let_stmt_type: HirTy | undefined,
): Pat {
  return unported("rustc_mir_build::thir::pattern::pat_from_hir (lane thir-pattern)");
}

unported_methods(PatCtxt.prototype, "rustc_mir_build::thir::pattern::PatCtxt", [
  "lower_pattern",
  "lower_pattern_range_endpoint",
  "error_on_literal_overflow",
  "lower_pattern_range",
  "lower_pattern_unadjusted",
  "lower_tuple_subpats",
  "lower_patterns",
  "lower_opt_pattern",
  "slice_or_array_pattern",
  "lower_variant_or_leaf",
  "user_args_applied_to_ty_of_hir_id",
  "lower_path",
  "lower_pat_expr",
]);
